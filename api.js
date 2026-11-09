// Общие функции: запросы, сессия (отдельная для каждого Telegram-аккаунта), аватарки, время.
const $ = (id) => document.getElementById(id);
const APP_VER = "2026.11.04l";
const TGW = window.Telegram && Telegram.WebApp;
const INIT = (TGW && TGW.initData) || "";
const TG_ID = (TGW && TGW.initDataUnsafe && TGW.initDataUnsafe.user && TGW.initDataUnsafe.user.id) || "web";

// Токен хранится отдельно для каждого Telegram-аккаунта: второй аккаунт не получит чужую сессию.
const Store = {
  get token() { return localStorage.getItem("tok_" + TG_ID) || ""; },
  set token(v) { v ? localStorage.setItem("tok_" + TG_ID, v) : localStorage.removeItem("tok_" + TG_ID); },
};

// Сохранённые аккаунты (переключение без выхода). Список тоже отдельный для каждого Telegram-аккаунта,
// иначе в Mini App чужие токены дадут 401.
const Accounts = {
  key: "tg_accounts_" + TG_ID,
  prevKey: "tg_prev_" + TG_ID,
  list() {
    try { const a = JSON.parse(localStorage.getItem(Accounts.key) || "[]"); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  },
  save(a) { try { localStorage.setItem(Accounts.key, JSON.stringify(a)); } catch (e) {} },
  upsert(token, u) {
    if (!token || !u || !u.id) return;
    const a = Accounts.list();
    const rec = { token, id: u.id, name: dispName(u), username: u.username || "", number: u.number || "",
                  avatar: u.avatar || "", is_system: u.is_system || 0 };
    const i = a.findIndex((x) => x.token === token);
    if (i >= 0) a[i] = rec; else a.push(rec);
    Accounts.save(a);
  },
  remove(token) { if (token) Accounts.save(Accounts.list().filter((x) => x.token !== token)); },
  // жив ли сохранённый сеанс (для защиты от повторного добавления одного и того же аккаунта)
  async alive(token) {
    try { const r = await fetch(CONFIG.API + "/api/me", { headers: { Authorization: "Bearer " + token } }); return r.status !== 401; }
    catch (e) { return true; }
  },
  setPrev(token) { try { localStorage.setItem(Accounts.prevKey, token || ""); } catch (e) {} },
  getPrev() { try { return localStorage.getItem(Accounts.prevKey) || ""; } catch (e) { return ""; } },
  clearPrev() { try { localStorage.removeItem(Accounts.prevKey); } catch (e) {} },
};
// Старый общий список (ключ tg_accounts) переносим один раз и удаляем: в нём лежат токены.
(function migrateAccounts() {
  try {
    const old = localStorage.getItem("tg_accounts");
    if (old === null) return;
    if (TG_ID === "web" && localStorage.getItem(Accounts.key) === null) localStorage.setItem(Accounts.key, old);
    localStorage.removeItem("tg_accounts");
  } catch (e) {}
})();

async function api(path, { method = "GET", body, timeout = 0 } = {}) {
  const h = {};
  if (body) h["Content-Type"] = "application/json";
  if (Store.token) h.Authorization = "Bearer " + Store.token;
  if (INIT) h["X-Init-Data"] = INIT;
  let r;
  const payload = body ? JSON.stringify(body) : undefined;
  const ctl = timeout && window.AbortController ? new AbortController() : null, tm = ctl ? setTimeout(() => ctl.abort(), timeout) : 0;
  try { r = await fetch(CONFIG.API + path, { method, headers: h, body: payload, signal: ctl ? ctl.signal : undefined }); try { Net.add("tx", "msg", (payload ? payload.length : 0) + 300); } catch (e) {} }
  catch (e) { throw new Error(ctl && ctl.signal.aborted ? "Сервер не отвечает" : "Нет связи с сервером"); }
  finally { clearTimeout(tm); }
  let d = {};
  try { d = await r.json(); } catch (e) {}
  if (r.status === 401 && Store.token) {
    // сессия недействительна: убираем её и из списка аккаунтов, чтобы не переключаться на мёртвый токен
    try { OC.wipe(); } catch (e) {}
    Accounts.remove(Store.token); Store.token = ""; location.reload();
  }
  if (r.status >= 502 && r.status <= 504 && !d.error) throw new Error("Нет связи с сервером");
  if (!r.ok || d.ok === false) throw new Error(d.error || T("Ошибка") + " " + r.status);
  return d;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// простое форматирование: **жирный**, `код`, ссылки
function fmtText(s) {
  return esc(s)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}
const plain = (s) => String(s).replace(/\*\*|`/g, "");

// установлено как приложение (экран «Домой») или открыто во вкладке
const isStandalone = () => { try { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch (e) { return false; } };
// что сообщаем серверу об устройстве, чтобы в «Новом входе» было настоящее название (модель, версия системы)
async function devInfo() {
  const o = { app: isStandalone() };
  try {
    const u = navigator.userAgentData;
    if (u && u.getHighEntropyValues) { const v = await u.getHighEntropyValues(["model", "platformVersion"]); o.model = v.model || ""; o.pv = v.platformVersion || ""; }
  } catch (e) {}
  return o;
}

const PLANE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 3.5 10.5 14"/><path d="M21.5 3.5 14.5 21l-4-7-7-4z"/></svg>';
const PERSON = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="9" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z"/></svg>';
const VERIFIED = '<svg class="ver" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="m7.5 12.3 3 3 6-6.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// значок верификации сразу после имени: Official — чёрный круг с белой галочкой (с тонкой светлой обводкой,
// чтобы был виден и в тёмной теме), Major — синий #3390EC с белой галочкой; обычная отметка — цвет акцента.
const VER_CK = '<path d="m7.4 12.4 3.1 3.1 6.1-6.4" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>';
function verBadge(u, cls = "") {
  if (!isVer(u)) return "";
  const tier = (u && u.vtier) || "";
  const tip = tier === "official" ? T("Этот аккаунт официально подтверждён администрацией DICEGRAM") : tier === "major" ? T("Аккаунт верифицирован организацией Major") : "";
  const circle = tier === "official" ? '<circle cx="12" cy="12" r="10.3" fill="#0b0b0d" stroke="#fff" stroke-opacity=".3" stroke-width="1"/>'
    : tier === "major" ? '<circle cx="12" cy="12" r="10.5" fill="#3390EC"/>' : '<circle cx="12" cy="12" r="10" fill="currentColor"/>';
  return `<svg class="ver${tier ? " ver-" + tier : ""}${cls ? " " + cls : ""}" viewBox="0 0 24 24"${tip ? ` title="${esc(tip)}" aria-label="${esc(tip)}"` : ""}>${circle}${VER_CK}</svg>`;
}
// подпись под карточкой данных в профиле (как в Telegram): значок слева, серый текст, название организации жирным
function verNote(u) {
  const tier = u && u.vtier;
  if (tier !== "official" && tier !== "major") return "";
  const tpl = tier === "official" ? T("Этот аккаунт официально подтверждён администрацией {0}.") : T("Аккаунт верифицирован организацией {0}.");
  const who = tier === "official" ? "DICEGRAM" : "«Major»";
  return `<div class="pf-vnote" data-tier="${tier}">${verBadge(u, "md")}<span>${esc(tpl).replace("{0}", `<b>${esc(who)}</b>`)}</span></div>`;
}
const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON = {
  camera: svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/>'),
  device: svg('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>'),
  out: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  shield: svg('<path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6z"/>'),
};

function avatarUrl(u) { return CONFIG.API + "/avatar/" + encodeURIComponent(u.avatar); }
// цвета «заглушек» аватара, как в Telegram: у каждого человека/группы свой, по номеру
const AV_COLORS = [["#FF885E", "#FF516A"], ["#FFCD6A", "#FFA85C"], ["#82B1FF", "#665FFF"], ["#A0DE7E", "#54CB68"], ["#53EDD6", "#28C9B7"], ["#72D5FD", "#2A9EF1"], ["#E0A2F3", "#D669ED"]];
function avatar(u, cls = "") {
  if (u.is_system) return `<div class="av sys ${cls}">${PLANE}<img class="sysimg" src="official.png" alt="" draggable="false" onerror="this.remove()"></div>`;
  if (u.avatar) return `<div class="av ${cls}"><img src="${avatarUrl(u)}" alt="" decoding="async"></div>`;
  const nm = cleanName(u.name) || cleanName(u.surname) || String(u.username || "").trim(), ch = nm ? Array.from(nm)[0].toUpperCase() : "";
  if (!ch) return `<div class="av def ${cls}">${PERSON}</div>`;
  const c = AV_COLORS[Math.abs(+u.id || 0) % AV_COLORS.length];
  return `<div class="av def ltr ${cls}" style="background:linear-gradient(160deg,${c[0]},${c[1]})"><span class="av-l">${esc(ch)}</span></div>`;
}
// имена из невидимых символов (пустой «Hangul filler», нулевой пробел и т.п.) показываем как @username или номер
const INVIS_RE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0]/g;
const cleanName = (s) => String(s == null ? "" : s).replace(INVIS_RE, "").replace(/\s+/g, " ").trim();
const dispName = (u) => [cleanName(u.name), cleanName(u.surname)].filter(Boolean).join(" ") || (u.username ? "@" + u.username : "") || u.number || T("Пользователь");
const PREM_I = '<svg class="prem-i" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/></svg>';
// Значок Premium показывается только на экранах профиля (см. PB в premium.js). Чтобы вернуть звезду в списки чатов — поставьте true.
const BADGE_IN_LISTS = false;
// имя на экране профиля: галочка + значок Premium (анимированный эмодзи-статус), по нажатию на значок открывается окно Premium
const isVer = (u) => !!(u && (u.is_system || u.verified));
const profName = (u) => esc(dispName(u)) + verBadge(u) + (typeof PB !== "undefined" ? PB.html(u) : "");
// шапка профиля: обычный эмодзи-статус фон НЕ меняет. Фон и узор меняет только надетый коллекционный подарок (NFT)
// ── премиальные фоны профиля: у каждого цвета своя палитра (глубокий тон, средний, свет, акцент),
// мягкий градиентный свет, едва заметный узор и «пятна» света — а не сплошная заливка ──
const PBG = {
  list: [
    { id: "dark", n: "Тёмный", p: ["#07080c", "#171b24", "#3a4354", "#1d2a40"], pat: "lines" },
    { id: "red", n: "Красный", p: ["#24050a", "#64101c", "#c0424f", "#8a1838"], pat: "waves" },
    { id: "blue", n: "Синий", p: ["#05173a", "#0f3a78", "#4f9df2", "#1b66cf"], pat: "hex" },
    { id: "purple", n: "Фиолетовый", p: ["#170a33", "#3b1c78", "#9d7df2", "#6838d6"], pat: "sparkle" },
    { id: "green", n: "Зелёный", p: ["#04211a", "#0d553c", "#4cc38f", "#11784f"], pat: "rings" },
    { id: "pink", n: "Розовый", p: ["#360a29", "#8a2663", "#f292c6", "#c2448e"], pat: "petals" },
    { id: "orange", n: "Оранжевый", p: ["#341204", "#94400c", "#ffb062", "#d8641b"], pat: "rays" },
    { id: "graphite", n: "Графит", p: ["#101215", "#2a2f37", "#6d7683", "#3b434e"], pat: "diamonds" },
    { id: "light", n: "Светлый", p: ["#dfe5ee", "#f5f7fb", "#ffffff", "#cfd9e8"], pat: "bokeh", light: true },
    { id: "cosmic", n: "Космический", p: ["#04020f", "#180d42", "#6b4fe0", "#1c64b6"], pat: "stars" },
  ],
  byId(id) { return PBG.list.find((x) => x.id === id) || null; },
  // фон коллекционного подарка: его собственные цвета, но та же «дорогая» подача и узор по смыслу цвета
  NFT: { "Небесный": "blue", "Малина": "pink", "Мята": "green", "Янтарь": "orange", "Лаванда": "purple", "Графит": "graphite",
         "Рубин": "red", "Изумруд": "green", "Закат": "orange", "Северное сияние": "cosmic", "Чёрный бриллиант": "dark" },
  style(p) { return `--p1:${p[0]};--p2:${p[1]};--p3:${p[2]};--p4:${p[3]}`; },
  orbs() { return '<i class="pbg-orb o1"></i><i class="pbg-orb o2"></i><i class="pbg-orb o3"></i>'; },
  // какой фон у человека: надетый NFT → выбранный фон (Premium) → «Тёмный» у владельца сервиса
  of(u) {
    if (!u || u.is_system || u.deleted) return null;
    if (u.premium && u.nft && u.nft.backdrop) {
      const b = u.nft.backdrop, key = PBG.NFT[b.n] || "blue";
      return { key, light: false, style: `--p1:color-mix(in srgb,${b.c2} 55%,#000);--p2:${b.c2};--p3:${b.c1};--p4:color-mix(in srgb,${b.c1} 50%,${b.c2})`, nft: true };
    }
    const pal = (u.premium && PBG.byId(u.pbg)) || (u.owner_theme ? PBG.byId(u.pbg) || PBG.byId("dark") : null);
    return pal ? { key: pal.id, light: !!pal.light, style: PBG.style(pal.p), pat: pal.pat } : null;
  },
};
const premHero = (u) => {
  const bg = PBG.of(u);
  if (!bg) return { cls: "", style: "", pat: "" };
  const pal = PBG.byId(bg.key) || {};
  let pat = PBG.orbs();
  if (bg.nft) {
    const e = esc((u.nft.pattern && u.nft.pattern.e) || "✨");
    const P = [[7, 12, 20, 0], [86, 10, 16, 0.8], [20, 44, 14, 1.6], [76, 40, 18, 2.2], [92, 62, 14, 0.4], [8, 70, 18, 1.2], [50, 5, 12, 2.8], [64, 78, 16, 0.6], [32, 84, 14, 2], [88, 84, 17, 1.4], [3, 44, 12, 3], [56, 52, 11, 3.4], [40, 22, 11, 1], [68, 20, 12, 2.4]];
    pat += `<div class="pf-pat">${P.map(([x, y, z, d]) => `<i class="e" style="--x:${x}%;--y:${y}%;--s:${z}px;--d:${d}s">${e}</i>`).join("")}</div>`;
  }
  return { cls: ` prem pbg pat-${esc(pal.pat || "lines")}${bg.light ? " pbg-light" : ""}`, style: ` style="${esc(bg.style)}"`, pat };
};
const nameHTML = (u) => esc(dispName(u)) + verBadge(u) + (BADGE_IN_LISTS && u.premium && !u.is_system ? PREM_I : "");

// ── номер телефона и день рождения ──
const fmtPhone = (n) => { const m = /^\+888(\d{4})(\d{4})$/.exec(n || ""); return m ? `+888 ${m[1]} ${m[2]}` : (n || ""); };
const MON_S = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."];
const MON_N = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
if (I18N.lang === "en") {
  MON_S.splice(0, 12, "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec");
  MON_N.splice(0, 12, "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December");
}
const MON_L = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const plural = (n, one, few, many) => { if (I18N.lang === "en") return n === 1 ? one : many; const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
// "ГГГГ-ММ-ДД" или "--ММ-ДД" (без года) → {y, m, d}; y = 0, если года нет
function parseBday(b) { const m = /^(\d{4}|-)-(\d{2})-(\d{2})$/.exec(b || ""); return m ? { y: m[1] === "-" ? 0 : +m[1], m: +m[2], d: +m[3] } : null; }
function bdayAge(p) {
  const n = new Date();
  let a = n.getFullYear() - p.y;
  if (n.getMonth() + 1 < p.m || (n.getMonth() + 1 === p.m && n.getDate() < p.d)) a--;
  return a;
}
// "13 янв. 1994 (32 года)"
function bdayText(b, age = true) {
  const p = parseBday(b); if (!p) return "";
  let s = `${p.d} ${MON_S[p.m - 1]}${p.y ? " " + p.y : ""}`;
  if (p.y && age) { const a = bdayAge(p); if (a >= 0) s += ` (${a} ${I18N.lang === "en" ? (a === 1 ? "year" : "years") + " old" : plural(a, "год", "года", "лет")})`; }
  return s;
}
const bdayToday = (b) => { const p = parseBday(b), n = new Date(); return !!p && p.m === n.getMonth() + 1 && p.d === n.getDate(); };

// ── время: по часам и настройкам телефона (12/24ч, язык) ──
const fmtTime = (ts) => new Date(ts * 1000).toLocaleTimeString(I18N.tloc, { hour: "2-digit", minute: "2-digit" });
const sameDay = (a, b) => a.toDateString() === b.toDateString();
function fmtDay(ts) {
  const d = new Date(ts * 1000), now = new Date();
  if (sameDay(d, now)) return T("Сегодня");
  if (sameDay(d, new Date(Date.now() - 864e5))) return T("Вчера");
  return d.toLocaleDateString(I18N.tloc, { day: "numeric", month: "long", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
function listTime(ts) {
  const d = new Date(ts * 1000), now = new Date();
  if (sameDay(d, now)) return fmtTime(ts);
  if (now - d < 6 * 864e5) return d.toLocaleDateString(I18N.tloc, { weekday: "short" });
  return d.toLocaleDateString(I18N.tloc, { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function statusText(u) {
  if (u.gk) {                                   // группа или канал
    const n = u.members || 0;
    return u.gk === "channel" ? n + " " + plural(n, T("подписчик"), T("подписчика"), T("подписчиков")) : n + " " + plural(n, T("участник"), T("участника"), T("участников"));
  }
  if (u.is_system) return T("служебные уведомления");
  if (u.online) return T("в сети");
  if (!u.last_seen) return T("был(а) недавно");
  const diff = Date.now() / 1000 - u.last_seen;
  if (diff < 60) return T("был(а) только что");
  if (diff < 3600) return T("был(а) {0} мин. назад", Math.floor(diff / 60));
  const d = new Date(u.last_seen * 1000);
  if (sameDay(d, new Date())) return T("был(а) сегодня в {0}", fmtTime(u.last_seen));
  if (sameDay(d, new Date(Date.now() - 864e5))) return T("был(а) вчера в {0}", fmtTime(u.last_seen));
  return T("был(а) недавно");
}

let toastT;
function toast(t) {
  const el = $("toast"); el.textContent = t; el.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2600);
}
function haptic(k = "light") { try { TGW.HapticFeedback.impactOccurred(k); } catch (e) {} }

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch (e) {
    const a = document.createElement("textarea"); a.value = t; a.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(a); a.select(); try { document.execCommand("copy"); } catch (_) {} a.remove();
  }
}

// своё окно подтверждения (без системных диалогов); danger=false — кнопка не красная
function ask(text, okLabel = "Выйти", danger = true) {
  return new Promise((res) => {
    const ok = $("sheet-ok");
    $("sheet-t").textContent = text; ok.textContent = okLabel; ok.classList.toggle("danger", !!danger);
    $("sheet").classList.remove("hidden");
    const done = (v) => { $("sheet").classList.add("hidden"); res(v); };
    ok.onclick = () => done(true);
    $("sheet-no").onclick = () => done(false);
    $("sheet").onclick = (e) => { if (e.target.id === "sheet") done(false); };
  });
}
