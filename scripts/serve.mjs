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
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(DOCS, url.endsWith('/') ? url + 'index.html' : url);
    if (!file.startsWith(DOCS)) return res.writeHead(403).end();
    fs.readFile(file, (err, buf) => {
      if (err) return res.writeHead(404).end('not found');
      res.writeHead(200, { 'content-type': (TYPES[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
      res.end(buf);
    });
  })
  .listen(port, () => console.log(`http://localhost:${port}`));
