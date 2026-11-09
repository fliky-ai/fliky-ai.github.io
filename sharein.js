// sharein.js — «Поделиться» из других приложений (TikTok, WhatsApp, галерея…) в Dicegram.
// APK (AppMint): общий текст/ссылка — WebToApk.getSharedText() и событие appmint:shared,
// файлы — AppMint.getOpenedFile(s)() и событие appmint:fileopen (включите в AppMint «Receive shares from other apps»).
// Установленное как приложение из браузера (PWA): Web Share Target — sw.js складывает присланное в кэш и
// открывает ./index.html?share=1. Дальше одинаково: окно «Отправить в…» со списком чатов и поиском.
const ShareIn = {
  pending: null,

  init() {
    // APK: текст и ссылки
    try {
      const B = window.WebToApk;
      const raw = B && B.getSharedText ? B.getSharedText() : null;
      const v = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
      if (v) { ShareIn.take({ text: ShareIn.textOf(v) }); try { if (B.clearSharedText) B.clearSharedText(); } catch (e) {} }
    } catch (e) {}
    addEventListener("appmint:shared", (e) => { const d = (e && e.detail) || {}; ShareIn.take({ text: ShareIn.textOf(d) }); });
    try { const N = window.appmintNative; if (N && typeof N.onShared === "function") N.onShared((d) => ShareIn.take({ text: ShareIn.textOf(d || {}) })); } catch (e) {}
    // APK: файлы (фото, видео, музыка, документы)
    addEventListener("appmint:fileopen", async (e) => { const f = await ShareIn.fileOf(e && e.detail); if (f) ShareIn.take({ files: [f] }); });
    (async () => {
      try {
        const A = window.AppMint;
        if (!A) return;
        let list = [];
        if (A.getOpenedFiles) list = (await A.getOpenedFiles()) || [];
        else if (A.getOpenedFile) { const one = await A.getOpenedFile(); if (one) list = [one]; }
        const files = (await Promise.all([].concat(list).map(ShareIn.fileOf))).filter(Boolean);
        if (files.length) ShareIn.take({ files });
        try { if (A.releaseOpenedFile) A.releaseOpenedFile(); } catch (e) {}
      } catch (e) {}
    })();
    // PWA: Web Share Target
    try { if (new URL(location.href).searchParams.get("share") === "1") ShareIn.fromSW(); } catch (e) {}
  },

  textOf(v) {
    if (!v) return "";
    if (typeof v === "string") return v;
    const parts = [v.subject || v.title, v.text, v.url].filter((x) => x && String(x).trim());
    return [...new Set(parts.map(String))].join("\n").trim();
  },

  async fileOf(f) {
    try {
      if (!f) return null;
      if (f instanceof File) return f;
      let file = f.getFile ? await f.getFile() : f.file || null;
      if (!file && f.url) { const b = await (await fetch(f.url)).blob(); file = new File([b], f.name || "file", { type: f.mime || f.type || b.type }); }
      if (file && !(file instanceof File)) file = new File([file], f.name || "file", { type: f.mime || file.type || "" });
      return file;
    } catch (e) { return null; }
  },

  async fromSW() {
    try {
      const c = await caches.open("share-inbox");
      const meta = await c.match("share/meta");
      if (!meta) return;
      const m = await meta.json();
      const files = [];
      for (let i = 0; i < (m.files || []).length; i++) {
        const r = await c.match("share/file/" + i);
        if (r) { const b = await r.blob(); files.push(new File([b], m.files[i].name || "file", { type: m.files[i].type || b.type })); }
      }
      for (const k of await c.keys()) await c.delete(k);
      const u = new URL(location.href); u.searchParams.delete("share");
      try { history.replaceState(null, "", u.pathname + u.search + u.hash); } catch (e) {}
      ShareIn.take({ text: ShareIn.textOf(m), files });
    } catch (e) {}
  },

  // принято что-то для отправки: ждём входа в аккаунт, затем спрашиваем «кому»
  take(p) {
    if (!p || (!(p.text && p.text.trim()) && !(p.files && p.files.length))) return;
    const cur = ShareIn.pending || { text: "", files: [] };
    if (p.text && !cur.text.includes(p.text)) cur.text = (cur.text ? cur.text + "\n" : "") + p.text;
    if (p.files) cur.files = cur.files.concat(p.files);
    ShareIn.pending = cur;
    clearTimeout(ShareIn.t);
    ShareIn.t = setTimeout(() => ShareIn.ready(), 250);       // несколько событий подряд — одно окно
  },
  ready() {
    if (!ShareIn.pending || !App.user) return;               // покажем после входа (App.enter вызывает ready ещё раз)
    const p = ShareIn.pending; ShareIn.pending = null;
    ShareIn.pick(p);
  },

  pick(p) {
    const what = p.files && p.files.length
      ? T("{0} — {1}", p.files.length === 1 ? (p.files[0].name || T("Файл")) : T("{0} файла", p.files.length), fmtSize(p.files.reduce((s, f) => s + (f.size || 0), 0)))
      : p.text.length > 90 ? p.text.slice(0, 90) + "…" : p.text;
    const pg = Pg.open({ title: T("Отправить в…"), cls: "shin", data: { q: "", p }, build: (x) => ShareIn.draw(x) });
    pg.on.q = (v) => { pg.data.q = v; ShareIn.list(pg); };
    pg.on.to = (el) => {
      const c = Chats.byId(+el.dataset.v); if (!c) return;
      pg.close();
      setTimeout(() => ShareIn.deliver(c.peer, p), 260);
    };
    pg.data.what = what;
    ShareIn.draw(pg);
  },
  draw(pg) {
    pg.set(`<div class="shin-what">${esc(pg.data.what || "")}</div>
      <div class="shin-search"><input data-i="q" type="search" placeholder="${esc(T("Поиск"))}" value="${esc(pg.data.q || "")}" autocomplete="off"></div>
      <div class="shin-list" id="shin-list"></div>`);
    ShareIn.list(pg);
  },
  list(pg) {
    const box = pg.$("#shin-list"); if (!box) return;
    const q = (pg.data.q || "").trim().toLowerCase();
    const rows = Chats.sorted().filter((c) => c.peer && !c.peer.deleted && (!c.peer.gk || c.peer.post !== false))
      .filter((c) => !q || dispName(c.peer).toLowerCase().includes(q) || (c.peer.username || "").toLowerCase().includes(q) || (c.peer.title || "").toLowerCase().includes(q));
    box.innerHTML = rows.length ? rows.map((c) => `<button class="shin-row" data-a="to" data-v="${c.peer.id}">${Stories.av(c.peer, "sm")}<span>${esc(c.peer.gk ? c.peer.title || dispName(c.peer) : dispName(c.peer))}</span></button>`).join("")
      : `<div class="g-empty">${esc(T("Ничего не найдено"))}</div>`;
  },

  async deliver(peer, p) {
    App.go("chats");
    await Chats.openChat(peer);
    if (p.files && p.files.length) Attach.preview(p.files);
    if (p.text) { Editor.set(p.text); Editor.focus(); Chat.syncMain(); }
  },
};
