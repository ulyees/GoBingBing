import { hostMatches, parseUrl } from "./url-utils.js";

/**
 * Rules are evaluated in order; the first enabled rule whose host pattern
 * matches wins. "to" is always an https origin (optionally with a path).
 */
export const DEFAULT_RULES = [
  {
    id: "google-to-bing",
    enabled: true,
    label: "Google 打不开 → 用 cn.bing.com 搜索",
    hosts: ["google.*", "www.google.*"],
    to: "https://cn.bing.com",
    preservePath: false
  },
  {
    id: "cnbing-to-bing",
    enabled: true,
    label: "cn.bing.com 打不开 → bing.com",
    hosts: ["cn.bing.com"],
    to: "https://www.bing.com",
    preservePath: true
  }
];

export function findRule(rules, host) {
  if (!Array.isArray(rules) || !host) return null;
  for (const rule of rules) {
    if (!rule || rule.enabled === false) continue;
    if (!Array.isArray(rule.hosts)) continue;
    for (const pattern of rule.hosts) {
      if (hostMatches(pattern, host)) return rule;
    }
  }
  return null;
}

let fallbackCounter = 0;

export function sanitizeRule(input, index = 0) {
  if (!input || typeof input !== "object") return null;
  const to = parseUrl(input.to);
  if (!to || !/^https?:$/.test(to.protocol)) return null;

  const hosts = (Array.isArray(input.hosts) ? input.hosts : [])
    .map((host) => String(host || "").trim().toLowerCase())
    .filter((host) => host && host.length <= 253)
    .filter((host, i, list) => list.indexOf(host) === i);

  if (hosts.length === 0) return null;

  const label =
    typeof input.label === "string" && input.label.trim()
      ? input.label.trim().slice(0, 80)
      : hosts[0] + " → " + to.hostname;

  return {
    id:
      typeof input.id === "string" && input.id.trim()
        ? input.id.trim()
        : "rule-" + Date.now() + "-" + index + "-" + fallbackCounter++,
    enabled: input.enabled !== false,
    label,
    hosts,
    to: to.href,
    preservePath: Boolean(input.preservePath)
  };
}

/** Return a clean rule list, or null when the input is unusable. */
export function sanitizeRules(input) {
  if (!Array.isArray(input)) return null;
  return input
    .map((rule, index) => sanitizeRule(rule, index))
    .filter((rule) => rule !== null);
}
