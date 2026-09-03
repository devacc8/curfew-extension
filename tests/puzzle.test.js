import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SIZE,
  solvedBoard,
  isSolved,
  legalTiles,
  moveTile,
  shuffledBoard,
} from "../src/common/puzzle.js";

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
    const board = shuffledBoard(80, mulberry32(seed));
    assert.equal(board.length, 16);
    assert.deepEqual(
      [...board].sort((a, b) => a - b),
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    );
    assert.equal(isSolved(board), false, `seed ${seed} produced a solved board`);
  }
});

test("shuffledBoard is deterministic for a fixed rng", () => {
  const a = shuffledBoard(80, mulberry32(42));
  const b = shuffledBoard(80, mulberry32(42));
  assert.deepEqual(a, b);
});
