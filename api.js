// Общие функции: запросы, сессия (отдельная для каждого Telegram-аккаунта), аватарки, время.
const $ = (id) => document.getElementById(id);
const APP_VER = "2026.11.04d";
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
    Accounts.remove(Store.token); Store.token = ""; location.reload();
  }
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

const PLANE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 3.5 10.5 14"/><path d="M21.5 3.5 14.5 21l-4-7-7-4z"/></svg>';
const PERSON = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="9" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z"/></svg>';
const VERIFIED = '<svg class="ver" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="m7.5 12.3 3 3 6-6.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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
  if (u.is_system) return `<div class="av sys ${cls}">${PLANE}</div>`;
  if (u.avatar) return `<div class="av ${cls}"><img src="${avatarUrl(u)}" alt="" decoding="async"></div>`;
  const nm = String(u.name || "").trim(), ch = nm ? Array.from(nm)[0].toUpperCase() : "";
  if (!ch) return `<div class="av def ${cls}">${PERSON}</div>`;
  const c = AV_COLORS[Math.abs(+u.id || 0) % AV_COLORS.length];
  return `<div class="av def ltr ${cls}" style="background:linear-gradient(160deg,${c[0]},${c[1]})"><span class="av-l">${esc(ch)}</span></div>`;
}
const dispName = (u) => [u.name, u.surname].filter(Boolean).join(" ") || u.number || T("Пользователь");
const PREM_I = '<svg class="prem-i" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/></svg>';
// Значок Premium показывается только на экранах профиля (см. PB в premium.js). Чтобы вернуть звезду в списки чатов — поставьте true.
const BADGE_IN_LISTS = false;
// имя на экране профиля: галочка + значок Premium (анимированный эмодзи-статус), по нажатию на значок открывается окно Premium
const profName = (u) => esc(dispName(u)) + (u.is_system ? VERIFIED : "") + (typeof PB !== "undefined" ? PB.html(u) : "");
// шапка профиля Premium-пользователя: цвета берутся из его эмодзи-статуса, на фоне мерцают искорки
const premHero = (u) => {
  if (!u || !u.premium || u.is_system || typeof ES === "undefined") return { cls: "", style: "", pat: "" };
  const [c1, c2] = ES.colors(u.estatus);
  const SPK = '<svg viewBox="0 0 24 24"><path d="M12 1.500c.8 5.600 3.500 8.700 10.500 10.500-7 1.800-9.700 4.900-10.500 10.500C11.200 17.400 8.500 14.300 1.500 12 8.500 10.200 11.200 7.100 12 1.500z"/></svg>';
  const P = [[7, 10, 16, 0], [84, 8, 12, 0.8], [20, 40, 10, 1.6], [72, 36, 14, 2.2], [91, 56, 10, 0.4], [9, 66, 14, 1.2], [48, 5, 9, 2.8], [62, 74, 12, 0.6], [32, 82, 10, 2], [88, 80, 13, 1.4], [3, 42, 9, 3], [55, 50, 8, 3.4]];
  return { cls: " prem", style: ` style="--c1:${c1};--c2:${c2}"`, pat: `<div class="pf-pat">${P.map(([x, y, z, d]) => `<i style="--x:${x}%;--y:${y}%;--s:${z}px;--d:${d}s">${SPK}</i>`).join("")}</div>` };
};
const nameHTML = (u) => esc(dispName(u)) + (u.is_system ? VERIFIED : "") + (BADGE_IN_LISTS && u.premium && !u.is_system ? PREM_I : "");

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
