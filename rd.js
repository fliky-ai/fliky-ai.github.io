// rd.js — поведение нового интерфейса DICEGRAM (ноябрь 2026): плавающая нижняя панель с «ползунком», сворачивающиеся большие заголовки,
// фильтр чатов, меню «+» в контактах, алфавитная линейка, зум аватарки в профиле по прокрутке и по оттягиванию вниз.
// Всё держится на transform/opacity и на одном rAF-обработчике прокрутки на экран — без перерисовки списков и без дрожания.
// Файл самостоятельный: если он не загрузится, приложение работает как раньше (только без новых эффектов).
const DX = (() => {
  const $ = (id) => document.getElementById(id);
  const raf = (f) => requestAnimationFrame(f);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sm = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const hap = () => { try { haptic(); } catch (e) {} };
  const ic = (p, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const I = {
    search: ic('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    filter: ic('<path d="M4 7h9M18 7h2M4 17h3M12 17h8"/><circle cx="15.5" cy="7" r="2.3"/><circle cx="9.5" cy="17" r="2.3"/>'),
    pen: ic('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', 2.1),
    dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>',
    plus: ic('<path d="M12 5v14M5 12h14"/>', 2.2),
    userPlus: ic('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>'),
    share: ic('<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>'),
    userSearch: ic('<circle cx="10" cy="8" r="4"/><path d="M2.5 20.5a7.5 7.5 0 0 1 11-6.6"/><circle cx="17.5" cy="17.5" r="3.2"/><path d="m20 20 2 2"/>'),
    check: ic('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 3),
    chev: ic('<path d="m9 6 6 6-6 6"/>', 2.2),
    out: ic('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
    camera: ic('<path d="M3 8a2 2 0 0 1 2-2h2.2l1.4-2h6.8l1.4 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.8"/>'),
    edit: ic('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    gear: ic('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l-.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/></svg>',
    diamond: ic('<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20M9 3l3 6 3-6M12 21 9 9M12 21l3-12"/>', 1.9),
    bolt: ic('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
    cup: ic('<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'),
    clock: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    trophy: ic('<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'),
    refresh: ic('<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>'),
  };

  // ───────────── нижняя панель: «ползунок» под активной вкладкой ─────────────
  function dock() {
    const bar = document.querySelector(".tabbar"); if (!bar) return;
    const tabs = [...bar.querySelectorAll(".tab")];
    const sync = () => {
      const i = Math.max(0, tabs.findIndex((t) => t.classList.contains("active")));
      bar.style.setProperty("--ti", i);
    };
    sync();
    try { new MutationObserver(sync).observe(bar, { subtree: true, attributes: true, attributeFilter: ["class"] }); } catch (e) {}
  }

  // ───────────── сворачивающаяся шапка «Чаты» / «Контакты» ─────────────
  // Шапка лежит поверх списка и уезжает вверх вместе с ним; верхняя строка с кнопками остаётся на месте и «проявляет» фон.
  function collapse(viewId, listId) {
    const view = $(viewId), list = $(listId); if (!view || !list) return;
    const head = view.querySelector(".tgh"); if (!head) return;
    const big = head.querySelector(".dx-big"), sr = head.querySelector(".dx-sr");
    let dy = 100, last = -1, tick = false, col = false;
    const paint = (force) => {
      tick = false;
      const st = Math.max(0, list.scrollTop), v = Math.min(st, dy);
      if (!force && v === last) return;
      last = v;
      const c = dy ? v / dy : 0;
      head.style.setProperty("--hs", v.toFixed(1));
      head.style.setProperty("--cl", c.toFixed(3));
      const mb = $("mbar"); if (mb && mb.parentNode === view) mb.style.setProperty("--hs", v.toFixed(1));   // плеер под шапкой едет вместе с ней
      const on = c > 0.6;
      if (on !== col) { col = on; view.classList.toggle("dx-col", on); }
    };
    const measure = () => {
      const h = head.offsetHeight; if (!h) return;
      dy = (big ? big.offsetHeight : 0) + (sr ? sr.offsetHeight : 0);
      view.style.setProperty("--hh", h + "px");
      paint(true);
    };
    list.addEventListener("scroll", () => { if (!tick) { tick = true; raf(() => paint()); } }, { passive: true });
    if ("ResizeObserver" in window) new ResizeObserver(measure).observe(head); else window.addEventListener("resize", measure);
    measure();
    view._dxm = measure;
  }

  // Липкая верхняя панель внутри прокручиваемого блока (Настройки): заголовок сворачивается за ~50 px прокрутки
  function top(box, sel, dy) {
    if (!box) return;
    const S = box._dxt || (box._dxt = { els: [], dy: 50, last: -1, tick: false });
    S.els = [...box.querySelectorAll(sel)]; S.dy = dy || 50; S.last = -1;
    const paint = () => {
      S.tick = false;
      const c = clamp(box.scrollTop / S.dy, 0, 1);
      if (c === S.last) return;
      S.last = c;
      for (const e of S.els) e.style.setProperty("--cl", c.toFixed(3));
    };
    if (!S.bound) { S.bound = true; box.addEventListener("scroll", () => { if (!S.tick) { S.tick = true; raf(paint); } }, { passive: true }); }
    paint();
  }

  // ───────────── плавное появление первых строк ─────────────
  function enter(box, sel, n = 11) {
    if (!box || box._dxIn) return;
    const rows = [...box.querySelectorAll(sel)].slice(0, n);
    if (!rows.length) return;
    box._dxIn = true;
    if (document.documentElement.classList.contains("eco-anim")) return;
    rows.forEach((r, i) => {
      r.style.setProperty("--i", i);
      r.classList.add("dx-in");
      r.addEventListener("animationend", () => { r.classList.remove("dx-in"); r.style.removeProperty("--i"); }, { once: true });
    });
  }

  // ───────────── фильтр чатов ─────────────
  const KF = [["all", "Все чаты"], ["unread", "Непрочитанные"], ["personal", "Личные"], ["groups", "Группы"], ["channels", "Каналы"]];
  function syncFilter() {
    const b = $("btn-filter"); if (!b) return;
    b.classList.toggle("on", !!Chats.kf && Chats.kf !== "all");
    const s = $("chat-sbar") && $("chat-sbar").querySelector("span");
    if (s) { const k = KF.find((x) => x[0] === Chats.kf); s.textContent = k && k[0] !== "all" ? T(k[1]) : T("Поиск"); }
  }
  async function filter() {
    const cur = Chats.kf || "all";
    const v = await UI.sheet({ title: T("Фильтр чатов"), actions: KF.map(([k, t]) => ({ label: T(t) + (k === cur ? "  ✓" : ""), value: k, accent: k === cur })), cancel: T("Отмена") });
    if (!v) return;
    Chats.kf = v; Chats.render(); syncFilter();
    const l = $("chat-list"); if (l) l.scrollTop = 0;
  }

  // ───────────── контакты: «+» с меню и «⋮» ─────────────
  function inviteFriend() {
    const site = /^https?:/.test(location.origin) ? location.origin + "/" : "https://dicegram.dpdns.org/";
    const text = T("Я в Dicegram — заходи, будем на связи");
    (async () => {
      try { if (navigator.share) { await navigator.share({ title: "Dicegram", text, url: site }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
      try { copyText(text + " " + site); toast(T("Ссылка скопирована")); } catch (e) { toast(site); }
    })();
  }
  const ACTS = {
    add: () => AddContact.open(),
    invite: () => inviteFriend(),
    find: () => Search.open(),
  };
  function fab() {
    const f = $("contact-fab"), view = $("v-contacts"); if (!f || !view || f._dx) return;
    f._dx = 1;
    const scrim = document.createElement("div"); scrim.className = "dx-scrim";
    const menu = document.createElement("div"); menu.className = "dx-menu"; menu.setAttribute("role", "menu");
    const items = [["add", I.userPlus, "Добавить контакт"], ["invite", I.share, "Пригласить друга"], ["find", I.userSearch, "Найти пользователя"]];
    menu.innerHTML = items.map(([k, ico, t], i) => `<button class="dx-mi" data-k="${k}" style="--i:${i}" role="menuitem"><b>${esc(T(t))}</b><i>${ico}</i></button>`).join("");
    view.appendChild(scrim); view.appendChild(menu);
    const set = (on) => { f.classList.toggle("open", on); scrim.classList.toggle("show", on); menu.classList.toggle("show", on); f.setAttribute("aria-expanded", on ? "true" : "false"); };
    const isOpen = () => menu.classList.contains("show");
    // capture: наш обработчик идёт раньше прежнего f.onclick и забирает нажатие себе
    f.addEventListener("click", (e) => { e.stopImmediatePropagation(); e.preventDefault(); hap(); set(!isOpen()); }, true);
    scrim.addEventListener("click", () => set(false));
    menu.addEventListener("click", (e) => {
      const b = e.target.closest(".dx-mi"); if (!b) return;
      hap(); set(false);
      setTimeout(() => { try { ACTS[b.dataset.k](); } catch (er) { try { console.error(er); } catch (e2) {} } }, 120);
    });
    document.addEventListener("click", (e) => { if (isOpen() && !e.target.closest("#contact-fab,.dx-menu")) set(false); }, true);
    view._dxClose = () => set(false);
  }
  async function cmenu() {
    const v = await UI.sheet({ title: T("Контакты"), actions: [
      { label: T("Добавить контакт"), value: "add" }, { label: T("Пригласить друга"), value: "invite" }, { label: T("Найти пользователя"), value: "find" },
      { label: T("Обновить список"), value: "refresh" }], cancel: T("Отмена") });
    if (v === "refresh") { try { await Contacts.load(true); toast(T("Список обновлён")); } catch (e) {} }
    else if (ACTS[v]) ACTS[v]();
  }

  // ───────────── алфавитная линейка ─────────────
  // Лежит не внутри прокручиваемого списка, а рядом с ним — поэтому не уезжает. Буквы, которые не помещаются, прореживаются,
  // а палец при этом по-прежнему «видит» весь алфавит: положение пальца переводится в номер буквы по всей высоте линейки.
  function scrub(box, off) {
    const par = box.parentElement; if (!par) return;
    if (box._dxIdx) { box._dxIdx.ro && box._dxIdx.ro.disconnect(); box._dxIdx.cleanup(); box._dxIdx = null; }
    if (off) return;
    const old = box.querySelector(".nm-idx"); if (old) old.remove();
    const secs = [...box.querySelectorAll(".nm-sect")];
    if (secs.length < 6) return;
    const ls = secs.map((s) => s.dataset.l), n = ls.length;
    if (getComputedStyle(par).position === "static") par.style.position = "relative";
    if (getComputedStyle(box).position === "static") box.style.position = "relative";
    const idx = document.createElement("div"); idx.className = "nm-idx dx-idx"; idx.setAttribute("aria-hidden", "true");
    const bub = document.createElement("div"); bub.className = "nm-bub";
    par.appendChild(idx); par.appendChild(bub);
    const pinH = () => parseFloat(getComputedStyle(secs[0]).top) || 0;
    const pos = [];
    let shown = [], cur = -1, drag = false, tick = false;
    const meas = () => { secs.forEach((s, i) => { const f = s.nextElementSibling; pos[i] = f ? f.offsetTop - s.offsetHeight : s.offsetTop; }); };
    const build = () => {
      const avail = idx.clientHeight - 8, max = Math.max(5, Math.floor(avail / 15));
      shown = [];
      if (n <= max) for (let i = 0; i < n; i++) shown.push(i);
      else for (let k = 0; k < max; k++) { const i = Math.round((k * (n - 1)) / (max - 1)); if (shown[shown.length - 1] !== i) shown.push(i); }
      idx.innerHTML = shown.map((i, k) => `<span data-k="${k}">${esc(ls[i])}</span>`).join("");
      mark(cur, true);
    };
    const lay = () => {
      const pr = par.getBoundingClientRect(), br = box.getBoundingClientRect(); if (!br.height) return;
      const cs = getComputedStyle(box);
      const pt = box.id === "contact-list" ? (parseFloat(getComputedStyle(par).getPropertyValue("--hh")) || 0) : (parseFloat(cs.paddingTop) || 0);
      idx.style.top = (br.top - pr.top + pt + 6) + "px";
      idx.style.bottom = (pr.bottom - br.bottom + (parseFloat(cs.paddingBottom) || 0) + (box.id === "contact-list" ? 70 : 6)) + "px";     // над кнопкой «+»
      meas(); build();
    };
    const mark = (i, force) => {
      if (i === cur && !force) return;
      cur = i;
      let k = -1;
      for (let j = 0; j < shown.length; j++) if (shown[j] <= i) k = j;
      idx.querySelectorAll("span.on").forEach((s) => s.classList.remove("on"));
      const el = k >= 0 && idx.children[k]; if (el) el.classList.add("on");
    };
    const here = () => {
      tick = false;
      const st = box.scrollTop + pinH() + 2;
      let i = 0; for (let j = 0; j < n; j++) if (pos[j] <= st) i = j;
      mark(i);
    };
    const onScroll = () => { if (!tick && !drag) { tick = true; raf(here); } };
    const goAt = (y) => {
      const r = idx.getBoundingClientRect();
      const f = clamp((y - r.top - 4) / Math.max(1, r.height - 8), 0, 1);
      const i = Math.round(f * (n - 1));
      if (i !== cur) hap();
      box.scrollTop = i === 0 ? 0 : Math.max(0, pos[i] - pinH());
      mark(i);
      const pr = par.getBoundingClientRect();
      bub.textContent = ls[i]; bub.style.top = clamp(y - pr.top, 40, pr.height - 40) + "px";
    };
    const down = (e) => { drag = true; idx.classList.add("drag"); bub.classList.add("show"); try { idx.setPointerCapture(e.pointerId); } catch (er) {} goAt(e.clientY); e.preventDefault(); };
    const move = (e) => { if (drag) { goAt(e.clientY); e.preventDefault(); } };
    const up = () => { if (!drag) return; drag = false; idx.classList.remove("drag"); bub.classList.remove("show"); here(); };
    idx.addEventListener("pointerdown", down); idx.addEventListener("pointermove", move);
    idx.addEventListener("pointerup", up); idx.addEventListener("pointercancel", up); idx.addEventListener("lostpointercapture", up);
    box.addEventListener("scroll", onScroll, { passive: true });
    const idxo = { cleanup() { idx.remove(); bub.remove(); box.removeEventListener("scroll", onScroll); }, ro: null };
    if ("ResizeObserver" in window) { idxo.ro = new ResizeObserver(() => { raf(lay); }); idxo.ro.observe(box); }
    box._dxIdx = idxo; box._dxLay = lay;
    lay(); here();
  }

  // ───────────── профиль: зум аватарки по прокрутке и по оттягиванию вниз ─────────────
  // p = scrollTop − оттяжка. p < 0 (тянем вниз на самом верху) — аватарка плавно растёт, имя и содержимое «подстраиваются»,
  // p > 0 (листаем вниз) — аватарка уменьшается и гаснет, а имя переезжает в верхнюю панель. Без скачков: всё считается из одного числа.
  function profile(box) {
    const S = box._dxp || (box._dxp = { q: 0, base: null, tick: false });
    const root = box.querySelector(".dx-prof"); if (!root) { S.root = null; return; }
    S.root = root;
    S.cover = root.querySelector(".dx-cover"); S.av = root.querySelector("#pf-av"); S.flow = root.querySelector(".dx-flow");
    S.bar = root.querySelector(".dx-bar"); S.nm = root.querySelector(".dx-name h2");
    const Q = 160, MAXG = 0.8;
    const paint = () => {
      S.tick = false;
      if (!S.root || !S.root.isConnected) return;
      const st = Math.max(0, box.scrollTop), pull = S.q / Q;
      const grow = pull * MAXG;
      const sh = sm(st / 170);
      const sc = (1 + grow) * (1 - 0.5 * sh);
      const dyp = 108 * grow;
      const ao = 1 - sm((st - 30) / 120);
      if (S.av) { S.av.style.transform = `translate3d(0,${(st * 0.42).toFixed(1)}px,0) scale(${sc.toFixed(3)})`; S.av.style.opacity = ao.toFixed(3); }
      if (S.flow) S.flow.style.transform = dyp > 0.2 ? `translate3d(0,${dyp.toFixed(1)}px,0)` : "";
      if (S.cover) S.cover.style.setProperty("--pl", dyp.toFixed(1));
      if (S.nm) S.nm.style.transform = pull > 0.01 ? `scale(${(1 + pull * 0.1).toFixed(3)})` : "";
      if (S.bar) S.bar.style.setProperty("--cl", sm((st - 112) / 56).toFixed(3));
    };
    const sched = () => { if (!S.tick) { S.tick = true; raf(paint); } };
    S.paint = paint;
    if (!S.bound) {
      S.bound = true;
      box.addEventListener("scroll", sched, { passive: true });
      box.addEventListener("touchstart", (e) => { if (e.touches.length !== 1) return; S.base = null; if (S.root) S.root.classList.remove("dx-rel"); }, { passive: true });
      box.addEventListener("touchmove", (e) => {
        if (!S.root || e.touches.length !== 1) return;
        const y = e.touches[0].clientY;
        if (box.scrollTop <= 0) {
          S.base = S.base == null ? y : Math.min(S.base, y);
          const d = y - S.base;
          S.q = d > 0 ? Q * (1 - Math.exp(-d / (Q * 1.15))) : 0;
        } else { S.base = null; S.q = 0; }
        sched();
      }, { passive: true });
      const end = () => {
        S.base = null;
        if (S.q <= 0.5) { S.q = 0; return; }
        S.q = 0;
        if (S.root) { S.root.classList.add("dx-rel"); clearTimeout(S.relT); S.relT = setTimeout(() => S.root && S.root.classList.remove("dx-rel"), 620); }
        sched();
      };
      box.addEventListener("touchend", end, { passive: true });
      box.addEventListener("touchcancel", end, { passive: true });
    }
    paint();
  }

  // ───────────── общая инициализация ─────────────
  function init() {
    const safe = (f) => { try { f(); } catch (e) { try { console.error("rd.js", e); } catch (e2) {} } };
    safe(dock);
    safe(() => collapse("v-chats", "chat-list"));
    safe(() => collapse("v-contacts", "contact-list"));
    safe(fab);
    const on = (id, f) => { const b = $(id); if (b && !b._dx) { b._dx = 1; b.addEventListener("click", f); } };
    on("btn-new", () => { hap(); try { NewMsg.open(); } catch (e) {} });
    on("btn-filter", (e) => { e.stopPropagation(); hap(); filter(); });
    on("btn-cmenu", () => { hap(); cmenu(); });
    safe(syncFilter);
  }
  function onTab(tab) {
    const cv = $("v-contacts"); if (cv && cv._dxClose && tab !== "contacts") cv._dxClose();
    raf(() => {
      const v = $("v-" + tab); if (v && v._dxm) v._dxm();
      const cl = $("contact-list"); if (tab === "contacts" && cl && cl._dxLay) cl._dxLay();
      if (tab === "profile") { const b = $("profile-box"); if (b && b._dxp && b._dxp.paint) b._dxp.paint(); }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  return { I, ic, dock, collapse, top, enter, filter, syncFilter, fab, cmenu, scrub, profile, onTab, inviteFriend, init };
})();
