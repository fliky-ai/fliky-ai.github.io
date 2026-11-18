// space_games_a.js — «Мафия» и «Морской бой»
// ───────────────────────── МАФИЯ ─────────────────────────
SpGames.T.mafia = {
  ROLE: { mafia: ["🔪", "Мафия", "Ночью вы с напарниками выбираете жертву. Днём — не выдайте себя."], doctor: ["🩺", "Доктор", "Каждую ночь лечите одного игрока (не одного и того же две ночи подряд)."],
    sheriff: ["⭐", "Шериф", "Каждую ночь проверяйте одного игрока — узнаете, мафия он или нет."], town: ["🙂", "Мирный житель", "Ищите мафию в обсуждении и голосуйте днём."] },
  rules: "Город спит ночью — мафия выбирает жертву, доктор лечит, шериф проверяет. Днём все обсуждают (в чате или голосом) и голосуют, кого казнить. Город побеждает, когда нет мафии; мафия — когда её не меньше, чем остальных.",
  rn(r) { return T(SpGames.T.mafia.ROLE[r] ? SpGames.T.mafia.ROLE[r][1] : "Игрок"); },
  logText(e) {
    const n = (u) => SpGames.nm(u), M = SpGames.T.mafia, rr = (r) => `${M.ROLE[r][0]} ${M.rn(r)}`;
    switch (e.k) {
      case "kill": return `🌙 ${T("Ночью убит(а) {0} — {1}", n(e.u), rr(e.r))}`;
      case "saved": return `🩺 ${T("Доктор спас жертву — ночью никто не погиб")}`;
      case "quiet": return `🌙 ${T("Ночь прошла тихо")}`;
      case "exec": return `⚖️ ${T("Город казнил {0} — {1}", n(e.u), rr(e.r))}`;
      case "noexec": return `⚖️ ${T("Мнения разошлись — никого не казнили")}`;
      case "left": return `🚪 ${T("{0} покинул(а) игру — {1}", n(e.u), rr(e.r))}`;
    }
    return "";
  },
  render(G, me, gs) {
    const uid = App.user.id, M = SpGames.T.mafia, inG = G.players.includes(uid), role = me.role, alive = G.alive.includes(uid), ph = G.phase;
    const phName = { night: ["🌙", "Ночь"], day: ["☀️", "День: обсуждение"], vote: ["🗳️", "Голосование"], over: ["🏁", "Игра окончена"] }[ph] || ["", ""];
    let top = `<div class="spgm-mf-h ${ph}"><span>${phName[0]}</span><div><b>${esc(T(phName[1]))}</b><small>${esc(T("День {0}", G.day))} · ${esc(T("мафии: {0}", G.nm))}</small></div>${ph !== "over" ? `<em class="spgm-tm" data-dl="${G.dl}">${SpGames.left(G.dl)}</em>` : ""}</div>`;
    if (inG && role) { const R0 = M.ROLE[role]; top += `<div class="spgm-role ${role}${alive ? "" : " dead"}"><span>${R0[0]}</span><div><b>${esc(T("Ваша роль"))}: ${esc(T(R0[1]))}${alive ? "" : " · " + esc(T("выбыл(а)"))}</b><small>${esc(T(R0[2]))}</small></div></div>`; }
    if (ph === "over") {
      const win = G.win === "mafia";
      top += `<div class="spgm-win ${win ? "mf" : "tw"}"><span>${win ? "🔪" : "🏙️"}</span><b>${esc(win ? T("Мафия победила!") : T("Город победил!"))}</b></div>`;
    }
    const dead = new Set((G.dead || []).map((x) => x.u));
    const pick = ph === "night" ? me.pick || 0 : ph === "vote" ? me.vote || 0 : 0;
    const vc = G.vc || {}, canAct = inG && alive;
    let hint = "";
    if (ph === "night") {
      if (!canAct) hint = T("Вы выбыли. Наблюдайте за игрой.");
      else if (role === "mafia") hint = T("Выберите жертву. Напарники видят ваш выбор.");
      else if (role === "doctor") hint = T("Кого вылечить этой ночью?");
      else if (role === "sheriff") hint = T("Кого проверить этой ночью?");
      else hint = T("Город спит… Ждите утра.");
    } else if (ph === "day") hint = canAct ? T("Обсуждайте в чате или голосом. Когда все будут готовы — начнётся голосование.") : T("Вы выбыли. Наблюдайте за игрой.");
    else if (ph === "vote") hint = canAct ? T("Выберите, кого казнить, или пропустите голосование.") : T("Вы выбыли. Наблюдайте за игрой.");
    const selectable = canAct && ((ph === "night" && role !== "town") || ph === "vote");
    const cells = G.players.map((u) => {
      const al = G.alive.includes(u), sel = pick === u, isM = me.mates && me.mates.includes(u);
      const mp = me.mpicks ? Object.entries(me.mpicks).filter(([, t]) => t === u).length : 0;
      const rv = G.roles ? G.roles[u] : null, dr = (G.dead || []).find((x) => x.u === u);
      const dis = !selectable || !al || (ph === "night" && ((role === "mafia" && isM) || (role === "sheriff" && u === uid))) || (ph === "vote" && u === uid);
      return `<button class="spgm-mf-p${al ? "" : " dead"}${sel ? " sel" : ""}${isM ? " mate" : ""}" data-mf="${u}" type="button" ${dis ? "disabled" : ""}>${SpGames.av(u, "md")}<b>${esc(SpGames.nm(u))}</b>${vc[u] ? `<i class="n">${vc[u]}</i>` : ""}${mp ? `<i class="m">🔪${mp > 1 ? mp : ""}</i>` : ""}${isM ? `<u>🔪</u>` : ""}${!al && (rv || (dr && dr.r)) ? `<u>${M.ROLE[rv || dr.r][0]}</u>` : ""}${ph === "over" && al && rv ? `<u>${M.ROLE[rv][0]}</u>` : ""}${ph === "vote" && G.voted && G.voted.includes(u) ? `<s>✓</s>` : ""}</button>`;
    }).join("");
    let extra = "";
    if (ph === "day" && canAct) extra = `<div class="spgm-acts"><button class="spgm-btn go" data-mfa="ready" type="button" ${(G.ready || []).includes(uid) ? "disabled" : ""}>${esc((G.ready || []).includes(uid) ? T("Ждём остальных") : T("Готов голосовать"))} · ${(G.ready || []).length}/${G.alive.length}</button></div>`;
    if (ph === "vote" && canAct) extra = `<div class="spgm-acts"><button class="spgm-btn ghost" data-mfa="skip" type="button">${esc(me.vote === 0 ? "✓ " + T("Вы пропустили") : T("Пропустить голосование"))}</button></div>`;
    const sres = role === "sheriff" && me.sres && me.sres.length ? `<div class="spgm-sec">${esc(T("Ваши проверки"))}</div><div class="spgm-mf-sr">${me.sres.map((x) => `<span class="${x[1] ? "bad" : "ok"}">${SpGames.av(x[0], "sm")}<b>${esc(SpGames.nm(x[0]))}</b><em>${x[1] ? "🔪 " + esc(T("мафия")) : "🙂 " + esc(T("не мафия"))}</em></span>`).join("")}</div>` : "";
    const log = (G.log || []).slice().reverse().map((e) => `<div>${esc(M.logText(e))}</div>`).join("");
    const dyn = `${hint ? `<div class="spgm-hint">${esc(hint)}</div>` : ""}<div class="spgm-mf-g">${cells}</div>${extra}${sres}${log ? `<div class="spgm-sec">${esc(T("Что было"))}</div><div class="spgm-log">${log}</div>` : ""}`;
    return { key: `${ph}:${G.day}:${alive ? 1 : 0}`, top, dyn, foot: "" };
  },
  click(e, G, me) {
    const p = e.target.closest("[data-mf]");
    if (p && !p.disabled) { haptic(); return SpGames.act(G.phase === "night" ? "night" : "vote", { t: +p.dataset.mf }); }
    const a = e.target.closest("[data-mfa]");
    if (a && !a.disabled) { haptic(); return a.dataset.mfa === "ready" ? SpGames.act("ready") : SpGames.act("vote", { t: 0 }); }
  },
};

// ───────────────────────── МОРСКОЙ БОЙ ─────────────────────────
SpGames.T.sea = {
  N: 10, FLEET: [4, 3, 3, 2, 2, 2, 1, 1, 1, 1],
  rules: "Расставьте корабли (4, 3, 3, 2, 2, 2, 1, 1, 1, 1) так, чтобы они не касались друг друга. Потом по очереди стреляйте по полям соперников: попал — стреляешь ещё раз. Побеждает последний, у кого остались корабли.",
  coord(c) { return String.fromCharCode(65 + (c % 10)) + (Math.floor(c / 10) + 1); },
  nb(c) { const out = [], r = Math.floor(c / 10), k = c % 10; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const rr = r + a, kk = k + b; if ((a || b) && rr >= 0 && rr < 10 && kk >= 0 && kk < 10) out.push(rr * 10 + kk); } return out; },
  random() {
    const S = SpGames.T.sea;
    for (let t = 0; t < 200; t++) {
      const blocked = new Set(), ships = []; let ok = true;
      for (const ln of S.FLEET.slice().sort((a, b) => b - a)) {
        let placed = false;
        for (let i = 0; i < 300 && !placed; i++) {
          const hor = Math.random() < 0.5, r = Math.floor(Math.random() * (10 - (hor ? 0 : ln - 1))), k = Math.floor(Math.random() * (10 - (hor ? ln - 1 : 0)));
          const cells = Array.from({ length: ln }, (_, j) => r * 10 + k + (hor ? j : j * 10));
          if (!cells.some((c) => blocked.has(c))) { ships.push(cells); cells.forEach((c) => { blocked.add(c); S.nb(c).forEach((n) => blocked.add(n)); }); placed = true; }
        }
        if (!placed) { ok = false; break; }
      }
      if (ok) return ships;
    }
    return [];
  },
  grid(str, o) {
    // str — 100 символов поля: . вода, o промах, x попадание, X потоплен;  o.ships — свои корабли (#)
    let h = `<div class="sea-g${o.big ? " big" : ""}${o.cls ? " " + o.cls : ""}">`;
    for (let c = 0; c < 100; c++) {
      const ch = str ? str[c] : ".", sh = o.ships && o.ships[c] === "#";
      const cl = ch === "x" ? "hit" : ch === "X" ? "sunk" : ch === "o" ? "miss" : sh ? "ship" : "";
      h += `<i data-c="${c}" class="${cl}${o.sel === c ? " sel" : ""}"></i>`;
    }
    return h + "</div>";
  },
  render(G, me, gs) {
    const S = SpGames.T.sea, uid = App.user.id, inG = G.players.includes(uid), ph = G.phase;
    if (ph === "place") {
      const ready = me.ready, st = gs.sea || (gs.sea = { ships: [], len: 4, hor: true });
      const top = `<div class="spgm-mf-h place"><span>🚢</span><div><b>${esc(T("Расставьте корабли"))}</b><small>${esc(T("Готовы: {0} из {1}", (G.ready || []).length, G.players.length))}</small></div><em class="spgm-tm" data-dl="${G.dl}">${SpGames.left(G.dl)}</em></div>`;
      if (!inG) return { key: "place:spec", top, dyn: `<div class="spgm-hint">${esc(T("Игроки расставляют корабли. Вы наблюдаете."))}</div>`, foot: "" };
      if (ready) {
        return { key: "place:ready", top, dyn: `<div class="spgm-hint">${esc(T("Вы готовы. Ждём остальных…"))}</div>${S.grid("", { ships: me.ships, big: true })}<div class="spgm-acts"><button class="spgm-btn ghost" data-sea="unready" type="button">${esc(T("Передумал(а)"))}</button></div>`, foot: "" };
      }
      const left = {}; S.FLEET.forEach((l) => { left[l] = (left[l] || 0) + 1; }); st.ships.forEach((s) => { left[s.length]--; });
      const occ = {}; st.ships.forEach((s, i) => s.forEach((c) => { occ[c] = i; }));
      const str = "#".repeat(0); void str;
      const ships = Array(100).fill("."); st.ships.forEach((s) => s.forEach((c) => { ships[c] = "#"; }));
      const palette = [4, 3, 2, 1].map((l) => `<button class="sea-pal${st.len === l ? " on" : ""}" data-sea="len" data-l="${l}" type="button" ${left[l] > 0 ? "" : "disabled"}>${"▮".repeat(l)}<em>×${Math.max(0, left[l])}</em></button>`).join("");
      const done = st.ships.length === S.FLEET.length;
      return { key: "place:edit:" + st.ships.length + ":" + st.len + ":" + st.hor, top,
        dyn: `<div class="spgm-hint">${esc(done ? T("Все корабли стоят. Нажмите «Готов».") : T("Выберите корабль и нажмите на клетку. Нажмите на корабль, чтобы убрать его."))}</div><div class="sea-pals">${palette}<button class="sea-pal rot" data-sea="rot" type="button">${esc(st.hor ? "↔" : "↕")}</button></div>${S.grid("", { ships: ships.join(""), big: true, cls: "place" })}<div class="spgm-acts"><button class="spgm-btn ghost" data-sea="rand" type="button">🎲 ${esc(T("Случайно"))}</button><button class="spgm-btn ghost" data-sea="clear" type="button">${esc(T("Очистить"))}</button><button class="spgm-btn go" data-sea="ready" type="button" ${done ? "" : "disabled"}>${esc(T("Готов"))}</button></div>`, foot: "" };
    }
    // бой
    const my = G.turn === uid && ph === "play", alive = G.alive || [];
    const others = G.players.filter((p) => p !== uid);
    if (!gs.tgt || gs.tgt === uid || (!alive.includes(gs.tgt) && alive.some((p) => p !== uid))) gs.tgt = (others.find((p) => alive.includes(p)) || others[0] || uid);
    if (my && gs.autoSel !== G.turn + ":" + (G.last && G.last.c)) { gs.autoSel = G.turn + ":" + (G.last && G.last.c); }
    const tgt = gs.tgt, boards = G.boards || {};
    const top = ph === "over" ? `<div class="spgm-win tw"><span>🏆</span><b>${esc(G.win ? T("Победил(а) {0}", SpGames.nm(G.win)) : T("Игра окончена"))}</b></div>`
      : `<div class="spgm-mf-h play ${my ? "my" : ""}"><span>${my ? "🎯" : "⏳"}</span><div><b>${esc(my ? T("Ваш ход — стреляйте!") : T("Ходит {0}", SpGames.nm(G.turn)))}</b><small>${esc(S.lastText(G))}</small></div><em class="spgm-tm" data-dl="${G.dl}">${SpGames.left(G.dl)}</em></div>`;
    const pills = others.map((p) => `<button class="sea-pill${p === tgt ? " on" : ""}${alive.includes(p) ? "" : " dead"}${G.turn === p ? " turn" : ""}" data-sea="tgt" data-u="${p}" type="button">${SpGames.av(p, "sm")}<b>${esc(SpGames.nm(p))}</b><em>🚢${(G.left || {})[p] || 0}</em></button>`).join("");
    const canShoot = my && alive.includes(tgt) && tgt !== uid;
    const big = tgt && tgt !== uid ? S.grid(boards[tgt], { big: true, cls: canShoot ? "shoot" : "", ships: ph === "over" && G.reveal ? G.reveal[tgt] : null }) : "";
    const myb = inG ? `<div class="spgm-sec">${esc(T("Ваше поле"))} · 🚢${(G.left || {})[uid] || 0}${alive.includes(uid) ? "" : " · " + esc(T("выбыл(а)"))}</div>${S.grid(boards[uid], { ships: me.ships, cls: "mini" })}` : "";
    const dyn = `${others.length ? `<div class="sea-pills">${pills}</div>` : ""}${big}${myb}`;
    return { key: ph + ":" + tgt + ":" + (my ? 1 : 0), top, dyn, foot: "" };
  },
  lastText(G) {
    const l = G.last; if (!l) return T("Бой начался");
    const by = SpGames.nm(l.by), S = SpGames.T.sea;
    if (l.res === "skip") return T("{0} пропустил(а) ход", by);
    const at = SpGames.nm(l.at), c = S.coord(l.c);
    return l.res === "miss" ? T("{0} → {1}: {2} — мимо", by, at, c) : l.res === "hit" ? T("{0} → {1}: {2} — попал!", by, at, c) : l.res === "sunk" ? T("{0} → {1}: {2} — потопил!", by, at, c) : T("{0} уничтожил(а) флот {1}!", by, at);
  },
  click(e, G, me) {
    const S = SpGames.T.sea, gs = SpGames.gs(), a = e.target.closest("[data-sea]");
    if (G.phase === "place") {
      const st = gs.sea || (gs.sea = { ships: [], len: 4, hor: true });
      if (a) {
        const k = a.dataset.sea;
        if (k === "len") st.len = +a.dataset.l;
        else if (k === "rot") st.hor = !st.hor;
        else if (k === "clear") st.ships = [];
        else if (k === "rand") st.ships = S.random();
        else if (k === "ready") { if (st.ships.length === S.FLEET.length) SpGames.act("place", { ships: st.ships }); return; }
        else if (k === "unready") { SpGames.act("unready"); return; }
        haptic(); return SpGames.forceRepaint();
      }
      const cell = e.target.closest(".sea-g.place i[data-c]"); if (!cell) return;
      const c = +cell.dataset.c, hit = st.ships.findIndex((s) => s.includes(c));
      if (hit >= 0) { st.ships.splice(hit, 1); haptic(); return SpGames.forceRepaint(); }
      const left = {}; S.FLEET.forEach((l) => { left[l] = (left[l] || 0) + 1; }); st.ships.forEach((s) => { left[s.length]--; });
      if (!(left[st.len] > 0)) { const nl = [4, 3, 2, 1].find((l) => left[l] > 0); if (!nl) return; st.len = nl; }
      const r = Math.floor(c / 10), k = c % 10, ln = st.len;
      const cells = Array.from({ length: ln }, (_, j) => r * 10 + k + (st.hor ? j : j * 10));
      const inb = st.hor ? k + ln <= 10 : r + ln <= 10;
      const used = new Set(); st.ships.forEach((s) => s.forEach((x) => { used.add(x); S.nb(x).forEach((n) => used.add(n)); }));
      if (!inb || cells.some((x) => used.has(x))) { haptic(); return toast(T("Сюда корабль не поставить — они не должны касаться друг друга")); }
      st.ships.push(cells); haptic(); return SpGames.forceRepaint();
    }
    if (a && a.dataset.sea === "tgt") { gs.tgt = +a.dataset.u; haptic(); return SpGames.forceRepaint(); }
    const cell = e.target.closest(".sea-g.shoot i[data-c]");
    if (cell && G.phase === "play" && G.turn === App.user.id) {
      const c = +cell.dataset.c; if (cell.classList.contains("hit") || cell.classList.contains("miss") || cell.classList.contains("sunk")) return;
      haptic("medium"); SpGames.act("shoot", { at: gs.tgt, c });
    }
  },
};
