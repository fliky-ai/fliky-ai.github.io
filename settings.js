// settings.js — вкладка «Настройки» в стиле Telegram: профиль, аккаунты, список разделов, поиск.
// Сами разделы лежат в set_look.js (чаты, язык, энергия), set_safe.js (конфиденциальность, устройства),
// set_misc.js (уведомления, данные, папки), set_prem.js (Premium, звёзды, бизнес, поддержка).

// Названия платных разделов. Поменяйте здесь, если нужно другое имя.
const TIPS_URL = "https://dicegram.dpdns.org/DicegramTips";
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
    const cap = (t) => `<div class="dx-cap">${esc(T(t))}</div>`;
    const eco = Energy.thr();
    const X = (typeof DX !== "undefined" && DX.I) || new Proxy({}, { get: () => "" });      // без rd.js экран всё равно рисуется
    const nUn = (a) => Settings.unread[a.token] || 0;
    const html = `
      <header class="tgh dx-sh"><div class="tgh-row">
        <div class="tgh-title"><span>${esc(T("Настройки"))}</span></div>
        <button id="s-sbtn" class="tgh-btn" type="button" aria-label="${esc(T("Поиск"))}">${X.search}</button>
        <button id="s-menu" class="tgh-btn" type="button" aria-label="${esc(T("Ещё"))}">${X.dots}</button>
      </div></header>

      <div class="dx-accs s-accs">
        <div class="dx-accs-h"><span>${esc(T("Аккаунты"))}</span><button data-a="accmgr">${esc(T("Управление"))}</button></div>
        <button class="dx-acc cur" data-a="me">${avatar(u, "sm")}<span class="tx"><b>${esc(dispName(u))}</b><small>${esc(T("Текущий"))}${u.number ? " · " + esc(fmtPhone(u.number)) : ""}</small></span><i class="dx-ck">${X.check}</i></button>
        ${others.map((a, i) => `<button class="dx-acc" data-a="acc" data-v="${i}">${avatar(a, "sm")}<span class="tx"><b>${esc(a.name || T("Аккаунт"))}</b><small>${esc(fmtPhone(a.number || ""))}</small></span>${nUn(a) ? `<span class="dx-un">${nUn(a) > 99 ? "99+" : nUn(a)}</span>` : ""}</button>`).join("")}
        <button class="dx-add" data-a="addacc"><i>${X.plus}</i><span>${esc(T("Добавить аккаунт"))}</span></button>
      </div>

      ${grp(R.row({ a: "edit", ic: SI.user, c: "b", t: esc(T("Аккаунт")), s: esc(T("Имя, о себе, @username, день рождения")) }))}
      ${cap("Основное")}
      ${grp(
        R.row({ a: "chats", ic: SI.chat, c: "b", t: esc(T("Настройки чатов")) }),
        R.row({ a: "privacy", ic: SI.lock, c: "gr", t: esc(T("Конфиденциальность")) }),
        R.row({ a: "notif", ic: SI.bell, c: "r", t: esc(T("Уведомления")) }),
        R.row({ a: "data", ic: SI.data, c: "g", t: esc(T("Данные и память")) }))}
      ${cap("Устройство")}
      ${grp(
        R.row({ a: "energy", ic: SI.battery, c: "o", t: esc(T("Энергосбережение")), r: esc(eco >= 100 ? T("Вкл.") : eco <= 0 ? T("Выкл.") : eco + "%") }),
        R.row({ a: "folders", ic: SI.folder, c: "t", t: esc(T("Папки с чатами")) }),
        R.row({ a: "devices", ic: SI.laptop, c: "o2", t: esc(T("Устройства")) }),
        R.row({ a: "lang", ic: SI.globe, c: "v", t: esc(T("Язык")), r: I18N.lang === "en" ? "English" : "Русский" }))}
      ${cap("Возможности")}
      ${grp(
        R.row({ a: "premium", ic: SI.starF, c: "pr", t: esc(T(NAME_PREMIUM)), r: u.premium ? esc(T("активен")) : "" }),
        R.row({ a: "stars", ic: starFancy(), c: "star", t: esc(T(NAME_STARS)), r: u.stars ? String(u.stars) : "" }))}
      ${grp(
        R.row({ a: "biz", ic: SI.bag, c: "v2", t: esc(T(NAME_BIZ)) }),
        R.row({ a: "gift", ic: SI.gift, c: "p", t: esc(T("Отправить подарок")) }),
        R.row({ a: "games", ic: SI.games, c: "t", t: esc(T("Игры")), s: esc(T("4 игры и таблицы лидеров дня")) }))}
      ${isStandalone() || (typeof AppPush !== "undefined" && AppPush.isApp()) ? "" : grp(R.row({ a: "install", ic: SI.laptop, c: "b", t: esc(T("Установить Dicegram")), s: esc(/Android/i.test(navigator.userAgent) ? T("Скачать APK или на экран «Домой»") : T("Как приложение на экран «Домой»")) }))}
      ${cap("Помощь")}
      ${grp(
        R.row({ a: "ask", ic: SI.headset, c: "b", t: esc(T("Задать вопрос")) }),
        R.row({ a: "tips", ic: SI.bulb, c: "y2", t: esc(T("Возможности Dicegram")), s: esc(T("советы и подсказки на сайте")) }),
        R.row({ a: "policy", ic: SI.doc, c: "gr", t: esc(T("Политика конфиденциальности")) }))}
      ${grp(R.row({ a: "out", ic: SI.out, c: "r", t: esc(T("Выйти")), danger: 1, chev: false }))}
      <p class="s-foot">${esc(T("Версия {0}", "1.5"))}</p>`;
    // одинаковую разметку не перерисовываем: ни мерцания аватарок, ни сброса прокрутки, ни потерянного нажатия
    if (box._dxh === html && box.querySelector(".dx-accs")) { Settings.fetchUnread(); return; }
    box._dxh = html;
    box.innerHTML = html;
    try { DX.hair(box); } catch (e) {}

    Settings.bindMain();
    Settings.fetchUnread();
  },

  bindMain() {
    const box = $("settings-box");
    $("s-sbtn").onclick = () => Settings.search(true);
    $("s-menu").onclick = async () => {
      const v = await UI.sheet({ title: T("Настройки"), actions: [
        { label: T("Изменить профиль"), value: "edit" }, { label: T("Добавить аккаунт"), value: "add" }, { label: T("Управление аккаунтами"), value: "mgr" },
        { label: T("Выйти"), value: "out", danger: true }] });
      if (v === "edit") Profile.openEdit(); else if (v === "add") Settings.addAccount(); else if (v === "mgr") Settings.accMenu(); else if (v === "out") Settings.logout();
    };
    const go = {
      edit: () => Profile.openEdit(), chats: () => Settings.chats(), privacy: () => Settings.privacy(), notif: () => Settings.notif(),
      data: () => Settings.data(), energy: () => Settings.energy(), folders: () => Settings.folders(), devices: () => Settings.devices(),
      lang: () => Settings.lang(), premium: () => Settings.premium(), stars: () => Settings.stars(), biz: () => Settings.biz(),
      gift: () => Settings.gift(), games: () => Games.open(), tips: () => Browser.external(TIPS_URL), ask: () => Settings.ask(), policy: () => Settings.policy(), out: () => Settings.logout(),
      addacc: () => Settings.addAccount(), acc: (el) => Settings.switchTo(+el.dataset.v), install: () => Settings.install(),
      accmgr: () => Settings.accMenu(), me: () => App.go("profile"),
    };
    box.onclick = (e) => {
      const el = e.target.closest("[data-a]"); if (!el || el.classList.contains("dis")) return;
      const f = go[el.dataset.a]; if (f) { haptic(); App.safe(el.dataset.a, () => f(el)); }
    };
  },

  // ─────────── установка как приложение ───────────
  // На Android — по умолчанию предлагаем установить APK (обычное приложение, не PWA): ссылка на base.apk
  // рядом с index.html. На iOS APK не работает — там остаётся «На экран «Домой»» через Safari.
  async downloadApk() {
    try {
      const r = await fetch("base.apk", { method: "HEAD" });
      if (!r.ok) return toast(T("Файл APK ещё не загружен"));
    } catch (e) { return toast(T("Файл APK ещё не загружен")); }
    const a = document.createElement("a");
    a.href = "base.apk"; a.download = "Dicegram.apk";
    document.body.appendChild(a); a.click(); a.remove();
  },

  // Внутри Telegram Mini App файлы вообще не скачиваются (платформа это блокирует) — поэтому
  // раньше мы открывали во внешнем браузере САЙТ (и там человек должен был нажать «Установить»
  // ещё раз, чтобы получить сам APK — лишний шаг и выглядело как «просто перекидывает на сайт»).
  // Теперь во внешнем браузере сразу открывается САМ base.apk, чтобы он скачался/поставился в один тап.
  async openApkExternal() {
    const apkUrl = new URL("base.apk", location.href).toString();
    try {
      const r = await fetch("base.apk", { method: "HEAD" });
      if (!r.ok) return toast(T("Файл APK ещё не загружен"));
    } catch (e) { return toast(T("Файл APK ещё не загружен")); }
    try { TGW.openLink(apkUrl, { try_instant_view: false }); }
    catch (e) { window.open(apkUrl, "_blank"); }
  },

  async install() {
    const ev = App.installEv;
    const inTg = !!(TGW && TGW.initData);
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const android = /Android/i.test(navigator.userAgent);
    if (inTg) {
      if (android) {
        const v = await UI.sheet({ title: T("Установить Dicegram"),
          text: T("Внутри Telegram скачивание файлов недоступно — откроем загрузку APK в вашем браузере. Если система предупредит о «неизвестном источнике» — это нормально для файлов не из Google Play."),
          actions: [{ label: T("Скачать APK"), value: "apk", accent: true }], cancel: T("Отмена") });
        if (v === "apk") await Settings.openApkExternal();
        return;
      }
      const v = await UI.sheet({ title: T("Установить Dicegram"),
        text: T("Мини-приложение нельзя установить. Откройте Dicegram в браузере по ссылке, а затем установите его."),
        actions: [{ label: T("Открыть в браузере"), value: "open", accent: true }], cancel: T("Закрыть") });
      if (v === "open") { try { TGW.openLink(location.origin + location.pathname, { try_instant_view: false }); } catch (e) { window.open(location.href, "_blank"); } }
      return;
    }
    if (ios) {
      await UI.sheet({ title: T("Установить Dicegram"), text: T("Нажмите «Поделиться» в Safari и выберите «На экран «Домой»»."), cancel: T("Понятно") });
      return;
    }
    if (android) {
      const acts = [{ label: T("Скачать APK"), value: "apk", accent: true }];
      if (ev) acts.push({ label: T("Установить как веб-приложение"), value: "pwa" });
      const v = await UI.sheet({ title: T("Установить Dicegram"),
        text: T("Скачайте APK-файл и установите его как обычное приложение. Если система предупредит о «неизвестном источнике» — это нормально для файлов не из Google Play."),
        actions: acts, cancel: T("Отмена") });
      if (v === "apk") Settings.downloadApk();
      else if (v === "pwa" && ev) { try { ev.prompt(); const r = await ev.userChoice; App.installEv = null; if (r && r.outcome === "accepted") toast(T("Dicegram установлен")); } catch (e) {} }
      return;
    }
    if (ev) {
      try { ev.prompt(); const r = await ev.userChoice; App.installEv = null; if (r && r.outcome === "accepted") toast(T("Dicegram установлен")); return; } catch (e) {}
    }
    const v = await UI.sheet({ title: T("Установить Dicegram"),
      text: T("Откройте меню браузера (три точки) и выберите «Установить приложение» или «Добавить на главный экран». На телефоне с Android можно скачать APK-файл."),
      actions: [{ label: T("Скачать APK для Android"), value: "apk" }], cancel: T("Понятно") });
    if (v === "apk") Settings.downloadApk();
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

  // «Управление» в карточке аккаунтов: добавить, убрать лишний с этого устройства, выйти из текущего
  async accMenu() {
    const others = Settings.others();
    const acts = [{ label: T("Добавить аккаунт"), value: "add", accent: true }]
      .concat(others.map((a, i) => ({ label: T("Убрать с устройства: {0}", a.name || T("Аккаунт")), value: "rm" + i, danger: true })))
      .concat([{ label: T("Выйти из текущего аккаунта"), value: "out", danger: true }]);
    const v = await UI.sheet({ title: T("Аккаунты"), text: T("Переключайтесь между аккаунтами одним нажатием: число рядом с аккаунтом — его непрочитанные сообщения."), actions: acts, cancel: T("Закрыть") });
    if (v === "add") Settings.addAccount();
    else if (v === "out") Settings.logout();
    else if (v && v.startsWith("rm")) Settings.removeAcc(+v.slice(2));
  },
  async removeAcc(i) {
    const a = Settings.others()[i]; if (!a) return;
    if (!(await ask(T("Убрать аккаунт «{0}» с этого устройства?", a.name || T("Аккаунт")), T("Убрать")))) return;
    try { await fetch(CONFIG.API + "/api/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + a.token, "Content-Type": "application/json" }, body: "{}" }); } catch (e) {}
    Accounts.remove(a.token); delete Settings.unread[a.token];
    Settings.render(); toast(T("Аккаунт убран"));
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
  // ── фон профиля (Premium): палитры с мягким светом и узором, превью — настоящая шапка профиля ──
  pbg() {
    const pg = Pg.open({ title: T("Фон профиля"), build: (p) => Settings.drawPbg(p) });
    pg.on.pick = async (el) => {
      const id = el.dataset.v || "";
      const u = App.user;
      if (id && !u.premium && !u.admin) { haptic(); return typeof PremiumPromo !== "undefined" ? PremiumPromo.open(u) : toast(T("Фоны профиля доступны с Premium")); }
      haptic();
      try {
        const d = await api("/api/me/pbg", { method: "POST", body: { id } });
        Object.assign(App.user, { pbg: d.user.pbg || "" });
        guard("profile", () => Profile.render());
        Settings.drawPbg(pg);
      } catch (e) { toast(e.message); }
    };
  },
  drawPbg(pg) {
    const u = App.user, cur = u.pbg || "";
    const ck = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
    const tiles = PBG.list.map((x) => `<button class="pbg-tile pf-hero prem pat-${x.pat}${x.light ? " pbg-light" : ""}${cur === x.id ? " on" : ""}" style="${PBG.style(x.p)}" data-a="pick" data-v="${x.id}">${PBG.orbs()}<b>${esc(T(x.n))}</b><i class="pbg-ck">${ck}</i></button>`).join("");
    const preview = Object.assign({}, u, { pbg: cur, premium: u.premium || u.admin ? 1 : u.premium });
    const ph = premHero(preview);
    pg.set(`
      <div class="pbg-prev"><div class="pf-hero${ph.cls}"${ph.style}>${ph.pat}<div class="pf-av">${Stories.av(u, "xl")}</div><h2>${profName(u)}</h2><div class="st2 on">${esc(T("в сети"))}</div></div></div>
      ${R.hint(esc(T(u.premium || u.admin ? "Выберите фон — его увидят все в вашем профиле. Надетый коллекционный подарок задаёт фон сам." : "Фоны профиля доступны с Premium.")))}
      <div class="pbg-grid"><button class="pbg-none${cur ? "" : " on"}" data-a="pick" data-v="">${esc(T("Без фона"))}</button>${tiles}</div>`);
  },

  async logout() {
    if (!(await ask(T("Выйти из этого аккаунта?"), T("Выйти")))) return;
    const tok = Store.token;
    try { await AppPush.logout(); } catch (e) {}           // этот телефон больше не получает уведомления аккаунта
    try { await api("/api/auth/logout", { method: "POST", body: {} }); } catch (e) {}
    try { await tmoC(OC.wipe(), 800); } catch (e) {}     // сохранённые чаты аккаунта стираем с устройства
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
      E("Голосовые сообщения", "Конфиденциальность", SI.mic, "gr", () => Settings.privKey("voice"), "голосовые аудио запись"),
      E("Сообщения", "Конфиденциальность", SI.chat, "gr", () => Settings.privMsg(), "кто может писать платные сообщения звёзды premium"),
      E("Подарки", "Конфиденциальность", SI.gift, "gr", () => Settings.privGifts(), "кто может дарить подарки типы"),
      E("Приглашения", "Конфиденциальность", SI.userPlus, "gr", () => Settings.privKey("invite"), "приглашать в группы и каналы"),
      E("Чёрный список", "Конфиденциальность", SI.shield, "gr", () => Settings.blocklist(), "заблокированные блок разблокировать"),
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
      E("Эмодзи-статус", NAME_PREMIUM, SI.smile, "y", () => StatusPicker.open(), "значок звезда статус emoji status анимированный"),
      E("Мои эмодзи", NAME_PREMIUM, SI.film, "p", () => EmojiSets.open(), "наборы стикеры свои эмодзи загрузить видео"),
      E(NAME_STARS, "", starFancy(), "star", () => Settings.stars(), "баланс пополнить"),
      E(NAME_BIZ, "", SI.bag, "v2", () => Settings.biz(), "адрес график быстрые ответы приветствие"),
      E("Отправить подарок", "", SI.gift, "p", () => Settings.gift()),
      E("Возможности Dicegram", "", SI.bulb, "y2", () => Browser.external(TIPS_URL), "советы подсказки tips возможности"),
      E("Задать вопрос", "", SI.headset, "b", () => Settings.ask(), "поддержка помощь"),
      E("Политика конфиденциальности", "", SI.doc, "gr", () => Settings.policy()),
      E("Выйти", "", SI.out, "r", () => Settings.logout(), "выход"),
    ];
  },

  search(on) {
    Settings.q = on ? " " : "";
    const box = $("settings-box");
    if (!on) { Settings.render(); return; }
    box._dxh = "";
    box.innerHTML = `<div class="dx-find s-find"><label class="s-q">${SI.search}<input id="s-q" placeholder="${esc(T("Поиск настроек"))}" autocomplete="off" autocapitalize="off" spellcheck="false"></label><button id="s-qx" class="s-cancel">${esc(T("Отмена"))}</button></div><div id="s-res"></div>`;
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
    res.onclick = (e) => { const b = e.target.closest("[data-i]"); if (b) App.safe("search", () => list[+b.dataset.i].f()); };
  },
};

// перерисовка вкладки при возврате на неё (счётчики аккаунтов, баланс)
document.addEventListener("click", (e) => {
  const t = e.target.closest && e.target.closest('.tab[data-tab="settings"]');
  if (t) { Settings.fetchUnread(true); }
});
