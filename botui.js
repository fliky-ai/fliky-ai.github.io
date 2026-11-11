// botui.js — боты в чате: кнопки под сообщением (callback / ссылка / мини-приложение / оплата звёздами / действие в приложении),
// счета на оплату (sendInvoice), обычная клавиатура бота (reply keyboard и кнопки меню из Dicebot),
// меню команд с автодополнением («/»), карточка «START» в пустом чате с ботом.
const BotUI = {
  wait: {},            // id callback-запроса → кнопка, ожидающая answerCallbackQuery
  hid: {},             // чат → id сообщения, клавиатура которого свёрнута
  cmdOpen: false,

  isBot(p) { return !!(p && p.bot && !p.gk && !p.is_system); },
  cmds(p) { return (p && p.binfo && Array.isArray(p.binfo.cmds)) ? p.binfo.cmds : []; },

  // ─────────── кнопки под сообщением ───────────
  kbHTML(m) {
    const ext = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg>';
    return `<div class="ikb">${m.kb.map((row) => `<div class="ikb-r">${(row || []).map((b) => {
      const t = esc(b.t || "");
      if (b.o) return `<button type="button" class="ikb-b" data-o="${esc(b.o)}">${t}</button>`;
      if (b.a) return `<button type="button" class="ikb-b" data-act="${esc(b.a)}">${t}</button>`;
      if (b.u) return `<button type="button" class="ikb-b" data-u="${esc(b.u)}">${t}${ext}</button>`;
      if (b.w) return `<button type="button" class="ikb-b" data-w="${esc(b.w)}">${t}${ext}</button>`;
      if (b.p) return `<button type="button" class="ikb-b pay" data-p="1">${t}</button>`;
      return `<button type="button" class="ikb-b" data-d="${esc(b.d || "")}">${t}</button>`;
    }).join("")}</div>`).join("")}</div>`;
  },

  async press(m, btn) {
    const d = btn.dataset;
    if (d.o) {                                                       // кнопки админ-панели: открыть профиль / жалобу
      const [kind, arg] = d.o.split(":");
      if (kind === "user") return UserProfile.open({ id: +arg, name: "", surname: "", username: "", avatar: "", bio: "" });
      if (kind === "report") return HCReport.open(+arg);
      return;
    }
    if (d.act) return BotUI.action(d.act);
    if (d.u) return Links.open(d.u);
    if (d.w) return BotUI.webapp(d.w, m);
    if (d.p) return BotUI.pay(m);
    if (btn.classList.contains("busy")) return;
    btn.classList.add("busy"); haptic();
    let keep = false;
    try {
      const r = await api(m.bot ? "/api/bot/cb" : "/api/hc/cb", { method: "POST", body: { id: m.id, d: d.d } });
      if (r.toast) toast(r.toast);
      if (r.cb) {                                                    // бот пользователя: ответ придёт событием cbans
        if (r.alive === false) toast(T("Бот сейчас не отвечает"));
        else { keep = true; BotUI.wait[r.cb] = btn; setTimeout(() => BotUI.release(r.cb), 9000); }
      }
    } catch (e) { toast(e.message); }
    finally { if (!keep) btn.classList.remove("busy"); }
  },
  release(id) { const b = BotUI.wait[id]; if (b) { b.classList.remove("busy"); delete BotUI.wait[id]; } },
  // WS: бот ответил на нажатие кнопки (answerCallbackQuery)
  onCbAns(d) {
    BotUI.release(d.id);
    if (d.url) { try { Links.open(d.url); } catch (e) {} }
    if (d.alert && d.text) UI.sheet({ text: d.text, actions: [], cancel: "OK" });
    else if (d.text) toast(d.text);
  },

  // действия внутри приложения (кнопки Dicebot)
  action(a) {
    if (a === "dicebot") return Dicebot.open();
    if (a === "dicebot:create") return Dicebot.create();
    if (a === "dicebot:docs") return Dicebot.docs();
    const m = /^dicebot:bot:(\d+)$/.exec(a || "");
    if (m) return Dicebot.panel(+m[1]);
  },

  // мини-приложение бота (кнопка web_app): открываем страницу во встроенном окне
  webapp(url, m) {
    if (!/^https:\/\//i.test(url)) return toast(T("Адрес мини-приложения должен начинаться с https://"));
    try { Browser.open(url); } catch (e) { Browser.external(url); }
  },

  // ─────────── счёт на оплату звёздами ───────────
  inv(m) {
    const i = m.inv; if (!i) return "";
    return `<div class="inv"><div class="inv-h">${SI.starF}<span>${esc(i.t || "")}</span></div><div class="inv-d">${esc(i.d || "")}</div>
      <div class="inv-a">${SI.starF}<span>${esc(String(i.a || 0))}</span>${i.paid ? `<em class="inv-ok">✓ ${esc(T("Оплачено"))}</em>` : ""}</div></div>`;
  },
  async pay(m) {
    const i = m.inv; if (!i || i.paid) return toast(T("Этот счёт уже оплачен"));
    const have = (App.user && App.user.stars) || 0;
    const v = await UI.sheet({ title: T("Оплата"), icon: SI.starF, text: T("«{0}» — {1} ⭐. Ваш баланс: {2} ⭐.", i.t, i.a, have),
      actions: [{ label: T("Оплатить {0} ⭐", i.a), value: "y", accent: true }] });
    if (v !== "y") return;
    try {
      await api("/api/bot/pay", { method: "POST", body: { id: m.id }, timeout: 25000 });
      haptic("medium"); toast(T("Оплачено ✓"));
    } catch (e) {
      if (e.data && e.data.short) {
        const g = await UI.sheet({ title: T("Недостаточно звёзд"), text: e.message, actions: [{ label: T("Пополнить звёзды"), value: "buy", accent: true }] });
        if (g === "buy") { try { Settings.stars(); } catch (x) {} }
      } else toast(e.message);
    }
  },

  // ─────────── пустой чат с ботом ───────────
  startCard(p) {
    const bi = p.binfo || {};
    const text = bi.descr || bi.about || p.bio || "";
    return `<div class="bot-start">${avatar(p)}<h3>${esc(dispName(p))}${verBadge(p)}</h3>${text ? `<p>${esc(text)}</p>` : ""}
      ${bi.off ? `<p>${esc(T("Бот сейчас выключен"))}</p>` : `<button class="bot-go" type="button" data-go="start">${esc(T("СТАРТ"))}</button>`}</div>`;
  },

  // ─────────── клавиатура бота и меню команд ───────────
  // что показывать вместо поля ввода: последняя клавиатура от бота или кнопки меню из Dicebot
  kbState() {
    const p = Chat.peer;
    if (!BotUI.isBot(p) || Chat.topic) return null;
    let last = null, i = Chat.msgs.length;
    while (i--) {
      const m = Chat.msgs[i];
      if (m.sender === p.id && m.rk) { last = m; break; }
    }
    if (last) {
      const rk = last.rk;
      if (rk.rm) return null;
      if (rk.fr) return { fr: 1, ph: rk.ph || "", id: last.id };
      // «одноразовая» клавиатура скрывается, когда человек уже ответил
      if (rk.ot && Chat.msgs.slice(i + 1).some((x) => x.sender === App.user.id)) return null;
      return rk.k && rk.k.length ? { rows: rk.k, id: last.id, ph: rk.ph || "", rk: 1 } : null;
    }
    const menu = p.binfo && p.binfo.menu;
    if (Array.isArray(menu) && menu.length) return { rows: menu, id: 0, menu: 1 };
    return null;
  },

  // обновить клавиатуру, кнопки «/» и подсказку в поле ввода для открытого чата
  sync() {
    const p = Chat.peer, comp = $("composer"); if (!comp) return;
    let box = $("rkb");
    if (!box) {
      box = document.createElement("div"); box.id = "rkb"; box.className = "rkb hidden";
      comp.insertBefore(box, comp.querySelector(".crow"));
      box.addEventListener("click", (e) => {
        const b = e.target.closest(".rkb-b");
        if (b) {
          const st = BotUI.kbState(); haptic();
          Chat.post({ kind: "text", text: b.dataset.t });
          if (st && st.rk && Chat.msgs.length) { /* одноразовая клавиатура сама скроется при следующей перерисовке */ }
          setTimeout(() => BotUI.sync(), 0);
          return;
        }
        if (e.target.closest(".rkb-x")) { const s = BotUI.kbState(); if (s) BotUI.hid[Chat.peer.id] = s.id; BotUI.sync(); }
      });
    }
    const cm = $("btn-cmds"), kb = $("btn-rk");
    const bot = BotUI.isBot(p), st = bot ? BotUI.kbState() : null, cmds = bot ? BotUI.cmds(p) : [];
    if (cm) cm.classList.toggle("hidden", !(bot && cmds.length));
    const hidden = st && st.rows && BotUI.hid[p.id] === st.id && st.id !== undefined;
    if (kb) kb.classList.toggle("hidden", !(st && st.rows));
    if (st && st.rows && !hidden) {
      box.innerHTML = st.rows.map((r) => `<div class="rkb-r">${r.map((t) => `<button type="button" class="rkb-b" data-t="${esc(t)}">${esc(t)}</button>`).join("")}</div>`).join("") +
        `<button type="button" class="rkb-x">${esc(T("Скрыть"))}</button>`;
      box.classList.remove("hidden");
    } else { box.classList.add("hidden"); box.innerHTML = ""; }
    comp.classList.toggle("has-rkb", !box.classList.contains("hidden"));
    const ph = st && (st.ph || (st.fr && st.ph)) ? st.ph : "";
    $("msg-input").dataset.ph = ph || T("Сообщение");
    if (!bot) BotUI.pop(false);
  },

  toggleKb() {
    const p = Chat.peer, st = BotUI.kbState(); if (!p || !st || !st.rows) return;
    if (BotUI.hid[p.id] === st.id) delete BotUI.hid[p.id]; else BotUI.hid[p.id] = st.id;
    BotUI.sync();
  },

  // список команд: от «/» в поле ввода или по кнопке «/» слева
  pop(show, prefix) {
    let el = $("cmdpop");
    if (!show) { if (el) el.classList.add("hidden"); BotUI.cmdOpen = false; return; }
    const p = Chat.peer; if (!BotUI.isBot(p)) return;
    const list = BotUI.cmds(p).filter((c) => !prefix || String(c.command).toLowerCase().startsWith(prefix));
    if (!list.length) { if (el) el.classList.add("hidden"); return; }
    if (!el) {
      el = document.createElement("div"); el.id = "cmdpop"; el.className = "cmd-pop hidden";
      $("composer").appendChild(el);
      el.addEventListener("pointerdown", (e) => e.preventDefault());
      el.addEventListener("click", (e) => {
        const b = e.target.closest(".cmd"); if (!b) return;
        haptic(); Editor.clear(); BotUI.pop(false);
        Chat.post({ kind: "text", text: "/" + b.dataset.c });
      });
    }
    el.innerHTML = list.map((c) => `<button type="button" class="cmd" data-c="${esc(c.command)}"><b>/${esc(c.command)}</b><span>${esc(c.description || "")}</span></button>`).join("");
    el.classList.remove("hidden"); BotUI.cmdOpen = true;
  },
  // из Editor.onChange: набор текста, начинающегося с «/»
  onInput() {
    const p = Chat.peer; if (!BotUI.isBot(p)) return BotUI.pop(false);
    let t = ""; try { t = Rich.readRaw(Editor.el).text; } catch (e) {}
    if (/^\/[A-Za-z0-9_]*$/.test(t)) BotUI.pop(true, t.slice(1).toLowerCase());
    else if (BotUI.cmdOpen && !BotUI._btn) BotUI.pop(false);
  },
  toggleCmds() {
    if (BotUI.cmdOpen) return BotUI.pop(false);
    BotUI._btn = 1; BotUI.pop(true, ""); setTimeout(() => { BotUI._btn = 0; }, 400);
  },

  init() {
    const cm = $("btn-cmds"), kb = $("btn-rk");
    if (cm) { cm.addEventListener("pointerdown", (e) => e.preventDefault()); cm.onclick = () => BotUI.toggleCmds(); }
    if (kb) { kb.addEventListener("pointerdown", (e) => e.preventDefault()); kb.onclick = () => BotUI.toggleKb(); }
    // «СТАРТ» в пустом чате
    const msgs = $("msgs");
    if (msgs) msgs.addEventListener("click", (e) => {
      const g = e.target.closest(".bot-go"); if (!g) return;
      haptic("medium"); Chat.post({ kind: "text", text: "/start" });
    });
  },
};
