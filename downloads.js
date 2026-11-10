// downloads.js — «Загрузки» как в Telegram:
//   • файл, видео, музыка, документ скачиваются ВНУТРЬ приложения (хранилище на устройстве) и потом открываются без интернета;
//   • кнопка со стрелкой вверху списка чатов: кольцо показывает, сколько уже скачано; нажатие — экран «Загрузки»;
//   • экран «Загрузки»: что качается сейчас (с отменой) и что уже скачано (открыть, показать в чате, сохранить на телефон, удалить);
//   • большой файл пишется в хранилище по кусочкам (без загрузки целиком в память — приложение не вылетает).
const DL = {
  CACHE: "media-v1", KEY: "dl_list", MAX: 300,
  active: new Map(), raf: 0,

  // ключ — как у Service Worker: адрес файла без подписи
  keyOf(att) { try { const u = new URL(fileUrl(att.url), location.href); return u.origin + u.pathname; } catch (e) { return ""; } },
  list() { const l = ls.get(DL.KEY, []); return Array.isArray(l) ? l : []; },
  saveList(l) { ls.set(DL.KEY, l.slice(0, DL.MAX)); },
  kindOf(att) {
    const m = String(att.mime || "").toLowerCase();
    if (/^image\//.test(m)) return "photo";
    if (/^video\//.test(m)) return "video";
    if (typeof Music !== "undefined" && Music.isAudio(att)) return "music";
    return "file";
  },
  record(att, extra = {}) {
    const k = DL.keyOf(att); if (!k) return;
    const l = DL.list().filter((x) => x.k !== k);
    l.unshift(Object.assign({ k, url: att.url, name: att.name || "", size: att.size || 0, mime: att.mime || "", w: att.w || 0, h: att.h || 0,
      turl: att.turl || "", ts: Math.floor(Date.now() / 1000), kind: DL.kindOf(att), peer: DL.peerRef(), seen: 0 }, extra));
    DL.saveList(l);
  },
  // откуда файл (чтобы «Показать в чате»)
  peerRef() {
    try { if (typeof Chat !== "undefined" && Chat.peer) return { id: Chat.peer.id, gk: Chat.peer.gk || "", name: Chat.peer.name || "" }; } catch (e) {}
    return null;
  },
  async has(att) {
    try { if (!window.caches) return false; const c = await caches.open(DL.CACHE); return !!(await c.match(DL.keyOf(att))); } catch (e) { return false; }
  },

  // скачать в приложение; opts.quiet — без всплывающих подсказок (музыка при прослушивании)
  async get(att, opts = {}) {
    if (!att || !att.url || /^(blob|data):/.test(att.url)) return;
    const k = DL.keyOf(att); if (!k) return;
    if (DL.active.has(k)) { if (!opts.quiet) DL.openPage(); return; }
    if (!window.caches || !window.ReadableStream) { if (!opts.quiet) Attach.saveDevice(att); return; }
    if (await DL.has(att)) {
      if (!DL.list().some((x) => x.k === k)) DL.record(att);
      if (!opts.quiet) toast(T("Уже загружено — открывается без интернета"));
      DL.paint();
      return;
    }
    // хватит ли места
    try {
      if (att.size && navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        if (e.quota && e.quota - (e.usage || 0) < att.size * 1.15 + 20 * 1048576) {
          if (!opts.quiet) { toast(T("Мало места в хранилище приложения — сохраняю на устройство")); Attach.saveDevice(att); DL.record(att, { ext: 1 }); }
          return;
        }
      }
      if (navigator.storage && navigator.storage.persist && !DL._persist) { DL._persist = 1; navigator.storage.persist().catch(() => {}); }
    } catch (e) {}
    const ctl = new AbortController();
    const job = { k, att, loaded: 0, total: att.size || 0, ctl, quiet: !!opts.quiet, peer: DL.peerRef() };
    DL.active.set(k, job);
    DL.paint();
    if (!opts.quiet) toast(T("Загрузка началась — следите за ней в «Загрузках»"));
    try {
      const base = fileUrl(att.url), dlUrl = base + (base.includes("?") ? "&" : "?") + "dlm=1";
      const c = await caches.open(DL.CACHE);
      const hd = (type, total) => {
        const h = new Headers();
        h.set("content-type", type || att.mime || "application/octet-stream");
        if (total) h.set("content-length", String(total));
        h.set("accept-ranges", "bytes");
        h.set("x-cached-at", String(Date.now()));
        h.set("x-dl", "1");
        return h;
      };
      let fast = false;
      // Premium: самая быстрая загрузка — несколько соединений сразу; не получилось — обычная ниже
      if (DL.canFast(att)) {
        try {
          job.loaded = 0; job.fast = DL.STREAMS;
          await c.put(k, new Response(DL.parallel(dlUrl, job), { status: 200, headers: hd(att.mime, att.size) }));
          fast = true;
        } catch (e) {
          if (job.ctl.signal.aborted) throw e;     // пользователь отменил
          job.fast = 0; job.loaded = 0;
          try { await c.delete(k); } catch (er) {}
        }
      }
      if (!fast) {
        const res = await fetch(dlUrl, { signal: ctl.signal, mode: "cors", credentials: "omit" });
        if (!res.ok || !res.body) throw new Error("http " + res.status);
        job.total = +res.headers.get("content-length") || job.total;
        const counter = new TransformStream({
          transform(chunk, cc) { job.loaded += chunk.byteLength; DL.tick(); cc.enqueue(chunk); },
        });
        await c.put(k, new Response(res.body.pipeThrough(counter), { status: 200, headers: hd(res.headers.get("content-type"), job.total) }));     // пишется кусками, без целого файла в памяти
      }
      DL.active.delete(k);
      DL.record(att, { size: job.loaded || att.size || 0, peer: job.peer });
      if (!job.quiet) toast(T("Загружено: {0}", att.name || T("файл")));
      try { if (typeof Media !== "undefined") Media.trim(); } catch (e) {}
    } catch (e) {
      DL.active.delete(k);
      try { const c = await caches.open(DL.CACHE); await c.delete(k); } catch (er) {}
      if (!job.quiet && !(e && e.name === "AbortError")) toast(T("Не удалось скачать файл"));
    }
    DL.paint();
  },
  // ───────── быстрая загрузка (Premium) ─────────
  // Файл режется на куски по 2 МБ; STREAMS кусков качаются одновременно (запросы Range), потом собираются по порядку в один поток,
  // который пишется в хранилище. В памяти — не больше нескольких кусков (читаем по мере записи), так что большие файлы безопасны.
  STREAMS: 4, BLOCK: 2 * 1048576, MIN_FAST: 3 * 1048576,
  canFast(att) { return !!(App.user && App.user.premium) && (att.size || 0) >= DL.MIN_FAST && typeof ReadableStream === "function"; },
  parallel(url, job) {
    const total = job.total, BLK = DL.BLOCK, K = DL.STREAMS, n = Math.ceil(total / BLK);
    const run = new Map(), ctl = new AbortController();     // свой «стоп» для кусков: при ошибке гасим только их, а общую загрузку (job.ctl) не трогаем — ниже она продолжится обычным способом
    const stop = () => { try { ctl.abort(); } catch (e) {} };
    if (job.ctl.signal.aborted) stop(); else job.ctl.signal.addEventListener("abort", stop, { once: true });
    let emit = 0;
    const block = async (i) => {
      const a = i * BLK, b = Math.min(total, a + BLK) - 1, len = b - a + 1;
      for (let t = 0; ; t++) {
        let got = 0;
        try {
          const r = await fetch(url, { headers: { Range: "bytes=" + a + "-" + b }, signal: ctl.signal, mode: "cors", credentials: "omit" });
          if (r.status !== 206 || !r.body) { const e = new Error("no range " + r.status); e.stop = 1; throw e; }     // сервер/прокси не умеет Range — обычная загрузка
          const cr = /\/(\d+)\s*$/.exec(r.headers.get("content-range") || "");
          if (cr && +cr[1] !== total) { const e = new Error("size changed"); e.stop = 1; throw e; }
          const buf = new Uint8Array(len), rd = r.body.getReader();
          for (;;) {
            const { done, value } = await rd.read();
            if (done) break;
            if (got + value.length > len) throw new Error("too long");
            buf.set(value, got); got += value.length; job.loaded += value.length; DL.tick();
          }
          if (got !== len) throw new Error("short block");
          return buf;
        } catch (e) {
          job.loaded -= got;
          if ((e && (e.name === "AbortError" || e.stop)) || t >= 2) throw e;
          await new Promise((ok) => setTimeout(ok, 350 * (t + 1)));
        }
      }
    };
    const go = (i) => { if (i < n && !run.has(i)) { const p = block(i); p.catch(() => {}); run.set(i, p); } };
    return new ReadableStream({
      async pull(c) {
        if (emit >= n) return c.close();
        for (let i = emit; i < emit + K; i++) go(i);
        let data;
        try { data = await run.get(emit); } catch (e) { stop(); throw e; }
        run.delete(emit); emit++;
        for (let i = emit; i < emit + K; i++) go(i);
        c.enqueue(data);
      },
      cancel() { stop(); },
    }, { highWaterMark: 0 });
  },
  cancel(k) { const j = DL.active.get(k); if (j) { try { j.ctl.abort(); } catch (e) {} DL.active.delete(k); DL.paint(); } },
  async remove(k) {
    try { const c = await caches.open(DL.CACHE); await c.delete(k); } catch (e) {}
    DL.saveList(DL.list().filter((x) => x.k !== k));
    DL.paint();
  },
  async clear() {
    for (const x of DL.list()) { try { const c = await caches.open(DL.CACHE); await c.delete(x.k); } catch (e) {} }
    DL.saveList([]);
    DL.paint();
  },
  // скачанное могло быть удалено (очистка кэша в «Данных и памяти») — убираем из списка
  async sync() {
    if (!window.caches) return;
    try {
      const c = await caches.open(DL.CACHE), l = DL.list(), keep = [];
      for (const x of l) if (x.ext || (await c.match(x.k))) keep.push(x);
      if (keep.length !== l.length) DL.saveList(keep);
    } catch (e) {}
  },
  att(x) { return { url: x.url, name: x.name, size: x.size, mime: x.mime, w: x.w, h: x.h, turl: x.turl }; },

  // ───────── кнопка сверху ─────────
  tick() { if (!DL.raf) DL.raf = requestAnimationFrame(() => { DL.raf = 0; DL.paint(true); }); },
  progress() {
    let a = 0, b = 0;
    DL.active.forEach((j) => { if (j.quiet) return; a += j.loaded; b += j.total || j.loaded * 2 || 1; });
    return b ? Math.min(1, a / b) : 0;
  },
  btn() {
    let b = $("btn-dl");
    if (b) return b;
    const row = document.querySelector("#chats-head .tgh-row"), s = $("btn-search");
    if (!row || !s) return null;
    b = document.createElement("button");
    b.id = "btn-dl"; b.type = "button"; b.className = "tgh-btn dl-btn hidden"; b.setAttribute("aria-label", T("Загрузки"));
    b.innerHTML = `<svg class="dl-ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5"/><circle class="dl-p" cx="18" cy="18" r="15.5" pathLength="100"/></svg>` +
      `<svg class="dl-ar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v11"/><path d="m7 11.5 5 5 5-5"/><path d="M6 20h12"/></svg><i class="dl-dot"></i>`;
    row.insertBefore(b, s);
    b.onclick = () => { haptic(); DL.openPage(); };
    return b;
  },
  paint(fast) {
    const b = DL.btn();
    const visible = [...DL.active.values()].some((j) => !j.quiet);
    const fresh = DL.list().some((x) => !x.seen && Date.now() / 1000 - x.ts < 86400 && x.kind !== "music");
    if (b) {
      b.classList.toggle("hidden", !visible && !fresh);
      b.classList.toggle("busy", visible);
      b.classList.toggle("fresh", !visible && fresh);
      b.querySelector(".dl-p").style.strokeDasharray = `${(DL.progress() * 100).toFixed(1)} 100`;
    }
    if (!fast && DL.page && DL.page.alive) DL.draw(DL.page);
    else if (fast && DL.page && DL.page.alive) DL.paintRows(DL.page);
  },

  // ───────── экран «Загрузки» ─────────
  F: "all",
  openPage() {
    if (DL.page && DL.page.alive) return;
    DL.sync().then(() => { if (DL.page && DL.page.alive) DL.draw(DL.page); });
    const pg = (DL.page = Pg.open({ title: T("Загрузки"), cls: "dl-pg", right: `<button class="icon-btn" data-a="clear" aria-label="${esc(T("Очистить"))}">${SI.trash}</button>`, build: (p) => DL.draw(p), onClose: () => { DL.page = null; DL.markSeen(); DL.paint(); } }));
    pg.on = {
      f: (el) => { DL.F = el.dataset.v; DL.draw(pg); },
      cancel: (el) => DL.cancel(el.dataset.v),
      open: (el) => DL.open(el.dataset.v),
      more: (el, _x, e) => { if (e) e.stopPropagation(); DL.more(el.dataset.v); },
      clear: async () => {
        if (!DL.list().length) return toast(T("Здесь пока пусто"));
        if (!(await ask(T("Удалить все скачанные файлы с этого устройства? В чатах они останутся."), T("Удалить")))) return;
        await DL.clear(); toast(T("Загрузки очищены"));
      },
    };
    return pg;
  },
  markSeen() { const l = DL.list(); if (l.some((x) => !x.seen)) DL.saveList(l.map((x) => Object.assign(x, { seen: 1 }))); },
  icon(x) {
    const e = (String(x.name || "").split(".").pop() || "").slice(0, 4).toUpperCase();
    if (x.kind === "photo" && x.url) return `<span class="dl-th"><img src="${esc(fileUrl(x.turl || x.url))}" alt="" loading="lazy" decoding="async"></span>`;
    if (x.kind === "video") return `<span class="dl-th v">${typeof PLAY_SVG !== "undefined" ? PLAY_SVG : "▶"}</span>`;
    if (x.kind === "music") return `<span class="dl-th m">${typeof MIC_ !== "undefined" ? MIC_.note : "♪"}</span>`;
    let h = 0; for (const c of e) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `<span class="dl-th f" style="--h:${h}">${esc(e || "FILE")}</span>`;
  },
  when(ts) {
    const d = new Date(ts * 1000), now = new Date();
    return sameDay(d, now) ? fmtTime(ts) : d.toLocaleDateString(I18N.loc, { day: "numeric", month: "short" });
  },
  draw(pg) {
    const act = [...DL.active.values()].filter((j) => !j.quiet), F = DL.F;
    const pass = (k) => F === "all" || (F === "media" ? k === "photo" || k === "video" : F === "music" ? k === "music" : k === "file");
    const done = DL.list().filter((x) => pass(x.kind));
    const chip = (v, t) => `<button class="dl-chip${F === v ? " on" : ""}" data-a="f" data-v="${v}">${esc(t)}</button>`;
    let h = `<div class="dl-chips">${chip("all", T("Все"))}${chip("media", T("Медиа"))}${chip("file", T("Файлы"))}${chip("music", T("Музыка"))}</div>`;
    if (act.length) {
      h += R.lbl(T("Загружаются")) + `<div class="card2 dl-list">${act.map((j) => {
        const x = { name: j.att.name, kind: DL.kindOf(j.att), url: j.att.url, turl: j.att.turl };
        return `<div class="dl-row on" data-k="${esc(j.k)}">${DL.icon(x)}<span class="dl-tx"><b>${esc(j.att.name || T("Файл"))}</b><small class="dl-st"></small><i class="dl-bar"><i></i></i></span>` +
          `<button class="dl-x" data-a="cancel" data-v="${esc(j.k)}" aria-label="${esc(T("Отменить"))}">${SI.x}</button></div>`;
      }).join("")}</div>`;
    }
    if (done.length) {
      h += R.lbl(T("Недавно загруженные")) + `<div class="card2 dl-list">${done.map((x) => `<div class="dl-row" data-a="open" data-v="${esc(x.k)}">${DL.icon(x)}<span class="dl-tx"><b>${esc(x.name || T("Файл"))}</b>` +
        `<small>${esc([x.size ? fmtSize(x.size) : "", DL.when(x.ts), x.ext ? T("на телефоне") : ""].filter(Boolean).join(" · "))}</small></span>` +
        `<button class="dl-x m" data-a="more" data-v="${esc(x.k)}" aria-label="${esc(T("Ещё"))}">${SI.dots}</button></div>`).join("")}</div>`;
      h += R.hint(esc(T("Скачанные файлы хранятся на этом устройстве и открываются без интернета.")));
    }
    if (!act.length && !done.length) h += R.hero(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m7 10.5 5 5 5-5"/><path d="M5 20h14"/></svg>`,
      esc(T("Нет загрузок")), esc(T("Здесь будут видео, музыка и файлы, которые вы скачали. Нажмите «Скачать» у файла в чате.")), "dl-empty");
    pg.set(h);
    DL.paintRows(pg);
  },
  paintRows(pg) {
    pg.body.querySelectorAll(".dl-row.on").forEach((r) => {
      const j = DL.active.get(r.dataset.k);
      if (!j) return;
      const p = j.total ? Math.min(1, j.loaded / j.total) : 0;
      r.querySelector(".dl-bar i").style.width = (p * 100).toFixed(1) + "%";
      r.querySelector(".dl-st").textContent = (j.total ? T("{0} из {1}", fmtSize(j.loaded), fmtSize(j.total)) : fmtSize(j.loaded)) + (j.fast ? " · ⚡ " + T("Быстрая загрузка") : "");
    });
  },
  open(k) {
    const x = DL.list().find((y) => y.k === k); if (!x) return;
    const a = DL.att(x);
    if (x.ext && x.kind === "file" && FV.kind(a) === "other") return Attach.saveDevice(a);
    if (x.kind === "music") return FV.show(a, "audio");
    FV.open(a);
  },
  async more(k) {
    const x = DL.list().find((y) => y.k === k); if (!x) return;
    const acts = [];
    if (x.peer && x.peer.id) acts.push({ label: T("Показать в чате"), value: "chat" });
    acts.push({ label: T("Сохранить на телефон"), value: "dev" });
    acts.push({ label: T("Удалить из загрузок"), value: "del", danger: true });
    const v = await UI.sheet({ title: x.name || T("Файл"), actions: acts });
    if (v === "chat") {
      const c = typeof Chats !== "undefined" && Chats.list ? Chats.list.find((y) => y.peer && y.peer.id === x.peer.id) : null;
      if (!c) return toast(T("Чат не найден"));
      if (DL.page) DL.page.close();
      setTimeout(() => Chats.openChat(c.peer), 300);
    } else if (v === "dev") Attach.saveDevice(DL.att(x));
    else if (v === "del") { await DL.remove(k); toast(T("Удалено из загрузок")); }
  },

  init() {
    DL.btn();
    DL.sync().then(() => DL.paint());
  },
};
