import { test } from "node:test";
import assert from "node:assert/strict";
import { closeReason, describeItem, isOpen } from "../src/common/status.js";

const DAY = "2026-09-09";
const NOW = new Date(2026, 8, 9, 12, 0, 0, 0).getTime();
const item = {
  id: "u1",
  ruleId: 1,
  pattern: "x.com",
  budgetMinutes: 10,
  sessionLimitMinutes: 0,
  cooldownMinutes: 0,
  enabled: true,
  access: "granted",
};

function state(over = {}) {
  return {
    config: { masterEnabled: true, unblockMinutes: 15, items: [item] },
    usage: {
      days: { [DAY]: { patternSeconds: { "x.com": 8 * 60 }, unblocks: {}, bySite: {} } },
    },
    runtime: { unblockUntil: {}, cooldownUntil: {}, dayOverrides: {} },
    session: null,
    ...over,
  };
}

test("describeItem: one call answers open/left/reason", () => {
  const vm = describeItem(state(), item, NOW);
  assert.equal(vm.open, true);
  assert.equal(vm.reason, null);
  assert.equal(vm.used, 480);
  assert.equal(vm.effective, 600);
  assert.equal(vm.left, 120);
  assert.equal(vm.day, DAY);
});

test("describeItem: extrapolates the running session, enforcement does not", () => {
  const running = state({
    session: {
      pattern: "x.com",
      phase: "counting",
      phaseStartedAt: NOW - 60_000,
      lastTickAt: NOW,
      activeMs: 60_000,
    },
  });
  assert.equal(describeItem(running, item, NOW + 5000).left, 115);
  assert.equal(describeItem(running, item, NOW + 5000).sessionActiveMs, 60_000);
  // A session for another pattern must not leak into this row.
  const other = state({
    session: { pattern: "y.com", phase: "counting", phaseStartedAt: NOW, lastTickAt: NOW, activeMs: 5 },
  });
  assert.equal(describeItem(other, item, NOW + 5000).left, 120);
});

test("describeItem: passes, cooldown and overrides are visible", () => {
  const withPass = state();
  withPass.usage.days[DAY].unblocks["x.com"] = 2;
  assert.equal(describeItem(withPass, item, NOW).effective, 600 + 30 * 60);

  const cooling = state();
  cooling.runtime.cooldownUntil["x.com"] = NOW + 45_000;
  const vm = describeItem(cooling, item, NOW);
  assert.equal(vm.open, false);
  assert.equal(vm.reason, "cooldown");
  assert.equal(vm.cooling, true);
  assert.equal(vm.cooldownLeftMs, 45_000);

  const blocked = state();
  blocked.runtime.dayOverrides["x.com"] = { day: DAY, action: "block" };
  assert.equal(describeItem(blocked, item, NOW).reason, "override");
});

test("closeReason / isOpen stay the same question", () => {
  const spent = state();
  spent.usage.days[DAY].patternSeconds["x.com"] = 10 * 60;
  assert.equal(closeReason(spent, item, DAY, NOW), "budget");
  assert.equal(isOpen(spent, item, DAY, NOW), false);
  assert.equal(isOpen(state(), item, DAY, NOW), true);
});
