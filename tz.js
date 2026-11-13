// tz.js — время аккаунта. По умолчанию — время телефона. Можно сдвинуть на ±N часов или выбрать пояс (Казахстан, Москва);
// выбор хранится в аккаунте (Prefs.cloud("tz")), поэтому на любом устройстве время показывается одинаково.
// Реализовано подменой «местных» геттеров Date и toLocale*String — так во всех местах приложения время меняется разом.
const TZ = (() => {
  const P = Date.prototype;
  const orig = { off: P.getTimezoneOffset, tls: P.toLocaleTimeString, tld: P.toLocaleDateString, tl: P.toLocaleString };
  const G = {}, NAMES = ["FullYear", "Month", "Date", "Day", "Hours", "Minutes", "Seconds"];
  NAMES.forEach((n) => { G[n] = P["get" + n]; });
  let mode = "", val = 0;                                  // "" — как на телефоне, "adj" — сдвиг (минуты), "abs" — фиксированный пояс (минуты от UTC)
  const dev = (d) => -orig.off.call(d);                    // пояс телефона на эту дату (минуты на восток)
  const at = (d) => mode === "abs" ? val : mode === "adj" ? dev(d) + val : null;
  NAMES.forEach((n) => {
    P["get" + n] = function () { const o = at(this); return o === null ? G[n].call(this) : P["getUTC" + n].call(new Date(this.getTime() + o * 60000)); };
  });
  P.getTimezoneOffset = function () { const o = at(this); return o === null ? orig.off.call(this) : -o; };
  const wrap = (f) => function (l, o) {
    const s = at(this);
    if (s === null || (o && o.timeZone)) return f.call(this, l, o);
    return f.call(new Date(this.getTime() + s * 60000), l, Object.assign({}, o, { timeZone: "UTC" }));
  };
  P.toLocaleTimeString = wrap(orig.tls); P.toLocaleDateString = wrap(orig.tld); P.toLocaleString = wrap(orig.tl);

  const PRESETS = { kz: ["abs:300", "Казахстан"], msk: ["abs:180", "Москва"] };
  const parse = (s) => {
    const m = /^(adj|abs):(-?\d{1,4})$/.exec(String(s || ""));
    if (!m) return ["", 0];
    const v = +m[2];
    return m[1] === "adj" ? (v && Math.abs(v) <= 14 * 60 ? ["adj", v] : ["", 0]) : (Math.abs(v) <= 14 * 60 ? ["abs", v] : ["", 0]);
  };
  const fmtOff = (m) => "UTC" + (m < 0 ? "−" : "+") + Math.floor(Math.abs(m) / 60) + (Math.abs(m) % 60 ? ":" + String(Math.abs(m) % 60).padStart(2, "0") : "");
  return {
    PRESETS,
    apply(s) { [mode, val] = parse(s); },
    get() { return mode ? mode + ":" + val : ""; },
    mode: () => mode,
    deviceOffset: () => dev(new Date()),
    offset: () => { const o = at(new Date()); return o === null ? dev(new Date()) : o; },
    label() { return fmtOff(TZ.offset()); },
    // новое значение при нажатии «+1 ч» / «−1 ч» (сдвиг считается от времени телефона)
    shift(h) {
      const cur = mode === "abs" ? val - dev(new Date()) : mode === "adj" ? val : 0;
      let n = cur + h * 60;
      n = Math.max(-14 * 60, Math.min(14 * 60, n));
      return n ? "adj:" + n : "";
    },
    clock() { return new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); },
    deviceClock() { return new Date(Date.now()).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }); },
  };
})();
