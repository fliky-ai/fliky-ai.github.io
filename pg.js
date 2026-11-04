// pg.js — каркас внутренних экранов настроек (как в Telegram): страница с заголовком и кнопкой «назад»,
// строки с цветными значками, переключатели, ползунки, выбор из списка. Страницы открываются поверх друг друга
// и закрываются кнопкой «назад» (Nav).
const SI = {
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  chat: svg('<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z"/>'),
  lock: svg('<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  bell: svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
  data: svg('<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
  battery: svg('<rect x="2" y="7" width="17" height="10" rx="2.5"/><path d="M22 11v2"/><path d="M6 10v4"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  laptop: svg('<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 20h20"/>'),
  phone2: svg('<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>'),
  globe: PI.globe,
  star: svg('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
  starF: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.500 9.400l6.600-.9z"/></svg>',
  bag: svg('<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>'),
  gift: PI.gift,
  help: svg('<circle cx="12" cy="12" r="9.5"/><path d="M9.5 9.2a2.6 2.6 0 1 1 3.7 2.4c-.8.4-1.2 1-1.2 1.9"/><path d="M12 17h.01"/>'),
  bulb: svg('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>'),
  headset: svg('<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/><path d="M19 20c0 1.500-2 2-5 2"/>'),
  doc: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  palette: svg('<path d="M12 3a9 9 0 1 0 0 18c1.200 0 1.800-.9 1.500-2-.3-1 .3-2 1.500-2H17a4 4 0 0 0 4-4c0-5-4-10-9-10z"/><circle cx="7.500" cy="11" r="1"/><circle cx="10.500" cy="7" r="1"/><circle cx="15.500" cy="7.500" r="1"/>'),
  aa: svg('<path d="M3 19 8 6l5 13M5 14.500h6"/><path d="M15 19l3-8 3 8M16 16.500h4"/>'),
  moon: ICON.moon,
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.900 4.900l1.400 1.400M17.700 17.700l1.400 1.400M2 12h2M20 12h2M4.900 19.100l1.400-1.400M17.700 6.300l1.400-1.400"/>'),
  compass: svg('<circle cx="12" cy="12" r="9.500"/><path d="m15.500 8.500-2 5-5 2 2-5z"/>'),
  smile: svg('<circle cx="12" cy="12" r="9.500"/><path d="M8 14a4.500 4.500 0 0 0 8 0"/><path d="M9 9.500h.01M15 9.500h.01"/>'),
  mic: svg('<rect x="9" y="2.500" width="6" height="11.500" rx="3"/><path d="M5.500 11.500a6.500 6.500 0 0 0 13 0"/><path d="M12 18v3.500"/>'),
  image: PI.gallery,
  key: svg('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3M14 9l2 2"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2.500"/><path d="m3.500 7 8.500 6 8.500-6"/>'),
  timer: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.500 2M9 2h6"/>'),
  eye: PI.eye,
  call: PI.phone,
  fwd: svg('<path d="m15 4 6 5-6 5v-3c-5 0-8 1.500-10 6 .5-6 4-9 10-9z"/>'),
  clock: PI.clock,
  shield: ICON.shield,
  trash: ICON.trash,
  wifi: svg('<path d="M2 9a15 15 0 0 1 20 0M5.500 12.500a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><path d="M12 20h.01"/>'),
  stats: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  link: svg('<path d="M10 14a4.500 4.500 0 0 0 6.400 0l3-3a4.500 4.500 0 0 0-6.400-6.400l-1 1"/><path d="M14 10a4.500 4.500 0 0 0-6.400 0l-3 3a4.500 4.500 0 0 0 6.400 6.400l1-1"/>'),
  edit: ICON.edit,
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.500-3.500"/>'),
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.800"/><circle cx="12" cy="12" r="1.800"/><circle cx="12" cy="19" r="1.800"/></svg>',
  bot: svg('<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M9 13.500h.01M15 13.500h.01M9.500 17h5"/>'),
  pin: svg('<path d="M12 21s7-6.100 7-11.500A7 7 0 0 0 5 9.500C5 14.900 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.500"/>'),
  reply: svg('<path d="M3 5h18v11H9l-5 4z"/>'),
  info: svg('<circle cx="12" cy="12" r="9.500"/><path d="M12 11v6M12 7.500h.01"/>'),
  out: ICON.out,
  plus: PI.plus,
  userPlus: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.500" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/>'),
  check: PI.check,
  chev: PI.chev,
  back: PI.back,
  x: PI.close,
  up: svg('<path d="m6 15 6-6 6 6"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  shuffle: svg('<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>'),
  cursor: svg('<path d="m5 3 14 8-6 1.500L10.500 19z"/>'),
  film: svg('<rect x="3" y="4" width="18" height="16" rx="2.500"/><path d="M3 9h18M3 15h18M8 4v16M16 4v16"/>'),
  vol: PI.vol,
  rocket: svg('<path d="M5 15c-1.500 1.300-2 5-2 5s3.700-.5 5-2a2.700 2.700 0 0 0-3-3z"/><path d="m12 15-3-3a22 22 0 0 1 2-4 12 12 0 0 1 11-5c0 3-1 8-5 11a22 22 0 0 1-5 1z"/><path d="M9 12H4s.5-3 2-4c1.500-.8 5 0 5 0M12 15v5s3-.5 4-2c.8-1.500 0-5 0-5"/>'),
  vid: svg('<rect x="2" y="6" width="14" height="12" rx="2.500"/><path d="m16 10 6-3v10l-6-3z"/>'),
  zap: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  smile2: svg('<circle cx="12" cy="12" r="9.500"/><path d="M8 14a4.500 4.500 0 0 0 8 0"/><path d="M9 9.500h.01M15 9.500h.01"/>'),
  heart: svg('<path d="M12 21s-8-5.500-8-11a4.500 4.500 0 0 1 8-2.800A4.500 4.500 0 0 1 20 10c0 5.500-8 11-8 11z"/>'),
  layers: svg('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
};

const Pg = {
  n: 0,
  // pg = Pg.open({title, build(pg), right, onClose, cls})
  open(o) {
    const id = "pg" + ++Pg.n;
    const el = document.createElement("section");
    el.id = id; el.className = "page spg " + (o.cls || ""); el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<header class="phead"><button class="icon-btn" data-back="1" aria-label="${esc(T("Назад"))}">${SI.back.replace("<svg ", '<svg width="22" height="22" ')}</button>
      <div class="ptitle"></div><div class="hacts">${o.right || ""}</div></header><div class="scroll spg-body"></div>`;
    document.body.appendChild(el);
    el.style.zIndex = 20 + Nav.stack.length;
    const pg = {
      id, el, o, on: {}, body: el.querySelector(".spg-body"), alive: true, data: o.data || {},
      title(t) { el.querySelector(".ptitle").textContent = t; },
      set(html) { const y = pg.body.scrollTop; pg.body.innerHTML = html; pg.body.scrollTop = y; },
      refresh() { if (pg.alive && o.build) { o.build(pg); } },
      close() { if (Nav.stack.length && Nav.stack[Nav.stack.length - 1].id === id) Nav.back(); },
      $(s) { return el.querySelector(s); },
    };
    pg.title(o.title || "");
    el.addEventListener("click", (e) => Pg.click(pg, e));
    el.addEventListener("input", (e) => {
      const r = e.target.closest("input[data-s]");
      if (r) { Pg.fill(r); const f = pg.on[r.dataset.s]; if (f) f(+r.value, r, e); }
      else { const f = e.target.dataset.i && pg.on[e.target.dataset.i]; if (f) f(e.target.value, e.target, e); }
    });
    el.addEventListener("change", (e) => { const f = e.target.dataset.c && pg.on[e.target.dataset.c]; if (f) f(e.target.value, e.target, e); });
    if (o.build) o.build(pg);
    void el.offsetWidth;
    Nav.open(id, () => {
      pg.alive = false;
      try { o.onClose && o.onClose(pg); } catch (e) {}
      setTimeout(() => el.remove(), 320);
    });
    return pg;
  },

  click(pg, e) {
    if (e.target.closest("[data-back]")) return pg.close();
    const el = e.target.closest("[data-a]");
    if (!el || el.disabled || el.classList.contains("dis")) return;
    const sw = el.querySelector(".sw");
    let arg = el;
    if (sw) { const on = !sw.classList.contains("on"); sw.classList.toggle("on", on); el.setAttribute("aria-checked", on); el.dataset.on = on ? "1" : "0"; arg = on; }
    const f = pg.on[el.dataset.a];
    if (f) f(arg, el, e);
  },

  // заполнение дорожки ползунка
  fill(r) { const mn = +r.min || 0, mx = +r.max || 100; r.style.setProperty("--p", ((+r.value - mn) / (mx - mn)) * 100 + "%"); },
};

// ── готовые куски разметки ──
const R = {
  // значок в цветном квадрате; c — класс цвета
  ic: (c, icon) => `<i class="ic ${c}">${icon}</i>`,
  // строка: a — действие, v — значение, ic/c — значок, t — заголовок, s — подпись, r — значение справа, sw — переключатель (on = состояние)
  row(o) {
    const cls = ["irow"];
    if (o.dis) cls.push("dis");
    if (o.danger) cls.push("rd");
    if (o.cls) cls.push(o.cls);
    const sw = o.sw !== undefined;
    const right = (o.r !== undefined && o.r !== "" ? `<em class="irow-v">${o.r}</em>` : "") + (o.rr ? `<em class="irow-r">${o.rr}</em>` : "") + (o.soon ? `<em class="soon sm">${esc(T("скоро"))}</em>` : "") +
      (sw ? `<span class="sw${o.on ? " on" : ""}"><i></i></span>` : "") + (o.chev !== false && !sw && !o.soon && !o.noch ? `<svg class="irow-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>` : "");
    const inner = `${o.ic ? R.ic(o.c || "b", o.ic) : ""}<span class="tx"><b>${o.t}</b>${o.s ? `<small>${o.s}</small>` : ""}</span>${right}`;
    const tag = o.a ? "button" : "div";
    return `<${tag} class="${cls.join(" ")}"${o.a ? ` data-a="${o.a}"` : ""}${o.v !== undefined ? ` data-v="${esc(o.v)}"` : ""}${sw ? ` role="switch" aria-checked="${!!o.on}"` : ""}${o.id ? ` id="${o.id}"` : ""}>${inner}</${tag}>`;
  },
  card: (...rows) => `<div class="card2 irows">${rows.join("")}</div>`,
  lbl: (t) => `<div class="ed-lbl">${t}</div>`,
  hint: (t) => `<div class="ed-hint">${t}</div>`,
  gap: () => `<div class="gap-s"></div>`,
  // выбор одного варианта: list = [{v, t, s}], cur — выбранное, a — действие
  opts(list, cur, a) {
    return R.card(...list.map((x) => `<button class="irow opt${String(x.v) === String(cur) ? " on" : ""}" data-a="${a}" data-v="${esc(x.v)}"><span class="tx"><b>${x.t}</b>${x.s ? `<small>${x.s}</small>` : ""}</span>${SI.check}</button>`));
  },
  range(o) {
    const mn = o.min ?? 0, mx = o.max ?? 100, p = ((o.val - mn) / (mx - mn)) * 100;
    return `<input type="range" class="rng" data-s="${o.s}" min="${mn}" max="${mx}" step="${o.step || 1}" value="${o.val}" style="--p:${p}%" aria-label="${esc(o.label || "")}">`;
  },
  btn: (t, a, cls = "") => `<button class="pbtn ${cls}" data-a="${a}">${t}</button>`,
  hero(icon, title, text, cls = "") {
    return `<div class="hero ${cls}"><div class="hero-ic">${icon}</div>${title ? `<h2>${title}</h2>` : ""}${text ? `<p>${text}</p>` : ""}</div>`;
  },
};
