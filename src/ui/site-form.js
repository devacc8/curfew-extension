import { mutate } from "../common/storage.js";
import { clampBudgetMinutes } from "../common/limits.js";
import { parsePattern, patternToString } from "../common/patterns.js";
import { requestAccess } from "./access.js";

/**
 * Add a site the user typed, from either page.
 *
 * The item is written BEFORE the permission prompt: the prompt steals focus
 * and can close the popup mid-request, and a lost item is worse than a lost
 * grant. The outcome is then recorded through the worker like any other write.
 * @param {string} rawPattern - whatever the user typed (URL, host, wildcard).
 * @param {unknown} minutes - requested daily budget.
 * @returns {Promise<{ok: true, pattern: string, granted: boolean} | {ok: false, error: string}>}
 */
export async function addSite(rawPattern, minutes) {
  const parsed = parsePattern(rawPattern);
  if (!parsed.ok) return { ok: false, error: parsed.error ?? "host" };
  const pattern = patternToString(parsed.pattern);
  const created = await mutate("item.add", {
    pattern,
    budgetMinutes: clampBudgetMinutes(minutes),
    access: "denied",
  });
  const granted = await requestAccess(parsed.pattern);
  await mutate("item.update", {
    id: created?.id,
    fields: { access: granted ? "granted" : "denied" },
  });
  return { ok: true, pattern, granted };
}
