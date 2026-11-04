// search.js — поиск на весь экран, как в Telegram: поле сверху, вкладки (Чаты, Каналы, Группы, Сообщения, Медиа, Ссылки, Файлы).
// Цвета берутся из темы: светлая тема — светлый поиск, тёмная — тёмный. Если ничего не найдено — свой экран «Нет результатов».
const Search = {
  el: null, tab: "chats", q: "", seq: 0, timer: 0, data: {}, busy: false,
  TABS: [["chats", "Чаты"], ["channels", "Каналы"], ["groups", "Группы"], ["messages", "Сообщения"], ["media", "Медиа"], ["links", "Ссылки"], ["files", "Файлы"]],

  open(tab) {
    if (Search.el) return;
    Search.tab = tab || "chats"; Search.q = ""; Search.data = {};
    const el = (Search.el = document.createElement("section"));
    el.id = "search"; el.className = "page tgp"; el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<header class="tg-head">
        <button class="icon-btn" data-back aria-label="${esc(T("Назад"))}">${SI.back.replace("<svg ", '<svg width="22" height="22" ')}</button>
        <label class="sr-field"><input id="sr-q" placeholder="${esc(T("Поиск"))}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
          <button class="clear" type="button" data-clear aria-label="${esc(T("Очистить"))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></label>
      </header>
      <div class="sr-tabs" role="tablist">${Search.TABS.map(([k, n]) => `<button class="sr-tab${k === Search.tab ? " on" : ""}" data-t="${k}" role="tab">${esc(T(n))}</button>`).join("")}</div>
      <div class="sr-body" id="sr-body"></div>`;
    document.body.appendChild(el);
    void el.offsetWidth;
    Nav.open("search", () => { Search.el = null; clearTimeout(Search.timer); setTimeout(() => el.remove(), 320); });
    const inp = el.querySelector("#sr-q");
    inp.addEventListener("input", () => {
      Search.q = inp.value.trim().replace(/^@/, "");
      el.querySelector("[data-clear]").classList.toggle("on", !!inp.value);
      clearTimeout(Search.timer);
      Search.timer = setTimeout(() => Search.run(), 230);
      Search.draw();
    });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(Search.timer); Search.run(); inp.blur(); } });
    el.addEventListener("click", (e) => Search.click(e));
    Search.draw(); Search.run();
    setTimeout(() => { try { inp.focus(); } catch (e) {} }, 280);
  },

  close() { if (Search.el) Nav.back(); },

  click(e) {
    const el = Search.el; if (!el) return;
    if (e.target.closest("[data-back]")) return Search.close();
    if (e.target.closest("[data-clear]")) { const i = el.querySelector("#sr-q"); i.value = ""; i.dispatchEvent(new Event("input")); i.focus(); return; }
    const tb = e.target.closest(".sr-tab");
    if (tb) {
      Search.tab = tb.dataset.t; haptic();
      el.querySelectorAll(".sr-tab").forEach((b) => b.classList.toggle("on", b === tb));
      try { tb.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" }); } catch (er) {}
      Search.draw(); Search.run(); return;
    }
    const rm = e.target.closest("[data-rm]");
    if (rm) { e.stopPropagation(); Search.forget(+rm.dataset.rm); return; }
    if (e.target.closest("[data-clr]")) { Prefs.set("recent_peers", []); Search.draw(); return; }
    const it = e.target.closest("[data-pk]");
    if (it) return Search.pick(it.dataset.pk, it.dataset.i);
  },

  // ───────────── запросы ─────────────
  async run() {
    const tab = Search.tab, q = Search.q, my = ++Search.seq;
    const key = tab + "|" + q;
    const needText = tab === "chats" || tab === "channels" || tab === "groups" || tab === "messages";
    if (needText && q.length < 2) { Search.data[key] = null; return Search.draw(); }
    if (Search.data[key]) return Search.draw();
    Search.busy = true; Search.draw();
    try {
      let res = {};
      if (tab === "chats" || tab === "channels" || tab === "groups") {
        const d = await api("/api/search?q=" + encodeURIComponent(q));
        res = { users: d.users || [], chats: d.chats || [] };
      } else {
        const kind = tab === "messages" ? "all" : tab === "media" ? "media" : tab === "files" ? "file" : "link";
        const d = await api("/api/search/messages?kind=" + kind + "&q=" + encodeURIComponent(q));
        res = { msgs: d.messages || [] };
      }
      if (my !== Search.seq) return;
      Search.data[key] = res;
    } catch (e) {
      if (my !== Search.seq) return;
      Search.data[key] = { err: e.message || T("Не удалось выполнить поиск") };
    }
    Search.busy = false; Search.draw();
  },

  // ───────────── отрисовка ─────────────
  hl(text, q) {
    const t = String(text || "");
    if (!q) return esc(t);
    const i = t.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(t);
    return esc(t.slice(0, i)) + "<mark>" + esc(t.slice(i, i + q.length)) + "</mark>" + esc(t.slice(i + q.length));
  },
  peerRow(p, sub, i, pk) {
    return `<button class="sr-row" data-pk="${pk}" data-i="${i}">${avatar(p)}<span class="tx"><b>${nameHTML(p)}</b><small>${sub}</small></span></button>`;
  },
  none() {
    const q = Search.q;
    return `<div class="sr-none">${ILL.none}<h3>${esc(T("Нет результатов"))}</h3><p>${esc(q ? T("По запросу «{0}» ничего не найдено.", q) : T("Здесь пока пусто."))}${q ? " " + esc(T("Проверьте имя или @username.")) : ""}</p></div>`;
  },
  recent() { const a = Prefs.get("recent_peers", []); return Array.isArray(a) ? a : []; },
  remember(p) {
    if (!p || !p.id) return;
    const o = { id: p.id, name: p.name || "", surname: p.surname || "", username: p.username || "", avatar: p.avatar || "", gk: p.gk || undefined, members: p.members, is_system: p.is_system ? 1 : 0, premium: p.premium ? 1 : 0 };
    const a = Search.recent().filter((x) => x.id !== p.id); a.unshift(o);
    Prefs.set("recent_peers", a.slice(0, 12));
  },
  forget(id) { Prefs.set("recent_peers", Search.recent().filter((x) => x.id !== id)); Search.draw(); },

  draw() {
    const el = Search.el; if (!el) return;
    const body = el.querySelector("#sr-body"), tab = Search.tab, q = Search.q, ql = q.toLowerCase();
    const d = Search.data[tab + "|" + q];
    Search.items = [];
    const push = (x) => Search.items.push(x) - 1;
    let html = "";
    const spinner = '<div class="sr-load"><div class="spin"></div></div>';

    if (tab === "chats" || tab === "channels" || tab === "groups") {
      const want = (p) => tab === "chats" ? true : tab === "channels" ? p.gk === "channel" : p.gk === "group";
      if (!q) {
        // недавние: быстрые аватарки собеседников и последние открытые из поиска
        if (tab === "chats") {
          const top = Chats.sorted().filter((c) => !c.peer.gk && !c.peer.is_system).slice(0, 10);
          if (top.length) html += `<div class="sr-sect"><span>${esc(T("Люди"))}</span></div><div class="sr-people">${top.map((c) => `<button class="sr-p" data-pk="peer" data-i="${push(c.peer)}">${avatar(c.peer)}<span class="n">${esc(c.peer.name || dispName(c.peer))}</span></button>`).join("")}</div>`;
          const rec = Search.recent();
          if (rec.length) html += `<div class="sr-sect"><span>${esc(T("Недавние"))}</span><button data-clr>${esc(T("Очистить"))}</button></div>` +
            rec.map((p) => `<div class="sr-row-w">${Search.peerRow(p, p.gk ? esc(statusText(p)) : p.username ? "@" + esc(p.username) : "", push(p), "peer")}</div>`).join("").replace(/<\/button><\/div>/g, (m, off) => m);
          if (!top.length && !rec.length) html += `<div class="sr-none">${ILL.none}<h3>${esc(T("Поиск"))}</h3><p>${esc(T("Введите имя, @username или название группы или канала."))}</p></div>`;
        } else {
          const mine = Chats.list.filter((c) => want(c.peer));
          html += mine.length ? `<div class="sr-sect"><span>${esc(T(tab === "channels" ? "Мои каналы" : "Мои группы"))}</span></div>` + mine.map((c) => Search.peerRow(c.peer, esc(statusText(c.peer)), push(c.peer), "peer")).join("")
            : `<div class="sr-none">${ILL.none}<h3>${esc(T(tab === "channels" ? "Каналов пока нет" : "Групп пока нет"))}</h3><p>${esc(T("Введите название или адрес, чтобы найти публичные."))}</p></div>`;
        }
      } else if (q.length < 2) {
        html = `<div class="sr-none"><p>${esc(T("Введите хотя бы два символа"))}</p></div>`;
      } else {
        const local = Chats.list.map((c) => c.peer).filter((p) => want(p) && (dispName(p) + " " + (p.username || "")).toLowerCase().includes(ql));
        const have = new Set(Chats.list.map((c) => c.peer.id));
        let glob = [];
        if (d && d.users) {
          if (tab === "chats") glob = glob.concat(d.users.filter((u) => !have.has(u.id) && u.id !== App.user.id));
          glob = glob.concat((d.chats || []).filter((p) => !have.has(p.id) && want(p)));
        }
        if (local.length) html += `<div class="sr-sect"><span>${esc(T("Чаты"))}</span></div>` + local.map((p) => Search.peerRow(p, p.gk ? esc(statusText(p)) : p.username ? "@" + esc(p.username) : esc(statusText(p)), push(p), "peer")).join("");
        if (glob.length) html += `<div class="sr-sect"><span>${esc(T("Глобальный поиск"))}</span></div>` + glob.map((p) => Search.peerRow(p, p.gk ? "@" + esc(p.username) + " · " + esc(statusText(p)) : p.username ? "@" + esc(p.username) : esc(statusText(p)), push(p), "peer")).join("");
        if (!local.length && !glob.length) html = Search.busy && !d ? spinner : Search.none();
        else if (Search.busy && !d) html += spinner;
        if (d && d.err) html += `<div class="sr-none"><p>${esc(d.err)}</p></div>`;
      }
    } else {
      if (!d) {
        html = (tab === "messages" && q.length < 2) ? `<div class="sr-none">${ILL.none}<h3>${esc(T("Поиск по сообщениям"))}</h3><p>${esc(T("Введите текст, который нужно найти в ваших чатах."))}</p></div>` : Search.busy ? spinner : "";
      } else if (d.err) html = `<div class="sr-none"><p>${esc(d.err)}</p></div>`;
      else if (!d.msgs.length) html = Search.none();
      else if (tab === "media") {
        html = `<div class="sr-media">${d.msgs.map((r) => {
          const a = r.message.att || {}; if (!a.url && !a.turl) return "";
          return `<button data-pk="msgmedia" data-i="${push(r)}"><img src="${esc(fileUrl(r.message.kind === "gif" ? a.url : a.turl || a.url))}" alt="" loading="lazy"></button>`;
        }).join("")}</div>`;
      } else if (tab === "files") {
        html = d.msgs.map((r) => {
          const a = r.message.att || {}, ext = ((a.name || "").split(".").pop() || "FILE").slice(0, 4).toUpperCase();
          return `<button class="sr-file" data-pk="msgfile" data-i="${push(r)}"><span class="fi">${esc(ext)}</span><span class="tx" style="min-width:0;flex:1"><b style="display:block;font-size:15.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${Search.hl(a.name || T("Файл"), q)}</b><small style="color:var(--dim)">${esc(fmtSize(a.size || 0))} · ${esc(dispName(r.peer))} · ${esc(listTime(r.message.ts))}</small></span></button>`;
        }).join("");
      } else if (tab === "links") {
        html = d.msgs.map((r) => {
          const m = r.message, u = (/(https?:\/\/[^\s]+|www\.[^\s]+|t\.me\/[^\s]+)/i.exec(m.text || "") || [""])[0];
          return `<button class="sr-row" data-pk="msglink" data-i="${push(r)}"><span class="av def" style="background:var(--accent)">${SI.link}</span><span class="tx"><b style="color:var(--accent)">${esc(u.replace(/^https?:\/\//, ""))}</b><small>${esc(dispName(r.peer))} · ${esc(listTime(m.ts))}</small></span></button>`;
        }).join("");
      } else {
        html = d.msgs.map((r) => {
          const m = r.message, t = m.kind === "text" || !m.kind ? m.text : Rich.preview(m);
          let snip = String(t || "").replace(/\s+/g, " ");
          const i = snip.toLowerCase().indexOf(ql);
          if (i > 28) snip = "…" + snip.slice(i - 20);
          return `<button class="sr-row" data-pk="msg" data-i="${push(r)}">${avatar(r.peer)}<span class="tx"><b>${nameHTML(r.peer)}</b><small>${Search.hl(snip, q)}</small></span><span class="tm">${esc(listTime(m.ts))}</span></button>`;
        }).join("");
      }
    }
    body.innerHTML = html;
    // «недавние»: рядом с каждой строкой — крестик
    body.querySelectorAll(".sr-row-w").forEach((w) => {
      const b = w.querySelector(".sr-row"); if (!b) return;
      const id = Search.items[+b.dataset.i] && Search.items[+b.dataset.i].id;
      w.style.cssText = "display:flex;align-items:center";
      b.style.flex = "1"; b.style.minWidth = "0";
      w.insertAdjacentHTML("beforeend", `<button class="x sr-x" data-rm="${id}" aria-label="${esc(T("Убрать"))}" style="width:44px;height:44px;display:grid;place-items:center;color:var(--dim)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`);
    });
  },

  // ───────────── выбор результата ─────────────
  async pick(kind, i) {
    const it = Search.items[+i]; if (!it) return;
    haptic();
    if (kind === "peer") {
      let p = it;
      Search.remember(p);
      const mine = Chats.byId(p.id);
      if (mine) p = mine.peer;
      if (p.gk && !p.role && !mine) return Groups.joinPreview(p.username);      // публичный чат, в котором ещё не состоите
      return Chats.openChat(p);
    }
    if (kind === "msgmedia") { const a = it.message.att || {}; return Viewer.open(a); }
    if (kind === "msgfile") { const a = it.message.att || {}; return FV.open(a); }
    if (kind === "msglink") { const u = (/(https?:\/\/[^\s]+|www\.[^\s]+|t\.me\/[^\s]+)/i.exec(it.message.text || "") || [""])[0]; if (u) Browser.open(/^https?:/i.test(u) ? u : "https://" + u); return; }
    if (kind === "msg") {
      const p = (Chats.byId(it.peer.id) || { peer: it.peer }).peer, id = it.message.id;
      await Chats.openChat(p);
      setTimeout(() => { try { Chat.jumpTo(id); } catch (e) {} }, 380);
    }
  },
};
