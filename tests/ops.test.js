import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOp } from "../src/common/ops.js";
import { migrate } from "../src/common/storage.js";

/** A fresh default document, exactly as `load()` would seed it. */
const base = () => migrate({});

test("applyOp: unknown op throws (a programming error, not user input)", () => {
  assert.throws(() => applyOp(base(), "nope", {}), /unknown state op/);
});

test("item.add creates, returns identity and clamps the budget", () => {
  const state = base();
  const created = applyOp(state, "item.add", {
    pattern: "x.com",
    budgetMinutes: 5000,
    access: "denied",
  });
  assert.equal(created.pattern, "x.com");
  assert.match(created.id, /^u/);
  assert.equal(created.ruleId, 1001);
  assert.equal(state.config.items.length, 1);
  assert.equal(state.config.items[0].budgetMinutes, 1440);
  assert.equal(state.config.items[0].access, "denied");
});

test("item.add dedupes by pattern and keeps identity", () => {
  const state = base();
  const first = applyOp(state, "item.add", { pattern: "x.com", budgetMinutes: 10 });
  const second = applyOp(state, "item.add", {
    pattern: "x.com",
    budgetMinutes: 20,
    access: "denied",
  });
  assert.equal(second.id, first.id);
  assert.equal(second.ruleId, first.ruleId);
  assert.equal(state.config.items.length, 1);
  assert.equal(state.config.items[0].budgetMinutes, 20);
});

test("item.update patches only the addressable fields", () => {
  const state = base();
  const { id } = applyOp(state, "item.add", { pattern: "x.com", budgetMinutes: 10 });
  applyOp(state, "item.update", {
    id,
    fields: { enabled: false, budgetMinutes: 45, access: "granted", pattern: "evil.com" },
  });
  const item = state.config.items[0];
  assert.equal(item.enabled, false);
  assert.equal(item.budgetMinutes, 45);
  assert.equal(item.access, "granted");
  assert.equal(item.pattern, "x.com");
  assert.deepEqual(applyOp(state, "item.update", { id: "nope", fields: { enabled: true } }), {
    updated: false,
  });
});

test("item.accessBatch skips unknown grants and counts real changes", () => {
  const state = base();
  const a = applyOp(state, "item.add", { pattern: "a.com", budgetMinutes: 5 });
  const b = applyOp(state, "item.add", { pattern: "b.com", budgetMinutes: 5 });
  const result = applyOp(state, "item.accessBatch", {
    entries: [
      { id: a.id, granted: true },
      { id: b.id, granted: null },
      { id: "missing", granted: true },
      { id: a.id, granted: true },
    ],
  });
  assert.equal(result.changed, 1);
  assert.equal(state.config.items[0].access, "granted");
  assert.equal(state.config.items[1].access, "denied"); // null grant keeps the flag
});

test("item.remove deletes by id and reports whether anything went", () => {
  const state = base();
  const { id } = applyOp(state, "item.add", { pattern: "x.com", budgetMinutes: 5 });
  assert.deepEqual(applyOp(state, "item.remove", { id }), { removed: true });
  assert.deepEqual(applyOp(state, "item.remove", { id }), { removed: false });
  assert.deepEqual(state.config.items, []);
});

test("master.set coerces to boolean", () => {
  const state = base();
  assert.deepEqual(applyOp(state, "master.set", { value: 0 }), { value: false });
  assert.equal(state.config.masterEnabled, false);
  assert.deepEqual(applyOp(state, "master.set", { value: "yes" }), { value: true });
});

test("passes.set clamps into 0..99 and survives junk", () => {
  const state = base();
  assert.equal(applyOp(state, "passes.set", { value: 500 }).value, 99);
  assert.equal(applyOp(state, "passes.set", { value: -3 }).value, 0);
  assert.equal(applyOp(state, "passes.set", { value: "abc" }).value, 0);
  assert.equal(applyOp(state, "passes.set", { value: 2.6 }).value, 3);
});

test("protection.set stores a config and nulls it out", () => {
  const state = base();
  applyOp(state, "protection.set", { value: { kind: "equation" } });
  assert.deepEqual(state.settings.protection, { kind: "equation" });
  applyOp(state, "protection.set", { value: null });
  assert.equal(state.settings.protection, null);
});

test("state.import migrates the payload and prunes old days", () => {
  const state = base();
  const days = {};
  for (let i = 0; i < 61; i++) {
    const key = `2026-01-${String(i + 1).padStart(2, "0")}`;
    days[key] = { patternSeconds: {}, passes: {}, bySite: {} };
  }
  const result = applyOp(state, "state.import", {
    imported: { schema: 1, config: { items: [{ id: "u1", pattern: "a.com" }] }, usage: { days } },
  });
  assert.equal(result.items, 1);
  assert.equal(Object.keys(state.usage.days).length, 60);
  assert.equal(state.config.graceSeconds, 10); // migrate filled defaults
  assert.equal(state.session, null);
});

test("item.update patches the anti-scroll fields too", () => {
  const state = base();
  const { id } = applyOp(state, "item.add", { pattern: "x.com", budgetMinutes: 10 });
  applyOp(state, "item.update", {
    id,
    fields: { sessionLimitMinutes: 10, cooldownMinutes: 5 },
  });
  assert.equal(state.config.items[0].sessionLimitMinutes, 10);
  assert.equal(state.config.items[0].cooldownMinutes, 5);
  applyOp(state, "item.update", { id, fields: { sessionLimitMinutes: -4 } });
  assert.equal(state.config.items[0].sessionLimitMinutes, 0);
});

test("theme.set accepts the two explicit choices and defaults to system", () => {
  const state = base();
  assert.deepEqual(applyOp(state, "theme.set", { value: "light" }), { value: "light" });
  assert.equal(state.settings.theme, "light");
  applyOp(state, "theme.set", { value: "dark" });
  assert.equal(state.settings.theme, "dark");
  applyOp(state, "theme.set", { value: "neon" });
  assert.equal(state.settings.theme, "system");
});
