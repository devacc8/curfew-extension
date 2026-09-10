import { test } from "node:test";
import assert from "node:assert/strict";

function stubChromeStorage() {
  const data = new Map();
  const listeners = [];
  return {
    api: {
      storage: {
        onChanged: {
          addListener(fn) {
            listeners.push(fn);
          },
        },
        local: {
          async get(key) {
            if (!data.has(key)) return {};
            return { [key]: structuredClone(data.get(key)) };
          },
          async set(obj) {
            const changes = {};
            for (const [k, v] of Object.entries(obj)) {
              data.set(k, structuredClone(v));
              changes[k] = { newValue: structuredClone(v) };
            }
            for (const fn of listeners) fn(changes, "local");
          },
        },
      },
      runtime: {
        async sendMessage() {
          throw new Error("sendMessage stub not installed");
        },
      },
    },
    data,
  };
}

function setChrome() {
  const stub = stubChromeStorage();
  globalThis.chrome = stub.api;
  return stub;
}

setChrome();
const { load, update, mutate, migrate, onChanged, upsertItem, removeItem, setMasterEnabled } =
  await import("../src/common/storage.js");

test("migrate sanitizes a hostile shape instead of bricking consumers", () => {
  const state = migrate({
    schema: 1,
    config: { items: {}, masterEnabled: "nope", graceSeconds: "x" },
    usage: { days: null },
    runtime: null,
    settings: null,
    session: { pattern: 5, phase: "counting" },
  });
  assert.deepEqual(state.config.items, []);
  assert.deepEqual(state.usage.days, {});
  assert.deepEqual(state.runtime, { passUntil: {}, cooldownUntil: {}, dayOverrides: {} });
  assert.equal(state.session, null);
  assert.equal(state.config.masterEnabled, true);
  assert.equal(state.config.graceSeconds, 10);
  assert.equal(state.config.passMinutes, 15);
  assert.equal(state.settings.itemSeq, 1000);
});

test("migrate repairs junk item fields and keeps future ones", () => {
  const state = migrate({
    schema: 1,
    config: {
      items: [
        {
          id: "keep",
          pattern: "x.com",
          ruleId: 1005,
          budgetMinutes: "45",
          enabled: 0,
          access: "weird",
          future: "kept",
        },
        { pattern: "x.com", ruleId: 1006 },
        { pattern: "", ruleId: 7 },
        "junk",
        { pattern: "y.com", ruleId: 1005 },
      ],
    },
  });
  assert.equal(state.config.items.length, 2);
  const [first, second] = state.config.items;
  assert.equal(first.id, "keep");
  assert.equal(first.budgetMinutes, 45);
  assert.equal(first.enabled, false);
  assert.equal(first.access, "denied");
  assert.equal(first.future, "kept");
  assert.equal(second.pattern, "y.com");
  assert.notEqual(second.ruleId, first.ruleId);
  assert.ok(state.settings.itemSeq >= Math.max(...state.config.items.map((i) => i.ruleId)));
});

test("migrate coerces string day counters to numbers (no concatenation)", () => {
  const state = migrate({
    schema: 1,
    usage: {
      days: {
        "2026-09-02": {
          patternSeconds: { "x.com": "600" },
          passes: { "x.com": "2" },
          bySite: {},
        },
        "not-a-day": { patternSeconds: { "x.com": 5 } },
      },
    },
  });
  assert.deepEqual(state.usage.days["2026-09-02"].patternSeconds, { "x.com": 600 });
  assert.deepEqual(state.usage.days["2026-09-02"].passes, { "x.com": 2 });
  assert.equal(state.usage.days["not-a-day"], undefined);
});

test("migrate is idempotent so load() never rewrites on every read", () => {
  const once = migrate({ schema: 1, config: { items: [{ pattern: "x.com" }] } });
  assert.equal(JSON.stringify(migrate(once)), JSON.stringify(once));
});

test("load seeds defaults on first run", async () => {
  setChrome();
  const state = await load();
  assert.equal(state.schema, 2);
  assert.equal(state.config.masterEnabled, true);
  assert.equal(state.config.graceSeconds, 10);
  assert.equal(state.config.passMinutes, 15);
  assert.equal(state.config.passesPerDay, 3);
  assert.deepEqual(state.config.items, []);
  assert.deepEqual(state.usage, { days: {} });
  assert.equal(state.session, null);
  assert.deepEqual(state.runtime, { passUntil: {}, cooldownUntil: {}, dayOverrides: {} });
  assert.equal(state.settings.itemSeq, 1000);
  assert.equal(state.settings.protection, null);
});

test("load persists the seeded state", async () => {
  setChrome();
  await load();
  const second = await load();
  assert.deepEqual(second.config, {
    masterEnabled: true,
    graceSeconds: 10,
    passMinutes: 15,
    passesPerDay: 3,
    items: [],
  });
});

test("update mutates in place and persists whole state", async () => {
  setChrome();
  await update((state) => setMasterEnabled(state, false));
  const state = await load();
  assert.equal(state.config.masterEnabled, false);
});

test("regression: a page-style concise mutator must not replace the state", async () => {
  setChrome();
  await update((state) => upsertItem(state, { pattern: "x.com", budgetMinutes: 30 }));
  const state = await load();
  assert.equal(state.schema, 2);
  assert.equal(state.config.items.length, 1);
  assert.equal(state.config.items[0].pattern, "x.com");
  assert.deepEqual(state.usage, { days: {} });
});

test("update returns the persisted state object", async () => {
  setChrome();
  const out = await update((state) => setMasterEnabled(state, false));
  assert.equal(out.config.masterEnabled, false);
  const reloaded = await load();
  assert.equal(reloaded.config.masterEnabled, false);
});

test("upsertItem creates an item with a stable ruleId from the sequence", async () => {
  setChrome();
  let created;
  await update((state) => {
    created = upsertItem(state, { pattern: "*.reddit.com", budgetMinutes: 15, access: "granted" });
  });
  assert.match(created.id, /^u/);
  assert.equal(created.ruleId, 1001);
  assert.equal(created.enabled, true);

  await update((state) => {
    upsertItem(state, { pattern: "x.com", budgetMinutes: 5, access: "denied" });
  });
  const state = await load();
  assert.equal(state.settings.itemSeq, 1002);
  assert.equal(state.config.items.length, 2);
  assert.equal(state.config.items[1].ruleId, 1002);
});

test("upsertItem dedupes by pattern and keeps id and ruleId", async () => {
  setChrome();
  let first;
  await update((state) => {
    first = upsertItem(state, { pattern: "*.reddit.com", budgetMinutes: 15 });
  });
  await update((state) => {
    upsertItem(state, { pattern: "*.reddit.com", budgetMinutes: 45, access: "denied" });
  });
  const state = await load();
  assert.equal(state.config.items.length, 1);
  const item = state.config.items[0];
  assert.equal(item.id, first.id);
  assert.equal(item.ruleId, first.ruleId);
  assert.equal(item.budgetMinutes, 45);
  assert.equal(item.access, "denied");
});

test("removeItem deletes by id", async () => {
  setChrome();
  let id;
  await update((state) => {
    id = upsertItem(state, { pattern: "x.com", budgetMinutes: 10 }).id;
  });
  let removed;
  await update((state) => {
    removed = removeItem(state, id);
  });
  assert.equal(removed, true);
  const state = await load();
  assert.deepEqual(state.config.items, []);
});

test("migrate fills missing top-level keys", async () => {
  setChrome();
  const partial = { schema: 1, config: { items: [{ id: "u0", pattern: "a.com" }] } };
  await update((s) => Object.assign(s, partial));
  const state = await load();
  assert.equal(state.schema, 2);
  assert.equal(state.config.items.length, 1);
  assert.deepEqual(state.usage, { days: {} });
  assert.deepEqual(state.runtime, { passUntil: {}, cooldownUntil: {}, dayOverrides: {} });
  assert.equal(state.session, null);
});

test("migrate: a newer schema resolves to defaults (the IMPORT path)", () => {
  // An imported file from the future must never be trusted...
  const state = migrate({ schema: 99, config: { items: [{ pattern: "x.com" }] }, future: true });
  assert.equal(state.schema, 2);
  assert.deepEqual(state.config.items, []);
  assert.equal(state.future, undefined);
});

test("migrate drops the legacy password-based protection", async () => {
  setChrome();
  await update((s) => {
    s.settings.protection = { salt: "abcd", hash: "ef12" };
  });
  const state = await load();
  assert.equal(state.settings.protection, null);
});

test("onChanged fires with the new whole state", async () => {
  setChrome();
  await load();
  const seen = [];
  onChanged((state) => seen.push(state.config.masterEnabled));
  await update((state) => setMasterEnabled(state, false));
  await update((state) => setMasterEnabled(state, true));
  assert.deepEqual(seen, [false, true]);
});

test("mutate sends state:apply to the worker and returns the op result", async () => {
  const stub = setChrome();
  const seen = [];
  stub.api.runtime.sendMessage = async (message) => {
    seen.push(message);
    return { ok: true, result: { id: "u9" } };
  };
  const result = await mutate("item.add", { pattern: "x.com" });
  assert.deepEqual(result, { id: "u9" });
  assert.deepEqual(seen, [
    { type: "state:apply", op: "item.add", payload: { pattern: "x.com" } },
  ]);
});

test("mutate returns null when the worker refuses the op", async () => {
  const stub = setChrome();
  stub.api.runtime.sendMessage = async () => ({ ok: false });
  assert.equal(await mutate("nope", {}), null);
});

test("migrate v1 -> v2 renames the pass vocabulary", () => {
  const v1 = {
    schema: 1,
    config: {
      masterEnabled: true,
      graceSeconds: 10,
      unblockMinutes: 15,
      unblockPassesPerDay: 3,
      items: [{ id: "u1", ruleId: 1001, pattern: "x.com", budgetMinutes: 25, enabled: true, access: "granted" }],
    },
    usage: {
      days: {
        "2026-09-08": { patternSeconds: { "x.com": 600 }, unblocks: { "x.com": 2 }, bySite: { "x.com": 600 } },
      },
    },
    runtime: { unblockUntil: { "x.com": 123 }, dayOverrides: {} },
  };
  const state = migrate(v1);
  assert.equal(state.schema, 2);
  assert.equal(state.config.passMinutes, 15);
  assert.equal(state.config.passesPerDay, 3);
  assert.equal(state.config.unblockMinutes, undefined);
  assert.equal(state.config.unblockPassesPerDay, undefined);
  assert.deepEqual(state.runtime.passUntil, { "x.com": 123 });
  assert.equal(state.runtime.unblockUntil, undefined);
  assert.deepEqual(state.usage.days["2026-09-08"].passes, { "x.com": 2 });
  assert.equal(state.usage.days["2026-09-08"].unblocks, undefined);
  assert.equal(state.usage.days["2026-09-08"].patternSeconds["x.com"], 600);
});

test("load never overwrites a document from a newer build", async () => {
  const stub = setChrome();
  const newer = {
    schema: 99,
    config: {
      masterEnabled: true,
      graceSeconds: 10,
      passMinutes: 15,
      passesPerDay: 2,
      items: [
        {
          id: "u1",
          ruleId: 1001,
          pattern: "x.com",
          budgetMinutes: 25,
          enabled: true,
          access: "granted",
        },
      ],
    },
    usage: { days: { "2026-09-09": { patternSeconds: { "x.com": 600 }, passes: { "x.com": 1 }, bySite: { "x.com": 600 } } } },
    session: null,
    runtime: { passUntil: { "x.com": 123 }, cooldownUntil: {}, dayOverrides: {} },
    settings: { version: 1, itemSeq: 1001, protection: { kind: "equation" } },
  };
  stub.data.set("curfew", structuredClone(newer));

  const state = await load();

  // The stored document is untouched — this is the data-loss guard.
  assert.equal(stub.data.get("curfew").schema, 99);
  assert.equal(stub.data.get("curfew").config.items.length, 1);
  // ...and the caller still gets a usable view of it.
  assert.equal(state.config.items.length, 1);
  assert.equal(state.config.passMinutes, 15);
  assert.equal(state.config.passesPerDay, 2);
  assert.equal(state.usage.days["2026-09-09"].passes["x.com"], 1);
  assert.equal(state.settings.protection.kind, "equation");
});
