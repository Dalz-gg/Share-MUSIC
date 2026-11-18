/* Share MUSIC — Stage 1 — 「ここを聴いて」(the best moment of a recommended song) + chorus preview + chorus estimation.
 * Plugs into app.js through Hooks (see the top of app.js). Loaded before app.js; only refer to app.js globals inside functions.
 *
 * Public API (other stages call these defensively with window.Discover?.x):
 *   Discover.SCENES                 [[id, 'ラベル'], ...]
 *   Discover.preview(song)          play a recommended song (item of /api/songs) from its moment (or estimated chorus) for ~20s
 *                                   with the lyric lines around it. Call it from a user tap.
 *   Discover.lineOf(song)           the "刺さった一行" ('' if none)
 *   Discover.pickMoment({ id, title, artist, d }) -> Promise<{ t, line } | null>   modal to choose the moment
 *
 * Time base: moment.t is the time in the SONG (the CD audio / LRCLIB synced lyrics timeline). When the video that plays is an MV
 * whose length differs from the lyrics' length, the difference is treated as an intro and added when seeking. */
'use strict';

const Discover = {
  SCENES: [
    ['night', '夜の帰り道'], ['morning', '朝'], ['rain', '雨の日'], ['drive', 'ドライブ'], ['work', '作業・勉強'],
    ['heartbreak', '失恋'], ['cheer', '元気がほしい'], ['sleepless', '眠れない夜'], ['season', '季節を感じる'],
    ['love', '恋してる'], ['cry', '泣きたい'], ['walk', '散歩'],
  ],
  PREVIEW_SEC: 20,
  sceneName(id) { return (this.SCENES.find((x) => x[0] === id) || [])[1] || ''; },
  lineOf(song) { return String(song?.moment?.line || '').trim(); },
  fmt(sec) { sec = Math.max(0, Math.floor(sec || 0)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; },

  /* =========================================================
   * Lyrics (LRCLIB) — same lookup as media.js Lyrics.fetchFor, but also keeps LRCLIB's duration (for the MV intro offset)
   * and allows a longer video (an MV) to match the song.
   * ======================================================= */
  mem: new Map(),
  async lrc(s) {
    const key = s.id + '|' + s.title;
    if (this.mem.has(key)) return this.mem.get(key);
    const job = (async () => {
      const artist = firstArtist(s.artist), name = s.title, d = s.d || 0;
      // an MV can be longer than the song (intro / outro), never much shorter
      const fits = (x) => !d || ((x.duration || 0) - d <= 8 && d - (x.duration || 0) <= 120);
      const pick = (list) => { const ok = (list || []).filter((x) => !x.instrumental && fits(x)); return ok.find((x) => x.syncedLyrics) || ok.find((x) => x.plainLyrics) || null; };
      let hit = null;
      try {
        const r = await fetch('https://lrclib.net/api/get?' + new URLSearchParams({ track_name: name, artist_name: artist, ...(d ? { duration: String(d) } : {}) }));
        if (r.ok) hit = await r.json();
      } catch { /* ignore */ }
      if (!hit || (!hit.syncedLyrics && !hit.plainLyrics)) {
        hit = null;
        try {
          const r = await fetch('https://lrclib.net/api/search?' + new URLSearchParams({ track_name: name, artist_name: artist }));
          if (r.ok) hit = pick(await r.json());
          if (!hit) { const r2 = await fetch('https://lrclib.net/api/search?' + new URLSearchParams({ q: `${name} ${artist}` })); if (r2.ok) hit = pick(await r2.json()); }
        } catch { /* ignore */ }
      }
      if (!hit) return null;
      const lines = hit.syncedLyrics ? Lyrics.parse(hit.syncedLyrics).filter((l) => l.text) : null;
      return { lines: lines && lines.length ? lines : null, plain: hit.plainLyrics || '', dur: +hit.duration || 0 };
    })().catch(() => null);
    this.mem.set(key, job);
    return job;
  },

  /** the video's extra seconds before the song (MV intro): video length − lyrics length, when it looks like one */
  offset(videoDur, lyricsDur) {
    const diff = (videoDur || 0) - (lyricsDur || 0);
    return lyricsDur && videoDur && diff > 2.5 && diff < 120 ? Math.round(diff) : 0;
  },
  /** user's own ± correction per video (this browser only) */
  adj(vid) { return (store.get('dscAdj', {}) || {})[vid] || 0; },
  setAdj(vid, v) { const m = store.get('dscAdj', {}) || {}; if (v) m[vid] = v; else delete m[vid]; const k = Object.keys(m); if (k.length > 300) delete m[k[0]]; store.set('dscAdj', m); },

  /* =========================================================
   * Chorus estimation from synced lyrics: the most repeated multi-line block,
   * its earliest occurrence after the first ~20% of the song. Fallback: 35% of the song.
   * ======================================================= */
  chorus(lines, dur) {
    const fallback = { t: Math.round((dur || 0) * 0.35), line: '', est: true };
    if (!lines || lines.length < 6) return lines?.length ? this.near(lines, fallback.t) : fallback;
    const norm = lines.map((l) => (l.text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''));
    const total = dur || lines[lines.length - 1].t + 10;
    let best = null;
    for (let L = 4; L >= 2; L--) {
      const map = new Map();
      for (let i = 0; i + L <= lines.length; i++) {
        const blk = norm.slice(i, i + L); if (blk.some((x) => !x)) continue;
        if (new Set(blk).size === 1 && blk[0].length < 6) continue; // "la la la" / "oh oh oh"
        const key = blk.join('|');
        const at = map.get(key) || [];
        if (!at.length || i >= at[at.length - 1] + L) at.push(i); // non-overlapping occurrences
        map.set(key, at);
      }
      for (const at of map.values()) {
        if (at.length < 2) continue;
        const score = at.length * L;
        if (!best || score > best.score || (score === best.score && at[0] < best.at[0])) best = { score, at, L };
      }
    }
    if (!best) return fallback;
    // extend the block backwards while the lines before two occurrences still match (finds the start of the chorus)
    let at = best.at.slice();
    for (let k = 0; k < 4; k++) {
      if (at[0] - 1 < 0 || !norm[at[0] - 1] || norm[at[0] - 1] !== norm[at[1] - 1] || at[1] - 1 <= at[0]) break;
      at = at.map((i) => i - 1);
    }
    const i = at.find((x) => lines[x].t >= total * 0.2) ?? at[0];
    return { t: lines[i].t, line: lines[i].text, est: true };
  },
  /** the lyric line at (or just before) time t */
  near(lines, t) { let i = 0; lines.forEach((l, k) => { if (l.t <= t + 0.3) i = k; }); return { t, line: lines[i]?.text || '', est: true }; },
  lineIndex(lines, cur) { let i = -1; for (let k = 0; k < lines.length; k++) { if (lines[k].t <= cur + 0.25) i = k; else break; } return i; },

  /** where a song should start: its moment, or the estimated chorus */
  async startOf(song) {
    const s = { id: song.videoId || song.id, title: song.title, artist: song.artist, d: song.d || 0 };
    const ly = await this.lrc(s);
    if (song.moment && Number.isFinite(+song.moment.t)) return { t: +song.moment.t, line: song.moment.line || '', est: false, ly };
    const c = this.chorus(ly?.lines, ly?.dur || s.d);
    return { ...c, ly };
  },

  /* =========================================================
   * Preview: plays with app.js Player from the moment for ~20 s, lyrics around it in a compact panel above the dock
   * ======================================================= */
  pv: null,
  preview(song) {
    if (!song || !song.videoId) return;
    if (song.embed === false) return toast('この曲は権利者の設定でこのサイト内では再生できません');
    const onPage = S.view?.song && S.view.song.sid === song.sid && S.view.tracks?.[0];
    if (!onPage && /^\/(p\/|bookmarks)/.test(location.pathname)) return go('/s/' + song.sid); // these pages own the play queue
    this.stop();
    Pick.close(null);
    let t;
    if (onPage) t = S.view.tracks[0];
    else {
      if (Player.idx >= 0) Player.close();
      t = { id: song.videoId, name: song.title, artist: song.artist, d: song.d || 0, embed: true, thumb: song.art || song.thumb, isMv: song.src === 'mv' };
      S.view = { id: 'dsc:' + (song.sid || song.videoId), kind: 'dsc', tracks: [t], song };
    }
    const same = Player.idx === 0 && Player.yt && Player.track === t;
    if (Player.pip) Player.setPip(false);
    if (Lyrics.open) { Lyrics.open = false; Lyrics.hide(); document.getElementById('pl-lyrics')?.classList.remove('on'); }
    if (!same) { Player.order = null; Player.play(0); } // started inside the tap (iPhone autoplay rule)
    const pv = this.pv = { song, t, full: false, start: null, ly: null, off: 0, adj: this.adj(song.videoId), seeked: false, vid: null, began: Date.now(), ended: false };
    this.drawPanel();
    this.startOf(song).then((st) => {
      if (this.pv !== pv) return;
      pv.start = st; pv.ly = st.ly; this.drawPanel();
      if (same) this.seek();
    });
    clearInterval(this.timer); this.timer = setInterval(() => this.tick(), 200);
  },
  /** video time of the preview start */
  vStart() { const pv = this.pv; return Math.max(0, (pv.start?.t || 0) + pv.off + pv.adj); },
  seek() {
    const pv = this.pv; if (!pv || !Player.yt?.seekTo) return;
    const dur = Player.yt.getDuration?.() || 0;
    pv.off = this.offset(dur, pv.ly?.dur);
    pv.vid = Player.yt.getVideoData?.()?.video_id || null;
    pv.seeked = true; pv.ended = false;
    Player.yt.seekTo(this.vStart(), true);
    if (!Player.playing) Player.yt.playVideo?.();
  },
  tick() {
    const pv = this.pv; if (!pv) return clearInterval(this.timer);
    if (Player.idx < 0 || Player.track !== pv.t) return this.stop(); // the player was closed or moved on
    const yt = Player.yt, st = yt?.getPlayerState?.();
    if (!pv.seeked) {
      if (pv.start && (st === 1 || st === 3) && (yt.getDuration?.() || 0) > 0) this.seek();
      else if (Date.now() - pv.began > 20000 && !pv.start) return this.stop();
      return;
    }
    const vid = yt?.getVideoData?.()?.video_id;
    if (pv.vid && vid && vid !== pv.vid) { pv.full = true; return this.stop(); } // switched to the MV / audio: the dock takes over
    const cur = yt?.getCurrentTime?.() || 0, s = this.vStart(), e = s + this.PREVIEW_SEC;
    if (!pv.full) {
      if (cur > e + 4 || cur < s - 6) pv.full = true; // the user moved the seek bar: let it play
      else if (cur >= e && !pv.ended) { pv.ended = true; yt.pauseVideo?.(); }
    }
    this.syncPanel(cur);
  },
  /** 全部聴く: keep the card and play to the end; pressed again (小さくして聴き続ける) it hands over to the normal player dock */
  full() {
    const pv = this.pv; if (!pv) return;
    if (pv.full) return this.stop();
    pv.full = true; pv.ended = false;
    if (!Player.playing) Player.yt?.playVideo?.();
    this.drawPanel();
  },
  replay() { const pv = this.pv; if (!pv) return; pv.full = false; this.seek(); this.drawPanel(); },
  nudge(d) {
    const pv = this.pv; if (!pv) return;
    pv.adj = Math.max(-60, Math.min(60, pv.adj + d)); this.setAdj(pv.song.videoId, pv.adj);
    pv.full = false; pv.ended = false;
    if (pv.seeked) Player.yt?.seekTo?.(this.vStart(), true);
    if (!Player.playing) Player.yt?.playVideo?.();
    const a = document.getElementById('dsc-adj'); if (a) a.textContent = pv.adj ? `${pv.adj > 0 ? '+' : ''}${pv.adj}秒` : 'ずれ補正';
  },
  /** 曲の詳細: leave the card (music keeps playing in the dock) and open the song page */
  detail() {
    const pv = this.pv; if (!pv) return;
    const sid = pv.song.sid, here = S.view?.song?.sid === sid && location.pathname === '/s/' + sid;
    pv.full = true; this.stop();
    if (sid && !here) go('/s/' + sid);
  },
  /** end the preview card; pause=true also pauses a preview that was still inside its ~20 s */
  stop(pause) {
    clearInterval(this.timer); this.timer = null;
    if (pause && this.pv && !this.pv.full && Player.playing) Player.yt?.pauseVideo?.();
    this.pv = null;
    const el = document.getElementById('dsc-pv');
    if (el) { el.classList.add('out'); setTimeout(() => el.remove(), 220); }
    document.body.classList.remove('dsc-pv-open');
    removeEventListener('resize', this.onResize);
  },
  /** put the (single) YouTube player exactly on the card's video slot: the iframe is never moved in the DOM */
  place() {
    const slot = document.getElementById('dsc-pv-vslot'); if (!slot) return;
    const r = slot.getBoundingClientRect(), b = document.body.style;
    b.setProperty('--pvv-x', Math.round(r.left) + 'px'); b.setProperty('--pvv-y', Math.round(r.top) + 'px');
  },
  onResize: () => Discover.place(),
  drawPanel() {
    const pv = this.pv; if (!pv) return;
    let el = document.getElementById('dsc-pv');
    if (!el) { el = document.createElement('div'); el.id = 'dsc-pv'; el.className = 'dsc-pv'; document.body.appendChild(el); addEventListener('resize', this.onResize); }
    el.classList.remove('out');
    const so = pv.song, st = pv.start, lines = pv.ly?.lines;
    const art = so.art || so.thumb || (so.videoId ? `https://i.ytimg.com/vi/${so.videoId}/hqdefault.jpg` : '');
    const label = pv.full ? '全曲を再生中' : !st ? '試聴の準備中…' : st.est ? `推定サビから試聴 ・ ${this.fmt(st.t)}〜` : `ここを聴いて ・ ${this.fmt(st.t)}〜`;
    const ps = typeof recPeople === 'function' ? recPeople(so) : so.by ? [{ id: so.byId, name: so.by }] : [];
    const by = ps.length ? `${ps.slice(0, 2).map((x) => esc(x.name) + 'さん').join('、')}${ps.length > 2 ? `ほか${ps.length - 2}人` : ''}のおすすめ` : '';
    const here = S.view?.song?.sid === so.sid && location.pathname === '/s/' + so.sid;
    const scenes = this.sceneTags(so);
    el.innerHTML = `<div class="dsc-pv-card" role="dialog" aria-label="${esc(so.title)} の試聴" style="--pv-art:url('${esc(art)}')">
      <button class="dsc-pv-close" data-act="dsc-pv-close" aria-label="試聴を閉じる">${ICON.close}</button>
      <div class="dsc-pv-deck ${Player.playing ? 'spin' : ''}" id="dsc-pv-deck">
        <span class="dsc-pv-disc"><span class="dsc-pv-lbl">${art ? `<img src="${esc(art)}" alt="">` : ''}<i></i></span></span>
        <div class="dsc-pv-vslot" id="dsc-pv-vslot"></div>
      </div>
      <div class="dsc-pv-info">
        <span class="dsc-pv-k ${pv.full ? 'full' : st && !st.est ? 'pick' : ''}">${esc(label)}</span>
        <b class="dsc-pv-title">${esc(so.title)}</b>
        <span class="dsc-pv-artist">${esc(so.artist || '')}${by ? ` ・ ${by}` : ''}</span>
        ${scenes ? `<div class="dsc-pv-scenes">${scenes}</div>` : ''}
      </div>
      <div class="dsc-pv-ly" id="dsc-pv-ly">${lines ? lines.map((l, i) => `<p data-i="${i}">${esc(l.text)}</p>`).join('')
        : `<p class="on solo">${st ? esc(this.lineOf(so) || (pv.ly ? '（同期歌詞がない曲です）' : '（歌詞が見つかりませんでした）')) : '<span class="spinner"></span>'}</p>`}</div>
      <div class="dsc-pv-bar"><i id="dsc-pv-bar"></i></div>
      <div class="dsc-pv-ctl">
        <span class="dsc-pv-adjg"><button class="dsc-mini" data-act="dsc-adj" data-d="-1" aria-label="1秒早める">−1</button><span class="dsc-adj" id="dsc-adj">${pv.adj ? `${pv.adj > 0 ? '+' : ''}${pv.adj}秒` : 'ずれ補正'}</span><button class="dsc-mini" data-act="dsc-adj" data-d="1" aria-label="1秒遅らせる">+1</button></span>
        <span class="spacer"></span>
        <button class="btn sm quiet" data-act="dsc-replay">もう一度</button>
        <button class="dsc-pv-pp" data-act="p-toggle" id="dsc-pv-pp" aria-label="再生/一時停止">${Player.playing ? ICON.pause : ICON.play}</button>
      </div>
      <div class="dsc-pv-foot">
        <button class="btn solid" data-act="dsc-full">${pv.full ? '小さくして聴き続ける' : '全部聴く'}</button>
        <button class="btn dsc-pv-detail" data-act="dsc-detail">${here ? '曲のページに戻る' : '曲の詳細・コメント'}<span aria-hidden="true">›</span></button>
      </div>
    </div>`;
    document.body.classList.add('dsc-pv-open');
    this.place(); requestAnimationFrame(() => this.place());
    pv.cur = -2; pv.pp = null;
  },
  syncPanel(cur) {
    const pv = this.pv; if (!pv) return;
    const s = this.vStart(), bar = document.getElementById('dsc-pv-bar'), dur = Player.yt?.getDuration?.() || 0;
    if (bar) bar.style.width = (pv.full ? (dur ? (cur / dur) * 100 : 0) : Math.max(0, Math.min(100, ((cur - s) / this.PREVIEW_SEC) * 100))).toFixed(1) + '%';
    if (pv.pp !== Player.playing) {
      pv.pp = Player.playing;
      const pp = document.getElementById('dsc-pv-pp'); if (pp) pp.innerHTML = Player.playing ? ICON.pause : ICON.play;
      document.getElementById('dsc-pv-deck')?.classList.toggle('spin', !!Player.playing);
    }
    const lines = pv.ly?.lines; if (!lines) return;
    const i = this.lineIndex(lines, cur - pv.off - pv.adj);
    if (i === pv.cur) return; pv.cur = i;
    const box = document.getElementById('dsc-pv-ly'); if (!box) return;
    box.querySelector('p.on')?.classList.remove('on');
    const p = box.querySelector(`p[data-i="${Math.max(i, 0)}"]`);
    if (p) { if (i >= 0) p.classList.add('on'); box.scrollTo({ top: p.offsetTop - box.clientHeight / 2 + p.clientHeight / 2, behavior: 'smooth' }); }
  },

  /* =========================================================
   * Song page slot #song-moment
   * ======================================================= */
  sceneTags(song) { return (song.scenes || []).map((id) => this.sceneName(id)).filter(Boolean).map((n) => `<span class="dsc-scene">${esc(n)}</span>`).join(''); },
  drawSlot(so) {
    const el = document.getElementById('song-moment'); if (!el) return;
    const line = this.lineOf(so), has = !!(so.moment && Number.isFinite(+so.moment.t));
    el.innerHTML = `<section class="dsc-moment ${line ? '' : 'noline'}">
      ${line ? `<div class="dsc-k">刺さった一行</div><p class="dsc-line">${esc(line)}</p>` : ''}
      <div class="dsc-row">
        <button class="btn solid dsc-listen" data-act="dsc-pv-song">${ICON.play}<span>${has ? 'ここから聴く' : '推定サビから聴く'}</span><em id="dsc-at">${has ? this.fmt(so.moment.t) + '〜' : ''}</em></button>
        <span class="dsc-scenes">${this.sceneTags(so)}</span>
      </div>
      <div id="dsc-own"></div>
    </section>`;
    if (!has && so.embed !== false) this.startOf(so).then((st) => { const a = document.getElementById('dsc-at'); if (a && S.view?.song === so) a.textContent = this.fmt(st.t) + '〜'; });
    if (Api.connected()) Api.myId().then((me) => {
      if (me !== so.byId || S.view?.song !== so) return;
      const o = document.getElementById('dsc-own');
      if (o) o.innerHTML = `<button class="dsc-edit" data-act="dsc-edit">${ICON.pen}${has ? '「ここを聴いて」・場面を編集' : '「ここを聴いて」と場面を追加'}</button>`;
    });
  },
  /** owner-only inline editor for moment + scenes (PUT /api/songs with only these fields) */
  edit: null,
  openEdit() {
    const so = S.view?.song; if (!so) return;
    this.edit = { moment: so.moment ? { ...so.moment } : null, scenes: [...(so.scenes || [])] };
    this.drawEdit();
  },
  drawEdit() {
    const o = document.getElementById('dsc-own'), e = this.edit; if (!o || !e) return;
    o.innerHTML = `<div class="dsc-editor">
      <div class="dsc-lbl">ここを聴いて</div>${this.momentField(e.moment, 'dsc-e-moment')}
      <div class="dsc-lbl">場面（3つまで）</div>${this.scenePicker('dsc-e-scenes', e.scenes)}
      <div class="row"><span class="spacer"></span><button class="btn quiet sm" data-act="dsc-edit-cancel">やめる</button><button class="btn accent sm" data-act="dsc-edit-save">保存</button></div></div>`;
  },
  async saveEdit(btn) {
    const so = S.view?.song, e = this.edit; if (!so || !e) return;
    btn.disabled = true;
    try {
      const h = await Social.headers(); if (!h) throw new Error('ログインしてください');
      const r = await fetch('/api/songs?sid=' + encodeURIComponent(so.sid), { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ moment: e.moment, scenes: e.scenes }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || '保存できませんでした');
      so.moment = j.item?.moment; so.scenes = j.item?.scenes || [];
      if (!so.moment) delete so.moment;
      this.edit = null; Songs.list = null; toast('保存しました'); this.drawSlot(so);
    } catch (err) { toast(err.message, 4000); btn.disabled = false; }
  },

  /* ---- shared form parts (post form in community.js and the editor above) ---- */
  momentField(m, id) {
    return `<div class="dsc-mf" id="${id}">${m ? `<div class="dsc-mf-on"><span class="dsc-time">${this.fmt(m.t)}</span><span class="dsc-mf-line">${m.line ? esc(m.line) : '<span class="muted">（一行なし）</span>'}</span>
        <button class="btn sm quiet" data-act="dsc-mf-pick" data-for="${id}">変更</button><button class="dsc-x" data-act="dsc-mf-clear" data-for="${id}" aria-label="指定をやめる">${ICON.close}</button></div>`
      : `<button class="dsc-mf-btn" data-act="dsc-mf-pick" data-for="${id}"><span class="dsc-mf-ic">${ICON.note}</span><span><b>一番聴いてほしい瞬間を選ぶ</b><small>歌詞の「刺さった一行」をタップして指定。選ばなければサビを自動で推定します</small></span></button>`}</div>`;
  },
  scenePicker(id, sel) {
    return `<div class="dsc-chips" id="${id}">${this.SCENES.map(([k, n]) => `<button type="button" class="dsc-chip ${sel.includes(k) ? 'on' : ''}" data-act="dsc-scene" data-for="${id}" data-k="${k}" aria-pressed="${sel.includes(k)}">${esc(n)}</button>`).join('')}</div>`;
  },
  /** form state behind a field id: the song being posted (Songs.picked) or the editor */
  stateFor(id) { return id.startsWith('dsc-e-') ? this.edit : (typeof Songs !== 'undefined' ? Songs.picked : null); },
  /** extra fields for the おすすめ曲 post form (community.js) */
  postFields(p) {
    return `<label class="small muted">ここを聴いて（任意）</label>${this.momentField(p.moment || null, 'dsc-p-moment')}
      <label class="small muted">場面（任意・3つまで）</label>${this.scenePicker('dsc-p-scenes', p.scenes || [])}`;
  },
  postBody(p) { return { ...(p.moment ? { moment: p.moment } : {}), scenes: p.scenes || [] }; },

  action(act, el) {
    switch (act) {
      case 'dsc-pv-song': if (S.view?.song) this.preview(S.view.song); return true;
      case 'dsc-pv-close': this.stop(); Player.close(); return true;
      case 'dsc-detail': this.detail(); return true;
      case 'dsc-full': this.full(); return true;
      case 'dsc-replay': this.replay(); return true;
      case 'dsc-adj': this.nudge(+el.dataset.d || 0); return true;
      case 'dsc-edit': this.openEdit(); return true;
      case 'dsc-edit-cancel': this.edit = null; if (S.view?.song) this.drawSlot(S.view.song); return true;
      case 'dsc-edit-save': this.saveEdit(el); return true;
      case 'dsc-scene': {
        const id = el.dataset.for, st = this.stateFor(id); if (!st) return true;
        const sc = st.scenes = st.scenes || [], k = el.dataset.k, i = sc.indexOf(k);
        if (i >= 0) sc.splice(i, 1); else { if (sc.length >= 3) { toast('場面は3つまで選べます'); return true; } sc.push(k); }
        el.classList.toggle('on', i < 0); el.setAttribute('aria-pressed', String(i < 0));
        return true;
      }
      case 'dsc-mf-clear': { const id = el.dataset.for, st = this.stateFor(id); if (st) { st.moment = null; document.getElementById(id).outerHTML = this.momentField(null, id); } return true; }
      case 'dsc-mf-pick': {
        const id = el.dataset.for, st = this.stateFor(id); if (!st) return true;
        const so = id.startsWith('dsc-e-') ? S.view?.song : null;
        const arg = so ? { id: so.videoId, title: so.title, artist: so.artist, d: so.d || 0, moment: st.moment }
          : { id: st.videoId, title: document.getElementById('song-title')?.value.trim() || st.name, artist: document.getElementById('song-artist')?.value.trim() || st.artist, d: st.d || 0, moment: st.moment };
        this.pickMoment(arg).then((m) => {
          if (!m || this.stateFor(id) !== st) return;
          st.moment = m; const box = document.getElementById(id); if (box) box.outerHTML = this.momentField(m, id);
        });
        return true;
      }
      case 'dsc-pk-line': Pick.choose(+el.dataset.i); return true;
      case 'dsc-pk-plain': Pick.plainLine(el); return true;
      case 'dsc-pk-nudge': Pick.nudge(+el.dataset.d || 0); return true;
      case 'dsc-pk-play': Pick.playSel(); return true;
      case 'dsc-pk-now': Pick.useNow(); return true;
      case 'dsc-pk-ok': Pick.ok(); return true;
      case 'dsc-pk-cancel': Pick.close(null); return true;
    }
    return false;
  },

  pickMoment(s) { return Pick.open(s); },
};

/* =========================================================
 * pickMoment modal: its own YouTube player (the app's player is closed first, so there is one video on screen)
 * ======================================================= */
const Pick = {
  el: null, yt: null, resolve: null, s: null, ly: null, sel: null, off: 0, timer: null, cur: -2,
  async open(s) {
    if (this.resolve) this.close(null);
    Discover.stop();
    if (typeof Player !== 'undefined' && Player.idx >= 0) Player.close(); // one embed on screen
    this.s = s; this.ly = null; this.off = 0; this.cur = -2;
    this.sel = s.moment && Number.isFinite(+s.moment.t) ? { t: +s.moment.t, line: s.moment.line || '' } : null;
    const el = this.el = document.createElement('div');
    el.className = 'dsc-pick'; el.id = 'dsc-pick';
    el.innerHTML = `<div class="dsc-pick-bg" data-act="dsc-pk-cancel"></div>
      <div class="dsc-pick-card" role="dialog" aria-modal="true" aria-label="ここを聴いて を選ぶ">
        <div class="dsc-pick-head"><div style="min-width:0"><div class="dsc-k">ここを聴いて</div><b>${esc(s.title)}</b><span>${esc(s.artist)}</span></div>
          <button class="dsc-x" data-act="dsc-pk-cancel" aria-label="閉じる">${ICON.close}</button></div>
        <div class="dsc-pick-video"><div id="dsc-pick-yt"></div></div>
        <div class="dsc-pick-sel" id="dsc-pk-sel"></div>
        <div class="dsc-pick-body" id="dsc-pk-body"><div class="loading" style="padding:18px 0"><span class="spinner"></span> 歌詞を探しています…</div></div>
        <div class="dsc-pick-foot"><button class="btn quiet" data-act="dsc-pk-cancel">やめる</button><button class="btn accent" data-act="dsc-pk-ok" id="dsc-pk-ok">この瞬間にする</button></div>
      </div>`;
    document.body.appendChild(el); document.body.classList.add('modal-open');
    requestAnimationFrame(() => el.classList.add('on'));
    const done = new Promise((r) => { this.resolve = r; });
    this.drawSel();
    // player (no autoplay: sound starts when the user taps a line or 再生)
    Player.load().then(() => {
      if (this.el !== el || !document.getElementById('dsc-pick-yt')) return;
      this.yt = new window.YT.Player('dsc-pick-yt', { width: '356', height: '200', videoId: s.id, playerVars: { autoplay: 0, playsinline: 1, rel: 0 },
        events: { onReady: () => this.onReady() } });
    });
    clearInterval(this.timer); this.timer = setInterval(() => this.tick(), 250);
    Discover.lrc({ id: s.id, title: s.title, artist: s.artist, d: s.d }).then((ly) => { if (this.el === el) { this.ly = ly; this.drawBody(); this.onReady(); } });
    return done;
  },
  onReady() {
    const dur = this.yt?.getDuration?.() || 0;
    if (dur && this.ly?.dur) this.off = Discover.offset(dur, this.ly.dur);
    const r = document.getElementById('dsc-pk-range'); if (r && dur) r.max = String(Math.floor(dur));
  },
  get dur() { return this.yt?.getDuration?.() || this.s?.d || this.ly?.dur || 300; },
  drawBody() {
    const b = document.getElementById('dsc-pk-body'); if (!b) return;
    const lines = this.ly?.lines;
    if (lines) {
      b.innerHTML = `<div class="dsc-pick-tip">刺さった一行をタップ。その行から再生します</div>
        <div class="dsc-pick-lines">${lines.map((l, i) => `<button class="dsc-pk-line ${this.sel && Math.abs(this.sel.t - l.t) < 0.05 ? 'sel' : ''}" data-act="dsc-pk-line" data-i="${i}"><span class="tm">${Discover.fmt(l.t)}</span><span class="tx">${esc(l.text)}</span></button>`).join('')}</div>
        <div class="ly-credit">歌詞提供: LRCLIB</div>`;
      const s = b.querySelector('.sel'), ls = b.querySelector('.dsc-pick-lines'); if (s) b.scrollTop = ls.offsetTop + s.offsetTop - 80;
      return;
    }
    const t = this.sel?.t ?? 0;
    b.innerHTML = `<div class="dsc-pick-tip">${this.ly ? 'この曲には時間つきの歌詞がありません。' : '歌詞が見つかりませんでした。'}つまみで聴いてほしい位置を選んでください</div>
      <div class="dsc-pk-slider"><input type="range" class="seek" id="dsc-pk-range" min="0" max="${Math.floor(this.dur)}" step="1" value="${Math.floor(t)}" aria-label="聴いてほしい位置"><span class="dsc-time" id="dsc-pk-rt">${Discover.fmt(t)}</span></div>
      <button class="btn sm quiet" data-act="dsc-pk-now">再生中の位置にする</button>
      <label class="small muted" for="dsc-pk-text">刺さった一行（任意・120文字まで）</label>
      <input class="input" id="dsc-pk-text" maxlength="120" placeholder="歌詞の一行や、聴きどころのひとこと" value="${esc(this.sel?.line || '')}">
      ${this.ly?.plain ? `<details class="dsc-pk-plain"><summary>歌詞から一行を選ぶ</summary>${this.ly.plain.split('\n').filter((x) => x.trim()).map((x) => `<button data-act="dsc-pk-plain">${esc(x.trim())}</button>`).join('')}</details>` : ''}`;
    const r = document.getElementById('dsc-pk-range');
    r.addEventListener('input', () => { this.sel = { t: +r.value, line: document.getElementById('dsc-pk-text').value.trim() }; document.getElementById('dsc-pk-rt').textContent = Discover.fmt(+r.value); this.drawSel(); });
    r.addEventListener('change', () => this.playSel());
    document.getElementById('dsc-pk-text').addEventListener('input', (e) => { this.sel = { t: this.sel?.t ?? +r.value, line: e.target.value.trim() }; this.drawSel(); });
  },
  drawSel() {
    const el = document.getElementById('dsc-pk-sel'); if (!el) return;
    const s = this.sel;
    el.innerHTML = s ? `<div class="dsc-pk-now"><span class="dsc-time">${Discover.fmt(s.t)}</span><span class="dsc-mf-line">${s.line ? esc(s.line) : '<span class="muted">（一行なし）</span>'}</span></div>
      <div class="dsc-pk-tools"><button class="dsc-mini" data-act="dsc-pk-nudge" data-d="-1" aria-label="1秒前へ">−1秒</button><button class="dsc-mini" data-act="dsc-pk-nudge" data-d="1" aria-label="1秒後へ">+1秒</button><button class="btn sm solid" data-act="dsc-pk-play">${ICON.play} ここを聴く</button></div>`
      : '<div class="dsc-pk-empty">まだ選んでいません</div>';
    const ok = document.getElementById('dsc-pk-ok'); if (ok) ok.disabled = !s;
  },
  choose(i) {
    const l = this.ly?.lines?.[i]; if (!l) return;
    this.sel = { t: l.t, line: l.text.slice(0, 120) };
    this.el?.querySelectorAll('.dsc-pk-line.sel').forEach((x) => x.classList.remove('sel'));
    this.el?.querySelector(`.dsc-pk-line[data-i="${i}"]`)?.classList.add('sel');
    this.drawSel(); this.playSel();
  },
  plainLine(btn) { const tx = document.getElementById('dsc-pk-text'); if (!tx) return; tx.value = btn.textContent.slice(0, 120); tx.dispatchEvent(new Event('input')); btn.closest('details').open = false; },
  nudge(d) {
    if (!this.sel) return;
    this.sel.t = Math.max(0, Math.min(3600, Math.round((this.sel.t + d) * 10) / 10));
    const r = document.getElementById('dsc-pk-range'); if (r) { r.value = String(Math.floor(this.sel.t)); document.getElementById('dsc-pk-rt').textContent = Discover.fmt(this.sel.t); }
    this.drawSel(); this.playSel();
  },
  playSel() { if (!this.sel || !this.yt?.seekTo) return; this.yt.seekTo(Math.max(0, this.sel.t + this.off), true); this.yt.playVideo(); },
  useNow() {
    const cur = this.yt?.getCurrentTime?.(); if (cur == null) return;
    const t = Math.max(0, Math.round(cur - this.off));
    const r = document.getElementById('dsc-pk-range'); if (r) { r.value = String(t); document.getElementById('dsc-pk-rt').textContent = Discover.fmt(t); }
    this.sel = { t, line: document.getElementById('dsc-pk-text')?.value.trim() || '' }; this.drawSel();
  },
  tick() {
    const lines = this.ly?.lines; if (!lines || !this.yt?.getCurrentTime || this.yt.getPlayerState?.() !== 1) return;
    const i = Discover.lineIndex(lines, this.yt.getCurrentTime() - this.off);
    if (i === this.cur) return; this.cur = i;
    this.el?.querySelector('.dsc-pk-line.on')?.classList.remove('on');
    this.el?.querySelector(`.dsc-pk-line[data-i="${i}"]`)?.classList.add('on');
  },
  ok() { if (this.sel) this.close({ t: Math.round(this.sel.t * 10) / 10, line: (this.sel.line || '').slice(0, 120) }); },
  close(val) {
    clearInterval(this.timer); this.timer = null;
    try { this.yt?.destroy(); } catch { /* ignore */ }
    this.yt = null;
    const el = this.el; this.el = null;
    if (el) { el.classList.remove('on'); setTimeout(() => el.remove(), 220); document.body.classList.remove('modal-open'); }
    const r = this.resolve; this.resolve = null; if (r) r(val);
  },
};

/* ---- plug into app.js (it loads after this file: wait until its Hooks exist) ---- */
window.Discover = Discover;
(function plug() {
  if (typeof Hooks === 'undefined') return setTimeout(plug, 0);
  Hooks.actions.push((act, el, ev) => (act.startsWith('dsc-') ? Discover.action(act, el, ev) : false));
  Hooks.song.push((so) => { Discover.edit = null; Discover.drawSlot(so); });
  // a song page drawn before this ran
  if (typeof S !== 'undefined' && S.view?.song && document.getElementById('song-moment') && !document.querySelector('#song-moment .dsc-moment')) Discover.drawSlot(S.view.song);
})();
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && Pick.el) Pick.close(null); });
