// game2048.js — классическая «2048». Чистая игровая логика в G2048 (без DOM, легко тестируется
// отдельно), экран и управление — в Game2048 (использует каркас страниц Pg и игровые сессии).

const G2048 = {
  SIZE: 4,

  newGrid() {
    const g = new Array(G2048.SIZE * G2048.SIZE).fill(0);
    G2048.spawn(g); G2048.spawn(g);
    return g;
  },

  // добавляет новую плитку (2 — 90%, 4 — 10%) в случайную пустую клетку; false, если пусто нет
  spawn(g) {
    const empty = [];
    for (let i = 0; i < g.length; i++) if (!g[i]) empty.push(i);
    if (!empty.length) return false;
    g[empty[Math.floor(Math.random() * empty.length)]] = Math.random() < 0.9 ? 2 : 4;
    return true;
  },

  // сдвигает и один раз объединяет равные соседние значения в ряду влево; без мутации входа
  slideLeft(row) {
    const vals = row.filter((v) => v);
    const out = [];
    let gained = 0, merged = false;
    for (let i = 0; i < vals.length; i++) {
      if (i < vals.length - 1 && vals[i] === vals[i + 1]) { out.push(vals[i] * 2); gained += vals[i] * 2; i++; merged = true; }
      else out.push(vals[i]);
    }
    while (out.length < row.length) out.push(0);
    const moved = merged || out.some((v, i) => v !== row[i]);
    return { row: out, gained, moved };
  },

  getLine(g, i, horiz, rev) {
    const a = [];
    for (let k = 0; k < G2048.SIZE; k++) a.push(horiz ? g[i * G2048.SIZE + k] : g[k * G2048.SIZE + i]);
    return rev ? a.reverse() : a;
  },
  setLine(g, i, line, horiz, rev) {
    const a = rev ? line.slice().reverse() : line;
    for (let k = 0; k < G2048.SIZE; k++) { if (horiz) g[i * G2048.SIZE + k] = a[k]; else g[k * G2048.SIZE + i] = a[k]; }
  },

  // dir: 'left' | 'right' | 'up' | 'down' — возвращает новую сетку, не мутирует переданную
  move(g, dir) {
    const out = g.slice();
    const horiz = dir === "left" || dir === "right";
    const rev = dir === "right" || dir === "down";
    let gained = 0, moved = false;
    for (let i = 0; i < G2048.SIZE; i++) {
      const { row, gained: gn, moved: mv } = G2048.slideLeft(G2048.getLine(out, i, horiz, rev));
      G2048.setLine(out, i, row, horiz, rev);
      gained += gn; moved = moved || mv;
    }
    return { grid: out, gained, moved };
  },

  canMove(g) {
    return ["left", "right", "up", "down"].some((d) => G2048.move(g, d).moved);
  },

  maxTile(g) { return g.reduce((m, v) => Math.max(m, v), 0); },
};

const Game2048 = {
  cur: null,

  open() {
    let pg;
    const onKey = (e) => {
      if (!pg || !pg.alive) return;
      const m = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" }[e.key];
      if (m) { e.preventDefault(); Game2048.act(pg, m); }
    };
    pg = Pg.open({
      title: T("2048"), cls: "gameplay g2048",
      right: `<button class="icon-btn" data-a="lb" aria-label="${esc(T("Таблица лидеров"))}">${SI.stats}</button>`,
      data: { grid: G2048.newGrid(), score: 0, over: false, session: null },
      build: (p) => Game2048.draw(p),
      onClose: () => { document.removeEventListener("keydown", onKey); Game2048.cur = null; },
    });
    Game2048.cur = pg;
    pg.on.lb = () => Games.leaderboard("2048", "2048");
    pg.on.restart = () => Game2048.restart(pg);
    document.addEventListener("keydown", onKey);
    GameSession.start("2048").then((s) => { if (pg.alive) pg.data.session = s; });
    Game2048.bindTouch(pg);
  },

  restart(pg) {
    pg.data.grid = G2048.newGrid(); pg.data.score = 0; pg.data.over = false;
    Game2048.draw(pg);
    GameSession.start("2048").then((s) => { if (pg.alive) pg.data.session = s; });
  },

  // делегирование на устойчивый pg.el: .g-stage пересоздаётся при каждой отрисовке
  bindTouch(pg) {
    let sx = 0, sy = 0, on = false;
    pg.el.addEventListener("touchstart", (e) => {
      if (!e.target.closest(".g-stage")) return;
      const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; on = true;
    }, { passive: true });
    pg.el.addEventListener("touchend", (e) => {
      if (!on) return; on = false;
      const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      Game2048.act(pg, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
    }, { passive: true });
  },

  act(pg, dir) {
    if (pg.data.over) return;
    const { grid, gained, moved } = G2048.move(pg.data.grid, dir);
    if (!moved) return;
    G2048.spawn(grid);
    pg.data.grid = grid;
    pg.data.score += gained;
    haptic();
    if (!G2048.canMove(grid)) { pg.data.over = true; Game2048.finish(pg); }
    Game2048.draw(pg);
  },

  finish(pg) {
    if (pg.data.session) { GameSession.submit(pg.data.session, pg.data.score); pg.data.session = null; }
  },

  draw(pg) {
    const d = pg.data;
    const tiles = d.grid.map((v) => `<div class="g-tile" data-v="${v || ""}">${v || ""}</div>`).join("");
    pg.set(`
      <div class="g-hud"><div class="g-hudv"><small>${esc(T("Очки"))}</small><b>${d.score}</b></div>
        <button class="g-restart" data-a="restart" aria-label="${esc(T("Заново"))}">${SI.shuffle}</button></div>
      <div class="g-stage"><div class="g-tiles">${tiles}</div>
        ${d.over ? `<div class="g-over"><p>${esc(T("Игра окончена"))}</p><button class="pbtn" data-a="restart">${esc(T("Играть снова"))}</button></div>` : ""}</div>
      <p class="g-hint">${esc(T("Свайп или стрелки — сдвинуть плитки"))}</p>
    `);
  },
};
