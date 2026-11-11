// Durable domain guards survive browser restarts; per-tab exemptions do not.
// See ADR-0001. Never guess a role from a URL shared by several accounts.
const GUARD_RULE_ID = 1_500_000_000;
const RESOURCE_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webbundle', 'other',
] as chrome.declarativeNetRequest.ResourceType[];
export const TAB_ALLOW_OFFSET = 101_000_000;
const guardUrl = () => chrome.runtime.getURL('restore.html');
let queue: Promise<void> = Promise.resolve();

export function tabExemption(tabId: number): chrome.declarativeNetRequest.Rule {
  return { id: TAB_ALLOW_OFFSET + (tabId % 1_000_000) + 1, priority: 10, action: { type: 'allow' }, condition: { tabIds: [tabId], resourceTypes: RESOURCE_TYPES } };
}

export function protectUrl(rawUrl: string): Promise<void> {
  const run = queue.then(async () => {
    let url: URL;
    try { url = new URL(rawUrl); } catch { return; }
    if (!['https:', 'http:'].includes(url.protocol)) return;
    const { protectedHosts = [] } = await chrome.storage.local.get('protectedHosts');
    const hosts = Array.isArray(protectedHosts) ? protectedHosts.filter((h): h is string => typeof h === 'string') : [];
    if (hosts.includes(url.hostname)) return;
    hosts.push(url.hostname);
    // Existing normal tabs keep their explicitly current identity. New tabs
    // on protected hosts must choose a role (or Chrome's normal session).
    const tabs = await chrome.tabs.query({});
    const exemptions = (tabs ?? []).filter(t => {
      try { return t.id !== undefined && new URL(t.url ?? '').hostname === url.hostname; } catch { return false; }
    }).map(t => tabExemption(t.id!));
    if (exemptions.length) await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: exemptions.map(r => r.id), addRules: exemptions,
    });
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [GUARD_RULE_ID, GUARD_RULE_ID + 1],
      addRules: [
        { id: GUARD_RULE_ID, priority: 2, action: { type: 'redirect', redirect: { regexSubstitution: `${guardUrl()}#\\0` } },
          condition: { requestDomains: hosts, regexFilter: '^https?://.*', resourceTypes: ['main_frame'], requestMethods: ['get'] } },
        // Never replay a POST across a restart/unknown assignment. Blocking
        // also keeps subresources out of Chrome's normal cookie jar.
        { id: GUARD_RULE_ID + 1, priority: 1, action: { type: 'block' }, condition: { requestDomains: hosts, resourceTypes: RESOURCE_TYPES } },
      ],
    });
    await chrome.storage.local.set({ protectedHosts: hosts });
  });
  queue = run.catch(() => {});
  return run;
}
