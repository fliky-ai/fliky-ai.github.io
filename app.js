// Точка входа: проверка сессии, переключение вкладок, WebSocket.
const App = {
  user: null, ws: null, pingT: null,

  async start() {
    const tgw = window.Telegram && Telegram.WebApp;
    if (tgw) { try { tgw.ready(); tgw.expand(); tgw.setHeaderColor("#0E1218"); tgw.setBackgroundColor("#0E1218"); } catch (e) {} }
    document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => App.go(b.dataset.tab)));
    Chats.bind(); Chat.bind(); Contacts.bind();
    if (Store.token) {
      try { const d = await api("/api/me"); return App.enter(d.user); } catch (e) {}
    }
    Auth.init((u) => App.enter(u));
  },

  enter(user) {
    App.user = user;
    $("auth").classList.add("hidden");
    $("app").classList.remove("hidden");
    Settings.render();
    Chats.load();
    App.connect();
    App.go("chats");
  },

  go(tab) {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "v-" + tab));
    if (tab === "chats") Chats.load();
    if (tab === "settings") Settings.render();
  },

  connect() {
    if (!Store.token) return;
    try { App.ws && App.ws.close(); } catch (e) {}
    const ws = new WebSocket(CONFIG.WS + "?token=" + Store.token);
    App.ws = ws;
    ws.onmessage = async (ev) => {
      let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
      if (d.type === "message") { await Chat.onMessage(d.message); Chats.load(); }
    };
    ws.onopen = () => { clearInterval(App.pingT); App.pingT = setInterval(() => ws.readyState === 1 && ws.send("ping"), 25000); };
    ws.onclose = () => { clearInterval(App.pingT); if (Store.token) setTimeout(() => App.connect(), 3000); };
  },
};
App.start();
