import { dayKey, elapsedMs, capMs, nextLocalMidnight } from "./time.js";

/** Hard ceiling for any single credit: a tick or stop event that arrives
 *  late (sleep, missed alarms, dead SW) may report a huge raw elapsed —
 *  it is capped so a night can never burn hours of budget. */
export function capCredits(credits, maxMs) {
  return (credits ?? [])
    .map((c) => ({ pattern: c.pattern, ms: capMs(c.ms, maxMs) }))
    .filter((c) => c.ms > 0);
}

/**
 * Cut credits at the local midnight they cross, booking each part to the day
 * it actually happened instead of throwing the whole credit away. `startAtMs`
 * is the start of the (contiguous) credit window. Returns
 * `[{ pattern, ms, day }]`.
 */
export function splitCreditsAtMidnight(credits, startAtMs) {
  const out = [];
  for (const credit of credits ?? []) {
    if (!(credit.ms > 0)) continue;
    const midnightMs = nextLocalMidnight(new Date(startAtMs)).getTime();
    if (startAtMs + credit.ms <= midnightMs) {
      out.push({ pattern: credit.pattern, ms: credit.ms, day: dayKey(startAtMs) });
      continue;
    }
    const before = midnightMs - startAtMs;
    if (before > 0) {
      out.push({ pattern: credit.pattern, ms: before, day: dayKey(startAtMs) });
    }
    const after = credit.ms - before;
    if (after > 0) {
      out.push({ pattern: credit.pattern, ms: after, day: dayKey(midnightMs) });
    }
  }
  return out;
}

/**
 * "open" | "closed" for an item given today's usage.
 * closed <=> enabled && masterEnabled && secondsUsed >= budget + bonus.
 * budgetMinutes <= 0 means "closed" (block-now semantics) unless passes
 * have bought allowance through `bonusSeconds`.
 * @param bonusSeconds - extra allowance from today's passes on this pattern.
 */
export function decide(item, secondsUsed, masterEnabled, bonusSeconds = 0) {
  if (!masterEnabled || !item || !item.enabled) return "open";
  const bonus = Number.isFinite(bonusSeconds) ? Math.max(0, bonusSeconds) : 0;
  const budgetSeconds = (item.budgetMinutes ?? 0) * 60 + bonus;
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

/** Is an anti-infinite-scroll cooldown currently blocking this pattern? */
export function cooldownActive(state, pattern, nowMs) {
  const until = state?.runtime?.cooldownUntil?.[pattern];
  return Number.isFinite(until) && until > nowMs;
}

/** Extra allowance in seconds bought by today's passes on one pattern. */
export function passBonusSeconds(state, pattern, day, unblockMinutes) {
  const passes = state?.usage?.days?.[day]?.unblocks?.[pattern] ?? 0;
  const passSeconds = Math.max(0, unblockMinutes ?? 0) * 60;
  return passes * passSeconds;
}

/** Effective daily budget for an item: base budget extended by
 *  unblockMinutes for every pass burned on this pattern today. Passes
 *  extend the allowance — they never pause the accounting. */
export function effectiveBudgetSeconds(item, state, day, unblockMinutes) {
  const base = Math.max(0, (item.budgetMinutes ?? 0) * 60);
  return base + passBonusSeconds(state, item.pattern, day, unblockMinutes);
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
 * Epoch ms of the next moment the CURRENTLY COUNTING pattern must be
 * re-evaluated: the budget running out, or the anti-infinite-scroll session
 * limit being reached, whichever comes first. Null when nothing is accruing,
 * it is already closed, or something other than the budget decides right now
 * (master off, access lost, a pass window, a day override). The service
 * worker turns this into a one-shot alarm so the wall lands at the moment
 * instead of on the next 5-min tick. Pure: the caller owns Date.now().
 */
export function nextExhaustionAt(state, day, nowMs) {
  const session = state?.session;
  if (!session || session.phase !== "counting") return null;
  const item = state?.config?.items?.find((i) => i.pattern === session.pattern);
  if (!item || !item.enabled || item.access !== "granted") return null;
  if (!state.config.masterEnabled) return null;
  if (unblockWindowActive(state, session.pattern, nowMs)) return null;
  const override = state.runtime?.dayOverrides?.[session.pattern];
  if (override && override.day === day) return null;
  const remaining =
    effectiveBudgetSeconds(item, state, day, state.config.unblockMinutes) -
    secondsUsedToday(state, session.pattern, day);
  if (remaining <= 0) return null;
  const budgetAtMs = nowMs + remaining * 1000;
  const limitMinutes = Math.max(0, item.sessionLimitMinutes ?? 0);
  const limitAtMs =
    limitMinutes > 0 ? session.phaseStartedAt + limitMinutes * 60_000 : Number.POSITIVE_INFINITY;
  return Math.min(budgetAtMs, limitAtMs);
}

/**
 * Promote a GRACE session whose window has already elapsed into COUNTING,
 * backfilling lastTickAt to the end of the grace window. Pure and exported
 * because the SW's wake recovery needs the same promotion: a visit that
 * outlives its grace window while the worker sleeps would otherwise be
 * discarded whole — the classic "a 40-second visit counted as zero" loss.
 */
export function promoteGrace(session, config, nowMs) {
  const graceMs = (config?.graceSeconds ?? 0) * 1000;
  if (session?.phase === "grace" && nowMs - session.phaseStartedAt >= graceMs) {
    const startedAt = session.phaseStartedAt + graceMs;
    return { ...session, phase: "counting", phaseStartedAt: startedAt, lastTickAt: startedAt };
  }
  return session;
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
  const countable = event?.type === "environment" && event.pattern && event.canCount;

  if (event?.type === "tick") {
    const promoted = promoteGrace(state, config, nowMs);
    if (promoted?.phase === "counting") {
      const ms = elapsedMs(promoted.lastTickAt, nowMs);
      if (ms > 0) credits.push({ pattern: promoted.pattern, ms });
      return { state: { ...promoted, lastTickAt: nowMs }, credits };
    }
    return { state: promoted, credits };
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

  // Promote BEFORE branching on the pattern: a departure (blur, tab switch)
  // must still credit the part of the visit that outlived the grace window.
  state = promoteGrace(state, config, nowMs);
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
