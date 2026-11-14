// maint.js — экран «Технические работы». Показывается:
//  • сразу при запуске, если работы идут и человек не вошёл (Maint.check — до экрана приветствия и входа/регистрации);
//  • когда сервер отвечает 503 {maintenance:true} или присылает событие «maint» по WebSocket.
// Сам опрашивает /api/maintenance и закрывается, когда работы закончены. Вход и регистрация на сервере закрыты для всех, кроме белого списка.
const Maint = {
  el: null, tmr: 0, tick: 0, d: null, shown: false,
  css() {
    if (document.getElementById("maint-css")) return;
    const s = document.createElement("style"); s.id = "maint-css";
    s.textContent = `
#maint{position:fixed;inset:0;z-index:99990;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:max(22px,env(safe-area-inset-top)) 22px max(22px,env(safe-area-inset-bottom));background:var(--bg,#0F141B);color:var(--text,#EAF0F7);text-align:center;opacity:0;transition:opacity .22s}
#maint.show{opacity:1}
#maint .mt-bg{position:absolute;inset:0;pointer-events:none;overflow:hidden}
#maint .mt-bg i{position:absolute;border-radius:50%;filter:blur(64px);opacity:.5;will-change:transform}
#maint .mt-bg i:nth-child(1){width:300px;height:300px;left:-90px;top:-70px;background:#F5A623;animation:mtDrift 14s ease-in-out infinite alternate}
#maint .mt-bg i:nth-child(2){width:340px;height:340px;right:-120px;bottom:-110px;background:var(--accent,#4F9BFF);animation:mtDrift 17s ease-in-out infinite alternate-reverse}
#maint .mt-bg i:nth-child(3){width:220px;height:220px;right:-40px;top:22%;background:#F2603F;opacity:.28;animation:mtDrift 19s ease-in-out infinite alternate}
@keyframes mtDrift{to{transform:translate(46px,38px) scale(1.18)}}
#maint .mt-in{position:relative;display:flex;flex-direction:column;align-items:center;gap:12px;width:min(380px,100%);animation:mtIn .5s cubic-bezier(.2,.8,.2,1) both}
@keyframes mtIn{from{opacity:0;transform:translateY(16px) scale(.97)}}
#maint .mt-ic{position:relative;width:128px;height:128px;border-radius:38px;display:grid;place-items:center;color:#fff;background:linear-gradient(140deg,#F8B739,#F2603F);box-shadow:0 18px 46px rgba(242,96,63,.38),inset 0 1px 0 rgba(255,255,255,.35)}
#maint .mt-ic::after{content:"";position:absolute;inset:-10px;border-radius:46px;border:2px solid rgba(242,96,63,.5);animation:mtPulse 2.4s ease-out infinite}
@keyframes mtPulse{from{transform:scale(.94);opacity:.9}to{transform:scale(1.22);opacity:0}}
#maint .mt-ic svg{width:92px;height:92px;overflow:visible}
#maint .mt-g1{transform-origin:40px 44px;animation:mtSpin 9s linear infinite}
#maint .mt-g2{transform-origin:84px 82px;animation:mtSpin 6.2s linear infinite reverse}
@keyframes mtSpin{to{transform:rotate(360deg)}}
#maint .mt-chip{display:inline-flex;align-items:center;gap:8px;margin-top:10px;padding:6px 13px;border-radius:99px;font-size:12.5px;font-weight:800;letter-spacing:.2px;color:#F5A623;background:rgba(245,166,35,.14);border:1px solid rgba(245,166,35,.32)}
#maint .mt-chip b{width:8px;height:8px;border-radius:50%;background:#F5A623;animation:mtBlink 1.3s ease-in-out infinite}
@keyframes mtBlink{50%{opacity:.25;transform:scale(.7)}}
#maint h2{margin:2px 0 0;font-size:27px;line-height:1.15;font-weight:800;letter-spacing:-.3px}
#maint .mt-r{margin:0;max-width:340px;font-size:15.5px;line-height:1.45;color:var(--dim,#8794A8);white-space:pre-line;overflow-wrap:anywhere}
#maint .mt-eta{align-self:stretch;margin-top:6px;padding:15px 18px 16px;border-radius:20px;background:color-mix(in srgb,var(--surface,#18202B) 82%,transparent);border:1px solid var(--line,#26303E);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
#maint .mt-eta small{display:block;font-size:12.5px;color:var(--dim,#8794A8);margin-bottom:4px}
#maint .mt-eta b{display:block;font-size:18px;font-weight:800}
#maint .mt-eta i{display:block;font-style:normal;font-size:13.5px;color:#F5A623;margin-top:4px;font-weight:700}
#maint .mt-bar{height:7px;margin-top:12px;border-radius:9px;background:var(--line,#26303E);overflow:hidden}
#maint .mt-bar span{display:block;height:100%;width:0;border-radius:9px;background:linear-gradient(90deg,#F8B739,#F2603F);position:relative;transition:width .6s cubic-bezier(.3,.8,.3,1)}
#maint .mt-bar span::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent);transform:translateX(-100%);animation:mtShine 2s ease-in-out infinite}
@keyframes mtShine{to{transform:translateX(100%)}}
#maint .mt-n{align-self:stretch;display:flex;flex-direction:column;gap:7px;margin-top:2px;text-align:left}
#maint .mt-n div{display:flex;align-items:center;gap:10px;padding:10px 13px;border-radius:14px;font-size:13.5px;line-height:1.3;color:var(--dim,#8794A8);background:color-mix(in srgb,var(--surface,#18202B) 60%,transparent)}
#maint .mt-n svg{flex:none;width:19px;height:19px;color:var(--accent,#4F9BFF)}
#maint .mt-b{margin-top:8px;display:flex;flex-direction:column;gap:6px;align-self:stretch}
#maint button{padding:14px 18px;border-radius:15px;font-weight:800;font-size:15px;background:var(--accent,#4F9BFF);color:#fff;transition:transform .12s,filter .12s}
#maint button:active{transform:scale(.97);filter:brightness(.92)}
#maint button.g{background:transparent;color:var(--dim,#8794A8);font-weight:700;font-size:13.5px;padding:9px}
@media (max-height:640px){#maint .mt-ic{width:92px;height:92px;border-radius:28px}#maint .mt-ic svg{width:64px;height:64px}#maint .mt-n{display:none}}
@media (prefers-reduced-motion:reduce){#maint *{animation:none!important}}`;
    document.head.appendChild(s);
  },
  // контур шестерёнки: n зубцев, радиус впадин r, радиус вершин R
  gear(cx, cy, R, r, n) {
    const pts = [];
    for (let i = 0; i < n * 4; i++) {
      const a = (Math.PI * 2 * i) / (n * 4) - Math.PI / 2, rad = i % 4 === 1 || i % 4 === 2 ? R : r;
      pts.push((cx + Math.cos(a) * rad).toFixed(1) + "," + (cy + Math.sin(a) * rad).toFixed(1));
    }
    return `<polygon points="${pts.join(" ")}" /><circle cx="${cx}" cy="${cy}" r="${(r * 0.42).toFixed(1)}"/>`;
  },
  left(until) {
    const s = until - Math.floor(Date.now() / 1000);
    if (s <= 0) return T("Работы немного затянулись — скоро всё заработает");
    const h = Math.floor(s / 3600), m = Math.ceil((s % 3600) / 60);
    return T("Осталось примерно {0}", h ? T("{0} ч {1} мин", h, m === 60 ? 59 : m) : T("{0} мин", Math.max(1, m)));
  },
  pct(d) {
    const now = Date.now() / 1000, a = +d.since || 0, b = +d.until || 0;
    if (!b || b <= a) return 0;
    return Math.max(4, Math.min(97, Math.round(((now - a) / (b - a)) * 100)));
  },
  show(d) {
    Maint.d = d = Object.assign({}, Maint.d || {}, d || {});
    Maint.css();
    let el = Maint.el;
    if (!el) {
      el = Maint.el = document.createElement("div"); el.id = "maint"; el.setAttribute("role", "alert");
      document.body.appendChild(el); void el.offsetWidth; el.classList.add("show");
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-r]")) return Maint.poll(true);
        if (e.target.closest("[data-x]")) return Maint.hide();
      });
    }
    const until = +d.until || 0;
    const when = until ? new Date(until * 1000).toLocaleString(I18N.loc, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "";
    const authed = !!(typeof Store !== "undefined" && Store.token);
    const ni = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    el.innerHTML = `<div class="mt-bg"><i></i><i></i><i></i></div><div class="mt-in">
      <div class="mt-ic"><svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linejoin="round" stroke-linecap="round"><g class="mt-g1">${Maint.gear(40, 44, 33, 25, 9)}</g><g class="mt-g2">${Maint.gear(84, 82, 22, 16, 7)}</g></svg></div>
      <span class="mt-chip"><b></b>${esc(T("Идут технические работы"))}</span>
      <h2>${esc(T("Технические работы"))}</h2>
      <p class="mt-r">${esc(d.reason || T("Мы улучшаем Dicegram. Скоро всё заработает — зайдите чуть позже."))}</p>
      ${until ? `<div class="mt-eta"><small>${esc(T("Примерное окончание"))}</small><b>${esc(when)}</b><i data-left>${esc(Maint.left(until))}</i>${d.since ? `<div class="mt-bar"><span data-bar style="width:${Maint.pct(d)}%"></span></div>` : ""}</div>` : ""}
      <div class="mt-n">
        <div>${ni('<path d="M12 3 5 6v5c0 4.4 2.8 8.3 7 10 4.2-1.7 7-5.6 7-10V6l-7-3z"/><path d="m9 12 2 2 4-4"/>')}<span>${esc(T("Ваши сообщения и данные в безопасности"))}</span></div>
        <div>${ni('<rect x="4" y="11" width="16" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>')}<span>${esc(T("Вход и регистрация временно недоступны"))}</span></div>
      </div>
      <div class="mt-b"><button type="button" data-r>${esc(T("Проверить снова"))}</button>${authed ? "" : `<button type="button" class="g" data-x>${esc(T("Вход для администратора"))}</button>`}</div></div>`;
    Maint.shown = true;
    clearInterval(Maint.tick);
    Maint.tick = setInterval(() => {
      const i = el.querySelector("[data-left]"); if (i && Maint.d && Maint.d.until) i.textContent = Maint.left(Maint.d.until);
      const b = el.querySelector("[data-bar]"); if (b && Maint.d) b.style.width = Maint.pct(Maint.d) + "%";
    }, 20000);
    clearInterval(Maint.tmr); Maint.tmr = setInterval(() => Maint.poll(), 15000);
  },
  // при запуске без входа: если работы идут — сразу экран, раньше приветствия и формы входа/регистрации
  async check() {
    try {
      const ctl = window.AbortController ? new AbortController() : null, tm = ctl ? setTimeout(() => ctl.abort(), 4000) : 0;
      const r = await fetch(CONFIG.API + "/api/maintenance", { cache: "no-store", signal: ctl ? ctl.signal : undefined }); clearTimeout(tm);
      const d = await r.json();
      if (d && d.ok && d.on) { Maint.show(d); return true; }
    } catch (e) {}
    return false;
  },
  async poll(manual) {
    try {
      const r = await fetch(CONFIG.API + "/api/maintenance", { cache: "no-store" }), d = await r.json();
      if (d && d.ok && !d.on) {
        const authed = !!(typeof Store !== "undefined" && Store.token);
        Maint.hide();
        if (authed || manual) location.reload();
      } else if (d && d.on) { Maint.show(d); if (manual && typeof toast === "function") toast(T("Работы ещё идут")); }
    } catch (e) { if (manual && typeof toast === "function") toast(T("Нет связи с сервером")); }
  },
  hide() {
    clearInterval(Maint.tmr); clearInterval(Maint.tick);
    const el = Maint.el; Maint.el = null; Maint.shown = false;
    if (el) { el.classList.remove("show"); setTimeout(() => el.remove(), 260); }
  },
};
