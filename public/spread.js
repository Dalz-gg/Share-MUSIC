/* Share MUSIC — Stage 4 — 布教の木 (how a recommendation spread from person to person).
 * Plugs into app.js through Hooks (see the top of app.js). Loaded before app.js; only refer to app.js globals inside functions.
 *   - song page:   #song-spread  <- the song's tree (GET /api/spread?sid=)
 *   - profile/me:  #prof-extra   <- appends "あなたのおすすめが ○段階で ○人に届いた" (GET /api/spread?user=)
 *   - notifications: t:'spread' (sent by the server when someone's reach passes a milestone) */
'use strict';

const Spread = (() => {
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    tree: svg('<circle cx="12" cy="5" r="2.4"/><circle cx="5.5" cy="18.5" r="2.4"/><circle cx="18.5" cy="18.5" r="2.4"/><path d="M12 7.4v4.1M12 11.5H5.5v4.6M12 11.5h6.5v4.6"/>'),
    thx: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
    also: svg('<circle cx="9.5" cy="8" r="3.5"/><path d="M3.5 20c.7-3.6 3.2-5.5 6-5.5s4 1 5 2.6"/><path d="M18.5 13v7M15 16.5h7"/>'),
    topic: svg('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'),
  };
  const KIND = { thx: 'ありがとう', also: '私もおすすめ', topic: 'お題' };
  const MAX_NODES = 120;
  const get = async (q) => { const r = await fetch('/api/spread?' + q); if (!r.ok) throw new Error(r.status); return r.json(); };

  /** turn edges into a forest: each person hangs under whoever reached them first (from the root outwards) */
  function build(t) {
    const names = new Map((t.nodes || []).map((n) => [n.id, n.name || '']));
    const edges = (t.edges || []).filter((e) => e.from && e.to && e.from !== e.to).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const out = new Map(), into = new Set();
    for (const e of edges) { if (!out.has(e.from)) out.set(e.from, []); out.get(e.from).push(e); into.add(e.to); }
    const placed = new Set(), kids = new Map(), kinds = new Map();
    const starts = [];
    if (t.root?.id) starts.push(t.root.id);
    for (const e of edges) if (!into.has(e.from) && !starts.includes(e.from)) starts.push(e.from);
    for (const e of edges) if (!starts.includes(e.from)) starts.push(e.from); // cycles with no clean start
    const roots = [];
    for (const s of starts) {
      if (placed.has(s)) continue;
      if (s !== t.root?.id && !out.has(s)) continue;
      placed.add(s); roots.push(s);
      const q = [s];
      while (q.length) {
        const a = q.shift();
        for (const e of out.get(a) || []) {
          if (!placed.has(e.to)) { placed.add(e.to); if (!kids.has(a)) kids.set(a, []); kids.get(a).push(e.to); q.push(e.to); }
          const k = a + '>' + e.to; if (!kinds.has(k)) kinds.set(k, []); if (!kinds.get(k).includes(e.kind)) kinds.get(k).push(e.kind);
        }
      }
    }
    let depth = 0;
    const deep = (id, d) => { depth = Math.max(depth, d); for (const c of kids.get(id) || []) deep(c, d + 1); };
    roots.forEach((r) => deep(r, 0));
    return { names, kids, kinds, roots, depth, people: placed.size - (t.root?.id && placed.has(t.root.id) ? 1 : 0) };
  }

  function person(id, name, cls) {
    return `<a class="spr-p ${cls}" href="/u/${esc(id)}" data-act="go" data-to="/u/${esc(id)}">${Avatars.html(id, name, 'spr-av')}<span class="spr-name">${esc(name || 'だれか')}</span></a>`;
  }
  function tag(ks) {
    const k = ks?.[0] || 'thx';
    return `<span class="spr-k k-${esc(k)}" title="${esc(ks.map((x) => KIND[x] || x).join('・'))}">${ks.map((x) => IC[x] || IC.thx).join('')}<span>${esc(KIND[k] || '')}</span></span>`;
  }
  function draw(f, rootId) {
    let n = 0;
    const li = (id, parent) => {
      if (++n > MAX_NODES) return '';
      const ks = kids(id);
      return `<li>${parent ? `<div class="spr-row">${tag(f.kinds.get(parent + '>' + id) || [])}${person(id, f.names.get(id), '')}</div>` : `<div class="spr-row">${person(id, f.names.get(id), id === rootId ? 'root' : '')}${id === rootId ? '<span class="spr-start">最初のおすすめ</span>' : ''}</div>`}${ks.length ? `<ul>${ks.map((c) => li(c, id)).join('')}</ul>` : ''}</li>`;
    };
    const kids = (id) => f.kids.get(id) || [];
    const html = f.roots.map((r) => `<ul class="spr-tree">${li(r, null)}</ul>`).join('');
    const more = n > MAX_NODES ? `<div class="spr-more">ほか ${n - MAX_NODES}人</div>` : '';
    return html + more;
  }

  async function song(so, view) {
    const el = document.getElementById('song-spread'); if (!el || !so?.sid) return;
    el.hidden = true;
    let t; try { t = await get('sid=' + encodeURIComponent(so.sid)); } catch { return; }
    if (S.view !== view || !el.isConnected) return;
    if (!t.edges?.length) { el.innerHTML = ''; return; }
    if (!t.root && so.byId) t.root = { id: so.byId, name: so.by || '' };
    const f = build(t);
    if (!f.people) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="label"><b>${IC.tree}</b> 布教の木</div>
      <div class="spr-card">
        <div class="spr-sum">この曲は <b>${f.people}人</b> に届きました${f.depth > 1 ? `<span class="spr-dep">（${f.depth}段階）</span>` : ''}</div>
        <div class="spr-scroll">${draw(f, t.root?.id)}</div>
        <div class="spr-legend">${Object.entries(KIND).map(([k, l]) => `<span class="k-${k}">${IC[k]}${l}</span>`).join('')}</div>
      </div>`;
    el.hidden = false;
    Avatars.fill(el);
  }

  async function profile(id, { isMe }) {
    const path = location.pathname;
    let r; try { r = await get('user=' + encodeURIComponent(id)); } catch { return; }
    const box = document.getElementById('prof-extra');
    if (!box || location.pathname !== path || !r.people) return;
    box.querySelector('.spr-reach')?.remove();
    const who = isMe ? 'あなたのおすすめが' : 'この人のおすすめが';
    const verb = isMe ? '届きました' : '届いています';
    box.insertAdjacentHTML('beforeend', `<div class="spr-reach">
      <span class="spr-reach-ic">${IC.tree}</span>
      <div><div class="spr-reach-t">${who} <b>${r.depth}段階</b>で <b>${r.people}人</b>に${verb}</div>
      <div class="spr-reach-s">ありがとう・私もおすすめ・お題で広がった人数</div></div>
    </div>`);
  }

  return { build, song, profile, IC };
})();

/* app.js (and its `Hooks`) runs after this file, so register once the page has finished loading,
 * then fill a song page / profile that app.js may already have drawn before we were registered. */
function sprRegister() {
  Hooks.song.push((so, view) => { Spread.song(so, view); });
  Hooks.profile.push((id, o) => { Spread.profile(id, o || {}); });
  Hooks.notif.spread = (n) => `あなたのおすすめが <b>${Number(n.depth) || 1}段階</b>で <b>${Number(n.people) || 0}人</b>に届きました`;
  Hooks.notifLink.spread = () => '/me';
  const sm = /^\/s\/([\w-]{6,40})/.exec(location.pathname);
  if (sm && document.getElementById('song-spread')) Spread.song({ sid: sm[1] }, S.view);
  if (document.getElementById('prof-extra')) {
    const um = /^\/u\/([\w-]{10,})/.exec(location.pathname);
    if (um) Spread.profile(um[1], { isMe: false });
    else if (location.pathname === '/me' && Api.profile?.id) Spread.profile(Api.profile.id, { isMe: true });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sprRegister, { once: true });
else setTimeout(sprRegister);
