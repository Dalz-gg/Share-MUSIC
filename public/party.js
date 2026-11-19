/* Share MUSIC — Listening parties: listen to the same song at the same moment, with chat and reactions.
 * Each person's own YouTube player follows the room (host = source of truth). Server: netlify/functions/party.mjs
 * Pages: /party (live rooms), /party/<rid> (a room). */

const Party = {
  rid: null, k: null, host: false, named: false, room: null, seq: 0, offset: 0, people: { count: 0, list: [] },
  chat: [], listening: false, timer: null, lastPush: 0, busy: false, tab: 'chat',
  get id() { return this.rid ? 'party:' + this.rid : ''; },
  active() { return !!this.rid && S.view?.id === this.id && this.listening; },
  isGuest() { return this.active() && !this.host; },
  now() { return Date.now() + this.offset; },
  expected(r = this.room) { return !r ? 0 : r.playing ? r.pos + (this.now() - r.at) / 1000 : r.pos; },
  auth: async () => { try { return (await Social.headers()) || {}; } catch { return {}; } },
  async post(path, body, withAuth) {
    const r = await fetch(path, { method: 'POST', headers: { ...(withAuth ? await this.auth() : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'できませんでした');
    return j;
  },
  saveKey() { try { sessionStorage.setItem('ps.pk.' + this.rid, JSON.stringify({ k: this.k, host: this.host, named: this.named })); } catch { /* ignore */ } },
  loadKey(rid) { try { return JSON.parse(sessionStorage.getItem('ps.pk.' + rid) || 'null'); } catch { return null; } },

  /* ---------- open / join ---------- */
  async create(title, songs = []) {
    if (!Api.connected()) { toast('パーティーを開くにはログインしてください'); if (!(await login())) return; }
    try {
      const j = await this.post('/api/party', { title, songs }, true);
      this.leave(true);
      this.rid = j.rid; this.k = j.k; this.host = true; this.named = true; this.room = j.room; this.offset = j.now - Date.now(); this.seq = 0; this.chat = [];
      this.saveKey(); ShareImage.close();
      go('/party/' + j.rid);
    } catch (e) { toast(errText(e), 4000); }
  },
  async enter(rid) {
    if (this.rid !== rid) { this.leave(true); this.rid = rid; this.chat = []; this.seq = 0; this.room = null; this.seenSeq = new Set(); }
    const saved = this.loadKey(rid);
    if (saved && (saved.named || !Api.connected())) Object.assign(this, saved);
    else {
      const j = await this.post('/api/party-join', { rid }, Api.connected());
      this.k = j.k; this.host = j.host; this.named = j.named; this.saveKey();
    }
    this.loop();
  },
  async rejoinNamed() {
    if (!(await login())) return;
    try { const j = await this.post('/api/party-join', { rid: this.rid }, true); this.k = j.k; this.host = j.host; this.named = j.named; this.saveKey(); this.draw(); } catch (e) { toast(errText(e)); }
  },
  leave(silent) {
    clearTimeout(this.timer); this.timer = null;
    if (this.listening && !silent) toast('パーティーから抜けました');
    this.listening = false; document.body.classList.remove('party-guest', 'party-on');
    if (!silent) this.rid = null;
  },

  /** in the room while listening: video pinned on top, chat in the middle, input at the bottom */
  theater() {
    const on = !!this.rid && location.pathname === '/party/' + this.rid && this.listening && !this.room?.closed;
    document.body.classList.toggle('party-theater', on);
    if (on && Player.pip) Player.setPip(false);
  },
  /* ---------- polling + sync ---------- */
  loop() {
    clearTimeout(this.timer);
    const tick = async () => {
      if (!this.rid) return;
      const onPage = location.pathname === '/party/' + this.rid;
      if (!onPage && !this.active()) { this.listening = false; document.body.classList.remove('party-guest', 'party-on'); return; } // left the party
      await this.poll().catch(() => {});
      this.timer = setTimeout(tick, document.hidden ? 6000 : 2500);
    };
    tick();
  },
  async poll() {
    const r = await fetch(`/api/party?rid=${this.rid}&k=${this.k || ''}&since=${this.seq}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { if (r.status === 404) { this.room = null; this.draw(); } return; }
    const t0 = Date.now(); this.offset = j.now - t0;
    const prevIdx = this.room?.idx, prevLen = this.room?.queue?.length;
    this.room = j.room; this.people = j.people || this.people;
    if (j.me) { this.host = j.me.host; }
    if (j.chat?.length) { this.seq = j.seq; this.addChat(j.chat); }
    if (this.room.closed) { if (this.listening) { Player.close(); toast('パーティーは終了しました'); } this.listening = false; document.body.classList.remove('party-guest', 'party-on'); }
    this.sync();
    if (prevIdx !== this.room.idx || prevLen !== this.room.queue.length) this.drawQueue();
    this.drawNow(); this.drawPeople(); this.theater();
  },
  /** make my player match the room (guests), or publish my player's state (host) */
  sync() {
    const r = this.room; if (!r || !this.listening || r.closed) return;
    const tracks = r.queue.map((s) => ({ id: s.id, name: s.title, artist: s.artist, d: s.d || 0, embed: true, thumb: s.art || s.thumb }));
    if (S.view?.id !== this.id) {
      if (Player.idx >= 0) Player.close();
      S.view = { id: this.id, p: { id: this.id, title: r.title, owner: r.host, image: tracks[r.idx]?.thumb || '' }, tracks };
    } else S.view.tracks = tracks;
    document.body.classList.add('party-on'); document.body.classList.toggle('party-guest', !this.host);
    if (!tracks.length) return;
    const yt = Player.yt, cur = yt?.getCurrentTime?.() || 0, exp = this.expected();
    if (this.host) {
      if (Player.idx < 0) { if (r.playing) { Player.play(r.idx); this.seekSoon(exp); } return; }
      const changed = Player.idx !== r.idx || Player.playing !== r.playing || (Player.playing && Math.abs(cur - exp) > 3.5);
      if (changed && Date.now() - this.lastPush > 1200) this.pushState();
      return;
    }
    // guest: follow the room
    if (Player.idx !== r.idx) { Player.play(r.idx); this.seekSoon(exp); return; }
    if (!yt) return;
    if (r.playing && !Player.playing) { yt.playVideo?.(); }
    if (!r.playing && Player.playing) { yt.pauseVideo?.(); }
    if (r.playing && Math.abs(cur - exp) > 2.5 && exp < (tracks[r.idx].d || 1e9) - 2) yt.seekTo?.(exp, true);
  },
  seekSoon(sec) { setTimeout(() => { if (this.active() && sec > 2) Player.yt?.seekTo?.(this.expected(), true); }, 1800); },
  async pushState() {
    this.lastPush = Date.now();
    const pos = Player.yt?.getCurrentTime?.() || 0;
    try { const j = await this.post('/api/party-ctl', { rid: this.rid, k: this.k, op: 'sync', idx: Math.max(0, Player.idx), playing: Player.playing, pos }); this.room = j.room; this.offset = j.now - Date.now(); } catch { /* next tick */ }
  },
  /** the button that starts sound (browsers need a tap before playing) */
  listen() {
    const r = this.room; if (!r) return;
    if (!r.queue.length) return toast(this.host ? 'まず曲を追加してください' : 'まだ曲がありません');
    this.listening = true;
    const tracks = r.queue.map((s) => ({ id: s.id, name: s.title, artist: s.artist, d: s.d || 0, embed: true, thumb: s.art || s.thumb }));
    if (Player.idx >= 0) Player.close();
    S.view = { id: this.id, p: { id: this.id, title: r.title, owner: r.host, image: tracks[r.idx]?.thumb || '' }, tracks };
    Player.order = null; Player.play(r.idx);
    if (Player.pip) Player.setPip(false);
    setTimeout(() => this.theater(), 50);
    if (!this.host || r.playing) this.seekSoon(this.expected());
    if (this.host && !r.playing) setTimeout(() => this.pushState(), 1500);
    this.drawNow();
  },
  /* ---------- host controls ---------- */
  async ctl(op, extra = {}) {
    try { const j = await this.post('/api/party-ctl', { rid: this.rid, k: this.k, op, ...extra }); this.room = j.room; this.drawQueue(); this.drawNow(); this.drawSettings(); return j; } catch (e) { toast(errText(e), 4000); }
  },
  hostPlay(i) { if (!this.listening) this.listen(); Player.play(i); setTimeout(() => this.pushState(), 1200); },
  /* ---------- chat + reactions ---------- */
  addChat(list) {
    for (const m of list) {
      if (this.seenSeq.has(m.seq)) continue;
      this.seenSeq.add(m.seq);
      if (m.r) { this.burst(m.r); continue; }
      this.chat.push(m);
    }
    this.chat = this.chat.slice(-150);
    this.drawChat(true);
  },
  async send() {
    const el = $('#pty-msg'), text = el?.value.trim(); if (!text) return;
    el.value = ''; el.disabled = true;
    try { await this.post('/api/party-chat', { rid: this.rid, k: this.k, text }); await this.poll(); } catch (e) { toast(errText(e), 3000); el.value = text; }
    el.disabled = false; el.focus();
  },
  async react(r) {
    if (!this.named) return this.rejoinNamed();
    this.burst(r, true);
    try { await this.post('/api/party-chat', { rid: this.rid, k: this.k, r }); } catch (e) { toast(errText(e), 2000); }
  },
  seenSeq: new Set(),
  burst(r, mine) {
    const box = $('#pty-float'); if (!box) return;
    const e = document.createElement('span'); e.className = 'pty-fly'; e.textContent = RX_ICON[r] || '♥';
    e.style.left = (10 + Math.random() * 75) + '%'; e.style.setProperty('--dx', (Math.random() * 60 - 30) + 'px');
    if (mine) e.classList.add('mine');
    box.appendChild(e); setTimeout(() => e.remove(), 2600);
  },

  /* ---------- drawing ---------- */
  draw() {
    const r = this.room, el = $('#pty'); if (!el) return;
    if (!r) { el.innerHTML = '<div class="sheet stack" style="margin-top:20px"><b>このパーティーは見つかりませんでした</b><div><button class="btn sm" data-act="go" data-to="/party">パーティー一覧へ</button></div></div>'; return; }
    document.title = `${r.title} — リスニングパーティー`;
    el.innerHTML = `
      <div class="pty-top"><button class="ibtn pty-out" data-act="go" data-to="/party" aria-label="ほかの画面へ（聴きながら移動できます）" title="ほかの画面へ（聴きながら移動できます）">←</button><span class="live ${r.closed ? 'off' : ''}">${r.closed ? '終了' : 'LIVE'}</span><b class="pty-top-title">${esc(r.title)}</b><span class="pty-ppl" id="pty-ppl"></span>
        <button class="ibtn" data-act="pty-share" title="招待リンクをコピー" aria-label="招待リンクをコピー">${ICON.link}</button></div>
      <h1 class="pagetitle pty-title">${esc(r.title)}</h1>
      <div class="by"><span class="by-l">主催</span>${Avatars.chip(r.hostId, r.host, { cls: 'lg' })}</div>
      <div class="pty-stage"><div id="pty-now"></div><div class="pty-float" id="pty-float" aria-hidden="true"></div></div>
      <div class="pty-rx">${RX.map(([k, e, l]) => `<button data-act="pty-rx" data-r="${k}" title="${l}" aria-label="${l}">${e}</button>`).join('')}</div>
      <div class="seg pty-seg"><button class="${this.tab === 'chat' ? 'on' : ''}" data-act="pty-tab" data-tab="chat">チャット</button><button class="${this.tab === 'queue' ? 'on' : ''}" data-act="pty-tab" data-tab="queue">曲順<span id="pty-qn"></span></button></div>
      <div id="pty-chatbox" ${this.tab === 'chat' ? '' : 'hidden'}><div class="pty-chat" id="pty-chat"></div><div id="pty-input"></div></div>
      <div id="pty-queuebox" ${this.tab === 'queue' ? '' : 'hidden'}><div id="pty-queue"></div></div>
      <div id="pty-settings"></div>`;
    this.drawNow(); this.drawPeople(); this.drawChat(); this.drawQueue(); this.drawSettings(); this.theater();
  },
  drawPeople() {
    const el = $('#pty-ppl'); if (!el) return;
    const p = this.people;
    el.innerHTML = `<span class="avs">${(p.list || []).slice(0, 5).map((x) => Avatars.html(x.id, x.name)).join('')}</span><span class="ppl-n">${p.count}人<span class="ppl-l">が参加中</span></span>`;
  },
  drawNow() {
    const el = $('#pty-now'), r = this.room; if (!el || !r) return;
    const t = r.queue[r.idx];
    const pos = this.expected(), d = t?.d || 0, pct = d ? Math.min(100, (pos / d) * 100) : 0;
    const status = r.closed ? '<div class="small muted">このパーティーは終了しました</div>'
      : !this.listening ? `<button class="btn lg solid pty-join" data-act="pty-listen">${ICON.play} ${this.host ? 'パーティーを始める' : '参加していっしょに聴く'}</button>`
      : this.host ? `<div class="pty-ctl"><button class="ibtn" data-act="p-prev" aria-label="前の曲">${ICON.prev}</button><button class="playbig" data-act="p-toggle" aria-label="再生/一時停止">${r.playing ? ICON.pause : ICON.play}</button><button class="ibtn" data-act="p-next" aria-label="次の曲">${ICON.next}</button></div><div class="tiny muted center">あなたの再生がみんなに届いています</div>`
      : `<div class="pty-sync"><i></i>${r.playing ? '主催者と同期して再生中' : '主催者が一時停止中'}</div>`;
    el.classList.toggle('compact', this.listening);
    el.innerHTML = t ? `<div class="pty-art ${r.playing && this.listening ? 'spin' : ''}"><img src="${esc(t.art || t.thumb)}" alt=""></div>
      <div class="pty-np"><span class="ps-k">NOW PLAYING ・ ${r.idx + 1} / ${r.queue.length}</span><b>${esc(t.title)}</b><small>${esc(t.artist)}${t.by ? ` ・ ${esc(t.by)}さんが追加` : ''}</small></div>
      <div class="pty-prog"><i style="width:${pct}%"></i></div>${status}`
      : `<div class="pty-empty">${ICON.phones}<div class="small muted">${this.host ? '「曲順」タブから曲を追加してパーティーを始めましょう' : 'まだ曲がありません。もうすぐ始まります'}</div></div>${this.host ? '<button class="btn solid" data-act="pty-add">＋ 曲を追加</button>' : ''}`;
    if (t) Backdrop.set(t.art || t.thumb);
  },
  drawChat(fresh) {
    const el = $('#pty-chat'); if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    el.innerHTML = this.chat.length ? this.chat.map((m) => (m.sys ? `<div class="pc-sys">${esc(m.text)}</div>`
      : `<div class="pc"><span class="pc-av">${Avatars.html(m.uid, m.name)}</span><div><b>${esc(m.name)}</b><span class="pc-t">${ago(m.at)}</span><p>${esc(m.text)}</p></div></div>`)).join('')
      : '<div class="small muted center" style="padding:20px 0">まだメッセージはありません。ひとこと送ってみましょう</div>';
    if (!fresh || near) el.scrollTop = el.scrollHeight;
    const inp = $('#pty-input');
    if (inp && !inp.dataset.ready) {
      inp.dataset.ready = '1';
      inp.innerHTML = this.named ? `<div class="pty-send"><input class="input" id="pty-msg" maxlength="200" placeholder="メッセージを送る"><button class="btn solid" data-act="pty-send">送信</button></div>`
        : `<button class="btn sm" data-act="pty-login">ログインしてチャットに参加</button>`;
      $('#pty-msg')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); this.send(); } });
    }
  },
  drawQueue() {
    const el = $('#pty-queue'), r = this.room; if (!el || !r) return;
    const n = $('#pty-qn'); if (n) n.textContent = ` ${r.queue.length}`;
    const canAdd = this.host || (r.open && this.named);
    el.innerHTML = `${canAdd && !r.closed ? '<button class="btn sm solid" data-act="pty-add" style="margin-bottom:10px">＋ 曲を追加</button>' : ''}
      ${!r.open && !this.host ? '<div class="tiny muted" style="margin-bottom:8px">いまは主催者だけが曲を追加できます</div>' : ''}
      <ol class="tracks">${r.queue.map((s, i) => `<li class="trk ${i === r.idx ? 'now' : ''} ${i < r.idx ? 'done' : ''}" ${this.host ? `data-act="pty-play" data-i="${i}"` : ''}>
        <span class="no">${i === r.idx ? '<span class="eq"><i></i><i></i><i></i></span>' : pad2(i + 1)}</span>
        <span class="th"><img src="${esc(s.art || s.thumb)}" alt="" loading="lazy"></span>
        <span class="t"><b>${esc(s.title)}</b><span>${esc(s.artist)}${s.by ? ` ・ ${esc(s.by)}` : ''}</span></span>
        <span class="dur">${fmtDur(s.d)}</span>
        ${this.host && i !== r.idx ? `<button class="trk-bm" data-act="pty-remove" data-i="${i}" title="外す" aria-label="外す">${ICON.close}</button>` : '<span></span>'}
      </li>`).join('')}</ol>`;
  },
  drawSettings() {
    const el = $('#pty-settings'), r = this.room; if (!el || !r || !this.host || r.closed) { if (el) el.innerHTML = ''; return; }
    el.innerHTML = `<div class="label"><b>${ICON.user}</b> 主催者メニュー</div>
      <div class="sheet flat stack">
        <label class="row"><span class="spacer small">参加者も曲を追加できる</span><input type="checkbox" data-act="pty-open" ${r.open ? 'checked' : ''}></label>
        <div class="row wrap-ok"><button class="btn sm" data-act="pty-share">招待リンクをコピー</button><button class="btn sm quiet danger" data-act="pty-close">パーティーを終える</button></div>
      </div>`;
  },
};

/* ---------- add songs ---------- */
const PartyAdd = {
  results: null,
  open() {
    const m = $('#modal');
    const quick = (Social.sbms || []).filter((x) => x.vid).slice(0, 8);
    m.innerHTML = `<div class="modal-card cmp" role="dialog" aria-label="曲を追加">
      <div class="row cmp-top"><b class="spacer">曲を追加</b><button class="btn quiet sm" data-act="modal-close" aria-label="閉じる">${ICON.close}</button></div>
      <div class="field"><input class="input" id="pa-q" placeholder="曲名・アーティストで検索"><button class="btn solid" data-act="pa-search">検索</button></div>
      ${quick.length ? `<div class="cmp-quick">${quick.map((b, i) => `<button class="gchip ic-line" data-act="pa-quick" data-i="${i}">${ICON.star}${esc(b.title)}</button>`).join('')}</div>` : ''}
      <div id="pa-res"></div></div>`;
    m.hidden = false; document.body.classList.add('modal-open');
    this.quick = quick;
    $('#pa-q').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); this.search(); } });
    setTimeout(() => $('#pa-q')?.focus(), 200);
    if (Api.connected() && !Social.sbms) Social.loadBookmarks(false, 's').catch(() => {});
  },
  async search() {
    const q = $('#pa-q')?.value.trim(); if (!q) return;
    const box = $('#pa-res'); box.innerHTML = '<div class="loading" style="padding:10px 0"><span class="spinner"></span> 検索中…</div>';
    try {
      const rs = await Catalog.search(q, 12);
      this.results = rs.map((x) => ({ name: x.trackName, artist: x.artistName, album: x.collectionName, art: Catalog.art(x.artworkUrl100, 300), d: Math.round((x.trackTimeMillis || 0) / 1000) }));
      box.innerHTML = this.results.length ? this.results.map((x, i) => `<button class="cmp-res" data-act="pa-pick" data-i="${i}"><img src="${esc(x.art)}" alt=""><span class="ps-t"><b>${esc(x.name)}</b><small>${esc(x.artist)} ・ ${esc(x.album || '')}</small></span><i>＋</i></button>`).join('') : '<div class="small muted">見つかりませんでした</div>';
    } catch (e) { box.innerHTML = `<div class="small muted">${esc(errText(e))}</div>`; }
  },
  async pick(i, btn) {
    const x = this.results?.[i]; if (!x) return;
    btn.disabled = true; btn.querySelector('i').innerHTML = '<span class="spinner"></span>';
    try {
      const r = await fetch('/api/song-match?' + new URLSearchParams({ r: '3', t: x.name, a: x.artist, d: String(x.d || 0) }));
      const j = await r.json().catch(() => ({}));
      if (!j.videoId) throw new Error('この曲は YouTube で見つかりませんでした');
      await this.add({ id: j.videoId, title: x.name, artist: x.artist, thumb: j.thumb, art: x.art, d: x.d || j.d });
      btn.querySelector('i').textContent = '✓';
    } catch (e) { toast(errText(e), 4000); btn.disabled = false; btn.querySelector('i').textContent = '＋'; }
  },
  async add(s) { const j = await Party.ctl('add', { songs: [s] }); if (j) toast(`「${s.title}」を追加しました`, 1600); },
};

/* ---------- pages ---------- */
async function renderParties() {
  document.title = 'リスニングパーティー — Share MUSIC';
  setApp(`<h1 class="pagetitle">リスニングパーティー</h1>
    <p class="small muted" style="margin-top:0">同じ曲を、同じ瞬間に。みんなで聴きながらチャットやリアクションで盛り上がれます。</p>
    <button class="btn lg solid" data-act="pty-new" style="width:100%;margin:6px 0 18px">${ICON.party} パーティーを開く</button>
    <div class="label"><b>${ICON.party}</b> いま開催中</div><div id="pty-list"><div class="loading" style="padding:16px 0"><span class="spinner"></span></div></div>`);
  const items = await partyList();
  const el = $('#pty-list'); if (!el) return;
  el.innerHTML = items.length ? `<div class="pty-cards">${items.map(partyCard).join('')}</div>` : '<div class="sheet flat center small muted" style="padding:24px 12px">いま開催中のパーティーはありません。最初のパーティーを開いてみましょう！</div>';
}
async function partyList() { try { const r = await fetch('/api/parties'); return r.ok ? (await r.json()).items || [] : []; } catch { return []; } }
function partyCard(x) {
  return `<button class="pty-card" data-act="go" data-to="/party/${x.rid}">
    <span class="pty-card-art">${x.now?.art ? `<img src="${esc(x.now.art)}" alt="" loading="lazy">` : ICON.phones}<span class="live">LIVE</span></span>
    <span class="pty-card-b"><b>${esc(x.title)}</b><small class="tw">${Avatars.html(x.hostId, x.host, 'xs')}${esc(x.host)} ・ ${x.listeners}人</small>${x.now ? `<small class="pty-card-now">♪ ${esc(x.now.title)} / ${esc(x.now.artist)}</small>` : ''}</span></button>`;
}
async function renderParty(rid) {
  setApp(`<button class="btn quiet sm back" data-act="go" data-to="/party">← パーティー一覧</button><div id="pty"><div class="loading" style="padding:24px 0"><span class="spinner"></span> 読み込み中…</div></div>`);
  try {
    await Party.enter(rid);
    await Party.poll();
    if (location.pathname !== '/party/' + rid) return;
    Party.draw();
  } catch (e) { const el = $('#pty'); if (el) el.innerHTML = `<div class="sheet stack" style="margin-top:20px"><b>${esc(errText(e))}</b><div><button class="btn sm" data-act="go" data-to="/party">パーティー一覧へ</button></div></div>`; }
}
/** open a new party, optionally starting with a list of songs */
function partyNew(songs = [], title = '') {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-card sheetup" role="dialog" aria-label="パーティーを開く">
    <div class="row" style="margin-bottom:10px"><b class="spacer display" style="font-size:19px">パーティーを開く</b><button class="btn quiet sm" data-act="modal-close" aria-label="閉じる">${ICON.close}</button></div>
    <label class="small muted">パーティーの名前</label><input class="input" id="pn-title" maxlength="60" value="${esc(title)}" placeholder="${esc((Api.profile?.name || 'あなた') + 'のリスニングパーティー')}">
    <div class="small muted" style="margin:10px 0">${songs.length ? `${songs.length}曲を曲順に入れて始めます。` : '曲はパーティーの中で追加できます。'}開くと「いま開催中」に並び、誰でも参加できます。</div>
    <button class="btn solid" style="width:100%" data-act="pn-go">パーティーを開く</button></div>`;
  m.hidden = false; document.body.classList.add('modal-open');
  PartyNew.songs = songs;
}
const PartyNew = { songs: [] };

function partyAction(act, el) {
  switch (act) {
    case 'pty-new': partyNew(); return true;
    case 'pn-go': Party.create($('#pn-title').value.trim(), PartyNew.songs); return true;
    case 'pty-listen': Party.listen(); return true;
    case 'pty-tab': Party.tab = el.dataset.tab; $('#pty-chatbox').hidden = Party.tab !== 'chat'; $('#pty-queuebox').hidden = Party.tab !== 'queue'; document.querySelectorAll('.pty-seg button').forEach((b) => b.classList.toggle('on', b.dataset.tab === Party.tab)); if (Party.tab === 'chat') Party.drawChat(); return true;
    case 'pty-send': Party.send(); return true;
    case 'pty-rx': Party.react(el.dataset.r); return true;
    case 'pty-login': Party.rejoinNamed(); return true;
    case 'pty-add': if (!Party.named && !Party.host) { Party.rejoinNamed(); return true; } PartyAdd.open(); return true;
    case 'pa-search': PartyAdd.search(); return true;
    case 'pa-pick': PartyAdd.pick(+el.dataset.i, el); return true;
    case 'pa-quick': { const b = PartyAdd.quick?.[+el.dataset.i]; if (b) PartyAdd.add({ id: b.vid, title: b.title, artist: b.artist, thumb: b.image, d: b.d }); return true; }
    case 'pty-play': if (Party.host) Party.hostPlay(+el.dataset.i); return true;
    case 'pty-remove': Party.ctl('remove', { i: +el.dataset.i }); return true;
    case 'pty-open': Party.ctl('open', { open: el.checked }); return true;
    case 'pty-close': if (confirm('パーティーを終えますか？参加者の再生も止まります。')) { Party.ctl('close'); Player.close(); Party.listening = false; } return true;
    case 'pty-share': { const r = Party.room, t = r?.queue?.[r.idx]; openShare({ url: location.origin + '/party/' + Party.rid, text: `いっしょに聴こう！リスニングパーティー「${r?.title || ''}」${t ? `\n♪ いま：${t.title} / ${t.artist}` : ''}` }); return true; }
    case 'pty-from-view': { const v = S.view; if (v?.tracks?.length) partyNew(v.tracks.map((t) => ({ id: t.id, title: t.name, artist: t.artist, thumb: t.thumb, d: t.d })), v.p?.title ? `「${v.p.title}」をみんなで` : ''); return true; }
    default: return false;
  }
}
