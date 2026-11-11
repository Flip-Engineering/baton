// STYLE / line: lines drawn where the anatomy has edges at the person's level (lane E; stage 8's line side in
// PERSON_PIPELINE.md). Not an edge filter on a picture: every line comes from the person's own AOVs and anatomy.
//
//   import { lineAOV, drawLines } from '../lib/fx/style/line.js';
//   const aov = lineAOV(renderer, scene, camera, w, h);                     // surface.js AOV modes 2 + 3, float targets
//   drawLines(ctx, aov, { hero: h, camera, key, weight: 1, level: 2, landmarks: true, face: true, ink: '#16130f' });
//
// What is drawn, in the order an engraver or poster artist reaches for it (Bridgman 1920; Loomis; Lynd Ward's contour):
//   CONTOUR   the occluding contour: coverage, a step in depth (the depth's own second difference, so a slope is not an
//             edge) or a different object; thicker on the side turned from the key and where the step is deep (an arm
//             in front of the chest gets a heavier line than its own outline against the ground: overlap reads as depth).
//   CREASE    a fold in the surface (the view normals of two neighbours differ by more than ~50 degrees): the inside of a
//             bent elbow, a collar.
//   HEM       a garment's edge on the body or on another garment (a different object id): a cuff, a waistband, a hat brim.
//   PLANES    at L1.5+ the plane breaks (a change of plane id), weighted by the angle the two planes make: the turn of form.
//   LANDMARKS at L0.5-L2.5 the bony lines the person's anchors carry (shape.js landmarkProxies: clavicle, rib arch, iliac
//             crest and inguinal line, spinal furrow, tibial crest), projected through the skinning and depth-tested: short
//             tapered strokes, lighter than a contour.
//   FACE      h.inkStrokes() (lids, brows, socket, mouth, catchlight: Spider-Verse's hand-placed face lines), above ~90 px.
// Lines are splatted as anti-aliased discs into one coverage buffer and printed in one ink.
import * as THREE from 'three';
import { stylePass } from './surface.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
let RT = null;
// both AOVs at w x h (rows bottom-up, as GL reads them)
export function lineAOV(renderer, scene, camera, w, h) {
  if (!RT || RT.width !== w || RT.height !== h) { RT?.dispose(); RT = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true }); }
  const ids = new Float32Array(w * h * 4), nd = new Float32Array(w * h * 4), prev = renderer.getRenderTarget(), cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
  renderer.setRenderTarget(RT); stylePass(renderer, scene, camera, 2, { clear: [-1, -1, 0, 0] }); renderer.readRenderTargetPixels(RT, 0, 0, w, h, ids);
  stylePass(renderer, scene, camera, 3, { clear: [0, 0, 0, 0] }); renderer.readRenderTargetPixels(RT, 0, 0, w, h, nd);
  renderer.setRenderTarget(prev); renderer.setClearColor(cc, ca);
  return { ids, nd, w, h };
}
// the figure mask (canvas, white = figure, alpha) from an AOV: everything with an id below 90 (90+ = ground and set)
export function figureMask(aov) { const { w, h, ids } = aov, c = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d'), im = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (h - 1 - y) * w + x, o = (y * w + x) * 4, on = ids[i * 4 + 3] > 0 && ids[i * 4] < 90; im.data[o] = im.data[o + 1] = im.data[o + 2] = 255; im.data[o + 3] = on ? 255 : 0; }
  g.putImageData(im, 0, 0); return c; }

// drawLines(ctx, aov, o): o.hero or o.heroes, o.camera (for landmarks and face strokes), o.key (view-space key, a THREE.Vector3), o.level
// (the shape level, number), o.weight (px at 1080 wide), o.ink, o.planes (0..1), o.landmarks (0..1), o.face, o.crease, o.hem
export function drawLines(ctx, aov, o = {}) {
  const { w, h, ids, nd } = aov, W = ctx.canvas.width, H = ctx.canvas.height, sx = W / w, sy = H / h, S = W / 1080, base = (o.weight ?? 2.2) * S;
  const lev = o.level ?? 0, pk = o.planes ?? clamp((lev - 1.2) / 0.8), lk = o.landmarks ?? (lev >= 0.4 && lev <= 2.6 ? 1 : 0);
  const cov = new Float32Array(W * H), key = o.key || new THREE.Vector3(-0.5, 0.55, 0.65).normalize();
  const splat = (x, y, r, a) => { if (r <= 0 || a <= 0) return; const R = Math.ceil(r + 1), cx = Math.round(x), cy = Math.round(y);
    for (let j = -R; j <= R; j++) { const yy = cy + j; if (yy < 0 || yy >= H) continue; for (let i = -R; i <= R; i++) { const xx = cx + i; if (xx < 0 || xx >= W) continue; const d = Math.hypot(xx - x, yy - y), c = clamp(r + 0.5 - d) * a; const k = yy * W + xx; if (c > cov[k]) cov[k] = c; } } };
  const at = (x, y) => (h - 1 - y) * w + x, on = i => ids[i * 4 + 3] > 0, fig = i => on(i) && ids[i * 4] < 90, id = i => Math.round(ids[i * 4]), pl = i => Math.round(ids[i * 4 + 1]), z = i => nd[i * 4 + 3];
  const lit = i => clamp((nd[i * 4] * key.x + nd[i * 4 + 1] * key.y + nd[i * 4 + 2] * key.z) * 2 + 0.5);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = at(x, y); if (!fig(i)) continue;
    let contour = 0, crease = 0, hem = 0, plane = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = at(x + dx, y + dy);
      if (!fig(j)) { contour = 1; continue; }
      const zi = z(i), zj = z(j);
      if (zj > zi * 1.0 && (zj - zi) > zi * (0.012 + 0.04 * (1 - Math.abs(nd[i * 4 + 2])))) contour = Math.max(contour, clamp((zj - zi) / (zi * 0.05)) * 0.8 + 0.2);   // i is in front of j: the line on the near side
      const dn = 1 - (nd[i * 4] * nd[j * 4] + nd[i * 4 + 1] * nd[j * 4 + 1] + nd[i * 4 + 2] * nd[j * 4 + 2]);
      if (dn > 0.35) crease = Math.max(crease, clamp((dn - 0.35) / 0.4));
      if (id(i) !== id(j) && (id(i) >= 40 || id(j) >= 40) && zj >= zi - zi * 0.004) hem = 1;
      if (pk > 0 && pl(i) >= 0 && pl(j) >= 0 && pl(i) !== pl(j) && pl(j) > pl(i)) plane = Math.max(plane, clamp((dn - 0.04) / 0.25));
    }
    // a contour or hem never thinner than ~0.7 AOV texel, or a diagonal edge (one texel per row) prints as a dotted line
    // (first 270 px board)
    const shade = 1 - lit(i), X = (x + 0.5) * sx, Y = (y + 0.5) * sy, rmin = 0.7 * Math.max(sx, sy);
    if (contour) splat(X, Y, Math.max(rmin, base * (0.55 + 0.6 * shade) * (0.7 + 0.3 * contour)), 1);
    else if (hem && o.hem !== false) splat(X, Y, Math.max(rmin * 0.8, base * 0.45 * (0.7 + 0.5 * shade)), 0.9);
    else if (crease && o.crease !== false) splat(X, Y, base * 0.4 * crease * (0.6 + 0.6 * shade), 0.85);
    else if (plane) splat(X, Y, base * 0.32 * (0.5 + 0.5 * plane), 0.75 * pk * (0.4 + 0.6 * shade));
  }
  // landmark lines: the anchors' surface paths, skinned, projected, depth-tested against the AOV
  const heroes = o.heroes || (o.hero ? [o.hero] : []);
  for (const hh of heroes) if (lk > 0 && o.camera && hh.style?.person?.anchors) {
    const A = hh.style.person.anchors, v = new THREE.Vector3(), cam = o.camera, inv = cam.matrixWorldInverse;
    const want = o.landmarkSet || ['clavicle_L', 'clavicle_R', 'crest_L', 'crest_R', 'inguinal_L', 'inguinal_R', 'ribarch_L', 'ribarch_R', 'spine', 'tibia_L', 'tibia_R', 'scapula_L', 'scapula_R'];
    hh.group.updateMatrixWorld(true); hh.skeleton.update();
    for (const nm of want) { const path = A.lines[nm]; if (!path || path.length < 3) continue; const pts = [];
      for (const vi of path) { hh.body.getVertexPosition(vi, v); v.applyMatrix4(hh.body.matrixWorld); const zc = -v.clone().applyMatrix4(inv).z; v.project(cam);
        const px = (v.x * 0.5 + 0.5) * W, py = (-v.y * 0.5 + 0.5) * H, ax = Math.floor(px / sx), ay = Math.floor(py / sy); if (ax < 0 || ay < 0 || ax >= w || ay >= h) { pts.push(null); continue; }
        const ii = at(ax, ay); pts.push(on(ii) && ids[ii * 4] < 40 && Math.abs(z(ii) - zc) < 0.02 * zc + 0.01 ? [px, py] : null); }
      // a tapered stroke over the visible runs, the middle 80 % of the path (an engraver lifts the burin before the ends)
      const n = pts.length; for (let k = Math.floor(n * 0.1); k < Math.ceil(n * 0.9) - 1; k++) { const a = pts[k], b = pts[k + 1]; if (!a || !b) continue; const u = k / n, tap = Math.sin(Math.PI * clamp((u - 0.1) / 0.8)), steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
        for (let s = 0; s <= steps; s++) splat(a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps, base * 0.3 * (0.4 + 0.6 * tap), 0.7 * lk); } }
  }
  // the face's own strokes (hero.js inkStrokes) when the face is big enough to carry them
  for (const hh of heroes) if (o.face !== false && o.camera && hh.faceTier(o.camera, H).px > 90 * (H / 1920)) {
    for (const s of hh.inkStrokes(o.camera, W, H)) { if (s.ink !== 'ink') continue; const r = Math.max(0.6, s.w * 0.5 * (o.faceK ?? 0.8));
      for (let k = 0; k + 1 < s.pts.length; k++) { const a = s.pts[k], b = s.pts[k + 1], steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1; for (let q = 0; q <= steps; q++) splat(a[0] + (b[0] - a[0]) * q / steps, a[1] + (b[1] - a[1]) * q / steps, r, 0.9); } }
  }
  const img = ctx.getImageData(0, 0, W, H), D = img.data, ink = new THREE.Color(o.ink || '#16130f'), ir = ink.r * 255, ig = ink.g * 255, ib = ink.b * 255;
  for (let k = 0; k < W * H; k++) { const a = cov[k]; if (a <= 0) continue; D[k * 4] += (ir - D[k * 4]) * a; D[k * 4 + 1] += (ig - D[k * 4 + 1]) * a; D[k * 4 + 2] += (ib - D[k * 4 + 2]) * a; D[k * 4 + 3] = Math.max(D[k * 4 + 3], a * 255); }
  ctx.putImageData(img, 0, 0);
  return { coverage: cov };
}
