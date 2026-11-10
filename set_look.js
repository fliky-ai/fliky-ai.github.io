// set_look.js — «Настройки чатов» (тема, цвет, обои, размер текста, скругление, ночной режим, браузер, стикеры, медиа),
// «Язык», «Энергосбережение».

const QUICK_REACTIONS = ["❤️", "👍", "😂", "🔥", "😮", "😢", "🎉", "👎"];

// предпросмотр чата: те же пузыри и обои, что в настоящем чате
const previewChat = () => `<div class="pvc"><div class="pvc-in"><span class="day">${esc(T("Сегодня"))}</span>
  <div class="b in">${esc(T("Привет! Как тебе новая тема?"))}<span class="t">12:41</span></div>
  <div class="b out">${esc(T("Выглядит отлично!"))}<span class="t">12:42 ✓✓</span></div>
  <div class="b in">${esc(T("Размер текста можно менять ползунком ниже"))}<span class="t">12:42</span></div></div></div>`;

Object.assign(Settings, {
  // ─────────── Настройки чатов ───────────
  chats() {
    const pg = Pg.open({ title: T("Настройки чатов"), build: (pg) => Settings.drawChats(pg) });
    pg.on = {
      mode: (el) => { Theme.set(el.dataset.v); Settings.drawChats(pg); },
      acc: (el) => { Prefs.set("acc", el.dataset.v); Theme.apply(true); Settings.drawChats(pg); },
      wall: () => Settings.wallpaper(),
      night: () => Settings.night(),
      fs: (v) => { Prefs.set("fs", v); Theme.apply(); const n = pg.$("#fs-n"); if (n) n.textContent = v; },
      br: (v) => { Prefs.set("br", v); Theme.apply(); const n = pg.$("#br-n"); if (n) n.textContent = v; },
      browser: (on) => Prefs.set("browser", !!on),
      anim: (on) => { Prefs.set("anim", !!on); Settings.applyAnim(); },
      stick: () => Settings.stick(),
      media: () => Settings.media(),
      appicon: () => AppIcon.open(),
      reset: () => { ["fs", "br", "acc", "wp", "wppat", "wpdim"].forEach((k) => Prefs.del(k)); try { localStorage.removeItem("pf_wpimg"); } catch (e) {} Theme.apply(true); Settings.drawChats(pg); toast(T("Оформление сброшено")); },
    };
    return pg;
  },

  drawChats(pg) {
    const th = Theme.get(), acc = Prefs.get("acc", "blue"), night = Theme.night();
    const nightTxt = night === "off" ? T("Выкл.") : night === "auto" ? T("Как в системе") : `${Theme.sched().from} – ${Theme.sched().to}`;
    const mode = (k, ic, t) => `<button class="mode${th === k ? " on" : ""}" data-a="mode" data-v="${k}">${ic}<span>${esc(t)}</span></button>`;
    pg.set(`
      ${previewChat()}
      ${R.lbl(esc(T("Тема")))}
      <div class="card2 modes">${mode("auto", SI.phone2, T("Авто"))}${mode("light", SI.sun, T("Светлая"))}${mode("dark", SI.moon, T("Тёмная"))}</div>
      ${R.lbl(esc(T("Цвет")))}
      <div class="card2 accs">${ACCENTS.map((a) => `<button class="acd${acc === a.k ? " on" : ""}" data-a="acc" data-v="${a.k}" style="--c:${a.c}" aria-label="${esc(T(a.n))}">${SI.check}</button>`).join("")}</div>
      ${R.card(R.row({ a: "wall", ic: SI.image, c: "b", t: esc(T("Изменить обои")) }))}
      ${R.lbl(esc(T("Размер текста")))}
      <div class="card2 rng-card"><div class="rng-h"><span class="aa s">Aa</span><b id="fs-n">${Theme.fs()}</b><span class="aa l">Aa</span></div>${R.range({ s: "fs", min: 12, max: 26, val: Theme.fs(), label: T("Размер текста") })}</div>
      ${R.lbl(esc(T("Скругление сообщений")))}
      <div class="card2 rng-card"><div class="rng-h"><span class="sq s"></span><b id="br-n">${Theme.br()}</b><span class="sq l"></span></div>${R.range({ s: "br", min: 0, max: 22, val: Theme.br(), label: T("Скругление сообщений") })}</div>
      ${R.lbl(esc(T("Ночной режим")))}
      ${R.card(R.row({ a: "night", ic: SI.moon, c: "i", t: esc(T("Автоматический ночной режим")), r: esc(nightTxt) }))}
      ${R.hint(esc(T("Тёмная тема включается сама ночью — по расписанию или по настройкам телефона.")))}
      ${R.lbl(esc(T("Ещё")))}
      ${R.card(
        R.row({ a: "browser", ic: SI.compass, c: "b", t: esc(T("Встроенный браузер")), s: esc(T("Открывать ссылки внутри приложения")), sw: 1, on: Prefs.get("browser", false) }),
        R.row({ a: "anim", ic: SI.zap, c: "o", t: esc(T("Анимации интерфейса")), sw: 1, on: Prefs.get("anim", true) }),
        R.row({ a: "stick", ic: SI.smile, c: "y2", t: esc(T("Стикеры и эмодзи")) }),
        R.row({ a: "media", ic: SI.mic, c: "g", t: esc(T("Медиа и звук")) }),
        typeof AppIcon !== "undefined" && AppIcon.inApp() ? R.row({ a: "appicon", ic: SI.palette, c: "pr", t: esc(T("Иконка приложения")), s: esc(T("Значки для Premium")), r: esc(T(AppIcon.info(AppIcon.cur()).n)) }) : "")}
      <div class="gap-s"></div>
      ${R.card(R.row({ a: "reset", ic: SI.shuffle, c: "gr", t: esc(T("Сбросить оформление")), chev: false }))}`);
  },

  applyAnim() { document.documentElement.classList.toggle("eco-anim", !Prefs.get("anim", true) || Energy.is("anim")); },

  // ─────────── обои ───────────
  wallpaper() {
    const pg = Pg.open({ title: T("Обои чата"), build: (pg) => Settings.drawWall(pg) });
    pg.on = {
      wp: (el) => { Prefs.set("wp", el.dataset.v); Wall.apply(); Settings.drawWall(pg); },
      pat: (on) => { Prefs.set("wppat", !!on); Wall.apply(); },
      dim: (v) => { Prefs.set("wpdim", v); Wall.apply(); const n = pg.$("#dim-n"); if (n) n.textContent = v + "%"; },
      gal: async () => {
        const f = (await Attach.pick("image/*", false))[0]; if (!f) return;
        if (!/^image\//.test(f.type)) return toast(T("Выберите фото"));
        try { await Wall.setPhoto(f); Settings.drawWall(pg); toast(T("Обои установлены")); } catch (e) { toast(e.message); }
      },
    };
  },

  drawWall(pg) {
    const cur = Wall.cur(), dark = document.documentElement.dataset.theme !== "light", img = Wall.img();
    const tile = (w) => {
      const st = w.plain ? "background:var(--bg)" : w.k === "def" ? "background:" + Wall.grad({ l: WALLS[0].l, d: WALLS[0].d, a: 160 }, dark) : "background:" + Wall.grad(w, dark);
      return `<button class="wpt${cur === w.k ? " on" : ""}" data-a="wp" data-v="${w.k}" style="${st}" aria-label="${esc(T(w.n))}"><span>${esc(T(w.n))}</span>${SI.check}</button>`;
    };
    pg.set(`
      ${previewChat()}
      <div class="wps">${WALLS.map(tile).join("")}
        ${img ? `<button class="wpt${cur === "img" ? " on" : ""}" data-a="wp" data-v="img" style="background:center/cover url('${img}')"><span>${esc(T("Моё фото"))}</span>${SI.check}</button>` : ""}</div>
      ${R.card(R.row({ a: "gal", ic: SI.image, c: "b", t: esc(T("Выбрать из галереи")), chev: false }))}
      ${R.lbl(esc(T("Дополнительно")))}
      ${R.card(R.row({ a: "pat", ic: SI.layers, c: "v", t: esc(T("Узор на обоях")), sw: 1, on: Prefs.get("wppat", true) && cur !== "img" && cur !== "plain" }))}
      ${R.lbl(esc(T("Затемнение")))}
      <div class="card2 rng-card"><div class="rng-h"><span class="dimdot l"></span><b id="dim-n">${Prefs.get("wpdim", 0)}%</b><span class="dimdot d"></span></div>${R.range({ s: "dim", min: 0, max: 70, step: 5, val: +Prefs.get("wpdim", 0), label: T("Затемнение") })}</div>
      ${R.hint(esc(T("Обои видны только вам и хранятся на этом устройстве.")))}`);
  },

  // ─────────── ночной режим ───────────
  night() {
    const pg = Pg.open({ title: T("Ночной режим"), build: (pg) => Settings.drawNight(pg) });
    pg.on = {
      nm: (el) => { Theme.setNight(el.dataset.v); Settings.drawNight(pg); },
      from: (v) => { if (v) { Prefs.set("night_from", v); Theme.apply(true); } },
      to: (v) => { if (v) { Prefs.set("night_to", v); Theme.apply(true); } },
    };
  },
  drawNight(pg) {
    const n = Theme.night(), s = Theme.sched();
    pg.set(`
      ${R.hero(SI.moon, esc(T("Автоматический ночной режим")), esc(T("Приложение само переключается между светлой и тёмной темой.")), "moon")}
      ${R.opts([{ v: "off", t: esc(T("Выключен")), s: esc(T("Тема выбирается вручную")) }, { v: "sched", t: esc(T("По расписанию")), s: esc(T("Тёмная тема — в выбранные часы")) },
        { v: "auto", t: esc(T("Как в системе")), s: esc(T("Следовать настройкам телефона")) }], n, "nm")}
      ${n === "sched" ? `${R.lbl(esc(T("Расписание")))}
        <div class="card2 irows tpick"><label class="irow"><span class="tx"><b>${esc(T("Включать в"))}</b></span><input type="time" data-c="from" value="${s.from}"></label>
        <label class="irow"><span class="tx"><b>${esc(T("Выключать в"))}</b></span><input type="time" data-c="to" value="${s.to}"></label></div>
        ${R.hint(esc(T("Сейчас: {0}", Theme.inSched() ? T("ночь, тёмная тема") : T("день, светлая тема"))))}` : ""}`);
  },

  // ─────────── стикеры и эмодзи ───────────
  stick() {
    const pg = Pg.open({ title: T("Стикеры и эмодзи"), build: (pg) => Settings.drawStick(pg) });
    pg.on = {
      big: (on) => { Prefs.set("bigemoji", !!on); try { Chat.render(true); } catch (e) {} },
      qr: (el) => { Prefs.set("qr", el.dataset.v); Settings.drawStick(pg); },
      stk: (on) => Prefs.set("suggest", !!on),
    };
  },
  drawStick(pg) {
    const qr = Prefs.get("qr", "❤️");
    pg.set(`
      ${R.card(
        R.row({ a: "big", ic: SI.smile, c: "y2", t: esc(T("Крупные эмодзи")), s: esc(T("Сообщение из одного-трёх эмодзи показывается крупно")), sw: 1, on: Prefs.get("bigemoji", true) }),
        R.row({ a: "stk", ic: SI.layers, c: "p", t: esc(T("Подсказки стикеров")), s: esc(T("Предлагать стикеры по эмодзи")), sw: 1, on: Prefs.get("suggest", true) }))}
      ${R.lbl(esc(T("Быстрая реакция")))}
      <div class="card2 qrs">${QUICK_REACTIONS.map((e) => `<button class="qr${qr === e ? " on" : ""}" data-a="qr" data-v="${e}">${e}</button>`).join("")}</div>
      ${R.hint(esc(T("Эта реакция ставится двойным касанием по сообщению.")))}`);
  },

  // ─────────── медиа и звук ───────────
  media() {
    const pg = Pg.open({ title: T("Медиа и звук"), build: (pg) => Settings.drawMedia(pg) });
    pg.on = {
      gif: (on) => Prefs.set("autogif", !!on),
      vid: (on) => Prefs.set("autovid", !!on),
      pause: (on) => Prefs.set("pauserec", !!on),
      tap: (on) => Prefs.set("tapnav", !!on),
      mic: async () => {
        let devs = [];
        try { devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput"); } catch (e) {}
        const labelled = devs.filter((d) => d.label);
        if (!devs.length) return toast(T("Микрофоны не найдены"));
        if (!labelled.length) {         // без разрешения браузер не называет устройства — спросим один раз
          try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput"); }
          catch (e) { return toast(T("Нет доступа к микрофону")); }
        }
        const cur = Prefs.get("micid", "");
        const v = await UI.sheet({ title: T("Микрофон"), text: T("Какой микрофон использовать для голосовых сообщений."),
          actions: [{ label: T("По умолчанию") + (cur ? "" : "  ✓"), value: "" }].concat(devs.map((d, i) => ({ label: (d.label || T("Микрофон {0}", i + 1)) + (cur === d.deviceId ? "  ✓" : ""), value: d.deviceId }))) });
        if (v === null) return;
        Prefs.set("micid", v); Settings.drawMedia(pg);
      },
    };
  },
  drawMedia(pg) {
    pg.set(`
      ${R.lbl(esc(T("Воспроизведение")))}
      ${R.card(
        R.row({ a: "gif", ic: SI.film, c: "p", t: esc(T("Автозапуск GIF")), sw: 1, on: Prefs.get("autogif", true) }),
        R.row({ a: "vid", ic: SI.vid, c: "b", t: esc(T("Автозапуск видео")), s: esc(T("Видео в чате начинает играть без звука")), sw: 1, on: Prefs.get("autovid", true) }),
        R.row({ a: "tap", ic: SI.cursor, c: "t", t: esc(T("Переключение касанием")), s: esc(T("В публикациях — касание по краям экрана листает дальше или назад")), sw: 1, on: Prefs.get("tapnav", true) }))}
      ${R.lbl(esc(T("Голосовые сообщения")))}
      ${R.card(
        R.row({ a: "mic", ic: SI.mic, c: "r", t: esc(T("Микрофон")), r: Prefs.get("micid", "") ? esc(T("выбран")) : esc(T("по умолчанию")) }),
        R.row({ a: "pause", ic: SI.vol, c: "o", t: esc(T("Ставить аудио на паузу при записи")), sw: 1, on: Prefs.get("pauserec", true) }))}
      ${R.hint(esc(T("Если подключено несколько микрофонов, выберите нужный.")))}`);
  },

  // ─────────── язык ───────────
  lang() {
    const pg = Pg.open({ title: T("Язык"), build: (pg) => {
      pg.set(`${R.opts([{ v: "ru", t: "Русский", s: "Russian" }, { v: "en", t: "English", s: "Английский" }], I18N.lang, "pick")}
        ${R.hint(esc(T("Язык интерфейса. Страница перезагрузится, чтобы всё переключилось сразу.")))}`);
    } });
    pg.on = {
      pick: async (el) => {
        const l = el.dataset.v; if (l === I18N.lang) return;
        I18N.set(l); location.reload();
      },
    };
  },

  // ─────────── энергосбережение ───────────
  energy() {
    const pg = Pg.open({ title: T("Энергосбережение"), build: (pg) => Settings.drawEnergy(pg) });
    Energy.onChange = () => { if (pg.alive) Settings.drawEnergy(pg); };
    pg.on = {
      eco: (v) => {
        Prefs.set("eco", v); Energy.update();
        const t = pg.$("#eco-v"); if (t) t.textContent = Settings.ecoText(v);
        const s = pg.$("#eco-st"); if (s) s.innerHTML = Settings.ecoState();
      },
      tg: (on, el) => { Prefs.set("eco_" + el.dataset.v, !!on); Energy.update(); },
    };
    pg.timer = setInterval(() => { if (!pg.alive) return clearInterval(pg.timer); const s = pg.$("#eco-bat"); if (s) s.innerHTML = Settings.ecoBat(); }, 5000);
  },
  ecoText(v) { return v <= 0 ? T("Выключено") : v >= 100 ? T("Всегда включено") : T("При заряде {0}% и ниже", v); },
  ecoBat() {
    if (!Energy.supported) return esc(T("Заряд батареи недоступен в этом браузере. Режим можно включить вручную — ползунок вправо."));
    const l = Energy.level();
    return `${SI.battery}<b>${l}%</b><span>${esc(Energy.charging() ? T("заряжается") : T("от батареи"))}</span>`;
  },
  ecoState() { return Energy.active ? `<span class="ok">${esc(T("Режим энергосбережения сейчас включён"))}</span>` : `<span>${esc(T("Режим энергосбережения сейчас выключен"))}</span>`; },
  drawEnergy(pg) {
    const v = Energy.thr();
    const t = (k, ic, c, title) => R.row({ a: "tg", v: k, ic, c, t: esc(T(title)), sw: 1, on: Prefs.get("eco_" + k, true) });
    pg.set(`
      <div class="card2 eco-bat" id="eco-bat">${Settings.ecoBat()}</div>
      ${R.lbl(esc(T("Режим энергосбережения")))}
      <div class="card2 rng-card"><div class="rng-h"><span class="dim">${esc(T("Выкл."))}</span><b id="eco-v">${esc(Settings.ecoText(v))}</b><span class="dim">${esc(T("Вкл."))}</span></div>${R.range({ s: "eco", min: 0, max: 100, step: 5, val: v, label: T("Режим энергосбережения") })}</div>
      ${R.hint(esc(T("Включается автоматически, когда заряд батареи опускается до выбранного значения. Если телефон на зарядке — не включается.")))}
      <div class="ed-hint eco-st" id="eco-st">${Settings.ecoState()}</div>
      ${R.lbl(esc(T("Что отключать при экономии")))}
      ${R.card(
        t("vid", SI.vid, "b", "Автозапуск видео"), t("gif", SI.film, "p", "Автозапуск GIF"), t("stk", SI.smile, "y2", "Анимация стикеров"),
        t("anim", SI.zap, "o", "Анимации интерфейса"), t("blur", SI.layers, "v", "Размытие и эффекты"), t("pre", SI.data, "g", "Предзагрузка медиа"))}`);
  },
});
