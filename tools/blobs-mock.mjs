// In-memory stand-in for @netlify/blobs, for unit-testing server handlers in Node:
//   npx esbuild test.mjs --bundle --format=esm --platform=node --alias:@netlify/blobs=./tools/blobs-mock.mjs --outfile=/tmp/x.mjs && node /tmp/x.mjs
const DATA = globalThis.__DATA || (globalThis.__DATA = new Map());
const BIN = globalThis.__BIN || (globalThis.__BIN = new Map());
export function getStore(o) {
  const name = typeof o === 'string' ? o : o.name;
  if (name === 'covers') return {
    async set(k, v, opt) { BIN.set(k, { v, m: opt?.metadata || {} }); },
    async getWithMetadata(k) { const x = BIN.get(k); return x ? { data: x.v, metadata: x.m } : null; },
    async delete(k) { BIN.delete(k); }, async getMetadata(k) { const x = BIN.get(k); return x ? { metadata: x.m } : null; },
  };
  return {
    async get(k, o) { const v = DATA.get(k); return v === undefined ? null : (o?.type === 'json' ? JSON.parse(v) : v); },
    async setJSON(k, v) { DATA.set(k, JSON.stringify(v)); },
    async getMetadata() { return null; }, async delete(k) { DATA.delete(k); },
  };
}
