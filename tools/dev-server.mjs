// Local static server for testing the front end (SPA routes -> index.html). Usage: node tools/dev-server.mjs [port] [root]
// API calls (/api/...) are not served: mock them in tests (e.g. Playwright page.route).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const port = +(process.argv[2] || 8766), root = path.resolve(process.argv[3] || 'public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
http.createServer((q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (!path.extname(u) || u === '/') u = '/index.html';
  const f = path.join(root, u);
  if (!f.startsWith(root)) { r.writeHead(403); return r.end(); }
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end('not found'); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); });
}).listen(port, '127.0.0.1', () => console.log('dev server on http://127.0.0.1:' + port));
