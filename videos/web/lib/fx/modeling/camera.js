// MODELING camera + light from a plate (MODELING studio, cycle 1).
//
// Why: a model pasted on a photograph fails first on the camera (its horizon, its lens, where the floor is) and second on
// the light (its direction, its colour). Both can be read back from the plate:
//   solveFromVPs   two vanishing points of orthogonal scene directions -> focal length and camera rotation. The fSpy /
//                  BLAM method (Caprile & Torre 1990): with the principal point at the image centre, f^2 = -(v1-c).(v2-c).
//                  Mark two line pairs on the photograph (a road edge and a cab edge, a crane leg and a container row) and
//                  the model is built in the photograph's own camera.
//   solveLevel     when only one vanishing point and the horizon are known (a level camera): pitch 0, yaw from the VP,
//                  focal from a stated field of view.
//   plateCamera    the THREE.PerspectiveCamera for that solution, with setViewOffset for the scene's crop of the plate, so
//                  a 9:16 window into a 4:3 plate (or a slow zoom) is the SAME frustum the plate's window shows.
//   lightFromPlate fit a directional key to the plate's own shading: lum ~ ambient + key * max(0, N . L) over the subject,
//                  N from the plate's baked normals (depth normals are soft: it finds the side the light is on, not a
//                  precise angle), the colour from the lit and shadowed values.
//   envFromPlate   a small equirect environment map from the plate itself (its own colours in front, its average behind)
//                  so chrome and glass reflect the scene they are in.
import * as THREE from 'three';

// vp in pixels (y down). axes: which world axes the two directions are; signs pick the handedness. Returns { fovY, quaternion, f }
export function solveFromVPs({ w, h, vp1, vp2, axes = ['x', 'z'], c = [w / 2, h / 2] }) {
  const f2 = -((vp1[0] - c[0]) * (vp2[0] - c[0]) + (vp1[1] - c[1]) * (vp2[1] - c[1]));
  if (f2 <= 0) throw new Error('solveFromVPs: the two vanishing points are not orthogonal directions for a sane camera (f^2 <= 0)');
  const f = Math.sqrt(f2);
  const ray = v => new THREE.Vector3(v[0] - c[0], -(v[1] - c[1]), -f).normalize();
  const d1 = ray(vp1), d2 = ray(vp2), d3 = new THREE.Vector3().crossVectors(d1, d2).normalize();
  // d1, d2, d3 = world axes named in `axes` (+ the third) expressed in camera coordinates
  const W = { x: null, y: null, z: null }; W[axes[0]] = d1; W[axes[1]] = d2; const third = ['x', 'y', 'z'].find(a => !axes.includes(a)); W[third] = d3;
  // right-handedness: x cross y = z
  if (new THREE.Vector3().crossVectors(W.x, W.y).dot(W.z) < 0) W[third] = W[third].clone().negate();
  // make the world up (+y) point up in the image
  let flip = W.y.y < 0; if (flip) { W.y = W.y.clone().negate(); W.x = W.x.clone().negate(); }
  // camera -> world rotation: its rows are the world axes expressed in camera coordinates
  const M = new THREE.Matrix4().set(W.x.x, W.x.y, W.x.z, 0, W.y.x, W.y.y, W.y.z, 0, W.z.x, W.z.y, W.z.z, 0, 0, 0, 0, 1);   // world->camera rotation
  const q = new THREE.Quaternion().setFromRotationMatrix(M);   // rows are the world axes in camera coordinates = the camera-to-world rotation
  return { f, fovY: 2 * Math.atan(h / 2 / f), quaternion: q, w, h, c };
}

// level camera (roll 0, pitch from the horizon): horizonY in px (y down), fovY known or guessed; vpX optional yaw
export function solveLevel({ w, h, horizonY, fovY = 0.6, vpX = null }) {
  const f = h / 2 / Math.tan(fovY / 2), pitch = Math.atan((h / 2 - horizonY) / f);   // horizon above the centre => the camera looks down
  const yaw = vpX == null ? 0 : Math.atan((vpX - w / 2) / f / Math.cos(pitch));       // the road's VP right of centre => the camera looks left of the road
  return { f, fovY, quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ')), w, h, c: [w / 2, h / 2] };
}

// camera for a solution and the scene's window (view = plate-uv rect [x, y, w, h] as Plate.viewRect returns)
export function plateCamera(sol, view = [0, 0, 1, 1], { near = 0.05, far = 500, position = [0, 0, 0] } = {}) {
  const cam = new THREE.PerspectiveCamera(sol.fovY * 180 / Math.PI, sol.w / sol.h, near, far);
  cam.quaternion.copy(sol.quaternion); cam.position.set(...position);
  cam.setViewOffset(sol.w, sol.h, view[0] * sol.w, view[1] * sol.h, view[2] * sol.w, view[3] * sol.h);
  cam.updateMatrixWorld(true); cam.userData.sol = sol; return cam;
}
export function setView(cam, view) { const s = cam.userData.sol; cam.setViewOffset(s.w, s.h, view[0] * s.w, view[1] * s.h, view[2] * s.w, view[3] * s.h); cam.updateProjectionMatrix(); }
// pixel (plate px, y down) -> a unit ray in camera space (looking -Z)
export function rayAt(sol, px, py) { return new THREE.Vector3(px - sol.c[0], -(py - sol.c[1]), -sol.f).normalize(); }

// ---- light from the plate
function px(img, size = 128) {
  const c = document.createElement('canvas'), a = img.width / img.height; c.width = a >= 1 ? size : Math.round(size * a); c.height = a >= 1 ? Math.round(size / a) : size;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, c.width, c.height); return g.getImageData(0, 0, c.width, c.height);
}
// colorImg, normalImg (baked plate normals), alphaImg: HTMLImageElement/canvas. Returns { dir (toward the light, camera space,
// +x right +y up +z toward viewer), key: [r,g,b] (relative), amb: [r,g,b], fit (0..1 correlation), n }
export function lightFromPlate(colorImg, normalImg, alphaImg = null, { relief = 3, minAlpha = 0.5 } = {}) {
  const C = px(colorImg, 96), N = px(normalImg, 96), A = alphaImg ? px(alphaImg, 96) : null; const n = C.data.length / 4;
  const S = []; for (let i = 0; i < n; i++) {
    if (A && A.data[i * 4] / 255 < minAlpha) continue;
    let nx = (N.data[i * 4] / 255 * 2 - 1) * relief, ny = -(N.data[i * 4 + 1] / 255 * 2 - 1) * relief, nz = Math.max(N.data[i * 4 + 2] / 255 * 2 - 1, 0.05); const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    S.push([nx, ny, nz, C.data[i * 4], C.data[i * 4 + 1], C.data[i * 4 + 2]]);
  }
  if (S.length < 50) return { dir: new THREE.Vector3(-0.4, 0.6, 0.7).normalize(), key: [1, 1, 1], amb: [0.2, 0.2, 0.2], fit: 0, n: S.length };
  const lum = s => (0.2126 * s[3] + 0.7152 * s[4] + 0.0722 * s[5]) / 255; let best = { r: -1 };
  for (let az = 0; az < 360; az += 15) for (let el = 0; el <= 80; el += 10) {
    const L = [Math.sin(az * Math.PI / 180) * Math.cos(el * Math.PI / 180), Math.sin(el * Math.PI / 180), Math.cos(az * Math.PI / 180) * Math.cos(el * Math.PI / 180)];
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (const s of S) { const d = Math.max(0, s[0] * L[0] + s[1] * L[1] + s[2] * L[2]), y = lum(s); sx += d; sy += y; sxx += d * d; syy += y * y; sxy += d * y; }
    const m = S.length, cov = sxy / m - sx / m * sy / m, vx = sxx / m - (sx / m) ** 2, vy = syy / m - (sy / m) ** 2, r = cov / Math.sqrt(Math.max(vx * vy, 1e-9));
    if (r > best.r) best = { r, L, b: cov / Math.max(vx, 1e-9), a: sy / m - cov / Math.max(vx, 1e-9) * sx / m };
  }
  // colour: mean of the lit half vs the shadowed half
  const lit = [0, 0, 0], dark = [0, 0, 0]; let nl = 0, nd = 0;
  for (const s of S) { const d = s[0] * best.L[0] + s[1] * best.L[1] + s[2] * best.L[2]; const t = d > 0.3 ? lit : dark; t[0] += s[3]; t[1] += s[4]; t[2] += s[5]; d > 0.3 ? nl++ : nd++; }
  const nrm = (v, k) => v.map(x => x / Math.max(k, 1) / 255);
  return { dir: new THREE.Vector3(...best.L), key: nrm(lit, nl), amb: nrm(dark, nd), fit: best.r, gain: best.b, base: best.a, n: S.length };
}

// ---- an environment map from the plate itself
export function envFromPlate(renderer, colorImg, sol, { ambient = [0.05, 0.05, 0.06], gain = 1, size = 128, back = 0.6 } = {}) {
  const W = size * 2, H = size, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const P = px(colorImg, 64), pw = P.width, ph = P.height, out = g.createImageData(W, H);
  let avg = [0, 0, 0]; for (let i = 0; i < P.data.length; i += 4) { avg[0] += P.data[i]; avg[1] += P.data[i + 1]; avg[2] += P.data[i + 2]; } avg = avg.map(v => v / (P.data.length / 4) / 255);
  const f = sol.f, cx = sol.c[0], cy = sol.c[1];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const az = (x / W - 0.5) * 2 * Math.PI, el = (0.5 - y / H) * Math.PI;         // az 0 = -Z (the camera's view direction)
    const d = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
    const i = (y * W + x) * 4; let col;
    if (d[2] < -0.05) { const u = cx + (d[0] / -d[2]) * f, v = cy - (d[1] / -d[2]) * f;
      const uu = Math.min(0.999, Math.max(0, u / sol.w)), vv = Math.min(0.999, Math.max(0, v / sol.h)), k = ((vv * ph | 0) * pw + (uu * pw | 0)) * 4;
      const inside = u >= 0 && u <= sol.w && v >= 0 && v <= sol.h; const edge = inside ? 1 : Math.exp(-Math.hypot(Math.max(0, -u, u - sol.w), Math.max(0, -v, v - sol.h)) / sol.f * 2.2);
      const pc = [P.data[k] / 255, P.data[k + 1] / 255, P.data[k + 2] / 255];
      col = pc.map((p, j) => (p * edge + (avg[j] * back + ambient[j]) * (1 - edge)) * gain);
    } else col = avg.map((a, j) => (a * back * (d[1] > 0 ? 1 : 0.5) + ambient[j]) * gain);
    out.data[i] = Math.min(255, col[0] * 255); out.data[i + 1] = Math.min(255, col[1] * 255); out.data[i + 2] = Math.min(255, col[2] * 255); out.data[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(c); tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.PMREMGenerator(renderer); const env = pm.fromEquirectangular(tex).texture; pm.dispose(); tex.dispose(); return env;
}
