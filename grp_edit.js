// grp_edit.js — профиль группы/канала и все настройки: тип и адрес, история, темы, реакции, приветствие, разрешения,
// медленный режим, пригласительные ссылки, администраторы и их права, участники, блокировки. Всё по образцу Telegram.

const SLOW = [0, 2, 5, 10, 30, 60, 300, 900, 3600];
const slowText = (s) => (s ? (s < 60 ? s + " " + T("сек.") : s < 3600 ? s / 60 + " " + T("мин.") : s / 3600 + " " + T("ч.")) : T("Выкл."));

// права администраторов: ключ → подпись (для группы и канала подписи немного отличаются)
const ADMIN_RIGHTS = {
  group: [["info", "Изменение профиля группы"], ["delete", "Удаление сообщений"], ["ban", "Блокировка участников"], ["invite", "Приглашение участников"],
    ["pin", "Закрепление сообщений"], ["topics", "Управление темами"], ["calls", "Управление видеочатами"], ["admins", "Назначение администраторов"]],
  channel: [["info", "Изменение профиля канала"], ["post", "Публикация сообщений"], ["edit", "Редактирование сообщений"], ["delete", "Удаление сообщений"],
    ["pin", "Закрепление сообщений"], ["ban", "Блокировка подписчиков"], ["invite", "Приглашение подписчиков"], ["calls", "Управление видеочатами"], ["admins", "Назначение администраторов"]],
};
const MEDIA_PERMS = [["photo", "Фото", "image"], ["video", "Видео", "vid"], ["file", "Файлы", "doc"], ["music", "Музыка", "vol"], ["voice", "Голосовые сообщения", "mic"], ["sticker", "Стикеры", "smile"], ["gif", "GIF", "film"], ["links", "Ссылки", "link"]];
const SEND_PERMS = [["text", "Отправка текстовых сообщений", "chat", "b"], ["invite", "Добавление участников", "userPlus", "g"], ["pin", "Закрепление сообщений", "pin", "o"], ["tag", "Изменение своего тега", "edit", "v"], ["info", "Изменение профиля группы", "info", "r"], ["topics", "Создание тем", "layers", "p"]];

const GroupEdit = {
  cur: null, live: new Set(),

  // ───────────── общие помощники ─────────────
  // страница настроек: помнит, какому чату принадлежит, и обновляется, когда сервер присылает новые данные
  page(peer, o) {
    const pg = Pg.open(Object.assign({}, o, { data: Object.assign({ peer }, o.data || {}), onClose: (p) => { GroupEdit.live.delete(p); if (o.onClose) o.onClose(p); } }));
    GroupEdit.live.add(pg);
    return pg;
  },
  onChat(p) {
    for (const pg of GroupEdit.live) if (pg.alive && pg.data.peer && pg.data.peer.id === p.id) { Object.assign(pg.data.peer, p); try { pg.refresh(); } catch (e) {} }
  },
  async upd(peer, patch) {
    const d = await api("/api/chat/" + peer.gid + "/update", { method: "POST", body: patch });
    Object.assign(peer, d.chat);
    const c = Chats.byId(peer.id); if (c && c.peer !== peer) Object.assign(c.peer, d.chat);
    if (Chat.peer && Chat.peer.id === peer.id && Chat.peer !== peer) Object.assign(Chat.peer, d.chat);
    try { Chat.updateHeader(); } catch (e) {}
    Chats.render();
    return d.chat;
  },
  // ───────────── обсуждение: привязка группы к каналу (комментарии под постами) ─────────────
  async discussion(peer, pg) {
    let groups;
    try { groups = (await api("/api/me/groups")).groups || []; } catch (e) { return toast(T("Не удалось загрузить группы")); }
    if (!groups.length) {
      const v = await UI.sheet({ title: T("Обсуждение"), icon: SI.chat,
        text: T("Привяжите группу — под постами канала появится возможность обсудить их в комментариях. Нужна группа, которой вы управляете."),
        actions: [{ label: T("Создать группу"), value: "new", accent: true }], cancel: T("Понятно") });
      if (v === "new") CreateChat.open("group");
      return;
    }
    const actions = groups.map((g) => ({ label: g.name + (peer.disc_chat_id === g.gid ? "  ✓" : ""), value: "g" + g.gid }));
    if (peer.disc_chat_id) actions.push({ label: T("Отвязать группу"), value: "rm", danger: true });
    const v = await UI.sheet({ title: T("Обсуждение"), text: T("Выберите группу — её участники смогут обсуждать посты канала в комментариях."), actions, cancel: T("Отмена") });
    if (!v) return;
    const gid = v === "rm" ? 0 : +v.slice(1);
    try { await GroupEdit.upd(peer, { disc_chat_id: gid }); toast(T(gid ? "Группа привязана" : "Группа отвязана")); if (pg && pg.alive) pg.refresh(); }
    catch (e) { toast(e.message); }
  },

  isAdmin(p) { return p.role === "owner" || p.role === "admin"; },
  canEdit(p) { return !!(p.rights && p.rights.info) || (p.gk === "group" && !!(p.perms && p.perms.info)); },
  settings(p) { return !!(p.rights && p.rights.info); },
  label(p, g, c) { return T(p.gk === "channel" ? c : g); },
  async copy(url) { await copyText(url); toast(T("Ссылка скопирована")); },
  async share(url, title) {
    try { if (navigator.share) return await navigator.share({ url, title }); } catch (e) { if (e && e.name === "AbortError") return; }
    try { if (TGW && TGW.openTelegramLink) return TGW.openTelegramLink("https://t.me/share/url?url=" + encodeURIComponent(url) + "&text=" + encodeURIComponent(title || "")); } catch (e) {}
    GroupEdit.copy(url);
  },
  roleLabel(m) { return m.tag || (m.role === "owner" ? T("Владелец") : m.role === "admin" ? T("Админ") : ""); },

  // ═════════════ ПРОФИЛЬ ═════════════
  profile(peer) {
    const c = Chats.byId(peer.id); if (c) peer = c.peer;
    if (!peer.gk) return;
    GroupEdit.cur = peer;
    const ch = peer.gk === "channel";
    const pg = GroupEdit.page(peer, {
      title: "", cls: "gprof",
      right: GroupEdit.canEdit(peer) ? `<button class="icon-btn" data-a="edit" aria-label="${esc(T("Изменить"))}">${ICON.edit}</button>` : "",
      data: { members: null, total: 0 },
      build: (pg) => GroupEdit.drawProfile(pg),
      onClose: () => { if (GroupEdit.cur === peer) GroupEdit.cur = null; },
    });
    pg.on = {
      edit: () => GroupEdit.edit(pg.data.peer),
      chat: () => { if (Chat.peer && Chat.peer.id === pg.data.peer.id) pg.close(); else { const p = pg.data.peer; Nav.unwindWhile((t) => t.id === pg.id).then(() => Chats.openChat(p)); } },
      mute: () => { const p = pg.data.peer; ChatPeek.act(Chats.isMuted(p.id) ? "unmute" : "mute", { peer: p, unread: 0 }).then(() => pg.refresh()); },
      vc: () => Calls.joinVC(pg.data.peer),
      leave: () => Groups.leave(pg.data.peer),
      add: () => Groups.addMembers(pg.data.peer),
      all: () => GroupEdit.members(pg.data.peer),
      link: () => GroupEdit.copy(pg.data.link),
      plink: () => Links.copy({ kind: "chat", id: pg.data.peer.id }),
      tag: () => GroupEdit.myTag(pg.data.peer, pg),
      tab: (el) => { pg.data.tab = el.dataset.v; pg.refresh(); },
      member: (el) => { const m = (pg.data.members || []).find((x) => x.user.id === +el.dataset.v); if (m) GroupEdit.memberMenu(pg.data.peer, m, pg); },
    };
    if (ch) pg.el.addEventListener("click", (e) => {                       // вкладки канала: подарки и медиа
      const t = e.target, D = pg.data;
      if (t.closest("[data-gsend]")) { haptic(); return Gifts.shop(D.peer); }
      const g = t.closest(".gt[data-g]");
      if (g && D.gifts) { const x = D.gifts.find((k) => k.id === +g.dataset.g); if (x) Gifts.detail(x); return; }
      const m = t.closest(".mt[data-i]");
      if (m && D.media) { const x = D.media[+m.dataset.i]; if (x) Viewer.open(x.message.att); }
    });
    GroupEdit.loadMembers(pg);
    if (ch || peer.rights) { /* ссылка нужна только тем, кто может приглашать */ }
    Groups.refresh(peer).then((r) => { if (r && pg.alive) pg.refresh(); });
    return pg;
  },

  async loadMembers(pg) {
    const p = pg.data.peer;
    if (p.gk === "channel" && !GroupEdit.isAdmin(p)) return;
    try {
      const d = await api("/api/chat/" + p.gid + "/members?limit=" + (p.gk === "channel" ? 50 : 30));
      if (!pg.alive) return;
      pg.data.members = d.members; pg.data.total = d.total; pg.refresh();
    } catch (e) {}
  },

  drawProfile(pg) {
    const p = pg.data.peer, ch = p.gk === "channel", L = pg.data.members || [];
    const online = L.filter((m) => m.user.online && m.user.id !== App.user.id).length + (L.length ? 1 : 0);
    const n = p.members || pg.data.total || 0;
    const sub = statusText(p) + (!ch && n > 1 && L.length && online > 1 ? ", " + T("{0} в сети", online) : "");
    const muted = Chats.isMuted(p.id), canVC = p.vc || (p.rights && p.rights.calls);
    const tile = (a, ic, t, on) => `<button class="gp-t${on ? " on" : ""}" data-a="${a}">${ic}<span>${esc(t)}</span></button>`;
    let h = `<div class="gp-hero">${avatar(p, "xl")}<h2>${nameHTML(p)}</h2><div class="gp-sub">${esc(sub)}</div></div>
      <div class="gp-acts">
        ${tile("chat", CMI.open, T(ch ? "Канал" : "Чат"))}
        ${tile("mute", muted ? CMI.mute : CMI.bell, T(muted ? "Вкл. звук" : "Звук"), muted)}
        ${canVC ? tile("vc", CALLI.vchat, T("Видеочат")) : ""}
        ${tile("leave", CMI.out, T(p.role === "owner" ? "Удалить" : "Покинуть"))}
      </div>`;
    let rows = [];
    if (p.bio) rows.push(`<div class="gp-info"><small>${esc(T("Описание"))}</small><div>${Rich.render(p.bio, [])}</div></div>`);
    if (p.username && p.plink) { const url = (pg.data.link = Groups.pubLink(p)); rows.push(R.row({ a: "link", ic: SI.link, c: "b", t: esc(url.replace(/^https?:\/\//, "")), s: esc(T("Публичная ссылка. Нажмите, чтобы скопировать")), noch: 1 })); }
    else if (p.role) rows.push(R.row({ a: "plink", ic: SI.link, c: "b", t: esc(T("Копировать ссылку")), s: esc(T(ch ? "Ссылка на канал откроется только подписчикам" : "Ссылка на группу откроется только участникам")), noch: 1 }));
    if (p.gk === "group" && p.perms && p.perms.tag && p.role !== "owner") rows.push(R.row({ a: "tag", ic: SI.edit, c: "v", t: esc(T("Мой тег")), r: esc(p.tag || T("Не задан")) }));
    if (rows.length) h += `<div class="card2 irows">${rows.join("")}</div>`;
    if (p.can_invite) h += `<div class="card2 irows">${R.row({ a: "add", ic: SI.userPlus, c: "b", t: esc(T(ch ? "Добавить подписчиков" : "Добавить участников")), noch: 1 })}</div>`;
    if (L.length) {
      const items = L.slice(0, 30).map((m) => {
        const u = m.user, lab = GroupEdit.roleLabel(m);
        return `<button class="irow gp-m" data-a="member" data-v="${u.id}">${Stories.av(u, "sm")}<span class="tx"><b>${nameHTML(u)}</b><small class="${u.online ? "on" : ""}">${esc(u.id === App.user.id ? T("вы") : statusText(u))}</small></span>${lab ? `<em class="gp-role">${esc(lab)}</em>` : ""}</button>`;
      }).join("");
      const total = pg.data.total || L.length;
      h += `${R.lbl(esc(T(ch ? "Администраторы и подписчики" : "Участники")))}<div class="card2 irows">${items}${total > L.length || total > 8 ? R.row({ a: "all", ic: SI.search, c: "gr", t: esc(T("Показать всех ({0})", total)) }) : ""}</div>`;
    } else if (!ch) h += `<div class="sr-load"><div class="spin"></div></div>`;
    if (ch) h += GroupEdit.tabsHTML(pg);
    pg.set(h);
    pg.title(T(ch ? "Информация о канале" : "Информация о группе"));
  },

  // вкладки профиля канала: «Подарки» (подарки, отправленные каналу) и «Медиа»; сообщение в канале о подарке не пишется
  tabsHTML(pg) {
    const p = pg.data.peer, D = pg.data, t = D.tab || (p.gifts_n > 0 ? "gifts" : "media");
    D.tab = t;
    const gn = D.gifts ? D.gifts.length : (p.gifts_n || 0);
    const empty = (ic, h, tx) => `<div class="pf-empty"><div class="pf-eic">${ic}</div><h3>${esc(h)}</h3><p>${esc(tx)}</p></div>`;
    let body;
    if (!D[t]) {
      body = `<div class="pf-load"><span class="spin"></span></div>`;
      GroupEdit.loadTab(pg, t);
    } else if (t === "gifts") {
      body = D.gifts.length ? Gifts.grid(D.gifts, p, false) : Gifts.emptyGrid(false);
    } else {
      body = D.media.length ? `<div class="umg">${D.media.map((x, i) => { const a = x.message.att, vid = /^video\//.test(a.mime || ""); return `<button class="mt" data-i="${i}"><img src="${esc(fileUrl(a.turl || a.url))}" alt="" loading="lazy" decoding="async">${vid ? `<span class="mt-v">▶</span>` : ""}</button>`; }).join("")}</div>`
        : empty(SI.image, T("Нет медиа"), T("Фото и видео из канала появятся здесь."));
    }
    return `<div class="utabs gp-tabs">${[["gifts", T("Подарки"), gn], ["media", T("Медиа")]].map(([k, l, n]) => `<button data-a="tab" data-v="${k}" class="${t === k ? "on" : ""}">${esc(l)}${n ? `<em>${n}</em>` : ""}</button>`).join("")}</div><div class="up-tab gp-tab">${body}</div>`;
  },
  async loadTab(pg, t) {
    const D = pg.data, p = D.peer; D.ld = D.ld || {};
    if (D.ld[t]) return; D.ld[t] = 1;
    try {
      if (t === "gifts") D.gifts = (await api("/api/gifts/chat/" + p.gid)).gifts;
      else D.media = ((await api("/api/search/messages?kind=media&peer=" + p.id)).messages || []).filter((x) => x.message && x.message.att);
    } catch (e) { if (t === "gifts") D.gifts = []; else D.media = []; }
    if (pg.alive) pg.refresh();
  },

  async myTag(p, pg) {
    const t = await UI.prompt({ title: T("Мой тег"), value: p.tag || "", placeholder: T("Например: Дизайнер"), ok: T("Сохранить"), type: "text", extra: p.tag ? T("Убрать") : "" });
    if (t === null) return;
    try { const d = await api("/api/chat/" + p.gid + "/tag", { method: "POST", body: { tag: t } }); p.tag = d.tag; pg.refresh(); GroupEdit.loadMembers(pg); }
    catch (e) { toast(e.message); }
  },

  // действия над участником (для администраторов)
  async memberMenu(p, m, pg) {
    const u = m.user, me = App.user.id; if (u.id === me) return;
    const R_ = p.rights || {}, A = [{ label: T("Написать"), value: "msg" }];
    const mine = p.role === "owner";
    if (R_.admins && m.role !== "owner") A.push({ label: T(m.role === "admin" ? "Изменить права администратора" : "Назначить администратором"), value: "admin" });
    if (R_.ban && p.gk === "group" && m.role === "member") A.push({ label: T("Ограничить"), value: "restrict" });
    if (R_.ban && m.role !== "owner" && (m.role === "member" || mine || m.adder === me)) {
      A.push({ label: T(p.gk === "channel" ? "Удалить из канала" : "Удалить из группы"), value: "kick", danger: true });
      A.push({ label: T("Заблокировать"), value: "ban", danger: true });
    }
    const v = await UI.sheet({ title: dispName(u), text: GroupEdit.roleLabel(m), actions: A });
    if (!v) return;
    try {
      if (v === "msg") return UserProfile.open(u);
      if (v === "admin") return GroupEdit.adminRights(p, m, pg);
      if (v === "restrict") return GroupEdit.restrict(p, m, pg);
      if (v === "kick" || v === "ban") {
        const q = v === "ban" ? T("Заблокировать {0}? Человек не сможет вернуться по ссылке.", dispName(u)) : T("Удалить {0}?", dispName(u));
        if (!(await UI.sheet({ title: q, actions: [{ label: T("Да"), value: true, danger: true }], cancel: T("Нет") }))) return;
        await api("/api/chat/" + p.gid + "/remove", { method: "POST", body: { user: u.id, ban: v === "ban" } });
        toast(T(v === "ban" ? "Заблокирован" : "Удалён"));
        if (pg && pg.alive) GroupEdit.reload(pg);
        Groups.refresh(p);
      }
    } catch (e) { toast(e.message); }
  },
  reload(pg) { if (pg.data.reload) pg.data.reload(); else if (pg.o && pg.o.cls === "gprof") GroupEdit.loadMembers(pg); },

  // ═════════════ ИЗМЕНЕНИЕ ═════════════
  edit(peer) {
    const ch = peer.gk === "channel", full = GroupEdit.settings(peer);
    const pg = GroupEdit.page(peer, {
      title: T(ch ? "Изменить канал" : "Изменить группу"),
      right: `<button class="hbtn" data-a="save">${esc(T("Готово"))}</button>`,
      data: { name: null, about: null },
      build: (pg) => GroupEdit.drawEdit(pg),
    });
    const save = async () => {
      const p = pg.data.peer, d = pg.data;
      const patch = {};
      if (d.name !== null && d.name.trim() !== p.name) { if (!d.name.trim()) return toast(T("Введите название")); patch.title = d.name.trim(); }
      if (d.about !== null && d.about.trim() !== (p.bio || "")) patch.about = d.about.trim();
      try { if (Object.keys(patch).length) await GroupEdit.upd(p, patch); pg.close(); } catch (e) { toast(e.message); }
    };
    pg.on = {
      save, name: (v) => { pg.data.name = v; }, about: (v) => { pg.data.about = v; },
      photo: () => GroupEdit.photo(pg),
      type: () => GroupEdit.type(pg.data.peer),
      hist: () => GroupEdit.hist(pg.data.peer),
      topics: async (on) => { try { await GroupEdit.upd(pg.data.peer, { topics: !!on }); } catch (e) { toast(e.message); pg.refresh(); } },
      sign: async (on) => { try { await GroupEdit.upd(pg.data.peer, { sign: !!on }); } catch (e) { toast(e.message); pg.refresh(); } },
      disc: () => GroupEdit.discussion(pg.data.peer, pg),
      react: () => GroupEdit.reactions(pg.data.peer),
      greet: () => GroupEdit.greeting(pg.data.peer),
      perms: () => GroupEdit.perms(pg.data.peer),
      links: () => GroupEdit.links(pg.data.peer),
      admins: () => GroupEdit.admins(pg.data.peer),
      members: () => GroupEdit.members(pg.data.peer),
      banned: () => GroupEdit.banned(pg.data.peer),
      actions: () => GroupEdit.actions(pg.data.peer),
      auto: async () => {
        const p = pg.data.peer;
        const v = await UI.sheet({ title: T("Автоудаление сообщений"), actions: AUTO_DEL.map(([s, n]) => ({ label: ((p.auto_del || 0) === s ? "✓ " : "") + T(n), value: s + 1 })) });
        if (!v) return;
        try { await GroupEdit.upd(p, { auto_del: v - 1 }); pg.refresh(); } catch (e) { toast(e.message); }
      },
      del: () => Groups.leave(pg.data.peer),
    };
    Groups.refresh(peer).then(() => { if (pg.alive) pg.refresh(); });
    return pg;
  },

  drawEdit(pg) {
    const p = pg.data.peer, d = pg.data, ch = p.gk === "channel", full = GroupEdit.settings(p), owner = p.role === "owner";
    const nm = d.name === null ? p.name : d.name, ab = d.about === null ? p.bio || "" : d.about;
    const reactTxt = p.react_mode === "none" ? T("Выкл.") : p.react_mode === "some" ? T("Некоторые") + " (" + (p.react_list || []).length + ")" : T("Все");
    const permsOn = p.perms_all ? Object.values(p.perms_all).filter(Boolean).length : 0, permsAll = p.perms_all ? Object.keys(p.perms_all).length : 0;
    let h = `<div class="ge-top"><button class="ge-av" data-a="photo" aria-label="${esc(T("Выбрать фотографию"))}">${avatar(p, "xl")}<span class="ge-cam">${ICON.camera}</span></button>
      <button class="ge-photo" data-a="photo">${esc(T("Выбрать фотографию"))}</button></div>
      ${R.lbl(esc(T(ch ? "Название канала" : "Название группы")))}
      <div class="card2 fields"><input data-i="name" maxlength="64" value="${esc(nm)}" placeholder="${esc(T("Название"))}" autocomplete="off"></div>
      ${R.lbl(esc(T("Описание")))}
      <div class="card2 fields"><textarea data-i="about" rows="3" maxlength="255" placeholder="${esc(T("Описание (необязательно)"))}">${esc(ab)}</textarea></div>`;
    if (full) {
      const rows = [];
      rows.push(R.row({ a: "type", ic: SI.lock, c: "g", t: esc(T(ch ? "Тип канала" : "Тип группы")), r: esc(T(p.username ? "Публичная" : "Частная")) }));
      if (!ch) rows.push(R.row({ a: "hist", ic: SI.clock, c: "o", t: esc(T("История чата")), r: esc(T(p.hist ? "Видна" : "Скрыта")) }));
      if (ch) rows.push(R.row({ a: "sign", ic: SI.edit, c: "v", t: esc(T("Подписывать сообщения")), s: esc(T("Под постами будет имя администратора")), sw: 1, on: !!p.sign }));
      if (ch) rows.push(R.row({ a: "disc", ic: SI.chat, c: "p", t: esc(T("Обсуждение")), r: esc(p.disc_name || T("Не выбрано")) }));
      h += `<div class="gap-s"></div>${R.card(...rows)}`;
      if (!ch) h += `${R.card(R.row({ a: "topics", ic: SI.layers, c: "b", t: esc(T("Темы")), sw: 1, on: !!p.topics }))}${R.hint(esc(T("Темы превращают группу в форум: каждое обсуждение живёт в своей теме, у каждой есть название и цвет. Создавать темы могут только владелец и администраторы, а также участники, которым это разрешено.")))}`;
      h += `<div class="gap-s"></div>` + R.card(
        R.row({ a: "react", ic: SI.heart, c: "r", t: esc(T("Реакции")), r: esc(reactTxt) }),
        !ch ? R.row({ a: "greet", ic: SI.chat, c: "p", t: esc(T("Приветствие")), r: esc(T(p.greet_on ? "Вкл." : "Выкл.")) }) : "",
        !ch ? R.row({ a: "perms", ic: SI.key, c: "y", t: esc(T("Разрешения")), r: permsAll ? `${permsOn}/${permsAll}` : "" }) : "",
        R.row({ a: "links", ic: SI.link, c: "b", t: esc(T("Пригласительные ссылки")), r: p.links ? String(p.links) : "" }),
        R.row({ a: "admins", ic: SI.shield, c: "g", t: esc(T("Администраторы")), r: p.admins ? String(p.admins) : "" }),
        R.row({ a: "members", ic: SI.user, c: "t", t: esc(T(ch ? "Подписчики" : "Участники")), r: String(p.members || "") }),
        R.row({ a: "auto", ic: SI.timer, c: "o2", t: esc(T("Автоудаление сообщений")), r: esc(autoDelText(p.auto_del || 0)) }),
        R.row({ a: "banned", ic: SI.x, c: "r", t: esc(T("Заблокированные")), r: p.banned ? String(p.banned) : "" }),
        R.row({ a: "actions", ic: SI.clock, c: "o2", t: esc(T("Последние действия")) }));
    }
    h += `<div class="gap-s"></div>` + R.card(R.row({ a: "del", ic: SI.out, c: "r", t: esc(T(owner ? (ch ? "Удалить канал" : "Удалить группу") : ch ? "Покинуть канал" : "Покинуть группу")), danger: 1, noch: 1 }));
    // не сбрасываем введённое при перерисовке: фокус и каретка остаются у поля
    const act = document.activeElement, keep = act && pg.el.contains(act) && act.dataset ? { i: act.dataset.i, s: act.selectionStart } : null;
    pg.set(h);
    if (keep && keep.i) { const e = pg.$(`[data-i="${keep.i}"]`); if (e) { e.focus(); try { e.setSelectionRange(keep.s, keep.s); } catch (er) {} } }
  },

  async photo(pg) {
    const p = pg.data.peer;
    let data = null;
    if (p.avatar) {
      const k = await UI.sheet({ title: T("Фото"), actions: [{ label: T("Выбрать новое фото"), value: "new" }, { label: T("Удалить фото"), value: "rm", danger: true }] });
      if (!k) return;
      if (k === "new") { data = await CreateChat.pickPhoto(T(p.gk === "channel" ? "Фото канала" : "Фото группы")); if (!data) return; }
    } else { data = await CreateChat.pickPhoto(T(p.gk === "channel" ? "Фото канала" : "Фото группы")); if (!data) return; }
    try {
      const d = await api("/api/chat/" + p.gid + "/photo", { method: "POST", body: { data: data || "" } });
      Object.assign(p, d.chat);
      const c = Chats.byId(p.id); if (c && c.peer !== p) Object.assign(c.peer, p);
      Chats.render(); try { Chat.updateHeader(); } catch (e) {}
      pg.refresh(); toast(T(data ? "Фото обновлено" : "Фото удалено"));
    } catch (e) { toast(e.message); }
  },

  // ───────────── тип: частная / публичная ─────────────
  async type(peer) {
    const ch = peer.gk === "channel";
    const pg = GroupEdit.page(peer, {
      title: T(ch ? "Тип канала" : "Тип группы"), right: `<button class="hbtn" data-a="save">${esc(T("Готово"))}</button>`,
      data: { pub: !!peer.username, slug: peer.username || "", links: null },
      build: (pg) => {
        const p = pg.data.peer, d = pg.data;
        const ok = !d.pub || /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(d.slug);
        const url = d.links && d.links.primary ? d.links.primary.url : "";
        pg.set(`${R.lbl(esc(T(ch ? "Тип канала" : "Тип группы")))}
          ${R.card(
            `<button class="irow opt${!d.pub ? " on" : ""}" data-a="priv"><span class="tx"><b>${esc(T("Частная"))}</b><small>${esc(T(ch ? "Подписаться можно только по пригласительной ссылке." : "Вступить можно только по пригласительной ссылке."))}</small></span>${SI.check}</button>`,
            `<button class="irow opt${d.pub ? " on" : ""}" data-a="pub"><span class="tx"><b>${esc(T("Публичная"))}</b><small>${esc(T(ch ? "У канала будет короткий адрес — его можно найти в поиске." : "У группы будет короткий адрес — её можно найти в поиске."))}</small></span>${SI.check}</button>`)}
          ${d.pub ? `${R.lbl(esc(T("Адрес")))}<div class="card2 fields"><input data-i="slug" maxlength="32" value="${esc(d.slug)}" placeholder="my_group" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
            ${R.hint(esc(ok ? T("Адрес: от 4 до 32 символов — латиница, цифры, _. Должен начинаться с буквы.") : T("Адрес: от 4 до 32 символов — латиница, цифры, _. Должен начинаться с буквы.")) )}
            ${d.slug && ok ? `<div class="ge-link">${esc(Groups.pubLink(pg.data.peer, d.slug).replace(/^https?:\/\//, ""))}</div>` : ""}`
          : `${R.lbl(esc(T("Пригласительная ссылка")))}<div class="card2 ge-linkc"><div class="ge-link2">${esc(url || "…")}</div>
              <div class="ge-btns"><button data-a="copy">${esc(T("Скопировать"))}</button><button data-a="share">${esc(T("Поделиться"))}</button></div></div>
              ${R.hint(esc(T("Любой, у кого есть эта ссылка, сможет войти. Чтобы закрыть доступ, отзовите ссылку в разделе «Пригласительные ссылки».")))}`}`);
      },
    });
    pg.on = {
      priv: () => { pg.data.pub = false; pg.refresh(); }, pub: () => { pg.data.pub = true; pg.refresh(); },
      slug: (v) => { pg.data.slug = v.trim().replace(/^@/, ""); const ok = /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(pg.data.slug); const l = pg.$(".ge-link"); if (l) l.textContent = ok ? Groups.pubLink(pg.data.peer, pg.data.slug).replace(/^https?:\/\//, "") : ""; },
      copy: () => pg.data.links && GroupEdit.copy(pg.data.links.primary.url),
      share: () => pg.data.links && GroupEdit.share(pg.data.links.primary.url, peer.name),
      save: async () => {
        const d = pg.data;
        if (d.pub && !/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(d.slug)) return toast(T("Адрес: от 4 до 32 символов — латиница, цифры, _. Должен начинаться с буквы."));
        try { await GroupEdit.upd(pg.data.peer, { slug: d.pub ? d.slug : "" }); pg.close(); toast(T("Сохранено")); } catch (e) { toast(e.message); }
      },
    };
    try { pg.data.links = await api("/api/chat/" + peer.gid + "/links"); pg.refresh(); } catch (e) {}
    return pg;
  },

  // ───────────── история чата ─────────────
  hist(peer) {
    const pg = GroupEdit.page(peer, {
      title: T("История чата"),
      build: (pg) => {
        const p = pg.data.peer;
        pg.set(`${R.opts([{ v: "0", t: esc(T("Скрыта")), s: esc(T("Новые участники не увидят сообщения, написанные до их входа.")) }, { v: "1", t: esc(T("Видна")), s: esc(T("Новые участники смогут прочитать всю историю.")) }], p.hist ? "1" : "0", "set")}
          ${R.hint(esc(T("Это касается только тех, кто вступит после изменения. Тем, кто уже в группе, ничего не поменяется.")))}`);
      },
    });
    pg.on = { set: async (el) => { try { await GroupEdit.upd(pg.data.peer, { hist: el.dataset.v === "1" }); pg.refresh(); } catch (e) { toast(e.message); } } };
  },

  // ───────────── реакции ─────────────
  reactions(peer) {
    const pg = GroupEdit.page(peer, {
      title: T("Реакции"),
      build: (pg) => {
        const p = pg.data.peer, mode = p.react_mode || "all", list = new Set(p.react_list || []);
        pg.set(`${R.opts([{ v: "all", t: esc(T("Все реакции")) }, { v: "some", t: esc(T("Некоторые реакции")) }, { v: "none", t: esc(T("Реакции выключены")) }], mode, "mode")}
          ${mode === "some" ? `${R.lbl(esc(T("Разрешённые реакции")))}<div class="card2 rx-grid">${REACT_ALL.map((e) => `<button class="rxg${list.has(e) ? " on" : ""}" data-a="emo" data-v="${e}">${e}</button>`).join("")}</div>` : ""}
          ${R.hint(esc(T(mode === "none" ? "Участники не смогут ставить реакции на сообщения." : mode === "some" ? "Участники смогут ставить только отмеченные реакции." : "Участники могут ставить любые реакции.")))}`);
      },
    });
    let timer = 0;
    const push = () => { clearTimeout(timer); timer = setTimeout(async () => { try { await GroupEdit.upd(pg.data.peer, { react_mode: pg.data.peer.react_mode, react_list: pg.data.peer.react_list || [] }); } catch (e) { toast(e.message); } }, 350); };
    pg.on = {
      mode: (el) => { const p = pg.data.peer; p.react_mode = el.dataset.v; if (p.react_mode === "some" && !(p.react_list || []).length) p.react_list = REACT_QUICK.slice(); pg.refresh(); push(); },
      emo: (el) => { const p = pg.data.peer, s = new Set(p.react_list || []), e = el.dataset.v; if (s.has(e)) s.delete(e); else s.add(e); p.react_list = [...s]; pg.refresh(); push(); },
    };
  },

  // ───────────── приветствие ─────────────
  greeting(peer) {
    const pg = GroupEdit.page(peer, {
      title: T("Приветствие"), right: `<button class="hbtn" data-a="save">${esc(T("Готово"))}</button>`,
      data: { on: !!peer.greet_on, text: peer.greet || "" },
      build: (pg) => {
        const d = pg.data;
        const act = document.activeElement, keep = act && pg.el.contains(act) && act.dataset ? { i: act.dataset.i, s: act.selectionStart } : null;
        pg.set(`${R.card(R.row({ a: "on", ic: SI.chat, c: "p", t: esc(T("Приветствие новых участников")), sw: 1, on: d.on }))}
          ${d.on ? `${R.lbl(esc(T("Текст приветствия")))}<div class="card2 fields"><textarea data-i="text" rows="5" maxlength="500" placeholder="${esc(T("Добро пожаловать! Прочитайте правила в закреплённом сообщении."))}">${esc(d.text)}</textarea></div>` : ""}
          ${R.hint(esc(T("Приветствие показывается только тому, кто только что вошёл, и только один раз. Остальные участники его не увидят.")))}`);
        if (keep && keep.i) { const e = pg.$(`[data-i="${keep.i}"]`); if (e) { e.focus(); try { e.setSelectionRange(keep.s, keep.s); } catch (er) {} } }
      },
    });
    pg.on = {
      on: (on) => { pg.data.on = !!on; pg.refresh(); }, text: (v) => { pg.data.text = v; },
      save: async () => {
        const d = pg.data;
        if (d.on && !d.text.trim()) return toast(T("Напишите текст приветствия"));
        try { await GroupEdit.upd(pg.data.peer, { greet: d.text.trim(), greet_on: d.on }); pg.close(); toast(T("Сохранено")); } catch (e) { toast(e.message); }
      },
    };
  },

  // ═════════════ РАЗРЕШЕНИЯ УЧАСТНИКОВ ═════════════
  mediaCount(state) { return MEDIA_PERMS.filter(([k]) => state[k]).length + "/" + MEDIA_PERMS.length; },

  async perms(peer) {
    let full = peer;
    try { full = (await api("/api/chat/" + peer.gid)).chat; Object.assign(peer, full); } catch (e) {}
    const pg = GroupEdit.page(peer, {
      title: T("Разрешения"), data: { st: Object.assign({}, full.perms_all || {}), slow: full.slow || 0 },
      build: (pg) => {
        const d = pg.data, p = pg.data.peer, si = Math.max(0, SLOW.indexOf(d.slow));
        const ro = !(p.rights && p.rights.info);
        pg.set(`${R.lbl(esc(T("Что могут участники этой группы?")))}
          ${R.card(
            R.row({ a: "p_text", ic: SI.chat, c: "b", t: esc(T("Отправка текстовых сообщений")), sw: 1, on: !!d.st.text, dis: ro }),
            R.row({ a: "media", ic: SI.image, c: "g", t: esc(T("Отправка медиа")), r: GroupEdit.mediaCount(d.st) }),
            R.row({ a: "p_invite", ic: SI.userPlus, c: "t", t: esc(T("Добавление участников")), sw: 1, on: !!d.st.invite, dis: ro }),
            R.row({ a: "p_pin", ic: SI.pin, c: "o", t: esc(T("Закреплённые сообщения")), sw: 1, on: !!d.st.pin, dis: ro }),
            R.row({ a: "p_tag", ic: SI.edit, c: "v", t: esc(T("Изменение своего тега")), sw: 1, on: !!d.st.tag, dis: ro }),
            R.row({ a: "p_info", ic: SI.info, c: "r", t: esc(T("Изменение профиля группы")), sw: 1, on: !!d.st.info, dis: ro }),
            p.topics ? R.row({ a: "p_topics", ic: SI.layers, c: "p", t: esc(T("Создание тем")), sw: 1, on: !!d.st.topics, dis: ro }) : "")}
          ${R.lbl(esc(T("Медленный режим")))}
          <div class="card2 rng-card"><div class="rng-h"><b>${esc(slowText(SLOW[si]))}</b><span class="aa s">${esc(T("2 сек. — 1 час"))}</span></div>
            ${R.range({ s: "slow", min: 0, max: SLOW.length - 1, val: si, label: T("Медленный режим") })}
            <div class="slow-lab">${SLOW.map((s) => `<i>${s ? (s < 60 ? s + T("с") : s < 3600 ? s / 60 + T("м") : s / 3600 + T("ч")) : "—"}</i>`).join("")}</div></div>
          ${R.hint(esc(T(si ? "Участники смогут отправлять не больше одного сообщения за {0}. Владелец и администраторы не ограничены." : "Выключено: участники могут писать без ограничений.", slowText(SLOW[si]))))}
          ${p.rights && p.rights.ban ? `${R.lbl(esc(T("Исключения")))}${R.card(R.row({ a: "restricted", ic: SI.lock, c: "r", t: esc(T("Ограниченные участники")), s: esc(T("Личные запреты на отправку сообщений")) }))}` : ""}`);
      },
    });
    let timer = 0;
    const save = (patch) => { clearTimeout(timer); timer = setTimeout(async () => { try { await GroupEdit.upd(pg.data.peer, patch); } catch (e) { toast(e.message); } }, 350); };
    pg.on = {
      media: () => GroupEdit.media(pg),
      restricted: () => GroupEdit.restricted(pg.data.peer),
      slow: (v) => { pg.data.slow = SLOW[Math.max(0, Math.min(SLOW.length - 1, v))]; const b = pg.$(".rng-h b"); if (b) b.textContent = slowText(pg.data.slow); save({ slow: pg.data.slow }); },
    };
    SEND_PERMS.forEach(([k]) => { pg.on["p_" + k] = (on) => { pg.data.st[k] = on ? 1 : 0; save({ perms: { [k]: on ? 1 : 0 } }); }; });
    return pg;
  },

  media(parent) {
    const pg = GroupEdit.page(parent.data.peer, {
      title: T("Отправка медиа"), data: { st: parent.data.st },
      build: (pg) => {
        pg.set(R.card(...MEDIA_PERMS.map(([k, t, ic]) => R.row({ a: "p_" + k, ic: SI[ic], c: "b", t: esc(T(t)), sw: 1, on: !!pg.data.st[k], dis: !(pg.data.peer.rights && pg.data.peer.rights.info) }))) +
          R.hint(esc(T("Отмеченное разрешено участникам. Ссылки — это сообщения со ссылками на сайты."))));
      },
      onClose: () => { if (parent.alive) parent.refresh(); },
    });
    let timer = 0;
    pg.on = {};
    MEDIA_PERMS.forEach(([k]) => { pg.on["p_" + k] = (on) => { pg.data.st[k] = on ? 1 : 0; clearTimeout(timer); timer = setTimeout(async () => { try { await GroupEdit.upd(pg.data.peer, { perms: { [k]: on ? 1 : 0 } }); } catch (e) { toast(e.message); } }, 350); }; });
  },

  // ограниченные участники: список и снятие ограничений
  restricted(peer) {
    const pg = GroupEdit.page(peer, {
      title: T("Ограниченные участники"), data: { list: null },
      build: (pg) => {
        const L = pg.data.list;
        if (!L) return pg.set('<div class="sr-load"><div class="spin"></div></div>');
        pg.set(L.length ? R.card(...L.map((m) => `<button class="irow" data-a="open" data-v="${m.user.id}">${Stories.av(m.user, "sm")}<span class="tx"><b>${nameHTML(m.user)}</b><small>${esc(m.until ? T("до {0}", new Date(m.until * 1000).toLocaleString(I18N.tloc)) : T("без срока"))}</small></span></button>`))
          : R.hero(SI.lock, esc(T("Нет ограниченных")), esc(T("Ограничить участника можно в списке участников.")), "slim"));
      },
    });
    pg.on = { open: (el) => { const m = (pg.data.list || []).find((x) => x.user.id === +el.dataset.v); if (m) GroupEdit.restrict(pg.data.peer, m, pg); } };
    pg.data.reload = async () => {
      try {
        const d = await api("/api/chat/" + peer.gid + "/members?limit=200");
        pg.data.list = d.members.filter((m) => m.restr); pg.refresh();
      } catch (e) { toast(e.message); }
    };
    pg.data.reload();
  },

  // личные ограничения участника
  restrict(peer, m, parent) {
    const base = Object.assign({}, peer.perms_all || {}), cur = Object.assign({}, base, m.restr || {});
    const pg = GroupEdit.page(peer, {
      title: T("Ограничения"), data: { st: cur, until: m.until || 0, mem: m },
      right: `<button class="hbtn" data-a="save">${esc(T("Готово"))}</button>`,
      build: (pg) => {
        const d = pg.data;
        pg.set(`<div class="gp-who">${Stories.av(m.user, "sm")}<b>${nameHTML(m.user)}</b></div>
          ${R.lbl(esc(T("Что можно этому участнику")))}
          ${R.card(...[["text", "Отправлять сообщения", "chat", "b"]].concat(MEDIA_PERMS.map(([k, t, ic]) => [k, t, ic, "g"])).map(([k, t, ic, c]) => R.row({ a: "p_" + k, ic: SI[ic], c, t: esc(T(t)), sw: 1, on: !!d.st[k] })))}
          ${R.lbl(esc(T("Срок")))}
          ${R.opts([{ v: "0", t: esc(T("Навсегда")) }, { v: "3600", t: esc(T("1 час")) }, { v: "86400", t: esc(T("1 день")) }, { v: "604800", t: esc(T("1 неделя")) }], d.dur === undefined ? (d.until ? "-1" : "0") : String(d.dur), "dur")}
          ${m.restr ? `<div class="gap-s"></div>${R.card(R.row({ a: "clear", ic: SI.x, c: "r", t: esc(T("Снять все ограничения")), danger: 1, noch: 1 }))}` : ""}`);
      },
    });
    pg.on = {
      dur: (el) => { pg.data.dur = +el.dataset.v; pg.refresh(); },
      clear: async () => { try { await api("/api/chat/" + peer.gid + "/restrict", { method: "POST", body: { user: m.user.id, perms: null } }); toast(T("Ограничения сняты")); pg.close(); if (parent && parent.alive) GroupEdit.reload(parent); } catch (e) { toast(e.message); } },
      save: async () => {
        const d = pg.data, dur = d.dur === undefined ? (d.until ? -1 : 0) : d.dur;
        const until = dur > 0 ? Math.floor(Date.now() / 1000) + dur : dur === -1 ? d.until : 0;
        try { await api("/api/chat/" + peer.gid + "/restrict", { method: "POST", body: { user: m.user.id, perms: d.st, until } }); toast(T("Сохранено")); pg.close(); if (parent && parent.alive) GroupEdit.reload(parent); } catch (e) { toast(e.message); }
      },
    };
    ["text"].concat(MEDIA_PERMS.map((x) => x[0])).forEach((k) => { pg.on["p_" + k] = (on) => { pg.data.st[k] = on ? 1 : 0; }; });
  },

  // ═════════════ ПРИГЛАСИТЕЛЬНЫЕ ССЫЛКИ ═════════════
  links(peer) {
    const ch = peer.gk === "channel", adm = GroupEdit.isAdmin(peer);
    const pg = GroupEdit.page(peer, {
      title: T("Пригласительные ссылки"), data: { d: null },
      build: (pg) => {
        const d = pg.data.d;
        if (!d) return pg.set('<div class="sr-load"><div class="spin"></div></div>');
        const lk = (l) => {
          const sub = [l.req ? T("С одобрением") : "", l.uses ? l.uses + " " + plural(l.uses, T("вход"), T("входа"), T("входов")) : T("Пока никто не вошёл"), l.lim ? T("лимит {0}", l.lim) : "", l.expires ? (l.expires * 1000 < Date.now() ? T("истекла") : T("до {0}", new Date(l.expires * 1000).toLocaleDateString(I18N.tloc))) : ""].filter(Boolean).join(" · ");
          return `<button class="irow lk" data-a="item" data-v="${esc(l.slug)}"><i class="ic b">${SI.link}</i><span class="tx"><b>${esc(l.title || l.url.replace(/^https?:\/\//, ""))}</b><small>${esc(sub)}</small></span></button>`;
        };
        pg.set(`<div class="gl-hero"><svg viewBox="0 0 120 120" class="gl-ill"><circle cx="60" cy="62" r="50" fill="color-mix(in srgb,var(--accent) 14%,transparent)"/><path d="M48 70a14 14 0 0 0 20 0l16-16a14 14 0 0 0-20-20l-5 5" fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round"/><path d="M72 50a14 14 0 0 0-20 0L36 66a14 14 0 0 0 20 20l5-5" fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round" opacity=".55"/></svg>
            <p>${esc(T(ch ? "Подписаться на канал можно по ссылке. Создавайте отдельные ссылки с ограничением по сроку и числу входов." : "Войти в группу можно по ссылке. Создавайте отдельные ссылки с ограничением по сроку и числу входов."))}</p></div>
          ${R.lbl(esc(T("Пригласительная ссылка")))}
          <div class="card2 ge-linkc"><div class="ge-link2">${esc(d.primary.url)}</div>
            <div class="ge-btns"><button data-a="copy" data-v="${esc(d.primary.url)}">${esc(T("Скопировать"))}</button><button data-a="share" data-v="${esc(d.primary.url)}">${esc(T("Поделиться"))}</button></div></div>
          ${d.public ? `${R.lbl(esc(T("Публичная ссылка")))}<div class="card2 ge-linkc"><div class="ge-link2">${esc(d.public)}</div><div class="ge-btns"><button data-a="copy" data-v="${esc(d.public)}">${esc(T("Скопировать"))}</button><button data-a="share" data-v="${esc(d.public)}">${esc(T("Поделиться"))}</button></div></div>` : ""}
          ${R.hint(esc(T("Эта ссылка постоянная. Если её отозвать, сразу появится новая, а старая перестанет работать.")))}
          ${adm ? `<div class="gap-s"></div>${R.card(R.row({ a: "new", ic: SI.plus, c: "g", t: esc(T("Создать новую ссылку")), noch: 1 }), R.row({ a: "revokep", ic: SI.x, c: "r", t: esc(T("Отозвать основную ссылку")), danger: 1, noch: 1 }))}` : ""}
          ${d.reqs ? `<div class="gap-s"></div>${R.card(R.row({ a: "reqs", ic: SI.userPlus, c: "o", t: esc(T("Заявки на вступление")), r: String(d.reqs) }))}` : ""}
          ${d.links.length ? `${R.lbl(esc(T("Другие ссылки")))}<div class="card2 irows">${d.links.map(lk).join("")}</div>` : ""}
          ${d.revoked.length ? `${R.lbl(esc(T("Отозванные ссылки")))}<div class="card2 irows">${d.revoked.map((l) => `<div class="irow lk off"><i class="ic gr">${SI.link}</i><span class="tx"><b>${esc(l.title || l.url.replace(/^https?:\/\//, ""))}</b><small>${esc(T("Отозвана"))}</small></span></div>`).join("")}</div>` : ""}`);
      },
    });
    const load = async () => { try { pg.data.d = await api("/api/chat/" + peer.gid + "/links"); try { pg.data.d.reqs = (await api("/api/chat/" + peer.gid + "/requests")).n; } catch (e) {} pg.refresh(); } catch (e) { toast(e.message); pg.close(); } };
    pg.data.reload = load;
    pg.on = {
      copy: (el) => GroupEdit.copy(el.dataset.v),
      share: (el) => GroupEdit.share(el.dataset.v, peer.name),
      new: () => GroupEdit.newLink(peer, pg),
      reqs: () => GroupEdit.requests(peer, pg),
      revokep: async () => {
        if (!(await UI.sheet({ title: T("Отозвать основную ссылку?"), text: T("Старая ссылка перестанет работать, появится новая."), actions: [{ label: T("Отозвать"), value: true, danger: true }] }))) return;
        try { await api("/api/chat/" + peer.gid + "/link/revoke", { method: "POST", body: { slug: pg.data.d.primary.slug } }); load(); toast(T("Ссылка отозвана")); } catch (e) { toast(e.message); }
      },
      item: async (el) => {
        const l = pg.data.d.links.find((x) => x.slug === el.dataset.v); if (!l) return;
        const v = await UI.sheet({ title: l.title || T("Ссылка"), text: l.url, actions: [{ label: T("Скопировать"), value: "copy" }, { label: T("Поделиться"), value: "share" }, { label: T("Изменить"), value: "edit" }, { label: T("Отозвать"), value: "revoke", danger: true }] });
        if (v === "copy") GroupEdit.copy(l.url);
        else if (v === "share") GroupEdit.share(l.url, peer.name);
        else if (v === "edit") GroupEdit.newLink(peer, pg, l);
        else if (v === "revoke") { try { await api("/api/chat/" + peer.gid + "/link/revoke", { method: "POST", body: { slug: l.slug } }); load(); toast(T("Ссылка отозвана")); } catch (e) { toast(e.message); } }
      },
    };
    load();
    return pg;
  },

  newLink(peer, parent, link) {
    const pg = GroupEdit.page(peer, {
      title: T(link ? "Изменить ссылку" : "Новая ссылка"), right: `<button class="hbtn" data-a="save">${esc(link ? T("Сохранить") : T("Создать"))}</button>`,
      data: { title: link ? link.title : "", exp: link ? (link.expires ? -1 : 0) : 0, lim: link ? link.lim : 0, req: link ? !!link.req : false },
      build: (pg) => {
        const d = pg.data;
        const act = document.activeElement, keep = act && pg.el.contains(act) && act.dataset ? { i: act.dataset.i, s: act.selectionStart } : null;
        pg.set(`${R.lbl(esc(T("Название (необязательно)")))}<div class="card2 fields"><input data-i="title" maxlength="32" value="${esc(d.title)}" placeholder="${esc(T("Например: для друзей"))}" autocomplete="off"></div>
          ${R.lbl(esc(T("Срок действия")))}
          ${R.opts([].concat(link && link.expires ? [{ v: "-1", t: esc(T("Оставить как есть")) }] : [], [{ v: "0", t: esc(T("Без срока")) }, { v: "3600", t: esc(T("1 час")) }, { v: "86400", t: esc(T("1 день")) }, { v: "604800", t: esc(T("1 неделя")) }, { v: "2592000", t: esc(T("1 месяц")) }]), String(d.exp), "exp")}
          ${R.card(R.row({ a: "req", ic: SI.shield, c: "o", t: esc(T("Одобрять новых участников")), s: esc(T("Человек отправит запрос, а вы решите, принять его или нет")), sw: 1, on: !!d.req }))}
                    ${R.lbl(esc(T("Лимит входов")))}
          ${R.opts([{ v: "0", t: esc(T("Без лимита")) }, { v: "1", t: esc(T("1 человек")) }, { v: "10", t: esc(T("10 человек")) }, { v: "100", t: esc(T("100 человек")) }], String(d.lim), "lim")}`);
        if (keep && keep.i) { const e = pg.$(`[data-i="${keep.i}"]`); if (e) { e.focus(); try { e.setSelectionRange(keep.s, keep.s); } catch (er) {} } }
      },
    });
    pg.on = {
      title: (v) => { pg.data.title = v; }, req: (on) => { pg.data.req = !!on; pg.refresh(); }, exp: (el) => { pg.data.exp = +el.dataset.v; pg.refresh(); }, lim: (el) => { pg.data.lim = +el.dataset.v; pg.refresh(); },
      save: async () => {
        const d = pg.data;
        try {
          if (link) await api("/api/chat/" + peer.gid + "/link/edit", { method: "POST", body: { slug: link.slug, title: d.title, lim: d.lim, req: d.req ? 1 : 0, expires_in: d.exp === -1 ? Math.max(60, link.expires - Math.floor(Date.now() / 1000)) : d.exp } });
          else await api("/api/chat/" + peer.gid + "/link", { method: "POST", body: { title: d.title, lim: d.lim, req: d.req ? 1 : 0, expires_in: d.exp } });
          pg.close(); if (parent.alive) parent.data.reload();
        } catch (e) { toast(e.message); }
      },
    };
  },

  // ═════════════ ЗАЯВКИ НА ВСТУПЛЕНИЕ ═════════════
  requests(peer, parent) {
    const ch = peer.gk === "channel";
    const pg = GroupEdit.page(peer, {
      title: T("Заявки на вступление"), data: { list: null },
      build: (pg) => {
        const L = pg.data.list;
        if (!L) return pg.set('<div class="sr-load"><div class="spin"></div></div>');
        if (!L.length) return pg.set(`<div class="gl-hero"><p>${esc(T("Новых заявок нет"))}</p></div>`);
        pg.set(`${R.card(R.row({ a: "all_ok", ic: SI.check, c: "g", t: esc(T("Принять всех")), noch: 1 }), R.row({ a: "all_no", ic: SI.x, c: "r", t: esc(T("Отклонить всех")), danger: 1, noch: 1 }))}
          ${R.lbl(esc(T("Хотят вступить")))}
          <div class="card2 irows">${L.map((r) => `<div class="irow gp-m rq" data-u="${r.user.id}">${Stories.av(r.user, "sm")}<span class="tx"><b>${nameHTML(r.user)}</b><small>${esc(r.user.username ? "@" + r.user.username : statusText(r.user))}</small></span>
            <span class="rq-b"><button type="button" class="rq-ok" data-a="ok" data-v="${r.user.id}" aria-label="${esc(T("Принять"))}">${SI.check}</button><button type="button" class="rq-no" data-a="no" data-v="${r.user.id}" aria-label="${esc(T("Отклонить"))}">${SI.x}</button></span></div>`).join("")}</div>
          ${R.hint(esc(T(ch ? "Принятые люди сразу станут подписчиками канала." : "Принятые люди сразу станут участниками группы.")))}`);
      },
    });
    const load = async () => { try { pg.data.list = (await api("/api/chat/" + peer.gid + "/requests")).requests; pg.refresh(); } catch (e) { toast(e.message); } };
    const decide = async (body) => {
      try {
        const d = await api("/api/chat/" + peer.gid + "/request/decide", { method: "POST", body });
        if (d.failed && d.failed.length) toast(d.failed[0].error);
        peer.reqs = d.n; await load();
        if (parent && parent.alive) parent.data.reload();
      } catch (e) { toast(e.message); }
    };
    pg.data.reload = load;
    pg.on = {
      ok: (el) => decide({ uid: +el.dataset.v, ok: 1 }),
      no: (el) => decide({ uid: +el.dataset.v, ok: 0 }),
      all_ok: async () => { if (await UI.sheet({ title: T("Принять всех?"), text: T("Все заявки будут одобрены."), actions: [{ label: T("Принять всех"), value: true, accent: true }] })) decide({ all: 1, ok: 1 }); },
      all_no: async () => { if (await UI.sheet({ title: T("Отклонить все заявки?"), text: "", actions: [{ label: T("Отклонить всех"), value: true, danger: true }] })) decide({ all: 1, ok: 0 }); },
    };
    GroupEdit.reqPg = pg;
    load();
    return pg;
  },

  // ═════════════ АДМИНИСТРАТОРЫ ═════════════
  admins(peer) {
    const ch = peer.gk === "channel", canAdd = !!(peer.rights && peer.rights.admins);
    const pg = GroupEdit.page(peer, {
      title: T("Администраторы"), data: { list: null },
      build: (pg) => {
        const L = pg.data.list;
        if (!L) return pg.set('<div class="sr-load"><div class="spin"></div></div>');
        pg.set(`${canAdd ? R.card(R.row({ a: "add", ic: SI.userPlus, c: "b", t: esc(T("Добавить администратора")), noch: 1 })) : ""}
          ${R.lbl(esc(T("Администраторы")))}
          <div class="card2 irows">${L.map((m) => {
            const u = m.user, lab = GroupEdit.roleLabel(m), me = u.id === App.user.id;
            const can = m.role === "admin" && canAdd && (peer.role === "owner" || m.adder === App.user.id);
            const who = m.role === "owner" ? T("Владелец") : m.adder && L.find((x) => x.user.id === m.adder) ? T("назначил(а) {0}", dispName(L.find((x) => x.user.id === m.adder).user)) : T("Администратор");
            return `<button class="irow gp-m" ${can ? `data-a="open" data-v="${u.id}"` : ""}>${Stories.av(u, "sm")}<span class="tx"><b>${nameHTML(u)}${me ? " (" + esc(T("вы")) + ")" : ""}</b><small>${esc(who)}</small></span>${lab ? `<em class="gp-role">${esc(lab)}</em>` : ""}${can ? '<svg class="irow-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>' : ""}</button>`;
          }).join("")}</div>
          ${R.hint(esc(T(canAdd ? "Администраторам можно выдать любые права, которые есть у вас. Снять администратора может владелец или тот, кто его назначил." : "Только владелец и администраторы с правом назначения могут менять этот список.")))}`);
      },
    });
    const load = async () => { try { const d = await api("/api/chat/" + peer.gid + "/members?role=admin&limit=200"); pg.data.list = d.members; pg.refresh(); } catch (e) { toast(e.message); } };
    pg.data.reload = load;
    pg.on = {
      add: async () => {
        let have = new Set([App.user.id]), cand = [];
        try { const d = await api("/api/chat/" + peer.gid + "/members?limit=200"); cand = d.members.filter((m) => m.role === "member").map((m) => m.user); } catch (e) { return toast(e.message); }
        if (!cand.length) return toast(T(ch ? "Пока нет подписчиков, которых можно назначить" : "Пока нет участников, которых можно назначить"));
        Picker.open({ title: T("Добавить администратора"), people: cand, multi: false, onDone: async ([id]) => { const u = cand.find((x) => x.id === id); GroupEdit.adminRights(peer, { user: u, role: "member" }, pg); } });
      },
      open: (el) => { const m = (pg.data.list || []).find((x) => x.user.id === +el.dataset.v); if (m) GroupEdit.adminRights(peer, m, pg); },
    };
    load();
    return pg;
  },

  adminRights(peer, m, parent) {
    const ch = peer.gk === "channel", defs = ADMIN_RIGHTS[peer.gk], mine = peer.rights || {}, isAdm = m.role === "admin";
    const st = {};
    defs.forEach(([k]) => { st[k] = isAdm ? !!(m.rights && m.rights[k]) : !!mine[k] && !["admins", "ban"].includes(k) && (ch ? k !== "info" : k !== "info"); });
    if (!isAdm) { defs.forEach(([k]) => { if (["delete", "invite", "pin"].includes(k) || (ch && ["post", "edit"].includes(k))) st[k] = !!mine[k]; }); }
    const pg = GroupEdit.page(peer, {
      title: T("Права администратора"), right: `<button class="hbtn" data-a="save">${esc(T("Готово"))}</button>`,
      data: { st, tag: m.tag || "" },
      build: (pg) => {
        const d = pg.data, u = m.user;
        const act = document.activeElement, keep = act && pg.el.contains(act) && act.dataset ? { i: act.dataset.i, s: act.selectionStart } : null;
        pg.set(`<div class="gp-who">${Stories.av(u, "sm")}<span><b>${nameHTML(u)}</b><small>${esc(statusText(u))}</small></span></div>
          ${R.lbl(esc(T("Что может этот администратор?")))}
          ${R.card(...defs.map(([k, t]) => R.row({ a: "r_" + k, ic: SI.shield, c: "g", t: esc(T(t)), sw: 1, on: !!d.st[k], dis: !mine[k] && !d.st[k] })))}
          ${R.hint(esc(T("Выдать можно только те права, которые есть у вас.")))}
          ${R.lbl(esc(T("Должность (тег)")))}
          <div class="card2 fields"><input data-i="tag" maxlength="16" value="${esc(d.tag)}" placeholder="${esc(T("Например: Модератор"))}" autocomplete="off"></div>
          ${R.hint(esc(T("Тег виден рядом с именем администратора в сообщениях.")))}
          ${isAdm && (peer.role === "owner" || m.adder === App.user.id) ? `<div class="gap-s"></div>${R.card(R.row({ a: "dismiss", ic: SI.x, c: "r", t: esc(T("Снять с должности администратора")), danger: 1, noch: 1 }))}` : ""}`);
        if (keep && keep.i) { const e = pg.$(`[data-i="${keep.i}"]`); if (e) { e.focus(); try { e.setSelectionRange(keep.s, keep.s); } catch (er) {} } }
      },
    });
    pg.on = {
      tag: (v) => { pg.data.tag = v; },
      save: async () => {
        const d = pg.data, rights = {};
        defs.forEach(([k]) => { if (d.st[k]) rights[k] = 1; });
        try { await api("/api/chat/" + peer.gid + "/admin", { method: "POST", body: { user: m.user.id, rights, tag: d.tag } }); toast(T("Сохранено")); pg.close(); if (parent && parent.alive) { if (parent.data.reload) parent.data.reload(); else GroupEdit.loadMembers(parent); } Groups.refresh(peer); } catch (e) { toast(e.message); }
      },
      dismiss: async () => {
        if (!(await UI.sheet({ title: T("Снять {0} с должности администратора?", dispName(m.user)), actions: [{ label: T("Снять"), value: true, danger: true }] }))) return;
        try { await api("/api/chat/" + peer.gid + "/admin", { method: "POST", body: { user: m.user.id, rights: null } }); toast(T("Готово")); pg.close(); if (parent && parent.alive) { if (parent.data.reload) parent.data.reload(); else GroupEdit.loadMembers(parent); } Groups.refresh(peer); } catch (e) { toast(e.message); }
      },
    };
    defs.forEach(([k]) => { pg.on["r_" + k] = (on) => { pg.data.st[k] = !!on; }; });
  },

  // ═════════════ УЧАСТНИКИ ═════════════
  members(peer) {
    const ch = peer.gk === "channel";
    const pg = GroupEdit.page(peer, {
      title: T(ch ? "Подписчики" : "Участники"), data: { list: null, total: 0, q: "" },
      build: (pg) => {
        const d = pg.data, L = d.list;
        const act = document.activeElement, keep = act && pg.el.contains(act) && act.dataset ? { i: act.dataset.i, s: act.selectionStart } : null;
        let h = `<label class="nm-search gm-s">${SI.search}<input data-i="q" value="${esc(d.q)}" placeholder="${esc(T("Поиск"))}" autocomplete="off" spellcheck="false"></label>`;
        if (!d.q) h += R.card(
          peer.can_invite ? R.row({ a: "add", ic: SI.userPlus, c: "b", t: esc(T(ch ? "Добавить подписчиков" : "Добавить участников")), noch: 1 }) : "",
          peer.can_invite ? R.row({ a: "link", ic: SI.link, c: "g", t: esc(T("Пригласить по ссылке")), noch: 1 }) : "");
        if (!L) h += '<div class="sr-load"><div class="spin"></div></div>';
        else {
          h += R.lbl(esc(d.q ? T("Найдено") : T(ch ? "Подписчики" : "Контакты в этой группе") + " · " + d.total));
          h += `<div class="card2 irows">${L.map((m) => {
            const u = m.user, lab = GroupEdit.roleLabel(m);
            return `<button class="irow gp-m" data-a="member" data-v="${u.id}">${Stories.av(u, "sm")}<span class="tx"><b>${nameHTML(u)}</b><small class="${u.online ? "on" : ""}">${esc(u.id === App.user.id ? T("вы") : statusText(u))}</small></span>${lab ? `<em class="gp-role">${esc(lab)}</em>` : ""}</button>`;
          }).join("") || `<div class="nm-empty">${esc(T("Никого не найдено"))}</div>`}</div>`;
        }
        pg.set(h);
        if (keep && keep.i) { const e = pg.$(`[data-i="${keep.i}"]`); if (e) { e.focus(); try { e.setSelectionRange(keep.s, keep.s); } catch (er) {} } }
      },
    });
    let tm = 0;
    const load = async () => {
      const q = pg.data.q;
      try {
        const d = await api("/api/chat/" + peer.gid + "/members?limit=200" + (q ? "&q=" + encodeURIComponent(q) : ""));
        if (pg.data.q !== q) return;
        pg.data.list = d.members; pg.data.total = d.total; pg.refresh();
      } catch (e) { toast(e.message); }
    };
    pg.data.reload = load;
    pg.on = {
      q: (v) => { pg.data.q = v.trim(); clearTimeout(tm); tm = setTimeout(load, 250); },
      add: () => Groups.addMembers(peer), link: () => GroupEdit.links(peer),
      member: (el) => { const m = (pg.data.list || []).find((x) => x.user.id === +el.dataset.v); if (m) GroupEdit.memberMenu(peer, m, pg); },
    };
    load();
    return pg;
  },

  banned(peer) {
    const pg = GroupEdit.page(peer, {
      title: T("Заблокированные"), data: { list: null },
      build: (pg) => {
        const L = pg.data.list;
        if (!L) return pg.set('<div class="sr-load"><div class="spin"></div></div>');
        pg.set(L.length ? R.card(...L.map((b) => `<button class="irow gp-m" data-a="unban" data-v="${b.user.id}">${Stories.av(b.user, "sm")}<span class="tx"><b>${nameHTML(b.user)}</b><small>${esc(T("Нажмите, чтобы разблокировать"))}</small></span></button>`))
          : R.hero(SI.shield, esc(T("Никто не заблокирован")), esc(T("Заблокированные не смогут войти по ссылке и увидят, что доступ закрыт.")), "slim"));
      },
    });
    const load = async () => { try { pg.data.list = (await api("/api/chat/" + peer.gid + "/banned")).banned; pg.refresh(); } catch (e) { toast(e.message); } };
    pg.on = { unban: async (el) => {
      const b = (pg.data.list || []).find((x) => x.user.id === +el.dataset.v); if (!b) return;
      if (!(await UI.sheet({ title: T("Разблокировать {0}?", dispName(b.user)), actions: [{ label: T("Разблокировать"), value: true, accent: true }] }))) return;
      try { await api("/api/chat/" + peer.gid + "/unban", { method: "POST", body: { user: b.user.id } }); toast(T("Разблокирован")); load(); Groups.refresh(peer); } catch (e) { toast(e.message); }
    } };
    load();
  },

  // ═════════════ ЖУРНАЛ ПОСЛЕДНИХ ДЕЙСТВИЙ (как в Telegram «Recent actions») ═════════════
  actions(peer) {
    const K = {
      join: { ic: SI.user, c: "g", t: (a) => T("{0} вступил(а)", dispName(a)) },
      add: { ic: SI.user, c: "g", t: (a, b) => T("{0} добавил(а) {1}", dispName(a), dispName(b)) },
      leave: { ic: SI.out, c: "o", t: (a) => T("{0} вышел(а)", dispName(a)) },
      kick: { ic: SI.x, c: "r", t: (a, b) => T("{0} удалил(а) {1}", dispName(a), dispName(b)) },
      ban: { ic: SI.x, c: "r", t: (a, b) => T("{0} заблокировал(а) {1}", dispName(a), dispName(b)) },
      unban: { ic: SI.shield, c: "g", t: (a, b) => T("{0} разблокировал(а) {1}", dispName(a), dispName(b)) },
      promote: { ic: SI.shield, c: "b", t: (a, b) => T("{0} назначил(а) {1} администратором", dispName(a), dispName(b)) },
      demote: { ic: SI.shield, c: "o", t: (a, b) => T("{0} снял(а) {1} с должности администратора", dispName(a), dispName(b)) },
      rights: { ic: SI.key, c: "y", t: (a, b) => T("{0} изменил(а) права {1}", dispName(a), dispName(b)) },
      restrict: { ic: SI.lock, c: "o", t: (a, b) => T("{0} ограничил(а) {1}", dispName(a), dispName(b)) },
      unrestrict: { ic: SI.lock, c: "g", t: (a, b) => T("{0} снял(а) ограничения с {1}", dispName(a), dispName(b)) },
      settings: { ic: SI.edit, c: "p", t: (a) => T("{0} изменил(а) настройки", dispName(a)) },
      photo: { ic: ICON.camera, c: "v", t: (a) => T("{0} сменил(а) фото", dispName(a)) },
      photo_rm: { ic: ICON.camera, c: "v", t: (a) => T("{0} убрал(а) фото", dispName(a)) },
    };
    const pg = GroupEdit.page(peer, {
      title: T("Последние действия"), data: { list: null, more: false },
      build: (pg) => {
        const L = pg.data.list;
        if (!L) return pg.set('<div class="sr-load"><div class="spin"></div></div>');
        if (!L.length) return pg.set(R.hero(SI.clock, esc(T("Пока нет действий")), esc(T("Здесь появятся действия администраторов: кто кого добавил, удалил, назначил или что изменил в настройках.")), "slim"));
        let h = R.card(...L.map((x) => {
          const k = K[x.kind] || { ic: SI.clock, c: "b", t: () => x.kind };
          return `<div class="irow gp-m"><i class="ic ${k.c}">${k.ic}</i><span class="tx"><b>${esc(k.t(x.actor, x.target))}</b></span><em class="irow-v">${esc(listTime(x.ts))}</em></div>`;
        }));
        if (pg.data.more) h += R.card(R.row({ a: "more", ic: SI.down, c: "b", t: esc(T("Показать ещё")) }));
        pg.set(h);
      },
    });
    const load = async (before) => {
      try {
        const d = await api("/api/chat/" + peer.gid + "/actions?limit=50" + (before ? "&before=" + before : ""));
        pg.data.list = before ? (pg.data.list || []).concat(d.actions) : d.actions;
        pg.data.more = !!d.has_more;
        pg.refresh();
      } catch (e) { toast(e.message); pg.close(); }
    };
    pg.on = { more: () => { const L = pg.data.list; if (L && L.length) load(L[L.length - 1].id); } };
    load();
  },
};

// публичная ссылка на чат: по адресу из шаблона, который присылает сервер (там учтены BOT_APP_LINK и WEB_URL)
Groups.pubLink = function (p, slug) {
  if (slug) return (p.pfmt || "").replace("{s}", slug);
  return p.plink || (p.pfmt && p.username ? p.pfmt.replace("{s}", p.username) : "");
};
