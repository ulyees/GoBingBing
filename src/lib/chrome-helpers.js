/**
 * Small wrappers around Chrome APIs whose promise form is not available in
 * every supported version. Keeping the callback form here means the rest of
 * the code can simply await them.
 */

export function getFrameUrl(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.webNavigation.getFrame({ tabId, frameId: 0 }, (frame) => {
        void chrome.runtime.lastError;
        resolve((frame && frame.url) || "");
      });
    } catch {
      resolve("");
    }
  });
}

export function permissionsContains(origins) {
  return new Promise((resolve) => {
    try {
      chrome.permissions.contains({ origins }, (granted) => {
        void chrome.runtime.lastError;
        resolve(Boolean(granted));
      });
    } catch {
      resolve(false);
    }
  });
}

export function permissionsRequest(origins) {
  return new Promise((resolve) => {
    try {
      chrome.permissions.request({ origins }, (granted) => {
        void chrome.runtime.lastError;
        resolve(Boolean(granted));
      });
    } catch {
      resolve(false);
    }
  });
}
