/**
 * Reachability probes for the popup.
 *
 * Only *source* hosts (the sites a rule matches) are probed; the replacement
 * target is deliberately never probed. Requests use `mode: "no-cors"` so they
 * work without host permissions: an opaque response still tells us whether the
 * network stack could reach the origin.
 */

const LATENCY_KEY = "latency";
const MAX_LATENCY_ENTRIES = 60;

const HOST_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function isHostname(value) {
  return HOST_RE.test(value);
}

/** Turn one host pattern into a concrete host we can ping. */
export function concreteHost(pattern) {
  const value = String(pattern || "").trim().toLowerCase().replace(/\.$/, "");
  if (!value || value === "*") return "";
  if (value.startsWith("*.")) {
    const bare = value.slice(2);
    return isHostname(bare) ? bare : "";
  }
  if (!value.includes("*")) return isHostname(value) ? value : "";
  const filled = value.replace(/\*/g, "com");
  return isHostname(filled) ? filled : "";
}

/** Concrete, de-duplicated hosts for a rule's host patterns. */
export function concreteHosts(patterns) {
  if (!Array.isArray(patterns)) return [];
  const hosts = [];
  for (const pattern of patterns) {
    const host = concreteHost(pattern);
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

/**
 * Resolve the configured timeout. "auto" follows the last successful latency
 * for that host (3x, clamped to 1.5-8s) and falls back to 4s.
 */
export function resolveTimeout(setting, lastMs) {
  if (setting !== "auto") {
    const value = Number(setting);
    if (!Number.isFinite(value)) return 4000;
    return Math.min(15000, Math.max(1000, Math.round(value)));
  }
  if (Number.isFinite(lastMs) && lastMs > 0) {
    return Math.min(8000, Math.max(1500, Math.round(lastMs * 3)));
  }
  return 4000;
}

function now() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

/** Probe one host. Never throws. */
export async function probeHost(host, timeoutMs) {
  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  try {
    await fetch("https://" + host + "/favicon.ico?gbb=" + Date.now(), {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      signal: controller.signal
    });
    return { ok: true, ms: Math.max(1, Math.round(now() - started)) };
  } catch {
    return { ok: false, ms: Math.max(1, Math.round(now() - started)) };
  } finally {
    clearTimeout(timer);
  }
}

export async function readLatencies() {
  try {
    const stored = await chrome.storage.local.get(LATENCY_KEY);
    const map = stored[LATENCY_KEY];
    return map && typeof map === "object" ? map : {};
  } catch {
    return {};
  }
}

export async function saveLatency(host, ms) {
  try {
    const stored = await chrome.storage.local.get(LATENCY_KEY);
    const map = stored[LATENCY_KEY] && typeof stored[LATENCY_KEY] === "object" ? stored[LATENCY_KEY] : {};
    map[host] = { ms: Math.round(ms), at: Date.now() };
    const entries = Object.entries(map)
      .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
      .slice(0, MAX_LATENCY_ENTRIES);
    await chrome.storage.local.set({ [LATENCY_KEY]: Object.fromEntries(entries) });
  } catch {
    // Latency hints are best effort.
  }
}
