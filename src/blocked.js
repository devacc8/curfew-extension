import { load } from "./common/storage.js";
import { dayKey } from "./common/time.js";
import { parsePattern, matchesHost } from "./common/patterns.js";
import { secondsUsedToday, passesLeftToday } from "./common/budget.js";
import { isOpen } from "./common/rules.js";

const msg = (key) => chrome.i18n.getMessage(key);

let state = null;
let item = null;
const domain = new URLSearchParams(location.search).get("domain");

for (const el of document.querySelectorAll("[data-i18n]")) {
  el.textContent = msg(el.dataset.i18n);
}

const domainEl = document.getElementById("domain");
const stayEl = document.getElementById("stay");
const hintEl = document.getElementById("hint");
const passesEl = document.getElementById("passes");
const usedEl = document.getElementById("used");

if (!domain) {
  document.getElementById("actions").hidden = true;
} else {
  domainEl.textContent = domain;
  init().catch((error) => console.error("curfew: wall failed", error));

  // A stale wall heals itself: rollover, any storage change or a periodic
  // tick re-evaluates the curfew and turns the domain into a way out.
  chrome.storage.onChanged.addListener(() => refresh());
  setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, 60_000);
}

async function init() {
  state = await load();
  item = state.config.items.find((i) => {
    const parsed = parsePattern(i.pattern);
    return parsed.ok && matchesHost(parsed.pattern, domain);
  });
  if (!item) return;

  renderUsage();
  refresh();

  stayEl.addEventListener("click", async () => {
    stayEl.disabled = true;
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: "unblock:request",
        itemId: item.id,
      });
    } catch {
      response = null;
    }
    if (response?.ok) {
      location.href = `https://${domain}/`;
    } else if (response?.reason === "limit") {
      stayEl.disabled = true;
      hintEl.textContent = msg("limitReached");
    } else {
      stayEl.disabled = false;
      hintEl.textContent = msg("unblockFailed");
    }
  });
}

/** Re-evaluate the curfew against fresh state. When the wall is stale (a
 *  new day started, limits refreshed, window lifted) the domain becomes a
 *  clickable way out — no address retyping needed. */
async function refresh() {
  if (!item) return;
  state = await load();
  renderUsage();

  const now = Date.now();
  const day = dayKey(now);
  const open = isOpen(state, item, dayKey(now), now);

  if (open) {
    domainEl.textContent = "";
    const link = document.createElement("a");
    link.href = `https://${domain}/`;
    link.textContent = domain;
    domainEl.append(link);
    hintEl.textContent = msg("curfewLifted");
    stayEl.hidden = true;
    passesEl.hidden = true;
  } else {
    if (domainEl.querySelector("a")) {
      domainEl.textContent = domain;
    }
    stayEl.hidden = false;
    const limit = state.config.unblockPassesPerDay;
    const left = passesLeftToday(state, day, limit);
    stayEl.disabled = left <= 0;
    if (left <= 0) {
      hintEl.textContent = msg("limitReached");
    }
  }
}

function renderUsage() {
  const day = dayKey();
  const used = secondsUsedToday(state, item.pattern, day);
  const limit = state.config.unblockPassesPerDay;
  const left = passesLeftToday(state, day, limit);

  usedEl.textContent =
    `${msg("usedTodayLabel")} ${Math.round(used / 60)} ${msg("minutesShort")}`;
  passesEl.textContent =
    `${msg("passesLeftLabel")} ${Number.isFinite(left) ? left : 0}`;
}
