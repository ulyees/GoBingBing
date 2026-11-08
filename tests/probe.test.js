import test from "node:test";
import assert from "node:assert/strict";

import { concreteHost, concreteHosts, resolveTimeout } from "../src/lib/probe.js";

test("literal hosts stay unchanged", () => {
  assert.equal(concreteHost("cn.bing.com"), "cn.bing.com");
  assert.equal(concreteHost("CNN.COM."), "cnn.com");
});

test("wildcard hosts expand to a representative host", () => {
  assert.equal(concreteHost("google.*"), "google.com");
  assert.equal(concreteHost("www.google.*"), "www.google.com");
  assert.equal(concreteHost("*.example.com"), "example.com");
  assert.equal(concreteHost("*"), "");
});

test("concreteHosts de-duplicates and rejects junk", () => {
  const hosts = concreteHosts(["google.*", "www.google.*", "google.com", "", "*", "bad host"]);
  assert.deepEqual(hosts, ["google.com", "www.google.com"]);
  assert.deepEqual(concreteHosts("google.*"), []);
});

test("auto timeout follows the previous latency", () => {
  assert.equal(resolveTimeout("auto", undefined), 4000);
  assert.equal(resolveTimeout("auto", 100), 1500);
  assert.equal(resolveTimeout("auto", 500), 1500);
  assert.equal(resolveTimeout("auto", 1200), 3600);
  assert.equal(resolveTimeout("auto", 10000), 8000);
});

test("explicit timeouts are clamped", () => {
  assert.equal(resolveTimeout(2000, 9999), 2000);
  assert.equal(resolveTimeout(10, 0), 1000);
  assert.equal(resolveTimeout(99999, 0), 15000);
  assert.equal(resolveTimeout("nope", 0), 4000);
});
