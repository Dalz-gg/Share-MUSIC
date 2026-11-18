/* Share MUSIC — share YouTube Music playlists as a clean, always-up-to-date page.
 * No server / no database:
 *   - Viewers read the playlist with a referrer-restricted API key (no login)
 *   - Creators log in with Google (OAuth token client) to list / publish / describe playlists
 *   - "Copy to my account" logs the viewer in and recreates the playlist in their library */
'use strict';

const CONFIG = window.PB_CONFIG || {};

/* =========================================================
 * Utilities
 * ======================================================= */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = (n) => String(n).padStart(2, '0');
/* =========================================================
 * Extension hooks: feature modules (discover.js, today.js, topics.js, spread.js ...) plug in here
 * instead of editing this file. Each module pushes functions into these lists.
 * ======================================================= */
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('ps.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ps.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem('ps.' + k); } catch { /* ignore */ } },
};
function fmtDur(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}
function fmtTotal(sec) { const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${m}分`; }
function parseIsoDur(iso) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
  return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0;
}
let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
  const ok = document.execCommand('copy'); ta.remove(); return ok;
}

class QuotaError extends Error {}
class AuthError extends Error {}

const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2.5v14H6zM20 5v14L9 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 5H18v14h-2.5zM4 5v14l11-7z"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.2 3 10.6V21h6.2v-6.1h5.6V21H21V10.6z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5.5-5 4 3.5 2.5-2 4 3.5"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>',
  shrink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5z"/><path d="M8.5 9.5h7M8.5 12.5h4.5"/></svg>',
  quote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h11l-3-3M17 17H6l3 3"/><path d="M18 7v4M6 17v-4"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  vs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l9 9M20 4l-9 9M7 14l-3 3 3 3M17 14l3 3-3 3M4 17h5M20 17h-5"/></svg>',
  smile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="12" r="8"/><path d="M8 14.5a4 4 0 0 0 6 0"/><path d="M8.5 9.5h.01M13.5 9.5h.01" stroke-width="2.6"/><path d="M20 3v4M18 5h4" stroke-width="1.8"/></svg>',
  phones: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/></svg>',
  device: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>',
  party: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  reply: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 6 6v1"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="1.5"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>',
  /* stage 5 (navigation): お題 / menu / help / about / privacy / 聴く */
  topic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/><path d="m12 12.6.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6"/><path d="M12 17h.01" stroke-width="2.8"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.6h.01" stroke-width="2.8"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/></svg>',
  tree: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2.2"/><circle cx="6" cy="18.5" r="2.2"/><circle cx="12" cy="18.5" r="2.2"/><circle cx="18" cy="18.5" r="2.2"/><path d="M12 7.2v9M12 11.5c-4 0-6 1.5-6 4.8M12 11.5c4 0 6 1.5 6 4.8"/></svg>',
  thanks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z"/></svg>',
};
const PRIV = {
  private: { label: '非公開', tag: 'PRIVATE', desc: '自分だけが見られます。共有ページも表示できません。' },
  unlisted: { label: '限定公開', tag: 'UNLISTED', desc: 'リンクを知っている人だけが見られます。おすすめ。' },
  public: { label: '公開', tag: 'PUBLIC', desc: '誰でも検索して見つけられます。' },
};
function jcard(title) {
  return `<div class="jcard"><div class="jt">${esc(title)}</div><div class="jb"><span>PLAYLIST</span><span></span></div></div>`;
}
const bestThumb = (th) => th?.maxres?.url || th?.standard?.url || th?.high?.url || th?.medium?.url || th?.default?.url || '';
const shareLink = (id) => `${location.origin}/p/${id}`;
const ytmPlaylistUrl = (id) => `https://music.youtube.com/playlist?list=${id}`;

/* =========================================================
 * Title / artist guess from a YouTube video
 * ======================================================= */
const BRACKET_NOISE = /official|music\s*video|lyric|audio|video|\bmv\b|\bpv\b|\bhd\b|4k|remaster|歌詞|公式|オフィシャル|full|visualizer/i;
const WORD_NOISE = /(official\s*(music\s*)?(video|audio|mv|lyric\s*video|visualizer)|music\s*video|lyric(s)?\s*video|\bmv\b|\bpv\b|\bhd\b|\b4k\b|歌詞付き?|\bvisualizer\b)/gi;
function cleanChannel(c) { return (c || '').replace(/\s*-\s*(Topic|トピック)$/i, '').replace(/VEVO$/i, '').replace(/\s*(official\s*(youtube\s*)?(channel)?|公式(チャンネル)?|チャンネル|channel)\s*$/i, '').trim(); }
function guessSong(title, channel) {
  const raw = (title || '').normalize('NFKC');
  if (/\s-\s*Topic$/i.test(channel || '')) return { name: raw, artist: cleanChannel(channel) };
  let t = raw.replace(/【[^】]*】/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  t = t.replace(/[(（]([^)）]*)[)）]/g, (m, inner) => (BRACKET_NOISE.test(inner) ? ' ' : m));
  t = t.replace(WORD_NOISE, ' ').replace(/\s+/g, ' ').trim();
  const kagi = /^(.+?)\s*[「『](.+?)[」』]/.exec(t);
  if (kagi) return { artist: kagi[1].trim(), name: kagi[2].trim() };
  const sep = /\s+[-–—|/／]\s+|\s*[-–—]\s+|\s+[-–—]\s*/.exec(t);
  if (sep) {
    const left = t.slice(0, sep.index).trim(), right = t.slice(sep.index + sep[0].length).trim();
    if (left && right) return { artist: left, name: right.replace(/^["“'](.+)["”']$/, '$1') };
  }
  return { name: t || raw, artist: cleanChannel(channel) };
}

/* =========================================================
 * YouTube Data API
 * ======================================================= */
const YT_SCOPE = 'https://www.googleapis.com/auth/youtube';
const YT_DAILY = 10000;
function ptDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()); }

const Api = {
  get token() { const t = store.get('token'); return t && Date.now() < t.exp - 30000 ? t : null; },
  /** logged in = a valid access token, or a server session that can mint a new one */
  connected() { return !!this.token || !!store.get('session'); },
  codeFlow: null, // true when the server can keep logins (GOOGLE_CLIENT_SECRET set)
  refreshing: null,
  /** a valid access token, refreshed from the server session when needed */
  async accessToken() {
    if (this.probing) await this.probing; // the boot-time probe may already be fetching a fresh token
    const t = this.token; if (t) return t.access;
    if (!store.get('session')) return null;
    if (!this.refreshing) {
      this.refreshing = fetch('/api/auth/token', { credentials: 'same-origin' }).then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.access_token) { store.set('token', { access: j.access_token, exp: Date.now() + (+j.expires_in || 3600) * 1000 }); return j.access_token; }
        if (r.status === 401) { store.del('session'); store.del('token'); }
        return null;
      }).catch(() => null).finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  },
  probe() { this.probing = this._probe().finally(() => { this.probing = null; }); return this.probing; },
  async _probe() {
    try {
      const r = await fetch('/api/auth/token', { credentials: 'same-origin' }); const j = await r.json().catch(() => ({}));
      this.codeFlow = j.configured !== false;
      if (j.access_token) { store.set('token', { access: j.access_token, exp: Date.now() + (+j.expires_in || 3600) * 1000 }); store.set('session', true); }
      else if (r.status === 401 && store.get('session') && !this.token) { store.del('session'); renderConn(); }
    } catch { this.codeFlow = false; }
    return this.codeFlow;
  },
  async afterLogin() {
    try {
      const j = await this.api('channels?part=snippet&mine=true', { auth: true });
      const ch = j.items?.[0]?.snippet;
      store.set('profile', { id: j.items?.[0]?.id || '', name: ch?.title || 'YouTube', icon: ch?.thumbnails?.default?.url || '' });
    } catch (e) { console.warn(e); }
  },
  get profile() { return store.get('profile'); },
  quotaUsed() { const q = store.get('quota'); return q && q.date === ptDate() ? q.used : 0; },
  addQuota(n) { store.set('quota', { date: ptDate(), used: this.quotaUsed() + n }); },

  login() {
    return new Promise((resolve, reject) => {
      if (!window.google?.accounts?.oauth2) { toast('Googleの読み込み中です。数秒後にもう一度押してください'); return reject(new Error('silent')); }
      if (this.codeFlow) {
        // long-lived login: the server exchanges the code and keeps the refresh token
        return google.accounts.oauth2.initCodeClient({
          client_id: CONFIG.googleClientId, scope: YT_SCOPE, ux_mode: 'popup',
          callback: async (r) => {
            if (r.error) { reject(new Error(r.error)); return; }
            const res = await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: r.code }) });
            const j = await res.json().catch(() => ({}));
            if (!res.ok || !j.access_token) { reject(new Error(j.error || 'ログインに失敗しました')); return; }
            store.set('token', { access: j.access_token, exp: Date.now() + (+j.expires_in || 3600) * 1000 });
            if (j.persistent) store.set('session', true); else { store.del('session'); setTimeout(() => toast('ログインを保持するには、一度ログアウトしてからもう一度ログインしてください', 7000), 2800); }
            await this.afterLogin();
            resolve();
          },
          error_callback: () => reject(new Error('silent')),
        }).requestCode();
      }
      google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.googleClientId, scope: YT_SCOPE,
        callback: async (r) => {
          if (r.error) { reject(new Error(r.error)); return; }
          store.set('token', { access: r.access_token, exp: Date.now() + (+r.expires_in || 3600) * 1000 });
          await this.afterLogin();
          resolve();
        },
        error_callback: () => reject(new Error('silent')),
      }).requestAccessToken();
    });
  },
  /** my channel id (fetched once if the saved profile predates it) */
  async myId() {
    if (!this.connected()) return null;
    const pr = this.profile || {};
    if (pr.id) return pr.id;
    try { const j = await this.api('channels?part=snippet&mine=true', { auth: true }); const id = j.items?.[0]?.id || ''; store.set('profile', { ...pr, id }); return id; } catch { return null; }
  },
  logout() {
    Social.bms = null;
    const t = store.get('token');
    if (t && window.google?.accounts?.oauth2) { try { google.accounts.oauth2.revoke(t.access); } catch { /* ignore */ } }
    if (store.get('session')) fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    store.del('token'); store.del('profile'); store.del('session');
  },

  /** auth:true uses the logged-in user's token; otherwise the public API key. */
  async api(path, opts = {}) {
    const headers = {};
    let url = 'https://www.googleapis.com/youtube/v3/' + path;
    if (opts.auth) {
      const access = await this.accessToken(); if (!access) throw new AuthError('Googleでログインしてください');
      headers.Authorization = 'Bearer ' + access;
    } else {
      url += (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(CONFIG.apiKey);
    }
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (opts.cost) this.addQuota(opts.cost);
    const res = await fetch(url, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reason = j.error?.errors?.[0]?.reason || '';
      if (res.status === 401 && opts.auth) {
        store.del('token');
        if (store.get('session') && !opts._retry) return this.api(path, { ...opts, _retry: true }); // refresh from the server session
        throw new AuthError('ログインの有効期限が切れました。もう一度ログインしてください');
      }
      if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded/.test(reason)) throw new QuotaError('今日のYouTube APIの利用上限に達しました');
      if (/youtubeSignupRequired|channelNotFound/.test(reason)) throw new Error('このGoogleアカウントにはYouTubeチャンネルがありません。YouTubeで一度チャンネルを作成してからお試しください');
      if (res.status === 403 && !opts.auth) throw new Error('APIキーが使えませんでした（サイトの制限設定を確認してください）');
      if (res.status === 403) throw new Error('YouTubeへのアクセスが許可されていません。ログイン時に YouTube へのアクセスを許可したか確認して、もう一度ログインしてください');
      throw new Error('YouTube エラー: ' + (j.error?.message || res.status));
    }
    return j;
  },

  async myPlaylists() {
    const out = []; let pageToken = '';
    do {
      const j = await this.api('playlists?' + new URLSearchParams({ part: 'snippet,status,contentDetails', mine: 'true', maxResults: '50', ...(pageToken ? { pageToken } : {}) }), { auth: true });
      for (const p of j.items || []) out.push(mapPlaylist(p));
      pageToken = j.nextPageToken || '';
    } while (pageToken);
    return out;
  },

  async playlist(id, auth = false) {
    const j = await this.api('playlists?' + new URLSearchParams({ part: 'snippet,status,contentDetails', id }), { auth });
    return j.items?.[0] ? mapPlaylist(j.items[0]) : null;
  },

  async tracks(playlistId, auth = false) {
    const items = []; let pageToken = '';
    do {
      const j = await this.api('playlistItems?' + new URLSearchParams({ part: 'snippet,contentDetails', playlistId, maxResults: '50', ...(pageToken ? { pageToken } : {}) }), { auth });
      for (const it of j.items || []) {
        const vid = it.contentDetails?.videoId, sn = it.snippet || {};
        if (!vid || !sn.videoOwnerChannelTitle) continue; // deleted / private videos
        items.push({ id: vid, pid: it.id, pos: sn.position, rawTitle: sn.title, channel: sn.videoOwnerChannelTitle, thumb: sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url || '' });
      }
      pageToken = j.nextPageToken || '';
    } while (pageToken && items.length < 1000);
    // durations, embeddable flag and Japanese titles (hl=ja returns the localized title when one exists)
    const det = new Map();
    for (let i = 0; i < items.length; i += 50) {
      const ids = items.slice(i, i + 50).map((x) => x.id).join(',');
      const j = await this.api('videos?' + new URLSearchParams({ part: 'snippet,contentDetails,status', id: ids, maxResults: '50', hl: 'ja' }), { auth });
      for (const v of j.items || []) {
        det.set(v.id, { d: parseIsoDur(v.contentDetails?.duration), embed: v.status?.embeddable !== false, title: v.snippet?.localized?.title || v.snippet?.title, ch: v.snippet?.channelId });
      }
    }
    // Japanese names of auto-generated "Artist - Topic" channels
    const topicIds = [...new Set(items.filter((x) => /-\s*Topic$/i.test(x.channel)).map((x) => det.get(x.id)?.ch).filter(Boolean))];
    const chName = new Map();
    for (let i = 0; i < topicIds.length; i += 50) {
      try {
        const j = await this.api('channels?' + new URLSearchParams({ part: 'snippet', id: topicIds.slice(i, i + 50).join(','), maxResults: '50', hl: 'ja' }), { auth });
        for (const c of j.items || []) chName.set(c.id, c.snippet?.localized?.title || c.snippet?.title);
      } catch { /* optional */ }
    }
    return items.map((x) => {
      const d = det.get(x.id) || { d: 0, embed: true };
      const topic = /-\s*Topic$/i.test(x.channel);
      const channel = topic ? `${cleanChannel(chName.get(d.ch) || x.channel)} - Topic` : x.channel;
      const g = guessSong(d.title || x.rawTitle, channel);
      return { ...x, name: g.name, artist: g.artist, d: d.d, embed: d.embed };
    });
  },

  async updatePlaylist(p, { title, privacy, description }) {
    const j = await this.api('playlists?part=snippet,status', {
      method: 'PUT', auth: true, cost: 50,
      body: { id: p.id, snippet: { title: (title || p.title).slice(0, 150), description: (description ?? p.description).slice(0, 5000) }, status: { privacyStatus: privacy || p.privacy } },
    });
    return mapPlaylist(j);
  },

  async createPlaylist(title, description) {
    const j = await this.api('playlists?part=snippet,status', {
      method: 'POST', auth: true, cost: 50,
      body: { snippet: { title: title.slice(0, 150), description: description.slice(0, 5000) }, status: { privacyStatus: 'private' } },
    });
    return j.id;
  },
  async addVideo(playlistId, videoId) {
    return this.api('playlistItems?part=snippet', { method: 'POST', auth: true, cost: 50, body: { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } } });
  },
  /** remove one entry (playlistItem id) from a playlist */
  async removeItem(pid) {
    const t = await this.accessToken(); if (!t) throw new AuthError('Googleでログインしてください');
    this.addQuota(50);
    const r = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?id=' + encodeURIComponent(pid), { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error('YouTube エラー: ' + (j.error?.message || r.status)); }
  },
  /** move an entry to a new position (0 = top) */
  async moveItem(playlistId, pid, videoId, position) {
    return this.api('playlistItems?part=snippet', { method: 'PUT', auth: true, cost: 50, body: { id: pid, snippet: { playlistId, position, resourceId: { kind: 'youtube#video', videoId } } } });
  },
};
function mapPlaylist(p) {
  return {
    id: p.id, title: p.snippet?.title || '', description: p.snippet?.description || '', owner: p.snippet?.channelTitle || '', ownerId: p.snippet?.channelId || '',
    image: Cover.pick(p.snippet?.thumbnails) || bestThumb(p.snippet?.thumbnails), ytImage: Cover.pick(p.snippet?.thumbnails) || bestThumb(p.snippet?.thumbnails), privacy: p.status?.privacyStatus || 'private', count: p.contentDetails?.itemCount ?? null,
  };
}

/* =========================================================
 * Router
 * ======================================================= */
const S = { mine: null, mineLoading: false, view: null, edit: null };

/** app-style bottom navigation (stage 5): discovery first —
 *  ホーム(今日のおすすめ) / お題 / ＋おすすめする / コミュニティ / マイページ.
 *  Listening features (playlists, parties, mixtapes) live in the 「聴く」 page (/#listen) and the header menu. */
function renderTabbar() {
  const el = document.getElementById('tabbar'); if (!el) return;
  const path = location.pathname, h = location.hash;
  const hide = path === '/admin';
  el.hidden = hide; document.body.classList.toggle('has-tabbar', !hide);
  if (hide) return;
  const cur = h === '#help' || h === '#listen' ? '' : path === '/' && !h ? 'home' : path === '/topic' || path.startsWith('/topic/') ? 'topic'
    : path === '/c' || path.startsWith('/c/') ? 'c' : path === '/me' || path === '/bookmarks' ? 'me' : '';
  const item = (k, to, icon, label, act = 'go') => `<a href="${to}" class="${cur === k ? 'on' : ''}" data-act="${act}" data-to="${to}">${icon}<span>${label}</span></a>`;
  const prev = el.querySelector('.tab-ind')?.style.cssText || '';
  el.innerHTML = `<i class="tab-ind" style="${prev}"></i>` + item('home', '/', ICON.home, 'ホーム') + item('topic', '/topic', ICON.topic, 'お題')
    + `<a href="/share/song" class="compose ${path === '/share/song' ? 'on' : ''}" data-act="rec-new" aria-label="おすすめ曲を投稿する"><span class="plus">${ICON.plus}<small>おすすめ</small></span></a>`
    + item('c', '/c', ICON.chat, 'コミュニティ') + item('me', '/me', ICON.user, 'マイページ');
  moveTabIndicator();
}
/** the soft pill behind the current tab slides from the previous tab to the new one */
function moveTabIndicator() {
  const bar = document.getElementById('tabbar'), ind = bar?.querySelector('.tab-ind'), on = bar?.querySelector('a.on:not(.compose)');
  if (!ind) return;
  if (!on) { ind.style.opacity = '0'; return; }
  requestAnimationFrame(() => { ind.style.cssText = `opacity:1;width:${on.offsetWidth}px;transform:translateX(${on.offsetLeft}px)`; });
}
addEventListener('resize', () => moveTabIndicator());
const ago = (t) => { const m = Math.floor((Date.now() - t) / 60000); return m < 1 ? 'たった今' : m < 60 ? `${m}分前` : m < 1440 ? `${Math.floor(m / 60)}時間前` : m < 43200 ? `${Math.floor(m / 1440)}日前` : new Date(t).toLocaleDateString('ja-JP'); };

/** notifications: likes, comments, replies, bookmarks and follows on my things (bell in the header) */
const Notifs = {
  items: null, read: 0, unread: 0, at: 0,
  async poll(force) {
    if (!Api.connected()) { this.unread = 0; return this.badge(); }
    if (!force && Date.now() - this.at < 60000) return this.badge();
    this.at = Date.now();
    try {
      const h = await Social.headers(); if (!h) return this.badge();
      const r = await fetch('/api/notifs', { headers: h }); if (!r.ok) return;
      const j = await r.json(); this.items = j.items || []; this.read = j.read || 0; this.unread = j.unread || 0;
    } catch { /* offline */ }
    this.badge();
  },
  badge() {
    const b = document.getElementById('bell'); if (!b) return;
    b.hidden = !Api.connected();
    const d = b.querySelector('.dot'); if (d) { d.hidden = !this.unread; d.textContent = this.unread > 9 ? '9+' : String(this.unread || ''); }
  },
  async markRead() {
    const h = await Social.headers(); if (!h) return;
    fetch('/api/notifs/read', { method: 'POST', headers: h }).catch(() => {});
    this.unread = 0; this.badge();
  },
  row(n, isNew) {
    const what = n.kind === 's' ? 'おすすめ曲' : 'プレイリスト', t = `「${esc(n.title)}」`, who = `<b>${esc(n.from || '誰か')}</b>さん`;
    const msg = {
      like: `あなたの${what}${t}に${n.n > 1 ? ` <b>${n.n}件</b>の` : ''}いいねがつきました`,
      comment: `${who}があなたの${what}${t}にコメントしました`,
      reply: `${who}があなたのコメントに返信しました（${t}）`,
      bm: `${who}があなたの${what}${t}をブックマークしました`,
      follow: `${who}があなたをフォローしました`,
      also: `${who}があなたのおすすめ曲${t}に「私もおすすめ」しました`,
      preply: `${who}があなたの投稿に返信しました`,
      thread: `${who}が、あなたも返信した投稿に返信しました`,
      quote: `${who}があなたの投稿を引用しました`,
      react: `${who}があなたの投稿に ${RX_ICON[n.r] || '♥'} しました${n.title ? `（「${esc(n.title.slice(0, 30))}」）` : ''}`,
    }[n.t] || Hooks.notif[n.t]?.(n, who, t) || '';
    const to = Hooks.notifLink[n.t]?.(n) || (n.t === 'follow' ? `/u/${n.fromId}` : n.kind === 'm' ? `/c/${n.id}` : n.kind === 's' ? `/s/${n.id}` : `/p/${n.id}`);
    const sys = { topic: ICON.topic, spread: ICON.tree }[n.t];
    const icon = n.t === 'like' ? '<span class="ni like">♥</span>' : sys && !n.fromId ? `<span class="ni like sys">${sys}</span>` : Avatars.html(n.fromId, n.from, 'ni');
    return `<button class="nrow ${isNew ? 'new' : ''}" data-act="go" data-to="${esc(to)}">${icon}
      <span class="nbody"><span class="nmsg">${msg}</span>${n.text ? `<span class="ntext">${esc(n.text)}</span>` : ''}<span class="ntime">${ago(n.at)}</span></span></button>`;
  },
};
async function renderNotifs() {
  document.title = 'お知らせ — Share MUSIC';
  if (!Api.connected()) return setApp(`<h1 class="pagetitle">お知らせ</h1><div class="sheet stack center" style="padding:28px 18px"><div class="small muted">ログインすると、あなたの共有へのいいね・コメント・ブックマークやフォローをお知らせします。</div><div><button class="btn solid" data-act="login">Googleでログイン</button></div></div>`);
  setApp(`<h1 class="pagetitle">お知らせ</h1><div id="nlist"><div class="loading" style="padding:20px 0"><span class="spinner"></span> 読み込み中…</div></div>`);
  await Notifs.poll(true);
  if (location.pathname !== '/notifs') return;
  const items = Notifs.items || [], read = Notifs.read;
  $('#nlist').innerHTML = items.length ? `<div class="nlist">${items.map((n) => Notifs.row(n, n.at > read)).join('')}</div>`
    : '<div class="sheet flat stack center" style="padding:28px 16px"><div class="empty-ic">${ICON.bell}</div><div class="muted small">まだお知らせはありません。<br>あなたの共有にいいねやコメントがつくと、ここに届きます。</div></div>';
  if (Notifs.unread) Notifs.markRead();
}

/** following other people: their new shares show up on home */
const Follows = {
  list: null,
  async load(force) {
    const h = await Social.headers(); if (!h) { this.list = null; return null; }
    if (this.list && !force) return this.list;
    try { const r = await fetch('/api/follows', { headers: h }); this.list = r.ok ? (await r.json()).items || [] : []; } catch { this.list = []; }
    return this.list;
  },
  has(id) { return !!this.list?.some((x) => x.id === id); },
  async counts(id) { try { const r = await fetch('/api/follows?of=' + encodeURIComponent(id)); return r.ok ? await r.json() : {}; } catch { return {}; } },
  async toggle(btn) {
    const id = btn.dataset.id, name = btn.dataset.name;
    if (!Api.connected()) { toast('フォローするにはログインしてください'); if (!(await login())) return; }
    if (!this.list) await this.load();
    const on = this.has(id); btn.disabled = true;
    try {
      const h = await Social.headers(); if (!h) throw new AuthError('ログインしてください');
      const r = await fetch('/api/follows?id=' + encodeURIComponent(id), { method: on ? 'DELETE' : 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: on ? undefined : JSON.stringify({ name }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'フォローできませんでした');
      this.list = j.items; this.draw(btn);
      const fc = $('#f-followers'); if (fc) fc.textContent = j.followers;
      toast(on ? 'フォローを外しました' : `${name}さんをフォローしました`);
    } catch (e) { toast(errText(e), 4000); }
    btn.disabled = false;
  },
  draw(btn) { const on = this.has(btn.dataset.id); btn.classList.toggle('solid', !on); btn.classList.toggle('on', on); btn.textContent = on ? '✓ フォロー中' : '＋ フォローする'; },
  countsHtml(c) { return `<span><b id="f-followers">${c.followers ?? 0}</b> フォロワー</span><span><b>${c.following ?? 0}</b> フォロー中</span>`; },
};

/** report a playlist / song / comment to the operator */
const Report = {
  target: null,
  REASONS: [['spam', 'スパム・宣伝'], ['abuse', '悪口・嫌がらせ'], ['inappropriate', '不適切な内容'], ['rights', '権利の侵害'], ['other', 'その他']],
  open(el) {
    const v = S.view || {}, kind = el.dataset.kind;
    const id = kind === 'm' ? el.dataset.pid : v.song ? v.song.sid : v.p?.id; if (!id) return;
    el.closest('.post-menu')?.setAttribute('hidden', '');
    this.target = kind === 'c' ? { kind: 'c', id, cid: el.dataset.cid, thread: Comments.thread() } : { kind, id };
    const label = { p: 'このプレイリスト', s: 'このおすすめ曲', c: 'このコメント', m: 'この投稿' }[kind];
    const m = $('#modal');
    m.innerHTML = `<div class="modal-card sheetup" role="dialog" aria-label="通報">
      <div class="row" style="margin-bottom:10px"><b class="spacer display" style="font-size:19px">${label}を通報</b><button class="btn quiet sm" data-act="modal-close" aria-label="閉じる">${ICON.close}</button></div>
      <div class="small muted" style="margin-bottom:10px">運営が内容を確認し、必要に応じて非公開・削除します。通報したことは相手には伝わりません。</div>
      <div class="stack" id="rep-reasons">${this.REASONS.map(([k, l], i) => `<label class="radio"><input type="radio" name="rep" value="${k}" ${i ? '' : 'checked'}> ${l}</label>`).join('')}</div>
      <textarea class="input" id="rep-text" rows="3" maxlength="300" placeholder="詳しい内容（任意）" style="margin-top:10px"></textarea>
      <button class="btn solid" style="margin-top:12px;width:100%" data-act="report-send">運営に送る</button></div>`;
    m.hidden = false; document.body.classList.add('modal-open');
  },
  async send(btn) {
    if (!this.target) return;
    btn.disabled = true;
    try {
      const r = await fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...this.target, reason: document.querySelector('input[name=rep]:checked')?.value, text: $('#rep-text').value.trim() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || '送れませんでした');
      ShareImage.close(); toast('運営に通報しました。ご協力ありがとうございます', 3500);
    } catch (e) { toast(errText(e), 4000); btn.disabled = false; }
  },
};

/** bottom "+": two cards rise over the current page; sign-in is asked only after choosing */
const ShareSheet = {
  get el() { return document.getElementById('sheet'); },
  /** the header menu (stage 5): 聴く features, bookmarks, help, about, privacy. Old act names (sheet-post / sheet-party / sheet-pick) still work. */
  open() {
    const el = this.el; if (!el) return;
    if (!el.hidden) return this.close();
    const row = (d, attrs, icon, label, sub) => `<button class="mrow rise" style="--d:${d}ms" ${attrs}><span class="mi">${icon}</span><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span><i class="chev">›</i></button>`;
    el.innerHTML = `<div class="sheet-bg" data-act="sheet-close"></div>
      <div class="sheet-cards menu-sheet" role="dialog" aria-label="メニュー">
        ${row(0, 'data-act="sheet-go" data-to="/#listen"', ICON.phones, '聴く', 'プレイリスト・リスニングパーティー・ミックステープ')}
        ${row(20, 'data-act="sheet-go" data-to="/party"', ICON.party, 'リスニングパーティー', '')}
        ${row(40, 'data-act="sheet-go" data-to="/bookmarks"', ICON.star, 'ブックマーク', '')}
        <div class="mh">Share MUSIC</div>
        ${row(60, 'data-act="sheet-go" data-to="/#help"', ICON.help, '使い方', '')}
        ${row(80, 'data-act="sheet-link" data-to="/about"', ICON.info, 'このアプリについて', '')}
        ${row(100, 'data-act="sheet-link" data-to="/privacy"', ICON.shield, 'プライバシーポリシー', '')}
      </div>`;
    el.hidden = false; document.body.classList.add('sheet-open');
    requestAnimationFrame(() => el.classList.add('on'));
  },
  close() {
    const el = this.el; if (!el || el.hidden) return;
    el.classList.remove('on'); document.body.classList.remove('sheet-open');
    setTimeout(() => { if (!el.classList.contains('on')) { el.hidden = true; el.innerHTML = ''; } }, 250);
  },
  async pick(to) {
    this.close();
    if (!Api.connected()) { toast('共有するにはログインしてください'); if (!(await login())) return; }
    go(to);
  },
};

/** share a page: the phone's share sheet (LINE, X, ...) with a message that fits the page, or copy the link */
async function openShare({ url, text, title }) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: title || 'Share MUSIC', text, url }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  if (await copyText(url)) toast('リンクをコピーしました');
}
function shareThis() {
  const url = location.origin + location.pathname, v = S.view;
  if (v?.song) { const so = v.song, who = [so.by, ...(so.also || []).map((x) => x.name)].filter(Boolean); return openShare({ url, title: `${so.title} — ${so.artist}`, text: `♪ ${so.title} / ${so.artist}\n${who.slice(0, 2).join('さん、')}さん${who.length > 2 ? `ほか${who.length - 2}人` : ''}のおすすめ曲${so.desc ? `「${so.desc.slice(0, 60)}」` : ''} #ShareMUSIC` }); }
  if (v?.p && location.pathname.startsWith('/p/')) return openShare({ url, title: v.p.title, text: `「${v.p.title}」— ${v.p.owner}さんのプレイリスト（${v.tracks?.length || 0}曲）#ShareMUSIC` });
  if (location.pathname.startsWith('/u/')) { const n = $('.phead h1')?.textContent || ''; return openShare({ url, title: `${n}さん`, text: `${n}さんの音楽をチェック #ShareMUSIC` }); }
  return openShare({ url, text: 'Share MUSIC — 人のおすすめで、新しい曲と出会う。好きな曲をおすすめして、共感し合おう。' });
}

/** share hub (bottom "+"): choose a playlist or a song, then a page of its own */
function renderShareHub() {
  document.title = '共有する — Share MUSIC';
  if (!Api.connected()) {
    return setApp(`<h1 class="pagetitle">共有する</h1>
      <div class="sheet stack center" style="padding:32px 18px;margin-top:10px">
        <div class="display" style="font-size:20px">ログインして共有しましょう</div>
        <div class="small muted">大好きな1曲をおすすめして、誰かの新しい出会いにしましょう。</div>
        <div><button class="btn solid" data-act="login">Googleでログイン</button></div>
      </div>`);
  }
  setApp(`<h1 class="pagetitle">共有する</h1>
    <div class="small muted" style="margin-bottom:6px">何を共有しますか？</div>
    <button class="choice big" data-act="go" data-to="/share/song"><span class="ci">${ICON.note}</span><span><b>おすすめ曲を投稿する</b><small>好きな1曲を選んで、「ここを聴いて」の瞬間とひとことを添えて投稿します</small></span><i class="chev">›</i></button>
    <button class="choice big" data-act="go" data-to="/share/pl"><span class="ci">${ICON.link}</span><span><b>プレイリストを共有する</b><small>YouTube Music の自分のプレイリストを選んで、タイトル・紹介文・ジャンル・カバーを決めて掲載します</small></span><i class="chev">›</i></button>
    <div class="hint" style="margin-top:16px">プレイリストのページの曲目にある「＋」からも、その曲をおすすめ曲に投稿できます。共有したものはマイページで確認・編集できます。</div>`);
}
function renderSharePage(kind) {
  const pl = kind === 'pl';
  document.title = (pl ? 'プレイリストを共有' : 'おすすめ曲を投稿') + ' — Share MUSIC';
  if (!Api.connected()) return renderShareHub();
  setApp(`<button class="btn quiet sm back" data-act="go" data-to="${pl ? '/#listen' : '/'}">← ${pl ? '聴く' : 'ホーム'}</button>
    <h1 class="pagetitle">${pl ? 'プレイリストを共有' : 'おすすめ曲を投稿'}</h1>
    <div id="me-body"></div>`);
  drawMeTab();
}
function route() {
  document.body.classList.remove('party-theater');
  ShareSheet.close();
  renderTabbar();
  Notifs.poll();
  for (const fn of Hooks.routes) { try { if (fn(location.pathname, location.hash)) return; } catch (e) { console.error(e); } }
  const m = /^\/p\/([\w-]{10,})/.exec(location.pathname);
  if (m) return renderViewer(m[1]);
  const sm = /^\/s\/([\w-]{6,40})/.exec(location.pathname);
  if (sm) return renderSong(sm[1]);
  const h = location.hash;
  if (h.startsWith('#share=')) return renderShare(h.slice(7));
  if (h.startsWith('#edit=')) return renderShare(h.slice(6));
  if (location.pathname === '/admin') return Admin.render();
  if (h === '#help') return renderHelp();
  if (h === '#listen') return renderListen();
  if (location.pathname === '/me') return renderMe();
  if (location.pathname === '/search') return renderSearch();
  if (location.pathname === '/bookmarks') return renderBookmarks();
  if (location.pathname === '/share') return renderShareHub();
  if (location.pathname === '/notifs') return renderNotifs();
  if (location.pathname === '/party') return renderParties();
  const pm = /^\/party\/([a-f0-9]{10})$/.exec(location.pathname);
  if (pm) return renderParty(pm[1]);
  if (location.pathname === '/c') return renderCommunity();
  const cm = /^\/c\/([a-f0-9]{14})$/.exec(location.pathname);
  if (cm) return renderPost(cm[1]);
  if (location.pathname === '/share/pl' || location.pathname === '/share/song') return renderSharePage(location.pathname.slice(7));
  const u = /^\/u\/([\w-]{10,})/.exec(location.pathname);
  if (u) return renderProfile(u[1]);
  return renderHome();
}
window.addEventListener('hashchange', route);
window.addEventListener('popstate', route);
function go(path) { history.pushState(null, '', path); route(); }

function renderConn() {
  const p = Api.profile, on = Api.connected();
  $('#conn').innerHTML = on && p
    ? `<a class="mylink ${location.pathname === '/me' ? 'on' : ''}" href="/me" data-act="go" data-to="/me" title="マイページ">${p.icon ? `<img src="${esc(p.icon)}" alt="">` : '<i class="noicon"></i>'}<span>マイページ</span></a>`
    : `<button class="mylink" data-act="login">ログイン</button>`;
  Notifs.badge();
}
function setApp(html) {
  if (!/class="loading"/.test(html.slice(0, 200))) hideSplash(); const app = $('#app'); app.oninput = app.onchange = null; app.innerHTML = html;
  app.classList.remove('enter'); void app.offsetWidth; app.classList.add('enter'); fixLetterbox(app); renderConn(); window.scrollTo({ top: 0 }); }
const backBtn = (label = 'マイページ', to = '/me') => `<button class="btn quiet sm back" data-act="go" data-to="${to}">← ${label}</button>`;

/** login: show the guide about Google's warning screen first (unless the user opted out) */
function login() {
  const run = async () => {
    try { await Api.login(); toast('ログインしました'); return true; }
    catch (e) { if (e.message !== 'silent') toast('ログインできませんでした: ' + e.message); return false; }
  };
  if (store.get('guide-skip')) return run();
  return new Promise((resolve) => LoginGuide.open(() => resolve(run())));
}
function errText(e) {
  if (e instanceof QuotaError) return '今日のYouTube APIの利用上限に達しました。明日（日本時間16〜17時以降）にもう一度お試しください。';
  return e.message || String(e);
}

/* =========================================================
 * Home: everyone's playlists + recommended songs
 * ======================================================= */
function renderHome() {
  if (Hooks.renderHome) return Hooks.renderHome();
  document.title = 'Share MUSIC';
  const on = Api.connected();
  const rec = Recent.list();
  setApp(`
    <div id="feature"><section class="hero">
      <div class="eyebrow">出会う・おすすめする・共感する</div>
      <h1 class="hero-title" style="margin-top:12px">あなたの好きが、<br><em>誰かの1曲に。</em></h1>
      <p>人のおすすめで新しい曲と出会い、大好きな曲をおすすめして、「わかる」「ありがとう」で共感し合う場所です。</p>
    </section></div>
    ${on ? '' : `<button class="btn lg solid" data-act="login" style="margin-top:18px">Googleでログインして共有する</button>
      <div class="hint">見る・聴く・いいね・コメントはログインなしでできます。</div>`}
    ${resumeNote()}
    ${Install.banner()}
    <div id="shelves"><div class="loading" style="padding:28px 0"><span class="spinner"></span> 読み込み中…</div></div>
    ${rec.length ? `<details class="recent"><summary>履歴（${rec.length}）</summary>${Recent.html()}</details>` : ''}
  `);
  Promise.all([Social.loadGallery(), Songs.load(), Api.connected() ? Follows.load() : null, partyList().then((l) => { Parties.live = l; })]).then(() => { drawFeature(); drawShelves(); });
  for (const fn of Hooks.home) { try { fn(); } catch (e) { console.error(e); } }
}
const Parties = { live: null };
/** big swipeable "pick up" cards at the top of home (most-liked playlists) */
function drawFeature() {
  const el = $('#feature'); if (!el || location.pathname !== '/' || location.hash) return;
  const g = [...(Social.gallery || [])].sort((a, b) => (b.likes || 0) - (a.likes || 0) || (b.at || 0) - (a.at || 0)).slice(0, 5);
  if (!g.length) return; // keep the big catchphrase while nothing is shared yet
  el.innerHTML = `<div class="mini-hero">あなたの好きが、<em>誰かの1曲に。</em></div>
    <div class="feat" id="feat">${g.map((p) => `<a class="fc" href="/p/${esc(p.id)}" data-act="go" data-to="/p/${esc(p.id)}">
      ${p.image ? `<img src="${esc(p.image)}" alt="">` : jcard(p.title)}
      <span class="ov"><span class="k">今週のピックアップ</span><b>${esc(p.title)}</b><span class="m">${Avatars.html(p.ownerId, p.owner, 'sm')}${esc(p.owner)}${p.likes ? ` ・ ♥ ${p.likes}` : ''}${p.count ? ` ・ ${p.count}曲` : ''}</span></span>
      <button class="pbtn" data-act="feat-play" data-id="${esc(p.id)}" aria-label="${esc(p.title)} を再生">${ICON.play}</button></a>`).join('')}</div>
    ${g.length > 1 ? `<div class="dots" id="feat-dots">${g.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}`;
  const f = $('#feat'), dots = [...document.querySelectorAll('#feat-dots i')];
  f?.addEventListener('scroll', () => { const w = f.firstElementChild?.offsetWidth || 1, i = Math.round(f.scrollLeft / (w + 12)); dots.forEach((d, j) => d.classList.toggle('on', i === j)); }, { passive: true });
  fixLetterbox(el);
}
/** bookmarks saved before the creator's channel was recorded: look it up (shared list first, then YouTube) */
async function fillOwners(list) {
  if (!list?.length) return;
  const gal = await Social.loadGallery().catch(() => []);
  for (const b of list) { const g = gal.find((x) => x.id === b.id); if (g) { b.ownerId = b.ownerId || g.ownerId; b.owner = g.owner || b.owner; } }
  const need = list.filter((b) => !b.ownerId).map((b) => b.id);
  for (let i = 0; i < need.length; i += 50) {
    try {
      const j = await Api.api('playlists?' + new URLSearchParams({ part: 'snippet', id: need.slice(i, i + 50).join(','), maxResults: '50' }));
      for (const it of j.items || []) { const b = list.find((x) => x.id === it.id); if (b) { b.ownerId = it.snippet?.channelId || ''; b.owner = it.snippet?.channelTitle || b.owner; } }
    } catch { /* keep initials */ }
  }
}
/** my bookmarks: a page of its own (bottom menu) — playlists and recommended songs */
async function renderBookmarks() {
  document.title = 'ブックマーク — Share MUSIC';
  if (!Api.connected()) {
    return setApp(`<h1 class="pagetitle">ブックマーク</h1>
      <div class="sheet stack center" style="padding:32px 18px;margin-top:10px">
        <div class="empty-ic">${ICON.star}</div>
        <div class="display" style="font-size:20px">ログインするとブックマークできます</div>
        <div class="small muted">気になったプレイリストやおすすめ曲のページで ☆ を押すと、ここにまとまります。</div>
        <div><button class="btn solid" data-act="login">Googleでログイン</button></div>
      </div>`);
  }
  const tab = S.bmTab || 'pl';
  setApp(`<h1 class="pagetitle">ブックマーク</h1>
    <div class="bhead" style="margin:6px 0 14px"><div class="seg" role="tablist">
      <button class="${tab === 'pl' ? 'on' : ''}" data-act="bm-tab" data-tab="pl" role="tab">プレイリスト<span id="bmc-pl"></span></button>
      <button class="${tab === 'song' ? 'on' : ''}" data-act="bm-tab" data-tab="song" role="tab">曲<span id="bmc-song"></span></button>
    </div></div>
    <div id="bm-list" class="browse"><div class="loading" style="padding:20px 0"><span class="spinner"></span> 読み込み中…</div></div>`);
  const [pls, sgs, all] = await Promise.all([Social.loadBookmarks(true), Social.loadBookmarks(true, 's'), Songs.load()]);
  await fillOwners(pls);
  if (location.pathname !== '/bookmarks' || (S.bmTab || 'pl') !== tab) return;
  $('#bmc-pl').textContent = pls?.length ? ` ${pls.length}` : '';
  $('#bmc-song').textContent = sgs?.length ? ` ${sgs.length}` : '';
  const el = $('#bm-list');
  const empty = (what) => `<div class="sheet flat stack center" style="padding:28px 16px"><div class="empty-ic">${ICON.star}</div><div class="muted small">まだブックマークした${what}はありません。<br>${what === '曲' ? 'プレイリストの曲目やおすすめ曲のページ' : 'プレイリストのページ'}で ☆ を押すと、ここに追加されます。</div><div><button class="btn sm solid" data-act="go" data-to="/search">${what}をさがす</button></div></div>`;
  if (tab === 'pl') {
    el.innerHTML = pls?.length ? Social.grid(pls, '', { bm: false }) : empty('プレイリスト');
  } else {
    // every saved song — recommended songs (shown as they are now) and songs saved from playlists — in one playable list
    const rows = (sgs || []).map((b) => {
      if (b.vid) return { t: { id: b.vid, name: b.title, artist: b.artist, d: b.d || 0, embed: true, thumb: b.image }, src: b.pid ? `<a class="trk-src" href="/p/${esc(b.pid)}" data-act="go" data-to="/p/${esc(b.pid)}">♫ ${esc(b.ptitle || 'プレイリスト')}</a>` : '', id: b.id };
      const x = all.find((y) => y.sid === b.id) || { sid: b.id, title: b.title, artist: b.artist, by: b.by, thumb: b.image, videoId: '' };
      return { t: { id: x.videoId, name: x.title, artist: x.artist, d: x.d || 0, embed: x.embed !== false && !!x.videoId, thumb: x.art || x.thumb, isMv: x.src === 'mv' }, src: `<a class="trk-src ic-line" href="/s/${esc(x.sid)}" data-act="go" data-to="/s/${esc(x.sid)}">${Avatars.html(x.byId, x.by, 'xs')}${esc(x.by || '')}さんのおすすめ曲</a>`, id: b.id };
    }).filter((r) => r.t.id);
    // the list becomes the player's list only when you start playing here (a playlist that is already playing keeps going)
    S.bmView = { id: 'bm', p: { id: 'bm', title: 'ブックマークした曲', owner: Api.profile?.name || '', image: rows[0]?.t.thumb || '' }, tracks: rows.map((r) => r.t) };
    if (Player.idx < 0) S.view = S.bmView;
    el.innerHTML = rows.length ? `<div class="row" style="margin:2px 0 10px"><span class="small muted spacer">${rows.length}曲 ・ 曲目の ☆ やおすすめ曲のページで追加できます</span><button class="btn sm solid" data-act="bm-play-all">${ICON.play} まとめて再生</button></div>
      <ol class="tracks">${rows.map((r, i) => `<li class="trk ${Player.idx === i && S.view?.id === 'bm' ? 'now' : ''}" data-act="play" data-i="${i}" style="--i:${Math.min(i, 24)}">
        <span class="no">${pad2(i + 1)}</span>
        <span class="th">${r.t.thumb ? `<img src="${esc(r.t.thumb)}" alt="" loading="lazy">` : ''}</span>
        <span class="t"><b>${esc(r.t.name)}</b><span>${esc(r.t.artist)}</span>${r.src}</span>
        <span class="dur">${fmtDur(r.t.d)}</span>
        <button class="trk-bm on" data-act="bm-unsave" data-id="${esc(r.id)}" title="ブックマークを外す" aria-label="ブックマークを外す">${ICON.star}</button>
      </li>`).join('')}</ol>` : empty('曲');
    markNowPlaying();
  }
  fixLetterbox(el);
}
function renderSearch() {
  document.title = 'さがす — Share MUSIC';
  const tab = S.homeTab || 'pl', sort = S.gsort || 'likes';
  setApp(`
    <h1 class="pagetitle">さがす</h1>
    <section class="browse" id="browse">
      <div class="bbar">
        <input class="input" id="gq" type="search" placeholder="${tab === 'pl' ? 'タイトル・作った人で検索' : '曲名・アーティスト・投稿した人で検索'}" value="${esc(S.gq || '')}" aria-label="検索">
        <div class="bhead"><div class="seg" role="tablist">
          <button class="${tab === 'pl' ? 'on' : ''}" data-act="home-tab" data-tab="pl" role="tab">プレイリスト</button>
          <button class="${tab === 'song' ? 'on' : ''}" data-act="home-tab" data-tab="song" role="tab">おすすめ曲</button>
        </div></div>
        ${genreChips(S.genre, 'genre')}
      </div>
      <div class="bsub"><span class="small muted" id="home-count"></span>
        <div class="sortsw">${[['likes', '人気順'], ['new', '新着順']].map(([k, l]) => `<button class="${sort === k ? 'on' : ''}" data-act="home-sort" data-sort="${k}">${l}</button>`).join('')}</div></div>
      <div id="home-list"><div class="loading" style="padding:20px 0"><span class="spinner"></span> 読み込み中…</div></div>
    </section>
  `);
  $('#gq').addEventListener('input', (e) => { S.gq = e.target.value; drawHomeList(); });
  drawHomeList();
}
/** switch the browse tab / sort in place on the search page (keeps the scroll position) */
function setHomeView({ tab, sort } = {}) {
  if (tab) S.homeTab = tab; if (sort) S.gsort = sort;
  document.querySelectorAll('[data-act=home-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === (S.homeTab || 'pl')));
  document.querySelectorAll('[data-act=home-sort]').forEach((b) => b.classList.toggle('on', b.dataset.sort === (S.gsort || 'likes')));
  const q = $('#gq'); if (q) q.placeholder = (S.homeTab || 'pl') === 'pl' ? 'タイトル・作った人で検索' : '曲名・アーティスト・投稿した人で検索';
  drawHomeList();
}
/** music-app style horizontal shelves above the browse section */
function drawShelves() {
  const el = $('#shelves'); if (!el) return;
  const g = Social.gallery || [], s = Songs.list || [];
  const byLikes = (a, b) => (b.likes || 0) - (a.likes || 0) || (b.at || 0) - (a.at || 0), byNew = (a, b) => (b.at || 0) - (a.at || 0);
  const shelf = (title, body, tab, sort) => `<section class="shelf">
      <div class="shelf-h"><h2>${title}</h2>${tab ? `<button class="more" data-act="see-all" data-tab="${tab}" data-sort="${sort}">すべて見る →</button>` : ''}</div>${body}</section>`;
  const row = (items) => `<div class="shelf-row">${items}</div>`;
  const plTile = (p) => `<button class="tile" data-act="go" data-to="/p/${esc(p.id)}">
      <div class="art">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : jcard(p.title)}</div>
      <b>${esc(p.title)}</b><span class="tw">${Avatars.html(p.ownerId, p.owner, 'xs')}${esc(p.owner)}${p.likes ? ` ・ ♥ ${p.likes}` : ''}</span></button>`;
  const qp = (x) => `<div class="qrow"><button class="qmain" data-act="go" data-to="/s/${esc(x.sid)}"><img src="${esc(x.art || x.thumb)}" alt="" loading="lazy">
      <span><b>${esc(x.title)}</b><small>${esc(x.artist)}</small><small class="tw">${recLine(x, { link: false, max: 1 })}${x.likes ? ` ・ ♥ ${x.likes}` : ''}</small></span></button>
      <button class="qplay" data-act="song-play" data-sid="${esc(x.sid)}" aria-label="${esc(x.title)} を試聴">${ICON.play}</button></div>`;
  const out = [];
  if (Parties.live?.length) out.push(shelf(`<span class="live">LIVE</span> リスニングパーティー`, `<div class="shelf-row">${Parties.live.map(partyCard).join('')}</div>`));
  const fset = new Set((Follows.list || []).map((x) => x.id));
  if (fset.size) {
    const songTile = (x) => `<button class="tile" data-act="go" data-to="/s/${esc(x.sid)}"><div class="art"><img src="${esc(x.art || x.thumb)}" alt="" loading="lazy"><i class="tplay" aria-hidden="true">${ICON.play}</i></div>
      <b>${esc(x.title)}</b><span class="tw">${recLine(x, { link: false, max: 1 })}</span></button>`;
    const fresh = [...g.filter((p) => fset.has(p.ownerId)).map((p) => ({ at: p.updated || p.at || 0, html: plTile(p) })), ...s.filter((x) => recPeople(x).some((r) => fset.has(r.id))).map((x) => ({ at: x.at || 0, html: songTile(x) }))]
      .sort((a, b) => b.at - a.at).slice(0, 12);
    out.push(shelf('フォロー中の新着', fresh.length ? row(fresh.map((x) => x.html).join('')) : '<div class="sheet flat small muted center">フォローしている人の共有はまだありません。</div>'));
  }
  if (g.length) out.push(shelf('人気のプレイリスト', row([...g].sort(byLikes).slice(0, 10).map(plTile).join('')), 'pl', 'likes'));
  if (s.length) out.push(shelf('おすすめ曲', `<div class="qp">${[...s].sort(byNew).slice(0, 12).map(qp).join('')}</div>`, 'song', 'new'));
  if (g.length >= 4) out.push(shelf('新着のプレイリスト', row([...g].sort(byNew).slice(0, 10).map(plTile).join('')), 'pl', 'new'));
  const all = [...g, ...s];
  const tiles = GENRES.map(([k], i) => {
    const pic = all.find((x) => genresOf(x).includes(k)); const src = pic && (pic.image || pic.art || pic.thumb);
    return `<button class="gtile" style="--h:${GENRE_HUE[k] ?? i * 33}" data-act="genre-tile" data-g="${k}"><b>${esc(genreName(k))}</b>${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : ''}</button>`;
  }).join('');
  out.push(shelf('ジャンルから探す', `<div class="gtiles">${tiles}</div>`));
  el.innerHTML = out.join('');
  fixLetterbox(el);
}
const GENRE_HUE = { jpop: 340, rock: 225, anime: 262, citypop: 24, kpop: 318, western: 200, hiphop: 45, edm: 180, chill: 160, bgm: 140, other: 0 };
function drawHomeList() {
  const el = $('#home-list'); if (!el || location.pathname !== '/search') return;
  const tab = S.homeTab || 'pl', opt = { genre: S.genre, sort: S.gsort || 'likes', q: S.gq };
  const count = $('#home-count'), none = '<div class="sheet flat center muted small">見つかりませんでした。ジャンルや検索のことばを変えてみてください。</div>';
  if (tab === 'pl') {
    if (!Social.gallery) return Social.loadGallery().then(drawHomeList);
    const items = Social.filter(Social.gallery, opt);
    if (count) count.textContent = Social.gallery.length ? `${items.length}件` : '';
    el.innerHTML = !Social.gallery.length ? Social.grid([], 'まだ掲載されたプレイリストはありません。マイページから最初の1枚を掲載してみましょう。')
      : items.length ? Social.grid(items, '') : none;
  } else {
    if (!Songs.list) return Songs.load().then(drawHomeList);
    const items = Songs.sort(Songs.list, opt);
    if (count) count.textContent = Songs.list.length ? `${items.length}曲` : '';
    el.innerHTML = !Songs.list.length ? Songs.grid([], 'まだおすすめ曲はありません。マイページの「おすすめ曲」から投稿できます。')
      : items.length ? `<div class="stiles">${items.map((x) => Songs.tile(x)).join('')}</div>` : none;
  }
  fixLetterbox(el);
}

/* =========================================================
 * Profile page: what someone has shared
 * ======================================================= */
async function renderProfile(id) {
  setApp('<div class="loading"><span class="spinner"></span> 読み込み中…</div>');
  const [items, songs, ch] = await Promise.all([
    Social.loadGallery(true), Songs.load(true),
    Api.api('channels?' + new URLSearchParams({ part: 'snippet', id })).then((j) => j.items?.[0]?.snippet).catch(() => null),
  ]);
  if (location.pathname !== '/u/' + id) return;
  const mine = items.filter((x) => x.ownerId === id).sort((a, b) => (b.likes || 0) - (a.likes || 0));
  const mySongs = songs.filter((s) => recIs(s, id)).sort((a, b) => (b.likes || 0) - (a.likes || 0));
  const name = ch?.title || mine[0]?.owner || mySongs[0]?.by || 'ユーザー';
  const icon = ch?.thumbnails?.medium?.url || ch?.thumbnails?.default?.url || '';
  const hearts = mine.reduce((a, x) => a + (x.likes || 0), 0) + mySongs.reduce((a, x) => a + (x.likes || 0), 0);
  document.title = `${name} — Share MUSIC`;
  setApp(`
    <div class="phead">
      <div class="avatar">${icon ? `<img src="${esc(icon)}" alt="">` : '<i class="noicon"></i>'}</div>
      <h1>${esc(name)}</h1>
      <div class="fcounts" id="fcounts">${Follows.countsHtml({})}</div>
      <div class="stats">${statsHtml([mine.length, mySongs.length, hearts])}</div>
      <button class="btn sm quiet ic-line" data-act="share-profile">${ICON.link} プロフィールを共有</button>
      <button class="btn sm solid followbtn" id="follow-btn" data-act="follow" data-id="${esc(id)}" data-name="${esc(name)}">＋ フォローする</button>
    </div>
    <div class="bio-box" id="bio-box"></div>
    <div id="prof-own"></div>
    <div id="prof-extra"></div>
    <div class="label"><b>◎</b> 共有しているプレイリスト</div>
    ${Social.grid(mine, 'まだ共有しているプレイリストはありません。', { owner: false })}
    <div class="label"><b>♪</b> おすすめ曲</div>
    ${Songs.grid(mySongs, 'まだおすすめ曲はありません。')}
    <div class="label"><b>${ICON.chat}</b> つぶやき</div>
    <div id="prof-posts"><div class="loading" style="padding:14px 0"><span class="spinner"></span></div></div>
    <div class="row" style="margin-top:24px"><button class="btn quiet sm" data-act="go" data-to="/">← トップへ</button></div>
  `);
  Bio.mount(id, false);
  for (const fn of Hooks.profile) { try { fn(id, { isMe: false }); } catch (e) { console.error(e); } }
  Posts.get('/api/posts?by=' + encodeURIComponent(id)).then((j) => {
    const el = $('#prof-posts'); if (!el || location.pathname !== '/u/' + id) return;
    Posts.remember(j.items);
    el.innerHTML = j.items.length ? j.items.map((p) => Posts.card(p)).join('') : '<div class="sheet flat center small muted">まだつぶやきはありません。</div>';
    fixLetterbox(el);
  }).catch(() => {});
  Follows.counts(id).then((c) => { const el = $('#fcounts'); if (el && location.pathname === '/u/' + id) el.innerHTML = Follows.countsHtml(c); });
  if (Api.connected()) Follows.load().then(() => { const b = $('#follow-btn'); if (b) Follows.draw(b); });
  if (Api.connected() && (await Api.myId()) === id) {
    $('#follow-btn')?.remove();
    const el = $('#prof-own'); if (el) el.innerHTML = '<div class="note accent row wrap-ok"><span class="spacer">これはあなたのプロフィールです。</span><button class="btn sm solid" data-act="go" data-to="/me">マイページへ</button></div>';
  }
}

/* =========================================================
 * My page: shared / my playlists / songs / bookmarks / settings
 * ======================================================= */
/** my numbers for the profile head, whatever tab is open */
async function loadMyStats() {
  const [gal, songs, myId] = await Promise.all([Social.loadGallery(), Songs.load(), Api.myId()]);
  const el = $('#me-stats'); if (!el || !myId) return;
  Follows.counts(myId).then((c) => { const f = $('#fcounts'); if (f) f.innerHTML = Follows.countsHtml(c); });
  const mine = gal.filter((x) => x.ownerId === myId), mySongs = songs.filter((x) => recIs(x, myId));
  el.innerHTML = statsHtml([mine.length, mySongs.length, [...mine, ...mySongs].reduce((a, x) => a + (x.likes || 0), 0)]);
}
function statsHtml([pl, so, hearts]) {
  return [[pl, 'プレイリスト'], [so, 'おすすめ曲'], [hearts, 'もらったいいね']].map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join('');
}
function renderMe() {
  document.title = 'マイページ — Share MUSIC';
  if (!Api.connected()) {
    return setApp(`
      <div class="label"><b>♪</b> マイページ</div>
      <div class="sheet stack center" style="padding:32px 18px">
        <div class="display" style="font-size:22px">ログインしてください</div>
        <div class="small muted">マイページでは、プレイリストやおすすめ曲の共有（みんなのページへの掲載）、ブックマーク、表示設定をまとめて管理できます。</div>
        <div><button class="btn solid" data-act="login">Googleでログイン</button></div>
      </div>`);
  }
  const pr = Api.profile || {};
  if (S.meTab !== 'set') S.meTab = 'shared';
  const tab = S.meTab || 'shared';
  const tabs = [['shared', '共有中'], ['set', '設定']];
  setApp(`
    <div class="phead">
      <div class="avatar">${pr.icon ? `<img src="${esc(pr.icon)}" alt="">` : '<i class="noicon"></i>'}</div>
      <h1>${esc(pr.name || 'マイページ')}</h1>
      <div class="fcounts" id="fcounts">${Follows.countsHtml({})}</div>
      <div class="stats" id="me-stats">${statsHtml(['–', '–', '–'])}</div>
      <div class="row wrap-ok me-links">${pr.id ? `<a class="btn sm" href="/u/${esc(pr.id)}" data-act="go" data-to="/u/${esc(pr.id)}">公開プロフィール</a>` : ''}<a class="btn sm" href="/bookmarks" data-act="go" data-to="/bookmarks">${ICON.star} ブックマーク</a><a class="btn sm" href="/#listen" data-act="go" data-to="/#listen">${ICON.phones} 聴く</a></div>
    </div>
    <div class="bio-box" id="bio-box"></div>
    <div id="prof-extra"></div>
    <div class="metabs scroll" role="tablist">${tabs.map(([k, l]) => `<button role="tab" class="${tab === k ? 'on' : ''}" data-act="me-tab" data-tab="${k}">${l}</button>`).join('')}</div>
    <div id="me-body"></div>
  `);
  drawMeTab();
  loadMyStats();
  if (pr.id) for (const fn of Hooks.profile) { try { fn(pr.id, { isMe: true }); } catch (e) { console.error(e); } }
  Bio.mount(pr.id, true);
  if (!pr.id) Api.myId().then((id) => { if (id && location.pathname === '/me') renderMe(); });
}
/** the panel shown in #me-body: My Page tabs (shared / set) or the share pages (pl / song) */
function curTab() {
  const p = location.pathname;
  if (p === '/share/pl') return 'pl';
  if (p === '/share/song') return 'song';
  return p === '/me' ? (S.meTab === 'set' ? 'set' : 'shared') : '';
}
async function drawMeTab() {
  const tab = curTab(), body = $('#me-body'); if (!body || !tab) return;
  const stillHere = () => curTab() === tab && $('#me-body');
  if (tab === 'set') {
    const pr = Api.profile || {};
    body.innerHTML = `
      <div class="label"><b>01</b> 配色</div>
      <div data-theme-panel>${Theme.body()}</div>
      <div class="label"><b>02</b> アカウント</div>
      <div class="sheet flat stack">
        <div class="row"><span class="spacer small">YouTube チャンネル：<b>${esc(pr.name || '')}</b></span><button class="btn sm" data-act="logout">ログアウト</button></div>
        <div class="small muted">このアプリに与えた YouTube へのアクセス許可は、<a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">Google アカウントの設定</a>からいつでも取り消せます。</div>
      </div>
      <div class="label"><b>03</b> この端末のデータ</div>
      <div class="sheet flat stack">
        <div class="row wrap-ok"><span class="spacer small">最近見たプレイリストの履歴（${Recent.list().length}件）</span><button class="btn sm" data-act="clear-recent">履歴を消す</button></div>
        <div class="row wrap-ok"><span class="spacer small">曲名の日本語化・MVの検索結果のキャッシュ</span><button class="btn sm" data-act="clear-cache">キャッシュを消す</button></div>
        <div class="row wrap-ok"><span class="spacer small">ログイン前の「警告画面の説明」</span><button class="btn sm" data-act="guide-reset">${store.get('guide-skip') ? 'もう一度表示する' : '表示中'}</button></div>
      </div>
      <div class="label"><b>04</b> その他</div>
      <div class="row wrap-ok"><a class="btn sm" href="/#help" data-act="go" data-to="/#help">使い方</a><a class="btn sm" href="/about">このアプリについて</a><a class="btn sm" href="/privacy">プライバシーポリシー</a></div>`;
    return;
  }
  if (tab === 'bm') {
    body.innerHTML = '<div class="loading"><span class="spinner"></span> 読み込み中…</div>';
    const items = await Social.loadBookmarks(true);
    if (!stillHere()) return;
    body.innerHTML = `<div class="small muted" style="margin:18px 0 14px">ブックマークしたプレイリストです。プレイリストのページの「☆ ブックマーク」で追加・解除できます。</div>
      ${Social.grid(items || [], 'まだブックマークはありません。', { bm: false })}`;
    fixLetterbox(body); return;
  }
  if (tab === 'song') {
    body.innerHTML = '<div class="loading"><span class="spinner"></span> 読み込み中…</div>';
    const [all, myId] = await Promise.all([Songs.load(true), Api.myId()]);
    if (!stillHere()) return;
    const mine = all.filter((s) => recIs(s, myId));
    body.innerHTML = `<div class="small muted" style="margin:18px 0 14px">好きな曲を検索して選び、ジャンルと紹介文をつけてトップページの「おすすめ曲」に掲載できます。</div>
      ${Songs.formHtml()}
      <div class="label"><b>♪</b> 掲載中のおすすめ曲（${mine.length}）</div>
      ${Songs.grid(mine, 'まだ投稿した曲はありません。', { mine: true })}`;
    fixLetterbox(body); return;
  }
  // shared / my playlists
  if (!S.mine) {
    body.innerHTML = '<div class="loading"><span class="spinner"></span> プレイリストを読み込み中…</div>';
    if (!S.mineLoading) loadMine();
    return;
  }
  const gal = await Social.loadGallery();
  if (!stillHere()) return;
  const listed = new Map(gal.map((g) => [g.id, g]));
  const shared = S.mine.filter((p) => listed.has(p.id));
  const row = (p) => {
    const g = listed.get(p.id);
    return `<div class="myrow">
      <div class="cover">${(g?.image || p.image) ? `<img src="${esc(g?.image || p.image)}" alt="" loading="lazy">` : jcard(p.title)}</div>
      <div class="info">
        <b>${esc(g?.title || p.title)}</b>
        <div class="tags">${g ? `<span class="priv pub">共有中</span>${genreTags(g)}<span class="bmc">♥ ${g.likes || 0}</span><span class="ccount">${ICON.comment}${g.comments || 0}</span>` : `<span class="priv ${p.privacy}">${PRIV[p.privacy]?.tag || ''}</span>`}<span class="cnt">${p.count != null ? pad2(p.count) + ' TRACKS' : ''}</span></div>
        <div class="acts">${g
          ? `<button class="btn sm solid" data-act="go" data-to="/#share=${esc(p.id)}">✎ 編集</button><button class="btn sm" data-act="go" data-to="/p/${esc(p.id)}">ページを見る</button><button class="btn sm quiet" data-act="copy-text" data-text="${esc(shareLink(p.id, g.look))}">リンクをコピー</button>`
          : `<button class="btn sm accent" data-act="go" data-to="/#share=${esc(p.id)}">共有する</button>`}</div>
      </div></div>`;
  };
  if (tab === 'shared') {
    const [songs, myId] = await Promise.all([Songs.load(true), Api.myId()]);
    if (!stillHere()) return;
    const mySongs = songs.filter((x) => recIs(x, myId));
    const hearts = shared.reduce((a, p) => a + (listed.get(p.id).likes || 0), 0) + mySongs.reduce((a, x) => a + (x.likes || 0), 0);
    const stats = $('#me-stats'); if (stats) stats.innerHTML = statsHtml([shared.length, mySongs.length, hearts]);
    body.innerHTML = `<div class="label"><b>◎</b> プレイリスト（${shared.length}）</div>
      ${shared.length ? `<div class="mylist">${shared.map(row).join('')}</div>` : `<div class="sheet flat stack center" style="padding:20px 16px"><div class="muted small">まだ共有しているプレイリストはありません。</div><div><button class="btn sm accent" data-act="go" data-to="/share/pl">プレイリストを選んで共有する</button></div></div>`}
      <div class="label"><b>♪</b> おすすめ曲（${mySongs.length}）</div>
      ${mySongs.length ? Songs.grid(mySongs, '') : `<div class="sheet flat stack center" style="padding:20px 16px"><div class="muted small">まだ投稿したおすすめ曲はありません。</div><div><button class="btn sm accent" data-act="go" data-to="/share/song">おすすめ曲を投稿する</button></div></div>`}
      <div class="hint">プレイリストは「✎ 編集」から、おすすめ曲は曲のページの「✎ 編集」から、内容の変更や掲載の取りやめができます。</div>
      <div class="row wrap-ok" style="margin-top:14px"><button class="btn sm" data-act="go" data-to="/share/pl">＋ プレイリストを共有</button><button class="btn sm" data-act="go" data-to="/share/song">＋ おすすめ曲を投稿</button></div>
      <div class="label"><b>${ICON.user}</b> フォロー中<span id="fl-n"></span></div><div id="fl-list" class="fl-list"><span class="tiny muted">読み込み中…</span></div>`;
    Follows.load(true).then((l) => { const el = $('#fl-list'); if (!el) return; $('#fl-n').textContent = `（${l?.length || 0}）`;
      el.innerHTML = l?.length ? l.map((x) => Avatars.chip(x.id, x.name, { cls: 'lg' })).join('') : '<div class="small muted">まだ誰もフォローしていません。気になる人のプロフィールで「＋ フォローする」を押すと、その人の新しい共有がホームに出ます。</div>'; });
  } else {
    body.innerHTML = S.mine.length ? `<div class="small muted" style="margin:18px 0 14px">あなたの YouTube Music のプレイリストです。「共有する」を押すと、タイトル・紹介文・ジャンル・カバー画像・見た目を設定して、みんなのプレイリストに掲載できます。</div>
      <div class="mylist">${S.mine.map(row).join('')}</div>
      <div class="row" style="margin-top:20px"><span class="spacer"></span><button class="btn quiet sm" data-act="reload">再読み込み</button></div>`
      : '<div class="sheet flat center muted" style="margin-top:18px">プレイリストがありません。YouTube Musicでプレイリストを作ってから、もう一度開いてください。</div>';
  }
  fixLetterbox(body);
}
async function loadMine() {
  S.mineLoading = true;
  try { S.mine = await Api.myPlaylists(); } catch (e) { toast(errText(e), 5000); S.mine = []; if (e instanceof AuthError) { S.mineLoading = false; return route(); } }
  S.mineLoading = false;
  if (curTab() && !location.hash) drawMeTab();
}
function resumeNote() {
  const job = store.get('copyjob');
  if (!job || job.done) return '';
  return `<div class="note accent row wrap-ok" style="margin-top:16px"><span class="spacer">「${esc(job.title)}」のコピーが途中です（${job.added} / ${job.ids.length}曲）</span><button class="btn sm solid" data-act="go" data-to="/p/${esc(job.src)}">続きを見る</button></div>`;
}

/* =========================================================
 * Share form: publish a playlist to "みんなのプレイリスト"
 * ======================================================= */
async function renderShare(id) {
  if (!Api.connected()) { toast('ログインしてください'); history.replaceState(null, '', '/me'); return route(); }
  setApp(`${backBtn()}<div class="loading"><span class="spinner"></span> 読み込み中…</div>`);
  let p = S.mine?.find((x) => x.id === id);
  try { if (!p) p = await Api.playlist(id, true); } catch (e) { toast(errText(e), 5000); }
  if (!p) return setApp(`${backBtn()}<div class="sheet flat" style="margin-top:16px">プレイリストが見つかりませんでした。</div>`);
  const [cv, st] = await Promise.all([Cover.version(id), Social.status(id)]);
  const look = st.look || store.get('look.' + id, 'vinyl');
  S.edit = { ...p, image: cv ? Cover.url(id, cv) : (p.ytImage || p.image), customCover: !!cv, listed: !!st.listed };
  p = S.edit;
  document.title = `${p.title} — 共有`;
  setApp(`
    ${backBtn()}
    <div class="plhead">
      <div class="art">${p.image ? `<img src="${esc(p.image)}" alt="">` : jcard(p.title)}</div>
      <div style="min-width:0"><div class="eyebrow">${p.listed ? 'Shared · 共有中' : 'Share · みんなに共有'}</div><h1>${esc(p.title)}</h1>
        <div class="row wrap-ok" style="margin-top:10px"><button class="btn sm" data-act="go" data-to="/p/${esc(p.id)}">${p.listed ? 'ページを見る' : 'ページをプレビュー'}</button>${p.listed ? `<button class="btn sm quiet" data-act="copy-text" data-text="${esc(shareLink(p.id))}">リンクをコピー</button>` : ''}</div></div>
    </div>
    ${st.hidden ? '<div class="note bad" style="margin-top:16px">このプレイリストは運営により非公開になっています。</div>' : ''}

    <div class="label"><b>01</b> タイトル</div>
    <input class="input" id="sh-title" maxlength="150" value="${esc(p.title)}">
    <div class="label"><b>02</b> 紹介文</div>
    <textarea class="textarea" id="sh-desc" maxlength="500" placeholder="例：夜のドライブ用。後半にかけてテンポが上がっていきます。">${esc(st.desc || p.description)}</textarea>
    <div class="hint">タイトルと紹介文は、YouTube Music のプレイリストにも反映されます。</div>
    <div class="label"><b>03</b> ジャンル</div>
    ${genrePicker('sh-genres', st.genres || [])}
    <div class="hint">1〜3つ選んでください（必須）。</div>
    <div class="label"><b>04</b> カバー画像</div>
    <div class="covercard">
      <div class="thumb">${p.image ? `<img src="${esc(p.image)}" alt="">` : jcard(p.title)}</div>
      <div><div class="small">${p.customCover ? 'このアプリで設定した画像を使っています。' : 'YouTube のプレイリストの画像を使っています。'}</div>
        <div style="margin-top:8px"><button class="btn sm" data-act="cover-edit">画像を変更</button></div></div>
    </div>
    <div class="label"><b>05</b> 曲目</div>
    <div id="trk-edit"></div>
    ${p.privacy === 'private' ? '<div class="note warn small" style="margin-top:16px">このプレイリストは YouTube で「非公開」です。共有すると、自動で<b>「限定公開」</b>（リンクを知っている人だけが見られる設定）に切り替わります。</div>' : ''}
    <div class="dock" style="position:static;border-top:0;padding-top:20px">
      <button class="btn lg accent" data-act="share-save" ${st.hidden ? 'disabled' : ''}>${p.listed ? '変更を保存する' : 'みんなのプレイリストに共有する'}</button>
      ${p.listed ? '<div class="center" style="margin-top:10px"><button class="btn quiet sm" data-act="share-stop">共有をやめる</button></div>' : ''}
    </div>
  `);
  TrackEditor.load(p);
}
/* =========================================================
 * Track list on the share form (read-only: songs are edited in the YouTube Music app)
 * ======================================================= */
const TrackEditor = {
  pl: null, items: null,
  async load(p) {
    this.pl = p; this.items = null; this.draw();
    try { this.items = await Api.tracks(p.id, true); } catch (e) { toast(errText(e), 5000); this.items = []; }
    if (S.edit?.id === p.id) this.draw();
  },
  draw() {
    const el = $('#trk-edit'); if (!el) return;
    if (!this.items) { el.innerHTML = '<div class="loading" style="padding:16px 0"><span class="spinner"></span> 曲目を読み込み中…</div>'; return; }
    el.innerHTML = `<div class="small muted" style="margin-bottom:8px">${this.items.length}曲 ・ 曲の追加・削除・並び替えは YouTube Music アプリで行ってください（このページにも自動で反映されます）。</div>
      <ol class="te-list">${this.items.map((t, i) => `<li class="te-row ro">
        <span class="no">${pad2(i + 1)}</span>
        <span class="th">${t.thumb ? `<img src="${esc(t.thumb)}" alt="" loading="lazy">` : ''}</span>
        <span class="t"><b>${esc(t.name)}</b><span>${esc(t.artist)}</span></span>
        <span class="dur">${fmtDur(t.d)}</span></li>`).join('') || '<li class="small muted" style="padding:10px 0">曲が入っていません。YouTube Music アプリで曲を追加してください。</li>'}</ol>`;
  },
};

async function saveShare(btn) {
  const p = S.edit;
  const title = $('#sh-title').value.trim(), desc = $('#sh-desc').value, genres = pickedGenres('sh-genres'), look = 'vinyl';
  if (!title) return toast('タイトルを入力してください');
  if (!genres.length) { $('#sh-genres').classList.add('need'); $('#sh-genres').scrollIntoView({ behavior: 'smooth', block: 'center' }); return toast('ジャンルを1つ以上選んでください'); }
  let privacy = p.privacy;
  if (privacy === 'private') {
    if (!confirm('YouTube のプレイリストを「限定公開」に切り替えて共有します。よろしいですか？')) return;
    privacy = 'unlisted';
  }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 保存しています…';
  try {
    if (title !== p.title || desc !== p.description || privacy !== p.privacy) {
      const np = await Api.updatePlaylist(p, { title, privacy, description: desc });
      if (S.mine) S.mine = S.mine.map((x) => (x.id === np.id ? { ...x, ...np, image: x.image } : x));
    }
    store.set('look.' + p.id, look);
    await Social.publish(p.id, { genres, desc, look });
    Social.gallery = null;
    toast(p.listed ? '変更を保存しました' : 'みんなのプレイリストに共有しました');
    S.meTab = 'shared'; go('/me');
  } catch (e) { toast(errText(e), 6000); btn.disabled = false; btn.textContent = p.listed ? '変更を保存する' : 'みんなのプレイリストに共有する'; }
}
async function stopShare(btn) {
  if (!confirm('みんなのプレイリストへの共有をやめますか？（いいねやコメントは残ります）')) return;
  btn.disabled = true;
  try { await Social.setListed(S.edit.id, false); toast('共有をやめました'); go('/share/pl'); }
  catch (e) { toast(errText(e), 5000); btn.disabled = false; }
}

async function renderViewer(id) {
  if (S.view?.id === id && S.view.tracks) return drawViewer();
  if (Player.idx >= 0) Player.close();
  S.view = { id }; S.look = null;
  setApp('<div class="loading"><span class="spinner"></span> プレイリストを読み込み中…</div>');
  try {
    let p = await Api.playlist(id), viaAuth = false;
    if (!p && Api.connected()) { p = await Api.playlist(id, true).catch(() => null); viaAuth = !!p; } // owner preview of a private playlist
    if (!p) {
      return setApp(`<div class="sheet stack" style="margin-top:28px"><b>このプレイリストは表示できません</b><div class="small muted">非公開になっているか、削除された可能性があります。共有した人に「限定公開」になっているか確認してもらってください。</div></div>`);
    }
    const [tracks, cv] = await Promise.all([Api.tracks(id, viaAuth), Cover.version(id)]);
    if (cv) p.image = Cover.url(id, cv);
    S.view = { id, p, tracks };
    drawViewer();
  } catch (e) {
    console.error(e);
    setApp(`<div class="sheet stack" style="margin-top:28px"><b>読み込めませんでした</b><div class="small muted">${esc(errText(e))}</div><div><button class="btn sm" data-act="reload-view">もう一度読み込む</button></div></div>`);
  }
}
function drawViewer() {
  const { p, tracks } = S.view;
  document.title = `${p.title} — Share MUSIC`;
  const total = tracks.reduce((a, t) => a + (t.d || 0), 0);
  const job = store.get('copyjob');
  const jobHere = job && job.src === p.id && !job.done;
  const look = S.look || Deck.look(); S.look = look;
  Recent.add(p);
  setApp(`
    <div class="vhead">
      <div class="deckwrap">${Deck.html(p, look)}</div>
      <div class="vmeta">
        <div class="eyebrow">Playlist · ${pad2(tracks.length)} tracks · ${fmtTotal(total)}</div>
        <h1>${esc(p.title)}</h1>
        <div class="by"><span class="by-l">作った人</span>${Avatars.chip(p.ownerId, p.owner, { cls: 'lg' })}</div>
        <div class="row wrap-ok" style="margin-top:10px"><span class="gtag" id="genre-tag" hidden></span><span class="listed" id="listed" hidden>共有中</span></div>
      </div>
    </div>
    <div class="vactions">
      <button class="playbig" data-act="play-all" ${tracks.length ? '' : 'disabled'} aria-label="このページで再生">${ICON.play}</button>
      <span id="like-slot"></span>
      <button class="ibtn bmbtn ${Social.isBm(p.id) ? 'on' : ''}" data-act="bm" id="bm-btn" title="ブックマーク" aria-label="ブックマーク">${ICON.star}<em></em></button>
      <button class="ibtn" data-act="share-img" title="シェア画像" aria-label="シェア画像">${ICON.image}</button>
      <button class="ibtn" data-act="copy-page" title="共有・リンクをコピー" aria-label="共有・リンクをコピー">${ICON.link}</button>
      <button class="ibtn" data-act="pty-from-view" title="このプレイリストでパーティーを開く" aria-label="パーティーを開く">${ICON.party}</button>
      <button class="ibtn subtle" data-act="report" data-kind="p" title="通報" aria-label="運営に通報">${ICON.flag}</button>
      <span class="spacer"></span><span id="owner-slot"></span>
    </div>
    ${p.description ? `<div class="intro">${esc(p.description)}</div>` : ''}
    <a class="btn accent ytm-open" href="${ytmPlaylistUrl(p.id)}" target="_blank" rel="noopener">YouTube Music で開いて保存 ${ICON.ext}</a>
    <div class="hint">YouTube Music で開いたら「ライブラリに保存」を押すと、自分のライブラリに追加できます。
      <button class="btn quiet sm" style="padding:0;vertical-align:baseline;text-decoration:underline" data-act="copy-start">自分のアカウントにコピーを作る</button>（Googleでログインします）</div>
    ${jobHere ? `<div class="note accent row wrap-ok" style="margin-top:12px"><span class="spacer">コピーが途中です（${job.added} / ${job.ids.length}曲）</span><button class="btn sm solid" data-act="copy-resume">続きから</button></div>` : ''}

    <div class="label"><b>♪</b> 曲目</div>
    ${tracks.length >= 8 ? `<div class="trk-find"><span class="trk-find-i">${ICON.search}</span><input class="input" id="trk-q" type="search" placeholder="このプレイリストの曲をさがす（曲名・アーティスト）" aria-label="曲をさがす"><span class="tiny muted" id="trk-n"></span></div>` : ''}
    <ol class="tracks">${tracks.map((t, i) => `<li class="trk ${t.embed ? '' : 'noembed'} ${Player.idx === i ? 'now' : ''}" data-act="play" data-i="${i}" style="--i:${Math.min(i, 24)}">
      <span class="no">${Player.idx === i ? '<span class="eq"><i></i><i></i><i></i></span>' : pad2(i + 1)}</span>
      <span class="th">${t.thumb ? `<img src="${esc(t.thumb)}" alt="" loading="lazy">` : ''}</span>
      <span class="t"><b>${esc(t.name)}</b><span>${esc(t.artist)}</span></span>
      <span class="dur">${fmtDur(t.d)}${t.embed ? '' : '<em class="mvtag">MV</em>'}</span>
      <button class="trk-bm ${Social.isBm(t.id, 't') ? 'on' : ''}" data-act="tbm" data-i="${i}" title="ブックマーク" aria-label="${esc(t.name)} をブックマーク">${ICON.star}</button>
      <button class="trk-rec" data-act="trk-rec" data-i="${i}" title="おすすめ曲に投稿" aria-label="${esc(t.name)} をおすすめ曲に投稿">${ICON.plus}</button>
    </li>`).join('')}</ol>
    ${tracks.length ? '' : '<div class="sheet flat center muted">曲が入っていません</div>'}
    ${tracks.some((t) => !t.embed) ? '<div class="hint">「MV」の印がある曲は、権利者の設定により音源をこのページで再生できないため、代わりにMVを探して再生します。</div>' : ''}
    <div class="label"><b>${ICON.comment}</b> コメント<span id="cmt-count"></span></div>
    <div id="comments"><div class="loading" style="padding:16px 0"><span class="spinner"></span></div></div>
    <div class="hint" style="margin-top:28px">このページは Share MUSIC で作られました。<a href="/">みんなのプレイリストを見る</a></div>
  `);
  if (Player.idx >= 0) { Deck.setTrack(tracks[Player.idx]); Deck.setPlaying(Player.playing); Player.tick(); }
  if (Api.connected()) Social.loadBookmarks(false, 's').then(() => document.querySelectorAll('.trk-bm').forEach((b) => b.classList.toggle('on', Social.isBm(S.view?.tracks?.[+b.dataset.i]?.id, 't'))));
  $('#trk-q')?.addEventListener('input', (e) => {
    const k = e.target.value.normalize('NFKC').toLowerCase().trim(); let n = 0;
    document.querySelectorAll('.trk').forEach((row) => { const hit = !k || row.querySelector('.t').textContent.normalize('NFKC').toLowerCase().includes(k); row.hidden = !hit; if (hit) n++; });
    $('#trk-n').textContent = k ? `${n}曲` : '';
  });
  if (S.autoplay) { S.autoplay = false; if (Player.idx < 0) setTimeout(() => $('[data-act=play-all]')?.click(), 50); }
  decorateViewer(p);
  if (!S.view.localized) {
    S.view.localized = true;
    const view = S.view;
    Localize.run(tracks, (i) => {
      if (S.view !== view) return;
      const row = document.querySelector(`.trk[data-i="${i}"] .t`);
      if (row) { row.querySelector('b').textContent = tracks[i].name; row.querySelector('span').textContent = tracks[i].artist; row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); }
      if (Player.idx === i) Player.drawTitle();
    });
  }
}
/* =========================================================
 * Recommended song page (/s/<sid>): record deck, player (MV / lyrics), likes, comments
 * ======================================================= */
async function renderSong(sid) {
  if (S.view?.id === 's:' + sid && S.view.tracks) return drawSong();
  // coming from the in-place preview of this same song: keep it playing
  const keep = S.view?.kind === 'dsc' && S.view.song?.sid === sid && Player.idx >= 0 && Player.track === S.view.tracks?.[0] ? S.view.tracks[0] : null;
  if (!keep && Player.idx >= 0) Player.close();
  S.view = { id: 's:' + sid }; S.look = 'vinyl';
  setApp('<div class="loading"><span class="spinner"></span> 曲を読み込み中…</div>');
  const list = await Songs.load(true);
  if (location.pathname !== '/s/' + sid) return;
  const so = list.find((x) => x.sid === sid);
  if (!so) return setApp(`<div class="sheet stack" style="margin-top:28px"><b>この曲は見つかりませんでした</b><div class="small muted">削除されたか、非公開になった可能性があります。</div><div><button class="btn sm" data-act="go-songs">おすすめ曲の一覧へ</button></div></div>`);
  const p = { id: so.sid, title: so.title, owner: so.by, ownerId: so.byId, image: so.art || `https://i.ytimg.com/vi/${so.videoId}/hqdefault.jpg`, description: so.desc || '' };
  const t = keep || { id: so.videoId, name: so.title, artist: so.artist, d: so.d || 0, embed: so.embed !== false, thumb: so.thumb, isMv: so.src === 'mv' };
  S.view = { id: 's:' + sid, kind: 's', p, tracks: [t], song: so };
  drawSong();
  if (so.src !== 'audio') upgradeToAudio(t, so);
}
/** older posts (or songs only found as an MV) play their MV: look for the CD audio and use it when found */
async function upgradeToAudio(t, so) {
  try {
    const r = await fetch('/api/song-match?' + new URLSearchParams({ r: '3', t: so.title, a: so.artist, d: String(so.d || 0) }));
    const j = r.ok ? await r.json() : {};
    if (j.kind !== 'audio' || !j.videoId || j.videoId === t.id || Player.idx >= 0) return;
    MV.remember(j.videoId, t.id); // the original upload stays reachable with the MV button
    Object.assign(t, { id: j.videoId, embed: true, isMv: false, d: j.d || t.d });
  } catch { /* keep the MV */ }
}
function drawSong() {
  const { p, song: so, tracks } = S.view;
  document.title = `${so.title} — ${so.artist} | Share MUSIC`;
  setApp(`
    <div class="vhead">
      <div class="deckwrap">${Deck.html(p, 'vinyl')}</div>
      <div class="vmeta">
        <div class="eyebrow">Recommended${so.d ? ' · ' + fmtDur(so.d) : ''}</div>
        <h1>${esc(so.title)}</h1>
        <div class="song-artist">${esc(so.artist)}</div>
        <div class="by"><span class="by-l">おすすめした人${recPeople(so).length > 1 ? `（${recPeople(so).length}人）` : ''}</span>${recPeople(so).map((x) => Avatars.chip(x.id, x.name, { cls: 'lg' })).join('')}</div>
        <div id="also-slot" class="also-slot"></div>
        <div class="row wrap-ok" style="margin-top:10px">${genreTags(so)}</div>
      </div>
    </div>
    <div class="vactions">
      <button class="playbig" data-act="play-all" aria-label="このページで再生">${ICON.play}</button>
      <button class="ibtn mvbtn" data-act="play-mv" title="MVを見る">MV</button>
      ${Likes.btn('s', so.sid, so.likes)}
      <button class="ibtn bmbtn ${Social.isBm(so.sid, 's') ? 'on' : ''}" data-act="sbm" id="sbm-btn" title="ブックマーク" aria-label="ブックマーク">${ICON.star}<em></em></button>
      <button class="ibtn" data-act="share-img" title="シェア画像" aria-label="シェア画像">${ICON.image}</button>
      <button class="ibtn" data-act="copy-page" title="共有・リンクをコピー" aria-label="共有・リンクをコピー">${ICON.link}</button>
      <button class="ibtn subtle" data-act="report" data-kind="s" title="通報" aria-label="運営に通報">${ICON.flag}</button>
      <span class="spacer"></span><span id="song-owner"></span>
    </div>
    <div id="song-edit"></div>
    <div id="song-moment"></div><div id="song-reacts"></div>
    ${so.desc ? `<div class="intro">${esc(so.desc)}</div>` : ''}
    ${(so.also || []).some((x) => x.desc) ? `<div class="label"><b>♪</b> みんなのおすすめポイント</div><div class="alsonotes">${(so.also || []).filter((x) => x.desc).map((x) => `<div class="alsonote">${Avatars.chip(x.id, x.name)}<p>${esc(x.desc)}</p></div>`).join('')}</div>` : ''}
    <a class="btn accent ytm-open" href="https://music.youtube.com/watch?v=${esc(so.videoId)}" target="_blank" rel="noopener">YouTube Music で開く ${ICON.ext}</a>
    <div class="hint">再生すると、下の再生パネルの「MV」でMVに切り替えたり、「歌詞」で歌詞を表示したりできます。${tracks[0].embed ? '' : 'この曲の音源はこのページで再生できないため、MVを探して再生します。'}</div>
    <div class="label"><b>${ICON.comment}</b> コメント<span id="cmt-count"></span></div>
    <div id="comments"><div class="loading" style="padding:16px 0"><span class="spinner"></span></div></div>
    <div class="row" style="margin-top:24px"><button class="btn quiet sm" data-act="go-songs">← おすすめ曲の一覧へ</button></div>
  `);
  if (Player.idx >= 0) { Deck.setTrack(tracks[Player.idx]); Deck.setPlaying(Player.playing); Player.tick(); }
  Comments.mount('s', so.sid, true);
  $('#comments')?.insertAdjacentHTML('afterend', '<div id="song-spread"></div>');
  for (const fn of Hooks.song) { try { fn(so, S.view); } catch (e) { console.error(e); } }
  Recent.add({ id: so.sid, title: so.title, owner: so.artist, image: so.art || so.thumb }, 's');
  const view = S.view;
  const alsoBtn = (joined) => `<button class="btn sm ${joined ? '' : 'solid'} alsobtn" data-act="also" data-joined="${joined ? 1 : 0}">${joined ? '✓ あなたもおすすめ中' : '＋ 私もおすすめ'}</button>`;
  const slot = $('#also-slot');
  if (!Api.connected()) { if (slot) slot.innerHTML = alsoBtn(false); }
  else Api.myId().then((me) => { const sl = $('#also-slot'); if (sl && S.view === view && me !== so.byId) sl.innerHTML = alsoBtn(recIs(so, me)); });
  if (Api.connected()) Api.myId().then((me) => {
    if (me !== so.byId || S.view !== view) return;
    const el = $('#song-owner'); if (el) el.innerHTML = '<button class="btn sm solid" data-act="song-edit">✎ 編集</button>';
  });
  if (Api.connected()) Social.loadBookmarks(false, 's').then(() => { const b = $('#sbm-btn'); if (b) b.classList.toggle('on', Social.isBm(so.sid, 's')); });
}
/** owner-only edit form on the song page */
const SongEdit = {
  open() {
    const so = S.view.song, el = $('#song-edit'); if (!el) return;
    el.innerHTML = `<div class="sheet stack" style="margin-top:18px">
      <b>おすすめ曲を編集</b>
      <label class="small muted">曲名</label><input class="input" id="se-title" maxlength="120" value="${esc(so.title)}">
      <label class="small muted">アーティスト</label><input class="input" id="se-artist" maxlength="80" value="${esc(so.artist)}">
      <label class="small muted">ジャンル（必須・3つまで）</label>${genrePicker('se-genres', genresOf(so))}
      <label class="small muted">紹介文</label><textarea class="textarea" id="se-desc" maxlength="300">${esc(so.desc || '')}</textarea>
      <div class="row wrap-ok"><button class="btn quiet sm danger" data-act="song-page-del">この曲の掲載を削除</button><span class="spacer"></span><button class="btn quiet sm" data-act="song-edit-cancel">やめる</button><button class="btn accent" data-act="song-edit-save">保存</button></div>
    </div>`;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  async save(btn) {
    const so = S.view.song, genres = pickedGenres('se-genres');
    if (!genres.length) { $('#se-genres').classList.add('need'); return toast('ジャンルを1つ以上選んでください'); }
    btn.disabled = true;
    try {
      const h = await Social.headers(); if (!h) throw new AuthError('ログインしてください');
      const r = await fetch('/api/songs?sid=' + encodeURIComponent(so.sid), { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: $('#se-title').value.trim(), artist: $('#se-artist').value.trim(), desc: $('#se-desc').value.trim(), genres }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || '保存できませんでした');
      Object.assign(so, j.item); S.view.p.title = so.title; S.view.tracks[0].name = so.title; S.view.tracks[0].artist = so.artist;
      Songs.list = null; toast('保存しました'); drawSong();
    } catch (e) { toast(errText(e), 5000); btn.disabled = false; }
  },
};

/* =========================================================
 * Self-introduction (bio) on the profile and my page
 * ======================================================= */
const Bio = {
  id: '', text: '',
  async mount(id, editable) {
    this.id = id; this.editable = editable; this.text = '';
    const el = $('#bio-box'); if (!el || !id) return;
    try { const r = await fetch('/api/profile?id=' + encodeURIComponent(id)); this.text = r.ok ? (await r.json()).bio || '' : ''; } catch { /* ignore */ }
    this.draw();
  },
  draw() {
    const el = $('#bio-box'); if (!el) return;
    if (!this.editable) { el.innerHTML = this.text ? `<div class="bio">${esc(this.text)}</div>` : ''; return; }
    el.innerHTML = `<div class="bio ${this.text ? '' : 'empty'}">${this.text ? esc(this.text) : 'まだ自己紹介がありません。好きなアーティストやよく聴くジャンルを書いてみましょう。'}</div>
      <button class="btn sm quiet" data-act="bio-edit">✎ 自己紹介を${this.text ? '編集' : '書く'}</button>`;
  },
  edit() {
    $('#bio-box').innerHTML = `<div class="sheet flat stack"><label class="small muted" for="bio-text">自己紹介（300文字まで・公開プロフィールに表示されます）</label>
      <textarea class="textarea" id="bio-text" maxlength="300">${esc(this.text)}</textarea>
      <div class="row"><span class="spacer"></span><button class="btn quiet sm" data-act="bio-cancel">やめる</button><button class="btn sm accent" data-act="bio-save">保存</button></div></div>`;
    $('#bio-text').focus();
  },
  async save(btn) {
    btn.disabled = true;
    try {
      const h = await Social.headers(); if (!h) throw new AuthError('ログインしてください');
      const r = await fetch('/api/profile', { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ bio: $('#bio-text').value.trim() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || '保存できませんでした');
      this.text = j.bio || ''; this.draw(); toast('自己紹介を保存しました');
    } catch (e) { toast(errText(e), 5000); btn.disabled = false; }
  },
};

/** async extras on the share page: bookmark state, gallery badge, edit button for the owner */
async function decorateViewer(p) {
  const view = S.view;
  const [st] = await Promise.all([Social.status(p.id), Api.connected() ? Social.loadBookmarks() : null]);
  if (S.view !== view) return;
  const b = $('#bm-btn');
  if (b) { const on = Social.isBm(p.id); b.classList.toggle('on', on); b.querySelector('em').textContent = st.bm ? st.bm : ''; }
  const l = $('#listed'); if (l) l.hidden = !st.listed;
  const ls = $('#like-slot'); if (ls) ls.innerHTML = st.listed ? Likes.btn('p', p.id, st.likes) : '';
  const gt = $('#genre-tag'); if (gt && st.listed && (st.genres?.length || st.genre)) { gt.outerHTML = genreTags(st); }
  if (st.listed && st.desc && st.desc !== p.description && !$('.intro')) $('.vhead')?.insertAdjacentHTML('afterend', `<div class="intro">${esc(st.desc)}</div>`);
  Comments.mount('p', p.id, st.listed);
  if (Api.connected() && (await Api.myId()) === p.ownerId && S.view === view) {
    const slot = $('#owner-slot'); if (slot) slot.innerHTML = `<button class="btn sm solid" data-act="go" data-to="/#share=${esc(p.id)}">✎ 編集</button>`;
    if (!st.listed) $('.vhead')?.insertAdjacentHTML('beforebegin', `<div class="note accent row wrap-ok" style="margin-top:16px"><span class="spacer"><b>プレビュー</b>：このプレイリストはまだ「みんなのプレイリスト」に共有されていません。</span><button class="btn sm solid" data-act="go" data-to="/#share=${esc(p.id)}">共有の設定へ</button></div>`);
  }
}
/** recommend a song straight from a playlist's track list */
const TrackPost = {
  t: null, art: '',
  async open(i) {
    const t = S.view?.tracks?.[i]; if (!t) return;
    if (!Api.connected()) { toast('おすすめ曲に投稿するにはログインしてください'); if (!(await login())) return; }
    this.t = t; this.art = '';
    const m = $('#modal');
    m.innerHTML = `<div class="modal-card sheetup" role="dialog" aria-label="おすすめ曲に投稿">
      <div class="row" style="margin-bottom:12px"><b class="spacer display" style="font-size:19px">おすすめ曲に投稿</b><button class="btn quiet sm" data-act="modal-close" aria-label="閉じる">${ICON.close}</button></div>
      <div class="picked"><img id="tp-art" src="${esc(t.thumb || `https://i.ytimg.com/vi/${t.id}/mqdefault.jpg`)}" alt=""><div style="min-width:0"><div class="tiny muted">このプレイリストの曲</div><b>${esc(t.name)}</b><div class="small muted">${esc(t.artist)}</div></div></div>
      <div class="stack" style="margin-top:12px">
        <label class="small muted">曲名</label><input class="input" id="tp-title" maxlength="120" value="${esc(t.name)}">
        <label class="small muted">アーティスト</label><input class="input" id="tp-artist" maxlength="80" value="${esc(t.artist)}">
        <label class="small muted">ジャンル（必須・3つまで）</label>${genrePicker('tp-genres', [])}
        <label class="small muted">紹介文（任意）</label><textarea class="input" id="tp-desc" rows="3" maxlength="300" placeholder="この曲のおすすめポイント"></textarea>
        <button class="btn solid" data-act="trk-rec-send">おすすめ曲に掲載する</button>
      </div></div>`;
    m.hidden = false; document.body.classList.add('modal-open');
    // square album artwork from the music catalogue, when it can be found
    Catalog.search(`${t.name} ${firstArtist(t.artist)}`, 5).then((rs) => {
      const nt = (t.name || '').normalize('NFKC').toLowerCase();
      const hit = rs.find((x) => (x.trackName || '').normalize('NFKC').toLowerCase().startsWith(nt.slice(0, 6)));
      if (hit && this.t === t) { this.art = Catalog.art(hit.artworkUrl100); const im = $('#tp-art'); if (im) { im.src = this.art; im.classList.add('sq'); } }
    }).catch(() => {});
  },
  async send(btn) {
    const t = this.t; if (!t) return;
    const genres = pickedGenres('tp-genres');
    if (!genres.length) { $('#tp-genres').classList.add('need'); return toast('ジャンルを1つ以上選んでください'); }
    btn.disabled = true;
    try {
      const h = await Social.headers(); if (!h) throw new AuthError('ログインしてください');
      const r = await fetch('/api/songs', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({
        videoId: t.id, art: this.art, title: $('#tp-title').value.trim(), artist: $('#tp-artist').value.trim(), genres, desc: $('#tp-desc').value.trim(),
      }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || '掲載できませんでした');
      Songs.list = null; ShareImage.close();
      if (j.joined) { toast('すでに投稿されていた曲なので、あなたもおすすめした人に加わりました', 4000); return go('/s/' + j.sid); }
      toast('おすすめ曲に掲載しました');
      if (j.sid) setTimeout(() => { if (confirm('掲載した曲のページを開きますか？')) go('/s/' + j.sid); }, 300);
    } catch (e) { toast(errText(e), 5000); btn.disabled = false; }
  },
};
/** "me too": add yourself (with an optional note) to the people recommending this song */
const AlsoRec = {
  async open(btn) {
    const so = S.view?.song; if (!so) return;
    if (!Api.connected()) { toast('おすすめするにはログインしてください'); if (!(await login())) return; return renderSong(so.sid); }
    if (btn.dataset.joined === '1') {
      if (!confirm('この曲の「おすすめした人」から外れますか？')) return;
      return this.post(so, { leave: true }, btn);
    }
    const m = $('#modal');
    m.innerHTML = `<div class="modal-card sheetup" role="dialog" aria-label="私もおすすめ">
      <div class="row" style="margin-bottom:10px"><b class="spacer display" style="font-size:19px">私もおすすめ</b><button class="btn quiet sm" data-act="modal-close" aria-label="閉じる">${ICON.close}</button></div>
      <div class="small muted" style="margin-bottom:10px">「${esc(so.title)}」をおすすめした人に、あなたの名前が加わります。</div>
      <textarea class="input" id="also-desc" rows="3" maxlength="300" placeholder="あなたのおすすめポイント（任意）"></textarea>
      <button class="btn solid" style="margin-top:12px;width:100%" data-act="also-send">おすすめに加わる</button></div>`;
    m.hidden = false; document.body.classList.add('modal-open');
  },
  send(btn) { const so = S.view?.song; if (so) this.post(so, { desc: $('#also-desc').value.trim() }, btn); },
  async post(so, body, btn) {
    btn.disabled = true;
    try {
      const h = await Social.headers(); if (!h) throw new AuthError('ログインしてください');
      const r = await fetch('/api/songs?also=' + encodeURIComponent(so.sid), { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'できませんでした');
      ShareImage.close();
      Songs.list = null; S.view = null;
      toast(j.joined ? 'あなたもおすすめした人に加わりました' : 'おすすめした人から外れました');
      renderSong(so.sid);
    } catch (e) { toast(errText(e), 4000); btn.disabled = false; }
  },
};
async function toggleTrackBookmark(btn) {
  const t = S.view?.tracks?.[+btn.dataset.i]; if (!t) return;
  if (!Api.connected()) { toast('ブックマークするにはログインしてください'); if (!(await login())) return; }
  btn.disabled = true;
  try {
    const r = await Social.toggleBm({ ...t, pid: S.view.p?.id, ptitle: S.view.p?.title }, 't');
    btn.classList.toggle('on', r.on);
    toast(r.on ? `「${t.name}」をブックマークしました` : 'ブックマークを外しました');
  } catch (e) { toast(errText(e), 5000); if (e instanceof AuthError) renderConn(); }
  btn.disabled = false;
}
/** remove a song from the bookmarks page */
async function unsaveSong(btn) {
  const it = (Social.sbms || []).find((x) => x.id === btn.dataset.id); if (!it) return;
  btn.disabled = true;
  try {
    if (it.vid) await Social.toggleBm({ id: it.vid }, 't'); else await Social.toggleBm({ sid: it.id }, 's');
    toast('ブックマークを外しました');
    if (Player.idx < 0) renderBookmarks(); else btn.closest('.trk')?.remove();
  } catch (e) { toast(errText(e), 4000); btn.disabled = false; }
}
async function toggleSongBookmark(btn) {
  const so = S.view?.song; if (!so) return;
  if (!Api.connected()) { toast('ブックマークするにはログインしてください'); if (!(await login())) return; }
  btn.disabled = true;
  try {
    const r = await Social.toggleBm(so, 's');
    btn.classList.toggle('on', r.on); btn.querySelector('em').textContent = r.bm ? r.bm : '';
    toast(r.on ? 'ブックマークしました' : 'ブックマークを外しました');
  } catch (e) { toast(errText(e), 5000); if (e instanceof AuthError) renderConn(); }
  btn.disabled = false;
}
async function toggleBookmark(btn) {
  const p = S.view?.p; if (!p) return;
  if (!Api.connected()) { toast('ブックマークするにはログインしてください'); if (!(await login())) return; }
  btn.disabled = true;
  try {
    const r = await Social.toggleBm(p);
    btn.classList.toggle('on', r.on); btn.querySelector('em').textContent = r.bm ? r.bm : '';
    toast(r.on ? 'ブックマークしました' : 'ブックマークを外しました');
  } catch (e) { toast(errText(e), 5000); if (e instanceof AuthError) renderConn(); }
  btn.disabled = false;
}

function markNowPlaying() {
  if (typeof Posts !== 'undefined') Posts.markNow();
  const inBm = S.view?.id === 'bm';
  document.querySelectorAll('.trk').forEach((el) => {
    const i = +el.dataset.i, now = Player.idx === i && (!el.closest('#bm-list') || inBm);
    el.classList.toggle('now', now);
    el.classList.toggle('paused', now && !Player.playing);
    el.querySelector('.no').innerHTML = now ? '<span class="eq"><i></i><i></i><i></i></span>' : pad2(i + 1);
  });
}

/* =========================================================
 * Embedded player (YouTube IFrame API)
 * ======================================================= */
const Player = {
  yt: null, idx: -1, playing: false, ready: null, timer: null,
  mode: 'audio', // 'audio' = the playlist's own video, 'mv' = official music video
  load() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve) => {
      if (window.YT?.Player) return resolve();
      window.onYouTubeIframeAPIReady = resolve;
      const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
    });
    return this.ready;
  },
  get list() { return S.view?.tracks || []; },
  get track() { return this.list[this.idx]; },

  async play(i, mode) {
    const t = this.list[i]; if (!t) return;
    this.idx = i;
    this.mode = mode || (t.embed && !t._audioFailed ? 'audio' : 'mv');
    this.draw(); Deck.setTrack(t);
    let vid = t.id;
    if (this.mode === 'mv') {
      this.setBusy(true);
      const mv = await MV.find(t).catch(() => null);
      this.setBusy(false);
      if (this.idx !== i) return; // user moved on meanwhile
      if (mv) vid = mv.id;
      else {
        t._noMv = true;
        if (!t.embed || t._audioFailed) { toast('この曲は再生できず、MVも見つかりませんでした。次の曲へ進みます'); return this.next(); }
        if (mode === 'mv') toast('この曲の公式MVは見つかりませんでした');
        this.mode = 'audio';
      }
    }
    this.drawMode();
    await this.load();
    if (this.idx !== i) return;
    if (!this.yt) {
      this.yt = new window.YT.Player('ytplayer', {
        width: '356', height: '200', videoId: vid,
        playerVars: { autoplay: 1, playsinline: 1, rel: 0 },
        events: {
          onReady: (e) => e.target.playVideo(),
          onStateChange: (e) => {
            this.playing = e.data === 1 || (e.data === 3 && this.playing);
            if (e.data === 0 && !Party.isGuest()) this.next(true);
            this.drawState();
          },
          onError: () => this.failed(),
        },
      });
    } else {
      this.yt.loadVideoById(vid);
    }
    if (Lyrics.open) Lyrics.show(t);
    if (!store.get('mvHint')) setTimeout(() => { if (document.body.classList.contains('dsc-pv-open') || store.get('mvHint')) return; store.set('mvHint', 1); toast('再生バーの「MV」でMVに、「歌詞」で歌詞に切り替えられます', 4500); }, 1200);
  },
  failed() {
    const t = this.track; if (!t) return;
    if (this.mode === 'audio') {
      t._audioFailed = true;
      if (!t._noMv) { toast('音源を再生できないため、MVを探して再生します'); return this.play(this.idx, 'mv'); }
    }
    toast('再生できませんでした。次の曲へ進みます');
    this.next();
  },
  /** switch between the track's audio and its MV */
  switchMode() {
    const t = this.track; if (!t) return;
    if (this.mode === 'mv') {
      if (t.isMv) return toast('この曲はCD音源が見つからなかったため、MVで再生しています');
      if (!t.embed || t._audioFailed) return toast('この曲の音源はここでは再生できません');
      this.mode = 'audio'; this.drawMode(); this.yt?.loadVideoById(t.id);
      if (Lyrics.open) Lyrics.show(t);
    } else {
      if (t._noMv) return toast('この曲の公式MVは見つかりませんでした');
      if (!this.yt) return this.play(this.idx, 'mv');
      // look the MV up first, and only switch if an official one exists (never restart the song for nothing)
      const i = this.idx;
      this.setBusy(true);
      MV.find(t).catch(() => null).then((mv) => {
        this.setBusy(false);
        if (this.idx !== i) return;
        if (!mv) { t._noMv = true; return toast('この曲の公式MVは見つかりませんでした'); }
        this.mode = 'mv'; this.drawMode(); this.yt.loadVideoById(mv.id);
        if (Lyrics.open) Lyrics.show(t);
      });
    }
  },
  /* ---- shuffle / repeat ---- */
  get shuffle() { return !!store.get('shuffle', false); },
  get repeat() { return store.get('repeat', 'off'); }, // off | all | one
  order: null,
  /** play order: the list as-is, or a shuffled copy that keeps the current song where it is */
  queue() {
    const n = this.list.length;
    if (!this.shuffle) return [...Array(n).keys()];
    if (!this.order || this.order.length !== n || !this.order.includes(this.idx)) {
      const rest = [...Array(n).keys()].filter((i) => i !== this.idx);
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
      this.order = this.idx >= 0 ? [this.idx, ...rest] : rest;
    }
    return this.order;
  },
  /** auto = the song ended by itself */
  next(auto) {
    if (auto && this.repeat === 'one' && this.yt) { this.yt.seekTo(0, true); this.yt.playVideo(); return; }
    const q = this.queue(), pos = q.indexOf(this.idx);
    if (pos + 1 < q.length) return this.play(q[pos + 1]);
    if (this.repeat !== 'off' && q.length) {
      if (this.shuffle) { this.order = null; this.idx = -1; return this.play(this.queue()[0]); }
      return this.play(q[0]);
    }
    this.playing = false; this.drawState();
    if (auto) toast('プレイリストの最後まで再生しました');
  },
  prev() {
    if (this.yt?.getCurrentTime?.() > 4) return this.yt.seekTo(0, true);
    const q = this.queue(), pos = q.indexOf(this.idx);
    if (pos > 0) return this.play(q[pos - 1]);
    if (this.repeat === 'all' && q.length) this.play(q[q.length - 1]);
  },
  toggleShuffle() {
    store.set('shuffle', !this.shuffle); this.order = null;
    toast(this.shuffle ? 'シャッフル再生：オン' : 'シャッフル再生：オフ'); this.drawModes();
  },
  cycleRepeat() {
    const nx = { off: 'all', all: 'one', one: 'off' }[this.repeat] || 'off';
    store.set('repeat', nx);
    toast({ off: 'リピート：オフ', all: 'リピート：全曲', one: 'リピート：1曲' }[nx]); this.drawModes();
  },
  drawModes() {
    const sh = $('#pl-shuffle'), rp = $('#pl-repeat');
    if (sh) { sh.classList.toggle('on', this.shuffle); sh.setAttribute('aria-pressed', String(this.shuffle)); }
    if (rp) { rp.classList.toggle('on', this.repeat !== 'off'); rp.innerHTML = this.repeat === 'one' ? `${ICON.repeat}<sup>1</sup>` : ICON.repeat; rp.setAttribute('aria-label', { off: 'リピート：オフ', all: 'リピート：全曲', one: 'リピート：1曲' }[this.repeat]); }
  },
  toggle() { if (!this.yt) return; if (this.playing) this.yt.pauseVideo(); else this.yt.playVideo(); },
  /** small floating window (the video stays visible at YouTube's minimum player size, 200x200) */
  pip: false,
  setPip(on, quiet) {
    this.pip = !!on;
    const el = $('#player'); if (!el) return;
    el.classList.toggle('pip', this.pip); el.classList.toggle('left', this.pip && !!store.get('pipLeft'));
    document.body.classList.toggle('player-pip', this.pip);
    const b = $('#pl-min'); if (b) { b.innerHTML = this.pip ? ICON.expand : ICON.shrink; b.setAttribute('aria-label', this.pip ? '大きく表示' : '小窓にする'); b.title = b.getAttribute('aria-label'); }
    if (this.pip && Lyrics.open) { Lyrics.open = false; Lyrics.hide(); }
    if (!quiet) this.drawTitle();
  },
  close() {
    try { this.yt?.destroy(); } catch { /* ignore */ }
    clearInterval(this.timer); this.timer = null;
    this.yt = null; this.idx = -1; this.playing = false; Deck.setPlaying(false);
    Lyrics.open = false; Lyrics.hide();
    const el = $('#player'); el.hidden = true; el.innerHTML = ''; el.className = 'player'; document.body.classList.remove('has-player', 'player-pip'); this.pip = false;
    markNowPlaying();
  },
  draw() {
    const el = $('#player');
    if (el.hidden || !$('#ytplayer')) {
      el.innerHTML = `<div class="inner">
        <div class="ptop"><span class="mini vinyl" aria-hidden="true"><i></i><i></i></span>
          <div class="np"><span class="onair">NOW PLAYING</span><div class="marquee"><b id="pl-title"></b></div><span id="pl-artist"></span></div>
          <button class="btn quiet pclose pnp" data-act="np-post" aria-label="この曲をつぶやく" title="この曲をつぶやく">${ICON.pen}</button>
          <button class="btn quiet pclose pmin" data-act="p-min" id="pl-min" aria-label="小窓にする" title="小窓にする">${ICON.shrink}</button>
          <button class="btn quiet pclose" data-act="p-close" aria-label="プレーヤーを閉じる">${ICON.close}</button></div>
        <div class="pmodes">
          <button class="pbtn" id="pl-mv" data-act="p-mv" aria-label="MVに切り替え">MV</button>
          <button class="pbtn ${Lyrics.open ? 'on' : ''}" id="pl-lyrics" data-act="lyrics" aria-label="歌詞を表示">歌詞</button>
          <button class="pbtn icon" id="pl-shuffle" data-act="p-shuffle" aria-label="シャッフル">${ICON.shuffle}</button>
          <button class="pbtn icon" id="pl-repeat" data-act="p-repeat" aria-label="リピート">${ICON.repeat}</button>
        </div>
        <div class="video"><div id="ytplayer"></div></div>
        <div class="seekrow"><span class="time" id="pl-cur">0:00</span><input class="seek" id="pl-seek" type="range" min="0" max="1000" value="0" aria-label="再生位置"><span class="time" id="pl-dur">0:00</span></div>
        <div class="ctrls"><button class="btn" data-act="p-prev" aria-label="前の曲">${ICON.prev}</button><button class="btn solid" data-act="p-toggle" id="pl-toggle" aria-label="再生/一時停止">${ICON.pause}</button><button class="btn" data-act="p-next" aria-label="次の曲">${ICON.next}</button></div>
      </div>`;
      el.hidden = false; document.body.classList.add('has-player');
      $('#pl-seek').addEventListener('input', (ev) => {
        const dur = this.yt?.getDuration?.() || this.track?.d || 0;
        if (dur && this.yt?.seekTo) this.yt.seekTo((ev.target.value / 1000) * dur, true);
      });
      if (window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty('--dock-h', el.offsetHeight + 'px')).observe(el);
      this.setPip(this.pip, true);
      // in the small window, drag the title row sideways to move the window to the left or right edge
      const top = el.querySelector('.ptop');
      top.addEventListener('pointerdown', (e) => {
        if (!this.pip || e.target.closest('button')) return;
        const x0 = e.clientX; let moved = false;
        const move = (ev) => { const dx = ev.clientX - x0; if (Math.abs(dx) > 6) moved = true; el.style.transform = `translateX(${dx}px)`; };
        const up = (ev) => {
          removeEventListener('pointermove', move); removeEventListener('pointerup', up);
          el.style.transform = '';
          if (moved) { const left = ev.clientX < innerWidth / 2; el.classList.toggle('left', left); store.set('pipLeft', left); } else this.setPip(false);
        };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
      });
      clearInterval(this.timer); this.timer = setInterval(() => this.tick(), 250);
    }
    this.drawTitle(); this.drawMode(); this.drawModes(); markNowPlaying();
  },
  drawTitle() {
    const t = this.track; if (!t) return;
    const ti = $('#pl-title'), ar = $('#pl-artist');
    if (ti) { ti.textContent = `${pad2(this.idx + 1)}  ${t.name}`; ti.parentElement.classList.toggle('run', ti.scrollWidth > ti.parentElement.clientWidth + 4); }
    if (ar) ar.textContent = t.artist;
    const oa = document.querySelector('.player .onair'); if (oa) oa.textContent = Party.active() ? 'LIVE PARTY' : 'NOW PLAYING';
  },
  drawMode() {
    const b = $('#pl-mv'); if (!b) return;
    b.classList.toggle('on', this.mode === 'mv');
    b.textContent = this.mode === 'mv' ? 'MV ON' : 'MV';
  },
  setBusy(on) { const b = $('#pl-mv'); if (b) { b.classList.toggle('busy', on); if (on) b.innerHTML = '<span class="spinner"></span>'; else this.drawMode(); } },
  drawState() {
    const b = $('#pl-toggle'); if (b) b.innerHTML = this.playing ? ICON.pause : ICON.play;
    $('#player').classList.toggle('playing', this.playing);
    Deck.setPlaying(this.playing); markNowPlaying();
  },
  tick() {
    if (this.idx < 0) return;
    const st = this.yt?.getPlayerState?.();
    if (typeof st === 'number' && (st === 1) !== this.playing && st !== 3) { this.playing = st === 1; this.drawState(); }
    const cur = this.yt?.getCurrentTime?.() || 0, dur = this.yt?.getDuration?.() || this.track?.d || 0;
    const seek = $('#pl-seek'); if (seek && document.activeElement !== seek && dur) seek.value = Math.round((cur / dur) * 1000);
    const c = $('#pl-cur'), d = $('#pl-dur');
    if (c) c.textContent = fmtDur(Math.floor(cur)) || '0:00';
    if (d) d.textContent = fmtDur(Math.floor(dur)) || '0:00';
    const all = this.list.reduce((a, t) => a + (t.d || 0), 0), before = this.list.slice(0, this.idx).reduce((a, t) => a + (t.d || 0), 0);
    if (all) Deck.setProgress((before + Math.min(cur, this.track?.d || cur)) / all);
    Lyrics.sync(cur);
  },
};

/* =========================================================
 * Viewer: copy to my account
 * ======================================================= */
async function copyStart() {
  const { p, tracks } = S.view;
  const ids = tracks.map((t) => t.id);
  const cost = ids.length * 50 + 50;
  const msg = `「${p.title}」(${ids.length}曲) を、あなたの YouTube Music アカウントに新しいプレイリストとしてコピーします。\n\n・Googleでのログインが必要です\n・1日にコピーできる量には上限があります（この操作で約${cost.toLocaleString()} / 全員合計で1日${YT_DAILY.toLocaleString()}）\n\nよろしいですか？`;
  if (!confirm(msg)) return;
  if (!Api.connected() && !(await login())) return;
  store.set('copyjob', { src: p.id, title: p.title, owner: p.owner, ids, added: 0, dest: null, done: false });
  runCopy();
}
async function runCopy() {
  const job = store.get('copyjob'); if (!job) return;
  if (!Api.connected() && !(await login())) return;
  const draw = (err) => setApp(`
    <div class="plhead"><div class="art">${S.view?.p?.image ? `<img src="${esc(S.view.p.image)}" alt="">` : jcard(job.title)}</div>
      <div style="min-width:0"><div class="eyebrow">Copy to my library</div><h1>${esc(job.title)}</h1></div></div>
    <div class="sheet stack" style="margin-top:20px">
      <div class="small muted">${err ? '一時停止中' : '<span class="spinner"></span> あなたのアカウントにコピーしています…'}</div>
      <div class="count" id="cnum">${pad2(job.added)}<small> / ${pad2(job.ids.length)}</small></div>
      <div class="meter"><div id="cbar" style="width:${(job.added / job.ids.length) * 100}%"></div></div>
      ${err ? `<div class="note warn">${esc(err)}</div><div class="row wrap-ok"><button class="btn solid" data-act="copy-resume">続きから再開</button><button class="btn quiet" data-act="copy-cancel">やめる</button></div>` : '<div class="tiny muted">このページを開いたままお待ちください。</div>'}
    </div>`);
  draw();
  try {
    if (!job.dest) {
      job.dest = await Api.createPlaylist(job.title, `${job.owner} さんのプレイリストからコピー（Share MUSIC）\n元のプレイリスト: ${ytmPlaylistUrl(job.src)}`);
      store.set('copyjob', job);
    }
    while (job.added < job.ids.length) {
      try { await Api.addVideo(job.dest, job.ids[job.added]); }
      catch (e) { if (e instanceof QuotaError || e instanceof AuthError) throw e; console.warn('skip', job.ids[job.added], e); }
      job.added++; store.set('copyjob', job);
      const n = $('#cnum'), b = $('#cbar');
      if (n) n.innerHTML = `${pad2(job.added)}<small> / ${pad2(job.ids.length)}</small>`;
      if (b) b.style.width = `${(job.added / job.ids.length) * 100}%`;
    }
    job.done = true; store.set('copyjob', job);
    setApp(`
      <div class="sheet stack center" style="margin-top:28px;padding:32px 18px">
        <div class="done-mark">済</div>
        <div class="display" style="font-size:22px">コピーしました</div>
        <div class="small muted">「${esc(job.title)}」をあなたのライブラリに作成しました（非公開・${job.ids.length}曲）</div>
        <div><a class="btn accent" href="${ytmPlaylistUrl(job.dest)}" target="_blank" rel="noopener">YouTube Music で開く ${ICON.ext}</a></div>
        <div><button class="btn quiet" data-act="go" data-to="/p/${esc(job.src)}">共有ページに戻る</button></div>
      </div>`);
    store.del('copyjob');
  } catch (e) {
    console.error(e);
    draw(e instanceof QuotaError ? '今日のYouTube APIの利用上限に達しました。進み具合は保存されています。明日（日本時間16〜17時以降）にこのページを開いて「続きから再開」を押してください。' : errText(e));
  }
}

/* =========================================================
 * 聴く (stage 5): listening features gathered in one page — /#listen
 * ======================================================= */
function renderListen() {
  document.title = '聴く — Share MUSIC';
  const rec = Recent.list();
  const c = (attrs, icon, title, sub) => `<button class="choice lchoice" ${attrs}><span class="ci">${icon}</span><span><b>${title}</b><small>${sub}</small></span><i class="chev">›</i></button>`;
  setApp(`<button class="btn quiet sm back" data-act="go" data-to="/">← ホーム</button>
    <h1 class="pagetitle">聴く</h1>
    <p class="small muted" style="margin-top:0">みんなのプレイリストを聴いたり、同じ曲をいっしょに聴いたり。</p>
    <div class="label">リスニングパーティー</div>
    <div id="lsn-party"><div class="loading" style="padding:10px 0"><span class="spinner"></span></div></div>
    <div class="label">もっと聴く</div>
    ${c('data-act="listen-pl"', ICON.note, 'みんなのプレイリスト', '人気のプレイリストをジャンル別にさがして、その場で試聴')}
    ${c('data-act="sheet-post"', ICON.pen, 'ミックステープをつくる', '好きな曲を何曲でも並べて、コミュニティに投稿')}
    ${c('data-act="sheet-pick" data-to="/share/pl"', ICON.link, 'プレイリストを共有する', 'YouTube Music の自分のプレイリストを掲載')}
    ${c('data-act="go" data-to="/bookmarks"', ICON.star, 'ブックマーク', '保存したプレイリストとおすすめ曲')}
    ${rec.length ? `<details class="recent" style="margin-top:18px"><summary>最近見たもの（${rec.length}）</summary>${Recent.html()}</details>` : ''}`);
  (typeof partyList === 'function' ? partyList() : Promise.resolve([])).then((items) => {
    const el = $('#lsn-party'); if (!el) return;
    el.innerHTML = `${items.length && typeof partyCard === 'function' ? `<div class="shelf-row">${items.map(partyCard).join('')}</div>` : '<div class="tiny muted" style="margin-bottom:6px">いま開催中のパーティーはありません。</div>'}
      <div class="row wrap-ok" style="margin-top:8px"><button class="btn sm solid" data-act="pty-new">${ICON.party} パーティーを開く</button><button class="btn sm" data-act="go" data-to="/party">すべて見る</button></div>`;
  });
}
/** a small way into 聴く at the bottom of home (whatever module draws home). Idempotent. */
function mountListenEntry() {
  if (location.pathname !== '/' || location.hash) return;
  const app = $('#app'); if (!app || app.querySelector('.listen-entry')) return;
  app.insertAdjacentHTML('beforeend', `<a class="listen-entry" href="/#listen" data-act="go" data-to="/#listen"><span class="mi">${ICON.phones}</span><span><b>聴く</b><small>プレイリスト・リスニングパーティー・ミックステープ</small></span><i class="chev">›</i></a>`);
}
Hooks.home.push(mountListenEntry);

/* =========================================================
 * Help (使い方) — the new flow, explained simply
 * ======================================================= */
function renderHelp() {
  document.title = '使い方 — Share MUSIC';
  const step = (n, icon, title, body) => `<li class="hstep" data-n="${n}"><span class="hs-ic">${icon}</span><div><b>${title}</b><p>${body}</p></div></li>`;
  setApp(`<button class="btn quiet sm back" data-act="go" data-to="/">← ホーム</button>
    <h1 class="pagetitle">使い方</h1>
    <section class="help-hero">
      <div class="eyebrow">Share MUSIC でできること</div>
      <div class="hh-t">人のおすすめで、<br><em>新しい曲と出会う。</em></div>
      <p>大好きな曲を友だちにおすすめして、「わかる！」「ありがとう」で共感し合う場所です。聴くのはいつものアプリで。ここは<b>出会いと、おすすめと、共感</b>のための場所です。</p>
    </section>
    <ol class="hsteps">
      ${step(1, ICON.plus, 'おすすめする', '画面下のまんなかの<b>「＋ おすすめ」</b>から、好きな1曲を検索して選びます。「夜の帰り道」「雨」などの場面と、ひとことを添えましょう。')}
      ${step(2, ICON.note, 'ここを聴いて', 'いちばん聴いてほしい瞬間を選びます。歌詞があれば<b>「刺さった一行」</b>をタップするだけ。見た人はカードをタップすると、その瞬間から約20秒だけ試聴できます。指定がない曲は、サビを自動で探して流します。')}
      ${step(3, ICON.thanks, 'リアクションとありがとう', 'いいなと思ったら<b>「刺さった」</b>、気持ちがわかるなら<b>「わかる」</b>、教えてくれてうれしかったら<b>「ありがとう」</b>。ありがとうは、おすすめした人に届きます。')}
      ${step(4, ICON.tree, '布教の木', '「ありがとう」や「私もおすすめ」で、曲が<b>誰から誰へ届いたか</b>がつながっていきます。曲のページで、あなたのおすすめがどこまで広がったかを木の形で見られます。')}
      ${step(5, ICON.topic, '今週のお題', '毎週ひとつのお題に、<b>1人1曲</b>で答えます（あとから差し替えOK）。画面下の「お題」から、みんなの答えも聴けます。')}
    </ol>
    <div class="sheet flat" style="margin-top:6px">
      <b class="ic-line">${ICON.phones} 聴く機能もそのまま使えます</b>
      <div class="small muted" style="margin-top:4px">プレイリストの共有・リスニングパーティー・ミックステープは、ホームのいちばん下や右上のメニューの<b>「聴く」</b>にまとめました。</div>
      <div style="margin-top:10px"><button class="btn sm" data-act="go" data-to="/#listen">聴くを開く</button></div>
    </div>
    <div class="sheet" style="margin:22px 0">
      <b style="font-size:16px" class="ic-line">${ICON.device} ホーム画面に追加して使うのがおすすめ</b>
      <div class="small muted" style="margin-top:4px">${Install.standalone() ? 'いまホーム画面から開いています。ばっちりです！' : 'アプリのようにアイコンから全画面で開けて、ブラウザのタブに埋もれません。ログイン状態もそのまま使えます。'}</div>
      <div class="small" style="margin-top:10px"><b>iPhone / iPad</b></div>
      <ol class="howto"><li>Safari でこのページを開く</li><li>画面下の <b>共有ボタン（□に↑）</b> を押す</li><li>下にスクロールして <b>「ホーム画面に追加」</b> → 右上の「追加」</li></ol>
      <div class="small" style="margin-top:10px"><b>Android</b></div>
      <ol class="howto"><li>Chrome でこのページを開く</li><li>右上の <b>︙（メニュー）</b> を押す</li><li><b>「アプリをインストール」</b> または <b>「ホーム画面に追加」</b></li></ol>
      ${Install.prompt ? '<button class="btn sm solid" style="margin-top:8px" data-act="install">今すぐ追加する</button>' : ''}
    </div>
    <h2 class="display" style="font-size:24px;margin-bottom:14px">よくある質問</h2>
    <div class="stack">
      ${[
        ['見るだけならログインはいらない？', 'いりません。おすすめを見る・試聴する・コメントするのはログインなしでできます。おすすめする・リアクション・お題に答える・つぶやくときは Google でログインしてください。'],
        ['ログインのときに警告が出る', '個人で運営している小さなアプリで、Google の審査を受けていないため「このアプリは Google で確認されていません」と表示されます。「詳細」→「Share MUSIC（安全ではないページ）に移動」で進めてください。'],
        ['「ここを聴いて」の位置がずれる', 'MV のイントロの長さで少しずれることがあります。選ぶ画面の「±」で調整できます。'],
        ['「推定サビ」って？', '「ここを聴いて」が指定されていない曲は、歌詞のくり返し部分からサビを自動で探しています。見つからないときは曲の真ん中より少し前から流します。'],
        ['コミュニティって？', '画面下の「コミュニティ」で、ひとこと・曲（ミックステープ）・写真・曲バトル（どっちが好きか投票）をつぶやけます。'],
        ['プレイリストを共有するには？', '右上のメニュー →「聴く」→「プレイリストを共有する」から、YouTube Music の自分のプレイリストを選んで掲載できます。'],
        ['いやな投稿を見つけたら', '投稿やコメントの「通報」から運営に知らせてください。通報したことは相手に伝わりません。'],
        ['データはどこに保存されますか？', 'おすすめ・リアクション・お題の回答・コメントなどはサーバー（Cloudflare）に保存されます。詳しくはプライバシーポリシーをご覧ください。'],
      ].map(([q, a]) => `<div class="sheet flat"><b>${q}</b><div class="small muted" style="margin-top:4px">${a}</div></div>`).join('')}
    </div>
    <div class="row wrap-ok" style="margin-top:20px"><a class="btn sm" href="/about">このアプリについて</a><a class="btn sm" href="/privacy">プライバシーポリシー</a></div>
    <p class="tiny muted" style="margin-top:14px">お問い合わせ：<a href="mailto:dalzgamesch@gmail.com">dalzgamesch@gmail.com</a></p>`);
}

/* =========================================================
 * Events
 * ======================================================= */
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !$('#modal').hidden) ShareImage.close();
  if (ev.key === 'Enter' && ev.target.id === 'song-q') { ev.preventDefault(); $('[data-act=song-search]')?.click(); }
  if (ev.key === 'Enter' && ev.target.id === 'adm-pw') { ev.preventDefault(); $('[data-act=adm-login]')?.click(); }
});
document.addEventListener('click', async (ev) => {
  if (ev.target.id === 'modal') return ShareImage.close();
  if (ev.target.closest('[data-stop]')) return;
  const el = ev.target.closest('[data-act]'); if (!el || !el.dataset.act) return;
  switch (el.dataset.act) {
    case 'go': ev.preventDefault(); go(el.dataset.to); break;
    case 'login': if (await login()) { if (location.pathname === '/' && !location.hash) go('/share'); else route(); } break;
    case 'logout': Api.logout(); S.mine = null; Social.bms = null; Social.sbms = null; Follows.list = null; Notifs.items = null; Notifs.unread = 0; go('/'); toast('ログアウトしました'); break;
    case 'reload': S.mine = null; Social.gallery = null; drawMeTab(); break;
    case 'me-tab': S.meTab = el.dataset.tab; renderMe(); renderTabbar(); break;
    case 'copy-text': if (await copyText(el.dataset.text)) toast('リンクをコピーしました'); break;
    case 'install-hide': store.set('installHide', 1); $('#install')?.remove(); break;
    case 'install': if (Install.prompt) { Install.prompt.prompt(); const r = await Install.prompt.userChoice.catch(() => null); if (r?.outcome === 'accepted') $('#install')?.remove(); Install.prompt = null; } break;
    case 'clear-recent': store.del('recent'); toast('履歴を消しました'); drawMeTab(); break;
    case 'clear-cache': store.del('ja'); store.del('mv2'); toast('キャッシュを消しました'); break;
    case 'look': {
      S.look = el.dataset.look; Deck.setLook(S.look);
      const y = window.scrollY; drawViewer(); window.scrollTo({ top: y });
      const mini = $('#player .mini'); if (mini) mini.className = 'mini ' + S.look;
      break;
    }
    case 'share-img': ShareImage.open(S.view.p, S.view.tracks, location.origin + location.pathname, S.view.song ? { artist: S.view.song.artist, desc: S.view.song.desc, d: S.view.song.d } : null); break;
    case 'copy-page': shareThis(); break;
    case 'share-profile': shareThis(); break;
    case 'edit-share-img': {
      el.disabled = true; const label = el.textContent; el.innerHTML = '<span class="spinner"></span> 準備中…';
      try { const tr = await Api.tracks(S.edit.id, true); await ShareImage.open(S.edit, tr, $('#link').value); }
      catch (e) { toast(errText(e), 5000); }
      el.disabled = false; el.textContent = label; break;
    }
    case 'modal-close': ShareImage.close(); break;
    case 'settings': Theme.open(); break;
    case 'bm': toggleBookmark(el); break;
    case 'sbm': toggleSongBookmark(el); break;
    case 'tbm': toggleTrackBookmark(el); break;
    case 'also': AlsoRec.open(el); break;
    case 'also-send': AlsoRec.send(el); break;
    case 'bm-unsave': unsaveSong(el); break;
    case 'bm-play-all': if (S.view?.id !== 'bm') { if (Player.idx >= 0) Player.close(); S.view = S.bmView; } Player.order = null; Player.idx = -1; Player.play(Player.shuffle ? Math.floor(Math.random() * S.view.tracks.length) : 0); break;
    case 'trk-rec': TrackPost.open(+el.dataset.i); break;
    case 'report': Report.open(el); break;
    case 'report-send': Report.send(el); break;
    case 'follow': Follows.toggle(el); break;
    case 'trk-rec-send': TrackPost.send(el); break;
    case 'bm-tab': S.bmTab = el.dataset.tab; renderBookmarks(); break;
    case 'like': onLike(el); break;
    case 'home-tab': setHomeView({ tab: el.dataset.tab }); break;
    case 'genre-tile': S.genre = el.dataset.g; S.homeTab = 'pl'; go('/search'); break;
    case 'feat-play': ev.preventDefault(); S.autoplay = true; go('/p/' + el.dataset.id); break;
    case 'home-sort': setHomeView({ sort: el.dataset.sort }); break;
    case 'see-all': S.homeTab = el.dataset.tab; S.gsort = el.dataset.sort; S.gq = ''; S.genre = ''; go('/search'); break;
    case 'home-search': { const q = $('#gq'); if (!q) break; S.gsearch = q.hidden; q.hidden = !q.hidden; el.setAttribute('aria-expanded', String(!q.hidden)); if (!q.hidden) q.focus(); else if (S.gq) { S.gq = ''; q.value = ''; el.classList.remove('on'); drawHomeList(); } break; }
    case 'genre': S.genre = el.dataset.g || ''; document.querySelectorAll('.gchip').forEach((b) => b.classList.toggle('on', (b.dataset.g || '') === S.genre)); drawHomeList(); break;
    case 'cmt-post': Comments.post(el); break;
    case 'cmt-del': Comments.del(el); break;
    case 'gp': toggleGenre(el); break;
    case 'song-edit': SongEdit.open(); break;
    case 'song-edit-cancel': $('#song-edit').innerHTML = ''; break;
    case 'song-edit-save': SongEdit.save(el); break;
    case 'song-page-del': Songs.del(S.view.song.sid); break;
    case 'bio-edit': Bio.edit(); break;
    case 'bio-cancel': Bio.draw(); break;
    case 'bio-save': Bio.save(el); break;
    case 'cmt-reply': Comments.openReply(el); break;
    case 'cmt-cancel': el.closest('.cmt-replybox').innerHTML = ''; break;
    case 'go-songs': S.homeTab = 'song'; go('/search'); break;
    case 'song-play': Songs.play(el.dataset.sid); break;
    case 'song-search': Songs.search(el); break;
    case 'song-pick': Songs.pick(+el.dataset.i); break;
    case 'song-unpick': Songs.picked = null; Songs.msg = ''; drawMeTab(); break;
    case 'song-post': Songs.post(el); break;
    case 'song-del': Songs.del(el.dataset.sid); break;
    case 'guide-go': LoginGuide.go(); break;
    case 'guide-reset': store.del('guide-skip'); toast('次のログインで説明を表示します'); drawMeTab(); break;
    case 'share-save': saveShare(el); break;
    case 'share-stop': stopShare(el); break;
    case 'adm-login': Admin.login(el); break;
    case 'adm-logout': Admin.token = null; Admin.data = null; Admin.render(); break;
    case 'adm-tab': Admin.tab = el.dataset.tab; Admin.q = ''; Admin.draw(); window.scrollTo({ top: 0 }); break;
    case 'adm-reload': Admin.stale = true; Admin.render(); break;
    case 'adm-user': Admin.user(el.dataset.id); break;
    case 'adm': Admin.act(el); break;
    case 'cover-edit': Cover.open(S.edit, S.edit.customCover, (v) => {
      if (S.mine) S.mine = S.mine.map((x) => (x.id === S.edit.id ? { ...x, image: v ? Cover.url(x.id, v) : x.ytImage } : x));
      if (S.view?.id === S.edit.id) S.view = null;
      renderShare(S.edit.id);
    }); break;
    case 'cover-pick': Cover.pickFile(); break;
    case 'cover-save': Cover.save(el); break;
    case 'cover-reset': Cover.reset(); break;
    case 'theme': Theme.set('theme', el.dataset.v); break;
    case 'palette': Theme.set('palette', el.dataset.v); break;
    case 'img-share': ShareImage.share(); break;
    case 'reload-view': S.view = null; route(); break;
    case 'play-mv': if (Player.idx < 0) { Player.order = null; Player.play(0, 'mv'); } else if (Player.mode !== 'mv') Player.switchMode(); else toast('MVを再生中です'); break;
    case 'play-all': Player.order = null; Player.idx = -1; Player.play(Player.shuffle ? Math.floor(Math.random() * S.view.tracks.length) : 0); break;
    case 'p-mv': Player.switchMode(); break;
    case 'lyrics': if (Player.pip) Player.setPip(false); Lyrics.toggle(Player.track); break;
    case 'p-min': Player.setPip(!Player.pip); break;
    case 'share-sheet': ev.preventDefault(); ShareSheet.open(); break;
    case 'sheet-close': ShareSheet.close(); break;
    case 'sheet-pick': ShareSheet.pick(el.dataset.to); break;
    case 'sheet-post': ShareSheet.close(); Composer.open(); break;
    case 'sheet-party': ShareSheet.close(); go('/party'); break;
    case 'menu': ev.preventDefault(); ShareSheet.open(); break;
    case 'rec-new': ev.preventDefault(); ShareSheet.pick('/share/song'); break;
    case 'sheet-go': ShareSheet.close(); go(el.dataset.to); break;
    case 'sheet-link': ShareSheet.close(); location.href = el.dataset.to; break;
    case 'listen-pl': S.homeTab = 'pl'; S.gsort = 'likes'; S.gq = ''; S.genre = ''; go('/search'); break;
    case 'ly-seek': if (Player.yt?.seekTo) Player.yt.seekTo(+el.dataset.t, true); break;
    case 'play':
      if (el.closest('#bm-list') && S.view?.id !== 'bm') { if (Player.idx >= 0) Player.close(); S.view = S.bmView; }
      if (Player.idx === +el.dataset.i && Player.yt) Player.toggle(); else Player.play(+el.dataset.i); break;
    case 'p-prev': Player.prev(); break;
    case 'p-next': Player.next(); break;
    case 'p-toggle': Player.toggle(); break;
    case 'p-close': Player.close(); break;
    case 'p-shuffle': Player.toggleShuffle(); break;
    case 'p-repeat': Player.cycleRepeat(); break;
    case 'copy-start': copyStart(); break;
    case 'copy-resume': runCopy(); break;
    case 'copy-cancel': store.del('copyjob'); route(); break;
    default: if (!postAction(el.dataset.act, el, ev) && !partyAction(el.dataset.act, el)) Hooks.actions.some((fn) => fn(el.dataset.act, el, ev));
  }
});
// close little popovers (reaction picker, post menu) when tapping elsewhere
document.addEventListener('pointerdown', (ev) => {
  if (!ev.target.closest('.rxs, .post-menu, .post-menu-btn')) document.querySelectorAll('.rx-pick:not([hidden]), .post-menu:not([hidden])').forEach((x) => { x.hidden = true; });
}, { passive: true });

if (!CONFIG.googleClientId || !CONFIG.apiKey) toast('config.js の設定がまだです', 6000);
/** "add to home screen" guidance: shown until installed or dismissed */
const Install = {
  prompt: null,
  standalone: () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  ios: () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  steps() {
    return this.ios()
      ? '<ol class="howto"><li>Safari でこのページを開く</li><li>画面下の <b>共有ボタン（□に↑）</b> を押す</li><li><b>「ホーム画面に追加」</b> → 右上の「追加」</li></ol>'
      : '<ol class="howto"><li>Chrome でこのページを開く</li><li>右上の <b>︙（メニュー）</b> を押す</li><li><b>「アプリをインストール」</b> または <b>「ホーム画面に追加」</b></li></ol>';
  },
  banner() {
    if (this.standalone() || store.get('installHide')) return '';
    return `<div class="install" id="install"><span class="ic" aria-hidden="true">♪</span>
      <button class="txt" data-act="${this.prompt ? 'install' : 'go'}" data-to="#help"><b>ホーム画面に追加</b>するとアプリのように使えます</button>
      <button class="x" data-act="install-hide" aria-label="閉じる">×</button></div>`;
  },
};
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); Install.prompt = e; const el = document.getElementById('install'); if (el) el.outerHTML = Install.banner(); });
addEventListener('appinstalled', () => { Install.prompt = null; document.getElementById('install')?.remove(); });

/** small channel icons next to who shared / recommended something (YouTube channel thumbnails, cached for a week) */
const Avatars = {
  mem: null, busy: new Set(), t: 0,
  cache() { if (!this.mem) { const c = store.get('avatars', {}); const now = Date.now(); for (const k in c) if (now - c[k].at > 7 * 864e5) delete c[k]; this.mem = c; } return this.mem; },
  hue(id) { let h = 0; for (const ch of id || '') h = (h * 31 + ch.charCodeAt(0)) % 360; return h; },
  html(id, name, cls = '') {
    const u = id && this.cache()[id]?.url;
    return `<span class="av ${cls}" data-ch="${esc(id || '')}" style="--h:${this.hue(id || name)}" aria-hidden="true">${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : esc([...(name || '?').trim()][0] || '?')}</span>`;
  },
  /** "who" chip: icon + name, linking to the profile when the channel is known */
  chip(id, name, { link = true, cls = '' } = {}) {
    const inner = `${this.html(id, name)}<span class="who-n">${esc(name || '')}</span>`;
    return link && id ? `<a class="who ${cls}" href="/u/${esc(id)}" data-act="go" data-to="/u/${esc(id)}">${inner}</a>` : `<span class="who ${cls}">${inner}</span>`;
  },
  async fill(root = document) {
    const c = this.cache();
    const els = [...root.querySelectorAll('.av[data-ch]:not(.done)')];
    const need = [...new Set(els.map((e) => e.dataset.ch).filter((id) => /^UC[\w-]{20,}$/.test(id) && !c[id] && !this.busy.has(id)))];
    for (let i = 0; i < need.length; i += 50) {
      const ids = need.slice(i, i + 50); ids.forEach((id) => this.busy.add(id));
      try {
        const j = await Api.api('channels?' + new URLSearchParams({ part: 'snippet', id: ids.join(','), maxResults: '50' }));
        for (const ch of j.items || []) { const th = ch.snippet?.thumbnails || {}; c[ch.id] = { url: th.default?.url || th.medium?.url || '', at: Date.now() }; }
        for (const id of ids) if (!c[id]) c[id] = { url: '', at: Date.now() }; // unknown: keep the initial
        store.set('avatars', c);
      } catch { /* keep initials */ }
    }
    for (const e of document.querySelectorAll('.av[data-ch]:not(.done)')) {
      const u = c[e.dataset.ch]?.url; if (u && !e.querySelector('img')) e.innerHTML = `<img src="${esc(u)}" alt="" loading="lazy">`;
      if (c[e.dataset.ch]) e.classList.add('done');
    }
  },
};

/** blurred jacket colours glowing behind the page: the first big artwork on screen */
const Backdrop = {
  url: '', t: 0,
  set(u) {
    const el = document.getElementById('bgart'); if (!el || u === this.url) return; this.url = u;
    if (u) { el.style.setProperty('--art', `url("${u.replace(/"/g, '%22')}")`); el.classList.add('on'); } else el.classList.remove('on');
  },
  auto() {
    const img = document.querySelector('#app .deck .sleeve img, #app .plhead .art img, #app .tile .art img, #app .pl .cover img');
    this.set(img ? img.currentSrc || img.src : '');
  },
};
new MutationObserver(() => { clearTimeout(Backdrop.t); Backdrop.t = setTimeout(() => { Backdrop.auto(); Avatars.fill(); }, 150); }).observe(document.getElementById('app'), { childList: true, subtree: true });

/** fade the loading screen out once the first page has drawn (kept at least ~1.9s so the animation can play) */
function hideSplash() {
  const sp = document.getElementById('splash'); if (!sp || sp.classList.contains('out')) return;
  const wait = Math.max(0, 1900 - (Date.now() - (window.__splashAt || 0)));
  setTimeout(() => { sp.classList.add('out'); setTimeout(() => sp.remove(), 600); }, wait);
}
Api.probe();
Theme.apply();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => Theme.apply());
route();
