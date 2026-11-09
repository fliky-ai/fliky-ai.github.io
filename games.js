// games.js — раздел «Игры»: хаб со списком игр, таблицы лидеров дня, короткоживущие
// игровые сессии (анти-чит — см. /api/games/start и /api/games/score на сервере) и «Тапалка»
// (монеты + анти-бот капча). Экраны — обычные страницы Pg (как в Settings), без своего каркаса.

const GI = {
  // корона для первого места на подиуме
  crown: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 8l4.5 4L12 5l4.500 7L21 8l-2 11H5z"/></svg>',
  // 2×2 плитки — тема «слияния» для 2048
  tiles2: svg('<rect x="2.5" y="2.5" width="8" height="8" rx="2"/><rect x="13.5" y="2.5" width="8" height="8" rx="2"/><rect x="2.5" y="13.5" width="8" height="8" rx="2"/><rect x="13.5" y="13.5" width="8" height="8" rx="2"/>'),
  // стопка полос переменной длины — тема «очистки линий» для Block Blast
  stack: svg('<rect x="2" y="3.5" width="20" height="4.5" rx="1.6"/><rect x="2" y="9.800" width="13" height="4.5" rx="1.6"/><rect x="2" y="16.100" width="17" height="4.5" rx="1.6"/>'),
  // падающие песчинки — тема Sand Fall
  fall: svg('<path d="M12 2.5v5M9.300 5 12 2.5 14.700 5"/><circle cx="7" cy="14" r="1.300" fill="currentColor" stroke="none"/><circle cx="12.200" cy="17.500" r="1.300" fill="currentColor" stroke="none"/><circle cx="17.400" cy="14" r="1.300" fill="currentColor" stroke="none"/><circle cx="9.600" cy="20.500" r="1.300" fill="currentColor" stroke="none"/><circle cx="14.800" cy="20.500" r="1.300" fill="currentColor" stroke="none"/>'),
};

const Games = {
  LIST: [
    { id: "clicker", name: "Тапалка", icon: SI.bolt, c: "y", desc: "Кликай и копи монеты" },
    { id: "2048", name: "2048", icon: GI.tiles2, c: "b", desc: "Собери плитку 2048" },
    { id: "block_blast", name: "Block Blast", icon: GI.stack, c: "g", desc: "Собирай фигуры, очищай линии" },
    { id: "sand", name: "Sand Fall", icon: GI.fall, c: "v", desc: "Падающие фигуры рассыпаются песком" },
  ],

  open() {
    Pg.open({ title: T("Игры"), cls: "gameshub", build: (pg) => Games.draw(pg) });
  },

  draw(pg) {
    pg.set(
      R.hero(SI.games, T("Игры"), T("4 мини-игры и таблицы лидеров дня")) +
      R.card(...Games.LIST.map((g) => R.row({ a: "go", v: g.id, ic: g.icon, c: g.c, t: esc(T(g.name)), s: esc(T(g.desc)) })))
    );
    pg.on.go = (el) => Games.launch(el.dataset.v);
  },

  launch(id) {
    if (id === "clicker") return GameClicker.open();
    if (id === "2048") return Game2048.open();
    if (id === "block_blast") return GameBlocks.open();
    if (id === "sand") return GameSand.open();
  },

  async leaderboard(game, title) {
    const pg = Pg.open({ title: T("Лидеры: {0}", title), data: { loading: true }, build: (p) => Games.drawBoard(p) });
    try {
      const d = await api("/api/games/leaderboard/" + encodeURIComponent(game));
      if (!pg.alive) return;
      pg.data = { loading: false, day: d.day, top: d.top || [], me: d.me || { score: 0, rank: null } };
    } catch (e) {
      if (!pg.alive) return;
      pg.data = { loading: false, err: e.message };
    }
    pg.refresh();
  },

  drawBoard(pg) {
    const d = pg.data;
    if (d.loading) return pg.set(`<div class="g-load">${esc(T("Загрузка…"))}</div>`);
    if (d.err) return pg.set(`<div class="g-load">${esc(d.err)}</div>`);
    const mine = App.user && App.user.id;
    const top = d.top || [];
    // первые три места — подиум (золото/серебро/бронза), остальные — обычный список
    const podium = top.length ? Games.podium(top.slice(0, 3), mine) : "";
    const rows = top.slice(3).map((row, i) => Games.boardRow(i + 4, row.user, row.score, mine && row.user.id === mine)).join("");
    const inTop = top.some((r) => mine && r.user.id === mine);
    const meLine = !inTop && d.me && d.me.rank ? Games.boardRow(d.me.rank, App.user, d.me.score, true) : "";
    pg.set(
      (top.length ? podium : "") +
      (rows ? `<div class="g-board">${rows}</div>` : top.length ? "" : `<div class="g-board"><div class="g-empty">${esc(T("Сегодня пока никто не играл — сыграйте первым!"))}</div></div>`) +
      (meLine ? `<div class="g-meline">${meLine}</div>` : "")
    );
  },

  // пьедестал: порядок колонок 2-1-3, у первого — корона и самый высокий постамент
  podium(three, mine) {
    const slot = (rank, row) => row
      ? `<div class="g-pod p${rank}${mine && row.user.id === mine ? " me" : ""}">
           ${rank === 1 ? `<i class="g-crown">${GI.crown}</i>` : ""}
           <div class="g-pod-av">${avatar(row.user)}<b class="g-medal m${rank}">${rank}</b></div>
           <span class="g-pod-name">${esc(dispName(row.user))}</span>
           <b class="g-pod-score">${row.score}</b>
           <div class="g-pod-base"><span>${rank}</span></div>
         </div>`
      : `<div class="g-pod p${rank} empty"><div class="g-pod-base"><span>${rank}</span></div></div>`;
    return `<div class="g-podium">${slot(2, three[1])}${slot(1, three[0])}${slot(3, three[2])}</div>`;
  },

  boardRow(rank, u, score, mine) {
    return `<div class="g-row${mine ? " me" : ""}"><b class="g-rank${rank <= 3 ? " t" + rank : ""}">${rank}</b>${avatar(u, "sm")}<span class="g-name">${esc(dispName(u))}</span><b class="g-score">${score}</b></div>`;
  },
};

// Игровая сессия: короткоживущий одноразовый токен. Сервер отклоняет отправку результата
// без него, слишком быструю (< 3с от старта) и повторную отправку одного и того же токена —
// это не защита от читов в принципе, а просьба не слать очки «мгновенно» и не дублировать их.
const GameSession = {
  async start(game) {
    try { const d = await api("/api/games/start", { method: "POST", body: { game } }); return d.session || null; }
    catch (e) { return null; }
  },
  async submit(session, score) {
    if (!session) return null;
    try { return await api("/api/games/score", { method: "POST", body: { session, score: Math.max(0, Math.round(score)) } }); }
    catch (e) { return null; }
  },
};

// «Тапалка»: виртуальные монеты за тап + магазин улучшений (сила клика, пассивный доход).
// Экономика полностью считается на сервере (game_wallet). Чтобы быстрые тапы не терялись, клиент
// копит их и шлёт ПАКЕТОМ раз в ~0.35 с (одиночный запрос на тап упирался бы в лимит частоты и монеты
// «откатывались» при пересинхронизации). Цифры на экране растут сразу (оптимистично), а ответ сервера —
// источник правды: баланс = ответ сервера + ещё не отправленные тапы. Пассивный доход тикает на экране
// раз в секунду, раз в несколько секунд баланс тихо сверяется с сервером. Капча — анти-бот проверка,
// появляется раз в 40 тапов подряд.
const GameClicker = {
  RESYNC_MS: 4000,
  FLUSH_MS: 350,
  BATCH: 40,

  open() {
    const pg = Pg.open({
      title: T("Тапалка"), cls: "gameplay gclicker",
      right: `<button class="icon-btn" data-a="lb" aria-label="${esc(T("Таблица лидеров"))}">${SI.stats}</button>`,
      data: { coins: 0, today: 0, need_captcha: false, captcha: null, capval: "", caperr: "", busy: true,
               clickPower: 0, passiveLevel: 0, clickCost: null, passiveCost: null, pending: 0, buying: false },
      build: (p) => GameClicker.draw(p),
      onClose: () => GameClicker.dispose(pg),
    });
    pg.t = { resync: 0, passive: 0, flush: 0, vis: null };
    pg.on.lb = () => Games.leaderboard("clicker", T("Тапалка"));
    pg.on.tap = (el, _el, e) => GameClicker.tap(pg, el, e);
    pg.on.buy = (el) => GameClicker.buy(pg, el.dataset.v);
    pg.on.capsend = () => GameClicker.solve(pg);
    pg.on.capval = (v) => { pg.data.capval = v; };
    GameClicker.bindCoin(pg);
    GameClicker.load(pg, false);
    pg.t.resync = setInterval(() => GameClicker.load(pg, true), GameClicker.RESYNC_MS);
    pg.t.passive = setInterval(() => GameClicker.passiveTick(pg), 1000);
    // свернули приложение — сразу досылаем накопленные тапы, пока не убила система
    pg.t.vis = () => { if (document.hidden) GameClicker.flush(pg, true); };
    document.addEventListener("visibilitychange", pg.t.vis);
  },

  // всё, что запущено игрой, обязано остановиться при закрытии — иначе утечка таймеров/слушателей
  dispose(pg) {
    const t = pg.t || {};
    clearInterval(t.resync); clearInterval(t.passive); clearTimeout(t.flush);
    if (t.vis) document.removeEventListener("visibilitychange", t.vis);
    const d = pg.data;
    if (d.pending > 0 && !d.need_captcha) {
      const n = Math.min(d.pending, GameClicker.BATCH);
      d.pending = 0;
      api("/api/games/clicker/click", { method: "POST", body: { n } }).catch(() => {});
    }
  },

  // тилт-эффект монеты «под пальцем» — делегируем на pg.el, т.к. .gcl-coin пересоздаётся при draw()
  bindCoin(pg) {
    let active = null;
    const tilt = (coin, e) => {
      const r = coin.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      coin.style.setProperty("--ry", (px * 18).toFixed(1) + "deg");
      coin.style.setProperty("--rx", (-py * 18).toFixed(1) + "deg");
    };
    const reset = (coin) => { coin.style.setProperty("--rx", "0deg"); coin.style.setProperty("--ry", "0deg"); coin.style.setProperty("--s", "1"); };
    pg.el.addEventListener("pointerdown", (e) => {
      const coin = e.target.closest && e.target.closest(".gcl-coin");
      if (!coin) return;
      active = coin; coin.style.setProperty("--s", "0.93"); tilt(coin, e);
    });
    pg.el.addEventListener("pointermove", (e) => { if (active) tilt(active, e); });
    const end = () => { if (active) { reset(active); active = null; } };
    pg.el.addEventListener("pointerup", end);
    pg.el.addEventListener("pointercancel", end);
  },

  // всплывающее «+N» в точке тапа — отдельный узел, живёт своей анимацией и сам себя удаляет
  spawnFloat(pg, x, y, text) {
    const zone = pg.$(".gcl-coin-zone");
    if (!zone) return;
    const old = zone.querySelectorAll(".gcl-float");
    if (old.length > 14) old[0].remove();       // при бешеном тапе не раздуваем DOM
    const r = zone.getBoundingClientRect();
    const el = document.createElement("span");
    el.className = "gcl-float";
    el.textContent = text;
    el.style.left = (x - r.left + (Math.random() * 24 - 12)) + "px";
    el.style.top = (y - r.top - 8) + "px";
    zone.appendChild(el);
    const kill = () => el.remove();
    el.addEventListener("animationend", kill, { once: true });
    setTimeout(kill, 1300); // запасной таймер, если animationend не придёт
  },

  gainOf(d) { return 1 + (d.clickPower || 0); },

  // silent=true — тихая периодическая пересинхронизация: обновляет только текст/состояние
  // кнопок, не трогая DOM монеты/анимации (иначе дёргало бы интерфейс каждые 4 секунды)
  async load(pg, silent) {
    const d = pg.data;
    if (silent && (d.pending || d.flushP || d.buying || d.busy)) return;   // идут тапы/покупка — не сбиваем цифры
    if (!silent) { d.busy = true; GameClicker.draw(pg); }
    try {
      const r = await api("/api/games/clicker/state");
      if (!pg.alive) return;
      if (silent && (d.pending || d.flushP || d.buying)) return;           // пока ждали ответ, пошли тапы — ответ уже устарел
      const wasCap = d.need_captcha, wasP = d.passiveLevel, wasC = d.clickPower;
      Object.assign(d, {
        coins: r.coins, today: r.today, need_captcha: r.need_captcha, captcha: r.captcha || null,
        clickPower: r.click_power || 0, passiveLevel: r.passive_level || 0,
        clickCost: r.click_cost, passiveCost: r.passive_cost,
      });
      d.busy = false;
      if (silent && wasCap === d.need_captcha && wasP === d.passiveLevel && wasC === d.clickPower) GameClicker.updateCounters(pg);
      else GameClicker.draw(pg);
    } catch (e) {
      if (!pg.alive) return;
      d.busy = false;
      if (!silent) { toast(e.message); GameClicker.draw(pg); }
    }
  },

  // пассивный доход виден на экране каждую секунду (сервер начисляет такой же — сверка в load())
  passiveTick(pg) {
    const d = pg.data;
    if (!pg.alive || d.busy || d.need_captcha || !d.passiveLevel) return;
    d.coins += d.passiveLevel;
    GameClicker.updateCounters(pg);
  },

  // точечное обновление цифр без полной перерисовки (чтобы не прерывать тилт/анимации монеты)
  updateCounters(pg) {
    const d = pg.data;
    const c = pg.$(".gcl-coins"); if (c) c.textContent = d.coins;
    const t = pg.$(".gcl-todayv"); if (t) t.textContent = d.today;
    pg.el.querySelectorAll(".gcl-up").forEach((row) => {
      const kind = row.dataset.v, cost = kind === "click" ? d.clickCost : d.passiveCost;
      const btn = row.querySelector(".gcl-up-buy");
      if (btn && cost != null) { btn.textContent = cost; btn.classList.toggle("afford", d.coins >= cost); }
    });
  },

  draw(pg) {
    const d = pg.data;
    pg.set(`
      <div class="g-wallet">${SI.bolt}<b class="gcl-coins">${d.coins}</b><small>${esc(T("монет"))}</small>${d.passiveLevel ? `<em class="gcl-pps">+${d.passiveLevel}/${esc(T("сек"))}</em>` : ""}</div>
      <div class="g-today">${esc(T("Сегодня:"))} <b class="gcl-todayv">${d.today}</b></div>
      ${d.need_captcha ? GameClicker.captchaHTML(d) : `
        <div class="gcl-coin-zone">
          <button class="gcl-coin" data-a="tap" aria-label="${esc(T("Тапни"))}">
            <span class="gcl-coin-ring"></span><span class="gcl-coin-face">${SI.bolt}</span><span class="gcl-coin-shine"></span>
          </button>
        </div>
        <p class="g-hint">${esc(T("Каждые 40 нажатий — небольшая проверка, что вы не бот"))}</p>
        ${GameClicker.shopHTML(d)}`}
    `);
  },

  shopHTML(d) {
    const row = (kind, icon, title, level, cost, perk) => `
      <div class="gcl-up${cost == null ? " max" : ""}" data-v="${kind}">
        <i class="gcl-up-ic">${icon}</i>
        <div class="gcl-up-t"><b>${esc(title)}</b><small>${esc(T("Уровень {0}", level))} · ${esc(perk)}</small></div>
        ${cost == null ? `<span class="gcl-up-max">${esc(T("MAX"))}</span>`
          : `<button class="gcl-up-buy${d.coins >= cost ? " afford" : ""}" data-a="buy" data-v="${kind}">${cost}</button>`}
      </div>`;
    return `<div class="gcl-shop">
      ${row("click", SI.bolt, T("Сила клика"), d.clickPower, d.clickCost, T("+{0} монет/тап", 1 + d.clickPower))}
      ${row("passive", SI.clock, T("Пассивный доход"), d.passiveLevel, d.passiveCost, T("+{0} монет/сек", d.passiveLevel))}
    </div>`;
  },

  captchaHTML(d) {
    return `<div class="g-cap">
      <p>${esc(T("Проверка: решите пример"))}</p>
      <b class="g-capq">${esc(d.captcha || "")}</b>
      <input class="g-capin" data-i="capval" type="number" inputmode="numeric" placeholder="${esc(T("Ваш ответ"))}" value="${esc(d.capval || "")}" ${d.busy ? "disabled" : "autofocus"}>
      ${d.caperr ? `<small class="g-caperr">${esc(d.caperr)}</small>` : ""}
      <button class="pbtn" data-a="capsend" ${d.busy ? "disabled" : ""}>${esc(T("Проверить"))}</button>
    </div>`;
  },

  // тап: цифры растут мгновенно, на сервер уходит пакет чуть позже (см. flush)
  tap(pg, el, e) {
    const d = pg.data;
    if (d.need_captcha || d.busy) return;
    const gain = GameClicker.gainOf(d);
    const r = el.getBoundingClientRect();
    const x = (e && e.clientX) || (r.left + r.width / 2);
    const y = (e && e.clientY) || (r.top + r.height / 3);
    GameClicker.spawnFloat(pg, x, y, "+" + gain);
    haptic();
    d.coins += gain; d.today += gain; d.pending = Math.min(d.pending + 1, 400);
    GameClicker.updateCounters(pg);
    GameClicker.schedule(pg, GameClicker.FLUSH_MS);
  },

  schedule(pg, ms) {
    if (pg.t.flush || !pg.alive) return;
    pg.t.flush = setTimeout(() => { pg.t.flush = 0; GameClicker.flush(pg, false); }, ms);
  },

  // отправка накопленных тапов. all=true — до последнего (перед покупкой/сворачиванием), иначе один пакет.
  // Баланс после ответа = ответ сервера + ещё не отправленные тапы → никаких «откатов» монет.
  flush(pg, all) {
    const d = pg.data;
    if (d.flushP) return d.flushP;
    const p = (async () => {
      {
        while (pg.alive && d.pending > 0 && !d.need_captcha) {
          const n = Math.min(d.pending, GameClicker.BATCH);
          d.pending -= n;
          let r;
          try { r = await api("/api/games/clicker/click", { method: "POST", body: { n } }); }
          catch (e) {
            if (!pg.alive) return;
            if (/проверк/i.test(e.message || "")) {            // сервер требует капчу — берём её с сервера
              d.pending = 0; GameClicker.load(pg, false); return;
            }
            d.pending += n;                                    // сеть отвалилась — вернём тапы в очередь, повторим позже
            GameClicker.schedule(pg, 2500);
            return;
          }
          if (!pg.alive) return;
          const gain = GameClicker.gainOf(d), rest = d.pending * gain;
          d.coins = r.coins + rest;
          if (typeof r.today === "number") d.today = r.today + rest;
          if (r.need_captcha) {
            d.pending = 0; d.need_captcha = true; d.captcha = r.captcha || null; d.caperr = ""; d.capval = "";
            GameClicker.draw(pg);
            return;
          }
          GameClicker.updateCounters(pg);
          if (!all) break;
        }
      }
    })().catch(() => {});
    d.flushP = p;
    // сбрасываем флаг ПОСЛЕ присваивания (иначе при мгновенном завершении промис «залип» бы навсегда)
    p.then(() => {
      if (d.flushP === p) d.flushP = null;
      if (pg.alive && d.pending > 0 && !d.need_captcha) GameClicker.schedule(pg, GameClicker.FLUSH_MS);
    });
    return p;
  },

  async buy(pg, kind) {
    const d = pg.data;
    if (d.buying) return;
    d.buying = true;
    try {
      await GameClicker.flush(pg, true);       // сперва досылаем тапы — сервер должен знать актуальный баланс
      if (!pg.alive || d.need_captcha) return;
      const cost = kind === "click" ? d.clickCost : d.passiveCost;
      if (cost == null) return toast(T("Улучшение уже максимального уровня"));
      if (d.coins < cost) return toast(T("Недостаточно монет"));
      const r = await api("/api/games/clicker/upgrade", { method: "POST", body: { kind } });
      if (!pg.alive) return;
      d.coins = r.coins;
      if (kind === "click") { d.clickPower = r.level; d.clickCost = r.next_cost; }
      else { d.passiveLevel = r.level; d.passiveCost = r.next_cost; }
      haptic("medium");
      GameClicker.draw(pg);
    } catch (e) {
      if (!pg.alive) return;
      toast(e.message);
      d.buying = false;
      GameClicker.load(pg, false);
    } finally {
      d.buying = false;
    }
  },

  async solve(pg) {
    const d = pg.data;
    const v = parseInt(d.capval, 10);
    if (d.capval === "" || Number.isNaN(v)) { d.caperr = T("Введите число"); return GameClicker.draw(pg); }
    d.busy = true; d.caperr = ""; GameClicker.draw(pg);
    try {
      await api("/api/games/clicker/captcha", { method: "POST", body: { answer: v } });
      if (!pg.alive) return;
      haptic("medium"); toast(T("Проверка пройдена"));
      await GameClicker.load(pg, false);
    } catch (e) {
      if (!pg.alive) return;
      d.busy = false;
      d.caperr = e.message || T("Неверно, попробуйте ещё раз");
      d.capval = "";
      await GameClicker.load(pg, false);
    }
  },
};
