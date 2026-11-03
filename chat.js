// Экран переписки.
const Chat = {
  peer: null, msgs: [],

  bind() {
    $("chat-back").onclick = () => Chat.close();
    const inp = $("msg-input");
    inp.addEventListener("input", () => {
      inp.style.height = "auto"; inp.style.height = Math.min(inp.scrollHeight, 120) + "px";
      $("send").classList.toggle("show", !!inp.value.trim());
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer:fine)").matches) { e.preventDefault(); Chat.send(); }
    });
    $("send").onclick = () => Chat.send();
    try { Telegram.WebApp.BackButton.onClick(() => Chat.close()); } catch (e) {}
  },

  async open(peer) {
    Chat.peer = peer; Chat.msgs = [];
    $("chat-av").innerHTML = avatar(peer, "sm");
    $("chat-name").innerHTML = nameHTML(peer);
    $("chat-sub").textContent = peer.is_system ? "официальный аккаунт" : peer.number;
    $("composer").classList.toggle("hidden", !!peer.is_system);
    $("readonly").classList.toggle("hidden", !peer.is_system);
    $("msgs").innerHTML = "";
    $("msg-input").value = ""; $("send").classList.remove("show");
    $("chat").classList.add("open"); $("chat").setAttribute("aria-hidden", "false");
    try { Telegram.WebApp.BackButton.show(); } catch (e) {}
    try {
      Chat.msgs = (await api("/api/messages/" + peer.id)).messages;
      Chat.render(); Chats.load();
    } catch (e) { toast(e.message); }
  },

  close() {
    Chat.peer = null;
    $("chat").classList.remove("open"); $("chat").setAttribute("aria-hidden", "true");
    try { Telegram.WebApp.BackButton.hide(); } catch (e) {}
    Chats.load();
  },

  render() {
    const box = $("msgs"); let last = "", html = "";
    if (!Chat.msgs.length) html = `<div class="empty"><h3>Сообщений пока нет</h3><p>Напишите первым.</p></div>`;
    for (const m of Chat.msgs) {
      const day = new Date(m.ts * 1000).toDateString();
      if (day !== last) { html += `<div class="day">${fmtDay(m.ts)}</div>`; last = day; }
      const out = m.sender === App.user.id;
      html += `<div class="b ${out ? "out" : "in"}">${esc(m.text)}<span class="t">${fmtTime(m.ts)}${out ? (m.is_read ? " ✓✓" : " ✓") : ""}</span></div>`;
    }
    box.innerHTML = html; box.scrollTop = box.scrollHeight;
  },

  async onMessage(m) {
    if (!Chat.peer) return;
    const other = m.sender === App.user.id ? m.receiver : m.sender;
    if (other !== Chat.peer.id || Chat.msgs.some((x) => x.id === m.id)) return;
    Chat.msgs.push(m); Chat.render();
    if (m.sender === Chat.peer.id) { try { await api("/api/messages/" + Chat.peer.id); } catch (e) {} }
  },

  async send() {
    const inp = $("msg-input"), text = inp.value.trim();
    if (!text || !Chat.peer) return;
    inp.value = ""; inp.style.height = "auto"; $("send").classList.remove("show");
    try {
      const d = await api("/api/send", { method: "POST", body: { to: Chat.peer.id, text } });
      if (!Chat.msgs.some((x) => x.id === d.message.id)) { Chat.msgs.push(d.message); Chat.render(); }
    } catch (e) { toast(e.message); inp.value = text; $("send").classList.add("show"); }
  },
};
