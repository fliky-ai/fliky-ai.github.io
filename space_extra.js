// space_extra.js — DICEGRAM SPACE: голос (WebRTC между участниками), мини-игры, «О пространстве», участники и роли, добавление трека.

// ───────────── голосовое соединение с одним участником (аудио, «идеальное согласование» как в звонках) ─────────────
class SpPeer {
  constructor(o) {
    this.o = o; this.closed = false; this.makingOffer = false; this.ignoreOffer = false; this.ready = !!o.initiator;
    this.chain = Promise.resolve(); this.fails = 0; this.st = "new";
    const pc = (this.pc = new RTCPeerConnection({ iceServers: o.ice, bundlePolicy: "max-bundle" }));
    this.tr = pc.addTransceiver("audio", { direction: "sendrecv" });          // слушать можно и без микрофона
    if (o.track) this.tr.sender.replaceTrack(o.track).catch(() => {});
    pc.onicecandidate = (e) => { if (e.candidate && !this.closed) o.send("ice", e.candidate.toJSON ? e.candidate.toJSON() : e.candidate); };
    pc.ontrack = (e) => { const s = (e.streams && e.streams[0]) || new MediaStream([e.track]); if (o.onTrack) o.onTrack(s); };
    pc.onnegotiationneeded = async () => {
      if (!this.ready || this.closed) return;
      try {
        this.makingOffer = true;
        await pc.setLocalDescription(await pc.createOffer());
        if (!this.closed) o.send("sdp", { type: pc.localDescription.type, sdp: pc.localDescription.sdp });
      } catch (e) { console.warn("sp offer", e); } finally { this.makingOffer = false; }
    };
    pc.onconnectionstatechange = pc.oniceconnectionstatechange = () => this.state();
  }
  signal(k, d) { this.chain = this.chain.then(() => this.apply(k, d)).catch((e) => console.warn("sp rtc", e)); }
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
      try { await pc.addIceCandidate(d); } catch (e) { if (!this.ignoreOffer) console.warn("sp ice", e); }
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
    this.st = st;
  }
  setTrack(t) { try { this.tr.sender.replaceTrack(t || null).catch(() => {}); } catch (e) {} }
  close() {
    this.closed = true;
    try { this.pc.onicecandidate = this.pc.ontrack = this.pc.onnegotiationneeded = this.pc.onconnectionstatechange = this.pc.oniceconnectionstatechange = null; this.pc.close(); } catch (e) {}
  }
}

const SpVoice = {
  on: false, mic: false, stream: null, track: null, peers: {}, inq: {}, an: null, anT: 0, speaking: false,
  me() { const R = SpaceRoom.R; return R && R.users[App.user.id]; },
  // нажали большую кнопку: сначала входим в голос (слушаем), потом включаем и выключаем микрофон
  async tap() {
    const R = SpaceRoom.R; if (!R) return;
    if (!Calls.supported()) return toast(T("Голос не поддерживается на этом устройстве"));
    if (!SpVoice.on) return SpVoice.join();
    if (!SpaceRoom.can("voice")) return toast(R.info.muted ? T("Модератор отключил вам микрофон") : T("Говорить здесь могут не все — вы слушаете"));
    return SpVoice.setMic(!SpVoice.mic);
  },
  join() {
    const R = SpaceRoom.R; if (!R) return;
    if (!Calls.send({ type: "sp", op: "voice", space: R.id, on: true })) return toast(T("Нет связи с сервером"));
    SpVoice.on = true;
    try { VoiceFX.context(); } catch (e) {}
    try { Calls.keepAwake(true); } catch (e) {}
    const me = SpVoice.me(); if (me) me.voice = true;
    SpaceRoom.paintDock(); SpaceRoom.paintPeople();
    if (SpaceRoom.can("voice")) toast(T("Вы в голосовом чате. Нажмите ещё раз, чтобы включить микрофон. Лучше в наушниках."));
    else toast(T("Вы слушаете голосовой чат"));
  },
  onState(d) { if (!SpVoice.on) return; (d.users || []).forEach((uid) => SpVoice.peer(uid, true)); },
  onJoined(uid) { if (SpVoice.on && uid !== App.user.id) SpVoice.peer(uid, false); },
  async peer(uid, initiator) {
    const R = SpaceRoom.R;
    if (!SpVoice.on || !R || SpVoice.peers[uid] || uid === App.user.id) return;
    const ice = await Calls.ice();
    if (!SpVoice.on || SpaceRoom.R !== R || SpVoice.peers[uid]) return;
    const p = (SpVoice.peers[uid] = new SpPeer({
      ice, initiator, polite: App.user.id > uid, track: SpVoice.mic || SpVoice.track ? SpVoice.track : null,
      send: (k, d) => Calls.send({ type: "sp", op: "sig", space: R.id, to: uid, d: { k, d } }),
      onTrack: (s) => { try { Calls.playAudio("sp" + uid, s); } catch (e) {} },
    }));
    (SpVoice.inq[uid] || []).forEach((m) => p.signal(m.k, m.d)); SpVoice.inq[uid] = [];
  },
  onSig(d) {
    if (!SpVoice.on || !d.d || !d.d.k) return;
    const p = SpVoice.peers[d.from];
    if (p) p.signal(d.d.k, d.d.d); else (SpVoice.inq[d.from] || (SpVoice.inq[d.from] = [])).push({ k: d.d.k, d: d.d.d });
  },
  drop(uid) {
    const p = SpVoice.peers[uid]; if (p) { p.close(); delete SpVoice.peers[uid]; }
    delete SpVoice.inq[uid];
    try { Calls.stopAudio("sp" + uid); } catch (e) {}
  },
  onDenied(d) {
    SpVoice.mic = false; if (SpVoice.track) SpVoice.track.enabled = false;
    toast(d.why === "mute" ? T("Модератор отключил вам микрофон") : T("Говорить в этой комнате могут не все"));
    SpaceRoom.paintDock();
  },
  async setMic(on, quiet) {
    const R = SpaceRoom.R;
    if (on) {
      if (!SpVoice.on || !R) return;
      if (!SpVoice.track) {
        try {
          const s = await Calls.media(false);
          if (!SpVoice.on || SpaceRoom.R !== R) { s.getTracks().forEach((t) => t.stop()); return; }
          SpVoice.stream = s; SpVoice.track = s.getAudioTracks()[0];
          Object.values(SpVoice.peers).forEach((p) => p.setTrack(SpVoice.track));
          SpVoice.analyse(s);
        } catch (e) { return toast((e && e.message) || T("Нет доступа к микрофону")); }
      }
      SpVoice.track.enabled = true; SpVoice.mic = true;
    } else {
      if (!SpVoice.mic && !SpVoice.track) return;
      SpVoice.mic = false; if (SpVoice.track) SpVoice.track.enabled = false;
      if (SpVoice.speaking) { SpVoice.speaking = false; if (R) Calls.send({ type: "sp", op: "speak", space: R.id, on: false }); }
    }
    if (!R) return;
    const me = SpVoice.me(); if (me) { me.mic = SpVoice.mic; if (!SpVoice.mic) me.speak = false; }
    Calls.send({ type: "sp", op: "mic", space: R.id, on: SpVoice.mic });
    SpaceRoom.paintDock(); SpaceRoom.paintPeople();
  },
  // «кто сейчас говорит»: громкость своего микрофона; изменение отправляем остальным
  analyse(stream) {
    try {
      const ctx = typeof VoiceFX !== "undefined" && VoiceFX.supported && VoiceFX.supported() ? VoiceFX.context() : new (window.AudioContext || window.webkitAudioContext)();
      try { ctx.resume(); } catch (e) {}
      const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an);
      SpVoice.an = { src, an, buf: new Uint8Array(2048) };
      let hold = 0;
      clearInterval(SpVoice.anT);
      SpVoice.anT = setInterval(() => {
        const R = SpaceRoom.R, a = SpVoice.an; if (!R || !a) return;
        a.an.getByteTimeDomainData(a.buf);
        let s = 0; for (let i = 0; i < a.buf.length; i++) { const v = (a.buf[i] - 128) / 128; s += v * v; }
        const rms = Math.sqrt(s / a.buf.length);
        if (SpVoice.mic && rms > 0.035) hold = 12; else if (hold > 0) hold--;
        const sp = hold > 0 && SpVoice.mic;
        if (sp !== SpVoice.speaking) {
          SpVoice.speaking = sp;
          Calls.send({ type: "sp", op: "speak", space: R.id, on: sp });
          const me = SpVoice.me(); if (me) { me.speak = sp; SpaceRoom.paintSpeak(App.user.id); const b = document.querySelector(".spd-mic"); if (b) b.classList.toggle("speak", sp); }
        }
      }, 50);
    } catch (e) {}
  },
  leave(silent, R) {
    R = R || SpaceRoom.R;
    const was = SpVoice.on;
    Object.keys(SpVoice.peers).forEach((u) => SpVoice.drop(+u));
    SpVoice.on = false; SpVoice.mic = false; SpVoice.speaking = false;
    clearInterval(SpVoice.anT); SpVoice.anT = 0;
    if (SpVoice.an) { try { SpVoice.an.src.disconnect(); } catch (e) {} SpVoice.an = null; }
    if (SpVoice.stream) { try { SpVoice.stream.getTracks().forEach((t) => t.stop()); } catch (e) {} }
    SpVoice.stream = null; SpVoice.track = null; SpVoice.inq = {};
    if (was && R && !silent) Calls.send({ type: "sp", op: "voice", space: R.id, on: false });
    const me = R && R.users && R.users[App.user.id]; if (me) { me.voice = false; me.mic = false; me.speak = false; }
    if (SpaceRoom.R) { SpaceRoom.paintDock(); SpaceRoom.paintPeople(); }
  },
};

const SpaceExtra = {
  // ───────────── после создания ─────────────
  async welcome() {
    const R = SpaceRoom.R; if (!R) return;
    const link = R.info.plink || R.info.ilink || "";
    const v = await UI.sheet({ title: T("Пространство создано"), icon: SPI.cube,
      text: T("Уникальный ID: {0}.", spId(R.info.pubid)) + (link ? "\n" + link : ""),
      actions: [{ label: T("Пригласить людей"), value: "inv", accent: true }].concat(link ? [{ label: T("Скопировать ссылку"), value: "copy" }] : []), cancel: T("Готово") });
    if (v === "copy") { copyText(link); toast(T("Ссылка скопирована")); }
    if (v === "inv") SpaceExtra.invite();
  },

  // ───────────── меню ⋮ ─────────────
  async menu() {
    const R = SpaceRoom.R; if (!R) return;
    const a = [{ label: T("О пространстве"), value: "info" }, { label: T("Все участники"), value: "mem" }];
    if (SpaceRoom.can("invite")) a.push({ label: T("Пригласить людей"), value: "inv" });
    const link = R.info.plink || R.info.ilink;
    if (link) a.push({ label: T("Скопировать ссылку"), value: "copy" });
    if (SpaceRoom.can("tracks")) a.push({ label: T("Добавить музыку или видео"), value: "add" });
    if (R.role !== "owner") a.push({ label: T("Покинуть пространство"), value: "leave", danger: true });
    const v = await UI.sheet({ actions: a, cancel: T("Закрыть") });
    if (v === "info") return SpaceExtra.info();
    if (v === "mem") return SpaceExtra.members();
    if (v === "inv") return SpaceExtra.invite();
    if (v === "add") return SpaceExtra.addTrack();
    if (v === "copy") { copyText(link); return toast(T("Ссылка скопирована")); }
    if (v === "leave") return SpaceExtra.leaveSpace();
  },
  async leaveSpace() {
    const R = SpaceRoom.R; if (!R) return;
    const v = await UI.sheet({ title: T("Покинуть «{0}»?", R.info.title), text: T("Пространство останется, но вы перестанете быть его участником."), actions: [{ label: T("Покинуть"), value: 1, danger: true }], cancel: T("Отмена") });
    if (!v) return;
    try { await api("/api/spaces/" + R.id + "/leave", { method: "POST", body: {} }); Space.remove(R.id); SpaceRoom.closeFor(T("Вы покинули пространство")); } catch (e) { toast(e.message); }
  },
  async invite() {
    const R = SpaceRoom.R; if (!R) return;
    const link = R.info.ilink || R.info.plink || "";
    const v = await UI.sheet({ title: T("Пригласить"), text: link, actions: [{ label: T("Выбрать из контактов"), value: "pick", accent: true }, { label: T("Скопировать ссылку"), value: "copy" }], cancel: T("Закрыть") });
    if (v === "copy") { copyText(link); return toast(T("Ссылка скопирована")); }
    if (v !== "pick") return;
    let members = [];
    try { members = ((await api("/api/spaces/" + R.id + "/members")).members || []).map((m) => m.user.id); } catch (e) {}
    const ids = await Space.pickPeople([], T("Пригласить людей"), members);
    if (!ids || !ids.length) return;
    try { const d = await api("/api/spaces/" + R.id + "/add", { method: "POST", body: { users: ids } }); toast(d.added.length ? T("Приглашено: {0}", d.added.length) : T("Никого не удалось добавить")); } catch (e) { toast(e.message); }
  },

  // ───────────── страница «О пространстве» (администраторы здесь же всё настраивают) ─────────────
  info() {
    const R = SpaceRoom.R; if (!R || $("spinfo")) return;
    const el = document.createElement("section");
    el.id = "spinfo"; el.className = "page tgp sp-page sp-info"; el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    const st = { title: R.info.title, about: R.info.about || "", pub: R.info.kind === "public", slug: R.info.slug || "", photo: undefined, busy: false };
    const edit = SpaceRoom.can("edit"), SLUG = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
    const draw = () => {
      const I = R.info, link = I.plink || I.ilink || "";
      const perms = Object.keys(SP_PERM_NAMES).map((k) => `<button class="nm-act cc-row sp-perm" data-perm="${k}" type="button" ${edit ? "" : "disabled"}><span>${esc(T(SP_PERM_NAMES[k]))}</span><em>${esc(spOptName((I.perms || {})[k] || "member"))}</em></button>`).join("");
      el.innerHTML = `<header class="tg-head"><button class="icon-btn" data-back aria-label="${esc(T("Назад"))}">${SPI.back}</button><div class="tg-title">${esc(T("О пространстве"))}</div>${edit ? `<button class="icon-btn spi-save" data-save type="button" aria-label="${esc(T("Сохранить"))}">${SPI.check}</button>` : ""}</header>
        <div class="nm-body cc-body">
          <div class="spi-top"><button class="spi-av" data-photo type="button" ${edit ? "" : "disabled"}>${st.photo ? `<img src="${st.photo}" alt="">` : spAvatar(I, "xl")}${edit ? `<i>${SPI.cam}</i>` : ""}</button>
            ${edit ? `<input class="spi-name" id="spi-t" maxlength="48" value="${esc(st.title)}" autocomplete="off" aria-label="${esc(T("Название"))}">` : `<h2>${esc(I.title)}</h2>`}
            <div class="spi-chips"><span>${I.kind === "public" ? SPI.globe : SPI.lock}${esc(T(I.kind === "public" ? "Публичное" : "Приватное"))}</span><span>${SPI.users}${esc(T("{0} участн.", I.n))}</span></div></div>
          <button class="nm-act cc-row spi-id" data-copyid type="button"><span>${esc(T("Уникальный ID"))}</span><em>${esc(spId(I.pubid))}</em></button>
          ${edit ? `<div class="cc-about"><textarea id="spi-a" rows="2" maxlength="255" placeholder="${esc(T("Описание (необязательно)"))}">${esc(st.about)}</textarea></div>` : (I.about ? `<div class="spi-about">${esc(I.about)}</div>` : "")}
          ${edit ? `<div class="cc-seg" role="tablist"><button class="${st.pub ? "" : "on"}" data-pub="0" role="tab">${esc(T("Приватное"))}</button><button class="${st.pub ? "on" : ""}" data-pub="1" role="tab">${esc(T("Публичное"))}</button></div>
          <div class="cc-pubbox" ${st.pub ? "" : "hidden"}><label class="cc-lnk"><span>${esc(Links.BASE.replace(/^https?:\/\//, ""))}/</span><input id="spi-s" maxlength="32" value="${esc(st.slug)}" placeholder="username" autocomplete="off" autocapitalize="off" spellcheck="false"></label></div>` : ""}
          ${link ? `<button class="nm-act cc-row" data-copy type="button">${SPI.link}<span class="spi-link">${esc(link.replace(/^https?:\/\//, ""))}</span><em>${esc(T("Копировать"))}</em></button>` : ""}
          ${edit && I.ilink ? `<button class="nm-act cc-row" data-rot type="button"><span>${esc(T("Новая ссылка-приглашение"))}</span><em>${esc(T("Старая перестанет работать"))}</em></button>` : ""}
          <div class="sp-sec">${esc(T("Участники"))}</div>
          <button class="nm-act cc-row" data-mem type="button">${SPI.users}<span>${esc(T("Все участники"))}</span><em>${I.n}</em></button>
          ${SpaceRoom.can("invite") ? `<button class="nm-act cc-row" data-inv type="button">${SPI.plus}<span>${esc(T("Пригласить людей"))}</span></button>` : ""}
          ${SpaceRoom.can("ban") ? `<button class="nm-act cc-row" data-bans type="button"><span>${esc(T("Заблокированные"))}</span></button>` : ""}
          <div class="sp-sec">${esc(T("Музыка"))}</div>
          <button class="nm-act cc-row sp-av" data-autovote type="button" ${edit ? "" : "disabled"}><span>${esc(T("Голосование за следующую песню"))}<small class="sp-sub">${esc(T("Когда играет трек, участники сами выбирают, что дальше"))}</small></span><em>${esc(T(I.autovote ? "Вкл" : "Выкл"))}</em></button>
          <div class="sp-sec">${esc(T("Настройки доступа"))}</div>${perms}
          ${edit ? "" : `<div class="cc-hint">${esc(T("Настройки доступа меняют администраторы и владелец."))}</div>`}
          <div class="sp-sec">${esc(T("Ваша роль"))}: ${esc(SpaceRoom.roleName(R.role))}</div>
          ${R.role === "owner" ? `<button class="nm-act cc-row danger" data-del type="button"><span>${esc(T("Удалить пространство"))}</span></button>` : `<button class="nm-act cc-row danger" data-leave type="button"><span>${esc(T("Покинуть пространство"))}</span></button>`}
        </div>`;
    };
    draw();
    void el.offsetWidth;
    Nav.open("spinfo", () => setTimeout(() => el.remove(), 320));
    const pend = () => {                         // что изменено: отправим одним запросом
      const b = {}, I = R.info;
      if (st.title.trim() && st.title.trim() !== I.title) b.title = st.title.trim();
      if (st.about.trim() !== (I.about || "")) b.about = st.about.trim();
      const k = st.pub ? "public" : "private";
      if (k !== I.kind) b.kind = k;
      if (st.pub && st.slug !== (I.slug || "")) b.slug = st.slug;
      if (st.photo) b.photo = st.photo;
      return b;
    };
    el.addEventListener("input", (e) => {
      if (e.target.id === "spi-t") st.title = e.target.value;
      else if (e.target.id === "spi-a") st.about = e.target.value;
      else if (e.target.id === "spi-s") { e.target.value = e.target.value.replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 32); st.slug = e.target.value; }
    });
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-back]")) return Nav.back();
      const I = R.info;
      const pb = e.target.closest("[data-pub]");
      if (pb && edit) { st.pub = pb.dataset.pub === "1"; el.querySelectorAll("[data-pub]").forEach((b) => b.classList.toggle("on", b === pb)); el.querySelector(".cc-pubbox").hidden = !st.pub; return; }
      if (e.target.closest("[data-photo]") && edit) {
        const data = await CreateChat.pickPhoto(T("Аватар пространства")); if (!data) return;
        st.photo = data; el.querySelector(".spi-av").innerHTML = `<img src="${data}" alt=""><i>${SPI.cam}</i>`; return;
      }
      if (e.target.closest("[data-copyid]")) { copyText(String(I.pubid)); return toast(T("ID скопирован")); }
      if (e.target.closest("[data-copy]")) { copyText(I.plink || I.ilink); return toast(T("Ссылка скопирована")); }
      if (e.target.closest("[data-mem]")) return SpaceExtra.members();
      if (e.target.closest("[data-inv]")) return SpaceExtra.invite();
      if (e.target.closest("[data-bans]")) return SpaceExtra.bans();
      if (e.target.closest("[data-leave]")) return SpaceExtra.leaveSpace();
      if (e.target.closest("[data-autovote]") && edit) {
        try { const d = await api("/api/spaces/" + R.id + "/update", { method: "POST", body: { autovote: R.info.autovote ? 0 : 1 } }); R.info = Object.assign(R.info, d.space); draw(); toast(T(R.info.autovote ? "Голосование включено" : "Голосование выключено")); } catch (er) { toast(er.message); }
        return;
      }
      const pm = e.target.closest("[data-perm]");
      if (pm && edit) {
        const k = pm.dataset.perm, v = await Space.pickPerm(k, (I.perms || {})[k] || "member"); if (!v) return;
        try { const d = await api("/api/spaces/" + R.id + "/update", { method: "POST", body: { perms: { [k]: v } } }); R.info = Object.assign(R.info, d.space); draw(); SpaceRoom.paintPlayer(); SpaceRoom.paintDock(); if (R.tab !== "chat") SpaceRoom.paintPane(); } catch (er) { toast(er.message); }
        return;
      }
      if (e.target.closest("[data-rot]")) {
        const v = await UI.sheet({ title: T("Новая ссылка-приглашение?"), text: T("Старая ссылка перестанет работать."), actions: [{ label: T("Создать новую"), value: 1, accent: true }], cancel: T("Отмена") }); if (!v) return;
        try { const d = await api("/api/spaces/" + R.id + "/update", { method: "POST", body: { rotate_invite: true } }); R.info = Object.assign(R.info, d.space); draw(); toast(T("Ссылка обновлена")); } catch (er) { toast(er.message); }
        return;
      }
      if (e.target.closest("[data-del]")) {
        const v = await UI.sheet({ title: T("Удалить «{0}»?", I.title), text: T("Пространство, его чат и очередь будут удалены у всех. Это нельзя отменить."), actions: [{ label: T("Удалить навсегда"), value: 1, danger: true }], cancel: T("Отмена") }); if (!v) return;
        try { await api("/api/spaces/" + R.id + "/delete", { method: "POST", body: {} }); Space.remove(R.id); SpaceRoom.closeFor(T("Пространство удалено")); } catch (er) { toast(er.message); }
        return;
      }
      if (e.target.closest("[data-save]")) {
        const b = pend();
        if (st.pub && !SLUG.test(st.slug)) return toast(T("Адрес: от 5 до 32 символов — латиница, цифры, _. Должен начинаться с буквы"));
        if (!Object.keys(b).length) return Nav.back();
        if (st.busy) return; st.busy = true;
        try { const d = await api("/api/spaces/" + R.id + "/update", { method: "POST", body: b }); R.info = Object.assign(R.info, d.space); Space.upsert(R.info); SpaceRoom.paintHead(); st.photo = undefined; Nav.back(); toast(T("Сохранено")); }
        catch (er) { st.busy = false; toast(er.message); }
      }
    });
  },

  // ───────────── участники ─────────────
  members() {
    const R = SpaceRoom.R; if (!R || $("spmem")) return;
    const el = document.createElement("section");
    el.id = "spmem"; el.className = "page tgp sp-page"; el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<header class="tg-head"><button class="icon-btn" data-back aria-label="${esc(T("Назад"))}">${SPI.back}</button><div class="tg-title">${esc(T("Участники"))}<small id="spm-n"></small></div></header>
      <label class="nm-search">${SI.search}<input id="spm-q" placeholder="${esc(T("Поиск"))}" autocomplete="off"></label>
      <div class="nm-body sp-pick" id="spm-b"><div class="nm-empty">${esc(T("Загрузка…"))}</div></div>`;
    document.body.appendChild(el); void el.offsetWidth;
    Nav.open("spmem", () => setTimeout(() => el.remove(), 320));
    let items = [];
    const draw = () => {
      const s = el.querySelector("#spm-q").value.trim().toLowerCase();
      const L = items.filter((m) => !s || (dispName(m.user) + " " + (m.user.username || "")).toLowerCase().includes(s));
      el.querySelector("#spm-n").textContent = items.length ? String(items.length) : "";
      el.querySelector("#spm-b").innerHTML = L.length ? L.map((m) => `<button class="sp-prow" data-id="${m.user.id}" type="button"><span class="sp-pa">${avatar(m.user)}</span><span class="sp-pt"><b>${nameHTML(m.user)}</b><small>${esc(SpaceRoom.roleName(m.role))}${m.muted ? " · " + esc(T("заглушён")) : ""}</small></span>${m.live ? `<i class="sp-dot"></i>` : ""}${m.role === "owner" ? `<i class="spb-i crown">${SPI.crown}</i>` : m.role !== "member" ? `<i class="spb-i">${SPI.shield}</i>` : ""}</button>`).join("") : `<div class="nm-empty">${esc(T("Никого не найдено"))}</div>`;
    };
    const load = async () => { try { const d = await api("/api/spaces/" + R.id + "/members"); items = d.members || []; R.info.n = d.n; draw(); } catch (e) { el.querySelector("#spm-b").innerHTML = `<div class="nm-empty">${esc(e.message)}</div>`; } };
    load();
    el.querySelector("#spm-q").addEventListener("input", draw);
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-back]")) return Nav.back();
      const r = e.target.closest(".sp-prow"); if (!r) return;
      const m = items.find((x) => x.user.id === +r.dataset.id); if (!m) return;
      haptic(); await SpaceExtra.memberMenu(m.user.id, m); load();
    });
  },
  async memberMenu(uid, row) {
    const R = SpaceRoom.R; if (!R) return;
    const live = R.users[uid];
    const user = row ? row.user : SpaceRoom.uprof(uid);
    const role = row ? row.role : live ? live.role : "member", muted = row ? row.muted : 0;
    const me = uid === App.user.id, myLv = SpaceRoom.lv(R.role), tLv = SpaceRoom.lv(role);
    const a = [];
    if (!me) a.push({ label: T("Профиль"), value: "prof" });
    if (!me && myLv > tLv) {
      if (SpaceRoom.can("roles") && role !== "owner") {
        if (role === "member") a.push({ label: T("Сделать модератором"), value: "r:mod" });
        if (role === "mod") a.push({ label: T("Снять с модератора"), value: "r:member" });
        if (SpaceRoom.can("admins")) { if (role !== "admin") a.push({ label: T("Сделать администратором"), value: "r:admin" }); else a.push({ label: T("Снять с администратора"), value: "r:member" }); }
      }
      if (SpaceRoom.can("mute")) a.push({ label: muted ? T("Вернуть слово и микрофон") : T("Заглушить (чат и микрофон)"), value: muted ? "unmute" : "mute" });
      if (SpaceRoom.can("kick")) a.push({ label: T("Удалить из пространства"), value: "kick", danger: true });
      if (SpaceRoom.can("ban")) a.push({ label: T("Заблокировать"), value: "ban", danger: true });
    }
    if (!a.length) return;
    const v = await UI.sheet({ title: dispName(user), text: SpaceRoom.roleName(role), actions: a, cancel: T("Закрыть") });
    if (!v) return;
    if (v === "prof") { try { UserProfile.open(user); } catch (e) {} return; }
    try {
      if (v.startsWith("r:")) await api("/api/spaces/" + R.id + "/role", { method: "POST", body: { user: uid, role: v.slice(2) } });
      else if (v === "mute" || v === "unmute") await api("/api/spaces/" + R.id + "/mute", { method: "POST", body: { user: uid, on: v === "mute" } });
      else if (v === "kick" || v === "ban") {
        const ok = await UI.sheet({ title: v === "ban" ? T("Заблокировать {0}?", dispName(user)) : T("Удалить {0}?", dispName(user)), text: v === "ban" ? T("Он не сможет вернуться, пока вы его не разблокируете.") : T("Он сможет вернуться по ссылке."), actions: [{ label: v === "ban" ? T("Заблокировать") : T("Удалить"), value: 1, danger: true }], cancel: T("Отмена") });
        if (!ok) return;
        await api("/api/spaces/" + R.id + "/kick", { method: "POST", body: { user: uid, ban: v === "ban" } });
      }
    } catch (e) { toast(e.message); }
  },
  async bans() {
    const R = SpaceRoom.R; if (!R) return;
    let users = [];
    try { users = (await api("/api/spaces/" + R.id + "/bans")).users || []; } catch (e) { return toast(e.message); }
    if (!users.length) return toast(T("Заблокированных нет"));
    const v = await UI.sheet({ title: T("Заблокированные"), text: T("Нажмите на человека, чтобы разблокировать."), actions: users.map((u) => ({ label: dispName(u), value: u.id })), cancel: T("Закрыть") });
    if (!v) return;
    try { await api("/api/spaces/" + R.id + "/unban", { method: "POST", body: { user: v } }); toast(T("Разблокирован")); } catch (e) { toast(e.message); }
  },

  // ───────────── добавить трек: файл или ссылка, название, текст песни для караоке ─────────────
  addTrack() {
    const R = SpaceRoom.R; if (!R || $("sptr")) return;
    const el = document.createElement("section");
    el.id = "sptr"; el.className = "page tgp sp-page"; el.setAttribute("aria-hidden", "true");
    const st = { mode: "file", file: null, url: "", title: "", artist: "", lrc: "", dur: 0, busy: false, pct: 0 };
    el.innerHTML = `<header class="tg-head"><button class="icon-btn" data-back aria-label="${esc(T("Назад"))}">${SPI.back}</button><div class="tg-title">${esc(T("Добавить в очередь"))}</div></header>
      <div class="nm-body cc-body">
        <div class="cc-seg"><button class="on" data-m="file">${esc(T("Файл"))}</button><button data-m="url">${esc(T("Ссылка"))}</button></div>
        <div id="sptr-file"><button class="spt-pick" data-file type="button">${SPI.music}<b>${esc(T("Выбрать аудио или видео"))}</b><small>${esc(T("MP3, M4A, OGG, WAV, MP4, WEBM — до лимита загрузки"))}</small></button><input id="sptr-fi" type="file" accept="audio/*,video/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac,.mp4,.webm,.mov" hidden></div>
        <div id="sptr-url" hidden><label class="cc-lnk"><input id="sptr-u" placeholder="https://… (mp3, mp4 или YouTube)" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url"></label>
          <div class="cc-hint">${esc(T("Прямая ссылка на файл или ссылка на видео YouTube. Её увидят все в комнате — открывайте только то, чему доверяете."))}</div></div>
        <div class="cc-name sp-f"><input id="sptr-t" maxlength="100" placeholder="${esc(T("Название"))}" autocomplete="off"></div>
        <div class="cc-name sp-f"><input id="sptr-a" maxlength="100" placeholder="${esc(T("Исполнитель (необязательно)"))}" autocomplete="off"></div>
        <div class="sp-sec">${esc(T("Текст песни для караоке"))}</div>
        <div class="cc-about"><textarea id="sptr-l" rows="5" maxlength="40000" placeholder="${esc(T("Вставьте текст. Если есть метки времени [мм:сс.хх] — строки подсвечиваются в такт музыке."))}"></textarea></div>
        <button class="nm-act cc-row" data-lrc type="button"><span>${esc(T("Загрузить файл .lrc или .txt"))}</span></button><input id="sptr-lf" type="file" accept=".lrc,.txt,text/plain" hidden>
        <div class="spt-prog" id="sptr-p" hidden><i></i><span></span></div>
      </div>
      <button class="fab2 off" data-ok aria-label="${esc(T("Добавить"))}">${SI.check}</button>`;
    document.body.appendChild(el); void el.offsetWidth;
    const ctl = {};
    Nav.open("sptr", () => { if (st.busy) try { ctl.abort && ctl.abort(); } catch (e) {} setTimeout(() => el.remove(), 320); });
    const fab = el.querySelector("[data-ok]");
    const upd = () => fab.classList.toggle("off", st.busy || (st.mode === "file" ? !st.file : !/^https:\/\/\S{4,}/i.test(st.url.trim())));
    const T$ = (id) => el.querySelector("#" + id);
    T$("sptr-t").addEventListener("input", (e) => { st.title = e.target.value; });
    T$("sptr-a").addEventListener("input", (e) => { st.artist = e.target.value; });
    T$("sptr-l").addEventListener("input", (e) => { st.lrc = e.target.value; });
    T$("sptr-u").addEventListener("input", (e) => { st.url = e.target.value; upd(); });
    const dur = (f) => new Promise((res) => {
      try {
        const m = document.createElement(/^video/.test(f.type) ? "video" : "audio"), u = URL.createObjectURL(f);
        const done = (v) => { try { URL.revokeObjectURL(u); } catch (e) {} res(v); };
        m.preload = "metadata"; m.onloadedmetadata = () => done(isFinite(m.duration) ? m.duration : 0); m.onerror = () => done(0); setTimeout(() => done(0), 4000); m.src = u;
      } catch (e) { res(0); }
    });
    T$("sptr-fi").addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      st.file = f; st.dur = await dur(f);
      const nm = f.name.replace(/\.[A-Za-z0-9]{1,5}$/, "");
      if (!st.title) { st.title = nm; T$("sptr-t").value = nm; }
      el.querySelector("[data-file]").innerHTML = `${/^video/.test(f.type) ? SPI.video : SPI.music}<b>${esc(f.name)}</b><small>${esc((f.size / 1048576).toFixed(1) + " " + T("МБ"))}${st.dur ? " · " + Calls.fmt(st.dur) : ""}</small>`;
      upd();
    });
    T$("sptr-lf").addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      if (f.size > 200000) return toast(T("Файл с текстом слишком большой"));
      try { st.lrc = (await f.text()).slice(0, 40000); T$("sptr-l").value = st.lrc; toast(T("Текст загружен")); } catch (er) { toast(T("Не удалось прочитать файл")); }
    });
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-back]")) return Nav.back();
      const m = e.target.closest("[data-m]");
      if (m) { st.mode = m.dataset.m; el.querySelectorAll("[data-m]").forEach((b) => b.classList.toggle("on", b === m)); T$("sptr-file").hidden = st.mode !== "file"; T$("sptr-url").hidden = st.mode !== "url"; upd(); return; }
      if (e.target.closest("[data-file]")) return T$("sptr-fi").click();
      if (e.target.closest("[data-lrc]")) return T$("sptr-lf").click();
      if (!e.target.closest("[data-ok]") || fab.classList.contains("off")) return;
      st.busy = true; upd(); haptic("medium");
      const prog = T$("sptr-p"); prog.hidden = false;
      try {
        const body = { title: st.title.trim(), artist: st.artist.trim(), lrc: st.lrc.trim(), dur: st.dur || undefined };
        if (st.mode === "file") {
          prog.querySelector("span").textContent = T("Загрузка…");
          const fid = await Up.upload(st.file, { ctl, onProgress: (p) => { prog.querySelector("i").style.width = Math.round(p * 100) + "%"; prog.querySelector("span").textContent = T("Загрузка…") + " " + Math.round(p * 100) + "%"; } });
          body.fid = fid;
        } else body.url = st.url.trim();
        await api("/api/spaces/" + R.id + "/tracks", { method: "POST", body });
        toast(T("Добавлено в очередь"));
        await SpaceRoom.loadTracks();
        const first = !(SpaceRoom.R && SpaceRoom.R.player && SpaceRoom.R.player.trk);
        Nav.back();
        if (first && SpaceRoom.can("control")) setTimeout(() => SpaceRoom.player_("play"), 400);
      } catch (er) { st.busy = false; prog.hidden = true; upd(); if (!er.aborted) toast(er.message || T("Не удалось добавить")); }
    });
  },
};
