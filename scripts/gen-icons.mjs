import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const SIZES = [16, 32, 48, 128];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function inRoundedRect(x, y, size, radius) {
  if (x < 0 || y < 0 || x >= size || y >= size) return false;
  const r = radius;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r || (x >= r && x < size - r) || (y >= r && y < size - r);
}

function coverage(test, size) {
  const S = 4;
  let hits = 0;
  for (let sy = 0; sy < S; sy++) {
    for (let sx = 0; sx < S; sx++) {
      const x = (test.x * S + sx + 0.5) / S;
      const y = (test.y * S + sy + 0.5) / S;
      if (test.hit(x, y, size)) hits++;
    }
  }
  return hits / (S * S);
}

function draw(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const moonX = size * 0.44;
  const moonY = size * 0.54;
  const moonR = size * 0.30;
  const cutX = size * 0.60;
  const cutY = size * 0.42;
  const cutR = size * 0.26;
  const stars =
    size >= 48
      ? [
          { x: 0.76, y: 0.30, r: 0.030 },
          { x: 0.24, y: 0.24, r: 0.022 },
          { x: 0.30, y: 0.78, r: 0.018 },
        ]
      : [];

  const skyTop = [0x24, 0x3c, 0x66];
  const skyBottom = [0x0b, 0x11, 0x1f];
  const moon = [0xff, 0xd6, 0x6b];
  const moonEdge = [0xff, 0xe2, 0x94];
  const star = [0xcf, 0xe0, 0xff];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      if (!coverage({ x, y, hit: (px, py) => inRoundedRect(px, py, size, radius) }, size)) {
        continue;
      }
      const t = y / size;
      let r = lerp(skyTop[0], skyBottom[0], t);
      let g = lerp(skyTop[1], skyBottom[1], t);
      let b = lerp(skyTop[2], skyBottom[2], t);

      const inMain = (px, py) => (px - moonX) ** 2 + (py - moonY) ** 2 <= moonR ** 2;
      const inCut = (px, py) => (px - cutX) ** 2 + (py - cutY) ** 2 <= cutR ** 2;
      const moonCov = coverage(
        { x, y, hit: (px, py) => inMain(px, py) && !inCut(px, py) },
        size
      );
      const edgeCov = coverage(
        {
          x,
          y,
          hit: (px, py) => {
            const d2main = (px - moonX) ** 2 + (py - moonY) ** 2;
            const inner = (moonR - size * 0.02) ** 2;
            return d2main >= inner && !inCut(px, py);
          },
        },
        size
      );

      for (const starSpec of stars) {
        const sxp = starSpec.x * size;
        const syp = starSpec.y * size;
        const sr = starSpec.r * size;
        const starCov = coverage(
          { x, y, hit: (px, py) => (px - sxp) ** 2 + (py - syp) ** 2 <= sr ** 2 },
          size
        );
        if (starCov > 0) {
          r = lerp(r, star[0], starCov);
          g = lerp(g, star[1], starCov);
          b = lerp(b, star[2], starCov);
        }
      }

      if (moonCov > 0) {
        r = lerp(r, moonEdge[0], edgeCov * 0.9 + moonCov * 0.1);
        g = lerp(g, moonEdge[1], edgeCov * 0.9 + moonCov * 0.1);
        b = lerp(b, moonEdge[2], edgeCov * 0.9 + moonCov * 0.1);
        r = lerp(r, moon[0], moonCov);
        g = lerp(g, moon[1], moonCov);
        b = lerp(b, moon[2], moonCov);
      }

      rgba[idx] = Math.round(r);
      rgba[idx + 1] = Math.round(g);
      rgba[idx + 2] = Math.round(b);
      rgba[idx + 3] = 255;
    }
  }
  return rgba;
}

mkdirSync("icons", { recursive: true });
for (const size of SIZES) {
  const png = encodePNG(size, draw(size));
  writeFileSync(`icons/icon${size}.png`, png);
  console.log(`icons/icon${size}.png written (${png.length} bytes)`);
}
