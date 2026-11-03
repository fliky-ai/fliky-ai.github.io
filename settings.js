// Вкладка «Настройки» в стиле Telegram: профиль, мультиаккаунты, оформление, устройства.
const Settings = {
  render() {
    const u = App.user || {};
    const th = Theme.get();
    
    // Получаем список сохраненных аккаунтов из localStorage
    let accounts = [];
    try { accounts = JSON.parse(localStorage.getItem("tg_accounts") || "[]"); } catch(e){}
    // Убедимся, что текущий аккаунт есть в списке
    if (Store.token && u.id && !accounts.some(a => a.token === Store.token)) {
      accounts.push({ token: Store.token, id: u.id, name: u.name || u.number, username: u.username, number: u.number, avatar: u.avatar, is_system: u.is_system });
      localStorage.setItem("tg_accounts", JSON.stringify(accounts));
    }

    $("settings-box").innerHTML = `
      <!-- Шапка профиля в настройках как в Telegram -->
      <div class="settings-profile-header">
        <div class="sph-avatar">${avatar(u, "xl")}</div>
        <div class="sph-info">
          <h2>${esc(dispName(u))}</h2>
          <div class="sph-sub">${u.number ? esc(u.number) : ""}${u.username ? " · @" + esc(u.username) : ""}</div>
        </div>
      </div>

      <!-- Блок «Аккаунты» (переключение без выхода) -->
      <div class="group" style="margin-top: 12px;">
        <div class="item" id="s-accounts-toggle" style="justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 14px;">
            ${svg('<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/>')}
            <span>Аккаунты</span>
          </div>
          <span class="dim" style="font-size: 14px; font-weight: 600;">${accounts.length} ></span>
        </div>
        <div class="panel hidden" id="p-accounts">
          <div class="accounts-list">
            ${accounts.map(acc => `
              <div class="account-row ${acc.token === Store.token ? "active-acc" : ""}" data-token="${acc.token}">
                ${avatar(acc, "sm")}
                <div class="acc-meta">
                  <div class="acc-name">${esc(acc.name || "Аккаунт")} ${acc.token === Store.token ? '<span class="acc-badge">✓</span>' : ""}</div>
                  <div class="acc-phone">${esc(acc.number || "")}</div>
                </div>
              </div>
            `).join("")}
          </div>
          <button class="item" id="s-add-account" style="margin-top: 8px; border-top: 1px solid var(--line); color: var(--accent);">
            ${svg('<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>')}
            Добавить аккаунт
          </button>
        </div>
      </div>

      <!-- Основные пункты настроек как в Telegram -->
      <div class="group">
        <button class="item" id="s-edit-profile">${svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>')}<span>Аккаунт</span><small class="dim" style="margin-left:auto; font-weight:normal;">Номер, имя, о себе</small></button>
        <button class="item" id="s-dev">${svg('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>')}<span>Устройства</span></button>
      </div>

      <div class="group" style="margin-top:12px">
        <div class="item" style="padding-bottom:4px">${ICON.moon}<span>Оформление темы</span></div>
        <div class="seg" id="s-theme">
          <button data-t="auto" class="${th === "auto" ? "on" : ""}">Авто</button>
          <button data-t="dark" class="${th === "dark" ? "on" : ""}">Тёмная</button>
          <button data-t="light" class="${th === "light" ? "on" : ""}">Светлая</button>
        </div>
      </div>

      <div class="panel hidden" id="p-dev" style="margin: 0 14px 12px; background: var(--surface); border-radius: 16px;"></div>

      <div class="group"><button class="item danger" id="s-out">${ICON.out}<span>Выйти из этого аккаунта</span></button></div>
    `;

    // События переключения темы
    $("s-theme").onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      Theme.set(b.dataset.t);
      $("s-theme").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    };

    // Открыть/скрыть список аккаунтов
    $("s-accounts-toggle").onclick = () => {
      const p = $("p-accounts");
      p.classList.toggle("hidden");
    };

    // Переключение между аккаунтами без выхода
    document.querySelectorAll(".account-row").forEach(row => {
      row.onclick = () => {
        const token = row.dataset.token;
        if (token && token !== Store.token) {
          Store.token = token;
          location.reload();
        }
      };
    });

    // Добавить новый аккаунт (очищаем токен текущей сессии временно для входа в другой)
    $("s-add-account").onclick = async () => {
      if (await ask("Добавить еще один аккаунт? Текущая сессия сохранится в списке.", "Добавить")) {
        Store.token = ""; 
        location.reload();
      }
    };

    // Переход в редактирование профиля (имя, юзернейм, дата рождения)
    $("s-edit-profile").onclick = () => {
      Profile.openEdit();
    };

    $("s-dev").onclick = Settings.devices;
    
    // Выход из текущего аккаунта
    $("s-out").onclick = async () => {
      if (await ask("Выйти из этого аккаунта?", "Выйти")) { 
        // Удаляем из сохраненных мультиаккаунтов
        let accs = [];
        try { accs = JSON.parse(localStorage.getItem("tg_accounts") || "[]"); } catch(e){}
        accs = accs.filter(a => a.token !== Store.token);
        localStorage.setItem("tg_accounts", JSON.stringify(accs));
        
        Store.token = ""; 
        location.reload(); 
      }
    };
  },

  async devices() {
    const p = $("p-dev"); p.classList.toggle("hidden");
    if (p.classList.contains("hidden")) return;
    p.innerHTML = '<span class="dim" style="padding: 12px; display:block;">Загрузка…</span>';
    try {
      const s = (await api("/api/sessions")).sessions;
      p.innerHTML = s.map((x) => `<div class="dev" style="padding: 10px 0;"><b>${esc(x.device)}</b>${x.current ? ' <span class="me">· это устройство</span>' : ""}
        <small>${esc(x.country)} · IP ${esc(x.ip)}</small><small>${new Date(x.created * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small></div>`).join("") || "Нет данных";
      if (s.length > 1) {
        p.insertAdjacentHTML("beforeend", `<button class="item danger" id="s-kill" style="padding:12px 0; border-top: 1px solid var(--line);">${ICON.shield}<span>Завершить другие сеансы</span></button>`);
        $("s-kill").onclick = async () => {
          if (!(await ask("Завершить все сеансы, кроме этого?", "Завершить"))) return;
          try { await api("/api/sessions/terminate_others", { method: "POST", body: {} }); toast("Другие сеансы завершены"); Settings.devices(); } catch (e) { toast(e.message); }
        };
      }
    } catch (e) { p.textContent = e.message; }
  },
};

