import { load } from "./common/storage.js";
import { dayKey, nextLocalMidnight } from "./common/time.js";
import { parsePattern, matchesHost } from "./common/patterns.js";
import { secondsUsedToday, passesLeftToday } from "./common/budget.js";
import { describeItem } from "./common/status.js";
import { formatClock } from "./common/view.js";
import { applyTheme } from "./ui/theme.js";

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
  // The worker pushes this after every rule change; no polling needed.
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "rules:changed") refresh();
  });
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
        type: "pass:request",
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
      hintEl.textContent = msg("passFailed");
    }
  });
}

/** Re-evaluate the curfew against fresh state. When the wall is stale (a
 *  new day started, limits refreshed, window lifted) the domain becomes a
 *  clickable way out, so no address retyping is needed. */
async function refresh() {
  if (!item) return;
  state = await load();
  applyTheme(state);
  renderUsage();

  const now = Date.now();
  const day = dayKey(now);
  const status = describeItem(state, item, now);

  if (status.open) {
    domainEl.textContent = "";
    const link = document.createElement("a");
    link.href = `https://${domain}/`;
    link.textContent = domain;
    domainEl.append(link);
    hintEl.textContent = msg("curfewLifted");
    stayEl.hidden = true;
    passesEl.hidden = true;
    // A wall can outlive its rule (the browser restored the tab before the
    // service worker reconciled at boot). Get out of the user's way, but
    // ONLY once the enforcement rule is actually gone: navigating while it
    // still exists bounces straight back here, and that ping-pong flickers.
    leaveIfStale();
  } else {
    if (domainEl.querySelector("a")) {
      domainEl.textContent = domain;
    }
    stayEl.hidden = false;
    const limit = state.config.passesPerDay;
    const left = passesLeftToday(state, day, limit);
    stayEl.disabled = left <= 0;
    paintCountdown();
  }
}

/** Is the enforcement rule for this item still installed? */
async function ruleGone() {
  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    return !rules.some((rule) => rule.id === item.ruleId);
  } catch {
    // Cannot prove it is gone -> do not navigate.
    return false;
  }
}

/**
 * Leave a stale wall, but only when both hold: enforcement now considers the
 * site open AND its DNR rule has been removed. Without the second check the
 * page navigates into a rule that redirects it right back, an endless
 * site <-> wall flicker. The page's init flush triggers a reconcile first, so
 * a stale rule is normally gone by the time this runs.
 */
async function leaveIfStale() {
  if (leaving || !item || !state) return;
  leaving = true;
  // Bounded retry, never a hot loop: the rule is normally removed by the
  // reconcile our init flush triggers, but a slow one must not strand the
  // user. Give up after ~6 s and leave the clickable link in place.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (!describeItem(state, item, Date.now()).open) break;
    if (await ruleGone()) {
      location.href = `https://${domain}/`;
      return;
    }
    // Halfway through, ask the worker to drop THIS rule directly: a failed
    // batch reconcile must not be able to trap the user.
    if (attempt === 4) {
      try {
        await chrome.runtime.sendMessage({ type: "unstick", itemId: item.id });
      } catch {
        // worker asleep or gone; the remaining attempts still apply
      }
    }
  }
  leaving = false;
}

/** Repaint the "returns in" line once a second: a cooldown deadline if one is
 *  live, otherwise the next local midnight. */
function paintCountdown() {
  if (!item || !state || document.visibilityState !== "visible") return;
  const now = Date.now();
  const status = describeItem(state, item, now);
  if (status.open) return;
  const until = status.cooling
    ? status.coolingUntil
    : nextLocalMidnight(new Date(now)).getTime();
  const leftPasses = passesLeftToday(state, status.day, state.config.passesPerDay);
  // Say WHY, not just "closed": a cooldown and a spent budget feel completely
  // different, and a mystery block is what makes people distrust the tool.
  const why =
    status.reason === "cooldown"
      ? msg("closedCooldownReason")
      : status.reason === "override"
        ? msg("blockNow")
        : msg("closedBudgetReason");
  hintEl.textContent =
    `${why} · ${msg("returnsInLabel")} ${formatClock(until - now, msg)}` +
    (leftPasses <= 0 ? ` · ${msg("limitReached")}` : "");
}

function renderUsage() {
  const day = dayKey();
  const used = secondsUsedToday(state, item.pattern, day);
  const limit = state.config.passesPerDay;
  const left = passesLeftToday(state, day, limit);

  usedEl.textContent =
    `${msg("usedTodayLabel")} ${Math.round(used / 60)} ${msg("minutesShort")}`;
  passesEl.textContent =
    `${msg("passesLeftLabel")} ${Number.isFinite(left) ? left : 0}`;
}
