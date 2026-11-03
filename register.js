// Экран входа в стиле Telegram: выбор страны (+888), плавная анимация, кнопка-стрелочка.
const Auth = (() => {
  let number = "", timer = null, onDone = null, busy = false, codeLen = 5;

  const err = (t) => {
    const el = $("auth-err");
    if (el) el.textContent = t || "";
  };

  const fmt = (v) => {
    const d = v.replace(/\D/g, "").slice(0, 8); // 8 цифр для +888 хххх хххх
    if (!d) return "";
    let o = "";
    if (d.length > 0) o += d.slice(0, 4);
    if (d.length > 4) o += " " + d.slice(4, 8);
    return o;
  };

  function step(n) {
    const s1 = $("step-phone");
    const s2 = $("step-code");
    if (s1 && s2) {
      s1.classList.toggle("hidden", n !== 1);
      s2.classList.toggle("hidden", n !== 2);
    }
    err("");
    setTimeout(() => {
      const target = $(n === 1 ? "phone" : "code");
      if (target) target.focus();
    }, 100);
  }

  function countdown(s) {
    clearInterval(timer);
    const b = $("resend");
    if (!b) return;
    b.disabled = true;
    const tick = () => {
      b.textContent = s > 0 ? `Отправить код снова через ${s} с` : "Отправить код снова";
      if (s <= 0) { b.disabled = false; clearInterval(timer); }
      s--;
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  async function sendCode() {
    if (busy) return;
    const raw = $("phone").value.replace(/\D/g, "");
    if (raw.length < 8) {
      err("Введите номер полностью (8 цифр)");
      const inpBox = document.querySelector(".phone-input-wrap");
      if (inpBox) { inpBox.classList.remove("shake"); void inpBox.offsetWidth; inpBox.classList.add("shake"); }
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
      codeLen = d.len || 5;
      
      const codeNumEl = $("code-num");
      if (codeNumEl) codeNumEl.textContent = "+888 " + fmt(raw);
      
      const codeInput = $("code");
      if (codeInput) {
        codeInput.value = "";
        codeInput.maxLength = codeLen;
        codeInput.placeholder = "•".repeat(codeLen);
      }
      step(2);
      countdown(60);
    } catch (e) {
      err(e.message);
    }
    busy = false;
    if (btn) btn.disabled = false;
  }

  async function verify() {
    const codeInp = $("code");
    if (!codeInp) return;
    const code = codeInp.value.trim();
    if (code.length < codeLen || busy) return;
    busy = true;
    err("");

    try {
      const d = await api("/api/auth/verify", {
        method: "POST",
        body: {
          number,
          code,
          tz: new Date().getTimezoneOffset(),
          platform: (TGW && TGW.platform) || ""
        }
      });
      Store.token = d.token;
      clearInterval(timer);
      onDone(d.user);
    } catch (e) {
      err(e.message);
      codeInp.value = "";
      const wrap = codeInp.closest(".step") || codeInp;
      wrap.classList.remove("shake");
      void wrap.offsetWidth;
      wrap.classList.add("shake");
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
        phoneInp.addEventListener("input", (e) => {
          let v = e.target.value.replace(/\D/g, "");
          e.target.value = fmt(v);
        });
        phoneInp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") sendCode();
        });
      }

      const btnPhone = $("btn-phone");
      if (btnPhone) btnPhone.onclick = sendCode;

      const codeInp = $("code");
      if (codeInp) {
        codeInp.addEventListener("input", (e) => {
          e.target.value = e.target.value.replace(/\D/g, "");
          if (e.target.value.length === codeLen) {
            verify();
          }
        });
        codeInp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") verify();
        });
      }

      const resendBtn = $("resend");
      if (resendBtn) resendBtn.onclick = sendCode;

      const changeNumBtn = $("change-num");
      if (changeNumBtn) changeNumBtn.onclick = () => { clearInterval(timer); step(1); };

      step(1);
    }
  };
})();

