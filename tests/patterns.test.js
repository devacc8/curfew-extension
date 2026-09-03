import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePattern,
  patternToString,
  matchesHost,
  toMatchOrigins,
  toDnrCondition,
} from "../src/common/patterns.js";

test("parsePattern accepts exact and wildcard forms", () => {
  assert.deepEqual(parsePattern("x.com").pattern, { wildcard: false, host: "x.com" });
  assert.deepEqual(parsePattern("*.x.com").pattern, { wildcard: true, host: "x.com" });
});

test("parsePattern normalizes case, whitespace and trailing dot", () => {
  const r = parsePattern("  *.Reddit.COM.  ");
  assert.equal(r.ok, true);
  assert.equal(patternToString(r.pattern), "*.reddit.com");
});

test("parsePattern normalizes pasted URLs (scheme, path, port, hash)", () => {
  const cases = [
    ["x.com", { wildcard: false, host: "x.com" }],
    ["https://x.com", { wildcard: false, host: "x.com" }],
    ["http://x.com/path", { wildcard: false, host: "x.com" }],
    ["https://www.x.com/feed?q=1#top", { wildcard: false, host: "www.x.com" }],
    ["https://x.com:8080", { wildcard: false, host: "x.com" }],
    ["*://*.reddit.com/*", { wildcard: true, host: "reddit.com" }],
    ["https://*.reddit.com/", { wildcard: true, host: "reddit.com" }],
  ];
  for (const [input, expected] of cases) {
    const r = parsePattern(input);
    assert.equal(r.ok, true, `expected accept: ${input}`);
    assert.deepEqual(r.pattern, expected, `wrong host for: ${input}`);
  }
});

test("parsePattern rejects bad hosts", () => {
  const bad = [
    "localhost",
    "*.localhost",
    "x.com..",
    "-x.com",
    "x-.com",
    "*.com",
    "",
    "https://",
    null,
    undefined,
    42,
  ];
  for (const input of bad) {
    assert.equal(parsePattern(input).ok, false, `expected reject: ${String(input)}`);
  }
});

test("parsePattern rejects unicode (punycode required in v1)", () => {
  assert.equal(parsePattern("пример.рф").ok, false);
});

test("matchesHost: wildcard covers apex and subdomains", () => {
  const p = parsePattern("*.reddit.com").pattern;
  assert.equal(matchesHost(p, "reddit.com"), true);
  assert.equal(matchesHost(p, "www.reddit.com"), true);
  assert.equal(matchesHost(p, "a.b.reddit.com"), true);
  assert.equal(matchesHost(p, "notreddit.com"), false);
  assert.equal(matchesHost(p, "badreddit.com"), false);
  assert.equal(matchesHost(p, "reddit.com.evil.example"), false);
});

test("matchesHost: exact covers apex only", () => {
  const p = parsePattern("x.com").pattern;
  assert.equal(matchesHost(p, "x.com"), true);
  assert.equal(matchesHost(p, "www.x.com"), false);
  assert.equal(matchesHost(p, "x.com.evil.example"), false);
});

test("matchesHost handles FQDN trailing dot and case", () => {
  const p = parsePattern("x.com").pattern;
  assert.equal(matchesHost(p, "X.COM."), true);
});

test("matchesHost rejects malformed host input", () => {
  const p = parsePattern("x.com").pattern;
  assert.equal(matchesHost(p, "not a host"), false);
  assert.equal(matchesHost(p, null), false);
  assert.equal(matchesHost(p, 42), false);
});

test("matchesHost: wildcard is suffix-safe against label collisions", () => {
  const p = parsePattern("*.x.company").pattern;
  assert.equal(matchesHost(p, "x.company"), true);
  assert.equal(matchesHost(p, "a.x.company"), true);
  assert.equal(matchesHost(p, "x.company.example"), false);
});

test("toMatchOrigins maps to browser match-patterns", () => {
  const wildcard = parsePattern("*.reddit.com").pattern;
  assert.deepEqual(toMatchOrigins(wildcard), ["*://*.reddit.com/*"]);

  const exact = parsePattern("x.com").pattern;
  assert.deepEqual(toMatchOrigins(exact), ["*://x.com/*"]);
});

test("toDnrCondition: wildcard becomes an anchored urlFilter", () => {
  const p = parsePattern("*.reddit.com").pattern;
  assert.deepEqual(toDnrCondition(p), { urlFilter: "||reddit.com/" });
});

test("toDnrCondition: exact becomes an escaped regexFilter", () => {
  const p = parsePattern("x.com").pattern;
  const cond = toDnrCondition(p);
  assert.deepEqual(cond, { regexFilter: "^https?://x\\.com/" });

  const re = new RegExp(cond.regexFilter);
  assert.equal(re.test("https://x.com/"), true);
  assert.equal(re.test("http://x.com/"), true);
  assert.equal(re.test("https://www.x.com/"), false);
  assert.equal(re.test("https://x.com.evil.example/"), false);
  assert.equal(re.test("https://evil.example/?u=https://x.com/"), false);
});

test("toDnrCondition: exact survives dot-bearing TLD collisions", () => {
  const p = parsePattern("x.company").pattern;
  const cond = toDnrCondition(p);
  const re = new RegExp(cond.regexFilter);
  assert.equal(re.test("https://x.company/"), true);
  assert.equal(re.test("https://x.company.example/"), false);
});
