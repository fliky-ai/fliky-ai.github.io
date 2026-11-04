// gifts.js — подарки как в Telegram: магазин (Premium / подарки / коллекционные), окно подарка, оформление NFT,
// карточка подарка в переписке. Рисунки собираются из эмодзи и градиентов — картинок нет.
const GIC = {
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M8 3h8l-1 6 3 4H6l3-4z"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6A16.6 16.6 0 0 0 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  wear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/><path d="M17.5 2.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" fill="currentColor"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2.4"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
};

// ───────────── рисунок подарка ─────────────
const GiftArt = (() => {
  const POS = [[50, 9, .15], [85, 24, .12], [93, 52, .14], [80, 82, .12], [50, 93, .15], [19, 82, .12], [7, 52, .14], [17, 24, .12],
    [31, 6, .09], [69, 6, .09], [31, 96, .09], [69, 96, .09], [27, 32, .07], [73, 32, .07], [27, 70, .07], [73, 70, .07], [6, 8, .08], [94, 8, .08], [6, 94, .08], [94, 94, .08]];
  const hash = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
  const sz = (o) => (o && o.s ? `--s:${o.s}px;` : "");
  const pat = (e, seed) => POS.map(([x, y, z], i) => `<i style="--x:${x}%;--y:${y}%;--z:${z};--r:${((i * 47 + seed) % 70) - 35}deg">${esc(e)}</i>`).join("");
  const A = {
    // коллекционный подарок: a = {e, num, model{hue,acc}, backdrop{c1,c2}, pattern{e}}
    nft(a, o = {}) {
      const m = a.model || {}, b = a.backdrop || {}, p = a.pattern || {};
      const acc = m.acc ? `<b class="ga-ac">${esc(m.acc)}</b>` : "";
      return `<div class="ga nft${o.cls ? " " + o.cls : ""}" style="${sz(o)}--c1:${esc(b.c1 || "#7ec8ff")};--c2:${esc(b.c2 || "#2f7bff")}">
        <div class="ga-pat">${pat(p.e || "✨", +a.num || 0)}</div>
        <span class="ga-e" style="--hue:${+m.hue || 0}deg">${esc(a.e || "🎁")}</span>${acc}<i class="ga-sh"></i></div>`;
    },
    // обычный подарок: {e, key}
    reg(g, o = {}) {
      return `<div class="ga reg${o.cls ? " " + o.cls : ""}" style="${sz(o)}--h:${hash(g.key || g.e) % 360}"><span class="ga-e">${esc(g.e || "🎁")}</span></div>`;
    },
    // Premium в подарок
    prem(months, o = {}) {
      return `<div class="ga prem${o.cls ? " " + o.cls : ""}" style="${sz(o)}"><div class="ga-st">${typeof ES !== "undefined" ? ES.svg("star") : GIC.star}</div>
        <b class="ga-mo">${months}</b><small>${esc(plural(months, T("месяц"), T("месяца"), T("месяцев")))}</small><i class="ga-sh"></i></div>`;
    },
    // любой подарок из ответа сервера (в том числе элемент профиля или сообщение)
    html(g, o = {}) {
      if (!g) return "";
      if (String(g.key || "").startsWith("prem:")) return A.prem(+g.months || +String(g.key).slice(5) || 1, o);
      if (g.nft) return A.nft(g.nft, o);
      if (g.backdrop) return A.nft(g, o);
      return A.reg(g, o);
    },
  };
  return A;
})();

// ───────────── магазин и окна подарков ─────────────
const Gifts = {
  cat: null,
  PM: 500,                                   // цена Premium на месяц — только для расчёта скидки на плитках

  date(ts) { try { return new Date(ts * 1000).toLocaleDateString(I18N.lang === "en" ? "en-GB" : "ru-RU", { day: "numeric", month: "long", year: "numeric" }); } catch (e) { return ""; } },
  stars(n) { return `<span class="gs-s">${GIC.star}${(+n || 0).toLocaleString(I18N.lang === "en" ? "en-US" : "ru-RU")}</span>`; },
  title(g) {
    if (String(g.key || "").startsWith("prem:")) return T("Premium на {0}", (+g.months || +String(g.key).slice(5)) + " " + plural(+g.months || +String(g.key).slice(5), T("месяц"), T("месяца"), T("месяцев")));
    return (g.name || "") + (g.nft ? " #" + g.nft.num : "");
  },
  async load() { try { const d = await api("/api/gifts/catalog"); Gifts.cat = d; return d; } catch (e) { toast(e.message); return null; } },
  balance() { return (App.user && App.user.stars) || 0; },

  // что-то изменилось (подарили, улучшили, надели): обновить экраны, где это видно
  changed(uid) {
    try { if (typeof UserProfile !== "undefined" && UserProfile.cur && (!uid || UserProfile.cur.id === uid)) UserProfile.reload(); } catch (e) {}
    try { Profile.render(); } catch (e) {}
  },
  // слой поверх всего: «назад» закрывает его
  layer(cls, html, z) {
    const el = document.createElement("div");
    el.className = cls;
    if (z) el.style.zIndex = z;
    el.innerHTML = html;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    const close = Nav.layer(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 260); });
    el.addEventListener("click", (e) => { if (e.target === el) close(); });
    const x = el.querySelector("[data-x]"); if (x) x.onclick = close;
    return { el, close };
  },

  // ── магазин ──
  async shop(u, tab = "prem") {
    if (!u || u.is_system) return;
    const L = Gifts.layer("gs-ov", `<div class="gs-card" role="dialog">
      <div class="gs-top"><button class="gs-x" data-x aria-label="${esc(T("Закрыть"))}">${GIC.x}</button><b>${esc(T("Подарок для {0}", dispName(u)))}</b>
        <button class="gs-bal" data-bal>${Gifts.stars(Gifts.balance())}</button></div>
      <div class="gs-tabs"><i></i><button data-t="prem">Premium</button><button data-t="reg">${esc(T("Подарки"))}</button><button data-t="col">${esc(T("Коллекционные"))}</button></div>
      <div class="gs-body"><div class="gs-wait"><span class="spin"></span></div></div></div>`, 126);
    const el = L.el, body = el.querySelector(".gs-body"), tabs = el.querySelector(".gs-tabs");
    const st = { u, tab, L };
    Gifts.cur = st;
    el.querySelector("[data-bal]").onclick = () => { L.close(); setTimeout(() => Settings.stars(), 280); };
    const set = (t) => {
      st.tab = t;
      const bs = [...tabs.querySelectorAll("button")], i = bs.findIndex((b) => b.dataset.t === t);
      bs.forEach((b, j) => b.classList.toggle("on", j === i));
      tabs.style.setProperty("--i", i);
      body.scrollTop = 0;
      body.innerHTML = Gifts.panel(t, u);
    };
    tabs.onclick = (e) => { const b = e.target.closest("button[data-t]"); if (b) { haptic(); set(b.dataset.t); } };
    const d = Gifts.cat || await Gifts.load();
    if (!d) return L.close();
    set(tab);
    body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pm],[data-gk],[data-ck]"); if (!b) return;
      haptic();
      if (b.dataset.pm) return Gifts.buyPrem(u, +b.dataset.pm, L);
      if (b.dataset.gk) return Gifts.buyReg(u, b.dataset.gk, L);
      if (b.dataset.ck) return Gifts.buyCol(u, b.dataset.ck, L);
    });
    Gifts.cycle(el);
    Gifts.live(el);
  },
  // баланс в шапке магазина обновляется после покупок
  live(el) { const b = el.querySelector("[data-bal]"); if (b) b.innerHTML = Gifts.stars(Gifts.balance()); },

  // плитки коллекционных подарков по кругу меняют модель, фон и узор — показывают, что каждый будет особенным
  cycle(el) {
    const t = setInterval(() => {
      if (!el.isConnected) return clearInterval(t);
      if (document.documentElement.classList.contains("eco-anim")) return;
      const d = Gifts.cat; if (!d) return;
      el.querySelectorAll(".gt-c[data-ck]").forEach((n) => {
        const c = d.collectibles.find((x) => x.coll === n.dataset.ck); if (!c) return;
        const i = (+n.dataset.i || 0) + 1; n.dataset.i = i;
        const art = n.querySelector(".ga"); if (!art) return;
        const b = c.backdrops[(i * 3 + (+n.dataset.o || 0)) % c.backdrops.length];
        art.style.setProperty("--c1", b.c1); art.style.setProperty("--c2", b.c2);
        art.querySelector(".ga-e").style.setProperty("--hue", c.models[i % c.models.length].hue + "deg");
      });
    }, 2300);
  },

  panel(t, u) {
    const d = Gifts.cat;
    if (t === "prem") {
      return `<div class="gs-prem"><div class="gpr-hero"><div class="gpr-rays"></div><div class="gpr-st">${typeof ES !== "undefined" ? ES.svg("star") : GIC.star}</div>
        <i class="gpr-s a">✨</i><i class="gpr-s b">⭐</i><i class="gpr-s c">✨</i><i class="gpr-s d">💫</i></div>
        <h2>${esc(T("Подарите Premium"))}</h2>
        <p>${esc(T("{0} получит эмодзи-статус, свои эмодзи, до 3 реакций на сообщение и другие возможности.", dispName(u)))}</p>
        <div class="gpr-plans">${d.premium.map((p) => {
          const sv = Math.round((1 - p.price / (p.months * Gifts.PM)) * 100);
          return `<button class="gpr-plan" data-pm="${p.months}">${GiftArt.prem(p.months, { s: 54, cls: "mini" })}
            <span class="gpr-t"><b>${p.months} ${esc(plural(p.months, T("месяц"), T("месяца"), T("месяцев")))}</b>${sv > 0 ? `<em>−${sv}%</em>` : ""}<small>${esc(T("{0} в месяц", Math.round(p.price / p.months) + " ⭐"))}</small></span>
            <span class="gpr-pr">${Gifts.stars(p.price)}</span></button>`;
        }).join("")}</div>
        <small class="gs-note">${esc(T("Звёзды спишутся с вашего баланса. Premium начнётся сразу, а {0} получит красивое сообщение с подарком.", dispName(u)))}</small></div>`;
    }
    if (t === "reg") {
      return `<div class="gs-hint">${esc(T("Подарок появится в профиле. Получатель сможет улучшить его до коллекционного."))}</div>
        <div class="gg">${d.regular.map((g) => `<button class="gt" data-gk="${esc(g.key)}">${GiftArt.reg(g)}<b>${esc(g.name)}</b>${Gifts.stars(g.price)}</button>`).join("")}</div>`;
    }
    return `<div class="gs-hint">${esc(T("Коллекционные подарки уникальны: номер, модель, фон и узор выпадают случайно. Их можно поставить в профиль."))}</div>
      <div class="gg">${d.collectibles.map((c, i) => {
        const gone = c.left <= 0;
        const art = GiftArt.nft({ e: c.e, num: i, model: c.models[i % c.models.length], backdrop: c.backdrops[(i * 3) % c.backdrops.length], pattern: c.patterns[i % c.patterns.length] });
        return `<button class="gt gt-c${gone ? " gone" : ""}" data-ck="${esc(c.coll)}" data-i="${i}" data-o="${i}">${art}<b>${esc(c.name)}</b>
          ${gone ? `<span class="gt-l">${esc(T("Распродано"))}</span>` : `${Gifts.stars(c.price)}<span class="gt-l">${esc(T("осталось {0} из {1}", c.left, c.supply))}</span>`}</button>`;
      }).join("")}</div>`;
  },

  // ── покупка: общее окно подтверждения ──
  // o: {user, art, title, sub, price, anon: показать «скрыть имя», run({msg,anon}) → ответ сервера}
  confirm(o) {
    return new Promise((res) => {
      const L = Gifts.layer("gb-ov", `<div class="gb-card" role="dialog">
        <button class="gb-x" data-x aria-label="${esc(T("Закрыть"))}">${GIC.x}</button>
        <div class="gb-art">${o.art}</div><h3>${esc(o.title)}</h3><p class="gb-sub">${esc(o.sub || "")}</p>
        <div class="gb-msg"><textarea rows="1" maxlength="140" placeholder="${esc(T("Добавьте сообщение (необязательно)"))}"></textarea></div>
        ${o.anon === false ? "" : `<div class="gb-anon" role="switch" aria-checked="false" tabindex="0"><span>${esc(T("Скрыть моё имя"))}</span><i class="gb-sw"></i></div>`}
        <button class="gb-buy">${esc(T("Отправить за"))} ${Gifts.stars(o.price)}</button>
        <small class="gb-bal">${esc(T("Ваш баланс: {0}", Gifts.balance() + " ⭐"))}</small></div>`, 128);
      const el = L.el, buy = el.querySelector(".gb-buy"), anon = el.querySelector(".gb-anon"), ta = el.querySelector("textarea");
      if (anon) anon.onclick = () => { const on = anon.getAttribute("aria-checked") !== "true"; anon.setAttribute("aria-checked", on); haptic(); };
      ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(90, ta.scrollHeight) + "px"; });
      let busy = false;
      buy.onclick = async () => {
        if (busy) return; busy = true; buy.classList.add("wait");
        try {
          const d = await o.run({ msg: ta.value.trim(), anon: !!anon && anon.getAttribute("aria-checked") === "true" });
          if (d && d.user) App.user = d.user;
          haptic("medium");
          try { Fx.burst(buy, "party", "🎉"); } catch (e) {}
          toast(T("Подарок отправлен"));
          setTimeout(() => { L.close(); if (o.shop) o.shop.close(); }, 650);
          Gifts.changed(o.user && o.user.id);
          res(d);
        } catch (e) {
          busy = false; buy.classList.remove("wait");
          if (/Недостаточно звёзд|Not enough stars/i.test(e.message)) {
            const v = await UI.sheet({ title: T("Не хватает звёзд"), icon: SI.starF, text: e.message, actions: [{ label: T("Пополнить баланс"), value: "top", accent: true }], cancel: T("Закрыть") });
            if (v === "top") { L.close(); if (o.shop) o.shop.close(); setTimeout(() => Settings.stars(), 300); }
          } else toast(e.message);
        }
      };
    });
  },

  buyPrem(u, months, shop) {
    const p = Gifts.cat.premium.find((x) => x.months === months); if (!p) return;
    return Gifts.confirm({
      user: u, shop, price: p.price, art: GiftArt.prem(months, { s: 120 }),
      title: T("Premium на {0}", months + " " + plural(months, T("месяц"), T("месяца"), T("месяцев"))),
      sub: T("Подарок для {0}: статус, свои эмодзи, реакции и всё остальное.", dispName(u)),
      run: (x) => api("/api/premium/gift", { method: "POST", body: { to: u.id, months, anon: x.anon, msg: x.msg } }),
    });
  },
  buyReg(u, key, shop) {
    const g = Gifts.cat.regular.find((x) => x.key === key); if (!g) return;
    return Gifts.confirm({
      user: u, shop, price: g.price, art: GiftArt.reg(g, { s: 120 }), title: g.name,
      sub: g.up ? T("Подарок появится в профиле. Его можно улучшить до коллекционного.") : T("Подарок появится в профиле."),
      run: (x) => api("/api/gift/send", { method: "POST", body: { to: u.id, key, anon: x.anon, msg: x.msg } }),
    });
  },
  buyCol(u, coll, shop) {
    const c = Gifts.cat.collectibles.find((x) => x.coll === coll); if (!c) return;
    if (c.left <= 0) return toast(T("Эта коллекция распродана"));
    const mk = (i) => GiftArt.nft({ e: c.e, num: 0, model: c.models[i % c.models.length], backdrop: c.backdrops[(i * 3) % c.backdrops.length], pattern: c.patterns[i % c.patterns.length] }, { s: 132 });
    const r = Gifts.confirm({
      user: u, shop, price: c.price, art: mk(0), title: c.name,
      sub: T("Уникальный подарок: номер, модель, фон и узор выпадут случайно. Осталось {0} из {1}.", c.left, c.supply),
      run: (x) => api("/api/gift/send", { method: "POST", body: { to: u.id, key: "c:" + coll, anon: x.anon, msg: x.msg } }),
    });
    // пока окно открыто, рисунок перебирает варианты
    let i = 0; const t = setInterval(() => {
      const h = document.querySelector(".gb-ov .gb-art"); if (!h) return clearInterval(t);
      i++; h.innerHTML = mk(i);
    }, 1700);
    return r;
  },

  // ── окно подарка ──
  async detail(g0) {
    const g = Object.assign({}, g0);
    const prem = String(g.key || "").startsWith("prem:");
    const L = Gifts.layer("gd-ov", `<div class="gd-card" role="dialog"><div class="gd-in"><div class="gs-wait"><span class="spin"></span></div></div></div>`, 127);
    const card = L.el.querySelector(".gd-card");
    let full = g, owner = null;
    if (g.id) { try { const d = await api("/api/gift/" + g.id); full = Object.assign({}, g, d.gift); owner = d.gift.owner || null; } catch (e) { if (!g.name && !prem) { L.close(); return toast(e.message); } } }
    const mine = !!(owner && App.user && owner.id === App.user.id);
    const draw = (G) => {
      const isNft = !!G.nft, wornId = App.user && App.user.nft ? App.user.nft.gid : 0, worn = isNft && wornId === G.id;
      const from = G.from ? `<button class="gd-u" data-u="${G.from.id}">${avatar({ id: G.from.id, name: G.from.name, avatar: G.from.avatar }, "sm")}<span>${esc(dispName(G.from))}</span></button>`
        : `<span class="gd-u off">${GIC.lock}<span>${esc(G.from_me ? T("Вы (имя скрыто)") : T("Скрытый отправитель"))}</span></span>`;
      const n = G.nft;
      const ownerRow = isNft && owner && !mine ? [T("Владелец"), `<button class="gd-u" data-u="${owner.id}">${avatar({ id: owner.id, name: owner.name, avatar: owner.avatar }, "sm")}<span>${esc(dispName(owner))}</span></button>`] : null;
      const rows = [
        [T("От"), from],
        ...(ownerRow ? [ownerRow] : []),
        [T("Дата"), esc(Gifts.date(G.ts))],
        [T("Стоимость"), Gifts.stars(G.price)],
      ];
      if (n) rows.push([T("Модель"), `${esc(n.model.n)}<em>${n.model.r}%</em>`], [T("Фон"), `${esc(n.backdrop.n)}<em>${n.backdrop.r}%</em>`], [T("Узор"), `${esc(n.pattern.n)}<em>${n.pattern.r}%</em>`]);
      if (prem && G.until && mine) rows.push([T("Premium до"), esc(Gifts.date(G.until))]);
      if (mine && G.can_sell) rows.push([T("Продажа доступна до"), esc(Gifts.date(G.sell_until))]);
      const act = [];
      if (mine && !prem) {
        if (isNft) act.push(`<button class="gd-b main" data-a="equip">${GIC.wear}${esc(worn ? T("Снять с профиля") : T("Поставить в профиль"))}</button>`);
        if (!isNft && G.up) act.push(`<button class="gd-b main" data-a="up">${GIC.up}${esc(T("Улучшить до коллекционного"))} ${Gifts.stars(G.up)}</button>`);
        act.push(`<div class="gd-row2"><button class="gd-b" data-a="show">${G.shown ? GIC.eyeOff : GIC.eye}${esc(G.shown ? T("Скрыть") : T("Показать"))}</button>
          <button class="gd-b" data-a="pin" ${G.shown ? "" : "disabled"}>${GIC.pin}${esc(G.pin ? T("Открепить") : T("Закрепить"))}</button></div>`);
        if (G.can_sell) act.push(`<button class="gd-b sell" data-a="sell">${GIC.star}${esc(T("Продать за {0}", G.sell_price + " ⭐"))}</button>`);
        else if (G.sold) act.push(`<div class="gd-sold">${esc(T("Подарок продан"))}</div>`);
      }
      card.querySelector(".gd-in").innerHTML = `
        <button class="gd-x" data-x aria-label="${esc(T("Закрыть"))}">${GIC.x}</button>
        <div class="gd-hero${isNft ? " nft" : ""}">${GiftArt.html(G, { cls: "wide", s: 196 })}</div>
        <h2>${esc(Gifts.title(G))}</h2>
        <div class="gd-sub">${isNft ? esc(T("Коллекционный подарок · {0} из {1}", "№" + n.num, n.supply)) : prem ? esc(T("Подарок: Premium")) : esc(T("Подарок"))}</div>
        ${G.msg ? `<blockquote class="gd-q">${esc(G.msg)}</blockquote>` : ""}
        <div class="gd-rows">${rows.map(([k, v]) => `<div class="gd-r"><span>${esc(k)}</span><b>${v}</b></div>`).join("")}</div>
        ${act.length ? `<div class="gd-acts">${act.join("")}</div>` : ""}`;
      card.querySelector("[data-x]").onclick = L.close;
    };
    draw(full);
    card.addEventListener("click", async (e) => {
      const u = e.target.closest("[data-u]");
      if (u) {
        const uid = +u.dataset.u;
        const src = owner && owner.id === uid ? owner : full.from;
        L.close();
        return setTimeout(() => UserProfile.open({ id: uid, name: src.name, surname: src.surname || "", avatar: src.avatar || "", username: "", bio: "" }), 280);
      }
      const b = e.target.closest("[data-a]"); if (!b || b.disabled) return;
      haptic();
      const a = b.dataset.a;
      try {
        if (a === "show") { const d = await api("/api/gift/show", { method: "POST", body: { id: full.id, shown: !full.shown } }); full = Object.assign(full, d.gift); draw(full); toast(T(full.shown ? "Подарок виден в профиле" : "Подарок скрыт из профиля")); }
        else if (a === "pin") { const d = await api("/api/gift/show", { method: "POST", body: { id: full.id, pin: !full.pin } }); full = Object.assign(full, d.gift); draw(full); toast(T(full.pin ? "Подарок закреплён" : "Подарок откреплён")); }
        else if (a === "equip") {
          const worn = App.user.nft && App.user.nft.gid === full.id;
          if (!worn && !App.user.premium) { L.close(); return setTimeout(() => PremiumPromo.open(App.user), 280); }
          const d = await api("/api/gift/equip", { method: "POST", body: { id: worn ? 0 : full.id } });
          App.user = d.user; draw(full); toast(T(worn ? "Подарок снят" : "Подарок в профиле"));
        } else if (a === "up") {
          const ok = await UI.sheet({ title: T("Улучшить подарок?"), icon: SI.starF, text: T("Подарок станет коллекционным: ему выпадут номер, модель, фон и узор. Стоимость: {0} ⭐.", full.up), actions: [{ label: T("Улучшить"), value: "go", accent: true }] });
          if (ok !== "go") return;
          b.disabled = true;
          const d = await api("/api/gift/upgrade", { method: "POST", body: { id: full.id } });
          App.user = d.user;
          full = Object.assign({}, full, d.gift, { owner });
          draw(full);
          const h = card.querySelector(".gd-hero"); if (h) { h.classList.add("reveal"); try { Fx.burst(h, "star", "⭐"); Fx.burst(h, "party", "🎉"); } catch (x) {} }
          haptic("medium");
        } else if (a === "sell") {
          const price = full.sell_price;
          const ok = await UI.sheet({ title: T("Продать подарок?"), icon: SI.starF, text: T("Подарок исчезнет из профиля, а на баланс поступит {0} ⭐. Отменить это нельзя.", price), actions: [{ label: T("Продать"), value: "go", accent: true }] });
          if (ok !== "go") return;
          b.disabled = true;
          const d = await api("/api/gift/sell", { method: "POST", body: { id: full.id } });
          App.user = d.user;
          full = Object.assign({}, full, d.gift, { owner });
          toast(T("Подарок продан за {0}", price + " ⭐"));
          L.close();
        }
        Gifts.changed(App.user.id);
      } catch (x) { toast(x.message); }
    });
  },

  // ── карточка подарка в переписке ──
  cardHTML(m, isNew) {
    const g = m.gift || {}, out = m.sender === App.user.id;
    const peer = Chat.peer, who = peer ? dispName(peer) : "";
    let head;
    if (out) head = T("Вы подарили подарок: {0}", who);
    else if (g.anon || (m.sender === 1 && peer && peer.is_system)) head = T("Вам подарили подарок. Отправитель скрыт");
    else head = T("{0} дарит вам подарок", who);
    const prem = String(g.key || "").startsWith("prem:"), n = g.nft;
    const name = prem ? Gifts.title(g) : (g.name || T("Подарок")) + (n ? " №" + n.num : "");
    return `<div class="gcard${isNew ? " new" : ""}" data-k="${mkey(m)}"${m.id ? ` data-id="${m.id}"` : ""} data-gift="1" role="button" tabindex="0">
      <span class="gc-h">${esc(head)}</span>${GiftArt.html(g, { s: 112 })}
      <b class="gc-n">${esc(name)}</b>${g.msg ? `<span class="gc-m">${esc(g.msg)}</span>` : ""}
      <span class="gc-b">${esc(prem ? T("Открыть") : T("Посмотреть"))}</span></div>`;
  },
};
