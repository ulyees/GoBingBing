import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SETTINGS,
  normalizeProbeTimeout,
  normalizeSettings
} from "../src/lib/settings.js";
import { DEFAULT_RULES } from "../src/lib/rules.js";

test("empty rule lists are preserved (auto failover can be disabled)", () => {
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, rules: [] });
  assert.deepEqual(settings.rules, []);
});

test("missing or corrupt rules fall back to defaults", () => {
  assert.equal(normalizeSettings({}).rules.length, 2);
  assert.equal(normalizeSettings({ rules: "broken" }).rules.length, 2);
});

test("default rules are copied so edits cannot mutate the constants", () => {
  const settings = normalizeSettings({});
  settings.rules[0].to = "https://example.com/";
  settings.rules[0].hosts.push("example.com");
  assert.equal(DEFAULT_RULES[0].to, "https://cn.bing.com");
  assert.deepEqual(DEFAULT_RULES[0].hosts, ["google.*", "www.google.*"]);
});

test("numeric settings are clamped to safe ranges", () => {
  const settings = normalizeSettings({
    ...DEFAULT_SETTINGS,
    cooldownMs: 1,
    windowMs: 99999999,
    maxRedirects: 99,
    logLimit: 0,
    preflight: { enabled: true, timeoutMs: 10 }
  });
  assert.equal(settings.cooldownMs, 500);
  assert.equal(settings.windowMs, 600000);
  assert.equal(settings.maxRedirects, 10);
  assert.equal(settings.logLimit, 10);
  assert.equal(settings.preflight.enabled, true);
  assert.equal(settings.preflight.timeoutMs, 800);
});

test("booleans default to enabled behaviour", () => {
  const settings = normalizeSettings({});
  assert.equal(settings.enabled, true);
  assert.equal(settings.notifyOnRedirect, true);
  assert.equal(settings.showBadge, true);
  assert.equal(settings.preflight.enabled, false);
});

test("popup probing defaults to on with an automatic timeout", () => {
  const settings = normalizeSettings({});
  assert.equal(settings.probe.onOpen, true);
  assert.equal(settings.probe.timeout, "auto");
});

test("popup probing can be disabled and its timeout normalised", () => {
  const disabled = normalizeSettings({ probe: { onOpen: false, timeout: 3000 } });
  assert.equal(disabled.probe.onOpen, false);
  assert.equal(disabled.probe.timeout, 3000);

  assert.equal(normalizeProbeTimeout("auto"), "auto");
  assert.equal(normalizeProbeTimeout("2500"), 2500);
  assert.equal(normalizeProbeTimeout(10), 1000);
  assert.equal(normalizeProbeTimeout(99999), 15000);
  assert.equal(normalizeProbeTimeout("junk"), "auto");
});
