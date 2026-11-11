import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { launch, helper } from './security-fixtures'

test('SameSite rejects cross-site subresources and POST but allows a safe top-level Lax navigation', async ({}, testInfo) => {
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'text/html')
    res.end(`<body>${req.headers.cookie ?? 'empty'}</body>`)
  })
  await new Promise<void>(resolve => server.listen(0, resolve))
  const port = (server.address() as { port: number }).port
  const source = `http://localhost:${port}/`
  const target = `http://127.0.0.1:${port}/`
  const context = await launch(testInfo.outputPath('samesite-profile'))
  try {
    const ui = await helper(context)
    await ui.evaluate(async () => {
      await chrome.storage.local.set({ profiles: [{ id: 'session_site', name: 'Site' }], cookies_session_site: {
        strict: { name: 'strict', value: '1', domain: '127.0.0.1', path: '/', sameSite: 'Strict' },
        lax: { name: 'lax', value: '1', domain: '127.0.0.1', path: '/', sameSite: 'Lax' },
      } })
    })
    const page = await context.newPage()
    await page.goto(source)
    const result = await ui.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(t => t.url === url)!
      return chrome.runtime.sendMessage({ action: 'setSession', payload: { tabId: tab.id, sessionId: 'session_site' } })
    }, source)
    expect(result.success).toBe(true)
    const response = await page.evaluate(async url => (await fetch(url, { method: 'POST' })).text(), target)
    expect(response).toBe('<body>empty</body>')
    await page.evaluate(url => { location.href = url }, target)
    await expect(page.locator('body')).toHaveText('lax=1')
    const own = await page.evaluate(async () => (await fetch('/', { method: 'POST' })).text())
    expect(own).toContain('strict=1')
    expect(own).toContain('lax=1')
  } finally {
    await context.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
