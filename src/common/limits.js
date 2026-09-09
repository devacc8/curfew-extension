/**
 * Every tunable number in the extension lives here. The defaults used to be
 * repeated in `storage.defaults()`, `storage.sanitize()`, the ops clamps and
 * the UI inputs; a value that drifts between them is a bug waiting to happen,
 * so there is exactly one copy now.
 */

/** Defaults for a fresh document. Frozen: consumers must not mutate them. */
export const DEFAULTS = Object.freeze({
  masterEnabled: true,
  graceSeconds: 10,
  passMinutes: 15,
  passesPerDay: 3,
  budgetMinutes: 30,
  sessionLimitMinutes: 0,
  cooldownMinutes: 0,
});

/** Inclusive bounds for every user-editable number. */
export const LIMITS = Object.freeze({
  budgetMinutes: Object.freeze({ min: 0, max: 1440 }),
  minutes: Object.freeze({ min: 0, max: 1440 }),
  passesPerDay: Object.freeze({ min: 0, max: 99 }),
  graceSeconds: Object.freeze({ min: 0, max: 600 }),
});

/** Timer cadences and retention, shared by the worker and the docs. */
export const TICK_MINUTES = 5;
/** Ceiling for a single credit: the tick interval plus slack. */
export const MAX_CREDIT_MS = 6 * 60 * 1000;
export const IDLE_SECONDS = 60;
export const KEEP_DAYS = 60;

/**
 * Clamp one number into a bounds object.
 * @param {unknown} value - anything a user or a file could supply.
 * @param {{min: number, max: number}} bounds
 * @param {number} fallback - used when the value is not finite.
 * @returns {number} an integer inside the bounds.
 */
export function clampNumber(value, bounds, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(n)));
}

export const clampBudgetMinutes = (value) =>
  clampNumber(value, LIMITS.budgetMinutes, DEFAULTS.budgetMinutes);
export const clampMinutes = (value) => clampNumber(value, LIMITS.minutes, 0);
export const clampPassMinutes = (value) =>
  clampNumber(value, LIMITS.minutes, DEFAULTS.passMinutes);
/**
 * @param {unknown} value
 * @param {number} [fallback] - defaults to the documented default for a fresh
 *   document; mutating ops pass 0 so junk can never GRANT passes.
 */
export const clampPassesPerDay = (value, fallback = DEFAULTS.passesPerDay) =>
  clampNumber(value, LIMITS.passesPerDay, fallback);
export const clampGraceSeconds = (value) =>
  clampNumber(value, LIMITS.graceSeconds, DEFAULTS.graceSeconds);
