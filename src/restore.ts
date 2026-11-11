import { getProfiles } from './lib/session-store.js';

const target = location.hash.slice(1);
const error = document.getElementById('error')!;
const list = document.getElementById('profiles')!;

async function start() {
  if (window !== window.top) throw new Error('Sitzungsauswahl muss in einem eigenen Tab geöffnet werden.');
  const url = new URL(target);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Ungültige Zieladresse.');
  document.getElementById('target')!.textContent = url.href;
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id === undefined) throw new Error('Tab nicht verfügbar.');
  const tabId = tab.id;
  let activating = false;
  async function activate(sessionId: string) {
    if (activating) return;
    activating = true;
    const buttons = list.querySelectorAll('button');
    buttons.forEach(b => { b.disabled = true; });
    try {
      // Await the rule installation even when a linked tab has just inherited
      // a role. A stored assignment alone does not prove its rules are live.
      const result = await chrome.runtime.sendMessage({ action: 'setSession', payload: { tabId, sessionId } });
      if (!result?.success) throw new Error(result?.error ?? 'Sitzung konnte nicht aktiviert werden.');
      await chrome.tabs.update(tabId, { url: url.href });
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : String(e);
      activating = false;
      buttons.forEach(b => { b.disabled = false; });
    }
  }
  for (const profile of [...await getProfiles(), { id: 'default', name: 'Normale Chrome-Sitzung' }]) {
    const button = document.createElement('button');
    button.textContent = profile.name;
    button.style.margin = '0.5rem';
    button.addEventListener('click', () => { void activate(profile.id); });
    list.append(button);
  }
  // Linked-tab inheritance may finish just after the durable guard redirected
  // the first request here. Only an explicit live assignment can auto-resume;
  // a browser restart has no session map and still requires the user's choice.
  async function resumeAssignedProfile() {
    const result = await chrome.runtime.sendMessage({ action: 'getSession', payload: { tabId } });
    if (typeof result?.sessionId === 'string' && result.sessionId !== 'default') await activate(result.sessionId);
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.tabSessions) void resumeAssignedProfile();
  });
  await resumeAssignedProfile();
}
void start().catch(e => { error.textContent = e.message; });
