// premium.js — анимированные значки Premium (эмодзи-статус), окно «Premium» по нажатию на значок,
// выбор статуса и свои эмодзи (наборы). Значок показывается только в профиле: в Настройках и в списках его нет.

// ═════════════ КАТАЛОГ АНИМИРОВАННЫХ ЗНАЧКОВ ═════════════
let _eg = 0;
const eid = () => "e" + ++_eg + "_";
const LG = (id, a, b, x1 = 0, y1 = 0, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const RG = (id, a, b, cx = 0.4, cy = 0.35, r = 0.75) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>`;
const starP = (cx, cy, R, r, n = 5, rot = -90) => {
  let d = "";
  for (let k = 0; k < n * 2; k++) { const a = ((rot + (k * 180) / n) * Math.PI) / 180, q = k % 2 ? r : R; d += (k ? "L" : "M") + (cx + q * Math.cos(a)).toFixed(1) + " " + (cy + q * Math.sin(a)).toFixed(1); }
  return d + "Z";
};
// искорка: четыре лепестка, мерцает
const SP = (x, y, s, dl, col = "#fff") => `<path class="a-tw" style="animation-delay:${dl}s" d="M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}z" fill="${col}"/>`;
// блик, пробегающий по фигуре (clip — id обрезки)
const SH = (clip, dl = 0, op = 0.6) => `<g clip-path="url(#${clip})"><rect class="a-shine" style="animation-delay:${dl}s" x="-14" y="-6" width="9" height="76" fill="#fff" opacity="${op}"/></g>`;
const rays = (n, cx, cy, r1, r2, w, fill) => {
  let s = "";
  for (let k = 0; k < n; k++) s += `<rect x="${cx - w / 2}" y="${cy - r2}" width="${w}" height="${r2 - r1}" rx="${w / 2}" fill="${fill}" transform="rotate(${(360 / n) * k} ${cx} ${cy})"/>`;
  return s;
};

const ES = {
  // id, название, ключевые слова, категория, цвета шапки профиля, рисунок
  items: [
    { id: "star", t: "Звезда", k: "star звезда золото gold", cat: "space", c: ["#FFD54A", "#F59E0B"], f: (i) => `<defs>${LG(i + "a", "#FFEC99", "#F6A200", 0.2, 0, 0.8, 1)}<clipPath id="${i}c"><path d="${starP(32, 34, 28, 14)}"/></clipPath></defs>
      <g class="a-pulse"><path d="${starP(32, 34, 23, 11)}" fill="url(#${i}a)" stroke="url(#${i}a)" stroke-width="8" stroke-linejoin="round"/>
      <path d="${starP(32, 35, 12, 5.5)}" fill="#fff" opacity=".4"/>${SH(i + "c", 0, 0.7)}</g>${SP(9, 13, 5, 0)}${SP(56, 17, 4, 0.7)}${SP(53, 55, 5, 1.3)}` },

    { id: "diamond", t: "Бриллиант", k: "diamond бриллиант алмаз кристалл gem", cat: "space", c: ["#7FE3FF", "#3A7BFF"], f: (i) => `<defs><clipPath id="${i}c"><path d="M20 12h24l14 14-26 30L6 26z"/></clipPath></defs>
      <g class="a-float"><g stroke="#fff" stroke-opacity=".55" stroke-width="1.2" stroke-linejoin="round">
      <path d="M6 26 20 12 26 26z" fill="#A9F0FF"/><path d="M20 12h24L38 26H26z" fill="#6FD6FF"/><path d="M44 12l14 14H38z" fill="#46AEFF"/>
      <path d="M6 26h20l6 30z" fill="#4C93FF"/><path d="M26 26h12L32 56z" fill="#86DFFF"/><path d="M38 26h20L32 56z" fill="#2F6BE8"/></g>${SH(i + "c", 0.4, 0.55)}</g>${SP(8, 10, 5, 0.2)}${SP(57, 12, 4, 1)}${SP(54, 52, 3.5, 1.7)}` },

    { id: "crown", t: "Корона", k: "crown корона король king", cat: "awards", c: ["#FFCF4A", "#E8890C"], f: (i) => `<defs>${LG(i + "a", "#FFE680", "#F0A000")}${LG(i + "b", "#F5B820", "#C97A00")}<clipPath id="${i}c"><path d="M9 52 7 22l15 11 10-20 10 20 15-11-2 30z"/></clipPath></defs>
      <g class="a-float"><path d="M10 50 8 22l14 11 10-20 10 20 14-11-2 28z" fill="url(#${i}a)" stroke="url(#${i}a)" stroke-width="3" stroke-linejoin="round"/>
      <rect x="9" y="46" width="46" height="10" rx="4" fill="url(#${i}b)"/>
      <circle cx="8" cy="22" r="3.6" fill="#FFF3B0"/><circle cx="32" cy="12" r="3.8" fill="#FFF3B0"/><circle cx="56" cy="22" r="3.6" fill="#FFF3B0"/>
      <circle cx="32" cy="51" r="3.2" fill="#FF3F66"/><circle cx="19" cy="51" r="2.5" fill="#3DA5FF"/><circle cx="45" cy="51" r="2.5" fill="#35D49A"/>${SH(i + "c", 0.3, 0.6)}</g>${SP(14, 8, 4, 0.5)}${SP(52, 10, 4, 1.2)}` },

    { id: "heart", t: "Сердце", k: "heart сердце любовь love", cat: "awards", c: ["#FF7C98", "#E0245E"], f: (i) => `<defs>${LG(i + "a", "#FF8FA8", "#E0183F", 0.3, 0, 0.7, 1)}</defs>
      <g class="a-beat"><path d="M32 57C11 41 5 30 5 21a13.5 13.5 0 0 1 27-5.5A13.5 13.5 0 0 1 59 21c0 9-6 20-27 36z" fill="url(#${i}a)"/>
      <path d="M13 19c0-4 3-7 7-7" stroke="#fff" stroke-width="3.5" stroke-linecap="round" fill="none" opacity=".6"/></g>
      <path class="a-rise" d="M50 20c-3-2-5 1-3 3l3 3 3-3c2-2 0-5-3-3z" fill="#FFB3C4"/><path class="a-rise" style="animation-delay:1.1s" d="M14 22c-2-1.500-4 .8-2.300 2.300l2.300 2.300 2.300-2.300c1.700-1.500-.3-3.800-2.300-2.300z" fill="#FFB3C4"/>` },

    { id: "fire", t: "Огонь", k: "fire огонь пламя hot flame", cat: "nature", c: ["#FFB03A", "#F0431F"], f: (i) => `<defs>${LG(i + "a", "#FF9A1F", "#E8261A")}${LG(i + "b", "#FFD34A", "#FF7A18")}</defs>
      <path class="a-flick" style="transform-origin:50% 100%" d="M33 3c2 12 17 19 17 35 0 11-8 20-18 20S14 49 14 38c0-8 5-13 8-19 2 6 5 8 7 8 2-6 1-16 4-24z" fill="url(#${i}a)"/>
      <path class="a-flick" style="transform-origin:50% 100%;animation-delay:.25s" d="M32 58c-8 0-12-7-12-14 0-7 5-10 7-15 2 5 5 6 6 4 2 4 11 5 11 13 0 7-5 12-12 12z" fill="url(#${i}b)"/>
      <path class="a-flick" style="transform-origin:50% 100%;animation-delay:.5s" d="M32 58c-5 0-7-4-7-8 0-5 4-7 6-10 2 4 8 6 8 11 0 4-3 7-7 7z" fill="#FFF0A0"/>${SP(12, 14, 3.500, 0.3, "#FFD34A")}${SP(54, 22, 3, 1, "#FFD34A")}` },

    { id: "rocket", t: "Ракета", k: "rocket ракета космос space", cat: "space", c: ["#7C9DFF", "#5B3FE0"], f: (i) => `<defs>${LG(i + "a", "#FFFFFF", "#CFD8EC", 0, 0, 1, 0)}${LG(i + "b", "#FFD34A", "#FF5A1F")}${RG(i + "w", "#9FE0FF", "#2A6BDD")}</defs>
      <g class="a-float"><g transform="rotate(35 32 32)">
      <path class="a-flick" style="transform-origin:50% 0%" d="M26 49c1 7 6 12 6 12s5-5 6-12z" fill="url(#${i}b)"/>
      <path d="M21 36 10 50l11-3zM43 36l11 14-11-3z" fill="#E8403A"/>
      <path d="M32 3c10 9 14 24 12 41H20C18 27 22 12 32 3z" fill="url(#${i}a)"/>
      <path d="M32 3c4 3.500 7 8 9 13H23c2-5 5-9.500 9-13z" fill="#E8403A"/>
      <circle cx="32" cy="29" r="6.500" fill="#fff"/><circle cx="32" cy="29" r="4.800" fill="url(#${i}w)"/><path d="M29.500 27a3 3 0 0 1 3-2" stroke="#fff" stroke-width="1.400" stroke-linecap="round" fill="none"/>
      <path d="M23 44h18l-2.500 5h-13z" fill="#7B8498"/></g></g>${SP(10, 10, 4, 0)}${SP(55, 52, 3.500, 0.9)}` },

    { id: "moon", t: "Луна", k: "moon луна месяц ночь night", cat: "nature", c: ["#8B7CFF", "#2B2F6B"], f: (i) => `<defs>${LG(i + "a", "#FFF6C2", "#F2B93B", 0.2, 0, 0.8, 1)}<mask id="${i}m"><rect width="64" height="64" fill="#fff"/><circle cx="42" cy="24" r="19" fill="#000"/></mask></defs>
      <g class="a-sway"><circle cx="29" cy="35" r="24" fill="url(#${i}a)" mask="url(#${i}m)"/>
      <circle cx="19" cy="42" r="3" fill="#E8A92A" opacity=".5" mask="url(#${i}m)"/><circle cx="25" cy="52" r="2" fill="#E8A92A" opacity=".5"/></g>
      ${SP(48, 14, 5.5, 0)}${SP(56, 36, 4, 0.8)}${SP(44, 48, 3.5, 1.5)}${SP(36, 8, 3, 2)}` },

    { id: "sun", t: "Солнце", k: "sun солнце день лето summer", cat: "nature", c: ["#FFD54A", "#FF8A1F"], f: (i) => `<defs>${RG(i + "a", "#FFF3A0", "#FFA020")}</defs>
      <g class="a-spin-s">${rays(12, 32, 32, 20, 29, 4.500, "#FFC83D")}</g>
      <circle class="a-pulse" cx="32" cy="32" r="15" fill="url(#${i}a)"/><circle cx="27" cy="27" r="4.500" fill="#fff" opacity=".45"/>` },

    { id: "bolt", t: "Молния", k: "bolt молния гроза energy energy zap", cat: "nature", c: ["#FFE55A", "#FF9F1A"], f: (i) => `<defs>${LG(i + "a", "#FFF27A", "#FF9A1A")}<clipPath id="${i}c"><path d="M38 4 14 36h14l-4 24 26-36H36z"/></clipPath></defs>
      <g class="a-flash"><path d="M38 4 14 36h14l-4 24 26-36H36z" fill="url(#${i}a)" stroke="url(#${i}a)" stroke-width="5" stroke-linejoin="round"/>
      <path d="M36 12 22 33" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".6"/>${SH(i + "c", 0.2, 0.6)}</g>${SP(10, 14, 4, 0.3, "#FFF27A")}${SP(55, 46, 4.5, 1)}` },

    { id: "rainbow", t: "Радуга", k: "rainbow радуга облако cloud", cat: "nature", c: ["#7FD3FF", "#B57BFF"], f: () => {
      const cols = ["#FF4B5C", "#FF9A3D", "#FFD83D", "#42CF7A", "#3D9BFF"];
      return `<g class="a-float">${cols.map((c, k) => `<path d="M${6 + k * 3.600} 46A${26 - k * 3.600} ${26 - k * 3.600} 0 0 1 ${58 - k * 3.600} 46" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="butt"/>`).join("")}
      <g class="a-drift" fill="#fff"><circle cx="11" cy="47" r="6.500"/><circle cx="19" cy="45" r="7.500"/><circle cx="16" cy="51" r="6"/><circle cx="53" cy="47" r="6.500"/><circle cx="45" cy="45" r="7.500"/><circle cx="48" cy="51" r="6"/></g></g>${SP(32, 8, 4, 0.5)}`; } },

    { id: "clover", t: "Клевер", k: "clover клевер удача luck", cat: "nature", c: ["#5BE08A", "#16915A"], f: (i) => `<defs>${LG(i + "a", "#7BF0A0", "#1FA35F")}</defs>
      <g class="a-sway"><path d="M32 32c2 12 8 20 16 24" stroke="#1A8A52" stroke-width="3.500" stroke-linecap="round" fill="none"/>
      ${[0, 90, 180, 270].map((a) => `<path d="M32 32C21 28 12 20 17 12c4-6 13-4 15 4 2-8 11-10 15-4 5 8-4 16-15 20z" fill="url(#${i}a)" transform="rotate(${a} 32 32) translate(32 32) scale(.84) translate(-32 -32)"/>`).join("")}
      <circle cx="32" cy="32" r="3" fill="#CFFAD9"/></g>${SP(10, 12, 4, 0.2)}${SP(55, 14, 3.500, 1)}` },

    { id: "flower", t: "Цветок", k: "flower цветок роза весна spring", cat: "nature", c: ["#FF9AD0", "#E9569B"], f: (i) => `<defs>${LG(i + "a", "#FFC2E2", "#F0539A")}${RG(i + "b", "#FFF3A0", "#FFB020")}</defs>
      <g class="a-spin-s">${Array.from({ length: 8 }, (_, k) => `<ellipse cx="32" cy="17" rx="6.500" ry="12.500" fill="url(#${i}a)" transform="rotate(${k * 45} 32 32)" opacity=".96"/>`).join("")}</g>
      <circle class="a-pulse" cx="32" cy="32" r="8" fill="url(#${i}b)"/><circle cx="29" cy="29" r="2.200" fill="#fff" opacity=".6"/>` },

    { id: "snow", t: "Снежинка", k: "snow снежинка зима winter холод ice", cat: "nature", c: ["#9FE3FF", "#4C8DFF"], f: (i) => `<defs>${LG(i + "a", "#E6F9FF", "#6FC8FF")}</defs>
      <g class="a-spin-s" stroke="url(#${i}a)" stroke-width="3" stroke-linecap="round" fill="none">${Array.from({ length: 6 }, (_, k) => `<g transform="rotate(${k * 60} 32 32)"><path d="M32 32V6"/><path d="M32 14.500l-5.500-5.500M32 14.500l5.500-5.500"/><path d="M32 22.500l-3.500-3.500M32 22.500l3.500-3.500"/></g>`).join("")}</g>
      <circle cx="32" cy="32" r="4" fill="#fff"/>${SP(10, 12, 3.500, 0.2)}${SP(56, 50, 3.500, 1)}` },

    { id: "ghost", t: "Привидение", k: "ghost привидение призрак хэллоуин halloween", cat: "face", c: ["#B79CFF", "#5B3FB8"], f: (i) => `<defs>${LG(i + "a", "#FFFFFF", "#D3DBFF")}</defs>
      <ellipse class="a-shadow" cx="32" cy="60" rx="14" ry="2.600" fill="#000" opacity=".18"/>
      <g class="a-float"><path d="M13 54V30a19 19 0 0 1 38 0v24l-6.500-5-6 5-6.500-5-6.500 5-6-5z" fill="url(#${i}a)"/>
      <g class="a-blink" fill="#27304F"><ellipse cx="25" cy="30" rx="3.200" ry="4.600"/><ellipse cx="39" cy="30" rx="3.200" ry="4.600"/></g>
      <ellipse cx="32" cy="40" rx="3" ry="3.800" fill="#27304F"/><circle cx="19" cy="38" r="3" fill="#FFA3C4" opacity=".6"/><circle cx="45" cy="38" r="3" fill="#FFA3C4" opacity=".6"/></g>` },

    { id: "emerald", t: "Изумруд", k: "emerald изумруд камень gem green", cat: "space", c: ["#5BE0A5", "#0E8F6B"], f: (i) => `<defs>${LG(i + "a", "#6BF0B0", "#0E9A66")}${LG(i + "b", "#C8FFE4", "#35C98C")}<clipPath id="${i}c"><path d="M22 8h20l16 14v20L42 56H22L6 42V22z"/></clipPath></defs>
      <g class="a-pulse"><path d="M22 8h20l16 14v20L42 56H22L6 42V22z" fill="url(#${i}a)" stroke="#fff" stroke-opacity=".5" stroke-width="1.300" stroke-linejoin="round"/>
      <path d="M24 16h16l10 9v14l-10 9H24L14 39V25z" fill="url(#${i}b)" opacity=".55"/><path d="M20 22l8-5" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/>${SH(i + "c", 0.5, 0.6)}</g>${SP(8, 10, 4.500, 0)}${SP(57, 52, 4, 1.100)}` },

    { id: "planet", t: "Планета", k: "planet планета сатурн saturn space космос", cat: "space", c: ["#FFB36B", "#7A3FD6"], f: (i) => `<defs>${LG(i + "a", "#FFC27A", "#D9602E", 0.2, 0, 0.8, 1)}<clipPath id="${i}c"><circle cx="32" cy="32" r="16"/></clipPath></defs>
      <g class="a-wob"><g transform="rotate(-20 32 32)"><path d="M3 32a29 9 0 0 1 58 0" fill="none" stroke="#B8A4FF" stroke-width="3.600"/>
      <circle cx="32" cy="32" r="16" fill="url(#${i}a)"/><g clip-path="url(#${i}c)"><rect x="14" y="28" width="36" height="3.500" fill="#fff" opacity=".22"/><rect x="14" y="36" width="36" height="2.500" fill="#7A2A10" opacity=".18"/></g>
      <circle cx="26" cy="26" r="4" fill="#fff" opacity=".32"/>
      <path d="M3 32a29 9 0 0 0 58 0" fill="none" stroke="#D9CBFF" stroke-width="3.600"/></g></g>${SP(10, 10, 4, 0.3)}${SP(56, 14, 3.500, 1)}${SP(52, 56, 3, 1.600)}` },

    { id: "trophy", t: "Кубок", k: "trophy кубок победа winner award приз", cat: "awards", c: ["#FFD54A", "#D98A0B"], f: (i) => `<defs>${LG(i + "a", "#FFEA8A", "#E9A100", 0, 0, 1, 1)}${LG(i + "b", "#F7BE28", "#B87000")}<clipPath id="${i}c"><path d="M17 6h30v18a15 15 0 0 1-30 0z"/></clipPath></defs>
      <g class="a-pulse"><path d="M17 11H8c0 11 4 16 11 17M47 11h9c0 11-4 16-11 17" fill="none" stroke="url(#${i}b)" stroke-width="3.800" stroke-linecap="round"/>
      <path d="M17 6h30v18a15 15 0 0 1-30 0z" fill="url(#${i}a)"/><rect x="28.500" y="38" width="7" height="9" fill="url(#${i}b)"/><path d="M19 58v-4a5 5 0 0 1 5-5h16a5 5 0 0 1 5 5v4z" fill="url(#${i}b)"/>
      <path d="${starP(32, 22, 7.500, 3.200)}" fill="#fff" opacity=".85"/>${SH(i + "c", 0.2, 0.65)}</g>${SP(8, 8, 4, 0.6)}${SP(57, 8, 4, 1.300)}` },

    { id: "balloon", t: "Шарик", k: "balloon шарик праздник party", cat: "awards", c: ["#FF8A9A", "#D63A5C"], f: (i) => `<defs>${RG(i + "a", "#FF9AA8", "#D2223F", 0.35, 0.3, 0.8)}</defs>
      <g class="a-float"><g class="a-sway" style="transform-origin:50% 100%"><path d="M32 49c-5 5 5 8 0 13" stroke="#8A93A6" stroke-width="1.600" fill="none" stroke-linecap="round"/>
      <ellipse cx="32" cy="26" rx="16" ry="20" fill="url(#${i}a)"/><path d="M29 46l3 5 3-5z" fill="#C41F3B"/><ellipse cx="25" cy="17" rx="3.500" ry="6" fill="#fff" opacity=".45" transform="rotate(25 25 17)"/></g></g>${SP(9, 12, 3.500, 0.4)}${SP(56, 30, 4, 1.200)}` },

    { id: "butterfly", t: "Бабочка", k: "butterfly бабочка нежность", cat: "nature", c: ["#C79BFF", "#E9569B"], f: (i) => `<defs>${LG(i + "a", "#B07BFF", "#6A4AE8", 0, 0, 1, 1)}${LG(i + "b", "#FF9AD0", "#E9569B", 0, 0, 1, 1)}</defs>
      <g class="a-float">
      <g class="a-flap" style="transform-origin:100% 50%"><path d="M31 30C22 6 3 8 5 24c1 9 15 12 26 8z" fill="url(#${i}a)"/><path d="M31 35C19 33 9 42 15 52c6 7 15-5 16-17z" fill="url(#${i}b)"/><circle cx="14" cy="21" r="3.200" fill="#fff" opacity=".7"/></g>
      <g class="a-flap" style="transform-origin:0% 50%"><path d="M33 30C42 6 61 8 59 24c-1 9-15 12-26 8z" fill="url(#${i}a)"/><path d="M33 35c12-2 22 7 16 17-6 7-15-5-16-17z" fill="url(#${i}b)"/><circle cx="50" cy="21" r="3.200" fill="#fff" opacity=".7"/></g>
      <rect x="29.800" y="22" width="4.400" height="26" rx="2.200" fill="#3A2C66"/><path d="M31 23c-2-6-5-9-8-10M33 23c2-6 5-9 8-10" stroke="#3A2C66" stroke-width="1.600" fill="none" stroke-linecap="round"/></g>` },

    { id: "orb", t: "Магический шар", k: "orb шар магия магический magic crystal предсказание", cat: "space", c: ["#C9A8FF", "#4B24A8"], f: (i) => `<defs>${RG(i + "a", "#E5D4FF", "#4B24A8", 0.35, 0.3, 0.85)}${LG(i + "b", "#8A5A2B", "#4E2D12")}<clipPath id="${i}c"><circle cx="32" cy="29" r="21"/></clipPath></defs>
      <path d="M17 58l4-12h22l4 12z" fill="url(#${i}b)"/>
      <g class="a-float"><circle cx="32" cy="29" r="21" fill="url(#${i}a)"/><g clip-path="url(#${i}c)"><g class="a-spin-s"><path d="${starP(32, 29, 12, 5, 4)}" fill="#fff" opacity=".35"/></g></g>
      <ellipse cx="24" cy="19" rx="5" ry="8" fill="#fff" opacity=".35" transform="rotate(30 24 19)"/>${SP(38, 24, 4, 0.2)}${SP(27, 35, 3.500, 0.9)}${SP(40, 38, 3, 1.500)}</g>` },

    { id: "gift", t: "Подарок", k: "gift подарок бант present", cat: "awards", c: ["#FF7C8A", "#B8325A"], f: (i) => `<defs>${LG(i + "a", "#FF7A8A", "#D92B4B")}${LG(i + "b", "#FFE680", "#F0A000", 0, 0, 1, 0)}</defs>
      <g class="a-bounce"><rect x="10" y="29" width="44" height="28" rx="4" fill="url(#${i}a)"/><rect x="7" y="21" width="50" height="12" rx="3.500" fill="#E8405E"/>
      <rect x="28" y="21" width="8" height="36" fill="url(#${i}b)"/><path d="M32 21c-4-9-15-9-14-3 1 5 9 3 14 3zM32 21c4-9 15-9 14-3-1 5-9 3-14 3z" fill="none" stroke="url(#${i}b)" stroke-width="3.800" stroke-linejoin="round"/></g>${SP(9, 12, 4, 0.3)}${SP(56, 14, 4.500, 1)}` },

    { id: "cat", t: "Котик", k: "cat кот котик кошка cat pet", cat: "face", c: ["#FFC27A", "#E27A2B"], f: (i) => `<defs>${LG(i + "a", "#FFC983", "#F08A32")}</defs>
      <g class="a-wob"><path d="M10 28 11 5l17 12zM54 28 53 5 36 17z" fill="url(#${i}a)"/><path d="M14 22l1-10 8 6zM50 22l-1-10-8 6z" fill="#FFA3B8"/>
      <ellipse cx="32" cy="37" rx="23" ry="19" fill="url(#${i}a)"/><path d="M32 19v7M26 20l1 5M38 20l-1 5" stroke="#C25A12" stroke-width="2.400" stroke-linecap="round"/>
      <g class="a-blink" fill="#27304F"><ellipse cx="22.500" cy="35" rx="3.200" ry="4.800"/><ellipse cx="41.500" cy="35" rx="3.200" ry="4.800"/></g><circle cx="23.500" cy="33.500" r="1.200" fill="#fff"/><circle cx="42.500" cy="33.500" r="1.200" fill="#fff"/>
      <path d="M29.500 42h5l-2.500 3z" fill="#E8517A"/><path d="M32 45c0 3-4 4-6 2M32 45c0 3 4 4 6 2" stroke="#7A3A12" stroke-width="1.800" fill="none" stroke-linecap="round"/>
      <path d="M8 40l9 1.500M8 46l9-1.500M56 40l-9 1.500M56 46l-9-1.500" stroke="#fff" stroke-width="1.400" stroke-linecap="round" opacity=".85"/></g>` },

    { id: "smile", t: "Улыбка", k: "smile улыбка смайлик happy face", cat: "face", c: ["#FFE45C", "#FF9F2E"], f: (i) => `<defs>${RG(i + "a", "#FFF08A", "#FFA928", 0.35, 0.3, 0.85)}</defs>
      <g class="a-bounce"><circle cx="32" cy="32" r="25" fill="url(#${i}a)"/><ellipse cx="22" cy="28" rx="3.200" ry="4.800" fill="#5A3A0C"/>
      <ellipse class="a-wink" cx="42" cy="28" rx="3.200" ry="4.800" fill="#5A3A0C"/><path d="M19 39c3 9 23 9 26 0" fill="none" stroke="#5A3A0C" stroke-width="3.800" stroke-linecap="round"/>
      <circle cx="16" cy="38" r="3.600" fill="#FF7A5C" opacity=".4"/><circle cx="48" cy="38" r="3.600" fill="#FF7A5C" opacity=".4"/><ellipse cx="22" cy="15" rx="8" ry="3.500" fill="#fff" opacity=".35" transform="rotate(-25 22 15)"/></g>` },

    { id: "cool", t: "Круто", k: "cool круто очки sunglasses", cat: "face", c: ["#FFE45C", "#FF8A2E"], f: (i) => `<defs>${RG(i + "a", "#FFF08A", "#FFA928", 0.35, 0.3, 0.85)}${LG(i + "g", "#2B3350", "#0B0F1E")}<clipPath id="${i}c"><rect x="7" y="22" width="50" height="16" rx="6"/></clipPath></defs>
      <g class="a-bounce"><circle cx="32" cy="32" r="25" fill="url(#${i}a)"/><path d="M8 26h48v5c0 6-4 9-10 9-7 0-9-4-11-8h-6c-2 4-4 8-11 8-6 0-10-3-10-9z" fill="url(#${i}g)"/>
      <rect x="7" y="22" width="50" height="5" rx="2.500" fill="#0B0F1E"/>${SH(i + "c", 0.4, 0.5)}
      <path d="M21 47c6 5 16 4 22-2" fill="none" stroke="#5A3A0C" stroke-width="3.600" stroke-linecap="round"/></g>${SP(55, 10, 4, 0.2)}` },

    { id: "lovef", t: "Влюблённый", k: "love влюблённый сердечки heart eyes face", cat: "face", c: ["#FFE45C", "#FF6B8A"], f: (i) => `<defs>${RG(i + "a", "#FFF08A", "#FFA928", 0.35, 0.3, 0.85)}</defs>
      <g class="a-bounce"><circle cx="32" cy="34" r="24" fill="url(#${i}a)"/>
      <path class="a-beat" d="M21 38c-8-5-9-11-5-14 3-2 5 0 5 2 0-2 3-4 5-2 4 3 3 9-5 14z" fill="#E8244F" transform="translate(0 -4)"/>
      <path class="a-beat" style="animation-delay:.15s" d="M43 38c-8-5-9-11-5-14 3-2 5 0 5 2 0-2 3-4 5-2 4 3 3 9-5 14z" fill="#E8244F" transform="translate(0 -4)"/>
      <path d="M20 42c3 9 21 9 24 0z" fill="#7A2A1A"/><path d="M26 49c3 2 9 2 12 0-1-3-11-3-12 0z" fill="#FF7A8A"/></g>
      <path class="a-rise" d="M50 14c-3-2-5 1-3 3l3 3 3-3c2-2 0-5-3-3z" fill="#FF5A7A"/><path class="a-rise" style="animation-delay:1.200s" d="M13 16c-2-1.500-4 .8-2.300 2.300l2.300 2.300 2.300-2.300c1.700-1.500-.3-3.800-2.300-2.300z" fill="#FF5A7A"/>` },

    { id: "alien", t: "Пришелец", k: "alien пришелец инопланетянин нло ufo", cat: "face", c: ["#8CF08C", "#2A8A3E"], f: (i) => `<defs>${LG(i + "a", "#B8FFA0", "#35B24E", 0.2, 0, 0.8, 1)}</defs>
      <g class="a-float"><path d="M32 5c18 0 26 17 22 31-4 14-14 22-22 22S14 50 10 36C6 22 14 5 32 5z" fill="url(#${i}a)"/>
      <g class="a-blink"><ellipse cx="21" cy="34" rx="8.500" ry="5.600" fill="#10201A" transform="rotate(28 21 34)"/><ellipse cx="43" cy="34" rx="8.500" ry="5.600" fill="#10201A" transform="rotate(-28 43 34)"/></g>
      <circle cx="18" cy="32" r="1.800" fill="#fff"/><circle cx="40" cy="32" r="1.800" fill="#fff"/><path d="M27 48c3 2 7 2 10 0" stroke="#1B5E2B" stroke-width="2.200" fill="none" stroke-linecap="round"/><ellipse cx="25" cy="15" rx="5" ry="2.500" fill="#fff" opacity=".4" transform="rotate(-25 25 15)"/></g>${SP(56, 12, 3.500, 0.4)}` },

    { id: "robot", t: "Робот", k: "robot робот бот bot ai", cat: "face", c: ["#9FB4D6", "#4A5F8C"], f: (i) => `<defs>${LG(i + "a", "#E6ECF7", "#9AA9C4")}</defs>
      <g class="a-float"><path d="M32 16V8" stroke="#8793AD" stroke-width="3" stroke-linecap="round"/><circle class="a-flash" cx="32" cy="6.500" r="3.800" fill="#FF4B5C"/>
      <rect x="6" y="28" width="6" height="12" rx="3" fill="#8793AD"/><rect x="52" y="28" width="6" height="12" rx="3" fill="#8793AD"/>
      <rect x="11" y="16" width="42" height="36" rx="10" fill="url(#${i}a)"/><rect x="16" y="22" width="32" height="22" rx="6" fill="#18223C"/>
      <g class="a-blink" fill="#4BE3FF"><rect x="21" y="28" width="7" height="8" rx="3"/><rect x="36" y="28" width="7" height="8" rx="3"/></g>
      <path d="M26 41h12" stroke="#4BE3FF" stroke-width="2" stroke-linecap="round" opacity=".7"/><circle cx="16" cy="48" r="1.400" fill="#8793AD"/><circle cx="48" cy="48" r="1.400" fill="#8793AD"/></g>` },

    { id: "note", t: "Музыка", k: "note музыка нота music song", cat: "awards", c: ["#B28CFF", "#E9569B"], f: (i) => `<defs>${LG(i + "a", "#B07BFF", "#F0539A", 0, 0, 1, 1)}</defs>
      <g class="a-bounce"><ellipse cx="19" cy="49" rx="8" ry="6" fill="url(#${i}a)" transform="rotate(-20 19 49)"/><ellipse cx="45" cy="43" rx="8" ry="6" fill="url(#${i}a)" transform="rotate(-20 45 43)"/>
      <rect x="24.500" y="14" width="4.500" height="35" rx="2" fill="url(#${i}a)"/><rect x="50.500" y="8" width="4.500" height="35" rx="2" fill="url(#${i}a)"/>
      <path d="M26 12 53 5v10l-27 7z" fill="url(#${i}a)"/></g>${SP(9, 22, 4, 0.2)}${SP(58, 54, 3.500, 1)}` },

    { id: "comet", t: "Комета", k: "comet комета метеор падающая звезда shooting", cat: "space", c: ["#7FC8FF", "#6E4AE0"], f: (i) => `<defs>${LG(i + "a", "#FFFFFF", "#6FB6FF", 1, 0, 0, 1)}${LG(i + "t", "rgba(140,205,255,0)", "#EAF7FF", 0, 1, 1, 0)}${LG(i + "s", "#FFF1A8", "#FFB830")}</defs>
      <g class="a-comet"><path d="M4 60C14 40 28 26 42 20l-3 8C30 34 18 46 4 60z" fill="url(#${i}t)"/><path d="M12 62C22 46 32 38 44 31l-1 5C34 42 24 52 12 62z" fill="url(#${i}t)" opacity=".75"/>
      <path d="${starP(46, 18, 12, 5.500)}" fill="url(#${i}s)" stroke="url(#${i}s)" stroke-width="4" stroke-linejoin="round"/></g>${SP(12, 14, 4, 0.1)}${SP(56, 46, 4, 0.9)}${SP(30, 8, 3, 1.600)}` },
  ],
  cats: [
    { id: "all", t: "Все", ic: "✨" }, { id: "face", t: "Лица", ic: "😀" }, { id: "nature", t: "Природа", ic: "🌿" },
    { id: "space", t: "Космос и магия", ic: "🚀" }, { id: "awards", t: "Награды", ic: "🏆" },
  ],
  byId(id) { return ES.items.find((x) => x.id === id) || ES.items[0]; },
  svg(id) { const x = ES.byId(id); return `<svg class="es" viewBox="0 0 64 64" aria-hidden="true">${x.f(eid())}</svg>`; },
  // готовая разметка значка по статусу пользователя ({k:"b",id} | {k:"c",url,mime} | пусто = звезда по умолчанию)
  node(st) {
    if (st && st.k === "c" && st.url) {
      const src = fileUrl(st.url);
      return /^video\//.test(st.mime || "") ? `<video class="es-c" src="${esc(src)}" autoplay loop muted playsinline disablepictureinpicture></video>` : `<img class="es-c" src="${esc(src)}" alt="" decoding="async">`;
    }
    return ES.svg(st && st.k === "b" ? st.id : "star");
  },
  colors(st) { return ES.byId(st && st.k === "b" ? st.id : "star").c; },
};

// ═════════════ ЗНАЧОК В ПРОФИЛЕ ═════════════
const PB = {
  users: {},
  // значок надетого коллекционного подарка (его эмодзи в цвете модели)
  nft(n) { return `<span class="nft-e" style="--hue:${+(n.model && n.model.hue) || 0}deg">${esc(n.e || "🎁")}</span>`; },
  // кнопка со значком рядом с именем; нажатие открывает окно «Premium» (или подарок, если значок — NFT).
  // Пока ни статус, ни подарок не выбраны, значка нет.
  html(u, cls = "") {
    if (!u || !u.premium || u.is_system) return "";
    if (!u.nft && !u.estatus) return "";
    PB.users[u.id] = u;
    return `<button class="pbadge ${cls}${u.nft ? " nftb" : ""}" data-pb="${u.id}" aria-label="Premium">${u.nft ? PB.nft(u.nft) : ES.node(u.estatus)}</button>`;
  },
  // имя с галочкой и значком (для экранов профиля)
  name(u) { return esc(dispName(u)) + verBadge(u) + PB.html(u); },
};
document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest(".pbadge"); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const u = PB.users[b.dataset.pb];
  if (u && u.nft && typeof Gifts !== "undefined") { haptic(); Gifts.detail({ id: u.nft.gid, key: "c:" + u.nft.coll, nft: u.nft, name: u.nft.name, e: u.nft.e }); }
  else if (u) { haptic(); PremiumPromo.open(u); }
}, true);

// ═════════════ ОКНО «PREMIUM» ═════════════
const PremiumPromo = {
  open(u) {
    const me = App.user, mine = !!(me && u.id === me.id), have = !!(me && me.premium);
    const feats = [
      [SI.smile, "v", "Анимированный эмодзи-статус", "Значок рядом с именем — выбирайте из каталога или загружайте свои"],
      [SI.film, "p", "Свои эмодзи", "Создавайте наборы из картинок, GIF и коротких видео"],
      [SI.bag, "o", "Инструменты для бизнеса", "Адрес, график работы, быстрые ответы, приветствие и автоответ"],
      [SI.userPlus, "b", "До 4 аккаунтов", "Подключайте больше аккаунтов и переключайтесь между ними"],
      [SI.edit, "g", "Длиннее «О себе»", "До 140 символов вместо 70"],
      [SI.pin, "t", "Вводный экран", "Приветствие, которое собеседник видит в новом чате"],
    ];
    const [c1, c2] = ES.colors(u.estatus);
    const el = document.createElement("div");
    el.className = "pp-ov";
    const nm = esc(dispName(u));
    el.innerHTML = `<div class="pp-card" role="dialog" style="--c1:${c1};--c2:${c2}">
      <button class="pp-x" aria-label="${esc(T("Закрыть"))}">${SI.x}</button>
      <div class="pp-hero"><div class="pp-rays"></div><div class="pp-orbit"><i></i><i></i><i></i><i></i><i></i></div><div class="pp-big">${ES.node(u.estatus)}</div></div>
      <h2>${esc(T(NAME_PREMIUM))}</h2>
      <p class="pp-sub">${mine ? esc(T("У вас активен Premium. Выберите значок, который увидят все, кто откроет ваш профиль.")) : esc(T("{0} использует Premium. Подпишитесь, чтобы получить все эти возможности.", dispName(u)))}</p>
      <div class="pp-feats">${feats.map(([ic, c, t, s]) => `<div class="pp-f">${R.ic(c, ic)}<span><b>${esc(T(t))}</b><small>${esc(T(s))}</small></span></div>`).join("")}</div>
      <button class="pp-cta">${esc(have ? T("Выбрать эмодзи-статус") : T("Подписаться на Premium"))}</button>
    </div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    let closed = false;
    const close = Nav.layer(() => { closed = true; el.classList.remove("show"); setTimeout(() => el.remove(), 260); });
    el.querySelector(".pp-x").onclick = close;
    el.addEventListener("click", (e) => { if (e.target === el) close(); });
    el.querySelector(".pp-cta").onclick = () => {
      close();
      setTimeout(() => { if (have) StatusPicker.open(); else Settings.premium(); }, 280);
    };
    void nm;
  },
};

// ═════════════ ВЫБОР ЭМОДЗИ-СТАТУСА ═════════════
const StatusPicker = {
  q: "", cat: "all", sets: null, el: null,

  async open() {
    if (!App.user || !App.user.premium) return PremiumPromo.open(App.user || {});
    const el = document.createElement("div");
    el.className = "sp-ov";
    el.innerHTML = `<div class="sp-card" role="dialog">
      <div class="sp-top"><b>${esc(T("Эмодзи-статус"))}</b><button class="sp-off" hidden>${esc(T("Убрать"))}</button><button class="sp-x" aria-label="${esc(T("Закрыть"))}">${SI.x}</button></div>
      <div class="sp-search">${SI.search}<input type="search" placeholder="${esc(T("Поиск эмодзи"))}" autocomplete="off" enterkeyhint="search"></div>
      <div class="sp-cats">${ES.cats.map((c) => `<button data-c="${c.id}" class="${c.id === "all" ? "on" : ""}" aria-label="${esc(T(c.t))}">${c.ic}</button>`).join("")}<button data-c="mine" aria-label="${esc(T("Мои эмодзи"))}">${SI.film}</button></div>
      <div class="sp-body"></div></div>`;
    document.body.appendChild(el);
    StatusPicker.el = el; StatusPicker.q = ""; StatusPicker.cat = "all"; StatusPicker.sets = null;
    requestAnimationFrame(() => el.classList.add("show"));
    const close = Nav.layer(() => { StatusPicker.el = null; el.classList.remove("show"); setTimeout(() => el.remove(), 260); });
    StatusPicker.close = close;
    el.querySelector(".sp-x").onclick = close;
    el.addEventListener("click", (e) => { if (e.target === el) close(); });
    el.querySelector(".sp-search input").oninput = (e) => { StatusPicker.q = e.target.value.trim().toLowerCase(); StatusPicker.draw(); };
    el.querySelector(".sp-cats").onclick = (e) => {
      const b = e.target.closest("button[data-c]"); if (!b) return;
      StatusPicker.cat = b.dataset.c; el.querySelectorAll(".sp-cats button").forEach((x) => x.classList.toggle("on", x === b));
      StatusPicker.draw(); el.querySelector(".sp-body").scrollTop = 0;
    };
    el.querySelector(".sp-off").onclick = () => StatusPicker.pick("");
    el.querySelector(".sp-body").onclick = (e) => StatusPicker.click(e);
    StatusPicker.draw();
    StatusPicker.load();
  },

  async load() {
    try { const d = await api("/api/emoji"); StatusPicker.sets = d.sets; } catch (e) { StatusPicker.sets = []; }
    if (StatusPicker.el) StatusPicker.draw();
  },

  recent() { const a = Prefs.get("es_recent", []); return Array.isArray(a) ? a.filter((x) => typeof x === "string" && x.startsWith("b:") && ES.items.some((i) => "b:" + i.id === x)).slice(0, 8) : []; },

  cur() { const s = App.user && App.user.estatus; return s ? (s.k === "c" ? "c:" + s.id : "b:" + s.id) : ""; },

  tile(key, html, on) { return `<button class="sp-t${on ? " on" : ""}" data-k="${esc(key)}">${html}</button>`; },

  draw() {
    const el = StatusPicker.el; if (!el) return;
    const body = el.querySelector(".sp-body"), cur = StatusPicker.cur(), q = StatusPicker.q, cat = StatusPicker.cat;
    el.querySelector(".sp-off").hidden = !cur;
    const sec = (title, inner, extra = "") => `<div class="sp-sec"><div class="sp-h"><span>${esc(title)}</span>${extra}</div><div class="sp-grid">${inner}</div></div>`;
    const mine = [], norm = (s) => String(s || "").toLowerCase();
    const sets = StatusPicker.sets;
    let out = "";
    const addTile = `<button class="sp-t add" data-act="add" aria-label="${esc(T("Добавить эмодзи"))}">${SI.plus}</button>`;
    // мои эмодзи
    if (sets && (cat === "all" || cat === "mine")) {
      const shown = sets.filter((s) => !q || norm(s.title).includes(q));
      shown.forEach((s) => { if (s.items.length) mine.push(sec(s.title, s.items.map((it) => StatusPicker.tile("c:" + it.id, ES.node({ k: "c", url: it.url, mime: it.mime }), cur === "c:" + it.id)).join(""), `<button class="sp-edit" data-act="set" data-s="${s.id}">${esc(T("Изменить"))}</button>`)); });
    }
    if (cat === "mine") {
      out = (sets && sets.length ? mine.join("") : "") + sec(sets && sets.length ? T("Новый набор или добавление") : T("Мои эмодзи"), addTile) +
        `<div class="sp-note">${esc(T("Создавайте свои эмодзи из картинок, GIF и коротких видео: нажмите «+», выберите набор или создайте новый."))}</div>`;
    } else {
      const list = ES.items.filter((x) => (cat === "all" || x.cat === cat) && (!q || norm(x.t).includes(q) || norm(x.k).includes(q)));
      if (cat === "all" && !q) {
        const rc = StatusPicker.recent();
        out += sec(T("Недавние"), addTile + rc.map((k) => StatusPicker.tile(k, ES.svg(k.slice(2)), cur === k)).join(""));
        out += mine.join("");
      } else if (q) out += mine.join("");
      const groups = cat === "all" && !q ? ES.cats.filter((c) => c.id !== "all").map((c) => [c, list.filter((x) => x.cat === c.id)]) : [[null, list]];
      groups.forEach(([c, items]) => { if (items.length) out += sec(c ? T(c.t) : T("Найдено"), items.map((x) => StatusPicker.tile("b:" + x.id, ES.svg(x.id), cur === "b:" + x.id)).join("")); });
      if (!out || (q && !list.length && !mine.length)) out = `<div class="sp-empty">${esc(T("Ничего не найдено"))}</div>`;
    }
    const y = body.scrollTop; body.innerHTML = out; body.scrollTop = y;
  },

  click(e) {
    const t = e.target.closest(".sp-t"), ed = e.target.closest("[data-act]");
    if (ed && ed.dataset.act === "set") { StatusPicker.close(); setTimeout(() => EmojiSets.set(+ed.dataset.s), 280); return; }
    if (t && t.dataset.act === "add") { EmojiSets.add(() => StatusPicker.load()); return; }
    if (t && t.dataset.k) StatusPicker.pick(t.dataset.k);
  },

  async pick(key) {
    try {
      const d = await api("/api/me/status", { method: "POST", body: { status: key } });
      App.user = d.user; haptic("medium");
      if (key.startsWith("b:")) { const r = [key].concat(StatusPicker.recent().filter((x) => x !== key)).slice(0, 8); Prefs.set("es_recent", r); }
      try { Profile.render(); } catch (e) {}
      toast(key ? T("Эмодзи-статус обновлён") : T("Эмодзи-статус убран"));
      if (StatusPicker.close) StatusPicker.close();
    } catch (e) {
      if (e.need_premium || /Premium/.test(e.message || "")) { PremiumPromo.open(App.user); } else toast(e.message);
    }
  },
};

// ═════════════ СВОИ ЭМОДЗИ: НАБОРЫ ═════════════
const EmojiSets = {
  IMG_MAX: 1048576, VID_MAX: 4194304,

  needPrem() { if (App.user && App.user.premium) return false; PremiumPromo.open(App.user || {}); return true; },

  thumb(it, cls = "") { return `<span class="es-th ${cls}">${ES.node({ k: "c", url: it.url, mime: it.mime })}</span>`; },

  // список наборов (экран «Мои эмодзи»)
  open() {
    if (EmojiSets.needPrem()) return;
    const pg = Pg.open({ title: T("Мои эмодзи"), data: { sets: null, max: { sets: 10, items: 120 } }, build: (pg) => EmojiSets.draw(pg) });
    pg.on = {
      new: () => EmojiSets.create().then((s) => { if (s) { EmojiSets.load(pg); EmojiSets.set(s.id, () => EmojiSets.load(pg)); } }),
      open: (el) => EmojiSets.set(+el.dataset.v, () => EmojiSets.load(pg)),
      add: () => EmojiSets.add(() => EmojiSets.load(pg)),
    };
    EmojiSets.load(pg);
    return pg;
  },
  async load(pg) {
    try { const d = await api("/api/emoji"); pg.data.sets = d.sets; pg.data.max = { sets: d.max_sets, items: d.max_items }; } catch (e) { pg.data.sets = pg.data.sets || []; toast(e.message); }
    if (pg.alive) EmojiSets.draw(pg);
  },
  draw(pg) {
    const sets = pg.data.sets;
    if (!sets) { pg.set('<div class="pf-load"><div class="spin"></div></div>'); return; }
    pg.set(`${R.hero(SI.film, esc(T("Мои эмодзи")), esc(T("Создавайте свои эмодзи из картинок, GIF и коротких видео. Любой из них можно поставить как статус рядом с именем.")), "slim")}
      ${R.card(R.row({ a: "new", ic: SI.plus, c: "b", t: esc(T("Создать новый набор")), chev: false }), R.row({ a: "add", ic: SI.image, c: "g", t: esc(T("Добавить эмодзи")), s: esc(T("В новый или в существующий набор")), chev: false }))}
      ${sets.length ? `${R.lbl(esc(T("Мои наборы")))}${R.card(...sets.map((s) => `<button class="irow es-set" data-a="open" data-v="${s.id}"><span class="es-prev">${s.items.slice(0, 3).map((it) => EmojiSets.thumb(it)).join("") || `<span class="es-th empty">${SI.film}</span>`}</span><span class="tx"><b>${esc(s.title)}</b><small>${esc(s.items.length ? T("{0} " + plural(s.items.length, "эмодзи", "эмодзи", "эмодзи"), s.items.length) : T("Пока пусто"))}</small></span>${SI.chev.replace("<svg ", '<svg class="irow-chev" ')}</button>`))}` : ""}
      ${R.hint(esc(T("Картинка — до 1 МБ, видео — до 4 МБ. В наборе до {0} эмодзи, всего наборов — до {1}. GIF, WebP и видео будут анимированы.", pg.data.max.items, pg.data.max.sets)))}`);
  },

  // новый набор: спросить название и создать
  async create() {
    if (EmojiSets.needPrem()) return null;
    const title = await UI.prompt({ title: T("Название набора"), placeholder: T("Например, Мои эмодзи"), ok: T("Создать"), type: "text" });
    if (!title) return null;
    try { const d = await api("/api/emoji/set", { method: "POST", body: { title } }); return d.set; } catch (e) { toast(e.message); return null; }
  },

  // «+»: выбрать набор (или создать новый) → выбрать файлы → загрузить
  async add(done) {
    if (EmojiSets.needPrem()) return;
    let sets = [];
    try { sets = (await api("/api/emoji")).sets; } catch (e) { return toast(e.message); }
    const v = await UI.sheet({ title: T("Добавить эмодзи"), text: T("Куда добавить?"), actions: [{ label: T("＋ Новый набор"), value: "new", accent: true }].concat(sets.map((s) => ({ label: T("В набор «{0}»", s.title), value: s.id }))) });
    if (v === null) return;
    let sid = v;
    if (v === "new") { const s = await EmojiSets.create(); if (!s) return; sid = s.id; }
    await EmojiSets.pickFiles(sid);
    if (done) done();
  },

  // экран одного набора
  set(id, onChange) {
    if (EmojiSets.needPrem()) return;
    const pg = Pg.open({ title: "…", data: { set: null }, right: `<button class="hbtn" data-a="menu" aria-label="${esc(T("Ещё"))}">${SI.dots}</button>`, build: (pg) => EmojiSets.drawSet(pg) });
    const reload = async () => {
      try { const d = await api("/api/emoji"); pg.data.set = d.sets.find((s) => s.id === id) || null; pg.data.max = d.max_items; } catch (e) { toast(e.message); }
      if (pg.alive) { if (!pg.data.set) pg.close(); else { pg.title(pg.data.set.title); EmojiSets.drawSet(pg); } }
      if (onChange) onChange();
    };
    pg.on = {
      menu: async () => {
        const v = await UI.sheet({ title: pg.data.set ? pg.data.set.title : "", actions: [{ label: T("Копировать ссылку на набор"), value: "copy" }, { label: T("Поделиться набором"), value: "share" }, { label: T("Переименовать"), value: "ren" }, { label: T("Удалить набор"), value: "del", danger: true }] });
        const link = pg.data.set && pg.data.set.link;
        if (v === "copy" || v === "share") {
          if (!link) return toast(T("У набора пока нет ссылки"));
          if (v === "share") { try { if (navigator.share) return await navigator.share({ title: pg.data.set.title, url: link }); } catch (e) { return; } }
          copyText(link); toast(T("Ссылка скопирована"));
        } else if (v === "ren") {
          const t = await UI.prompt({ title: T("Название набора"), value: pg.data.set.title, ok: T("Сохранить"), type: "text" });
          if (t) { try { await api("/api/emoji/set/rename", { method: "POST", body: { id, title: t } }); toast(T("Название изменено")); reload(); } catch (e) { toast(e.message); } }
        } else if (v === "del") {
          if (await ask(T("Удалить набор вместе со всеми эмодзи?"), T("Удалить"))) {
            try { await api("/api/emoji/set/delete", { method: "POST", body: { id } }); try { const d = await api("/api/me"); App.user = d.user; Profile.render(); } catch (e) {} toast(T("Набор удалён")); pg.close(); if (onChange) onChange(); } catch (e) { toast(e.message); }
          }
        }
      },
      add: async () => { await EmojiSets.pickFiles(id); reload(); },
      item: async (el) => {
        const it = pg.data.set.items.find((x) => x.id === +el.dataset.v); if (!it) return;
        const v = await UI.sheet({ title: T("Эмодзи"), icon: ES.node({ k: "c", url: it.url, mime: it.mime }), actions: [{ label: T("Сделать статусом"), value: "use", accent: true }, { label: T("Удалить"), value: "del", danger: true }] });
        if (v === "use") {
          try { const d = await api("/api/me/status", { method: "POST", body: { status: "c:" + it.id } }); App.user = d.user; try { Profile.render(); } catch (e) {} toast(T("Эмодзи-статус обновлён")); } catch (e) { toast(e.message); }
        } else if (v === "del") {
          try { await api("/api/emoji/item/delete", { method: "POST", body: { id: it.id } }); try { const d = await api("/api/me"); App.user = d.user; Profile.render(); } catch (e) {} reload(); } catch (e) { toast(e.message); }
        }
      },
    };
    reload();
    return pg;
  },
  drawSet(pg) {
    const s = pg.data.set;
    if (!s) { pg.set('<div class="pf-load"><div class="spin"></div></div>'); return; }
    const cur = App.user && App.user.estatus && App.user.estatus.k === "c" ? App.user.estatus.id : 0;
    pg.set(`<div class="es-grid">${`<button class="es-tile add" data-a="add" aria-label="${esc(T("Добавить эмодзи"))}">${SI.plus}<span>${esc(T("Добавить"))}</span></button>`}${s.items.map((it) => `<button class="es-tile${cur === it.id ? " on" : ""}" data-a="item" data-v="${it.id}">${EmojiSets.thumb(it)}</button>`).join("")}</div>
      ${R.hint(esc(s.items.length ? T("Нажмите на эмодзи, чтобы сделать его статусом или удалить.") : T("Нажмите «Добавить» и выберите картинки, GIF или видео.")))}`);
  },

  // выбор файлов и загрузка в набор sid
  pickFiles(sid) {
    return new Promise((res) => {
      const inp = document.createElement("input");
      inp.type = "file"; inp.multiple = true; inp.accept = "image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm";
      inp.style.display = "none"; document.body.appendChild(inp);
      let fin = false; const end = () => { if (fin) return; fin = true; setTimeout(() => inp.remove(), 500); res(); };
      inp.onchange = async () => {
        const files = [...inp.files]; let ok = 0, bad = "";
        for (let i = 0; i < files.length; i++) {
          toast(files.length > 1 ? T("Загрузка {0} из {1}…", i + 1, files.length) : T("Загрузка…"));
          try { await EmojiSets.upload(sid, files[i]); ok++; } catch (e) { bad = e.message || String(e); }
        }
        if (bad) toast(bad); else if (ok) toast(T("Добавлено: {0}", ok));
        end();
      };
      inp.addEventListener("cancel", end);
      inp.click();
    });
  },

  // картинку приводим к квадрату 256×256 (PNG), анимацию (GIF/WebP/видео) загружаем как есть
  async upload(sid, file) {
    const t = (file.type || "").toLowerCase(), video = t.startsWith("video/");
    if (!/^(image\/(png|jpeg|webp|gif|avif)|video\/(mp4|webm))$/.test(t)) throw new Error(T("Подходят картинки, GIF, WebP и видео (MP4, WebM)"));
    let blob = file, name = file.name || "emoji", mime = t;
    if (!video && t !== "image/gif" && t !== "image/webp") {
      try { const r = await EmojiSets.shrink(file); blob = r; mime = "image/png"; name = "emoji.png"; } catch (e) {}
    }
    if (blob.size > (video ? EmojiSets.VID_MAX : EmojiSets.IMG_MAX)) throw new Error(video ? T("Видео слишком большое: до 4 МБ") : T("Картинка слишком большая: до 1 МБ"));
    const fid = await Up.upload(blob, { name, mime });
    const d = await api("/api/emoji/item", { method: "POST", body: { set: sid, fid } });
    return d.item;
  },
  shrink(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        try {
          // эмодзи всегда квадратный: картинку вписываем в квадрат 256×256 (прозрачные поля), без растяжения
          const S = Math.max(64, Math.min(256, Math.max(img.naturalWidth, img.naturalHeight)));
          const s = S / Math.max(img.naturalWidth, img.naturalHeight), w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
          const c = document.createElement("canvas"); c.width = S; c.height = S;
          const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(img, Math.round((S - w) / 2), Math.round((S - h) / 2), w, h);
          c.toBlob((b) => (b ? res(b) : rej(new Error("png"))), "image/png");
        } catch (e) { rej(e); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("img")); };
      img.src = url;
    });
  },
};
