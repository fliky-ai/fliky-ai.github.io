// cemoji.js — свои (Premium) эмодзи: в тексте, в панели, в реакциях; новая панель реакций; окно набора эмодзи по ссылке.
//   CE        — кэш и отрисовка своих эмодзи (картинка / GIF / короткое видео), подмена значка на загруженный файл
//   React     — панель реакций над сообщением (как в Telegram) и «чипы» реакций под сообщением
//   EmojiPack — открыть набор по ссылке, добавить, скопировать ссылку, поделиться
const CE = {
  items: {}, need: new Set(), raf: 0, tm: 0, loading: false,

  put(list) { (list || []).forEach((i) => { if (i && i.id) CE.items[i.id] = i; }); },
  isVid(i) { return !!i && (i.video || /^video\//.test(i.mime || "")); },
  // картинка или зацикленное видео
  media(i, cls = "cem-m") {
    if (!i || !i.url) return "";
    const src = esc(fileUrl(i.url));
    return CE.isVid(i) ? `<video class="${cls}" src="${src}" autoplay loop muted playsinline disablepictureinpicture draggable="false"></video>` : `<img class="${cls}" src="${src}" alt="${esc(i.emoji || "")}" decoding="async" draggable="false">`;
  },
  // разметка эмодзи внутри текста; fb — обычный значок, который виден, пока файл не загружен
  html(id, fb, ed) {
    const i = CE.items[id];
    if (!i) CE.queue(id);
    return ed
      ? `<span class="ce${i ? " ok" : ""}" contenteditable="false" data-ce="${+id}" data-e="${esc(fb)}">${i ? CE.media(i) : esc(fb)}</span>`
      : `<span class="cem${i ? " ok" : ""}" data-ce="${+id}" data-e="${esc(fb)}">${i ? CE.media(i) : esc(fb)}</span>`;
  },
  node(id, fb) { const t = document.createElement("div"); t.innerHTML = CE.html(id, fb, true); return t.firstChild; },

  queue(id) {
    id = +id; if (!id || CE.items[id]) return;
    CE.need.add(id);
    clearTimeout(CE.tm); CE.tm = setTimeout(CE.flush, 60);
  },
  async flush() {
    const ids = [...CE.need].slice(0, 60); CE.need.clear();
    if (!ids.length) return;
    try { const d = await api("/api/emoji/items?ids=" + ids.join(",")); CE.put(d.items); } catch (e) { return; }
    CE.hydrate(document);
  },
  // подставить картинки в уже нарисованные значки
  hydrate(root) {
    root.querySelectorAll(".cem:not(.ok),.ce:not(.ok)").forEach((n) => {
      const i = CE.items[+n.dataset.ce];
      if (i) { n.innerHTML = CE.media(i); n.classList.add("ok"); } else CE.queue(n.dataset.ce);
    });
  },
  watch() {
    new MutationObserver(() => { cancelAnimationFrame(CE.raf); CE.raf = requestAnimationFrame(() => CE.hydrate(document)); }).observe(document.body, { childList: true, subtree: true });
  },
};

// ───────────── реакции ─────────────
const React = {
  sets: null, loadedAt: 0,

  async loadSets(force) {
    if (!App.user || !App.user.premium) { React.sets = []; return React.sets; }
    if (React.sets && !force && Date.now() - React.loadedAt < 60000) return React.sets;
    try {
      const d = await api("/api/emoji");
      React.sets = d.sets.concat(d.saved).filter((s) => s.items && s.items.length);
      React.sets.forEach((s) => CE.put(s.items));
      React.loadedAt = Date.now();
    } catch (e) { React.sets = React.sets || []; }
    return React.sets;
  },
  limit() { return App.user && App.user.premium ? 3 : 1; },
  mineOf(m) { return (m.reacts || []).filter((r) => r.mine).map((r) => r.e); },

  // значок реакции: обычный эмодзи или свой
  glyph(r) {
    const e = r.e || r;
    if (typeof e === "string" && e.startsWith("c:")) {
      const id = +e.slice(2), i = r.url ? { url: r.url, mime: r.mime } : CE.items[id];
      return i ? CE.media(i, "cem-m") : `<span class="cem-ph">★</span>`;
    }
    if (typeof e === "string" && e.startsWith("b:") && typeof ES !== "undefined") return `<span class="es-r">${ES.svg(e.slice(2))}</span>`;       // собственный значок Dicegram
    return esc(e);
  },
  chips(m) {
    if (!m.reacts || !m.reacts.length) return "";
    return `<div class="rx">${m.reacts.map((r) => `<button class="rx-chip${r.mine ? " mine" : ""}" data-e="${esc(r.e)}"><span class="e">${React.glyph(r)}</span>${r.n > 1 ? `<span class="n">${r.n}</span>` : ""}</button>`).join("")}</div>`;
  },

  // содержимое меню: верхняя панель реакций и (по кнопке) большая панель
  menuHTML(m, pr) {
    const rmode = pr.gk ? pr.react_mode || "all" : "all";
    const mine = new Set(React.mineOf(m));
    const some = rmode === "some";
    const QUICK = some ? (pr.react_list || []).slice(0, 7) : REACT_QUICK, ALL = some ? pr.react_list || [] : REACT_ALL;
    const prem = !!(App.user && App.user.premium);
    const btn = (e, i, inner) => `<button class="${mine.has(e) ? "on" : ""}" data-r="${esc(e)}" ${i !== undefined ? `style="--i:${i}"` : ""}>${inner || esc(e)}</button>`;
    const bar = `<div class="mm-react">${QUICK.map((e, i) => btn(e, i)).join("")}${ALL.length > QUICK.length || !some ? `<button class="mm-more" data-more aria-label="${esc(T("Ещё"))}" style="--i:7">${MIC.more}</button>` : ""}</div>`;
    let grid = `<div class="mm-grid hidden"><div class="mg-h"><b>${esc(T("Реакции"))}</b><small>${esc(prem ? T("до 3 на сообщение") : T("одна на сообщение"))}</small></div>
      <div class="mg-g">${ALL.map((e) => btn(e)).join("")}</div>`;
    if (!some && typeof ES !== "undefined") {            // собственные значки Dicegram — для всех
      grid += `<div class="mg-h"><b>Dicegram</b></div><div class="mg-g mg-d">${ES.items.map((x) => btn("b:" + x.id, undefined, ES.svg(x.id))).join("")}</div>`;
    }
    if (!some) {
      if (prem) {
        const sets = React.sets || [];
        grid += `<div class="mg-h"><b>${esc(T("Мои эмодзи"))}</b><span class="mg-pr">${PREM_I}Premium</span></div>`;
        grid += sets.length
          ? sets.map((s) => `<div class="mg-t">${esc(s.title)}</div><div class="mg-g mg-c">${s.items.map((i) => btn("c:" + i.id, undefined, CE.media(i))).join("")}</div>`).join("")
          : `<div class="mg-e">${esc(T("Создайте свои эмодзи: Настройки → Premium → Свои эмодзи"))}</div>`;
      } else {
        grid += `<button class="mg-lock" data-prem><span class="mg-li">${PREM_I}</span><span><b>${esc(T("Свои эмодзи в реакциях"))}</b><small>${esc(T("До 3 реакций и анимированные эмодзи — с Premium"))}</small></span><i>›</i></button>`;
      }
    }
    return { bar, grid: grid + "</div>" };
  },
};

// ───────────── кто поставил реакцию ─────────────
React.who = async function (m, only) {
  if (!m || !m.id) return;
  let d;
  try { d = await api("/api/react/who?id=" + m.id); } catch (e) { return toast(e.message); }
  d.tabs.forEach((t) => { if (t.url) CE.put([{ id: +t.e.slice(2), url: t.url, mime: t.mime }]); });
  const L = Gifts.layer("rw-ov", `<div class="rw-card" role="dialog"><button class="gb-x" data-x aria-label="${esc(T("Закрыть"))}">${GIC.x}</button>
    <h3>${esc(T("Реакции"))} · ${d.total}</h3>
    <div class="rw-tabs"><button class="on" data-t="">${esc(T("Все"))} ${d.total}</button>${d.tabs.map((t) => `<button data-t="${esc(t.e)}"><span class="e">${React.glyph(t)}</span>${t.n}</button>`).join("")}</div>
    <div class="rw-list"></div></div>`, 128);
  const el = L.el, list = el.querySelector(".rw-list");
  const draw = (tab) => {
    const rows = d.items.filter((x) => !tab || x.e === tab);
    list.innerHTML = rows.map((x) => `<button class="rw-row" data-u="${x.user.id}">${avatar(x.user, "sm")}<span class="tx"><b>${esc(x.user.id === (App.user && App.user.id) ? T("Вы") : dispName(x.user))}</b></span><span class="e">${React.glyph(x)}</span></button>`).join("") || `<p class="rw-e">${esc(T("Пока никто"))}</p>`;
  };
  draw(only || "");
  if (only) { el.querySelectorAll(".rw-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === only)); }
  el.addEventListener("click", (e) => {
    const t = e.target.closest(".rw-tabs button");
    if (t) { el.querySelectorAll(".rw-tabs button").forEach((b) => b.classList.toggle("on", b === t)); draw(t.dataset.t); return; }
    const r = e.target.closest(".rw-row");
    if (r) {
      const it = d.items.find((x) => String(x.user.id) === r.dataset.u); if (!it) return;
      L.close && L.close();
      if (it.user.id !== (App.user && App.user.id)) setTimeout(() => { try { UserProfile.open(it.user); } catch (er) {} }, 200);
    }
  });
};

// ───────────── набор эмодзи по ссылке ─────────────
const EmojiPack = {
  async open(code) {
    let d;
    try { d = (await api("/api/emoji/pack/" + encodeURIComponent(code))).set; } catch (e) { return toast(e.message); }
    CE.put(d.items);
    const prem = !!(App.user && App.user.premium);
    const L = Gifts.layer("ep-ov", `<div class="ep-card" role="dialog"><button class="gb-x" data-x aria-label="${esc(T("Закрыть"))}">${GIC.x}</button>
      <h3>${esc(d.title || T("Эмодзи"))}</h3>
      <p class="ep-sub">${esc(d.items.length + " " + plural(d.items.length, T("эмодзи"), T("эмодзи"), T("эмодзи")))}${d.owner ? " · " + esc(T("автор: {0}", dispName(d.owner))) : ""}</p>
      <div class="ep-g">${d.items.map((i) => `<span class="ep-i">${CE.media(i)}</span>`).join("")}</div>
      ${prem ? "" : `<p class="ep-note">${esc(T("Использовать свои эмодзи в сообщениях и реакциях можно с Premium."))}</p>`}
      <div class="ep-b"><button class="ep-main" data-a="add"></button><div class="ep-row"><button data-a="copy">${esc(T("Копировать ссылку"))}</button><button data-a="share">${esc(T("Поделиться"))}</button></div></div></div>`, 128);
    const el = L.el, main = el.querySelector(".ep-main");
    const paint = () => { main.textContent = d.mine ? T("Это ваш набор") : d.added ? T("Удалить набор") : T("Добавить эмодзи"); main.classList.toggle("rm", !!d.added && !d.mine); main.disabled = !!d.mine; };
    paint();
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      haptic();
      const link = d.link || location.href;
      if (b.dataset.a === "copy") { copyText(link); return toast(T("Ссылка скопирована")); }
      if (b.dataset.a === "share") {
        try { if (navigator.share) return await navigator.share({ title: d.title, url: link }); } catch (er) { return; }
        copyText(link); return toast(T("Ссылка скопирована"));
      }
      if (b.dataset.a === "add" && !d.mine) {
        try {
          await api("/api/emoji/pack/" + encodeURIComponent(code) + (d.added ? "/remove" : "/add"), { method: "POST", body: {} });
          d.added = !d.added; paint(); React.sets = null; toast(T(d.added ? "Набор добавлен" : "Набор удалён"));
          try { Panel.loaded = false; if (Panel.open) Panel.load(); } catch (er) {}
        } catch (er) { toast(er.message); }
      }
    });
  },
};

document.addEventListener("DOMContentLoaded", () => { try { CE.watch(); } catch (e) {} });
