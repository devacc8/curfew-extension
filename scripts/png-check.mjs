/** Store-bound images must be JPEG or 24-bit PNG with no alpha channel.
 *  Chrome writes an alpha channel only when the shot actually has one, which
 *  makes the store's rule easy to break by accident: add one transparent
 *  corner to a tile and the upload is rejected with a vague message. Every
 *  store image is therefore measured after it is written. */
import { readFileSync } from "node:fs";

const COLOR_TYPES = {
  0: "grayscale",
  2: "RGB",
  3: "palette",
  4: "grayscale+alpha",
  6: "RGBA",
};

export function pngInfo(path) {
  const head = readFileSync(path).subarray(0, 26);
  if (head.subarray(1, 4).toString("latin1") !== "PNG") {
    throw new Error(`${path}: not a PNG`);
  }
  const width = head.readUInt32BE(16);
  const height = head.readUInt32BE(20);
  const depth = head[24];
  const colorType = head[25];
  return {
    width,
    height,
    depth,
    colorType,
    hasAlpha: colorType === 4 || colorType === 6,
  };
}

/** Throws unless the file is a 24-bit RGB PNG of exactly the given size. */
export function assertStorePng(path, width, height) {
  const info = pngInfo(path);
  if (info.width !== width || info.height !== height) {
    throw new Error(
      `${path}: the store wants ${width}x${height}, this file is ${info.width}x${info.height}`
    );
  }
  if (info.depth !== 8 || info.colorType !== 2) {
    const kind = COLOR_TYPES[info.colorType] ?? `colorType ${info.colorType}`;
    throw new Error(
      `${path}: the store wants a 24-bit PNG with no alpha, this file is ${kind} at depth ${info.depth}`
    );
  }
  return info;
}
