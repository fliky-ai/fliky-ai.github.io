// Вкладка «Чаты»: список диалогов.
const Chats = {
  list: [], q: "",

  bind() {
    $("chat-q").addEventListener("input", (e) => { Chats.q = e.target.value.trim().toLowerCase(); Chats.render(); });
    $("chat-list").addEventListener("click", (e) => {
      const r = e.target.closest(".row"); if (!r) return;
      Chat.open(Chats.list[+r.dataset.i].peer);
    });
  },

  async load() {
    try { Chats.list = (await api("/api/chats")).chats; Chats.render(); } catch (e) {}
  },

  render() {
    const box = $("chat-list");
    const items = Chats.list.map((c, i) => ({ c, i })).filter(({ c }) =>
      !Chats.q || (c.peer.name + c.peer.number).toLowerCase().includes(Chats.q));
    const total = Chats.list.reduce((s, c) => s + c.unread, 0);
    const b = $("tab-badge"); b.textContent = total > 99 ? "99+" : total; b.classList.toggle("hidden", !total);

    if (!items.length) {
      box.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8.5 8.5 0 0 1-12.4 7.5L3 21l1.6-5.3A8.5 8.5 0 1 1 21 12z"/></svg>
        <h3>${Chats.q ? "Ничего не найдено" : "Пока нет чатов"}</h3><p>${Chats.q ? "Попробуйте другой запрос." : "Найдите человека во вкладке «Контакты» и напишите ему."}</p></div>`;
      return;
    }
    box.innerHTML = items.map(({ c, i }) => {
      const mine = c.last.sender === App.user.id;
      return `<button class="row" data-i="${i}">${avatar(c.peer)}
        <div class="main">
          <div class="top"><span class="name">${nameHTML(c.peer)}</span><span class="time">${listTime(c.last.ts)}</span></div>
          <div class="bottom"><span class="prev">${mine ? "<b>Вы:</b> " : ""}${esc(c.last.text.split("\n")[0])}</span>${c.unread ? `<span class="badge">${c.unread}</span>` : ""}</div>
        </div></button>`;
    }).join("");
  },
};
