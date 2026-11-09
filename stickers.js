// stickers.js — своя панель вместо системной клавиатуры эмодзи/стикеров: Эмодзи | Стикеры | GIF.
// Встроенные стикеры нарисованы кодом (SVG), свои создаются из фото прямо здесь (конструктор стикеров).

// ───────────── встроенные стикеры ─────────────
const Stk = (() => {
  const INK = "#2B2B3A";
  const COL = {
    yellow: ["#FFEFA0", "#FFC83D"], pink: ["#FFC4D6", "#FF7BA3"], blue: ["#C5E4FF", "#6CB4FF"], red: ["#FFB4A0", "#FF6B4A"],
    purple: ["#DCC8FF", "#A57BFF"], green: ["#C8F5B8", "#6FD65A"], orange: ["#FFD7A3", "#FF9F43"], mint: ["#C4F5E4", "#4FD1B0"],
    gold: ["#FFF0A8", "#FFB800"], lime: ["#EAFAA0", "#B8E04A"], gray: ["#EEE3C9", "#D6C28E"],
  };
  const stroke = (d, w = 15) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const dot = (x, y) => `<ellipse cx="${x}" cy="${y}" rx="19" ry="27" fill="${INK}"/><circle cx="${x + 6}" cy="${y - 10}" r="7" fill="#fff"/>`;
  const heart = (x, y, s, c) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 14C-30-8-22-34 0-20 22-34 30-8 0 14z" fill="${c}"/>`;
  const star = (x, y, r, c) => {
    let p = "";
    for (let i = 0; i < 10; i++) { const a = (Math.PI / 5) * i - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; p += (i ? "L" : "M") + (x + rr * Math.cos(a)).toFixed(1) + " " + (y + rr * Math.sin(a)).toFixed(1); }
    return `<path d="${p}Z" fill="${c}"/>`;
  };
  const spark = (x, y, r) => `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="#fff" stroke="#FFC83D" stroke-width="5"/>`;
  const EYES = {
    dot: dot(190, 235) + dot(322, 235),
    happy: stroke("M158 250Q190 198 222 250") + stroke("M290 250Q322 198 354 250"),
    closed: stroke("M158 228Q190 262 222 228") + stroke("M290 228Q322 262 354 228"),
    wink: dot(190, 235) + stroke("M290 250Q322 198 354 250"),
    heart: heart(190, 238, 1.15, "#FF3B5C") + heart(322, 238, 1.15, "#FF3B5C"),
    star: star(190, 235, 36, "#FF8A00") + star(322, 235, 36, "#FF8A00"),
    cry: dot(190, 228) + dot(322, 228) + `<path d="M176 268q-18 38 0 52 18-14 0-52zM336 268q-18 38 0 52 18-14 0-52z" fill="#5AB8FF"/>`,
    angry: dot(190, 245) + dot(322, 245) + stroke("M150 190L228 222", 17) + stroke("M362 190L284 222", 17),
    cool: `<rect x="130" y="205" width="116" height="62" rx="26" fill="#1E1E2A"/><rect x="266" y="205" width="116" height="62" rx="26" fill="#1E1E2A"/><rect x="240" y="222" width="32" height="12" fill="#1E1E2A"/><path d="M150 222l34-4M286 222l34-4" stroke="#fff" stroke-opacity=".45" stroke-width="8" stroke-linecap="round"/>`,
    xx: stroke("M164 212l52 52M216 212l-52 52") + stroke("M296 212l52 52M348 212l-52 52"),
    shock: `<circle cx="190" cy="235" r="38" fill="#fff" stroke="${INK}" stroke-width="10"/><circle cx="322" cy="235" r="38" fill="#fff" stroke="${INK}" stroke-width="10"/><circle cx="190" cy="238" r="14" fill="${INK}"/><circle cx="322" cy="238" r="14" fill="${INK}"/>`,
    flat: stroke("M158 240h64") + stroke("M290 240h64"),
    think: dot(190, 240) + dot(322, 240) + stroke("M150 188Q190 165 228 196") + stroke("M290 205h64"),
  };
  const MOUTH = {
    smile: stroke("M190 322Q256 382 322 322"),
    grin: `<path d="M178 308Q256 430 334 308Z" fill="#7A2E3A" stroke="${INK}" stroke-width="12" stroke-linejoin="round"/><path d="M190 312h132Q316 334 256 338 196 334 190 312z" fill="#fff"/><ellipse cx="256" cy="378" rx="34" ry="18" fill="#FF6E8A"/>`,
    o: `<ellipse cx="256" cy="352" rx="26" ry="34" fill="#7A2E3A" stroke="${INK}" stroke-width="10"/>`,
    flat: stroke("M214 350h84"),
    sad: stroke("M192 366Q256 306 320 366"),
    tongue: stroke("M190 322Q256 382 322 322") + `<path d="M232 346v34a24 24 0 0 0 48 0v-34z" fill="#FF6E8A" stroke="${INK}" stroke-width="9"/>`,
    kiss: `<path d="M256 334q-34-26-40-4-4 26 40 42 44-16 40-42-6-22-40 4z" fill="#FF5C7A" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`,
    wail: `<path d="M184 332Q256 290 328 332Q310 400 256 400 202 400 184 332Z" fill="#7A2E3A" stroke="${INK}" stroke-width="12" stroke-linejoin="round"/>`,
    small: stroke("M226 352Q256 368 286 352", 13),
  };
  const EXTRA = {
    blush: `<ellipse cx="138" cy="304" rx="32" ry="19" fill="#FF7B9C" opacity=".55"/><ellipse cx="374" cy="304" rx="32" ry="19" fill="#FF7B9C" opacity=".55"/>`,
    sweat: `<path d="M412 150q-26 42 0 58 26-16 0-58z" fill="#6CC4FF" stroke="#fff" stroke-width="6"/>`,
    zzz: `<text x="372" y="110" font-family="Manrope,Arial" font-weight="800" font-size="70" fill="#7A5CFF">z</text><text x="418" y="64" font-family="Manrope,Arial" font-weight="800" font-size="52" fill="#7A5CFF">z</text>`,
    hearts: heart(90, 130, 1.3, "#FF3B5C") + heart(430, 160, 1, "#FF7BA3") + heart(405, 80, .8, "#FF3B5C"),
    sparkles: spark(86, 140, 34) + spark(430, 120, 28) + spark(410, 330, 22),
    anger: `<path d="M388 112q22-14 40 6M388 112q-14 22 6 40M428 118q14 22-6 40M394 152q22 14 40-6" fill="none" stroke="#E0182D" stroke-width="12" stroke-linecap="round"/>`,
    hat: `<path d="M256 14L196 118h120z" fill="#FF5C7A" stroke="#fff" stroke-width="8" stroke-linejoin="round"/><circle cx="256" cy="14" r="14" fill="#FFD43B"/><circle cx="90" cy="150" r="9" fill="#FF5C7A"/><circle cx="430" cy="170" r="9" fill="#4FD1B0"/><circle cx="410" cy="90" r="8" fill="#FFD43B"/><circle cx="100" cy="330" r="8" fill="#6CB4FF"/>`,
    tears: `<path d="M142 290q-22 34 0 66 22-32 0-66zM370 290q-22 34 0 66 22-32 0-66z" fill="#5AB8FF" opacity=".9"/>`,
  };
  const FACES = [
    ["hi", "😀", "yellow", "dot", "grin", "blush", "Привет"], ["love", "😍", "pink", "heart", "smile", "blush hearts", "Люблю"],
    ["lol", "😂", "yellow", "happy", "grin", "tears", "Ахаха"], ["cool", "😎", "yellow", "cool", "smile", "", "Огонь"],
    ["sad", "😢", "blue", "cry", "sad", "", "Грустно"], ["cry", "😭", "blue", "closed", "wail", "tears", "Реву"],
    ["angry", "😡", "red", "angry", "sad", "anger", "Злюсь"], ["wow", "😮", "yellow", "shock", "o", "", "Ого!"],
    ["sleep", "😴", "purple", "closed", "small", "zzz", "Сплю"], ["wink", "😉", "yellow", "wink", "smile", "", "Ну-ну"],
    ["tongue", "😜", "green", "wink", "tongue", "", "Шучу"], ["kiss", "😘", "pink", "wink", "kiss", "hearts", "Чмок"],
    ["thanks", "🙏", "mint", "happy", "smile", "blush", "Спасибо"], ["party", "🥳", "orange", "happy", "grin", "hat", "Ура!"],
    ["think", "🤔", "yellow", "think", "flat", "", "Хм…"], ["dead", "😵", "lime", "xx", "flat", "", "Всё"],
    ["oops", "😅", "yellow", "dot", "smile", "sweat", "Ой"], ["no", "🙅", "red", "angry", "flat", "", "Нет"],
    ["yes", "👍", "green", "happy", "smile", "", "Да!"], ["bye", "👋", "blue", "happy", "smile", "blush", "Пока"],
    ["bored", "😑", "gray", "flat", "flat", "", "Скука"], ["shy", "😳", "pink", "shock", "small", "blush", "Ой…"],
    ["super", "🤩", "gold", "star", "grin", "sparkles", "Супер"], ["boss", "😤", "orange", "angry", "o", "anger", "Босс"],
  ].map(([id, em, c, e, m, x, cap]) => ({ id: "k:" + id, em, c, e, m, x, cap }));
  const WORDS = [
    ["da", "👍", "ДА", "#4ADE80", "#16A34A"], ["net", "👎", "НЕТ", "#FB7185", "#E11D48"], ["ok", "👌", "ОК", "#60A5FA", "#2563EB"],
    ["haha", "😂", "ХАХА", "#FBBF24", "#F59E0B"], ["lol", "🤣", "ЛОЛ", "#C084FC", "#9333EA"], ["zhest", "😱", "ЖЕСТЬ", "#F87171", "#DC2626"],
    ["top", "🔥", "ТОП", "#FB923C", "#EA580C"], ["sps", "🙏", "СПС", "#34D399", "#059669"], ["privet", "👋", "ПРИВЕТ", "#38BDF8", "#0284C7"],
    ["poka", "🖐", "ПОКА", "#A78BFA", "#7C3AED"], ["lublu", "❤️", "ЛЮБЛЮ", "#F472B6", "#DB2777"], ["gg", "🏆", "ГГ", "#FACC15", "#CA8A04"],
  ].map(([id, em, t, a, b], i) => ({ id: "w:" + id, em, t, a, b, rot: (i % 3 - 1) * 4 }));

  let n = 0;
  const face = (f) => {
    const g = "g" + ++n, [l, d] = COL[f.c];
    const body = `<defs><radialGradient id="${g}" cx="38%" cy="30%" r="80%"><stop offset="0" stop-color="${l}"/><stop offset="1" stop-color="${d}"/></radialGradient></defs>
      <g transform="translate(46 8) scale(.82)"><circle cx="256" cy="262" r="206" fill="#fff"/><circle cx="256" cy="262" r="190" fill="url(#${g})"/>
      ${EYES[f.e]}${MOUTH[f.m]}${(f.x || "").split(" ").filter(Boolean).map((k) => EXTRA[k]).join("")}</g>
      <text x="256" y="486" text-anchor="middle" font-family="Manrope,Arial,sans-serif" font-weight="800" font-size="${f.cap.length > 6 ? 56 : 66}" fill="#fff" stroke="${INK}" stroke-width="15" paint-order="stroke" stroke-linejoin="round">${f.cap}</text>`;
    return `<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  };
  const word = (w) => {
    const g = "g" + ++n;
    return `<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${w.a}"/><stop offset="1" stop-color="${w.b}"/></linearGradient></defs>
      <g transform="rotate(${w.rot} 256 256)"><rect x="34" y="150" width="444" height="212" rx="70" fill="#fff"/><rect x="50" y="166" width="412" height="180" rx="58" fill="url(#${g})"/>
      <path d="M90 190Q256 165 422 190" stroke="#fff" stroke-opacity=".35" stroke-width="14" stroke-linecap="round" fill="none"/>
      <text x="256" y="290" text-anchor="middle" font-family="Manrope,Arial,sans-serif" font-weight="800" font-size="${w.t.length > 4 ? 84 : 112}" fill="#fff" stroke="${INK}" stroke-width="12" paint-order="stroke" stroke-linejoin="round">${w.t}</text></g></svg>`;
  };
  const byId = {};
  FACES.forEach((f) => (byId[f.id] = f));
  WORDS.forEach((w) => (byId[w.id] = w));
  const PACKS = [{ id: "k", name: "Колобки", icon: "😀", crop: "76 46 360 360", items: FACES }, { id: "w", name: "Слова", icon: "🔤", crop: "14 112 484 288", items: WORDS }];
  return {
    PACKS, byId,
    svg(id) { const s = byId[id]; return s ? (s.t ? word(s) : face(s)) : ""; },
    emoji(id) { return (byId[id] || {}).em || ""; },
  };
})();

// ───────────── данные панели ─────────────
const EMOJI = [
  ["Смайлы", "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖"],
  ["Жесты", "👋 🤚 🖐 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 💪 🧠 👀 👅 👄"],
  ["Сердца", "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 ✨ ⭐ 🌟 💫 🔥 💥 💯 ✅ ❌ ❓ ❗ ⚡ 💢 💤 💬 🎉 🎊 🎁 🏆 🥇"],
  ["Животные", "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦆 🦉 🐺 🐴 🦄 🐝 🦋 🐌 🐞 🐢 🐍 🐙 🦀 🐠 🐬 🐳 🦈 🐊 🐘 🦒"],
  ["Еда", "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🥦 🌽 🥕 🍞 🧀 🍗 🍖 🍔 🍟 🍕 🌭 🌮 🍣 🍜 🍩 🍪 🎂 🍰 🍫 🍬 🍭 ☕ 🍵 🍺 🍷 🥂 🍾"],
  ["Активности", "⚽ 🏀 🏈 ⚾ 🎾 🏐 🎱 🏓 🥊 🎯 🎮 🎲 🎧 🎤 🎸 🎹 🎬 🎨 🏄 🚴 🏊"],
  ["Мир", "🚗 🚕 🚌 🏎 🚓 🚑 🚒 ✈️ 🚀 🚁 🚂 🚢 🏠 🏝 🌍 🌙 ☀️ ⛅ ☁️ 🌧 ⛈ ❄️ 🌈 📱 💻 ⌚ 📷 💡 🔑 🔒 💰 💎 📌 ✏️ 📚 ⏰ 🎈"],
].map(([n, s]) => ({ name: n, list: s.split(" ") }));

// ───────────── свои значки панели (вместо системных эмодзи) ─────────────
const PNI = (d, w = 1.9) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const PIC = {
  recent: PNI('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),
  smile: PNI('<circle cx="12" cy="12" r="9.5"/><path d="M8 14.5a4.5 4.5 0 0 0 8 0"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.6"/>'),
  hand: PNI('<path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z"/><path d="M7 11l4-8a2.5 2.5 0 0 1 2.5 2.5V9h5.2a2 2 0 0 1 2 2.3l-1.2 7a2 2 0 0 1-2 1.7H7"/>'),
  heart: PNI('<path d="M12 20.5s-8-4.7-8-10.5A4.5 4.5 0 0 1 12 7.6 4.5 4.5 0 0 1 20 10c0 5.8-8 10.5-8 10.5z"/>'),
  paw: PNI('<path d="M5 9 4 3.5 9 6.2a8 8 0 0 1 6 0L20 3.5 19 9a8 8 0 0 1 1.2 4.3c0 4-3.6 7-8.2 7s-8.2-3-8.2-7A8 8 0 0 1 5 9z"/><path d="M9.5 13h.01M14.5 13h.01" stroke-width="2.6"/>'),
  food: PNI('<path d="M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 9h2a2.5 2.5 0 0 1 0 5h-2"/><path d="M8 3v2M12 3v2"/>'),
  ball: PNI('<circle cx="12" cy="12" r="9.5"/><path d="M12 2.5v19M2.5 12h19"/><path d="M5 5c4 3 10 3 14 0M5 19c4-3 10-3 14 0"/>'),
  globe: PNI('<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19"/><path d="M12 2.5c3.2 3.2 3.2 15.8 0 19M12 2.5c-3.2 3.2-3.2 15.8 0 19"/>'),
  star: PNI('<path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9l-5.4 2.9 1.1-6.1L3.2 9.4l6.1-.8z"/>'),
  stk: PNI('<path d="M20.5 12.5V8a4.5 4.5 0 0 0-4.5-4.5H8A4.5 4.5 0 0 0 3.5 8v8A4.5 4.5 0 0 0 8 20.5h4.5z"/><path d="M20.5 12.5a8 8 0 0 0-8 8"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.6"/><path d="M9 13.5a3.5 3.5 0 0 0 4 1.5"/>'),
  gif: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="2" y="5" width="20" height="14" rx="4.5"/><text x="12" y="15.4" text-anchor="middle" font-family="Manrope,Arial,sans-serif" font-weight="800" font-size="9" fill="currentColor" stroke="none">GIF</text></svg>',
  bs: PNI('<path d="M21 5H9l-6 7 6 7h12z"/><path d="m13 9 5 6M18 9l-5 6"/>'),
  film: PNI('<rect x="3" y="4.5" width="18" height="15" rx="3.5"/><path d="M10 9.5v5l4.2-2.5z" fill="currentColor"/>'),
  plus: PNI('<path d="M12 5v14M5 12h14"/>', 2.4),
};
const CAT_IC = ["smile", "hand", "heart", "paw", "food", "ball", "globe"];

const ls = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

const Panel = {
  open: false, tab: "emoji", pack: "mine", mine: { stickers: [], gifs: [], gif_search: false }, loaded: false,
  gifQ: "", gifRes: [], gifT: 0, h: 300,

  bind() {
    const p = $("panel");
    p.addEventListener("pointerdown", (e) => { if (!e.target.closest("input")) e.preventDefault(); });   // не отнимаем фокус у поля ввода
    p.addEventListener("click", (e) => Panel.click(e));
    // долгое нажатие по своему стикеру/GIF — удалить
    let lp = 0;
    p.addEventListener("touchstart", (e) => {
      const b = e.target.closest("[data-del]"); if (!b) return;
      lp = setTimeout(() => { Panel.noClick = true; Panel.del(+b.dataset.del, b.dataset.kind); }, 520);
    }, { passive: true });
    ["touchend", "touchmove", "touchcancel"].forEach((ev) => p.addEventListener(ev, () => clearTimeout(lp), { passive: true }));
    p.addEventListener("contextmenu", (e) => { const b = e.target.closest("[data-del]"); if (b) { e.preventDefault(); Panel.del(+b.dataset.del, b.dataset.kind); } });
  },

  async load() {
    try { const d = await api("/api/stickers"); Panel.mine = { stickers: d.stickers, gifs: d.gifs, gif_search: d.gif_search }; Panel.loaded = true; Panel.render(); } catch (e) {}
  },

  show(tab) {
    Panel.tab = tab || Panel.tab;
    Panel.open = true;
    const kb = Chat.kb || 0;
    Panel.h = Math.max(280, Math.min(400, kb > 150 ? kb : Math.round(innerHeight * 0.4)));
    $("composer").style.setProperty("--ph", Panel.h + "px");
    $("composer").classList.add("panel-open");
    $("btn-emoji").classList.add("on");
    if (!Panel.loaded) Panel.load();
    if (!React.sets || Date.now() - React.loadedAt > 60000) React.loadSets().then(() => { if (Panel.open && Panel.tab === "emoji") Panel.render(); });
    Panel.render();
  },
  hide() {
    Panel.open = false;
    $("composer").classList.remove("panel-open");
    $("btn-emoji").classList.remove("on");
  },
  // кнопка смайлика: панель вместо клавиатуры и обратно
  toggle() {
    if (Panel.open) { Panel.hide(); Editor.focus(false); return; }
    Panel.show();              // сначала «панель открыта» — иначе обработчик фокуса вернёт обычную клавиатуру
    Editor.focus(true);        // inputmode=none: клавиатура прячется, курсор остаётся
  },

  render() {
    const p = $("panel");
    if (!Panel.open) return;
    const tab = Panel.tab;
    const tb = (k, label) => `<button data-tab="${k}" class="${tab === k ? "on" : ""}" aria-label="${label}">${PIC[k === "emoji" ? "smile" : k]}</button>`;
    const tabs = `<div class="pn-tabs">${tb("emoji", T("Эмодзи"))}${tb("stk", T("Стикеры"))}${tb("gif", "GIF")}<span class="grow"></span>${tab === "emoji" ? `<button data-act="bs" class="bs" aria-label="${T("Стереть")}">${PIC.bs}</button>` : ""}</div>`;
    let head = "", body = "";
    if (tab === "emoji") {
      const rec = ls.get("emoji_recent", []);
      const prem = !!(App.user && App.user.premium), sets = prem ? React.sets || [] : [];
      const secs = [];
      if (rec.length) secs.push({ ic: PIC.recent, n: T("Недавние"), g: `<div class="em-g">${rec.map((e) => `<button data-e="${e}">${e}</button>`).join("")}</div>` });
      sets.forEach((st) => secs.push({ ic: `<span class="cs-ic">${CE.media(st.items[0])}</span>`, n: st.title, ce: 1, g: `<div class="em-g ce-g">${st.items.map((i) => `<button data-ce="${i.id}" data-em="${esc(i.emoji || "🙂")}" aria-label="${esc(i.emoji || "")}">${CE.media(i)}</button>`).join("")}</div>` }));
      EMOJI.forEach((c, k) => secs.push({ ic: PIC[CAT_IC[k] || "smile"], n: T(c.name), g: `<div class="em-g">${c.list.map((e) => `<button data-e="${e}">${e}</button>`).join("")}</div>` }));
      const q = Panel.emQ || "";
      head = `<div class="pn-search em-s"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="em-q" placeholder="${esc(T("Поиск эмодзи"))}" value="${esc(q)}" autocomplete="off" enterkeyhint="search">${q ? `<button class="em-qx" data-act="emqx" aria-label="${esc(T("Очистить"))}">✕</button>` : ""}</div>` +
        `<div class="pn-cats"${q ? " hidden" : ""}>${secs.map((c, i) => `<button data-cat="${i}" class="${i ? "" : "on"}" aria-label="${esc(c.n)}">${c.ic}</button>`).join("")}</div>`;
      const lock = prem ? "" : `<button class="ce-lock" data-act="prem"><span class="mg-li">${PREM_I}</span><span><b>${esc(T("Анимированные эмодзи"))}</b><small>${esc(T("Свои эмодзи в тексте сообщений — с Premium"))}</small></span><i>›</i></button>`;
      const none = prem && !sets.length && React.sets ? `<div class="ce-none">${esc(T("Свои эмодзи появятся здесь. Создайте набор: Настройки → Premium → Свои эмодзи"))}</div>` : "";
      body = q ? Panel.emFound(q, sets) : lock + none + secs.map((c, i) => `<div class="em-h" id="emc-${i}">${esc(c.n)}${c.ce ? `<i class="ce-tag">${PREM_I}</i>` : ""}</div>${c.g}`).join("");
    } else if (tab === "stk") {
      const packs = [{ id: "recent", ic: PIC.recent }, { id: "mine", ic: PIC.star }].concat(Stk.PACKS.map((k) => ({ id: k.id, ic: `<span class="pk-art">${Stk.svg(k.items[0].id).replace('viewBox="0 0 512 512"', `viewBox="${k.crop || "0 0 512 512"}"`)}</span>` })));
      head = `<div class="pn-packs">${packs.map((k) => `<button data-pack="${k.id}" class="${Panel.pack === k.id ? "on" : ""}">${k.ic}</button>`).join("")}</div>`;
      body = Panel.stickerBody();
    } else {
      body = Panel.gifBody();
      head = `<div class="pn-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="gif-q" placeholder="${Panel.mine.gif_search ? T("Поиск GIF") : T("Поиск GIF недоступен")}" ${Panel.mine.gif_search ? "" : "disabled"} value="${esc(Panel.gifQ)}" autocomplete="off"></div>`;
    }
    const keep = p.querySelector(".pn-body");
    const top = keep && p.dataset.t === tab + Panel.pack ? keep.scrollTop : 0;
    p.innerHTML = `${head}<div class="pn-body">${body}</div>${tabs}`;
    p.dataset.t = tab + Panel.pack;
    const bd = p.querySelector(".pn-body");
    bd.scrollTop = top;
    if (tab === "emoji" && !Panel.emQ) Panel.spy(bd);
    const eq = $("em-q");
    if (eq) eq.oninput = () => {
      Panel.emQ = eq.value;
      const prem = !!(App.user && App.user.premium), b2 = p.querySelector(".pn-body"), cats = p.querySelector(".pn-cats");
      if (!Panel.emQ.trim()) { Panel.render(); const n = $("em-q"); if (n) n.focus(); return; }
      if (cats) cats.hidden = true;
      b2.innerHTML = Panel.emFound(Panel.emQ, prem ? React.sets || [] : []);
      b2.scrollTop = 0;
    };
    const q = $("gif-q");
    if (q) q.oninput = () => { Panel.gifQ = q.value.trim(); clearTimeout(Panel.gifT); Panel.gifT = setTimeout(() => Panel.gifSearch(), 350); };
  },

  // результаты поиска эмодзи: сначала свои (Premium), потом обычные
  emFound(q, sets) {
    const c = typeof EmojiSearch !== "undefined" ? EmojiSearch.ce(q, sets) : [], e = typeof EmojiSearch !== "undefined" ? EmojiSearch.find(q) : [];
    let h = "";
    if (c.length) h += `<div class="em-h">${esc(T("Мои эмодзи"))}<i class="ce-tag">${PREM_I}</i></div><div class="em-g ce-g">${c.map((i) => `<button data-ce="${i.id}" data-em="${esc(i.emoji || "🙂")}" aria-label="${esc(i.emoji || "")}">${CE.media(i)}</button>`).join("")}</div>`;
    if (e.length) h += `<div class="em-h">${esc(T("Эмодзи"))}</div><div class="em-g">${e.map((x) => `<button data-e="${x}">${x}</button>`).join("")}</div>`;
    return h || `<div class="pn-hint">${esc(T("Ничего не найдено"))}</div>`;
  },

  // подсветка категории по прокрутке + прыжок к категории по нажатию
  spy(bd) {
    const btns = [...$("panel").querySelectorAll(".pn-cats button")];
    const hs = btns.map((_, i) => $("emc-" + i));
    const upd = () => {
      let cur = 0;
      hs.forEach((h, i) => { if (h && h.offsetTop - bd.offsetTop <= bd.scrollTop + 14) cur = i; });
      btns.forEach((b, i) => b.classList.toggle("on", i === cur));
      const on = btns[cur], bar = on && on.parentNode;
      if (on && bar) { const l = on.offsetLeft - bar.clientWidth / 2 + on.clientWidth / 2; if (Math.abs(bar.scrollLeft - l) > 30) bar.scrollTo({ left: l, behavior: "smooth" }); }
    };
    let raf = 0;
    bd.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; upd(); }); }, { passive: true });
    upd();
  },
  jump(i) {
    const bd = $("panel").querySelector(".pn-body"), h = $("emc-" + i);
    if (bd && h) bd.scrollTo({ top: h.offsetTop - bd.offsetTop, behavior: "smooth" });
  },

  stickerBody() {
    const id = Panel.pack, cell = (b, inner, extra = "") => `<button class="sk" ${b} ${extra}>${inner}</button>`;
    if (id === "mine") {
      const items = Panel.mine.stickers.map((s) => cell(`data-fid="${s.fid}" data-sid="${s.id}" data-em="${esc(s.emoji || "")}"`, `<img src="${fileUrl(s.url)}" alt="">`, `data-del="${s.id}" data-kind="sticker"`)).join("");
      return `<div class="sk-g"><button class="sk add" data-act="mk"><span>＋</span><small>Создать</small></button>${items}</div>` +
        (Panel.mine.stickers.length ? '<div class="pn-hint">Удерживайте стикер, чтобы удалить</div>' : '<div class="pn-hint">Сделайте свой стикер из любого фото — он появится здесь.</div>');
    }
    if (id === "recent") {
      const rec = ls.get("stk_recent", []);
      if (!rec.length) return '<div class="pn-hint">Здесь будут стикеры, которые вы отправляли</div>';
      return `<div class="sk-g">${rec.map((r) => {
        if (r.b) return Stk.byId[r.b] ? cell(`data-b="${r.b}"`, Stk.svg(r.b)) : "";
        const s = Panel.mine.stickers.find((x) => x.fid === r.fid);
        return s ? cell(`data-fid="${s.fid}" data-sid="${s.id}" data-em="${esc(s.emoji || "")}"`, `<img src="${fileUrl(s.url)}" alt="">`) : "";
      }).join("")}</div>`;
    }
    const pk = Stk.PACKS.find((k) => k.id === id) || Stk.PACKS[0];
    return `<div class="em-h">${pk.name}</div><div class="sk-g">${pk.items.map((s) => cell(`data-b="${s.id}"`, Stk.svg(s.id))).join("")}</div>`;
  },

  gifBody() {
    const m = Panel.mine, list = Panel.gifQ || Panel.gifRes.length ? Panel.gifRes : [];
    const tile = (src, attrs, del = "") => `<button class="gf" ${attrs} ${del}><img src="${src}" alt="" loading="lazy"></button>`;
    let html = "";
    html += `<div class="em-h">Мои GIF</div><div class="gf-g"><button class="gf add mk" data-act="mkgif">${PIC.film}<small>${T("Создать GIF")}</small></button><button class="gf add" data-act="addgif"><span>＋</span><small>${T("Добавить")}</small></button>` +
      m.gifs.map((g) => tile(fileUrl(g.url), `data-fid="${g.fid}" data-gid="${g.id}" data-w="${g.w}" data-h="${g.h}"`, `data-del="${g.id}" data-kind="gif"`)).join("") + "</div>";
    if (m.gif_search) {
      html += `<div class="em-h">${Panel.gifQ ? "Результаты" : "Популярные"}</div>`;
      html += list.length ? `<div class="gf-g">${list.map((g, i) => tile(g.thumb, `data-ri="${i}"`)).join("")}</div>` : `<div class="pn-hint">${Panel.gifLoading ? "Загрузка…" : "Ничего не найдено"}</div>`;
    } else {
      html += '<div class="pn-hint">Поиск GIF включается ключом GIPHY_KEY на сервере. Свои GIF можно добавлять и сохранять из чата.</div>';
    }
    return html;
  },

  async gifSearch() {
    if (!Panel.mine.gif_search) return;
    Panel.gifLoading = true;
    try {
      const d = await api("/api/gif/search?q=" + encodeURIComponent(Panel.gifQ));
      Panel.gifRes = d.items || [];
    } catch (e) { Panel.gifRes = []; }
    Panel.gifLoading = false;
    if (Panel.open && Panel.tab === "gif") { const q = $("gif-q"), v = q && q.value, f = q && document.activeElement === q; Panel.render(); const nq = $("gif-q"); if (nq && f) { nq.value = v; nq.focus(); } }
  },

  async del(id, kind) {
    const ok = await ask(kind === "gif" ? "Удалить GIF из ваших?" : "Удалить стикер из ваших?", "Удалить");
    if (!ok) return;
    try {
      await api("/api/stickers/delete", { method: "POST", body: { id } });
      Panel.mine.stickers = Panel.mine.stickers.filter((s) => s.id !== id);
      Panel.mine.gifs = Panel.mine.gifs.filter((s) => s.id !== id);
      Panel.render();
    } catch (e) { toast(e.message); }
  },

  async click(e) {
    if (Panel.noClick) { Panel.noClick = false; return; }
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.tab) { Panel.tab = t.dataset.tab; if (Panel.tab === "gif" && !Panel.gifRes.length) Panel.gifSearch(); return Panel.render(); }
    if (t.dataset.cat !== undefined) return Panel.jump(+t.dataset.cat);
    if (t.dataset.pack) { Panel.pack = t.dataset.pack; return Panel.render(); }
    if (t.dataset.ce) { haptic("light"); return Editor.insertCE({ id: +t.dataset.ce, emoji: t.dataset.em }); }
    if (t.dataset.act === "prem") return PremiumPromo.open(App.user);
    if (t.dataset.e) {
      haptic("light");
      Editor.insert(t.dataset.e);
      const rec = ls.get("emoji_recent", []).filter((x) => x !== t.dataset.e);
      rec.unshift(t.dataset.e); ls.set("emoji_recent", rec.slice(0, 24));
      return;
    }
    if (t.dataset.act === "bs") return Editor.backspace();
    if (t.dataset.act === "emqx") { Panel.emQ = ""; return Panel.render(); }
    if (t.dataset.act === "mk") return StickerMaker.start();
    if (t.dataset.act === "addgif") return Panel.addGif();
    if (t.dataset.act === "mkgif") return GifMaker.start();
    if (t.dataset.b) { haptic("light"); Panel.remember({ b: t.dataset.b }); return Chat.sendSticker({ b: t.dataset.b, em: Stk.emoji(t.dataset.b) }); }
    if (t.dataset.sid) {
      haptic("light");
      const s = Panel.mine.stickers.find((x) => x.id === +t.dataset.sid);
      Panel.remember({ fid: t.dataset.fid });
      return Chat.sendSticker({ fid: t.dataset.fid, w: s && s.w || undefined, h: s && s.h || undefined, em: t.dataset.em || undefined, url: s && s.url });
    }
    if (t.dataset.gid) { haptic("light"); const g = Panel.mine.gifs.find((x) => x.id === +t.dataset.gid); return Chat.sendGif({ fid: t.dataset.fid, w: +t.dataset.w || undefined, h: +t.dataset.h || undefined, url: g && g.url, mime: g && g.mime }); }
    if (t.dataset.ri !== undefined) {
      const g = Panel.gifRes[+t.dataset.ri]; if (!g) return;
      haptic("light"); t.classList.add("busy");
      try {
        const d = await api("/api/gif/import", { method: "POST", body: { url: g.url } });
        await Chat.sendGif({ fid: d.fid, w: g.w || undefined, h: g.h || undefined, url: g.thumb, mime: d.mime });
      } catch (er) { toast(er.message); }
      t.classList.remove("busy");
    }
  },
  remember(r) {
    const rec = ls.get("stk_recent", []).filter((x) => (r.b ? x.b !== r.b : x.fid !== r.fid));
    rec.unshift(r); ls.set("stk_recent", rec.slice(0, 24));
  },

  async addGif() {
    const f = (await Attach.pick("image/gif,image/webp,video/mp4", false))[0];
    if (!f) return;
    if (f.size > 12 * 1048576) return toast("GIF больше 12 МБ");
    toast("Загружаю…");
    try {
      const fid = await Up.upload(f);
      let w = 0, h = 0;
      if (/^image\//.test(f.type)) { const t = await Up.thumb(f, 64); if (t) { w = t.w; h = t.h; } }
      const d = await api("/api/stickers", { method: "POST", body: { fid, kind: "gif", w, h } });
      Panel.mine.gifs.unshift(d.item); Panel.render(); toast("GIF добавлен");
    } catch (e) { toast(e.message); }
  },

  // сохранить стикер / GIF из сообщения в свою коллекцию
  async saveFrom(m, kind) {
    const a = m.att || {};
    if (!a.fid) return toast("Этот стикер встроенный — он уже есть в панели");
    try {
      const d = await api("/api/stickers", { method: "POST", body: { fid: a.fid, kind, w: a.w, h: a.h, emoji: a.em || "" } });
      const arr = kind === "gif" ? Panel.mine.gifs : Panel.mine.stickers;
      if (!arr.some((x) => x.id === d.item.id)) arr.unshift(d.item);
      toast(kind === "gif" ? "GIF сохранён" : "Стикер добавлен");
    } catch (e) { toast(e.message); }
  },
};

// ───────────── конструктор стикеров ─────────────
const StickerMaker = {
  el: null, img: null, S: { s: 1, x: 0, y: 0 }, shape: "round", outline: true, text: "", emoji: "😀",

  async start() {
    const f = (await Attach.pick("image/*", false))[0];
    if (!f) return;
    let bmp;
    try {
      const url = URL.createObjectURL(f);
      bmp = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = url; });
    } catch (e) { return toast("Не удалось открыть фото"); }
    StickerMaker.img = bmp;
    Object.assign(StickerMaker, { shape: "round", outline: true, text: "", emoji: "😀" });
    const el = (StickerMaker.el = document.createElement("div"));
    el.className = "maker";
    el.innerHTML = `<div class="mk-top"><button class="mk-x" aria-label="Закрыть"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button><b>Новый стикер</b><button class="mk-ok link">Готово</button></div>
      <div class="mk-stage"><canvas width="512" height="512"></canvas></div>
      <p class="mk-tip">Двигайте и масштабируйте фото пальцами</p>
      <div class="mk-ctl"><div class="seg mk-shape"><button data-s="square">Квадрат</button><button data-s="round" class="on">Скруглённый</button><button data-s="circle">Круг</button></div>
      <label class="mk-chk"><input type="checkbox" id="mk-out" checked><span>Белый контур</span></label>
      <input id="mk-text" class="s2-input" maxlength="22" placeholder="Подпись на стикере (необязательно)" autocomplete="off">
      <div class="mk-em">${["😀", "😂", "😍", "😎", "😭", "😡", "👍", "🔥", "❤️", "🎉"].map((e, i) => `<button data-e="${e}" class="${i ? "" : "on"}">${e}</button>`).join("")}</div></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    StickerMaker.release = Nav.layer(() => StickerMaker.hide());
    const cv = el.querySelector("canvas");
    const fit = () => { const k = Math.max(440 / bmp.width, 440 / bmp.height); StickerMaker.S = { s: k, x: 0, y: 0 }; };
    fit();
    const draw = () => StickerMaker.draw(cv);
    draw();
    el.querySelector(".mk-x").onclick = () => StickerMaker.close();
    el.querySelector(".mk-shape").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; StickerMaker.shape = b.dataset.s; el.querySelectorAll(".mk-shape button").forEach((x) => x.classList.toggle("on", x === b)); draw(); };
    el.querySelector("#mk-out").onchange = (e) => { StickerMaker.outline = e.target.checked; draw(); };
    el.querySelector("#mk-text").oninput = (e) => { StickerMaker.text = e.target.value; draw(); };
    el.querySelector(".mk-em").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; StickerMaker.emoji = b.dataset.e; el.querySelectorAll(".mk-em button").forEach((x) => x.classList.toggle("on", x === b)); };
    el.querySelector(".mk-ok").onclick = () => StickerMaker.save(cv);
    // жесты: сдвиг и масштаб
    const pts = new Map();
    let pd = null;
    const rect = () => cv.getBoundingClientRect();
    cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { const p = [...pts.values()]; pd = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), s: StickerMaker.S.s }; } });
    cv.addEventListener("pointermove", (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      const k = 512 / rect().width, S = StickerMaker.S;
      if (pts.size === 2 && pd) { const q = [...pts.values()]; p.x = e.clientX; p.y = e.clientY; S.s = Math.max(0.1, Math.min(8, pd.s * (Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y) / pd.d))); }
      else { S.x += (e.clientX - p.x) * k; S.y += (e.clientY - p.y) * k; p.x = e.clientX; p.y = e.clientY; }
      draw();
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pd = null; };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", (e) => { e.preventDefault(); const S = StickerMaker.S; S.s = Math.max(0.1, Math.min(8, S.s * (e.deltaY < 0 ? 1.08 : 0.92))); draw(); }, { passive: false });
  },

  path(g) {
    const sh = StickerMaker.shape, a = 36, w = 440, p = new Path2D();
    if (sh === "circle") p.arc(256, 256, 220, 0, Math.PI * 2);
    else p.roundRect ? p.roundRect(a + 0, a + 0, w, w, sh === "round" ? 80 : 6) : p.rect(a, a, w, w);
    return p;
  },
  draw(cv) {
    const g = cv.getContext("2d"), { img, S } = StickerMaker;
    g.clearRect(0, 0, 512, 512);
    const clip = StickerMaker.path();
    if (StickerMaker.outline) { g.save(); g.shadowColor = "rgba(0,0,0,.35)"; g.shadowBlur = 14; g.shadowOffsetY = 4; g.lineWidth = 30; g.strokeStyle = "#fff"; g.stroke(clip); g.restore(); g.save(); g.lineWidth = 30; g.strokeStyle = "#fff"; g.stroke(clip); g.restore(); }
    g.save(); g.clip(clip);
    g.fillStyle = "#ddd"; g.fillRect(0, 0, 512, 512);
    const w = img.width * S.s, h = img.height * S.s;
    g.drawImage(img, 256 + S.x - w / 2, 256 + S.y - h / 2, w, h);
    g.restore();
    const t = StickerMaker.text.trim();
    if (t) {
      g.save(); g.textAlign = "center"; g.lineJoin = "round"; g.font = `800 ${t.length > 12 ? 52 : 66}px Manrope, Arial, sans-serif`;
      g.lineWidth = 14; g.strokeStyle = "#2B2B3A"; g.strokeText(t, 256, 440); g.fillStyle = "#fff"; g.fillText(t, 256, 440); g.restore();
    }
  },
  async save(cv) {
    const ok = StickerMaker.el.querySelector(".mk-ok");
    ok.disabled = true; ok.textContent = "…";
    try {
      const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
      const fid = await Up.upload(blob, { name: "sticker.png", mime: "image/png" });
      const d = await api("/api/stickers", { method: "POST", body: { fid, kind: "sticker", w: 512, h: 512, emoji: StickerMaker.emoji } });
      Panel.mine.stickers.unshift(d.item);
      Panel.tab = "stk"; Panel.pack = "mine"; Panel.render();
      StickerMaker.close(); toast("Стикер создан");
    } catch (e) { toast(e.message); ok.disabled = false; ok.textContent = "Готово"; }
  },
  close() { if (StickerMaker.release) StickerMaker.release(); else StickerMaker.hide(); },
  hide() {
    const el = StickerMaker.el; if (!el) return;
    StickerMaker.release = null;
    el.classList.remove("show"); setTimeout(() => el.remove(), 200); StickerMaker.el = null;
  },
};
