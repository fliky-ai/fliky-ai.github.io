
// gameblocks.js — Block Blast (Оригинальная механика, плавная анимация перетаскивания, комбо и автосохранение)

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
    [[0, 0], [0, 1], [1, 0], [1, 1]], // Квадрат 2x2
    [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]], // Прямоугольник 2x3
    [[0, 0], [1, 0], [1, 1]], // Уголок
    [[0, 0], [0, 1], [1, 1]],
    [[0, 1], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [1, 0]],
    [[0, 0], [1, 0], [1, 1], [2, 1]], // Z-фигура
    [[0, 1], [1, 0], [1, 1], [2, 0]],
    [[0, 0], [0, 1], [0, 2], [1, 1]], // T-фигура
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
      if (grid[rr * GBlocks.SIZE + cc] !== 0) return false;
    }
    return true;
  },

  place(grid, shape, r, c, color) {
    const g = grid.slice();
    for (const [dr, dc] of shape) g[(r + dr) * GBlocks.SIZE + (c + dc)] = color;
    return g;
  },

  // Проверка линий и столбцов
  clearFull(grid) {
    const N = GBlocks.SIZE;
    const fullRows = [], fullCols = [];

    for (let r = 0; r < N; r++) {
      let full = true;
      for (let c = 0; c < N; c++) {
        if (!grid[r * N + c]) { full = false; break; }
      }
      if (full) fullRows.push(r);
    }

    for (let c = 0; c < N; c++) {
      let full = true;
      for (let r = 0; r < N; r++) {
        if (!grid[r * N + c]) { full = false; break; }
      }
      if (full) fullCols.push(c);
    }

    if (!fullRows.length && !fullCols.length) return { grid, lines: 0, clearedIndices: [] };

    const g = grid.slice();
    const clearedIndices = [];

    for (const r of fullRows) {
      for (let c = 0; c < N; c++) {
        g[r * N + c] = 0;
        clearedIndices.push(r * N + c);
      }
    }
    for (const c of fullCols) {
      for (let r = 0; r < N; r++) {
        g[r * N + c] = 0;
        clearedIndices.push(r * N + c);
      }
    }
    return { grid: g, lines: fullRows.length + fullCols.length, clearedIndices };
  },

  anyMoveLeft(grid, pieces) {
    for (const p of pieces) {
      if (!p) continue;
      for (let r = 0; r < GBlocks.SIZE; r++) {
        for (let c = 0; c < GBlocks.SIZE; c++) {
          if (GBlocks.canPlace(grid, p.shape, r, c)) return true;
        }
      }
    }
    return false;
  },
};

const GameBlocks = {
  cur: null,
  SAVE_KEY: "dicegram_blockblast_save",

  open() {
    const saved = GameBlocks.loadState();
    const pg = Pg.open({
      title: T("Block Blast"), cls: "gameplay gblocks-orig",
      data: saved || { 
        grid: GBlocks.newGrid(), 
        pieces: GBlocks.randomPieces(3), 
        score: 0, 
        coins: 1500, 
        combo: 0, 
        over: false, 
        session: null 
      },
      build: (p) => GameBlocks.draw(p),
      onClose: () => { GameBlocks.cur = null; },
    });
    GameBlocks.cur = pg;
    pg.on.restart = () => GameBlocks.restart(pg);
    pg.on.lb = () => Games.leaderboard("block_blast", "Block Blast");

    GameBlocks.bindDragAndDrop(pg);
    GameSession.start("block_blast").then((s) => { if (pg.alive) pg.data.session = s; });
  },

  saveState(data) {
    try {
      if (!data) {
        localStorage.removeItem(GameBlocks.SAVE_KEY);
        return;
      }
      const payload = {
        grid: data.grid,
        pieces: data.pieces,
        score: data.score,
        coins: data.coins,
        combo: data.combo,
        over: data.over
      };
      localStorage.setItem(GameBlocks.SAVE_KEY, JSON.stringify(payload));
    } catch(e) {}
  },

  loadState() {
    try {
      const raw = localStorage.getItem(GameBlocks.SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.grid) && Array.isArray(data.pieces)) {
        return data;
      }
    } catch(e) {}
    return null;
  },

  restart(pg) {
    pg.data.grid = GBlocks.newGrid();
    pg.data.pieces = GBlocks.randomPieces(3);
    pg.data.score = 0;
    pg.data.combo = 0;
    pg.data.over = false;
    GameBlocks.saveState(pg.data);
    GameBlocks.draw(pg);
    GameSession.start("block_blast").then((s) => { if (pg.alive) pg.data.session = s; });
  },

  // Плавный Drag-and-Drop с физикой следования за пальцем
  bindDragAndDrop(pg) {
    let draggingEl = null;
    let pieceIdx = null;
    let ghostEl = null;
    let startX = 0, startY = 0;

    pg.el.addEventListener("pointerdown", (e) => {
      const pieceBtn = e.target.closest(".g-orig-piece");
      if (!pieceBtn || pg.data.over) return;
      
      const idx = +pieceBtn.dataset.v;
      if (!pg.data.pieces[idx]) return;

      pieceIdx = idx;
      draggingEl = pieceBtn;
      
      const rect = pieceBtn.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;

      // Создаем "призрака" для плавно следующего блока за пальцем
      ghostEl = pieceBtn.cloneNode(true);
      ghostEl.classList.add("piece-ghost");
      ghostEl.style.width = rect.width + "px";
      ghostEl.style.height = rect.height + "px";
      ghostEl.style.left = (rect.left) + "px";
      ghostEl.style.top = (rect.top) + "px";
      document.body.appendChild(ghostEl);

      pieceBtn.style.opacity = "0.3";
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    });

    function onPointerMove(e) {
      if (!ghostEl) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      ghostEl.style.transform = `translate(${dx}px, ${dy}px) scale(1.15) translateY(-35px)`;

      // Подсветка ячеек сетки под пальцем
      const gridEl = pg.el.querySelector(".g-orig-grid");
      if (gridEl) {
        const cells = pg.el.querySelectorAll(".g-orig-cell");
        cells.forEach(c => c.classList.remove("hover-target"));

        const targetCell = document.elementFromPoint(e.clientX, e.clientY)?.closest(".g-orig-cell");
        if (targetCell) {
          const cellIdx = +targetCell.dataset.v;
          const piece = pg.data.pieces[pieceIdx];
          const r = Math.floor(cellIdx / GBlocks.SIZE), c = cellIdx % GBlocks.SIZE;
          if (piece && GBlocks.canPlace(pg.data.grid, piece.shape, r, c)) {
            piece.shape.forEach(([dr, dc]) => {
              const tIdx = (r + dr) * GBlocks.SIZE + (c + dc);
              const cEl = pg.el.querySelector(`[data-v="${tIdx}"]`);
              if (cEl) cEl.classList.add("hover-target");
            });
          }
        }
      }
    }

    function onPointerUp(e) {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);

      if (ghostEl) ghostEl.remove();
      if (draggingEl) draggingEl.style.opacity = "1";

      const targetCell = document.elementFromPoint(e.clientX, e.clientY)?.closest(".g-orig-cell");
      if (targetCell && pieceIdx !== null) {
        const cellIdx = +targetCell.dataset.v;
        const piece = pg.data.pieces[pieceIdx];
        const r = Math.floor(cellIdx / GBlocks.SIZE), c = cellIdx % GBlocks.SIZE;
        if (piece && GBlocks.canPlace(pg.data.grid, piece.shape, r, c)) {
          GameBlocks.commit(pg, pieceIdx, r, c);
        }
      }

      draggingEl = null;
      pieceIdx = null;
      ghostEl = null;
      GameBlocks.draw(pg);
    }
  },

  commit(pg, idx, r, c) {
    const d = pg.data;
    const piece = d.pieces[idx];
    
    // 1. Очки за размещение (по количеству блоков в фигуре)
    let gained = piece.shape.length;
    let grid = GBlocks.place(d.grid, piece.shape, r, c, piece.color);
    
    // 2. Проверка очистки линий
    const { grid: g2, lines, clearedIndices } = GBlocks.clearFull(grid);

    if (lines > 0) {
      d.combo++;
      // Формула геометрического роста очков комбо: 10 * линии * комбо
      gained += lines * 10 * d.combo;
      haptic("medium");
      
      // Запуск визуальной анимации взрыва/удаления плиток
      setTimeout(() => {
        clearedIndices.forEach(ci => {
          const cellEl = pg.el.querySelector(`[data-v="${ci}"]`);
          if (cellEl) {
            cellEl.classList.add("cell-exploding");
          }
        });
      }, 50);
    } else {
      // Если ход без взрыва линий, сбрасываем или уменьшаем комбо
      d.combo = 0;
      haptic();
    }

    d.grid = g2;
    d.score += gained;
    d.pieces[idx] = null;

    // 3. Если все 3 фигуры выставлены, генерируем новые 3
    if (d.pieces.every((p) => !p)) {
      d.pieces = GBlocks.randomPieces(3);
    }

    // 4. Проверка на GameOver (остались ли вообще ходы для доступных фигур)
    if (!GBlocks.anyMoveLeft(d.grid, d.pieces)) {
      d.over = true;
      GameBlocks.saveState(null); // очищаем сейв при проигрыше
      GameBlocks.finish(pg);
    } else {
      GameBlocks.saveState(d); // автосохранение прогресса
    }
  },

  finish(pg) {
    if (pg.data.session) {
      GameSession.submit(pg.data.session, pg.data.score);
      pg.data.session = null;
    }
  },

  pieceHTML(p) {
    let maxR = 0, maxC = 0;
    for (const [dr, dc] of p.shape) { maxR = Math.max(maxR, dr); maxC = Math.max(maxC, dc); }
    const set = new Set(p.shape.map(([dr, dc]) => dr + "," + dc));
    let html = `<div class="g-orig-pmini" style="--cols:${maxC + 1};--rows:${maxR + 1}">`;
    for (let r = 0; r <= maxR; r++) {
      for (let c = 0; c <= maxC; c++) {
        html += `<i class="${set.has(r + "," + c) ? "on c" + p.color : ""}"></i>`;
      }
    }
    return html + "</div>";
  },

  draw(pg) {
    const d = pg.data;
    let cells = "";
    for (let i = 0; i < GBlocks.SIZE * GBlocks.SIZE; i++) {
      const v = d.grid[i];
      cells += `<div class="g-orig-cell${v ? " c" + v + " filled" : ""}" data-v="${i}"></div>`;
    }

    const tray = d.pieces.map((p, i) => p
      ? `<div class="g-orig-piece" data-v="${i}">${GameBlocks.pieceHTML(p)}</div>`
      : `<div class="g-orig-piece empty"></div>`).join("");

    pg.set(`
      <div class="g-orig-header">
        <button class="g-orig-topbtn" data-a="restart">🟫 ${esc(T("Игра"))}</button>
        <button class="g-orig-topbtn" data-a="lb">🏆 ${esc(T("Топ"))}</button>
      </div>

      <div class="g-orig-scorebox">
        <div class="g-orig-coins">🪙 ${d.coins}</div>
        <div class="g-orig-mainscore">${d.score.toLocaleString()}</div>
        <div class="g-orig-topbar-right">
          <button class="g-orig-iconbtn" data-a="restart">🔄</button>
        </div>
      </div>

      ${d.combo > 1 ? `<div class="g-orig-combo">Комбо ×${d.combo} 🔥</div>` : ""}

      <div class="g-orig-stage">
        <div class="g-orig-grid">${cells}</div>
        ${d.over ? `<div class="g-over"><p>${esc(T("Игра окончена"))}</p><button class="pbtn" data-a="restart">${esc(T("Играть снова"))}</button></div>` : ""}
      </div>

      <div class="g-orig-tray">${tray}</div>
    `);
  },
};
