const KEY = "curfew";
const SCHEMA = 1;

function defaults() {
  return {
    schema: SCHEMA,
    config: {
      masterEnabled: true,
      graceSeconds: 10,
      unblockMinutes: 15,
      unblockPassesPerDay: 3,
      items: [],
    },
    usage: { days: {} },
    session: null,
    runtime: { unblockUntil: {}, dayOverrides: {} },
    settings: { version: 1, itemSeq: 1000, protection: null },
  };
}

const MIGRATIONS = {};

/** Resolve any stored/imported shape into the current schema. Pure, exported
 *  for the import pipeline (transfer.js). */
export function migrate(state) {
  if (!state || typeof state !== "object" || state.schema > SCHEMA) {
    return defaults();
  }
  let s = state;
  while (s.schema < SCHEMA) {
    const step = MIGRATIONS[s.schema];
    if (!step) return defaults();
    s = step(s);
  }
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
  return merged;
}

/** Load state, seeding/migrating on disk only when the shape changes. */
export async function load() {
  let box;
  try {
    box = await chrome.storage.local.get(KEY);
  } catch (error) {
    // After an extension reload, orphaned pages fail every chrome.* call
    // with "Extension context invalidated" — reload instead of dying.
    if (typeof location !== "undefined" && String(error?.message).includes("context invalidated")) {
      location.reload();
    }
    throw error;
  }
  const raw = box[KEY];
  const state = migrate(raw ?? defaults());
  if (!raw || JSON.stringify(raw) !== JSON.stringify(state)) {
    await chrome.storage.local.set({ [KEY]: state });
  }
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
  if (JSON.stringify(state) !== before) {
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
  const response = await chrome.runtime.sendMessage({
    type: "state:apply",
    op,
    payload,
  });
  return response?.ok ? response.result : null;
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
