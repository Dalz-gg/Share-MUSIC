/* Share MUSIC — Stage 3 — 今週のお題 (weekly theme, one song per person).
 * Plugs into app.js through Hooks (see the top of app.js). Loaded before app.js; only refer to app.js globals inside functions.
 *   home  : fills #home-topic (compact card: theme, 「答える」, a row of answers)
 *   pages : /topic (this week), /topic/<YYYY-Www> (a past week's "みんなの答え"), /topic/past (all past themes)
 *   admin : Topics.adminDraw(el, token) draws the theme editor inside the admin page's "お題" tab
 * Server: netlify/functions/topics.mjs (/api/topic, /api/topics, /api/topic-admin). */
'use strict';

const Topics = {
  cur: null,          // this week's topic (GET /api/topic)
  loading: null,
  lists: {},          // answers shown on screen, by key ('cur' or a week id), for tap-to-play
  past: null,         // archive list
  f: null,            // the answer form state

  /* ---------- data ---------- */
  async load(force) {
    if (this.cur && !force && Date.now() - this.cur._at < 60000) return this.cur;
    if (this.loading && !force) return this.loading;
    this.loading = (async () => {
      const r = await fetch('/api/topic');
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'お題を読み込めませんでした');
      j._at = Date.now(); this.cur = j; return j;
    })();
    try { return await this.loading; } finally { this.loading = null; }
  },
  async myId() { try { return Api.connected() ? await Api.myId() : null; } catch { return null; } },
  mine(t, me) { return me ? (t.answers || []).find((a) => a.uid === me) || null : null; },
  md: (s) => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(s || ''); return m ? `${+m[1]}/${+m[2]}` : ''; },
  range(t) { return `${this.md(t.start)} – ${this.md(t.end)}`; },
  cover: (a) => a.art || a.thumb || `https://i.ytimg.com/vi/${a.id}/mqdefault.jpg`,
  fmtT: (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`,
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5z"/><path d="M13.5 7.5v5.2"/><circle cx="11.6" cy="12.8" r="1.9"/><path d="M13.5 7.5l2.5.8"/></svg>',

  /* ---------- playing an answer ---------- */
  asSong(a) {
    return { sid: a.sid || '', videoId: a.id, title: a.title, artist: a.artist, art: a.art || '', thumb: a.thumb, d: a.d || 0, embed: true,
      moment: a.moment || null, desc: a.note || '', by: a.name, byId: a.uid };
  },
  play(key, i) {
    const list = this.lists[key] || [], a = list[i]; if (!a) return;
    if (window.Discover?.preview) { try { window.Discover.preview(this.asSong(a)); return; } catch (e) { console.error(e); } }
    // without the preview player: queue every answer in the shared player, starting at this one
    const tracks = list.map((x) => ({ id: x.id, name: x.title, artist: x.artist, d: x.d || 0, embed: true, thumb: this.cover(x) }));
    if (Player.idx >= 0) Player.close();
    S.view = { id: 'topic:' + key, kind: 'topic', p: { id: 'topic', title: '今週のお題', image: tracks[i].thumb }, tracks };
    Player.order = null; Player.play(i);
    const t = a.moment?.t || 0;
    if (t > 0) { // jump to "ここを聴いて" once the video is playing
      let n = 0; const iv = setInterval(() => {
        if (++n > 40 || Player.idx !== i) return clearInterval(iv);
        if (Player.yt?.getPlayerState?.() === 1) { clearInterval(iv); Player.yt.seekTo(t, true); }
      }, 300);
    }
  },

  /* ---------- pieces ---------- */
  tile(a, key, i) {
    const line = window.Discover?.lineOf ? window.Discover.lineOf(this.asSong(a)) || a.moment?.line : a.moment?.line;
    return `<button class="tpc-tile" data-act="tpc-play" data-k="${esc(key)}" data-i="${i}" aria-label="${esc(a.title)} を試聴">
      <span class="tpc-cov"><img src="${esc(this.cover(a))}" alt="" loading="lazy"><i class="tpc-pl" aria-hidden="true">${ICON.play}</i></span>
      <span class="tpc-tline">${line ? `「${esc(line)}」` : esc(a.title)}</span>
      <span class="tpc-tby">${esc(a.name)}</span></button>`;
  },
  card(a, key, i, me) {
    const line = a.moment?.line || '';
    return `<article class="tpc-ans ${a.uid === me ? 'me' : ''}">
      <button class="tpc-ans-art" data-act="tpc-play" data-k="${esc(key)}" data-i="${i}" aria-label="${esc(a.title)} を試聴"><img src="${esc(this.cover(a))}" alt="" loading="lazy"><i class="tpc-pl" aria-hidden="true">${ICON.play}</i></button>
      <div class="tpc-ans-body">
        ${line ? `<p class="tpc-line">「${esc(line)}」</p>` : ''}
        <div class="tpc-song"><b>${esc(a.title)}</b><span>${esc(a.artist)}${a.moment?.t ? ` ・ ${this.fmtT(a.moment.t)}〜` : ''}</span></div>
        ${a.note ? `<p class="tpc-note">${esc(a.note)}</p>` : ''}
        <div class="tpc-by">${Avatars.chip(a.uid, a.name)}<span class="tiny muted">${ago(a.ts)}</span>${a.sid ? `<a class="tpc-songlink tiny" href="/s/${esc(a.sid)}" data-act="go" data-to="/s/${esc(a.sid)}">曲のページ</a>` : ''}</div>
      </div></article>`;
  },

  /* ---------- home: compact card in #home-topic ---------- */
  async home() {
    if (location.pathname !== '/' || location.hash) return;
    let el = document.getElementById('home-topic');
    if (!el) { // the home page does not have the slot (older home): put it under the top section
      const app = document.getElementById('app'); if (!app) return;
      el = document.createElement('div'); el.id = 'home-topic';
      const after = app.querySelector('#feature');
      if (after) after.after(el); else app.prepend(el);
    }
    el.innerHTML = '<section class="tpc-home tpc-skel"><span class="tpc-kicker">今週のお題</span><div class="tpc-skel-line"></div><div class="tpc-strip"><i></i><i></i><i></i></div></section>';
    let t, me;
    try { [t, me] = await Promise.all([this.load(), this.myId()]); } catch { el.innerHTML = ''; return; }
    if (!el.isConnected) return;
    const mine = this.mine(t, me), list = t.answers || [];
    this.lists.cur = list;
    el.innerHTML = `<section class="tpc-home">
      <div class="tpc-head"><span class="tpc-kicker">${this.icon}今週のお題</span><span class="tpc-dates">${this.range(t)}</span></div>
      <a class="tpc-htitle" href="/topic" data-act="go" data-to="/topic">${esc(t.title)}</a>
      <div class="tpc-sub">${list.length ? `${list.length}人が答えています` : 'まだ誰も答えていません。最初の1曲をどうぞ'} ・ 1人1曲</div>
      ${list.length ? `<div class="tpc-strip">${list.slice(0, 12).map((a, i) => this.tile(a, 'cur', i)).join('')}</div>` : ''}
      <div class="tpc-acts"><button class="btn sm tpc-cta" data-act="tpc-answer">${mine ? '答えを変える' : '答える'}</button>
        <a class="btn quiet sm" href="/topic" data-act="go" data-to="/topic">みんなの答え ›</a></div>
    </section>`;
  },

  /* ---------- /topic ---------- */
  async page() {
    document.title = '今週のお題 — Share MUSIC';
    setApp('<div class="loading"><span class="spinner"></span> お題を読み込み中…</div>');
    let t, me;
    try { [t, me] = await Promise.all([this.load(true), this.myId()]); } catch (e) { return setApp(`<div class="note bad" style="margin-top:24px">${esc(e.message)}</div>`); }
    if (location.pathname !== '/topic') return;
    const list = t.answers || [], mine = this.mine(t, me);
    this.lists.cur = list;
    const others = list.map((a, i) => [a, i]).filter(([a]) => a.uid !== me);
    setApp(`<div class="tpc-page">
      <section class="tpc-hero">
        <div class="tpc-head"><span class="tpc-kicker">${this.icon}今週のお題</span><span class="tpc-dates">${this.range(t)}</span></div>
        <h1 class="tpc-h1">${esc(t.title)}</h1>
        ${t.desc ? `<p class="tpc-desc">${esc(t.desc)}</p>` : ''}
        <div class="tpc-sub">1人1曲だけ。「ここを聴いて」と一言を添えて答えよう（日曜24時まで・あとから差し替えOK）</div>
      </section>
      ${mine ? `<div class="label"><b>${ICON.user}</b> あなたの答え</div>
        ${this.card(mine, 'cur', list.indexOf(mine), me)}
        <div class="row tpc-mine-acts"><button class="btn sm" data-act="tpc-answer">別の曲に差し替える</button><button class="btn quiet sm" data-act="tpc-remove">取り消す</button></div>`
        : `<button class="btn lg tpc-cta tpc-big" data-act="tpc-answer">この お題に答える</button>`}
      <div class="label"><b>♪</b> みんなの答え${list.length ? `（${list.length}）` : ''}</div>
      ${others.length ? `<div class="tpc-list">${others.map(([a, i]) => this.card(a, 'cur', i, me)).join('')}</div>`
        : `<div class="sheet flat center muted small">${mine ? 'まだあなただけです。友だちにもお題を教えてみよう' : 'まだ誰も答えていません。最初の1曲をどうぞ'}</div>`}
      <div class="label"><b>◎</b> これまでのお題</div>
      <div id="tpc-past"><div class="loading" style="padding:16px 0"><span class="spinner"></span></div></div>
    </div>`);
    this.drawPast('#tpc-past', 6);
  },
  async loadPast() {
    if (this.past && Date.now() - this.past._at < 120000) return this.past;
    const r = await fetch('/api/topics'); const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '読み込めませんでした');
    this.past = j.items || []; this.past._at = Date.now(); return this.past;
  },
  pastTile(x) {
    const c = (x.covers || []).slice(0, 4);
    return `<a class="tpc-past" href="/topic/${esc(x.week)}" data-act="go" data-to="/topic/${esc(x.week)}">
      <span class="tpc-mosaic n${c.length}">${c.map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`).join('')}</span>
      <b>${esc(x.title)}</b><span class="tiny muted">${this.md(x.start)}の週 ・ ${x.n}人</span></a>`;
  },
  async drawPast(sel, limit) {
    let items = [];
    try { items = await this.loadPast(); } catch { /* show as empty */ }
    const el = $(sel); if (!el) return;
    if (!items.length) { el.innerHTML = '<div class="sheet flat center muted small">過去のお題はまだありません。毎週月曜に新しいお題が始まります</div>'; return; }
    el.innerHTML = `<div class="tpc-pastgrid">${items.slice(0, limit || items.length).map((x) => this.pastTile(x)).join('')}</div>
      ${limit && items.length > limit ? `<div class="center" style="margin-top:10px"><a class="btn quiet sm" href="/topic/past" data-act="go" data-to="/topic/past">すべて見る（${items.length}）</a></div>` : ''}`;
  },

  /* ---------- /topic/<week> and /topic/past ---------- */
  async pastPage(week) {
    setApp('<div class="loading"><span class="spinner"></span> 読み込み中…</div>');
    const [r, me] = await Promise.all([fetch('/api/topic?week=' + encodeURIComponent(week)), this.myId()]);
    const t = await r.json().catch(() => ({}));
    if (location.pathname !== '/topic/' + week) return;
    if (!r.ok) return setApp(`<div class="sheet stack" style="margin-top:28px"><b>${esc(t.error || 'このお題は見つかりませんでした')}</b><div><a class="btn sm" href="/topic" data-act="go" data-to="/topic">今週のお題へ</a></div></div>`);
    if (!t.past) return this.page();
    document.title = `${t.title} — みんなの答え | Share MUSIC`;
    const list = t.answers || [];
    this.lists[week] = list;
    setApp(`<div class="tpc-page">
      <a class="btn quiet sm back" href="/topic" data-act="go" data-to="/topic">← 今週のお題</a>
      <section class="tpc-hero past">
        <div class="tpc-head"><span class="tpc-kicker">${this.icon}${this.md(t.start)}の週のお題</span><span class="tpc-dates">${this.range(t)}</span></div>
        <h1 class="tpc-h1">${esc(t.title)}</h1>
        ${t.desc ? `<p class="tpc-desc">${esc(t.desc)}</p>` : ''}
      </section>
      <div class="label"><b>♪</b> みんなの答え${list.length ? `（${list.length}）` : ''}</div>
      ${list.length ? `<div class="tpc-list">${list.map((a, i) => this.card(a, week, i, me)).join('')}</div>` : '<div class="sheet flat center muted small">この週の答えはありませんでした</div>'}
    </div>`);
  },
  async archivePage() {
    document.title = 'これまでのお題 — Share MUSIC';
    setApp(`<div class="tpc-page"><a class="btn quiet sm back" href="/topic" data-act="go" data-to="/topic">← 今週のお題</a>
      <h1 class="pagetitle">これまでのお題</h1><div id="tpc-past-all"><div class="loading"><span class="spinner"></span></div></div></div>`);
    this.drawPast('#tpc-past-all');
  },

  /* ---------- answering: search -> pick -> ここを聴いて -> ひとこと -> post ---------- */
  async openAnswer() {
    if (!Api.connected() && !(await login())) return;
    let t;
    try { t = await this.load(); } catch (e) { return toast(e.message); }
    const mine = this.mine(t, await this.myId());
    this.f = { step: 'search', q: '', results: null, picked: null, moment: null, msg: '', busy: false, note: mine?.note || '', replacing: !!mine };
    this.drawForm();
    setTimeout(() => $('#tpc-q')?.focus(), 60);
  },
  drawForm() {
    const f = this.f, t = this.cur; if (!f || !t) return;
    const m = document.getElementById('modal');
    const head = `<div class="row" style="margin-bottom:6px"><div class="spacer" style="min-width:0"><div class="tpc-kicker">${this.icon}今週のお題</div><b class="display tpc-mtitle">${esc(t.title)}</b></div>
      <button class="btn quiet sm" data-act="modal-close" aria-label="閉じる">${ICON.close}</button></div>`;
    let body = '';
    if (f.step === 'search') {
      body = `<div class="tiny muted" style="margin-bottom:8px">${f.replacing ? '別の曲を選ぶと、あなたの答えが差し替わります。' : '1人1曲だけ答えられます（あとから差し替えOK）。'}</div>
        <div class="field"><input class="input" id="tpc-q" placeholder="曲名・アーティスト名で検索（曲のURLも可）" value="${esc(f.q)}" enterkeyhint="search"><button class="btn solid" data-act="tpc-search">検索</button></div>
        <div id="tpc-results" class="tpc-results">${this.resultsHtml()}</div>`;
    } else {
      const p = f.picked, mo = f.moment, canPick = !!window.Discover?.pickMoment;
      body = `<div class="picked tpc-picked"><img class="${p.art ? 'sq' : ''}" src="${esc(p.art || p.thumb)}" alt=""><div style="min-width:0"><div class="tiny muted">答える曲</div><b>${esc(p.name)}</b><div class="small muted">${esc(p.artist)}</div></div></div>
        <div class="tpc-field"><div class="tpc-flabel">ここを聴いて</div>
          ${canPick ? (mo ? `<div class="tpc-moment"><span class="tpc-line">「${esc(mo.line || '（歌詞なし）')}」</span><span class="tiny muted">${this.fmtT(mo.t || 0)} から</span></div>
              <button class="btn quiet sm" data-act="tpc-moment">選び直す</button>`
            : '<button class="btn sm" data-act="tpc-moment">聴いてほしいところを選ぶ</button><div class="tiny muted">選ばなくても答えられます</div>')
          : `<input class="input" id="tpc-line" maxlength="120" placeholder="刺さった一行（歌詞・任意）" value="${esc(mo?.line || '')}">`}
        </div>
        <div class="tpc-field"><div class="tpc-flabel">ひとこと</div>
          <textarea class="textarea" id="tpc-note" maxlength="200" rows="3" placeholder="このお題でこの曲を選んだ理由など（200文字まで・任意）">${esc(f.note)}</textarea></div>
        <div class="row tpc-formacts"><button class="btn quiet sm" data-act="tpc-repick">曲を選び直す</button><span class="spacer"></span><button class="btn tpc-cta" data-act="tpc-submit" ${f.busy ? 'disabled' : ''}>${f.replacing ? 'この曲に差し替える' : 'この曲で答える'}</button></div>`;
    }
    m.innerHTML = `<div class="modal-card wide tpc-modal" role="dialog" aria-label="お題に答える">${head}${body}</div>`;
    m.hidden = false; document.body.classList.add('modal-open');
    const q = $('#tpc-q');
    if (q) q.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); $('[data-act=tpc-search]')?.click(); } });
    const note = $('#tpc-note'); if (note) note.addEventListener('input', () => { f.note = note.value; });
    const line = $('#tpc-line'); if (line) line.addEventListener('input', () => { f.moment = line.value.trim() ? { t: 0, line: line.value.trim() } : null; });
  },
  resultsHtml() {
    const f = this.f;
    if (f.busy) return `<div class="loading" style="padding:16px 0"><span class="spinner"></span> ${f.step === 'search' && f.results ? '公式の音源・MVを探しています…' : '検索中…'}</div>`;
    if (f.msg) return `<div class="note warn small">${esc(f.msg)}</div>`;
    if (!f.results) return '';
    if (!f.results.length) return '<div class="small muted">見つかりませんでした。別のことばで検索するか、YouTube Music で曲の「共有 → リンクをコピー」をして貼り付けてください。</div>';
    return `<div class="sres">${f.results.map((x, i) => `<button class="sres-item song" data-act="tpc-pick" data-i="${i}">
      <img class="${x.art ? 'sq' : ''}" src="${esc(x.art || x.thumb)}" alt="" loading="lazy">
      <span><b>${esc(x.name)}</b><span class="tiny muted">${esc(x.artist)}${x.album ? ' ・ ' + esc(x.album) : ''}${x.d ? ' ・ ' + fmtDur(x.d) : ''}</span></span></button>`).join('')}</div>`;
  },
  redrawResults() { const el = $('#tpc-results'); if (el) el.innerHTML = this.resultsHtml(); },
  /** the same search as the おすすめ曲 form (Songs in community.js): music catalog, or a pasted YouTube link */
  async search() {
    const f = this.f, q = ($('#tpc-q')?.value || '').trim(); if (!q) return;
    f.q = q; f.msg = ''; f.results = null; f.busy = true; this.redrawResults();
    try {
      if (/youtu\.?be|music\.youtube/.test(q)) {
        const r = await fetch('/api/song-search?' + new URLSearchParams({ url: q }));
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || '読み込めませんでした');
        f.results = (j.items || []).map((x) => { const g = guessSong(x.title, x.channel); return { ...x, name: g.name, artist: g.artist }; });
      } else {
        const res = await Catalog.search(q, 25);
        f.results = res.map((x) => ({ name: x.trackName, artist: x.artistName, album: x.collectionName, art: Catalog.art(x.artworkUrl100, 600), d: Math.round((x.trackTimeMillis || 0) / 1000) }));
      }
    } catch (e) { f.msg = e.message; }
    f.busy = false; this.redrawResults();
  },
  async pick(i) {
    const f = this.f, x = f.results?.[i]; if (!x) return;
    if (x.videoId) f.picked = { ...x };
    else {
      f.busy = true; this.redrawResults();
      try {
        const r = await fetch('/api/song-match?' + new URLSearchParams({ r: '3', t: x.name, a: x.artist, d: String(x.d || 0) }));
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || '曲を探せませんでした');
        if (!j.videoId) throw new Error(`「${x.name}」の公式の音源・MVが YouTube に見つかりませんでした。YouTube Music で曲の「共有 → リンクをコピー」をして、ここに貼り付けて選んでください。`);
        f.picked = { ...x, videoId: j.videoId, thumb: j.thumb, d: x.d || j.d };
      } catch (e) { f.msg = e.message; f.busy = false; return this.redrawResults(); }
      f.busy = false;
    }
    f.moment = null; f.step = 'note';
    if (window.Discover?.pickMoment) return this.chooseMoment();
    this.drawForm();
  },
  async chooseMoment() {
    const f = this.f, p = f?.picked; if (!p) return;
    try {
      const mo = await window.Discover.pickMoment({ id: p.videoId, title: p.name, artist: p.artist, d: p.d || 0 });
      if (mo) f.moment = { t: Math.max(0, Math.round(+mo.t || 0)), line: String(mo.line || '').slice(0, 120) };
    } catch (e) { console.error(e); }
    if (this.f === f) this.drawForm(); // pickMoment may have used the modal: draw the form again
  },
  async submit(btn) {
    const f = this.f, p = f?.picked; if (!p) return;
    const note = ($('#tpc-note')?.value || '').trim();
    f.busy = true; btn.disabled = true;
    try {
      const h = await Social.headers(); if (!h) throw new AuthError('ログインしてください');
      const r = await fetch('/api/topic', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({
        id: p.videoId, title: p.name, artist: p.artist, d: p.d || 0, art: p.art || '', moment: f.moment, note,
      }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || '答えられませんでした');
      j._at = Date.now(); this.cur = j; this.f = null;
      ShareImage.close();
      toast(j.replaced ? '答えを差し替えました' : 'お題に答えました');
      this.refresh();
    } catch (e) { f.busy = false; btn.disabled = false; toast(errText(e), 5000); }
  },
  async remove(btn) {
    if (!confirm('今週のお題への答えを取り消しますか？')) return;
    btn.disabled = true;
    try {
      const h = await Social.headers(); if (!h) throw new AuthError('ログインしてください');
      const r = await fetch('/api/topic', { method: 'DELETE', headers: h });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || '取り消せませんでした');
      j._at = Date.now(); this.cur = j; toast('答えを取り消しました'); this.refresh();
    } catch (e) { btn.disabled = false; toast(errText(e), 5000); }
  },
  refresh() {
    if (location.pathname === '/topic') this.page();
    else if (location.pathname === '/' && !location.hash) this.home();
  },

  /* ---------- admin page: "お題" tab ---------- */
  async adminDraw(el, token) {
    if (!el) return;
    this.admToken = token;
    el.innerHTML = '<div class="loading" style="padding:16px 0"><span class="spinner"></span></div>';
    const r = await fetch('/api/topic-admin', { headers: { Authorization: 'Admin ' + token } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { el.innerHTML = `<div class="note bad">${esc(j.error || '読み込めませんでした')}</div>`; return; }
    const form = (k, w, label) => `<div class="sheet stack tpc-adm">
      <div class="row"><b class="spacer">${label}（${this.range(w)}）</b><span class="badge">${w.custom ? '運営が設定' : '自動（用意したリスト）'}</span></div>
      <input class="input" id="tpc-adm-title-${k}" maxlength="60" value="${w.custom ? esc(w.title) : ''}" placeholder="${esc(w.title)}">
      <textarea class="textarea" id="tpc-adm-desc-${k}" maxlength="200" rows="2" placeholder="説明（任意）${w.custom ? '' : '：' + esc(w.desc)}">${w.custom ? esc(w.desc) : ''}</textarea>
      <div class="row"><span class="tiny muted spacer">${k === 'cur' ? `回答 ${w.n}件 ・ 変更すると、先週と今週に答えた人にお知らせが届きます` : '月曜0時（日本時間）に始まり、先週答えた人にお知らせが届きます'}</span>
        ${w.custom ? `<button class="btn sm quiet" data-act="tpc-adm-save" data-which="${k}" data-reset="1">自動に戻す</button>` : ''}
        <button class="btn sm solid" data-act="tpc-adm-save" data-which="${k}">保存</button></div></div>`;
    el.innerHTML = `<div class="hint">空欄のままにすると、用意したお題リストから毎週自動で選ばれます（入力欄の薄い文字が自動のお題です）。</div>
      ${form('cur', j.cur, '今週のお題')}${form('next', j.next, '来週のお題')}`;
  },
  async adminSave(btn) {
    const k = btn.dataset.which, reset = !!btn.dataset.reset;
    const title = reset ? '' : ($('#tpc-adm-title-' + k)?.value || '').trim(), desc = reset ? '' : ($('#tpc-adm-desc-' + k)?.value || '').trim();
    if (!reset && !title) return toast('お題を入力してください');
    if (k === 'cur' && !confirm(reset ? '今週のお題を自動に戻しますか？' : `今週のお題を「${title}」にしますか？\n先週と今週に答えた人にお知らせが届きます。`)) return;
    btn.disabled = true;
    const r = await fetch('/api/topic-admin', { method: 'POST', headers: { Authorization: 'Admin ' + this.admToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ which: k, title, desc }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { btn.disabled = false; return toast(j.error || '保存できませんでした', 4000); }
    this.cur = null; toast(reset ? '自動のお題に戻しました' : 'お題を保存しました');
    this.adminDraw(document.getElementById('adm-topic'), this.admToken);
  },

  /* ---------- wiring into app.js ---------- */
  registered: false,
  register() {
    if (this.registered || typeof Hooks === 'undefined') return false;
    this.registered = true;
    Hooks.routes.push((path) => {
      if (path === '/topic') { this.page(); return true; }
      if (path === '/topic/past') { this.archivePage(); return true; }
      const m = /^\/topic\/(\d{4}-W\d{2})$/.exec(path);
      if (m) { this.pastPage(m[1]); return true; }
      return false;
    });
    Hooks.home.push(() => this.home());
    Hooks.actions.push((act, el) => {
      switch (act) {
        case 'tpc-answer': this.openAnswer(); return true;
        case 'tpc-play': this.play(el.dataset.k, +el.dataset.i); return true;
        case 'tpc-search': this.search(); return true;
        case 'tpc-pick': this.pick(+el.dataset.i); return true;
        case 'tpc-moment': this.chooseMoment(); return true;
        case 'tpc-repick': if (this.f) { this.f.step = 'search'; this.f.picked = null; this.f.moment = null; this.f.msg = ''; this.drawForm(); } return true;
        case 'tpc-submit': this.submit(el); return true;
        case 'tpc-remove': this.remove(el); return true;
        case 'tpc-adm-save': this.adminSave(el); return true;
      }
      return false;
    });
    Hooks.notif.topic = (n) => `今週のお題「${esc(n.title)}」が始まりました。1曲で答えてみませんか？`;
    Hooks.notifLink.topic = () => '/topic';
    return true;
  },
};
window.Topics = Topics;
// Hooks normally exists already (public/hooks.js, loaded first): register now so /topic works on the first route().
// If Hooks is still defined inside app.js (runs after this file), register once it has run and draw this module's part of the first page.
Topics.register();
document.addEventListener('DOMContentLoaded', () => {
  if (!Topics.register()) return;
  if (/^\/topic(\/|$)/.test(location.pathname)) route();
  else if (location.pathname === '/' && !location.hash) Topics.home();
});
