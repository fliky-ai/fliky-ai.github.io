// maint.js — экран «Технические работы». Показывается, когда сервер отвечает 503 {maintenance:true}
// или присылает событие «maint» по WebSocket. Сам опрашивает /api/maintenance и закрывается, когда работы закончены.
const Maint = {
  el: null, tmr: 0, tick: 0, d: null, shown: false,
  css() {
    if (document.getElementById("maint-css")) return;
    const s = document.createElement("style"); s.id = "maint-css";
    s.textContent = `
#maint{position:fixed;inset:0;z-index:99990;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:max(24px,env(safe-area-inset-top)) 24px max(24px,env(safe-area-inset-bottom));background:var(--bg,#0f1115);color:var(--text,#fff);text-align:center;opacity:0;transition:opacity .25s}
#maint.show{opacity:1}
#maint .mt-ic{width:104px;height:104px;border-radius:30px;display:grid;place-items:center;color:#fff;background:linear-gradient(140deg,#F5A623,#F2603F);box-shadow:0 14px 38px rgba(242,96,63,.35)}
#maint .mt-ic svg{width:56px;height:56px;animation:mtSpin 6s linear infinite}
@keyframes mtSpin{to{transform:rotate(360deg)}}
#maint h2{margin:8px 0 0;font-size:25px;font-weight:800}
#maint p{margin:0;max-width:340px;font-size:15.5px;line-height:1.45;color:var(--dim,#9aa3b2);white-space:pre-line;overflow-wrap:anywhere}
#maint .mt-eta{margin-top:6px;padding:14px 18px;border-radius:18px;background:var(--surface,#1a1d24);min-width:240px}
#maint .mt-eta small{display:block;font-size:12.5px;color:var(--dim,#9aa3b2);margin-bottom:4px}
#maint .mt-eta b{display:block;font-size:17px;font-weight:800}
#maint .mt-eta i{display:block;font-style:normal;font-size:13px;color:var(--accent,#4F9BFF);margin-top:3px;font-weight:700}
#maint .mt-b{margin-top:10px;display:flex;flex-direction:column;gap:8px;width:min(300px,100%)}
#maint button{padding:13px 18px;border-radius:14px;font-weight:800;font-size:15px;background:var(--accent,#4F9BFF);color:#fff}
#maint button.g{background:transparent;color:var(--accent,#4F9BFF)}
@media (prefers-reduced-motion:reduce){#maint .mt-ic svg{animation:none}}`;
    document.head.appendChild(s);
  },
  left(until) {
    const s = until - Math.floor(Date.now() / 1000);
    if (s <= 0) return T("Работы немного затянулись — скоро всё заработает");
    const h = Math.floor(s / 3600), m = Math.ceil((s % 3600) / 60);
    return T("Осталось примерно {0}", h ? T("{0} ч {1} мин", h, m === 60 ? 59 : m) : T("{0} мин", Math.max(1, m)));
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
    el.innerHTML = `<div class="mt-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.6M12 18.9v2.6M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2.5 12h2.6M18.9 12h2.6M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg></div>
      <h2>${esc(T("Технические работы"))}</h2>
      <p>${esc(d.reason || T("Мы улучшаем Dicegram. Скоро всё заработает — зайдите чуть позже."))}</p>
      ${until ? `<div class="mt-eta"><small>${esc(T("Примерное окончание"))}</small><b>${esc(when)}</b><i data-left>${esc(Maint.left(until))}</i></div>` : ""}
      <div class="mt-b"><button type="button" data-r>${esc(T("Проверить снова"))}</button>${authed ? "" : `<button type="button" class="g" data-x>${esc(T("Закрыть"))}</button>`}</div>`;
    Maint.shown = true;
    clearInterval(Maint.tick); Maint.tick = setInterval(() => { const i = el.querySelector("[data-left]"); if (i && Maint.d && Maint.d.until) i.textContent = Maint.left(Maint.d.until); }, 20000);
    clearInterval(Maint.tmr); Maint.tmr = setInterval(() => Maint.poll(), 15000);
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
