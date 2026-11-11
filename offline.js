// offline.js — оффлайн-режим и мгновенное открытие чатов, как в Telegram.
// Последнее состояние (кто я, список чатов, последние сообщения каждого чата) лежит на устройстве в IndexedDB.
// Экран рисуется из кэша сразу, свежие данные с сервера приходят следом и тихо заменяют их.
// Нет интернета или сервер выключен — приложение всё равно открывается: чаты видны и читаются,
// скачанные фото/видео/музыка/файлы открываются из кэша Service Worker (sw.js).
const tmoC = (p, ms, fb) => Promise.race([Promise.resolve(p).catch(() => fb), new Promise((r) => setTimeout(() => r(fb), ms))]);

const OC = {
  db: null, mem: new Map(), ready: null, MAX_MSGS: 150, _t: {},

  // у каждого аккаунта свой кэш: ключ — короткий хэш его токена (сам токен в кэш не пишем)
  acc() {
    const t = Store.token || "";
    let h = 5381;
    for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
    return "a" + (h >>> 0).toString(36);
  },
  key(k) { return OC.acc() + ":" + k; },

  open() {
    if (OC.ready) return OC.ready;
    OC.ready = new Promise((res) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; res(v); } };
      try {
        const rq = indexedDB.open("dicegram-cache", 1);
        rq.onupgradeneeded = () => { try { rq.result.createObjectStore("kv"); } catch (e) {} };
        rq.onsuccess = () => { OC.db = rq.result; fin(OC.db); };
        rq.onerror = () => fin(null);
        rq.onblocked = () => fin(null);
      } catch (e) { fin(null); }
      setTimeout(() => fin(OC.db), 1500);   // в некоторых WebView IndexedDB может не отвечать — не ждём вечно
    });
    return OC.ready;
  },

  async get(k) {
    const key = OC.key(k);
    if (OC.mem.has(key)) return OC.mem.get(key);
    const db = await OC.open();
    if (!db) return null;
    return new Promise((res) => {
      try {
        const rq = db.transaction("kv", "readonly").objectStore("kv").get(key);
        rq.onsuccess = () => { const v = rq.result === undefined ? null : rq.result; if (v !== null) OC.mem.set(key, v); res(v); };
        rq.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  },
  async set(k, v) {
    const key = OC.key(k);
    OC.mem.set(key, v);
    if (OC.mem.size > 300) OC.mem.delete(OC.mem.keys().next().value);
    const db = await OC.open();
    if (!db) return;
    try { db.transaction("kv", "readwrite").objectStore("kv").put(v, key); } catch (e) {}
  },
  // запись реже: при частых изменениях (новые сообщения) пишем раз в ~0,7 с
  later(k, fn, ms = 700) {
    clearTimeout(OC._t[k]);
    OC._t[k] = setTimeout(() => { try { OC.set(k, fn()); } catch (e) {} }, ms);
  },
  // выход из аккаунта — его кэш стираем полностью
  async wipe() {
    const pre = OC.acc() + ":";
    for (const k of [...OC.mem.keys()]) if (k.startsWith(pre)) OC.mem.delete(k);
    const db = await OC.open();
    if (!db) return;
    try {
      const st = db.transaction("kv", "readwrite").objectStore("kv");
      const rq = st.openCursor();
      rq.onsuccess = () => { const c = rq.result; if (!c) return; if (String(c.key).startsWith(pre)) c.delete(); c.continue(); };
    } catch (e) {}
  },

  // ── что именно храним ──
  msgKey(peerId, topicId) { return "m:" + peerId + (topicId ? ":t" + topicId : ""); },
  clean(list) {
    return (list || []).filter((m) => m && m.id && !m.pending && !m.failed && !m.local).slice(-OC.MAX_MSGS)
      .map((m) => { const c = Object.assign({}, m); delete c.up; delete c.blob; delete c._c; return c; });
  },
  saveMe(u) { if (u && u.id) OC.set("me", u); },
  saveChats(list) { if (Array.isArray(list)) OC.later("chats", () => list); },
  // в памяти — сразу (повторный вход в чат видит свежую копию в тот же кадр), на диск — с задержкой
  saveMsgs(peerId, topicId, list) {
    const k = OC.msgKey(peerId, topicId), c = OC.clean(list);
    if (c.length) { OC.mem.set(OC.key(k), c); if (OC.mem.size > 300) OC.mem.delete(OC.mem.keys().next().value); }
    OC.later(k, () => OC.clean(list));
  },
  // уже лежит в памяти? (без обращения к IndexedDB)
  peek(k) { const v = OC.mem.get(OC.key(k)); return v === undefined ? null : v; },
  // фоновая подгрузка последних сообщений верхних чатов — чтобы они открывались сразу даже при слабом интернете
  async prefetch(list, n = 6) {
    try {
      const c = navigator.connection;
      if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ""))) return;
      let done = 0;
      for (const ch of list) {
        if (done >= n) break;
        const p = ch.peer; if (!p || p.is_system) continue;
        const k = OC.msgKey(p.id, 0);
        if (OC.peek(k)) continue;
        if (await tmoC(OC.get(k), 800, null)) continue;
        done++;
        try { const d = await api("/api/messages/" + p.id + "?limit=40&peek=1"); if (d && Array.isArray(d.messages) && d.messages.length) OC.saveMsgs(p.id, 0, d.messages); } catch (e) { return; }
        await new Promise((r) => setTimeout(r, 350));
      }
    } catch (e) {}
  },
  async appendMsg(peerId, m) {
    if (!m || !m.id) return;
    const k = OC.msgKey(peerId, m.topic || 0);
    const cur = (await OC.get(k)) || [];
    const i = cur.findIndex((x) => x.id === m.id);
    if (i >= 0) cur[i] = m; else cur.push(m);
    cur.sort((a, b) => a.id - b.id);
    OC.set(k, OC.clean(cur));
  },
  async dropMsgs(peerId, ids) {
    const k = OC.msgKey(peerId, 0), cur = await OC.get(k);
    if (!cur) return;
    const set = new Set(ids);
    OC.set(k, cur.filter((m) => !set.has(m.id)));
  },
};

// Подпись в шапке, пока нет связи с сервером: «Ожидание сети…» — нет интернета вообще,
// «Соединение…» — интернет есть, но сервер Dicegram пока не отвечает (как в Telegram).
const Net2 = {
  label() { return navigator.onLine === false ? T("Ожидание сети…") : T("Соединение…"); },
  paint() {
    const t = Net2.label();
    const c = $("conn"); if (c) c.textContent = t;
    document.querySelectorAll(".tt-off").forEach((e) => { e.textContent = t; });
  },
};
addEventListener("online", () => { try { Net2.paint(); } catch (e) {} });
addEventListener("offline", () => { try { Net2.paint(); } catch (e) {} });
