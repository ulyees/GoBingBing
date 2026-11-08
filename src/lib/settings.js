import { DEFAULT_RULES, sanitizeRules } from "./rules.js";

export const DEFAULT_SETTINGS = {
  enabled: true,
  rules: DEFAULT_RULES,
  cooldownMs: 3000,
  windowMs: 60000,
  maxRedirects: 4,
  notifyOnRedirect: true,
  notifyOnBlocked: true,
  showBadge: true,
  preflight: { enabled: false, timeoutMs: 2500 },
  probe: { onOpen: true, timeout: "auto" },
  logLimit: 30
};

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function normalizeProbeTimeout(value) {
  if (value === "auto" || value === undefined || value === null || value === "") return "auto";
  const number = Number(value);
  if (!Number.isFinite(number)) return "auto";
  return Math.min(15000, Math.max(1000, Math.round(number)));
}

export function normalizeSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  const rules = sanitizeRules(source.rules);
  const preflight = source.preflight && typeof source.preflight === "object" ? source.preflight : {};
  const probe = source.probe && typeof source.probe === "object" ? source.probe : {};
  return {
    enabled: source.enabled !== false,
    rules:
      rules !== null
        ? rules
        : DEFAULT_RULES.map((rule) => ({ ...rule, hosts: [...rule.hosts] })),
    cooldownMs: clamp(source.cooldownMs, 500, 60000, DEFAULT_SETTINGS.cooldownMs),
    windowMs: clamp(source.windowMs, 5000, 600000, DEFAULT_SETTINGS.windowMs),
    maxRedirects: clamp(source.maxRedirects, 1, 10, DEFAULT_SETTINGS.maxRedirects),
    notifyOnRedirect: source.notifyOnRedirect !== false,
    notifyOnBlocked: source.notifyOnBlocked !== false,
    showBadge: source.showBadge !== false,
    preflight: {
      enabled: preflight.enabled === true,
      timeoutMs: clamp(preflight.timeoutMs, 800, 15000, DEFAULT_SETTINGS.preflight.timeoutMs)
    },
    probe: {
      onOpen: probe.onOpen !== false,
      timeout: normalizeProbeTimeout(probe.timeout)
    },
    logLimit: clamp(source.logLimit, 10, 100, DEFAULT_SETTINGS.logLimit)
  };
}

export async function getSettings() {
  try {
    const stored = await chrome.storage.local.get("settings");
    return normalizeSettings(stored.settings);
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...(patch || {}) });
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function logEvent(event) {
  try {
    const { events } = await chrome.storage.local.get("events");
    const list = Array.isArray(events) ? events : [];
    await chrome.storage.local.set({
      events: [event, ...list].slice(0, 50)
    });
  } catch {
    // Logging must never break a failover.
  }
}

export async function getEvents() {
  try {
    const { events } = await chrome.storage.local.get("events");
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}

export async function clearEvents() {
  await chrome.storage.local.set({ events: [] });
}
