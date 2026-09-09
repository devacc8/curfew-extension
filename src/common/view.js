import { dayKey } from "./time.js";
import { effectiveBudgetSeconds, secondsUsedToday } from "./budget.js";
import { isOpen } from "./rules.js";

/**
 * Presentation math shared by the popup: pure, so the live countdown is
 * unit-tested instead of eyeballed. `t` is the caller's i18n lookup.
 */

/** "48s" / "3 min" / "1h 5min" — a remaining duration never reads "0 min". */
export function formatRemaining(sec, t) {
  if (sec < 60) return `${Math.max(0, Math.ceil(sec))}${t("secondsShort")}`;
  const m = Math.ceil(sec / 60);
  if (m < 60) return `${m} ${t("minutesShort")}`;
  return `${Math.floor(m / 60)}h ${m % 60}${t("minutesShort")}`;
}

/** Totals are rounded (a 40 s visit is "1 min", not "0 min"). */
export function formatDuration(sec, t) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} ${t("minutesShort")}`;
  return `${Math.floor(m / 60)}h ${m % 60}${t("minutesShort")}`;
}

/**
 * What one site row shows right now. Usage is extrapolated from the running
 * session so the counter ticks in real time between flushes instead of
 * freezing at its last stored value.
 */
export function rowViewModel(state, item, nowMs) {
  const day = dayKey(nowMs);
  const session = state.session;
  const extrapolated =
    session && session.pattern === item.pattern && session.phase === "counting"
      ? Math.max(0, (nowMs - session.lastTickAt) / 1000)
      : 0;
  const used = secondsUsedToday(state, item.pattern, day) + extrapolated;
  const effective = effectiveBudgetSeconds(item, state, day, state.config.unblockMinutes);
  const coolingUntil = state.runtime.cooldownUntil?.[item.pattern];
  const cooling = Number.isFinite(coolingUntil) && coolingUntil > nowMs;
  return {
    used,
    effective,
    left: Math.max(0, effective - used),
    cooling,
    coolingUntil,
    open: isOpen(state, item, day, nowMs),
  };
}

/** The row's right-hand slot: remaining, cooldown countdown, or "closed". */
export function remainingText(vm, nowMs, t) {
  if (vm.open) return `${formatRemaining(vm.left, t)} ${t("leftSuffix")}`;
  if (vm.cooling) {
    return `${t("cooldownLabel")} ${formatRemaining((vm.coolingUntil - nowMs) / 1000, t)}`;
  }
  return t("closedLabel");
}
