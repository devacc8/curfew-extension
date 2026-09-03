import { migrate } from "./storage.js";

/** Envelope version of the export format (independent of storage schema). */
const EXPORT_KIND = "curfew-export";
const EXPORT_VERSION = 1;

/** Serialize state into the one-file export format (§3.6). */
export function encodeExport(state, exportedAt) {
  return JSON.stringify({
    kind: EXPORT_KIND,
    version: EXPORT_VERSION,
    exportedAt,
    state,
  });
}

/**
 * Parse and validate an export file into importable state.
 * Machine-local fields (live session, unblock windows, day overrides) are
 * never imported; unknown/newer schemas are resolved by migrate().
 */
export function decodeExport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "parse" };
  }
  if (
    !data ||
    data.kind !== EXPORT_KIND ||
    data.version !== EXPORT_VERSION ||
    !data.state ||
    typeof data.state !== "object"
  ) {
    return { ok: false, error: "format" };
  }
  const state = migrate({
    ...data.state,
    session: null,
    runtime: {},
    settings: { ...data.state.settings, protection: null },
  });
  return { ok: true, state };
}

/** Keep only the newest `keep` day rows (import/reset retention, §4.2). */
export function pruneDays(state, keep) {
  const keys = Object.keys(state.usage.days).sort();
  for (const key of keys.slice(0, Math.max(0, keys.length - keep))) {
    delete state.usage.days[key];
  }
}
