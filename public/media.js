/* Share MUSIC — song metadata helpers:
 *   Localize : romanized titles/artists -> official Japanese names (via /api/ja, Apple Music catalog)
 *   MV       : find the official music video for a track (via /api/mv, cached on the CDN)
 *   Lyrics   : synced / plain lyrics from LRCLIB (lrclib.net, open lyrics database) */
'use strict';

const hasJa = (s) => /[぀-ヿ㐀-鿿ｦ-ﾟ]/.test(s || '');
const firstArtist = (a) => (a || '').split(/\s*(?:,|、|&|＆|×| x | feat\.?| ft\.)\s*/i)[0].trim();

/* =========================================================
 * Music catalog (Apple's iTunes Search API), called straight from the browser:
 * Apple refuses requests from shared cloud servers, but allows browsers (CORS).
 * ======================================================= */
const Catalog = {
  last: 0, blocked: false,
  async pace() { const wait = this.last + 400 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); this.last = Date.now(); },
  async search(term, limit = 25) {
    if (this.blocked) throw new Error('音楽カタログが混み合っています。少し時間をおいてお試しください');
    await this.pace();
    const r = await fetch('https://itunes.apple.com/search?' + new URLSearchParams({ term, country: 'JP', lang: 'ja_jp', entity: 'song', limit: String(limit) }));
    if (r.status === 403 || r.status === 429) { this.blocked = true; setTimeout(() => { this.blocked = false; }, 60000); throw new Error('音楽カタログが混み合っています。少し時間をおいてお試しください'); }
    if (!r.ok) throw new Error('検索できませんでした');
    return ((await r.json()).results || []).filter((x) => x.kind === 'song');
  },
  art: (u, size = 600) => (u || '').replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`),
  /** official Japanese title/artist for a (possibly romanized) track — same rules as the old server lookup */
  async japanese(t, a, d) {
    const res = await this.search(`${a} ${t}`.trim(), 10);
    const nrm = (x) => (x || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const BAD = /(live|ライブ|ver\.|version|piano|instrumental|inst\.|karaoke|カラオケ|オルゴール|first take|remix|acoustic|english|cover|tv size|movie size|弾き語り)/i;
    const ok = res.filter((x) => x.trackName && (!d || Math.abs((x.trackTimeMillis || 0) / 1000 - d) <= 4) && (!BAD.test(x.trackName) || BAD.test(t)));
    if (!ok.length) return {};
    const pick = ok.find((x) => nrm(x.trackName) === nrm(t)) || ok[0];
    return { name: pick.trackName, artist: pick.artistName };
  },
};

/* =========================================================
 * Localize
 * ======================================================= */
const Localize = {
  get cache() { return store.get('ja2', {}); },
  save(c) {
    const keys = Object.keys(c);
    if (keys.length > 3000) keys.slice(0, keys.length - 3000).forEach((k) => delete c[k]);
    store.set('ja2', c);
  },
  /** Apply a lookup result to a track. Only replaces romanized text with Japanese text, never the reverse. */
  apply(t, r) {
    if (!r || !r.name) return false;
    const jaSong = hasJa(r.name);               // the official title itself is Japanese
    const kanjiKana = /[\u3040-\u309f\u3400-\u9fff]/; // hiragana / kanji (not katakana-only)
    let changed = false;
    if (!hasJa(t.name) && jaSong) { t.name = r.name; changed = true; }
    // artist: accept for Japanese songs, or when the name has kanji/hiragana (米津玄師, あいみょん, Official髭男dism).
    // A katakana-only artist for an English title is usually a transliterated western act (Queen -> クイーン): skip.
    if (!hasJa(t.artist) && hasJa(r.artist) && (jaSong || kanjiKana.test(r.artist))) { t.artist = r.artist; changed = true; }
    return changed;
  },
  needs: (t) => !(hasJa(t.name) && hasJa(t.artist)) && t.d > 0,

  async run(tracks, onChange) {
    const cache = this.cache;
    tracks.forEach((t, i) => { if (cache[t.id] && this.apply(t, cache[t.id])) onChange(i); });
    const todo = tracks.map((t, i) => [t, i]).filter(([t]) => this.needs(t) && !(t.id in cache)).slice(0, 60);
    let fails = 0;
    // one request at a time, paced by Catalog (Apple allows only a modest rate per browser)
    while (todo.length && fails < 3) {
      const [t, i] = todo.shift();
      try {
        const r = await Catalog.japanese(t.name, firstArtist(t.artist), t.d);
        cache[t.id] = r.name ? { name: r.name, artist: r.artist } : {};
        if (this.apply(t, r)) onChange(i);
        if (todo.length % 10 === 0) this.save(cache);
      } catch { fails++; }
    }
    this.save(cache);
  },
};

/* =========================================================
 * MV finder
 * ======================================================= */
const MV = {
  /** a known MV for a video (e.g. the original MV of a song now playing its CD audio) */
  remember(audioId, mvId) { const cache = store.get('mv2', {}); cache[audioId] = { id: mvId }; store.set('mv2', cache); },
  async find(t) {
    const cache = store.get('mv2', {});
    if (t.mvId) return { id: t.mvId };
    if (t.id in cache) return cache[t.id];
    const res = await fetch('/api/mv?' + new URLSearchParams({ r: '2', v: t.id, t: t.name, a: firstArtist(t.artist), d: String(t.d || 0) }));
    if (!res.ok) throw new Error('mv lookup failed');
    const r = await res.json();
    cache[t.id] = r.id ? r : null;
    store.set('mv2', cache);
    return cache[t.id];
  },
};

/* =========================================================
 * Lyrics (LRCLIB)
 * ======================================================= */
const Lyrics = {
  open: false, mem: new Map(), lines: null, current: -1, forId: null,

  parse(lrc) {
    const out = [];
    for (const line of (lrc || '').split('\n')) {
      const tags = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
      const text = line.replace(/\[[^\]]*\]/g, '').trim();
      for (const m of tags) out.push({ t: +m[1] * 60 + +m[2], text });
    }
    return out.sort((a, b) => a.t - b.t);
  },

  async fetchFor(t) {
    if (this.mem.has(t.id)) return this.mem.get(t.id);
    const artist = firstArtist(t.artist), name = t.name;
    const pick = (list) => {
      const ok = (list || []).filter((x) => !x.instrumental && (!t.d || Math.abs((x.duration || 0) - t.d) <= 8));
      return ok.find((x) => x.syncedLyrics) || ok.find((x) => x.plainLyrics) || null;
    };
    let hit = null;
    try {
      const r = await fetch('https://lrclib.net/api/get?' + new URLSearchParams({ track_name: name, artist_name: artist, ...(t.d ? { duration: String(t.d) } : {}) }));
      if (r.ok) hit = await r.json();
    } catch { /* ignore */ }
    if (!hit || (!hit.syncedLyrics && !hit.plainLyrics)) {
      try {
        const r = await fetch('https://lrclib.net/api/search?' + new URLSearchParams({ track_name: name, artist_name: artist }));
        if (r.ok) hit = pick(await r.json());
        if (!hit) { const r2 = await fetch('https://lrclib.net/api/search?' + new URLSearchParams({ q: `${name} ${artist}` })); if (r2.ok) hit = pick(await r2.json()); }
      } catch { /* ignore */ }
    }
    const val = hit ? { synced: hit.syncedLyrics ? this.parse(hit.syncedLyrics) : null, plain: hit.plainLyrics || null } : null;
    this.mem.set(t.id, val);
    return val;
  },

  panel() { return document.getElementById('lyrics'); },

  async show(t) {
    const el = this.panel(); if (!el || !t) return;
    this.forId = t.id; this.lines = null; this.current = -1;
    el.hidden = false; document.body.classList.add('lyrics-open');
    el.innerHTML = `<div class="ly-head"><span class="eyebrow">Lyrics</span><b>${esc(t.name)}</b><button class="btn quiet sm" data-act="lyrics" aria-label="歌詞を閉じる">${ICON.close}</button></div>
      <div class="ly-body" id="ly-body"><div class="loading"><span class="spinner"></span> 歌詞を探しています…</div></div>`;
    if (Player.mode === 'mv' || t.isMv) {
      // MVs have intros, dialogue and different cuts: synced lyrics would drift, so lyrics are only shown with the CD audio
      document.getElementById('ly-body').innerHTML = `<div class="ly-none">MVの再生中は歌詞を表示できません。<br>MVは曲の前後に映像やセリフが入ることがあり、歌詞のタイミングがずれてしまうためです。${t.isMv ? '' : '<div style="margin-top:12px"><button class="btn sm solid" data-act="p-mv">CD音源に戻して歌詞を見る</button></div>'}</div>`;
      return;
    }
    const data = await this.fetchFor(t).catch(() => null);
    if (this.forId !== t.id || !this.open) return;
    const body = document.getElementById('ly-body');
    if (!data) { body.innerHTML = '<div class="ly-none">この曲の歌詞は見つかりませんでした。</div>'; return; }
    if (data.synced && data.synced.length) {
      this.lines = data.synced;
      body.innerHTML = `<div class="ly-lines">${data.synced.map((l, i) => `<p data-i="${i}" data-act="ly-seek" data-t="${l.t}">${esc(l.text) || '♪'}</p>`).join('')}</div>`;
    } else {
      body.innerHTML = `<div class="ly-plain">${esc(data.plain)}</div>`;
    }
    body.insertAdjacentHTML('beforeend', `<div class="ly-credit">歌詞提供: LRCLIB</div>`);
  },

  hide() { const el = this.panel(); if (el) { el.hidden = true; el.innerHTML = ''; } document.body.classList.remove('lyrics-open'); this.forId = null; },
  toggle(t) { this.open = !this.open; if (this.open) this.show(t); else this.hide(); document.getElementById('pl-lyrics')?.classList.toggle('on', this.open); },

  /** highlight the current line (called from the player's ticker) */
  sync(cur) {
    if (!this.open || !this.lines) return;
    let i = -1;
    for (let k = 0; k < this.lines.length; k++) { if (this.lines[k].t <= cur + 0.25) i = k; else break; }
    if (i === this.current) return;
    const body = document.getElementById('ly-body'); if (!body) return;
    body.querySelector('p.on')?.classList.remove('on');
    this.current = i;
    const p = body.querySelector(`p[data-i="${i}"]`);
    if (p) { p.classList.add('on'); body.scrollTo({ top: p.offsetTop - body.clientHeight / 2 + p.clientHeight / 2, behavior: 'smooth' }); }
  },
};
