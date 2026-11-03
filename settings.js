
// Вкладка «Настройки»: тема, устройства, завершение сеансов, выход.
const Settings = {
  render() {
    const th = Theme.get();
    $("settings-box").innerHTML = `
      <div class="group" style="margin-top:16px">
        <div class="item" style="padding-bottom:0">${ICON.moon}Оформление</div>
        <div class="seg" id="s-theme">
          <button data-t="auto" class="${th === "auto" ? "on" : ""}">Авто</button>
          <button data-t="dark" class="${th === "dark" ? "on" : ""}">Тёмная</button>
          <button data-t="light" class="${th === "light" ? "on" : ""}">Светлая</button>
        </div>
      </div>
      <div class="group">
        <button class="item" id="s-dev">${ICON.device}Устройства</button>
        <div class="panel hidden" id="p-dev"></div>
      </div>
      <div class="group"><button class="item danger" id="s-out">${ICON.out}Выйти из аккаунта</button></div>`;

    $("s-theme").onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      Theme.set(b.dataset.t);
      $("s-theme").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    };
    $("s-dev").onclick = Settings.devices;
    $("s-out").onclick = async () => {
      if (await ask("Выйти из аккаунта на этом устройстве?", "Выйти")) { Store.token = ""; location.reload(); }
    };
  },

  async devices() {
    const p = $("p-dev"); p.classList.toggle("hidden");
    if (p.classList.contains("hidden")) return;
    p.innerHTML = '<span class="dim">Загрузка…</span>';
    try {
      const s = (await api("/api/sessions")).sessions;
      p.innerHTML = s.map((x) => `<div class="dev"><b>${esc(x.device)}</b>${x.current ? ' <span class="me">· это устройство</span>' : ""}
        <small>${esc(x.country)} · IP ${esc(x.ip)}</small><small>${new Date(x.created * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small></div>`).join("") || "Нет данных";
      if (s.length > 1) {
        p.insertAdjacentHTML("beforeend", `<button class="item danger" id="s-kill" style="padding:12px 0">${ICON.shield}Завершить другие сеансы</button>`);
        $("s-kill").onclick = async () => {
          if (!(await ask("Завершить все сеансы, кроме этого?", "Завершить"))) return;
          try { await api("/api/sessions/terminate_others", { method: "POST", body: {} }); toast("Другие сеансы завершены"); Settings.devices(); Settings.devices(); } catch (e) { toast(e.message); }
        };
      }
    } catch (e) { p.textContent = e.message; }
  },
};
