// 로컬 미리보기 서버: node scripts/serve.mjs → http://localhost:8080
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';

const DOCS = path.join(ROOT, 'docs');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const port = Number(process.env.PORT || 8080);

http
  .createServer((req, res) => {
    let url;
    try {
      url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return res.writeHead(400).end();
    }
    const file = path.join(DOCS, url.endsWith('/') ? url + 'index.html' : url);
    // docs 폴더 밖(예: /../docs-other, /../scripts) 접근 차단
    if (file !== DOCS && !file.startsWith(DOCS + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (err, buf) => {
      if (err) return res.writeHead(404).end('not found');
      res.writeHead(200, {
        'content-type': (TYPES[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-cache',
      });
      res.end(buf);
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}`));
