/* Share MUSIC — Community: short posts with songs (mixtapes), one photo, song battles, quotes, replies and music reactions.
 * Pages: /c (timeline), /c/<pid> (a post with its replies). Posting is a sheet (Composer) that can open anywhere,
 * e.g. from the player ("この曲をつぶやく"). Server: netlify/functions/posts.mjs */

const RX = [['heart', '♥', 'いいね'], ['fire', '🔥', 'アガる'], ['cry', '😭', '泣ける'], ['loop', '🎧', 'ヘビロテ'], ['emo', '✨', 'エモい']];
const RX_ICON = Object.fromEntries(RX.map(([k, e]) => [k, e]));

const Posts = {
  feed: 'all', items: [], next: null, me: '', cache: new Map(),
  async headers() { try { return (await Social.headers()) || {}; } catch { return {}; } },
  async get(path) {
    const r = await fetch(path, { headers: await this.headers() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '読み込めませんでした');
    if (j.me !== undefined) this.me = j.me;
    return j;
  },
  async send(path, body, method = 'POST') {
    const h = await Social.headers(); if (!h) throw new AuthError('ログインしてください');
    const r = await fetch(path, { method, headers: { ...h, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new AuthError(j.error || 'ログインしてください');
    if (!r.ok) throw new Error(j.error || 'できませんでした');
    return j;
  },
  remember(list) { for (const p of list) if (p?.pid) this.cache.set(p.pid, p); },

  /* ---------- rendering ---------- */
  text(t) {
    // escape, then turn URLs into links and keep line breaks
    return esc(t || '').replace(/https?:\/\/[^\s<>"']+/g, (u) => `<a href="${u}" target="_blank" rel="noopener nofollow">${u.length > 48 ? u.slice(0, 46) + '…' : u}</a>`);
  },
  songRow(p, s, i) {
    return `<div class="ps-row ${Player.idx === i && S.view?.id === 'post:' + p.pid ? 'now' : ''}" data-act="post-play" data-pid="${p.pid}" data-i="${i}">
      <img src="${esc(s.art || s.thumb)}" alt="" loading="lazy"><span class="ps-t"><b>${esc(s.title)}</b><small>${esc(s.artist)}</small></span>
      <span class="ps-d">${fmtDur(s.d)}</span><span class="ps-play">${ICON.play}</span></div>`;
  },
  songsHtml(p) {
    const s = p.songs || []; if (!s.length) return '';
    if (p.battle) return this.battleHtml(p);
    if (s.length === 1) {
      const x = s[0];
      return `<div class="ps-one" data-act="post-play" data-pid="${p.pid}" data-i="0">
        <img src="${esc(x.art || x.thumb)}" alt="" loading="lazy"><span class="ps-t"><span class="ps-k">♪ SONG</span><b>${esc(x.title)}</b><small>${esc(x.artist)}</small></span><span class="ps-big">${ICON.play}</span></div>`;
    }
    const shown = s.slice(0, 5);
    return `<div class="ps-mix">
      <div class="ps-mix-h"><span class="ps-k">MIXTAPE · ${s.length}曲 · ${fmtTotal(s.reduce((a, x) => a + (x.d || 0), 0))}</span><button class="btn sm solid" data-act="post-play" data-pid="${p.pid}" data-i="0">${ICON.play} まとめて再生</button></div>
      ${shown.map((x, i) => this.songRow(p, x, i)).join('')}
      ${s.length > shown.length ? `<button class="ps-more" data-act="go" data-to="/c/${p.pid}">ほか${s.length - shown.length}曲を見る</button>` : ''}</div>`;
  },
  battleHtml(p) {
    const [a, b] = p.songs, v = p.votes || [0, 0], total = v[0] + v[1], voted = p.myVote === 0 || p.myVote === 1;
    const side = (x, i) => {
      const pct = total ? Math.round((v[i] / total) * 100) : 0;
      return `<div class="pb-side ${voted ? 'done' : ''} ${p.myVote === i ? 'mine' : ''}">
        <button class="pb-art" data-act="post-play" data-pid="${p.pid}" data-i="${i}" aria-label="${esc(x.title)} を再生"><img src="${esc(x.art || x.thumb)}" alt="" loading="lazy"><span class="ps-play">${ICON.play}</span></button>
        <b>${esc(x.title)}</b><small>${esc(x.artist)}</small>
        ${voted ? `<div class="pb-bar"><i style="width:${pct}%"></i><span>${pct}%</span></div>` : ''}
        <button class="btn sm ${p.myVote === i ? 'solid' : ''} pb-vote" data-act="post-vote" data-pid="${p.pid}" data-side="${i}">${p.myVote === i ? '✓ 投票済み' : 'こっちが好き'}</button></div>`;
    };
    return `<div class="pbattle"><div class="ps-k ic-line">${ICON.vs} 曲バトル ・ ${total}票</div><div class="pb-grid">${side(a, 0)}<div class="pb-vs">VS</div>${side(b, 1)}</div></div>`;
  },
  quoteHtml(q) {
    if (!q) return '';
    if (q.deleted) return '<div class="post-q gone">この投稿は削除されました</div>';
    return `<div class="post-q" data-act="go" data-to="/c/${q.pid}">
      <div class="post-q-h">${Avatars.html(q.byId, q.by, 'xs')}<b>${esc(q.by)}</b><span>・${ago(q.at)}</span></div>
      ${q.text ? `<div class="post-q-t">${esc(q.text)}</div>` : ''}
      ${q.songs?.length ? `<div class="post-q-s">${q.battle ? 'VS ・ ' : ''}${q.songs.map((s) => esc(s.title)).join(' ／ ')}</div>` : ''}
      ${q.img ? `<img class="post-q-img" src="/api/pimg?k=${esc(q.img)}" alt="" loading="lazy">` : ''}</div>`;
  },
  rxHtml(p) {
    const mine = new Set(p.mine || []);
    const chips = RX.filter(([k]) => p.rx?.[k] || mine.has(k)).map(([k, e, l]) => `<button class="rx ${mine.has(k) ? 'on' : ''}" data-act="post-react" data-pid="${p.pid}" data-r="${k}" title="${l}"><span>${e}</span>${p.rx?.[k] || ''}</button>`).join('');
    return `<div class="rxs">${chips}<button class="rx add" data-act="post-rx-pick" data-pid="${p.pid}" aria-label="リアクション">${ICON.smile}</button>
      <div class="rx-pick" hidden>${RX.map(([k, e, l]) => `<button data-act="post-react" data-pid="${p.pid}" data-r="${k}" title="${l}" aria-label="${l}"><span>${e}</span></button>`).join('')}</div></div>`;
  },
  card(p, { detail = false } = {}) {
    if (!p || p.deleted) return '<article class="post gone">この投稿は削除されました</article>';
    const mine = this.me && p.byId === this.me;
    return `<article class="post ${detail ? 'detail' : ''}" data-pid="${p.pid}" ${detail ? '' : `data-act="post-open" data-to="/c/${p.pid}"`}>
      <div class="post-h">
        <a class="post-av" href="/u/${esc(p.byId)}" data-act="go" data-to="/u/${esc(p.byId)}">${Avatars.html(p.byId, p.by)}</a>
        <div class="post-who"><a href="/u/${esc(p.byId)}" data-act="go" data-to="/u/${esc(p.byId)}"><b>${esc(p.by)}</b></a><a class="post-time" href="/c/${p.pid}" data-act="go" data-to="/c/${p.pid}">${ago(p.at)}</a></div>
        <button class="post-menu-btn" data-act="post-menu" aria-label="メニュー">⋯</button>
        <div class="post-menu" hidden>${mine ? `<button data-act="post-del" data-pid="${p.pid}" class="ic-line danger">${ICON.close} 削除する</button>` : `<button data-act="report" data-kind="m" data-pid="${p.pid}" class="ic-line">${ICON.flag} 通報する</button>`}<button data-act="post-link" data-pid="${p.pid}" class="ic-line">${ICON.link} 共有・リンクをコピー</button></div>
      </div>
      ${p.text ? `<div class="post-text">${this.text(p.text)}</div>` : ''}
      ${p.img ? `<button class="post-img" data-act="post-img-view" data-k="${esc(p.img)}"><img src="/api/pimg?k=${esc(p.img)}" alt="" loading="lazy"></button>` : ''}
      ${this.songsHtml(p)}
      ${this.quoteHtml(p.q)}
      <div class="post-f">
        <button class="pf" data-act="post-reply" data-pid="${p.pid}" aria-label="返信">${ICON.comment}<span>${p.rc || ''}</span></button>
        <button class="pf" data-act="post-quote" data-pid="${p.pid}" aria-label="引用">${ICON.quote}<span>${p.qc || ''}</span></button>
        ${detail && !mine ? `<button class="pf" data-act="report" data-kind="m" data-pid="${p.pid}" aria-label="通報" title="運営に通報">${ICON.flag}</button>` : ''}
        ${this.rxHtml(p)}
      </div>
    </article>`;
  },
  redraw(p) {
    this.remember([p]);
    document.querySelectorAll(`.post[data-pid="${p.pid}"]`).forEach((el) => { el.outerHTML = this.card(p, { detail: el.classList.contains('detail') }); });
    this.markNow();
  },
  markNow() { document.querySelectorAll('.ps-row').forEach((r) => r.classList.toggle('now', S.view?.id === 'post:' + r.dataset.pid && Player.idx === +r.dataset.i)); },

  /* ---------- actions ---------- */
  async react(el) {
    if (!Api.connected()) { toast('リアクションするにはログインしてください'); if (!(await login())) return; }
    el.closest('.rxs')?.querySelector('.rx-pick')?.setAttribute('hidden', '');
    try { const j = await this.send('/api/post-react', { pid: el.dataset.pid, r: el.dataset.r }); this.redraw(j.item); } catch (e) { toast(errText(e), 4000); }
  },
  async vote(el) {
    if (!Api.connected()) { toast('投票するにはログインしてください'); if (!(await login())) return; }
    try { const j = await this.send('/api/post-vote', { pid: el.dataset.pid, side: +el.dataset.side }); this.redraw(j.item); } catch (e) { toast(errText(e), 4000); }
  },
  async del(el) {
    if (!confirm('この投稿を削除しますか？')) return;
    try { await this.send('/api/posts?pid=' + el.dataset.pid, null, 'DELETE'); toast('削除しました'); this.items = this.items.filter((x) => x.pid !== el.dataset.pid); if (location.pathname === '/c/' + el.dataset.pid) go('/c'); else el.closest('.post')?.remove(); } catch (e) { toast(errText(e), 4000); }
  },
  play(el) {
    const p = this.cache.get(el.dataset.pid); if (!p?.songs?.length) return;
    const i = +el.dataset.i || 0, id = 'post:' + p.pid;
    if (S.view?.id === id && Player.idx === i && Player.yt) return Player.toggle();
    if (S.view?.id !== id) {
      if (Player.idx >= 0) Player.close();
      S.view = { id, p: { id, title: (p.text || '').slice(0, 40) || `${p.by}さんの投稿`, owner: p.by, image: p.songs[0].art || p.songs[0].thumb }, tracks: p.songs.map((s) => ({ id: s.id, name: s.title, artist: s.artist, d: s.d || 0, embed: true, thumb: s.art || s.thumb })) };
    }
    Player.order = null; Player.play(i);
  },
  viewImg(el) {
    const m = $('#modal');
    m.innerHTML = `<div class="imgview" data-act="modal-close"><img src="/api/pimg?k=${esc(el.dataset.k)}" alt=""></div>`;
    m.hidden = false; document.body.classList.add('modal-open');
  },
};

/* ---------- pages ---------- */
async function renderCommunity() {
  document.title = 'コミュニティ — Share MUSIC';
  const on = Api.connected(), feed = Posts.feed;
  setApp(`<h1 class="pagetitle">コミュニティ</h1>
    <div class="bhead" style="margin:4px 0 12px"><div class="seg" role="tablist">
      <button class="${feed === 'all' ? 'on' : ''}" data-act="feed-tab" data-feed="all">みんな</button>
      <button class="${feed === 'following' ? 'on' : ''}" data-act="feed-tab" data-feed="following">フォロー中</button></div></div>
    ${on ? `<button class="cmp-prompt" data-act="post-new">${Avatars.html(Api.profile?.id, Api.profile?.name)}<span>いまの気分を、曲といっしょに。</span><i>${ICON.plus}</i></button>`
         : `<div class="sheet flat stack center" style="padding:18px 16px;margin-bottom:12px"><div class="small muted">ログインすると、曲や写真をつけてつぶやけます。</div><div><button class="btn sm solid" data-act="login">Googleでログイン</button></div></div>`}
    <div id="pty-strip"></div>
    <div id="feed"><div class="loading" style="padding:24px 0"><span class="spinner"></span> 読み込み中…</div></div>`);
  partyList().then((items) => { const el = $('#pty-strip'); if (!el) return;
    el.innerHTML = `<div class="pty-strip"><div class="pty-strip-h"><b class="ic-line">${ICON.party} リスニングパーティー</b><button class="btn sm" data-act="go" data-to="/party">${items.length ? 'すべて見る' : '開く'}</button></div>${items.length ? `<div class="shelf-row">${items.map(partyCard).join('')}</div>` : '<div class="tiny muted">いま開催中のパーティーはありません。曲を流しながらみんなでチャットしよう</div>'}</div>`; });
  if (feed === 'following' && !on) { $('#feed').innerHTML = '<div class="sheet flat center small muted">フォロー中の人の投稿を見るにはログインしてください。</div>'; return; }
  try {
    const j = await Posts.get('/api/posts?feed=' + feed);
    if (location.pathname !== '/c') return;
    Posts.items = j.items; Posts.next = j.next; Posts.remember(j.items);
    drawFeed();
  } catch (e) { const f = $('#feed'); if (f) f.innerHTML = `<div class="note bad">${esc(errText(e))}</div>`; }
}
function drawFeed() {
  const f = $('#feed'); if (!f) return;
  f.innerHTML = Posts.items.length
    ? Posts.items.map((p) => Posts.card(p)).join('') + (Posts.next ? '<button class="btn quiet sm feed-more" data-act="feed-more">もっと見る</button>' : '<div class="feed-end">ここまでです</div>')
    : `<div class="sheet flat stack center" style="padding:30px 16px"><div class="empty-ic">${ICON.phones}</div><div class="muted small">${Posts.feed === 'following' ? 'フォロー中の人の投稿はまだありません。' : 'まだ投稿がありません。最初のひとことをどうぞ！'}</div></div>`;
  fixLetterbox(f);
}
async function feedMore(btn) {
  btn.disabled = true;
  try { const j = await Posts.get(`/api/posts?feed=${Posts.feed}&before=${Posts.next}`); Posts.items.push(...j.items); Posts.next = j.next; Posts.remember(j.items); drawFeed(); }
  catch (e) { toast(errText(e)); btn.disabled = false; }
}
async function renderPost(pid) {
  document.title = '投稿 — Share MUSIC';
  setApp(`<button class="btn quiet sm back" data-act="go" data-to="/c">← コミュニティ</button><div id="pthread"><div class="loading" style="padding:24px 0"><span class="spinner"></span> 読み込み中…</div></div>`);
  try {
    const j = await Posts.get('/api/post?pid=' + encodeURIComponent(pid));
    if (location.pathname !== '/c/' + pid) return;
    Posts.remember([j.item, j.parent, ...j.replies].filter(Boolean));
    const it = j.item;
    if (it.text) document.title = `${it.by}「${it.text.slice(0, 30)}」 — Share MUSIC`;
    $('#pthread').innerHTML = `${j.parent ? `<div class="thread-parent">${Posts.card(j.parent)}</div>` : ''}
      ${Posts.card(it, { detail: true })}
      ${it.deleted ? '' : `<button class="cmp-prompt reply" data-act="post-reply" data-pid="${it.pid}">${Avatars.html(Api.profile?.id, Api.profile?.name || '?')}<span>返信する…</span><i>${ICON.comment}</i></button>`}
      <div class="label"><b>${ICON.comment}</b> 返信 ${j.replies.length || ''}</div>
      ${j.replies.length ? j.replies.map((r) => Posts.card(r)).join('') : '<div class="small muted" style="padding:6px 2px 20px">まだ返信はありません。</div>'}`;
    fixLetterbox($('#pthread'));
  } catch (e) { $('#pthread').innerHTML = `<div class="sheet stack" style="margin-top:20px"><b>${esc(errText(e))}</b><div><button class="btn sm" data-act="go" data-to="/c">コミュニティへ</button></div></div>`; }
}

/* ---------- composer (a sheet that opens anywhere) ---------- */
const Composer = {
  st: null,
  async open(opt = {}) {
    if (!Api.connected()) { toast('つぶやくにはログインしてください'); if (!(await login())) return; }
    this.st = { songs: opt.songs || [], quote: opt.quote || null, parent: opt.parent || null, battle: false, img: null, results: null, searching: false };
    const m = $('#modal');
    m.innerHTML = `<div class="modal-card cmp" role="dialog" aria-label="つぶやく">
      <div class="row cmp-top"><button class="btn quiet sm" data-act="modal-close">キャンセル</button><span class="spacer center"><b>${this.st.parent ? '返信' : this.st.quote ? '引用してつぶやく' : 'つぶやく'}</b></span><button class="btn sm solid" data-act="cmp-send" id="cmp-send">投稿する</button></div>
      ${this.st.parent ? `<div class="cmp-ctx">返信先：${esc(this.st.parent.by)}さん「${esc((this.st.parent.text || this.st.parent.songs?.[0]?.title || '').slice(0, 40))}」</div>` : ''}
      <div class="cmp-me">${Avatars.html(Api.profile?.id, Api.profile?.name)}<textarea id="cmp-text" maxlength="500" rows="4" placeholder="${this.st.parent ? '返信を書く' : 'いまの気分、好きな曲のこと、なんでも。'}"></textarea></div>
      <div id="cmp-att"></div>
      <div class="cmp-tools">
        <button class="ctool" data-act="cmp-song">${ICON.note}曲を追加</button>
        <label class="ctool">${ICON.image}写真<input type="file" accept="image/*" id="cmp-file" hidden></label>
        <button class="ctool" data-act="cmp-battle" id="cmp-battle">${ICON.vs}曲バトル</button>
        <span class="spacer"></span><span class="tiny muted" id="cmp-n">0/500</span>
      </div>
      <div id="cmp-search" hidden></div>
    </div>`;
    m.hidden = false; document.body.classList.add('modal-open');
    $('#cmp-text').addEventListener('input', (e) => { $('#cmp-n').textContent = `${e.target.value.length}/500`; });
    $('#cmp-file').addEventListener('change', (e) => this.pickImage(e.target.files?.[0]));
    this.draw();
    setTimeout(() => $('#cmp-text')?.focus(), 250);
  },
  draw() {
    const st = this.st, el = $('#cmp-att'); if (!el) return;
    if (st.battle && st.songs.length !== 2) st.battle = false;
    const bt = $('#cmp-battle'); if (bt) { bt.classList.toggle('on', st.battle); bt.disabled = st.songs.length !== 2; bt.title = st.songs.length === 2 ? '2曲で投票を集める' : '曲を2曲選ぶと使えます'; }
    el.innerHTML = `${st.img ? `<div class="cmp-img"><img src="${st.img.url}" alt=""><button data-act="cmp-img-x" aria-label="写真を外す">${ICON.close}</button></div>` : ''}
      ${st.songs.length ? `<div class="cmp-songs">${st.battle ? `<div class="ps-k ic-line">${ICON.vs} 曲バトル：どっちが好きか投票してもらいます</div>` : st.songs.length > 1 ? `<div class="ps-k">MIXTAPE · ${st.songs.length}曲</div>` : ''}${st.songs.map((s, i) => `<div class="cmp-song"><img src="${esc(s.art || s.thumb)}" alt=""><span class="ps-t"><b>${esc(s.title)}</b><small>${esc(s.artist)}</small></span>
        ${i > 0 ? `<button data-act="cmp-up" data-i="${i}" aria-label="上へ">↑</button>` : ''}<button data-act="cmp-x" data-i="${i}" aria-label="外す">${ICON.close}</button></div>`).join('')}</div>` : ''}
      ${st.quote ? `<div class="cmp-quote">${Posts.quoteHtml(st.quote)}</div>` : ''}`;
  },
  /* ---- songs ---- */
  toggleSearch() {
    const box = $('#cmp-search'); if (!box) return;
    box.hidden = !box.hidden; if (box.hidden) return;
    const quick = [];
    if (Player.track) quick.push({ label: '再生中の曲', icon: 'play', s: { id: Player.track.id, title: Player.track.name, artist: Player.track.artist, thumb: Player.track.thumb, d: Player.track.d } });
    for (const b of (Social.sbms || []).filter((x) => x.vid).slice(0, 6)) quick.push({ label: b.title, icon: 'star', s: { id: b.vid, title: b.title, artist: b.artist, thumb: b.image, d: b.d } });
    this.quick = quick;
    box.innerHTML = `<div class="field"><input class="input" id="cmp-q" placeholder="曲名・アーティストで検索"><button class="btn solid" data-act="cmp-search-go">検索</button></div>
      ${quick.length ? `<div class="cmp-quick">${quick.map((q, i) => `<button class="gchip ic-line" data-act="cmp-quick" data-i="${i}">${ICON[q.icon] || ''}${esc(q.label)}</button>`).join('')}</div>` : ''}
      <div id="cmp-res"></div>`;
    $('#cmp-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.search(); } });
    $('#cmp-q').focus();
    if (Api.connected() && !Social.sbms) Social.loadBookmarks(false, 's').catch(() => {});
  },
  async search() {
    const q = $('#cmp-q')?.value.trim(); if (!q) return;
    const box = $('#cmp-res'); box.innerHTML = '<div class="loading" style="padding:10px 0"><span class="spinner"></span> 検索中…</div>';
    try {
      const rs = await Catalog.search(q, 12);
      this.results = rs.map((x) => ({ name: x.trackName, artist: x.artistName, album: x.collectionName, art: Catalog.art(x.artworkUrl100, 300), d: Math.round((x.trackTimeMillis || 0) / 1000) }));
      box.innerHTML = this.results.length ? this.results.map((x, i) => `<button class="cmp-res" data-act="cmp-pick" data-i="${i}"><img src="${esc(x.art)}" alt=""><span class="ps-t"><b>${esc(x.name)}</b><small>${esc(x.artist)} ・ ${esc(x.album || '')}</small></span><i>＋</i></button>`).join('') : '<div class="small muted">見つかりませんでした</div>';
    } catch (e) { box.innerHTML = `<div class="small muted">${esc(errText(e))}</div>`; }
  },
  async pick(i, btn) {
    const x = this.results?.[i]; if (!x) return;
    if (this.st.songs.length >= 30) return toast('曲は30曲までです');
    btn.disabled = true; btn.querySelector('i').innerHTML = '<span class="spinner"></span>';
    try {
      const r = await fetch('/api/song-match?' + new URLSearchParams({ r: '3', t: x.name, a: x.artist, d: String(x.d || 0) }));
      const j = await r.json().catch(() => ({}));
      if (!j.videoId) throw new Error('この曲は YouTube で見つかりませんでした');
      this.add({ id: j.videoId, title: x.name, artist: x.artist, thumb: j.thumb, art: x.art, d: x.d || j.d });
      btn.querySelector('i').textContent = '✓';
    } catch (e) { toast(errText(e), 4000); btn.disabled = false; btn.querySelector('i').textContent = '＋'; }
  },
  add(s) {
    if (this.st.songs.some((x) => x.id === s.id)) return toast('もう追加しています');
    this.st.songs.push(s); this.draw(); toast(`「${s.title}」を追加しました`, 1600);
  },
  /* ---- photo: shrink in the browser before upload ---- */
  async pickImage(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) return toast('画像を選んでください');
    try {
      const bmp = await createImageBitmap(file).catch(async () => { const im = new Image(); im.src = URL.createObjectURL(file); await im.decode(); return im; });
      const max = 1600, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      let q = 0.86, blob;
      do { blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', q)); q -= 0.1; } while (blob && blob.size > 850 * 1024 && q > 0.4);
      if (!blob || blob.size > 880 * 1024) return toast('画像が大きすぎます');
      this.st.img = { blob, url: URL.createObjectURL(blob) }; this.draw();
    } catch { toast('この画像は読み込めませんでした'); }
  },
  /* ---- send ---- */
  async send(btn) {
    const st = this.st, text = $('#cmp-text').value.trim();
    if (!text && !st.songs.length && !st.img) return toast('文章・曲・写真のどれかを入れてください');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      let img = '';
      if (st.img) {
        const h = await Social.headers(); if (!h) throw new AuthError('ログインしてください');
        const r = await fetch('/api/post-img', { method: 'POST', headers: { ...h, 'Content-Type': 'image/jpeg' }, body: st.img.blob });
        const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || '写真を送れませんでした');
        img = j.key;
      }
      const j = await Posts.send('/api/posts', { text, songs: st.songs, img, battle: st.battle, quote: st.quote?.pid || '', parent: st.parent?.pid || '' });
      ShareImage.close();
      toast(st.parent ? '返信しました' : '投稿しました');
      Posts.remember([j.item]);
      if (st.parent) renderPost(st.parent.pid);
      else if (location.pathname === '/c' && Posts.feed === 'all') { Posts.items.unshift(j.item); drawFeed(); }
      else go('/c/' + j.item.pid);
    } catch (e) { toast(errText(e), 5000); btn.disabled = false; btn.textContent = '投稿する'; }
  },
  /** from the player: post the song that is playing now */
  nowPlaying() {
    const t = Player.track; if (!t) return;
    if (Player.pip) Player.setPip(true);
    this.open({ songs: [{ id: t.id, title: t.name, artist: t.artist, thumb: t.thumb, d: t.d }] });
  },
};

/* events for the community (the main click handler in app.js forwards unknown actions here) */
function postAction(act, el, ev) {
  switch (act) {
    case 'post-new': Composer.open(); return true;
    case 'post-open': if (!getSelection()?.toString()) go(el.dataset.to); return true;
    case 'post-react': Posts.react(el); return true;
    case 'post-rx-pick': { const pk = el.parentElement.querySelector('.rx-pick'); document.querySelectorAll('.rx-pick').forEach((x) => { if (x !== pk) x.hidden = true; }); pk.hidden = !pk.hidden; return true; }
    case 'post-vote': Posts.vote(el); return true;
    case 'post-play': Posts.play(el); return true;
    case 'post-del': Posts.del(el); return true;
    case 'post-menu': { const mn = el.parentElement.querySelector('.post-menu'); document.querySelectorAll('.post-menu').forEach((x) => { if (x !== mn) x.hidden = true; }); mn.hidden = !mn.hidden; return true; }
    case 'post-link': {
      el.closest('.post-menu').hidden = true;
      const p = Posts.cache.get(el.dataset.pid), url = location.origin + '/c/' + el.dataset.pid;
      const songs = p?.songs || [], what = p?.battle ? '曲バトル' : songs.length > 1 ? 'ミックステープ' : 'つぶやき';
      const body = p?.battle && songs.length === 2 ? `${songs[0].title} vs ${songs[1].title} どっちが好き？` : (p?.text || '').slice(0, 80) || (songs[0] ? `♪ ${songs[0].title} / ${songs[0].artist}` : '');
      openShare({ url, title: `${p?.by || ''}さんの${what}`, text: `${p?.by || ''}さんの${what}${body ? `「${body}」` : ''} #ShareMUSIC` });
      return true;
    }
    case 'post-reply': { const p = Posts.cache.get(el.dataset.pid); if (p) Composer.open({ parent: p }); return true; }
    case 'post-quote': { const p = Posts.cache.get(el.dataset.pid); if (p) Composer.open({ quote: { pid: p.pid, by: p.by, byId: p.byId, text: p.text, at: p.at, songs: p.songs?.slice(0, 2), img: p.img, battle: p.battle } }); return true; }
    case 'post-img-view': Posts.viewImg(el); return true;
    case 'feed-tab': Posts.feed = el.dataset.feed; renderCommunity(); return true;
    case 'feed-more': feedMore(el); return true;
    case 'cmp-song': Composer.toggleSearch(); return true;
    case 'cmp-search-go': Composer.search(); return true;
    case 'cmp-pick': Composer.pick(+el.dataset.i, el); return true;
    case 'cmp-quick': { const q = Composer.quick?.[+el.dataset.i]; if (q) Composer.add(q.s); return true; }
    case 'cmp-x': Composer.st.songs.splice(+el.dataset.i, 1); Composer.draw(); return true;
    case 'cmp-up': { const s = Composer.st.songs, i = +el.dataset.i; [s[i - 1], s[i]] = [s[i], s[i - 1]]; Composer.draw(); return true; }
    case 'cmp-battle': Composer.st.battle = !Composer.st.battle; Composer.draw(); return true;
    case 'cmp-img-x': Composer.st.img = null; Composer.draw(); return true;
    case 'cmp-send': Composer.send(el); return true;
    case 'np-post': Composer.nowPlaying(); return true;
    default: return false;
  }
}
