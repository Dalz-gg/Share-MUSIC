/* Link previews (LINE, X, Discord, iMessage ...) for every kind of shared page.
 * Returns the normal app HTML, with <title> and Open Graph / Twitter tags filled in on the server,
 * because link-preview crawlers don't run JavaScript.
 *   /p/<playlistId>  playlist        /s/<sid>   recommended song     /c/<pid>  community post
 *   /party/<rid>     listening party /u/<channelId>  profile          /c, /party  section pages */
import { getStore } from '@netlify/blobs';

const API_KEY = 'AIzaSyA4gaZyYp09zqvc8jbBmjqJRruWDhh80mM'; // same public, referrer-restricted key as config.js
const SITE = globalThis.__SITE || 'https://playlist-share.netlify.app';
const DEFAULT_IMG = SITE + '/og.png?v=4';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const one = (s, n = 110) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const setMeta = (html, attr, key, value) => {
  const re = new RegExp(`<meta ${attr}="${key}" content="[^"]*">`);
  const tag = `<meta ${attr}="${key}" content="${esc(value)}">`;
  return re.test(html) ? html.replace(re, tag) : html.replace('</head>', `  ${tag}\n</head>`);
};
/** put one page's title / description / image into the app HTML */
function apply(html, { title, desc, image, type = 'website', url, card = 'summary_large_image' }) {
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)} | Share MUSIC</title>`);
  const img = image || DEFAULT_IMG;
  for (const [a, k, v] of [
    ['name', 'description', desc], ['property', 'og:title', title], ['property', 'og:description', desc], ['property', 'og:image', img],
    ['property', 'og:url', url], ['property', 'og:type', type], ['property', 'og:site_name', 'Share MUSIC'],
    ['name', 'twitter:card', card], ['name', 'twitter:title', title], ['name', 'twitter:description', desc], ['name', 'twitter:image', img],
  ]) html = setMeta(html, a, k, v);
  return html;
}
const db = () => getStore({ name: 'gallery', consistency: 'strong' });
const readJson = async (store, key, def) => (await store.get(key, { type: 'json' })) ?? def;
const GENRE = { jpop: 'J-POP', rock: 'ロック', anime: 'アニソン・ボカロ', citypop: 'シティポップ', kpop: 'K-POP', western: '洋楽', hiphop: 'ヒップホップ・R&B', edm: 'EDM・ダンス', chill: 'アコースティック・チル', bgm: '作業用・BGM', other: 'その他' };
const people = (list) => (list.length > 2 ? `${list.slice(0, 2).join('さん、')}さんほか${list.length - 2}人` : `${list.join('さん、')}さん`);

/* ---------- each kind of page ---------- */
async function playlist(id) {
  const j = await (await fetch(`https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&id=${encodeURIComponent(id)}&key=${API_KEY}`, { headers: { Referer: SITE + '/' } })).json();
  const pl = j.items?.[0]; if (!pl) return null;
  const sn = pl.snippet, th = sn.thumbnails || {};
  let image = Object.values(th).map((x) => x.url).find((u) => u && !u.includes('/vi/')) || th.maxres?.url || th.standard?.url || th.high?.url || th.medium?.url;
  try { const meta = await getStore('covers').getMetadata(id); if (meta?.metadata?.v) image = `${SITE}/api/cover?id=${encodeURIComponent(id)}&v=${meta.metadata.v}`; } catch { /* keep YouTube's */ }
  const store = db();
  const g = (await readJson(store, 'list', [])).find((x) => x.id === id && !x.hidden);
  const likes = g ? (await readJson(store, 'likes', {}))['p:' + id] || 0 : 0;
  const count = pl.contentDetails?.itemCount;
  const facts = [`${sn.channelTitle}さんのプレイリスト`, count ? `${count}曲` : '', g?.genres?.length ? g.genres.map((x) => GENRE[x]).filter(Boolean).join('・') : '', likes ? `♥ ${likes}` : ''].filter(Boolean).join(' ・ ');
  const intro = one(g?.desc || sn.description, 80);
  return { title: sn.title, desc: `${facts}${intro ? ` ／ ${intro}` : ''} ／ 曲目を見て、その場で試聴できます。`, image, type: 'music.playlist' };
}

async function song(sid) {
  const so = (await readJson(db(), 'songs', [])).find((x) => x.sid === sid && !x.hidden); if (!so) return null;
  const who = [so.by, ...(so.also || []).map((x) => x.name)].filter(Boolean);
  const note = one(so.desc, 80);
  return { title: `${so.title} — ${so.artist}`, desc: `${people(who)}のおすすめ曲${note ? `「${note}」` : ''} ／ タップしてその場で聴けます。`, image: so.art || `https://i.ytimg.com/vi/${so.videoId}/hqdefault.jpg`, type: 'music.song' };
}

async function post(pid) {
  const p = await readJson(db(), 'po/' + pid, null);
  if (!p || p.deleted || p.hidden) return { title: 'つぶやき', desc: 'この投稿は削除されたか、見られなくなっています。', image: '' };
  const songs = p.songs || [];
  const what = p.parent ? '返信' : p.battle ? '曲バトル' : songs.length > 1 ? `ミックステープ（${songs.length}曲）` : 'つぶやき';
  let desc = one(p.text, 100);
  if (p.battle && songs.length === 2) desc = `${desc ? desc + ' ／ ' : ''}曲バトル：${songs[0].title} vs ${songs[1].title} — どっちが好き？投票しよう`;
  else if (songs.length) desc = `${desc ? desc + ' ／ ' : ''}♪ ${songs.slice(0, 3).map((s) => `${s.title}（${s.artist}）`).join('、')}${songs.length > 3 ? ` ほか${songs.length - 3}曲` : ''}`;
  if (!desc) desc = '写真つきのつぶやき';
  const image = p.img ? `${SITE}/api/pimg?k=${p.img}` : songs[0] ? songs[0].art || songs[0].thumb : '';
  return { title: `${p.by}さんの${what}`, desc, image, type: 'article' };
}

async function party(rid) {
  const store = db(), r = await readJson(store, 'pty/' + rid, null); if (!r) return null;
  const cur = r.queue?.[r.idx];
  const live = !r.closed && Date.now() - r.updated < 10 * 60e3;
  const pres = await readJson(store, 'ptp/' + rid, {});
  const n = Object.values(pres).filter((x) => Date.now() - x.seen < 45e3).length;
  return {
    title: live ? `LIVE：${r.title}` : `${r.title}（終了しました）`,
    desc: live ? `${r.host}さんのリスニングパーティー${n ? ` ・ ${n}人が参加中` : ''}${cur ? ` ・ いま流れている曲：${cur.title} / ${cur.artist}` : ''} ／ 同じ曲をみんなで同時に聴きながらチャットできます。`
      : `${r.host}さんが開いたリスニングパーティーは終了しました。ほかのパーティーを探してみよう。`,
    image: cur ? cur.art || cur.thumb : '',
  };
}

async function profile(id) {
  const store = db();
  const [prof, list, songs, tl] = await Promise.all([readJson(store, 'prof/' + id, {}), readJson(store, 'list', []), readJson(store, 'songs', []), readJson(store, 'tl', [])]);
  let name = prof.name || list.find((x) => x.ownerId === id)?.owner || songs.find((x) => x.byId === id)?.by || '';
  let image = '';
  try {
    const c = (await (await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${encodeURIComponent(id)}&key=${API_KEY}`, { headers: { Referer: SITE + '/' } })).json()).items?.[0];
    if (c) { name = name || c.snippet?.title; const th = c.snippet?.thumbnails || {}; image = th.high?.url || th.medium?.url || ''; }
  } catch { /* name only */ }
  if (!name) return null;
  const pl = list.filter((x) => x.ownerId === id && !x.hidden).length, so = songs.filter((x) => !x.hidden && (x.byId === id || (x.also || []).some((a) => a.id === id))).length, po = tl.filter((x) => x.byId === id).length;
  const facts = [pl && `プレイリスト ${pl}`, so && `おすすめ曲 ${so}`, po && `つぶやき ${po}`].filter(Boolean).join(' ・ ');
  return { title: `${name}さん`, desc: `${one(prof.bio, 80) || `${name}さんの音楽`}${facts ? ` ／ ${facts}` : ''}`, image, type: 'profile', card: image ? 'summary' : 'summary_large_image' };
}

const SECTIONS = {
  '/c': { title: 'コミュニティ', desc: 'みんなの音楽つぶやき。曲を詰め込んだミックステープ、写真、曲バトル、リアクションで盛り上がろう。' },
  '/party': { title: 'リスニングパーティー', desc: '同じ曲を、同じ瞬間に。みんなで聴きながらチャットとリアクションで楽しもう。' },
  '/search': { title: 'さがす', desc: 'みんなが共有したプレイリストとおすすめ曲を、ジャンルや人気順でさがそう。' },
};

export default async (req) => {
  const url = new URL(req.url), path = url.pathname;
  const indexReq = new Request(new URL('/index.html', url.origin));
  let html = await (await (globalThis.__ASSETS ? globalThis.__ASSETS.fetch(indexReq) : fetch(indexReq))).text();
  let meta = null, ttl = 600;
  try {
    let m;
    if ((m = /^\/p\/([\w-]{10,})/.exec(path))) meta = await playlist(m[1]);
    else if ((m = /^\/s\/([\w-]{6,40})/.exec(path))) meta = await song(m[1]);
    else if ((m = /^\/c\/([a-f0-9]{14})$/.exec(path))) meta = await post(m[1]);
    else if ((m = /^\/party\/([a-f0-9]{10})$/.exec(path))) { meta = await party(m[1]); ttl = 30; }
    else if ((m = /^\/u\/(UC[\w-]{20,})$/.exec(path))) meta = await profile(m[1]);
    else if (SECTIONS[path]) meta = SECTIONS[path];
  } catch (e) { console.error(e); }
  if (meta) html = apply(html, { ...meta, url: SITE + path });
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=0, must-revalidate',
      'netlify-cdn-cache-control': `public, durable, s-maxage=${ttl}, stale-while-revalidate=${ttl * 10}`,
    },
  });
};

export const config = { path: ['/p/*', '/s/*', '/c', '/c/*', '/party', '/party/*', '/u/*', '/search'] };
