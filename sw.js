// sw.js — Service Worker:
//  • оффлайн-режим: сам сайт (index.html, скрипты, стили, значки) хранится на устройстве — без интернета
//    или когда сервер выключен, приложение всё равно открывается, а чаты берутся из кэша (offline.js);
//  • скачанные фото/видео/музыка/файлы хранятся на устройстве (раздел «Данные и память») и открываются
//    без сети — видео и музыка тоже (отдаём из кэша нужные куски, как сервер);
//  • системные уведомления: звонки и сообщения, когда вкладка/приложение свёрнуты или закрыты.
const CACHE = "media-v1";
const SHELL = "shell-v2";
const MAX_ITEM = 60 * 1024 * 1024;       // файлы больше 60 МБ в кэш не кладём

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  try { for (const k of await caches.keys()) if (k.startsWith("shell-") && k !== SHELL) await caches.delete(k); } catch (er) {}
  await self.clients.claim();
})()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  const file = url.pathname.includes("/api/f/") || url.pathname.includes("/avatar/");
  if (file) return e.respondWith(media(req, url));
  if (url.pathname.includes("/api/") || url.pathname.endsWith("/ws")) return;       // данные API — не кэшируем здесь
  if (/\.apk$/i.test(url.pathname)) return;                                       // установочный файл не храним
  const same = url.origin === self.location.origin;
  if (same) return e.respondWith(shell(req, url));
  if (url.hostname === "telegram.org") return e.respondWith(shell(req, url));      // telegram-web-app.js — чтобы без сети не ждать его
});

// ── сайт: файлы с ?v= не меняются (новая версия = новый адрес) — сразу из кэша; остальное — сначала сеть ──
async function shell(req, url) {
  const cache = await caches.open(SHELL);
  const versioned = url.searchParams.has("v");
  if (versioned) {
    const hit = await cache.match(req);
    if (hit) return hit;
  }
  try {
    const res = await withTimeout(fetch(req), req.mode === "navigate" ? 4500 : 8000);
    if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (er) {
    const hit = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true })) ||
      (req.mode === "navigate" ? (await cache.match("./")) || (await cache.match("./index.html", { ignoreSearch: true })) : null);
    if (hit) return hit;
    return new Response("", { status: 504, statusText: "offline" });
  }
}
function withTimeout(p, ms) {
  return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout")), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });
}

// ── файлы из чатов ──
async function media(req, url) {
  // ключ без подписи в адресе: один и тот же файл не кладём дважды
  const key = new Request(url.origin + url.pathname);
  const range = req.headers.get("range");
  try {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(key);
    if (hit) return range ? partial(hit, range) : hit;
    if (range) {
      // видео/музыка играют кусками — пробуем сеть; без сети отдать нечего
      return await fetch(req);
    }
    const res = await fetch(url.href, { mode: "cors", credentials: "omit" });
    if (res.status === 200 && res.type !== "opaque") {
      const len = +res.headers.get("content-length") || 0;
      if (!len || len <= MAX_ITEM) {
        const copy = res.clone();
        copy.blob().then((b) => {
          if (b.size > MAX_ITEM) return;
          const h = new Headers(copy.headers);
          h.set("x-cached-at", String(Date.now()));
          h.set("content-length", String(b.size));
          h.set("accept-ranges", "bytes");
          return cache.put(key, new Response(b, { status: 200, headers: h }));
        }).catch(() => {});
      }
    }
    return res;
  } catch (err) {
    try { return await fetch(req); } catch (er) { return new Response("", { status: 504, statusText: "offline" }); }
  }
}

// ответ 206 из целого файла в кэше — так <video>/<audio> перематываются и без сети
async function partial(res, range) {
  const b = await res.blob();
  const m = /bytes=(\d*)-(\d*)/.exec(range || "");
  let start = m && m[1] ? +m[1] : 0, end = m && m[2] ? +m[2] : b.size - 1;
  if (m && !m[1] && m[2]) { start = Math.max(0, b.size - +m[2]); end = b.size - 1; }
  end = Math.min(end, b.size - 1);
  if (start > end || start >= b.size) return new Response("", { status: 416, headers: { "content-range": `bytes */${b.size}` } });
  const h = new Headers(res.headers);
  h.set("content-range", `bytes ${start}-${end}/${b.size}`);
  h.set("content-length", String(end - start + 1));
  h.set("accept-ranges", "bytes");
  return new Response(b.slice(start, end + 1), { status: 206, statusText: "Partial Content", headers: h });
}

// ───────── Web Push: звонки и сообщения — системным уведомлением, даже когда вкладка свёрнута или закрыта ─────────
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { return; }
  if (data.type === "rtc" && data.call) return e.waitUntil(onCallPush(data));
  if (data.type === "msg" && data.chat) return e.waitUntil(onMsgPush(data));
});

async function anyVisible() {
  try {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    return wins.some((c) => c.visibilityState === "visible");
  } catch (e) { return false; }
}

async function onMsgPush(data) {
  if (await anyVisible()) return;                    // приложение перед глазами — оно само покажет сообщение
  try {
    await self.registration.showNotification(String(data.title || "Dicegram").slice(0, 64), {
      tag: "m" + data.chat, renotify: true, body: String(data.body || "").slice(0, 200),
      icon: "icon-192.png", badge: "icon-192.png", data: { chat: data.chat },
    });
  } catch (e) {}
}

async function onCallPush(data) {
  const tag = "call-" + data.call;
  if (data.k !== "invite") {
    // звонок уже не актуален (отменён/отклонён/завершён/занято/офлайн) — убираем уведомление, если оно есть
    try { (await self.registration.getNotifications({ tag })).forEach((n) => n.close()); } catch (e) {}
    return;
  }
  // приложение открыто и видно — экран входящего звонка уже показывается внутри самого приложения
  if (await anyVisible()) return;
  try {
    await self.registration.showNotification(data.v ? "Входящий видеозвонок" : "Входящий звонок", {
      tag, body: String(data.name || "Dicegram").slice(0, 60), icon: "icon-192.png", badge: "icon-192.png",
      requireInteraction: true, vibrate: [400, 200, 400, 200, 400], data,
      actions: [{ action: "answer", title: "Ответить" }, { action: "decline", title: "Отклонить" }],
    });
  } catch (e) {}
}

self.addEventListener("notificationclick", (e) => {
  const d = e.notification.data || {};
  e.notification.close();
  if (!d.call) {
    // сообщение: открыть нужный чат (в уже открытом окне — через hash, иначе новое окно с #m=…)
    const link = d.chat ? "#m=" + d.chat : "";
    e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) { try { if (link) c.postMessage({ type: "open-link", link }); } catch (er) {} return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow("./" + link);
    }));
    return;
  }
  // звонок: либо сообщаем уже открытой странице (она сама знает, что делать — Calls.fromPush),
  // либо (приложение полностью закрыто) открываем его с данными звонка в адресе
  const action = e.action === "decline" ? "decline" : "answer";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ("focus" in c) { try { c.postMessage({ type: "push-call", action, data: d }); } catch (er) {} return c.focus(); }
    }
    if (self.clients.openWindow) {
      const q = action === "decline" ? "call_decline" : "call_answer";
      return self.clients.openWindow("./?" + q + "=" + encodeURIComponent(JSON.stringify(d)));
    }
  }));
});
