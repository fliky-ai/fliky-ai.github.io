// menu.js — меню сообщения как в Telegram (панель реакций + список действий над размытым фоном) и выбор чата для пересылки.
const REACT_QUICK = ["❤️", "👍", "👎", "🔥", "😁", "😢", "🎉"];
const REACT_ALL = ["👍", "👎", "❤️", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "😱", "😢", "🎉", "🤩", "🙏", "👌", "😍", "🤣", "💯", "😎", "🥳", "😭", "😡", "🤮", "💩", "🤡", "🥱", "😴", "👀", "🙈", "😇", "😨", "🤝", "💔", "🤨", "😐", "🍓", "🍾", "💋", "😈", "🤓", "👻", "🫡", "🗿", "🤪", "⚡", "🏆", "🌚", "🐳", "🦄", "😘", "👨‍💻", "🎃", "🤷", "🤗", "🥴", "🍌", "🌭", "🆒", "💘", "🙉", "🙊", "😅", "😏", "😬", "🤭", "🥺", "🤤", "😤"];

const MIC = {
  reply: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v3"/>'),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
  fwd: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0-6 6v3"/>'),
  pin: svg('<path d="M12 17v5"/><path d="M9 4h6l-1 6 3 3H7l3-3z"/>'),
  unpin: svg('<path d="M12 17v5"/><path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M3 3l18 18"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  del: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>'),
  stk: svg('<path d="M20.5 12.5V8a4.5 4.5 0 0 0-4.5-4.5H8A4.5 4.5 0 0 0 3.5 8v8A4.5 4.5 0 0 0 8 20.5h4.5z"/><path d="M20.5 12.5a8 8 0 0 0-8 8"/>'),
  dl: svg('<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>'),
  more: svg('<path d="m6 9 6 6 6-6"/>'),
};

const MsgMenu = {
  ov: null, release: null, born: 0, guard: 0,

  items(m) {
    const mine = m.sender === App.user.id, k = m.kind || "text", a = m.att || {};
    const L = [];
    if (m.id) L.push(["reply", "Ответить"]);
    if (m.text) L.push(["copy", "Копировать"]);
    if (m.id) L.push(["forward", "Переслать"]);
    if (m.id) L.push([m.pin ? "unpin" : "pin", m.pin ? "Открепить" : "Закрепить"]);
    if (m.id && mine && (k === "text" || k === "photo" || k === "gif" || k === "file")) L.push(["edit", "Изменить"]);
    if (k === "sticker" && a.fid) L.push(["stk", "Добавить в мои стикеры"]);
    if (k === "gif" && a.fid) L.push(["gif", "Сохранить GIF"]);
    if ((k === "photo" || k === "file" || k === "voice" || k === "gif") && a.url && !m.pending) L.push(["dl", "Скачать"]);
    L.push(["del", "Удалить"]);
    return L;
  },

  open(el, m, byTouch) {
    if (!m || MsgMenu.ov) return;
    haptic("medium");
    Editor.hideTb();
    try { document.activeElement && document.activeElement.blur && document.activeElement.blur(); } catch (e) {}
    const rc = el.getBoundingClientRect(), mine = m.sender === App.user.id;
    const vh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--vh")) || innerHeight, vw = innerWidth;
    const cur = (m.reacts || []).find((r) => r.mine);
    const ov = (MsgMenu.ov = document.createElement("div"));
    ov.className = "mm";
    MsgMenu.born = byTouch ? Date.now() : 0;      // только при открытии пальцем: поднятие пальца даёт «хвостовой» клик
    MsgMenu.guard = 0;
    const canReact = !!m.id;
    ov.innerHTML = `${canReact ? `<div class="mm-react">${REACT_QUICK.map((e, i) => `<button class="${cur && cur.e === e ? "on" : ""}" data-r="${e}" style="--i:${i}">${e}</button>`).join("")}<button class="mm-more" data-more aria-label="Ещё реакции">${MIC.more}</button></div>
      <div class="mm-grid hidden">${REACT_ALL.map((e) => `<button class="${cur && cur.e === e ? "on" : ""}" data-r="${e}">${e}</button>`).join("")}</div>` : ""}
      <div class="mm-clone"></div>
      <div class="mm-menu">${MsgMenu.items(m).map(([a, t]) => `<button data-a="${a}" class="${a === "del" ? "danger" : ""}">${MIC[a === "forward" ? "fwd" : a] || ""}<span>${t}</span></button>`).join("")}</div>`;
    document.body.appendChild(ov);

    const bar = ov.querySelector(".mm-react"), grid = ov.querySelector(".mm-grid"), clone = ov.querySelector(".mm-clone"), menu = ov.querySelector(".mm-menu");
    const gap = 8, barH = bar ? bar.offsetHeight : 0, menuH = menu.offsetHeight, safeT = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-t")) || 0;
    const showClone = rc.height <= vh * 0.42;
    if (showClone) {
      const c = el.cloneNode(true);
      c.classList.remove("new", "swiping", "hl"); c.style.transform = "";
      clone.appendChild(c);
      clone.style.width = rc.width + "px";
    } else clone.remove();
    const cloneH = showClone ? rc.height : 0;
    const total = (barH ? barH + gap : 0) + cloneH + (showClone ? gap : 0) + menuH;
    let top = showClone ? rc.top - (barH ? barH + gap : 0) : (vh - total) / 2;
    top = clamp(top, safeT + 8, Math.max(safeT + 8, vh - total - 8));
    const place = (node, y) => { node.style.top = y + "px"; };
    let y = top;
    if (bar) { place(bar, y); y += barH + gap; }
    if (showClone) { place(clone, y); y += cloneH + gap; }
    place(menu, y);
    if (grid) place(grid, top);

    // по горизонтали выравниваем по стороне пузыря
    const side = (node, w) => {
      const x = mine ? Math.min(rc.right, vw - 8) - w : Math.max(rc.left, 8);
      node.style.left = clamp(x, 8, vw - w - 8) + "px";
    };
    if (showClone) { clone.style.left = rc.left + "px"; }
    if (bar) side(bar, bar.offsetWidth);
    side(menu, menu.offsetWidth);
    if (grid) { grid.style.width = Math.min(340, vw - 16) + "px"; side(grid, Math.min(340, vw - 16)); }
    if (bar) { bar.style.transformOrigin = (mine ? "right" : "left") + " bottom"; }
    menu.style.transformOrigin = (mine ? "right" : "left") + " top";

    requestAnimationFrame(() => ov.classList.add("show"));
    MsgMenu.release = Nav.layer(() => MsgMenu.hide());

    ov.addEventListener("click", (e) => {
      // клик, которым заканчивается долгое нажатие (палец поднят над меню), не должен его закрывать
      const age = Date.now() - Math.max(MsgMenu.born, MsgMenu.guard);
      if (age < (e.target.closest(".mm-menu, .mm-react, .mm-grid") ? 180 : 450)) return;
      const more = e.target.closest("[data-more]");
      if (more) { ov.classList.add("expanded"); bar.classList.add("hidden"); menu.classList.add("hidden"); grid.classList.remove("hidden"); if (clone) clone.classList.add("dim"); return; }
      const r = e.target.closest("[data-r]");
      if (r) { MsgMenu.close(); return Chat.react(m, r.dataset.r); }
      const b = e.target.closest("[data-a]");
      if (b) { MsgMenu.close(); return Chat.act(b.dataset.a, m); }
      if (!e.target.closest(".mm-menu, .mm-react, .mm-grid")) MsgMenu.close();
    });
    ov.addEventListener("contextmenu", (e) => e.preventDefault());
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
    ov.classList.remove("show"); ov.classList.add("out");
    if (now) ov.remove(); else setTimeout(() => ov.remove(), 180);
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
      const mine = Chats.list.map((c) => c.peer).filter((p) => !q || (dispName(p) + " " + (p.username || "")).toLowerCase().includes(q));
      const have = new Set(mine.map((p) => p.id));
      shown = mine.concat(found.filter((u) => !have.has(u.id) && u.id !== App.user.id));
      list.innerHTML = shown.length ? shown.map((p, i) => row(p, i, p.username ? "@" + p.username : statusText(p))).join("") : '<div class="pn-hint">Никого не найдено</div>';
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
