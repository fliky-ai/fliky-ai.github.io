// appicon.js — «Иконка приложения» (Premium, только в APK).
// Пять значков: «Стандартная» (доступна всем — это сброс) и четыре эксклюзивных для Premium: «Золото», «Неон», «Ночь» и «Официальная+»
// (фирменный знак official.png, слегка изменённый: лёгкая тонировка, блик и золотая звезда).
// Все значки рисуются на лету (canvas) — никаких готовых картинок рядом не хранится; official.png берётся с сайта (тот, что загрузил владелец),
// а если его нет — вместо него рисуется обычный значок.
//
// Как значок попадает на рабочий стол. Сайт сам заменить значок приложения на телефоне не может — это делает только сама сборка APK
// (в ней должны быть «варианты значка» — activity-alias — и мост, который их переключает). Поэтому экран:
//   1) ищет такой мост (WebToApk / AppMint / appmintNative / плагин Capacitor «AppIcon») и, если он есть, просит его сменить значок;
//   2) если моста нет — выбор применяется внутри приложения (значок вкладки и «на главный экран»), а картинку можно сохранить
//      и поставить вручную в настройках лаунчера. Об этом экран говорит прямо, а не делает вид, что всё сработало.
const AppIcon = {
  KEY: "app_icon",
  LIST: [
    { k: "default", n: "Стандартная", s: "Как при установке", free: 1 },
    { k: "gold", n: "Золото", s: "Тёплый золотой блеск" },
    { k: "neon", n: "Неон", s: "Светящийся контур на тёмном фоне" },
    { k: "night", n: "Ночь", s: "Тёмное стекло и звёзды" },
    { k: "official", n: "Официальная+", s: "Фирменный знак с золотой звездой" },
  ],
  cache: new Map(), imgs: new Map(), orig: null,

  info(k) { return AppIcon.LIST.find((x) => x.k === k) || AppIcon.LIST[0]; },
  cur() { const k = Prefs.get(AppIcon.KEY, "default"); return AppIcon.LIST.some((x) => x.k === k) ? k : "default"; },
  inApp() { try { return AppPush.isApp(); } catch (e) { return false; } },
  prem() { return !!(App.user && App.user.premium); },

  // ───────── рисование ─────────
  rr(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  },
  img(src) {
    if (AppIcon.imgs.has(src)) return AppIcon.imgs.get(src);
    const p = new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
    AppIcon.imgs.set(src, p);
    return p;
  },
  star(c, x, y, R, r, fill) {
    c.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, d = i % 2 ? r : R; c[i ? "lineTo" : "moveTo"](x + Math.cos(a) * d, y + Math.sin(a) * d); }
    c.closePath(); c.fillStyle = fill; c.fill();
  },
  // кубик с пятью точками (как в стандартном значке)
  die(c, S, o) {
    c.save(); c.translate(S * 0.5, S * 0.5); c.rotate(0.14);
    const w = S * 0.56, h = w / 2, r = w * 0.27;
    if (o.glow) { c.shadowColor = o.glow; c.shadowBlur = S * 0.07; } else { c.shadowColor = "rgba(0,0,0,.3)"; c.shadowBlur = S * 0.05; c.shadowOffsetY = S * 0.02; }
    AppIcon.rr(c, -h, -h, w, w, r);
    if (o.stroke) {
      c.fillStyle = o.fill || "transparent"; c.fill();
      c.lineWidth = S * 0.016; c.strokeStyle = o.stroke; c.stroke();
    } else {
      const g = c.createLinearGradient(-h, -h, h, h); g.addColorStop(0, o.f1); g.addColorStop(1, o.f2); c.fillStyle = g; c.fill();
      if (o.edge) { c.shadowColor = "transparent"; c.lineWidth = S * 0.008; c.strokeStyle = o.edge; c.stroke(); }
    }
    c.shadowOffsetY = 0;
    if (o.pipGlow) { c.shadowColor = o.pipGlow; c.shadowBlur = S * 0.05; } else { c.shadowColor = "transparent"; c.shadowBlur = 0; }
    const d = w * 0.245, pr = S * 0.043;
    c.fillStyle = o.pip;
    [[-d, -d], [d, -d], [0, 0], [-d, d], [d, d]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, pr, 0, Math.PI * 2); c.fill(); });
    c.restore();
  },
  gloss(c, S, a) {
    const g = c.createRadialGradient(S * 0.28, S * 0.12, 0, S * 0.28, S * 0.12, S * 0.85);
    g.addColorStop(0, "rgba(255,255,255," + a + ")"); g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g; c.fillRect(0, 0, S, S);
  },
  async paint(k, S, round) {
    const cv = document.createElement("canvas"); cv.width = cv.height = S;
    const c = cv.getContext("2d");
    c.save();
    if (round) { AppIcon.rr(c, 0, 0, S, S, S * 0.225); c.clip(); }
    if (k === "gold") {
      const g = c.createLinearGradient(0, 0, S, S); g.addColorStop(0, "#ffe9a6"); g.addColorStop(0.5, "#f6b73c"); g.addColorStop(1, "#c27600");
      c.fillStyle = g; c.fillRect(0, 0, S, S);
      AppIcon.gloss(c, S, 0.38);
      AppIcon.die(c, S, { f1: "#fffdf4", f2: "#ffe7b0", pip: "#c77700", edge: "rgba(255,255,255,.7)" });
    } else if (k === "neon") {
      const g = c.createRadialGradient(S * 0.5, S * 0.42, S * 0.04, S * 0.5, S * 0.5, S * 0.78); g.addColorStop(0, "#241a63"); g.addColorStop(1, "#06071a");
      c.fillStyle = g; c.fillRect(0, 0, S, S);
      AppIcon.die(c, S, { stroke: "#2be4ff", fill: "rgba(43,228,255,.07)", glow: "#2be4ff", pip: "#ff4fd8", pipGlow: "#ff4fd8" });
    } else if (k === "night") {
      const g = c.createLinearGradient(0, 0, 0, S); g.addColorStop(0, "#222d5c"); g.addColorStop(1, "#070a19");
      c.fillStyle = g; c.fillRect(0, 0, S, S);
      const m = c.createRadialGradient(S * 0.8, S * 0.18, 0, S * 0.8, S * 0.18, S * 0.42); m.addColorStop(0, "rgba(190,205,255,.42)"); m.addColorStop(1, "rgba(190,205,255,0)");
      c.fillStyle = m; c.fillRect(0, 0, S, S);
      c.fillStyle = "#e9eeff";
      [[0.12, 0.14, 1.3], [0.3, 0.07, 0.9], [0.62, 0.1, 1.1], [0.9, 0.34, 0.9], [0.08, 0.5, 0.8], [0.93, 0.7, 1.2], [0.14, 0.86, 1], [0.52, 0.93, 0.8], [0.78, 0.9, 1]]
        .forEach(([x, y, s]) => { c.globalAlpha = 0.5 + s * 0.2; c.beginPath(); c.arc(x * S, y * S, S * 0.0065 * s, 0, Math.PI * 2); c.fill(); });
      c.globalAlpha = 1;
      AppIcon.die(c, S, { f1: "#3c4876", f2: "#171d3d", pip: "#dfe6ff", edge: "rgba(255,255,255,.28)" });
    } else if (k === "official") {
      // фирменный знак (official.png загружает владелец) + лёгкая правка; нет файла — берём обычный значок
      let im = await AppIcon.img("official.png"), ok = false;
      for (const src of [im, await AppIcon.img("icon-512.png")]) {
        if (!src) continue;
        try {
          c.clearRect(0, 0, S, S);
          const w = src.naturalWidth || S, h = src.naturalHeight || S, sc = Math.max(S / w, S / h);
          c.drawImage(src, (S - w * sc) / 2, (S - h * sc) / 2, w * sc, h * sc);
          c.getImageData(0, 0, 1, 1);                       // если картинка «чужая», здесь будет исключение — берём запасной вариант
          ok = true; break;
        } catch (e) { ok = false; }
      }
      if (!ok) { c.clearRect(0, 0, S, S); const g = c.createLinearGradient(0, 0, S, S); g.addColorStop(0, "#8fb8ff"); g.addColorStop(1, "#4558ff"); c.fillStyle = g; c.fillRect(0, 0, S, S); AppIcon.die(c, S, { f1: "#fff", f2: "#e4e9ff", pip: "#3b62ff" }); }
      // правка: золотисто-фиолетовая тонировка только по самой картинке, блик и тонкая светлая кромка
      c.globalCompositeOperation = "source-atop";
      const t = c.createLinearGradient(0, 0, S, S); t.addColorStop(0, "rgba(255,196,64,.34)"); t.addColorStop(1, "rgba(150,70,255,.34)");
      c.fillStyle = t; c.fillRect(0, 0, S, S);
      AppIcon.gloss(c, S, 0.22);
      c.globalCompositeOperation = "source-over";
      if (round) { c.lineWidth = S * 0.012; c.strokeStyle = "rgba(255,255,255,.45)"; AppIcon.rr(c, S * 0.006, S * 0.006, S * 0.988, S * 0.988, S * 0.22); c.stroke(); }
      // золотая звезда в углу
      const bx = S * 0.79, by = S * 0.79, br = S * 0.125;
      c.shadowColor = "rgba(0,0,0,.35)"; c.shadowBlur = S * 0.03; c.shadowOffsetY = S * 0.01;
      const bg = c.createLinearGradient(bx - br, by - br, bx + br, by + br); bg.addColorStop(0, "#ffe27a"); bg.addColorStop(1, "#f0a000");
      c.beginPath(); c.arc(bx, by, br, 0, Math.PI * 2); c.fillStyle = bg; c.fill();
      c.shadowColor = "transparent"; c.shadowBlur = 0; c.shadowOffsetY = 0;
      AppIcon.star(c, bx, by + S * 0.004, br * 0.66, br * 0.27, "#fff");
    } else {
      const im = await AppIcon.img("icon-512.png");
      if (im) { try { c.drawImage(im, 0, 0, S, S); } catch (e) {} }
      else { const g = c.createLinearGradient(0, 0, S, S); g.addColorStop(0, "#8fb8ff"); g.addColorStop(1, "#4558ff"); c.fillStyle = g; c.fillRect(0, 0, S, S); AppIcon.die(c, S, { f1: "#fff", f2: "#e4e9ff", pip: "#3b62ff" }); }
    }
    c.restore();
    return cv;
  },
  // готовая картинка значка (data:URL); round — со скруглёнными углами (для показа), без — квадрат на весь холст (для сохранения)
  async url(k, S = 160, round = true) {
    const id = k + "|" + S + "|" + (round ? 1 : 0);
    if (AppIcon.cache.has(id)) return AppIcon.cache.get(id);
    let u = "";
    try { const cv = await AppIcon.paint(k, S, round); u = cv.toDataURL("image/png"); } catch (e) {}
    if (u) AppIcon.cache.set(id, u);
    return u;
  },
  async fill(root) {
    const imgs = [...root.querySelectorAll("img[data-ic]")];
    await Promise.all(imgs.map(async (im) => { const u = await AppIcon.url(im.dataset.ic, +im.dataset.s || 160, true); if (u && im.isConnected) { im.src = u; im.classList.add("rdy"); } }));
  },

  // ───────── мост APK ─────────
  FN: ["setAppIcon", "changeAppIcon", "setLauncherIcon", "changeLauncherIcon", "switchAppIcon", "setIcon", "changeIcon"],
  PLUG: ["AppIcon", "DynamicAppIcon", "AppIconChanger", "LauncherIcon"],
  bridge() {                                      // что найдено в этой сборке: {o, fn} или {plugin, fn}
    for (const o of [window.WebToApk, window.AppMint, window.appmintNative]) {
      if (!o) continue;
      for (const fn of AppIcon.FN) { try { if (typeof o[fn] === "function") return { o, fn }; } catch (e) {} }
    }
    try {
      const P = window.Capacitor && Capacitor.Plugins;
      if (P) for (const n of AppIcon.PLUG) {
        const pl = P[n]; if (!pl) continue;
        for (const fn of ["change", "set", "setIcon", "changeIcon"]) { try { if (typeof pl[fn] === "function") return { plugin: pl, fn }; } catch (e) {} }
      }
    } catch (e) {}
    return null;
  },
  // сменить значок на рабочем столе. Вернёт "ok" (мост принял), "none" (в сборке нет такого моста) или "fail" (мост есть, но отказал)
  async native(k) {
    const b = AppIcon.bridge();
    if (!b) return "none";
    try {
      const r = b.plugin ? await b.plugin[b.fn]({ name: k === "default" ? null : k, disable: AppIcon.LIST.map((x) => x.k).filter((x) => x !== "default" && x !== k) }) : await b.o[b.fn](k);
      return r === false || r === "false" ? "fail" : "ok";
    } catch (e) { return "fail"; }
  },

  // значок самого сайта (вкладка / «на главный экран») — меняется всегда
  async applyWeb(k) {
    const links = [...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')];
    if (!AppIcon.orig) AppIcon.orig = links.map((l) => [l, l.getAttribute("href")]);
    if (k === "default") { AppIcon.orig.forEach(([l, h]) => l.setAttribute("href", h)); return; }
    const u = await AppIcon.url(k, 192, true);
    if (u) links.forEach((l) => l.setAttribute("href", u));
  },

  // выбрать значок. Обычному пользователю — рассказ о Premium (кроме «Стандартной»).
  async choose(k) {
    if (!AppIcon.LIST.some((x) => x.k === k)) return "bad";
    if (k !== "default" && !AppIcon.prem()) { PremiumPromo.open(App.user); return "premium"; }
    Prefs.set(AppIcon.KEY, k);
    AppIcon.applyWeb(k);
    return AppIcon.native(k);
  },
  // при запуске: Premium закончился — возвращаем стандартный значок; иначе подтверждаем выбор перед мостом
  async guard() {
    const k = AppIcon.cur();
    if (k !== "default" && !AppIcon.prem()) { Prefs.set(AppIcon.KEY, "default"); AppIcon.applyWeb("default"); if (AppIcon.inApp()) AppIcon.native("default"); return; }
    if (k !== "default") AppIcon.applyWeb(k);
  },

  // ───────── экран ─────────
  open() {
    const pg = Pg.open({ title: T("Иконка приложения"), build: (pg) => AppIcon.draw(pg) });
    pg.on = {
      ic: async (el) => {
        const k = el.dataset.v;
        if (k === AppIcon.cur()) return;
        haptic();
        const r = await AppIcon.choose(k);
        if (r === "premium" || r === "bad") return;
        AppIcon.draw(pg);
        if (r === "ok") toast(T("Значок «{0}» установлен", T(AppIcon.info(k).n)));
        else if (r === "fail") toast(T("Не удалось сменить значок на рабочем столе"));
        else toast(T("Значок «{0}» выбран в приложении", T(AppIcon.info(k).n)));
      },
      promo: () => PremiumPromo.open(App.user),
      save: async () => {
        const k = AppIcon.cur(), u = await AppIcon.url(k, 512, false);
        if (!u) return toast(T("Не удалось подготовить картинку"));
        try { const b = await (await fetch(u)).blob(); const bu = URL.createObjectURL(b); Attach.saveDevice({ url: bu, name: "dicegram-" + k + ".png", mime: "image/png" }); setTimeout(() => URL.revokeObjectURL(bu), 60000); toast(T("Картинка значка сохраняется")); }
        catch (e) { toast(T("Не удалось сохранить картинку")); }
      },
    };
    return pg;
  },
  draw(pg) {
    const cur = AppIcon.cur(), prem = AppIcon.prem(), br = !!AppIcon.bridge();
    const tile = (x) => {
      const lk = !x.free && !prem;
      return `<button class="aic-t${cur === x.k ? " on" : ""}${lk ? " lk" : ""}" data-a="ic" data-v="${x.k}" aria-label="${esc(T(x.n))}">
        <span class="aic-w"><img data-ic="${x.k}" data-s="192" alt="" width="64" height="64"><i class="aic-ck">${SI.check}</i>${lk ? `<i class="aic-pm">${SI.starF}</i>` : ""}</span>
        <b>${esc(T(x.n))}</b><small>${esc(x.free ? T("Для всех") : "Premium")}</small></button>`;
    };
    const info = AppIcon.info(cur);
    pg.set(`
      <div class="aic-hero"><span class="aic-big"><img data-ic="${cur}" data-s="256" alt="" width="96" height="96"></span><h2>${esc(T(info.n))}</h2><p>${esc(T(info.s))}</p></div>
      ${prem ? "" : R.card(R.row({ a: "promo", ic: SI.starF, c: "pr", t: esc(T("Эксклюзивные значки")), s: esc(T("Четыре значка доступны с подпиской Premium")) }))}
      ${R.lbl(esc(T("Выберите значок")))}
      <div class="aic-grid">${AppIcon.LIST.map(tile).join("")}</div>
      ${R.card(R.row({ a: "save", ic: SI.down, c: "b", t: esc(T("Сохранить картинку значка")), s: esc(T("Чтобы поставить вручную в настройках лаунчера")), chev: false }))}
      ${R.hint(esc(br
        ? T("Значок на рабочем столе меняется сразу. Если лаунчер не обновил его — подождите несколько секунд или перезапустите приложение.")
        : T("В этой сборке приложения нет вариантов значка, поэтому сам значок на рабочем столе сменить отсюда нельзя. Выбранный значок показывается внутри приложения, а картинку можно сохранить и поставить вручную. Чтобы значок менялся прямо на рабочем столе, в APK нужно добавить варианты значка.")))}`);
    AppIcon.fill(pg.body);
  },
};
