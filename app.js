
// Точка входа: сессия, навигация, вкладки, WebSocket.
const Theme = {
  get() { return localStorage.getItem("theme") || "auto"; },
  set(t) {
    localStorage.setItem("theme", t);
    t === "auto" ? delete document.documentElement.dataset.theme : (document.documentElement.dataset.theme = t);
    Theme.tg();
  },
  tg() {
    try {
      const c = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
      TGW.setHeaderColor(c); TGW.setBackgroundColor(c);
    } catch (e) {}
  },
};

// Стек страниц поверх вкладок. Назад = кнопка Telegram / кнопка браузера / стрелка.
const Nav = {
  stack: [],
  open(id, onClose) {
    $(id).classList.add("open"); $(id).setAttribute("aria-hidden", "false");
    Nav.stack.push({ id, onClose }); history.pushState({ n: Nav.stack.length }, ""); Nav.sync();
  },
  pop() {
    const t = Nav.stack.pop(); if (!t) return;
    $(t.id).classList.remove("open"); $(t.id).setAttribute("aria-hidden", "true");
    if (t.onClose) t.onClose(); Nav.sync();
  },
  back() { if (Nav.stack.length) history.back(); },
  sync() { try { Nav.stack.length ? TGW.BackButton.show() : TGW.BackButton.hide(); } catch (e) {} },
};
addEventListener("popstate", () => Nav.pop());

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
    document.addEventListener("contextmenu", (e) => { if (!/INPUT|TEXTAREA/.test(e.target.tagName)) e.preventDefault(); });
    document.addEventListener("click", (e) => {
      const a = e.target.closest("a"); if (!a) return;
      e.preventDefault(); try { TGW.openLink(a.href); } catch (_) { window.open(a.href, "_blank", "noopener"); }
    });
    Chats.bind(); Chat.bind(); Contacts.bind();

    if (Store.token) {
      try { const d = await api("/api/me"); return App.enter(d.user); } catch (e) {}
    }
    Auth.init((u) => App.enter(u));
  },

  enter(user) {
    App.user = user;
    $("auth").classList.add("hidden"); $("app").classList.remove("hidden");
    Profile.render(); Settings.render(); Chats.load();
    App.connect(); App.go("chats");
    setInterval(() => Chat.updateHeader(), 30000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { App.connect(); Chats.load(); Chat.sync(); } });
    addEventListener("online", () => App.connect());
  },

  go(tab) {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "v-" + tab));
    if (tab === "chats") Chats.load();
  },

  setOnline(v) { $("app").classList.toggle("offline", !v); },

  connect() {
    if (!Store.token || (App.ws && App.ws.readyState <= 1)) return;
    clearTimeout(App.retryT);
    const ws = new WebSocket(CONFIG.WS + "?token=" + encodeURIComponent(Store.token) + (INIT ? "&init=" + encodeURIComponent(INIT) : ""));
    App.ws = ws;
    ws.onopen = () => {
      App.retry = 0; App.setOnline(true); Chats.load(); Chat.sync();
      clearInterval(App.pingT); App.pingT = setInterval(() => ws.readyState === 1 && ws.send("ping"), 25000);
    };
    ws.onmessage = (ev) => {
      let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
      if (d.type === "message") { Chat.onMessage(d.message); Chats.onMessage(d.message); }
      else if (d.type === "read") Chat.onRead(d.by);
      else if (d.type === "presence") App.presence(d);
      else if (d.type === "profile") App.profile(d.user);
    };
    ws.onclose = () => {
      clearInterval(App.pingT); App.setOnline(false);
      if (Store.token) App.retryT = setTimeout(() => App.connect(), Math.min(1000 * 2 ** App.retry++, 15000));
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
    App.patchUser(u.id, { name: u.name, username: u.username, bio: u.bio, avatar: u.avatar });
    Chats.render(); if (u.id === App.user.id) Profile.render();
  },
};
App.start();
