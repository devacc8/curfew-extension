import { dayKey } from "./time.js";
import {
  cooldownActive,
  decide,
  effectiveBudgetSeconds,
  passBonusSeconds,
  secondsUsedToday,
  passWindowActive,
} from "./budget.js";

/**
 * The single answer to "what is the state of this site right now?".
 * The popup, the wall and the service worker all call {@link describeItem},
 * so the number a user reads and the rule the browser enforces can never come
 * from two different computations again.
 */

/**
 * Why enforcement closes this item right now, or null when it is open.
 * Precedence: access-denied -> open; an ACTIVE PASS WINDOW wins over
 * everything (it is the user's explicit "stay anyway" from the wall); a day
 * override for TODAY ("block" / "allow"); an anti-infinite-scroll COOLDOWN;
 * then the budget — the EFFECTIVE budget, so burned passes extend the
 * allowance exactly as the UI promises.
 * @returns {"override" | "cooldown" | "budget" | null}
 */
export function closeReason(state, item, day, nowMs) {
  if (item.access !== "granted") return null;
  if (passWindowActive(state, item.pattern, nowMs)) return null;
  const override = state.runtime.dayOverrides?.[item.pattern];
  if (override && override.day === day) return override.action === "allow" ? null : "override";
  if (cooldownActive(state, item.pattern, nowMs)) return "cooldown";
  const bonus = passBonusSeconds(state, item.pattern, day, state.config?.passMinutes);
  return decide(
    item,
    secondsUsedToday(state, item.pattern, day),
    state.config.masterEnabled,
    bonus
  ) === "closed"
    ? "budget"
    : null;
}

/** "open" from the ENFORCEMENT point of view: no rule should exist. */
export function isOpen(state, item, day, nowMs) {
  return closeReason(state, item, day, nowMs) === null;
}

/**
 * Everything a surface needs about one item, computed once.
 * Usage is extrapolated from the running session so a counter ticks between
 * flushes instead of freezing at its last stored value; enforcement itself
 * always uses stored usage (the worker owns crediting).
 * @returns {{
 *   day: string, used: number, effective: number, left: number,
 *   open: boolean, reason: string | null,
 *   cooling: boolean, coolingUntil: number, cooldownLeftMs: number,
 *   sessionActiveMs: number, extrapolated: boolean
 * }}
 */
export function describeItem(state, item, nowMs) {
  const day = dayKey(nowMs);
  const session = state.session;
  const sameSession = Boolean(session && session.pattern === item.pattern);
  const extrapolatedMs =
    sameSession && session.phase === "counting" ? Math.max(0, nowMs - session.lastTickAt) : 0;
  const used = secondsUsedToday(state, item.pattern, day) + extrapolatedMs / 1000;
  const effective = effectiveBudgetSeconds(item, state, day, state.config.passMinutes);
  const coolingUntil = state.runtime.cooldownUntil?.[item.pattern];
  const cooling = Number.isFinite(coolingUntil) && coolingUntil > nowMs;
  const reason = closeReason(state, item, day, nowMs);
  return {
    day,
    used,
    effective,
    left: Math.max(0, effective - used),
    open: reason === null,
    reason,
    cooling,
    coolingUntil: cooling ? coolingUntil : 0,
    cooldownLeftMs: cooling ? coolingUntil - nowMs : 0,
    sessionActiveMs: sameSession ? Math.max(0, session.activeMs ?? 0) : 0,
    extrapolated: extrapolatedMs > 0,
  };
}
