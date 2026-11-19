/* Share MUSIC — 運営ページ (/admin).
 * Dashboard (numbers, activity, things to handle), reports, every kind of content with search / filters / bulk actions,
 * お題 (theme editor + answers), listening parties, users (detail sheet, ban), notices to everyone, and the action log.
 * Server: /api/admin/login, /api/admin/data, /api/admin/act (netlify/functions/community.mjs). Loaded before app.js. */
'use strict';

const Admin = {
  get token() { try { const t = sessionStorage.getItem('ps.admin'); return t && +t.split('.')[0] > Date.now() ? t : null; } catch { return null; } },
  set token(v) { try { if (v) sessionStorage.setItem('ps.admin', v); else sessionStorage.removeItem('ps.admin'); } catch { /* ignore */ } },
  data: null, stale: false, tab: 'dash', q: '', vis: 'all', sort: 'new', sel: new Set(), week: '',

  /* ---------- loading ---------- */
  async render() {
    document.title = '運営ページ — Share MUSIC';
    if (!this.token) {
      return setApp(`<div class="ad-login">
        <div class="ad-login-ic">${ICON.shield}</div>
        <h1>運営ページ</h1>
        <p class="small muted">運営用のパスワードを入力してください。</p>
        <input class="input" type="password" id="adm-pw" autocomplete="current-password" placeholder="パスワード">
        <button class="btn solid" data-act="adm-login">ログイン</button>
      </div>`);
    }
    if (!this.data || this.stale) {
      if (!this.data) setApp('<div class="loading"><span class="spinner"></span> 読み込み中…</div>');
      const r = await fetch('/api/admin/data', { headers: { Authorization: 'Admin ' + this.token } });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { this.token = null; return this.render(); }
      if (!r.ok) return setApp(`<div class="note bad">${esc(j.error || '読み込めませんでした')}</div>`);
      this.data = j; this.stale = false; this.prep();
    }
    this.draw();
  },
  async login(btn) {
    const pw = $('#adm-pw').value; if (!pw) return;
    btn.disabled = true;
    const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    const j = await r.json().catch(() => ({}));
    btn.disabled = false;
    if (!r.ok) return toast(j.error || 'ログインできませんでした', 5000);
    this.token = j.token; this.render();
  },
  /** derived lists used by several sections */
  prep() {
    const j = this.data;
    const pls = j.playlists || [], songs = j.songs || [];
    const threads = [...pls.map((p) => ({ key: p.id, title: `プレイリスト「${p.title}」`, link: `/p/${p.id}` })), ...songs.map((x) => ({ key: 's:' + x.sid, title: `おすすめ曲「${x.title}」`, link: `/s/${x.sid}` }))];
    j.allComments = threads.flatMap((t) => (j.comments?.[t.key] || []).map((c) => ({ ...c, key: t.key, where: t.title, link: t.link })));
    j.groups = this.groupReports(j.reports || [], { pls, songs, posts: j.posts || [], allComments: j.allComments });
    j.answers = (j.topics || []).flatMap((w) => (w.answers || []).map((a) => ({ ...a, week: w.week, wtitle: w.title, current: w.current })));
    if (!this.week) this.week = j.topics?.[0]?.week || '';
  },

  /* ---------- small helpers ---------- */
  dt: (t) => (t ? new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''),
  who: (id, name) => (id ? `<a href="/u/${esc(id)}" target="_blank" rel="noopener">${esc(name || id)}</a>` : esc(name || '')),
  sceneNames: (ids) => (ids || []).map((id) => window.Discover?.sceneName?.(id) || id).filter(Boolean),
  b: (cls, t) => `<span class="ad-b ${cls}">${t}</span>`,
  num: (icon, n, label) => `<span class="ad-n" title="${label}" aria-label="${label} ${n}">${icon}${n}</span>`,
  I: {
    dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="9" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.6"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.6"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.6"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7.5-4.5-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10C19.5 15.5 12 20 12 20z"/></svg>',
    thumb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 10.5v9H4.8a1.3 1.3 0 0 1-1.3-1.3v-6.4c0-.7.6-1.3 1.3-1.3z"/><path d="M7.5 10.5 11 3.8a2 2 0 0 1 2.9 1.9l-.5 3.6h4.9a2 2 0 0 1 2 2.4l-1.3 6.2a2 2 0 0 1-2 1.6H7.5"/></svg>',
    log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    mega: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 10v4a1 1 0 0 0 1 1h2l6 4V5l-6 4h-2a1 1 0 0 0-1 1z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>',
  },
  sections() {
    const j = this.data;
    const hid = (l) => l.filter((x) => x.hidden).length;
    return [
      ['dash', 'ダッシュボード', this.I.dash, 0],
      ['rep', '通報', ICON.flag, j.groups.length, 'alert'],
      ['song', 'おすすめ曲', ICON.note, (j.songs || []).length],
      ['tpc', 'お題', ICON.topic, (j.topics?.[0]?.answers || []).length],
      ['post', 'つぶやき', ICON.chat, (j.posts || []).length],
      ['cmt', 'コメント', ICON.comment, j.allComments.length],
      ['pl', 'プレイリスト', ICON.link, (j.playlists || []).length],
      ['pty', 'パーティー', ICON.party, (j.parties || []).filter((p) => !p.closed).length],
      ['user', 'ユーザー', ICON.user, (j.users || []).length],
      ['news', 'お知らせ配信', this.I.mega, 0],
      ['log', '操作履歴', this.I.log, 0],
    ].map(([k, l, ic, n, cls]) => ({ k, l, ic, n, cls, hid: { song: hid(j.songs || []), post: hid(j.posts || []), pl: hid(j.playlists || []), cmt: hid(j.allComments) }[k] || 0 }));
  },

  /* ---------- the page frame ---------- */
  draw() {
    const j = this.data, tab = this.tab;
    const secs = this.sections();
    const nav = secs.map((s) => `<button class="ad-nav-i ${tab === s.k ? 'on' : ''}" data-act="adm-tab" data-tab="${s.k}"><span class="ic">${s.ic}</span><span class="l">${s.l}</span>${s.n ? `<i class="${s.cls || ''}">${s.n}</i>` : ''}</button>`).join('');
    const cur = secs.find((s) => s.k === tab) || secs[0];
    setApp(`<div class="ad">
      <header class="ad-top">
        <div><div class="eyebrow">Admin</div><h1>運営ページ</h1><div class="tiny muted">${j.at ? `${this.dt(j.at)} 時点` : ''}</div></div>
        <div class="ad-top-acts"><button class="btn sm" data-act="adm-reload">${ICON.repeat}<span>更新</span></button><button class="btn sm quiet" data-act="adm-logout">ログアウト</button></div>
      </header>
      <div class="ad-shell">
        <nav class="ad-nav" aria-label="運営メニュー">${nav}</nav>
        <main class="ad-main">
          <div class="ad-h"><span class="ic">${cur.ic}</span><h2>${cur.l}</h2></div>
          <div id="ad-body">${this.body(tab)}</div>
        </main>
      </div>
      <div class="ad-bulk" id="ad-bulk" hidden></div>
    </div>`);
    this.after(tab);
    document.querySelector('.ad-nav-i.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  },
  body(tab) {
    switch (tab) {
      case 'dash': return this.dash();
      case 'rep': return this.reports();
      case 'song': return this.list('song');
      case 'post': return this.list('post');
      case 'cmt': return this.list('cmt');
      case 'pl': return this.list('pl');
      case 'tpc': return this.topics();
      case 'pty': return this.parties();
      case 'user': return this.list('user');
      case 'news': return this.news();
      case 'log': return this.logs();
      default: return '';
    }
  },
  after(tab) {
    const q = $('#adm-q');
    if (q) q.addEventListener('input', () => { this.q = q.value; this.redrawList(); });
    if (tab === 'tpc') window.Topics?.adminDraw?.($('#adm-topic'), this.token);
    if (tab === 'news') { const t = $('#ad-news'); const c = $('#ad-news-n'); t?.addEventListener('input', () => { c.textContent = `${t.value.length} / 200`; $('#ad-news-pv').textContent = t.value || '（ここに本文が表示されます）'; }); }
    this.bulkBar();
  },

  /* ---------- dashboard ---------- */
  dash() {
    const j = this.data, now = Date.now(), DAY = 86400e3;
    const songs = j.songs || [], posts = j.posts || [], cm = j.allComments, ans = j.answers;
    const live = (j.parties || []).filter((p) => !p.closed && now - p.updated < 15 * 60e3);
    const week = (l, f = (x) => x.at) => l.filter((x) => now - (f(x) || 0) < 7 * DAY).length;
    const tile = (k, n, l, sub, tabk) => `<button class="ad-tile" data-act="adm-tab" data-tab="${tabk}"><span class="k">${k}</span><b>${n}</b><span class="l">${l}</span>${sub ? `<span class="s">${sub}</span>` : ''}</button>`;
    // things that need the operator
    const todo = [];
    if (j.groups.length) todo.push(['rep', `未対応の通報が <b>${j.groups.length}件</b> あります`, 'alert']);
    const hidden = songs.filter((x) => x.hidden).length + posts.filter((x) => x.hidden).length + (j.playlists || []).filter((x) => x.hidden).length;
    if (hidden) todo.push(['song', `非公開にしている投稿が ${hidden}件 あります`, '']);
    const banned = (j.users || []).filter((x) => x.banned).length;
    if (banned) todo.push(['user', `利用停止中のユーザーが ${banned}人 います`, '']);
    const curW = (j.topics || []).find((w) => w.current);
    if (curW && !curW.custom) todo.push(['tpc', `今週のお題は自動で選ばれています（「${esc(curW.title)}」）`, '']);
    // 14 days of activity (one series: new posts of every kind per day)
    const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(now - (13 - i) * DAY); d.setHours(0, 0, 0, 0); return d.getTime(); });
    const bucket = (t) => { for (let i = days.length - 1; i >= 0; i--) if (t >= days[i]) return i; return -1; };
    const per = days.map(() => ({ s: 0, p: 0, c: 0, a: 0 }));
    for (const x of songs) { const i = bucket(x.at || 0); if (i >= 0) per[i].s++; }
    for (const x of posts) { const i = bucket(x.at || 0); if (i >= 0) per[i].p++; }
    for (const x of cm) { const i = bucket(x.at || 0); if (i >= 0) per[i].c++; }
    for (const x of ans) { const i = bucket(x.ts || 0); if (i >= 0) per[i].a++; }
    const tot = per.map((d) => d.s + d.p + d.c + d.a), max = Math.max(1, ...tot);
    const chart = `<div class="ad-chart" role="img" aria-label="14日間の新しい投稿の数">
      <div class="ad-bars">${per.map((d, i) => { const dd = new Date(days[i]); const lab = `${dd.getMonth() + 1}/${dd.getDate()}`;
        const tip = `${lab}：合計 ${tot[i]}（おすすめ曲 ${d.s}・つぶやき ${d.p}・コメント ${d.c}・お題 ${d.a}）`;
        return `<div class="ad-bar" tabindex="0" title="${tip}" aria-label="${tip}"><span class="v">${tot[i] || ''}</span><i style="height:${tot[i] ? Math.max(4, (tot[i] / max) * 100) : 0}%"></i><span class="d ${i % 2 && i !== 13 ? 'odd' : ''}">${lab}</span></div>`; }).join('')}</div>
      <div class="tiny muted">新しい投稿の数（おすすめ曲・つぶやき・コメント・お題の答えの合計）。棒にふれると内訳が出ます</div></div>`;
    const top = songs.filter((x) => !x.hidden).sort((a, b) => (b.likes + b.hearts * 2 + b.comments) - (a.likes + a.hearts * 2 + a.comments)).slice(0, 5);
    const feed = [
      ...songs.map((x) => ({ at: x.at, t: 'おすすめ曲', s: `${esc(x.by)}「${esc(x.head || x.title)}」`, link: `/s/${x.sid}` })),
      ...posts.map((x) => ({ at: x.at, t: x.parent ? '返信' : 'つぶやき', s: `${esc(x.by)}「${esc((x.text || x.songTitles.join(' ／ ') || '写真').slice(0, 40))}」`, link: `/c/${x.parent || x.pid}` })),
      ...cm.map((x) => ({ at: x.at, t: 'コメント', s: `${esc(x.name)}「${esc((x.text || '').slice(0, 40))}」`, link: x.link })),
      ...ans.map((x) => ({ at: x.ts, t: 'お題', s: `${esc(x.name)}「${esc(x.title)}」`, link: `/topic/${x.week}/${x.uid}` })),
    ].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 8);
    return `<div class="ad-tiles">
        ${tile(ICON.user, (j.users || []).length, 'ユーザー', `利用停止 ${banned}`, 'user')}
        ${tile(ICON.note, songs.length, 'おすすめ曲', `今週 +${week(songs)}`, 'song')}
        ${tile(ICON.topic, curW ? curW.answers.length : 0, '今週のお題の答え', curW ? esc(curW.title) : '', 'tpc')}
        ${tile(ICON.chat, posts.length, 'つぶやき', `今週 +${week(posts)}`, 'post')}
        ${tile(ICON.comment, cm.length, 'コメント', `今週 +${week(cm)}`, 'cmt')}
        ${tile(ICON.party, live.length, '開催中のパーティー', `これまで ${(j.parties || []).length}`, 'pty')}
      </div>
      <section class="ad-card"><h3>対応が必要なこと</h3>
        ${todo.length ? `<div class="ad-todo">${todo.map(([k, t, cls]) => `<button class="ad-todo-i ${cls}" data-act="adm-tab" data-tab="${k}"><span>${t}</span><i>›</i></button>`).join('')}</div>` : '<div class="ad-ok">いまは対応が必要なことはありません</div>'}
      </section>
      <section class="ad-card"><h3>この2週間の動き</h3>${chart}</section>
      <div class="ad-two">
        <section class="ad-card"><h3>反応の多いおすすめ曲</h3>
          ${top.length ? `<ol class="ad-top5">${top.map((x) => `<li><a href="/s/${esc(x.sid)}" target="_blank" rel="noopener"><img src="${esc(x.art || x.thumb || '')}" alt="" loading="lazy"><span><b>${esc(x.head || x.title)}</b><small>${esc(x.title)} ・ ${esc(x.by)}</small></span></a>
            <span class="ad-nums">${this.num(this.I.thumb, x.likes, 'いいね')}${this.num(this.I.heart, x.hearts, 'ハート')}${this.num(ICON.comment, x.comments, 'コメント')}</span></li>`).join('')}</ol>` : '<div class="ad-empty">まだありません</div>'}
        </section>
        <section class="ad-card"><h3>最近の投稿</h3>
          ${feed.length ? `<ul class="ad-feed">${feed.map((f) => `<li><span class="ad-b">${f.t}</span><a href="${esc(f.link)}" target="_blank" rel="noopener">${f.s}</a><time>${this.dt(f.at)}</time></li>`).join('')}</ul>` : '<div class="ad-empty">まだありません</div>'}
        </section>
      </div>`;
  },

  /* ---------- reports ---------- */
  reports() {
    const g = this.data.groups;
    const REASON = { spam: 'スパム・宣伝', abuse: '悪口・嫌がらせ', inappropriate: '不適切な内容', rights: '権利の侵害', other: 'その他' };
    const KIND = { p: 'プレイリスト', s: 'おすすめ曲', c: 'コメント', m: 'つぶやき' };
    if (!g.length) return '<div class="ad-ok big">未対応の通報はありません</div>';
    return `<p class="ad-hint">同じものへの通報はまとめて表示しています。非公開・削除すると、その通報は自動で対応済みになります。</p>
      <div class="ad-list">${g.map((x) => { const t = x.target;
        return `<article class="ad-row rep ${x.count >= 3 ? 'hot' : ''}">
          <div class="ad-th">${t.thumb ? `<img src="${esc(t.thumb)}" alt="" loading="lazy">` : ''}</div>
          <div class="ad-mid">
            <div class="ad-tags">${this.b('kind', KIND[x.kind])}${this.b('hot', `通報 ${x.count}件`)}${t.hidden ? this.b('warn', '非公開中') : ''}${t.gone ? this.b('', '削除済み') : ''}</div>
            <b class="ad-title">${esc(t.title)}</b>${t.text ? `<p class="ad-text">${esc(t.text)}</p>` : ''}
            <div class="ad-meta">${t.sub || ''} ・ 最新の通報 ${this.dt(x.last)}</div>
            <div class="ad-tags">${Object.entries(x.reasons).map(([k, n]) => this.b('', `${esc(REASON[k] || k)}${n > 1 ? ' ×' + n : ''}`)).join('')}</div>
            ${x.notes.slice(0, 3).map((n) => `<div class="ad-note">「${esc(n)}」</div>`).join('')}
          </div>
          <div class="ad-acts">
            ${t.link ? `<a class="btn sm quiet" href="${t.link}" target="_blank" rel="noopener">見る</a>` : ''}
            ${t.gone ? '' : `<button class="btn sm" data-act="adm" data-target="${t.target}" data-id="${esc(t.id)}" data-cid="${esc(x.cid || '')}" data-op="hide">非公開</button>
              <button class="btn sm quiet danger" data-act="adm" data-target="${t.target}" data-id="${esc(t.id)}" data-cid="${esc(x.cid || '')}" data-op="delete">削除</button>`}
            ${t.byId ? `<button class="btn sm quiet" data-act="adm-user" data-id="${esc(t.byId)}">投稿者</button>` : ''}
            <button class="btn sm quiet" data-act="adm" data-target="report" data-op="resolve" data-kind="${x.kind}" data-id="${esc(x.id)}" data-cid="${esc(x.cid || '')}">問題なし</button>
          </div></article>`; }).join('')}</div>`;
  },
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
      else if (g.kind === 's') { const x = songs.find((y) => y.sid === g.id); g.target = x ? { target: 'song', id: x.sid, title: `${x.head ? x.head + ' — ' : ''}${x.title} / ${x.artist}`, text: x.desc, sub: `投稿：${esc(x.by)}`, byId: x.byId, thumb: x.art || x.thumb, link: `/s/${x.sid}`, hidden: x.hidden } : { title: '（削除済みのおすすめ曲）', gone: true }; }
      else if (g.kind === 'm') { const x = posts.find((y) => y.pid === g.id); g.target = x ? { target: 'post', id: x.pid, title: x.text || (x.songTitles.join(' ／ ') || '（写真のみ）'), sub: `投稿：${esc(x.by)}`, byId: x.byId, thumb: x.img ? `/api/pimg?k=${x.img}` : x.thumb, link: `/c/${x.parent || x.pid}`, hidden: x.hidden } : { title: '（削除済みのつぶやき）', gone: true }; }
      else { const key = g.thread.startsWith('s:') ? g.thread : g.thread.slice(2); const c = allComments.find((y) => y.key === key && y.cid === g.cid); g.target = c ? { target: 'comment', id: key, title: `${c.name} のコメント`, text: c.text, sub: esc(c.where), byId: c.chId, link: c.link, hidden: c.hidden } : { title: '（削除済みのコメント）', gone: true }; }
    }
    return groups.sort((a, b) => b.count - a.count || b.last - a.last);
  },

  /* ---------- content lists with search / filter / sort / bulk ---------- */
  rows(kind) {
    const j = this.data;
    const pop = { song: (x) => x.likes + x.hearts * 2 + x.comments + x.bm, post: (x) => x.rc || 0, pl: (x) => x.likes + (x.bm || 0), cmt: (x) => x.likes || 0, user: (x) => x.songs + x.posts + x.comments + x.playlists + (x.answers || 0) }[kind];
    let l = { song: j.songs, post: j.posts, cmt: j.allComments, pl: j.playlists, user: j.users }[kind] || [];
    const at = (x) => (kind === 'user' ? x.last : x.updated || x.at || 0);
    if (this.vis === 'pub') l = l.filter((x) => (kind === 'user' ? !x.banned : !x.hidden));
    if (this.vis === 'hid') l = l.filter((x) => (kind === 'user' ? x.banned : x.hidden));
    return [...l].sort((a, b) => (this.sort === 'pop' ? pop(b) - pop(a) : 0) || at(b) - at(a));
  },
  list(kind) {
    const label = { song: 'おすすめ曲', post: 'つぶやき', cmt: 'コメント', pl: 'プレイリスト', user: 'ユーザー' }[kind];
    const visL = kind === 'user' ? [['all', 'すべて'], ['pub', '利用中'], ['hid', '利用停止中']] : [['all', 'すべて'], ['pub', '公開中'], ['hid', '非公開']];
    return `<div class="ad-tools">
        <input class="input" id="adm-q" type="search" placeholder="${label}をさがす（名前・タイトル・文章）" value="${esc(this.q)}">
        <div class="ad-seg">${visL.map(([k, l]) => `<button class="${this.vis === k ? 'on' : ''}" data-act="ad-vis" data-k="${k}">${l}</button>`).join('')}</div>
        <div class="ad-seg">${[['new', '新しい順'], ['pop', kind === 'user' ? '活動の多い順' : '反応の多い順']].map(([k, l]) => `<button class="${this.sort === k ? 'on' : ''}" data-act="ad-sort" data-k="${k}">${l}</button>`).join('')}</div>
      </div>
      ${kind === 'user' ? '' : `<label class="ad-selall"><input type="checkbox" id="ad-selall" data-act="ad-selall"> 表示中をすべて選ぶ</label>`}
      <div class="ad-list" id="ad-list" data-kind="${kind}">${this.listRows(kind)}</div>`;
  },
  listRows(kind) {
    const k = this.q.normalize('NFKC').toLowerCase().trim();
    const rows = this.rows(kind).map((x) => this.row(kind, x)).filter((h) => !k || h.replace(/<[^>]+>/g, ' ').normalize('NFKC').toLowerCase().includes(k));
    return rows.length ? rows.join('') + `<div class="ad-count tiny muted">${rows.length}件</div>` : '<div class="ad-empty">見つかりませんでした</div>';
  },
  redrawList() {
    const el = $('#ad-list'); if (!el) return;
    el.innerHTML = this.listRows(el.dataset.kind); this.sel.clear(); this.bulkBar();
    const all = $('#ad-selall'); if (all) all.checked = false;
  },
  /** one row; data-* on the checkbox describe the item for bulk actions */
  row(kind, x) {
    const dt = this.dt, hidB = x.hidden ? this.b('warn', '非公開中') : '';
    const vis = (target, id, extra = '') => `<button class="btn sm" data-act="adm" data-target="${target}" data-id="${esc(id)}" ${extra} data-op="${x.hidden ? 'show' : 'hide'}">${x.hidden ? '公開に戻す' : '非公開'}</button>
      <button class="btn sm quiet danger" data-act="adm" data-target="${target}" data-id="${esc(id)}" ${extra} data-op="delete">削除</button>`;
    const box = (target, id, cid = '') => `<input type="checkbox" class="ad-chk" data-act="ad-chk" data-target="${target}" data-id="${esc(id)}" data-cid="${esc(cid)}" aria-label="選ぶ">`;
    const wrap = (inner, cls = '') => `<article class="ad-row ${x.hidden || x.banned ? 'hid' : ''} ${cls}">${inner}</article>`;
    if (kind === 'song') {
      const sc = this.sceneNames(x.scenes);
      return wrap(`${box('song', x.sid)}<div class="ad-th"><img src="${esc(x.art || x.thumb || '')}" alt="" loading="lazy"></div>
        <div class="ad-mid">
          <div class="ad-tags">${hidB}${x.moment ? this.b('ok', `ここを聴いて ${Math.floor(x.moment.t / 60)}:${String(Math.floor(x.moment.t % 60)).padStart(2, '0')}`) : this.b('', '聴く場所なし')}${sc.map((n) => this.b('scene', esc(n))).join('')}${(x.also || []).length ? this.b('', `私もおすすめ ${x.also.length}人`) : ''}</div>
          <b class="ad-title">${esc(x.head || x.title)}</b>
          <div class="ad-meta">${x.head ? `${esc(x.title)} / ` : ''}${esc(x.artist)} ・ ${this.who(x.byId, x.by)} ・ ${dt(x.at)}</div>
          ${x.desc ? `<p class="ad-text">${esc(x.desc)}</p>` : ''}
          <div class="ad-nums">${this.num(this.I.thumb, x.likes, 'いいね')}${this.num(this.I.heart, x.hearts, 'ハート')}${this.num(ICON.comment, x.comments, 'コメント')}${this.num(ICON.star, x.bm, 'ブックマーク')}</div>
        </div>
        <div class="ad-acts"><a class="btn sm quiet" href="/s/${esc(x.sid)}" target="_blank" rel="noopener">見る</a>
          ${x.head ? `<button class="btn sm quiet" data-act="adm" data-target="song" data-id="${esc(x.sid)}" data-op="clearhead" data-name="${esc(x.head)}">タイトルを消す</button>` : ''}
          ${vis('song', x.sid)}<button class="btn sm quiet" data-act="adm-user" data-id="${esc(x.byId)}">投稿者</button></div>`);
    }
    if (kind === 'post') {
      return wrap(`${box('post', x.pid)}<div class="ad-th">${x.img || x.thumb ? `<img src="${esc(x.img ? `/api/pimg?k=${x.img}` : x.thumb)}" alt="" loading="lazy">` : ICON.chat}</div>
        <div class="ad-mid"><div class="ad-tags">${hidB}${x.parent ? this.b('', '返信') : ''}${x.battle ? this.b('', '曲バトル') : x.songs > 1 ? this.b('', `ミックステープ ${x.songs}曲`) : x.songs ? this.b('', '曲つき') : ''}${x.img ? this.b('', '写真') : ''}</div>
          <p class="ad-text strong">${esc(x.text || (x.songTitles.length ? '♪ ' + x.songTitles.join(' ／ ') : '（写真のみ）'))}</p>
          <div class="ad-meta">${this.who(x.byId, x.by)} ・ ${dt(x.at)} ・ 返信 ${x.rc}</div></div>
        <div class="ad-acts"><a class="btn sm quiet" href="/c/${esc(x.parent || x.pid)}" target="_blank" rel="noopener">見る</a>${vis('post', x.pid)}<button class="btn sm quiet" data-act="adm-user" data-id="${esc(x.byId)}">投稿者</button></div>`);
    }
    if (kind === 'cmt') {
      return wrap(`${box('comment', x.key, x.cid)}<div class="ad-th round">${x.chId ? Avatars.html(x.chId, x.name) : ICON.comment}</div>
        <div class="ad-mid"><div class="ad-tags">${hidB}${x.parent ? this.b('', '返信') : ''}</div>
          <p class="ad-text strong">${esc(x.text)}</p>
          <div class="ad-meta">${x.chId ? this.who(x.chId, x.name) : `${esc(x.name)}（ID ${esc(x.uid || '-')}）`} ・ ${esc(x.where)} ・ ${dt(x.at)}${x.likes ? ` ・ ♥ ${x.likes}` : ''}</div></div>
        <div class="ad-acts"><a class="btn sm quiet" href="${esc(x.link)}" target="_blank" rel="noopener">見る</a>${vis('comment', x.key, `data-cid="${esc(x.cid)}"`)}</div>`);
    }
    if (kind === 'pl') {
      return wrap(`${box('playlist', x.id)}<div class="ad-th"><img src="${esc(x.image || '')}" alt="" loading="lazy"></div>
        <div class="ad-mid"><div class="ad-tags">${hidB}${(genresOf(x) || []).map((g) => this.b('', esc(genreName(g)))).join('')}</div>
          <b class="ad-title">${esc(x.title)}</b><div class="ad-meta">${this.who(x.ownerId, x.owner)} ・ ${dt(x.updated || x.at)}</div>
          <div class="ad-nums">${this.num(this.I.heart, x.likes, 'いいね')}${this.num(ICON.comment, x.comments || 0, 'コメント')}${this.num(ICON.star, x.bm || 0, 'ブックマーク')}</div></div>
        <div class="ad-acts"><a class="btn sm quiet" href="/p/${esc(x.id)}" target="_blank" rel="noopener">見る</a>${vis('playlist', x.id)}<button class="btn sm quiet" data-act="adm-user" data-id="${esc(x.ownerId)}">作成者</button></div>`);
    }
    if (kind === 'user') {
      return `<article class="ad-row user ${x.banned ? 'hid' : ''}" id="adm-u-${esc(x.id)}" data-act="adm-user" data-id="${esc(x.id)}" role="button" tabindex="0">
        <div class="ad-th round">${Avatars.html(x.id, x.name)}</div>
        <div class="ad-mid"><div class="ad-tags">${x.banned ? this.b('bad', '利用停止中') : ''}</div><b class="ad-title">${esc(x.name || '(名前なし)')}</b>
          <div class="ad-meta">おすすめ曲 ${x.songs} ・ お題 ${x.answers || 0} ・ つぶやき ${x.posts} ・ コメント ${x.comments} ・ プレイリスト ${x.playlists}</div>
          <div class="ad-meta">最後の活動 ${dt(x.last)}</div></div>
        <div class="ad-acts"><span class="ad-chev">›</span></div></article>`;
    }
    return '';
  },

  /* ---------- お題 ---------- */
  topics() {
    const ws = this.data.topics || [];
    const w = ws.find((x) => x.week === this.week) || ws[0];
    const box = (a) => `<article class="ad-row">
        <div class="ad-th"><img src="${esc(a.art || a.thumb || `https://i.ytimg.com/vi/${a.id}/mqdefault.jpg`)}" alt="" loading="lazy"></div>
        <div class="ad-mid"><b class="ad-title">${esc(a.title)} / ${esc(a.artist)}</b>
          ${a.moment?.line ? `<p class="ad-text strong">「${esc(a.moment.line)}」</p>` : ''}${a.note ? `<p class="ad-text">${esc(a.note)}</p>` : ''}
          <div class="ad-meta">${this.who(a.uid, a.name)} ・ ${this.dt(a.ts)}</div></div>
        <div class="ad-acts"><a class="btn sm quiet" href="/topic/${esc(w.week)}/${esc(a.uid)}" target="_blank" rel="noopener">見る</a>
          <button class="btn sm quiet danger" data-act="adm" data-target="answer" data-id="${esc(w.week)}" data-cid="${esc(a.uid)}" data-name="${esc(a.name)}「${esc(a.title)}」" data-op="delete">削除</button>
          <button class="btn sm quiet" data-act="adm-user" data-id="${esc(a.uid)}">回答者</button></div></article>`;
    return `<section class="ad-card"><h3>お題の設定</h3><div id="adm-topic"></div></section>
      <section class="ad-card"><h3>答え</h3>
        ${ws.length ? `<div class="ad-weeks">${ws.map((x) => `<button class="${x.week === w?.week ? 'on' : ''}" data-act="ad-week" data-w="${esc(x.week)}"><b>${x.current ? '今週' : esc(x.start.slice(5).replace('-', '/')) + 'の週'}</b><small>${esc(x.title)}</small><i>${x.answers.length}</i></button>`).join('')}</div>` : ''}
        ${w && w.answers.length ? `<div class="ad-list">${w.answers.map(box).join('')}</div>` : '<div class="ad-empty">この週の答えはまだありません</div>'}
      </section>`;
  },

  /* ---------- parties ---------- */
  parties() {
    const l = this.data.parties || [], now = Date.now();
    if (!l.length) return '<div class="ad-empty">リスニングパーティーはまだ開かれていません</div>';
    return `<div class="ad-list">${l.map((p) => { const live = !p.closed && now - p.updated < 15 * 60e3;
      return `<article class="ad-row ${p.closed ? 'hid' : ''}"><div class="ad-th round">${ICON.party}</div>
        <div class="ad-mid"><div class="ad-tags">${live ? this.b('ok', '開催中') : p.closed ? this.b('', '終了') : this.b('', '休止中')}</div>
          <b class="ad-title">${esc(p.title || '（タイトルなし）')}</b>
          <div class="ad-meta">ホスト ${this.who(p.hostId, p.host)} ・ ${p.songs}曲 ・ 開始 ${this.dt(p.created)} ・ 最終 ${this.dt(p.updated)}</div></div>
        <div class="ad-acts"><a class="btn sm quiet" href="/party/${esc(p.rid)}" target="_blank" rel="noopener">見る</a>
          ${p.closed ? '' : `<button class="btn sm quiet danger" data-act="adm" data-target="party" data-id="${esc(p.rid)}" data-name="${esc(p.title)}" data-op="close">終了させる</button>`}
          ${p.hostId ? `<button class="btn sm quiet" data-act="adm-user" data-id="${esc(p.hostId)}">ホスト</button>` : ''}</div></article>`; }).join('')}</div>`;
  },

  /* ---------- notices to everyone ---------- */
  news() {
    const h = this.data.broadcasts || [];
    return `<section class="ad-card"><h3>みんなにお知らせを送る</h3>
        <p class="ad-hint">これまでに投稿したことのある人（利用停止中の人をのぞく）のお知らせ欄に届きます。メンテナンスや新機能のお知らせに。</p>
        <textarea class="textarea" id="ad-news" maxlength="200" rows="4" placeholder="例：今週のお題が始まりました！"></textarea>
        <div class="ad-news-row"><span class="tiny muted" id="ad-news-n">0 / 200</span><button class="btn solid" data-act="ad-news-send">${this.I.mega} 送る</button></div>
        <div class="ad-news-pv"><span class="tiny muted">届くお知らせの見た目</span><div class="nrow"><span class="ni like sys">${ICON.bell}</span><span class="nbody"><span class="nmsg">運営からのお知らせです</span><span class="ntext" id="ad-news-pv">（ここに本文が表示されます）</span></span></div></div>
      </section>
      <section class="ad-card"><h3>これまでに送ったお知らせ</h3>
        ${h.length ? `<ul class="ad-feed">${h.map((x) => `<li><span class="ad-b">${x.n}人</span><span>${esc(x.text)}</span><time>${this.dt(x.at)}</time></li>`).join('')}</ul>` : '<div class="ad-empty">まだ送っていません</div>'}
      </section>`;
  },
  async send(btn) {
    const t = ($('#ad-news')?.value || '').trim(); if (!t) return toast('本文を入力してください');
    if (!confirm(`このお知らせをみんなに送りますか？\n\n「${t}」`)) return;
    btn.disabled = true;
    const j = await this.call({ target: 'all', op: 'broadcast', note: t });
    btn.disabled = false;
    if (j) { toast(`${j.n}人にお知らせを送りました`); this.reload(); }
  },

  /* ---------- log ---------- */
  logs() {
    const OP = { hide: '非公開', show: '公開に戻す', delete: '削除', ban: '利用停止', unban: '利用停止を解除', hideall: 'すべて非公開', resolve: '通報を対応済み', broadcast: 'お知らせ配信', close: 'パーティー終了', clearhead: 'タイトルを消去', topic: 'お題を設定' };
    const TG = { playlist: 'プレイリスト', song: 'おすすめ曲', comment: 'コメント', post: 'つぶやき', report: '通報', user: 'ユーザー', all: 'お知らせ', answer: 'お題の答え', party: 'パーティー', topic: 'お題' };
    const l = this.data.log || [];
    return l.length ? `<ul class="ad-log">${l.map((x) => `<li><time>${this.dt(x.at)}</time><span class="ad-b">${TG[x.target] || esc(x.target || '')}</span><b>${OP[x.op] || esc(x.op || '')}</b><span class="muted">${esc(x.what || '')}</span></li>`).join('')}</ul>` : '<div class="ad-empty">まだ操作はありません</div>';
  },

  /* ---------- a user's detail sheet ---------- */
  user(id) {
    const j = this.data, x = (j.users || []).find((u) => u.id === id);
    const m = document.getElementById('modal'); if (!m || !id) return;
    const songs = (j.songs || []).filter((s) => s.byId === id), posts = (j.posts || []).filter((p) => p.byId === id);
    const cms = j.allComments.filter((c) => c.chId === id), pls = (j.playlists || []).filter((p) => p.ownerId === id), ans = j.answers.filter((a) => a.uid === id);
    const reps = j.groups.filter((g) => g.target?.byId === id).reduce((n, g) => n + g.count, 0);
    const li = (t, link, sub, hidden) => `<li class="${hidden ? 'hid' : ''}"><a href="${esc(link)}" target="_blank" rel="noopener">${esc(t)}</a><small>${sub}${hidden ? ' ・ 非公開中' : ''}</small></li>`;
    const sec = (title, arr, f) => (arr.length ? `<h4>${title}（${arr.length}）</h4><ul class="ad-ulist">${arr.slice(0, 20).map(f).join('')}</ul>` : '');
    const name = x?.name || songs[0]?.by || posts[0]?.by || ans[0]?.name || id;
    m.innerHTML = `<div class="modal-card ad-user" role="dialog" aria-label="${esc(name)} さん">
      <div class="ad-user-h">${Avatars.html(id, name)}<div><b>${esc(name)}</b><div class="tiny muted">${x?.banned ? '利用停止中 ・ ' : ''}最後の活動 ${this.dt(x?.last)}${reps ? ` ・ 通報された数 ${reps}` : ''}</div></div>
        <button class="btn quiet sm" data-act="modal-close" aria-label="閉じる">${ICON.close}</button></div>
      <div class="ad-user-acts">
        <a class="btn sm quiet" href="/u/${esc(id)}" target="_blank" rel="noopener">プロフィール</a>
        <button class="btn sm" data-act="adm" data-target="user" data-id="${esc(id)}" data-name="${esc(name)}" data-op="hideall">投稿をすべて非公開</button>
        ${x?.banned ? `<button class="btn sm" data-act="adm" data-target="user" data-id="${esc(id)}" data-name="${esc(name)}" data-op="unban">利用停止を解除</button>`
          : `<button class="btn sm quiet danger" data-act="adm" data-target="user" data-id="${esc(id)}" data-name="${esc(name)}" data-op="ban">利用停止</button>`}
      </div>
      <div class="ad-user-body">
        ${sec('おすすめ曲', songs, (s) => li(s.head || s.title, `/s/${s.sid}`, `${esc(s.title)} ・ ${this.dt(s.at)}`, s.hidden))}
        ${sec('お題の答え', ans, (a) => li(a.title, `/topic/${a.week}/${a.uid}`, `${esc(a.wtitle)} ・ ${this.dt(a.ts)}`))}
        ${sec('つぶやき', posts, (p) => li(p.text || p.songTitles.join(' ／ ') || '（写真）', `/c/${p.parent || p.pid}`, this.dt(p.at), p.hidden))}
        ${sec('コメント', cms, (c) => li(c.text, c.link, `${esc(c.where)} ・ ${this.dt(c.at)}`, c.hidden))}
        ${sec('プレイリスト', pls, (p) => li(p.title, `/p/${p.id}`, this.dt(p.updated || p.at), p.hidden))}
        ${songs.length + posts.length + cms.length + pls.length + ans.length ? '' : '<div class="ad-empty">投稿はありません</div>'}
      </div></div>`;
    m.hidden = false; document.body.classList.add('modal-open');
  },

  /* ---------- actions ---------- */
  async call(body) {
    const r = await fetch('/api/admin/act', { method: 'POST', headers: { Authorization: 'Admin ' + this.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { this.token = null; toast('もう一度ログインしてください'); this.render(); return null; }
    if (!r.ok) { toast(j.error || '操作できませんでした', 4000); return null; }
    return j;
  },
  async reload() { const y = window.scrollY; this.stale = true; await this.render(); window.scrollTo({ top: y }); },
  async act(el) {
    const { target, id, op, cid, kind, name } = el.dataset;
    const ask = {
      delete: target === 'comment' ? '削除すると元に戻せません（返信がある場合は返信も消えます）。削除しますか？' : target === 'answer' ? `お題の答え ${name || ''} を削除しますか？（元に戻せません）` : '削除すると元に戻せません。削除しますか？',
      ban: `「${name}」さんを利用停止にしますか？\n停止中は、投稿・コメント・お題への回答・共有ができなくなります（見るのはできます）。`,
      hideall: `「${name}」さんのプレイリスト・おすすめ曲・つぶやきを、すべて非公開にしますか？`,
      close: `パーティー「${name || ''}」を終了させますか？`,
      clearhead: `このおすすめ曲のタイトル「${name || ''}」を消しますか？（曲はそのまま残ります）`,
    }[op];
    if (ask && target !== 'report' && !confirm(ask)) return;
    const note = op === 'ban' ? (prompt('停止の理由（運営のメモ・任意）') || '') : '';
    const label = el.closest('.ad-row')?.querySelector('.ad-title, .ad-text')?.textContent || name || '';
    el.disabled = true;
    const j = await this.call({ target, id, op, cid, kind, name: name || label.slice(0, 80), note });
    if (!j) { el.disabled = false; return; }
    Social.gallery = null; Songs.list = null;
    toast({ hide: '非公開にしました', show: '公開に戻しました', delete: '削除しました', resolve: '対応済みにしました', ban: '利用停止にしました', unban: '利用停止を解除しました', hideall: 'すべて非公開にしました', close: 'パーティーを終了しました', clearhead: 'タイトルを消しました' }[op] || '完了しました');
    const reopen = target === 'user' && !document.getElementById('modal')?.hidden ? id : '';
    await this.reload();
    if (reopen) this.user(reopen);
  },
  /* bulk selection */
  bulkBar() {
    const bar = $('#ad-bulk'); if (!bar) return;
    const n = this.sel.size;
    bar.hidden = !n;
    bar.innerHTML = n ? `<b>${n}件を選択中</b><span class="spacer"></span>
      <button class="btn sm" data-act="ad-bulk" data-op="hide">非公開</button><button class="btn sm" data-act="ad-bulk" data-op="show">公開に戻す</button>
      <button class="btn sm danger" data-act="ad-bulk" data-op="delete">削除</button><button class="btn sm quiet" data-act="ad-bulk-clear" aria-label="選択をやめる">${ICON.close}</button>` : '';
  },
  async bulk(op) {
    const items = [...this.sel].map((k) => JSON.parse(k));
    if (!items.length) return;
    const verb = { hide: '非公開に', show: '公開に戻', delete: '削除' }[op];
    if (!confirm(`${items.length}件を${verb}${op === 'delete' ? 'します。元に戻せません。よろしいですか？' : 'しますか？'}`)) return;
    let ok = 0;
    for (const it of items) { const j = await this.call({ ...it, op, name: 'まとめて操作' }); if (j) ok++; }
    this.sel.clear(); Social.gallery = null; Songs.list = null;
    toast(`${ok}件を${verb}${op === 'delete' ? 'しました' : 'しました'}`);
    this.reload();
  },
  onAction(act, el, ev) {
    switch (act) {
      case 'ad-vis': this.vis = el.dataset.k; this.draw(); return true;
      case 'ad-sort': this.sort = el.dataset.k; this.draw(); return true;
      case 'ad-week': this.week = el.dataset.w; this.draw(); return true;
      case 'ad-news-send': this.send(el); return true;
      case 'ad-chk': {
        const key = JSON.stringify({ target: el.dataset.target, id: el.dataset.id, cid: el.dataset.cid || '' });
        if (el.checked) this.sel.add(key); else this.sel.delete(key);
        el.closest('.ad-row')?.classList.toggle('sel', el.checked); this.bulkBar(); return true;
      }
      case 'ad-selall': {
        document.querySelectorAll('#ad-list .ad-chk').forEach((c) => { if (c.checked !== el.checked) { c.checked = el.checked; this.onAction('ad-chk', c, ev); } });
        return true;
      }
      case 'ad-bulk': this.bulk(el.dataset.op); return true;
      case 'ad-bulk-clear': this.sel.clear(); document.querySelectorAll('.ad-chk:checked, #ad-selall').forEach((c) => { c.checked = false; c.closest('.ad-row')?.classList.remove('sel'); }); this.bulkBar(); return true;
      default: return false;
    }
  },
};
window.Admin = Admin;

(function plug() {
  if (typeof Hooks === 'undefined') return setTimeout(plug, 0);
  Hooks.actions.push((act, el, ev) => (act.startsWith('ad-') ? Admin.onAction(act, el, ev) : false));
  Hooks.notif.admin = () => '運営からのお知らせです';
  Hooks.notifLink.admin = () => '/notifs';
})();
