export const SIZE = 4;
export const TILE_COUNT = SIZE * SIZE - 1;

export function solvedBoard() {
  const board = [];
  for (let i = 1; i <= TILE_COUNT; i++) board.push(i);
  board.push(0);
  return board;
}

export function isSolved(board) {
  return board.every((cell, i) => cell === (i === board.length - 1 ? 0 : i + 1));
}

function blankIndex(board) {
  return board.indexOf(0);
}

export function legalTiles(board) {
  const blank = blankIndex(board);
  const row = Math.floor(blank / SIZE);
  const col = blank % SIZE;
  const tiles = [];
  if (row > 0) tiles.push(board[blank - SIZE]);
  if (row < SIZE - 1) tiles.push(board[blank + SIZE]);
  if (col > 0) tiles.push(board[blank - 1]);
  if (col < SIZE - 1) tiles.push(board[blank + 1]);
  return tiles;
}

export function moveTile(board, tile) {
  const blank = blankIndex(board);
  const target = board.indexOf(tile);
  if (target < 0) return null;
  const br = Math.floor(blank / SIZE);
  const bc = blank % SIZE;
  const tr = Math.floor(target / SIZE);
  const tc = target % SIZE;
  if (Math.abs(br - tr) + Math.abs(bc - tc) !== 1) return null;
  const next = board.slice();
  next[blank] = tile;
  next[target] = 0;
  return next;
}

/** Pick a legal tile to slide, never the one that would immediately undo the
 *  previous move (`previous` is that tile). rng injectable for tests. */
export function randomMove(board, previous, rng = Math.random) {
  const options = legalTiles(board).filter((t) => t !== previous);
  return options[Math.floor(rng() * options.length)];
}

/** Scramble by random legal moves from the solved board (always solvable).
 *  rng is injectable for deterministic tests. */
export function shuffledBoard(moves = 80, rng = Math.random) {
  let board = solvedBoard();
  let previous = -1;
  for (let i = 0; i < moves; i++) {
    const tile = randomMove(board, previous, rng);
    // The tile just moved sits where the blank was, so it is exactly the one
    // that would undo this move; excluding it keeps the walk well mixed.
    // (This used to read `board[blankIndex(board)]`, which is always 0, so
    // the filter was dead and ~1/3 of the moves were immediate undos.)
    previous = tile;
    board = moveTile(board, tile);
  }
  return board;
}
