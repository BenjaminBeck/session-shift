import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { launch, helper } from './security-fixtures'

test('browser restart requires an explicit role before contacting a protected site', async ({}, testInfo) => {
  const requests: string[] = []
  const server = createServer((req, res) => {
    requests.push(req.headers.cookie ?? '')
    res.setHeader('Content-Type', 'text/html')
    res.end(`<body>${req.headers.cookie ?? 'empty'}</body>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const url = `http://127.0.0.1:${address.port}/`
  const profile = testInfo.outputPath('restart-profile')
  let context = await launch(profile)
  try {
    await context.addCookies([{ name: 'user', value: 'normal', url }])
    const ui = await helper(context)
    await ui.evaluate(async () => {
      await chrome.storage.local.set({
        profiles: [{ id: 'session_alice', name: 'Alice' }, { id: 'session_bob', name: 'Bob' }],
        cookies_session_alice: { user: { name: 'user', value: 'alice', domain: '127.0.0.1', path: '/', sameSite: 'Lax' } },
        cookies_session_bob: { user: { name: 'user', value: 'bob', domain: '127.0.0.1', path: '/', sameSite: 'Lax' } },
      })
    })
    for (const sessionId of ['session_alice', 'session_bob']) {
      const result = await ui.evaluate(({ url, sessionId }) => chrome.runtime.sendMessage({ action: 'createSessionTab', payload: { url, sessionId } }), { url, sessionId })
      expect(result.success).toBe(true)
    }
    await expect.poll(() => requests.some(c => c === 'user=bob')).toBe(true)
    await context.close()
    requests.length = 0
    context = await launch(profile)
    const first = await context.newPage()
    const second = await context.newPage()
    await first.goto(url)
    await second.goto(url)
    await expect(first.getByRole('button', { name: 'Alice', exact: true })).toBeVisible()
    await expect(second.getByRole('button', { name: 'Bob', exact: true })).toBeVisible()
    expect(requests).toEqual([])
    await first.screenshot({ path: testInfo.outputPath('restore.png') })
    const post = await context.newPage()
    await post.setContent(`<form method=post action="${url}"><input name=action value=change></form>`)
    const blocked = post.waitForEvent('requestfailed')
    await post.locator('form').evaluate((form: HTMLFormElement) => form.submit())
    expect((await blocked).failure()?.errorText).toContain('ERR_BLOCKED_BY_CLIENT')
    expect(requests).toEqual([])
    await post.close()
    await first.getByRole('button', { name: 'Alice', exact: true }).click()
    await expect(first.locator('body')).toHaveText('user=alice')
    await second.getByRole('button', { name: 'Bob', exact: true }).click()
    await expect(second.locator('body')).toHaveText('user=bob')
    expect(requests.some(c => c.includes('normal'))).toBe(false)
  } finally {
    await context.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
