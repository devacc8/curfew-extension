import { dayKey } from "./time.js";
import {
  transition,
  promoteGrace,
  recoveryCredit,
  capCredits,
  splitCreditsAtMidnight,
  applyCredit,
} from "./budget.js";
import { pruneDays } from "./transfer.js";

/**
 * The tracking side of the state document, pure and clock-injected: the
 * service worker owns the browser APIs and calls these with Date.now(), so a
 * whole day — worker deaths, ticks, midnight, tab switches — is simulated in
 * tests without a browser.
 *
 * Every entry point mutates the state it is given (the `update()` mutator
 * convention) and returns the credits that actually landed, so a caller can
 * assert the accounting rather than guess at it.
 */

/** Cap one credit, cut it at midnight, book each part to its own day. */
function bookCredit(state, credit, startAtMs, maxCreditMs) {
  const parts = splitCreditsAtMidnight(capCredits([credit], maxCreditMs), startAtMs);
  for (const part of parts) applyCredit(state, part, part.day);
  return parts;
}

/**
 * One environment observation (active tab / focus / idle).
 * @param state - the state document, mutated in place.
 * @param event - `{ type: "environment", pattern, canCount }`.
 * @param nowMs - this run's clock.
 * @param options.fromWake - true on the first event after a cold start, when
 *   the previous session's uncredited window must be recovered.
 * @param options.maxCreditMs - ceiling for any single credit.
 * @returns the credits that landed, each with its `day`.
 */
export function trackEnvironment(state, event, nowMs, options = {}) {
  const maxCreditMs = options.maxCreditMs ?? Number.POSITIVE_INFINITY;
  const booked = [];
  const startSession = state.session;

  if (options.fromWake && startSession) {
    // Promote first: a visit that outlived its grace window while the worker
    // was dead must credit its post-grace part, not vanish whole.
    const promoted = promoteGrace(startSession, state.config, nowMs);
    const recovery = recoveryCredit(promoted, nowMs, maxCreditMs);
    if (recovery) {
      booked.push(...bookCredit(state, recovery, promoted.lastTickAt, maxCreditMs));
    }
    state.session = { ...promoted, lastTickAt: nowMs, phaseStartedAt: nowMs };
  }

  // The credit window starts where the session will actually be credited
  // from: the end of the grace window when this event promotes it, otherwise
  // its current lastTickAt. Using the raw session start would misbook the
  // grace seconds across midnight.
  const windowStart = state.session
    ? promoteGrace(state.session, state.config, nowMs).lastTickAt
    : nowMs;
  const moved = transition(state.session, event, state.config, nowMs);
  state.session = moved.state;
  for (const credit of moved.credits) {
    booked.push(...bookCredit(state, credit, windowStart, maxCreditMs));
  }

  return booked;
}

/** One flush/tick of the accruing session; a no-op without a session. */
export function trackTick(state, nowMs, options = {}) {
  const maxCreditMs = options.maxCreditMs ?? Number.POSITIVE_INFINITY;
  if (!state.session) return [];
  const windowStart = promoteGrace(state.session, state.config, nowMs).lastTickAt;
  const moved = transition(state.session, { type: "tick" }, state.config, nowMs);
  state.session = moved.state;
  const booked = [];
  for (const credit of moved.credits) {
    booked.push(...bookCredit(state, credit, windowStart, maxCreditMs));
  }
  return booked;
}

/** Drop expired pass windows: their one-shot alarm has already re-added the
 *  rule, and `isOpen` ignores them, so only storage hygiene is left. */
export function pruneRuntime(state, nowMs) {
  let changed = false;
  for (const [pattern, until] of Object.entries(state.runtime.unblockUntil)) {
    if (!(until > nowMs)) {
      delete state.runtime.unblockUntil[pattern];
      changed = true;
    }
  }
  return changed;
}

/** Close the local day once: prune history, drop per-day runtime. Returns
 *  true when this call performed the rollover. */
export function applyRollover(state, nowMs, keepDays) {
  const today = dayKey(nowMs);
  if (state.runtime.lastRolloverDay === today) return false;
  pruneDays(state, keepDays);
  state.runtime.unblockUntil = {};
  state.runtime.dayOverrides = {};
  state.runtime.lastRolloverDay = today;
  return true;
}
