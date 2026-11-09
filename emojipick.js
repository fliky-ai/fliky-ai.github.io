// emojipick.js — Premium Emoji, общие части:
//   EmojiSearch — поиск эмодзи по словам (рус./англ.) и своих (Premium) эмодзи по значку и названию набора
//   RClip       — «умный» буфер обмена: при копировании сообщения свои эмодзи и форматирование сохраняются,
//                 при вставке в поле ввода возвращаются (внутри приложения — всегда, между вкладками — через text/html)
//   EmojiPick   — окно выбора эмодзи (категории + поиск + свои наборы) для любых полей, например «О себе»
//   BioEd       — поле «О себе» со своими эмодзи (как в Telegram Premium)

// ───────────── слова для поиска ─────────────
const EMOJI_KW = (() => {
  const src = `😀 улыбка радость смайл smile happy grin|😃 улыбка радость smile|😄 смех улыбка радость laugh|😁 улыбка зубы grin|😆 смех хаха laugh lol|😅 пот неловко фух sweat|🤣 ржу смех хаха lol rofl|😂 смех слезы хаха лол lol joy|🙂 улыбка smile|🙃 перевернуть ирония upside|😉 подмигнуть wink|😊 милый румянец blush|😇 ангел нимб angel|🥰 любовь сердечки влюблен love|😍 влюблен любовь глаза сердца love|🤩 звезды восторг вау wow star|😘 поцелуй kiss|😗 поцелуй kiss|😚 поцелуй kiss|😙 поцелуй kiss|😋 вкусно ням yum|😛 язык tongue|😜 подмигнуть язык шутка wink|🤪 безумный псих crazy|😝 язык tongue|🤑 деньги богатый money|🤗 обнять обнимашки hug|🤭 упс хихи oops|🤫 тихо тсс секрет shh|🤔 думаю хм think|🤐 молчу zip|🤨 подозрение бровь hmm|😐 нейтрально meh|😑 без эмоций|😶 молчание|😏 ухмылка smirk|😒 недоволен unamused|🙄 закатить глаза roll eyes|😬 неловко grimace|🤥 врун ложь lie|😌 облегчение спокойно relieved|😔 грусть pensive|😪 сонный sleepy|🤤 слюни drool|😴 сон спать sleep|😷 маска болею mask|🤒 болею температура sick|🤕 травма hurt|🤢 тошнит nausea|🤮 рвота vomit|🤧 чих простуда sneeze|🥵 жарко hot|🥶 холодно cold|🥴 пьяный woozy|😵 голова кругом dizzy|🤯 взрыв мозга шок mind blown|🤠 ковбой cowboy|🥳 праздник вечеринка party|😎 круто очки cool|🤓 ботан nerd|🧐 монокль|😕 растерян confused|😟 тревога worried|🙁 грусть sad|😮 удивление wow|😯 удивление|😲 шок astonished|😳 смущение flushed|🥺 пожалуйста умоляю please|😦 ой|😧 ой|😨 страх fear|😰 тревога anxious|😥 грусть|😢 плачу слеза cry|😭 рыдаю плач cry sob|😱 крик ужас scream|😖 мучение|😣 упорство|😞 разочарование disappointed|😓 пот|😩 устал weary|😫 устал tired|🥱 зеваю скучно yawn|😤 злость пар|😡 злой гнев angry|😠 злой angry|🤬 мат ругаюсь swear|😈 дьявол чертик devil|👿 злой черт|💀 череп умер смерть skull dead|☠️ череп|💩 какашка poop|🤡 клоун clown|👹 монстр|👺 гоблин|👻 призрак ghost|👽 пришелец alien|👾 игра монстр game|🤖 робот robot|😺 кот|😸 кот|😹 кот смех|😻 кот любовь|🙈 обезьяна не вижу monkey|🙉 обезьяна не слышу|🙊 обезьяна молчу|` +
    `👋 привет пока махать hi bye wave|🤚 рука стоп|🖐 рука ладонь hand|✋ стоп рука stop|🖖 спок|👌 ок окей ok|🤌 итальянец|🤏 чуть-чуть мало|✌️ мир победа peace|🤞 удача надеюсь luck|🤟 люблю|🤘 рок rock|🤙 позвони call|👈 налево left|👉 направо right|👆 вверх up|👇 вниз down|☝️ один внимание|👍 лайк класс да ок like yes good|👎 дизлайк плохо нет dislike no bad|✊ кулак|👊 удар кулак punch|🤛 кулак|🤜 кулак|👏 аплодисменты браво хлоп clap|🙌 ура hooray|👐 руки|🤲 просить|🤝 рукопожатие сделка deal|🙏 спасибо пожалуйста молюсь please thanks pray|✍️ пишу write|💅 ногти|💪 сила мышцы strong|🧠 мозг ум brain|👀 глаза смотрю eyes look|👅 язык|👄 губы lips|` +
    `❤️ сердце любовь красное love heart red|🧡 сердце оранжевое|💛 сердце желтое|💚 сердце зеленое|💙 сердце синее blue|💜 сердце фиолетовое|🖤 сердце черное black|🤍 сердце белое white|🤎 сердце коричневое|💔 разбитое сердце broken|❣️ сердце|💕 сердца любовь|💞 сердца|💓 сердце|💗 сердце|💖 сердце блеск|💘 сердце стрела амур|💝 сердце подарок|✨ блеск искры sparkle|⭐ звезда star|🌟 звезда сияет star|💫 звезды dizzy|🔥 огонь круто жара fire lit|💥 взрыв бум boom|💯 сто идеально 100|✅ готово да галочка check yes|❌ нет крест no|❓ вопрос question|❗ восклицание важно|⚡ молния быстро flash|💢 злость|💤 сон zzz|💬 сообщение чат chat|🎉 праздник ура поздравляю party|🎊 конфетти|🎁 подарок gift|🏆 кубок победа trophy win|🥇 первое место золото gold|` +
    `🐶 собака пес dog|🐱 кот кошка cat|🐭 мышь mouse|🐹 хомяк|🐰 кролик заяц rabbit|🦊 лиса fox|🐻 медведь bear|🐼 панда panda|🐨 коала|🐯 тигр tiger|🦁 лев lion|🐮 корова cow|🐷 свинья pig|🐸 лягушка frog|🐵 обезьяна monkey|🐔 курица|🐧 пингвин penguin|🐦 птица bird|🦆 утка duck|🦉 сова owl|🐺 волк wolf|🐴 лошадь horse|🦄 единорог unicorn|🐝 пчела bee|🦋 бабочка butterfly|🐌 улитка|🐞 божья коровка|🐢 черепаха turtle|🐍 змея snake|🐙 осьминог|🦀 краб|🐠 рыба fish|🐬 дельфин dolphin|🐳 кит whale|🦈 акула shark|🐊 крокодил|🐘 слон elephant|🦒 жираф|` +
    `🍏 яблоко|🍎 яблоко apple|🍐 груша|🍊 апельсин|🍋 лимон lemon|🍌 банан banana|🍉 арбуз|🍇 виноград|🍓 клубника strawberry|🍒 вишня черешня|🍑 персик peach|🥭 манго|🍍 ананас|🥥 кокос|🥝 киви|🍅 помидор|🥑 авокадо|🥦 брокколи|🌽 кукуруза|🥕 морковь|🍞 хлеб bread|🧀 сыр cheese|🍗 курица ножка|🍖 мясо meat|🍔 бургер burger|🍟 картошка фри|🍕 пицца pizza|🌭 хотдог|🌮 тако|🍣 суши sushi|🍜 лапша рамен|🍩 пончик donut|🍪 печенье cookie|🎂 торт день рождения cake birthday|🍰 торт пирожное cake|🍫 шоколад chocolate|🍬 конфета|🍭 леденец|☕ кофе чай coffee|🍵 чай tea|🍺 пиво beer|🍷 вино wine|🥂 тост бокалы cheers|🍾 шампанское|` +
    `⚽ футбол мяч football soccer|🏀 баскетбол|🏈 регби|⚾ бейсбол|🎾 теннис|🏐 волейбол|🎱 бильярд|🏓 пинг-понг|🥊 бокс|🎯 цель дартс target|🎮 игра геймпад game|🎲 кубик кости dice|🎧 музыка наушники music|🎤 микрофон петь|🎸 гитара guitar|🎹 пианино|🎬 кино фильм movie|🎨 рисовать искусство art|🏄 серфинг|🚴 велосипед|🏊 плавание|` +
    `🚗 машина авто car|🚕 такси taxi|🚌 автобус bus|🏎 гонка|🚓 полиция|🚑 скорая|🚒 пожарные|✈️ самолет путешествие plane|🚀 ракета космос rocket|🚁 вертолет|🚂 поезд train|🚢 корабль ship|🏠 дом home house|🏝 остров отпуск|🌍 земля мир world|🌙 луна ночь moon|☀️ солнце sun|⛅ облачно|☁️ облако cloud|🌧 дождь rain|⛈ гроза|❄️ снег зима snow|🌈 радуга rainbow|📱 телефон phone|💻 ноутбук компьютер laptop|⌚ часы watch|📷 фото камера camera|💡 идея лампа idea|🔑 ключ key|🔒 замок lock|💰 деньги money|💎 алмаз бриллиант diamond|📌 пин|✏️ карандаш|📚 книги учеба books|⏰ будильник время|🎈 шарик balloon|👑 корона король crown|🍀 удача клевер luck|🌸 цветок цветы flower|🎵 музыка нота music|🔔 колокольчик уведомление bell`;
  const m = {};
  src.split("|").forEach((p) => { const i = p.indexOf(" "); if (i > 0) m[p.slice(0, i)] = p.slice(i + 1).toLowerCase(); });
  return m;
})();

const EmojiSearch = {
  _all: null,
  all() { return EmojiSearch._all || (EmojiSearch._all = [].concat(...EMOJI.map((c) => c.list))); },
  norm(q) { return String(q || "").toLowerCase().replace(/ё/g, "е").trim(); },
  // обычные эмодзи: каждое слово запроса — начало одного из слов
  find(q) {
    q = EmojiSearch.norm(q);
    if (!q) return [];
    const parts = q.split(/\s+/);
    const seen = new Set(), out = [];
    EmojiSearch.all().forEach((e) => {
      if (seen.has(e)) return;
      const kw = (EMOJI_KW[e] || "").replace(/ё/g, "е");
      if (e === q || (kw && parts.every((p) => kw.split(" ").some((w) => w.startsWith(p))))) { seen.add(e); out.push(e); }
    });
    return out;
  },
  // свои эмодзи: по привязанному значку (его словам) или по названию набора
  ce(q, sets) {
    q = EmojiSearch.norm(q);
    if (!q || !sets) return [];
    const em = new Set(EmojiSearch.find(q));
    const out = [];
    sets.forEach((s) => {
      const t = EmojiSearch.norm(s.title);
      (s.items || []).forEach((i) => { if (t.includes(q) || (i.emoji && (em.has(i.emoji) || i.emoji === q))) out.push(i); });
    });
    return out.slice(0, 120);
  },
};

// ───────────── буфер обмена с эмодзи и форматированием ─────────────
const RClip = {
  mem: null,
  _clean(ents, n) { return (ents || []).filter((e) => e && e.t && e.l > 0 && e.o >= 0 && e.o + e.l <= n).map((e) => Object.assign({}, e)); },
  // запомнить, что скопировано, и положить в системный буфер текст (+ HTML со своими эмодзи)
  async set(text, ents) {
    text = String(text || "").replace(/\r/g, "");
    const e = RClip._clean(ents, text.length);
    RClip.mem = { text, ents: e };
    try { ls.set("rclip", { text: text.slice(0, 20000), ents: e.slice(0, 300), ts: Date.now() }); } catch (er) {}
    if (e.length && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      try {
        const tmp = document.createElement("div");
        Rich.write(tmp, text, e);
        tmp.querySelectorAll("img,video").forEach((n) => n.remove());   // в буфер — без картинок (адреса временные)
        const html = `<div data-dg="1">${tmp.innerHTML}</div>`;
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
        return;
      } catch (er) {}
    }
    await copyText(text);
  },
  // при вставке: если в буфере тот же текст, что мы копировали, — вернуть его сущности
  ents(text) {
    text = String(text || "").replace(/\r/g, "");
    if (!text) return null;
    const c = RClip.mem || ls.get("rclip", null);
    if (c && c.text === text && Array.isArray(c.ents) && c.ents.length) return RClip._clean(c.ents, text.length);
    return null;
  },
  // вставка из другой вкладки/окна Dicegram: HTML с data-ce
  fromHTML(html) {
    if (!html || !/data-ce=|data-dg=/.test(html)) return null;
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const root = doc.querySelector("[data-dg]") || doc.body;
      root.querySelectorAll("script,style,img,video,iframe").forEach((n) => n.remove());
      const raw = Rich.readRaw(root);
      return raw.text ? { text: raw.text.replace(/\r/g, ""), ents: raw.ents } : null;
    } catch (e) { return null; }
  },
  // разобрать событие paste → {text, ents} (ents может быть пустым)
  read(ev) {
    const cd = ev.clipboardData || window.clipboardData;
    if (!cd) return { text: "", ents: [] };
    const text = (cd.getData("text/plain") || "").replace(/\r/g, "");
    let html = "";
    try { html = cd.getData("text/html") || ""; } catch (e) {}
    const r = RClip.fromHTML(html);
    if (r && (!text || r.text.replace(/\s+/g, "") === text.replace(/\s+/g, ""))) return r;
    return { text, ents: RClip.ents(text) || [] };
  },
};

// сдвиг сущностей при вставке/замене куска текста
Rich.splice = function (text, ents, s, e, ins, insEnts) {
  const d = ins.length - (e - s);
  const out = [];
  (ents || []).forEach((x) => {
    const xe = x.o + x.l;
    if (xe <= s) { out.push(Object.assign({}, x)); return; }
    if (x.o >= e) { out.push(Object.assign({}, x, { o: x.o + d })); return; }
    if (x.t === "ce") return;                                  // свой эмодзи внутри заменённого куска — пропадает
    const a = Math.min(x.o, s), b = xe > e ? xe + d : s;       // часть до и после куска
    if (b > a) out.push(Object.assign({}, x, { o: a, l: b - a }));
  });
  (insEnts || []).forEach((x) => out.push(Object.assign({}, x, { o: x.o + s })));
  return { text: text.slice(0, s) + ins + text.slice(e), ents: Rich.mergeEnts(out) };
};

// ───────────── окно выбора эмодзи ─────────────
const EmojiPick = {
  el: null,
  // opts: { title, ce: true|false (показывать свои эмодзи), onPick(emoji), onCE({id, emoji, url, mime}) }
  async open(opts = {}) {
    if (EmojiPick.el) EmojiPick.close();
    const el = document.createElement("div");
    el.className = "sp-ov emp-ov";
    const X = typeof SI !== "undefined" ? SI : {};
    el.innerHTML = `<div class="sp-card" role="dialog">
      <div class="sp-top"><b>${esc(opts.title || T("Эмодзи"))}</b><button class="sp-x" aria-label="${esc(T("Закрыть"))}">${X.x || "✕"}</button></div>
      <div class="sp-search">${X.search || ""}<input type="search" placeholder="${esc(T("Поиск эмодзи"))}" autocomplete="off" enterkeyhint="search"></div>
      <div class="sp-cats emp-cats"></div>
      <div class="sp-body"></div></div>`;
    document.body.appendChild(el);
    EmojiPick.el = el; EmojiPick.opts = opts; EmojiPick.q = "";
    requestAnimationFrame(() => el.classList.add("show"));
    const close = Nav.layer(() => { if (EmojiPick.el === el) EmojiPick.el = null; el.classList.remove("show"); setTimeout(() => el.remove(), 260); });
    EmojiPick.close = close;
    el.querySelector(".sp-x").onclick = close;
    el.addEventListener("click", (e) => { if (e.target === el) close(); });
    el.querySelector(".sp-search input").oninput = (e) => { EmojiPick.q = e.target.value; EmojiPick.draw(); };
    el.querySelector(".sp-body").onclick = (e) => EmojiPick.click(e);
    el.querySelector(".emp-cats").onclick = (e) => {
      const b = e.target.closest("button[data-j]"); if (!b) return;
      const h = el.querySelector("#emp-s" + b.dataset.j), bd = el.querySelector(".sp-body");
      if (h && bd) bd.scrollTo({ top: h.offsetTop - bd.offsetTop, behavior: "smooth" });
    };
    EmojiPick.draw();
    if (opts.ce !== false && App.user && App.user.premium && typeof React !== "undefined") {
      await React.loadSets();
      if (EmojiPick.el === el) EmojiPick.draw();
    }
  },
  sets() { return EmojiPick.opts.ce !== false && App.user && App.user.premium && typeof React !== "undefined" ? React.sets || [] : []; },
  draw() {
    const el = EmojiPick.el; if (!el) return;
    const body = el.querySelector(".sp-body"), cats = el.querySelector(".emp-cats");
    const q = EmojiSearch.norm(EmojiPick.q), sets = EmojiPick.sets();
    const ceT = (i) => `<button class="sp-t emp-ce" data-ce="${i.id}" data-em="${esc(i.emoji || "🙂")}">${CE.media(i)}</button>`;
    const emT = (e) => `<button class="sp-t emp-e" data-e="${esc(e)}">${esc(e)}</button>`;
    const sec = (i, title, inner, prem) => `<div class="sp-sec" id="emp-s${i}"><div class="sp-h"><span>${esc(title)}</span>${prem ? `<i class="ce-tag">${PREM_I}</i>` : ""}</div><div class="sp-grid">${inner}</div></div>`;
    let out = "";
    if (q) {
      const c = EmojiSearch.ce(q, sets), s = EmojiSearch.find(q);
      if (c.length) out += sec("c", T("Мои эмодзи"), c.map(ceT).join(""), 1);
      if (s.length) out += sec("s", T("Эмодзи"), s.map(emT).join(""));
      if (!out) out = `<div class="sp-empty">${esc(T("Ничего не найдено"))}</div>`;
      cats.hidden = true;
    } else {
      const secs = [];
      const rec = ls.get("emoji_recent", []);
      if (rec.length) secs.push({ ic: PIC.recent, n: T("Недавние"), g: rec.map(emT).join("") });
      sets.forEach((st) => secs.push({ ic: `<span class="cs-ic">${CE.media(st.items[0])}</span>`, n: st.title, p: 1, g: st.items.map(ceT).join("") }));
      EMOJI.forEach((c, k) => secs.push({ ic: PIC[CAT_IC[k] || "smile"], n: T(c.name), g: c.list.map(emT).join("") }));
      out = secs.map((c, i) => sec(i, c.n, c.g, c.p)).join("");
      if (EmojiPick.opts.ce !== false && !(App.user && App.user.premium)) out = `<button class="ce-lock" data-act="prem"><span class="mg-li">${PREM_I}</span><span><b>${esc(T("Свои эмодзи"))}</b><small>${esc(T("Анимированные эмодзи в «О себе» и сообщениях — с Premium"))}</small></span><i>›</i></button>` + out;
      cats.hidden = false;
      cats.innerHTML = secs.map((c, i) => `<button data-j="${i}" aria-label="${esc(c.n)}">${c.ic}</button>`).join("");
    }
    body.innerHTML = out;
  },
  click(e) {
    const t = e.target.closest("button"); if (!t) return;
    const o = EmojiPick.opts;
    if (t.dataset.act === "prem") { EmojiPick.close(); return setTimeout(() => PremiumPromo.open(App.user || {}), 260); }
    if (t.dataset.ce) { haptic("light"); const i = CE.items[+t.dataset.ce] || {}; if (o.onCE) o.onCE({ id: +t.dataset.ce, emoji: t.dataset.em, url: i.url, mime: i.mime }); return; }
    if (t.dataset.e) {
      haptic("light");
      const rec = ls.get("emoji_recent", []).filter((x) => x !== t.dataset.e);
      rec.unshift(t.dataset.e); ls.set("emoji_recent", rec.slice(0, 24));
      if (o.onPick) o.onPick(t.dataset.e);
    }
  },
};

// ───────────── «О себе» со своими эмодзи ─────────────
const BioEd = {
  el: null, last: { text: "", ents: [] },
  max() { return App.user && App.user.premium ? 140 : 70; },
  init() {
    const old = $("ed-bio");
    if (!old || old.tagName !== "TEXTAREA") { BioEd.el = old; return; }
    const el = document.createElement("div");
    el.id = "ed-bio"; el.className = "ed-rich"; el.contentEditable = "true";
    el.setAttribute("role", "textbox"); el.setAttribute("aria-label", old.getAttribute("aria-label") || "О себе");
    el.dataset.ph = old.placeholder || "О себе";
    old.replaceWith(el);
    BioEd.el = el;
    // кнопка эмодзи рядом с полем
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "ed-emo"; btn.setAttribute("aria-label", T("Эмодзи"));
    btn.innerHTML = PIC.smile;
    el.parentNode.classList.add("ed-bio-w");
    el.parentNode.appendChild(btn);
    btn.onclick = () => BioEd.pick();
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      const r = RClip.read(e);
      if (!r.text) return;
      BioEd.insert(r.text.replace(/\n+/g, " "), r.ents.filter((x) => x.t === "ce"));
    });
    el.addEventListener("drop", (e) => e.preventDefault());
    el.addEventListener("input", () => BioEd.changed());
    document.addEventListener("selectionchange", () => {
      const s = getSelection();
      if (s.rangeCount && el.contains(s.anchorNode)) BioEd.range = s.getRangeAt(0).cloneRange();
    });
  },
  get() {
    if (!BioEd.el) return { text: "", ents: [] };
    if (BioEd.el.tagName === "TEXTAREA") return { text: BioEd.el.value.trim(), ents: [] };
    const r = Rich.read(BioEd.el);
    return { text: r.text, ents: r.ents.filter((e) => e.t === "ce") };
  },
  set(text, ents) {
    if (!BioEd.el) BioEd.init();
    if (BioEd.el.tagName === "TEXTAREA") { BioEd.el.value = text || ""; return; }
    Rich.write(BioEd.el, text || "", (ents || []).filter((e) => e.t === "ce"));
    BioEd.last = Rich.readRaw(BioEd.el);
    BioEd.empty();
  },
  len() { return Rich.readRaw(BioEd.el).text.length; },
  empty() { BioEd.el.classList.toggle("empty", !Rich.readRaw(BioEd.el).text); },
  // не даём выйти за лимит длины: откатываем лишнее
  changed() {
    const raw = Rich.readRaw(BioEd.el);
    if (raw.text.length > BioEd.max() || /\n/.test(raw.text)) {
      Rich.write(BioEd.el, BioEd.last.text, BioEd.last.ents);
      BioEd.caretEnd();
      haptic("light");
    } else BioEd.last = raw;
    BioEd.empty();
    if (typeof Profile !== "undefined") Profile.check();
  },
  caretEnd() {
    const r = document.createRange(); r.selectNodeContents(BioEd.el); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); BioEd.range = r.cloneRange();
  },
  offsets() {
    const el = BioEd.el, r = BioEd.range && el.contains(BioEd.range.commonAncestorContainer) ? BioEd.range : null;
    const n = Rich.readRaw(el).text.length;
    if (!r) return [n, n];
    return [Rich.offsetOf(el, r.startContainer, r.startOffset), Rich.offsetOf(el, r.endContainer, r.endOffset)];
  },
  insert(text, ents) {
    const el = BioEd.el, raw = Rich.readRaw(el), o = BioEd.offsets();
    const room = BioEd.max() - (raw.text.length - (o[1] - o[0]));
    if (room <= 0) { haptic("light"); return toast(T("Достигнут лимит символов")); }
    if (text.length > room) { text = text.slice(0, room); ents = (ents || []).filter((x) => x.o + x.l <= room); }
    const r = Rich.splice(raw.text, raw.ents, o[0], o[1], text, ents || []);
    Rich.write(el, r.text, r.ents.filter((x) => x.t === "ce"));
    BioEd.last = Rich.readRaw(el);
    const p = o[0] + text.length, [n, off] = Rich.posOf(el, p);
    try {
      const rg = document.createRange(); rg.setStart(n, off); rg.collapse(true);
      if (document.activeElement === el) { const s = getSelection(); s.removeAllRanges(); s.addRange(rg); }
      BioEd.range = rg.cloneRange();
    } catch (e) {}
    BioEd.empty();
    if (typeof Profile !== "undefined") Profile.check();
  },
  pick() {
    EmojiPick.open({
      title: T("Эмодзи для «О себе»"),
      onPick: (e) => BioEd.insert(e, []),
      onCE: (it) => { if (it.url) CE.put([it]); BioEd.insert(it.emoji || "🙂", [{ t: "ce", o: 0, l: (it.emoji || "🙂").length, id: it.id }]); },
    });
  },
};
