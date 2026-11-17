// stars2.js — «Звёзды 2»: звёздная реакция на посты каналов, пополнение пакетами (оплата звёздами Telegram), боты для заработка.
// Работает поверх готовых блоков (api, esc, T, toast, avatar, dispName, haptic, App.external).
const Stars2 = {
  fmt(n) { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M" : n >= 1e4 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "K" : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " "); },
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="s2g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFD54A"/><stop offset="1" stop-color="#F59E0B"/></linearGradient></defs><path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.6L12 17.5l-5.9 3.2 1.2-6.6L2.5 9.5l6.6-.9z" fill="url(#s2g)" stroke="#E08A00" stroke-width=".6" stroke-linejoin="round"/></svg>',
  num(n) { return String(+n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0"); },
  stack(n) { return `<span class="s2x-stk n${n}">${Stars2.star}${n > 1 ? Stars2.star : ""}${n > 2 ? Stars2.star : ""}</span>`; },

  // нижнее окно: свой контейнер, закрывается тапом мимо / крестиком
  open(html, cls) {
    const el = document.createElement("div");
    el.className = "sheet2 s2x";
    el.innerHTML = `<div class="s2x-card ${cls || ""}" role="dialog">${html}</div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    const api_ = { el, card: el.firstElementChild, close() { el.classList.remove("show"); setTimeout(() => el.remove(), 220); if (api_.onclose) api_.onclose(); } };
    el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-x]")) api_.close(); });
    return api_;
  },
  balance() { return (App.user && App.user.stars) || 0; },
  setBalance(n) { if (App.user) { App.user.stars = n; try { Settings.render(); } catch (e) {} } document.querySelectorAll(".s2x-bal b").forEach((b) => (b.textContent = Stars2.fmt(n))); },

  // ───────── звёздная реакция ─────────
  async react(m) {
    if (!m || !m.id) return;
    let d;
    try { d = await api("/api/react/paid/top?id=" + m.id); } catch (e) { return toast(e.message); }
    const MAX = d.max || 2500, LOG = (v) => Math.max(1, Math.min(MAX, Math.round(Math.pow(MAX, v / 1000)))), INV = (a) => Math.round(1000 * Math.log(Math.max(1, a)) / Math.log(MAX));
    const sh = Stars2.open("", "s2x-react");
    let amt = Math.min(50, MAX), anon = d.me && d.me.amount ? !!d.me.anon : false;
    const leaderPos = d.leader ? Math.min(98, Math.max(6, INV(d.leader) / 10)) : 86;
    const topHTML = (d.top || []).length ? (d.top || []).map((t) => `<div class="s2x-ld">${t.anon ? `<span class="av s2x-anon">?</span>` : avatar(t.user)}<b class="s2x-chip">${Stars2.star}${Stars2.fmt(t.amount)}</b><span>${t.anon ? esc(T("Аноним")) : esc(dispName(t.user))}</span></div>`).join("")
      : `<div class="s2x-noleaders">${esc(T("Станьте первым — отправьте звёзды"))}</div>`;
    sh.card.innerHTML = `
      <div class="s2x-hd"><span class="s2x-spacer"></span><h3>${esc(T("Звёздная реакция"))}</h3><button class="s2x-x" data-x aria-label="${esc(T("Закрыть"))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="s2x-pop"><div class="s2x-bubble" id="s2x-b"><span>${Stars2.star}<b id="s2x-n">${amt}</b></span></div></div>
      <div class="s2x-sl"><input type="range" id="s2x-r" min="0" max="1000" value="${INV(amt)}" aria-label="${esc(T("Количество звёзд"))}"><i class="s2x-lead" style="left:${leaderPos}%"><em>${esc(T("ЛИДЕР"))}</em></i></div>
      <p class="s2x-t">${esc(T("Выберите количество звёзд для отправки {0} в поддержку этой публикации.", d.owner_name || ""))}</p>
      <div class="s2x-lb"><span>${esc(T("Лидеры"))}</span></div>
      <div class="s2x-lds">${topHTML}</div>
      <label class="s2x-ck"><span class="s2x-cb${anon ? "" : " on"}" id="s2x-cb"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>${esc(T("Показывать меня среди лидеров"))}</label>
      <button class="s2x-go" id="s2x-go">${esc(T("Отправить"))} ${Stars2.star}<b id="s2x-g">${amt}</b></button>
      <p class="s2x-fine">${esc(T("Звёзды получает владелец канала. Баланс:"))} <span class="s2x-bal"><b>${Stars2.fmt(Stars2.balance())}</b> ★</span></p>`;
    const r = sh.card.querySelector("#s2x-r"), bub = sh.card.querySelector("#s2x-b");
    const paint = () => {
      sh.card.querySelector("#s2x-n").textContent = amt; sh.card.querySelector("#s2x-g").textContent = amt;
      const p = r.value / 10; r.style.setProperty("--p", p + "%"); bub.style.left = `calc(${p}% + ${(0.5 - p / 100) * 28}px)`;
    };
    r.addEventListener("input", () => { amt = LOG(+r.value); paint(); });
    paint();
    sh.card.querySelector("#s2x-cb").addEventListener("click", (e) => { anon = !anon; e.currentTarget.classList.toggle("on", !anon); });
    sh.card.querySelector(".s2x-fine .s2x-bal").addEventListener("click", () => { sh.close(); Stars2.topup(); });
    const go = sh.card.querySelector("#s2x-go");
    go.addEventListener("click", async () => {
      if (go.disabled) return;
      if (Stars2.balance() < amt) { toast(T("Не хватает звёзд — пополните баланс")); sh.close(); return Stars2.topup(amt - Stars2.balance()); }
      go.disabled = true;
      try {
        const x = await api("/api/react/paid", { method: "POST", body: { id: m.id, amount: amt, anon } });
        m.pr = x.pr; Stars2.setBalance(x.balance);
        Chat.patch(m); try { Chat.fly(m, "⭐"); } catch (e) {} haptic("medium");
        sh.close(); toast(T("Отправлено {0} ★", amt));
      } catch (e) { go.disabled = false; toast(e.message); }
    });
    // плашка «У Вас ★ N. Купить звёзды» над окном, как в Telegram
    const pill = document.createElement("div");
    pill.className = "s2x-pill"; pill.innerHTML = `<div>${esc(T("У Вас"))} ${Stars2.star} <span class="s2x-bal"><b>${Stars2.fmt(Stars2.balance())}</b></span>.</div><button>${esc(T("Купить звёзды"))} ›</button>`;
    pill.querySelector("button").addEventListener("click", () => { sh.close(); Stars2.topup(); });
    sh.el.appendChild(pill);
  },
  // чип под постом: ★ N (моя — выделена) или «+★», если платные реакции включены, а звёзд ещё нет
  chip(m) {
    if (!m.pr) return "";
    const n = m.pr.n || 0;
    return `<button class="rx-chip rx-star${m.pr.me ? " mine" : ""}${n ? "" : " empty"}" data-star="1" aria-label="${esc(T("Звёздная реакция"))}"><span class="e">${Stars2.star}</span>${n ? `<span class="n">${Stars2.fmt(n)}</span>` : `<span class="n">+</span>`}</button>`;
  },

  // ───────── пополнение пакетами ─────────
  async topup(need) {
    let d;
    try { d = await api("/api/stars/packs"); } catch (e) { return toast(e.message); }
    const sh = Stars2.open("", "s2x-top");
    const rows = d.packs.map((p, i) => `<button class="s2x-pk${need && p.stars >= need && !sh._hl ? (sh._hl = 1, " hl") : ""}" data-s="${p.stars}">${Stars2.stack(i < 2 ? 1 : i < 4 ? 2 : 3)}<b>${Stars2.num(p.stars)} ${esc(T("звёзд"))}</b><span class="s2x-pr">${Stars2.star}<i>${Stars2.num(p.tg)}</i></span></button>`).join("");
    sh.card.innerHTML = `
      <div class="s2x-hd"><span class="s2x-spacer"></span><h3>${esc(T("Пополнить звёзды"))}</h3><button class="s2x-x" data-x aria-label="${esc(T("Закрыть"))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="s2x-balbox">${Stars2.star}<b class="s2x-bal"><b>${Stars2.fmt(d.balance)}</b></b><small>${esc(T("Ваш баланс"))}</small></div>
      ${need ? `<p class="s2x-need">${esc(T("Для отправки не хватает {0} ★", Stars2.fmt(need)))}</p>` : ""}
      <div class="s2x-lbl">${esc(T("Выберите количество"))}</div>
      <div class="s2x-pks">${rows}</div>
      <p class="s2x-fine">${esc(T("Оплата звёздами Telegram (20 звёзд Dicegram = 1 звезда Telegram). Откроется Telegram, после оплаты баланс пополнится сам."))}</p>
      ${d.admin ? `<button class="s2x-adm" id="s2x-adm">${esc(T("Тест: начислить себе звёзды (админ)"))}</button>` : ""}`;
    sh.card.querySelector(".s2x-pks").addEventListener("click", async (e) => {
      const b = e.target.closest(".s2x-pk"); if (!b || b.disabled) return;
      b.disabled = true; b.classList.add("load");
      try {
        const x = await api("/api/stars/invoice", { method: "POST", body: { stars: +b.dataset.s } });
        App.external(x.link);
        toast(T("Оплатите в Telegram — баланс пополнится сам"));
        Stars2.waitPaid(x.order, sh);
      } catch (er) { toast(er.message); }
      b.disabled = false; b.classList.remove("load");
    });
    const adm = sh.card.querySelector("#s2x-adm");
    if (adm) adm.addEventListener("click", async () => {
      const v = await UI.prompt({ title: T("Начислить звёзд (тест)"), value: "1000", placeholder: "1000", type: "number" });
      const n = Math.floor(+v); if (!v || !(n > 0)) return;
      try { const x = await api("/api/stars/topup", { method: "POST", body: { amount: n } }); App.user = x.user; Stars2.setBalance(x.user.stars || 0); toast(T("Баланс пополнен")); } catch (er) { toast(er.message); }
    });
  },
  // ждём подтверждения оплаты от сервера (бот Telegram получает платёж и зачисляет звёзды)
  waitPaid(oid, sh) {
    let n = 0;
    const t = setInterval(async () => {
      if (++n > 90) return clearInterval(t);
      try {
        const x = await api("/api/stars/order/" + oid);
        if (x.status === "paid") { clearInterval(t); Stars2.setBalance(x.balance); toast(T("Зачислено {0} ★", Stars2.fmt(x.stars))); haptic("medium"); if (sh && sh.el.isConnected) sh.close(); }
      } catch (e) {}
    }, 2000);
  },
  onStars(d) {         // WS: баланс изменился (оплата, приз за игру, платная реакция)
    if (d.balance !== undefined) Stars2.setBalance(d.balance);
    if (d.prize) toast(T("🏆 Приз за {0} место в игре: +{1} ★", d.prize.place, d.prize.amount));
    else if (d.added) toast(T("Зачислено {0} ★", Stars2.fmt(d.added)));
  },
  onPr(d) {            // WS: у поста изменились звёздные реакции
    const m = Chat.msgs.find((q) => q.id === d.id);
    if (m) { m.pr = d.pr; Chat.patch(m); }
  },

  // ───────── «Заработать звёзды» ─────────
  earn() {
    const pg = Pg.open({ title: T("Заработать звёзды"), data: { items: null }, build: (pg) => Stars2.drawEarn(pg) });
    pg.on = {
      add: () => Stars2.addBot(pg),
      del: async (el) => { if (!confirm(T("Убрать бота из списка?"))) return; try { await api("/api/earn/bots/" + el.dataset.v, { method: "DELETE" }); Stars2.loadEarn(pg); } catch (e) { toast(e.message); } },
      open: (el) => { const it = (pg.data.items || []).find((x) => String(x.id) === el.dataset.v); if (it) Stars2.openBot(it.user); },
    };
    Stars2.loadEarn(pg);
  },
  async loadEarn(pg) {
    try { const d = await api("/api/earn/bots"); pg.data = { items: d.items, admin: d.admin }; } catch (e) { pg.data = { items: [], admin: false, err: e.message }; }
    if (pg.alive) Stars2.drawEarn(pg);
  },
  drawEarn(pg) {
    const d = pg.data, items = d.items, adm = !!d.admin;
    const list = !items ? `<div class="s2x-load">${esc(T("Загрузка…"))}</div>`
      : items.length ? `<div class="card2 s2x-bots">${items.map((it) => `<div class="s2x-bot"><button class="s2x-bo" data-a="open" data-v="${it.id}">${avatar(it.user)}<span class="tx"><b>${nameHTML(it.user)}</b><small>@${esc(it.user.username || "")}${it.note ? " · " + esc(it.note) : ""}</small></span><span class="s2x-go2">${esc(T("Открыть"))}</span></button>${adm ? `<button class="s2x-rm" data-a="del" data-v="${it.id}" aria-label="${esc(T("Убрать"))}">×</button>` : ""}</div>`).join("")}</div>`
      : `<div class="s2x-empty"><div class="s2x-eic">${Stars2.star}</div><h3>${esc(T("Пока здесь пусто"))}</h3><p>${esc(T("Скоро появятся боты, которые платят звёзды за задания."))}</p></div>`;
    pg.set(`<div class="s2x-hero"><div class="s2x-hero-ic">${Stars2.star}</div><h2>${esc(T("Зарабатывайте звёзды"))}</h2><p>${esc(T("Откройте бота, выполняйте задания — звёзды придут на баланс."))}</p></div>
      ${adm ? `<button class="pbtn s2x-add" data-a="add">＋ ${esc(T("Добавить бота"))}</button>` : ""}
      ${R.lbl(esc(T("Боты для заработка")))}${list}
      ${R.hint(esc(T("Звёзды начисляет сам бот. Dicegram не отвечает за задания сторонних ботов.")))}`);
  },
  async openBot(user) {
    try {
      while (Nav.stack.length) { Nav.pop(); }
      history.go(-(history.state && history.state.n ? history.state.n : 0));
      setTimeout(() => { App.go("chats"); Chat.open(user); }, 60);
    } catch (e) { toast(e.message); }
  },
  addBot(pg) {
    const sh = Stars2.open(`
      <div class="s2x-hd"><span class="s2x-spacer"></span><h3>${esc(T("Добавить бота"))}</h3><button class="s2x-x" data-x aria-label="${esc(T("Закрыть"))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <label class="s2x-f"><span>${esc(T("ID бота"))}</span><input id="s2x-id" inputmode="numeric" placeholder="123456" autocomplete="off"></label>
      <label class="s2x-f"><span>${esc(T("Юзернейм"))}</span><input id="s2x-un" placeholder="@my_bot" autocomplete="off" autocapitalize="off"></label>
      <label class="s2x-f"><span>${esc(T("Подпись (необязательно)"))}</span><input id="s2x-note" maxlength="120" placeholder="${esc(T("Например: задания за звёзды"))}" autocomplete="off"></label>
      <button class="s2x-go" id="s2x-ok">${esc(T("Добавить"))}</button>`, "s2x-form");
    sh.card.querySelector("#s2x-ok").addEventListener("click", async (e) => {
      const id = sh.card.querySelector("#s2x-id").value.trim(), un = sh.card.querySelector("#s2x-un").value.trim(), note = sh.card.querySelector("#s2x-note").value.trim();
      if (!id || !un) return toast(T("Укажите ID и юзернейм бота"));
      e.currentTarget.disabled = true;
      try { await api("/api/earn/bots", { method: "POST", body: { bot_id: +id, username: un, note } }); sh.close(); toast(T("Бот добавлен — его видят все")); Stars2.loadEarn(pg); }
      catch (er) { e.currentTarget.disabled = false; toast(er.message); }
    });
  },
};
