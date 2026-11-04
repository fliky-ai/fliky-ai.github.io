// voicefx.js — изменение голоса в звонках и видеочатах (Web Audio, без внешних библиотек).
// Голос с микрофона проходит цепочку: сдвиг тона → эффект → ограничитель, и уходит собеседнику уже изменённым.
// Пресеты: мужской, мальчик, девочка, малыш, бас, монстр, робот, пришелец, эхо, зал, радио. Тон можно подстроить ползунком.

const VoiceFX = {
  PRESETS: [
    { id: "normal", n: "Обычный", e: "🙂", st: 0 },
    { id: "man", n: "Мужской", e: "🧔", st: -4, fx: "man" },
    { id: "boy", n: "Мальчик", e: "👦", st: 3, fx: "boy" },
    { id: "girl", n: "Девочка", e: "👧", st: 5, fx: "girl" },
    { id: "child", n: "Малыш", e: "🧒", st: 8, fx: "child" },
    { id: "deep", n: "Бас", e: "🐻", st: -8, fx: "man" },
    { id: "monster", n: "Монстр", e: "👹", st: -10, fx: "monster" },
    { id: "robot", n: "Робот", e: "🤖", st: 0, fx: "robot" },
    { id: "alien", n: "Пришелец", e: "👽", st: 4, fx: "alien" },
    { id: "echo", n: "Эхо", e: "🏔️", st: 0, fx: "echo" },
    { id: "hall", n: "Зал", e: "🏛️", st: 0, fx: "hall" },
    { id: "radio", n: "Радио", e: "📻", st: 0, fx: "radio" },
  ],
  ctx: null,

  supported() {
    const A = window.AudioContext || window.webkitAudioContext;
    return !!(A && A.prototype && A.prototype.createMediaStreamDestination);
  },
  byId(id) { return VoiceFX.PRESETS.find((p) => p.id === id) || VoiceFX.PRESETS[0]; },
  id() { try { return VoiceFX.byId(Prefs.get("voicefx", "normal")).id; } catch (e) { return "normal"; } },
  adj() { try { return Math.max(-8, Math.min(8, +Prefs.get("voicefx_adj", 0) || 0)); } catch (e) { return 0; } },
  label(id) { const p = VoiceFX.byId(id); return p.e + " " + T(p.n); },

  // общий аудио-контекст на всё приложение (их число в браузере ограничено)
  context() {
    if (!VoiceFX.ctx || VoiceFX.ctx.state === "closed") {
      const A = window.AudioContext || window.webkitAudioContext;
      VoiceFX.ctx = new A({ latencyHint: "interactive" });
    }
    if (VoiceFX.ctx.state === "suspended") VoiceFX.ctx.resume().catch(() => {});
    return VoiceFX.ctx;
  },

  // ───────────── сдвиг тона: два плавающих звена задержки с перекрёстным затуханием ─────────────
  // st — полутонов вверх/вниз. Задержка линейно растёт (звук ниже) или падает (выше), два звена сдвинуты на полцикла.
  pitch(ctx, st) {
    const input = ctx.createGain(), output = ctx.createGain();
    if (Math.abs(st) < 0.05) { input.connect(output); return { input, output, stop() { try { input.disconnect(); } catch (e) {} } }; }
    const T_ = 0.1, sr = ctx.sampleRate, n = Math.round(T_ * sr);
    const ratio = Math.pow(2, st / 12), up = ratio > 1, r = up ? ratio - 1 : 1 - ratio, D = r * T_;
    const ramp = ctx.createBuffer(1, n, sr), win = ctx.createBuffer(1, n, sr);
    const rd = ramp.getChannelData(0), wd = win.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const ph = i / n;
      rd[i] = up ? 1 - ph : ph;                       // пила задержки
      wd[i] = Math.pow(Math.sin(Math.PI * ph), 2);    // окно: на скачке пилы звено выключено
    }
    const srcs = [], nodes = [input, output];
    const t0 = ctx.currentTime + 0.05;
    for (let k = 0; k < 2; k++) {
      const delay = ctx.createDelay(0.5); delay.delayTime.value = 0;
      const rg = ctx.createGain(); rg.gain.value = D;
      const tap = ctx.createGain(); tap.gain.value = 0;
      const rs = ctx.createBufferSource(), ws = ctx.createBufferSource();
      rs.buffer = ramp; ws.buffer = win; rs.loop = ws.loop = true;
      rs.connect(rg); rg.connect(delay.delayTime);
      ws.connect(tap.gain);
      input.connect(delay); delay.connect(tap); tap.connect(output);
      const off = k ? T_ / 2 : 0;
      rs.start(t0, off); ws.start(t0, off);
      srcs.push(rs, ws); nodes.push(delay, rg, tap);
    }
    return { input, output, stop() { srcs.forEach((s) => { try { s.stop(); } catch (e) {} }); nodes.forEach((x) => { try { x.disconnect(); } catch (e) {} }); } };
  },

  // ───────────── эффекты после сдвига тона ─────────────
  curve(k) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); }
    return c;
  },
  impulse(ctx, sec, decay) {
    const n = Math.round(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  },
  fx(ctx, kind) {
    const input = ctx.createGain(), output = ctx.createGain(), all = [input, output], osc = [];
    const bq = (type, f, g, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (g !== undefined) b.gain.value = g; if (q) b.Q.value = q; all.push(b); return b; };
    const chain = (...ns) => { let p = input; ns.forEach((x) => { p.connect(x); p = x; }); p.connect(output); };
    switch (kind) {
      case "man": chain(bq("lowshelf", 220, 5), bq("peaking", 140, 2, 0.8), bq("highshelf", 4200, -4)); break;
      case "boy": chain(bq("highpass", 90), bq("peaking", 2400, 3.5, 0.9), bq("lowshelf", 200, -2)); break;
      case "girl": chain(bq("highpass", 160), bq("peaking", 3100, 4, 0.9), bq("highshelf", 5200, 3)); break;
      case "child": chain(bq("highpass", 240), bq("peaking", 3600, 5, 0.9), bq("highshelf", 6000, 3)); break;
      case "monster": { const ws = ctx.createWaveShaper(); ws.curve = VoiceFX.curve(2.6); all.push(ws); chain(bq("lowshelf", 200, 6), ws, bq("lowpass", 3200)); break; }
      case "robot": {
        const ring = ctx.createGain(); ring.gain.value = 0;
        const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = 52; o.connect(ring.gain); o.start(); osc.push(o);
        const d = ctx.createDelay(0.1); d.delayTime.value = 0.011; const fb = ctx.createGain(); fb.gain.value = 0.42;
        const wet = ctx.createGain(); wet.gain.value = 0.9;
        all.push(ring, d, fb, wet);
        input.connect(ring); ring.connect(wet); wet.connect(output);
        ring.connect(d); d.connect(fb); fb.connect(d); d.connect(output);
        break;
      }
      case "alien": {
        const d = ctx.createDelay(0.1); d.delayTime.value = 0.006;
        const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 6.5;
        const depth = ctx.createGain(); depth.gain.value = 0.0035; lfo.connect(depth); depth.connect(d.delayTime); lfo.start(); osc.push(lfo);
        const ring = ctx.createGain(); ring.gain.value = 0.55;
        const o2 = ctx.createOscillator(); o2.type = "sine"; o2.frequency.value = 160; const og = ctx.createGain(); og.gain.value = 0.45; o2.connect(og); og.connect(ring.gain); o2.start(); osc.push(o2);
        all.push(d, depth, ring, og);
        input.connect(d); d.connect(ring); ring.connect(output);
        break;
      }
      case "echo": {
        const d = ctx.createDelay(1.5); d.delayTime.value = 0.27; const fb = ctx.createGain(); fb.gain.value = 0.4; const lp = bq("lowpass", 3400); const wet = ctx.createGain(); wet.gain.value = 0.55;
        all.push(d, fb, wet);
        input.connect(output); input.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(wet); wet.connect(output);
        break;
      }
      case "hall": {
        const cv = ctx.createConvolver(); cv.buffer = VoiceFX.impulse(ctx, 1.9, 2.6); const wet = ctx.createGain(); wet.gain.value = 0.55; const dry = ctx.createGain(); dry.gain.value = 0.85;
        all.push(cv, wet, dry);
        input.connect(dry); dry.connect(output); input.connect(cv); cv.connect(wet); wet.connect(output);
        break;
      }
      case "radio": { const ws = ctx.createWaveShaper(); ws.curve = VoiceFX.curve(3.2); const g = ctx.createGain(); g.gain.value = 0.8; all.push(ws, g); chain(bq("highpass", 420, undefined, 0.9), bq("lowpass", 3100, undefined, 0.9), ws, g); break; }
      default: input.connect(output);
    }
    return { input, output, stop() { osc.forEach((o) => { try { o.stop(); } catch (e) {} }); all.forEach((x) => { try { x.disconnect(); } catch (e) {} }); } };
  },

  // всё вместе: вход → тон → эффект → ограничитель → выход
  build(ctx, id, adj) {
    const p = VoiceFX.byId(id), st = Math.max(-14, Math.min(14, p.st + (adj || 0)));
    const input = ctx.createGain(), output = ctx.createGain();
    const pitch = VoiceFX.pitch(ctx, st), fx = VoiceFX.fx(ctx, p.fx || "none");
    const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -10; lim.knee.value = 8; lim.ratio.value = 10; lim.attack.value = 0.003; lim.release.value = 0.12;
    input.connect(pitch.input); pitch.output.connect(fx.input); fx.output.connect(lim); lim.connect(output);
    return { input, output, stop() { pitch.stop(); fx.stop(); [input, output, lim].forEach((x) => { try { x.disconnect(); } catch (e) {} }); } };
  },

  // ───────────── поток для звонка ─────────────
  // process(поток с микрофона) → { stream (изменённый звук), raw, id, set(id, adj), monitor(on), level(), close() }
  process(raw, opt) {
    const h = { raw, id: (opt && opt.id) || VoiceFX.id(), adj: opt && opt.adj !== undefined ? opt.adj : VoiceFX.adj(), stream: raw, fx: false, mon: false };
    if (!VoiceFX.supported() || !raw.getAudioTracks().length) { h.set = h.monitor = () => {}; h.level = () => 0; h.close = () => {}; return h; }
    let ctx;
    try { ctx = VoiceFX.context(); } catch (e) { h.set = h.monitor = () => {}; h.level = () => 0; h.close = () => {}; return h; }
    const src = ctx.createMediaStreamSource(new MediaStream(raw.getAudioTracks()));
    const dest = ctx.createMediaStreamDestination();
    const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
    const mon = ctx.createGain(); mon.gain.value = 0;
    let cur = null;
    const wire = () => {
      if (cur) cur.stop();
      cur = VoiceFX.build(ctx, h.id, h.adj);
      src.connect(cur.input); cur.output.connect(dest); cur.output.connect(mon);
    };
    mon.connect(ctx.destination);
    wire();
    h.fx = true;
    h.stream = new MediaStream(dest.stream.getAudioTracks());
    h.set = (id, adj) => {
      if (id) h.id = VoiceFX.byId(id).id;
      if (adj !== undefined) h.adj = adj;
      try { src.disconnect(); src.connect(an); } catch (e) {}
      wire();
    };
    h.monitor = (on) => { h.mon = !!on; mon.gain.value = on ? 0.9 : 0; };
    const buf = new Uint8Array(an.fftSize);
    h.level = () => { try { an.getByteTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; } return Math.sqrt(s / buf.length); } catch (e) { return 0; } };
    h.close = () => {
      if (cur) cur.stop(); cur = null;
      [src, dest, an, mon].forEach((x) => { try { x.disconnect(); } catch (e) {} });
      dest.stream.getTracks().forEach((t) => t.stop());
    };
    return h;
  },

  // ───────────── окно выбора голоса ─────────────
  // panel(handle, {onChange(id)}) — нижняя панель: плитки эффектов, тон, «слышать себя»
  panel(h, o = {}) {
    const el = document.createElement("div");
    el.className = "vfx";
    const draw = () => {
      el.innerHTML = `<div class="vfx-card" role="dialog" aria-label="${esc(T("Голос"))}">
        <div class="vfx-grip"></div>
        <h3>${esc(T("Эффект голоса"))}</h3>
        <p>${esc(T("Собеседники услышат изменённый голос."))}</p>
        <div class="vfx-grid">${VoiceFX.PRESETS.map((p) => `<button class="vfx-t${p.id === h.id ? " on" : ""}" data-id="${p.id}"><span class="vfx-e">${p.e}</span><span>${esc(T(p.n))}</span></button>`).join("")}</div>
        <div class="vfx-row"><span>${esc(T("Тон"))}</span><input type="range" class="rng" min="-8" max="8" step="1" value="${h.adj}" style="--p:${((h.adj + 8) / 16) * 100}%" data-tone><b data-tv>${h.adj > 0 ? "+" : ""}${h.adj}</b></div>
        <button class="vfx-mon${h.mon ? " on" : ""}" data-mon><span class="sw${h.mon ? " on" : ""}"><i></i></span><span class="vfx-mt"><b>${esc(T("Слышать себя"))}</b><small>${esc(T("Лучше в наушниках — иначе будет эхо"))}</small></span></button>
        <button class="vfx-ok" data-ok>${esc(T("Готово"))}</button></div>`;
    };
    draw();
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    const close = () => { el.classList.remove("show"); setTimeout(() => el.remove(), 220); if (o.onClose) o.onClose(); };
    const save = () => { try { Prefs.set("voicefx", h.id); Prefs.set("voicefx_adj", h.adj); } catch (e) {} if (o.onChange) o.onChange(h.id, h.adj); };
    el.addEventListener("click", (e) => {
      if (e.target === el || e.target.closest("[data-ok]")) return close();
      const t = e.target.closest("[data-id]");
      if (t) { h.set(t.dataset.id); save(); el.querySelectorAll(".vfx-t").forEach((x) => x.classList.toggle("on", x === t)); try { haptic(); } catch (er) {} return; }
      if (e.target.closest("[data-mon]")) { h.monitor(!h.mon); el.querySelector(".vfx-mon").classList.toggle("on", h.mon); el.querySelector(".vfx-mon .sw").classList.toggle("on", h.mon); }
    });
    let tm = 0;
    el.addEventListener("input", (e) => {
      const r = e.target.closest("[data-tone]"); if (!r) return;
      h.adj = +r.value; r.style.setProperty("--p", ((h.adj + 8) / 16) * 100 + "%");
      el.querySelector("[data-tv]").textContent = (h.adj > 0 ? "+" : "") + h.adj;
      clearTimeout(tm); tm = setTimeout(() => { h.set(null, h.adj); save(); }, 160);
    });
    return { close };
  },
};
