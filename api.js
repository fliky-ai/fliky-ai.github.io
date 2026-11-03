// Общие функции: запросы, сессия (отдельная для каждого Telegram-аккаунта), аватарки, время.
const $ = (id) => document.getElementById(id);
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
    const rec = { token, id: u.id, name: u.name || u.number || "", username: u.username || "", number: u.number || "",
                  avatar: u.avatar || "", is_system: u.is_system || 0 };
    const i = a.findIndex((x) => x.token === token);
    if (i >= 0) a[i] = rec; else a.push(rec);
    Accounts.save(a);
  },
  remove(token) { if (token) Accounts.save(Accounts.list().filter((x) => x.token !== token)); },
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

async function api(path, { method = "GET", body } = {}) {
  const h = {};
  if (body) h["Content-Type"] = "application/json";
  if (Store.token) h.Authorization = "Bearer " + Store.token;
  if (INIT) h["X-Init-Data"] = INIT;
  let r;
  try { r = await fetch(CONFIG.API + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }); }
  catch (e) { throw new Error("Нет связи с сервером"); }
  let d = {};
  try { d = await r.json(); } catch (e) {}
  if (r.status === 401 && Store.token) {
    // сессия недействительна: убираем её и из списка аккаунтов, чтобы не переключаться на мёртвый токен
    Accounts.remove(Store.token); Store.token = ""; location.reload();
  }
  if (!r.ok || d.ok === false) throw new Error(d.error || "Ошибка " + r.status);
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
function avatar(u, cls = "") {
  if (u.is_system) return `<div class="av sys ${cls}">${PLANE}</div>`;
  if (u.avatar) return `<div class="av ${cls}"><img src="${avatarUrl(u)}" alt="" decoding="async"></div>`;
  return `<div class="av def ${cls}">${PERSON}</div>`;
}
const dispName = (u) => u.name || u.number || "Пользователь";
const nameHTML = (u) => esc(dispName(u)) + (u.is_system ? VERIFIED : "");

// ── время: по часам и настройкам телефона (12/24ч, язык) ──
const fmtTime = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const sameDay = (a, b) => a.toDateString() === b.toDateString();
function fmtDay(ts) {
  const d = new Date(ts * 1000), now = new Date();
  if (sameDay(d, now)) return "Сегодня";
  if (sameDay(d, new Date(Date.now() - 864e5))) return "Вчера";
  return d.toLocaleDateString([], { day: "numeric", month: "long", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
function listTime(ts) {
  const d = new Date(ts * 1000), now = new Date();
  if (sameDay(d, now)) return fmtTime(ts);
  if (now - d < 6 * 864e5) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function statusText(u) {
  if (u.is_system) return "служебные уведомления";
  if (u.online) return "в сети";
  if (!u.last_seen) return "был(а) недавно";
  const diff = Date.now() / 1000 - u.last_seen;
  if (diff < 60) return "был(а) только что";
  if (diff < 3600) return `был(а) ${Math.floor(diff / 60)} мин. назад`;
  const d = new Date(u.last_seen * 1000);
  if (sameDay(d, new Date())) return "был(а) сегодня в " + fmtTime(u.last_seen);
  if (sameDay(d, new Date(Date.now() - 864e5))) return "был(а) вчера в " + fmtTime(u.last_seen);
  return "был(а) недавно";
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
