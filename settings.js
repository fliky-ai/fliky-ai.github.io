// settings.js — вкладка «Настройки» в стиле Telegram: профиль, аккаунты, список разделов, поиск.
// Сами разделы лежат в set_look.js (чаты, язык, энергия), set_safe.js (конфиденциальность, устройства),
// set_misc.js (уведомления, данные, папки), set_prem.js (Premium, звёзды, бизнес, поддержка).

// Названия платных разделов. Поменяйте здесь, если нужно другое имя.
const NAME_PREMIUM = "Premium", NAME_STARS = "Звёзды", NAME_BIZ = "Для бизнеса";

const Settings = {
  q: "", unread: {}, unreadAt: 0,

  accLimit() { return App.user && App.user.premium ? 4 : 3; },

  // ─────────── главный экран ───────────
  render() {
    const u = App.user; if (!u) return;
    // текущий аккаунт всегда в списке, его имя и фото обновляются при каждой перерисовке
    if (Store.token && u.id) Accounts.upsert(Store.token, u);
    const others = Accounts.list().filter((a) => a.token !== Store.token);
    const box = $("settings-box");
    const searching = !!Settings.q;
    if (searching) { Settings.drawResults(); return; }

    const grp = (...rows) => `<div class="card2 irows">${rows.join("")}</div>`;
    const prem = u.premium ? `<span class="prem-star" title="Premium">${SI.starF}</span>` : "";
    const eco = Energy.thr();
    box.innerHTML = `
      <div class="s-top"><h1>${esc(T("Настройки"))}</h1>
        <div class="s-tools"><button id="s-sbtn" aria-label="${esc(T("Поиск"))}">${SI.search}</button><button id="s-menu" aria-label="${esc(T("Ещё"))}">${SI.dots}</button></div></div>
      <button class="s-me" id="s-me" aria-label="${esc(T("Профиль"))}">
        <span class="s-av">${Stories.av(u, "xl")}</span>
        <span class="s-name">${esc(dispName(u))}${prem}</span>
        <span class="s-sub">${u.number ? esc(fmtPhone(u.number)) : ""}${u.username ? " · @" + esc(u.username) : ""}</span>
      </button>

      <div class="card2 irows s-accs">
        ${others.map((a, i) => `<button class="irow acc" data-a="acc" data-v="${i}">${avatar(a, "sm")}<span class="tx"><b>${esc(a.name || T("Аккаунт"))}</b><small>${esc(fmtPhone(a.number || ""))}</small></span>${Settings.unread[a.token] ? `<span class="badge">${Settings.unread[a.token] > 99 ? "99+" : Settings.unread[a.token]}</span>` : ""}</button>`).join("")}
        <button class="irow" data-a="addacc">${R.ic("b plus", SI.plus)}<span class="tx"><b class="acc-t">${esc(T("Добавить аккаунт"))}</b></span></button>
      </div>

      ${grp(R.row({ a: "edit", ic: SI.user, c: "b", t: esc(T("Аккаунт")), s: esc(T("Имя, о себе, @username, день рождения")) }))}
      ${grp(
        R.row({ a: "chats", ic: SI.chat, c: "b", t: esc(T("Настройки чатов")) }),
        R.row({ a: "privacy", ic: SI.lock, c: "gr", t: esc(T("Конфиденциальность")) }),
        R.row({ a: "notif", ic: SI.bell, c: "r", t: esc(T("Уведомления")) }),
        R.row({ a: "data", ic: SI.data, c: "g", t: esc(T("Данные и память")) }),
        R.row({ a: "energy", ic: SI.battery, c: "o", t: esc(T("Энергосбережение")), r: esc(eco >= 100 ? T("Вкл.") : eco <= 0 ? T("Выкл.") : eco + "%") }),
        R.row({ a: "folders", ic: SI.folder, c: "t", t: esc(T("Папки с чатами")) }),
        R.row({ a: "devices", ic: SI.laptop, c: "o2", t: esc(T("Устройства")) }),
        R.row({ a: "lang", ic: SI.globe, c: "v", t: esc(T("Язык")), r: I18N.lang === "en" ? "English" : "Русский" }))}
      ${grp(
        R.row({ a: "premium", ic: SI.starF, c: "pr", t: esc(T(NAME_PREMIUM)), r: u.premium ? esc(T("активен")) : "" }),
        R.row({ a: "stars", ic: SI.starF, c: "y", t: esc(T(NAME_STARS)), r: u.stars ? String(u.stars) : "" }),
        R.row({ a: "biz", ic: SI.bag, c: "v2", t: esc(T(NAME_BIZ)) }),
        R.row({ a: "gift", ic: SI.gift, c: "p", t: esc(T("Отправить подарок")) }))}
      ${grp(
        R.row({ a: "ask", ic: SI.headset, c: "b", t: esc(T("Задать вопрос")) }),
        R.row({ ic: SI.help, c: "g", t: esc(T("Вопросы")), soon: 1, dis: 1 }),
        R.row({ ic: SI.bulb, c: "y2", t: esc(T("Возможности")), soon: 1, dis: 1 }),
        R.row({ a: "policy", ic: SI.doc, c: "gr", t: esc(T("Политика конфиденциальности")) }))}
      ${grp(R.row({ a: "out", ic: SI.out, c: "r", t: esc(T("Выйти")), danger: 1, chev: false }))}
      <p class="s-foot">${esc(T("Версия {0}", "1.4"))}</p>`;

    Settings.bindMain();
    Settings.fetchUnread();
  },

  bindMain() {
    const box = $("settings-box");
    $("s-me").onclick = () => App.go("profile");
    $("s-sbtn").onclick = () => Settings.search(true);
    $("s-menu").onclick = async () => {
      const v = await UI.sheet({ title: T("Настройки"), actions: [
        { label: T("Изменить профиль"), value: "edit" }, { label: T("Добавить аккаунт"), value: "add" }, { label: T("Выйти"), value: "out", danger: true }] });
      if (v === "edit") Profile.openEdit(); else if (v === "add") Settings.addAccount(); else if (v === "out") Settings.logout();
    };
    const go = {
      edit: () => Profile.openEdit(), chats: () => Settings.chats(), privacy: () => Settings.privacy(), notif: () => Settings.notif(),
      data: () => Settings.data(), energy: () => Settings.energy(), folders: () => Settings.folders(), devices: () => Settings.devices(),
      lang: () => Settings.lang(), premium: () => Settings.premium(), stars: () => Settings.stars(), biz: () => Settings.biz(),
      gift: () => Settings.gift(), ask: () => Settings.ask(), policy: () => Settings.policy(), out: () => Settings.logout(),
      addacc: () => Settings.addAccount(), acc: (el) => Settings.switchTo(+el.dataset.v),
    };
    box.onclick = (e) => {
      const el = e.target.closest("[data-a]"); if (!el || el.classList.contains("dis")) return;
      const f = go[el.dataset.a]; if (f) { haptic(); f(el); }
    };
  },

  // ─────────── аккаунты ───────────
  others() { return Accounts.list().filter((a) => a.token !== Store.token); },

  async fetchUnread(force) {
    const now = Date.now();
    if (!force && now - Settings.unreadAt < 15000) return;
    Settings.unreadAt = now;
    const list = Settings.others(); if (!list.length) return;
    let changed = false;
    await Promise.all(list.map(async (a) => {
      try {
        const r = await fetch(CONFIG.API + "/api/unread", { headers: { Authorization: "Bearer " + a.token } });
        if (r.status === 401) { Accounts.remove(a.token); changed = true; return; }
        const d = await r.json();
        const n = d.unread || 0;
        if (Settings.unread[a.token] !== n) { Settings.unread[a.token] = n; changed = true; }
      } catch (e) {}
    }));
    if (changed && !Settings.q && $("settings-box").querySelector(".s-accs")) { Settings.unreadAt = Date.now(); Settings.render(); }
  },

  switchTo(i) {
    const a = Settings.others()[i];
    if (!a) return;
    Store.token = a.token; location.reload();
  },

  async addAccount() {
    const n = Accounts.list().length, lim = Settings.accLimit();
    if (n >= lim) {
      const prem = !!App.user.premium;
      const v = await UI.sheet({ title: T("Достигнут лимит аккаунтов"),
        text: prem ? T("К приложению можно подключить до {0} аккаунтов. Чтобы добавить новый, выйдите из одного из текущих.", lim)
                   : T("К приложению можно подключить до {0} аккаунтов. С Premium — до 4.", lim),
        actions: prem ? [] : [{ label: T("Открыть Premium"), value: "p", accent: true }], cancel: T("Понятно") });
      if (v === "p") Settings.premium();
      return;
    }
    if (!(await ask(T("Добавить ещё один аккаунт? Текущий останется в списке."), T("Добавить"), false))) return;
    // запоминаем текущий, чтобы на экране входа можно было вернуться стрелкой «назад»
    Accounts.setPrev(Store.token); Store.token = ""; location.reload();
  },

  // выход: сначала завершаем сессию на сервере, иначе токен проживёт ещё 30 дней и останется в «Устройствах»
  async logout() {
    if (!(await ask(T("Выйти из этого аккаунта?"), T("Выйти")))) return;
    const tok = Store.token;
    try { await api("/api/auth/logout", { method: "POST", body: {} }); } catch (e) {}
    Accounts.remove(tok);
    Store.token = "";
    location.reload();
  },

  // ─────────── поиск по настройкам ───────────
  index() {
    const E = (t, p, ic, c, f, k = "") => ({ t: T(t), p: p ? T(p) : "", ic, c, f, k: (t + " " + T(t) + " " + (p || "") + " " + (p ? T(p) : "") + " " + k + " " + (k ? T(k) : "")).toLowerCase() });
    return [
      E("Аккаунт", "", SI.user, "b", () => Profile.openEdit(), "имя фамилия о себе username телефон день рождения профиль"),
      E("Настройки чатов", "", SI.chat, "b", () => Settings.chats(), "чат тема оформление"),
      E("Тема", "Настройки чатов", SI.palette, "b", () => Settings.chats(), "светлая тёмная ночная цвет акцент"),
      E("Обои", "Настройки чатов", SI.image, "b", () => Settings.wallpaper(), "фон картинка"),
      E("Размер текста", "Настройки чатов", SI.aa, "b", () => Settings.chats(), "шрифт крупный мелкий"),
      E("Автоматический ночной режим", "Настройки чатов", SI.moon, "b", () => Settings.night(), "тёмная тема расписание"),
      E("Встроенный браузер", "Настройки чатов", SI.compass, "b", () => Settings.chats(), "ссылки"),
      E("Стикеры и эмодзи", "Настройки чатов", SI.smile, "b", () => Settings.stick(), "реакция большие"),
      E("Медиа и звук", "Настройки чатов", SI.mic, "b", () => Settings.media(), "микрофон гифки видео"),
      E("Конфиденциальность", "", SI.lock, "gr", () => Settings.privacy(), "безопасность приватность"),
      E("Номер телефона", "Конфиденциальность", SI.call, "gr", () => Settings.privKey("phone")),
      E("Время захода", "Конфиденциальность", SI.eye, "gr", () => Settings.privKey("seen"), "был в сети онлайн"),
      E("Фотография профиля", "Конфиденциальность", SI.user, "gr", () => Settings.privKey("photo"), "аватар"),
      E("Пересылка сообщений", "Конфиденциальность", SI.fwd, "gr", () => Settings.privKey("fwd"), "ссылка на аккаунт"),
      E("Звонки", "Конфиденциальность", SI.call, "gr", () => Settings.privKey("calls")),
      E("О себе", "Конфиденциальность", SI.info, "gr", () => Settings.privKey("bio"), "био"),
      E("День рождения", "Конфиденциальность", SI.gift, "gr", () => Settings.privKey("birthday")),
      E("Облачный пароль", "Конфиденциальность", SI.key, "gr", () => Settings.cloud(), "двухэтапная проверка пароль"),
      E("Код-пароль", "Конфиденциальность", SI.lock, "gr", () => Settings.passcode(), "блокировка pin пин 4 цифры"),
      E("Автоудаление сообщений", "Конфиденциальность", SI.timer, "gr", () => Settings.autodel(), "таймер удалять"),
      E("Почта для входа", "Конфиденциальность", SI.mail, "gr", () => Settings.email(), "email e-mail адрес"),
      E("Ключи доступа", "Конфиденциальность", SI.key, "gr", () => Settings.passkeys(), "passkey"),
      E("Уведомления", "", SI.bell, "r", () => Settings.notif(), "звук вибрация предпросмотр"),
      E("Данные и память", "", SI.data, "g", () => Settings.data(), "кэш очистить хранилище трафик"),
      E("Очистить кэш", "Данные и память", SI.trash, "g", () => Settings.data(), "освободить место"),
      E("Энергосбережение", "", SI.battery, "o", () => Settings.energy(), "заряд батарея анимации"),
      E("Папки с чатами", "", SI.folder, "t", () => Settings.folders(), "папка вкладки"),
      E("Устройства", "", SI.laptop, "o2", () => Settings.devices(), "сеансы завершить"),
      E("Язык", "", SI.globe, "v", () => Settings.lang(), "english русский"),
      E(NAME_PREMIUM, "", SI.starF, "pr", () => Settings.premium(), "подписка"),
      E(NAME_STARS, "", SI.starF, "y", () => Settings.stars(), "баланс пополнить"),
      E(NAME_BIZ, "", SI.bag, "v2", () => Settings.biz(), "адрес график быстрые ответы приветствие"),
      E("Отправить подарок", "", SI.gift, "p", () => Settings.gift()),
      E("Задать вопрос", "", SI.headset, "b", () => Settings.ask(), "поддержка помощь"),
      E("Политика конфиденциальности", "", SI.doc, "gr", () => Settings.policy()),
      E("Выйти", "", SI.out, "r", () => Settings.logout(), "выход"),
    ];
  },

  search(on) {
    Settings.q = on ? " " : "";
    const box = $("settings-box");
    if (!on) { Settings.render(); return; }
    box.innerHTML = `<div class="s-top s-find"><label class="s-q">${SI.search}<input id="s-q" placeholder="${esc(T("Поиск настроек"))}" autocomplete="off" autocapitalize="off" spellcheck="false"></label><button id="s-qx" class="s-cancel">${esc(T("Отмена"))}</button></div><div id="s-res"></div>`;
    const inp = $("s-q");
    inp.oninput = () => { Settings.q = inp.value.trim() ? inp.value.trim() : " "; Settings.drawResults(); };
    $("s-qx").onclick = () => Settings.search(false);
    Settings.drawResults();
    setTimeout(() => inp.focus(), 60);
  },

  drawResults() {
    const res = $("s-res"); if (!res) return;
    const q = Settings.q.trim().toLowerCase();
    const all = Settings.index();
    const list = q ? all.filter((x) => x.k.includes(q) || x.t.toLowerCase().includes(q)) : all.slice(0, 8);
    res.innerHTML = list.length
      ? `<div class="card2 irows">${list.map((x, i) => `<button class="irow" data-i="${i}">${R.ic(x.c, x.ic)}<span class="tx"><b>${esc(x.t)}</b>${x.p ? `<small>${esc(x.p)}</small>` : ""}</span></button>`).join("")}</div>`
      : `<div class="empty"><h3>${esc(T("Ничего не найдено"))}</h3><p>${esc(T("Попробуйте другое слово."))}</p></div>`;
    res.onclick = (e) => { const b = e.target.closest("[data-i]"); if (b) list[+b.dataset.i].f(); };
  },
};

// перерисовка вкладки при возврате на неё (счётчики аккаунтов, баланс)
document.addEventListener("click", (e) => {
  const t = e.target.closest && e.target.closest('.tab[data-tab="settings"]');
  if (t) { Settings.fetchUnread(true); }
});
