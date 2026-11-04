// intro.js — вводный экран Dicegram, как в Telegram: большие анимированные картинки, листание, точки и «Начать общение».
// Показывается один раз, до входа. Картинки нарисованы кодом (SVG + CSS), без файлов.

const Intro = (() => {
  const SLIDES = [
    { t: "Dicegram", d: "Мессенджер, в котором приятно общаться: быстрый, красивый и всегда под рукой.", art: "die" },
    { t: "Мгновенно", d: "Сообщения доходят сразу. Работает и как приложение на телефоне, и как мини-приложение.", art: "plane" },
    { t: "Выразительно", d: "Анимированные эмодзи, реакции, стикеры и GIF — их можно создать за пару секунд.", art: "star" },
    { t: "Вместе", d: "Группы, каналы, звонки и истории — всё в одном месте и в одном стиле.", art: "chat" },
    { t: "Premium", d: "Больше реакций, свои эмодзи и статусы, подарки друзьям и коллекционные подарки.", art: "crown" },
  ];
  const ART = {
    die: `<div class="ia ia-die"><i class="glow"></i><div class="dice"><b></b><b></b><b></b><b></b><b></b></div><u class="c1"></u><u class="c2"></u><u class="c3"></u><u class="c4"></u></div>`,
    plane: `<div class="ia ia-plane"><i class="glow"></i><svg class="trail" viewBox="0 0 260 200" fill="none"><path d="M10 170Q90 150 120 100T250 30" stroke="currentColor" stroke-width="3" stroke-dasharray="3 9" stroke-linecap="round"/></svg><svg class="pl" viewBox="0 0 64 64"><defs><linearGradient id="ipg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7cb7ff"/><stop offset="1" stop-color="#3d6bff"/></linearGradient></defs><path d="M58 6 6 28l16 6 6 20 8-12 14 10z" fill="url(#ipg)"/><path d="M58 6 22 34l6 20 8-12z" fill="#fff" fill-opacity=".35"/></svg></div>`,
    star: `<div class="ia ia-star"><i class="glow y"></i><svg class="st" viewBox="0 0 64 64"><defs><linearGradient id="isg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe46b"/><stop offset="1" stop-color="#ff9d1c"/></linearGradient></defs><path d="M32 4l8.2 17.2 18.8 2.4-13.8 13 3.5 18.6L32 45.9 15.3 55.2l3.5-18.6L5 23.6l18.8-2.4z" fill="url(#isg)" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg><u class="s1">✨</u><u class="s2">⭐</u><u class="s3">✨</u><u class="s4">💫</u></div>`,
    chat: `<div class="ia ia-chat"><i class="glow"></i><div class="bb b1">Привет! 👋</div><div class="bb b2">Как дела?</div><div class="bb b3">Отлично 🎉</div></div>`,
    crown: `<div class="ia ia-crown"><i class="glow p"></i><div class="badge"><svg viewBox="0 0 64 64"><defs><linearGradient id="icg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b58bff"/><stop offset="1" stop-color="#5b8cff"/></linearGradient></defs><circle cx="32" cy="32" r="28" fill="url(#icg)"/><path d="M32 13l5.6 11.7 12.9 1.6-9.5 8.9 2.4 12.7L32 41.4 20.6 47.9 23 35.2l-9.5-8.9 12.9-1.6z" fill="#fff"/></svg><i class="shine"></i></div><u class="s1">⭐</u><u class="s2">✨</u><u class="s3">⭐</u></div>`,
  };
  let el = null, idx = 0, auto = 0, done = null;

  const seen = () => { try { return localStorage.getItem("intro_seen") === "1"; } catch (e) { return false; } };
  const mark = () => { try { localStorage.setItem("intro_seen", "1"); } catch (e) {} };

  function go(i, smooth = true) {
    const sc = el.querySelector(".in-track");
    idx = Math.max(0, Math.min(SLIDES.length - 1, i));
    sc.scrollTo({ left: idx * sc.clientWidth, behavior: smooth ? "smooth" : "auto" });
    paint();
  }
  function paint() {
    el.querySelectorAll(".in-dots i").forEach((d, k) => d.classList.toggle("on", k === idx));
    el.querySelectorAll(".in-sl").forEach((s, k) => s.classList.toggle("act", k === idx));
  }
  function finish() {
    clearInterval(auto); mark();
    if (!el) return;
    el.classList.add("out");
    const e = el; el = null;
    setTimeout(() => e.remove(), 380);
    if (done) { const f = done; done = null; f(); }
  }

  function show(cb) {
    done = cb;
    if (el) el.remove();
    el = document.createElement("div");
    el.className = "intro";
    el.innerHTML = `<div class="in-top"><button class="in-skip" type="button">${esc(T("Пропустить"))}</button></div>
      <div class="in-track">${SLIDES.map((s, i) => `<section class="in-sl${i ? "" : " act"}"><div class="in-art">${ART[s.art]}</div><h2>${esc(T(s.t))}</h2><p>${esc(T(s.d))}</p></section>`).join("")}</div>
      <div class="in-bot"><div class="in-dots">${SLIDES.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div>
      <button class="in-go" type="button">${esc(T("Начать общение"))}</button></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    const sc = el.querySelector(".in-track");
    let t = 0;
    sc.addEventListener("scroll", () => {
      clearTimeout(t);
      t = setTimeout(() => { const i = Math.round(sc.scrollLeft / sc.clientWidth); if (i !== idx) { idx = i; paint(); } }, 60);
    }, { passive: true });
    ["touchstart", "pointerdown", "wheel"].forEach((ev) => sc.addEventListener(ev, () => clearInterval(auto), { passive: true }));
    el.querySelector(".in-go").onclick = finish;
    el.querySelector(".in-skip").onclick = finish;
    el.querySelector(".in-dots").onclick = (e) => { const k = [...el.querySelectorAll(".in-dots i")].indexOf(e.target); if (k >= 0) { clearInterval(auto); go(k); } };
    auto = setInterval(() => { if (!el) return clearInterval(auto); go(idx + 1 >= SLIDES.length ? 0 : idx + 1); }, 4200);
  }
  return { seen, show, finish };
})();
