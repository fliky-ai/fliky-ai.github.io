// set_prem.js — Premium, звёзды, «Для бизнеса», подарки, поддержка, политика конфиденциальности.

const PRICE = { year: 1000, month: 160 };
const fmtDate = (ts) => new Date(ts * 1000).toLocaleDateString(I18N.loc, { day: "numeric", month: "long", year: "numeric" });

Object.assign(Settings, {
  // ═════════════ PREMIUM ═════════════
  premium() {
    const pg = Pg.open({ title: T(NAME_PREMIUM), data: { plan: "year" }, cls: "prem", build: (pg) => Settings.drawPremium(pg) });
    pg.on = {
      plan: (el) => { pg.data.plan = el.dataset.v; Settings.drawPremium(pg); },
      buy: async () => {
        const plan = pg.data.plan, price = PRICE[plan];
        if ((App.user.stars || 0) < price) {
          const v = await UI.sheet({ title: T("Недостаточно звёзд"), icon: SI.starF, text: T("Нужно {0} ★, у вас {1} ★. Пополнить баланс пока нельзя — мы добавим эту возможность позже.", price, App.user.stars || 0),
            actions: [{ label: T("Открыть «Звёзды»"), value: "s", accent: true }], cancel: T("Понятно") });
          if (v === "s") Settings.stars();
          return;
        }
        if (!(await ask(T("Оформить {0} за {1} ★?", plan === "year" ? T("Premium на год") : T("Premium на месяц"), price), T("Оформить"), false))) return;
        try {
          const d = await api("/api/premium/buy", { method: "POST", body: { plan } });
          App.user = d.user; Profile.render(); Settings.drawPremium(pg); toast(T("Premium активен")); Chats.load();
        } catch (e) { toast(e.message); }
      },
      stars: () => Settings.stars(),
    };
  },
  drawPremium(pg) {
    const u = App.user, plan = pg.data.plan, on = !!u.premium;
    const feat = [
      [SI.userPlus, "b", "До 4 аккаунтов", "Подключайте больше аккаунтов и переключайтесь между ними"],
      [SI.bag, "v", "Инструменты для бизнеса", "Адрес, график работы, быстрые ответы, приветствие и автоответ"],
      [SI.edit, "o", "Длиннее «О себе»", "До 140 символов вместо 70"],
      [SI.starF, "y", "Значок Premium", "Звезда рядом с именем в чатах и профиле"],
      [SI.pin, "g", "Вводный экран", "Короткое приветствие, которое собеседник видит в новом чате"],
    ];
    const card = (k, t, s, extra) => `<button class="plan${plan === k ? " on" : ""}" data-a="plan" data-v="${k}"><span class="radio"></span><span class="tx"><b>${esc(T(t))}</b><small>${esc(s)}</small></span><span class="pr">${PRICE[k]} ★</span>${extra || ""}</button>`;
    pg.set(`
      <div class="prem-hero"><div class="prem-star">${SI.starF}</div><h2>${esc(T(NAME_PREMIUM))}</h2><p>${esc(T("Больше возможностей для общения"))}</p></div>
      ${on ? `<div class="prem-on">${SI.check}<span>${esc(T("Premium активен до {0}", fmtDate(u.premium_until)))}</span></div>` : ""}
      <div class="card2 irows feats">${feat.map(([ic, c, t, s]) => `<div class="irow">${R.ic(c, ic)}<span class="tx"><b>${esc(T(t))}</b><small>${esc(T(s))}</small></span></div>`).join("")}</div>
      ${R.lbl(esc(T(on ? "Продлить" : "Выберите план")))}
      <div class="plans">${card("year", "Ежегодно", T("{0} ★ в месяц", Math.round(PRICE.year / 12)), `<i class="save">−${Math.round((1 - PRICE.year / (PRICE.month * 12)) * 100)}%</i>`)}${card("month", "Ежемесячно", T("Подписка на месяц"))}</div>
      <div class="prem-bal" data-a="stars">${esc(T("Ваш баланс"))}: <b>${u.stars || 0} ★</b></div>
      <div class="pad-btn"><button class="pbtn prem-btn" data-a="buy">${esc(on ? T("Продлить за {0} ★", PRICE[plan]) : T("Оформить за {0} ★", PRICE[plan]))}</button></div>
      ${R.hint(esc(T("Оплата списывается звёздами с вашего баланса. Покупка продлевает уже действующую подписку.")))}`);
  },

  // ═════════════ ЗВЁЗДЫ ═════════════
  stars() {
    const pg = Pg.open({ title: T(NAME_STARS), data: { tx: null }, build: (pg) => Settings.drawStars(pg) });
    pg.on = {
      topup: async () => {
        if (!App.user.admin) {
          return UI.sheet({ title: T("Пополнение пока недоступно"), icon: SI.starF, text: T("Пополнить баланс звёзд сейчас нельзя. Эта возможность появится позже."), actions: [], cancel: T("Понятно") });
        }
        const v = await UI.prompt({ title: T("Пополнить на (тест)"), value: "100", placeholder: "100" });
        const n = Math.floor(+v); if (!v || !(n > 0)) return;
        try { const d = await api("/api/stars/topup", { method: "POST", body: { amount: n } }); App.user = d.user; Settings.loadStars(pg); toast(T("Баланс пополнен")); } catch (e) { toast(e.message); }
      },
      stat: () => Settings.starStat(pg),
      earn: () => Settings.earn(),
      prem: () => Settings.premium(),
    };
    Settings.loadStars(pg);
  },
  async loadStars(pg) {
    try { const d = await api("/api/stars"); App.user.stars = d.balance; App.user.premium = d.premium ? 1 : 0; pg.data = { tx: d.tx, price: d.price }; } catch (e) { pg.data = { tx: [], err: e.message }; }
    if (pg.alive) Settings.drawStars(pg);
    Settings.render();
  },
  drawStars(pg) {
    const u = App.user;
    pg.set(`
      <div class="stars-bal"><div class="stars-ic">${SI.starF}</div><div class="stars-n">${u.stars || 0}</div><div class="stars-l">${esc(T("Ваш баланс"))}</div>
        <button class="pbtn sm" data-a="topup">${esc(T("Пополнить"))}</button></div>
      ${R.card(
        R.row({ a: "stat", ic: SI.stats, c: "b", t: esc(T("Статистика")), s: esc(T("История начислений и покупок")) }),
        R.row({ a: "earn", ic: SI.starF, c: "y", t: esc(T("Заработать звёзды")), s: esc(T("Сервисы, которые начисляют звёзды")) }),
        R.row({ a: "prem", ic: SI.starF, c: "pr", t: esc(T(NAME_PREMIUM)), s: esc(T("Потратить звёзды на подписку")) }))}
      ${R.hint(esc(T("Звёзды — внутренняя валюта приложения. Ими можно оплатить Premium.")))}`);
  },
  starStat(parent) {
    const pg = Pg.open({ title: T("Статистика"), build: (pg) => {
      const tx = (parent.data && parent.data.tx) || [];
      const inc = tx.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0), out = tx.filter((x) => x.amount < 0).reduce((s, x) => s - x.amount, 0);
      pg.set(`<div class="card2 stat2"><div><b class="up">+${inc}</b><small>${esc(T("Получено"))}</small></div><div><b>−${out}</b><small>${esc(T("Потрачено"))}</small></div></div>
        ${tx.length ? `${R.lbl(esc(T("Операции")))}${R.card(...tx.map((x) => R.row({ ic: x.amount > 0 ? SI.up : SI.down, c: x.amount > 0 ? "g" : "o", t: esc(x.title), s: esc(fmtDate(x.ts) + ", " + fmtTime(x.ts)), r: `<span class="${x.amount > 0 ? "plus" : ""}">${x.amount > 0 ? "+" : "−"}${Math.abs(x.amount)} ★</span>`, chev: false })))}`
          : `<div class="pf-empty"><div class="pf-eic">${SI.stats}</div><h3>${esc(T("Операций пока нет"))}</h3><p>${esc(T("Здесь появятся начисления и покупки за звёзды."))}</p></div>`}`);
    } });
  },
  earn() {
    const pg = Pg.open({ title: T("Заработать звёзды"), build: (pg) => {
      pg.set(`${R.hero(SI.starF, "", esc(T("Здесь собраны сервисы, которые начисляют звёзды. Пока доступен только один.")), "slim")}
        ${R.lbl(esc(T("Боты")))}
        <div class="card2 irows"><button class="irow" data-a="bot"><span class="av sys sm">${PLANE}</span><span class="tx"><b>Telegram</b><small>${esc(T("служебные уведомления"))}</small></span><svg class="irow-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></button></div>
        ${R.hint(esc(T("Новые сервисы появятся позже.")))}`);
    } });
    pg.on = {
      bot: async () => {
        try {
          let peer = (Chats.list.find((c) => c.peer.is_system) || {}).peer;
          if (!peer) peer = (await api("/api/user/1")).user;
          while (Nav.stack.length) { Nav.pop(); }       // закрываем настройки и открываем чат
          history.go(-(history.state && history.state.n ? history.state.n : 0));
          setTimeout(() => { App.go("chats"); Chat.open(peer); }, 60);
        } catch (e) { toast(e.message); }
      },
    };
  },

  // ═════════════ ОТПРАВИТЬ ПОДАРОК ═════════════
  gift() {
    const pg = Pg.open({ title: T("Отправить подарок"), data: { q: "" }, build: (pg) => {
      const q = (pg.data.q || "").toLowerCase();
      const list = Chats.list.filter((c) => !c.peer.is_system && (!q || (dispName(c.peer) + " " + (c.peer.username || "")).toLowerCase().includes(q)));
      pg.set(`<label class="search g-s">${SI.search}<input id="g-q" data-i="q" placeholder="${esc(T("Поиск"))}" value="${esc(pg.data.q || "")}" autocomplete="off"></label>
        ${list.length ? `${R.lbl(esc(T("Выберите получателя")))}<div class="card2 irows">${list.map((c) => `<button class="irow" data-a="to" data-v="${c.peer.id}">${Stories.av(c.peer, "sm")}<span class="tx"><b>${nameHTML(c.peer)}</b><small>${esc(statusText(c.peer))}</small></span></button>`).join("")}</div>`
          : `<div class="empty">${PI.gift}<h3>${esc(T(q ? "Никого не нашли" : "Пока не с кем"))}</h3><p>${esc(T("Подарки можно отправлять тем, с кем вы переписываетесь."))}</p></div>`}`);
      const i = pg.$("#g-q"); if (i && q) { i.focus(); i.setSelectionRange(q.length, q.length); }
    } });
    pg.on = {
      q: (v) => { pg.data.q = v; pg.refresh(); },
      to: () => UI.sheet({ title: T("Подарки в разработке"), icon: PI.gift, text: T("Скоро здесь можно будет дарить подарки друзьям. Раздел в разработке."), actions: [], cancel: T("Понятно") }),
    };
  },

  // ═════════════ ДЛЯ БИЗНЕСА ═════════════
  biz() {
    const pg = Pg.open({ title: T(NAME_BIZ), data: { b: null }, build: (pg) => Settings.drawBiz(pg) });
    const need = () => Settings.needPremium();
    const guard = (f) => () => (App.user.premium ? f() : need());
    pg.on = {
      get: () => Settings.needPremium(),
      addr: guard(() => Settings.bizAddress(pg)), hours: guard(() => Settings.bizHours(pg)), quick: guard(() => Settings.bizQuick(pg)),
      greet: guard(() => Settings.bizAuto(pg, "greeting")), away: guard(() => Settings.bizAuto(pg, "away")),
      links: guard(() => Settings.bizLinks(pg)), intro: guard(() => Settings.bizIntro(pg)),
      soon: () => UI.sheet({ title: T("Чат-боты"), icon: SI.bot, text: T("Подключение чат-ботов появится позже."), actions: [], cancel: T("Понятно") }),
    };
    Settings.loadBiz(pg);
  },
  async needPremium() {
    const v = await UI.sheet({ title: T("Нужен Premium"), icon: SI.starF, text: T("Инструменты для бизнеса доступны с подпиской Premium."), actions: [{ label: T("Открыть Premium"), value: "p", accent: true }], cancel: T("Не сейчас") });
    if (v === "p") Settings.premium();
  },
  async loadBiz(pg) {
    try { const d = await api("/api/biz/me"); pg.data = { b: d.biz || {}, links: d.links || [], premium: d.premium }; } catch (e) { pg.data = { b: {}, links: [], err: e.message }; }
    if (pg.alive) Settings.drawBiz(pg);
  },
  drawBiz(pg) {
    const u = App.user, prem = !!u.premium, b = pg.data.b || {};
    const lock = prem ? {} : { dis: 0, r: SI.lock.replace("<svg ", '<svg class="lk-i" ') };
    const row = (o) => R.row(Object.assign({}, o, prem ? {} : { r: SI.lock.replace("<svg ", '<svg class="lk-i" ') }));
    const hrs = b.hours && b.hours.on ? T("Включён") : T("Выкл.");
    pg.set(`
      ${prem ? R.hero(SI.bag, esc(T(NAME_BIZ)), esc(T("Покажите клиентам, где вы находитесь и когда отвечаете, и автоматизируйте первые сообщения.")), "slim")
             : `<div class="biz-lock"><div class="biz-lock-ic">${SI.lock}</div><h3>${esc(T("Доступно с Premium"))}</h3><p>${esc(T("Оформите подписку, чтобы пользоваться инструментами для бизнеса."))}</p><button class="pbtn sm" data-a="get">${esc(T("Открыть Premium"))}</button></div>`}
      ${R.card(
        row({ a: "addr", ic: SI.pin, c: "r", t: esc(T("Местоположение")), s: b.address ? esc(b.address) : "" }),
        row({ a: "hours", ic: SI.clock, c: "o", t: esc(T("Часы работы")), s: esc(hrs) }),
        row({ a: "quick", ic: SI.reply, c: "g", t: esc(T("Быстрые ответы")), s: esc((b.quick || []).length ? T("{0} " + plural((b.quick || []).length, "ответ", "ответа", "ответов"), (b.quick || []).length) : T("Сохраните частые ответы и отправляйте их по «/»")) }))}
      ${R.card(
        row({ a: "greet", ic: SI.chat, c: "b", t: esc(T("Приветственное сообщение")), s: esc(b.greeting && b.greeting.on ? T("Включено") : T("Выкл.")) }),
        row({ a: "away", ic: SI.moon, c: "v", t: esc(T("Автоответ")), s: esc(b.away && b.away.on ? T("Включён") : T("Выкл.")) }),
        row({ a: "intro", ic: SI.info, c: "t", t: esc(T("Вводный экран")), s: esc((b.intro && (b.intro.title || b.intro.text)) ? esc(b.intro.title || b.intro.text) : T("Что видит собеседник в новом чате")) }))}
      ${R.card(
        row({ a: "links", ic: SI.link, c: "p", t: esc(T("Ссылки на чат")), s: esc((pg.data.links || []).length ? T("{0} " + plural(pg.data.links.length, "ссылка", "ссылки", "ссылок"), pg.data.links.length) : T("Ссылки, по которым люди пишут вам сами")) }),
        R.row({ a: "soon", ic: SI.bot, c: "y2", t: esc(T("Чат-боты")), soon: 1 }))}
      ${prem ? R.hint(esc(T("Эти данные видны в вашем профиле и в чате с вами только пока активен Premium."))) : ""}`);
  },

  async bizSave(section, data) {
    try { const d = await api("/api/biz/save", { method: "POST", body: { section, data } }); return d.biz; }
    catch (e) { toast(e.message); return null; }
  },

  bizAddress(parent) {
    const pg = Pg.open({ title: T("Местоположение"), data: { v: parent.data.b.address || "" }, right: `<button class="ed-ok" data-a="save" aria-label="${esc(T("Сохранить"))}">${SI.check}</button>`,
      build: (pg) => pg.set(`${R.hero(SI.pin, "", esc(T("Укажите адрес, и он появится в вашем профиле.")), "slim")}
        <div class="card2 fields"><textarea id="ba" rows="3" maxlength="200" placeholder="${esc(T("Адрес"))}" data-i="v">${esc(pg.data.v)}</textarea></div>`) });
    pg.on = { v: (v) => { pg.data.v = v; }, save: async () => { const b = await Settings.bizSave("address", pg.data.v.trim()); if (b) { parent.data.b = b; parent.refresh(); pg.close(); toast(T("Сохранено")); } } };
  },

  bizHours(parent) {
    const h = parent.data.b.hours || {}, names = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
    const hm = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
    const days = names.map((_, i) => { const iv = h.days && h.days[String(i)] && h.days[String(i)][0]; return iv ? { on: 1, f: hm(iv[0]), t: hm(iv[1]) } : { on: h.days ? 0 : i < 5 ? 1 : 0, f: "09:00", t: "18:00" }; });
    const pg = Pg.open({ title: T("Часы работы"), data: { on: !!h.on, days }, right: `<button class="ed-ok" data-a="save" aria-label="${esc(T("Сохранить"))}">${SI.check}</button>`,
      build: (pg) => {
        const d = pg.data;
        pg.set(`${R.card(R.row({ a: "on", ic: SI.clock, c: "o", t: esc(T("Показывать часы работы")), sw: 1, on: d.on }))}
          ${d.on ? `${R.lbl(esc(T("Дни недели")))}<div class="card2 irows">${names.map((n, i) => `<div class="irow dayrow"><button class="dsw" data-a="day" data-v="${i}"><span class="sw${d.days[i].on ? " on" : ""}"><i></i></span></button><span class="tx"><b>${esc(T(n))}</b></span>
            ${d.days[i].on ? `<input type="time" data-c="f${i}" value="${d.days[i].f}"><em>–</em><input type="time" data-c="t${i}" value="${d.days[i].t}">` : `<em class="irow-v">${esc(T("Выходной"))}</em>`}</div>`).join("")}</div>
            ${R.hint(esc(T("Время указывается по вашему часовому поясу.")))}` : ""}`);
      } });
    pg.on = {
      on: (on) => { pg.data.on = !!on; pg.refresh(); },
      day: (el) => { const d = pg.data.days[+el.dataset.v]; d.on = d.on ? 0 : 1; pg.refresh(); },
      save: async () => {
        const d = pg.data, out = {};
        for (let i = 0; i < 7; i++) {
          const x = d.days[i]; if (!x.on) { out[String(i)] = []; continue; }
          const [fh, fm] = x.f.split(":").map(Number), [th, tm] = x.t.split(":").map(Number), a = fh * 60 + fm, b = th * 60 + tm;
          if (!(a < b)) return toast(T("{0}: конец должен быть позже начала", T(names[i])));
          out[String(i)] = [[a, b]];
        }
        const b = await Settings.bizSave("hours", { on: d.on, tz: -new Date().getTimezoneOffset(), days: out });
        if (b) { parent.data.b = b; parent.refresh(); pg.close(); toast(T("Сохранено")); }
      },
    };
    pg.el.addEventListener("change", (e) => { const c = e.target.dataset.c; if (!c) return; const i = +c.slice(1); pg.data.days[i][c[0]] = e.target.value; });
  },

  bizQuick(parent) {
    const pg = Pg.open({ title: T("Быстрые ответы"), build: (pg) => {
      const q = parent.data.b.quick || [];
      pg.set(`${R.hero(SI.reply, "", esc(T("Сохраните частые ответы и отправляйте их в чате: напишите «/» и выберите нужный.")), "slim")}
        ${R.card(R.row({ a: "add", ic: SI.plus, c: "b", t: esc(T("Новый быстрый ответ")), chev: false }), ...q.map((x) => R.row({ a: "edit", v: x.id, ic: SI.reply, c: "g", t: "/" + esc(x.name), s: esc(x.text.slice(0, 60)) })))}`);
    } });
    pg.on = { add: () => Settings.bizQuickEdit(null, parent, pg), edit: (el) => Settings.bizQuickEdit((parent.data.b.quick || []).find((x) => x.id === el.dataset.v), parent, pg) };
  },
  bizQuickEdit(item, bizPg, list) {
    const pg = Pg.open({ title: item ? T("Быстрый ответ") : T("Новый быстрый ответ"), data: { n: item ? item.name : "", t: item ? item.text : "" },
      right: `<button class="ed-ok" data-a="save" aria-label="${esc(T("Сохранить"))}">${SI.check}</button>`,
      build: (pg) => pg.set(`${R.lbl(esc(T("Сокращение")))}<div class="card2 fields"><input id="qn" maxlength="24" placeholder="${esc(T("например, price"))}" value="${esc(pg.data.n)}" data-i="n" autocapitalize="off" autocomplete="off" spellcheck="false"></div>
        ${R.hint(esc(T("Латиница, цифры и _. Вводится после «/».")))}
        ${R.lbl(esc(T("Текст")))}<div class="card2 fields"><textarea id="qt" rows="5" maxlength="1000" placeholder="${esc(T("Текст сообщения"))}" data-i="t">${esc(pg.data.t)}</textarea></div>
        ${item ? R.card(R.row({ a: "del", ic: SI.trash, c: "r", t: esc(T("Удалить")), danger: 1, chev: false })) : ""}`) });
    const put = async (arr) => { const b = await Settings.bizSave("quick", arr); if (b) { Chat.quick = b.quick || []; bizPg.data.b = b; bizPg.refresh(); list.refresh(); pg.close(); return true; } };
    pg.on = {
      n: (v) => { pg.data.n = v; }, t: (v) => { pg.data.t = v; },
      save: async () => {
        const n = pg.data.n.trim().replace(/^\//, ""), t = pg.data.t.trim();
        if (!/^[A-Za-z0-9_]{1,24}$/.test(n)) return toast(T("Сокращение: латиница, цифры и _"));
        if (!t) return toast(T("Введите текст"));
        const q = (bizPg.data.b.quick || []).filter((x) => !item || x.id !== item.id);
        if (q.some((x) => x.name.toLowerCase() === n.toLowerCase())) return toast(T("Такое сокращение уже есть"));
        q.push(item ? { id: item.id, name: n, text: t } : { name: n, text: t });
        await put(q);
      },
      del: async () => { if (await ask(T("Удалить быстрый ответ?"), T("Удалить"))) put((bizPg.data.b.quick || []).filter((x) => x.id !== item.id)); },
    };
  },

  bizAuto(parent, kind) {
    const cur = parent.data.b[kind] || {}, away = kind === "away";
    const pg = Pg.open({ title: T(away ? "Автоответ" : "Приветственное сообщение"), data: { on: !!cur.on, text: cur.text || "", days: cur.days || 7, mode: cur.mode || "always" },
      right: `<button class="ed-ok" data-a="save" aria-label="${esc(T("Сохранить"))}">${SI.check}</button>`,
      build: (pg) => {
        const d = pg.data, hasHours = !!(parent.data.b.hours && parent.data.b.hours.on);
        pg.set(`${R.hero(away ? SI.moon : SI.chat, "", esc(T(away ? "Отвечайте автоматически, когда вас нет на месте." : "Автоматически здоровайтесь с теми, кто пишет вам впервые.")), "slim")}
          ${R.card(R.row({ a: "on", ic: away ? SI.moon : SI.chat, c: away ? "v" : "b", t: esc(T(away ? "Отправлять автоответ" : "Отправлять приветствие")), sw: 1, on: d.on }))}
          ${R.lbl(esc(T("Сообщение")))}<div class="card2 fields"><textarea rows="5" maxlength="1000" placeholder="${esc(T("Текст сообщения"))}" data-i="text">${esc(d.text)}</textarea></div>
          ${away ? `${R.lbl(esc(T("Когда отправлять")))}${R.opts([{ v: "always", t: esc(T("Всегда")) }, { v: "outside", t: esc(T("Вне рабочего времени")), s: hasHours ? "" : esc(T("Сначала включите часы работы")) }], d.mode, "mode")}`
                 : `${R.lbl(esc(T("Не отправлять тем, кто писал вам за последние…")))}<div class="card2"><div class="seg">${[7, 14, 21, 28].map((n) => `<button class="${d.days === n ? "on" : ""}" data-a="days" data-v="${n}">${n} ${esc(T("дн."))}</button>`).join("")}</div></div>`}`);
      } });
    pg.on = {
      on: (on) => { pg.data.on = !!on; }, text: (v) => { pg.data.text = v; },
      mode: (el) => { if (el.dataset.v === "outside" && !(parent.data.b.hours && parent.data.b.hours.on)) return toast(T("Сначала включите часы работы")); pg.data.mode = el.dataset.v; pg.refresh(); },
      days: (el) => { pg.data.days = +el.dataset.v; pg.refresh(); },
      save: async () => {
        const d = pg.data; if (d.on && !d.text.trim()) return toast(T("Введите текст сообщения"));
        const b = await Settings.bizSave(kind, away ? { on: d.on, text: d.text, mode: d.mode } : { on: d.on, text: d.text, days: d.days });
        if (b) { parent.data.b = b; parent.refresh(); pg.close(); toast(T("Сохранено")); }
      },
    };
  },

  bizIntro(parent) {
    const cur = parent.data.b.intro || {};
    const pg = Pg.open({ title: T("Вводный экран"), data: { title: cur.title || "", text: cur.text || "", emoji: cur.emoji || "" },
      right: `<button class="ed-ok" data-a="save" aria-label="${esc(T("Сохранить"))}">${SI.check}</button>`,
      build: (pg) => {
        const d = pg.data;
        pg.set(`${R.hero(SI.info, "", esc(T("Это увидит человек, открыв пустой чат с вами.")), "slim")}
          <div class="intro-pv"><div class="intro-e">${esc(d.emoji || "👋")}</div><b>${esc(d.title || T("Заголовок"))}</b><span>${esc(d.text || T("Короткое описание"))}</span></div>
          ${R.lbl(esc(T("Заголовок")))}<div class="card2 fields"><input maxlength="32" placeholder="${esc(T("Заголовок"))}" value="${esc(d.title)}" data-i="title"></div>
          ${R.lbl(esc(T("Описание")))}<div class="card2 fields"><input maxlength="70" placeholder="${esc(T("Описание"))}" value="${esc(d.text)}" data-i="text"></div>
          ${R.lbl(esc(T("Эмодзи")))}<div class="card2 fields"><input maxlength="8" placeholder="👋" value="${esc(d.emoji)}" data-i="emoji"></div>`);
      } });
    const upd = () => { const pv = pg.$(".intro-pv"); if (pv) { pv.querySelector(".intro-e").textContent = pg.data.emoji || "👋"; pv.querySelector("b").textContent = pg.data.title || T("Заголовок"); pv.querySelector("span").textContent = pg.data.text || T("Короткое описание"); } };
    pg.on = {
      title: (v) => { pg.data.title = v; upd(); }, text: (v) => { pg.data.text = v; upd(); }, emoji: (v) => { pg.data.emoji = v; upd(); },
      save: async () => { const b = await Settings.bizSave("intro", pg.data); if (b) { parent.data.b = b; parent.refresh(); pg.close(); toast(T("Сохранено")); } },
    };
  },

  bizLinks(parent) {
    const base = () => location.origin + location.pathname + "#c=";
    const pg = Pg.open({ title: T("Ссылки на чат"), build: (pg) => {
      const l = parent.data.links || [];
      pg.set(`${R.hero(SI.link, "", esc(T("Поделитесь ссылкой — человек откроет чат с вами, а в поле сообщения уже будет готовый текст.")), "slim")}
        ${R.card(R.row({ a: "new", ic: SI.plus, c: "b", t: esc(T("Создать ссылку")), chev: false }), ...l.map((x) => R.row({ a: "one", v: x.slug, ic: SI.link, c: "p", t: esc(x.title || "#c=" + x.slug), s: esc(T("Переходов: {0}", x.uses || 0)) })))}`);
    } });
    pg.on = {
      new: () => Settings.bizLinkNew(parent, pg),
      one: async (el) => {
        const x = (parent.data.links || []).find((q) => q.slug === el.dataset.v); if (!x) return;
        const url = base() + x.slug;
        const v = await UI.sheet({ title: x.title || x.slug, text: url, actions: [{ label: T("Скопировать ссылку"), value: "c", accent: true }, { label: T("Удалить"), value: "d", danger: true }] });
        if (v === "c") { copyText(url); toast(T("Ссылка скопирована")); }
        else if (v === "d") {
          try { const d = await api("/api/biz/link/delete", { method: "POST", body: { slug: x.slug } }); parent.data.links = d.links; parent.refresh(); pg.refresh(); } catch (e) { toast(e.message); }
        }
      },
    };
  },
  bizLinkNew(parent, list) {
    const pg = Pg.open({ title: T("Новая ссылка"), data: { title: "", text: "", slug: "" }, right: `<button class="ed-ok" data-a="save" aria-label="${esc(T("Создать"))}">${SI.check}</button>`,
      build: (pg) => pg.set(`${R.lbl(esc(T("Название (видите только вы)")))}<div class="card2 fields"><input maxlength="40" value="${esc(pg.data.title)}" placeholder="${esc(T("Название"))}" data-i="title"></div>
        ${R.lbl(esc(T("Текст в поле сообщения")))}<div class="card2 fields"><textarea rows="4" maxlength="500" placeholder="${esc(T("Здравствуйте! Хочу узнать…"))}" data-i="text">${esc(pg.data.text)}</textarea></div>
        ${R.lbl(esc(T("Адрес ссылки (необязательно)")))}<div class="card2 fields"><input maxlength="32" value="${esc(pg.data.slug)}" placeholder="shop_1" autocapitalize="off" autocomplete="off" data-i="slug"></div>
        ${R.hint(esc(T("Латиница, цифры и _, от 4 до 32 символов. Если оставить пустым, адрес создастся сам.")))}`) });
    pg.on = {
      title: (v) => { pg.data.title = v; }, text: (v) => { pg.data.text = v; }, slug: (v) => { pg.data.slug = v; },
      save: async () => {
        const d = pg.data;
        try {
          const r = await api("/api/biz/link", { method: "POST", body: { title: d.title.trim(), text: d.text.trim(), slug: d.slug.trim() } });
          parent.data.links = r.links; parent.refresh(); list.refresh(); pg.close(); toast(T("Ссылка создана"));
        } catch (e) { toast(e.message); }
      },
    };
  },

  // ═════════════ ЗАДАТЬ ВОПРОС (бот поддержки) ═════════════
  async ask() {
    const v = await UI.sheet({ title: T("Задать вопрос"), icon: SI.headset, text: T("Бот поддержки подскажет ответы на частые вопросы. Если ответа нет, вы сможете отправить свой вопрос команде."),
      actions: [{ label: T("Задать вопрос"), value: true, accent: true }], cancel: T("Отмена") });
    if (!v) return;
    Settings.support();
  },
  support() {
    const KB = [["Не приходит код", "Код приходит в чат с ботом в Telegram. Откройте бота, нажмите /start и запросите код заново. Если бот был заблокирован, разблокируйте его."],
      ["Как войти на другом устройстве", "Введите свой номер +888… и код из бота. Если включён облачный пароль, понадобится и он."],
      ["Забыл облачный пароль", "Сбросить облачный пароль самостоятельно нельзя. Нажмите «Другой вопрос» и опишите ситуацию — обращение рассмотрит команда."],
      ["Как скрыть номер", "Откройте Настройки → Конфиденциальность → Номер телефона и выберите, кто может его видеть."],
      ["О Premium и звёздах", "Premium стоит 1000 ★ в год или 160 ★ в месяц. Баланс — в Настройки → Звёзды. Пополнение баланса пока недоступно."]];
    const hello = () => [{ w: "bot", t: T("Здравствуйте! Я помощник поддержки. Выберите тему ниже или нажмите «Другой вопрос», чтобы написать свой.") }];
    const saved = Prefs.get("sup_log", []);
    const pg = Pg.open({ title: T("Поддержка"), cls: "sup", data: { log: saved.length ? saved : hello() }, build: (pg) => Settings.drawSupport(pg, KB) });
    const add = (w, t) => { pg.data.log.push({ w, t }); pg.data.log = pg.data.log.slice(-40); Prefs.set("sup_log", pg.data.log); Settings.drawSupport(pg, KB, true); };
    pg.on = {
      kb: (el) => { const i = +el.dataset.v; add("me", T(KB[i][0])); setTimeout(() => add("bot", T(KB[i][1])), 350); },
      other: () => { pg.data.write = true; add("me", T("Другой вопрос")); setTimeout(() => { add("bot", T("Напишите свой вопрос одним сообщением — я передам его команде.")); const i = pg.$("#sup-in"); if (i) i.focus(); }, 350); },
      send: async () => {
        const i = pg.$("#sup-in"), t = i.value.trim(); if (!t) return;
        i.value = ""; add("me", t);
        try { await api("/api/support", { method: "POST", body: { text: t } }); setTimeout(() => add("bot", T("Спасибо! Ваш вопрос передан команде поддержки.")), 350); }
        catch (e) { setTimeout(() => add("bot", T("Не получилось отправить: {0}", e.message)), 350); }
      },
      clear: () => { Prefs.del("sup_log"); pg.data.log = hello(); Settings.drawSupport(pg, KB); },
    };
    pg.el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "sup-in") { e.preventDefault(); pg.on.send(); } });
  },
  drawSupport(pg, KB, keep) {
    const log = pg.data.log;
    pg.set(`<div class="sup-wrap"><div class="sup-msgs" id="sup-msgs"><div class="sup-who"><span class="av sys">${SI.headset}</span><b>${esc(T("Поддержка"))}</b><small>${esc(T("бот"))}</small></div>
      ${log.map((m) => `<div class="b ${m.w === "me" ? "out" : "in"}" data-nt="1">${esc(m.t)}</div>`).join("")}</div>
      <div class="sup-kb">${KB.map((k, i) => `<button data-a="kb" data-v="${i}">${esc(T(k[0]))}</button>`).join("")}<button data-a="other" class="o">${esc(T("Другой вопрос"))}</button></div>
      <div class="sup-in"><input id="sup-in" placeholder="${esc(T("Сообщение"))}" maxlength="2000" autocomplete="off"><button data-a="send" aria-label="${esc(T("Отправить"))}">${SI.up}</button></div></div>`);
    const m = pg.$("#sup-msgs"); if (m) m.scrollTop = m.scrollHeight;
  },

  // ═════════════ ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ ═════════════
  policy() {
    const S = [
      ["Какие данные мы храним", "Номер телефона, имя, фамилию, @username, фото профиля, дату рождения и «О себе» — то, что вы указали сами. Сообщения хранятся на сервере в зашифрованном виде, файлы — в защищённом хранилище."],
      ["Кто видит ваши данные", "Другие пользователи видят только то, что вы разрешили в разделе «Конфиденциальность»: номер, время захода, фото, «О себе», день рождения."],
      ["Что мы не делаем", "Мы не продаём ваши данные, не показываем рекламу и не передаём личную переписку третьим лицам."],
      ["Устройства и сеансы", "Список устройств, где выполнен вход, виден в разделе «Устройства». Любой сеанс можно завершить в один клик."],
      ["Хранение на устройстве", "Настройки, обои, кэш фото и файлов хранятся в вашем браузере. Очистить их можно в разделе «Данные и память»."],
      ["Удаление", "Вы можете удалять свои сообщения и публикации. Автоудаление в «Конфиденциальности» делает это само. Чтобы удалить аккаунт, напишите в поддержку."],
    ];
    Pg.open({ title: T("Политика конфиденциальности"), build: (pg) => {
      pg.set(`<div class="policy"><p class="pol-lead">${esc(T("Коротко о том, как мы обращаемся с вашими данными."))}</p>
        ${S.map(([h, t]) => `<h3>${esc(T(h))}</h3><p>${esc(T(t))}</p>`).join("")}<p class="pol-end">${esc(T("Последнее обновление: ноябрь 2026"))}</p></div>`);
    } });
  },
});
