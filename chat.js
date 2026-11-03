// Экран переписки: мгновенная отправка, галочки, подгрузка истории, долгое нажатие без системного меню.
const CK1 = '<svg class="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const CK2 = '<svg class="ck read" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m2.5 12.5 4.5 4.5L16.5 7.5"/><path d="m11 16.5 1 .9L21.5 7.5"/></svg>';
const CLK = '<svg class="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
const FAIL = '<svg class="ck fail" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 16.5v.1"/></svg>';

const PAGE = 50;   // сколько сообщений грузим за раз
const mkey = (m) => (m.cid ? "c" + m.cid : "i" + m.id);
const same = (a, b) => !!((a.cid && b.cid && a.cid === b.cid) || (a.id && b.id && a.id === b.id));
const stIcon = (m) => (m.failed ? FAIL : m.pending ? CLK : m.is_read ? CK2 : CK1);

const Chat = {
  peer: null, msgs: [], lastDay: "", loading: false, hasMore: false, loadingMore: false,

  bind() {
    const inp = $("msg-input"), box = $("msgs");
    inp.addEventListener("input", () => {
      inp.style.height = "auto"; inp.style.height = Math.min(inp.scrollHeight, 120) + "px";
      $("send").classList.toggle("show", !!inp.value.trim());
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer:fine)").matches) { e.preventDefault(); Chat.send(); }
    });
    $("send").addEventListener("pointerdown", (e) => e.preventDefault());   // клавиатура не закрывается
    $("send").onclick = () => Chat.send();
    $("chat-head").onclick = () => { if (Chat.peer && !Chat.peer.is_system) UserProfile.open(Chat.peer); };

    // доскроллили до верха — подгружаем более старые сообщения
    box.addEventListener("scroll", () => { if (box.scrollTop < 140) Chat.more(); }, { passive: true });

    // долгое нажатие → своё меню, а не системное
    let lp = null;
    box.addEventListener("touchstart", (e) => {
      const b = e.target.closest(".b"); if (!b) return;
      const t = e.touches[0]; lp = setTimeout(() => Chat.menu(b, t.clientX, t.clientY), 420);
    }, { passive: true });
    ["touchend", "touchmove", "touchcancel"].forEach((ev) => box.addEventListener(ev, () => clearTimeout(lp), { passive: true }));
    box.addEventListener("contextmenu", (e) => { e.preventDefault(); const b = e.target.closest(".b"); if (b) Chat.menu(b, e.clientX, e.clientY); });
    box.addEventListener("click", (e) => {
      const b = e.target.closest(".b.failed"); if (!b) return;
      const m = Chat.msgs.find((x) => mkey(x) === b.dataset.k); if (m) Chat.resend(m);
    });
    document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#ctx")) $("ctx").classList.add("hidden"); });
  },

  menu(el, x, y) {
    const m = Chat.msgs.find((q) => mkey(q) === el.dataset.k); if (!m) return;
    haptic("medium");
    const c = $("ctx"); c.classList.remove("hidden");
    c.style.left = Math.max(8, Math.min(x, innerWidth - c.offsetWidth - 8)) + "px";
    c.style.top = Math.max(8, Math.min(y, innerHeight - c.offsetHeight - 8)) + "px";
    $("ctx-copy").onclick = () => { copyText(plain(m.text)); c.classList.add("hidden"); toast("Скопировано"); };
  },

  updateHeader() {
    const p = Chat.peer; if (!p) return;
    $("chat-av").innerHTML = avatar(p, "sm");
    $("chat-name").innerHTML = nameHTML(p);
    const s = $("chat-sub"); s.textContent = statusText(p); s.classList.toggle("on", !!p.online && !p.is_system);
  },

  async open(peer) {
    Chat.peer = peer; Chat.msgs = []; Chat.lastDay = ""; Chat.loading = true; Chat.hasMore = false; Chat.loadingMore = false;
    Chat.updateHeader();
    $("msgs").innerHTML = ""; $("msg-input").value = ""; $("msg-input").style.height = "auto"; $("send").classList.remove("show");
    Nav.open("chat", () => { Chat.peer = null; $("ctx").classList.add("hidden"); Chats.load(); });
    await Chat.fetch();
    Chats.markRead(peer.id);
  },

  // Загрузка последних сообщений. keep=true — не прыгать вниз, сохранить положение прокрутки.
  // Уже подгруженная старая история, свои неотправленные и пришедшие по сокету за время загрузки остаются.
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
      Chat.render(keep);
    } catch (e) { toast(e.message); }
    finally { if (Chat.peer === p) Chat.loading = false; }
  },
  sync() { if (Chat.peer && !Chat.loading) Chat.fetch(true); },

  // Подгрузка более старых сообщений при прокрутке вверх.
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

  bubble(m, prev, isNew) {
    const out = m.sender === App.user.id;
    const cont = prev && prev.sender === m.sender && m.ts - prev.ts < 120 && sameDay(new Date(prev.ts * 1000), new Date(m.ts * 1000));
    return `<div class="b ${out ? "out" : "in"}${cont ? " cont" : ""}${m.failed ? " failed" : ""}${isNew ? " new" : ""}" data-k="${mkey(m)}"><span class="tx">${fmtText(m.text)}</span><span class="t">${fmtTime(m.ts)}${out ? `<span class="st">${stIcon(m)}</span>` : ""}</span></div>`;
  },
  dayHead(m) {
    const day = new Date(m.ts * 1000).toDateString();
    if (day === Chat.lastDay) return "";
    Chat.lastDay = day; return `<div class="day">${fmtDay(m.ts)}</div>`;
  },

  // keep=true — сохраняем расстояние до низа: и при подгрузке истории сверху, и при фоновой синхронизации
  render(keep) {
    const box = $("msgs"); Chat.lastDay = ""; let html = "", prev = null;
    const fromBottom = box.scrollHeight - box.scrollTop;
    if (!Chat.msgs.length) html = `<div class="empty"><h3>Сообщений пока нет</h3><p>${Chat.peer && Chat.peer.is_system ? "Это официальный аккаунт: он принимает любые сообщения, но не отвечает." : "Напишите первым."}</p></div>`;
    for (const m of Chat.msgs) { html += Chat.dayHead(m) + Chat.bubble(m, prev); prev = m; }
    box.innerHTML = html;
    box.scrollTop = keep ? box.scrollHeight - fromBottom : box.scrollHeight;
    // сообщений мало, экран не заполнен, а история ещё есть — догружаем
    if (Chat.hasMore && box.scrollHeight <= box.clientHeight + 40) setTimeout(() => Chat.more(), 0);
  },

  append(m) {
    const box = $("msgs"), prev = Chat.msgs[Chat.msgs.length - 2] || null;
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 160 || m.sender === App.user.id;
    const empty = box.querySelector(".empty"); if (empty) empty.remove();
    box.insertAdjacentHTML("beforeend", Chat.dayHead(m) + Chat.bubble(m, prev, true));
    if (near) requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  },

  patch(m) {
    const el = $("msgs").querySelector(`[data-k="${mkey(m)}"]`); if (!el) return;
    el.classList.toggle("failed", !!m.failed);
    const t = el.querySelector(".t");
    if (t) t.innerHTML = fmtTime(m.ts) + (m.sender === App.user.id ? `<span class="st">${stIcon(m)}</span>` : "");
  },

  async onMessage(m) {
    if (!Chat.peer) return;
    const pid = Chat.peer.id;
    const other = m.sender === App.user.id ? m.receiver : m.sender;
    if (other !== pid) return;
    const own = Chat.msgs.find((x) => same(x, m));
    if (own) { Object.assign(own, m, { pending: false, failed: false }); return Chat.patch(own); }
    Chat.msgs.push(m); Chat.append(m);
    if (m.sender === pid) {
      haptic("light");
      // легковесная пометка «прочитано» вместо перезагрузки всей переписки; только если экран виден
      if (document.visibilityState === "visible") {
        try { await api("/api/read/" + pid, { method: "POST", body: {} }); Chats.markRead(pid); } catch (e) {}
      }
    }
  },

  onRead(by) {
    if (!Chat.peer || Chat.peer.id !== by) return;
    Chat.msgs.forEach((m) => { if (m.sender === App.user.id && !m.is_read) { m.is_read = 1; Chat.patch(m); } });
  },

  async send() {
    const inp = $("msg-input"), text = inp.value.trim(), peer = Chat.peer;
    if (!text || !peer) return;
    inp.value = ""; inp.style.height = "auto"; $("send").classList.remove("show"); haptic("light");
    const m = { cid: Math.random().toString(36).slice(2, 10) + Date.now().toString(36), sender: App.user.id, receiver: peer.id,
                text, ts: Math.floor(Date.now() / 1000), is_read: 0, pending: true };
    Chat.msgs.push(m); Chat.append(m); Chats.upsert(peer, m, false);
    Chat.transmit(m, peer);
  },

  // cid уходит на сервер: повторная отправка того же сообщения не создаёт дубль
  async transmit(m, peer) {
    try {
      const d = await api("/api/send", { method: "POST", body: { to: peer.id, text: m.text, cid: m.cid } });
      Object.assign(m, d.message, { pending: false, failed: false });
      Chats.upsert(peer, m, false);
    } catch (e) { m.pending = false; m.failed = true; toast(e.message); }
    if (Chat.peer === peer) Chat.patch(m);
  },

  resend(m) {
    if (!Chat.peer) return;
    m.failed = false; m.pending = true; Chat.patch(m); Chat.transmit(m, Chat.peer);
  },
};
