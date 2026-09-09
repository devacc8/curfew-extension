import { load, update } from "../common/storage.js";
import { MAX_CREDIT_MS } from "../common/limits.js";
import { trackEnvironment } from "../common/tracking.js";
import { patternForHost, probeEnv } from "./probe.js";

/**
 * The tracking loop: observe the environment, then let `common/tracking.js`
 * do the accounting. `warm` distinguishes a cold start (the previous
 * session's window must be recovered) from a warm re-evaluation.
 * @param {{ reconcile: (s: any) => Promise<void>,
 *           bounceClosedTabs: (s: any) => Promise<void>,
 *           rollover: (s: any) => Promise<any> }} deps
 */
export function createTracker({ reconcile, bounceClosedTabs, rollover }) {
  let warm = false;

  async function onTrackerEvent() {
    const now = Date.now();
    const fromWake = !warm;
    warm = true;

    // 1) async environment probe first (tabs/windows/idle APIs)
    const probe = await probeEnv();

    // 2) then load -> update with NO awaits in between: the read-modify-write
    //    is atomic within JS, so concurrent writes (wall pass, blockNow)
    //    can never be clobbered by a stale preloaded state
    await update((s) => {
      const pattern = probe.host ? patternForHost(s, probe.host) : null;
      trackEnvironment(
        s,
        { type: "environment", pattern, canCount: probe.canCount },
        now,
        { fromWake, maxCreditMs: MAX_CREDIT_MS }
      );
    });

    const state = await load();
    await rollover(state);
    await reconcile(state);
    await bounceClosedTabs(state);
  }

  return { onTrackerEvent };
}
