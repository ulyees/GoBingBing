import {
  DEFAULT_SETTINGS,
  getSettings,
  normalizeSettings,
  saveSettings
} from "./lib/settings.js";
import { DEFAULT_RULES, findRule } from "./lib/rules.js";
import { buildFailoverUrl, hostOf, parseUrl } from "./lib/url-utils.js";
import { concreteHosts } from "./lib/probe.js";
import { permissionsContains, permissionsRequest } from "./lib/chrome-helpers.js";

const els = {
  status: document.getElementById("status"),
  save: document.getElementById("save"),
  enabled: document.getElementById("enabled"),
  notifyOnRedirect: document.getElementById("notify-on-redirect"),
  notifyOnBlocked: document.getElementById("notify-on-blocked"),
  showBadge: document.getElementById("show-badge"),
  probeOnOpen: document.getElementById("probe-on-open"),
  probeTimeout: document.getElementById("probe-timeout"),
  cooldown: document.getElementById("cooldown"),
  maxRedirects: document.getElementById("max-redirects"),
  preflight: document.getElementById("preflight"),
  preflightTimeout: document.getElementById("preflight-timeout"),
  rules: document.getElementById("rules"),
  addRule: document.getElementById("add-rule"),
  previewUrl: document.getElementById("preview-url"),
  previewBtn: document.getElementById("preview-btn"),
  previewResult: document.getElementById("preview-result"),
  exportBtn: document.getElementById("export"),
  importBtn: document.getElementById("import"),
  importFile: document.getElementById("import-file"),
  grant: document.getElementById("grant"),
  reset: document.getElementById("reset"),
  version: document.getElementById("version")
};

let state = null;
let statusTimer = 0;

init();

async function init() {
  els.version.textContent = "v" + chrome.runtime.getManifest().version;
  state = await getSettings();
  render();

  els.save.addEventListener("click", onSave);
  els.addRule.addEventListener("click", onAddRule);
  els.rules.addEventListener("input", onRuleInput);
  els.rules.addEventListener("change", onRuleInput);
  els.rules.addEventListener("click", onRuleClick);
  els.previewBtn.addEventListener("click", onPreview);
  els.previewUrl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onPreview();
    }
  });
  els.exportBtn.addEventListener("click", onExport);
  els.importBtn.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", onImport);
  els.reset.addEventListener("click", onReset);
  els.grant.addEventListener("click", onGrant);
  els.preflight.addEventListener("change", syncPreflightState);
  els.probeOnOpen.addEventListener("change", syncProbeState);
  syncPreflightState();
  syncProbeState();
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function render() {
  els.enabled.checked = state.enabled;
  els.notifyOnRedirect.checked = state.notifyOnRedirect;
  els.notifyOnBlocked.checked = state.notifyOnBlocked;
  els.showBadge.checked = state.showBadge;
  els.probeOnOpen.checked = state.probe.onOpen;
  const timeout = String(state.probe.timeout);
  if (![...els.probeTimeout.options].some((option) => option.value === timeout)) {
    const custom = document.createElement("option");
    custom.value = timeout;
    custom.textContent =
      timeout === "auto" ? "自动（按上次延迟）" : Math.round(Number(timeout) / 1000) + " 秒（自定义）";
    els.probeTimeout.append(custom);
  }
  els.probeTimeout.value = timeout;
  els.cooldown.value = String(state.cooldownMs);
  els.maxRedirects.value = String(state.maxRedirects);
  els.preflight.checked = state.preflight.enabled;
  els.preflightTimeout.value = String(state.preflight.timeoutMs);
  syncPreflightState();
  syncProbeState();
  renderRules();
}

function syncPreflightState() {
  els.preflightTimeout.disabled = !els.preflight.checked;
}

function syncProbeState() {
  els.probeTimeout.disabled = !els.probeOnOpen.checked;
}

function renderRules() {
  els.rules.textContent = "";
  if (state.rules.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-rules";
    empty.textContent = "还没有任何规则。没有规则时扩展不会自动切换。";
    els.rules.append(empty);
    return;
  }
  state.rules.forEach((rule, index) => {
    els.rules.append(createRuleCard(rule, index, state.rules.length));
  });
}

function createRuleCard(rule, index, total) {
  const card = document.createElement("article");
  card.className = "rule" + (rule.enabled ? "" : " off");
  card.dataset.index = String(index);

  const head = document.createElement("div");
  head.className = "rule-head";

  const switchline = document.createElement("label");
  switchline.className = "switchline";
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.dataset.field = "enabled";
  enabled.checked = rule.enabled;
  switchline.append(enabled, document.createTextNode("启用"));

  const title = document.createElement("input");
  title.type = "text";
  title.className = "rule-title";
  title.dataset.field = "label";
  title.value = rule.label;
  title.placeholder = "规则名称";
  title.spellcheck = false;

  const tools = document.createElement("div");
  tools.className = "rule-tools";
  tools.append(
    iconButton("up", "↑", "上移", index === 0),
    iconButton("down", "↓", "下移", index === total - 1),
    iconButton("delete", "✕", "删除", false, "danger")
  );

  head.append(switchline, title, tools);

  const body = document.createElement("div");
  body.className = "rule-body";

  body.append(
    field("来源域名", "hosts", rule.hosts.join(", "), "google.*, www.google.com"),
    field("切换目标", "to", rule.to, "https://www.bing.com")
  );

  const preserve = document.createElement("label");
  preserve.className = "preserve";
  const preserveInput = document.createElement("input");
  preserveInput.type = "checkbox";
  preserveInput.dataset.field = "preservePath";
  preserveInput.checked = rule.preservePath;
  preserve.append(preserveInput, document.createTextNode("保留原路径与查询参数（同站镜像时使用）"));

  card.append(head, body, preserve);
  return card;
}

function field(labelText, fieldName, value, placeholder) {
  const label = document.createElement("label");
  label.className = "field";

  const text = document.createElement("span");
  text.textContent = labelText;

  const input = document.createElement("input");
  input.type = "text";
  input.dataset.field = fieldName;
  input.value = value;
  input.placeholder = placeholder;
  input.spellcheck = false;

  label.append(text, input);
  return label;
}

function iconButton(action, glyph, title, disabled, extraClass) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-btn" + (extraClass ? " " + extraClass : "");
  button.dataset.action = action;
  button.title = title;
  button.textContent = glyph;
  button.disabled = Boolean(disabled);
  return button;
}

/* ------------------------------------------------------------------ */
/* Rule editing                                                        */
/* ------------------------------------------------------------------ */

function readField(input) {
  const name = input.dataset.field;
  if (name === "hosts") {
    return input.value
      .split(/[,，\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (input.type === "checkbox") return input.checked;
  return input.value;
}

function onRuleInput(event) {
  const input = event.target;
  const card = input.closest && input.closest(".rule");
  if (!card || !input.dataset || !input.dataset.field) return;
  const index = Number(card.dataset.index);
  if (!Number.isInteger(index) || !state.rules[index]) return;

  state.rules[index][input.dataset.field] = readField(input);
  if (input.dataset.field === "enabled") {
    card.classList.toggle("off", !input.checked);
  }
}

function onRuleClick(event) {
  const button = event.target.closest && event.target.closest("button[data-action]");
  if (!button) return;
  const card = button.closest(".rule");
  if (!card) return;
  const index = Number(card.dataset.index);
  if (!Number.isInteger(index) || !state.rules[index]) return;

  const action = button.dataset.action;
  if (action === "delete") {
    state.rules.splice(index, 1);
    renderRules();
  } else if (action === "up" && index > 0) {
    swapRules(index, index - 1);
  } else if (action === "down" && index < state.rules.length - 1) {
    swapRules(index, index + 1);
  }
}

function swapRules(a, b) {
  const list = state.rules;
  const temp = list[a];
  list[a] = list[b];
  list[b] = temp;
  renderRules();
}

function onAddRule() {
  state.rules.push({
    id: "rule-" + Date.now(),
    enabled: true,
    label: "新规则",
    hosts: [],
    to: "https://www.bing.com",
    preservePath: true
  });
  renderRules();
  const inputs = els.rules.querySelectorAll(".rule:last-child .rule-body input");
  if (inputs[0]) inputs[0].focus();
}

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

function collect() {
  return {
    ...state,
    enabled: els.enabled.checked,
    notifyOnRedirect: els.notifyOnRedirect.checked,
    notifyOnBlocked: els.notifyOnBlocked.checked,
    showBadge: els.showBadge.checked,
    cooldownMs: Number(els.cooldown.value),
    maxRedirects: Number(els.maxRedirects.value),
    probe: {
      onOpen: els.probeOnOpen.checked,
      timeout: els.probeTimeout.value === "auto" ? "auto" : Number(els.probeTimeout.value)
    },
    preflight: {
      enabled: els.preflight.checked,
      timeoutMs: Number(els.preflightTimeout.value)
    }
  };
}

function validateRules(rules) {
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    const name = "第 " + (index + 1) + " 条规则";
    if (!Array.isArray(rule.hosts) || rule.hosts.length === 0) {
      return name + "：请填写至少一个来源域名。";
    }
    const target = parseUrl(rule.to);
    if (!target || !/^https?:$/.test(target.protocol)) {
      return name + "：切换目标必须是完整的 http(s) 地址。";
    }
    if (!rule.label || !String(rule.label).trim()) {
      return name + "：请填写规则名称。";
    }
  }
  return "";
}

async function onSave() {
  const candidate = collect();
  const problem = validateRules(candidate.rules);
  if (problem) {
    showStatus(problem, true);
    return;
  }
  const next = normalizeSettings(candidate);
  state = await saveSettings(next);
  render();
  showStatus("已保存");
  onPreview(true);
}

/* ------------------------------------------------------------------ */
/* Preview                                                             */
/* ------------------------------------------------------------------ */

function onPreview(silent) {
  const raw = els.previewUrl.value.trim();
  if (!raw) {
    if (!silent) setPreview("请输入一个网址，例如 https://www.google.com/search?q=deepseek", false);
    return;
  }
  const url = parseUrl(raw);
  if (!url) {
    setPreview("这不是一个完整的网址，请包含 http:// 或 https://。", false);
    return;
  }
  const host = hostOf(url.href);
  const rule = findRule(state.rules, host);
  if (!rule) {
    setPreview("没有匹配的规则：" + host + " 不会被自动切换。", false);
    return;
  }
  const target = buildFailoverUrl(url.href, rule);
  if (!target) {
    setPreview("规则「" + rule.label + "」的目标地址无效。", false);
    return;
  }
  setPreview("匹配「" + rule.label + "」→ 自动前往 " + target, true);
}

function setPreview(message, isTarget) {
  els.previewResult.textContent = "";
  els.previewResult.classList.toggle("is-target", Boolean(isTarget));
  if (isTarget) {
    const [before, after] = message.split("→ 自动前往 ");
    els.previewResult.append(document.createTextNode(before + "→ 自动前往 "));
    const code = document.createElement("strong");
    code.textContent = after;
    els.previewResult.append(code);
  } else {
    els.previewResult.textContent = message;
  }
}

/* ------------------------------------------------------------------ */
/* Import / export / reset                                             */
/* ------------------------------------------------------------------ */

function onExport() {
  const payload = {
    app: "GoBingBing",
    version: chrome.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    settings: collect()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = "gobingbing-settings.json";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  showStatus("已导出配置文件");
}

async function onImport() {
  const file = els.importFile.files && els.importFile.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const raw = parsed && parsed.settings ? parsed.settings : parsed;
    const next = normalizeSettings(raw);
    const problem = validateRules(next.rules);
    if (problem) throw new Error(problem);
    state = await saveSettings(next);
    render();
    showStatus("已导入配置");
  } catch (error) {
    showStatus("导入失败：" + (error && error.message ? error.message : error), true);
  } finally {
    els.importFile.value = "";
  }
}

async function onReset() {
  if (!confirm("确定恢复默认设置？当前规则会被替换。")) return;
  state = await saveSettings({
    ...DEFAULT_SETTINGS,
    rules: DEFAULT_RULES,
    preflight: { ...DEFAULT_SETTINGS.preflight },
    probe: { ...DEFAULT_SETTINGS.probe }
  });
  render();
  showStatus("已恢复默认设置");
}

/* ------------------------------------------------------------------ */
/* Optional host permissions                                           */
/* ------------------------------------------------------------------ */

function collectOrigins() {
  const origins = new Set();
  for (const rule of state.rules) {
    for (const host of concreteHosts(rule.hosts)) {
      origins.add("https://" + host + "/*");
    }
    const target = hostOf(rule.to);
    if (target) origins.add("https://" + target + "/*");
  }
  return [...origins];
}

async function onGrant() {
  const origins = collectOrigins();
  if (origins.length === 0) {
    showStatus("先添加规则，才有需要授权的站点。", true);
    return;
  }
  let granted = await permissionsContains(origins);
  if (!granted) granted = await permissionsRequest(origins);
  showStatus(
    granted ? "已授权 " + origins.length + " 个站点" : "未授权：预检与图标缓存不可用",
    !granted
  );
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

function showStatus(message, isError) {
  clearTimeout(statusTimer);
  els.status.textContent = message;
  els.status.className = "status visible" + (isError ? " error" : "");
  statusTimer = window.setTimeout(() => {
    els.status.classList.remove("visible");
  }, 4500);
}
