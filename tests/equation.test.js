import { test } from "node:test";
import assert from "node:assert/strict";
import { generateEquation, evaluateExpression } from "../src/common/equation.js";
import { seededRng } from "./helpers/rng.js";

test("evaluateExpression respects precedence and brackets", () => {
  assert.equal(evaluateExpression("2 + 3 × 4"), 14);
  assert.equal(evaluateExpression("(2 + 3) × 4"), 20);
  assert.equal(evaluateExpression("10 : (8 - 6)"), 5);
  assert.equal(evaluateExpression("34 - (7 - 20)"), 47);
  assert.equal(evaluateExpression("12 : 3 : 2"), 2);
});

test("generated equations: integer non-negative answer rendered correctly", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rng = seededRng(seed);
    for (const terms of [5, 6, 7]) {
      const { text, value, terms: used } = generateEquation({ terms }, rng);
      assert.equal(used, terms, `terms mismatch for seed ${seed}`);
      assert.equal(Number.isInteger(value), true, `non-integer: ${text}`);
      assert.ok(value >= 0, `negative: ${text} = ${value}`);
      assert.equal(evaluateExpression(text), value, `render mismatch: ${text}`);
    }
  }
});

test("generated equations use only 1-2 digit operands and allowed chars", () => {
  for (let seed = 100; seed <= 130; seed++) {
    const { text } = generateEquation({ terms: 6 }, seededRng(seed));
    assert.equal(/[^0-9+\-×:() ]/.test(text), false, `bad chars: ${text}`);
    const operands = text.match(/\d+/g) ?? [];
    assert.equal(operands.length >= 5, true, `too few terms: ${text}`);
    for (const n of operands) {
      assert.ok(Number(n) >= 1 && Number(n) <= 99, `operand out of range: ${n} in ${text}`);
    }
  }
});

test("generated equations contain brackets often enough to matter", () => {
  let withBrackets = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const { text } = generateEquation({ terms: 7 }, seededRng(seed));
    if (text.includes("(")) withBrackets++;
  }
  assert.ok(withBrackets > 40, `brackets too rare: ${withBrackets}/200`);
});
