// space.js — DICEGRAM SPACE: список пространств, создание, карточка по ссылке, обзор. Сам экран комнаты — в space_room.js.
// Пространство — не группа для переписки, а постоянная комната, где люди бывают одновременно:
// общий плеер (музыка, видео, караоке), голос, чат комнаты, мини-игры, список присутствующих.
const SPI = {
  svg: (p, f) => `<svg viewBox="0 0 24 24" fill="${f ? "currentColor" : "none"}" stroke="${f ? "none" : "currentColor"}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`,
};
Object.assign(SPI, {
  back: SPI.svg('<path d="m15 18-6-6 6-6"/>'),
  more: SPI.svg('<circle cx="12" cy="5" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="19" r="1.7" fill="currentColor"/>'),
  play: SPI.svg('<path d="M8 5.2v13.6a1 1 0 0 0 1.5.9l11-6.8a1 1 0 0 0 0-1.8l-11-6.8A1 1 0 0 0 8 5.2z"/>', 1),
  pause: SPI.svg('<rect x="6" y="5" width="4.2" height="14" rx="1.4"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.4"/>', 1),
  next: SPI.svg('<path d="M6 6.2v11.6a1 1 0 0 0 1.5.9l8-5.8a1 1 0 0 0 0-1.8l-8-5.8A1 1 0 0 0 6 6.2z"/><rect x="17" y="5.5" width="2.6" height="13" rx="1.2"/>', 1),
  prev: SPI.svg('<path d="M18 6.2v11.6a1 1 0 0 1-1.5.9l-8-5.8a1 1 0 0 1 0-1.8l8-5.8A1 1 0 0 1 18 6.2z"/><rect x="4.4" y="5.5" width="2.6" height="13" rx="1.2"/>', 1),
  repeat: SPI.svg('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
  repeat1: SPI.svg('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1.5v4"/>'),
  mic: SPI.svg('<rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5"/>'),
  micOff: SPI.svg('<path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V5.5a3 3 0 0 0-5.9-.8"/><path d="M5.5 11.5a6.5 6.5 0 0 0 10.3 5.3M18.5 11.5a6.5 6.5 0 0 1-.6 2.7M12 18v3.5"/><path d="M3 3l18 18"/>'),
  head: SPI.svg('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="7" rx="2"/><rect x="16.5" y="14" width="4.5" height="7" rx="2"/>'),
  music: SPI.svg('<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
  video: SPI.svg('<rect x="2.5" y="5.5" width="14" height="13" rx="3"/><path d="m16.5 10 5-3v10l-5-3"/>'),
  karaoke: SPI.svg('<path d="M14.5 3.5a4.2 4.2 0 0 1 6 6l-5.2 5.2-6-6z"/><path d="m9.3 8.7-5.5 9 1.7 1.7 9-5.5"/><path d="M3 21l3-3"/>'),
  users: SPI.svg('<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0"/><path d="M16 4.8a3.4 3.4 0 0 1 0 6.4M18 14.2a6.2 6.2 0 0 1 3.2 5.8"/>'),
  chat: SPI.svg('<path d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
  game: SPI.svg('<rect x="2.5" y="7" width="19" height="11" rx="5"/><path d="M7.5 10.5v4M5.5 12.5h4"/><circle cx="15.5" cy="11.5" r=".9" fill="currentColor"/><circle cx="18" cy="13.8" r=".9" fill="currentColor"/>'),
  list: SPI.svg('<path d="M4 6h12M4 12h12M4 18h8"/><path d="m19 14 3 2-3 2z" fill="currentColor"/>'),
  plus: SPI.svg('<path d="M12 5v14M5 12h14"/>'),
  send: SPI.svg('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>'),
  crown: SPI.svg('<path d="m3 8 4.5 4 4.5-7 4.5 7L21 8l-2 11H5z"/>', 1),
  shield: SPI.svg('<path d="M12 3 4.5 6v6c0 4.6 3.2 7.9 7.5 9 4.3-1.1 7.5-4.4 7.5-9V6z"/>', 1),
  check: SPI.svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  link: SPI.svg('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>'),
  vol: SPI.svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  volOff: SPI.svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>'),
  leave: SPI.svg('<path d="M9 21H6a2.5 2.5 0 0 1-2.5-2.5v-13A2.5 2.5 0 0 1 6 3h3"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
  smile: SPI.svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.2a4.2 4.2 0 0 0 7 0M9 9.6h.01M15 9.6h.01"/>'),
  trash: SPI.svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.5L18 7M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/>'),
  cam: SPI.svg('<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.3a2 2 0 0 0 1.6-.8l.7-1A2 2 0 0 1 11.7 3.5h.6a2 2 0 0 1 1.6.9l.7 1A2 2 0 0 0 16.2 6h1.3A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.2"/>'),
  globe: SPI.svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  lock: SPI.svg('<rect x="4.5" y="10.5" width="15" height="10" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
  sliders: SPI.svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  cube: SPI.svg('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
  x: SPI.svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  explore: SPI.svg('<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'),
});

const SP_ROLE = { owner: "Владелец", admin: "Администратор", mod: "Модератор", member: "Участник" };
const SP_LEVEL = { member: 0, mod: 1, admin: 2, owner: 3 };
const SP_PERM_NAMES = {
  chat: "Писать в чат комнаты", tracks: "Добавлять музыку и видео", control: "Управлять плеером", voice: "Говорить в голосовом чате",
  invite: "Приглашать людей", games: "Запускать мини-игры",
};
const SP_PERM_HINT = {
  control: "Пауза, перемотка, смена трека. Остальные могут попросить включить трек — просьбу увидят те, у кого есть право.",
  tracks: "Файлы, ссылки и видео. Ссылки на чужие сайты видны всем в комнате — в открытых пространствах лучше оставить модераторов.",
};
const SP_PERM_OPT = [["member", "Все"], ["mod", "Модераторы и выше"], ["admin", "Администраторы и выше"], ["owner", "Только владелец"]];
const spOptName = (v) => T((SP_PERM_OPT.find((x) => x[0] === v) || SP_PERM_OPT[0])[1]);
const spId = (n) => String(n || "").replace(/(\d{3})(?=\d)/g, "$1 ");
// цвет «обложки» пространства по номеру — у каждого свой оттенок синего/фиолетового/бирюзового
const SP_HUES = [[214, 262], [198, 238], [224, 292], [186, 224], [244, 312], [206, 168]];
const spGrad = (id) => { const h = SP_HUES[Math.abs(+id || 0) % SP_HUES.length]; return `linear-gradient(150deg,hsl(${h[0]} 82% 56%),hsl(${h[1]} 70% 38%))`; };
const spAvatar = (s, cls = "") => avatar({ id: s.id, name: s.title, surname: "", avatar: s.photo || "" }, cls);

const Space = {
  list: [], loaded: false, skew: 0, rtt: 1e9,
  now() { return Date.now() / 1000 + Space.skew; },
  get(id) { return Space.list.find((s) => s.id === id); },

  init() {
    if (Space.inited) return;
    Space.inited = true;
    const box = $("chat-list");
    if (box) box.addEventListener("click", (e) => {
      const c = e.target.closest("[data-sp]");
      if (c) { haptic(); return Space.open(+c.dataset.sp); }
      const x = e.target.closest("[data-sp-x]");
      if (x) { haptic(); return x.dataset.spX === "create" ? Space.create() : Space.explore(); }
    });
  },
  async load() {
    try {
      const d = await api("/api/spaces");
      Space.list = d.spaces || []; Space.loaded = true;
      Space.paintRail();
    } catch (e) {}
  },
  // ───────────── лента пространств сверху списка чатов ─────────────
  card(s) {
    const live = s.live || 0;
    return `<button class="spx-card${live ? " live" : ""}" data-sp="${s.id}" type="button">
      <span class="sp-cav">${spAvatar(s)}<i class="sp-dot"></i>${s.now && s.now.play ? `<i class="sp-eq"><u></u><u></u><u></u></i>` : ""}</span>
      <b>${esc(s.title)}</b><small>${live ? esc(T("{0} в эфире", live)) : esc(T("{0} участн.", s.n))}</small></button>`;
  },
  rail() {
    if (!Space.list.length) return "";
    return `<div class="sp-rail" id="sp-rail"><div class="sp-rail-h"><b>${esc(T("Пространства"))}</b><button type="button" data-sp-x="explore">${SPI.explore}<span>${esc(T("Обзор"))}</span></button></div>
      <div class="sp-rail-s">${Space.list.map((s) => Space.card(s)).join("")}<button class="spx-card new" data-sp-x="create" type="button"><span class="sp-cav"><span class="spx-plus">${SPI.plus}</span></span><b>${esc(T("Создать"))}</b><small>&nbsp;</small></button></div></div>`;
  },
  paintRail() {
    try { if (Chats.folder === "all" || !Chats.folder) Chats.render(); } catch (e) {}
  },
  // точечно обновляем карточку: «в эфире», «сейчас играет»
  paintCard(s) {
    const old = document.querySelector(`.spx-card[data-sp="${s.id}"]`); if (!old) return;
    const t = document.createElement("div"); t.innerHTML = Space.card(s);
    old.replaceWith(t.firstElementChild);
  },
  upsert(s) {
    const i = Space.list.findIndex((x) => x.id === s.id);
    if (i >= 0) Space.list[i] = Object.assign(Space.list[i], s); else Space.list.unshift(s);
    Space.list.sort((a, b) => (b.live || 0) - (a.live || 0) || b.created - a.created);
  },
  remove(id) { Space.list = Space.list.filter((s) => s.id !== id); Space.paintRail(); },

  onWS(d) {
    if (d.op === "time") return Space.onTime(d);
    if (d.op === "added") {
      Space.upsert(d.space); Space.paintRail();
      toast(T("{0} добавил вас в пространство «{1}»", dispName(d.by), d.space.title));
      return;
    }
    if (d.op === "live") {
      const s = Space.get(d.space); if (!s) return;
      s.live = d.live; s.now = d.now || undefined;
      if (SpaceRoom.R && SpaceRoom.R.id === d.space) { SpaceRoom.R.info.live = d.live; }
      return Space.paintCard(s);
    }
    if (d.op === "deleted" || d.op === "kicked") {
      const s = Space.get(d.space);
      Space.remove(d.space);
      if (SpaceRoom.R && SpaceRoom.R.id === d.space) SpaceRoom.closeFor(d.op === "deleted" ? T("Пространство удалено") : d.ban ? T("Вас заблокировали в этом пространстве") : T("Вас удалили из пространства"));
      else if (s && d.op === "kicked") toast(T("Вас удалили из пространства «{0}»", s.title));
      return;
    }
    if (SpaceRoom.R && SpaceRoom.R.id === d.space) SpaceRoom.onWS(d);
  },
  // часы сервера: несколько «пингов», берём ответ с наименьшей задержкой
  syncClock() {
    Space.rtt = 1e9;
    for (let i = 0; i < 4; i++) setTimeout(() => Calls.send({ type: "sp", op: "time", c: Date.now() }), i * 250);
  },
  onTime(d) {
    const c = +d.c, rtt = Date.now() - c;
    if (!c || rtt < 0 || rtt >= Space.rtt) return;
    Space.rtt = rtt; Space.skew = d.t - (c + rtt / 2) / 1000;
  },

  open(id, opts) { return SpaceRoom.open(id, opts); },

  // ───────────── ссылки ─────────────
  async joinByCode(code) {
    if (!App.user) return;
    try {
      const d = await api("/api/spaces/code/" + encodeURIComponent(code));
      return Space.preview(d.space, code);
    } catch (e) { toast(e.status === 404 ? T("Пространство не найдено или ссылка устарела") : e.message); }
  },
  // карточка пространства: аватар, название, сколько человек, кнопка «Войти»
  preview(s, code) {
    if (s.joined && Space.get(s.id)) return Space.open(s.id);
    const el = document.createElement("div");
    el.className = "sheet2 sp-sheet";
    el.innerHTML = `<div class="s2-card sp-pv" role="dialog">
        <div class="sp-pv-av">${spAvatar(s, "xl")}</div>
        <h3>${esc(s.title)}</h3>
        <div class="sp-pv-meta"><span>${s.kind === "public" ? SPI.globe : SPI.lock}${esc(T(s.kind === "public" ? "Публичное пространство" : "Приватное пространство"))}</span><span>${SPI.users}${esc(T("{0} участн.", s.n))}</span>${s.live ? `<span class="on"><i class="sp-dot"></i>${esc(T("{0} в эфире", s.live))}</span>` : ""}</div>
        ${s.about ? `<p>${esc(s.about)}</p>` : ""}
        ${s.now ? `<div class="sp-pv-now">${SPI.music}<span>${esc(s.now.title)}${s.now.artist ? " — " + esc(s.now.artist) : ""}</span></div>` : ""}
        <div class="s2-btns"><button class="accent" data-go>${esc(T(s.joined ? "Открыть" : "Войти в пространство"))}</button><button class="s2-cancel" data-x>${esc(T("Отмена"))}</button></div></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    const done = () => { el.classList.remove("show"); setTimeout(() => el.remove(), 200); };
    el.addEventListener("click", async (e) => {
      if (e.target === el || e.target.closest("[data-x]")) return done();
      if (!e.target.closest("[data-go]")) return;
      const b = e.target.closest("[data-go]"); b.disabled = true;
      try {
        const d = await api("/api/spaces/join", { method: "POST", body: code ? { code } : { id: s.id } });
        Space.upsert(d.space); Space.paintRail(); done();
        Space.open(d.space.id);
      } catch (er) { b.disabled = false; toast(er.message); }
    });
  },

  // ───────────── обзор публичных пространств ─────────────
  explore() {
    if (Space.exEl) return;
    const el = (Space.exEl = document.createElement("section"));
    el.id = "spexp"; el.className = "page tgp sp-page"; el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<header class="tg-head"><button class="icon-btn" data-back aria-label="${esc(T("Назад"))}">${SPI.back}</button><div class="tg-title">${esc(T("Обзор пространств"))}</div></header>
      <label class="nm-search">${SI.search}<input id="spx-q" placeholder="${esc(T("Название, адрес или ID"))}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <div class="nm-body sp-exp" id="spx-body"></div>`;
    document.body.appendChild(el); void el.offsetWidth;
    Nav.open("spexp", () => { Space.exEl = null; setTimeout(() => el.remove(), 320); });
    const body = el.querySelector("#spx-body"), q = el.querySelector("#spx-q");
    let seq = 0, tm = 0, items = [];
    const draw = () => {
      body.innerHTML = items.length ? items.map((s) => `<button class="sp-row" data-i="${s.id}" type="button"><span class="sp-ra">${spAvatar(s)}</span><span class="sp-rt"><b>${esc(s.title)}</b><small>@${esc(s.slug)} · ${esc(T("{0} участн.", s.n))}${s.live ? " · " + esc(T("{0} в эфире", s.live)) : ""}</small></span>${s.joined ? `<em class="sp-in">${esc(T("Вы здесь"))}</em>` : s.live ? `<i class="sp-dot"></i>` : ""}</button>`).join("")
        : `<div class="nm-empty">${esc(T("Ничего не найдено. Публичные пространства появятся здесь."))}</div>`;
    };
    const go = async () => {
      const n = ++seq;
      try { const d = await api("/api/spaces/explore?q=" + encodeURIComponent(q.value.trim())); if (n === seq) { items = d.spaces || []; draw(); } } catch (e) { if (n === seq) body.innerHTML = `<div class="nm-empty">${esc(e.message)}</div>`; }
    };
    q.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(go, 250); });
    go();
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-back]")) return Nav.back();
      const r = e.target.closest("[data-i]"); if (!r) return;
      const s = items.find((x) => x.id === +r.dataset.i); if (!s) return;
      haptic();
      if (s.joined) { Nav.back(); setTimeout(() => Space.open(s.id), 340); } else Space.preview(Object.assign({}, s, { joined: 0 }));
    });
  },

  // ───────────── создание ─────────────
  n: 0,
  create() {
    const id = "spn" + ++Space.n;
    const st = { title: "", about: "", photo: "", pub: false, slug: "", busy: false, members: [], perms: {} };
    const el = document.createElement("section");
    el.id = id; el.className = "page tgp sp-page"; el.setAttribute("aria-hidden", "true");
    const permRows = () => Object.keys(SP_PERM_NAMES).map((k) => `<button class="nm-act cc-row sp-perm" data-perm="${k}" type="button"><span>${esc(T(SP_PERM_NAMES[k]))}</span><em>${esc(spOptName(st.perms[k] || (k === "control" ? "mod" : k === "tracks" ? (st.pub ? "mod" : "member") : "member")))}</em></button>`).join("");
    el.innerHTML = `<header class="tg-head"><button class="icon-btn" data-back aria-label="${esc(T("Назад"))}">${SPI.back}</button><div class="tg-title">${esc(T("Создать пространство"))}</div></header>
      <div class="nm-body cc-body">
        <div class="sp-hero"><i></i><b>${esc(T("DICEGRAM SPACE"))}</b><span>${esc(T("Постоянная комната: музыка и видео вместе, голос, чат и игры. Она существует всегда — даже когда все вышли."))}</span></div>
        <div class="cc-top">
          <button class="cc-av" data-photo aria-label="${esc(T("Выбрать фотографию"))}"><span class="cc-cam">${ICON.camera}</span></button>
          <div class="cc-name"><input id="${id}-t" maxlength="48" placeholder="${esc(T("Название пространства"))}" autocomplete="off" autocapitalize="sentences" aria-label="${esc(T("Название"))}"></div>
        </div>
        <div class="cc-about"><textarea id="${id}-a" rows="2" maxlength="255" placeholder="${esc(T("Описание (необязательно)"))}"></textarea></div>
        <div class="cc-hint">${esc(T("Название и аватар увидят все, кто откроет пространство."))}</div>
        <div class="cc-seg" role="tablist"><button class="on" data-pub="0" role="tab">${esc(T("Приватное"))}</button><button data-pub="1" role="tab">${esc(T("Публичное"))}</button></div>
        <div class="cc-pubbox" hidden>
          <label class="cc-lnk"><span>${esc(Links.BASE.replace(/^https?:\/\//, ""))}/</span><input id="${id}-s" maxlength="32" placeholder="username" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${esc(T("Адрес"))}"></label>
          <div class="cc-hint cc-sh"></div>
        </div>
        <div class="cc-hint cc-th">${esc(T("Приватное пространство открывается только по ссылке-приглашению или по приглашению участника."))}</div>
        <div class="sp-sec">${esc(T("Участники"))}</div>
        <button class="nm-act cc-row" data-pick type="button">${SPI.users}<span>${esc(T("Пригласить людей"))}</span><em id="${id}-pc">${esc(T("Никого"))}</em></button>
        <div class="sp-sec">${esc(T("Настройки доступа"))}</div>
        <div id="${id}-pr">${permRows()}</div>
        <div class="cc-hint">${esc(T("Владелец всегда может всё. Эти права можно изменить позже в настройках пространства."))}</div>
      </div>
      <button class="fab2 off" data-ok aria-label="${esc(T("Создать"))}">${SI.check}</button>`;
    document.body.appendChild(el); void el.offsetWidth;
    Nav.open(id, () => setTimeout(() => el.remove(), 320));
    const fab = el.querySelector("[data-ok]"), inp = el.querySelector("#" + id + "-t");
    const SLUG = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
    const upd = () => fab.classList.toggle("off", !st.title.trim() || st.busy || (st.pub && !SLUG.test(st.slug)));
    const sh = el.querySelector(".cc-sh"), si = el.querySelector("#" + id + "-s");
    const hint = () => {
      const ok = SLUG.test(st.slug);
      sh.className = "cc-hint cc-sh" + (st.slug && !ok ? " bad" : ok ? " good" : "");
      sh.textContent = ok ? Links.BASE.replace(/^https?:\/\//, "") + "/" + st.slug : st.slug ? T("Адрес: от 5 до 32 символов — латиница, цифры, _. Должен начинаться с буквы") : T("Обязательно: от 5 до 32 символов — латиница, цифры, _. Публичное пространство можно найти и открыть по этому адресу.");
    };
    hint();
    si.addEventListener("input", () => { si.value = si.value.replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 32); st.slug = si.value; hint(); upd(); });
    inp.addEventListener("input", () => { st.title = inp.value; upd(); });
    el.querySelector("#" + id + "-a").addEventListener("input", (e) => { st.about = e.target.value; });
    setTimeout(() => { try { inp.focus(); } catch (e) {} }, 300);
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-back]")) return Nav.back();
      const sg = e.target.closest("[data-pub]");
      if (sg) {
        st.pub = sg.dataset.pub === "1"; haptic();
        el.querySelectorAll("[data-pub]").forEach((b) => b.classList.toggle("on", b === sg));
        el.querySelector(".cc-pubbox").hidden = !st.pub; el.querySelector(".cc-th").hidden = st.pub;
        el.querySelector("#" + id + "-pr").innerHTML = permRows();
        if (st.pub) setTimeout(() => { try { si.focus(); } catch (er) {} }, 60);
        hint(); upd(); return;
      }
      if (e.target.closest("[data-photo]")) {
        const data = await CreateChat.pickPhoto(T("Аватар пространства"));
        if (!data) return;
        st.photo = data; el.querySelector(".cc-av").innerHTML = `<img src="${data}" alt="">`; return;
      }
      const pm = e.target.closest("[data-perm]");
      if (pm) {
        const k = pm.dataset.perm, v = await Space.pickPerm(k, st.perms[k] || (k === "control" ? "mod" : k === "tracks" ? (st.pub ? "mod" : "member") : "member"));
        if (v) { st.perms[k] = v; el.querySelector("#" + id + "-pr").innerHTML = permRows(); }
        return;
      }
      if (e.target.closest("[data-pick]")) {
        const ids = await Space.pickPeople(st.members, T("Пригласить людей"));
        if (ids) { st.members = ids; el.querySelector("#" + id + "-pc").textContent = ids.length ? ids.length + " " + plural(ids.length, T("человек"), T("человека"), T("человек")).replace(/^person$/, ids.length === 1 ? "person" : "people") : T("Никого"); }
        return;
      }
      if (e.target.closest("[data-ok]")) {
        if (st.busy || !st.title.trim()) return;
        if (st.pub && !SLUG.test(st.slug)) { hint(); return toast(T("Укажите адрес: от 5 до 32 символов")); }
        st.busy = true; upd(); haptic("medium");
        try {
          const d = await api("/api/spaces", { method: "POST", body: { title: st.title.trim(), about: st.about.trim(), photo: st.photo || undefined, kind: st.pub ? "public" : "private", slug: st.pub ? st.slug : undefined, members: st.members, perms: st.perms } });
          Space.upsert(d.space); Space.paintRail();
          await Nav.unwindWhile((t) => t.id === "newmsg" || /^spn\d+$/.test(t.id || ""));
          Space.open(d.space.id, { created: true });
        } catch (er) { st.busy = false; upd(); toast(er.message); }
      }
    });
  },
  async pickPerm(k, cur) {
    const v = await UI.sheet({ title: T(SP_PERM_NAMES[k]), text: SP_PERM_HINT[k] ? T(SP_PERM_HINT[k]) : "", cancel: T("Отмена"),
      actions: SP_PERM_OPT.map(([val, n]) => ({ label: (cur === val ? "✓ " : "") + T(n), value: val })) });
    return v || null;
  },
  // выбор людей из контактов (несколько): возвращает массив id или null
  pickPeople(sel, title, exclude) {
    return new Promise((res) => {
      const id = "spp" + ++Space.n, chosen = new Set(sel || []);
      const ex = new Set(exclude || []);
      const el = document.createElement("section");
      el.id = id; el.className = "page tgp sp-page"; el.setAttribute("aria-hidden", "true");
      el.innerHTML = `<header class="tg-head"><button class="icon-btn" data-back aria-label="${esc(T("Назад"))}">${SPI.back}</button><div class="tg-title">${esc(title)}<small id="${id}-n"></small></div></header>
        <label class="nm-search">${SI.search}<input id="${id}-q" placeholder="${esc(T("Поиск среди контактов"))}" autocomplete="off"></label>
        <div class="nm-body sp-pick" id="${id}-b"></div>
        <button class="fab2" data-ok aria-label="${esc(T("Готово"))}">${SI.check}</button>`;
      document.body.appendChild(el); void el.offsetWidth;
      let result = null;
      Nav.open(id, () => { setTimeout(() => el.remove(), 320); res(result); });
      const body = el.querySelector("#" + id + "-b"), q = el.querySelector("#" + id + "-q");
      const draw = () => {
        const s = q.value.trim().toLowerCase();
        const people = Contacts.people().filter((p) => !ex.has(p.id) && (!s || (dispName(p) + " " + (p.username || "")).toLowerCase().includes(s)));
        el.querySelector("#" + id + "-n").textContent = chosen.size ? T("Выбрано: {0}", chosen.size) : "";
        body.innerHTML = people.length ? people.map((p) => `<button class="sp-prow${chosen.has(p.id) ? " on" : ""}" data-id="${p.id}" type="button"><span class="sp-pa">${avatar(p)}</span><span class="sp-pt"><b>${nameHTML(p)}</b><small>${esc(statusText(p))}</small></span><i class="sp-chk">${SPI.check}</i></button>`).join("")
          : `<div class="nm-empty">${esc(T("Контактов пока нет."))}</div>`;
      };
      draw(); Contacts.load().then(draw);
      q.addEventListener("input", draw);
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-back]")) return Nav.back();
        const r = e.target.closest(".sp-prow");
        if (r) { const i = +r.dataset.id; chosen.has(i) ? chosen.delete(i) : chosen.add(i); haptic(); return draw(); }
        if (e.target.closest("[data-ok]")) { result = [...chosen]; Nav.back(); }
      });
    });
  },
};
