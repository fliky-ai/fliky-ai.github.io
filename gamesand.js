// gamesand.js — «Sand Fall»: тетрис из ПЕСКА. Фигура падает плавно (по зёрнышку) и управляется как
// обычное тетромино, но стоит ей коснуться опоры — она рассыпается на отдельные песчинки, которые
// осыпаются горкой по законам «падающего песка» (вниз, иначе по диагонали). Линия сгорает, когда
// одноцветная полоса соединяет левую стенку с правой (как в Sandtrix) — после обвала сверху возможны цепочки.
// Поле мелкое (36×56 зёрен) и рисуется на canvas: одна ImageData на кадр, без перерисовки DOM —
// никакого мерцания. Чистая логика — в GSand (без DOM, тестируется отдельно), экран и цикл — в GameSand.

const GSand = {
  COLS: 36, ROWS: 56,
  B: 4,                       // сторона блока фигуры в зёрнах (4 зерна × 4 зерна = одна клетка тетромино)
  NCOL: 4,                    // цветов песка
  TYPES: ["I", "O", "T", "L", "J", "S", "Z"],
  COLORS: ["", "#F2B84B", "#EB6A55", "#3FB8A9", "#8D6FE3"],   // индекс = номер цвета песка
  SHADES: [-16, -6, 6, 16],   // у каждого зерна свой оттенок — песок выглядит «живым», а не плоской заливкой
  // 4 состояния поворота на каждую фигуру, координаты в сетке 4×4 блоков (классические таблицы тетромино)
  TETRO: {
    I: [[[1, 0], [1, 1], [1, 2], [1, 3]], [[0, 2], [1, 2], [2, 2], [3, 2]], [[2, 0], [2, 1], [2, 2], [2, 3]], [[0, 1], [1, 1], [2, 1], [3, 1]]],
    O: [[[1, 1], [1, 2], [2, 1], [2, 2]], [[1, 1], [1, 2], [2, 1], [2, 2]], [[1, 1], [1, 2], [2, 1], [2, 2]], [[1, 1], [1, 2], [2, 1], [2, 2]]],
    T: [[[0, 1], [1, 0], [1, 1], [1, 2]], [[0, 1], [1, 1], [1, 2], [2, 1]], [[1, 0], [1, 1], [1, 2], [2, 1]], [[0, 1], [1, 0], [1, 1], [2, 1]]],
    L: [[[0, 2], [1, 0], [1, 1], [1, 2]], [[0, 1], [1, 1], [2, 1], [2, 2]], [[1, 0], [1, 1], [1, 2], [2, 0]], [[0, 0], [0, 1], [1, 1], [2, 1]]],
    J: [[[0, 0], [1, 0], [1, 1], [1, 2]], [[0, 1], [0, 2], [1, 1], [2, 1]], [[1, 0], [1, 1], [1, 2], [2, 2]], [[0, 1], [1, 1], [2, 0], [2, 1]]],
    S: [[[0, 1], [0, 2], [1, 0], [1, 1]], [[0, 1], [1, 1], [1, 2], [2, 2]], [[1, 1], [1, 2], [2, 0], [2, 1]], [[0, 0], [1, 0], [1, 1], [2, 1]]],
    Z: [[[0, 0], [0, 1], [1, 1], [1, 2]], [[0, 2], [1, 1], [1, 2], [2, 1]], [[1, 0], [1, 1], [2, 1], [2, 2]], [[0, 1], [1, 0], [1, 1], [2, 0]]],
  },

  newGrid() { return new Uint8Array(GSand.COLS * GSand.ROWS); },

  // фигура: (x, y) — левый верхний угол её сетки 4×4 блоков, в ЗЁРНАХ (x всегда кратен B — двигаем блоками)
  // prevColor — предыдущий цвет: с вероятностью ~40% повторяем его, чтобы одноцветные полосы реально собирались
  spawnPiece(prevColor) {
    const type = GSand.TYPES[Math.floor(Math.random() * GSand.TYPES.length)];
    const color = prevColor && Math.random() < 0.4 ? prevColor : 1 + Math.floor(Math.random() * GSand.NCOL);
    const minRow = Math.min(...GSand.TETRO[type][0].map((c) => c[0]));
    return { type, rot: 0, x: (Math.floor(GSand.COLS / GSand.B / 2) - 2) * GSand.B, y: -minRow * GSand.B, color };
  },

  // блоки фигуры [[br, bc], ...] текущего поворота
  blocks(piece) { return GSand.TETRO[piece.type][piece.rot]; },

  // перебор всех зёрен фигуры: fn(row, col, gr, gc, br, bc) — gr/gc позиция зерна внутри своего блока
  eachGrain(piece, fn) {
    const B = GSand.B;
    for (const [br, bc] of GSand.blocks(piece)) {
      const r0 = piece.y + br * B, c0 = piece.x + bc * B;
      for (let gr = 0; gr < B; gr++) for (let gc = 0; gc < B; gc++) fn(r0 + gr, c0 + gc, gr, gc, br, bc);
    }
  },

  fits(grid, piece) {
    const { B, COLS, ROWS } = GSand;
    for (const [br, bc] of GSand.blocks(piece)) {
      const r0 = piece.y + br * B, c0 = piece.x + bc * B;
      if (c0 < 0 || c0 + B > COLS || r0 + B > ROWS) return false;
      for (let r = Math.max(0, r0); r < r0 + B; r++) for (let c = c0; c < c0 + B; c++) if (grid[r * COLS + c]) return false;
    }
    return true;
  },

  // dx, dy — в зёрнах
  tryMove(grid, piece, dx, dy) {
    const np = Object.assign({}, piece, { x: piece.x + dx, y: piece.y + dy });
    return GSand.fits(grid, np) ? np : null;
  },

  tryRotate(grid, piece) {
    const base = Object.assign({}, piece, { rot: (piece.rot + 1) % 4 });
    if (GSand.fits(grid, base)) return base;
    const B = GSand.B;
    for (const dc of [-B, B, -2 * B, 2 * B]) {          // «пинок» от стены — на 1–2 блока в сторону
      const np = Object.assign({}, base, { x: base.x + dc });
      if (GSand.fits(grid, np)) return np;
    }
    return null;
  },

  // где фигура окажется, если её уронить прямо вниз
  landed(grid, piece) {
    let p = piece, np;
    while ((np = GSand.tryMove(grid, p, 0, 1))) p = np;
    return p;
  },

  // превращает фигуру в песчинки (grid — цвета, shade — случайный оттенок каждого зерна); меняет массивы НА МЕСТЕ
  stamp(grid, shade, piece) {
    const { COLS, ROWS } = GSand;
    GSand.eachGrain(piece, (r, c) => {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
      grid[r * COLS + c] = piece.color;
      if (shade) shade[r * COLS + c] = Math.floor(Math.random() * 4);
    });
  },

  // Один шаг осыпания песка НА МЕСТЕ: зерно падает вниз, иначе скатывается по диагонали (если обе стороны
  // свободны — в случайную), иначе лежит. Строки обходятся снизу вверх, направление обхода чередуется
  // (flip), чтобы горки не «кренились» в одну сторону. Возвращает число сдвинувшихся зёрен (0 — песок успокоился).
  settleStep(grid, shade, flip) {
    const W = GSand.COLS, H = GSand.ROWS;
    let moved = 0;
    for (let r = H - 2; r >= 0; r--) {
      const rtl = ((r + (flip | 0)) & 1) === 0;
      for (let k = 0; k < W; k++) {
        const c = rtl ? W - 1 - k : k, i = r * W + c, v = grid[i];
        if (!v) continue;
        const b = i + W;
        let to = -1;
        if (!grid[b]) to = b;
        else {
          const l = c > 0 && !grid[b - 1], rr = c < W - 1 && !grid[b + 1];
          if (l && rr) to = Math.random() < 0.5 ? b - 1 : b + 1;
          else if (l) to = b - 1;
          else if (rr) to = b + 1;
        }
        if (to < 0) continue;
        grid[to] = v; grid[i] = 0;
        if (shade) { shade[to] = shade[i]; shade[i] = 0; }
        moved++;
      }
    }
    return moved;
  },

  // Какие зёрна сгорают: связная (по 8 соседям) область ОДНОГО цвета, которая касается и левой, и правой стенки.
  // Возвращает массив индексов (пустой — ничего не сгорает).
  findSpans(grid) {
    const W = GSand.COLS, H = GSand.ROWS, N = W * H, out = [];
    const vis = new Uint8Array(N), stack = new Int32Array(N);
    for (let col = 1; col <= GSand.NCOL; col++) {
      vis.fill(0);
      for (let r0 = 0; r0 < H; r0++) {
        const s0 = r0 * W;
        if (grid[s0] !== col || vis[s0]) continue;
        let sp = 0, touchesRight = false;
        const comp = [];
        stack[sp++] = s0; vis[s0] = 1;
        while (sp) {
          const i = stack[--sp], r = (i / W) | 0, c = i - r * W;
          comp.push(i);
          if (c === W - 1) touchesRight = true;
          for (let dr = -1; dr <= 1; dr++) {
            const rr = r + dr;
            if (rr < 0 || rr >= H) continue;
            for (let dc = -1; dc <= 1; dc++) {
              if (!dr && !dc) continue;
              const cc = c + dc;
              if (cc < 0 || cc >= W) continue;
              const j = rr * W + cc;
              if (grid[j] === col && !vis[j]) { vis[j] = 1; stack[sp++] = j; }
            }
          }
        }
        if (touchesRight) for (const i of comp) out.push(i);
      }
    }
    return out;
  },

  removeCells(grid, shade, list) {
    for (const i of list) { grid[i] = 0; if (shade) shade[i] = 0; }
  },

  isOver(grid, piece) { return !GSand.fits(grid, piece); },

  // таблица цветов зёрен [цвет][оттенок] → [r, g, b] (считается один раз)
  lut() {
    if (GSand._lut) return GSand._lut;
    const t = [null];
    for (let c = 1; c <= GSand.NCOL; c++) {
      const hex = GSand.COLORS[c], r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      t.push(GSand.SHADES.map((d) => [Math.max(0, Math.min(255, r + d)), Math.max(0, Math.min(255, g + d)), Math.max(0, Math.min(255, b + d))]));
    }
    return (GSand._lut = t);
  },
};

const GameSand = {
  cur: null, raf: 0,
  LOCK_MS: 200,       // пауза «стою на опоре» — успеть сдвинуть/повернуть фигуру перед тем, как она рассыплется
  FLASH_MS: 340,      // вспышка сгорающей полосы
  SIM_MS: 1000 / 60,  // шаг симуляции песка
  LEVEL_EVERY: 500,

  speed(level) { return Math.min(40, 9 + (level - 1) * 2.4); },   // зёрен в секунду

  initData() {
    const first = GSand.spawnPiece();
    return { g: GSand.newGrid(), s: GSand.newGrid(), piece: first, next: GSand.spawnPiece(first.color), score: 0, level: 1,
             over: false, session: null, sid: 0, phase: "fall", fallAcc: 0, touch: 0, soft: false, chain: 0,
             flash: 0, flashList: null, flip: 0, best: GameSand.loadBest() };
  },
  loadBest() { try { return +localStorage.getItem("dg_sand_best") || 0; } catch (e) { return 0; } },
  saveBest(v) { try { localStorage.setItem("dg_sand_best", String(v)); } catch (e) {} },

  open() {
    const pg = Pg.open({
      title: T("Sand Fall"), cls: "gameplay gsand",
      right: `<button class="icon-btn" data-a="lb" aria-label="${esc(T("Таблица лидеров"))}">${SI.stats}</button>`,
      data: GameSand.initData(),
      build: (p) => GameSand.build(p),
      onClose: () => GameSand.dispose(pg),
    });
    GameSand.cur = pg;
    pg.on.lb = () => Games.leaderboard("sand", "Sand Fall");
    pg.on.restart = () => GameSand.restart(pg);
    GameSand.bindInput(pg);
    GameSand.newSession(pg);
    GameSand.loop(pg);
  },

  // всё запущенное игрой останавливается вместе с экраном
  dispose(pg) {
    const x = pg.x;
    if (x) {
      if (x.raf) cancelAnimationFrame(x.raf);
      x.raf = 0;
      clearTimeout(x.holdT); clearInterval(x.holdI);
      x.timers.forEach(clearTimeout); x.timers.clear();
      document.removeEventListener("keydown", x.onKey);
      document.removeEventListener("keyup", x.onKeyUp);
      window.removeEventListener("resize", x.onResize);
    }
    GameSand.raf = 0;
    GameSand.saveBest(Math.max(pg.data.best, pg.data.score));
    GameSand.finish(pg);
    if (GameSand.cur === pg) GameSand.cur = null;
  },

  newSession(pg) {
    const d = pg.data, sid = ++d.sid;
    d.session = null;
    GameSession.start("sand").then((s) => { if (pg.alive && d.sid === sid) d.session = s; });
  },

  finish(pg) {
    const d = pg.data;
    if (d.session && d.score > 0) GameSession.submit(d.session, d.score);
    d.session = null;
  },

  restart(pg) {
    const d = pg.data, x = pg.x;
    GameSand.saveBest(Math.max(d.best, d.score));
    GameSand.finish(pg);
    x.timers.forEach(clearTimeout); x.timers.clear();
    x.fl.fill(0); x.simAcc = 0;
    const sid = d.sid;
    Object.assign(d, GameSand.initData(), { sid });
    x.over.hidden = true;
    GameSand.paintHud(pg);
    GameSand.newSession(pg);
    if (!x.raf) GameSand.loop(pg);
  },

  later(pg, fn, ms) {
    const x = pg.x;
    const id = setTimeout(() => { x.timers.delete(id); if (pg.alive) fn(); }, ms);
    x.timers.add(id);
  },

  build(pg) {
    pg.set(`
      <div class="g-hud">
        <div class="g-hudv"><small>${esc(T("Очки"))}</small><b class="gs-score">0</b></div>
        <div class="g-hudv"><small>${esc(T("Ур."))}</small><b class="gs-level">1</b></div>
        <div class="gs-next" aria-label="${esc(T("Следующая"))}">${"<i></i>".repeat(16)}</div>
        <button class="g-restart" data-a="restart" aria-label="${esc(T("Заново"))}">${SI.shuffle}</button>
      </div>
      <div class="g-stage">
        <div class="gs-wrap">
          <canvas class="gs-cv"></canvas>
          <div class="gb-combo"></div>
          <div class="gb-pop"></div>
          <div class="g-over" hidden>
            <p>${esc(T("Игра окончена"))}</p>
            <div class="gb-over-s"></div>
            <button class="pbtn" data-a="restart">${esc(T("Играть снова"))}</button>
          </div>
        </div>
      </div>
      <div class="g-ctl">
        <button class="g-cbtn" data-k="left" aria-label="${esc(T("Влево"))}">${SI.back}</button>
        <button class="g-cbtn" data-k="rot" aria-label="${esc(T("Повернуть"))}">${SI.shuffle}</button>
        <button class="g-cbtn" data-k="drop" aria-label="${esc(T("Вниз"))}">${SI.down}</button>
        <button class="g-cbtn" data-k="right" aria-label="${esc(T("Вправо"))}">${SI.fwd}</button>
      </div>
    `);
    const W = GSand.COLS, H = GSand.ROWS;
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    const cv = pg.$(".gs-cv");
    const x = pg.x = {
      stage: pg.$(".g-stage"), wrap: pg.$(".gs-wrap"), cv, ctx: cv.getContext("2d"),
      off, offCtx: off.getContext("2d"), img: null, S: 0, blockPx: 40,
      score: pg.$(".gs-score"), level: pg.$(".gs-level"), nextCells: [...pg.el.querySelectorAll(".gs-next i")],
      over: pg.$(".g-over"), overS: pg.$(".gb-over-s"), combo: pg.$(".gb-combo"), pop: pg.$(".gb-pop"),
      fl: new Uint8Array(W * H), simAcc: 0, last: 0, raf: 0, timers: new Set(),
      holdT: 0, holdI: 0, onKey: null, onKeyUp: null, onResize: null, nextKey: "",
    };
    x.img = x.offCtx.createImageData(W, H);
    x.onResize = () => { x.S = 0; };            // пересчёт размеров — в ближайшем кадре
    window.addEventListener("resize", x.onResize);
    GameSand.paintHud(pg);
  },

  paintHud(pg) {
    const d = pg.data, x = pg.x;
    x.score.textContent = d.score;
    x.level.textContent = d.level;
    GameSand.paintNext(pg);
    x.over.hidden = !d.over;
  },

  paintNext(pg) {
    const d = pg.data, x = pg.x, key = d.next.type + d.next.color;
    if (x.nextKey === key) return;
    x.nextKey = key;
    const on = new Set(GSand.TETRO[d.next.type][0].map(([r, c]) => r * 4 + c));
    x.nextCells.forEach((el, i) => { el.className = on.has(i) ? "on c" + d.next.color : ""; });
  },

  // ── ввод: кнопки (с повтором при удержании), клавиатура, жесты по полю ──
  act(pg, k) {
    if (k === "left") GameSand.moveH(pg, -1);
    else if (k === "right") GameSand.moveH(pg, 1);
    else if (k === "rot") GameSand.rotate(pg);
    else if (k === "drop") GameSand.drop(pg);
  },

  bindInput(pg) {
    const x = pg.x, d = pg.data;
    const ctl = pg.$(".g-ctl");
    const stopHold = () => { clearTimeout(x.holdT); clearInterval(x.holdI); x.holdT = x.holdI = 0; };
    ctl.addEventListener("pointerdown", (e) => {
      const b = e.target.closest("[data-k]");
      if (!b) return;
      e.preventDefault();
      const k = b.dataset.k;
      GameSand.act(pg, k);
      stopHold();
      if (k === "left" || k === "right") {
        x.holdT = setTimeout(() => { x.holdI = setInterval(() => GameSand.act(pg, k), 80); }, 260);
      }
    });
    for (const ev of ["pointerup", "pointercancel", "pointerleave"]) ctl.addEventListener(ev, stopHold);
    // клавиатурный «клик» по кнопке (Enter/Space) приходит без указателя (detail === 0) — обрабатываем его отдельно
    ctl.addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (b && e.detail === 0) GameSand.act(pg, b.dataset.k); });

    x.onKey = (e) => {
      if (!pg.alive) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); GameSand.moveH(pg, -1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); GameSand.moveH(pg, 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); GameSand.rotate(pg); }
      else if (e.key === "ArrowDown") { e.preventDefault(); pg.data.soft = true; }
      else if (e.key === " ") { e.preventDefault(); GameSand.drop(pg); }
    };
    x.onKeyUp = (e) => { if (e.key === "ArrowDown") pg.data.soft = false; };
    document.addEventListener("keydown", x.onKey);
    document.addEventListener("keyup", x.onKeyUp);

    // жесты по полю: ведём палец — фигура едет за ним по блокам, быстрый свайп вниз — сброс, короткий тап — поворот
    let g = null;
    const wrap = x.wrap;
    wrap.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".g-over")) return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, t: Date.now(), moved: false, dropped: false };
    });
    wrap.addEventListener("pointermove", (e) => {
      if (!g || e.pointerId !== g.id) return;
      const step = x.blockPx || 40;
      let dx = e.clientX - g.lx;
      while (Math.abs(dx) >= step) {
        const s = dx > 0 ? 1 : -1;
        GameSand.moveH(pg, s); g.lx += s * step; dx -= s * step; g.moved = true;
      }
      if (!g.dropped && e.clientY - g.y > 70 && Math.abs(e.clientY - g.y) > Math.abs(e.clientX - g.x)) { g.dropped = true; GameSand.drop(pg); }
    });
    const end = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const tap = !g.moved && !g.dropped && Math.abs(e.clientX - g.x) < 12 && Math.abs(e.clientY - g.y) < 12 && Date.now() - g.t < 320;
      g = null;
      if (tap && e.type === "pointerup") GameSand.rotate(pg);
    };
    wrap.addEventListener("pointerup", end);
    wrap.addEventListener("pointercancel", end);
    void d;
  },

  moveH(pg, dir) {
    const d = pg.data;
    if (d.phase !== "fall" || d.over || !d.piece) return;
    const np = GSand.tryMove(d.g, d.piece, dir * GSand.B, 0);
    if (np) { d.piece = np; d.touch = 0; }
  },

  rotate(pg) {
    const d = pg.data;
    if (d.phase !== "fall" || d.over || !d.piece) return;
    const np = GSand.tryRotate(d.g, d.piece);
    if (np) { d.piece = np; d.touch = 0; haptic(); }
  },

  drop(pg) {
    const d = pg.data;
    if (d.phase !== "fall" || d.over || !d.piece) return;
    d.piece = GSand.landed(d.g, d.piece);
    haptic("medium");
    GameSand.lock(pg);
  },

  // фигура рассыпается песком; дальше — осыпание, поиск полос, цепочки
  lock(pg) {
    const d = pg.data, x = pg.x;
    GSand.stamp(d.g, d.s, d.piece);
    d.piece = null;
    d.phase = "settle";
    d.chain = 0; d.touch = 0; d.fallAcc = 0; x.simAcc = 0;
    GameSand.addScore(pg, 4);
  },

  addScore(pg, n) {
    const d = pg.data;
    d.score += n;
    d.level = 1 + Math.floor(d.score / GameSand.LEVEL_EVERY);
    if (d.score > d.best) d.best = d.score;
    const x = pg.x;
    x.score.textContent = d.score;
    x.level.textContent = d.level;
  },

  nextPiece(pg) {
    const d = pg.data;
    d.piece = d.next;
    d.next = GSand.spawnPiece(d.piece.color);
    d.phase = "fall"; d.fallAcc = 0; d.touch = 0; d.chain = 0;
    GameSand.paintNext(pg);
    if (GSand.isOver(d.g, d.piece)) GameSand.gameOver(pg);
  },

  gameOver(pg) {
    const d = pg.data, x = pg.x;
    d.over = true; d.phase = "over"; d.piece = null;
    GameSand.saveBest(Math.max(d.best, d.score));
    x.overS.innerHTML = `<b>${d.score}</b><small>${esc(T("Рекорд"))}: ${Math.max(d.best, d.score)}</small>`;
    x.over.hidden = false;
    GameSand.finish(pg);
    haptic("heavy");
  },

  // ── игровой цикл: requestAnimationFrame, останавливается при закрытии и по окончании игры ──
  loop(pg) {
    const x = pg.x;
    x.last = 0;
    const step = (t) => {
      x.raf = 0; GameSand.raf = 0;
      if (!pg.alive) return;
      const dt = x.last ? Math.min(50, t - x.last) : 16; x.last = t;
      GameSand.update(pg, dt);
      GameSand.render(pg);
      if (pg.data.over) { x.last = 0; return; }       // цикл не крутим вхолостую, пока игра окончена
      x.raf = GameSand.raf = requestAnimationFrame(step);
    };
    x.raf = GameSand.raf = requestAnimationFrame(step);
  },

  update(pg, dt) {
    const d = pg.data, x = pg.x;
    if (d.over) return;
    if (d.phase === "fall") {
      d.fallAcc += dt * GameSand.speed(d.level) * (d.soft ? 7 : 1) / 1000;
      while (d.fallAcc >= 1) {
        d.fallAcc -= 1;
        const np = GSand.tryMove(d.g, d.piece, 0, 1);
        if (!np) { d.fallAcc = 0; break; }
        d.piece = np;
      }
      if (GSand.tryMove(d.g, d.piece, 0, 1)) d.touch = 0;
      else { d.touch += dt; if (d.touch >= GameSand.LOCK_MS || d.soft) GameSand.lock(pg); }
    } else if (d.phase === "settle") {
      x.simAcc += dt;
      if (x.simAcc > GameSand.SIM_MS * 8) x.simAcc = GameSand.SIM_MS * 8;
      let n = 0;
      while (x.simAcc >= GameSand.SIM_MS && n < 4 && d.phase === "settle") {
        x.simAcc -= GameSand.SIM_MS; n++;
        if (GSand.settleStep(d.g, d.s, d.flip++)) continue;
        // песок успокоился: ищем сгорающие полосы
        const list = GSand.findSpans(d.g);
        if (list.length) {
          d.flashList = list; d.flash = 0; d.phase = "flash"; d.chain++;
          x.fl.fill(0); for (const i of list) x.fl[i] = 1;
          if (d.chain >= 2) GameSand.banner(pg, d.chain >= 3 ? "MEGA COMBO" : "COMBO x" + d.chain, d.chain >= 3);
          haptic();
        } else GameSand.nextPiece(pg);
      }
    } else if (d.phase === "flash") {
      d.flash += dt;
      if (d.flash >= GameSand.FLASH_MS) {
        const list = d.flashList;
        GSand.removeCells(d.g, d.s, list);
        x.fl.fill(0);
        const gained = Math.max(1, Math.round(list.length / 4)) * d.chain;
        GameSand.addScore(pg, gained);
        GameSand.floatScore(pg, list, gained);
        d.flashList = null; d.phase = "settle"; x.simAcc = 0;
        haptic("medium");
      }
    }
  },

  // ── рисование: вся сцена — в одну ImageData 36×56, затем масштаб без сглаживания (целая кратность → чёткие зёрна) ──
  layout(pg) {
    const x = pg.x, { COLS, ROWS, B } = GSand;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const aw = x.stage.clientWidth - 28, ah = x.stage.clientHeight - 28;
    if (aw <= 0 || ah <= 0) return;
    const S = Math.max(2, Math.floor(Math.min(aw * dpr / COLS, ah * dpr / ROWS)));
    x.S = S;
    x.cv.width = COLS * S; x.cv.height = ROWS * S;
    x.cv.style.width = (COLS * S / dpr) + "px"; x.cv.style.height = (ROWS * S / dpr) + "px";
    x.blockPx = (COLS * S / dpr) / (COLS / B);
  },

  render(pg) {
    const d = pg.data, x = pg.x;
    if (!x.S) { GameSand.layout(pg); if (!x.S) return; }
    const { COLS, ROWS, B } = GSand, N = COLS * ROWS, px = x.img.data, lut = GSand.lut();
    const flashing = d.phase === "flash", bright = flashing && Math.floor(d.flash / 80) % 2 === 0;
    for (let i = 0; i < N; i++) {
      const v = d.g[i], o = i * 4;
      if (!v) { px[o + 3] = 0; continue; }
      let c = lut[v][d.s[i]];
      if (flashing && x.fl[i]) c = bright ? [255, 255, 255] : [Math.min(255, c[0] + 70), Math.min(255, c[1] + 70), Math.min(255, c[2] + 70)];
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }
    const p = d.piece;
    if (p) {
      const base = lut[p.color][2];
      // тень посадки: куда упадёт фигура — прозрачным силуэтом
      const land = GSand.landed(d.g, p);
      if (land.y > p.y + 1) {
        GSand.eachGrain(land, (r, c) => {
          if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
          const o = (r * COLS + c) * 4;
          if (!d.g[r * COLS + c]) { px[o] = base[0]; px[o + 1] = base[1]; px[o + 2] = base[2]; px[o + 3] = 70; }
        });
      }
      // сама падающая фигура: «стеклянные» блоки — светлая кромка сверху/слева, тёмная снизу/справа
      GSand.eachGrain(p, (r, c, gr, gc) => {
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
        const o = (r * COLS + c) * 4;
        const k = (gr === 0 || gc === 0) ? 46 : (gr === B - 1 || gc === B - 1) ? -34 : 0;
        px[o] = Math.max(0, Math.min(255, base[0] + k)); px[o + 1] = Math.max(0, Math.min(255, base[1] + k)); px[o + 2] = Math.max(0, Math.min(255, base[2] + k)); px[o + 3] = 255;
      });
    }
    x.offCtx.putImageData(x.img, 0, 0);
    const ctx = x.ctx;
    ctx.clearRect(0, 0, x.cv.width, x.cv.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(x.off, 0, 0, COLS, ROWS, 0, 0, x.cv.width, x.cv.height);
  },

  banner(pg, text, mega) {
    const el = pg.x.combo;
    el.textContent = text;
    el.className = "gb-combo";
    void el.offsetWidth;
    el.className = "gb-combo show" + (mega ? " mega" : "");
  },

  // «+N» в центре сгоревшей полосы
  floatScore(pg, list, gained) {
    const x = pg.x, W = GSand.COLS, H = GSand.ROWS;
    let sx = 0, sy = 0;
    for (const i of list) { sx += i % W; sy += (i / W) | 0; }
    const cx = sx / list.length / W, cy = sy / list.length / H;
    const el = x.pop;
    el.textContent = "+" + gained;
    el.style.left = (cx * 100) + "%"; el.style.top = (cy * 100) + "%";
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  },
};
