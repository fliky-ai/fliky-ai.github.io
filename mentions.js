// mentions.js — упоминания @username в группах:
//  • при вводе «@» над полем ввода появляется список участников (аватар, имя, @имя) — нажатие вставляет @имя;
//  • в списке чатов у группы значок «@», если вас упомянули; в самом чате — круглая кнопка «@» с числом: нажатие
//    прокручивает к упоминанию (как в Telegram). Само упоминание синее, а упоминание вас — с подложкой.
const Mentions = {
  cache: {},            // gid → {t: время загрузки, list: участники с @именем}
  cnt: {},              // peer.id → сколько непрочитанных упоминаний было при открытии чата
  pend: [],             // id сообщений с упоминанием меня, которые я ещё не видел
  pop: null, btn: null, sel: 0, shown: [], q: null,

  init() {
    const prev = Editor.onChange;
    Editor.onChange = () => { if (prev) prev(); try { Mentions.check(); } catch (e) {} };
    const cm = $("composer");
    const pop = (Mentions.pop = document.createElement("div"));
    pop.id = "mnpop"; pop.className = "mnpop hidden"; pop.setAttribute("role", "listbox");
    cm.appendChild(pop);
    pop.addEventListener("pointerdown", (e) => e.preventDefault());      // клавиатура и фокус остаются в поле
    pop.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]"); if (!b) return;
      const u = Mentions.shown[+b.dataset.i]; if (u) Mentions.pick(u);
    });
    const wrap = document.querySelector(".msgs-wrap");
    const btn = (Mentions.btn = document.createElement("button"));
    btn.id = "jump-mn"; btn.className = "jump-mn hidden"; btn.setAttribute("aria-label", T("Упоминания"));
    btn.innerHTML = '<span class="at">@</span><i class="n"></i>';
    wrap.appendChild(btn);
    btn.onclick = () => { haptic(); Mentions.go(); };
    $("msgs").addEventListener("scroll", () => Mentions.seen(), { passive: true });
  },

  // ── подсказка участников ──
  gid() { const p = Chat.peer; return p && p.gk === "group" ? p.gid || -p.id : 0; },
  async members(gid) {
    const c = Mentions.cache[gid];
    if (c && Date.now() - c.t < 60000) return c.list;
    if (c && c.busy) return c.list;
    const e = (Mentions.cache[gid] = c || { t: 0, list: [] }); e.busy = 1;
    try {
      const d = await api("/api/chat/" + gid + "/members?limit=200");
      e.list = (d.members || []).map((m) => m.user).filter((u) => u && u.username && u.id !== App.user.id);
      e.t = Date.now();
    } catch (er) {}
    e.busy = 0;
    return e.list;
  },
  query() {
    const o = Editor.offsets(); if (!o || o[0] !== o[1]) return null;
    const txt = Rich.readRaw(Editor.el).text.slice(0, o[0]);
    const m = /(^|[\s(])@([A-Za-z0-9_]{0,31})$/.exec(txt);
    return m ? { from: o[0] - m[2].length - 1, to: o[0], q: m[2].toLowerCase() } : null;
  },
  async check() {
    const gid = Mentions.gid(), q = gid ? Mentions.query() : null;
    if (!q) return Mentions.hide();
    Mentions.q = q;
    const list = await Mentions.members(gid);
    const cur = Mentions.query();
    if (!cur || cur.q !== q.q) return;
    const rank = (u) => { const n = (u.username || "").toLowerCase(), f = dispName(u).toLowerCase(); return n.startsWith(cur.q) ? 0 : f.startsWith(cur.q) ? 1 : n.includes(cur.q) || f.includes(cur.q) ? 2 : 9; };
    Mentions.shown = list.filter((u) => !cur.q || rank(u) < 9).sort((a, b) => rank(a) - rank(b)).slice(0, 6);
    if (!Mentions.shown.length) return Mentions.hide();
    Mentions.sel = 0; Mentions.draw();
  },
  draw() {
    const p = Mentions.pop;
    p.innerHTML = Mentions.shown.map((u, i) => `<button type="button" class="mnr${i === Mentions.sel ? " on" : ""}" role="option" data-i="${i}">
      <span class="mnr-av">${avatar(u)}</span><span class="mnr-t"><b>${esc(dispName(u))}</b><i>@${esc(u.username)}</i></span></button>`).join("");
    p.classList.remove("hidden");
    requestAnimationFrame(() => p.classList.add("show"));
  },
  hide() { const p = Mentions.pop; if (!p || p.classList.contains("hidden")) return; p.classList.remove("show"); p.classList.add("hidden"); Mentions.shown = []; },
  pick(u) {
    const q = Mentions.q; Mentions.hide(); if (!q) return;
    const raw = Rich.readRaw(Editor.el);
    const ins = "@" + u.username + " ";
    const r = Rich.splice(raw.text, raw.ents, q.from, q.to, ins, []);
    Rich.write(Editor.el, r.text, r.ents);
    const pos = q.from + ins.length;
    try { Editor.select(pos, pos); } catch (e) { Editor.caretEnd(); }
    Editor.changed(); haptic();
  },

  // ── кнопка «@» ──
  // вызывается при открытии чата: chat — запись списка (там счётчик c.mn от сервера)
  onOpen(pid) {
    const c = Chats.byId(pid);
    Mentions.cnt[pid] = c && c.mn ? c.mn : 0;
    if (c) c.mn = 0;
  },
  // чат нарисован заново — собираем непросмотренные упоминания из загруженных сообщений
  sync() {
    const p = Chat.peer; if (!Mentions.btn) return;
    if (!p || p.gk !== "group") { Mentions.pend = []; return Mentions.paint(); }
    if (!Chat.msgs.some((m) => m.id && !m._c)) return Mentions.paint();      // пока показан только кэш — ждём свежие данные
    const n = Mentions.cnt[p.id] || 0;
    const mine = Chat.msgs.filter((m) => m.mn && m.id && m.sender !== App.user.id);
    const keep = new Set(Mentions.pend);
    // уже собранные + свежие, пришедшие пока чат открыт и не виден низ; при первой загрузке — последние n
    if (n && !Mentions.pend.length) mine.slice(-n).forEach((m) => keep.add(m.id));
    Mentions.cnt[p.id] = 0;
    Mentions.pend = [...keep].filter((id) => mine.some((m) => m.id === id)).sort((a, b) => a - b);
    Mentions.seen(true);
  },
  add(m) {                       // пришло новое сообщение с упоминанием меня, пока чат открыт
    if (!m.mn || !m.id || m.sender === App.user.id) return;
    if (!Mentions.pend.includes(m.id)) Mentions.pend.push(m.id);
    Mentions.paint();
  },
  seen(quiet) {
    const box = $("msgs"); if (!box || !Mentions.pend.length) return Mentions.paint();
    const bt = box.getBoundingClientRect();
    Mentions.pend = Mentions.pend.filter((id) => {
      const el = box.querySelector(`[data-id="${id}"]`); if (!el) return true;
      const r = el.getBoundingClientRect();
      return !(r.top >= bt.top - 4 && r.bottom <= bt.bottom + 4);        // целиком на экране — прочитано
    });
    Mentions.paint();
  },
  paint() {
    const b = Mentions.btn; if (!b) return;
    const n = Mentions.pend.length;
    b.classList.toggle("hidden", !n);
    b.querySelector(".n").textContent = n > 99 ? "99+" : n;
  },
  go() {
    const id = Mentions.pend[0]; if (!id) return;
    const box = $("msgs"), el = box.querySelector(`[data-id="${id}"]`);
    if (!el) { Mentions.pend.shift(); return Mentions.paint(); }
    const top = el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2;
    box.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
    setTimeout(() => Mentions.seen(), 520);
  },
};
