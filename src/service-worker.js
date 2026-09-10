import { STATE_SCHEMA, load, update, upsertItem } from "./common/storage.js";
import { nextLocalMidnight } from "./common/time.js";
import { KEEP_DAYS, MAX_CREDIT_MS, TICK_MINUTES, IDLE_SECONDS } from "./common/limits.js";
import { pruneRuntime, trackTick, applyRollover } from "./common/tracking.js";
import {
  COOLDOWN_PREFIX,
  EXHAUST,
  PASS_PREFIX,
  createReconciler,
} from "./sw/reconciler.js";
import { createTracker } from "./sw/tracker.js";
import { createMessageHandler } from "./sw/messaging.js";

const TICK = "tick";
const MIDNIGHT = "midnight";
const MENU_ID = "curfew-add-site";

/**
 * Composition root: this file only wires browser events to the modules that
 * own the behaviour (reconciler = desired browser state, tracker = accounting,
 * messaging = page writes). Top-level listener registration is the MV3 rule.
 */

/**
 * Every state mutation runs through this one promise chain. chrome.storage has
 * no transactions, so two overlapping read-modify-write cycles (a tick alarm
 * racing an environment event) would otherwise each read the same snapshot and
 * the later write would silently drop the other's credit. Entry points are
 * serialized; nested calls (onAlarm -> flushTick) stay plain to avoid deadlock.
 */
let mutationQueue = Promise.resolve();
function serial(task) {
  const next = mutationQueue.then(task, task);
  mutationQueue = next.then(
    () => {},
    () => {}
  );
  return next;
}

const reconciler = createReconciler();
const tracker = createTracker({
  reconcile: reconciler.reconcile,
  bounceClosedTabs: reconciler.bounceClosedTabs,
  rollover: (state) => rollover(state),
});
const onMessage = createMessageHandler({
  flushTick,
  reconcile: reconciler.reconcile,
  bounceClosedTabs: reconciler.bounceClosedTabs,
});

function runTracker() {
  serial(tracker.onTrackerEvent).catch((error) => console.error("curfew: tracker failed", error));
}

chrome.runtime.onInstalled.addListener(() =>
  serial(init).catch((e) => console.error("curfew: init failed", e))
);
chrome.runtime.onStartup.addListener(() =>
  serial(onStartup).catch((e) => console.error("curfew: startup failed", e))
);
chrome.alarms.onAlarm.addListener((alarm) =>
  serial(() => onAlarm(alarm)).catch((e) => console.error("curfew: alarm failed", alarm.name, e))
);
chrome.tabs.onActivated.addListener(runTracker);
chrome.tabs.onUpdated.addListener(onTabUpdated);
chrome.windows.onFocusChanged.addListener(runTracker);
chrome.idle.onStateChanged.addListener(runTracker);
chrome.runtime.onMessage.addListener(onMessage);
chrome.contextMenus.onClicked.addListener((info, tab) =>
  serial(() => onContextMenu(info, tab)).catch((e) =>
    console.error("curfew: menu handler failed", e)
  )
);

/**
 * Reconcile the moment the worker starts. Dynamic rules survive a browser
 * restart, so a tab restored before `onStartup` lands can hit a rule that is
 * no longer wanted — the user sees a wall while the budget still has minutes
 * left. Storage is the source of truth; this makes the projection catch up.
 */
async function bootReconcile() {
  const state = await rollover(await load());
  await reconciler.reconcile(state);
  await reconciler.bounceClosedTabs(state);
}
serial(bootReconcile).catch((error) => console.error("curfew: boot reconcile failed", error));

// Which build is actually running? Answering that used to need guesswork.
console.log(
  `curfew: worker ready (schema ${STATE_SCHEMA}, extension ${chrome.runtime.getManifest().version})`
);

function ensureContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: chrome.i18n.getMessage("contextAddSite") || "Add this site to Curfew",
      contexts: ["page"],
    });
  });
}

async function init() {
  const state = await load();
  chrome.idle.setDetectionInterval(IDLE_SECONDS);
  chrome.alarms.create(TICK, { periodInMinutes: TICK_MINUTES });
  scheduleMidnight();
  ensureContextMenu();
  await reconciler.reconcile(await rollover(state));
}

async function onStartup() {
  const state = await update((s) => {
    s.session = null;
  });
  ensureContextMenu();
  await reconciler.reconcile(await rollover(state));
}

/**
 * Right-click invocation is the reliable way to learn the current site:
 * the menu click provides info.pageUrl without any host access, and it
 * counts as an activeTab-invoking gesture (unlike opening the popup).
 */
async function onContextMenu(info, tab) {
  try {
    if (info.menuItemId !== MENU_ID) return;
    const raw = info.pageUrl || tab?.url || "";
    let host = null;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        host = parsed.hostname;
      }
    } catch {
      host = null;
    }
    console.log("curfew: context menu add", { pageUrl: info.pageUrl, host });
    if (!host) {
      console.warn("curfew: no http(s) host in pageUrl, nothing to add");
      return;
    }
    let state = await load();
    const exists = state.config.items.some((i) => i.pattern === host);
    if (!exists) {
      state = await update((s) => {
        upsertItem(s, { pattern: host, budgetMinutes: 30, access: "denied" });
      }, state);
      await reconciler.reconcile(state);
      console.log("curfew: item added", host);
    }
    const url = `${chrome.runtime.getURL("src/options.html")}?add=${encodeURIComponent(host)}`;
    const opened = await chrome.tabs.create({ url });
    console.log("curfew: options tab opened", opened?.id ?? null);
  } catch (error) {
    console.error("curfew: context menu handler failed", error);
  }
}

function scheduleMidnight() {
  chrome.alarms.create(MIDNIGHT, { when: nextLocalMidnight().getTime() });
}

function onTabUpdated(_tabId, changeInfo) {
  if (changeInfo.url || changeInfo.status === "loading") {
    runTracker();
  }
}

async function flushTick() {
  const now = Date.now();
  return update((s) => {
    trackTick(s, now, { maxCreditMs: MAX_CREDIT_MS });
    pruneRuntime(s, now);
  });
}

async function rollover(state) {
  const now = Date.now();
  try {
    return await update((s) => {
      applyRollover(s, now, KEEP_DAYS);
    }, state);
  } catch (error) {
    // A rollover failure must not stop the caller from reconciling rules.
    console.error("curfew: rollover failed; continuing", error);
    return state;
  }
}

async function onAlarm(alarm) {
  const flushes = alarm.name === TICK || alarm.name === EXHAUST;
  const known =
    flushes ||
    alarm.name === MIDNIGHT ||
    alarm.name.startsWith(PASS_PREFIX) ||
    alarm.name.startsWith(COOLDOWN_PREFIX);
  if (!known) return;
  if (flushes) await flushTick();
  const state = await rollover(await load());
  await reconciler.reconcile(state);
  await reconciler.bounceClosedTabs(state);
  if (alarm.name === MIDNIGHT) scheduleMidnight();
}
