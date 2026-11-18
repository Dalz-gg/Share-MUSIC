/* Share MUSIC — Stage 2 — Home "今日のおすすめ" + song reactions (刺さった / わかる / ありがとう) + ありがとう便.
 * Plugs into app.js through Hooks (see the top of app.js). Loaded before app.js; only refer to app.js globals inside functions.
 *   - Home (Hooks.renderHome): #home-topic (stage 3) → recommended songs newest first → the old shelves
 *   - Song page (#song-reacts): 刺さった (= the old like, /api/like, no login) / わかる / ありがとう (login, /api/song-react)
 *   - Profile / My page (#prof-extra): ありがとうをもらった数
 *   - Notification type 'thx' */
'use strict';

(() => {
  /* ---------- line icons (no emoji) ---------- */
  const I = {
    // 刺さった: a heart with an arrow through it
    get: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19.5s-7-4.3-7-9.4A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.1c0 5.1-7 9.4-7 9.4z"/><path d="M3 21 21 4"/><path d="M17 4h4v4"/></svg>',
    // わかる: two overlapping circles (feelings that overlap)
    wkr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/></svg>',
    // ありがとう: a letter (ありがとう便)
    thx: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4.5 7 7.5 6 7.5-6"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  };
  const RX = [['get', '刺さった'], ['wkr', 'わかる'], ['thx', 'ありがとう']];
  const PAGE = 8;

  const T = {
    icon: I,
    shown: PAGE,
    rx: {}, // sid -> { get, wkr, thx, mine: { wkr, thx } }
    loadedAt: 0,

    /* ---------- data ---------- */
    sorted() { return [...(Songs.list || [])].sort((a, b) => (b.at || 0) - (a.at || 0)); },
    lineOf(s) {
      const l = window.Discover?.lineOf?.(s);
      if (l) return { text: l, isLine: true };
      if (s.moment?.line) return { text: s.moment.line, isLine: true };
      if (s.desc) return { text: s.desc, isLine: false };
      return { text: '', isLine: false };
    },
    sceneTags(s) {
      const sc = window.Discover?.SCENES || [];
      return (s.scenes || []).map((id) => (sc.find((x) => x[0] === id) || [])[1]).filter(Boolean).slice(0, 3)
        .map((l) => `<span class="tdy-scene">${esc(l)}</span>`).join('');
    },
    mine(sid) { return { get: Likes.has('s', sid), wkr: !!this.rx[sid]?.mine?.wkr, thx: !!this.rx[sid]?.mine?.thx }; },
    count(sid, k) {
      if (k === 'get') return this.rx[sid]?.get ?? (Songs.list || []).find((x) => x.sid === sid)?.likes ?? 0;
      return this.rx[sid]?.[k] || 0;
    },
    async fetchRx(sids) {
      sids = sids.filter(Boolean); if (!sids.length) return;
      try {
        const h = Api.connected() ? await Social.headers().catch(() => null) : null;
        for (let i = 0; i < sids.length; i += 40) {
          const r = await fetch('/api/song-reacts?sids=' + encodeURIComponent(sids.slice(i, i + 40).join(',')), { headers: h || {} });
          if (!r.ok) continue;
          const j = await r.json();
          for (const [sid, v] of Object.entries(j.items || {})) this.rx[sid] = { ...this.rx[sid], ...v };
        }
      } catch { /* offline: keep what we have */ }
      sids.forEach((sid) => this.paint(sid));
    },

    /* ---------- reaction buttons ---------- */
    rxHtml(sid, size = 'sm') {
      const m = this.mine(sid);
      return `<div class="tdy-rx ${size}" data-sid="${esc(sid)}" role="group" aria-label="リアクション">${RX.map(([k, l]) => `<button class="tdy-rb k-${k} ${m[k] ? 'on' : ''}" data-act="tdy-rx" data-k="${k}" data-sid="${esc(sid)}" aria-pressed="${m[k]}" aria-label="${l}">
        <span class="ic">${I[k]}</span>${size === 'lg' ? `<span class="l">${l}</span>` : ''}<span class="n">${this.count(sid, k)}</span></button>`).join('')}</div>`;
    },
    paint(sid, popK) {
      const m = this.mine(sid);
      document.querySelectorAll(`.tdy-rx[data-sid="${CSS.escape(sid)}"] .tdy-rb`).forEach((b) => {
        const k = b.dataset.k;
        b.classList.toggle('on', m[k]); b.setAttribute('aria-pressed', String(m[k]));
        const n = b.querySelector('.n'); if (n) n.textContent = this.count(sid, k);
        if (popK === k && m[k]) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
      });
    },
    async react(btn) {
      const sid = btn.dataset.sid, k = btn.dataset.k;
      if (btn.disabled) return;
      if (k === 'get') { // 刺さった = the existing like (anyone, no login)
        btn.disabled = true;
        try {
          const { liked, n } = await Likes.toggle('s', sid);
          this.rx[sid] = { ...this.rx[sid], get: n };
          Songs.list?.forEach((x) => { if (x.sid === sid) x.likes = n; });
          this.paint(sid, liked ? 'get' : '');
          document.querySelectorAll(`.likebtn[data-kind="s"][data-id="${CSS.escape(sid)}"]`).forEach((b) => {
            b.classList.toggle('on', liked); b.setAttribute('aria-pressed', String(liked)); b.querySelector('.n').textContent = n;
          });
        } catch (e) { toast(e.message, 4000); }
        btn.disabled = false; return;
      }
      if (!Api.connected()) {
        toast(k === 'thx' ? 'ログインすると「ありがとう」を届けられます' : 'ログインすると「わかる」を押せます');
        if (!(await login())) return;
      }
      const h = await Social.headers().catch(() => null); if (!h) return toast('ログインしてください');
      const before = { ...(this.rx[sid] || {}), mine: { ...(this.rx[sid]?.mine || {}) } };
      const on = !this.mine(sid)[k];
      // optimistic: move first, then confirm with the server
      const cur = this.rx[sid] || { get: this.count(sid, 'get'), wkr: 0, thx: 0, mine: {} };
      this.rx[sid] = { ...cur, [k]: Math.max(0, (cur[k] || 0) + (on ? 1 : -1)), mine: { ...cur.mine, [k]: on } };
      this.paint(sid, on ? k : '');
      document.querySelectorAll(`.tdy-rb[data-sid="${CSS.escape(sid)}"][data-k="${k}"]`).forEach((b) => { b.disabled = true; });
      try {
        const r = await fetch('/api/song-react', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ sid, k, on }) });
        const j = await r.json().catch(() => ({}));
        if (r.status === 401) { store.del('token'); throw new Error(j.error || 'ログインしてください'); }
        if (!r.ok) throw new Error(j.error || 'うまく送れませんでした');
        this.rx[sid] = { ...this.rx[sid], ...j };
        if (k === 'thx' && on) toast('ありがとうを届けました');
      } catch (e) {
        this.rx[sid] = before; toast(e.message, 4000);
      }
      document.querySelectorAll(`.tdy-rb[data-sid="${CSS.escape(sid)}"][data-k="${k}"]`).forEach((b) => { b.disabled = false; });
      this.paint(sid);
    },

    /* ---------- home ---------- */
    card(s, i) {
      const ln = this.lineOf(s), art = s.art || s.thumb || (s.videoId ? `https://i.ytimg.com/vi/${s.videoId}/hqdefault.jpg` : '');
      const ps = recPeople(s);
      const big = ln.text || s.title;
      const mt = Number.isFinite(+s.moment?.t) && s.moment?.t != null ? +s.moment.t : null;
      const fmt = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
      return `<article class="tdy-card" data-sid="${esc(s.sid)}" style="--i:${Math.min(i % PAGE, 7)}">
        <button class="tdy-body" data-act="tdy-play" data-sid="${esc(s.sid)}" aria-label="${esc(s.title)} を試聴">
          <span class="tdy-art">${art ? `<img src="${esc(art)}" alt="" loading="lazy">` : ''}<i class="tdy-pbtn" aria-hidden="true">${ICON.play}</i></span>
          <span class="tdy-qw"><span class="tdy-q ${ln.isLine ? 'line' : ln.text ? 'memo' : 'title'}">${esc(big.length > 90 ? big.slice(0, 88) + '…' : big)}</span>
            <span class="tdy-cta">${ICON.play}${mt != null ? `ここから試聴 <em>${fmt(mt)}〜</em>` : 'サビから試聴'}</span></span>
        </button>
        <div class="tdy-foot">
          <button class="tdy-song" data-act="go" data-to="/s/${esc(s.sid)}" aria-label="${esc(s.title)} の曲ページを開く">
            <span class="tdy-st"><b>${esc(s.title)}</b><small>${esc(s.artist)}</small></span><span class="tdy-det">詳細・コメント${I.chev}</span></button>
          ${this.sceneTags(s) ? `<div class="tdy-scenes">${this.sceneTags(s)}</div>` : ''}
          <div class="tdy-meta">
            <span class="tdy-by"><span class="avs">${ps.slice(0, 3).map((x) => Avatars.html(x.id, x.name)).join('')}</span><span class="tdy-byn">${ps.slice(0, 2).map((x) => esc(x.name) + 'さん').join('、')}${ps.length > 2 ? `ほか${ps.length - 2}人` : ''}${ps.length > 1 ? 'が' : 'の'}おすすめ</span></span>
            ${s.at ? `<span class="tdy-ago">${ago(s.at)}</span>` : ''}
          </div>
          ${this.rxHtml(s.sid)}
        </div>
      </article>`;
    },
    drawList() {
      const el = $('#tdy-list'); if (!el) return;
      const all = this.sorted();
      if (!all.length) {
        el.innerHTML = `<div class="tdy-empty"><div class="tdy-empty-ic">${ICON.note}</div><b>まだおすすめ曲はありません</b><span>あなたの「この曲のここを聴いて」を、最初のおすすめにしませんか。</span>
          <button class="btn sm solid" data-act="go" data-to="/share/song">おすすめ曲を投稿する</button></div>`;
        $('#tdy-more').hidden = true; return;
      }
      const items = all.slice(0, this.shown);
      el.innerHTML = items.map((s, i) => this.card(s, i)).join('');
      const more = $('#tdy-more'); if (more) { more.hidden = all.length <= this.shown; more.querySelector('.n').textContent = `あと${all.length - this.shown}曲`; }
      this.markNow();
      fixLetterbox(el);
      this.fetchRx(items.map((s) => s.sid).filter((sid) => !this.rx[sid] || Date.now() - this.loadedAt > 60000));
      this.loadedAt = Date.now();
    },
    more(btn) {
      const all = this.sorted(), from = this.shown;
      this.shown += PAGE;
      const el = $('#tdy-list'); if (!el) return;
      const add = all.slice(from, this.shown);
      el.insertAdjacentHTML('beforeend', add.map((s, i) => this.card(s, from + i)).join(''));
      btn.hidden = all.length <= this.shown; btn.querySelector('.n').textContent = `あと${Math.max(0, all.length - this.shown)}曲`;
      fixLetterbox(el);
      this.fetchRx(add.map((s) => s.sid));
    },
    render() {
      document.title = 'Share MUSIC';
      const rec = Recent.list();
      setApp(`<div class="tdy-home">
        <div id="home-topic"></div>
        <section class="tdy" aria-labelledby="tdy-h">
          <div class="tdy-head">
            <div class="eyebrow">Today's picks</div>
            <h1 class="tdy-title" id="tdy-h">今日のおすすめ</h1>
            <p class="tdy-sub">タップで、いちばん聴いてほしいところから試聴できます</p>
          </div>
          <div id="tdy-list" class="tdy-list"><div class="loading" style="padding:28px 0"><span class="spinner"></span> 読み込み中…</div></div>
          <button class="tdy-morebtn" id="tdy-more" data-act="tdy-more" hidden>もっと見る <span class="n"></span></button>
        </section>
        ${Api.connected() ? '' : `<div class="tdy-login"><span>ログインすると、おすすめの投稿や「ありがとう」が送れます。見る・聴くはログインなしでできます。</span><button class="btn sm solid" data-act="login">Googleでログイン</button></div>`}
        ${resumeNote()}
        ${Install.banner()}
        <div id="shelves"><div class="loading" style="padding:28px 0"><span class="spinner"></span> 読み込み中…</div></div>
        ${rec.length ? `<details class="recent"><summary>履歴（${rec.length}）</summary>${Recent.html()}</details>` : ''}
      </div>`);
      this.shown = PAGE;
      const fresh = Date.now() - (this.songsAt || 0) > 60000; // new recommendations show up without a reload
      if (fresh) this.songsAt = Date.now();
      Songs.load(fresh).then(() => { if (location.pathname === '/' && !location.hash) this.drawList(); });
      Promise.all([Social.loadGallery(), Songs.load(), Api.connected() ? Follows.load() : null, partyList().then((l) => { Parties.live = l; }).catch(() => {})])
        .then(() => { if (location.pathname === '/' && !location.hash) drawShelves(); });
      for (const fn of Hooks.home) { try { fn(); } catch (e) { console.error(e); } }
    },

    /* ---------- tap to listen (one Player for everything) ---------- */
    view() {
      const list = this.sorted();
      return { id: 'today', p: { id: 'today', title: '今日のおすすめ', owner: '', image: list[0]?.art || list[0]?.thumb || '' },
        tracks: list.map((s) => ({ id: s.videoId, name: s.title, artist: s.artist, d: s.d || 0, embed: s.embed !== false, thumb: s.art || s.thumb, isMv: s.src === 'mv', sid: s.sid })) };
    },
    play(sid) {
      const s = (Songs.list || []).find((x) => x.sid === sid); if (!s) return;
      if (window.Discover?.preview) { try { window.Discover.preview(s); this.now = sid; this.markNow(); return; } catch (e) { console.error(e); } }
      // fallback: put today's list into the single player and start from the chosen moment
      if (S.view?.id !== 'today') { if (Player.idx >= 0) Player.close(); S.view = this.view(); }
      const i = S.view.tracks.findIndex((t) => t.sid === sid); if (i < 0) return;
      this.now = sid; this.markNow();
      if (Player.idx === i && Player.yt) return Player.toggle();
      Player.order = null; Player.play(i);
      const t = +s.moment?.t || 0;
      if (t > 1) {
        let n = 0; clearInterval(this.seekT);
        this.seekT = setInterval(() => {
          if (Player.idx !== i || ++n > 60) return clearInterval(this.seekT);
          if (Player.playing && Player.yt?.getCurrentTime) { if (Player.yt.getCurrentTime() < t - 2) Player.yt.seekTo(t, true); clearInterval(this.seekT); }
        }, 250);
      }
    },
    /** the old like button (song lists, profile) was pressed: same 刺さった, keep our counts in step */
    synced(sid, n) { this.rx[sid] = { ...this.rx[sid], get: n }; this.paint(sid); },
    markNow() { document.querySelectorAll('.tdy-card').forEach((c) => c.classList.toggle('now', c.dataset.sid === this.now)); },

    /* ---------- song page / profile ---------- */
    song(so) {
      document.querySelector('.vactions .likebtn')?.remove(); // 刺さった below replaces the old like
      const el = $('#song-reacts'); if (!el) return;
      const isRec = (id) => recIs(so, id);
      el.innerHTML = `<div class="tdy-srx">${this.rxHtml(so.sid, 'lg')}<div class="tdy-srx-h" id="tdy-srx-h">「ありがとう」は、おすすめした人${recPeople(so).length > 1 ? 'みんな' : ''}に届きます</div></div>`;
      (async () => {
        const h = Api.connected() ? await Social.headers().catch(() => null) : null;
        try {
          const r = await fetch('/api/song-reacts?sid=' + encodeURIComponent(so.sid), { headers: h || {} });
          if (r.ok) { this.rx[so.sid] = { ...this.rx[so.sid], ...(await r.json()) }; this.paint(so.sid); }
        } catch { /* offline */ }
        if (Api.connected()) {
          const me = await Api.myId().catch(() => '');
          if (me && isRec(me)) { // my own recommendation: thanks come to me, not from me
            const b = document.querySelector(`#song-reacts .tdy-rb[data-k="thx"]`); if (b) { b.classList.add('self'); b.dataset.self = '1'; }
            const hh = $('#tdy-srx-h'); if (hh) hh.textContent = 'あなたのおすすめに届いた「ありがとう」の数です';
          }
        }
      })();
    },
    async profile(id, { isMe }) {
      const box = $('#prof-extra'); if (!box || !id) return;
      box.querySelector('.tdy-thx')?.remove();
      const el = document.createElement('div'); el.className = 'tdy-thx'; el.hidden = true; box.appendChild(el);
      try {
        const r = await fetch('/api/song-reacts?user=' + encodeURIComponent(id));
        const n = r.ok ? (await r.json()).thx || 0 : 0;
        if (!n && !isMe) return;
        el.innerHTML = `<span class="ic">${I.thx}</span><span class="t"><b>${n}</b><span>ありがとうをもらった数</span></span>${isMe && !n ? '<span class="h">おすすめした曲に「ありがとう」が届くと増えます</span>' : ''}`;
        el.hidden = false;
      } catch { /* offline */ }
    },
  };
  window.Today = T;

  /* ---------- register into app.js Hooks ----------
   * If a global Hooks already exists (public/hooks.js loaded before the modules) we register at once.
   * Otherwise (Hooks defined inside app.js, evaluated after this file, which draws the first page synchronously) we register
   * as soon as Hooks exists (a microtask right after app.js has run, before the first paint) and redraw what the first route missed. */
  let done = false;
  function register(late = true) {
    let H; try { H = typeof Hooks !== 'undefined' ? Hooks : null; } catch { H = null; }
    if (!H || done) return !!done;
    done = true;
    H.renderHome = () => T.render();
    H.song.push((so) => T.song(so));
    H.profile.push((id, o) => T.profile(id, o || {}));
    H.notif.thx = (n, who, t) => `${who}があなたのおすすめ曲${t}に「ありがとう」を届けました`;
    H.notifLink.thx = (n) => '/s/' + n.id;
    H.actions.push((act, el) => {
      switch (act) {
        case 'tdy-play': T.play(el.dataset.sid); return true;
        case 'tdy-rx':
          if (el.dataset.self && el.dataset.k === 'thx') { toast('自分がおすすめした曲には「ありがとう」を送れません'); return true; }
          T.react(el); return true;
        case 'tdy-more': T.more(el); return true;
        default: return false;
      }
    });
    // the first page was drawn before we were registered
    if (late) try {
      if (location.pathname === '/' && !location.hash) T.render();
      else if (location.pathname === '/me' && $('#prof-extra') && Api.profile?.id) T.profile(Api.profile.id, { isMe: true });
    } catch (e) { console.error(e); }
    return true;
  }
  // Hooks already defined (public/hooks.js loaded first): register right away, nothing has been drawn yet
  if (!register(false)) {
    const mo = new MutationObserver(() => { if (register()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    addEventListener('DOMContentLoaded', () => { if (register()) mo.disconnect(); });
  }
})();
