// Профиль собеседника (открывается по нажатию на шапку чата).
const UserProfile = {
  async open(p) {
    UserProfile.render(p); Nav.open("uprofile");
    try { const d = await api("/api/user/" + p.id); UserProfile.render(d.user); } catch (e) {}
  },
  render(u) {
    $("up-body").innerHTML = `<div class="phero">${avatar(u, "xl")}<h2>${nameHTML(u)}</h2>
      <div class="st2 ${u.online ? "on" : ""}">${esc(statusText(u))}</div></div>
      ${u.username || u.bio ? `<div class="group">
        ${u.username ? `<div class="info"><small>Имя пользователя</small><div>@${esc(u.username)}</div></div>` : ""}
        ${u.bio ? `<div class="info"><small>О себе</small><div>${esc(u.bio)}</div></div>` : ""}</div>` : ""}`;
  },
};
