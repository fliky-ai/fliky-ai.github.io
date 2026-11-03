// Экран переписки: сообщения всех видов, отправка (текст, голос, файлы, стикеры), ответы, реакции, закрепы, правка, удаление.
const CK1 = '<svg class="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const CK2 = '<svg class="ck read" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m2.5 12.5 4.5 4.5L16.5 7.5"/><path d="m11 16.5 1 .9L21.5 7.5"/></svg>';
const CLK = '<svg class="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
const FAIL = '<svg class="ck fail" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 16.5v.1"/></svg>';
const X_SVG = '<svg class="x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>';
const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';

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

const Chat = {
  peer: null, msgs: [], pins: [], pinI: 0, lastDay: "", loading: false, hasMore: false, loadingMore: false,
  replyTo: null, editing: null, kb: 0, vhMax: 0,

  // ───────────── подключение событий ─────────────
  bind() {
    Editor.init(); Voice.bind(); Player.init(); Panel.bind();
    Editor.onChange = () => Chat.syncMain();
    const inp = Editor.el, box = $("msgs"), main = $("btn-main");

    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer:fine)").matches) { e.preventDefault(); Chat.send(); }
    });
    // тап по полю, когда открыта своя панель: возвращаем обычную клавиатуру
    inp.addEventListener("click", () => {
      if (Panel.open) { Panel.hide(); inp.blur(); Editor.focus(false); }
    });
    inp.addEventListener("focus", () => { if (!Panel.open) inp.setAttribute("inputmode", "text"); });

    main.addEventListener("pointerdown", (e) => { if (Chat.mainMode() !== "mic") e.preventDefault(); });   // клавиатура не закрывается
    main.addEventListener("click", () => {
      if (Voice.st === "locked") return Voice.swallow ? undefined : Voice.finish(true);
      if (Chat.mainMode() !== "mic") Chat.send();
    });
    $("btn-emoji").addEventListener("pointerdown", (e) => e.preventDefault());
    $("btn-emoji").onclick = () => Panel.toggle();
    $("btn-attach").addEventListener("pointerdown", (e) => e.preventDefault());
    $("btn-attach").onclick = () => Attach.menu();
    $("cb-x").onclick = () => (Chat.editing ? Chat.cancelEdit() : Chat.clearReply());
    $("chat-head").onclick = () => { if (Chat.peer && !Chat.peer.is_system) UserProfile.open(Chat.peer); };
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
      $("jump").classList.toggle("hidden", box.scrollHeight - box.scrollTop - box.clientHeight < 420);
    }, { passive: true });

    Chat.bindTouch(box);
    box.addEventListener("contextmenu", (e) => { e.preventDefault(); const b = e.target.closest(".b"); if (b) MsgMenu.open(b, Chat.byEl(b)); });
    box.addEventListener("click", (e) => Chat.tap(e));
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
    const b = e.target.closest(".b");
    if (!b) return;
    const m = Chat.byEl(b), t = e.target;
    if (!m) return;
    const sp = t.closest(".sp");
    if (sp) { sp.classList.toggle("open"); return; }
    if (t.closest("a")) return;                                       // ссылки открывает общий обработчик
    const chip = t.closest(".rx-chip");
    if (chip) { Chat.react(m, chip.dataset.e); return; }
    if (t.closest(".upl")) { if (m.up && m.up.ctl) m.up.ctl.abort(); return; }
    if (b.classList.contains("failed")) return Chat.resend(m);
    if (t.closest(".rq")) { if (m.reply && !m.reply.gone) Chat.jumpTo(m.reply.id); return; }
    const a = m.att || {};
    if (t.closest(".vm-play")) return Player.toggle(mkey(m), fileUrl(a.url));
    if (t.closest(".vm-spd")) return Player.speed();
    const wv = t.closest(".vm-wave");
    if (wv) {
      const r = wv.getBoundingClientRect();
      Player.seek(mkey(m), clamp((e.clientX - r.left) / r.width, 0, 1), fileUrl(a.url));
      if (Player.a.paused) Player.toggle(mkey(m), fileUrl(a.url));
      return;
    }
    if (t.closest(".media") && a.url) return Viewer.open(a.fid ? Object.assign({}, a, { url: a.url }) : a);
    if (t.closest(".fcard") && a.url && !m.pending) return /^video\//.test(a.mime || "") ? Viewer.open(a) : Attach.download(a);
    // двойное касание текста — быстрая реакция
    if (m.id && (m.kind === "text" || !m.kind)) {
      const now = Date.now();
      if (Chat.lastTap && Chat.lastTap.k === b.dataset.k && now - Chat.lastTap.t < 300) { Chat.lastTap = null; Chat.react(m, "❤️", true); }
      else Chat.lastTap = { k: b.dataset.k, t: now };
    }
  },

  // ───────────── заголовок и открытие ─────────────
  updateHeader() {
    const p = Chat.peer; if (!p) return;
    $("chat-av").innerHTML = avatar(p, "sm");
    $("chat-name").innerHTML = nameHTML(p);
    const s = $("chat-sub"); s.textContent = statusText(p); s.classList.toggle("on", !!p.online && !p.is_system);
  },

  async open(peer) {
    Chat.peer = peer; Chat.msgs = []; Chat.pins = []; Chat.pinI = 0; Chat.lastDay = ""; Chat.loading = true; Chat.hasMore = false; Chat.loadingMore = false;
    Chat.replyTo = null; Chat.editing = null;
    Chat.updateHeader(); Chat.renderPins(); Chat.renderBar();
    $("msgs").innerHTML = ""; Editor.clear(); Panel.hide(); Chat.syncMain();
    Nav.open("chat", () => {
      Chat.peer = null; MsgMenu.close(true); Panel.hide(); Voice.cancel(); Player.stop(); Editor.clear(); Editor.hideTb();
      Chat.replyTo = null; Chat.editing = null; Chats.load();
    });
    await Chat.fetch();
    Chats.markRead(peer.id);
  },

  // Загрузка последних сообщений. keep=true — не прыгать вниз, сохранить положение прокрутки.
  async fetch(keep) {
    const p = Chat.peer; if (!p) return;
    try {
      const d = await api("/api/messages/" + p.id + "?limit=" + PAGE);
      if (Chat.peer !== p) return;
      const fresh = d.messages;
      const minId = fresh.length ? fresh[0].id : Infinity;
      const maxId = fresh.length ? fresh[fresh.length - 1].id : 0;
      const older = Chat.msgs.filter((m) => m.id && m.id < minId && !fresh.some((x) => same(m, x)));
      const extra = Chat.msgs.filter((m) => !older.includes(m) && !fresh.some((x) => same(m, x)) &&
        (m.pending || m.failed || (m.id && m.id > maxId)));
      Chat.msgs = older.concat(fresh, extra);
      if (!older.length) Chat.hasMore = !!d.has_more;
      if (d.pins) { Chat.pins = d.pins; Chat.renderPins(); }
      Chat.render(keep);
    } catch (e) { toast(e.message); }
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
      const d = await api("/api/messages/" + p.id + "?before=" + first.id + "&limit=" + PAGE);
      if (Chat.peer !== p) return;
      const have = new Set(Chat.msgs.filter((m) => m.id).map((m) => m.id));
      Chat.msgs = d.messages.filter((m) => !have.has(m.id)).concat(Chat.msgs);
      Chat.hasMore = !!d.has_more;
      Chat.render(true);
    } catch (e) { toast(e.message); }
    finally { Chat.loadingMore = false; }
  },

  // ───────────── пузыри ─────────────
  textHTML(m) { return m.sender === SYS && !m.ents ? fmtText(m.text) : Rich.render(m.text, m.ents); },

  replyHTML(m) {
    const r = m.reply;
    if (!r || r.gone) return `<div class="rq gone"><i></i><div><b>Ответ</b><span>Сообщение удалено</span></div></div>`;
    const who = r.sender === App.user.id ? "Вы" : dispName(Chat.peer || {});
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

  mediaHTML(m, time) {
    const a = m.att || {}, k = m.kind;
    const ratio = a.w && a.h ? clamp(a.w / a.h, 0.6, 1.9) : 1.25;
    const src = fileUrl(k === "gif" ? a.url : a.turl || a.url);
    const inner = k === "gif" && /^video\//.test(a.mime || "") ? `<video src="${src}" muted loop autoplay playsinline></video>` : `<img src="${src}" alt="" decoding="async">`;
    return `<div class="media${k === "gif" ? " gif" : ""}" style="aspect-ratio:${ratio.toFixed(3)}">${inner}${k === "gif" ? '<span class="gtag">GIF</span>' : ""}${m.up ? Chat.ring(m) : ""}${time || ""}</div>`;
  },
  fileHTML(m) {
    const a = m.att || {}, vid = /^video\//.test(a.mime || "");
    const ext = ((a.name || "").split(".").pop() || "FILE").slice(0, 4).toUpperCase();
    return `<div class="fcard"><div class="fic${vid ? " vid" : ""}">${m.up ? Chat.ring(m) : vid ? PLAY_SVG : esc(ext)}</div><div class="fi"><b>${esc(a.name || "Файл")}</b><small>${fmtSize(a.size || 0)}</small></div></div>`;
  },
  stickerHTML(m, time) {
    const a = m.att || {};
    const art = a.b ? Stk.svg(a.b) || '<span class="tx">Стикер</span>' : `<img src="${fileUrl(a.url)}" alt="">`;
    return `<div class="stk-w">${art}${time || ""}</div>`;
  },

  bubble(m, prev, isNew) {
    const out = m.sender === App.user.id, k = m.kind || "text";
    const cont = prev && prev.sender === m.sender && m.ts - prev.ts < 120 && sameDay(new Date(prev.ts * 1000), new Date(m.ts * 1000)) && (prev.kind || "text") !== "sticker" && k !== "sticker";
    const hasCap = !!(m.text && k !== "text");
    const ov = ((k === "photo" || k === "gif") && !hasCap) || k === "sticker";
    const time = `<span class="t${ov ? " ov" : ""}">${m.edited ? "изм. " : ""}${fmtTime(m.ts)}${out ? `<span class="st">${stIcon(m)}</span>` : ""}</span>`;
    let h = "";
    if (m.fw) h += `<div class="fw">Переслано от <b>${esc(m.fw.name || "")}</b></div>`;
    if (m.reply_to || m.reply) h += Chat.replyHTML(m);
    if (k === "text") h += `<span class="tx">${Chat.textHTML(m)}</span>`;
    else if (k === "photo" || k === "gif") h += Chat.mediaHTML(m, ov ? time : "");
    else if (k === "file") h += Chat.fileHTML(m);
    else if (k === "voice") h += Player.html(m);
    else if (k === "sticker") h += Chat.stickerHTML(m, time);
    if (hasCap) h += `<div class="capw"><span class="tx cap">${Chat.textHTML(m)}</span>${time}</div>`;     // подпись и время в одной строке
    const rx = m.reacts && m.reacts.length
      ? `<div class="rx">${m.reacts.map((r) => `<button class="rx-chip${r.mine ? " mine" : ""}" data-e="${esc(r.e)}"><span class="e">${r.e}</span>${r.n > 1 ? `<span class="n">${r.n}</span>` : ""}</button>`).join("")}</div>` : "";
    return `<div class="b ${out ? "out" : "in"}${cont ? " cont" : ""} k-${k}${hasCap ? " hascap" : ""}${m.failed ? " failed" : ""}${m.pending ? " pending" : ""}${isNew ? " new" : ""}" data-k="${mkey(m)}"${m.id ? ` data-id="${m.id}"` : ""}>${h}${ov || hasCap ? "" : time}${rx}</div>`;
  },
  dayHead(m) {
    const day = new Date(m.ts * 1000).toDateString();
    if (day === Chat.lastDay) return "";
    Chat.lastDay = day; return `<div class="day">${fmtDay(m.ts)}</div>`;
  },

  render(keep) {
    const box = $("msgs"); Chat.lastDay = ""; let html = "", prev = null;
    const fromBottom = box.scrollHeight - box.scrollTop;
    if (!Chat.msgs.length) html = `<div class="empty"><h3>Сообщений пока нет</h3><p>${Chat.peer && Chat.peer.is_system ? "Это официальный аккаунт: он принимает любые сообщения, но не отвечает." : "Напишите первым."}</p></div>`;
    for (const m of Chat.msgs) { html += Chat.dayHead(m) + Chat.bubble(m, prev); prev = m; }
    box.innerHTML = html;
    box.scrollTop = keep ? box.scrollHeight - fromBottom : box.scrollHeight;
    Player.paint();
    if (Chat.hasMore && box.scrollHeight <= box.clientHeight + 40) setTimeout(() => Chat.more(), 0);
  },

  append(m) {
    const box = $("msgs"), prev = Chat.msgs[Chat.msgs.length - 2] || null;
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 200 || m.sender === App.user.id;
    const empty = box.querySelector(".empty"); if (empty) empty.remove();
    box.insertAdjacentHTML("beforeend", Chat.dayHead(m) + Chat.bubble(m, prev, true));
    Player.paint();
    if (near) {
      const go = () => { box.scrollTop = box.scrollHeight; };
      requestAnimationFrame(go);
      box.querySelectorAll("img:not([data-s])").forEach((i) => { i.dataset.s = 1; i.addEventListener("load", go, { once: true }); });
    }
  },

  // перерисовать один пузырь на месте
  patch(m) {
    const box = $("msgs");
    const el = box.querySelector(`[data-k="${mkey(m)}"]`) || (m.id && box.querySelector(`[data-id="${m.id}"]`));
    if (!el) return;
    const i = Chat.msgs.indexOf(m);
    const tmp = document.createElement("div");
    tmp.innerHTML = Chat.bubble(m, Chat.msgs[i - 1] || null, false);
    const fresh = tmp.firstElementChild;
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    el.replaceWith(fresh);
    Player.paint();
    if (near) box.scrollTop = box.scrollHeight;
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
    if (!Chat.peer) return;
    const pid = Chat.peer.id;
    const other = m.sender === App.user.id ? m.receiver : m.sender;
    if (other !== pid) return;
    const own = Chat.msgs.find((x) => same(x, m));
    if (own) {
      const old = own.att ? { url: own.att.url, turl: own.att.turl } : null;
      Object.assign(own, m, { pending: false, failed: false, up: null });
      Chat.keepLocal(own, old);
      return Chat.patch(own);
    }
    Chat.msgs.push(m); Chat.append(m);
    if (m.sender === pid) {
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
    const r = Chat.replyTo;
    Editor.clear(); Chat.clearReply(); haptic("light");
    Chat.post({ kind: "text", text, ents: ents.length ? ents : undefined, reply_to: r ? r.id : undefined, reply: r ? Chat.replyOf(r) : undefined });
  },

  // создать локальное «отправляется…» сообщение и отправить
  post(p, noSend) {
    const peer = Chat.peer; if (!peer) return null;
    const m = Object.assign({ cid: newCid(), sender: App.user.id, receiver: peer.id, ts: Math.floor(Date.now() / 1000), is_read: 0, pending: true, kind: "text", text: "" }, p);
    if (!m.reply_to && Chat.replyTo && p.kind !== "text") { m.reply_to = Chat.replyTo.id; m.reply = Chat.replyOf(Chat.replyTo); Chat.clearReply(); }
    m._peer = peer;
    Chat.msgs.push(m); Chat.append(m); Chats.upsert(peer, m, false);
    if (!noSend) Chat.transmit(m);
    return m;
  },

  async transmit(m) {
    const peer = m._peer || Chat.peer;
    try {
      const d = await api("/api/send", { method: "POST", body: { to: peer.id, text: m.text, cid: m.cid, kind: m.kind, ents: m.ents, att: sendAtt(m.att), reply_to: m.reply_to } });
      const old = m.att ? { url: m.att.url, turl: m.att.turl } : null;
      Object.assign(m, d.message, { pending: false, failed: false, up: null, file: null });
      Chat.keepLocal(m, old);
      Chats.upsert(peer, m, false);
    } catch (e) { m.pending = false; m.failed = true; toast(e.message); }
    if (Chat.peer === peer) Chat.patch(m);
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
  async sendFile(file, caption) {
    if (!Chat.peer) return;
    let kind = "file", w, h;
    if (/^image\//.test(file.type) && !/svg/.test(file.type)) {
      const t = await Up.thumb(file);                           // миниатюра для ленты; оригинал не трогаем
      if (t && t.w) { kind = file.type === "image/gif" ? "gif" : t.blob ? "photo" : "file"; w = t.w; h = t.h; }
      if (t && kind !== "file") file.__thumb = t.blob;
    }
    const local = URL.createObjectURL(file);
    const turl = kind === "photo" && file.__thumb ? URL.createObjectURL(file.__thumb) : undefined;   // лента показывает лёгкую миниатюру, оригинал — в просмотрщике
    const m = Chat.post({ kind, text: caption || "", att: { name: file.name, size: file.size, mime: file.type || "application/octet-stream", w, h, url: local, turl }, up: { pct: 0, ctl: {} }, file }, true);
    if (m) Chat.runUpload(m);
  },

  async runUpload(m) {
    const file = m.file;
    m.up = m.up || { pct: 0, ctl: {} };
    m.up.ctl = {};
    Chat.patch(m);
    try {
      if (file.__thumb && !m.tfid) m.tfid = await Up.upload(file.__thumb, { name: "thumb.jpg", mime: "image/jpeg" });
      const fid = await Up.upload(file, {
        fid: m.fidTmp, ctl: m.up.ctl, name: m.att.name, mime: m.att.mime,
        onFid: (id) => { m.fidTmp = id; },
        onProgress: (p) => { m.up.pct = p; Chat.paintProgress(m); },
      });
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
    const who = edit ? "Редактирование" : "Ответ " + (m.sender === App.user.id ? "себе" : dispName(Chat.peer || {}));
    bar.querySelector(".cb-ic").innerHTML = edit ? ICON.edit : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v3"/></svg>';
    bar.querySelector("b").textContent = who;
    bar.querySelector("span").textContent = Rich.preview(m) || "Сообщение";
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
  async react(m, e, quick) {
    if (!m || !m.id) return;
    const cur = (m.reacts || []).find((r) => r.mine);
    const remove = !!cur && cur.e === e && !quick;
    const prev = (m.reacts || []).map((r) => Object.assign({}, r));
    let list = prev.map((r) => Object.assign({}, r));
    list.forEach((r) => { if (r.mine) { r.n--; r.mine = false; } });      // свою прежнюю реакцию снимаем
    list = list.filter((r) => r.n > 0);
    if (!remove) {
      const t = list.find((r) => r.e === e);
      if (t) { t.n++; t.mine = true; } else list.push({ e, n: 1, mine: true });
    }
    m.reacts = list;
    Chat.patch(m);
    if (!remove) Chat.fly(m, e);
    haptic("light");
    try {
      const d = await api("/api/react", { method: "POST", body: { id: m.id, emoji: remove ? "" : e } });
      m.reacts = d.reacts; Chat.patch(m);
    } catch (er) { m.reacts = prev; Chat.patch(m); toast(er.message); }
  },
  // большая реакция «вылетает» над пузырём
  fly(m, e) {
    const el = $("msgs").querySelector(`[data-k="${mkey(m)}"]`); if (!el) return;
    const f = document.createElement("div");
    f.className = "rx-fly"; f.textContent = e;
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
    bar.innerHTML = `${segs}<div class="pb-t"><b>Закреплённое сообщение${n > 1 ? " #" + (n - i) : ""}</b><span>${esc(Rich.preview({ kind: p.kind, text: p.text, att: { em: p.em, name: p.name } }) || "Сообщение")}</span></div>
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
    if (mine) {
      const v = await UI.sheet({ title: "Удалить сообщение?", actions: [{ label: "Удалить у меня", value: "me", danger: true }, { label: "Удалить у " + dispName(Chat.peer), value: "all", danger: true }] });
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
    if (a === "copy") { copyText(m.text || ""); return toast("Скопировано"); }
    if (a === "forward") return Fwd.open([m.id]);
    if (a === "pin") return Chat.pin(m, true);
    if (a === "unpin") return Chat.pin(m, false);
    if (a === "edit") return Chat.startEdit(m);
    if (a === "del") return Chat.del(m);
    if (a === "stk") return Panel.saveFrom(m, "sticker");
    if (a === "gif") return Panel.saveFrom(m, "gif");
    if (a === "dl") return m.att && Attach.download(m.att);
  },
};
