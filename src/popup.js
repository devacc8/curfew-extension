import {
  load,
  update,
  upsertItem,
  removeItem,
  setMasterEnabled,
  onChanged,
} from "./common/storage.js";
import { parsePattern, patternToString, toMatchOrigins } from "./common/patterns.js";
import { secondsUsedToday, dailyTotals, effectiveBudgetSeconds } from "./common/budget.js";
import { isOpen } from "./common/rules.js";
import { dayKey, previousDayKey } from "./common/time.js";
import { guarded } from "./protect.js";

const els = {
  master: document.getElementById("master"),
  totalsLine: document.getElementById("totalsLine"),
  topSection: document.getElementById("topSection"),
  topSites: document.getElementById("topSites"),
  list: document.getElementById("items"),
  pattern: document.getElementById("pattern"),
  minutes: document.getElementById("minutes"),
  add: document.getElementById("add"),
  status: document.getElementById("status"),
  openOptions: document.getElementById("openOptions"),
};

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

function formatDuration(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} ${msg("minutesShort")}`;
  return `${Math.floor(m / 60)}h ${m % 60}${msg("minutesShort")}`;
}

/** Remaining time rounds UP: "1 min left" must mean the wall is not due yet,
 *  never "somewhere between 30 and 89 seconds left" (Math.round showed 1 min
 *  with less than a minute on the clock, which read as a frozen counter). */
function formatRemaining(sec) {
  const m = Math.ceil(sec / 60);
  if (m < 60) return `${m} ${msg("minutesShort")}`;
  return `${Math.floor(m / 60)}h ${m % 60}${msg("minutesShort")}`;
}

function renderTotals(state) {
  const today = dailyTotals(state, dayKey());
  const yesterday = dailyTotals(state, previousDayKey());
  els.totalsLine.textContent =
    `${msg("todayLabel")} ${formatDuration(today.totalSeconds)} · ` +
    `${msg("yesterdayLabel")} ${formatDuration(yesterday.totalSeconds)}`;
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
    time.textContent = formatDuration(seconds);
    li.append(name, time);
    els.topSites.append(li);
  }
}

async function requestAccess(pattern) {
  try {
    return await chrome.permissions.request({ origins: toMatchOrigins(pattern) });
  } catch {
    return false;
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
async function syncAccessFlags() {
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
        // A thrown permissions call is "unknown", not "denied": forcing
        // denied would silently disable tracking AND enforcement for a site
        // that is still granted (the wall would never come).
        return [item.id, null];
      }
    })
  );
  await update((s) => {
    for (const [id, ok] of checks) {
      if (ok === null) continue;
      const it = s.config.items.find((i) => i.id === id);
      if (it) it.access = ok ? "granted" : "denied";
    }
  });
}

async function grantItem(item) {
  const parsed = parsePattern(item.pattern);
  if (!parsed.ok) return;
  const granted = await requestAccess(parsed.pattern);
  await update((s) => {
    const it = s.config.items.find((i) => i.id === item.id);
    if (it) it.access = granted ? "granted" : "denied";
  });
}

async function addSite(rawPattern, minutes) {
  const parsed = parsePattern(rawPattern);
  if (!parsed.ok) {
    rejectPattern();
    return;
  }
  const budget = Number.isFinite(minutes) ? Math.max(0, Math.min(1440, minutes)) : 30;
  const patternStr = patternToString(parsed.pattern);
  await update((state) =>
    upsertItem(state, { pattern: patternStr, budgetMinutes: budget, access: "denied" })
  );
  els.pattern.value = "";
  const granted = await requestAccess(parsed.pattern);
  await update((state) => {
    const it = state.config.items.find((i) => i.pattern === patternStr);
    if (it) it.access = granted ? "granted" : "denied";
  });
  setStatus(granted ? "addedGranted" : "addedDenied");
  send("flush");
}

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
        await update((s) => {
          const it = s.config.items.find((i) => i.id === item.id);
          if (it) it.enabled = false;
        });
      });
      if (!done) enabled.checked = true;
      return;
    }
    await update((s) => {
      const it = s.config.items.find((i) => i.id === item.id);
      if (it) it.enabled = true;
    });
  });

  const name = document.createElement("span");
  name.className = "pattern";
  name.textContent = item.pattern;

  const now = Date.now();
  const open = isOpen(state, item, dayKey(now), now);
  const used = secondsUsedToday(state, item.pattern);
  // The effective budget is what enforcement uses (base + 15 min per burned
  // pass), so the bar and the remaining label must show the same number.
  const effective = effectiveBudgetSeconds(
    item,
    state,
    dayKey(now),
    state.config.unblockMinutes
  );
  const left = Math.max(0, effective - used);
  const remaining = document.createElement("span");
  remaining.className = "remaining" + (open ? "" : " closed");
  remaining.textContent = open
    ? `${formatRemaining(left)} ${msg("leftSuffix")}`
    : msg("closedLabel");

  line1.append(enabled, name, remaining);

  const bar = document.createElement("div");
  bar.className = "bar" + (open ? "" : " done");
  const fill = document.createElement("i");
  const ratio = effective > 0 ? Math.min(1, used / effective) : 1;
  fill.style.width = `${Math.round(ratio * 100)}%`;
  bar.append(fill);

  const line2 = document.createElement("div");
  line2.className = "line actions";

  const badge = document.createElement("span");
  badge.className = "badge" + (item.access === "granted" ? " granted" : "");
  badge.textContent = msg(item.access === "granted" ? "accessGranted" : "accessDenied");
  badge.title = msg(item.access === "granted" ? "badgeTitleGranted" : "badgeTitleDenied");

  line2.append(badge);

  const passes = state.usage.days[dayKey(now)]?.unblocks?.[item.pattern] ?? 0;
  if (passes > 0) {
    const chip = document.createElement("span");
    chip.className = "badge passes";
    // Read the configured pass length: a hardcoded 15 would lie the moment
    // unblockMinutes changes (it is a stored config value, not a constant).
    chip.textContent = `${passes}×${state.config.unblockMinutes}${msg("minutesShort")}`;
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
      await update((s) => removeItem(s, item.id));
    });
  });

  line2.append(block, remove);

  li.append(line1, bar, line2);
  return li;
}

async function render() {
  const state = await load();
  const day = dayKey();
  const snapshot = JSON.stringify([
    state.config,
    state.runtime,
    state.usage.days[day] ?? null,
    state.usage.days[previousDayKey()] ?? null,
  ]);
  if (snapshot === lastPainted) return;
  lastPainted = snapshot;
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
      await update((state) => setMasterEnabled(state, false));
    });
    if (!done) {
      els.master.checked = true;
      return;
    }
    return;
  }
  await update((state) => setMasterEnabled(state, true));
});

els.add.addEventListener("click", () => {
  addSite(els.pattern.value, Number(els.minutes.value));
});

els.openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
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
render();
// Credit whatever the SW has not flushed yet (its tick is 5 min), then
// repaint: without this the dashboard shows a frozen "1 min left" while
// the wall is actually due — the freeze the users kept reporting.
// The access-flag write is chained AFTER the flush on purpose: two
// concurrent whole-state writes would clobber each other's fields.
send("flush")
  .then(() => syncAccessFlags())
  .finally(scheduleRender);
