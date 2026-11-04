// attach.js — загрузка файлов кусками (оригинал без пересжатия), меню вложений, превью с подписью, просмотр фото.
const fmtSize = (n) => (n < 1024 ? n + " " + T("Б") : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + " " + T("КБ") : (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " " + T("МБ"));
const fileUrl = (u) => (u ? (/^(blob:|data:|https?:)/.test(u) ? u : CONFIG.API + u) : "");

const Up = {
  cap: 4194304,                    // предел размера куска (опускается, если сервер или прокси отвечают 413)
  // Загрузка кусками (старт 1 МБ, дальше размер подстраивается под скорость, до 4 МБ): есть прогресс и докачка.
  // opts: {fid (докачка), onProgress(0..1), ctl ({aborted, abort()})}. Возвращает fid.
  async upload(file, opts = {}) {
    const ctl = opts.ctl || {};
    ctl.abort = () => { ctl.aborted = true; if (ctl.xhr) try { ctl.xhr.abort(); } catch (e) {} };
    let fid = opts.fid, CH = 1048576, off = 0;
    const MIN = 262144;
    if (fid) {
      const s = await api("/api/upload/" + fid);
      if (s.done) return fid;
      off = s.got;
    } else {
      const d = await api("/api/upload/init", { method: "POST", body: { name: opts.name || file.name || "file", size: file.size, mime: opts.mime || file.type } });
      fid = d.fid; CH = Math.min(d.chunk || CH, Up.cap);
      if (opts.onFid) opts.onFid(fid);
    }
    // Размер куска подстраивается под связь: быстрый кусок (меньше ~1,2 с) — следующий вдвое больше, сбой — вдвое меньше.
    while (off < file.size) {
      if (ctl.aborted) throw Object.assign(new Error("Отменено"), { aborted: true });
      let tries = 0;
      for (;;) {
        const end = Math.min(file.size, off + CH), base = off, t0 = Date.now();
        try {
          const r = await Up.chunk(fid, base, file.slice(base, end), ctl, (l) => opts.onProgress && opts.onProgress((base + l) / file.size));
          off = r.got;
          if (end - base === CH && Date.now() - t0 < 1200) CH = Math.min(Up.cap, CH * 2);
          else if (Date.now() - t0 > 6000) CH = Math.max(MIN, CH >> 1);
          break;
        } catch (e) {
          if (e.aborted) throw e;
          if (e.got !== undefined) { off = e.got; break; }      // сервер уже принял больше/меньше — продолжаем с его позиции
          if (++tries > 5) throw e;
          if (e.status === 413) Up.cap = Math.max(MIN, Math.min(Up.cap, (end - base) >> 1));   // сервер или прокси не берёт такие большие куски — запоминаем предел
          CH = Math.max(MIN, Math.min(CH >> 1, Up.cap));         // сбой — пробуем меньшим куском
          await sleep(400 * tries);
        }
      }
    }
    if (opts.onProgress) opts.onProgress(1);
    return fid;
  },

  chunk(fid, off, blob, ctl, onLoaded) {
    return new Promise((res, rej) => {
      const x = new XMLHttpRequest();
      x.open("POST", CONFIG.API + "/api/upload/" + fid + "?off=" + off);
      x.setRequestHeader("Content-Type", "application/octet-stream");
      if (Store.token) x.setRequestHeader("Authorization", "Bearer " + Store.token);
      if (INIT) x.setRequestHeader("X-Init-Data", INIT);
      x.upload.onprogress = (e) => { if (e.lengthComputable) onLoaded(e.loaded); };
      x.onload = () => {
        let d = {};
        try { d = JSON.parse(x.responseText); } catch (e) {}
        if (x.status === 401 && Store.token) { Accounts.remove(Store.token); Store.token = ""; location.reload(); }
        if (x.status === 200 && d.ok) return res(d);
        const er = new Error(d.error || "Ошибка " + x.status);
        er.status = x.status;
        if (x.status === 409 && d.got !== undefined) er.got = d.got;
        rej(er);
      };
      x.onerror = () => rej(new Error("Нет связи с сервером"));
      x.ontimeout = x.onerror;
      x.onabort = () => rej(Object.assign(new Error("Отменено"), { aborted: true }));
      ctl.xhr = x;
      x.send(blob);
    });
  },

  // миниатюра для ленты (оригинал уходит отдельно и не меняется). null — если картинку не удалось прочитать.
  async thumb(file, max = 1280) {
    if (!/^image\//.test(file.type) || /svg/.test(file.type)) return null;
    try {
      let src, w, h, done = () => {};
      if (window.createImageBitmap) {
        src = await createImageBitmap(file); w = src.width; h = src.height; done = () => src.close && src.close();
      } else {
        const url = URL.createObjectURL(file);
        src = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = url; });
        w = src.naturalWidth; h = src.naturalHeight; done = () => URL.revokeObjectURL(url);
      }
      const k = Math.min(1, max / Math.max(w, h)), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
      const c = document.createElement("canvas");
      c.width = cw; c.height = ch;
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, cw, ch);
      g.imageSmoothingQuality = "high";
      g.drawImage(src, 0, 0, cw, ch);
      done();
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
      return blob ? { blob, w, h } : { blob: null, w, h };
    } catch (e) { return null; }
  },
};

const Attach = {
  // выбор файлов через скрытый input (системный выбор файлов нельзя заменить, но всё остальное — наше)
  pick(accept, multiple = true) {
    return new Promise((res) => {
      const i = document.createElement("input");
      i.type = "file"; i.multiple = multiple; if (accept) i.accept = accept;
      i.style.display = "none";
      document.body.appendChild(i);
      i.onchange = () => { const f = Array.from(i.files || []); i.remove(); res(f); };
      i.addEventListener("cancel", () => { i.remove(); res([]); });
      i.click();
    });
  },

  menu() {
    const el = document.createElement("div");
    el.className = "sheet2";
    const ic = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    el.innerHTML = `<div class="s2-card" role="dialog"><div class="tiles">
      <button data-a="media" class="tile t-blue">${ic('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/>')}<span>Фото и видео</span></button>
      <button data-a="file" class="tile t-teal">${ic('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>')}<span>Файл</span></button>
      <button data-a="cam" class="tile t-pink">${ic('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>')}<span>Камера</span></button></div>
      <div class="s2-btns"><button data-a="x" class="s2-cancel">Отмена</button></div></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    const close = () => { el.classList.remove("show"); setTimeout(() => el.remove(), 200); };
    el.addEventListener("click", async (e) => {
      if (e.target === el) return close();
      const b = e.target.closest("button[data-a]");
      if (!b) return;
      const a = b.dataset.a;
      close();
      if (a === "media") Attach.preview(await Attach.pick("image/*,video/*"));
      else if (a === "file") Attach.preview(await Attach.pick(""));
      else if (a === "cam") Camera.open();
    });
  },

  // превью перед отправкой: оригинал уходит как есть, подпись — по желанию
  preview(files, opts = {}) {
    files = (files || []).filter((f) => f && f.size > 0);
    if (!files.length) return;
    const big = files.find((f) => f.size > Attach.max);
    if (big) return toast(T("«{0}» больше {1} МБ", big.name, Math.round(Attach.max / 1048576)));
    const urls = [];
    const el = document.createElement("div");
    el.className = "sheet2 pv";
    const items = files.map((f) => {
      const img = /^image\//.test(f.type) && !/svg/.test(f.type);
      if (img) { const u = URL.createObjectURL(f); urls.push(u); return `<div class="pv-i"><img src="${u}" alt=""></div>`; }
      return `<div class="pv-i file"><div class="fic">${esc((f.name.split(".").pop() || "file").slice(0, 4).toUpperCase())}</div><b>${esc(f.name)}</b><small>${fmtSize(f.size)}</small></div>`;
    }).join("");
    const total = files.reduce((s, f) => s + f.size, 0);
    el.innerHTML = `<div class="s2-card" role="dialog"><h3>${files.length > 1 ? T("{0} файла", files.length) : T("Отправить файл")}</h3>
      <p class="pv-note">${T("Отправляется оригинал без сжатия · {0}", fmtSize(total))}</p>
      <div class="pv-list">${items}</div>
      <input class="s2-input" id="pv-cap" type="text" maxlength="1000" placeholder="Добавить подпись…" autocomplete="off">
      <div class="s2-row"><button data-a="no">Отмена</button><button data-a="ok" class="accent">Отправить</button></div></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    const close = () => { el.classList.remove("show"); setTimeout(() => { el.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); }, 200); };
    const send = () => { const cap = el.querySelector("#pv-cap").value.trim(); close(); Chat.sendFiles(files, cap); };
    el.querySelector("#pv-cap").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
    el.addEventListener("click", (e) => {
      if (e.target === el) return close();
      const b = e.target.closest("button[data-a]");
      if (b) b.dataset.a === "ok" ? send() : close();
    });
  },
  max: 50 * 1048576,

  download(att) {
    const base = fileUrl(att.url), local = /^(blob|data):/.test(base);
    const url = local ? base : base + (base.includes("?") ? "&" : "?") + "dl=1";
    try {
      if (TGW && TGW.isVersionAtLeast && TGW.isVersionAtLeast("8.0") && TGW.downloadFile && /^https?:/.test(url)) {
        return TGW.downloadFile({ url, file_name: att.name || "file" });
      }
    } catch (e) {}
    const a = document.createElement("a");
    a.href = url; a.download = att.name || "file"; a.rel = "noopener"; a.target = "_blank";
    a.style.display = "none"; document.body.appendChild(a); a.dataset.dl = "1"; a.click(); a.remove();
  },
};

// ───────────── встроенная камера (свой видоискатель вместо системного окна) ─────────────
const Camera = {
  el: null, stream: null, facing: "environment", onShot: null, pending: null,
  // onShot(file) — если задан, снимок отдаётся ему (аватар, публикация), иначе открывается окно отправки в чат
  async open(onShot, facing) {
    Camera.onShot = onShot || null;
    Camera.facing = facing || "environment";
    const el = (Camera.el = document.createElement("div"));
    el.className = "cam";
    el.innerHTML = `<video playsinline muted autoplay></video>
      <button class="cam-x" aria-label="Закрыть"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <div class="cam-bar"><span></span><button class="cam-shot" aria-label="Снять"><i></i></button>
      <button class="cam-flip" aria-label="Другая камера"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg></button></div>`;
    document.body.appendChild(el);
    Camera.release = Nav.layer(() => Camera.hide());
    el.querySelector(".cam-x").onclick = () => Camera.close();
    el.querySelector(".cam-flip").onclick = () => { Camera.facing = Camera.facing === "environment" ? "user" : "environment"; Camera.start(); };
    el.querySelector(".cam-shot").onclick = () => Camera.shot();
    const ok = await Camera.start();
    if (!ok) Camera.close();
  },
  async start() {
    try { if (Camera.stream) Camera.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error("x"), { name: "NotSupportedError" });
      let seen = false;
      try { seen = localStorage.getItem("cam_ok") === "1"; } catch (e) {}
      let st = "unknown";
      try { st = (await navigator.permissions.query({ name: "camera" })).state; } catch (e) {}
      if (st === "prompt" || (st === "unknown" && !seen)) {
        const go = await UI.sheet({ title: "Доступ к камере", text: "Чтобы снимать фото прямо в чате, разрешите приложению доступ к камере.",
          actions: [{ label: "Разрешить", value: true, accent: true }], cancel: "Не сейчас" });
        if (!go) return false;
      }
      Camera.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: Camera.facing, width: { ideal: 4096 }, height: { ideal: 4096 } }, audio: false });
      try { localStorage.setItem("cam_ok", "1"); } catch (e) {}
      const v = Camera.el.querySelector("video");
      v.srcObject = Camera.stream;
      v.style.transform = Camera.facing === "user" ? "scaleX(-1)" : "";
      return true;
    } catch (e) {
      const n = (e && e.name) || "";
      await UI.sheet({ title: n === "NotFoundError" ? "Камера не найдена" : n === "NotSupportedError" ? "Камера недоступна" : "Нет доступа к камере",
        text: n === "NotFoundError" ? "На устройстве нет камеры." : "Разрешите доступ к камере для этого приложения в настройках телефона (или сайта в браузере) и попробуйте снова.",
        actions: [], cancel: "Понятно" });
      return false;
    }
  },
  async shot() {
    const v = Camera.el.querySelector("video");
    if (!v.videoWidth) return;
    let blob = null;
    try {
      const tr = Camera.stream.getVideoTracks()[0];
      if (window.ImageCapture && tr) blob = await Promise.race([new ImageCapture(tr).takePhoto(), sleep(2500).then(() => null)]);      // полное разрешение сенсора, если поддерживается
    } catch (e) { blob = null; }
    if (!blob) {
      const c = document.createElement("canvas");
      c.width = v.videoWidth; c.height = v.videoHeight;
      const g = c.getContext("2d");
      if (Camera.facing === "user") { g.translate(c.width, 0); g.scale(-1, 1); }
      g.drawImage(v, 0, 0);
      blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.95));
    }
    // снимок отдаём, когда окно камеры уже закрыто (иначе «назад» от закрытия камеры закроет следующее окно)
    if (blob) Camera.pending = new File([blob], "photo_" + Date.now() + ".jpg", { type: blob.type || "image/jpeg" });
    Camera.close();
  },
  close() { if (Camera.release) Camera.release(); else Camera.hide(); },
  hide() {
    Camera.release = null;
    try { if (Camera.stream) Camera.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    Camera.stream = null;
    if (Camera.el) Camera.el.remove();
    Camera.el = null;
    const f = Camera.pending, cb = Camera.onShot;
    Camera.pending = null; Camera.onShot = null;
    if (f) { if (cb) cb(f); else Attach.preview([f]); }
  },
};

// ───────────── просмотр фото/видео (оригинал, зум пальцами) ─────────────
const Viewer = {
  open(att) {
    const el = document.createElement("div");
    el.className = "viewer";
    const vid = /^video\//.test(att.mime || "");
    const src = fileUrl(att.url);
    el.innerHTML = `<div class="v-top"><button class="v-x" aria-label="Закрыть"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <div class="v-name">${esc(att.name || "")}<small>${att.w ? att.w + "×" + att.h + " · " : ""}${att.size ? fmtSize(att.size) : ""}</small></div>
      <button class="v-dl" aria-label="Скачать"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></svg></button></div>
      <div class="v-stage">${vid ? `<video src="${src}" controls autoplay playsinline></video>` : `<img src="${src}" alt="" draggable="false">`}</div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    const hide = () => { el.classList.remove("show"); setTimeout(() => el.remove(), 200); };
    const release = Nav.layer(hide);
    const close = () => release();
    el.querySelector(".v-x").onclick = close;
    el.querySelector(".v-dl").onclick = () => Attach.download(att);
    if (vid) return;
    const stage = el.querySelector(".v-stage"), img = stage.querySelector("img");
    const S = { s: 1, x: 0, y: 0 }, pts = new Map();
    let pinch = null, lastTap = 0, dragY = 0, mode = "";
    const apply = (anim) => {
      img.style.transition = anim ? "transform .2s ease" : "none";
      img.style.transform = `translate(${S.x}px,${S.y + dragY}px) scale(${S.s})`;
      el.style.background = `rgba(0,0,0,${Math.max(0.3, 0.92 - Math.abs(dragY) / 500)})`;
    };
    const dist = () => { const p = [...pts.values()]; return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); };
    stage.addEventListener("pointerdown", (e) => {
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) pinch = { d: dist(), s: S.s };
      mode = pts.size === 1 ? (S.s > 1 ? "pan" : "swipe") : "pinch";
    });
    stage.addEventListener("pointermove", (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 2 && pinch) { S.s = Math.max(1, Math.min(6, pinch.s * (dist() / pinch.d))); }
      else if (mode === "pan") { S.x += dx; S.y += dy; }
      else if (mode === "swipe") dragY += dy;
      apply(false);
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) {
        if (Math.abs(dragY) > 110) return close();
        dragY = 0;
        if (S.s <= 1.02) { S.s = 1; S.x = S.y = 0; }
        const now = Date.now();
        if (e.type === "pointerup" && now - lastTap < 280 && mode !== "pinch") { S.s = S.s > 1 ? 1 : 2.5; if (S.s === 1) S.x = S.y = 0; lastTap = 0; }
        else lastTap = now;
        apply(true);
      }
    };
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
    stage.addEventListener("wheel", (e) => { e.preventDefault(); S.s = Math.max(1, Math.min(6, S.s * (e.deltaY < 0 ? 1.15 : 0.87))); if (S.s === 1) S.x = S.y = 0; apply(true); }, { passive: false });
  },
};
