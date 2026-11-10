// groups.js — группы и каналы: служебные сообщения, шапка чата, выбор участников, темы, вступление по ссылке, выход.
// Группа или канал — это «собеседник» с отрицательным номером (peer.id < 0); peer.gk = "group" | "channel".
// Вид, права и настройки (профиль, права, ссылки, администраторы…) — в grp_edit.js.

const NAME_COLORS = ["#E17076", "#E8873F", "#A695E7", "#5DB24A", "#3FB4B9", "#4A9AD8", "#E0679E"];
const uColor = (id) => NAME_COLORS[Math.abs(+id || 0) % NAME_COLORS.length];

// ═════════════ тексты служебных сообщений и звонков ═════════════
const Svc = {
  dur(s) {
    s = Math.max(0, Math.round(s || 0));
    if (s < 60) return s + " " + T("сек.");
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
  },
  kindOf(m) { const c = Chats.byId(m.receiver); return (c && c.peer.gk) || (Chat.peer && Chat.peer.id === m.receiver && Chat.peer.gk) || "group"; },
  list(s) {
    const me = App.user.id, to = s.to || [];
    const names = to.map((x) => (x.id === me ? T("вас") : cleanName(x.name) || T("Пользователь")));
    let t = names.slice(0, 3).join(", ");
    const rest = to.length - Math.min(3, to.length) + (s.more || 0);
    if (rest > 0) t += " " + T("и ещё {0}", rest);
    return t;
  },
  text(m) {
    const s = m.svc || {}, by = s.by || {}, me = App.user.id, mine = by.id === me, ch = Svc.kindOf(m) === "channel";
    const who = mine ? T("Вы") : cleanName(by.name) || T("Пользователь"), L = Svc.list(s);
    switch (s.t) {
      case "create": return mine ? T(ch ? "Вы создали канал" : "Вы создали группу") : T(ch ? "Канал создан" : "{0} создал(а) группу", who);
      case "add": return (s.to || []).length === 1 && s.to[0].id === by.id ? (mine ? T("Вы вернулись в группу") : T("{0} вернулся в группу", who))
        : mine ? T("Вы добавили {0}", L) : T("{0} добавил(а) {1}", who, L);
      case "join": return mine ? T(ch ? "Вы подписались на канал" : "Вы вступили в группу") : T(ch ? "{0} подписался на канал" : "{0} вступил(а) в группу", who);
      case "leave": return mine ? T("Вы покинули группу") : T("{0} покинул(а) группу", who);
      case "kick": return mine ? T("Вы удалили {0}", L) : T("{0} удалил(а) {1}", who, L);
      case "ban": return mine ? T("Вы заблокировали {0}", L) : T("{0} заблокировал(а) {1}", who, L);
      case "promote": return mine ? T("Вы назначили {0} администратором", L) : T("{0} назначил(а) {1} администратором", who, L);
      case "demote": return mine ? T("Вы сняли {0} с должности администратора", L) : T("{0} снял(а) {1} с должности администратора", who, L);
      case "title": return mine ? T("Вы изменили название на «{0}»", s.x || "") : T("{0} изменил(а) название на «{1}»", who, s.x || "");
      case "photo": return mine ? T("Вы изменили фото группы") : T("{0} изменил(а) фото группы", who);
      case "topic": return mine ? T("Вы создали тему «{0}»", s.x || "") : T("{0} создал(а) тему «{1}»", who, s.x || "");
      case "vc_start": return mine ? T("Вы начали видеочат") : T("{0} начал(а) видеочат", who);
      case "vc_end": return T("Видеочат завершён · {0}", Svc.dur(+s.x || 0));
    }
    return T("Служебное сообщение");
  },
  // подпись звонка в списке и в переписке
  callText(m) {
    const c = m.call || {}, out = m.sender === App.user.id, v = !!c.v;
    const base = v ? T("видеозвонок") : T("звонок");
    switch (c.st) {
      case "ended": return (out ? (v ? T("Исходящий видеозвонок") : T("Исходящий звонок")) : (v ? T("Входящий видеозвонок") : T("Входящий звонок"))) + (c.dur ? " · " + Svc.dur(c.dur) : "");
      case "declined": return out ? T("Звонок отклонён") : T("Вы отклонили звонок");
      case "cancelled": return out ? T("Отменённый звонок") : T("Пропущенный звонок");
      case "busy": return out ? T("Занято") : T("Пропущенный звонок");
      case "offline": return out ? T("Собеседник не в сети") : T("Пропущенный звонок");
      case "missed": return out ? T("Нет ответа") : (v ? T("Пропущенный видеозвонок") : T("Пропущенный звонок"));
    }
    return T("Звонок") + " (" + base + ")";
  },
  callBad(m) { const c = m.call || {}, out = m.sender === App.user.id; return c.st === "missed" && !out || (c.st === "cancelled" && !out) || c.st === "busy" && !out || c.st === "declined" && out || c.st === "offline" || (c.st === "missed" && out); },
  // карточка «Вы создали группу · Возможности групп»
  intro(kind) {
    const ch = kind === "channel";
    const pts = ch ? ["Любое число подписчиков", "Публиковать могут только владелец и администраторы", "Реакции, пересылка постов и публичная ссылка", "Права администраторов настраиваются отдельно"]
      : ["Группы до 5000 участников", "Права участников, медленный режим и администраторы", "Приглашения по ссылке и публичный адрес", "Темы, реакции и видеочат"];
    return `<div class="intro-g"><b>${esc(T(ch ? "Вы создали канал" : "Вы создали группу"))}</b><span class="ig-t">${esc(T(ch ? "Возможности каналов:" : "Возможности групп:"))}</span>${pts.map((x) => `<span class="ig-p"><i></i>${esc(T(x))}</span>`).join("")}</div>`;
  },
};

// ═════════════ основное ═════════════
const Groups = {
  leaving: 0,

  init() {
    $("chat-call").onclick = () => Groups.headCall();
    $("chat-more").onclick = () => Groups.headMenu();
    $("addbar").onclick = () => { if (Chat.peer) Groups.addMembers(Chat.peer); };
    $("vcbar").onclick = () => { if (Chat.peer) Calls.joinVC(Chat.peer); };
  },

  // событие от сервера: чат изменился
  onChat(d) {
    const p = d.chat; if (!p) return;
    if (d.joined || !Chats.setPeer(p)) Chats.load();
    if (Chat.peer && Chat.peer.id === p.id) { Object.assign(Chat.peer, p); Chat.updateHeader(); }
    try { GroupEdit.onChat(p); } catch (e) {}
    try { Topics.onChat(p); } catch (e) {}
  },
  // новая заявка на вступление (приходит админам)
  onReq(d) {
    toast(T("{0} хочет вступить: {1}", (d.user && d.user.name) || "", d.title || ""));
    const c = Chats.byId(d.chat); if (c && c.peer) c.peer.reqs = d.n;
    try { if (GroupEdit.reqPg && GroupEdit.reqPg.alive) GroupEdit.reqPg.data.reload(); } catch (e) {}
  },
  // заявку одобрили — теперь мы в чате
  onJoinOk(d) {
    Chats.load();
    if (d.chat) toast(T("Вас приняли: {0}", d.chat.name || ""));
  },
  async onGone(id) {
    Chats.gone(id);
    const mine = Groups.leaving === id; Groups.leaving = 0;
    const open = (Chat.peer && Chat.peer.id === id) || (Topics.peer && Topics.peer.id === id) || (GroupEdit.cur && GroupEdit.cur.id === id);
    if (open) {
      await Nav.unwindWhile(() => true);
      if (!mine) toast(T("Вы больше не состоите в этом чате"));
    }
  },

  // свежие данные чата (права, число участников…)
  async refresh(peer) {
    try {
      const d = await api("/api/chat/" + peer.gid);
      Object.assign(peer, d.chat);
      const c = Chats.byId(peer.id); if (c && c.peer !== peer) Object.assign(c.peer, d.chat);
      if (Chat.peer && Chat.peer.id === peer.id) { if (Chat.peer !== peer) Object.assign(Chat.peer, d.chat); Chat.updateHeader(); }
      return d.chat;
    } catch (e) { return null; }
  },

  // ───────────── шапка чата ─────────────
  headCall() {
    const p = Chat.peer; if (!p) return;
    haptic();
    if (p.gk) return Calls.joinVC(p);
    Calls.start(p, false);
  },
  async headMenu() {
    const p = Chat.peer; if (!p) return;
    const A = [];
    if (p.gk) {
      A.push({ label: T(p.gk === "channel" ? "Информация о канале" : "Информация о группе"), value: "info" });
      if (p.vc || (p.rights && p.rights.calls)) A.push({ label: T("Видеочат"), value: "vc" });
      A.push({ label: Chats.isMuted(p.id) ? T("Включить звук") : T("Выключить звук"), value: "mute" });
      A.push({ label: T("Поиск по сообщениям"), value: "find" });
      A.push({ label: T(p.role === "owner" ? "Удалить и выйти" : p.gk === "channel" ? "Покинуть канал" : "Покинуть группу"), value: "leave", danger: true });
    } else if (p.is_system) {
      A.push({ label: T("Профиль"), value: "info" });
    } else {
      A.push({ label: T("Профиль"), value: "info" });
      A.push({ label: T("Позвонить"), value: "call" });
      A.push({ label: T("Видеозвонок"), value: "vcall" });
      A.push({ label: Chats.isMuted(p.id) ? T("Включить звук") : T("Выключить звук"), value: "mute" });
      A.push({ label: T("Поиск по сообщениям"), value: "find" });
      A.push({ label: T("Удалить чат"), value: "del", danger: true });
    }
    const v = await UI.sheet({ actions: A });
    if (!v) return;
    if (v === "info") return Chat.openProfile();
    if (v === "vc") return Calls.joinVC(p);
    if (v === "call") return Calls.start(p, false);
    if (v === "vcall") return Calls.start(p, true);
    if (v === "mute") return Chats.isMuted(p.id) ? Chats.setMute(p.id, false) : ChatPeek.act("mute", { peer: p, unread: 0 });
    if (v === "find") return Search.open("messages");
    if (v === "leave") return Groups.leave(p);
    if (v === "del") { const c = Chats.byId(p.id) || { peer: p }; await Chats.remove(c); if (!Chats.byId(p.id)) Nav.unwindWhile((t) => t.id === "chat"); }
  },

  // подсветить кнопки и панели в шапке: звонок / видеочат, «Добавить участников», «Идёт видеочат»
  syncBars() {
    const p = Chat.peer, call = $("chat-call"), more = $("chat-more"), add = $("addbar"), vc = $("vcbar");
    if (!p) return;
    const show = !(p.is_system) && !p.deleted && !(p.gk === "channel" && !p.vc && !(p.rights && p.rights.calls));
    call.classList.toggle("hidden", !show);
    more.classList.toggle("hidden", !!p.is_system);
    call.innerHTML = p.gk ? CALLI.vchat : CALLI.phone;
    call.setAttribute("aria-label", p.gk ? T("Видеочат") : T("Позвонить"));
    const needAdd = !!p.gk && (p.members || 0) <= 1 && !!p.can_invite && !Chat.topic;
    add.classList.toggle("hidden", !needAdd);
    if (needAdd) add.innerHTML = `<button type="button">${SI.userPlus}<span>${esc(T("Добавить участников"))}</span></button>`;
    const n = p.vc || 0;
    vc.classList.toggle("hidden", !n);
    if (n) vc.innerHTML = `<span class="vc-ic">${CALLI.vchat}</span><span class="vc-t"><b>${esc(T("Идёт видеочат"))}</b><small>${n} ${esc(plural(n, T("участник"), T("участника"), T("участников")))}</small></span><span class="vc-go">${esc(Calls.inVC(p) ? T("Открыть") : T("Присоединиться"))}</span>`;
  },

  // ───────────── вступление по ссылке ─────────────
  async joinPreview(slug) {
    if (!slug) return;
    let p;
    try { p = (await api("/api/join/" + encodeURIComponent(slug))).chat; }
    catch (e) { return toast(e.message || T("Ссылка недействительна или устарела")); }
    if (p.joined || p.role) { const c = Chats.byId(p.id); return Chats.openChat(c ? c.peer : p); }
    const ch = p.gk === "channel";
    if (p.banned) return UI.sheet({ icon: avatar(p), title: T(ch ? "Вы заблокированы в канале" : "Вы заблокированы в группе"), text: p.name, actions: [], cancel: T("Понятно") });
    const info = statusText(p) + (p.bio ? "\n\n" + p.bio : "");
    if (p.req && p.requested) return UI.sheet({ icon: avatar(p), title: p.name, text: info + "\n\n" + T("Запрос отправлен. Когда администратор его примет, вы получите уведомление."), actions: [], cancel: T("Понятно") });
    const ok = await UI.sheet({
      icon: avatar(p), title: p.name, text: p.req ? info + "\n\n" + T(ch ? "Подписаться на канал можно только после одобрения администратора." : "Вступить в группу можно только после одобрения администратора.") : info,
      actions: [{ label: p.req ? T("Отправить запрос на вступление") : T(ch ? "Подписаться" : "Вступить в группу"), value: true, accent: true }], cancel: T("Отмена"),
    });
    if (!ok) return;
    try {
      const d = await api("/api/join", { method: "POST", body: { slug } });
      if (d.requested) return toast(T("Запрос отправлен"));
      await Chats.load();
      const c = Chats.byId(d.chat.id);
      Chats.openChat(c ? c.peer : d.chat);
    } catch (e) { toast(e.message); }
  },

  // ───────────── выйти / удалить ─────────────
  async leave(peer) {
    const owner = peer.role === "owner", ch = peer.gk === "channel";
    const q = owner ? (ch ? "Вы точно хотите удалить и выйти из канала?" : "Вы точно хотите удалить и выйти из группы?")
      : (ch ? "Вы точно хотите выйти из канала?" : "Вы точно хотите выйти из группы?");
    const ok = await UI.sheet({ title: T(q), text: owner ? T("Все сообщения и участники будут удалены. Это нельзя отменить.") : "", actions: [{ label: T("Да"), value: true, danger: true }], cancel: T("Нет") });
    if (!ok) return false;
    try {
      Groups.leaving = peer.id;
      await api("/api/chat/" + peer.gid + "/leave", { method: "POST", body: {} });
      Chats.gone(peer.id);
      await Nav.unwindWhile(() => true);
      toast(T(owner ? (ch ? "Канал удалён" : "Группа удалена") : (ch ? "Вы вышли из канала" : "Вы вышли из группы")));
      return true;
    } catch (e) { Groups.leaving = 0; toast(e.message); return false; }
  },

  // ───────────── добавить участников ─────────────
  async addMembers(peer) {
    if (!peer.can_invite) return toast(T("Нет прав на добавление участников"));
    let have = new Set([App.user.id]);
    try { const d = await api("/api/chat/" + peer.gid + "/members?limit=200"); d.members.forEach((m) => have.add(m.user.id)); } catch (e) {}
    await Contacts.load();
    const cand = Contacts.people().filter((u) => !have.has(u.id));
    const links = { t: T("Пригласить по ссылке"), ic: SI.link, fn: () => GroupEdit.links(peer) };
    if (!cand.length) {
      const go = await UI.sheet({ title: T("Некого добавить"), text: T("Добавлять можно только тех, с кем вы уже общались. Остальных пригласите по ссылке."),
        actions: [{ label: T("Пригласить по ссылке"), value: true, accent: true }], cancel: T("Закрыть") });
      if (go) GroupEdit.links(peer);
      return;
    }
    Picker.open({
      title: T("Добавить участников"), people: cand, extra: [links], max: 50,
      onDone: async (ids) => {
        const d = await api("/api/chat/" + peer.gid + "/add", { method: "POST", body: { users: ids } });
        Object.assign(peer, d.chat);
        const sk = d.skipped || [];
        toast(sk.length ? T("Добавлено: {0}. Не добавлены (закрыли приглашения): {1}", (d.added || []).length, sk.map((x) => x.name).join(", ")) : T("Добавлено: {0}", (d.added || []).length));
        Chat.updateHeader(); Chats.render();
        try { GroupEdit.onChat(peer); } catch (e) {}
      },
    });
  },
};

const CALLI = {
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
  vchat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/><path d="M3 8v3M21 8v3"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2.5"/><path d="m16 10 6-3v10l-6-3z"/></svg>',
  in: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 7 7 17"/><path d="M17 17H7V7"/></svg>',
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>',
};

// ═════════════ выбор людей (добавить участников, назначить администратора) ═════════════
const Picker = {
  n: 0,
  // o: {title, people, onDone(ids), extra:[{t, ic, fn}], max, multi}
  open(o) {
    const id = "pick" + ++Picker.n, sel = new Set(), multi = o.multi !== false;
    let q = "", busy = false;
    const el = document.createElement("section");
    el.id = id; el.className = "page tgp"; el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<header class="tg-head">
        <button class="icon-btn" data-back aria-label="${esc(T("Назад"))}">${SI.back.replace("<svg ", '<svg width="22" height="22" ')}</button>
        <div class="tg-title">${esc(o.title)}<small data-cnt></small></div>
      </header>
      <div class="nm-chips hidden" data-chips></div>
      <label class="nm-search">${SI.search}<input data-q placeholder="${esc(T("Поиск"))}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <div class="nm-body" data-body></div>
      ${multi ? `<button class="fab2 off" data-ok aria-label="${esc(T("Готово"))}">${SI.check}</button>` : ""}`;
    document.body.appendChild(el);
    void el.offsetWidth;
    Nav.open(id, () => setTimeout(() => el.remove(), 320));
    const body = el.querySelector("[data-body]"), chips = el.querySelector("[data-chips]"), cnt = el.querySelector("[data-cnt]"), fab = el.querySelector("[data-ok]");
    const draw = () => {
      const ex = !q && o.extra ? o.extra.map((x, i) => `<button class="nm-act" data-ex="${i}">${x.ic || ""}<span>${esc(x.t)}</span></button>`).join("") + '<div class="nm-sep"></div>' : "";
      body.innerHTML = ex + ContactList.html(o.people, { q, sel, solo: !multi });
      chips.classList.toggle("hidden", !sel.size);
      chips.innerHTML = [...sel].map((i) => { const u = o.people.find((x) => x.id === i); return u ? `<button class="nm-chip" data-rm="${i}">${avatar(u)}<span>${esc(u.name || dispName(u))}</span></button>` : ""; }).join("");
      cnt.textContent = multi ? (sel.size ? T("Выбрано: {0}", sel.size) : "") : "";
      if (fab) fab.classList.toggle("off", !sel.size || busy);
    };
    draw();
    el.querySelector("[data-q]").addEventListener("input", (e) => { q = e.target.value.trim(); draw(); });
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-back]")) return Nav.back();
      const ex = e.target.closest("[data-ex]");
      if (ex) { haptic(); const x = o.extra[+ex.dataset.ex]; if (x.fn) x.fn(); return; }
      const rm = e.target.closest("[data-rm]");
      if (rm) { sel.delete(+rm.dataset.rm); haptic(); return draw(); }
      const row = e.target.closest(".nm-row");
      if (row) {
        const i = +row.dataset.id; haptic();
        if (!multi) { await Nav.unwindWhile((t) => t.id === id); try { await o.onDone([i]); } catch (er) { toast(er.message); } return; }
        if (sel.has(i)) sel.delete(i); else { if (o.max && sel.size >= o.max) return toast(T("Не больше {0} за раз", o.max)); sel.add(i); }
        const sc = body.scrollTop; draw(); body.scrollTop = sc; return;
      }
      if (e.target.closest("[data-ok]") && sel.size && !busy) {
        busy = true; draw();
        try { await o.onDone([...sel]); Nav.back(); } catch (er) { busy = false; draw(); toast(er.message); }
      }
    });
    ContactList.bindIndex(body);
    setTimeout(() => { try { el.querySelector("[data-q]").focus(); } catch (e) {} }, 320);
    return el;
  },
};

// ═════════════ темы (форум): список тем группы ═════════════
const TCOL = ["#6FB9F0", "#FFD67E", "#CB86DB", "#8EEE98", "#FF93B2", "#FB6F5F", "#7E7EF0", "#F5A25D"];
const Topics = {
  el: null, peer: null, list: [], timer: 0,

  async open(peer) {
    if (Topics.el) return;
    Topics.peer = peer;
    const el = (Topics.el = document.createElement("section"));
    el.id = "topics"; el.className = "page tgp"; el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<header class="tg-head">
        <button class="icon-btn" data-back aria-label="${esc(T("Назад"))}">${SI.back.replace("<svg ", '<svg width="22" height="22" ')}</button>
        <button class="headinfo tp-h" data-info><span data-av></span><span class="cinfo"><span class="name" data-name></span><span class="sub2" data-sub style="color:var(--hdr-d)"></span></span></button>
        <button class="icon-btn" data-vc aria-label="${esc(T("Видеочат"))}">${CALLI.vchat}</button>
      </header>
      <div class="sr-body" data-body></div>
      <button class="fab2 off" data-new aria-label="${esc(T("Новая тема"))}">${SI.plus}</button>`;
    document.body.appendChild(el);
    void el.offsetWidth;
    Nav.open("topics", () => { Topics.el = null; Topics.peer = null; clearTimeout(Topics.timer); setTimeout(() => el.remove(), 320); Chats.load(); });
    Topics.head();
    Topics.draw();
    el.addEventListener("click", (e) => Topics.click(e));
    let lp = 0;
    el.addEventListener("touchstart", (e) => { const r = e.target.closest(".tp-row"); if (!r) return; lp = setTimeout(() => { Chats.noClick = Date.now(); Topics.menu(+r.dataset.id); }, 450); }, { passive: true });
    ["touchend", "touchmove", "touchcancel"].forEach((ev) => el.addEventListener(ev, () => clearTimeout(lp), { passive: true }));
    el.addEventListener("contextmenu", (e) => { const r = e.target.closest(".tp-row"); if (r) { e.preventDefault(); Topics.menu(+r.dataset.id); } });
    await Topics.load();
    Groups.refresh(peer).then(() => { if (Topics.el === el) Topics.head(); });
  },

  head() {
    const el = Topics.el, p = Topics.peer; if (!el || !p) return;
    el.querySelector("[data-av]").innerHTML = avatar(p, "sm");
    el.querySelector("[data-name]").innerHTML = nameHTML(p);
    el.querySelector("[data-sub]").textContent = statusText(p);
    el.querySelector("[data-new]").classList.toggle("off", !Topics.canCreate());
    el.querySelector("[data-vc]").classList.toggle("hidden", !(p.vc || (p.rights && p.rights.calls)));
  },
  canCreate() { const p = Topics.peer; return !!p && ((p.rights && p.rights.topics) || (p.perms && p.perms.topics)); },
  canManage() { const p = Topics.peer; return !!p && !!(p.rights && p.rights.topics); },

  async load() {
    const p = Topics.peer; if (!p) return;
    try {
      const d = await api("/api/chat/" + p.gid + "/topics");
      if (Topics.peer !== p) return;
      Topics.list = d.topics || []; Topics.draw();
    } catch (e) { toast(e.message); }
  },
  touch() { clearTimeout(Topics.timer); Topics.timer = setTimeout(() => Topics.load(), 400); },
  onChat(p) { if (Topics.peer && Topics.peer.id === p.id) { Object.assign(Topics.peer, p); Topics.head(); Topics.touch(); } },

  icon(t) {
    const c = TCOL[(t.color || 0) % TCOL.length];
    if (t.general) return `<span class="tp-ic" style="background:var(--accent)">#</span>`;
    return `<span class="tp-ic" style="background:${c}">${t.emoji ? esc(t.emoji) : esc(Array.from(t.title)[0] || "#").toUpperCase()}</span>`;
  },
  draw() {
    const el = Topics.el; if (!el) return;
    const body = el.querySelector("[data-body]"), L = Topics.list;
    if (!L.length) { body.innerHTML = '<div class="sr-load"><div class="spin"></div></div>'; return; }
    body.innerHTML = L.map((t) => {
      const m = t.last, mine = m && m.sender === App.user.id;
      let pv = "";
      if (m) {
        const who = m.kind === "svc" || m.kind === "call" ? "" : mine ? `<b>${esc(T("Вы:"))}</b> ` : m.from ? `<b>${esc(String(m.from.name || "").split(" ")[0])}:</b> ` : "";
        pv = who + esc(Chats.previewOf({ last: m, peer: Topics.peer }));
      } else pv = esc(T("Сообщений пока нет"));
      return `<button class="chrow tp-row" data-id="${t.id}">${Topics.icon(t)}<div class="crow-main"><div class="crow-top"><span class="crow-name"><span class="nm">${esc(t.general ? T("Общий") : t.title)}</span>${t.closed ? '<svg class="ci" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>' : ""}</span><span class="crow-meta">${m ? esc(listTime(m.ts)) : ""}</span></div>
        <div class="crow-bot"><span class="crow-prev">${pv}</span></div></div></button>`;
    }).join("");
  },

  click(e) {
    if (Chats.noClick && Date.now() - Chats.noClick < 600) return;
    if (e.target.closest("[data-back]")) return Nav.back();
    if (e.target.closest("[data-info]")) return GroupEdit.profile(Topics.peer);
    if (e.target.closest("[data-vc]")) return Calls.joinVC(Topics.peer);
    if (e.target.closest("[data-new]")) return Topics.create();
    const r = e.target.closest(".tp-row"); if (!r) return;
    const t = Topics.list.find((x) => x.id === +r.dataset.id); if (!t) return;
    Chat.open(Topics.peer, { topic: t });
  },

  async create() {
    if (!Topics.canCreate()) return;
    const title = await UI.prompt({ title: T("Новая тема"), placeholder: T("Название темы"), ok: T("Создать"), type: "text" });
    if (!title) return;
    try {
      const color = Math.floor(Math.random() * TCOL.length);
      const d = await api("/api/chat/" + Topics.peer.gid + "/topic", { method: "POST", body: { title, color } });
      await Topics.load();
      const t = Topics.list.find((x) => x.id === d.topic.id) || d.topic;
      Chat.open(Topics.peer, { topic: t });
    } catch (e) { toast(e.message); }
  },

  async menu(id) {
    const t = Topics.list.find((x) => x.id === id); if (!t || t.general || !Topics.canManage()) return;
    haptic("medium");
    const v = await UI.sheet({ title: t.title, actions: [
      { label: T("Переименовать"), value: "ren" }, { label: T(t.closed ? "Открыть тему" : "Закрыть тему"), value: "close" }, { label: T("Удалить тему"), value: "del", danger: true }] });
    if (!v) return;
    const gid = Topics.peer.gid;
    try {
      if (v === "ren") {
        const n = await UI.prompt({ title: T("Название темы"), value: t.title, ok: T("Сохранить"), type: "text" });
        if (!n) return;
        await api(`/api/chat/${gid}/topic/edit`, { method: "POST", body: { id, title: n } });
      } else if (v === "close") await api(`/api/chat/${gid}/topic/edit`, { method: "POST", body: { id, closed: !t.closed } });
      else if (v === "del") {
        if (!(await UI.sheet({ title: T("Удалить тему?"), text: T("Все сообщения в ней будут удалены."), actions: [{ label: T("Удалить"), value: true, danger: true }] }))) return;
        await api(`/api/chat/${gid}/topic/delete`, { method: "POST", body: { id } });
      }
      Topics.load();
    } catch (e) { toast(e.message); }
  },
};
