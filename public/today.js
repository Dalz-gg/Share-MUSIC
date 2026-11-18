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
    // いいね: thumbs up
    get: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 10.5v9H4.8a1.3 1.3 0 0 1-1.3-1.3v-6.4c0-.7.6-1.3 1.3-1.3z"/><path d="M7.5 10.5 11 3.8a2 2 0 0 1 2.9 1.9l-.5 3.6h4.9a2 2 0 0 1 2 2.4l-1.3 6.2a2 2 0 0 1-2 1.6H7.5"/></svg>',
    // ハート (= the former ありがとう: it reaches every recommender and grows the 布教の木)
    thx: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.2s-7.8-4.6-7.8-10.3A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.8 2.5c0 5.7-7.8 10.3-7.8 10.3z"/></svg>',
    wkr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/></svg>',
    cmt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11.6c0 4-3.6 7-8 7-1.2 0-2.3-.2-3.3-.6L4 19.5l1.3-3.6C4.5 14.7 4 13.2 4 11.6c0-4 3.6-7 8-7s8 3 8 7z"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3.8 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8z"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  };
  const RX = [['get', 'いいね'], ['thx', 'ハート']];
  const PAGE = 12, CAROUSEL = 12;

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
        toast('ログインするとハートを送れます');
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
        if (k === 'thx' && on) toast('ハートを届けました');
      } catch (e) {
        this.rx[sid] = before; toast(e.message, 4000);
      }
      document.querySelectorAll(`.tdy-rb[data-sid="${CSS.escape(sid)}"][data-k="${k}"]`).forEach((b) => { b.disabled = false; });
      this.paint(sid);
    },

    /* ---------- home: a big horizontal carousel; /picks: every recommendation ---------- */
    headOf(s) {
      if (s.head) return { text: s.head, cls: 'head' };
      const ln = this.lineOf(s);
      return ln.text ? { text: ln.text, cls: ln.isLine ? 'line' : 'memo' } : { text: s.title, cls: 'title' };
    },
    stats(s) {
      return `<span class="tdy-stat" title="コメント" aria-label="コメント ${s.comments || 0}">${I.cmt}<b>${s.comments || 0}</b></span><span class="tdy-stat" title="ブックマーク" aria-label="ブックマーク ${s.bm || 0}">${I.star}<b>${s.bm || 0}</b></span>`;
    },
    card(s, i) {
      const art = s.art || s.thumb || (s.videoId ? `https://i.ytimg.com/vi/${s.videoId}/hqdefault.jpg` : '');
      const ps = recPeople(s), h = this.headOf(s);
      const txt = h.text.length > 70 ? h.text.slice(0, 68) + '…' : h.text;
      return `<article class="tdy-card" data-sid="${esc(s.sid)}" style="--i:${Math.min(i, 7)}">
        <button class="tdy-cover" data-act="tdy-play" data-sid="${esc(s.sid)}" aria-label="${esc(s.title)} を聴いてみる">
          ${art ? `<span class="tdy-bg" style="background-image:url('${esc(art)}')"></span>` : ''}
          <span class="tdy-disc" aria-hidden="true"><span class="tdy-lbl">${art ? `<img src="${esc(art)}" alt="" loading="lazy">` : ''}</span></span>
          <span class="tdy-art">${art ? `<img src="${esc(art)}" alt="" loading="lazy">` : ''}</span>
          <span class="tdy-cta"><span class="pi">${ICON.play}</span>聴いてみる</span>
        </button>
        <div class="tdy-in">
          <h3 class="tdy-q ${h.cls}">${esc(txt)}</h3>
          <button class="tdy-song" data-act="go" data-to="/s/${esc(s.sid)}" aria-label="${esc(s.title)} の詳細ページを開く">
            <span class="tdy-st"><b>${esc(s.title)}</b><small>${esc(s.artist)}</small></span><span class="tdy-det">詳細${I.chev}</span></button>
          ${this.sceneTags(s) ? `<div class="tdy-scenes">${this.sceneTags(s)}</div>` : ''}
          <div class="tdy-meta">
            <span class="tdy-by"><span class="avs">${ps.slice(0, 3).map((x) => Avatars.html(x.id, x.name)).join('')}</span><span class="tdy-byn">${ps.slice(0, 2).map((x) => esc(x.name) + 'さん').join('、')}${ps.length > 2 ? `ほか${ps.length - 2}人` : ''}${ps.length > 1 ? 'が' : 'の'}おすすめ</span></span>
            ${s.at ? `<span class="tdy-ago">${ago(s.at)}</span>` : ''}
          </div>
          <div class="tdy-bot">${this.rxHtml(s.sid)}<span class="tdy-stats">${this.stats(s)}</span></div>
        </div>
      </article>`;
    },
    empty() {
      return `<div class="tdy-empty"><div class="tdy-empty-ic">${ICON.note}</div><b>まだおすすめ曲はありません</b><span>あなたの「この曲のここを聴いて」を、最初のおすすめにしませんか。</span>
        <button class="btn sm solid" data-act="go" data-to="/share/song">おすすめ曲を投稿する</button></div>`;
    },
    drawList() {
      const el = $('#tdy-list'); if (!el) return;
      const all = this.sorted();
      if (!all.length) { el.classList.remove('tdy-rail'); el.innerHTML = this.empty(); return; }
      const items = all.slice(0, CAROUSEL);
      el.innerHTML = items.map((s, i) => this.card(s, i)).join('')
        + (all.length > items.length || all.length > 3 ? `<button class="tdy-allcard" data-act="go" data-to="/picks" style="--i:${Math.min(items.length, 7)}"><span class="ic">${I.chev}</span><b>すべてのおすすめ</b><small>${all.length}曲</small></button>` : '');
      const n = $('#tdy-count'); if (n) n.textContent = all.length;
      this.markNow();
      fixLetterbox(el);
      this.rail(el);
      this.fetchRx(items.map((s) => s.sid).filter((sid) => !this.rx[sid] || Date.now() - this.loadedAt > 60000));
      this.loadedAt = Date.now();
    },
    /** coverflow-like motion: each card leans / shrinks by its distance from the centre; the centred card gets .focus */
    rail(el) {
      const dots = $('#tdy-prog i');
      let raf = 0, focus = null;
      const upd = () => {
        raf = 0;
        const r = el.getBoundingClientRect(), cx = r.left + r.width / 2;
        let best = null, bd = 1e9;
        for (const c of el.children) {
          const b = c.getBoundingClientRect(), d = (b.left + b.width / 2 - cx) / (b.width || 1);
          const k = Math.max(-1.4, Math.min(1.4, d));
          c.style.setProperty('--d', k.toFixed(3)); c.style.setProperty('--ad', Math.abs(k).toFixed(3));
          if (Math.abs(d) < bd) { bd = Math.abs(d); best = c; }
        }
        if (best !== focus) {
          focus?.classList.remove('focus'); best?.classList.add('focus'); focus = best;
          const img = best?.querySelector('.tdy-art img'); if (img) Backdrop.set(img.currentSrc || img.src);
        }
        if (dots) { const max = el.scrollWidth - el.clientWidth; dots.style.width = (max > 0 ? 18 + (el.scrollLeft / max) * 82 : 100) + '%'; }
      };
      el.onscroll = () => { if (!raf) raf = requestAnimationFrame(upd); };
      if (!this.onRz) { this.onRz = () => { const l = $('#tdy-list'); l?.onscroll?.(); }; addEventListener('resize', this.onRz, { passive: true }); }
      upd(); setTimeout(upd, 60);
    },
    render() {
      document.title = 'Share MUSIC';
      const rec = Recent.list();
      setApp(`<div class="tdy-home">
        <div id="home-topic"></div>
        <section class="tdy" aria-labelledby="tdy-h">
          <div class="tdy-head">
            <div><div class="eyebrow">Today's picks</div><h1 class="tdy-title" id="tdy-h">今日のおすすめ</h1></div>
            <button class="tdy-seeall" data-act="go" data-to="/picks">すべて見る<span id="tdy-count"></span>${I.chev}</button>
          </div>
          <div id="tdy-list" class="tdy-list tdy-rail"><div class="loading" style="padding:28px 0"><span class="spinner"></span> 読み込み中…</div></div>
          <div class="tdy-prog" id="tdy-prog" aria-hidden="true"><i></i></div>
        </section>
        ${Api.connected() ? '' : `<div class="tdy-login"><span>ログインすると、おすすめの投稿やハートが送れます。見る・聴くはログインなしでできます。</span><button class="btn sm solid" data-act="login">Googleでログイン</button></div>`}
        ${resumeNote()}
        ${Install.banner()}
        <div id="shelves"><div class="loading" style="padding:28px 0"><span class="spinner"></span> 読み込み中…</div></div>
        ${rec.length ? `<details class="recent"><summary>履歴（${rec.length}）</summary>${Recent.html()}</details>` : ''}
      </div>`);
      const fresh = Date.now() - (this.songsAt || 0) > 60000; // new recommendations show up without a reload
      if (fresh) this.songsAt = Date.now();
      Songs.load(fresh).then(() => { if (location.pathname === '/' && !location.hash) this.drawList(); });
      Promise.all([Social.loadGallery(), Songs.load(), Api.connected() ? Follows.load() : null, partyList().then((l) => { Parties.live = l; }).catch(() => {})])
        .then(() => { if (location.pathname === '/' && !location.hash) drawShelves(); });
      setTimeout(() => Player.load(), 800); // the YouTube player script is ready before the first 聴いてみる
      for (const fn of Hooks.home) { try { fn(); } catch (e) { console.error(e); } }
    },

    /* /picks: every recommendation, newest or most liked, filtered by scene */
    pk: { sort: 'new', scene: '', shown: PAGE },
    pickList() {
      let l = this.sorted();
      if (this.pk.scene) l = l.filter((s) => (s.scenes || []).includes(this.pk.scene));
      if (this.pk.sort === 'pop') l.sort((a, b) => (this.count(b.sid, 'get') + this.count(b.sid, 'thx') * 2 + (b.comments || 0)) - (this.count(a.sid, 'get') + this.count(a.sid, 'thx') * 2 + (a.comments || 0)) || (b.at || 0) - (a.at || 0));
      return l;
    },
    renderPicks() {
      document.title = 'みんなのおすすめ — Share MUSIC';
      setApp(`<div class="tdy-picks">
        <button class="btn quiet sm tdy-back" data-act="go" data-to="/">← ホーム</button>
        <div class="eyebrow">All picks</div>
        <h1 class="tdy-title">みんなのおすすめ</h1>
        <p class="tdy-sub">聴いてみるで、その場で一番聴いてほしいところから流れます</p>
        <div class="tdy-tools">
          <div class="tdy-seg" role="tablist">${[['new', '新着'], ['pop', '人気']].map(([k, l]) => `<button role="tab" class="${this.pk.sort === k ? 'on' : ''}" aria-selected="${this.pk.sort === k}" data-act="tdy-sort" data-k="${k}">${l}</button>`).join('')}</div>
        </div>
        <div class="tdy-fchips" id="tdy-fchips"></div>
        <div id="tdy-grid" class="tdy-list tdy-grid"><div class="loading" style="padding:28px 0"><span class="spinner"></span> 読み込み中…</div></div>
        <button class="tdy-morebtn" id="tdy-more" data-act="tdy-more" hidden>もっと見る <span class="n"></span></button>
      </div>`);
      Songs.load().then(() => { if (location.pathname === '/picks') this.drawGrid(); });
    },
    drawChips() {
      const box = $('#tdy-fchips'); if (!box) return;
      const sc = window.Discover?.SCENES || [], used = new Set((Songs.list || []).flatMap((s) => s.scenes || []));
      const list = [['', 'すべて'], ...sc.filter(([k]) => used.has(k) || this.pk.scene === k)];
      box.innerHTML = list.length > 1 ? list.map(([k, l]) => `<button class="dsc-chip ${this.pk.scene === k ? 'on' : ''}" data-act="tdy-scene" data-k="${k}">${esc(l)}</button>`).join('') : '';
    },
    drawGrid(keep) {
      const el = $('#tdy-grid'); if (!el) return;
      if (!keep && !$('#tdy-fchips')?.children.length) this.drawChips();
      const all = this.pickList();
      if (!keep) this.pk.shown = PAGE;
      const items = all.slice(0, this.pk.shown);
      el.innerHTML = items.length ? items.map((s, i) => this.card(s, i)).join('') : (this.pk.scene ? '<div class="tdy-empty"><b>この場面のおすすめはまだありません</b></div>' : this.empty());
      const more = $('#tdy-more'); if (more) { more.hidden = all.length <= this.pk.shown; more.querySelector('.n').textContent = `あと${all.length - this.pk.shown}曲`; }
      this.markNow(); fixLetterbox(el); this.reveal(el);
      this.fetchRx(items.map((s) => s.sid).filter((sid) => !this.rx[sid]));
    },
    more() {
      const el = $('#tdy-grid'); if (!el) return;
      const all = this.pickList(), from = this.pk.shown;
      this.pk.shown += PAGE;
      const add = all.slice(from, this.pk.shown);
      el.insertAdjacentHTML('beforeend', add.map((s, i) => this.card(s, i)).join(''));
      const more = $('#tdy-more'); if (more) { more.hidden = all.length <= this.pk.shown; more.querySelector('.n').textContent = `あと${Math.max(0, all.length - this.pk.shown)}曲`; }
      fixLetterbox(el); this.reveal(el);
      this.fetchRx(add.map((s) => s.sid));
    },
    /** grid cards rise in as they scroll into view */
    reveal(el) {
      if (!('IntersectionObserver' in window)) return el.querySelectorAll('.tdy-card').forEach((c) => c.classList.add('seen'));
      this.io?.disconnect();
      this.io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('seen'); this.io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
      el.querySelectorAll('.tdy-card:not(.seen)').forEach((c) => this.io.observe(c));
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
      el.innerHTML = `<div class="tdy-srx">${this.rxHtml(so.sid, 'lg')}<div class="tdy-srx-h" id="tdy-srx-h">ハートは「教えてくれてありがとう」の気持ち。おすすめした人${recPeople(so).length > 1 ? 'みんな' : ''}に届きます</div></div>`;
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
            const hh = $('#tdy-srx-h'); if (hh) hh.textContent = 'あなたのおすすめに届いたハートの数です';
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
        el.innerHTML = `<span class="ic">${I.thx}</span><span class="t"><b>${n}</b><span>もらったハートの数</span></span>${isMe && !n ? '<span class="h">おすすめした曲に「ありがとう」が届くと増えます</span>' : ''}`;
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
    H.routes.push((path) => { if (path !== '/picks') return false; T.renderPicks(); return true; });
    H.song.push((so) => T.song(so));
    H.profile.push((id, o) => T.profile(id, o || {}));
    H.notif.thx = (n, who, t) => `${who}があなたのおすすめ曲${t}にハートを送りました`;
    H.notifLink.thx = (n) => '/s/' + n.id;
    H.actions.push((act, el) => {
      switch (act) {
        case 'tdy-play': T.play(el.dataset.sid); return true;
        case 'tdy-rx':
          if (el.dataset.self && el.dataset.k === 'thx') { toast('自分がおすすめした曲にはハートを送れません'); return true; }
          T.react(el); return true;
        case 'tdy-more': T.more(el); return true;
        case 'tdy-sort': T.pk.sort = el.dataset.k; document.querySelectorAll('.tdy-seg button').forEach((b) => { b.classList.toggle('on', b === el); b.setAttribute('aria-selected', String(b === el)); }); T.drawGrid(); return true;
        case 'tdy-scene': T.pk.scene = el.dataset.k; document.querySelectorAll('.tdy-fchips .dsc-chip').forEach((b) => b.classList.toggle('on', b === el)); T.drawGrid(); return true;
        default: return false;
      }
    });
    // the first page was drawn before we were registered
    if (late) try {
      if (location.pathname === '/' && !location.hash) T.render();
      else if (location.pathname === '/picks') T.renderPicks();
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
