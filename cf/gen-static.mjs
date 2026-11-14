// Embed every file of dist/ (except _worker.js) into a JS module, so the worker can serve the site itself.
import fs from 'fs'; import path from 'path';
const root = process.argv[2], out = process.argv[3];
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.jpg': 'image/jpeg' };
const files = {};
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f), rel = '/' + path.relative(root, p).split(path.sep).join('/');
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    if (rel === '/_worker.js' || f.startsWith('.')) continue;
    const ext = path.extname(f).toLowerCase(), t = types[ext] || 'application/octet-stream';
    const bin = !/^text|javascript|json|svg|manifest/.test(t);
    files[rel] = { t, bin, b: bin ? fs.readFileSync(p).toString('base64') : fs.readFileSync(p, 'utf8') };
  }
})(root);
fs.writeFileSync(out, 'export default ' + JSON.stringify(files) + ';\n');
console.log('embedded', Object.keys(files).length, 'files');
