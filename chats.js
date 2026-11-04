
// Вкладка «Чаты»: список диалогов, групп и каналов в стиле Telegram.
// Закрепление, «звук», «непрочитано» хранятся в облаке (prefs), поэтому одинаковы на всех устройствах.
// Нажатие на аватарку — «тихий» просмотр чата (собеседник не увидит, что вы прочитали), долгое нажатие — просмотр и меню.
// папки живут в set_misc.js; если файл не загрузился, список чатов всё равно работает (просто без папок)
const FO = () => (typeof Folders !== "undefined" ? Folders : { get: () => [], count: () => 0, has: () => true });

const CI = {
  group: '<svg class="ci grp" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="8" r="3.3"/><path d="M2.5 19.5c0-3.4 2.9-5.5 6.5-5.5s6.5 2.1 6.5 5.5z"/><circle cx="17" cy="9" r="2.6" opacity=".7"/><path d="M16.8 14.2c2.7.1 4.7 1.7 4.7 4.3h-4.2c0-1.8-.5-3.2-1.4-4.1z" opacity=".7"/></svg>',
  channel: '<svg class="ci grp" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 17-6v14L3 13z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>',
  mute: '<svg class="ci" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-9.3-5"/><path d="M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M3 3l18 18"/></svg>',
  pin: '<svg class="pn" viewBox="0 0 24 24" fill="currentColor"><path d="M14 3.5 20.5 10l-2 .6-3.4 3.4.9 4.2-1.4 1.4-3.6-3.6-5.4 5.4-1-1 5.4-5.4-3.6-3.6 1.4-1.4 4.2.9L13.4 5.5z"/></svg>',
};
const CMI = {
  pin: svg('<path d="M12 17v5"/><path d="M9 4h6l-1 6 3 3H7l3-3z"/>'),
  unpin: svg('<path d="M12 17v5"/><path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M3 3l18 18"/>'),
  mute: svg('<path d="M18 8a6 6 0 0 0-9.3-5"/><path d="M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M3 3l18 18"/>'),
  bell: svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
  read: svg('<path d="m2.5 12.5 4.5 4.5L16.5 7.5"/><path d="m11 16.5 1 .9L21.5 7.5"/>'),
  unread: svg('<circle cx="12" cy="12" r="5" fill="currentColor"/><circle cx="12" cy="12" r="9.5"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  del: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>'),
  out: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
  open: svg('<path d="M21 12a8.5 8.5 0 0 1-12.4 7.5L3 21l1.6-5.3A8.5 8.5 0 1 1 21 12z"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
};
// небольшие картинки для пустых экранов (свои, нарисованные кодом)
const ILL = {
  chat: '<svg class="ill" viewBox="0 0 160 160"><defs><linearGradient id="gi1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="color-mix(in srgb,var(--accent) 55%,#7A5CFF)"/></linearGradient></defs><circle cx="80" cy="80" r="70" fill="color-mix(in srgb,var(--accent) 12%,transparent)"/><path d="M40 56a14 14 0 0 1 14-14h52a14 14 0 0 1 14 14v30a14 14 0 0 1-14 14H74l-18 14v-14h-2a14 14 0 0 1-14-14z" fill="url(#gi1)"/><circle cx="62" cy="71" r="5" fill="#fff"/><circle cx="80" cy="71" r="5" fill="#fff"/><circle cx="98" cy="71" r="5" fill="#fff"/><path d="M96 104h22a10 10 0 0 1 10 10v10l-12-8H96a10 10 0 0 1-10-10v-1" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" opacity=".5"/></svg>',
  none: '<svg class="ill" viewBox="0 0 160 160"><circle cx="80" cy="84" r="64" fill="color-mix(in srgb,var(--accent) 10%,transparent)"/><circle cx="72" cy="72" r="34" fill="color-mix(in srgb,var(--accent) 18%,var(--list-bg,#fff))" stroke="var(--accent)" stroke-width="7"/><path d="m97 97 30 30" stroke="var(--accent)" stroke-width="11" stroke-linecap="round"/><circle cx="60" cy="68" r="4.2" fill="var(--accent)"/><circle cx="84" cy="68" r="4.2" fill="var(--accent)"/><path d="M60 88c4-6 20-6 24 0" fill="none" stroke="var(--accent)" stroke-width="4.5" stroke-linecap="round"/><path d="M38 40l6 8M120 52l8-4M132 76l9 1" stroke="var(--accent)" stroke-width="3.5" stroke-linecap="round" opacity=".45"/></svg>',
};

const Chats = {
  list: [], folder: "all", noClick: 0,

  // ───────────── закрепы, звук, «непрочитано» ─────────────
  pins() { const a = Prefs.cloud("chat_pins", []); return Array.isArray(a) ? a : []; },
  isPinned(id) { return Chats.pins().includes(id); },
  muteMap() { const m = Prefs.cloud("chat_mute", {}); return m && typeof m === "object" ? m : {}; },
  isMuted(id) { const v = Chats.muteMap()[String(id)]; return v === true || (typeof v === "number" && v * 1000 > Date.now()); },
  unrMarks() { const a = Prefs.cloud("chat_unr", []); return Array.isArray(a) ? a : []; },
  markedUnread(id) { return Chats.unrMarks().includes(id); },
  async setPin(id, on) {
    let a = Chats.pins().filter((x) => x !== id);
    if (on) { if (a.length >= 10) return toast(T("Можно закрепить не больше 10 чатов")); a.unshift(id); }
    try { await Prefs.cloudSet("chat_pins", a); } catch (e) {}
    Chats.render();
  },
  async setMute(id, until) {              // until: false — включить звук, true — навсегда, число — до момента (секунды)
    const m = Object.assign({}, Chats.muteMap());
    for (const k of Object.keys(m)) if (typeof m[k] === "number" && m[k] * 1000 <= Date.now()) delete m[k];
    if (until) m[String(id)] = until; else delete m[String(id)];
    try { await Prefs.cloudSet("chat_mute", Object.keys(m).length ? m : null); } catch (e) {}
    Chats.render();
  },
  async setUnread(id, on) {
    const a = Chats.unrMarks().filter((x) => x !== id);
    if (on) a.push(id);
    try { await Prefs.cloudSet("chat_unr", a.length ? a : null); } catch (e) {}
    Chats.render();
  },

  byId(id) { return Chats.list.find((c) => c.peer.id === id); },
  // порядок в списке: сначала закреплённые (в порядке закрепления), затем по времени последнего сообщения
  sorted() {
    const pins = Chats.pins();
    return Chats.list.slice().sort((a, b) => {
      const pa = pins.indexOf(a.peer.id), pb = pins.indexOf(b.peer.id);
      if (pa >= 0 || pb >= 0) return pa < 0 ? 1 : pb < 0 ? -1 : pa - pb;
      return (b.last.id || 0) - (a.last.id || 0);
    });
  },

  // открыть чат: в группе с темами сначала список тем
  openChat(peer) {
    if (peer.gk === "group" && peer.topics && typeof Topics !== "undefined") return Topics.open(peer);
    return Chat.open(peer);
  },

  bind() {
    const list = $("chat-list");
    $("btn-search").onclick = () => { haptic(); Search.open(); };
    $("chat-fab").onclick = () => { haptic(); NewMsg.open(); };
    $("ftabs").addEventListener("click", (e) => {
      const b = e.target.closest(".ftab"); if (!b) return;
      Chats.folder = b.dataset.f; haptic(); Chats.render(); list.scrollTop = 0;
    });
    list.addEventListener("click", (e) => {
      if (Chats.noClick && Date.now() - Chats.noClick < 600) return;
      const r = e.target.closest(".chrow"); if (!r) return;
      const c = Chats.byId(+r.dataset.id); if (!c) return;
      if (e.target.closest(".crow-av")) { haptic(); return ChatPeek.open(c, false); }       // тихий просмотр, ничего не отмечается прочитанным
      Chats.openChat(c.peer);
    });
    // долгое нажатие: просмотр чата и меню
    let lp = 0, st = null;
    const stop = () => { clearTimeout(lp); if (st) st.r.classList.remove("press"); st = null; };
    list.addEventListener("touchstart", (e) => {
      const r = e.target.closest(".chrow"); if (!r || e.touches.length > 1) return;
      st = { r, x: e.touches[0].clientX, y: e.touches[0].clientY };
      lp = setTimeout(() => {
        const c = Chats.byId(+r.dataset.id); r.classList.remove("press"); st = null;
        if (c) { Chats.noClick = Date.now(); haptic("medium"); ChatPeek.open(c, true); }
      }, 420);
      setTimeout(() => { if (st && st.r === r) r.classList.add("press"); }, 120);
    }, { passive: true });
    list.addEventListener("touchmove", (e) => {
      if (!st) return;
      if (Math.abs(e.touches[0].clientX - st.x) > 9 || Math.abs(e.touches[0].clientY - st.y) > 9) stop();
    }, { passive: true });
    list.addEventListener("touchend", stop, { passive: true });
    list.addEventListener("touchcancel", stop, { passive: true });
    list.addEventListener("contextmenu", (e) => {
      const r = e.target.closest(".chrow"); if (!r) return;
      e.preventDefault();
      const c = Chats.byId(+r.dataset.id);
      if (c && !ChatPeek.el) { Chats.noClick = Date.now(); ChatPeek.open(c, true); }
    });
    // кнопка «+» прячется, когда листаем вниз, и возвращается при прокрутке вверх
    let last = 0;
    list.addEventListener("scroll", () => {
      const y = list.scrollTop;
      $("chat-fab").classList.toggle("hide", y > last + 4 && y > 120);
      if (y < last - 4 || y < 120) $("chat-fab").classList.remove("hide");
      last = y;
    }, { passive: true });
  },

  async load() {
    try { Chats.list = (await api("/api/chats")).chats; Chats.render(); Stories.load(); } catch (e) {}
  },

  upsert(peer, m, incoming) {
    let i = Chats.list.findIndex((c) => c.peer.id === peer.id), c;
    if (i < 0) c = { peer, last: m, unread: 0 };
    else { c = Chats.list.splice(i, 1)[0]; c.last = m; if (peer !== c.peer && peer.gk) c.peer = Object.assign(c.peer, peer); }
    const viewing = Chat.peer && Chat.peer.id === peer.id && document.visibilityState === "visible";
    if (incoming && !viewing && m.kind !== "svc") c.unread++;
    Chats.list.unshift(c); Chats.render();
  },

  // чат, в который пришло сообщение (для личных — собеседник, для групп — сама группа)
  peerOf(m) { return m.receiver < 0 ? m.receiver : (m.sender === App.user.id ? m.receiver : m.sender); },

  onMessage(m) {
    const mine = m.sender === App.user.id, pid = Chats.peerOf(m);
    const c = Chats.byId(pid);
    if (!c) return Chats.load();
    if (c.last && c.last.id === m.id) return;
    Chats.upsert(c.peer, m, !mine);
  },

  // сообщение изменили: если оно последнее в чате — обновляем подпись в списке
  onEdit(m) {
    const c = Chats.byId(Chats.peerOf(m));
    if (c && c.last && c.last.id === m.id) { c.last = m; Chats.render(); }
  },

  markRead(pid) {
    const c = Chats.byId(pid);
    let ch = false;
    if (c && c.unread) { c.unread = 0; ch = true; }
    if (Chats.markedUnread(pid)) { Chats.setUnread(pid, false); ch = false; }
    if (ch) Chats.render();
  },

  // событие «чат изменился» (название, права, число участников)
  setPeer(p) {
    const c = Chats.byId(p.id);
    if (!c) return false;
    Object.assign(c.peer, p);
    Chats.render();
    return true;
  },
  gone(id) {
    const n = Chats.list.length;
    Chats.list = Chats.list.filter((c) => c.peer.id !== id);
    if (Chats.list.length !== n) Chats.render();
  },

  // подпись последнего сообщения
  previewOf(c) {
    const m = c.last, p = c.peer;
    if (!m) return "";
    let t;
    if (m.kind === "svc") t = typeof Svc !== "undefined" ? Svc.text(m) : "";
    else if (m.kind === "call") t = typeof Svc !== "undefined" ? Svc.callText(m) : T("Звонок");
    else if (m.kind === "greet") t = m.text || "";
    else t = Rich.preview(m);
    return String(t || "").split("\n")[0];
  },

  // вкладки папок над списком чатов
  tabs() {
    const box = $("ftabs"), fs = FO().get();
    if (!fs.length) { box.classList.add("hidden"); Chats.folder = "all"; return; }
    if (Chats.folder !== "all" && !fs.some((f) => f.id === Chats.folder)) Chats.folder = "all";
    const unreadChats = Chats.list.filter((c) => (c.unread > 0 || Chats.markedUnread(c.peer.id)) && !Chats.isMuted(c.peer.id)).length;
    box.classList.remove("hidden");
    box.innerHTML = [{ id: "all", n: T("Все чаты"), k: unreadChats }].concat(fs.map((f) => ({ id: f.id, n: f.n, k: FO().count(f) })))
      .map((f) => `<button class="ftab${Chats.folder === f.id ? " on" : ""}" role="tab" data-f="${esc(f.id)}">${esc(f.n)}${f.k ? `<i class="fb">${f.k}</i>` : ""}</button>`).join("");
    const on = box.querySelector(".ftab.on"); if (on && on.scrollIntoView) { try { on.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {} }
  },

  rowHTML(c) {
    const p = c.peer, m = c.last, id = p.id, mine = m.sender === App.user.id;
    const muted = Chats.isMuted(id), pinned = Chats.isPinned(id), mu = Chats.markedUnread(id);
    const unread = c.unread || 0, unr = unread > 0 || mu;
    const fl = Prefs.get("ftags", false) && Chats.folder === "all" ? FO().get().find((x) => !x.f && x.c.includes(id)) : null;
    const icon = p.gk === "channel" ? CI.channel : p.gk === "group" ? CI.group : "";
    let who = "";
    if (m.kind !== "svc" && m.kind !== "call" && m.kind !== "greet") {
      if (mine) who = `<b>${esc(T("Вы:"))}</b> `;
      else if (p.gk === "group" && m.from) who = `<b>${esc(String(m.from.name || "").split(" ")[0])}:</b> `;
    }
    const checks = mine && !p.gk && m.kind !== "svc" && m.kind !== "call" ? (m.is_read ? CK2 : CK1) : "";
    const badge = unread > 0 ? `<span class="bdg${muted ? " mut" : ""}">${unread > 999 ? "999+" : unread}</span>` : mu ? `<span class="bdg dot${muted ? " mut" : ""}"></span>` : pinned ? CI.pin : "";
    const dot = p.online && !p.gk && !p.is_system ? '<i class="on-dot"></i>' : "";
    return `<button class="row chrow${pinned ? " pin" : ""}${unr ? " unr" : ""}" data-k="c" data-id="${id}">
      <span class="crow-av">${Stories.av(p)}${dot}</span>
      <div class="crow-main">
        <div class="crow-top"><span class="crow-name">${icon}<span class="nm">${nameHTML(p)}</span>${fl ? `<span class="ftag">${esc(fl.n)}</span>` : ""}${muted ? CI.mute : ""}</span><span class="crow-meta">${checks}${listTime(m.ts)}</span></div>
        <div class="crow-bot"><span class="crow-prev">${who}${esc(Chats.previewOf(c))}</span><span class="crow-end">${badge}</span></div>
      </div></button>`;
  },

  render() {
    // число на значке — сообщения из чатов со включённым звуком
    const total = Chats.list.reduce((s, c) => s + (Chats.isMuted(c.peer.id) ? 0 : c.unread), 0)
      + Chats.list.reduce((s, c) => s + (c.unread === 0 && Chats.markedUnread(c.peer.id) && !Chats.isMuted(c.peer.id) ? 1 : 0), 0);
    const b = $("tab-badge"); b.textContent = total > 99 ? "99+" : total; b.classList.toggle("hidden", !total);
    try { Notif.badge(total); } catch (e) {}
    try { Chats.tabs(); } catch (e) {}
    const box = $("chat-list");
    if (!Chats.list.length) {
      box.innerHTML = `<div class="cempty">${ILL.chat}<h3>${esc(T("Пока нет чатов"))}</h3><p>${esc(T("Нажмите на кнопку внизу, чтобы написать кому-нибудь, создать группу или канал. Найти человека можно через поиск."))}</p></div>`;
      return;
    }
    const fl = Chats.folder === "all" ? null : FO().get().find((f) => f.id === Chats.folder);
    const rows = Chats.sorted().filter((c) => !fl || FO().has(fl, c));
    box.innerHTML = rows.length ? rows.map((c) => Chats.rowHTML(c)).join("")
      : `<div class="cempty">${ILL.none}<h3>${esc(T("В папке нет чатов"))}</h3><p>${esc(T("Добавьте чаты в папку: Настройки → Папки с чатами."))}</p></div>`;
  },
};

// ═════════════ быстрый (тихий) просмотр чата + меню чата ═════════════
const ChatPeek = {
  el: null, release: null,

  async open(c, menu) {
    if (ChatPeek.el) return;
    const p = c.peer, el = (ChatPeek.el = document.createElement("div"));
    el.className = "peek";
    const sub = p.gk ? statusText(p) : p.is_system ? statusText(p) : statusText(p);
    el.innerHTML = `<div class="pk-card" role="dialog">
        <div class="pk-head">${avatar(p)}<div class="tx"><b>${nameHTML(p)}</b><small>${esc(sub)}</small></div><span class="quiet">${CMI.eye}${esc(T("Тихо"))}</span></div>
        <div class="pk-msgs"><div class="pk-none">${esc(T("Загрузка…"))}</div></div>
        ${menu ? "" : `<div class="pk-foot"><button data-x>${esc(T("Закрыть"))}</button><button class="go" data-go>${esc(T("Открыть чат"))}</button></div>`}
      </div>${menu ? `<div class="pk-menu">${ChatPeek.items(c).map((it) => `<button data-a="${it.a}" class="${it.danger ? "danger" : ""}">${it.ic}<span>${esc(it.t)}</span></button>`).join("")}</div>` : ""}`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    ChatPeek.release = Nav.layer(() => ChatPeek.hide());
    el.addEventListener("click", (e) => {
      const a = e.target.closest("[data-a]");
      if (a) { const f = a.dataset.a; ChatPeek.close(); return setTimeout(() => ChatPeek.act(f, c), 60); }
      if (e.target.closest("[data-go]")) { ChatPeek.close(); return setTimeout(() => Chats.openChat(p), 60); }
      if (e.target.closest("[data-x]") || e.target === el) ChatPeek.close();
    });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    // peek=1: сообщения не помечаются прочитанными, второй галочки у собеседника не будет
    try {
      const d = await api("/api/messages/" + p.id + "?limit=24&peek=1");
      if (ChatPeek.el !== el) return;
      const box = el.querySelector(".pk-msgs");
      box.innerHTML = ChatPeek.render(d.messages, p) || `<div class="pk-none">${esc(T("Сообщений пока нет"))}</div>`;
      box.scrollTop = box.scrollHeight;
    } catch (e) { if (ChatPeek.el === el) el.querySelector(".pk-msgs").innerHTML = `<div class="pk-none">${esc(e.message || T("Не удалось загрузить"))}</div>`; }
  },

  render(msgs, p) {
    let html = "", day = "";
    for (const m of msgs) {
      const d = new Date(m.ts * 1000).toDateString();
      if (d !== day) { day = d; html += `<div class="pk-day">${esc(fmtDay(m.ts))}</div>`; }
      const k = m.kind || "text", out = m.sender === App.user.id;
      if (k === "svc") { html += `<div class="pk-svc">${esc(typeof Svc !== "undefined" ? Svc.text(m) : "")}</div>`; continue; }
      if (k === "call") { html += `<div class="pk-svc">${esc(typeof Svc !== "undefined" ? Svc.callText(m) : T("Звонок"))}</div>`; continue; }
      const a = m.att || {};
      const who = p.gk === "group" && !out && m.from ? `<span class="who">${esc(m.from.name || "")}</span>` : "";
      const tm = `<i>${esc(fmtTime(m.ts))}</i>`;
      if ((k === "photo" || k === "gif") && (a.turl || a.url) && !/video/.test(a.mime || "")) {
        html += `<div class="pk-b med ${out ? "out" : "in"}">${who}<img src="${esc(fileUrl(k === "gif" ? a.url : a.turl || a.url))}" alt=""></div>`;
        if (m.text) html += `<div class="pk-b ${out ? "out" : "in"}">${esc(m.text)}${tm}</div>`;
        continue;
      }
      const t = k === "text" || k === "greet" ? m.text : Rich.preview(m);
      html += `<div class="pk-b ${out ? "out" : "in"}">${who}${esc(t || "")}${tm}</div>`;
    }
    return html;
  },

  items(c) {
    const p = c.peer, id = p.id, L = [];
    L.push({ a: "open", t: T("Открыть чат"), ic: CMI.open });
    L.push({ a: Chats.isPinned(id) ? "unpin" : "pin", t: Chats.isPinned(id) ? T("Открепить") : T("Закрепить"), ic: Chats.isPinned(id) ? CMI.unpin : CMI.pin });
    L.push({ a: Chats.isMuted(id) ? "unmute" : "mute", t: Chats.isMuted(id) ? T("Включить звук") : T("Выключить звук"), ic: Chats.isMuted(id) ? CMI.bell : CMI.mute });
    const unr = c.unread > 0 || Chats.markedUnread(id);
    L.push({ a: unr ? "read" : "unread", t: unr ? T("Прочитано") : T("Отметить непрочитанным"), ic: unr ? CMI.read : CMI.unread });
    if (FO().get().some((f) => !f.f)) L.push({ a: "folder", t: T("Добавить в папку"), ic: CMI.folder });
    const owner = p.gk && p.role === "owner";
    L.push({ a: "del", t: p.gk ? (owner ? T("Удалить и выйти") : p.gk === "channel" ? T("Покинуть канал") : T("Покинуть группу")) : T("Удалить чат"), ic: p.gk ? CMI.out : CMI.del, danger: true });
    return L;
  },

  async act(a, c) {
    const p = c.peer, id = p.id;
    if (a === "open") return Chats.openChat(p);
    if (a === "pin") return Chats.setPin(id, true);
    if (a === "unpin") return Chats.setPin(id, false);
    if (a === "unmute") return Chats.setMute(id, false);
    if (a === "mute") {
      const v = await UI.sheet({ title: T("Выключить звук"), actions: [
        { label: T("На 1 час"), value: 3600 }, { label: T("На 8 часов"), value: 8 * 3600 }, { label: T("На 2 дня"), value: 2 * 86400 }, { label: T("Навсегда"), value: -1 }] });
      if (!v) return;
      return Chats.setMute(id, v < 0 ? true : Math.floor(Date.now() / 1000) + v);
    }
    if (a === "read") {
      if (c.unread) { c.unread = 0; Chats.render(); try { await api("/api/read/" + id, { method: "POST", body: {} }); } catch (e) {} }
      return Chats.setUnread(id, false);
    }
    if (a === "unread") return Chats.setUnread(id, true);
    if (a === "folder") {
      const fs = FO().get().filter((f) => !f.f);
      const v = await UI.sheet({ title: T("Добавить в папку"), actions: fs.map((f) => ({ label: (f.c.includes(id) ? "✓ " : "") + f.n, value: f.id })) });
      if (!v) return;
      const f = fs.find((x) => x.id === v); if (!f) return;
      const d = Object.assign({}, f, { c: f.c.includes(id) ? f.c.filter((x) => x !== id) : f.c.concat(id) });
      return Folders.put(d);
    }
    if (a === "del") return Chats.remove(c);
  },

  close() { if (!ChatPeek.el) return; ChatPeek.el.classList.add("out"); if (ChatPeek.release) ChatPeek.release(); else ChatPeek.hide(); },
  hide() {
    const el = ChatPeek.el; if (!el) return;
    ChatPeek.el = null; ChatPeek.release = null;
    el.classList.remove("show");
    setTimeout(() => el.remove(), 230);
  },
};

// удалить чат (в группе — выйти; владелец — удалить)
Chats.remove = async function (c) {
  const p = c.peer;
  if (p.gk && typeof Groups !== "undefined") return Groups.leave(p);
  const ok = await UI.sheet({ title: T("Удалить чат?"), text: T("Переписка исчезнет только у вас, у собеседника останется."), actions: [{ label: T("Удалить"), value: true, danger: true }] });
  if (!ok) return;
  try { await api("/api/chats/delete", { method: "POST", body: { peer: p.id } }); Chats.list = Chats.list.filter((x) => x.peer.id !== p.id); Chats.render(); toast(T("Чат удалён")); }
  catch (e) { toast(e.message); }
};
