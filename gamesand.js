// gamesand.js — «Sand Fall»: тетрис с эффектом песка, физика падения песчинок и автоматическая очистка заполненных рядов.

const GSand = {
  COLS: 9, ROWS: 16,
  TICK_MS: 90,
  FALL_EVERY: 6,
  TYPES: ["I", "O", "T", "L", "J", "S", "Z"],
  COLORS: { I: 1, O: 2, T: 3, L: 4, J: 5, S: 6, Z: 7 },
  TETRO: {
    I: [[[1, 0], [1, 1], [1, 2], [1, 3]], [[0, 2], [1, 2], [2, 2], [3, 2]], [[2, 0], [2, 1], [2, 2], [2, 3]], [[0, 1], [1, 1], [2, 1], [3, 1]]],
    O: [[[1, 1], [1, 2], [2, 1], [2, 2]], [[1, 1], [1, 2], [2, 1], [2, 2]], [[1, 1], [1, 2], [2, 1], [2, 2]], [[1, 1], [1, 2], [2, 1], [2, 2]]],
    T: [[[0, 1], [1, 0], [1, 1], [1, 2]], [[0, 1], [1, 1], [1, 2], [2, 1]], [[1, 0], [1, 1], [1, 2], [2, 1]], [[0, 1], [1, 0], [1, 1], [2, 1]]],
    L: [[[0, 2], [1, 0], [1, 1], [1, 2]], [[0, 1], [1, 1], [2, 1], [2, 2]], [[1, 0], [1, 1], [1, 2], [2, 0]], [[0, 0], [0, 1], [1, 1], [2, 1]]],
    J: [[[0, 0], [1, 0], [1, 1], [1, 2]], [[0, 1], [0, 2], [1, 1], [2, 1]], [[1, 0], [1, 1], [1, 2], [2, 2]], [[0, 1], [1, 1], [2, 0], [2, 1]]],
    S: [[[0, 1], [0, 2], [1, 0], [1, 1]], [[0, 1], [1, 1], [1, 2], [2, 2]], [[1, 1], [1, 2], [2, 0], [2, 1]], [[0, 0], [1, 0], [1, 1], [2, 1]]],
    Z: [[[0, 0], [0, 1], [1, 1], [1, 2]], [[0, 2], [1, 1], [1, 2], [2, 1]], [[1, 0], [1, 1], [2, 1], [2, 2]], [[0, 1], [1, 0], [1, 1], [2, 0]]],
  },

  newGrid() { return new Array(GSand.COLS * GSand.ROWS).fill(0); },

  spawnPiece() {
    const type = GSand.TYPES[Math.floor(Math.random() * GSand.TYPES.length)];
    return { type, rot: 0, r: 0, c: Math.floor(GSand.COLS / 2) - 2, color: GSand.COLORS[type] };
  },

  cells(piece) { return GSand.TETRO[piece.type][piece.rot].map(([dr, dc]) => [piece.r + dr, piece.c + dc]); },

  fits(grid, piece) {
    for (const [r, c] of GSand.cells(piece)) {
      if (c < 0 || c >= GSand.COLS || r >= GSand.ROWS) return false;
      if (r >= 0 && grid[r * GSand.COLS + c]) return false;
    }
    return true;
  },

  tryMove(grid, piece, dr, dc) {
    const np = Object.assign({}, piece, { r: piece.r + dr, c: piece.c + dc });
    return GSand.fits(grid, np) ? np : null;
  },

  tryRotate(grid, piece) {
    const base = Object.assign({}, piece, { rot: (piece.rot + 1) % 4 });
    if (GSand.fits(grid, base)) return base;
    for (const dc of [-1, 1, -2, 2]) {
      const np = Object.assign({}, base, { c: base.c + dc });
      if (GSand.fits(grid, np)) return np;
    }
    return null;
  },

  dissolve(grid, piece) {
    const g = grid.slice();
    for (const [r, c] of GSand.cells(piece)) if (r >= 0 && r < GSand.ROWS && c >= 0 && c < GSand.COLS) g[r * GSand.COLS + c] = piece.color;
    return g;
  },

  settleStep(grid) {
    const g = grid.slice();
    let moved = false;
    for (let r = GSand.ROWS - 2; r >= 0; r--) {
      for (let c = 0; c < GSand.COLS; c++) {
        const i = r * GSand.COLS + c;
        if (!g[i]) continue;
        const below = i + GSand.COLS;
        if (!g[below]) { g[below] = g[i]; g[i] = 0; moved = true; continue; }
        const canL = c > 0 && !g[below - 1];
        const canR = c < GSand.COLS - 1 && !g[below + 1];
        if (canL && canR) {
          if (Math.random() < 0.5) { g[below - 1] = g[i]; g[i] = 0; } else { g[below + 1] = g[i]; g[i] = 0; }
          moved = true;
        } else if (canL) { g[below - 1] = g[i]; g[i] = 0; moved = true; }
        else if (canR) { g[below + 1] = g[i]; g[i] = 0; moved = true; }
      }
    }
    return { grid: g, moved };
  },

  clearFullRows(grid) {
    const full = [];
    for (let r = 0; r < GSand.ROWS; r++) {
      let ok = true;
      for (let c = 0; c < GSand.COLS; c++) if (!grid[r * GSand.COLS + c]) { ok = false; break; }
      if (ok) full.push(r);
    }
    if (!full.length) return { grid, lines: 0 };
    const g = grid.slice();
    for (const r of full) for (let c = 0; c < GSand.COLS; c++) g[r * GSand.COLS + c] = 0;
    return { grid: g, lines: full.length };
  },

  isOver(grid, piece) { return !GSand.fits(grid, piece); },
};

const GameSand = {
  cur: null, timer: null,

  initData() {
    return { grid: GSand.newGrid(), piece: GSand.spawnPiece(), score: 0, over: false, session: null, phase: "fall", tickN: 0 };
  },

  open() {
    let pg;
    const onKey = (e) => {
      if (!pg || !pg.alive || pg.data.phase !== "fall") return;
      if (e.key === "ArrowLeft") { e.preventDefault(); GameSand.moveH(pg, -1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); GameSand.moveH(pg, 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); GameSand.rotate(pg); }
      else if (e.key === "ArrowDown") { e.preventDefault(); GameSand.drop(pg); }
    };
    pg = Pg.open({
      title: T("Sand Fall"), cls: "gameplay gsand",
      right: `<button class="icon-btn" data-a="lb" aria-label="${esc(T("Таблица лидеров"))}">${SI.stats}</button>`,
      data: GameSand.initData(),
      build: (p) => GameSand.draw(p),
      onClose: () => { clearInterval(GameSand.timer); GameSand.timer = null; document.removeEventListener("keydown", onKey); GameSand.cur = null; },
    });
    GameSand.cur = pg;
    pg.on.lb = () => Games.leaderboard("sand", "Sand Fall");
    pg.on.restart = () => GameSand.restart(pg);
    pg.on.left = () => GameSand.moveH(pg, -1);
    pg.on.right = () => GameSand.moveH(pg, 1);
    pg.on.rot = () => GameSand.rotate(pg);
    pg.on.drop = () => GameSand.drop(pg);
    document.addEventListener("keydown", onKey);
    GameSession.start("sand").then((s) => { if (pg.alive) pg.data.session = s; });
    clearInterval(GameSand.timer);
    GameSand.timer = setInterval(() => GameSand.tick(pg), GSand.TICK_MS);
  },

  restart(pg) {
    Object.assign(pg.data, GameSand.initData());
    GameSand.draw(pg);
    GameSession.start("sand").then((s) => { if (pg.alive) pg.data.session = s; });
  },

  moveH(pg, dc) {
    const d = pg.data;
    if (d.phase !== "fall" || d.over) return;
    const np = GSand.tryMove(d.grid, d.piece, 0, dc);
    if (np) { d.piece = np; GameSand.draw(pg); }
  },

  rotate(pg) {
    const d = pg.data;
    if (d.phase !== "fall" || d.over) return;
    const np = GSand.tryRotate(d.grid, d.piece);
    if (np) { d.piece = np; haptic(); GameSand.draw(pg); }
  },

  drop(pg) {
    const d = pg.data;
    if (d.phase !== "fall" || d.over) return;
    let p = d.piece, np;
    while ((np = GSand.tryMove(d.grid, p, 1, 0))) p = np;
    d.piece = p;
    haptic("medium");
    GameSand.land(pg);
  },

  land(pg) {
    const d = pg.data;
    d.grid = GSand.dissolve(d.grid, d.piece);
    d.piece = null;
    d.phase = "settle";
    GameSand.draw(pg);
  },

  tick(pg) {
    if (!pg.alive) { clearInterval(GameSand.timer); GameSand.timer = null; return; }
    const d = pg.data;
    if (d.over) return;
    if (d.phase === "fall") {
      d.tickN++;
      if (d.tickN < GSand.FALL_EVERY) return;
      d.tickN = 0;
      const np = GSand.tryMove(d.grid, d.piece, 1, 0);
      if (np) { d.piece = np; GameSand.draw(pg); } else GameSand.land(pg);
      return;
    }
    if (d.phase === "settle") {
      const { grid, moved } = GSand.settleStep(d.grid);
      d.grid = grid;
      if (moved) return GameSand.draw(pg);
      d.phase = "clear";
      return GameSand.tick(pg);
    }
    if (d.phase === "clear") {
      const { grid, lines } = GSand.clearFullRows(d.grid);
      d.grid = grid;
      d.score += 1 + lines * 25;
      if (lines) haptic("medium");
      const np = GSand.spawnPiece();
      if (GSand.isOver(d.grid, np)) { d.over = true; d.phase = "over"; GameSand.finish(pg); }
      else { d.piece = np; d.phase = "fall"; d.tickN = 0; }
      GameSand.draw(pg);
    }
  },

  finish(pg) {
    if (pg.data.session) { GameSession.submit(pg.data.session, pg.data.score); pg.data.session = null; }
  },

  draw(pg) {
    const d = pg.data;
    const grid = d.piece ? GSand.dissolve(d.grid, d.piece) : d.grid;
    let cells = "";
    for (let i = 0; i < grid.length; i++) cells += `<i class="${grid[i] ? "c" + grid[i] : ""}"></i>`;
    pg.set(`
      <div class="g-hud"><div class="g-hudv"><small>${esc(T("Очки"))}</small><b>${d.score}</b></div>
        <button class="g-restart" data-a="restart" aria-label="${esc(T("Заново"))}">${SI.shuffle}</button></div>
      <div class="g-stage"><div class="g-sgrid" style="--cols:${GSand.COLS};--rows:${GSand.ROWS}">${cells}</div>
        ${d.over ? `<div class="g-over"><p>${esc(T("Игра окончена"))}</p><button class="pbtn" data-a="restart">${esc(T("Играть снова"))}</button></div>` : ""}</div>
      <div class="g-ctl">
        <button class="g-cbtn" data-a="left" aria-label="${esc(T("Влево"))}">${SI.back}</button>
        <button class="g-cbtn" data-a="rot" aria-label="${esc(T("Повернуть"))}">${SI.shuffle}</button>
        <button class="g-cbtn" data-a="drop" aria-label="${esc(T("Вниз"))}">${SI.down}</button>
        <button class="g-cbtn" data-a="right" aria-label="${esc(T("Вправо"))}">${SI.fwd}</button>
      </div>
    `);
  },
};

