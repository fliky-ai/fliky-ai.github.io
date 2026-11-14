// editor.js — поле ввода сообщения (contenteditable) с форматированием и своим меню выделения:
// [Вырезать] [Копировать] [Цитата] [⋮] → Скрытый, Вставить, Жирный, Курсив, Подчёркнутый, Зачёркнутый, Моноширинный, Ссылка, Обычный.
const Editor = {
  el: null, tb: null, last: null, clip: "", raf: 0, onChange: null,

  init() {
    const el = (Editor.el = $("msg-input"));
    el.addEventListener("input", () => Editor.changed());
    el.addEventListener("paste", (e) => {
      const cd = e.clipboardData || window.clipboardData;
      // картинки/файлы из буфера — пусть обработает вложение (если умеет), текст — сами
      if (cd && cd.files && cd.files.length && !(cd.getData("text/plain") || "")) {
        e.preventDefault();
        if (typeof Attach !== "undefined" && Attach.preview) { try { Attach.preview([...cd.files]); } catch (er) {} }
        return;
      }
      e.preventDefault();
      const r = typeof RClip !== "undefined" ? RClip.read(e) : { text: ((cd && cd.getData("text/plain")) || "").replace(/\r/g, ""), ents: [] };
      if (!r.text) return;
      if (r.ents && r.ents.length) Editor.insertRich(r.text, r.ents);       // свои эмодзи и форматирование сохраняются
      else Editor.insert(r.text);
    });
    el.addEventListener("drop", (e) => e.preventDefault());
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== el) Editor.hideTb(); }, 120));
    document.addEventListener("selectionchange", () => {
      cancelAnimationFrame(Editor.raf);
      Editor.raf = requestAnimationFrame(() => Editor.selChanged());
    });
    Editor.buildTb();
    Editor.changed();
  },

  // ── содержимое ──
  get() { return Rich.read(Editor.el); },
  isEmpty() { return Rich.readRaw(Editor.el).text.trim() === ""; },
  set(text, ents) {
    Rich.write(Editor.el, text, ents);
    Editor.changed();
    Editor.caretEnd();
  },
  clear() { Editor.el.innerHTML = ""; Editor.last = null; Editor.hideTb(); Editor.changed(); },
  changed() {
    const el = Editor.el;
    if (el.textContent === "" && el.innerHTML !== "" && !el.querySelector("[data-ce]")) el.innerHTML = "";   // убираем «хвосты» <br>/<div>, чтобы вернулся placeholder
    el.dataset.empty = Rich.readRaw(el).text.length === 0 ? "1" : "";
    if (Editor.onChange) Editor.onChange();
  },
  focus(noKeyboard) {
    const el = Editor.el;
    el.setAttribute("inputmode", noKeyboard ? "none" : "text");
    el.focus({ preventScroll: true });
    Editor.restore();
  },
  caretEnd() {
    const el = Editor.el, r = document.createRange();
    r.selectNodeContents(el); r.collapse(false);
    Editor.last = r;
    if (document.activeElement === el) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  },
  restore() {
    const s = getSelection(), el = Editor.el;
    const r = Editor.last && el.contains(Editor.last.commonAncestorContainer) ? Editor.last : null;
    if (r) { s.removeAllRanges(); s.addRange(r); }
    else if (!s.rangeCount || !el.contains(s.anchorNode)) Editor.caretEnd();
  },
  insert(str) {
    const el = Editor.el;
    if (document.activeElement !== el) { el.focus({ preventScroll: true }); Editor.restore(); }
    if (!document.execCommand("insertText", false, str)) {
      const s = getSelection();
      if (s.rangeCount) { const r = s.getRangeAt(0); r.deleteContents(); r.insertNode(document.createTextNode(str)); r.collapse(false); }
    }
    Editor.changed();
  },
  // вставить текст вместе с сущностями (свои эмодзи, жирный, ссылки…) в позицию курсора
  insertRich(text, ents) {
    const el = Editor.el;
    if (document.activeElement !== el) { el.focus({ preventScroll: true }); Editor.restore(); }
    const raw = Rich.readRaw(el);
    const o = Editor.offsets() || [raw.text.length, raw.text.length];
    const r = Rich.splice(raw.text, raw.ents, o[0], o[1], text, ents);
    Rich.write(el, r.text, r.ents);
    const p = o[0] + text.length;
    try { Editor.select(p, p); } catch (e) { Editor.caretEnd(); }
    Editor.changed();
  },
  selectedRich() {
    const o = Editor.offsets();
    if (!o || o[1] <= o[0]) return null;
    const raw = Rich.readRaw(Editor.el);
    const ents = [];
    raw.ents.forEach((x) => {
      const a = Math.max(x.o, o[0]), b = Math.min(x.o + x.l, o[1]);
      if (b <= a) return;
      if (x.t === "ce" && (a !== x.o || b !== x.o + x.l)) return;      // эмодзи разрезан — не берём
      ents.push(Object.assign({}, x, { o: a - o[0], l: b - a }));
    });
    return { text: raw.text.slice(o[0], o[1]), ents };
  },
  // вставить свой (Premium) эмодзи: в поле он виден картинкой, при отправке уходит как значок + сущность ce
  insertCE(it) {
    const el = Editor.el;
    if (document.activeElement !== el) { el.focus({ preventScroll: true }); Editor.restore(); }
    const node = CE.node(it.id, it.emoji || "🙂");
    const s = getSelection();
    if (!s.rangeCount || !el.contains(s.anchorNode)) Editor.caretEnd();
    const r = getSelection().getRangeAt(0);
    r.deleteContents(); r.insertNode(node); r.setStartAfter(node); r.collapse(true);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    Editor.last = r.cloneRange();
    Editor.changed();
  },
  backspace() {
    if (document.activeElement !== Editor.el) { Editor.el.focus({ preventScroll: true }); Editor.restore(); }
    document.execCommand("delete");
    Editor.changed();
  },

  // ── выделение ──
  range() {
    const s = getSelection();
    if (!s.rangeCount) return null;
    const r = s.getRangeAt(0);
    return Editor.el.contains(r.commonAncestorContainer) ? r : null;
  },
  select(s, e) {
    const [n1, o1] = Rich.posOf(Editor.el, s), [n2, o2] = Rich.posOf(Editor.el, e);
    const r = document.createRange();
    r.setStart(n1, o1); r.setEnd(n2, o2);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    Editor.last = r.cloneRange();
  },
  offsets() {
    const r = Editor.range();
    if (!r) return null;
    return [Rich.offsetOf(Editor.el, r.startContainer, r.startOffset), Rich.offsetOf(Editor.el, r.endContainer, r.endOffset)];
  },
  format(t, url) {
    const o = Editor.offsets();
    if (!o || o[1] <= o[0]) return;
    const raw = Rich.readRaw(Editor.el);
    const ents = t === "plain" ? Rich.mergeEnts(Rich.subtract(raw.ents, null, o[0], o[1])) : Rich.toggle(raw.ents, t, o[0], o[1], url);
    Rich.write(Editor.el, raw.text, ents);
    Editor.select(o[0], o[1]);
    Editor.changed();
    Editor.placeTb();
  },
  selectedText() {
    const o = Editor.offsets();
    return o ? Rich.readRaw(Editor.el).text.slice(o[0], o[1]) : "";
  },

  // ── своё меню выделения ──
  buildTb() {
    const tb = (Editor.tb = document.createElement("div"));
    tb.id = "seltb"; tb.className = "seltb hidden";
    tb.innerHTML = `<div class="tb-main">
        <button data-a="cut">Вырезать</button><button data-a="copy">Копировать</button><button data-a="q">Цитата</button>
        <button data-a="more" class="tb-dots" aria-label="Ещё"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button></div>
      <div class="tb-more hidden">
        <button data-a="sp">Скрытый</button><button data-a="paste">Вставить</button>
        <button data-a="b" class="f-b">Жирный</button><button data-a="i" class="f-i">Курсив</button>
        <button data-a="u" class="f-u">Подчёркнутый</button><button data-a="s" class="f-s">Зачёркнутый</button>
        <button data-a="c" class="f-c">Моноширинный</button><button data-a="a">Ссылка</button><button data-a="plain">Обычный</button>
        <button data-a="back" class="tb-back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12H4"/><path d="m10 6-6 6 6 6"/></svg>Назад</button></div>`;
    document.body.appendChild(tb);
    // кнопки не должны забирать фокус и сбрасывать выделение
    tb.addEventListener("pointerdown", (e) => e.preventDefault());
    tb.addEventListener("mousedown", (e) => e.preventDefault());
    tb.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-a]");
      if (b) Editor.act(b.dataset.a);
    });
  },
  tbMore(on) {
    Editor.tb.querySelector(".tb-main").classList.toggle("hidden", on);
    Editor.tb.querySelector(".tb-more").classList.toggle("hidden", !on);
    Editor.placeTb();
  },
  selChanged() {
    if (Editor.mute && Date.now() < Editor.mute) return;
    const r = Editor.range();
    if (r) Editor.last = r.cloneRange();
    if (!r || r.collapsed || document.activeElement !== Editor.el) {
      if (!Editor.tb.contains(document.activeElement)) Editor.hideTb();
      return;
    }
    if (Editor.tb.classList.contains("hidden")) Editor.tbMore(false);
    Editor.tb.classList.remove("hidden");
    Editor.placeTb();
  },
  hideTb() { if (Editor.tb) Editor.tb.classList.add("hidden"); },
  placeTb() {
    const r = Editor.range(), tb = Editor.tb;
    if (!r || tb.classList.contains("hidden")) return;
    const rc = r.getBoundingClientRect(), w = tb.offsetWidth, h = tb.offsetHeight;
    const gap = /Android/i.test(navigator.userAgent) ? 58 : 10;   // на Android выше системной панели, если она показалась
    const vv = window.visualViewport, vb = vv ? Math.min(innerHeight, vv.height + vv.offsetTop) : innerHeight;      // видимая область — без клавиатуры
    let top = rc.top - h - gap;
    if (top < 8) top = rc.bottom + gap;
    top = Math.max(8, Math.min(top, vb - h - 8));
    const left = Math.max(8, Math.min(rc.left + rc.width / 2 - w / 2, innerWidth - w - 8));
    tb.style.left = left + "px"; tb.style.top = top + "px";
  },
  async paste() {
    let t = "";
    try { t = await navigator.clipboard.readText(); } catch (e) {}
    if (!t) t = Editor.clip;
    if (!t) return toast("Буфер обмена пуст");
    t = t.replace(/\r/g, "");
    const ents = typeof RClip !== "undefined" ? RClip.ents(t) : null;
    if (ents && ents.length) return Editor.insertRich(t, ents);
    Editor.insert(t);
  },
  async act(a) {
    haptic("light");
    if (a === "more") return Editor.tbMore(true);
    if (a === "back") return Editor.tbMore(false);
    if (a === "copy" || a === "cut") {
      const r = Editor.selectedRich();
      const t = r ? r.text : "";
      if (!t) return;
      Editor.clip = t;
      if (typeof RClip !== "undefined") RClip.set(t, r.ents); else copyText(t);
      if (a === "cut") { document.execCommand("delete"); Editor.changed(); }
      else toast("Скопировано");
      return Editor.hideTb();
    }
    if (a === "paste") { Editor.hideTb(); return Editor.paste(); }
    if (a === "a") {
      const o = Editor.offsets();
      if (!o || o[1] <= o[0]) return;
      const raw = Rich.readRaw(Editor.el);
      const cur = raw.ents.find((x) => x.t === "a" && x.o <= o[0] && x.o + x.l >= o[1]);
      const saved = o.slice();
      const v = await UI.prompt({ title: "Ссылка", value: cur ? cur.u : "", placeholder: "https://…", extra: cur ? "Убрать" : "" });
      Editor.focus(false);
      if (v === null) return Editor.select(saved[0], saved[1]);
      Editor.select(saved[0], saved[1]);
      if (v === "") return Editor.format("a", "");
      const u = normUrl(v);
      if (!u) return toast("Это не похоже на ссылку");
      return Editor.format("a", u);
    }
    Editor.format(a);
    // как в Telegram: после выбора начертания меню сразу закрывается, выделение остаётся
    Editor.mute = Date.now() + 500;
    Editor.tbMore(false);
    Editor.hideTb();
  },
};
