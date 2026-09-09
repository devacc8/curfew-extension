import { load } from "./common/storage.js";
import { dayKey, nextLocalMidnight } from "./common/time.js";
import { parsePattern, matchesHost } from "./common/patterns.js";
import { secondsUsedToday, passesLeftToday } from "./common/budget.js";
import { closeReason, isOpen } from "./common/rules.js";

const msg = (key) => chrome.i18n.getMessage(key);

let state = null;
let item = null;
let leaving = false;
const domain = new URLSearchParams(location.search).get("domain");

for (const el of /** @type {NodeListOf<HTMLElement>} */ (
  document.querySelectorAll("[data-i18n]")
)) {
  el.textContent = msg(el.dataset.i18n ?? "");
}

const domainEl = /** @type {HTMLElement} */ (document.getElementById("domain"));
const stayEl = /** @type {HTMLButtonElement} */ (document.getElementById("stay"));
const hintEl = /** @type {HTMLElement} */ (document.getElementById("hint"));
const passesEl = /** @type {HTMLElement} */ (document.getElementById("passes"));
const usedEl = /** @type {HTMLElement} */ (document.getElementById("used"));

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
  setInterval(paintCountdown, 1000);
}

async function init() {
  // Ask the SW to credit pending time before reading: the wall must show the
  // same numbers the enforcement just used, not a snapshot up to 5 min old.
  try {
    await chrome.runtime.sendMessage({ type: "flush" });
  } catch {
    // SW asleep or unreachable: the stored snapshot is still better than nothing.
  }
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
    // A wall can outlive its rule (the browser restored the tab before the
    // service worker reconciled at boot). Get out of the user's way instead
    // of asking them to click.
    if (!leaving) {
      leaving = true;
      setTimeout(() => {
        if (isOpen(state, item, day, Date.now())) location.href = `https://${domain}/`;
        else leaving = false;
      }, 1200);
    }
  } else {
    if (domainEl.querySelector("a")) {
      domainEl.textContent = domain;
    }
    stayEl.hidden = false;
    const limit = state.config.unblockPassesPerDay;
    const left = passesLeftToday(state, day, limit);
    stayEl.disabled = left <= 0;
    paintCountdown();
  }
}

/** "4h 12m" / "3m 20s" / "48s" — a countdown must never read "0 min". */
function formatWait(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}${msg("hoursShort")}${m}${msg("minutesShort")}`;
  if (m > 0) return `${m}${msg("minutesShort")} ${s}${msg("secondsShort")}`;
  return `${s}${msg("secondsShort")}`;
}

/** Repaint the "returns in" line once a second: a cooldown deadline if one is
 *  live, otherwise the next local midnight. */
function paintCountdown() {
  if (!item || !state || document.visibilityState !== "visible") return;
  const now = Date.now();
  const day = dayKey(now);
  const reason = closeReason(state, item, day, now);
  if (reason === null) return;
  const cooldownUntil = state.runtime.cooldownUntil?.[item.pattern];
  const until =
    reason === "cooldown" && Number.isFinite(cooldownUntil) && cooldownUntil > now
      ? cooldownUntil
      : nextLocalMidnight(new Date(now)).getTime();
  const leftPasses = passesLeftToday(state, day, state.config.unblockPassesPerDay);
  // Say WHY, not just "closed": a cooldown and a spent budget feel completely
  // different, and a mystery block is what makes people distrust the tool.
  const why =
    reason === "cooldown"
      ? msg("closedCooldownReason")
      : reason === "override"
        ? msg("blockNow")
        : msg("closedBudgetReason");
  hintEl.textContent =
    `${why} · ${msg("returnsInLabel")} ${formatWait(until - now)}` +
    (leftPasses <= 0 ? ` · ${msg("limitReached")}` : "");
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
