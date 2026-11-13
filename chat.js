// Экран переписки: сообщения всех видов, отправка (текст, голос, файлы, стикеры), ответы, реакции, закрепы, правка, удаление.
const CK1 = '<svg class="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const CK2 = '<svg class="ck read" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m2.5 12.5 4.5 4.5L16.5 7.5"/><path d="m11 16.5 1 .9L21.5 7.5"/></svg>';
const CLK = '<svg class="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
const FAIL = '<svg class="ck fail" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 16.5v.1"/></svg>';
const TIMER_I = '<svg class="xi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/></svg>';
const X_SVG = '<svg class="x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>';
const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
const CMNT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.2-5.3A8 8 0 1 1 21 12z"/></svg>';
const CMNT_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';

const SYS = 1;     // официальный аккаунт: его сообщения могут содержать **жирный** и `код`
const PAGE = 50;   // сколько сообщений грузим за раз
const mkey = (m) => (m.cid ? "c" + m.cid : "i" + m.id);
const same = (a, b) => !!((a.cid && b.cid && a.cid === b.cid) || (a.id && b.id && a.id === b.id));
const stIcon = (m) => (m.failed ? FAIL : m.pending ? CLK : m.is_read ? CK2 : CK1);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const newCid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const sendAtt = (a) => {
  if (!a) return undefined;
  const o = {};
  ["fid", "tfid", "w", "h", "dur", "wave", "b", "em"].forEach((k) => { if (a[k] !== undefined && a[k] !== null) o[k] = a[k]; });
  return o;
};

// «печатает…»: свои — сообщаем собеседнику не чаще раза в 3 с; чужие — показываем в шапке чата и в списке чатов.
const Typing = {
  map: {}, last: 0, lastAct: "", TTL: 6000,
  // мы печатаем / записываем голосовое
  send(act = "typing") {
    const p = Chat.peer;
    if (!p || p.is_system || p.deleted || (p.gk === "channel") || !App.ws || App.ws.readyState !== 1) return;
    if (!Prefs.get("send_typing", true)) return;
    const now = Date.now();
    if (now - Typing.last < 3000 && act === Typing.lastAct) return;
    Typing.last = now; Typing.lastAct = act;
    try { App.ws.send(JSON.stringify({ type: "typing", to: p.id, act, topic: Chat.topic && Chat.topic.id })); } catch (e) {}
  },
  // кто-то печатает у нас
  on(d) {
    if (!d || !d.chat || d.from === (App.user && App.user.id)) return;
    const k = String(d.chat), now = Date.now();
    const m = (Typing.map[k] = Typing.map[k] || {});
    m[d.from] = { act: d.act || "typing", name: d.name || "", topic: d.topic || 0, until: now + Typing.TTL };
    Typing.paint(d.chat);
    clearTimeout(Typing["t" + k]);
    Typing["t" + k] = setTimeout(() => Typing.sweep(d.chat), Typing.TTL + 50);
  },
  // пришло сообщение — значит, человек уже не печатает
  stop(chat, from) {
    const m = Typing.map[String(chat)];
    if (m && m[from]) { delete m[from]; Typing.paint(chat); }
  },
  sweep(chat) {
    const m = Typing.map[String(chat)], now = Date.now();
    if (!m) return;
    Object.keys(m).forEach((u) => { if (m[u].until <= now) delete m[u]; });
    Typing.paint(chat);
  },
  // «печатает…», «Иван печатает…», «Иван и Пётр печатают…», «записывает голосовое…»
  text(chat, topic) {
    const m = Typing.map[String(chat)];
    if (!m) return "";
    const now = Date.now();
    const list = Object.values(m).filter((x) => x.until > now && (!topic || !x.topic || x.topic === topic));
    if (!list.length) return "";
    const act = list[0].act;
    const verb = { voice: "записывает голосовое", video: "записывает видео", file: "отправляет файл", photo: "отправляет фото", sticker: "выбирает стикер" }[act] || "печатает";
    if (chat > 0) return T(verb) + "…";
    const names = list.map((x) => String(x.name || "").split(" ")[0]).filter(Boolean);
    if (list.length === 1) return T("{0} " + verb, names[0] || T("Кто-то")) + "…";
    if (list.length === 2) return T("{0} и {1} печатают", names[0], names[1]) + "…";
    return T("{0} и ещё {1} печатают", names[0], list.length - 1) + "…";
  },
  paint(chat) {
    try {
      if (Chat.peer && Chat.peer.id === +chat) Chat.paintSub();
      const row = document.querySelector(`.chrow[data-id="${chat}"] .crow-prev`);
      if (row) {
        const t = Typing.text(+chat);
        if (t) { if (!row.dataset.keep) row.dataset.keep = row.innerHTML; row.innerHTML = `<span class="typing-tx">${esc(t)}</span>`; }
        else if (row.dataset.keep !== undefined) { row.innerHTML = row.dataset.keep; delete row.dataset.keep; }
      }
    } catch (e) {}
  },
};

// Очередь «отправить, когда появится связь» — как часики у сообщений в Telegram без интернета.
// Текстовые сообщения переживают и перезапуск приложения (лежат в кэше устройства).
const Outbox = {
  q: [], busy: false,
  add(m) { if (!Outbox.q.some((x) => x.cid === m.cid)) Outbox.q.push(m); Outbox.persist(); },
  done(m) { const n = Outbox.q.length; Outbox.q = Outbox.q.filter((x) => x.cid !== m.cid); if (n !== Outbox.q.length) Outbox.persist(); },
  persist() {
    const keep = Outbox.q.filter((m) => !m.file).map((m) => ({ cid: m.cid, sender: m.sender, receiver: (m._peer && m._peer.id) || m.receiver, ts: m.ts,
      kind: m.kind, text: m.text, ents: m.ents, att: m.att ? sendAtt(m.att) : undefined, reply_to: m.reply_to, reply: m.reply, topic: m.topic }));
    OC.set("outbox", keep);
  },
  async restore() {
    const a = await tmoC(OC.get("outbox"), 1000, null);
    if (!Array.isArray(a)) return;
    a.forEach((x) => { if (x && x.cid && !Outbox.q.some((q) => q.cid === x.cid)) Outbox.q.push(Object.assign({ pending: true, is_read: 0 }, x)); });
  },
  forPeer(id, topic) { return Outbox.q.filter((m) => ((m._peer && m._peer.id) || m.receiver) === id && (m.topic || 0) === (topic || 0)); },
  async flush() {
    if (Outbox.busy || !Outbox.q.length) return;
    Outbox.busy = true;
    try {
      for (const m of Outbox.q.slice()) {
        if (m.file) continue;                 // файл досылается своей загрузкой (кнопка повтора)
        if (!(await Chat.transmit(m))) break;  // снова нет связи — ждём следующего раза
      }
    } finally { Outbox.busy = false; }
  },
};

const Chat = {
  peer: null, topic: null, msgs: [], pins: [], pinI: 0, lastDay: "", loading: false, hasMore: false, loadingMore: false,
  replyTo: null, editing: null, kb: 0, vhMax: 0, dl: new Set(), quick: [],

  // ───────────── подключение событий ─────────────
  bind() {
    Editor.init(); Voice.bind(); Player.init(); Panel.bind();
    Editor.onChange = () => { Chat.syncMain(); Chat.quickCheck(); try { BotUI.onInput(); } catch (e) {} if (!Editor.isEmpty()) Typing.send("typing"); };
    const inp = Editor.el, box = $("msgs"), main = $("btn-main");

    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer:fine)").matches) { e.preventDefault(); Chat.send(); }
    });
    // тап по полю, когда открыта своя панель: возвращаем обычную клавиатуру
    inp.addEventListener("click", () => {
      if (Panel.open) Panel.toKeyboard();
    });
    inp.addEventListener("focus", () => { if (!Panel.open) inp.setAttribute("inputmode", "text"); });

    main.addEventListener("pointerdown", (e) => { if (Chat.mainMode() !== "mic") e.preventDefault(); });   // клавиатура не закрывается
    main.addEventListener("click", () => {
      if (Voice.st === "locked") return Voice.swallow ? undefined : Voice.finish(true);
      if (Chat.mainMode() !== "mic") Chat.send();
    });
    $("btn-emoji").addEventListener("pointerdown", (e) => e.preventDefault());
    $("btn-emoji").onclick = () => Panel.toggle();
    try { BotUI.init(); } catch (e) {}
    $("btn-attach").addEventListener("pointerdown", (e) => e.preventDefault());
    $("btn-attach").onclick = () => Attach.menu();
    $("cb-x").onclick = () => (Chat.editing ? Chat.cancelEdit() : Chat.clearReply());
    $("chat-head").onclick = () => Chat.openProfile();
    $("pinbar").addEventListener("click", (e) => Chat.pinClick(e));
    $("jump").onclick = () => box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });

    // высота клавиатуры — для панели эмодзи такой же высоты
    if (window.visualViewport) {
      visualViewport.addEventListener("resize", () => {
        Chat.vhMax = Math.max(Chat.vhMax, visualViewport.height);
        const kb = Chat.vhMax - visualViewport.height;
        if (kb > 150) Chat.kb = kb;
      });
    }

    box.addEventListener("scroll", () => {
      if (box.scrollTop < 140) Chat.more();
      const gap = box.scrollHeight - box.scrollTop - box.clientHeight;
      Chat.pinned = gap < 90;
      $("jump").classList.toggle("hidden", gap < 420);
    }, { passive: true });
    // поле ввода в фокусе — держим низ переписки видимым (клавиатура сжимает экран не сразу)
    inp.addEventListener("focus", () => { if (Chat.pinned !== false) [60, 260, 520].forEach((t) => setTimeout(() => Chat.onViewport(true), t)); });

    Chat.bindTouch(box);
    box.addEventListener("contextmenu", (e) => { e.preventDefault(); const b = e.target.closest(".b"); if (b) MsgMenu.open(b, Chat.byEl(b)); });
    box.addEventListener("click", (e) => Chat.tap(e));
  },

  // экран сжался/разжался (клавиатура): если были внизу переписки — остаёмся внизу
  onViewport(force) {
    const box = $("msgs");
    if (!box || !(force || Chat.pinned !== false)) return;
    requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  },

  byEl(b) { return b ? Chat.msgs.find((x) => mkey(x) === b.dataset.k) : null; },

  // долгое нажатие → меню; свайп влево → ответить
  bindTouch(box) {
    let lp = 0, sw = null, st = null;
    const stop = () => clearTimeout(lp);
    box.addEventListener("touchstart", (e) => {
      const b = e.target.closest(".b");
      if (!b || e.touches.length > 1) return;
      const t = e.touches[0];
      st = { b, x: t.clientX, y: t.clientY };
      sw = null;
      lp = setTimeout(() => { st = null; Chat.noTap = Date.now(); const m = Chat.byEl(b); if (m) MsgMenu.open(b, m, true); }, 430);
    }, { passive: true });
    box.addEventListener("touchmove", (e) => {
      if (!st) return;
      const t = e.touches[0], dx = t.clientX - st.x, dy = t.clientY - st.y;
      if (!sw && (Math.abs(dx) > 9 || Math.abs(dy) > 9)) {
        stop();
        if (Math.abs(dx) > Math.abs(dy) * 1.4 && dx < 0) { sw = { b: st.b, m: Chat.byEl(st.b) }; sw.b.classList.add("swiping"); }
        else { st = null; return; }
      }
      if (sw) {
        if (e.cancelable) e.preventDefault();
        const d = clamp(dx, -90, 0);
        sw.b.style.transform = `translateX(${d}px)`;
        sw.b.style.setProperty("--sw", String(clamp(-d / 56, 0, 1)));
        if (!sw.hit && -d >= 56) { sw.hit = true; haptic("light"); } else if (sw.hit && -d < 56) sw.hit = false;
      }
    }, { passive: false });
    const end = () => {
      stop();
      if (MsgMenu.ov) MsgMenu.guard = Date.now();
      if (sw) {
        const { b, m, hit } = sw;
        b.classList.remove("swiping"); b.style.transform = ""; b.style.removeProperty("--sw");
        if (hit && m && !m.pending) Chat.setReply(m);
        Chat.noTap = Date.now();
      }
      sw = null; st = null;
    };
    box.addEventListener("touchend", end, { passive: true });
    box.addEventListener("touchcancel", end, { passive: true });
  },

  // тапы по содержимому пузырей
  tap(e) {
    if (Chat.noTap && Date.now() - Chat.noTap < 400) return;
    const gc = e.target.closest(".gcard");
    if (gc) { const gm = Chat.byEl(gc); if (gm && gm.gift) { haptic(); Gifts.tap(gm.gift, gm); } return; }
    const cm = e.target.closest(".cmbar");
    if (cm) { const m = Chat.msgs.find((x) => x.id === +cm.dataset.id); if (m) Chat.openComments(m); return; }
    const b = e.target.closest(".b");
    if (!b) return;
    const m = Chat.byEl(b), t = e.target;
    if (!m) return;
    const bem = t.closest(".bem");
    if (bem) { Fx.play(bem); return; }
    const sp = t.closest(".sp");
    if (sp) { sp.classList.toggle("open"); return; }
    if (t.closest("a")) return;                                       // ссылки открывает общий обработчик
    const chip = t.closest(".rx-chip");
    if (chip) { Chat.react(m, chip.dataset.e); return; }
    const kbb = t.closest(".ikb-b");
    if (kbb) return Chat.kbPress(m, kbb);
    if (t.closest(".upl")) { if (m.up && m.up.ctl) m.up.ctl.abort(); return; }
    if (b.classList.contains("failed")) return Chat.resend(m);
    if (t.closest(".rq")) { if (m.reply && !m.reply.gone) Chat.jumpTo(m.reply.id); return; }
    const a = m.att || {};
    if (t.closest(".vm-stt")) return Stt.press(m);
    if (t.closest(".vm-play")) return Player.toggle(mkey(m), fileUrl(a.url));
    if (t.closest(".vm-spd")) return Player.speed();
    const wv = t.closest(".vm-wave");
    if (wv) {
      const r = wv.getBoundingClientRect();
      Player.seek(mkey(m), clamp((e.clientX - r.left) / r.width, 0, 1), fileUrl(a.url));
      if (Player.a.paused) Player.toggle(mkey(m), fileUrl(a.url));
      return;
    }
    const ga = t.closest(".gav, .gname");
    if (ga) { const f = m.from || {}, id = +ga.dataset.uid || m.sender; return id === App.user.id ? undefined : UserProfile.open({ id, name: f.name || "", surname: f.surname || "", username: "", avatar: f.avatar || "", bio: "" }); }
    if (t.closest(".callb")) return Chat.peer && Calls.start(Chat.peer, !!(m.call && m.call.v));
    const fl = t.closest(".fwl");
    if (fl && m.fw && m.fw.id < 0) { const c = Chats.byId(m.fw.id); return c ? Chats.openChat(c.peer) : toast(T("Канал недоступен")); }
    if (fl && m.fw && m.fw.id) return UserProfile.open({ id: m.fw.id, name: m.fw.name || "", surname: "", username: "", avatar: "", bio: "" });
    if (t.closest(".media.dl")) { Chat.dl.add(mkey(m)); Chat.patch(m); return; }
    if (t.closest(".media") && a.url) return Viewer.open(a.fid ? Object.assign({}, a, { url: a.url }) : a);
    if (t.closest(".au-pl") && a.url && !m.pending) { haptic(); return Music.tap(a); }
    if (t.closest(".fcard") && a.url && !m.pending) return FV.open(a);
    // двойное касание текста — быстрая реакция
    if (m.id && (m.kind === "text" || !m.kind)) {
      const now = Date.now();
      if (Chat.lastTap && Chat.lastTap.k === b.dataset.k && now - Chat.lastTap.t < 300) { Chat.lastTap = null; Chat.react(m, Prefs.get("qr", "❤️"), true); }
      else Chat.lastTap = { k: b.dataset.k, t: now };
    }
  },

  // ───────────── заголовок и открытие ─────────────
  updateHeader() {
    const p = Chat.peer; if (!p) return;
    $("chat-av").innerHTML = Stories.av(p, "sm");
    if (Chat.topic) $("chat-name").textContent = (Chat.topic.general ? T("Общий") : Chat.topic.title);
    else $("chat-name").innerHTML = nameHTML(p);
    Chat.paintSub();
    try { Groups.syncBars(); Chat.applyAccess(); } catch (e) {}
    if (p.slow_left > 0 && !(Chat.slowEnd[p.id] > Date.now())) Chat.slowEnd[p.id] = Date.now() + p.slow_left * 1000;
    Chat.slowTick();
    try { BotUI.sync(); } catch (e) {}
  },

  paintSub() {
    const p = Chat.peer, s = $("chat-sub"); if (!p || !s) return;
    const ty = Typing.text(p.id, Chat.topic && Chat.topic.id);
    s.classList.toggle("typing", !!ty);
    if (ty) { s.innerHTML = `<span class="typing-dots"><i></i><i></i><i></i></span>${esc(ty)}`; s.classList.add("on"); return; }
    if (Chat.topic) { s.textContent = dispName(p) + " · " + statusText(p); s.classList.remove("on"); }
    else { s.textContent = p.deleted ? "" : statusText(p); s.classList.toggle("on", !!p.online && !p.is_system && !p.gk); }
  },

  openProfile() {
    const p = Chat.peer; if (!p) return;
    if (p.saved) return;                                       // профиль «Избранного» не открывается — как в Telegram
    if (p.gk) return GroupEdit.profile(p);
    UserProfile.open(p);
  },

  // ── медленный режим: на кнопке отправки бежит обратный отсчёт, как в Telegram ──
  slowEnd: {},
  slowLeft() {
    const p = Chat.peer; if (!p || p.gk !== "group" || !p.slow || p.role !== "member") return 0;
    return Math.max(0, Math.ceil(((Chat.slowEnd[p.id] || 0) - Date.now()) / 1000));
  },
  slowMark(peer, sec) {
    if (!peer || !sec) return;
    Chat.slowEnd[peer.id] = Date.now() + sec * 1000;
    Chat.slowTick();
  },
  slowTick() {
    clearInterval(Chat.slowTm);
    const b = $("btn-main"); if (!b) return;
    const upd = () => {
      const n = Chat.slowLeft(), on = n > 0 && !Chat.editing;
      b.classList.toggle("slow", on);
      if (on) { b.dataset.n = n >= 60 ? Math.ceil(n / 60) + "м" : String(n); b.style.setProperty("--p", String(Math.min(100, Math.round((1 - n / Math.max(1, Chat.peer.slow)) * 100)))); }
      else { delete b.dataset.n; b.style.removeProperty("--p"); clearInterval(Chat.slowTm); }
    };
    upd();
    if (Chat.slowLeft() > 0) Chat.slowTm = setInterval(upd, 250);
  },
  slowShake() { const b = $("btn-main"); b.classList.remove("shake"); void b.offsetWidth; b.classList.add("shake"); haptic("light"); },

  // что показывать вместо поля ввода: в канале — «Выключить звук», если писать нельзя — пояснение
  // актуальные признаки блокировки для открытого личного чата
  async syncBlock() {
    const p = Chat.peer; if (!p || p.gk || p.is_system || p.id <= 0) return;
    try {
      const d = await api("/api/user/" + p.id);
      if (Chat.peer !== p) return;
      p.blocked = !!d.user.blocked; p.blocked_me = !!d.user.blocked_me;
      p.no_voice = d.user.no_voice; p.no_msg = d.user.no_msg; p.pay = d.user.pay; p.gift_ok = d.user.gift_ok;
      Chat.applyAccess();
    } catch (e) {}
  },
  async unblock() {
    const p = Chat.peer; if (!p) return;
    try { await api("/api/block", { method: "POST", body: { id: p.id, on: false } }); p.blocked = false; Chat.applyAccess(); toast(T("Пользователь разблокирован")); haptic(); } catch (e) { toast(e.message); }
  },
  applyAccess() {
    const p = Chat.peer, box = $("composer"); if (!p || !box) return;
    let bar = $("cbar");
    if (!bar) { bar = document.createElement("div"); bar.id = "cbar"; bar.className = "cbar hidden"; box.insertBefore(bar, box.firstChild); bar.addEventListener("click", (e) => { if (e.target.closest("[data-mute]") && Chat.peer) { const id = Chat.peer.id; haptic(); (Chats.isMuted(id) ? Chats.setMute(id, false) : ChatPeek.act("mute", { peer: Chat.peer, unread: 0 })); setTimeout(() => Chat.applyAccess(), 400); } if (e.target.closest("[data-unblock]") && Chat.peer) Chat.unblock(); if (e.target.closest("[data-prem]")) Settings.premium(); }); }
    let mode = "";
    if (p.gk) {
      if (!p.post) mode = p.gk === "channel" ? "mute" : "deny";
      else if (Chat.topic && Chat.topic.closed && p.role === "member") mode = "closed";
    } else if (!p.is_system) {
      if (p.deleted) mode = "deleted";
      else if (p.blocked) mode = "blocked"; else if (p.blocked_me) mode = "blockedme"; else if (p.no_msg) mode = "nomsg";
    }
    box.classList.toggle("nowrite", !!mode);
    bar.classList.toggle("hidden", !mode);
    if (mode === "mute") { const m = Chats.isMuted(p.id); bar.innerHTML = `<button data-mute type="button">${m ? CMI.bell : CMI.mute}<span>${esc(T(m ? "Включить звук" : "Выключить звук"))}</span></button>`; }
    else if (mode === "deny") bar.innerHTML = `<span class="cb-note">${esc(T("Вам запрещено отправлять сообщения в этой группе"))}</span>`;
    else if (mode === "closed") bar.innerHTML = `<span class="cb-note">${esc(T("Тема закрыта"))}</span>`;
    else if (mode === "blocked") bar.innerHTML = `<button data-unblock type="button" class="cb-unb">${esc(T("Разблокировать"))}</button>`;
    else if (mode === "blockedme") bar.innerHTML = `<span class="cb-note">${esc(T("Этот человек ограничил вам возможность писать"))}</span>`;
    else if (mode === "nomsg") bar.innerHTML = `<span class="cb-note">${esc(T("Этот пользователь принимает сообщения только от контактов и подписчиков Premium"))}</span>${App.user && App.user.premium ? "" : `<button type="button" class="cb-unb" data-prem>${esc(T("Получить Premium"))}</button>`}`;
    else if (mode === "deleted") bar.innerHTML = `<span class="cb-note">${esc(T("Аккаунт удалён — написать нельзя"))}</span>`;
    else bar.innerHTML = "";
  },

  async open(peer, opt) {
    Chat.peer = peer; Chat.topic = (opt && opt.topic) || null; Chat.msgs = []; Chat.pins = []; Chat.pinI = 0; Chat.lastDay = ""; Chat.loading = true; Chat.hasMore = false; Chat.loadingMore = false;
    Chat.replyTo = null; Chat.editing = null;
    Chat.updateHeader(); Chat.renderPins(); Chat.renderBar();
    $("msgs").innerHTML = ""; Editor.clear(); Panel.hide(); Chat.syncMain();
    Nav.open("chat", () => {
      Chat.peer = null; Chat.topic = null; MsgMenu.close(true); Panel.hide(); Voice.cancel(); Player.stop(); Editor.clear(); Editor.hideTb();
      Chat.replyTo = null; Chat.editing = null; Chats.load();
      $("composer").classList.remove("nowrite");
      try { BotUI.sync(); } catch (e) {}
      if (typeof Music !== "undefined") setTimeout(() => Music.paint(), 0);     // полоска плеера — обратно в список чатов
    });
    if (typeof Music !== "undefined") setTimeout(() => Music.paint(), 0);
    if (peer.gk) Groups.refresh(peer);                // свежие права и число участников
    else Chat.syncBlock();
    // сначала — сохранённая на устройстве переписка (открывается мгновенно, работает и без сети),
    // затем свежие сообщения с сервера тихо дополняют её
    // из памяти — в тот же кадр (никакого «пустого чата»), с диска — параллельно с запросом на сервер, а не перед ним
    const ck = OC.msgKey(peer.id, Chat.topic && Chat.topic.id);
    const useCached = (arr) => {
      if (Chat.peer !== peer || !Array.isArray(arr) || !arr.length) return;
      if (Chat.msgs.some((m) => m.id && !m._c)) return;                    // свежие данные с сервера уже пришли — кэш старее
      const have = new Set(Chat.msgs.filter((m) => m.id).map((m) => m.id));
      Chat.msgs = arr.filter((m) => !have.has(m.id)).map((m) => Object.assign({}, m, { _c: 1 })).concat(Chat.msgs);
      Chat.hasMore = false; Chat.render();
    };
    const mem = OC.peek(ck);
    if (mem) useCached(mem);
    Outbox.forPeer(peer.id, Chat.topic && Chat.topic.id).forEach((m) => { if (!Chat.msgs.some((x) => same(x, m))) { m._peer = peer; Chat.msgs.push(m); } });
    if (Outbox.q.length && Chat.msgs.length) Chat.render();
    if (!mem) tmoC(OC.get(ck), 4000, null).then(useCached);
    await Chat.fetch();
    Chats.markRead(peer.id);
  },
  tq() { return Chat.topic ? "&topic=" + Chat.topic.id : ""; },

  // Загрузка последних сообщений. keep=true — не прыгать вниз, сохранить положение прокрутки.
  async fetch(keep) {
    const p = Chat.peer; if (!p) return;
    try {
      const d = await api("/api/messages/" + p.id + "?limit=" + PAGE + Chat.tq());
      if (Chat.peer !== p) return;
      const fresh = d.messages;
      const minId = fresh.length ? fresh[0].id : Infinity;
      const maxId = fresh.length ? fresh[fresh.length - 1].id : 0;
      const older = Chat.msgs.filter((m) => m.id && m.id < minId && !fresh.some((x) => same(m, x)));
      // сообщения из кэша (_c), которых сервер больше не отдаёт, — удалены, пока нас не было
      const extra = Chat.msgs.filter((m) => !older.includes(m) && !fresh.some((x) => same(m, x)) &&
        (m.pending || m.failed || (m.id && m.id > maxId && !m._c)));
      const older2 = d.has_more ? older : [];          // сервер отдал всё — значит более старых в чате нет
      Chat.msgs = older2.concat(fresh, extra);
      if (!older2.length || older2.some((m) => m._c)) Chat.hasMore = !!d.has_more;
      if (d.pins) { Chat.pins = d.pins; Chat.renderPins(); }
      Chat.render(keep);
      Chat.netOk = true;
    } catch (e) {
      // нет связи, но переписка из кэша уже на экране — не пугаем ошибкой, просто ждём сеть
      if (!Chat.msgs.length) toast(e.message);
    }
    finally { if (Chat.peer === p) Chat.loading = false; }
  },
  sync() { if (Chat.peer && !Chat.loading) Chat.fetch(true); },

  async more() {
    const p = Chat.peer;
    if (!p || !Chat.hasMore || Chat.loadingMore || Chat.loading) return;
    const first = Chat.msgs.find((m) => m.id);
    if (!first) return;
    Chat.loadingMore = true;
    try {
      const d = await api("/api/messages/" + p.id + "?before=" + first.id + "&limit=" + PAGE + Chat.tq());
      if (Chat.peer !== p) return;
      const have = new Set(Chat.msgs.filter((m) => m.id).map((m) => m.id));
      Chat.msgs = d.messages.filter((m) => !have.has(m.id)).concat(Chat.msgs);
      Chat.hasMore = !!d.has_more;
      Chat.render(true);
    } catch (e) { toast(e.message); }
    finally { Chat.loadingMore = false; }
  },

  // ───────────── пузыри ─────────────
  // сообщение из одного–трёх эмодзи показываем крупно
  isBigEmoji(t) {
    t = String(t || "").trim();
    if (!t || t.length > 40) return false;
    try { return /^(?:(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*\s*){1,3}$/u.test(t); } catch (e) { return false; }
  },
  textHTML(m) { return m.sender === SYS && !m.ents ? fmtText(m.text) : Rich.render(m.text, m.ents); },

  replyHTML(m) {
    const r = m.reply;
    if (!r || r.gone) return `<div class="rq gone"><i></i><div><b>Ответ</b><span>Сообщение удалено</span></div></div>`;
    const who = r.sender === App.user.id ? "Вы" : r.who || dispName(Chat.peer || {});
    return `<div class="rq"><i></i><div><b>${esc(who)}</b><span>${esc(Rich.preview({ kind: r.kind, text: r.text, att: { em: r.em, name: r.name } }))}</span></div></div>`;
  },

  ring(m) {
    const p = m.up ? m.up.pct || 0 : 0, C = 2 * Math.PI * 18;
    return `<button class="upl" type="button" aria-label="Отменить"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="18" class="bg"/><circle cx="22" cy="22" r="18" class="fg" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - Math.max(0.05, p))).toFixed(1)}"/></svg>${X_SVG}</button>`;
  },
  paintProgress(m) {
    const el = $("msgs").querySelector(`[data-k="${mkey(m)}"] .upl .fg`);
    if (!el) return;
    const C = 2 * Math.PI * 18;
    el.style.strokeDashoffset = (C * (1 - Math.max(0.05, (m.up && m.up.pct) || 0))).toFixed(1);
  },

  // скачивать ли это вложение само (настройки «Автозагрузка медиа» и «Энергосбережение»); свои и уже открытые — всегда
  autoDl(m) {
    if (m.sender === App.user.id || Chat.dl.has(mkey(m)) || /^(blob|data):/.test((m.att || {}).url || "")) return true;
    const gifVid = m.kind === "gif";
    return gifVid ? Prefs.get("dl_video", true) && !Energy.is("pre") : Prefs.get("dl_photo", true) && !Energy.is("pre");
  },
  mediaHTML(m, time) {
    const a = m.att || {}, k = m.kind;
    const ratio = a.w && a.h ? clamp(a.w / a.h, 0.6, 1.9) : 1.25;
    if (!Chat.autoDl(m)) {
      return `<div class="media dl${k === "gif" ? " gif" : ""}" style="aspect-ratio:${ratio.toFixed(3)}"><span class="dlb">${SI.down}<span>${esc(T(k === "gif" ? "Нажмите, чтобы загрузить GIF" : "Нажмите, чтобы загрузить фото"))}</span></span>${time || ""}</div>`;
    }
    const src = fileUrl(k === "gif" ? a.url : a.turl || a.url);
    const play = Prefs.get("autogif", true) && !Energy.is("gif");
    const inner = k === "gif" && /^video\//.test(a.mime || "") ? `<video src="${src}" muted loop ${play ? "autoplay" : 'preload="metadata"'} playsinline></video>` : `<img src="${src}" alt="" decoding="async">`;
    return `<div class="media${k === "gif" ? " gif" : ""}" style="aspect-ratio:${ratio.toFixed(3)}">${inner}${k === "gif" ? '<span class="gtag">GIF</span>' : ""}${m.up ? Chat.ring(m) : ""}${time || ""}</div>`;
  },
  // настройки поменялись (энергосбережение, автозапуск GIF): запускаем или останавливаем GIF в открытом чате
  refreshMedia() {
    const play = Prefs.get("autogif", true) && !Energy.is("gif");
    document.querySelectorAll("#msgs .media.gif video").forEach((v) => { try { if (play) v.play(); else v.pause(); } catch (e) {} });
  },
  fileHTML(m) {
    const a = m.att || {}, vid = /^video\//.test(a.mime || "");
    if (!m.up && a.url && typeof Music !== "undefined" && Music.isAudio(a)) return Music.cardHTML(m);     // музыка: ▶ прямо в карточке
    const ext = ((a.name || "").split(".").pop() || "FILE").slice(0, 4).toUpperCase();
    return `<div class="fcard"><div class="fic${vid ? " vid" : ""}">${m.up ? Chat.ring(m) : vid ? PLAY_SVG : esc(ext)}</div><div class="fi"><b>${esc(a.name || "Файл")}</b><small>${fmtSize(a.size || 0)}</small></div></div>`;
  },
  stickerHTML(m, time) {
    const a = m.att || {};
    const art = a.b ? Stk.svg(a.b) || '<span class="tx">Стикер</span>' : `<img src="${fileUrl(a.url)}" alt="">`;
    return `<div class="stk-w">${art}${time || ""}</div>`;
  },

  // подряд идущие сообщения одного автора (склеиваются в «стопку»)
  cont(prev, m) {
    const k = m.kind || "text", pk = prev ? prev.kind || "text" : "";
    return !!prev && prev.sender === m.sender && m.ts - prev.ts < 120 && sameDay(new Date(prev.ts * 1000), new Date(m.ts * 1000)) &&
      pk !== "sticker" && k !== "sticker" && pk !== "svc" && k !== "svc" && pk !== "greet" && k !== "greet";
  },
  // служебное сообщение («Иван добавил Петра»), приветствие группы
  svcHTML(m, isNew) {
    const attr = `data-k="${mkey(m)}"${m.id ? ` data-id="${m.id}"` : ""}`;
    if (m.kind === "greet") return `<div class="greetm${isNew ? " new" : ""}" ${attr}><span class="gm-l">${esc(T("Приветствие"))}</span><span class="gm-t">${Rich.render(m.text, m.ents)}</span></div>`;
    let h = `<div class="svcm${isNew ? " new" : ""}" ${attr}>${esc(Svc.text(m))}</div>`;
    if (m.svc && m.svc.t === "create" && m.svc.by && m.svc.by.id === App.user.id && Chat.peer && Chat.peer.gk && !Chat.topic) h += Svc.intro(Chat.peer.gk);
    return h;
  },
  callHTML(m) {
    const c = m.call || {}, out = m.sender === App.user.id;
    return `<div class="callb"><span class="call-ic${Svc.callBad(m) ? " bad" : ""}">${c.v ? CALLI.video : CALLI.phone}</span><span class="call-tx"><b>${esc(Svc.callText(m).split(" · ")[0])}</b><small>${out ? CALLI.out : CALLI.in}${c.dur ? esc(Svc.dur(c.dur)) : esc(T("Нажмите, чтобы перезвонить"))}</small></span></div>`;
  },

  bubble(m, prev, isNew, next) {
    const k = m.kind || "text";
    if (k === "svc" || k === "greet") return Chat.svcHTML(m, isNew);
    if (k === "gift") return Gifts.cardHTML(m, isNew);
    const gk = Chat.peer && Chat.peer.gk;
    const out = m.sender === App.user.id && gk !== "channel";            // посты канала показываем как входящие
    const inGroup = gk === "group" && !out;
    const cont = Chat.cont(prev, m);
    const hasCap = !!(m.text && k !== "text");
    const ov = ((k === "photo" || k === "gif") && !hasCap) || k === "sticker";
    const big = k === "text" && !m.fw && !m.reply_to && !m.reply && Prefs.get("bigemoji", true) && Chat.isBigEmoji(m.text);
    const sig = gk === "channel" && m.from && m.from.sig ? `<i class="sig">${esc(cleanName(m.from.name) || dispName(m.from))}</i>` : "";
    const time = `<span class="t${ov ? " ov" : ""}">${sig}${m.exp ? TIMER_I : ""}${m.paid ? `<span class="mpd">⭐${m.paid}</span> ` : ""}${m.edited ? T("изм.") + " " : ""}${fmtTime(m.ts)}${out ? `<span class="st">${stIcon(m)}</span>` : ""}</span>`;
    let h = "";
    if (inGroup && !cont && k !== "sticker") {
      const f = m.from || {}, lab = f.tag || (f.role === "owner" ? T("владелец") : f.role === "admin" ? T("админ") : "");
      // рядом с именем — его настоящий эмодзи-статус (свой премиум-эмодзи или коллекционный подарок),
      // а стандартная звезда — только если статус не выбран
      const badge = f.nft && typeof PB !== "undefined" ? PB.nft(f.nft) : f.estatus && typeof ES !== "undefined" ? ES.node(f.estatus) : f.premium ? PREM_I : "";
      h += `<span class="gname" data-uid="${m.sender}" style="color:${uColor(m.sender)}"><span class="gn-t">${esc(dispName(f))}</span>${verBadge(f)}${badge ? `<i class="gbadge">${badge}</i>` : ""}${lab ? `<em class="grole">${esc(lab)}</em>` : ""}</span>`;
    }
    if (m.auto) h += `<span class="auto">${esc(T("Автоматическое сообщение"))}</span>`;
    if (m.fw) h += `<div class="fw">${T("Переслано от")} ${m.fw.id ? `<b class="fwl" role="link">${esc(m.fw.name || "")}</b>` : `<b>${esc(m.fw.name || "")}</b>`}</div>`;
    if (m.reply_to || m.reply) h += Chat.replyHTML(m);
    if (k === "text") h += m.inv ? BotUI.inv(m) : `<span class="tx">${big ? Fx.html(m.text, m.ents) : Chat.textHTML(m)}</span>`;
    else if (k === "photo" || k === "gif") h += Chat.mediaHTML(m, ov ? time : "");
    else if (k === "file") h += Chat.fileHTML(m);
    else if (k === "voice") h += Player.html(m);
    else if (k === "sticker") h += Chat.stickerHTML(m, time);
    else if (k === "call") h += Chat.callHTML(m);
    if (hasCap) h += `<div class="capw"><span class="tx cap">${Chat.textHTML(m)}</span>${time}</div>`;     // подпись и время в одной строке
    const rx = React.chips(m);
    const kb = Array.isArray(m.kb) && m.kb.length ? Chat.kbHTML(m) : "";
    let av = "";
    if (inGroup && !(next && Chat.cont(m, next))) { const f = m.from || {}; av = `<span class="gav" data-uid="${m.sender}">${avatar({ id: m.sender, name: f.name || "", avatar: f.avatar || "" })}</span>`; }
    const bubble = `<div class="b ${out ? "out" : "in"}${inGroup ? " g" : ""}${big ? " big" : ""}${cont ? " cont" : ""} k-${k}${hasCap ? " hascap" : ""}${kb ? " haskb" : ""}${m.failed ? " failed" : ""}${m.pending ? " pending" : ""}${isNew ? " new" : ""}" data-k="${mkey(m)}"${m.id ? ` data-id="${m.id}"` : ""}>${h}${ov || hasCap ? "" : time}${rx}${av}${kb}</div>`;
    // под постами канала с привязанным обсуждением — пилюля «Комментарии», как в Telegram
    if (gk === "channel" && Chat.peer.disc && m.id) {
      const cmTxt = m.cc ? m.cc + " " + plural(m.cc, T("комментарий"), T("комментария"), T("комментариев")) : T("Оставить комментарий");
      return bubble + `<button class="cmbar" data-id="${m.id}">${CMNT_SVG}<span>${esc(cmTxt)}</span>${CMNT_CHEV}</button>`;
    }
    return bubble;
  },
  // кнопки под сообщением (бот admin-panel): «d» — действие на сервере, «o» — открыть что-то в приложении
  kbHTML(m) { return BotUI.kbHTML(m); },
  kbPress(m, btn) { return BotUI.press(m, btn); },
  dayHead(m) {
    const day = new Date(m.ts * 1000).toDateString();
    if (day === Chat.lastDay) return "";
    Chat.lastDay = day; return `<div class="day">${fmtDay(m.ts)}</div>`;
  },

  render(keep) {
    const box = $("msgs"); Chat.lastDay = ""; let html = "", prev = null;
    const fromBottom = box.scrollHeight - box.scrollTop;
    const pi = Chat.peer && Chat.peer.intro;
    if (!Chat.msgs.length && pi) html = `<div class="intro-card"><div class="intro-e">${esc(pi.emoji || "👋")}</div>${pi.title ? `<b>${esc(pi.title)}</b>` : ""}${pi.text ? `<span>${esc(pi.text)}</span>` : ""}</div>`;
    else if (!Chat.msgs.length && BotUI.isBot(Chat.peer) && !Chat.topic) html = BotUI.startCard(Chat.peer);
    else if (!Chat.msgs.length) html = `<div class="empty"><h3>Сообщений пока нет</h3><p>${Chat.peer && Chat.peer.is_system ? "Это официальный аккаунт: он принимает любые сообщения, но не отвечает." : "Напишите первым."}</p></div>`;
    for (let i = 0; i < Chat.msgs.length; i++) { const m = Chat.msgs[i]; html += Chat.dayHead(m) + Chat.bubble(m, prev, false, Chat.msgs[i + 1]); prev = m; }
    box.innerHTML = html;
    box.scrollTop = keep ? box.scrollHeight - fromBottom : box.scrollHeight;
    Player.paint();
    if (typeof Music !== "undefined") Music.paint();
    if (Chat.hasMore && box.scrollHeight <= box.clientHeight + 40) setTimeout(() => Chat.more(), 0);
    Chat.saveCache();
    try { BotUI.sync(); } catch (e) {}
  },
  // переписка на экране → в кэш устройства (для мгновенного открытия и оффлайна)
  saveCache() { if (Chat.peer) OC.saveMsgs(Chat.peer.id, Chat.topic && Chat.topic.id, Chat.msgs); },

  append(m) {
    const box = $("msgs"), prev = Chat.msgs[Chat.msgs.length - 2] || null;
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 200 || m.sender === App.user.id;
    const empty = box.querySelector(".empty, .intro-card, .bot-start"); if (empty) empty.remove();
    const lastEl = box.lastElementChild;
    box.insertAdjacentHTML("beforeend", Chat.dayHead(m) + Chat.bubble(m, prev, true));
    // аватарка группы остаётся только у последнего сообщения в «стопке»
    if (prev && lastEl && lastEl.classList.contains("g") && Chat.cont(prev, m) && m.sender !== App.user.id) { const g = lastEl.querySelector(":scope > .gav"); if (g) g.remove(); }
    Player.paint();
    if (typeof Music !== "undefined") Music.paint();
    if (m.kind === "text" || !m.kind) { const le = box.lastElementChild; if (le && le.classList.contains("big")) setTimeout(() => Fx.appear(le), 260); }
    if (near) {
      const go = () => { box.scrollTop = box.scrollHeight; };
      requestAnimationFrame(go);
      box.querySelectorAll("img:not([data-s])").forEach((i) => { i.dataset.s = 1; i.addEventListener("load", go, { once: true }); });
    }
    Chat.saveCache();
    try { BotUI.sync(); } catch (e) {}
  },

  // перерисовать один пузырь на месте
  patch(m) {
    const box = $("msgs");
    const el = box.querySelector(`[data-k="${mkey(m)}"]`) || (m.id && box.querySelector(`[data-id="${m.id}"]`));
    if (!el) return;
    // у поста канала может быть вторым элементом пилюля «Комментарии» — её тоже нужно заменить/убрать
    const oldCm = m.id && el.nextElementSibling && el.nextElementSibling.matches(`.cmbar[data-id="${m.id}"]`) ? el.nextElementSibling : null;
    const i = Chat.msgs.indexOf(m);
    const tmp = document.createElement("div");
    tmp.innerHTML = Chat.bubble(m, Chat.msgs[i - 1] || null, false, Chat.msgs[i + 1] || null);
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    el.replaceWith(...tmp.childNodes);
    if (oldCm) oldCm.remove();
    Player.paint();
    if (typeof Music !== "undefined") Music.paint();
    if (near) box.scrollTop = box.scrollHeight;
    Chat.saveCache();
  },

  // пока сообщение только что отправлено, оставляем локальную картинку/звук — без повторной загрузки и мигания
  keepLocal(m, old) {
    if (!old || !m.att) return;
    if (m.kind === "voice" && old.url && /^blob:/.test(old.url)) m.att.url = old.url;
    else if (m.kind === "photo" && old.url && /^blob:/.test(old.url)) m.att.turl = old.turl && /^blob:/.test(old.turl) ? old.turl : old.url;
    else if (m.kind === "gif" && old.url && /^blob:/.test(old.url)) m.att.url = old.url;
  },

  // ───────────── входящие события ─────────────
  async onMessage(m) {
    try { Typing.stop(m.receiver < 0 ? m.receiver : m.sender === App.user.id ? m.receiver : m.sender, m.sender); } catch (e) {}
    if (!Chat.peer) return;
    const pid = Chat.peer.id;
    const other = m.receiver < 0 ? m.receiver : (m.sender === App.user.id ? m.receiver : m.sender);
    if (other !== pid) return;
    if (Chat.topic && (m.topic || 0) !== (Chat.topic.id || 0)) { try { Topics.touch(); } catch (e) {} return; }
    const own = Chat.msgs.find((x) => same(x, m));
    if (own) {
      const old = own.att ? { url: own.att.url, turl: own.att.turl } : null;
      Object.assign(own, m, { pending: false, failed: false, up: null });
      Chat.keepLocal(own, old);
      return Chat.patch(own);
    }
    Chat.msgs.push(m); Chat.append(m);
    if (m.sender !== App.user.id) {
      haptic("light");
      if (document.visibilityState === "visible") {
        try { await api("/api/read/" + pid, { method: "POST", body: {} }); Chats.markRead(pid); } catch (e) {}
      }
    }
  },
  onEdit(m) {
    const x = Chat.msgs.find((q) => q.id === m.id);
    if (x) { Object.assign(x, m); Chat.patch(x); }
    const p = Chat.pins.find((q) => q.id === m.id);
    if (p) { p.text = m.text; Chat.renderPins(); }
    Chat.msgs.forEach((q) => { if (q.reply && q.reply.id === m.id) { q.reply.text = String(m.text || "").slice(0, 140); Chat.patch(q); } });
  },
  onDel(ids) {
    const set = new Set(ids);
    if (Chat.msgs.some((m) => set.has(m.id))) {
      Chat.msgs = Chat.msgs.filter((m) => !set.has(m.id));
      Chat.msgs.forEach((m) => { if (m.reply && set.has(m.reply.id)) m.reply = { id: m.reply.id, gone: 1 }; });
      Chat.render(true);
    }
    if (Chat.pins.some((p) => set.has(p.id))) { Chat.pins = Chat.pins.filter((p) => !set.has(p.id)); Chat.pinI = 0; Chat.renderPins(); }
    if (Chat.replyTo && set.has(Chat.replyTo.id)) Chat.clearReply();
    if (Chat.editing && set.has(Chat.editing.id)) Chat.cancelEdit();
  },
  onReact(d) {
    const m = Chat.msgs.find((q) => q.id === d.id);
    if (m) { m.reacts = d.reacts; Chat.patch(m); }
  },
  onCC(d) {
    if (!Chat.peer || Chat.peer.id !== d.chat) return;
    const m = Chat.msgs.find((q) => q.id === d.id);
    if (m) { m.cc = d.cc; Chat.patch(m); }
  },
  // открыть (или создать) ветку обсуждения поста канала в привязанной группе — пилюля «Комментарии»
  async openComments(m) {
    const p = Chat.peer;
    if (!p || !p.disc || !m.id) return;
    haptic();
    try {
      const d = await api(`/api/chat/${p.gid}/comment/${m.id}`, { method: "POST" });
      await Chat.open(d.chat);                      // напрямую, минуя список тем — комментарии всегда в общей ленте
      await Chat.jumpTo(d.anchor);
      const anchor = Chat.msgs.find((x) => x.id === d.anchor);
      if (anchor) Chat.setReply(anchor);
    } catch (e) { toast(e.message); }
  },
  onPin(d) {
    const m = Chat.msgs.find((q) => q.id === d.id);
    if (m) m.pin = d.pin || undefined;
    Chat.refreshPins();
  },
  onRead(by) {
    if (!Chat.peer || Chat.peer.id !== by) return;
    Chat.msgs.forEach((m) => { if (m.sender === App.user.id && !m.is_read) { m.is_read = 1; Chat.patch(m); } });
  },

  // ───────────── отправка ─────────────
  mainMode() { return Chat.editing ? "save" : Editor.isEmpty() ? "mic" : "send"; },
  syncMain() {
    const mode = Chat.mainMode();
    $("btn-main").dataset.mode = mode;
    $("composer").classList.toggle("has-text", mode !== "mic");
  },

  async send() {
    const peer = Chat.peer; if (!peer) return;
    const { text, ents } = Editor.get();
    if (Chat.editing) return Chat.saveEdit(text, ents);
    if (!text) return;
    if (peer.gk === "group" && peer.perms && !peer.perms.text && peer.role === "member") return toast(T("В этой группе запрещено отправлять текстовые сообщения"));
    if (Chat.slowLeft() > 0) return Chat.slowShake();
    const r = Chat.replyTo;
    Editor.clear(); Chat.clearReply(); haptic("light");
    Chat.post({ kind: "text", text, ents: ents.length ? ents : undefined, reply_to: r ? r.id : undefined, reply: r ? Chat.replyOf(r) : undefined });
  },

  // создать локальное «отправляется…» сообщение и отправить
  post(p, noSend) {
    const peer = Chat.peer; if (!peer) return null;
    const m = Object.assign({ cid: newCid(), sender: App.user.id, receiver: peer.id, ts: Math.floor(Date.now() / 1000), is_read: 0, pending: true, kind: "text", text: "" }, p);
    if (Chat.topic && Chat.topic.id) m.topic = Chat.topic.id;
    if (!m.reply_to && Chat.replyTo && p.kind !== "text") { m.reply_to = Chat.replyTo.id; m.reply = Chat.replyOf(Chat.replyTo); Chat.clearReply(); }
    m._peer = peer;
    Chat.msgs.push(m); Chat.append(m); Chats.upsert(peer, m, false);
    if (!noSend) Chat.transmit(m);
    return m;
  },

  async transmit(m) {
    const peer = m._peer || (Chats.byId(m.receiver) && Chats.byId(m.receiver).peer) || { id: m.receiver };
    let ok = false;
    try {
      const body = { to: peer.id, text: m.text, cid: m.cid, kind: m.kind, ents: m.ents, att: sendAtt(m.att), reply_to: m.reply_to, topic: m.topic };
      if (peer.pay && !peer.gk) {                       // человек принимает сообщения за звёзды: один раз спрашиваем подтверждение
        if (!peer._payOk) {
          const go = await UI.sheet({ title: T("Платное сообщение"), text: T("{0} принимает сообщения от незнакомых за звёзды. Каждое сообщение стоит {1} ⭐.", dispName(peer), peer.pay),
            actions: [{ label: T("Отправить за {0} ⭐", peer.pay), value: true, accent: true }], cancel: T("Отмена") });
          if (!go) { m.pending = false; m.failed = true; Outbox.done(m); if (Chat.peer && Chat.peer.id === peer.id) Chat.patch(m); return false; }
          peer._payOk = true;
        }
        body.paid = peer.pay;
      }
      const d = await api("/api/send", { method: "POST", body });
      const old = m.att ? { url: m.att.url, turl: m.att.turl } : null;
      Object.assign(m, d.message, { pending: false, failed: false, up: null, file: null });
      Chat.keepLocal(m, old);
      Chats.upsert(Chats.byId(peer.id) ? Chats.byId(peer.id).peer : peer, m, false);
      if (peer.gk === "group" && peer.slow && peer.role === "member") Chat.slowMark(peer, peer.slow);
      Outbox.done(m);
      ok = true;
    } catch (e) {
      if (/Нет связи с сервером|Сервер не отвечает/.test(e.message || "")) {
        // нет сети — сообщение остаётся «отправляется…» (часики) и уйдёт само, как только связь вернётся
        m.pending = true; m.failed = false; Outbox.add(m);
      } else {
        m.pending = false; m.failed = true; Outbox.done(m);
        const need = e.data && e.data.need_pay;
        if (need) { peer.pay = need; peer._payOk = false; }
        const w = /Медленный режим: подождите (\d+)\s*(с|мин)/.exec(e.message || "");
        if (w) Chat.slowMark(peer, +w[1] * (w[2] === "мин" ? 60 : 1)); else toast(e.message);
      }
    }
    if (Chat.peer && Chat.peer.id === peer.id) Chat.patch(m);
    return ok;
  },

  resend(m) {
    if (!Chat.peer) return;
    m.failed = false; m.pending = true; Chat.patch(m);
    if (m.file && !(m.att && m.att.fid && m.sentFid)) Chat.runUpload(m); else Chat.transmit(m);
  },

  sendSticker(att) { return Chat.post({ kind: "sticker", att }); },
  sendGif(att) { return Chat.post({ kind: "gif", att }); },

  sendVoice(res) {
    const file = new File([res.blob], "voice.wav", { type: "audio/wav" });
    const m = Chat.post({ kind: "voice", att: { dur: res.dur, wave: res.wave, url: URL.createObjectURL(file), mime: "audio/wav", name: "voice.wav", size: file.size }, up: { pct: 0, ctl: {} }, file }, true);
    if (m) Chat.runUpload(m);
  },

  async sendFiles(files, caption) {
    for (let i = 0; i < files.length; i++) await Chat.sendFile(files[i], i === 0 ? caption : "");
  },
  // из своей «Галереи»: новые файлы — загрузкой, уже лежащие на сервере (из чатов) — мгновенно, по fid
  async sendGallery(list, caption) {
    for (let i = 0; i < list.length; i++) {
      const x = list[i], cap = i === 0 ? caption || "" : "";
      if (x.file) { await Chat.sendFile(x.file, cap); continue; }
      const a = x.att || {}, img = /^image\//.test(a.mime || "") && a.mime !== "image/gif";
      Chat.post({ kind: a.mime === "image/gif" ? "gif" : img ? "photo" : "file", text: cap, att: Object.assign({}, a) });
    }
  },
  async sendFile(file, caption) {
    if (!Chat.peer) return;
    let kind = "file", w, h;
    if (/^image\//.test(file.type) && !/svg/.test(file.type)) {
      const t = await Up.thumb(file);                           // миниатюра для ленты; оригинал не трогаем
      if (t && t.w) { kind = file.type === "image/gif" ? "gif" : t.blob ? "photo" : "file"; w = t.w; h = t.h; }
      if (t && kind !== "file") file.__thumb = t.blob;
    }
    let dur;
    if (/^video\//.test(file.type)) { const vm = await Chat.videoMeta(file); if (vm) { w = vm.w; h = vm.h; dur = vm.dur; } }     // длительность и размер видео — для карточки и «Галереи»
    const local = URL.createObjectURL(file);
    const turl = kind === "photo" && file.__thumb ? URL.createObjectURL(file.__thumb) : undefined;   // лента показывает лёгкую миниатюру, оригинал — в просмотрщике
    const m = Chat.post({ kind, text: caption || "", att: { name: file.name, size: file.size, mime: file.type || "application/octet-stream", w, h, dur, url: local, turl }, up: { pct: 0, ctl: {} }, file }, true);
    if (m) Chat.runUpload(m);
  },
  videoMeta(file) {
    return new Promise((res) => {
      let done = false;
      const url = URL.createObjectURL(file), v = document.createElement("video");
      const fin = (r) => { if (done) return; done = true; try { v.removeAttribute("src"); v.load(); } catch (e) {} URL.revokeObjectURL(url); res(r); };
      v.preload = "metadata"; v.muted = true;
      v.onloadedmetadata = () => fin(v.videoWidth ? { w: v.videoWidth, h: v.videoHeight, dur: isFinite(v.duration) ? Math.round(v.duration * 1000) : undefined } : null);
      v.onerror = () => fin(null);
      setTimeout(() => fin(null), 3000);
      v.src = url;
    });
  },

  async runUpload(m) {
    const file = m.file;
    m.up = m.up || { pct: 0, ctl: {} };
    m.up.ctl = {};
    Chat.patch(m);
    try {
      // миниатюра (небольшая) уходит одновременно с оригиналом, а не перед ним
      const tp = file.__thumb && !m.tfid ? Up.upload(file.__thumb, { name: "thumb.jpg", mime: "image/jpeg" }).then((id) => { m.tfid = id; }) : null;
      if (tp) tp.catch(() => {});
      const fid = await Up.upload(file, {
        fid: m.fidTmp, ctl: m.up.ctl, name: m.att.name, mime: m.att.mime,
        onFid: (id) => { m.fidTmp = id; },
        onProgress: (p) => { m.up.pct = p; Chat.paintProgress(m); },
      });
      if (tp) await tp;
      m.sentFid = true;
      m.att = Object.assign({}, m.att, { fid, tfid: m.tfid });
      await Chat.transmit(m);
    } catch (e) {
      if (e && e.aborted) {
        Chat.msgs = Chat.msgs.filter((x) => x !== m);
        if (Chat.peer) Chat.render(true);
        return;
      }
      m.pending = false; m.failed = true; m.up = null; toast(e.message || "Не удалось отправить");
      if (Chat.peer && Chat.peer === m._peer) Chat.patch(m);
    }
  },

  // ───────────── ответ и правка ─────────────
  replyOf(m) { return { id: m.id, sender: m.sender, kind: m.kind || "text", text: String(m.text || "").slice(0, 140), em: (m.att || {}).em || "", name: (m.att || {}).name || "" }; },

  setReply(m) {
    if (!m || !m.id) return;
    Chat.editing = null;
    Chat.replyTo = m;
    Chat.renderBar(); Chat.syncMain();
    if (!Panel.open) Editor.focus(false);
  },
  clearReply() { Chat.replyTo = null; Chat.renderBar(); },

  startEdit(m) {
    Chat.replyTo = null;
    Chat.editing = m;
    Editor.set(m.text || "", m.ents);
    Chat.renderBar(); Chat.syncMain();
    if (Panel.open) Panel.hide();
    Editor.focus(false);
  },
  cancelEdit() { Chat.editing = null; Editor.clear(); Chat.renderBar(); Chat.syncMain(); },

  renderBar() {
    const bar = $("ctxbar");
    const m = Chat.editing || Chat.replyTo;
    bar.classList.toggle("hidden", !m);
    if (!m) return;
    const edit = !!Chat.editing;
    const who = edit ? T("Редактирование") : m.sender === App.user.id ? T("Ответ себе") : T("Ответ {0}", (m.from && m.from.name) || dispName(Chat.peer || {}));
    bar.querySelector(".cb-ic").innerHTML = edit ? ICON.edit : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v3"/></svg>';
    bar.querySelector(".cb-t b").textContent = who;
    bar.querySelector(".cb-t span").textContent = Rich.preview(m) || T("Сообщение");
  },

  async saveEdit(text, ents) {
    const m = Chat.editing; if (!m) return;
    if (!text && (m.kind || "text") === "text") { toast("Сообщение не может быть пустым"); return; }
    if (text === (m.text || "") && JSON.stringify(ents) === JSON.stringify(m.ents || [])) return Chat.cancelEdit();
    Chat.editing = null; Editor.clear(); Chat.renderBar(); Chat.syncMain();
    try {
      const d = await api("/api/edit", { method: "POST", body: { id: m.id, text, ents } });
      Object.assign(m, d.message); Chat.patch(m);
      Chats.load();
    } catch (e) { toast(e.message); }
  },

  // ───────────── реакции, закреп, удаление ─────────────
  // реакции как в Telegram: без Premium — одна на сообщение, с Premium — до трёх (в том числе свои эмодзи).
  // quick (двойное касание) только ставит реакцию и не снимает её.
  async react(m, e, quick) {
    if (!m || !m.id) return;
    if (Chat.peer && Chat.peer.gk && Chat.peer.react_mode === "none") return toast(T("В этом чате реакции отключены"));
    if (String(e).startsWith("c:") && !(App.user && App.user.premium)) return PremiumPromo.open(App.user);
    const mine = React.mineOf(m), has = mine.includes(e);
    if (has && quick) return;
    const prev = (m.reacts || []).map((r) => Object.assign({}, r));
    let list = prev.map((r) => Object.assign({}, r));
    const drop = (x) => { const r = list.find((q) => q.e === x); if (r) { r.n--; r.mine = false; } };
    if (has) drop(e);
    else {
      const left = mine.slice();
      while (left.length >= React.limit()) drop(left.shift());
      const t = list.find((r) => r.e === e);
      if (t) { t.n++; t.mine = true; }
      else {
        const x = { e, n: 1, mine: true };
        if (String(e).startsWith("c:") && CE.items[+e.slice(2)]) { x.url = CE.items[+e.slice(2)].url; x.mime = CE.items[+e.slice(2)].mime; }
        list.push(x);
      }
    }
    list = list.filter((r) => r.n > 0);
    m.reacts = list;
    Chat.patch(m);
    if (!has) Chat.fly(m, e);
    haptic("light");
    try {
      const d = await api("/api/react", { method: "POST", body: { id: m.id, emoji: e, mode: "toggle" } });
      m.reacts = d.reacts; Chat.patch(m);
    } catch (er) { m.reacts = prev; Chat.patch(m); toast(er.message); }
  },
  // большая реакция «вылетает» над пузырём
  fly(m, e) {
    const el = $("msgs").querySelector(`[data-k="${mkey(m)}"]`); if (!el) return;
    const f = document.createElement("div");
    f.className = "rx-fly"; f.innerHTML = React.glyph({ e });
    el.appendChild(f);
    setTimeout(() => f.remove(), 900);
  },

  async pin(m, on) {
    try {
      await api("/api/pin", { method: "POST", body: { id: m.id, pin: on } });
      m.pin = on ? Date.now() : undefined;
      await Chat.refreshPins();
      toast(on ? "Сообщение закреплено" : "Сообщение откреплено");
    } catch (e) { toast(e.message); }
  },
  async refreshPins() {
    const p = Chat.peer; if (!p) return;
    try {
      const d = await api("/api/messages/" + p.id + "?limit=1&pins=1");
      if (Chat.peer !== p) return;
      Chat.pins = d.pins || []; Chat.pinI = 0; Chat.renderPins();
    } catch (e) {}
  },
  renderPins() {
    const bar = $("pinbar"), n = Chat.pins.length;
    bar.classList.toggle("hidden", !n);
    if (!n) return;
    const i = Chat.pinI % n, p = Chat.pins[i];
    const segs = n > 1 ? `<span class="pb-segs">${Chat.pins.map((_, j) => `<i class="${j === i ? "on" : ""}"></i>`).join("")}</span>` : '<span class="pb-segs"><i class="on"></i></span>';
    bar.innerHTML = `${segs}<div class="pb-t"><b>${T("Закреплённое сообщение")}${n > 1 ? " #" + (n - i) : ""}</b><span>${esc(Rich.preview({ kind: p.kind, text: p.text, att: { em: p.em, name: p.name } }) || T("Сообщение"))}</span></div>
      <button class="pb-x" data-act="unpin" aria-label="Открепить"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
  },
  pinClick(e) {
    const n = Chat.pins.length; if (!n) return;
    const p = Chat.pins[Chat.pinI % n];
    if (e.target.closest("[data-act=unpin]")) return Chat.pin({ id: p.id }, false);
    Chat.jumpTo(p.id);
    Chat.pinI = (Chat.pinI + 1) % n; Chat.renderPins();
  },

  // прокрутить к сообщению (подгружая историю, если оно далеко)
  async jumpTo(id) {
    const box = $("msgs");
    for (let i = 0; i < 40 && !Chat.msgs.some((m) => m.id === id) && Chat.hasMore; i++) {
      Chat.loadingMore = false;
      await Chat.more();
    }
    const el = box.querySelector(`[data-id="${id}"]`);
    if (!el) return toast("Сообщение не найдено");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("hl"); void el.offsetWidth; el.classList.add("hl");
    setTimeout(() => el.classList.remove("hl"), 1400);
  },

  async del(m) {
    const mine = m.sender === App.user.id;
    if (!m.id) { Chat.msgs = Chat.msgs.filter((x) => x !== m); Chat.render(true); return; }   // ещё не ушло — просто убираем
    let all = false;
    if (Chat.peer && Chat.peer.gk) {
      const ok = await UI.sheet({ title: T("Удалить сообщение?"), text: T("Оно исчезнет у всех участников."), actions: [{ label: T("Удалить"), value: true, danger: true }] });
      if (!ok) return;
      all = true;
    } else if (mine) {
      const v = await UI.sheet({ title: "Удалить сообщение?", actions: [{ label: "Удалить у меня", value: "me", danger: true }, { label: T("Удалить у {0}", dispName(Chat.peer)), value: "all", danger: true }] });
      if (!v) return;
      all = v === "all";
    } else {
      const ok = await UI.sheet({ title: "Удалить сообщение?", text: "Оно исчезнет только у вас, у собеседника останется.", actions: [{ label: "Удалить у меня", value: true, danger: true }] });
      if (!ok) return;
    }
    try {
      const d = await api("/api/delete", { method: "POST", body: { ids: [m.id], all } });
      Chat.onDel(d.ids.length ? d.ids : [m.id]);
      Chats.load();
    } catch (e) { toast(e.message); }
  },

  // действие из меню сообщения
  act(a, m) {
    if (a === "reply") return Chat.setReply(m);
    if (a === "copy") { RClip.set(m.text || "", m.ents || []); return toast("Скопировано"); }     // свои эмодзи и форматирование сохраняются при вставке
    if (a === "forward") return Fwd.open([m.id]);
    if (a === "pin") return Chat.pin(m, true);
    if (a === "unpin") return Chat.pin(m, false);
    if (a === "edit") return Chat.startEdit(m);
    if (a === "del") return Chat.del(m);
    if (a === "stk") return Panel.saveFrom(m, "sticker");
    if (a === "gif") return Panel.saveFrom(m, "gif");
    if (a === "dl") return m.att && Attach.download(m.att);
    if (a === "save") return m.att && Attach.saveDevice(m.att);
    if (a === "link") return Links.copy({ kind: "msg", id: Chat.peer.id, mid: m.id, single: !!(m.att && (m.kind === "photo" || m.kind === "gif")) });
  },
};

// быстрые ответы: пишем «/» в поле сообщения и выбираем готовый текст (нужен Premium, настраивается в «Для бизнеса»)
Object.assign(Chat, {
  async loadQuick() {
    if (!App.user || !App.user.premium) { Chat.quick = []; return; }
    try { Chat.quick = ((await api("/api/biz/me")).biz.quick) || []; } catch (e) {}
  },
  quickCheck() {
    const box = $("composer"); let el = $("qk");
    const t = Rich.readRaw(Editor.el).text;
    const m = /^\/([A-Za-z0-9_]*)$/.exec(t);
    const list = m && Chat.quick.length ? Chat.quick.filter((x) => x.name.toLowerCase().startsWith(m[1].toLowerCase())) : [];
    if (!list.length) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("div"); el.id = "qk"; el.className = "qk"; box.appendChild(el); el.addEventListener("pointerdown", (e) => e.preventDefault()); }
    el.innerHTML = list.map((x, i) => `<button data-i="${i}"><b>/${esc(x.name)}</b><span data-nt="1">${esc(x.text)}</span></button>`).join("");
    el.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; const q = list[+b.dataset.i]; el.remove(); Editor.set(q.text); Editor.focus(false); Chat.syncMain(); };
  },
});
