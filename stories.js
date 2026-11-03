// stories.js — публикации (как истории в Telegram): кольца на аватарках, просмотр, создание, сетка для профиля.
const PI = {
  eye: svg('<path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.6v14.8a1 1 0 0 0 1.5.86l12-7.4a1 1 0 0 0 0-1.72l-12-7.4A1 1 0 0 0 7 4.6z"/></svg>',
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  vol: svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
  mute: svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/>'),
  gallery: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/>'),
  phone: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>'),
  at: svg('<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>'),
  cake: svg('<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16.5c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1"/><path d="M2 21h20"/><path d="M12 11V8"/><path d="M12 5.2c.8-.9.8-1.7 0-2.7-.8 1-.8 1.8 0 2.7z"/>'),
  channel: svg('<path d="m3 11 18-6v14L3 13z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>'),
  gift: svg('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18.5 14a6.5 6.5 0 0 1 3 6"/>'),
  globe: svg('<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19"/><path d="M12 2.5c2.6 2.8 4 6 4 9.5s-1.4 6.7-4 9.5c-2.6-2.8-4-6-4-9.5s1.4-6.7 4-9.5z"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  chev: svg('<path d="m9 6 6 6-6 6"/>'),
};

// fmtDur (м:сс) берём из voice.js
function agoText(ts) {
  const d = Date.now() / 1000 - ts;
  if (d < 60) return "только что";
  if (d < 3600) return Math.floor(d / 60) + " мин. назад";
  if (d < 86400) return Math.floor(d / 3600) + " ч назад";
  return fmtDay(ts) + ", " + fmtTime(ts);
}
// сколько осталось жить публикации: «ещё 5 ч» / «ещё 12 мин.»
function leftText(exp) {
  const d = exp - Date.now() / 1000;
  if (d <= 0) return "";
  return d < 3600 ? `ещё ${Math.max(1, Math.round(d / 60))} мин.` : `ещё ${Math.round(d / 3600)} ч`;
}

const Stories = {
  feed: {},          // id собеседника → {count, unseen, user}
  users: [],         // они же списком (новые сверху)
  mine: 0,           // сколько моих публикаций сейчас активно
  last: 0, muted: false, open: null,

  // ───────────── данные ─────────────
  async load(force) {
    const now = Date.now();
    if (!force && now - Stories.last < 2500) return;
    Stories.last = now;
    try {
      const d = await api("/api/stories/feed");
      Stories.mine = d.mine; Stories.users = d.users; Stories.feed = {};
      d.users.forEach((x) => (Stories.feed[x.id] = x));
      Stories.changed();
    } catch (e) {}
  },
  changed() {
    try { Chats.render(); } catch (e) {}
    try { if (Chat.peer) Chat.updateHeader(); } catch (e) {}
    try { Profile.draw(); } catch (e) {}
    try { UserProfile.ring(); } catch (e) {}
  },
  // new — есть непросмотренные, seen — все просмотрены, mine — мои, "" — публикаций нет
  stateOf(uid) {
    if (App.user && uid === App.user.id) return Stories.mine > 0 ? "mine" : "";
    const f = Stories.feed[uid];
    return f ? (f.unseen > 0 ? "new" : "seen") : "";
  },
  // аватар с кольцом, если у человека есть публикации (нажатие открывает их)
  av(u, cls = "") {
    const st = u && !u.is_system ? Stories.stateOf(u.id) : "";
    return st ? `<span class="ring ${st}${cls ? " r-" + cls : ""}" data-story="${u.id}">${avatar(u, cls)}</span>` : avatar(u, cls);
  },
  userOf(id) {
    if (App.user && id === App.user.id) return App.user;
    if (Stories.feed[id]) return Stories.feed[id].user;
    const c = Chats.list.find((x) => x.peer.id === id);
    return c ? c.peer : { id, name: "", username: "" };
  },

  // ───────────── сетка в профиле ─────────────
  grid(list, { own = false, add = false, archive = false } = {}) {
    const tile = (s, i) => {
      const src = s.turl || (s.kind === "photo" ? s.url : "");
      return `<button class="pg-t" data-i="${i}" aria-label="Открыть публикацию">${src ? `<img src="${esc(fileUrl(src))}" alt="" loading="lazy" decoding="async">` : `<span class="pg-noimg">${PI.play}</span>`}
        ${s.kind === "video" ? `<span class="pg-v">${PI.play}${fmtDur(s.dur)}</span>` : ""}
        ${own ? `<span class="pg-n">${PI.eye}${s.views || 0}</span>` : ""}
        ${archive ? `<span class="pg-d">${new Date(s.ts * 1000).toLocaleDateString([], { day: "numeric", month: "short" })}</span>` : ""}</button>`;
    };
    return `<div class="pg">${add ? `<button class="pg-t pg-add" data-add="1" aria-label="Добавить публикацию">${PI.plus}<span>Добавить</span></button>` : ""}${list.map(tile).join("")}</div>`;
  },

  // ───────────── открыть чужие/свои публикации ─────────────
  async openUser(uid) {
    if (Stories.open) return;
    const me = App.user.id, order = [uid];
    if (uid !== me) Stories.users.forEach((x) => { if (x.id !== uid && x.unseen > 0) order.push(x.id); });
    Stories.show(order.map((id) => ({ uid: id, user: Stories.userOf(id), stories: null })), 0, null);
  },

  // ───────────── просмотр ─────────────
  // groups: [{uid, user, stories|null}], gi — с какой группы, si — с какой публикации (null: с первой непросмотренной)
  // opts: {archive: true — режим архива, onClose}
  show(groups, gi = 0, si = null, opts = {}) {
    if (Stories.open) return;
    const me = App.user.id;
    const el = document.createElement("div");
    el.className = "sv";
    el.innerHTML = `<div class="sv-bg"></div><div class="sv-media"></div><div class="sv-shade"></div>
      <div class="sv-top"><div class="sv-bars"></div>
        <div class="sv-head"><span class="sv-av"></span><div class="sv-who"><b></b><small></small></div>
          <button class="sv-btn sv-mute hidden" aria-label="Звук"></button><button class="sv-btn sv-x" aria-label="Закрыть">${PI.close}</button></div></div>
      <div class="sv-tap"></div><div class="sv-cap hidden"></div>
      <div class="sv-foot hidden"><button class="sv-eye" aria-label="Просмотры">${PI.eye}<span>0</span></button><span class="sv-note"></span><button class="sv-del" aria-label="Удалить">${ICON.trash}</button></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    const q = (c) => el.querySelector(c);
    const media = q(".sv-media"), bg = q(".sv-bg"), bars = q(".sv-bars"), cap = q(".sv-cap"), foot = q(".sv-foot"), muteB = q(".sv-mute");

    let g = null, list = [], i = 0, elapsed = 0, dur = 5000, ready = false, vid = null, raf = 0, last = 0, closed = false, token = 0;
    const holds = new Set();
    const paused = () => holds.size > 0;
    const setHold = (k, on) => {
      on ? holds.add(k) : holds.delete(k);
      if (vid) { if (paused()) vid.pause(); else vid.play().catch(() => {}); }
    };

    const fill = async (grp) => {
      if (grp.stories) return;
      try { grp.stories = (await api("/api/stories/user/" + grp.uid)).stories; } catch (e) { grp.stories = []; }
    };

    const renderBars = () => {
      bars.innerHTML = list.map(() => "<i><b></b></i>").join("");
      bars.querySelectorAll("i").forEach((x, k) => { if (k < i) x.firstChild.style.transform = "scaleX(1)"; });
    };
    const setBar = (p) => { const b = bars.children[i]; if (b) b.firstChild.style.transform = `scaleX(${Math.max(0, Math.min(1, p))})`; };

    const header = (s) => {
      q(".sv-av").innerHTML = avatar(g.user, "sm");
      q(".sv-who b").innerHTML = nameHTML(g.user);
      q(".sv-who small").textContent = opts.archive ? new Date(s.ts * 1000).toLocaleString([], { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : agoText(s.ts);
      const own = g.uid === me;
      foot.classList.toggle("hidden", !own);
      if (own) {
        q(".sv-eye span").textContent = s.views || 0;
        q(".sv-note").textContent = s.active ? leftText(s.exp) : "В архиве";
      }
      cap.classList.toggle("hidden", !s.cap);
      cap.textContent = s.cap || "";
    };

    const stopMedia = () => {
      cancelAnimationFrame(raf); token++;
      if (vid) { vid.pause(); vid.removeAttribute("src"); vid.load(); vid = null; }
      media.innerHTML = ""; muteB.classList.add("hidden");
    };

    const showStory = () => {
      stopMedia();
      const s = list[i], my = ++token;
      elapsed = 0; ready = false; dur = 5000;
      renderBars(); header(s);
      el.classList.remove("fail");
      if (g.uid !== me && !s.seen) {
        s.seen = true;
        api(`/api/story/${s.id}/view`, { method: "POST", body: {} }).catch(() => {});
        const f = Stories.feed[g.uid]; if (f && f.unseen > 0) f.unseen--;
      }
      const fail = () => { if (my !== token) return; toast("Не удалось загрузить публикацию"); el.classList.add("fail"); ready = true; dur = 2500; };
      if (s.kind === "video") {
        const v = (vid = document.createElement("video"));
        v.playsInline = true; v.preload = "auto"; v.muted = Stories.muted; v.src = fileUrl(s.url);
        if (s.turl) v.poster = fileUrl(s.turl);
        media.appendChild(v);
        muteB.innerHTML = Stories.muted ? PI.mute : PI.vol; muteB.classList.remove("hidden");
        v.onloadedmetadata = () => { if (my === token) ready = true; };
        v.onended = () => { if (my === token) next(); };
        v.onerror = () => { vid = null; fail(); };
        if (!paused()) v.play().catch(() => { v.muted = true; Stories.muted = true; muteB.innerHTML = PI.mute; v.play().catch(() => {}); });
      } else {
        bg.style.backgroundImage = `url("${fileUrl(s.url)}")`;
        const im = new Image();
        im.alt = ""; im.draggable = false;
        im.onload = () => { if (my !== token) return; media.appendChild(im); ready = true; };
        im.onerror = fail;
        im.src = fileUrl(s.url);
      }
      // заранее грузим следующую картинку
      const n = list[i + 1];
      if (n && n.kind === "photo") new Image().src = fileUrl(n.url);
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(100, now - last); last = now;
      let p;
      if (vid && !el.classList.contains("fail")) p = vid.duration ? vid.currentTime / vid.duration : 0;
      else { if (ready && !paused()) elapsed += dt; p = elapsed / dur; }
      setBar(p);
      if ((!vid || el.classList.contains("fail")) && p >= 1) next();
    };

    const go = async (gIdx, sIdx) => {
      const grp = groups[gIdx];
      stopMedia();
      await fill(grp);
      if (closed) return;
      if (!grp.stories.length) {
        if (gIdx + 1 < groups.length) return go(gIdx + 1, null);
        if (!opts.archive) toast("Публикаций нет");
        return close();
      }
      gi = gIdx; g = grp; list = grp.stories;
      i = sIdx === null || sIdx === undefined ? Math.max(0, list.findIndex((x) => !x.seen)) : Math.max(0, Math.min(list.length - 1, sIdx < 0 ? list.length - 1 : sIdx));
      showStory();
    };

    const next = () => {
      if (closed) return;
      if (i < list.length - 1) { i++; showStory(); }
      else if (gi < groups.length - 1) go(gi + 1, null);
      else close();
    };
    const prev = () => {
      if (closed) return;
      if (i > 0) { i--; showStory(); }
      else if (gi > 0) go(gi - 1, -1);
      else showStory();
    };

    const release = Nav.layer(() => {
      closed = true; Stories.open = null;
      stopMedia();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVis);
      el.classList.remove("show");
      setTimeout(() => el.remove(), 220);
      Stories.load(true);
      if (opts.onClose) opts.onClose();
    });
    Stories.open = el;
    const close = () => release();
    const onKey = (e) => { if (e.key === "ArrowRight") next(); else if (e.key === "ArrowLeft") prev(); };
    const onVis = () => setHold("vis", document.visibilityState !== "visible");
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVis);

    q(".sv-x").onclick = close;
    muteB.onclick = () => { Stories.muted = !Stories.muted; if (vid) vid.muted = Stories.muted; muteB.innerHTML = Stories.muted ? PI.mute : PI.vol; };

    // жесты: тап слева/справа, удержание — пауза, свайп вниз — закрыть, свайп вбок — другой человек
    const tap = q(".sv-tap");
    let down = null, holdT = 0;
    const reset = () => { media.style.transform = ""; media.style.opacity = ""; bg.style.opacity = ""; el.style.background = ""; };
    tap.addEventListener("pointerdown", (e) => {
      tap.setPointerCapture(e.pointerId);
      down = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, hold: false };
      holdT = setTimeout(() => { if (down) { down.hold = true; setHold("touch", true); el.classList.add("holding"); } }, 220);
    });
    tap.addEventListener("pointermove", (e) => {
      if (!down) return;
      down.dx = e.clientX - down.x; down.dy = e.clientY - down.y;
      if (down.dy > 12 && down.dy > Math.abs(down.dx)) {
        clearTimeout(holdT);
        media.style.transform = `translateY(${down.dy}px) scale(${1 - Math.min(down.dy, 400) / 1600})`;
        el.style.background = `rgba(0,0,0,${Math.max(0, 1 - down.dy / 420)})`; bg.style.opacity = Math.max(0, 1 - down.dy / 300);
      }
    });
    const end = (e) => {
      clearTimeout(holdT);
      const d = down; down = null;
      if (!d) return;
      el.classList.remove("holding"); setHold("touch", false);
      const cancelled = e.type === "pointercancel";
      if (!cancelled && d.dy > 110 && d.dy > Math.abs(d.dx)) return close();
      reset();
      if (cancelled) return;
      if (Math.abs(d.dx) > 70 && Math.abs(d.dx) > Math.abs(d.dy) * 1.5) {
        if (d.dx < 0 && gi < groups.length - 1) go(gi + 1, null); else if (d.dx > 0 && gi > 0) go(gi - 1, null);
      } else if (!d.hold && Math.abs(d.dx) < 12 && Math.abs(d.dy) < 12) {
        e.clientX < innerWidth * 0.33 ? prev() : next();
      }
    };
    tap.addEventListener("pointerup", end); tap.addEventListener("pointercancel", end);

    // владелец: просмотры и удаление
    q(".sv-eye").onclick = async () => {
      setHold("sheet", true);
      await Stories.viewsSheet(list[i]);
      setHold("sheet", false);
    };
    q(".sv-del").onclick = async () => {
      const s = list[i];
      setHold("sheet", true);
      const ok = await UI.sheet({ title: "Удалить публикацию?", text: s.active ? "Она исчезнет у всех и из архива." : "Она исчезнет из архива.",
        actions: [{ label: "Удалить", value: true, danger: true }] });
      if (!ok) return setHold("sheet", false);
      try { await api(`/api/story/${s.id}/delete`, { method: "POST", body: {} }); } catch (e) { setHold("sheet", false); return toast(e.message); }
      setHold("sheet", false);
      toast("Публикация удалена");
      list.splice(i, 1);
      try { Profile.loadStories(); } catch (e) {}
      if (!list.length) return close();
      if (i >= list.length) i = list.length - 1;
      showStory();
    };

    go(gi, si);
    return close;
  },

  // кто смотрел (только автору)
  async viewsSheet(s) {
    const el = document.createElement("div");
    el.className = "sheet2";
    el.innerHTML = `<div class="s2-card" role="dialog"><h3>Просмотры</h3><div class="vw-list"><p class="dim">Загрузка…</p></div>
      <div class="s2-btns"><button class="s2-cancel" data-x="1">Закрыть</button></div></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    const list = el.querySelector(".vw-list");
    api(`/api/story/${s.id}/views`).then((d) => {
      list.innerHTML = d.views.length ? d.views.map((v) => `<div class="vw-row">${avatar(v.user, "sm")}<div class="vw-m"><b>${nameHTML(v.user)}</b><small>${esc(agoText(v.ts))}</small></div></div>`).join("")
        : `<p class="dim">Пока никто не смотрел</p>`;
    }).catch((e) => { list.innerHTML = `<p class="dim">${esc(e.message)}</p>`; });
    await new Promise((res) => {
      el.addEventListener("click", (e) => {
        if (e.target === el || e.target.closest("[data-x]")) { el.classList.remove("show"); setTimeout(() => el.remove(), 200); res(); }
      });
    });
  },

  // ───────────── создание ─────────────
  async create() {
    const k = await UI.tiles({ title: "Новая публикация", text: "Фото или видео увидят другие, а через заданное время оно уйдёт в ваш архив.",
      tiles: [{ k: "gal", label: "Галерея", icon: PI.gallery, cls: "t-blue" }, { k: "cam", label: "Камера", icon: ICON.camera, cls: "t-pink" }] });
    if (k === "gal") { const f = (await Attach.pick("image/*,video/*", false))[0]; if (f) Stories.compose(f); }
    else if (k === "cam") Camera.open((f) => Stories.compose(f));
  },

  // фото крупнее 1920 px или тяжелее 1,5 МБ сжимаем до 1920 px (иначе публикация грузится целую вечность)
  async prepImage(file) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) { try { bmp = await createImageBitmap(file); } catch (_) { return null; } }
    const w = bmp.width, h = bmp.height;
    let out = file;
    if (/^image\/(jpeg|png|webp)$/.test(file.type) && (file.size > 1.5 * 1048576 || Math.max(w, h) > 1920)) {
      const k = Math.min(1, 1920 / Math.max(w, h)), c = document.createElement("canvas");
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
      if (blob && blob.size < file.size) out = new File([blob], (file.name || "photo").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
      bmp.close && bmp.close();
      return { file: out, w: c.width, h: c.height };
    }
    bmp.close && bmp.close();
    return { file: out, w, h };
  },
  // длительность, размер и кадр-обложка видео
  videoInfo(file) {
    return new Promise((res) => {
      const url = URL.createObjectURL(file), v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.preload = "auto";
      let done = false;
      const fin = (r) => { if (done) return; done = true; clearTimeout(tm); URL.revokeObjectURL(url); v.removeAttribute("src"); v.load(); res(r); };
      const tm = setTimeout(() => fin(null), 12000);
      v.onerror = () => fin(null);
      v.onloadedmetadata = () => { v.currentTime = Math.min(0.3, (v.duration || 1) / 2); };
      v.onseeked = () => {
        const w = v.videoWidth, h = v.videoHeight, dur = Math.round((v.duration || 0) * 1000);
        try {
          const k = Math.min(1, 480 / Math.max(w, h)), c = document.createElement("canvas");
          c.width = Math.round(w * k); c.height = Math.round(h * k);
          c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
          c.toBlob((b) => fin({ w, h, dur, poster: b }), "image/jpeg", 0.8);
        } catch (e) { fin({ w, h, dur, poster: null }); }
      };
      v.src = url;
    });
  },

  compose(file) {
    if (!file || !/^(image|video)\//.test(file.type)) return toast("Выберите фото или видео");
    if (file.size > Attach.max) return toast(`Файл больше ${Math.round(Attach.max / 1048576)} МБ`);
    const el = document.createElement("div");
    el.className = "sc";
    el.innerHTML = `<header class="sc-top"><button class="sc-back" aria-label="Назад">${PI.back}</button><b>Новая публикация</b><span></span></header>
      <div class="sc-stage"><div class="sc-card"><div class="sc-media"></div><button class="sc-change">Другое фото</button></div></div>
      <div class="sc-bar">
        <div class="sc-cap"><input id="sc-cap" maxlength="200" placeholder="Добавить подпись…" autocomplete="off"><button class="sc-chip" id="sc-hours">24 ч</button></div>
        <button class="sc-opt" id="sc-aud">${PI.globe}<span>Кто видит: <b>все</b></span>${PI.chev}</button>
        <button class="sc-go" id="sc-go">Опубликовать</button></div>
      <div class="sc-prog hidden"><div class="sc-ring"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="4"/><circle id="sc-arc" cx="24" cy="24" r="20" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-dasharray="125.66" stroke-dashoffset="125.66" transform="rotate(-90 24 24)"/></svg><span id="sc-pct">0%</span></div><p>Публикуем…</p><button id="sc-cancel">Отмена</button></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    const q = (c) => el.querySelector(c);
    const S = { file, hours: 24, aud: 0, busy: false, url: "", ok: true, ctl: {} };
    const media = q(".sc-media"), go = q("#sc-go");

    const setFile = (f) => {
      if (S.url) URL.revokeObjectURL(S.url);
      S.file = f; S.url = URL.createObjectURL(f); S.ok = true; go.disabled = false;
      const vid = /^video\//.test(f.type);
      q(".sc-change").textContent = vid ? "Другое видео" : "Другое фото";
      if (vid) {
        media.innerHTML = `<video src="${S.url}" muted loop autoplay playsinline></video>`;
        const v = media.firstChild;
        v.onloadedmetadata = () => { if (v.duration > 60.5) { S.ok = false; go.disabled = true; toast("Видео для публикации — не длиннее 60 секунд"); } };
      } else media.innerHTML = `<img src="${S.url}" alt="">`;
    };
    setFile(file);

    const release = Nav.layer(() => {
      S.cancelled = true; S.ctl.abort && S.ctl.abort();
      if (S.url) URL.revokeObjectURL(S.url);
      el.classList.remove("show");
      setTimeout(() => el.remove(), 220);
    });
    q(".sc-back").onclick = () => release();
    q("#sc-cancel").onclick = () => { S.cancelled = true; S.ctl.abort && S.ctl.abort(); };
    q(".sc-change").onclick = async () => { const f = (await Attach.pick("image/*,video/*", false))[0]; if (f && /^(image|video)\//.test(f.type)) { if (f.size > Attach.max) return toast("Файл слишком большой"); setFile(f); } };

    q("#sc-hours").onclick = async () => {
      const h = await UI.sheet({ title: "Сколько показывать", text: "Потом публикация уйдёт в ваш архив.",
        actions: [6, 12, 24, 48].map((x) => ({ label: x + " часов" + (x === S.hours ? "  ✓" : ""), value: x })) });
      if (h) { S.hours = h; q("#sc-hours").textContent = h + " ч"; }
    };
    q("#sc-aud").onclick = async () => {
      const a = await UI.sheet({ title: "Кто видит публикацию", actions: [
        { label: "Все пользователи" + (S.aud === 0 ? "  ✓" : ""), value: 0 }, { label: "Только мои собеседники" + (S.aud === 1 ? "  ✓" : ""), value: 1 }] });
      if (a === 0 || a === 1) {
        S.aud = a; q("#sc-aud").firstElementChild.outerHTML = a ? PI.users : PI.globe;
        q("#sc-aud b").textContent = a ? "собеседники" : "все";
      }
    };

    const progress = (p) => {
      p = Math.max(0, Math.min(1, p));
      q("#sc-arc").style.strokeDashoffset = String(125.66 * (1 - p));
      q("#sc-pct").textContent = Math.round(p * 100) + "%";
    };
    go.onclick = async () => {
      if (S.busy || !S.ok) return;
      S.busy = true; S.ctl = {}; S.cancelled = false;
      q(".sc-prog").classList.remove("hidden"); progress(0);
      const alive = () => { if (S.cancelled) throw Object.assign(new Error("Отменено"), { aborted: true }); };
      try {
        const isVid = /^video\//.test(S.file.type);
        let up = S.file, w = 0, h = 0, dur = 0, thumb = null;
        if (isVid) {
          const info = await Stories.videoInfo(S.file);
          if (!info) throw new Error("Не удалось прочитать видео");
          ({ w, h, dur } = info); thumb = info.poster;
          if (dur > 60500) throw new Error("Видео для публикации — не длиннее 60 секунд");
        } else {
          const pr = await Stories.prepImage(S.file);
          if (!pr) throw new Error("Не удалось прочитать фото");
          up = pr.file; w = pr.w; h = pr.h;
          const t = await Up.thumb(up, 420);
          thumb = t && t.blob;
        }
        alive();
        const fid = await Up.upload(up, { ctl: S.ctl, onProgress: (p) => progress(p * 0.93) });
        alive();
        let tfid = null;
        if (thumb) { try { tfid = await Up.upload(new File([thumb], "t.jpg", { type: "image/jpeg" }), { ctl: S.ctl, onProgress: (p) => progress(0.93 + p * 0.07) }); } catch (e) { if (e.aborted) throw e; } }
        alive();
        await api("/api/story", { method: "POST", body: { fid, tfid, w, h, dur, cap: q("#sc-cap").value.trim(), hours: S.hours, aud: S.aud } });
        progress(1);
        S.busy = false;
        release();
        toast("Публикация добавлена");
        Stories.load(true);
        try { Profile.tab = "posts"; Profile.loadStories(); } catch (e) {}
      } catch (e) {
        S.busy = false;
        q(".sc-prog").classList.add("hidden");
        if (!e.aborted) toast(e.message || "Не удалось опубликовать");
      }
    };
  },
};

// нажатие на аватарку с кольцом открывает публикации (раньше, чем сработает строка списка / шапка чата)
document.addEventListener("click", (e) => {
  const r = e.target.closest && e.target.closest("[data-story]");
  if (!r || Stories.open) return;
  e.stopPropagation(); e.preventDefault();
  haptic("light");
  Stories.openUser(+r.dataset.story);
}, true);
