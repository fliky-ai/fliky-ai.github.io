// call.js — голосовые и видеозвонки и видеочат группы (WebRTC).
// Сервер только передаёт сигналы по WebSocket (rtc / vc); звук и видео идут напрямую между участниками
// (через TURN, если прямое соединение невозможно). Голос проходит через VoiceFX — эффекты «мужской», «девочка», «робот» и т.д.

// ───────────── мелодии вызова, сгенерированные кодом ─────────────
const Ring = {
  timer: 0,
  tone(f, at, dur, vol, type) {
    const ctx = VoiceFX.context(), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + 0.02);
    g.gain.setValueAtTime(vol, Math.max(at + 0.02, at + dur - 0.05)); g.gain.linearRampToValueAtTime(0, at + dur);
    o.connect(g); g.connect(ctx.destination); o.start(at); o.stop(at + dur + 0.03);
  },
  start(kind) {
    Ring.stop();
    if (!VoiceFX.supported()) return;
    const cycle = () => {
      try {
        const t = VoiceFX.context().currentTime + 0.04;
        if (kind === "in") {
          [[784, 0], [988, 0.2], [784, 0.4], [988, 0.6], [1175, 0.88]].forEach(([f, o]) => Ring.tone(f, t + o, 0.17, 0.14, "triangle"));
          try { navigator.vibrate && navigator.vibrate([380, 160, 380]); } catch (e) {}
        } else Ring.tone(425, t, 1.0, 0.07);
      } catch (e) {}
    };
    cycle();
    Ring.timer = setInterval(cycle, kind === "in" ? 2800 : 4000);
  },
  stop() { clearInterval(Ring.timer); Ring.timer = 0; try { navigator.vibrate && navigator.vibrate(0); } catch (e) {} },
  beep(kind) {
    if (!VoiceFX.supported()) return;
    try {
      const t = VoiceFX.context().currentTime + 0.02;
      if (kind === "on") { Ring.tone(660, t, 0.1, 0.1, "triangle"); Ring.tone(880, t + 0.11, 0.14, 0.1, "triangle"); }
      else { Ring.tone(520, t, 0.12, 0.1, "triangle"); Ring.tone(390, t + 0.13, 0.2, 0.1, "triangle"); }
    } catch (e) {}
  },
};

// ───────────── одно соединение «человек — человек» ─────────────
// «Идеальное согласование»: оба конца могут предлагать условия одновременно, конфликт разрешает вежливая сторона.
class Link {
  constructor(o) {
    this.o = o; this.closed = false; this.makingOffer = false; this.ignoreOffer = false; this.ready = !!o.initiator;
    this.chain = Promise.resolve(); this.fails = 0; this.st = "new"; this.remote = null;
    const pc = (this.pc = new RTCPeerConnection({ iceServers: o.ice, bundlePolicy: "max-bundle" }));
    o.stream.getAudioTracks().forEach((t) => pc.addTrack(t, o.stream));
    this.vs = pc.addTransceiver(o.vt || "video", { direction: "sendrecv", streams: [o.stream] }).sender;
    pc.onicecandidate = (e) => { if (e.candidate && !this.closed) o.send("ice", e.candidate.toJSON ? e.candidate.toJSON() : e.candidate); };
    pc.ontrack = (e) => {
      const s = (e.streams && e.streams[0]) || this.remote || new MediaStream();
      if (!(e.streams && e.streams[0])) { try { s.addTrack(e.track); } catch (er) {} }
      this.remote = s;
      e.track.onmute = e.track.onunmute = () => { if (!this.closed && o.onTrack) o.onTrack(s); };
      if (o.onTrack) o.onTrack(s);
    };
    pc.onnegotiationneeded = async () => {
      if (!this.ready || this.closed) return;
      try {
        this.makingOffer = true;
        await pc.setLocalDescription(await pc.createOffer());
        if (!this.closed) o.send("sdp", { type: pc.localDescription.type, sdp: pc.localDescription.sdp });
      } catch (e) { console.warn("offer", e); }
      finally { this.makingOffer = false; }
    };
    pc.onconnectionstatechange = pc.oniceconnectionstatechange = () => this.state();
  }
  signal(k, d) { this.chain = this.chain.then(() => this.apply(k, d)).catch((e) => console.warn("rtc", e)); }
  async apply(k, d) {
    if (this.closed) return;
    const pc = this.pc;
    if (k === "sdp") {
      const collision = d.type === "offer" && (this.makingOffer || pc.signalingState !== "stable");
      this.ignoreOffer = !this.o.polite && collision;
      if (this.ignoreOffer) return;
      if (collision) await Promise.all([pc.setLocalDescription({ type: "rollback" }), pc.setRemoteDescription(d)]);
      else await pc.setRemoteDescription(d);
      if (d.type === "offer") {
        this.ready = true;
        await pc.setLocalDescription(await pc.createAnswer());
        if (!this.closed) this.o.send("sdp", { type: pc.localDescription.type, sdp: pc.localDescription.sdp });
      }
    } else if (k === "ice") {
      try { await pc.addIceCandidate(d); } catch (e) { if (!this.ignoreOffer) console.warn("ice", e); }
    }
  }
  state() {
    if (this.closed) return;
    const pc = this.pc, cs = pc.connectionState, is = pc.iceConnectionState;
    let st = "connecting";
    if (cs === "connected" || is === "connected" || is === "completed") st = "connected";
    else if (cs === "failed" || is === "failed") st = "failed";
    else if (cs === "disconnected" || is === "disconnected") st = "unstable";
    else if (cs === "closed") return;
    if (st === "failed" && this.fails++ < 2) { try { pc.restartIce(); } catch (e) {} st = "unstable"; }
    if (st !== this.st) { this.st = st; if (this.o.onState) this.o.onState(st); }
  }
  setVideo(track) { try { this.vs.replaceTrack(track || null).catch(() => {}); } catch (e) {} }
  close() {
    this.closed = true;
    try { this.pc.onicecandidate = this.pc.ontrack = this.pc.onnegotiationneeded = this.pc.onconnectionstatechange = this.pc.oniceconnectionstatechange = null; this.pc.close(); } catch (e) {}
  }
}

// ───────────── значки ─────────────
const CUI = {
  svg: (p, f) => `<svg viewBox="0 0 24 24" fill="${f ? "currentColor" : "none"}" stroke="${f ? "none" : "currentColor"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`,
};
Object.assign(CUI, {
  down: CUI.svg('<path d="m6 9 6 6 6-6"/>'),
  fx: CUI.svg('<path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 10v4M21.5 12h-.5"/>'),
  spk: CUI.svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  vid: CUI.svg('<rect x="2" y="6" width="14" height="12" rx="2.5"/><path d="m16 10 6-3v10l-6-3z"/>'),
  vidOff: CUI.svg('<path d="M16 10.5 22 7v10l-6-3.5"/><path d="M16 16.2V8.5A2.500 2.500 0 0 0 13.500 6H7.500M4.500 6A2.500 2.500 0 0 0 2 8.500v7A2.500 2.500 0 0 0 4.500 18h9"/><path d="M3 3l18 18"/>'),
  mic: CUI.svg('<rect x="9" y="2.500" width="6" height="11.500" rx="3"/><path d="M5.500 11.500a6.500 6.500 0 0 0 13 0M12 18v3.500"/>'),
  micOff: CUI.svg('<path d="M9 9v2a3 3 0 0 0 5.100 2.100M15 9.300V5.500a3 3 0 0 0-5.900-.8"/><path d="M5.500 11.500a6.500 6.500 0 0 0 10.300 5.300M18.500 11.500a6.500 6.500 0 0 1-.6 2.700M12 18v3.500"/><path d="M3 3l18 18"/>'),
  end: CUI.svg('<path d="M22 16.900v3a2 2 0 0 1-2.200 2 19.800 19.800 0 0 1-8.600-3.100 19.500 19.500 0 0 1-6-6A19.800 19.800 0 0 1 2.100 4.200 2 2 0 0 1 4.100 2h3a2 2 0 0 1 2 1.700c.1 1 .4 1.900.7 2.800a2 2 0 0 1-.5 2.100L8 9.900a16 16 0 0 0 6 6l1.300-1.300a2 2 0 0 1 2.100-.4c.9.3 1.800.6 2.800.7a2 2 0 0 1 1.700 2z"/>'),
  flip: CUI.svg('<path d="M3 12a9 9 0 0 1 15.500-6.200L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.500 6.200L3 16M3 21v-5h5"/>'),
  micS: CUI.svg('<rect x="9" y="2.500" width="6" height="11.500" rx="3"/><path d="M5.500 11.500a6.500 6.500 0 0 0 13 0M12 18v3.500"/>'),
  micOffS: CUI.svg('<path d="M9 9v2a3 3 0 0 0 5.100 2.100M15 9.300V5.500a3 3 0 0 0-5.900-.8"/><path d="M12 18v3.500"/><path d="M3 3l18 18"/>'),
  users: CUI.svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.900M16 3.100a4 4 0 0 1 0 7.800"/>'),
});

const Calls = {
  cur: null, vc: null, iceCache: null, iceAt: 0, wake: null, tm: 0, inited: false,

  init() {
    if (Calls.inited) return;
    Calls.inited = true;
    const mk = (tag, id, cls) => { const e = document.createElement(tag); e.id = id; e.className = cls; document.body.appendChild(e); return e; };
    Calls.el = mk("div", "callui", "callui hidden");
    Calls.pill = mk("button", "callpill", "callpill hidden");
    Calls.audio = mk("div", "callaudio", "callaudio");
    Calls.el.addEventListener("click", (e) => Calls.click(e));
    Calls.pill.addEventListener("click", () => Calls.restore());
    Calls.drag();
    Calls.tm = setInterval(() => Calls.tick(), 1000);
    addEventListener("pagehide", () => { try { if (Calls.cur && !Calls.cur.done) Calls.hangup(true); if (Calls.vc && !Calls.vc.done) Calls.leaveVC(true); } catch (e) {} });
    setTimeout(() => Calls.ice(), 2500);          // заранее берём адреса STUN/TURN
  },

  // ───────────── вспомогательное ─────────────
  send(o) { try { if (App.ws && App.ws.readyState === 1) { App.ws.send(JSON.stringify(o)); return true; } } catch (e) {} return false; },
  online() { return !!(App.ws && App.ws.readyState === 1); },
  newId() { return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); },
  busy() { return !!((Calls.cur && !Calls.cur.done) || (Calls.vc && !Calls.vc.done)); },
  inVC(p) { return !!(Calls.vc && !Calls.vc.done && p && Calls.vc.chat === p.id); },
  async ice() {
    if (Calls.iceCache && Date.now() - Calls.iceAt < 600000) return Calls.iceCache;
    try { const d = await api("/api/ice", { timeout: 6000 }); if (d.iceServers && d.iceServers.length) { Calls.iceCache = d.iceServers; Calls.iceAt = Date.now(); } } catch (e) {}
    return Calls.iceCache || [{ urls: ["stun:stun.l.google.com:19302"] }];
  },
  fmt(s) { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); },
  supported() { return !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },

  async media(video) {
    if (!Calls.supported()) throw new Error(T("Звонки не поддерживаются на этом устройстве"));
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    const vid = { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } };
    try { return await navigator.mediaDevices.getUserMedia({ audio, video: video ? vid : false }); }
    catch (e) {
      const n = e && e.name;
      if (video && n !== "NotAllowedError" && n !== "SecurityError") {
        try { const s = await navigator.mediaDevices.getUserMedia({ audio, video: false }); toast(T("Камера недоступна — звонок без видео")); return s; } catch (e2) { e = e2; }
      }
      const nn = (e && e.name) || n;
      if (nn === "NotAllowedError" || nn === "SecurityError") throw new Error(T(video ? "Разрешите доступ к камере и микрофону" : "Разрешите доступ к микрофону"));
      if (nn === "NotFoundError" || nn === "OverconstrainedError") throw new Error(T("Микрофон не найден"));
      throw new Error(T("Не удалось включить микрофон"));
    }
  },
  // микрофон (и камера) → изменённый голос → поток для отправки
  async prep(o, video) {
    const raw = await Calls.media(video);
    if (o.done) { raw.getTracks().forEach((t) => t.stop()); return false; }
    o.raw = raw;
    o.fx = VoiceFX.process(raw);
    o.send = new MediaStream(o.fx.stream.getAudioTracks());
    const vt = raw.getVideoTracks()[0];
    if (vt) { o.send.addTrack(vt); o.vtrack = vt; o.camOn = true; }
    o.muted = false;
    return true;
  },
  release(o) {
    try { if (o.fx) o.fx.close(); } catch (e) {}
    try { if (o.raw) o.raw.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { if (o.vtrack) o.vtrack.stop(); } catch (e) {}
    o.fx = o.raw = o.send = o.vtrack = null; o.camOn = false;
  },
  keepAwake(on) {
    try {
      if (on && navigator.wakeLock && !Calls.wake) navigator.wakeLock.request("screen").then((w) => { Calls.wake = w; w.addEventListener("release", () => { Calls.wake = null; }); }).catch(() => {});
      else if (!on && Calls.wake) { Calls.wake.release(); Calls.wake = null; }
    } catch (e) {}
  },
  // звук собеседника: обычный <audio> (надёжно), «Динамик» добавляет усиление поверх
  playAudio(key, stream) {
    let a = Calls.audio.querySelector(`[data-k="${key}"]`);
    if (!a) { a = document.createElement("audio"); a.dataset.k = key; a.autoplay = true; a.setAttribute("playsinline", ""); Calls.audio.appendChild(a); }
    if (a.srcObject !== stream) a.srcObject = stream;
    const p = a.play(); if (p && p.catch) p.catch(() => {});
  },
  stopAudio(key) {
    const a = Calls.audio.querySelector(`[data-k="${key}"]`);
    if (a) { a.srcObject = null; a.remove(); }
  },
  setLoud(on) {
    Calls.loud = !!on;
    const o = Calls.cur || Calls.vc;
    const nodes = Calls.loudNodes || (Calls.loudNodes = {});
    Object.keys(nodes).forEach((k) => { try { nodes[k].src.disconnect(); nodes[k].g.disconnect(); } catch (e) {} delete nodes[k]; });
    if (!on || !o || !VoiceFX.supported()) return;
    try {
      const ctx = VoiceFX.context();
      const add = (k, s) => { if (!s || !s.getAudioTracks().length) return; const src = ctx.createMediaStreamSource(s), g = ctx.createGain(); g.gain.value = 1.4; src.connect(g); g.connect(ctx.destination); nodes[k] = { src, g }; };
      if (o === Calls.cur) add("c", o.remote); else Object.keys(o.users).forEach((id) => add(id, o.users[id].stream));
    } catch (e) {}
  },

  // ═════════════ ЗВОНОК «ОДИН НА ОДИН» ═════════════
  async start(peer, video) {
    if (!peer || peer.gk) return Calls.joinVC(peer);
    if (peer.is_system || peer.id <= 0 || peer.id === App.user.id) return;
    if (Calls.busy()) return toast(T("Сначала завершите текущий звонок"));
    if (!Calls.supported()) return toast(T("Звонки не поддерживаются на этом устройстве"));
    if (!Calls.online()) return toast(T("Нет связи с сервером"));
    try { VoiceFX.context(); } catch (e) {}                 // аудио нужно «разбудить» по нажатию пользователя
    const c = (Calls.cur = { id: Calls.newId(), peer, video: !!video, dir: "out", st: "calling", rvOn: !!video });
    Calls.show();
    try { if (!(await Calls.prep(c, !!video))) return; }
    catch (e) { toast(e.message); Calls.finish(c, "", true); return; }
    if (c.done) { Calls.release(c); return; }
    c.video = c.video && c.camOn;
    c.rvOn = c.video;
    if (!Calls.send({ type: "rtc", call: c.id, k: "invite", to: peer.id, v: c.video ? 1 : 0 })) { toast(T("Нет связи с сервером")); Calls.finish(c, "", true); return; }
    Ring.start("out");
    c.to = setTimeout(() => { if (c.st === "calling") Calls.finish(c, T("Нет связи"), false); }, 12000);
    Calls.paint();
  },

  onInvite(d) {
    const u = d.user || { id: d.from, name: "" };
    if (Calls.busy()) { Calls.send({ type: "rtc", call: d.call, k: "decline" }); return; }
    const c = (Calls.cur = { id: d.call, peer: u, video: !!d.v, dir: "in", st: "incoming", rvOn: !!d.v });
    try { VoiceFX.context(); } catch (e) {}
    Calls.show();
    Ring.start("in");
    c.to = setTimeout(() => { if (c.st === "incoming") Calls.finish(c, T("Пропущенный звонок"), false); }, 52000);
  },

  async accept() {
    const c = Calls.cur;
    if (!c || c.done || c.st !== "incoming") return;
    Ring.stop(); clearTimeout(c.to);
    c.st = "connecting"; c.answered = true; Calls.paint();
    try { if (!(await Calls.prep(c, c.video))) return; }
    catch (e) { toast(e.message); Calls.send({ type: "rtc", call: c.id, k: "decline" }); Calls.finish(c, "", true); return; }
    if (c.done) { Calls.release(c); return; }
    c.video = c.video && c.camOn;
    await Calls.link(c);
    if (c.done) return;
    Calls.send({ type: "rtc", call: c.id, k: "accept" });
    Calls.paint();
  },
  decline() {
    const c = Calls.cur; if (!c || c.done) return;
    Calls.send({ type: "rtc", call: c.id, k: "decline" });
    Calls.finish(c, "", true);
  },
  hangup(quiet) {
    const c = Calls.cur; if (!c || c.done) return;
    const k = c.answered ? "end" : c.dir === "out" ? "cancel" : "decline";
    Calls.send({ type: "rtc", call: c.id, k });
    Calls.finish(c, quiet ? "" : T("Звонок завершён"), !!quiet || !c.t0);
  },

  async link(c) {
    const ice = await Calls.ice();
    if (c.done) return;
    c.link = new Link({
      ice, initiator: c.dir === "out", polite: c.dir === "in", stream: c.send, vt: c.vtrack || null,
      send: (k, d) => Calls.send({ type: "rtc", call: c.id, k, d }),
      onTrack: (s) => { c.remote = s; if (s.getAudioTracks().length) Calls.playAudio("c", s); Calls.paint(); if (Calls.loud) Calls.setLoud(true); },
      onState: (st) => Calls.linkState(c, st),
    });
    (c.inq || []).forEach((m) => c.link.signal(m.k, m.d)); c.inq = [];
    Calls.sendFx();
  },
  linkState(c, st) {
    if (c.done) return;
    clearTimeout(c.fail);
    if (st === "connected") {
      if (!c.t0) { c.t0 = Date.now(); Ring.beep("on"); Calls.keepAwake(true); }
      c.st = "connected";
    } else if (st === "unstable" || st === "failed") {
      if (c.t0 || st === "failed") c.st = "reconnecting";
      c.fail = setTimeout(() => { if (!c.done && c.st !== "connected") { Calls.send({ type: "rtc", call: c.id, k: "end" }); Calls.finish(c, T("Связь потеряна"), false); } }, c.t0 ? 25000 : 18000);
    }
    Calls.paint();
  },
  sendFx() {
    const c = Calls.cur; if (!c || c.done || !c.fx || !c.fx.fx) return;
    Calls.send({ type: "rtc", call: c.id, k: "fx", d: { id: c.fx.id } });
  },

  onRTC(d) {
    if (d.k === "invite") return Calls.onInvite(d);
    const c = Calls.cur;
    if (!c || c.id !== d.call || c.done) return;
    switch (d.k) {
      case "ringing": if (c.st === "calling") { clearTimeout(c.to); c.st = "ringing"; Calls.paint(); } break;
      case "accept": if (c.dir === "out" && !c.answered) { c.answered = true; c.st = "connecting"; Ring.stop(); clearTimeout(c.to); Calls.paint(); Calls.link(c); } break;
      case "answered": if (c.dir === "in" && !c.answered) Calls.finish(c, "", true); break;
      case "gone": if (!c.answered) Calls.finish(c, "", true); break;
      case "decline": Calls.finish(c, T("Собеседник отклонил звонок"), false); break;
      case "cancel": Calls.finish(c, T("Пропущенный звонок"), false); break;
      case "busy": Calls.finish(c, T("Занято"), false); break;
      case "offline": Calls.finish(c, T("Собеседник не в сети"), false); break;
      case "unavailable": Calls.finish(c, T("Звонок недоступен"), false); break;
      case "denied": Calls.finish(c, T("Пользователь ограничил звонки"), false); break;
      case "timeout": Calls.finish(c, T(c.dir === "out" ? "Нет ответа" : "Пропущенный звонок"), false); break;
      case "end": Calls.finish(c, T("Звонок завершён"), false); break;
      case "sdp": case "ice": if (c.link) c.link.signal(d.k, d.d); else (c.inq || (c.inq = [])).push({ k: d.k, d: d.d }); break;
      case "video": c.rvOn = !!(d.d && d.d.on); Calls.paint(); break;
      case "mute": c.rMute = !!(d.d && d.d.on); Calls.paint(); break;
      case "fx": c.rFx = d.d && d.d.id; Calls.paint(); break;
    }
  },

  // закрыть звонок: показать итог на секунду-полторы и убрать окно
  finish(c, text, quiet) {
    if (!c || c.done) return;
    c.done = true;
    clearTimeout(c.to); clearTimeout(c.fail);
    Ring.stop();
    if (c.link) c.link.close();
    Calls.release(c);
    Calls.stopAudio("c"); Calls.setLoud(false);
    Calls.keepAwake(false);
    if (c.t0 && !quiet) Ring.beep("off");
    c.st = "ended"; c.endText = text;
    if (quiet || !text) { if (Calls.cur === c) Calls.cur = null; Calls.hideIfIdle(); return; }
    Calls.restore(); Calls.paint();
    setTimeout(() => { if (Calls.cur === c) { Calls.cur = null; Calls.hideIfIdle(); } }, 1700);
  },
  hideIfIdle() {
    if (Calls.cur || Calls.vc) return;
    Calls.el.classList.add("hidden"); Calls.pill.classList.add("hidden"); Calls.el.innerHTML = ""; Calls.built = "";
  },

  // ───────────── кнопки в звонке ─────────────
  setMute(o, on) {
    o.muted = on;
    [o.send, o.raw].forEach((s) => s && s.getAudioTracks().forEach((t) => { t.enabled = !on; }));
  },
  toggleMute() {
    const o = Calls.cur || Calls.vc; if (!o || o.done || !o.send) return;
    Calls.setMute(o, !o.muted);
    if (o === Calls.cur) Calls.send({ type: "rtc", call: o.id, k: "mute", d: { on: o.muted } });
    else { o.users[App.user.id].mute = o.muted; Calls.send({ type: "vc", op: "mute", chat: o.chat, on: o.muted }); }
    haptic(); Calls.paint();
  },
  async toggleCam() {
    const o = Calls.cur || Calls.vc; if (!o || o.done || !o.send) return;
    try {
      if (o.camOn) {
        const t = o.vtrack; o.camOn = false; o.vtrack = null;
        try { o.send.removeTrack(t); } catch (e) {} t.stop();
        Calls.eachLink(o, (l) => l.setVideo(null));
      } else {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: o.facing || "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } } });
        const t = s.getVideoTracks()[0];
        if (o.done) { t.stop(); return; }
        o.vtrack = t; o.camOn = true; o.send.addTrack(t);
        Calls.eachLink(o, (l) => l.setVideo(t));
      }
      if (o === Calls.cur) { o.video = o.video || o.camOn; Calls.send({ type: "rtc", call: o.id, k: "video", d: { on: o.camOn } }); }
      else { o.users[App.user.id].video = o.camOn; Calls.send({ type: "vc", op: "video", chat: o.chat, on: o.camOn }); }
    } catch (e) { toast(T("Разрешите доступ к камере")); }
    haptic(); Calls.paint();
  },
  async flip() {
    const o = Calls.cur || Calls.vc; if (!o || o.done || !o.camOn) return;
    try {
      o.facing = o.facing === "environment" ? "user" : "environment";
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: o.facing, width: { ideal: 640 }, height: { ideal: 480 } } });
      const t = s.getVideoTracks()[0], old = o.vtrack;
      try { o.send.removeTrack(old); } catch (e) {} old.stop();
      o.vtrack = t; o.send.addTrack(t);
      Calls.eachLink(o, (l) => l.setVideo(t));
    } catch (e) { toast(T("Не удалось переключить камеру")); }
    Calls.paint();
  },
  eachLink(o, fn) { if (o === Calls.cur) { if (o.link) fn(o.link); } else Object.keys(o.links).forEach((k) => fn(o.links[k])); },
  fxPanel() {
    const o = Calls.cur || Calls.vc; if (!o || !o.fx || !o.fx.fx) return toast(T("Изменение голоса не поддерживается на этом устройстве"));
    VoiceFX.panel(o.fx, { onChange: () => { if (o === Calls.cur) Calls.sendFx(); Calls.paint(); } });
  },

  // ═════════════ ВИДЕОЧАТ ГРУППЫ ═════════════
  async joinVC(peer) {
    if (!peer || !peer.gk) return;
    if (Calls.cur && !Calls.cur.done) return toast(T("Сначала завершите звонок"));
    if (Calls.vc && !Calls.vc.done) { if (Calls.vc.chat === peer.id) return Calls.restore(); return toast(T("Вы уже в другом видеочате")); }
    if (!Calls.supported()) return toast(T("Звонки не поддерживаются на этом устройстве"));
    if (!Calls.online()) return toast(T("Нет связи с сервером"));
    try { VoiceFX.context(); } catch (e) {}
    const v = (Calls.vc = { chat: peer.id, peer, st: "joining", users: {}, links: {}, tiles: {}, inq: {}, an: {} });
    Calls.show();
    try { if (!(await Calls.prep(v, false))) return; }
    catch (e) { toast(e.message); Calls.dropVC(v); return; }
    if (v.done) { Calls.release(v); return; }
    v.users[App.user.id] = { profile: App.user, mute: false, video: false, me: true };
    Calls.send({ type: "vc", op: "join", chat: peer.id, mute: false });
    v.to = setTimeout(() => { if (v.st === "joining") { toast(T("Не удалось подключиться к видеочату")); Calls.leaveVC(); } }, 12000);
  },
  dropVC(v) { v.done = true; clearTimeout(v.to); Calls.release(v); if (Calls.vc === v) Calls.vc = null; Calls.hideIfIdle(); },

  async vlink(v, uid, initiator) {
    if (v.links[uid] || v.done) return;
    const ice = await Calls.ice();
    if (v.done || v.links[uid]) return;
    v.links[uid] = new Link({
      ice, initiator, polite: App.user.id > uid, stream: v.send, vt: v.vtrack || null,
      send: (k, d) => Calls.send({ type: "vc", op: "sig", chat: v.chat, to: uid, d: { k, d } }),
      onTrack: (s) => Calls.vstream(v, uid, s),
      onState: () => Calls.paint(),
    });
    (v.inq[uid] || []).forEach((m) => v.links[uid].signal(m.k, m.d)); v.inq[uid] = [];
  },
  vstream(v, uid, s) {
    const u = v.users[uid]; if (!u || v.done) return;
    u.stream = s;
    if (s.getAudioTracks().length) {
      Calls.playAudio("v" + uid, s);
      if (!v.an[uid] && VoiceFX.supported()) {
        try { const ctx = VoiceFX.context(), src = ctx.createMediaStreamSource(s), an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an); v.an[uid] = { src, an, buf: new Uint8Array(512) }; } catch (e) {}
      }
    }
    Calls.paint();
  },
  vdrop(v, uid) {
    if (v.links[uid]) { v.links[uid].close(); delete v.links[uid]; }
    const a = v.an[uid]; if (a) { try { a.src.disconnect(); } catch (e) {} delete v.an[uid]; }
    Calls.stopAudio("v" + uid); delete v.users[uid]; delete v.inq[uid];
    const t = v.tiles[uid]; if (t) { t.remove(); delete v.tiles[uid]; }
  },

  onVC(d) {
    if (d.op === "info") {
      const c = Chats.byId(d.chat); if (c) c.peer.vc = d.n;
      if (Chat.peer && Chat.peer.id === d.chat) { Chat.peer.vc = d.n; try { Groups.syncBars(); } catch (e) {} }
      return;
    }
    const v = Calls.vc;
    if (!v || v.done || v.chat !== d.chat) return;
    switch (d.op) {
      case "denied": toast(T("Начать видеочат могут только администраторы")); Calls.dropVC(v); break;
      case "full": toast(T("В видеочате нет свободных мест")); Calls.dropVC(v); break;
      case "state": {
        clearTimeout(v.to); v.st = "on"; v.t0 = Date.now();
        const room = (d.room && d.room.users) || {};
        Object.keys(room).forEach((k) => {
          const id = +k; if (id === d.me) return;
          v.users[id] = { profile: (d.users && d.users[k]) || { id, name: "" }, mute: !!room[k].mute, video: !!room[k].video };
          Calls.vlink(v, id, true);
        });
        v.users[App.user.id] = Object.assign(v.users[App.user.id] || { profile: App.user, me: true }, { mute: !!v.muted });
        Ring.beep("on"); Calls.keepAwake(true); Calls.paint();
        break;
      }
      case "joined":
        if (d.user !== App.user.id) { v.users[d.user] = { profile: d.profile || { id: d.user, name: "" }, mute: false, video: false }; Calls.vlink(v, d.user, false); Calls.paint(); }
        break;
      case "left": Calls.vdrop(v, d.user); Calls.paint(); break;
      case "mute": case "video": { const u = v.users[d.user]; if (u) { u[d.op] = !!d.on; Calls.paint(); } break; }
      case "sig":
        if (d.d && d.d.k) { if (v.links[d.from]) v.links[d.from].signal(d.d.k, d.d.d); else (v.inq[d.from] || (v.inq[d.from] = [])).push({ k: d.d.k, d: d.d.d }); }
        break;
    }
  },
  leaveVC(quiet) {
    const v = Calls.vc; if (!v || v.done) return;
    v.done = true; clearTimeout(v.to);
    Calls.send({ type: "vc", op: "leave", chat: v.chat });
    Object.keys(v.links).forEach((k) => v.links[k].close());
    Object.keys(v.an).forEach((k) => { try { v.an[k].src.disconnect(); } catch (e) {} });
    Object.keys(v.users).forEach((k) => Calls.stopAudio("v" + k));
    Calls.release(v); Calls.setLoud(false); Calls.keepAwake(false);
    if (v.st === "on" && !quiet) Ring.beep("off");
    Calls.vc = null; Calls.hideIfIdle();
  },

  // ═════════════ ПОСТОЯННЫЙ ТАЙМЕР ═════════════
  tick() {
    const c = Calls.cur, v = Calls.vc;
    if ((!c || c.done) && (!v || v.done)) return;
    const t = c && c.t0 ? c.t0 : v && v.t0;
    if (t) { const s = Calls.fmt((Date.now() - t) / 1000); Calls.el.querySelectorAll("[data-time]").forEach((e) => { e.textContent = s; }); Calls.paintPill(s); }
    if (v && !v.done) {
      // связь с сервером пропала и вернулась — заходим в комнату заново
      if (!Calls.online()) v.down = v.down || Date.now();
      else if (v.down) {
        const was = Date.now() - v.down; v.down = 0;
        if (was > 60000) { toast(T("Связь потеряна")); Calls.leaveVC(); return; }
        Object.keys(v.links).forEach((k) => Calls.vdrop(v, +k));
        v.users = { [App.user.id]: v.users[App.user.id] }; v.st = "joining";
        Calls.send({ type: "vc", op: "join", chat: v.chat, mute: !!v.muted });
      }
    }
  },
  levels() {
    const v = Calls.vc; if (!v || v.done) return;
    Object.keys(v.users).forEach((id) => {
      const u = v.users[id], tile = v.tiles[id]; if (!tile) return;
      let lv = 0;
      if (u.me) lv = v.fx && !v.muted ? v.fx.level() : 0;
      else { const a = v.an[id]; if (a) { try { a.an.getByteTimeDomainData(a.buf); let s = 0; for (let i = 0; i < a.buf.length; i++) { const x = (a.buf[i] - 128) / 128; s += x * x; } lv = Math.sqrt(s / a.buf.length); } catch (e) {} } }
      tile.classList.toggle("sp", lv > 0.035 && !u.mute);
    });
  },

  // ═════════════ ЭКРАН ═════════════
  show() { Calls.el.classList.remove("hidden"); Calls.pill.classList.add("hidden"); const o = Calls.cur || Calls.vc; if (o) o.min = false; Calls.built = ""; Calls.paint(); },
  restore() { const o = Calls.cur || Calls.vc; if (!o) return; o.min = false; Calls.el.classList.remove("hidden"); Calls.pill.classList.add("hidden"); Calls.built = ""; Calls.paint(); },
  minimize() {
    const o = Calls.cur || Calls.vc; if (!o || o.done || o.st === "incoming") return;
    o.min = true; Calls.el.classList.add("hidden"); Calls.paintPill();
  },
  paintPill(time) {
    const o = Calls.cur || Calls.vc;
    if (!o || !o.min || o.done) { Calls.pill.classList.add("hidden"); return; }
    const t = time || (o.t0 ? Calls.fmt((Date.now() - o.t0) / 1000) : "");
    const name = o === Calls.cur ? dispName(o.peer) : T("Видеочат");
    Calls.pill.classList.remove("hidden");
    Calls.pill.innerHTML = `<i class="cp-dot"></i><span class="cp-t">${esc(name)}</span><span class="cp-s" data-time>${esc(t || Calls.status(o))}</span>`;
  },
  status(o) {
    if (o === Calls.vc) return o.st === "on" ? "" : T("Подключение…");
    if (o.st === "ended") return o.endText || T("Звонок завершён");
    if (o.st === "incoming") return T(o.video ? "Входящий видеозвонок" : "Входящий звонок");
    if (o.st === "calling") return T("Вызов…");
    if (o.st === "ringing") return T("Звонок…");
    if (o.st === "connecting") return T("Соединение…");
    if (o.st === "reconnecting") return T("Переподключение…");
    return o.t0 ? Calls.fmt((Date.now() - o.t0) / 1000) : T("Соединение…");
  },

  paint() {
    const o = Calls.cur || Calls.vc;
    if (!o) return;
    if (o.min) return Calls.paintPill();
    if (o === Calls.cur) Calls.paint1(o); else Calls.paintV(o);
  },
  btn(a, ic, label, cls, on) { return `<button class="cu-b ${cls || ""}${on ? " on" : ""}" data-a="${a}"><span class="cu-bi">${ic}</span><span class="cu-bl">${esc(label)}</span></button>`; },

  paint1(c) {
    const el = Calls.el, key = "1:" + c.id;
    if (Calls.built !== key) {
      Calls.built = key;
      el.innerHTML = `<div class="cu-bg"><i></i><i></i><i></i></div>
        <video class="cu-remote" autoplay playsinline muted></video><div class="cu-shade"></div>
        <div class="cu-top"><button class="cu-ib" data-a="min" aria-label="${esc(T("Свернуть"))}">${CUI.down}</button>
          <div class="cu-mini"><b data-n></b><span data-time></span></div>
          <button class="cu-ib" data-a="fx" aria-label="${esc(T("Голос"))}">${CUI.fx}</button></div>
        <div class="cu-mid"><div class="cu-av" data-av></div><h2 class="cu-name" data-n></h2><div class="cu-status" data-s></div><div class="cu-tag" data-tag></div></div>
        <div class="cu-lw" data-lw><video class="cu-local" autoplay playsinline muted></video></div>
        <div class="cu-btns" data-btns></div>`;
      el.querySelector("[data-av]").innerHTML = `<span class="cu-pulse"></span><span class="cu-pulse p2"></span>${avatar(c.peer, "xl")}`;
      el.querySelectorAll("[data-n]").forEach((e) => { e.innerHTML = nameHTML(c.peer); });
      Calls.sig = "";
    }
    const ended = c.st === "ended", live = c.st === "connected" || c.st === "reconnecting";
    const rv = !!(c.rvOn && c.remote && c.remote.getVideoTracks().some((t) => t.readyState === "live")) && !ended;
    el.className = "callui call st-" + c.st + (rv ? " rv" : "") + (c.camOn && !ended ? " lv" : "") + (c.video || c.camOn || rv ? " vid" : "");
    el.querySelector("[data-s]").textContent = Calls.status(c);
    const time = el.querySelector(".cu-mini [data-time]"); if (time && !c.t0) time.textContent = "";
    const tag = [];
    if (c.rFx && c.rFx !== "normal") tag.push(VoiceFX.label(c.rFx));
    if (c.rMute) tag.push("🔇 " + T("микрофон выключен"));
    el.querySelector("[data-tag]").textContent = tag.join(" · ");
    el.querySelector("[data-tag]").classList.toggle("hide", !tag.length || ended);
    el.querySelector('[data-a="fx"]').classList.toggle("hidden", !(c.fx && c.fx.fx) || c.st === "incoming" || ended);
    el.querySelector('[data-a="min"]').classList.toggle("hidden", c.st === "incoming" || ended);
    const rvEl = el.querySelector(".cu-remote");
    if (rv) { if (rvEl.srcObject !== c.remote) rvEl.srcObject = c.remote; const p = rvEl.play(); if (p && p.catch) p.catch(() => {}); } else if (rvEl.srcObject) rvEl.srcObject = null;
    const lv = el.querySelector(".cu-local");
    if (c.camOn && c.vtrack) { if (!lv.srcObject || lv.srcObject.getVideoTracks()[0] !== c.vtrack) lv.srcObject = new MediaStream([c.vtrack]); const p = lv.play(); if (p && p.catch) p.catch(() => {}); } else if (lv.srcObject) lv.srcObject = null;
    lv.classList.toggle("mirror", c.facing !== "environment");
    // кнопки
    let sig, html;
    if (c.st === "incoming") {
      sig = "in:" + c.video;
      html = Calls.btn("decline", CUI.end, T("Отклонить"), "red end") + Calls.btn("accept", c.video ? CUI.vid : CUI.end, T("Ответить"), "green acc");
    } else if (ended) { sig = "ended"; html = ""; }
    else {
      sig = ["a", c.camOn, c.muted, Calls.loud, rv || c.camOn].join();
      html = Calls.btn("spk", CUI.spk, T("Динамик"), "", Calls.loud) +
        Calls.btn("cam", c.camOn ? CUI.vid : CUI.vidOff, T(c.camOn ? "Выкл. видео" : "Вкл. видео"), "", c.camOn) +
        (c.camOn ? Calls.btn("flip", CUI.flip, T("Камера"), "") : "") +
        Calls.btn("mute", c.muted ? CUI.micOff : CUI.mic, T(c.muted ? "Вкл. звук" : "Выкл. звук"), "", c.muted) +
        Calls.btn("end", CUI.end, T("Завершить"), "red end");
    }
    if (sig !== Calls.sig) { Calls.sig = sig; el.querySelector("[data-btns]").innerHTML = html; }
  },

  paintV(v) {
    const el = Calls.el, key = "v:" + v.chat;
    if (Calls.built !== key) {
      Calls.built = key;
      el.innerHTML = `<div class="cu-bg"><i></i><i></i><i></i></div>
        <div class="cu-top"><button class="cu-ib" data-a="min" aria-label="${esc(T("Свернуть"))}">${CUI.down}</button>
          <div class="cu-mini vc"><b>${esc(v.peer.name || "")}</b><span data-vs></span></div>
          <button class="cu-ib" data-a="fx" aria-label="${esc(T("Голос"))}">${CUI.fx}</button></div>
        <div class="vcu-grid" data-grid></div>
        <div class="cu-btns vcb" data-btns></div>`;
      v.tiles = {}; Calls.sig = "";
    }
    el.className = "callui vcui st-" + (v.st === "on" ? "connected" : "connecting");
    const ids = Object.keys(v.users).map(Number).sort((a, b) => (a === App.user.id ? -1 : b === App.user.id ? 1 : a - b));
    const n = ids.length;
    el.querySelector("[data-vs]").innerHTML = v.st === "on" ? `${n} ${esc(plural(n, T("участник"), T("участника"), T("участников")))} · <i data-time>${v.t0 ? Calls.fmt((Date.now() - v.t0) / 1000) : ""}</i>` : esc(T("Подключение…"));
    el.querySelector('[data-a="fx"]').classList.toggle("hidden", !(v.fx && v.fx.fx));
    const grid = el.querySelector("[data-grid]");
    grid.className = "vcu-grid n" + Math.min(n, 9);
    ids.forEach((id) => {
      const u = v.users[id];
      let t = v.tiles[id];
      if (!t) {
        t = v.tiles[id] = document.createElement("div");
        t.className = "vt"; t.dataset.u = id;
        t.innerHTML = `<video autoplay playsinline muted></video><div class="vt-av">${avatar(u.profile, "xl")}</div><div class="vt-n"><span class="vt-mic">${CUI.micOffS}</span><span class="vt-nm">${nameHTML(u.profile)}${u.me ? " (" + esc(T("вы")) + ")" : ""}</span></div>`;
        grid.appendChild(t);
      }
      t.classList.toggle("mu", !!u.mute);
      const vid = t.querySelector("video");
      let st = null;
      if (u.me) st = v.camOn && v.vtrack ? new MediaStream([v.vtrack]) : null;
      else if (u.video && u.stream && u.stream.getVideoTracks().some((x) => x.readyState === "live")) st = u.stream;
      const has = !!st;
      t.classList.toggle("hv", has);
      if (has) {
        const cur = vid.srcObject;
        if (!cur || (u.me ? cur.getVideoTracks()[0] !== v.vtrack : cur !== st)) vid.srcObject = st;
        vid.classList.toggle("mirror", u.me && v.facing !== "environment");
        const p = vid.play(); if (p && p.catch) p.catch(() => {});
      } else if (vid.srcObject) vid.srcObject = null;
    });
    const sig = ["v", v.camOn, v.muted, Calls.loud].join();
    if (sig !== Calls.sig) {
      Calls.sig = sig;
      el.querySelector("[data-btns]").innerHTML = Calls.btn("spk", CUI.spk, T("Динамик"), "", Calls.loud) + Calls.btn("cam", v.camOn ? CUI.vid : CUI.vidOff, T(v.camOn ? "Выкл. видео" : "Вкл. видео"), "", v.camOn) +
        `<button class="cu-b mic${v.muted ? " off" : ""}" data-a="mute"><span class="cu-bi big">${v.muted ? CUI.micOff : CUI.mic}</span><span class="cu-bl">${esc(T(v.muted ? "Включить микрофон" : "Микрофон включён"))}</span></button>` +
        (v.camOn ? Calls.btn("flip", CUI.flip, T("Камера"), "") : "") + Calls.btn("leave", CUI.end, T("Выйти"), "red end");
    }
  },

  click(e) {
    const b = e.target.closest("[data-a]");
    if (!b) {
      const o = Calls.cur;
      if (o && o.rvOn && !o.done && e.target.closest(".cu-remote, .cu-shade")) Calls.el.classList.toggle("bare");
      return;
    }
    const a = b.dataset.a;
    if (a === "min") return Calls.minimize();
    if (a === "accept") return Calls.accept();
    if (a === "decline") return Calls.decline();
    if (a === "end") return Calls.hangup();
    if (a === "leave") return Calls.leaveVC();
    if (a === "mute") return Calls.toggleMute();
    if (a === "cam") return Calls.toggleCam();
    if (a === "flip") return Calls.flip();
    if (a === "fx") return Calls.fxPanel();
    if (a === "spk") { Calls.setLoud(!Calls.loud); haptic(); Calls.sig = ""; return Calls.paint(); }
  },

  // маленькое окно с собой можно перетаскивать
  drag() {
    let d = null;
    Calls.el.addEventListener("pointerdown", (e) => {
      const w = e.target.closest("[data-lw]"); if (!w) return;
      const r = w.getBoundingClientRect(); d = { w, dx: e.clientX - r.left, dy: e.clientY - r.top };
      try { w.setPointerCapture(e.pointerId); } catch (er) {}
    });
    Calls.el.addEventListener("pointermove", (e) => {
      if (!d) return;
      const W = innerWidth, H = innerHeight, r = d.w.getBoundingClientRect();
      const x = Math.max(8, Math.min(W - r.width - 8, e.clientX - d.dx)), y = Math.max(70, Math.min(H - r.height - 150, e.clientY - d.dy));
      d.w.style.left = x + "px"; d.w.style.top = y + "px"; d.w.style.right = "auto"; d.w.style.bottom = "auto";
    });
    const up = () => { d = null; };
    Calls.el.addEventListener("pointerup", up); Calls.el.addEventListener("pointercancel", up);
  },
};

setInterval(() => { try { Calls.levels(); } catch (e) {} }, 140);
