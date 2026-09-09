import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDuration,
  formatRemaining,
  remainingText,
  rowViewModel,
} from "../src/common/view.js";

const t = (key) =>
  ({
    minutesShort: "min",
    secondsShort: "s",
    leftSuffix: "left",
    cooldownLabel: "Break",
    closedLabel: "Closed",
  })[key] ?? key;

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
    session: {
      pattern: "x.com",
      phase: "counting",
      phaseStartedAt: NOW - 60_000,
      lastTickAt: NOW,
    },
    ...over,
  };
}

test("formatRemaining: seconds under a minute, then minutes, then hours", () => {
  assert.equal(formatRemaining(0, t), "0s");
  assert.equal(formatRemaining(45, t), "45s");
  assert.equal(formatRemaining(60, t), "1 min");
  assert.equal(formatRemaining(90, t), "2 min");
  assert.equal(formatRemaining(3600, t), "1h 0min");
  assert.equal(formatRemaining(3900, t), "1h 5min");
});

test("formatDuration: totals round to the nearest minute", () => {
  assert.equal(formatDuration(40, t), "1 min");
  assert.equal(formatDuration(29, t), "0 min");
  assert.equal(formatDuration(5400, t), "1h 30min");
});

test("rowViewModel: usage ticks with the running session", () => {
  const s = state({
    usage: { days: { [DAY]: { patternSeconds: { "x.com": 580 }, unblocks: {}, bySite: {} } } },
  });
  const first = rowViewModel(s, item, NOW);
  const later = rowViewModel(s, item, NOW + 5000);
  assert.equal(first.left, 20);
  assert.equal(later.left, 15);
  assert.equal(remainingText(first, NOW, t), "20s left");
  assert.equal(remainingText(later, NOW + 5000, t), "15s left");
});

test("rowViewModel: only this pattern's counting session ticks the row", () => {
  const other = state({
    session: { pattern: "y.com", phase: "counting", phaseStartedAt: NOW, lastTickAt: NOW },
  });
  assert.equal(rowViewModel(other, item, NOW + 5000).used, 8 * 60);

  const grace = state({
    session: { pattern: "x.com", phase: "grace", phaseStartedAt: NOW, lastTickAt: NOW },
  });
  assert.equal(rowViewModel(grace, item, NOW + 5000).used, 8 * 60);
});

test("rowViewModel: burned passes raise the effective budget", () => {
  const s = state({
    usage: {
      days: {
        [DAY]: { patternSeconds: { "x.com": 8 * 60 }, unblocks: { "x.com": 2 }, bySite: {} },
      },
    },
  });
  assert.equal(rowViewModel(s, item, NOW).effective, 10 * 60 + 30 * 60);
});

test("remainingText: cooldown counts down, closed says closed", () => {
  const s = state({
    runtime: { unblockUntil: {}, cooldownUntil: { "x.com": NOW + 45_000 }, dayOverrides: {} },
  });
  const vm = rowViewModel(s, item, NOW);
  assert.equal(vm.open, false);
  assert.equal(vm.cooling, true);
  assert.equal(remainingText(vm, NOW, t), "Break 45s");
  assert.equal(remainingText({ ...vm, cooling: false }, NOW, t), "Closed");
});
