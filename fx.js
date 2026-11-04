// fx.js — большие анимированные эмодзи как в Telegram: «выскакивают» при отправке, играют при нажатии
// и разлетаются частицами (звёзды, сердечки, конфетти, искры…). Всё нарисовано CSS и самими эмодзи, без картинок.

const Fx = (() => {
  const RE = /(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*|[0-9#*]️?⃣)/gu;
  const KIND = [
    ["star", /^(?:⭐|🌟|✨|💫|⚡)/],
    ["heart", /^(?:❤|🧡|💛|💚|💙|💜|🤍|🖤|🤎|💕|💞|💓|💗|💖|💘|💝|😍|🥰|😘|😻)/],
    ["fire", /^(?:🔥|💥|🌋)/],
    ["party", /^(?:🎉|🎊|🥳|🎁|🎈|🏆|🥇)/],
    ["laugh", /^(?:😂|🤣|😆|😹|😅)/],
    ["cry", /^(?:😭|😢|🥹|😿|😥)/],
    ["angry", /^(?:😡|🤬|😠|👿|😤)/],
    ["clap", /^(?:👍|👏|🙌|👌|💪|🤝|🙏|✌|🤞)/],
    ["ghost", /^(?:👻|💀|☠|🎃|👽|🤖)/],
    ["wow", /^(?:😮|😲|🤯|😱|😳|🤩)/],
  ];
  const BURST = {
    star: ["⭐", "✨", "🌟", "💫"], heart: ["❤️", "💖", "💗", "🧡", "💕"], fire: ["🔥", "✨", "🧡"],
    party: ["🎉", "🎊", "✨", "🎈"], laugh: ["😂", "🤣", "💦"], cry: ["💧", "💦", "😢"],
    angry: ["💢", "🔥", "💥"], clap: ["👏", "✨", "⭐"], ghost: ["✨", "💫", "👻"], wow: ["✨", "💥", "⭐"],
  };
  const COLORS = ["#ff5c7a", "#ffd43b", "#4fd1b0", "#6cb4ff", "#a57bff", "#ff9f43", "#7ed957"];

  const kindOf = (e) => { for (const [k, r] of KIND) if (r.test(e)) return k; return "pop"; };
  const reduced = () => document.documentElement.classList.contains("eco-anim") || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  let layer = null;
  const getLayer = () => { if (!layer || !layer.isConnected) { layer = document.createElement("div"); layer.className = "fxl"; document.body.appendChild(layer); } return layer; };

  return {
    kindOf, RE,
    tokens(t) { return String(t || "").match(RE) || []; },
    // большие эмодзи в сообщении: каждый — своя анимированная кнопка
    html(t) {
      return Fx.tokens(t).map((e, i) => `<span class="bem fx-${kindOf(e)}" data-e="${esc(e)}" style="--i:${i}">${esc(e)}</span>`).join("");
    },
    play(el, opts = {}) {
      if (!el) return;
      const e = el.dataset.e || el.textContent, k = kindOf(e);
      el.classList.remove("play"); void el.offsetWidth; el.classList.add("play");
      clearTimeout(el._fxT); el._fxT = setTimeout(() => el.classList.remove("play"), 1500);
      if (!opts.quiet) haptic("light");
      if (reduced()) return;
      Fx.burst(el, k, e);
    },
    burst(el, kind, e) {
      const r = el.getBoundingClientRect(), L = getLayer();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const set = BURST[kind] || [e];
      const confetti = kind === "party";
      const n = confetti ? 26 : kind === "star" ? 16 : 11;
      for (let i = 0; i < n; i++) {
        const p = document.createElement("i");
        const a = Math.random() * Math.PI * 2, d = (confetti ? 90 : 70) + Math.random() * (confetti ? 150 : 110);
        let dx = Math.cos(a) * d, dy = Math.sin(a) * d;
        if (kind === "heart" || kind === "fire") dy = -Math.abs(dy) - 40;          // поднимаются вверх
        else if (kind === "cry") dy = Math.abs(dy) * 0.8 + 30;                        // слёзы падают
        if (confetti && i % 2) { p.className = "fxp cf"; p.style.background = COLORS[i % COLORS.length]; }
        else { p.className = "fxp"; p.textContent = set[i % set.length]; p.style.fontSize = (14 + Math.random() * 16) + "px"; }
        p.style.cssText += `;left:${cx}px;top:${cy}px;--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px;--rot:${(Math.random() * 540 - 270).toFixed(0)}deg;--dur:${(0.9 + Math.random() * 0.7).toFixed(2)}s;--dl:${(Math.random() * 0.12).toFixed(2)}s`;
        L.appendChild(p);
        setTimeout(() => p.remove(), 1900);
      }
    },
    // сообщение целиком появилось — проиграть один раз
    appear(box) {
      if (!box) return;
      const els = box.querySelectorAll(".bem");
      els.forEach((el, i) => setTimeout(() => Fx.play(el, { quiet: true }), 120 + i * 140));
    },
  };
})();
