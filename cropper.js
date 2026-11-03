// cropper.js — свой экран выбора области фото: круг, двигать пальцем, масштабировать щипком / колесом.
// Cropper.open(file, {title}) → Promise<dataURL JPEG 512×512 | null>
const Cropper = {
  open(file, { title = "Фото профиля", out = 512 } = {}) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const el = document.createElement("div");
      el.className = "crop";
      el.innerHTML = `<header class="cr-top"><button class="cr-x" aria-label="Отмена"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        <b>${esc(title)}</b><button class="cr-ok" disabled>Готово</button></header>
        <div class="cr-stage"><img alt="" draggable="false"><div class="cr-hole"></div></div>
        <div class="cr-tip">Двигайте фото и масштабируйте двумя пальцами</div>`;
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add("show"));
      const stage = el.querySelector(".cr-stage"), img = el.querySelector("img"), hole = el.querySelector(".cr-hole"), ok = el.querySelector(".cr-ok");

      let finished = false, D = 280, iw = 0, ih = 0, minS = 1;
      const S = { s: 1, x: 0, y: 0 };
      const finish = (v) => { if (finished) return; finished = true; resolve(v); };
      const release = Nav.layer(() => {
        finish(null);
        removeEventListener("resize", layout);
        el.classList.remove("show");
        setTimeout(() => { el.remove(); URL.revokeObjectURL(url); }, 200);
      });

      const clamp = () => {
        S.s = Math.max(minS, Math.min(minS * 8, S.s));
        const mx = Math.max(0, (iw * S.s - D) / 2), my = Math.max(0, (ih * S.s - D) / 2);
        S.x = Math.max(-mx, Math.min(mx, S.x)); S.y = Math.max(-my, Math.min(my, S.y));
      };
      const apply = () => { clamp(); img.style.transform = `translate(-50%,-50%) translate(${S.x}px,${S.y}px) scale(${S.s})`; };
      const layout = () => {
        const r = stage.getBoundingClientRect();
        const prev = D;
        D = Math.max(160, Math.min(380, Math.min(r.width, r.height) - 40));
        hole.style.width = hole.style.height = D + "px";
        if (iw) {
          const old = minS; minS = D / Math.min(iw, ih);
          if (S.s < minS || old === 1) S.s = Math.max(S.s, minS);
          if (prev !== D && old !== 1) S.s *= D / prev;
          apply();
        }
      };

      img.onload = () => {
        iw = img.naturalWidth; ih = img.naturalHeight;
        img.style.width = iw + "px"; img.style.height = ih + "px";
        minS = D / Math.min(iw, ih); S.s = minS; S.x = S.y = 0;
        layout(); apply(); ok.disabled = false;
      };
      img.onerror = () => { toast("Не удалось открыть фото"); release(); };
      img.src = url;
      layout();
      addEventListener("resize", layout);

      // жесты
      const pts = new Map();
      let pinch = null;
      const dist = () => { const p = [...pts.values()]; return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); };
      stage.addEventListener("pointerdown", (e) => {
        stage.setPointerCapture(e.pointerId);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 2) pinch = { d: dist(), s: S.s };
      });
      stage.addEventListener("pointermove", (e) => {
        const p = pts.get(e.pointerId); if (!p) return;
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        if (pts.size === 2 && pinch) { const k = dist() / pinch.d; S.s = pinch.s * k; }
        else if (pts.size === 1) { S.x += dx; S.y += dy; }
        apply();
      });
      const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
      stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
      stage.addEventListener("wheel", (e) => { e.preventDefault(); S.s *= Math.exp(-Math.max(-300, Math.min(300, e.deltaY)) * 0.0015); apply(); }, { passive: false });

      el.querySelector(".cr-x").onclick = () => release();
      ok.onclick = () => {
        if (!iw) return;
        const c = document.createElement("canvas");
        c.width = c.height = out;
        const g = c.getContext("2d"), k = out / D;
        g.fillStyle = "#fff"; g.fillRect(0, 0, out, out);
        g.imageSmoothingQuality = "high";
        g.drawImage(img, (D / 2 + S.x - (iw * S.s) / 2) * k, (D / 2 + S.y - (ih * S.s) / 2) * k, iw * S.s * k, ih * S.s * k);
        finish(c.toDataURL("image/jpeg", 0.9));
        release();
      };
    });
  },
};
