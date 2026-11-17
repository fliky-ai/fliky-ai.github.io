// space_room.js — экран комнаты DICEGRAM SPACE: общий плеер, присутствующие, чат комнаты, очередь, нижняя панель с голосом.
// Все слушают одно и то же в одно и то же время: сервер хранит «позицию в момент времени», а клиенты считают её по часам сервера.
// Голос (SpVoice), игры (SpGames), страницы «О пространстве», «Участники», «Добавить трек» — в space_extra.js.
const SpaceRoom = {
  R: null, el: null,
  EMOJI: ["❤️", "🔥", "😂", "👏", "🎉", "😮", "🎵", "👍"],

  // ───────────── вход ─────────────
  el_() {
    let el = $("space");
    if (el) return el;
    el = document.createElement("section");
    el.id = "space"; el.className = "page sp-room"; el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<div class="spr-bg"></div>
      <header class="spr-head">
        <button class="spr-ib" data-a="back" aria-label="${esc(T("Назад"))}">${SPI.back}</button>
        <button class="spr-hi" data-a="info"><span class="spr-av"></span><span class="spr-ti"><b class="spr-nm"></b><small class="spr-sub"></small></span></button>
        <button class="spr-ib" data-a="more" aria-label="${esc(T("Ещё"))}">${SPI.more}</button>
      </header>
      <div class="spr-body" id="spr-body">
        <div class="spr-card spr-player" id="spr-player"><div class="spr-vstage" id="spr-vstage"></div><div id="spr-pdyn"></div></div>
        <div class="spr-people" id="spr-people"></div>
        <div class="spr-tabs" id="spr-tabs"></div>
        <div class="spr-pane" id="spr-pane"></div>
      </div>
      <div class="spr-dock" id="spr-dock"></div>
      <div class="spr-fly" id="spr-fly" aria-hidden="true"></div>`;
    document.body.appendChild(el);
    el.addEventListener("click", (e) => SpaceRoom.click(e));
    return el;
  },

  async open(id, opts) {
    if (SpaceRoom.R) { if (SpaceRoom.R.id === id) return; SpaceRoom.teardown(); }
    if (!App.user) return;
    let info = Space.get(id);
    try { const d = await api("/api/spaces/" + id); info = Object.assign(info || {}, d.space); Space.upsert(info); }
    catch (e) { if (e.status === 403 || e.status === 404) Space.remove(id); return toast(e.status === 403 ? T("Нет доступа к пространству") : e.message); }
    const el = SpaceRoom.el_();
    const R = (SpaceRoom.R = { id, info, role: info.role || "member", users: {}, player: null, tracks: [], tmap: {}, game: null, chat: [], cusers: {}, tab: "chat", unread: 0, gnew: 0,
      pl: { M: null, tid: 0, n: 0, blocked: false, endSent: "", vwrap: null }, vol: 1, muted: false, timers: [], ws: null, joined: false, opts: opts || {}, sys: [] });
    try { R.vol = parseFloat(localStorage.getItem("sp_vol") || "1"); if (!(R.vol >= 0 && R.vol <= 1)) R.vol = 1; R.muted = localStorage.getItem("sp_muted") === "1"; } catch (e) {}
    const vs = $("spr-vstage"); vs.innerHTML = ""; vs.className = "spr-vstage";
    R.pl.vwrap = document.createElement("div"); R.pl.vwrap.className = "spr-vwrap"; vs.appendChild(R.pl.vwrap);
    el.classList.remove("karaoke");
    SpaceRoom.paintHead(); SpaceRoom.paintPlayer(); SpaceRoom.paintPeople(); SpaceRoom.paintTabs(); SpaceRoom.paintPane(); SpaceRoom.paintDock();
    Nav.open("space", () => SpaceRoom.teardown());
    SpaceRoom.join();
    R.timers.push(setInterval(() => SpaceRoom.tick(), 250));
    R.timers.push(setInterval(() => SpaceRoom.watch(), 4000));
    SpaceRoom.loadTracks(); SpaceRoom.loadChat();
    if (R.opts.created) setTimeout(() => SpaceExtra.welcome(), 450);
  },
  join() {
    const R = SpaceRoom.R; if (!R) return;
    if (!App.ws || App.ws.readyState !== 1) { toast(T("Нет связи с сервером")); return; }
    R.ws = App.ws; Space.syncClock();
    Calls.send({ type: "sp", op: "join", space: R.id });
  },
  // сокет переподключился — заходим в комнату заново (сервер убрал нас из неё при обрыве)
  watch() {
    const R = SpaceRoom.R; if (!R) return;
    if (App.ws && App.ws.readyState === 1 && R.ws !== App.ws) {
      if (typeof SpVoice !== "undefined" && SpVoice.on) { SpVoice.leave(true); toast(T("Связь пропала — голос отключён. Включите его снова.")); }
      SpaceRoom.join();
    }
  },
  teardown() {
    const R = SpaceRoom.R; if (!R) return;
    SpaceRoom.R = null;
    R.timers.forEach(clearInterval); clearInterval(R.gt);
    try { Calls.send({ type: "sp", op: "leave", space: R.id }); } catch (e) {}
    try { SpVoice.leave(true, R); } catch (e) {}
    SpaceRoom.stopMedia(R);
    { const vs = $("spr-vstage"); if (vs) { vs.innerHTML = ""; vs.className = "spr-vstage"; } }
    try { Calls.keepAwake(false); } catch (e) {}
    const el = $("space"); if (el) { el.classList.remove("karaoke", "hello"); }
    const fly = $("spr-fly"); if (fly) fly.innerHTML = "";
    try { Chats.render(); } catch (e) {}
  },
  // комнату закрыли снаружи (удалили, выгнали)
  async closeFor(msg) {
    if (!SpaceRoom.R) return;
    toast(msg);
    for (let g = 0; g < 8 && Nav.stack.some((x) => x.id === "space"); g++) {          // закрываем и комнату, и всё, что открыто поверх неё
      const n = Nav.stack.length; Nav.back();
      for (let t = 0; t < 40 && Nav.stack.length === n; t++) await new Promise((r) => setTimeout(r, 20));
    }
  },

  // ───────────── права ─────────────
  lv(role) { return SP_LEVEL[role] != null ? SP_LEVEL[role] : -1; },
  can(key) {
    const R = SpaceRoom.R; if (!R) return false;
    const lv = SpaceRoom.lv(R.role);
    if (key in SP_PERM_NAMES) {
      if ((key === "chat" || key === "voice") && R.info.muted && lv < 2) return false;
      return lv >= SpaceRoom.lv((R.info.perms || {})[key] || "member");
    }
    return lv >= ({ edit: 2, delete: 3, roles: 2, ban: 2, kick: 1, mute: 1, delmsg: 1, admins: 3 }[key] || 3);
  },
  roleName(r) { return T(SP_ROLE[r] || SP_ROLE.member); },

  // ───────────── данные ─────────────
  async loadTracks() {
    const R = SpaceRoom.R; if (!R) return;
    try {
      const d = await api("/api/spaces/" + R.id + "/tracks");
      if (SpaceRoom.R !== R) return;
      R.tracks = d.tracks || []; R.tmap = {}; R.tracks.forEach((t) => { R.tmap[t.id] = t; });
      if (R.tab === "queue") SpaceRoom.paintPane();
      SpaceRoom.sync();
    } catch (e) {}
  },
  async loadChat() {
    const R = SpaceRoom.R; if (!R) return;
    try {
      const d = await api("/api/spaces/" + R.id + "/chat");
      if (SpaceRoom.R !== R) return;
      R.chat = d.msgs || []; Object.assign(R.cusers, d.users || {});
      if (R.tab === "chat") SpaceRoom.paintPane();
    } catch (e) {}
  },
  uname(uid) {
    const R = SpaceRoom.R; if (!R) return "";
    const u = (R.users[uid] && R.users[uid].profile) || R.cusers[uid] || (uid === App.user.id ? App.user : null);
    return u ? dispName(u) : T("Участник");
  },
  uprof(uid) {
    const R = SpaceRoom.R; if (!R) return { id: uid, name: "" };
    return (R.users[uid] && R.users[uid].profile) || R.cusers[uid] || (uid === App.user.id ? App.user : { id: uid, name: "" });
  },

  // ───────────── WS ─────────────
  onWS(d) {
    const R = SpaceRoom.R; if (!R || d.space !== R.id) return;
    switch (d.op) {
      case "state": {
        R.joined = true; R.info = Object.assign(R.info, d.info); R.role = d.info.role || R.role;
        R.users = {};
        const us = (d.room && d.room.users) || {};
        Object.keys(us).forEach((k) => { R.users[+k] = Object.assign({ profile: (d.room.profiles || {})[k] || { id: +k, name: "" }, role: (d.room.roles || {})[k] || "member" }, us[k]); });
        R.player = d.player; R.game = d.game;
        if (d.t) { const skew = d.t - Date.now() / 1000; if (Space.rtt > 1e8) Space.skew = skew; }
        SpaceRoom.paintHead(); SpaceRoom.paintPeople(); SpaceRoom.paintPlayer(); SpaceRoom.paintDock(); SpaceRoom.paintTabs();
        if (R.tab === "games" || R.tab === "queue") SpaceRoom.paintPane();
        SpaceRoom.sync();
        break;
      }
      case "info": R.info = Object.assign(R.info, d.info); R.role = d.info.role || R.role; Space.upsert(R.info); SpaceRoom.paintHead(); SpaceRoom.paintPlayer(); SpaceRoom.paintDock(); if (R.tab !== "chat") SpaceRoom.paintPane(); break;
      case "role": R.role = d.role; R.info.role = d.role; SpaceRoom.paintPlayer(); SpaceRoom.paintDock(); SpaceRoom.paintPeople(); if (R.tab !== "chat") SpaceRoom.paintPane(); toast(T("Ваша роль: {0}", SpaceRoom.roleName(d.role))); break;
      case "muted": R.info.muted = d.on; if (d.on) { try { SpVoice.setMic(false, true); } catch (e) {} } toast(d.on ? T("Модератор отключил вам микрофон и чат") : T("Вам снова можно говорить и писать")); SpaceRoom.paintDock(); break;
      case "joined": R.users[d.user.id] = { profile: d.user, role: d.role, voice: false, mic: false, speak: false }; SpaceRoom.sysLine(T("{0} вошёл(а)", dispName(d.user))); SpaceRoom.paintPeople(); break;
      case "left": {
        const u = R.users[d.user]; delete R.users[d.user];
        try { SpVoice.drop(d.user); } catch (e) {}
        if (u) SpaceRoom.sysLine(T("{0} вышел(ла)", dispName(u.profile)));
        SpaceRoom.paintPeople(); break;
      }
      case "gone": delete R.users[d.user]; try { SpVoice.drop(d.user); } catch (e) {} SpaceRoom.paintPeople(); break;
      case "member": {
        const u = R.users[d.user.id]; if (u) { u.role = d.role; u.profile = d.user; }
        if (d.user.id === App.user.id) { R.role = d.role; if ("muted" in d) R.info.muted = d.muted; }
        SpaceRoom.paintPeople(); break;
      }
      case "player": R.player = d.player; SpaceRoom.paintPlayer(); SpaceRoom.sync(); break;
      case "track_add": SpaceRoom.loadTracks(); break;
      case "chat": SpaceRoom.addMsg(d.msg, d.user); break;
      case "chat_del": R.chat = R.chat.filter((m) => m.id !== d.id); { const n = document.querySelector(`.spm[data-id="${d.id}"]`); if (n) n.remove(); } break;
      case "game": {
        const was = R.game; R.game = d.game;
        if (R.tab === "games") SpaceExtra.paintGames(); else if (d.game && (!was || was.type !== d.game.type)) { R.gnew = 1; SpaceRoom.paintTabs(); }
        break;
      }
      case "ask": SpaceRoom.askCard(d); break;
      case "mic": { const u = R.users[d.user]; if (u) { u.mic = !!d.on; if (!d.on) u.speak = false; SpaceRoom.paintPeople(); } break; }
      case "speak": { const u = R.users[d.user]; if (u) { u.speak = !!d.on; SpaceRoom.paintSpeak(d.user); } break; }
      case "voice": { const u = R.users[d.user]; if (u) { u.voice = !!d.on; if (!d.on) { u.mic = false; u.speak = false; } SpaceRoom.paintPeople(); } try { d.on ? SpVoice.onJoined(d.user) : SpVoice.drop(d.user); } catch (e) {} break; }
      case "voice_state": SpVoice.onState(d); break;
      case "voice_full": toast(T("В голосовом чате нет свободных мест — вы можете слушать музыку и писать в чат")); SpVoice.leave(true); break;
      case "sig": try { SpVoice.onSig(d); } catch (e) {} break;
      case "mic_denied": SpVoice.onDenied(d); break;
      case "react": SpaceRoom.fly(d.e); break;
      case "denied": SpaceRoom.closeFor(T("Нет доступа к пространству")); break;
    }
  },
  sysLine(t) {
    const R = SpaceRoom.R; if (!R) return;
    const m = { id: "s" + Date.now() + Math.random(), kind: "loc", text: t, ts: Math.floor(Date.now() / 1000) };
    R.chat.push(m); if (R.chat.length > 200) R.chat.shift();
    if (R.tab === "chat") SpaceRoom.appendMsgNode(m);
  },

  // ───────────── шапка ─────────────
  paintHead() {
    const R = SpaceRoom.R, el = $("space"); if (!R || !el) return;
    el.querySelector(".spr-av").innerHTML = spAvatar(R.info, "sm");
    el.querySelector(".spr-nm").textContent = R.info.title;
    const live = Object.keys(R.users).length || R.info.live || 0;
    el.querySelector(".spr-sub").innerHTML = (live ? `<i class="sp-dot"></i>${esc(T("{0} в эфире", live))} · ` : "") + esc(T("{0} участн.", R.info.n));
  },

  // ───────────── плеер ─────────────
  curTrack() { const R = SpaceRoom.R; return R && R.player && R.player.trk ? R.player.trk : null; },
  expected() {
    const R = SpaceRoom.R, p = R && R.player; if (!p || !p.trk) return 0;
    let t = p.play ? p.pos + (Space.now() - p.t) : p.pos;
    const dur = p.trk.dur || (R.pl.M && R.pl.M.dur()) || 0;
    if (dur > 0 && isFinite(dur)) t = Math.min(t, dur);
    return Math.max(0, t);
  },
  parseLrc(txt) {
    const out = []; let any = false;
    String(txt || "").split(/\r?\n/).forEach((ln) => {
      const re = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g; let m, last = 0; const ts = [];
      while ((m = re.exec(ln))) { ts.push(+m[1] * 60 + parseFloat(m[2].replace(":", "."))); last = re.lastIndex; }
      const text = ln.slice(last).replace(/<\d+:\d+(?:[.:]\d+)?>/g, "").trim();
      if (ts.length) { any = true; ts.forEach((t) => out.push({ t, s: text })); }
      else if (/^\[[a-z]+:/i.test(ln.trim())) return;                              // [ar:..] [ti:..] — метаданные
      else if (ln.trim()) out.push({ t: -1, s: ln.trim() });
    });
    if (any) return { sync: true, lines: out.filter((x) => x.t >= 0 && x.s !== "").sort((a, b) => a.t - b.t) };
    return { sync: false, lines: out };
  },
  trkIcon(t) { return t.kind === "video" || t.kind === "yt" ? SPI.video : SPI.music; },
  paintPlayer() {
    const R = SpaceRoom.R, box = $("spr-pdyn"); if (!R || !box) return;
    const p = R.player, t = p && p.trk, ctl = SpaceRoom.can("control");
    const kara = !!(p && p.mode === "karaoke" && t), vid = !!(t && (t.kind === "video" || t.kind === "yt"));
    $("space").classList.toggle("karaoke", kara);
    // окно видео живёт отдельно от перерисовки карточки: иначе браузер ставит видео на паузу, а YouTube перезагружается
    $("spr-vstage").className = "spr-vstage" + (vid ? (kara ? " vhid" : " show") : "");
    if (!t) {
      box.innerHTML = `<div class="spr-stage idle"><div class="spr-cover" style="background:${spGrad(R.id)}"><span>${SPI.music}</span></div></div>
        <div class="spr-meta"><b>${esc(T("Тишина"))}</b><small>${esc(T(SpaceRoom.can("tracks") ? "Добавьте музыку или видео — все в комнате услышат её одновременно." : "Пока ничего не играет."))}</small></div>
        ${SpaceRoom.can("tracks") ? `<div class="spr-ctl"><button class="spr-add" data-a="addtrack">${SPI.plus}<span>${esc(T("Добавить трек"))}</span></button></div>` : ""}`;
      return;
    }
    const lr = kara ? SpaceRoom.parseLrc(t.lrc) : null;
    R.pl.lrc = lr; R.pl.lrcA = -2;
    let stage = "";
    if (kara) stage = `<div class="spr-stage kara${lr && lr.sync ? " sync" : ""}"><div class="spr-lrc" id="spr-lrc">${lr && lr.lines.length ? lr.lines.map((l, i) => `<p data-i="${i}">${esc(l.s)}</p>`).join("") : `<p class="empty">${esc(T("Для этого трека нет текста песни. Его можно указать при добавлении трека."))}</p>`}</div></div>`;
    else if (!vid) stage = `<div class="spr-stage"><div class="spr-cover${p.play ? " on" : ""}" style="background:${spGrad(t.id + R.id)}"><span>${SPI.music}</span><i class="spr-bars"><u></u><u></u><u></u><u></u><u></u></i></div></div>`;
    const dur = t.dur || (R.pl.M && R.pl.M.dur()) || 0;
    box.innerHTML = `${stage}<div class="spr-blk" id="spr-blk" hidden><button data-a="unblock">${SPI.play}<span>${esc(T("Нажмите, чтобы слушать вместе"))}</span></button></div>
      <div class="spr-meta"><b>${esc(t.title)}</b><small>${esc(t.artist || (vid ? T("Видео") : T("Трек")))}</small></div>
      <div class="spr-seek"><span id="spr-cur">0:00</span><input type="range" id="spr-seekbar" min="0" max="${dur > 0 ? dur : 1}" step="0.1" value="0" ${ctl && dur > 0 ? "" : "disabled"} aria-label="${esc(T("Перемотка"))}"><span id="spr-dur">${dur > 0 ? Calls.fmt(dur) : "–:––"}</span></div>
      <div class="spr-ctl">
        <button class="spr-cb${p.rep ? " on" : ""}" data-a="rep" ${ctl ? "" : "disabled"} aria-label="${esc(T("Повтор"))}">${p.rep === 2 ? SPI.repeat1 : SPI.repeat}</button>
        <button class="spr-cb" data-a="prev" ${ctl ? "" : "disabled"} aria-label="${esc(T("Назад"))}">${SPI.prev}</button>
        <button class="spr-play" data-a="toggle" ${ctl ? "" : "disabled"} aria-label="${esc(T(p.play ? "Пауза" : "Играть"))}">${p.play ? SPI.pause : SPI.play}</button>
        <button class="spr-cb" data-a="next" ${ctl ? "" : "disabled"} aria-label="${esc(T("Дальше"))}">${SPI.next}</button>
        <button class="spr-cb${kara ? " on" : ""}" data-a="kara" ${ctl ? "" : "disabled"} aria-label="${esc(T("Караоке"))}">${SPI.karaoke}</button>
      </div>
      ${ctl ? "" : `<div class="spr-note">${esc(T("Плеером управляют: {0}. Выберите трек во вкладке «Очередь» — мы передадим просьбу.", T(spOptName((R.info.perms || {}).control || "mod")).toLowerCase()))}</div>`}`;
    SpaceRoom.tick(true);
  },
  tick(force) {
    const R = SpaceRoom.R; if (!R) return;
    R.n = (R.n || 0) + 1;
    if (R.player && R.player.trk) {
      const t = R.player.trk, cur = SpaceRoom.expected();
      const sb = $("spr-seekbar");
      if (sb && !R.seeking) { sb.value = cur; }
      const c = $("spr-cur"); if (c) c.textContent = Calls.fmt(cur);
      const dur = t.dur || (R.pl.M && R.pl.M.dur()) || 0;
      if (sb && dur > 0 && +sb.max !== dur && !R.seeking) { sb.max = dur; const d = $("spr-dur"); if (d) d.textContent = Calls.fmt(dur); if (SpaceRoom.can("control")) sb.disabled = false; }
      if (R.pl.lrc && R.pl.lrc.sync) SpaceRoom.paintLrc(cur);
      if (R.player.play && (force === true || R.n % 4 === 0)) SpaceRoom.sync();
      if (R.player.play && dur > 1 && cur >= dur - 0.15) SpaceRoom.onEnded();
      const blk = $("spr-blk"); if (blk) blk.hidden = !R.pl.blocked;
    }
    if (typeof SpaceExtra !== "undefined" && SpaceExtra.tickGame) SpaceExtra.tickGame();
  },
  paintLrc(cur) {
    const lr = SpaceRoom.R.pl.lrc, box = $("spr-lrc"); if (!lr || !box) return;
    let a = -1; for (let i = 0; i < lr.lines.length; i++) { if (lr.lines[i].t <= cur + 0.15) a = i; else break; }
    if (a === SpaceRoom.R.pl.lrcA && !box.dataset.fresh) return;
    SpaceRoom.R.pl.lrcA = a; delete box.dataset.fresh;
    const ps = box.children;
    for (let i = 0; i < ps.length; i++) { ps[i].className = i === a ? "on" : i < a ? "past" : ""; }
    const el = ps[Math.max(0, a)]; if (el) box.style.transform = `translateY(${Math.round(box.parentNode.clientHeight / 2 - el.offsetTop - el.offsetHeight / 2)}px)`;
  },

  // ───────────── воспроизведение ─────────────
  stopMedia(R) {
    R = R || SpaceRoom.R; if (!R) return;
    const pl = R.pl;
    if (pl.M) { try { pl.M.destroy(); } catch (e) {} }
    pl.M = null; pl.tid = 0; pl.n++;
    if (pl.vwrap) pl.vwrap.innerHTML = "";
  },
  srcOf(t) {
    const R = SpaceRoom.R, x = R && R.tmap[t.id]; if (!x || !x.src) return "";
    return /^\//.test(x.src) ? fileUrl(x.src) : x.src;
  },
  async load(t) {
    const R = SpaceRoom.R, pl = R.pl; const n = ++pl.n;
    if (pl.M) { try { pl.M.destroy(); } catch (e) {} pl.M = null; }
    if (pl.vwrap) pl.vwrap.innerHTML = "";
    pl.tid = t.id; pl.blocked = false; pl.endSent = "";
    if (t.kind === "yt") {
      const M = await SpaceRoom.ytM(t, n); if (SpaceRoom.R !== R || pl.n !== n) { if (M) M.destroy(); return; }
      pl.M = M; return;
    }
    if (!R.tmap[t.id]) await SpaceRoom.loadTracks();
    if (SpaceRoom.R !== R || pl.n !== n) return;
    const src = SpaceRoom.srcOf(t);
    if (!src) return;
    const vid = t.kind === "video";
    const el = document.createElement(vid ? "video" : "audio");
    el.preload = "auto"; el.setAttribute("playsinline", ""); el.setAttribute("referrerpolicy", "no-referrer");
    if (vid) { el.setAttribute("webkit-playsinline", ""); el.controls = false; pl.vwrap.appendChild(el); if (!SpaceRoom.can("control")) el.style.pointerEvents = "none"; }
    const M = { ready: false, kind: "el", el,
      cur: () => el.currentTime || 0, dur: () => (isFinite(el.duration) ? el.duration : 0), paused: () => el.paused,
      play: () => { const p = el.play(); if (p && p.then) p.then(() => { pl.blocked = false; }).catch((e) => { if (e && e.name === "NotAllowedError") pl.blocked = true; }); },
      pause: () => el.pause(), seek: (x) => { try { el.currentTime = x; } catch (e) {} },
      vol: () => { el.volume = R.vol; el.muted = !!R.muted; },
      destroy: () => { try { el.pause(); el.removeAttribute("src"); el.load(); } catch (e) {} el.remove(); } };
    el.addEventListener("loadedmetadata", () => { M.ready = true; M.vol(); SpaceRoom.sync(); SpaceRoom.paintPlayerDur(); });
    el.addEventListener("canplay", () => { M.ready = true; });
    el.addEventListener("ended", () => SpaceRoom.onEnded());
    el.addEventListener("error", () => { if (SpaceRoom.R === R && pl.tid === t.id) { if (!pl.errT || Date.now() - pl.errT > 8000) { pl.errT = Date.now(); toast(T("Не удалось загрузить «{0}»", t.title)); SpaceRoom.loadTracks(); } } });
    el.src = src;
    pl.M = M;
  },
  paintPlayerDur() { const R = SpaceRoom.R; if (!R || !R.pl.M) return; SpaceRoom.tick(); },
  // YouTube: IFrame API; управляется так же, как обычный плеер
  ytApi() {
    if (window.YT && YT.Player) return Promise.resolve();
    if (SpaceRoom._ytp) return SpaceRoom._ytp;
    return (SpaceRoom._ytp = new Promise((res, rej) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { try { if (prev) prev(); } catch (e) {} res(); };
      const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; s.async = true;
      s.onerror = () => { SpaceRoom._ytp = null; rej(new Error("yt")); };
      document.head.appendChild(s);
      setTimeout(() => { if (!(window.YT && YT.Player)) { SpaceRoom._ytp = null; rej(new Error("yt")); } }, 12000);
    }));
  },
  async ytM(t, n) {
    const R = SpaceRoom.R, pl = R.pl;
    try { await SpaceRoom.ytApi(); } catch (e) { toast(T("YouTube недоступен")); return null; }
    if (SpaceRoom.R !== R || pl.n !== n) return null;
    const host = document.createElement("div"); pl.vwrap.appendChild(host);
    let state = -1, yt = null;
    const M = { ready: false, kind: "yt",
      cur: () => { try { return yt.getCurrentTime() || 0; } catch (e) { return 0; } },
      dur: () => { try { return yt.getDuration() || 0; } catch (e) { return 0; } },
      paused: () => state !== 1 && state !== 3,
      play: () => { try { yt.playVideo(); } catch (e) {} setTimeout(() => { if (SpaceRoom.R === R && pl.M === M && R.player && R.player.play && state !== 1 && state !== 3) pl.blocked = true; }, 2500); },
      pause: () => { try { yt.pauseVideo(); } catch (e) {} }, seek: (x) => { try { yt.seekTo(x, true); } catch (e) {} },
      vol: () => { try { yt.setVolume(Math.round(R.vol * 100)); R.muted ? yt.mute() : yt.unMute(); } catch (e) {} },
      destroy: () => { try { yt.destroy(); } catch (e) {} } };
    yt = new YT.Player(host, { videoId: t.yt, width: "100%", height: "100%", playerVars: { playsinline: 1, controls: 0, rel: 0, modestbranding: 1, disablekb: 1, fs: 0, iv_load_policy: 3, origin: location.origin },
      events: {
        onReady: () => { M.ready = true; M.vol(); SpaceRoom.sync(); },
        onStateChange: (e) => { state = e.data; if (e.data === 1) pl.blocked = false; if (e.data === 0) SpaceRoom.onEnded(); },
      } });
    return M;
  },
  sync() {
    const R = SpaceRoom.R; if (!R) return;
    const p = R.player, pl = R.pl;
    if (!p || !p.trk) { if (pl.M || pl.tid) SpaceRoom.stopMedia(); return; }
    if (pl.tid !== p.trk.id) { SpaceRoom.load(p.trk); return; }
    const M = pl.M; if (!M || !M.ready) return;
    const exp = SpaceRoom.expected();
    M.vol();
    if (p.play) {
      const dur = p.trk.dur || M.dur();
      if (dur > 1 && exp >= dur - 0.2) return;                      // дошло до конца — ждём следующего трека от сервера
      if (Math.abs(M.cur() - exp) > 0.7) M.seek(exp);
      if (M.paused()) M.play();
    } else {
      if (!M.paused()) M.pause();
      if (Math.abs(M.cur() - exp) > 0.3) M.seek(exp);
    }
  },
  // трек доиграл: сообщаем серверу (сервер засчитает один раз, даже если сообщат все)
  onEnded() {
    const R = SpaceRoom.R; if (!R || !R.player || !R.player.trk || !R.player.play) return;
    const key = R.player.trk.id + ":" + R.player.t;
    if (R.pl.endSent === key) return;
    R.pl.endSent = key;
    const id = R.player.trk.id;
    api("/api/spaces/" + R.id + "/player", { method: "POST", body: { op: "ended", trk: id } }).then((d) => {
      if (SpaceRoom.R === R && d.player && R.player && R.player.trk && R.player.trk.id === id && d.player.trk && d.player.trk.id === id && R.player.play) setTimeout(() => { if (SpaceRoom.R === R && R.pl.endSent === key) R.pl.endSent = ""; }, 3000);
    }).catch(() => { R.pl.endSent = ""; });
  },
  async player_(op, extra) {
    const R = SpaceRoom.R; if (!R) return;
    try {
      const d = await api("/api/spaces/" + R.id + "/player", { method: "POST", body: Object.assign({ op }, extra || {}) });
      if (d.player && SpaceRoom.R === R) { R.player = d.player; SpaceRoom.paintPlayer(); SpaceRoom.sync(); }
      return d;
    } catch (e) { toast(e.message); }
  },

  // ───────────── присутствующие ─────────────
  paintPeople() {
    const R = SpaceRoom.R, box = $("spr-people"); if (!R || !box) return;
    const ids = Object.keys(R.users).map(Number).sort((a, b) => (R.users[b].speak ? 1 : 0) - (R.users[a].speak ? 1 : 0) || SpaceRoom.lv(R.users[b].role) - SpaceRoom.lv(R.users[a].role) || a - b);
    const badge = (u) => u.role === "owner" ? `<i class="spb crown">${SPI.crown}</i>` : u.role === "admin" ? `<i class="spb adm">${SPI.shield}</i>` : u.role === "mod" ? `<i class="spb mod">${SPI.shield}</i>` : "";
    const vb = (u) => u.voice ? (u.mic ? `<i class="spv on">${SPI.mic}</i>` : `<i class="spv">${SPI.head}</i>`) : "";
    box.innerHTML = `<div class="spr-ph"><b>${SPI.users}${esc(T("В комнате"))}</b><button data-a="members">${esc(T("Все участники"))} · ${R.info.n}</button></div>
      <div class="spr-ps">${ids.map((i) => { const u = R.users[i]; return `<button class="spp${u.speak ? " speak" : ""}${u.voice ? " vc" : ""}" data-u="${i}" type="button"><span class="spp-a">${avatar(u.profile)}${badge(u)}${vb(u)}</span><small>${esc(i === App.user.id ? T("Вы") : cleanName(u.profile.name) || dispName(u.profile))}</small></button>`; }).join("") || `<span class="spr-none">${esc(T("Никого"))}</span>`}</div>`;
    SpaceRoom.paintHead();
  },
  paintSpeak(uid) {
    const b = document.querySelector(`.spp[data-u="${uid}"]`), R = SpaceRoom.R; if (b && R && R.users[uid]) b.classList.toggle("speak", !!R.users[uid].speak);
  },

  // ───────────── вкладки ─────────────
  paintTabs() {
    const R = SpaceRoom.R, box = $("spr-tabs"); if (!R || !box) return;
    const live = R.game && !(R.game.over || R.game.phase === "over");
    box.innerHTML = [["chat", SPI.chat, T("Чат"), R.unread], ["queue", SPI.list, T("Очередь"), 0], ["games", SPI.game, T("Игры"), R.gnew || (live ? 1 : 0)]]
      .map(([k, ic, n, b]) => `<button class="${R.tab === k ? "on" : ""}" data-tab="${k}" type="button">${ic}<span>${esc(n)}</span>${b ? `<i class="spt-b">${k === "chat" ? (b > 9 ? "9+" : b) : ""}</i>` : ""}</button>`).join("");
  },
  setTab(k) {
    const R = SpaceRoom.R; if (!R || R.tab === k) return;
    R.tab = k; if (k === "chat") R.unread = 0; if (k === "games") R.gnew = 0;
    SpaceRoom.paintTabs(); SpaceRoom.paintPane();
  },
  paintPane() {
    const R = SpaceRoom.R, box = $("spr-pane"); if (!R || !box) return;
    if (R.tab === "chat") return SpaceRoom.paintChat(box);
    if (R.tab === "queue") return SpaceRoom.paintQueue(box);
    return SpaceExtra.paintGames(box);
  },

  // ───────────── чат комнаты ─────────────
  msgHTML(m) {
    if (m.kind === "sys" || m.kind === "loc") return `<div class="spm sys${m.kind === "loc" ? " loc" : ""}" data-id="${esc(m.id)}"><span>${esc(m.text)}</span></div>`;
    const u = SpaceRoom.uprof(m.user), me = m.user === App.user.id;
    return `<div class="spm${me ? " me" : ""}" data-id="${m.id}" data-u="${m.user}"><span class="spm-a">${avatar(u, "sm")}</span><span class="spm-b"><b>${esc(me ? T("Вы") : dispName(u))}</b><em>${esc(fmtTime(m.ts))}</em><span class="spm-t">${esc(m.text).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" rel="noopener noreferrer">${u}</a>`)}</span></span></div>`;
  },
  paintChat(box) {
    const R = SpaceRoom.R, can = SpaceRoom.can("chat");
    box.innerHTML = `<div class="spr-msgs" id="spr-msgs">${R.chat.length ? R.chat.map((m) => SpaceRoom.msgHTML(m)).join("") : `<div class="spr-empty">${SPI.chat}<span>${esc(T("Здесь пока тихо. Напишите первым — чат виден тем, кто сейчас в комнате, и сохраняется."))}</span></div>`}</div>
      <div class="spr-comp"><input id="spr-in" maxlength="1000" placeholder="${esc(T(can ? "Сообщение в комнату" : "Писать в чат здесь нельзя"))}" autocomplete="off" enterkeyhint="send" ${can ? "" : "disabled"}><button class="spr-send" id="spr-send" type="button" aria-label="${esc(T("Отправить"))}" disabled>${SPI.send}</button></div>`;
    const m = $("spr-msgs"); m.scrollTop = m.scrollHeight;
    const inp = $("spr-in"), snd = $("spr-send");
    inp.addEventListener("input", () => { snd.disabled = !inp.value.trim(); });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); SpaceRoom.sendChat(); } });
    snd.addEventListener("pointerdown", (e) => e.preventDefault());
    snd.onclick = () => SpaceRoom.sendChat();
  },
  appendMsgNode(m) {
    const box = $("spr-msgs"); if (!box) return;
    const e = box.querySelector(".spr-empty"); if (e) e.remove();
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 90 || m.user === App.user.id;
    box.insertAdjacentHTML("beforeend", SpaceRoom.msgHTML(m));
    if (near) box.scrollTop = box.scrollHeight;
  },
  addMsg(m, user) {
    const R = SpaceRoom.R; if (!R) return;
    if (user) R.cusers[user.id] = user;
    if (R.chat.some((x) => x.id === m.id)) return;
    R.chat.push(m); if (R.chat.length > 300) R.chat.shift();
    if (R.tab === "chat") SpaceRoom.appendMsgNode(m);
    else if (m.kind !== "sys" && m.user !== App.user.id) { R.unread++; SpaceRoom.paintTabs(); }
  },
  async sendChat() {
    const R = SpaceRoom.R, inp = $("spr-in"); if (!R || !inp) return;
    const text = inp.value.trim(); if (!text) return;
    inp.value = ""; $("spr-send").disabled = true; haptic();
    try {
      const d = await api("/api/spaces/" + R.id + "/chat", { method: "POST", body: { text } });
      SpaceRoom.addMsg(d.msg);
    } catch (e) { toast(e.message); inp.value = text; $("spr-send").disabled = false; }
  },
  async msgMenu(id) {
    const R = SpaceRoom.R; if (!R) return;
    const m = R.chat.find((x) => x.id === id); if (!m || m.kind !== "m") return;
    const mine = m.user === App.user.id, acts = [];
    acts.push({ label: T("Копировать"), value: "copy" });
    if (!mine) acts.push({ label: T("Профиль"), value: "prof" });
    if (mine || SpaceRoom.can("delmsg")) acts.push({ label: T("Удалить"), value: "del", danger: true });
    const v = await UI.sheet({ actions: acts, cancel: T("Отмена") });
    if (v === "copy") { copyText(m.text); toast(T("Скопировано")); }
    else if (v === "prof") { try { UserProfile.open(SpaceRoom.uprof(m.user)); } catch (e) {} }
    else if (v === "del") { try { await api("/api/spaces/" + R.id + "/chat/del", { method: "POST", body: { id } }); } catch (e) { toast(e.message); } }
  },

  // ───────────── очередь ─────────────
  paintQueue(box) {
    const R = SpaceRoom.R, ctl = SpaceRoom.can("control"), cur = R.player && R.player.trk ? R.player.trk.id : 0;
    const rows = R.tracks.map((t, i) => {
      const on = t.id === cur, del = t.by === App.user.id || ctl;
      return `<div class="spq${on ? " on" : ""}" data-t="${t.id}"><button class="spq-m" data-q="play" type="button"><span class="spq-i">${on && R.player.play ? `<i class="spr-bars sm"><u></u><u></u><u></u></i>` : SpaceRoom.trkIcon(t)}</span><span class="spq-t"><b>${esc(t.title)}</b><small>${esc(t.artist || "")}${t.has_lrc ? (t.artist ? " · " : "") + esc(T("с текстом")) : ""}${t.dur ? (t.artist || t.has_lrc ? " · " : "") + Calls.fmt(t.dur) : ""}</small></span></button>${del ? `<button class="spq-d" data-q="del" type="button" aria-label="${esc(T("Удалить"))}">${SPI.trash}</button>` : ""}</div>`;
    }).join("");
    box.innerHTML = `${SpaceRoom.can("tracks") ? `<button class="spq-add" data-a="addtrack" type="button">${SPI.plus}<span>${esc(T("Добавить музыку или видео"))}</span></button>` : `<div class="spr-note">${esc(T("Добавлять треки здесь могут {0}.", T(spOptName((R.info.perms || {}).tracks || "mod")).toLowerCase()))}</div>`}
      <div class="spq-list">${rows || `<div class="spr-empty">${SPI.music}<span>${esc(T("Очередь пуста"))}</span></div>`}</div>`;
  },
  async queueAct(id, act) {
    const R = SpaceRoom.R, t = R && R.tmap[id]; if (!t) return;
    if (act === "del") {
      const v = await UI.sheet({ title: T("Удалить «{0}»?", t.title), actions: [{ label: T("Удалить"), value: 1, danger: true }], cancel: T("Отмена") });
      if (!v) return;
      try { await api("/api/spaces/" + R.id + "/tracks/del", { method: "POST", body: { id } }); SpaceRoom.loadTracks(); } catch (e) { toast(e.message); }
      return;
    }
    if (SpaceRoom.can("control")) { haptic(); return SpaceRoom.player_("set", { trk: id }); }
    const v = await UI.sheet({ title: t.title, text: T("Включить этот трек могут только те, у кого есть право управлять плеером. Отправить им просьбу?"), actions: [{ label: T("Попросить включить"), value: 1, accent: true }], cancel: T("Отмена") });
    if (!v) return;
    try { const d = await api("/api/spaces/" + R.id + "/player", { method: "POST", body: { op: "ask", trk: id } }); toast(d.sent ? T("Просьба отправлена") : T("Сейчас в комнате нет тех, кто может включить")); } catch (e) { toast(e.message); }
  },
  // просьба от участника: карточка с кнопкой «Включить»
  askCard(d) {
    const fly = $("spr-fly"); if (!fly) return;
    const c = document.createElement("div");
    c.className = "spr-ask";
    c.innerHTML = `<span>${avatar(d.user, "sm")}</span><div><b>${esc(dispName(d.user))}</b><small>${esc(T("просит включить «{0}»", d.track.title))}</small></div><button data-go type="button">${esc(T("Включить"))}</button><button class="x" data-x type="button" aria-label="${esc(T("Закрыть"))}">${SPI.x}</button>`;
    fly.appendChild(c); requestAnimationFrame(() => c.classList.add("show"));
    const done = () => { c.classList.remove("show"); setTimeout(() => c.remove(), 250); };
    c.addEventListener("click", (e) => { if (e.target.closest("[data-go]")) { SpaceRoom.player_("set", { trk: d.track.id }); done(); } else if (e.target.closest("[data-x]")) done(); });
    setTimeout(done, 15000);
  },

  // ───────────── эмодзи-реакции ─────────────
  fly(e) {
    const fly = $("spr-fly"); if (!fly) return;
    const n = document.createElement("span");
    n.className = "spr-emo"; n.textContent = e; n.style.left = 10 + Math.random() * 80 + "%"; n.style.setProperty("--dx", (Math.random() * 60 - 30) + "px");
    fly.appendChild(n); setTimeout(() => n.remove(), 2300);
  },
  async reactPick() {
    const R = SpaceRoom.R; if (!R) return;
    const el = document.createElement("div");
    el.className = "spr-react";
    el.innerHTML = SpaceRoom.EMOJI.map((e) => `<button data-e="${e}" type="button">${e}</button>`).join("");
    const dock = $("spr-dock"); dock.appendChild(el); requestAnimationFrame(() => el.classList.add("show"));
    const done = () => { el.classList.remove("show"); setTimeout(() => el.remove(), 180); document.removeEventListener("pointerdown", away, true); };
    const away = (ev) => { if (!el.contains(ev.target)) done(); };
    setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
    el.addEventListener("click", (ev) => { const b = ev.target.closest("[data-e]"); if (!b) return; haptic(); SpaceRoom.fly(b.dataset.e); Calls.send({ type: "sp", op: "react", space: R.id, e: b.dataset.e }); });
  },

  // ───────────── нижняя панель: выход, громкость, микрофон ─────────────
  paintDock() {
    const R = SpaceRoom.R, box = $("spr-dock"); if (!R || !box) return;
    const me = R.users[App.user.id] || {}, vc = typeof SpVoice !== "undefined" && SpVoice.on, mic = vc && SpVoice.mic;
    const can = SpaceRoom.can("voice");
    const lab = !vc ? T("Войти в голос") : !can ? T("Только слушаете") : mic ? T("Микрофон включён") : T("Микрофон выключен");
    box.innerHTML = `<button class="spd-s leave" data-a="leave" aria-label="${esc(T("Выйти из комнаты"))}">${SPI.leave}</button>
      <button class="spd-s${R.muted || R.vol === 0 ? " off" : ""}" data-a="vol" aria-label="${esc(T("Громкость"))}">${R.muted || R.vol === 0 ? SPI.volOff : SPI.vol}</button>
      <button class="spd-mic${vc ? " vc" : ""}${mic ? " on" : ""}${me.speak ? " speak" : ""}" data-a="mic" aria-label="${esc(lab)}"><span>${!vc ? SPI.head : mic ? SPI.mic : SPI.micOff}</span><small>${esc(lab)}</small></button>
      <button class="spd-s" data-a="react" aria-label="${esc(T("Реакция"))}">${SPI.smile}</button>
      <button class="spd-s${vc ? "" : " ghost"}" data-a="voiceoff" aria-label="${esc(T("Выйти из голоса"))}" ${vc ? "" : "tabindex=-1"}>${SPI.head}<i></i></button>`;
  },

  // ───────────── клики ─────────────
  async click(e) {
    const R = SpaceRoom.R; if (!R) return;
    const tab = e.target.closest("[data-tab]"); if (tab) { haptic(); return SpaceRoom.setTab(tab.dataset.tab); }
    const q = e.target.closest("[data-q]");
    if (q) { const row = q.closest("[data-t]"); return SpaceRoom.queueAct(+row.dataset.t, q.dataset.q); }
    const u = e.target.closest(".spp[data-u]"); if (u) { haptic(); return SpaceExtra.memberMenu(+u.dataset.u); }
    const lk = e.target.closest(".spm-t a[href]"); if (lk) { e.preventDefault(); return Links.open(lk.href); }
    const gm = e.target.closest(".spm[data-id]:not(.sys)"); if (gm) return SpaceRoom.msgMenu(+gm.dataset.id);
    if (e.target.closest("[data-g]")) return SpaceExtra.gameClick(e);
    const a = e.target.closest("[data-a]"); if (!a) return;
    const k = a.dataset.a;
    if (a.disabled) return;
    if (k !== "mic") haptic();
    switch (k) {
      case "back": case "leave": return Nav.back();
      case "info": return SpaceExtra.info();
      case "more": return SpaceExtra.menu();
      case "members": return SpaceExtra.members();
      case "addtrack": return SpaceExtra.addTrack();
      case "toggle": return SpaceRoom.player_(R.player && R.player.play ? "pause" : "play");
      case "next": case "prev": return SpaceRoom.player_(k);
      case "rep": return SpaceRoom.player_("rep", { v: (((R.player && R.player.rep) || 0) + 1) % 3 });
      case "kara": return SpaceRoom.player_("mode", { v: R.player && R.player.mode === "karaoke" ? "" : "karaoke" });
      case "unblock": { R.pl.blocked = false; if (R.pl.M) { R.pl.M.vol(); R.pl.M.play(); SpaceRoom.sync(); } return; }
      case "vol": return SpaceRoom.volMenu();
      case "react": return SpaceRoom.reactPick();
      case "mic": haptic("medium"); return SpVoice.tap();
      case "voiceoff": if (SpVoice.on) SpVoice.leave(); return;
    }
  },
  async volMenu() {
    const R = SpaceRoom.R; if (!R) return;
    const v = await UI.sheet({ title: T("Громкость музыки"), text: T("Это только у вас — остальные слышат как раньше."),
      actions: [{ label: R.muted ? T("Включить звук") : T("Выключить звук"), value: "mute" }, { label: "100%", value: 1 }, { label: "70%", value: 0.7 }, { label: "40%", value: 0.4 }, { label: "15%", value: 0.15 }], cancel: T("Закрыть") });
    if (v == null) return;
    if (v === "mute") R.muted = !R.muted; else { R.vol = v; R.muted = false; }
    try { localStorage.setItem("sp_vol", String(R.vol)); localStorage.setItem("sp_muted", R.muted ? "1" : "0"); } catch (e) {}
    if (R.pl.M) R.pl.M.vol();
    SpaceRoom.paintDock();
  },
};

// ползунок перемотки: перетаскиваем — не дёргаемся, отпустили — отправляем
document.addEventListener("input", (e) => { if (e.target && e.target.id === "spr-seekbar" && SpaceRoom.R) { SpaceRoom.R.seeking = true; const c = $("spr-cur"); if (c) c.textContent = Calls.fmt(+e.target.value); } });
document.addEventListener("change", (e) => {
  if (!e.target || e.target.id !== "spr-seekbar" || !SpaceRoom.R) return;
  const R = SpaceRoom.R, pos = +e.target.value;
  api("/api/spaces/" + R.id + "/player", { method: "POST", body: { op: "seek", pos } }).then((d) => { if (SpaceRoom.R === R && d.player) { R.player = d.player; SpaceRoom.sync(); } }).catch((er) => toast(er.message)).finally(() => { setTimeout(() => { R.seeking = false; }, 200); });
});
