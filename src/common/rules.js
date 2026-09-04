import { parsePattern, toDnrCondition } from "./patterns.js";
import { decide, secondsUsedToday, unblockWindowActive } from "./budget.js";

/**
 * "open" from the ENFORCEMENT point of view: no rule should exist.
 * Precedence: access-denied -> open; an ACTIVE UNBLOCK WINDOW wins over
 * everything (it is the user's explicit "stay anyway" from the wall);
 * then a day override for TODAY ("block" / "allow"); then the budget.
 */
export function isOpen(state, item, day, nowMs) {
  if (item.access !== "granted") return true;
  if (unblockWindowActive(state, item.pattern, nowMs)) return true;
  const override = state.runtime.dayOverrides?.[item.pattern];
  if (override && override.day === day) return override.action === "allow";
  return decide(item, secondsUsedToday(state, item.pattern, day), state.config.masterEnabled) === "open";
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
