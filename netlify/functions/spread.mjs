/* Stage 4 — 布教の木: who passed a song to whom.
 * recordSpread() is called by other features when a song reaches someone through another person:
 *   - "ありがとう" (B thanks A for song S)            -> edge A -> B   kind 'thx'
 *   - "私もおすすめ" (B also recommends A's song)      -> edge A -> B   kind 'also'
 *   - answering 今週のお題 with a song someone posted -> edge A -> B   kind 'topic'
 * Storage (gallery store):
 *   spr/<sid>    [{from, fromName, to, toName, kind, at}]  edges of one song (deduped on from/to/kind)
 *   sprr/<sid>   {id, name}                                 the song's root (its original recommender)
 *   spru/<id>    {sids:[...], ms}                           songs this person rooted or relayed + last reach milestone notified
 * API:
 *   GET /api/spread?sid=<sid>   -> { root, nodes:[{id,name}], edges:[{from,to,kind,ts}] }
 *   GET /api/spread?user=<id>   -> { id, people, depth, songs }  (how far this person's recommendations reached) */
import { getStore } from '@netlify/blobs';
import { notify } from './social.mjs';

const db = () => getStore({ name: 'gallery', consistency: 'strong' });
const readJson = async (store, key, def) => (await store.get(key, { type: 'json' })) ?? def;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store' } });
const CH_RE = /^UC[\w-]{20,}$/;
const SID_RE = /^[\w-]{1,64}$/;
const KINDS = ['thx', 'also', 'topic'];
/** reach sizes (people) that are worth a notification */
export const MILESTONES = [3, 5, 10, 20, 30, 50, 100, 200, 500, 1000];
const MAX_SIDS = 1000;

/** add `sid` to the songs a person rooted or relayed */
async function indexUser(store, id, sid) {
  const key = 'spru/' + id, ix = await readJson(store, key, { sids: [], ms: 0 });
  if (ix.sids.includes(sid)) return ix;
  ix.sids = [...ix.sids, sid].slice(-MAX_SIDS);
  await store.setJSON(key, ix);
  return ix;
}

/** the original recommender of a song: stored root, else the song's poster, else the first sender */
async function rootOf(store, sid, from) {
  const r = await readJson(store, 'sprr/' + sid, null);
  if (r?.id) return r;
  const so = (await readJson(store, 'songs', [])).find((x) => x.sid === sid);
  const root = so?.byId && CH_RE.test(so.byId) ? { id: so.byId, name: String(so.by || '').slice(0, 60) } : { id: from.id, name: String(from.name || '').slice(0, 60) };
  await store.setJSON('sprr/' + sid, root);
  return root;
}

/** BFS from `id` along the edges of one song: people reached (excluding self) with their depth */
function walk(edges, id) {
  const out = new Map();
  for (const e of edges) { if (e.from === e.to) continue; if (!out.has(e.from)) out.set(e.from, []); out.get(e.from).push(e.to); }
  const depth = new Map([[id, 0]]), q = [id];
  while (q.length) {
    const a = q.shift();
    for (const b of out.get(a) || []) if (!depth.has(b)) { depth.set(b, depth.get(a) + 1); q.push(b); }
  }
  depth.delete(id);
  return depth;
}

/** how far one person's recommendations reached: distinct people and the deepest relay */
export async function reachOf(store, id) {
  const ix = await readJson(store, 'spru/' + id, { sids: [], ms: 0 });
  const people = new Set(); let depth = 0, songs = 0;
  for (const sid of ix.sids) {
    const d = walk(await readSpread(store, sid), id);
    if (d.size) songs++;
    for (const [p, n] of d) { people.add(p); if (n > depth) depth = n; }
  }
  return { id, people: people.size, depth, songs, ms: ix.ms || 0 };
}

/** remember that `sid` reached `to` through `from` (no duplicates, no self-edges) */
export async function recordSpread(store, { sid, from, to, kind }) {
  try {
    if (!sid || !SID_RE.test(String(sid)) || !from?.id || !to?.id || from.id === to.id || !CH_RE.test(from.id) || !CH_RE.test(to.id)) return;
    kind = String(kind || '').slice(0, 10);
    const key = 'spr/' + sid, list = await readJson(store, key, []);
    if (list.some((e) => e.from === from.id && e.to === to.id && e.kind === kind)) return;
    const root = await rootOf(store, sid, from);
    list.push({ from: from.id, fromName: String(from.name || '').slice(0, 60), to: to.id, toName: String(to.name || '').slice(0, 60), kind, at: Date.now() });
    await store.setJSON(key, list.slice(-2000));
    await indexUser(store, from.id, sid);
    if (root.id !== from.id) await indexUser(store, root.id, sid);
    await milestones(store, list, from.id, to);
  } catch (e) { console.error('recordSpread', e); }
}

/** everyone upstream of `fromId` (incl. itself) may have reached one more person: tell them at milestones */
async function milestones(store, edges, fromId, to) {
  const back = new Map();
  for (const e of edges) { if (e.from === e.to) continue; if (!back.has(e.to)) back.set(e.to, []); back.get(e.to).push(e.from); }
  const seen = new Set([fromId]), q = [fromId];
  while (q.length && seen.size < 20) { for (const p of back.get(q.shift()) || []) if (!seen.has(p) && seen.size < 20) { seen.add(p); q.push(p); } }
  seen.delete(to.id);
  for (const id of seen) {
    const r = await reachOf(store, id);
    const hit = MILESTONES.filter((m) => m <= r.people && m > r.ms).pop();
    if (!hit) continue;
    const ix = await readJson(store, 'spru/' + id, { sids: [], ms: 0 });
    await store.setJSON('spru/' + id, { ...ix, ms: hit });
    await notify(store, id, { t: 'spread', kind: 'u', id, title: '', from: to.name, fromId: to.id, people: r.people, depth: r.depth });
  }
}

export const readSpread = (store, sid) => readJson(store, 'spr/' + sid, []);

/** one song's tree for the song page */
export async function treeOf(store, sid) {
  const list = await readSpread(store, sid);
  const root = list.length ? await readJson(store, 'sprr/' + sid, null) : null;
  const nodes = new Map(), name = (id, n) => { if (!nodes.has(id) || (!nodes.get(id).name && n)) nodes.set(id, { id, name: n || '' }); };
  if (root?.id) name(root.id, root.name);
  const edges = [];
  for (const e of list) {
    if (e.from === e.to) continue;
    name(e.from, e.fromName); name(e.to, e.toName);
    edges.push({ from: e.from, to: e.to, kind: KINDS.includes(e.kind) ? e.kind : 'thx', ts: e.at || 0 });
  }
  return { root: root?.id ? { id: root.id, name: nodes.get(root.id)?.name || root.name || '' } : null, nodes: [...nodes.values()], edges };
}

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  const url = new URL(req.url), store = db();
  const sid = url.searchParams.get('sid'), user = url.searchParams.get('user');
  if (sid) {
    if (!SID_RE.test(sid)) return json({ error: 'bad sid' }, 400);
    return json(await treeOf(store, sid));
  }
  if (user) {
    if (!CH_RE.test(user)) return json({ error: 'bad user' }, 400);
    const { ms, ...r } = await reachOf(store, user);
    return json(r);
  }
  return json({ error: 'sid か user を指定してください' }, 400);
};
export const config = { path: ['/api/spread'] };
