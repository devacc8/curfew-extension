import { dayKey } from "./time.js";
import {
  transition,
  promoteGrace,
  recoveryCredit,
  capCredits,
  dropIfMidnightCrossed,
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

/** Apply one credit list: cap it, drop what spans midnight, book the rest. */
function commitCredits(state, credits, startAtMs, nowMs, maxCreditMs) {
  const today = dayKey(nowMs);
  const lastDay = startAtMs === null ? null : dayKey(startAtMs);
  const safe = dropIfMidnightCrossed(capCredits(credits, maxCreditMs), lastDay, today);
  for (const credit of safe) applyCredit(state, credit, today);
  return safe;
}

/**
 * One environment observation (active tab / focus / idle).
 * @param state - the state document, mutated in place.
 * @param event - `{ type: "environment", pattern, canCount }`.
 * @param nowMs - this run's clock.
 * @param options.fromWake - true on the first event after a cold start, when
 *   the previous session's uncredited window must be recovered.
 * @param options.maxCreditMs - ceiling for any single credit.
 * @returns the credits that landed.
 */
export function trackEnvironment(state, event, nowMs, options = {}) {
  const maxCreditMs = options.maxCreditMs ?? Number.POSITIVE_INFINITY;
  const credits = [];
  const startSession = state.session;
  const startAtMs = startSession ? startSession.lastTickAt : null;

  if (options.fromWake && startSession) {
    // Promote first: a visit that outlived its grace window while the worker
    // was dead must credit its post-grace part, not vanish whole.
    const promoted = promoteGrace(startSession, state.config, nowMs);
    const recovery = recoveryCredit(promoted, nowMs, maxCreditMs);
    if (recovery) credits.push(recovery);
    state.session = { ...promoted, lastTickAt: nowMs, phaseStartedAt: nowMs };
  }

  const moved = transition(state.session, event, state.config, nowMs);
  state.session = moved.state;
  credits.push(...moved.credits);

  return commitCredits(state, credits, startAtMs, nowMs, maxCreditMs);
}

/** One flush/tick of the accruing session; a no-op without a session. */
export function trackTick(state, nowMs, options = {}) {
  const maxCreditMs = options.maxCreditMs ?? Number.POSITIVE_INFINITY;
  if (!state.session) return [];
  const startAtMs = state.session.lastTickAt;
  const moved = transition(state.session, { type: "tick" }, state.config, nowMs);
  state.session = moved.state;
  return commitCredits(state, moved.credits, startAtMs, nowMs, maxCreditMs);
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
