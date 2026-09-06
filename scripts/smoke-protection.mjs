import puppeteer from "puppeteer";
import { join, dirname } from "node:path";
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
