import {
  hostOf,
  buildFailoverUrl,
  unwrapRedirector,
  extractSearchQuery,
  parseUrl
} from "./lib/url-utils.js";
import { findRule } from "./lib/rules.js";
import { getSettings, logEvent, normalizeSettings } from "./lib/settings.js";
import { getTabState, setTabState, clearTabState } from "./lib/state.js";
import { getFrameUrl, permissionsContains } from "./lib/chrome-helpers.js";

const ICON_URL = "icons/icon128.png";
const BADGE_CLEAR_ALARM = "gobingbing-clear-badge";
const HTTP_URL_FILTER = { url: [{ schemes: ["http", "https"] }] };

let lastNotification = { key: "", at: 0 };

function notify(title, message, key) {
  const now = Date.now();
  if (lastNotification.key === key && now - lastNotification.at < 5000) return;
  lastNotification = { key, at: now };
  try {
    chrome.notifications.create(
      "gbb-" + now,
      {
        type: "basic",
        iconUrl: chrome.runtime.getURL(ICON_URL),
        title,
        message,
        priority: 0
      },
      () => void chrome.runtime.lastError
    );
  } catch {
    // Notifications are best effort.
  }
}

async function setBadge(text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: color || "#2563eb" });
    await chrome.action.setBadgeText({ text: text || "" });
    if (text) chrome.alarms.create(BADGE_CLEAR_ALARM, { when: Date.now() + 8000 });
  } catch {
    // Ignore.
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BADGE_CLEAR_ALARM) {
    chrome.action.setBadgeText({ text: "" });
  }
});

/**
 * 1.1.0 moved the Google fallback from www.bing.com to cn.bing.com. Stored
 * settings always win over defaults, so rewrite the untouched default rule.
 */
async function migrateDefaultRule() {
  try {
    const stored = await chrome.storage.local.get("settings");
    const settings = stored.settings;
    if (!settings || !Array.isArray(settings.rules)) return;

    let changed = false;
    for (const rule of settings.rules) {
      const untouchedDefault =
        rule &&
        rule.id === "google-to-bing" &&
        Array.isArray(rule.hosts) &&
        rule.hosts.length === 2 &&
        rule.hosts[0] === "google.*" &&
        rule.hosts[1] === "www.google.*" &&
        hostOf(rule.to) === "www.bing.com";
      if (untouchedDefault) {
        rule.to = "https://cn.bing.com/";
        changed = true;
      }
    }

    if (changed) {
      await chrome.storage.local.set({ settings: normalizeSettings(settings) });
      await logEvent({
        type: "info",
        ts: Date.now(),
        message: "默认 Google 规则已更新为 cn.bing.com"
      });
    }
  } catch {
    // Migration is best effort.
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await migrateDefaultRule();
  await logEvent({
    type: "info",
    ts: Date.now(),
    message: details.reason === "install" ? "扩展已安装" : "扩展已更新"
  });
  if (details.reason === "install") {
    try {
      await chrome.runtime.openOptionsPage();
    } catch {
      // Ignore.
    }
  }
});

chrome.runtime.onStartup.addListener(() => {
  chrome.action.setBadgeText({ text: "" });
});

/* ------------------------------------------------------------------ */
/* Navigation tracking                                                 */
/* ------------------------------------------------------------------ */

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!/^https?:/i.test(details.url)) return;
  void rememberUrl(details.tabId, details.url);
  void runPreflight(details.tabId, details.url);
}, HTTP_URL_FILTER);

async function rememberUrl(tabId, url) {
  try {
    const state = await getTabState(tabId);
    await setTabState(tabId, { ...state, lastUrl: url, lastUrlAt: Date.now() });
  } catch {
    // Ignore.
  }
}

chrome.webNavigation.onErrorOccurred.addListener((details) => {
  if (details.frameId !== 0) return;
  if (details.error === "net::ERR_ABORTED") return;
  if (!details.url) return;
  void handleFailure(details.tabId, details.url, details.error, "network-error");
}, HTTP_URL_FILTER);

// Some failures surface as Chrome's own error page without an onErrorOccurred
// event we can use. Fall back to the last main-frame URL we saw in this tab.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!details.url.startsWith("chrome-error://")) return;
  void (async () => {
    const state = await getTabState(details.tabId);
    if (!state.lastUrl) return;
    if (Date.now() - (state.lastUrlAt || 0) > 30000) return;
    await handleFailure(details.tabId, state.lastUrl, "chrome-error-page", "error-page");
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTabState(tabId);
});

/* ------------------------------------------------------------------ */
/* Failover                                                            */
/* ------------------------------------------------------------------ */

const inFlightTabs = new Set();

async function handleFailure(tabId, failedUrl, error, source) {
  // onErrorOccurred and the chrome-error fallback can report the same failure;
  // serialise handling so only the first one performs a redirect.
  if (inFlightTabs.has(tabId)) return;
  inFlightTabs.add(tabId);
  try {
    const settings = await getSettings();
    if (!settings.enabled) return;

    const host = hostOf(failedUrl);
    if (!host) return;

    const target = planTarget(failedUrl, host, settings.rules);
    if (!target) return;
    const targetHost = hostOf(target.url);
    if (!targetHost || targetHost === host) return;

    const state = await getTabState(tabId);
    const now = Date.now();
    const chain = (Array.isArray(state.chain) ? state.chain : []).filter(
      (entry) => entry && now - entry.ts < settings.windowMs
    );
    const last = chain[chain.length - 1];

    // Duplicate event for the same failure (Chrome reports it twice).
    if (last && last.to === targetHost && now - last.ts < settings.cooldownMs) {
      return;
    }

    // A -> B -> A bounce: stop instead of ping-ponging forever.
    if (last && last.from === targetHost && last.to === host) {
      await signalBlocked(tabId, host, targetHost, settings, error, source);
      return;
    }

    if (chain.length >= settings.maxRedirects) {
      await signalBlocked(tabId, host, targetHost, settings, error, source);
      return;
    }

    chain.push({ from: host, to: targetHost, ts: now, error: error || "", source });
    await setTabState(tabId, { ...state, chain });

    await chrome.tabs.update(tabId, { url: target.url });

    await logEvent({
      type: "redirect",
      ts: now,
      tabId,
      fromHost: host,
      toHost: targetHost,
      target: target.url,
      reason: target.reason,
      error: error || "",
      source
    });

    if (settings.showBadge) void setBadge("⇄");
    if (settings.notifyOnRedirect) {
      notify(
        "GoBingBing 已自动切换",
        host + " 无法访问，已切换到 " + targetHost + "。",
        "redirect:" + host
      );
    }
  } catch (err) {
    console.warn("[GoBingBing] failover failed:", err);
  } finally {
    inFlightTabs.delete(tabId);
  }
}

function planTarget(failedUrl, host, rules) {
  const unwrapped = unwrapRedirector(failedUrl);
  if (unwrapped) return { url: unwrapped, reason: "redirector" };

  const rule = findRule(rules, host);
  if (!rule) return null;

  const url = buildFailoverUrl(failedUrl, rule);
  if (!url) return null;
  return { url, reason: rule.id || "rule" };
}

async function signalBlocked(tabId, fromHost, targetHost, settings, error, source) {
  await logEvent({
    type: "blocked",
    ts: Date.now(),
    tabId,
    fromHost,
    toHost: targetHost,
    error: error || "",
    source
  });
  if (settings.showBadge) void setBadge("!", "#dc2626");
  if (settings.notifyOnBlocked) {
    notify(
      "GoBingBing：切换已中止",
      fromHost + " 与 " + targetHost + " 都无法访问，为避免循环已停止切换。请检查网络或代理。",
      "blocked:" + fromHost + ">" + targetHost
    );
  }
}

/* ------------------------------------------------------------------ */
/* Optional pre-flight probe                                           */
/* ------------------------------------------------------------------ */

async function runPreflight(tabId, url) {
  try {
    const settings = await getSettings();
    if (!settings.enabled || !settings.preflight.enabled) return;

    const host = hostOf(url);
    if (!findRule(settings.rules, host)) return;

    const source = parseUrl(url);
    if (!source || !/^https?:$/.test(source.protocol)) return;

    const pattern = source.origin + "/*";
    const granted = await permissionsContains([pattern]);
    if (!granted) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.preflight.timeoutMs);
    let reachable = false;
    try {
      const response = await fetch(source.href, {
        method: "HEAD",
        mode: "no-cors",
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal
      });
      reachable = Boolean(response);
    } catch {
      reachable = false;
    } finally {
      clearTimeout(timer);
    }

    if (!reachable) {
      await handleFailure(tabId, url, "preflight-unreachable", "preflight");
    }
  } catch {
    // Pre-flight is opportunistic; never let it break navigation.
  }
}

/* ------------------------------------------------------------------ */
/* Manual switch from the popup                                        */
/* ------------------------------------------------------------------ */

async function manualFailover(message) {
  const tabId = message && message.tabId;
  if (!tabId) return { ok: false, error: "no-tab" };

  const settings = await getSettings();
  let url = message.url;
  if (!url) url = await getFrameUrl(tabId);
  if (!url) return { ok: false, error: "no-url" };

  const host = hostOf(url);
  const target = planTarget(url, host, settings.rules);
  let destination = target && target.url;
  if (!destination) {
    const query = extractSearchQuery(url);
    destination = query
      ? "https://cn.bing.com/search?q=" + encodeURIComponent(query)
      : "https://cn.bing.com/";
  }

  const destinationHost = hostOf(destination);
  if (!destinationHost) return { ok: false, error: "bad-target" };

  const now = Date.now();
  await setTabState(tabId, {
    chain: [{ from: host || "manual", to: destinationHost, ts: now, source: "manual" }],
    lastUrl: url,
    lastUrlAt: now
  });
  await chrome.tabs.update(tabId, { url: destination });
  await logEvent({
    type: "manual",
    ts: now,
    tabId,
    fromHost: host || "manual",
    toHost: destinationHost,
    target: destination,
    source: "popup"
  });
  if (settings.showBadge) void setBadge("⇄");
  return { ok: true, target: destination };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return undefined;
  if (message.type === "manual-failover") {
    manualFailover(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  return undefined;
});
