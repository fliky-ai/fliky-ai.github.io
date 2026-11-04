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

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) return c.focus();
    if (self.clients.openWindow) return self.clients.openWindow("./");
  }));
});
