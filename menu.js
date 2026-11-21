// menu.js — меню сообщения как в Telegram (панель реакций + список действий над размытым фоном) и выбор чата для пересылки.
const REACT_QUICK = ["❤️", "👍", "👎", "🔥", "😁", "😢", "🎉"];
const REACT_ALL = ["👍", "👎", "❤️", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "😱", "😢", "🎉", "🤩", "🙏", "👌", "😍", "🤣", "💯", "😎", "🥳", "😭", "😡", "🤮", "💩", "🤡", "🖕", "🥱", "😴", "👀", "🙈", "😇", "😨", "🤝", "💔", "🤨", "😐", "🍓", "🍾", "💋", "😈", "🤓", "👻", "🫡", "🗿", "🤪", "⚡", "🏆", "🌚", "🐳", "🦄", "😘", "👨‍💻", "🎃", "🤷", "🤗", "🥴", "🍌", "🌭", "🆒", "💘", "🙉", "🙊", "😅", "😏", "😬", "🤭", "🥺", "🤤", "😤"];

const MIC = {
  who: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14a4 4 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/>'),
  reply: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v3"/>'),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
  fwd: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0-6 6v3"/>'),
  pin: svg('<path d="M12 17v5"/><path d="M9 4h6l-1 6 3 3H7l3-3z"/>'),
  unpin: svg('<path d="M12 17v5"/><path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M3 3l18 18"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  del: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>'),
  stk: svg('<path d="M20.5 12.5V8a4.5 4.5 0 0 0-4.5-4.5H8A4.5 4.5 0 0 0 3.5 8v8A4.5 4.5 0 0 0 8 20.5h4.5z"/><path d="M20.5 12.5a8 8 0 0 0-8 8"/>'),
  dl: svg('<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>'),
  save: svg('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 7v7"/><path d="m9 11.5 3 3 3-3"/><path d="M10.5 18.5h3"/>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  pres: svg('<path d="M5 20V11M12 20V4M19 20v-6"/>'),
  pclose: svg('<circle cx="12" cy="12" r="9"/><rect x="9" y="9" width="6" height="6" rx="1.5"/>'),
  more: svg('<path d="m6 9 6 6 6-6"/>'),
};

const MsgMenu = {
  ov: null, release: null, born: 0, guard: 0,

  items(m) {
    const mine = m.sender === App.user.id, k = m.kind || "text", a = m.att || {};
    const p = Chat.peer || {}, gk = p.gk, R = p.rights || {}, P = p.perms || {};
    const canWrite = !gk || !!p.post;
    const canPin = !gk || !!(R.pin || (gk === "group" && P.pin));
    const delOther = !!(gk && R.delete), editOther = gk === "channel" && !!R.edit;
    const L = [];
    if (k === "call") { L.push(["del", "Удалить"]); return L; }
    if (m.id && m.reacts && m.reacts.length && k !== "call") L.push(["who", T("Реакции") + " · " + m.reacts.reduce((a, r) => a + (r.n || 0), 0)]);
    if (m.id && canWrite) L.push(["reply", "Ответить"]);
    if (k === "poll" && m.id && m.poll && !m.pending) L.push(["pres", T("Результаты")]);
    if (m.text) L.push(["copy", "Копировать"]);
    if (m.id) L.push(["forward", "Переслать"]);
    if (m.id && gk) L.push(["link", "Копировать ссылку"]);
    if (m.id && canPin) L.push([m.pin ? "unpin" : "pin", m.pin ? "Открепить" : "Закрепить"]);
    if (k === "poll" && Poll.canClose(m)) L.push(["pclose", T("Завершить опрос")]);
    if (m.id && (mine || editOther) && (k === "text" || k === "photo" || k === "gif" || k === "file")) L.push(["edit", "Изменить"]);
    if (k === "sticker" && a.fid) L.push(["stk", "Добавить в мои стикеры"]);
    if (k === "gif" && a.fid) L.push(["gif", "Сохранить GIF"]);
    if ((k === "photo" || k === "file" || k === "voice" || k === "gif") && a.url && !m.pending) { L.push(["dl", "Скачать"]); L.push(["save", "Сохранить на телефон"]); }
    if (!gk || mine || delOther) L.push(["del", "Удалить"]);
    return L;
  },

  open(el, m, byTouch) {
    if (!m || MsgMenu.ov) return;
    haptic("medium");
    Editor.hideTb();
    try { document.activeElement && document.activeElement.blur && document.activeElement.blur(); } catch (e) {}
    const rc = el.getBoundingClientRect(), mine = m.sender === App.user.id;
    const vh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--vh")) || innerHeight, vw = innerWidth;
    const ov = (MsgMenu.ov = document.createElement("div"));
    ov.className = "mm";
    MsgMenu.born = byTouch ? Date.now() : 0;      // только при открытии пальцем: поднятие пальца даёт «хвостовой» клик
    MsgMenu.guard = 0;
    const pr = Chat.peer || {}, rmode = pr.gk ? pr.react_mode || "all" : "all";
    const canReact = !!m.id && rmode !== "none" && (m.kind || "text") !== "call" && (m.kind || "text") !== "gift";
    const RX = canReact ? React.menuHTML(m, pr) : { bar: "", grid: "" };
    if (canReact && App.user && App.user.premium) React.loadSets().then(() => { const g = ov.querySelector(".mm-grid"); if (g && ov.isConnected && !ov.classList.contains("expanded")) { const h = React.menuHTML(m, pr).grid; const t = document.createElement("div"); t.innerHTML = h; g.innerHTML = t.firstChild.innerHTML; } });
    ov.innerHTML = `${RX.bar}${RX.grid}
      <div class="mm-clone"></div>
      <div class="mm-menu">${MsgMenu.items(m).map(([a, t]) => `<button data-a="${a}" class="${a === "del" ? "danger" : ""}">${MIC[a === "forward" ? "fwd" : a] || ""}<span>${t}</span></button>`).join("")}</div>`;
    document.body.appendChild(ov);

    const bar = ov.querySelector(".mm-react"), grid = ov.querySelector(".mm-grid"), clone = ov.querySelector(".mm-clone"), menu = ov.querySelector(".mm-menu");
    const cs = getComputedStyle(document.documentElement);
    const safeT = parseFloat(cs.getPropertyValue("--safe-t")) || 0, safeB = parseFloat(cs.getPropertyValue("--safe-b")) || 0;
    const gap = 8, M = 8, top0 = safeT + M, bot0 = vh - safeB - M;
    // копия сообщения лежит ровно поверх настоящего (оно на время меню скрыто) — для сообщений любой высоты, в том числе фото
    const c = el.cloneNode(true);
    c.classList.remove("new", "swiping", "hl", "mm-hid"); c.style.transform = ""; c.style.visibility = "";
    c.querySelectorAll("video,audio").forEach((v) => { try { v.pause(); v.removeAttribute("autoplay"); } catch (e) {} });
    clone.appendChild(c);
    clone.style.width = rc.width + "px"; clone.style.left = rc.left + "px"; clone.style.top = rc.top + "px";
    el.classList.add("mm-hid"); MsgMenu.src = el;

    // ── где разместить панель реакций и список действий (меню само считает границы экрана) ──
    const barH = bar ? bar.offsetHeight : 0, menuH = menu.offsetHeight, needBar = barH ? barH + gap : 0, needMenu = menuH + gap;
    const above = rc.top - top0, below = bot0 - rc.bottom;
    let barY = 0, menuY = 0, dy = 0, up = false;        // up — список открывается выше сообщения
    if (above >= needBar && below >= needMenu) { barY = rc.top - needBar; menuY = rc.bottom + gap; }                  // реакции сверху, действия снизу
    else if (below >= needBar + needMenu) { barY = rc.bottom + gap; menuY = barY + needBar; }                       // сообщение у верха: всё ниже него
    else if (above >= needBar + needMenu) { up = true; menuY = rc.top - gap - menuH; barY = menuY - needBar; }   // сообщение внизу: всё выше него
    else {
      const T = needBar + rc.height + needMenu;
      if (T <= bot0 - top0) {                            // помещается целиком, если чуть сдвинуть сообщение — сдвигаем плавно
        const st = clamp(rc.top - needBar, top0, bot0 - T);
        dy = st + needBar - rc.top; barY = st; menuY = st + needBar + rc.height + gap;
        if (!barH) menuY = st + rc.height + gap;
      } else {                                           // очень высокое сообщение: панели ложатся поверх него, ближе к пальцу
        const blockH = needBar + menuH, ty = Chat.touchY > 0 ? Chat.touchY : (rc.top + rc.bottom) / 2;
        const st = clamp(ty > vh / 2 ? ty - blockH - 24 : ty + 24, top0, bot0 - blockH);
        barY = st; menuY = st + needBar;
      }
    }
    if (bar) bar.style.top = barY + "px";
    menu.style.top = menuY + "px";
    if (grid) grid.style.top = clamp(Math.min(barY, menuY), top0, Math.max(top0, bot0 - Math.min(grid.offsetHeight || 340, vh * 0.54))) + "px";
    clone.style.setProperty("--dy", dy + "px");

    // по горизонтали выравниваем по стороне пузыря и не даём выйти за экран
    const side = (node, w) => {
      const x = mine ? Math.min(rc.right, vw - M) - w : Math.max(rc.left, M);
      node.style.left = clamp(x, M, Math.max(M, vw - w - M)) + "px";
    };
    if (bar) { bar.style.maxWidth = vw - 2 * M + "px"; side(bar, Math.min(bar.offsetWidth, vw - 2 * M)); }
    menu.style.maxWidth = vw - 2 * M + "px"; side(menu, Math.min(menu.offsetWidth, vw - 2 * M));
    if (grid) { const gw = Math.min(348, vw - 2 * M); grid.style.width = gw + "px"; side(grid, gw); }
    const ox = mine ? "right" : "left";
    if (bar) bar.style.transformOrigin = ox + (barY < rc.top ? " bottom" : " top");
    menu.style.transformOrigin = ox + (up ? " bottom" : " top");
    if (grid) grid.style.transformOrigin = ox + " top";

    requestAnimationFrame(() => ov.classList.add("show"));
    MsgMenu.release = Nav.layer(() => MsgMenu.hide());

    ov.addEventListener("click", (e) => {
      // клик, которым заканчивается долгое нажатие (палец поднят над меню), не должен его закрывать
      const age = Date.now() - Math.max(MsgMenu.born, MsgMenu.guard);
      if (age < (e.target.closest(".mm-menu, .mm-react, .mm-grid") ? 180 : 450)) return;
      const more = e.target.closest("[data-more]");
      if (more) {
        grid.style.transformOrigin = (mine ? "right" : "left") + " top";
        ov.classList.add("expanded"); bar.classList.add("hidden"); menu.classList.add("hidden"); grid.classList.remove("hidden"); if (clone) clone.classList.add("dim"); return;
      }
      if (e.target.closest("[data-prem]")) { MsgMenu.close(); return setTimeout(() => PremiumPromo.open(App.user), 220); }
      if (e.target.closest("[data-star]")) { MsgMenu.close(); return setTimeout(() => Stars2.react(m), 200); }
      const r = e.target.closest("[data-r]");
      if (r) {                                   // выбранная реакция «вырастает», затем меню закрывается и она вылетает к сообщению
        if (MsgMenu.picked) return;
        MsgMenu.picked = true; r.classList.add("pick"); haptic("light");
        return setTimeout(() => { MsgMenu.picked = false; MsgMenu.close(); Chat.react(m, r.dataset.r); }, 170);
      }
      const b = e.target.closest("[data-a]");
      if (b) { MsgMenu.close(); return Chat.act(b.dataset.a, m); }
      if (!e.target.closest(".mm-menu, .mm-react, .mm-grid")) MsgMenu.close();
    });
    ov.addEventListener("contextmenu", (e) => e.preventDefault());
    // «док»: эмодзи под пальцем/курсором увеличивается, соседние — чуть меньше (как в Telegram)
    if (bar) {
      const btns = [...bar.querySelectorAll("button:not(.mm-more)")];
      const mag = (x) => { for (const b of btns) { const r = b.getBoundingClientRect(), d = Math.abs(x - (r.left + r.width / 2)); b.style.setProperty("--mg", x == null ? 1 : Math.max(1, 1.5 - d / 70).toFixed(3)); } };
      bar.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" || e.buttons) mag(e.clientX); });
      bar.addEventListener("pointerleave", () => mag(null));
      bar.addEventListener("pointerup", () => mag(null));
    }
  },

  // закрыть: убираем запись в стеке «назад» — она сама вызовет hide()
  close(now) {
    if (!MsgMenu.ov) return;
    if (now) return MsgMenu.hide(true);
    MsgMenu.ov.classList.add("out");
    if (MsgMenu.release) MsgMenu.release(); else MsgMenu.hide();
  },
  hide(now) {
    const ov = MsgMenu.ov; if (!ov) return;
    MsgMenu.ov = null; MsgMenu.release = null;
    const src = MsgMenu.src; MsgMenu.src = null;
    ov.classList.remove("show"); ov.classList.add("out");
    const done = () => { ov.remove(); if (src) src.classList.remove("mm-hid"); };
    if (now) done(); else setTimeout(done, 200);
  },
};

// ───────────── пересылка ─────────────
const Fwd = {
  ids: [],
  open(ids) {
    Fwd.ids = ids;
    const el = document.createElement("div");
    el.className = "sheet2 fwd";
    el.innerHTML = `<div class="s2-card" role="dialog"><h3>Переслать</h3>
      <div class="search fwd-s"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="fwd-q" placeholder="Кому переслать?" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
      <div class="fwd-list" id="fwd-list"></div><div class="s2-btns"><button data-x class="s2-cancel">Отмена</button></div></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    const close = () => { el.classList.remove("show"); setTimeout(() => el.remove(), 200); };
    let found = [], tm = 0;
    const list = el.querySelector("#fwd-list");
    const row = (p, i, sub) => `<button class="row" data-i="${i}">${avatar(p)}<div class="main"><div class="top"><span class="name">${nameHTML(p)}</span></div><div class="bottom"><span class="prev">${esc(sub)}</span></div></div></button>`;
    let shown = [];
    const draw = () => {
      const q = el.querySelector("#fwd-q").value.trim().toLowerCase().replace(/^@/, "");
      const mine = Chats.list.map((c) => c.peer).filter((p) => !(p.gk && !p.post)).filter((p) => !q || (dispName(p) + " " + (p.username || "")).toLowerCase().includes(q));
      const have = new Set(mine.map((p) => p.id));
      shown = mine.concat(found.filter((u) => !have.has(u.id) && u.id !== App.user.id));
      list.innerHTML = shown.length ? shown.map((p, i) => row(p, i, p.gk ? statusText(p) : p.username ? "@" + p.username : statusText(p))).join("") : '<div class="pn-hint">Никого не найдено</div>';
    };
    draw();
    el.querySelector("#fwd-q").addEventListener("input", (e) => {
      draw();
      const q = e.target.value.trim().replace(/^@/, "");
      clearTimeout(tm); found = [];
      if (q.length >= 2) tm = setTimeout(async () => { try { found = (await api("/api/search?q=" + encodeURIComponent(q))).users; draw(); } catch (er) {} }, 250);
    });
    el.addEventListener("click", async (e) => {
      if (e.target === el || e.target.closest("[data-x]")) return close();
      const b = e.target.closest(".row"); if (!b) return;
      const p = shown[+b.dataset.i]; if (!p) return;
      close();
      try {
        await api("/api/forward", { method: "POST", body: { ids: Fwd.ids, to: p.id } });
        toast(T("Переслано · {0}", dispName(p)));
        Chats.load();
      } catch (er) { toast(er.message); }
    });
  },
};
