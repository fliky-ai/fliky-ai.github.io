// dicebot.js — «Dicebot»: окно создания и управления ботами (как BotFather, только прямо в приложении).
// Список ботов, создание с проверкой @username, токен, название/описание/«о боте», аватар, команды, кнопки меню,
// статистика, платежи Stars, безопасность (соуправляющие, передача, приватность, вебхук), включение/выключение, удаление, документация.
// Все запросы идут на /api/dicebot/* (сервер проверяет, что бот ваш или вы его соуправляющий).
const Dicebot = {
  bots: null, limit: 20, id: 0, cache: {},

  async load() {
    const d = await api("/api/dicebot/bots");
    Dicebot.bots = d.bots || []; Dicebot.limit = d.limit || 20; Dicebot.id = d.dicebot || 0;
    return d;
  },
  base() { return String(CONFIG.API || location.origin).replace(/\/+$/, ""); },
  peerOf(b) { return { id: b.id, name: b.name, surname: "", username: b.username, avatar: b.avatar || "", bot: 1, verified: b.verified ? 1 : 0, vtier: b.verified ? "blue" : "" }; },

  // перейти из окон настроек в чат с пользователем/ботом
  async toChat(peer) {
    try {
      await Nav.unwindWhile((t) => t.id && /^pg\d+$/.test(t.id));
      App.go("chats");
      let p = peer;
      try { if (typeof peer === "number") p = (await api("/api/user/" + peer)).user; } catch (e) {}
      const c = Chats.byId(p.id);
      Chat.open(c ? c.peer : p);
    } catch (e) { toast(e.message); }
  },
  async openDicebot() { if (!Dicebot.id) { try { await Dicebot.load(); } catch (e) {} } return Dicebot.toChat(Dicebot.id || "Dicebot"); },

  // ─────────── своё окно с полями (вместо системных prompt) ───────────
  // fields = [{k, label, value, ph, max, multi, mono, type}] → {k: value} или null. extra — кнопка слева (красная), её результат {_x: 1}
  form({ title, text = "", fields, ok = "Сохранить", extra = "" }) {
    return new Promise((res) => {
      const el = document.createElement("div");
      el.className = "sheet2";
      el.innerHTML = `<div class="s2-card dbf" role="dialog"><h3>${esc(T(title))}</h3>${text ? `<p>${esc(T(text))}</p>` : ""}
        ${fields.map((f, i) => `<label class="dbf-l">${f.label ? `<span>${esc(T(f.label))}</span>` : ""}${f.multi
          ? `<textarea class="s2-input dbi${f.mono ? " mono" : ""}" data-i="${i}" rows="${f.rows || 4}" maxlength="${f.max || 512}" placeholder="${esc(T(f.ph || ""))}" autocomplete="off" spellcheck="false">${esc(f.value || "")}</textarea>`
          : `<input class="s2-input dbi${f.mono ? " mono" : ""}" data-i="${i}" type="${f.type || "text"}" maxlength="${f.max || 64}" placeholder="${esc(T(f.ph || ""))}" value="${esc(f.value || "")}" autocomplete="off" autocapitalize="off" spellcheck="false">`}
          ${f.max && f.multi ? `<em class="dbf-c" data-c="${i}"></em>` : ""}<small class="dbf-h" data-h="${i}"></small></label>`).join("")}
        <div class="s2-row"><button data-a="no">${esc(T("Отмена"))}</button>${extra ? `<button data-a="x" class="danger">${esc(T(extra))}</button>` : ""}<button data-a="ok" class="accent">${esc(T(ok))}</button></div></div>`;
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add("show"));
      const ins = Array.from(el.querySelectorAll(".dbi"));
      const cnt = () => ins.forEach((n, i) => { const c = el.querySelector(`[data-c="${i}"]`); if (c) c.textContent = (fields[i].max - n.value.length); });
      ins.forEach((n) => n.addEventListener("input", cnt)); cnt();
      // подсказка/проверка под полем: f.check(value) → {t, cls} | null (асинхронная проверка допустима)
      let tm = 0, seq = 0;
      const doCheck = (i) => {
        const f = fields[i]; if (!f.check) return;
        const h = el.querySelector(`[data-h="${i}"]`), v = ins[i].value.trim(), my = ++seq;
        clearTimeout(tm);
        tm = setTimeout(async () => {
          let r = null; try { r = await f.check(v); } catch (e) {}
          if (my !== seq || !h) return;
          h.textContent = r ? r.t : ""; h.className = "dbf-h" + (r && r.cls ? " " + r.cls : "");
        }, 350);
      };
      ins.forEach((n, i) => n.addEventListener("input", () => doCheck(i)));
      setTimeout(() => { try { ins[0].focus(); if (ins[0].tagName === "INPUT") ins[0].select(); } catch (e) {} }, 220);
      const done = (v) => { el.classList.remove("show"); setTimeout(() => el.remove(), 200); res(v); };
      const vals = () => { const o = {}; fields.forEach((f, i) => { o[f.k] = ins[i].value.trim(); }); return o; };
      ins.forEach((n) => n.addEventListener("keydown", (e) => { if (e.key === "Enter" && n.tagName === "INPUT") done(vals()); }));
      el.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-a]");
        if (b) return done(b.dataset.a === "ok" ? vals() : b.dataset.a === "x" ? { _x: 1 } : null);
        if (e.target === el) done(null);
      });
    });
  },

  // выбор фото для аватара бота: своё окно предпросмотра с кадрированием (Cropper), системный выбор файла — только чтобы взять фото
  async pickPhoto(title) {
    const file = await Attach.pickPhoto(title);
    if (!file) return null;
    return Cropper.open(file, { title: T(title) });
  },

  // ─────────── главный экран ───────────
  open() {
    const pg = Pg.open({ title: "Dicebot", cls: "dbp", build: (pg) => Dicebot.home(pg) });
    Dicebot._home = pg.id;
    pg.on = {
      create: () => Dicebot.create(),
      bot: (_, el) => Dicebot.panel(+el.dataset.v),
      docs: () => Dicebot.docs(),
      chat: () => Dicebot.openDicebot(),
      cmds: () => Dicebot.cmdsHelp(),
    };
    return pg;
  },

  home(pg) {
    const draw = () => {
      const bots = Dicebot.bots, full = bots && bots.filter((b) => b.role === "owner").length >= Dicebot.limit;
      const list = bots === null
        ? `<div class="dbp-load"><i></i></div>`
        : bots.length
          ? R.card(...bots.map((b) => `<button class="irow" data-a="bot" data-v="${b.id}">${avatar(Dicebot.peerOf(b), "sm")}<span class="tx"><b>${esc(b.name)}${b.verified ? verBadge({ verified: 1, vtier: "blue" }) : ""}</b><small>@${esc(b.username)}${b.role === "admin" ? " · " + esc(T("соуправление")) : ""}${b.enabled ? "" : " · " + esc(T("выключен"))}</small></span>${SI.chev.replace("<svg ", '<svg class="irow-chev" ')}</button>`))
          : `<div class="dbp-empty"><div class="dbp-eic">${SI.bot}</div><h3>${esc(T("У вас пока нет ботов"))}</h3><p>${esc(T("Создайте первого бота: придумайте название и @username — токен выдадим сразу."))}</p></div>`;
      pg.set(`<div class="dbp-hero"><div class="dbp-logo">${DICE_I}</div><h2>Dicebot</h2><p>${esc(T("Создание ботов"))}</p></div>
        <div class="dbp-pad">${R.btn(`${SI.plus.replace("<svg ", '<svg width="20" height="20" ')} ${esc(T("Создать нового бота"))}`, "create", "dbp-new")}</div>
        ${bots && bots.length ? R.lbl(esc(T("Ваши боты")) + ` <span class="cnt">${bots.filter((b) => b.role === "owner").length}/${Dicebot.limit}</span>`) : ""}
        ${list}
        ${full ? R.hint(esc(T("Достигнут лимит ботов. Удалите ненужного бота, чтобы создать нового."))) : ""}
        ${R.lbl(esc(T("Ещё")))}
        ${R.card(
          R.row({ a: "docs", ic: SI.doc, c: "b", t: esc(T("Документация Bot API")), s: esc(T("Python, вебхуки, кнопки, платежи Stars")) }),
          R.row({ a: "cmds", ic: SI.zap, c: "o", t: esc(T("Команды Dicebot")), s: "/createbot /mybots /token /revoke …" }),
          R.row({ a: "chat", ic: SI.chat, c: "g", t: esc(T("Открыть чат с Dicebot")) }))}
        ${R.hint(esc(T("API совместим с Telegram Bot API: в готовом боте достаточно заменить адрес API на адрес Dicegram.")))}`);
    };
    draw();
    if (!pg._init) {
      pg._init = 1;
      Dicebot.load().then(() => pg.alive && draw()).catch((e) => { if (Dicebot.bots === null) Dicebot.bots = []; toast(e.message); pg.alive && draw(); });
    } else Dicebot.load().then(() => pg.alive && draw()).catch(() => {});
  },

  cmdsHelp() {
    UI.sheet({ title: T("Команды Dicebot"), icon: SI.bot, cancel: T("Понятно"), actions: [],
      text: ["/start — главное меню", "/miniapp — эта панель", "/createbot — создать бота", "/mybots — ваши боты", "/setname — название",
        "/setabouttext — «О боте»", "/setuserpic — аватар", "/token — токен", "/revoke — заменить токен", "/deletebot — удалить бота", "/documention — документация"].map((x) => T(x)).join("\n") });
  },

  // ─────────── создание бота ───────────
  create() {
    const pg = Pg.open({ title: T("Новый бот"), cls: "dbp", build: (pg) => {
      pg.set(`${R.hero(SI.bot, esc(T("Новый бот")), esc(T("Название увидят люди в чатах. Username — адрес бота: @my_helper_bot.")))}
        ${R.lbl(esc(T("Название")))}
        <div class="card2 fields"><input id="dbc-name" maxlength="64" placeholder="${esc(T("Например: Помощник"))}" autocomplete="off"></div>
        ${R.lbl(esc(T("Username")))}
        <div class="card2 fields dbc-un"><span class="at">@</span><input id="dbc-un" maxlength="32" placeholder="my_helper_bot" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
        <div class="ed-hint" id="dbc-h">${esc(T("От 5 до 32 символов: a–z, 0–9 и _. Должен заканчиваться на «bot»."))}</div>
        <div class="dbp-pad dbp-top">${R.btn(esc(T("Создать бота")), "go")}</div>`);
      const nm = pg.$("#dbc-name"), un = pg.$("#dbc-un"), h = pg.$("#dbc-h"), go = pg.$(".pbtn");
      pg.ok = false; go.disabled = true;
      const sync = () => { go.disabled = !(pg.ok && nm.value.trim()); };
      let tm = 0, seq = 0;
      const rules = T("От 5 до 32 символов: a–z, 0–9 и _. Должен заканчиваться на «bot».");
      const check = () => {
        const v = un.value.trim().replace(/^@/, ""), my = ++seq; clearTimeout(tm); pg.ok = false; sync();
        if (!v) { h.textContent = rules; h.className = "ed-hint"; return; }
        if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(v) || v.includes("__")) { h.textContent = /^\d/.test(v) ? T("Username не может начинаться с цифры") : rules; h.className = "ed-hint bad"; return; }
        if (!/bot$/i.test(v)) { h.textContent = T("Username бота должен заканчиваться на «bot», например my_helper_bot."); h.className = "ed-hint bad"; return; }
        h.textContent = T("Проверяем…"); h.className = "ed-hint";
        tm = setTimeout(async () => {
          try {
            const d = await api("/api/dicebot/username?u=" + encodeURIComponent(v));
            if (my !== seq) return;
            pg.ok = !!d.free; h.textContent = d.free ? "✓ " + T("Username свободен") : d.error; h.className = "ed-hint " + (d.free ? "ok" : "bad"); sync();
          } catch (e) {}
        }, 380);
      };
      un.addEventListener("input", check); nm.addEventListener("input", sync);
    } });
    pg.on = {
      go: async () => {
        const nm = pg.$("#dbc-name").value.trim(), un = pg.$("#dbc-un").value.trim().replace(/^@/, ""), b = pg.$(".pbtn");
        b.disabled = true;
        try {
          const d = await api("/api/dicebot/create", { method: "POST", body: { name: nm, username: un } });
          Dicebot.cache[d.bot.id] = d.bot; Dicebot.bots = null;
          haptic("medium");
          Nav.back();
          setTimeout(() => Dicebot.created(d.bot, d.token), 340);
        } catch (e) { toast(e.message); b.disabled = false; }
      },
    };
  },

  // экран «Бот создан»: токен показываем сразу
  created(bot, token) {
    const api_ = Dicebot.base() + "/bot" + token + "/";
    const pg = Pg.open({ title: T("Бот создан"), cls: "dbp", build: (pg) => {
      pg.set(`<div class="dbp-hero ok"><div class="dbp-logo ok">${SI.check}</div><h2>${esc(bot.name)}</h2><p>@${esc(bot.username)}</p></div>
        ${R.lbl(esc(T("API-токен")))}
        <div class="card2 dbp-tok"><code id="dbt">${esc(token)}</code></div>
        <div class="dbp-pad">${R.btn(esc(T("Скопировать токен")), "copy")}</div>
        ${R.hint(esc(T("Токен — это пароль бота. Никому его не показывайте. Если он утёк, замените его в панели бота: старый перестанет работать сразу.")))}
        ${R.lbl(esc(T("Адрес API")))}
        <div class="card2 dbp-tok"><code>${esc(api_)}</code></div>
        ${R.card(
          R.row({ a: "panel", ic: SI.edit, c: "b", t: esc(T("Настроить бота")), s: esc(T("аватар, описание, команды, кнопки")) }),
          R.row({ a: "docs", ic: SI.doc, c: "g", t: esc(T("Документация")), s: esc(T("пример бота на Python")) }),
          R.row({ a: "chat", ic: SI.chat, c: "o", t: esc(T("Открыть чат с ботом")) }))}`);
    } });
    pg.on = {
      copy: async () => { await copyText(token); haptic(); toast(T("Токен скопирован")); },
      panel: () => { Nav.back(); setTimeout(() => Dicebot.panel(bot.id), 340); },
      docs: () => Dicebot.docs(),
      chat: () => Dicebot.toChat(Dicebot.peerOf(bot)),
    };
  },

  // ─────────── панель бота ───────────
  async fetchBot(id) {
    const d = await api("/api/dicebot/bot/" + id);
    Dicebot.cache[id] = d.bot; return d.bot;
  },
  async act(id, path, body) {
    const d = await api("/api/dicebot/bot/" + id + "/" + path, { method: "POST", body: body || {} });
    if (d.bot) Dicebot.cache[id] = d.bot;
    Dicebot.bots = null;
    return d;
  },

  panel(id) {
    const pg = Pg.open({ title: T("Бот"), cls: "dbp", data: { id }, build: (pg) => Dicebot.drawPanel(pg) });
    const B = () => Dicebot.cache[id];
    const edit = async (k, label, max, multi) => {
      const b = B(); if (!b) return;
      const r = await Dicebot.form({ title: label, fields: [{ k: "v", value: k === "name" ? b.name : b[k] || "", max, multi, rows: 4, ph: label }] });
      if (!r) return;
      try { await Dicebot.act(id, "update", { [k]: r.v }); pg.refresh(); toast(T("Сохранено")); } catch (e) { toast(e.message); }
    };
    pg.on = {
      name: () => edit("name", "Название бота", 64, false),
      about: () => edit("about", "О боте", 200, true),
      id: () => { const b = B(); copyText(String((b && b.pubid) || id)); toast(T("ID скопирован")); },
      apiid: () => { copyText(String(id)); toast(T("ID скопирован")); },
      uname: () => { copyText("@" + (B() || {}).username); toast(T("Username скопирован")); },
      avatar: () => Dicebot.avatar(pg),
      token: () => Dicebot.tokenPage(id),
      cmds: () => Dicebot.cmdsPage(id),
      menu: () => Dicebot.menuPage(id),
      stats: () => Dicebot.statsPage(id),
      pays: () => Dicebot.paysPage(id),
      sec: () => Dicebot.secPage(id),
      chat: () => B() && Dicebot.toChat(Dicebot.peerOf(B())),
      docs: () => Dicebot.docs(),
      off: async (on, el) => {                         // переключатель «Бот включён»
        try { await Dicebot.act(id, "update", { enabled: !!on }); pg.refresh(); toast(on ? T("Бот включён") : T("Бот выключен")); }
        catch (e) { toast(e.message); pg.refresh(); }
      },
      del: async () => {
        const b = B(); if (!b) return;
        const v = await UI.sheet({ title: T("Удалить бота?"), text: T("Бот @{0} будет удалён вместе с токеном и перепиской. Это нельзя отменить.", b.username), actions: [{ label: T("Удалить"), value: "y", danger: true }] });
        if (v !== "y") return;
        try { await Dicebot.act(id, "delete"); haptic("medium"); toast(T("Бот удалён")); Nav.back(); } catch (e) { toast(e.message); }
      },
    };
    return pg;
  },

  drawPanel(pg) {
    const id = pg.data.id, b = Dicebot.cache[id];
    if (!b) {
      pg.set(`<div class="dbp-load"><i></i></div>`);
      if (!pg._f) { pg._f = 1; Dicebot.fetchBot(id).then(() => pg.alive && pg.refresh()).catch((e) => { toast(e.message); pg.close(); }); }
      return;
    }
    const own = b.role === "owner", s = b.stats || {};
    pg.title(b.name || T("Бот"));
    const short = (t) => esc(String(t || "").replace(/\s+/g, " ").slice(0, 40)) || `<span class="dim">${esc(T("не задано"))}</span>`;
    pg.set(`<div class="dbp-hero bot"><button class="dbp-av" data-a="avatar" aria-label="${esc(T("Аватар"))}">${avatar(Dicebot.peerOf(b), "xl")}<i>${SI.image}</i></button>
        <h2>${esc(b.name)}${b.verified ? verBadge({ verified: 1, vtier: "blue" }) : ""}</h2>
        <p>@${esc(b.username)} · ${b.enabled ? esc(T("работает")) : esc(T("выключен"))}${own ? "" : " · " + esc(T("вы соуправляющий"))}</p></div>
      <div class="dbp-pad">${R.btn(esc(T("Открыть чат с ботом")), "chat")}</div>
      ${R.lbl(esc(T("Информация")))}
      ${R.card(
        R.row({ a: "name", ic: SI.edit, c: "b", t: esc(T("Название")), s: esc(b.name) }),
        R.row({ a: "about", ic: SI.info, c: "t", t: esc(T("О боте")), s: short(b.about) }),
        R.row({ a: "uname", ic: SI.link, c: "v", t: "Username", s: "@" + esc(b.username) }),
        R.row({ a: "id", ic: SI.user, c: "gr", t: "ID", s: String(b.pubid || b.id) }),
        R.row({ a: "apiid", ic: SI.key, c: "gr", t: esc(T("ID в Bot API")), s: String(b.id) }))}
      ${R.lbl(esc(T("Управление")))}
      ${R.card(
        R.row({ a: own ? "token" : "", ic: SI.key, c: "y", t: esc(T("API-токен")), s: own ? esc(T("получить, скопировать, заменить")) : esc(T("виден только владельцу")), dis: !own, noch: !own }),
        R.row({ a: "avatar", ic: SI.image, c: "p", t: esc(T("Аватар")), s: esc(b.avatar ? T("изменить или удалить") : T("загрузить фото")) }),
        R.row({ a: "cmds", ic: SI.zap, c: "o", t: esc(T("Команды")), r: String((b.cmds || []).length), s: esc(T("список с автодополнением")) }),
        R.row({ a: "menu", ic: SI.menu, c: "v2", t: esc(T("Кнопки")), r: String(((b.menu_kb || []).reduce((n, r) => n + r.length, 0)) || ""), s: esc(T("клавиатура меню в чате с ботом")) }))}
      ${R.card(
        R.row({ a: "stats", ic: SI.stats, c: "g", t: esc(T("Статистика")), s: esc(T("{0} польз., {1} сообщ.", s.users || 0, (s.msgs_in || 0) + (s.msgs_out || 0))) }),
        R.row({ a: "pays", ic: SI.starF, c: "y", t: esc(T("Платежи Stars")), r: s.stars ? "★ " + s.stars : "" }),
        R.row({ a: "sec", ic: SI.shield, c: "r", t: esc(T("Безопасность")), s: esc(T("доступ, передача, вебхук")) }))}
      ${R.card(
        R.row({ a: "off", ic: SI.bolt, c: "o2", t: esc(T("Бот включён")), s: esc(T("Выключенный бот не получает и не отправляет сообщения")), sw: 1, on: b.enabled }),
        R.row({ a: "docs", ic: SI.doc, c: "b", t: esc(T("Документация Bot API")) }))}
      ${own ? R.card(R.row({ a: "del", ic: SI.trash, c: "r", t: esc(T("Удалить бота")), danger: 1, chev: false })) : ""}
      <div class="dbp-foot">${esc(T("Создан {0}", fmtDay(b.created)))}</div>`);
  },

  async avatar(pg) {
    const id = pg.data.id, b = Dicebot.cache[id]; if (!b) return;
    const v = await UI.sheet({ title: T("Аватар бота"), actions: [{ label: T("Выбрать фото"), value: "set", accent: true }].concat(b.avatar ? [{ label: T("Удалить аватар"), value: "del", danger: true }] : []) });
    if (!v) return;
    try {
      if (v === "del") await Dicebot.act(id, "avatar", { data: "" });
      else {
        const data = await Dicebot.pickPhoto("Аватар бота"); if (!data) return;
        await Dicebot.act(id, "avatar", { data });
      }
      pg.refresh(); toast(T("Аватар обновлён"));
    } catch (e) { toast(e.message); }
  },

  // ─────────── токен ───────────
  tokenPage(id) {
    const pg = Pg.open({ title: T("API-токен"), cls: "dbp", build: (pg) => {
      const b = Dicebot.cache[id] || {}, tok = b.token || "", shown = !!pg.shown;
      const masked = tok ? tok.replace(/^(\d+:)(.{4}).*(.{4})$/, "$1$2••••••••••••••••$3") : "";
      pg.set(`${R.hero(SI.key, esc(T("API-токен")), esc(T("С этим токеном программа управляет ботом @{0}. Храните его как пароль.", b.username || "")))}
        <div class="card2 dbp-tok"><code>${esc(shown ? tok : masked)}</code></div>
        ${R.card(
          R.row({ a: "show", ic: SI.eye, c: "b", t: esc(shown ? T("Скрыть токен") : T("Показать токен")), chev: false }),
          R.row({ a: "copy", ic: SI.doc, c: "g", t: esc(T("Скопировать токен")), chev: false }),
          R.row({ a: "copyurl", ic: SI.link, c: "v", t: esc(T("Скопировать адрес API")), s: esc(Dicebot.base() + "/bot…/"), chev: false }))}
        ${R.card(R.row({ a: "revoke", ic: SI.reload, c: "r", t: esc(T("Заменить токен")), s: esc(T("старый перестанет работать сразу")), danger: 1 }))}
        ${R.hint(esc(T("Не публикуйте токен в открытом коде. Если он попал в чужие руки — замените его.")))}`);
    } });
    pg.on = {
      show: () => { pg.shown = !pg.shown; pg.refresh(); },
      copy: async () => { await copyText((Dicebot.cache[id] || {}).token || ""); haptic(); toast(T("Токен скопирован")); },
      copyurl: async () => { await copyText(Dicebot.base() + "/bot" + ((Dicebot.cache[id] || {}).token || "") + "/"); haptic(); toast(T("Адрес скопирован")); },
      revoke: async () => {
        const v = await UI.sheet({ title: T("Заменить токен?"), text: T("Новый токен заработает сразу, старый перестанет. Бота нужно будет перезапустить с новым токеном."), actions: [{ label: T("Заменить"), value: "y", danger: true }] });
        if (v !== "y") return;
        try { const d = await api("/api/dicebot/bot/" + id + "/revoke", { method: "POST", body: {} }); (Dicebot.cache[id] || {}).token = d.token; pg.shown = true; pg.refresh(); haptic("medium"); toast(T("Токен заменён")); }
        catch (e) { toast(e.message); }
      },
    };
  },

  // ─────────── команды ───────────
  cmdsPage(id) {
    const pg = Pg.open({ title: T("Команды"), cls: "dbp", build: (pg) => {
      const b = Dicebot.cache[id] || {}, cm = b.cmds || [];
      pg.set(`${R.hero(SI.zap, esc(T("Команды бота")), esc(T("Когда человек вводит «/», в чате показывается этот список с автодополнением.")))}
        ${cm.length ? R.card(...cm.map((c, i) => R.row({ a: "edit", v: i, ic: SI.zap, c: "o", t: "/" + esc(c.command), s: esc(c.description) }))) : ""}
        ${R.card(R.row({ a: "add", ic: SI.plus, c: "b plus", t: esc(T("Добавить команду")), chev: false }))}
        ${R.hint(esc(T("Название — a–z, 0–9 и _, до 32 символов. Описание — от 3 до 256 символов.")))}`);
    } });
    const save = async (list) => { try { await Dicebot.act(id, "update", { cmds: list }); pg.refresh(); return true; } catch (e) { toast(e.message); return false; } };
    const form = (c, edit) => Dicebot.form({ title: edit ? "Команда" : "Новая команда", ok: "Сохранить", extra: edit ? "Удалить" : "",
      fields: [{ k: "command", label: "Команда", value: c ? c.command : "", ph: "start", max: 32, mono: true }, { k: "description", label: "Описание", value: c ? c.description : "", ph: "Что делает команда", max: 256 }] });
    pg.on = {
      add: async () => {
        const r = await form(null, false); if (!r) return;
        const list = ((Dicebot.cache[id] || {}).cmds || []).concat([{ command: r.command.replace(/^\//, ""), description: r.description }]);
        save(list);
      },
      edit: async (_, el) => {
        const i = +el.dataset.v, cur = (Dicebot.cache[id] || {}).cmds || [], r = await form(cur[i], true); if (!r) return;
        const list = cur.slice();
        if (r._x) list.splice(i, 1); else list[i] = { command: r.command.replace(/^\//, ""), description: r.description };
        save(list);
      },
    };
  },

  // ─────────── кнопки меню (клавиатура в чате с ботом) ───────────
  menuPage(id) {
    const pg = Pg.open({ title: T("Кнопки"), cls: "dbp", build: (pg) => {
      const rows = ((Dicebot.cache[id] || {}).menu_kb || []);
      pg.set(`${R.hero(SI.menu, esc(T("Кнопки меню")), esc(T("Эти кнопки показываются внизу чата с ботом, пока бот не прислал свою клавиатуру. Нажатие отправляет текст кнопки боту.")))}
        <div class="card2 dbk">${rows.length ? rows.map((r, ri) => `<div class="dbk-r">${r.map((t, ci) => `<button class="dbk-b" data-a="btn" data-v="${ri}:${ci}">${esc(t)}</button>`).join("")}${r.length < 6 ? `<button class="dbk-b add" data-a="addin" data-v="${ri}" aria-label="${esc(T("Добавить кнопку"))}">+</button>` : ""}</div>`).join("")
          : `<div class="dbk-e">${esc(T("Кнопок пока нет"))}</div>`}</div>
        ${R.card(R.row({ a: "addrow", ic: SI.plus, c: "b plus", t: esc(T(rows.length ? "Новый ряд кнопок" : "Добавить кнопку")), chev: false }),
          rows.length ? R.row({ a: "clear", ic: SI.trash, c: "r", t: esc(T("Убрать все кнопки")), danger: 1, chev: false }) : "")}
        ${R.hint(esc(T("До 10 рядов, до 6 кнопок в ряду. Нажмите на кнопку, чтобы изменить или удалить её.")))}`);
    } });
    const rowsOf = () => ((Dicebot.cache[id] || {}).menu_kb || []).map((r) => r.slice());
    const save = async (rows) => { try { await Dicebot.act(id, "update", { menu_kb: rows }); pg.refresh(); } catch (e) { toast(e.message); } };
    const ask = (v, extra) => Dicebot.form({ title: "Кнопка", ok: "Сохранить", extra, fields: [{ k: "t", label: "Текст кнопки", value: v || "", ph: "Меню", max: 64 }] });
    pg.on = {
      addrow: async () => {
        const rows = rowsOf(); if (rows.length >= 10) return toast(T("Не больше 10 рядов"));
        const r = await ask(""); if (!r || !r.t) return; rows.push([r.t]); save(rows);
      },
      addin: async (_, el) => {
        const rows = rowsOf(), ri = +el.dataset.v, r = await ask(""); if (!r || !r.t) return;
        rows[ri].push(r.t); save(rows);
      },
      btn: async (_, el) => {
        const [ri, ci] = el.dataset.v.split(":").map(Number), rows = rowsOf(), r = await ask(rows[ri][ci], "Удалить"); if (!r) return;
        if (r._x) { rows[ri].splice(ci, 1); if (!rows[ri].length) rows.splice(ri, 1); } else if (r.t) rows[ri][ci] = r.t;
        save(rows);
      },
      clear: async () => { const v = await UI.sheet({ title: T("Убрать все кнопки?"), actions: [{ label: T("Убрать"), value: "y", danger: true }] }); if (v === "y") save([]); },
    };
  },

  // ─────────── статистика ───────────
  statsPage(id) {
    const pg = Pg.open({ title: T("Статистика"), cls: "dbp", build: (pg) => {
      const b = Dicebot.cache[id] || {}, s = b.stats || {};
      const cell = (n, l) => `<div><b>${esc(String(n || 0))}</b><small>${esc(T(l))}</small></div>`;
      pg.set(`${R.hero(SI.stats, esc(T("Статистика")), "@" + esc(b.username || ""))}
        ${R.lbl(esc(T("Пользователи")))}
        <div class="card2 dbs">${cell(s.users, "всего")}${cell(s.d1, "за 24 часа")}${cell(s.d7, "за 7 дней")}${cell(s.d30, "за 30 дней")}${cell(s.new7, "новых за 7 дней")}${cell(s.blocked, "заблокировали")}</div>
        ${R.lbl(esc(T("Сообщения")))}
        <div class="card2 dbs">${cell(s.msgs_in, "получено")}${cell(s.msgs_out, "отправлено")}</div>
        ${R.lbl(esc(T("Платежи")))}
        <div class="card2 dbs">${cell(s.pays, "платежей")}${cell(s.stars ? "★ " + s.stars : 0, "Stars получено")}</div>
        ${R.hint(esc(T("Считаются только люди, которые писали боту.")))}`);
    } });
    pg.on = {};
    Dicebot.fetchBot(id).then(() => pg.alive && pg.refresh()).catch(() => {});
  },

  // ─────────── платежи Stars ───────────
  paysPage(id) {
    const pg = Pg.open({ title: T("Платежи Stars"), cls: "dbp", build: (pg) => {
      const b = Dicebot.cache[id] || {}, ps = b.pays || [], own = b.role === "owner", s = b.stats || {};
      const st = { paid: T("оплачен"), refunded: T("возвращён"), pending: T("ожидает"), failed: T("не прошёл") };
      pg.set(`${R.hero(SI.starF, esc(T("Платежи Stars")), esc(T("Бот выставляет счёт методом sendInvoice (валюта XTR). Звёзды зачисляются владельцу бота.")))}
        <div class="card2 dbs">${`<div><b>★ ${esc(String(s.stars || 0))}</b><small>${esc(T("получено"))}</small></div><div><b>${esc(String(s.pays || 0))}</b><small>${esc(T("платежей"))}</small></div>`}</div>
        ${ps.length ? R.lbl(esc(T("Последние платежи"))) + R.card(...ps.map((p) => R.row({ a: own && p.status === "paid" ? "pay" : "", v: p.id, ic: SI.starF, c: p.status === "refunded" ? "gr" : "y", t: esc(p.title || T("Платёж")) + " · ★ " + p.amount,
            s: esc(dispName(p.who) + " · " + (st[p.status] || p.status) + " · " + fmtDay(p.ts)), noch: 1 }))) + (own ? R.hint(esc(T("Нажмите на оплаченный платёж, чтобы вернуть звёзды."))) : "")
          : `<div class="dbp-empty"><div class="dbp-eic">${SI.starF}</div><h3>${esc(T("Платежей пока нет"))}</h3></div>`}`);
    } });
    pg.on = {
      pay: async (_, el) => {
        const v = await UI.sheet({ title: T("Вернуть звёзды?"), text: T("Звёзды вернутся покупателю, платёж будет отмечен как возвращённый."), actions: [{ label: T("Вернуть"), value: "y", danger: true }] });
        if (v !== "y") return;
        try { await Dicebot.act(id, "refund", { id: +el.dataset.v }); await Dicebot.fetchBot(id); pg.refresh(); toast(T("Звёзды возвращены")); } catch (e) { toast(e.message); }
      },
    };
    Dicebot.fetchBot(id).then(() => pg.alive && pg.refresh()).catch(() => {});
  },

  // ─────────── безопасность ───────────
  secPage(id) {
    const pg = Pg.open({ title: T("Безопасность"), cls: "dbp", build: (pg) => {
      const b = Dicebot.cache[id] || {}, own = b.role === "owner", ad = b.admins || [], hk = b.hook || {};
      pg.set(`${R.hero(SI.shield, esc(T("Безопасность")), esc(T("Токены уникальны и хранятся в зашифрованном виде. Бот не видит чужие переписки: только чаты, где к нему обратились.")))}
        ${R.lbl(esc(T("Доступ бота")))}
        ${R.card(
          R.row({ a: "groups", ic: SI.userPlus, c: "b", t: esc(T("Можно добавлять в группы")), s: esc(T("Если выключено, бота нельзя пригласить в группу")), sw: 1, on: b.groups_ok }),
          R.row({ a: "priv", ic: SI.eye, c: "v", t: esc(T("Режим приватности в группах")), s: esc(T("Включено: бот видит только команды и ответы ему. Выключено: все сообщения группы")), sw: 1, on: b.privacy }))}
        ${R.lbl(esc(T("Соуправляющие")) + ` <span class="cnt">${ad.length}/5</span>`)}
        ${R.card(...ad.map((a) => `<div class="irow">${avatar(a, "sm")}<span class="tx"><b>${esc(dispName(a))}</b><small>@${esc(a.username || "")}</small></span>${own ? `<button class="lnk" data-a="rm" data-v="${a.id}">${esc(T("Убрать"))}</button>` : ""}</div>`),
          own ? R.row({ a: "addad", ic: SI.userPlus, c: "b plus", t: esc(T("Добавить соуправляющего")), chev: false }) : "")}
        ${R.hint(esc(T("Соуправляющий меняет настройки бота, но не видит токен и не может удалить или передать бота.")))}
        ${own ? R.card(R.row({ a: "xfer", ic: SI.fwd, c: "o", t: esc(T("Передать бота")), s: esc(T("новому владельцу выдаётся новый токен")) })) : ""}
        ${R.lbl(esc(T("Вебхук")))}
        ${R.card(hk.url ? R.row({ a: "hookdel", ic: SI.link, c: "g", t: esc(String(hk.url).replace(/^https?:\/\//, "").slice(0, 36)), s: esc(hk.err ? T("Ошибка: {0}", hk.err) : T("Доставка работает") + (hk.pending ? " · " + T("в очереди {0}", hk.pending) : "")), r: esc(T("Отключить")), chev: false })
          : R.row({ ic: SI.link, c: "gr", t: esc(T("Вебхук не задан")), s: esc(T("Бот получает сообщения через getUpdates (long polling)")), chev: false, noch: 1 }))}
        ${R.lbl(esc(T("Защита")))}
        <div class="dbp-note">${["Уникальный токен у каждого бота, можно заменить в любой момент", "Ограничения частоты запросов и защита от спама", "Лимит ботов на одного человека", "Бот не может написать человеку первым", "Бот не имеет доступа к чужим перепискам"].map((t) => `<div>${SI.check}<span>${esc(T(t))}</span></div>`).join("")}</div>`);
    } });
    const upd = async (k, v) => { try { await Dicebot.act(id, "update", { [k]: v }); } catch (e) { toast(e.message); } pg.refresh(); };
    pg.on = {
      groups: (on) => upd("groups_ok", !!on), priv: (on) => upd("privacy", !!on),
      addad: async () => {
        const r = await Dicebot.form({ title: "Добавить соуправляющего", text: "Укажите @username человека. Ему придёт уведомление.", fields: [{ k: "u", ph: "@username", max: 33 }], ok: "Добавить" });
        if (!r || !r.u) return;
        try { await Dicebot.act(id, "admins", { add: r.u }); pg.refresh(); toast(T("Добавлен")); } catch (e) { toast(e.message); }
      },
      rm: async (_, el) => { try { await Dicebot.act(id, "admins", { remove: +el.dataset.v }); pg.refresh(); } catch (e) { toast(e.message); } },
      xfer: async () => {
        const b = Dicebot.cache[id] || {};
        const r = await Dicebot.form({ title: "Передать бота", text: T("Бот @{0} перейдёт новому владельцу. Вы потеряете управление, токен будет заменён.", b.username), fields: [{ k: "u", ph: "@username", max: 33 }], ok: "Передать" });
        if (!r || !r.u) return;
        const v = await UI.sheet({ title: T("Передать бота?"), text: T("Отменить передачу нельзя."), actions: [{ label: T("Передать"), value: "y", danger: true }] });
        if (v !== "y") return;
        try { await Dicebot.act(id, "transfer", { to: r.u }); haptic("medium"); toast(T("Бот передан")); await Nav.unwindWhile((t) => t.id && /^pg\d+$/.test(t.id) && t.id !== Dicebot._home); } catch (e) { toast(e.message); }
      },
      hookdel: async () => {
        const v = await UI.sheet({ title: T("Отключить вебхук?"), text: T("Сообщения снова будут приходить через getUpdates."), actions: [{ label: T("Отключить"), value: "y" }, { label: T("Отключить и очистить очередь"), value: "d", danger: true }] });
        if (!v) return;
        try { await Dicebot.act(id, "hook/delete", { drop: v === "d" }); pg.refresh(); } catch (e) { toast(e.message); }
      },
    };
    Dicebot.fetchBot(id).then(() => pg.alive && pg.refresh()).catch(() => {});
  },

  // ─────────── документация ───────────
  // мини-разметка: ```код```, `код`, **жирный**
  md(s) {
    const out = []; const parts = String(s || "").split(/```/);
    parts.forEach((p, i) => {
      if (i % 2) { out.push(`<div class="dbd-code"><button class="dbd-cp" data-a="cp" aria-label="${esc(T("Копировать"))}">${SI.doc}</button><pre>${esc(p.replace(/^\n+|\n+$/g, ""))}</pre></div>`); return; }
      out.push(esc(p).replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>").replace(/(<br>){3,}/g, "<br><br>"));
    });
    return out.join("");
  },
  docs() {
    const pg = Pg.open({ title: T("Документация"), cls: "dbp", build: (pg) => {
      const sec = Dicebot._docs;
      if (!sec) { pg.set(`<div class="dbp-load"><i></i></div>`); return; }
      pg.set(`${R.hero(SI.doc, esc(T("Bot API Dicegram")), esc(T("Совместим с Telegram Bot API: те же методы и поля, меняется только адрес.")))}
        ${R.card(...sec.map((x) => R.row({ a: "sec", v: x.id, ic: SI.doc, c: "b", t: esc(x.title) })))}
        <div class="dbp-pad"><div class="dbp-addr"><small>${esc(T("Адрес API"))}</small><code>${esc(Dicebot.base())}/bot&lt;ТОКЕН&gt;/&lt;метод&gt;</code></div></div>`);
    } });
    pg.on = {
      sec: (_, el) => {
        const x = (Dicebot._docs || []).find((s) => s.id === el.dataset.v); if (!x) return;
        const base = Dicebot.base(), p2 = Pg.open({ title: x.title, cls: "dbp dbd", build: (p) => p.set(`<div class="dbd-body">${Dicebot.md(x.body.replace(/\{API\}/g, base))}</div>`) });
        p2.on = { cp: async (_, b) => { const pre = b.parentNode.querySelector("pre"); await copyText(pre ? pre.textContent : ""); haptic(); toast(T("Скопировано")); } };
      },
    };
    if (!Dicebot._docs) api("/api/dicebot/docs").then((d) => { Dicebot._docs = d.sections || []; pg.alive && pg.refresh(); }).catch((e) => { toast(e.message); pg.close(); });
  },
};
