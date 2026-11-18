// desktop.js — версия для компьютера: класс body.desk, пустое окно справа, переключение чатов, горячие клавиши,
// перетаскивание файлов в чат, закрытие окон щелчком мимо, прокрутка колесом в горизонтальных лентах.
const Desk = {
  mq: null,
  on() { return document.body.classList.contains("desk"); },
  apply() { document.body.classList.toggle("desk", Desk.mq.matches); },
  init() {
    Desk.mq = matchMedia("(min-width:900px) and (hover:hover)");
    Desk.apply();
    if (Desk.mq.addEventListener) Desk.mq.addEventListener("change", Desk.apply); else if (Desk.mq.addListener) Desk.mq.addListener(Desk.apply);
    // пустое окно справа, пока чат не выбран
    const e = document.createElement("div");
    e.id = "deskEmpty"; e.setAttribute("aria-hidden", "true");
    e.innerHTML = `<div class="de-logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><circle cx="9" cy="12" r=".9" fill="currentColor"/><circle cx="12.5" cy="12" r=".9" fill="currentColor"/><circle cx="16" cy="12" r=".9" fill="currentColor"/></svg></div>
      <div class="de-pill">${esc(T("Выберите чат, чтобы начать общение"))}</div>
      <div class="de-keys"><kbd>Ctrl K</kbd><span>${esc(T("поиск"))}</span><kbd>Alt ↑ ↓</kbd><span>${esc(T("следующий чат"))}</span><kbd>Esc</kbd><span>${esc(T("закрыть чат или окно"))}</span><kbd>Shift Enter</kbd><span>${esc(T("новая строка"))}</span></div>`;
    document.body.appendChild(e);
    Desk.patch(); Desk.watch(); Desk.keys(); Desk.drop(); Desk.wheel(); Desk.outside();
  },
  // чат открывается в правой части: повторное открытие другого чата не складывает страницы друг на друга
  patch() {
    const open = Nav.open.bind(Nav);
    Nav.open = function (id, onClose) {
      if (Desk.on() && id === "chat") {
        const cur = Nav.stack.find((x) => x.id === "chat");
        if (cur) { cur.onClose = onClose; const el = $("chat"); el.style.zIndex = Math.max(+el.style.zIndex || 0, 21); return; }
      }
      return open(id, onClose);
    };
    const co = Chat.open.bind(Chat);
    Chat.open = function (peer, opt) {
      if (Desk.on() && Nav.stack.some((x) => x.id === "chat")) { try { MsgMenu.close(true); Voice.cancel(); Player.stop(); } catch (e) {} }
      return co(peer, opt);
    };
  },
  // подсветка открытого чата в списке
  watch() {
    const mark = () => {
      const list = $("chat-list"); if (!list) return;
      const id = Chat.peer ? String(Chat.peer.id) : "";
      list.querySelectorAll(".chrow.cur").forEach((r) => { if (r.dataset.id !== id) r.classList.remove("cur"); });
      if (id) { const r = list.querySelector(`.chrow[data-id="${CSS.escape(id)}"]`); if (r) r.classList.add("cur"); }
    };
    const list = $("chat-list"), chat = $("chat");
    if (list) new MutationObserver(mark).observe(list, { childList: true });
    if (chat) new MutationObserver(mark).observe(chat, { attributes: true, attributeFilter: ["class"] });
    Desk.mark = mark;
  },
  rows() { return [...document.querySelectorAll("#chat-list .chrow")]; },
  keys() {
    document.addEventListener("keydown", (e) => {
      if (!Desk.on() || !App.user) return;
      const k = e.key, mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && !e.shiftKey && (k === "k" || k === "K" || k === "л" || k === "Л")) { e.preventDefault(); if (!Nav.stack.length || Nav.stack[Nav.stack.length - 1].id === "chat") { try { Search.open(); } catch (er) {} } return; }
      if (e.altKey && (k === "ArrowUp" || k === "ArrowDown") && !mod) {
        const rows = Desk.rows(); if (!rows.length) return; e.preventDefault();
        const i = rows.findIndex((r) => r.classList.contains("cur")), n = k === "ArrowDown" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
        if (rows[n] && n !== i) { rows[n].click(); rows[n].scrollIntoView({ block: "nearest" }); }
      }
    });
  },
  // файлы из проводника — в открытый чат
  drop() {
    const chat = $("chat"); if (!chat) return;
    let depth = 0;
    const has = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
    chat.addEventListener("dragenter", (e) => { if (!Desk.on() || !has(e)) return; e.preventDefault(); depth++; chat.dataset.drop = T("Отпустите файлы, чтобы отправить"); chat.classList.add("drop"); });
    chat.addEventListener("dragover", (e) => { if (Desk.on() && has(e)) e.preventDefault(); });
    chat.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; chat.classList.remove("drop"); } });
    chat.addEventListener("drop", (e) => {
      depth = 0; chat.classList.remove("drop");
      if (!Desk.on() || !has(e)) return;
      e.preventDefault();
      if (Chat.peer && typeof Attach !== "undefined" && Attach.preview) Attach.preview([...e.dataTransfer.files]);
    });
  },
  // колесо мыши двигает горизонтальные ленты (пространства, истории, подборки)
  wheel() {
    document.addEventListener("wheel", (e) => {
      if (!Desk.on() || e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      for (let el = e.target; el && el !== document.body; el = el.parentElement) {
        if (el.scrollWidth <= el.clientWidth + 2) continue;
        const cs = getComputedStyle(el);
        if (!/auto|scroll/.test(cs.overflowX)) continue;
        if (/auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2) return;
        const before = el.scrollLeft; el.scrollLeft += e.deltaY;
        if (el.scrollLeft !== before) e.preventDefault();
        return;
      }
    }, { passive: false });
  },
  // щелчок по затемнению закрывает верхнее окно (кроме чата и пространства)
  outside() {
    document.addEventListener("mousedown", (e) => {
      if (!Desk.on() || !Nav.stack.length) return;
      const top = Nav.stack[Nav.stack.length - 1]; if (!top || !top.id) return;
      const el = $(top.id); if (!el || !el.matches(".page:not(#chat):not(#space):not(.sec-page)") || !el.classList.contains("open")) return;
      if (el.contains(e.target)) return;
      if (e.target.closest(".sheet, .sheet2, #toast, .ibr, .gal, #panel")) return;
      if (!e.target.closest("#app, #deskEmpty, #chat") && e.target !== document.body && e.target !== document.documentElement) return;
      e.preventDefault(); e.stopPropagation(); Desk.noClick = Date.now(); Nav.back();
    }, true);
    // «щелчок по затемнению» не должен ещё и нажать то, что лежит под ним (например, открыть чат из списка)
    document.addEventListener("click", (e) => { if (Desk.noClick && Date.now() - Desk.noClick < 600) { e.preventDefault(); e.stopPropagation(); } }, true);
  },
};
// запускаем после разбора страницы: к этому времени app.js уже загружен (Nav, Chat…)
document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", () => Desk.init()) : Desk.init();
