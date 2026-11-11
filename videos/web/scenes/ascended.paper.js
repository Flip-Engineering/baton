// ASCENDED v1 (cycle R1): the paper. A printed political compass as a real sheet, folded by a kinematic crease model.
//
// Folds: every crease is a hinge line in the sheet's current flat frame. A point past the line wraps round a cylinder
// of radius RHO (the crease's bend) and continues rigidly, so the sheet never tears across a grid cell, the crease
// catches the rake light as a rounded ridge, and a folded flap lies 2*RHO above what it covers (the paper's
// thickness). A pleat is two hinges, the far one a child of the near one bending the other way (the MAD Fold-In: the
// band between them goes, the outer parts meet edge to edge). Stages chain: a finished stage is flat again (layers
// at 0, 2 RHO, 4 RHO) and the next stage folds that.
//
//   stage 1  the compass pleat on the TR-BL diagonal: line 1 is the corner-to-corner diagonal through the centre seal,
//            line 2 is parallel at s = G1. Top left and bottom right meet on the join; TR, BL and the centre go under.
//   flip     the folded sheet turned over about its long crease (a page turned): the back is up.
//   stage 2  the Fold-In on the back: a vertical pleat [XA, XB] closes and the fragments join as FULL / COMMUNISM.
//   plane    a separate sheet: nose (corners to the centre line), keel, wings.
//
// Coordinates: sheet units, compass square u, v in [-1, 1] (v up = compass top). s = n1.q with n1 = (1,-1)/sqrt2
// (TL corner at s = -1.414, BR at +1.414). z = up off the sheet.
import * as THREE from 'three';
export const RHO = 0.0065;             // crease radius (sheet units; 1 unit = 14 cm, so 0.9 mm)
export const S2 = Math.SQRT1_2;
export const G1 = S2;                  // pleat 1: line 1 at s = 0 (corner to corner), line 2 at s = G1
export const XA = -0.12, XB = 0.52;     // pleat 2 hides the band x in [XA, XB] of the flipped sheet
export const X1B = (XA + XB) / 2;      // pleat 2 line 1

// one hinge: p = [x, y, z] in the op's frame given signed distance s (>= 0 inside the region), tangential unchanged.
// arc: the point's own distance along the paper decides where it sits on the bend (only for the op's own region);
// rigid: rotation of (s, z) by the full angle about the hinge axis (points carried by a child op).
function hingeSZ(s, z, ang, rho, arcOK) {
  const sg = ang >= 0 ? 1 : -1, a = Math.abs(ang);
  if (a < 1e-6) return [s, z];
  if (arcOK && s < rho * a) {
    const ph = s / rho, r = rho - sg * z;
    return [r * Math.sin(ph), sg * rho - sg * r * Math.cos(ph)];
  }
  const ca = Math.cos(a), sa = Math.sin(a);
  // P = axis + (rho - sg z)(sin a, -sg cos a) + (s - rho a)(cos a, sg sin a)
  const r = rho - sg * z;
  return [r * sa + (s - rho * a) * ca, sg * rho - sg * r * ca + sg * (s - rho * a) * sa];
}
// apply a hinge with unit normal (nx, ny) and offset c to point P (in place). own = the point belongs to this op
// directly (arc allowed); returns P
// zb: the height the bend is measured from (the top of the stack for an up-fold, 0 for a down-fold), so a folded
// stack bends round its own outside layer
function hinge(P, nx, ny, c, ang, rho, own, zb = 0) {
  const s = P[0] * nx + P[1] * ny - c;
  const [s2, z2] = hingeSZ(s, P[2] - zb, ang, rho, own);
  P[0] += (s2 - s) * nx; P[1] += (s2 - s) * ny; P[2] = z2 + zb;
  return P;
}

// ---------------------------------------------------------------- the compass sheet
// st: { liftTL, liftBR (radians, soft corner curls), p1 (0..1 of pleat 1), flip (0..1), p2 (0..1), flipLift (units) }
export function sheetPoint(u, v, st, P = [0, 0, 0]) {
  P[0] = u; P[1] = v; P[2] = 0;
  const n1x = S2, n1y = -S2;
  const s0 = u * n1x + v * n1y;
  const th1 = Math.PI * st.p1;
  // corner curls (a hand lifting a corner): soft, wide radius
  if (st.liftTL) { const c = 1.414 - 0.42; const sT = -s0 - c; if (sT > 0) hinge(P, -n1x, -n1y, c, st.liftTL, 0.32, true); }
  if (st.liftBR) { const c = 1.414 - 0.42; if (s0 - c > 0) hinge(P, n1x, n1y, c, st.liftBR, 0.32, true); }
  // pleat 1: child (s >= G1) bends down about line 2 by -th1, then the parent (s >= 0) up about line 1 by +th1
  if (th1 > 0) {
    if (s0 >= G1) { hinge(P, n1x, n1y, G1, -th1 * (st.p1c ?? 1), RHO, !(st.liftBR && s0 > 1.414 - 0.42)); hinge(P, n1x, n1y, 0, th1, RHO, false); }
    else if (s0 >= 0) hinge(P, n1x, n1y, 0, th1, RHO, true);
  }
  // the flip: rotate about the line-1 crease (s = 0) at height zc by pi*flip (the TL side rises and goes over)
  if (st.flip > 0) {
    const ph = Math.PI * st.flip, zc = 2 * RHO;
    const s = P[0] * n1x + P[1] * n1y, t = P[0] * S2 + P[1] * S2, z = P[2] - zc;
    const cs = Math.cos(ph), sn = Math.sin(ph);
    const s2 = s * cs + z * sn, z2 = -s * sn + z * cs + zc + (st.flipLift || 0) * sn;
    P[0] = t * S2 + s2 * n1x; P[1] = t * S2 + s2 * n1y; P[2] = z2;
    // (after a full flip, x/y are the stage-2 frame: the TL-half's back lies on the BR half, y <= x)
  }
  if (st.p2 > 0) {
    const th2 = Math.PI * st.p2, x = P[0];
    if (x >= XB) { hinge(P, 1, 0, XB, -th2, RHO, true, 0); hinge(P, 1, 0, X1B, th2, RHO, false, 4 * RHO); }
    else if (x >= X1B) hinge(P, 1, 0, X1B, th2, RHO, true, 4 * RHO);
  }
  return P;
}

// ---------------------------------------------------------------- the plane sheet
export const PA = 0.5, PB = 0.72, PW = 0.14;     // half width, half height, keel-to-wing
// st: { nose 0..1, keel 0..1, wingL 0..1, wingR 0..1 }
export function planePoint(u, v, st, P = [0, 0, 0]) {
  P[0] = u; P[1] = v; P[2] = 0;
  // nose: both top corners onto the top, hinge through (0, PB) at 45 degrees
  const nL = [-S2, S2], cN = PB * S2;
  const inL = u * nL[0] + v * nL[1] - cN >= 0, inR = -u * nL[0] + v * nL[1] - cN >= 0;
  if (st.nose > 0) {
    if (inL) hinge(P, nL[0], nL[1], cN, Math.PI * st.nose, RHO, true);
    else if (inR) hinge(P, -nL[0], nL[1], cN, Math.PI * st.nose, RHO, true);
  }
  // stage frame after the nose: x decides the half; keel folds both halves up about x = 0, wings back down about |x| = PW
  const x = P[0], KA = Math.PI * 0.47 * st.keel, WA = Math.PI * 0.44;
  if (st.keel > 0) {
    const L = x < 0, sx = L ? -1 : 1, ax = Math.abs(x);
    const w = L ? st.wingL : st.wingR;
    if (ax >= PW && w > 0) { hinge(P, sx, 0, PW, -WA * w, RHO, true); hinge(P, sx, 0, 0, KA, RHO * 0.6, false); }
    else hinge(P, sx, 0, 0, KA, RHO * 0.6, true);
  }
  return P;
}

// ---------------------------------------------------------------- a folding grid mesh
export class FoldMesh {
  // fn(u, v, st, P) -> P; domain [u0, u1] x [v0, v1]; nu x nv vertices
  constructor(fn, [u0, u1, v0, v1], nu, nv, front, back) {
    this.fn = fn; this.nu = nu; this.nv = nv;
    const n = nu * nv, pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
    this.U = new Float32Array(n); this.V = new Float32Array(n);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const k = j * nu + i, a = i / (nu - 1), b = j / (nv - 1);
      this.U[k] = u0 + (u1 - u0) * a; this.V[k] = v0 + (v1 - v0) * b; uv[k * 2] = a; uv[k * 2 + 1] = b;
    }
    for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const a = j * nu + i, b = a + 1, c = a + nu, d = c + 1;
      // split along the diagonal that matches the TR-BL folds (keeps the crease clean)
      idx.push(a, b, d, a, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx); this.geo = g;
    this.front = new THREE.Mesh(g, front); this.back = new THREE.Mesh(g, back);
    for (const m of [this.front, this.back]) { m.castShadow = true; m.receiveShadow = true; }
    this.group = new THREE.Group(); this.group.add(this.front, this.back);
    this._P = [0, 0, 0];
  }
  // world = sheet units scaled by k, z up -> world Y; sheet +v -> world -Z
  update(st, k) {
    const pos = this.geo.attributes.position.array, P = this._P;
    for (let i = 0, n = this.U.length; i < n; i++) {
      this.fn(this.U[i], this.V[i], st, P);
      pos[i * 3] = P[0] * k; pos[i * 3 + 1] = P[2] * k; pos[i * 3 + 2] = -P[1] * k;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }
}
