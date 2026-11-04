// voice.js — голосовые сообщения: запись удержанием кнопки (влево — отмена, вверх — закрепить запись),
// плеер в пузыре. Звук пишется через Web Audio в несжатый WAV (16 кГц, моно): без потерь слов,
// с точной длительностью и перемоткой, одинаково играет на любом устройстве.
const SR = 16000, MIN_MS = 600, TAIL_MS = 280, MAX_MS = 10 * 60 * 1000, WAVE_N = 44;
const fmtDur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3.5"/></svg>';
const WORKLET = `class P extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(2048);this.n=0}
process(i){const c=i[0]&&i[0][0];if(!c)return true;for(let k=0;k<c.length;k++){this.b[this.n++]=c[k];if(this.n===2048){this.port.postMessage(this.b.slice(0));this.n=0}}return true}}
registerProcessor('rec-proc',P)`;

// ───────────── запись звука ─────────────
const Rec = {
  stream: null, ctx: null, node: null, an: null, idleT: 0, buf: [], on: false, t0: 0, rate: 48000, td: null,

  warm() {
    return !!(Rec.stream && Rec.ctx && Rec.ctx.state !== "closed" && Rec.stream.getTracks().every((t) => t.readyState === "live"));
  },

  // открыть микрофон. Поток держим ещё ~20 с после записи — следующая запись стартует мгновенно, без потери первых слов.
  async open() {
    clearTimeout(Rec.idleT);
    // запись голосового: музыку и чужие голосовые ставим на паузу (настройка «Медиа и звук»)
    if (Prefs.get("pauserec", true)) { try { if (Player.a && !Player.a.paused) Player.a.pause(); } catch (e) {} }
    if (Rec.warm()) {
      Rec.stream.getTracks().forEach((t) => (t.enabled = true));
      if (Rec.ctx.state === "suspended") { try { await Rec.ctx.resume(); } catch (e) {} }
      return;
    }
    Rec.close();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error("no api"), { name: "NotSupportedError" });
    const mic = Prefs.get("micid", "");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: Object.assign({ channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, mic ? { deviceId: { ideal: mic } } : {}) });
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    if (ctx.state === "suspended") { try { await ctx.resume(); } catch (e) {} }
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
    const push = (f) => { if (Rec.on) Rec.buf.push(f); };
    let node = null;
    if (ctx.audioWorklet && window.AudioWorkletNode) {
      try {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        node = new AudioWorkletNode(ctx, "rec-proc", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        node.port.onmessage = (e) => push(e.data);
      } catch (e) { node = null; }
    }
    if (!node) {
      node = ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => push(new Float32Array(e.inputBuffer.getChannelData(0)));
    }
    src.connect(node);
    const mute = ctx.createGain(); mute.gain.value = 0;   // узел должен быть подключён к выходу, но звука в динамик не даём
    node.connect(mute); mute.connect(ctx.destination);
    Rec.stream = stream; Rec.ctx = ctx; Rec.node = node; Rec.an = an; Rec.rate = ctx.sampleRate;
    Rec.td = new Uint8Array(an.fftSize);
  },
  idle() {
    Rec.on = false;
    if (Rec.stream) Rec.stream.getTracks().forEach((t) => (t.enabled = false));
    clearTimeout(Rec.idleT);
    Rec.idleT = setTimeout(() => Rec.close(), 20000);
  },
  close() {
    clearTimeout(Rec.idleT);
    try { if (Rec.stream) Rec.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { if (Rec.ctx && Rec.ctx.state !== "closed") Rec.ctx.close(); } catch (e) {}
    Rec.stream = Rec.ctx = Rec.node = Rec.an = null;
  },
  start() { Rec.buf = []; Rec.t0 = performance.now(); Rec.on = true; },
  level() {
    if (!Rec.an) return 0;
    Rec.an.getByteTimeDomainData(Rec.td);
    let s = 0;
    for (let i = 0; i < Rec.td.length; i++) { const v = (Rec.td[i] - 128) / 128; s += v * v; }
    return Math.min(1, Math.sqrt(s / Rec.td.length) * 4);
  },
  // остановка: ещё немного дописываем «хвост», чтобы не обрезать последнее слово
  async stop() {
    await sleep(TAIL_MS);
    Rec.on = false;
    const chunks = Rec.buf; Rec.buf = [];
    Rec.idle();
    return Rec.encode(chunks, Rec.rate);
  },
  discard() { Rec.on = false; Rec.buf = []; Rec.idle(); },

  encode(chunks, rate) {
    let n = 0;
    chunks.forEach((c) => (n += c.length));
    const all = new Float32Array(n);
    let p = 0;
    chunks.forEach((c) => { all.set(c, p); p += c.length; });
    const ratio = rate / SR, outN = Math.floor(n / ratio), pcm = new Int16Array(outN);
    for (let i = 0; i < outN; i++) {
      const a = Math.floor(i * ratio), b = Math.min(n, Math.max(a + 1, Math.floor((i + 1) * ratio)));
      let s = 0;
      for (let k = a; k < b; k++) s += all[k];
      s /= b - a;
      pcm[i] = Math.max(-1, Math.min(1, s)) * 32767;
    }
    // волна для пузыря: WAVE_N столбиков 0..31
    const wave = [], step = Math.max(1, Math.floor(outN / WAVE_N));
    let peak = 1;
    const raw = [];
    for (let i = 0; i < WAVE_N; i++) {
      let m = 0;
      for (let k = i * step; k < Math.min(outN, (i + 1) * step); k++) m = Math.max(m, Math.abs(pcm[k]));
      raw.push(m); peak = Math.max(peak, m);
    }
    raw.forEach((m) => wave.push(Math.max(2, Math.round(Math.sqrt(m / peak) * 31))));
    // WAV
    const buf = new ArrayBuffer(44 + outN * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + outN * 2, true); w(8, "WAVE"); w(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, "data"); v.setUint32(40, outN * 2, true);
    new Int16Array(buf, 44).set(pcm);
    return { blob: new Blob([buf], { type: "audio/wav" }), dur: Math.round((outN / SR) * 1000), wave };
  },
};

// ───────────── кнопка записи ─────────────
const Voice = {
  st: "idle",          // idle | starting | rec | locked | busy
  pid: 0, held: false, p0: null, timer: 0, raf: 0,

  bind() {
    const b = $("btn-main");
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    b.addEventListener("pointerdown", (e) => {
      if (Chat.mainMode() !== "mic" || Voice.st !== "idle" || (e.pointerType === "mouse" && e.button !== 0)) return;
      if (Chat.slowLeft() > 0) { e.preventDefault(); return Chat.slowShake(); }
      e.preventDefault();
      Voice.down(e);
    });
    b.addEventListener("pointermove", (e) => Voice.move(e));
    b.addEventListener("pointerup", (e) => Voice.up(e));
    b.addEventListener("pointercancel", () => { Voice.held = false; if (Voice.st === "rec" || Voice.st === "starting") Voice.cancel(); else if (Voice.st === "arming") Voice.reset(); });
    $("rec-cancel").onclick = () => Voice.cancel();
  },

  ui(on) {
    const c = $("composer");
    c.classList.toggle("recording", on);
    $("rec").classList.toggle("hidden", !on);
    $("rec-lock").classList.toggle("hidden", !on);
    if (!on) {
      c.classList.remove("locked");
      const b = $("btn-main");
      b.style.transform = ""; b.classList.remove("rec");
      $("rec-hint").style.opacity = ""; $("rec-hint").style.transform = "";
      $("rec-lock").style.setProperty("--p", "0");
      $("rec-time").textContent = "0:00";
    }
  },

  reset() {
    Voice.st = "idle"; Voice.held = false; Voice.lockGesture = false; $("btn-main").classList.remove("arming");
    clearInterval(Voice.timer); cancelAnimationFrame(Voice.raf);
    Voice.ui(false);
  },

  async permState() {
    try { return (await navigator.permissions.query({ name: "microphone" })).state; } catch (e) { return "unknown"; }
  },

  async fail(err) {
    const n = (err && err.name) || "";
    if (n === "NotFoundError" || n === "OverconstrainedError") await UI.sheet({ title: "Микрофон не найден", text: "Подключите микрофон и попробуйте снова.", actions: [], cancel: "Понятно", icon: MIC_SVG });
    else if (n === "NotSupportedError") await UI.sheet({ title: "Запись недоступна", text: "Это устройство или приложение не поддерживает запись звука.", actions: [], cancel: "Понятно", icon: MIC_SVG });
    else await UI.sheet({ title: "Нет доступа к микрофону", text: "Разрешите доступ к микрофону для этого приложения в настройках телефона (или в настройках сайта в браузере) и попробуйте снова.", actions: [], cancel: "Понятно", icon: MIC_SVG });
  },

  // true — микрофон готов, можно писать
  async ensure() {
    if (Rec.warm()) { await Rec.open(); return true; }
    const st = await Voice.permState();
    if (st === "denied") { Voice.reset(); await Voice.fail({ name: "NotAllowedError" }); return false; }
    let seen = false;
    try { seen = localStorage.getItem("mic_ok") === "1"; } catch (e) {}
    if (st !== "granted" && !seen) {
      // своё окно перед системным запросом разрешения
      Voice.reset();
      const go = await UI.sheet({ title: "Доступ к микрофону", text: "Чтобы записывать голосовые сообщения, разрешите приложению доступ к микрофону.",
        actions: [{ label: "Разрешить", value: true, accent: true }], cancel: "Не сейчас", icon: MIC_SVG });
      if (!go) return false;
      try {
        await Rec.open(); Rec.idle();
        try { localStorage.setItem("mic_ok", "1"); } catch (e) {}
        toast("Микрофон включён. Удерживайте кнопку, чтобы записать");
      } catch (err) { await Voice.fail(err); }
      return false;
    }
    try {
      await Rec.open();
      try { localStorage.setItem("mic_ok", "1"); } catch (e) {}
      return true;
    } catch (err) { Voice.reset(); await Voice.fail(err); return false; }
  },

  async down(e) {
    const id = ++Voice.pid;
    Voice.st = "arming"; Voice.held = true;
    Voice.p0 = { x: e.clientX, y: e.clientY };
    try { $("btn-main").setPointerCapture(e.pointerId); } catch (err) {}
    // микрофон включается только если кнопку удерживают полсекунды — случайное касание ничего не запускает
    $("btn-main").classList.add("arming");
    await new Promise((r) => setTimeout(r, 500));
    $("btn-main").classList.remove("arming");
    if (id !== Voice.pid || Voice.st !== "arming") return;
    if (!Voice.held) { Voice.reset(); return toast("Удерживайте кнопку, чтобы записать голосовое"); }
    Voice.st = "starting";
    Voice.ui(true);
    $("btn-main").classList.add("rec");
    const ok = await Voice.ensure();
    if (id !== Voice.pid || Voice.st !== "starting") return;     // отменили, пока ждали разрешение
    if (!ok) return Voice.reset();
    if (!Voice.held) { Voice.reset(); Rec.idle(); return toast("Удерживайте кнопку, чтобы записать голосовое"); }
    Rec.start();
    Voice.st = "rec";
    haptic("medium");
    try { navigator.vibrate && navigator.vibrate(20); } catch (err) {}
    const tick = () => {
      if (Voice.st !== "rec" && Voice.st !== "locked") return;
      const ms = performance.now() - Rec.t0;
      $("rec-time").textContent = fmtDur(ms).replace(/^(\d+:\d+)$/, "$1") + "," + Math.floor((ms % 1000) / 100);
      $("btn-main").style.setProperty("--lvl", Rec.level().toFixed(2));
      if (ms >= MAX_MS) return Voice.finish(true);
      Voice.raf = requestAnimationFrame(tick);
    };
    tick();
  },

  move(e) {
    if (Voice.st !== "rec") return;
    const dx = Math.min(0, e.clientX - Voice.p0.x), dy = Math.min(0, e.clientY - Voice.p0.y);
    const b = $("btn-main");
    b.style.transform = `translate(${dx * 0.7}px, ${dy * 0.7}px) scale(1.28)`;
    const h = $("rec-hint");
    h.style.transform = `translateX(${dx * 0.5}px)`;
    h.style.opacity = String(Math.max(0, 1 + dx / 110));
    $("rec-lock").style.setProperty("--p", String(Math.min(1, -dy / 80)));
    if (dx < -100) Voice.cancel();
    else if (dy < -80) Voice.lock();
  },

  up() {
    Voice.held = false;
    if (Voice.st === "rec") Voice.finish(true);
    else if (Voice.st === "locked" && Voice.lockGesture) {
      // палец, закрепивший запись, отпущен: клик, который за этим последует, отправкой считать нельзя
      Voice.lockGesture = false; Voice.swallow = true;
      setTimeout(() => (Voice.swallow = false), 350);
    }
  },

  lock() {
    if (Voice.st !== "rec") return;
    Voice.st = "locked"; Voice.lockGesture = true;
    haptic("medium");
    $("composer").classList.add("locked");
    const b = $("btn-main");
    b.style.transform = ""; b.classList.remove("rec");
  },

  async finish(send) {
    if (Voice.st !== "rec" && Voice.st !== "locked") return;
    Voice.st = "busy";
    cancelAnimationFrame(Voice.raf);
    Voice.ui(false);
    const res = await Rec.stop();
    Voice.st = "idle"; Voice.held = false;
    if (!send) return;
    if (res.dur < MIN_MS) return toast("Удерживайте кнопку, чтобы записать голосовое");
    Chat.sendVoice(res);
  },

  cancel() {
    if (Voice.st === "idle") return;
    haptic("light");
    Voice.pid++;
    if (Voice.st === "rec" || Voice.st === "locked") Rec.discard();
    Voice.reset();
  },
};

// ───────────── проигрыватель в пузырях ─────────────
const Player = {
  a: null, k: null, rate: 1,

  init() {
    const a = (Player.a = new Audio());
    a.preload = "auto";
    a.addEventListener("timeupdate", () => Player.paint());
    a.addEventListener("play", () => Player.paint());
    a.addEventListener("pause", () => Player.paint());
    a.addEventListener("ended", () => { a.currentTime = 0; Player.paint(); });
    a.addEventListener("error", () => { if (Player.k) toast("Не удалось воспроизвести"); Player.k = null; Player.paint(); });
    try { Player.rate = +localStorage.getItem("vrate") || 1; } catch (e) {}
  },

  async toggle(k, url) {
    const a = Player.a;
    if (Player.k === k && a.src) {
      if (a.paused) { try { await a.play(); } catch (e) {} } else a.pause();
      return;
    }
    Player.k = k;
    a.src = url;
    a.playbackRate = Player.rate;
    try { await a.play(); } catch (e) { toast("Не удалось воспроизвести"); }
    Player.paint();
  },
  seek(k, frac, url) {
    const a = Player.a;
    if (Player.k !== k) { Player.k = k; a.src = url; a.playbackRate = Player.rate; }
    const go = () => { if (a.duration && isFinite(a.duration)) a.currentTime = frac * a.duration; };
    if (a.readyState >= 1) go(); else a.addEventListener("loadedmetadata", go, { once: true });
    Player.paint();
  },
  speed(k) {
    Player.rate = Player.rate === 1 ? 1.5 : Player.rate === 1.5 ? 2 : 1;
    try { localStorage.setItem("vrate", String(Player.rate)); } catch (e) {}
    Player.a.playbackRate = Player.rate;
    Player.paint();
  },
  stop() { try { Player.a.pause(); } catch (e) {} Player.k = null; Player.paint(); },

  // обновить вид всех голосовых в списке (вызывается и после перерисовки пузырей)
  paint() {
    const a = Player.a;
    document.querySelectorAll(".vm").forEach((el) => {
      const mine = el.dataset.k === Player.k;
      const dur = +el.dataset.dur || (mine && a.duration) * 1000 || 0;
      const frac = mine && a.duration ? Math.min(1, a.currentTime / a.duration) : 0;
      el.classList.toggle("playing", mine && !a.paused);
      el.classList.toggle("active", mine);
      const bars = el.querySelectorAll(".vm-bars i"), on = Math.round(frac * bars.length);
      bars.forEach((b, i) => b.classList.toggle("on", i < on));
      el.querySelector(".vm-time").textContent = mine && a.currentTime > 0.05 ? fmtDur(a.currentTime * 1000) : fmtDur(dur);
      const sp = el.querySelector(".vm-spd");
      if (sp) sp.textContent = Player.rate === 1 ? "1×" : Player.rate + "×";
    });
  },

  // html голосового сообщения
  html(m) {
    const a = m.att || {}, wave = (a.wave && a.wave.length ? a.wave : new Array(WAVE_N).fill(8));
    const bars = wave.map((h) => `<i style="height:${Math.max(12, Math.round((h / 31) * 100))}%"></i>`).join("");
    return `<div class="vm" data-k="${mkey(m)}" data-dur="${a.dur || 0}"><button class="vm-play" type="button" aria-label="Воспроизвести">
      <svg class="i-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>
      <svg class="i-pause" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/></svg></button>
      <div class="vm-body"><div class="vm-wave"><div class="vm-bars">${bars}</div></div>
      <div class="vm-meta"><span class="vm-time">${fmtDur(a.dur || 0)}</span><button class="vm-spd" type="button">1×</button></div></div></div>`;
  },
};
