// space_games.js — DICEGRAM SPACE: многопользовательские игры комнаты (ядро: меню, лобби, обновление экрана, «Угадай фильм»).
// Мафия и Морской бой — space_games_a.js, Gartic Phone и UNO — space_games_b.js.
// Игра целиком живёт на сервере; здесь только показ состояния и отправка действий. Экран делится на три части:
// top (шапка, не перерисовывается пока этап тот же), dyn (перерисовывается при каждом обновлении), foot (поле ввода/кнопки, тоже не трогается).
const SpGames = {
  T: {},
  info: {
    mafia: { ic: "🐺", n: "Мафия", d: "Город против мафии: ночью убивают, днём голосуют", pl: "5–15", g: "linear-gradient(135deg,#3c2a6e,#8a2f55)" },
    sea: { ic: "🚢", n: "Морской бой", d: "У каждого своё поле. Топите чужие флоты", pl: "2–6", g: "linear-gradient(135deg,#0f4c81,#1aa6b7)" },
    gartic: { ic: "🎨", n: "Gartic Phone", d: "Нарисуй и угадай — испорченный телефон с рисунками", pl: "3–12", g: "linear-gradient(135deg,#d94f8c,#f2a33a)" },
    uno: { ic: "🃏", n: "UNO", d: "Кто первым избавится от всех карт", pl: "2–10", g: "linear-gradient(135deg,#d6332f,#f0b429)" },
    emoji: { ic: "🎬", n: "Угадай фильм", d: "Фильмы, зашифрованные эмодзи: кто быстрее?", pl: "1–30", g: "linear-gradient(135deg,#6a4cff,#37b6ff)" },
  },
  last: { key: "", gid: 0 },
  gs() { const R = SpaceRoom.R; return R ? (R.gs && R.gs.gid === (R.game && R.game.gid) ? R.gs : (R.gs = { gid: R.game ? R.game.gid : 0 })) : {}; },
  prof(uid) { const R = SpaceRoom.R, G = R && R.game; return (R && R.users[uid] && R.users[uid].profile) || (R && R.cusers[uid]) || (G && G.users && G.users[uid]) || { id: uid, name: "" }; },
  nm(uid) { return uid === App.user.id ? T("Вы") : dispName(SpGames.prof(uid)); },
  left(dl) { return Math.max(0, Math.ceil((dl || 0) - Space.now())); },
  async act(op, ex) {
    const R = SpaceRoom.R; if (!R) return null;
    try { return await api("/api/spaces/" + R.id + "/game", { method: "POST", body: Object.assign({ op }, ex || {}) }); }
    catch (e) { toast(e.message); return null; }
  },

  // ───────────── события от сервера ─────────────
  onGame(d) {
    const R = SpaceRoom.R; if (!R) return;
    const was = R.game, g = d.game;
    if (!g || !was || was.gid !== g.gid) { R.gme = null; R.frames = null; R.gs = null; SpGames.last.key = ""; }
    R.game = g;
    if (g && g.me) R.gme = g.me;
    if (g && was && was.gid === g.gid && was.phase !== "over" && g.phase === "over") SpaceMore.archTouch();
    if (R.tab === "games") SpGames.repaint();
    else { if (g && (!was || was.gid !== g.gid)) R.gnew = 1; SpaceRoom.paintTabs(); }
  },
  onMe(d) { const R = SpaceRoom.R; if (!R || !R.game || R.game.gid !== d.gid) return; R.gme = d.me; if (R.tab === "games") SpGames.repaint(); },
  onFrame(d) {
    const R = SpaceRoom.R; if (!R || !R.game || R.game.gid !== d.gid) return;
    const f = d.f;
    if (!R.frames || R.frames.c !== f.c) R.frames = { c: f.c, owner: R.game.owner || 0, e: [] };
    R.frames.e[f.j] = f.e;
    if (R.tab === "games") SpGames.repaint();
  },
  repaint() {
    clearTimeout(SpGames._rt);
    SpGames._rt = setTimeout(() => { const R = SpaceRoom.R; if (R && R.tab === "games") SpGames.paint($("spr-pane")); }, 40);
  },
  forceRepaint() { SpGames.last.key = ""; SpGames.repaint(); },

  // ───────────── экран вкладки «Игры» ─────────────
  menuHTML() {
    const can = SpaceRoom.can("games");
    return `<div class="spgm"><div class="spgm-menu">${Object.keys(SpGames.info).map((k) => { const I = SpGames.info[k]; return `<button class="spgm-card" data-g="start" data-k="${k}" type="button" ${can ? "" : "disabled"}><span class="spgm-ic" style="background:${I.g}">${I.ic}</span><span class="spgm-ct"><b>${esc(T(I.n))}</b><small>${esc(T(I.d))}</small><em>${esc(T("Игроков: {0}", I.pl))}</em></span></button>`; }).join("")}</div>${can ? "" : `<div class="spr-note">${esc(T("Запускать игры здесь могут {0}.", T(spOptName((SpaceRoom.R.info.perms || {}).games || "member")).toLowerCase()))}</div>`}</div>`;
  },
  av(uid, cls) { return avatar(SpGames.prof(uid), cls || "sm"); },
  lobbyHTML(G) {
    const me = App.user.id, inG = G.players.includes(me), I = SpGames.info[G.type], mod = G.host === me || SpaceRoom.can("kick");
    const full = G.players.length >= G.max, ok = G.players.length >= G.min;
    const pl = G.players.map((u) => `<span class="spgm-pp" data-u="${u}">${SpGames.av(u, "md")}${u === G.host ? `<i>${SPI.crown}</i>` : ""}<b>${esc(SpGames.nm(u))}</b></span>`).join("");
    const rules = SpGames.T[G.type] && SpGames.T[G.type].rules ? SpGames.T[G.type].rules : "";
    return `<div class="spgm spgm-lobby"><div class="spgm-hero" style="background:${I.g}"><span>${I.ic}</span><div><b>${esc(T(I.n))}</b><small>${esc(T("Игроков: {0}", I.pl))} · ${esc(T("Лобби"))}</small></div></div>
      ${rules ? `<div class="spgm-rules">${rules}</div>` : ""}
      <div class="spgm-sec">${esc(T("В лобби"))} · ${G.players.length}/${G.max}</div><div class="spgm-pls">${pl}</div>
      <div class="spgm-hint">${ok ? esc(mod ? T("Можно начинать. Остальные смогут присоединиться, пока вы не нажмёте «Начать».") : T("Ждём, пока ведущий начнёт игру.")) : esc(T("Нужно ещё игроков: {0}", G.min - G.players.length))}</div>
      <div class="spgm-acts">${inG ? `<button class="spgm-btn ghost" data-g="leave" type="button">${esc(T("Выйти"))}</button>` : `<button class="spgm-btn" data-g="join" type="button" ${full ? "disabled" : ""}>${esc(full ? T("Мест нет") : T("Присоединиться"))}</button>`}${mod ? `<button class="spgm-btn go" data-g="begin" type="button" ${ok ? "" : "disabled"}>${esc(T("Начать"))}</button>` : ""}${mod ? `<button class="spgm-btn ghost" data-g="end" type="button">${esc(T("Закрыть"))}</button>` : ""}</div></div>`;
  },
  // общие кнопки внизу активной/законченной игры
  tail(G) {
    const me = App.user.id, mod = G.host === me || SpaceRoom.can("kick"), inG = G.players.includes(me);
    if (G.phase === "over") return `<div class="spgm-acts">${inG || mod ? `<button class="spgm-btn go" data-g="again" type="button">${esc(T("Играть снова"))}</button>` : ""}${mod ? `<button class="spgm-btn ghost" data-g="end" type="button">${esc(T("Закрыть игру"))}</button>` : ""}</div>`;
    return `${!inG ? `<div class="spgm-wait"><i>⏳</i><div><b>${esc(T("Игра уже идёт — подождите"))}</b><small>${esc(T("Пока она не закончится, присоединиться нельзя. Можно наблюдать, а после игры — войти в следующую."))}</small></div></div>` : ""}${mod ? `<div class="spgm-acts"><button class="spgm-btn ghost sm" data-g="end" type="button">${esc(T("Остановить игру"))}</button></div>` : ""}`;
  },
  paint(box) {
    const R = SpaceRoom.R; box = box || $("spr-pane"); if (!R || !box || R.tab !== "games") return;
    const G = R.game;
    if (!G) { SpGames.last.key = "menu"; box.innerHTML = SpGames.menuHTML(); return; }
    if (G.phase === "lobby") { if (SpGames.last.fresh !== G.gid + ":lobby") { SpGames.last.fresh = G.gid + ":lobby"; setTimeout(() => SpaceRoom.focusTabs(), 60); } SpGames.last.key = "lobby:" + G.gid + ":" + G.players.join(","); box.innerHTML = SpGames.lobbyHTML(G); return; }
    const T_ = SpGames.T[G.type]; if (!T_) { box.innerHTML = ""; return; }
    const r = T_.render(G, R.gme || {}, SpGames.gs());
    const key = G.gid + ":" + G.type + ":" + r.key;
    if (SpGames.last.key === key && box.querySelector("#spgm-dyn")) { box.querySelector("#spgm-dyn").innerHTML = r.dyn; if (T_.after) T_.after(box, G, R.gme || {}); return; }
    SpGames.last.key = key;
    box.innerHTML = `<div class="spgm spgm-${G.type}"><div class="spgm-top">${r.top || ""}</div><div id="spgm-dyn">${r.dyn}</div><div class="spgm-foot">${r.foot || ""}</div>${SpGames.tail(G)}</div>`;
    if (T_.mount) T_.mount(box, G, R.gme || {});
    SpGames.tick();
    if (SpGames.last.fresh !== G.gid + ":" + G.phase) { SpGames.last.fresh = G.gid + ":" + G.phase; setTimeout(() => SpaceRoom.focusTabs(), 60); }
  },
  tick() {
    const R = SpaceRoom.R; if (!R || R.tab !== "games") return;
    const box = $("spr-pane"); if (!box) return;
    box.querySelectorAll("[data-dl]").forEach((el) => { const s = SpGames.left(+el.dataset.dl); const t = s > 59 ? Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") : String(s); if (el.textContent !== t) el.textContent = t; el.classList.toggle("hot", s <= 5); });
    box.querySelectorAll("[data-dlbar]").forEach((el) => { const [a, b] = el.dataset.dlbar.split(":").map(Number); el.style.width = Math.max(0, Math.min(100, ((b - Space.now()) / Math.max(1, b - a)) * 100)) + "%"; });
    const G = R.game, T_ = G && SpGames.T[G.type]; if (T_ && T_.tick) T_.tick(box, G, R.gme || {});
  },

  // ───────────── клики ─────────────
  async click(e) {
    const R = SpaceRoom.R; if (!R) return;
    const b = e.target.closest("[data-g]");
    if (b) {
      if (b.disabled) return;
      haptic();
      const k = b.dataset.g;
      if (k === "start") { const d = await SpGames.act("start", { game: b.dataset.k }); if (d) { R.tab !== "games" || SpGames.forceRepaint(); } return; }
      if (["join", "leave", "begin", "again"].includes(k)) return SpGames.act(k);
      if (k === "end") {
        const v = await UI.sheet({ title: T("Закрыть игру?"), text: T("Игра закроется для всех игроков."), actions: [{ label: T("Закрыть игру"), value: 1, danger: true }], cancel: T("Отмена") });
        if (v) SpGames.act("end");
        return;
      }
    }
    const pp = e.target.closest(".spgm-pp[data-u]"); if (pp) { haptic(); return SpaceExtra.memberMenu(+pp.dataset.u); }
    const G = R.game, T_ = G && SpGames.T[G.type];
    if (T_ && T_.click) return T_.click(e, G, R.gme || {});
  },
};

// ───────────────────────── УГАДАЙ ФИЛЬМ ПО ЭМОДЗИ ─────────────────────────
SpGames.T.emoji = {
  rules: `<b>${"🎬"}</b> ${"10 фильмов, у каждого 35 секунд. Чем быстрее ответ — тем больше очков. Через 11 секунд подскажем длину слов, через 22 — первые буквы."}`,
  render(G, me, gs) {
    const uid = App.user.id, playing = G.scores && uid in G.scores;
    if (G.phase === "over") {
      const rank = G.rank || [], medal = ["🥇", "🥈", "🥉"];
      return { key: "over", top: `<div class="spgm-hero" style="background:${SpGames.info.emoji.g}"><span>🏆</span><div><b>${esc(T("Игра окончена"))}</b><small>${esc(rank[0] ? T("Победил(а) {0}", SpGames.nm(rank[0][0])) : "")}</small></div></div>`,
        dyn: `<div class="spgm-lb">${rank.map(([u, s], i) => `<div class="${u === uid ? "me" : ""}"><i>${medal[i] || i + 1}</i>${SpGames.av(u, "sm")}<b>${esc(SpGames.nm(u))}</b><em>${s}</em></div>`).join("")}</div>`, foot: "" };
    }
    const solved = !!me.solved, q = G.phase === "q";
    const top = `<div class="spgm-em-h"><span>${esc(T("Фильм {0} из {1}", G.i + 1, G.n))}</span><b class="spgm-tm" data-dl="${G.dl}">${SpGames.left(G.dl)}</b></div>
      <div class="spgm-tbar"><i data-dlbar="${G.t0 || G.t}:${G.dl}"></i></div><div class="spgm-em-big">${esc(G.e || "")}</div>`;
    const sc = Object.entries(G.scores || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const dyn = `<div class="spgm-em-mask">${G.phase === "reveal" ? `<b>${esc(G.title || "")}</b>` : esc(G.mask || "").split("").join(" ")}</div>
      ${G.phase === "reveal" ? `<div class="spgm-em-got">${(G.solved || []).length ? G.solved.map((u) => `<span>${SpGames.av(u, "sm")}<b>+${(G.got || {})[u] || 0}</b></span>`).join("") : `<small>${esc(T("Никто не угадал"))}</small>`}</div>`
        : `<div class="spgm-em-got">${(G.solved || []).map((u) => `<span>${SpGames.av(u, "sm")}<i>✓</i></span>`).join("")}${(G.solved || []).length ? "" : `<small>${esc(T("Пока никто не угадал"))}</small>`}</div>`}
      <div class="spgm-lb mini">${sc.map(([u, s], i) => `<div class="${+u === uid ? "me" : ""}"><i>${i + 1}</i>${SpGames.av(+u, "sm")}<b>${esc(SpGames.nm(+u))}</b><em>${s}</em></div>`).join("")}</div>`;
    const foot = !playing ? `<div class="spgm-hint">${esc(T("Вы наблюдаете за игрой"))}</div>` : solved ? `<div class="spgm-ok">✅ ${esc(T("Угадано!"))} +${me.pts || 0}</div>` : q ? `<form class="spgm-em-f" id="spgm-em-f"><input id="spgm-em-in" maxlength="80" placeholder="${esc(T("Название фильма…"))}" autocomplete="off" autocapitalize="off" enterkeyhint="send"><button type="submit" aria-label="${esc(T("Ответить"))}">${SPI.send}</button></form>` : `<div class="spgm-hint">${esc(T("Следующий фильм — через несколько секунд"))}</div>`;
    return { key: `${G.phase}:${G.i}:${solved ? 1 : 0}:${playing ? 1 : 0}`, top, dyn, foot };
  },
  mount(box) {
    const f = box.querySelector("#spgm-em-f"); if (!f) return;
    const inp = f.querySelector("input");
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const text = inp.value.trim(); if (!text) return;
      inp.value = "";
      const d = await SpGames.act("ans", { text });
      if (!d) return;
      if (d.hit) { haptic("medium"); toast(T("Верно! +{0}", d.pts || 0)); }
      else { haptic(); f.classList.remove("shake"); void f.offsetWidth; f.classList.add("shake"); inp.focus(); }
    });
    inp.addEventListener("pointerdown", () => inp.focus());
  },
  tick() {},
};
