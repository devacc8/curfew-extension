/** Local calendar day key, "YYYY-MM-DD". Accepts a Date or epoch ms. */
export function dayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Day key of the previous local calendar day (yesterday in dashboards). */
export function previousDayKey(now = new Date()) {
  const d = now instanceof Date ? new Date(now) : new Date(now);
  d.setDate(d.getDate() - 1);
  return dayKey(d);
}

/** Next local midnight as a Date (for the one-shot alarm). */
export function nextLocalMidnight(now = new Date()) {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** Milliseconds elapsed between two epoch values, clamped at >= 0. */
export function elapsedMs(fromEpochMs, toEpochMs) {
  return Math.max(0, toEpochMs - fromEpochMs);
}

/** Clamp ms into [0, maxMs] (recovery crediting). */
export function capMs(ms, maxMs) {
  return Math.min(Math.max(0, ms), maxMs);
}
