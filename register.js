
const Auth = (() => {
  let number = "", timer = null, onDone = null, busy = false, codeLen = 5;
  let resendLeft = 0;

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

  // Маска: +888 1234 5678 (пробелы только для отображения, в логике — цифры)
  const fmtPhone = (digits) => {
    const d = digits.replace(/\D/g, "").slice(0, 8);
    let o = "";
    if (d.length) o += d.slice(0, 4);
    if (d.length > 4) o += " " + d.slice(4, 8);
    return o;
  };

  function step(n) {
    const s1 = $("step-phone");
    const s2 = $("step-code");
    const active = n === 1 ? s1 : s2;
    const other  = n === 1 ? s2 : s1;

    if (other) {
      other.classList.remove("is-active");
      other.classList.add("is-leaving");
      setTimeout(() => other.classList.remove("is-leaving"), 300);
    }
    if (active) active.classList.add("is-active");

    err("");
    setTimeout(() => {
      if (n === 1) $("phone")?.focus();
      else firstCodeCell()?.focus();
    }, 120);
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

  // ---------- Кодовые ячейки ----------
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
      c.dataset.i = String(i);
      c.autocomplete = "one-time-code";
      c.addEventListener("input", onCellInput);
      c.addEventListener("keydown", onCellKey);
      c.addEventListener("paste", onCellPaste);
      wrap.appendChild(c);
    }
    syncHiddenCode();
  }

  const cells = () => Array.from(document.querySelectorAll("#code-cells .code-cell"));
  const firstCodeCell = () => cells()[0];
  const readCode = () => cells().map(c => c.value).join("");
  const syncHiddenCode = () => { const h = $("code"); if (h) h.value = readCode(); };

  function focusCell(i) { const c = cells()[i]; if (c) { c.focus(); c.select?.(); } }

  function onCellInput(e) {
    const el = e.target;
    let v = el.value.replace(/\D/g, "");
    if (v.length > 1) {
      // пользователь вставил несколько цифр в ячейку
      const idx = Number(el.dataset.i);
      const all = cells();
      for (let k = 0; k < v.length && idx + k < all.length; k++) {
        all[idx + k].value = v[k];
        all[idx + k].classList.toggle("filled", !!v[k]);
      }
      focusCell(Math.min(idx + v.length, all.length - 1));
    } else {
      el.value = v;
      el.classList.toggle("filled", !!v);
      if (v) {
        const idx = Number(el.dataset.i);
        focusCell(idx + 1);
      }
    }
    syncHiddenCode();
    if (readCode().length === codeLen) verify();
  }

  function onCellKey(e) {
    if (e.key === "Backspace") {
      const el = e.target;
      if (!el.value) {
        const idx = Number(el.dataset.i);
        if (idx > 0) focusCell(idx - 1);
        e.preventDefault();
      }
    } else if (e.key === "ArrowLeft") {
      focusCell(Number(e.target.dataset.i) - 1); e.preventDefault();
    } else if (e.key === "ArrowRight") {
      focusCell(Number(e.target.dataset.i) + 1); e.preventDefault();
    } else if (e.key === "Enter") {
      verify();
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
    focusCell(Math.min(d.length, all.length - 1));
    if (readCode().length === codeLen) verify();
  }

  // ---------- API ----------
  function phoneValid() {
    return $("phone")?.value.replace(/\D/g, "").length === 8;
  }

  function syncArrow() {
    const btn = $("btn-phone");
    if (btn) btn.disabled = !phoneValid() || busy;
  }

  async function sendCode() {
    if (busy) return;
    const raw = ($("phone")?.value || "").replace(/\D/g, "");
    if (raw.length < 8) {
      err("Введите номер полностью (8 цифр)");
      shake(document.querySelector(".phone-input-wrap"));
      return;
    }
    busy = true;
    const btn = $("btn-phone");
    if (btn) btn.disabled = true;
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
      err(e.message);
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
    const wrap = $("code-cells");

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
      clearInterval(timer);
      onDone(d.user);
    } catch (e) {
      err(e.message);
      cells().forEach(c => { c.value = ""; c.classList.remove("filled"); });
      focusCell(0);
      shake(wrap);
    }
    busy = false;
  }

  // ---------- Публичный init ----------
  return {
    init(done) {
      onDone = done;
      $("auth")?.classList.remove("hidden");

      const phoneInp = $("phone");
      if (phoneInp) {
        // Маска с сохранением позиции курсора
        phoneInp.addEventListener("input", (e) => {
          const digits = e.target.value.replace(/\D/g, "");
          e.target.value = fmtPhone(digits);
          syncArrow();
        });
        phoneInp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") sendCode();
        });
      }

      $("btn-phone")?.addEventListener("click", sendCode);
      $("resend")?.addEventListener("click", sendCode);
      $("change-num")?.addEventListener("click", () => {
        clearInterval(timer);
        // сброс кода
        cells().forEach(c => { c.value = ""; c.classList.remove("filled"); });
        syncHiddenCode();
        step(1);
      });

      // скрытое поле кода — только как буфер (основной ввод в ячейках)
      const hidden = $("code");
      if (hidden) {
        hidden.addEventListener("input", () => {
          const d = hidden.value.replace(/\D/g, "").slice(0, codeLen);
          const all = cells();
          d.split("").forEach((ch, k) => { if (all[k]) { all[k].value = ch; all[k].classList.add("filled"); } });
          if (d.length === codeLen) verify();
        });
      }

      buildCodeCells(5);
      syncArrow();
      step(1);
    }
  };
})();