/* Stage 4 — 布教の木: who passed a song to whom.
 * recordSpread() is called by other features when a song reaches someone through another person:
 *   - "ありがとう" (B thanks A for song S)            -> edge A -> B   kind 'thx'
 *   - "私もおすすめ" (B also recommends A's song)      -> edge A -> B   kind 'also'
 *   - answering 今週のお題 with a song someone posted -> edge A -> B   kind 'topic'
 * Edges are stored per song in "spr/<sid>" (gallery store).
 *   GET /api/spread?sid=<sid>     -> tree of one song        (to be built in stage 4)
 *   GET /api/spread?user=<id>     -> reach of one person      (to be built in stage 4) */
import { getStore } from '@netlify/blobs';

const db = () => getStore({ name: 'gallery', consistency: 'strong' });
const readJson = async (store, key, def) => (await store.get(key, { type: 'json' })) ?? def;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store' } });
const CH_RE = /^UC[\w-]{20,}$/;

/** remember that `sid` reached `to` through `from` (no duplicates, no self-edges) */
export async function recordSpread(store, { sid, from, to, kind }) {
  try {
    if (!sid || !from?.id || !to?.id || from.id === to.id || !CH_RE.test(from.id) || !CH_RE.test(to.id)) return;
    const key = 'spr/' + sid, list = await readJson(store, key, []);
    if (list.some((e) => e.from === from.id && e.to === to.id)) return;
    list.push({ from: from.id, fromName: String(from.name || '').slice(0, 60), to: to.id, toName: String(to.name || '').slice(0, 60), kind: String(kind || '').slice(0, 10), at: Date.now() });
    await store.setJSON(key, list.slice(-2000));
  } catch (e) { console.error('recordSpread', e); }
}
export const readSpread = (store, sid) => readJson(store, 'spr/' + sid, []);

export default async () => json({ error: 'not implemented yet' }, 501);
export const config = { path: ['/api/spread'] };
