// prefs.js — настройки этого устройства (тема, цвет, обои, размер текста…), энергосбережение, счётчик трафика
// и настройки, которые синхронизируются с сервером (папки, уведомления через бота).
const Prefs = {
  // на устройстве
  get(k, d) { try { const v = localStorage.getItem("pf_" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("pf_" + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem("pf_" + k); } catch (e) {} },
  // в облаке (аккаунт): App.user.prefs
  cloud(k, d) { const p = (App.user && App.user.prefs) || {}; return p[k] === undefined ? d : p[k]; },
  async cloudSet(k, v) {
    const before = (App.user.prefs || {})[k];
    App.user.prefs = Object.assign({}, App.user.prefs, { [k]: v });
    if (v === null) delete App.user.prefs[k];
    try { const d = await api("/api/prefs", { method: "POST", body: { set: { [k]: v } } }); App.user.prefs = d.prefs; }
    catch (e) { App.user.prefs[k] = before; if (before === undefined) delete App.user.prefs[k]; toast(e.message); throw e; }
  },
};

// ───────────── тема, цвет, размер текста, скругление ─────────────
const ACCENTS = [
  { k: "blue", n: "Синий", c: "#4F9BFF" }, { k: "cyan", n: "Бирюзовый", c: "#2FB7D9" }, { k: "green", n: "Зелёный", c: "#3DB971" },
  { k: "orange", n: "Оранжевый", c: "#F28C2E" }, { k: "pink", n: "Розовый", c: "#E9569B" }, { k: "violet", n: "Фиолетовый", c: "#8F6BF5" },
  { k: "red", n: "Красный", c: "#EE5A5A" },
];

const Theme = {
  timer: null,
  get() { try { return localStorage.getItem("theme") || "auto"; } catch (e) { return "auto"; } },     // auto | light | dark
  set(t) { try { localStorage.setItem("theme", t); } catch (e) {} Theme.apply(true); },
  night() { return Prefs.get("night", "off"); },                                                        // off | sched | auto
  setNight(n) { Prefs.set("night", n); Theme.apply(true); },
  sched() { return { from: Prefs.get("night_from", "21:00"), to: Prefs.get("night_to", "07:00") }; },
  inSched() {
    const s = Theme.sched(), m = (v) => { const [h, mi] = v.split(":").map(Number); return h * 60 + mi; };
    const n = new Date(), now = n.getHours() * 60 + n.getMinutes(), a = m(s.from), b = m(s.to);
    return a === b ? false : a < b ? now >= a && now < b : now >= a || now < b;
  },
  // что реально показываем сейчас: light / dark
  resolve() {
    const night = Theme.night();
    if (night === "sched") return Theme.inSched() ? "dark" : "light";
    if (night === "auto") return matchMedia("(prefers-color-scheme:light)").matches ? "light" : "dark";
    const t = Theme.get();
    return t === "auto" ? (matchMedia("(prefers-color-scheme:light)").matches ? "light" : "dark") : t;
  },
  apply(animate) {
    const h = document.documentElement;
    if (animate && !Energy.is("anim")) { h.classList.add("theming"); setTimeout(() => h.classList.remove("theming"), 320); }
    h.dataset.theme = Theme.resolve();
    h.dataset.acc = Prefs.get("acc", "blue");
    h.style.setProperty("--fsk", String(Theme.fs() / 16 * ((window.LITE && LITE.txt) || 1)));
    h.style.setProperty("--br", Theme.br() + "px");
    Wall.apply();
    Theme.tg();
  },
  fs() { const v = +Prefs.get("fs", 16); return v >= 12 && v <= 26 ? v : 16; },
  br() { const v = +Prefs.get("br", 18); return v >= 0 && v <= 22 ? v : 18; },
  tg() {
    try {
      const c = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
      const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = c;
      TGW.setHeaderColor(c); TGW.setBackgroundColor(c);
    } catch (e) {}
  },
  init() {
    Theme.apply(false);
    try { matchMedia("(prefers-color-scheme:light)").addEventListener("change", () => Theme.apply(true)); } catch (e) {}
    clearInterval(Theme.timer);
    Theme.timer = setInterval(() => { if (Theme.night() === "sched") { const r = Theme.resolve(); if (r !== document.documentElement.dataset.theme) Theme.apply(true); } }, 30000);
  },
};

// ───────────── обои чата ─────────────
// c — цвета градиента (светлая / тёмная тема), a — угол
const WALLS = [
  { k: "def", n: "Как в теме", l: ["#DCEBFA", "#E6F1E4", "#F3EBD8"], d: ["#0F1822", "#101A26", "#0E1620"] },
  { k: "sky", n: "Небо", l: ["#BFE0FF", "#DDEBFF", "#F2F7FF"], d: ["#0B2540", "#123A66", "#0E2C4F"], a: 170 },
  { k: "mint", n: "Мята", l: ["#C9F1DD", "#E4F7EC", "#F5FBF7"], d: ["#0B2B22", "#124236", "#0F3329"], a: 160 },
  { k: "sunset", n: "Закат", l: ["#FFD9B8", "#FFC6C6", "#E8D2FF"], d: ["#3A1F2E", "#4B2437", "#2A1B3F"], a: 155 },
  { k: "lav", n: "Лаванда", l: ["#E3D9FF", "#F0E8FF", "#FBF8FF"], d: ["#221A3F", "#2D2354", "#1D1736"], a: 165 },
  { k: "forest", n: "Лес", l: ["#CFE6C4", "#E3F0D6", "#F4F8E8"], d: ["#10261A", "#183823", "#0E2016"], a: 150 },
  { k: "sea", n: "Море", l: ["#BEEAF0", "#D3F2F5", "#EAF9FA"], d: ["#0A2A33", "#10404C", "#0B323C"], a: 175 },
  { k: "rose", n: "Роза", l: ["#FFD1E3", "#FFE3EE", "#FFF4F8"], d: ["#3A1626", "#4F1E35", "#2E1220"], a: 160 },
  { k: "sand", n: "Песок", l: ["#F2E3C6", "#F7EEDB", "#FBF7EC"], d: ["#2B2417", "#3A311F", "#251F13"], a: 160 },
  { k: "graphite", n: "Графит", l: ["#D5DAE2", "#E3E7EE", "#F1F3F7"], d: ["#12151A", "#1A1F27", "#0F1216"], a: 165 },
  { k: "plain", n: "Однотонный", plain: true },
];
const doodle = (c) => {
  const s = `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240' fill='none' stroke='${c}' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'>` +
    `<circle cx='30' cy='34' r='9'/><path d='M82 24l6 12 13 2-9.500 9 2.500 13-12-6.500-12 6.500 2.500-13-9.500-9 13-2z'/><path d='M150 30c-6-10-20-4-14 6 4 6 14 12 14 12s10-6 14-12c6-10-8-16-14-6z'/>` +
    `<path d='M200 22v22M189 33h22'/><path d='M22 96q10-14 20 0t20 0 20 0'/><path d='M120 84l16 28h-32z'/><rect x='176' y='84' width='34' height='26' rx='7'/>` +
    `<circle cx='54' cy='168' r='14'/><path d='M48 168l5 5 9-10'/><path d='M112 150c10 0 18 8 18 18s-8 18-18 18-18-8-18-18'/><path d='M168 154l22 22M190 154l-22 22'/><path d='M214 170a12 12 0 1 1-12-12'/>` +
    `<path d='M24 218q14-18 28 0'/><path d='M96 214h30M111 199v30'/><circle cx='168' cy='214' r='6'/><path d='M198 200l14 22h-28z'/></svg>`;
  return "url(\"data:image/svg+xml," + encodeURIComponent(s) + "\")";
};

const Wall = {
  cur() { return Prefs.get("wp", "def"); },
  grad(w, dark) {
    const c = dark ? w.d : w.l, a = w.a || 160;
    return `linear-gradient(${a}deg,${c[0]},${c[1]} 55%,${c[2]})`;
  },
  img() { try { return localStorage.getItem("pf_wpimg") || ""; } catch (e) { return ""; } },
  apply() {
    const h = document.documentElement, dark = h.dataset.theme !== "light", k = Wall.cur();
    let bg = null, pat = Prefs.get("wppat", true);
    const wrap = document.querySelector("#chat .msgs-wrap");
    const img = k === "img" ? Wall.img() : "";
    if (k === "img" && img) { bg = `url("${img}")`; pat = false; }
    else {
      const w = WALLS.find((x) => x.k === k) || WALLS[0];
      if (w.plain) { bg = "var(--bg)"; pat = false; }
      else if (w.k === "def") bg = null;
      else bg = Wall.grad(w, dark);
    }
    if (bg) h.style.setProperty("--wp-bg", bg); else h.style.removeProperty("--wp-bg");
    h.style.setProperty("--wp-pat", pat ? doodle(dark ? "#fff" : "#2B4A78") : "none");
    h.style.setProperty("--wp-dim", String((+Prefs.get("wpdim", 0) || 0) / 100));
    if (wrap) wrap.classList.toggle("wp-img", !!(k === "img" && img));
  },
  // выбранное фото уменьшаем и сохраняем (чтобы не раздувать хранилище)
  async setPhoto(file) {
    const url = await new Promise((res, rej) => {
      const im = new Image(), u = URL.createObjectURL(file);
      im.onload = () => {
        const s = Math.min(1, 1280 / Math.max(im.width, im.height)), c = document.createElement("canvas");
        c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
        res(c.toDataURL("image/jpeg", 0.82));
      };
      im.onerror = () => { URL.revokeObjectURL(u); rej(new Error(T("Не удалось открыть фото"))); };
      im.src = u;
    });
    try { localStorage.setItem("pf_wpimg", url); } catch (e) { throw new Error(T("Не хватает места для обоев. Очистите данные приложения")); }
    Prefs.set("wp", "img"); Wall.apply();
  },
};

// ───────────── энергосбережение ─────────────
// eco: 0 — никогда, 100 — всегда, иначе включается при заряде не выше порога, если телефон не на зарядке
const Energy = {
  bat: null, active: false, supported: false,
  async init() {
    try {
      if (navigator.getBattery) {
        Energy.bat = await navigator.getBattery(); Energy.supported = true;
        ["levelchange", "chargingchange"].forEach((e) => Energy.bat.addEventListener(e, () => Energy.update()));
      }
    } catch (e) {}
    Energy.update();
  },
  level() { return Energy.bat ? Math.round(Energy.bat.level * 100) : null; },
  charging() { return !!(Energy.bat && Energy.bat.charging); },
  thr() { const v = +Prefs.get("eco", 15); return v >= 0 && v <= 100 ? v : 15; },
  update() {
    const t = Energy.thr();
    let on = false;
    if (t >= 100) on = true;
    else if (t > 0 && Energy.bat) on = !Energy.bat.charging && Energy.bat.level * 100 <= t;
    const was = Energy.active; Energy.active = on;
    const h = document.documentElement;
    const lite = !!(window.LITE && LITE.on);
    h.classList.toggle("eco-anim", Energy.is("anim") || lite);
    h.classList.toggle("no-blur", Energy.is("blur") || lite);
    if (was !== on) { try { Chat.refreshMedia(); } catch (e) {} try { Energy.onChange && Energy.onChange(on); } catch (e) {} }
  },
  // применяется ли ограничение «k» прямо сейчас
  is(k) { return Energy.active && Prefs.get("eco_" + k, true); },
};

// ───────────── счётчик трафика ─────────────
const Net = {
  d: null,
  load() {
    if (Net.d) return Net.d;
    Net.d = Prefs.get("net", null) || { since: Date.now(), rx: { msg: 0, media: 0 }, tx: { msg: 0, media: 0 } };
    return Net.d;
  },
  save: (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => Prefs.set("net", Net.d), 1500); }; })(),
  add(dir, kind, n) { if (!(n > 0)) return; const d = Net.load(); d[dir][kind] += n; Net.save(); },
  reset() { Net.d = { since: Date.now(), rx: { msg: 0, media: 0 }, tx: { msg: 0, media: 0 } }; Prefs.set("net", Net.d); },
  init() {
    Net.load();
    try {
      const seen = new Set();
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.entryType !== "resource" || seen.has(e.name + e.startTime)) continue;
          seen.add(e.name + e.startTime); if (seen.size > 400) seen.clear();
          if (!e.name.startsWith(CONFIG.API)) continue;
          const n = e.transferSize || e.encodedBodySize || 0;
          Net.add("rx", /\/(api\/f|avatar)\//.test(e.name) ? "media" : "msg", n);
        }
      }).observe({ type: "resource", buffered: false });
    } catch (e) {}
  },
};

// форматирование размера
function fmtBytes(n) {
  n = Math.max(0, n || 0);
  if (n < 1024) return n + " " + T("Б");
  const u = [T("КБ"), T("МБ"), T("ГБ"), T("ТБ")]; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  const v = n >= 100 ? Math.round(n) : n >= 10 ? +n.toFixed(1) : +n.toFixed(2);
  return v.toLocaleString(I18N.loc) + " " + u[i];
}

Theme.init();
Energy.init();
Net.init();
