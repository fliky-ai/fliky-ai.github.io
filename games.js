// games.js — раздел «Игры»: хаб со списком игр, таблицы лидеров дня, короткоживущие
// игровые сессии (анти-чит — см. /api/games/start и /api/games/score на сервере) и «Тапалка»
// (монеты + анти-бот капча). Экраны — обычные страницы Pg (как в Settings), без своего каркаса.

const GI = {
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
    const rows = d.top.map((row, i) => Games.boardRow(i + 1, row.user, row.score, mine && row.user.id === mine)).join("");
    const inTop = d.top.some((r) => mine && r.user.id === mine);
    const meLine = !inTop && d.me && d.me.rank ? Games.boardRow(d.me.rank, App.user, d.me.score, true) : "";
    pg.set(
      `<div class="g-board">${rows || `<div class="g-empty">${esc(T("Сегодня пока никто не играл — сыграйте первым!"))}</div>`}</div>` +
      (meLine ? `<div class="g-meline">${meLine}</div>` : "")
    );
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

// «Тапалка»: виртуальные монеты за тап, каждые 40 кликов — простая арифметическая капча
// (анти-бот; состояние хранится на сервере — game_wallet).
const GameClicker = {
  open() {
    const pg = Pg.open({
      title: T("Тапалка"), cls: "gameplay gclicker",
      right: `<button class="icon-btn" data-a="lb" aria-label="${esc(T("Таблица лидеров"))}">${SI.stats}</button>`,
      data: { coins: 0, today: 0, need_captcha: false, captcha: null, capval: "", caperr: "", busy: true },
      build: (p) => GameClicker.draw(p),
    });
    pg.on.lb = () => Games.leaderboard("clicker", T("Тапалка"));
    pg.on.tap = () => GameClicker.tap(pg);
    pg.on.capsend = () => GameClicker.solve(pg);
    pg.on.capval = (v) => { pg.data.capval = v; };
    GameClicker.load(pg);
  },

  async load(pg) {
    pg.data.busy = true;
    try {
      const d = await api("/api/games/clicker/state");
      if (!pg.alive) return;
      Object.assign(pg.data, { coins: d.coins, today: d.today, need_captcha: d.need_captcha, captcha: d.captcha || null });
    } catch (e) { if (pg.alive) toast(e.message); }
    if (!pg.alive) return;
    pg.data.busy = false;
    GameClicker.draw(pg);
  },

  draw(pg) {
    const d = pg.data;
    pg.set(`
      <div class="g-wallet">${SI.bolt}<b>${d.coins}</b><small>${esc(T("монет"))}</small></div>
      <div class="g-today">${esc(T("Сегодня: {0}", d.today))}</div>
      ${d.need_captcha ? GameClicker.captchaHTML(d) : `
        <button class="g-tap" data-a="tap" ${d.busy ? "disabled" : ""}>${SI.bolt}<span>${esc(T("Тапни"))}</span></button>
        <p class="g-hint">${esc(T("Каждые 40 нажатий — небольшая проверка, что вы не бот"))}</p>`}
    `);
  },

  captchaHTML(d) {
    return `<div class="g-cap">
      <p>${esc(T("Проверка: решите пример"))}</p>
      <b class="g-capq">${esc(d.captcha || "")}</b>
      <input class="g-capin" data-i="capval" type="number" inputmode="numeric" placeholder="${esc(T("Ответ"))}" value="${esc(d.capval || "")}" ${d.busy ? "disabled" : "autofocus"}>
      ${d.caperr ? `<small class="g-caperr">${esc(d.caperr)}</small>` : ""}
      <button class="pbtn" data-a="capsend" ${d.busy ? "disabled" : ""}>${esc(T("Ответить"))}</button>
    </div>`;
  },

  async tap(pg) {
    const d = pg.data;
    if (d.busy || d.need_captcha) return;
    d.busy = true; GameClicker.draw(pg);
    haptic();
    try {
      const r = await api("/api/games/clicker/click", { method: "POST" });
      if (!pg.alive) return;
      d.busy = false; d.coins = r.coins;
      if (r.need_captcha) { d.need_captcha = true; d.captcha = r.captcha || null; d.caperr = ""; d.capval = ""; }
      else d.today++;
      GameClicker.draw(pg);
    } catch (e) {
      if (!pg.alive) return;
      d.busy = false;
      toast(e.message);
      GameClicker.load(pg); // пересинхронизация (сервер мог уже требовать капчу или включить лимит)
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
      d.busy = false; d.need_captcha = false; d.captcha = null; d.caperr = ""; d.capval = "";
      haptic("medium"); toast(T("Проверка пройдена"));
      GameClicker.draw(pg);
    } catch (e) {
      if (!pg.alive) return;
      d.busy = false;
      d.caperr = e.message || T("Неверно, попробуйте ещё раз");
      d.capval = "";
      GameClicker.load(pg); // подтянуть новую капчу, которую сервер уже сгенерировал
    }
  },
};
