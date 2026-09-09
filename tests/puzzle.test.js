import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SIZE,
  solvedBoard,
  isSolved,
  legalTiles,
  moveTile,
  randomMove,
  shuffledBoard,
} from "../src/common/puzzle.js";
import { seededRng } from "./helpers/rng.js";

test("solvedBoard is solved and full", () => {
  const board = solvedBoard();
  assert.equal(board.length, SIZE * SIZE);
  assert.equal(isSolved(board), true);
  assert.deepEqual([...board].sort((a, b) => a - b), [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  ]);
});

test("legalTiles on the solved board: blank sits in the corner", () => {
  const board = solvedBoard();
  assert.deepEqual(legalTiles(board), [12, 15]);
});

test("moveTile rejects non-adjacent tiles", () => {
  const board = solvedBoard();
  assert.equal(moveTile(board, 1), null);
  assert.equal(moveTile(board, 99), null);
});

test("moveTile swaps with the blank and back", () => {
  const board = solvedBoard();
  const moved = moveTile(board, 15);
  assert.equal(moved[14], 0);
  assert.equal(moved[15], 15);
  assert.equal(isSolved(moved), false);
  assert.deepEqual(moveTile(moved, 15), board);
});

test("shuffledBoard keeps the tile multiset and is never solved", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const board = shuffledBoard(80, seededRng(seed));
    assert.equal(board.length, 16);
    assert.deepEqual(
      [...board].sort((a, b) => a - b),
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    );
    assert.equal(isSolved(board), false, `seed ${seed} produced a solved board`);
  }
});

test("shuffledBoard is deterministic for a fixed rng", () => {
  const a = shuffledBoard(80, seededRng(42));
  const b = shuffledBoard(80, seededRng(42));
  assert.deepEqual(a, b);
});

test("randomMove never picks the tile that would undo the last move", () => {
  const board = solvedBoard(); // blank at 15, legal tiles are 12 and 15
  for (let seed = 1; seed <= 50; seed++) {
    const rng = seededRng(seed);
    for (const previous of legalTiles(board)) {
      for (let i = 0; i < 10; i++) {
        assert.notEqual(randomMove(board, previous, rng), previous);
      }
    }
  }
});

test("shuffledBoard stays inside the solvable parity class", () => {
  const inversions = (board) => {
    const tiles = board.filter((v) => v !== 0);
    let count = 0;
    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) if (tiles[i] > tiles[j]) count++;
    }
    return count;
  };
  for (let seed = 1; seed <= 30; seed++) {
    const board = shuffledBoard(80, seededRng(seed));
    const rowFromBottom = SIZE - Math.floor(board.indexOf(0) / SIZE);
    assert.equal(
      (inversions(board) + rowFromBottom) % 2,
      1,
      `seed ${seed} left the solvable class`
    );
  }
});
