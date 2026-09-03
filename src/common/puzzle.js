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

/** Scramble by random legal moves from the solved board (always solvable).
 *  rng is injectable for deterministic tests. */
export function shuffledBoard(moves = 80, rng = Math.random) {
  let board = solvedBoard();
  let previous = -1;
  for (let i = 0; i < moves; i++) {
    const options = legalTiles(board).filter((t) => t !== previous);
    const tile = options[Math.floor(rng() * options.length)];
    previous = board[blankIndex(board)];
    board = moveTile(board, tile);
  }
  return board;
}
