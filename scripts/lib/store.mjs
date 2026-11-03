import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data, pretty = true) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, pretty ? 1 : 0) + '\n', 'utf8');
}

export const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // KST 날짜

export const hashText = (...parts) =>
  crypto.createHash('sha1').update(parts.join('␞')).digest('hex').slice(0, 12);
