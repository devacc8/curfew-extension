import { describeItem } from "./status.js";

/**
 * Presentation math shared by every surface: pure, so the live countdown is
 * unit-tested instead of eyeballed. `t` is the caller's i18n lookup.
 */

/**
 * A duration as a short localized string.
 * @param {number} ms
 * @param {(key: string) => string} t
 * @param {{round?: "up" | "nearest"}} [options] - "up" never reads zero while
 *   time is left (a countdown), "nearest" is right for totals.
 * @returns {string} "48s" / "3 min" / "1h 5min"
 */
export function formatClock(ms, t, options = {}) {
  const round = options.round ?? "up";
  const roundTo = round === "nearest" ? Math.round : Math.ceil;
  const seconds = Math.max(0, roundTo(ms / 1000));
  if (seconds < 60) return `${seconds}${t("secondsShort")}`;
  const minutes = roundTo(seconds / 60);
  if (minutes < 60) return `${minutes} ${t("minutesShort")}`;
  return `${Math.floor(minutes / 60)}${t("hoursShort")} ${minutes % 60}${t("minutesShort")}`;
}

/** Remaining time: rounds up, so "1 min left" never means "already due". */
export const formatRemaining = (sec, t) => formatClock(sec * 1000, t, { round: "up" });

/** Totals: nearest minute (a 40 s visit is "1 min", not "0 min"). */
export const formatDuration = (sec, t) => formatClock(sec * 1000, t, { round: "nearest" });

/** The item status the popup renders — same numbers enforcement uses. */
export function rowViewModel(state, item, nowMs) {
  return describeItem(state, item, nowMs);
}

/** The row's right-hand slot: remaining, cooldown countdown, or "closed". */
export function remainingText(vm, nowMs, t) {
  if (vm.open) return `${formatRemaining(vm.left, t)} ${t("leftSuffix")}`;
  if (vm.cooling) {
    return `${t("cooldownLabel")} ${formatClock(vm.cooldownLeftMs, t, { round: "up" })}`;
  }
  return t("closedLabel");
}
