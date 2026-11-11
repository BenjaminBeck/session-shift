import { expect, it } from 'vitest'
import { updateDNRRulesForTab } from '../background/dnr-manager.js'

it('blocks main-frame requests if Chrome rejects a cookie-rule publication', async () => {
  chrome.tabs.get.mockResolvedValue({ id: 455, url: 'https://publication.test/' })
  chrome.declarativeNetRequest.updateSessionRules.mockRejectedValueOnce(new Error('rule rejected'))
  await expect(updateDNRRulesForTab(455, 'session_publication')).rejects.toThrow('rule rejected')
  const [{ addRules }] = chrome.declarativeNetRequest.updateSessionRules.mock.calls.at(-1)
  expect(addRules).toHaveLength(1)
  expect(addRules[0].action.type).toBe('block')
  expect(addRules[0].condition.tabIds).toEqual([455])
  expect(addRules[0].condition.resourceTypes).toContain('main_frame')
})
