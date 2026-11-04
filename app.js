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

// сбой одного шага не должен ронять остальные; ошибка попадает в «страховку запуска» (см. index.html)
function guardLog(name, e) {
  try { if (window.__boot) window.__boot.errs.push(name + ": " + ((e && e.message) || e)); } catch (_) {}
  try { console.error(name, e); } catch (_) {}
}
function guard(name, fn) { try { return fn(); } catch (e) { guardLog(name, e); } }

// браузер предлагает установить сайт как приложение — запоминаем, чтобы показать свою кнопку в настройках
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); try { App.installEv = e; } catch (_) {} });
addEventListener("appinstalled", () => { try { App.installEv = null; } catch (_) {} });

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
      const setVH = () => document.documentElement.style.setProperty("--vh", (window.visualViewport ? visualViewport.height : innerHeight) + "px");
      setVH(); if (window.visualViewport) visualViewport.addEventListener("resize", setVH); addEventListener("resize", setVH);
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
    try { d = await api("/api/me", { timeout: 15000 }); }
    catch (e) {
      if (!Store.token) return App.showAuth();   // 401: api() уже сбросил токен и перезагружает страницу
      const m = (e && e.message) || "Нет связи с сервером";
      if (window.__boot) window.__boot.net = m;
      toast(m);
      return setTimeout(() => App.boot(), 3000);
    }
    if (window.__boot) window.__boot.net = "";
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

  enter(user) {
    App.user = user;
    const b = $("boot"); if (b) b.classList.add("hidden");
    $("auth").classList.add("hidden"); $("app").classList.remove("hidden");
    guard("profile", () => Profile.render());               // внутри обновляет и вкладку «Настройки»
    guard("tabav", () => App.tabAvatar());
    guard("lists", () => { Chats.load(); Stories.load(true); Profile.loadStories(); });
    guard("ws", () => App.connect());
    guard("go", () => App.go("chats"));
    guard("hash", () => { App.openHash(); Chat.loadQuick(); });
    setInterval(() => { try { Chat.updateHeader(); } catch (e) {} }, 30000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { guard("resume", () => { App.connect(); Chats.load(); Chat.sync(); }); } });
    addEventListener("online", () => App.connect());
  },

  // ссылки:  …/#c=адрес — чат с владельцем ссылки;  #j=код — приглашение;  #p=адрес — публичная группа/канал;
  // #e=код — набор эмодзи;  #u=имя — профиль  (в Telegram те же коды приходят в start_param: c_…, j_…, p_…, e_…, u_…)
  async openHash() {
    let code = "";
    try { code = (TGW && TGW.initDataUnsafe && TGW.initDataUnsafe.start_param) || ""; } catch (e) {}
    const h = /[#&]([cjpeu])=([A-Za-z0-9_-]{2,40})/.exec(location.hash || "");
    let kind = "", val = "";
    if (h) { kind = h[1]; val = h[2]; }
    else { const m = /^([cjpeu])_([A-Za-z0-9_-]{2,40})$/.exec(code); if (m) { kind = m[1]; val = m[2]; } }
    if (!kind) return;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    return Links.go(kind, val);
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
      guard("rx", () => Net.add("rx", "msg", (ev.data || "").length));
      if (d.type === "ready") {   // сервер принял токен
        App.retry = 0; App.setOnline(true); Chats.load(); Chat.sync();
        clearInterval(App.pingT); App.pingT = setInterval(() => ws.readyState === 1 && ws.send("ping"), 25000);
      }
      else if (d.type === "message") { Chat.onMessage(d.message); Chats.onMessage(d.message); guard("notify", () => Notif.onMessage(d.message)); }
      else if (d.type === "read") Chat.onRead(d.by);
      else if (d.type === "edit") { Chat.onEdit(d.message); Chats.onEdit(d.message); }
      else if (d.type === "del") { Chat.onDel(d.ids); Chats.load(); }
      else if (d.type === "react") { Chat.onReact(d); guard("notify", () => Notif.onReact(d)); }
      else if (d.type === "pin") Chat.onPin(d);
      else if (d.type === "cc") Chat.onCC(d);
      else if (d.type === "presence") App.presence(d);
      else if (d.type === "chat") guard("groups", () => Groups.onChat(d));
      else if (d.type === "chat_gone") guard("groups", () => Groups.onGone(d.id));
      else if (d.type === "vc") guard("calls", () => Calls.onVC(d));
      else if (d.type === "rtc") guard("calls", () => Calls.onRTC(d));
      else if (d.type === "profile") App.profile(d.user);
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
    App.patchUser(u.id, { name: u.name, surname: u.surname, username: u.username, bio: u.bio, avatar: u.avatar, premium: u.premium ? 1 : 0, estatus: u.estatus || null, nft: u.nft || null, verified: u.verified ? 1 : 0 });
    Chats.render(); if (u.id === App.user.id) { Profile.render(); guard("tabav", () => App.tabAvatar()); }
    // открыт профиль этого человека — обновляем и его (значок, статус)
    guard("uprofile", () => { if (UserProfile.cur && UserProfile.cur.id === u.id) { UserProfile.cur = Object.assign({}, UserProfile.cur, u); UserProfile.render(UserProfile.cur); } });
  },

  // Проверка, что на сайте лежат все файлы нужной версии: если нет, показываем, каких именно (а не молча «не работает»).
  health() {
    const has = (f) => { try { return !!f(); } catch (e) { return false; } };
    const chk = {
      "set_misc.js": () => Notif && Folders && Media && typeof Settings.notif === "function" && typeof Settings.data === "function" && typeof Settings.folders === "function",
      "set_prem.js": () => typeof Settings.premium === "function" && typeof Settings.stars === "function",
      "set_safe.js": () => typeof Settings.privacy === "function" && Lock,
      "set_look.js": () => typeof Settings.chats === "function" && typeof Settings.energy === "function",
      "premium.js": () => PB && ES && StatusPicker && EmojiSets && PremiumPromo,
      "pg.js": () => Pg && SI && R,
      "fx.js": () => Fx && typeof Fx.play === "function",
      "intro.js": () => Intro && typeof Intro.show === "function",
      "gifts.js": () => Gifts && GiftArt && typeof Gifts.shop === "function",
      "cemoji.js": () => CE && React && EmojiPack,
      "links.js": () => Links && typeof Links.go === "function",
      "fileview.js": () => FV && typeof FV.open === "function",
      "qr.js": () => QR && QRCard && typeof QR.matrix === "function" && typeof QRCard.open === "function",
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
      "index.html": () => $("ftabs") && $("chat-fab") && $("tab-av") && $("profile-box") && $("settings-box") && $("up-body") && $("chat-list") && /20261104f/.test([...document.scripts].map((x) => x.src).join(" ")),
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
