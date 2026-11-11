// Профиль собеседника — как в Telegram: шапка (у владельцев коллекционного подарка — с его фоном и узором),
// кнопки «Чат / Звук / Звонок / Подарок», личный канал, сведения, «Добавить в контакты», вкладки
// «Публикации / Подарки / Медиа / Ссылки / Общие группы», рейтинг, меню ⋮ (пожаловаться, заблокировать).
const UserProfile = {
  cur: null, stories: [], tab: "", D: {}, tmr: 0,

  UI_I: {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    bellOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-9.3-5M6.3 6.3C6.1 6.8 6 7.4 6 8c0 7-3 9-3 9h14M13.7 21a2 2 0 0 1-3.4 0M3 3l18 18"/></svg>',
    call: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
    gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.500-5a2.500 2.500 0 0 1 0 5"/></svg>',
    dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="4"/><path d="M2.500 21a7.500 7.500 0 0 1 15 0M19 8v6M16 11h6"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="4"/><path d="M2.500 21a7.500 7.500 0 0 1 15 0M16 11h6"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4M4 4h13l-2 4.500L17 13H4"/></svg>',
    ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="m5.600 5.600 12.800 12.800"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
    crown: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 18 2 7l5.500 4.500L12 4l4.500 7.500L22 7l-1 11z"/><rect x="3" y="19.500" width="18" height="2.200" rx="1"/></svg>',
  },

  async open(p) {
    UserProfile.cur = p; UserProfile.stories = []; UserProfile.D = {}; UserProfile.tab = ""; UserProfile.picked = false;
    UserProfile.render(p); Nav.open("uprofile", () => { UserProfile.cur = null; clearTimeout(UserProfile.tmr); });
    UserProfile.reload();
    UserProfile.loadStories(p.id);
  },

  async reload() {
    const id = UserProfile.cur && UserProfile.cur.id; if (!id) return;
    try {
      const d = await api("/api/user/" + id);
      if (UserProfile.cur && UserProfile.cur.id === id) { UserProfile.cur = d.user; UserProfile.D.gifts = null; UserProfile.render(d.user); }
    } catch (e) {}
  },

  async loadStories(id) {
    try {
      const d = await api("/api/stories/user/" + id);
      if (UserProfile.cur && UserProfile.cur.id === id) { UserProfile.stories = d.stories; UserProfile.render(UserProfile.cur); }
    } catch (e) {}
  },

  // кольцо вокруг аватарки изменилось (кто-то посмотрел/опубликовал)
  ring() { if (UserProfile.cur && $("uprofile").classList.contains("open")) UserProfile.render(UserProfile.cur); },

  // кто-то заблокировал / разблокировал нас или мы его
  onBlock(d) {
    const u = UserProfile.cur; if (!u) return;
    if (d.peer === u.id || d.by === u.id) UserProfile.reload();
  },

  tabs(u) {
    const t = [];
    if (UserProfile.stories.length) t.push(["pub", T("Публикации")]);
    if (u.gifts_n > 0) t.push(["gifts", T("Подарки"), u.gifts_n]);
    t.push(["media", T("Медиа")], ["links", T("Ссылки")]);
    if (u.common > 0) t.push(["groups", T("Группы"), u.common]);
    return t;
  },

  fmtMin(m) { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); },
  hoursHTML(h) {
    const names = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
    const shift = -new Date().getTimezoneOffset() - (+h.tz || 0);              // показываем во времени смотрящего
    const today = (new Date().getDay() + 6) % 7;
    const line = (k) => { const a = (h.days && h.days[k]) || []; return a.length ? a.map(([x, y]) => UserProfile.fmtMin(x + shift) + "–" + UserProfile.fmtMin(y + shift)).join(", ") : T("Выходной"); };
    return { now: line(String(today)), all: names.map((n, i) => `<div class="uh-d${i === today ? " now" : ""}"><span>${esc(T(n))}</span><b>${esc(line(String(i)))}</b></div>`).join("") };
  },

  render(u) {
    const I = UserProfile.UI_I, sys = !!u.is_system, me = App.user && u.id === App.user.id;
    const row = (v, l, copy = "", extra = "") => `<button class="pi"${copy ? ` data-copy="${esc(copy)}"` : ""}${extra}><span class="pi-v">${v}</span><span class="pi-l">${esc(l)}</span></button>`;
    const rows = [];
    if (sys) {
      rows.push(row(esc(u.number || "+42777"), T("Телефон"), u.number || "+42777"));
    } else {
      const bi = u.binfo || {}, isBot = !!u.bot;
      // как в Telegram: сначала «О себе» (у бота — «О боте»), затем телефон и имя пользователя
      if (u.bio) rows.push(row(Rich.render(u.bio, u.bio_ents || []), isBot ? T("О боте") : T("О себе"), u.bio));
      if (isBot && bi.descr && bi.descr !== u.bio) rows.push(row(esc(bi.descr).replace(/\n/g, "<br>"), T("Описание")));
      if (u.number && !isBot) rows.push(row(esc(fmtPhone(u.number)), T("Телефон"), u.number));
      const unr = UserProfile.unRow(u); if (unr) rows.push(unr);
      if (isBot && Array.isArray(bi.cmds) && bi.cmds.length) {
        const shown = bi.cmds.slice(0, 8).map((c) => `<span class="bcmd"><b>/${esc(c.command)}</b> <i>${esc(c.description || "")}</i></span>`).join("");
        rows.push(`<div class="pi"><span class="pi-v bcmds">${shown}${bi.cmds.length > 8 ? `<span class="bcmd dim">${esc(T("и ещё {0}", bi.cmds.length - 8))}</span>` : ""}</span><span class="pi-l">${esc(T("Команды"))}</span></div>`);
      }
      if (u.birthday) rows.push(row(esc(bdayText(u.birthday)) + (bdayToday(u.birthday) ? " 🎂" : ""), T("День рождения")));
      const b = u.biz;
      if (b && b.hours) {
        const hh = UserProfile.hoursHTML(b.hours);
        rows.push(`<div class="pi uh-h" data-hours><span class="pi-v"><i class="uh-st ${b.hours.open ? "on" : ""}">${esc(b.hours.open ? T("Открыто") : T("Закрыто"))}</i> ${esc(hh.now)}<span class="uh-chev">${I.chev}</span></span><span class="pi-l">${esc(T("Часы работы"))}</span><div class="uh-all">${hh.all}</div></div>`);
      }
      if (b && b.address) rows.push(row(esc(b.address), T("Адрес"), b.address));
    }

    const ph = typeof premHero === "function" ? premHero(u) : { cls: "", style: "", pat: "" };
    const nft = !!(u.nft && ph.cls);
    const muted = !sys && Chats.isMuted(u.id);
    const acts = sys || u.deleted ? (u.deleted ? `<div class="ubl"><span>${esc(T("Этот аккаунт удалён"))}</span></div>` : "") : `<div class="uacts${u.bot ? " bot" : ""}" id="up-acts">
      <button class="ua" data-a="chat">${I.chat}<span>${esc(T("Чат"))}</span></button>
      <button class="ua" data-a="mute">${muted ? I.bellOff : I.bell}<span>${esc(muted ? T("Включить") : T("Звук"))}</span></button>
      ${u.bot ? "" : `<button class="ua" data-a="call">${I.call}<span>${esc(T("Звонок"))}</span></button>
      <button class="ua gift" data-a="gift">${I.gift}<span>${esc(T("Подарок"))}</span></button>`}</div>`;
    const blocked = !sys && u.blocked
      ? `<div class="ubl"><span>${esc(T("Вы заблокировали этого пользователя"))}</span><button data-a="unblock">${esc(T("Разблокировать"))}</button></div>` : "";

    const pc = u.pchan ? `<button class="upc" data-a="pchan"><span class="upc-h">${esc(T("Канал"))}</span><span class="upc-b">${avatar(u.pchan, "sm")}<span class="upc-t"><b>${esc(u.pchan.name)}</b><small>${esc(u.pchan.last ? u.pchan.last.text : (u.pchan.members || 0) + " " + plural(u.pchan.members || 0, T("подписчик"), T("подписчика"), T("подписчиков")))}</small></span><i>${I.chev}</i></span></button>` : "";

    const rt = !sys && u.rating ? UserProfile.lvBadge(u.rating) : "";

    const dbBtn = u.bot && String(u.username || "").toLowerCase() === "dicebot" ? `<button class="uadd on" data-a="dicebot">${SI.bot}<span>${esc(T("Открыть панель ботов"))}</span></button>` : "";
    const addBtn = !sys && !me && !u.bot ? `<button class="uadd${u.saved ? " on" : ""}" data-a="contact">${u.saved ? I.minus : I.add}<span>${esc(u.saved ? T("Удалить из контактов") : T("Добавить в контакты"))}</span></button>` : "";
    const addBtn2 = dbBtn || addBtn;

    const tabs = sys ? [] : UserProfile.tabs(u);
    // пока человек сам не выбрал вкладку, показываем первую: публикации и подарки приходят позже остальных данных
    if (!UserProfile.picked || !tabs.some((t) => t[0] === UserProfile.tab)) UserProfile.tab = tabs.length ? tabs[0][0] : "";
    const tb = tabs.length ? `<div class="utabs" id="up-tabs">${tabs.map(([k, l, n]) => `<button data-t="${k}" class="${UserProfile.tab === k ? "on" : ""}">${esc(l)}${n ? `<em>${n}</em>` : ""}</button>`).join("")}</div><div id="up-tab" class="up-tab"></div>` : "";

    const scroll = $("up-body").scrollTop;
    $("up-title").innerHTML = esc(dispName(u));
    $("uprofile").classList.toggle("nftp", nft);
    $("uprofile").classList.toggle("owner-theme", !!u.owner_theme);
    $("up-more").hidden = sys || me;
    // Official / Major: значок стоит сразу после имени, а пояснение — серой подписью под карточкой данных (verNote)
    $("up-body").innerHTML = `<div class="pf-hero uhero${ph.cls}${nft ? " nft" : ""}"${ph.style}>${ph.pat}<div class="pf-av">${Stories.av(u, "xl")}</div><h2>${profName(u)}</h2>
        <div class="st2row">${rt}<div class="st2 ${u.online && !sys ? "on" : ""}">${esc(sys ? T("служебные уведомления") : statusText(u))}</div></div></div>
      ${acts}${blocked}${pc}
      ${rows.length ? `<div class="card2 pf-info">${rows.join("")}</div>` : ""}${sys ? "" : verNote(u)}
      ${addBtn2}${tb}`;
    $("up-body").scrollTop = scroll;
    UserProfile.drawTab();
  },

  tier(l) { return l >= 10 ? 4 : l >= 6 ? 3 : l >= 3 ? 2 : 1; },

  // ── «Добавить в контакты»: своё имя/фамилия для человека + поделиться с ним номером (как в Telegram) ──
  addContactSheet(u) {
    return new Promise((res) => {
      const myPhone = (App.user && App.user.number) || "";
      const L = Gifts.layer("gb-ov ac-ov", `<div class="gb-card ac-card" role="dialog">
        <button class="gb-x" data-x aria-label="${esc(T("Закрыть"))}">${GIC.x}</button>
        <h3>${esc(T("Добавить в контакты"))}</h3>
        <div class="card2 fields ac-f">
          <input id="acp-name" maxlength="60" autocomplete="off" autocapitalize="words" value="${esc(u.name || "")}" placeholder="${esc(T("Имя"))}" aria-label="${esc(T("Имя"))}">
          <input id="acp-sur" maxlength="60" autocomplete="off" autocapitalize="words" value="${esc(u.surname || "")}" placeholder="${esc(T("Фамилия (необязательно)"))}" aria-label="${esc(T("Фамилия"))}">
        </div>
        <div class="card2 irows ac-f">${R.row({ a: "share", t: esc(T("Поделиться номером телефона")), s: esc(myPhone ? fmtPhone(myPhone) : ""), sw: true, on: false })}</div>
        <div class="qr-b"><button data-cancel>${esc(T("Отмена"))}</button><button data-ok>${esc(T("Готово"))}</button></div></div>`, 128);
      const nameI = L.el.querySelector("#acp-name"), surI = L.el.querySelector("#acp-sur"), ok = L.el.querySelector("[data-ok]");
      const upd = () => { ok.disabled = !nameI.value.trim(); };
      nameI.addEventListener("input", upd); upd();
      setTimeout(() => { try { nameI.focus(); nameI.select(); } catch (e) {} }, 260);
      L.el.addEventListener("click", (e) => {
        if (e.target.closest("[data-x]")) return res(null);
        if (e.target.closest("[data-cancel]")) { L.close(); return res(null); }
        const shareRow = e.target.closest("[data-a=share]");
        if (shareRow) { haptic(); const sw = shareRow.querySelector(".sw"); const on = !sw.classList.contains("on"); sw.classList.toggle("on", on); shareRow.setAttribute("aria-checked", on); return; }
        if (e.target.closest("[data-ok]")) {
          if (!nameI.value.trim()) return;
          const share = L.el.querySelector("[data-a=share] .sw").classList.contains("on");
          L.close();
          return res({ name: nameI.value.trim(), surname: surI.value.trim(), share });
        }
      });
    });
  },

  paintActs() {
    const u = UserProfile.cur, box = $("up-acts"); if (!u || !box) return;
    const I = UserProfile.UI_I, m = Chats.isMuted(u.id), b = box.querySelector('[data-a="mute"]');
    if (b) b.innerHTML = (m ? I.bellOff : I.bell) + `<span>${esc(m ? T("Включить") : T("Звук"))}</span>`;
  },

  // ── вкладки ──
  async drawTab() {
    const box = $("up-tab"), u = UserProfile.cur; if (!box || !u) return;
    const t = UserProfile.tab, D = UserProfile.D;
    const empty = (ic, h, p) => `<div class="pf-empty"><div class="pf-eic">${ic}</div><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`;
    const wait = `<div class="pf-load"><span class="spin"></span></div>`;
    if (t === "pub") {
      box.innerHTML = UserProfile.stories.length ? Stories.grid(UserProfile.stories) : empty(SI.film, T("Нет публикаций"), "");
      const g = box.querySelector(".pg");
      if (g) g.onclick = (e) => { const b = e.target.closest(".pg-t"); if (b) Stories.show([{ uid: u.id, user: u, stories: UserProfile.stories.slice() }], 0, +b.dataset.i); };
      return;
    }
    const need = { gifts: () => api("/api/gifts/user/" + u.id), media: () => api("/api/search/messages?kind=media&peer=" + u.id),
      links: () => api("/api/search/messages?kind=link&peer=" + u.id), groups: () => api("/api/user/" + u.id + "/common") };
    if (!need[t]) { box.innerHTML = ""; return; }
    if (!D[t]) {
      box.innerHTML = wait;
      try { D[t] = await need[t](); } catch (e) { if (UserProfile.tab === t) box.innerHTML = empty(SI.info, T("Не удалось загрузить"), e.message); return; }
      if (UserProfile.tab !== t || UserProfile.cur !== u && UserProfile.cur.id !== u.id) return;
    }
    const d = D[t];
    if (t === "gifts") {
      box.innerHTML = d.gifts.length ? Gifts.grid(d.gifts, u, u.id === App.user.id) : Gifts.emptyGrid(u.id === App.user.id);
    } else if (t === "media") {
      const ms = d.messages.filter((x) => x.message.att);
      box.innerHTML = ms.length ? `<div class="umg">${ms.map((x, i) => { const a = x.message.att, vid = /^video\//.test(a.mime || ""); return `<button class="mt" data-i="${i}"><img src="${esc(fileUrl(a.turl || a.url))}" alt="" loading="lazy" decoding="async">${vid ? `<span class="mt-v">▶</span>` : ""}</button>`; }).join("")}</div>`
        : empty(SI.image, T("Нет медиа"), T("Фото и видео из вашей переписки появятся здесь."));
      box._ms = ms;
    } else if (t === "links") {
      const re = /https?:\/\/[^\s<>"]+/i;
      const ls = d.messages.map((x) => { const m = re.exec(x.message.text || ""); return m ? { url: m[0], ts: x.message.ts, text: x.message.text } : null; }).filter(Boolean);
      box.innerHTML = ls.length ? `<div class="card2 ulk">${ls.map((l, i) => { let h = l.url; try { h = new URL(l.url).hostname.replace(/^www\./, ""); } catch (e) {} return `<button class="pi" data-l="${i}"><span class="pi-v">${esc(h)}</span><span class="pi-l">${esc(l.url)}</span></button>`; }).join("")}</div>`
        : empty(UserProfile.UI_I.link, T("Нет ссылок"), T("Ссылки из вашей переписки появятся здесь."));
      box._ls = ls;
    } else if (t === "groups") {
      box.innerHTML = d.chats.length ? `<div class="card2 ugr">${d.chats.map((c) => `<button class="pi ugr-r" data-c="${c.id}">${avatar(c, "sm")}<span class="ugr-t"><b>${esc(c.name)}</b><small>${c.members} ${esc(plural(c.members, T("участник"), T("участника"), T("участников")))}</small></span></button>`).join("")}</div>`
        : empty(SI.user, T("Нет общих групп"), "");
      box._cs = d.chats;
    }
  },

  // ── действия ──
  async act(a) {
    const u = UserProfile.cur; if (!u) return;
    haptic();
    if (a === "chat") {
      if (Chat.peer && Chat.peer.id === u.id && $("chat").classList.contains("open")) return Nav.back();
      return Chats.openChat(u);
    }
    if (a === "mute") {
      if (Chats.isMuted(u.id)) { await Chats.setMute(u.id, false); return UserProfile.paintActs(); }
      return ChatPeek.act("mute", { peer: u, unread: 0 });
    }
    if (a === "call") {
      if (u.blocked) return toast(T("Вы заблокировали этого пользователя"));
      return Calls.start(u, false);
    }
    if (a === "gift") {
      if (u.blocked) return toast(T("Вы заблокировали этого пользователя"));
      if (u.blocked_me) return toast(T("Этот человек ограничил вам возможность писать"));
      return Gifts.shop(u);
    }
    if (a === "pchan") {
      const c = u.pchan, k = Chats.byId(c.id);
      if (k) return Chats.openChat(k.peer);
      return Groups.joinPreview(c.jslug || c.username);   // подписчик ещё не в канале — открываем через окно «Подписаться», как по ссылке
    }
    if (a === "rating") return UserProfile.rating(u);
    if (a === "contact") {
      if (u.saved) {
        try { const d = await api("/api/contact", { method: "POST", body: { id: u.id, on: false } }); u.saved = d.saved; toast(T("Удалено из контактов")); UserProfile.render(u); try { Contacts.load(); } catch (e) {} } catch (e) { toast(e.message); }
        return;
      }
      const r = await UserProfile.addContactSheet(u);
      if (!r) return;
      try {
        const d = await api("/api/contact", { method: "POST", body: { id: u.id, on: true, name: r.name, surname: r.surname, share_phone: r.share } });
        u.saved = d.saved; toast(T("Добавлено в контакты")); UserProfile.reload(); try { Contacts.load(); } catch (e) {}
      } catch (e) { toast(e.message); }
      return;
    }
    if (a === "dicebot") return Dicebot.open();
    if (a === "unblock") return UserProfile.block(false);
  },

  async block(on) {
    const u = UserProfile.cur; if (!u) return;
    if (on) {
      const ok = await UI.sheet({ icon: UserProfile.UI_I.ban, title: T("Заблокировать {0}?", dispName(u)), text: T("Он не сможет писать вам и звонить. Вы тоже не сможете писать ему, пока не разблокируете."), actions: [{ label: T("Заблокировать"), value: true, danger: true }], cancel: T("Отмена") });
      if (!ok) return;
    }
    try { const d = await api("/api/block", { method: "POST", body: { id: u.id, on } }); u.blocked = d.blocked; toast(T(on ? "Пользователь заблокирован" : "Пользователь разблокирован")); UserProfile.render(u); try { Chat.applyAccess(); } catch (e) {} Chats.load(); }
    catch (e) { toast(e.message); }
  },

  async report() {
    const u = UserProfile.cur; if (!u) return;
    if (u.deleted) return toast(T("Этот аккаунт уже удалён"));
    const R = [["spam", "Спам"], ["scam", "Мошенничество"], ["abuse", "Оскорбления"], ["violence", "Насилие"], ["porn", "Неприемлемый контент"], ["child", "Нарушение прав детей"], ["illegal", "Незаконные товары"], ["fake", "Выдаёт себя за другого"], ["other", "Другое"]];
    const v = await UI.sheet({ icon: UserProfile.UI_I.flag, title: T("Пожаловаться"), text: T("Выберите причину. Человек не узнает, кто пожаловался. Чтобы проверить жалобу, модераторы Dicegram увидят вашу переписку с ним."), actions: R.map(([k, l]) => ({ label: T(l), value: k })), cancel: T("Отмена") });
    if (!v) return;
    try { await api("/api/report", { method: "POST", body: { kind: "user", id: u.id, reason: v } }); UI.sheet({ icon: SI.check, title: T("Жалоба отправлена"), text: T("Спасибо! Мы проверим этот аккаунт."), actions: [], cancel: T("Готово") }); }
    catch (e) { toast(e.message); }
  },

  async menu() {
    const u = UserProfile.cur; if (!u || u.is_system || u.deleted) return;
    const A = [];
    if (u.username) A.push({ label: T("Скопировать ссылку"), value: "link" });
    A.push({ label: T("Пожаловаться"), value: "report" });
    A.push(u.blocked ? { label: T("Разблокировать"), value: "unblock", accent: true } : { label: T("Заблокировать"), value: "block", danger: true });
    const v = await UI.sheet({ title: dispName(u), actions: A, cancel: T("Отмена") });
    if (v === "link") { if (!(await Links.copy({ kind: "user", id: u.id }))) { copyText("@" + u.username); } }
    else if (v === "report") UserProfile.report();
    else if (v === "block") UserProfile.block(true);
    else if (v === "unblock") UserProfile.block(false);
  },

  // ── имена пользователя: основной @username и коллекционные («а также @…»), как в Telegram ──
  unList(u) {
    const col = ((u && u.unames) || []).map((x) => x.n);
    const main = (u && u.username) || col[0] || "";
    return { main, extras: col.filter((n) => n.toLowerCase() !== main.toLowerCase()) };
  },
  // строка карточки «Информация»: @username (с QR), а ниже — «а также @имя1, @имя2» синими ссылками
  unRow(u, copy = true) {
    const { main, extras } = UserProfile.unList(u);
    if (!main) return "";
    const also = extras.length ? `${esc(T("а также"))} ` + extras.map((n) => `<span class="un-c" role="link" tabindex="0" data-un="${esc(n)}">@${esc(n)}</span>`).join(", ") : esc(T("Имя пользователя"));
    return `<button class="pi pi-un"${copy ? ` data-copy="${esc("@" + main)}"` : ""}><span class="pi-v">@${esc(main)}${typeof QRCard !== "undefined" ? QRCard.btn() : ""}</span><span class="pi-l">${also}</span></button>`;
  },
  lvBadge(r) {
    return `<button class="urt lvb" data-a="rating" data-lv="${UserProfile.tier(r.level)}" aria-label="${esc(T("Уровень {0}", r.level))}"><span class="lvb-s"></span><b>${r.level}</b></button>`;
  },
  fmtTon(x) { return (+x || 0).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 }); },
  fmtUsd(x) { return (+x || 0).toLocaleString(I18N.lang === "en" ? "en-US" : "ru-RU", { style: "currency", currency: "USD" }); },
  fmtWhen(ts) {
    const d = new Date((+ts || 0) * 1000), p2 = (n) => String(n).padStart(2, "0");
    if (I18N.lang === "en") return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
    const M = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."];
    return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}, ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  },
  // окно «@имя — коллекционное имя пользователя, принадлежащее …» (как в Telegram), с кнопками «Подробнее» и «Копировать ссылку»
  unameSheet(u, name) {
    const it = ((u && u.unames) || []).find((x) => x.n.toLowerCase() === String(name).toLowerCase());
    if (!it) return;
    const who = esc(dispName(u)), plat = esc(it.plat || "Dicegram"), when = esc(UserProfile.fmtWhen(it.ts));
    const ton = `<span class="un-ton">${UserProfile.TON}${UserProfile.fmtTon(it.ton)}</span>`, usd = esc(UserProfile.fmtUsd(it.usd));
    const L = Gifts.layer("un-ov", `<div class="un-card" role="dialog">
      <button class="gb-x" data-x aria-label="${esc(T("Закрыть"))}">${GIC.x}</button>
      <div class="un-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg></div>
      <p class="un-t"><b class="un-n">@${esc(it.n)}</b> — ${esc(T("коллекционное имя пользователя, принадлежащее"))}</p>
      <div class="un-own">${avatar(u, "sm")}<span>${who}</span></div>
      <p class="un-d">${esc(T("Это имя приобретено на платформе")).replace(/\s*$/, "")} <b>${plat}</b> ${when} ${esc(T("за"))} ${ton} (${usd})</p>
      <div class="un-det" hidden>
        <div><span>${esc(T("Имя пользователя"))}</span><b>@${esc(it.n)}</b></div>
        <div><span>${esc(T("Владелец"))}</span><b>${who}</b></div>
        <div><span>${esc(T("Платформа"))}</span><b>${plat}</b></div>
        <div><span>${esc(T("Дата"))}</span><b>${when}</b></div>
        <div><span>${esc(T("Цена"))}</span><b>${ton} · ${usd}</b></div>
        <div><span>${esc(T("Ссылка"))}</span><b class="un-lk">${esc(it.link || "")}</b></div></div>
      <div class="un-b"><button class="un-more" data-more>${esc(T("Подробнее"))}</button><button class="un-copy" data-copy>${esc(T("Копировать ссылку"))}</button></div></div>`, 130);
    const el = L.el;
    el.querySelector("[data-more]").onclick = (e) => {
      const d = el.querySelector(".un-det"), open = d.hidden; d.hidden = !open; el.classList.toggle("det", open);
      e.currentTarget.textContent = open ? T("Скрыть") : T("Подробнее"); haptic();
    };
    el.querySelector("[data-copy]").onclick = () => { copyText(it.link || ""); toast(T("Ссылка скопирована")); haptic(); L.close(); };
  },
  TON: '<svg class="un-gem" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22.2 1.8 9.3 5.3 2.8h13.4l3.5 6.5z" fill="#2aa7ff"/><path d="M12 22.2 1.8 9.3h20.4z" fill="#0b86e8"/><path d="m5.3 2.8 6.7 6.5 6.7-6.5" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1"/></svg>',

  // ── рейтинг ──
  rating(u) {
    const r = u.rating || { level: 0, pts: 0, cur: 0, next: 150 };
    const span = Math.max(1, r.next - r.cur), pc = Math.max(0, Math.min(100, ((r.pts - r.cur) / span) * 100));
    const L = Gifts.layer("rt-ov", `<div class="rt-card" role="dialog">
      <button class="gb-x" data-x aria-label="${esc(T("Закрыть"))}">${GIC.x}</button>
      <div class="rt-crown" data-lv="${UserProfile.tier(r.level)}">${UserProfile.UI_I.crown}<b>${r.level}</b></div>
      <h3>${esc(T("Рейтинг"))}</h3>
      <p class="rt-n">${esc(T("Уровень {0}", r.level))} · ${esc(dispName(u))}</p>
      <div class="rt-bar"><i style="width:${pc.toFixed(1)}%"></i></div>
      <div class="rt-ends"><span>${r.cur}</span><span>${esc(T("до уровня {0}", r.level + 1))}: ${r.next}</span></div>
      <p class="rt-d">${esc(T("Рейтинг растёт, когда человеку дарят подарки, когда он сам дарит их другим и пока у него активен Premium. Чем выше уровень, тем ярче блеск значка."))}</p>
      <div class="rt-pts"><b>${(+r.pts || 0).toLocaleString(I18N.lang === "en" ? "en-US" : "ru-RU")}</b> <span>${esc(T("очков"))}</span></div>
      <button class="rt-ok" data-x>${esc(T("Понятно"))}</button></div>`, 128);
    void L;
  },

  bind() {
    const body = $("up-body"), sc = body;
    $("up-more").onclick = () => UserProfile.menu();
    sc.addEventListener("scroll", () => { $("uprofile").classList.toggle("scrolled", sc.scrollTop > 150); }, { passive: true });
    body.addEventListener("click", (e) => {
      const t = e.target;
      if (t.closest(".pbadge")) return;
      const a = t.closest("[data-a]"); if (a) return UserProfile.act(a.dataset.a);
      const tab = t.closest("#up-tabs button[data-t]");
      if (tab) { UserProfile.tab = tab.dataset.t; UserProfile.picked = true; haptic(); body.querySelectorAll("#up-tabs button").forEach((b) => b.classList.toggle("on", b === tab)); return UserProfile.drawTab(); }
      const h = t.closest("[data-hours]"); if (h) { h.classList.toggle("open"); return; }
      if (t.closest("[data-qr]")) { haptic(); return QRCard.open(UserProfile.cur); }
      const un = t.closest("[data-un]"); if (un) { haptic(); return UserProfile.unameSheet(UserProfile.cur, un.dataset.un); }
      if (t.closest("a, .mention")) return;                 // ссылку в «О себе» открывает общий обработчик
      const cp = t.closest(".pi[data-copy]"); if (cp) { const cu = UserProfile.cur || {}; if (cu.bio && cp.dataset.copy === cu.bio && cu.bio_ents) RClip.set(cu.bio, cu.bio_ents); else copyText(cp.dataset.copy); toast(T("Скопировано")); return haptic(); }
      const box = $("up-tab"); if (!box) return;
      if (t.closest("[data-gsend]")) return UserProfile.act("gift");
      const g = t.closest(".gt[data-g]");
      if (g) { const x = UserProfile.D.gifts.gifts.find((k) => k.id === +g.dataset.g); if (x) Gifts.detail(x); return; }
      const m = t.closest(".mt[data-i]"); if (m) { const x = box._ms[+m.dataset.i]; if (x) Viewer.open(x.message.att); return; }
      const l = t.closest("[data-l]"); if (l) { const x = box._ls[+l.dataset.l]; if (x) Browser.open(x.url); return; }
      const c = t.closest("[data-c]"); if (c) { const x = box._cs.find((k) => k.id === +c.dataset.c); if (x) { const k = Chats.byId(x.id); Chats.openChat(k ? k.peer : x); } }
    });
  },
};
