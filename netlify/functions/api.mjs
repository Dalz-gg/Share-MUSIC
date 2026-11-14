/* Small server helpers, cached on Netlify's CDN for 30 days so YouTube quota is spent only once per song.
 *   GET /api/mv?v=<videoId>&t=<title>&a=<artist>   -> official music video { id, title, channel } or {}
 *   GET /api/ja?t=<title>&a=<artist>&d=<seconds>   -> official Japanese names from Apple's catalog { name, artist } or {} */
const API_KEY = 'AIzaSyA4gaZyYp09zqvc8jbBmjqJRruWDhh80mM';
const SITE = globalThis.__SITE || 'https://playlist-share.netlify.app';

const reply = (obj, cache = true) => new Response(JSON.stringify(obj), {
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': cache ? 'public, max-age=86400' : 'no-store',
    'netlify-cdn-cache-control': cache ? 'public, durable, s-maxage=2592000' : 'no-store',
  },
});
const nrm = (s) => (s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const decode = (s) => (s || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Official music video only: the title must contain the song name, the uploader must be the artist's own
 *  channel (or its VEVO channel), no covers / live / lyric videos, and the length must fit the song. */
async function findMv(q) {
  const v = q.get('v') || '', t = q.get('t') || '', a = q.get('a') || '', d = +q.get('d') || 0;
  if (!/^[\w-]{11}$/.test(v) || !t || !a) return reply({ error: 'bad request' }, false);
  const yt = (path, params) => fetch(`https://www.googleapis.com/youtube/v3/${path}?` + new URLSearchParams({ ...params, key: API_KEY }), { headers: { Referer: SITE + '/' } });
  const r = await yt('search', { part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '10', q: `${a} ${t} MV` });
  if (!r.ok) return reply({ error: r.status }, false);
  const items = (await r.json()).items || [];
  const nt = nrm(t), na = nrm(a);
  if (nt.length < 1 || na.length < 2) return reply({});
  const BAD = /(cover|カバー|歌ってみた|弾いてみた|叩いてみた|踊ってみた|karaoke|カラオケ|reaction|リアクション|lyric|歌詞|live|ライブ|切り抜き|#shorts|shorts|full album|nightcore|sped up|slowed|instrumental|off vocal|tutorial|弾き語り|メドレー|medley|remix|teaser|trailer|予告|making|メイキング|behind|dance practice|short ver|tv size|acoustic|session|first take|ファンメイド|fanmade|fan made|amv|mad)/i;
  const MARK = /(\bmv\b|music video|official video|ミュージックビデオ|\bpv\b|official)/i;
  const cands = [];
  for (const it of items) {
    const id = it.id?.videoId; if (!id || id === v) continue;
    const raw = decode(it.snippet?.title), title = nrm(raw), ch = decode(it.snippet?.channelTitle), nch = nrm(ch).replace(/vevo$/, '');
    if (!title.includes(nt)) continue;                                         // must be this song
    if (!(nch.length >= 2 && (nch.includes(na) || na.includes(nch)))) continue; // must be the artist's own channel
    if (/-\s*topic$/i.test(ch)) continue;                                       // not the auto-generated audio
    if (BAD.test(raw) && !BAD.test(t)) continue;                                // no covers / live / lyric videos
    cands.push({ id, title: raw, channel: ch, score: (MARK.test(raw) ? 2 : 0) + (title.startsWith(na) || title.includes(nt + 'mv') ? 1 : 0) });
  }
  if (!cands.length) return reply({});
  // length must fit the song (MVs may have a short intro/outro)
  const det = await yt('videos', { part: 'contentDetails', id: cands.map((c) => c.id).join(',') });
  const dur = new Map();
  if (det.ok) for (const x of (await det.json()).items || []) {
    const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(x.contentDetails?.duration || '') || [];
    dur.set(x.id, (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0));
  }
  const fit = cands.filter((c) => !d || !dur.has(c.id) || (dur.get(c.id) >= d - 20 && dur.get(c.id) <= d + 150));
  fit.sort((x, y) => y.score - x.score);
  const best = fit[0];
  return reply(best ? { id: best.id, title: best.title, channel: best.channel } : {});
}

async function japaneseNames(q) {
  const t = q.get('t') || '', a = q.get('a') || '', d = +q.get('d') || 0;
  if (!t) return reply({ error: 'bad request' }, false);
  const url = 'https://itunes.apple.com/search?' + new URLSearchParams({ term: `${a} ${t}`.trim(), country: 'JP', lang: 'ja_jp', entity: 'song', limit: '10' });
  const r = await fetch(url);
  if (!r.ok) return reply({ error: r.status }, false);
  const res = (await r.json()).results || [];
  const BAD = /(live|ライブ|ver\.|version|piano|instrumental|inst\.|karaoke|カラオケ|オルゴール|first take|remix|acoustic|english|cover|tv size|movie size|弾き語り)/i;
  const ok = res.filter((x) => x.trackName && (!d || Math.abs((x.trackTimeMillis || 0) / 1000 - d) <= 4) && (!BAD.test(x.trackName) || BAD.test(t)));
  if (!ok.length) return reply({});
  const same = ok.find((x) => nrm(x.trackName) === nrm(t));
  const pick = same || ok[0];
  return reply({ name: pick.trackName, artist: pick.artistName });
}

export default async (req) => {
  const u = new URL(req.url);
  try {
    if (u.pathname === '/api/mv') return await findMv(u.searchParams);
    if (u.pathname === '/api/ja') return await japaneseNames(u.searchParams);
  } catch (e) { console.error(e); return reply({ error: 'failed' }, false); }
  return new Response('not found', { status: 404 });
};

export const config = { path: ['/api/mv', '/api/ja'] };
