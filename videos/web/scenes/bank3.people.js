// PEOPLE'S NATIONAL BANK v5: people, sculpted. Swap point for the shared detailed-people module
// (videos/web/fx/people.js, being built elsewhere): when it lands, `bust()`, `figure()` and `crowdFigure()` are the
// three entry points bank3.world.js calls, and they can be re-pointed at it one by one.
//
// Every body part is a signed distance field (smooth unions of ellipsoids, capsules and round cones, with smooth
// subtractions for sockets, nostrils, the mouth line and the ear's bowl), meshed by surface nets at bake time, with
// normals taken from the field gradient and a per-vertex tone (iris, brows, stubble, overall denim, boot leather)
// that the engraving material reads. So a head has eyelids, brows, ears, a jaw with stubble; a worker has a work
// shirt with a collar, overall straps, gloves, boots and a hard hat with a brim, a ridge and a sticker.
import * as THREE from 'three';
import { mergeGeometries } from '../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- SDF primitives (plain JS, allocation-free)
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
export function ell(px, py, pz, cx, cy, cz, rx, ry, rz) {
  const x = px - cx, y = py - cy, z = pz - cz;
  const k0 = len3(x / rx, y / ry, z / rz), k1 = len3(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : k0 * (k0 - 1) / k1;
}
export function cap(px, py, pz, ax, ay, az, bx, by, bz, r) {
  const pax = px - ax, pay = py - ay, paz = pz - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  return len3(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}
// round cone between a (radius r1) and b (radius r2): capsule with a linear taper
export function rcone(px, py, pz, ax, ay, az, bx, by, bz, r1, r2) {
  const pax = px - ax, pay = py - ay, paz = pz - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  return len3(pax - bax * h, pay - bay * h, paz - baz * h) - (r1 + (r2 - r1) * h);
}
export function box(px, py, pz, cx, cy, cz, bx, by, bz, r = 0) {
  const qx = Math.abs(px - cx) - bx + r, qy = Math.abs(py - cy) - by + r, qz = Math.abs(pz - cz) - bz + r;
  return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
export const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
export const smax = (a, b, k) => -smin(-a, -b, k);
export const sub = (a, b, k) => smax(a, -b, k);

// ---------------------------------------------------------------- surface nets
// f(x,y,z) -> distance; bounds [x0,y0,z0,x1,y1,z1]; h = voxel size. Coarse pass skips cells far from the surface.
export function mesh(f, bounds, h, tone = null) {
  const [x0, y0, z0, x1, y1, z1] = bounds;
  const nx = Math.ceil((x1 - x0) / h) + 1, ny = Math.ceil((y1 - y0) / h) + 1, nz = Math.ceil((z1 - z0) / h) + 1;
  const V = new Float32Array(nx * ny * nz), idx = (i, j, k) => i + nx * (j + ny * k);
  const B = 4, cb = B * h * 0.9;                                    // coarse blocks of 4^3 voxels
  for (let k = 0; k < nz; k += B) for (let j = 0; j < ny; j += B) for (let i = 0; i < nx; i += B) {
    const cx = x0 + (i + B / 2) * h, cy = y0 + (j + B / 2) * h, cz = z0 + (k + B / 2) * h, dc = f(cx, cy, cz);
    const far = Math.abs(dc) > cb * 1.9;
    for (let kk = k; kk < Math.min(k + B + 1, nz); kk++) for (let jj = j; jj < Math.min(j + B + 1, ny); jj++) for (let ii = i; ii < Math.min(i + B + 1, nx); ii++) {
      const q = idx(ii, jj, kk); if (far) { if (V[q] === 0) V[q] = dc; } else V[q] = f(x0 + ii * h, y0 + jj * h, z0 + kk * h) || 1e-6;
    }
  }
  const vid = new Int32Array(nx * ny * nz).fill(-1), P = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let m = 0;
    for (let c = 0; c < 8; c++) { const v = V[idx(i + (c & 1), j + (c >> 1 & 1), k + (c >> 2 & 1))]; cv[c] = v; if (v < 0) m |= 1 << c; }
    if (m === 0 || m === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) { if ((cv[a] < 0) === (cv[b] < 0)) continue; const t = cv[a] / (cv[a] - cv[b]);
      sx += (a & 1) + ((b & 1) - (a & 1)) * t; sy += (a >> 1 & 1) + ((b >> 1 & 1) - (a >> 1 & 1)) * t; sz += (a >> 2 & 1) + ((b >> 2 & 1) - (a >> 2 & 1)) * t; n++; }
    vid[idx(i, j, k)] = P.length / 3; P.push(x0 + (i + sx / n) * h, y0 + (j + sy / n) * h, z0 + (k + sz / n) * h);
  }
  const I = [];
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = V[idx(i, j, k)] < 0;
    // edge along +x from (i,j,k): quads from cells sharing it
    if (i < nx - 1 && a !== (V[idx(i + 1, j, k)] < 0)) quad(vid[idx(i, j - 1, k - 1)], vid[idx(i, j, k - 1)], vid[idx(i, j, k)], vid[idx(i, j - 1, k)], a);
    if (j < ny - 1 && a !== (V[idx(i, j + 1, k)] < 0)) quad(vid[idx(i - 1, j, k - 1)], vid[idx(i - 1, j, k)], vid[idx(i, j, k)], vid[idx(i, j, k - 1)], a);
    if (k < nz - 1 && a !== (V[idx(i, j, k + 1)] < 0)) quad(vid[idx(i - 1, j - 1, k)], vid[idx(i, j - 1, k)], vid[idx(i, j, k)], vid[idx(i - 1, j, k)], a);
  }
  function quad(q0, q1, q2, q3, flip) { if (q0 < 0 || q1 < 0 || q2 < 0 || q3 < 0) return; if (flip) I.push(q0, q1, q2, q0, q2, q3); else I.push(q0, q2, q1, q0, q3, q2); }
  const g = new THREE.BufferGeometry(), pos = new Float32Array(P), nrm = new Float32Array(P.length), col = new Float32Array(P.length), e = h * 0.5;
  for (let v = 0; v < P.length; v += 3) {
    const x = P[v], y = P[v + 1], z = P[v + 2];
    const gx = f(x + e, y, z) - f(x - e, y, z), gy = f(x, y + e, z) - f(x, y - e, z), gz = f(x, y, z + e) - f(x, y, z - e), l = len3(gx, gy, gz) || 1;
    nrm[v] = gx / l; nrm[v + 1] = gy / l; nrm[v + 2] = gz / l;
    const c = tone ? tone(x, y, z) : 1; col[v] = col[v + 1] = col[v + 2] = c;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(I);
  // winding check: flip if the first face points against its normal
  if (I.length) { const a = I[0] * 3, b = I[1] * 3, c = I[2] * 3; const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx; if (cx * nrm[a] + cy * nrm[a + 1] + cz * nrm[a + 2] < 0) { for (let q = 0; q < I.length; q += 3) { const t = I[q + 1]; I[q + 1] = I[q + 2]; I[q + 2] = t; } g.setIndex(I); } }
  return g;
}

// ---------------------------------------------------------------- the head (units: head height chin-to-crown ~ 2.2, face to +z)
// o: {jaw: width scale, stubble: 0..1, brow: heaviness, nose: length, hair: 0..1}
export function headSDF(o = {}) {
  const J = o.jaw ?? 1.1, NZ = o.nose ?? 1, BR = o.brow ?? 1;
  const eyeY = 0.1, eyeX = 0.3, eyeZ = 0.57;
  const f = (x, y, z) => {
    const ax = Math.abs(x);
    let d = ell(x, y, z, 0, 0.32, -0.14, 0.8, 0.94, 0.98);                                   // cranium
    d = smin(d, ell(x, y, z, 0, -0.08, 0.14, 0.74 * J, 0.9, 0.76), 0.25);                     // face mass
    d = smin(d, box(x, y, z, 0, -0.66, 0.16, 0.5 * J, 0.26, 0.42, 0.22), 0.2);                // square jaw
    d = smin(d, ell(ax, y, z, 0.5 * J, -0.52, -0.1, 0.2, 0.3, 0.3), 0.16);                    // jaw angle
    d = smin(d, box(x, y, z, 0, -0.88, 0.44, 0.3 * J, 0.13, 0.17, 0.12), 0.16);               // square chin
    d = smin(d, ell(ax, y, z, 0.47, -0.04, 0.44, 0.23, 0.15, 0.26), 0.14);                    // cheekbones
        d = smin(d, cap(ax, y, z, 0.03, 0.3, 0.74, 0.46, 0.28, 0.56, 0.085 * BR), 0.1);           // brow ridge
    d = smin(d, ell(x, y, z, 0, 0.36, 0.7, 0.13, 0.1, 0.08), 0.08);                          // glabella
    d = sub(d, ell(ax, y, z, eyeX, eyeY + 0.01, 0.8, 0.17, 0.1, 0.14), 0.08);                 // sockets
        // nose: straight bridge, strong dorsum, a broad tip, wings; nostrils tucked under
    d = smin(d, rcone(x, y, z, 0, 0.24, 0.74, 0, -0.2 * NZ, 0.99, 0.075, 0.09), 0.06);
    d = smin(d, ell(x, y, z, 0, -0.23 * NZ, 0.95, 0.11, 0.095, 0.1), 0.05);
    d = smin(d, ell(ax, y, z, 0.13, -0.27 * NZ, 0.83, 0.08, 0.07, 0.08), 0.05);
    d = sub(d, ell(ax, y, z, 0.065, -0.335 * NZ, 0.86, 0.03, 0.014, 0.04), 0.015);
    d = smin(d, cap(ax, y, z, 0.18, -0.32, 0.8, 0.25, -0.6, 0.72, 0.03), 0.06);               // nasolabial fold
    // mouth: a firm line, thin upper lip, fuller lower lip, corners set
    d = smin(d, ell(x, y, z, 0, -0.5, 0.78, 0.19, 0.045, 0.1), 0.06);
    d = smin(d, ell(x, y, z, 0, -0.6, 0.76, 0.16, 0.05, 0.1), 0.06);
    d = sub(d, ell(x, y, z, 0, -0.545, 0.9, 0.22, 0.01, 0.09), 0.012);
    d = sub(d, ell(ax, y, z, 0.2, -0.545, 0.76, 0.025, 0.02, 0.05), 0.03);
    d = sub(d, ell(x, y, z, 0, -0.72, 0.78, 0.14, 0.03, 0.06), 0.04);                         // the dip above the chin
    // ears
    let er = ell(ax, y, z, 0.74, 0.04, -0.34, 0.1, 0.27, 0.17);
    er = sub(er, ell(ax, y, z, 0.8, 0.02, -0.31, 0.05, 0.15, 0.1), 0.03);
    d = smin(d, er, 0.05);
    // a thick neck, tendons, a trace of the Adam's apple
    d = smin(d, rcone(x, y, z, 0, -0.55, -0.2, 0, -2.0, -0.2, 0.52, 0.6), 0.22);
    d = smin(d, cap(ax, y, z, 0.52, -0.42, -0.24, 0.14, -1.7, 0.24, 0.1), 0.14);
    d = smin(d, ell(x, y, z, 0, -1.2, 0.33, 0.06, 0.08, 0.05), 0.08);
    // eyeballs and lids
    const er2 = len3(ax - eyeX, y - eyeY, z - eyeZ);
    d = Math.min(d, er2 - 0.125);
    const up = Math.max(er2 - 0.145, -(y - eyeY - 0.04 + 0.06 * (ax - eyeX)));              // heavy upper lid
    const lo = Math.max(er2 - 0.137, (y - eyeY + 0.078));                                     // lower lid
    d = smin(d, up, 0.025); d = smin(d, lo, 0.03);
    d = smin(d, cap(ax, y, z, eyeX - 0.14, eyeY + 0.1, 0.64, eyeX + 0.13, eyeY + 0.085, 0.58, 0.018), 0.03);   // lid fold
    d = smin(d, cap(ax, y, z, eyeX + 0.1, eyeY - 0.12, 0.62, eyeX + 0.2, eyeY - 0.08, 0.55, 0.012), 0.03);    // crow's foot
    return d;
  };
  // tone: iris and pupil dark, brows dark, cropped hair, stubble on the jaw and lip
  const tone = (x, y, z) => {
    const ax = Math.abs(x);
    const ex = ax - eyeX, ey = y - eyeY, ez = z - eyeZ, el = len3(ex, ey, ez);
    if (el < 0.133) { const look = (ez / el); const r = Math.sqrt(ex * ex + ey * ey);
      if (look > 0.75) return o.small ? (r < 0.05 ? 0.35 : 0.9) : r < 0.03 ? 0.03 : r < 0.066 ? 0.28 : 0.97; return 0.95; }
    let c = 1;
    const bro = Math.exp(-(((ax - 0.3) / 0.19) ** 2 + ((y - 0.28 + 0.12 * (ax - 0.3)) / 0.04) ** 2)) * (z > 0.45 ? 1 : 0);
    c -= 0.75 * bro * BR;
    const hair = (o.hair ?? 1) * (y > 0.12 && (z < 0.25 - (y - 0.1) * 0.2 || y > 0.72) && !(ax > 0.64 && ax < 0.9 && y < 0.34 && z > -0.55 && z < -0.12) ? 1 : 0);
    c -= 0.55 * hair;
    const inBeard = y < -0.3 && y > -1.08 && z > -0.1 - (y + 0.3) * 0.2 && ax < 0.78;
    const lipZone = Math.abs(y + 0.55) < 0.075 && ax < 0.2 && z > 0.7;
    const stub = (o.stubble ?? 0.7) * (inBeard ? 1 : 0) * Math.min(1, (-0.3 - y) * 4) + (o.stubble ?? 0.7) * (ax > 0.55 && ax < 0.8 && y > -0.35 && y < 0.1 && z > -0.05 && z < 0.4 ? 0.6 : 0);
    c -= stub * (lipZone ? 0.0 : 0.38);
    if (lipZone) c -= 0.1;
    return Math.max(0.03, c);
  };
  return { f, tone, bounds: [-0.98, -2.1, -1.25, 0.98, 1.35, 1.15] };
}

// the hard hat: shell, brim with a longer peak, the centre ridge, a sticker patch; tilted back off the eyes
export function hatSDF(o = {}) {
  const tilt = o.tilt ?? -0.14, ca = Math.cos(tilt), sa = Math.sin(tilt), Y0 = o.y ?? 0.46;
  const f = (x0, y0, z0) => {
    const y1 = y0 - Y0, y = y1 * ca - z0 * sa, z = y1 * sa + z0 * ca, x = x0;              // rotate about x through the band
    let shell = ell(x, y, z, 0, 0.0, -0.12, 0.93, 0.84, 1.08);
    shell = smax(shell, -(y + 0.0), 0.03);                                               // cut at the band
    const zz = z + 0.1, pk = zz > 0 ? 0.22 * Math.min(1, zz) : 0;                          // brim: an ellipse, the peak pulled forward
    const rx = x / 1.2, rz = zz / (1.3 + pk);
    const br = Math.max((Math.sqrt(rx * rx + rz * rz) - 1) * 1.15, Math.abs(y - 0.01 + 0.08 * Math.max(0, Math.sqrt(rx * rx + rz * rz) - 0.8)) - 0.045);
    let d = smin(shell, br, 0.07);
    d = smin(d, cap(x, y, z, 0, 0.8, -0.85, 0, 0.84, 0.25, 0.075), 0.08);                    // ridge, front to back
    d = smin(d, cap(x, y, z, 0, 0.84, 0.25, 0, 0.62, 0.72, 0.07), 0.08);
    return d;
  };
  const tone = (x, y0, z0) => { const y1 = y0 - Y0, y = y1 * ca - z0 * sa, z = y1 * sa + z0 * ca;
    const st = Math.abs(x + 0.46) < 0.2 && Math.abs(y - 0.4) < 0.12 && z > 0 ? (Math.abs(x + 0.46) < 0.15 && Math.abs(y - 0.4) < 0.07 ? 0.85 : 0.35) : 1;          // the sticker
    return y < 0.04 ? 0.9 : st; };
  return { f, tone, bounds: [-1.35, 0.2, -1.45, 1.35, 1.45, 1.75] };
}

// the portrait bust: a work shirt with its collar laid open, overall straps and the bib, sloping shoulders
export function bustSDF() {
  const f = (x, y0, z) => {
    const ax = Math.abs(x), y = y0 - 0.3;
    let d = ell(x, y, z, 0, -2.85, -0.2, 1.55, 0.95, 0.9);                                    // chest
    d = smin(d, cap(ax, y, z, 0.35, -1.85, -0.3, 1.45, -2.35, -0.3, 0.42), 0.35);             // trapezius to the shoulder
    d = smin(d, ell(ax, y, z, 1.5, -2.6, -0.28, 0.55, 0.6, 0.6), 0.3);                        // deltoids
    d = smax(d, -(y + 3.6), 0.1);                                                             // cut the bust
    d = sub(d, cap(ax, y, z, 0.0, -2.0, 0.55, 0.0, -2.7, 0.66, 0.22), 0.1);                    // the open neck of the shirt
    d = sub(d, cap(x, y, z, 0.0, -2.6, 0.72, 0.0, -3.6, 0.72, 0.012), 0.01);                   // placket line
    // collar: two points laid flat on the chest, and the stand round the neck
    d = smin(d, cap(ax, y, z, 0.3, -1.72, -0.25, 0.62, -1.85, 0.2, 0.08), 0.05);
    const cp = Math.max(ell(ax, y, z, 0.42, -2.25, 0.58, 0.3, 0.42, 0.1), -(ax - 0.12 - (y + 2.0) * -0.35));
    d = smin(d, cp, 0.03);
    // overall straps (raised), buckles, the bib with its pocket
    d = smin(d, cap(ax, y, z, 0.78, -1.95, -0.3, 0.56, -3.1, 0.62, 0.11), 0.03);
    d = smin(d, box(ax, y, z, 0.57, -2.95, 0.62, 0.12, 0.1, 0.06, 0.03), 0.02);
    d = smin(d, box(x, y, z, 0, -3.35, 0.63, 0.6, 0.28, 0.07, 0.05), 0.04);
    d = smin(d, box(x, y, z, 0.12, -3.35, 0.69, 0.22, 0.16, 0.03, 0.02), 0.01);
    return d;
  };
  const tone = (x, y0, z) => {
    const ax = Math.abs(x), y = y0 - 0.3;
    const strapX = 0.78 + (y + 1.95) / -1.15 * -0.22;
    const strap = Math.abs(ax - strapX) < 0.14 && y < -1.8 && (z > 0.1 || y > -2.2);
    const bib = y < -3.05 && ax < 0.66 && z > 0.5;
    const collar = y > -2.7 && ax < 0.75 && z > 0.35 && !strap;
    return strap || bib ? 0.42 : collar ? 0.95 : 0.8;
  };
  return { f, tone, bounds: [-2.4, -3.45, -1.3, 2.4, -1.25, 1.1] };
}

// ---------------------------------------------------------------- materials for people (the engraver patches them)
export function peopleMats(mk) {
  return { skin: mk('#cfcfcf', { skin: 1, vcol: 1 }), cloth: mk('#b4b4b4', { vcol: 1 }), denim: mk('#5a5a5a', { vcol: 1 }), hat: mk('#f2f2f2', { vcol: 1, hat: 1 }),
    boot: mk('#3a3a3a', {}), glove: mk('#7c7c7c', {}), iron: mk('#6a6a6a', {}) };
}

// a portrait bust group: head + hat + shoulders, meshed fine
export function bust(M, { res = 0.018 } = {}) {
  const g = new THREE.Group();
  const H = headSDF({ stubble: 0.8, brow: 1.1, jaw: 1.12 }), HT = hatSDF({ tilt: -0.16 }), S = bustSDF();
  const head = new THREE.Mesh(mesh(H.f, H.bounds, res, H.tone), M.skin);
  const hat = new THREE.Mesh(mesh(HT.f, HT.bounds, res * 1.2, HT.tone), M.hat);
  const sh = new THREE.Mesh(mesh(S.f, S.bounds, res * 1.8, S.tone), M.cloth);
  for (const m of [head, hat, sh]) { m.castShadow = m.receiveShadow = true; g.add(m); }
  hat.castShadow = false;                                   // the brim's shadow stays off the eyes
  g.head = head; g.hat = hat;
  return g;
}

// ---------------------------------------------------------------- the working figure (metres; 1.8 m tall)
// Parts are meshed once per build and shared; a figure is a joint hierarchy posed per joint.
let PARTS = null;
function parts(M) {
  if (PARTS) return PARTS;
  const r = 0.016;
  // torso: chest, back, belly, hips; a work shirt with a collar and pockets under overall bib and straps
  const torso = (x, y, z) => {
    const ax = Math.abs(x);
    let d = ell(x, y, z, 0, 0.36, 0.0, 0.2, 0.26, 0.13);
    d = smin(d, ell(ax, y, z, 0.1, 0.42, 0.03, 0.13, 0.13, 0.12), 0.08);                    // chest
    d = smin(d, ell(x, y, z, 0, 0.1, 0.0, 0.18, 0.18, 0.125), 0.1);                        // belly
    d = smin(d, cap(ax, y, z, 0.05, 0.52, -0.02, 0.19, 0.49, -0.02, 0.075), 0.07);          // trapezius to the shoulder
    d = smin(d, ell(x, y, z, 0, -0.04, -0.01, 0.2, 0.13, 0.125), 0.08);                    // hips
    d = smin(d, ell(ax, y, z, 0.1, -0.1, 0.0, 0.1, 0.1, 0.11), 0.06);                       // seat, the tops of the thighs
    d = smin(d, cap(ax, y, z, 0.03, 0.57, 0.07, 0.11, 0.52, 0.11, 0.02), 0.02);            // collar points
    d = smin(d, cap(ax, y, z, 0.1, 0.56, -0.08, 0.1, 0.23, 0.14, 0.022), 0.012);            // straps
    d = smin(d, box(x, y, z, 0, 0.2, 0.125, 0.12, 0.1, 0.02, 0.015), 0.02);                // bib
    d = smin(d, box(ax, y, z, 0.1, 0.4, 0.125, 0.045, 0.04, 0.012, 0.01), 0.01);           // shirt pockets
    d = smin(d, box(x, y, z, 0, 0.05, 0.0, 0.185, 0.018, 0.12, 0.015), 0.015);             // waistband
    return d;
  };
  const torsoTone = (x, y, z) => { const ax = Math.abs(x);
    const strap = Math.abs(ax - 0.1) < 0.036 && y > 0.22 && (z > 0.05 || z < -0.05);
    const bib = y < 0.31 && y > 0.06 && ax < 0.13 && z > 0.09; const pants = y < 0.07;
    return strap || bib ? 0.3 : pants ? 0.45 : 1; };
  const upperArm = (x, y, z) => { let d = smin(rcone(x, y, z, 0, 0, 0, 0, -0.27, 0, 0.062, 0.05), ell(x, y, z, 0, -0.1, 0.01, 0.056, 0.11, 0.056), 0.04);
    d = smin(d, ell(x, y, z, 0, -0.02, 0, 0.075, 0.085, 0.075), 0.04); return d; };                  // the deltoid cap rides with the arm
  const foreArm = (x, y, z) => { let d = rcone(x, y, z, 0, 0, 0, 0, -0.25, 0.0, 0.047, 0.036); d = smin(d, ell(x, y, z, 0, -0.06, 0.012, 0.046, 0.08, 0.045), 0.04);
    return smin(d, cap(x, y, z, 0, -0.03, 0, 0, -0.07, 0, 0.056), 0.02); };                // rolled cuff
  const foreTone = (x, y, z) => y > -0.1 ? 0.8 : 1;
  const hand = (x, y, z) => { let d = box(x, y, z, 0, -0.055, 0.005, 0.042, 0.055, 0.02, 0.018);
    d = smin(d, cap(x, y, z, 0, -0.1, 0.01, 0.0, -0.12, 0.035, 0.022), 0.03);                // curled fingers
    d = smin(d, cap(x, y, z, 0.035, -0.02, 0.01, 0.05, -0.07, 0.04, 0.015), 0.02);          // thumb
    return d; };
  const thigh = (x, y, z) => { let d = smin(rcone(x, y, z, 0, 0.02, 0, 0, -0.44, 0, 0.092, 0.066), ell(x, y, z, 0, -0.15, 0.015, 0.085, 0.2, 0.085), 0.05);
    return smin(d, cap(x, y, z, 0, -0.1, 0.085, 0, -0.42, 0.07, 0.008), 0.01); };           // loose work trousers with a crease
  const shin = (x, y, z) => { let d = rcone(x, y, z, 0, 0.02, 0, 0, -0.42, 0, 0.066, 0.062); d = smin(d, ell(x, y, z, 0, -0.12, -0.02, 0.05, 0.12, 0.055), 0.04); return d; };
  const boot = (x, y, z) => { let d = box(x, y, z, 0, -0.05, 0.045, 0.052, 0.045, 0.13, 0.03); d = smin(d, rcone(x, y, z, 0, 0.06, 0, 0, -0.04, 0.0, 0.058, 0.06), 0.04);
    d = smin(d, box(x, y, z, 0, -0.088, 0.045, 0.056, 0.012, 0.135, 0.008), 0.01); return d; };
  const H = headSDF({ stubble: 0.5, small: 1 }), HT = hatSDF({ tilt: -0.08 }), HS = 0.1;               // head units -> metres
  const sc = (F, s) => (x, y, z) => F(x / s, y / s, z / s) * s;
  const hb = H.bounds.map(v => v * HS); hb[1] = -0.62 * HS * 2;                               // keep the neck short
  const G = {
    torso: mesh(torso, [-0.32, -0.2, -0.2, 0.32, 0.62, 0.22], r, torsoTone),
    upper: mesh(upperArm, [-0.1, -0.33, -0.1, 0.1, 0.1, 0.1], r * 0.8),
    fore: mesh(foreArm, [-0.08, -0.3, -0.08, 0.08, 0.06, 0.08], r * 0.8, foreTone),
    hand: mesh(hand, [-0.07, -0.16, -0.05, 0.08, 0.02, 0.07], r * 0.6),
    thigh: mesh(thigh, [-0.12, -0.5, -0.12, 0.12, 0.13, 0.12], r),
    shin: mesh(shin, [-0.08, -0.47, -0.09, 0.08, 0.06, 0.09], r),
    boot: mesh(boot, [-0.08, -0.12, -0.12, 0.08, 0.12, 0.2], r * 0.7),
    head: mesh(sc(H.f, HS), hb, r * 0.4, (x, y, z) => H.tone(x / HS, y / HS, z / HS)),
    hat: mesh(sc(HT.f, HS), HT.bounds.map(v => v * HS), r * 0.65, (x, y, z) => HT.tone(x / HS, y / HS, z / HS)),
  };
  PARTS = G; return G;
}

// pose: { sp:[x,y,z] spine, hd:[x,y,z] head, ls/rs:[x,y,z] shoulders, le/re elbow bend, lw/rw wrist,
//         lh/rh:[x,z] hips, lk/rk knee bend, y: pelvis drop, lean }
export function figure(M, pose = {}, { tool = null, hat = true } = {}) {
  const G = parts(M), root = new THREE.Group(), J = {};
  const add = (p, geo, mat, pos = [0, 0, 0]) => { const m = new THREE.Mesh(geo, mat); m.position.set(...pos); m.castShadow = true; m.receiveShadow = true; p.add(m); return m; };
  J.hips = new THREE.Group(); J.hips.position.y = 0.98; root.add(J.hips);
  J.spine = new THREE.Group(); J.hips.add(J.spine);
  add(J.spine, G.torso, M.cloth);
  J.neck = new THREE.Group(); J.neck.position.set(0, 0.6, 0.0); J.spine.add(J.neck);
  J.head = new THREE.Group(); J.head.position.set(0, 0.1, 0.02); J.neck.add(J.head);
  add(J.head, G.head, M.skin); if (hat) add(J.head, G.hat, M.hat).castShadow = false;
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'l' : 'r';
    const sh = J[k + 'S'] = new THREE.Group(); sh.position.set(0.2 * s, 0.49, -0.01); J.spine.add(sh);
    add(sh, G.upper, M.cloth);
    const el = J[k + 'E'] = new THREE.Group(); el.position.y = -0.28; sh.add(el);
    add(el, G.fore, M.skin);
    const wr = J[k + 'W'] = new THREE.Group(); wr.position.y = -0.255; el.add(wr);
    const hm = add(wr, G.hand, M.glove); if (s < 0) hm.scale.x = -1;
    const hp = J[k + 'H'] = new THREE.Group(); hp.position.set(0.1 * s, 0.0, 0); J.hips.add(hp);
    add(hp, G.thigh, M.denim);
    const kn = J[k + 'K'] = new THREE.Group(); kn.position.y = -0.44; hp.add(kn);
    add(kn, G.shin, M.denim);
    const an = J[k + 'A'] = new THREE.Group(); an.position.y = -0.43; kn.add(an);
    add(an, G.boot, M.boot, [0, 0.02, 0]);
  }
  if (tool) {
    J.tool = new THREE.Group(); J.tool.position.set(0, -0.09, 0.02); J.rW.add(J.tool);
    const m = add(J.tool, new THREE.CylinderGeometry(0.018, 0.018, tool, 10), M.iron); m.rotation.x = Math.PI / 2; m.position.z = tool * 0.3;
  }
  root.J = J; setPose(root, pose);
  root.traverse(o => { o.frustumCulled = false; });
  return root;
}
export function setPose(f, p) {
  const J = f.J, r3 = (o, v, d = [0, 0, 0]) => { const q = v || d; o.rotation.set(q[0] || 0, q[1] || 0, q[2] || 0); };
  r3(J.spine, p.sp); r3(J.head, p.hd); r3(J.neck, p.nk);
  r3(J.lS, p.ls, [0.05, 0, 0.1]); r3(J.rS, p.rs, [0.05, 0, -0.1]);
  J.lE.rotation.set(-(p.le ?? 0.25), 0, 0); J.rE.rotation.set(-(p.re ?? 0.25), 0, 0);
  r3(J.lW, p.lw); r3(J.rW, p.rw);
  J.lH.rotation.set(-(p.lh?.[0] ?? 0), 0, p.lh?.[1] ?? 0.03); J.rH.rotation.set(-(p.rh?.[0] ?? 0), 0, p.rh?.[1] ?? -0.03);
  J.lK.rotation.x = p.lk ?? 0.05; J.rK.rotation.x = p.rk ?? 0.05;
  J.lA.rotation.x = -(p.la ?? (p.lk ?? 0) - (p.lh?.[0] ?? 0)) * 0.5; J.rA.rotation.x = -(p.ra ?? (p.rk ?? 0) - (p.rh?.[0] ?? 0)) * 0.5;
  J.hips.position.y = 0.98 + (p.y || 0); J.hips.rotation.set(p.lean || 0, p.tw || 0, 0);
  if (J.tool && p.tl) J.tool.rotation.set(...p.tl);
}
export const walk = (ph, a = 1) => { const s = Math.sin(ph);
  return { lh: [0.4 * s * a, 0.03], rh: [-0.4 * s * a, -0.03], lk: 0.1 + 0.55 * Math.max(0, -Math.sin(ph - 0.9)) * a, rk: 0.1 + 0.55 * Math.max(0, Math.sin(ph - 0.9)) * a,
    ls: [-0.35 * s * a, 0, 0.1], rs: [0.35 * s * a, 0, -0.1], le: 0.35, re: 0.35, sp: [0.05, 0.1 * s * a, 0], y: -0.02 * Math.abs(Math.cos(ph)), hd: [0.0, -0.06 * s, 0] }; };

// a crowd figure baked to one geometry with a colour per material tone (for instancing / many copies)
export function bakeFigure(f) {
  f.updateMatrixWorld(true); const list = [];
  f.traverse(o => { if (!o.isMesh) return; let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
    const base = o.material.color, n = g.attributes.position.count, a = new Float32Array(n * 3), c0 = g.attributes.color;
    for (let i = 0; i < n; i++) { const v = c0 ? c0.getX(i) : 1; a[i * 3] = base.r * v; a[i * 3 + 1] = base.g * v; a[i * 3 + 2] = base.b * v; }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3)); list.push(g); });
  return mergeGeometries(list, false);
}
