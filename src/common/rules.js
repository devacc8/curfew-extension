import { parsePattern, toDnrCondition } from "./patterns.js";
import {
  decide,
  secondsUsedToday,
  unblockWindowActive,
  passBonusSeconds,
  passesLeftToday,
} from "./budget.js";

/**
 * "open" from the ENFORCEMENT point of view: no rule should exist.
 * Precedence: access-denied -> open; an ACTIVE UNBLOCK WINDOW wins over
 * everything (it is the user's explicit "stay anyway" from the wall);
 * then a day override for TODAY ("block" / "allow"); then the budget —
 * the EFFECTIVE budget, so burned passes extend the allowance exactly
 * as the popup promises.
 */
export function isOpen(state, item, day, nowMs) {
  if (item.access !== "granted") return true;
  if (unblockWindowActive(state, item.pattern, nowMs)) return true;
  const override = state.runtime.dayOverrides?.[item.pattern];
  if (override && override.day === day) return override.action === "allow";
  const bonus = passBonusSeconds(state, item.pattern, day, state.config?.unblockMinutes);
  return (
    decide(
      item,
      secondsUsedToday(state, item.pattern, day),
      state.config.masterEnabled,
      bonus
    ) === "open"
  );
}

/**
 * Outcome of a "stay anyway" request. Pure so the SW handler stays a
 * one-liner and the double-burn case is unit-tested:
 *  - already open (live window, allow override, or allowance left): ok, and
 *    NOTHING is burned — a stale wall tab or a double click must not eat a
 *    pass the user did not need;
 *  - no passes left today: refused;
 *  - otherwise: burn exactly one pass.
 */
export function resolvePassRequest(state, item, day, nowMs, limit) {
  if (isOpen(state, item, day, nowMs)) {
    return {
      ok: true,
      burn: false,
      until: state?.runtime?.unblockUntil?.[item.pattern],
    };
  }
  if (passesLeftToday(state, day, limit) <= 0) return { ok: false, reason: "limit" };
  return { ok: true, burn: true };
}

/**
 * The desired set of dynamic DNR rules — a pure projection of storage.
 * The service worker diffs this against getDynamicRules() and reconciles.
 */
export function desiredRules(state, { day, nowMs, blockedPageFor }) {
  const rules = [];
  for (const item of state.config.items) {
    if (isOpen(state, item, day, nowMs)) continue;
    const parsed = parsePattern(item.pattern);
    if (!parsed.ok) continue;
    rules.push({
      id: item.ruleId,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { extensionPath: blockedPageFor(parsed.pattern.host) },
      },
      condition: { ...toDnrCondition(parsed.pattern), resourceTypes: ["main_frame"] },
    });
  }
  return rules;
}
