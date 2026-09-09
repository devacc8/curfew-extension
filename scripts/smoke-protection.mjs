import puppeteer from "puppeteer";
import { join, dirname } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { findChrome } from "./chrome-path.mjs";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: "new",
  executablePath: await findChrome(),
  args: [
    `--disable-extensions-except=${ROOT}`,
    `--load-extension=${ROOT}`,
    "--no-sandbox",
  ],
});

try {
  const target = await browser.waitForTarget(
    (t) => t.type() === "service_worker"
  );
  const extensionId = new URL(target.url()).host;
  console.log("extension id:", extensionId);
  // Worker errors are otherwise invisible in this output.
  const worker = await target.worker();
  worker?.on("console", (m) => console.log("[sw]", m.type(), m.text()));
  worker?.on("error", (e) => console.log("[sw error]", e.message));

  const page = await browser.newPage();
  const pageErrors = [];
  page.on("console", (m) => console.log("[page]", m.type(), m.text()));
  page.on("pageerror", (e) => {
    pageErrors.push(e.message);
    console.log("[pageerror]", e.message);
  });

  await page.goto(`chrome-extension://${extensionId}/src/options.html`, {
    waitUntil: "networkidle0",
  });
  await sleep(300);

  // state before
  const before = await page.evaluate(
    () =>
      new Promise((res) =>
        chrome.storage.local.get("curfew", (d) => res(d.curfew?.settings))
      )
  );
  console.log("settings before:", JSON.stringify(before));

  // click Enable
  await page.click("#protectToggle");
  await sleep(200);

  // dialog visible?
  const dialogInfo = await page.evaluate(() => {
    const d = document.querySelector("dialog");
    return { open: d?.open ?? false, text: d?.textContent?.slice(0, 120) };
  });
  console.log("dialog:", JSON.stringify(dialogInfo));

  // click OK
  const buttons = await page.$$("dialog button");
  console.log("dialog buttons:", buttons.length);
  for (const b of buttons) {
    const label = await b.evaluate((el) => el.textContent);
    if (label === "OK") {
      await b.click();
      break;
    }
  }
  await sleep(300);

  const challengeInfo = await page.evaluate(() => {
    const d = document.querySelector("dialog");
    return { open: d?.open ?? false, text: d?.textContent?.slice(0, 160) };
  });
  console.log("challenge dialog:", JSON.stringify(challengeInfo));

  // solve the equation
  const expr = challengeInfo.text.match(/([\d\s+\-×:()]+)= \?/)?.[1];
  console.log("expr:", JSON.stringify(expr));
  const answer = await page.evaluate((t) => {
    const mod = import(chrome.runtime.getURL("src/common/equation.js"));
    return mod.then((m) => m.evaluateExpression(t));
  }, expr);
  console.log("answer:", answer);

  await page.type("dialog input", String(answer));
  await page.keyboard.press("Enter");
  await sleep(300);

  const after = await page.evaluate(
    () =>
      new Promise((res) =>
        chrome.storage.local.get("curfew", (d) => res(d.curfew?.settings))
      )
  );
  console.log("settings after:", JSON.stringify(after));
  console.log(
    after?.protection?.kind === "equation" ? "PASS: protection enabled" : "FAIL: not enabled"
  );

  // Importing is a permissive change: with protection ON the file picker must
  // raise the challenge BEFORE the document is replaced. Cancel it and the
  // payload must not have landed.
  const importDir = mkdtempSync(join(tmpdir(), "curfew-import-"));
  const importPath = join(importDir, "export.json");
  writeFileSync(
    importPath,
    JSON.stringify({
      kind: "curfew-export",
      version: 1,
      exportedAt: "2026-09-09T00:00:00Z",
      state: {
        schema: 1,
        config: {
          masterEnabled: true,
          graceSeconds: 10,
          unblockMinutes: 15,
          unblockPassesPerDay: 3,
          items: [
            {
              id: "evil",
              ruleId: 5001,
              pattern: "evil.test",
              budgetMinutes: 1440,
              enabled: true,
              access: "denied",
            },
          ],
        },
        usage: { days: {} },
        settings: { version: 1, itemSeq: 5001, protection: null },
      },
    })
  );
  const importInput = await page.$("#import");
  await importInput.uploadFile(importPath);
  await sleep(500);
  const gate = await page.evaluate(async () => {
    const dialog = document.querySelector("dialog");
    const state = await new Promise((res) =>
      chrome.storage.local.get("curfew", (d) => res(d.curfew))
    );
    return {
      dialogOpen: dialog?.open ?? false,
      imported: state?.config?.items?.some((i) => i.pattern === "evil.test") ?? false,
    };
  });
  console.log("import gate:", JSON.stringify(gate));
  if (!gate.dialogOpen || gate.imported) {
    console.log("FAIL: import bypassed the challenge");
    process.exitCode = 1;
  } else {
    console.log("PASS: import asks for the challenge");
  }
  const dialogButtons = await page.$$("dialog button");
  for (const button of dialogButtons) {
    const label = await button.evaluate((el) => el.textContent);
    if (label === "Cancel") {
      await button.click();
      break;
    }
  }
  await sleep(300);
  const afterCancel = await page.evaluate(async () => {
    const state = await new Promise((res) =>
      chrome.storage.local.get("curfew", (d) => res(d.curfew))
    );
    return {
      imported: state?.config?.items?.some((i) => i.pattern === "evil.test") ?? false,
      protectionOn: Boolean(state?.settings?.protection),
    };
  });
  console.log("import after cancel:", JSON.stringify(afterCancel));
  if (afterCancel.imported || !afterCancel.protectionOn) {
    console.log("FAIL: cancelling the challenge still changed the state");
    process.exitCode = 1;
  } else {
    console.log("PASS: cancelling the import challenge changes nothing");
  }
  rmSync(importDir, { recursive: true, force: true });

  // disable flow: toggle -> solve -> protection null
  await page.click("#protectToggle");
  await sleep(300);
  const expr2 = await page.evaluate(() =>
    document.querySelector("dialog")?.textContent?.match(/([\d\s+\-×:()]+)= \?/)?.[1]
  );
  const answer2 = await page.evaluate(
    (t) =>
      import(chrome.runtime.getURL("src/common/equation.js")).then((m) =>
        m.evaluateExpression(t)
      ),
    expr2
  );
  await page.type("dialog input", String(answer2));
  await page.keyboard.press("Enter");
  await sleep(300);
  const final = await page.evaluate(
    () =>
      new Promise((res) =>
        chrome.storage.local.get("curfew", (d) => res(d.curfew?.settings))
      )
  );
  console.log("settings final:", JSON.stringify(final));
  console.log(final?.protection === null ? "PASS: protection disabled" : "FAIL: still enabled");

  // Burned passes must extend the ENFORCEMENT budget, not just the popup's
  // label. Drive the real service worker and read its DNR projection: with
  // 2 passes a 25-min budget is open at 25 min used; without them it closes.
  const passRules = await page.evaluate(async () => {
    const { dayKey } = await import(chrome.runtime.getURL("src/common/time.js"));
    const day = dayKey();
    const item = {
      id: "e2e-pass",
      ruleId: 9001,
      pattern: "e2e-curfew.test",
      budgetMinutes: 25,
      enabled: true,
      access: "granted",
    };
    const base = {
      schema: 1,
      config: {
        masterEnabled: true,
        graceSeconds: 10,
        unblockMinutes: 15,
        unblockPassesPerDay: 3,
        items: [item],
      },
      usage: {
        days: {
          [day]: {
            patternSeconds: { "e2e-curfew.test": 25 * 60 },
            unblocks: { "e2e-curfew.test": 2 },
            bySite: {},
          },
        },
      },
      session: null,
      runtime: { unblockUntil: {}, dayOverrides: {}, lastRolloverDay: day },
      settings: { version: 1, itemSeq: 9001, protection: null },
    };
    const write = (state) =>
      new Promise((res) => chrome.storage.local.set({ curfew: state }, res));
    const hasRule = async () =>
      (await chrome.declarativeNetRequest.getDynamicRules()).some((r) => r.id === 9001);

    await write(base);
    await chrome.runtime.sendMessage({ type: "flush" });
    const ruleWithPasses = await hasRule();

    const noPasses = JSON.parse(JSON.stringify(base));
    noPasses.usage.days[day].unblocks = {};
    await write(noPasses);
    await chrome.runtime.sendMessage({ type: "flush" });
    const ruleWithoutPasses = await hasRule();

    return { ruleWithPasses, ruleWithoutPasses };
  });
  console.log("passes vs enforcement:", JSON.stringify(passRules));
  if (passRules.ruleWithPasses || !passRules.ruleWithoutPasses) {
    console.log("FAIL: burned passes do not extend the enforced budget");
    process.exitCode = 1;
  } else {
    console.log("PASS: burned passes extend the enforced budget");
  }

  // The "frozen at the last minute" bug: a counting session whose last flush
  // is 2 min old must be credited when the dashboard/wall flushes on open —
  // otherwise the counter sits still and the wall never lands.
  const staleFlush = await page.evaluate(async () => {
    const { dayKey } = await import(chrome.runtime.getURL("src/common/time.js"));
    const day = dayKey();
    const now = Date.now();
    const item = {
      id: "e2e-stale",
      ruleId: 9002,
      pattern: "e2e-stale.test",
      budgetMinutes: 25,
      enabled: true,
      access: "granted",
    };
    const state = {
      schema: 1,
      config: {
        masterEnabled: true,
        graceSeconds: 10,
        unblockMinutes: 15,
        unblockPassesPerDay: 3,
        items: [item],
      },
      usage: {
        days: {
          [day]: {
            patternSeconds: { "e2e-stale.test": 24 * 60 },
            unblocks: {},
            bySite: {},
          },
        },
      },
      session: {
        pattern: "e2e-stale.test",
        phase: "counting",
        phaseStartedAt: now - 120_000,
        lastTickAt: now - 120_000,
      },
      runtime: { unblockUntil: {}, dayOverrides: {}, lastRolloverDay: day },
      settings: { version: 1, itemSeq: 9002, protection: null },
    };
    await new Promise((res) => chrome.storage.local.set({ curfew: state }, res));
    // exactly what popup.js and blocked.js now send on open
    await chrome.runtime.sendMessage({ type: "flush" });
    const after = await new Promise((res) =>
      chrome.storage.local.get("curfew", (d) => res(d.curfew))
    );
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    return {
      usedSeconds: after?.usage?.days?.[day]?.patternSeconds?.["e2e-stale.test"] ?? 0,
      hasRule: rules.some((r) => r.id === 9002),
    };
  });
  console.log("stale-session flush:", JSON.stringify(staleFlush));
  if (staleFlush.usedSeconds < 25 * 60 || !staleFlush.hasRule) {
    console.log("FAIL: flushing a stale session did not credit time / land the wall");
    process.exitCode = 1;
  } else {
    console.log("PASS: stale session flushes into the budget and the block lands");
  }

  // A second "stay anyway" from a stale wall must not burn a second pass.
  const doubleBurn = await page.evaluate(async () => {
    const { dayKey } = await import(chrome.runtime.getURL("src/common/time.js"));
    const day = dayKey();
    const item = {
      id: "e2e-burn",
      ruleId: 9003,
      pattern: "e2e-burn.test",
      budgetMinutes: 0, // closed immediately: every request starts at the wall
      enabled: true,
      access: "granted",
    };
    const state = {
      schema: 1,
      config: {
        masterEnabled: true,
        graceSeconds: 10,
        unblockMinutes: 15,
        unblockPassesPerDay: 3,
        items: [item],
      },
      usage: { days: { [day]: { patternSeconds: {}, unblocks: {}, bySite: {} } } },
      session: null,
      runtime: { unblockUntil: {}, dayOverrides: {}, lastRolloverDay: day },
      settings: { version: 1, itemSeq: 9003, protection: null },
    };
    await new Promise((res) => chrome.storage.local.set({ curfew: state }, res));

    const first = await chrome.runtime.sendMessage({
      type: "unblock:request",
      itemId: item.id,
    });
    const second = await chrome.runtime.sendMessage({
      type: "unblock:request",
      itemId: item.id,
    });
    const after = await new Promise((res) =>
      chrome.storage.local.get("curfew", (d) => res(d.curfew))
    );
    return {
      firstOk: Boolean(first?.ok),
      secondOk: Boolean(second?.ok),
      passes: after?.usage?.days?.[day]?.unblocks?.["e2e-burn.test"] ?? 0,
    };
  });
  console.log("double stay-anyway:", JSON.stringify(doubleBurn));
  if (!doubleBurn.firstOk || !doubleBurn.secondOk || doubleBurn.passes !== 1) {
    console.log("FAIL: a stale wall burned more than one pass");
    process.exitCode = 1;
  } else {
    console.log("PASS: a stale wall burns exactly one pass");
  }

  // Pages write through the worker now: adding a site from the options page
  // must land as an item (with the typed budget) even when the permission
  // prompt cannot be granted in this environment.
  await page.goto(`chrome-extension://${extensionId}/src/options.html`, {
    waitUntil: "networkidle0",
  });
  await page.type("#pattern", "e2e-op.test");
  await page.evaluate(() => {
    document.getElementById("minutes").value = "7";
  });
  await page.click("#add");
  await sleep(700);
  const added = await page.evaluate(async () => {
    const state = await new Promise((res) =>
      chrome.storage.local.get("curfew", (d) => res(d.curfew))
    );
    return state?.config?.items?.find((i) => i.pattern === "e2e-op.test") ?? null;
  });
  console.log("page op add:", JSON.stringify(added));
  if (!added || added.budgetMinutes !== 7 || !added.ruleId) {
    console.log("FAIL: the options page could not write through the worker");
    process.exitCode = 1;
  } else {
    console.log("PASS: the options page writes through the worker");
  }

  // A counting session with 1 minute of allowance left must arm a one-shot
  // "exhaust" alarm for that moment — not wait for the 5-minute tick. The
  // page has to sit on a REAL host, or the tracker ends the session the
  // moment it probes an extension page; a loopback server gives us one
  // without touching the network.
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<!doctype html><title>curfew smoke</title>ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const siteHost = "127.0.0.1";
  await page.goto(`http://${siteHost}:${server.address().port}/`, { waitUntil: "domcontentloaded" });
  // A background extension page supplies chrome.* for the fixture write; the
  // site tab stays ACTIVE so the tracker keeps the session for its host.
  // (blocked.html is used, not options.html: the options page re-verifies
  // real permissions and would flip our synthetic grant to denied.)
  const helper = await browser.newPage();
  await helper.goto(`chrome-extension://${extensionId}/src/blocked.html?domain=${siteHost}`, {
    waitUntil: "domcontentloaded",
  });
  await page.bringToFront();
  await sleep(500);
  const exhaust = await helper.evaluate(async (host) => {
    const { dayKey } = await import(chrome.runtime.getURL("src/common/time.js"));
    const day = dayKey();
    const now = Date.now();
    const item = {
      id: "e2e-exh",
      ruleId: 9010,
      pattern: host,
      budgetMinutes: 5,
      enabled: true,
      access: "granted",
    };
    const state = {
      schema: 1,
      config: {
        masterEnabled: true,
        graceSeconds: 10,
        unblockMinutes: 15,
        unblockPassesPerDay: 3,
        items: [item],
      },
      usage: {
        days: {
          [day]: {
            patternSeconds: { [host]: 4 * 60 },
            unblocks: {},
            bySite: {},
          },
        },
      },
      session: {
        pattern: host,
        phase: "counting",
        phaseStartedAt: now - 1000,
        lastTickAt: now,
      },
      runtime: { unblockUntil: {}, dayOverrides: {}, lastRolloverDay: day },
      settings: { version: 1, itemSeq: 9010, protection: null },
    };
    await new Promise((res) => chrome.storage.local.set({ curfew: state }, res));
    await chrome.runtime.sendMessage({ type: "flush" });
    const alarm = await chrome.alarms.get("exhaust");
    // Alarm exposes scheduledTime; `when` is only a create() input.
    return { leadMs: alarm?.scheduledTime ? alarm.scheduledTime - Date.now() : null };
  }, siteHost);
  console.log("exhaust alarm:", JSON.stringify(exhaust));
  if (exhaust.leadMs === null || exhaust.leadMs < 50_000 || exhaust.leadMs > 70_000) {
    console.log("FAIL: the exhaustion alarm is not armed for the remaining minute");
    process.exitCode = 1;
  } else {
    console.log("PASS: the exhaustion alarm lands on the remaining minute");
  }
  // Anti-infinite-scroll: a session past its limit closes the site, drops the
  // session and arms the cooldown alarm that will re-open it.
  const cooldown = await helper.evaluate(async (host) => {
    const { dayKey } = await import(chrome.runtime.getURL("src/common/time.js"));
    const day = dayKey();
    const now = Date.now();
    const item = {
      id: "e2e-cool",
      ruleId: 9011,
      pattern: host,
      budgetMinutes: 1000,
      sessionLimitMinutes: 1,
      cooldownMinutes: 2,
      enabled: true,
      access: "granted",
    };
    const state = {
      schema: 1,
      config: {
        masterEnabled: true,
        graceSeconds: 10,
        unblockMinutes: 15,
        unblockPassesPerDay: 3,
        items: [item],
      },
      usage: { days: { [day]: { patternSeconds: {}, unblocks: {}, bySite: {} } } },
      session: {
        pattern: host,
        phase: "counting",
        phaseStartedAt: now - 2 * 60_000,
        lastTickAt: now,
        activeMs: 2 * 60_000,
      },
      runtime: {
        unblockUntil: {},
        cooldownUntil: {},
        dayOverrides: {},
        lastRolloverDay: day,
      },
      settings: { version: 1, itemSeq: 9011, protection: null },
    };
    await new Promise((res) => chrome.storage.local.set({ curfew: state }, res));
    await chrome.runtime.sendMessage({ type: "flush" });
    const after = await new Promise((res) =>
      chrome.storage.local.get("curfew", (d) => res(d.curfew))
    );
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const alarm = await chrome.alarms.get("cooldown:9011");
    return {
      session: after?.session,
      cooldownMs: after?.runtime?.cooldownUntil?.[host]
        ? after.runtime.cooldownUntil[host] - Date.now()
        : null,
      hasRule: rules.some((r) => r.id === 9011),
      alarmMs: alarm?.scheduledTime ? alarm.scheduledTime - Date.now() : null,
    };
  }, siteHost);
  console.log("cooldown:", JSON.stringify(cooldown));
  const cooldownOk =
    cooldown.session === null &&
    cooldown.cooldownMs !== null &&
    cooldown.cooldownMs > 100_000 &&
    cooldown.hasRule &&
    cooldown.alarmMs !== null &&
    cooldown.alarmMs > 100_000;
  if (!cooldownOk) {
    console.log("FAIL: the session limit did not close the site / arm the cooldown");
    process.exitCode = 1;
  } else {
    console.log("PASS: the session limit closes the site and arms the cooldown");
  }
  // A wall can outlive its rule: dynamic rules survive a browser restart, so
  // a restored tab may hit one before the worker reconciles. Opening such a
  // stale wall must leave on its own instead of trapping the user.
  await helper.evaluate(async (host) => {
    const { dayKey } = await import(chrome.runtime.getURL("src/common/time.js"));
    const day = dayKey();
    const item = {
      id: "e2e-stale-wall",
      ruleId: 9020,
      pattern: host,
      budgetMinutes: 1000,
      sessionLimitMinutes: 0,
      cooldownMinutes: 0,
      enabled: true,
      access: "granted",
    };
    await new Promise((res) =>
      chrome.storage.local.set(
        {
          curfew: {
            schema: 1,
            config: {
              masterEnabled: true,
              graceSeconds: 10,
              unblockMinutes: 15,
              unblockPassesPerDay: 3,
              items: [item],
            },
            usage: { days: { [day]: { patternSeconds: {}, unblocks: {}, bySite: {} } } },
            session: null,
            runtime: {
              unblockUntil: {},
              cooldownUntil: {},
              dayOverrides: {},
              lastRolloverDay: day,
            },
            settings: { version: 1, itemSeq: 9020, protection: null },
          },
        },
        res
      )
    );
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [
        {
          id: 9020,
          priority: 1,
          action: { type: "redirect", redirect: { extensionPath: "/src/blocked.html" } },
          condition: { urlFilter: `||${host}/`, resourceTypes: ["main_frame"] },
        },
      ],
    });
  }, siteHost);
  // Count navigations: a redirect loop (site <-> wall) shows up as a storm.
  let navigations = 0;
  const countNav = (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  };
  page.on("framenavigated", countNav);
  await page.goto(`chrome-extension://${extensionId}/src/blocked.html?domain=${siteHost}`, {
    waitUntil: "domcontentloaded",
  });
  // Keep re-planting the stale rule for a while: the wall must refuse to
  // navigate while it exists, then leave exactly once when it is gone.
  for (let i = 0; i < 10; i++) {
    await helper.evaluate(async (host) => {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [9020],
        addRules: [
          {
            id: 9020,
            priority: 1,
            action: { type: "redirect", redirect: { extensionPath: "/src/blocked.html" } },
            condition: { urlFilter: `||${host}/`, resourceTypes: ["main_frame"] },
          },
        ],
      });
    }, siteHost);
    await sleep(300);
  }
  // Now let the worker reconcile (the wall's own flush path): the rule goes,
  // and the wall must leave on its own shortly after.
  await helper.evaluate(() => chrome.runtime.sendMessage({ type: "flush" }));
  await sleep(3500);
  page.off("framenavigated", countNav);
  const wallUrl = page.url();
  console.log("stale wall left to:", wallUrl, "| navigations:", navigations);
  if (wallUrl.includes("blocked.html")) {
    console.log("FAIL: a stale wall trapped the user");
    process.exitCode = 1;
  } else if (navigations > 4) {
    console.log("FAIL: redirect loop (site <-> wall flicker)");
    process.exitCode = 1;
  } else {
    console.log("PASS: a stale wall leaves by itself, without a loop");
  }

  await helper.close();
  await new Promise((resolve) => server.close(resolve));

  // the wall page must load with zero script errors (module imports etc.)
  await page.goto(`chrome-extension://${extensionId}/src/blocked.html?domain=github.com`, {
    waitUntil: "networkidle0",
  });
  await sleep(300);
  const wallState = await page.evaluate(() => ({
    domain: document.getElementById("domain")?.textContent,
    hasStay: Boolean(document.getElementById("stay")),
  }));
  console.log("wall:", JSON.stringify(wallState));
  if (!wallState.hasStay || !wallState.domain) {
    console.log("FAIL: wall page did not initialize");
    process.exitCode = 1;
  } else if (pageErrors.length) {
    console.log("FAIL: page errors:", pageErrors.join(" | "));
    process.exitCode = 1;
  } else {
    console.log("PASS: wall page initialized cleanly");
  }
} finally {
  await browser.close();
}
