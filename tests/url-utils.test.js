import test from "node:test";
import assert from "node:assert/strict";

import {
  hostMatches,
  hostOf,
  isGoogleHost,
  extractSearchQuery,
  unwrapRedirector,
  buildFailoverUrl,
  queryParamFor
} from "../src/lib/url-utils.js";
import { DEFAULT_RULES, findRule, sanitizeRules } from "../src/lib/rules.js";

const ruleById = (id) => DEFAULT_RULES.find((rule) => rule.id === id);

test("hostMatches handles exact hosts, suffixes and wildcards", () => {
  assert.equal(hostMatches("cn.bing.com", "cn.bing.com"), true);
  assert.equal(hostMatches("cn.bing.com", "www.bing.com"), false);
  assert.equal(hostMatches("google.*", "google.com"), true);
  assert.equal(hostMatches("google.*", "google.com.hk"), true);
  assert.equal(hostMatches("google.*", "www.google.com"), false);
  assert.equal(hostMatches("www.google.*", "www.google.com"), true);
  assert.equal(hostMatches("*.bing.com", "cn.bing.com"), true);
  assert.equal(hostMatches("*.bing.com", "bing.com"), true);
  assert.equal(hostMatches("*.bing.com", "notbing.com"), false);
  assert.equal(hostMatches("*", "anything.example"), true);
  assert.equal(hostMatches("google.*", ""), false);
});

test("hostOf normalises input", () => {
  assert.equal(hostOf("HTTPS://WWW.Google.COM/path"), "www.google.com");
  assert.equal(hostOf("not a url"), "");
});

test("isGoogleHost covers country domains only", () => {
  assert.equal(isGoogleHost("google.com"), true);
  assert.equal(isGoogleHost("www.google.com.hk"), true);
  assert.equal(isGoogleHost("mail.google.com"), false);
  assert.equal(isGoogleHost("googleusercontent.com"), false);
  assert.equal(isGoogleHost("bing.com"), false);
});

test("extractSearchQuery reads query strings and hashes", () => {
  assert.equal(extractSearchQuery("https://www.google.com/search?q=deepseek"), "deepseek");
  assert.equal(extractSearchQuery("https://www.bing.com/search?q=hello%20world"), "hello world");
  assert.equal(extractSearchQuery("https://www.baidu.com/s?wd=%E6%B7%B1%E5%BA%A6"), "深度");
  assert.equal(extractSearchQuery("https://example.com/#q=hash+query"), "hash query");
  assert.equal(extractSearchQuery("https://example.com/"), null);
});

test("Google search fails over to Bing with the query preserved", () => {
  const target = buildFailoverUrl(
    "https://www.google.com/search?q=deepseek&hl=zh-CN",
    ruleById("google-to-bing")
  );
  assert.equal(target, "https://cn.bing.com/search?q=deepseek");
});

test("non-ASCII queries stay correctly encoded", () => {
  const target = buildFailoverUrl(
    "https://www.google.com/search?q=%E6%B7%B1%E5%BA%A6%E6%B1%82%E7%B4%A2",
    ruleById("google-to-bing")
  );
  assert.equal(new URL(target).searchParams.get("q"), "深度求索");
});

test("Google image search maps to the Bing images vertical", () => {
  const target = buildFailoverUrl(
    "https://www.google.com/search?tbm=isch&q=cat",
    ruleById("google-to-bing")
  );
  assert.equal(target, "https://cn.bing.com/images/search?q=cat");
});

test("non-search Google pages fall back to the Bing root", () => {
  const target = buildFailoverUrl("https://www.google.com/maps/place/x", ruleById("google-to-bing"));
  assert.equal(target, "https://cn.bing.com/");
});

test("cn.bing.com keeps path and query when moving to bing.com", () => {
  const target = buildFailoverUrl(
    "https://cn.bing.com/search?q=hello&form=QBLH",
    ruleById("cnbing-to-bing")
  );
  assert.equal(target, "https://www.bing.com/search?q=hello&form=QBLH");
  assert.equal(
    buildFailoverUrl("https://cn.bing.com/", ruleById("cnbing-to-bing")),
    "https://www.bing.com/"
  );
});

test("google /url redirect wrappers are unwrapped", () => {
  const wrapped = "https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&sa=D";
  assert.equal(unwrapRedirector(wrapped), "https://example.com/a?b=1");
  assert.equal(unwrapRedirector("https://www.google.com/url?q=/relative"), null);
  assert.equal(unwrapRedirector("https://example.com/url?q=https://example.com"), null);
});

test("findRule resolves the default rules in order", () => {
  assert.equal(findRule(DEFAULT_RULES, "www.google.com").id, "google-to-bing");
  assert.equal(findRule(DEFAULT_RULES, "google.com.hk").id, "google-to-bing");
  assert.equal(findRule(DEFAULT_RULES, "cn.bing.com").id, "cnbing-to-bing");
  assert.equal(findRule(DEFAULT_RULES, "www.bing.com"), null);
  assert.equal(findRule(DEFAULT_RULES, "mail.google.com"), null);
});

test("disabled rules are skipped", () => {
  const rules = DEFAULT_RULES.map((rule) =>
    rule.id === "google-to-bing" ? { ...rule, enabled: false } : rule
  );
  assert.equal(findRule(rules, "www.google.com"), null);
});

test("queryParamFor knows Baidu and Sogou", () => {
  assert.equal(queryParamFor("www.bing.com"), "q");
  assert.equal(queryParamFor("www.baidu.com"), "wd");
  assert.equal(queryParamFor("www.sogou.com"), "query");
});

test("invalid inputs return null instead of throwing", () => {
  assert.equal(buildFailoverUrl("not a url", ruleById("google-to-bing")), null);
  assert.equal(buildFailoverUrl("https://www.google.com", { to: "not a url" }), null);
});

test("sanitizeRules drops rules without hosts or a valid target", () => {
  const cleaned = sanitizeRules([
    { hosts: ["a.com"], to: "https://b.com" },
    { hosts: [], to: "https://b.com" },
    { hosts: ["c.com"], to: "javascript:alert(1)" }
  ]);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].to, "https://b.com/");
  assert.equal(sanitizeRules("nope"), null);
});
