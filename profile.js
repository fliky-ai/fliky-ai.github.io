// Вкладка «Профиль»: мой профиль, фото, редактирование имени, @username и описания.
const UN_RE = /^[A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9]$/;

const Profile = {
  unOK: true, unTimer: null,

  render() {
    const u = App.user; if (!u) return;
    $("profile-box").innerHTML = `
      <div class="phero"><button class="avbtn" id="pf-av" aria-label="Сменить фото">${avatar(u, "xl")}<span class="cam">${ICON.camera}</span></button>
        <h2>${esc(dispName(u))}</h2><div class="st2 on">в сети</div></div>
      <div class="group">
        <div class="info"><small>Номер телефона</small><div>${esc(u.number)}</div></div>
        <div class="info"><small>Имя пользователя</small><div>${u.username ? "@" + esc(u.username) : '<span class="dim">не задано</span>'}</div></div>
        <div class="info"><small>О себе</small><div>${u.bio ? esc(u.bio) : '<span class="dim">не задано</span>'}</div></div>
      </div>
      <div class="group">
        <button class="item" id="pf-edit">${ICON.edit}Изменить профиль</button>
        <button class="item" id="pf-photo">${ICON.camera}Изменить фото</button>
        ${u.avatar ? `<button class="item danger" id="pf-rm">${ICON.trash}Удалить фото</button>` : ""}
      </div>`;
    $("pf-av").onclick = $("pf-photo").onclick = () => $("file").click();
    $("pf-edit").onclick = () => Profile.openEdit();
    if ($("pf-rm")) $("pf-rm").onclick = Profile.removePhoto;
    $("ed-av").innerHTML = avatar(u, "xl") + `<span class="cam">${ICON.camera}</span>`;
    // имя и фото показаны и во вкладке «Настройки» (шапка и список аккаунтов) — обновляем их тоже
    Settings.render();
  },

  // ── фото ──
  resize(file, size = 320) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(img.width, img.height), c = document.createElement("canvas");
        c.width = c.height = size;
        c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.86));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Не удалось открыть фото")); };
      img.src = url;
    });
  },
  async upload(file) {
    if (!file) return;
    try {
      const data = await Profile.resize(file);
      const d = await api("/api/me/avatar", { method: "POST", body: { data } });
      App.user = d.user; Profile.render(); toast("Фото обновлено");
    } catch (e) { toast(e.message || "Не удалось загрузить фото"); }
  },
  async removePhoto() {
    try { const d = await api("/api/me/avatar/remove", { method: "POST", body: {} }); App.user = d.user; Profile.render(); toast("Фото удалено"); }
    catch (e) { toast(e.message); }
  },

  // ── редактирование ──
  openEdit() {
    const u = App.user;
    $("ed-name").value = u.name || ""; $("ed-user").value = u.username || ""; $("ed-bio").value = u.bio || "";
    $("ed-av").innerHTML = avatar(u, "xl") + `<span class="cam">${ICON.camera}</span>`;
    Profile.unOK = true; Profile.check(); Nav.open("editprof");
  },

  hint(t, cls = "") { const h = $("ed-user-hint"); h.textContent = t; h.className = "hint2 " + cls; },

  check() {
    const u = App.user, un = $("ed-user").value.trim().replace(/^@/, ""), bio = $("ed-bio").value;
    $("ed-bio-cnt").textContent = bio.length + "/70";
    clearTimeout(Profile.unTimer);
    if (!un || un === u.username) { Profile.unOK = true; Profile.hint(un ? "Это ваше текущее имя пользователя" : "От 5 до 32 символов: латиница, цифры и _. Начинается с буквы."); }
    else if (!UN_RE.test(un) || un.includes("__")) { Profile.unOK = false; Profile.hint(/^\d/.test(un) ? "Имя пользователя не может начинаться с цифры" : "От 5 до 32 символов: латиница, цифры и _. Начинается с буквы.", "bad"); }
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
    const changed = name !== (u.name || "") || un !== (u.username || "") || $("ed-bio").value.trim() !== (u.bio || "");
    $("ed-save").disabled = !(changed && name && Profile.unOK);
  },

  async save() {
    const b = $("ed-save"); b.disabled = true;
    try {
      const d = await api("/api/me/update", { method: "POST", body: {
        name: $("ed-name").value.trim(), username: $("ed-user").value.trim().replace(/^@/, ""), bio: $("ed-bio").value.trim() } });
      App.user = d.user; Profile.render(); Nav.back(); toast("Профиль сохранён");
    } catch (e) { toast(e.message); Profile.btn(); }
  },

  bindEdit() {
    ["ed-name", "ed-user", "ed-bio"].forEach((id) => $(id).addEventListener("input", () => Profile.check()));
    $("ed-save").onclick = () => Profile.save();
    $("ed-av").onclick = () => $("file").click();
    $("file").onchange = (e) => { Profile.upload(e.target.files[0]); e.target.value = ""; };
  },
};
Profile.bindEdit();
