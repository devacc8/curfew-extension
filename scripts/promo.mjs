/** Chrome Web Store promo tiles.
 *  Run: npm run promo
 *
 *  Small tile 440x280 shows up in search results, the marquee 1400x560 on the
 *  listing page. Both are rendered from the same palette as the extension, so
 *  a colour change in src/theme.css means a rerun here. */
import puppeteer from "puppeteer";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome } from "./chrome-path.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "promo");

const icon = readFileSync(join(ROOT, "icons", "icon128.png")).toString("base64");

const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; }
  body {
    font-family: ${FONT};
    background: linear-gradient(160deg, #1d2f55 0%, #14161a 50%, #0a0f1c 100%);
    color: #e8eaed;
    overflow: hidden;
  }
  .mark { display: flex; align-items: center; gap: 14px; }
  .mark img { border-radius: 22%; }
  .name { font-weight: 700; letter-spacing: -0.02em; }
  .muted { color: #9aa0a6; }
  .accent { color: #7da2ff; }
  .chips { display: flex; gap: 10px; }
  .chip {
    border: 1px solid #2a2d33;
    background: #1c1f24;
    border-radius: 999px;
    color: #9aa0a6;
    white-space: nowrap;
  }
  .card {
    background: #1c1f24;
    border: 1px solid #2a2d33;
    border-radius: 18px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  }
  .bar { background: #24272d; border-radius: 999px; overflow: hidden; }
  .bar > div {
    height: 100%;
    background: linear-gradient(90deg, #7da2ff, #5b7fe0);
    border-radius: 999px;
  }
`;

/* 440x280: name, one promise, and a live looking budget bar. */
const small = `
<!doctype html><html><head><meta charset="utf-8"><style>
  ${BASE_CSS}
  body { padding: 26px 30px; display: flex; flex-direction: column; }
  .mark img { width: 52px; height: 52px; }
  .name { font-size: 30px; }
  h1 { font-size: 25px; line-height: 1.15; letter-spacing: -0.02em; margin-top: 22px; }
  p { font-size: 15px; margin-top: 10px; }
  .meter { margin-top: auto; }
  .row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 7px; }
  .bar { height: 10px; }
  .bar > div { width: 72%; }
</style></head><body>
  <div class="mark"><img src="data:image/png;base64,${icon}"><span class="name">Curfew</span></div>
  <h1>Daily budgets for the sites you choose.</h1>
  <p class="muted">Blocked at the network level. Local only, zero tracking.</p>
  <div class="meter">
    <div class="row"><span class="muted">x.com</span><span class="accent">18 / 25 min</span></div>
    <div class="bar"><div></div></div>
  </div>
</body></html>`;

/* 1400x560: the pitch on the left, the wall the user actually meets on the right. */
const marquee = `
<!doctype html><html><head><meta charset="utf-8"><style>
  ${BASE_CSS}
  body { display: flex; align-items: center; gap: 64px; padding: 0 72px; }
  .left { flex: 1; min-width: 0; }
  .mark img { width: 84px; height: 84px; }
  .name { font-size: 54px; }
  h1 { font-size: 46px; line-height: 1.1; letter-spacing: -0.025em; margin-top: 30px; }
  p { font-size: 22px; line-height: 1.45; margin-top: 18px; max-width: 720px; }
  .chips { margin-top: 30px; }
  .chip { font-size: 16px; padding: 9px 16px; }
  .card { width: 460px; padding: 34px 36px; flex: none; }
  .card h2 { font-size: 27px; letter-spacing: -0.02em; }
  .card .site { font-size: 15px; margin-top: 8px; }
  .card p { font-size: 16px; line-height: 1.5; margin-top: 22px; }
  .stats { display: flex; gap: 34px; margin-top: 26px; }
  .stat .k { font-size: 13px; }
  .stat .v { font-size: 21px; margin-top: 4px; }
  .cta {
    margin-top: 30px;
    background: #7da2ff;
    color: #10131a;
    text-align: center;
    font-size: 17px;
    font-weight: 600;
    border-radius: 12px;
    padding: 14px;
  }
  .hint { margin-top: 14px; text-align: center; font-size: 13px; }
</style></head><body>
  <div class="left">
    <div class="mark"><img src="data:image/png;base64,${icon}"><span class="name">Curfew</span></div>
    <h1>The internet curfew for your distraction sites.</h1>
    <p class="muted">Set a daily budget per site. When it runs out, the site is closed
      until midnight. Relaxing a rule costs a solved puzzle, not a click.</p>
    <div class="chips">
      <span class="chip">Manifest V3</span>
      <span class="chip">No trackers</span>
      <span class="chip">No install warnings</span>
    </div>
  </div>
  <div class="card">
    <h2>Under curfew</h2>
    <div class="site muted">x.com</div>
    <p class="muted">This site is closed for today. It opens again after midnight.</p>
    <div class="stats">
      <div class="stat"><div class="k muted">Time here today</div><div class="v">25 min</div></div>
      <div class="stat"><div class="k muted">Passes used</div><div class="v">2 of 3</div></div>
    </div>
    <div class="cta">Stay anyway for 15 minutes</div>
    <div class="hint muted">asks for the equation first</div>
  </div>
</body></html>`;

const TILES = [
  { html: small, file: "small-440x280.png", width: 440, height: 280 },
  { html: marquee, file: "marquee-1400x560.png", width: 1400, height: 560 },
];

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: await findChrome(),
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
});
try {
  const page = await browser.newPage();
  for (const tile of TILES) {
    const tmp = join(OUT, `.${tile.file}.html`);
    writeFileSync(tmp, tile.html);
    await page.setViewport({
      width: tile.width,
      height: tile.height,
      deviceScaleFactor: 1,
    });
    await page.goto(`file://${tmp}`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
    }));
    if (overflow.scrollW > tile.width || overflow.scrollH > tile.height) {
      throw new Error(
        `${tile.file}: content overflows the tile (${overflow.scrollW}x${overflow.scrollH})`
      );
    }
    await page.screenshot({ path: join(OUT, tile.file) });
    rmSync(tmp);
    console.log(`promo: docs/promo/${tile.file} (${tile.width}x${tile.height})`);
  }
} finally {
  await browser.close();
}
