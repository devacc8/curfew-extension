import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "../src/common/storage.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The schema sample from TECHNICAL_DESIGN §6.1, minus its jsonc comments. */
function schemaSample() {
  const doc = readFileSync(join(ROOT, "docs", "TECHNICAL_DESIGN.md"), "utf8");
  const start = doc.indexOf("### 6.1 Schema v1");
  assert.ok(start > 0, "§6.1 not found");
  const section = doc.slice(start, doc.indexOf("### 6.2", start));
  const match = section.match(/```jsonc\n([\s\S]*?)```/);
  assert.ok(match, "schema sample block not found");
  const json = match[1]
    .replace(/[ \t]*\/\/[^\n]*/g, "") // jsonc trailing comments
    .replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(json);
}

/** Every field the code produces must be documented (extra doc fields are ok). */
function assertDocumented(codeObject, sampleObject, path) {
  for (const key of Object.keys(codeObject)) {
    assert.ok(key in sampleObject, `${path}.${key} is not documented in §6.1`);
  }
}

test("docs schema sample documents every field the code writes", () => {
  const sample = schemaSample();
  const state = migrate({});
  assertDocumented(state, sample, "state");
  assertDocumented(state.config, sample.config, "config");
  assertDocumented(state.usage, sample.usage, "usage");
  assertDocumented(state.runtime, sample.runtime, "runtime");
  assertDocumented(state.settings, sample.settings, "settings");

  const session = migrate({
    schema: 1,
    session: { pattern: "x.com", phase: "counting", phaseStartedAt: 1, lastTickAt: 2, activeMs: 3 },
  }).session;
  assertDocumented(session, sample.session, "session");

  const dayRow = migrate({
    schema: 1,
    usage: { days: { "2026-09-02": { patternSeconds: {}, passes: {}, bySite: {} } } },
  }).usage.days["2026-09-02"];
  assertDocumented(dayRow, sample.usage.days["2026-09-02"], "usage.days[row]");

  const item = migrate({
    schema: 1,
    config: { items: [{ pattern: "x.com" }] },
  }).config.items[0];
  assertDocumented(item, sample.config.items[0], "config.items[]");
});
