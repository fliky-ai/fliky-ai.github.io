// space_games_b.js — «Gartic Phone» и «UNO»
// ───────────────────────── GARTIC PHONE ─────────────────────────
const GA_COLORS = ["#161616", "#ffffff", "#e53935", "#fb8c00", "#fdd835", "#43a047", "#00acc1", "#1e88e5", "#8e24aa", "#ec407a", "#6d4c41", "#9e9e9e", "#00e676", "#ff80ab", "#4e342e", "#ffcc80"];
const GA_WIDTHS = [0, 1.6, 4, 9, 16];                   // толщина по номеру 1..4 (в точках холста 500×500)
SpGames.T.gartic = {
  rules: "Каждый пишет фразу. Потом блокноты идут по кругу: следующий рисует вашу фразу, ещё следующий пытается угадать рисунок словами — и так далее. В конце смотрим, во что превратилась фраза.",
  // рисунок из штрихов (координаты 0..1000) на холсте
  paint(cv, strokes) {
    const ctx = cv.getContext("2d"), k = cv.width / 1000;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    (strokes || []).forEach((s) => SpGames.T.gartic.stroke(ctx, s, k));
  },
  stroke(ctx, s, k) {
    ctx.strokeStyle = ctx.fillStyle = GA_COLORS[s.c] || GA_COLORS[0]; ctx.lineWidth = (GA_WIDTHS[s.w] || 4) * (ctx.canvas.width / 500);
    const p = s.p;
    if (p.length === 2) { ctx.beginPath(); ctx.arc(p[0] * k, p[1] * k, ctx.lineWidth / 2, 0, 6.3); ctx.fill(); return; }
    ctx.beginPath(); ctx.moveTo(p[0] * k, p[1] * k);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * k, p[i + 1] * k);
    ctx.stroke();
  },
  entryHTML(e, i) {
    const nm = SpGames.nm(e.by);
    return `<div class="ga-e ${e.k}"><div class="ga-eh">${SpGames.av(e.by, "sm")}<b>${esc(nm)}</b><em>${e.k === "d" ? "🎨" : i === 0 ? "✍️" : "💭"}</em></div>${e.k === "d" ? `<canvas class="ga-cv ro" width="500" height="500" data-fk="${i}"></canvas>` : `<div class="ga-tx">${esc(e.v || "…")}</div>`}</div>`;
  },
  render(G, me, gs) {
    const uid = App.user.id, inG = G.players.includes(uid), A = (gs.ga = gs.ga || {}), ph = G.phase;
    if (ph === "round") {
      const kind = G.kind, tm = `<em class="spgm-tm" data-dl="${G.dl}">${SpGames.left(G.dl)}</em>`;
      const top = `<div class="spgm-mf-h play"><span>${kind === "d" ? "🎨" : "✍️"}</span><div><b>${esc(T("Раунд {0} из {1}", G.r + 1, G.rounds))}</b><small>${esc(kind === "d" ? T("Рисуем") : G.r === 0 ? T("Придумываем фразу") : T("Угадываем рисунок"))}</small></div>${tm}</div>`;
      const done = (G.done || []).length, dyn = `<div class="ga-prog"><span>${esc(T("Готово: {0} из {1}", done, G.players.length))}</span><div>${(G.done || []).map((u) => `<i>${SpGames.av(u, "sm")}</i>`).join("")}</div></div>`;
      if (!inG) return { key: "r:" + G.r + ":spec", top, dyn: `<div class="spgm-hint">${esc(T("Игроки заняты. Вы наблюдаете — в конце покажем все цепочки."))}</div>` + dyn, foot: "" };
      if (me.sent) return { key: "r:" + G.r + ":sent", top, dyn: `<div class="spgm-ok">✅ ${esc(T("Отправлено! Ждём остальных…"))}</div>` + dyn, foot: "" };
      if (me.k === "t") {
        const prev = me.pk === "d" ? `<div class="ga-prompt">${esc(T("Что здесь нарисовано? Опишите одной фразой"))}</div><canvas class="ga-cv ro" id="ga-prev" width="500" height="500"></canvas>`
          : `<div class="ga-prompt">${esc(me.first ? T("Придумайте фразу, которую будут рисовать. Чем смешнее — тем лучше") : T("Опишите, что видите"))}</div>`;
        return { key: "r:" + G.r + ":t", top, dyn, foot: `${prev}<form class="spgm-em-f" id="ga-f"><input id="ga-in" maxlength="80" placeholder="${esc(me.first ? T("Например: кот в сапогах на скейте") : T("Что это?"))}" autocomplete="off" enterkeyhint="send"><button type="submit">${SPI.check}</button></form>` };
      }
      const pal = GA_COLORS.map((c, i) => `<button class="ga-col${i === (A.color || 0) ? " on" : ""}" data-gac="${i}" style="background:${c}" type="button" aria-label="${c}"></button>`).join("");
      const wd = [1, 2, 3, 4].map((w) => `<button class="ga-w${(A.w || 2) === w ? " on" : ""}" data-gaw="${w}" type="button"><i style="width:${w * 4 + 2}px;height:${w * 4 + 2}px"></i></button>`).join("");
      return { key: "r:" + G.r + ":d", top, dyn, foot: `<div class="ga-prompt">${esc(T("Нарисуйте:"))} <b>${esc(me.prev || "")}</b></div><canvas class="ga-cv" id="ga-cv" width="500" height="500"></canvas>
        <div class="ga-tools"><div class="ga-pal">${pal}</div><div class="ga-row">${wd}<button class="ga-b" data-ga="undo" type="button">↶</button><button class="ga-b" data-ga="clear" type="button">🗑</button><button class="spgm-btn go" data-ga="send" type="button">${esc(T("Готово"))}</button></div></div>` };
    }
    if (ph === "reveal") {
      const fr = SpaceRoom.R.frames && SpaceRoom.R.frames.c === G.rev.c ? SpaceRoom.R.frames.e : [];
      const done = G.rev.j >= G.steps - 1;
      return { key: "rev:" + G.rev.c, top: `<div class="spgm-mf-h play"><span>📖</span><div><b>${esc(T("Цепочка: {0}", SpGames.nm(G.owner)))}</b><small>${esc(T("Цепочка {0} из {1}", G.rev.c + 1, G.nchains))}</small></div></div>`,
        dyn: `<div class="ga-chain">${fr.map((e, i) => (e ? SpGames.T.gartic.entryHTML(e, i) : "")).join("")}${G.rev.j < G.steps - 1 ? `<div class="ga-next"><i></i><i></i><i></i></div>` : ""}</div>${G.host === uid ? `<div class="spgm-acts"><button class="spgm-btn ghost" data-ga="skip" type="button">${esc(done ? T("Следующая цепочка") : T("Дальше"))} ▶</button></div>` : ""}`, foot: "" };
    }
    // over
    const v = A.view;
    return { key: "over:" + (v ? v.owner : 0), top: `<div class="spgm-hero" style="background:${SpGames.info.gartic.g}"><span>🎨</span><div><b>${esc(T("Игра окончена"))}</b><small>${esc(T("Откройте любую цепочку"))}</small></div></div>`,
      dyn: v ? `<button class="spgm-btn ghost sm" data-ga="back" type="button">◀ ${esc(T("Все цепочки"))}</button><div class="ga-chain">${v.e.map((e, i) => SpGames.T.gartic.entryHTML(e, i)).join("")}</div>`
        : `<div class="ga-owners">${(G.owners || []).map((u, i) => `<button class="spgm-chip2" data-ga="chain" data-c="${i}" type="button">${SpGames.av(u, "sm")}<b>${esc(SpGames.nm(u))}</b></button>`).join("")}</div>`, foot: "" };
  },
  after(box) { box.querySelectorAll("canvas[data-fk]").forEach((cv) => { const R = SpaceRoom.R, gs = SpGames.gs(); let e = null; const i = +cv.dataset.fk; if (gs.ga && gs.ga.view) e = gs.ga.view.e[i]; else if (R.frames) e = R.frames.e[i]; if (e && cv.dataset.done !== "1") { SpGames.T.gartic.paint(cv, e.v); cv.dataset.done = "1"; } }); },
  mount(box, G, me) {
    const T_ = SpGames.T.gartic, gs = SpGames.gs(), A = (gs.ga = gs.ga || {});
    T_.after(box);
    const prev = box.querySelector("#ga-prev"); if (prev) T_.paint(prev, me.prev);
    const f = box.querySelector("#ga-f");
    if (f) f.addEventListener("submit", async (ev) => { ev.preventDefault(); const v = f.querySelector("input").value.trim(); if (!v) return toast(T("Напишите хоть что-нибудь")); haptic("medium"); await SpGames.act("submit", { v }); });
    const cv = box.querySelector("#ga-cv"); if (!cv) return;
    const ctx = cv.getContext("2d"); A.strokes = []; A.cur = null; A.n = 0;
    T_.paint(cv, []);
    const pos = (ev) => { const r = cv.getBoundingClientRect(); return [Math.max(0, Math.min(1000, Math.round(((ev.clientX - r.left) / r.width) * 1000))), Math.max(0, Math.min(1000, Math.round(((ev.clientY - r.top) / r.height) * 1000)))]; };
    cv.addEventListener("pointerdown", (ev) => {
      ev.preventDefault(); if (A.strokes.length >= 140 || A.n > 6400) return;
      try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
      const [x, y] = pos(ev); A.cur = { c: A.color || 0, w: A.w || 2, p: [x, y] }; A.n += 2;
      T_.stroke(ctx, A.cur, 0.5);
    });
    cv.addEventListener("pointermove", (ev) => {
      const s = A.cur; if (!s) return; ev.preventDefault();
      const [x, y] = pos(ev), lx = s.p[s.p.length - 2], ly = s.p[s.p.length - 1];
      if (Math.abs(x - lx) + Math.abs(y - ly) < 4 || A.n > 6900) return;
      s.p.push(x, y); A.n += 2;
      ctx.strokeStyle = GA_COLORS[s.c]; ctx.lineWidth = GA_WIDTHS[s.w]; ctx.lineCap = ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(lx * 0.5, ly * 0.5); ctx.lineTo(x * 0.5, y * 0.5); ctx.stroke();
    });
    const end = () => { if (A.cur) { A.strokes.push(A.cur); A.cur = null; } };
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end); cv.addEventListener("pointerleave", end);
    cv.addEventListener("touchmove", (ev) => ev.preventDefault(), { passive: false });
  },
  click(e, G) {
    const gs = SpGames.gs(), A = (gs.ga = gs.ga || {}), T_ = SpGames.T.gartic;
    const c = e.target.closest("[data-gac]"); if (c) { A.color = +c.dataset.gac; e.target.closest(".ga-pal").querySelectorAll(".ga-col").forEach((b) => b.classList.toggle("on", b === c)); return haptic(); }
    const w = e.target.closest("[data-gaw]"); if (w) { A.w = +w.dataset.gaw; w.parentNode.querySelectorAll(".ga-w").forEach((b) => b.classList.toggle("on", b === w)); return haptic(); }
    const a = e.target.closest("[data-ga]"); if (!a) return;
    const k = a.dataset.ga, cv = $("ga-cv");
    if (k === "undo" && cv) { A.strokes.pop(); A.n = A.strokes.reduce((s, x) => s + x.p.length, 0); T_.paint(cv, A.strokes); haptic(); }
    else if (k === "clear" && cv) { A.strokes = []; A.n = 0; T_.paint(cv, []); haptic(); }
    else if (k === "send") { if (A.cur) { A.strokes.push(A.cur); A.cur = null; } haptic("medium"); SpGames.act("submit", { v: A.strokes }); }
    else if (k === "skip") SpGames.act("skip");
    else if (k === "chain") SpGames.act("chain", { c: +a.dataset.c }).then((d) => { if (d && d.chain) { A.view = d.chain; SpGames.forceRepaint(); } });
    else if (k === "back") { A.view = null; SpGames.forceRepaint(); }
  },
};

// ───────────────────────── UNO ─────────────────────────
SpGames.T.uno = {
  rules: "У каждого по 7 карт. Кладите карту того же цвета или с тем же значением. «⊘» — пропуск, «⇄» — разворот, «+2» — соседу две карты. Чёрные карты ложатся на любую и меняют цвет. Нет подходящей — берите из колоды. Кто первым избавился от карт — победил.",
  CN: { R: "красный", Y: "жёлтый", G: "зелёный", B: "синий" },
  sym(c) { return { s: "⊘", r: "⇄", d: "+2", w: "★", 4: "+4" }[c[1]] || c[1]; },
  card(c, o) {
    o = o || {};
    return `<button class="uno-c c${c[0]}${o.ok ? " ok" : ""}${o.dim ? " dim" : ""}${o.cls ? " " + o.cls : ""}" ${o.d ? `data-card="${c}"` : ""} type="button" ${o.d && !o.ok ? "disabled" : ""}><i>${SpGames.T.uno.sym(c)}</i><b>${SpGames.T.uno.sym(c)}</b><i>${SpGames.T.uno.sym(c)}</i></button>`;
  },
  okc(G, me, c) { if (me.drawn && c !== me.drawn) return false; return c[0] === "X" || c[0] === G.color || (G.top[0] !== "X" && c[1] === G.top[1]); },
  lastText(G) {
    const l = G.last; if (!l) return T("Игра началась");
    const by = SpGames.nm(l.by), U = SpGames.T.uno;
    if (l.a === "draw") return l.auto ? T("{0} не успел(а) — взял(а) карту", by) : T("{0} взял(а) карту", by);
    if (l.a === "pass") return T("{0} пропустил(а) ход", by);
    if (l.a === "afk") return T("{0} долго не ходил(а) и выбыл(а)", by);
    const t = U.sym(l.card);
    return l.to ? T("{0}: {1} → {2} берёт {3}", by, t, SpGames.nm(l.to), l.n) : T("{0} сыграл(а) {1}", by, t);
  },
  render(G, me, gs) {
    const uid = App.user.id, U = SpGames.T.uno, inG = G.order.includes(uid), my = G.phase === "play" && G.turn === uid, S = (gs.uno = gs.uno || {});
    const ph = G.phase, hand = (me.hand || []).slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
    const top = ph === "over" ? `<div class="spgm-win tw"><span>🏆</span><b>${esc(T("Победил(а) {0}", SpGames.nm(G.winner)))}</b></div>`
      : `<div class="spgm-mf-h play ${my ? "my" : ""}"><span>${my ? "🃏" : "⏳"}</span><div><b>${esc(my ? (me.drawn ? T("Сыграйте эту карту или пропустите ход") : T("Ваш ход")) : T("Ходит {0}", SpGames.nm(G.turn)))}</b><small>${esc(U.lastText(G))}</small></div><em class="spgm-tm" data-dl="${G.dl}">${SpGames.left(G.dl)}</em></div>`;
    const opp = G.order.filter((p) => p !== uid).map((p) => `<span class="uno-o${G.turn === p && ph === "play" ? " turn" : ""}">${SpGames.av(p, "sm")}<b>${esc(SpGames.nm(p))}</b><em>🃏${(G.counts || {})[p] || 0}</em>${(G.uno || []).includes(p) ? `<u>UNO!</u>` : ""}</span>`).join("");
    const colDot = `<span class="uno-col c${G.color}" title="${esc(T(U.CN[G.color] || ""))}"></span>`;
    const table = `<div class="uno-t"><button class="uno-deck" data-uno="draw" type="button" ${my && !me.drawn ? "" : "disabled"}><b>${G.deck}</b><small>${esc(T("колода"))}</small></button><div class="uno-top">${U.card(G.top, { cls: "big" })}${colDot}</div><div class="uno-dir">${G.dir > 0 ? "⟳" : "⟲"}</div></div>`;
    let pick = "";
    if (S.pick && my) pick = `<div class="uno-pick"><b>${esc(T("Выберите цвет"))}</b><div>${["R", "Y", "G", "B"].map((c) => `<button class="uno-col lg c${c}" data-ucol="${c}" type="button" aria-label="${esc(T(U.CN[c]))}"></button>`).join("")}</div><button class="spgm-btn ghost sm" data-uno="cancel" type="button">${esc(T("Отмена"))}</button></div>`;
    const mine = inG && ph === "play" ? `<div class="uno-hand${my ? " my" : ""}">${hand.map((c) => U.card(c, { d: 1, ok: my && U.okc(G, me, c), dim: my && !U.okc(G, me, c) })).join("")}</div>${my && me.drawn ? `<div class="spgm-acts"><button class="spgm-btn ghost" data-uno="pass" type="button">${esc(T("Пропустить ход"))}</button></div>` : ""}`
      : inG && ph === "over" ? `<div class="uno-hand">${hand.map((c) => U.card(c, {})).join("")}</div>` : `<div class="spgm-hint">${esc(T("Вы наблюдаете за игрой"))}</div>`;
    return { key: ph + ":" + (S.pick ? 1 : 0), top, dyn: `<div class="uno-opps">${opp}</div>${table}${pick}${mine}`, foot: "" };
  },
  click(e, G, me) {
    const S = (SpGames.gs().uno = SpGames.gs().uno || {}), U = SpGames.T.uno;
    const c = e.target.closest("[data-card]");
    if (c && !c.disabled) {
      const card = c.dataset.card; haptic();
      if (card[0] === "X") { S.pick = card; return SpGames.forceRepaint(); }
      return SpGames.act("play", { card });
    }
    const col = e.target.closest("[data-ucol]");
    if (col && S.pick) { const card = S.pick; S.pick = null; haptic("medium"); SpGames.forceRepaint(); return SpGames.act("play", { card, color: col.dataset.ucol }); }
    const a = e.target.closest("[data-uno]"); if (!a || a.disabled) return;
    haptic();
    if (a.dataset.uno === "draw") SpGames.act("draw");
    else if (a.dataset.uno === "pass") SpGames.act("pass");
    else if (a.dataset.uno === "cancel") { S.pick = null; SpGames.forceRepaint(); }
  },
};
