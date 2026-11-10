// links.js — внутренние ссылки открываются прямо в приложении, без перехода на сайт:
//   ссылки на группы и каналы, наборы эмодзи, профили, @упоминания.
//   Основной вид — на своём домене: dicegram.dpdns.org/имя, /имя/123, /имя/123?single, /+КОД (см. fromPath).
//   Старые тоже работают: https://t.me/бот/приложение?startapp=j_КОД и https://сайт/#j=КОД
//   Приставки: c — чат по ссылке бизнес-аккаунта, j — приглашение, p — публичная группа/канал, e — набор эмодзи, u — профиль по @имени,
//   k — закрытая группа/канал по номеру (только для участников). Ссылка на сообщение: p=адрес-123 / k=номер-123 (+ «-s» — открыть медиа).
const Links = {
  BASE: "https://dicegram.dpdns.org",                     // единственный домен публичных ссылок
  HOSTS: ["dicegram.dpdns.org"],
  // адрес на нашем домене → {k, v} в «старом виде» (j / p / k / e / c / u / n):
  //   /+КОД — приглашение;  /имя — человек, группа или канал (n);  /имя/123 — сообщение;  /имя/123?single — это фото или видео;
  //   /c/НОМЕР/123 — сообщение в закрытом чате (только для участников);  /addemoji/КОД — набор эмодзи;  /biz/КОД — ссылка бизнес-аккаунта
  fromPath(path, search) {
    let p = String(path || "");
    try { p = decodeURIComponent(p); } catch (e) {}
    p = p.replace(/^\/+|\/+$/g, "");
    if (!p || /^index\.html$/i.test(p)) return null;
    const single = /(^|[?&])single(=|&|$)/.test(search || "");
    let m;
    if ((m = /^\+([A-Za-z0-9_-]{4,40})$/.exec(p)) || (m = /^joinchat\/([A-Za-z0-9_-]{4,40})$/.exec(p))) return { k: "j", v: m[1] };
    if ((m = /^addemoji\/([A-Za-z0-9_-]{1,60})$/.exec(p))) return { k: "e", v: m[1] };
    if ((m = /^biz\/([A-Za-z0-9_-]{1,60})$/.exec(p))) return { k: "c", v: m[1] };
    if ((m = /^c\/(\d{1,18})(?:\/(\d{1,18}))?$/.exec(p))) return { k: "k", v: m[1] + (m[2] ? "-" + m[2] + (single ? "-s" : "") : "") };
    if ((m = /^@?([A-Za-z][A-Za-z0-9_]{2,31})\/(\d{1,18})$/.exec(p))) return { k: "p", v: m[1] + "-" + m[2] + (single ? "-s" : "") };
    if ((m = /^@?([A-Za-z][A-Za-z0-9_]{2,31})$/.exec(p))) return { k: "n", v: m[1] };
    return null;
  },
  parse(url) {
    let u;
    try { u = new URL(url, location.href); } catch (e) { return null; }
    const host = u.hostname.toLowerCase();
    const tme = /(^|\.)(t\.me|telegram\.me|telegram\.dog)$/.test(host);
    const ours = host === location.hostname.toLowerCase() || Links.HOSTS.includes(host) || tme;
    if (!ours) return null;
    const m = /[?&]startapp=([cjpeuk])_([A-Za-z0-9_-]{1,60})/.exec(u.search) || /^#.*?\b([cjpeuk])=([A-Za-z0-9_-]{1,60})/.exec(u.hash);
    if (m) return { k: m[1], v: m[2] };
    const bang = /^#!(\/[^#]*)$/.exec(u.hash);               // запасной вариант: 404.html / index.html переносят путь в #!/путь
    if (bang) { const q = bang[1].split("?"); return Links.fromPath(q[0], q[1] ? "?" + q[1] : ""); }
    return tme ? null : Links.fromPath(u.pathname, u.search);
  },
  // нажатие по обычной ссылке: своя — внутри приложения, чужая — во встроенном браузере
  open(url) {
    const p = Links.parse(url);
    if (!p) return Browser.open(url);
    return Links.go(p.k, p.v);
  },
  async go(k, v) {
    if (k === "p" || k === "k") {
      const mm = /^(.+?)-(\d+)(-s)?$/.exec(v);
      if (mm) return Links.openMsg(k, mm[1], +mm[2], !!mm[3]);
      if (k === "k") return Links.openMsg(k, v, 0, false);
    }
    if (k === "j" || k === "p") return Groups.joinPreview(v);
    if (k === "e") return EmojiPack.open(v);
    if (k === "u" || k === "n") return Links.mention(v);
    if (k === "c") {
      try {
        const d = await api("/api/biz/link/" + v);
        if (d.user.id === App.user.id) return;
        Chat.open(d.user);
        if (d.text) setTimeout(() => { try { Editor.set(d.text); Editor.focus(true); Chat.syncMain(); } catch (e) {} }, 400);
      } catch (e) { toast(e.message); }
    }
  },
  // ссылка на сообщение (или на закрытый чат по номеру): открываем чат и прокручиваем к сообщению
  async openMsg(k, base, mid, single) {
    if (!App.user) return;                              // откроется после входа: адрес остаётся в строке, App.enter его прочитает
    let d;
    try { d = await api("/api/msglink?" + (k === "p" ? "p=" + encodeURIComponent(base) : "k=" + encodeURIComponent(base)) + (mid ? "&m=" + mid : "")); }
    catch (e) { return toast(/закрыт/i.test(e.message) ? e.message : T("Ссылка недействительна")); }
    if (!d.joined) {
      if (d.slug) return Groups.joinPreview(d.slug);       // публичный, но вы не участник — сначала «Вступить»
      return toast(T("Это закрытая группа или канал — сообщение видно только участникам"));
    }
    const c = Chats.byId(d.chat.id), peer = c ? c.peer : d.chat;
    App.go("chats");
    let topic = null;
    if (d.topic && peer.topics) topic = { id: d.topic };
    await Chat.open(peer, topic ? { topic } : undefined);
    if (!mid) return;
    if (!d.exists) return toast(T("Сообщение не найдено"));
    await Chat.jumpTo(mid);
    if (single) {
      const m = Chat.msgs.find((x) => x.id === mid);
      if (m && m.att && m.att.url) Viewer.open(m.att);
    }
  },
  // скопировать ссылку на сообщение / чат / профиль
  async copy(body) {
    try {
      const d = await api("/api/link", { method: "POST", body });
      copyText(d.url);
      toast(d.public === false ? T("Ссылка скопирована. Она откроется только участникам.") : T("Ссылка скопирована"));
      return d.url;
    } catch (e) { toast(e.message); return null; }
  },
  // @имя: человек → профиль, группа или канал → окно с кнопкой «Вступить» (или сразу чат, если вы уже там)
  async mention(name) {
    let d;
    try { d = await api("/api/resolve/" + encodeURIComponent(name)); }
    catch (e) { return toast(T("Пользователь или группа @{0} не найдены", name)); }
    if (d.type === "user") {
      if (d.user.id === App.user.id) { try { App.go("profile"); } catch (e) {} return; }
      return UserProfile.open(d.user);
    }
    const c = Chats.byId(d.chat.id);
    if (c) return Chats.openChat(c.peer);
    return Groups.joinPreview(d.slug || name);
  },
};
