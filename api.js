// Общие функции: запросы к серверу, хранилище токена, аватарки, время.
const $ = (id) => document.getElementById(id);

const Store = {
  get token() { return localStorage.getItem("tok") || ""; },
  set token(v) { v ? localStorage.setItem("tok", v) : localStorage.removeItem("tok"); },
};

async function api(path, { method = "GET", body } = {}) {
  let r;
  try {
    r = await fetch(CONFIG.API + path, {
      method,
      headers: { "Content-Type": "application/json", ...(Store.token ? { Authorization: "Bearer " + Store.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { throw new Error("Нет связи с сервером"); }
  let d = {};
  try { d = await r.json(); } catch (e) {}
  if (r.status === 401 && Store.token) { Store.token = ""; location.reload(); }
  if (!r.ok || d.ok === false) throw new Error(d.error || "Ошибка " + r.status);
  return d;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const PLANE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 3.5 10.5 14"/><path d="M21.5 3.5 14.5 21l-4-7-7-4z"/></svg>';
const VERIFIED = '<svg class="ver" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="m7.5 12.3 3 3 6-6.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const GRAD = [["#FF885E", "#FF516A"], ["#FFCD6A", "#FFA85C"], ["#82B1FF", "#665FFF"], ["#A0DE7E", "#54CB68"], ["#53EDD6", "#28C9B7"], ["#72D5FD", "#2A9EF1"], ["#E0A2F3", "#D669ED"]];

function avatar(u, cls = "") {
  if (u.is_system) return `<div class="av sys ${cls}">${PLANE}</div>`;
  const g = GRAD[u.id % GRAD.length];
  const n = (u.name || "").trim();
  const ch = !n || /^[+\d]/.test(n) ? "#" : n.charAt(0).toUpperCase();
  return `<div class="av ${cls}" style="background:linear-gradient(135deg,${g[0]},${g[1]})">${esc(ch)}</div>`;
}
const nameHTML = (u) => esc(u.name) + (u.is_system ? VERIFIED : "");

const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (ts) => { const d = new Date(ts * 1000); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
const sameDay = (a, b) => a.toDateString() === b.toDateString();
function fmtDay(ts) {
  const d = new Date(ts * 1000), now = new Date(), y = new Date(Date.now() - 864e5);
  if (sameDay(d, now)) return "Сегодня";
  if (sameDay(d, y)) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}
function listTime(ts) {
  const d = new Date(ts * 1000);
  return sameDay(d, new Date()) ? fmtTime(ts) : pad(d.getDate()) + "." + pad(d.getMonth() + 1);
}

let toastT;
function toast(t) {
  const el = $("toast"); el.textContent = t; el.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2800);
}
