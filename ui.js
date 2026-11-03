// ui.js — свои нижние окна вместо системных диалогов (alert/confirm/prompt).
const UI = {
  // actions: [{label, value, danger, accent}]. Возвращает value нажатой кнопки или null (отмена / тап мимо).
  sheet({ title = "", text = "", actions = [], cancel = "Отмена", icon = "" }) {
    return new Promise((res) => {
      const el = document.createElement("div");
      el.className = "sheet2";
      el.innerHTML = `<div class="s2-card" role="dialog">
        ${icon ? `<div class="s2-ic">${icon}</div>` : ""}
        ${title ? `<h3>${esc(title)}</h3>` : ""}${text ? `<p>${esc(text)}</p>` : ""}
        <div class="s2-btns">${actions.map((a, i) => `<button data-i="${i}" class="${a.danger ? "danger" : ""}${a.accent ? " accent" : ""}">${esc(a.label)}</button>`).join("")}
        ${cancel ? `<button data-i="-1" class="s2-cancel">${esc(cancel)}</button>` : ""}</div></div>`;
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add("show"));
      const done = (v) => {
        el.classList.remove("show");
        setTimeout(() => el.remove(), 200);
        res(v);
      };
      el.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-i]");
        if (b) { const i = +b.dataset.i; return done(i < 0 ? null : actions[i].value); }
        if (e.target === el) done(null);
      });
    });
  },

  // поле ввода одной строки (например, адрес ссылки). null — отмена.
  prompt({ title = "", value = "", placeholder = "", ok = "Готово", extra = "" }) {
    return new Promise((res) => {
      const el = document.createElement("div");
      el.className = "sheet2";
      el.innerHTML = `<div class="s2-card" role="dialog"><h3>${esc(title)}</h3>
        <input class="s2-input" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(placeholder)}" value="${esc(value)}">
        <div class="s2-row"><button data-a="no">Отмена</button>${extra ? `<button data-a="x" class="danger">${esc(extra)}</button>` : ""}<button data-a="ok" class="accent">${esc(ok)}</button></div></div>`;
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add("show"));
      const inp = el.querySelector("input");
      setTimeout(() => { try { inp.focus(); inp.select(); } catch (e) {} }, 220);
      const done = (v) => {
        el.classList.remove("show");
        setTimeout(() => el.remove(), 200);
        res(v);
      };
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") done(inp.value.trim()); });
      el.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-a]");
        if (b) return done(b.dataset.a === "ok" ? inp.value.trim() : b.dataset.a === "x" ? "" : null);
        if (e.target === el) done(null);
      });
    });
  },
};

// ссылка из введённого текста: добавляем https://, если схемы нет
function normUrl(s) {
  s = String(s || "").trim();
  if (!s) return "";
  if (/^(https?:\/\/|tg:\/\/|mailto:)/i.test(s)) return s;
  if (/^[\w.-]+@[\w.-]+\.\w+$/.test(s)) return "mailto:" + s;
  return /^[^\s]+\.[^\s]{2,}$/.test(s) ? "https://" + s : "";
}
