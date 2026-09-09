import { load, mutate, onChanged } from "./common/storage.js";
import { parsePattern, patternToString, toMatchOrigins } from "./common/patterns.js";
import { encodeExport, decodeExport } from "./common/transfer.js";
import { dayKey } from "./common/time.js";
import { guarded, enableProtection, disableProtection } from "./protect.js";

const els = {
  master: document.getElementById("master"),
  pattern: document.getElementById("pattern"),
  minutes: document.getElementById("minutes"),
  add: document.getElementById("add"),
  list: document.getElementById("items"),
  status: document.getElementById("status"),
  export: document.getElementById("export"),
  import: document.getElementById("import"),
  dataStatus: document.getElementById("dataStatus"),
  protectStatus: document.getElementById("protectStatus"),
  protectToggle: document.getElementById("protectToggle"),
  protectMsg: document.getElementById("protectMsg"),
  passesLimit: document.getElementById("passesLimit"),
  search: document.getElementById("siteSearch"),
};

let siteFilter = "";

const msg = (key) => chrome.i18n.getMessage(key);

function applyI18n() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = msg(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    el.placeholder = msg(el.dataset.i18nPlaceholder);
  }
  for (const el of document.querySelectorAll("[data-i18n-title]")) {
    el.title = msg(el.dataset.i18nTitle);
  }
}

function setStatus(key) {
  els.status.textContent = msg(key);
}

function rejectPattern() {
  els.pattern.classList.add("invalid");
  setStatus("invalidPattern");
}

async function requestAccess(pattern) {
  try {
    return await chrome.permissions.request({ origins: toMatchOrigins(pattern) });
  } catch {
    return false;
  }
}

async function addSite() {
  const parsed = parsePattern(els.pattern.value);
  if (!parsed.ok) {
    rejectPattern();
    return;
  }
  const minutes = Number(els.minutes.value);
  const budget = Number.isFinite(minutes) ? Math.max(0, Math.min(1440, minutes)) : 30;
  const patternStr = patternToString(parsed.pattern);
  const created = await mutate("item.add", {
    pattern: patternStr,
    budgetMinutes: budget,
    access: "denied",
  });
  els.pattern.value = "";
  const granted = await requestAccess(parsed.pattern);
  await mutate("item.update", {
    id: created?.id,
    fields: { access: granted ? "granted" : "denied" },
  });
  setStatus(granted ? "addedGranted" : "addedDenied");
}

/**
 * A compact numeric item field. The permissive direction (a bigger budget, a
 * longer session limit, a SHORTER cooldown) goes behind the challenge; the
 * restrictive direction applies immediately. `relaxes(next)` decides.
 */
function guardedNumberField({ value, title, unit, relaxes, apply }) {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "budget";
  input.min = "0";
  input.max = "1440";
  input.value = value;
  input.title = title;
  input.addEventListener("change", async () => {
    const next = Math.max(0, Math.min(1440, Number(input.value) || 0));
    const commit = async () => {
      await apply(next);
      input.value = next;
    };
    if (relaxes(next)) return commit();
    const done = await guarded(commit);
    if (!done) input.value = value;
  });
  const label = document.createElement("span");
  label.className = "unit";
  label.textContent = unit;
  return [input, label];
}

function buildRow(item) {
  const li = document.createElement("li");

  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = item.enabled;
  enabled.addEventListener("change", async () => {
    if (!enabled.checked) {
      const done = await guarded(async () => {
        await mutate("item.update", { id: item.id, fields: { enabled: false } });
      });
      if (!done) enabled.checked = true;
      return;
    }
    await mutate("item.update", { id: item.id, fields: { enabled: true } });
  });

  const name = document.createElement("span");
  name.className = "pattern";
  name.textContent = item.pattern;

  const [budget, budgetUnit] = guardedNumberField({
    value: item.budgetMinutes,
    title: msg("budgetUnit"),
    unit: msg("budgetUnit"),
    relaxes: (next) => next > item.budgetMinutes,
    apply: (next) => mutate("item.update", { id: item.id, fields: { budgetMinutes: next } }),
  });
  const [sessionLimit, sessionUnit] = guardedNumberField({
    value: item.sessionLimitMinutes ?? 0,
    title: msg("sessionLimitTitle"),
    unit: msg("sessionUnit"),
    relaxes: (next) => next > (item.sessionLimitMinutes ?? 0),
    apply: (next) =>
      mutate("item.update", { id: item.id, fields: { sessionLimitMinutes: next } }),
  });
  const [cooldown, cooldownUnit] = guardedNumberField({
    value: item.cooldownMinutes ?? 0,
    title: msg("cooldownTitle"),
    unit: msg("cooldownUnit"),
    // A SHORTER break is the permissive direction, so it needs the challenge.
    relaxes: (next) => next <= (item.cooldownMinutes ?? 0),
    apply: (next) => mutate("item.update", { id: item.id, fields: { cooldownMinutes: next } }),
  });

  const badge = document.createElement("span");
  badge.className = "badge" + (item.access === "granted" ? " granted" : "");
  badge.textContent = msg(item.access === "granted" ? "accessGranted" : "accessDenied");

  li.append(
    enabled,
    name,
    budget,
    budgetUnit,
    sessionLimit,
    sessionUnit,
    cooldown,
    cooldownUnit,
    badge
  );

  if (item.access !== "granted") {
    const grant = document.createElement("button");
    grant.className = "grant";
    grant.textContent = msg("grantAccess");
    grant.addEventListener("click", async () => {
      grant.disabled = true;
      const parsed = parsePattern(item.pattern);
      if (!parsed.ok) return;
      const ok = await requestAccess(parsed.pattern);
      await mutate("item.update", {
        id: item.id,
        fields: { access: ok ? "granted" : "denied" },
      });
    });
    li.append(grant);
  }

  const remove = document.createElement("button");
  remove.className = "remove";
  remove.textContent = msg("remove");
  remove.addEventListener("click", async () => {
    await guarded(async () => {
      await mutate("item.remove", { id: item.id });
    });
  });
  li.append(remove);

  return li;
}

async function render() {
  const state = await load();
  const snapshot = JSON.stringify([state.config, state.runtime, state.usage]);
  if (snapshot === lastPainted) return;
  lastPainted = snapshot;
  els.master.checked = state.config.masterEnabled;
  const showSearch = state.config.items.length > 10;
  els.search.hidden = !showSearch;
  if (!showSearch) siteFilter = "";
  els.list.textContent = "";
  if (!state.config.items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = msg("empty");
    els.list.append(li);
    return;
  }
  const visible = state.config.items.filter((item) =>
    item.pattern.toLowerCase().includes(siteFilter)
  );
  if (!visible.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = msg("noMatches");
    els.list.append(li);
    return;
  }
  for (const item of visible) {
    els.list.append(buildRow(item));
  }
}

els.master.addEventListener("change", async () => {
  if (!els.master.checked) {
    const done = await guarded(async () => {
      await mutate("master.set", { value: false });
    });
    if (!done) {
      els.master.checked = true;
      return;
    }
    return;
  }
  await mutate("master.set", { value: true });
});

els.add.addEventListener("click", addSite);

els.pattern.addEventListener("input", () => {
  els.pattern.classList.remove("invalid");
});

async function exportData() {
  const state = await load();
  const blob = new Blob([encodeExport(state, new Date().toISOString())], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `curfew-export-${dayKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function reverifyAccess() {
  const state = await load();
  const checks = await Promise.all(
    state.config.items.map(async (item) => {
      const parsed = parsePattern(item.pattern);
      if (!parsed.ok) return [item.id, false];
      try {
        const ok = await chrome.permissions.contains({
          origins: toMatchOrigins(parsed.pattern),
        });
        return [item.id, ok];
      } catch {
        // Unknown, not denied: a failed permissions call must not silently
        // switch off tracking and enforcement for a still-granted site.
        return [item.id, null];
      }
    })
  );
  await mutate("item.accessBatch", {
    entries: checks.map(([id, granted]) => ({ id, granted })),
  });
}

async function importData(file) {
  const text = await file.text();
  const result = decodeExport(text);
  if (!result.ok) {
    els.dataStatus.textContent = msg("importFailed");
    return;
  }
  // Importing is a permissive change — it can rewrite every budget and even
  // switch protection off — so it sits behind the same challenge as the
  // other relaxations (README "Willpower Protection"). The file is only
  // parsed before the gate; nothing is written until it is solved.
  const done = await guarded(async () => {
    // The SW migrates and prunes the payload before it touches the document.
    await mutate("state.import", { imported: result.state });
  });
  if (!done) return;
  await reverifyAccess();
  els.dataStatus.textContent = msg("imported");
}

async function renderProtection() {
  const state = await load();
  const on = Boolean(state.settings.protection);
  els.protectStatus.textContent = on ? msg("protectStatusOn") : msg("protectStatusOff");
  els.protectStatus.className = on ? "status-on" : "status-off";
  els.protectToggle.textContent = on ? msg("protectDisable") : msg("protectEnable");
  if (document.activeElement !== els.passesLimit) {
    els.passesLimit.value = state.config.unblockPassesPerDay;
  }
}

els.search.addEventListener("input", () => {
  siteFilter = els.search.value.trim().toLowerCase();
  render();
});

els.protectToggle.addEventListener("click", async () => {
  const state = await load();
  const on = Boolean(state.settings.protection);
  const done = on ? await disableProtection() : await enableProtection();
  if (done) {
    els.protectMsg.textContent = msg(on ? "protectOffMsg" : "protectEnabled");
  }
  renderProtection();
});

els.passesLimit.addEventListener("change", async () => {
  const previous = (await load()).config.unblockPassesPerDay;
  const value = Math.max(0, Math.min(99, Number(els.passesLimit.value) || 0));
  const apply = async () => {
    await mutate("passes.set", { value });
    els.passesLimit.value = value;
  };
  if (value <= previous) return apply();
  const done = await guarded(apply);
  if (!done) els.passesLimit.value = previous;
});
els.export.addEventListener("click", exportData);

els.import.addEventListener("change", async () => {
  const file = els.import.files[0];
  els.import.value = "";
  if (file) await importData(file);
});

let lastPainted = "";
let paintTimer = null;

function scheduleRender() {
  if (paintTimer) return;
  paintTimer = setTimeout(() => {
    paintTimer = null;
    render();
  }, 100);
}

onChanged(scheduleRender);
applyI18n();
renderProtection();
reverifyAccess().then(scheduleRender);
render();

const prefill = new URLSearchParams(location.search).get("add");
if (prefill) {
  els.pattern.value = prefill;
  els.pattern.focus();
  els.status.textContent = msg("pressAddToGrant");
}
