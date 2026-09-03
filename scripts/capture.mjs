/** Store screenshots (1280x800) + README demo GIF.
 *  Run: npm run capture */
import puppeteer from "puppeteer";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome } from "./chrome-path.mjs";
import gifenc from "gifenc";
import { PNG } from "pngjs";

const { GIFEncoder, quantize, applyPalette } = gifenc;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "screenshots");
const FRAMES = join(OUT, "gif-frames");
const GIF_OUT = join(ROOT, "docs", "demo.gif");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STORE_W = 1280;
const STORE_H = 800;
const GIF_W = 400;
const GIF_H = 760;

function dayKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function demoState(unblocks = {}) {
  const day = (patterns, ub = {}) => ({
    patternSeconds: { ...patterns },
    unblocks: { ...ub },
    bySite: Object.fromEntries(
      Object.entries(patterns).map(([p, s]) => [p.replace(/^\*\./, ""), s])
    ),
  });
  return {
    schema: 1,
    config: {
      masterEnabled: true,
      graceSeconds: 10,
      unblockMinutes: 15,
      unblockPassesPerDay: 3,
      items: [
        { id: "u1", ruleId: 1001, pattern: "x.com", budgetMinutes: 30, enabled: true, access: "granted" },
        { id: "u2", ruleId: 1002, pattern: "*.reddit.com", budgetMinutes: 45, enabled: true, access: "granted" },
        { id: "u3", ruleId: 1003, pattern: "github.com", budgetMinutes: 0, enabled: true, access: "granted" },
      ],
    },
    usage: {
      days: {
        [dayKey()]: day(
          { "x.com": 1320, "*.reddit.com": 2460, "github.com": 240 },
          { "*.reddit.com": 1, "github.com": unblocks.github ?? 0 }
        ),
        [dayKey(-1)]: day({ "x.com": 2400, "*.reddit.com": 3900 }),
      },
    },
    session: null,
    runtime: { unblockUntil: {}, dayOverrides: {} },
    settings: { version: 1, itemSeq: 1003, protection: null },
  };
}

async function extId(browser) {
  const target = await browser.waitForTarget((t) => t.type() === "service_worker");
  return new URL(target.url()).host;
}

async function seed(page, state) {
  await page.evaluate((s) => {
    return new Promise((resolve) =>
      chrome.storage.local.set({ curfew: s }, resolve)
    );
  }, state);
}

/** Pages reconcile access flags with the (empty) permissions API on load,
 *  so demo data is seeded AFTER load — onChanged re-renders it as granted. */
async function openExtPage(browser, path) {
  const page = await browser.newPage();
  await page.setViewport({ width: STORE_W, height: STORE_H });
  await page.goto(`chrome-extension://${await extId(browser)}${path}`, {
    waitUntil: "networkidle0",
  });
  await sleep(400);
  return page;
}

function shot(page, path, clip) {
  return page.screenshot(clip ? { path, clip } : { path });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(FRAMES, { recursive: true });
  for (const f of readdirSync(FRAMES)) {
    if (f.endsWith(".png")) rmSync(join(FRAMES, f));
  }

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: await findChrome(),
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
      "--no-sandbox",
    ],
  });
  const id = await extId(browser);
  const extUrl = (p) => `chrome-extension://${id}${p}`;

  try {
    /* ---------- store screenshots ---------- */

    // 1. popup dashboard on a night-sky backdrop
    let page = await openExtPage(browser, "/src/popup.html");
    await seed(page, demoState());
    await sleep(400);
    await page.addStyleTag({
      content: `
        html { background: linear-gradient(135deg, #1d2f55 0%, #0a0f1c 75%) !important; }
        body { margin: 70px auto !important; box-shadow: 0 20px 70px rgba(0,0,0,.6); border-radius: 12px; }
      `,
    });
    await shot(page, join(OUT, "popup.png"), {
      x: (STORE_W - 420) / 2, y: 40, width: 420, height: STORE_H - 80,
    });
    await page.close();

    // 2. the wall
    page = await openExtPage(browser, "/src/blocked.html?domain=x.com");
    await sleep(200);
    await shot(page, join(OUT, "wall.png"));
    await page.close();

    // 3. options: sites + protection card
    page = await openExtPage(browser, "/src/options.html");
    await seed(page, demoState());
    await sleep(400);
    await shot(page, join(OUT, "options.png"));

    // 4. equation challenge dialog over the options page
    await page.click("#protectToggle");
    await sleep(200);
    for (const b of await page.$$("dialog button")) {
      if ((await b.evaluate((el) => el.textContent)) === "OK") {
        await b.click();
        break;
      }
    }
    await sleep(250);
    await shot(page, join(OUT, "challenge.png"));
    await page.close();

    /* ---------- GIF frames ---------- */
    const frame = await browser.newPage();
    await frame.setViewport({ width: GIF_W, height: GIF_H });
    const extUrl = (p) => `chrome-extension://${id}${p}`;
    let n = 0;
    const snap = async (name) => {
      await frame.screenshot({
        path: join(FRAMES, `f${String(n).padStart(2, "0")}-${name}.png`),
      });
      n++;
    };
    const clickButtonWithText = async (text) => {
      for (const b of await frame.$$("dialog button")) {
        if ((await b.evaluate((el) => el.textContent)) === text) {
          await b.click();
          return true;
        }
      }
      return false;
    };
    const solveEquation = async () => {
      const expr = await frame.evaluate(() =>
        document.querySelector("dialog")?.textContent?.match(/([\d\s+\-×:()]+)= \?/)?.[1]
      );
      const answer = await frame.evaluate(
        (t) =>
          import(chrome.runtime.getURL("src/common/equation.js")).then((m) =>
            m.evaluateExpression(t)
          ),
        expr
      );
      await frame.type("dialog input", String(answer));
      await frame.keyboard.press("Enter");
    };

    // f0 popup with seeded usage
    await frame.goto(extUrl("/src/popup.html"), { waitUntil: "networkidle0" });
    await sleep(400);
    await seed(frame, demoState());
    await sleep(450);
    await snap("popup");

    // f1 sites list
    await frame.goto(extUrl("/src/options.html"), { waitUntil: "networkidle0" });
    await sleep(400);
    await seed(frame, demoState());
    await sleep(450);
    await snap("sites");

    // f2 protection choice
    await frame.click("#protectToggle");
    await sleep(250);
    await snap("protect-choice");

    // f3 equation challenge
    await clickButtonWithText("OK");
    await sleep(250);
    await snap("challenge-equation");

    // f4 answer typed
    await solveEquation();
    await sleep(150);
    await snap("challenge-typed");

    // f5 protection on (same page — no reload, flags intact)
    await sleep(250);
    await frame.evaluate(() =>
      document.querySelector(".protect-box")?.scrollIntoView({ block: "center" })
    );
    await sleep(150);
    await snap("protect-on");

    // f6 wall
    await frame.goto(extUrl("/src/blocked.html?domain=github.com"), {
      waitUntil: "networkidle0",
    });
    await sleep(250);
    await snap("wall");

    // f7 stay anyway -> challenge (protection is on)
    await frame.click("#stay");
    await sleep(300);
    await snap("challenge-wall");

    // f8 typed
    await solveEquation();
    await sleep(150);
    await snap("challenge-wall-typed");

    // f9 back on the site -> popup with passes chips
    await sleep(900);
    await frame.goto(extUrl("/src/popup.html"), { waitUntil: "networkidle0" });
    await sleep(400);
    await seed(frame, demoState({ github: 1 }));
    await sleep(450);
    await snap("popup-final");
    await frame.close();

    /* ---------- assemble GIF ---------- */
    const gif = GIFEncoder();
    const files = readdirSync(FRAMES).filter((f) => f.endsWith(".png")).sort();
    for (const file of files) {
      const png = PNG.sync.read(readFileSync(join(FRAMES, file)));
      const palette = quantize(png.data, 256);
      const index = applyPalette(png.data, palette);
      gif.writeFrame(index, png.width, png.height, { palette, delay: 1000 });
    }
    gif.finish();
    writeFileSync(GIF_OUT, gif.bytes());
    console.log(`GIF: ${GIF_OUT} (${gif.bytes().length} bytes, ${files.length} frames)`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
