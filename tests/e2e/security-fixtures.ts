import { chromium } from '@playwright/test'
import path from 'node:path'

const extensionPath = path.resolve('dist')
export const launch = (profile: string) => chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
})

export async function helper(context: Awaited<ReturnType<typeof launch>>) {
  let [worker] = context.serviceWorkers()
  if (!worker) worker = await context.waitForEvent('serviceworker')
  const page = await context.newPage()
  await page.goto(`chrome-extension://${worker.url().split('/')[2]}/popup/popup.html`)
  return page
}
