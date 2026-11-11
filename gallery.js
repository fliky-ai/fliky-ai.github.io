// gallery.js — своя «Галерея» внутри Dicegram (как в Telegram), вместо системного окна выбора:
//   • сверху: «назад», заголовок «Галерея ▾» (альбомы), меню ⋮;
//   • сетка 3 колонки без промежутков, заголовки «Месяц Год», у видео — длительность, у выбранных — номер выбора;
//   • первая клетка — камера (снимок сразу попадает в выбор), полноэкранный просмотр с листанием, подпись и «Отправить»;
//   • источники: фото и видео из ваших чатов (повторная отправка — мгновенно, без новой загрузки), снимки камеры,
//     а если в APK есть модуль доступа к медиатеке (Capacitor Media / MediaStore) — все фото и видео телефона.
//     Без такого модуля браузерная оболочка (WebView) не может сама перечислить файлы телефона — тогда «С телефона» в меню.
const GAL_I = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m7 10 5 5 5-5"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/><path d="M12 7v6M9 10h6"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z"/></svg>',
  vid: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
};

const Gallery = {
  el: null, items: [], byId: {}, sel: [], album: "all", type: "all", next: 0, more: false, loading: false, peers: {}, native: null, nAlbums: [],
  MAX: 20,

  // opts: { title, onSend(list, caption) } — list: [{ file } | { att }] в порядке выбора
  open(opts = {}) {
    if (Gallery.el) Gallery.close();
    Gallery.opts = opts;
    Object.assign(Gallery, { items: [], byId: {}, sel: [], album: "all", type: opts.single ? "image" : "all", next: 0, more: false, loading: false, peers: {} });
    Gallery.MAX = opts.single ? 1 : 20;                       // single — выбор одного фото (аватар и т.п.): без подписи, только фото
    // то, что уже выбирали с телефона в этот раз, — остаётся наверху
    (Gallery.devCache || []).forEach((it) => Gallery.add(it));
    const el = (Gallery.el = document.createElement("div"));
    el.className = "gal" + (opts.single ? " single" : "");
    el.innerHTML = `<div class="gal-top"><button class="gal-b" data-g="x" aria-label="${esc(T("Назад"))}">${GAL_I.back}</button>
        <button class="gal-ttl" data-g="alb"><b>${esc(opts.title || T("Галерея"))}</b>${GAL_I.down}</button><button class="gal-b" data-g="menu" aria-label="${esc(T("Ещё"))}">${GAL_I.dots}</button></div>
      <div class="gal-albs" hidden></div>
      <div class="gal-body"><div class="gal-grid"></div><div class="gal-more"></div></div>
      <div class="gal-bar"><input class="gal-cap" placeholder="${esc(T("Добавить подпись…"))}" maxlength="1024" autocomplete="off"><button class="gal-send" data-g="send" aria-label="${esc(T("Отправить"))}">${GAL_I.send}<i class="gal-n">0</i></button></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    Gallery.release = Nav.layer(() => Gallery.hide());
    el.addEventListener("click", (e) => Gallery.click(e));
    Gallery.draw();
    Gallery.io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) Gallery.load(); }), { root: el.querySelector(".gal-body"), rootMargin: "600px 0px" });
    Gallery.io.observe(el.querySelector(".gal-more"));
    Gallery.vio = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { const v = en.target; if (!v.src && v.dataset.src) v.src = v.dataset.src; Gallery.vio.unobserve(v); } }), { root: el.querySelector(".gal-body"), rootMargin: "300px 0px" });
    Gallery.loadNative().then(() => Gallery.load());
  },
  close() { if (Gallery.release) Gallery.release(); else Gallery.hide(); },
  hide() {
    const el = Gallery.el; if (!el) return;
    Gallery.el = null; Gallery.release = null;
    try { Gallery.io.disconnect(); Gallery.vio.disconnect(); } catch (e) {}
    el.classList.remove("show"); setTimeout(() => el.remove(), 220);
  },

  add(it) {
    if (Gallery.byId[it.id]) return Gallery.byId[it.id];
    Gallery.byId[it.id] = it; Gallery.items.push(it);
    return it;
  },

  // ───────── источники ─────────
  async load() {
    if (Gallery.loading || !Gallery.el) return;
    if (Gallery.next === -1) return;
    Gallery.loading = true; Gallery.paintMore();
    try {
      const d = await api("/api/gallery?limit=150" + (Gallery.next ? "&before=" + Gallery.next : ""));
      Object.assign(Gallery.peers, d.peers || {});
      (d.items || []).forEach((x) => {
        const a = x.att || {}, vid = /^video\//.test(a.mime || "");
        Gallery.add({ id: "c" + a.fid, src: "chat", type: vid ? "video" : "image", ts: x.ts, dur: a.dur ? a.dur / 1000 : 0, album: "p" + x.peer,
          thumb: fileUrl(a.turl || a.url), full: fileUrl(a.url), att: a, w: a.w, h: a.h });
      });
      Gallery.next = d.more ? d.next : -1;
    } catch (e) { if (!Gallery.items.length) toast(e.message); Gallery.next = -1; }
    Gallery.loading = false;
    if (Gallery.el) { Gallery.draw(); Gallery.paintMore(); }
  },
  // модуль медиатеки в APK (Capacitor Media → Android MediaStore)
  nativeApi() {
    try { const m = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Media; return m && typeof m.getMedias === "function" ? m : null; } catch (e) { return null; }
  },
  async loadNative() {
    const M = Gallery.nativeApi(); if (!M) return;
    try {
      if (typeof M.getAlbums === "function") { const r = await M.getAlbums(); Gallery.nAlbums = (r && r.albums) || []; }
      const r = await M.getMedias({ quantity: 400, thumbnailWidth: 320, thumbnailHeight: 320, thumbnailQuality: 75, types: "all", sort: [{ key: "creationDate", ascending: false }] });
      ((r && r.medias) || []).forEach((m, i) => {
        const id = "n" + (m.identifier || i);
        const ts = m.creationDate ? Math.floor(new Date(m.creationDate).getTime() / 1000) : 0;
        Gallery.add({ id, src: "native", type: m.duration ? "video" : "image", ts, dur: m.duration || 0, album: m.albumIdentifier ? "n" + m.albumIdentifier : "dev",
          thumb: m.data ? (/^data:/.test(m.data) ? m.data : "data:image/jpeg;base64," + m.data) : "", nid: m.identifier, w: m.fullWidth, h: m.fullHeight });
      });
      Gallery.native = M;
    } catch (e) { Gallery.native = null; }
  },
  async nativeFile(it) {
    try {
      const r = await Gallery.native.getMediaByIdentifier({ identifier: it.nid });
      const path = r && (r.path || r.webPath || r.uri);
      const url = window.Capacitor && Capacitor.convertFileSrc ? Capacitor.convertFileSrc(path) : path;
      const b = await (await fetch(url)).blob();
      return new File([b], (path || "media").split("/").pop() || (it.type === "video" ? "video.mp4" : "photo.jpg"), { type: b.type || (it.type === "video" ? "video/mp4" : "image/jpeg") });
    } catch (e) { return null; }
  },
  // свои файлы с телефона (системный выбор — только по кнопке, если нет модуля медиатеки)
  async fromPhone() {
    const files = (await Attach.pick("image/*,video/*")).filter((f) => /^(image|video)\//.test(f.type));
    if (!files.length || !Gallery.el) return;
    Gallery.devCache = Gallery.devCache || [];
    for (const f of files) {
      const it = Gallery.fileItem(f, "dev");
      Gallery.devCache.unshift(it);
      Gallery.add(it);
      if (Gallery.MAX === 1) Gallery.sel = [it.id];
      else if (Gallery.sel.length < Gallery.MAX && !Gallery.sel.includes(it.id)) Gallery.sel.push(it.id);
    }
    Gallery.devCache = Gallery.devCache.slice(0, 60);
    Gallery.draw();
  },
  fileItem(f, src) {
    const vid = /^video\//.test(f.type), url = URL.createObjectURL(f);
    const it = { id: src + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), src, type: vid ? "video" : "image", ts: Math.floor((f.lastModified || Date.now()) / 1000), dur: 0, album: "dev", thumb: url, full: url, file: f };
    if (vid) {
      const v = document.createElement("video");
      v.preload = "metadata"; v.muted = true; v.src = url;
      v.onloadedmetadata = () => { it.dur = isFinite(v.duration) ? v.duration : 0; it.w = v.videoWidth; it.h = v.videoHeight; if (Gallery.el) Gallery.paintCell(it); };
    }
    return it;
  },
  shot() {
    Camera.open((f) => {
      if (!Gallery.el || !f) return;
      const it = Gallery.fileItem(f, "cam");
      Gallery.devCache = [it].concat(Gallery.devCache || []).slice(0, 60);
      Gallery.add(it);
      if (Gallery.MAX === 1) Gallery.sel = [it.id]; else if (Gallery.sel.length < Gallery.MAX) Gallery.sel.push(it.id);
      Gallery.album = "all"; Gallery.draw();
      haptic("medium");
    });
  },

  // ───────── альбомы ─────────
  albums() {
    const cnt = {}, cover = {};
    const vis = Gallery.items;
    vis.forEach((it) => { cnt[it.album] = (cnt[it.album] || 0) + 1; if (!cover[it.album]) cover[it.album] = it; });
    const out = [{ k: "all", t: T("Все медиа"), n: vis.length, c: vis[0] }];
    const ph = vis.filter((x) => x.type === "image"), vd = vis.filter((x) => x.type === "video");
    if (ph.length) out.push({ k: "photo", t: T("Фото"), n: ph.length, c: ph[0] });
    if (vd.length) out.push({ k: "video", t: T("Видео"), n: vd.length, c: vd[0] });
    if (cnt.dev) out.push({ k: "dev", t: Gallery.native ? T("Телефон") : T("С телефона и камеры"), n: cnt.dev, c: cover.dev });
    Gallery.nAlbums.forEach((a) => { const k = "n" + a.identifier; if (cnt[k]) out.push({ k, t: a.name || T("Альбом"), n: cnt[k], c: cover[k] }); });
    Object.keys(cnt).filter((k) => k[0] === "p").sort((a, b) => cnt[b] - cnt[a]).forEach((k) => out.push({ k, t: Gallery.peers[k.slice(1)] || T("Чат"), n: cnt[k], c: cover[k], chat: 1 }));
    return out;
  },
  albumName() { if (Gallery.album === "all") return T("Галерея"); const a = Gallery.albums().find((x) => x.k === Gallery.album); return a ? a.t : T("Галерея"); },
  shown() {
    const A = Gallery.album;
    let l = Gallery.items.filter((it) => A === "all" || (A === "photo" ? it.type === "image" : A === "video" ? it.type === "video" : it.album === A));
    if (Gallery.type !== "all") l = l.filter((it) => it.type === Gallery.type);
    // свежие снимки камеры и выбранные с телефона — первыми, дальше по дате
    return l.sort((a, b) => (b.src === "cam" || b.src === "dev" ? 1 : 0) - (a.src === "cam" || a.src === "dev" ? 1 : 0) || b.ts - a.ts);
  },
  toggleAlbums(show) {
    const box = Gallery.el.querySelector(".gal-albs");
    const on = show === undefined ? box.hidden : show;
    box.hidden = !on;
    Gallery.el.classList.toggle("albs-on", on);
    if (!on) return;
    box.innerHTML = Gallery.albums().map((a) => `<button class="gal-al${a.k === Gallery.album ? " on" : ""}" data-al="${esc(a.k)}"><span class="gal-alc">${a.c ? Gallery.thumbHTML(a.c, { eager: 1 }) : ""}</span>` +
      `<span class="gal-alt"><b>${esc(a.t)}</b><small>${a.n} ${esc(plural(a.n, T("файл"), T("файла"), T("файлов")))}${a.chat ? " · " + esc(T("из чата")) : ""}</small></span></button>`).join("");
  },

  // ───────── отрисовка ─────────
  fmtDur(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); },
  thumbHTML(it, opts) {
    if (!it.thumb) return "";
    if (it.type === "video" && it.src === "chat" && !it.att.turl) return `<video muted playsinline preload="metadata" ${opts && opts.eager ? "src" : "data-src"}="${esc(it.full)}#t=0.5"></video>`;
    if (it.type === "video" && (it.src === "dev" || it.src === "cam")) return `<video muted playsinline preload="metadata" src="${esc(it.full)}#t=0.5"></video>`;
    return `<img src="${esc(it.thumb)}" alt="" loading="lazy" decoding="async" draggable="false">`;
  },
  cellHTML(it) {
    const n = Gallery.sel.indexOf(it.id) + 1;
    return `<div class="gal-c${n ? " sel" : ""}" data-i="${esc(it.id)}">${Gallery.thumbHTML(it)}${it.type === "video" ? `<span class="gal-dur">${GAL_I.vid}${it.dur ? Gallery.fmtDur(it.dur) : ""}</span>` : ""}` +
      `<button class="gal-ck" data-ck="${esc(it.id)}" aria-label="${esc(T("Выбрать"))}"><i>${n || ""}</i></button></div>`;
  },
  monthName(ts) {
    const d = new Date(ts * 1000);
    let s = d.toLocaleDateString(I18N.loc, { month: "long", year: "numeric" }).replace(/\s*г\.?$/, "");
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
  draw() {
    const el = Gallery.el; if (!el) return;
    el.querySelector(".gal-ttl b").textContent = Gallery.albumName();
    const grid = el.querySelector(".gal-grid"), list = Gallery.shown();
    let h = `<div class="gal-c gal-cam" data-g="cam"><span>${GAL_I.cam}</span><small>${esc(T("Камера"))}</small></div>`;
    if (!Gallery.native) h += `<div class="gal-c gal-dev" data-g="phone"><span>${GAL_I.phone}</span><small>${esc(T("С телефона"))}</small></div>`;
    let mon = "";
    const fresh = list.filter((it) => it.src === "cam" || it.src === "dev"), rest = list.filter((it) => !(it.src === "cam" || it.src === "dev"));
    fresh.forEach((it) => { h += Gallery.cellHTML(it); });
    rest.forEach((it) => {
      const m = Gallery.monthName(it.ts);
      if (m !== mon) { mon = m; h += `<div class="gal-mh">${esc(m)}</div>`; }
      h += Gallery.cellHTML(it);
    });
    if (!list.length && !Gallery.loading && Gallery.next === -1) h += `<div class="gal-empty">${esc(Gallery.native ? T("Здесь пока нет фото и видео") : T("Здесь будут фото и видео из ваших чатов и снимки камеры. Фото с телефона — кнопка «С телефона»."))}</div>`;
    grid.innerHTML = h;
    grid.querySelectorAll("video[data-src]").forEach((v) => Gallery.vio.observe(v));
    Gallery.paintBar();
  },
  paintCell(it) {
    const c = Gallery.el && Gallery.el.querySelector(`.gal-c[data-i="${CSS.escape(it.id)}"]`);
    if (c) c.outerHTML = Gallery.cellHTML(it);
  },
  paintSel() {
    if (!Gallery.el) return;
    Gallery.el.querySelectorAll(".gal-c[data-i]").forEach((c) => {
      const n = Gallery.sel.indexOf(c.dataset.i) + 1;
      c.classList.toggle("sel", !!n);
      c.querySelector(".gal-ck i").textContent = n || "";
    });
    Gallery.paintBar();
    if (Gallery.pv) Gallery.pvPaint();
  },
  paintBar() {
    const el = Gallery.el; if (!el) return;
    const n = Gallery.sel.length;
    el.classList.toggle("has-sel", n > 0);
    el.querySelector(".gal-n").textContent = n;
  },
  paintMore() {
    const m = Gallery.el && Gallery.el.querySelector(".gal-more"); if (!m) return;
    m.innerHTML = Gallery.loading ? '<i class="fv-spin"></i>' : "";
  },

  toggle(id) {
    const i = Gallery.sel.indexOf(id);
    if (i >= 0) Gallery.sel.splice(i, 1);
    else if (Gallery.MAX === 1) { Gallery.sel = [id]; Gallery.draw(); }          // одиночный выбор: новый заменяет прежний
    else {
      if (Gallery.sel.length >= Gallery.MAX) return toast(T("Можно выбрать не больше {0}", Gallery.MAX));
      Gallery.sel.push(id);
    }
    haptic("light");
    Gallery.paintSel();
  },

  click(e) {
    const t = e.target;
    const g = t.closest("[data-g]"), ck = t.closest("[data-ck]"), al = t.closest("[data-al]"), c = t.closest(".gal-c[data-i]");
    if (al) { Gallery.album = al.dataset.al; Gallery.toggleAlbums(false); Gallery.draw(); Gallery.el.querySelector(".gal-body").scrollTop = 0; return; }
    if (ck) return Gallery.toggle(ck.dataset.ck);
    if (g) {
      const k = g.dataset.g;
      if (k === "x") return Gallery.el.classList.contains("albs-on") ? Gallery.toggleAlbums(false) : Gallery.close();
      if (k === "alb") return Gallery.toggleAlbums();
      if (k === "menu") return Gallery.menu();
      if (k === "cam") return Gallery.shot();
      if (k === "phone") return Gallery.fromPhone();
      if (k === "send") return Gallery.send();
    }
    if (c) return Gallery.preview(c.dataset.i);
  },
  async menu() {
    const mark = (k) => (Gallery.type === k ? "  ✓" : "");
    const acts = [{ label: T("Выбрать с телефона"), value: "phone" }, { label: T("Все файлы") + mark("all"), value: "t:all" }, { label: T("Только фото") + mark("image"), value: "t:image" }, { label: T("Только видео") + mark("video"), value: "t:video" }];
    if (Gallery.sel.length) acts.push({ label: T("Снять выбор"), value: "clear" });
    const v = await UI.sheet({ title: T("Галерея"), actions: acts });
    if (!v || !Gallery.el) return;
    if (v === "phone") return Gallery.fromPhone();
    if (v === "clear") { Gallery.sel = []; return Gallery.paintSel(); }
    if (v.startsWith("t:")) { Gallery.type = v.slice(2); Gallery.draw(); }
  },

  // ───────── полноэкранный просмотр ─────────
  preview(id) {
    const list = Gallery.shown();
    let i = list.findIndex((x) => x.id === id);
    if (i < 0) return;
    const el = document.createElement("div");
    el.className = "gal-pv";
    el.innerHTML = `<div class="gal-pt"><button class="gal-b" data-p="x" aria-label="${esc(T("Назад"))}">${GAL_I.back}</button><span class="gal-pc"></span>` +
      `<button class="gal-ck big" data-p="ck" aria-label="${esc(T("Выбрать"))}"><i></i></button></div><div class="gal-ps"></div>`;
    Gallery.el.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    const pv = (Gallery.pv = { el, list, i });
    const rel = Nav.layer(() => { Gallery.pv = null; el.classList.remove("show"); setTimeout(() => el.remove(), 200); });
    pv.close = rel;
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-p]"); if (!b) return;
      if (b.dataset.p === "x") return rel();
      if (b.dataset.p === "ck") return Gallery.toggle(pv.list[pv.i].id);
      if (b.dataset.p === "l") return Gallery.pvGo(-1);
      if (b.dataset.p === "r") return Gallery.pvGo(1);
    });
    // листание пальцем
    const st = el.querySelector(".gal-ps");
    let x0 = null, dx = 0;
    st.addEventListener("pointerdown", (e) => { if (e.target.closest("video")) return; x0 = e.clientX; dx = 0; });
    st.addEventListener("pointermove", (e) => { if (x0 === null) return; dx = e.clientX - x0; const m = st.querySelector(".gal-pm"); if (m) m.style.transform = `translateX(${dx}px)`; });
    const up = () => { if (x0 === null) return; x0 = null; const m = st.querySelector(".gal-pm"); if (Math.abs(dx) > 60) Gallery.pvGo(dx < 0 ? 1 : -1); else if (m) { m.style.transition = "transform .2s"; m.style.transform = ""; } };
    st.addEventListener("pointerup", up); st.addEventListener("pointercancel", up);
    Gallery.pvShow();
  },
  pvGo(d) {
    const pv = Gallery.pv; if (!pv) return;
    const j = pv.i + d;
    if (j < 0 || j >= pv.list.length) { const m = pv.el.querySelector(".gal-pm"); if (m) { m.style.transition = "transform .2s"; m.style.transform = ""; } return; }
    pv.i = j; Gallery.pvShow();
  },
  pvShow() {
    const pv = Gallery.pv; if (!pv) return;
    const it = pv.list[pv.i], st = pv.el.querySelector(".gal-ps");
    const src = it.src === "native" ? it.thumb : it.full;
    st.innerHTML = `<button class="gal-pa l" data-p="l" aria-label="${esc(T("Назад"))}">${GAL_I.back}</button>` +
      (it.type === "video" && it.src !== "native" ? `<video class="gal-pm" src="${esc(src)}" controls autoplay playsinline></video>` : `<img class="gal-pm" src="${esc(src)}" alt="" draggable="false">`) +
      `<button class="gal-pa r" data-p="r" aria-label="${esc(T("Вперёд"))}">${GAL_I.back}</button>`;
    pv.el.querySelector(".gal-pa.l").hidden = pv.i === 0;
    pv.el.querySelector(".gal-pa.r").hidden = pv.i >= pv.list.length - 1;
    Gallery.pvPaint();
  },
  pvPaint() {
    const pv = Gallery.pv; if (!pv) return;
    const it = pv.list[pv.i], n = Gallery.sel.indexOf(it.id) + 1;
    pv.el.querySelector(".gal-pc").textContent = T("{0} из {1}", pv.i + 1, pv.list.length);
    const ck = pv.el.querySelector(".gal-ck");
    ck.classList.toggle("on", !!n);
    ck.querySelector("i").textContent = n || "";
  },

  // ───────── отправка ─────────
  async send() {
    if (!Gallery.sel.length) return;
    const cap = Gallery.opts && Gallery.opts.single ? "" : Gallery.el.querySelector(".gal-cap").value.trim();
    const pick = Gallery.sel.map((id) => Gallery.byId[id]).filter(Boolean);
    const out = [];
    const btn = Gallery.el.querySelector(".gal-send"); btn.disabled = true;
    for (const it of pick) {
      if (it.file) out.push({ file: it.file });
      else if (it.att) out.push({ att: it.att });
      else if (it.src === "native") { const f = await Gallery.nativeFile(it); if (f) out.push({ file: f }); }
    }
    btn.disabled = false;
    if (!out.length) return toast(T("Не удалось открыть выбранные файлы"));
    // отправленное с телефона больше не держим «наверху»
    Gallery.devCache = (Gallery.devCache || []).filter((x) => !Gallery.sel.includes(x.id));
    const cb = Gallery.opts && Gallery.opts.onSend;
    if (Gallery.pv && Gallery.pv.close) Gallery.pv.close();
    Gallery.close();
    if (cb) setTimeout(() => cb(out, cap), 230);
  },
};
