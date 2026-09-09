import { mutate } from "../common/storage.js";
import { parsePattern, toMatchOrigins } from "../common/patterns.js";

/** Host-permission plumbing shared by the popup and the options page. */

/** Ask the browser for host access to one pattern. */
export async function requestAccess(pattern) {
  try {
    return await chrome.permissions.request({ origins: toMatchOrigins(pattern) });
  } catch {
    return false;
  }
}

/**
 * Reconcile every item's `access` flag with the real permissions. A probe
 * that THROWS is "unknown" (`granted: null`) and keeps the previous flag —
 * forcing denied would silently switch off tracking and enforcement.
 */
export async function syncAccessFlags(state) {
  const entries = await Promise.all(
    state.config.items.map(async (item) => {
      const parsed = parsePattern(item.pattern);
      if (!parsed.ok) return { id: item.id, granted: false };
      try {
        const granted = await chrome.permissions.contains({
          origins: toMatchOrigins(parsed.pattern),
        });
        return { id: item.id, granted };
      } catch {
        return { id: item.id, granted: null };
      }
    })
  );
  await mutate("item.accessBatch", { entries });
}

/** Grant access to one existing item and persist the outcome. */
export async function grantItem(item) {
  const parsed = parsePattern(item.pattern);
  if (!parsed.ok) return false;
  const granted = await requestAccess(parsed.pattern);
  await mutate("item.update", {
    id: item.id,
    fields: { access: granted ? "granted" : "denied" },
  });
  return granted;
}
