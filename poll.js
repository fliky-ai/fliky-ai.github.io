// poll.js — опросы в личных чатах, группах и каналах.
//   • создание: вопрос, 2–10 вариантов (новая строка появляется сама), «анонимный», «несколько ответов», «можно менять голос»;
//   • пузырь: пока не голосовал — кружки; после голоса — проценты и полосы, которые плавно «заполняются»; свой выбор отмечен галочкой;
//   • один ответ — голос уходит по касанию; несколько — отмечаете и жмёте «Проголосовать»; «Отозвать голос», если автор разрешил;
//   • результаты: окно со всеми вариантами; в неанонимном опросе — кто за что проголосовал (нажатие → профиль, аватар → фото);
//   • завершить опрос может автор (и администратор группы или канала): в меню сообщения; после этого голосовать нельзя;
//   • у всех участников цифры обновляются сами (сервер присылает событие «poll» по WebSocket).
const PLI = {
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5.500 12.500 4.500 4.500L19 7.500"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  bars: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20V11M12 20V4M19 20v-6"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><rect x="9" y="9" width="6" height="6" rx="1.500"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
};

const Poll = {
  MAX_Q: 255, MAX_O: 100, MAX_N: 10,
  peek: new Set(),            // опросы, у которых человек сам нажал «Показать результаты»
  draft: {},                  // выбранные, но ещё не отправленные варианты (опросы с несколькими ответами)
  busy: {},
  live: null,                 // открытое окно результатов

  // ───────────── вычисления ─────────────
  pcts(p) {
    const n = p.o.map((o) => o.n || 0), t = p.total || 0;
    if (!t) return n.map(() => 0);
    if (p.multi) return n.map((x) => Math.round((x * 100) / t));           // несколько ответов: доля проголосовавших, сумма может быть больше 100
    const fl = n.map((x) => Math.floor((x * 100) / t));
    let left = 100 - fl.reduce((a, b) => a + b, 0);
    n.map((x, i) => [((x * 100) / t) % 1, i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0 && n[i] > 0) { fl[i]++; left--; } });
    return fl;                                                              // сумма ровно 100
  },
  kind(p) {
    let s = p.closed ? T("Опрос завершён") : p.anon ? T("Анонимный опрос") : T("Опрос");
    if (p.multi && !p.closed) s += " · " + T("несколько ответов");
    return s;
  },
  count(p) { return p.total ? p.total + " " + plural(p.total, T("голос"), T("голоса"), T("голосов")) : T("Пока нет голосов"); },
  mine(m) { return m.sender === App.user.id; },
  shows(m) { const p = m.poll; return !!(p.closed || (p.my && p.my.length) || Poll.mine(m) || Poll.peek.has(m.id)); },
  locked(p) { return !!(p.my && p.my.length && !p.rev); },                  // автор запретил менять голос
  sel(m) { return Poll.draft[m.id] ? Poll.draft[m.id].slice() : (m.poll.my || []).slice(); },
  canClose(m) {
    const p = Chat.peer || {};
    return !!(m.id && m.poll && !m.poll.closed && (Poll.mine(m) || (p.gk && (p.role === "owner" || p.role === "admin"))));
  },

  // ───────────── разметка пузыря ─────────────
  html(m, time) {
    const p = m.poll;
    if (!p || !Array.isArray(p.o)) return `<span class="tx">${esc(m.text || "")}</span>`;
    const show = Poll.shows(m), pc = Poll.pcts(p), draft = Poll.sel(m), my = p.my || [], dis = p.closed || Poll.locked(p) || !m.id;
    const opts = p.o.map((o, i) => `<button class="pl-o${my.includes(i) ? " my" : ""}${draft.includes(i) ? " pick" : ""}" data-i="${i}" type="button"${dis ? " disabled" : ""}>
        <span class="pl-l"><i class="pl-r">${PLI.ok}</i><b class="pl-p" data-v="${pc[i]}">${pc[i]}%</b></span>
        <span class="pl-c"><span class="pl-t">${esc(o.t)}<i class="pl-ck">${PLI.ok}</i></span><i class="pl-bar"><i style="--p:${show ? pc[i] / 100 : 0}"></i></i></span></button>`).join("");
    return `<div class="poll${show ? " res" : ""}${p.closed ? " closed" : ""}${p.multi ? " multi" : ""}" data-pid="${m.id || ""}">
      <div class="pl-q">${esc(p.q)}</div><div class="pl-k">${esc(Poll.kind(p))}</div>
      <div class="pl-os">${opts}</div>
      <div class="pl-a">${Poll.actions(m)}</div>
      <div class="pl-f"><span class="pl-n">${esc(Poll.count(p))}</span>${time || ""}</div></div>`;
  },
  actions(m) {
    const p = m.poll, my = p.my || [], draft = Poll.sel(m);
    const changed = !!p.multi && draft.join() !== my.join();
    let h = "";
    if (!p.closed && m.id) {
      if (p.multi && (changed || !my.length)) h += `<button class="pl-btn" data-a="vote" type="button"${draft.length ? "" : " disabled"}>${esc(my.length ? T("Изменить голос") : T("Проголосовать"))}</button>`;
      else if (my.length && p.rev) h += `<button class="pl-lnk" data-a="retract" type="button">${esc(T("Отозвать голос"))}</button>`;
      else if (my.length) h += `<span class="pl-note">${esc(T("Голос нельзя изменить"))}</span>`;
    }
    if (m.id) {
      if (Poll.shows(m)) { if (p.total || p.closed) h += `<button class="pl-lnk${h ? " r" : ""}" data-a="res" type="button">${esc(T("Результаты"))}</button>`; }
      else if (!p.closed) h += `<button class="pl-lnk r" data-a="peek" type="button">${esc(T("Показать результаты"))}</button>`;
    }
    return h;
  },

  // плавное «досчитывание» процента
  tween(el, a, b) {
    cancelAnimationFrame(el._raf);
    if (document.documentElement.classList.contains("lite") || document.documentElement.classList.contains("eco-anim") || a === b) { el.textContent = b + "%"; return; }
    const t0 = performance.now(), D = 560;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(a + (b - a) * e) + "%";
      if (k < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  },

  // обновить пузырь на месте — полосы и проценты анимируются, а не перерисовываются
  paint(m) {
    const box = $("msgs"), p = m && m.poll;
    const root = box && p && m.id && box.querySelector(`.poll[data-pid="${m.id}"]`);
    if (!root) return false;
    const rows = root.querySelectorAll(".pl-o");
    if (rows.length !== p.o.length) return false;
    const show = Poll.shows(m), pc = Poll.pcts(p), draft = Poll.sel(m), my = p.my || [], dis = p.closed || Poll.locked(p);
    root.classList.toggle("res", show); root.classList.toggle("closed", !!p.closed);
    rows.forEach((r, i) => {
      r.classList.toggle("my", my.includes(i)); r.classList.toggle("pick", draft.includes(i)); r.disabled = !!dis;
      const pe = r.querySelector(".pl-p"), was = +pe.dataset.v;
      if (was !== pc[i]) { Poll.tween(pe, was, pc[i]); pe.dataset.v = pc[i]; }
      r.querySelector(".pl-bar i").style.setProperty("--p", show ? pc[i] / 100 : 0);
      r.querySelector(".pl-t").firstChild.textContent = p.o[i].t;
    });
    root.querySelector(".pl-k").textContent = Poll.kind(p);
    root.querySelector(".pl-a").innerHTML = Poll.actions(m);
    const n = root.querySelector(".pl-n"), txt = Poll.count(p);
    if (n.textContent !== txt) { n.textContent = txt; n.classList.remove("bump"); void n.offsetWidth; n.classList.add("bump"); }
    return true;
  },

  // ───────────── нажатия ─────────────
  tap(m, t) {
    if (!m.poll) return;
    const a = t.closest("[data-a]");
    if (a) {
      haptic("light");
      const k = a.dataset.a;
      if (k === "vote") return Poll.vote(m, Poll.sel(m));
      if (k === "retract") return Poll.vote(m, []);
      if (k === "res") return Poll.results(m);
      if (k === "peek") { Poll.peek.add(m.id); return Poll.paint(m) || Chat.patch(m); }
      return;
    }
    const o = t.closest(".pl-o");
    if (!o) return;
    if (!m.id) return toast(T("Опрос ещё отправляется"));
    if (m.poll.closed) return toast(T("Опрос завершён"));
    if (Poll.locked(m.poll)) return toast(T("Автор опроса запретил менять голос"));
    Poll.pick(m, +o.dataset.i);
  },
  pick(m, i) {
    const p = m.poll;
    if (!p.multi) {
      if ((p.my || []).length === 1 && p.my[0] === i) return;                // тот же вариант — ничего не меняется
      return Poll.vote(m, [i]);
    }
    const d = Poll.sel(m), k = d.indexOf(i);
    if (k >= 0) d.splice(k, 1); else d.push(i);
    d.sort((a, b) => a - b);
    Poll.draft[m.id] = d; haptic("light");
    if (!Poll.paint(m)) Chat.patch(m);
  },

  // подставить свой голос в цифры сразу, не дожидаясь сервера
  apply(p, sel) {
    const old = p.my || [];
    old.forEach((i) => { if (p.o[i]) p.o[i].n = Math.max(0, (p.o[i].n || 0) - 1); });
    sel.forEach((i) => { if (p.o[i]) p.o[i].n = (p.o[i].n || 0) + 1; });
    if (!old.length && sel.length) p.total = (p.total || 0) + 1;
    else if (old.length && !sel.length) p.total = Math.max(0, (p.total || 0) - 1);
    p.my = sel.slice();
  },
  async vote(m, sel) {
    if (!m.id || !m.poll || Poll.busy[m.id]) return;
    const prev = JSON.parse(JSON.stringify(m.poll));
    if (sel.length && !sel.every((i) => i >= 0 && i < prev.o.length)) return;
    Poll.apply(m.poll, sel); delete Poll.draft[m.id];
    if (!Poll.paint(m)) Chat.patch(m);
    haptic(sel.length ? "medium" : "light");
    Poll.busy[m.id] = 1;
    try {
      const d = await api("/api/poll/vote", { method: "POST", body: { id: m.id, opts: sel } });
      m.poll = d.poll;
    } catch (e) {
      m.poll = prev;
      toast(e.message || T("Не удалось проголосовать"));
    }
    delete Poll.busy[m.id];
    if (!Poll.paint(m)) Chat.patch(m);
    try { Chat.saveCache(); } catch (e) {}
    Poll.liveRefresh(m.id);
  },
  async closePoll(m) {
    if (!Poll.canClose(m)) return;
    const ok = await UI.sheet({ title: T("Завершить опрос?"), text: T("Участники больше не смогут голосовать. Результаты останутся в чате."), actions: [{ label: T("Завершить опрос"), value: true, danger: true }], cancel: T("Отмена") });
    if (!ok) return;
    try {
      const d = await api("/api/poll/close", { method: "POST", body: { id: m.id } });
      m.poll = d.poll; delete Poll.draft[m.id];
      if (!Poll.paint(m)) Chat.patch(m);
      Chat.saveCache(); haptic("medium"); toast(T("Опрос завершён"));
      Poll.liveRefresh(m.id);
    } catch (e) { toast(e.message); }
  },
  // событие по WebSocket: чужой голос, завершение
  onEvent(d) {
    const m = (Chat.msgs || []).find((q) => q.id === d.id);
    if (m && d.poll) {
      const my = m.poll && m.poll.my;
      const mine = Poll.busy[m.id];                                         // свой голос в пути: цифры придут в ответе
      if (!mine) {
        m.poll = Object.assign({}, m.poll || {}, d.poll);
        if (d.poll.my === undefined && my) m.poll.my = my;
        if (m.poll.closed) delete Poll.draft[m.id];
        if (!Poll.paint(m)) Chat.patch(m);
        try { Chat.saveCache(); } catch (e) {}
      }
    }
    Poll.liveRefresh(d.id);
  },
  liveRefresh(id) { if (Poll.live && Poll.live.id === id) Poll.live.refresh(); },

  // ───────────── результаты ─────────────
  async results(m) {
    if (!m || !m.id || !m.poll) return;
    const sub = (u) => (u.username ? "@" + u.username : u.online ? T("в сети") : "");
    const me = () => (App.user && App.user.id) || 0;
    if (Poll.live) { try { Poll.live.close(); } catch (e) {} }
    const L = Gifts.layer("rw-ov pr-ov", `<div class="rw-card pr-card" role="dialog"><i class="rw-grip"></i><button class="gb-x" data-x aria-label="${esc(T("Закрыть"))}">${GIC.x}</button>
      <h3 class="pr-q"></h3><div class="pr-k"></div><div class="rw-list pr-list"></div></div>`, 128);
    const el = L.el, list = el.querySelector(".pr-list");
    let voters = null;
    const draw = (anim) => {
      const p = m.poll; if (!p) return;
      el.querySelector(".pr-q").textContent = p.q;
      el.querySelector(".pr-k").textContent = Poll.kind(p) + " · " + Poll.count(p);
      const pc = Poll.pcts(p), max = Math.max(1, ...p.o.map((o) => o.n || 0));
      list.innerHTML = p.o.map((o, i) => {
        const vs = voters ? voters.filter((x) => x.opt === i) : [];
        return `<div class="pr-o${(p.my || []).includes(i) ? " my" : ""}${anim ? " in" : ""}" style="--i:${Math.min(i, 8)}">
          <div class="pr-h"><span class="pr-p">${pc[i]}%</span><span class="pr-t">${esc(o.t)}${(p.my || []).includes(i) ? `<i class="pl-ck on">${PLI.ok}</i>` : ""}</span><span class="pr-c">${o.n || 0}</span></div>
          <i class="pl-bar"><i style="--p:${anim ? 0 : (o.n || 0) / max}" data-p="${(o.n || 0) / max}"></i></i>
          ${vs.map((x) => `<div class="rw-row pr-v" data-u="${x.user.id}" role="button" tabindex="0"><span class="rw-av" data-av="${x.user.id}">${avatar(x.user, "sm")}</span><span class="tx"><b>${esc(x.user.id === me() ? T("Вы") : dispName(x.user))}${verBadge(x.user)}</b>${sub(x.user) ? `<small>${esc(sub(x.user))}</small>` : ""}</span></div>`).join("")}</div>`;
      }).join("") + (p.anon ? `<p class="pr-note">${esc(T("Опрос анонимный: видно только число голосов, а не кто как голосовал."))}</p>` : p.total ? "" : `<p class="pr-note">${esc(T("Пока никто не проголосовал."))}</p>`);
      if (anim) requestAnimationFrame(() => requestAnimationFrame(() => list.querySelectorAll(".pl-bar i").forEach((b) => b.style.setProperty("--p", b.dataset.p))));
    };
    const load = async () => {
      if (m.poll.anon || !m.poll.total) { voters = null; return; }
      try { voters = (await api("/api/poll/voters?id=" + m.id)).items || []; } catch (e) { voters = null; }
    };
    await load(); draw(true);
    el.addEventListener("click", (e) => {
      const r = e.target.closest(".pr-v"); if (!r || !voters) return;
      const it = voters.find((x) => String(x.user.id) === r.dataset.u); if (!it) return;
      if (e.target.closest(".rw-av") && it.user.avatar && PHV.avatar(it.user, r.querySelector(".rw-av .av") || r.querySelector(".rw-av"))) return;
      L.close && L.close();
      if (it.user.id !== me()) setTimeout(() => { try { UserProfile.open(it.user); } catch (er) {} }, 200);
    });
    const live = { id: m.id, close: L.close, async refresh() {
      if (Poll.live !== live) return;
      await load(); if (Poll.live === live) draw(false);
    } };
    Poll.live = live;
    L.on(() => { if (Poll.live === live) Poll.live = null; });
  },

  // ───────────── создание ─────────────
  create() {
    const peer = Chat.peer;
    if (!peer || peer.is_system) return;
    const S = { anon: !!peer.gk, multi: false, rev: true };
    const id = "pollnew";
    if (document.getElementById(id)) return;
    const el = document.createElement("section");
    el.id = id; el.className = "page tgp pn"; el.setAttribute("aria-hidden", "true");
    const sw = (k, t, s) => `<button class="pn-r" data-s="${k}" type="button"><span class="tx"><b>${esc(T(t))}</b><small>${esc(T(s))}</small></span><span class="sw${S[k] ? " on" : ""}"><i></i></span></button>`;
    el.innerHTML = `<header class="tg-head"><button class="icon-btn" data-back aria-label="${esc(T("Назад"))}">${PLI.back.replace("<svg ", '<svg width="22" height="22" ')}</button>
        <div class="tg-title">${esc(T("Новый опрос"))}</div></header>
      <div class="pn-body">
        <div class="pn-lbl"><span>${esc(T("Вопрос"))}</span><em data-qc>${Poll.MAX_Q}</em></div>
        <div class="pn-f"><textarea data-q rows="1" maxlength="${Poll.MAX_Q}" placeholder="${esc(T("Задайте вопрос"))}" autocomplete="off"></textarea></div>
        <div class="pn-lbl"><span>${esc(T("Варианты ответа"))}</span></div>
        <div class="pn-os" data-os></div>
        <div class="pn-hint" data-hint></div>
        <div class="pn-lbl"><span>${esc(T("Настройки"))}</span></div>
        <div class="pn-s">${sw("anon", "Анонимное голосование", "Не видно, кто как проголосовал")}${sw("multi", "Несколько ответов", "Можно отметить сразу несколько вариантов")}${sw("rev", "Можно менять голос", "Участники смогут передумать или отозвать голос")}</div>
        <div class="pn-pad"></div>
      </div>
      <button class="fab2 off" data-ok aria-label="${esc(T("Создать"))}">${PLI.ok}</button>`;
    document.body.appendChild(el);
    void el.offsetWidth;
    Nav.open(id, () => setTimeout(() => el.remove(), 340));
    const q = el.querySelector("[data-q]"), os = el.querySelector("[data-os]"), hint = el.querySelector("[data-hint]"), fab = el.querySelector("[data-ok]"), qc = el.querySelector("[data-qc]");
    const row = (v = "") => {
      const d = document.createElement("div");
      d.className = "pn-o in";
      d.innerHTML = `<input maxlength="${Poll.MAX_O}" autocomplete="off" value="${esc(v)}"><button class="pn-x" type="button" tabindex="-1" aria-label="${esc(T("Убрать"))}">${PLI.x}</button>`;
      return d;
    };
    const inputs = () => [...os.querySelectorAll("input")];
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    const vals = () => inputs().map((i) => norm(i.value)).filter(Boolean);
    const sync = () => {
      const rows = [...os.children];
      rows.forEach((r, i) => { r.querySelector("input").placeholder = T("Вариант {0}", i + 1); r.classList.toggle("can", rows.length > 2 && !!norm(r.querySelector("input").value)); });
      const v = vals(), low = v.map((x) => x.toLowerCase()), dup = low.some((x, i) => low.indexOf(x) !== i);
      const left = Poll.MAX_N - rows.length;
      hint.classList.toggle("bad", dup);
      hint.textContent = dup ? T("Варианты ответа не должны повторяться") : left > 0 ? T("Можно добавить ещё {0} {1}", left, plural(left, T("вариант"), T("варианта"), T("вариантов"))) : T("Достигнут максимум — {0} вариантов", Poll.MAX_N);
      qc.textContent = Poll.MAX_Q - q.value.length; qc.classList.toggle("low", Poll.MAX_Q - q.value.length < 30);
      fab.classList.toggle("off", !(norm(q.value) && v.length >= 2 && !dup));
    };
    const ensureTail = () => {                       // последняя строка заполнена — снизу появляется новая (до 10)
      const rows = [...os.children];
      if (rows.length < Poll.MAX_N && rows.every((r) => norm(r.querySelector("input").value))) { os.appendChild(row()); }
    };
    os.appendChild(row()); os.appendChild(row()); sync();
    const grow = () => { q.style.height = "auto"; q.style.height = Math.min(q.scrollHeight, 140) + "px"; };
    q.addEventListener("input", () => { grow(); sync(); });
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); inputs()[0].focus(); } });
    os.addEventListener("input", () => { ensureTail(); sync(); });
    os.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !e.target.matches("input")) return;
      e.preventDefault();
      const ins = inputs(), i = ins.indexOf(e.target);
      if (ins[i + 1]) ins[i + 1].focus(); else if (ins.length < Poll.MAX_N) { os.appendChild(row()); sync(); inputs()[i + 1].focus(); } else e.target.blur();
    });
    os.addEventListener("focusin", (e) => { if (e.target.matches("input")) setTimeout(() => { try { e.target.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (er) {} }, 320); });
    os.addEventListener("click", (e) => {
      const x = e.target.closest(".pn-x"); if (!x) return;
      const r = x.parentElement; haptic("light");
      if ([...os.children].length <= 2) { r.querySelector("input").value = ""; return sync(); }
      r.classList.add("out");
      setTimeout(() => { r.remove(); ensureTail(); sync(); }, 180);
    });
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-back]")) return Nav.back();
      const s = e.target.closest("[data-s]");
      if (s) { const k = s.dataset.s; S[k] = !S[k]; s.querySelector(".sw").classList.toggle("on", S[k]); haptic("light"); return; }
      if (e.target.closest("[data-ok]")) return submit();
    });
    const submit = () => {
      if (fab.classList.contains("off")) return;
      const o = vals(), qq = norm(q.value);
      haptic("medium");
      Poll.send({ q: qq, o, multi: S.multi, anon: S.anon, rev: S.rev });
      Nav.back();
    };
    setTimeout(() => { try { q.focus(); } catch (e) {} }, 380);
  },

  // отправить опрос в открытый чат
  send(pl) {
    const peer = Chat.peer; if (!peer) return;
    if (peer.gk === "group" && peer.perms && !peer.perms.text && peer.role === "member") return toast(T("В этой группе запрещено отправлять сообщения"));
    if (Chat.slowLeft && Chat.slowLeft() > 0) return Chat.slowShake();
    const r = Chat.replyTo;
    const poll = { q: pl.q, o: pl.o.map((t) => ({ t, n: 0 })), total: 0, multi: pl.multi ? 1 : 0, anon: pl.anon ? 1 : 0, rev: pl.rev ? 1 : 0, my: [] };
    if (r) Chat.clearReply();
    return Chat.post({ kind: "poll", text: pl.q, poll, pl, reply_to: r ? r.id : undefined, reply: r ? Chat.replyOf(r) : undefined });
  },
};
