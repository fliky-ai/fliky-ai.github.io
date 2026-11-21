// avview.js — полноэкранный просмотр фото (аватарки своего и чужих профилей, участников в списках):
//   • открывается «из аватарки» и возвращается в неё (как в Telegram), чёрный фон проявляется плавно;
//   • щипок двумя пальцами — масштаб вокруг центра щипка, двойное касание — приблизить/вернуть, перетаскивание приближенного фото
//     с границами и «резинкой»; колесо мыши на компьютере;
//   • смахивание вниз (или вверх) закрывает: фото следует за пальцем, фон светлеет, быстрый бросок закрывает сразу;
//   • сверху «закрыть», имя и «⋮» → «Сохранить в галерею»; одиночное касание прячет/показывает верхнюю панель.
const PHV_I = {
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="9" cy="9.2" r="1.7"/><path d="m21 15.5-4.6-4.6a1.6 1.6 0 0 0-2.3 0L5 20"/></svg>',
};

const PHV = {
  cur: null,

  // человек: открыть его фото профиля. from — элемент аватарки (откуда «вылетает» фото). false — фото нет.
  avatar(u, from) {
    if (!u || !u.avatar) return false;
    PHV.open({ src: avatarUrl(u), title: dispName(u), sub: u.username ? "@" + u.username : "", from, fname: "dicegram-" + (u.username || u.id || "photo") });
    return true;
  },
  // группа/канал: то же самое, у них тоже есть фото
  open(o) {
    if (PHV.cur) PHV.hide(true);
    const lite = document.documentElement.classList.contains("lite") || document.documentElement.classList.contains("eco-anim");
    const el = document.createElement("div");
    el.className = "phv";
    el.innerHTML = `<div class="phv-bg"></div>
      <div class="phv-st"><div class="phv-img"><img alt="" draggable="false"></div><div class="phv-load"><i></i></div></div>
      <div class="phv-top"><button class="phv-b" data-a="x" aria-label="${esc(T("Закрыть"))}">${PHV_I.x}</button>
        <div class="phv-t"><b>${esc(o.title || "")}</b>${o.sub ? `<small>${esc(o.sub)}</small>` : ""}</div>
        <button class="phv-b" data-a="more" aria-label="${esc(T("Ещё"))}">${PHV_I.dots}</button></div>
      <div class="phv-menu" hidden><button data-a="save">${PHV_I.save}<span>${esc(T("Сохранить в галерею"))}</span></button></div>`;
    document.body.appendChild(el);
    const bg = el.querySelector(".phv-bg"), st = el.querySelector(".phv-st"), box = el.querySelector(".phv-img"), img = box.querySelector("img"), menu = el.querySelector(".phv-menu");
    const S = { s: 1, x: 0, y: 0 }, V = { w: 0, h: 0, vw: innerWidth, vh: innerHeight, bgA: 1 };
    const C = (PHV.cur = { el, o, src: o.src, S, V, closing: false, ready: false });
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const apply = (anim, ms) => {
      box.style.transition = anim ? `transform ${ms || 0.28}s cubic-bezier(.2,.85,.25,1), border-radius .28s` : "none";
      box.style.transform = `translate3d(${S.x}px,${S.y}px,0) scale(${S.s})`;
    };
    const setBg = (a, anim) => { bg.style.transition = anim ? "opacity .28s" : "none"; bg.style.opacity = String(a); V.bgA = a; };
    const bounds = (s) => ({ mx: Math.max(0, (V.w * s - V.vw) / 2), my: Math.max(0, (V.h * s - V.vh) / 2) });
    const settle = (anim) => {          // вернуть в допустимые границы
      S.s = clamp(S.s, 1, 6);
      const b = bounds(S.s); S.x = clamp(S.x, -b.mx, b.mx); S.y = clamp(S.y, -b.my, b.my);
      if (S.s === 1) { S.x = 0; S.y = 0; }
      apply(anim); setBg(1, anim);
    };
    const resist = (v, lim) => (v > lim ? lim + (v - lim) * 0.35 : v < -lim ? -lim + (v + lim) * 0.35 : v);

    const measure = () => {
      V.vw = innerWidth; V.vh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--vh")) || innerHeight;
      const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1, k = Math.min(V.vw / nw, V.vh / nh);
      V.w = Math.round(nw * k); V.h = Math.round(nh * k);
      box.style.width = V.w + "px"; box.style.height = V.h + "px"; box.style.marginLeft = -V.w / 2 + "px"; box.style.marginTop = -V.h / 2 + "px";
    };
    const srcRect = () => {
      const f = C.o.from; if (!f || !f.isConnected) return null;
      const r = f.getBoundingClientRect();
      return r.width > 4 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth ? r : null;
    };
    // положение «в аватарке»: центр и масштаб
    const asFrom = (r) => ({ x: r.left + r.width / 2 - V.vw / 2, y: r.top + r.height / 2 - V.vh / 2, s: Math.max(r.width / V.w, r.height / V.h) });

    img.onload = () => {
      measure(); C.ready = true; el.classList.add("ready");
      const r = !lite && srcRect();
      if (r) {
        const f = asFrom(r);
        box.style.borderRadius = "50%"; S.s = f.s; S.x = f.x; S.y = f.y; apply(false); setBg(0, false);
        void box.offsetWidth;
        S.s = 1; S.x = 0; S.y = 0; box.style.borderRadius = "0"; apply(true, 0.34); setBg(1, true);
      } else { S.s = lite ? 1 : 0.92; apply(false); setBg(0, false); void box.offsetWidth; S.s = 1; box.style.opacity = "1"; apply(true, 0.22); setBg(1, true); }
    };
    img.onerror = () => { toast(T("Не удалось загрузить фото")); PHV.hide(true); };
    img.src = o.src;
    requestAnimationFrame(() => el.classList.add("show"));
    C.release = Nav.layer(() => PHV.hide());
    window.addEventListener("resize", C.onResize = () => { if (!C.ready) return; measure(); settle(false); });

    // ── закрытие: назад «в аватарку» или вниз ──
    C.finish = () => { if (C.finished) return; C.finished = true; if (C.release) C.release(); };      // убрать слой из стека «назад» (после него вызовется hide)
    C.go = (fromDrag) => {
      if (C.closing) return; C.closing = true; menu.hidden = true;
      setTimeout(C.finish, fromDrag ? 240 : 320);
      el.classList.add("out");
      const r = !lite && !fromDrag && srcRect();
      if (r) { const f = asFrom(r); S.s = f.s; S.x = f.x; S.y = f.y; box.style.borderRadius = "50%"; apply(true, 0.3); }
      else if (fromDrag) { S.y += (S.y >= 0 ? 1 : -1) * V.vh * 0.5; apply(true, 0.22); box.style.opacity = "0"; box.style.transition += ",opacity .22s"; }
      else { S.s = 0.92; apply(true, 0.2); box.style.opacity = "0"; box.style.transition += ",opacity .2s"; }
      setBg(0, true);
    };

    // ── жесты ──
    const pts = new Map(); let g = null, tapT = 0, tapTimer = 0, lastTap = { t: 0, x: 0, y: 0 };
    const dist = () => { const p = [...pts.values()]; return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1; };
    const mid = () => { const p = [...pts.values()]; return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }; };
    const startDrag = (p) => { g = { mode: "", x0: p.x, y0: p.y, sx: S.x, sy: S.y, t0: Date.now(), vy: 0, ly: p.y, lt: Date.now(), moved: 0 }; };
    st.addEventListener("pointerdown", (e) => {
      if (!C.ready || C.closing) return;
      if (!menu.hidden && !e.target.closest(".phv-menu")) { menu.hidden = true; }
      try { st.setPointerCapture(e.pointerId); } catch (er) {}
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { const m = mid(); g = { mode: "pinch", d: dist(), s0: S.s, x0: S.x, y0: S.y, mx: m.x, my: m.y }; box.style.borderRadius = "0"; }
      else if (pts.size === 1) startDrag(pts.get(e.pointerId));
    });
    st.addEventListener("pointermove", (e) => {
      const p = pts.get(e.pointerId); if (!p || !g || C.closing) return;
      p.x = e.clientX; p.y = e.clientY;
      if (g.mode === "pinch" && pts.size === 2) {
        const m = mid(), s1 = clamp(g.s0 * dist() / g.d, 0.6, 7);
        const qx = (g.mx - V.vw / 2 - g.x0) / g.s0, qy = (g.my - V.vh / 2 - g.y0) / g.s0;
        S.s = s1; S.x = m.x - V.vw / 2 - qx * s1; S.y = m.y - V.vh / 2 - qy * s1;
        apply(false); return;
      }
      if (pts.size !== 1) return;
      const dx = p.x - g.x0, dy = p.y - g.y0;
      g.moved = Math.max(g.moved, Math.hypot(dx, dy));
      const now = Date.now(); if (now - g.lt > 0) { g.vy = (p.y - g.ly) / (now - g.lt); g.ly = p.y; g.lt = now; }
      if (!g.mode && g.moved > 8) g.mode = S.s > 1.02 ? "pan" : "dismiss";
      if (g.mode === "pan") {
        const b = bounds(S.s);
        S.x = resist(g.sx + dx, b.mx); S.y = resist(g.sy + dy, b.my); apply(false);
      } else if (g.mode === "dismiss") {
        S.x = dx; S.y = dy; S.s = 1 - Math.min(Math.abs(dy), 320) / 1400;
        apply(false); setBg(1 - Math.min(Math.abs(dy) / 360, 0.75), false);
        el.classList.add("drag");
      }
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (!g || C.closing) { if (!pts.size) g = null; return; }
      if (g.mode === "pinch") {
        settle(true);
        if (pts.size === 1) startDrag([...pts.values()][0]); else g = null;
        return;
      }
      if (pts.size) return;
      const gg = g; g = null; el.classList.remove("drag");
      if (gg.mode === "dismiss") {
        if (Math.abs(S.y) > 110 || Math.abs(gg.vy) > 0.65) return C.go(true);
        S.s = 1; S.x = 0; S.y = 0; apply(true, 0.26); setBg(1, true); return;
      }
      if (gg.mode === "pan") { settle(true); return; }
      // касание без сдвига
      if (e.type !== "pointerup") return;
      const now = Date.now();
      if (now - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
        clearTimeout(tapTimer); lastTap.t = 0;
        if (S.s > 1.05) { S.s = 1; S.x = 0; S.y = 0; }
        else {
          const ns = Math.min(3, Math.max(2.4, V.vh / V.h > 1 ? V.vh / V.h : 2.4)), qx = (e.clientX - V.vw / 2 - S.x) / S.s, qy = (e.clientY - V.vh / 2 - S.y) / S.s;
          S.s = ns; S.x = e.clientX - V.vw / 2 - qx * ns; S.y = e.clientY - V.vh / 2 - qy * ns;
        }
        settle(true); return;
      }
      lastTap = { t: now, x: e.clientX, y: e.clientY };
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { if (!C.closing) el.classList.toggle("nochrome"); menu.hidden = true; }, 290);
    };
    st.addEventListener("pointerup", up);
    st.addEventListener("pointercancel", up);
    st.addEventListener("wheel", (e) => {
      if (!C.ready || C.closing) return; e.preventDefault();
      const k = e.deltaY < 0 ? 1.18 : 1 / 1.18, ns = clamp(S.s * k, 1, 6), qx = (e.clientX - V.vw / 2 - S.x) / S.s, qy = (e.clientY - V.vh / 2 - S.y) / S.s;
      S.s = ns; S.x = e.clientX - V.vw / 2 - qx * ns; S.y = e.clientY - V.vh / 2 - qy * ns; settle(true);
    }, { passive: false });

    // ── кнопки ──
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]");
      if (!b) { if (!menu.hidden && !e.target.closest(".phv-menu")) menu.hidden = true; return; }
      const a = b.dataset.a;
      if (a === "x") return PHV.close();
      if (a === "more") { menu.hidden = !menu.hidden; return; }
      if (a === "save") { menu.hidden = true; PHV.save(); }
    });
    document.addEventListener("keydown", C.onKey = (e) => { if (e.key === "Escape") PHV.close(); });
    return C;
  },

  close() { const C = PHV.cur; if (!C || C.closing) return; C.go(false); },
  hide(now) {
    const C = PHV.cur; if (!C) return; PHV.cur = null;
    try { window.removeEventListener("resize", C.onResize); document.removeEventListener("keydown", C.onKey); } catch (e) {}
    C.finished = true;
    if (now) return C.el.remove();
    if (!C.closing) C.go(false);
    setTimeout(() => C.el.remove(), 300);
  },

  // сохранить в галерею телефона: сначала родной модуль APK (если есть), иначе обычная загрузка файла
  async save() {
    const C = PHV.cur; if (!C) return;
    const url = C.src, base = C.o.fname || "dicegram-photo";
    let blob = null;
    try { blob = await (await fetch(url, { mode: "cors" })).blob(); } catch (e) {}
    try {
      const M = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Media;
      if (M && typeof M.savePhoto === "function" && blob) {
        const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
        await M.savePhoto({ path: data, fileName: base });
        return toast(T("Фото сохранено в галерею"));
      }
    } catch (e) {}
    try {
      const ext = blob && /png/.test(blob.type) ? ".png" : blob && /webp/.test(blob.type) ? ".webp" : ".jpg";
      Attach.saveDevice({ url: blob ? URL.createObjectURL(blob) : url, name: base + ext, mime: (blob && blob.type) || "image/jpeg" });
      toast(T("Фото сохраняется на телефон"));
    } catch (e) { toast(T("Не удалось сохранить фото")); }
  },
};
