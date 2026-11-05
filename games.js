
// games.js — раздел «Игры»: хаб, таблицы лидеров дня, сессии и «Тапалка» с магазином улучшений (Passive Income & Click Power).

const GI = {
  tiles2: svg('<rect x="2.5" y="2.5" width="8" height="8" rx="2"/><rect x="13.5" y="2.5" width="8" height="8" rx="2"/><rect x="2.5" y="13.5" width="8" height="8" rx="2"/><rect x="13.5" y="13.5" width="8" height="8" rx="2"/>'),
  stack: svg('<rect x="2" y="3.5" width="20" height="4.5" rx="1.6"/><rect x="2" y="9.800" width="13" height="4.5" rx="1.6"/><rect x="2" y="16.100" width="17" height="4.5" rx="1.6"/>'),
  fall: svg('<path d="M12 2.5v5M9.300 5 12 2.5 14.700 5"/><circle cx="7" cy="14" r="1.300" fill="currentColor" stroke="none"/><circle cx="12.200" cy="17.500" r="1.300" fill="currentColor" stroke="none"/><circle cx="17.400" cy="14" r="1.300" fill="currentColor" stroke="none"/><circle cx="9.600" cy="20.500" r="1.300" fill="currentColor" stroke="none"/><circle cx="14.800" cy="20.500" r="1.300" fill="currentColor" stroke="none"/>'),
};

const Games = {
  LIST: [
    { id: "clicker", name: "Тапалка", icon: SI.bolt, c: "y", desc: "Тапай по 3D-монете, качай бустеры" },
    { id: "2048", name: "2048", icon: GI.tiles2, c: "b", desc: "Собери плитку 2048 с плавным свайпом" },
    { id: "block_blast", name: "Block Blast", icon: GI.stack, c: "g", desc: "Неоновые блоки, комбо и взрывы" },
    { id: "sand", name: "Sand Fall", icon: GI.fall, c: "v", desc: "Падающие фигуры рассыпаются песком" },
  ],

  open() {
    Pg.open({ title: T("Игры"), cls: "gameshub", build: (pg) => Games.draw(pg) });
  },

  draw(pg) {
    pg.set(
      R.hero(SI.games, T("Игры"), T("Мини-игры с премиальным дизайном и таблицами лидеров")) +
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
    if (d.loading) return pg.set(`<div class="g-load"><div class="g-spinner"></div>${esc(T("Загрузка лидеров…"))}</div>`);
    if (d.err) return pg.set(`<div class="g-load">${esc(d.err)}</div>`);
    const mine = App.user && App.user.id;
    const rows = d.top.map((row, i) => Games.boardRow(i + 1, row.user, row.score, mine && row.user.id === mine)).join("");
    const inTop = d.top.some((r) => mine && r.user.id === mine);
    const meLine = !inTop && d.me && d.me.rank ? Games.boardRow(d.me.rank, App.user, d.me.score, true) : "";
    pg.set(
      `<div class="g-board">${rows || `<div class="g-empty">${esc(T("Сегодня пока никто не играл — стань первым лидером!"))}</div>`}</div>` +
      (meLine ? `<div class="g-meline">${meLine}</div>` : "")
    );
  },

  boardRow(rank, u, score, mine) {
    let medal = "";
    if (rank === 1) medal = "🥇 ";
    else if (rank === 2) medal = "🥈 ";
    else if (rank === 3) medal = "🥉 ";
    return `<div class="g-row${mine ? " me" : ""}"><b class="g-rank${rank <= 3 ? " t" + rank : ""}">${medal}${rank}</b>${avatar(u, "sm")}<span class="g-name">${esc(dispName(u))}</span><b class="g-score">${score}</b></div>`;
  },
};

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

// «Тапалка» с 3D-монетой, летающими "+N", системой улучшений (пассивный доход и сила клика) и капчей
const GameClicker = {
  timer: null,

  open() {
    const pg = Pg.open({
      title: T("Тапалка"), cls: "gameplay gclicker",
      right: `<button class="icon-btn" data-a="lb" aria-label="${esc(T("Таблица лидеров"))}">${SI.stats}</button>`,
      data: { 
        coins: 0, today: 0, clickPower: 1, passiveLvl: 0, clickLvl: 0, 
        need_captcha: false, captcha: null, capval: "", caperr: "", busy: true 
      },
      build: (p) => GameClicker.draw(p),
      onClose: () => { clearInterval(GameClicker.timer); GameClicker.timer = null; },
    });
    pg.on.lb = () => Games.leaderboard("clicker", T("Тапалка"));
    pg.on.tap = (e) => GameClicker.tap(pg, e);
    pg.on.capsend = () => GameClicker.solve(pg);
    pg.on.capval = (v) => { pg.data.capval = v; };
    pg.on.upgrade = (el) => GameClicker.buyUpgrade(pg, el.dataset.v);

    GameClicker.load(pg);
    clearInterval(GameClicker.timer);
    // Пассивный доход каждую секунду
    GameClicker.timer = setInterval(() => {
      if (!pg.alive || pg.data.need_captcha || pg.data.passiveLvl === 0) return;
      pg.data.coins += pg.data.passiveLvl;
      pg.data.today += pg.data.passiveLvl;
      const coinEl = pg.el.querySelector(".g-wallet b");
      if (coinEl) coinEl.textContent = pg.data.coins;
    }, 1000);
  },

  async load(pg) {
    pg.data.busy = true;
    try {
      const d = await api("/api/games/clicker/state");
      if (!pg.alive) return;
      Object.assign(pg.data, { 
        coins: d.coins, today: d.today, 
        need_captcha: d.need_captcha, captcha: d.captcha || null,
        clickPower: 1 + (d.clickLvl || 0), clickLvl: d.clickLvl || 0, passiveLvl: d.passiveLvl || 0 
      });
    } catch (e) { if (pg.alive) toast(e.message); }
    if (!pg.alive) return;
    pg.data.busy = false;
    GameClicker.draw(pg);
  },

  draw(pg) {
    const d = pg.data;
    const costPassive = 50 * Math.pow(1.8, d.passiveLvl);
    const costClick = 30 * Math.pow(1.6, d.clickLvl);

    pg.set(`
      <div class="g-wallet-box">
        <div class="g-wallet">${SI.bolt}<b>${d.coins}</b><small>${esc(T("монет"))}</small></div>
        <div class="g-today">${esc(T("Сегодня: {0} | Доход/сек: +{1}", d.today, d.passiveLvl))}</div>
      </div>
      
      ${d.need_captcha ? GameClicker.captchaHTML(d) : `
        <div class="g-tap-area">
          <button class="g-coin-3d" data-a="tap" ${d.busy ? "disabled" : ""}>
            <div class="g-coin-inner">🪙</div>
          </button>
        </div>
        
        <div class="g-shop">
          <div class="g-shop-title">📦 ${esc(T("Магазин улучшений"))}</div>
          <div class="g-upgrades">
            <button class="g-up-btn" data-a="upgrade" data-v="click" ${d.coins < costClick ? "disabled" : ""}>
              <div class="up-info"><b>👆 Сила клика (+1)</b><small>Уровень ${d.clickLvl}</small></div>
              <div class="up-price">🪙 ${Math.round(costClick)}</div>
            </button>
            <button class="g-up-btn" data-a="upgrade" data-v="passive" ${d.coins < costPassive ? "disabled" : ""}>
              <div class="up-info"><b>⚡ Авто-тапер (+1/сек)</b><small>Уровень ${d.passiveLvl}</small></div>
              <div class="up-price">🪙 ${Math.round(costPassive)}</div>
            </button>
          </div>
        </div>
        <p class="g-hint">${esc(T("Каждые 40 тапов — проверка на анти-бот"))}</p>`}
    `);
  },

  captchaHTML(d) {
    return `<div class="g-cap">
      <div class="g-cap-icon">🛡️</div>
      <p>${esc(T("Подтвердите, что вы не бот:"))}</p>
      <b class="g-capq">${esc(d.captcha || "")}</b>
      <input class="g-capin" data-i="capval" type="number" inputmode="numeric" placeholder="${esc(T("Введите ответ"))}" value="${esc(d.capval || "")}" ${d.busy ? "disabled" : "autofocus"}>
      ${d.caperr ? `<small class="g-caperr">${esc(d.caperr)}</small>` : ""}
      <button class="pbtn" data-a="capsend" ${d.busy ? "disabled" : ""}>${esc(T("Проверить"))}</button>
    </div>`;
  },

  async tap(pg, e) {
    const d = pg.data;
    if (d.busy || d.need_captcha) return;
    haptic();

    // Создаем летящий текст "+N" в месте клика
    const btn = pg.el.querySelector(".g-coin-3d");
    if (btn) {
      const rect = btn.getBoundingClientRect();
      const x = (e && e.clientX) ? e.clientX - rect.left : rect.width / 2;
      const y = (e && e.clientY) ? e.clientY - rect.top : rect.height / 2;
      const floatEl = document.createElement("div");
      floatEl.className = "g-floating-num";
      floatEl.textContent = "+" + d.clickPower;
      floatEl.style.left = x + "px";
      floatEl.style.top = y + "px";
      btn.appendChild(floatEl);
      setTimeout(() => floatEl.remove(), 800);
    }

    try {
      const r = await api("/api/games/clicker/click", { method: "POST" });
      if (!pg.alive) return;
      d.coins = r.coins;
      if (r.need_captcha) { d.need_captcha = true; d.captcha = r.captcha || null; d.caperr = ""; d.capval = ""; }
      else d.today += d.clickPower;
      GameClicker.draw(pg);
    } catch (e) {
      if (!pg.alive) return;
      toast(e.message);
      GameClicker.load(pg);
    }
  },

  async buyUpgrade(pg, type) {
    const d = pg.data;
    haptic("medium");
    if (type === "click") {
      const cost = Math.round(30 * Math.pow(1.6, d.clickLvl));
      if (d.coins < cost) return toast(T("Недостаточно монет"));
      d.coins -= cost;
      d.clickLvl++;
      d.clickPower = 1 + d.clickLvl;
    } else if (type === "passive") {
      const cost = Math.round(50 * Math.pow(1.8, d.passiveLvl));
      if (d.coins < cost) return toast(T("Недостаточно монет"));
      d.coins -= cost;
      d.passiveLvl++;
    }
    GameClicker.draw(pg);
    // Синхронизируем с сервером
    api("/api/games/clicker/click", { method: "POST" }).catch(()=>{});
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
      haptic("medium"); toast(T("Проверка успешно пройдена!"));
      GameClicker.draw(pg);
    } catch (e) {
      if (!pg.alive) return;
      d.busy = false;
      d.caperr = e.message || T("Неверно, попробуйте ещё раз");
      d.capval = "";
      GameClicker.load(pg);
    }
  },
};
