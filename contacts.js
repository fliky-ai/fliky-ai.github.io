// contacts.js — вкладка «Контакты», экран «Новое сообщение» и создание группы / канала (как в Telegram).
// Контакты — это люди, с которыми у вас есть переписка: только их можно добавлять в группы и каналы.
const Contacts = {
  cache: [], loaded: false, q: "",

  async load(force) {
    if (Contacts.loading) return;
    Contacts.loading = true;
    try { Contacts.cache = (await api("/api/contacts")).contacts || []; Contacts.loaded = true; }
    catch (e) { if (!Contacts.loaded) Contacts.cache = Chats.list.filter((c) => !c.peer.gk && !c.peer.is_system).map((c) => c.peer); }
    finally { Contacts.loading = false; }
    Contacts.render();
  },

  people() { return Contacts.cache.length ? Contacts.cache : Chats.list.filter((c) => !c.peer.gk && !c.peer.is_system).map((c) => c.peer); },

  bind() {
    const f = $("contact-fab"), s = $("btn-csearch");
    if (s) s.onclick = () => { haptic(); Search.open(); };
    if ($("contact-sbar")) $("contact-sbar").onclick = () => { haptic(); Search.open(); };
    if (f) f.onclick = () => { haptic(); AddContact.open(); };
    $("contact-list").addEventListener("click", (e) => {
      const a = e.target.closest("[data-act]");
      if (a) { haptic(); return a.dataset.act === "group" ? CreateChat.open("group") : CreateChat.open("channel"); }
      const r = e.target.closest(".nm-row"); if (!r) return;
      const p = Contacts.people().find((x) => x.id === +r.dataset.id);
      if (p) Chat.open(Chats.byId(p.id) ? Chats.byId(p.id).peer : p);
    });
    ContactList.bindIndex($("contact-list"));
    Contacts.render();
  },

  render() {
    const box = $("contact-list"); if (!box) return;
    const people = Contacts.people();
    const acts = "";                  // «Создать группу / канал» живут в кнопке «+» на главном экране, а не во вкладке контактов
    if (!people.length) {
      box.innerHTML = acts + `<div class="cempty">${ILL.chat}<h3>${esc(T("Контактов пока нет"))}</h3><p>${esc(T("Здесь будут люди, с которыми вы переписываетесь. Найти человека можно через поиск."))}</p></div>`;
      return;
    }
    const y = box.scrollTop;
    box.innerHTML = acts + ContactList.html(people, { solo: true });
    box.scrollTop = y;
    ContactList.mountIndex(box);
  },
};

// ═════════════ список людей по алфавиту (общий для вкладки, «Нового сообщения» и выбора участников) ═════════════
const ContactList = {
  letter(u) {
    const n = (dispName(u) || "#").trim();
    const c = Array.from(n)[0] || "#";
    return /[\p{L}]/u.test(c) ? c.toUpperCase() : "#";
  },
  group(people) {
    const cmp = new Intl.Collator(["ru", "en"], { sensitivity: "base" });
    const arr = people.slice().sort((a, b) => cmp.compare(dispName(a), dispName(b)));
    const g = new Map();
    for (const u of arr) { const l = ContactList.letter(u); if (!g.has(l)) g.set(l, []); g.get(l).push(u); }
    const keys = [...g.keys()].sort((a, b) => (a === "#") - (b === "#") || cmp.compare(a, b));
    return keys.map((k) => [k, g.get(k)]);
  },
  // opts: {sel:Set, solo:bool, q:string}
  html(people, opts = {}) {
    const q = (opts.q || "").toLowerCase().replace(/^@/, "");
    const list = q ? people.filter((u) => (dispName(u) + " " + (u.username || "")).toLowerCase().includes(q)) : people;
    if (!list.length) return `<div class="nm-empty">${esc(T("Никого не найдено"))}</div>`;
    const grp = ContactList.group(list);
    return grp.map(([l, us]) => `<div class="nm-sect" data-l="${esc(l)}">${esc(l)}</div>` + us.map((u) => {
      const on = opts.sel && opts.sel.has(u.id);
      const st = statusText(u);
      return `<button class="nm-row${on ? " sel" : ""}${opts.solo ? " solo" : ""}" data-id="${u.id}">${Stories.av(u)}<span class="tx"><b>${nameHTML(u)}</b><small class="${u.online ? "on" : ""}">${esc(st)}</small></span><span class="chk">${SI.check}</span></button>`;
    }).join("")).join("");
  },
  // буквы справа: касание или протягивание пальца прокручивает список
  mountIndex(box) {
    let idx = box.querySelector(".nm-idx"); if (idx) idx.remove();
    const ls = [...box.querySelectorAll(".nm-sect")].map((s) => s.dataset.l);
    if (ls.length < 6) return;
    idx = document.createElement("div"); idx.className = "nm-idx";
    idx.innerHTML = ls.map((l) => `<span data-l="${esc(l)}">${esc(l)}</span>`).join("");
    box.style.position = "relative";
    box.appendChild(idx);
  },
  bindIndex(box) {
    const go = (e) => {
      const idx = box.querySelector(".nm-idx"); if (!idx) return;
      const t = e.touches ? e.touches[0] : e;
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const sp = el && el.closest && el.closest(".nm-idx span");
      const l = sp ? sp.dataset.l : null;
      if (!l) return;
      const s = [...box.querySelectorAll(".nm-sect")].find((x) => x.dataset.l === l);
      if (s) box.scrollTop = s.offsetTop - (box.querySelector(".nm-act") ? 0 : 0);
    };
    box.addEventListener("touchstart", (e) => { if (e.target.closest(".nm-idx")) go(e); }, { passive: true });
    box.addEventListener("touchmove", (e) => { if (e.target.closest(".nm-idx")) { go(e); if (e.cancelable) e.preventDefault(); } }, { passive: false });
    box.addEventListener("mousedown", (e) => { if (e.target.closest(".nm-idx")) go(e); });
  },
};

// ═════════════ «Новое сообщение» ═════════════
const NewMsg = {
  el: null,
  async open() {
    if (NewMsg.el) return;
    const el = (NewMsg.el = document.createElement("section"));
    el.id = "newmsg"; el.className = "page tgp"; el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<header class="tg-head">
        <button class="icon-btn" data-back aria-label="${esc(T("Назад"))}">${SI.back.replace("<svg ", '<svg width="22" height="22" ')}</button>
        <div class="tg-title">${esc(T("Новое сообщение"))}<small id="nm-cnt"></small></div>
      </header>
      <label class="nm-search">${SI.search}<input id="nm-q" placeholder="${esc(T("Кому написать?"))}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <div class="nm-body" id="nm-body"></div>
      <button class="fab2" id="nm-fab" type="button" aria-label="${esc(T("Найти человека"))}">${SI.userPlus}</button>`;
    document.body.appendChild(el);
    void el.offsetWidth;
    Nav.open("newmsg", () => { NewMsg.el = null; setTimeout(() => el.remove(), 320); });
    const body = el.querySelector("#nm-body");
    NewMsg.q = "";
    const draw = () => {
      const people = Contacts.people(), q = NewMsg.q;
      el.querySelector("#nm-cnt").textContent = people.length ? people.length + " " + plural(people.length, T("контакт"), T("контакта"), T("контактов")) : "";
      const acts = q ? "" : `<button class="nm-act" data-act="group">${SI.userPlus}<span>${esc(T("Создать группу"))}</span></button>
        <button class="nm-act" data-act="channel">${svg('<path d="m3 11 17-6v14L3 13z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>')}<span>${esc(T("Создать канал"))}</span></button>${people.length ? '<div class="nm-sep"></div>' : ""}`;
      body.innerHTML = acts + (people.length || q ? ContactList.html(people, { q, solo: true }) : `<div class="nm-empty">${esc(T("Контактов пока нет. Найдите человека через поиск — кнопка справа внизу."))}</div>`);
      if (!q) ContactList.mountIndex(body);
    };
    draw();
    Contacts.load().then(() => { if (NewMsg.el === el) draw(); });
    el.querySelector("#nm-q").addEventListener("input", (e) => { NewMsg.q = e.target.value.trim(); draw(); });
    ContactList.bindIndex(body);
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-back]")) return Nav.back();
      if (e.target.closest("#nm-fab")) { haptic(); return Search.open(); }
      const a = e.target.closest("[data-act]");
      if (a) { haptic(); return CreateChat.open(a.dataset.act); }
      const r = e.target.closest(".nm-row"); if (!r) return;
      const p = Contacts.people().find((x) => x.id === +r.dataset.id); if (!p) return;
      haptic();
      await Nav.unwindWhile((t) => t.id === "newmsg");
      Chat.open(Chats.byId(p.id) ? Chats.byId(p.id).peer : p);
    });
  },
};

// ═════════════ создание группы или канала ═════════════
const EMOJI_MINI = ["😀", "😂", "😍", "😎", "🥳", "🤩", "😇", "🤔", "😴", "🔥", "✨", "💫", "⭐", "🌟", "💥", "🎉", "🎮", "🎧", "🎵", "🎬", "📚", "💻", "📱", "🚀", "🏠", "🏀", "⚽", "🍕", "🍔", "☕", "🌈", "🌍", "🐱", "🐶", "🦊", "🐼", "🍀", "🌸", "❤️", "💙", "💜", "👑", "💼", "🛠️", "🎓", "🧠", "💡", "🔔"];
const AUTO_DEL = [[0, "Выкл."], [86400, "1 день"], [7 * 86400, "1 неделя"], [30 * 86400, "1 месяц"], [90 * 86400, "3 месяца"], [365 * 86400, "1 год"]];
const autoDelText = (s) => T((AUTO_DEL.find((x) => x[0] === s) || AUTO_DEL[0])[1]);

const CreateChat = {
  n: 0,
  open(kind) {
    const ch = kind === "channel", id = "cc" + ++CreateChat.n;
    const st = { kind, title: "", about: "", photo: "", auto: 0, busy: false };
    const el = document.createElement("section");
    el.id = id; el.className = "page tgp"; el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<header class="tg-head">
        <button class="icon-btn" data-back aria-label="${esc(T("Назад"))}">${SI.back.replace("<svg ", '<svg width="22" height="22" ')}</button>
        <div class="tg-title">${esc(T(ch ? "Создать канал" : "Создать группу"))}</div>
      </header>
      <div class="nm-body cc-body">
        <div class="cc-top">
          <button class="cc-av" data-photo aria-label="${esc(T("Выбрать фотографию"))}"><span class="cc-cam">${ICON.camera}</span></button>
          <div class="cc-name"><input id="${id}-t" maxlength="64" placeholder="${esc(T(ch ? "Название канала" : "Название группы"))}" autocomplete="off" autocapitalize="sentences" aria-label="${esc(T("Название"))}"><button class="cc-emo" data-emo aria-label="${esc(T("Эмодзи"))}">${SI.smile}</button></div>
        </div>
        ${ch ? `<div class="cc-about"><textarea id="${id}-a" rows="2" maxlength="255" placeholder="${esc(T("Описание (необязательно)"))}"></textarea></div>` : ""}
        <div class="cc-hint">${esc(T(ch ? "Вы можете указать название и добавить фото для вашего канала." : "Вы можете указать название и добавить фото для вашей группы."))}</div>
        <button class="nm-act cc-row" data-auto>${svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>')}<span>${esc(T("Автоудаление сообщений"))}</span><em id="${id}-ad">${esc(autoDelText(0))}</em></button>
        <div class="cc-hint">${esc(T("Сообщения будут удаляться через выбранное время после отправки. Можно изменить позже."))}</div>
      </div>
      <button class="fab2 off" data-ok aria-label="${esc(T("Создать"))}">${SI.check}</button>`;
    document.body.appendChild(el);
    void el.offsetWidth;
    Nav.open(id, () => setTimeout(() => el.remove(), 320));
    const fab = el.querySelector("[data-ok]"), inp = el.querySelector("#" + id + "-t");
    const upd = () => fab.classList.toggle("off", !st.title.trim() || st.busy);
    inp.addEventListener("input", () => { st.title = inp.value; upd(); });
    const ab = el.querySelector("#" + id + "-a"); if (ab) ab.addEventListener("input", () => { st.about = ab.value; });
    setTimeout(() => { try { inp.focus(); } catch (e) {} }, 300);

    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-back]")) return Nav.back();
      if (e.target.closest("[data-emo]")) {
        const em = await CreateChat.emoji(); if (!em) return;
        inp.value = (inp.value + em).slice(0, 64); st.title = inp.value; upd(); return;
      }
      if (e.target.closest("[data-auto]")) {
        const v = await UI.sheet({ title: T("Автоудаление сообщений"), actions: AUTO_DEL.map(([s, n]) => ({ label: (st.auto === s ? "✓ " : "") + T(n), value: s + 1 })) });
        if (!v) return;
        st.auto = v - 1; el.querySelector("#" + id + "-ad").textContent = autoDelText(st.auto); return;
      }
      if (e.target.closest("[data-photo]")) {
        const data = await CreateChat.pickPhoto(ch ? T("Фото канала") : T("Фото группы"));
        if (!data) return;
        st.photo = data;
        el.querySelector(".cc-av").innerHTML = `<img src="${data}" alt="">`;
        return;
      }
      if (e.target.closest("[data-ok]")) {
        if (st.busy || !st.title.trim()) return;
        st.busy = true; upd(); haptic("medium");
        try {
          const d = await api("/api/chat/create", { method: "POST", body: { kind, title: st.title.trim(), about: st.about.trim(), auto_del: st.auto, photo: st.photo || undefined } });
          await Chats.load();
          const c = Chats.byId(d.chat.id);
          await Nav.unwindWhile((t) => t.id === "newmsg" || /^cc\d+$/.test(t.id || ""));
          Chat.open(c ? c.peer : d.chat);
        } catch (er) { st.busy = false; upd(); toast(er.message); }
      }
    });
  },

  // выбор фото: галерея или камера → кадрирование (круг)
  async pickPhoto(title) {
    const k = await UI.tiles({ title, tiles: [{ k: "gal", label: T("Галерея"), icon: PI.gallery, cls: "t-blue" }, { k: "cam", label: T("Камера"), icon: ICON.camera, cls: "t-pink" }] });
    let f = null;
    if (k === "gal") f = (await Attach.pick("image/*", false))[0];
    else if (k === "cam") f = await new Promise((res) => Camera.open((x) => res(x), "user"));
    if (!f) return null;
    if (!/^image\//.test(f.type)) { toast(T("Выберите фото")); return null; }
    return await Cropper.open(f, { title });
  },

  emoji() {
    return new Promise((res) => {
      const el = document.createElement("div");
      el.className = "sheet2";
      el.innerHTML = `<div class="s2-card" role="dialog"><h3>${esc(T("Эмодзи"))}</h3><div class="emo-grid">${EMOJI_MINI.map((e) => `<button data-e="${e}">${e}</button>`).join("")}</div><div class="s2-btns"><button class="s2-cancel" data-e="">${esc(T("Отмена"))}</button></div></div>`;
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add("show"));
      const done = (v) => { el.classList.remove("show"); setTimeout(() => el.remove(), 200); res(v); };
      el.addEventListener("click", (e) => { const b = e.target.closest("[data-e]"); if (b) return done(b.dataset.e || null); if (e.target === el) done(null); });
    });
  },
};

// ═════════════ «Новый контакт»: номер телефона + имя/фамилия, как в Telegram ═════════════
const AddContact = {
  el: null,
  group(digits) { const d = String(digits || "").replace(/\D/g, "").slice(0, 8); return d.length > 4 ? d.slice(0, 4) + " " + d.slice(4) : d; },
  open() {
    if (AddContact.el) return;
    const el = (AddContact.el = document.createElement("section"));
    el.id = "addcontact"; el.className = "page"; el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<header class="phead"><button class="icon-btn" data-back aria-label="${esc(T("Назад"))}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>
        <div class="ptitle">${esc(T("Новый контакт"))}</div>
        <button id="ac-ok" class="ed-ok" type="button" disabled aria-label="${esc(T("Сохранить"))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></button></header>
      <div class="scroll ed-body">
        <label id="ac-phone-field" class="field"><span class="field-label">${esc(T("Номер телефона"))}</span>
          <span class="field-row"><span class="prefix">+888</span><span class="vline"></span>
            <input id="ac-phone" type="tel" inputmode="numeric" autocomplete="off" placeholder="0000 0000" aria-label="${esc(T("Номер телефона"))}"></span></label>
        <div class="ed-lbl">${esc(T("Имя"))}</div>
        <div class="card2 fields">
          <input id="ac-name" maxlength="60" autocomplete="off" autocapitalize="words" placeholder="${esc(T("Имя"))}" aria-label="${esc(T("Имя"))}">
          <input id="ac-surname" maxlength="60" autocomplete="off" autocapitalize="words" placeholder="${esc(T("Фамилия (необязательно)"))}" aria-label="${esc(T("Фамилия"))}">
        </div>
        <div class="ed-hint">${esc(T("Это имя будете видеть только вы — у этого человека останется своё."))}</div>
        <div class="err" id="ac-err"></div>
      </div>`;
    document.body.appendChild(el);
    void el.offsetWidth;
    Nav.open("addcontact", () => { AddContact.el = null; setTimeout(() => el.remove(), 320); });
    const phone = el.querySelector("#ac-phone"), name = el.querySelector("#ac-name"), sur = el.querySelector("#ac-surname"), ok = el.querySelector("#ac-ok"), errEl = el.querySelector("#ac-err"), field = el.querySelector("#ac-phone-field");
    const upd = () => { ok.disabled = phone.value.replace(/\D/g, "").length !== 8 || !name.value.trim(); };
    phone.addEventListener("input", () => { phone.value = AddContact.group(phone.value); field.classList.remove("error"); errEl.textContent = ""; upd(); });
    name.addEventListener("input", upd);
    setTimeout(() => { try { phone.focus(); } catch (e) {} }, 300);
    let busy = false;
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-back]")) return Nav.back();
      if (e.target.closest("#ac-ok")) {
        if (busy || ok.disabled) return;
        busy = true; haptic("medium"); errEl.textContent = "";
        try {
          await api("/api/contact/add", { method: "POST", body: { number: "+888" + phone.value.replace(/\D/g, ""), name: name.value.trim(), surname: sur.value.trim() } });
          toast(T("Добавлено в контакты"));
          try { Contacts.load(true); } catch (er) {}
          Nav.back();
        } catch (er) { errEl.textContent = er.message; field.classList.add("error"); busy = false; }
      }
    });
  },
};
