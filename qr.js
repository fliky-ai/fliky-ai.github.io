// qr.js — свой генератор QR-кодов (без внешних библиотек): байтовый режим (UTF-8), коррекция ошибок M, версии 1–14.
//   QR.matrix(text) → { n, at(x, y) }          — матрица модулей (true — тёмный)
//   QR.svg(text, { fg, bg, quiet, hole })      — готовая SVG-разметка; hole — доля ширины, свободная в центре под аватар (0…0.25)
//   QRCard.open(user)                          — окно «QR-код профиля» со ссылкой, копированием и «Поделиться»
const QR = (() => {
  // коррекция уровня M: байтов коррекции на блок и число блоков для версий 1…14
  const ECC = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24];
  const BLK = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9];
  const MAXV = 14;

  const rawModules = (v) => {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) { const a = Math.floor(v / 7) + 2; r -= (25 * a - 10) * a - 55; if (v >= 7) r -= 36; }
    return r;
  };
  const dataCw = (v) => Math.floor(rawModules(v) / 8) - ECC[v] * BLK[v];

  // арифметика Галуа GF(256) и коды Рида — Соломона
  const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; };
  const divisor = (deg) => {
    const r = new Array(deg).fill(0); r[deg - 1] = 1;
    let root = 1;
    for (let i = 0; i < deg; i++) {
      for (let j = 0; j < deg; j++) { r[j] = mul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; }
      root = mul(root, 2);
    }
    return r;
  };
  const remainder = (data, div) => {
    const r = div.map(() => 0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mul(c, f); }); }
    return r;
  };

  const bit = (x, i) => ((x >>> i) & 1) !== 0;

  function encode(text) {
    const bytes = new TextEncoder().encode(text);
    let ver = 1;
    for (;; ver++) {
      if (ver > MAXV) throw new Error("Слишком длинный текст для QR-кода");
      if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= dataCw(ver) * 8) break;
    }
    const bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
    const cap = dataCw(ver) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    for (let p = 0xec; bits.length < cap; p ^= 0xec ^ 0x11) put(p, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; data.push(v); }

    // блоки + коррекция + перемешивание
    const nb = BLK[ver], el = ECC[ver], raw = Math.floor(rawModules(ver) / 8), nShort = nb - (raw % nb), sLen = Math.floor(raw / nb);
    const div = divisor(el), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = data.slice(k, k + sLen - el + (i < nShort ? 0 : 1)); k += dat.length;
      const ecc = remainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const all = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== sLen - el || j >= nShort) all.push(b[i]); });
    return { ver, all };
  }

  function matrix(text) {
    const { ver, all } = encode(text), n = ver * 4 + 17;
    const m = Array.from({ length: n }, () => new Array(n).fill(false)), fn = Array.from({ length: n }, () => new Array(n).fill(false));
    const set = (x, y, d) => { m[y][x] = d; fn[y][x] = true; };

    // служебные узоры
    for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < n && y >= 0 && y < n) set(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(n - 4, 3); finder(3, n - 4);
    const na = ver === 1 ? 0 : Math.floor(ver / 7) + 2, step = na ? Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2 : 0, pos = na ? [6] : [];
    for (let p = n - 7; pos.length < na; p -= step) pos.splice(1, 0, p);
    for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    const format = (mask) => {
      const d = (0 << 3) | mask;                              // уровень M = 00
      let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const bits = ((d << 10) | r) ^ 0x5412;
      for (let i = 0; i <= 5; i++) set(8, i, bit(bits, i));
      set(8, 7, bit(bits, 6)); set(8, 8, bit(bits, 7)); set(7, 8, bit(bits, 8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits, i));
      for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(bits, i));
      for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(bits, i));
      set(8, n - 8, true);
    };
    format(0);
    if (ver >= 7) {
      let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
      const bits = (ver << 12) | r;
      for (let i = 0; i < 18; i++) { const c = bit(bits, i), a = n - 11 + (i % 3), b = Math.floor(i / 3); set(a, b, c); set(b, a, c); }
    }

    // данные змейкой
    let k = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < n; v++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? n - 1 - v : v;
        if (!fn[y][x] && k < all.length * 8) { m[y][x] = bit(all[k >>> 3], 7 - (k & 7)); k++; }
      }
    }

    // маски: берём ту, у которой наименьший штраф
    const apply = (mask) => {
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const inv = [(x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
          ((x * y) % 2) + ((x * y) % 3) === 0, (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][mask];
        if (!fn[y][x] && inv) m[y][x] = !m[y][x];
      }
    };
    const penalty = () => {
      let p = 0, dark = 0;
      const line = (get) => {
        let run = 1, hist = [];
        for (let i = 0; i < n; i++) {
          hist.push(get(i) ? 1 : 0);
          if (i && get(i) === get(i - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
        }
        const s = hist.join("");
        for (let i = 0; i + 11 <= n; i++) { const w = s.substr(i, 11); if (w === "10111010000" || w === "00001011101") p += 40; }
      };
      for (let y = 0; y < n; y++) line((i) => m[y][i]);
      for (let x = 0; x < n; x++) line((i) => m[i][x]);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        if (m[y][x]) dark++;
        if (x + 1 < n && y + 1 < n && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
      }
      p += (Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10;
      return p;
    };
    let best = 0, bp = Infinity;
    for (let mk = 0; mk < 8; mk++) { apply(mk); format(mk); const s = penalty(); if (s < bp) { bp = s; best = mk; } apply(mk); }
    apply(best); format(best);
    return { n, ver, at: (x, y) => m[y][x] };
  }

  // SVG: тёмные модули — скруглённые квадратики; в центре можно оставить место под аватар
  function svg(text, o = {}) {
    const q = matrix(text), n = q.n, quiet = o.quiet === undefined ? 2 : o.quiet, size = n + quiet * 2, fg = o.fg || "#000", hole = o.hole || 0;
    const h = hole ? Math.ceil((n * hole) / 2) : 0, c = n / 2;
    let d = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!q.at(x, y)) continue;
      if (h && Math.abs(x + 0.5 - c) < h && Math.abs(y + 0.5 - c) < h) continue;
      d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">${o.bg ? `<rect width="${size}" height="${size}" fill="${o.bg}"/>` : ""}<path d="${d}" fill="${fg}"/></svg>`;
  }

  return { matrix, svg };
})();

// ───────────── окно «QR-код профиля» ─────────────
const QRCard = {
  // маленькая иконка «QR» для строки @username (кнопка внутри кнопки нельзя — это span с role="button")
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.4"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.4"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.4"/><path d="M14 14h2.5v2.5H14zM19 14h1.5M14 19.5h1.5M18 18v2.5h2.5"/></svg>`,
  btn() { return `<span class="pi-qr" data-qr role="button" tabindex="0" aria-label="${esc(T("QR-код"))}">${QRCard.icon}</span>`; },
  async open(u) {
    let link = u.plink || "";
    if (!link) { try { link = (await api("/api/user/" + u.id)).user.plink || ""; } catch (e) {} }
    if (!link) return toast(T("Сначала задайте имя пользователя"));
    let code, frac;
    try {
      const n = QR.matrix(link).n;
      frac = (2 * Math.ceil((n * 0.2) / 2)) / n;               // доля ширины, оставленная в центре под аватар
      code = QR.svg(link, { fg: "#17212B", hole: 0.2, quiet: 0 });
    } catch (e) { return toast(e.message); }
    const L = Gifts.layer("gb-ov qr-ov", `<div class="gb-card qr-card" role="dialog"><button class="gb-x" data-x aria-label="${esc(T("Закрыть"))}">${GIC.x}</button>
      <div class="qr-box"><div class="qr-code" style="--hole:${(frac * 100).toFixed(2)}%">${code}<span class="qr-av">${avatar(u, "")}</span></div></div>
      <h3>${esc(dispName(u))}</h3><p class="qr-un">@${esc(u.username || "")}</p>
      <p class="qr-hint">${esc(T("Сканируйте, чтобы открыть профиль"))}</p>
      <div class="qr-b"><button data-a="copy">${esc(T("Ссылка на профиль"))}</button><button data-a="share">${esc(T("Поделиться"))}</button></div></div>`, 128);
    L.el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      haptic();
      if (b.dataset.a === "copy") { copyText(link); return toast(T("Ссылка скопирована")); }
      try { if (navigator.share) return await navigator.share({ title: dispName(u), url: link }); } catch (er) { return; }
      copyText(link); toast(T("Ссылка скопирована"));
    });
  },
};
