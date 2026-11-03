
// Вкладка «Чаты»: список диалогов и поиск людей (имя или @username).
const Chats = {
  list: [], q: "", found: [], timer: null,

  bind() {
    const inp = $("chat-q");
    inp.addEventListener("input", () => {
      Chats.q = inp.value.trim().replace(/^@/, "");
      $("chat-q-clear").classList.toggle("hidden", !inp.value);
      clearTimeout(Chats.timer); Chats.found = [];
      if (Chats.q.length >= 2) {
        const q = Chats.q;
        Chats.timer = setTimeout(async () => {
          try { const d = await api("/api/search?q=" + encodeURIComponent(q)); if (Chats.q === q) { Chats.found = d.users; Chats.render(); } } catch (e) {}
        }, 250);
      }
      Chats.render();
    });
    $("chat-q-clear").onclick = () => { inp.value = ""; inp.dispatchEvent(new Event("input")); inp.focus(); };
    $("chat-list").addEventListener("click", (e) => {
      const r = e.target.closest(".row"); if (!r) return;
      const peer = r.dataset.k === "c" ? Chats.list[+r.dataset.i].peer : Chats.found[+r.dataset.i];
      if (r.dataset.k === "u") { $("chat-q").value = ""; Chats.q = ""; Chats.found = []; $("chat-q-clear").classList.add("hidden"); }
      Chat.open(peer);
    });
  },

  async load() {
    try { Chats.list = (await api("/api/chats")).chats; Chats.render(); Stories.load(); } catch (e) {}
  },

  upsert(peer, m, incoming) {
    let i = Chats.list.findIndex((c) => c.peer.id === peer.id), c;
    if (i < 0) c = { peer, last: m, unread: 0 };
    else { c = Chats.list.splice(i, 1)[0]; c.last = m; }
    const viewing = Chat.peer && Chat.peer.id === peer.id && document.visibilityState === "visible";
    if (incoming && !viewing) c.unread++;
    Chats.list.unshift(c); Chats.render();
  },

  onMessage(m) {
    const mine = m.sender === App.user.id, pid = mine ? m.receiver : m.sender;
    const c = Chats.list.find((x) => x.peer.id === pid);
    if (!c) return Chats.load();
    if (c.last.id === m.id) return;
    Chats.upsert(c.peer, m, !mine);
  },

  // сообщение изменили: если оно последнее в чате — обновляем подпись в списке
  onEdit(m) {
    const pid = m.sender === App.user.id ? m.receiver : m.sender;
    const c = Chats.list.find((x) => x.peer.id === pid);
    if (c && c.last && c.last.id === m.id) { c.last = m; Chats.render(); }
  },

  markRead(pid) {
    const c = Chats.list.find((x) => x.peer.id === pid);
    if (c && c.unread) { c.unread = 0; Chats.render(); }
  },

  row(kind, i, p, sub, right) {
    return `<button class="row" data-k="${kind}" data-i="${i}">${Stories.av(p)}<div class="main">${right}<div class="bottom">${sub}</div></div></button>`;
  },

  render() {
    const total = Chats.list.reduce((s, c) => s + c.unread, 0);
    const b = $("tab-badge"); b.textContent = total > 99 ? "99+" : total; b.classList.toggle("hidden", !total);
    const box = $("chat-list"), q = Chats.q.toLowerCase();

    const chatRow = (c, i) => {
      const mine = c.last.sender === App.user.id;
      return Chats.row("c", i, c.peer,
        `<span class="prev">${mine ? "<b>Вы:</b> " : ""}${esc(Rich.preview(c.last).split("\n")[0])}</span>${c.unread ? `<span class="badge">${c.unread}</span>` : ""}`,
        `<div class="top"><span class="name">${nameHTML(c.peer)}</span><span class="time">${listTime(c.last.ts)}</span></div>`);
    };

    if (!q) {
      if (!Chats.list.length) {
        box.innerHTML = `<div class="empty">${svg('<path d="M21 12a8.5 8.5 0 0 1-12.4 7.5L3 21l1.6-5.3A8.5 8.5 0 1 1 21 12z"/>')}<h3>Пока нет чатов</h3><p>Найдите человека через поиск: введите его имя или @username.</p></div>`;
        return;
      }
      box.innerHTML = Chats.list.map(chatRow).join("");
      return;
    }

    const local = Chats.list.map((c, i) => ({ c, i })).filter(({ c }) =>
      (dispName(c.peer) + " " + (c.peer.username || "")).toLowerCase().includes(q));
    const have = new Set(Chats.list.map((c) => c.peer.id));
    const glob = Chats.found.map((u, i) => ({ u, i })).filter(({ u }) => !have.has(u.id));
    let html = "";
    if (local.length) html += `<div class="sect">Чаты</div>` + local.map(({ c, i }) => chatRow(c, i)).join("");
    if (glob.length) html += `<div class="sect">Глобальный поиск</div>` + glob.map(({ u, i }) =>
      Chats.row("u", i, u, `<span class="prev">${u.username ? "@" + esc(u.username) : esc(statusText(u))}</span>`, `<div class="top"><span class="name">${nameHTML(u)}</span></div>`)).join("");
    box.innerHTML = html || `<div class="empty"><h3>Ничего не найдено</h3><p>Проверьте имя или @username.</p></div>`;
  },
};