// THE GRAVEDIGGERS: the plan (pure: no DOM, no renderer; the scene, the node checks and tools/gravediggers_calls.mjs all read it).
// The timeline, the graveyard's layout, the data (the stone heights from the JSON), the cues and
// every camera, as functions of t. research/october/GRAVEDIGGERS_brief.md is the spec.
//
// The ground plan (metres; north is -z, east +x, grade y = 0). The open grave (0.95 x 2.2, 1.8 deep) lies at the origin, its head end
// north. North of it the two columns of 48 stones (1979 at the far end, 2026 nearest the grave), 0.42 m apart: the U.S. at x = XU,
// Canada 2.5 m west of it. Each stone is a slab 0.28 m wide (along z) and 0.1 m thick (along x), its face (and the year cut in it) to
// the west, to the moon; its moon shadow is a zero-based bar east of it, 1 / tan 18 deg = 3.078 times its height. Each column's
// trench runs along the moon-side feet of its stones (0.6 m wide, 0.15 m clear of the stones), cut as one pit per digger at every
// second stone; the U.S. trench reaches the grave's head wall through a short link (its west half: the man stands on the east half),
// and Canada's comes round to it south of its 2026 stone. The spoil goes on a bank west of the Canada column.
import * as THREE from 'three';

// v2 (c20, 15 Oct): 58.5 s. The grave floor holds both opening lines (3.75 s each); the climb out of the grave; the graveyard by moonlight
// (12.5 s: the walk in, the dig apart, the call, the walls breaking); the trench (7.5 s: THE VERY FOUNDATION gets its room); the break and
// the strike that moves the ground; the plant comes up slowly (7.5 s) and is lit (5 s); frame 0 again, lit; he turns and fills; the sign
// and two spits; the filled grave breathes before the mark.
export const TL = { open: 0, gd: 3.75, climb: 7.5, yard: 10.0, enter: 11.25, join: 15.0, cuts: 17.5, close: 20.0, brk: 27.5, wide: 27.5, rise: 32.5,
  lit: 37.5, fall: 42.5, ineq: 46.25, turn: 47.5, sign: 50.0, land: 51.25, land2: 53.75, mark: 55.0, end: 58.5 };
// v3 (c21, 15 Oct): THE CUT. The client: "pacing is terrible" and v2 "thrown away a lot of content from its v1". TL above is the world's
// clock (scene time ts: the walk in, the bites, the joins, the plant, the spits are all solved on it); the film is cut from it. Output
// time t maps to ts = t + off per segment; every offset is a whole number of bars (2.5 s), so the bites stay on the score's downbeats
// across the cuts. What goes: v2's 7.5 s static floor (5 s now, from the woman's throw), the climb's grey sky (7.7-8.7), the yard's
// first and last bars, the trench's empty bar, the wide's grey 5 s before the plant (27.5-32.5), the descent into grey earth (41.3-42.4)
// and the floor's first bar lit. What comes back from v1: the shot straight up out of the grave (v1 5.0-7.5, the overhead's launch),
// landing on v2's crane over the stones; v1's pace (37.5 s to the mark, v1 36.25, v2 55); the plant up in one move under two strikes.
//   0-5      the floor (ts 2.5-7.5): both lines, the woman's spade and clods over the mouth
//   5-7.5    straight up out of the grave, tilting north as it climbs (ts 10-12.5; the walk in already on the move in the west)
//   7.5-12.5 the yard from the crane, settling lower (ts 12.5-17.5): the crowd in, the call at 10.0, the walls break
//   12.5-17.5 the trench (ts 20-25); 17.5-22.5 the wide, the plant up under the strikes at 17.5 and 20 (ts 32.5-37.5); lit 22.5-26.25
//   26.25    the floor lit (ts 43.75): ITS FALL; INEVITABLE 29.0; he turns 30.0; the sign 32.5; spits 33.75, 36.25; the mark 37.5
export const V3T = { gd: 2.5, rocket: 5.0, yard: 7.5, call: 10.0, close: 12.5, wide: 17.5, lit: 22.5, fall: 26.25, ineq: 29.0, turn: 30.0,
  sign: 32.5, land: 33.75, land2: 36.25, mark: 37.5 };
export const CUT = [[0, 5.0, 2.5, null], [5.0, 7.5, 5.0, 'rocket'], [7.5, 12.5, 5.0, 'yard3'], [12.5, 17.5, 7.5, null],
  [17.5, 26.25, 15.0, null], [26.25, 1e9, 17.5, null]];
export const cutAt = t => CUT.find(c => t < c[1]) || CUT[CUT.length - 1];
// the take (scenes/gravediggers_a.html, _b.html set window.GD_TAKE before the scene loads): the graveyard's camera
//   a  a slow track at eye height down the rows toward the grave, from the 1979 end, the moon on the stones' cut faces
//   b  out of the grave's mouth on a crane that turns from the sky to the yard and rises until the whole yard lies under the moon
export const TAKE = (typeof window !== 'undefined' && window.GD_TAKE) || 'a';
export const BAR = 2.5, Q4 = 0.625, S16 = 0.15625, REACT = 0.16;          // the groove at 96 BPM from 0: a bar (one dig cycle), a beat, a 16th
// the crowd's calls: 0.16 s before each downbeat from the join to the break (explicit: callTimes adds 1.5 % a call and the bites would
// leave the kick); the break's call is answered with no spread (each digger's own reaction solved out: tools in the crew module)
export const CALLS = [14.84, 17.34, 19.84, 22.34, 24.84, 27.34];
// after the break the whole crew strikes together on into the rise (their bites lift the plant): unanswered by the earth (the ground moves
// as one now), answered by the plant
export const STRIKES = [29.84, 32.34, 34.84];
export const D2R = Math.PI / 180, MOON_EL = 18 * D2R;
export const MOON_DIR = [-Math.cos(MOON_EL), Math.sin(MOON_EL), 0];      // toward the moon: low in the west
export const SHADOW_K = 1 / Math.tan(MOON_EL);                            // 3.078: a stone's shadow per metre of its height

// ------------------------------------------------------------------ the ground plan
export const GRAVE = { x: 0, z: 0, w: 0.95, l: 2.2, floor: -1.8 };
export const COL = { XU: 0.15, XC: 0.15 - 2.5, z26: -2.55, pitch: 0.42, w: 0.28, t: 0.1, n: 48, y0: 1979 };
export const stoneZ = k => COL.z26 - (COL.n - 1 - k) * COL.pitch;      // k = 0 (1979) .. 47 (2026)
export const TRENCH = { w: 0.6, off: 0.5, floor: -0.9, pitLen: 0.6 };   // the trench's centre is `off` west of its stones
export const trenchX = X => X - TRENCH.off;
export const LEDGER = { z0: COL.z26 - 47 * COL.pitch - 0.3, d: 0.42 };  // the flat ledger north of the 1979 stones (its south edge, depth)
export const BERM_X = -5.45;                                             // the spoil bank, west of the Canada column (its toe clear of their feet)
// the link cuts (rects: [cx, cz, w (x), l (z)]): the U.S. trench to the grave's head wall, Canada's south of its 2026 stone and across
export const LINKS = (() => { const z1 = COL.z26 + TRENCH.pitLen / 2 + 0.24, zg = -GRAVE.l / 2 - 0.24, xu = trenchX(COL.XU), xc = trenchX(COL.XC), w = TRENCH.w;
  const US = [xu, (z1 + zg) / 2, w, zg - z1], CS = [xc, (z1 + zg) / 2, w, zg - z1];
  const x0 = xc + w / 2 + 0.24, x1 = xu - w / 2 - 0.24, X = [(x0 + x1) / 2, z1 + 0.3, x1 - x0, 0.6];
  return { US, CS, X }; })();
// the rim crew (frame 0): the bearded man at the head end (leaning on his spade; from 32.5 he turns to the grave's spoil and fills),
// the woman in hi-vis on the west rim (her rim cut, a notch at the edge), two kneeling on the west rim, the one with the cup at the foot
export const RIM = {
  man: { lean: [0.17, -1.52, 0], dig: [0.45, -1.45, 1.3] },                // [x, z, heading] (heading 0 faces +z, south)
  // (each placed so its head is over the mouth from the floor: a point is seen only where its line to the lens crosses grade inside it)
  // (the woman north of the middle: from the floor her head, her notch and her clods' arc stay in the sky between his face and the band;
  // the crouching worker and the kneeling one south of her, under the band, each spade planted on its north side clear of the next)
  woman: { base: [-1.04, -0.3, Math.PI / 2], cut: 0.47, notch: [-GRAVE.w / 2 - 0.1, -0.3, 0.2, 0.5], notchFloor: -0.32 },
  kneel: [-0.84, 1.16, Math.PI / 2], crouch: [-0.85, 0.62, Math.PI / 2 - 0.2], cup: [0.12, 1.46, Math.PI],
  sign: [0.02, GRAVE.floor, 0.04, 0.6, 0.4],                               // [x, y, z, w, l]: where the lens lay, face up
};

// ------------------------------------------------------------------ the data: stones, shadows, the band's strings (from the JSON)
export function data(manemp, canada) {
  const stones = [];
  for (const [country, J, X] of [['us', manemp, COL.XU], ['ca', canada, COL.XC]]) for (let k = 0; k < COL.n; k++) {
    const year = COL.y0 + k, mean = J.annual[String(year)]; if (mean == null) throw new Error(`gravediggers: no ${country} mean for ${year}`);
    const peak = Math.max(...Object.entries(J.annual).filter(([y]) => +y >= COL.y0 && +y < COL.y0 + COL.n).map(([, v]) => v));
    const h = 0.35 + 1.15 * Math.pow(mean / peak, 2.5);                     // v2: a stone, not a bar: each country against its own best year
    stones.push({ country, year, k, mean, h, x: X, z: stoneZ(k), shadow: h * SHADOW_K });
  }
  return { stones };
}

// ------------------------------------------------------------------ the words (verbatim; research/sources/texts/marx-manifesto-ch1.txt:125)
// cueType's y is the first line's baseline; a band's box runs from y - 0.984 size to the last baseline + 0.16 size (kept inside
// SAFE_BAND: box top >= 270, last baseline <= 1250, x 60-960: cueType centres them on SAFE_BAND.cx, 510, and a box stays <= 900). Frame 0 again (30.0) sets its words where frame 0 set them: 1032, 78, then 1060, 112
export function cues(D) {           // v3: in output time (the cut), not the world's
  return [
    [-0.3, V3T.gd, ['WHAT THE BOURGEOISIE', 'THEREFORE PRODUCES,', 'ABOVE ALL,'], 1032, 78, 'main'],
    [V3T.gd, V3T.rocket + 0.5, ['ARE ITS OWN', 'GRAVE-DIGGERS.'], 1060, 112, 'red'],
    [V3T.rocket + 1.9, V3T.call, ['THE DEVELOPMENT OF', 'MODERN INDUSTRY,', 'THEREFORE,'], 341, 72, 'main'],
    [V3T.call, V3T.close, ['CUTS FROM UNDER', 'ITS FEET'], 341, 84, 'main'],
    [V3T.close + 0.1, V3T.wide - 0.2, ['THE VERY FOUNDATION', 'ON WHICH THE BOURGEOISIE', 'PRODUCES AND APPROPRIATES', 'PRODUCTS.'], 341, 72, 'main'],
    [V3T.fall + 0.2, V3T.ineq, ['ITS FALL', 'AND THE VICTORY OF', 'THE PROLETARIAT'], 1032, 78, 'red'],
    [V3T.ineq, V3T.sign, ['ARE EQUALLY', 'INEVITABLE.'], 1060, 112, 'red'],
  ];
}
// the subs: [from, to, line, y, size, x] (the attribution only)
export const SUBS = [
  [V3T.ineq, V3T.sign, 'MARX AND ENGELS · MANIFESTO OF THE COMMUNIST PARTY · 1848', 1720, 32, 540],
];

// ------------------------------------------------------------------ the shots and the camera, pure in t
export function shotAt(t) {
  if (t < TL.climb) return 'grave'; if (t < TL.yard) return 'climb'; if (t < TL.close) return TAKE === 'b' ? 'climb' : 'yard';
  if (t < TL.wide) return 'close'; if (t < TL.fall) return 'wide';
  if (t < TL.sign) return 'grave'; if (t < TL.mark) return 'reverse'; return 'mark';
}
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, u) => a + (b - a) * u, L3 = (a, b, u) => a.map((v, i) => lerp(v, b[i], u));
const eio = u => { u = clamp(u); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
const eout = u => 1 - Math.pow(1 - clamp(u), 3);
const ss = u => { u = clamp(u); return u * u * (3 - 2 * u); };
// the grave floor: 0.25 m above the floor, straight up, the head end at the top. The brief's mouth (67 % of the width, 85 % of the
// height) needs the lens 1.8 m under it at 70 deg; at 0.25 m over a 1.8 m floor (1.55 m) the same mouth takes 79 deg
export const GRAVE_CAM = { p: [0, GRAVE.floor + 0.25, 0], fov: 79 };
// a view by yaw (0 north, pi/2 east, pi south) and pitch: frame 0 is yaw pi, pitch 90 deg (looking up, the head end, north, at the top);
// lowering the pitch tilts it toward the foot end and turning the yaw brings it round, upright all the way (up = d dir / d pitch)
function aim(p, yaw, pitch) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
  return { l: [p[0] + sy * cp * 10, p[1] + sp * 10, p[2] - cy * cp * 10], up: [-sy * sp, cp, cy * sp] };
}
// the climb out (7.5-10.0, and in take b on through the yard to the close): up out of the mouth, the sky turning to the yard
export const CLIMB = {
  a: { p: [0.35, 1.75, 1.5], yaw: 2 * Math.PI, pitch: -0.07, fov: 56 },              // just over the foot end, the rows ahead to the north
  b: { p: [-0.9, 6.2, 6.2], yaw: 2 * Math.PI + 0.02, pitch: -0.36, fov: 54 },          // 6.2 m up behind the foot end, the yard under the moon
  b2: { p: [-1.1, 11, 9], yaw: 2 * Math.PI + 0.02, pitch: -0.5, fov: 46 },              // 20.0: risen and drawn back, the whole yard and the field beyond
};
// take a's track: at eye height on the open ground west of the Canada column, from the 1979 end toward the grave, looking south-east
// along the rows (the moon on the stones' cut faces from behind the lens's right; the walk in crosses the lens)
export const TRACK = { x: -8.1, y: 1.25, z0: -24.5, z1: -8.0, look: [4.4, -0.5, 6.2], fov: 44 };
export const CLOSE_CAM = { p: [trenchX(COL.XU) - 0.06, -0.86 + 0.88, COL.z26 + 1.0], fov: 62 };
// v4 (c22, 16 Oct): THE HOOK. Frame 0 was the lens flat on the grave floor looking straight up: the standing man seen from his feet, upside down,
// a grey sky (the studio, 16 Oct: "hard to read as a hook on a phone"). Now the lens is low in the grave's south end and looks north and up the
// slot of its walls at the man leaning on his spade on the head end's lip: he stands upright, whole, against the sky, the eyes down the lens.
// It drifts up a little (a slow tilt) through the four seconds he holds; the lit return (26.25) opens on the same frame. The two takes:
//   a  the lens 0.6 m from the foot wall, 62 deg lens, the tilt 46 -> 44 deg (a slow push): the man from the knees up, the slot of the walls round him
//   b  the lens at the foot wall, 52 deg, 40 -> 38 deg: tighter, the man and his spade filling the frame
export const HOOKS = { a: { p: [0.1, -1.55, 0.6], yaw: -4, p0: 46, p1: 44, fov: 62 }, b: { p: [0.12, -1.55, 0.85], yaw: -5, p0: 40, p1: 38, fov: 52 } };
export const HOOK = (typeof window !== 'undefined' && window.GD_HOOK) || 'a';
export function hookCam(ts) {
  const H = HOOKS[HOOK] || HOOKS.a, u = clamp(ts < TL.climb ? (ts - 2.5) / 5 : (ts - 43.75) / 6.25), w = ss(u);
  const p = [H.p[0] - 0.04 * w, H.p[1] + 0.12 * w, H.p[2] - 0.12 * w], A = aim(p, H.yaw * D2R, lerp(H.p0, H.p1, w) * D2R);
  return { shot: 'grave', p, l: A.l, up: A.up, fov: H.fov, near: 0.03 };
}
export function camAt(t) {
  const s = shotAt(t), up = [0, 1, 0];
  if (s === 'grave') return hookCam(t);
  if (s === 'mark') return { shot: s, p: GRAVE_CAM.p, l: [0, 10, 0], up: [0, 0, -1], fov: GRAVE_CAM.fov, near: 0.03 };
  if (s === 'climb') {
    const E = CLIMB[TAKE === 'b' ? 'b' : 'a'];
    if (TAKE === 'b' && t >= TL.yard) {             // the crane goes on rising and drifts north over the yard
      const u = ss((t - TL.yard) / (TL.close - TL.yard)), F = CLIMB.b2, p = L3(E.p, F.p, u);
      const A = aim(p, lerp(E.yaw, F.yaw, u), lerp(E.pitch, F.pitch, u)); return { shot: 'climb', p, l: A.l, up: A.up, fov: lerp(E.fov, F.fov, u), near: 0.1 };
    }
    const u = (t - TL.climb) / (TL.yard - TL.climb), G = GRAVE_CAM.p;
    // up first (out of the mouth), then out: the height leads, the plan follows; the sky turns down to the foot end, then round
    const p = [lerp(G[0], E.p[0], eio(u)), lerp(G[1], E.p[1], eout(u * 1.05)), lerp(G[2], E.p[2], eio(u))];
    const pitch = lerp(Math.PI / 2, E.pitch, eio(Math.min(1, u * 1.15))), yaw = lerp(Math.PI, E.yaw, eio(clamp((u - 0.08) / 0.92)));
    const A = aim(p, yaw, pitch); return { shot: 'climb', p, l: A.l, up: A.up, fov: lerp(GRAVE_CAM.fov, E.fov, eio(u)), near: 0.05 };
  }
  if (s === 'yard') {          // take a: the slow track down the rows toward the grave
    const u = (t - TL.yard) / (TL.close - TL.yard), z = lerp(TRACK.z0, TRACK.z1, u * 0.85 + 0.15 * ss(u));
    const p = [TRACK.x + 0.4 * ss(u), TRACK.y - 0.15 * ss(u), z], L = TRACK.look;
    return { shot: s, p, l: [p[0] + L[0], p[1] + L[1], p[2] + L[2]], up, fov: TRACK.fov, near: 0.05 };
  }
  if (s === 'close') { const P = CLOSE_CAM.p, d = Math.min(1, (t - TL.close) / (TL.wide - TL.close));          // a slow push up the trench
    const p = [P[0], P[1], P[2] - 0.7 * eio(d)]; return { shot: s, p, l: [p[0] + 0.9, p[1] + 1.0, p[2] - 60], up, fov: CLOSE_CAM.fov, near: 0.03 }; }
  if (s === 'wide') {          // low behind the grave's crew, north up the graveyard; from the light it eases down toward the grave
    const a = { p: [0.55, 1.05, 5.4], l: [-0.6, 32, -900] }, b = { p: [0.1, 1.2, 2.55], l: [0, -1.2, -0.4] };
    const u = 0.78 * eio((t - TL.lit - 1.25) / (TL.fall - TL.lit - 1.25)), k = t < TL.lit + 1.25 ? 0 : u;   // finish (c20): it eases in and stops short (the full move put the lens through the crouching worker's back at 41.3 and into grey earth for 1 s before the cut)
    const drift = Math.min(t, TL.lit + 1.25) - TL.wide, pa = [a.p[0], a.p[1] + 0.012 * drift, a.p[2] - 0.05 * drift];
    return { shot: s, p: L3(pa, b.p, k), l: L3(a.l, [b.p[0] + b.l[0] * 50, b.p[1] + b.l[1] * 50, b.p[2] + b.l[2] * 50], Math.pow(k, 1.5)), up, fov: lerp(44, 46, k), near: 0.2 };
  }
  // the reverse: over his right shoulder at the head end, down into the grave onto the sign; it settles a little closer as the earth comes
  const sg = RIM.sign, m = RIM.man.dig, v = ss((t - TL.sign) / (TL.mark - TL.sign));
  return { shot: s, p: [m[0] - 0.62 + 0.1 * v, 1.95 - 0.12 * v, m[1] - 0.72 + 0.08 * v], l: [sg[0] + 0.02, sg[1], sg[2] + 0.12], up, fov: 40 - 3 * v, near: 0.05 };
}
// v3: the launch (v1's overhead, 5.0-7.5 out): straight down over the grave from 5.2 m (the crew round its black mouth), up fast and
// tilting north as it rises until the yard lies ahead under the moon; then the crane settles lower over the dig (7.5-12.5 out)
export const YARD3 = { a: { p: [-1.0, 16, 12.5], pitch: -0.66, fov: 50 }, b: { p: [-1.1, 9.5, 8.0], pitch: -0.5, fov: 46 }, yaw: 2 * Math.PI + 0.02 };
export function camCut(kind, t) {
  const Y = YARD3;
  if (kind === 'rocket') {
    const u = clamp((t - V3T.rocket) / (V3T.yard - V3T.rocket)), A = Y.a;
    const w = eio(clamp((u - 0.12) / 0.88));            // the turn north and the draw south go together, so the grave only sinks in frame
    const p = [lerp(0, A.p[0], w), lerp(6.5, A.p[1], eout(u)), lerp(0, A.p[2], w)];
    const D = aim(p, Y.yaw, lerp(-Math.PI / 2 + 1e-3, A.pitch, w)); return { shot: 'climb', p, l: D.l, up: D.up, fov: lerp(34, A.fov, w), near: 0.2 };
  }
  const u = ss((t - V3T.yard) / (V3T.close - V3T.yard)), A = Y.a, B = Y.b, p = L3(A.p, B.p, u);
  const D = aim(p, Y.yaw, lerp(A.pitch, B.pitch, u)); return { shot: 'climb', p, l: D.l, up: D.up, fov: lerp(A.fov, B.fov, u), near: 0.1 };
}
export function applyCam(cam, C) {
  cam.position.set(...C.p); cam.up.set(...C.up); if (cam.fov !== C.fov || cam.near !== C.near) { cam.fov = C.fov; cam.near = C.near; cam.updateProjectionMatrix(); }
  cam.lookAt(new THREE.Vector3(...C.l)); cam.updateMatrixWorld(); return cam;
}
// project a world point through a camera to 1080 x 1920 pixels: [x, y, depth] (depth < 0: behind the lens)
const _pv = new THREE.Vector3();
export function px(cam, p) { _pv.set(p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]); const d = -_pv.clone().applyMatrix4(cam.matrixWorldInverse).z; _pv.project(cam); return [(_pv.x * 0.5 + 0.5) * 1080, (-_pv.y * 0.5 + 0.5) * 1920, d]; }
