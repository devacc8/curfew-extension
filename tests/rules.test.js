import { test } from "node:test";
import assert from "node:assert/strict";
import { isOpen, desiredRules, resolvePassRequest } from "../src/common/rules.js";
import { passesUsedToday } from "../src/common/budget.js";

const DAY = "2026-09-02";
const NOW = 1000;

function state(over = {}) {
  return {
    config: {
      masterEnabled: true,
      unblockMinutes: 15,
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
    usage: { days: {} },
    runtime: { unblockUntil: {}, dayOverrides: {} },
    ...over,
  };
}

const used = (sec) => ({
  usage: {
    days: {
      [DAY]: {
        patternSeconds: { "*.reddit.com": sec },
        unblocks: {},
        bySite: { "reddit.com": sec },
      },
    },
  },
});

test("isOpen: open while under budget", () => {
  assert.equal(isOpen(state(), state().config.items[0], DAY, NOW), true);
});

test("isOpen: closed at the budget boundary", () => {
  const s = { ...state(), ...used(30 * 60) };
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), false);
});

test("isOpen: burned passes extend the enforcement budget", () => {
  const s = { ...state(), ...used(30 * 60) };
  s.usage.days[DAY].unblocks["*.reddit.com"] = 2; // 30 min base + 2 × 15 = 60
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), true);

  s.usage.days[DAY].patternSeconds["*.reddit.com"] = 60 * 60 - 1;
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), true);

  s.usage.days[DAY].patternSeconds["*.reddit.com"] = 60 * 60;
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), false);
});

test("isOpen: passes on another site never extend this one", () => {
  const s = { ...state(), ...used(30 * 60) };
  s.usage.days[DAY].unblocks["*.x.com"] = 5;
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), false);
});

test("isOpen: passes from another day never extend today", () => {
  const s = { ...state(), ...used(30 * 60) };
  s.usage.days["2026-09-01"] = {
    patternSeconds: {},
    unblocks: { "*.reddit.com": 3 },
    bySite: {},
  };
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), false);
});

test("isOpen: a pass opens a zero-budget item for exactly one pass", () => {
  const s = state({
    config: {
      masterEnabled: true,
      unblockMinutes: 15,
      items: [{ ...state().config.items[0], budgetMinutes: 0 }],
    },
  });
  s.usage.days = {
    [DAY]: { patternSeconds: {}, unblocks: {}, bySite: {} },
  };
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), false);

  s.usage.days[DAY].unblocks["*.reddit.com"] = 1;
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), true);

  s.usage.days[DAY].patternSeconds["*.reddit.com"] = 15 * 60;
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), false);
});

test("isOpen: master off or disabled item never closes", () => {
  const masterOff = state({ config: { masterEnabled: false, items: state().config.items } });
  assert.equal(isOpen(masterOff, masterOff.config.items[0], DAY, NOW), true);

  const disabled = state({
    config: { masterEnabled: true, items: [{ ...state().config.items[0], enabled: false }] },
  });
  assert.equal(isOpen(disabled, disabled.config.items[0], DAY, NOW), true);
});

test("isOpen: zero budget is immediately closed", () => {
  const s = state({
    config: {
      masterEnabled: true,
      items: [{ ...state().config.items[0], budgetMinutes: 0 }],
    },
  });
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), false);
});

test("isOpen: active unblock window keeps the site open, expired does not", () => {
  const s = { ...state(), ...used(30 * 60) };
  s.runtime.unblockUntil["*.reddit.com"] = NOW + 60_000;
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), true);

  s.runtime.unblockUntil["*.reddit.com"] = NOW - 1;
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), false);
});

test("isOpen: denied access is treated as open (nothing to enforce)", () => {
  const s = state({
    config: {
      masterEnabled: true,
      items: [{ ...state().config.items[0], access: "denied" }],
    },
  });
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), true);
});

test("isOpen: a block override closes the site even under budget", () => {
  const s = state();
  s.runtime.dayOverrides["*.reddit.com"] = { day: DAY, action: "block" };
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), false);
});

test("isOpen: an allow override opens the site even with the budget spent", () => {
  const s = { ...state(), ...used(30 * 60) };
  s.runtime.dayOverrides["*.reddit.com"] = { day: DAY, action: "allow" };
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), true);
});

test("isOpen: overrides for another day are ignored", () => {
  const s = state();
  s.runtime.dayOverrides["*.reddit.com"] = { day: "2026-08-31", action: "block" };
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), true);
});

test("isOpen: an active unblock window wins over a block override", () => {
  const s = state();
  s.runtime.unblockUntil["*.reddit.com"] = NOW + 60_000;
  s.runtime.dayOverrides["*.reddit.com"] = { day: DAY, action: "block" };
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), true);
});

test("isOpen: after the unblock window expires, the block override rules again", () => {
  const s = state();
  s.runtime.unblockUntil["*.reddit.com"] = NOW - 1;
  s.runtime.dayOverrides["*.reddit.com"] = { day: DAY, action: "block" };
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), false);
});

test("desiredRules: closed item becomes one redirect rule", () => {
  const s = { ...state(), ...used(30 * 60) };
  const rules = desiredRules(s, { day: DAY, nowMs: NOW, blockedPageFor: (h) => `/b?d=${h}` });
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0], {
    id: 1001,
    priority: 1,
    action: { type: "redirect", redirect: { extensionPath: "/b?d=reddit.com" } },
    condition: { urlFilter: "||reddit.com/", resourceTypes: ["main_frame"] },
  });
});

test("desiredRules: open items produce no rules", () => {
  assert.deepEqual(desiredRules(state(), { day: DAY, nowMs: NOW, blockedPageFor: (h) => h }), []);
});

test("desiredRules: exact pattern maps to a regexFilter condition", () => {
  const s = state({
    config: {
      masterEnabled: true,
      items: [
        {
          id: "u2",
          ruleId: 1002,
          pattern: "x.com",
          budgetMinutes: 0,
          enabled: true,
          access: "granted",
        },
      ],
    },
  });
  const rules = desiredRules(s, { day: DAY, nowMs: NOW, blockedPageFor: (h) => h });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, 1002);
  assert.deepEqual(rules[0].condition, {
    regexFilter: "^https?://x\\.com/",
    resourceTypes: ["main_frame"],
  });
});

test("resolvePassRequest: an already-open site never burns a pass", () => {
  const s = state();
  const item = s.config.items[0];
  assert.deepEqual(resolvePassRequest(s, item, DAY, NOW, 3), {
    ok: true,
    burn: false,
    until: undefined,
  });
  assert.equal(passesUsedToday(s, DAY), 0);
});

test("resolvePassRequest: a live window is idempotent and echoes its deadline", () => {
  const s = { ...state(), ...used(30 * 60) };
  s.runtime.unblockUntil["*.reddit.com"] = NOW + 60_000;
  assert.deepEqual(resolvePassRequest(s, s.config.items[0], DAY, NOW, 3), {
    ok: true,
    burn: false,
    until: NOW + 60_000,
  });
});

test("resolvePassRequest: a closed site with passes left burns exactly one", () => {
  const s = { ...state(), ...used(30 * 60) };
  assert.deepEqual(resolvePassRequest(s, s.config.items[0], DAY, NOW, 3), {
    ok: true,
    burn: true,
  });
});

test("resolvePassRequest: a closed site with no passes left is refused", () => {
  const s = { ...state(), ...used(30 * 60) };
  s.usage.days[DAY].unblocks["*.x.com"] = 3; // global limit already spent
  assert.deepEqual(resolvePassRequest(s, s.config.items[0], DAY, NOW, 3), {
    ok: false,
    reason: "limit",
  });
});

test("resolvePassRequest: an allow override makes the request a no-op", () => {
  const s = { ...state(), ...used(30 * 60) };
  s.runtime.dayOverrides["*.reddit.com"] = { day: DAY, action: "allow" };
  assert.deepEqual(resolvePassRequest(s, s.config.items[0], DAY, NOW, 3), {
    ok: true,
    burn: false,
    until: undefined,
  });
});

test("isOpen: an active cooldown closes the site even under budget", () => {
  const s = state();
  s.runtime.cooldownUntil = { "*.reddit.com": NOW + 60_000 };
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), false);
  s.runtime.cooldownUntil["*.reddit.com"] = NOW - 1;
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), true);
});

test("isOpen: a pass lifts the cooldown", () => {
  const s = state();
  s.runtime.cooldownUntil = { "*.reddit.com": NOW + 60_000 };
  s.runtime.unblockUntil["*.reddit.com"] = NOW + 60_000;
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), true);
});

test("isOpen: an allow override lifts the cooldown", () => {
  const s = state();
  s.runtime.cooldownUntil = { "*.reddit.com": NOW + 60_000 };
  s.runtime.dayOverrides["*.reddit.com"] = { day: DAY, action: "allow" };
  assert.equal(isOpen(s, s.config.items[0], DAY, NOW), true);
});

test("isOpen: denied access beats a cooldown (nothing to enforce)", () => {
  const denied = state({
    config: {
      masterEnabled: true,
      unblockMinutes: 15,
      items: [{ ...state().config.items[0], access: "denied" }],
    },
  });
  denied.runtime.cooldownUntil = { "*.reddit.com": NOW + 60_000 };
  assert.equal(isOpen(denied, denied.config.items[0], DAY, NOW), true);
});
