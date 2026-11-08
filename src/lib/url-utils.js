/**
 * Pure URL helpers shared by the service worker, popup and options page.
 * This module never touches chrome.* so it can also run under Node in tests.
 */

export const SEARCH_PARAM_KEYS = ["q", "wd", "query", "keyword", "text", "p"];

const GOOGLE_HOST_RE = /^(?:www\.)?google\.[a-z]{2,4}(?:\.[a-z]{2,4})?$/;
const REDIRECT_PATHS = new Set(["/url", "/imgres"]);

const BING_VERTICALS = {
  isch: "/images/search",
  vid: "/videos/search",
  nws: "/news/search",
  shop: "/shop"
};

/** Parse a URL, returning null instead of throwing. */
export function parseUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Lower-cased hostname without a trailing dot, or "" when unparseable. */
export function hostOf(value) {
  const url = parseUrl(value);
  return url ? url.hostname.toLowerCase().replace(/\.$/, "") : "";
}

export function normalizeHost(host) {
  return String(host || "").trim().toLowerCase().replace(/\.$/, "");
}

/** Convert a host pattern (supports "*") into an anchored RegExp. */
export function patternToRegExp(pattern) {
  const escaped = String(pattern)
    .trim()
    .toLowerCase()
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp("^" + escaped + "$");
}

/**
 * Match a hostname against a pattern.
 *   "*"                -> any host
 *   "*.example.com"    -> example.com and every subdomain
 *   "google.*"         -> google.com, google.com.hk, ...
 *   "cn.bing.com"      -> exactly that host
 */
export function hostMatches(pattern, host) {
  const p = normalizeHost(pattern);
  const h = normalizeHost(host);
  if (!p || !h) return false;
  if (p === "*") return true;
  if (p.startsWith("*.")) {
    const bare = p.slice(2);
    return h === bare || h.endsWith("." + bare);
  }
  if (p.includes("*")) return patternToRegExp(p).test(h);
  return h === p;
}

/** True for google.com and its country variants (google.com.hk, google.co.jp, ...). */
export function isGoogleHost(host) {
  return GOOGLE_HOST_RE.test(normalizeHost(host));
}

/** Pull the search terms out of a search URL (query string or hash based). */
export function extractSearchQuery(value) {
  const url = parseUrl(value);
  if (!url) return null;
  for (const key of SEARCH_PARAM_KEYS) {
    const found = url.searchParams.get(key);
    if (found && found.trim()) return found.trim();
  }
  const hash = url.hash.replace(/^#/, "");
  if (hash.includes("=")) {
    const params = new URLSearchParams(hash);
    for (const key of SEARCH_PARAM_KEYS) {
      const found = params.get(key);
      if (found && found.trim()) return found.trim();
    }
  }
  return null;
}

/**
 * Google wraps outbound links in /url?q=... . If such a URL is the thing that
 * failed, the real destination is still worth a try.
 */
export function unwrapRedirector(value) {
  const url = parseUrl(value);
  if (!url || !isGoogleHost(url.hostname)) return null;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (!REDIRECT_PATHS.has(path)) return null;
  for (const key of ["q", "url", "imgurl"]) {
    const found = url.searchParams.get(key);
    if (found && /^https?:\/\//i.test(found)) return found;
  }
  return null;
}

/** Which query parameter name a destination engine expects. */
export function queryParamFor(host) {
  const h = normalizeHost(host);
  if (h.endsWith("baidu.com")) return "wd";
  if (h.endsWith("sogou.com")) return "query";
  return "q";
}

/** Bing vertical path for a Google tbm value (images/videos/news/shopping). */
export function verticalPath(host, tbm) {
  if (!tbm) return null;
  if (!normalizeHost(host).endsWith("bing.com")) return null;
  return BING_VERTICALS[tbm] || null;
}

/**
 * Build the failover destination for a failed URL.
 *   - preservePath: keep path/query/hash (cn.bing.com -> www.bing.com)
 *   - otherwise: move a search query across engines, else go to the origin root
 */
export function buildFailoverUrl(sourceUrl, rule) {
  const src = parseUrl(sourceUrl);
  const dst = parseUrl(rule && rule.to);
  if (!src || !dst) return null;

  if (rule.preservePath) {
    dst.pathname = src.pathname || "/";
    dst.search = src.search;
    dst.hash = src.hash;
    return dst.href;
  }

  const query = extractSearchQuery(sourceUrl);
  if (query) {
    dst.search = "";
    dst.hash = "";
    dst.pathname =
      verticalPath(dst.hostname, src.searchParams.get("tbm")) || "/search";
    dst.searchParams.set(queryParamFor(dst.hostname), query);
    return dst.href;
  }

  dst.pathname = "/";
  dst.search = "";
  dst.hash = "";
  return dst.href;
}
