import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const MANIFEST = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));

const ALLOWED_PERMISSIONS = [
  "storage",
  "idle",
  "alarms",
  "declarativeNetRequestWithHostAccess",
  "contextMenus",
  "activeTab",
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const srcFiles = walk(join(ROOT, "src"));
const jsFiles = srcFiles.filter((f) => f.endsWith(".js"));

test("manifest permissions match the allowlist exactly", () => {
  assert.deepEqual(MANIFEST.permissions, ALLOWED_PERMISSIONS);
});

test("manifest grants no static host access", () => {
  assert.equal("host_permissions" in MANIFEST, false);
  assert.deepEqual(MANIFEST.optional_host_permissions, ["*://*/*"]);
});

test("manifest keeps the privacy posture keys", () => {
  assert.equal(MANIFEST.incognito, "not_allowed");
  assert.equal("content_security_policy" in MANIFEST, false);
  assert.equal(MANIFEST.background.type, "module");
  assert.equal(MANIFEST.manifest_version, 3);
});

test("web_accessible_resources exposes exactly blocked.html", () => {
  const war = MANIFEST.web_accessible_resources;
  assert.equal(war.length, 1);
  assert.deepEqual(war[0].resources, ["src/blocked.html"]);
});

test("manifest-referenced files exist on disk", () => {
  const iconPaths = [
    ...Object.values(MANIFEST.icons ?? {}),
    ...Object.values(MANIFEST.action?.default_icon ?? {}),
  ];
  for (const path of [
    MANIFEST.background.service_worker,
    MANIFEST.action.default_popup,
    MANIFEST.options_page,
    ...MANIFEST.web_accessible_resources.flatMap((w) => w.resources),
    ...iconPaths,
  ]) {
    assert.equal(existsSync(join(ROOT, path)), true, `missing: ${path}`);
  }
});

test("no network primitives anywhere in src/", () => {
  const banned = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bEventSource\b/,
    /from\s+["']https?:/,
    /import\s*\(\s*["']https?:/,
    /<script[^>]*src=["']https?:/,
    /@import\s+url\(\s*["']?https?:/,
  ];
  for (const file of srcFiles) {
    const text = readFileSync(file, "utf8");
    for (const re of banned) {
      assert.equal(re.test(text), false, `${file} matches ${re}`);
    }
  }
});

test("locales are well-formed Chrome i18n trees and stay in sync", () => {
  const en = JSON.parse(readFileSync(join(ROOT, "_locales/en/messages.json"), "utf8"));
  const ru = JSON.parse(readFileSync(join(ROOT, "_locales/ru/messages.json"), "utf8"));
  for (const [name, data] of [["en", en], ["ru", ru]]) {
    for (const [key, value] of Object.entries(data)) {
      assert.equal(
        typeof value?.message, "string",
        `${name}/${key}: not a { message } tree`
      );
    }
  }
  assert.deepEqual(
    Object.keys(en).sort(), Object.keys(ru).sort(),
    "en/ru locale keys diverge"
  );
});

test("common/ purity: chrome.* only in storage.js", () => {
  const commonDir = join(ROOT, "src", "common");
  for (const file of jsFiles.filter((f) => dirname(f) === commonDir)) {
    const text = readFileSync(file, "utf8");
    if (file.endsWith("storage.js")) continue;
    assert.equal(/\bchrome\s*\./.test(text), false, `${file} references chrome`);
  }
});

test("the state document has exactly one writer: the service worker", () => {
  const storagePath = join(ROOT, "src", "common", "storage.js");
  // The worker and its private modules own the document; pages never do.
  const isWorker = (file) =>
    file.endsWith("service-worker.js") || file.includes(join("src", "sw") + sep);
  for (const file of jsFiles) {
    const text = readFileSync(file, "utf8");
    if (file !== storagePath) {
      assert.equal(
        /chrome\.storage\.local\.(set|remove)\b/.test(text),
        false,
        `${file} writes chrome.storage.local directly`
      );
    }
    if (file === storagePath || isWorker(file)) continue;
    // Pages must go through mutate(); importing update() would let a page
    // read-modify-write over a concurrent credit (no storage transactions).
    for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*storage\.js["']/g)) {
      assert.equal(
        /\bupdate\b/.test(match[1]),
        false,
        `${file} imports the low-level update(); use mutate()`
      );
    }
  }
});
