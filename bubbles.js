// bubbles.js — персональные стили пузырей сообщений (как в TikTok). Выбор — Настройки чатов → Стиль пузыря.
// Стиль принадлежит человеку (как аватарка): его сообщения у всех собеседников и в группах рисуются в его стиле.
const Bubbles = {
  LIST: [
    ["", "По умолчанию"], ["sketch", "Эскиз"], ["ocean", "Океан"], ["blossom", "Цветение"], ["lemon", "Лимонад"], ["ink", "Тушь"],
    ["neon", "Неон"], ["sunset", "Закат"], ["mint", "Мята"], ["candy", "Конфетти"], ["ice", "Лёд"], ["gold", "Золото"],
    ["cosmos", "Космос"], ["berry", "Ягода"], ["forest", "Лес"], ["paper", "Бумага"],
  ],
  has(id) { return !!id && Bubbles.LIST.some((x) => x[0] === id); },
  name(id) { const r = Bubbles.LIST.find((x) => x[0] === (id || "")); return r ? r[1] : Bubbles.LIST[0][1]; },
  // какой стиль у автора сообщения m в открытом чате
  of(m, out, inGroup) {
    let id = "";
    if (out) id = App.user && App.user.bubble;
    else if (inGroup) id = m.from && m.from.bubble;
    else if (Chat.peer && !Chat.peer.gk && m.sender === Chat.peer.id) id = Chat.peer.bubble;
    return Bubbles.has(id) ? id : "";
  },
  attr(id) { return id ? ` data-bs="${id}"` : ""; },

  pick() {
    let sel = (App.user && App.user.bubble) || "", saved = sel;
    const el = document.createElement("div");
    el.className = "bsp";
    const tile = (id, name) => `<button class="bsp-t${id === sel ? " on" : ""}" data-id="${id}"><div class="pv"><div class="b out${id ? "" : " bsd"}"${Bubbles.attr(id)}></div></div><span>${esc(T(name))}</span></button>`;
    el.innerHTML = `
      <div class="bsp-top"><button class="bsp-cancel">${esc(T("Отмена"))}</button><b>${esc(T("Выберите стиль пузыря"))}</b><button class="bsp-save" disabled>${esc(T("Сохранить"))}</button></div>
      <div class="bsp-prev" id="bsp-prev"></div>
      <div class="bsp-sheet"><div class="bsp-grab"></div><h4>${esc(T("Рекомендуемые"))}</h4>
        <p>${esc(T("Ваш пузырь увидят все, с кем вы общаетесь — в личных чатах и группах. У остальных людей пузыри не меняются."))}</p>
        <div class="bsp-grid">${Bubbles.LIST.map(([id, n]) => tile(id, n)).join("")}</div></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    const prev = el.querySelector("#bsp-prev"), save = el.querySelector(".bsp-save");
    const draw = () => {
      prev.innerHTML = `<div class="row out"><div class="b out"${Bubbles.attr(sel)}>${esc(T("А ты знаешь, что можно изменить стиль пузыря, и чаты будут выглядеть по-новому!"))}<span class="t">12:41 ✓✓</span></div></div>
        <div class="row"><div class="b in">${esc(T("Выглядит потрясающе! Я тоже изменю."))}<span class="t">12:41</span></div></div>`;
      el.querySelectorAll(".bsp-t").forEach((b) => b.classList.toggle("on", b.dataset.id === sel));
      save.disabled = sel === saved;
    };
    draw();
    const close = () => { el.classList.remove("show"); setTimeout(() => el.remove(), 240); };
    el.addEventListener("click", async (e) => {
      const t = e.target.closest(".bsp-t");
      if (t) { sel = t.dataset.id; haptic("light"); return draw(); }
      if (e.target.closest(".bsp-cancel")) return close();
      if (e.target.closest(".bsp-save") && !save.disabled) {
        save.disabled = true;
        try {
          const d = await api("/api/me/bubble", { method: "POST", body: { bubble: sel } });
          if (App.user) App.user.bubble = d.bubble || "";
          close(); toast(T("Стиль пузыря сохранён")); Bubbles.refresh();
          try { Settings.render(); } catch (er) {}
        } catch (er) { save.disabled = false; toast(er.message); }
      }
    });
  },
  // перерисовать открытый чат (сменился чей-то стиль)
  refresh() { try { if (Chat.peer && typeof Chat.render === "function") Chat.render(true); } catch (e) {} },
};
