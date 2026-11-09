// gameblocks.js — «Block Blast»: ставим фигуры на поле 8×8, полные строки/столбцы очищаются.
// Чистая логика — в GBlocks (без DOM, тестируется отдельно). Экран — GameBlocks: фигуры берутся
// пальцем из лотка и перетаскиваются на поле (над пальцем «висит» тень-призрак, клетки назначения
// подсвечиваются, линии, которые вот-вот очистятся, светятся). Отрисовка идёт ТОЧЕЧНО (меняются только
// классы клеток) — без перерисовки всего экрана на каждый ход, поэтому нет мерцания. Эффекты: «поп»
// блока при установке, растворение линий с частицами (один <canvas>, цикл живёт только пока есть
// частицы), баннеры COMBO / MEGA COMBO / PERFECT. Всё, что запускается, останавливается в dispose().

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
  COLORS: ["#FF6B6B", "#4DABF7", "#51CF66", "#FFD43B", "#DA77F2", "#22D3C5"],   // цвет блока N = COLORS[N-1]

  newGrid() { return new Array(GBlocks.SIZE * GBlocks.SIZE).fill(0); },
  isEmpty(grid) { return grid.every((v) => !v); },

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

  // какие строки/столбцы заполнены целиком
  fullLines(grid) {
    const N = GBlocks.SIZE, rows = [], cols = [];
    for (let r = 0; r < N; r++) { let full = true; for (let c = 0; c < N; c++) if (!grid[r * N + c]) { full = false; break; } if (full) rows.push(r); }
    for (let c = 0; c < N; c++) { let full = true; for (let r = 0; r < N; r++) if (!grid[r * N + c]) { full = false; break; } if (full) cols.push(c); }
    return { rows, cols };
  },

  // очищает полностью заполненные строки и столбцы (разом — и строки, и столбцы, даже пересекающиеся);
  // возвращает { grid, lines, rows, cols }
  clearFull(grid) {
    const N = GBlocks.SIZE;
    const { rows, cols } = GBlocks.fullLines(grid);
    if (!rows.length && !cols.length) return { grid, lines: 0, rows, cols };
    const g = grid.slice();
    for (const r of rows) for (let c = 0; c < N; c++) g[r * N + c] = 0;
    for (const c of cols) for (let r = 0; r < N; r++) g[r * N + c] = 0;
    return { grid: g, lines: rows.length + cols.length, rows, cols };
  },

  anyMoveLeft(grid, pieces) {
    for (const p of pieces) {
      if (!p) continue;
      for (let r = 0; r < GBlocks.SIZE; r++) for (let c = 0; c < GBlocks.SIZE; c++) if (GBlocks.canPlace(grid, p.shape, r, c)) return true;
    }
    return false;
  },

  // очки: клетки фигуры + бонус за линии (растёт квадратично: 1 линия 10, 2 — 40, 3 — 90…) × комбо-множитель
  scoreFor(cells, lines, combo) {
    return cells + (lines ? lines * lines * 10 * Math.max(1, combo | 0) : 0);
  },

  // Можно ли выложить ВСЕ фигуры набора в каком-нибудь порядке (с учётом очистки линий между ходами).
  // Перебор с бюджетом шагов: если проверка слишком дорогая, считаем набор играбельным.
  solvable(grid, pieces, st) {
    st = st || { n: 0 };
    const rest = pieces.filter(Boolean);
    if (!rest.length) return true;
    if (st.n > 2500) return true;
    for (let i = 0; i < rest.length; i++) {
      const p = rest[i], others = rest.filter((_, j) => j !== i);
      for (let r = 0; r < GBlocks.SIZE; r++) {
        for (let c = 0; c < GBlocks.SIZE; c++) {
          if (!GBlocks.canPlace(grid, p.shape, r, c)) continue;
          st.n++;
          if (GBlocks.solvable(GBlocks.clearFull(GBlocks.place(grid, p.shape, r, c, p.color)).grid, others, st)) return true;
        }
      }
    }
    return false;
  },

  // «Честная» раздача: набор из n фигур, который можно разместить целиком (иначе партия могла бы
  // закончиться сразу после раздачи по вине генератора, а не игрока). Если такого набора не нашлось —
  // хотя бы такой, где можно сделать ход.
  fairPieces(grid, n = 3) {
    let any = null;
    for (let t = 0; t < 30; t++) {
      const ps = GBlocks.randomPieces(n);
      if (GBlocks.solvable(grid, ps)) return ps;
      if (!any && GBlocks.anyMoveLeft(grid, ps)) any = ps;
    }
    return any || GBlocks.randomPieces(n);
  },

  // Привязка к клеткам: (fr, fc) — дробные координаты левого верхнего угла фигуры в клетках поля.
  // Из ближайших целых позиций выбираем допустимую, ближайшую к пальцу; дальше ~1 клетки — не липнем.
  snap(grid, shape, fr, fc) {
    let best = null, bd = 1e9;
    for (const r of [Math.floor(fr), Math.ceil(fr)]) {
      for (const c of [Math.floor(fc), Math.ceil(fc)]) {
        if (!GBlocks.canPlace(grid, shape, r, c)) continue;
        const dd = (r - fr) * (r - fr) + (c - fc) * (c - fc);
        if (dd < bd) { bd = dd; best = { r, c }; }
      }
    }
    return best && bd <= 0.95 ? best : null;
  },
};

const GameBlocks = {
  cur: null,
  LIFT: 70,                     // на сенсорном экране фигура «висит» над пальцем, чтобы её не закрывал палец
  BEST_KEY: "dg_bb_best",
  DISSOLVE_MS: 560,

  fresh() {
    const g = GBlocks.newGrid();
    return { grid: g, pieces: GBlocks.fairPieces(g), score: 0, best: GameBlocks.loadBest(), over: false,
             session: null, sid: 0, combo: 0, gap: 9, lockUntil: 0 };
  },
  loadBest() { try { return +localStorage.getItem(GameBlocks.BEST_KEY) || 0; } catch (e) { return 0; } },
  saveBest(v) { try { localStorage.setItem(GameBlocks.BEST_KEY, String(v)); } catch (e) {} },

  open() {
    const pg = Pg.open({
      title: T("Block Blast"), cls: "gameplay gblocks",
      right: `<button class="icon-btn" data-a="lb" aria-label="${esc(T("Таблица лидеров"))}">${SI.stats}</button>`,
      data: GameBlocks.fresh(),
      build: (p) => GameBlocks.build(p),
      onClose: () => GameBlocks.dispose(pg),
    });
    GameBlocks.cur = pg;
    pg.on.lb = () => Games.leaderboard("block_blast", "Block Blast");
    pg.on.restart = () => GameBlocks.restart(pg);
    GameBlocks.bindDrag(pg);
    GameBlocks.newSession(pg);
  },

  // всё запущенное игрой должно остановиться вместе с экраном
  dispose(pg) {
    const x = pg.x;
    if (x) {
      x.timers.forEach(clearTimeout); x.timers.clear();
      if (x.raf) cancelAnimationFrame(x.raf);
      x.raf = 0; x.parts = [];
      if (x.dragEnd) x.dragEnd();
      window.removeEventListener("resize", x.onResize);
    }
    GameBlocks.saveBest(pg.data.best);
    GameBlocks.finish(pg);
    if (GameBlocks.cur === pg) GameBlocks.cur = null;
  },

  newSession(pg) {
    const d = pg.data, sid = ++d.sid;
    d.session = null;
    GameSession.start("block_blast").then((s) => { if (pg.alive && d.sid === sid) d.session = s; });
  },

  // результат уходит на сервер один раз: при проигрыше, рестарте или выходе из игры
  finish(pg) {
    const d = pg.data;
    if (d.session && d.score > 0) { GameSession.submit(d.session, d.score); }
    d.session = null;
  },

  restart(pg) {
    const x = pg.x, d = pg.data;
    GameBlocks.saveBest(d.best);
    GameBlocks.finish(pg);
    x.timers.forEach(clearTimeout); x.timers.clear();
    if (x.raf) { cancelAnimationFrame(x.raf); x.raf = 0; }
    x.parts = []; x.dis.clear();
    if (x.dragEnd) x.dragEnd();
    x.ctx.clearRect(0, 0, x.fxw, x.fxh);
    const sid = d.sid;
    Object.assign(d, GameBlocks.fresh(), { sid });
    GameBlocks.paintAll(pg);
    GameBlocks.newSession(pg);
  },

  later(pg, fn, ms) {
    const x = pg.x;
    const id = setTimeout(() => { x.timers.delete(id); if (pg.alive) fn(); }, ms);
    x.timers.add(id);
  },

  // ── разметка экрана: строится один раз, дальше меняются только классы/тексты ──
  build(pg) {
    const N = GBlocks.SIZE;
    pg.set(`
      <div class="g-hud">
        <div class="g-hudv"><small>${esc(T("Очки"))}</small><b class="gb-score">0</b></div>
        <div class="g-hudv gb-bestv"><small>${esc(T("Рекорд"))}</small><b class="gb-best">0</b></div>
        <button class="g-restart" data-a="restart" aria-label="${esc(T("Заново"))}">${SI.shuffle}</button>
      </div>
      <div class="g-stage">
        <div class="gb-board">
          <div class="g-bgrid">${'<div class="g-bcell"></div>'.repeat(N * N)}</div>
          <canvas class="gb-fx"></canvas>
          <div class="gb-combo"></div>
          <div class="gb-pop"></div>
          <div class="g-over" hidden>
            <p class="gb-over-t">${esc(T("Нет ходов — игра окончена"))}</p>
            <div class="gb-over-s"></div>
            <button class="pbtn" data-a="restart">${esc(T("Играть снова"))}</button>
          </div>
        </div>
      </div>
      <div class="g-tray">${[0, 1, 2].map((i) => `<div class="g-piece used" data-i="${i}"></div>`).join("")}</div>
      <p class="g-hint">${esc(T("Перетащите фигуру на поле"))}</p>
    `);
    const x = pg.x = {
      cells: [...pg.el.querySelectorAll(".g-bcell")],
      cls: new Array(N * N).fill("g-bcell"),
      grid: pg.$(".g-bgrid"), board: pg.$(".gb-board"),
      score: pg.$(".gb-score"), best: pg.$(".gb-best"),
      combo: pg.$(".gb-combo"), pop: pg.$(".gb-pop"),
      over: pg.$(".g-over"), overS: pg.$(".gb-over-s"),
      tray: [...pg.el.querySelectorAll(".g-piece")],
      cv: pg.$(".gb-fx"), ctx: null, fxw: 0, fxh: 0, parts: [], raf: 0,
      timers: new Set(), dis: new Set(), pv: [], pvKey: "", drag: null, dragEnd: null, onResize: null,
    };
    x.ctx = x.cv.getContext("2d");
    x.onResize = () => GameBlocks.fxSize(pg);
    window.addEventListener("resize", x.onResize);
    GameBlocks.paintAll(pg);
  },

  paintAll(pg) {
    const d = pg.data, x = pg.x;
    x.dis.clear();
    GameBlocks.paintCells(pg, d.grid);
    GameBlocks.paintTray(pg, true);
    GameBlocks.paintScore(pg, false);
    x.over.hidden = !d.over;
  },

  // красим только те клетки, у которых изменился класс; «растворяющиеся» клетки не трогаем до конца анимации
  paintCells(pg, grid, fresh) {
    const x = pg.x;
    for (let i = 0; i < grid.length; i++) {
      if (x.dis.has(i)) continue;
      const v = grid[i];
      const cls = "g-bcell" + (v ? " c" + v : "") + (fresh && fresh.has(i) ? " pop" : "");
      if (x.cls[i] !== cls) { x.cls[i] = cls; x.cells[i].className = cls; x.cells[i].style.animationDelay = ""; }
    }
  },

  paintTray(pg, fresh) {
    const d = pg.data, x = pg.x;
    for (let i = 0; i < 3; i++) {
      const el = x.tray[i], p = d.pieces[i];
      el.innerHTML = p ? GameBlocks.pieceHTML(p, 17, 2) : "";
      el.classList.toggle("used", !p);
      el.classList.remove("drag");
      if (fresh && p) {
        el.classList.remove("fresh"); el.style.animationDelay = (i * 70) + "ms";
        void el.offsetWidth; el.classList.add("fresh");
      }
    }
  },

  paintScore(pg, bump) {
    const d = pg.data, x = pg.x;
    x.score.textContent = d.score;
    x.best.textContent = Math.max(d.best, d.score);
    if (bump) { x.score.classList.remove("bump"); void x.score.offsetWidth; x.score.classList.add("bump"); }
  },

  dims(p) {
    let r = 0, c = 0;
    for (const [dr, dc] of p.shape) { r = Math.max(r, dr); c = Math.max(c, dc); }
    return { rows: r + 1, cols: c + 1 };
  },

  pieceHTML(p, cs, gap) {
    const { rows, cols } = GameBlocks.dims(p);
    const set = new Set(p.shape.map(([dr, dc]) => dr + "," + dc));
    let html = `<div class="g-pmini" style="--cols:${cols};--rows:${rows};--cs:${cs}px;--gap:${gap}px">`;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) html += `<i class="${set.has(r + "," + c) ? "on c" + p.color : ""}"></i>`;
    return html + "</div>";
  },

  // геометрия поля: размер клетки, шаг, начало координат — в координатах окна и внутри .gb-board
  geom(pg) {
    const x = pg.x, N = GBlocks.SIZE;
    const gr = x.grid.getBoundingClientRect(), br = x.board.getBoundingClientRect(), cs = getComputedStyle(x.grid);
    const pad = parseFloat(cs.paddingLeft) || 0, gap = parseFloat(cs.columnGap) || 0;
    const size = (gr.width - pad * 2 - gap * (N - 1)) / N;
    return { x0: gr.left + pad, y0: gr.top + pad, size, gap, step: size + gap,
             bx: gr.left - br.left + pad, by: gr.top - br.top + pad, bw: br.width, bh: br.height };
  },

  // ── перетаскивание ──
  bindDrag(pg) {
    pg.el.addEventListener("pointerdown", (e) => {
      const el = e.target.closest && e.target.closest(".g-piece");
      if (!el || !pg.alive || !pg.x) return;
      const d = pg.data, x = pg.x;
      if (d.over || x.drag || Date.now() < d.lockUntil) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const piece = d.pieces[+el.dataset.i];
      if (!piece) return;
      e.preventDefault();
      GameBlocks.startDrag(pg, el, +el.dataset.i, piece, e);
    });
  },

  startDrag(pg, el, i, piece, e0) {
    const x = pg.x, m = GameBlocks.geom(pg), dm = GameBlocks.dims(piece);
    const lift = e0.pointerType === "mouse" ? 12 : GameBlocks.LIFT;
    const gw = dm.cols * m.step - m.gap, gh = dm.rows * m.step - m.gap;
    const g = document.createElement("div");
    g.className = "gb-ghost";
    g.innerHTML = GameBlocks.pieceHTML(piece, m.size, m.gap);
    document.body.appendChild(g);
    const dr = x.drag = { i, target: null, id: e0.pointerId };
    el.classList.add("drag");
    haptic();

    const at = (cx, cy) => {
      const gx = cx - gw / 2, gy = cy - gh / 2 - lift;
      g.style.transform = `translate3d(${gx}px,${gy}px,0)`;
      const t = GBlocks.snap(pg.data.grid, piece.shape, (gy - m.y0) / m.step, (gx - m.x0) / m.step);
      dr.target = t;
      if (t) GameBlocks.showPreview(pg, piece, t.r, t.c); else GameBlocks.clearPreview(pg);
    };
    const move = (e) => { if (e.pointerId !== dr.id) return; if (e.cancelable) e.preventDefault(); at(e.clientX, e.clientY); };
    const done = (ok) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      el.classList.remove("drag");
      GameBlocks.clearPreview(pg);
      const t = ok ? dr.target : null;
      x.drag = null; x.dragEnd = null;
      if (t && pg.alive) { g.remove(); GameBlocks.commit(pg, i, t.r, t.c); }
      else { g.classList.add("back"); setTimeout(() => g.remove(), 200); }
    };
    const up = (e) => { if (e.pointerId === dr.id) done(true); };
    const cancel = (e) => { if (e.pointerId === dr.id) done(false); };
    x.dragEnd = () => done(false);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    at(e0.clientX, e0.clientY);
  },

  // подсветка клеток под фигурой + линий, которые она замкнёт (они «светятся» — видно, что сейчас сгорит)
  showPreview(pg, piece, r, c) {
    const x = pg.x, d = pg.data, N = GBlocks.SIZE, key = r + "," + c;
    if (x.pvKey === key) return;
    GameBlocks.clearPreview(pg);
    x.pvKey = key;
    const extra = new Map();
    for (const [dr, dc] of piece.shape) extra.set((r + dr) * N + (c + dc), " pv c" + piece.color);
    const { rows, cols } = GBlocks.fullLines(GBlocks.place(d.grid, piece.shape, r, c, piece.color));
    const mark = (idx) => extra.set(idx, (extra.get(idx) || "") + " wc");
    rows.forEach((rr) => { for (let cc = 0; cc < N; cc++) mark(rr * N + cc); });
    cols.forEach((cc) => { for (let rr = 0; rr < N; rr++) mark(rr * N + cc); });
    extra.forEach((add, idx) => { x.cells[idx].className = x.cls[idx] + add; });
    x.pv = [...extra.keys()];
  },

  clearPreview(pg) {
    const x = pg.x;
    if (!x || !x.pv.length) { if (x) x.pvKey = ""; return; }
    for (const i of x.pv) if (!x.dis.has(i)) x.cells[i].className = x.cls[i];
    x.pv = []; x.pvKey = "";
  },

  // ── установка фигуры (вызывается и после перетаскивания, и напрямую — из тестов) ──
  commit(pg, idx, r, c) {
    const d = pg.data, x = pg.x, N = GBlocks.SIZE;
    const piece = d.pieces[idx];
    if (!piece || d.over || !GBlocks.canPlace(d.grid, piece.shape, r, c)) return false;
    const placed = GBlocks.place(d.grid, piece.shape, r, c, piece.color);
    const res = GBlocks.clearFull(placed), lines = res.lines;
    // комбо: очистка линий в пределах 3 ходов после предыдущей очистки продолжает серию
    if (lines) { d.combo = d.gap < 3 && d.combo ? d.combo + 1 : 1; d.gap = 0; }
    else { d.gap++; if (d.gap >= 3) d.combo = 0; }
    const perfect = lines > 0 && GBlocks.isEmpty(res.grid);
    const gained = GBlocks.scoreFor(piece.shape.length, lines, d.combo) + (perfect ? 120 : 0);
    d.score += gained;
    if (d.score > d.best) d.best = d.score;
    d.grid = res.grid;
    d.pieces[idx] = null;
    const refill = d.pieces.every((p) => !p);
    if (refill) d.pieces = GBlocks.fairPieces(d.grid);
    d.lockUntil = Date.now() + 140;

    const fresh = new Set(piece.shape.map(([a, b]) => (r + a) * N + (c + b)));
    GameBlocks.paintCells(pg, lines ? placed : d.grid, fresh);
    if (lines) GameBlocks.dissolve(pg, placed, res, r, c);
    haptic(lines ? "medium" : "light");
    GameBlocks.paintTray(pg, refill);
    GameBlocks.paintScore(pg, true);
    GameBlocks.floatScore(pg, piece, r, c, gained);
    const label = perfect ? "PERFECT!" : (lines >= 3 || d.combo >= 4) ? "MEGA COMBO" : d.combo >= 2 ? "COMBO x" + d.combo : lines >= 2 ? "GREAT!" : "";
    if (label) GameBlocks.banner(pg, label, perfect || lines >= 3 || d.combo >= 4);

    if (!GBlocks.anyMoveLeft(d.grid, d.pieces)) {
      d.over = true;
      GameBlocks.later(pg, () => GameBlocks.gameOver(pg), lines ? 700 : 380);
    }
    return true;
  },

  gameOver(pg) {
    const d = pg.data, x = pg.x;
    GameBlocks.saveBest(d.best);
    x.overS.innerHTML = `<b>${d.score}</b><small>${esc(T("Рекорд"))}: ${Math.max(d.best, d.score)}</small>`;
    x.over.hidden = false;
    GameBlocks.finish(pg);
    haptic("heavy");
  },

  // растворение очищенных линий: клетки сжимаются волной от места установки, из каждой вылетают частицы
  dissolve(pg, placed, res, r, c) {
    const x = pg.x, N = GBlocks.SIZE, idxs = new Set();
    res.rows.forEach((rr) => { for (let cc = 0; cc < N; cc++) idxs.add(rr * N + cc); });
    res.cols.forEach((cc) => { for (let rr = 0; rr < N; rr++) idxs.add(rr * N + cc); });
    const m = GameBlocks.geom(pg);
    idxs.forEach((idx) => {
      const rr = Math.floor(idx / N), cc = idx % N, delay = Math.min((Math.abs(rr - r) + Math.abs(cc - c)) * 32, 260);
      const cls = "g-bcell c" + placed[idx] + " clr";
      x.dis.add(idx); x.cls[idx] = cls;
      x.cells[idx].className = cls; x.cells[idx].style.animationDelay = delay + "ms";
      GameBlocks.burst(pg, m.bx + cc * m.step + m.size / 2, m.by + rr * m.step + m.size / 2, GBlocks.COLORS[placed[idx] - 1] || "#fff", delay, m.size);
    });
    GameBlocks.later(pg, () => {
      idxs.forEach((i) => x.dis.delete(i));
      GameBlocks.paintCells(pg, pg.data.grid);
    }, GameBlocks.DISSOLVE_MS);
  },

  // ── частицы на canvas: один слой, rAF крутится только пока есть живые частицы ──
  fxSize(pg) {
    const x = pg.x, w = x.board.clientWidth, h = x.board.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!w || !h) return;
    x.cv.width = Math.round(w * dpr); x.cv.height = Math.round(h * dpr);
    x.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fxw = w; x.fxh = h;
  },

  burst(pg, cx, cy, color, delay, size) {
    const x = pg.x;
    if (!x.fxw || x.fxw !== x.board.clientWidth) GameBlocks.fxSize(pg);
    if (x.parts.length > 420) return;                 // потолок на случай огромной серии
    for (let k = 0; k < 4; k++) {
      const a = Math.random() * Math.PI * 2, v = 0.06 + Math.random() * 0.2;
      x.parts.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.08, g: 0.00045 + Math.random() * 0.0003,
                     s: size * (0.1 + Math.random() * 0.16), rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.02,
                     age: -delay, life: 420 + Math.random() * 280, color });
    }
    GameBlocks.fxLoop(pg);
  },

  fxLoop(pg) {
    const x = pg.x;
    if (x.raf) return;
    let last = performance.now();
    const step = (t) => {
      x.raf = 0;
      if (!pg.alive) return;
      const dt = Math.min(48, t - last); last = t;
      const ctx = x.ctx;
      ctx.clearRect(0, 0, x.fxw, x.fxh);
      for (const p of x.parts) {
        p.age += dt;
        if (p.age < 0 || p.age >= p.life) continue;
        p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        const k = 1 - p.age / p.life;
        ctx.globalAlpha = Math.max(0, k);
        ctx.fillStyle = p.color;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        const s = p.s * (0.5 + k * 0.5);
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      x.parts = x.parts.filter((p) => p.age < p.life);
      if (x.parts.length) x.raf = requestAnimationFrame(step);
      else ctx.clearRect(0, 0, x.fxw, x.fxh);
    };
    x.raf = requestAnimationFrame(step);
  },

  // «+N» над установленной фигурой
  floatScore(pg, piece, r, c, gained) {
    const x = pg.x, m = GameBlocks.geom(pg), dm = GameBlocks.dims(piece);
    const el = x.pop;
    el.textContent = "+" + gained;
    el.style.left = (m.bx + (c + dm.cols / 2) * m.step - m.gap / 2) + "px";
    el.style.top = (m.by + (r + dm.rows / 2) * m.step - m.gap / 2) + "px";
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  },

  banner(pg, text, mega) {
    const el = pg.x.combo;
    el.textContent = text;
    el.className = "gb-combo";
    void el.offsetWidth;
    el.className = "gb-combo show" + (mega ? " mega" : "");
  },
};
