import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayKey,
  previousDayKey,
  nextLocalMidnight,
  elapsedMs,
  capMs,
} from "../src/common/time.js";

test("dayKey pads month and day", () => {
  assert.equal(dayKey(new Date(2026, 0, 3)), "2026-01-03");
  assert.equal(dayKey(new Date(2026, 8, 2)), "2026-09-02");
});

test("dayKey crosses month and year boundaries", () => {
  assert.equal(dayKey(new Date(2026, 11, 31)), "2026-12-31");
  assert.equal(dayKey(new Date(2027, 0, 1)), "2027-01-01");
});

test("previousDayKey steps back across month and year", () => {
  assert.equal(previousDayKey(new Date(2026, 8, 2)), "2026-09-01");
  assert.equal(previousDayKey(new Date(2026, 8, 1)), "2026-08-31");
  assert.equal(previousDayKey(new Date(2027, 0, 1)), "2026-12-31");
});

test("previousDayKey accepts epoch ms", () => {
  assert.equal(previousDayKey(new Date(2026, 8, 2).getTime()), "2026-09-01");
});

test("nextLocalMidnight returns tomorrow at 00:00 local", () => {
  const now = new Date(2026, 8, 2, 15, 30, 10, 500);
  const next = nextLocalMidnight(now);
  assert.equal(next.getFullYear(), 2026);
  assert.equal(next.getMonth(), 8);
  assert.equal(next.getDate(), 3);
  assert.equal(next.getHours(), 0);
  assert.equal(next.getMinutes(), 0);
  assert.equal(next.getSeconds(), 0);
  assert.equal(next.getMilliseconds(), 0);
});

test("nextLocalMidnight from exact midnight returns the next day", () => {
  const now = new Date(2026, 8, 2, 0, 0, 0, 0);
  const next = nextLocalMidnight(now);
  assert.equal(next.getDate(), 3);
});

test("nextLocalMidnight lands on the first day of the next month", () => {
  const now = new Date(2026, 9, 31, 23, 59, 59, 999);
  const next = nextLocalMidnight(now);
  assert.equal(next.getMonth(), 10);
  assert.equal(next.getDate(), 1);
});

test("elapsedMs clamps negative gaps to zero", () => {
  assert.equal(elapsedMs(1000, 1500), 500);
  assert.equal(elapsedMs(1500, 1000), 0);
  assert.equal(elapsedMs(1000, 1000), 0);
});

test("capMs clamps into [0, max]", () => {
  assert.equal(capMs(500, 1000), 500);
  assert.equal(capMs(2000, 1000), 1000);
  assert.equal(capMs(-5, 1000), 0);
});
