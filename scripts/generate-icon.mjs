import { createWriteStream } from "node:fs";
import { mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, "..", "assets", "icon.png");
mkdirSync(dirname(out), { recursive: true });

const size = 256;
const raw = Buffer.alloc((size * 3 + 1) * size);
for (let y = 0; y < size; y += 1) {
  const row = y * (size * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < size; x += 1) {
    const i = row + 1 + x * 3;
    raw[i] = 124;
    raw[i + 1] = 92;
    raw[i + 2] = 255;
  }
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcSource = Buffer.concat([typeBuf, data]);
  let crc = 0xffffffff;
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  for (const byte of crcSource) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0))
]);

const stream = createWriteStream(out);
stream.end(png);
console.log("Wrote", out);
