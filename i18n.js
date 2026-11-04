// i18n.js — два языка: Русский и English.
// Русский текст — это «ключ». T("Текст", a, b) возвращает перевод, подставляя {0}, {1}… Готовые экраны переводятся при построении,
// а всё, что уже лежит в разметке или создано старым кодом, переводится «налету» (текстовые узлы и атрибуты) по тому же словарю.
// Язык меняется с перезагрузкой страницы — так нигде не остаётся перемешанных надписей.
const I18N = (() => {
  let lang = "ru";
  try { lang = localStorage.getItem("lang") === "en" ? "en" : "ru"; } catch (e) {}
  const I = {
    lang, en: {}, rules: [],
    get loc() { return I.lang === "en" ? "en-US" : "ru-RU"; },
    get tloc() { return I.lang === "en" ? "en-US" : undefined; },      // время и день недели: для русского — по настройкам телефона (12/24 ч)
    add(dict) { Object.assign(I.en, dict); },
    rule(re, fn) { I.rules.push([re, fn]); },
    set(l) { try { localStorage.setItem("lang", l === "en" ? "en" : "ru"); } catch (e) {} },
    tr(s) {                      // перевод одной строки (для «налёта»)
      const k = s.trim();
      if (!k) return s;
      let r = I.en[k];
      if (r === undefined) for (const [re, fn] of I.rules) { const m = re.exec(k); if (m) { r = fn(m); break; } }
      return r === undefined ? s : s.replace(k, r);
    },
  };
  return I;
})();

function T(s, ...a) {
  let r = I18N.lang === "en" && I18N.en[s] !== undefined ? I18N.en[s] : s;
  if (a.length) r = r.replace(/\{(\d)\}/g, (m, i) => (a[i] === undefined ? m : a[i]));
  return r;
}

// ── «налётный» перевод DOM (только для English) ──
(function () {
  if (I18N.lang !== "en") return;
  document.documentElement.lang = "en";
  // чужой текст (сообщения, имена, подписи) не трогаем
  const SKIP = ".b,.editor,.prev,.name,.sv-cap,.pi-v,.cb-t span,.pin-t,.s-user,[data-nt],script,style,textarea,input";
  const ATTR = ["placeholder", "aria-label", "title", "data-ph", "alt"];
  const skip = (el) => !el || (el.closest && el.closest(SKIP));
  const text = (n) => {
    if (n.nodeType === 3) {
      const v = n.nodeValue;
      if (v && /[А-Яа-яЁё]/.test(v) && !skip(n.parentElement)) { const r = I18N.tr(v); if (r !== v) n.nodeValue = r; }
    } else if (n.nodeType === 1) {
      if (n.closest && n.closest("[data-nt]")) return;
      for (const a of ATTR) { const v = n.getAttribute && n.getAttribute(a); if (v && /[А-Яа-яЁё]/.test(v)) { const r = I18N.tr(v); if (r !== v) n.setAttribute(a, r); } }
      for (let c = n.firstChild; c; c = c.nextSibling) text(c);
    }
  };
  I18N.apply = (root) => { try { text(root || document.body); } catch (e) {} };
  let busy = false;
  const mo = new MutationObserver((list) => {
    if (busy) return;
    busy = true;
    try {
      for (const m of list) {
        if (m.type === "childList") m.addedNodes.forEach((n) => text(n));
        else if (m.type === "characterData") text(m.target);
        else if (m.type === "attributes") text(m.target);
      }
    } catch (e) {}
    busy = false;
  });
  // словарь (lang_en.js) подключается следом за этим файлом, поэтому первый проход — когда вся страница разобрана
  const observe = () => mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTR });
  const first = () => I18N.apply(document.body);
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", () => { first(); observe(); }); }
  else { first(); observe(); }
})();
