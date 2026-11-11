// GIANT materials and skin (MODELING c3): the plates a giant is clad in, as a lit material and as real geometry.
//
// Why: v1's giant was flat red toon panels with a grid of lines (a toy at any distance). A real clad giant (Mukhina's Worker and
// Kolkhoz Woman: 0.5 mm steel sheets welded on a frame; the Liberty: copper hammered on formers over an iron armature) is read
// at THREE frequencies: the plate (3 x 1.5 m, lapped, stepped at the seam, in the silhouette), the fixture (ladder, door, rail,
// in human units) and the rivet (a row at every seam, 0.28 m apart, in the light). This file makes the first and third:
//   plateSet(opts)   -> canvases {albedo, bump, rough}: tile of 6 x 6 m of plate with brick-bond seams, rivet rows, mill scale, hammer dimples
//   steelMat(opts)   -> MeshStandardMaterial with those maps + grime that rises from the ground and runs down (shader, world-space)
//   loft(rings)      -> smooth elliptical lofts with UVs in plate units
//   clad(...)        -> a limb as a stack of lapped courses (each its own mesh, with its own rivet row) over a lattice armature
// All lengths in the giant's own units; `k` (real metres per local unit) is passed in so a plate is 3 x 1.5 REAL metres.
import * as THREE from 'three';
THREE.ColorManagement.enabled = false;

export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const cvs = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const rgb = (c, d = 0) => `rgb(${Math.max(0, Math.min(255, c[0] + d)) | 0},${Math.max(0, Math.min(255, c[1] + d)) | 0},${Math.max(0, Math.min(255, c[2] + d)) | 0})`;

// ---- plate textures. tile = 6 m. plates are plateW x plateH metres, laid in running bond. `base` is an rgb triple.
export function plateSet({ seed = 1, base = [120, 124, 128], tone = 14, plateW = 3, plateH = 1.5, tile = 6, px = 1024, rivet = .15, scale = .4, hammer = 0, rust = .25, streak = .5, mill = .5, weld = true } = {}) {
  const R = rng(seed), A = cvs(px, px), B = cvs(px, px), Rg = cvs(px, px), a = A.getContext('2d'), b = B.getContext('2d'), r = Rg.getContext('2d');
  const ppm = px / tile, pw = plateW * ppm, ph = plateH * ppm;
  a.fillStyle = rgb(base); a.fillRect(0, 0, px, px); b.fillStyle = '#808080'; b.fillRect(0, 0, px, px); r.fillStyle = '#9a9a9a'; r.fillRect(0, 0, px, px);
  const rows = Math.round(px / ph);
  for (let j = 0; j < rows; j++) {
    const off = (j % 2) * pw / 2 + R() * 0; const nx = Math.ceil(px / pw) + 1;
    for (let i = -1; i < nx; i++) {
      const x = i * pw + off, y = j * ph, d = (R() - .5) * tone * 2, warm = (R() - .5) * 8;
      // plate body: tone, a vertical gradient (the plate was hung from the top edge: dirt collects at the foot), and mill-scale mottling
      const gr = a.createLinearGradient(0, y, 0, y + ph); gr.addColorStop(0, `rgba(${base[0] + d + warm},${base[1] + d},${base[2] + d - warm},1)`); gr.addColorStop(1, `rgba(${base[0] + d - 16 + warm},${base[1] + d - 17},${base[2] + d - 15 - warm},1)`);
      a.fillStyle = gr; a.fillRect(x, y, pw, ph);
      for (let m = 0; m < 26 * mill; m++) { a.fillStyle = `rgba(${20 + R() * 20},${24 + R() * 20},${30 + R() * 20},${.04 + R() * .09})`; const w = pw * (.05 + R() * .25), h = ph * (.05 + R() * .25); a.beginPath(); a.ellipse(x + R() * pw, y + R() * ph, w, h, R() * 3, 0, 7); a.fill(); }
      // streaks that run down from the rivet rows (rust and soot), the weather in the plate
      for (let s = 0; s < 14 * streak; s++) { const sx = x + 6 + R() * (pw - 12), ln = ph * (.3 + R() * .8), wd = 1 + R() * 3; const g2 = a.createLinearGradient(0, y, 0, y + ln); const rc = R() < rust ? '120,70,40' : '30,30,34'; g2.addColorStop(0, `rgba(${rc},${.1 + R() * .12})`); g2.addColorStop(1, `rgba(${rc},0)`); a.fillStyle = g2; a.fillRect(sx, y, wd, ln); }
      if (hammer) for (let m = 0; m < 70 * hammer; m++) { const hx = x + R() * pw, hy = y + R() * ph, hr = 3 + R() * 7; const gg = b.createRadialGradient(hx, hy, 0, hx, hy, hr); gg.addColorStop(0, 'rgba(60,60,60,.55)'); gg.addColorStop(.7, 'rgba(150,150,150,.25)'); gg.addColorStop(1, 'rgba(128,128,128,0)'); b.fillStyle = gg; b.beginPath(); b.arc(hx, hy, hr, 0, 7); b.fill(); const g3 = a.createRadialGradient(hx, hy, 0, hx, hy, hr); g3.addColorStop(0, 'rgba(255,255,255,.07)'); g3.addColorStop(1, 'rgba(255,255,255,0)'); a.fillStyle = g3; a.beginPath(); a.arc(hx, hy, hr, 0, 7); a.fill(); }
      r.fillStyle = `rgba(${(R() * 50) | 0},${(R() * 50) | 0},${(R() * 50) | 0},.25)`; r.fillRect(x, y, pw, ph);
      // seam: a dark line with a lit lip below it (the lap), and the groove in the bump
      a.fillStyle = 'rgba(14,14,18,.8)'; a.fillRect(x, y + ph - 2, pw, 2); a.fillRect(x, y, 2, ph);
      a.fillStyle = 'rgba(255,255,255,.1)'; a.fillRect(x, y, pw, 2);
      b.fillStyle = '#383838'; b.fillRect(x, y + ph - 3, pw, 3); b.fillRect(x, y, 3, ph); b.fillStyle = '#b4b4b4'; b.fillRect(x, y, pw, 2);
      r.fillStyle = '#d8d8d8'; r.fillRect(x, y + ph - 3, pw, 3);
      if (weld && R() < .55) { a.fillStyle = 'rgba(200,190,170,.18)'; for (let q = 0; q < pw; q += 5) a.fillRect(x + q, y + ph - 6 - R() * 2, 4, 3); }
      // rivet rows along the lower edge and both sides: a rivet is a lit dome with a shadow under it
      const rp = rivet * ppm, rr = Math.max(2.2, .028 * ppm);
      const dot = (cx, cy) => { a.fillStyle = 'rgba(0,0,0,.35)'; a.beginPath(); a.arc(cx + 1, cy + 1.5, rr, 0, 7); a.fill(); a.fillStyle = rgb(base, 26); a.beginPath(); a.arc(cx, cy, rr, 0, 7); a.fill(); a.fillStyle = 'rgba(255,255,255,.35)'; a.beginPath(); a.arc(cx - rr * .3, cy - rr * .3, rr * .4, 0, 7); a.fill(); const gg = b.createRadialGradient(cx, cy, 0, cx, cy, rr * 1.2); gg.addColorStop(0, '#f0f0f0'); gg.addColorStop(.8, '#a0a0a0'); gg.addColorStop(1, 'rgba(128,128,128,0)'); b.fillStyle = gg; b.beginPath(); b.arc(cx, cy, rr * 1.2, 0, 7); b.fill(); };
      for (let q = rp * .5; q < pw; q += rp) dot(x + q, y + ph - 9);
      for (let q = rp; q < ph - 8; q += rp) { dot(x + 7, y + q); dot(x + pw - 7, y + q); }
    }
  }
  return { albedo: A, bump: B, rough: Rg };
}

const tex = (c, srgb = false) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; return t; };
const GRIME_V = `
varying vec3 vWP; varying vec3 vWN;
`;
// opts: the plateSet options plus metal, rough, bumpScale, grime (0..1), ground (world y of the ground), env (intensity)
export function steelMat(o = {}) {
  const S = plateSet(o), m = new THREE.MeshStandardMaterial({ map: tex(S.albedo), bumpMap: tex(S.bump), roughnessMap: tex(S.rough), metalness: o.metal ?? .55, roughness: o.rough ?? .62, bumpScale: o.bumpScale ?? 3.2, envMapIntensity: o.env ?? 1.0 });
  const grime = o.grime ?? .8, gnd = o.ground ?? 0, tint = o.tint || [1, 1, 1];
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + GRIME_V).replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 wp_ = vec4(transformed, 1.);
      #ifdef USE_INSTANCING
        wp_ = instanceMatrix * wp_;
      #endif
      vWP = (modelMatrix * wp_).xyz;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GRIME_V + `
      float gh_(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float gn_(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(gh_(i), gh_(i+vec2(1,0)), f.x), mix(gh_(i+vec2(0,1)), gh_(i+vec2(1,1)), f.x), f.y); }
    `).replace('#include <color_fragment>', `#include <color_fragment>
      {
        float h = vWP.y - ${gnd.toFixed(2)};
        float low = 1. - smoothstep(0., 10., h);                                    // dirt thrown up from the ground
        float col = gn_(vec2((vWP.x + vWP.z) * 1.7, 3.)) * .6 + gn_(vec2((vWP.x - vWP.z) * 5.3, 9.)) * .4;   // columns of run-off
        float run = smoothstep(.45, .85, col) * smoothstep(0., 40., h + 20.) * (.5 + .5 * gn_(vec2(vWP.y * .2, vWP.x * .3)));
        float patch = gn_(vWP.xz * .35 + vWP.y * .25);
        float dirt = clamp(low * (.55 + .6 * patch) + run * .5, 0., 1.) * ${grime.toFixed(2)};
        diffuseColor.rgb *= mix(vec3(1.), vec3(.42, .38, .34), dirt);
        diffuseColor.rgb *= vec3(${tint[0].toFixed(3)}, ${tint[1].toFixed(3)}, ${tint[2].toFixed(3)});
      }`);
  };
  m.customProgramCacheKey = () => 'steel' + JSON.stringify([o.seed, gnd, grime, tint]);
  return m;
}
// a plain material (primer, black, hazard) with the same dirt, no plate pattern
export function plainMat(color, o = {}) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: o.metal ?? .3, roughness: o.rough ?? .75, envMapIntensity: o.env ?? .8 });
  if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.ei ?? 1; }
  return m;
}

// ---- loft: rings [{y, rx, rz, cx, cz}] (along +y; reverse by giving descending y) -> BufferGeometry, smooth, UVs in tile units (k/tile per local unit)
export function loft(rings, { n = 22, k = .68, tile = 6, cap0 = true, cap1 = true, flat = false } = {}) {
  const pos = [], uv = [], idx = [], us = k / tile; let v = 0; const nR = rings.length;
  const per = r => Math.PI * (3 * (r.rx + r.rz) - Math.sqrt((3 * r.rx + r.rz) * (r.rx + 3 * r.rz)));
  for (let i = 0; i < nR; i++) {
    const r = rings[i]; if (i > 0) { const p = rings[i - 1]; v += Math.hypot(r.y - p.y, (r.rx - p.rx) * .5, (r.cx || 0) - (p.cx || 0), (r.cz || 0) - (p.cz || 0)) * us; }
    const P = per(r) * us;
    for (let j = 0; j <= n; j++) { const a = j / n * Math.PI * 2; pos.push((r.cx || 0) + r.rx * Math.sin(a), r.y, (r.cz || 0) + r.rz * Math.cos(a)); uv.push(j / n * P, v); }
  }
  for (let i = 0; i < nR - 1; i++) for (let j = 0; j < n; j++) { const a = i * (n + 1) + j, b = a + 1, c = a + n + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const cap = (r, up, i0) => { const c0 = pos.length / 3; pos.push(r.cx || 0, r.y, r.cz || 0); uv.push(0, 0); for (let j = 0; j <= n; j++) { const a = j / n * Math.PI * 2; pos.push((r.cx || 0) + r.rx * Math.sin(a), r.y, (r.cz || 0) + r.rz * Math.cos(a)); uv.push(Math.sin(a) * r.rx * us + .5, Math.cos(a) * r.rz * us + .5); } for (let j = 0; j < n; j++) up ? idx.push(c0, c0 + 1 + j, c0 + 2 + j) : idx.push(c0, c0 + 2 + j, c0 + 1 + j); };
  const up = rings[nR - 1].y > rings[0].y; if (cap0) cap(rings[0], !up); if (cap1) cap(rings[nR - 1], up);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  // the cap normals computed with the shared ring vertices would smear; rings are separate vertices from caps, so computeVertexNormals is right for each.
  return g;
}

// box-mapped UVs in tile units (hard-edged parts: boots, plates, doors): converts to non-indexed, picks the axis of the face normal
export function boxUV(geo, k = .68, tile = 6) {
  const g = geo.index ? geo.toNonIndexed() : geo; g.computeVertexNormals(); const p = g.attributes.position, nm = g.attributes.normal, uv = new Float32Array(p.count * 2), us = k / tile;
  for (let i = 0; i < p.count; i += 3) {
    const nx = Math.abs(nm.getX(i) + nm.getX(i + 1) + nm.getX(i + 2)), ny = Math.abs(nm.getY(i) + nm.getY(i + 1) + nm.getY(i + 2)), nz = Math.abs(nm.getZ(i) + nm.getZ(i + 1) + nm.getZ(i + 2));
    for (let q = 0; q < 3; q++) { const x = p.getX(i + q), y = p.getY(i + q), z = p.getZ(i + q); let u, v; if (ny >= nx && ny >= nz) { u = x; v = z; } else if (nx >= nz) { u = z; v = y; } else { u = x; v = y; } uv[(i + q) * 2] = u * us; uv[(i + q) * 2 + 1] = v * us; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g;
}

// ---- instanced bars (lattice members): [[A, B, r], ...] in the parent's space
const UNIT = new THREE.CylinderGeometry(1, 1, 1, 6, 1, false);
export function bars(list, mat, parent) {
  if (!list.length) return null; const im = new THREE.InstancedMesh(UNIT, mat, list.length), M = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(), mid = new THREE.Vector3(), d = new THREE.Vector3();
  list.forEach(([A, B, r], i) => { d.subVectors(B, A); const L = d.length(); q.setFromUnitVectors(Y, d.normalize()); mid.addVectors(A, B).multiplyScalar(.5); s.set(r, L, r); M.compose(mid, q, s); im.setMatrixAt(i, M); });
  im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; if (parent) parent.add(im); return im;
}
const RIVET = new THREE.SphereGeometry(1, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
// a ring of rivets (instanced domes) at height y on an ellipse
export function rivetRing(pts, mat, parent, r) {
  const im = new THREE.InstancedMesh(RIVET, mat, pts.length), M = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(r, r, r);
  pts.forEach(([p, n], i) => { q.setFromUnitVectors(Y, n); M.compose(p, q, s); im.setMatrixAt(i, M); }); im.castShadow = false; im.receiveShadow = true; im.frustumCulled = false; parent.add(im); return im;
}

// ---- clad: a limb (or torso) as a stack of lapped courses over a lattice armature.
// prof(t) -> {rx, rz, cx, cz}, t from 0 (start) to 1 (end); the limb runs along `dir` (-1 = down, +1 = up) from y = 0.
// opts: k, len (local), pitch (course height, real m), lap (real m), n sides, rivetPitch (real m), clad (0..1 threshold base), lattice (bool)
export function clad(parent, steel, prof, len, { k = .68, dir = -1, pitch = 1.5, lap = .07, n = 22, rivets = .3, rivetMat = null, thr0 = 0, thrSpan = .8, seed = 1, armature = null, arm = null, cap0 = false, cap1 = false } = {}) {
  const R = rng(seed), g = new THREE.Group(); parent.add(g); const courses = [];
  const nC = Math.max(1, Math.round(len * k / pitch)), L = lap / k;
  for (let i = 0; i < nC; i++) {
    const t0 = i / nC, t1 = (i + 1) / nC, tm = (t0 + t1) / 2, rings = [];
    for (const [t, grow] of [[t0, i > 0 ? 1 : 0], [tm, .5], [t1, 0]]) { const p = prof(t), y = dir * t * len; rings.push({ y, rx: p.rx + L * grow, rz: p.rz + L * grow, cx: p.cx || 0, cz: p.cz || 0 }); }
    const m = new THREE.Mesh(loft(rings, { n, k, cap0: cap0 && i === 0, cap1: cap1 && i === nC - 1 }), steel); m.castShadow = true; m.receiveShadow = true;
    const c = new THREE.Group(); c.add(m); c.userData.thr = thr0 + thrSpan * (t0 * .7 + R() * .3);
    // rivets at the lap seam
    if (rivets && i > 0) {
      const p = prof(t0), rx = p.rx + L, rz = p.rz + L, per = Math.PI * (3 * (rx + rz) - Math.sqrt((3 * rx + rz) * (rx + 3 * rz))), cnt = Math.max(8, Math.round(per * k / rivets)), pts = [], y = dir * t0 * len;
      for (let j = 0; j < cnt; j++) { const a = (j + .5) / cnt * Math.PI * 2, nx = Math.sin(a) / rx, nz = Math.cos(a) / rz, nl = Math.hypot(nx, nz); pts.push([new THREE.Vector3((p.cx || 0) + rx * Math.sin(a), y - dir * .35 / k, (p.cz || 0) + rz * Math.cos(a)), new THREE.Vector3(nx / nl, 0, nz / nl)]); }
      const rv = rivetRing(pts, rivetMat || steel, c, .045 / k); void rv;
    }
    g.add(c); courses.push(c);
  }
  // armature: 6 longerons and a ring every ~3 m with diagonals, visible where plates are not (yet) on
  if (armature) {
    const list = [], nR = Math.max(2, Math.round(len * k / 3) + 1), ring = [];
    for (let i = 0; i < nR; i++) { const t = i / (nR - 1), p = prof(t), y = dir * t * len, r = [];
      for (let j = 0; j < 6; j++) { const a = j / 6 * Math.PI * 2; r.push(new THREE.Vector3((p.cx || 0) + p.rx * .88 * Math.sin(a), y, (p.cz || 0) + p.rz * .88 * Math.cos(a))); }
      ring.push(r); }
    const th = (arm?.r ?? .12) / k;
    for (let i = 0; i < nR; i++) for (let j = 0; j < 6; j++) { list.push([ring[i][j], ring[i][(j + 1) % 6], th * .8]); if (i < nR - 1) { list.push([ring[i][j], ring[i + 1][j], th]); list.push([ring[i][j], ring[i + 1][(j + 1) % 6], th * .6]); } }
    g.userData.armature = bars(list, armature, g);
  }
  g.userData.courses = courses; return g;
}
export function setClad(root, v) { root.traverse(o => { if (o.userData?.courses) for (const c of o.userData.courses) c.visible = c.userData.thr <= v; }); }
