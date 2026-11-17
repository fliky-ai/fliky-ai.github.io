// secret.js — секретные чаты со сквозным шифрованием (E2EE).
//  • у каждого устройства своя пара ключей ECDH P-256 (закрытый ключ создаётся в WebCrypto как неизвлекаемый и хранится только в IndexedDB этого устройства);
//  • сообщение шифруется AES-GCM-256 отдельно для каждого устройства собеседника и для остальных своих устройств (ключ — ECDH → HKDF-SHA256);
//  • сервер видит только публичные ключи и шифртекст;
//  • таймер автоудаления, запрет пересылки/копирования, удаление переписки у обоих, тёмный экран с замком и надписью «Защищённое соединение».
const Secret = {
  list: [],          // секретные чаты (pending / active)
  cur: null,         // открытый чат
  msgs: [],          // расшифрованные сообщения открытого чата
  dev: "", pub: "", priv: null,
  keys: {},          // chat id → {t, mine:[], peer:[]}
  peerRead: 0, ttlT: 0, busy: false, ready_: null,
  TTLS: [[0, "Выключен"], [5, "5 секунд"], [10, "10 секунд"], [30, "30 секунд"], [60, "1 минута"], [300, "5 минут"], [3600, "1 час"], [86400, "1 день"], [604800, "1 неделя"]],
  LOCK: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.6v2.2"/></svg>',
  TIMER: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 2.5h5"/></svg>',
  SEND: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>',

  // ───────────── крипто ─────────────
  enc: new TextEncoder(), dec: new TextDecoder(),
  b64(buf) { const a = new Uint8Array(buf); let s = ""; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode.apply(null, a.subarray(i, i + 8192)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); },
  unb64(s) { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); s += "=".repeat((4 - (s.length % 4)) % 4); return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); },
  supported() { return !!(window.crypto && crypto.subtle && window.indexedDB); },

  idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("dg_secret", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("k");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  },
  async idbGet(k) { const db = await Secret.idb(); return new Promise((res, rej) => { const q = db.transaction("k").objectStore("k").get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async idbPut(k, v) { const db = await Secret.idb(); return new Promise((res, rej) => { const t = db.transaction("k", "readwrite"); t.objectStore("k").put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },

  // ключи ЭТОГО устройства для ЭТОГО аккаунта (у каждого аккаунта на устройстве свой набор)
  async ready() {
    if (!App.user) throw new Error("no user");
    if (Secret.ready_ && Secret.ready_.uid === App.user.id) return Secret.ready_.p;
    const uid = App.user.id;
    const p = (async () => {
      if (!Secret.supported()) throw new Error(T("Этот браузер не поддерживает шифрование"));
      let rec = null;
      try { rec = await Secret.idbGet("dev:" + uid); } catch (e) {}
      if (!rec || !rec.priv || !rec.pub) {
        const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
        const raw = await crypto.subtle.exportKey("raw", kp.publicKey);
        const id = "d" + Secret.b64(crypto.getRandomValues(new Uint8Array(12)));
        rec = { id, priv: kp.privateKey, pub: Secret.b64(raw) };
        try { await Secret.idbPut("dev:" + uid, rec); } catch (e) { console.warn("secret: ключ не сохранён на диск, будет жить до закрытия вкладки"); }
      }
      Secret.dev = rec.id; Secret.pub = rec.pub; Secret.priv = rec.priv;
      const label = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
      await api("/api/secret/keys", { method: "POST", body: { device: rec.id, pub: rec.pub, label: String(label).slice(0, 40) } });
      return rec;
    })();
    Secret.ready_ = { uid, p };
    p.catch(() => { if (Secret.ready_ && Secret.ready_.p === p) Secret.ready_ = null; });
    return p;
  },
  async aesKey(pubB64, devA, devB, cid) {
    const peer = await crypto.subtle.importKey("raw", Secret.unb64(pubB64), { name: "ECDH", namedCurve: "P-256" }, false, []);
    const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, Secret.priv, 256);
    const hk = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
    const info = Secret.enc.encode("dicegram-secret-v1|" + cid + "|" + [devA, devB].sort().join("|"));
    return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info }, hk, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  },
  aad(cid, sd) { return Secret.enc.encode("c" + cid + "|" + sd); },
  async keyset(cid, force) {
    const k = Secret.keys[cid];
    if (k && !force && Date.now() - k.t < 20000) return k;
    const d = await api("/api/secret/" + cid + "/keys");
    return (Secret.keys[cid] = { t: Date.now(), mine: d.mine, peer: d.peer });
  },
  // зашифровать текст для всех устройств двоих
  async seal(cid, obj) {
    await Secret.ready();
    const ks = await Secret.keyset(cid, true), plain = Secret.enc.encode(JSON.stringify(obj));
    const targets = ks.peer.concat(ks.mine);
    const copies = [];
    for (const t of targets) {
      const key = await Secret.aesKey(t.pub, Secret.dev, t.device, cid);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: Secret.aad(cid, Secret.dev) }, key, plain);
      copies.push({ d: t.device, iv: Secret.b64(iv), ct: Secret.b64(ct) });
    }
    return copies;
  },
  // расшифровать сообщение m (с полем c — копией для этого устройства); null — не получилось
  async open(cid, m) {
    if (m.kind === "svc") return { svc: m.svc };
    if (!m.c) return { lost: 1 };
    try {
      await Secret.ready();
      let ks = await Secret.keyset(cid), s = ks.mine.concat(ks.peer).find((x) => x.device === m.sd);
      if (!s) { ks = await Secret.keyset(cid, true); s = ks.mine.concat(ks.peer).find((x) => x.device === m.sd); }
      if (!s) return { lost: 1 };
      const key = await Secret.aesKey(s.pub, m.sd, Secret.dev, cid);
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Secret.unb64(m.c.iv), additionalData: Secret.aad(cid, m.sd) }, key, Secret.unb64(m.c.ct));
      return JSON.parse(Secret.dec.decode(pt));
    } catch (e) { return { lost: 1 }; }
  },
  // отпечаток ключей беседы: одинаков у обоих участников (сверьте голосом или лично)
  async fingerprint(cid) {
    const ks = await Secret.keyset(cid, true);
    const all = ks.mine.concat(ks.peer).map((x) => x.pub).sort().join("|");
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", Secret.enc.encode(all)));
    return [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("").match(/.{4}/g);
  },

  // ───────────── данные ─────────────
  byId(id) { return Secret.list.find((c) => c.id === id); },
  unreadTotal() { return Secret.list.reduce((s, c) => s + (c.status === "active" ? c.unread || 0 : 0) + (c.status === "pending" && !c.mine ? 1 : 0), 0); },
  async load() {
    if (!App.user) return;
    try {
      await Secret.ready();
      const d = await api("/api/secret/list?dev=" + encodeURIComponent(Secret.dev));
      Secret.list = d.chats || [];
      for (const c of Secret.list) { if (c.last) Secret.previewOf(c); }
      try { Chats.render(); } catch (e) {}
    } catch (e) { if (e && e.maint) return; console.warn("secret.load", e && e.message); }
  },
  async previewOf(c) {
    if (!c.last) return;
    const o = await Secret.open(c.id, c.last);
    c.prev = o && o.t ? o.t : "";
    if (o && o.lost) c.prev = "";
    try { Chats.render(); } catch (e) {}
  },
  upsert(c) {
    const i = Secret.list.findIndex((x) => x.id === c.id);
    if (i >= 0) Secret.list[i] = Object.assign(Secret.list[i], c); else Secret.list.unshift(c);
    try { Chats.render(); } catch (e) {}
  },
  remove(id) {
    Secret.list = Secret.list.filter((c) => c.id !== id); delete Secret.keys[id];
    try { Chats.render(); } catch (e) {}
  },

  // ───────────── вход: профиль → «⋮» → «Начать секретный чат» ─────────────
  async start(u) {
    if (!u || !u.id) return;
    if (!Secret.supported()) return toast(T("Этот браузер не поддерживает шифрование"));
    const ok = await UI.sheet({
      title: T("Секретный чат"), icon: Secret.LOCK,
      text: T("Сообщения шифруются сквозным шифрованием и читаются только на ваших устройствах и устройствах {0}. Их нельзя переслать, а таймер сотрёт их у обоих. {0} получит приглашение и должен его принять.", dispName(u)),
      actions: [{ label: T("Пригласить"), value: true, accent: true }], cancel: T("Отмена"),
    });
    if (!ok) return;
    try {
      await Secret.ready();
      const d = await api("/api/secret/start", { method: "POST", body: { user: u.id } });
      Secret.upsert(d.chat);
      haptic("medium");
      while (Nav.stack.length) { Nav.pop(); await new Promise((r) => setTimeout(r, 30)); }
      App.go("chats");
      Secret.open_(d.chat.id);
    } catch (e) { toast(e.message || T("Ошибка")); }
  },

  // ───────────── события по WebSocket ─────────────
  async onEvent(d) {
    if (d.ev === "invite") {
      Secret.upsert(d.chat);
      if (!Secret.cur) Secret.inviteSheet(d.chat);
    } else if (d.ev === "state") {
      const c = d.chat, was = Secret.cur && Secret.cur.id === c.id ? Secret.cur.status : "";      // до upsert: cur и элемент списка — один объект
      Secret.upsert(c);
      if (Secret.cur && Secret.cur.id === c.id) {
        Secret.cur = Object.assign(Secret.cur, c);
        if (was === "pending" && c.status === "active") { Secret.keys[c.id] = null; Secret.draw(true); Secret.loadMsgs(); } else Secret.paintHead();
      }
    } else if (d.ev === "gone") {
      const c = Secret.byId(d.chat), mine = d.by === (App.user && App.user.id);
      Secret.remove(d.chat);
      if (Secret.cur && Secret.cur.id === d.chat) {
        Secret.close(true);
        toast(d.why === "declined" ? T("Приглашение отклонено") : mine ? T("Переписка удалена у обоих") : T("Собеседник удалил переписку"));
      } else if (c && d.why === "declined" && !mine) toast(T("Приглашение в секретный чат отклонено"));
    } else if (d.ev === "msg") {
      const cid = d.chat, c = Secret.byId(cid);
      const m = d.msg;
      if (m.cs) m.c = m.cs.find((x) => x.d === Secret.dev) || null;
      if (Secret.cur && Secret.cur.id === cid) {
        if (Secret.msgs.some((x) => x.id === m.id)) return;
        const o = await Secret.open(cid, m); Object.assign(m, { o });
        Secret.msgs.push(m); Secret.drawMsgs(true);
        if (m.sender !== App.user.id && document.visibilityState === "visible") Secret.markRead();
      }
      if (c) {
        if (m.kind === "m") {
          c.last = m; c.upd = m.ts;
          if (!(Secret.cur && Secret.cur.id === cid && document.visibilityState === "visible") && m.sender !== App.user.id) c.unread = (c.unread || 0) + 1;
          Secret.previewOf(c);
        }
        try { Chats.render(); } catch (e) {}
      } else Secret.load();
      if (m.kind === "m" && m.sender !== App.user.id) { try { Notif.sound && Notif.sound(); } catch (e) {} }
    } else if (d.ev === "del") {
      const ids = new Set(d.ids || []);
      if (Secret.cur && Secret.cur.id === d.chat) { Secret.msgs = Secret.msgs.filter((m) => !ids.has(m.id)); Secret.drawMsgs(); }
      const c = Secret.byId(d.chat); if (c && c.last && ids.has(c.last.id)) { Secret.load(); }
    } else if (d.ev === "read") {
      if (Secret.cur && Secret.cur.id === d.chat) { Secret.peerRead = Math.max(Secret.peerRead, d.upto || 0); Secret.drawMsgs(); }
    }
  },
  inviteSheet(c) {
    if (Secret.invOpen) return;
    Secret.invOpen = true;
    UI.sheet({
      title: T("Секретный чат"), icon: Secret.LOCK,
      text: T("{0} приглашает вас в секретный чат со сквозным шифрованием.", dispName(c.peer)),
      actions: [{ label: T("Принять"), value: "ok", accent: true }, { label: T("Отклонить"), value: "no", danger: true }], cancel: T("Позже"),
    }).then(async (v) => {
      Secret.invOpen = false;
      if (v === "ok") Secret.accept(c.id); else if (v === "no") Secret.decline(c.id);
    });
  },
  async accept(id) {
    try {
      await Secret.ready();
      const d = await api("/api/secret/" + id + "/accept", { method: "POST", body: {} });
      Secret.upsert(d.chat); haptic("medium");
      if (Secret.cur && Secret.cur.id === id) { Secret.cur = Object.assign(Secret.cur, d.chat); Secret.draw(true); Secret.loadMsgs(); } else Secret.open_(id);
    } catch (e) { toast(e.message || T("Ошибка")); }
  },
  async decline(id) {
    try { await api("/api/secret/" + id + "/decline", { method: "POST", body: {} }); } catch (e) { toast(e.message || T("Ошибка")); }
    Secret.remove(id);
    if (Secret.cur && Secret.cur.id === id) Secret.close(true);
  },

  // ───────────── экран ─────────────
  el() {
    let el = $("secret");
    if (el) return el;
    el = document.createElement("section");
    el.id = "secret"; el.className = "page sec-page"; el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<header class="sec-head">
        <button class="icon-btn" data-a="back" aria-label="${esc(T("Назад"))}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>
        <button class="sec-hi" data-a="info"><span class="sec-av"></span><span class="sec-ti"><b class="sec-nm"></b><span class="sec-sub"><i class="sec-lk">${Secret.LOCK}</i><em>${esc(T("Защищённое соединение"))}</em></span></span></button>
        <button class="icon-btn sec-tm" data-a="timer" aria-label="${esc(T("Таймер автоудаления"))}">${Secret.TIMER}<i></i></button>
        <button class="icon-btn" data-a="more" aria-label="${esc(T("Ещё"))}"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg></button>
      </header>
      <div class="sec-body"><div class="sec-msgs" id="sec-msgs"></div><div class="sec-state" id="sec-state"></div></div>
      <div class="sec-comp" id="sec-comp"><div class="sec-pill"><textarea id="sec-in" rows="1" maxlength="4000" placeholder="${esc(T("Секретное сообщение"))}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="send"></textarea></div>
        <button class="sec-send" id="sec-send" type="button" aria-label="${esc(T("Отправить"))}" disabled>${Secret.SEND}</button></div>
      <div class="sec-hello" id="sec-hello"><div class="sh-lock">${Secret.LOCK}</div><b>${esc(T("Защищённое соединение"))}</b><span>${esc(T("Сквозное шифрование включено"))}</span></div>`;
    document.body.appendChild(el);
    el.addEventListener("click", (e) => {
      const a = e.target.closest("[data-a]");
      if (a) { const k = a.dataset.a; if (k === "back") return Nav.back(); if (k === "timer") return Secret.timerPick(); if (k === "more") return Secret.menu(); if (k === "info") return Secret.info(); if (k === "accept") return Secret.accept(Secret.cur.id); if (k === "decline") return Secret.decline(Secret.cur.id); if (k === "cancel") return Secret.cancelInvite(); }
      const b = e.target.closest(".sb");
      if (b && b.dataset.id) Secret.msgMenu(+b.dataset.id);
    });
    const inp = $("sec-in");
    inp.addEventListener("input", () => { inp.style.height = "auto"; inp.style.height = Math.min(inp.scrollHeight, 140) + "px"; $("sec-send").disabled = !inp.value.trim(); });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer:fine)").matches) { e.preventDefault(); Secret.send(); } });
    $("sec-send").addEventListener("pointerdown", (e) => e.preventDefault());
    $("sec-send").onclick = () => Secret.send();
    ["copy", "cut", "dragstart", "contextmenu"].forEach((ev) => $("sec-msgs").addEventListener(ev, (e) => e.preventDefault()));       // запрет копирования и пересылки
    $("sec-msgs").addEventListener("scroll", () => { Secret.pinned = $("sec-msgs").scrollHeight - $("sec-msgs").scrollTop - $("sec-msgs").clientHeight < 90; }, { passive: true });
    return el;
  },
  open_(id) {
    const c = Secret.byId(id); if (!c) return;
    const el = Secret.el();
    Secret.cur = c; Secret.msgs = []; Secret.peerRead = 0; Secret.pinned = true;
    $("sec-msgs").innerHTML = ""; $("sec-in").value = ""; $("sec-send").disabled = true;
    Secret.draw(true);
    Nav.open("secret", () => { Secret.cur = null; clearInterval(Secret.ttlT); Secret.ttlT = 0; el.classList.remove("hello"); try { Chats.render(); } catch (e) {} });
    clearInterval(Secret.ttlT); Secret.ttlT = setInterval(() => Secret.tick(), 1000);
    if (c.status === "active") Secret.loadMsgs();
  },
  close(silent) { if (Secret.cur && Nav.stack.some((x) => x.id === "secret")) { if (silent) { const i = Nav.stack.findIndex((x) => x.id === "secret"); if (i === Nav.stack.length - 1) Nav.back(); } else Nav.back(); } },
  paintHead() {
    const c = Secret.cur, el = $("secret"); if (!c || !el) return;
    el.querySelector(".sec-av").innerHTML = avatar(c.peer, "sm");
    el.querySelector(".sec-nm").innerHTML = nameHTML(c.peer);
    const tm = el.querySelector(".sec-tm"); tm.classList.toggle("on", !!c.ttl); tm.querySelector("i").textContent = c.ttl ? Secret.ttlShort(c.ttl) : "";
    tm.hidden = c.status !== "active";
    $("sec-comp").hidden = c.status !== "active";
  },
  ttlShort(s) { return s < 60 ? s + T("с") : s < 3600 ? Math.round(s / 60) + T("м") : s < 86400 ? Math.round(s / 3600) + T("ч") : Math.round(s / 86400) + T("д"); },
  ttlName(s) { const r = Secret.TTLS.find((x) => x[0] === s); return r ? T(r[1]) : s + " " + T("с"); },
  // что показать в основной области: приглашение, ожидание или переписку
  draw(hello) {
    const c = Secret.cur, el = $("secret"); if (!c) return;
    Secret.paintHead();
    const st = $("sec-state"), pend = c.status === "pending";
    st.innerHTML = !pend ? "" : c.mine
      ? `<div class="sec-card"><div class="sc-lock pulse">${Secret.LOCK}</div><h3>${esc(T("Ожидаем ответ"))}</h3><p>${esc(T("{0} получит приглашение. Как только он его примет, откроется защищённая переписка.", dispName(c.peer)))}</p><button class="sec-btn ghost" data-a="cancel">${esc(T("Отменить приглашение"))}</button></div>`
      : `<div class="sec-card"><div class="sc-lock pulse">${Secret.LOCK}</div><h3>${esc(T("Приглашение в секретный чат"))}</h3><p>${esc(T("{0} хочет начать с вами защищённую переписку со сквозным шифрованием.", dispName(c.peer)))}</p><div class="sec-btns"><button class="sec-btn" data-a="accept">${esc(T("Принять"))}</button><button class="sec-btn ghost danger" data-a="decline">${esc(T("Отклонить"))}</button></div></div>`;
    st.hidden = !pend; $("sec-msgs").hidden = pend;
    if (hello && !pend) { el.classList.remove("hello"); void el.offsetWidth; el.classList.add("hello"); clearTimeout(Secret.helloT); Secret.helloT = setTimeout(() => el.classList.remove("hello"), 1700); }
  },
  async cancelInvite() { await Secret.decline(Secret.cur.id); },
  async loadMsgs() {
    const c = Secret.cur; if (!c) return;
    try {
      await Secret.ready();
      const d = await api("/api/secret/" + c.id + "/messages?limit=200&dev=" + encodeURIComponent(Secret.dev));
      if (!Secret.cur || Secret.cur.id !== c.id) return;
      Secret.peerRead = d.peer_read || 0;
      const arr = d.messages;
      for (const m of arr) m.o = await Secret.open(c.id, m);
      Secret.msgs = arr; Secret.drawMsgs(true); Secret.markRead();
    } catch (e) { toast(e.message || T("Ошибка")); }
  },
  markRead() {
    const c = Secret.cur; if (!c || c.status !== "active") return;
    const top = Secret.msgs.reduce((s, m) => Math.max(s, m.id || 0), 0); if (!top) return;
    if (c.unread) { c.unread = 0; try { Chats.render(); } catch (e) {} }
    api("/api/secret/" + c.id + "/read", { method: "POST", body: { upto: top } }).catch(() => {});
  },

  // ───────────── сообщения ─────────────
  fmtLeft(exp) {
    const s = Math.max(0, exp - Math.floor(Date.now() / 1000));
    return s >= 3600 ? Math.ceil(s / 3600) + T("ч") : s >= 60 ? Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") : s + T("с");
  },
  svcText(m) {
    const s = m.svc || {}, me = s.by === (App.user && App.user.id), who = me ? T("Вы") : esc(String(s.name || "").split(" ")[0] || T("Собеседник"));
    if (s.t === "ttl") return s.ttl ? T("{0}: автоудаление через {1}", who, Secret.ttlName(s.ttl).toLowerCase()) : T("{0}: автоудаление выключено", who);
    return "";
  },
  msgHTML(m, prev, isNew) {
    if (m.kind === "svc") return `<div class="sec-svc${isNew ? " new" : ""}" data-id="${m.id}">${Secret.TIMER}<span>${Secret.svcText(m)}</span></div>`;
    const out = m.sender === App.user.id, o = m.o || {}, cont = prev && prev.kind !== "svc" && prev.sender === m.sender && m.ts - prev.ts < 120;
    const body = o.lost ? `<span class="sec-lost">${Secret.LOCK}${esc(T("Это сообщение нельзя расшифровать на этом устройстве"))}</span>` : `<span class="tx">${esc(o.t || "")}</span>`;
    const read = out && m.id <= Secret.peerRead;
    const ck = out ? `<span class="ck${read ? " r" : ""}"><svg viewBox="0 0 20 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 6.5 5 10 12 2"/>${read ? '<path d="m8 8.5 1.5 1.5L17 2"/>' : ""}</svg></span>` : "";
    const tm = m.exp ? `<span class="sx" data-exp="${m.exp}">${Secret.TIMER}${Secret.fmtLeft(m.exp)}</span>` : "";
    return `<div class="sb ${out ? "out" : "in"}${cont ? " cont" : ""}${isNew ? " new" : ""}" data-id="${m.id}">${body}<span class="tt">${tm}${fmtTime(m.ts)}${ck}</span></div>`;
  },
  introHTML() {
    const c = Secret.cur;
    return `<div class="sec-intro"><div class="si-lock">${Secret.LOCK}</div><h3>${esc(T("Секретный чат с {0}", dispName(c.peer)))}</h3>
      <ul><li>${esc(T("Сквозное шифрование: прочитать могут только вы двое"))}</li><li>${esc(T("Ключи хранятся только на устройствах"))}</li><li>${esc(T("Сообщения нельзя переслать"))}</li><li>${esc(T("Таймер сотрёт сообщения у обоих"))}</li></ul></div>`;
  },
  drawMsgs(scroll) {
    const box = $("sec-msgs"); if (!box || !Secret.cur) return;
    const now = Math.floor(Date.now() / 1000);
    Secret.msgs = Secret.msgs.filter((m) => !m.exp || m.exp > now);
    let html = Secret.introHTML(), prev = null, day = "";
    for (const m of Secret.msgs) {
      const dd = new Date(m.ts * 1000).toDateString();
      if (dd !== day) { day = dd; html += `<div class="sec-day">${esc(fmtDay(m.ts))}</div>`; }
      html += Secret.msgHTML(m, prev, !!m._new); m._new = false; prev = m;
    }
    const keep = box.scrollHeight - box.scrollTop;
    box.innerHTML = html;
    if (scroll || Secret.pinned) box.scrollTop = box.scrollHeight; else box.scrollTop = box.scrollHeight - keep;
  },
  tick() {
    const box = $("sec-msgs"); if (!box || !Secret.cur) return;
    const now = Math.floor(Date.now() / 1000); let gone = false;
    box.querySelectorAll(".sx[data-exp]").forEach((e) => { const x = +e.dataset.exp; if (x <= now) gone = true; else e.lastChild.textContent = Secret.fmtLeft(x); });
    if (gone) { const ids = new Set(Secret.msgs.filter((m) => m.exp && m.exp <= now).map((m) => m.id)); box.querySelectorAll(".sb").forEach((b) => { if (ids.has(+b.dataset.id)) { b.classList.add("burn"); setTimeout(() => Secret.drawMsgs(), 420); } }); }
  },
  async send() {
    const c = Secret.cur, inp = $("sec-in"), text = inp.value.trim();
    if (!c || c.status !== "active" || !text || Secret.busy) return;
    Secret.busy = true; $("sec-send").disabled = true;
    try {
      const copies = await Secret.seal(c.id, { t: text.slice(0, 4000), n: Date.now() });
      const d = await api("/api/secret/" + c.id + "/send", { method: "POST", body: { sd: Secret.dev, copies } });
      inp.value = ""; inp.style.height = "auto";
      const m = d.message; m.o = { t: text }; m._new = true;
      if (!Secret.msgs.some((x) => x.id === m.id)) Secret.msgs.push(m);
      c.last = m; c.upd = m.ts; c.prev = text;
      Secret.pinned = true; Secret.drawMsgs(true); haptic();
    } catch (e) { toast(e.message || T("Ошибка")); $("sec-send").disabled = false; }
    Secret.busy = false; $("sec-send").disabled = !inp.value.trim();
  },
  msgMenu(id) {
    const m = Secret.msgs.find((x) => x.id === id); if (!m) return;
    UI.sheet({ title: T("Сообщение"), text: T("Секретные сообщения нельзя переслать или скопировать."), actions: [{ label: T("Удалить у обоих"), value: "del", danger: true }], cancel: T("Закрыть") }).then(async (v) => {
      if (v !== "del") return;
      try { await api("/api/secret/" + Secret.cur.id + "/del", { method: "POST", body: { ids: [id] } }); } catch (e) { toast(e.message || T("Ошибка")); }
    });
  },

  // ───────────── меню, таймер, отпечаток ─────────────
  async timerPick() {
    const c = Secret.cur; if (!c || c.status !== "active") return;
    const v = await UI.sheet({
      title: T("Автоудаление"), icon: Secret.TIMER,
      text: T("Новые сообщения исчезнут у обоих через выбранное время после отправки. Сейчас: {0}", Secret.ttlName(c.ttl || 0).toLowerCase()),
      actions: Secret.TTLS.map(([s, n]) => ({ label: T(n) + ((c.ttl || 0) === s ? " ✓" : ""), value: s })), cancel: T("Отмена"),
    });
    if (v === null || v === undefined || v === (c.ttl || 0)) return;
    try { await api("/api/secret/" + c.id + "/ttl", { method: "POST", body: { ttl: v } }); } catch (e) { toast(e.message || T("Ошибка")); }
  },
  async menu() {
    const c = Secret.cur; if (!c) return;
    const A = [];
    if (c.status === "active") { A.push({ label: T("Таймер автоудаления"), value: "timer" }); A.push({ label: T("Ключ шифрования"), value: "key" }); }
    A.push({ label: T("Удалить переписку у обоих"), value: "del", danger: true });
    const v = await UI.sheet({ title: dispName(c.peer), actions: A, cancel: T("Закрыть") });
    if (v === "timer") Secret.timerPick(); else if (v === "key") Secret.info(); else if (v === "del") Secret.destroy();
  },
  async info() {
    const c = Secret.cur; if (!c) return;
    if (c.status !== "active") return;
    let fp = [];
    try { fp = await Secret.fingerprint(c.id); } catch (e) { return toast(e.message || T("Ошибка")); }
    const el = document.createElement("div");
    el.className = "sheet2";
    el.innerHTML = `<div class="s2-card" role="dialog"><div class="s2-ic">${Secret.LOCK}</div><h3>${esc(T("Ключ шифрования"))}</h3>
      <div class="sec-fp">${fp.map((g) => `<b>${g.toUpperCase()}</b>`).join("")}</div>
      <p>${esc(T("Если у собеседника на экране тот же ключ — переписка защищена. Сверьте его голосом или при встрече."))}</p>
      <div class="s2-btns"><button data-i="-1" class="s2-cancel">${esc(T("Закрыть"))}</button></div></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("button[data-i]")) { el.classList.remove("show"); setTimeout(() => el.remove(), 200); } });
  },
  async destroy() {
    const c = Secret.cur; if (!c) return;
    const ok = await UI.sheet({ title: T("Удалить секретный чат?"), text: T("Вся переписка будет стёрта у вас и у {0}. Это нельзя отменить.", dispName(c.peer)), actions: [{ label: T("Удалить у обоих"), value: true, danger: true }], cancel: T("Отмена") });
    if (!ok) return;
    try { await api("/api/secret/" + c.id + "/delete", { method: "POST", body: {} }); } catch (e) { toast(e.message || T("Ошибка")); }
  },

  // ───────────── список чатов ─────────────
  rowHTML(c) {
    const p = c.peer, inv = c.status === "pending";
    let prev;
    if (inv) prev = c.mine ? `<i class="sr-st">${esc(T("Ожидание ответа…"))}</i>` : `<i class="sr-st on">${esc(T("Приглашение в секретный чат"))}</i>`;
    else prev = c.last ? esc(c.prev ? c.prev : T("🔒 Зашифрованное сообщение")) : `<i class="sr-st">${esc(T("Защищённое соединение"))}</i>`;
    const who = !inv && c.last && c.last.sender === App.user.id ? `<b>${esc(T("Вы:"))}</b> ` : "";
    const un = c.unread || 0, badge = un > 0 ? `<span class="bdg sec">${un > 99 ? "99+" : un}</span>` : inv && !c.mine ? '<span class="bdg sec dot"></span>' : "";
    const t = c.last ? listTime(c.last.ts) : listTime(c.upd || c.ts);
    return `<button class="row chrow srow${un || (inv && !c.mine) ? " unr" : ""}" data-sid="${c.id}">
      <span class="crow-av">${avatar(p)}<i class="sr-lock">${Secret.LOCK}</i></span>
      <div class="crow-main">
        <div class="crow-top"><span class="crow-name"><i class="sr-ic">${Secret.LOCK}</i><span class="nm">${nameHTML(p)}</span></span><span class="crow-meta">${t}</span></div>
        <div class="crow-bot"><span class="crow-prev">${who}${prev}</span><span class="crow-end">${badge}</span></div>
      </div></button>`;
  },
  // строки секретных чатов вставляются в общий список по времени (приглашения — сверху)
  mix(rows, rowHtml) {
    const act = Secret.list.filter((c) => c.status === "active" || c.status === "pending");
    if (!act.length) return rows.map(rowHtml).join("");
    const pins = Chats.pins();
    const inv = act.filter((c) => c.status === "pending" && !c.mine), rest = act.filter((c) => !inv.includes(c));
    const tsOf = (c) => (c.last && c.last.ts) || c.upd || c.ts || 0;
    rest.sort((a, b) => tsOf(b) - tsOf(a));
    const items = rows.map((c) => ({ html: rowHtml(c), pin: pins.includes(c.peer.id), ts: (c.last && c.last.ts) || 0 }));
    for (const c of rest) {
      const ts = tsOf(c);
      let at = items.findIndex((x) => !x.pin && x.ts < ts); if (at < 0) at = items.length;
      items.splice(at, 0, { html: Secret.rowHTML(c), pin: false, ts });
    }
    return inv.map((c) => Secret.rowHTML(c)).join("") + items.map((x) => x.html).join("");
  },
  bindList() {
    const list = $("chat-list");
    list.addEventListener("click", (e) => {
      const r = e.target.closest(".srow"); if (!r) return;
      e.stopPropagation();
      if (Chats.noClick && Date.now() - Chats.noClick < 600) return;
      const c = Secret.byId(+r.dataset.sid); if (c) { haptic(); Secret.open_(c.id); }
    }, true);
    list.addEventListener("contextmenu", (e) => { if (e.target.closest(".srow")) e.preventDefault(); });
  },
  init() {
    try { Secret.bindList(); } catch (e) { console.warn("Secret.bindList", e); }
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Secret.cur) Secret.markRead(); });
  },
};
