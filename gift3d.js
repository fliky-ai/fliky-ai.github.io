// gift3d.js — собственный мини-движок 3D для подарков Dicegram: процедурные модели (без картинок, без эмодзи),
// WebGL-рендер с «студийным» освещением и отражениями, миниатюры рисуются один раз и кэшируются, живой просмотр
// с вращением пальцем. Если WebGL недоступен — тот же набор треугольников рисуется на обычном canvas (запасной вариант).
const Gift3D = (() => {
  const TAU = Math.PI * 2, PI = Math.PI;
  const LT = !!(window.LITE && window.LITE.on);          // слабый / 32-битный телефон: без WebGL, меньше треугольников, меньше картинки
  const G = { designs: { reg: {}, nft: {} }, PAL: {}, forceSoft: LT, lodSoft: LT ? 0.4 : 0.5, lite: LT };

  // ───────────── цвет и материал ─────────────
  const lin = (c) => Math.pow(c, 2.2);
  const hex = (h) => { const n = parseInt(String(h).replace("#", ""), 16); return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)]; };
  // M(цвет, металл 0..1, шероховатость 0..1, свечение 0..1)
  const M = (c, m = 0, r = 0.4, e = 0) => ({ c: typeof c === "string" ? hex(c) : c, m, r, e });
  G.M = M; G.hex = hex;

  // ───────────── геометрия ─────────────
  let LOD = 1;
  const S = (n) => Math.max(5, Math.round(n * LOD));
  // поверхность по сетке: f(u,v,iu,iv) → [x,y,z] или [x,y,z,nx,ny,nz]; wu/wv — замыкание по u/v; flat — плоские грани (огранка)
  function surf(nu, nv, f, o = {}) {
    const pts = new Array(nu * nv);
    for (let iv = 0; iv < nv; iv++) for (let iu = 0; iu < nu; iu++) {
      const u = o.wu ? iu / nu : iu / (nu - 1), v = o.wv ? iv / nv : iv / (nv - 1);
      pts[iv * nu + iu] = f(u, v, iu, iv);
    }
    const tri = [], nuq = o.wu ? nu : nu - 1, nvq = o.wv ? nv : nv - 1;
    for (let iv = 0; iv < nvq; iv++) for (let iu = 0; iu < nuq; iu++) {
      const a = iv * nu + iu, b = iv * nu + (iu + 1) % nu, c = ((iv + 1) % nv) * nu + (iu + 1) % nu, d = ((iv + 1) % nv) * nu + iu;
      tri.push(a, b, c, a, c, d);
    }
    return finish(pts, tri, o.flat);
  }
  function finish(pts, tri, flat) {
    const an = pts[0].length >= 6;
    if (flat) {
      const p = [], n = [], idx = [];
      for (let t = 0; t < tri.length; t += 3) {
        const A = pts[tri[t]], B = pts[tri[t + 1]], C = pts[tri[t + 2]];
        const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        if (l < 1e-9) continue;
        for (const q of [A, B, C]) { idx.push(p.length / 3); p.push(q[0], q[1], q[2]); n.push(nx, ny, nz); }
      }
      return { p: new Float32Array(p), n: new Float32Array(n), i: idx };
    }
    const p = new Float32Array(pts.length * 3), n = new Float32Array(pts.length * 3);
    pts.forEach((q, i) => { p[i * 3] = q[0]; p[i * 3 + 1] = q[1]; p[i * 3 + 2] = q[2]; });
    if (an) pts.forEach((q, i) => { n[i * 3] = q[3]; n[i * 3 + 1] = q[4]; n[i * 3 + 2] = q[5]; });
    else {
      for (let t = 0; t < tri.length; t += 3) {
        const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
      }
      for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]); if (l < 1e-12) { n[i + 1] = 1; } else { n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; } }
    }
    return { p, n, i: tri };
  }
  const K = {
    sphere: (sg = 24) => { const a = S(sg), b = Math.max(4, Math.round(a * 0.65)); return surf(a, b + 1, (u, v) => { const t = u * TAU, ph = v * PI, x = Math.sin(ph) * Math.cos(t), y = Math.cos(ph), z = Math.sin(ph) * Math.sin(t); return [x, y, z, x, y, z]; }, { wu: true }); },
    // поверхность вращения: profile = [[радиус, высота], …]; повторная точка даёт острое ребро
    lathe: (prof, sg = 28, flat) => { const pr = prof; return surf(S(sg), pr.length, (u, v, iu, iv) => { const t = u * TAU, r = pr[iv][0]; return [r * Math.cos(t), pr[iv][1], r * Math.sin(t)]; }, { wu: true, flat }); },
    torus: (R, r, su = 32, sv = 14) => surf(S(su), S(sv), (u, v) => { const t = u * TAU, p = v * TAU, cx = Math.cos(t), cz = Math.sin(t), cr = Math.cos(p), sr = Math.sin(p); return [(R + r * cr) * cx, r * sr, (R + r * cr) * cz, cr * cx, sr, cr * cz]; }, { wu: true, wv: true }),
    // скруглённый параллелепипед 2w×2h×2d, радиус скругления r (аналитические нормали)
    rbox: (w, h, d, r = 0.12, n = 7) => {
      const parts = [], nn = Math.max(3, Math.round(n * Math.min(1, LOD + 0.3))), hw = w - r, hh = h - r, hd = d - r;
      const faces = [[0, 1, 2, 1], [0, 1, 2, -1], [1, 2, 0, 1], [1, 2, 0, -1], [2, 0, 1, 1], [2, 0, 1, -1]];
      for (const [ia, ib, ic, sg] of faces) {
        parts.push(surf(nn, nn, (u, v) => {
          const q = [0, 0, 0]; q[ia] = (u * 2 - 1); q[ib] = (v * 2 - 1); q[ic] = sg;
          const ext = [w, h, d], inn = [hw, hh, hd], p = [q[0] * ext[0], q[1] * ext[1], q[2] * ext[2]];
          const cl = p.map((x, i) => Math.max(-inn[i], Math.min(inn[i], x)));
          let nx = p[0] - cl[0], ny = p[1] - cl[1], nz = p[2] - cl[2]; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
          return [cl[0] + nx * r, cl[1] + ny * r, cl[2] + nz * r, nx, ny, nz];
        }));
      }
      return merge(parts);
    },
    // труба вдоль кривой Катмулла—Рома: pts — [[x,y,z],…], rad(t) — радиус от 0 до 1 вдоль трубы
    tube: (pts, rad, sg = 12, seg = 40, closed = false) => {
      const N = S(seg), pth = [], P = pts.length;
      const cr = (a, b, c, d, t) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
      for (let i = 0; i <= N; i++) {
        const f = (i / N) * (closed ? P : P - 1), k = Math.min(Math.floor(f), closed ? P - 1 : P - 2), t = f - k, g = (j) => pts[closed ? (j + P) % P : Math.max(0, Math.min(P - 1, j))];
        pth.push([0, 1, 2].map((c) => cr(g(k - 1)[c], g(k)[c], g(k + 1)[c], g(k + 2)[c], t)));
      }
      const T = pth.map((p, i) => { const a = pth[Math.max(0, i - 1)], b = pth[Math.min(N, i + 1)]; const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const l = Math.hypot(...t) || 1; return [t[0] / l, t[1] / l, t[2] / l]; });
      let nrm = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const fr = [];
      for (let i = 0; i <= N; i++) {
        const t = T[i], d = nrm[0] * t[0] + nrm[1] * t[1] + nrm[2] * t[2];
        let n = [nrm[0] - t[0] * d, nrm[1] - t[1] * d, nrm[2] - t[2] * d]; const l = Math.hypot(...n) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
        const b = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]];
        fr.push([n, b]); nrm = n;
      }
      return surf(S(sg), N + 1, (u, v, iu, iv) => {
        const a = u * TAU, r = rad(v), [n, b] = fr[iv], c = Math.cos(a), s = Math.sin(a), p = pth[iv];
        const nx = n[0] * c + b[0] * s, ny = n[1] * c + b[1] * s, nz = n[2] * c + b[2] * s;
        return [p[0] + nx * r, p[1] + ny * r, p[2] + nz * r, nx, ny, nz];
      }, { wu: true });
    },
    // «подушка»: outline — замкнутый контур [[x,y],…] вокруг начала координат (звёздчатый), depth — толщина, e1/e2 — округлость
    pillow: (out, depth = 0.4, e1 = 0.5, e2 = 0.55, rings = 14) => {
      const nr = S(rings) | 1, no = out.length;
      return surf(no, nr + 1, (u, v, iu, iv) => {
        const a = v * PI, sa = Math.pow(Math.sin(a), e1), ca = Math.cos(a), z = -Math.sign(ca) * Math.pow(Math.abs(ca), e2) * depth;
        return [out[iu][0] * sa, out[iu][1] * sa, z];
      }, { wu: true });
    },
    // плоский диск/кольцо с шагом по углу, f(r,θ) → y (для рельефа)
    disc: (r0, r1, y, sg = 40) => surf(S(sg), 2, (u, v) => { const t = u * TAU, r = r0 + (r1 - r0) * v; return [r * Math.cos(t), y, r * Math.sin(t)]; }, { wu: true }),
    // грани-«алмаз»: круглая огранка (корона + павильон), flat-shading
    brilliant: (n = 12) => {
      const seg = Math.max(8, Math.round(n * Math.min(1, LOD + 0.4)));
      const prof = [[0, 0.55], [0.5, 0.55], [1, 0.12], [1, 0.12], [1.03, 0], [1.03, 0], [0.5, -0.45], [0, -1]];
      return surf(seg, prof.length, (u, v, iu, iv) => { const t = (u + (iv % 2 ? 0.5 / seg : 0)) * TAU, r = prof[iv][0]; return [r * Math.cos(t), prof[iv][1], r * Math.sin(t)]; }, { wu: true, flat: true });
    },
    cone: (r, h, sg = 20) => K.lathe([[0, h], [r * 0.02, h], [r, 0], [r, 0], [0, 0]], sg),
    cyl: (r, h, sg = 24, cap = true) => K.lathe(cap ? [[0, h / 2], [r, h / 2], [r, h / 2], [r, -h / 2], [r, -h / 2], [0, -h / 2]] : [[r, h / 2], [r, -h / 2]], sg),
  };
  G.K = K;
  // сглаженный профиль: повторная точка — острый угол; per — число промежуточных точек на отрезок
  function curve(pts, per = 6) {
    const segs = [[]];
    pts.forEach((p, i) => { if (i && p[0] === pts[i - 1][0] && p[1] === pts[i - 1][1]) segs.push([]); segs[segs.length - 1].push(p); });
    const out = [];
    for (const sg of segs) {
      if (sg.length === 1) { out.push(sg[0], sg[0]); continue; }
      const g = (i) => sg[Math.max(0, Math.min(sg.length - 1, i))];
      for (let i = 0; i < sg.length - 1; i++) for (let k = 0; k < per; k++) {
        const t = k / per, c = (j) => 0.5 * ((2 * g(i)[j]) + (-g(i - 1)[j] + g(i + 1)[j]) * t + (2 * g(i - 1)[j] - 5 * g(i)[j] + 4 * g(i + 1)[j] - g(i + 2)[j]) * t * t + (-g(i - 1)[j] + 3 * g(i)[j] - 3 * g(i + 1)[j] + g(i + 2)[j]) * t * t * t);
        out.push([c(0), c(1)]);
      }
      out.push(sg[sg.length - 1]);
      if (sg !== segs[segs.length - 1]) out.push(sg[sg.length - 1]);
    }
    return out;
  }
  G.curve = curve;
  function merge(parts) {
    let np = 0, ni = 0; parts.forEach((q) => { np += q.p.length; ni += q.i.length; });
    const p = new Float32Array(np), n = new Float32Array(np), i = []; let o = 0;
    for (const q of parts) { p.set(q.p, o); n.set(q.n, o); const b = o / 3; for (const k of q.i) i.push(k + b); o += q.p.length; }
    return { p, n, i };
  }

  // матрицы нужны сборщику раньше, чем объявлен блок «матрицы»: короткие версии
  const MI4 = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const mmul = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; };
  // T · Rz·Ry·Rx · S
  function local(x) {
    const s = Array.isArray(x.s) ? x.s : [x.s == null ? 1 : x.s, x.s == null ? 1 : x.s, x.s == null ? 1 : x.s], t = x.t || [0, 0, 0], r = x.r || [0, 0, 0];
    const cx = Math.cos(r[0]), sx = Math.sin(r[0]), cy = Math.cos(r[1]), sy = Math.sin(r[1]), cz = Math.cos(r[2]), sz = Math.sin(r[2]);
    const R = [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx, sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx, -sy, cy * sx, cy * cx];
    // столбцы: колонка j = R[:,j] * s[j]
    return new Float32Array([R[0] * s[0], R[3] * s[0], R[6] * s[0], 0, R[1] * s[1], R[4] * s[1], R[7] * s[1], 0, R[2] * s[2], R[5] * s[2], R[8] * s[2], 0, t[0], t[1], t[2], 1]);
  }
  // ───────────── сборщик сцены ─────────────
  class MB {
    constructor() { this.g = {}; this.cur = "body"; this.st = [MI4()]; }
    group(n) { this.cur = n; return this; }
    // вложенные преобразования: push({t,r,s}) … pop()
    push(x) { this.st.push(mmul(this.st[this.st.length - 1], local(x))); return this; }
    pop() { if (this.st.length > 1) this.st.pop(); return this; }
    // add(форма, материал | функция(x,y,z,nx,ny,nz)→материал, {s, r:[rx,ry,rz], t})
    add(part, mat, x = {}) {
      const G_ = this.g[this.cur] || (this.g[this.cur] = { v: [], i: [], n: 0 });
      const m = mmul(this.st[this.st.length - 1], local(x)), fn = typeof mat === "function";
      // матрица нормалей — алгебраические дополнения 3×3 (верна и для неоднородного масштаба)
      const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
      const cof = [e * i - f * h, f * g - d * i, d * h - e * g, c * h - b * i, a * i - c * g, b * g - a * h, b * f - c * e, c * d - a * f, a * e - b * d];
      for (let k = 0; k < part.p.length; k += 3) {
        const px = part.p[k], py = part.p[k + 1], pz = part.p[k + 2], qx = part.n[k], qy = part.n[k + 1], qz = part.n[k + 2];
        const mt = fn ? mat(px, py, pz, qx, qy, qz) : mat;
        let nx = cof[0] * qx + cof[1] * qy + cof[2] * qz, ny = cof[3] * qx + cof[4] * qy + cof[5] * qz, nz = cof[6] * qx + cof[7] * qy + cof[8] * qz;
        const l = Math.hypot(nx, ny, nz) || 1;
        G_.v.push(m[0] * px + m[4] * py + m[8] * pz + m[12], m[1] * px + m[5] * py + m[9] * pz + m[13], m[2] * px + m[6] * py + m[10] * pz + m[14],
          nx / l, ny / l, nz / l, mt.c[0], mt.c[1], mt.c[2], mt.m, mt.r, mt.e);
      }
      for (const q of part.i) G_.i.push(q + G_.n);
      G_.n += part.p.length / 3;
      return this;
    }
    done() {
      let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (const k in this.g) { const v = this.g[k].v; for (let i = 0; i < v.length; i += 12) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], v[i + c]); mx[c] = Math.max(mx[c], v[i + c]); } }
      const ctr = [0, 1, 2].map((c) => (mn[c] + mx[c]) / 2);
      let rad = 0; for (const k in this.g) { const v = this.g[k].v; for (let i = 0; i < v.length; i += 12) rad = Math.max(rad, Math.hypot(v[i] - ctr[0], v[i + 1] - ctr[1], v[i + 2] - ctr[2])); }
      const groups = {};
      for (const k in this.g) { const q = this.g[k]; if (q.n > 65000) console.warn("gift3d: слишком много вершин", k, q.n); groups[k] = { v: new Float32Array(q.v), i: new Uint16Array(q.i), c: q.i.length }; }
      return { groups, ctr, rad: rad || 1 };
    }
  }
  G.MB = MB;
  const setLod = (l) => { LOD = l; };

  // ───────────── матрицы ─────────────
  const mrotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };
  const mrotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); };
  const mrotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); };
  const mtrans = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
  const mscale = (s) => new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]);
  const MI = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  G.mat = { mmul, mrotY, mrotX, mrotZ, mtrans, mscale, MI };
  const FOV = 0.5;                               // половина угла обзора (tan)
  const DIST = 3.4;
  const proj = (near = 0.2, far = 12) => { const f = 1 / FOV; return new Float32Array([f, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]); };

  // ───────────── WebGL ─────────────
  const VS = `attribute vec3 a_pos,a_nrm,a_col,a_mat;uniform mat4 u_mv,u_proj;uniform mat3 u_nm;
varying vec3 v_n,v_p,v_c,v_m;void main(){vec4 p=u_mv*vec4(a_pos,1.0);v_p=p.xyz;v_n=u_nm*a_nrm;v_c=a_col;v_m=a_mat;gl_Position=u_proj*p;}`;
  const FS = `precision highp float;varying vec3 v_n,v_p,v_c,v_m;uniform float u_holo,u_time,u_glow;uniform vec3 u_gcol;
vec3 env(vec3 d){float h=d.y*.5+.5;vec3 sky=mix(vec3(.16,.18,.28),vec3(.82,.9,1.),smoothstep(.25,1.,h));vec3 gr=vec3(.07,.06,.09);
vec3 c=mix(gr,sky,smoothstep(.3,.56,h));
c+=vec3(1.,.97,.9)*pow(max(dot(d,normalize(vec3(-.5,.75,.65))),0.),16.)*2.4;
c+=vec3(.55,.72,1.)*pow(max(dot(d,normalize(vec3(.85,.2,.35))),0.),12.)*1.3;
c+=vec3(1.,.62,.42)*pow(max(dot(d,normalize(vec3(.1,-.25,-.95))),0.),9.)*1.1;
c+=vec3(.9,.95,1.)*pow(max(dot(d,normalize(vec3(.0,.9,-.4))),0.),30.)*1.2;return c;}
void main(){vec3 N=normalize(v_n);if(!gl_FrontFacing)N=-N;vec3 V=normalize(-v_p);vec3 L=normalize(vec3(-.45,.8,.6));
float ndl=max(dot(N,L),0.),ndv=max(dot(N,V),0.);float mt=v_m.x,rg=v_m.y,em=v_m.z;vec3 al=v_c;
if(u_holo>.5){float f=dot(N,V)*3.2+N.y*1.7+u_time*.35;vec3 h=.5+.5*cos(6.2831*(vec3(0.,.33,.67)+f));al=mix(al,h,.55);mt=max(mt,.5);rg=min(rg,.28);}
vec3 R=reflect(-V,N);vec3 e=mix(env(R),env(N)*.9,rg*.75);
float fr=pow(1.-ndv,4.);vec3 F0=mix(vec3(.045),al,mt);vec3 F=F0+(1.-F0)*fr;
float ao=.72+.28*(N.y*.5+.5);
vec3 hemi=mix(vec3(.12,.1,.16),vec3(.34,.38,.5),N.y*.5+.5);
vec3 diff=al*(1.-mt)*(hemi*ao+vec3(1.,.95,.9)*ndl*.95+vec3(.35,.45,.8)*max(dot(N,normalize(vec3(.8,.1,.3))),0.)*.35);
vec3 H=normalize(L+V);float sp=pow(max(dot(N,H),0.),mix(220.,14.,rg))*(1.-rg*.75);
vec3 col=diff+e*F*(1.-.55*rg)*ao+vec3(1.,.98,.94)*sp*mix(.85,1.,mt)*(.6+.8*mt);
col+=u_gcol*pow(1.-ndv,3.)*u_glow;col+=al*em*1.4+vec3(1.)*em*.15;
col=col/(1.+col*.28);col=pow(col,vec3(1./2.2));gl_FragColor=vec4(col,1.);}`;

  class GLR {
    constructor(canvas, opts = {}) {
      const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: !!opts.keep, powerPreference: "high-performance" })
        || canvas.getContext("experimental-webgl", { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: !!opts.keep });
      if (!gl) throw new Error("no webgl");
      this.gl = gl; this.canvas = canvas; this.cache = new Map();
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      this.pr = pr; gl.useProgram(pr);
      this.at = ["a_pos", "a_nrm", "a_col", "a_mat"].map((n) => gl.getAttribLocation(pr, n));
      this.un = {}; ["u_mv", "u_proj", "u_nm", "u_holo", "u_time", "u_glow", "u_gcol"].forEach((n) => { this.un[n] = gl.getUniformLocation(pr, n); });
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.lost = true; });
      canvas.addEventListener("webglcontextrestored", () => { this.lost = false; this.cache.clear(); });
    }
    upload(mesh) {
      let c = this.cache.get(mesh); if (c) return c;
      const gl = this.gl; c = {};
      for (const k in mesh.groups) {
        const g = mesh.groups[k], vb = gl.createBuffer(), ib = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, g.v, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.i, gl.STATIC_DRAW);
        c[k] = { vb, ib, n: g.c };
      }
      this.cache.set(mesh, c); return c;
    }
    // o: {yaw, pitch, roll, zoom, time, holo, glow:[r,g,b,a], parts:{имя: матрица}, ox, oy}
    draw(mesh, o = {}) {
      if (this.lost) return;
      const gl = this.gl, cv = this.canvas, c = this.upload(mesh);
      gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const base = mmul(mmul(mrotX(o.pitch || 0), mrotY(o.yaw || 0)), mmul(mrotZ(o.roll || 0), mmul(mscale((o.zoom || 1) / mesh.rad * 1.0), mtrans(-mesh.ctr[0], -mesh.ctr[1], -mesh.ctr[2]))));
      const view = mmul(mtrans(o.ox || 0, o.oy || 0, -DIST), base);
      gl.uniformMatrix4fv(this.un.u_proj, false, proj());
      gl.uniform1f(this.un.u_holo, o.holo ? 1 : 0); gl.uniform1f(this.un.u_time, o.time || 0);
      const gc = o.glow || [0, 0, 0, 0]; gl.uniform3f(this.un.u_gcol, gc[0], gc[1], gc[2]); gl.uniform1f(this.un.u_glow, gc[3] || 0);
      for (const k in c) {
        const g = c[k], pm = o.parts && o.parts[k], mv = pm ? mmul(view, pm) : view;
        // матрица нормалей: вращательная часть (масштаб однородный)
        const sc = Math.hypot(mv[0], mv[1], mv[2]);
        gl.uniformMatrix4fv(this.un.u_mv, false, mv);
        gl.uniformMatrix3fv(this.un.u_nm, false, new Float32Array([mv[0] / sc, mv[1] / sc, mv[2] / sc, mv[4] / sc, mv[5] / sc, mv[6] / sc, mv[8] / sc, mv[9] / sc, mv[10] / sc]));
        gl.bindBuffer(gl.ARRAY_BUFFER, g.vb); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ib);
        this.at.forEach((a, i) => { gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 48, i * 12); });
        gl.drawElements(gl.TRIANGLES, g.n, gl.UNSIGNED_SHORT, 0);
      }
    }
    dispose() {
      try { const ext = this.gl.getExtension("WEBGL_lose_context"); if (ext) ext.loseContext(); } catch (e) {}
      this.cache.clear();
    }
  }

  // ───────────── запасной вариант без WebGL: тот же меш на обычном canvas ─────────────
  const envJS = (x, y, z) => {
    const h = y * 0.5 + 0.5, t = Math.max(0, Math.min(1, (h - 0.3) / 0.26)), ss = t * t * (3 - 2 * t), sk = Math.max(0, Math.min(1, (h - 0.25) / 0.75));
    let r = 0.07 + (0.16 + (0.82 - 0.16) * sk - 0.07) * ss, g = 0.06 + (0.18 + (0.9 - 0.18) * sk - 0.06) * ss, b = 0.09 + (0.28 + (1 - 0.28) * sk - 0.09) * ss;
    const d1 = Math.max(0, (-0.5 * x + 0.75 * y + 0.65 * z) / 1.12), w1 = Math.pow(d1, 16) * 2.4; r += w1; g += w1 * 0.97; b += w1 * 0.9;
    const d2 = Math.max(0, (0.85 * x + 0.2 * y + 0.35 * z) / 0.94), w2 = Math.pow(d2, 12) * 1.3; r += w2 * 0.55; g += w2 * 0.72; b += w2;
    return [r, g, b];
  };
  class SoftR {
    constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext("2d"); }
    draw(mesh, o = {}) {
      const cv = this.canvas, ctx = this.ctx, W = cv.width, H = cv.height; ctx.clearRect(0, 0, W, H);
      const base = mmul(mmul(mrotX(o.pitch || 0), mrotY(o.yaw || 0)), mmul(mrotZ(o.roll || 0), mmul(mscale((o.zoom || 1) / mesh.rad), mtrans(-mesh.ctr[0], -mesh.ctr[1], -mesh.ctr[2]))));
      const tris = [], f = (1 / FOV) * (W / 2);
      for (const k in mesh.groups) {
        const g = mesh.groups[k], pm = o.parts && o.parts[k], mv = pm ? mmul(base, pm) : base, v = g.v, idx = g.i, nv = v.length / 12;
        const X = new Float32Array(nv), Y = new Float32Array(nv), Z = new Float32Array(nv), C = new Float32Array(nv * 3);
        const sc = Math.hypot(mv[0], mv[1], mv[2]);
        for (let i = 0; i < nv; i++) {
          const j = i * 12, px = v[j], py = v[j + 1], pz = v[j + 2];
          const x = mv[0] * px + mv[4] * py + mv[8] * pz + mv[12], y = mv[1] * px + mv[5] * py + mv[9] * pz + mv[13], z = mv[2] * px + mv[6] * py + mv[10] * pz + mv[14] - DIST;
          X[i] = W / 2 + f * x / -z; Y[i] = H / 2 - f * y / -z; Z[i] = z;
          let nx = (mv[0] * v[j + 3] + mv[4] * v[j + 4] + mv[8] * v[j + 5]) / sc, ny = (mv[1] * v[j + 3] + mv[5] * v[j + 4] + mv[9] * v[j + 5]) / sc, nz = (mv[2] * v[j + 3] + mv[6] * v[j + 4] + mv[10] * v[j + 5]) / sc;
          let vx = -x, vy = -y, vz = -z; const vl = Math.hypot(vx, vy, vz) || 1; vx /= vl; vy /= vl; vz /= vl;
          if (nx * vx + ny * vy + nz * vz < 0) { nx = -nx; ny = -ny; nz = -nz; }
          const ndl = Math.max(0, nx * -0.4 + ny * 0.7 + nz * 0.53), ndv = Math.max(0, nx * vx + ny * vy + nz * vz), mt = v[j + 9], rg = v[j + 10], em = v[j + 11];
          const rx = -vx + 2 * ndv * nx, ry = -vy + 2 * ndv * ny, rz = -vz + 2 * ndv * nz, e = envJS(rx, ry, rz), fr = Math.pow(1 - ndv, 4);
          const ao = 0.72 + 0.28 * (ny * 0.5 + 0.5), spw = Math.pow(Math.max(0, nx * -0.4 + ny * 0.7 + nz * 0.53 + 0.0) * 0.5 + ndv * 0.5, mt > 0.4 ? 40 : 14) * (1 - rg * 0.6) * 0.45;
          for (let c = 0; c < 3; c++) {
            const al = v[j + 6 + c], F0 = 0.045 + (al - 0.045) * mt, F = F0 + (1 - F0) * fr;
            let col = al * (1 - mt) * ((0.2 + 0.18 * (ny * 0.5 + 0.5)) * ao + ndl * 0.95) + e[c] * F * (1 - 0.55 * rg) * ao + spw * (0.6 + 0.8 * mt) + al * em * 1.4 + em * 0.15;
            col = col / (1 + col * 0.28); C[i * 3 + c] = Math.pow(Math.max(0, col), 1 / 2.2) * 255;
          }
        }
        for (let t = 0; t < idx.length; t += 3) {
          const a = idx[t], b = idx[t + 1], c = idx[t + 2];
          const area = (X[b] - X[a]) * (Y[c] - Y[a]) - (X[c] - X[a]) * (Y[b] - Y[a]); if (Math.abs(area) < 0.02) continue;
          tris.push([(Z[a] + Z[b] + Z[c]) / 3, X[a], Y[a], X[b], Y[b], X[c], Y[c], (C[a * 3] + C[b * 3] + C[c * 3]) / 3, (C[a * 3 + 1] + C[b * 3 + 1] + C[c * 3 + 1]) / 3, (C[a * 3 + 2] + C[b * 3 + 2] + C[c * 3 + 2]) / 3]);
        }
      }
      tris.sort((p, q) => p[0] - q[0]);
      ctx.lineJoin = "round"; ctx.lineWidth = 0.9;
      for (const t of tris) {
        const col = `rgb(${t[7] | 0},${t[8] | 0},${t[9] | 0})`;
        ctx.fillStyle = col; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(t[1], t[2]); ctx.lineTo(t[3], t[4]); ctx.lineTo(t[5], t[6]); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    dispose() {}
  }

  // ───────────── палитры «моделей» (NFT): общие роли main / accent / metal / gem / glow ─────────────
  G.models = [
    { k: "classic", n: "Классика" }, { k: "gold", n: "Золотой" }, { k: "ice", n: "Ледяной" }, { k: "obsidian", n: "Обсидиан" },
    { k: "neon", n: "Неоновый" }, { k: "royal", n: "Королевский" }, { k: "ghost", n: "Призрачный" }, { k: "cosmic", n: "Космический" },
  ];
  G.PAL = {
    gold: { main: M("#e9b73f", 0.95, 0.22), accent: M("#a9701a", 0.9, 0.3), metal: M("#ffd871", 1, 0.14), gem: M("#e2263e", 0.1, 0.06, 0.18), glow: M("#ffe8a0", 0, 0.3, 0.9), soft: M("#f6dfa4", 0.1, 0.5), dark: M("#5a3a0c", 0.8, 0.35), aura: [1, 0.78, 0.3] },
    ice: { main: M("#9fdcff", 0.2, 0.08), accent: M("#d8f4ff", 0.5, 0.12), metal: M("#c9e4f4", 1, 0.12), gem: M("#2ad0ff", 0.1, 0.05, 0.35), glow: M("#bff1ff", 0, 0.3, 0.9), soft: M("#e8f8ff", 0, 0.4), dark: M("#27506e", 0.4, 0.3), aura: [0.5, 0.85, 1] },
    obsidian: { main: M("#17151f", 0.5, 0.1), accent: M("#6f4bd8", 0.9, 0.2), metal: M("#9a7bf2", 1, 0.16), gem: M("#b24dff", 0.1, 0.05, 0.4), glow: M("#c9a3ff", 0, 0.3, 0.9), soft: M("#2a2735", 0.2, 0.3), dark: M("#08070d", 0.5, 0.2), aura: [0.55, 0.3, 1] },
    neon: { main: M("#14162b", 0.4, 0.15), accent: M("#ff2bd6", 0.3, 0.2, 0.35), metal: M("#37f0ff", 0.8, 0.18, 0.25), gem: M("#ff2bd6", 0.1, 0.05, 0.7), glow: M("#46ffe9", 0, 0.3, 1), soft: M("#2b2f5a", 0.2, 0.3), dark: M("#090a18", 0.4, 0.2), aura: [0.2, 1, 0.9] },
    royal: { main: M("#4a1fa8", 0.2, 0.2), accent: M("#d9a62e", 0.95, 0.2), metal: M("#ffd25a", 1, 0.14), gem: M("#16d0a2", 0.1, 0.06, 0.25), glow: M("#ffe6a0", 0, 0.3, 0.9), soft: M("#7b4fe0", 0.1, 0.3), dark: M("#220a5a", 0.3, 0.3), aura: [0.7, 0.5, 1] },
    ghost: { main: M("#eef2ff", 0.5, 0.1), accent: M("#cfd8ff", 0.7, 0.12), metal: M("#ffffff", 1, 0.1), gem: M("#a0f0ff", 0.2, 0.05, 0.4), glow: M("#ffffff", 0, 0.3, 1), soft: M("#f6f8ff", 0.2, 0.2), dark: M("#8d98c8", 0.4, 0.3), aura: [0.85, 0.9, 1], holo: 1 },
    cosmic: { main: M("#0e1a5c", 0.6, 0.12), accent: M("#7d4cff", 0.9, 0.15, 0.15), metal: M("#6cc9ff", 1, 0.12), gem: M("#ff5cd0", 0.1, 0.05, 0.6), glow: M("#9be0ff", 0, 0.3, 1), soft: M("#2b3fa8", 0.3, 0.2), dark: M("#050a2a", 0.5, 0.2), aura: [0.4, 0.55, 1], holo: 1 },
  };

  // ───────────── кэш моделей и миниатюр ─────────────
  const meshes = new Map();
  // d — описание дизайна {name, base:{роли}, build(b, P, K, ctx)}, model — ключ модели
  G.mesh = (kind, id, model = "classic", lod = 1) => {
    const key = [kind, id, model, lod].join("|");
    if (meshes.has(key)) return meshes.get(key);
    const d = G.designs[kind][id]; if (!d) return null;
    const P = Object.assign({}, d.base, model && model !== "classic" ? paletteFor(d, model) : null);
    const b = new MB(); setLod(lod);
    try { d.build(b, P, K, { curve, M, hex, merge, lod }); } finally { setLod(1); }
    const m = b.done(); m.holo = !!(model !== "classic" && G.PAL[model] && G.PAL[model].holo) || !!d.holo; m.aura = (G.PAL[model] && G.PAL[model].aura) || d.aura || [1, 1, 1]; m.key = key;
    meshes.set(key, m); return m;
  };
  function paletteFor(d, model) {
    const pal = G.PAL[model]; if (!pal) return null;
    const out = {}; for (const r of ["main", "accent", "metal", "gem", "glow", "soft", "dark"]) if (pal[r]) out[r] = pal[r];
    return out;
  }
  G.canGL = (() => { if (G.forceSoft) return false; try { const c = document.createElement("canvas"); return !!(c.getContext("webgl") || c.getContext("experimental-webgl")); } catch (e) { return false; } })();
  const useSoft = () => G.forceSoft || !G.canGL || G._glFail;

  // миниатюры: прозрачный PNG на каждую пару (дизайн, модель) — рисуется один раз и переиспользуется всеми карточками
  const thumbs = new Map(), waiting = new Map(), queue = [];
  let tr = null, trCanvas = null, busy = false;
  const mkRenderer = (size) => {
    if (!trCanvas) { trCanvas = document.createElement("canvas"); }
    trCanvas.width = trCanvas.height = size;
    if (!tr || tr.soft !== useSoft()) {
      if (useSoft()) { tr = new SoftR(trCanvas); tr.soft = true; }
      else { try { tr = new GLR(trCanvas, { keep: true }); tr.soft = false; } catch (e) { G._glFail = true; trCanvas = document.createElement("canvas"); trCanvas.width = trCanvas.height = size; tr = new SoftR(trCanvas); tr.soft = true; } }
    }
    return tr;
  };
  G.reset = () => { tr = null; trCanvas = null; thumbs.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} }); thumbs.clear(); waiting.clear(); queue.length = 0; };
  const tkey = (kind, id, model, size, ang) => [kind, id, model || "classic", size, ang || 0].join("|");
  G.thumbNow = (kind, id, model, size = 320, ang = 0) => thumbs.get(tkey(kind, id, model, LT ? Math.min(size, 200) : size, ang)) || "";
  // cb(url) вызывается сразу (если уже есть) либо когда миниатюра нарисуется
  G.thumb = (kind, id, model, size, cb, ang = 0) => {
    size = size || 320; if (LT) size = Math.min(size, 200); const k = tkey(kind, id, model, size, ang);
    if (thumbs.has(k)) return cb(thumbs.get(k));
    if (waiting.has(k)) return waiting.get(k).push(cb);
    waiting.set(k, [cb]); queue.push({ kind, id, model, size, ang, k }); pump();
  };
  function pump() {
    if (busy || !queue.length) return; busy = true;
    const run = () => {
      const it = queue.shift();
      if (!it) { busy = false; return; }
      let url = "";
      try {
        const r = mkRenderer(it.size), soft = r.soft, m = G.mesh(it.kind, it.id, it.model, soft ? G.lodSoft : 1);
        if (m) {
          r.draw(m, { yaw: -0.5 + it.ang, pitch: 0.18, zoom: 1.38, holo: m.holo, glow: m.aura.concat(0.25), time: 0 });
          // WebGL-контекст слабого телефона мог «потеряться» посреди рисования — картинка выйдет белой/обрезанной: рисуем заново на обычном canvas
          if (!soft && r.gl && r.gl.isContextLost && r.gl.isContextLost()) { G._glFail = true; tr = null; trCanvas = null; queue.unshift(it); busy = false; requestAnimationFrame(() => pump()); return; }
          url = trCanvas.toDataURL("image/png");
        }
      } catch (e) { console.warn("gift3d thumb", e); }
      thumbs.set(it.k, url);
      (waiting.get(it.k) || []).forEach((cb) => { try { cb(url); } catch (e) {} }); waiting.delete(it.k);
      busy = false; if (queue.length) requestAnimationFrame(() => pump());
    };
    requestAnimationFrame(run);
  }
  // сколько миниатюр ещё рисуется (для тестов)
  G.pending = () => queue.length + (busy ? 1 : 0);

  // ───────────── живой просмотр с вращением ─────────────
  // host — элемент; spec {kind,id,model}; opts {auto:1, size, pitch}. Возвращает {set(spec), destroy(), kick(), parts, onFrame}
  G.live = (host, spec, opts = {}) => {
    const cv = document.createElement("canvas"); cv.className = "g3-live"; host.appendChild(cv);
    const dpr = LT ? 1 : Math.min(window.devicePixelRatio || 1, opts.dpr || 2);
    let W = 0, H = 0;
    const fit = () => { const r = host.getBoundingClientRect(), s = Math.max(120, Math.min(LT ? 300 : 900, Math.round(Math.min(r.width || opts.size || 280, r.height || opts.size || 280) * dpr))); if (s !== W) { W = H = s; cv.width = cv.height = s; } };
    fit();
    let rend, soft = useSoft();
    try { rend = soft ? new SoftR(cv) : new GLR(cv); } catch (e) { G._glFail = true; soft = true; rend = new SoftR(cv); }
    const st = { yaw: opts.yaw != null ? opts.yaw : -0.5, pitch: opts.pitch != null ? opts.pitch : 0.16, vy: 0, vp: 0, drag: false, last: 0, t0: performance.now(), alive: true, parts: null, spec, kick: 0, zoom: opts.zoom || 1.3, onFrame: null, roll: 0 };
    let mesh = G.mesh(spec.kind, spec.id, spec.model, soft ? G.lodSoft : 1);
    const ctl = {
      el: cv, st, soft,
      set(sp) { spec = sp; st.spec = sp; mesh = G.mesh(sp.kind, sp.id, sp.model, soft ? G.lodSoft : 1); },
      kick(v = 0.25) { st.vy += v; },
      destroy() { if (!st.alive) return; st.alive = false; cancelAnimationFrame(st.raf); try { rend.dispose(); } catch (e) {} cv.remove(); },
    };
    const pos = (e) => ({ x: e.clientX, y: e.clientY });
    let lp = null;
    cv.style.touchAction = "none";
    cv.addEventListener("pointerdown", (e) => { st.drag = true; lp = pos(e); st.last = performance.now(); try { cv.setPointerCapture(e.pointerId); } catch (x) {} });
    cv.addEventListener("pointermove", (e) => { if (!st.drag) return; const p = pos(e), dx = p.x - lp.x, dy = p.y - lp.y; lp = p; st.yaw += dx * 0.011; st.pitch = Math.max(-0.7, Math.min(0.7, st.pitch + dy * 0.008)); st.vy = dx * 0.011 * 1.2; st.vp = 0; st.last = performance.now(); });
    const up = () => { st.drag = false; st.last = performance.now(); };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    let prev = performance.now();
    const loop = (now) => {
      if (!st.alive) return;
      st.raf = requestAnimationFrame(loop);
      if (!host.isConnected) return ctl.destroy();
      if (document.hidden) { prev = now; return; }
      if (LT && !st.drag && now - prev < 33) return;              // слабый телефон: не чаще ~30 кадров в секунду
      const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
      if (!st.drag) {
        st.yaw += st.vy; st.vy *= Math.pow(0.04, dt);
        if (!opts.still && now - st.last > 900) st.vy += (0.0085 - st.vy) * Math.min(1, dt * 1.6);
        if (st.pitch !== (opts.pitch != null ? opts.pitch : 0.16)) st.pitch += ((opts.pitch != null ? opts.pitch : 0.16) - st.pitch) * Math.min(1, dt * 2);
      }
      const t = (now - st.t0) / 1000;
      fit();
      const bob = opts.bob === false ? 0 : Math.sin(t * 1.6) * 0.035;
      if (st.onFrame) st.onFrame(t, st);
      if (!mesh) return;
      rend.draw(mesh, { yaw: st.yaw, pitch: st.pitch, roll: st.roll, zoom: st.zoom, oy: bob, holo: mesh.holo, glow: mesh.aura.concat(0.3), time: t, parts: st.parts });
    };
    st.raf = requestAnimationFrame(loop);
    return ctl;
  };

  G.hasDesign = (kind, id) => !!G.designs[kind][id];
  return G;
})();
