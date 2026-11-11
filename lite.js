// lite.js — «облегчённый режим» для слабых и 32-битных телефонов. Подключается самым первым, до остальных скриптов.
// Что делает:
//  • определяет 32-битную сборку браузера/WebView (navigator.platform = armv7l / armv8l) и слабое устройство (≤2 ГБ памяти);
//  • включает html.lite: без размытия, без бесконечных анимаций, 3D-подарки рисуются на обычном canvas (без WebGL),
//    картинки меньше, частота кадров ниже — подарки открываются и покупаются без лагов;
//  • выравнивает размер текста: все получают 16 по умолчанию, а масштаб шрифта, навязанный системой телефона, компенсируется.
// Переключатель: localStorage pf_lite = "1" (всегда) / "0" (никогда) / нет значения (автоопределение).
(function () {
  var W = window, H = document.documentElement, N = navigator, L = { on: false, bit32: false, low: false, txt: 1 };
  W.LITE = L;
  try {
    var plat = String(N.platform || ""), ua = String(N.userAgent || "");
    L.bit32 = /armv7|armv8l|armeabi|i[3-6]86/i.test(plat) || /\b(armv7l|armv8l)\b/i.test(ua);
    var mem = +N.deviceMemory || 0, cores = +N.hardwareConcurrency || 0;
    L.low = !!((mem && mem <= 2) || (cores && cores <= 4 && /Android/i.test(ua) && mem && mem <= 3));
    var ov = localStorage.getItem("pf_lite");
    L.on = ov === "1" ? true : ov === "0" ? false : (L.bit32 || L.low);
  } catch (e) {}
  if (L.on) H.classList.add("lite", "no-blur", "eco-anim");

  // ── размер текста: единый 16 для всех (один раз сбрасываем старые значения, сохранённые на разных телефонах) ──
  try {
    if (localStorage.getItem("pf_fsm") !== "3") {
      localStorage.setItem("pf_fs", "16");
      localStorage.setItem("pf_fsm", "3");
      H.style.setProperty("--fsk", "1");
    }
  } catch (e) {}

  // ── масштаб шрифта, навязанный телефоном (системный «Размер шрифта» / автоподгонка): меряем и убираем ──
  function probe() {
    try {
      var d = document.createElement("span");
      d.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font:16px/1 Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;text-size-adjust:100%";
      d.textContent = "MMMMMMMMMMmmmmmmmmmm0123456789";
      (document.body || H).appendChild(d);
      var w = d.getBoundingClientRect().width, c = document.createElement("canvas").getContext("2d");
      c.font = "16px Arial,Helvetica,sans-serif";
      var cw = c.measureText(d.textContent).width;
      d.parentNode.removeChild(d);
      var r = w / cw;
      return r > 1.04 && r < 1.7 ? r : 1;                       // всё в пределах 4% — это погрешность шрифта, не масштаб
    } catch (e) { return 1; }
  }
  L.measure = function () {
    var r = probe();
    L.txt = r > 1 ? Math.max(0.6, 1 / r) : 1;
    H.style.setProperty("--txk", String(L.txt));
    try { var fs = JSON.parse(localStorage.getItem("pf_fs")); fs = fs >= 12 && fs <= 26 ? fs : 16; H.style.setProperty("--fsk", String(fs / 16 * L.txt)); } catch (e) {}
    return L.txt;
  };
  H.style.setProperty("-webkit-text-size-adjust", "100%");
  H.style.setProperty("text-size-adjust", "100%");
  function go() { try { L.measure(); } catch (e) {} }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(go, 0); });
  else setTimeout(go, 0);
})();
