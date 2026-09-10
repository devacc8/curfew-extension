import {
  DEFAULTS,
  clampBudgetMinutes,
  clampGraceSeconds,
  clampMinutes,
  clampPassesPerDay,
  clampPassMinutes,
} from "./limits.js";

/** The key every build up to schema 2 wrote. Read once, then never written. */
const LEGACY_KEY = "curfew";

/** Documents live under a VERSION-SCOPED key. A page left over from an older
 *  build keeps reading and writing `curfew` (its own idea of the document) and
 *  can no longer fight the current build for the same bytes — which is exactly
 *  how a field install had its sites, passes and protection reset over and
 *  over: a stale page from the pre-rename build rewrote the whole document on
 *  every one of its renders. */
const SCHEMA = 2;
const KEY = `${LEGACY_KEY}:v${SCHEMA}`;

/** Exposed for tests and diagnostics. */
export const STORAGE_KEY = KEY;
export const LEGACY_STORAGE_KEY = LEGACY_KEY;

/** Whether the last read produced a document this build may write back. Set
 *  false when the stored document is from a newer build (or unreadable), so no
 *  write can downgrade or destroy it. */
let writable = true;

/** The schema this build writes, for diagnostics. */
export const STATE_SCHEMA = SCHEMA;

/**
 * @typedef {object} Item
 * @property {string} id
 * @property {number} ruleId
 * @property {string} pattern
 * @property {number} budgetMinutes
 * @property {number} [sessionLimitMinutes] - 0/absent = no session cap
 * @property {number} [cooldownMinutes] - 0/absent = no cooldown
 * @property {boolean} enabled
 * @property {"granted" | "denied"} access
 */

/**
 * @typedef {object} DayRow
 * @property {Record<string, number>} patternSeconds
 * @property {Record<string, number>} passes
 * @property {Record<string, number>} bySite
 */

/**
 * @typedef {object} Session
 * @property {string} pattern
 * @property {"grace" | "counting"} phase
 * @property {number} phaseStartedAt
 * @property {number} lastTickAt
 * @property {number} activeMs - credited ms in this unbroken session
 */

/**
 * @typedef {object} CurfewState
 * @property {number} schema
 * @property {{ masterEnabled: boolean, graceSeconds: number, passMinutes: number,
 *             passesPerDay: number, items: Item[] }} config
 * @property {{ days: Record<string, DayRow> }} usage
 * @property {Session | null} session
 * @property {{ passUntil: Record<string, number>, cooldownUntil: Record<string, number>,
 *              dayOverrides: Record<string, { day: string, action: "allow" | "block" }>,
 *              lastRolloverDay?: string }} runtime
 * @property {{ version: number, itemSeq: number, protection: null | { kind: string } }} settings
 */

/** @returns {CurfewState} */
function defaults() {
  return {
    schema: SCHEMA,
    config: {
      masterEnabled: DEFAULTS.masterEnabled,
      graceSeconds: DEFAULTS.graceSeconds,
      passMinutes: DEFAULTS.passMinutes,
      passesPerDay: DEFAULTS.passesPerDay,
      items: [],
    },
    usage: { days: {} },
    session: null,
    runtime: { passUntil: {}, cooldownUntil: {}, dayOverrides: {} },
    settings: { version: 1, itemSeq: 1000, protection: null },
  };
}

/**
 * Schema v1 -> v2: one word for one concept. "unblock" became "pass" everywhere
 * (`passMinutes`, `passesPerDay`, `passUntil`, `usage.days[].passes`), so the
 * data, the code and the UI finally agree on what a 15-minute stay is called.
 * @param {any} state - a v1 document.
 */
const MIGRATIONS = {
  1: (state) => {
    const config = { ...(state.config ?? {}) };
    if ("unblockMinutes" in config) {
      config.passMinutes = config.unblockMinutes;
      delete config.unblockMinutes;
    }
    if ("unblockPassesPerDay" in config) {
      config.passesPerDay = config.unblockPassesPerDay;
      delete config.unblockPassesPerDay;
    }
    const runtime = { ...(state.runtime ?? {}) };
    if ("unblockUntil" in runtime) {
      runtime.passUntil = runtime.unblockUntil;
      delete runtime.unblockUntil;
    }
    const days = state.usage?.days ?? {};
    const renamedDays = Object.fromEntries(
      Object.entries(days).map(([day, row]) => {
        if (!row || typeof row !== "object" || !("unblocks" in row)) return [day, row];
        const { unblocks, ...rest } = row;
        return [day, { ...rest, passes: unblocks }];
      })
    );
    return {
      ...state,
      schema: 2,
      config,
      runtime,
      usage: { ...(state.usage ?? {}), days: renamedDays },
    };
  },
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Finite number or the fallback — the shape guard for every numeric field. */
function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** pattern -> non-negative finite number, dropping anything else. */
function numberMap(raw) {
  const out = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) out[key] = n;
    }
  }
  return out;
}

/** Usage rows: only real day keys with numeric counters survive. A string
 *  counter would otherwise CONCATENATE in applyCredit ("600" + 0.5). */
function sanitizeDays(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [day, row] of Object.entries(raw)) {
    if (!DAY_RE.test(day) || !row || typeof row !== "object") continue;
    out[day] = {
      patternSeconds: numberMap(row.patternSeconds),
      passes: numberMap(row.passes),
      bySite: numberMap(row.bySite),
    };
  }
  return out;
}

/** A tracking session must be structurally sound or it is dropped: the
 *  state machine indexes every field unconditionally. */
function sanitizeSession(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (typeof raw.pattern !== "string" || raw.pattern.length === 0) return null;
  if (raw.phase !== "grace" && raw.phase !== "counting") return null;
  const phaseStartedAt = finiteNumber(raw.phaseStartedAt, null);
  const lastTickAt = finiteNumber(raw.lastTickAt, null);
  if (phaseStartedAt === null || lastTickAt === null) return null;
  return {
    pattern: raw.pattern,
    phase: raw.phase,
    phaseStartedAt,
    lastTickAt,
    activeMs: Math.max(0, finiteNumber(raw.activeMs, 0)),
  };
}

function sanitizeOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [pattern, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.day !== "string") continue;
    if (entry.action !== "allow" && entry.action !== "block") continue;
    out[pattern] = { day: entry.day, action: entry.action };
  }
  return out;
}

/** Items: an array of objects with a usable pattern, unique pattern AND
 *  unique ruleId (a duplicate DNR id makes updateDynamicRules reject the
 *  whole batch). Unknown/future fields ride along untouched. */
function sanitizeItems(raw, settings) {
  const out = [];
  const patterns = new Set();
  const ruleIds = new Set();
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (typeof entry.pattern !== "string" || entry.pattern.length === 0) continue;
    if (patterns.has(entry.pattern)) continue;
    patterns.add(entry.pattern);
    let ruleId =
      Number.isSafeInteger(entry.ruleId) && entry.ruleId > 0 ? entry.ruleId : null;
    if (ruleId === null || ruleIds.has(ruleId)) ruleId = ++settings.itemSeq;
    ruleIds.add(ruleId);
    settings.itemSeq = Math.max(settings.itemSeq, ruleId);
    out.push({
      ...entry,
      id: typeof entry.id === "string" && entry.id.length > 0 ? entry.id : `u${ruleId.toString(36)}`,
      ruleId,
      pattern: entry.pattern,
      budgetMinutes: clampBudgetMinutes(entry.budgetMinutes),
      sessionLimitMinutes: clampMinutes(entry.sessionLimitMinutes),
      cooldownMinutes: clampMinutes(entry.cooldownMinutes),
      enabled: entry.enabled === undefined ? true : Boolean(entry.enabled),
      access: entry.access === "granted" ? "granted" : "denied",
    });
  }
  return out;
}

/**
 * Structural sanitizer: the single trust boundary for anything that reaches
 * the state document — an on-disk profile, an imported file, a hand-edited
 * export. Every consumer indexes these fields without checks (`items` is
 * iterated, `usage.days[day]` is written through, `session` is destructured),
 * so one malformed field would otherwise brick tracking AND enforcement until
 * the user clears storage. Idempotent: a sanitized document round-trips
 * unchanged, which is what keeps `load()` from rewriting on every read.
 */
function sanitize(state) {
  const settings = {
    ...state.settings,
    version: finiteNumber(state.settings?.version, 1),
    itemSeq: Math.max(1000, Math.floor(finiteNumber(state.settings?.itemSeq, 1000))),
    protection:
      state.settings?.protection &&
      typeof state.settings.protection === "object" &&
      !Array.isArray(state.settings.protection)
        ? state.settings.protection
        : null,
  };
  const runtime = {
    ...state.runtime,
    passUntil: numberMap(state.runtime?.passUntil),
    cooldownUntil: numberMap(state.runtime?.cooldownUntil),
    dayOverrides: sanitizeOverrides(state.runtime?.dayOverrides),
  };
  if (typeof runtime.lastRolloverDay !== "string") delete runtime.lastRolloverDay;
  return {
    ...state,
    schema: SCHEMA,
    config: {
      ...state.config,
      masterEnabled: state.config?.masterEnabled !== false,
      graceSeconds: clampGraceSeconds(state.config?.graceSeconds),
      passMinutes: clampPassMinutes(state.config?.passMinutes),
      passesPerDay: clampPassesPerDay(state.config?.passesPerDay),
      items: sanitizeItems(state.config?.items, settings),
    },
    usage: { ...state.usage, days: sanitizeDays(state.usage?.days) },
    session: sanitizeSession(state.session),
    runtime,
    settings,
  };
}

/** Merge a document of a KNOWN schema into current defaults and sanitize it. */
function mergeIntoDefaults(s) {
  const d = defaults();
  const merged = {
    ...d,
    ...s,
    schema: SCHEMA,
    config: { ...d.config, ...s.config },
    usage: { ...d.usage, ...s.usage },
    runtime: { ...d.runtime, ...s.runtime },
    settings: { ...d.settings, ...s.settings },
  };
  if (merged.settings.protection?.salt) {
    merged.settings.protection = null;
  }
  return sanitize(merged);
}

/** Resolve any stored/imported shape into the current schema. Pure, exported
 *  for the import pipeline (transfer.js).
 *
 *  A document from a NEWER schema resolves to defaults here — right for an
 *  import (never trust a file from the future), wrong for a live read, which
 *  is why {@link load} handles that case itself and refuses to write.
 *  @param {any} state - any stored/imported shape; runtime checks below are the
 *  real guard, so the type is deliberately open here.
 *  @returns {CurfewState} */
export function migrate(state) {
  if (!state || typeof state !== "object" || Array.isArray(state) || state.schema > SCHEMA) {
    return defaults();
  }
  let s = state;
  while (s.schema < SCHEMA) {
    const step = MIGRATIONS[s.schema];
    if (!step) return defaults();
    s = step(s);
  }
  return mergeIntoDefaults(s);
}

/** Load state, seeding/migrating on disk only when the shape changes. */
/** Last read that needed no write, keyed by the raw document. Pages call
 *  `load()` several times per open; re-migrating the same bytes is waste. */
let cachedRawJson = null;
let cachedState = null;

export async function load() {
  let box;
  try {
    box = await chrome.storage.local.get([KEY, LEGACY_KEY]);
  } catch (error) {
    // After an extension reload, orphaned pages fail every chrome.* call
    // with "Extension context invalidated" — reload instead of dying.
    if (typeof location !== "undefined" && String(error?.message).includes("context invalidated")) {
      location.reload();
    }
    throw error;
  }
  // Documents of this schema live under KEY; anything older is read from the
  // legacy key exactly once (that is where a pre-rename build left it) and
  // carried forward. The legacy key is never written again.
  const rawJson = JSON.stringify(box[KEY] ?? null);
  if (rawJson === cachedRawJson && cachedState !== null) return cachedState;

  const fromLegacy = box[KEY] === undefined && box[LEGACY_KEY] !== undefined;
  const raw = fromLegacy ? box[LEGACY_KEY] : box[KEY];
  if (fromLegacy) {
    console.warn("curfew: migrating the document from the legacy key");
  }

  // A document written by a NEWER build means this context is stale (an
  // orphaned page from before a reload). Read it, keep it, never rewrite it:
  // resetting it to defaults here destroys the user's sites, history and
  // passes — a real report, not a theory.
  if (raw && Number(raw.schema) > SCHEMA) {
    writable = false;
    console.warn("curfew: stored document is newer than this build; leaving it alone");
    // Reload ONCE so the tab picks up the current build; a tab that cannot
    // (an older build still installed) must not reload forever.
    try {
      const store = globalThis.sessionStorage;
      if (typeof location !== "undefined" && store) {
        if (!store.getItem("curfew:stale-reload")) {
          store.setItem("curfew:stale-reload", "1");
          setTimeout(() => location.reload(), 0);
        }
      }
    } catch {
      // No location/sessionStorage (the worker): reading on is enough.
    }
    return mergeIntoDefaults(raw);
  }

  let state;
  try {
    state = migrate(raw ?? defaults());
  } catch (error) {
    // Never destroy a document we cannot parse: keep it and say so loudly.
    console.error("curfew: could not migrate the stored document", error);
    writable = false;
    return raw ?? defaults();
  }
  writable = true;
  if (!raw || rawJson !== JSON.stringify(state)) {
    // Insurance: keep the pre-migration document, so a bad migration is
    // recoverable instead of final.
    if (raw && Number(raw.schema) < SCHEMA) {
      try {
        await chrome.storage.local.set({ [`${LEGACY_KEY}:backup-v${Number(raw.schema)}`]: raw });
        console.warn(`curfew: kept a backup of the v${Number(raw.schema)} document`);
      } catch (error) {
        console.error("curfew: could not write the migration backup", error);
      }
    }
    await chrome.storage.local.set({ [KEY]: state });
  }
  cachedRawJson = JSON.stringify(state);
  cachedState = state;
  return state;
}

/** Read -> mutate in place -> write when the snapshot changed.
 *  Mutators mutate the state they receive; return values are ignored
 *  (a returned item is NOT a state replacement — that bit us once).
 *  Service-worker only: pages must go through {@link mutate}. */
export async function update(mutator, preloaded) {
  const state = preloaded ?? (await load());
  const before = JSON.stringify(state);
  mutator(state);
  // Any mutation invalidates the memoized read; a refused write must never be
  // served back as if it had happened.
  cachedRawJson = null;
  cachedState = null;
  if (JSON.stringify(state) !== before) {
    if (!writable) {
      // Same guard as load(): never write back a document this build could
      // not read faithfully. Without this the first page write through the
      // worker would rewrite it as "current schema + defaults" and silently
      // drop every field it cannot express.
      console.error("curfew: refusing to overwrite a document this build cannot read");
      return state;
    }
    await chrome.storage.local.set({ [KEY]: state });
  }
  return state;
}

/**
 * Page-side write. The service worker owns the document: it applies the named
 * op (common/ops.js) inside its serialized mutation queue, so a page can never
 * clobber a concurrent time credit with a stale read-modify-write snapshot.
 * @param op - op name understood by `applyOp`.
 * @param payload - op-specific JSON value.
 * @returns the op result, or null when the worker refused it.
 */
export async function mutate(op, payload) {
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: "state:apply", op, payload });
  } catch (error) {
    console.error(`curfew: worker unreachable for op "${op}"`, error);
    return null;
  }
  if (!response?.ok) {
    console.error(`curfew: op "${op}" was refused`, response);
    return null;
  }
  return response.result;
}

/** Subscribe to whole-state changes. */
export function onChanged(handler) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[KEY]) handler(changes[KEY].newValue);
  });
}

export function upsertItem(state, { pattern, budgetMinutes, access = "granted" }) {
  const normalized = String(pattern);
  let item = state.config.items.find((i) => i.pattern === normalized);
  if (!item) {
    item = {
      id: "u" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36),
      ruleId: ++state.settings.itemSeq,
      pattern: normalized,
      budgetMinutes: 30,
      // Anti-infinite-scroll: 0 disables the cap / the cooldown.
      sessionLimitMinutes: 0,
      cooldownMinutes: 0,
      enabled: true,
      access,
    };
    state.config.items.push(item);
  }
  if (Number.isFinite(budgetMinutes) && budgetMinutes >= 0) {
    item.budgetMinutes = budgetMinutes;
  }
  item.access = access;
  return item;
}

export function removeItem(state, id) {
  const before = state.config.items.length;
  state.config.items = state.config.items.filter((i) => i.id !== id);
  return state.config.items.length < before;
}

export function setMasterEnabled(state, value) {
  state.config.masterEnabled = Boolean(value);
}
