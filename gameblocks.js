// gameblocks.js — Block Blast (исправленный Drag-and-Drop, анимация линий, без багов «не ставится»)

const GBlocks = {
  SIZE: 8,
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
    return {
      shape: GBlocks.SHAPES[Math.floor(Math.random() * GBlocks.SHAPES.length)],
      color: 1 + Math.floor(Math.random() * 6)
    };
  },
  randomPieces(n = 3) { return Array.from({ length: n }, GBlocks.randomPiece); },

  canPlace(grid, shape, r, c) {
    for (const [dr, dc] of shape) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= GBlocks.SIZE || cc >= GBlocks.SIZE) return false;
      if (grid[rr * GBlocks.SIZE + cc] !== 0) return false;
    }
    return true;
  },

  place(grid, shape, r, c, color) {
    const g = grid.slice();
    for (const [dr, dc] of shape) g[(r + dr) * GBlocks.SIZE + (c + dc)] = color;
    return g;
  },

  clearFull(grid) {
    const N = GBlocks.SIZE;
    const fullRows = [], fullCols = [];

    for (let r = 0; r < N; r++) {
      let full = true;
      for (let c = 0; c < N; c++) if (!grid[r * N + c]) { full = false; break; }
      if (full) fullRows.push(r);
    }
    for (let c = 0; c < N; c++) {
      let full = true;
      for (let r = 0; r < N; r++) if (!grid[r * N + c]) { full = false; break; }
      if (full) fullCols.push(c);
    }
    if (!fullRows.length && !fullCols.length) return { grid, lines: 0, clearedIndices: [] };

    const g = grid.slice();
    const clearedIndices = [];
    for (const r of fullRows) for (let c = 0; c < N; c++) { g[r * N + c] = 0; clearedIndices.push(r * N + c); }
    for (const c of fullCols) for (let r = 0; r < N; r++) { g[r * N + c] = 0; clearedIndices.push(r * N + c); }
    return { grid: g, lines: fullRows.length + fullCols.length, clearedIndices };
  },

  anyMoveLeft(grid, pieces) {
    for (const p of pieces) {
      if (!p) continue;
      for (let r = 0; r < GBlocks.SIZE; r++)
        for (let c = 0; c < GBlocks.SIZE; c++)
          if (GBlocks.canPlace(grid, p.shape, r, c)) return true;
    }
    return false;
  },
};

const GameBlocks = {
  cur: null,
  SAVE_KEY: "dicegram_blockblast_save_v2",

  open() {
    const saved = GameBlocks.loadState();
    const pg = Pg.open({
      title: T("Block Blast"), cls: "gameplay gblocks-clean",
      data: saved || {
        grid: GBlocks.newGrid(),
        pieces: GBlocks.randomPieces(3),
        score: 0,
        combo: 0,
        over: false,
        showModal: false,
        session: null
      },
      build: (p) => GameBlocks.draw(p),
      onClose: () => { GameBlocks.cur = null; },
    });
    GameBlocks.cur = pg;
    pg.on.askRestart = () => { pg.data.showModal = true; GameBlocks.draw(pg); };
    pg.on.confirmRestart = () => { pg.data.showModal = false; GameBlocks.restart(pg); };
    pg.on.cancelRestart = () => { pg.data.showModal = false; GameBlocks.draw(pg); };
    pg.on.back = () => Pg.back();

    GameBlocks.bindDragAndDrop(pg);
    if (typeof GameSession !== "undefined" && GameSession.start) {
      GameSession.start("block_blast").then((s) => { if (pg.alive) pg.data.session = s; });
    }
  },

  saveState(data) {
    try {
      if (!data) { localStorage.removeItem(GameBlocks.SAVE_KEY); return; }
      localStorage.setItem(GameBlocks.SAVE_KEY, JSON.stringify({
        grid: data.grid, pieces: data.pieces, score: data.score, combo: data.combo, over: data.over
      }));
    } catch (e) {}
  },

  loadState() {
    try {
      const raw = localStorage.getItem(GameBlocks.SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.grid) && Array.isArray(data.pieces)) return data;
    } catch (e) {}
    return null;
  },

  restart(pg) {
    pg.data.grid = GBlocks.newGrid();
    pg.data.pieces = GBlocks.randomPieces(3);
    pg.data.score = 0;
    pg.data.combo = 0;
    pg.data.over = false;
    pg.data.showModal = false;
    GameBlocks.saveState(pg.data);
    GameBlocks.draw(pg);
    if (typeof GameSession !== "undefined" && GameSession.start) {
      GameSession.start("block_blast").then((s) => { if (pg.alive) pg.data.session = s; });
    }
  },

  // ===== ИСПРАВЛЕННЫЙ Drag-and-Drop =====
  bindDragAndDrop(pg) {
    let ghostEl = null;
    let pieceIdx = null;
    let startX = 0, startY = 0;
    let lastCell = null;      // последняя валидная ячейка под пальцем
    let lastR = -1, lastC = -1;

    const clearHover = () => {
      pg.el.querySelectorAll(".g-clean-cell.hover-target").forEach(c => c.classList.remove("hover-target"));
      lastCell = null; lastR = -1; lastC = -1;
    };

    const highlight = (r, c, piece) => {
      clearHover();
      if (!piece) return;
      if (!GBlocks.canPlace(pg.data.grid, piece.shape, r, c)) return;
      lastR = r; lastC = c;
      piece.shape.forEach(([dr, dc]) => {
        const tIdx = (r + dr) * GBlocks.SIZE + (c + dc);
        const cEl = pg.el.querySelector(`[data-v="${tIdx}"]`);
        if (cEl) cEl.classList.add("hover-target");
      });
    };

    pg.el.addEventListener("pointerdown", (e) => {
      const pieceEl = e.target.closest(".g-clean-piece");
      if (!pieceEl || pg.data.over || pg.data.showModal) return;
      const idx = +pieceEl.dataset.v;
      if (!pg.data.pieces[idx]) return;

      e.preventDefault();
      pieceIdx = idx;
      const rect = pieceEl.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;

      ghostEl = pieceEl.cloneNode(true);
      ghostEl.className = "piece-ghost-clean";
      ghostEl.style.width = rect.width + "px";
      ghostEl.style.height = rect.height + "px";
      ghostEl.style.left = rect.left + "px";
      ghostEl.style.top = rect.top + "px";
      ghostEl.style.transform = "translate(0,0) scale(1.15)";
      document.body.appendChild(ghostEl);
      pieceEl.style.opacity = "0.25";

      // фиксируем палец, чтобы не скроллилось
      document.body.style.touchAction = "none";

      document.addEventListener("pointermove", onPointerMove, { passive: false });
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("pointercancel", onPointerUp);
    });

    function onPointerMove(e) {
      if (!ghostEl) return;
      e.preventDefault();
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      // фигура центрируется под пальцем, но чуть выше, чтобы палец не закрывал
      ghostEl.style.transform = `translate(${dx}px, ${dy}px) scale(1.15) translateY(-40px)`;

      // ищем ячейку под пальцем, но с поправкой на смещение ghost (палец ниже центра фигуры)
      const px = e.clientX;
      const py = e.clientY - 10;   // чуть выше пальца
      const el = document.elementFromPoint(px, py);
      const targetCell = el && el.closest ? el.closest(".g-clean-cell") : null;

      if (targetCell) {
        const cellIdx = +targetCell.dataset.v;
        const piece = pg.data.pieces[pieceIdx];
        const r = Math.floor(cellIdx / GBlocks.SIZE), c = cellIdx % GBlocks.SIZE;
        highlight(r, c, piece);
      } else {
        clearHover();
      }
    }

    function onPointerUp(e) {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
      document.body.style.touchAction = "";

      if (ghostEl) { ghostEl.remove(); ghostEl = null; }
      const origPiece = pg.el.querySelector(`.g-clean-piece[data-v="${pieceIdx}"]`);
      if (origPiece) origPiece.style.opacity = "1";

      const piece = pieceIdx !== null ? pg.data.pieces[pieceIdx] : null;
      const r = lastR, c = lastC;
      clearHover();

      if (piece && r >= 0 && c >= 0 && GBlocks.canPlace(pg.data.grid, piece.shape, r, c)) {
        GameBlocks.commit(pg, pieceIdx, r, c);
      } else {
        GameBlocks.draw(pg);
      }
      pieceIdx = null;
    }
  },

  commit(pg, idx, r, c) {
    const d = pg.data;
    const piece = d.pieces[idx];
    let gained = piece.shape.length;
    let grid = GBlocks.place(d.grid, piece.shape, r, c, piece.color);
    const { grid: g2, lines, clearedIndices } = GBlocks.clearFull(grid);

    if (lines > 0) {
      d.combo++;
      gained += lines * 10 * d.combo;
      if (typeof haptic === "function") haptic("medium");
    } else {
      d.combo = 0;
      if (typeof haptic === "function") haptic();
    }

    d.grid = g2;
    d.score += gained;
    d.pieces[idx] = null;
    if (d.pieces.every((p) => !p)) d.pieces = GBlocks.randomPieces(3);

    // сначала рисуем с анимацией взрыва, потом через 320мс — чисто
    if (lines > 0) {
      GameBlocks.draw(pg, { explode: clearedIndices });
      setTimeout(() => {
        if (!pg.alive) return;
        if (!GBlocks.anyMoveLeft(d.grid, d.pieces)) {
          d.over = true;
          GameBlocks.saveState(null);
          GameBlocks.finish(pg);
        } else {
          GameBlocks.saveState(d);
        }
        GameBlocks.draw(pg);
      }, 320);
    } else {
      if (!GBlocks.anyMoveLeft(d.grid, d.pieces)) {
        d.over = true;
        GameBlocks.saveState(null);
        GameBlocks.finish(pg);
      } else {
        GameBlocks.saveState(d);
      }
      GameBlocks.draw(pg);
    }
  },

  finish(pg) {
    if (pg.data.session && typeof GameSession !== "undefined" && GameSession.submit) {
      GameSession.submit(pg.data.session, pg.data.score);
      pg.data.session = null;
    }
  },

  pieceHTML(p) {
    let maxR = 0, maxC = 0;
    for (const [dr, dc] of p.shape) { maxR = Math.max(maxR, dr); maxC = Math.max(maxC, dc); }
    const set = new Set(p.shape.map(([dr, dc]) => dr + "," + dc));
    let html = `<div class="g-clean-pmini" style="--cols:${maxC + 1};--rows:${maxR + 1}">`;
    for (let r = 0; r <= maxR; r++)
      for (let c = 0; c <= maxC; c++)
        html += `<i class="${set.has(r + "," + c) ? "on c" + p.color : ""}"></i>`;
    return html + "</div>";
  },

  draw(pg, opts) {
    const d = pg.data;
    const explode = opts && opts.explode ? new Set(opts.explode) : null;

    let cells = "";
    for (let i = 0; i < GBlocks.SIZE * GBlocks.SIZE; i++) {
      const v = d.grid[i];
      const exp = explode && explode.has(i) ? " cell-exploding" : "";
      cells += `<div class="g-clean-cell${v ? " c" + v + " filled" : ""}${exp}" data-v="${i}"></div>`;
    }

    const tray = d.pieces.map((p, i) =>
      p ? `<div class="g-clean-piece" data-v="${i}">${GameBlocks.pieceHTML(p)}</div>`
        : `<div class="g-clean-piece empty"></div>`
    ).join("");

    pg.set(`
      <div class="g-clean-header">
        <button class="g-clean-btn" data-a="back">‹</button>
        <div class="g-clean-scorebox">
          <div class="g-clean-mainscore">${d.score.toLocaleString()}</div>
        </div>
        <button class="g-clean-btn" data-a="askRestart">🔄</button>
      </div>

      ${d.combo > 1 ? `<div class="g-clean-combo">Комбо ×${d.combo} 🔥</div>` : ""}

      <div class="g-clean-stage">
        <div class="g-clean-grid">${cells}</div>
        ${d.over ? `<div class="g-over"><p>${esc(T("Игра окончена"))}</p><button class="pbtn" data-a="restart">${esc(T("Играть снова"))}</button></div>` : ""}
      </div>

      <div class="g-clean-tray">${tray}</div>

      ${d.showModal ? `
        <div class="g-modal-backdrop">
          <div class="g-modal-dialog">
            <h3>${esc(T("Начать игру заново?"))}</h3>
            <p>${esc(T("Текущий прогресс и очки будут сброшены."))}</p>
            <div class="g-modal-actions">
              <button class="pbtn alt" data-a="cancelRestart">${esc(T("Нет"))}</button>
              <button class="pbtn" data-a="confirmRestart">${esc(T("Да"))}</button>
            </div>
          </div>
        </div>` : ""}
    `);
  },
};
