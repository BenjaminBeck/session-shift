// tab-fresh-load.ts — Force one tab's next navigation to complete, then hard
// reload it once, bypassing the disk cache.
//
// SessionShift profiles share Chrome's real HTTP disk cache — they're cookie
// jars within one browser profile, not separate contexts. A server that never
// sends `Vary: Cookie` can let a cache hit serve a response fetched under a
// DIFFERENT profile's cookies, silently: no request even goes out, so DNR's
// per-navigation Cookie strip never gets a chance to run.
// `chrome.tabs.reload({ bypassCache: true })` is the one API that actually
// skips that lookup, and it only works on an already-navigated tab — there is
// no bypass-cache option on `tabs.create`/`tabs.update`. So `createSessionTab`
// lets the first navigation start normally and this forces one hard reload
// once it completes, guaranteeing what the user ends up seeing was fetched
// under the new profile's cookies, not read back from a stale cache entry.
//
// The listener unregisters itself before issuing that reload — otherwise the
// reload's own completion would re-trigger it, looping forever.

import { whenNavigationCapturesSettled } from './redirect-hop-stale-cookie-guard.js';

export function forceFreshLoadOnce(tabId: number): void {
  const onUpdated = async (updatedTabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab): Promise<void> => {
    if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
    // tabs.create starts at about:blank. Its delayed completion must not
    // cancel the real navigation or consume this one-shot cache bypass.
    if (!tab.url || !/^https?:/.test(tab.url)) return;
    stop();
    // Reloading while Set-Cookie is still being published creates another
    // guest session. Its response is then correctly rejected as stale, but
    // its rendered CSRF token no longer matches our retained session cookie.
    await whenNavigationCapturesSettled(tabId);
    chrome.tabs.reload(tabId, { bypassCache: true }).catch(() => {});
  };

  // Tab closed before its first navigation ever finished — nothing to reload,
  // and a closed tab's numeric id could otherwise be reused by an unrelated
  // later tab that this listener was never meant to react to.
  const onRemoved = (removedTabId: number): void => {
    if (removedTabId !== tabId) return;
    stop();
  };

  function stop(): void {
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onRemoved.removeListener(onRemoved);
  }

  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onRemoved.addListener(onRemoved);
}
