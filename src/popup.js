import { getSettings, getEvents, clearEvents, saveSettings } from "./lib/settings.js";
import {
  hostOf,
  hostMatches,
  extractSearchQuery,
  parseUrl
} from "./lib/url-utils.js";
import { findRule } from "./lib/rules.js";
import { getFrameUrl } from "./lib/chrome-helpers.js";
import {
  concreteHosts,
  probeHost,
  resolveTimeout,
  readLatencies,
  saveLatency
} from "./lib/probe.js";
import {
  captureIcon,
  hashHue,
  iconCandidates,
  initialFor,
  readIconCache,
  saveIconEntry
} from "./lib/icons.js";

const els = {
  enabled: document.getElementById("enabled"),
  state: document.getElementById("current-state"),
  currentIcon: document.getElementById("current-icon"),
  host: document.getElementById("current-host"),
  hint: document.getElementById("current-hint"),
  switch: document.getElementById("switch"),
  probeNote: document.getElementById("probe-note"),
  rules: document.getElementById("rules"),
  events: document.getElementById("events"),
  clearLog: document.getElementById("clear-log"),
  options: document.getElementById("options"),
  version: document.getElementById("version")
};

const SVG_NS = "http://www.w3.org/2000/svg";

let settings = null;
let activeTab = null;
let currentUrl = "";
let currentHost = "";
let iconCache = {};
let latencies = {};
let ruleViews = [];
const probeResults = new Map();
const inflight = new Map();
const iconBoxes = new Map();

init();

async function init() {
  els.version.textContent = "v" + chrome.runtime.getManifest().version;

  els.options.addEventListener("click", (event) => {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  els.enabled.addEventListener("change", async () => {
    settings = await saveSettings({ enabled: els.enabled.checked });
    renderCurrent();
  });

  els.clearLog.addEventListener("click", async () => {
    await clearEvents();
    renderEvents([]);
  });

  els.switch.addEventListener("click", manualSwitch);

  settings = await getSettings();
  els.enabled.checked = settings.enabled;
  els.probeNote.textContent = probeLabel();

  const tabsPromise = chrome.tabs.query({ active: true, currentWindow: true });
  [iconCache, latencies] = await Promise.all([readIconCache(), readLatencies()]);

  const tabs = await tabsPromise;
  activeTab = tabs && tabs[0];
  currentUrl = activeTab ? await getFrameUrl(activeTab.id) : "";
  currentHost = hostOf(currentUrl);

  fillIcon(els.currentIcon, currentHost);
  renderCurrent();
  renderRules();
  renderEvents(await getEvents());

  void probeRules();
}

function probeLabel() {
  if (!settings || !settings.probe.onOpen) return "检测已关闭";
  if (settings.probe.timeout === "auto") return "来源延迟 · 自动";
  return "来源延迟 · " + Math.round(settings.probe.timeout / 1000) + "s";
}

function setPill(text, tone) {
  els.state.textContent = text;
  els.state.className = "pill" + (tone ? " " + tone : "");
}

function renderCurrent() {
  if (!settings) return;

  if (!currentHost) {
    els.host.textContent = "—";
    els.currentIcon.hidden = true;
    els.hint.textContent = "当前页面不是普通网页，没有可用的切换规则。";
    els.switch.disabled = true;
    els.switch.textContent = "切换到 Bing";
    setPill("不支持", "off");
    return;
  }

  els.currentIcon.hidden = false;
  els.host.textContent = currentHost;

  const rule = findRule(settings.rules, currentHost);
  const targetHost = rule ? hostOf(rule.to) : "";

  if (!settings.enabled) {
    setPill("已暂停", "off");
    els.hint.textContent = "自动切换已暂停，可用右上角开关重新开启。";
  } else if (rule) {
    const result = probeResults.get(currentHost);
    if (settings.probe.onOpen && !result) {
      setPill("检测中…", "warn");
      els.hint.textContent = "正在检测 " + currentHost + " 是否可以打开…";
    } else if (result && !result.ok) {
      setPill("将切换", "bad");
      els.hint.textContent = "当前域名打不开，访问时会自动切换到 " + targetHost + "。";
    } else if (result && result.ok) {
      setPill("可访问", "ok");
      els.hint.textContent = "若 " + currentHost + " 无法访问，会自动前往 " + targetHost + "。";
    } else {
      setPill("有可用规则", "ok");
      els.hint.textContent = "若无法访问，将自动前往 " + targetHost + "。";
    }
  } else {
    setPill("无匹配规则", "warn");
    els.hint.textContent = "可在设置中为 " + currentHost + " 添加一条切换规则。";
  }

  const hasQuery = Boolean(extractSearchQuery(currentUrl));
  els.switch.disabled = !(rule || hasQuery);
  els.switch.textContent = rule ? "切换到 " + targetHost : "用 Bing 搜索";

  if (!rule && !hasQuery && parseUrl(currentUrl)) {
    els.hint.textContent = "当前页面没有搜索词，也没有匹配的规则。";
    els.switch.disabled = true;
  }
}

/* --- Rule list with icons and arrows ------------------------------------ */

function hostsForRule(rule) {
  const hosts = concreteHosts(rule.hosts);
  if (
    currentHost &&
    rule.enabled &&
    rule.hosts.some((pattern) => hostMatches(pattern, currentHost)) &&
    !hosts.includes(currentHost)
  ) {
    hosts.unshift(currentHost);
  }
  return hosts.slice(0, 4);
}

function renderRules() {
  els.rules.textContent = "";
  ruleViews = [];

  if (!settings.rules.length) {
    const empty = document.createElement("li");
    empty.className = "rule-row empty-row";
    empty.textContent = "还没有规则，去设置里添加一条吧。";
    els.rules.append(empty);
    return;
  }

  for (const rule of settings.rules) {
    const view = buildRuleRow(rule);
    ruleViews.push(view);
    els.rules.append(view.li);
  }
}

function buildRuleRow(rule) {
  const hosts = hostsForRule(rule);
  const targetHost = hostOf(rule.to);
  const displayHost = hosts[0] || rule.hosts[0] || "?";

  const li = document.createElement("li");
  li.className = "rule-row";
  if (currentHost && rule.hosts.some((pattern) => hostMatches(pattern, currentHost))) {
    li.classList.add("current-rule");
  }

  const source = document.createElement("div");
  source.className = "endpoint source";

  const sourceMeta = document.createElement("div");
  sourceMeta.className = "endpoint-meta";
  const sourceName = document.createElement("strong");
  sourceName.className = "endpoint-host";
  sourceName.textContent = displayHost;
  if (hosts.length > 1) {
    const more = document.createElement("span");
    more.className = "more";
    more.textContent = " +" + (hosts.length - 1);
    sourceName.append(more);
  }
  const status = document.createElement("em");
  status.className = "status";
  sourceMeta.append(sourceName, status);
  source.append(createIcon(displayHost), sourceMeta);

  const arrowBox = document.createElement("div");
  arrowBox.className = "arrow-box";
  const arrowNote = document.createElement("span");
  arrowNote.className = "arrow-note";
  arrowBox.append(createArrow(), arrowNote);

  const target = document.createElement("div");
  target.className = "endpoint target";
  const targetMeta = document.createElement("div");
  targetMeta.className = "endpoint-meta";
  const targetName = document.createElement("strong");
  targetName.className = "endpoint-host";
  targetName.textContent = targetHost || "未设置";
  const targetHint = document.createElement("em");
  targetHint.className = "status";
  targetHint.textContent = "替换目标";
  targetMeta.append(targetName, targetHint);
  target.append(targetMeta, createIcon(targetHost));

  li.append(source, arrowBox, target);

  let initialState = "pending";
  let initialText = "检测中…";
  if (!rule.enabled) {
    initialState = "off";
    initialText = "已停用";
  } else if (!settings.probe.onOpen) {
    initialState = "idle";
    initialText = "未检测";
  } else if (!hosts.length) {
    initialState = "idle";
    initialText = "无可检测域名";
  }
  li.classList.add(initialState);
  status.classList.add(initialState);
  status.textContent = initialText;

  li.title = [
    rule.label || rule.id,
    "来源: " + (hosts.join("、") || "—"),
    "替换: " + (targetHost || "—")
  ].join("\n");

  return { li, rule, hosts, status, arrowNote };
}

function createArrow() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 46 16");
  svg.setAttribute("class", "arrow");
  svg.setAttribute("aria-hidden", "true");

  const shaft = document.createElementNS(SVG_NS, "path");
  shaft.setAttribute("d", "M3 8 H33");
  shaft.setAttribute("class", "shaft");

  const head = document.createElementNS(SVG_NS, "path");
  head.setAttribute("d", "M33 2 L44 8 L33 14 Z");
  head.setAttribute("class", "head");

  svg.append(shaft, head);
  return svg;
}

async function probeRules() {
  if (!settings.probe.onOpen) return;

  const tasks = [];
  for (const view of ruleViews) {
    if (!view.rule.enabled || view.hosts.length === 0) continue;
    tasks.push(
      Promise.all(
        view.hosts.map((host) => {
          let promise = inflight.get(host);
          if (!promise) {
            promise = probeOne(host);
            inflight.set(host, promise);
          }
          return promise;
        })
      ).then((results) => {
        updateRuleView(view, results);
        renderCurrent();
      })
    );
  }
  await Promise.all(tasks);
}

async function probeOne(host) {
  const timeout = resolveTimeout(settings.probe.timeout, latencies[host] && latencies[host].ms);
  const result = await probeHost(host, timeout);
  probeResults.set(host, result);

  if (result.ok) {
    latencies[host] = { ms: result.ms, at: Date.now() };
    void saveLatency(host, result.ms);
    if (!iconCache[host] || !iconCache[host].dataUrl) {
      void captureIcon(host).then((dataUrl) => {
        if (!dataUrl) return;
        iconCache[host] = { ...(iconCache[host] || {}), dataUrl, at: Date.now() };
        for (const box of iconBoxes.get(host) || []) fillIcon(box, host);
      });
    }
  }
  return result;
}

function updateRuleView(view, results) {
  const { li, rule, hosts, status, arrowNote } = view;
  const reachable = results.filter((result) => result.ok);
  const details = hosts
    .map((host, index) => {
      const result = results[index];
      return host + (result.ok ? " " + result.ms + " ms" : " 打不开");
    })
    .join(" · ");

  let state;
  let text;
  let note;

  if (!rule.enabled) {
    state = "off";
    text = "已停用";
    note = "";
  } else if (reachable.length === hosts.length) {
    const best = Math.min(...reachable.map((result) => result.ms));
    state = "ok";
    text = "可访问 · " + best + " ms";
    note = "正常";
  } else if (reachable.length > 0) {
    state = "partial";
    text = "部分可达 " + reachable.length + "/" + hosts.length;
    note = "部分";
  } else {
    state = "fail";
    text = "打不开 · 将切换";
    note = "切换";
  }

  li.classList.remove("pending", "ok", "partial", "fail", "idle", "off");
  li.classList.add(state);
  status.className = "status " + state;
  status.textContent = text;
  arrowNote.textContent = note;
  li.title = [
    rule.label || rule.id,
    "来源: " + details,
    "替换: " + hostOf(rule.to)
  ].join("\n");
}

/* --- Icons -------------------------------------------------------------- */

function fillIcon(box, host) {
  box.replaceChildren();
  box.classList.remove("has-icon");
  box.style.setProperty("--hue", String(hashHue(host)));

  if (!host) {
    box.textContent = "?";
    return;
  }

  let boxes = iconBoxes.get(host);
  if (!boxes) {
    boxes = new Set();
    iconBoxes.set(host, boxes);
  }
  boxes.add(box);

  const letter = document.createElement("span");
  letter.className = "letter";
  letter.textContent = initialFor(host);
  box.append(letter);

  const candidates = iconCandidates(host, iconCache[host]);
  if (candidates.length === 0) return;

  const img = document.createElement("img");
  img.alt = "";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";

  let index = 0;
  let loaded = false;

  const next = () => {
    if (loaded) return;
    if (index >= candidates.length) {
      img.remove();
      return;
    }
    img.src = candidates[index++];
  };

  img.addEventListener("load", () => {
    if (loaded) return;
    loaded = true;
    box.classList.add("has-icon");
    const source = img.currentSrc || img.src;
    if (source && !source.startsWith("data:") && (!iconCache[host] || iconCache[host].url !== source)) {
      iconCache[host] = { ...(iconCache[host] || {}), ok: true, url: source, at: Date.now() };
      void saveIconEntry(host, { ok: true, url: source });
    }
  });
  img.addEventListener("error", () => {
    if (!loaded) next();
  });

  box.append(img);
  next();
}

function createIcon(host) {
  const box = document.createElement("span");
  box.className = "icon";
  box.setAttribute("aria-hidden", "true");
  fillIcon(box, host);
  return box;
}

/* --- Manual switch ------------------------------------------------------ */

async function manualSwitch() {
  if (!activeTab) return;
  els.switch.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: "manual-failover",
      tabId: activeTab.id,
      url: currentUrl
    });
    if (result && result.ok) {
      setPill("已切换", "ok");
      setTimeout(() => window.close(), 350);
    } else {
      els.hint.textContent = "切换失败：" + ((result && result.error) || "未知原因");
      els.switch.disabled = false;
    }
  } catch (error) {
    els.hint.textContent = "切换失败：" + String(error);
    els.switch.disabled = false;
  }
}

/* --- Event log ---------------------------------------------------------- */

function describeEvent(event) {
  if (!event) return "";
  switch (event.type) {
    case "redirect":
      return event.fromHost + " → " + event.toHost + "（自动）";
    case "manual":
      return event.fromHost + " → " + event.toHost + "（手动）";
    case "blocked":
      return event.fromHost + " ⇄ " + event.toHost + "，已中止";
    default:
      return event.message || event.type || "";
  }
}

function renderEvents(events) {
  els.events.textContent = "";
  if (!Array.isArray(events) || events.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "暂无记录";
    els.events.append(empty);
    return;
  }

  const limit = Math.min(settings && settings.logLimit ? settings.logLimit : 6, 6);
  for (const event of events.slice(0, limit)) {
    const li = document.createElement("li");

    const time = document.createElement("span");
    time.className = "time";
    time.textContent = formatTime(event.ts);

    const what = document.createElement("span");
    what.className = "what";
    what.textContent = describeEvent(event);

    li.append(time, what);
    els.events.append(li);
  }
}

function formatTime(timestamp) {
  if (!timestamp) return "--:--";
  const date = new Date(timestamp);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
