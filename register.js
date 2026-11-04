// register.js — экран входа в стиле Telegram (номер +888 → код из бота).
// Разметка — index.html (#auth), стили — style.css (блок «ВХОД В СТИЛЕ TELEGRAM»).
const Auth = (() => {
  let number = "", timer = null, onDone = null, busy = false, codeLen = 5, resendLeft = 0, cur = 1, ticket = "";

  const $ = (id) => document.getElementById(id);

  // Текст ошибки под полем; на шаге с номером ещё и подсвечиваем рамку красным.
  const err = (t) => {
    const el = $("auth-err");
    if (el) el.textContent = t || "";
    const f = $("phone-field");
    if (f) f.classList.toggle("error", !!t && cur === 1);
  };

  const shake = (el) => {
    if (!el) return;
    el.classList.remove("shake");
    void el.offsetWidth;
    el.classList.add("shake");
  };

  // 1234 5678: только 8 цифр, пробел после 4-й. Вставленный целиком номер с +888 тоже понимаем.
  const fmtPhone = (digits) => {
    let d = String(digits || "").replace(/\D/g, "");
    if (d.length > 8 && d.startsWith("888")) d = d.slice(3);
    d = d.slice(0, 8);
    if (!d) return "";
    return d.length > 4 ? d.slice(0, 4) + " " + d.slice(4) : d;
  };

  const phoneDigits = () => (($("phone") || {}).value || "").replace(/\D/g, "");

  const cells = () => Array.from(document.querySelectorAll("#code-cells .code-cell"));
  const readCode = () => cells().map(c => c.value).join("");
  const clearCells = () => cells().forEach(c => { c.value = ""; c.classList.remove("filled"); });
  const focusCell = (i) => {
    const list = cells();
    const c = list[Math.max(0, Math.min(i, list.length - 1))];
    if (c) { c.focus(); try { c.select(); } catch (_) {} }
  };
  const syncHiddenCode = () => {
    const h = $("code");
    if (h) h.value = readCode();
  };

  // Кнопка «Далее» активна всегда (как в Telegram); неполный номер проверяет sendCode().
  function syncArrow() {
    const btn = $("btn-phone");
    if (btn) btn.disabled = busy;
  }

  // Стрелка «назад»: на шаге с кодом возвращает к номеру; на шаге с номером показываем её
  // только если есть куда вернуться (сохранённые аккаунты) — иначе она бы ничего не делала.
  function updateBack() {
    const b = $("auth-back");
    if (!b) return;
    b.classList.toggle("off", !(cur >= 2 || Accounts.list().length > 0));
  }

  function goBack() {
    if (cur === 2 || cur === 3) {
      clearInterval(timer);
      clearCells();
      syncHiddenCode();
      ticket = "";
      const p = $("pass"); if (p) p.value = "";
      step(1);
      return;
    }
    const accs = Accounts.list();
    if (!accs.length) return;
    const prev = Accounts.getPrev();
    const acc = accs.find(a => a.token === prev) || accs[0];
    Accounts.clearPrev();
    Store.token = acc.token;
    location.reload();
  }

  function buildCodeCells(len) {
    codeLen = len;
    const wrap = $("code-cells");
    if (!wrap) return;
    wrap.innerHTML = "";
    wrap.dataset.len = String(len);
    for (let i = 0; i < len; i++) {
      const c = document.createElement("input");
      c.className = "code-cell";
      c.type = "text";
      c.inputMode = "numeric";
      c.maxLength = 1;
      c.autocomplete = "one-time-code";
      c.dataset.i = String(i);
      c.setAttribute("aria-label", T("Цифра {0}", i + 1));
      c.addEventListener("input", onCellInput);
      c.addEventListener("keydown", onCellKey);
      c.addEventListener("paste", onCellPaste);
      c.addEventListener("focus", () => c.select && c.select());
      wrap.appendChild(c);
    }
    syncHiddenCode();
  }

  function onCellInput(e) {
    const el = e.target;
    const idx = Number(el.dataset.i);
    const v = el.value.replace(/\D/g, "");

    if (v.length > 1) {
      const all = cells();
      let k = 0;
      for (; k < v.length && idx + k < all.length; k++) {
        all[idx + k].value = v[k];
        all[idx + k].classList.add("filled");
      }
      focusCell(idx + v.length);
    } else {
      el.value = v;
      el.classList.toggle("filled", !!v);
      if (v) focusCell(idx + 1);
    }

    err("");
    syncHiddenCode();
    if (readCode().length === codeLen) verify();
  }

  function onCellKey(e) {
    const el = e.target;
    const idx = Number(el.dataset.i);

    if (e.key === "Backspace") {
      if (!el.value) {
        focusCell(idx - 1);
        e.preventDefault();
      }
    } else if (e.key === "ArrowLeft") {
      focusCell(idx - 1); e.preventDefault();
    } else if (e.key === "ArrowRight") {
      focusCell(idx + 1); e.preventDefault();
    } else if (e.key === "Enter") {
      verify(); e.preventDefault();
    }
  }

  function onCellPaste(e) {
    const txt = (e.clipboardData || window.clipboardData).getData("text") || "";
    const d = txt.replace(/\D/g, "").slice(0, codeLen);
    if (!d) return;
    e.preventDefault();
    const all = cells();
    d.split("").forEach((ch, k) => {
      if (all[k]) { all[k].value = ch; all[k].classList.add("filled"); }
    });
    syncHiddenCode();
    focusCell(d.length);
    if (readCode().length === codeLen) verify();
  }

  // Показываем только активный шаг (остальные display:none в style.css) — раскладка не «прыгает».
  function step(n) {
    cur = n;
    const auth = $("auth");
    if (auth) auth.dataset.step = String(n);   // на шаге 2 CSS прячет круглую кнопку
    const s1 = $("step-phone"), s2 = $("step-code"), s3 = $("step-pass");
    if (s1) s1.classList.toggle("is-active", n === 1);
    if (s2) s2.classList.toggle("is-active", n === 2);
    if (s3) s3.classList.toggle("is-active", n === 3);

    err("");
    updateBack();
    setTimeout(() => {
      if (cur !== n) return;
      if (n === 1) { const p = $("phone"); if (p) p.focus(); }
      else if (n === 3) { const p = $("pass"); if (p) p.focus(); }
      else focusCell(0);
    }, 140);
  }

  function countdown(s) {
    clearInterval(timer);
    const b = $("resend");
    if (!b) return;
    b.disabled = true;
    resendLeft = s;
    const render = () => {
      if (resendLeft > 0) {
        const m = Math.floor(resendLeft / 60), sec = String(resendLeft % 60).padStart(2, "0");
        b.textContent = T("Отправить код снова через {0}", `${m}:${sec}`);
      } else {
        b.textContent = "Отправить код снова";
        b.disabled = false;
        clearInterval(timer);
      }
    };
    render();
    timer = setInterval(() => { resendLeft--; render(); }, 1000);
  }

  async function sendCode() {
    if (busy) return;
    const raw = phoneDigits();
    if (raw.length !== 8) {
      err("Введите номер полностью (8 цифр)");
      shake($("phone-field"));
      return;
    }
    busy = true;
    syncArrow();
    err("");

    try {
      const fullNum = "+888" + raw;
      // этот номер уже добавлен (в том числе текущий аккаунт) — второй раз войти в него нельзя
      const dup = Accounts.list().find((a) => a.number === fullNum);
      if (dup && (await Accounts.alive(dup.token))) throw new Error(T("Этот аккаунт уже добавлен"));
      if (dup) Accounts.remove(dup.token);                // сеанс умер — убираем запись, можно войти заново
      const d = await api("/api/auth/request", { method: "POST", body: { number: fullNum } });
      number = fullNum;

      const title = $("code-num");
      if (title) title.textContent = "+888 " + fmtPhone(raw);

      buildCodeCells(d.len || 5);
      step(2);
      countdown(60);
    } catch (e) {
      err((e && e.message) || "Не удалось отправить код");
      shake($("phone-field"));
    }
    busy = false;
    syncArrow();
  }

  async function verify() {
    if (busy) return;
    const code = readCode();
    if (code.length !== codeLen) return;

    busy = true;
    err("");

    try {
      const d = await api("/api/auth/verify", {
        method: "POST",
        body: {
          number,
          code,
          tz: new Date().getTimezoneOffset(),
          platform: (typeof TGW !== "undefined" && TGW && TGW.platform) || ""
        }
      });
      if (d.need_password) {                 // у аккаунта есть облачный пароль — просим его
        ticket = d.ticket;
        const h = $("pass-hint"); if (h) h.textContent = d.hint ? T("Подсказка: {0}", d.hint) : "";
        const p = $("pass"); if (p) p.value = "";
        clearInterval(timer);
        step(3);
      } else await finish(d);
    } catch (e) {
      if (e && e.message === T("Этот аккаунт уже добавлен")) { clearCells(); syncHiddenCode(); step(1); err(e.message); busy = false; return; }
      err((e && e.message) || "Неверный код");
      clearCells();
      syncHiddenCode();
      focusCell(0);
      shake($("code-cells"));
    }
    busy = false;
  }

  // вход выполнен: проверяем, что такого аккаунта в списке ещё нет
  async function finish(d) {
    const same = Accounts.list().find((a) => a.id === d.user.id && a.token !== d.token);
    if (same) {
      if (await Accounts.alive(same.token)) {
        // этот аккаунт уже добавлен: новый сеанс закрываем, чтобы он не остался «висеть» в устройствах
        try { await fetch(CONFIG.API + "/api/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + d.token, "Content-Type": "application/json" }, body: "{}" }); } catch (e) {}
        throw new Error(T("Этот аккаунт уже добавлен"));
      }
      Accounts.remove(same.token);
    }
    Store.token = d.token;
    Accounts.clearPrev();
    clearInterval(timer);
    onDone(d.user);
  }

  async function submitPass() {
    if (busy) return;
    const inp = $("pass"), pw = inp ? inp.value : "";
    if (!pw) { err(T("Введите пароль")); shake($("pass-field")); return; }
    busy = true; err("");
    try {
      const d = await api("/api/auth/password", { method: "POST", body: { ticket, password: pw } });
      await finish(d);
    } catch (e) {
      if (e && e.message === T("Этот аккаунт уже добавлен")) { const p = $("pass"); if (p) p.value = ""; busy = false; step(1); err(e.message); return; }
      err((e && e.message) || T("Неверный пароль"));
      if (inp) { inp.value = ""; inp.focus(); }
      shake($("pass-field"));
      if (/истекло|заново/i.test((e && e.message) || "")) setTimeout(() => goBack(), 900);
    }
    busy = false;
  }

  return {
    init(done) {
      onDone = done;
      const authSec = $("auth");
      if (authSec) authSec.classList.remove("hidden");

      const phoneInp = $("phone");
      if (phoneInp) {
        phoneInp.addEventListener("input", () => {
          phoneInp.value = fmtPhone(phoneInp.value);
          err("");
          syncArrow();
        });
        phoneInp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); sendCode(); }
        });
      }

      const btnPhone = $("btn-phone");
      if (btnPhone) btnPhone.addEventListener("click", () => (cur === 3 ? submitPass() : sendCode()));
      const passInp = $("pass");
      if (passInp) {
        passInp.addEventListener("input", () => err(""));
        passInp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submitPass(); } });
      }

      const resendBtn = $("resend");
      if (resendBtn) resendBtn.addEventListener("click", sendCode);

      const changeBtn = $("change-num");
      if (changeBtn) changeBtn.addEventListener("click", goBack);

      const backBtn = $("auth-back");
      if (backBtn) backBtn.addEventListener("click", goBack);

      // скрытое #code — буфер для автозаполнения Telegram (one-time-code)
      const hidden = $("code");
      if (hidden) {
        hidden.addEventListener("input", () => {
          const d = hidden.value.replace(/\D/g, "").slice(0, codeLen);
          const all = cells();
          d.split("").forEach((ch, k) => {
            if (all[k]) { all[k].value = ch; all[k].classList.add("filled"); }
          });
          if (d.length === codeLen) verify();
        });
      }

      buildCodeCells(5);
      syncArrow();
      step(1);
    }
  };
})();
