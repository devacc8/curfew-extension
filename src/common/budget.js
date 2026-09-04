import { dayKey } from "./time.js";
import { elapsedMs, capMs } from "./time.js";

/** Hard ceiling for any single credit: a tick or stop event that arrives
 *  late (sleep, missed alarms, dead SW) may report a huge raw elapsed —
 *  it is capped so a night can never burn hours of budget. */
export function capCredits(credits, maxMs) {
  return (credits ?? [])
    .map((c) => ({ pattern: c.pattern, ms: capMs(c.ms, maxMs) }))
    .filter((c) => c.ms > 0);
}

/** Credits whose window spans midnight are phantom (sleep / powered-off
 *  time bridging 00:00) — drop them entirely. Normal ticking never spans
 *  midnight: each 5-min tick is credited to its own day. */
export function dropIfMidnightCrossed(credits, lastDay, today) {
  if (lastDay && today && lastDay !== today) return [];
  return credits;
}

/**
 * "open" | "closed" for an item given today's usage.
 * closed <=> enabled && masterEnabled && secondsUsed >= budget.
 * budgetMinutes <= 0 means "closed" (block-now semantics).
 */
export function decide(item, secondsUsed, masterEnabled) {
  if (!masterEnabled || !item || !item.enabled) return "open";
  const budgetSeconds = (item.budgetMinutes ?? 0) * 60;
  if (budgetSeconds <= 0) return "closed";
  return secondsUsed >= budgetSeconds ? "closed" : "open";
}

/** Seconds recorded today for a pattern (defaults to the local current day). */
export function secondsUsedToday(state, pattern, day = dayKey()) {
  return state?.usage?.days?.[day]?.patternSeconds?.[pattern] ?? 0;
}

/** { totalSeconds, topSites: [{ site, seconds }] } sorted by time, desc. */
export function dailyTotals(state, day) {
  const bySite = state?.usage?.days?.[day]?.bySite ?? {};
  const topSites = Object.entries(bySite)
    .map(([site, seconds]) => ({ site, seconds }))
    .sort((a, b) => b.seconds - a.seconds);
  return {
    totalSeconds: topSites.reduce((sum, t) => sum + t.seconds, 0),
    topSites,
  };
}

/** Is the 15-minute pass window currently live for a pattern? */
export function unblockWindowActive(state, pattern, nowMs) {
  const until = state?.runtime?.unblockUntil?.[pattern];
  return Number.isFinite(until) && until > nowMs;
}

/** Effective daily budget for an item: base budget extended by
 *  unblockMinutes for every pass burned on this pattern today. Passes
 *  extend the allowance — they never pause the accounting. */
export function effectiveBudgetSeconds(item, state, day, unblockMinutes) {
  const passes = state?.usage?.days?.[day]?.unblocks?.[item.pattern] ?? 0;
  const base = Math.max(0, (item.budgetMinutes ?? 0) * 60);
  const passSeconds = Math.max(0, unblockMinutes ?? 0) * 60;
  return base + passes * passSeconds;
}

/** Total "stay anyway" passes burned today across ALL sites. */
export function passesUsedToday(state, day) {
  const unblocks = state?.usage?.days?.[day]?.unblocks ?? {};
  return Object.values(unblocks).reduce((sum, n) => sum + n, 0);
}

/** Passes left today under the global limit; the limit is absolute —
 *  0 means no passes at all. */
export function passesLeftToday(state, day, limit) {
  const max = Number.isFinite(limit) ? limit : 0;
  return Math.max(0, max - passesUsedToday(state, day));
}

/**
 * Pure reducer for the tracking state machine (tech doc §8).
 * state: null | { pattern, phase: "grace"|"counting", phaseStartedAt, lastTickAt }
 * events: { type: "environment", pattern, canCount } | { type: "tick" }
 * Returns { state, credits: [{ pattern, ms }] }.
 * Invariant: time is credited exactly once — from lastTickAt, never overlapping.
 */
export function transition(state, event, config, nowMs) {
  const credits = [];
  const graceMs = (config?.graceSeconds ?? 0) * 1000;
  const countable = event?.type === "environment" && event.pattern && event.canCount;

  if (event?.type === "tick") {
    let next = state;
    if (state?.phase === "counting") {
      const ms = elapsedMs(state.lastTickAt, nowMs);
      if (ms > 0) credits.push({ pattern: state.pattern, ms });
      next = { ...state, lastTickAt: nowMs };
    } else if (state?.phase === "grace" && nowMs - state.phaseStartedAt >= graceMs) {
      const startedAt = state.phaseStartedAt + graceMs;
      next = { ...state, phase: "counting", phaseStartedAt: startedAt, lastTickAt: startedAt };
    }
    return { state: next, credits };
  }

  const freshSession = (pattern) => ({
    pattern,
    phase: "grace",
    phaseStartedAt: nowMs,
    lastTickAt: nowMs,
  });

  if (!state) {
    return {
      state: countable ? freshSession(event.pattern) : null,
      credits,
    };
  }

  const same = countable && event.pattern === state.pattern;
  if (!same) {
    if (state.phase === "counting") {
      const ms = elapsedMs(state.lastTickAt, nowMs);
      if (ms > 0) credits.push({ pattern: state.pattern, ms });
    }
    return {
      state: countable ? freshSession(event.pattern) : null,
      credits,
    };
  }

  if (state.phase === "grace" && nowMs - state.phaseStartedAt >= graceMs) {
    const startedAt = state.phaseStartedAt + graceMs;
    state = { ...state, phase: "counting", phaseStartedAt: startedAt, lastTickAt: startedAt };
  }
  return { state, credits };
}

/**
 * Credited time after a service-worker restart (tech doc §8.4):
 * counting sessions credit now - lastTickAt capped at maxMs; grace credits nothing.
 */
export function recoveryCredit(session, nowMs, maxMs) {
  if (!session || session.phase !== "counting") return null;
  const ms = capMs(elapsedMs(session.lastTickAt, nowMs), maxMs);
  return ms > 0 ? { pattern: session.pattern, ms } : null;
}

/** Create today's usage row lazily; returns the row. */
export function ensureDayRow(state, day) {
  const days = state.usage.days;
  if (!days[day]) days[day] = { patternSeconds: {}, unblocks: {}, bySite: {} };
  return days[day];
}

/** Credit counted milliseconds to a pattern (and its resolved site). */
export function applyCredit(state, { pattern, ms }, day) {
  const row = ensureDayRow(state, day);
  const sec = ms / 1000;
  row.patternSeconds[pattern] = (row.patternSeconds[pattern] ?? 0) + sec;
  const site = pattern.replace(/^\*\./, "");
  row.bySite[site] = (row.bySite[site] ?? 0) + sec;
}

/** Count one "stay anyway" pass for a pattern. */
export function recordUnblock(state, pattern, day) {
  const row = ensureDayRow(state, day);
  row.unblocks[pattern] = (row.unblocks[pattern] ?? 0) + 1;
}
