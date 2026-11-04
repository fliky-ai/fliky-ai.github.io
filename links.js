// links.js — внутренние ссылки открываются прямо в приложении, без перехода на сайт:
//   ссылки на группы и каналы, наборы эмодзи, профили, @упоминания.
//   Подходят оба вида ссылок: https://t.me/бот/приложение?startapp=j_КОД и https://сайт/#j=КОД
//   Приставки: c — чат по ссылке бизнес-аккаунта, j — приглашение, p — публичная группа/канал, e — набор эмодзи, u — профиль по @имени.
const Links = {
  parse(url) {
    let u;
    try { u = new URL(url, location.href); } catch (e) { return null; }
    const host = u.hostname.toLowerCase();
    const ours = host === location.hostname.toLowerCase() || /(^|\.)(t\.me|telegram\.me|telegram\.dog)$/.test(host);
    if (!ours) return null;
    const m = /[?&]startapp=([cjpeu])_([A-Za-z0-9_-]{2,40})/.exec(u.search) || /^#.*?([cjpeu])=([A-Za-z0-9_-]{2,40})/.exec(u.hash);
    return m ? { k: m[1], v: m[2] } : null;
  },
  // нажатие по обычной ссылке: своя — внутри приложения, чужая — во встроенном браузере
  open(url) {
    const p = Links.parse(url);
    if (!p) return Browser.open(url);
    return Links.go(p.k, p.v);
  },
  async go(k, v) {
    if (k === "j" || k === "p") return Groups.joinPreview(v);
    if (k === "e") return EmojiPack.open(v);
    if (k === "u") return Links.mention(v);
    if (k === "c") {
      try {
        const d = await api("/api/biz/link/" + v);
        if (d.user.id === App.user.id) return;
        Chat.open(d.user);
        if (d.text) setTimeout(() => { try { Editor.set(d.text); Editor.focus(true); Chat.syncMain(); } catch (e) {} }, 400);
      } catch (e) { toast(e.message); }
    }
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
