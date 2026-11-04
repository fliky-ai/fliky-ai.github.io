// gameblocks.js — «Block Blast»: ставим фигуры на поле 8×8, полные строки/столбцы очищаются.
// Чистая логика в GBlocks (без DOM — тестируется отдельно). Управление: тап по фигуре в лотке,
// затем тап по клетке поля — без перетаскивания, чтобы не зависеть от сложной обработки касаний.

const GBlocks = {
  SIZE: 8,
  // все фигуры заданы так, что их верхний левый угол — (0,0) (минимальные dr/dc равны 0)
  SHAPES: [
    [[0, 0]],
    [[0, 0], [0, 1]],
    [[0, 0], [1, 0]],
    [[0, 0], [0, 1], [0, 2]],
    [[0, 0], [1, 0], [2, 0]],
    [[0, 0], [0, 1], [0, 2], [0, 3]],
    [[0, 0], [1, 0], [2, 0], [3, 0]],
    [[0, 0], [0, 1], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]],
    [[0, 0], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [1, 1]],
    [[0, 1], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [1, 0]],
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[0, 1], [1, 0], [1, 1], [2, 0]],
    [[0, 0], [0, 1], [0, 2], [1, 1]],
    [[0, 1], [1, 0], [1, 1], [1, 2]],
  ],

  newGrid() { return new Array(GBlocks.SIZE * GBlocks.SIZE).fill(0); },

  randomPiece() {
    return { shape: GBlocks.SHAPES[Math.floor(Math.random() * GBlocks.SHAPES.length)], color: 1 + Math.floor(Math.random() * 6) };
  },
  randomPieces(n = 3) { return Array.from({ length: n }, GBlocks.randomPiece); },

  canPlace(grid, shape, r, c) {
    for (const [dr, dc] of shape) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= GBlocks.SIZE || cc >= GBlocks.SIZE) return false;
      if (grid[rr * GBlocks.SIZE + cc]) return false;
    }
    return true;
  },

  place(grid, shape, r, c, color) {
    const g = grid.slice();
    for (const [dr, dc] of shape) g[(r + dr) * GBlocks.SIZE + (c + dc)] = color;
    return g;
  },

  // очищает полностью заполненные строки и столбцы; возвращает { grid, lines }
  clearFull(grid) {
    const N = GBlocks.SIZE;
    const fullRows = [], fullCols = [];
    for (let r = 0; r < N; r++) { let full = true; for (let c = 0; c < N; c++) if (!grid[r * N + c]) { full = false; break; } if (full) fullRows.push(r); }
    for (let c = 0; c < N; c++) { let full = true; for (let r = 0; r < N; r++) if (!grid[r * N + c]) { full = false; break; } if (full) fullCols.push(c); }
    if (!fullRows.length && !fullCols.length) return { grid, lines: 0 };
    const g = grid.slice();
    for (const r of fullRows) for (let c = 0; c < N; c++) g[r * N + c] = 0;
    for (const c of fullCols) for (let r = 0; r < N; r++) g[r * N + c] = 0;
    return { grid: g, lines: fullRows.length + fullCols.length };
  },

  anyMoveLeft(grid, pieces) {
    for (const p of pieces) {
      if (!p) continue;
      for (let r = 0; r < GBlocks.SIZE; r++) for (let c = 0; c < GBlocks.SIZE; c++) if (GBlocks.canPlace(grid, p.shape, r, c)) return true;
    }
    return false;
  },
};

const GameBlocks = {
  cur: null,

  open() {
    const pg = Pg.open({
      title: T("Block Blast"), cls: "gameplay gblocks",
      right: `<button class="icon-btn" data-a="lb" aria-label="${esc(T("Таблица лидеров"))}">${SI.stats}</button>`,
      data: { grid: GBlocks.newGrid(), pieces: GBlocks.randomPieces(3), score: 0, over: false, session: null, sel: null },
      build: (p) => GameBlocks.draw(p),
      onClose: () => { GameBlocks.cur = null; },
    });
    GameBlocks.cur = pg;
    pg.on.lb = () => Games.leaderboard("block_blast", "Block Blast");
    pg.on.restart = () => GameBlocks.restart(pg);
    pg.on.selp = (el) => { pg.data.sel = pg.data.sel === +el.dataset.v ? null : +el.dataset.v; GameBlocks.draw(pg); };
    pg.on.cell = (el) => GameBlocks.tryPlace(pg, +el.dataset.v);
    GameSession.start("block_blast").then((s) => { if (pg.alive) pg.data.session = s; });
  },

  restart(pg) {
    pg.data.grid = GBlocks.newGrid(); pg.data.pieces = GBlocks.randomPieces(3);
    pg.data.score = 0; pg.data.over = false; pg.data.sel = null;
    GameBlocks.draw(pg);
    GameSession.start("block_blast").then((s) => { if (pg.alive) pg.data.session = s; });
  },

  tryPlace(pg, idx) {
    const d = pg.data;
    if (d.sel == null) return toast(T("Сначала выберите фигуру внизу"));
    const piece = d.pieces[d.sel];
    const r = Math.floor(idx / GBlocks.SIZE), c = idx % GBlocks.SIZE;
    if (!piece || !GBlocks.canPlace(d.grid, piece.shape, r, c)) return toast(T("Сюда эту фигуру не поставить"));
    GameBlocks.commit(pg, d.sel, r, c);
  },

  commit(pg, idx, r, c) {
    const d = pg.data;
    const piece = d.pieces[idx];
    let grid = GBlocks.place(d.grid, piece.shape, r, c, piece.color);
    let gained = piece.shape.length;
    const { grid: g2, lines } = GBlocks.clearFull(grid);
    if (lines) { gained += lines * 18; haptic("medium"); } else haptic();
    d.grid = g2;
    d.score += gained;
    d.pieces[idx] = null;
    d.sel = null;
    if (d.pieces.every((p) => !p)) d.pieces = GBlocks.randomPieces(3);
    if (!GBlocks.anyMoveLeft(d.grid, d.pieces)) { d.over = true; GameBlocks.finish(pg); }
    GameBlocks.draw(pg);
  },

  finish(pg) {
    if (pg.data.session) { GameSession.submit(pg.data.session, pg.data.score); pg.data.session = null; }
  },

  pieceHTML(p) {
    let maxR = 0, maxC = 0;
    for (const [dr, dc] of p.shape) { maxR = Math.max(maxR, dr); maxC = Math.max(maxC, dc); }
    const set = new Set(p.shape.map(([dr, dc]) => dr + "," + dc));
    let html = `<div class="g-pmini" style="--cols:${maxC + 1};--rows:${maxR + 1}">`;
    for (let r = 0; r <= maxR; r++) for (let c = 0; c <= maxC; c++) html += `<i class="${set.has(r + "," + c) ? "on c" + p.color : ""}"></i>`;
    return html + "</div>";
  },

  draw(pg) {
    const d = pg.data;
    const selPiece = d.sel != null ? d.pieces[d.sel] : null;
    let cells = "";
    for (let i = 0; i < GBlocks.SIZE * GBlocks.SIZE; i++) {
      const v = d.grid[i];
      let cls = "g-bcell";
      if (v) cls += " c" + v;
      if (selPiece && !v) { const r = Math.floor(i / GBlocks.SIZE), c = i % GBlocks.SIZE; if (GBlocks.canPlace(d.grid, selPiece.shape, r, c)) cls += " cango"; }
      cells += `<button class="${cls}" data-a="cell" data-v="${i}"></button>`;
    }
    const tray = d.pieces.map((p, i) => p
      ? `<button class="g-piece${d.sel === i ? " sel" : ""}" data-a="selp" data-v="${i}">${GameBlocks.pieceHTML(p)}</button>`
      : `<div class="g-piece used"></div>`).join("");
    pg.set(`
      <div class="g-hud"><div class="g-hudv"><small>${esc(T("Очки"))}</small><b>${d.score}</b></div>
        <button class="g-restart" data-a="restart" aria-label="${esc(T("Заново"))}">${SI.shuffle}</button></div>
      <div class="g-stage"><div class="g-bgrid">${cells}</div>
        ${d.over ? `<div class="g-over"><p>${esc(T("Нет ходов — игра окончена"))}</p><button class="pbtn" data-a="restart">${esc(T("Играть снова"))}</button></div>` : ""}</div>
      <div class="g-tray">${tray}</div>
      <p class="g-hint">${esc(T("Выберите фигуру внизу, затем клетку на поле"))}</p>
    `);
  },
};
