// music.js — музыка как в Telegram:
//   • один общий плеер: музыка не прерывается, когда закрываешь окно плеера или выходишь из чата;
//   • полоска плеера сверху (в чате и в списке чатов): пауза, следующий трек, закрыть, нажатие — большой плеер;
//   • большой плеер: обложка и название из тегов файла (ID3), перемотка, ±15 с, предыдущий/следующий трек,
//     скорость, повтор; очередь — вся музыка из открытого чата по порядку;
//   • кнопка ▶ прямо в карточке аудиофайла в чате, полоса прогресса и время;
//   • управление с экрана блокировки / шторки (Media Session), если система это поддерживает;
//   • прослушанная музыка сохраняется в «Загрузки» (DL) и потом играет без интернета.
const MIC_ = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.3"/><rect x="13.5" y="5" width="4" height="14" rx="1.3"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 6.2v11.6a1 1 0 0 0 1.5.86L15 13.3V17a1 1 0 0 0 2 0V7a1 1 0 0 0-2 0v3.7L6.5 5.34A1 1 0 0 0 5 6.2Z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.2v11.6a1 1 0 0 1-1.5.86L9 13.3V17a1 1 0 0 1-2 0V7a1 1 0 0 1 2 0v3.7l8.5-5.36A1 1 0 0 1 19 6.2Z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4.6 9.2A8 8 0 1 1 4 12.4"/><path d="M4.2 4.6v4.8H9"/></svg>',
  fwd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M19.4 9.2A8 8 0 1 0 20 12.4"/><path d="M19.8 4.6v4.8H15"/></svg>',
  rep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11.5V10a4 4 0 0 1 4-4h13"/><path d="M7 21.5 3.5 18 7 14.5"/><path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>',
};

const Music = {
  a: null, cur: null, queue: [], idx: -1, rate: 1, rep: 0, view: null, bar: null, tags: {}, raf: 0,
  SP: [1, 1.25, 1.5, 2, 0.75],

  init() {
    if (Music.a) return;
    const a = (Music.a = new Audio());
    a.preload = "auto";
    try { Music.rate = +localStorage.getItem("mrate") || 1; Music.rep = +localStorage.getItem("mrep") || 0; } catch (e) {}
    const paint = () => { cancelAnimationFrame(Music.raf); Music.raf = requestAnimationFrame(() => Music.paint()); };
    ["timeupdate", "play", "pause", "loadedmetadata", "durationchange", "ratechange", "waiting", "playing"].forEach((ev) => a.addEventListener(ev, paint));
    a.addEventListener("ended", () => Music.ended());
    a.addEventListener("error", () => {
      if (!Music.cur || !a.getAttribute("src")) return;
      toast(T("Не удалось воспроизвести этот файл"));
      if (Music.view && Music.view.ctx && !Music.view.ctx.dead) Music.paint();
    });
    Music.session();
  },

  isAudio(att) {
    if (!att) return false;
    const m = String(att.mime || "").toLowerCase(), n = String(att.name || "").toLowerCase();
    return /^audio\//.test(m) || /\.(mp3|m4a|aac|ogg|oga|opus|flac|wav|wma|amr|aiff?)$/.test(n);
  },
  key(att) { return att ? String(att.fid || String(att.url || "").split("?")[0]) : ""; },
  fmt(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); },
  // «Исполнитель — Название» из тегов, иначе из имени файла
  names(att) {
    const tg = Music.tags[Music.key(att)] || {};
    let base = String((att && att.name) || "").replace(/\.[^.]+$/, "").replace(/_/g, " ").trim();
    let perf = "", title = base;
    const m = /^(.{1,60}?)\s+[-–—]\s+(.+)$/.exec(base);
    if (m) { perf = m[1]; title = m[2]; }
    return { title: tg.title || title || T("Аудио"), perf: tg.perf || perf || "", cover: tg.cover || "" };
  },

  // очередь — вся музыка открытого чата по порядку
  chatQueue() {
    try {
      if (typeof Chat === "undefined" || !Chat.msgs) return [];
      return Chat.msgs.filter((x) => (x.kind === "file" || x.kind === "audio") && x.att && x.att.url && !x.pending && Music.isAudio(x.att)).map((x) => x.att);
    } catch (e) { return []; }
  },

  // нажатие ▶ в карточке: тот же трек — пауза/продолжить, другой — играть
  tap(att) {
    Music.init();
    if (Music.cur && Music.cur.k === Music.key(att)) return Music.toggle();
    Music.play(att);
  },

  play(att, queue) {
    Music.init();
    const a = Music.a, k = Music.key(att);
    try { if (typeof Player !== "undefined" && Player.a && !Player.a.paused) Player.stop(); } catch (e) {}   // голосовое замолкает
    const q = queue || Music.chatQueue();
    Music.queue = q.length ? q : [att];
    Music.idx = Math.max(0, Music.queue.findIndex((x) => Music.key(x) === k));
    if (Music.idx < 0 || Music.key(Music.queue[Music.idx]) !== k) { Music.queue = [att]; Music.idx = 0; }
    Music.cur = { k, att };
    a.src = fileUrl(att.url);
    a.playbackRate = Music.rate;
    a.play().catch(() => {});
    Music.paint();
    Music.loadTags(att);
    Music.meta();
    // прослушанное — в «Загрузки», чтобы играло и без интернета (не больше 60 МБ)
    try { if (typeof DL !== "undefined" && (!att.size || att.size <= 60 * 1048576)) DL.get(att, { quiet: true }); } catch (e) {}
  },
  toggle() {
    const a = Music.a; if (!a || !Music.cur) return;
    if (a.paused) { try { if (typeof Player !== "undefined" && Player.a && !Player.a.paused) Player.stop(); } catch (e) {} a.play().catch(() => {}); }
    else a.pause();
  },
  pause() { try { if (Music.a && !Music.a.paused) Music.a.pause(); } catch (e) {} },
  seek(frac) { const a = Music.a; if (a && a.duration && isFinite(a.duration)) a.currentTime = Math.max(0, Math.min(1, frac)) * a.duration; },
  skip(sec) { const a = Music.a; if (!a || !Music.cur) return; a.currentTime = Math.max(0, Math.min((a.duration || 1e9) - 0.2, a.currentTime + sec)); Music.paint(); },
  go(i) {
    const n = Music.queue.length; if (!n) return;
    if (Music.rep === 1) i = (i + n) % n;
    if (i < 0 || i >= n) return false;
    Music.play(Music.queue[i], Music.queue);
    return true;
  },
  next() { if (!Music.go(Music.idx + 1)) { Music.a.currentTime = 0; Music.a.pause(); } },
  prev() { if (Music.a && Music.a.currentTime > 3) { Music.a.currentTime = 0; return; } if (!Music.go(Music.idx - 1)) Music.a.currentTime = 0; },
  ended() {
    if (Music.rep === 2) { Music.a.currentTime = 0; Music.a.play().catch(() => {}); return; }
    if (Music.idx < Music.queue.length - 1 || Music.rep === 1) return Music.go(Music.idx + 1);
    Music.a.currentTime = 0; Music.paint();
  },
  speed() {
    const n = Music.SP[(Music.SP.indexOf(Music.rate) + 1) % Music.SP.length];
    Music.rate = n; if (Music.a) Music.a.playbackRate = n;
    try { localStorage.setItem("mrate", String(n)); } catch (e) {}
    Music.paint();
  },
  repeat() {
    Music.rep = (Music.rep + 1) % 3;
    try { localStorage.setItem("mrep", String(Music.rep)); } catch (e) {}
    toast([T("Повтор выключен"), T("Повтор всех треков"), T("Повтор одного трека")][Music.rep]);
    Music.paint();
  },
  // закрыть плеер совсем (крестик на полоске)
  stop() {
    const a = Music.a; if (!a) return;
    try { a.pause(); a.removeAttribute("src"); a.load(); } catch (e) {}
    Music.cur = null; Music.queue = []; Music.idx = -1;
    try { if (navigator.mediaSession) navigator.mediaSession.metadata = null; } catch (e) {}
    Music.paint();
  },

  // ───────── вид: карточки в чате, полоска сверху, большой плеер ─────────
  cardHTML(m) {
    const a = m.att || {}, nm = Music.names(a);
    return `<div class="fcard au" data-mk="${esc(Music.key(a))}"><button class="fic au-pl" type="button" aria-label="${esc(T("Воспроизвести"))}">${MIC_.play}${MIC_.pause}</button>` +
      `<div class="fi"><b>${esc(nm.title)}</b><small><span class="au-p">${esc(nm.perf || fmtSize(a.size || 0))}</span><span class="au-tm"></span></small><i class="au-bar"><i></i></i></div></div>`;
  },

  paint() {
    const a = Music.a, cur = Music.cur;
    const on = !!(cur && a && !a.paused), dur = a && isFinite(a.duration) ? a.duration : 0, t = a ? a.currentTime : 0;
    const frac = dur ? Math.min(1, t / dur) : 0;
    document.querySelectorAll(".fcard.au").forEach((el) => {
      const mine = !!cur && el.dataset.mk === cur.k;
      el.classList.toggle("playing", mine && on);
      el.classList.toggle("active", mine);
      const tm = el.querySelector(".au-tm");
      if (tm) tm.textContent = mine && dur ? " · " + Music.fmt(t) + " / " + Music.fmt(dur) : "";
      const bar = el.querySelector(".au-bar i");
      if (bar) bar.style.width = mine ? frac * 100 + "%" : "0%";
    });
    Music.paintBar(on, frac);
    Music.paintView(on, t, dur);
    try { if (navigator.mediaSession) navigator.mediaSession.playbackState = cur ? (on ? "playing" : "paused") : "none"; } catch (e) {}
    try { if (navigator.mediaSession && navigator.mediaSession.setPositionState && dur) navigator.mediaSession.setPositionState({ duration: dur, playbackRate: a.playbackRate || 1, position: Math.min(t, dur) }); } catch (e) {}
  },

  // полоска плеера: в открытом чате — под шапкой чата, иначе — под шапкой списка чатов
  paintBar(on, frac) {
    const cur = Music.cur;
    let b = Music.bar;
    if (!cur) { if (b) { b.remove(); Music.bar = null; } return; }
    if (!b) {
      b = Music.bar = document.createElement("div");
      b.className = "mbar"; b.id = "mbar";
      b.innerHTML = `<button class="mb-b mb-pl" data-m="pl" aria-label="${esc(T("Воспроизвести"))}"></button><button class="mb-t" data-m="open"><b></b><small></small></button>` +
        `<button class="mb-b mb-nx" data-m="nx" aria-label="${esc(T("Следующий трек"))}">${MIC_.next}</button><button class="mb-b mb-x" data-m="x" aria-label="${esc(T("Закрыть плеер"))}">${MIC_.x}</button><i class="mb-pr"><i></i></i>`;
      b.addEventListener("click", (e) => {
        const x = e.target.closest("[data-m]"); if (!x) return;
        haptic();
        const k = x.dataset.m;
        if (k === "pl") Music.toggle();
        else if (k === "nx") Music.next();
        else if (k === "x") Music.stop();
        else if (k === "open" && Music.cur) FV.show(Music.cur.att, "audio");
      });
    }
    const chatOpen = $("chat") && $("chat").classList.contains("open");
    const anchor = chatOpen ? document.querySelector("#chat > .phead") : $("chats-head");
    if (anchor && b.previousElementSibling !== anchor) anchor.after(b);
    const nm = Music.names(cur.att);
    const bt = b.querySelector(".mb-t b"), sm = b.querySelector(".mb-t small");
    if (bt.textContent !== nm.title) bt.textContent = nm.title;
    const sub = nm.perf || (Music.queue.length > 1 ? T("{0} из {1}", Music.idx + 1, Music.queue.length) : "");
    if (sm.textContent !== sub) sm.textContent = sub;
    const pl = b.querySelector(".mb-pl"), want = on ? "pause" : "play";
    if (pl.dataset.s !== want) { pl.innerHTML = MIC_[want]; pl.dataset.s = want; pl.setAttribute("aria-label", on ? T("Пауза") : T("Воспроизвести")); }
    b.querySelector(".mb-nx").disabled = !(Music.idx < Music.queue.length - 1 || Music.rep === 1);
    b.querySelector(".mb-pr i").style.width = frac * 100 + "%";
    b.classList.toggle("on", on);
  },

  // большой плеер (окно просмотра файла)
  mountView(ctx, att) {
    Music.init();
    if (!Music.cur || Music.cur.k !== Music.key(att)) Music.play(att);
    ctx.body.innerHTML = `<div class="fv-au"><div class="fv-cover"><span class="fv-eq"><i></i><i></i><i></i><i></i></span><span class="fv-art"></span><span class="fv-ni">${MIC_.note}</span></div>
      <h3 class="fv-ttl"></h3><p class="fv-sub"></p>
      <div class="fv-seek"><input type="range" min="0" max="1000" value="0" aria-label="${esc(T("Перемотка"))}"><div class="fv-tm"><span class="t0">0:00</span><span class="t1">0:00</span></div></div>
      <div class="fv-ctl">
        <button class="fv-sm" data-a="pv" aria-label="${esc(T("Предыдущий трек"))}">${MIC_.prev}</button>
        <button data-a="b" aria-label="${esc(T("Назад на 15 секунд"))}">${MIC_.back}<small>15</small></button>
        <button class="fv-play" data-a="p" aria-label="${esc(T("Воспроизвести"))}">${MIC_.play}</button>
        <button data-a="f" aria-label="${esc(T("Вперёд на 15 секунд"))}">${MIC_.fwd}<small>15</small></button>
        <button class="fv-sm" data-a="nx" aria-label="${esc(T("Следующий трек"))}">${MIC_.next}</button></div>
      <div class="fv-row2"><button class="fv-spd" data-a="s">1×</button><span class="fv-qp"></span><button class="fv-rep" data-a="r" aria-label="${esc(T("Повтор"))}">${MIC_.rep}<i>1</i></button></div></div>`;
    const root = ctx.body.querySelector(".fv-au"), rg = root.querySelector("input");
    const v = (Music.view = { ctx, root, rg, drag: false });
    rg.addEventListener("input", () => { v.drag = true; const a = Music.a; if (a && a.duration) root.querySelector(".t0").textContent = Music.fmt((rg.value / 1000) * a.duration); });
    rg.addEventListener("change", () => { Music.seek(rg.value / 1000); v.drag = false; });
    root.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-a]"); if (!b) return;
      haptic();
      const k = b.dataset.a;
      if (k === "p") Music.toggle();
      else if (k === "b") Music.skip(-15);
      else if (k === "f") Music.skip(15);
      else if (k === "pv") Music.prev();
      else if (k === "nx") Music.next();
      else if (k === "s") Music.speed();
      else if (k === "r") Music.repeat();
    });
    ctx.dispose.push(() => { if (Music.view === v) Music.view = null; });     // окно закрыли — музыка играет дальше
    ctx.audio = Music.a;
    Music.paint();
  },
  paintView(on, t, dur) {
    const v = Music.view; if (!v || !v.ctx || v.ctx.dead || !Music.cur) return;
    const r = v.root, nm = Music.names(Music.cur.att), att = Music.cur.att;
    const set = (sel, txt) => { const e = r.querySelector(sel); if (e && e.textContent !== txt) e.textContent = txt; };
    set(".fv-ttl", nm.title);
    set(".fv-sub", [nm.perf, FV.extOf(att).toUpperCase(), att.size ? fmtSize(att.size) : ""].filter(Boolean).join(" · "));
    const hb = v.ctx.el.querySelector(".fv-name b"); if (hb && hb.textContent !== (att.name || "")) hb.textContent = att.name || T("Аудио");
    const art = r.querySelector(".fv-art");
    if (art.dataset.src !== (nm.cover || "")) { art.dataset.src = nm.cover || ""; art.innerHTML = nm.cover ? `<img src="${esc(nm.cover)}" alt="">` : ""; r.classList.toggle("art", !!nm.cover); }
    if (!v.drag) { v.rg.value = dur ? Math.round((t / dur) * 1000) : 0; set(".t0", Music.fmt(t)); }
    set(".t1", Music.fmt(dur));
    r.classList.toggle("on", on);
    const pl = r.querySelector(".fv-play"), want = on ? "pause" : "play";
    if (pl.dataset.s !== want) { pl.innerHTML = MIC_[want]; pl.dataset.s = want; pl.setAttribute("aria-label", on ? T("Пауза") : T("Воспроизвести")); }
    set(".fv-spd", (Music.rate === 1 ? "1" : String(Music.rate)) + "×");
    const n = Music.queue.length;
    set(".fv-qp", n > 1 ? T("{0} из {1}", Music.idx + 1, n) : "");
    r.querySelector("[data-a=nx]").disabled = !(Music.idx < n - 1 || (Music.rep === 1 && n > 1));
    const rp = r.querySelector(".fv-rep"); rp.classList.toggle("on", Music.rep > 0); rp.classList.toggle("one", Music.rep === 2);
  },

  // ───────── теги ID3: название, исполнитель, обложка ─────────
  async loadTags(att) {
    const k = Music.key(att);
    if (Music.tags[k]) return;
    Music.tags[k] = {};
    try {
      const r = await fetch(fileUrl(att.url), { headers: { Range: "bytes=0-524287" } });
      if (!r.ok && r.status !== 206) return;
      let buf;
      if (r.body && r.body.getReader) {
        const rd = r.body.getReader(), parts = []; let got = 0;
        while (got < 524288) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; }
        try { rd.cancel(); } catch (e) {}
        buf = new Uint8Array(Math.min(got, 524288)); let o = 0;
        for (const p of parts) { const n = Math.min(p.length, buf.length - o); if (n <= 0) break; buf.set(p.subarray(0, n), o); o += n; }
      } else buf = new Uint8Array(await r.arrayBuffer()).subarray(0, 524288);
      const tg = Music.id3(buf);
      if (tg) {
        if (tg.pic) { tg.cover = URL.createObjectURL(new Blob([tg.pic.data], { type: tg.pic.mime || "image/jpeg" })); delete tg.pic; }
        Music.tags[k] = tg;
        if (Music.cur && Music.cur.k === k) { Music.meta(); Music.paint(); }
        document.querySelectorAll(`.fcard.au[data-mk="${CSS.escape(k)}"]`).forEach((el) => { const nm = Music.names(att); const b = el.querySelector(".fi b"), p = el.querySelector(".au-p"); if (b) b.textContent = nm.title; if (p && nm.perf) p.textContent = nm.perf; });
      }
    } catch (e) {}
  },
  id3(b) {
    if (!b || b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null;
    const ver = b[3], flags = b[5];
    const ss = (o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
    const be = (o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    const end = Math.min(b.length, 10 + ss(6));
    if (flags & 0x80) return null;                                 // «рассинхронизация» — редкость, не разбираем
    let o = 10;
    if (flags & 0x40) o += ver === 4 ? ss(10) : be(10) + 4;        // расширенный заголовок
    const out = {};
    const dec = (enc, d) => {
      try {
        if (enc === 0) return new TextDecoder("latin1").decode(d);
        if (enc === 1) return new TextDecoder(d[0] === 0xfe ? "utf-16be" : "utf-16le").decode(d[0] === 0xff || d[0] === 0xfe ? d.subarray(2) : d);
        if (enc === 2) return new TextDecoder("utf-16be").decode(d);
        return new TextDecoder("utf-8").decode(d);
      } catch (e) { return ""; }
    };
    const clean = (s) => String(s || "").replace(/\0+$/, "").split("\0")[0].trim().slice(0, 120);
    const v22 = ver === 2;
    while (o + (v22 ? 6 : 10) <= end) {
      const id = String.fromCharCode(...b.subarray(o, o + (v22 ? 3 : 4)));
      if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
      const size = v22 ? (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5] : ver === 4 ? ss(o + 4) : be(o + 4);
      const ds = o + (v22 ? 6 : 10), de = ds + size;
      if (size <= 0 || de > b.length) break;
      const d = b.subarray(ds, de);
      if (id === "TIT2" || id === "TT2") out.title = clean(dec(d[0], d.subarray(1)));
      else if (id === "TPE1" || id === "TP1") out.perf = clean(dec(d[0], d.subarray(1)));
      else if ((id === "APIC" || id === "PIC") && !out.pic) {
        const enc = d[0]; let p = 1, mime = "";
        if (v22) { const f = String.fromCharCode(...d.subarray(1, 4)).toLowerCase(); mime = f === "png" ? "image/png" : "image/jpeg"; p = 4; }
        else { while (p < d.length && d[p] !== 0) p++; mime = new TextDecoder("latin1").decode(d.subarray(1, p)) || "image/jpeg"; p++; }
        p++;                                                        // тип картинки
        if (enc === 1 || enc === 2) { while (p + 1 < d.length && !(d[p] === 0 && d[p + 1] === 0)) p += 2; p += 2; }
        else { while (p < d.length && d[p] !== 0) p++; p++; }
        if (p < d.length && /^image\//.test(mime)) out.pic = { mime, data: d.slice(p) };
      }
      o = de;
    }
    return out.title || out.perf || out.pic ? out : null;
  },

  // ───────── экран блокировки / шторка ─────────
  meta() {
    try {
      if (!navigator.mediaSession || !Music.cur || typeof MediaMetadata === "undefined") return;
      const nm = Music.names(Music.cur.att);
      navigator.mediaSession.metadata = new MediaMetadata({ title: nm.title, artist: nm.perf || "Dicegram", album: "Dicegram",
        artwork: nm.cover ? [{ src: nm.cover, sizes: "512x512" }] : [{ src: "icon-512.png", sizes: "512x512", type: "image/png" }] });
    } catch (e) {}
  },
  session() {
    try {
      const ms = navigator.mediaSession; if (!ms) return;
      const h = (k, f) => { try { ms.setActionHandler(k, f); } catch (e) {} };
      h("play", () => Music.toggle());
      h("pause", () => Music.pause());
      h("previoustrack", () => Music.prev());
      h("nexttrack", () => Music.next());
      h("seekbackward", () => Music.skip(-15));
      h("seekforward", () => Music.skip(15));
      h("seekto", (d) => { if (d && Music.a && isFinite(d.seekTime)) Music.a.currentTime = d.seekTime; });
      h("stop", () => Music.stop());
    } catch (e) {}
  },
};
