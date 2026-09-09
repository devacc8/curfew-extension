import { parsePattern, toDnrCondition } from "./patterns.js";
import {
  decide,
  secondsUsedToday,
  unblockWindowActive,
  cooldownActive,
  passBonusSeconds,
  passesLeftToday,
} from "./budget.js";

/**
 * Why enforcement closes this item right now, or null when it is open.
 * The wall and the popup say it out loud, so a block is never a mystery:
 * a cooldown and a spent budget look completely different to the user.
 * Precedence: access-denied -> open; an ACTIVE UNBLOCK WINDOW wins over
 * everything (it is the user's explicit "stay anyway" from the wall); a day
 * override for TODAY ("block" / "allow"); an anti-infinite-scroll COOLDOWN;
 * then the budget — the EFFECTIVE budget, so burned passes extend the
 * allowance exactly as the popup promises.
 * @returns {"override" | "cooldown" | "budget" | null}
 */
export function closeReason(state, item, day, nowMs) {
  if (item.access !== "granted") return null;
  if (unblockWindowActive(state, item.pattern, nowMs)) return null;
  const override = state.runtime.dayOverrides?.[item.pattern];
  if (override && override.day === day) return override.action === "allow" ? null : "override";
  if (cooldownActive(state, item.pattern, nowMs)) return "cooldown";
  const bonus = passBonusSeconds(state, item.pattern, day, state.config?.unblockMinutes);
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
