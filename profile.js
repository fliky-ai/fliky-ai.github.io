// Вкладка «Профиль» в стиле Telegram: фото (свой выбор и кадрирование), карточка «Информация», публикации, архив, подарки.
// Экран «Аккаунт» (кнопка «Изменить»): имя, фамилия, о себе, телефон, @username, день рождения, личный канал.
const UN_RE = /^[A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9]$/;
const VIS_LABEL = { all: "Все", contacts: "Мои контакты", none: "Никто" };

const Profile = {
  unOK: true, unTimer: null, tab: "posts",
  st: { active: [], archive: [], loaded: false },
  draft: { birthday: "", vis: "contacts" },

  // ───────────── вкладка «Профиль» ─────────────
  // рейтинг для своего профиля (приходит с /api/user/<id>): значок уровня рядом со статусом, нажатие открывает окно рейтинга
  rt: null, rtT: 0, rtU: 0,
  rtOf() { return App.user && Profile.rtU === App.user.id ? Profile.rt : null; },          // рейтинг именно текущего аккаунта
  async loadRt() {
    if (!App.user) return;
    const id = App.user.id;
    if (Profile.rtU !== id) { Profile.rt = null; Profile.rtT = 0; Profile.rtU = id; }
    if (Date.now() - Profile.rtT < 45000) return;
    Profile.rtT = Date.now();
    try {
      const d = await api("/api/user/" + id), r = d.user && d.user.rating;
      if (App.user && App.user.id === id && r && (!Profile.rt || r.level !== Profile.rt.level || r.pts !== Profile.rt.pts)) { Profile.rt = r; Profile.paintRt(); }
    } catch (e) {}
  },
  // щит рейтинга вставляется точечно — без перерисовки всего профиля, чтобы не сбить нажатие или прокрутку
  paintRt() {
    const row = document.querySelector("#profile-box .pf-hero .st2row"), r = Profile.rtOf();
    if (!row || !r) return;
    const old = row.querySelector(".lvb"); if (old) old.remove();
    row.insertAdjacentHTML("afterbegin", UserProfile.lvBadge(r));
    Profile.bindLv();
  },
  bindLv() {
    const lv = document.querySelector("#profile-box .lvb");
    if (lv) lv.onclick = () => { haptic(); UserProfile.rating(Object.assign({}, App.user, { rating: Profile.rtOf() })); };
  },

  render() {
    Profile.gf = null;                // список подарков перечитывается заново
    Profile.draw();
    Profile.loadRt();
    // имя и фото показаны и во вкладке «Настройки» (шапка и список аккаунтов) — обновляем их тоже
    Settings.render();
    try { App.tabAvatar(); } catch (e) {}
  },

  draw() {
    const u = App.user; if (!u) return;
    const row = (v, l, extra = "") => `<button class="pi" ${extra}><span class="pi-v">${v}</span><span class="pi-l">${l}</span></button>`;
    const rows = [];
    if (u.bio) rows.push(row(Rich.render(u.bio, u.bio_ents || []), "О себе", 'data-copy="' + esc(u.bio) + '"'));
    rows.push(row(esc(fmtPhone(u.number)), "Телефон", 'data-copy="' + esc(u.number) + '"'));
    const unr = UserProfile.unRow(u);                                 // @username и «а также @…» (коллекционные имена)
    rows.push(unr || row('<span class="dim">Не задано</span>', "Имя пользователя", 'data-edit="1"'));
    if (u.birthday) rows.push(row(esc(bdayText(u.birthday)) + (bdayToday(u.birthday) ? " 🎂" : ""), "День рождения", 'data-edit="1"'));
    const pc = Profile.curPc();
    Profile._pcDrawn = pc ? pc.gid : 0;
    if (pc) rows.push(row(esc(pc.name), "Личный канал", 'data-chan="1"'));
    if (!Profile.pc) Profile.loadPc();

    const ph = premHero(u);
    const pill = (k, t, extra = "") => `<button class="ptab${Profile.tab === k ? " on" : ""}" data-t="${k}">${t}${extra}</button>`;
    $("profile-box").innerHTML = `
      <div class="pf-hero${ph.cls}"${ph.style}>${ph.pat}
        <button class="pf-av" id="pf-av" aria-label="Фото профиля">${Stories.av(u, "xl")}</button>
        <h2>${profName(u)}</h2><div class="st2row">${Profile.rtOf() ? UserProfile.lvBadge(Profile.rtOf()) : ""}<div class="st2 on">в сети</div></div>
        ${u.premium && typeof StatusPicker !== "undefined" ? `<button class="pf-edit-st" id="pf-est">${SI.smile}<span>${esc(T("Эмодзи-статус"))}</span></button>` : ""}
      </div>
      <div class="pf-actions">
        <button class="pa" id="pf-photo">${ICON.camera}<span>Выбрать фото</span></button>
        <button class="pa" id="pf-edit">${ICON.edit}<span>Изменить</span></button>
        <button class="pa" id="pf-set">${PI.gear}<span>Настройки</span></button>
      </div>
      <div class="card2 pf-info">${rows.join("")}</div>${verNote(u)}
      <div class="pf-tabs">${pill("posts", "Публикации")}${pill("archive", "Архив публикаций")}${pill("gifts", "Подарки")}</div>
      <div id="pf-tab"></div>`;

    $("pf-av").onclick = () => Profile.photoMenu();
    $("pf-photo").onclick = () => Profile.photoMenu();
    $("pf-edit").onclick = () => Profile.openEdit();
    if ($("pf-est")) $("pf-est").onclick = () => StatusPicker.open();
    $("pf-set").onclick = () => App.go("settings");
    Profile.bindLv();
    $("profile-box").querySelectorAll(".pi").forEach((b) => (b.onclick = (e) => {
      if (e && e.target.closest("[data-qr]")) { e.stopPropagation(); haptic(); return QRCard.open(App.user); }
      const un = e && e.target.closest("[data-un]"); if (un) { e.stopPropagation(); haptic(); return UserProfile.unameSheet(App.user, un.dataset.un); }
      if (e && e.target.closest("a, .mention")) return;          // ссылку из «О себе» откроет общий обработчик
      if (b.dataset.copy) { const u = App.user; if (u.bio && b.dataset.copy === u.bio && u.bio_ents) RClip.set(u.bio, u.bio_ents); else copyText(b.dataset.copy); toast("Скопировано"); haptic(); }
      else if (b.dataset.edit) Profile.openEdit();
      else if (b.dataset.chan) Profile.channelInfo();
    }));
    $("profile-box").querySelector(".pf-tabs").onclick = (e) => {
      const b = e.target.closest(".ptab"); if (!b || b.dataset.t === Profile.tab) return;
      Profile.tab = b.dataset.t;
      $("profile-box").querySelectorAll(".ptab").forEach((x) => x.classList.toggle("on", x === b));
      Profile.drawTab();
    };
    Profile.drawTab();
  },

  // ───────────── личный канал: один из ваших каналов показывается в вашем профиле ─────────────
  pc: null, _pcDrawn: 0, gf: null,
  async loadPc() {
    try { Profile.pc = await api("/api/me/channels"); } catch (e) { return; }
    Profile.paintPc();
  },
  curPc() { const p = Profile.pc; return p && p.current ? (p.channels || []).find((c) => c.gid === p.current) || null : null; },
  paintPc() {
    const c = Profile.curPc();
    const r = $("ed-chan"); if (r) r.querySelector(".irow-r").textContent = c ? c.name : "Добавить";
    if ((c ? c.gid : 0) !== Profile._pcDrawn && $("profile-box").children.length) Profile.draw();
  },
  async channelInfo() {
    await Profile.loadPc();
    const p = Profile.pc;
    if (!p) return toast("Не удалось загрузить каналы");
    const chans = p.channels || [], cur = Profile.curPc();
    if (!chans.length) {
      const v = await UI.sheet({ title: "Личный канал", icon: PI.channel,
        text: "Личный канал показывается в вашем профиле. У вас пока нет своих каналов — создайте канал, и его можно будет добавить.",
        actions: [{ label: "Создать канал", value: "new", accent: true }], cancel: "Понятно" });
      if (v === "new") CreateChat.open("channel");
      return;
    }
    const v = await UI.sheet({ title: "Личный канал", icon: PI.channel,
      text: "Выберите канал, который будет показан в вашем профиле. Можно выбрать только один.",
      actions: chans.map((c) => ({ label: c.name + (cur && cur.gid === c.gid ? "  ✓" : ""), value: "c" + c.gid })).concat(cur ? [{ label: "Убрать из профиля", value: "rm", danger: true }] : []) });
    if (!v) return;
    const id = v === "rm" ? 0 : +v.slice(1);
    if (cur && cur.gid === id) return;
    try {
      await api("/api/me/pchan", { method: "POST", body: { id } });
      Profile.pc.current = id;
      Profile.paintPc();
      toast(id ? "Канал добавлен в профиль" : "Канал убран из профиля");
    } catch (e) { toast(e.message); }
  },

  // ───────────── публикации ─────────────
  async loadStories() {
    try {
      const d = await api("/api/stories/me");
      Profile.st = { active: d.active, archive: d.archive, loaded: true };
      if (Stories.mine !== d.active.length) { Stories.mine = d.active.length; Stories.changed(); return; }
    } catch (e) { Profile.st.loaded = true; }
    Profile.drawTab();
  },
  // истёкшие за время, пока вкладка была открыта, уходят в архив
  sweep() {
    const now = Date.now() / 1000, st = Profile.st;
    const gone = st.active.filter((s) => s.exp <= now);
    if (gone.length) { st.active = st.active.filter((s) => s.exp > now); st.archive = gone.map((s) => ({ ...s, active: false })).reverse().concat(st.archive); }
  },
  drawTab() {
    const box = $("pf-tab"); if (!box) return;
    const t = Profile.tab;
    if (t === "gifts") {
      if (!Profile.gf) {
        box.innerHTML = '<div class="pf-load"><div class="spin"></div></div>';
        api("/api/gifts/user/" + App.user.id).then((d) => { Profile.gf = d; }).catch(() => { Profile.gf = { gifts: [] }; }).then(() => { if (Profile.tab === "gifts") Profile.drawTab(); });
        return;
      }
      const list = Profile.gf.gifts || [];
      box.innerHTML = list.length ? Gifts.grid(list, App.user, true) : Gifts.emptyGrid(true);
      box.onclick = (e) => {
        if (e.target.closest("[data-gsend]")) { haptic(); return Gifts.shop(App.user); }
        const b = e.target.closest(".gt[data-g]"); if (!b) return; const x = list.find((k) => k.id === +b.dataset.g); if (x) Gifts.detail(x);
      };
      return;
    }
    if (!Profile.st.loaded) { box.innerHTML = '<div class="pf-load"><div class="spin"></div></div>'; return; }
    Profile.sweep();
    const list = t === "posts" ? Profile.st.active : Profile.st.archive;
    if (!list.length) {
      box.innerHTML = t === "posts"
        ? `<div class="pf-empty"><div class="pf-eic">${PI.gallery}</div><h3>Публикаций пока нет</h3><p>Публикуйте фотографии и видео в своём профиле. Через заданное время они уйдут в архив.</p><button class="pf-add" id="pf-new">Добавить</button></div>`
        : `<div class="pf-empty"><div class="pf-eic">${PI.clock}</div><h3>Архив пуст</h3><p>Здесь сохраняются ваши публикации после того, как закончится срок их показа.</p></div>`;
      const nb = $("pf-new"); if (nb) nb.onclick = () => Stories.create();
      return;
    }
    box.innerHTML = Stories.grid(list, { own: true, add: t === "posts", archive: t === "archive" }) +
      `<p class="pf-note">${t === "posts" ? "Публикации видны другим, пока не закончится срок показа, затем попадают в архив." : "Архив видите только вы."}</p>`;
    box.querySelector(".pg").onclick = (e) => {
      const b = e.target.closest(".pg-t"); if (!b) return;
      if (b.dataset.add) return Stories.create();
      Stories.show([{ uid: App.user.id, user: App.user, stories: list.slice() }], 0, +b.dataset.i, { archive: t === "archive" });
    };
  },

  // ───────────── фото профиля: свой выбор → свой экран кадрирования ─────────────
  async photoMenu() {
    const u = App.user;
    const tiles = [{ k: "gal", label: "Галерея", icon: PI.gallery, cls: "t-blue" }, { k: "cam", label: "Камера", icon: ICON.camera, cls: "t-pink" }];
    if (u.avatar) tiles.push({ k: "rm", label: "Удалить", icon: ICON.trash, cls: "t-red" });
    const k = await UI.tiles({ title: "Фото профиля", tiles });
    if (k === "gal") { const f = (await Attach.pick("image/*", false))[0]; if (f) Profile.crop(f); }
    else if (k === "cam") Camera.open((f) => Profile.crop(f), "user");
    else if (k === "rm") {
      if (await UI.sheet({ title: "Удалить фото профиля?", actions: [{ label: "Удалить", value: true, danger: true }] })) Profile.removePhoto();
    }
  },
  async crop(file) {
    if (!file || !/^image\//.test(file.type)) return toast("Выберите фото");
    const data = await Cropper.open(file);
    if (!data) return;
    try {
      const d = await api("/api/me/avatar", { method: "POST", body: { data } });
      App.user = d.user; Profile.render(); toast("Фото обновлено");
    } catch (e) { toast(e.message || "Не удалось загрузить фото"); }
  },
  async removePhoto() {
    try { const d = await api("/api/me/avatar/remove", { method: "POST", body: {} }); App.user = d.user; Profile.render(); toast("Фото удалено"); }
    catch (e) { toast(e.message); }
  },

  // ───────────── экран «Аккаунт» ─────────────
  openEdit() {
    const u = App.user;
    $("ed-name").value = u.name || ""; $("ed-surname").value = u.surname || "";
    $("ed-user").value = u.username || ""; BioEd.set(u.bio || "", u.bio_ents || []);
    $("ed-phone-v").textContent = fmtPhone(u.number);
    Profile.draft = { birthday: u.birthday || "", vis: u.birthday_vis || "contacts" };
    Profile.drawBday();
    Profile.unOK = true; Profile.check(); Nav.open("editprof");
  },

  drawBday() {
    const b = Profile.draft.birthday;
    const v = $("ed-bday-v"); v.textContent = b ? bdayText(b, false) : "Не указан"; v.classList.toggle("dim", !b);
    $("ed-bvis").textContent = VIS_LABEL[Profile.draft.vis] || VIS_LABEL.contacts;
    $("ed-bvis-row").classList.toggle("hidden", !b);
  },

  hint(t, cls = "") { const h = $("ed-user-hint"); h.textContent = t; h.className = cls; },

  check() {
    const u = App.user, un = $("ed-user").value.trim().replace(/^@/, ""), bioLen = BioEd.el ? BioEd.len() : 0;
    $("ed-bio-cnt").textContent = String((u.premium ? 140 : 70) - bioLen);
    clearTimeout(Profile.unTimer);
    const rules = "От 5 до 32 символов: латиница, цифры и _. Начинается с буквы.";
    if (!un || un === u.username) { Profile.unOK = true; Profile.hint("Имя пользователя"); }
    else if (!UN_RE.test(un) || un.includes("__")) { Profile.unOK = false; Profile.hint(/^\d/.test(un) ? "Имя пользователя не может начинаться с цифры" : rules, "bad"); }
    else {
      Profile.unOK = false; Profile.hint("Проверяем…");
      Profile.unTimer = setTimeout(async () => {
        try {
          const d = await api("/api/username/check?u=" + encodeURIComponent(un));
          if ($("ed-user").value.trim().replace(/^@/, "") !== un) return;
          Profile.unOK = d.available; Profile.hint(d.available ? "✓ Имя пользователя свободно" : d.reason, d.available ? "ok" : "bad"); Profile.btn();
        } catch (e) {}
      }, 400);
    }
    Profile.btn();
  },

  btn() {
    const u = App.user, name = $("ed-name").value.trim(), un = $("ed-user").value.trim().replace(/^@/, "");
    const changed = name !== (u.name || "") || $("ed-surname").value.trim() !== (u.surname || "") || un !== (u.username || "") ||
      Profile.bioChanged() || Profile.draft.birthday !== (u.birthday || "") || Profile.draft.vis !== (u.birthday_vis || "contacts");
    $("ed-save").disabled = !(changed && name && Profile.unOK);
  },

  bioChanged() {
    const u = App.user, b = BioEd.get(), key = (l) => JSON.stringify((l || []).filter((e) => e.t === "ce").map((e) => [e.o, e.l, e.id]));
    return b.text !== (u.bio || "") || key(b.ents) !== key(u.bio_ents);
  },

  async save() {
    const b = $("ed-save"); b.disabled = true;
    try {
      const d = await api("/api/me/update", { method: "POST", body: {
        name: $("ed-name").value.trim(), surname: $("ed-surname").value.trim(), username: $("ed-user").value.trim().replace(/^@/, ""),
        bio: BioEd.get().text, bio_ents: BioEd.get().ents, birthday: Profile.draft.birthday, birthday_vis: Profile.draft.vis } });
      App.user = d.user; Profile.render(); Nav.back(); toast("Профиль сохранён");
    } catch (e) { toast(e.message); Profile.btn(); }
  },

  async pickBirthday() {
    const v = await UI.date({ title: "День рождения", value: Profile.draft.birthday, clearLabel: "Удалить" });
    if (v === null) return;
    Profile.draft.birthday = v; Profile.drawBday(); Profile.btn();
  },
  async pickVis() {
    const mark = (k) => (Profile.draft.vis === k ? "  ✓" : "");
    const v = await UI.sheet({ title: "Кто видит день рождения", text: "Выберите, кому показывать вашу дату рождения.",
      actions: [{ label: "Все" + mark("all"), value: "all" }, { label: "Мои контакты" + mark("contacts"), value: "contacts" }, { label: "Никто" + mark("none"), value: "none" }] });
    if (!v) return;
    Profile.draft.vis = v; Profile.drawBday(); Profile.btn();
  },

  bindEdit() {
    BioEd.init();
    ["ed-name", "ed-surname", "ed-user"].forEach((id) => $(id).addEventListener("input", () => Profile.check()));
    $("ed-save").onclick = () => Profile.save();
    $("ed-phone").onclick = () => UI.sheet({ title: "Номер телефона", icon: PI.phone,
      text: "Номер выдаётся при регистрации через бота и привязан к аккаунту, поэтому изменить его нельзя. Если нужен другой номер, зарегистрируйте новый аккаунт.",
      actions: [], cancel: "Понятно" });
    $("ed-bday").onclick = () => Profile.pickBirthday();
    $("ed-bvis").onclick = () => Profile.pickVis();
    $("ed-chan").onclick = () => Profile.channelInfo();
  },
};
Profile.bindEdit();
