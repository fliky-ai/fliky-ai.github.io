// search.js — поиск на весь экран, как в Telegram:
//   • открывается плавно, поле ввода с анимацией (лупа ↔ индикатор поиска, крестик «выезжает»), вкладки со скользящим подчёркиванием;
//   • «Все», «Люди», «Группы», «Каналы», «Сообщения», «Медиа», «Ссылки», «Файлы»;
//   • мгновенная выдача: свои чаты и контакты находятся на каждую букву сразу, глобальный поиск и сообщения подгружаются следом
//     (пока грузятся — аккуратные «скелетоны», а не мигание);
//   • история: недавние запросы (чипы) и недавно открытые из поиска люди/чаты — каждую часть можно очистить целиком или по одной;
//   • у строки — аватарка, имя с галочкой, @username, «в сети»/число участников; найденный текст подсвечен.
// Цвета берутся из темы: светлая тема — светлый поиск, тёмная — тёмный.
const SRI = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
};

const Search = {
  el: null, tab: "all", q: "", timer: 0, items: [], sig: "", cache: {}, seq: 0,
  TABS: [["all", "Все"], ["people", "Люди"], ["groups", "Группы"], ["channels", "Каналы"], ["messages", "Сообщения"], ["media", "Медиа"], ["links", "Ссылки"], ["files", "Файлы"]],
  LINK: /(https?:\/\/[^\s]+|www\.[^\s]+|t\.me\/[^\s]+)/i,

  norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/ё/g, "е"); },

  open(tab) {
    if (Search.el) return;
    Search.tab = Search.TABS.some((t) => t[0] === tab) ? tab : "all"; Search.q = ""; Search.cache = {}; Search.sig = ""; Search.seq = 0; Search.lastTab = null; Search.lastNq = null; Search.lastHad = false; Search.lastQ = null; Search.wasSk = false;
    const el = (Search.el = document.createElement("section"));
    el.id = "search"; el.className = "page tgp srx"; el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<header class="srx-head">
        <button class="srx-back" data-back aria-label="${esc(T("Назад"))}">${SRI.back}</button>
        <label class="srx-field"><span class="srx-ico"><i class="s1">${SRI.search}</i><i class="s2"></i></span>
          <input id="sr-q" placeholder="${esc(T("Поиск"))}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
          <button class="clear srx-clear" type="button" data-clear aria-label="${esc(T("Очистить"))}">${SRI.x}</button></label>
      </header>
      <div class="srx-tabs"><div class="srx-tin" role="tablist">${Search.TABS.map(([k, n]) => `<button class="sr-tab${k === Search.tab ? " on" : ""}" data-t="${k}" role="tab">${esc(T(n))}</button>`).join("")}<i class="srx-ind"></i></div></div>
      <div class="sr-body" id="sr-body"></div>`;
    document.body.appendChild(el);
    void el.offsetWidth;
    Nav.open("search", () => { Search.el = null; clearTimeout(Search.timer); setTimeout(() => el.remove(), 360); });
    const inp = el.querySelector("#sr-q");
    inp.addEventListener("input", () => {
      Search.q = inp.value.trim().replace(/^@/, "");
      el.querySelector("[data-clear]").classList.toggle("on", !!inp.value);
      Search.draw();                                                         // свои чаты и контакты — сразу, на каждую букву
      clearTimeout(Search.timer);
      Search.timer = setTimeout(() => Search.run(), 170);                    // сеть — с короткой паузой
    });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(Search.timer); Search.run(); if (Search.q.length >= 2) Search.remember(Search.q); inp.blur(); } });
    el.addEventListener("click", (e) => Search.click(e));
    Search.ind(false); Search.draw(); Search.run();
    setTimeout(() => { try { inp.focus(); } catch (e) {} }, 300);
  },

  close() { if (Search.el) Nav.back(); },

  // скользящее подчёркивание вкладок
  ind(anim) {
    const el = Search.el; if (!el) return;
    const on = el.querySelector(".sr-tab.on"), tin = el.querySelector(".srx-tin"), ind = el.querySelector(".srx-ind");
    if (!on || !ind) return;
    ind.style.transition = anim ? "" : "none";
    tin.style.setProperty("--ix", on.offsetLeft + 10 + "px"); tin.style.setProperty("--iw", Math.max(10, on.offsetWidth - 20) + "px");
    if (!anim) { void ind.offsetWidth; ind.style.transition = ""; }
  },

  click(e) {
    const el = Search.el; if (!el) return;
    if (e.target.closest("[data-back]")) return Search.close();
    if (e.target.closest("[data-clear]")) { const i = el.querySelector("#sr-q"); i.value = ""; i.dispatchEvent(new Event("input")); i.focus(); return; }
    const tb = e.target.closest(".sr-tab");
    if (tb) return Search.setTab(tb.dataset.t);
    const all = e.target.closest("[data-all]");
    if (all) return Search.setTab(all.dataset.all);
    const rm = e.target.closest("[data-rm]");
    if (rm) { e.stopPropagation(); Search.forget(+rm.dataset.rm); return; }
    const rq = e.target.closest("[data-rq]");
    if (rq) { e.stopPropagation(); Prefs.set("recent_q", Search.recentQ().filter((x) => x !== rq.dataset.rq)); Search.draw(); return; }
    if (e.target.closest("[data-clrq]")) { haptic(); Prefs.set("recent_q", []); Search.draw(); return; }
    if (e.target.closest("[data-clr]")) { haptic(); Prefs.set("recent_peers", []); Search.draw(); return; }
    const ch = e.target.closest("[data-q]");
    if (ch) { const i = el.querySelector("#sr-q"); i.value = ch.dataset.q; i.dispatchEvent(new Event("input")); clearTimeout(Search.timer); Search.run(); haptic(); return; }
    const it = e.target.closest("[data-pk]");
    if (it) return Search.pick(it.dataset.pk, it.dataset.i);
  },
  setTab(t) {
    const el = Search.el; if (!el || t === Search.tab) return;
    Search.tab = t; haptic();
    el.querySelectorAll(".sr-tab").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    try { el.querySelector(".sr-tab.on").scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" }); } catch (er) {}
    Search.ind(true); Search.draw(); Search.run();
  },

  // ───────────── запросы к серверу (с кэшем, повторные не шлём) ─────────────
  need() {                          // что нужно загрузить для текущей вкладки: [{key, kind}]
    const q = Search.q, t = Search.tab, L = [];
    if (t === "all" || t === "people" || t === "groups" || t === "channels") { if (q.length >= 2) L.push({ key: "g|" + q, url: "/api/search?q=" + encodeURIComponent(q), pick: (d) => ({ users: d.users || [], chats: d.chats || [] }) }); }
    if (t === "all" && q.length >= 2) L.push({ key: "m|all|" + q, url: "/api/search/messages?kind=all&q=" + encodeURIComponent(q), pick: (d) => ({ msgs: d.messages || [] }) });
    if (t === "messages" && q.length >= 2) L.push({ key: "m|all|" + q, url: "/api/search/messages?kind=all&q=" + encodeURIComponent(q), pick: (d) => ({ msgs: d.messages || [] }) });
    if (t === "media" || t === "files" || t === "links") { const kind = t === "media" ? "media" : t === "files" ? "file" : "link"; L.push({ key: "m|" + kind + "|" + q, url: "/api/search/messages?kind=" + kind + "&q=" + encodeURIComponent(q), pick: (d) => ({ msgs: d.messages || [] }) }); }
    return L;
  },
  async run() {
    const my = ++Search.seq;
    for (const r of Search.need()) {
      if (Search.cache[r.key]) continue;
      Search.cache[r.key] = { busy: true };
      api(r.url).then((d) => { Search.cache[r.key] = { data: r.pick(d) }; }).catch((e) => { Search.cache[r.key] = { err: e.message || T("Не удалось выполнить поиск") }; })
        .then(() => { if (Search.el && my >= 0) Search.draw(); });
    }
    Search.draw();
  },
  get(key) { return Search.cache[key] || null; },
  busyNow() { return Search.need().some((r) => { const c = Search.cache[r.key]; return !c || c.busy; }); },

  // ───────────── вспомогательное ─────────────
  hl(text, q) {
    const t = String(text || ""); if (!q) return esc(t);
    const i = Search.norm(t).indexOf(Search.norm(q));
    if (i < 0) return esc(t);
    return esc(t.slice(0, i)) + "<mark>" + esc(t.slice(i, i + q.length)) + "</mark>" + esc(t.slice(i + q.length));
  },
  recent() { const a = Prefs.get("recent_peers", []); return Array.isArray(a) ? a : []; },
  recentQ() { const a = Prefs.get("recent_q", []); return Array.isArray(a) ? a.filter((x) => typeof x === "string") : []; },
  remember(p) {
    if (typeof p === "string") {                                          // запрос
      const q = p.trim(); if (q.length < 2) return;
      Prefs.set("recent_q", [q].concat(Search.recentQ().filter((x) => Search.norm(x) !== Search.norm(q))).slice(0, 10)); return;
    }
    if (!p || !p.id) return;
    const o = { id: p.id, name: p.name || "", surname: p.surname || "", username: p.username || "", avatar: p.avatar || "", gk: p.gk || undefined, members: p.members, is_system: p.is_system ? 1 : 0, premium: p.premium ? 1 : 0, verified: p.verified ? 1 : 0 };
    const a = Search.recent().filter((x) => x.id !== p.id); a.unshift(o);
    Prefs.set("recent_peers", a.slice(0, 12));
  },
  forget(id) { Prefs.set("recent_peers", Search.recent().filter((x) => x.id !== id)); Search.draw(); },

  // свои собеседники, группы, каналы и контакты
  locals() {
    const seen = new Set(), L = [];
    const add = (p) => { if (p && p.id && !seen.has(p.id) && !p.saved) { seen.add(p.id); L.push(p); } };
    (Chats.list || []).forEach((c) => add(c.peer));
    try { (Contacts.cache || []).forEach(add); } catch (e) {}
    return L;
  },
  matches(p, q) {
    const ql = Search.norm(q); if (!ql) return false;
    const hay = Search.norm(dispName(p) + " " + (p.name || "") + " " + (p.surname || "") + " " + (p.username || ""));
    if (hay.includes(ql)) return true;
    const dg = ql.replace(/\D/g, ""); return dg.length >= 3 && String(p.number || "").replace(/\D/g, "").includes(dg);
  },
  sub(p, q) {
    const parts = [];
    if (p.username) parts.push("@" + Search.hl(p.username, q));
    const st = statusText(p);
    if (st && (!p.username || p.gk || p.online)) parts.push(`<span class="${p.online && !p.gk ? "on" : ""}">${esc(st)}</span>`);
    return parts.join(" · ");
  },
  peerRow(p, i, pk, q) {
    return `<div class="sr-rw" style="--i:${Math.min(i,8)}"><button class="sr-row" data-pk="${pk}" data-i="${i}">${avatar(p)}<span class="tx"><b>${Search.hlName(p, q)}</b><small>${Search.sub(p, q)}</small></span></button></div>`;
  },
  hlName(p, q) {
    const n = dispName(p), i = q ? Search.norm(n).indexOf(Search.norm(q)) : -1;
    const base = i < 0 ? esc(n) : esc(n.slice(0, i)) + "<mark>" + esc(n.slice(i, i + q.length)) + "</mark>" + esc(n.slice(i + q.length));
    return base + verBadge(p) + nbadge(p);
  },
  sect(title, extra) { return `<div class="sr-sect"><span>${esc(T(title))}</span>${extra || ""}</div>`; },
  skel(n, tail) { return `<div class="srx-sk${tail ? " tail" : ""}" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<div class="srx-sr" style="--i:${Math.min(i,8)}"><i class="a"></i><span><i class="l1" style="width:${52 + (i * 17) % 30}%"></i><i class="l2" style="width:${34 + (i * 23) % 36}%"></i></span></div>`).join("")}</div>`; },
  none(hint) {
    const q = Search.q;
    return `<div class="sr-none">${ILL.none}<h3>${esc(T("Нет результатов"))}</h3><p>${esc(hint || (q ? T("По запросу «{0}» ничего не найдено.", q) : T("Здесь пока пусто.")))}${q && !hint ? " " + esc(T("Проверьте имя или попробуйте другой запрос.")) : ""}</p></div>`;
  },
  hint(h, p) { return `<div class="sr-none">${ILL.none}<h3>${esc(T(h))}</h3><p>${esc(T(p))}</p></div>`; },

  // ───────────── отрисовка ─────────────
  draw() {
    const el = Search.el; if (!el) return;
    const body = el.querySelector("#sr-body"), tab = Search.tab, q = Search.q;
    Search.items = [];
    const push = (x) => Search.items.push(x) - 1;
    const busy = Search.busyNow();
    el.querySelector(".srx-field").classList.toggle("busy", busy && q.length >= 2);
    let html = "";
    const pRows = (list, pk = "peer") => list.map((p) => Search.peerRow(p, push(p), pk, q)).join("");
    const loc = (want) => q ? Search.locals().filter((p) => want(p) && Search.matches(p, q)) : [];
    const isUser = (p) => !p.gk && !p.is_system;
    const isGrp = (p) => p.gk === "group", isCh = (p) => p.gk === "channel";
    const gData = () => { const c = Search.get("g|" + q); return c && c.data; };
    const globalOf = (want) => {
      const d = gData(); if (!d) return [];
      const have = new Set(Search.locals().map((p) => p.id));
      const me = App.user && App.user.id;
      return d.users.filter((u) => want(u) && !have.has(u.id) && u.id !== me).concat(d.chats.filter((c) => want(c) && !have.has(c.id)));
    };
    const gState = () => Search.get("g|" + q);

    if (tab === "all" || tab === "people" || tab === "groups" || tab === "channels") {
      const want = tab === "all" ? () => true : tab === "people" ? isUser : tab === "groups" ? isGrp : isCh;
      if (!q) {
        const rq = Search.recentQ(), rec = Search.recent().filter(want);
        if (tab === "all" || tab === "people") {
          const top = Chats.sorted().filter((c) => !c.peer.gk && !c.peer.is_system && !c.peer.saved).slice(0, 10);
          if (top.length) html += Search.sect("Люди") + `<div class="sr-people">${top.map((c) => `<button class="sr-p" data-pk="peer" data-i="${push(c.peer)}">${avatar(c.peer)}<span class="n">${esc(c.peer.name || dispName(c.peer))}</span></button>`).join("")}</div>`;
        }
        if (rq.length) html += Search.sect("Недавние запросы", `<button data-clrq>${esc(T("Очистить"))}</button>`) + `<div class="srx-chips">${rq.map((x, i) => `<span class="srx-chip" style="--i:${Math.min(i,8)}"><button class="t" data-q="${esc(x)}">${SRI.clock}<span>${esc(x)}</span></button><button class="x" data-rq="${esc(x)}" aria-label="${esc(T("Убрать"))}">${SRI.x}</button></span>`).join("")}</div>`;
        if (rec.length) html += Search.sect("Недавние", `<button data-clr>${esc(T("Очистить"))}</button>`) + rec.map((p) => `<div class="sr-rw" style="--i:${Math.min(push(p),8)}"><button class="sr-row" data-pk="peer" data-i="${Search.items.length - 1}">${avatar(p)}<span class="tx"><b>${Search.hlName(p, "")}</b><small>${Search.sub(p, "")}</small></span></button><button class="x sr-x" data-rm="${p.id}" aria-label="${esc(T("Убрать"))}">${SRI.x}</button></div>`).join("");
        if (tab === "groups" || tab === "channels") {
          const mine = Chats.list.filter((c) => want(c.peer));
          html += mine.length ? Search.sect(tab === "channels" ? "Мои каналы" : "Мои группы") + pRows(mine.map((c) => c.peer))
            : Search.hint(tab === "channels" ? "Каналов пока нет" : "Групп пока нет", "Введите название или адрес, чтобы найти публичные.");
        } else if (!html) html = Search.hint("Поиск", "Введите имя, @username, номер или название группы или канала.");
      } else {
        const L = loc(want), G = globalOf(want), gs = gState();
        if (L.length) html += Search.sect(tab === "all" ? "Чаты и контакты" : tab === "people" ? "Люди" : tab === "groups" ? "Группы" : "Каналы") + pRows(L.slice(0, tab === "all" ? 8 : 60));
        if (G.length) html += Search.sect("Глобальный поиск") + pRows(G.slice(0, tab === "all" ? 8 : 60));
        if (tab === "all" && q.length >= 2) {
          const mc = Search.get("m|all|" + q), ms = mc && mc.data && mc.data.msgs || [];
          if (ms.length) html += Search.sect("Сообщения", ms.length > 3 ? `<button data-all="messages">${esc(T("Все"))} ${SRI.chev}</button>` : "") + ms.slice(0, 3).map((r) => Search.msgRow(r, push(r), q)).join("");
          else if (mc && mc.busy && !L.length && !G.length) { /* скелетоны ниже */ }
        }
        const stillBusy = q.length >= 2 && busy;
        if (!html) html = q.length < 2 ? `<div class="sr-none"><p>${esc(T("Введите хотя бы два символа"))}</p></div>` : stillBusy ? Search.skel(6) : Search.none();
        else if (stillBusy) html += Search.skel(2, true);
        if (gs && gs.err && !L.length && !G.length) html = `<div class="sr-none"><p>${esc(gs.err)}</p></div>`;
      }
    } else {
      const key = tab === "messages" ? "m|all|" + q : tab === "media" ? "m|media|" + q : tab === "files" ? "m|file|" + q : "m|link|" + q;
      const c = Search.get(key), d = c && c.data;
      if (tab === "messages" && q.length < 2) {
        const rq = Search.recentQ();
        html = Search.hint("Поиск по сообщениям", "Введите текст, который нужно найти в ваших чатах.");
        if (rq.length) html = Search.sect("Недавние запросы", `<button data-clrq>${esc(T("Очистить"))}</button>`) + `<div class="srx-chips">${rq.map((x, i) => `<span class="srx-chip" style="--i:${Math.min(i,8)}"><button class="t" data-q="${esc(x)}">${SRI.clock}<span>${esc(x)}</span></button><button class="x" data-rq="${esc(x)}" aria-label="${esc(T("Убрать"))}">${SRI.x}</button></span>`).join("")}</div>` + html;
      } else if (!d) html = c && c.err ? `<div class="sr-none"><p>${esc(c.err)}</p></div>` : Search.skel(7);
      else if (!d.msgs.length) html = Search.none(tab === "media" ? T("Фото и видео пока нет.") : tab === "files" ? T("Файлов пока нет.") : tab === "links" ? T("Ссылок пока нет.") : "");
      else if (tab === "media") {
        html = `<div class="sr-media">${d.msgs.map((r) => {
          const a = r.message.att || {}; if (!a.url && !a.turl) return "";
          return `<button data-pk="msgmedia" data-i="${push(r)}"><img src="${esc(fileUrl(r.message.kind === "gif" ? a.url : a.turl || a.url))}" alt="" loading="lazy"></button>`;
        }).join("")}</div>`;
      } else if (tab === "files") {
        html = d.msgs.map((r) => {
          const a = r.message.att || {}, ext = ((a.name || "").split(".").pop() || "FILE").slice(0, 4).toUpperCase(), i = push(r);
          return `<div class="sr-rw" style="--i:${Math.min(i,8)}"><button class="sr-file" data-pk="msgfile" data-i="${i}"><span class="fi">${esc(ext)}</span><span class="tx"><b>${Search.hl(a.name || T("Файл"), q)}</b><small>${esc(fmtSize(a.size || 0))} · ${esc(dispName(r.peer))} · ${esc(listTime(r.message.ts))}</small></span></button></div>`;
        }).join("");
      } else if (tab === "links") {
        html = d.msgs.map((r) => {
          const m = r.message, u = (Search.LINK.exec(m.text || "") || [""])[0], i = push(r);
          return `<div class="sr-rw" style="--i:${Math.min(i,8)}"><button class="sr-row" data-pk="msglink" data-i="${i}"><span class="av def srx-lk">${SI.link}</span><span class="tx"><b class="lk">${Search.hl(u.replace(/^https?:\/\//, ""), q)}</b><small>${esc(dispName(r.peer))} · ${esc(listTime(m.ts))}</small></span></button></div>`;
        }).join("");
      } else html = d.msgs.map((r) => Search.msgRow(r, push(r), q)).join("");
    }
    // Анимацию показываем только когда экран реально «сменился» (другая вкладка, пустое ↔ с запросом, пришли первые строки):
    // при наборе текста строки обновляются молча — без мигания. Скелетоны не перерисовываем, если они уже на экране.
    const skOnly = html.indexOf('class="srx-sk"') === 0 && html.indexOf("sr-rw") < 0;
    if (skOnly && Search.wasSk && Search.lastTab === tab) return;
    const had = Search.items.length > 0, nq = !q;
    const fresh = tab !== Search.lastTab || nq !== Search.lastNq || (!Search.lastHad && had);
    const reset = tab !== Search.lastTab || q !== Search.lastQ;
    Search.wasSk = skOnly; Search.lastTab = tab; Search.lastNq = nq; Search.lastHad = had; Search.lastQ = q;
    const top = body.scrollTop;
    body.classList.toggle("anim", fresh);
    body.innerHTML = html;
    body.scrollTop = reset ? 0 : top;
  },
  msgRow(r, i, q) {
    const m = r.message, t = m.kind === "text" || !m.kind ? m.text : Rich.preview(m), ql = Search.norm(q);
    let snip = String(t || "").replace(/\s+/g, " ");
    const k = Search.norm(snip).indexOf(ql);
    if (k > 26) snip = "…" + snip.slice(k - 18);
    return `<div class="sr-rw" style="--i:${Math.min(i,8)}"><button class="sr-row sr-msg" data-pk="msg" data-i="${i}">${avatar(r.peer)}<span class="tx"><span class="l1"><b>${nameHTML(r.peer)}</b><i class="tm">${esc(listTime(m.ts))}</i></span><small>${Search.hl(snip, q)}</small></span></button></div>`;
  },

  // ───────────── выбор результата ─────────────
  async pick(kind, i) {
    const it = Search.items[+i]; if (!it) return;
    haptic();
    if (Search.q.length >= 2) Search.remember(Search.q);
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
    if (kind === "msglink") { const u = (Search.LINK.exec(it.message.text || "") || [""])[0]; if (u) Browser.open(/^https?:/i.test(u) ? u : "https://" + u); return; }
    if (kind === "msg") {
      const p = (Chats.byId(it.peer.id) || { peer: it.peer }).peer, id = it.message.id;
      await Chats.openChat(p);
      setTimeout(() => { try { Chat.jumpTo(id); } catch (e) {} }, 380);
    }
  },
};
