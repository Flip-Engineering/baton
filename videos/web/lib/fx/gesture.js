// GESTURE: authored arm gestures and the raised-arm safety measure (HUMAN studio, cycle 2).
//
// Why: a raised arm is typed as Euler numbers nowhere any more. A number that meant "near vertical" rendered as a
// straight arm 45 degrees forward after the retarget, the shoulder lift and a long lens, and at feed size a crowd of
// those reads as a mass straight-arm salute. The Rot Front fist is defined by a CLOSED FIST and a BENT or VERTICAL
// arm (RFB, 1924-26; Heartfield and Klutsis draw the fist oversized, front-on), so a gesture here is a glyph with
// tolerances: an upper-arm direction and a forearm direction in the BODY frame (x = out to the arm's own side,
// y = world up, z = the way the person faces), solved onto the rig (people.js, hero.js), then MEASURED from the
// posed joints and on screen.
//
//   import { GESTURES, gestureDirs, solveTwoBone, measureArm, SAFETY } from './gesture.js';
//   folk.set(id, { gesture: { name: 'ROTFRONT', side: -1 } });        // people.js (side -1 = right arm, 1 = left, 2 = both)
//   hero.gesture('R', 'OVERHEAD');                                      // hero.js
//   folk.gestures(camera, W, H) / hero.gestures(camera, W, H)          // -> [{ id, side, name, interior, elev, faDev, ahead, fistPx, flags[] }]
//
// Gestures (dirs are unit-ish, x signed by the arm's side; p = pump 0..1 where it applies):
//   ROTFRONT       elbow out at shoulder height, forearm vertical, fist beside the temple
//   OVERHEAD       upper arm near vertical, elbow bent ~30 degrees, fist above the crown
//   PUMP           the upper arm is FIXED (48 degrees up, out to the side); only the elbow moves, flex 55..100 degrees,
//                  the fist travels up and down beside the head. It never swings forward.
//   CLIMB_REACH    the arm straight up (a reach to a bar; vertical, so it is not a salute)
//   BANNER_TOP     top hand on a pole at the brow (target mode; carries a prop)
//   BANNER_LOW     lower hand on the pole at the chest (target mode; carries a prop)
//   SHOULDER_TOOL  hand at the chest, the handle rising over the shoulder and the head behind it (target mode; prop)
//   HANG           arm down (no IK; the act's own arm)
// The SHOUT is a body gesture (chest up, head back 10 degrees, mouth open) with ROTFRONT on one arm; see people.js.

export const GESTURES = {
  ROTFRONT: { ua: [0.86, 0.12, 0.42], fa: [-0.12, 1, 0.02], fist: true },
  OVERHEAD: { ua: [0.2, 0.975, 0.1], fa: [-0.35, 0.94, 0.05], fist: true },
  PUMP: { ua: [0.62, 0.72, 0.2], fa: p => { const b = (55 - 40 * p) * Math.PI / 180; return [-Math.sin(b), Math.cos(b), 0.06]; }, fist: true },
  CLIMB_REACH: { ua: [0.1, 1, 0.06], fa: [0.04, 1, 0.08], fist: false },
  BANNER_TOP: { target: [0.1, 1.64, 0.3], pole: [1, -0.4, -0.3], prop: true },
  BANNER_LOW: { target: [-0.02, 1.2, 0.3], pole: [1, -0.6, -0.4], prop: true },
  SHOULDER_TOOL: { target: [0.12, 1.28, 0.2], pole: [0.8, -1, -0.2], prop: true },
};
// what the measure looks for to point a person at a frame (HUMAN cycle 2, change A). Corrected 28 Sep (client): there is
// no gesture ban. A straight raised arm reads differently from a bent fist, so the frames that have one are found for a
// person to look at; these are detection settings, not a test of the pose.
export const POINTERS = { straight: 150, elevLo: 10, elevHi: 75, faDev: 30, ahead: 0.12 };
export const SAFETY = POINTERS;          // the old name (comments in art/furnace.js and art/fist_sdf.js still use it)

const nrm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const deg = r => r * 180 / Math.PI;

// body-frame unit directions { u, f } (upper arm, forearm) of a gesture for an arm on side s (+1 left = +x, -1 right)
export function gestureDirs(name, s, p = 0.5) {
  const G = GESTURES[name]; if (!G || !G.ua) return null;
  const fa = typeof G.fa === 'function' ? G.fa(p) : G.fa;
  return { u: nrm([s * G.ua[0], G.ua[1], G.ua[2]]), f: nrm([s * fa[0], fa[1], fa[2]]) };
}
// two-bone IK: shoulder S, lengths L1, L2, wrist target T, pole hint (a direction the elbow bends toward).
// Returns { u, f } unit directions (upper arm, forearm), all plain [x,y,z] arrays in one frame.
export function solveTwoBone(S, L1, L2, T, pole) {
  let d = sub(T, S), D = Math.hypot(...d); const a = nrm(d);
  D = Math.min(Math.max(D, Math.abs(L1 - L2) + 1e-4), L1 + L2 - 1e-4);
  const cosA = (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  let pp = sub(pole, a.map(x => x * dot(pole, a))); if (Math.hypot(...pp) < 1e-5) pp = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const pn = nrm(pp), E = [S[0] + L1 * (cosA * a[0] + sinA * pn[0]), S[1] + L1 * (cosA * a[1] + sinA * pn[1]), S[2] + L1 * (cosA * a[2] + sinA * pn[2])];
  const Tc = [S[0] + a[0] * D, S[1] + a[1] * D, S[2] + a[2] * D];
  return { u: nrm(sub(E, S)), f: nrm(sub(Tc, E)), E };
}
// body-frame directions for any gesture, given the shoulder position in the body frame (target-mode gestures need it)
export function gestureSolve(name, s, { p = 0.5, shoulder = [s * 0.185, 1.46, -0.02], L1 = 0.287, L2 = 0.257, scale = 1 } = {}) {
  const G = GESTURES[name]; if (!G) return null;
  if (G.ua) return gestureDirs(name, s, p);
  const T = [s * G.target[0] * scale, G.target[1] * scale, G.target[2] * scale], pole = [s * G.pole[0], G.pole[1], G.pole[2]];
  return solveTwoBone(shoulder, L1 * scale, L2 * scale, T, pole);
}

// The measure. World-space joints (THREE.Vector3 or arrays): S shoulder, E elbow, Wr wrist, head; fwd = the person's
// facing (unit, horizontal); proj(p) -> [x, y] px; pxPerM(p) -> px per metre at p; fistM = the fist's size in metres.
// A hand counts as raised when the wrist is above the shoulder and the upper arm is not hanging (elevation above -10
// degrees, or the wrist above the head). Pointers (corrected 28 Sep, client: there is no gesture ban; each one only asks a
// person to look at the frame and judge how it reads, never a fail; see gate.py):
//   SALUTE_STRAIGHT  a straight arm raised forward (not out to the side, which reads as a Y)
//   SALUTE_FOREARM   a forearm leaning forward on screen with the hand ahead of the head (no prop)
// The returned angles and sizes are the measure's own working, kept for the lab readouts.
export function measureArm({ S, E, Wr, head, fwd, prop = false }, proj, pxPerM, fistM = 0.1) {
  const UPV = [0, 1, 0];
  const A = v => Array.isArray(v) ? v : [v.x, v.y, v.z];
  const s = A(S), e = A(E), w = A(Wr), h = A(head), fw = A(fwd);
  if (w[1] <= s[1] + 0.02) return null;
  const u = nrm(sub(e, s)), f = nrm(sub(w, e));
  const interior = 180 - deg(Math.acos(Math.max(-1, Math.min(1, dot(u, f)))));
  const elev = deg(Math.asin(Math.max(-1, Math.min(1, u[1]))));
  if (elev < -10 && w[1] < h[1]) return null;                  // a hand at the face or the chest (the upper arm hangs): not a raised arm
  const pe = proj(e), pw = proj(w), dx = pw[0] - pe[0], dy = pw[1] - pe[1];
  const faDev = Math.hypot(dx, dy) < 0.5 ? 0 : deg(Math.acos(Math.max(-1, Math.min(1, -dy / Math.hypot(dx, dy)))));
  const ahead = dot(sub(w, h), fw);
  const uf = dot(u, fw), uy = u[1], lat = Math.hypot(u[0] - uf * fw[0] - uy * UPV[0], u[1] - uf * fw[1] - uy, u[2] - uf * fw[2] - uy * UPV[2]);
  const forward = uf > 0.5 * lat;
  const fistPx = fistM * pxPerM(w);
  const flags = [];
  if (interior > SAFETY.straight && elev >= SAFETY.elevLo && elev <= SAFETY.elevHi && forward) flags.push('SALUTE_STRAIGHT');
  if (!prop && faDev > SAFETY.faDev && ahead > SAFETY.ahead) flags.push('SALUTE_FOREARM');
  return { forward: +(uf / Math.max(1e-3, lat)).toFixed(2), interior: +interior.toFixed(1), elev: +elev.toFixed(1), faDev: +faDev.toFixed(1), ahead: +ahead.toFixed(3), fistPx: +fistPx.toFixed(1), hand: pw.map(v => Math.round(v)), elbow: pe.map(v => Math.round(v)), flags };
}

// ---- the audit registry: every People (and any Hero told to watch a camera) registers here, so a renderer can ask
// for the gesture and crotch flags of whatever the scene drew, without the scene doing anything. render.mjs calls
// window.peopleAudit(t) after every frame and saves window.peopleFlags to out/.<scene>.people.json; gate.py reads it.
const G_ = typeof globalThis !== 'undefined' ? globalThis : {};
export function registerAudit(obj) { (G_.__peopleReg ||= new Set()).add(obj); if (!G_.peopleAudit) G_.peopleAudit = audit; }
function audit(t, W = 1080, H = 1920) {
  const rep = G_.peopleFlags ||= { version: 1, frames: 0, raised: 0, flagged: 0, hazards: 0, flags: [], samples: [], counts: {} };
  rep.frames++;
  for (const o of G_.__peopleReg || []) {
    if (!o._auditCam) continue;
    let gs = [], hz = [];
    try { gs = o.gestures(o._auditCam, W, H) || []; hz = o.hazards ? o.hazards(o._auditCam, W, H) : []; } catch (e) { rep.error = String(e.message); continue; }
    rep.raised += gs.length;
    for (const g of gs) {
      if (g.flags.length) { rep.flagged++; for (const f of g.flags) rep.counts[f] = (rep.counts[f] || 0) + 1; if (rep.flags.length < 400) rep.flags.push({ t: +(+t).toFixed(3), ...g }); }
      else if (rep.samples.length < 60 && (rep.samples.length < 12 || rep.raised % 37 === 0)) rep.samples.push({ t: +(+t).toFixed(3), ...g });
      if ((rep.all ||= []).length < 400) rep.all.push({ t: +(+t).toFixed(3), name: g.name, hand: g.hand, elbow: g.elbow, interior: g.interior, elev: g.elev, faDev: g.faDev, fistPx: g.fistPx, flags: g.flags });
    }
    if (hz.length) { rep.hazards += hz.length; rep.counts.CROTCH = (rep.counts.CROTCH || 0) + hz.length; if (rep.flags.length < 400) for (const h of hz.slice(0, 4)) rep.flags.push({ t: +(+t).toFixed(3), flags: ['CROTCH'], ...h }); }
  }
  return rep;
}
