// set_safe.js — «Конфиденциальность»: кто что видит, облачный пароль, код-пароль (блокировка), автоудаление, почта, устройства.

const PRIV_ROWS = [
  { k: "phone", ic: SI.call, c: "g", t: "Номер телефона", h: "Кто видит мой номер телефона",
    n: "Если номер скрыт, он не показывается в вашем профиле. Найти вас можно будет по имени или @username." },
  { k: "seen", ic: SI.eye, c: "b", t: "Время захода", h: "Кто видит, когда я был(а) в сети",
    n: "Если время захода скрыто, другие увидят только «был(а) недавно» и не узнают, что вы сейчас в сети." },
  { k: "photo", ic: SI.user, c: "o", t: "Фотография профиля", h: "Кто видит мою фотографию",
    n: "Тем, кому фото скрыто, вместо него показывается стандартный значок." },
  { k: "fwd", ic: SI.fwd, c: "v", t: "Пересылка сообщений", h: "Кто может добавлять ссылку на мой аккаунт при пересылке моих сообщений",
    n: "Если выбрано «Никто», при пересылке ваших сообщений будет показываться только имя — без ссылки на ваш профиль." },
  { k: "calls", ic: SI.call, c: "t", t: "Звонки", h: "Кто может мне звонить",
    n: "Звонки в приложении пока не поддерживаются — выбранная настройка сохранится и заработает, когда они появятся." },
  { k: "bio", ic: SI.info, c: "p", t: "О себе", h: "Кто видит раздел «О себе»", n: "Остальным этот раздел в вашем профиле не показывается." },
  { k: "voice", ic: SI.mic, c: "r", t: "Голосовые сообщения", h: "Кто может отправлять мне голосовые сообщения", grp: "who",
    n: "Тем, кому голосовые запрещены, приложение подскажет написать текстом." },
  { k: "invite", ic: SI.userPlus, c: "t", t: "Приглашения", h: "Кто может приглашать меня в группы и каналы", grp: "who",
    n: "Если вас не могут добавить, человек получит сообщение об этом — а вы всё равно сможете вступить по ссылке-приглашению." },
  { k: "birthday", ic: SI.gift, c: "r", t: "День рождения", h: "Кто видит мой день рождения", n: "Если дата скрыта, в вашем профиле она не отображается." },
];
const PRIV_DEF = { phone: "contacts", seen: "all", photo: "all", fwd: "all", calls: "all", bio: "all", birthday: "contacts", voice: "all", msg: "all", gifts: "all", invite: "all" };
const GIFT_TYPE_ROWS = [["regular", "Обычные", "Подарки из магазина"], ["rare", "Редкие", "Ограниченные выпуски"], ["unique", "Уникальные", "NFT-подарки с номером"],
  ["channels", "От каналов", "Подарки, отправленные от имени канала"], ["premium", "Dicegram Premium", "Подписка в подарок"]];
const VIS_T = { all: "Все", contacts: "Мои контакты", none: "Никто" };
const privVal = (u, k) => (k === "birthday" ? u.birthday_vis || "contacts" : (u.priv || {})[k] || PRIV_DEF[k]);

// адрес почты: проверка формы и частые опечатки в домене
const EMAIL_FORM = /^[A-Za-z0-9._%+\-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;
const MAIL_FIX = { "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gmail.con": "gmail.com", "gmail.co": "gmail.com", "gmil.com": "gmail.com", "gnail.com": "gmail.com",
  "mail.ry": "mail.ru", "mail.tu": "mail.ru", "mal.ru": "mail.ru", "yandex.ry": "yandex.ru", "yadnex.ru": "yandex.ru", "yande.ru": "yandex.ru", "outlok.com": "outlook.com",
  "hotmial.com": "hotmail.com", "icloud.con": "icloud.com", "iclod.com": "icloud.com", "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "ya.ry": "ya.ru" };
function checkEmail(v) {
  v = String(v || "").trim();
  if (!v) return { ok: false, empty: true };
  if (v.length > 120) return { ok: false, msg: T("Слишком длинный адрес") };
  if (/\s/.test(v)) return { ok: false, msg: T("В адресе не должно быть пробелов") };
  if (!v.includes("@")) return { ok: false, msg: T("Не хватает знака @") };
  if ((v.match(/@/g) || []).length > 1) return { ok: false, msg: T("Знак @ должен быть один") };
  const [loc, dom] = v.split("@");
  if (!loc) return { ok: false, msg: T("Напишите имя перед знаком @") };
  if (!dom) return { ok: false, msg: T("Напишите домен после @, например gmail.com") };
  if (!dom.includes(".")) return { ok: false, msg: T("В домене не хватает точки, например gmail.com") };
  if (/\.\./.test(v) || loc.startsWith(".") || loc.endsWith(".")) return { ok: false, msg: T("Лишние точки в адресе") };
  if (!EMAIL_FORM.test(v)) return { ok: false, msg: T("Адрес написан неверно. Пример: name@gmail.com") };
  const fix = MAIL_FIX[dom.toLowerCase()];
  if (fix) return { ok: true, maybe: loc + "@" + fix };
  return { ok: true };
}

Object.assign(Settings, {
  // ─────────── Конфиденциальность ───────────
  privacy() {
    const pg = Pg.open({ title: T("Конфиденциальность"), build: (pg) => Settings.drawPrivacy(pg) });
    pg.on = {
      pk: (el) => Settings.privKey(el.dataset.v, pg),
      cloud: () => Settings.cloud(pg), pass: () => Settings.passcode(pg), keys: () => Settings.passkeys(),
      email: () => Settings.email(pg), del: () => Settings.autodel(pg),
      msg: () => Settings.privMsg(pg), gifts: () => Settings.privGifts(pg), blocks: () => Settings.blocklist(pg),
    };
    pg.hook = () => Settings.drawPrivacy(pg);
    return pg;
  },
  drawPrivacy(pg) {
    const u = App.user, d = u.auto_del || 0;
    pg.set(`
      ${R.lbl(esc(T("Кто может видеть")))}
      ${R.card(...PRIV_ROWS.filter((r) => !r.grp).map((r) => R.row({ a: "pk", v: r.k, ic: r.ic, c: r.c, t: esc(T(r.t)), r: esc(T(VIS_T[privVal(u, r.k)])) })))}
      ${R.hint(esc(T("«Мои контакты» — люди, с которыми у вас есть переписка.")))}
      ${R.lbl(esc(T("Кто может мне писать")))}
      ${R.card(
        ...PRIV_ROWS.filter((r) => r.k === "voice").map((r) => R.row({ a: "pk", v: r.k, ic: r.ic, c: r.c, t: esc(T(r.t)), r: esc(T(VIS_T[privVal(u, r.k)])) })),
        R.row({ a: "msg", ic: SI.chat, c: "b", t: esc(T("Сообщения")), r: esc(Settings.msgText(u)) }),
        R.row({ a: "gifts", ic: SI.gift, c: "p", t: esc(T("Подарки")), r: esc(T(VIS_T[privVal(u, "gifts")])) }),
        ...PRIV_ROWS.filter((r) => r.k === "invite").map((r) => R.row({ a: "pk", v: r.k, ic: r.ic, c: r.c, t: esc(T(r.t)), r: esc(T(VIS_T[privVal(u, r.k)])) })))}
      ${R.hint(esc(T("Контакты — те, кто сохранён у вас в контактах или кому вы писали сами. Подписчики Premium могут писать вам, если выбрано «Контакты и Premium».")))}
      ${R.card(R.row({ a: "blocks", ic: SI.shield, c: "r", t: esc(T("Чёрный список")), r: esc(Settings.blockCount ? String(Settings.blockCount) : "") }))}
      ${R.lbl(esc(T("Безопасность")))}
      ${R.card(
        R.row({ a: "cloud", ic: SI.key, c: "o", t: esc(T("Облачный пароль")), r: esc(u.has_cloud ? T("Вкл.") : T("Выкл.")) }),
        R.row({ a: "pass", ic: SI.lock, c: "g", t: esc(T("Код-пароль")), r: esc(Lock.on() ? T("Вкл.") : T("Выкл.")) }),
        R.row({ a: "keys", ic: SI.key, c: "b", t: esc(T("Ключи доступа")), soon: 1 }),
        R.row({ a: "email", ic: SI.mail, c: "t", t: esc(T("Почта для входа")), r: u.email ? esc(u.email) : esc(T("Не задана")) }),
        R.row({ a: "del", ic: SI.timer, c: "p", t: esc(T("Автоудаление сообщений")), r: esc(d ? Settings.durText(d) : T("Выкл.")) }))}
      ${R.hint(esc(T("Облачный пароль запрашивается при входе с нового устройства, код-пароль — при каждом открытии приложения на этом устройстве.")))}`);
  },

  durText(s) {
    const U = [[2592000, "мес."], [604800, "нед."], [86400, "дн."], [3600, "ч"], [60, "мин."]];
    for (const [n, w] of U) if (s % n === 0 && s >= n) {
      const k = s / n;
      if (n === 86400 && k === 1) return T("1 день");
      if (n === 604800 && k === 1) return T("1 неделя");
      if (n === 2592000 && k === 1) return T("1 месяц");
      return k + " " + T(w);
    }
    return s + " " + T("с");
  },

  // ─────────── один параметр приватности ───────────
  privKey(k, parent) {
    const r = PRIV_ROWS.find((x) => x.k === k); if (!r) return;
    const pg = Pg.open({ title: T(r.t), build: (pg) => {
      const cur = privVal(App.user, k);
      pg.set(`${R.lbl(esc(T(r.h)))}
        ${R.opts(["all", "contacts", "none"].map((v) => ({ v, t: esc(T(VIS_T[v])) })), cur, "set")}
        ${R.hint(esc(T(r.n)))}`);
    } });
    pg.on = {
      set: async (el) => {
        const v = el.dataset.v; if (v === privVal(App.user, k)) return;
        try {
          const d = await api("/api/me/privacy", { method: "POST", body: { key: k, value: v } });
          App.user = d.user; pg.refresh(); Profile.render();
          if (parent && parent.alive) parent.refresh();
        } catch (e) { toast(e.message); }
      },
    };
  },

  // ─────────── «Сообщения»: все / контакты и Premium / за звёзды ───────────
  msgText(u) {
    const p = (u || App.user).priv || {};
    if (p.msg === "paid") return `⭐ ${(p.msg_price || 0).toLocaleString(I18N.lang === "en" ? "en-US" : "ru-RU")}`;
    return T(p.msg === "cp" ? "Контакты и Premium" : "Все");
  },
  privMsg(parent) {
    const pg = Pg.open({ title: T("Сообщения"), data: { paid: (App.user.priv || {}).msg === "paid" }, build: (pg) => {
      const p = App.user.priv || {}, cur = pg.data.paid ? "paid" : p.msg || "all";
      const price = p.msg_price || "";
      pg.set(`${R.lbl(esc(T("Кто может писать мне")))}
        ${R.opts([
          { v: "all", t: esc(T("Все")), s: esc(T("Писать вам может любой человек")) },
          { v: "cp", t: esc(T("Контакты и Premium-подписчики")), s: esc(T("Незнакомые смогут написать, только если у них есть Dicegram Premium")) },
          { v: "paid", t: esc(T("Сообщение за звёзды")), s: esc(T("Незнакомые платят вам за каждое сообщение")) }], cur, "set")}
        ${cur === "paid" ? `${R.lbl(esc(T("Цена одного сообщения")))}
          <div class="card2 fields pm-price"><input id="pm-price" type="number" inputmode="numeric" min="1" max="35000" step="1" value="${esc(price)}" placeholder="1 – 35 000" aria-label="${esc(T("Цена одного сообщения"))}"><span class="pm-st">${GIC.star}</span></div>
          <div class="pm-chips">${[1, 5, 10, 50, 100, 500, 1000].map((n) => `<button type="button" data-a="chip" data-v="${n}">${n}</button>`).join("")}</div>
          <div class="err" id="pm-err"></div>
          <div class="pg-btnw">${R.btn(esc(T("Сохранить")), "save")}</div>` : ""}
        ${R.hint(esc(T(cur === "paid" ? "От 1 до 35 000 звёзд за сообщение. Бесплатно вам пишут контакты и подписчики Premium. Звёзды сразу зачисляются на ваш баланс."
          : "Контакты — те, кто сохранён у вас в контактах или кому вы писали сами.")))}`);
    } });
    const save = async (body) => {
      try { const d = await api("/api/me/privacy", { method: "POST", body: Object.assign({ key: "msg" }, body) }); App.user = d.user; pg.data.paid = d.user.priv.msg === "paid"; pg.refresh(); if (parent && parent.alive) parent.refresh(); Profile.render(); }
      catch (e) { const er = pg.$("#pm-err"); if (er) er.textContent = e.message; else toast(e.message); }
    };
    pg.on = {
      set: (el) => {
        const v = el.dataset.v;
        if (v === "paid") { pg.data.paid = true; return pg.refresh(); }
        pg.data.paid = false; if (((App.user.priv || {}).msg || "all") === v) return pg.refresh(); save({ value: v });
      },
      chip: (el) => { const i = pg.$("#pm-price"), er = pg.$("#pm-err"); if (er) er.textContent = ""; if (i) { i.value = el.dataset.v; i.focus(); } },
      save: () => {
        const n = Math.round(+((pg.$("#pm-price") || {}).value || 0)), er = pg.$("#pm-err");
        if (!(n >= 1 && n <= 35000)) { if (er) { er.textContent = T("Цена — от 1 до 35 000 звёзд"); er.classList.add("shake"); setTimeout(() => er.classList.remove("shake"), 400); } return; }
        save({ value: "paid", price: n });
      },
    };
    return pg;
  },

  // ─────────── «Подарки»: кто может дарить и какие подарки принимать ───────────
  privGifts(parent) {
    const pg = Pg.open({ title: T("Подарки"), build: (pg) => {
      const u = App.user, p = u.priv || {}, types = p.gtypes || GIFT_TYPE_ROWS.map((x) => x[0]);
      pg.set(`${R.lbl(esc(T("Кто может дарить мне подарки")))}
        ${R.opts(["all", "contacts", "none"].map((v) => ({ v, t: esc(T(VIS_T[v])) })), privVal(u, "gifts"), "who")}
        ${R.lbl(esc(T("Какие подарки принимать")))}
        ${R.card(...GIFT_TYPE_ROWS.map(([k, t, s]) => R.row({ a: "gt", v: k, ic: SI.gift, c: { regular: "b", rare: "p", unique: "v", channels: "t", premium: "o" }[k], t: esc(T(t)), s: esc(T(s)), sw: 1, on: types.includes(k) })))}
        ${R.hint(esc(T("Подарки, которые вы не принимаете, отправить вам нельзя — человек увидит об этом сообщение.")))}`);
    } });
    const save = async (body) => {
      try { const d = await api("/api/me/privacy", { method: "POST", body }); App.user = d.user; pg.refresh(); if (parent && parent.alive) parent.refresh(); }
      catch (e) { toast(e.message); }
    };
    pg.on = {
      who: (el) => { if (el.dataset.v !== privVal(App.user, "gifts")) save({ key: "gifts", value: el.dataset.v }); },
      gt: (on, el) => {
        const cur = new Set((App.user.priv || {}).gtypes || GIFT_TYPE_ROWS.map((x) => x[0]));
        if (on) cur.add(el.dataset.v); else cur.delete(el.dataset.v);
        save({ key: "gtypes", value: [...cur] });
      },
    };
    return pg;
  },

  // ─────────── Чёрный список ───────────
  blockCount: 0,
  blocklist(parent) {
    const pg = Pg.open({ title: T("Чёрный список"), data: { list: null }, build: (pg) => {
      const l = pg.data.list;
      if (l === null) { pg.set(`<div class="bl-load"><div class="spin"></div></div>`); return; }
      pg.set(`<div class="pg-btnw">${R.btn(esc(T("Заблокировать")), "add", "danger")}</div>
        ${R.hint(esc(T("Заблокированные не смогут писать вам, звонить и дарить подарки. Они не узнают, что вы их заблокировали.")))}
        ${l.length ? `${R.lbl(esc(T("Заблокированные пользователи")))}<div class="card2 irows bl-list">${l.map((x) => `<div class="irow bl-row" data-id="${x.id}">${avatar(x, "sm")}<span class="tx"><b>${esc(dispName(x))}${verBadge(x)}</b><small>${x.username ? "@" + esc(x.username) : esc(T("Нет имени пользователя"))}</small></span><button type="button" class="bl-dots" data-a="menu" data-v="${x.id}" aria-label="${esc(T("Ещё"))}">${SI.dots}</button></div>`).join("")}</div>`
          : R.hero(SI.shield, esc(T("Никто не заблокирован")), esc(T("Здесь появятся люди, которых вы заблокировали.")))}`);
    } });
    const load = async () => {
      try { const d = await api("/api/blocks"); pg.data.list = d.users || []; Settings.blockCount = pg.data.list.length; }
      catch (e) { pg.data.list = []; toast(e.message); }
      if (pg.alive) pg.refresh();
      if (parent && parent.alive) parent.refresh();
    };
    pg.on = {
      add: async () => {
        await Contacts.load();
        const have = new Set((pg.data.list || []).map((x) => x.id));
        const cand = Contacts.people().filter((u) => !have.has(u.id) && !u.is_system);
        Picker.open({
          title: T("Заблокировать"), people: cand, multi: false,
          extra: [{ t: T("Найти по @username"), ic: SI.search, fn: async () => {
            const v = await UI.prompt({ title: T("Имя пользователя"), placeholder: "@username", ok: T("Найти"), type: "text" });
            const name = String(v || "").trim().replace(/^@/, ""); if (!name) return;
            try {
              const r = await api("/api/resolve/" + encodeURIComponent(name));
              if (r.type !== "user") return toast(T("Это не человек, а группа или канал"));
              await Nav.unwindWhile((t) => /^pick\d+$/.test(t.id || ""));
              pg.on.block(r.user);
            } catch (e) { toast(T("Пользователь @{0} не найден", name)); }
          } }],
          onDone: async ([id]) => { const u = Contacts.people().find((x) => x.id === id); if (u) pg.on.block(u); },
        });
      },
      block: async (u) => {
        if (u.id === App.user.id) return toast(T("Нельзя заблокировать себя"));
        const ok = await UI.sheet({ title: T("Заблокировать {0}?", dispName(u)), text: T("Он не сможет писать вам, звонить и дарить подарки."), actions: [{ label: T("Заблокировать"), value: true, danger: true }] });
        if (!ok) return;
        try { await api("/api/block", { method: "POST", body: { id: u.id, on: true } }); toast(T("Пользователь заблокирован")); haptic(); await load(); } catch (e) { toast(e.message); }
      },
      menu: async (el) => {
        const id = +el.dataset.v, u = (pg.data.list || []).find((x) => x.id === id); if (!u) return;
        const v = await UI.sheet({ title: dispName(u), actions: [{ label: T("Разблокировать"), value: "un", accent: true }] });
        if (v !== "un") return;
        try {
          await api("/api/block", { method: "POST", body: { id, on: false } });
          pg.data.list = pg.data.list.filter((x) => x.id !== id); Settings.blockCount = pg.data.list.length;
          toast(T("Пользователь разблокирован")); haptic(); pg.refresh(); if (parent && parent.alive) parent.refresh();
          try { const c = Chats.byId(id); if (c) { c.peer.blocked = false; } } catch (e) {}
        } catch (e) { toast(e.message); }
      },
    };
    load();
    return pg;
  },

  // ─────────── Облачный пароль ───────────
  cloud(parent) {
    const pg = Pg.open({ title: T("Облачный пароль"), data: { step: "home", cur: "", pw: "", mode: "" }, build: (pg) => Settings.drawCloud(pg) });
    const refreshAll = () => { App.user.has_cloud = App.user.has_cloud; if (parent && parent.alive) parent.refresh(); };
    const val = () => { const i = pg.$("#pw-in"); return i ? i.value : ""; };
    const go = (step) => { pg.data.step = step; Settings.drawCloud(pg); };
    const fail = (t) => { const e = pg.$("#pw-err"); if (e) { e.textContent = t; e.classList.add("shake"); setTimeout(() => e.classList.remove("shake"), 400); } };
    const save = async (body, okText) => {
      try {
        const d = await api("/api/me/cloud", { method: "POST", body }); App.user = d.user;
        pg.data = { step: "home", cur: "", pw: "", mode: "" }; Settings.drawCloud(pg); refreshAll(); toast(okText);
      } catch (e) { fail(e.message); }
    };
    pg.on = {
      eye: (el) => { const i = pg.$("#pw-in"); i.type = i.type === "password" ? "text" : "password"; el.classList.toggle("on", i.type === "text"); },
      start: () => { pg.data.mode = "set"; go("new"); },
      change: () => { pg.data.mode = "change"; go("cur"); },
      hint: () => { pg.data.mode = "hint"; go("cur"); },
      remove: () => { pg.data.mode = "remove"; go("cur"); },
      skip: () => pg.on.next(),
      next: async () => {
        const d = pg.data, v = val(), s = d.step;
        if (s === "cur") {
          if (!v) return fail(T("Введите текущий пароль"));
          d.cur = v;
          if (d.mode === "remove") {
            if (!(await ask(T("Удалить облачный пароль? Вход с нового устройства будет защищён только кодом из бота."), T("Удалить")))) return;
            return save({ action: "remove", current: d.cur }, T("Облачный пароль удалён"));
          }
          return go(d.mode === "hint" ? "hint" : "new");
        }
        if (s === "new") {
          if (v.length < 4) return fail(T("Пароль: от 4 символов"));
          if (v.length > 64) return fail(T("Пароль слишком длинный"));
          d.pw = v; return go("again");
        }
        if (s === "again") {
          if (v !== d.pw) { fail(T("Пароли не совпадают")); return; }
          return go("hint");
        }
        if (s === "hint") {
          if (d.mode === "hint") return save({ action: "hint", current: d.cur, hint: v }, T("Подсказка сохранена"));
          if (v && v.toLowerCase() === d.pw.toLowerCase()) return fail(T("Подсказка не должна совпадать с паролем"));
          return save(d.mode === "change" ? { action: "change", current: d.cur, password: d.pw, hint: v } : { action: "set", password: d.pw, hint: v },
            d.mode === "change" ? T("Пароль изменён") : T("Облачный пароль установлен"));
        }
      },
    };
    pg.el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "pw-in") { e.preventDefault(); pg.on.next(); } });
  },
  drawCloud(pg) {
    const u = App.user, s = pg.data.step;
    const field = (ph, type = "password") => `<div class="pfld"><input id="pw-in" type="${type}" placeholder="${esc(ph)}" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="64">${type === "password" ? `<button class="eye" data-a="eye" aria-label="${esc(T("Показать"))}">${SI.eye}</button>` : ""}</div><p class="pfld-err" id="pw-err"></p>`;
    let h = "";
    if (s === "home") {
      h = u.has_cloud
        ? `${R.hero(SI.key, esc(T("Облачный пароль включен")), esc(T("При входе с нового устройства, кроме кода из бота, потребуется ваш пароль.")), "ok")}
           ${R.card(R.row({ a: "change", ic: SI.edit, c: "b", t: esc(T("Изменить пароль")) }), R.row({ a: "hint", ic: SI.info, c: "o", t: esc(T("Изменить подсказку")) }), R.row({ a: "remove", ic: SI.trash, c: "r", t: esc(T("Удалить пароль")), danger: 1 }))}
           ${R.hint(esc(T("Запомните пароль: если вы его забудете, войти в аккаунт на новом устройстве будет нельзя.")))}`
        : `${R.hero(SI.key, esc(T("Облачный пароль")), esc(T("Задайте пароль, который будет запрашиваться при входе с нового устройства — в дополнение к коду из бота.")))}
           <div class="pad-btn">${R.btn(esc(T("Задать пароль")), "start")}</div>`;
    } else {
      const t = { cur: ["Текущий пароль", "Введите ваш текущий облачный пароль.", "Текущий пароль"],
        new: ["Новый пароль", "Придумайте пароль: от 4 символов.", "Пароль"],
        again: ["Повторите пароль", "Введите пароль ещё раз, чтобы не ошибиться.", "Повторите пароль"],
        hint: ["Подсказка", "Подсказка поможет вспомнить пароль. Её увидит любой, кто введёт ваш номер, поэтому не пишите в ней сам пароль.", "Подсказка (необязательно)"] }[s];
      h = `${R.hero(SI.lock, esc(T(t[0])), esc(T(t[1])))}${field(T(t[2]), s === "hint" ? "text" : "password")}
        <div class="pad-btn">${R.btn(esc(T(s === "hint" && pg.data.mode !== "hint" ? "Сохранить" : "Далее")), "next")}${s === "hint" && pg.data.mode !== "hint" ? R.btn(esc(T("Пропустить")), "skip", "ghost") : ""}</div>`;
    }
    pg.set(h);
    if (s !== "home") setTimeout(() => { const i = pg.$("#pw-in"); if (i) i.focus(); }, 260);
  },

  // ─────────── Автоудаление ───────────
  autodel(parent) {
    const PRESETS = [0, 86400, 604800, 2592000];
    const pg = Pg.open({ title: T("Автоудаление сообщений"), build: (pg) => {
      const d = App.user.auto_del || 0, custom = d && !PRESETS.includes(d) || pg.data.custom;
      pg.set(`${R.hero(SI.timer, "", esc(T("Ваши новые сообщения будут автоматически удаляться у обоих участников чата через выбранное время.")), "slim")}
        ${R.opts([{ v: 0, t: esc(T("Выключено")) }, { v: 86400, t: esc(T("1 день")) }, { v: 604800, t: esc(T("1 неделя")) }, { v: 2592000, t: esc(T("1 месяц")) },
          { v: "custom", t: esc(T("Другое…")), s: custom && d ? esc(Settings.durText(d)) : "" }], custom ? "custom" : d, "set")}
        ${custom ? `${R.lbl(esc(T("Свой срок")))}<div class="card2 irows"><div class="irow cust"><input id="cd-n" type="number" inputmode="numeric" min="1" max="999" value="${pg.data.n || ""}" placeholder="1" data-i="cdn">
          <div class="unit">${[["m", "мин."], ["h", "ч"], ["d", "дн."], ["w", "нед."], ["mo", "мес."]].map(([k, l]) => `<button class="${(pg.data.u || "d") === k ? "on" : ""}" data-a="unit" data-v="${k}">${esc(T(l))}</button>`).join("")}</div></div></div>
          <div class="pad-btn">${R.btn(esc(T("Сохранить")), "cust")}</div>` : ""}
        ${R.hint(esc(T("Старые сообщения не удаляются. Срок: от 1 минуты до года.")))}`);
    } });
    pg.data = {};
    const push = async (sec) => {
      try { const d = await api("/api/me/autodelete", { method: "POST", body: { seconds: sec } }); App.user = d.user; pg.data = {}; pg.refresh(); if (parent && parent.alive) parent.refresh(); toast(sec ? T("Автоудаление: {0}", Settings.durText(sec)) : T("Автоудаление выключено")); }
      catch (e) { toast(e.message); }
    };
    pg.on = {
      set: (el) => {
        if (el.dataset.v === "custom") { pg.data.custom = true; return pg.refresh(); }
        pg.data.custom = false; push(+el.dataset.v);
      },
      unit: (el) => { const n = pg.$("#cd-n"); pg.data.n = n ? n.value : ""; pg.data.u = el.dataset.v; pg.refresh(); },
      cdn: (v) => { pg.data.n = v; },
      cust: () => {
        const n = Math.floor(+pg.data.n || +(pg.$("#cd-n") || {}).value), mul = { m: 60, h: 3600, d: 86400, w: 604800, mo: 2592000 }[pg.data.u || "d"];
        if (!n || n < 1) return toast(T("Введите число"));
        const sec = n * mul;
        if (sec < 60 || sec > 365 * 86400) return toast(T("Срок: от 1 минуты до года"));
        push(sec);
      },
    };
  },

  // ─────────── Код-пароль ───────────
  passcode(parent) {
    const pg = Pg.open({ title: T("Код-пароль"), data: { step: "home" }, build: (pg) => Settings.drawPass(pg) });
    const done = (msg) => { pg.data = { step: "home" }; Settings.drawPass(pg); if (parent && parent.alive) parent.refresh(); if (msg) toast(msg); };
    pg.on = {
      enable: () => { pg.data = { step: "new" }; Settings.drawPass(pg); },
      change: () => { pg.data = { step: "cur", then: "new" }; Settings.drawPass(pg); },
      off: () => { pg.data = { step: "cur", then: "off" }; Settings.drawPass(pg); },
      auto: async () => {
        const cur = Lock.cfg().auto;
        const v = await UI.sheet({ title: T("Автоблокировка"), text: T("Когда запрашивать код, если вы вернулись в приложение."),
          actions: Lock.AUTO.map((o) => ({ label: T(o.t) + (o.v === cur ? "  ✓" : ""), value: o.v })) });
        if (v === null) return; Lock.setAuto(v); Settings.drawPass(pg);
      },
    };
    pg.mount = () => {
      const root = pg.$("#lk-root"); if (!root) return;
      const d = pg.data;
      const titles = { cur: T("Введите код-пароль"), new: T("Придумайте код-пароль"), again: T("Повторите код-пароль") };
      const ctl = Lock.pad(root, { title: titles[d.step], sub: d.step === "new" ? T("Из 4 цифр") : "",
        onDone: async (code) => {
          if (d.step === "cur") {
            if (!(await Lock.check(code))) return T("Неверный код-пароль");
            if (d.then === "off") { Lock.clear(); return done(T("Код-пароль выключен")); }
            d.step = "new"; ctl.next(titles.new, T("Из 4 цифр")); return;
          }
          if (d.step === "new") { d.code = code; d.step = "again"; ctl.next(titles.again, ""); return; }
          if (d.step === "again") {
            if (code !== d.code) { d.step = "new"; ctl.next(titles.new, T("Коды не совпали. Попробуйте ещё раз"), true); return; }
            await Lock.set(code); done(T("Код-пароль включен"));
          }
        } });
    };
  },
  drawPass(pg) {
    const s = pg.data.step;
    if (s !== "home") {
      pg.set(`<div id="lk-root" class="lk lk-in"></div>`); pg.mount(); return;
    }
    const on = Lock.on(), c = Lock.cfg();
    pg.set(on
      ? `${R.hero(SI.lock, esc(T("Код-пароль включен")), esc(T("При каждом открытии приложения нужно ввести код из 4 цифр.")), "ok")}
         ${R.card(R.row({ a: "change", ic: SI.edit, c: "b", t: esc(T("Изменить код-пароль")) }),
            R.row({ a: "auto", ic: SI.timer, c: "o", t: esc(T("Автоблокировка")), r: esc(T((Lock.AUTO.find((o) => o.v === c.auto) || Lock.AUTO[2]).t)) }),
            R.row({ a: "off", ic: SI.trash, c: "r", t: esc(T("Выключить код-пароль")), danger: 1 }))}
         ${R.hint(esc(T("Код-пароль хранится только на этом устройстве. Если вы его забудете, придётся выйти из аккаунта и войти заново.")))}`
      : `${R.hero(SI.lock, esc(T("Код-пароль")), esc(T("Когда включён код-пароль, при каждом открытии приложения запрашивается код из 4 цифр — даже если вы уже вошли в аккаунт.")))}
         <div class="pad-btn">${R.btn(esc(T("Включить код-пароль")), "enable")}</div>
         ${R.hint(esc(T("Код хранится только на этом устройстве и защищает вход в приложение.")))}`);
  },

  // ─────────── Ключи доступа ───────────
  passkeys() {
    UI.sheet({ title: T("Ключи доступа"), icon: SI.key, text: T("Вход без кода: по отпечатку пальца, Face ID или блокировке экрана. Эта функция появится в одном из следующих обновлений."), actions: [], cancel: T("Понятно") });
  },

  // ─────────── Почта для входа ───────────
  email(parent) {
    const pg = Pg.open({ title: T("Почта для входа"), data: { edit: !App.user.email }, build: (pg) => Settings.drawEmail(pg) });
    const upd = () => {
      const i = pg.$("#em-in"), st = pg.$("#em-st"), b = pg.$("#em-ok"); if (!i) return;
      const r = checkEmail(i.value); pg.data.res = r;
      if (r.empty) { st.className = "pfld-st"; st.innerHTML = ""; }
      else if (!r.ok) { st.className = "pfld-st bad"; st.textContent = r.msg; }
      else if (r.maybe) { st.className = "pfld-st warn"; st.innerHTML = `${esc(T("Возможно, опечатка. Вы имели в виду"))} <button class="lnk" data-a="fix" data-v="${esc(r.maybe)}">${esc(r.maybe)}</button>?`; }
      else { st.className = "pfld-st ok"; st.textContent = T("Адрес выглядит верно"); }
      b.disabled = !r.ok;
    };
    const save = async (v) => {
      try { const d = await api("/api/me/email", { method: "POST", body: { email: v } }); App.user = d.user; pg.data = { edit: false }; Settings.drawEmail(pg); if (parent && parent.alive) parent.refresh(); toast(v ? T("Почта сохранена") : T("Почта удалена")); }
      catch (e) { const st = pg.$("#em-st"); if (st) { st.className = "pfld-st bad"; st.textContent = e.message; } }
    };
    pg.on = {
      em: upd,
      fix: (el) => { pg.$("#em-in").value = el.dataset.v; upd(); },
      edit: () => { pg.data = { edit: true }; Settings.drawEmail(pg); },
      ok: () => { const i = pg.$("#em-in"), r = checkEmail(i.value); if (r.ok) save(i.value.trim()); },
      rm: async () => { if (await ask(T("Удалить адрес почты из аккаунта?"), T("Удалить"))) save(""); },
    };
    pg.el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "em-in") { e.preventDefault(); pg.on.ok(); } });
  },
  drawEmail(pg) {
    const u = App.user;
    if (!pg.data.edit && u.email) {
      pg.set(`${R.hero(SI.mail, esc(u.email), esc(T("Это адрес почты вашего аккаунта.")), "ok")}
        ${R.card(R.row({ a: "edit", ic: SI.edit, c: "b", t: esc(T("Изменить адрес")) }), R.row({ a: "rm", ic: SI.trash, c: "r", t: esc(T("Удалить адрес")), danger: 1 }))}
        ${R.hint(esc(T("Пока почта только хранится в аккаунте: код на неё не отправляется и войти по ней нельзя.")))}`);
      return;
    }
    pg.set(`${R.hero(SI.mail, esc(T("Почта для входа")), esc(T("Укажите адрес почты. Мы проверим, что он написан правильно.")))}
      <div class="pfld"><input id="em-in" type="email" inputmode="email" placeholder="name@example.com" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="120" value="${esc(u.email || "")}" data-i="em"></div>
      <p class="pfld-st" id="em-st"></p>
      <div class="pad-btn"><button class="pbtn" id="em-ok" data-a="ok" disabled>${esc(T("Сохранить"))}</button></div>
      ${R.hint(esc(T("Пока почта только хранится в аккаунте: код на неё не отправляется и войти по ней нельзя.")))}`);
    setTimeout(() => { const i = pg.$("#em-in"); if (i) { i.focus(); pg.on.em(); } }, 260);
  },

  // ─────────── Устройства ───────────
  devices() {
    const pg = Pg.open({ title: T("Устройства"), data: { list: null }, build: (pg) => Settings.drawDevices(pg) });
    pg.on = {
      others: async () => {
        if (!(await ask(T("Завершить все сеансы, кроме этого?"), T("Завершить")))) return;
        try { await api("/api/sessions/terminate_others", { method: "POST", body: {} }); toast(T("Другие сеансы завершены")); Settings.loadDevices(pg); } catch (e) { toast(e.message); }
      },
      sess: async (el) => {
        const s = pg.data.list.find((x) => x.id === el.dataset.v); if (!s) return;
        const when = (t) => new Date(t * 1000).toLocaleString(I18N.loc, { dateStyle: "medium", timeStyle: "short" });
        const v = await UI.sheet({ title: s.device || T("Устройство"), text: `${s.country ? s.country + " · " : ""}IP ${s.ip}\n${T("Вход")}: ${when(s.created)}\n${T("Активность")}: ${s.online ? T("в сети") : when(s.last)}`,
          actions: s.current ? [] : [{ label: T("Завершить сеанс"), value: "x", danger: true }], cancel: T("Закрыть") });
        if (v !== "x") return;
        try { await api("/api/sessions/terminate", { method: "POST", body: { id: s.id } }); toast(T("Сеанс завершён")); Settings.loadDevices(pg); } catch (e) { toast(e.message); }
      },
    };
    Settings.loadDevices(pg);
  },
  async loadDevices(pg) {
    try { pg.data.list = (await api("/api/sessions")).sessions; } catch (e) { pg.data.err = e.message; }
    if (pg.alive) Settings.drawDevices(pg);
  },
  drawDevices(pg) {
    const list = pg.data.list;
    if (!list) { pg.set(pg.data.err ? `<div class="pf-empty"><p>${esc(pg.data.err)}</p></div>` : '<div class="pf-load"><div class="spin"></div></div>'); return; }
    const cur = list.find((s) => s.current), oth = list.filter((s) => !s.current);
    const ago = (s) => (s.online ? T("в сети") : agoText(s.last));
    const ic = (d) => (/iphone|android|mobile|ios|ipad/i.test(d || "") ? [SI.phone2, "g"] : [SI.laptop, "b"]);
    const row = (s) => { const [i, c] = ic(s.device); return R.row({ a: "sess", v: s.id, ic: i, c, t: esc(s.device || T("Устройство")), s: esc(`${s.country ? s.country + " · " : ""}IP ${s.ip}`), r: esc(ago(s)) }); };
    pg.set(`
      ${R.hero(SI.laptop, "", esc(T("Здесь все устройства, где выполнен вход в ваш аккаунт.")), "slim")}
      ${cur ? `${R.lbl(esc(T("Это устройство")))}${R.card(row(cur))}` : ""}
      ${oth.length ? R.card(R.row({ a: "others", ic: SI.shield, c: "r", t: esc(T("Завершить все другие сеансы")), danger: 1, chev: false })) : ""}
      ${oth.length ? `${R.lbl(esc(T("Активные сеансы")))}${R.card(...oth.map(row))}${R.hint(esc(T("Нажмите на сеанс, чтобы завершить его.")))}` : R.hint(esc(T("Других активных сеансов нет.")))}`);
  },
});

// ═════════════ КОД-ПАРОЛЬ: экран блокировки ═════════════
const Lock = {
  KEY: "lock_" + TG_ID, el: null, hiddenAt: 0, fails: 0,
  AUTO: [{ v: -1, t: "Никогда" }, { v: 0, t: "Сразу" }, { v: 60, t: "Через 1 минуту" }, { v: 300, t: "Через 5 минут" }, { v: 3600, t: "Через 1 час" }, { v: 18000, t: "Через 5 часов" }],
  cfg() { try { return JSON.parse(localStorage.getItem(Lock.KEY) || "null"); } catch (e) { return null; } },
  on() { const c = Lock.cfg(); return !!(c && c.hash); },
  async hash(code, salt) {
    try {
      const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveBits"]);
      const b = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 100000 }, k, 256);
      return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
    } catch (e) {                       // без WebCrypto (например, по http) — простой запасной хеш
      let h = 5381; const s = salt + ":" + code + ":" + salt;
      for (let i = 0; i < 4000; i++) for (let j = 0; j < s.length; j++) h = ((h << 5) + h + s.charCodeAt(j)) | 0;
      return "f" + (h >>> 0).toString(16);
    }
  },
  async set(code) {
    const salt = Array.from(crypto.getRandomValues(new Uint8Array(12))).map((x) => x.toString(16).padStart(2, "0")).join("");
    const prev = Lock.cfg();
    const cfg = { salt, hash: await Lock.hash(code, salt), auto: prev && prev.auto !== undefined ? prev.auto : 60 };
    try { localStorage.setItem(Lock.KEY, JSON.stringify(cfg)); } catch (e) {}
  },
  setAuto(v) { const c = Lock.cfg(); if (!c) return; c.auto = v; try { localStorage.setItem(Lock.KEY, JSON.stringify(c)); } catch (e) {} },
  clear() { try { localStorage.removeItem(Lock.KEY); localStorage.removeItem(Lock.KEY + "_until"); } catch (e) {} },
  async check(code) {
    const c = Lock.cfg(); if (!c) return true;
    return (await Lock.hash(code, c.salt)) === c.hash;
  },
  wait() { try { return Math.max(0, Math.ceil((+localStorage.getItem(Lock.KEY + "_until") - Date.now()) / 1000)); } catch (e) { return 0; } },

  // цифровая клавиатура с четырьмя точками; onDone(code) возвращает текст ошибки (тогда точки трясутся) или ничего
  pad(root, o) {
    root.innerHTML = `<div class="lk-t">${esc(o.title || "")}</div><div class="lk-s">${esc(o.sub || "")}</div>
      <div class="lk-dots"><i></i><i></i><i></i><i></i></div>
      <div class="lk-keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-d="${n}">${n}</button>`).join("")}<span></span><button data-d="0">0</button>
      <button data-d="x" aria-label="${esc(T("Стереть"))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="m17 9-5 6M12 9l5 6"/></svg></button></div>`;
    let code = "", busy = false;
    const dots = root.querySelectorAll(".lk-dots i"), sub = root.querySelector(".lk-s"), title = root.querySelector(".lk-t");
    const draw = () => dots.forEach((d, i) => d.classList.toggle("on", i < code.length));
    const press = async (d) => {
      if (busy) return;
      if (d === "x") code = code.slice(0, -1); else if (code.length < 4) code += d;
      draw();
      if (code.length < 4) return;
      busy = true;
      const err = await o.onDone(code);
      busy = false;
      if (err) { sub.textContent = err; sub.classList.add("bad"); const dd = root.querySelector(".lk-dots"); dd.classList.remove("shake"); void dd.offsetWidth; dd.classList.add("shake"); try { navigator.vibrate && navigator.vibrate(60); } catch (e) {} setTimeout(() => { code = ""; draw(); }, 280); }
      else if (!ctl.moved) { code = ""; draw(); }
    };
    root.querySelector(".lk-keys").onclick = (e) => { const b = e.target.closest("button[data-d]"); if (b) { haptic(); press(b.dataset.d); } };
    const kd = (e) => {
      if (!root.isConnected) return document.removeEventListener("keydown", kd);
      if (/^\d$/.test(e.key)) press(e.key); else if (e.key === "Backspace") press("x");
    };
    document.addEventListener("keydown", kd);
    const ctl = {
      moved: false,
      next(t, s, bad) { ctl.moved = true; code = ""; draw(); title.textContent = t; sub.textContent = s || ""; sub.classList.toggle("bad", !!bad); setTimeout(() => (ctl.moved = false), 30); },
    };
    return ctl;
  },

  show() {
    if (Lock.el || !Lock.on()) return;
    const el = document.createElement("div");
    el.className = "lock"; el.innerHTML = `<div class="lk-top"><div class="lk-ic">${SI.lock}</div></div><div id="lk-main" class="lk"></div>
      <button class="lk-forgot" id="lk-forgot">${esc(T("Забыли код-пароль?"))}</button>`;
    document.body.appendChild(el); Lock.el = el;
    document.documentElement.classList.add("locked");
    const ctl = Lock.pad(el.querySelector("#lk-main"), { title: T("Введите код-пароль"), sub: "",
      onDone: async (code) => {
        const w = Lock.wait(); if (w) return T("Подождите {0} с", w);
        if (await Lock.check(code)) { Lock.fails = 0; Lock.hide(); return; }
        if (++Lock.fails >= 5) { try { localStorage.setItem(Lock.KEY + "_until", String(Date.now() + 30000)); } catch (e) {} Lock.fails = 0; return T("Слишком много попыток. Подождите 30 с"); }
        return T("Неверный код-пароль");
      } });
    el.querySelector("#lk-forgot").onclick = async () => {
      const v = await UI.sheet({ title: T("Забыли код-пароль?"), icon: SI.lock,
        text: T("Код-пароль нельзя восстановить. Можно выйти из аккаунтов на этом устройстве и войти заново по коду из бота — тогда код-пароль сбросится."),
        actions: [{ label: T("Выйти и сбросить"), value: true, danger: true }] });
      if (!v) return;
      try { await api("/api/auth/logout", { method: "POST", body: {} }); } catch (e) {}
      Accounts.save([]); Store.token = ""; Accounts.clearPrev(); Lock.clear(); location.reload();
    };
  },
  hide() {
    const el = Lock.el; if (!el) return;
    Lock.el = null; el.classList.add("out");
    document.documentElement.classList.remove("locked");
    setTimeout(() => el.remove(), 260);
  },
  init() {
    if (Lock.on()) Lock.show();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") { Lock.hiddenAt = Date.now(); return; }
      const c = Lock.cfg(); if (!c || !Lock.hiddenAt) return;
      const a = c.auto === undefined ? 60 : c.auto, gone = (Date.now() - Lock.hiddenAt) / 1000;
      Lock.hiddenAt = 0;
      if (a >= 0 && gone >= a) Lock.show();
    });
  },
};
