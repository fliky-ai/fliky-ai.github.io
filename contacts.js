// Вкладка «Контакты»: поиск людей по номеру или @username.
const Contacts = {
  timer: null, users: [],

  bind() {
    Contacts.empty("Найдите человека", "Введите номер или @username — минимум 3 символа.");
    $("contact-q").addEventListener("input", (e) => {
      clearTimeout(Contacts.timer);
      const q = e.target.value.trim();
      if (q.length < 3) return Contacts.empty("Найдите человека", "Введите номер или @username — минимум 3 символа.");
      Contacts.timer = setTimeout(() => Contacts.search(q), 300);
    });
    $("contact-list").addEventListener("click", (e) => {
      const r = e.target.closest(".row"); if (!r) return;
      App.go("chats"); Chat.open(Contacts.users[+r.dataset.i]);
    });
  },

  empty(h, p) {
    $("contact-list").innerHTML = `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><h3>${h}</h3><p>${p}</p></div>`;
  },

  async search(q) {
    try {
      Contacts.users = (await api("/api/search?q=" + encodeURIComponent(q))).users;
      if (!Contacts.users.length) return Contacts.empty("Никого не нашли", "Проверьте номер: он выдаётся в боте командой /start.");
      $("contact-list").innerHTML = Contacts.users.map((u, i) => `<button class="row" data-i="${i}">${avatar(u)}
        <div class="main"><div class="name">${esc(u.name)}</div><div class="prev">${esc(u.number)}${u.username ? " · @" + esc(u.username) : ""}</div></div></button>`).join("");
    } catch (e) { toast(e.message); }
  },
};
