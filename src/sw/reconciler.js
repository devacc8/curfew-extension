import { dayKey } from "../common/time.js";
import { matchesHost, parsePattern } from "../common/patterns.js";
import { nextExhaustionAt } from "../common/budget.js";
import { diffRules, desiredRules } from "../common/rules.js";
import { isOpen } from "../common/status.js";

/** Alarm names this module owns; the worker registers the listener. */
export const EXHAUST = "exhaust";
export const PASS_PREFIX = "pass:";
export const COOLDOWN_PREFIX = "cooldown:";

const BLOCKED_PAGE = "/src/blocked.html";

/**
 * The projection layer: storage is the source of truth, DNR rules and alarms
 * are what the browser actually enforces. Everything here is derived, so it
 * can always be recomputed from a fresh `load()`.
 */
export function createReconciler() {
  /** Whether rules with `?domain=` are accepted (probed on first use). */
  let queryState = "unknown";

  function blockedPageFor(host) {
    if (queryState === "no") return BLOCKED_PAGE;
    return `${BLOCKED_PAGE}?domain=${encodeURIComponent(host)}`;
  }

  /** Tell extension pages the rule set changed: a wall can leave the instant
   *  its rule is gone instead of polling for it. */
  function announceRulesChanged() {
    chrome.runtime.sendMessage({ type: "rules:changed" }).catch(() => {
      // No listener (no wall open) — the normal case.
    });
  }

  /** Arm the one-shot alarm for the next moment enforcement must re-decide. */
  function scheduleExhaust(state, now) {
    const at = nextExhaustionAt(state, dayKey(now), now);
    if (at === null) {
      chrome.alarms.clear(EXHAUST);
      return;
    }
    // One-shot alarms fire with second-level jitter; never schedule the past.
    chrome.alarms.create(EXHAUST, { when: Math.max(now + 1000, at) });
  }

  /** Re-open sites whose anti-infinite-scroll cooldown has ended. */
  function scheduleCooldowns(state, now) {
    for (const item of state.config.items) {
      const until = state.runtime.cooldownUntil?.[item.pattern];
      if (!Number.isFinite(until) || until <= now) continue;
      chrome.alarms.create(COOLDOWN_PREFIX + item.ruleId, { when: until });
    }
  }

  async function reconcile(state) {
    const now = Date.now();
    scheduleExhaust(state, now);
    scheduleCooldowns(state, now);
    const desired = desiredRules(state, { day: dayKey(now), nowMs: now, blockedPageFor });
    const actual = await chrome.declarativeNetRequest.getDynamicRules();
    const { removeRuleIds, addRules } = diffRules(desired, actual);
    if (!removeRuleIds.length && !addRules.length) return;
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
      if (addRules.length) queryState = "yes";
      announceRulesChanged();
    } catch (error) {
      // A single bad id or rule must never leave the user trapped behind a
      // rule that should be gone: retry removals one at a time and say which
      // one failed. (Field report: a stale rule survived every reconcile
      // because the batch call threw and the failure was swallowed.)
      console.error("curfew: reconcile batch failed", error);
      for (const id of removeRuleIds) {
        try {
          await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [id],
            addRules: [],
          });
        } catch (single) {
          console.error("curfew: could not remove rule", id, single);
        }
      }
      announceRulesChanged();
      if (addRules.length) {
        if (queryState === "unknown") {
          queryState = "no";
          return reconcile(state);
        }
        console.error("curfew: could not install rules", addRules.map((r) => r.id));
      }
    }
  }

  /** Redirect active tabs whose site is closed (no host permission needed). */
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

  return { reconcile, bounceClosedTabs, blockedPageFor };
}
