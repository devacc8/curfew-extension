import { load, update, upsertItem } from "./common/storage.js";
import { dayKey, nextLocalMidnight } from "./common/time.js";
import { parsePattern, matchesHost } from "./common/patterns.js";
import {
  transition,
  recoveryCredit,
  applyCredit,
  recordUnblock,
  capCredits,
  dropIfMidnightCrossed,
} from "./common/budget.js";
import { desiredRules, isOpen, resolvePassRequest } from "./common/rules.js";
import { pruneDays } from "./common/transfer.js";

const TICK = "tick";
const MIDNIGHT = "midnight";
const UNBLOCK_PREFIX = "unblock:";
const MENU_ID = "curfew-add-site";
const TICK_MINUTES = 5;
const IDLE_SECONDS = 60;
const MAX_CREDIT_MS = 6 * 60 * 1000;
const KEEP_DAYS = 60;
const BLOCKED_PAGE = "/src/blocked.html";

let warm = false;
let queryState = "unknown";

/**
 * Every state mutation runs through this one promise chain. chrome.storage
 * has no transactions, so two overlapping read-modify-write cycles (a tick
 * alarm racing an environment event) would otherwise each read the same
 * snapshot and the later write would silently drop the other's credit —
 * exactly the "time stops counting" failure. Entry points are serialized;
 * nested calls (onAlarm -> flushTick) stay plain to avoid deadlock.
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

function runTracker() {
  serial(onTrackerEvent).catch((error) => console.error("curfew: tracker failed", error));
}
chrome.contextMenus.onClicked.addListener((info, tab) =>
  serial(() => onContextMenu(info, tab)).catch((e) =>
    console.error("curfew: menu handler failed", e)
  )
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
  await reconcile(await rollover(state));
}

async function onStartup() {
  const state = await update((s) => {
    s.session = null;
  });
  ensureContextMenu();
  await reconcile(await rollover(state));
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
    const exists = state.config.items.some((i) => {
      const p = parsePattern(i.pattern);
      return p.ok && matchesHost(p.pattern, host);
    });
    if (!exists) {
      state = await update((s) => {
        upsertItem(s, { pattern: host, budgetMinutes: 30, access: "denied" });
      }, state);
      await reconcile(state);
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
    onTrackerEvent().catch((error) => console.error("curfew: tracker failed", error));
  }
}

async function onTrackerEvent() {
  const now = Date.now();
  const fromWake = !warm;
  warm = true;

  // 1) async environment probe first (tabs/windows/idle APIs)
  const probe = await probeEnv();

  // 2) then load -> update with NO awaits in between: the read-modify-write
  //    is atomic within JS, so concurrent writes (wall unblock, blockNow)
  //    can never be clobbered by a stale preloaded state
  await update((s) => {
    const lastDay = s.session ? dayKey(s.session.lastTickAt) : null;
    if (fromWake && s.session) {
      const credit = recoveryCredit(s.session, now, MAX_CREDIT_MS);
      if (credit && lastDay === dayKey(now)) {
        applyCredit(s, credit, dayKey(now));
      }
      if (s.session) {
        s.session = { ...s.session, lastTickAt: now, phaseStartedAt: now };
      }
    }
    const pattern = probe.host ? patternForHost(s, probe.host) : null;
    const { state: session, credits } = transition(
      s.session,
      { type: "environment", pattern, canCount: probe.canCount },
      s.config,
      now
    );
    s.session = session;
    const safe = dropIfMidnightCrossed(capCredits(credits, MAX_CREDIT_MS), lastDay, dayKey(now));
    for (const c of safe) {
      applyCredit(s, c, dayKey(now));
    }
  });

  const state = await load();
  await rollover(state);
  await reconcile(state);
  await bounceClosedTabs(state);
}

async function probeEnv() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) return { host: null, canCount: false };
    let host = null;
    try {
      host = tab.url ? new URL(tab.url).hostname : null;
    } catch {
      host = null;
    }
    const win = await chrome.windows.get(tab.windowId);
    const idleState = await chrome.idle.queryState(IDLE_SECONDS);
    return { host, canCount: Boolean(win?.focused) && idleState === "active" };
  } catch {
    return { host: null, canCount: false };
  }
}

function patternForHost(state, host) {
  for (const item of state.config.items) {
    if (!item.enabled || item.access !== "granted") continue;
    const parsed = parsePattern(item.pattern);
    if (parsed.ok && matchesHost(parsed.pattern, host)) return item.pattern;
  }
  return null;
}

function blockedPageFor(host) {
  if (queryState === "no") return BLOCKED_PAGE;
  return `${BLOCKED_PAGE}?domain=${encodeURIComponent(host)}`;
}

async function reconcile(state) {
  const now = Date.now();
  const desired = desiredRules(state, {
    day: dayKey(now),
    nowMs: now,
    blockedPageFor,
  });
  const actual = await chrome.declarativeNetRequest.getDynamicRules();
  const actualById = new Map(actual.map((r) => [r.id, r]));
  const removeRuleIds = [];
  const addRules = [];
  for (const rule of desired) {
    const existing = actualById.get(rule.id);
    const same =
      existing &&
      JSON.stringify(existing.action) === JSON.stringify(rule.action) &&
      JSON.stringify(existing.condition) === JSON.stringify(rule.condition);
    if (!same) {
      removeRuleIds.push(rule.id);
      addRules.push(rule);
    }
    actualById.delete(rule.id);
  }
  for (const id of actualById.keys()) removeRuleIds.push(id);
  if (!removeRuleIds.length && !addRules.length) return;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
    if (addRules.length) queryState = "yes";
  } catch (error) {
    if (queryState === "unknown") {
      queryState = "no";
      return reconcile(state);
    }
    throw error;
  }
}

async function bounceClosedTabs(state) {
  const now = Date.now();
  const day = dayKey(now);
  let tabs;
  try {
    tabs = await chrome.tabs.query({ active: true });
  } catch {
    return;
  }
  for (const tab of tabs) {
    if (!tab?.id || !tab.url) continue;
    let host = null;
    try {
      host = new URL(tab.url).hostname;
    } catch {
      continue;
    }
    if (!host) continue;
    const item = state.config.items.find((i) => {
      if (!i.enabled || i.access !== "granted") return false;
      const p = parsePattern(i.pattern);
      return p.ok && matchesHost(p.pattern, host);
    });
    if (!item || isOpen(state, item, day, now)) continue;
    try {
      await chrome.tabs.update(tab.id, { url: blockedPageFor(host) });
    } catch (error) {
      console.warn("curfew: could not redirect tab", tab.id, error);
    }
  }
}

async function flushTick() {
  const now = Date.now();
  return update((s) => {
    if (s.session) {
      const lastDay = dayKey(s.session.lastTickAt);
      const { state: session, credits } = transition(s.session, { type: "tick" }, s.config, now);
      s.session = session;
      const safe = dropIfMidnightCrossed(capCredits(credits, MAX_CREDIT_MS), lastDay, dayKey(now));
      for (const c of safe) {
        applyCredit(s, c, dayKey(now));
      }
    }
    // Expired unblock windows are garbage: the one-shot alarm re-adds the
    // rule, and isOpen already ignores them, so only storage hygiene is left.
    for (const [pattern, until] of Object.entries(s.runtime.unblockUntil)) {
      if (!(until > now)) delete s.runtime.unblockUntil[pattern];
    }
  });
}

async function rollover(state) {
  const today = dayKey(Date.now());
  if (state.runtime.lastRolloverDay === today) return state;
  return update((s) => {
    pruneDays(s, KEEP_DAYS);
    s.runtime.unblockUntil = {};
    s.runtime.dayOverrides = {};
    s.runtime.lastRolloverDay = today;
  }, state);
}

async function onAlarm(alarm) {
  if (alarm.name === TICK) {
    await flushTick();
  } else if (alarm.name !== MIDNIGHT && !alarm.name.startsWith(UNBLOCK_PREFIX)) {
    return;
  }
  const state = await rollover(await load());
  await reconcile(state);
  await bounceClosedTabs(state);
  if (alarm.name === MIDNIGHT) scheduleMidnight();
}

function onMessage(message, _sender, sendResponse) {
  serial(async () => {
    try {
      if (message?.type === "unblock:request") {
        const loaded = await load();
        const item = loaded.config.items.find((i) => i.id === message.itemId);
        if (!item || item.access !== "granted") return sendResponse({ ok: false });
        const day = dayKey(Date.now());
        const decision = resolvePassRequest(
          loaded,
          item,
          day,
          Date.now(),
          loaded.config.unblockPassesPerDay
        );
        if (!decision.ok) return sendResponse({ ok: false, reason: decision.reason });
        // A stale wall asking to "stay" on an already-open site is a no-op:
        // no pass is burned, the live window (if any) is echoed back.
        if (!decision.burn) return sendResponse({ ok: true, until: decision.until });
        const until = Date.now() + loaded.config.unblockMinutes * 60_000;
        const state = await update((s) => {
          s.runtime.unblockUntil[item.pattern] = until;
          recordUnblock(s, item.pattern, day);
        }, loaded);
        chrome.alarms.create(UNBLOCK_PREFIX + item.ruleId, { when: until });
        await reconcile(state);
        sendResponse({ ok: true, until });
      } else if (message?.type === "blockNow") {
        const loaded = await load();
        const item = loaded.config.items.find((i) => i.id === message.itemId);
        if (!item) return sendResponse({ ok: false });
        const state = await update((s) => {
          s.runtime.dayOverrides[item.pattern] = {
            day: dayKey(Date.now()),
            action: "block",
          };
        }, loaded);
        await reconcile(state);
        await bounceClosedTabs(state);
        sendResponse({ ok: true });
      } else if (message?.type === "flush") {
        const state = await flushTick();
        await reconcile(state);
        await bounceClosedTabs(state);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false });
      }
    } catch {
      sendResponse({ ok: false });
    }
  }).catch((e) => console.error("curfew: message handler failed", e));
  return true;
}
