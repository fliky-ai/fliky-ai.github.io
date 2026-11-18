// space_more.js — DICEGRAM SPACE: голосование за следующую песню, очередь и общие плейлисты, текст песен (караоке), SPACE RANK и SPACE ARCHIVE.
// Подключается после space_room.js / space_extra.js и дополняет SpaceRoom (вкладки «Очередь», «Рейтинг», «Архив»).
Object.assign(SPI, {
  trophy: SPI.svg('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'),
  archive: SPI.svg('<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>'),
  vote: SPI.svg('<path d="M4 13l5 5L20 7"/><rect x="3" y="3" width="18" height="18" rx="4" opacity=".35"/>'),
  plist: SPI.svg('<path d="M4 6h12M4 11h12M4 16h7"/><path d="M18 14v6M15 17h6"/>'),
  search: SPI.svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
  expand: SPI.svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  edit: SPI.svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/>'),
  stamp: SPI.svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'),
});

const SP_LEVELS = [[0, "Новичок"], [60, "Участник"], [250, "Активист"], [700, "Звезда"], [1800, "Легенда"]];
const spLevel = (p) => { let l = SP_LEVELS[0]; SP_LEVELS.forEach((x) => { if (p >= x[0]) l = x; }); return l; };

const SpaceMore = {
  // ───────────── голосование за следующую песню ─────────────
  pollLeft() { const R = SpaceRoom.R; return R && R.poll ? Math.max(0, R.poll.end - Space.now()) : 0; },
  paintPoll() {
    const R = SpaceRoom.R, box = $("spr-poll"); if (!R || !box) return;
    const po = R.poll;
    if (!po || (po.state === "closed" && Space.now() - (po.closedAt || 0) > 9)) { if (box.innerHTML) box.innerHTML = ""; box.hidden = true; if (po) R.poll = null; return; }
    box.hidden = false;
    const open = po.state === "open", max = Math.max(1, ...Object.values(po.counts || {}).concat([1]));
    const total = po.total || 0, ctl = SpaceRoom.can("control");
    const rows = po.cands.map((c) => {
      const n = (po.counts || {})[c.id] || 0, mine = po.mine === c.id, win = !open && po.win === c.id;
      return `<button class="spv-o${mine ? " mine" : ""}${win ? " win" : ""}" data-v="${c.id}" type="button" ${open ? "" : "disabled"}><i class="spv-bar" style="width:${Math.round((n / (total || 1)) * 100)}%"></i><span class="spv-ic">${c.kind === "video" || c.kind === "yt" ? SPI.video : SPI.music}</span><span class="spv-n"><b>${esc(c.title)}</b><small>${esc(c.artist || "")}</small></span><em>${n}</em>${mine ? `<u>${SPI.check}</u>` : ""}</button>`;
    }).join("");
    const winC = po.cands.find((c) => c.id === po.win);
    box.innerHTML = `<div class="spv-card${open ? "" : " done"}"><div class="spv-h"><b>${SPI.vote}${esc(open ? T("Голосуем за следующую песню") : T("Голосование окончено"))}</b>${open ? `<span class="spv-t" id="spv-t">${Math.ceil(SpaceMore.pollLeft())}</span>` : ""}</div>
      <div class="spv-list">${rows}</div>
      <div class="spv-f"><small>${esc(open ? (total ? T("Проголосовало: {0}", total) : T("Нажмите на песню, чтобы проголосовать")) : winC ? T("Победила «{0}»", winC.title) : T("Никто не проголосовал"))}</small>${open && (ctl || po.by === App.user.id) ? `<button data-a="pollclose" type="button">${esc(T("Закончить"))}</button>` : ""}</div></div>`;
  },
  tickPoll() {
    const R = SpaceRoom.R; if (!R || !R.poll) return;
    if (R.poll.state === "open") { const t = $("spv-t"); if (t) t.textContent = Math.ceil(SpaceMore.pollLeft()); }
    else if (Space.now() - (R.poll.closedAt || 0) > 9) SpaceMore.paintPoll();
  },
  onPoll(po, mine) {
    const R = SpaceRoom.R; if (!R) return;
    const prev = R.poll;
    if (po) {
      po.mine = po.mine != null ? po.mine : (prev && prev.id === po.id ? prev.mine : 0);
      if (mine != null) po.mine = mine;
      po.closedAt = po.state === "closed" ? (prev && prev.closedAt && prev.id === po.id ? prev.closedAt : Space.now()) : 0;
      if (po.t) { const skew = po.t - Date.now() / 1000; if (!(Space.rtt < 1e8)) Space.skew = skew; }
    }
    R.poll = po || null;
    if (po && po.state === "closed" && prev && prev.state === "open" && po.win) { const c = po.cands.find((x) => x.id === po.win); if (c) toast(T("Победила «{0}»", c.title)); }
    SpaceMore.paintPoll();
    if (R.tab === "queue") SpaceMore.paintQueueMini();
  },
  async pollStart(cands) {
    const R = SpaceRoom.R; if (!R) return;
    try { const d = await api("/api/spaces/" + R.id + "/poll", { method: "POST", body: cands ? { op: "start", cands } : { op: "start" } }); SpaceMore.onPoll(d.poll, d.poll.mine || 0); haptic("medium"); }
    catch (e) { toast(e.message); }
  },
  async pollVote(id) {
    const R = SpaceRoom.R; if (!R || !R.poll || R.poll.state !== "open") return;
    const po = R.poll;
    if (po.mine === id) return;
    if (po.mine) po.counts[po.mine] = Math.max(0, (po.counts[po.mine] || 1) - 1); else po.total = (po.total || 0) + 1;
    po.counts[id] = (po.counts[id] || 0) + 1; po.mine = id; haptic();
    SpaceMore.paintPoll();
    try { const d = await api("/api/spaces/" + R.id + "/poll", { method: "POST", body: { op: "vote", trk: id } }); if (SpaceRoom.R === R && R.poll && R.poll.id === d.poll.id) SpaceMore.onPoll(d.poll, d.poll.mine); }
    catch (e) { toast(e.message); }
  },
  async pollClose() { const R = SpaceRoom.R; if (!R) return; try { await api("/api/spaces/" + R.id + "/poll", { method: "POST", body: { op: "close" } }); } catch (e) { toast(e.message); } },

  // ───────────── вкладка «Очередь»: очередь + плейлисты ─────────────
  async loadPls() {
    const R = SpaceRoom.R; if (!R) return;
    try { const d = await api("/api/spaces/" + R.id + "/playlists"); if (SpaceRoom.R !== R) return; R.pls = d.pls || []; R.plA = d.active || 0; if (R.tab === "queue") SpaceRoom.paintPane(); }
    catch (e) {}
  },
  paintQueue(box) {
    const R = SpaceRoom.R, ctl = SpaceRoom.can("control"), cur = R.player && R.player.trk ? R.player.trk.id : 0;
    const act = R.pls.find((p) => p.id === (R.player && R.player.pl));
    const seg = `<div class="spq-seg"><button class="${R.qv === "q" ? "on" : ""}" data-qs="q" type="button">${SPI.list}<span>${esc(T("Очередь"))} · ${R.tracks.length}</span></button><button class="${R.qv === "p" ? "on" : ""}" data-qs="p" type="button">${SPI.plist}<span>${esc(T("Плейлисты"))} · ${R.pls.length}</span></button></div>`;
    let body = "";
    if (R.qv === "p") body = SpaceMore.plHTML();
    else {
      const rows = R.tracks.map((t) => {
        const on = t.id === cur;
        return `<div class="spq${on ? " on" : ""}" data-t="${t.id}"><button class="spq-m" data-q="play" type="button"><span class="spq-i">${on && R.player.play ? `<i class="spr-bars sm"><u></u><u></u><u></u></i>` : SpaceRoom.trkIcon(t)}</span><span class="spq-t"><b>${esc(t.title)}</b><small>${esc(t.artist || "")}${t.has_lrc ? (t.artist ? " · " : "") + esc(T("с текстом")) : ""}${t.dur ? (t.artist || t.has_lrc ? " · " : "") + Calls.fmt(t.dur) : ""}</small></span></button><button class="spq-d" data-q="more" type="button" aria-label="${esc(T("Ещё"))}">${SPI.more}</button></div>`;
      }).join("");
      const canVote = R.tracks.length >= 3 && !(R.poll && R.poll.state === "open");
      body = `<div class="spq-acts">${SpaceRoom.can("tracks") ? `<button class="spq-add" data-a="addtrack" type="button">${SPI.plus}<span>${esc(T("Добавить"))}</span></button>` : ""}<button class="spq-vote" data-a="pollstart" type="button" ${canVote ? "" : "disabled"}>${SPI.vote}<span>${esc(T("Голосование"))}</span></button></div>
        ${SpaceRoom.can("tracks") ? "" : `<div class="spr-note">${esc(T("Добавлять треки здесь могут {0}.", T(spOptName((R.info.perms || {}).tracks || "mod")).toLowerCase()))}</div>`}
        <div class="spq-list">${rows || `<div class="spr-empty">${SPI.music}<span>${esc(T("Очередь пуста"))}</span></div>`}</div>`;
    }
    box.innerHTML = `${seg}${act ? `<div class="spq-chip">${SPI.plist}<span>${esc(T("Играет плейлист «{0}»", act.name))}</span>${ctl ? `<button data-a="plall" type="button" aria-label="${esc(T("Играть всю очередь"))}">${SPI.x}</button>` : ""}</div>` : ""}${body}`;
  },
  paintQueueMini() { const R = SpaceRoom.R; if (R && R.tab === "queue") SpaceRoom.paintPane(); },
  plHTML() {
    const R = SpaceRoom.R, ctl = SpaceRoom.can("control");
    const rows = R.pls.map((p) => {
      const on = R.player && R.player.pl === p.id, open = R.plOpen === p.id, mine = p.by === App.user.id;
      const items = open ? `<div class="spp-items">${p.trks.length ? p.trks.map((tid) => { const t = R.tmap[tid]; if (!t) return ""; return `<div class="spp-it" data-pl="${p.id}" data-tr="${tid}"><button class="spp-itm" data-pa="playat" type="button"><span class="spq-i">${SpaceRoom.trkIcon(t)}</span><span class="spq-t"><b>${esc(t.title)}</b><small>${esc(t.artist || "")}</small></span></button>${mine || ctl ? `<button class="spq-d" data-pa="rem" type="button" aria-label="${esc(T("Убрать"))}">${SPI.x}</button>` : ""}</div>`; }).join("") : `<div class="spr-note">${esc(T("Плейлист пуст. Добавляйте треки через ⋯ в очереди."))}</div>`}</div>` : "";
      return `<div class="spp-card${on ? " on" : ""}" data-pl="${p.id}"><div class="spp-h"><button class="spp-m" data-pa="open" type="button"><span class="spp-ic">${SPI.plist}</span><span class="spq-t"><b>${esc(p.name)}</b><small>${esc(T("{0} треков", p.trks.length))} · ${esc(SpaceRoom.uname(p.by))}</small></span></button>${ctl ? `<button class="spp-pl" data-pa="play" type="button" aria-label="${esc(T("Играть"))}">${SPI.play}</button>` : ""}<button class="spq-d" data-pa="menu" type="button" aria-label="${esc(T("Ещё"))}">${SPI.more}</button></div>${items}</div>`;
    }).join("");
    return `<button class="spq-add" data-a="plnew" type="button">${SPI.plus}<span>${esc(T("Новый плейлист"))}</span></button>${rows || `<div class="spr-empty">${SPI.plist}<span>${esc(T("Общих плейлистов пока нет. Создайте первый — добавлять треки смогут все."))}</span></div>`}`;
  },
  async plOp(body, quiet) {
    const R = SpaceRoom.R; if (!R) return null;
    try { const d = await api("/api/spaces/" + R.id + "/playlists", { method: "POST", body }); if (!quiet) haptic(); SpaceMore.loadPls(); return d; }
    catch (e) { toast(e.message); return null; }
  },
  async plNew(withTrk) {
    const name = await UI.prompt({ title: T("Новый плейлист"), placeholder: T("Название плейлиста"), ok: T("Создать"), type: "text" });
    if (!name || !name.trim()) return null;
    const d = await SpaceMore.plOp({ op: "create", name: name.trim(), trks: withTrk ? [withTrk] : [] });
    if (d) toast(T("Плейлист создан"));
    return d;
  },
  async plClick(e) {
    const R = SpaceRoom.R; if (!R) return false;
    const b = e.target.closest("[data-pa]"); if (!b) return false;
    const card = b.closest("[data-pl]"); const pid = card ? +card.dataset.pl : 0, p = R.pls.find((x) => x.id === pid);
    const k = b.dataset.pa;
    if (k === "open") { R.plOpen = R.plOpen === pid ? 0 : pid; SpaceRoom.paintPane(); }
    else if (k === "play") SpaceMore.plOp({ op: "play", id: pid });
    else if (k === "playat") SpaceMore.plOp({ op: "play", id: pid, trk: +b.closest("[data-tr]").dataset.tr });
    else if (k === "rem") SpaceMore.plOp({ op: "rem", id: pid, trk: +b.closest("[data-tr]").dataset.tr });
    else if (k === "menu" && p) {
      const mine = p.by === App.user.id, ctl = SpaceRoom.can("control"), acts = [];
      if (ctl) acts.push({ label: T("Играть плейлист"), value: "play" });
      if (mine || ctl) acts.push({ label: T("Переименовать"), value: "ren" }, { label: T("Удалить"), value: "del", danger: true });
      if (!acts.length) return true;
      const v = await UI.sheet({ title: p.name, actions: acts, cancel: T("Отмена") });
      if (v === "play") SpaceMore.plOp({ op: "play", id: pid });
      else if (v === "ren") { const n = await UI.prompt({ title: T("Название плейлиста"), value: p.name, ok: T("Сохранить"), type: "text" }); if (n && n.trim()) SpaceMore.plOp({ op: "rename", id: pid, name: n.trim() }); }
      else if (v === "del") SpaceMore.plOp({ op: "del", id: pid });
    }
    return true;
  },
  // меню трека в очереди: ⋯
  async trackMenu(id) {
    const R = SpaceRoom.R, t = R && R.tmap[id]; if (!t) return;
    const ctl = SpaceRoom.can("control"), mine = t.by === App.user.id, acts = [];
    acts.push({ label: ctl ? T("Включить сейчас") : T("Попросить включить"), value: "play" });
    acts.push({ label: T("Добавить в плейлист…"), value: "pl" });
    if (mine || ctl) acts.push({ label: t.has_lrc ? T("Текст песни: изменить") : T("Текст песни: найти или вставить"), value: "lrc" });
    if (mine || ctl) acts.push({ label: T("Удалить из очереди"), value: "del", danger: true });
    const v = await UI.sheet({ title: t.title, text: t.artist || "", actions: acts, cancel: T("Отмена") });
    if (v === "play") SpaceRoom.queueAct(id, "play");
    else if (v === "del") SpaceRoom.queueAct(id, "del");
    else if (v === "lrc") SpaceMore.lrcMenu(t);
    else if (v === "pl") SpaceMore.addToPl(t);
  },
  async addToPl(t) {
    const R = SpaceRoom.R; if (!R) return;
    if (!R.pls.length) { const d = await SpaceMore.plNew(t.id); if (d) { R.qv = "p"; SpaceRoom.paintPane(); } return; }
    const acts = R.pls.map((p) => ({ label: `${p.name}${p.trks.includes(t.id) ? " ✓" : ""}`, value: p.id }));
    acts.push({ label: "＋ " + T("Новый плейлист"), value: "new" });
    const v = await UI.sheet({ title: T("Добавить «{0}» в плейлист", t.title), actions: acts, cancel: T("Отмена") });
    if (!v) return;
    if (v === "new") { await SpaceMore.plNew(t.id); return; }
    const d = await SpaceMore.plOp({ op: "add", id: v, trk: t.id }); if (d) toast(T("Добавлено в плейлист"));
  },

  // ───────────── текст песен ─────────────
  lrcOff(tid) { try { return parseFloat(localStorage.getItem("sp_lo_" + tid) || "0") || 0; } catch (e) { return 0; } },
  setLrcOff(tid, v) { try { localStorage.setItem("sp_lo_" + tid, String(Math.round(v * 10) / 10)); } catch (e) {} },
  // выдаёт разобранный текст трека; для обычного текста без меток раскладывает строки по длине трека («примерное» время)
  lrcOf(t) {
    const R = SpaceRoom.R; if (!R || !t) return null;
    let txt = R.lrcC[t.id];
    if (txt === undefined) { if (!t.has_lrc) { R.lrcC[t.id] = ""; return null; } SpaceMore.needLrc(t); return undefined; }
    if (!txt) return null;
    const key = t.id + ":" + txt.length + ":" + (t.dur || (R.pl.M && R.pl.M.dur()) || 0);
    if (R.lrcP && R.lrcP.key === key) return R.lrcP.v;
    const lr = SpaceRoom.parseLrc(txt), dur = t.dur || (R.pl.M && R.pl.M.dur()) || 0;
    if (!lr.sync && lr.lines.length && dur > 20) {
      const L = lr.lines.filter((x) => x.s), intro = Math.min(10, dur * 0.07), span = Math.max(10, dur - intro - Math.min(14, dur * 0.09));
      const w = L.map((x) => Math.max(10, x.s.length)), sum = w.reduce((a, b) => a + b, 0); let acc = 0;
      lr.lines = L.map((x, i) => { const o = { t: intro + (span * acc) / sum, s: x.s }; acc += w[i]; return o; });
      lr.sync = true; lr.approx = true;
    }
    R.lrcP = { key, v: lr };
    return lr;
  },
  async needLrc(t) {
    const R = SpaceRoom.R; if (!R || !t.has_lrc) { if (R && R.lrcC[t.id] === undefined) R.lrcC[t.id] = ""; return; }
    if (R.lrcQ[t.id]) return; R.lrcQ[t.id] = 1;
    try {
      const d = await api("/api/spaces/" + R.id + "/tracks/" + t.id + "/lrc");
      if (SpaceRoom.R !== R) return; R.lrcC[t.id] = d.lrc || ""; R.lrcQ[t.id] = 0;
      if (R.player && R.player.trk && R.player.trk.id === t.id) SpaceRoom.paintPlayer();
    } catch (e) { R.lrcQ[t.id] = 0; setTimeout(() => { if (SpaceRoom.R === R) R.lrcC[t.id] = R.lrcC[t.id] === undefined ? "" : R.lrcC[t.id]; }, 0); }
  },
  onLrc(d) {
    const R = SpaceRoom.R; if (!R) return;
    delete R.lrcC[d.trk]; R.lrcP = null; R.lrcQ[d.trk] = 0;
    const t = R.tmap[d.trk]; if (t) t.has_lrc = d.has;
    if (R.player && R.player.trk && R.player.trk.id === d.trk) { R.player.trk.has_lrc = d.has; if (!d.has) R.lrcC[d.trk] = ""; SpaceRoom.paintPlayer(); }
  },
  canLrc(t) { return !!t && (t.by === App.user.id || SpaceRoom.can("control")); },
  // автоподбор по названию: сервер ищет в LRCLIB и берёт лучший вариант (с метками времени, если есть)
  async lrcAuto(t, quiet) {
    const R = SpaceRoom.R; if (!R) return false;
    try { const d = await api("/api/spaces/" + R.id + "/tracks/lrc", { method: "POST", body: { id: t.id, auto: true } }); if (!quiet) toast(T("Текст найден")); return !!d.lrc; }
    catch (e) { if (!quiet) toast(e.message); return false; }
  },
  async lrcSearch(t) {
    const R = SpaceRoom.R; if (!R) return;
    toast(T("Ищем текст…"));
    let items = [];
    try { items = (await api("/api/spaces/" + R.id + "/lyrics?trk=" + t.id)).items || []; } catch (e) { return toast(e.message); }
    if (!items.length) { const q = await UI.prompt({ title: T("Текст не найден"), placeholder: T("Исполнитель — название"), ok: T("Искать"), type: "text" }); if (!q || !q.trim()) return;
      try { items = (await api("/api/spaces/" + R.id + "/lyrics?q=" + encodeURIComponent(q.trim()))).items || []; } catch (e) { return toast(e.message); } }
    if (!items.length) return toast(T("Ничего не нашлось. Вставьте текст вручную"));
    const v = await UI.sheet({ title: T("Выберите текст"), actions: items.map((x, i) => ({ label: `${x.artist ? x.artist + " — " : ""}${x.title} · ${x.synced ? T("с таймингом") : T("без тайминга")}`, value: i + 1 })), cancel: T("Отмена") });
    if (!v) return;
    try { await api("/api/spaces/" + R.id + "/tracks/lrc", { method: "POST", body: { id: t.id, lrc: items[v - 1].lrc } }); toast(T("Текст сохранён")); } catch (e) { toast(e.message); }
  },
  async lrcMenu(t) {
    const acts = [{ label: T("Найти текст в интернете"), value: "auto" }, { label: T("Выбрать из найденных"), value: "search" }, { label: T("Вставить или изменить вручную"), value: "edit" }];
    if (t.has_lrc) acts.push({ label: T("Разметить время строк"), value: "stamp" }, { label: T("Убрать текст"), value: "clr", danger: true });
    const v = await UI.sheet({ title: T("Текст песни для караоке"), text: t.title, actions: acts, cancel: T("Отмена") });
    if (v === "auto") SpaceMore.lrcAuto(t);
    else if (v === "search") SpaceMore.lrcSearch(t);
    else if (v === "edit") SpaceMore.lrcEdit(t);
    else if (v === "stamp") SpaceMore.stampStart(t);
    else if (v === "clr") { try { await api("/api/spaces/" + SpaceRoom.R.id + "/tracks/lrc", { method: "POST", body: { id: t.id, lrc: "" } }); } catch (e) { toast(e.message); } }
  },
  async lrcEdit(t) {
    const R = SpaceRoom.R; if (!R || $("splrc")) return;
    let txt = R.lrcC[t.id]; if (txt === undefined) { try { txt = (await api("/api/spaces/" + R.id + "/tracks/" + t.id + "/lrc")).lrc; } catch (e) { txt = ""; } }
    const el = document.createElement("section");
    el.id = "splrc"; el.className = "page tgp sp-page"; el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<header class="tg-head"><button class="icon-btn" data-back aria-label="${esc(T("Назад"))}">${SPI.back}</button><div class="tg-title">${esc(T("Текст песни"))}</div></header>
      <div class="nm-body cc-body"><div class="cc-hint">${esc(T("Вставьте текст построчно. С метками [мм:сс.хх] строки подсвечиваются точно по времени, без них — примерно по длине трека (потом можно разметить вручную)."))}</div>
        <div class="cc-about"><textarea id="splrc-t" rows="12" maxlength="40000" placeholder="[00:12.50] Первая строка&#10;[00:16.00] Вторая строка">${esc(txt || "")}</textarea></div>
        <button class="nm-act cc-row" data-find type="button">${SPI.search}<span>${esc(T("Найти в интернете"))}</span></button>
        <button class="nm-act cc-row" data-file type="button"><span>${esc(T("Загрузить файл .lrc или .txt"))}</span></button><input id="splrc-f" type="file" accept=".lrc,.txt,text/plain" hidden></div>
      <button class="fab2" data-ok aria-label="${esc(T("Сохранить"))}">${SI.check}</button>`;
    document.body.appendChild(el); void el.offsetWidth;
    Nav.open("splrc", () => setTimeout(() => el.remove(), 320));
    const ta = el.querySelector("#splrc-t");
    el.querySelector("#splrc-f").addEventListener("change", async (e) => { const f = e.target.files && e.target.files[0]; if (!f || f.size > 200000) return; try { ta.value = (await f.text()).slice(0, 40000); } catch (er) {} });
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-back]")) return Nav.back();
      if (e.target.closest("[data-file]")) return el.querySelector("#splrc-f").click();
      if (e.target.closest("[data-find]")) { await SpaceMore.lrcSearch(t); return; }
      if (e.target.closest("[data-ok]")) {
        try { await api("/api/spaces/" + R.id + "/tracks/lrc", { method: "POST", body: { id: t.id, lrc: ta.value } }); toast(T("Текст сохранён")); Nav.back(); } catch (er) { toast(er.message); }
      }
    });
  },
  // ручная разметка: проигрываем трек и нажимаем «Строка» в момент, когда она начинается
  stampStart(t) {
    const R = SpaceRoom.R; if (!R) return;
    const lr = SpaceRoom.parseLrc(R.lrcC[t.id] || ""), lines = lr.lines.map((x) => x.s).filter(Boolean);
    if (!lines.length) return toast(T("Сначала добавьте текст"));
    R.stamp = { tid: t.id, lines, i: 0, ts: [] };
    if (SpaceRoom.can("control")) { if (!R.player || !R.player.trk || R.player.trk.id !== t.id) SpaceRoom.player_("set", { trk: t.id }); SpaceRoom.player_("seek", { pos: 0 }); }
    SpaceRoom.paintPlayer(); toast(T("Включите песню сначала и нажимайте «Строка», когда она начинается"));
  },
  stampTap() {
    const R = SpaceRoom.R, S = R && R.stamp; if (!S) return;
    S.ts.push(SpaceRoom.expected()); S.i++; haptic();
    if (S.i >= S.lines.length) SpaceMore.stampDone(); else SpaceRoom.paintPlayer();
  },
  stampUndo() { const R = SpaceRoom.R, S = R && R.stamp; if (!S || !S.i) return; S.i--; S.ts.pop(); SpaceRoom.paintPlayer(); },
  async stampDone(cancel) {
    const R = SpaceRoom.R, S = R && R.stamp; if (!S) return;
    R.stamp = null;
    if (!cancel && S.ts.length) {
      const f = (x) => { x = Math.max(0, x); const m = Math.floor(x / 60); return `[${String(m).padStart(2, "0")}:${(x - m * 60).toFixed(2).padStart(5, "0")}]`; };
      const lrc = S.lines.slice(0, S.ts.length).map((s, i) => f(S.ts[i]) + s).join("\n");
      try { await api("/api/spaces/" + R.id + "/tracks/lrc", { method: "POST", body: { id: S.tid, lrc } }); toast(T("Тайминг сохранён")); } catch (e) { toast(e.message); }
    }
    SpaceRoom.paintPlayer();
  },
  // панель под текстом караоке
  karaTools(t) {
    const R = SpaceRoom.R, off = SpaceMore.lrcOff(t.id), can = SpaceMore.canLrc(t), lr = SpaceMore.lrcOf(t);
    if (R.stamp && R.stamp.tid === t.id) {
      const S = R.stamp;
      return `<div class="sk-tools stamp"><div class="sk-st"><small>${esc(T("Следующая строка"))} ${S.i + 1}/${S.lines.length}</small><b>${esc(S.lines[S.i] || "")}</b></div><div class="sk-row"><button data-a="stampundo" type="button" ${S.i ? "" : "disabled"}>${esc(T("Назад"))}</button><button class="big" data-a="stamptap" type="button">${SPI.stamp}<span>${esc(T("Строка"))}</span></button><button data-a="stampend" type="button">${esc(T("Отмена"))}</button></div></div>`;
    }
    return `<div class="sk-tools"><div class="sk-row"><button data-a="lrcoff" data-d="-0.5" type="button" aria-label="${esc(T("Текст раньше"))}">−</button><span class="sk-off">${esc(T("Сдвиг"))}: ${off > 0 ? "+" : ""}${off.toFixed(1)} ${esc(T("с"))}</span><button data-a="lrcoff" data-d="0.5" type="button" aria-label="${esc(T("Текст позже"))}">+</button>${can ? `<button data-a="lrcmenu" type="button" aria-label="${esc(T("Текст песни"))}">${SPI.edit}</button>` : ""}</div>${lr && lr.approx ? `<small class="sk-n">${esc(T("Время строк примерное — подправьте сдвиг или разметьте вручную"))}</small>` : ""}</div>`;
  },

  // ───────────── SPACE RANK ─────────────
  async loadRank() {
    const R = SpaceRoom.R; if (!R) return;
    const per = R.rankP;
    try { const d = await api("/api/spaces/" + R.id + "/rank?period=" + per); if (SpaceRoom.R !== R || R.rankP !== per) return; R.rank = d; Object.assign(R.cusers, d.users || {}); if (R.tab === "rank") SpaceMore.paintRank($("spr-pane")); }
    catch (e) { if (SpaceRoom.R === R && !R.rank) { R.rank = { items: [], error: e.message }; if (R.tab === "rank") SpaceMore.paintRank($("spr-pane")); } }
  },
  paintRank(box) {
    const R = SpaceRoom.R; if (!R || !box) return;
    const d = R.rank, per = R.rankP;
    const seg = `<div class="spk-seg">${[["day", "Сегодня"], ["week", "Неделя"], ["all", "Всё время"]].map(([k, n]) => `<button class="${per === k ? "on" : ""}" data-rp="${k}" type="button">${esc(T(n))}</button>`).join("")}</div>`;
    let body;
    if (!d) body = `<div class="spr-empty"><span>${esc(T("Загрузка…"))}</span></div>`;
    else if (!d.items.length) body = `<div class="spr-empty">${SPI.trophy}<span>${esc(d.error || T("Пока никто не набрал очков. Пишите в чат, добавляйте музыку, голосуйте и играйте — рейтинг оживёт."))}</span></div>`;
    else {
      const bg = d.badges || {}, lead = d.items[0].pts || 1;
      const badge = (uid) => [["chat", "💬", "Болтун"], ["dj", "🎧", "DJ"], ["game", "🏆", "Чемпион игр"], ["react", "🔥", "Душа компании"], ["time", "⏱", "Постоянный гость"]].filter((x) => bg[x[0]] === uid).map((x) => `<i title="${esc(T(x[2]))}">${x[1]}</i>`).join("");
      const prof = (uid) => (d.users || {})[uid] || SpaceRoom.uprof(uid);
      const pod = d.items.slice(0, 3);
      const order = pod.length === 3 ? [pod[1], pod[0], pod[2]] : pod.length === 2 ? [pod[1], pod[0]] : pod;
      const podium = `<div class="spk-pod n${pod.length}">${order.map((x) => { const pos = d.items.indexOf(x) + 1; return `<div class="spk-p p${pos}" data-u="${x.uid}"><span class="spk-pa">${avatar(prof(x.uid), "lg")}<b>${pos === 1 ? "👑" : pos}</b></span><em>${esc(x.uid === App.user.id ? T("Вы") : dispName(prof(x.uid)))}</em><small>${x.pts} ${esc(T("очк."))}</small></div>`; }).join("")}</div>`;
      const live = new Set(Object.keys(R.users).map(Number));
      const rows = d.items.map((x, i) => {
        const lv = spLevel(x.pts), me = x.uid === App.user.id;
        return `<button class="spk-r${me ? " me" : ""}" data-u="${x.uid}" type="button"><span class="spk-n">${i + 1}</span><span class="spk-a">${avatar(prof(x.uid), "sm")}${live.has(x.uid) ? `<i class="sp-dot"></i>` : ""}</span><span class="spk-t"><b>${esc(me ? T("Вы") : dispName(prof(x.uid)))}${badge(x.uid)}</b><small>${esc(T(lv[1]))} · 💬${x.msgs} 🎵${x.tracks} 🎲${x.games}${x.wins ? " 🏆" + x.wins : ""}</small><u><i style="width:${Math.max(4, Math.round((x.pts / lead) * 100))}%"></i></u></span><em>${x.pts}</em></button>`;
      }).join("");
      const me = d.me ? `<div class="spk-me"><span>${SPI.trophy}</span><div><b>${esc(T("Ваше место"))}: #${d.me.pos}</b><small>${d.me.pts} ${esc(T("очк."))} · ${esc(T(spLevel(d.me.pts)[1]))}</small></div></div>` : `<div class="spk-me dim"><span>${SPI.trophy}</span><div><b>${esc(T("Вас пока нет в рейтинге"))}</b><small>${esc(T("Напишите в чат или сыграйте — очки пойдут сразу"))}</small></div></div>`;
      body = `${me}${podium}<div class="spk-list">${rows}</div><div class="spk-how"><b>${esc(T("Как считаются очки"))}</b><small>${esc(T("Сообщение — 2, трек — 10, голос — 3, реакция — 1, игра — 5, победа — 25, каждая минута в комнате — 1."))}</small></div>`;
    }
    box.innerHTML = `<div class="spk-head"><b>SPACE RANK</b><small>${esc(T("Самые активные участники пространства"))}</small></div>${seg}${body}`;
  },

  // ───────────── SPACE ARCHIVE ─────────────
  async loadArchive(more) {
    const R = SpaceRoom.R; if (!R) return;
    const A = R.arch || (R.arch = { ev: [], more: false, sum: null, g: "", loading: false, done: false });
    if (A.loading) return; A.loading = true;
    const g = A.g;
    try {
      const last = more && A.ev.length ? A.ev[A.ev.length - 1].id : 0;
      const d = await api("/api/spaces/" + R.id + "/archive?limit=40" + (g ? "&g=" + g : "") + (last ? "&before=" + last : ""));
      if (SpaceRoom.R !== R || R.arch !== A || A.g !== g) return;
      A.ev = more ? A.ev.concat(d.events) : d.events; A.more = d.more; if (d.summary) A.sum = d.summary; A.done = true;
      Object.assign(R.cusers, d.users || {});
    } catch (e) { A.err = e.message; A.done = true; }
    A.loading = false;
    if (R.tab === "arch") SpaceMore.paintArchive($("spr-pane"));
  },
  evInfo(e) {
    const R = SpaceRoom.R, d = e.d || {}, nm = (u) => (u === App.user.id ? T("Вы") : SpaceRoom.uname(u)), who = e.user ? nm(e.user) : "";
    const G = { mafia: "Мафия", sea: "Морской бой", gartic: "Gartic Phone", uno: "UNO", emoji: "Угадай фильм" };
    const roles = { admin: "администратором", mod: "модератором", member: "участником" };
    switch (e.kind) {
      case "join": return ["👋", T("{0} присоединился(лась)", who)];
      case "leave": return ["🚪", T("{0} покинул(а) пространство", who)];
      case "role": return ["🛡️", T("{0} теперь {1}", who, T(roles[d.role] || "участником"))];
      case "kick": return ["⛔", T("{0} исключён(а)", who)];
      case "ban": return ["🚫", T("{0} заблокирован(а)", who)];
      case "mute": return ["🔇", d.on ? T("{0} лишён(а) слова", who) : T("{0} снова может говорить", who)];
      case "info": return ["✏️", d.t ? T("Пространство переименовано: «{0}»", d.t) : T("Описание пространства изменено")];
      case "track_add": return [d.k === "video" ? "🎬" : "🎵", T("{0} добавил(а) «{1}»", who, d.t)];
      case "track_del": return ["🗑️", T("{0} убрал(а) «{1}»", who, d.t)];
      case "track": return ["▶️", T("Играет «{0}»", d.t)];
      case "poll": return ["🗳️", T("Голосование: «{0}» — {1} из {2}", d.t, d.n, d.of)];
      case "playlist": return ["📃", d.a === "new" ? T("{0} создал(а) плейлист «{1}»", who, d.t) : d.a === "del" ? T("{0} удалил(а) плейлист «{1}»", who, d.t) : T("{0} запустил(а) плейлист «{1}»", who, d.t)];
      case "lyrics": return ["🎤", d.on ? T("{0} добавил(а) текст к «{1}»", who, d.t) : T("{0} убрал(а) текст у «{1}»", who, d.t)];
      case "kara": return ["🎤", T("{0} включил(а) караоке", who)];
      case "game": {
        const gn = T(G[d.g] || "Игра");
        if (d.a === "start") return ["🎲", T("{0} начал(а) игру «{1}» · игроков: {2}", who, gn, d.n)];
        if (d.a === "stop") return ["⏹️", T("{0} закончил(а) игру «{1}» досрочно", who, gn)];
        return ["🏆", e.user ? T("Игра «{0}» окончена · победил(а) {1}", gn, who) : T("Игра «{0}» окончена · игроков: {1}", gn, d.n)];
      }
    }
    return ["•", e.kind];
  },
  dayLabel(ts) {
    const d = new Date(ts * 1000), n = new Date(), y = new Date(n.getTime() - 864e5);
    const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(d, n)) return T("Сегодня"); if (same(d, y)) return T("Вчера");
    try { return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: d.getFullYear() === n.getFullYear() ? undefined : "numeric" }); } catch (e) { return d.toDateString(); }
  },
  paintArchive(box) {
    const R = SpaceRoom.R; if (!R || !box) return;
    const A = R.arch;
    if (!A) { R.arch = { ev: [], more: false, sum: null, g: "", loading: false, done: false }; SpaceMore.loadArchive(); return SpaceMore.paintArchive(box); }
    const sm = A.sum, since = sm ? new Date(sm.since * 1000).toLocaleDateString() : "";
    const chips = sm ? `<div class="sa-sum"><span><b>${sm.songs}</b>${esc(T("песен сыграно"))}</span><span><b>${sm.games}</b>${esc(T("игр"))}</span><span><b>${sm.polls}</b>${esc(T("голосований"))}</span><span><b>${sm.people}</b>${esc(T("вошли"))}</span></div>` : "";
    const flt = `<div class="spk-seg sa-flt">${[["", "Всё"], ["music", "Музыка"], ["games", "Игры"], ["people", "Люди"]].map(([k, n]) => `<button class="${A.g === k ? "on" : ""}" data-ag="${k}" type="button">${esc(T(n))}</button>`).join("")}</div>`;
    let list = "", day = "";
    A.ev.forEach((e) => {
      const dl = SpaceMore.dayLabel(e.ts); if (dl !== day) { day = dl; list += `<div class="sa-day">${esc(dl)}</div>`; }
      const [ic, tx] = SpaceMore.evInfo(e);
      list += `<div class="sa-ev k-${e.kind}"><span class="sa-i">${ic}</span><span class="sa-t">${esc(tx)}</span><time>${esc(fmtTime(e.ts))}</time></div>`;
    });
    const empty = A.done && !A.ev.length ? `<div class="spr-empty">${SPI.archive}<span>${esc(A.err || T("Здесь появится история пространства: кто заходил, что играло, кто победил в играх."))}</span></div>` : "";
    box.innerHTML = `<div class="spk-head"><b>SPACE ARCHIVE</b><small>${esc(since ? T("История пространства с {0}", since) : T("История всех событий пространства"))}</small></div>${chips}${flt}<div class="sa-list">${list}${!A.done ? `<div class="spr-empty"><span>${esc(T("Загрузка…"))}</span></div>` : empty}</div>${A.more ? `<button class="spq-add sa-more" data-a="archmore" type="button"><span>${esc(T("Показать ещё"))}</span></button>` : ""}`;
  },
  // свежее событие пришло, пока архив открыт — перезагружаем первую страницу
  archTouch() { const R = SpaceRoom.R; if (R && R.arch) { R.arch.stale = true; if (R.tab === "arch") { R.arch.done = true; SpaceMore.loadArchive(); } } },

  // ───────────── клики ─────────────
  async click(e) {
    const R = SpaceRoom.R; if (!R) return false;
    const v = e.target.closest("[data-v]"); if (v && v.closest("#spr-poll")) { SpaceMore.pollVote(+v.dataset.v); return true; }
    const qs = e.target.closest("[data-qs]"); if (qs) { R.qv = qs.dataset.qs; SpaceRoom.paintPane(); if (R.qv === "p") SpaceMore.loadPls(); return true; }
    const rp = e.target.closest("[data-rp]"); if (rp) { R.rankP = rp.dataset.rp; R.rank = null; SpaceMore.paintRank($("spr-pane")); SpaceMore.loadRank(); return true; }
    const ag = e.target.closest("[data-ag]"); if (ag) { const A = R.arch; A.g = ag.dataset.ag; A.ev = []; A.done = false; A.more = false; SpaceMore.paintArchive($("spr-pane")); SpaceMore.loadArchive(); return true; }
    const ru = e.target.closest(".spk-r[data-u],.spk-p[data-u]"); if (ru) { haptic(); SpaceExtra.memberMenu(+ru.dataset.u); return true; }
    if (await SpaceMore.plClick(e)) return true;
    const a = e.target.closest("[data-a]"); if (!a || a.disabled) return false;
    switch (a.dataset.a) {
      case "pollstart": haptic(); SpaceMore.pollStart(); return true;
      case "pollclose": SpaceMore.pollClose(); return true;
      case "plnew": SpaceMore.plNew(); return true;
      case "plall": SpaceMore.plOp({ op: "all" }); return true;
      case "archmore": SpaceMore.loadArchive(true); return true;
      case "lrcmenu": { const t = SpaceRoom.curTrack(); if (t) SpaceMore.lrcMenu(t); return true; }
      case "lrcoff": { const t = SpaceRoom.curTrack(); if (t) { SpaceMore.setLrcOff(t.id, SpaceMore.lrcOff(t.id) + parseFloat(a.dataset.d)); SpaceRoom.paintPlayer(); } return true; }
      case "lrcfind": { const t = SpaceRoom.curTrack(); if (t) SpaceMore.lrcAuto(t); return true; }
      case "lrcpaste": { const t = SpaceRoom.curTrack(); if (t) SpaceMore.lrcEdit(t); return true; }
      case "lrcsearch": { const t = SpaceRoom.curTrack(); if (t) SpaceMore.lrcSearch(t); return true; }
      case "stamptap": SpaceMore.stampTap(); return true;
      case "stampundo": SpaceMore.stampUndo(); return true;
      case "stampend": SpaceMore.stampDone(true); return true;
    }
    return false;
  },
};
