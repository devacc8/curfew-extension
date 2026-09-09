import { migrate, removeItem, setMasterEnabled, upsertItem } from "./storage.js";
import { pruneDays } from "./transfer.js";

/** Clamp a user-supplied budget; the UI clamps too, this is the last line. */
function budgetMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 30;
  return Math.max(0, Math.min(1440, Math.round(n)));
}

/** Clamp the daily pass allowance (absolute; 0 disables passes). */
function passesPerDay(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(99, Math.round(n)));
}

const access = (value) => (value === "granted" ? "granted" : "denied");

/**
 * The complete set of state mutations. Each entry mutates the state in place
 * (the `update()` convention) and returns a JSON-serializable result the
 * caller gets back over the wire.
 *
 * Pages never touch storage directly: they send `{type: "state:apply", op,
 * payload}` and the service worker applies it inside its serialized mutation
 * queue. That is what makes a page write unable to clobber a concurrent time
 * credit with a stale snapshot — the storage API has no transactions.
 */
const OPS = {
  /** Create or update an item by pattern; returns the identity the page needs. */
  "item.add": (state, { pattern, budgetMinutes: minutes, access: a }) => {
    const item = upsertItem(state, {
      pattern: String(pattern),
      budgetMinutes: budgetMinutes(minutes),
      access: access(a),
    });
    return { id: item.id, ruleId: item.ruleId, pattern: item.pattern };
  },

  /** Patch one item; only the three user-editable fields are addressable. */
  "item.update": (state, { id, fields }) => {
    const item = state.config.items.find((i) => i.id === id);
    if (!item) return { updated: false };
    if (fields && Object.hasOwn(fields, "enabled")) item.enabled = Boolean(fields.enabled);
    if (fields && Object.hasOwn(fields, "budgetMinutes")) {
      item.budgetMinutes = budgetMinutes(fields.budgetMinutes);
    }
    if (fields && Object.hasOwn(fields, "access")) item.access = access(fields.access);
    return { updated: true };
  },

  /** Apply the permissions probe for many items at once. A `null` grant is
   *  "unknown" (the probe threw) and keeps the previous flag — forcing
   *  denied would silently disable tracking and enforcement. */
  "item.accessBatch": (state, { entries }) => {
    let changed = 0;
    for (const entry of entries ?? []) {
      if (!entry || entry.granted === null) continue;
      const item = state.config.items.find((i) => i.id === entry.id);
      if (!item) continue;
      const next = access(entry.granted ? "granted" : "denied");
      if (item.access !== next) {
        item.access = next;
        changed += 1;
      }
    }
    return { changed };
  },

  "item.remove": (state, { id }) => ({ removed: removeItem(state, id) }),

  "master.set": (state, { value }) => {
    setMasterEnabled(state, value);
    return { value: state.config.masterEnabled };
  },

  "passes.set": (state, { value }) => {
    state.config.unblockPassesPerDay = passesPerDay(value);
    return { value: state.config.unblockPassesPerDay };
  },

  /** Willpower Protection config, or null to switch it off. */
  "protection.set": (state, { value }) => {
    state.settings.protection = value ?? null;
    return { value: state.settings.protection };
  },

  /** Whole-document import: migrated and pruned here, never trusted raw. */
  "state.import": (state, { imported }) => {
    const next = migrate(imported);
    pruneDays(next, 60);
    Object.assign(state, next);
    return { items: state.config.items.length };
  },
};

/**
 * Apply one op to `state` in place.
 * @param state - the whole state document.
 * @param op - one key of {@link OPS}.
 * @param payload - op-specific, JSON-valued.
 * @returns the op's JSON-serializable result.
 * @throws when the op name is unknown (a programming error, not user input).
 */
export function applyOp(state, op, payload) {
  const handler = Object.hasOwn(OPS, op) ? OPS[op] : undefined;
  if (!handler) throw new Error(`curfew: unknown state op "${op}"`);
  return handler(state, payload ?? {});
}
