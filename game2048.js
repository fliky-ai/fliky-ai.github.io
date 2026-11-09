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

  // то же, что spawn(), но возвращает индекс новой плитки (или -1) — нужен экрану, чтобы показать её появление
  spawnIdx(g) {
    const empty = [];
    for (let i = 0; i < g.length; i++) if (!g[i]) empty.push(i);
    if (!empty.length) return -1;
    const at = empty[Math.floor(Math.random() * empty.length)];
    g[at] = Math.random() < 0.9 ? 2 : 4;
    return at;
  },

  // как slideLeft, но запоминает путь каждой плитки: moves = [{ from: [k] | [k1, k2], to, value }]
  // (from — позиции в исходном ряду; два номера — плитки слились; value — значение на новом месте)
  slideLeftT(row) {
    const idx = [];
    for (let k = 0; k < row.length; k++) if (row[k]) idx.push(k);
    const out = [], moves = [];
    let gained = 0, merged = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[i];
      if (i < idx.length - 1 && row[a] === row[idx[i + 1]]) {
        const v = row[a] * 2;
        moves.push({ from: [a, idx[i + 1]], to: out.length, value: v });
        out.push(v); gained += v; i++; merged = true;
      } else { moves.push({ from: [a], to: out.length, value: row[a] }); out.push(row[a]); }
    }
    while (out.length < row.length) out.push(0);
    return { row: out, gained, moved: merged || out.some((v, i) => v !== row[i]), moves };
  },

  // move() с трассировкой: moves — для каждой плитки откуда (индексы плоской сетки) → куда; grid — без новой плитки
  moveT(g, dir) {
    const N = G2048.SIZE, out = g.slice();
    const horiz = dir === "left" || dir === "right", rev = dir === "right" || dir === "down";
    // позиция p внутри обработанной (при необходимости развёрнутой) линии i → индекс плоской сетки
    const flat = (i, p) => { const k = rev ? N - 1 - p : p; return horiz ? i * N + k : k * N + i; };
    let gained = 0, moved = false;
    const moves = [];
    for (let i = 0; i < N; i++) {
      const r = G2048.slideLeftT(G2048.getLine(out, i, horiz, rev));
      G2048.setLine(out, i, r.row, horiz, rev);
      gained += r.gained; moved = moved || r.moved;
      for (const m of r.moves) moves.push({ from: m.from.map((p) => flat(i, p)), to: flat(i, m.to), value: m.value });
    }
    return { grid: out, gained, moved, moves };
  },
};

const Game2048 = {
  cur: null,
  SLIDE_MS: 120,
  BEST_KEY: "dg_2048_best",

  fresh() {
    return { grid: G2048.newGrid(), score: 0, best: Game2048.loadBest(), over: false, won: false, session: null, sid: 0 };
  },
  loadBest() { try { return +localStorage.getItem(Game2048.BEST_KEY) || 0; } catch (e) { return 0; } },
  saveBest(v) { try { localStorage.setItem(Game2048.BEST_KEY, String(v)); } catch (e) {} },

  open() {
    const pg = Pg.open({
      title: T("2048"), cls: "gameplay g2048",
      right: `<button class="icon-btn" data-a="lb" aria-label="${esc(T("Таблица лидеров"))}">${SI.stats}</button>`,
      data: Game2048.fresh(),
      build: (p) => Game2048.build(p),
      onClose: () => Game2048.dispose(pg),
    });
    Game2048.cur = pg;
    pg.on.lb = () => Games.leaderboard("2048", "2048");
    pg.on.restart = () => Game2048.restart(pg);
    Game2048.bindInput(pg);
    Game2048.newSession(pg);
  },

  // всё запущенное игрой останавливается вместе с экраном
  dispose(pg) {
    const x = pg.x;
    if (x) {
      x.timers.forEach(clearTimeout); x.timers.clear();
      document.removeEventListener("keydown", x.onKey);
      window.removeEventListener("resize", x.onResize);
      if (x.ro) x.ro.disconnect();
    }
    Game2048.saveBest(pg.data.best);
    Game2048.finish(pg);
    if (Game2048.cur === pg) Game2048.cur = null;
  },

  newSession(pg) {
    const d = pg.data, sid = ++d.sid;
    d.session = null;
    GameSession.start("2048").then((s) => { if (pg.alive && d.sid === sid) d.session = s; });
  },

  // результат уходит на сервер один раз: при проигрыше, рестарте или выходе из игры
  finish(pg) {
    const d = pg.data;
    if (d.session && d.score > 0) GameSession.submit(d.session, d.score);
    d.session = null;
  },

  later(pg, fn, ms) {
    const x = pg.x;
    const id = setTimeout(() => { x.timers.delete(id); if (pg.alive) fn(); }, ms);
    x.timers.add(id);
  },

  restart(pg) {
    const d = pg.data, x = pg.x;
    Game2048.saveBest(d.best);
    Game2048.finish(pg);
    x.timers.forEach(clearTimeout); x.timers.clear();
    x.merges = [];
    const sid = d.sid;
    Object.assign(d, Game2048.fresh(), { sid });
    Game2048.paintAll(pg);
    Game2048.newSession(pg);
  },

  // разметка строится один раз; плитки — отдельные абсолютно позиционированные элементы, которые ЕДУТ (transform),
  // сливаются и появляются с анимацией, а не перерисовываются целиком
  build(pg) {
    pg.set(`
      <div class="g-hud">
        <div class="g-hudv g2-sc"><small>${esc(T("Очки"))}</small><b class="g2-score">0</b><i class="g2-gain"></i></div>
        <div class="g-hudv g2-bestv"><small>${esc(T("Рекорд"))}</small><b class="g2-best">0</b></div>
        <button class="g-restart" data-a="restart" aria-label="${esc(T("Заново"))}">${SI.shuffle}</button>
      </div>
      <div class="g-stage">
        <div class="g2-board">
          <div class="g-tiles">
            <div class="g2-bg">${'<div class="g-tcell"></div>'.repeat(16)}</div>
            <div class="g2-layer"></div>
          </div>
          <div class="gb-combo"></div>
          <div class="g-over" hidden>
            <p>${esc(T("Игра окончена"))}</p>
            <div class="gb-over-s"></div>
            <button class="pbtn" data-a="restart">${esc(T("Играть снова"))}</button>
          </div>
        </div>
      </div>
      <p class="g-hint">${esc(T("Свайп или стрелки — сдвинуть плитки"))}</p>
    `);
    const x = pg.x = {
      board: pg.$(".g2-board"), layer: pg.$(".g2-layer"), stage: pg.$(".g-stage"),
      score: pg.$(".g2-score"), best: pg.$(".g2-best"), gain: pg.$(".g2-gain"),
      over: pg.$(".g-over"), overS: pg.$(".gb-over-s"), combo: pg.$(".gb-combo"),
      tl: new Array(16).fill(null),      // что СЕЙЧАС нарисовано на каждой клетке: { el, v }
      merges: [], timers: new Set(), onKey: null, onResize: null, ro: null,
    };
    // размер плитки считаем из реальной ширины слоя (не зависим от container-units в старых WebView)
    const size = () => { const w = x.layer.clientWidth; if (w) x.layer.style.setProperty("--cs", ((w - 24) / 4).toFixed(2) + "px"); };
    x.onResize = size;
    window.addEventListener("resize", size);
    if (window.ResizeObserver) { x.ro = new ResizeObserver(size); x.ro.observe(x.layer); }
    size();
    Game2048.paintAll(pg);
  },

  tileEl(v, i, cls) {
    const el = document.createElement("div");
    el.className = "g-t";
    el.dataset.v = v; el.dataset.d = String(v).length;
    el.style.setProperty("--r", Math.floor(i / G2048.SIZE)); el.style.setProperty("--c", i % G2048.SIZE);
    el.innerHTML = `<div class="g-tv${cls ? " " + cls : ""}">${v}</div>`;
    return el;
  },

  setPos(t, i) {
    t.el.style.setProperty("--r", Math.floor(i / G2048.SIZE)); t.el.style.setProperty("--c", i % G2048.SIZE);
  },

  // полная (пере)расстановка плиток по логической сетке — при старте/рестарте
  paintAll(pg) {
    const d = pg.data, x = pg.x;
    x.layer.textContent = "";
    x.tl = new Array(16).fill(null);
    x.merges = [];
    d.grid.forEach((v, i) => {
      if (!v) return;
      const el = Game2048.tileEl(v, i, "new");
      x.layer.appendChild(el);
      x.tl[i] = { el, v };
    });
    Game2048.paintScore(pg, false);
    x.over.hidden = !d.over;
  },

  paintScore(pg, bump) {
    const d = pg.data, x = pg.x;
    x.score.textContent = d.score;
    x.best.textContent = Math.max(d.best, d.score);
    if (bump) { x.score.classList.remove("bump"); void x.score.offsetWidth; x.score.classList.add("bump"); }
  },

  // слитые плитки: две старые уезжают под одну точку, потом на их месте появляется одна новая «с хлопком»
  flushMerges(pg) {
    const x = pg.x;
    if (!x.merges.length) return;
    for (const m of x.merges) {
      m.a.el.remove(); m.b.el.remove();
      const el = Game2048.tileEl(m.value, m.to, "merge");
      x.layer.appendChild(el);
      x.tl[m.to] = { el, v: m.value };
    }
    x.merges = [];
  },

  bindInput(pg) {
    const x = pg.x;
    x.onKey = (e) => {
      if (!pg.alive) return;
      const m = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" }[e.key];
      if (m) { e.preventDefault(); Game2048.act(pg, m); }
    };
    document.addEventListener("keydown", x.onKey);
    // свайп по полю: ход срабатывает, как только палец прошёл порог (не ждём отпускания — отклик мгновенный)
    let g = null;
    x.stage.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".g-over")) return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, done: false };
    });
    x.stage.addEventListener("pointermove", (e) => {
      if (!g || g.done || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 26) return;
      g.done = true;
      Game2048.act(pg, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
    });
    const end = () => { g = null; };
    x.stage.addEventListener("pointerup", end);
    x.stage.addEventListener("pointercancel", end);
  },

  // ход (вызывается и свайпом/клавишей, и напрямую — из тестов)
  act(pg, dir) {
    const d = pg.data, x = pg.x;
    if (d.over) return false;
    Game2048.flushMerges(pg);                       // предыдущая анимация слияния заканчивается мгновенно
    const res = G2048.moveT(d.grid, dir);
    if (!res.moved) { Game2048.nope(pg); return false; }

    // 1) плитки едут на новые места
    const old = x.tl, tl = new Array(16).fill(null), merges = [];
    for (const m of res.moves) {
      const a = old[m.from[0]];
      if (!a) continue;
      Game2048.setPos(a, m.to);
      if (m.from.length === 2) {
        const b = old[m.from[1]];
        Game2048.setPos(b, m.to);
        a.el.style.zIndex = 1; b.el.style.zIndex = 1;
        merges.push({ to: m.to, value: m.value, a, b });
      } else tl[m.to] = a;
    }
    x.tl = tl; x.merges = merges;

    // 2) логика: очки, новая плитка, конец игры
    const grid = res.grid;
    const at = G2048.spawnIdx(grid);
    d.grid = grid;
    d.score += res.gained;
    if (d.score > d.best) d.best = d.score;
    if (at >= 0) {
      const el = Game2048.tileEl(grid[at], at, "new");
      x.layer.appendChild(el);
      tl[at] = { el, v: grid[at] };
    }
    haptic(merges.length ? "medium" : "light");
    Game2048.paintScore(pg, res.gained > 0);
    if (res.gained > 0) Game2048.showGain(pg, res.gained);
    if (merges.length) Game2048.later(pg, () => Game2048.flushMerges(pg), Game2048.SLIDE_MS);

    // 3) 2048 достигнута (один раз) / нет ходов
    if (!d.won && merges.some((m) => m.value >= 2048)) { d.won = true; Game2048.banner(pg, "2048!"); }
    if (!G2048.canMove(grid)) {
      d.over = true;
      Game2048.later(pg, () => Game2048.gameOver(pg), 420);
    }
    return true;
  },

  gameOver(pg) {
    const d = pg.data, x = pg.x;
    Game2048.saveBest(d.best);
    x.overS.innerHTML = `<b>${d.score}</b><small>${esc(T("Рекорд"))}: ${Math.max(d.best, d.score)}</small>`;
    x.over.hidden = false;
    Game2048.finish(pg);
    haptic("heavy");
  },

  // ход невозможен — короткая «встряска» поля вместо тишины
  nope(pg) {
    const el = pg.x.board;
    el.classList.remove("nope"); void el.offsetWidth; el.classList.add("nope");
  },

  showGain(pg, n) {
    const el = pg.x.gain;
    el.textContent = "+" + n;
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  },

  banner(pg, text) {
    const el = pg.x.combo;
    el.textContent = text;
    el.className = "gb-combo";
    void el.offsetWidth;
    el.className = "gb-combo show mega";
  },
};
