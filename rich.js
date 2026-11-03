// rich.js — форматированный текст: сущности {t,o,l,u} ↔ HTML ↔ поле ввода (contenteditable).
// t: b жирный, i курсив, u подчёркнутый, s зачёркнутый, c моноширинный, sp скрытый, q цитата, a ссылка (u — адрес).
// Смещения o/l — в единицах UTF-16 (как в JS-строках), сервер проверяет их по тому же правилу.
const Rich = (() => {
  const RANK = { a: 0, b: 1, i: 2, u: 3, s: 4, c: 5, sp: 6, q: 7 };
  const URL_RE = /(https?:\/\/[^\s<]*[^\s<.,;:!?)\]}'"»])/g;
  const safeUrl = (u) => (/^(https?:\/\/|tg:\/\/|mailto:)/i.test(u || "") ? u : "");

  function wrap(html, e, ed) {
    switch (e.t) {
      case "b": return `<b>${html}</b>`;
      case "i": return `<i>${html}</i>`;
      case "u": return `<u>${html}</u>`;
      case "s": return `<s>${html}</s>`;
      case "c": return `<code>${html}</code>`;
      case "sp": return `<span class="sp">${html}</span>`;
      case "q": return ed ? `<span class="q">${html}</span>` : html;
      case "a": return `<a href="${esc(safeUrl(e.u))}" rel="noopener">${html}</a>`;
    }
    return html;
  }

  // кусок текста [a,b) со всеми сущностями (кроме q в обычном режиме)
  function seg(text, ents, a, b, ed) {
    const cuts = new Set([a, b]);
    ents.forEach((e) => {
      if (e.o > a && e.o < b) cuts.add(e.o);
      const end = e.o + e.l;
      if (end > a && end < b) cuts.add(end);
    });
    const pts = [...cuts].sort((x, y) => x - y);
    let out = "";
    for (let i = 0; i < pts.length - 1; i++) {
      const s = pts[i], t = pts[i + 1];
      let html = esc(text.slice(s, t));
      const act = ents.filter((e) => e.o <= s && e.o + e.l >= t).sort((x, y) => RANK[y.t] - RANK[x.t]);
      if (ed) html = html.replace(/\n/g, "<br>");
      else if (!act.some((e) => e.t === "a" || e.t === "c")) {
        html = html.replace(URL_RE, (m) => `<a href="${m}" rel="noopener">${m}</a>`);
      }
      act.forEach((e) => { html = wrap(html, e, ed); });
      out += html;
    }
    return out;
  }

  const mergeRanges = (list) => {
    const r = list.map((e) => [e.o, e.o + e.l]).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const x of r) {
      if (out.length && x[0] <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], x[1]);
      else out.push(x);
    }
    return out;
  };

  const clean = (text, ents) => (Array.isArray(ents) ? ents : []).filter((e) => e && e.o >= 0 && e.l > 0 && e.o + e.l <= text.length && RANK[e.t] !== undefined);

  // HTML для пузыря сообщения
  function render(text, ents) {
    text = text || "";
    const all = clean(text, ents);
    const qs = mergeRanges(all.filter((e) => e.t === "q"));
    const rest = all.filter((e) => e.t !== "q");
    if (!qs.length) return seg(text, rest, 0, text.length, false);
    let out = "", pos = 0;
    for (let [s, e] of qs) {
      while (s < e && text[s] === "\n") s++;
      while (e > s && text[e - 1] === "\n") e--;
      if (s >= e) continue;
      let before = s;
      if (text[before - 1] === "\n") before--;
      if (before > pos) out += seg(text, rest, pos, before, false);
      out += `<blockquote>${seg(text, rest, s, e, false)}</blockquote>`;
      pos = e;
      if (text[pos] === "\n") pos++;
    }
    if (pos < text.length) out += seg(text, rest, pos, text.length, false);
    return out;
  }

  // ── поле ввода ──
  const TAGMAP = { B: "b", STRONG: "b", I: "i", EM: "i", U: "u", S: "s", STRIKE: "s", DEL: "s", CODE: "c", TT: "c", A: "a", BLOCKQUOTE: "q" };
  function typesOf(n) {
    const out = [];
    const t = TAGMAP[n.tagName];
    if (t) out.push(t);
    if (n.tagName === "SPAN") {
      if (n.classList.contains("sp")) out.push("sp");
      if (n.classList.contains("q")) out.push("q");
      const st = n.style || {};
      if (st.fontWeight === "bold" || +st.fontWeight >= 600) out.push("b");
      if (st.fontStyle === "italic") out.push("i");
      const td = st.textDecorationLine || st.textDecoration || "";
      if (/underline/.test(td)) out.push("u");
      if (/line-through/.test(td)) out.push("s");
    }
    return out;
  }

  function mergeEnts(ents) {
    const by = {};
    ents.forEach((e) => { (by[e.t + "|" + (e.u || "")] = by[e.t + "|" + (e.u || "")] || []).push(e); });
    const out = [];
    Object.values(by).forEach((list) => {
      list.sort((x, y) => x.o - y.o);
      let cur = null;
      for (const e of list) {
        if (cur && e.o <= cur.o + cur.l) cur.l = Math.max(cur.l, e.o + e.l - cur.o);
        else { cur = Object.assign({}, e); out.push(cur); }
      }
    });
    return out.sort((x, y) => x.o - y.o || RANK[x.t] - RANK[y.t]);
  }

  // DOM поля → {text, ents} без обрезки (смещения совпадают с позициями курсора)
  function readRaw(root) {
    let text = "";
    const ents = [];
    const walk = (n) => {
      if (n.nodeType === 3) { text += n.nodeValue.replace(/[​﻿]/g, ""); return; }
      if (n.nodeType !== 1) return;
      if (n.tagName === "BR") { text += "\n"; return; }
      const block = n.tagName === "DIV" || n.tagName === "P";
      if (block && text && !text.endsWith("\n")) text += "\n";
      const start = text.length, types = typesOf(n);
      n.childNodes.forEach(walk);
      if (text.length > start) {
        types.forEach((t) => {
          const e = { t, o: start, l: text.length - start };
          if (t === "a") { e.u = n.getAttribute("href") || ""; if (!safeUrl(e.u)) return; }
          ents.push(e);
        });
      }
    };
    root.childNodes.forEach(walk);
    return { text, ents: mergeEnts(ents) };
  }

  // для отправки: обрезаем пробелы/переводы строк по краям и подгоняем смещения
  function read(root) {
    const raw = readRaw(root);
    let text = raw.text;
    const lead = text.length - text.replace(/^\s+/, "").length;
    text = text.replace(/\s+$/, "").slice(lead);
    const ents = [];
    raw.ents.forEach((e) => {
      let o = e.o - lead, end = o + e.l;
      if (o < 0) o = 0;
      if (end > text.length) end = text.length;
      if (end > o) ents.push(Object.assign({}, e, { o, l: end - o }));
    });
    return { text, ents };
  }

  function write(root, text, ents) {
    text = text || "";
    let html = seg(text, clean(text, ents), 0, text.length, true);
    if (text.endsWith("\n")) html += "<br>";
    root.innerHTML = html;
  }

  // позиция в DOM ↔ смещение в тексте
  function offsetOf(root, node, off) {
    const r = document.createRange();
    r.selectNodeContents(root);
    try { r.setEnd(node, off); } catch (e) { return 0; }
    const tmp = document.createElement("div");
    tmp.appendChild(r.cloneContents());
    return readRaw(tmp).text.length;
  }
  function posOf(root, off) {
    let left = off;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) {
        const len = n.nodeValue.length;
        if (left <= len) return [n, left];
        left -= len;
      } else if (n.tagName === "BR") {
        if (left === 0) return [n.parentNode, Array.prototype.indexOf.call(n.parentNode.childNodes, n)];
        left -= 1;
      }
    }
    return [root, root.childNodes.length];
  }

  // вычесть [s,e) из сущностей типа t (или всех, если t == null)
  function subtract(ents, t, s, e) {
    const out = [];
    ents.forEach((x) => {
      if (t && x.t !== t) { out.push(x); return; }
      const xe = x.o + x.l;
      if (xe <= s || x.o >= e) { out.push(x); return; }
      if (x.o < s) out.push(Object.assign({}, x, { l: s - x.o }));
      if (xe > e) out.push(Object.assign({}, x, { o: e, l: xe - e }));
    });
    return out;
  }
  function covered(ents, t, s, e) {
    const list = ents.filter((x) => x.t === t).sort((a, b) => a.o - b.o);
    let pos = s;
    for (const x of list) {
      if (x.o <= pos && x.o + x.l > pos) pos = x.o + x.l;
      if (pos >= e) return true;
    }
    return pos >= e;
  }
  // включить/выключить формат на диапазоне
  function toggle(ents, t, s, e, url) {
    if (t === "a") {
      const base = subtract(ents, "a", s, e);
      return url ? mergeEnts(base.concat({ t: "a", o: s, l: e - s, u: url })) : mergeEnts(base);
    }
    if (covered(ents, t, s, e)) return mergeEnts(subtract(ents, t, s, e));
    return mergeEnts(ents.concat({ t, o: s, l: e - s }));
  }

  // короткая подпись сообщения для списка чатов и ответов
  function preview(m) {
    if (!m) return "";
    const a = m.att || {};
    const cap = String(m.text || "").replace(/\s+/g, " ").trim();
    const kinds = { photo: "Фото", gif: "GIF", voice: "Голосовое сообщение", sticker: (a.em ? a.em + " " : "") + "Стикер", file: a.name || "Файл" };
    const k = m.kind || "text";
    if (k === "text") return cap;
    const base = kinds[k] || "Сообщение";
    return cap && k !== "voice" && k !== "sticker" ? base + ", " + cap : base;
  }

  return { render, read, readRaw, write, offsetOf, posOf, toggle, subtract, mergeEnts, preview };
})();
