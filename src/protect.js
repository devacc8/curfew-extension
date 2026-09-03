import { load, update } from "./common/storage.js";
import { generateEquation } from "./common/equation.js";
import {
  SIZE,
  isSolved,
  legalTiles,
  moveTile,
  shuffledBoard,
} from "./common/puzzle.js";

const msg = (key) => chrome.i18n.getMessage(key);

const INK = "#e8eaed";
const MUTED = "#9aa0a6";
const LINE = "#2a2d33";
const ACCENT = "#7da2ff";
const FIELD_BG = "#14161a";
const PANEL_BG = "#1c1f24";
const DANGER = "#e07a7a";

/** Every dialog is a FRESH element: stale close events from a previous
 *  dialog generation must never reach the next one (a real bug: the setup
 *  dialog's close event killed the freshly-opened challenge). */
let frame = null;

function openDialog() {
  frame?.dialog.remove();
  const dialog = document.createElement("dialog");
  dialog.style.background = PANEL_BG;
  dialog.style.color = INK;
  dialog.style.border = `1px solid ${LINE}`;
  dialog.style.borderRadius = "10px";
  dialog.style.padding = "18px";
  dialog.style.minWidth = "260px";
  dialog.style.font = "13px/1.45 system-ui, sans-serif";

  const body = document.createElement("div");

  const hint = document.createElement("p");
  hint.style.minHeight = "16px";
  hint.style.margin = "8px 0";
  hint.style.color = DANGER;
  hint.style.fontSize = "12px";

  const controls = document.createElement("div");
  controls.style.display = "flex";
  controls.style.gap = "8px";
  controls.style.justifyContent = "flex-end";

  const cancelButton = document.createElement("button");
  cancelButton.textContent = msg("dialogCancel");
  styleButton(cancelButton, false);
  cancelButton.addEventListener("click", () => {
    const handler = frame?.onCancel;
    frame && (frame.onCancel = null);
    destroyDialog();
    handler?.();
  });
  controls.append(cancelButton);

  const okButton = document.createElement("button");
  okButton.textContent = msg("dialogOk");
  styleButton(okButton, true);
  controls.append(okButton);

  dialog.append(body, hint, controls);
  document.body.append(dialog);

  frame = { dialog, body, hint, okButton, onCancel: null };
  dialog.addEventListener("close", () => {
    const handler = frame?.onCancel;
    frame && (frame.onCancel = null);
    handler?.();
  });
  return frame;
}

function destroyDialog() {
  frame?.dialog.remove();
  frame = null;
}

function styleButton(button, primary) {
  if (primary) {
    button.style.background = ACCENT;
    button.style.color = "#10131a";
    button.style.border = "0";
  } else {
    button.style.background = "transparent";
    button.style.color = MUTED;
    button.style.border = `1px solid ${LINE}`;
  }
  button.style.borderRadius = "6px";
  button.style.padding = "6px 14px";
  button.style.font = "inherit";
  button.style.fontWeight = "600";
  button.style.cursor = "pointer";
}

function setTitle(text) {
  const p = document.createElement("p");
  p.textContent = text;
  p.style.margin = "0 0 10px";
  p.style.fontWeight = "600";
  frame.body.append(p);
}

function inputField(placeholder) {
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.placeholder = placeholder;
  input.autocomplete = "off";
  Object.assign(input.style, {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    background: FIELD_BG,
    color: INK,
    border: `1px solid ${LINE}`,
    borderRadius: "6px",
    padding: "7px 9px",
    font: "inherit",
    marginBottom: "8px",
  });
  return input;
}

function choiceButtons(options, initial, onChange) {
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.gap = "8px";
  wrap.style.marginBottom = "8px";
  let selected = initial;
  const paint = (button) => {
    if (!button) return;
    if (button.dataset.value === selected) {
      button.style.background = ACCENT;
      button.style.color = "#10131a";
      button.style.border = "0";
    } else {
      button.style.background = FIELD_BG;
      button.style.color = INK;
      button.style.border = `1px solid ${LINE}`;
    }
  };
  const buttons = options.map(({ value, label }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.value = value;
    button.textContent = label;
    button.style.flex = "1";
    button.style.padding = "9px 6px";
    button.style.borderRadius = "6px";
    button.style.font = "inherit";
    button.style.fontWeight = "600";
    button.style.cursor = "pointer";
    button.addEventListener("click", () => {
      selected = value;
      buttons.forEach((b) => paint(b));
      onChange?.(selected);
    });
    paint(button);
    wrap.append(button);
    return button;
  });
  return { wrap, get value() { return selected; } };
}

/** Equation challenge: resolve(true) when solved, false on cancel. */
function runEquationChallenge(terms) {
  return new Promise((resolve) => {
    openDialog();
    setTitle(msg("challengeTitle"));
    let equation = generateEquation({ terms });
    const done = (result) => {
      resolve(result);
      destroyDialog();
    };

    const text = document.createElement("p");
    text.textContent = `${equation.text} = ?`;
    Object.assign(text.style, {
      fontSize: "17px",
      fontWeight: "600",
      fontVariantNumeric: "tabular-nums",
      margin: "4px 0 10px",
      letterSpacing: "0.02em",
    });

    const input = inputField(msg("answerPlaceholder"));
    const check = () => {
      const answer = Number(input.value.trim());
      if (Number.isFinite(answer) && answer === equation.value) {
        done(true);
      } else {
        equation = generateEquation({ terms });
        text.textContent = `${equation.text} = ?`;
        input.value = "";
        frame.hint.textContent = msg("challengeWrong");
        input.focus();
      }
    };

    frame.okButton.onclick = check;
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        check();
      }
    });

    frame.body.append(text, input);
    frame.onCancel = () => done(false);
    frame.dialog.showModal();
    input.focus();
  });
}

/** 15-puzzle challenge: resolve(true) when solved, false on cancel. */
function runPuzzleChallenge() {
  return new Promise((resolve) => {
    openDialog();
    setTitle(msg("challengeTitle"));

    let board = shuffledBoard(80);
    while (isSolved(board)) board = shuffledBoard(80);
    let movesLeft = 120;
    let done = false;
    const finishSolve = (result) => {
      resolve(result);
      destroyDialog();
    };

    const counter = document.createElement("p");
    counter.style.margin = "0 0 8px";
    counter.style.color = MUTED;
    counter.style.fontSize = "12px";

    const grid = document.createElement("div");
    Object.assign(grid.style, {
      display: "grid",
      gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
      gap: "5px",
      width: `${SIZE * 52}px`,
      marginBottom: "6px",
    });

    const update = () => {
      counter.textContent = `${msg("puzzleMoves")}: ${120 - movesLeft}`;
      grid.textContent = "";
      for (let i = 0; i < SIZE * SIZE; i++) {
        const cell = document.createElement("button");
        const value = board[i];
        cell.textContent = value === 0 ? "" : String(value);
        Object.assign(cell.style, {
          height: "50px",
          borderRadius: "6px",
          font: "600 15px system-ui, sans-serif",
          cursor: value === 0 ? "default" : "pointer",
          background: value === 0 ? "transparent" : FIELD_BG,
          color: value === 0 ? "transparent" : INK,
          border: `1px solid ${value === 0 ? "transparent" : LINE}`,
        });
        if (value !== 0 && !done) {
          cell.addEventListener("click", () => {
            if (!legalTiles(board).includes(value)) return;
            board = moveTile(board, value);
            movesLeft--;
            update();
            if (isSolved(board) && !done) {
              done = true;
              counter.textContent = msg("puzzleSolved");
              setTimeout(() => finishSolve(true), 350);
            }
          });
        }
        grid.append(cell);
      }
    };
    update();

    frame.body.append(grid, counter);
    frame.okButton.hidden = true;
    frame.onCancel = () => finishSolve(false);
    frame.dialog.showModal();
  });
}

async function solveChallenge(config) {
  if (config.kind === "puzzle") {
    return runPuzzleChallenge();
  }
  return runEquationChallenge(config.terms);
}

/** Enable flow: choose challenge, solve it once, save the config. */
export async function enableProtection() {
  openDialog();
  setTitle(msg("protectHeading"));

  const choice = choiceButtons(
    [
      { value: "equation", label: msg("kindEquation") },
      { value: "puzzle", label: msg("kindPuzzle") },
    ],
    "equation"
  );
  frame.body.append(choice.wrap);

  const config = await new Promise((resolve) => {
    frame.okButton.onclick = () => {
      frame.onCancel = null;
      resolve({ kind: choice.value });
      destroyDialog();
    };
    frame.onCancel = () => resolve(null);
    frame.dialog.showModal();
  });
  if (config === null) return false;

  const solved = await solveChallenge(config);
  if (!solved) return false;
  await update((state) => {
    state.settings.protection = config;
  });
  return true;
}

/** Disable flow: solve the configured challenge, then switch off. */
export async function disableProtection() {
  const state = await load();
  const config = state.settings.protection;
  if (!config) return true;
  const solved = await solveChallenge(config);
  if (!solved) return false;
  await update((s) => {
    s.settings.protection = null;
  });
  return true;
}

/**
 * Run a permissive action behind the challenge wall (protected mode).
 * Resolves true if the action ran; false when cancelled / not solved.
 */
export async function guarded(action) {
  const state = await load();
  const config = state.settings.protection;
  if (!config) {
    await action();
    return true;
  }
  const solved = await solveChallenge(config);
  if (!solved) return false;
  await action();
  return true;
}
