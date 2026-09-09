import { matchesHost, parsePattern } from "../common/patterns.js";
import { IDLE_SECONDS } from "../common/limits.js";

/** Environment facts for the tracker. Stateless: no chrome listeners here. */

/**
 * What is the user looking at right now?
 * Counting requires the tab to be active in a focused window and the browser
 * not idle — an ungranted host is invisible, so it can never be counted.
 * @returns {Promise<{ host: string | null, canCount: boolean }>}
 */
export async function probeEnv() {
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

/** The first granted, enabled item whose pattern covers `host`. */
export function patternForHost(state, host) {
  for (const item of state.config.items) {
    if (!item.enabled || item.access !== "granted") continue;
    const parsed = parsePattern(item.pattern);
    if (parsed.ok && matchesHost(parsed.pattern, host)) return item.pattern;
  }
  return null;
}
