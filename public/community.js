/* Share MUSIC — community features: genres, likes (no login), comments, recommended songs, admin page,
 * login guide. Server side: netlify/functions/community.mjs and gallery.mjs */
'use strict';

const GENRES = [
  ['jpop', 'J-POP'], ['rock', 'ロック'], ['anime', 'アニソン・ボカロ'], ['citypop', 'シティポップ'], ['kpop', 'K-POP'],
  ['western', '洋楽'], ['hiphop', 'ヒップホップ・R&B'], ['edm', 'EDM・ダンス'], ['chill', 'アコースティック・チル'],
  ['bgm', '作業用・BGM'], ['other', 'その他'],
];
const genreName = (g) => (GENRES.find(([k]) => k === g) || [])[1] || '';
const genreOptions = (sel) => GENRES.map(([k, l]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${l}</option>`).join('');
/** genres of an item (new items carry `genres`, older ones a single `genre`) */
const genresOf = (x) => (x?.genres?.length ? x.genres : (x?.genre ? [x.genre] : []));
const genreTags = (x, cls = 'gtag') => genresOf(x).map((g) => `<span class="${cls}">${esc(genreName(g))}</span>`).join('');
/** multi-select (1-3, required). Nothing is selected by default. */
const genrePicker = (id, sel = []) => `<div class="gpick" id="${id}" role="group" aria-label="ジャンル（1〜3つ）">${GENRES.map(([k, l]) => `<button type="button" class="gchip ${sel.includes(k) ? 'on' : ''}" data-act="gp" data-g="${k}" aria-pressed="${sel.includes(k)}">${l}</button>`).join('')}</div>`;
const pickedGenres = (id) => [...document.querySelectorAll(`#${id} .gchip.on`)].map((b) => b.dataset.g);
function toggleGenre(btn) {
  const box = btn.closest('.gpick');
  if (!btn.classList.contains('on') && box.querySelectorAll('.gchip.on').length >= 3) return toast('ジャンルは3つまで選べます');
  btn.classList.toggle('on'); btn.setAttribute('aria-pressed', String(btn.classList.contains('on')));
  box.classList.remove('need');
}
const genreChips = (sel, act) => `<div class="gchips" role="tablist">${[['', 'すべて'], ...GENRES].map(([k, l]) => `<button class="gchip ${(sel || '') === k ? 'on' : ''}" data-act="${act}" data-g="${k}">${l}</button>`).join('')}</div>`;

/* =========================================================
 * Likes: anyone, no login. One like per device (random id kept in this browser).
 * ======================================================= */
const Likes = {
  device() {
    let d = store.get('device');
    if (!d) { const a = new Uint8Array(18); crypto.getRandomValues(a); d = [...a].map((b) => b.toString(16).padStart(2, '0')).join(''); store.set('device', d); }
    return d;
  },
  has(kind, id) { return !!store.get('liked', {})[`${kind}:${id}`]; },
  async toggle(kind, id, thread) {
    const r = await fetch('/api/like', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id, thread, device: this.device() }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'いいねできませんでした');
    const m = store.get('liked', {}); if (j.liked) m[`${kind}:${id}`] = 1; else delete m[`${kind}:${id}`]; store.set('liked', m);
    return j;
  },
  btn(kind, id, n, cls = '', thread = '') {
    const on = this.has(kind, id), sasa = kind === 's' && window.Today?.icon?.get; // a recommended song's like is 「刺さった」 (today.js)
    return `<button class="likebtn ${on ? 'on' : ''} ${sasa ? 'sasa' : ''} ${cls}" data-act="like" data-kind="${kind}" data-id="${esc(id)}" ${thread ? `data-thread="${esc(thread)}"` : ''} aria-pressed="${on}" aria-label="${sasa ? '刺さった' : 'いいね'}"${sasa ? ' title="刺さった"' : ''}>
      <span class="heart">${sasa || (on ? '♥' : '♡')}</span><span class="n">${n || 0}</span></button>`;
  },
};
async function onLike(el) {
  if (el.disabled) return;
  el.disabled = true;
  try {
    const { liked, n } = await Likes.toggle(el.dataset.kind, el.dataset.id, el.dataset.thread);
    document.querySelectorAll(`.likebtn[data-kind="${el.dataset.kind}"][data-id="${CSS.escape(el.dataset.id)}"]`).forEach((b) => {
      b.classList.toggle('on', liked); b.setAttribute('aria-pressed', String(liked));
      if (!b.classList.contains('sasa')) b.querySelector('.heart').textContent = liked ? '♥' : '♡'; b.querySelector('.n').textContent = n;
      if (liked) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
    });
    if (el.dataset.kind !== 'c') {
      const list = el.dataset.kind === 'p' ? Social.gallery : Songs.list;
      const key = el.dataset.kind === 'p' ? 'id' : 'sid';
      list?.forEach((x) => { if (x[key] === el.dataset.id) x.likes = n; });
      if (el.dataset.kind === 's') window.Today?.synced?.(el.dataset.id, n);
    }
  } catch (e) { toast(e.message, 4000); }
  el.disabled = false;
}

/* =========================================================
 * Comments: threads with one level of replies, likes, and a per-device ID under each nickname
 * ======================================================= */
const Comments = {
  kind: 'p', id: '', items: [], myUid: '', replyTo: '',
  thread() { return `${this.kind}:${this.id}`; },
  async uid() { // same value the server derives for this device (sha256('ps1:u:' + device))
    if (this.myUid) return this.myUid;
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ps1:u:' + Likes.device()));
    this.myUid = [...new Uint8Array(d)].slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('');
    return this.myUid;
  },
  async load() {
    try { const r = await fetch(`/api/comments?kind=${this.kind}&id=${encodeURIComponent(this.id)}`); return r.ok ? (await r.json()).items || [] : []; } catch { return []; }
  },
  when(at) {
    const m = Math.round((Date.now() - at) / 60000);
    if (m < 1) return 'たった今'; if (m < 60) return `${m}分前`;
    if (m < 1440) return `${Math.floor(m / 60)}時間前`;
    return new Date(at).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
  },
  one(c, isReply) {
    if (c.deleted) return `<div class="cmt ${isReply ? 'reply' : ''} gone" id="c-${esc(c.cid)}"><div class="cmt-av" aria-hidden="true">–</div><div class="cmt-main"><div class="cmt-t muted small">このコメントは削除されました</div></div></div>`;
    const myCh = Api.connected() ? Api.profile?.id : '';
    const mine = c.chId ? c.chId === myCh : (c.uid && c.uid === this.myUid);
    const prof = c.chId ? `/u/${esc(c.chId)}` : '';
    const av = c.chId && c.icon
      ? `<a class="cmt-av img" href="${prof}" data-act="go" data-to="${prof}" aria-label="${esc(c.name)} のプロフィール"><img src="${esc(c.icon)}" alt="" loading="lazy"></a>`
      : `<div class="cmt-av" aria-hidden="true" style="--h:${parseInt((c.uid || c.chId || '0').replace(/[^0-9a-f]/gi, '').slice(0, 3) || '0', 16) % 360}">${esc((c.name || '?').slice(0, 1))}</div>`;
    return `<div class="cmt ${isReply ? 'reply' : ''}" id="c-${esc(c.cid)}">
      ${av}
      <div class="cmt-main">
        <div class="cmt-h">${c.chId ? `<a class="cmt-name" href="${prof}" data-act="go" data-to="${prof}">${esc(c.name)}</a>` : `<b>${esc(c.name)}</b>`}${mine ? '<span class="you">あなた</span>' : ''}<span class="when">${this.when(c.at)}</span></div>
        <div class="cmt-id">${c.chId ? '<span class="verified">YouTube アカウント</span>' : `ID: ${esc(c.uid || '--------')}`}</div>
        <div class="cmt-t">${esc(c.text)}</div>
        <div class="cmt-acts">${Likes.btn('c', c.cid, c.likes, 'xs', this.thread())}
          <button class="cmt-reply" data-act="cmt-reply" data-cid="${esc(c.parent || c.cid)}" data-name="${esc(c.name)}">${ICON.reply}返信</button>
          ${mine ? `<button class="cmt-reply del" data-act="cmt-del" data-cid="${esc(c.cid)}">削除</button>` : `<button class="cmt-reply rep" data-act="report" data-kind="c" data-cid="${esc(c.cid)}" title="運営に通報">通報</button>`}</div>
        <div class="cmt-replybox" data-for="${esc(c.cid)}"></div>
      </div></div>`;
  },
  html() {
    const items = this.items;
    if (!items.length) return '<div class="small muted" style="padding:10px 0">まだコメントはありません。最初のひとことをどうぞ。</div>';
    const roots = items.filter((c) => !c.parent).sort((a, b) => b.at - a.at);
    const kids = (cid) => items.filter((c) => c.parent === cid).sort((a, b) => a.at - b.at);
    return roots.map((r) => {
      const rs = kids(r.cid);
      return `<div class="thread">${this.one(r)}${rs.length ? `<div class="replies">${rs.map((c) => this.one(c, true)).join('')}</div>` : ''}</div>`;
    }).join('');
  },
  form(parent, at) {
    return `<div class="cmt-form ${parent ? 'is-reply' : ''}">
      ${parent ? `<div class="tiny muted">${esc(at)} さんへの返信</div>` : ''}
      ${Api.connected()
        ? `<div class="cmt-as">${Api.profile?.icon ? `<img src="${esc(Api.profile.icon)}" alt="">` : '<i class="noicon"></i>'}<span><b>${esc(Api.profile?.name || '')}</b> として投稿</span></div>`
        : `<input class="input" data-cf="name" maxlength="20" placeholder="ニックネーム" value="${esc(store.get('nick', ''))}">`}
      <textarea class="textarea" data-cf="text" maxlength="300" placeholder="${parent ? '返信を書く' : '感想をひとこと'}（300文字まで）"></textarea>
      <div class="row"><span class="tiny muted spacer">${Api.connected() ? 'あなたの YouTube の名前とアイコンで表示され、プロフィールにリンクします。' : 'ニックネームの下に、この端末ごとのIDが表示されます。ログインすると自分のアカウントで投稿できます。'}</span>
        ${parent ? '<button class="btn sm quiet" data-act="cmt-cancel">やめる</button>' : ''}
        <button class="btn sm accent" data-act="cmt-post" data-parent="${esc(parent || '')}">${parent ? '返信する' : '投稿'}</button></div>
    </div>`;
  },
  async mount(kind, id, enabled) {
    this.kind = kind; this.id = id; this.replyTo = '';
    const box = document.getElementById('comments'); if (!box) return;
    box.innerHTML = `${enabled ? this.form() : '<div class="small muted">コメントは、みんなのページに掲載中のものだけに書けます。</div>'}<div id="cmt-list"><div class="loading" style="padding:16px 0"><span class="spinner"></span></div></div>`;
    await this.uid();
    this.items = await this.load();
    this.draw();
  },
  draw() {
    const l = document.getElementById('cmt-list'); if (l) l.innerHTML = this.html();
    const n = this.items.filter((x) => !x.deleted).length;
    const c = document.getElementById('cmt-count'); if (c) c.textContent = n ? `（${n}）` : '';
  },
  async del(btn) {
    if (!confirm('このコメントを削除しますか？')) return;
    btn.disabled = true;
    try {
      const c = this.items.find((x) => x.cid === btn.dataset.cid);
      const auth = c?.chId ? await Social.headers() : null;
      const r = await fetch(`/api/comments?kind=${this.kind}&id=${encodeURIComponent(this.id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...(auth || {}) }, body: JSON.stringify({ cid: btn.dataset.cid, device: Likes.device() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || '削除できませんでした');
      this.items = j.items || []; this.draw(); toast('コメントを削除しました');
    } catch (e) { toast(e.message, 4000); btn.disabled = false; }
  },
  openReply(btn) {
    document.querySelectorAll('.cmt-replybox').forEach((b) => { b.innerHTML = ''; });
    const box = btn.closest('.cmt-main').querySelector('.cmt-replybox');
    box.innerHTML = this.form(btn.dataset.cid, btn.dataset.name);
    box.querySelector('[data-cf=text]').focus();
  },
  async post(btn) {
    const form = btn.closest('.cmt-form');
    const name = form.querySelector('[data-cf=name]')?.value.trim() || '', text = form.querySelector('[data-cf=text]').value.trim();
    if (!text) return toast('コメントを入力してください');
    if (name) store.set('nick', name);
    btn.disabled = true;
    try {
      const auth = Api.connected() ? await Social.headers() : null; // logged in -> post as your channel
      const r = await fetch(`/api/comments?kind=${this.kind}&id=${encodeURIComponent(this.id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth || {}) },
        body: JSON.stringify({ name, text, parent: btn.dataset.parent || undefined, device: Likes.device() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || '投稿できませんでした');
      this.items = j.items || [];
      if (!btn.dataset.parent) form.querySelector('[data-cf=text]').value = '';
      this.draw();
      toast(btn.dataset.parent ? '返信しました' : 'コメントを投稿しました');
    } catch (e) { toast(e.message, 4000); btn.disabled = false; }
  },
};

/* =========================================================
 * Recommended songs
 * ======================================================= */
/** everyone who recommends a song: the poster first, then those who said "me too" */
const recPeople = (s) => [{ id: s.byId, name: s.by }, ...(s.also || []).map((x) => ({ id: x.id, name: x.name, desc: x.desc }))].filter((x) => x.name);
const recIs = (s, id) => !!id && (s.byId === id || (s.also || []).some((x) => x.id === id));
/** "Aさん、Bさんのおすすめ" / "Aさん、Bさんほか3人のおすすめ" with overlapping icons */
function recLine(s, { link = true, max = 2 } = {}) {
  const ps = recPeople(s), shown = ps.slice(0, max), more = ps.length - shown.length;
  const icons = `<span class="avs">${ps.slice(0, 3).map((x) => Avatars.html(x.id, x.name)).join('')}</span>`;
  const names = shown.map((x) => (link && x.id ? `<a href="/u/${esc(x.id)}" data-act="go" data-to="/u/${esc(x.id)}">${esc(x.name)}</a>` : esc(x.name)) + 'さん').join('、');
  return `<span class="recline">${icons}<span class="recn">${names}${more > 0 ? `ほか${more}人` : ''}のおすすめ</span></span>`;
}
const Songs = {
  list: null,
  async load(force) {
    if (this.list && !force) return this.list;
    try { const r = await fetch('/api/songs'); this.list = r.ok ? (await r.json()).items || [] : []; } catch { this.list = []; }
    return this.list;
  },
  sort(items, { genre, sort, q } = {}) {
    const k = (q || '').normalize('NFKC').toLowerCase().trim();
    let out = items.filter((s) => (!genre || genresOf(s).includes(genre)) && (!k || `${s.title} ${s.artist} ${recPeople(s).map((x) => x.name).join(' ')}`.normalize('NFKC').toLowerCase().includes(k)));
    out.sort(sort === 'new' ? (a, b) => b.at - a.at : (a, b) => (b.likes || 0) - (a.likes || 0) || b.at - a.at);
    return out;
  },
  card(s, { mine } = {}) {
    return `<div class="song">
      <button class="sthumb ${s.art ? 'sq' : ''}" data-act="go" data-to="/s/${esc(s.sid)}" aria-label="${esc(s.title)} のページを開く">
        <img src="${esc(s.art || s.thumb)}" alt="" loading="lazy"><span class="splay">${ICON.play}</span></button>
      <div class="sbody">
        <a class="stitle" href="/s/${esc(s.sid)}" data-act="go" data-to="/s/${esc(s.sid)}">${esc(s.title)}</a>
        <div class="sartist">${esc(s.artist)}</div>
        ${s.desc ? `<div class="sdesc">${esc(s.desc)}</div>` : ''}
        <div class="smeta">${genreTags(s)}${recLine(s)}</div>
      </div>
      <div class="sside">${Likes.btn('s', s.sid, s.likes)}${s.comments ? `<span class="ccount" title="コメント ${s.comments}件">${ICON.comment}${s.comments}</span>` : ''}
        <a class="btn sm quiet" href="https://music.youtube.com/watch?v=${esc(s.videoId)}" target="_blank" rel="noopener" title="YouTube Music で開く">YT Music ↗</a>
        ${mine ? `<button class="btn sm quiet" data-act="song-del" data-sid="${esc(s.sid)}">削除</button>` : ''}</div>
    </div>`;
  },
  /** square tile for the home browse grid (2 columns) */
  tile(s) {
    return `<div class="stile"><button class="pl" data-act="go" data-to="/s/${esc(s.sid)}">
      <div class="cover"><img src="${esc(s.art || s.thumb)}" alt="" loading="lazy">${genresOf(s).length ? `<span class="gtag oncover">${esc(genresOf(s).map(genreName).join('・'))}</span>` : ''}<i class="tplay" aria-hidden="true">${ICON.play}</i></div>
      <div class="name">${esc(s.title)}</div></button>
      <div class="sart">${esc(s.artist)}</div>
      <div class="meta">${recLine(s)}</div>
      <div class="cardfoot">${Likes.btn('s', s.sid, s.likes, 'sm')}${s.comments ? `<span class="ccount" title="コメント ${s.comments}件">${ICON.comment}${s.comments}</span>` : ''}</div></div>`;
  },
  grid(items, empty, opts) { return items.length ? `<div class="songs">${items.map((s) => this.card(s, opts)).join('')}</div>` : `<div class="sheet flat center muted small">${empty}</div>`; },
  play(sid) {
    const s = (this.list || []).find((x) => x.sid === sid) || (this.picked?.videoId === sid ? this.picked : null); if (!s) return;
    if (Player.playing) Player.yt?.pauseVideo?.(); // don't play two things at once
    const m = document.getElementById('modal');
    m.innerHTML = `<div class="modal-card wide" role="dialog" aria-label="${esc(s.title)}">
      <div class="row" style="margin-bottom:10px"><div class="spacer" style="min-width:0"><b class="display" style="font-size:18px">${esc(s.title)}</b><div class="small muted">${esc(s.artist)}</div></div>
        <button class="btn quiet sm" data-act="modal-close" aria-label="閉じる">${ICON.close}</button></div>
      ${s.embed === false ? '<div class="note warn small">この曲は権利者の設定でこのサイト内では再生できません。YouTube Music で聴いてください。</div>'
        : `<div class="yt-embed"><iframe src="https://www.youtube-nocookie.com/embed/${esc(s.videoId)}?autoplay=1&playsinline=1&rel=0" title="${esc(s.title)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`}
      ${s.desc ? `<div class="sdesc" style="margin-top:10px">${esc(s.desc)}</div>` : ''}
      <div class="row wrap-ok" style="margin-top:12px">${s.sid ? Likes.btn('s', s.sid, s.likes) : ''}<a class="btn sm accent" href="https://music.youtube.com/watch?v=${esc(s.videoId)}" target="_blank" rel="noopener">YouTube Music で開く ↗</a></div>
    </div>`;
    m.hidden = false; document.body.classList.add('modal-open');
  },

  /* ---- posting (My page): search the music catalog like YouTube Music, then match an official upload ---- */
  picked: null,
  formHtml() {
    const p = this.picked;
    return `<div class="sheet stack">
      <b>おすすめの曲を投稿</b>
      <div class="field"><input class="input" id="song-q" placeholder="曲名・アーティスト名で検索（曲のURLも可）" value="${esc(this.q || '')}"><button class="btn solid" data-act="song-search">検索</button></div>
      <div id="song-results">${this.resultsHtml()}</div>
      ${p ? `<div class="picked"><img class="${p.art ? 'sq' : ''}" src="${esc(p.art || p.thumb)}" alt=""><div style="min-width:0"><div class="tiny muted">選んだ曲</div><b>${esc(p.name)}</b><div class="small muted">${esc(p.artist)}${p.album ? ' ・ ' + esc(p.album) : ''}</div>
          <div class="tiny ${p.kind === 'audio' ? 'ok' : 'muted'}" style="margin-top:4px">${!p.videoId ? '' : p.kind === 'audio' ? '✓ CD音源（YouTube Music と同じ音源）で再生できます' : `△ CD音源が見つからなかったため、公式MVで再生されます（${esc(p.channel)}）`}</div></div></div>
        <label class="small muted">曲名</label><input class="input" id="song-title" maxlength="120" value="${esc(p.name)}">
        <label class="small muted">アーティスト</label><input class="input" id="song-artist" maxlength="80" value="${esc(p.artist)}">
        <label class="small muted">ジャンル（必須・3つまで）</label>${genrePicker('song-genres', p.genres || [])}
        ${window.Discover ? Discover.postFields(p) : ''}
        <label class="small muted">ひとこと</label><textarea class="textarea" id="song-desc" maxlength="300" placeholder="この曲のおすすめポイント（300文字まで）"></textarea>
        <div class="row"><span class="spacer"></span><button class="btn quiet sm" data-act="song-unpick">選び直す</button><button class="btn accent" data-act="song-post">掲載する</button></div>` : ''}
    </div>`;
  },
  resultsHtml() {
    if (this.matching) return '<div class="loading" style="padding:16px 0"><span class="spinner"></span> 公式の音源・MVを探しています…</div>';
    if (this.msg) return `<div class="note warn small">${esc(this.msg)}</div>`;
    if (!this.results || this.picked) return '';
    if (!this.results.length) return '<div class="small muted">見つかりませんでした。別のことばで検索するか、YouTube Music で曲の「共有 → リンクをコピー」をして貼り付けてください。</div>';
    return `<div class="sres">${this.results.map((x, i) => `<button class="sres-item song" data-act="song-pick" data-i="${i}">
      <img class="${x.art ? 'sq' : ''}" src="${esc(x.art || x.thumb)}" alt="" loading="lazy">
      <span><b>${esc(x.name)}</b><span class="tiny muted">${esc(x.artist)}${x.album ? ' ・ ' + esc(x.album) : ''}${x.d ? ' ・ ' + fmtDur(x.d) : ''}</span></span>
      <span class="tag tiny">${x.videoId ? '動画' : '曲'}</span></button>`).join('')}</div>`;
  },
  async search(btn) {
    const q = $('#song-q').value.trim(); this.q = q; if (!q) return;
    this.picked = null; this.msg = ''; this.results = null;
    const box = $('#song-results'); box.innerHTML = '<div class="loading" style="padding:16px 0"><span class="spinner"></span> 検索中…</div>';
    btn.disabled = true;
    try {
      if (/youtu\.?be|music\.youtube/.test(q)) { // a pasted YouTube / YT Music link
        const r = await fetch('/api/song-search?' + new URLSearchParams({ url: q }));
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || '読み込めませんでした');
        this.results = (j.items || []).map((x) => { const g = guessSong(x.title, x.channel); return { ...x, name: g.name, artist: g.artist }; });
      } else {
        const res = await Catalog.search(q, 25);
        this.results = res.map((x) => ({ name: x.trackName, artist: x.artistName, album: x.collectionName, art: Catalog.art(x.artworkUrl100, 600), d: Math.round((x.trackTimeMillis || 0) / 1000) }));
      }
      box.innerHTML = this.resultsHtml();
    } catch (e) { box.innerHTML = `<div class="note warn small">${esc(e.message)}</div>`; }
    btn.disabled = false;
  },
  async pick(i) {
    const x = this.results?.[i]; if (!x) return;
    if (x.videoId) { this.picked = { ...x }; this.msg = ''; return drawMeTab(); }
    this.matching = true; $('#song-results').innerHTML = this.resultsHtml();
    try {
      const r = await fetch('/api/song-match?' + new URLSearchParams({ r: '3', t: x.name, a: x.artist, d: String(x.d || 0) }));
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || '曲を探せませんでした');
      if (!j.videoId) { this.msg = `「${x.name}」の公式の音源・MVが YouTube に見つかりませんでした。YouTube Music で曲の「共有 → リンクをコピー」をして、ここに貼り付けて選んでください。`; this.picked = null; }
      else { this.msg = ''; this.picked = { ...x, videoId: j.videoId, thumb: j.thumb, channel: j.channel, embed: j.embed, kind: j.kind, d: x.d || j.d }; }
    } catch (e) { this.msg = e.message; }
    this.matching = false; drawMeTab();
  },
  async post(btn) {
    const p = this.picked; if (!p) return;
    if (!pickedGenres('song-genres').length) { $('#song-genres').classList.add('need'); return toast('ジャンルを1つ以上選んでください'); }
    if (window.Discover && !p.moment) { document.getElementById('dsc-p-moment')?.classList.add('need'); document.getElementById('dsc-p-moment')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return toast('「どこから流すか」を選んでください'); }
    btn.disabled = true;
    try {
      const h = await Social.headers(); if (!h) throw new AuthError('ログインしてください');
      const r = await fetch('/api/songs', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({
        videoId: p.videoId, art: p.art || '', title: $('#song-title').value.trim(), artist: $('#song-artist').value.trim(), genres: pickedGenres('song-genres'), desc: $('#song-desc').value.trim(),
        ...(window.Discover?.postBody(p) || {}),
      }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || '掲載できませんでした');
      this.picked = null; this.results = null; this.q = ''; this.msg = ''; this.list = null;
      if (j.joined) { toast('すでに投稿されていた曲なので、あなたもおすすめした人に加わりました', 4000); return go('/s/' + j.sid); }
      toast('おすすめ曲を掲載しました'); drawMeTab();
    } catch (e) { toast(errText(e), 5000); btn.disabled = false; }
  },
  async del(sid) {
    if (!confirm('この曲の掲載を削除しますか？')) return;
    const h = await Social.headers(); if (!h) return toast('ログインしてください');
    const r = await fetch('/api/songs?sid=' + encodeURIComponent(sid), { method: 'DELETE', headers: h });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return toast(j.error || '削除できませんでした', 4000);
    this.list = null; toast('削除しました');
    if (location.pathname.startsWith('/s/')) { S.meTab = 'shared'; go('/me'); } else route();
  },
};

/* =========================================================
 * Login guide: explain Google's "unverified app" screen first
 * ======================================================= */
const LoginGuide = {
  open(onGo) {
    this.onGo = onGo;
    const m = document.getElementById('modal');
    m.innerHTML = `<div class="modal-card wide" role="dialog" aria-label="ログインの前に">
      <div class="row" style="margin-bottom:6px"><b class="spacer display" style="font-size:20px">ログインの前に</b><button class="btn quiet sm" data-act="modal-close" aria-label="閉じる">${ICON.close}</button></div>
      <div class="small">このあと Google のログイン画面で、次のような<b>「このアプリは Google で確認されていません」</b>という警告が出ます。</div>
      <img class="guide-shot" src="/img/google-warning-1.png" alt="Google の警告画面。左下に「詳細」、右下に「安全なページに戻る」ボタンがある">
      <div class="small muted">Share MUSIC は個人で運営している小さなアプリで、Google の審査を受けていないため、この画面が表示されます。<b>表示されるのは仕方がないもので、故障や危険なサイトという意味ではありません。</b></div>
      <ol class="steps" style="margin-top:12px">
        <li>左下の<b>「詳細」</b>を押す（「安全なページに戻る」は押さないでください）</li>
        <li>下に出てくる<b>「Share MUSIC（安全ではないページ）に移動」</b>を押す</li>
        <li>Google アカウント（Gmail）を選んで、YouTube へのアクセスを<b>「許可」</b>する</li>
      </ol>
      <div class="note small" style="margin-top:12px">このアプリがあなたの YouTube でできるのは、プレイリストの読み込み・タイトルや紹介文の変更・コピーの作成だけです。いつでも <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">Google の設定</a>から許可を取り消せます。</div>
      <label class="row small" style="margin-top:12px;gap:8px"><input type="checkbox" id="guide-skip"> 次回からこの説明を表示しない</label>
      <div style="margin-top:14px"><button class="btn lg accent" data-act="guide-go">わかりました、ログインへ進む</button></div>
      <div class="center" style="margin-top:6px"><button class="btn quiet sm" data-act="modal-close">やめる</button></div>
    </div>`;
    m.hidden = false; document.body.classList.add('modal-open');
  },
  go() {
    if ($('#guide-skip')?.checked) store.set('guide-skip', true);
    ShareImage.close();
    const f = this.onGo; this.onGo = null; f?.();
  },
};

/* =========================================================
 * Admin page (/admin) — password set in Netlify (ADMIN_PASSWORD)
 * ======================================================= */
const Admin = {
  get token() { try { const t = sessionStorage.getItem('ps.admin'); return t && +t.split('.')[0] > Date.now() ? t : null; } catch { return null; } },
  set token(v) { try { if (v) sessionStorage.setItem('ps.admin', v); else sessionStorage.removeItem('ps.admin'); } catch { /* ignore */ } },
  async render() {
    document.title = '運営ページ — Share MUSIC';
    if (!this.token) {
      return setApp(`<div class="label">運営専用ページ</div>
        <div class="sheet stack" style="max-width:420px">
          <div class="small muted">運営用のパスワードを入力してください。</div>
          <input class="input" type="password" id="adm-pw" autocomplete="current-password" placeholder="パスワード">
          <button class="btn solid" data-act="adm-login">ログイン</button>
        </div>`);
    }
    if (!this.data || this.stale) {
      setApp('<div class="loading"><span class="spinner"></span> 読み込み中…</div>');
      const r = await fetch('/api/admin/data', { headers: { Authorization: 'Admin ' + this.token } });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { this.token = null; return this.render(); }
      if (!r.ok) return setApp(`<div class="note bad">${esc(j.error || '読み込めませんでした')}</div>`);
      this.data = j; this.stale = false;
    }
    this.draw();
  },
  /* the screen: overview, tabs, search, list */
  draw() {
    const j = this.data, tab = this.tab || ((j.reports || []).length ? 'rep' : 'post');
    const pls = j.playlists || [], songs = j.songs || [], posts = j.posts || [], users = j.users || [], reports = j.reports || [];
    const threads = [...pls.map((p) => ({ key: p.id, title: `プレイリスト「${p.title}」`, link: `/p/${p.id}` })), ...songs.map((x) => ({ key: 's:' + x.sid, title: `おすすめ曲「${x.title}」`, link: `/s/${x.sid}` }))];
    const allComments = threads.flatMap((t) => (j.comments?.[t.key] || []).map((c) => ({ ...c, key: t.key, where: t.title, link: t.link })));
    const groups = this.groupReports(reports, { pls, songs, posts, allComments });
    const dt = (t) => (t ? new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
    const btns = (target, id, hidden, extra = '') => `<button class="btn sm" data-act="adm" data-target="${target}" data-id="${esc(id)}" ${extra} data-op="${hidden ? 'show' : 'hide'}">${hidden ? '公開に戻す' : '非公開'}</button>
      <button class="btn sm quiet danger" data-act="adm" data-target="${target}" data-id="${esc(id)}" ${extra} data-op="delete">削除</button>`;
    const row = ({ thumb, title, sub, badges = '', text = '', link, actions, hidden }) => `<div class="admrow ${hidden ? 'hid' : ''}">
      ${thumb !== undefined ? `<div class="adm-th">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : ''}</div>` : ''}
      <div class="adm-main"><div class="adm-title">${badges}<b>${esc(title)}</b></div><div class="tiny muted">${sub}</div>${text ? `<div class="adm-text">${esc(text)}</div>` : ''}</div>
      <div class="adm-acts">${link ? `<a class="btn sm quiet" href="${link}" target="_blank" rel="noopener">見る</a>` : ''}${actions}</div></div>`;
    const who = (id, name) => (id ? `<a href="/u/${esc(id)}" target="_blank" rel="noopener">${esc(name || id)}</a>` : esc(name || ''));
    const hid = '<span class="badge warn">非公開中</span>';
    let body = '';
    if (tab === 'rep') {
      const REASON = { spam: 'スパム・宣伝', abuse: '悪口・嫌がらせ', inappropriate: '不適切な内容', rights: '権利の侵害', other: 'その他' };
      const KIND = { p: 'プレイリスト', s: 'おすすめ曲', c: 'コメント', m: 'つぶやき' };
      body = groups.length ? groups.map((g) => {
        const reasons = Object.entries(g.reasons).map(([k, n]) => `<span class="badge">${esc(REASON[k] || k)}${n > 1 ? ' ×' + n : ''}</span>`).join('');
        const notes = g.notes.slice(0, 3).map((t) => `<div class="adm-note">「${esc(t)}」</div>`).join('');
        const tgt = g.target;
        return `<div class="admrow rep ${g.count >= 3 ? 'hot' : ''}">
          ${tgt.thumb !== undefined ? `<div class="adm-th">${tgt.thumb ? `<img src="${esc(tgt.thumb)}" alt="" loading="lazy">` : ''}</div>` : ''}
          <div class="adm-main"><div class="adm-title"><span class="badge kind">${KIND[g.kind]}</span><span class="badge hot">通報 ${g.count}件</span>${tgt.hidden ? hid : ''}${tgt.gone ? '<span class="badge">削除済み</span>' : ''}</div>
            <b>${esc(tgt.title)}</b>${tgt.text ? `<div class="adm-text">${esc(tgt.text)}</div>` : ''}<div class="tiny muted">${tgt.sub || ''} ・ 最新の通報 ${dt(g.last)}</div>
            <div class="adm-badges">${reasons}</div>${notes}</div>
          <div class="adm-acts">${tgt.link ? `<a class="btn sm quiet" href="${tgt.link}" target="_blank" rel="noopener">見る</a>` : ''}
            ${tgt.gone ? '' : `<button class="btn sm" data-act="adm" data-target="${tgt.target}" data-id="${esc(tgt.id)}" data-cid="${esc(g.cid || '')}" data-op="hide">非公開</button>
            <button class="btn sm quiet danger" data-act="adm" data-target="${tgt.target}" data-id="${esc(tgt.id)}" data-cid="${esc(g.cid || '')}" data-op="delete">削除</button>`}
            ${tgt.byId ? `<button class="btn sm quiet" data-act="adm-user" data-id="${esc(tgt.byId)}">投稿者を見る</button>` : ''}
            <button class="btn sm quiet" data-act="adm" data-target="report" data-op="resolve" data-kind="${g.kind}" data-id="${esc(g.id)}" data-cid="${esc(g.cid || '')}">問題なし（対応済み）</button></div></div>`;
      }).join('') : '<div class="adm-empty">未対応の通報はありません</div>';
    } else if (tab === 'post') {
      body = posts.length ? posts.map((x) => row({ thumb: x.img ? `/api/pimg?k=${x.img}` : x.thumb, title: x.text || (x.songTitles.length ? '♪ ' + x.songTitles.join(' ／ ') : '（写真のみ）'), hidden: x.hidden,
        badges: `${x.parent ? '<span class="badge">返信</span>' : ''}${x.battle ? '<span class="badge">曲バトル</span>' : x.songs > 1 ? `<span class="badge">ミックステープ ${x.songs}曲</span>` : ''}${x.hidden ? hid : ''}`,
        sub: `${who(x.byId, x.by)} ・ ${dt(x.at)} ・ 返信 ${x.rc}`, link: `/c/${x.parent || x.pid}`, actions: btns('post', x.pid, x.hidden) })).join('') : '<div class="adm-empty">つぶやきはまだありません</div>';
    } else if (tab === 'pl') {
      body = pls.length ? pls.map((p) => row({ thumb: p.image, title: p.title, hidden: p.hidden, badges: p.hidden ? hid : '',
        sub: `${who(p.ownerId, p.owner)} ・ ${esc(genresOf(p).map(genreName).join('・'))} ・ ♥ ${p.likes} ・ ${dt(p.updated || p.at)}`, link: `/p/${p.id}`, actions: btns('playlist', p.id, p.hidden) })).join('') : '<div class="adm-empty">なし</div>';
    } else if (tab === 'song') {
      body = songs.length ? songs.map((x) => row({ thumb: x.art || x.thumb, title: `${x.title} / ${x.artist}`, hidden: x.hidden, badges: x.hidden ? hid : '', text: x.desc,
        sub: `${who(x.byId, x.by)}${(x.also || []).length ? ` ほか${x.also.length}人` : ''} ・ ♥ ${x.likes} ・ ${dt(x.at)}`, link: `/s/${x.sid}`, actions: btns('song', x.sid, x.hidden) })).join('') : '<div class="adm-empty">なし</div>';
    } else if (tab === 'cmt') {
      const list = allComments.slice().sort((a, b) => b.at - a.at);
      body = list.length ? list.map((c) => row({ title: c.name, hidden: c.hidden, badges: `${c.parent ? '<span class="badge">返信</span>' : ''}${c.hidden ? hid : ''}`, text: c.text,
        sub: `${esc(c.where)} ・ ${c.chId ? who(c.chId, 'チャンネル') : 'ID: ' + esc(c.uid || '-')} ・ ${dt(c.at)}`, link: c.link, actions: btns('comment', c.key, c.hidden, `data-cid="${esc(c.cid)}"`) })).join('') : '<div class="adm-empty">コメントはまだありません</div>';
    } else if (tab === 'user') {
      body = users.length ? users.map((x) => `<div class="admrow ${x.banned ? 'hid' : ''}" id="adm-u-${esc(x.id)}">
        <div class="adm-th round">${Avatars.html(x.id, x.name)}</div>
        <div class="adm-main"><div class="adm-title">${x.banned ? '<span class="badge bad">利用停止中</span>' : ''}<b>${esc(x.name || '(名前なし)')}</b></div>
          <div class="tiny muted">プレイリスト ${x.playlists} ・ おすすめ曲 ${x.songs} ・ つぶやき ${x.posts} ・ コメント ${x.comments} ・ 最終 ${dt(x.last)}</div></div>
        <div class="adm-acts"><a class="btn sm quiet" href="/u/${esc(x.id)}" target="_blank" rel="noopener">プロフィール</a>
          <button class="btn sm" data-act="adm" data-target="user" data-id="${esc(x.id)}" data-name="${esc(x.name)}" data-op="hideall">投稿をすべて非公開</button>
          ${x.banned ? `<button class="btn sm" data-act="adm" data-target="user" data-id="${esc(x.id)}" data-name="${esc(x.name)}" data-op="unban">利用停止を解除</button>`
            : `<button class="btn sm quiet danger" data-act="adm" data-target="user" data-id="${esc(x.id)}" data-name="${esc(x.name)}" data-op="ban">利用停止</button>`}</div></div>`).join('') : '<div class="adm-empty">まだ利用者はいません</div>';
    } else if (tab === 'tpc') {
      body = '<div id="adm-topic"></div>'; // 今週のお題 (topics.js)
    } else if (tab === 'log') {
      const OP = { hide: '非公開', show: '公開に戻す', delete: '削除', ban: '利用停止', unban: '利用停止を解除', hideall: 'すべて非公開', resolve: '通報を対応済み' };
      const TG = { playlist: 'プレイリスト', song: 'おすすめ曲', comment: 'コメント', post: 'つぶやき', report: '通報', user: 'ユーザー' };
      body = (j.log || []).length ? (j.log || []).map((l) => `<div class="admrow log"><div class="adm-main"><div class="adm-title"><span class="badge">${TG[l.target] || l.target}</span><b>${OP[l.op] || l.op}</b></div><div class="tiny muted">${dt(l.at)}${l.what ? ' ・ ' + esc(l.what) : ''}</div></div></div>`).join('') : '<div class="adm-empty">まだ操作はありません</div>';
    }
    const hidCount = pls.filter((x) => x.hidden).length + songs.filter((x) => x.hidden).length + posts.filter((x) => x.hidden).length;
    const card = (k, n, l, cls = '') => `<button class="adm-card ${cls} ${tab === k ? 'on' : ''}" data-act="adm-tab" data-tab="${k}"><b>${n}</b><span>${l}</span></button>`;
    setApp(`<div class="row" style="margin-top:18px"><div class="spacer"><div class="eyebrow">Admin</div><h1 class="pagetitle" style="margin:2px 0 0">運営ページ</h1></div>
        <button class="btn sm quiet" data-act="adm-reload" title="最新の状態にする">更新</button><button class="btn sm quiet" data-act="adm-logout">ログアウト</button></div>
      <div class="adm-cards">
        ${card('rep', groups.length, '未対応の通報', groups.length ? 'alert' : '')}
        ${card('post', posts.length, 'つぶやき')}${card('pl', pls.length, 'プレイリスト')}${card('song', songs.length, 'おすすめ曲')}
        ${card('cmt', allComments.length, 'コメント')}${card('user', users.length, 'ユーザー')}
      </div>
      <div class="adm-sub tiny muted">非公開中 ${hidCount}件 ・ 利用停止中 ${users.filter((x) => x.banned).length}人 ・ <button class="linkbtn" data-act="adm-tab" data-tab="log">操作履歴を見る</button></div>
      <div class="adm-bar">
        <div class="adm-tabs">${[['rep', '通報'], ['post', 'つぶやき'], ['pl', 'プレイリスト'], ['song', 'おすすめ曲'], ['cmt', 'コメント'], ['user', 'ユーザー'], ['tpc', 'お題'], ['log', '操作履歴']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="adm-tab" data-tab="${k}">${l}${k === 'rep' && groups.length ? `<i>${groups.length}</i>` : ''}</button>`).join('')}</div>
        <input class="input" id="adm-q" type="search" placeholder="この一覧をしぼり込む（名前・文章・タイトル）" value="${esc(this.q || '')}">
      </div>
      <div class="hint">「非公開」はみんなに見えなくなるだけで、あとで戻せます。「削除」は元に戻せません。非公開・削除すると、その対象への通報は自動で対応済みになります。</div>
      <div id="adm-list">${body}</div>`);
    const q = $('#adm-q');
    const filter = () => { const k = (this.q = q.value).normalize('NFKC').toLowerCase().trim(); document.querySelectorAll('#adm-list .admrow').forEach((r) => { r.hidden = !!k && !r.textContent.normalize('NFKC').toLowerCase().includes(k); }); };
    q.addEventListener('input', filter); filter();
    if (tab === 'tpc') window.Topics?.adminDraw?.($('#adm-topic'), this.token);
  },
  /** reports about the same thing are shown together, most-reported first */
  groupReports(reports, { pls, songs, posts, allComments }) {
    const map = new Map();
    for (const r of reports) {
      const key = `${r.kind}|${r.id}|${r.cid || ''}`;
      const g = map.get(key) || { kind: r.kind, id: r.id, cid: r.cid || '', thread: r.thread || '', count: 0, reasons: {}, notes: [], last: 0 };
      g.count++; g.reasons[r.reason] = (g.reasons[r.reason] || 0) + 1; if (r.text) g.notes.push(r.text); g.last = Math.max(g.last, r.at);
      map.set(key, g);
    }
    const groups = [...map.values()];
    for (const g of groups) {
      if (g.kind === 'p') { const p = pls.find((x) => x.id === g.id); g.target = p ? { target: 'playlist', id: p.id, title: p.title, sub: `作成：${esc(p.owner)}`, byId: p.ownerId, thumb: p.image, link: `/p/${p.id}`, hidden: p.hidden } : { title: '（削除済みのプレイリスト）', gone: true }; }
      else if (g.kind === 's') { const x = songs.find((y) => y.sid === g.id); g.target = x ? { target: 'song', id: x.sid, title: `${x.title} / ${x.artist}`, text: x.desc, sub: `投稿：${esc(x.by)}`, byId: x.byId, thumb: x.art || x.thumb, link: `/s/${x.sid}`, hidden: x.hidden } : { title: '（削除済みのおすすめ曲）', gone: true }; }
      else if (g.kind === 'm') { const x = posts.find((y) => y.pid === g.id); g.target = x ? { target: 'post', id: x.pid, title: x.text || (x.songTitles.join(' ／ ') || '（写真のみ）'), sub: `投稿：${esc(x.by)}`, byId: x.byId, thumb: x.img ? `/api/pimg?k=${x.img}` : x.thumb, link: `/c/${x.parent || x.pid}`, hidden: x.hidden } : { title: '（削除済みのつぶやき）', gone: true }; }
      else { const key = g.thread.startsWith('s:') ? g.thread : g.thread.slice(2); const c = allComments.find((y) => y.key === key && y.cid === g.cid); g.target = c ? { target: 'comment', id: key, title: `${c.name} のコメント`, text: c.text, sub: esc(c.where), byId: c.chId, link: c.link, hidden: c.hidden } : { title: '（削除済みのコメント）', gone: true }; }
    }
    return groups.sort((a, b) => b.count - a.count || b.last - a.last);
  },
  user(id) { this.tab = 'user'; this.q = ''; this.draw(); const el = document.getElementById('adm-u-' + id); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); } },
  async login(btn) {
    const pw = $('#adm-pw').value; if (!pw) return;
    btn.disabled = true;
    const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    const j = await r.json().catch(() => ({}));
    btn.disabled = false;
    if (!r.ok) return toast(j.error || 'ログインできませんでした', 5000);
    this.token = j.token; this.render();
  },
  async act(el) {
    const { target, id, op, cid, kind, name } = el.dataset;
    const ask = {
      delete: target === 'comment' ? '削除すると元に戻せません（返信がある場合は返信も消えます）。削除しますか？' : '削除すると元に戻せません。削除しますか？',
      ban: `「${name}」さんを利用停止にしますか？\n停止中は、つぶやき・コメント・共有・投稿ができなくなります（見るのはできます）。`,
      hideall: `「${name}」さんのプレイリスト・おすすめ曲・つぶやきを、すべて非公開にしますか？`,
    }[op];
    if (ask && target !== 'report' && !confirm(ask)) return;
    const note = op === 'ban' ? (prompt('停止の理由（運営のメモ・任意）') || '') : '';
    const label = el.closest('.admrow')?.querySelector('.adm-main b')?.textContent || name || '';
    el.disabled = true;
    const r = await fetch('/api/admin/act', { method: 'POST', headers: { Authorization: 'Admin ' + this.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ target, id, op, cid, kind, name: name || label, note }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { el.disabled = false; return toast(j.error || '操作できませんでした', 4000); }
    Social.gallery = null; Songs.list = null;
    toast({ hide: '非公開にしました', show: '公開に戻しました', delete: '削除しました', resolve: '対応済みにしました', ban: '利用停止にしました', unban: '利用停止を解除しました', hideall: 'すべて非公開にしました' }[op] || '完了しました');
    const y = window.scrollY; this.stale = true; await this.render(); window.scrollTo({ top: y });
  },
};
