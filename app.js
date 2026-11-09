// Точка входа: сессия, навигация, вкладки, WebSocket.
// Стек страниц поверх вкладок. Назад = кнопка Telegram / кнопка браузера / стрелка.
const Nav = {
  stack: [],
  open(id, onClose) {
    $(id).style.zIndex = 21 + Nav.stack.length;        // каждая следующая страница — строго выше предыдущей
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
  // закрыть подряд все верхние страницы, подходящие под условие (например, «Новое сообщение» и «Создать группу»)
  async unwindWhile(pred) {
    for (let i = 0; i < 8; i++) {
      const top = Nav.stack[Nav.stack.length - 1];
      if (!top || !pred(top)) return;
      const n = Nav.stack.length;
      Nav.back();
      for (let t = 0; t < 40 && Nav.stack.length === n; t++) await new Promise((r) => setTimeout(r, 20));
    }
  },
  sync() { try { Nav.stack.length ? TGW.BackButton.show() : TGW.BackButton.hide(); } catch (e) {} },
};
addEventListener("popstate", () => Nav.pop());

// Встроенный браузер: страница открывается поверх приложения. Часть сайтов запрещает показ внутри чужих страниц —
// поэтому сверху всегда есть кнопка «открыть в браузере». Карточку можно свернуть в плавающий пилл (как у звонка)
// и продолжить читать чаты, не закрывая страницу — она остаётся загруженной, пока её не закроют явно.
const Browser = {
  cur: null, pill: null,
  external(url) { try { TGW.openLink(url); } catch (_) { window.open(url, "_blank", "noopener"); } },
  open(url) {
    if (!/^https?:/i.test(url) || !Prefs.get("browser", false)) return Browser.external(url);
    if (Browser.cur) { if (Browser.cur.url === url) return Browser.restore(); return Browser._replace(url); }
    Browser._create(url);
  },
  _create(url) {
    let host = url; try { host = new URL(url).hostname; } catch (e) {}
    const el = document.createElement("div");
    el.className = "ibr";
    el.innerHTML = `<div class="ibr-top"><button class="ibr-min" aria-label="${esc(T("Свернуть"))}">${CUI.down}</button>
      <div class="ibr-t"><b>${esc(host)}</b><small>${esc(T("Если страница не открылась, нажмите справа"))}</small></div>
      <button class="ibr-o" aria-label="${esc(T("Открыть в браузере"))}">${SI.compass}</button>
      <button class="ibr-x" aria-label="${esc(T("Закрыть"))}">${SI.x}</button></div>
      <iframe class="ibr-f" src="${esc(url)}" referrerpolicy="no-referrer" sandbox="allow-scripts allow-forms allow-same-origin allow-popups"></iframe>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    // закрытие истории (жест «назад» или наш же pop() из minimize/_dismiss) асинхронно для верхнего слоя —
    // onClose привязан к ЭТОЙ конкретной карточке (b), а не к Browser.cur, чтобы не снести следующую,
    // если к моменту срабатывания пользователь уже открыл другую ссылку
    const b = { el, url, host, min: false };
    b.pop = Nav.layer(() => { if (!b.min) Browser._wipe(b); });
    Browser.cur = b;
    el.querySelector(".ibr-x").onclick = () => Browser._dismiss();
    el.querySelector(".ibr-o").onclick = () => Browser.external(url);
    el.querySelector(".ibr-min").onclick = () => Browser.minimize();
  },
  // открыли другую ссылку, пока текущая (не свёрнутая) ещё видна: закрываем старую и создаём новую одним
  // прыжком истории — не back()+pushState() по отдельности (между ними возможна гонка, см. _wipe)
  _replace(url) {
    const old = Browser.cur;
    if (old.min) { Browser._wipe(old); return Browser._create(url); }
    Browser._wipe(old);
    if (Nav.stack.length && Nav.stack[Nav.stack.length - 1] && !Nav.stack[Nav.stack.length - 1].id) Nav.stack.pop();
    Browser._create(url);
  },
  _wipe(b) {
    if (Browser.cur === b) { Browser.cur = null; Browser.hidePill(); }
    b.el.classList.remove("show");
    setTimeout(() => b.el.remove(), 220);
  },
  _dismiss() { const b = Browser.cur; if (!b) return; if (b.min) Browser._wipe(b); else b.pop(); },
  minimize() {
    const b = Browser.cur; if (!b) return;
    b.min = true;
    b.el.classList.remove("show");
    Browser.showPill();
    b.pop();                               // снимаем экран из истории; карточка остаётся плавающим пиллом
  },
  restore() {
    const b = Browser.cur; if (!b) return;
    b.min = false;
    b.pop = Nav.layer(() => { if (!b.min) Browser._wipe(b); });
    requestAnimationFrame(() => b.el.classList.add("show"));
    Browser.hidePill();
  },
  destroy() { const b = Browser.cur; if (b) Browser._wipe(b); },
  showPill() {
    if (!Browser.pill) {
      Browser.pill = document.createElement("button");
      Browser.pill.className = "ibrpill";
      Browser.pill.addEventListener("click", (e) => {
        if (e.target.closest("[data-x]")) { e.stopPropagation(); Browser.destroy(); } else Browser.restore();
      });
      document.body.appendChild(Browser.pill);
    }
    const b = Browser.cur;
    Browser.pill.innerHTML = `<i class="ibp-dot"></i><span class="ibp-t">${esc(b.host)}</span><span class="ibp-x" data-x aria-label="${esc(T("Закрыть"))}">${SI.x}</span>`;
    Browser.pill.classList.remove("hidden");
  },
  hidePill() { if (Browser.pill) Browser.pill.classList.add("hidden"); },
};

// сбой одного шага не должен ронять остальные; ошибка попадает в «страховку запуска» (см. index.html)
function guardLog(name, e) {
  try { if (window.__boot) window.__boot.errs.push(name + ": " + ((e && e.message) || e)); } catch (_) {}
  try { console.error(name, e); } catch (_) {}
}
function guard(name, fn) { try { return fn(); } catch (e) { guardLog(name, e); } }

// браузер предлагает установить сайт как приложение — запоминаем, чтобы показать свою кнопку в настройках
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); try { App.installEv = e; } catch (_) {} });
addEventListener("appinstalled", () => { try { App.installEv = null; } catch (_) {} });

// Высота экрана с учётом клавиатуры. В браузере и в Telegram окно само сжимается (visualViewport),
// а в APK (AppMint WebView, edge-to-edge на новых Android) окно часто НЕ сжимается: клавиатура просто
// перекрывает низ, и поле ввода с сообщениями прячется под ней до её закрытия. Поэтому в приложении
// узнаём высоту клавиатуры сами (VirtualKeyboard API, события Capacitor Keyboard) и вычитаем её,
// только если система не сделала этого сама — иначе высота уменьшилась бы дважды.
const Kbd = {
  h: 0, full: 0,
  isApp: !!(window.WebToApk || window.appmintNative || window.AppMint),
  init() {
    Kbd.full = innerHeight;
    const vv = window.visualViewport;
    if (vv) { vv.addEventListener("resize", Kbd.apply); vv.addEventListener("scroll", Kbd.apply); }
    addEventListener("resize", Kbd.apply);
    if (Kbd.isApp && navigator.virtualKeyboard) {
      try {
        navigator.virtualKeyboard.overlaysContent = true;
        navigator.virtualKeyboard.addEventListener("geometrychange", (e) => Kbd.set(e.target.boundingRect.height));
      } catch (e) {}
    }
    const fromEv = (e) => {
      Kbd.evSeen = true;
      const d = (e && e.detail) || {};
      Kbd.set(Kbd.norm(e && (e.keyboardHeight != null ? e.keyboardHeight : d.keyboardHeight != null ? d.keyboardHeight : d.height)));
    };
    ["keyboardWillShow", "keyboardDidShow", "appmint:keyboard"].forEach((n) => addEventListener(n, fromEv));
    ["keyboardWillHide", "keyboardDidHide"].forEach((n) => addEventListener(n, () => Kbd.set(0)));
    try {
      const K = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Keyboard;
      if (K && K.addListener) {
        K.addListener("keyboardWillShow", (i) => { Kbd.evSeen = true; Kbd.set(Kbd.norm(i && i.keyboardHeight)); });
        K.addListener("keyboardWillHide", () => Kbd.set(0));
      }
    } catch (e) {}
    // поле потеряло фокус — клавиатура закрыта, даже если событие скрытия не пришло
    document.addEventListener("focusout", () => setTimeout(() => { if (!Kbd.typing()) Kbd.set(0); }, 150));
    // запасной вариант для APK без событий клавиатуры: окно не сжалось и высоту никто не сообщил —
    // считаем клавиатуру типичной высоты (~40% экрана), чтобы поле ввода точно было видно
    if (Kbd.isApp && !navigator.virtualKeyboard) {
      document.addEventListener("focusin", () => setTimeout(() => {
        const vv = window.visualViewport, cur = vv ? vv.height : innerHeight;
        if (Kbd.typing() && !Kbd.evSeen && Kbd.h === 0 && Kbd.full - cur < 100) Kbd.set(Math.round(Kbd.full * 0.4));
      }, 450));
    }
    Kbd.apply();
  },
  evSeen: false,
  typing() {
    const a = document.activeElement;
    return !!(a && (/INPUT|TEXTAREA/.test(a.tagName) || a.isContentEditable));
  },
  // на некоторых сборках высоту отдают в физических пикселях — переводим в CSS-пиксели
  norm(v) {
    v = +v || 0;
    if (v > innerHeight * 0.85 && devicePixelRatio > 1) v /= devicePixelRatio;
    return Math.max(0, Math.round(v));
  },
  set(h) {
    h = Math.max(0, Math.round(+h || 0));
    if (h === Kbd.h) return;
    Kbd.h = h;
    Kbd.apply();
  },
  apply() {
    const vv = window.visualViewport;
    const cur = vv ? vv.height : innerHeight;
    if (!Kbd.typing() || cur > Kbd.full) Kbd.full = Math.max(innerHeight, cur);
    const shrunk = Math.max(0, Kbd.full - cur);                          // насколько система уже сжала экран
    const extra = Kbd.h > 0 && shrunk < Kbd.h * 0.5 ? Kbd.h : 0;         // перекрыто, но не сжато — вычитаем сами
    const h = Math.max(220, Math.round(cur - extra));
    const st = document.documentElement.style;
    st.setProperty("--vh", h + "px");
    const kb = extra || (shrunk > 120 ? shrunk : 0);
    st.setProperty("--kb", kb + "px");
    document.body && document.body.classList.toggle("kb-open", kb > 0);
    if (kb > 150) { try { Chat.kb = kb; } catch (e) {} }
    if (extra && window.scrollY) window.scrollTo(0, 0);   // WebView иногда сдвигает страницу вверх — возвращаем
    try { if (typeof Chat !== "undefined" && Chat.onViewport) Chat.onViewport(); } catch (e) {}
  },
};

const App = {
  user: null, ws: null, pingT: null, retry: 0, retryT: null,

  async start() {
    // каждый шаг запуска — отдельно: сбой в одном (например, не загрузился какой-то файл) не должен вешать приложение на заставке
    guard("tg", () => {
      if (TGW) {
        try { TGW.ready(); TGW.expand(); TGW.disableVerticalSwipes(); TGW.BackButton.onClick(() => Nav.back()); } catch (e) {}
        Theme.tg();
      }
    });
    guard("ui", () => {
      Kbd.init();
      document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => { haptic(); App.go(b.dataset.tab); }));
      ["chat-back", "up-back", "ed-back"].forEach((id) => { const b = $(id); if (b) b.onclick = () => Nav.back(); });
      // никаких системных меню
      document.addEventListener("contextmenu", (e) => { if (!/INPUT|TEXTAREA/.test(e.target.tagName) || e.target.closest("#panel")) e.preventDefault(); });
      document.addEventListener("click", (e) => {
        const mn = e.target.closest(".mention");
        if (mn) { e.preventDefault(); haptic(); return Links.mention(mn.dataset.mention); }
        const a = e.target.closest("a"); if (!a || a.dataset.dl) return;
        e.preventDefault(); Links.open(a.href);
      });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") Nav.back(); });
    });
    guard("chats", () => Chats.bind());
    guard("chat", () => Chat.bind());
    guard("contacts", () => Contacts.bind());
    guard("uprofile", () => UserProfile.bind());
    guard("groups", () => Groups.init());
    guard("calls", () => Calls.init());
    guard("lock", () => Lock.init());
    guard("notif", () => Notif.register());
    guard("pushcall", () => App.bindPushCall());
    guard("sharein", () => ShareIn.init());
    guard("downloads", () => DL.init());                                 // кнопка «Загрузки» вверху списка чатов
    guard("music", () => Music.init());
    guard("media", () => Media.trim());
    guard("anim", () => Settings.applyAnim());
    guard("energy", () => Energy.update());
    guard("theme", () => Theme.apply(false));
    guard("health", () => App.health());
    App.boot();
  },

  // Запуск сессии. Нет связи или сервер недоступен — НЕ выбрасываем на экран входа
  // (это создавало бы лишние сессии), а ждём и пробуем снова. На вход отправляет только 401.
  async boot() {
    if (!Store.token) return App.showAuth();
    let d;
    // Нет интернета или сервер выключен, но мы уже входили: открываем приложение из сохранённого
    // на устройстве (как Telegram) и подключаемся в фоне. Без сохранённого — ждём связь, как раньше.
    const cachedMe = App.user ? null : await tmoC(OC.get("me"), 1200, null);
    try { d = await api("/api/me", { timeout: cachedMe ? 6000 : 15000 }); }
    catch (e) {
      if (!Store.token) return App.showAuth();   // 401: api() уже сбросил токен и перезагружает страницу
      if (/заблокирован/i.test((e && e.message) || "")) return App.banned();
      if (cachedMe && !App.user) {
        try { App.enter(cachedMe, true); } catch (er) { guardLog("enter", er); }
        return setTimeout(() => App.boot(), 4000);
      }
      if (App.user) return setTimeout(() => App.boot(), 5000);   // уже работаем из кэша — тихо пробуем дальше
      const m = (e && e.message) || "Нет связи с сервером";
      if (window.__boot) window.__boot.net = m;
      toast(m);
      return setTimeout(() => App.boot(), 3000);
    }
    if (window.__boot) window.__boot.net = "";
    OC.saveMe(d.user);
    if (App.user) {                                // приложение уже открыто из кэша — просто обновляем данные
      Object.assign(App.user, d.user);
      guard("profile", () => Profile.render()); guard("tabav", () => App.tabAvatar());
      guard("ws", () => App.connect()); Chats.load();
      return;
    }
    try { App.enter(d.user); }
    catch (e) {                                   // ошибка внутри приложения — это не «нет связи», повторять запуск бессмысленно
      guardLog("enter", e);
      const b = $("boot"); if (b) b.classList.add("hidden");
    }
  },

  showAuth() {
    const b = $("boot"); if (b) b.classList.add("hidden");
    const go = () => Auth.init((u) => App.enter(u));
    // вводный экран — один раз и только когда нет сохранённых аккаунтов
    let first = false;
    try { first = typeof Intro !== "undefined" && !Intro.seen() && !Accounts.list().length; } catch (e) {}
    if (first) { go(); Intro.show(() => {}); } else go();
  },

  enter(user, fromCache) {
    App.user = user;
    const b = $("boot"); if (b) b.classList.add("hidden");
    $("auth").classList.add("hidden"); $("app").classList.remove("hidden");
    if (fromCache) { App.setOnline(false); guard("cache", () => Chats.fromCache()); }
    guard("profile", () => Profile.render());               // внутри обновляет и вкладку «Настройки»
    guard("tabav", () => App.tabAvatar());
    guard("lists", () => { Chats.load(); Stories.load(true); Profile.loadStories(); });
    guard("outbox", () => Outbox.restore());
    guard("ws", () => App.connect());
    guard("go", () => App.go("chats"));
    guard("hash", () => { App.openHash(); Chat.loadQuick(); });
    // разрешение на уведомления могли дать раньше — подписку на Web Push (звонки в фоне) проверяем/обновляем каждый запуск
    guard("push", () => { if (Notif.perm() === "granted") Notif.subscribePush(); });
    guard("apppush", () => { AppPush.init(); Notif.syncCloud(); });     // APK: уведомления через Firebase (AppMint Push)
    guard("sharein", () => ShareIn.ready());                            // прислали что-то из другого приложения — «Отправить в…»
    guard("deeplink", () => { if (!App.dlBound) { App.dlBound = true; DeepLink.init(); } else if (DeepLink.wait) DeepLink.openChat(DeepLink.wait); });
    setInterval(() => { try { Chat.updateHeader(); } catch (e) {} }, 30000);
    document.addEventListener("visibilitychange", () => {
      App.sendVis();
      if (document.visibilityState === "visible") { guard("resume", () => { App.connect(); Chats.load(); Chat.sync(); }); }
    });
    addEventListener("online", () => App.connect());
  },

  // ссылки:  …/#c=адрес — чат с владельцем ссылки;  #j=код — приглашение;  #p=адрес — публичная группа/канал;
  // #e=код — набор эмодзи;  #u=имя — профиль  (в Telegram те же коды приходят в start_param: c_…, j_…, p_…, e_…, u_…)
  async openHash() {
    let code = "";
    try { code = (TGW && TGW.initDataUnsafe && TGW.initDataUnsafe.start_param) || ""; } catch (e) {}
    const h = /[#&]([cjpeuk])=([A-Za-z0-9_-]{1,60})/.exec(location.hash || "");
    let kind = "", val = "";
    if (h) { kind = h[1]; val = h[2]; }
    else { const m = /^([cjpeuk])_([A-Za-z0-9_-]{1,60})$/.exec(code); if (m) { kind = m[1]; val = m[2]; } }
    if (!kind) return;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    return Links.go(kind, val);
  },

  // Звонок принят/отклонён из системного push-уведомления (вкладка была свёрнута или полностью закрыта).
  // Если страница уже была открыта — sw.js шлёт сообщение; если её пришлось открывать заново — данные в адресе.
  bindPushCall() {
    try {
      if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", (e) => {
        const m = e.data;
        if (m && m.type === "open-link" && m.link) return guard("deeplink", () => DeepLink.go(m.link));
        if (!m || m.type !== "push-call" || !m.data || !m.data.call) return;
        App.pendingCall = { action: m.action, data: m.data };
        if (Calls.online()) App.resolvePendingCall();
      });
    } catch (e) {}
    try {
      const u = new URL(location.href);
      const ans = u.searchParams.get("call_answer"), dec = u.searchParams.get("call_decline");
      if (ans || dec) {
        let data = null; try { data = JSON.parse(ans || dec); } catch (e) {}
        u.searchParams.delete("call_answer"); u.searchParams.delete("call_decline");
        try { history.replaceState(null, "", u.pathname + u.search + u.hash); } catch (e) {}
        if (data && data.call) App.pendingCall = { action: ans ? "answer" : "decline", data };
      }
    } catch (e) {}
  },
  resolvePendingCall() {
    const p = App.pendingCall; App.pendingCall = null;
    if (!p || !Calls.online()) return;
    guard("calls", () => Calls.fromPush(p.action, p.data));
  },

  // маленькая аватарка на четвёртой вкладке
  tabAvatar() {
    const b = $("tab-av"); if (!b || !App.user) return;
    b.innerHTML = avatar(App.user);
  },

  go(tab) {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "v-" + tab));
    if (tab === "chats") Chats.load();
    if (tab === "contacts") Contacts.load();
    if (tab === "profile") { Profile.loadStories(); Stories.load(); }
    if (tab === "settings") { Settings.fetchUnread(); }
  },

  // серверу важно знать, смотрит ли человек в приложение: свёрнутое приложение держит соединение,
  // но уведомление о сообщении/звонке ему всё равно нужно
  sendVis() { try { if (App.ws && App.ws.readyState === 1) App.ws.send(JSON.stringify({ type: "vis", on: document.visibilityState === "visible" })); } catch (e) {} },
  setOnline(v) { $("app").classList.toggle("offline", !v); if (!v) guard("net", () => Net2.paint()); },
  // аккаунт заблокирован администрацией: сеансы уже завершены сервером
  banned(deleted) {
    if (App.bannedShown) return;
    App.bannedShown = true;
    try { OC.wipe(); } catch (e) {}
    try { AppPush.logout(); } catch (e) {}
    try { if (App.ws) App.ws.onclose = null; } catch (e) {}
    Accounts.remove(Store.token); Store.token = "";
    const b = $("boot"); if (b) b.classList.add("hidden");
    App.banSheet(deleted).then(() => location.reload());
  },
  // «Ваш аккаунт был заблокирован»: ОК и «Помощь (скоро)»
  async banSheet(deleted) {
    for (;;) {
      const v = await UI.sheet({ title: T(deleted ? "Аккаунт удалён" : "Аккаунт заблокирован"),
        text: T(deleted ? "Ваш аккаунт Dicegram был удалён администрацией." : "Ваш аккаунт был заблокирован администрацией Dicegram за нарушение правил."),
        actions: [{ label: T("Помощь (скоро)"), value: "help" }], cancel: T("ОК") });
      if (v !== "help") return;
      toast(T("Раздел помощи скоро появится"));
    }
  },

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
      guard("rx", () => Net.add("rx", "msg", (ev.data || "").length));
      if (d.type === "ready") {   // сервер принял токен
        App.retry = 0; App.setOnline(true); Chats.load(); Chat.sync(); App.sendVis();
        guard("outbox", () => Outbox.flush());       // сообщения, написанные без сети, уходят сами
        clearInterval(App.pingT); App.pingT = setInterval(() => ws.readyState === 1 && ws.send("ping"), 25000);
        if (App.pendingCall) guard("pushcall", () => App.resolvePendingCall());
      }
      else if (d.type === "message") { Chat.onMessage(d.message); Chats.onMessage(d.message); guard("notify", () => Notif.onMessage(d.message)); }
      else if (d.type === "read") Chat.onRead(d.by);
      else if (d.type === "edit") { Chat.onEdit(d.message); Chats.onEdit(d.message); }
      else if (d.type === "del") { Chat.onDel(d.ids); Chats.load(); }
      else if (d.type === "react") { Chat.onReact(d); guard("notify", () => Notif.onReact(d)); }
      else if (d.type === "pin") Chat.onPin(d);
      else if (d.type === "cc") Chat.onCC(d);
      else if (d.type === "presence") App.presence(d);
      else if (d.type === "typing") guard("typing", () => Typing.on(d));
      else if (d.type === "chat") guard("groups", () => Groups.onChat(d));
      else if (d.type === "chat_gone") guard("groups", () => Groups.onGone(d.id));
      else if (d.type === "vc") guard("calls", () => Calls.onVC(d));
      else if (d.type === "rtc") guard("calls", () => Calls.onRTC(d));
      else if (d.type === "profile") App.profile(d.user);
      else if (d.type === "banned") return App.banned(d.deleted);
      else if (d.type === "block") guard("block", () => App.onBlock(d));
      else if (d.type === "story") { guard("notify", () => Notif.onStory(d.user)); Stories.load(true); if (d.user === App.user.id) Profile.loadStories(); if (UserProfile.cur && UserProfile.cur.id === d.user) UserProfile.loadStories(d.user); }
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
  // нас заблокировали / разблокировали (by) или мы сами с другого устройства (peer)
  onBlock(d) {
    const id = d.peer || d.by;
    if (d.peer) App.patchUser(id, { blocked: !!d.on }); else App.patchUser(id, { blocked_me: !!d.on });
    if (Chat.peer && Chat.peer.id === id) Chat.applyAccess();
    try { UserProfile.onBlock(d); } catch (e) {}
  },
  profile(u) {
    App.patchUser(u.id, { name: u.name, surname: u.surname, username: u.username, bio: u.bio, bio_ents: u.bio_ents || null, avatar: u.avatar, premium: u.premium ? 1 : 0, estatus: u.estatus || null, nft: u.nft || null, verified: u.verified ? 1 : 0, vtier: u.vtier || "", pbg: u.pbg || "", deleted: u.deleted ? 1 : 0 });
    Chats.render(); if (u.id === App.user.id) { Profile.render(); guard("tabav", () => App.tabAvatar()); }
    // открыт профиль этого человека — обновляем и его (значок, статус)
    guard("uprofile", () => { if (UserProfile.cur && UserProfile.cur.id === u.id) { UserProfile.cur = Object.assign({}, UserProfile.cur, u); UserProfile.render(UserProfile.cur); } });
  },

  // Проверка, что на сайте лежат все файлы нужной версии: если нет, показываем, каких именно (а не молча «не работает»).
  health() {
    const has = (f) => { try { return !!f(); } catch (e) { return false; } };
    const chk = {
      "set_misc.js": () => Notif && Folders && Media && AppPush && DeepLink && typeof Settings.notif === "function" && typeof Settings.data === "function" && typeof Settings.folders === "function",
      "offline.js": () => OC && Net2 && typeof OC.get === "function" && typeof tmoC === "function",
      "set_prem.js": () => typeof Settings.premium === "function" && typeof Settings.stars === "function",
      "set_safe.js": () => typeof Settings.privacy === "function" && Lock,
      "set_look.js": () => typeof Settings.chats === "function" && typeof Settings.energy === "function",
      "premium.js": () => PB && ES && StatusPicker && EmojiSets && PremiumPromo,
      "pg.js": () => Pg && SI && R,
      "fx.js": () => Fx && typeof Fx.play === "function",
      "intro.js": () => Intro && typeof Intro.show === "function",
      "gifts.js": () => Gifts && GiftArt && typeof Gifts.shop === "function",
      "cemoji.js": () => CE && React && EmojiPack,
      "emojipick.js": () => EmojiSearch && RClip && EmojiPick && BioEd && typeof Rich.splice === "function",
      "links.js": () => Links && typeof Links.go === "function",
      "fileview.js": () => FV && typeof FV.open === "function",
      "music.js": () => Music && typeof Music.play === "function" && typeof Music.mountView === "function",
      "downloads.js": () => DL && typeof DL.get === "function" && typeof DL.openPage === "function",
      "gallery.js": () => Gallery && typeof Gallery.open === "function" && typeof Gallery.send === "function",
      "qr.js": () => QR && QRCard && typeof QR.matrix === "function" && typeof QRCard.open === "function",
      "admin.js": () => HCReport && typeof HCReport.open === "function",
      "sharein.js": () => ShareIn && typeof ShareIn.init === "function",
      "games.js": () => Games && GameSession && GameClicker && typeof Games.open === "function" && typeof GameClicker.open === "function",
      "game2048.js": () => G2048 && Game2048 && typeof Game2048.open === "function",
      "gameblocks.js": () => GBlocks && GameBlocks && typeof GameBlocks.open === "function",
      "gamesand.js": () => GSand && GameSand && typeof GameSand.open === "function",
      "userprofile.js": () => UserProfile && typeof UserProfile.open === "function",
      "gifmaker.js": () => GifMaker && GifEnc,
      "chats.js": () => Chats && ChatPeek && ILL && CI,
      "search.js": () => Search && typeof Search.open === "function",
      "contacts.js": () => Contacts && NewMsg && CreateChat && ContactList && AddContact,
      "groups.js": () => Groups && Svc && Topics && Picker,
      "grp_edit.js": () => GroupEdit && typeof GroupEdit.profile === "function",
      "voicefx.js": () => VoiceFX && typeof VoiceFX.process === "function",
      "call.js": () => Calls && typeof Calls.start === "function",
      "settings.js": () => Settings && Accounts,
      "index.html": () => $("ftabs") && $("chat-fab") && $("tab-av") && $("profile-box") && $("settings-box") && $("up-body") && $("chat-list") && /20261109a/.test([...document.scripts].map((x) => x.src).join(" ")),
    };
    const bad = Object.keys(chk).filter((k) => !has(chk[k]));
    const miss = (window.__boot && window.__boot.miss || []).filter((x, i, a) => a.indexOf(x) === i && /\.(js|css)$/.test(x));
    miss.forEach((x) => { if (!bad.includes(x)) bad.push(x); });
    App.broken = bad;
    if (!bad.length) return;
    try { console.warn("не загружены:", bad.join(", ")); } catch (e) {}
    const el = document.createElement("div");
    el.className = "health";
    el.innerHTML = `<b>${esc(T("Часть файлов не обновлена"))}</b><span>${esc(bad.join(", "))}</span><small>${esc(T("Загрузите их на GitHub рядом с index.html и обновите страницу."))}</small><button>${esc(T("Скрыть"))}</button>`;
    el.querySelector("button").onclick = () => el.remove();
    document.body.appendChild(el);
  },
  // открыть раздел настроек так, чтобы ошибка не терялась: вместо «ничего не происходит» — понятное сообщение
  safe(name, fn) {
    const fail = (e) => {
      guardLog(name, e);
      const miss = App.broken && App.broken.length ? ` (${App.broken.join(", ")})` : "";
      toast(T("Не удалось открыть") + miss + ": " + ((e && e.message) || e));
    };
    try { const r = fn(); if (r && typeof r.catch === "function") r.catch(fail); return r; } catch (e) { fail(e); }
  },
};
App.start();
