/* Drop-in replacement for the subset of `@netlify/blobs` the functions use, backed by Cloudflare:
 *   - JSON stores (gallery, sessions, ...) -> D1 table `kv`
 *   - binary store "covers"                -> Workers KV namespace (COVERS)
 * globalThis.__env is set per request by the worker (cf/worker.mjs). */
const env = () => globalThis.__env;

function d1Store(name) {
  const db = () => env().DB;
  return {
    async get(key, opt = {}) {
      const row = await db().prepare('SELECT v FROM kv WHERE store = ?1 AND k = ?2').bind(name, key).first();
      if (!row) return null;
      return opt.type === 'json' ? JSON.parse(row.v) : row.v;
    },
    async setJSON(key, value) {
      await db().prepare('INSERT INTO kv (store, k, v, updated) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(store, k) DO UPDATE SET v = excluded.v, updated = excluded.updated')
        .bind(name, key, JSON.stringify(value), Date.now()).run();
    },
    async delete(key) { await db().prepare('DELETE FROM kv WHERE store = ?1 AND k = ?2').bind(name, key).run(); },
    async getMetadata() { return null; },
  };
}

function kvStore() {
  const kv = () => env().COVERS;
  return {
    async getMetadata(key) { const r = await kv().getWithMetadata(key, { type: 'stream' }); if (!r?.value) return null; r.value.cancel?.(); return { metadata: r.metadata || {} }; },
    async getWithMetadata(key, opt = {}) { const r = await kv().getWithMetadata(key, { type: opt.type === 'arrayBuffer' ? 'arrayBuffer' : 'text' }); return r?.value == null ? null : { data: r.value, metadata: r.metadata || {} }; },
    async set(key, data, opt = {}) { await kv().put(key, data, { metadata: opt.metadata || {} }); },
    async delete(key) { await kv().delete(key); },
    async get(key, opt = {}) { return kv().get(key, { type: opt.type === 'json' ? 'json' : opt.type === 'arrayBuffer' ? 'arrayBuffer' : 'text' }); },
    async setJSON(key, v) { await kv().put(key, JSON.stringify(v)); },
  };
}

export function getStore(o) {
  const name = typeof o === 'string' ? o : o.name;
  return name === 'covers' ? kvStore() : d1Store(name);
}
