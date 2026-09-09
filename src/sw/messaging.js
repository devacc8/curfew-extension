import { load, update } from "../common/storage.js";
import { dayKey } from "../common/time.js";
import { recordUnblock } from "../common/budget.js";
import { resolvePassRequest } from "../common/rules.js";
import { applyOp } from "../common/ops.js";
import { UNBLOCK_PREFIX } from "./reconciler.js";

/**
 * Every message a page can send. The handler runs inside the worker's
 * serialized mutation queue (the caller wraps it), so a page write can never
 * interleave with a time credit.
 * @param {{ flushTick: () => Promise<any>, reconcile: (s: any) => Promise<void>,
 *           bounceClosedTabs: (s: any) => Promise<void> }} deps
 */
export function createMessageHandler({ flushTick, reconcile, bounceClosedTabs }) {
  return function onMessage(message, _sender, sendResponse) {
    (async () => {
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
        } else if (message?.type === "unstick") {
          // Escape hatch for a wall whose rule survived a failed batch
          // reconcile: remove exactly this item's rule, then re-reconcile.
          const loaded = await load();
          const item = loaded.config.items.find((i) => i.id === message.itemId);
          if (!item) return sendResponse({ ok: false });
          try {
            await chrome.declarativeNetRequest.updateDynamicRules({
              removeRuleIds: [item.ruleId],
              addRules: [],
            });
            sendResponse({ ok: true });
          } catch (error) {
            console.error("curfew: unstick failed for rule", item.ruleId, error);
            sendResponse({ ok: false });
          }
          await reconcile(await load());
        } else if (message?.type === "state:apply") {
          // The ONLY write path for pages: applied here, inside the serialized
          // queue, so a page write cannot clobber a concurrent credit.
          let result;
          const state = await update((s) => {
            result = applyOp(s, message.op, message.payload);
          });
          await reconcile(state);
          await bounceClosedTabs(state);
          sendResponse({ ok: true, result });
        } else {
          sendResponse({ ok: false });
        }
      } catch {
        sendResponse({ ok: false });
      }
    })().catch((e) => console.error("curfew: message handler failed", e));
    return true;
  };
}
