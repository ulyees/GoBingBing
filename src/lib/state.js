/**
 * Per-tab redirection chain, used to suppress duplicate events and to break
 * redirect loops. chrome.storage.session survives service-worker restarts but
 * is cleared when the browser closes; a memory map covers environments where
 * session storage is unavailable.
 */

const memory = new Map();

function keyFor(tabId) {
  return "tab:" + tabId;
}

export async function getTabState(tabId) {
  try {
    const stored = await chrome.storage.session.get(keyFor(tabId));
    const value = stored[keyFor(tabId)];
    if (value) return value;
  } catch {
    // fall through to memory
  }
  return memory.get(tabId) || { chain: [], lastUrl: "", lastUrlAt: 0 };
}

export async function setTabState(tabId, state) {
  memory.set(tabId, state);
  try {
    await chrome.storage.session.set({ [keyFor(tabId)]: state });
  } catch {
    // memory copy is enough
  }
}

export async function clearTabState(tabId) {
  memory.delete(tabId);
  try {
    await chrome.storage.session.remove(keyFor(tabId));
  } catch {
    // ignore
  }
}
