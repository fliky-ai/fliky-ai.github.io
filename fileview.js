// fileview.js — свой просмотрщик файлов (без перехода в браузер и без системного окна):
//   текст и код (номера строк, подсветка, перенос строк, размер шрифта, копирование; кодировки UTF-8/16 и Windows-1251),
//   PDF (страницы рисуются в приложении, масштаб кнопками), аудио (свой плеер), картинки и видео (Viewer),
//   остальное — карточка файла со сведениями и кнопкой «Скачать».
const FV = {
  TEXT: new Set(("txt text md markdown rst log csv tsv json jsonl json5 xml yaml yml toml ini cfg conf config env properties gitignore gitattributes editorconfig " +
    "js mjs cjs jsx ts tsx vue svelte html htm xhtml css scss sass less styl " +
    "py pyw ipynb rb php pl pm lua r jl java kt kts scala groovy gradle c h cc cpp cxx hpp hh cs fs go rs swift m mm dart zig " +
    "sh bash zsh fish bat cmd ps1 psm1 sql graphql gql proto tf hcl dockerfile makefile cmake mk " +
    "tex bib srt vtt ass lrc diff patch svg").split(" ")),
  STYLE: {
    c: "js mjs cjs jsx ts tsx java kt kts scala groovy gradle c h cc cpp cxx hpp hh cs go rs swift m mm dart zig php proto vue svelte json5 graphql gql",
    hash: "py pyw rb pl pm r jl sh bash zsh fish yml yaml toml ini cfg conf config env properties gitignore dockerfile makefile mk cmake tf hcl ps1 psm1 editorconfig",
    dash: "sql lua",
    css: "css scss sass less styl",
    markup: "html htm xhtml xml svg",
    json: "json jsonl ipynb",
  },
  KW: new Set(("if else elif for foreach while do return function func fn def lambda class struct enum interface trait impl type namespace package import export from as default " +
    "const let var val mut static final public private protected abstract override virtual new delete this self super try catch except finally throw throws raise switch case break continue " +
    "async await yield typeof instanceof in of is not and or with pass del global nonlocal assert use using mod pub crate where match loop go defer select chan " +
    "true false null nil none None True False undefined void int long short float double char string bool boolean byte " +
    "SELECT FROM WHERE INSERT INTO UPDATE DELETE CREATE TABLE ALTER DROP JOIN LEFT RIGHT INNER OUTER ON GROUP BY ORDER LIMIT VALUES SET AND OR NOT NULL PRIMARY KEY " +
    "select from where insert into update delete create table alter drop join left right inner outer on group by order limit values set primary key").split(" ")),
  _re: {},

  IC: {
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    dl: '<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
    wrap: '<path d="M3 6h18"/><path d="M3 12h14a3 3 0 0 1 0 6h-4"/><path d="m15 15-3 3 3 3"/><path d="M3 18h5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    aa: '<path d="M3 18 8 6l5 12"/><path d="M5 14h6"/><path d="M15 18l3.2-8L21 18"/><path d="M16 15.5h4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
    back: '<path d="M11 5 5 10l6 5"/><path d="M5 10h8a6 6 0 1 1 0 12h-2"/>',
    fwd: '<path d="m13 5 6 5-6 5"/><path d="M19 10h-8a6 6 0 1 0 0 12h2"/>',
    note: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  },
  svg(p, s = 22) { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${FV.IC[p] || p}</svg>`; },

  extOf(a) {
    const n = String((a && a.name) || "").trim(), i = n.lastIndexOf(".");
    return (i >= 0 ? n.slice(i + 1) : n).toLowerCase();
  },
  kind(a) {
    const m = String((a && a.mime) || "").toLowerCase(), e = FV.extOf(a);
    if (/^image\/(heic|heif|tiff?|x-icon)/.test(m) || /^(heic|heif|tiff?)$/.test(e)) return "other";
    if (/^image\//.test(m)) return "image";
    if (/^video\//.test(m)) return "video";
    if (/^audio\//.test(m)) return "audio";
    if (m === "application/pdf" || e === "pdf") return "pdf";
    if (/^text\//.test(m) || /(json|xml|javascript|x-sh|yaml|toml|x-httpd-php|sql)/.test(m) || FV.TEXT.has(e)) return "text";
    return "other";
  },

  // нажатие по файлу в чате, в поиске и в профиле
  open(a) {
    if (!a || !a.url) return;
    const k = FV.kind(a);
    if (k === "image" || k === "video") return Viewer.open(a);
    FV.show(a, k);
  },

  // ───────────── оболочка ─────────────
  shell(a, acts) {
    const el = document.createElement("div");
    el.className = "fv";
    el.innerHTML = `<div class="fv-top"><button class="fv-b fv-x" aria-label="${esc(T("Закрыть"))}">${FV.svg("x", 24)}</button>
      <div class="fv-name"><b>${esc(a.name || T("Файл"))}</b><small>${esc(a.size ? fmtSize(a.size) : "")}</small></div>
      <div class="fv-acts">${(acts || []).map((x) => `<button class="fv-b" data-a="${x[0]}" aria-label="${esc(x[2] || "")}">${FV.svg(x[1], 21)}</button>`).join("")}
      <button class="fv-b" data-a="dl" aria-label="${esc(T("Скачать"))}">${FV.svg("dl", 21)}</button></div></div><div class="fv-body"></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    const ctx = { el, a, dead: false, dispose: [], body: el.querySelector(".fv-body"), sub: el.querySelector(".fv-name small"), on: {} };
    const hide = () => {
      ctx.dead = true;
      ctx.dispose.forEach((f) => { try { f(); } catch (e) {} });
      el.classList.remove("show"); setTimeout(() => el.remove(), 200);
    };
    ctx.close = Nav.layer(hide);
    el.querySelector(".fv-x").onclick = () => ctx.close();
    el.querySelector(".fv-top").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-a]"); if (!b) return;
      haptic();
      if (b.dataset.a === "dl") return Attach.download(a);
      if (ctx.on[b.dataset.a]) ctx.on[b.dataset.a](b);
    });
    return ctx;
  },

  show(a, k) {
    if (k === "text") return FV.textView(a);
    if (k === "pdf") return FV.pdfView(a);
    if (k === "audio") return FV.audioView(a);
    return FV.otherView(FV.shell(a), a);
  },

  loading(ctx, txt) { ctx.body.innerHTML = `<div class="fv-load"><i class="fv-spin"></i><span>${esc(txt || T("Открываю…"))}</span></div>`; },
  fail(ctx, a, msg) { FV.otherView(ctx, a, msg); },

  // карточка файла: значок с расширением, имя, размер, тип, «Скачать»
  otherView(ctx, a, note) {
    const e = FV.extOf(a), ext = (/^[a-z0-9]{1,5}$/.test(e) ? e : "file").toUpperCase();
    let h = 0; for (const c of ext) h = (h * 31 + c.charCodeAt(0)) % 360;
    ctx.body.innerHTML = `<div class="fv-ot"><div class="fv-ic" style="--h:${h}"><b>${esc(ext)}</b></div>
      <h3>${esc(a.name || T("Файл"))}</h3>
      <p>${esc([a.size ? fmtSize(a.size) : "", a.mime || ""].filter(Boolean).join(" · "))}</p>
      <p class="fv-note">${esc(note || T("Этот тип файла нельзя показать внутри приложения"))}</p>
      <button class="fv-dlb" data-a="dl">${FV.svg("dl", 20)}<span>${esc(T("Скачать"))}</span></button></div>`;
    ctx.body.querySelector(".fv-dlb").onclick = () => { haptic(); Attach.download(a); };
  },

  // ───────────── загрузка байтов ─────────────
  async bytes(a, limit, onP) {
    const r = await fetch(fileUrl(a.url));
    if (!r.ok) throw new Error(T("Не удалось загрузить файл"));
    const total = +r.headers.get("content-length") || a.size || 0;
    if (!r.body || !r.body.getReader) {
      const b = new Uint8Array(await r.arrayBuffer());
      return { buf: limit ? b.slice(0, limit) : b, cut: !!limit && b.length > limit };
    }
    const rd = r.body.getReader(), parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      parts.push(value); got += value.length;
      if (onP && total) onP(Math.min(1, got / total));
      if (limit && got >= limit) { try { rd.cancel(); } catch (e) {} break; }
    }
    const n = limit ? Math.min(got, limit) : got, out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { if (o >= n) break; const k = Math.min(p.length, n - o); out.set(p.subarray(0, k), o); o += k; }
    return { buf: out, cut: !!limit && (total || got) > limit };
  },

  // байты → текст; null — если файл бинарный
  decode(buf) {
    let enc = "utf-8", b = buf;
    if (b[0] === 0xff && b[1] === 0xfe) { enc = "utf-16le"; b = b.subarray(2); }
    else if (b[0] === 0xfe && b[1] === 0xff) { enc = "utf-16be"; b = b.subarray(2); }
    else if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
    else {
      let z = 0; const n = Math.min(b.length, 4096);
      for (let i = 0; i < n; i++) if (b[i] === 0) z++;
      if (z > 0) return null;
    }
    let s;
    try { s = new TextDecoder(enc).decode(b); } catch (e) { return null; }
    if (enc === "utf-8") {
      const bad = (s.match(/�/g) || []).length;
      if (bad > 2 && bad > s.length * 0.01) { try { s = new TextDecoder("windows-1251").decode(b); } catch (e) {} }   // русские файлы из Windows
    }
    return s.replace(/\r\n?/g, "\n");
  },

  // ───────────── текст и код ─────────────
  styleOf(e) { for (const k in FV.STYLE) if (FV.STYLE[k].split(" ").includes(e)) return k; return ""; },
  regex(style) {
    if (FV._re[style]) return FV._re[style];
    const com = { c: String.raw`\/\*[\s\S]*?\*\/|\/\/[^\n]*`, hash: String.raw`#[^\n]*`, dash: String.raw`--[^\n]*|\/\*[\s\S]*?\*\/`, css: String.raw`\/\*[\s\S]*?\*\/`, markup: String.raw`<!--[\s\S]*?-->`, json: "(?!)" }[style];
    const str = String.raw`"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|` + "`(?:\\\\.|[^`\\\\])*`";
    const num = String.raw`\b(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b`;
    const word = style === "markup" ? String.raw`<\/?[A-Za-z][\w:-]*` : String.raw`\b[A-Za-z_][A-Za-z0-9_]*\b`;
    return (FV._re[style] = new RegExp(`(${com})|(${str})|(${num})|(${word})`, "g"));
  },
  // подсветка: список строк в виде готового HTML
  lines(text, style) {
    const out = [""];
    const add = (cls, s) => {
      const p = s.split("\n");
      for (let i = 0; i < p.length; i++) {
        if (i) out.push("");
        if (p[i]) out[out.length - 1] += cls ? `<span class="${cls}">${esc(p[i])}</span>` : esc(p[i]);
      }
    };
    const fin = () => { if (out.length > 1 && out[out.length - 1] === "") out.pop(); return out; };   // последний перевод строки не даёт лишней пустой строки
    if (!style || text.length > 300000) { add("", text); return fin(); }
    const re = FV.regex(style);
    re.lastIndex = 0;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) add("", text.slice(last, m.index));
      const t = m[0];
      const cls = m[1] ? "c" : m[2] ? "s" : m[3] ? "n" : style === "markup" ? "k" : FV.KW.has(t) ? "k" : "";
      add(cls, t); last = re.lastIndex;
      if (!t.length) re.lastIndex++;
    }
    if (last < text.length) add("", text.slice(last));
    return fin();
  },

  async textView(a) {
    const ctx = FV.shell(a, [["wrap", "wrap", T("Перенос строк")], ["fs", "aa", T("Размер текста")], ["copy", "copy", T("Копировать")]]);
    FV.loading(ctx);
    const LIMIT = 8 * 1048576;                                   // до 8 МБ текста: показ «окнами», поэтому не тормозит и не вылетает
    let r;
    try { r = await FV.bytes(a, LIMIT, (p) => { if (!ctx.dead) { const s = ctx.body.querySelector(".fv-load span"); if (s) s.textContent = T("Загрузка {0}%", Math.round(p * 100)); } }); }
    catch (e) { return FV.fail(ctx, a, e.message); }
    if (ctx.dead) return;
    const text = FV.decode(r.buf);
    r = null;
    if (text === null) return FV.fail(ctx, a, T("Это не текстовый файл"));
    let src = text, e = FV.extOf(a);
    if (/^(json)$/.test(e) && src.length < 500000 && !/\n/.test(src.trim())) { try { src = JSON.stringify(JSON.parse(src), null, 2); } catch (er) {} }   // «сжатый» JSON — красиво по строкам
    const style = FV.styleOf(e), hl = !!style && src.length <= 300000;
    // строки: при подсветке — готовый HTML, иначе — сырой текст (экранируем при показе);
    // очень длинная строка (минифицированный файл) режется на куски по 4000 символов, номер — только у первого куска
    const L = [], N = [];
    const src0 = hl ? FV.lines(src, style) : src.split("\n");
    if (!hl && src0.length > 1 && src0[src0.length - 1] === "") src0.pop();
    for (let i = 0; i < src0.length; i++) {
      const ln = src0[i];
      if (!hl && ln.length > 4000) { for (let k = 0; k < ln.length; k += 4000) { L.push(ln.slice(k, k + 4000)); N.push(k ? 0 : i + 1); } }
      else { L.push(ln); N.push(i + 1); }
    }
    const nl = src0.length;
    ctx.sub.textContent = nl + " " + plural(nl, T("строка"), T("строки"), T("строк")) + (a.size ? " · " + fmtSize(a.size) : "") + (a.size > LIMIT ? " · " + T("показаны первые {0}", fmtSize(LIMIT)) : "");
    let fs = 13, wrap = true;
    try { fs = +localStorage.getItem("fv_fs") || 13; wrap = localStorage.getItem("fv_wrap") !== "0"; } catch (er) {}
    ctx.body.innerHTML = `<div class="fv-code"><div class="fv-in"></div></div>`;
    const box = ctx.body.querySelector(".fv-code"), inn = box.querySelector(".fv-in");
    const B = 150, nb = Math.ceil(L.length / B);                    // блоки по 150 строк; на экране живут только ближние
    const H = new Array(nb).fill(0);                                 // измеренная высота блока (0 — ещё не мерили)
    let lh = 20;
    const line = (i) => `<div class="fv-l${N[i] ? "" : " ct"}"${N[i] ? ` data-n="${N[i]}"` : ""}>${hl ? L[i] : esc(L[i])}</div>`;
    const est = (b) => { const n = Math.min(L.length, (b + 1) * B) - b * B; return Math.max(n * lh, 1); };
    const fill = (el) => {
      const b = +el.dataset.b, from = b * B, to = Math.min(L.length, from + B);
      let h = ""; for (let i = from; i < to; i++) h += line(i);
      el.innerHTML = h; el.style.height = ""; el._on = true;
      H[b] = el.offsetHeight || H[b];
    };
    const empty = (el) => { if (!el._on) return; const b = +el.dataset.b; H[b] = el.offsetHeight || H[b]; el.style.height = (H[b] || est(b)) + "px"; el.innerHTML = ""; el._on = false; };
    let io = null;
    const build = () => {
      if (io) io.disconnect();
      const probe = document.createElement("div"); probe.className = "fv-l"; probe.textContent = "0"; inn.innerHTML = ""; inn.appendChild(probe);
      lh = probe.offsetHeight || Math.round(fs * 1.55); probe.remove();
      H.fill(0);
      let h = ""; for (let b = 0; b < nb; b++) h += `<div class="fv-blk" data-b="${b}" style="height:${est(b)}px"></div>`;
      inn.innerHTML = h;
      const blks = [...inn.children];
      io = new IntersectionObserver((es) => es.forEach((en) => { if (ctx.dead) return; if (en.isIntersecting) fill(en.target); else empty(en.target); }), { root: box, rootMargin: "200% 0px" });
      blks.forEach((x) => io.observe(x));
    };
    const apply = (rebuild) => {
      box.classList.toggle("nowrap", !wrap);
      box.style.setProperty("--fs", fs + "px");
      box.style.setProperty("--g", String(nl).length * 0.62 + 1.9 + "em");
      try { localStorage.setItem("fv_fs", fs); localStorage.setItem("fv_wrap", wrap ? "1" : "0"); } catch (er) {}
      if (rebuild) { const k = box.scrollHeight ? box.scrollTop / box.scrollHeight : 0; build(); requestAnimationFrame(() => { box.scrollTop = k * box.scrollHeight; }); }
    };
    apply(false);
    build();
    ctx.dispose.push(() => { if (io) io.disconnect(); L.length = 0; });
    ctx.on.wrap = () => { wrap = !wrap; apply(true); toast(wrap ? T("Перенос строк включён") : T("Перенос строк выключен")); };
    ctx.on.fs = () => { fs = fs >= 19 ? 11 : fs + 2; apply(true); };
    ctx.on.copy = () => { copyText(src); toast(T("Скопировано")); };
    ctx.text = { lines: L.length, blocks: nb };
  },

  // ───────────── PDF ─────────────
  pdfLib() {
    if (!FV._pdf) {
      FV._pdf = import("./pdf.min.mjs?v=" + APP_VER).then((m) => {
        m.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.min.mjs?v=" + APP_VER, document.baseURI).href;
        return m;
      }).catch((e) => { FV._pdf = null; throw e; });
    }
    return FV._pdf;
  },
  async pdfView(a) {
    const ctx = FV.shell(a, [["zo", "minus", T("Уменьшить")], ["zi", "plus", T("Увеличить")]]);
    FV.loading(ctx);
    let lib, buf, doc;
    try { lib = await FV.pdfLib(); } catch (e) { return FV.fail(ctx, a, T("Не удалось запустить просмотр PDF")); }
    try { buf = (await FV.bytes(a, 0, (p) => { if (!ctx.dead) ctx.body.querySelector(".fv-load span").textContent = T("Загрузка {0}%", Math.round(p * 100)); })).buf; }
    catch (e) { return FV.fail(ctx, a, e.message); }
    if (ctx.dead) return;
    try { doc = await lib.getDocument({ data: buf }).promise; } catch (e) { return FV.fail(ctx, a, T("Не удалось открыть PDF (файл повреждён или защищён паролем)")); }
    if (ctx.dead) { try { doc.destroy(); } catch (e) {} return; }
    ctx.dispose.push(() => { try { doc.destroy(); } catch (e) {} });
    const N = doc.numPages;
    ctx.body.innerHTML = `<div class="fv-pdf"><div class="fv-pgs"></div></div>`;
    const sc = ctx.body.querySelector(".fv-pdf"), wrap = sc.querySelector(".fv-pgs");
    const first = await doc.getPage(1), v0 = first.getViewport({ scale: 1 });
    let z = 1;
    const ZS = [0.75, 1, 1.5, 2, 3];
    const width = () => Math.max(120, (sc.clientWidth - 16) * z);
    wrap.innerHTML = Array.from({ length: N }, (_, i) => `<div class="fv-pg" data-n="${i + 1}" style="aspect-ratio:${v0.width} / ${v0.height}"></div>`).join("");
    const pages = [...wrap.children];
    const sizeAll = () => { const w = width() + "px"; pages.forEach((p) => { p.style.width = w; }); };
    sizeAll();
    const render = async (pg) => {
      if (pg._busy || pg._done) return;
      pg._busy = true;
      try {
        const page = await doc.getPage(+pg.dataset.n);
        if (ctx.dead) return;
        const v1 = page.getViewport({ scale: 1 });
        pg.style.aspectRatio = v1.width + " / " + v1.height;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const vp = page.getViewport({ scale: (pg.clientWidth / v1.width) * dpr });
        const c = document.createElement("canvas");
        c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
        await page.render({ canvas: c, canvasContext: c.getContext("2d"), viewport: vp }).promise;
        if (ctx.dead) return;
        pg.innerHTML = ""; pg.appendChild(c); pg._done = true;
      } catch (e) { /* страница не нарисовалась — остаётся пустой */ }
      pg._busy = false;
    };
    const drop = (pg) => { if (pg._done) { pg.innerHTML = ""; pg._done = false; } };
    const io = new IntersectionObserver((es) => { es.forEach((en) => { if (en.isIntersecting) render(en.target); else drop(en.target); }); }, { root: sc, rootMargin: "120% 0px" });
    pages.forEach((p) => io.observe(p));
    ctx.dispose.push(() => io.disconnect());
    const cur = () => {
      const mid = sc.scrollTop + sc.clientHeight / 3;
      let n = 1;
      for (let i = 0; i < pages.length; i++) { if (pages[i].offsetTop <= mid) n = i + 1; else break; }
      ctx.sub.textContent = T("Страница {0} из {1}", n, N) + (a.size ? " · " + fmtSize(a.size) : "");
    };
    cur();
    let raf = 0;
    sc.addEventListener("scroll", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(cur); }, { passive: true });
    const zoom = (d) => {
      const i = Math.max(0, Math.min(ZS.length - 1, ZS.indexOf(z) + d));
      if (ZS[i] === z) return;
      const k = ZS[i] / z, mid = sc.scrollTop + sc.clientHeight / 2;
      z = ZS[i];
      sizeAll();
      pages.forEach((p) => { p.innerHTML = ""; p._done = false; });
      sc.scrollTop = mid * k - sc.clientHeight / 2;
      io.disconnect(); pages.forEach((p) => io.observe(p));
      cur();
    };
    ctx.on.zi = () => zoom(1);
    ctx.on.zo = () => zoom(-1);
    ctx.pdf = { doc, pages, zoom };
  },

  // ───────────── аудио: большой плеер общего музыкального плеера (music.js) ─────────────
  audioView(a) {
    const ctx = FV.shell(a);
    if (typeof Music !== "undefined") return Music.mountView(ctx, a);
    FV.otherView(ctx, a);
  },
};
