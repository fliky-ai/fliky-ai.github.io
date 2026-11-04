// Профиль собеседника (открывается по нажатию на шапку чата): имя, статус, @username, о себе, день рождения, публикации.
const UserProfile = {
  cur: null, stories: [],

  async open(p) {
    UserProfile.cur = p; UserProfile.stories = [];
    UserProfile.render(p); Nav.open("uprofile", () => { UserProfile.cur = null; });
    try { const d = await api("/api/user/" + p.id); if (UserProfile.cur && UserProfile.cur.id === p.id) { UserProfile.cur = d.user; UserProfile.render(d.user); } } catch (e) {}
    UserProfile.loadStories(p.id);
  },

  async loadStories(id) {
    try {
      const d = await api("/api/stories/user/" + id);
      if (UserProfile.cur && UserProfile.cur.id === id) { UserProfile.stories = d.stories; UserProfile.render(UserProfile.cur); }
    } catch (e) {}
  },

  // кольцо вокруг аватарки изменилось (кто-то посмотрел/опубликовал)
  ring() { if (UserProfile.cur && $("uprofile").classList.contains("open")) UserProfile.render(UserProfile.cur); },

  render(u) {
    const row = (v, l, copy = "") => `<button class="pi"${copy ? ` data-copy="${esc(copy)}"` : ""}><span class="pi-v">${v}</span><span class="pi-l">${l}</span></button>`;
    const rows = [];
    if (u.bio) rows.push(row(esc(u.bio), "О себе", u.bio));
    if (u.username) rows.push(row("@" + esc(u.username), "Имя пользователя", "@" + u.username));
    if (u.birthday) rows.push(row(esc(bdayText(u.birthday)) + (bdayToday(u.birthday) ? " 🎂" : ""), "День рождения"));
    const st = UserProfile.stories;
    const ph = premHero(u);
    $("up-body").innerHTML = `<div class="pf-hero${ph.cls}"${ph.style}>${ph.pat}<div class="pf-av">${Stories.av(u, "xl")}</div><h2>${profName(u)}</h2>
      <div class="st2 ${u.online ? "on" : ""}">${esc(statusText(u))}</div></div>
      ${rows.length ? `<div class="card2 pf-info">${rows.join("")}</div>` : ""}
      ${st.length ? `<div class="up-sect">Публикации</div>${Stories.grid(st)}` : ""}`;
    $("up-body").querySelectorAll(".pi[data-copy]").forEach((b) => (b.onclick = () => { copyText(b.dataset.copy); toast("Скопировано"); haptic(); }));
    const g = $("up-body").querySelector(".pg");
    if (g) g.onclick = (e) => {
      const b = e.target.closest(".pg-t"); if (!b) return;
      Stories.show([{ uid: u.id, user: u, stories: UserProfile.stories.slice() }], 0, +b.dataset.i);
    };
  },
};
