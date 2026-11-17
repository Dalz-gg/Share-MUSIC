/* Stage 3 — 今週のお題: one weekly theme, one song per person.
 *   GET    /api/topic                 this week's theme + answers  -> { week, start, end, title, desc, answers }
 *   GET    /api/topic?week=2026-W47   a past week ("みんなの答え")
 *   POST   /api/topic                 answer / replace my answer (logged in)
 *                                     body { id: videoId, title, artist, d?, art?, moment: { t, line }, note }
 *   DELETE /api/topic                 take back my answer for this week (logged in)
 *   GET    /api/topics                past themes -> { items: [{ week, start, title, n, covers }] }
 *   GET    /api/topic-admin           (admin) this week + next week, for the admin page
 *   POST   /api/topic-admin           (admin) body { which: 'cur'|'next', title, desc }  (empty title = back to the automatic list)
 * Weeks are ISO weeks in Japan time (Monday start), id "YYYY-Www".
 * Storage (gallery store): "tp/<week>" one record per week, "tp-idx" small index for the archive. */
import { getStore } from '@netlify/blobs';
import { notify, isBanned, BANNED_MSG } from './social.mjs';
import { recordSpread } from './spread.mjs';

const db = () => getStore({ name: 'gallery', consistency: 'strong' });
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store' } });
const readJson = async (store, key, def) => (await store.get(key, { type: 'json' })) ?? def;
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, n);
const env = (k) => (globalThis.Netlify?.env?.get?.(k)) || globalThis.process?.env?.[k] || '';
const enc = new TextEncoder();
const VID_RE = /^[\w-]{11}$/;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;
const ART_RE = /^https:\/\/is\d+-ssl\.mzstatic\.com\/[\w./%-]+$/;
const MAX_ANSWERS = 1000;

/** built-in themes, used when the operator has not set one for the week */
export const THEMES = [
  ['雨の日に聴きたい曲', '窓の外が雨のとき、つい流したくなる1曲を。'],
  ['最近泣いた曲', '思わず涙が出た、あの1曲。どこで泣いたかも教えてください。'],
  ['朝いちばんに聴きたい曲', '目覚めてすぐ、1日のスイッチを入れてくれる曲。'],
  ['夜の散歩に合う曲', 'ひとりで夜道を歩くときのお供に。'],
  ['イントロで心をつかまれた曲', '最初の数秒で「これは好きだ」とわかった曲。'],
  ['歌詞にハッとさせられた曲', 'たった一行で景色が変わった、そんな歌詞を。'],
  ['夏の終わりに聴きたい曲', '少しさみしくて、少しまぶしい曲。'],
  ['冬になると聴きたくなる曲', '寒い季節になると、なぜか思い出す1曲。'],
  ['ドライブで流したい曲', '窓を開けて、ボリュームを上げたくなる曲。'],
  ['元気がほしいときの1曲', '落ち込んだ日に背中を押してくれた曲。'],
  ['眠れない夜に聴く曲', '静かな夜に、そっと寄りそってくれる曲。'],
  ['学生時代を思い出す曲', '聴くとあのころの教室や帰り道がよみがえる曲。'],
  ['はじめて買ったCDの曲', 'あなたの音楽のはじまりを教えてください。'],
  ['ライブで聴いてみたい曲', '生で聴いたら絶対に鳥肌が立つ曲。'],
  ['サビで泣ける曲', 'サビが来た瞬間に胸がいっぱいになる曲。'],
  ['ひとりの時間に聴きたい曲', '誰にも邪魔されない時間のための曲。'],
  ['友だちにすすめたくなる曲', 'つい「これ聴いて」と送りたくなる曲。'],
  ['季節の変わり目に聴く曲', '空気が変わったな、と感じたときの1曲。'],
  ['恋をしているときの曲', 'あの人のことを考えてしまう曲。'],
  ['失恋したときに聴いた曲', '泣きながら何度もリピートした曲。'],
  ['仕事・勉強がはかどる曲', '集中したいときのとっておき。'],
  ['お風呂で歌いたくなる曲', 'ついつい口ずさんでしまう曲。'],
  ['旅に出たくなる曲', '聴くと遠くへ行きたくなる曲。'],
  ['夕暮れに聴きたい曲', '空がオレンジ色に染まるころの1曲。'],
  ['声が好きな曲', 'とにかくこの歌声を聴いてほしい、という曲。'],
  ['ベースラインが最高な曲', '低音に注目して聴いてほしい曲。'],
  ['アニメ・映画で出会った曲', '作品と一緒に心に残っている曲。'],
  ['ゲームの思い出の曲', '聴くとあの場面がよみがえるゲームの曲。'],
  ['懐かしいのに新しい曲', '昔の曲なのに、いま聴いても新鮮な曲。'],
  ['最近いちばんリピートしている曲', 'ここ数日で何度も聴いている曲。'],
  ['知る人ぞ知る名曲', 'もっと多くの人に知ってほしい隠れた1曲。'],
  ['家族との思い出の曲', '家族と一緒に聴いた、大切な曲。'],
  ['春を感じる曲', '桜や新生活を思い出す曲。'],
  ['踊りたくなる曲', '体が勝手に動き出す曲。'],
  ['静かな曲で泣ける曲', '大きな盛り上がりはなくても沁みる曲。'],
  ['海が見たくなる曲', '潮風を感じる曲。'],
  ['都会の夜に似合う曲', 'ネオンと街の明かりが似合う曲。'],
  ['がんばった日のごほうびの曲', '1日の終わりに自分をねぎらう曲。'],
  ['タイトルが好きな曲', '曲名に惹かれて聴いて、好きになった曲。'],
  ['人生を変えた1曲', 'あなたにとって特別な、たった1曲を。'],
];

/* ---------- weeks (ISO, Japan time) ---------- */
const JST = 9 * 3600e3, DAY = 86400e3, WEEK = 7 * DAY;
/** the Monday 00:00 JST of the week containing `now`, as a UTC-midnight-based day number trick */
const mondayOf = (now) => { const d = new Date(now + JST); const dow = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dow * DAY; };
/** week id ("2026-W47") of the week starting at Monday `mon` (UTC-midnight number) */
function weekIdOf(mon) {
  const thu = new Date(mon + 3 * DAY), y = thu.getUTCFullYear();
  const jan4 = Date.UTC(y, 0, 4), w1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
  return `${y}-W${String(Math.round((mon - w1) / WEEK) + 1).padStart(2, '0')}`;
}
/** Monday (UTC-midnight number) of a week id, or null */
function mondayOfId(id) {
  const m = WEEK_RE.exec(id || ''); if (!m) return null;
  const y = +m[1], w = +m[2]; if (w < 1 || w > 53) return null;
  const jan4 = Date.UTC(y, 0, 4), w1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
  const mon = w1 + (w - 1) * WEEK;
  return weekIdOf(mon) === id ? mon : null;
}
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
export const weekInfo = (now = Date.now()) => { const mon = mondayOf(now); return { week: weekIdOf(mon), mon }; };
export { weekIdOf, mondayOfId };
/** built-in theme for the week starting at `mon` (rotates through the list by absolute week number) */
const autoTheme = (mon) => { const n = Math.floor((mon - Date.UTC(1970, 0, 5)) / WEEK); const [title, desc] = THEMES[((n % THEMES.length) + THEMES.length) % THEMES.length]; return { title, desc }; };

async function loadWeek(store, week, mon) {
  const rec = await readJson(store, 'tp/' + week, null);
  const auto = autoTheme(mon);
  return { week, title: rec?.title || auto.title, desc: rec?.title ? (rec.desc || '') : auto.desc, custom: !!rec?.title, answers: rec?.answers || [], announced: !!rec?.announced, rec };
}
const pub = (w, mon) => ({ week: w.week, start: ymd(mon), end: ymd(mon + 6 * DAY), title: w.title, desc: w.desc, custom: w.custom, answers: w.answers });
async function saveWeek(store, w) {
  const rec = { ...(w.rec || {}), week: w.week, answers: w.answers, ...(w.custom ? { title: w.title, desc: w.desc } : { title: '', desc: '' }), announced: w.announced, at: Date.now() };
  await store.setJSON('tp/' + w.week, rec);
  // archive index: title, how many answers, a few covers
  const idx = await readJson(store, 'tp-idx', {});
  if (w.answers.length) idx[w.week] = { title: w.title, n: w.answers.length, covers: w.answers.slice(0, 4).map((a) => a.art || a.thumb) };
  else delete idx[w.week];
  const keys = Object.keys(idx).sort().reverse().slice(0, 520);
  await store.setJSON('tp-idx', Object.fromEntries(keys.map((k) => [k, idx[k]])));
}

/** tell last week's answerers that a new theme has started (once per week) */
async function announce(store, w, mon) {
  w.announced = true;
  await saveWeek(store, w);
  const prev = await readJson(store, 'tp/' + weekIdOf(mon - WEEK), null);
  const to = new Set([...(prev?.answers || []), ...w.answers].map((a) => a.uid));
  for (const id of to) await notify(store, id, { t: 'topic', kind: 't', id: w.week, title: w.title, from: 'Share MUSIC', fromId: '', text: w.desc });
}

async function me(auth) {
  if (!/^Bearer\s+\S+/.test(auth || '')) return null;
  const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: auth } });
  if (!r.ok) return null;
  const c = (await r.json()).items?.[0];
  return c ? { id: c.id, name: c.snippet?.title || '', icon: c.snippet?.thumbnails?.default?.url || '' } : null;
}

/* admin token: the same HMAC token /api/admin/login hands out (community.mjs) */
async function hmac(msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode('admin:' + env('ADMIN_PASSWORD')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function isAdmin(req) {
  if (!env('ADMIN_PASSWORD')) return false;
  const m = /^Admin\s+(\d+)\.([\w-]+)$/.exec(req.headers.get('authorization') || '');
  if (!m || +m[1] < Date.now()) return false;
  return (await hmac(m[1])) === m[2];
}

async function topic(req, url) {
  const store = db(), now = Date.now(), cur = weekInfo(now);
  if (req.method === 'GET') {
    const q = url.searchParams.get('week');
    if (q && q !== cur.week) {
      const mon = mondayOfId(q);
      if (mon == null || mon > cur.mon) return json({ error: 'このお題は見つかりませんでした' }, 404);
      const w = await loadWeek(store, q, mon);
      return json({ ...pub(w, mon), past: true });
    }
    const w = await loadWeek(store, cur.week, cur.mon);
    if (!w.announced) await announce(store, w, cur.mon);
    return json(pub(w, cur.mon));
  }
  const who = await me(req.headers.get('authorization'));
  if (!who) return json({ error: 'ログインしてください' }, 401);
  const w = await loadWeek(store, cur.week, cur.mon);
  if (req.method === 'DELETE') {
    w.answers = w.answers.filter((a) => a.uid !== who.id);
    await saveWeek(store, w);
    return json(pub(w, cur.mon));
  }
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (await isBanned(store, who.id)) return json({ error: BANNED_MSG }, 403);
  const b = await req.json().catch(() => ({}));
  const id = String(b.id || b.videoId || '');
  if (!VID_RE.test(id)) return json({ error: '曲を選んでください' }, 400);
  const title = clip(b.title, 120); if (!title) return json({ error: '曲名がありません' }, 400);
  const t = Math.max(0, Math.min(3600, Math.round(+b.moment?.t || 0)));
  const line = clip(b.moment?.line, 120);
  const ans = {
    uid: who.id, name: clip(who.name, 60), ...(who.icon ? { avatar: clip(who.icon, 300) } : {}),
    id, title, artist: clip(b.artist, 80), d: Math.max(0, Math.min(36000, Math.round(+b.d || 0))),
    thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, ...(ART_RE.test(b.art || '') ? { art: b.art } : {}),
    moment: b.moment && (t || line) ? { t, line } : null, note: clip(b.note, 200), ts: now,
  };
  // the same song already recommended on Share MUSIC: link it, and count it as reaching this person
  const song = (await readJson(store, 'songs', [])).find((s) => s.videoId === id && !s.hidden);
  if (song) ans.sid = song.sid;
  const had = w.answers.some((a) => a.uid === who.id);
  w.answers = [ans, ...w.answers.filter((a) => a.uid !== who.id)].slice(0, MAX_ANSWERS);
  await saveWeek(store, w);
  const src = song && song.byId && song.byId !== who.id ? { id: song.byId, name: song.by } : { id: who.id, name: who.name };
  await recordSpread(store, { sid: song?.sid || id, from: src, to: { id: who.id, name: who.name }, kind: 'topic' });
  return json({ ...pub(w, cur.mon), replaced: had });
}

async function topics() {
  const store = db(), cur = weekInfo();
  const idx = await readJson(store, 'tp-idx', {});
  const items = Object.entries(idx).filter(([k]) => k !== cur.week && mondayOfId(k) != null && mondayOfId(k) < cur.mon)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([week, x]) => ({ week, start: ymd(mondayOfId(week)), title: x.title, n: x.n, covers: x.covers || [] }));
  return json({ items });
}

async function admin(req) {
  if (!(await isAdmin(req))) return json({ error: '運営ログインが必要です' }, 401);
  const store = db(), cur = weekInfo(), nextMon = cur.mon + WEEK, next = weekIdOf(nextMon);
  if (req.method === 'GET') {
    const a = await loadWeek(store, cur.week, cur.mon), n = await loadWeek(store, next, nextMon);
    const strip = (w, mon) => ({ week: w.week, start: ymd(mon), end: ymd(mon + 6 * DAY), title: w.title, desc: w.desc, custom: w.custom, n: w.answers.length });
    return json({ cur: strip(a, cur.mon), next: strip(n, nextMon) });
  }
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const b = await req.json().catch(() => ({}));
  const isNext = b.which === 'next';
  const mon = isNext ? nextMon : cur.mon, week = isNext ? next : cur.week;
  const w = await loadWeek(store, week, mon);
  const title = clip(b.title, 60), desc = clip(b.desc, 200);
  const before = w.title;
  if (title) Object.assign(w, { title, desc, custom: true });
  else Object.assign(w, autoTheme(mon), { custom: false });
  await saveWeek(store, w);
  const l = await readJson(store, 'adminlog', []);
  l.unshift({ at: Date.now(), target: 'お題', id: week, op: title ? `${isNext ? '来週' : '今週'}のお題を設定` : `${isNext ? '来週' : '今週'}のお題を自動に戻す`, what: w.title });
  await store.setJSON('adminlog', l.slice(0, 300));
  // this week's theme changed: let people know now (next week's is announced when that week starts)
  if (!isNext && w.title !== before) await announce(store, w, mon);
  return json({ ok: true, week, title: w.title, desc: w.desc, custom: w.custom });
}

export default async (req) => {
  const url = new URL(req.url), path = url.pathname;
  try {
    if (path === '/api/topic') return await topic(req, url);
    if (path === '/api/topics' && req.method === 'GET') return await topics();
    if (path === '/api/topic-admin') return await admin(req);
  } catch (e) {
    console.error(e);
    return json({ error: 'サーバーでエラーが起きました' }, 500);
  }
  return json({ error: 'not found' }, 404);
};
export const config = { path: ['/api/topic', '/api/topics', '/api/topic-admin'] };
