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

  // плитки-варианты (как меню вложений): tiles = [{k, label, icon, cls}]. Возвращает k или null.
  tiles({ title = "", text = "", tiles = [], cancel = "Отмена" }) {
    return new Promise((res) => {
      const el = document.createElement("div");
      el.className = "sheet2";
      el.innerHTML = `<div class="s2-card" role="dialog">${title ? `<h3>${esc(title)}</h3>` : ""}${text ? `<p>${esc(text)}</p>` : ""}
        <div class="tiles">${tiles.map((t) => `<button data-k="${esc(t.k)}" class="tile ${t.cls || "t-blue"}">${t.icon || ""}<span>${esc(t.label)}</span></button>`).join("")}</div>
        <div class="s2-btns"><button data-k="" class="s2-cancel">${esc(cancel)}</button></div></div>`;
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add("show"));
      const done = (v) => { el.classList.remove("show"); setTimeout(() => el.remove(), 200); res(v); };
      el.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-k]");
        if (b) return done(b.dataset.k || null);
        if (e.target === el) done(null);
      });
    });
  },

  // выбор даты (день / месяц / год колёсами). value — "ГГГГ-ММ-ДД" или "--ММ-ДД". Возвращает строку того же вида,
  // "" — если дату убрали, null — отмена. Год можно не указывать («Без года»).
  date({ title = "Дата", value = "", clearLabel = "Удалить" }) {
    return new Promise((res) => {
      const H = 40, cy = new Date().getFullYear();
      const p = parseBday(value) || { y: 2000, m: 1, d: 1 };
      const st = { d: p.d, m: p.m, y: p.y };
      const years = [0]; for (let y = cy; y >= 1900; y--) years.push(y);
      const dim = () => new Date(st.y || 2000, st.m, 0).getDate();
      const el = document.createElement("div");
      el.className = "sheet2";
      el.innerHTML = `<div class="s2-card dp" role="dialog"><h3>${esc(title)}</h3>
        <div class="dp-wheels"><div class="dp-band"></div>
          <div class="wh" data-w="d"></div><div class="wh wide" data-w="m"></div><div class="wh" data-w="y"></div></div>
        <div class="s2-row"><button data-a="no">Отмена</button>${value ? `<button data-a="x" class="danger">${esc(clearLabel)}</button>` : ""}<button data-a="ok" class="accent">Готово</button></div></div>`;
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add("show"));
      const wh = (k) => el.querySelector(`.wh[data-w="${k}"]`);
      const items = { d: () => Array.from({ length: dim() }, (_, i) => String(i + 1)), m: () => MON_N,
                      y: () => years.map((y) => (y ? String(y) : "Без года")) };
      const build = (k, idx) => {
        const w = wh(k), list = items[k]();
        w.innerHTML = `<i class="wh-pad"></i>${list.map((t, i) => `<b class="wh-i${i === idx ? " on" : ""}" data-i="${i}">${esc(t)}</b>`).join("")}<i class="wh-pad"></i>`;
        w.scrollTop = idx * H;
        w._idx = idx; w._n = list.length;
      };
      build("d", st.d - 1); build("m", st.m - 1); build("y", Math.max(0, years.indexOf(st.y)));
      const onScroll = (k) => {
        const w = wh(k), i = Math.max(0, Math.min(w._n - 1, Math.round(w.scrollTop / H)));
        if (i === w._idx) return;
        w.children[w._idx + 1].classList.remove("on"); w.children[i + 1].classList.add("on"); w._idx = i;
        if (k === "d") st.d = i + 1; else if (k === "m") st.m = i + 1; else st.y = years[i];
        if (k !== "d") {                                   // в месяце может быть меньше дней
          const n = dim(), dw = wh("d");
          if (dw._n !== n) { st.d = Math.min(st.d, n); build("d", st.d - 1); }
        }
      };
      ["d", "m", "y"].forEach((k) => {
        wh(k).addEventListener("scroll", () => onScroll(k), { passive: true });
        wh(k).addEventListener("click", (e) => { const b = e.target.closest(".wh-i"); if (b) wh(k).scrollTo({ top: +b.dataset.i * H, behavior: "smooth" }); });
      });
      const done = (v) => { el.classList.remove("show"); setTimeout(() => el.remove(), 200); res(v); };
      el.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-a]");
        if (!b) { if (e.target === el) done(null); return; }
        if (b.dataset.a === "no") return done(null);
        if (b.dataset.a === "x") return done("");
        const mm = String(st.m).padStart(2, "0"), dd = String(st.d).padStart(2, "0");
        if (st.y && new Date(st.y, st.m - 1, st.d) > new Date()) return toast("Дата рождения не может быть в будущем");
        done(st.y ? `${st.y}-${mm}-${dd}` : `--${mm}-${dd}`);
      });
    });
  },

  // поле ввода одной строки (например, адрес ссылки). null — отмена.
  prompt({ title = "", value = "", placeholder = "", ok = "Готово", extra = "", type = "url" }) {
    return new Promise((res) => {
      const el = document.createElement("div");
      el.className = "sheet2";
      el.innerHTML = `<div class="s2-card" role="dialog"><h3>${esc(title)}</h3>
        <input class="s2-input" type="${type}" inputmode="${type === "url" ? "url" : "text"}" maxlength="${type === "url" ? 600 : 32}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(placeholder)}" value="${esc(value)}">
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
