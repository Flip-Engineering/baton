// MECHA PROLETARIAT c20 (15 Oct): the giant's figure. From the yard v11's ERECTOR read as a portal crane: above the hips a flat girder
// deck with masts and lamps, on splayed lattice legs, the bridge buried in an open cage. v1 was crude, but in every shot it read as a
// BODY: a head, shoulders, a chest. This hangs a body's masses on ERECTOR's own joints, in its own steel and red lead, riveted like the
// rest (members.js plateAt), so the lattice and the build stay and the figure comes back:
//   head       a plated housing on a neck collar above the shoulder girder; the glazed bridge (the crew's cab) is its face, under a
//              dark brow hood, over a chin plate. The cab moves up here from the cage (ERECTOR's own cab glass and box are hidden),
//              so the five crew silhouettes and the lit glass are where a face is.
//   chest      a breastplate in three lapped courses, faceted to a centre ridge, over the cage's front: a chest volume; the mark plate
//              (No. 1) moves to its centre, under the head, so the brownout's two lights are one face.
//   shoulders  a plated housing over each end of the girder and its bearing: broad shoulders, not a deck. Its top is low enough that the
//              sledge's haft still rests on it.
//   the deck   the girder's lamp masts, aviation mast and davit are taken down (the vertices above the walkway rails are folded flat):
//              they were what made the top read as a gantry.
// Variants for the silhouette stills: 'A' (all of it), 'B' (head + shoulders, no breastplate), 'C' (taller head, narrower shoulders).
import * as THREE from 'three';
import { V3, cbox, plateAt } from '../lib/fx/modeling/erect/members.js';

const lerp = (a, b, t) => a + (b - a) * t;

export function hull(E, { variant = 'A' } = {}) {
  const C5 = E.C5;
  // ---- the old cab: hide ERECTOR's own glass and lit box (the breastplate closes the portal in front of them)
  const chestB = E.batches.find(b => b.seg === 'chest' && b.meshes);
  if (chestB) for (const k of ['glass', 'cab']) if (chestB.meshes[k]) chestB.meshes[k].visible = false;
  // ---- the deck: fold the masts, lamps, aviation mast and davit down to the rail tops
  const beamB = E.batches.find(b => b.seg === 'beam' && b.meshes), TOP = 15 + 3.4, CUT = TOP + .35;
  if (beamB) for (const m of Object.values(beamB.meshes)) { const p = m.geometry.attributes.position; let ch = 0;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > CUT) { p.setY(i, CUT); ch++; }
    if (ch) { p.needsUpdate = true; m.geometry.computeBoundingSphere(); } }
  const tall = variant === 'C';
  const B = E.batch('chest'); B.defPaint = 9;
  const RL = 9, DARK = .9;                 // paint: 9 = left in red lead; < 1 = painted (black iron) at that build time
  // ---------------- the breastplate (chest frame: the cage runs y 0..14, 10 x 8 at the foot to 18 x 10 at the top)
  const zF = y => lerp(4, 5, y / 14) + .35, wC = y => lerp(10, 18, y / 14);
  if (variant !== 'B') {
    const courses = [[4.2, 7.8, .70], [7.4, 11.0, .72], [10.6, 14.6, .74]];
    courses.forEach(([y0, y1, thr], k) => { const ym = (y0 + y1) / 2, w = wC(ym) * .5 - .15, out = k * .16;
      for (const s of [-1, 1]) { const face = V3(s * Math.sin(.2), .06, Math.cos(.2)).normalize();
        plateAt(B, V3(s * (w / 2 + .05), ym, zF(ym) + .55 + out - Math.sin(.2) * w / 2 * .5), face, V3(0, 1, 0), w + .3, y1 - y0, { t: .32, c: .1, thr, paint: RL, wear: .5 }); } });
    // a ridge bar down the centre and a collar band under the neck
    B.push('plate', cbox(.9, 10.4, .5, .12), new THREE.Matrix4().makeTranslation(0, 9.4, zF(9.4) + .95), { thr: .75, paint: DARK, wear: .8 });
    B.push('plate', cbox(wC(14) * .78, 1.0, 1.2, .2), new THREE.Matrix4().makeTranslation(0, 14.5, zF(14) + .45), { thr: .76, paint: DARK, wear: .7 });
    // flank plates on the cage's upper sides (the ribs' volume seen from three-quarters)
    for (const s of [-1, 1]) plateAt(B, V3(s * (wC(10.5) / 2 + .35), 10.5, .3), V3(s, 0, .15), V3(0, 1, 0), 8.6, 7.4, { t: .3, c: .1, thr: .74, paint: RL, wear: .45 });
    E.markAt.p.set(0, 12.0, zF(12) + 1.2); E.markAt.w = 3.6;
  } else E.markAt.p.set(-6.1, 12.1, 5.78);
  // ---------------- the neck collar and the head
  const hW = tall ? 7.8 : 8.6, hH = tall ? 7.0 : 6.0, hD = 7.4, zc = .6, y0 = TOP + 1.4;   // floor at y0
  B.push('plate', cbox(6.2, 1.5, 5.8, .3), new THREE.Matrix4().makeTranslation(0, TOP + .75, zc - .2), { thr: .82, paint: DARK, wear: .6 });
  for (const s of [-1, 1]) B.push('mill', cbox(.6, 1.2, 4.6, .1), new THREE.Matrix4().makeTranslation(s * 3.4, TOP + .7, zc - .2), { thr: .82, wear: .9, noLift: true });
  const fz = zc + hD / 2, wy0 = y0 + .8, wy1 = y0 + (tall ? 3.8 : 3.4), wyc = (wy0 + wy1) / 2, wh = wy1 - wy0;
  plateAt(B, V3(0, y0, zc), V3(0, 1, 0), V3(0, 0, -1), hW, hD, { t: .4, c: .12, thr: .84, paint: RL, wear: .5 });                       // floor
  plateAt(B, V3(0, y0 + hH / 2, zc - hD / 2), V3(0, 0, -1), V3(0, 1, 0), hW, hH, { t: .35, c: .12, thr: .85, paint: RL, wear: .45 });   // back
  for (const s of [-1, 1]) plateAt(B, V3(s * hW / 2, y0 + hH / 2, zc), V3(s, 0, 0), V3(0, 1, 0), hD, hH, { t: .35, c: .14, thr: .85, paint: RL, wear: .5 });
  // the roof: a low crown in two lapped plates, a hatch with its coaming
  for (const s of [-1, 1]) plateAt(B, V3(s * hW / 4, y0 + hH + .25, zc), V3(-s * .22, 1, 0), V3(0, 0, -1), hW / 2 + .3, hD + .3, { t: .35, c: .12, thr: .87, paint: RL, wear: .5 });
  B.push('plate', cbox(2.2, .5, 2.2, .1), new THREE.Matrix4().makeTranslation(0, y0 + hH + .75, zc - 1.2), { thr: .9, paint: DARK, wear: .7 });
  // the face: chin plate under the glass, cheek posts either side, the glass raked out at the top, mullions, the brow hood over it
  plateAt(B, V3(0, (y0 + wy0) / 2, fz), V3(0, -.25, 1), V3(0, 1, 0), hW, wy0 - y0 + .2, { t: .4, c: .12, thr: .86, paint: DARK, wear: .6 });
  for (const s of [-1, 1]) plateAt(B, V3(s * (hW / 2 - .35), wyc, fz + .05), V3(s * .3, 0, 1), V3(0, 1, 0), .9, wh + .2, { t: .4, c: .1, thr: .86, paint: DARK, wear: .6 });
  plateAt(B, V3(0, (wy1 + y0 + hH) / 2, fz), V3(0, 0, 1), V3(0, 1, 0), hW, y0 + hH - wy1, { t: .4, c: .12, thr: .86, paint: RL, wear: .5 });   // forehead
  const rake = -.2, gm = new THREE.Matrix4().makeTranslation(0, wyc, fz - .1).multiply(new THREE.Matrix4().makeRotationX(rake));
  B.push('glass', cbox(hW - 1.4, wh, .08, .01), gm, { thr: .88, edge: false, noLift: true });
  for (let k = 1; k < 5; k++) B.push('plate', cbox(.2, wh, .26, .03), gm.clone().multiply(new THREE.Matrix4().makeTranslation(lerp(-(hW - 1.4) / 2, (hW - 1.4) / 2, k / 5), 0, .1)), { thr: .88, paint: DARK, wear: .4, noLift: true });
  B.push('plate', cbox(hW + .2, .26, .3, .05), gm.clone().multiply(new THREE.Matrix4().makeTranslation(0, -wh / 2, .14)), { thr: .88, paint: DARK, noLift: true });   // the sill
  // the brow: a sun hood over the glass, projecting, dark (it shades the glass: the face's brow)
  { const hood = new THREE.Matrix4().makeTranslation(0, wy1 + .25, fz + .8).multiply(new THREE.Matrix4().makeRotationX(.28));
    B.push('plate', cbox(hW + .6, .35, 2.0, .1), hood, { thr: .89, paint: DARK, wear: .7 });
    for (const s of [-1, 1]) B.push('plate', cbox(.3, 1.0, 1.8, .06), new THREE.Matrix4().makeTranslation(s * (hW / 2 + .15), wy1 - .1, fz + .7), { thr: .89, paint: DARK, wear: .7 }); }
  // inside: the lit back wall and ceiling (ERECTOR's cab material: the scene drives its glow)
  B.push('cab', cbox(hW - .8, hH - .8, .1, .02), new THREE.Matrix4().makeTranslation(0, y0 + hH / 2, zc - hD / 2 + .4), { thr: .86, edge: false, noLift: true });
  B.push('cab', cbox(hW - .8, .1, hD - 1.6, .02), new THREE.Matrix4().makeTranslation(0, y0 + hH - .5, zc), { thr: .86, edge: false, noLift: true });
  // ---------------- the shoulders: a housing over each girder end and its bearing, its top sloped off outboard
  const sw = tall ? 5.6 : 6.8, sd = 9.4, sy0 = 14.3, sy1 = TOP + .25, sx = 13.9;
  for (const s of [-1, 1]) {
    const cx = s * sx, h = sy1 - sy0, yc = (sy0 + sy1) / 2;
    plateAt(B, V3(cx + s * .4, sy1 + .1, 0), V3(s * .32, 1, 0), V3(0, 0, -1), sw + .6, sd, { t: .4, c: .14, thr: .8, paint: RL, wear: .55 });               // top
    plateAt(B, V3(cx + s * sw / 2, yc - .2, 0), V3(s, -.12, 0), V3(0, 1, 0), sd, h + .6, { t: .4, c: .14, thr: .79, paint: RL, wear: .5 });            // outboard
    for (const q of [-1, 1]) plateAt(B, V3(cx, yc, q * sd / 2), V3(0, 0, q), V3(0, 1, 0), sw, h, { t: .35, c: .12, thr: .79, paint: RL, wear: .5 });   // front, back
    B.push('plate', cbox(sw + .4, .6, sd + .3, .12), new THREE.Matrix4().makeTranslation(cx, sy0 - .1, 0), { thr: .79, paint: DARK, wear: .8 });      // the skirt's edge band
  }
  // ---------------- done: hang it on the chest, move the cab and the mark
  E.finish(B, 'chest', 'hull');
  E.cabFront = V3(0, wyc, fz);
  if (E.markMesh) E.markMesh.position.copy(E.markAt.p);
  E.setBuild(E.build ?? 1);
  return { headTop: y0 + hH + .5, cab: E.cabFront.clone() };
}
