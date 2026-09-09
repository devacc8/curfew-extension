import { test } from "node:test";
import assert from "node:assert/strict";
import { migrate } from "../src/common/storage.js";
import {
  trackEnvironment,
  trackTick,
  pruneRuntime,
  applyRollover,
  applySessionLimit,
} from "../src/common/tracking.js";
import { secondsUsedToday } from "../src/common/budget.js";
import { dayKey } from "../src/common/time.js";

/** Deterministic clock base: 2026-09-09 10:00 local. */
const T0 = new Date(2026, 8, 9, 10, 0, 0, 0).getTime();
const S = 1000;
const MIN = 60 * S;
const CAP = 6 * MIN;

function fresh() {
  return migrate({
    schema: 1,
    config: {
      items: [
        {
          id: "u1",
          ruleId: 1001,
          pattern: "x.com",
          budgetMinutes: 1000,
          enabled: true,
          access: "granted",
        },
      ],
    },
  });
}

/** Replay a scripted day against the pure tracker; returns credited ms. */
function run(state, script) {
  let credited = 0;
  for (const step of script) {
    const now = T0 + step.at;
    const landed =
      step.type === "tick"
        ? trackTick(state, now, { maxCreditMs: CAP })
        : trackEnvironment(
            state,
            { type: "environment", pattern: step.pattern, canCount: step.canCount },
            now,
            { fromWake: step.fromWake, maxCreditMs: CAP }
          );
    credited += landed.reduce((sum, credit) => sum + credit.ms, 0);
  }
  return credited;
}

test("simulation: a visit credits wall clock minus grace, nothing more", () => {
  const state = fresh();
  const script = [
    { at: 0, type: "env", pattern: "x.com", canCount: true },
    { at: 5 * S, type: "env", pattern: "x.com", canCount: true },
    { at: 10 * S, type: "tick" },
    { at: 3 * MIN, type: "tick" },
    { at: 7 * MIN, type: "env", pattern: null, canCount: false },
  ];
  const credited = run(state, script);
  assert.equal(credited, 7 * MIN - 10 * S);
  assert.equal(secondsUsedToday(state, "x.com", dayKey(T0)), credited / S);
});

test("simulation: a cold wake recovers the gap capped and never double-counts", () => {
  const state = fresh();
  const credited = run(state, [
    { at: 0, type: "env", pattern: "x.com", canCount: true, fromWake: true },
    { at: 10 * S, type: "tick" },
    { at: 3 * MIN + 10 * S, type: "env", pattern: "x.com", canCount: true, fromWake: true },
    { at: 3 * MIN + 11 * S, type: "tick" },
  ]);
  assert.equal(credited, 3 * MIN + S);
});

test("simulation: a machine sleep credits at most the cap", () => {
  const state = fresh();
  const credited = run(state, [
    { at: 0, type: "env", pattern: "x.com", canCount: true, fromWake: true },
    { at: 10 * S, type: "tick" },
    { at: 2 * 60 * MIN, type: "env", pattern: "x.com", canCount: true, fromWake: true },
  ]);
  assert.equal(credited, CAP);
});

test("simulation: several visits in a day sum to their active time", () => {
  const state = fresh();
  const credited = run(state, [
    { at: 0, type: "env", pattern: "x.com", canCount: true },
    { at: 5 * MIN, type: "env", pattern: null, canCount: false },
    { at: 10 * MIN, type: "env", pattern: "x.com", canCount: true },
    { at: 10 * MIN + 30 * S, type: "tick" },
    { at: 15 * MIN, type: "tick" },
    { at: 20 * MIN, type: "env", pattern: null, canCount: false },
  ]);
  // 15 minutes on the site, minus one grace window per visit. (Ticks every
  // 5 minutes, as the alarm does — a longer gap is capped by design.)
  assert.equal(credited, 15 * MIN - 20 * S);
  assert.ok(credited <= 20 * MIN, "credited more than wall clock");
});

test("simulation: a visit that never leaves is capped only by the tick cadence", () => {
  const state = fresh();
  const credited = run(state, [
    { at: 0, type: "env", pattern: "x.com", canCount: true, fromWake: true },
    { at: 10 * S, type: "tick" },
    { at: 5 * MIN, type: "tick" },
    { at: 10 * MIN, type: "tick" },
  ]);
  assert.equal(credited, 10 * MIN - 10 * S);
});

test("pruneRuntime drops expired windows and keeps live ones", () => {  const state = fresh();
  state.runtime.passUntil = { "x.com": T0 + S, "y.com": T0 - 1 };
  assert.equal(pruneRuntime(state, T0), true);
  assert.deepEqual(state.runtime.passUntil, { "x.com": T0 + S });
  assert.equal(pruneRuntime(state, T0), false);
});

test("applyRollover closes the day once and clears per-day runtime", () => {
  const state = fresh();
  state.runtime.passUntil = { "x.com": T0 + MIN };
  state.runtime.dayOverrides = { "x.com": { day: dayKey(T0), action: "block" } };
  assert.equal(applyRollover(state, T0, 60), true);
  assert.equal(state.runtime.lastRolloverDay, dayKey(T0));
  assert.deepEqual(state.runtime.passUntil, {});
  assert.deepEqual(state.runtime.dayOverrides, {});
  assert.equal(applyRollover(state, T0 + MIN, 60), false);
});

test("applyRollover keeps only the newest day rows", () => {
  const state = fresh();
  for (let i = 0; i < 5; i++) {
    const day = new Date(T0);
    day.setDate(day.getDate() - i);
    state.usage.days[dayKey(day)] = { patternSeconds: {}, passes: {}, bySite: {} };
  }
  applyRollover(state, T0, 3);
  assert.equal(Object.keys(state.usage.days).length, 3);
});

test("simulation: a visit across midnight books each part to its own day", () => {
  const state = fresh();
  const base = new Date(2026, 8, 9, 23, 58, 0, 0).getTime();
  const env = (pattern, canCount) => ({ type: "environment", pattern, canCount });
  trackEnvironment(state, env("x.com", true), base, { fromWake: true, maxCreditMs: CAP });
  const landed = trackEnvironment(state, env(null, false), base + 4 * MIN, {
    maxCreditMs: CAP,
  });
  // 3m50s of credit starting at 23:58:10: 1m50s before midnight, 2m after.
  assert.deepEqual(landed, [
    { pattern: "x.com", ms: 110 * S, day: "2026-09-09" },
    { pattern: "x.com", ms: 120 * S, day: "2026-09-10" },
  ]);
  assert.equal(secondsUsedToday(state, "x.com", "2026-09-09"), 110);
  assert.equal(secondsUsedToday(state, "x.com", "2026-09-10"), 120);
});

test("applySessionLimit: reaching the limit blocks the pattern and drops the session", () => {
  const state = fresh();
  state.config.items[0].sessionLimitMinutes = 10;
  state.config.items[0].cooldownMinutes = 5;
  state.session = {
    pattern: "x.com",
    phase: "counting",
    phaseStartedAt: T0,
    lastTickAt: T0 + 9 * MIN,
    activeMs: 9 * MIN,
  };
  assert.equal(applySessionLimit(state, T0 + 9 * MIN), null);
  state.session = { ...state.session, activeMs: 10 * MIN };
  assert.deepEqual(applySessionLimit(state, T0 + 10 * MIN), {
    pattern: "x.com",
    until: T0 + 15 * MIN,
  });
  assert.equal(state.session, null);
  assert.equal(state.runtime.cooldownUntil["x.com"], T0 + 15 * MIN);
});

test("simulation: a long session trips the cooldown and stops accruing", () => {
  const state = fresh();
  state.config.items[0].sessionLimitMinutes = 5;
  state.config.items[0].cooldownMinutes = 2;
  const credited = run(state, [
    { at: 0, type: "env", pattern: "x.com", canCount: true, fromWake: true },
    { at: 10 * S, type: "tick" },
    { at: 3 * MIN, type: "tick" },
    { at: 6 * MIN, type: "tick" },
    { at: 8 * MIN, type: "tick" },
  ]);
  assert.equal(state.session, null);
  assert.equal(state.runtime.cooldownUntil["x.com"], T0 + 8 * MIN);
  // The overshoot past the limit is booked honestly, then nothing accrues.
  assert.equal(credited, 6 * MIN - 10 * S);
});

test("session limit counts credited presence, not wall clock", () => {
  // A machine sleep or a closed browser must not count as "still scrolling":
  // the session clock only advances with time that was actually booked.
  const state = fresh();
  state.config.items[0].sessionLimitMinutes = 10;
  state.config.items[0].cooldownMinutes = 5;
  state.session = {
    pattern: "x.com",
    phase: "counting",
    phaseStartedAt: T0,
    lastTickAt: T0,
    activeMs: 0,
  };
  const now = T0 + 2 * 60 * MIN;
  trackEnvironment(
    state,
    { type: "environment", pattern: "x.com", canCount: true },
    now,
    { fromWake: true, maxCreditMs: CAP }
  );
  // 2 hours of absence booked at most the cap, so the limit is nowhere near.
  assert.equal(state.session.activeMs, CAP);
  assert.equal(state.runtime.cooldownUntil["x.com"], undefined);
});

test("a continuously credited session still trips the limit", () => {
  const state = fresh();
  state.config.items[0].sessionLimitMinutes = 5;
  state.config.items[0].cooldownMinutes = 1;
  trackEnvironment(
    state,
    { type: "environment", pattern: "x.com", canCount: true },
    T0,
    { fromWake: true, maxCreditMs: CAP }
  );
  for (const at of [3 * MIN, 6 * MIN]) {
    trackTick(state, T0 + at, { maxCreditMs: CAP });
  }
  assert.equal(state.session, null);
  assert.equal(state.runtime.cooldownUntil["x.com"], T0 + 7 * MIN);
});
