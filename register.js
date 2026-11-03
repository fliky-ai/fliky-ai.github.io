// register.js — экран входа (номер +888 → код). Совместим с index.html и style.css из проекта.
const Auth = (() => {
  let number = "", timer = null, onDone = null, busy = false, codeLen = 5, resendLeft = 0;

  const $ = (id) => document.getElementById(id);

  const err = (t) => {
    const el = $("auth-err");
    if (el) el.textContent = t || "";
  };

  const shake = (el) => {
    if (!el) return;
    el.classList.remove("shake");
    void el.offsetWidth;
    el.classList.add("shake");
  };

  // +888 1234 5678 (8 цифр, пробел после 4-й)
  const fmtPhone = (digits) => {
    const d = String(digits || "").replace(/\D/g, "").slice(0, 8);
    if (!d) return "";
    return d.length > 4 ? d.slice(0, 4) + " " + d.slice(4) : d;
  };

  const phoneDigits = () => (($("phone") || {}).value || "").replace(/\D/g, "");

  const cells = () => Array.from(document.querySelectorAll("#code-cells .code-cell"));
  const readCode = () => cells().map(c => c.value).join("");
  const focusCell = (i) => {
    const list = cells();
    const c = list[Math.max(0, Math.min(i, list.length - 1))];
    if (c) { c.focus(); try { c.select(); } catch (_) {} }
  };
  const syncHiddenCode = () => {
    const h = $("code");
    if (h) h.value = readCode();
  };

  function syncArrow() {
    const btn = $("btn-phone");
    if (btn) btn.disabled = busy || phoneDigits().length !== 8;
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
      c.setAttribute("aria-label", `Цифра ${i + 1}`);
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
    const s1 = $("step-phone");
    const s2 = $("step-code");
    const active = n === 1 ? s1 : s2;
    const other  = n === 1 ? s2 : s1;

    if (other) other.classList.remove("is-active");
    if (active) active.classList.add("is-active");

    err("");
    setTimeout(() => {
      if (n === 1) $("phone") && $("phone").focus();
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
        b.textContent = `Отправить код снова через ${resendLeft} с`;
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
      shake(document.querySelector(".phone-input-wrap"));
      return;
    }
    busy = true;
    syncArrow();
    err("");

    try {
      const fullNum = "+888" + raw;
      const d = await api("/api/auth/request", { method: "POST", body: { number: fullNum } });
      number = fullNum;

      const codeNumEl = $("code-num");
      if (codeNumEl) codeNumEl.textContent = "+888 " + fmtPhone(raw);

      buildCodeCells(d.len || 5);
      step(2);
      countdown(60);
    } catch (e) {
      err((e && e.message) || "Не удалось отправить код");
      shake(document.querySelector(".phone-input-wrap"));
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
      Store.token = d.token;
      Accounts.clearPrev();
      clearInterval(timer);
      onDone(d.user);
    } catch (e) {
      err((e && e.message) || "Неверный код");
      cells().forEach(c => { c.value = ""; c.classList.remove("filled"); });
      focusCell(0);
      shake($("code-cells"));
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
          syncArrow();
        });
        phoneInp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); sendCode(); }
        });
      }

      const btnPhone = $("btn-phone");
      if (btnPhone) btnPhone.addEventListener("click", sendCode);

      const resendBtn = $("resend");
      if (resendBtn) resendBtn.addEventListener("click", sendCode);

      const changeBtn = $("change-num");
      if (changeBtn) changeBtn.addEventListener("click", () => {
        clearInterval(timer);
        cells().forEach(c => { c.value = ""; c.classList.remove("filled"); });
        syncHiddenCode();
        step(1);
      });

      // Если есть сохранённые аккаунты (пользователь нажал «Добавить аккаунт» или вышел из одного из нескольких),
      // даём вернуться, не вводя номер заново.
      const cancelBtn = $("auth-cancel");
      if (cancelBtn) {
        const accs = Accounts.list();
        if (accs.length) {
          cancelBtn.classList.remove("hidden");
          cancelBtn.addEventListener("click", () => {
            const prev = Accounts.getPrev();
            const acc = accs.find(a => a.token === prev) || accs[0];
            Accounts.clearPrev();
            Store.token = acc.token;
            location.reload();
          });
        }
      }

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
