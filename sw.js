// sw.js — Service Worker: показывает уведомления и хранит скачанные фото/видео/файлы на устройстве (раздел «Данные и память»).
const CACHE = "media-v1";
const MAX_ITEM = 60 * 1024 * 1024;       // файлы больше 60 МБ в кэш не кладём

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  const file = url.pathname.includes("/api/f/") || url.pathname.includes("/avatar/");
  if (!file) return;
  if (req.headers.has("range")) return;            // видео и аудио приходят кусками — отдаём напрямую
  e.respondWith(handle(req, url));
});

async function handle(req, url) {
  // ключ без подписи в адресе: один и тот же файл не кладём дважды
  const key = new Request(url.origin + url.pathname);
  try {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(key);
    if (hit) return hit;
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
          return cache.put(key, new Response(b, { status: 200, headers: h }));
        }).catch(() => {});
      }
    }
    return res;
  } catch (err) {
    return fetch(req);
  }
}

// ───────── Web Push: звонки звонят системным уведомлением, даже когда вкладка/приложение свёрнуты или закрыты ─────────
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { return; }
  if (data.type !== "rtc" || !data.call) return;     // Web Push пока используется только для звонков
  e.waitUntil(onCallPush(data));
});

async function onCallPush(data) {
  const tag = "call-" + data.call;
  if (data.k !== "invite") {
    // звонок уже не актуален (отменён/отклонён/завершён/занято/офлайн) — убираем уведомление, если оно есть
    try { (await self.registration.getNotifications({ tag })).forEach((n) => n.close()); } catch (e) {}
    return;
  }
  // приложение открыто и видно — экран входящего звонка уже показывается внутри самого приложения:
  // системное уведомление не нужно (иначе будет дублирование)
  try {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.some((c) => c.visibilityState === "visible")) return;
  } catch (e) {}
  try {
    await self.registration.showNotification(data.v ? "Входящий видеозвонок" : "Входящий звонок", {
      tag, body: String(data.name || "Dicegram").slice(0, 60), icon: "icon-192.png", badge: "icon-192.png",
      requireInteraction: true, vibrate: [400, 200, 400], data,
      actions: [{ action: "answer", title: "Ответить" }, { action: "decline", title: "Отклонить" }],
    });
  } catch (e) {}
}

self.addEventListener("notificationclick", (e) => {
  const d = e.notification.data;
  e.notification.close();
  if (!d || !d.call) {
    e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow("./");
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
