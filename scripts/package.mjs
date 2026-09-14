/**
 * Build the Chrome Web Store package: dist/curfew-extension-<version>.zip
 *
 * The store rejects a package that carries anything beyond the extension
 * itself, so the file list is an ALLOWLIST and every entry is validated before
 * a single byte is written. Run: npm run package
 */
import { createHash } from "node:crypto";
import { deflateRawSync, crc32 } from "node:zlib";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "dist");

/** Everything the extension needs at runtime, and nothing else. */
const ALLOWLIST = ["manifest.json", "src", "_locales", "icons"];

/** Patterns that must never ship (the invariant suite checks src too). */
const BANNED = [
  { what: "eval", re: /\beval\s*\(/ },
  { what: "new Function", re: /\bnew\s+Function\s*\(/ },
  { what: "fetch", re: /\bfetch\s*\(/ },
  { what: "XMLHttpRequest", re: /\bXMLHttpRequest\b/ },
  { what: "WebSocket", re: /\bWebSocket\b/ },
  { what: "remote import", re: /import\s*\(\s*["']https?:/ },
  { what: "remote script tag", re: /<script[^>]*src=["']https?:/ },
];

function fail(message) {
  console.error(`package: ${message}`);
  process.exit(1);
}

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

// ---------------------------------------------------------------- collect
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const files = [];
for (const entry of ALLOWLIST) {
  const full = join(ROOT, entry);
  if (!statSync(full, { throwIfNoEntry: false })) fail(`missing from the allowlist: ${entry}`);
  if (statSync(full).isDirectory()) files.push(...walk(full).map((f) => `${entry}/${f}`));
  else files.push(entry);
}
files.sort();

// ------------------------------------------------------------- validate
for (const required of ["name", "version", "description", "manifest_version", "background"]) {
  if (!manifest[required]) fail(`manifest.json has no "${required}"`);
}
if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
if (!/^\d+\.\d+\.\d+(\.\d+)?$/.test(manifest.version)) fail(`bad version "${manifest.version}"`);

for (const icon of [
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
]) {
  if (!files.includes(icon)) fail(`manifest references an icon that is not packaged: ${icon}`);
}

const locales = readdirSync(join(ROOT, "_locales"));
if (!locales.includes(manifest.default_locale)) {
  fail(`default_locale "${manifest.default_locale}" has no _locales directory`);
}
for (const locale of locales) {
  const messages = JSON.parse(readFileSync(join(ROOT, "_locales", locale, "messages.json"), "utf8"));
  for (const key of ["extName", "extDesc"]) {
    if (!messages[key]?.message) fail(`_locales/${locale} has no ${key}`);
  }
  if (messages.extDesc.message.length > 132) {
    fail(`_locales/${locale} extDesc is ${messages.extDesc.message.length} chars (store limit 132)`);
  }
}

for (const file of files) {
  if (file === "manifest.json" || !/\.(js|mjs|html)$/.test(file)) continue;
  const text = readFileSync(join(ROOT, file), "utf8");
  for (const { what, re } of BANNED) {
    if (re.test(text)) fail(`${file} contains ${what}`);
  }
}

const size = files.reduce((sum, f) => sum + statSync(join(ROOT, f)).size, 0);
if (size > 4 * 1024 * 1024) fail(`package would be ${Math.round(size / 1024)} KB, over the 4 MB budget`);
if (files.length > 200) fail(`${files.length} files is more than the store expects`);

// ------------------------------------------------------------------ zip
/** A minimal, dependency-free ZIP writer (deflate, fixed timestamps). */
function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const DOS_TIME = (12 << 11) | (0 << 5) | 0; // 12:00:00
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const deflated = deflateRawSync(data, { level: 9 });
    // zlib.crc32 returns a SIGNED 32-bit int; the ZIP field is unsigned.
    const crc = crc32(data) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(deflated.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    chunks.push(header, nameBytes, deflated);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // version made by
    dir.writeUInt16LE(20, 6); // version needed
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(deflated.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt16LE(0, 30); // extra
    dir.writeUInt16LE(0, 32); // comment
    dir.writeUInt16LE(0, 34); // disk
    dir.writeUInt16LE(0, 36); // internal attrs
    dir.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: regular file
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBytes);
    offset += header.length + nameBytes.length + deflated.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuffer, end]);
}

const entries = files.map((name) => ({ name, data: readFileSync(join(ROOT, name)) }));
const archive = zip(entries);

mkdirSync(OUT_DIR, { recursive: true });
const outPath = join(OUT_DIR, `curfew-extension-${manifest.version}.zip`);
writeFileSync(outPath, archive);

// ---------------------------------------------------------------- report
const digest = createHash("sha256").update(archive).digest("hex");
console.log(`package: ${relative(ROOT, outPath)}`);
console.log(`  version   ${manifest.version}`);
console.log(`  files     ${entries.length}`);
console.log(`  raw       ${Math.round(size / 1024)} KB`);
console.log(`  zipped    ${Math.round(archive.length / 1024)} KB`);
console.log(`  sha256    ${digest}`);
console.log("  contents:");
for (const name of files) console.log(`    ${name}`);
