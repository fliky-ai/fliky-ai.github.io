// Точка входа: сессия, навигация, вкладки, WebSocket.
// Стек страниц поверх вкладок. Назад = кнопка Telegram / кнопка браузера / стрелка.
const Nav = {
  stack: [],
  open(id, onClose) {
    $(id).classList.add("open"); $(id).setAttribute("aria-hidden", "false");
    Nav.stack.push({ id, onClose }); history.pushState({ n: Nav.stack.length }, ""); Nav.sync();
  },
  // Слой без страницы (меню сообщения, просмотр фото, камера…): «назад» закрывает его, а не весь чат.
  // Возвращает функцию, которой слой закрывают сами (она же вызывает onClose через историю).
  layer(onClose) {
    const t = { id: null, onClose };
    Nav.stack.push(t); history.pushState({ n: Nav.stack.length }, ""); Nav.sync();
    return () => {
      if (Nav.stack[Nav.stack.length - 1] === t) Nav.back();
      else { const i = Nav.stack.indexOf(t); if (i >= 0) Nav.stack.splice(i, 1); if (onClose) onClose(); }
    };
  },
  pop() {
    const t = Nav.stack.pop(); if (!t) return;
    if (t.id) { $(t.id).classList.remove("open"); $(t.id).setAttribute("aria-hidden", "true"); }
    if (t.onClose) t.onClose(); Nav.sync();
  },
  back() { if (Nav.stack.length) history.back(); },
  sync() { try { Nav.stack.length ? TGW.BackButton.show() : TGW.BackButton.hide(); } catch (e) {} },
};
addEventListener("popstate", () => Nav.pop());

// Встроенный браузер: страница открывается поверх приложения. Часть сайтов запрещает показ внутри чужих страниц —
// поэтому сверху всегда есть кнопка «открыть в браузере».
const Browser = {
  external(url) { try { TGW.openLink(url); } catch (_) { window.open(url, "_blank", "noopener"); } },
  open(url) {
    if (!/^https?:/i.test(url) || !Prefs.get("browser", false)) return Browser.external(url);
    const el = document.createElement("div");
    el.className = "ibr";
    let host = url; try { host = new URL(url).hostname; } catch (e) {}
    el.innerHTML = `<div class="ibr-top"><button class="ibr-x" aria-label="${esc(T("Закрыть"))}">${SI.x}</button><div class="ibr-t"><b>${esc(host)}</b><small>${esc(T("Если страница не открылась, нажмите справа"))}</small></div>
      <button class="ibr-o" aria-label="${esc(T("Открыть в браузере"))}">${SI.compass}</button></div><iframe class="ibr-f" src="${esc(url)}" referrerpolicy="no-referrer" sandbox="allow-scripts allow-forms allow-same-origin allow-popups"></iframe>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    const close = Nav.layer(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 220); });
    el.querySelector(".ibr-x").onclick = close;
    el.querySelector(".ibr-o").onclick = () => Browser.external(url);
  },
};

const App = {
  user: null, ws: null, pingT: null, retry: 0, retryT: null,

  async start() {
    if (TGW) {
      try { TGW.ready(); TGW.expand(); TGW.disableVerticalSwipes(); TGW.BackButton.onClick(() => Nav.back()); } catch (e) {}
      Theme.tg();
    }
    const setVH = () => document.documentElement.style.setProperty("--vh", (window.visualViewport ? visualViewport.height : innerHeight) + "px");
    setVH(); if (window.visualViewport) visualViewport.addEventListener("resize", setVH); addEventListener("resize", setVH);

    document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => { haptic(); App.go(b.dataset.tab); }));
    ["chat-back", "up-back", "ed-back"].forEach((id) => ($(id).onclick = () => Nav.back()));
    // никаких системных меню
    document.addEventListener("contextmenu", (e) => { if (!/INPUT|TEXTAREA/.test(e.target.tagName) || e.target.closest("#panel")) e.preventDefault(); });
    document.addEventListener("click", (e) => {
      const a = e.target.closest("a"); if (!a || a.dataset.dl) return;
      e.preventDefault(); Browser.open(a.href);
    });
    Chats.bind(); Chat.bind(); Contacts.bind();
    Lock.init(); Notif.register(); Media.trim(); Settings.applyAnim(); Energy.update();
    Theme.apply(false);
    // кнопка Telegram «назад» и свайп закрывают открытые окна по порядку; поле ввода не прячем под клавиатуру
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") Nav.back(); });
    App.boot();
  },

  // Запуск сессии. Нет связи или сервер недоступен — НЕ выбрасываем на экран входа
  // (это создавало бы лишние сессии), а ждём и пробуем снова. На вход отправляет только 401.
  async boot() {
    if (!Store.token) return App.showAuth();
    try {
      const d = await api("/api/me");
      return App.enter(d.user);
    } catch (e) {
      if (!Store.token) return App.showAuth();   // 401: api() уже сбросил токен и перезагружает страницу
      toast((e && e.message) || "Нет связи с сервером");
      setTimeout(() => App.boot(), 3000);
    }
  },

  showAuth() {
    const b = $("boot"); if (b) b.classList.add("hidden");
    Auth.init((u) => App.enter(u));
  },

  enter(user) {
    App.user = user;
    const b = $("boot"); if (b) b.classList.add("hidden");
    $("auth").classList.add("hidden"); $("app").classList.remove("hidden");
    Profile.render();               // внутри обновляет и вкладку «Настройки»
    Chats.load(); Stories.load(true); Profile.loadStories();
    App.connect(); App.go("chats");
    App.openHash(); Chat.loadQuick();
    setInterval(() => Chat.updateHeader(), 30000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { App.connect(); Chats.load(); Chat.sync(); } });
    addEventListener("online", () => App.connect());
  },

  // ссылка вида  …/#c=адрес  открывает чат с владельцем ссылки и подставляет готовый текст
  async openHash() {
    const m = /[#&]c=([A-Za-z0-9_]{4,32})/.exec(location.hash || "");
    if (!m) return;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    try {
      const d = await api("/api/biz/link/" + m[1]);
      if (d.user.id === App.user.id) return;
      Chat.open(d.user);
      if (d.text) setTimeout(() => { try { Editor.set(d.text); Editor.focus(true); Chat.syncMain(); } catch (e) {} }, 400);
    } catch (e) { toast(e.message); }
  },

  go(tab) {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "v-" + tab));
    if (tab === "chats") Chats.load();
    if (tab === "profile") { Profile.loadStories(); Stories.load(); }
    if (tab === "settings") { Settings.fetchUnread(); }
  },

  setOnline(v) { $("app").classList.toggle("offline", !v); },

  // WebSocket: токен уходит первым сообщением, а не в адресе (адреса попадают в логи прокси).
  connect() {
    if (!Store.token || (App.ws && App.ws.readyState <= 1)) return;
    clearTimeout(App.retryT);
    const again = () => { if (Store.token) App.retryT = setTimeout(() => App.connect(), Math.min(1000 * 2 ** App.retry++, 15000)); };
    let ws;
    try { ws = new WebSocket(CONFIG.WS); } catch (e) { return again(); }
    App.ws = ws;
    ws.onopen = () => { try { ws.send(JSON.stringify({ type: "auth", token: Store.token, init: INIT })); } catch (e) {} };
    ws.onmessage = (ev) => {
      let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
      Net.add("rx", "msg", (ev.data || "").length);
      if (d.type === "ready") {   // сервер принял токен
        App.retry = 0; App.setOnline(true); Chats.load(); Chat.sync();
        clearInterval(App.pingT); App.pingT = setInterval(() => ws.readyState === 1 && ws.send("ping"), 25000);
      }
      else if (d.type === "message") { Chat.onMessage(d.message); Chats.onMessage(d.message); Notif.onMessage(d.message); }
      else if (d.type === "read") Chat.onRead(d.by);
      else if (d.type === "edit") { Chat.onEdit(d.message); Chats.onEdit(d.message); }
      else if (d.type === "del") { Chat.onDel(d.ids); Chats.load(); }
      else if (d.type === "react") { Chat.onReact(d); Notif.onReact(d); }
      else if (d.type === "pin") Chat.onPin(d);
      else if (d.type === "presence") App.presence(d);
      else if (d.type === "profile") App.profile(d.user);
      else if (d.type === "story") { Notif.onStory(d.user); Stories.load(true); if (d.user === App.user.id) Profile.loadStories(); if (UserProfile.cur && UserProfile.cur.id === d.user) UserProfile.loadStories(d.user); }
    };
    ws.onclose = () => {
      if (App.ws !== ws) return;
      clearInterval(App.pingT); App.setOnline(false); again();
      // сеанс могли завершить на другом устройстве: запрос вернёт 401, и api() сам выведет на экран входа
      if (App.retry >= 2) api("/api/me").catch(() => {});
    };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  },

  // обновляем данные человека везде, где он показан
  patchUser(id, patch) {
    Chats.list.forEach((c) => { if (c.peer.id === id) Object.assign(c.peer, patch); });
    if (Chat.peer && Chat.peer.id === id) { Object.assign(Chat.peer, patch); Chat.updateHeader(); }
    if (App.user && App.user.id === id && !("online" in patch)) Object.assign(App.user, patch);
  },
  presence(d) { App.patchUser(d.user, { online: d.online, last_seen: d.last_seen }); },
  profile(u) {
    App.patchUser(u.id, { name: u.name, surname: u.surname, username: u.username, bio: u.bio, avatar: u.avatar });
    Chats.render(); if (u.id === App.user.id) Profile.render();
  },
};
App.start();
