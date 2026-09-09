import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS,
  LIMITS,
  MAX_CREDIT_MS,
  clampBudgetMinutes,
  clampGraceSeconds,
  clampMinutes,
  clampPassesPerDay,
  clampUnblockMinutes,
} from "../src/common/limits.js";

test("defaults and bounds are frozen (no accidental mutation)", () => {
  assert.equal(Object.isFrozen(DEFAULTS), true);
  assert.equal(Object.isFrozen(LIMITS.budgetMinutes), true);
  assert.equal(DEFAULTS.unblockMinutes, 15);
  assert.equal(MAX_CREDIT_MS, 6 * 60 * 1000);
});

test("clampBudgetMinutes: bounds, rounding and junk", () => {
  assert.equal(clampBudgetMinutes(5000), 1440);
  assert.equal(clampBudgetMinutes(-5), 0);
  assert.equal(clampBudgetMinutes(29.6), 30);
  assert.equal(clampBudgetMinutes("45"), 45);
  assert.equal(clampBudgetMinutes("abc"), DEFAULTS.budgetMinutes);
  assert.equal(clampBudgetMinutes(undefined), DEFAULTS.budgetMinutes);
});

test("clampMinutes: session limit / cooldown default to off", () => {
  assert.equal(clampMinutes(undefined), 0);
  assert.equal(clampMinutes("junk"), 0);
  assert.equal(clampMinutes(1441), 1440);
});

test("clampPassesPerDay: the document default, or an explicit fallback", () => {
  assert.equal(clampPassesPerDay(2.6), 3);
  assert.equal(clampPassesPerDay(1000), 99);
  assert.equal(clampPassesPerDay("abc"), DEFAULTS.unblockPassesPerDay);
  // Ops pass 0: a corrupted payload must never GRANT passes.
  assert.equal(clampPassesPerDay("abc", 0), 0);
});

test("clampGraceSeconds / clampUnblockMinutes keep their own fallbacks", () => {
  assert.equal(clampGraceSeconds(undefined), 10);
  assert.equal(clampGraceSeconds(-1), 0);
  assert.equal(clampGraceSeconds(10_000), 600);
  assert.equal(clampUnblockMinutes(undefined), 15);
  assert.equal(clampUnblockMinutes(0), 0);
});
