// gifmaker.js — «Создать GIF»: из видео (отрезок до 8 секунд) или из нескольких фото. Кодировщик GIF89a написан здесь же:
// общая палитра (медианное сечение), сжатие LZW, зацикливание. Никаких внешних библиотек и серверов.

const GifEnc = (() => {
  // палитра из выборки пикселей: гистограмма по 15 битам цвета и медианное сечение
  function palette(samples, max = 256) {
    const hist = new Uint32Array(32768);
    for (const px of samples) for (let i = 0; i < px.length; i += 4) hist[((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3)]++;
    const cols = [];
    for (let k = 0; k < 32768; k++) if (hist[k]) cols.push(k);
    const rgb = (k) => [(k >> 10) & 31, (k >> 5) & 31, k & 31];
    let boxes = [{ c: cols }];
    const info = (b) => {
      let lo = [31, 31, 31], hi = [0, 0, 0], n = 0;
      for (const k of b.c) { const c = rgb(k); n += hist[k]; for (let j = 0; j < 3; j++) { if (c[j] < lo[j]) lo[j] = c[j]; if (c[j] > hi[j]) hi[j] = c[j]; } }
      const r = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], ax = r[0] >= r[1] && r[0] >= r[2] ? 0 : r[1] >= r[2] ? 1 : 2;
      b.n = n; b.ax = ax; b.range = r[ax]; return b;
    };
    boxes = [info(boxes[0])];
    while (boxes.length < max) {
      let bi = -1, best = 0;
      boxes.forEach((b, i) => { const sc = b.range * Math.sqrt(b.n); if (b.c.length > 1 && sc > best) { best = sc; bi = i; } });
      if (bi < 0) break;
      const b = boxes[bi], ax = b.ax;
      const sh = ax === 0 ? 10 : ax === 1 ? 5 : 0;
      b.c.sort((x, y) => ((x >> sh) & 31) - ((y >> sh) & 31));
      let acc = 0, cut = 1;
      for (let i = 0; i < b.c.length; i++) { acc += hist[b.c[i]]; if (acc >= b.n / 2) { cut = Math.min(Math.max(i + 1, 1), b.c.length - 1); break; } }
      const A = { c: b.c.slice(0, cut) }, B = { c: b.c.slice(cut) };
      boxes.splice(bi, 1, info(A), info(B));
    }
    const pal = new Uint8Array(768);
    boxes.forEach((b, i) => {
      let r = 0, g = 0, bl = 0, n = 0;
      for (const k of b.c) { const w = hist[k], c = rgb(k); r += c[0] * w; g += c[1] * w; bl += c[2] * w; n += w; }
      n = n || 1;
      pal[i * 3] = Math.min(255, Math.round((r / n) * 8 + 4)); pal[i * 3 + 1] = Math.min(255, Math.round((g / n) * 8 + 4)); pal[i * 3 + 2] = Math.min(255, Math.round((bl / n) * 8 + 4));
    });
    return { pal, size: boxes.length };
  }

  function indexer(p) {
    const cache = new Int16Array(32768).fill(-1);
    const n = p.size, pal = p.pal;
    return (r, g, b) => {
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      let v = cache[key];
      if (v < 0) {
        const R = (r & 0xf8) + 4, G = (g & 0xf8) + 4, B = (b & 0xf8) + 4;
        let best = 1e9; v = 0;
        for (let i = 0; i < n; i++) { const dr = pal[i * 3] - R, dg = pal[i * 3 + 1] - G, db = pal[i * 3 + 2] - B, d = dr * dr * 2 + dg * dg * 4 + db * db * 3; if (d < best) { best = d; v = i; if (!d) break; } }
        cache[key] = v;
      }
      return v;
    };
  }

  // LZW со сменной длиной кода (как в GIF89a)
  function lzw(px, out) {
    const MIN = 8, CLEAR = 256, EOI = 257;
    let size = MIN + 1, next = EOI + 1, cur = 0, shift = 0;
    const HS = 8192, keys = new Int32Array(HS).fill(-1), vals = new Uint16Array(HS);
    const buf = [];                         // блоки по 255 байт
    let blk = new Uint8Array(255), bl = 0;
    const put = (b) => { blk[bl++] = b; if (bl === 255) { buf.push(255, blk); blk = new Uint8Array(255); bl = 0; } };
    const emit = (code) => { cur |= code << shift; shift += size; while (shift >= 8) { put(cur & 255); cur >>= 8; shift -= 8; } };
    const find = (key) => { let h = (Math.imul(key, 2654435761) >>> 19) & (HS - 1); while (keys[h] !== -1) { if (keys[h] === key) return vals[h]; h = (h + 1) & (HS - 1); } return -1; };
    const add = (key, v) => { let h = (Math.imul(key, 2654435761) >>> 19) & (HS - 1); while (keys[h] !== -1) h = (h + 1) & (HS - 1); keys[h] = key; vals[h] = v; };
    emit(CLEAR);
    let pre = px[0];
    for (let i = 1; i < px.length; i++) {
      const k = px[i], key = (pre << 8) | k, f = find(key);
      if (f >= 0) { pre = f; continue; }
      emit(pre);
      if (next === 4096) { emit(CLEAR); keys.fill(-1); next = EOI + 1; size = MIN + 1; }
      else { if (next >= (1 << size)) size++; add(key, next++); }
      pre = k;
    }
    emit(pre); emit(EOI);
    if (shift > 0) put(cur & 255);
    const parts = [new Uint8Array([MIN])];
    for (let i = 0; i < buf.length; i += 2) { parts.push(new Uint8Array([255]), buf[i + 1]); }
    if (bl) { parts.push(new Uint8Array([bl]), blk.slice(0, bl)); }
    parts.push(new Uint8Array([0]));
    out.push(...parts);
  }

  // frames: [{data: Uint8ClampedArray (RGBA), delay: сотые секунды}]
  async function encode(frames, w, h, onProgress) {
    const step = Math.max(1, Math.floor(frames.length / 12)), samples = [];
    for (let i = 0; i < frames.length; i += step) {
      const d = frames[i].data, sub = new Uint8ClampedArray(Math.ceil(d.length / 16 / 4) * 4);
      for (let j = 0, o = 0; j < d.length; j += 16, o += 4) { sub[o] = d[j]; sub[o + 1] = d[j + 1]; sub[o + 2] = d[j + 2]; }
      samples.push(sub);
    }
    const pal = palette(samples), idx = indexer(pal);
    const out = [];
    out.push(new Uint8Array([71, 73, 70, 56, 57, 97, w & 255, w >> 8, h & 255, h >> 8, 0xF7, 0, 0]));
    out.push(pal.pal);
    out.push(new Uint8Array([0x21, 0xFF, 11, 78, 69, 84, 83, 67, 65, 80, 69, 50, 46, 48, 3, 1, 0, 0, 0]));
    const px = new Uint8Array(w * h);
    for (let f = 0; f < frames.length; f++) {
      const d = frames[f].data, dl = Math.max(2, frames[f].delay | 0);
      for (let i = 0, j = 0; i < px.length; i++, j += 4) px[i] = idx(d[j], d[j + 1], d[j + 2]);
      out.push(new Uint8Array([0x21, 0xF9, 4, 0x04, dl & 255, dl >> 8, 0, 0]));
      out.push(new Uint8Array([0x2C, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0]));
      lzw(px, out);
      if (onProgress) onProgress((f + 1) / frames.length);
      if (f % 2) await new Promise((r) => setTimeout(r, 0));      // не замораживаем экран
    }
    out.push(new Uint8Array([0x3B]));
    return new Blob(out, { type: "image/gif" });
  }
  return { encode };
})();

const GifMaker = {
  el: null, mode: "video", vid: null, imgs: [], dur: 3, start: 0, size: 320, fps: 10, text: "", busy: false,

  async start() {
    const files = await Attach.pick("video/*,image/*", true);
    if (!files || !files.length) return;
    const vids = files.filter((f) => /^video\//.test(f.type)), imgs = files.filter((f) => /^image\//.test(f.type));
    GifMaker.imgs = []; GifMaker.vid = null;
    try {
      if (vids.length) {
        GifMaker.mode = "video";
        const v = document.createElement("video");
        v.muted = true; v.playsInline = true; v.preload = "auto"; v.setAttribute("playsinline", ""); v.src = URL.createObjectURL(vids[0]);
        await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error("video")); setTimeout(() => j(new Error("timeout")), 15000); });
        GifMaker.vid = v;
        GifMaker.start0 = 0; GifMaker.start = 0; GifMaker.dur = Math.min(3, v.duration || 3);
      } else {
        GifMaker.mode = "photos";
        for (const f of imgs.slice(0, 12)) {
          const url = URL.createObjectURL(f);
          GifMaker.imgs.push(await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = url; }));
        }
        GifMaker.dur = 0.7;         // секунд на кадр
      }
    } catch (e) { return toast(T("Не удалось открыть файл")); }
    GifMaker.size = 320; GifMaker.fps = 10; GifMaker.text = "";
    GifMaker.open();
  },

  open() {
    const g = GifMaker, vid = g.mode === "video", total = vid ? g.vid.duration || 3 : 0;
    const el = (g.el = document.createElement("div"));
    el.className = "maker gifmk";
    const chips = (id, arr, cur, fmt) => `<div class="seg gm-seg" data-id="${id}">${arr.map((v) => `<button data-v="${v}" class="${v === cur ? "on" : ""}">${fmt(v)}</button>`).join("")}</div>`;
    el.innerHTML = `<div class="mk-top"><button class="mk-x" aria-label="${T("Закрыть")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button><b>${T("Новый GIF")}</b><span style="width:44px"></span></div>
      <div class="gm-stage"><canvas class="gm-cv"></canvas></div>
      <div class="gm-ctl">
        ${vid ? `<div class="gm-l">${T("Начало")}<span class="gm-v" id="gm-sv"></span></div><input type="range" id="gm-start" min="0" max="${Math.max(0, total - 0.5).toFixed(2)}" step="0.1" value="0">
        <div class="gm-l">${T("Длина")}</div>${chips("dur", [2, 3, 5, 8].filter((x) => x <= Math.max(2, Math.ceil(total))), g.dur > 2 && g.dur <= 3 ? 3 : 2, (v) => v + " " + T("с"))}`
      : `<div class="gm-l">${T("Скорость")}</div>${chips("dur", [0.3, 0.7, 1.2], 0.7, (v) => (v < 0.5 ? T("Быстро") : v < 1 ? T("Средне") : T("Медленно")))}`}
        <div class="gm-l">${T("Размер")}</div>${chips("size", [240, 320, 480], 320, (v) => (v === 240 ? T("Малый") : v === 320 ? T("Средний") : T("Большой")))}
        <input id="gm-text" class="s2-input" maxlength="40" placeholder="${T("Подпись на GIF (необязательно)")}" autocomplete="off">
      </div>
      <div class="gm-btns"><button class="pbtn gm-b2" id="gm-save">${T("Сохранить")}</button><button class="pbtn" id="gm-send">${T("Отправить")}</button></div>
      <div class="gm-prog" hidden><div class="gm-bar"><i></i></div><span></span></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    g.release = Nav.layer(() => g.hide());
    g.cv = el.querySelector(".gm-cv");
    el.querySelector(".mk-x").onclick = () => g.close();
    const chipBind = (id, fn) => { const box = el.querySelector(`[data-id="${id}"]`); box.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; box.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); fn(+b.dataset.v); }; };
    chipBind("dur", (v) => { g.dur = v; g.preview(); });
    chipBind("size", (v) => { g.size = v; g.preview(); });
    if (vid) {
      g.dur = Math.min(3, total) <= 2 ? 2 : 3;
      el.querySelector("#gm-start").oninput = (e) => { g.start = +e.target.value; el.querySelector("#gm-sv").textContent = g.start.toFixed(1) + " " + T("с"); g.preview(); };
      el.querySelector("#gm-sv").textContent = "0.0 " + T("с");
    }
    el.querySelector("#gm-text").oninput = (e) => { g.text = e.target.value; g.drawCaption(); };
    el.querySelector("#gm-save").onclick = () => g.make(false);
    el.querySelector("#gm-send").onclick = () => g.make(true);
    g.preview();
  },

  dims() {
    const g = GifMaker, src = g.mode === "video" ? { w: g.vid.videoWidth, h: g.vid.videoHeight } : { w: g.imgs[0].width, h: g.imgs[0].height };
    const k = Math.min(1, g.size / Math.max(src.w, src.h));
    return { w: Math.max(16, Math.round((src.w * k) / 2) * 2), h: Math.max(16, Math.round((src.h * k) / 2) * 2) };
  },
  drawCaption() {
    const g = GifMaker; if (g.mode !== "video" && g.cv) { const { w, h } = g.dims(), c = g.cv.getContext("2d"); g.fit(c, g.imgs[(g.shown || 0) % g.imgs.length], w, h); g.textOver(c, w, h); }
  },
  // предпросмотр: зацикленное воспроизведение выбранного отрезка / листание фото
  preview() {
    const g = GifMaker; cancelAnimationFrame(g.raf); clearInterval(g.iv);
    const { w, h } = g.dims(), cv = g.cv, c = cv.getContext("2d");
    cv.width = w; cv.height = h; g.drawCaption();
    if (g.mode === "video") {
      const v = g.vid; v.currentTime = g.start; v.loop = false;
      v.play().catch(() => {});
      const tick = () => {
        if (!g.el) return;
        if (v.currentTime >= g.start + g.dur - 0.05 || v.ended) v.currentTime = g.start;
        c.drawImage(v, 0, 0, w, h); g.textOver(c, w, h); g.raf = requestAnimationFrame(tick);
      };
      g.raf = requestAnimationFrame(tick);
    } else {
      let i = 0;
      const show = () => { g.shown = i; g.fit(c, g.imgs[i % g.imgs.length], w, h); g.textOver(c, w, h); i++; };
      show(); g.iv = setInterval(show, g.dur * 1000);
    }
  },
  fit(c, img, w, h) {
    c.fillStyle = "#000"; c.fillRect(0, 0, w, h);
    const k = Math.max(w / img.width, h / img.height), iw = img.width * k, ih = img.height * k;
    c.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
  },
  textOver(c, w, h) {
    const t = GifMaker.text.trim(); if (!t) return;
    c.save(); c.textAlign = "center"; c.lineJoin = "round";
    const fs = Math.round(w / (t.length > 18 ? 11 : 8.5));
    c.font = `800 ${fs}px Manrope, Arial, sans-serif`; c.lineWidth = Math.max(3, fs / 5); c.strokeStyle = "#1b1b27"; c.strokeText(t, w / 2, h - fs * 0.6, w - 16); c.fillStyle = "#fff"; c.fillText(t, w / 2, h - fs * 0.6, w - 16);
    c.restore();
  },

  async make(send) {
    const g = GifMaker; if (g.busy) return; g.busy = true;
    cancelAnimationFrame(g.raf); clearInterval(g.iv);
    const el = g.el, prog = el.querySelector(".gm-prog"), bar = prog.querySelector("i"), lab = prog.querySelector("span");
    el.querySelectorAll("button,input").forEach((b) => (b.disabled = true));
    prog.hidden = false;
    const setP = (p, t) => { bar.style.width = Math.round(p * 100) + "%"; lab.textContent = t; };
    try {
      const { w, h } = g.dims(), cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const c = cv.getContext("2d", { willReadFrequently: true }), frames = [];
      if (g.mode === "video") {
        const v = g.vid; v.pause();
        const n = Math.max(2, Math.round(g.dur * g.fps)), dt = g.dur / n;
        for (let i = 0; i < n; i++) {
          const t = Math.min(g.start + i * dt, (v.duration || 1) - 0.05);
          await new Promise((r) => { const done = () => { v.removeEventListener("seeked", done); r(); }; v.addEventListener("seeked", done); v.currentTime = t; setTimeout(done, 1500); });
          c.drawImage(v, 0, 0, w, h); GifMaker.textOver(c, w, h);
          frames.push({ data: c.getImageData(0, 0, w, h).data, delay: Math.round(100 / g.fps) });
          setP((i + 1) / n * 0.45, T("Кадры…"));
        }
      } else {
        g.imgs.forEach((img, i) => { g.fit(c, img, w, h); g.textOver(c, w, h); frames.push({ data: c.getImageData(0, 0, w, h).data, delay: Math.round(g.dur * 100) }); });
        if (frames.length === 1) frames.push({ data: frames[0].data, delay: frames[0].delay });
        setP(0.45, T("Кадры…"));
      }
      const blob = await GifEnc.encode(frames, w, h, (p) => setP(0.45 + p * 0.4, T("Сжимаю…")));
      if (blob.size > 12 * 1048576) throw new Error(T("GIF получился больше 12 МБ — выберите меньший размер или длину"));
      setP(0.88, T("Загружаю…"));
      const fid = await Up.upload(blob, { name: "dicegram.gif", mime: "image/gif" });
      const d = await api("/api/stickers", { method: "POST", body: { fid, kind: "gif", w, h } });
      Panel.mine.gifs.unshift(d.item);
      Panel.tab = "gif";
      if (Panel.open) Panel.render();
      g.close();
      if (send) await Chat.sendGif({ fid, w, h, url: d.item.url, mime: "image/gif" });
      else toast(T("GIF создан и сохранён"));
    } catch (e) {
      toast(e.message || T("Не удалось создать GIF"));
      g.busy = false; prog.hidden = true;
      el.querySelectorAll("button,input").forEach((b) => (b.disabled = false));
      g.preview();
    }
  },

  close() { if (GifMaker.release) GifMaker.release(); else GifMaker.hide(); },
  hide() {
    const g = GifMaker, el = g.el; if (!el) return;
    cancelAnimationFrame(g.raf); clearInterval(g.iv);
    g.release = null; g.busy = false;
    try { if (g.vid) { g.vid.pause(); URL.revokeObjectURL(g.vid.src); } } catch (e) {}
    g.vid = null; g.imgs = [];
    el.classList.remove("show"); setTimeout(() => el.remove(), 200); g.el = null;
  },
};
