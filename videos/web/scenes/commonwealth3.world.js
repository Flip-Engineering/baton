// COMMON WEALTH v8: the world. Procedural textures, lit building kits (grange and union halls, brick main
// streets, co-op elevators, houses, water towers, a church, a steel mill, the rail), the towns on the survey
// grid, the road network that lights town to town, and the ACP mark drawn by halls and roads.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../lib/kit.js';

export const G = 320, GZ0 = 185;                   // survey grid: section roads every G metres (x = kG, z = GZ0 + kG)
export const RAILZ = -60;
export const MARK = { x: 0, z: -2450, w: 1300 };
export function hgt(x, z) {
  return 3.0 * Math.sin(x * 0.0021 + 1.3) * Math.sin(z * 0.0017 + 0.4) + 1.2 * Math.sin(x * 0.0063 - z * 0.0041) + 0.3 * Math.sin(x * 0.021 + z * 0.017);
}
export const lin = hex => new THREE.Color(hex);       // ColorManagement converts sRGB hex to linear

// ---------------------------------------------------------------- textures (baked at load)
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function noiseFill(g, w, h, r, amt, dark = true) {
  const id = g.getImageData(0, 0, w, h), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(id, 0, 0);
}
function blotches(g, w, h, r, n, col, rmin, rmax) {
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, rr = rmin + r() * (rmax - rmin), gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
}
function streaks(g, w, h, r, n, col, len) {
  g.strokeStyle = col;
  for (let i = 0; i < n; i++) { const x = r() * w, y = r() * h; g.lineWidth = 0.5 + r() * 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y + len * (0.3 + r())); g.stroke(); }
}
// height canvas -> normal map texture
function normalFrom(hc, strength = 2) {
  const w = hc.width, h = hc.height, src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const [c, g] = cv(w, h), id = g.createImageData(w, h), d = id.data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  return c;
}
function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
// every tile covers 4 m x 4 m (uv in metres / 4)
export function makeTextures() {
  const r = rng(77), T = {};
  { // board and batten, white paint gone chalky (halls)
    const [c, g] = cv(512, 512), [hc, hg] = cv(512, 512);
    g.fillStyle = '#e6e0d2'; g.fillRect(0, 0, 512, 512); hg.fillStyle = '#808080'; hg.fillRect(0, 0, 512, 512);
    for (let x = 0; x < 512; x += 38.4) {                         // boards 0.3 m, battens over the seams
      g.fillStyle = `rgba(${150 + r() * 40},${140 + r() * 40},${120 + r() * 30},0.18)`; g.fillRect(x, 0, 38.4, 512);
      g.fillStyle = '#f2ede2'; g.fillRect(x - 4, 0, 8, 512); g.fillStyle = 'rgba(60,50,40,0.35)'; g.fillRect(x + 4, 0, 2, 512);
      hg.fillStyle = '#e0e0e0'; hg.fillRect(x - 4, 0, 8, 512); hg.fillStyle = '#707070'; hg.fillRect(x - 19, 0, 1, 512);
    }
    streaks(g, 512, 512, r, 260, 'rgba(90,80,70,0.12)', 40); blotches(g, 512, 512, r, 30, 'rgba(120,100,70,0.12)', 10, 60);
    noiseFill(g, 512, 512, r, 18);
    T.wood = tex(c); T.woodN = tex(normalFrom(hc, 3), false);
  }
  { // clapboard (houses): tinted by vertex colour, so near-white here
    const [c, g] = cv(512, 512), [hc, hg] = cv(512, 512);
    g.fillStyle = '#f0ece4'; g.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 16) {                            // 12.5 cm courses
      const gr = g.createLinearGradient(0, y, 0, y + 16); gr.addColorStop(0, 'rgba(0,0,0,0.28)'); gr.addColorStop(0.15, 'rgba(0,0,0,0.05)'); gr.addColorStop(1, 'rgba(255,255,255,0.05)');
      g.fillStyle = gr; g.fillRect(0, y, 512, 16);
      const hgr = hg.createLinearGradient(0, y, 0, y + 16); hgr.addColorStop(0, '#303030'); hgr.addColorStop(1, '#d0d0d0'); hg.fillStyle = hgr; hg.fillRect(0, y, 512, 16);
    }
    streaks(g, 512, 512, r, 120, 'rgba(70,60,50,0.1)', 30); noiseFill(g, 512, 512, r, 14);
    T.clap = tex(c); T.clapN = tex(normalFrom(hc, 2.5), false);
  }
  { // brick, running bond, with mortar relief and soot
    const [c, g] = cv(512, 512), [hc, hg] = cv(512, 512);
    g.fillStyle = '#b8b0a4'; g.fillRect(0, 0, 512, 512); hg.fillStyle = '#404040'; hg.fillRect(0, 0, 512, 512);
    const bh = 512 / 60, bw = 512 / 18;                             // 6.7 cm courses, 22 cm bricks
    for (let row = 0; row < 60; row++) for (let k = -1; k < 19; k++) {
      const x = k * bw + (row % 2) * bw / 2, y = row * bh, v = 0.75 + r() * 0.4;
      g.fillStyle = `rgb(${160 * v | 0},${78 * v | 0},${58 * v | 0})`; g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      hg.fillStyle = '#c8c8c8'; hg.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    }
    blotches(g, 512, 512, r, 20, 'rgba(30,20,20,0.18)', 20, 90); noiseFill(g, 512, 512, r, 20);
    T.brick = tex(c); T.brickN = tex(normalFrom(hc, 2), false);
  }
  { // corrugated steel with rust runs (elevators, sheds, the mill)
    const [c, g] = cv(512, 512), [hc, hg] = cv(512, 512);
    for (let x = 0; x < 512; x++) { const s = Math.sin(x / 512 * Math.PI * 2 * 60); const v = 170 + s * 38;
      g.fillStyle = `rgb(${v},${v + 2},${v + 4})`; g.fillRect(x, 0, 1, 512); const hv = 128 + s * 110; hg.fillStyle = `rgb(${hv},${hv},${hv})`; hg.fillRect(x, 0, 1, 512); }
    for (let y = 0; y < 512; y += 128) { g.fillStyle = 'rgba(40,30,20,0.35)'; g.fillRect(0, y, 512, 2); }
    streaks(g, 512, 512, r, 160, 'rgba(120,60,25,0.16)', 80); blotches(g, 512, 512, r, 20, 'rgba(90,60,40,0.15)', 10, 70); noiseFill(g, 512, 512, r, 16);
    T.corr = tex(c); T.corrN = tex(normalFrom(hc, 1.5), false);
  }
  { // board-marked concrete (silos, foundations)
    const [c, g] = cv(512, 512), [hc, hg] = cv(512, 512);
    g.fillStyle = '#b9b4aa'; g.fillRect(0, 0, 512, 512); hg.fillStyle = '#808080'; hg.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 25.6) { g.fillStyle = `rgba(${90 + r() * 40},${85 + r() * 40},${80 + r() * 30},0.14)`; g.fillRect(0, y, 512, 25.6); g.fillStyle = 'rgba(40,40,40,0.25)'; g.fillRect(0, y, 512, 1.5); hg.fillStyle = '#505050'; hg.fillRect(0, y, 512, 2); }
    streaks(g, 512, 512, r, 200, 'rgba(60,55,50,0.14)', 120); blotches(g, 512, 512, r, 26, 'rgba(70,65,55,0.14)', 20, 80); noiseFill(g, 512, 512, r, 22);
    T.conc = tex(c); T.concN = tex(normalFrom(hc, 1.5), false);
  }
  { // roof: asphalt shingles / standing seam (tinted)
    const [c, g] = cv(512, 512), [hc, hg] = cv(512, 512);
    g.fillStyle = '#9a9690'; g.fillRect(0, 0, 512, 512); hg.fillStyle = '#808080'; hg.fillRect(0, 0, 512, 512);
    for (let row = 0; row < 32; row++) for (let k = -1; k < 17; k++) {
      const x = k * 32 + (row % 2) * 16, y = row * 16, v = 0.8 + r() * 0.3;
      g.fillStyle = `rgb(${150 * v | 0},${146 * v | 0},${140 * v | 0})`; g.fillRect(x + 1, y, 30, 15);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y + 13, 32, 3); hg.fillStyle = '#b0b0b0'; hg.fillRect(x + 1, y, 30, 13);
    }
    noiseFill(g, 512, 512, r, 16); T.roof = tex(c); T.roofN = tex(normalFrom(hc, 2), false);
  }
  { // windows: 4 kinds across u (sash 2 over 2, storefront plate, hall 12-light, gothic church)
    const [c, g] = cv(1024, 256), [ec, eg] = cv(1024, 256);
    eg.fillStyle = '#000'; eg.fillRect(0, 0, 1024, 256);
    const kinds = [[2, 2, 14], [1, 2, 10], [3, 4, 9], [2, 5, 10]];
    kinds.forEach(([cx, cy, fr], k) => {
      const x0 = k * 256;
      g.fillStyle = '#e8e2d6'; g.fillRect(x0, 0, 256, 256);             // painted frame
      const pw = (256 - 2 * fr - (cx - 1) * fr * 0.6) / cx, ph = (256 - 2 * fr - (cy - 1) * fr * 0.6) / cy;
      for (let i = 0; i < cx; i++) for (let j = 0; j < cy; j++) {
        const x = x0 + fr + i * (pw + fr * 0.6), y = fr + j * (ph + fr * 0.6);
        const gr = g.createLinearGradient(x, y, x + pw, y + ph); gr.addColorStop(0, '#39404a'); gr.addColorStop(0.5, '#1b1f26'); gr.addColorStop(1, '#2a3038'); g.fillStyle = gr; g.fillRect(x, y, pw, ph);
        // lit glass: a lamp-warm gradient, a shade line, a figure or a curtain in some panes
        const eg2 = eg.createRadialGradient(x0 + 128, 60, 10, x0 + 128, 128, 220); eg2.addColorStop(0, '#fff4dc'); eg2.addColorStop(0.5, '#ffc070'); eg2.addColorStop(1, '#b86a28');
        eg.fillStyle = eg2; eg.fillRect(x, y, pw, ph);
      }
      if (k === 1) { eg.fillStyle = 'rgba(60,30,10,0.55)'; eg.fillRect(x0 + fr, 170, 236, 90); }             // counter and shelves in the store
      if (k === 0) { eg.fillStyle = 'rgba(120,60,20,0.45)'; eg.fillRect(x0 + fr, fr, 60, 230); eg.fillRect(x0 + 196, fr, 50, 230); }   // curtains
    });
    noiseFill(g, 1024, 256, r, 10);
    T.win = tex(c); T.winE = tex(ec);
  }
  return T;
}

// Signs: an atlas of painted boards and printed notices (in-world text, §1.2 L7)
export const SIGNS = ['GRANGE HALL', 'UNION HALL', 'CO-OP · IOWA', 'CHAPTER ENTERPRISES', 'HARDWARE', 'FEED & SEED', 'CAFE', 'DRUG',
  'TAVERN', 'IMPLEMENT', 'UNION PACIFIC · OMAHA', 'LUMBER', 'OHIO', 'MACHINE SHOP', 'POST OFFICE', 'THEATRE'];
export function makeSignAtlas(extra = []) {
  const [c, g] = cv(1024, 1024), n = 16, rh = 1024 / n;
  const r = rng(5);
  SIGNS.forEach((s, i) => {
    const y = i * rh, dark = i === 2 || i === 10 || i === 12;
    g.fillStyle = dark ? '#d8d2c4' : ['#1d2a22', '#5a1414', '#1c2233', '#2b1a12'][i % 4]; g.fillRect(0, y, 1024, rh);
    g.strokeStyle = dark ? '#8a1c14' : '#e8dcc0'; g.lineWidth = 4; g.strokeRect(8, y + 6, 1008, rh - 12);
    g.fillStyle = dark ? '#8a1c14' : '#efe4c8'; g.font = `bold ${rh * 0.62}px "DejaVu Serif"`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(s, 512, y + rh * 0.54, 980);
  });
  noiseFill(g, 1024, 1024, r, 20);
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return { tex: t, n };
}
// a printed charter pinned inside the hall window: FIVE MEMBERS. (CONST-M Art. V §5), DIRECT CONTACT. on the notice
export function makeCharter() {
  const [c, g] = cv(256, 340);
  g.fillStyle = '#f4ecd8'; g.fillRect(0, 0, 256, 340);
  g.fillStyle = '#8a1c14'; g.font = 'bold 30px "DejaVu Serif"'; g.textAlign = 'center'; g.fillText('CHARTER', 128, 46);
  g.fillStyle = '#1a1410'; g.font = 'bold 34px "Plex Mono", monospace'; g.fillText('FIVE', 128, 120); g.fillText('MEMBERS.', 128, 160);
  g.font = '13px "Plex Mono", monospace';
  ['CHAPTER No. 7 · MEETS THURSDAYS', 'ACTION BASE · COUNTY ROAD 12', 'DIRECT CONTACT.', 'BRING A NEIGHBOR'].forEach((s, i) => g.fillText(s, 128, 210 + i * 26));
  g.strokeStyle = '#8a1c14'; g.lineWidth = 3; g.strokeRect(10, 10, 236, 320);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- geometry kit
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
export function T(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); return new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
}
const mul = (a, b) => a.clone().multiply(b);
function boxGeo(w, h, d, tile = 4) {           // centred on its base; uv in metres / tile
  const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0);
  const uv = g.attributes.uv, spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * spans[f][0] / tile, uv.getY(i) * spans[f][1] / tile); }
  return g;
}
function cylGeo(rt, rb, h, seg = 16, open = false, tile = 4) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open); g.translate(0, h / 2, 0);
  const uv = g.attributes.uv, c = 2 * Math.PI * Math.max(rt, rb);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * c / tile, uv.getY(i) * h / tile);
  return g;
}
function triGeo(pts, tile = 4) {                // a planar polygon fan from points in the XY plane (gable ends)
  const g = new THREE.BufferGeometry(), pos = [], uvs = [];
  for (let i = 1; i < pts.length - 1; i++) for (const p of [pts[0], pts[i], pts[i + 1]]) { pos.push(p[0], p[1], 0); uvs.push(p[0] / tile, p[1] / tile); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals(); return g;
}
export class Kit {
  constructor() { this.parts = new Map(); this.win = { pos: [], uv: [], town: [], bright: [], nrm: [] }; this.pts = []; this.signs = []; }
  add(key, geo, M, color = 0xffffff) {
    let g = geo.index ? geo.toNonIndexed() : geo; g.applyMatrix4(M);
    if (!g.attributes.normal) g.computeVertexNormals();
    const c = color instanceof THREE.Color ? color : new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
  }
  box(key, M, x, y, z, w, h, d, color, ry = 0) { this.add(key, boxGeo(w, h, d), mul(M, T(x, y, z, ry)), color); }
  cyl(key, M, x, y, z, rt, rb, h, color, seg = 16, open = false) { this.add(key, cylGeo(rt, rb, h, seg, open), mul(M, T(x, y, z)), color); }
  // a gable roof over a w x d footprint (ridge along local z), eaves at height y
  gable(M, x, y, z, w, d, rise, oh, roofCol, wallKey, wallCol, roofKey = 'roof') {
    const half = w / 2 + oh, len = Math.hypot(half, rise * (half / (w / 2))), ang = Math.atan2(rise, w / 2);
    for (const s of [1, -1]) {
      const g = boxGeo(len, 0.18, d + 2 * oh);
      g.translate(-len / 2 * s, 0, 0);
      this.add(roofKey, g, mul(M, T(x, y + rise + 0.05, z, 0, 0, s * ang)), roofCol);
    }
    for (const s of [1, -1]) {
      const g = triGeo([[-w / 2, 0], [w / 2, 0], [0, rise]]);
      if (s < 0) g.rotateY(Math.PI);
      this.add(wallKey, g, mul(M, T(x, y, z + s * d / 2)), wallCol);
    }
  }
  // a window quad on a wall: local frame (u along wall, facing +z of M'), kind 0..3, town index, brightness
  window(M, x, y, z, w, h, ry, kind, town, bright = 1, trim = 0xf0ece0) {
    const W = mul(M, T(x, y, z, ry));
    const p = [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]], u0 = kind / 4, u1 = (kind + 1) / 4;
    const uvq = [[u0, 0], [u1, 0], [u1, 1], [u0, 1]];
    const nrm = new THREE.Vector3(0, 0, 1).transformDirection(W);
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const v = new THREE.Vector3(p[i][0], p[i][1], 0.06).applyMatrix4(W);
      this.win.pos.push(v.x, v.y, v.z); this.win.uv.push(...uvq[i]); this.win.town.push(town); this.win.bright.push(bright); this.win.nrm.push(nrm.x, nrm.y, nrm.z);
    }
    // trim: head, sill and jambs as thin boxes
    this.add('trim', boxGeo(w + 0.3, 0.14, 0.12), mul(W, T(0, h, 0.04)), trim);
    this.add('trim', boxGeo(w + 0.4, 0.1, 0.2), mul(W, T(0, -0.1, 0.08)), trim);
    for (const s of [-1, 1]) this.add('trim', boxGeo(0.1, h, 0.1), mul(W, T(s * (w / 2 + 0.05), 0, 0.04)), trim);
    const c = new THREE.Vector3(0, h / 2, 0.3).applyMatrix4(W);
    this.pts.push([c.x, c.y, c.z, town, bright]);
  }
  sign(M, x, y, z, w, h, idx, ry = 0) { this.signs.push({ M: mul(M, T(x, y, z, ry)), w, h, idx }); }
  point(M, x, y, z, town, bright) { const v = new THREE.Vector3(x, y, z).applyMatrix4(M); this.pts.push([v.x, v.y, v.z, town, bright]); }
}

// ---------------------------------------------------------------- buildings
const WHITE = 0xf2eee6, TRIM = 0xf4f0e6;
// board-and-batten hall with a porch, mullioned windows, a cupola, a sign and a flagpole. Faces local +z.
export function hall(k, M, town, { w = 13, d = 22, h = 5.2, rise = 4.4, name = 0, roof = 0x6a2a22, bright = 1.2, hero = false } = {}) {
  k.box('conc', M, 0, -1.2, 0, w + 0.6, 2.0, d + 0.6, 0xb0aaa0);
  if (!hero) k.box('wood', M, 0, 0.8, 0, w, h, d, WHITE);
  else {                                   // the first hall is a real room: walls, a doorway, a ceiling (the scene furnishes it)
    const t = 0.16, dw = 1.2, dh = 2.7;
    k.box('wood', M, 0, 0.8, -d / 2 + t / 2, w, h, t, WHITE);
    for (const s of [-1, 1]) k.box('wood', M, s * (w / 2 - t / 2), 0.8, 0, t, h, d, WHITE);
    for (const s of [-1, 1]) k.box('wood', M, s * (dw + (w / 2 - dw) / 2), 0.8, d / 2 - t / 2, w / 2 - dw, h, t, WHITE);
    k.box('wood', M, 0, 0.8 + dh, d / 2 - t / 2, 2 * dw, h - dh, t, WHITE);
    k.box('wood2', M, 0, 0.8 + h - 0.12, 0, w, 0.12, d, 0xd8c8a8);
    k.box('wood', M, 0, 0.8, 0, w - 0.3, 0.03, d - 0.3, 0x8a6446);
  }
  k.gable(M, 0, 0.8 + h, 0, w, d, rise, 0.55, roof, 'wood', WHITE);
  k.box('trim', M, 0, 0.8 + h - 0.35, d / 2 + 0.05, w + 0.2, 0.35, 0.1, TRIM);        // frieze boards
  k.box('trim', M, 0, 0.8 + h - 0.35, -d / 2 - 0.05, w + 0.2, 0.35, 0.1, TRIM);
  for (const s of [-1, 1]) k.box('trim', M, s * (w / 2 + 0.05), 0.8, d / 2, 0.22, h, 0.22, TRIM);
  // porch: floor, steps, posts, a small gable canopy
  k.box('wood2', M, 0, 0.55, d / 2 + 1.6, 6.4, 0.25, 3.2, 0x8a7a66);
  for (let i = 0; i < 3; i++) k.box('conc', M, 0, 0.15 * i - 0.1, d / 2 + 3.4 + (2 - i) * 0.35, 3.2, 0.3, 0.4, 0xa8a298);
  for (const s of [-1, 1]) k.box('trim', M, s * 2.9, 0.8, d / 2 + 3.0, 0.2, 3.1, 0.2, TRIM);
  k.gable(mul(M, T(0, 0, d / 2 + 1.6)), 0, 3.9, 0, 6.6, 3.4, 1.4, 0.3, roof, 'wood', WHITE);
  // double doors (the hero hall's swing: built separately), a transom
  if (!hero) k.box('door', M, 0, 0.8, d / 2 + 0.03, 2.4, 2.7, 0.1, 0x5a2a1a);
  k.window(M, 0, 3.7, d / 2 + 0.02, 2.2, 0.7, 0, 1, town, bright * 1.2);
  // tall 12-light windows: two flank the door, four down each side
  for (const s of [-1, 1]) k.window(M, s * 3.9, 1.9, d / 2, 1.3, 2.4, 0, 2, town, bright);
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) k.window(M, s * w / 2, 1.9, -d / 2 + 3.5 + i * (d - 7) / 3, 1.3, 2.4, s * Math.PI / 2, 2, town, bright * (0.8 + 0.4 * ((i * 7 + s) % 3) / 2));
  // the sign on the gable, a lamp over the door, a brick chimney, a cupola on the ridge
  k.sign(M, 0, 0.8 + h + 0.6, d / 2 + 0.62, 7.2, 1.15, name);
  k.point(M, 0, 4.2, d / 2 + 1.0, town, bright * 1.5);
  k.box('brick', M, w / 4, 0.8 + h, -d / 2 + 1.6, 0.9, rise + 1.8, 0.9, 0xb0a098);
  k.box('wood', M, 0, 0.8 + h + rise - 0.2, -d / 6, 1.8, 1.9, 1.8, WHITE);
  k.gable(mul(M, T(0, 0, -d / 6)), 0, 0.8 + h + rise + 1.7, 0, 1.8, 1.8, 1.0, 0.2, roof, 'wood', WHITE);
  // flagpole beside the porch
  k.cyl('dark', M, w / 2 + 2.5, 0, d / 2 + 2, 0.05, 0.08, 11, 0xc8c8c8, 6);
  return { flagTop: new THREE.Vector3(w / 2 + 2.5, 11, d / 2 + 2).applyMatrix4(M), door: new THREE.Vector3(0, 2.0, d / 2 + 0.5).applyMatrix4(M) };
}
export function house(k, M, town, r, bright) {
  const w = 6.5 + r() * 2.5, d = 8 + r() * 3.5, two = r() < 0.45, h = two ? 5.6 : 3.1, rise = 2 + r() * 1.4;
  const cols = [0xf0ece2, 0xe8dcb8, 0xc9d3d6, 0xbcb8ae, 0x9c4a3a, 0xd8d0c0, 0x8f9a8a];
  const col = cols[Math.floor(r() * cols.length)], roof = [0x4a4642, 0x5a4a3c, 0x3c4048, 0x6a3a2c][Math.floor(r() * 4)];
  k.box('conc', M, 0, -1.2, 0, w + 0.3, 1.9, d + 0.3, 0x9a948a);
  k.box('clap', M, 0, 0.7, 0, w, h, d, col);
  k.gable(M, 0, 0.7 + h, 0, w, d, rise, 0.45, roof, 'clap', col);
  // porch across the front
  k.box('wood2', M, 0, 0.5, d / 2 + 1.1, w * 0.9, 0.2, 2.2, 0x7a6a58);
  for (const s of [-1, 0.33, 1]) k.box('trim', M, s * w * 0.42, 0.7, d / 2 + 2.0, 0.14, 2.5, 0.14, TRIM);
  k.box('roof', M, 0, 3.2, d / 2 + 1.2, w * 0.95, 0.12, 2.5, roof);
  k.box('door', M, -w * 0.18, 0.7, d / 2 + 0.03, 0.95, 2.1, 0.08, [0x5a2a1a, 0x1e2a3a, 0x3a3a2a][Math.floor(r() * 3)]);
  const lit = () => (r() < 0.7 ? bright * (0.4 + r() * 0.9) : 0.05);
  k.window(M, w * 0.2, 1.4, d / 2, 1.0, 1.5, 0, 0, town, lit());
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) k.window(M, s * w / 2, 1.4, -d / 4 + i * d / 2.2, 0.95, 1.45, s * Math.PI / 2, 0, town, lit());
  if (two) for (const s of [-1, 1]) k.window(M, s * w * 0.22, 4.1, d / 2, 0.9, 1.35, 0, 0, town, lit());
  k.box('brick', M, -w * 0.25, 0.7 + h, -d * 0.2, 0.6, rise + 0.9, 0.6, 0x9a5a48);
  return { w, d };
}
// two-storey brick commercial front with a corbelled cornice, a plate-glass storefront, an awning and a sign band
export function store(k, M, town, r, sign, bright) {
  const w = 7 + r() * 2.2, h = 7.5 + r() * 3, d = 18;
  const col = [0xffffff, 0xe8d8c8, 0xd0b8a8, 0xf0e0c8][Math.floor(r() * 4)];
  k.box('brick', M, 0, 0, 0, w, h, d, col);
  k.box('brick', M, 0, h, d / 2 - 0.2, w, 1.1, 0.4, col);                                  // parapet
  k.box('trim', M, 0, h + 0.75, d / 2 + 0.05, w + 0.3, 0.35, 0.55, 0x7a5a48);               // cornice
  for (let i = 0; i < Math.floor(w / 0.6); i++) k.box('trim', M, -w / 2 + 0.3 + i * 0.6, h + 0.45, d / 2 + 0.12, 0.25, 0.3, 0.22, 0x7a5a48);   // dentils
  k.box('trim', M, 0, 3.6, d / 2 + 0.06, w, 0.9, 0.12, 0x2a2420);                        // sign band
  k.sign(M, 0, 3.62, d / 2 + 0.14, w * 0.92, 0.82, sign);
  k.window(M, -w * 0.18, 0.55, d / 2, w * 0.52, 2.6, 0, 1, town, bright * (0.6 + r() * 0.8), 0x2a2420);
  k.box('door', M, w * 0.3, 0, d / 2 + 0.02, 1.1, 2.6, 0.08, 0x2a1c14);
  k.box('conc', M, 0, 0, d / 2 + 0.05, w, 0.55, 0.12, 0x9a8a7a);
  const aw = [0x8a1c1c, 0x1c4a2a, 0x2a3a5a, 0x7a6a3a][Math.floor(r() * 4)];
  k.add('roof', boxGeo(w, 0.08, 1.8), mul(M, T(0, 3.3, d / 2 + 0.9, 0, -0.35)), aw);
  const n = Math.max(2, Math.floor(w / 2.4));
  for (let i = 0; i < n; i++) k.window(M, -w / 2 + w * (i + 0.5) / n, 5.0, d / 2, 1.0, 1.7, 0, 0, town, r() < 0.5 ? bright * (0.3 + r()) : 0.04);
  return w;
}
// a co-op elevator: a row of slip-formed silos with a bin deck and a headhouse, a leg and spouts to the track
export function elevator(k, M, town, r, bright, big = false) {
  const n = big ? 8 + Math.floor(r() * 5) : 3 + Math.floor(r() * 4), R = 4.2, H = big ? 38 : 28 + r() * 6;
  for (let i = 0; i < n; i++) {
    k.cyl('conc', M, (i - (n - 1) / 2) * R * 2, 0, 0, R, R, H, 0xd8d2c6, 24);
    if (big) k.cyl('conc', M, (i - (n - 1) / 2) * R * 2, 0, R * 2, R, R, H, 0xd0cabe, 24);
  }
  const L = n * R * 2, dz = big ? R : 0;
  k.box('corr', M, 0, H, dz, L, 3.2, 4, 0xc8c4bc);                                               // bin deck gallery
  k.gable(M, 0, H + 3.2, dz, 4, L, 0.6, 0.2, 0x6a6a6a, 'corr', 0xc8c4bc);
  const hx = (L / 2) + 5;
  k.box('conc', M, hx, 0, dz, 10, H + 14, 10, 0xd4cec2);                                         // headhouse
  k.box('corr', M, hx, H + 14, dz, 8, 6, 8, 0xc0bcb4);
  k.gable(mul(M, T(hx, 0, dz)), 0, H + 20, 0, 8, 8, 2.2, 0.3, 0x6a6a6a, 'corr', 0xc0bcb4);
  k.sign(M, hx, H - 2, dz + 5.05, 9.4, 1.6, 2);
  k.sign(M, 0, H - 8, R + 0.2 + (big ? R * 2 : 0), Math.min(L * 0.8, 30), 3.2, 2);
  // leg casing and the spouts to the track side
  k.box('dark', M, hx - 5.6, 0, dz + 4, 0.9, H + 16, 0.9, 0x6a6660);
  for (let i = 0; i < 3; i++) k.add('dark', cylGeo(0.3, 0.3, 18, 6), mul(M, T(hx - 4, H + 8 - i * 3, dz + 4, 0, 0.7 + i * 0.12, 0)), 0x5a5650);
  // driveway shed with a truck scale office
  k.box('corr', M, hx + 11, 0, dz, 10, 7, 12, 0xb8b4ac);
  k.gable(mul(M, T(hx + 11, 0, dz)), 0, 7, 0, 10, 12, 1.2, 0.4, 0x5a5a5a, 'corr', 0xb8b4ac);
  k.window(M, hx + 16, 2, dz + 2, 1.2, 1.2, Math.PI / 2, 0, town, bright);
  // steel bins beside it
  const nb = 1 + Math.floor(r() * 3);
  for (let i = 0; i < nb; i++) { const bx = -L / 2 - 10 - i * 14; k.cyl('corr', M, bx, 0, dz, 6, 6, 9, 0xd0d0d4, 24); k.add('corr', new THREE.ConeGeometry(6.3, 2.8, 24, 1, true).translate(0, 10.4, 0), mul(M, T(bx, 0, dz)), 0xc8c8cc); k.cyl('dark', M, bx, 11.6, dz, 0.5, 0.8, 0.8, 0x888888, 8); }
  k.point(M, hx, H + 18, dz + 5, town, bright * 0.8);
  k.point(M, hx + 11, 6, dz + 6.5, town, bright);
  return { top: new THREE.Vector3(hx, H + 22, dz).applyMatrix4(M), L, M, n, R, H, dz };
}
export function waterTower(k, M, town, r) {
  const H = 26 + r() * 6;
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; k.add('dark', cylGeo(0.22, 0.3, H + 0.5, 6), mul(M, T(Math.cos(a) * 5.2, 0, Math.sin(a) * 5.2, 0, Math.sin(a) * -0.09, Math.cos(a) * 0.09)), 0xa8b0b4); }
  for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) {           // ring struts between neighbouring legs
    const y = 5 + j * 7.5, rr = 5.2 - y * 0.09 * 0.9, th = i * Math.PI / 2 + Math.PI / 2, cx = Math.cos(th) * rr * Math.SQRT1_2, cz = Math.sin(th) * rr * Math.SQRT1_2, L = rr * Math.SQRT2;
    k.add('dark', cylGeo(0.08, 0.08, L, 4).translate(0, -L / 2, 0), mul(M, T(cx, y, cz, -th + Math.PI / 2 * 0, 0, Math.PI / 2)).multiply(T(0, 0, 0, 0)), 0x9aa0a4);
  }
  k.cyl('dark', M, 0, 0, 0, 0.7, 0.7, H, 0xa8b0b4, 10);
  const tank = new THREE.SphereGeometry(6.4, 28, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); tank.translate(0, 0, 0);
  k.add('tank', tank, mul(M, T(0, H + 1, 0)), 0xdfe4e6);
  k.cyl('tank', M, 0, H + 1, 0, 6.4, 6.4, 4.2, 0xdfe4e6, 28, true);
  k.add('tank', new THREE.ConeGeometry(6.6, 2.4, 28, 1, true).translate(0, H + 6.4, 0), M, 0xcfd4d6);
  k.cyl('dark', M, 0, H + 5.1, 0, 6.5, 6.5, 0.12, 0x8a9094, 28, true);
  k.point(M, 0, H + 7.8, 0, town, 1.4);
  return H;
}
export function church(k, M, town, r, bright) {
  const w = 9, d = 17, h = 6;
  k.box('conc', M, 0, -1.2, 0, w + 0.4, 1.9, d + 0.4, 0xa8a298);
  k.box('clap', M, 0, 0.7, 0, w, h, d, 0xf4f2ec);
  k.gable(M, 0, 0.7 + h, 0, w, d, 4.2, 0.4, 0x3a3a3c, 'clap', 0xf4f2ec);
  k.box('clap', M, 0, 0.7, d / 2 + 1.5, 3.6, h + 5, 3.2, 0xf4f2ec);
  k.add('roof', new THREE.ConeGeometry(2.6, 9, 4).rotateY(Math.PI / 4).translate(0, h + 10.2, 0), mul(M, T(0, 0, d / 2 + 1.5)), 0x3a3a3c);
  k.box('door', M, 0, 0.7, d / 2 + 3.13, 1.6, 2.6, 0.08, 0x5a2a1a);
  k.window(M, 0, 6.8, d / 2 + 3.1, 1.2, 2.0, 0, 3, town, bright);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) k.window(M, s * w / 2, 2, -d / 3 + i * d / 3, 1.2, 3.2, s * Math.PI / 2, 3, town, bright * 0.8);
}
export function streetlight(k, M, x, z, ry, town) {
  k.cyl('dark', M, x, 0, z, 0.07, 0.11, 7.5, 0x4a4a4a, 6);
  k.add('dark', boxGeo(0.08, 0.08, 2.2), mul(M, T(x, 7.4, z + 1.1 * 0, ry, 0, 0)).multiply(T(0, 0, 1.1)), 0x4a4a4a);
  k.box('lamp', mul(M, T(x, 0, z, ry)), 0, 7.15, 2.1, 0.5, 0.25, 0.8, 0xffffff);
  k.point(mul(M, T(x, 0, z, ry)), 0, 7.0, 2.1, town, 1.6);
}

// ---------------------------------------------------------------- towns
// kinds: 'hero' (the first grange hall), 'rail' (elevator + main street), 'hamlet' (hall + church + a few houses), 'yard' (the rail town)
export function town(k, idx, cx, cz, kind, seed, opts = {}) {
  const r = rng(seed), cy = hgt(cx, cz), M = T(cx, cy, cz, opts.ry || 0), out = { idx, x: cx, z: cz, y: cy, kind };
  const bright = 0.7 + r() * 0.9;                                   // every town at its own brightness (§11.4 G3)
  out.bright = bright;
  if (kind === 'hero' || kind === 'rail' || kind === 'yard') {
    const zr = RAILZ - cz;                                          // rail runs along local x at local z = zr
    out.elev = elevator(k, mul(M, T(-10, 0, zr - 22)), idx, r, bright, kind === 'yard');
    if (kind === 'yard') { out.elev2 = elevator(k, mul(M, T(-150, 0, zr - 26, 0)), idx, r, bright, true); }
    // main street: south from the rail, storefronts both sides
    const signs = kind === 'hero' ? [4, 6, 3, 5, 7, 14, 8, 9] : [4, 5, 6, 7, 8, 9, 11, 13, 14, 15];
    let si = 0;
    for (const side of [-1, 1]) {
      let z = zr + 22;
      while (z < zr + 120) { const sg = signs[si++ % signs.length], SM = mul(M, T(side * 15, 0, z, side * -Math.PI / 2)); const w = store(k, SM, idx, r, sg, bright); (out.stores = out.stores || []).push({ sign: sg, door: new THREE.Vector3(w * 0.3, 1.2, 9.6).applyMatrix4(SM), front: new THREE.Vector3(0, 3, 9).applyMatrix4(SM) }); z += w + 0.1 + (r() < 0.15 ? 6 : 0); }
      for (let i = 0; i < 6; i++) streetlight(k, M, side * 9.5, zr + 25 + i * 18, side < 0 ? Math.PI / 2 : -Math.PI / 2, idx);
    }
    // houses on the side streets
    const nh = kind === 'hero' ? 34 : kind === 'yard' ? 40 : 16 + Math.floor(r() * 12);
    for (let i = 0; i < nh; i++) {
      const bx = (r() < 0.5 ? -1 : 1) * (48 + Math.floor(r() * 4) * 26), bz = zr + 20 + Math.floor(r() * 6) * 24 + (r() - 0.5) * 3;
      if (kind === 'hero' && bz > zr + 185) continue;
      house(k, mul(M, T(bx + (r() - 0.5) * 4, 0, bz, (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.06)), idx, r, bright);
    }
    out.towerH = waterTower(k, mul(M, T(70, 0, zr + 90)), idx, r);
    out.tower = new THREE.Vector3(70, 30, zr + 90).applyMatrix4(M); out.towerM = mul(M, T(70, 0, zr + 90));
    church(k, mul(M, T(-26, 0, zr + 150, Math.PI / 2)), idx, r, bright * 0.8);
    if (kind === 'hero') out.hall = hall(k, mul(M, T(45, 0, 200)), idx + 1, { name: 0, bright: 1.6, hero: true });
    else out.hall = hall(k, mul(M, T(-60, 0, zr + 175, Math.PI * 0.5)), idx, { name: r() < 0.5 ? 0 : 1, bright: bright * 1.3, roof: [0x6a2a22, 0x3a4a3a, 0x4a4a52][Math.floor(r() * 3)] });
    // v15: the town at its real size. A Midwest rail town is a grid of blocks most of a kilometre across, not a main
    // street and a handful of houses: residential blocks round the core on both sides of the rail, houses facing the
    // streets, a streetlight at every corner. From the air at night it reads as the grid of sodium lights it is.
    if (opts.grid) {
      const G = opts.grid, BK = G.block || 84, rg = rng(seed + 4049);
      const inCore = (x, z) => x > -165 && x < 165 && z > zr - 55 && z < zr + 215;
      let x0m = 1e9, x1m = -1e9, z0m = 1e9, z1m = -1e9;
      for (let bx = -G.w; bx < G.e; bx++) for (let bz = -G.n; bz < G.s; bz++) {
        const x0 = bx * BK + 6, z0 = bz < 0 ? zr - 40 + bz * BK : zr + 30 + bz * BK, x1 = x0 + BK - 12, z1 = z0 + BK - 12;
        if (inCore(x0, z0) || inCore(x1, z1) || inCore(x0, z1) || inCore(x1, z0)) continue;
        const edge = Math.max(Math.abs(bx + 0.5) / Math.max(G.w, G.e), bz < 0 ? Math.abs(bz) / Math.max(1, G.n) : bz / G.s);
        if (rg() < 0.25 * edge * edge) continue;                              // the town thins out at its edges
        streetlight(k, M, x0 - 6, z0 - 6, rg() < 0.5 ? 0 : Math.PI / 2, idx);
        if (rg() < 0.5) streetlight(k, M, x0 - 6 + BK / 2, z0 - 6, 0, idx);
        const lots = [[x0 + 14, z0 + 13, Math.PI], [x0 + BK / 2, z0 + 13, Math.PI], [x1 - 14, z0 + 13, Math.PI],
                      [x0 + 14, z1 - 13, 0], [x0 + BK / 2, z1 - 13, 0], [x1 - 14, z1 - 13, 0]];
        for (const [hx, hz, hr] of lots) { if (rg() < 0.22 + 0.35 * edge) continue;
          house(k, mul(M, T(hx + (rg() - 0.5) * 3, 0, hz, hr + (rg() - 0.5) * 0.05)), idx, rg, bright * (0.8 + 0.4 * rg())); }
        x0m = Math.min(x0m, x0 - 10); x1m = Math.max(x1m, x1 + 10); z0m = Math.min(z0m, z0 - 10); z1m = Math.max(z1m, z1 + 10);
      }
      if (x1m > x0m) { const a = new THREE.Vector3(x0m, 0, z0m).applyMatrix4(M), b = new THREE.Vector3(x1m, 0, z1m).applyMatrix4(M);
        out.gridRect = [Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z)]; }
    }
  } else if (kind === 'hamlet') {
    const ry = Math.floor(r() * 4) * Math.PI / 2;
    out.hall = hall(k, mul(M, T(12, 0, 14, ry)), idx, { name: r() < 0.55 ? 0 : 1, bright: bright * 1.3, roof: [0x6a2a22, 0x3a4a3a, 0x4a4a52, 0x5a3a2a][Math.floor(r() * 4)] });
    if (r() < 0.6) church(k, mul(M, T(-22, 0, 16, Math.PI / 2 * Math.floor(r() * 4))), idx, r, bright);
    const nh = 4 + Math.floor(r() * 7);
    for (let i = 0; i < nh; i++) house(k, mul(M, T((r() - 0.5) * 110, 0, -18 - r() * 50, Math.floor(r() * 4) * Math.PI / 2)), idx, r, bright);
    const nb = 2 + Math.floor(r() * 3);
    for (let i = 0; i < nb; i++) { const bx = 35 + i * 14, bz = -30; k.cyl('corr', M, bx, 0, bz, 5.5, 5.5, 8 + r() * 4, 0xd0d0d4, 24); k.add('corr', new THREE.ConeGeometry(5.8, 2.6, 24, 1, true).translate(0, 11.6, 0), mul(M, T(bx, 0, bz)), 0xc8c8cc); }
    for (let i = 0; i < 3; i++) streetlight(k, M, -8 + i * 22, 0, 0, idx);
  }
  return out;
}

// ---------------------------------------------------------------- the steel mill (OHIO)
export function mill(k, M, idx) {
  const out = {};
  // blast furnace: lathe profile hearth -> bosh -> stack -> throat
  const prof = [[0, 0], [7.5, 0], [7.5, 9], [9.2, 16], [8.6, 22], [6.0, 40], [4.4, 44], [4.4, 47], [0, 47]].map(([x, y]) => new THREE.Vector2(x, y));
  const bf = new THREE.LatheGeometry(prof, 28); { const uv = bf.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 12, uv.getY(i) * 12); }
  k.add('rust', bf, M, 0x6a5a50);
  for (let i = 0; i < 5; i++) k.cyl('rust', M, 0, 12 + i * 6.5, 0, 9.8 - Math.abs(i - 1) * 0.9, 9.8 - Math.abs(i - 1) * 0.9, 0.9, 0x3a3230, 28);   // mantle bands and platforms
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; k.add('rust', cylGeo(0.9, 0.9, 16, 10), mul(M, T(Math.cos(a) * 3.6, 46, Math.sin(a) * 3.6, 0, Math.sin(a) * 0.1, -Math.cos(a) * 0.1)), 0x5a4a44); }
  k.add('rust', cylGeo(1.4, 1.4, 44, 12), mul(M, T(0, 62, 0, 0, 0, 1.0)), 0x5a4a44);                    // downcomer to the dustcatcher
  k.cyl('rust', M, -38, 0, 0, 5, 5, 24, 0x5a4e48, 20); k.add('rust', new THREE.ConeGeometry(5, 6, 20).rotateX(Math.PI).translate(0, 5, 0), mul(M, T(-38, 0, 0)), 0x5a4e48);
  // skip incline truss
  k.add('dark', boxGeo(3, 2, 70), mul(M, T(0, 20, 38, 0, 0.62, 0)), 0x3a3634);
  // hot stoves with domes
  for (let i = 0; i < 3; i++) { const x = 22 + i * 13; k.cyl('rust', M, x, 0, -16, 5.4, 5.4, 36, 0x7a6a60, 24); k.add('rust', new THREE.SphereGeometry(5.4, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 36, 0), mul(M, T(x, 0, -16)), 0x7a6a60);
    k.add('rust', cylGeo(1.1, 1.1, 30, 10), mul(M, T(x, 30, -16, 0, 0, Math.PI / 2)).multiply(T(0, -15, 0)), 0x5a4a44); }
  // cast house: a long corrugated shed with a monitor roof, glowing along its base
  k.box('corr', M, 0, 0, -38, 60, 16, 26, 0x6a5a50);
  k.gable(mul(M, T(0, 0, -38)), 0, 16, 0, 26, 60, 4, 0.8, 0x3a3230, 'corr', 0x6a5a50);
  k.box('corr', M, 0, 21, -38, 6, 3, 58, 0x5a4a44);
  k.sign(M, -8, 9.5, -24.85, 22, 4.2, 12);                                                        // OHIO, painted on the cast house (the place name lives in the world, never a caption)
  for (let i = 0; i < 8; i++) k.box('glow', M, -26 + i * 7.4, 0.5, -24.8, 4.2, 3 + (i % 3), 0.2, 0xffffff);
  k.box('glow', M, 0, 0.2, 10, 7, 0.6, 30, 0xffffff);                                                    // the runner, iron flowing to the ladle track
  // BOF shop and four stacks
  k.box('corr', M, 90, 0, -30, 70, 42, 44, 0x5c5048);
  k.gable(mul(M, T(90, 0, -30)), 0, 42, 0, 44, 70, 5, 0.8, 0x2e2826, 'corr', 0x5c5048, 'corr');
  for (let i = 0; i < 6; i++) k.box('glow', M, 60 + i * 12, 2, -7.9, 5, 9, 0.2, 0xffffff);
  out.stacks = [];
  for (let i = 0; i < 4; i++) { const x = 60 + i * 20, h = 72 + (i % 2) * 10; k.cyl('brick', M, x, 0, -70, 2.0, 3.4, h, 0x8a4a3a, 16);
    k.cyl('glow', M, x, h - 0.2, -70, 2.05, 2.05, 0.6, 0xffffff, 16, true); for (let j = 1; j < 5; j++) k.cyl('dark', M, x, h * j / 5, -70, 3.5 - j * 0.3, 3.5 - j * 0.3, 0.5, 0x2a2220, 16, true);
    out.stacks.push(new THREE.Vector3(x, h, -70).applyMatrix4(M)); }
  // conveyors, a gas holder, pipe racks
  k.add('dark', boxGeo(2.5, 2.5, 120), mul(M, T(-80, 18, -40, 0.4, 0.22, 0)), 0x3a3634);
  k.cyl('rust', M, -90, 0, 40, 18, 18, 30, 0x5a5250, 32);
  for (let i = 0; i < 20; i++) { k.box('dark', M, -60 + i * 8, 0, 30, 0.5, 9, 0.5, 0x3a3634); }
  k.add('rust', cylGeo(0.8, 0.8, 160, 8), mul(M, T(-60, 9, 30, 0, 0, Math.PI / 2)).multiply(T(0, -160, 0)), 0x6a5a50);
  for (let i = 0; i < 40; i++) k.point(M, -60 + (i % 20) * 9, 4 + Math.floor(i / 20) * 20, -26 + (i % 3) * 3, idx, 1.8);
  out.cast = new THREE.Vector3(0, 3, -22).applyMatrix4(M);
  out.furnace = new THREE.Vector3(0, 30, 0).applyMatrix4(M);
  return out;
}

// ---------------------------------------------------------------- rail: two tracks, ties, a stopped grain train on the siding
export function rail(k, x0, x1) {
  const ties = [];
  for (const [z, from, to] of [[RAILZ, x0, x1], [RAILZ + 5, -700, 900]]) {
    const len = to - from, M = T((from + to) / 2, 0, z);
    for (const s of [-0.72, 0.72]) k.box('steel', M, 0, 0.35, s, len, 0.16, 0.08, 0x8a7e76, Math.PI / 2 * 0);
    for (let x = from; x < to; x += 0.62) ties.push([x, z]);
  }
  return ties;
}
// covered hoppers: body with sloped bays, ribs, roofwalk, trucks
export function hopper(k, M, r) {
  const L = 17.5, col = [0xc8c0b0, 0x8a4a38, 0x6a7a8a, 0xb8a060, 0x7a2a22][Math.floor(r() * 5)];
  k.box('steel', M, 0, 1.6, 0, 3.1, 2.4, L - 2, col);
  k.add('steel', new THREE.CylinderGeometry(1.55, 1.55, L - 2, 16, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(-Math.PI / 2).translate(0, 4.0, 0), M, col);
  for (let i = 0; i < 3; i++) k.add('steel', new THREE.ConeGeometry(1.4, 1.5, 4).rotateY(Math.PI / 4).rotateX(Math.PI).translate(0, 1.0, -L / 3 + i * L / 3), M, col);
  for (let i = 0; i < 12; i++) for (const s of [-1, 1]) k.box('steel', M, s * 1.58, 1.6, -L / 2 + 1.5 + i * (L - 3) / 11, 0.06, 3.9, 0.12, col);
  k.box('dark', M, 0, 5.55, 0, 0.6, 0.05, L - 2, 0x3a3a3a);
  for (const zz of [-L / 2 + 2.4, L / 2 - 2.4]) {
    k.box('dark', M, 0, 0.45, zz, 2.6, 0.5, 2.6, 0x2a2828);
    for (const s of [-1, 1]) for (const dz of [-0.9, 0.9]) k.add('dark', cylGeo(0.46, 0.46, 0.15, 12).rotateZ(Math.PI / 2), mul(M, T(s * 0.72, 0.46, zz + dz)), 0x2a2626);
  }
  k.box('dark', M, 0, 0.8, L / 2 - 0.4, 0.5, 0.4, 1.2, 0x2a2828);
}

// ---------------------------------------------------------------- build meshes from a kit
export function meshes(k, mats) {
  const out = [];
  for (const [key, geos] of k.parts) {
    const g = mergeGeometries(geos, false); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mats[key] || mats.default); m.castShadow = key !== 'glow' && key !== 'lamp'; m.receiveShadow = true; out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------- the network: an MST over the towns plus 20% loops, routed along the grid
export function network(towns, r) {
  const n = towns.length, inT = new Array(n).fill(false), edges = [], best = new Array(n).fill(Infinity), from = new Array(n).fill(-1);
  const D = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
  best[0] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1; for (let i = 0; i < n; i++) if (!inT[i] && (u < 0 || best[i] < best[u])) u = i;
    inT[u] = true; if (from[u] >= 0) edges.push([from[u], u]);
    for (let v = 0; v < n; v++) if (!inT[v] && D(towns[u], towns[v]) < best[v]) { best[v] = D(towns[u], towns[v]); from[v] = u; }
  }
  const cand = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (!edges.some(e => (e[0] === i && e[1] === j) || (e[0] === j && e[1] === i))) cand.push([D(towns[i], towns[j]), i, j]);
  cand.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < Math.floor(edges.length * 0.2); i++) edges.push([cand[i][1], cand[i][2]]);
  return edges;
}

// ---------------------------------------------------------------- the mark: contour polylines + fill points from the ACP logo alpha
export function markShape(img) {
  // the gear, hammer and sickle and the FOUR stripes: the top part of the ACP logo (without the lettering). The crop
  // stops at 0.62 of the logo (the fourth stripe ends at 0.6, the letters start at 0.64) and the canvas is tall enough
  // to hold all of it: the old 190 px canvas cut the fourth stripe off and drew a three-stripe mark.
  const sh = img.height * 0.62, w = 360, h = Math.ceil(sh * w / img.width) + 2;
  const [c, g] = cv(w, h);
  g.drawImage(img, 0, 0, img.width, sh, 0, 0, w, sh * w / img.width);
  const d = g.getImageData(0, 0, w, h).data, A = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : d[(y * w + x) * 4 + 3] > 120 ? 1 : 0;
  let minx = w, maxx = 0, miny = h, maxy = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (A(x, y)) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  const bw = maxx - minx + 1, bh = maxy - miny + 1;
  // boundary edge segments (pixel edges between inside and outside), chained into loops
  const segs = [];
  for (let y = miny - 1; y <= maxy + 1; y++) for (let x = minx - 1; x <= maxx + 1; x++) {
    const a = A(x, y);
    if (a !== A(x + 1, y)) segs.push([[x + 1, y], [x + 1, y + 1]]);
    if (a !== A(x, y + 1)) segs.push([[x, y + 1], [x + 1, y + 1]]);
  }
  const key = p => p[0] + ',' + p[1], adj = new Map();
  segs.forEach((s, i) => { for (const p of s) { const kk = key(p); if (!adj.has(kk)) adj.set(kk, []); adj.get(kk).push(i); } });
  const used = new Array(segs.length).fill(false), loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const loop = [segs[i][0]]; let cur = segs[i][1], si = i; used[i] = true;
    while (true) {
      loop.push(cur);
      const nx = (adj.get(key(cur)) || []).find(j => !used[j]);
      if (nx == null) break;
      used[nx] = true; const s = segs[nx]; cur = key(s[0]) === key(cur) ? s[1] : s[0]; si = nx;
    }
    if (loop.length > 12) loops.push(loop);
  }
  // smooth each loop (chaikin-ish average) and map to unit coords centred, y down -> z
  const sc = 1 / bw, polys = loops.map(L => {
    const P = L.map(p => [(p[0] - minx - bw / 2) * sc, (p[1] - miny - bh / 2) * sc]);
    for (let it = 0; it < 3; it++) for (let i = 0; i < P.length; i++) { const a = P[(i - 1 + P.length) % P.length], b = P[(i + 1) % P.length]; P[i] = [(a[0] + 2 * P[i][0] + b[0]) / 4, (a[1] + 2 * P[i][1] + b[1]) / 4]; }
    const Q = []; for (let i = 0; i < P.length; i += 2) Q.push(P[i]); return Q;
  });
  const inside = (u, v) => A(Math.round(u / sc + minx + bw / 2), Math.round(v / sc + miny + bh / 2)) === 1;
  return { polys, inside, aspect: bh / bw };
}

// ================================================================ the build: the plants the column raises (v9)
// Industry is raised by the people who walked to the hall: the first steel bent goes up beside it on IT CALLS,
// and every town the network reaches raises its own plant, each at its own size (§11.4 G3: never levelled).
const PRIMER = 0xa8402a;                               // red-oxide primer on the new steel
// an I-section member along local +y, length L, depth d (web along local z), flange width b
function ibeam(L, d = 0.4, b = 0.24, tf = 0.03, tw = 0.018) {
  const web = new THREE.BoxGeometry(tw, L, d - 2 * tf).translate(0, L / 2, 0);
  const f1 = new THREE.BoxGeometry(b, L, tf).translate(0, L / 2, d / 2 - tf / 2), f2 = f1.clone().translate(0, 0, -(d - tf));
  return mergeGeometries([web, f1, f2].map(g => g.toNonIndexed()), false);
}
// one portal-frame bent in its own group: two columns and a pitched rafter (span along x, plane x-y), base at y=0
export function bentGeo(span = 12, hCol = 7.6, rise = 1.3) {
  const parts = [];
  for (const s of [-1, 1]) parts.push(ibeam(hCol, 0.46, 0.26).rotateY(Math.PI / 2).translate(s * span / 2, 0, 0));
  const half = span / 2 + 0.25, len = Math.hypot(half, rise), ang = Math.atan2(rise, half);
  for (const s of [-1, 1]) { const g = ibeam(len, 0.42, 0.24); g.rotateZ(s * (Math.PI / 2 - ang)); g.translate(s * (span / 2 + 0.2), hCol - 0.25, 0); parts.push(g); }   // rafters rise inward to the ridge
  for (const s of [-1, 1]) { const g = ibeam(1.6, 0.26, 0.16); g.rotateZ(s * Math.PI / 4); g.translate(s * (span / 2 - 0.05), hCol - 1.3, 0); parts.push(g); }   // knee braces
  for (const s of [-1, 1]) parts.push(new THREE.BoxGeometry(0.7, 0.04, 0.7).translate(s * span / 2, 0.02, 0).toNonIndexed());                                // base plates
  return mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g), false);
}
// Plant No. 1, beside the first hall: five bents on a slab (the first raised by hand on 30-31), purlins,
// part-clad back wall, bare bulbs on cords, a welding cobot and a plant-floor terminal.
export function plantNo1(mats, origin, { span = 12, bays = 4, bay = 6 } = {}) {
  const root = new THREE.Group(); root.position.copy(origin);
  const plain = m => { const c = m.clone(); c.vertexColors = false; return c; };      // kit materials read vertex colours; these meshes have none
  mats = { conc: plain(mats.conc), corr: plain(mats.corr) };
  const steel = new THREE.MeshStandardMaterial({ color: PRIMER, roughness: 0.55, metalness: 0.35 });
  const galv = new THREE.MeshStandardMaterial({ color: 0x9a9ca0, roughness: 0.45, metalness: 0.6 });
  const bg = bentGeo(span);
  const bents = [];
  for (let i = 0; i <= bays; i++) {                   // bent 0 is the one raised by hand (front, +z edge); its hinge is its base line
    const piv = new THREE.Group(); piv.position.set(0, 0, -i * bay); root.add(piv);
    const m = new THREE.Mesh(bg, steel); m.castShadow = m.receiveShadow = true; piv.add(m); bents.push(piv);
  }
  const slab = new THREE.Mesh(new THREE.BoxGeometry(span + 3, 0.25, bays * bay + 3).translate(0, 0.02, -bays * bay / 2), mats.conc); slab.receiveShadow = true; root.add(slab);
  // purlins (appear once the bents behind the first are up)
  const pur = [], pg = new THREE.BoxGeometry(0.12, 0.2, bays * bay).translate(0, 0, -bays * bay / 2);
  for (let k = 0; k < 7; k++) { const u = k / 6, x = (u - 0.5) * span, y = 7.6 + 1.3 * (1 - Math.abs(u - 0.5) * 2) + 0.15; const m = new THREE.Mesh(pg, galv); m.position.set(x, y, 0); m.castShadow = true; root.add(m); pur.push(m); }
  // back wall and one side clad in corrugated sheet; the front bay open to the hall and the road
  const clad = [];
  { const bw = new THREE.Mesh(new THREE.BoxGeometry(span, 7.4, 0.06).translate(0, 3.7, -bays * bay - 0.2), mats.corr); bw.receiveShadow = bw.castShadow = true; root.add(bw); clad.push(bw);
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.06, 7.4, bays * bay - bay).translate(span / 2 + 0.2, 3.7, -bays * bay / 2 - bay / 2), mats.corr); sw.receiveShadow = sw.castShadow = true; root.add(sw); clad.push(sw); }
  // bare bulbs on cords, hanging from the purlins
  const bulbs = [], bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.72, 0.38).multiplyScalar(9) });
  const cordMat = new THREE.MeshBasicMaterial({ color: 0x141010 });
  for (let i = 0; i < bays; i++) for (const x of [-3, 3]) {
    const g = new THREE.Group(); g.position.set(x, 0, -i * bay - bay / 2);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 3.4, 4).translate(0, 8.4 - 1.7, 0), cordMat); g.add(cord);
    const sh = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.16, 12, 1, true).translate(0, 5.05, 0), new THREE.MeshStandardMaterial({ color: 0x2a3a2a, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.4 })); g.add(sh);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8).translate(0, 4.93, 0), bulbMat); g.add(b);
    root.add(g); bulbs.push(g);
  }
  return { root, bents, purlins: pur, clad, bulbs, bulbMat, span, bays, bay, steel };
}
// a welding cobot on a pedestal: yaw, shoulder, elbow, wrist, with a torch; reach(target) solves the two-link IK.
export function cobot(paint = 0xb3261c) {
  const P = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.35, metalness: 0.15 });
  const D = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.5, metalness: 0.5 });
  const Wt = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.4, metalness: 0.2 });
  const c = (rt, rb, h, m, seg = 20) => { const x = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); x.castShadow = x.receiveShadow = true; return x; };
  const root = new THREE.Group();
  const ped = c(0.28, 0.34, 0.8, D); ped.position.y = 0.4; root.add(ped);
  const yaw = new THREE.Group(); yaw.position.y = 0.8; root.add(yaw);
  const turret = c(0.2, 0.24, 0.3, P); turret.position.y = 0.15; yaw.add(turret);
  const sh = new THREE.Group(); sh.position.y = 0.38; yaw.add(sh);
  const shJ = c(0.15, 0.15, 0.34, D); shJ.rotation.z = Math.PI / 2; sh.add(shJ);
  const L1 = 0.95, L2 = 0.85;
  const up = c(0.11, 0.13, L1, P); up.position.y = L1 / 2; sh.add(up);
  const cap = c(0.135, 0.135, 0.06, Wt); cap.rotation.z = Math.PI / 2; cap.position.x = 0.18; sh.add(cap);
  const el = new THREE.Group(); el.position.y = L1; sh.add(el);
  const elJ = c(0.12, 0.12, 0.3, D); elJ.rotation.z = Math.PI / 2; el.add(elJ);
  const fo = c(0.08, 0.1, L2, P); fo.position.y = L2 / 2; el.add(fo);
  const wr = new THREE.Group(); wr.position.y = L2; el.add(wr);
  const wrJ = c(0.075, 0.075, 0.2, D); wrJ.rotation.z = Math.PI / 2; wr.add(wrJ);
  const flange = c(0.06, 0.06, 0.12, Wt); flange.position.y = 0.08; wr.add(flange);
  // the torch: a gooseneck ending at the tip; and the guide handle (where a gloved hand goes)
  const neck = c(0.025, 0.03, 0.34, D, 10); neck.position.set(0, 0.26, 0.06); neck.rotation.x = 0.45; wr.add(neck);
  const tip = new THREE.Object3D(); tip.position.set(0, 0.42, 0.14); wr.add(tip);
  const Y = new THREE.MeshStandardMaterial({ color: 0xe8b020, roughness: 0.45 }), Cu = new THREE.MeshStandardMaterial({ color: 0xc87a3a, roughness: 0.3, metalness: 0.9 });
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.02, 8, 18, Math.PI), Y); handle.position.set(0.12, 0.1, 0); handle.rotation.set(0, Math.PI / 2, Math.PI / 2); wr.add(handle);
  const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 12).rotateX(Math.PI), Cu); nozzle.position.set(0, 0.39, 0.125); nozzle.rotation.x = 0.45; wr.add(nozzle);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.077, 0.008, 6, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.7, 1).multiplyScalar(3) })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.02; wr.add(ring);
  for (const [g, x, r] of [[sh, 0.18, 0.15], [el, 0.155, 0.12], [wr, 0.105, 0.075]]) for (const s of [-1, 1]) { const cp = c(r * 0.92, r * 0.92, 0.035, Wt); cp.rotation.z = Math.PI / 2; cp.position.x = s * x; g.add(cp); }
  const hose2 = c(0.02, 0.02, 0.9, D, 6); hose2.position.set(-0.13, 0.5, -0.05); hose2.rotation.z = -0.08; sh.add(hose2);
  const grip = new THREE.Object3D(); grip.position.set(0.16, 0.1, 0); wr.add(grip);
  const hose = c(0.018, 0.018, 1.2, D, 6); hose.position.set(-0.14, -0.2, 0); hose.rotation.z = 0.3; el.add(hose);
  // reach: put the torch tip at `target` (world), with the torch pointing down at the work
  const _t = new THREE.Vector3();
  function reach(target) {
    root.updateMatrixWorld(true);
    const lt = root.worldToLocal(_t.copy(target)); lt.y -= 0.8 + 0.38;
    yaw.rotation.y = Math.atan2(lt.x, lt.z);
    const r = Math.hypot(lt.x, lt.z) - 0.16, y = lt.y + 0.42, d = Math.min(Math.hypot(r, y), L1 + L2 - 1e-3);
    const a2 = Math.acos(THREE.MathUtils.clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1));
    const a1 = Math.atan2(r, y) - Math.atan2(L2 * Math.sin(a2), L1 + L2 * Math.cos(a2));
    sh.rotation.x = a1; el.rotation.x = a2; wr.rotation.x = Math.PI - a1 - a2;    // wrist: torch points straight down
    root.updateMatrixWorld(true);
  }
  return { root, reach, tip, grip, paint: P };
}
// a rugged plant-floor terminal on a post; the screen is a canvas the scene redraws (the plant drawn live)
export function terminal() {
  const root = new THREE.Group();
  const D = new THREE.MeshStandardMaterial({ color: 0x2c2e30, roughness: 0.6, metalness: 0.4 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 1.1, 10).translate(0, 0.55, 0), D); post.castShadow = true; root.add(post);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.5).translate(0, 0.02, 0), D); root.add(foot);
  const head = new THREE.Group(); head.position.y = 1.18; head.rotation.x = -0.45; root.add(head);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.44, 0.09), D); box.castShadow = true; head.add(box);
  for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.12), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 })); b.position.x = s * 0.33; head.add(b); }
  const [c, g] = cv(512, 352);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.37), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1, 1, 1).multiplyScalar(1.6) }));
  screen.position.z = 0.047; head.add(screen);
  // the live drawing: the plant's bents and the weld path in the network's warm line, a grid, a progress bar
  function draw(u) {
    g.fillStyle = '#0c0a0e'; g.fillRect(0, 0, 512, 352);
    g.strokeStyle = 'rgba(255,160,80,0.12)'; g.lineWidth = 1;
    for (let x = 0; x < 512; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 352); g.stroke(); }
    for (let y = 0; y < 352; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
    const P = (x, y, z) => [256 + (x - z * 0.55) * 30, 250 - y * 20 + z * 7];
    g.lineWidth = 2.2; g.shadowColor = '#ff8a3c'; g.shadowBlur = 8;
    for (let i = 0; i < 5; i++) {
      const z = i * 1.2, on = u * 6 > i;
      g.strokeStyle = on ? '#ffb070' : 'rgba(255,140,70,0.35)';
      const a = P(-3, 0, z), b = P(-3, 7.6, z), cc = P(0, 8.9, z), d = P(3, 7.6, z), e = P(3, 0, z);
      g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.lineTo(...cc); g.lineTo(...d); g.lineTo(...e); g.stroke();
    }
    g.strokeStyle = '#ff4a24'; g.lineWidth = 3; g.beginPath();
    const w0 = P(-3, 7.6, 0), w1 = P(3, 7.6, 0); g.moveTo(...w0); g.lineTo(w0[0] + (w1[0] - w0[0]) * u, w0[1] + (w1[1] - w0[1]) * u); g.stroke();
    g.shadowBlur = 0; g.fillStyle = 'rgba(255,150,80,0.25)'; g.fillRect(24, 318, 464, 10); g.fillStyle = '#ff9a50'; g.fillRect(24, 318, 464 * u, 10);
    t.needsUpdate = true;
  }
  draw(0);
  return { root, head, screen, draw };
}
// the roadside plants: one per lit town (not the first town: it has Plant No. 1), unequal, beside the town, and big
// enough to read from 1-3 km up: a sawtooth roof whose north lights glow, lit bay doors, a stack with a warning light.
export function plantSites(lightTowns, skip, r) {
  const out = [];
  for (const t of lightTowns) {
    if (skip.includes(t)) continue;
    const big = t.kind === 'rail' || t.kind === 'yard' || t.kind === 'mill';
    const L = (big ? 260 : 150) + r() * r() * (big ? 280 : 150), Wd = L * (0.38 + r() * 0.25), Hh = 13 + r() * (big ? 14 : 7);
    for (let tries = 0; tries < 32; tries++) {
      const ang = r() * Math.PI * 2, d = L * 0.55 + (big ? 190 : 120) + (t.gridRect ? 300 : 0) + r() * 60;   // v15: past the town's real-size grid
      const x = t.x + Math.cos(ang) * d, z = t.z + Math.sin(ang) * d;
      if (Math.abs(z - RAILZ) < 40 + Wd) continue;
      if (Math.abs(x - MARK.x) < 900 + L * 0.5 && Math.abs(z - MARK.z) < 620 + L * 0.5) continue;
      if (lightTowns.some(o => Math.hypot(o.x - x, o.z - z) < L * 0.5 + 110)) continue;
      if (lightTowns.some(o => o.gridRect && x > o.gridRect[0] - L * 0.55 && x < o.gridRect[2] + L * 0.55 && z > o.gridRect[1] - Wd && z < o.gridRect[3] + Wd)) continue;
      if (out.some(o => Math.hypot(o.x - x, o.z - z) < (o.L + L) * 0.55)) continue;
      out.push({ town: t, x, z, y: hgt(x, z), L, W: Wd, H: Hh, big, ry: r() < 0.5 ? 0 : Math.PI / 2, stack: big || r() < 0.55, ign: (t.ign ?? 40) + 0.3 + r() * 0.3 });
      break;
    }
  }
  return out;
}
// the plants as instanced meshes: the frame rises on its town's call, then it is clad and its north lights and bays light
export function plantMesh(sites, uniforms) {
  const P = [], PT = [];
  const quad = (a, b, c, d, part) => { for (const v of [a, b, c, a, c, d]) { P.push(...v); PT.push(part); } };
  // body (part 0): four walls
  quad([-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5], 0); quad([0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [0.5, 1, -0.5], 0);
  quad([0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], 0); quad([-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0.5], [-0.5, 1, -0.5], 0);
  // sawtooth roof: glazing (part 1) faces -x, the slopes (part 2)
  const NT = 7, th = 0.16;
  for (let i = 0; i < NT; i++) { const x0 = -0.5 + i / NT, x1 = x0 + 1 / NT;
    quad([x0, 1, -0.5], [x0, 1, 0.5], [x0, 1 + th, 0.5], [x0, 1 + th, -0.5], 1);
    quad([x0, 1 + th, 0.5], [x1, 1, 0.5], [x1, 1, -0.5], [x0, 1 + th, -0.5], 2);
    for (const z of [0.5, -0.5]) { const tri = z > 0 ? [[x0, 1, z], [x1, 1, z], [x0, 1 + th, z]] : [[x1, 1, z], [x0, 1, z], [x0, 1 + th, z]]; for (const v of tri) { P.push(...v); PT.push(2); } } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('aPart', new THREE.Float32BufferAttribute(PT, 1)); g.computeVertexNormals();
  const n = sites.length, ign = new Float32Array(n), size = new Float32Array(n * 3);
  const mat = new THREE.MeshStandardMaterial({ color: 0x7a6e66, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aIgn, aPart; attribute vec3 aSize; uniform float uBeat; varying vec3 vLoc; varying vec3 vSz; varying float vIgn, vPart;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position; vSz = aSize; vIgn = aIgn; vPart = aPart; float rise = smoothstep(aIgn, aIgn + 0.71, uBeat); transformed.y *= max(rise, 0.001);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uBeat, uT, uLitK; varying vec3 vLoc; varying vec3 vSz; varying float vIgn, vPart;\nfloat ph1(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }')
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        vec3 m = (vLoc + vec3(0.5, 0.0, 0.5)) * vSz;            // metres from the corner
        float clad = smoothstep(vIgn + 1.0, vIgn + 2.2, uBeat);
        float lit = smoothstep(vIgn + 1.4, vIgn + 2.4, uBeat) * uLitK;
        float fw = 1.2;
        float bx = abs(fract(m.x / 8.0 + 0.5) - 0.5) * 8.0, bz = abs(fract(m.z / 8.0 + 0.5) - 0.5) * 8.0;
        float frame = max(max(step(bx, fw * 0.5), step(bz, fw * 0.5)), max(step(vSz.y - fw, m.y), step(m.y, fw * 0.4)));
        vec3 em = vec3(0.0);
        if (vPart < 0.5) {
          if (frame < 0.5 && m.y > clad * (vSz.y + 3.0)) discard;
          diffuseColor.rgb = mix(vec3(0.34, 0.1, 0.06), diffuseColor.rgb * (0.85 + 0.15 * step(0.5, fract(m.x * 1.3))), step(frame, 0.5));
          float bay = step(0.5, fract(m.x / 24.0 + m.z / 24.0 + 0.3)) * smoothstep(0.5, 0.2, abs(fract((m.x + m.z) / 12.0) - 0.5) * 2.0);
          float door = bay * step(m.y, 6.5);                    // the bay doors open onto the lit floor
          float band = smoothstep(7.5, 8.0, m.y) * (1.0 - smoothstep(9.0, 9.4, m.y)) * step(0.5, fract(m.x / 3.0 + m.z / 3.0));
          em = vec3(1.0, 0.58, 0.24) * (door * 6.0 + band * 3.0) * lit * clad;
        } else {
          if (clad < 0.5 && frame < 0.5) discard;
          if (vPart < 1.5) {                                    // north lights: long glowing strips, a weld flicker in some cells
            float cell = ph1(floor(vec2(m.z / 6.0, vLoc.x * 7.0)) + floor(uT * 9.0) * 0.37);
            em = vec3(1.0, 0.72, 0.4) * 11.0 * lit + vec3(0.7, 0.8, 1.0) * 18.0 * step(0.94, cell) * lit;
            diffuseColor.rgb = vec3(0.2, 0.18, 0.16);
          } else {                                              // the slopes: sheet, with a long skylight strip down each
            diffuseColor.rgb = vec3(0.3, 0.29, 0.28) * (0.85 + 0.15 * step(0.5, fract(m.z * 1.1)));
            float tooth = fract((vLoc.x + 0.5) * 7.0), strip = step(0.25, tooth) * step(tooth, 0.5) * step(0.06, fract(m.z / 9.0));
            em = vec3(1.0, 0.66, 0.34) * 9.0 * strip * lit;
          }
        }
        float weld = (1.0 - clad) * smoothstep(vIgn + 0.3, vIgn + 0.8, uBeat) * frame * step(0.7, ph1(floor(m.xz / 8.0) + floor(uT * 12.0)));
        em += vec3(1.0, 0.8, 0.6) * weld * 12.0;
      `)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += em;');
  };
  const mesh = new THREE.InstancedMesh(g, mat, n);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  sites.forEach((s, i) => {
    M.compose(new THREE.Vector3(s.x, s.y - 0.3, s.z), q.setFromAxisAngle(Y, s.ry), new THREE.Vector3(s.L, s.H, s.W));
    mesh.setMatrixAt(i, M); ign[i] = s.ign; size.set([s.L, s.H, s.W], i * 3);
  });
  g.setAttribute('aIgn', new THREE.InstancedBufferAttribute(ign, 1)); g.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 3));
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  // stacks: a brick chimney at one end of the plant, a red warning light and a lit plume base on top
  const ss = sites.filter(s => s.stack), sg = new THREE.CylinderGeometry(0.75, 1, 1, 12).translate(0, 0.5, 0);
  const sIgn = new Float32Array(ss.length);
  const smat = new THREE.MeshStandardMaterial({ color: 0x6a4a3e, roughness: 0.85 });
  smat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aIgn; uniform float uBeat; varying float vY; varying float vIgn;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvY = position.y; vIgn = aIgn; transformed.y *= max(smoothstep(aIgn + 0.4, aIgn + 1.4, uBeat), 0.001);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uBeat, uT, uLitK; varying float vY; varying float vIgn;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nfloat lt = smoothstep(vIgn + 1.4, vIgn + 2.2, uBeat) * uLitK; totalEmissiveRadiance += (vec3(1.0, 0.1, 0.05) * 30.0 * step(0.965, vY) * (0.6 + 0.4 * step(0.0, sin(uT * 6.0 + vIgn * 9.0))) + vec3(1.0, 0.5, 0.2) * 5.0 * smoothstep(0.9, 1.0, vY) * step(vY, 0.965)) * lt;');
  };
  const stacks = new THREE.InstancedMesh(sg, smat, Math.max(1, ss.length));
  ss.forEach((s, i) => { const off = new THREE.Vector3(s.L * 0.42, 0, s.W * 0.7).applyAxisAngle(Y, s.ry), r = 2.2 + s.H * 0.06;
    M.compose(new THREE.Vector3(s.x + off.x, s.y - 0.3, s.z + off.z), q.identity(), new THREE.Vector3(r, s.H * 2.6, r)); stacks.setMatrixAt(i, M); sIgn[i] = s.ign; });
  stacks.count = ss.length; sg.setAttribute('aIgn', new THREE.InstancedBufferAttribute(sIgn, 1)); stacks.castShadow = true; stacks.frustumCulled = false;
  const grp = new THREE.Group(); grp.add(mesh, stacks); return grp;
}
// the banner: red cloth with the ACP hammer and sickle in cream, a sewn hem and a fringe line
export function bannerTexture(markImg) {
  const [c, g] = cv(1024, 512), r = rng(5);
  g.fillStyle = '#a3121a'; g.fillRect(0, 0, 1024, 512);
  for (let y = 0; y < 512; y += 2) { g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.05})`; g.fillRect(0, y, 1024, 1); }
  for (let x = 0; x < 1024; x += 2) { g.fillStyle = `rgba(255,255,255,${r() * 0.035})`; g.fillRect(x, 0, 1, 512); }
  blotches(g, 1024, 512, r, 30, 'rgba(60,0,0,0.12)', 30, 120);
  const s = 330, w = markImg.width * s / markImg.height;
  const [mc, mg] = cv(markImg.width, markImg.height); mg.drawImage(markImg, 0, 0); mg.globalCompositeOperation = 'source-in'; mg.fillStyle = '#f2e6c8'; mg.fillRect(0, 0, mc.width, mc.height);
  g.drawImage(mc, 512 - w / 2, 256 - s / 2 - 8, w, s);
  g.strokeStyle = 'rgba(40,0,0,0.5)'; g.lineWidth = 6; g.strokeRect(14, 14, 996, 484);
  g.strokeStyle = '#d8b25a'; g.lineWidth = 5; g.beginPath(); g.moveTo(0, 505); g.lineTo(1024, 505); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// ---------------------------------------------------------------- v12: place names painted in the world at bin height
// The Midwest co-op vernacular: the town's name in huge letters across the silo row (IOWA), the yard's name round the
// water tower's bowl (OMAHA). Weathered paint (drips, bare concrete showing through), wrapped on the curved surfaces.
function paintTex(text, { w = 2048, h = 512, color = '#9a1a12', font = 'Anton', fill = 0.82, track = 0.06 } = {}) {
  const [c, g] = cv(w, h), r = rng(text.length * 97 + 5);
  g.clearRect(0, 0, w, h);
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = h * fill; g.font = `${size}px "${font}"`;
  const chars = [...text], adv = ch => g.measureText(ch).width, sp = size * track;
  let tw = chars.reduce((a, ch) => a + adv(ch) + sp, -sp);
  const sx = Math.min(1, (w * 0.94) / tw);
  g.save(); g.translate(w / 2, h / 2); g.scale(sx, 1);
  let x = -tw / 2; for (const ch of chars) { const a = adv(ch); g.fillText(ch, x + a / 2, 0); x += a + sp; }
  g.restore();
  // weather: drips under the letters, the paint worn through in patches
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(210,200,184,${0.25 + 0.5 * r()})`; const x = r() * w, y = r() * h, s0 = 2 + r() * 14; g.fillRect(x, y, s0 * (0.5 + r()), s0 * 0.4); }
  g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 40; i++) { const x = w * (0.05 + 0.9 * r()), y0 = h * (0.72 + 0.1 * r()); g.fillStyle = color; g.globalAlpha = 0.5; g.fillRect(x, y0, 3 + r() * 4, h * (0.05 + 0.18 * r())); }
  g.globalAlpha = 1;
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}
// the letters across the front of a silo row (elevator() info: M, n, R, H, dz): one front half-cylinder per silo,
// u mapped along the row so the word runs across the bins
export function siloLetters(el, text, mat) {
  const { M, n, R, H } = el, L = n * R * 2, hL = H * 0.46, y0 = H * 0.3, g = [];
  const map = paintTex(text, { h: 512, w: Math.round(512 * L / hL * 0.9) });
  const m = mat || new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color(0.45, 0.1, 0.06), transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  for (let i = 0; i < n; i++) {
    const cx = (i - (n - 1) / 2) * R * 2, geo = new THREE.CylinderGeometry(R + 0.06, R + 0.06, hL, 24, 1, true, -Math.PI / 2, Math.PI);
    geo.translate(cx, y0 + hL / 2, 0);
    const P = geo.attributes.position, UV = geo.attributes.uv;
    for (let k = 0; k < P.count; k++) UV.setX(k, (P.getX(k) + L / 2) / L);
    geo.applyMatrix4(M); g.push(geo);
  }
  const mesh = new THREE.Mesh(mergeGeometries(g), m); return mesh;
}
// the name round the front of a water tower's bowl (the tank's straight band, H+1..H+5.2)
export function bowlLetters(towerM, H, text, facing = 0) {
  const map = paintTex(text, { w: 2048, h: 360, color: '#c01c12', fill: 0.86 });
  const geo = new THREE.CylinderGeometry(6.47, 6.47, 3.8, 48, 1, true, facing - Math.PI * 0.42, Math.PI * 0.84);
  geo.translate(0, H + 1.2 + 1.9, 0); geo.applyMatrix4(towerM);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color(0.55, 0.12, 0.08), transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
}
