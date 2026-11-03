// Экран входа: номер → код из бота → вход.
const Auth = (() => {
  let number = "", timer = null, onDone = null, busy = false;
  const err = (t) => { $("auth-err").textContent = t || ""; };
  const fmt = (v) => {
    const d = v.replace(/\D/g, "").slice(0, 15);
    if (!d) return "";
    let o = "+" + d.slice(0, 3);
    if (d.length > 3) o += " " + d.slice(3, 7);
    if (d.length > 7) o += " " + d.slice(7);
    return o;
  };
  function step(n) {
    $("step-phone").classList.toggle("hidden", n !== 1);
    $("step-code").classList.toggle("hidden", n !== 2);
    err("");
    setTimeout(() => $(n === 1 ? "phone" : "code").focus(), 60);
  }
  function countdown(s) {
    clearInterval(timer);
    const b = $("resend"); b.disabled = true;
    const tick = () => {
      b.textContent = s > 0 ? `Отправить код снова через ${s} с` : "Отправить код снова";
      if (s <= 0) { b.disabled = false; clearInterval(timer); }
      s--;
    };
    tick(); timer = setInterval(tick, 1000);
  }
  async function sendCode() {
    if (busy) return;
    const raw = $("phone").value.replace(/\D/g, "");
    if (raw.length < 8) return err("Введите номер полностью");
    busy = true; $("btn-phone").disabled = true; err("");
    try {
      await api("/api/auth/request", { method: "POST", body: { number: "+" + raw } });
      number = "+" + raw;
      $("code-num").textContent = fmt(raw);
      $("code").value = "";
      step(2); countdown(60);
    } catch (e) { err(e.message); }
    busy = false; $("btn-phone").disabled = false;
  }
  async function verify() {
    const code = $("code").value;
    if (code.length < 5 || busy) return;
    busy = true; err("");
    try {
      const d = await api("/api/auth/verify", { method: "POST", body: { number, code } });
      Store.token = d.token; clearInterval(timer);
      onDone(d.user);
    } catch (e) {
      err(e.message); $("code").value = "";
      const c = $("code"); c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake");
    }
    busy = false;
  }
  return {
    init(done) {
      onDone = done;
      $("auth").classList.remove("hidden");
      $("phone").addEventListener("input", (e) => {
        let v = e.target.value; if (!v.startsWith("+")) v = "+" + v.replace(/\D/g, "");
        e.target.value = fmt(v);
      });
      $("phone").addEventListener("keydown", (e) => { if (e.key === "Enter") sendCode(); });
      $("btn-phone").onclick = sendCode;
      $("code").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, ""); if (e.target.value.length === 5) verify(); });
      $("resend").onclick = sendCode;
      $("change-num").onclick = () => { clearInterval(timer); step(1); };
      $("phone").value = "+888"; step(1);
    },
  };
})();
