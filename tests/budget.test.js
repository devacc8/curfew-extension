import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decide,
  secondsUsedToday,
  dailyTotals,
  passesUsedToday,
  passesLeftToday,
  transition,
  recoveryCredit,
  capCredits,
  dropIfMidnightCrossed,
  ensureDayRow,
  applyCredit,
  recordUnblock,
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

test("secondsUsedToday reads today's row", () => {
  const state = {
    usage: {
      days: {
        "2026-09-02": { patternSeconds: { "*.reddit.com": 772 }, unblocks: {}, bySite: {} },
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

test("transition: tick after grace promotes and backfills lastTickAt to grace end", () => {
  const start = transition(null, env("*.x.com", true), CFG, 0).state;
  const { state, credits } = transition(start, { type: "tick" }, CFG, 11 * S);
  assert.equal(state.phase, "counting");
  assert.equal(state.phaseStartedAt, 10 * S);
  assert.equal(state.lastTickAt, 10 * S);
  assert.deepEqual(credits, []);
});

test("transition: tick while counting credits the uncredited window", () => {
  let { state } = transition(null, env("*.x.com", true), CFG, 0);
  ({ state } = transition(state, { type: "tick" }, CFG, 11 * S));
  const { state: next, credits } = transition(state, { type: "tick" }, CFG, 20 * S);
  assert.deepEqual(credits, [{ pattern: "*.x.com", ms: 10 * S }]);
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
  });
});

test("transition: blur during counting flushes and pauses", () => {
  let { state } = transition(null, env("*.x.com", true), CFG, 0);
  ({ state } = transition(state, { type: "tick" }, CFG, 11 * S));
  const { state: next, credits } = transition(state, env("*.x.com", false), CFG, 15 * S);
  assert.deepEqual(credits, [{ pattern: "*.x.com", ms: 5 * S }]);
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
  assert.deepEqual(row, { patternSeconds: {}, unblocks: {}, bySite: {} });
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

test("recordUnblock increments the daily counter", () => {
  const state = { usage: { days: {} } };
  recordUnblock(state, "*.x.com", "2026-09-02");
  recordUnblock(state, "*.x.com", "2026-09-02");
  assert.equal(state.usage.days["2026-09-02"].unblocks["*.x.com"], 2);
});

test("dailyTotals sorts sites by time and sums the total", () => {
  const state = {
    usage: {
      days: {
        "2026-09-02": {
          patternSeconds: {},
          unblocks: {},
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
          unblocks: { "*.x.com": 2, "*.reddit.com": 1 },
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
        "2026-09-02": { patternSeconds: {}, unblocks: { "*.x.com": 2 }, bySite: {} },
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

test("dropIfMidnightCrossed: credits spanning midnight are phantom and dropped", () => {
  const credits = [{ pattern: "*.reddit.com", ms: 6 * 60 * 1000 }];
  assert.deepEqual(dropIfMidnightCrossed(credits, "2026-09-02", "2026-09-03"), []);
});

test("dropIfMidnightCrossed: same-day credits pass through", () => {
  const credits = [{ pattern: "*.reddit.com", ms: 5000 }];
  assert.deepEqual(
    dropIfMidnightCrossed(credits, "2026-09-02", "2026-09-02"),
    credits
  );
  assert.deepEqual(dropIfMidnightCrossed(credits, null, "2026-09-02"), credits);
});
