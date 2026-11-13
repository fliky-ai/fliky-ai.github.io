// gifts.js — подарки Dicegram. Каждый подарок — настоящий 3D-объект (gift3d.js + gift3d_designs.js), а не стикер и не эмодзи:
// магазин (Premium / подарки / NFT), предпросмотр с вращением, окно NFT (номер, редкость, модель/фон/узор, улучшение),
// анимация открытия коробки, коллекция в профиле. Фоны и узоры рисуются своими SVG-знаками (без шрифтов эмодзи).
const GIC = {
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M8 3h8l-1 6 3 4H6l3-4z"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6A16.6 16.6 0 0 0 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  wear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/><path d="M17.5 2.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" fill="currentColor"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2.4"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4.2" rx="1.3"/><path d="M12 8v13M5 12.2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6.8"/><path d="M12 8C10.4 4.4 6.2 4.2 6.2 6.4 6.2 8.2 9 8 12 8zm0 0c1.6-3.600 5.800-3.800 5.800-1.600C17.800 8.200 15 8 12 8z"/></svg>',
  cube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.800 4 7.300v9.400l8 4.500 8-4.500V7.300z"/><path d="M4 7.300l8 4.500 8-4.500M12 11.800v9.400"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c.7 5.600 3.400 9.300 10 10-6.600.7-9.300 4.400-10 10-.7-5.600-3.400-9.300-10-10 6.600-.7 9.300-4.400 10-10z"/></svg>',
};

// ───────────── рисунок подарка: 3D-миниатюра на фоне с градиентом и узором из знаков ─────────────
const GiftArt = (() => {
  const SZ = 256;
  // знаки узора (рисуются в квадрате 24×24, белым)
  const GL = {
    star: '<path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>',
    heart: '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>',
    spark: '<path d="M12 2c.7 5.600 3.400 9.300 10 10-6.600.7-9.300 4.400-10 10-.7-5.600-3.400-9.300-10-10 6.600-.7 9.300-4.400 10-10z"/>',
    snow: '<g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M3.300 7l17.400 10M3.300 17L20.700 7"/><path d="M9.500 3.800L12 6l2.500-2.200M9.500 20.200L12 18l2.500 2.200M3.600 10.600l3.100-.9-.9-3.100M20.400 13.400l-3.100.9.900 3.100M3.600 13.400l3.100.9-.9 3.100M20.400 10.600l-3.100-.9.900-3.100"/></g>',
    flower: '<circle cx="12" cy="5.800" r="3.800"/><circle cx="12" cy="5.800" r="3.800" transform="rotate(72 12 12)"/><circle cx="12" cy="5.800" r="3.800" transform="rotate(144 12 12)"/><circle cx="12" cy="5.800" r="3.800" transform="rotate(216 12 12)"/><circle cx="12" cy="5.800" r="3.800" transform="rotate(288 12 12)"/><circle cx="12" cy="12" r="2.700" fill-opacity=".45"/>',
    bolt: '<path d="M13.500 2L5 13.500h5.500L9.500 22 19 10h-5.800z"/>',
    cube: '<path d="M12 2l9 5-9 5-9-5z"/><path d="M3 8.400l8.400 4.700V22L3 17.200z" fill-opacity=".6"/><path d="M21 8.400l-8.400 4.700V22l8.400-4.800z" fill-opacity=".34"/>',
    crown: '<path d="M3 18V8l5 4.200L12 4l4 8.200L21 8v10z"/><path d="M3 19.800h18V22H3z"/>',
  };
  const KEYS = Object.keys(GL);
  const glyph = (k) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${GL[k] || GL.spark}</svg>`;
  const rnd = (seed) => () => (seed = (seed * 16807 + 11) % 2147483647) / 2147483647;
  const wrap = (inner, vb, par) => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${vb}'${par ? ` preserveAspectRatio='${par}'` : ""}><g color='white' fill='white'>${inner}</g></svg>`;
  const put = (x, y, s, rot, op, k) => `<g opacity='${op.toFixed(2)}' transform='translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(0)}) scale(${(s / 24).toFixed(3)}) translate(-12 -12)'>${GL[k]}</g>`;
  // кольцо знаков вокруг предмета (миниатюра)
  const TILE = [[50, 9, 11], [84, 22, 9], [92, 52, 11], [82, 82, 9], [50, 92, 11], [18, 82, 9], [8, 52, 11], [16, 22, 9], [30, 6, 6], [70, 6, 6], [30, 95, 6], [70, 95, 6],
    [8, 34, 5], [92, 34, 5], [8, 72, 5], [92, 72, 5], [26, 20, 5], [74, 20, 5], [26, 80, 5], [74, 80, 5], [93, 10, 7], [7, 10, 7], [93, 91, 7], [7, 91, 7]];
  const tileSvg = (k) => wrap(TILE.map(([x, y, s], i) => put(x, y, s, ((i * 47) % 70) - 35, 0.22 + ((i * 37) % 17) / 100, k)).join(""), "0 0 100 100");
  // поле знаков для большой сцены: сетка со смещением, в центре пусто (там предмет)
  const stageSvg = (k) => {
    const r = rnd(k.charCodeAt(1) * 97 + 3), out = [], cols = 10, rows = 7, W = 160, H = 100;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = (i + 0.5 + (r() - 0.5) * 0.7) * W / cols, y = (j + 0.5 + (r() - 0.5) * 0.7) * H / rows, dx = (x - 80) / 36, dy = (y - 50) / 32;
      if (dx * dx + dy * dy < 1) { r(); r(); r(); continue; }
      out.push(put(x, y, 5 + r() * 7, (r() - 0.5) * 70, 0.14 + r() * 0.22, k));
    }
    return wrap(out.join(""), "0 0 160 100", "xMidYMid slice");
  };
  const durl = (s) => "data:image/svg+xml," + encodeURIComponent(s);
  let styled = false;
  const ensure = () => {
    if (styled) return; styled = true;
    const st = document.createElement("style"); st.id = "gp-css";
    st.textContent = KEYS.map((k) => `.gpt-${k}{background-image:url("${durl(tileSvg(k))}")}.gps-${k}{background-image:url("${durl(stageSvg(k))}")}`).join("");
    document.head.appendChild(st);
  };

  // фоны обычных подарков (каждому свой, контрастный к предмету)
  const REG_BG = {
    heart: ["#a3b8ff", "#4a54e6", "star"], bear: ["#9ad9ff", "#2f7bff", "snow"], balloon: ["#8ff0d0", "#12a07f", "spark"], star: ["#c9b5ff", "#6a3fe0", "star"],
    box: ["#ffd27a", "#f08a00", "spark"], rose: ["#7fe3ee", "#1a8db0", "flower"], lollipop: ["#e3b0ff", "#8a35db", "heart"], cupcake: ["#9fe6c2", "#17996a", "heart"],
    cake: ["#8fd0ff", "#2a6fe0", "star"], bouquet: ["#ffb7cf", "#d6417d", "flower"], rocket: ["#ffc6a0", "#ec5b2c", "star"], wine: ["#ffd9a0", "#d9791c", "spark"],
    mug: ["#a9c7ff", "#3a58d6", "snow"], clover: ["#ffe08a", "#e0a000", "flower"], snowman: ["#b8a8ff", "#4a35c8", "snow"], cup: ["#8fe9b5", "#139255", "crown"],
    ring: ["#ff9fbf", "#c4285f", "spark"], gem: ["#ffb199", "#e0452f", "cube"], crown: ["#d6a8ff", "#6c2fd6", "crown"],
  };
  const regBg = (k) => REG_BG[k] || ["#9ad9ff", "#2f7bff", "spark"];

  // что рисовать: подарок с сервера (g.nft), описание NFT (coll/backdrop/pattern) или обычный {key}
  const specOf = (g) => {
    if (!g) return null;
    const key = String(g.key || "");
    if (key.startsWith("prem:")) return null;
    const n = g.nft || (g.backdrop && g.coll ? g : null);
    if (n && n.coll) {
      const b = n.backdrop || {};
      return { kind: "nft", id: n.coll, model: (n.model && (n.model.k || n.model)) || "classic", c1: b.c1 || "#7ec8ff", c2: b.c2 || "#2f7bff", pat: (n.pattern && (n.pattern.k || n.pattern.e)) || "spark", num: +n.num || 0 };
    }
    if (!key) return null;
    const bg = regBg(key);
    return { kind: "reg", id: key, model: "classic", c1: bg[0], c2: bg[1], pat: bg[2], num: 0 };
  };

  // Premium в подарок: фирменная плитка со звездой
  const prem = (months, o = {}) => `<div class="ga prem${o.cls ? " " + o.cls : ""}" style="${o.s ? `--s:${o.s}px;` : ""}"><i class="ga-p gpt-spark"></i><i class="ga-g"></i><div class="ga-st">${typeof ES !== "undefined" ? ES.svg("star") : GIC.star}</div>
    <b class="ga-mo">${months}</b><small>${esc(plural(months, T("месяц"), T("месяца"), T("месяцев")))}</small><i class="ga-sh"></i></div>`;

  // миниатюры подгружаются сами: наблюдатель находит новые элементы с data-g3 и просит у движка картинку
  const hyd = (el) => {
    if (el.dataset.h) return; el.dataset.h = "1";
    const [kind, id, model] = el.dataset.g3.split("|"), img = el.querySelector(".ga-i");
    if (!img || typeof Gift3D === "undefined" || !Gift3D.hasDesign(kind, id)) { el.classList.add("err"); return; }
    Gift3D.thumb(kind, id, model, +el.dataset.sz || SZ, (url) => {
      if (!img.isConnected) return;
      if (!url) { el.classList.add("err"); return; }
      img.src = url; el.classList.remove("err"); el.classList.add("rdy");
    });
  };
  const scan = (root) => {
    if (!root || root.nodeType !== 1) return;
    if (root.hasAttribute("data-g3")) hyd(root);
    if (root.firstElementChild) root.querySelectorAll("[data-g3]:not([data-h])").forEach(hyd);
  };
  let mo = null;
  const init = () => {
    if (mo || !document.body) return;
    mo = new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach(scan); });
    mo.observe(document.body, { childList: true, subtree: true });
    scan(document.body);
  };

  const A = {
    SZ, GL, KEYS, glyph, specOf, regBg, ensure, init,
    scan,
    // любой подарок из ответа сервера (в том числе элемент профиля или сообщение)
    html(g, o = {}) {
      if (!g) return "";
      const key = String(g.key || "");
      if (key.startsWith("prem:")) return prem(+g.months || +key.slice(5) || 1, o);
      const sp = specOf(g); if (!sp) return "";
      ensure(); init();
      return `<div class="ga ${sp.kind}${o.cls ? " " + o.cls : ""}" style="${o.s ? `--s:${o.s}px;` : ""}--c1:${esc(sp.c1)};--c2:${esc(sp.c2)};--rot:${(sp.num % 4) * 90}deg" data-g3="${sp.kind}|${esc(sp.id)}|${esc(sp.model)}" data-sz="${o.sz || SZ}">` +
        `<i class="ga-p gpt-${esc(sp.pat)}"></i><i class="ga-g"></i><i class="ga-sd"></i><img class="ga-i" alt="" draggable="false"><span class="ga-f">${GIC.gift}</span>${sp.kind === "nft" ? '<i class="ga-sh"></i>' : ""}</div>`;
    },
    prem,
    // совсем маленький значок NFT (рядом с именем): только предмет, без фона
    mini(n, px = 20) {
      if (!n || !n.coll) return "";
      init();
      return `<span class="ga-m" style="--s:${px}px" data-g3="nft|${esc(n.coll)}|${esc((n.model && (n.model.k || n.model)) || "classic")}" data-sz="96"><img class="ga-i" alt="" draggable="false"></span>`;
    },
    // сменить вид плитки на лету (в магазине плитки NFT перебирают варианты)
    morph(el, sp) {
      el.style.setProperty("--c1", sp.c1); el.style.setProperty("--c2", sp.c2);
      const p = el.querySelector(".ga-p"); if (p) p.className = "ga-p gpt-" + sp.pat;
      el.classList.remove("rdy"); el.dataset.g3 = `${sp.kind}|${sp.id}|${sp.model}`; delete el.dataset.h; hyd(el);
    },
  };
  return A;
})();

// ───────────── сцена: фон, узор, лучи и живой 3D-просмотр с вращением ─────────────
const RAR = { common: "#b9c3d6", rare: "#58b2ff", epic: "#c27bff", legend: "#ffb52e", myth: "#ff5c7a" };
const BOX_SPEC = { kind: "reg", id: "__box", model: "classic", c1: "#3b2a9a", c2: "#0a0620", pat: "spark", num: 0 };
const reducedFx = () => document.documentElement.classList.contains("eco-anim") || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

function giftStage(host, o) {
  const sp = o.sp; GiftArt.ensure();
  host.classList.add("gv");
  host.style.setProperty("--c1", sp.c1); host.style.setProperty("--c2", sp.c2);
  host.insertAdjacentHTML("afterbegin", `<i class="gv-bg"></i><i class="gv-bg n"></i><i class="gv-pat gps-${sp.pat}"></i><i class="gv-rays"></i><i class="gv-gl"></i><i class="gv-sd"></i>`);
  const pat = host.querySelector(".gv-pat"), nb = host.querySelector(".gv-bg.n");
  let live = null;
  const ok = typeof Gift3D !== "undefined" && Gift3D.hasDesign(sp.kind, sp.id);
  if (ok) {
    try { live = Gift3D.live(host, { kind: sp.kind, id: sp.id, model: sp.model }, { still: !!o.still, zoom: o.zoom || 1.3, pitch: o.pitch != null ? o.pitch : 0.16, yaw: o.yaw, dpr: 2, bob: o.bob }); } catch (e) { live = null; }
  }
  if (!live) host.insertAdjacentHTML("beforeend", `<span class="gv-f">${GIC.gift}</span>`);
  let tm = 0;
  const S = {
    host, live, sp,
    // новый фон с плавным переходом
    back(c1, c2, pk, ms = 700) {
      nb.style.setProperty("--n1", c1); nb.style.setProperty("--n2", c2);
      nb.style.transitionDuration = ms + "ms"; nb.classList.add("on");
      if (pk && pk !== S.sp.pat) { pat.style.opacity = 0; setTimeout(() => { pat.className = "gv-pat gps-" + pk; pat.style.opacity = ""; }, ms * 0.45); }
      clearTimeout(tm);
      tm = setTimeout(() => { host.style.setProperty("--c1", c1); host.style.setProperty("--c2", c2); nb.style.transitionDuration = "0ms"; nb.classList.remove("on"); }, ms + 40);
      S.sp = Object.assign({}, S.sp, { c1, c2, pat: pk || S.sp.pat });
    },
    set(sp2, ms) {
      if (live && (sp2.kind !== S.sp.kind || sp2.id !== S.sp.id || sp2.model !== S.sp.model)) live.set({ kind: sp2.kind, id: sp2.id, model: sp2.model });
      S.back(sp2.c1, sp2.c2, sp2.pat, ms);
      S.sp = Object.assign({}, S.sp, sp2);
    },
    destroy() { clearTimeout(tm); if (live) { try { live.destroy(); } catch (e) {} live = null; S.live = null; } },
  };
  return S;
}

// ───────────── частицы: искры и конфетти поверх сцены ─────────────
function giftFx(host) {
  const cv = document.createElement("canvas"); cv.className = "gu-fx"; host.appendChild(cv);
  const ctx = cv.getContext("2d"), dpr = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0, P = [], raf = 0, last = 0, alive = true;
  const fit = () => { const r = host.getBoundingClientRect(), w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr)); if (w !== W || h !== H) { W = cv.width = w; H = cv.height = h; } };
  const spark = (x, y, r, rot) => { ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = rot + i * Math.PI / 4, rr = i % 2 ? r * 0.26 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); };
  const tick = (now) => {
    raf = 0; if (!alive) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    ctx.clearRect(0, 0, W, H);
    P = P.filter((p) => p.t < p.life);
    for (const p of P) {
      p.t += dt; p.vy += p.g * dt; p.vx *= Math.pow(p.drag, dt * 60); p.vy *= Math.pow(p.drag, dt * 60);
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const k = p.t / p.life, a = k < 0.12 ? k / 0.12 : Math.max(0, 1 - (k - 0.45) / 0.55);
      ctx.globalAlpha = Math.max(0, Math.min(1, a)); ctx.fillStyle = p.col;
      if (p.shape === 0) spark(p.x, p.y, p.r * (0.7 + 0.5 * Math.sin(p.t * 9 + p.rot)), p.rot);
      else if (p.shape === 1) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.5, 0, 6.3); ctx.fill(); }
      else { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.r * 0.5, -p.r * 0.22, p.r, p.r * 0.44); ctx.restore(); }
    }
    ctx.globalAlpha = 1;
    if (P.length) raf = requestAnimationFrame(tick);
  };
  return {
    cv,
    burst(x, y, n, cols, o = {}) {
      if (!alive || reducedFx()) return;
      if (window.LITE && LITE.on) n = Math.max(6, Math.round(n * 0.35));          // слабый телефон: меньше частиц
      fit();
      const sp = (o.speed || 1) * 420 * dpr;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, v = (0.25 + Math.random() * 0.75) * sp;
        P.push({ x: x * dpr, y: y * dpr, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (o.up ? 160 * dpr : 0), g: (o.gravity != null ? o.gravity : 380) * dpr, drag: 0.985, t: 0, life: (o.life || 1.5) * (0.6 + Math.random() * 0.8),
          r: (6 + Math.random() * 12) * dpr * (o.size || 1), rot: Math.random() * 6.3, vr: (Math.random() - 0.5) * 8, col: cols[(Math.random() * cols.length) | 0], shape: o.shapes ? o.shapes[(Math.random() * o.shapes.length) | 0] : (Math.random() < 0.6 ? 0 : 1) });
      }
      if (!raf) { last = 0; raf = requestAnimationFrame(tick); }
    },
    destroy() { alive = false; if (raf) cancelAnimationFrame(raf); cv.remove(); },
  };
}

// ───────────── магазин и окна подарков ─────────────
const Gifts = {
  cat: null,
  PM: 500,                                   // цена Premium на месяц — только для расчёта скидки на плитках

  date(ts) { try { return new Date(ts * 1000).toLocaleDateString(I18N.lang === "en" ? "en-GB" : "ru-RU", { day: "numeric", month: "long", year: "numeric" }); } catch (e) { return ""; } },
  num(n) { return (+n || 0).toLocaleString(I18N.lang === "en" ? "en-US" : "ru-RU"); },
  stars(n) { return `<span class="gs-s">${GIC.star}${Gifts.num(n)}</span>`; },
  title(g) {
    if (String(g.key || "").startsWith("prem:")) return T("Premium на {0}", (+g.months || +String(g.key).slice(5)) + " " + plural(+g.months || +String(g.key).slice(5), T("месяц"), T("месяца"), T("месяцев")));
    return T(g.name || "") + (g.nft ? " #" + g.nft.num : "");
  },
  rar(n) { return n && n.rarity ? n.rarity : { k: "common", n: "Обычный" }; },
  async load() { try { const d = await api("/api/gifts/catalog"); Gifts.cat = d; return d; } catch (e) { toast(e.message); return null; } },
  balance() { return (App.user && App.user.stars) || 0; },

  // что-то изменилось (подарили, улучшили, надели): обновить экраны, где это видно
  changed(uid) {
    try { if (typeof Profile !== "undefined") Profile.gf = null; } catch (e) {}
    try { if (typeof UserProfile !== "undefined" && UserProfile.cur && (!uid || UserProfile.cur.id === uid)) UserProfile.reload(); } catch (e) {}
    try { Profile.render(); } catch (e) {}
  },
  // слой поверх всего: «назад» закрывает его. hooks: что сделать при закрытии (остановить 3D, таймеры)
  layer(cls, html, z) {
    const el = document.createElement("div");
    el.className = cls;
    if (z) el.style.zIndex = z;
    el.innerHTML = html;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    const hooks = [];
    const close = Nav.layer(() => { hooks.forEach((f) => { try { f(); } catch (e) {} }); el.classList.remove("show"); setTimeout(() => el.remove(), 260); });
    el.addEventListener("click", (e) => { if (e.target === el) close(); });
    el.querySelectorAll("[data-x]").forEach((x) => { x.onclick = close; });
    return { el, close, on(f) { hooks.push(f); } };
  },

  // ── магазин ──
  async shop(u, tab) {
    if (!u || u.is_system) return;
    if (u.gk === "group") return toast(T("Подарки можно отправлять людям, в каналы и себе — не в группы"));
    const me = !!(App.user && u.id === App.user.id);
    const tabs = (me || u.gk ? [] : [["prem", "Premium"]]).concat([["reg", T("Подарки")], ["nft", "NFT"]]);
    tab = tab && tabs.some((t) => t[0] === tab) ? tab : "reg";
    const L = Gifts.layer("gs-ov", `<div class="gs-card" role="dialog">
      <div class="gs-top"><button class="gs-x" data-x aria-label="${esc(T("Закрыть"))}">${GIC.x}</button><b>${esc(me ? T("Подарок себе") : T("Подарок для {0}", dispName(u)))}</b>
        <button class="gs-bal" data-bal>${Gifts.stars(Gifts.balance())}</button></div>
      <div class="gs-tabs" style="--n:${tabs.length}"><i></i>${tabs.map((t) => `<button data-t="${t[0]}">${esc(t[1])}</button>`).join("")}</div>
      <div class="gs-body"><div class="gs-wait"><span class="spin"></span></div></div></div>`, 126);
    const el = L.el, body = el.querySelector(".gs-body"), tb = el.querySelector(".gs-tabs");
    const st = { u, tab, L, me };
    Gifts.cur = st;
    el.querySelector("[data-bal]").onclick = () => { L.close(); setTimeout(() => Settings.stars(), 280); };
    const set = (t) => {
      st.tab = t;
      const bs = [...tb.querySelectorAll("button")], i = bs.findIndex((b) => b.dataset.t === t);
      bs.forEach((b, j) => b.classList.toggle("on", j === i));
      tb.style.setProperty("--i", i);
      body.scrollTop = 0;
      body.innerHTML = Gifts.panel(t, u, me);
    };
    tb.onclick = (e) => { const b = e.target.closest("button[data-t]"); if (b && b.dataset.t !== st.tab) { haptic(); set(b.dataset.t); } };
    const d = await Gifts.load();
    if (!d) return L.close();
    set(tab);
    body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pm],[data-gk],[data-ck]"); if (!b) return;
      haptic();
      if (b.dataset.pm) return Gifts.buyPrem(u, +b.dataset.pm, L);
      if (b.dataset.gk) return Gifts.buyReg(u, b.dataset.gk, L);
      if (b.dataset.ck) return Gifts.buyCol(u, b.dataset.ck, L);
    });
    L.on(() => { st.dead = true; });
    Gifts.cycle(el, st);
    Gifts.live(el);
  },
  // баланс в шапке магазина обновляется после покупок
  live(el) { const b = el.querySelector("[data-bal]"); if (b) b.innerHTML = Gifts.stars(Gifts.balance()); },

  // плитки NFT по очереди меняют модель, фон и узор — видно, что каждый экземпляр особенный
  cycle(el, st) {
    const t = setInterval(() => {
      if (st.dead || !el.isConnected) return clearInterval(t);
      if (reducedFx() || st.tab !== "nft") return;
      const d = Gifts.cat; if (!d) return;
      const body = el.querySelector(".gs-body"), br = body.getBoundingClientRect();
      const vis = [...body.querySelectorAll(".gt-c[data-ck]")].filter((n) => { const r = n.getBoundingClientRect(); return r.bottom > br.top && r.top < br.bottom; });
      for (let k = 0; k < 2 && vis.length; k++) {
        const n = vis.splice((Math.random() * vis.length) | 0, 1)[0];
        const c = d.nft.find((x) => x.coll === n.dataset.ck), art = n.querySelector(".ga"); if (!c || !art) continue;
        const i = (+n.dataset.i || 0) + 1; n.dataset.i = i;
        const m = c.models[(i * 3 + (+n.dataset.o || 0)) % c.models.length], b = c.backdrops[(i * 5 + (+n.dataset.o || 0)) % c.backdrops.length], p = c.patterns[(i * 7) % c.patterns.length];
        GiftArt.morph(art, { kind: "nft", id: c.coll, model: m.k, c1: b.c1, c2: b.c2, pat: p.k });
      }
    }, 1500);
  },

  // плитка NFT в магазине (c — запись каталога, i — какой вариант показывать)
  nftSpec(c, i = 0) {
    const m = c.models[(i * 3) % c.models.length], b = c.backdrops[(i * 5) % c.backdrops.length], p = c.patterns[(i * 7) % c.patterns.length];
    return { coll: c.coll, num: i, model: m, backdrop: b, pattern: p };
  },

  panel(t, u, me) {
    const d = Gifts.cat;
    if (t === "prem") {
      return `<div class="gs-prem"><div class="gpr-hero"><div class="gpr-rays"></div><div class="gpr-st">${typeof ES !== "undefined" ? ES.svg("star") : GIC.star}</div>
        <i class="gpr-s a">${GIC.spark}</i><i class="gpr-s b">${GIC.star}</i><i class="gpr-s c">${GIC.spark}</i><i class="gpr-s d">${GIC.star}</i></div>
        <h2>${esc(T("Подарите Premium"))}</h2>
        <p>${esc(T("{0} получит эмодзи-статус, свои эмодзи, до 3 реакций на сообщение и другие возможности.", dispName(u)))}</p>
        <div class="gpr-plans">${d.premium.map((p) => {
          const sv = Math.round((1 - p.price / (p.months * Gifts.PM)) * 100);
          return `<button class="gpr-plan" data-pm="${p.months}">${GiftArt.prem(p.months, { s: 54, cls: "mini" })}
            <span class="gpr-t"><b>${p.months} ${esc(plural(p.months, T("месяц"), T("месяца"), T("месяцев")))}</b>${sv > 0 ? `<em>−${sv}%</em>` : ""}<small>${esc(T("{0} в месяц", Math.round(p.price / p.months) + " ⭐"))}</small></span>
            <span class="gpr-pr">${Gifts.stars(p.price)}</span></button>`;
        }).join("")}</div>
        <small class="gs-note">${esc(T("Звёзды спишутся с вашего баланса. Premium начнётся сразу, а {0} получит красивое сообщение с подарком.", dispName(u)))}</small></div>`;
    }
    if (t === "reg") {
      return `<div class="gs-ban reg"><i class="gs-ban-i">${GIC.gift}</i><div><b>${esc(me ? T("Подарки для себя") : T("Подарки"))}</b><span>${esc(me ? T("Покупайте и собирайте подарки — они появятся в вашей коллекции в профиле.") : T("Подарок появится в профиле получателя. Их можно собирать, скрывать и закреплять."))}</span></div></div>
        <div class="gg">${d.regular.map((g) => `<button class="gt" data-gk="${esc(g.key)}">${g.rare ? `<span class="gt-rb">${esc(T("Редкий"))}</span>` : ""}${GiftArt.html({ key: g.key })}<b>${esc(g.name)}</b><span class="gt-pr">${GIC.star}${Gifts.num(g.price)}</span></button>`).join("")}</div>`;
    }
    return `<div class="gs-ban nft"><i class="gs-ban-i">${GIC.cube}</i><div><b>${esc(T("NFT-подарки"))}</b><span>${esc(T("Редкие 3D-коллекции с номером. Модель, фон и узор выпадают случайно, а улучшение делает подарок ещё реже."))}</span></div></div>
      <div class="gg">${d.nft.map((c, i) => {
        const gone = c.left <= 0, pc = Math.min(100, Math.round((c.minted / c.supply) * 100));
        return `<button class="gt gt-c${gone ? " gone" : ""}" data-ck="${esc(c.coll)}" data-i="${i}" data-o="${i}"><span class="gt-rb nft">${esc(T("Ограничен"))}</span>${GiftArt.html(Gifts.nftSpec(c, i))}<b>${esc(c.name)}</b>
          ${gone ? `<span class="gt-l">${esc(T("Распродано"))}</span>` : `<span class="gt-pr">${GIC.star}${Gifts.num(c.price)}</span><span class="gt-l">${esc(T("осталось {0} из {1}", Gifts.num(c.left), Gifts.num(c.supply)))}</span><i class="gt-bar" style="--p:${pc}%"></i>`}</button>`;
      }).join("")}</div>`;
  },

  // ── покупка: окно предпросмотра и подтверждения ──
  // o: {user, art | sp (3D-сцена), c (запись каталога NFT — для выбора модели/фона/узора), title, sub, price, anon, run({msg,anon}) → ответ сервера}
  confirm(o) {
    return new Promise((res) => {
      const me = !!(o.user && App.user && o.user.id === App.user.id);
      const L = Gifts.layer("gb-ov gp-ov", `<div class="gb-card gp-card" role="dialog">
        <button class="gb-x" data-x aria-label="${esc(T("Закрыть"))}">${GIC.x}</button>
        <div class="gp-stage">${o.art || ""}</div>
        <div class="gp-in"><h3>${esc(o.title)}</h3><p class="gb-sub">${esc(o.sub || "")}</p>
        ${o.c ? `<div class="gp-attrs"></div>` : ""}
        <div class="gb-msg"><textarea rows="1" maxlength="140" placeholder="${esc(me ? T("Добавьте заметку (необязательно)") : T("Добавьте сообщение (необязательно)"))}"></textarea></div>
        ${o.anon === false || me ? "" : `<div class="gb-anon" role="switch" aria-checked="false" tabindex="0"><span>${esc(T("Скрыть моё имя"))}</span><i class="gb-sw"></i></div>`}</div>
        <div class="gp-foot"><button class="gb-buy">${esc(me ? T("Купить за") : T("Отправить за"))} ${Gifts.stars(o.price)}</button>
        <small class="gb-bal">${esc(T("Ваш баланс: {0}", Gifts.balance() + " ⭐"))}</small></div></div>`, 128);
      const el = L.el, buy = el.querySelector(".gb-buy"), anon = el.querySelector(".gb-anon"), ta = el.querySelector("textarea");
      let stage = null, timer = 0;
      L.on(() => { clearInterval(timer); if (stage) stage.destroy(); });
      if (o.sp) stage = giftStage(el.querySelector(".gp-stage"), { sp: o.sp });
      // выбор вида (только для просмотра: настоящие значения выпадут при покупке)
      if (o.c) {
        const c = o.c, A = el.querySelector(".gp-attrs"), cur = { m: 0, b: 0, p: 0, manual: false };
        const lab = { m: T("Модель"), b: T("Фон"), p: T("Узор") }, list = { m: c.models, b: c.backdrops, p: c.patterns };
        A.innerHTML = ["m", "b", "p"].map((k) => `<div class="gp-h"><span>${esc(lab[k])}</span><b data-lb="${k}"></b></div><div class="gp-ch ${k}" data-r="${k}">${list[k].map((x, i) =>
          k === "m" ? `<button data-i="${i}" class="gp-c">${esc(x.n)}<em>${x.r}%</em></button>`
            : k === "b" ? `<button data-i="${i}" class="gp-c dot" style="--c1:${esc(x.c1)};--c2:${esc(x.c2)}" aria-label="${esc(x.n)}"></button>`
              : `<button data-i="${i}" class="gp-c ico" aria-label="${esc(x.n)}">${GiftArt.glyph(x.k)}</button>`).join("")}</div>`).join("");
        const paint = () => {
          for (const k of ["m", "b", "p"]) {
            const x = list[k][cur[k]];
            A.querySelector(`[data-lb="${k}"]`).innerHTML = `${esc(x.n)}<em>${x.r}%</em>`;
            A.querySelectorAll(`[data-r="${k}"] .gp-c`).forEach((b, i) => b.classList.toggle("on", i === cur[k]));
            const on = A.querySelector(`[data-r="${k}"] .gp-c.on`); if (on && cur.manual) on.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
          }
          const m = c.models[cur.m], b = c.backdrops[cur.b], p = c.patterns[cur.p];
          if (stage) stage.set({ kind: "nft", id: c.coll, model: m.k, c1: b.c1, c2: b.c2, pat: p.k }, 800);
        };
        const rand = () => { cur.m = (Math.random() * c.models.length) | 0; cur.b = (Math.random() * c.backdrops.length) | 0; cur.p = (Math.random() * c.patterns.length) | 0; };
        if (o.start) Object.assign(cur, o.start); else rand();
        paint();
        A.addEventListener("click", (e) => { const b = e.target.closest(".gp-c"); if (!b) return; cur.manual = true; clearInterval(timer); cur[b.parentNode.dataset.r] = +b.dataset.i; haptic(); paint(); });
        if (!reducedFx()) timer = setInterval(() => { if (!el.isConnected) return clearInterval(timer); rand(); paint(); }, 2600);
      }
      if (anon) anon.onclick = () => { const on = anon.getAttribute("aria-checked") !== "true"; anon.setAttribute("aria-checked", on); haptic(); };
      ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(90, ta.scrollHeight) + "px"; });
      let busy = false;
      buy.onclick = async () => {
        if (busy) return; busy = true; buy.classList.add("wait");
        try {
          const d = await o.run({ msg: ta.value.trim(), anon: !!anon && anon.getAttribute("aria-checked") === "true" });
          if (d && d.user) App.user = d.user;
          haptic("medium");
          L.close(); if (o.shop) o.shop.close();
          Gifts.changed(o.user && o.user.id);
          setTimeout(() => {
            if (me && d && d.gift) Gifts.reveal({ mode: "box", gift: d.gift, then: () => Gifts.detail(d.gift) });
            else { Gifts.confetti(); toast(T("Подарок отправлен")); }
          }, 380);
          res(d);
        } catch (e) {
          busy = false; buy.classList.remove("wait");
          if (/Недостаточно звёзд|Not enough stars/i.test(e.message)) {
            const v = await UI.sheet({ title: T("Не хватает звёзд"), icon: SI.starF, text: e.message, actions: [{ label: T("Пополнить баланс"), value: "top", accent: true }], cancel: T("Закрыть") });
            if (v === "top") { L.close(); if (o.shop) o.shop.close(); setTimeout(() => Settings.stars(), 300); }
          } else toast(e.message);
        }
      };
    });
  },

  buyPrem(u, months, shop) {
    const p = Gifts.cat.premium.find((x) => x.months === months); if (!p) return;
    return Gifts.confirm({
      user: u, shop, price: p.price, art: `<div class="gp-prem">${GiftArt.prem(months, { s: 150 })}</div>`,
      title: T("Premium на {0}", months + " " + plural(months, T("месяц"), T("месяца"), T("месяцев"))),
      sub: T("Подарок для {0}: статус, свои эмодзи, реакции и всё остальное.", dispName(u)),
      run: (x) => api("/api/premium/gift", { method: "POST", body: { to: u.id, months, anon: x.anon, msg: x.msg } }),
    });
  },
  buyReg(u, key, shop) {
    const g = Gifts.cat.regular.find((x) => x.key === key); if (!g) return;
    const me = App.user && u.id === App.user.id, bg = GiftArt.regBg(key);
    return Gifts.confirm({
      user: u, shop, price: g.price, title: T(g.name),
      sp: { kind: "reg", id: key, model: "classic", c1: bg[0], c2: bg[1], pat: bg[2], num: 0 }, art: "",
      sub: me ? T("Подарок появится в вашей коллекции. Потяните, чтобы повернуть.") : u.gk ? T("Подарок появится во вкладке «Подарки» профиля канала. Потяните, чтобы повернуть.") : T("Подарок появится в профиле. Потяните, чтобы повернуть."),
      run: (x) => api("/api/gift/send", { method: "POST", body: { to: u.id, key, anon: x.anon, msg: x.msg } }),
    });
  },
  buyCol(u, coll, shop) {
    const c = Gifts.cat.nft.find((x) => x.coll === coll); if (!c) return;
    if (c.left <= 0) return toast(T("Эта коллекция распродана"));
    const me = App.user && u.id === App.user.id;
    const b = c.backdrops[0], p = c.patterns[0];
    return Gifts.confirm({
      user: u, shop, price: c.price, title: T(c.name), c,
      sp: { kind: "nft", id: c.coll, model: c.models[0].k, c1: b.c1, c2: b.c2, pat: p.k, num: 0 }, art: "",
      sub: T("Уникальный NFT: номер, модель, фон и узор выпадут случайно. Осталось {0} из {1}.", Gifts.num(c.left), Gifts.num(c.supply)),
      run: (x) => api("/api/gift/send", { method: "POST", body: { to: u.id, key: "c:" + coll, anon: x.anon, msg: x.msg } }),
    });
  },

  // короткий праздничный залп после отправки подарка другу
  confetti() {
    if (reducedFx()) return;
    const host = document.createElement("div"); host.className = "gu-conf"; document.body.appendChild(host);
    const fx = giftFx(host), r = host.getBoundingClientRect();
    const cols = ["#ffd45a", "#ff6fae", "#7fb8ff", "#7dffd0", "#c79bff", "#ffffff"];
    fx.burst(r.width * 0.5, r.height * 0.58, 90, cols, { speed: 1.25, up: 1, gravity: 520, life: 1.7, shapes: [0, 1, 2] });
    setTimeout(() => fx.burst(r.width * 0.2, r.height * 0.7, 40, cols, { speed: 1, up: 1, gravity: 520, shapes: [0, 2] }), 160);
    setTimeout(() => fx.burst(r.width * 0.8, r.height * 0.7, 40, cols, { speed: 1, up: 1, gravity: 520, shapes: [0, 2] }), 260);
    setTimeout(() => { fx.destroy(); host.remove(); }, 2400);
  },

  // ── открытие подарка и улучшение: коробка, вспышка, лучи, искры, появление предмета ──
  // o: {mode: "box" | "upgrade", gift (итог), prev (прежние характеристики NFT при улучшении), then}
  reveal(o) {
    const g = o.gift, up = o.mode === "upgrade", fin = GiftArt.specOf(g);
    const start = up ? GiftArt.specOf({ nft: o.prev }) : BOX_SPEC;
    if (!fin || !start) { if (o.then) o.then(); return; }
    const n = g.nft, rar = n ? Gifts.rar(n) : null;
    const L = Gifts.layer("gu-ov", `<div class="gu-st"></div><i class="gu-ring"></i><i class="gu-flash"></i>
      <div class="gu-txt"><span class="gu-k"></span><h2></h2>
        <div class="gu-rar"></div><p class="gu-p"></p>
        <button class="gu-ok">${esc(o.then ? T("Посмотреть") : T("Готово"))}</button></div>`, 131);
    const el = L.el, host = el.querySelector(".gu-st"), $ = (s) => el.querySelector(s);
    const stage = giftStage(host, { sp: start, still: false, zoom: 0.5, bob: true });
    const fx = giftFx(el);
    const live = stage.live, st = live && live.st;
    L.on(() => { stage.destroy(); fx.destroy(); });
    const cx = () => { const r = host.getBoundingClientRect(); return [r.width / 2, r.height * 0.5]; };
    const cols = [RAR[rar ? rar.k : "common"] || "#fff", "#ffe08a", "#ffffff", fin.c1, fin.c2];
    let boomed = false, done = false, T0 = performance.now(), swapped = false;
    const boomAt = up ? 1750 : 1500, lidMat = Gift3D.mat;
    const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
    const back = (t) => { t = Math.min(1, Math.max(0, t)); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
    const elastic = (t) => { t = Math.min(1, Math.max(0, t)); return t === 0 || t === 1 ? t : Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1; };
    const boom = () => {
      boomed = true; el.classList.add("boom"); haptic("medium");
      const [x, y] = cx();
      fx.burst(x, y, 110, cols, { speed: 1.5, gravity: 260, life: 1.9, shapes: [0, 0, 1] });
      setTimeout(() => fx.burst(x, y, 50, cols, { speed: 0.8, gravity: 120, life: 2.2, size: 0.8 }), 260);
    };
    const finish = () => {
      done = true; el.classList.add("fin");
      $(".gu-k").textContent = up ? T("Улучшено!") : (g.from && !g.anon ? T("Вам подарили") : T("Ваш подарок"));
      $("h2").textContent = Gifts.title(g);
      if (n) {
        const r = Gifts.rar(n);
        $(".gu-rar").innerHTML = `<span class="rr r-${esc(r.k)}">${esc(T(r.n))}</span>${n.tier ? `<span class="rr tier">${GIC.up}${esc(T(n.tier_n))}</span>` : ""}`;
        $(".gu-p").textContent = up && o.prev ? `${T("Модель")}: ${T(o.prev.model.n)} → ${T(n.model.n)} · ${T("Фон")}: ${T(o.prev.backdrop.n)} → ${T(n.backdrop.n)}` : T("Номер {0} из {1}", "#" + n.num, Gifts.num(n.supply));
      } else $(".gu-p").textContent = g.msg || T("Подарок добавлен в коллекцию");
    };
    if (live && st) {
      st.zoom = 0.5;
      st.onFrame = (t, s) => {
        const ms = performance.now() - T0;
        if (ms < 480) { s.zoom = 0.5 + 0.85 * back(ms / 480); host.style.setProperty("--e", 0); }
        else if (!boomed) {
          const k = Math.min(1, (ms - 480) / (boomAt - 480));
          host.style.setProperty("--e", k.toFixed(3));
          if (up) { s.vy = 0.02 + 0.34 * k * k; s.zoom = 1.35 - 0.16 * k; }
          else { s.roll = Math.sin(ms * 0.05) * 0.075 * k; s.yaw = -0.5 + Math.sin(ms * 0.031) * 0.18 * k; s.zoom = 1.35 + 0.03 * Math.sin(ms * 0.02) * k; }
        }
        if (!boomed && ms >= boomAt) boom();
        if (boomed) {
          const d = ms - boomAt;
          if (!up && d < 800) { const k = ease(d / 800); s.parts = { lid: lidMat.mmul(lidMat.mtrans(0, k * 3.2, 0), lidMat.mrotZ(k * 1.3)) }; }
          if (!swapped && d >= (up ? 60 : 170)) {
            swapped = true; s.parts = null; s.roll = 0;
            stage.set(fin, 900);
            s.vy = up ? 0.3 : 0.26;
          }
          if (swapped) { const k = (d - (up ? 60 : 170)) / 1100; s.zoom = (up ? 0.9 : 0.35) + (1.32 - (up ? 0.9 : 0.35)) * elastic(k); }
          if (d >= 1300 && !done) finish();
        }
      };
    } else setTimeout(() => { boom(); setTimeout(finish, 600); }, 400);
    if (reducedFx()) { T0 -= boomAt + 1500; }
    el.addEventListener("click", (e) => {
      if (e.target.closest(".gu-ok")) { L.close(); if (o.then) setTimeout(o.then, 300); return; }
      if (!done) T0 -= 650;                                     // тап ускоряет анимацию
    });
    return L;
  },

  // кто видел анимацию открытия (чтобы не показывать её каждый раз)
  seen(id, set) {
    try {
      const a = JSON.parse(localStorage.getItem("dg_gopen") || "[]");
      if (set) { if (!a.includes(id)) { a.push(id); localStorage.setItem("dg_gopen", JSON.stringify(a.slice(-400))); } return true; }
      return a.includes(id);
    } catch (e) { return set ? false : true; }
  },
  // нажали на карточку подарка в переписке: получателю — сначала открытие коробки
  tap(g, m) {
    const prem = String(g.key || "").startsWith("prem:");
    if (!prem && g.id && m && m.sender !== (App.user && App.user.id) && !Gifts.seen(g.id) && !reducedFx() && GiftArt.specOf(g)) {
      Gifts.seen(g.id, 1);
      return Gifts.reveal({ mode: "box", gift: g, then: () => Gifts.detail(g) });
    }
    return Gifts.detail(g);
  },

  // ── окно подарка: 3D-просмотр, характеристики, действия ──
  async detail(g0) {
    const g = Object.assign({}, g0);
    const prem = String(g.key || "").startsWith("prem:");
    const L = Gifts.layer("gd-ov", `<div class="gd-card" role="dialog"><div class="gd-in"><div class="gs-wait"><span class="spin"></span></div></div></div>`, 127);
    const card = L.el.querySelector(".gd-card");
    let full = g, owner = null, stage = null, built = false;
    L.on(() => { if (stage) stage.destroy(); });
    if (g.id) { try { const d = await api("/api/gift/" + g.id); full = Object.assign({}, g, d.gift); owner = d.gift.owner || null; } catch (e) { if (!g.name && !prem) { L.close(); return toast(e.message); } } }
    if (!L.el.isConnected) return;
    const mine = !!(owner && App.user && owner.id === App.user.id);
    const draw = (G) => {
      const isNft = !!G.nft, wornId = App.user && App.user.nft ? App.user.nft.gid : 0, worn = isNft && wornId === G.id, n = G.nft, r = n ? Gifts.rar(n) : null;
      const from = G.from ? `<button class="gd-u" data-u="${G.from.id}">${avatar({ id: G.from.id, name: G.from.name, avatar: G.from.avatar }, "sm")}<span>${esc(dispName(G.from))}</span></button>`
        : `<span class="gd-u off">${GIC.lock}<span>${esc(G.from_me ? T("Вы (имя скрыто)") : T("Скрытый отправитель"))}</span></span>`;
      const ownerRow = isNft && owner ? [T("Владелец"), mine ? `<span class="gd-u me">${avatar({ id: owner.id, name: owner.name, avatar: owner.avatar }, "sm")}<span>${esc(T("Вы"))}</span></span>`
        : `<button class="gd-u" data-u="${owner.id}">${avatar({ id: owner.id, name: owner.name, avatar: owner.avatar }, "sm")}<span>${esc(dispName(owner))}</span></button>`] : null;
      const rows = [];
      if (ownerRow) rows.push(ownerRow);
      rows.push([T("От"), from], [T("Дата"), esc(Gifts.date(G.ts))], [T("Стоимость"), Gifts.stars(G.price)]);
      if (n) rows.push([T("Модель"), `${esc(T(n.model.n))}<em>${n.model.r}%</em>`], [T("Узор"), `${esc(T(n.pattern.n))}<em>${n.pattern.r}%</em>`], [T("Фон"), `${esc(T(n.backdrop.n))}<em>${n.backdrop.r}%</em>`],
        [T("Количество"), esc(T("{0} из {1} выпущено", Gifts.num(n.minted), Gifts.num(n.supply)))]);
      if (prem && G.until && mine) rows.push([T("Premium до"), esc(Gifts.date(G.until))]);
      if (mine && G.can_sell) rows.push([T("Продажа доступна до"), esc(Gifts.date(G.sell_until))]);
      const act = [];
      if (mine && !prem) {
        if (isNft) {
          if (G.up) act.push(`<button class="gd-b main up" data-a="up">${GIC.up}${esc(T("Улучшить"))} ${Gifts.stars(G.up)}<small>${esc(T("уровень {0} из {1}", (n.tier || 0) + 1, (Gifts.cat && Gifts.cat.tiers ? Gifts.cat.tiers.max : 3)))}</small></button>`);
          else act.push(`<div class="gd-max">${GIC.star}${esc(T("Максимальное улучшение"))}</div>`);
          act.push(`<button class="gd-b" data-a="equip">${GIC.wear}${esc(worn ? T("Снять с профиля") : T("Поставить в профиль"))}</button>`);
        }
        act.push(`<div class="gd-row2"><button class="gd-b" data-a="show">${G.shown ? GIC.eyeOff : GIC.eye}${esc(G.shown ? T("Скрыть") : T("Показать"))}</button>
          <button class="gd-b" data-a="pin" ${G.shown ? "" : "disabled"}>${GIC.pin}${esc(G.pin ? T("Открепить") : T("Закрепить"))}</button></div>`);
        if (G.can_sell) act.push(`<button class="gd-b sell" data-a="sell">${GIC.star}${esc(T("Продать за {0}", G.sell_price + " ⭐"))}</button>`);
        else if (G.sold) act.push(`<div class="gd-sold">${esc(T("Подарок продан"))}</div>`);
      }
      const title = isNft ? esc(Gifts.title(G)) : prem ? esc(Gifts.title(G)) : esc(mine ? T("Подарок Вам") : T(G.name || "") || T("Подарок"));
      const sub = isNft ? esc(T("{0} · {1} из {2}", T(G.name), "#" + n.num, Gifts.num(n.supply))) : prem ? esc(T("Подарок: Premium")) : esc(mine ? T(G.name) : T("Подарок"));
      const tiers = isNft ? `<div class="gd-tier" title="${esc(T(n.tier_n))}">${[1, 2, 3].map((i) => `<i class="${i <= (n.tier || 0) ? "on" : ""}">${GIC.star}</i>`).join("")}<span>${esc(T(n.tier_n))}</span></div>` : "";
      const inner = `
        <button class="gd-x" data-x aria-label="${esc(T("Закрыть"))}">${GIC.x}</button>
        <div class="gd-stage-w"><div class="gd-stage"></div>
          ${r ? `<span class="rr r-${esc(r.k)} gd-rr">${esc(T(r.n))}</span>` : ""}${isNft ? `<span class="gd-hint">${GIC.cube}${esc(T("Потяните, чтобы повернуть"))}</span>` : ""}</div>
        <div class="gd-body"><h2>${title}</h2><div class="gd-sub">${sub}</div>${tiers}
        ${G.msg ? `<blockquote class="gd-q">${esc(G.msg)}</blockquote>` : ""}
        <div class="gd-rows">${rows.map(([k, v]) => `<div class="gd-r"><span>${esc(k)}</span><b>${v}</b></div>`).join("")}</div>
        ${isNft ? `<div class="gd-note">${GIC.lock}<span>${esc(T("Этот NFT-подарок хранится в Dicegram. Номер и характеристики закреплены за владельцем."))}</span></div>` : ""}
        ${act.length ? `<div class="gd-acts">${act.join("")}</div>` : ""}</div>`;
      if (!built) {
        built = true;
        card.querySelector(".gd-in").innerHTML = inner;
        const host = card.querySelector(".gd-stage"), sp = GiftArt.specOf(G);
        if (sp) stage = giftStage(host, { sp, zoom: 1.28, still: false });
        else host.innerHTML = `<div class="gd-prem">${GiftArt.prem(+G.months || +String(G.key).slice(5) || 1, { s: 170 })}</div>`;
        card.querySelector("[data-x]").onclick = L.close;
        const h = card.querySelector(".gd-hint"); if (h) { const hide = () => h.classList.add("off"); host.addEventListener("pointerdown", hide, { once: true }); setTimeout(hide, 6000); }
      } else {
        // перерисовываем только нижнюю часть и ярлыки — 3D-сцена остаётся
        const tmp = document.createElement("div"); tmp.innerHTML = inner;
        card.querySelector(".gd-body").replaceWith(tmp.querySelector(".gd-body"));
        const rr = card.querySelector(".gd-rr"), nr = tmp.querySelector(".gd-rr"); if (rr && nr) rr.replaceWith(nr);
      }
    };
    draw(full);
    card.addEventListener("click", async (e) => {
      const u = e.target.closest("[data-u]");
      if (u) {
        const uid = +u.dataset.u;
        const src = owner && owner.id === uid ? owner : full.from;
        L.close();
        return setTimeout(() => UserProfile.open({ id: uid, name: src.name, surname: src.surname || "", avatar: src.avatar || "", username: "", bio: "" }), 280);
      }
      const b = e.target.closest("[data-a]"); if (!b || b.disabled) return;
      haptic();
      const a = b.dataset.a;
      try {
        if (a === "show") { const d = await api("/api/gift/show", { method: "POST", body: { id: full.id, shown: !full.shown } }); full = Object.assign(full, d.gift); draw(full); toast(T(full.shown ? "Подарок виден в профиле" : "Подарок скрыт из профиля")); }
        else if (a === "pin") { const d = await api("/api/gift/show", { method: "POST", body: { id: full.id, pin: !full.pin } }); full = Object.assign(full, d.gift); draw(full); toast(T(full.pin ? "Подарок закреплён" : "Подарок откреплён")); }
        else if (a === "equip") {
          const worn = App.user.nft && App.user.nft.gid === full.id;
          if (!worn && !App.user.premium) { L.close(); return setTimeout(() => PremiumPromo.open(App.user), 280); }
          const d = await api("/api/gift/equip", { method: "POST", body: { id: worn ? 0 : full.id } });
          App.user = d.user; draw(full); toast(T(worn ? "Подарок снят" : "Подарок в профиле"));
        } else if (a === "up") {
          const ok = await UI.sheet({ title: T("Улучшить NFT?"), icon: SI.starF, text: T("Модель, фон и узор выпадут заново и всегда будут реже прежних. Номер сохранится. Стоимость: {0} ⭐.", full.up), actions: [{ label: T("Улучшить"), value: "go", accent: true }] });
          if (ok !== "go") return;
          b.disabled = true;
          const d = await api("/api/gift/upgrade", { method: "POST", body: { id: full.id } });
          App.user = d.user;
          full = Object.assign({}, full, d.gift, { owner });
          if (stage) stage.set(GiftArt.specOf(full), 1);
          draw(full);
          Gifts.reveal({ mode: "upgrade", gift: full, prev: d.prev });
          haptic("medium");
        } else if (a === "sell") {
          const price = full.sell_price;
          const ok = await UI.sheet({ title: T("Продать подарок?"), icon: SI.starF, text: T("Подарок исчезнет из профиля, а на баланс поступит {0} ⭐. Отменить это нельзя.", price), actions: [{ label: T("Продать"), value: "go", accent: true }] });
          if (ok !== "go") return;
          b.disabled = true;
          const d = await api("/api/gift/sell", { method: "POST", body: { id: full.id } });
          App.user = d.user;
          full = Object.assign({}, full, d.gift, { owner });
          toast(T("Подарок продан за {0}", price + " ⭐"));
          L.close();
        }
        Gifts.changed(App.user.id);
      } catch (x) { toast(x.message); b.disabled = false; }
    });
  },

  // ── коллекция в профиле ──
  tile(g) {
    const n = g.nft, r = n ? Gifts.rar(n) : null;
    return `<button class="gt pf${g.shown ? "" : " hid"}" data-g="${g.id}" aria-label="${esc(Gifts.title(g))}">${g.pin ? `<span class="gt-p">${GIC.pin}</span>` : ""}${n ? `<span class="gt-n r-${esc(r.k)}">#${n.num}</span>` : ""}${g.shown ? "" : `<span class="gt-h">${GIC.eyeOff}</span>`}${GiftArt.html(g)}</button>`;
  },
  // сетка подарков + кнопка «Отправить подарок» (в своём профиле — «Магазин подарков»)
  grid(list, u, own) {
    const sendBtn = `<button class="gf-send" data-gsend>${GIC.gift}<span>${esc(own ? T("Купить подарок") : T("Отправить подарок"))}</span></button>`;
    const tot = list.length, nft = list.filter((g) => g.nft).length;
    const head = tot ? `<div class="gf-head"><b>${esc(T("{0} {1}", tot, plural(tot, T("подарок"), T("подарка"), T("подарков"))))}</b>${nft ? `<span>${GIC.cube}${esc(T("NFT: {0}", nft))}</span>` : ""}</div>` : "";
    return `${head}<div class="gg pf">${list.map((g) => Gifts.tile(g)).join("")}</div><div class="gf-bar">${sendBtn}</div>`;
  },
  emptyGrid(own) {
    return `<div class="pf-empty gf-empty"><div class="pf-eic gift">${GIC.gift}</div><h3>${esc(T("Нет подарков"))}</h3><p>${esc(own ? T("Подарки, которые вам отправят или которые вы купите себе, появятся здесь.") : T("Здесь будут подарки, которые получил этот человек."))}</p>
      <div class="gf-bar"><button class="gf-send" data-gsend>${GIC.gift}<span>${esc(own ? T("Купить подарок") : T("Отправить подарок"))}</span></button></div></div>`;
  },

  // ── карточка подарка в переписке ──
  cardHTML(m, isNew) {
    const g = m.gift || {}, out = m.sender === App.user.id;
    const peer = Chat.peer, who = peer ? dispName(peer) : "";
    let head;
    if (out) head = T("Вы подарили подарок: {0}", who);
    else if (g.anon || (m.sender === 1 && peer && peer.is_system)) head = T("Вам подарили подарок. Отправитель скрыт");
    else head = T("{0} дарит вам подарок", who);
    const prem = String(g.key || "").startsWith("prem:"), n = g.nft, r = n ? Gifts.rar(n) : null;
    const name = prem ? Gifts.title(g) : T(g.name || "") || T("Подарок"), nm = prem ? name : name + (n ? " #" + n.num : "");
    return `<div class="gcard${isNew ? " new" : ""}${n ? " nft" : ""}" data-k="${mkey(m)}"${m.id ? ` data-id="${m.id}"` : ""} data-gift="1" role="button" tabindex="0">
      <span class="gc-h">${esc(head)}</span><div class="gc-art">${GiftArt.html(g, { s: 150 })}</div>
      <b class="gc-n">${esc(nm)}</b>${n ? `<span class="rr r-${esc(r.k)} sm">${esc(T(r.n))}</span>` : ""}${g.msg ? `<span class="gc-m">${esc(g.msg)}</span>` : ""}
      <span class="gc-b">${esc(prem ? T("Открыть") : T("Посмотреть"))}</span></div>`;
  },
};
try { if (document.body) GiftArt.init(); else document.addEventListener("DOMContentLoaded", () => GiftArt.init()); } catch (e) {}
