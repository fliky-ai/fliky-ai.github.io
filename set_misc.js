// set_misc.js — «Уведомления», «Данные и память», «Папки с чатами».

// ждём не дольше ms: в некоторых WebView (в том числе внутри Telegram) запросы к хранилищу браузера могут не отвечать совсем
const tmo = (p, ms, fb) => Promise.race([Promise.resolve(p).catch(() => fb), new Promise((r) => setTimeout(() => r(fb), ms))]);
const inTG = () => !!(typeof TGW !== "undefined" && TGW && TGW.initData);

// ═════════════ УВЕДОМЛЕНИЯ ═════════════
const Notif = {
  ctx: null, reg: null,
  get(k, d = true) { return Prefs.get("n_" + k, d); },
  perm() { return "Notification" in window ? Notification.permission : "unsupported"; },
  async register() {
    try { if ("serviceWorker" in navigator) Notif.reg = await navigator.serviceWorker.register("sw.js"); } catch (e) {}
  },
  // Web Push: чтобы звонки звонили системным уведомлением, даже когда вкладка/приложение свёрнуты или закрыты.
  // Нужно разрешение на уведомления (Notif.perm() === "granted") и регистрация sw.js (Notif.reg).
  b64ToKey(b64) {
    const s = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(s), out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  },
  async sendSub(sub) {
    try { const j = sub.toJSON(); await api("/api/push/subscribe", { method: "POST", body: { endpoint: j.endpoint, keys: j.keys } }); }
    catch (e) {}
  },
  async subscribePush() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || Notif.perm() !== "granted") return;
      const reg = Notif.reg || (await navigator.serviceWorker.getRegistration());
      if (!reg || !reg.pushManager) return;
      const { key } = await api("/api/push/vapid_key");
      if (!key) return;
      const appKey = Notif.b64ToKey(key);
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        const cur = existing.options && existing.options.applicationServerKey ? new Uint8Array(existing.options.applicationServerKey) : null;
        const same = cur && cur.length === appKey.length && cur.every((b, i) => b === appKey[i]);
        if (same) return Notif.sendSub(existing);
        await existing.unsubscribe().catch(() => {});
      }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
      await Notif.sendSub(sub);
    } catch (e) {}
  },
  sound() {
    if (!Notif.get("snd")) return;
    try {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      Notif.ctx = Notif.ctx || new C();
      const c = Notif.ctx, t = c.currentTime;
      [[880, 0], [1175, 0.11]].forEach(([f, d]) => {
        const o = c.createOscillator(), g = c.createGain();
        o.type = "sine"; o.frequency.value = f; o.connect(g); g.connect(c.destination);
        g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.22);
        o.start(t + d); o.stop(t + d + 0.25);
      });
    } catch (e) {}
  },
  vibrate() {
    if (!Notif.get("vib")) return;
    try { if (inTG()) TGW.HapticFeedback.notificationOccurred("success"); else if (navigator.vibrate) navigator.vibrate(40); } catch (e) {}
  },
  async show(title, body, tag) {
    if (Notif.perm() !== "granted") return;
    try {
      const reg = Notif.reg || (navigator.serviceWorker && (await navigator.serviceWorker.getRegistration()));
      const opt = { body, tag, renotify: true, silent: !Notif.get("snd") };
      if (reg && reg.showNotification) reg.showNotification(title, opt); else new Notification(title, opt);
    } catch (e) {}
  },
  who(id) { const c = Chats.list.find((x) => x.peer.id === id); return c ? dispName(c.peer) : T("Новое сообщение"); },
  onMessage(m) {
    if (!App.user || m.sender === App.user.id) return;
    if (m.kind === "svc" || m.kind === "greet") return;
    const pid = Chats.peerOf(m);
    if (Chats.isMuted(pid)) return;                           // для этого чата звук выключен
    const viewing = Chat.peer && Chat.peer.id === pid && document.visibilityState === "visible";
    if (viewing || !Notif.get("msg")) return;
    Notif.sound(); Notif.vibrate();
    let text = Notif.get("prev") ? (m.kind === "call" ? Svc.callText(m) : Rich.preview(m)).split("\n")[0] : T("Новое сообщение");
    if (pid < 0 && m.from && Notif.get("prev")) text = String(m.from.name || "").split(" ")[0] + ": " + text;
    // внутри приложения никаких всплывающих плашек: только звук/вибрация (если включены); системное уведомление — когда приложение свёрнуто
    if (document.visibilityState !== "visible") Notif.show(Notif.who(pid), text, "m" + pid);
  },
  onReact(d) {
    if (!App.user || !d.by || d.by === App.user.id || !d.emoji || !Notif.get("react") || !Notif.get("msg")) return;
    const m = Chat.msgs && Chat.msgs.find((q) => q.id === d.id);
    if (m && m.sender !== App.user.id) return;            // реакция на чужое сообщение — не про нас
    Notif.sound();
    if (document.visibilityState !== "visible") Notif.show(Notif.who(d.by), T("Поставил(а) реакцию {0} на ваше сообщение", d.emoji), "r" + d.id);
  },
  onStory(uid) {
    if (!App.user || uid === App.user.id || !Notif.get("story") || !Notif.get("msg")) return;
    if (document.visibilityState !== "visible") Notif.show(Notif.who(uid), T("Опубликовал(а) новую публикацию"), "s" + uid);
  },
  badge(n) {
    document.title = n && Notif.get("badge") ? `(${n > 99 ? "99+" : n}) Dicegram` : "Dicegram";
    try { if (navigator.setAppBadge) (n && Notif.get("badge")) ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } catch (e) {}
  },
  // какие уведомления присылать, когда приложение закрыто, — сервер должен знать (это решает он)
  syncCloud() {
    const want = { on: !!Notif.get("msg"), prev: !!Notif.get("prev") };
    const cur = Prefs.cloud("push", null) || {};
    if (cur.on === want.on && cur.prev === want.prev) return;
    Prefs.cloudSet("push", want).catch(() => {});
  },
};

// ═════════════ PUSH В APK (AppMint) ═════════════
// В приложении из AppMint Web Push не работает — уведомления идут через Firebase (FCM): берём токен
// телефона у встроенного плагина Capacitor PushNotifications и отдаём серверу. Нажатие на уведомление
// приходит как ссылка (#m=… — открыть чат, #ca=/#cd=… — ответить/отклонить звонок).
const AppPush = {
  token: "",
  B() { return window.WebToApk || null; },
  P() { try { return (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.PushNotifications) || null; } catch (e) { return null; } },
  isApp() { return !!(AppPush.B() || window.appmintNative || window.AppMint || AppPush.P()); },
  async init() {
    if (!AppPush.isApp() || !App.user) return;
    const B = AppPush.B();
    try { if (B && B.setPushUser) B.setPushUser(String(App.user.id)); } catch (e) {}
    const P = AppPush.P();
    if (!P) return;
    try {
      if (!AppPush.bound) {
        AppPush.bound = true;
        await P.addListener("registration", (t) => AppPush.send(t && (t.value || t.token)));
        await P.addListener("registrationError", () => {});
        // нажали на уведомление, пока приложение было открыто/в фоне
        await P.addListener("pushNotificationActionPerformed", (a) => {
          const d = (a && a.notification && a.notification.data) || {};
          const link = d.amp_link || d.link || "";
          if (link) DeepLink.go(link);
        });
      }
      let st = P.checkPermissions ? await P.checkPermissions() : { receive: "prompt" };
      if (st.receive !== "granted" && P.requestPermissions) st = await P.requestPermissions();
      if (st.receive === "granted") await P.register();
    } catch (e) {}
  },
  async send(tok) {
    if (!tok || !App.user) return;
    AppPush.token = tok;
    let install = "";
    try { const B = AppPush.B(); install = (B && B.getInstallId && B.getInstallId()) || ""; } catch (e) {}
    try { await api("/api/push/fcm", { method: "POST", body: { token: tok, install } }); } catch (e) {}
  },
  async logout() {
    try { const B = AppPush.B(); if (B && B.setPushUser) B.setPushUser(""); } catch (e) {}
    if (AppPush.token) { try { await api("/api/push/fcm/remove", { method: "POST", body: { token: AppPush.token } }); } catch (e) {} }
  },
};

// Ссылки из уведомлений (и из AppMint, и из Web Push): открыть чат или ответить на звонок.
const DeepLink = {
  b64json(s) {
    try { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); s += "=".repeat((4 - (s.length % 4)) % 4); return JSON.parse(decodeURIComponent(escape(atob(s)))); }
    catch (e) { return null; }
  },
  // разбор #m=123 / #m=-45 / #ca=… / #cd=… (из hash или полной ссылки)
  parse(link) {
    const h = String(link || "").replace(/^[^#]*#\/?/, "");
    let m = /(?:^|&)m=(-?\d+)/.exec(h);
    if (m) return { kind: "chat", id: +m[1] };
    m = /(?:^|&)(ca|cd)=([A-Za-z0-9_-]+)/.exec(h);
    if (m) { const d = DeepLink.b64json(m[2]); if (d && d.call) return { kind: "call", action: m[1] === "cd" ? "decline" : "answer", data: d }; }
    return null;
  },
  go(link) {
    const p = DeepLink.parse(link);
    if (!p) {                                            // адрес на нашем домене (dicegram.dpdns.org/имя/123, /+код …)
      const lp = /^https?:/i.test(String(link || "")) && typeof Links !== "undefined" ? Links.parse(link) : null;
      if (lp) { Links.go(lp.k, lp.v); return true; }
      return false;
    }
    try { if (/[#&](m|ca|cd)=/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    if (p.kind === "call") {
      App.pendingCall = { action: p.action, data: p.data };
      if (Calls.online()) App.resolvePendingCall();
      return true;
    }
    DeepLink.openChat(p.id);
    return true;
  },
  async openChat(id) {
    if (!App.user) { DeepLink.wait = id; return; }
    if (Chat.peer && Chat.peer.id === id) return;
    let c = Chats.byId(id);
    if (!c) { await Chats.fromCache(); c = Chats.byId(id); }
    if (!c) { try { await Chats.load(); } catch (e) {} c = Chats.byId(id); }
    if (c) { App.go("chats"); Chats.openChat(c.peer); }
  },
  init() {
    addEventListener("appmint:deep-link", (e) => DeepLink.go(e && e.detail && e.detail.url));
    addEventListener("appmint:push", (e) => { const d = e && e.detail; if (d && d.type === "opened" && d.message && d.message.link) DeepLink.go(d.message.link); });
    addEventListener("hashchange", () => DeepLink.go(location.hash));
    // уведомление, нажатое в шторке, когда приложение было закрыто: ссылка запуска
    let launch = "";
    try { const B = window.WebToApk; launch = (B && B.getLaunchUrl && B.getLaunchUrl()) || ""; } catch (e) {}
    if (!DeepLink.go(launch)) DeepLink.go(location.hash);
  },
};

Object.assign(Settings, {
  notif() {
    const pg = Pg.open({ title: T("Уведомления"), build: (pg) => Settings.drawNotif(pg) });
    const bot = (k) => (on) => { const n = Object.assign({ bot: false, preview: true, silent: false }, Prefs.cloud("notif", {})); n[k] = !!on; Prefs.cloudSet("notif", n).catch(() => Settings.drawNotif(pg)); };
    const loc = (k) => (on) => { Prefs.set("n_" + k, !!on); if (k === "badge") Notif.badge(Chats.list.reduce((s, c) => s + c.unread, 0)); if (k === "msg" || k === "prev") Notif.syncCloud(); };
    pg.on = {
      msg: loc("msg"), prev: loc("prev"), snd: (on) => { Prefs.set("n_snd", !!on); if (on) Notif.sound(); }, vib: (on) => { Prefs.set("n_vib", !!on); if (on) Notif.vibrate(); },
      badge: loc("badge"), story: loc("story"), react: loc("react"),
      botOn: bot("bot"), botPrev: bot("preview"), botSilent: bot("silent"),
      allow: async () => {
        if (inTG()) return toast(T("В мини-приложении системные уведомления недоступны. Установите Dicegram как приложение или включите уведомления через бота ниже."));
        if (Notif.perm() === "unsupported") return toast(T("Этот браузер не поддерживает уведомления"));
        if (Notif.perm() === "denied") return UI.sheet({ title: T("Уведомления заблокированы"), text: T("Разрешите уведомления для этого сайта в настройках браузера или телефона, затем вернитесь сюда."), actions: [], cancel: T("Понятно") });
        if (AppPush.isApp()) { await AppPush.init(); return Settings.drawNotif(pg); }
        try { await Notification.requestPermission(); } catch (e) {}
        await Notif.register(); guard("push", () => Notif.subscribePush()); Settings.drawNotif(pg);
      },
      test: () => {
        Notif.sound(); Notif.vibrate();
        if (Notif.perm() === "granted") Notif.show(T("Проверка уведомлений"), T("Так выглядят уведомления"), "test"); else toast(T("Так выглядят уведомления"));
      },
      botTest: async () => {
        try { await api("/api/notify/test", { method: "POST", body: {} }); toast(T("Отправили. Посмотрите в чате с ботом в Telegram.")); }
        catch (e) { toast(e.message); }
      },
    };
  },
  drawNotif(pg) {
    const g = (k, d = true) => Notif.get(k, d), p = Notif.perm();
    const n = Object.assign({ bot: false, preview: true, silent: false }, Prefs.cloud("notif", {}));
    const st = inTG() && p !== "granted" ? T("Недоступны в мини-приложении") : { granted: T("Разрешены"), denied: T("Заблокированы в браузере"), default: T("Не запрошены"), unsupported: T("Не поддерживаются") }[p];
    pg.set(`
      ${R.lbl(esc(T("Сообщения")))}
      ${R.card(
        R.row({ a: "msg", ic: SI.chat, c: "g", t: esc(T("Уведомления о сообщениях")), sw: 1, on: g("msg") }),
        R.row({ a: "prev", ic: SI.eye, c: "b", t: esc(T("Показывать текст")), s: esc(T("Иначе будет только имя отправителя")), sw: 1, on: g("prev") }),
        R.row({ a: "snd", ic: SI.vol, c: "o", t: esc(T("Звук")), sw: 1, on: g("snd") }),
        R.row({ a: "vib", ic: SI.phone2, c: "v", t: esc(T("Вибрация")), sw: 1, on: g("vib") }),
        R.row({ a: "badge", ic: SI.bell, c: "r", t: esc(T("Счётчик на значке")), s: esc(T("Число непрочитанных в заголовке и на иконке")), sw: 1, on: g("badge") }))}
      ${R.lbl(esc(T("События")))}
      ${R.card(
        R.row({ a: "story", ic: SI.image, c: "p", t: esc(T("Новые публикации")), sw: 1, on: g("story") }),
        R.row({ a: "react", ic: SI.heart, c: "r", t: esc(T("Реакции на сообщения")), sw: 1, on: g("react") }))}
      ${R.lbl(esc(T(inTG() ? "В приложении" : "В браузере")))}
      ${R.card(R.row({ a: "allow", ic: SI.bell, c: "t", t: esc(T("Системные уведомления")), r: esc(st), chev: p !== "granted" }), R.row({ a: "test", ic: SI.zap, c: "y2", t: esc(T("Проверить уведомление")), chev: false }))}
      ${R.hint(esc(T(AppPush.isApp() ? "В приложении Dicegram сообщения и звонки приходят, даже когда оно свёрнуто или закрыто." : "Приходят, даже когда вкладка свёрнута или закрыта (если браузер разрешает). В мини-приложении системные уведомления могут быть недоступны — для этого есть уведомления через бота.")))}
      ${R.lbl(esc(T("Через бота в Telegram")))}
      ${R.card(
        R.row({ a: "botOn", ic: SI.bot, c: "b", t: esc(T("Присылать в Telegram")), s: esc(T("Если вы не в сети, бот напишет вам о новом сообщении")), sw: 1, on: !!n.bot }),
        R.row({ a: "botPrev", ic: SI.eye, c: "g", t: esc(T("Показывать текст")), sw: 1, on: n.preview !== false, dis: !n.bot }),
        R.row({ a: "botSilent", ic: SI.vol, c: "gr", t: esc(T("Без звука")), sw: 1, on: !!n.silent, dis: !n.bot }),
        R.row({ a: "botTest", ic: SI.zap, c: "y2", t: esc(T("Отправить пробное уведомление")), s: esc(T("Придёт сообщением от бота в Telegram")), chev: false }))}
      ${R.hint(esc(T("Бот пишет не чаще раза в минуту на одного собеседника. Чтобы получать сообщения, один раз откройте чат с ботом и нажмите /start.")))}`);
  },

  // ═════════════ ДАННЫЕ И ПАМЯТЬ ═════════════
  data() {
    const pg = Pg.open({ title: T("Данные и память"), data: { loading: true }, build: (pg) => Settings.drawData(pg) });
    pg.on = {
      clear: () => Settings.clearCache(pg), net: () => Settings.net(), auto: () => Settings.autodl(), limit: () => Settings.cacheLimit(pg),
      update: () => Settings.refreshApp(),
    };
    Settings.loadData(pg);
  },
  async loadData(pg) {
    const [est, st] = await Promise.all([
      tmo((async () => (navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null))(), 1500, null),
      tmo(Media.stats(), 3500, { photo: 0, video: 0, file: 0, audio: 0, total: 0 }),
    ]);
    pg.data = { est, st, loading: false };
    if (pg.alive) Settings.drawData(pg);
  },
  drawData(pg) {
    const d = pg.data;
    if (d.loading) { pg.set('<div class="pf-load"><div class="spin"></div></div>'); return; }
    const st = d.st, ls = Media.localBytes();
    const used = d.est && d.est.usage != null ? d.est.usage : st.total + ls, quota = d.est && d.est.quota ? d.est.quota : 0;
    const other = Math.max(0, used - st.total);
    const seg = [["photo", st.photo, "#4F9BFF", "Фото"], ["video", st.video, "#8F6BF5", "Видео"], ["file", st.file, "#F28C2E", "Файлы"], ["audio", st.audio, "#3DB971", "Голосовые и музыка"], ["other", other, "#8794A8", "Другие данные приложения"]];
    const base = Math.max(quota || 0, used, 1);
    const lim = Prefs.get("cache_max", 0);
    pg.set(`
      <div class="card2 usage">
        <div class="usage-t">${quota ? esc(T("Занято {0} из {1}", fmtBytes(used), fmtBytes(quota))) : esc(T("Занято {0}", fmtBytes(used)))}</div>
        <div class="usage-b">${seg.map(([k, n, c]) => (n > 0 ? `<i style="flex:${n};background:${c}"></i>` : "")).join("")}<i style="flex:${Math.max(0, base - used)};background:transparent"></i></div>
        ${quota ? `<div class="usage-s">${esc(T("Это место, которое браузер выделил приложению на этом устройстве. Сообщения и файлы хранятся на сервере и сюда не входят."))}</div>`
                : `<div class="usage-s">${esc(T("Браузер не сообщает общий лимит памяти, поэтому показан только занятый объём."))}</div>`}
        <div class="usage-l">${seg.map(([k, n, c, t]) => `<div><i style="background:${c}"></i><span>${esc(T(t))}</span><b>${fmtBytes(n)}</b></div>`).join("")}</div>
      </div>
      ${R.card(R.row({ a: "clear", ic: SI.trash, c: "g", t: esc(T("Очистить кэш")), s: esc(st.total ? T("Фото, видео и файлы скачаются заново при просмотре") : T("Кэш пуст")), r: st.total ? esc(fmtBytes(st.total)) : "" }))}
      ${R.lbl(esc(T("Использование")))}
      ${R.card(
        R.row({ a: "limit", ic: SI.data, c: "b", t: esc(T("Максимальный размер кэша")), r: esc(lim ? fmtBytes(lim) : T("Без ограничений")) }),
        R.row({ a: "auto", ic: SI.wifi, c: "t", t: esc(T("Автозагрузка медиа")) }),
        R.row({ a: "net", ic: SI.stats, c: "o", t: esc(T("Использование сети")) }))}
      ${R.hint(esc(T("Если кэш больше выбранного размера, самые старые файлы удаляются автоматически.")))}
      ${R.lbl(esc(T("Приложение")))}
      ${R.card(R.row({ a: "update", ic: SI.shuffle, c: "v", t: esc(T("Обновить приложение")), s: esc(T("Очистит сохранённые файлы сайта и перезагрузит приложение")), r: esc(APP_VER), chev: false }))}
      ${R.hint(esc(Media.supported() ? T("Кэш медиа включён.") : T("Этот браузер не позволяет хранить кэш медиа — файлы всё равно загружаются с сервера по мере просмотра.")))}`);
  },

  // сбросить сохранённые копии файлов сайта и загрузить свежие (помогает, когда на GitHub уже новые файлы, а в приложении старые)
  async refreshApp() {
    if (!(await ask(T("Обновить приложение? Вы останетесь в аккаунте."), T("Обновить"), false))) return;
    const p = [];
    try { if (navigator.serviceWorker) p.push(navigator.serviceWorker.getRegistrations().then((l) => Promise.all(l.map((x) => x.unregister())))); } catch (e) {}
    try { if (window.caches) p.push(caches.keys().then((l) => Promise.all(l.filter((k) => k !== Media.CACHE).map((k) => caches.delete(k))))); } catch (e) {}
    const go = () => { location.href = location.pathname + "?r=" + Date.now() + location.hash; };
    tmo(Promise.all(p), 2500, 0).then(go);
  },

  async clearCache(parent) {
    const st = await Media.stats();
    const pg = Pg.open({ title: T("Очистить кэш"), data: { st, sel: { photo: 1, video: 1, file: 1, audio: 1 } }, build: (pg) => Settings.drawClear(pg) });
    pg.on = {
      tick: (el) => { const k = el.dataset.v; pg.data.sel[k] = pg.data.sel[k] ? 0 : 1; Settings.drawClear(pg); },
      go: async () => {
        const sel = Object.keys(pg.data.sel).filter((k) => pg.data.sel[k]);
        const freed = sel.reduce((s, k) => s + pg.data.st[k], 0);
        await Media.clear(sel);
        toast(T("Освобождено {0}", fmtBytes(freed)));
        pg.close(); if (parent && parent.alive) Settings.loadData(parent);
      },
    };
  },
  drawClear(pg) {
    const st = pg.data.st, sel = pg.data.sel;
    const items = [["photo", "Фото", SI.image, "b"], ["video", "Видео", SI.vid, "v"], ["file", "Файлы", SI.doc, "o"], ["audio", "Голосовые и музыка", SI.mic, "g"]];
    const total = items.reduce((s, [k]) => s + (sel[k] ? st[k] : 0), 0);
    pg.set(`${R.hero(SI.trash, "", esc(T("Выберите, что удалить с этого устройства. Всё это можно скачать снова — файлы остаются на сервере.")), "slim")}
      ${R.card(...items.map(([k, t, ic, c]) => `<button class="irow tick${sel[k] ? " on" : ""}" data-a="tick" data-v="${k}"><span class="chk-c">${SI.check}</span>${R.ic(c, ic)}<span class="tx"><b>${esc(T(t))}</b></span><em class="irow-v">${fmtBytes(st[k])}</em></button>`))}
      <div class="pad-btn"><button class="pbtn danger" data-a="go"${total ? "" : " disabled"}>${esc(total ? T("Очистить кэш ({0})", fmtBytes(total)) : T("Очистить кэш"))}</button></div>`);
  },

  async cacheLimit(parent) {
    const cur = Prefs.get("cache_max", 0), MB = 1048576;
    const v = await UI.sheet({ title: T("Максимальный размер кэша"), actions: [[100 * MB], [500 * MB], [1024 * MB], [5120 * MB], [0]].map(([n]) => ({ label: (n ? fmtBytes(n) : T("Без ограничений")) + (cur === n ? "  ✓" : ""), value: n })) });
    if (v === null) return;
    Prefs.set("cache_max", v); await Media.trim(); if (parent && parent.alive) Settings.loadData(parent);
  },

  net() {
    const pg = Pg.open({ title: T("Использование сети"), build: (pg) => {
      const d = Net.load(), f = (n) => fmtBytes(n);
      const row = (ic, c, t, rx, tx) => R.row({ ic, c, t: esc(t), s: esc(`↓ ${f(rx)}   ↑ ${f(tx)}`), r: esc(f(rx + tx)), chev: false });
      pg.set(`${R.hero(SI.stats, "", esc(T("Примерный расчёт трафика этого приложения в браузере. Сообщения в реальном времени считаются не полностью.")), "slim")}
        ${R.card(row(SI.chat, "b", T("Сообщения и данные"), d.rx.msg, d.tx.msg), row(SI.image, "g", T("Медиа и файлы"), d.rx.media, d.tx.media))}
        ${R.card(R.row({ ic: SI.data, c: "o", t: esc(T("Всего")), r: esc(f(d.rx.msg + d.rx.media + d.tx.msg + d.tx.media)), s: esc(T("с {0}", new Date(d.since).toLocaleDateString(I18N.loc, { day: "numeric", month: "long", year: "numeric" }))), chev: false }))}
        ${R.card(R.row({ a: "reset", ic: SI.trash, c: "r", t: esc(T("Сбросить статистику")), danger: 1, chev: false }))}`);
    } });
    pg.on = { reset: async () => { if (await ask(T("Сбросить статистику использования сети?"), T("Сбросить"))) { Net.reset(); pg.refresh(); } } };
  },

  autodl() {
    const pg = Pg.open({ title: T("Автозагрузка медиа"), build: (pg) => {
      pg.set(`${R.hint(esc(T("Что показывать сразу при открытии чата. Остальное загрузится по нажатию. Свои фото и видео всегда показываются сразу.")))}
        ${R.card(
          R.row({ a: "ph", ic: SI.image, c: "b", t: esc(T("Фото")), sw: 1, on: Prefs.get("dl_photo", true) }),
          R.row({ a: "vi", ic: SI.vid, c: "v", t: esc(T("Видео и GIF")), sw: 1, on: Prefs.get("dl_video", true) }))}
        ${R.hint(esc(T("Файлы скачиваются только по нажатию.")))}
        ${R.card(R.row({ a: "rs", ic: SI.shuffle, c: "gr", t: esc(T("Сбросить настройки автозагрузки")), chev: false }))}`);
    } });
    pg.on = {
      ph: (on) => { Prefs.set("dl_photo", !!on); }, vi: (on) => { Prefs.set("dl_video", !!on); },
      rs: () => { ["dl_photo", "dl_video"].forEach((k) => Prefs.del(k)); pg.refresh(); toast(T("Настройки сброшены")); },
    };
  },

  // ═════════════ ПАПКИ С ЧАТАМИ ═════════════
  folders() {
    const pg = Pg.open({ title: T("Папки с чатами"), build: (pg) => Settings.drawFolders(pg), right: `<button class="hbtn" data-a="editmode">${esc(T("Изменить"))}</button>` });
    pg.data = { edit: false };
    pg.on = {
      editmode: (el) => { pg.data.edit = !pg.data.edit; el.textContent = pg.data.edit ? T("Готово") : T("Изменить"); Settings.drawFolders(pg); },
      newf: () => Settings.folderEdit(null, pg),
      open: (el) => Settings.folderEdit(Folders.get().find((f) => f.id === el.dataset.v), pg),
      up: (el) => { Folders.move(el.dataset.v, -1); pg.refresh(); }, down: (el) => { Folders.move(el.dataset.v, 1); pg.refresh(); },
      del: async (el) => { if (await ask(T("Удалить папку? Чаты останутся на месте."), T("Удалить"))) { Folders.remove(el.dataset.v); pg.refresh(); } },
      rec: (el) => { Folders.add(el.dataset.v === "new" ? { id: "new", n: T("Новые"), f: "unread", c: [] } : { id: "personal", n: T("Личные"), f: "personal", c: [] }); pg.refresh(); },
      tags: (on) => { Prefs.set("ftags", !!on); Chats.render(); },
    };
    return pg;
  },
  drawFolders(pg) {
    const list = Folders.get(), edit = pg.data.edit;
    const desc = (f) => (f.f === "unread" ? T("Все непрочитанные чаты") : f.f === "personal" ? T("Чаты с людьми") : f.c.length ? T("{0} " + plural(f.c.length, "чат", "чата", "чатов"), f.c.length) : T("Нет чатов"));
    const row = (f, i) => edit
      ? `<div class="irow">${R.ic("t", SI.folder)}<span class="tx"><b>${esc(f.n)}</b><small>${esc(desc(f))}</small></span>
          <button class="mv" data-a="up" data-v="${f.id}"${i ? "" : " disabled"} aria-label="${esc(T("Выше"))}">${SI.up}</button>
          <button class="mv" data-a="down" data-v="${f.id}"${i < list.length - 1 ? "" : " disabled"} aria-label="${esc(T("Ниже"))}">${SI.down}</button>
          <button class="mv red" data-a="del" data-v="${f.id}" aria-label="${esc(T("Удалить"))}">${SI.trash}</button></div>`
      : R.row({ a: "open", v: f.id, ic: SI.folder, c: "t", t: esc(f.n), s: esc(desc(f)) });
    const has = (id) => list.some((f) => f.id === id);
    const recs = [];
    if (!has("new")) recs.push(`<div class="irow">${R.ic("b", SI.bell)}<span class="tx"><b>${esc(T("Новые"))}</b><small>${esc(T("Все непрочитанные чаты"))}</small></span><button class="addb" data-a="rec" data-v="new">${esc(T("Добавить"))}</button></div>`);
    if (!has("personal")) recs.push(`<div class="irow">${R.ic("g", SI.user)}<span class="tx"><b>${esc(T("Личные"))}</b><small>${esc(T("Чаты с людьми"))}</small></span><button class="addb" data-a="rec" data-v="personal">${esc(T("Добавить"))}</button></div>`);
    pg.set(`
      ${R.hero(SI.folder, esc(T("Папки с чатами")), esc(T("Разложите чаты по папкам и быстро переключайтесь между ними сверху в списке чатов.")), "slim")}
      ${edit ? "" : R.card(R.row({ a: "newf", ic: SI.plus, c: "b", t: esc(T("Создать новую папку")), chev: false }))}
      ${list.length ? `${R.lbl(esc(T("Мои папки")))}${R.card(...list.map(row))}` : ""}
      ${!edit && recs.length ? `${R.lbl(esc(T("Рекомендуемые")))}<div class="card2 irows">${recs.join("")}</div>` : ""}
      ${!edit && list.length ? `${R.lbl(esc(T("Вид")))}${R.card(R.row({ a: "tags", ic: SI.layers, c: "v", t: esc(T("Названия папок в списке")), s: esc(T("Показывать, в какой папке лежит чат")), sw: 1, on: Prefs.get("ftags", false) }))}` : ""}`);
  },

  folderEdit(f, parent) {
    const isNew = !f;
    const draft = f ? { id: f.id, n: f.n, f: f.f || "", c: f.c.slice() } : { id: "f" + Date.now().toString(36), n: "", f: "", c: [] };
    const pg = Pg.open({ title: isNew ? T("Новая папка") : T("Папка"), data: { d: draft }, right: `<button class="ed-ok" data-a="save" aria-label="${esc(T("Сохранить"))}" disabled>${SI.check}</button>`,
      build: (pg) => {
        const d = pg.data.d, byId = (id) => Chats.list.find((c) => c.peer.id === id);
        const chats = d.c.map(byId).filter(Boolean);
        pg.set(`${R.lbl(esc(T("Название папки")))}
          <div class="card2 fields"><input id="fo-n" maxlength="24" value="${esc(d.n)}" placeholder="${esc(T("Название папки"))}" autocomplete="off" data-i="name"></div>
          ${d.f ? R.hint(esc(d.f === "unread" ? T("В эту папку попадают все непрочитанные чаты.") : T("В эту папку попадают чаты с людьми, без служебных.")))
                : `${R.lbl(esc(T("Включённые чаты")))}
          ${R.card(R.row({ a: "pick", ic: SI.plus, c: "b", t: esc(T("Добавить чаты")), chev: false }), ...chats.map((c) => `<div class="irow">${avatar(c.peer, "sm")}<span class="tx"><b>${esc(dispName(c.peer))}</b></span><button class="mv red" data-a="rm" data-v="${c.peer.id}" aria-label="${esc(T("Убрать"))}">${SI.x}</button></div>`))}`}
          ${isNew ? "" : R.card(R.row({ a: "delete", ic: SI.trash, c: "r", t: esc(T("Удалить папку")), danger: 1, chev: false }))}`);
        pg.sync && pg.sync();
      } });
    pg.sync = () => { const b = pg.$('[data-a="save"]'); if (b) b.disabled = !pg.data.d.n.trim(); };
    pg.sync();
    pg.on = {
      name: (v) => { pg.data.d.n = v; pg.sync(); },
      pick: () => Settings.folderPick(pg),
      rm: (el) => { pg.data.d.c = pg.data.d.c.filter((x) => x !== +el.dataset.v); pg.refresh(); },
      save: () => { const d = pg.data.d; d.n = d.n.trim(); if (!d.n) return; Folders.put(d); pg.close(); if (parent && parent.alive) parent.refresh(); toast(T("Папка сохранена")); },
      delete: async () => { if (await ask(T("Удалить папку? Чаты останутся на месте."), T("Удалить"))) { Folders.remove(pg.data.d.id); pg.close(); if (parent && parent.alive) parent.refresh(); } },
    };
  },

  folderPick(parent) {
    const sel = new Set(parent.data.d.c);
    const pg = Pg.open({ title: T("Добавить чаты"), right: `<button class="ed-ok" data-a="done" aria-label="${esc(T("Готово"))}">${SI.check}</button>`,
      build: (pg) => {
        const list = Chats.list.filter((c) => !c.peer.is_system || true);
        pg.set(list.length ? R.card(...list.map((c) => `<button class="irow tick${sel.has(c.peer.id) ? " on" : ""}" data-a="t" data-v="${c.peer.id}"><span class="chk-c">${SI.check}</span>${avatar(c.peer, "sm")}<span class="tx"><b>${esc(dispName(c.peer))}</b></span></button>`))
          : `<div class="empty"><h3>${esc(T("Пока нет чатов"))}</h3><p>${esc(T("Начните переписку — и чаты можно будет добавить в папку."))}</p></div>`);
      } });
    pg.on = {
      t: (el) => { const id = +el.dataset.v; sel.has(id) ? sel.delete(id) : sel.add(id); el.classList.toggle("on", sel.has(id)); },
      done: () => { parent.data.d.c = [...sel]; pg.close(); parent.refresh(); },
    };
  },
});

// данные папок хранятся в облаке (prefs.folders), поэтому одинаковы на всех устройствах
const Folders = {
  get() { const a = Prefs.cloud("folders", []); return Array.isArray(a) ? a.filter((f) => f && f.id && typeof f.n === "string").map((f) => ({ id: String(f.id), n: f.n, f: f.f || "", c: Array.isArray(f.c) ? f.c : [] })) : []; },
  async save(a) { await Prefs.cloudSet("folders", a); try { Chats.render(); } catch (e) {} },
  put(d) { const a = Folders.get(), i = a.findIndex((f) => f.id === d.id); if (i >= 0) a[i] = d; else a.push(d); if (a.length > 20) return toast(T("Можно создать до 20 папок")); Folders.save(a).catch(() => {}); },
  add(d) { Folders.put(d); },
  remove(id) { Folders.save(Folders.get().filter((f) => f.id !== id)).catch(() => {}); if (Chats.folder === id) Chats.folder = "all"; },
  move(id, dir) { const a = Folders.get(), i = a.findIndex((f) => f.id === id), j = i + dir; if (i < 0 || j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; Folders.save(a).catch(() => {}); },
  has(f, c) { return f.f === "unread" ? c.unread > 0 : f.f === "personal" ? !c.peer.is_system : f.c.includes(c.peer.id); },
  // сколько непрочитанных чатов в папке (для значка на вкладке)
  count(f) { return Chats.list.filter((c) => c.unread > 0 && Folders.has(f, c)).length; },
};

// ═════════════ КЭШ МЕДИА (Service Worker складывает файлы в Cache Storage) ═════════════
const Media = {
  CACHE: "media-v1",
  supported() { return !!window.caches; },
  kind(res) {
    const t = (res.headers.get("content-type") || "").toLowerCase();
    return t.startsWith("image/") ? "photo" : t.startsWith("video/") ? "video" : t.startsWith("audio/") ? "audio" : "file";
  },
  async entries() {
    const out = [];
    try {
      if (!window.caches) return out;
      const c = await caches.open(Media.CACHE);
      for (const rq of await c.keys()) {
        const rs = await c.match(rq); if (!rs) continue;
        let n = +rs.headers.get("content-length") || 0;
        if (!n) { try { n = (await rs.clone().blob()).size; } catch (e) {} }
        out.push({ rq, kind: Media.kind(rs), size: n, at: +rs.headers.get("x-cached-at") || 0 });
      }
    } catch (e) {}
    return out;
  },
  async stats() {
    const s = { photo: 0, video: 0, file: 0, audio: 0, total: 0 };
    for (const e of await Media.entries()) { s[e.kind] += e.size; s.total += e.size; }
    return s;
  },
  async clear(kinds) {
    try {
      const c = await caches.open(Media.CACHE);
      for (const e of await Media.entries()) if (kinds.includes(e.kind)) await c.delete(e.rq);
    } catch (e) {}
  },
  async trim() {
    const max = Prefs.get("cache_max", 0); if (!max) return;
    try {
      const c = await caches.open(Media.CACHE), list = (await Media.entries()).sort((a, b) => a.at - b.at);
      let sum = list.reduce((s, e) => s + e.size, 0);
      for (const e of list) { if (sum <= max) break; await c.delete(e.rq); sum -= e.size; }
    } catch (e) {}
  },
  localBytes() {
    let n = 0;
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += (k.length + (localStorage.getItem(k) || "").length) * 2; } } catch (e) {}
    return n;
  },
};
