/**
 * Site icons for the popup.
 *
 * Priority: bytes cached in storage (captured when a host permission happens
 * to be granted), then the site's own /favicon.ico, then DuckDuckGo's icon
 * proxy. Anything that fails falls back to a coloured first letter. Whenever a
 * later attempt succeeds the result is stored so the next popup starts with it.
 */

import { permissionsContains } from "./chrome-helpers.js";

const ICON_KEY = "icons";
const MAX_ICONS = 40;
const MAX_BYTES = 96 * 1024;
const DDG_BASE = "https://icons.duckduckgo.com/ip3/";

export function initialFor(host) {
  const clean = String(host || "").replace(/^www\./, "");
  const first = Array.from(clean)[0] || "?";
  return /[a-z0-9]/i.test(first) ? first.toUpperCase() : "#";
}

export function hashHue(host) {
  let hash = 0;
  const text = String(host || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 360;
  }
  return hash;
}

export function iconCandidates(host, entry) {
  const list = [];
  if (entry && entry.dataUrl) list.push(entry.dataUrl);
  if (entry && typeof entry.url === "string" && /^https:\/\//.test(entry.url)) {
    list.push(entry.url);
  }
  if (host) {
    list.push("https://" + host + "/favicon.ico");
    list.push(DDG_BASE + encodeURIComponent(host) + ".ico");
  }
  return [...new Set(list)];
}

export async function readIconCache() {
  try {
    const stored = await chrome.storage.local.get(ICON_KEY);
    const map = stored[ICON_KEY];
    return map && typeof map === "object" ? map : {};
  } catch {
    return {};
  }
}

export async function saveIconEntry(host, entry) {
  if (!host) return;
  try {
    const stored = await chrome.storage.local.get(ICON_KEY);
    const map = stored[ICON_KEY] && typeof stored[ICON_KEY] === "object" ? stored[ICON_KEY] : {};
    map[host] = { ...(map[host] || {}), ...entry, at: Date.now() };
    const entries = Object.entries(map)
      .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
      .slice(0, MAX_ICONS);
    await chrome.storage.local.set({ [ICON_KEY]: Object.fromEntries(entries) });
  } catch {
    // The letter fallback still works.
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Try to download and persist the real icon bytes. This only works when the
 * user already granted access to that host (for example by enabling preflight),
 * because the extension must read the response body.
 */
export async function captureIcon(host) {
  if (!host) return null;
  const granted = await permissionsContains(["https://" + host + "/*"]);
  if (!granted) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("https://" + host + "/favicon.ico", {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || blob.size === 0 || blob.size > MAX_BYTES) return null;
    const dataUrl = await blobToDataUrl(blob);
    if (!/^data:image\//.test(dataUrl)) return null;
    await saveIconEntry(host, { dataUrl });
    return dataUrl;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
