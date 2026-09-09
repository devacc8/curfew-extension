import { test } from "node:test";
import assert from "node:assert/strict";
import { dayKey } from "../src/common/time.js";
import { encodeExport, decodeExport, pruneDays } from "../src/common/transfer.js";
import { desiredRules } from "../src/common/rules.js";

const STATE = {
  schema: 1,
  config: {
    masterEnabled: true,
    graceSeconds: 10,
    unblockMinutes: 15,
    unblockPassesPerDay: 2,
    items: [
      {
        id: "u1",
        ruleId: 1001,
        pattern: "*.reddit.com",
        budgetMinutes: 30,
        enabled: true,
        access: "granted",
      },
    ],
  },
  usage: {
    days: {
      "2026-09-01": {
        patternSeconds: { "*.reddit.com": 600 },
        unblocks: {},
        bySite: { "reddit.com": 600 },
      },
    },
  },
  session: { pattern: "*.reddit.com", phase: "counting", phaseStartedAt: 1, lastTickAt: 2 },
  runtime: {
    unblockUntil: { "*.reddit.com": 999 },
    dayOverrides: { "*.reddit.com": { day: "2026-09-01", action: "block" } },
  },
  settings: { version: 1, itemSeq: 1001, protection: null },
};

test("encode -> decode round-trips config and usage", () => {
  const decoded = decodeExport(encodeExport(STATE, "2026-09-02T12:00:00Z"));
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.state.config, STATE.config);
  assert.deepEqual(decoded.state.usage, STATE.usage);
  assert.deepEqual(decoded.state.settings, STATE.settings);
});

test("decode strips machine-local fields (session, runtime)", () => {
  const decoded = decodeExport(encodeExport(STATE, "2026-09-02T12:00:00Z"));
  assert.equal(decoded.state.session, null);
  assert.deepEqual(decoded.state.runtime, {
    unblockUntil: {},
    dayOverrides: {},
  });
});

test("decode rejects junk", () => {
  for (const bad of [
    "not json",
    "{}",
    JSON.stringify({ kind: "other", version: 1, state: {} }),
    JSON.stringify({ kind: "curfew-export", version: 2, state: {} }),
    JSON.stringify({ kind: "curfew-export", version: 1 }),
    "[]",
    "null",
  ]) {
    assert.equal(decodeExport(bad).ok, false, `expected reject: ${bad}`);
  }
});

test("decode resolves a state written by a newer schema to current defaults", () => {
  const future = { ...STATE, schema: 99 };
  const decoded = decodeExport(encodeExport(future, "2026-09-02T12:00:00Z"));
  assert.equal(decoded.ok, true);
  assert.equal(decoded.state.schema, 1);
  assert.deepEqual(decoded.state.config.items, []);
});

test("decode sanitizes a hostile payload so consumers cannot throw", () => {
  // A hand-edited export used to reach the state document as-is and make
  // `for (const item of state.config.items)` throw on every tick.
  const hostile = JSON.stringify({
    kind: "curfew-export",
    version: 1,
    state: { schema: 1, config: { items: {} }, usage: { days: [] } },
  });
  const decoded = decodeExport(hostile);
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.state.config.items, []);
  assert.deepEqual(decoded.state.usage.days, {});
  assert.doesNotThrow(() =>
    desiredRules(decoded.state, { day: "2026-09-02", nowMs: 0, blockedPageFor: () => "/b" })
  );
});

test("pruneDays keeps only the newest rows", () => {
  const days = {};
  const start = new Date(2026, 6, 1);
  for (let d = 0; d < 70; d++) {
    const date = new Date(start);
    date.setDate(date.getDate() + d);
    days[dayKey(date)] = { patternSeconds: {} };
  }
  const state = { usage: { days } };
  pruneDays(state, 60);
  const keys = Object.keys(state.usage.days);
  assert.equal(keys.length, 60);
  const first = new Date(start);
  first.setDate(first.getDate() + 10);
  const last = new Date(start);
  last.setDate(last.getDate() + 69);
  assert.equal(keys[0], dayKey(first));
  assert.equal(keys[59], dayKey(last));
});

test("pruneDays is a no-op under the limit", () => {
  const state = { usage: { days: { "2026-09-01": { patternSeconds: {} } } } };
  pruneDays(state, 60);
  assert.deepEqual(Object.keys(state.usage.days), ["2026-09-01"]);
});
