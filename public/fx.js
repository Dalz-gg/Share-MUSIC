/* Share MUSIC — visual effects: record / cassette deck, share image, recents, PWA. */
'use strict';

/** YouTube's hqdefault / sddefault / default thumbnails are letterboxed (4:3 with black bars). */
function isLetterboxed(src) { return /\/(hq|sd)?default\.jpg/.test(src || ''); }
function fixLetterbox(root = document) { root.querySelectorAll('img').forEach((i) => i.classList.toggle('lb', isLetterboxed(i.getAttribute('src')))); }

/* =========================================================
 * Deck: a record that slides out of its sleeve and spins while music plays
 * ======================================================= */
const Deck = {
  look() { return 'vinyl'; }, // the cassette look was retired: every page uses the record
  setLook(look) {
    const u = new URL(location.href);
    u.searchParams.delete('look');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  },

  html(p, look) {
    const cover = p.image ? `<img src="${esc(p.image)}" alt="" crossorigin="anonymous">` : jcard(p.title);
    return `<div class="deck vinyl" id="deck">
      <div class="platter">
        <div class="disc"><div class="label"><img id="disc-label" alt="" src="${esc(p.image || '')}" ${p.image ? '' : 'hidden'}><i></i></div></div>
        <div class="shine"></div>
      </div>
      <div class="sleeve">${cover}</div>
      <div class="arm"><i></i></div>
    </div>`;
  },

  toggleHtml() { return ''; },

  /* Rotation is driven from JavaScript (not a CSS animation) so it keeps spinning while music plays even when
     the phone has "Reduce Motion" turned on, and it resumes from the same angle after a pause. */
  playing: false, angle: 0, raf: 0, last: 0,
  setPlaying(on) {
    const d = document.getElementById('deck'); if (d) d.classList.toggle('playing', !!on);
    this.playing = !!on;
    if (this.playing && !this.raf) { this.last = 0; this.raf = requestAnimationFrame((t) => this.frame(t)); }
  },
  frame(t) {
    if (!this.playing) { this.raf = 0; return; }
    const dt = this.last ? Math.min(t - this.last, 100) : 0; this.last = t;
    this.angle = (this.angle + dt * 0.15) % 360; // 150°/s ≈ one turn every 2.4 s (33⅓ rpm feel)
    const disc = document.querySelector('#deck .disc'); if (disc) disc.style.transform = `rotate(${this.angle}deg)`;
    document.querySelectorAll('#deck .hub').forEach((h) => { h.style.transform = `rotate(${-this.angle * 1.6}deg)`; });
    this.raf = requestAnimationFrame((x) => this.frame(x));
  },
  setTrack(t) { const img = document.getElementById('disc-label'); if (img && t?.thumb) { img.src = t.thumb; img.hidden = false; img.classList.toggle('lb', isLetterboxed(t.thumb)); } },
  /** overall playlist progress 0..1 (tape winds from left reel to right reel) */
  setProgress(x) {
    const d = document.getElementById('deck'); if (!d) return;
    x = Math.max(0, Math.min(1, x || 0));
    d.style.setProperty('--l', (1 - x).toFixed(3)); d.style.setProperty('--r', x.toFixed(3));
  },
};

/* =========================================================
 * Share image (1080x1920, story size) drawn on a canvas
 * ======================================================= */
const ShareImage = {
  async loadImg(src) {
    if (!src) return null;
    try { const img = new Image(); img.crossOrigin = 'anonymous'; img.src = src; await img.decode(); return img; } catch { return null; }
  },
  wrap(g, text, maxW, maxLines) {
    const lines = []; let cur = '';
    for (const ch of Array.from(text)) {
      if (g.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch.trimStart(); if (lines.length === maxLines) break; } else cur += ch;
    }
    if (lines.length < maxLines && cur) lines.push(cur);
    else if (lines.length === maxLines && cur) lines[maxLines - 1] = this.fit(g, lines[maxLines - 1] + cur, maxW);
    return lines;
  },
  fit(g, text, maxW) {
    if (g.measureText(text).width <= maxW) return text;
    let s = Array.from(text);
    while (s.length && g.measureText(s.join('') + '…').width > maxW) s.pop();
    return s.join('') + '…';
  },
  cover(g, img, x, y, w, h) {
    // YouTube hq/sd thumbnails are 4:3 with black bars: crop to the 16:9 picture inside first
    let iy = 0, ih = img.naturalHeight;
    if (isLetterboxed(img.src)) { iy = ih * 0.125; ih *= 0.75; }
    const r = Math.max(w / img.naturalWidth, h / ih);
    const sw = w / r, sh = h / r;
    g.drawImage(img, (img.naturalWidth - sw) / 2, iy + (ih - sh) / 2, sw, sh, x, y, w, h);
  },

  /** 1080x1920 story image in the app's dark look; song = { artist, desc, d } makes a recommended-song card */
  async make(p, tracks, url, song = null) {
    const pal = Theme.current(), W = 1080, H = 1920, BG = '#0F0F12', INK = '#F4F3FA', SUB = '#A9A6BE', G1 = pal.g1, G2 = pal.g2;
    const sample = p.title + p.owner + (song ? song.artist + (song.desc || '') : tracks.slice(0, 10).map((t) => t.name + t.artist).join('')) + '曲分時間おすすめした人「」';
    await Promise.all([
      document.fonts.load('900 84px "Zen Kaku Gothic New"', sample),
      document.fonts.load('700 36px "Zen Kaku Gothic New"', sample),
      document.fonts.load('500 36px "Zen Kaku Gothic New"', sample),
      document.fonts.load('500 28px "IBM Plex Mono"', '0123456789:/.-PLAYLISTSHARETRACKSMORERECOMMENDEDSONGbcdefghijklmnopqrstuvwxyz'),
    ]).catch(() => {});
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const grad = (x0, y0, x1, y1) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, G1); gr.addColorStop(1, G2); return gr; };
    const glow = (x, y, r, col, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col + Math.round(a * 255).toString(16).padStart(2, '0')); gr.addColorStop(1, col + '00'); g.fillStyle = gr; g.fillRect(0, 0, W, H); };
    g.fillStyle = BG; g.fillRect(0, 0, W, H);
    glow(120, 160, 900, G1, 0.42); glow(1000, 820, 900, G2, 0.45); glow(300, 1900, 800, G2, 0.25);

    // masthead
    g.fillStyle = grad(80, 92, 128, 140); g.beginPath(); g.arc(104, 116, 24, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(104, 116, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = INK; g.font = '900 34px "Zen Kaku Gothic New"'; g.textBaseline = 'middle';
    g.fillText('Share MUSIC', 144, 118);

    // record peeking out of the sleeve
    const sx = 80, sy = 220, S = 620, cx = sx + S * 0.8, cy = sy + S / 2, R = S * 0.47;
    g.save(); g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 50; g.shadowOffsetY = 20;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = '#141319'; g.fill(); g.restore();
    g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 2;
    for (let rr = R * 0.36; rr < R - 6; rr += 9) { g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.arc(cx, cy, R * 0.3, 0, Math.PI * 2); g.fillStyle = grad(cx - R * 0.3, cy - R * 0.3, cx + R * 0.3, cy + R * 0.3); g.fill();
    g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.fillStyle = BG; g.fill();
    const img = await this.loadImg(p.image);
    g.save(); g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 50; g.shadowOffsetY = 24;
    g.beginPath(); g.roundRect(sx, sy, S, S, 22); g.fillStyle = grad(sx, sy, sx + S, sy + S); g.fill(); g.restore();
    g.save(); g.beginPath(); g.roundRect(sx, sy, S, S, 22); g.clip();
    if (img) this.cover(g, img, sx, sy, S, S);
    else { g.fillStyle = '#fff'; g.font = '900 64px "Zen Kaku Gothic New"'; g.textBaseline = 'top'; this.wrap(g, p.title, S - 100, 4).forEach((l, i) => g.fillText(l, sx + 50, sy + 50 + i * 80)); }
    g.restore();

    // title & meta
    let y = sy + S + 86;
    g.fillStyle = SUB; g.font = '500 28px "IBM Plex Mono"'; g.textBaseline = 'alphabetic';
    if (song) g.fillText(`RECOMMENDED SONG${song.d ? ' · ' + fmtDur(song.d) : ''}`, 80, y);
    else g.fillText(`PLAYLIST · ${String(tracks.length).padStart(2, '0')} TRACKS · ${fmtTotal(tracks.reduce((a, t) => a + (t.d || 0), 0))}`, 80, y);
    y += 30;
    g.fillStyle = INK; g.font = '900 84px "Zen Kaku Gothic New"'; g.textBaseline = 'top';
    for (const l of this.wrap(g, p.title, W - 160, 2)) { g.fillText(l, 80, y); y += 106; }
    if (song) { g.font = '700 44px "Zen Kaku Gothic New"'; g.fillStyle = INK; g.fillText(this.fit(g, song.artist, W - 160), 80, y + 2); y += 70; }
    g.fillStyle = SUB; g.font = '500 32px "Zen Kaku Gothic New"';
    g.fillText(this.fit(g, `${song ? 'おすすめした人' : '作った人'}  ${p.owner}`, W - 160), 80, y + 6);
    y += 76;
    g.fillStyle = grad(80, y, W - 80, y); g.fillRect(80, y, W - 160, 4);
    y += 40;

    if (song) {
      // the recommendation itself
      const text = (song.desc || '').trim() || 'この曲、聴いてみて。';
      g.fillStyle = G1; g.font = '900 120px "Zen Kaku Gothic New"'; g.textBaseline = 'top'; g.fillText('“', 70, y - 20);
      g.fillStyle = INK; g.font = '500 44px "Zen Kaku Gothic New"';
      const room = H - 230 - (y + 90), lines = this.wrap(g, text.replace(/\s+/g, ' '), W - 200, Math.max(1, Math.floor(room / 70)));
      lines.forEach((l, i) => g.fillText(l, 130, y + 90 + i * 70));
    } else {
      const room = H - 210 - y, rowH = 68, n = Math.min(tracks.length, Math.floor(room / rowH));
      for (let i = 0; i < n; i++) {
        const t = tracks[i], ry = y + i * rowH + rowH / 2, more = i === n - 1 && tracks.length > n;
        g.textBaseline = 'middle'; g.font = '500 28px "IBM Plex Mono"';
        if (more) { g.fillStyle = SUB; g.fillText(`+ ${tracks.length - n + 1} MORE TRACKS`, 80, ry); break; }
        g.fillStyle = G1; g.fillText(String(i + 1).padStart(2, '0'), 80, ry);
        g.fillStyle = INK; g.font = '700 36px "Zen Kaku Gothic New"';
        const name = this.fit(g, t.name, 560); g.fillText(name, 150, ry);
        const nw = g.measureText(name).width;
        g.fillStyle = SUB; g.font = '500 28px "Zen Kaku Gothic New"';
        g.fillText(this.fit(g, t.artist, W - 80 - (150 + nw + 24)), 150 + nw + 24, ry + 2);
        g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(80, y + (i + 1) * rowH - 1, W - 160, 2);
      }
    }

    // footer
    g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(80, H - 150, W - 160, 2);
    g.font = '500 26px "IBM Plex Mono"'; g.textBaseline = 'middle'; g.fillStyle = SUB;
    g.fillText(this.fit(g, url.replace(/^https?:\/\//, ''), W - 260), 80, H - 96);
    g.fillStyle = grad(W - 128, H - 120, W - 80, H - 72); g.beginPath(); g.arc(W - 104, H - 96, 24, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(W - 104, H - 96, 5, 0, Math.PI * 2); g.fill();
    return new Promise((res) => c.toBlob(res, 'image/png'));
  },

  async open(p, tracks, url, song = null) {
    const m = document.getElementById('modal');
    m.innerHTML = `<div class="modal-card"><div class="loading"><span class="spinner"></span> 画像を作っています…</div></div>`;
    m.hidden = false; document.body.classList.add('modal-open');
    let blob;
    try { blob = await this.make(p, tracks, url, song); } catch (e) { console.error(e); }
    if (!blob) { m.innerHTML = `<div class="modal-card stack"><b>画像を作れませんでした</b><button class="btn" data-act="modal-close">閉じる</button></div>`; return; }
    const src = URL.createObjectURL(blob);
    const file = new File([blob], `${p.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'playlist'}.png`, { type: 'image/png' });
    this.file = file;
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    m.innerHTML = `<div class="modal-card">
      <div class="row" style="margin-bottom:12px"><b class="spacer">シェア用画像</b><button class="btn quiet sm" data-act="modal-close" aria-label="閉じる">${ICON.close}</button></div>
      <img class="share-preview" src="${src}" alt="シェア用画像">
      <div class="row wrap-ok" style="margin-top:14px">
        ${canShare ? `<button class="btn solid" data-act="img-share">${ICON.send}シェア</button>` : ''}
        <a class="btn ${canShare ? '' : 'solid'}" href="${src}" download="${esc(file.name)}">画像を保存</a>
      </div>
      <div class="hint">インスタのストーリーズにぴったりのサイズ（1080×1920）です。うまく保存できないときは、画像を長押しして保存してください。</div>
    </div>`;
  },
  close() { const m = document.getElementById('modal'); m.hidden = true; m.innerHTML = ''; document.body.classList.remove('modal-open'); },
  async share() { try { await navigator.share({ files: [this.file] }); } catch { /* cancelled */ } },
};

/* =========================================================
 * Recently viewed playlists (this browser only)
 * ======================================================= */
/** Viewing history: playlists ("p") and recommended songs ("s"), newest first, kept in this browser */
const Recent = {
  list() { return store.get('recent', []).map((x) => ({ kind: 'p', ...x })); },
  add(p, kind = 'p') {
    const l = this.list().filter((x) => !(x.id === p.id && x.kind === kind));
    l.unshift({ kind, id: p.id, title: p.title, owner: p.owner, image: p.image, at: Date.now() });
    store.set('recent', l.slice(0, 20));
  },
  remove(id) { store.set('recent', this.list().filter((x) => x.id !== id)); },
  html() {
    const l = this.list(); if (!l.length) return '';
    return `<div class="hist">${l.map((x) => {
      const to = x.kind === 's' ? `/s/${x.id}` : `/p/${x.id}`;
      return `<button class="hrow" data-act="go" data-to="${esc(to)}">
        <span class="hthumb ${x.kind === 's' ? 'wide' : ''}">${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy">` : ''}</span>
        <span class="htext"><b>${esc(x.title)}</b><span>${x.kind === 's' ? '曲' : 'プレイリスト'} ・ ${esc(x.owner || '')}</span></span></button>`;
    }).join('')}</div>`;
  },
};

/* =========================================================
 * PWA (home screen app)
 * ======================================================= */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

/* =========================================================
 * Theme (light / dark / system) and colour palettes
 * ======================================================= */
const Theme = {
  palettes: [
    { id: 'dusk', name: '夕暮れ', g1: '#D9668C', g2: '#8572D6' },
    { id: 'ocean', name: '海', g1: '#4E9FCC', g2: '#5967C8' },
    { id: 'forest', name: '森', g1: '#55B286', g2: '#3C8A97' },
    { id: 'sunset', name: '夕焼け', g1: '#E08A63', g2: '#C95A79' },
    { id: 'sakura', name: '桜', g1: '#E39AB3', g2: '#B28AD0' },
    { id: 'mono', name: 'モノクロ', g1: '#D6D6DE', g2: '#8D8DA0' },
  ],
  get palette() { const v = store.get('palette', 'dusk'); return this.palettes.some((p) => p.id === v) ? v : 'dusk'; },
  current() { return this.palettes.find((p) => p.id === this.palette) || this.palettes[0]; },
  isDark() { return true; },
  apply() {
    const d = document.documentElement;
    d.dataset.theme = 'dark'; d.dataset.palette = this.palette;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.setAttribute('content', '#0F0F12'); m.removeAttribute('media'); });
  },
  set(kind, value) {
    store.set(kind, value); this.apply();
    if (!document.getElementById('modal').hidden) this.open();
    else document.querySelectorAll('[data-theme-panel]').forEach((el) => { el.innerHTML = this.body(); });
  },
  open() {
    const m = document.getElementById('modal');
    m.innerHTML = `<div class="modal-card" role="dialog" aria-label="配色">
      <div class="row" style="margin-bottom:14px"><b class="spacer display" style="font-size:20px">配色</b><button class="btn quiet sm" data-act="modal-close" aria-label="閉じる">${ICON.close}</button></div>
      ${this.body()}
    </div>`;
    m.hidden = false; document.body.classList.add('modal-open');
  },
  body() {
    return `<div class="pals">${this.palettes.map((p) => `<button class="pal ${this.palette === p.id ? 'on' : ''}" data-act="palette" data-v="${p.id}" aria-pressed="${this.palette === p.id}">
        <i style="background:linear-gradient(135deg, ${p.g1}, ${p.g2})"></i><b>${p.name}</b></button>`).join('')}</div>
      <div class="hint">ボタンや文字のグラデーションの色が変わります。この端末での表示だけが変わります。</div>`;
  },
};

/* =========================================================
 * Custom cover images (stored by the app, see netlify/functions/cover.mjs)
 * ======================================================= */
const Cover = {
  async version(id) {
    try { const r = await fetch('/api/cover-info?id=' + encodeURIComponent(id)); if (!r.ok) return null; return (await r.json()).v || null; } catch { return null; }
  },
  url: (id, v) => `/api/cover?id=${encodeURIComponent(id)}&v=${v}`,
  /** YouTube sometimes returns the playlist's own custom image (not a video frame): prefer it */
  pick(thumbs) {
    const list = Object.values(thumbs || {}).filter((x) => x?.url);
    const custom = list.filter((x) => !x.url.includes('/vi/')).sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    return custom?.url || null;
  },

  // ---- editor ----
  S: 560, img: null, zoom: 1, x: 0, y: 0,
  open(p, hasCustom, onDone) {
    this.p = p; this.onDone = onDone; this.img = null; this.zoom = 1; this.x = 0; this.y = 0;
    const m = document.getElementById('modal');
    m.innerHTML = `<div class="modal-card" role="dialog" aria-label="カバー画像の編集">
      <div class="row" style="margin-bottom:12px"><b class="spacer display" style="font-size:20px">カバー画像</b><button class="btn quiet sm" data-act="modal-close" aria-label="閉じる">${ICON.close}</button></div>
      <div class="cover-stage"><canvas id="cv" width="${this.S}" height="${this.S}"></canvas>
        <div class="cover-empty" id="cv-empty">${p.image ? `<img src="${esc(p.image)}" alt="">` : ''}<span>画像を選んでください</span></div></div>
      <label class="zoomrow" id="cv-zoomrow" hidden><span>拡大</span><input type="range" id="cv-zoom" min="1" max="3" step="0.01" value="1"></label>
      <div class="hint" id="cv-hint">正方形に切り抜かれます。選んだあと、ドラッグで位置を調整できます。</div>
      <input type="file" id="cv-file" accept="image/*" hidden>
      <div class="row wrap-ok" style="margin-top:14px">
        <button class="btn" data-act="cover-pick">画像を選ぶ</button>
        <button class="btn accent" data-act="cover-save" id="cv-save" disabled>保存</button>
        ${hasCustom ? '<button class="btn quiet" data-act="cover-reset">YouTubeの画像に戻す</button>' : ''}
      </div>
    </div>`;
    m.hidden = false; document.body.classList.add('modal-open');
    const file = document.getElementById('cv-file');
    file.addEventListener('change', () => file.files[0] && this.load(file.files[0]));
    const cv = document.getElementById('cv');
    let drag = null;
    cv.addEventListener('pointerdown', (e) => { if (!this.img) return; drag = { x: e.clientX, y: e.clientY, ox: this.x, oy: this.y }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const k = this.S / cv.getBoundingClientRect().width;
      this.x = drag.ox + (e.clientX - drag.x) * k; this.y = drag.oy + (e.clientY - drag.y) * k; this.draw();
    });
    cv.addEventListener('pointerup', () => { drag = null; });
    document.getElementById('cv-zoom').addEventListener('input', (e) => { this.zoom = +e.target.value; this.draw(); });
  },
  pickFile() { document.getElementById('cv-file')?.click(); },
  async load(f) {
    if (!/^image\//.test(f.type)) return toast('画像ファイルを選んでください');
    const img = new Image(); img.src = URL.createObjectURL(f);
    try { await img.decode(); } catch { return toast('この画像は読み込めませんでした'); }
    this.img = img; this.zoom = 1; this.x = 0; this.y = 0;
    document.getElementById('cv-zoom').value = 1;
    document.getElementById('cv-zoomrow').hidden = false;
    document.getElementById('cv-empty').hidden = true;
    document.getElementById('cv-save').disabled = false;
    this.draw();
  },
  geom(size) {
    const img = this.img, base = Math.max(size / img.naturalWidth, size / img.naturalHeight) * this.zoom;
    const w = img.naturalWidth * base, h = img.naturalHeight * base, k = size / this.S;
    // keep the square fully covered
    const mx = (w - size) / 2, my = (h - size) / 2;
    this.x = Math.max(-mx / k, Math.min(mx / k, this.x)); this.y = Math.max(-my / k, Math.min(my / k, this.y));
    return { w, h, dx: (size - w) / 2 + this.x * k, dy: (size - h) / 2 + this.y * k };
  },
  draw() {
    const cv = document.getElementById('cv'); if (!cv || !this.img) return;
    const g = cv.getContext('2d'), q = this.geom(this.S);
    g.clearRect(0, 0, this.S, this.S); g.drawImage(this.img, q.dx, q.dy, q.w, q.h);
  },
  async save(btn) {
    if (!this.img) return;
    const out = document.createElement('canvas'); out.width = out.height = 1200;
    const q = this.geom(1200); out.getContext('2d').drawImage(this.img, q.dx, q.dy, q.w, q.h);
    const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.88));
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 保存中…';
    try {
      const r = await fetch('/api/cover?id=' + encodeURIComponent(this.p.id), { method: 'POST', headers: { Authorization: 'Bearer ' + await Api.accessToken(), 'Content-Type': 'image/jpeg' }, body: blob });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || '保存できませんでした');
      toast('カバー画像を保存しました'); ShareImage.close(); this.onDone?.(j.v);
    } catch (e) { toast(e.message, 5000); btn.disabled = false; btn.textContent = '保存'; }
  },
  async reset() {
    try {
      const r = await fetch('/api/cover?id=' + encodeURIComponent(this.p.id), { method: 'DELETE', headers: { Authorization: 'Bearer ' + await Api.accessToken() } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '戻せませんでした');
      toast('YouTubeの画像に戻しました'); ShareImage.close(); this.onDone?.(null);
    } catch (e) { toast(e.message, 5000); }
  },
};

/* =========================================================
 * Community: public gallery + bookmarks (see netlify/functions/gallery.mjs)
 * ======================================================= */
const Social = {
  gallery: null, bms: null,
  async headers() { const a = await Api.accessToken(); return a ? { Authorization: 'Bearer ' + a } : null; },
  async loadGallery(force) {
    if (this.gallery && !force) return this.gallery;
    try { const r = await fetch('/api/gallery'); this.gallery = r.ok ? (await r.json()).items || [] : []; } catch { this.gallery = []; }
    return this.gallery;
  },
  sbms: null, // bookmarked recommended songs
  async loadBookmarks(force, kind = 'p') {
    const prop = kind === 'p' ? 'bms' : 'sbms'; // songs of both kinds (recommended "s", playlist songs "t") share one list
    const h = await this.headers(); if (!h) { this[prop] = null; return null; }
    if (this[prop] && !force) return this[prop];
    try { const r = await fetch('/api/bookmarks' + (kind === 'p' ? '' : '?kind=s'), { headers: h }); this[prop] = r.ok ? (await r.json()).items || [] : []; } catch { this[prop] = []; }
    return this[prop];
  },
  isBm(id, kind = 'p') { const key = kind === 't' ? 't:' + id : id; return !!this[kind === 'p' ? 'bms' : 'sbms']?.some((x) => x.id === key); },
  /** p: a playlist { id, title, owner, image }; kind 's': a recommended song { sid, … }; kind 't': a playlist song { id (video), name, artist, thumb, d, pid, ptitle } */
  async toggleBm(p, kind = 'p') {
    const prop = kind === 'p' ? 'bms' : 'sbms', id = kind === 's' ? p.sid : p.id;
    const h = await this.headers(); if (!h) throw new AuthError('ログインするとブックマークできます');
    if (!this[prop]) await this.loadBookmarks(false, kind);
    const on = this.isBm(id, kind);
    const body = kind === 's' ? { title: p.title, artist: p.artist, by: p.by, image: p.art || p.thumb }
      : kind === 't' ? { title: p.name, artist: p.artist, image: p.thumb, pid: p.pid, ptitle: p.ptitle, d: p.d }
        : { title: p.title, owner: p.owner, ownerId: p.ownerId, image: p.image };
    const r = await fetch('/api/bookmarks?id=' + encodeURIComponent(id) + (kind === 'p' ? '' : '&kind=' + kind), {
      method: on ? 'DELETE' : 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: on ? undefined : JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { store.del('token'); throw new AuthError(j.error); }
    if (!r.ok) throw new Error(j.error || 'ブックマークできませんでした');
    this[prop] = j.items;
    if (kind === 'p' && this.gallery) this.gallery = this.gallery.map((x) => (x.id === p.id ? { ...x, bm: j.bm } : x));
    return { on: !on, bm: j.bm };
  },
  async status(id) { try { const r = await fetch('/api/gallery-status?id=' + encodeURIComponent(id)); return r.ok ? await r.json() : {}; } catch { return {}; } },
  async setListed(id, on, look) {
    const h = await this.headers(); if (!h) throw new AuthError('ログインしてください');
    const r = await fetch(`/api/gallery?id=${encodeURIComponent(id)}`, { method: on ? 'POST' : 'DELETE', headers: h });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '変更できませんでした');
    this.gallery = null;
    return j.listed;
  },
  card(p, { bm = true, owner = true } = {}) {
    const to = `/p/${p.id}`;
    const by = !owner ? '' : Avatars.chip(p.ownerId, p.owner);
    const listed = p.likes != null; // gallery items carry like counts; bookmarks don't
    return `<div class="plcard"><button class="pl" data-act="go" data-to="${esc(to)}">
      <div class="cover">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : jcard(p.title)}${genresOf(p).length ? `<span class="gtag oncover">${esc(genresOf(p).map(genreName).join('・'))}</span>` : ''}</div>
      <div class="name">${esc(p.title)}</div></button>
      <div class="meta">${by}${p.count != null && bm ? `<span class="cnt">${String(p.count).padStart(2, '0')} TRACKS</span>` : ''}</div>
      ${listed ? `<div class="cardfoot">${Likes.btn('p', p.id, p.likes, 'sm')}${p.comments ? `<span class="ccount" title="コメント ${p.comments}件">${ICON.comment}${p.comments}</span>` : ''}</div>` : ''}</div>`;
  },
  /** search + sort for the public gallery */
  filter(items, { genre, sort, q } = {}) {
    const k = (q || '').normalize('NFKC').toLowerCase().trim();
    const out = items.filter((x) => (!genre || genresOf(x).includes(genre)) && (!k || `${x.title} ${x.owner}`.normalize('NFKC').toLowerCase().includes(k)));
    if (sort === 'new') out.sort((a, b) => (b.at || 0) - (a.at || 0));
    else out.sort((a, b) => (b.likes || 0) - (a.likes || 0) || (b.at || 0) - (a.at || 0));
    return out;
  },
  async publish(id, body) {
    const h = await this.headers(); if (!h) throw new AuthError('ログインしてください');
    const r = await fetch(`/api/gallery?id=${encodeURIComponent(id)}`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '共有できませんでした');
    this.gallery = null; return true;
  },
  grid(items, empty, opts) { return items.length ? `<div class="plgrid">${items.map((x) => this.card(x, opts)).join('')}</div>` : `<div class="sheet flat center muted small">${empty}</div>`; },
};

/* =========================================================
 * Touch feedback: a soft ripple where you press, and a tiny vibration on Android
 * ======================================================= */
(() => {
  const SEL = '.btn, .ibtn, .playbig, .choice, .tabbar a, .seg button, .sortsw button, .gchip, .qplay, .pbtn, .trk-rec, .nrow, .gtile, .pal, .iconbtn';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(SEL); if (!el || el.disabled || reduce.matches) return;
    const r = el.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2.2;
    const w = document.createElement('span'); w.className = 'ripple';
    w.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.classList.add('has-ripple'); el.appendChild(w);
    setTimeout(() => w.remove(), 650);
  }, { passive: true });
  document.addEventListener('click', (e) => {
    const el = e.target.closest('.likebtn, .bmbtn, .tabbar a, .playbig, .followbtn');
    if (el && navigator.vibrate) try { navigator.vibrate(8); } catch { /* ignore */ }
  }, { passive: true });
})();

