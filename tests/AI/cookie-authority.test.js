import { beforeEach, describe, expect, it } from 'vitest'
import { handleMessage } from '../background/message-handler.js'
import { tabSessions } from '../background/session-manager.js'

const sid = 'session_authority'
const sender = { id: 'test-ext-id', url: 'https://frame.test/page', origin: 'https://frame.test', frameId: 3, tab: { id: 811, url: 'https://parent.test/' } }
const entry = (domain, httpOnly = false) => ({ name: 'sid', value: 'original', domain, path: '/', httpOnly })
const store = async () => (await chrome.storage.local.get(`cookies_${sid}`))[`cookies_${sid}`]

beforeEach(async () => {
  tabSessions[811] = sid
  chrome.tabs.get.mockResolvedValue(sender.tab)
  await chrome.storage.local.set({ [`cookies_${sid}`]: {
    'sid|victim.test|/': entry('victim.test'),
    'sid|frame.test|/': entry('frame.test'),
    'secret|frame.test|/': { ...entry('frame.test', true), name: 'secret' },
  } })
})

describe('page messages cannot choose cookie authority', () => {
  it('ignores a forged URL and writes only for the sending iframe', async () => {
    await handleMessage({ action: 'updateCookie', payload: { url: 'https://victim.test/', setCookieStr: 'sid=changed; Path=/' } }, sender)
    expect((await store())['sid|victim.test|/'].value).toBe('original')
    expect((await store())['sid|frame.test|/'].value).toBe('changed')
    expect((await store())['sid|parent.test|/']).toBeUndefined()
  })
  it('rejects opaque frames instead of falling back to the top-level tab', async () => {
    await handleMessage({ action: 'updateCookie', payload: { url: 'https://victim.test/', setCookieStr: 'sid=changed' } }, { ...sender, url: 'about:blank', origin: 'null' })
    expect((await store())['sid|victim.test|/'].value).toBe('original')
  })
})
