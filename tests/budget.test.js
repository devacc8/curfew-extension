import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decide,
  secondsUsedToday,
  dailyTotals,
  passesUsedToday,
  passesLeftToday,
  transition,
  promoteGrace,
  recoveryCredit,
  capCredits,
  splitCreditsAtMidnight,
  effectiveBudgetSeconds,
  passBonusSeconds,
  nextExhaustionAt,
  cooldownActive,
  ensureDayRow,
  applyCredit,
  recordPass,
} from "../src/common/budget.js";

const item = (over = {}) => ({
  id: "u1",
  pattern: "*.reddit.com",
  budgetMinutes: 30,
  enabled: true,
  access: "granted",
  ...over,
});

test("decide: open while under budget", () => {
  assert.equal(decide(item(), 0, true), "open");
  assert.equal(decide(item(), 29 * 60, true), "open");
});

test("decide: closed at exactly the budget boundary (>=)", () => {
  assert.equal(decide(item(), 30 * 60, true), "closed");
  assert.equal(decide(item(), 30 * 60 + 1, true), "closed");
});

test("decide: master off opens everything", () => {
  assert.equal(decide(item(), 999999, false), "open");
});

test("decide: disabled item is open", () => {
  assert.equal(decide(item({ enabled: false }), 999999, true), "open");
});

test("decide: zero budget means closed (block-now semantics)", () => {
  assert.equal(decide(item({ budgetMinutes: 0 }), 0, true), "closed");
});

test("decide: missing item is open", () => {
  assert.equal(decide(null, 0, true), "open");
});

test("decide: bonus seconds (passes) extend the allowance", () => {
  const base = item({ budgetMinutes: 25 });
  assert.equal(decide(base, 25 * 60, true), "closed");
  assert.equal(decide(base, 25 * 60, true, 15 * 60), "open");
  assert.equal(decide(base, 40 * 60 - 1, true, 15 * 60), "open");
  assert.equal(decide(base, 40 * 60, true, 15 * 60), "closed");
});

test("decide: a zero-budget item opens only through bonus seconds", () => {
  const zero = item({ budgetMinutes: 0 });
  assert.equal(decide(zero, 0, true), "closed");
  assert.equal(decide(zero, 60, true, 15 * 60), "open");
  assert.equal(decide(zero, 15 * 60, true, 15 * 60), "closed");
});

test("decide: a non-finite bonus never opens the budget", () => {
  assert.equal(decide(item(), 999999, true, NaN), "closed");
  assert.equal(decide(item(), 999999, true, -60), "closed");
});

test("passBonusSeconds counts only this pattern's passes for the day", () => {
  const state = {
    usage: {
      days: {
        "2026-09-02": {
          patternSeconds: {},
          passes: { "*.reddit.com": 2, "*.x.com": 1 },
          bySite: {},
        },
      },
    },
  };
  assert.equal(passBonusSeconds(state, "*.reddit.com", "2026-09-02", 15), 30 * 60);
  assert.equal(passBonusSeconds(state, "*.reddit.com", "2026-09-02", 0), 0);
  assert.equal(passBonusSeconds(state, "*.reddit.com", "2026-09-03", 15), 0);
  assert.equal(passBonusSeconds({}, "*.reddit.com", "2026-09-02", 15), 0);
});

test("secondsUsedToday reads today's row", () => {
  const state = {
    usage: {
      days: {
        "2026-09-02": { patternSeconds: { "*.reddit.com": 772 }, passes: {}, bySite: {} },
      },
    },
  };
  assert.equal(secondsUsedToday(state, "*.reddit.com", "2026-09-02"), 772);
  assert.equal(secondsUsedToday(state, "*.x.com", "2026-09-02"), 0);
  assert.equal(secondsUsedToday(state, "*.reddit.com", "2026-09-03"), 0);
  assert.equal(secondsUsedToday({}, "*.reddit.com"), 0);
});

const CFG = { graceSeconds: 10 };
const env = (pattern, canCount) => ({ type: "environment", pattern, canCount });
const S = 1000;

test("transition: from null, countable env starts a grace session", () => {
  const { state, credits } = transition(null, env("*.x.com", true), CFG, 0);
  assert.deepEqual(state, {
    pattern: "*.x.com",
    phase: "grace",
    phaseStartedAt: 0,
    lastTickAt: 0,
    activeMs: 0,
  });
  assert.deepEqual(credits, []);
});

test("transition: from null, uncountable env stays null", () => {
  assert.equal(transition(null, env("*.x.com", false), CFG, 0).state, null);
  assert.equal(transition(null, env(null, true), CFG, 0).state, null);
});

test("transition: tick during grace keeps grace and credits nothing", () => {
  const start = transition(null, env("*.x.com", true), CFG, 0).state;
  const { state, credits } = transition(start, { type: "tick" }, CFG, 5 * S);
  assert.equal(state.phase, "grace");
  assert.deepEqual(credits, []);
});

test("transition: tick after grace promotes and credits the post-grace window", () => {
  const start = transition(null, env("*.x.com", true), CFG, 0).state;
  const { state, credits } = transition(start, { type: "tick" }, CFG, 11 * S);
  assert.equal(state.phase, "counting");
  assert.equal(state.phaseStartedAt, 10 * S);
  assert.equal(state.lastTickAt, 11 * S);
  assert.deepEqual(credits, [{ pattern: "*.x.com", ms: 1 * S }]);
});

test("transition: tick while counting credits the uncredited window", () => {
  const start = transition(null, env("*.x.com", true), CFG, 0).state;
  // The promoting tick credits the 1 s sliver after grace; the next tick
  // credits the remaining 9 s, so 10 s total, nothing lost and nothing doubled.
  const promoted = transition(start, { type: "tick" }, CFG, 11 * S);
  assert.deepEqual(promoted.credits, [{ pattern: "*.x.com", ms: 1 * S }]);
  const { state: next, credits } = transition(promoted.state, { type: "tick" }, CFG, 20 * S);
  assert.deepEqual(credits, [{ pattern: "*.x.com", ms: 9 * S }]);
  assert.equal(next.lastTickAt, 20 * S);
});

test("transition: same countable pattern is a no-op without credits", () => {
  let { state } = transition(null, env("*.x.com", true), CFG, 0);
  ({ state } = transition(state, { type: "tick" }, CFG, 11 * S));
  const before = { ...state };
  const { state: next, credits } = transition(state, env("*.x.com", true), CFG, 15 * S);
  assert.deepEqual(credits, []);
  assert.deepEqual(next, before);
});

test("transition: pattern switch credits the old window and starts fresh grace", () => {
  let { state } = transition(null, env("*.x.com", true), CFG, 0);
  ({ state } = transition(state, { type: "tick" }, CFG, 11 * S));
  ({ state } = transition(state, { type: "tick" }, CFG, 20 * S));
  const { state: next, credits } = transition(state, env("*.y.com", true), CFG, 25 * S);
  assert.deepEqual(credits, [{ pattern: "*.x.com", ms: 5 * S }]);
  assert.deepEqual(next, {
    pattern: "*.y.com",
    phase: "grace",
    phaseStartedAt: 25 * S,
    lastTickAt: 25 * S,
    activeMs: 0,
  });
});

test("transition: blur during counting flushes and pauses", () => {
  const start = transition(null, env("*.x.com", true), CFG, 0).state;
  const promoted = transition(start, { type: "tick" }, CFG, 11 * S);
  const { state: next, credits } = transition(promoted.state, env("*.x.com", false), CFG, 15 * S);
  assert.deepEqual(credits, [{ pattern: "*.x.com", ms: 4 * S }]);
  assert.equal(next, null);
});

test("transition: blur during grace discards the attempt", () => {
  const start = transition(null, env("*.x.com", true), CFG, 0).state;
  const { state, credits } = transition(start, env("*.x.com", false), CFG, 5 * S);
  assert.equal(state, null);
  assert.deepEqual(credits, []);
});

test("transition: no double counting across tick then stop", () => {
  let session = transition(null, env("*.x.com", true), CFG, 0);
  let total = 0;
  let result = transition(session.state, { type: "tick" }, CFG, 11 * S);
  total += result.credits.reduce((a, c) => a + c.ms, 0);
  session = result;
  result = transition(session.state, { type: "tick" }, CFG, 20 * S);
  total += result.credits.reduce((a, c) => a + c.ms, 0);
  session = result;
  result = transition(session.state, env("*.x.com", false), CFG, 25 * S);
  total += result.credits.reduce((a, c) => a + c.ms, 0);
  assert.equal(total, 15 * S);
});

test("recoveryCredit: counting credits capped elapsed", () => {
  const session = {
    pattern: "*.x.com",
    phase: "counting",
    phaseStartedAt: 0,
    lastTickAt: 0,
  };
  const cap = 6 * 60 * S;
  assert.deepEqual(recoveryCredit(session, 60 * S, cap), { pattern: "*.x.com", ms: 60 * S });
  assert.deepEqual(recoveryCredit(session, 3 * 60 * 60 * S, cap), {
    pattern: "*.x.com",
    ms: cap,
  });
});

test("recoveryCredit: grace and missing sessions credit nothing", () => {
  assert.equal(recoveryCredit(null, 1000, 1000), null);
  assert.equal(
    recoveryCredit({ pattern: "p", phase: "grace", phaseStartedAt: 0, lastTickAt: 0 }, 1000, 1000),
    null
  );
});

test("ensureDayRow creates the full row shape once", () => {
  const state = { usage: { days: {} } };
  const row = ensureDayRow(state, "2026-09-02");
  assert.deepEqual(row, { patternSeconds: {}, passes: {}, bySite: {} });
  assert.equal(ensureDayRow(state, "2026-09-02"), row);
});

test("applyCredit accumulates per pattern and resolved site", () => {
  const state = { usage: { days: {} } };
  applyCredit(state, { pattern: "*.reddit.com", ms: 1500 }, "2026-09-02");
  applyCredit(state, { pattern: "*.reddit.com", ms: 500 }, "2026-09-02");
  const row = state.usage.days["2026-09-02"];
  assert.equal(row.patternSeconds["*.reddit.com"], 2);
  assert.equal(row.bySite["reddit.com"], 2);
});

test("recordPass increments the daily counter", () => {
  const state = { usage: { days: {} } };
  recordPass(state, "*.x.com", "2026-09-02");
  recordPass(state, "*.x.com", "2026-09-02");
  assert.equal(state.usage.days["2026-09-02"].passes["*.x.com"], 2);
});

test("dailyTotals sorts sites by time and sums the total", () => {
  const state = {
    usage: {
      days: {
        "2026-09-02": {
          patternSeconds: {},
          passes: {},
          bySite: { "reddit.com": 600, "x.com": 1800, "news.ycombinator.com": 60 },
        },
      },
    },
  };
  const { totalSeconds, topSites } = dailyTotals(state, "2026-09-02");
  assert.equal(totalSeconds, 2460);
  assert.deepEqual(
    topSites.map((t) => t.site),
    ["x.com", "reddit.com", "news.ycombinator.com"]
  );
});

test("dailyTotals handles missing rows", () => {
  assert.deepEqual(dailyTotals({ usage: { days: {} } }, "2026-09-02"), {
    totalSeconds: 0,
    topSites: [],
  });
});

test("passesUsedToday sums passes across all sites", () => {
  const state = {
    usage: {
      days: {
        "2026-09-02": {
          patternSeconds: {},
          passes: { "*.x.com": 2, "*.reddit.com": 1 },
          bySite: {},
        },
      },
    },
  };
  assert.equal(passesUsedToday(state, "2026-09-02"), 3);
  assert.equal(passesUsedToday({ usage: { days: {} } }, "2026-09-02"), 0);
});

test("passesLeftToday enforces the absolute global limit; 0 = no passes", () => {
  const state = {
    usage: {
      days: {
        "2026-09-02": { patternSeconds: {}, passes: { "*.x.com": 2 }, bySite: {} },
      },
    },
  };
  assert.equal(passesLeftToday(state, "2026-09-02", 5), 3);
  assert.equal(passesLeftToday(state, "2026-09-02", 2), 0);
  assert.equal(passesLeftToday(state, "2026-09-02", 0), 0);
  assert.equal(passesLeftToday(state, "2026-09-02", -1), 0);
});

test("capCredits: a tick arriving after a whole night credits at most the cap", () => {
  const overnight = [{ pattern: "*.reddit.com", ms: 600 * 60 * 1000 }];
  const capped = capCredits(overnight, 6 * 60 * 1000);
  assert.deepEqual(capped, [{ pattern: "*.reddit.com", ms: 6 * 60 * 1000 }]);
});

test("capCredits keeps normal ticks and drops zero-size credits", () => {
  const out = capCredits(
    [{ pattern: "a", ms: 5000 }, { pattern: "b", ms: 0 }],
    6 * 60 * 1000
  );
  assert.deepEqual(out, [{ pattern: "a", ms: 5000 }]);
});

test("splitCreditsAtMidnight: a credit inside one day keeps that day", () => {
  const start = new Date(2026, 8, 2, 12, 0, 0).getTime();
  assert.deepEqual(splitCreditsAtMidnight([{ pattern: "*.reddit.com", ms: 5000 }], start), [
    { pattern: "*.reddit.com", ms: 5000, day: "2026-09-02" },
  ]);
});

test("splitCreditsAtMidnight: a credit across midnight is cut at the boundary", () => {
  const start = new Date(2026, 8, 2, 23, 58, 0).getTime();
  const credits = [{ pattern: "*.reddit.com", ms: 4 * 60 * 1000 }];
  assert.deepEqual(splitCreditsAtMidnight(credits, start), [
    { pattern: "*.reddit.com", ms: 2 * 60 * 1000, day: "2026-09-02" },
    { pattern: "*.reddit.com", ms: 2 * 60 * 1000, day: "2026-09-03" },
  ]);
});

test("splitCreditsAtMidnight: a credit starting at midnight belongs to the new day", () => {
  const start = new Date(2026, 8, 3, 0, 0, 0).getTime();
  assert.deepEqual(splitCreditsAtMidnight([{ pattern: "x.com", ms: 1000 }], start), [
    { pattern: "x.com", ms: 1000, day: "2026-09-03" },
  ]);
});

test("splitCreditsAtMidnight: empty and zero-size credits vanish", () => {
  const start = new Date(2026, 8, 2, 12, 0, 0).getTime();
  assert.deepEqual(splitCreditsAtMidnight([], start), []);
  assert.deepEqual(splitCreditsAtMidnight([{ pattern: "x.com", ms: 0 }], start), []);
  assert.deepEqual(splitCreditsAtMidnight(undefined, start), []);
});

test("effectiveBudgetSeconds: base budget alone", () => {
  const state = { usage: { days: { "2026-09-02": { patternSeconds: {}, passes: {}, bySite: {} } } } };
  const item = { budgetMinutes: 30, pattern: "*.reddit.com" };
  assert.equal(effectiveBudgetSeconds(item, state, "2026-09-02", 15), 30 * 60);
});

test("effectiveBudgetSeconds: each pass extends by passMinutes", () => {
  const state = {
    usage: {
      days: {
        "2026-09-02": {
          patternSeconds: {},
          passes: { "*.reddit.com": 2 },
          bySite: {},
        },
      },
    },
  };
  const item = { budgetMinutes: 30, pattern: "*.reddit.com" };
  assert.equal(effectiveBudgetSeconds(item, state, "2026-09-02", 15), 60 * 60);
  assert.equal(effectiveBudgetSeconds(item, state, "2026-09-02", 0), 30 * 60);
});

test("effectiveBudgetSeconds: passes on OTHER patterns do not extend", () => {
  const state = {
    usage: {
      days: {
        "2026-09-02": {
          patternSeconds: {},
          passes: { "*.x.com": 5 },
          bySite: {},
        },
      },
    },
  };
  const item = { budgetMinutes: 30, pattern: "*.reddit.com" };
  assert.equal(effectiveBudgetSeconds(item, state, "2026-09-02", 15), 30 * 60);
});

test("effectiveBudgetSeconds: zero-budget item with a pass gets pass-only allowance", () => {
  const state = {
    usage: {
      days: {
        "2026-09-02": {
          patternSeconds: {},
          passes: { "github.com": 1 },
          bySite: {},
        },
      },
    },
  };
  const item = { budgetMinutes: 0, pattern: "github.com" };
  assert.equal(effectiveBudgetSeconds(item, state, "2026-09-02", 15), 15 * 60);
});

test("promoteGrace: keeps grace until the window elapses, then backfills", () => {
  const session = { pattern: "*.x.com", phase: "grace", phaseStartedAt: 0, lastTickAt: 0 };
  assert.deepEqual(promoteGrace(session, CFG, 5 * S), session);
  assert.deepEqual(promoteGrace(session, CFG, 10 * S), {
    pattern: "*.x.com",
    phase: "counting",
    phaseStartedAt: 10 * S,
    lastTickAt: 10 * S,
  });
  assert.equal(promoteGrace(null, CFG, 10 * S), null);
  assert.equal(promoteGrace({ ...session, phase: "counting" }, CFG, 10 * S).phase, "counting");
});

test("transition: a visit that outlives grace credits on departure", () => {
  // The bug: the promotion check only ran on same-pattern events, so a visit
  // that ended (blur / tab switch) before any tick was discarded whole.
  const { state: start } = transition(null, env("*.x.com", true), CFG, 0);
  const { state, credits } = transition(start, env(null, false), CFG, 40 * S);
  assert.equal(state, null);
  assert.deepEqual(credits, [{ pattern: "*.x.com", ms: 30 * S }]);
});

test("transition: a departure inside grace still credits nothing", () => {
  const { state: start } = transition(null, env("*.x.com", true), CFG, 0);
  const { state, credits } = transition(start, env(null, false), CFG, 5 * S);
  assert.equal(state, null);
  assert.deepEqual(credits, []);
});

test("transition: a short visit credits exactly its post-grace share", () => {
  const { state: start } = transition(null, env("*.x.com", true), CFG, 0);
  const { credits } = transition(start, env("*.y.com", true), CFG, 70 * S);
  assert.deepEqual(credits, [{ pattern: "*.x.com", ms: 60 * S }]);
});

test("transition: grace never double-credits when promoted then flushed", () => {
  // Promote via departure, then let a tick arrive: the promoted session is
  // gone, so the tick cannot credit the same window twice.
  const { state } = transition(null, env("*.x.com", true), CFG, 0);
  const departed = transition(state, env(null, false), CFG, 40 * S);
  assert.equal(departed.credits.reduce((a, c) => a + c.ms, 0), 30 * S);
  const ticked = transition(departed.state, { type: "tick" }, CFG, 45 * S);
  assert.deepEqual(ticked.credits, []);
});

const EX_DAY = "2026-09-09";
const counting = (pattern = "*.reddit.com") => ({
  pattern,
  phase: "counting",
  phaseStartedAt: 0,
  lastTickAt: 0,
});
const exState = (over = {}) => ({
  config: {
    masterEnabled: true,
    graceSeconds: 10,
    passMinutes: 15,
    passesPerDay: 3,
    items: [item({ pattern: "*.reddit.com", budgetMinutes: 30 })],
  },
  usage: {
    days: {
      [EX_DAY]: { patternSeconds: { "*.reddit.com": 25 * 60 }, passes: {}, bySite: {} },
    },
  },
  runtime: { passUntil: {}, dayOverrides: {} },
  session: counting(),
  ...over,
});

test("nextExhaustionAt: the deadline is now + the remaining allowance", () => {
  assert.equal(nextExhaustionAt(exState(), EX_DAY, 1000), 1000 + 5 * 60 * 1000);
});

test("nextExhaustionAt: burned passes push the deadline out", () => {
  const state = exState();
  state.usage.days[EX_DAY].passes["*.reddit.com"] = 2;
  assert.equal(nextExhaustionAt(state, EX_DAY, 1000), 1000 + 35 * 60 * 1000);
});

test("nextExhaustionAt: null when nothing accrues or nothing is left", () => {
  assert.equal(nextExhaustionAt(exState({ session: null }), EX_DAY, 1000), null);
  assert.equal(
    nextExhaustionAt(exState({ session: { ...counting(), phase: "grace" } }), EX_DAY, 1000),
    null
  );
  const spent = exState();
  spent.usage.days[EX_DAY].patternSeconds["*.reddit.com"] = 30 * 60;
  assert.equal(nextExhaustionAt(spent, EX_DAY, 1000), null);
});

test("nextExhaustionAt: null when something else decides right now", () => {
  const masterOff = exState();
  masterOff.config.masterEnabled = false;
  assert.equal(nextExhaustionAt(masterOff, EX_DAY, 1000), null);

  const denied = exState();
  denied.config.items[0].access = "denied";
  assert.equal(nextExhaustionAt(denied, EX_DAY, 1000), null);

  const windowLive = exState();
  windowLive.runtime.passUntil["*.reddit.com"] = 2000;
  assert.equal(nextExhaustionAt(windowLive, EX_DAY, 1000), null);

  const overridden = exState();
  overridden.runtime.dayOverrides["*.reddit.com"] = { day: EX_DAY, action: "block" };
  assert.equal(nextExhaustionAt(overridden, EX_DAY, 1000), null);
});

test("nextExhaustionAt: a session for an unknown pattern is ignored", () => {
  assert.equal(nextExhaustionAt(exState({ session: counting("*.gone.com") }), EX_DAY, 1000), null);
});

test("cooldownActive: only a future deadline blocks", () => {
  assert.equal(
    cooldownActive({ runtime: { cooldownUntil: { "x.com": 2000 } } }, "x.com", 1000),
    true
  );
  assert.equal(
    cooldownActive({ runtime: { cooldownUntil: { "x.com": 1000 } } }, "x.com", 1000),
    false
  );
  assert.equal(cooldownActive({}, "x.com", 1000), false);
});

test("nextExhaustionAt: a session limit pulls the deadline in", () => {
  const state = exState();
  state.config.items[0].sessionLimitMinutes = 5;
  state.session.phaseStartedAt = 1000 - 2 * 60 * 1000;
  // 5 minutes of budget left, but the session limit hits in 3 minutes.
  assert.equal(nextExhaustionAt(state, EX_DAY, 1000), 1000 + 3 * 60 * 1000);
});
