// admin.js — экран «Переписка по жалобе» для участников admin-panel: снимок переписки на момент жалобы
// (видно и то, что кто-то удалил «у себя»; удалённое после жалобы тоже остаётся). Каждый просмотр сервер пишет в «Логи».
const HCReport = {
  async open(rid) {
    const pg = Pg.open({ title: T("Жалоба #{0}", rid), cls: "hcr", data: { loading: true }, build: (p) => HCReport.draw(p) });
    try {
      const d = await api("/api/hc/report/" + rid);
      if (!pg.alive) return;
      pg.data = { loading: false, r: d.report, users: d.users || {}, msgs: d.messages || [] };
    } catch (e) {
      if (!pg.alive) return;
      pg.data = { loading: false, err: e.message };
    }
    pg.refresh();
    pg.on.media = (el) => { const m = pg.data.msgs[+el.dataset.v]; if (m && m.url) Viewer.open({ url: m.url, mime: m.mime, name: m.name }); };
    pg.on.user = (el) => UserProfile.open({ id: +el.dataset.v, name: "", surname: "", username: "", avatar: "", bio: "" });
  },

  who(pg, id) {
    const u = pg.data.users[id] || pg.data.users[String(id)] || { id, name: T("Пользователь") };
    return u;
  },

  when(ts) {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString(I18N.tloc || "ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + fmtTime(ts);
  },

  draw(pg) {
    const d = pg.data;
    if (d.loading) return pg.set(`<div class="g-load">${esc(T("Загрузка…"))}</div>`);
    if (d.err) return pg.set(`<div class="g-load">${esc(d.err)}</div>`);
    const r = d.r, from = HCReport.who(pg, r.reporter);
    const on = r.kind === "user" ? HCReport.who(pg, r.target) : null;
    const lbl = (u) => `<button class="hcr-u" data-a="user" data-v="${u.id}">${esc(u.name)}${u.number ? ` <small>${esc(u.number)}</small>` : ""}${u.banned ? ` <em>${esc(T("заблокирован"))}</em>` : ""}</button>`;
    let html = `<div class="hcr-head">
      <div class="hcr-reason">🚨 ${esc(r.reason)}${r.status && r.status !== "open" ? ` · <span>${esc(r.status)}</span>` : ""}</div>
      <div class="hcr-row"><span>${esc(T("От"))}</span>${lbl(from)}</div>
      <div class="hcr-row"><span>${esc(T("На"))}</span>${on ? lbl(on) : `<b>${esc(r.chat || "#" + r.target)}</b>`}</div>
      ${r.text ? `<div class="hcr-note">${esc(r.text)}</div>` : ""}
      <div class="hcr-meta">${esc(T("Снимок переписки от {0}", HCReport.when(r.taken)))}</div>
    </div>`;
    if (!d.msgs.length) html += `<div class="g-empty">${esc(T("Сообщений нет"))}</div>`;
    let day = "";
    d.msgs.forEach((m, i) => {
      const dd = new Date(m.ts * 1000).toDateString();
      if (dd !== day) { day = dd; html += `<div class="day">${esc(fmtDay(m.ts))}</div>`; }
      const u = HCReport.who(pg, m.from), mine = m.from === r.reporter;
      let body = "";
      if (m.kind === "photo" && m.url) body += `<button class="hcr-media" data-a="media" data-v="${i}">${/^video\//.test(m.mime || "") ? `<video src="${esc(fileUrl(m.url))}" muted playsinline preload="metadata"></video>` : `<img src="${esc(fileUrl(m.url))}" alt="" loading="lazy">`}</button>`;
      else if (m.kind === "voice" && m.url) body += `<audio controls preload="none" src="${esc(fileUrl(m.url))}"></audio>`;
      else if ((m.kind === "file" || m.kind === "gif" || m.kind === "sticker") && m.url) body += `<button class="hcr-file" data-a="media" data-v="${i}">📎 ${esc(m.name || m.kind)}</button>`;
      else if (m.kind !== "text" && m.kind) body += `<span class="hcr-kind">${esc(m.kind)}</span>`;
      if (m.text) body += `<div class="hcr-tx">${esc(m.text)}</div>`;
      const flags = (m.del ? `<em class="hcr-del">${esc(T("удалено у себя"))}</em>` : "") + (m.edited ? `<em>${esc(T("изм."))}</em>` : "");
      html += `<div class="hcr-m ${mine ? "out" : "in"}"><b style="color:${uColor(m.from)}">${esc(u.name)}</b>${body}<small>${flags}${esc(fmtTime(m.ts))}</small></div>`;
    });
    pg.set(html);
  },
};
