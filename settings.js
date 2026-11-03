// Вкладка «Настройки»: профиль, устройства, выход.
const Settings = {
  render() {
    const u = App.user; if (!u) return;
    const ic = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    $("settings-box").innerHTML = `
      <div class="profile">${avatar(u, "lg")}<h2>${esc(u.name)}</h2>
        <div class="num">${esc(u.number)}${u.username ? " · @" + esc(u.username) : ""}</div>
        ${u.bio ? `<div class="num">${esc(u.bio)}</div>` : ""}</div>
      <div class="group">
        <button class="item" id="s-edit">${ic('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>')}Изменить профиль</button>
        <div class="panel hidden" id="p-edit">
          <label>Имя<input id="e-name" maxlength="64" value="${esc(u.name === u.number ? "" : u.name)}" placeholder="Как вас зовут"></label>
          <label>Имя пользователя<input id="e-user" maxlength="32" value="${esc(u.username)}" placeholder="username"></label>
          <label>О себе<textarea id="e-bio" rows="2" maxlength="200" placeholder="Пара слов о себе">${esc(u.bio)}</textarea></label>
          <button class="btn" id="e-save">Сохранить</button>
        </div>
        <button class="item" id="s-dev">${ic('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>')}Устройства</button>
        <div class="panel hidden" id="p-dev"></div>
      </div>
      <div class="group"><button class="item danger" id="s-out">${ic('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>')}Выйти</button></div>`;

    $("s-edit").onclick = () => $("p-edit").classList.toggle("hidden");
    $("s-dev").onclick = Settings.devices;
    $("e-save").onclick = Settings.save;
    $("s-out").onclick = () => { if (confirm("Выйти из аккаунта?")) { Store.token = ""; location.reload(); } };
  },

  async save() {
    try {
      const d = await api("/api/me/update", { method: "POST", body: {
        name: $("e-name").value.trim(), username: $("e-user").value.trim().replace(/^@/, ""), bio: $("e-bio").value.trim() } });
      App.user = d.user; Settings.render(); toast("Профиль сохранён");
    } catch (e) { toast(e.message); }
  },

  async devices() {
    const p = $("p-dev"); p.classList.toggle("hidden");
    if (p.classList.contains("hidden")) return;
    p.innerHTML = "Загрузка…";
    try {
      const s = (await api("/api/sessions")).sessions;
      p.innerHTML = s.map((x) => `<div class="dev"><b>${esc(x.device)}</b><small>${esc(x.country)} · IP ${esc(x.ip)}</small><small>${new Date(x.created * 1000).toLocaleString("ru-RU")}</small></div>`).join("") || "Нет данных";
    } catch (e) { p.textContent = e.message; }
  },
};
