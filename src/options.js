import { load, mutate, onChanged } from "./common/storage.js";
import { applyI18n, msg } from "./ui/i18n.js";
import { applyTheme } from "./ui/theme.js";
import { grantItem, syncAccessFlags } from "./ui/access.js";
import { addSite } from "./ui/site-form.js";
import { encodeExport, decodeExport } from "./common/transfer.js";
import { dayKey } from "./common/time.js";
import { guarded, enableProtection, disableProtection } from "./protect.js";

const els = {
  master: /** @type {HTMLInputElement} */ (document.getElementById("master")),
  pattern: /** @type {HTMLInputElement} */ (document.getElementById("pattern")),
  minutes: /** @type {HTMLInputElement} */ (document.getElementById("minutes")),
  add: /** @type {HTMLElement} */ (document.getElementById("add")),
  list: /** @type {HTMLElement} */ (document.getElementById("items")),
  status: /** @type {HTMLElement} */ (document.getElementById("status")),
  export: /** @type {HTMLElement} */ (document.getElementById("export")),
  import: /** @type {HTMLInputElement} */ (document.getElementById("import")),
  dataStatus: /** @type {HTMLElement} */ (document.getElementById("dataStatus")),
  protectStatus: /** @type {HTMLElement} */ (document.getElementById("protectStatus")),
  protectToggle: /** @type {HTMLElement} */ (document.getElementById("protectToggle")),
  protectMsg: /** @type {HTMLElement} */ (document.getElementById("protectMsg")),
  passesLimit: /** @type {HTMLInputElement} */ (document.getElementById("passesLimit")),
  search: /** @type {HTMLInputElement} */ (document.getElementById("siteSearch")),
  themeChoice: /** @type {HTMLElement} */ (document.getElementById("themeChoice")),
};

let siteFilter = "";

function setStatus(key) {
  els.status.textContent = msg(key);
}

function rejectPattern() {
  els.pattern.classList.add("invalid");
  setStatus("invalidPattern");
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
  input.value = String(value);
  input.title = title;
  input.addEventListener("change", async () => {
    const next = Math.max(0, Math.min(1440, Number(input.value) || 0));
    const commit = async () => {
      await apply(next);
      input.value = String(next);
    };
    if (relaxes(next)) return commit();
    const done = await guarded(commit);
    if (!done) input.value = String(value);
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
      await grantItem(item);
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
  applyTheme(state);
  paintThemeChoice(state.settings.theme ?? "system");
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

/** One button per choice, the active one pressed. */
function paintThemeChoice(theme) {
  const buttons = /** @type {NodeListOf<HTMLElement>} */ (
    els.themeChoice.querySelectorAll("[data-theme-value]")
  );
  for (const button of buttons) {
    button.setAttribute("aria-pressed", String(button.dataset.themeValue === theme));
  }
}

els.themeChoice.addEventListener("click", async (event) => {
  const target = /** @type {HTMLElement | null} */ (event.target);
  const button = target?.closest("[data-theme-value]");
  if (!button) return;
  const value = button.getAttribute("data-theme-value");
  paintThemeChoice(value);
  const result = await mutate("theme.set", { value });
  if (result === null) setStatus("saveFailed");
});

els.add.addEventListener("click", async () => {
  const result = await addSite(els.pattern.value, Number(els.minutes.value));
  if (!result.ok) {
    if (result.error === "save") setStatus("saveFailed");
    else rejectPattern();
    return;
  }
  els.pattern.value = "";
  setStatus(result.granted ? "addedGranted" : "addedDenied");
});

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

async function importData(file) {
  const text = await file.text();
  const result = decodeExport(text);
  if (!result.ok) {
    els.dataStatus.textContent = msg("importFailed");
    return;
  }
  // Importing is a permissive change: it can rewrite every budget and even
  // switch protection off, so it sits behind the same challenge as the
  // other relaxations (README "Willpower Protection"). The file is only
  // parsed before the gate; nothing is written until it is solved.
  const done = await guarded(async () => {
    // The SW migrates and prunes the payload before it touches the document.
    await mutate("state.import", { imported: result.state });
  });
  if (!done) return;
  await syncAccessFlags(await load());
  els.dataStatus.textContent = msg("imported");
}

async function renderProtection() {
  const state = await load();
  const on = Boolean(state.settings.protection);
  els.protectStatus.textContent = on ? msg("protectStatusOn") : msg("protectStatusOff");
  els.protectStatus.className = on ? "status-on" : "status-off";
  els.protectToggle.textContent = on ? msg("protectDisable") : msg("protectEnable");
  if (document.activeElement !== els.passesLimit) {
    els.passesLimit.value = String(state.config.passesPerDay);
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
  const previous = (await load()).config.passesPerDay;
  const value = Math.max(0, Math.min(99, Number(els.passesLimit.value) || 0));
  const apply = async () => {
    await mutate("passes.set", { value });
    els.passesLimit.value = String(value);
  };
  if (value <= previous) return apply();
  const done = await guarded(apply);
  if (!done) els.passesLimit.value = String(previous);
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
load().then(syncAccessFlags).then(scheduleRender);
render();

const prefill = new URLSearchParams(location.search).get("add");
if (prefill) {
  els.pattern.value = prefill;
  els.pattern.focus();
  els.status.textContent = msg("pressAddToGrant");
}
