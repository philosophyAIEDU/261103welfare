// PWA용 PNG 아이콘 생성 (외부 라이브러리 없이). 실행: node scripts/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from './config.mjs';

const BRAND = [0xc2, 0x41, 0x0c];
const WHITE = [255, 255, 255];
const YELLOW = [0xfd, 0xe0, 0x47];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const SS = 4; // 안티앨리어싱 샘플
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const c = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          for (let i = 0; i < 4; i++) acc[i] += c[i];
        }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let i = 0; i < 4; i++) raw[o + i] = Math.round(acc[i] / (SS * SS));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 하트: (x²+y²−1)³ − x²y³ ≤ 0
const inHeart = (u, v, cx, cy, s) => {
  const x = (u - cx) / s;
  const y = -(v - cy) / s;
  return (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0;
};
const inRoundRect = (u, v, r) => {
  const dx = Math.max(r - u, 0, u - (1 - r));
  const dy = Math.max(r - v, 0, v - (1 - r));
  return dx * dx + dy * dy <= r * r;
};

function draw(maskable) {
  const scale = maskable ? 0.72 : 1; // 마스커블은 안전 영역 안에
  return (u0, v0) => {
    if (!maskable && !inRoundRect(u0, v0, 0.22)) return [0, 0, 0, 0];
    const u = 0.5 + (u0 - 0.5) / scale;
    const v = 0.5 + (v0 - 0.5) / scale;
    const dot = Math.hypot(u - 0.73, v - 0.27);
    if (dot <= 0.11) return [...YELLOW, 255];
    if (dot <= 0.15) return [...BRAND, 255];
    if (inHeart(u, v, 0.5, 0.53, 0.3)) return [...WHITE, 255];
    return [...BRAND, 255];
  };
}

const dir = path.join(ROOT, 'docs', 'icons');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon-192.png'), png(192, draw(false)));
fs.writeFileSync(path.join(dir, 'icon-512.png'), png(512, draw(false)));
fs.writeFileSync(path.join(dir, 'icon-maskable-512.png'), png(512, draw(true)));
console.log('아이콘 생성 완료');
