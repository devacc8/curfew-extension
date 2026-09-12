import { load, mutate, onChanged } from "./common/storage.js";
import { applyI18n, msg } from "./ui/i18n.js";
import { applyTheme } from "./ui/theme.js";
import { grantItem, syncAccessFlags } from "./ui/access.js";
import { addSite } from "./ui/site-form.js";
import { dailyTotals } from "./common/budget.js";
import { formatDuration, remainingText, rowViewModel } from "./common/view.js";
import { dayKey, previousDayKey } from "./common/time.js";
import { guarded } from "./protect.js";

const els = {
  master: /** @type {HTMLInputElement} */ (document.getElementById("master")),
  totalsLine: /** @type {HTMLElement} */ (document.getElementById("totalsLine")),
  topSection: /** @type {HTMLElement} */ (document.getElementById("topSection")),
  topSites: /** @type {HTMLElement} */ (document.getElementById("topSites")),
  list: /** @type {HTMLElement} */ (document.getElementById("items")),
  pattern: /** @type {HTMLInputElement} */ (document.getElementById("pattern")),
  minutes: /** @type {HTMLInputElement} */ (document.getElementById("minutes")),
  add: /** @type {HTMLElement} */ (document.getElementById("add")),
  status: /** @type {HTMLElement} */ (document.getElementById("status")),
  openOptions: /** @type {HTMLElement} */ (document.getElementById("openOptions")),
  addCurrent: /** @type {HTMLElement} */ (document.getElementById("addCurrent")),
};

function setStatus(key) {
  els.status.textContent = msg(key);
}

function rejectPattern() {
  els.pattern.classList.add("invalid");
  setStatus("invalidPattern");
}

function renderTotals(state) {
  const today = dailyTotals(state, dayKey());
  const yesterday = dailyTotals(state, previousDayKey());
  els.totalsLine.textContent =
    `${msg("todayLabel")} ${formatDuration(today.totalSeconds, msg)} · ` +
    `${msg("yesterdayLabel")} ${formatDuration(yesterday.totalSeconds, msg)}`;
}

function renderTopSites(state) {
  const { topSites } = dailyTotals(state, dayKey());
  els.topSection.hidden = topSites.length === 0;
  els.topSites.textContent = "";
  for (const { site, seconds } of topSites.slice(0, 5)) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "site";
    name.textContent = site;
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = formatDuration(seconds, msg);
    li.append(name, time);
    els.topSites.append(li);
  }
}

function send(type, itemId) {
  return chrome.runtime.sendMessage({ type, itemId }).catch(() => null);
}

/**
 * The permission prompt steals focus and can close the popup mid-request
 * (tech doc Q5), so items are ALWAYS written first and access is reconciled
 * with the permissions API on every popup open.
 */
els.pattern.addEventListener("input", () => {
  els.pattern.classList.remove("invalid");
});

function buildRow(item, state) {
  const li = document.createElement("li");
  li.className = "site-row";

  const line1 = document.createElement("div");
  line1.className = "line";

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

  const now = Date.now();
  const vm = rowViewModel(state, item, now);
  const remaining = document.createElement("span");
  remaining.className = "remaining" + (vm.open ? "" : vm.cooling ? " cooling" : " closed");
  remaining.textContent = remainingText(vm, now, msg);

  line1.append(enabled, name, remaining);

  const bar = document.createElement("div");
  bar.className = "bar" + (vm.open ? "" : " done");
  const fill = document.createElement("i");
  const ratio = vm.effective > 0 ? Math.min(1, vm.used / vm.effective) : 1;
  fill.style.width = `${Math.round(ratio * 100)}%`;
  bar.append(fill);
  liveRows.push({ item, remaining, bar: fill });

  const line2 = document.createElement("div");
  line2.className = "line actions";

  const badge = document.createElement("span");
  badge.className = "badge" + (item.access === "granted" ? " granted" : "");
  badge.textContent = msg(item.access === "granted" ? "accessGranted" : "accessDenied");
  badge.title = msg(item.access === "granted" ? "badgeTitleGranted" : "badgeTitleDenied");

  line2.append(badge);

  const passes = state.usage.days[dayKey(now)]?.passes?.[item.pattern] ?? 0;
  if (passes > 0) {
    const chip = document.createElement("span");
    chip.className = "badge passes";
    // Read the configured pass length: a hardcoded 15 would lie the moment
    // passMinutes changes (it is a stored config value, not a constant).
    chip.textContent = `${passes}×${state.config.passMinutes}${msg("minutesShort")}`;
    chip.title = msg("passesTodayLabel");
    line2.append(chip);
  }

  if (item.access !== "granted") {
    const grant = document.createElement("button");
    grant.className = "mini grant";
    grant.textContent = msg("grantAccess");
    grant.addEventListener("click", async () => {
      grant.disabled = true;
      await grantItem(item);
    });
    line2.append(grant);
  }

  const block = document.createElement("button");
  block.className = "mini";
  block.textContent = msg("blockNow");
  block.addEventListener("click", () => send("blockNow", item.id));

  const remove = document.createElement("button");
  remove.className = "mini remove";
  remove.textContent = msg("remove");
  remove.addEventListener("click", async () => {
    await guarded(async () => {
      await mutate("item.remove", { id: item.id });
    });
  });

  line2.append(block, remove);

  li.append(line1, bar, line2);
  return li;
}

async function render() {
  const state = await load();
  applyTheme(state);
  const day = dayKey();
  const snapshot = JSON.stringify([
    state.config,
    state.runtime,
    state.usage.days[day] ?? null,
    state.usage.days[previousDayKey()] ?? null,
  ]);
  if (snapshot === lastPainted) return;
  lastPainted = snapshot;
  liveState = state;
  liveRows = [];
  els.master.checked = state.config.masterEnabled;
  renderTotals(state);
  renderTopSites(state);
  els.list.textContent = "";
  if (!state.config.items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = msg("empty");
    els.list.append(li);
    return;
  }
  for (const item of state.config.items) {
    els.list.append(buildRow(item, state));
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

els.add.addEventListener("click", async () => {
  const result = await addSite(els.pattern.value, Number(els.minutes.value));
  if (!result.ok) {
    if (result.error === "save") setStatus("saveFailed");
    else rejectPattern();
    return;
  }
  els.pattern.value = "";
  setStatus(result.granted ? "addedGranted" : "addedDenied");
  send("flush");
});

/** The host of the tab this popup was opened on. `activeTab` is granted by
 *  the action click, so this needs no host permission and no install warning. */
async function currentHost() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab?.url ?? "");
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.hostname;
  } catch {
    return null;
  }
}

els.addCurrent.addEventListener("click", async () => {
  const host = await currentHost();
  if (!host) {
    setStatus("noCurrentSite");
    return;
  }
  els.pattern.value = host;
  els.minutes.focus();
  setStatus("pressAddToGrant");
});

els.openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

let lastPainted = "";
let paintTimer = null;
let liveState = null;
let liveRows = [];
let flushPending = false;

/** Repaint every row once a second; flush the moment a budget is spent so the
 *  wall lands while the user is looking at the counter. */
function paintLive() {
  if (!liveState) return;
  const now = Date.now();
  let spent = false;
  for (const row of liveRows) {
    const vm = rowViewModel(liveState, row.item, now);
    row.remaining.textContent = remainingText(vm, now, msg);
    row.remaining.className = "remaining" + (vm.open ? "" : vm.cooling ? " cooling" : " closed");
    const ratio = vm.effective > 0 ? Math.min(1, vm.used / vm.effective) : 1;
    row.bar.style.width = `${Math.round(ratio * 100)}%`;
    if (vm.open && vm.used >= vm.effective) spent = true;
  }
  if (spent && !flushPending) {
    flushPending = true;
    send("flush").finally(() => {
      flushPending = false;
    });
  }
}

function scheduleRender() {
  if (paintTimer) return;
  paintTimer = setTimeout(() => {
    paintTimer = null;
    render();
  }, 100);
}

onChanged(scheduleRender);
applyI18n();
render();
// Credit whatever the SW has not flushed yet (its tick is 5 min), then
// repaint: without this the dashboard shows a frozen "1 min left" while
// the wall is actually due, the freeze the users kept reporting. The
// access-flag write goes through the SW queue too, so it cannot clobber
// the credit; the chain just keeps the paint after both.
send("flush")
  .then(() => syncAccessFlags())
  .catch((error) => console.error("curfew: popup init failed", error))
  .finally(scheduleRender);
setInterval(paintLive, 1000);
