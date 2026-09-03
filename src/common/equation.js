/** Arithmetic challenge generator: "х:(у-з)+34" style expressions with
 *  5-7 one/two-digit operands, brackets, and a guaranteed non-negative
 *  integer answer. Rendering uses × and : (division). */

function randInt(min, max, rng) {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

function wrap(text, parens) {
  return parens ? `(${text})` : text;
}

function divisorsOf(value, max) {
  const out = [];
  for (let d = 2; d <= Math.min(max, value); d++) {
    if (value % d === 0) out.push(d);
  }
  return out;
}

/** Returns { text, value, terms }. rng injectable for deterministic tests.
 *  terms omitted -> random 5-7 per equation. */
export function generateEquation({ terms } = {}, rng = Math.random) {
  const count = terms ? Math.max(5, Math.min(7, terms)) : randInt(5, 7, rng);
  let value = randInt(10, 99, rng);
  let text = String(value);
  let lowPrec = true;

  for (let used = 1; used < count; used++) {
    const remaining = count - used;
    let op = pick(["+", "+", "-", "*", "/"], rng);
    if (op === "/" && divisorsOf(value, 12).length === 0) op = "+";
    if (op === "*" && (value > 500 || remaining === 1 && value > 99)) op = "+";

    if (op === "+") {
      const n = randInt(1, 99, rng);
      value += n;
      text += ` + ${n}`;
      lowPrec = true;
    } else if (op === "-") {
      const n = randInt(1, 99, rng);
      if (value - n >= 0) {
        value -= n;
        text += ` - ${n}`;
      } else {
        value = n - value;
        text = `${n} - (${text})`;
      }
      lowPrec = true;
    } else if (op === "*") {
      const n = randInt(2, 12, rng);
      value *= n;
      text = `${wrap(text, lowPrec)} × ${n}`;
      lowPrec = false;
    } else {
      const divisors = divisorsOf(value, 12);
      const n = pick(divisors, rng);
      value /= n;
      text = `${wrap(text, lowPrec)} : ${n}`;
      lowPrec = false;
    }
  }
  return { text, value, terms: count };
}

/** Minimal evaluator for generated expressions (digits, + - × : / * ( )).
 *  Used by tests to cross-check that the rendered text matches the answer. */
export function evaluateExpression(text) {
  let pos = 0;

  function skip() {
    while (pos < text.length && text[pos] === " ") pos++;
  }

  function parsePrimary() {
    skip();
    if (text[pos] === "(") {
      pos++;
      const v = parseSum();
      skip();
      if (text[pos] !== ")") throw new Error("expected )");
      pos++;
      return v;
    }
    const start = pos;
    while (pos < text.length && text[pos] >= "0" && text[pos] <= "9") pos++;
    if (pos === start) throw new Error("expected number");
    return parseInt(text.slice(start, pos), 10);
  }

  function parseProduct() {
    let v = parsePrimary();
    for (;;) {
      skip();
      const ch = text[pos];
      if (ch === "×" || ch === "*" || ch === ":" || ch === "/") {
        pos++;
        const rhs = parsePrimary();
        v = ch === "×" || ch === "*" ? v * rhs : v / rhs;
      } else {
        return v;
      }
    }
  }

  function parseSum() {
    let v = parseProduct();
    for (;;) {
      skip();
      const ch = text[pos];
      if (ch === "+" || ch === "-") {
        pos++;
        const rhs = parseProduct();
        v = ch === "+" ? v + rhs : v - rhs;
      } else {
        return v;
      }
    }
  }

  const value = parseSum();
  skip();
  if (pos !== text.length) throw new Error("trailing input");
  return value;
}
