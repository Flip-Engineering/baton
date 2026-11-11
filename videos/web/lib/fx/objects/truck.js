// TRACTOR-TRAILER (OBJECTS c1): a named type, not "a truck".
//
// Reference (public spec sheets and photographs, dimensions in metres):
//   cab 'longhood'  Class 8 long-hood conventional (Peterbilt 389 / Kenworth W900L class): 130" BBC, square chrome grille,
//                   flat hood with the fenders swept off it, cowl-mounted chrome air cleaners, split flat windshield,
//                   west-coast mirrors, a 63" flat-top or raised sleeper, twin 7" chrome stacks behind the sleeper,
//                   polished aluminium 26" fuel tanks under the doors, 5 amber roof clearance lamps
//   cab 'aero'      set-forward aero conventional (Freightliner Cascadia / Volvo VNL class): sloped hood, wrap windshield,
//                   roof fairing and cab extenders, chassis skirts, a single stack or none
//   cab 'cabover'   cab-over-engine (Freightliner FLA / Peterbilt 362 class): flat face over the steer axle, tall cab
//   trailer 'van53' 53 ft sheet-and-post dry van (Great Dane / Wabash class): 102" wide, 13'6" high, logistic posts,
//                   swing doors with 4 lock rods, landing gear, sliding tandem, DOT-C2 red/white conspicuity tape
//           'reefer'  the same with the nose-mounted refrigeration unit (Thermo King / Carrier class)
//           'flatbed' 48 ft steel-deck flatbed with steel coils chained in cradles
//           'tanker'  a stainless DOT-406 style fuel tanker, ribbed barrel, walkway, hose tubes
//           'container' a 40 ft ISO container (corrugated sides, corner castings) on a skeletal chassis
//   day: true -> day cab (no sleeper)
//
// The truck faces +X; ground is y = 0; the steer axle is at x = 0; the driver side is -z.
//   const t = truck({ seed, cab, trailer, paint, day, lights })  -> THREE.Group with userData.meta
//   meta.anchors: headL, headR, stackL, stackR (tops), fifth, trailerRear, cabDoor; meta.lights: practicals
import * as THREE from 'three';
import { G, Parts, V3, TAU, rng, pick, range, mat, fin, paint, corrugation, canvasTex, rivetRow, finish } from './kit.js';

// fleet colours seen on real long-haul tractors (owner-operators and fleets), not a brand
export const TRUCK_PAINTS = { red: 0x8f1410, maroon: 0x4a0f12, black: 0x0d0d0f, white: 0xe9e6de, navy: 0x14213d, green: 0x1d3b2a,
  gold: 0xc79a2a, orange: 0xc4541a, blue: 0x1f4f8f, silver: 0x9ea3a8 };

function tireGeo(r = 0.525, w = 0.28, rim = 0.29) {
  const h = w / 2;
  return G.lathe([[rim, -h + 0.01], [r - 0.07, -h], [r - 0.015, -h + 0.03], [r, -h + 0.06], [r, h - 0.06], [r - 0.015, h - 0.03], [r - 0.07, h], [rim, h - 0.01]], 36).rotateX(Math.PI / 2);
}
// polished aluminium disc wheel face (the dish, the hand holes, the hub) on the outside (+z) of a tyre centred at 0
function wheelFace(side = 1, w = 0.28, outer = true) {
  const s = side, z0 = s * (w / 2 - 0.02);
  const dish = G.lathe([[0.3, 0], [0.29, 0.01], [0.24, 0.03], [0.2, 0.05], [0.16, 0.055], [0.0, 0.06]], 32).rotateX(s > 0 ? Math.PI / 2 : -Math.PI / 2).translate(0, 0, z0);
  const hub = outer ? G.lathe([[0.12, 0], [0.12, 0.05], [0.09, 0.12], [0.05, 0.16], [0.0, 0.17]], 20).rotateX(s > 0 ? Math.PI / 2 : -Math.PI / 2).translate(0, 0, z0 + s * 0.05) : null;
  const nuts = []; for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; nuts.push(G.cylZ(0.018, 0.05, Math.cos(a) * 0.143, Math.sin(a) * 0.143, z0 + s * 0.065, 6)); }
  const holes = []; for (let i = 0; i < 10; i++) { const a = (i + 0.5) / 10 * TAU; holes.push(new THREE.CircleGeometry(0.035, 10).rotateY(s > 0 ? 0 : Math.PI).translate(Math.cos(a) * 0.22, Math.sin(a) * 0.22, z0 + s * 0.037)); }
  return { dish, hub, nuts, holes };
}
// a wheel end at (x, z-side): single steer or dual drive; adds to parts bag P
function wheelEnd(P, x, zc, side, dual, r = 0.525) {
  const w = 0.28, y = r;
  const put = (g, dz) => g.clone().translate(x, y, zc + dz);
  const tg = tireGeo(r, w);
  const rimC = G.cylZ(0.295, w - 0.02, 0, 0, 0, 28);   // the rim barrel: closes the tyre so the far wheel is never a hollow 'C'
  P.add('black', put(rimC, 0)); if (dual) P.add('black', put(rimC, -side * 0.33));
  if (!dual) {
    P.add('tire', put(tg, 0));
    const f = wheelFace(side, w, true); P.add('alu', put(f.dish, 0)); P.add('chrome', put(f.hub, 0), f.nuts.map(n => put(n, 0))); P.add('black', f.holes.map(h => put(h, 0)));
  } else {
    const gap = 0.33;
    P.add('tire', put(tg, 0), put(tg, -side * gap));
    const f = wheelFace(side, w, true); P.add('alu', put(f.dish, 0)); P.add('chrome', put(f.hub, 0), f.nuts.map(n => put(n, 0))); P.add('black', f.holes.map(h => put(h, 0)));
  }
}

export function truck(o = {}) {
  const r = rng(o.seed ?? 1);
  const cab = o.cab ?? pick(r, ['longhood', 'longhood', 'aero', 'cabover']);
  const trailer = o.trailer ?? pick(r, ['van53', 'van53', 'reefer', 'flatbed', 'tanker', 'container', 'none']);
  const day = o.day ?? (r() < 0.2);
  const col = o.paint ?? TRUCK_PAINTS[pick(r, Object.keys(TRUCK_PAINTS))];
  const wearK = o.wear ?? range(r, 0.35, 0.8);
  const P = new Parts();
  const anchors = {}, lights = [];
  const grp = new THREE.Group();

  // ---------------- chassis: frame rails, steer axle at 0, tandem drives behind the cab
  const cabover = cab === 'cabover', aero = cab === 'aero';
  const bbc = cabover ? 0 : aero ? 1.25 : 2.35;                    // hood length ahead of the firewall
  const fw = cabover ? 0.9 : -0.95;                                 // firewall / cab front x
  const cabLen = cabover ? 2.0 : 1.62, sleeper = day ? 0 : cabover ? 0.6 : range(r, 1.4, 1.95);
  const cabBack = fw - cabLen - sleeper;
  const tandem = cabBack - (day ? 1.3 : 1.55);                      // centre of the drive tandem
  const ax = [tandem + 0.66, tandem - 0.66];
  const frontX = cabover ? 1.45 : fw + bbc + 0.2;
  const rearX = tandem - 1.5;
  for (const s of [-1, 1]) {
    P.add('black', G.box(frontX - rearX, 0.27, 0.07, (frontX + rearX) / 2, 0.98, s * 0.43), G.box(frontX - rearX, 0.03, 0.12, (frontX + rearX) / 2, 1.1, s * 0.4));
  }
  for (const x of [0, ...ax]) P.add('black', G.cylX(0.07, 0.12, x, 0.525, 0, 10).rotateY(0), G.cylZ(0.07, 1.8, x, 0.525, 0, 10));
  for (const s of [-1, 1]) { wheelEnd(P, 0, s * 1.02, s, false); for (const x of ax) wheelEnd(P, x, s * 1.12, s, true); }
  // leaf springs on the steer axle, air bags on the drives
  for (const s of [-1, 1]) { P.add('black', G.box(1.3, 0.08, 0.08, 0, 0.72, s * 0.43)); for (const x of ax) P.add('rubber', G.cyl(0.14, 0.14, 0.24, x + 0.35, 0.78, s * 0.43, 14)); }
  // fifth wheel: the greased plate with its jaws, on the tandem
  const fifthX = tandem + 0.25;
  P.add('black', G.box(1.05, 0.08, 0.95, fifthX, 1.22, 0), G.box(0.5, 0.12, 0.2, fifthX - 0.3, 1.16, 0.4), G.box(0.5, 0.12, 0.2, fifthX - 0.3, 1.16, -0.4));
  anchors.fifth = V3(fifthX, 1.26, 0);
  // mud flaps with chrome weights, quarter fenders over the drives
  for (const s of [-1, 1]) {
    P.add('rubber', G.box(0.012, 0.72, 0.6, rearX + 0.02, 0.64, s * 1.12));
    P.add('chrome', G.box(0.02, 0.08, 0.62, rearX + 0.02, 0.3, s * 1.12), G.box(0.9, 0.06, 0.06, rearX + 0.45, 1.02, s * 1.12));
    for (const x of ax) P.add('chrome', new THREE.CylinderGeometry(0.62, 0.62, 0.62, 28, 1, true, 0, Math.PI * 0.42).rotateX(Math.PI / 2).rotateZ(Math.PI * 0.29).translate(x, 0.525, s * 1.12));
  }

  // ---------------- the cab
  const body = aero ? 'body' : 'body';
  const cabTop = cabover ? 3.35 : aero ? 3.0 : 2.95, cabBase = 1.3;
  if (cab === 'longhood') {
    // the square grille, bars behind a chrome surround, the hood crown, the fenders swept off the hood
    const gx = fw + bbc;
    P.add('chrome', G.box(0.1, 1.22, 0.07, gx + 0.02, 1.52, 0.55), G.box(0.1, 1.22, 0.07, gx + 0.02, 1.52, -0.55), G.box(0.1, 0.08, 1.17, gx + 0.02, 2.12, 0), G.box(0.1, 0.08, 1.17, gx + 0.02, 0.93, 0));
    for (let i = 0; i < 13; i++) P.add('alu', G.box(0.04, 1.12, 0.022, gx - 0.02, 1.52, -0.48 + i * 0.08));
    P.add('black', G.box(0.02, 1.14, 1.04, gx - 0.07, 1.52, 0));
    P.add('chrome', G.box(0.03, 0.12, 0.3, gx + 0.06, 2.24, 0));           // the emblem bar on the grille shell
    P.add(body, G.rbox(bbc - 0.05, 0.78, 1.14, 0.06, fw + (bbc - 0.05) / 2, 1.73, 0));   // hood
    P.add(body, G.rbox(bbc - 0.2, 0.08, 0.5, 0.03, fw + bbc / 2 - 0.05, 2.14, 0));        // the crown
    for (const s of [-1, 1]) {
      // fender: a thick arch over the steer tyre, extruded 0.42 wide, joined to the hood side by a skirt panel
      const arc = []; const R0 = 0.63, R1 = 0.7;
      for (let i = 0; i <= 18; i++) { const a = Math.PI * (0.02 + 0.93 * i / 18); arc.push([Math.cos(a) * R1, 0.525 + Math.sin(a) * R1]); }
      for (let i = 18; i >= 0; i--) { const a = Math.PI * (0.02 + 0.93 * i / 18); arc.push([Math.cos(a) * R0, 0.525 + Math.sin(a) * R0]); }
      P.add(body, G.extrude(arc, 0.44, 0.015).translate(0.05, 0, s * 0.8));
      P.add(body, G.extrude([[0.65, 0.62], [gx - 0.02, 0.9], [gx - 0.02, 1.36], [0.4, 1.28], [-0.6, 1.2], [fw + 0.02, 1.2], [fw + 0.02, 0.62], [-0.72, 0.62]].map(([x, y]) => [x, y]), 0.02).translate(0, 0, s * 0.575));
      // headlamp pod on the fender, turn lamp under it
      P.add('chrome', G.cylX(0.13, 0.14, gx - 0.28, 1.2, s * 0.84, 20));
      P.add('lampWhite', G.cylX(0.105, 0.02, gx - 0.2, 1.2, s * 0.84, 20));
      P.add('lampAmber', G.box(0.03, 0.07, 0.22, gx - 0.36, 1.03, s * 0.84));
      anchors[s < 0 ? 'headL' : 'headR'] = V3(gx - 0.18, 1.2, s * 0.84); lights.push({ kind: 'headlight', pos: V3(gx - 0.18, 1.2, s * 0.84), dir: V3(1, -0.02, 0), color: 0xfff1d6 });
      // the tall chrome air cleaner at the cowl
      P.add('chrome', G.cyl(0.21, 0.21, 0.78, fw + 0.28, 1.7, s * 0.78, 28), G.cyl(0.23, 0.23, 0.05, fw + 0.28, 2.1, s * 0.78, 28), G.cyl(0.23, 0.23, 0.05, fw + 0.28, 1.3, s * 0.78, 28));
      P.add('black', G.cyl(0.215, 0.215, 0.05, fw + 0.28, 1.5, s * 0.78, 28), G.cyl(0.215, 0.215, 0.05, fw + 0.28, 1.9, s * 0.78, 28));
    }
    // bumper: the tall chrome bumper with its tow slots
    P.add('chrome', G.rbox(0.2, 0.34, 2.36, 0.05, gx + 0.12, 0.74, 0));
    P.add('black', G.box(0.02, 0.08, 0.12, gx + 0.225, 0.74, 0.5), G.box(0.02, 0.08, 0.12, gx + 0.225, 0.74, -0.5));
    // hood side louvres (the vents behind the fender line) and the hood's piano-hinge seam
    for (const s2 of [-1, 1]) { for (let i = 0; i < 7; i++) P.add('black', G.box(0.32, 0.018, 0.01, fw + 0.55, 1.62 + i * 0.05, s2 * 0.572)); P.add('black', G.box(bbc - 0.1, 0.01, 0.01, fw + bbc / 2, 2.11, s2 * 0.4)); }
    // cab-mounted marker lamps on the hood (the "cab lights" on the cowl)
  } else if (aero) {
    const gx = fw + bbc;
    // sloped hood: an extruded side profile, rounded; the grille a dark trapezoid with chrome bars; the bumper wraps
    P.add(body, G.extrude([[fw, 1.2], [gx - 0.15, 0.62], [gx + 0.08, 0.62], [gx + 0.12, 1.25], [gx - 0.1, 1.72], [fw + 0.2, 2.02], [fw, 2.05]], 2.3, 0.08));
    P.add('black', G.extrude([[gx + 0.1, 0.9], [gx + 0.14, 1.4], [gx + 0.04, 1.62], [gx - 0.02, 1.6], [gx - 0.02, 0.9]], 0.95));
    for (let i = 0; i < 6; i++) P.add('chrome', G.box(0.03, 0.03, 0.97, gx + 0.1 - i * 0.02, 0.98 + i * 0.12, 0));
    P.add('alu', G.rbox(0.3, 0.36, 2.44, 0.1, gx + 0.05, 0.62, 0));
    for (const s of [-1, 1]) { P.add('glass', G.box(0.2, 0.14, 0.4, gx - 0.05, 1.38, s * 0.9).rotateZ(-0.5)); P.add('lampWhite', G.box(0.02, 0.1, 0.3, gx + 0.05, 1.36, s * 0.9)); anchors[s < 0 ? 'headL' : 'headR'] = V3(gx + 0.06, 1.36, s * 0.9); lights.push({ kind: 'headlight', pos: anchors[s < 0 ? 'headL' : 'headR'].clone(), dir: V3(1, -0.02, 0), color: 0xf4f6ff }); }
    for (const s of [-1, 1]) {
      const arc = []; const R0 = 0.63, R1 = 0.72;
      for (let i = 0; i <= 14; i++) { const a = Math.PI * (0.1 + 0.85 * i / 14); arc.push([Math.cos(a) * R1, 0.525 + Math.sin(a) * R1]); }
      for (let i = 14; i >= 0; i--) { const a = Math.PI * (0.1 + 0.85 * i / 14); arc.push([Math.cos(a) * R0, 0.525 + Math.sin(a) * R0]); }
      P.add('black', G.extrude(arc, 0.4).translate(0.05, 0, s * 1.02));
    }
  } else {
    // cab-over: the flat face, the grille low on it, the bumper, the step wells
    P.add('chrome', G.rbox(0.22, 0.34, 2.44, 0.05, 1.5, 0.66, 0));
    P.add('black', G.box(0.03, 0.55, 1.5, 1.39, 1.3, 0));
    for (let i = 0; i < 8; i++) P.add('chrome', G.box(0.02, 0.025, 1.5, 1.405, 1.08 + i * 0.065, 0));
    for (const s of [-1, 1]) { P.add('chrome', G.box(0.06, 0.2, 0.36, 1.4, 1.3, s * 0.95)); P.add('lampWhite', G.box(0.02, 0.15, 0.3, 1.43, 1.3, s * 0.95)); anchors[s < 0 ? 'headL' : 'headR'] = V3(1.44, 1.3, s * 0.95); lights.push({ kind: 'headlight', pos: anchors[s < 0 ? 'headL' : 'headR'].clone(), dir: V3(1, 0, 0), color: 0xfff1d6 }); }
  }
  // cab box, door, glass (flat split windshield on the long hood), visor, mirrors, roof lamps, grab handles, steps
  {
    const x0 = fw, x1 = fw - cabLen, zc = cabover ? 1.22 : 1.0;
    const ws = cabover ? 0 : aero ? 0.55 : 0.18;                  // windshield rake (m of setback over its height)
    const prof = [[x0, cabBase], [x0 + (cabover ? 0.5 : 0), cabBase], [x0 + (cabover ? 0.5 : 0), 2.15], [x0 + (cabover ? 0.5 : 0) - ws, cabTop - 0.1], [x0 + (cabover ? 0.45 : 0) - ws - 0.1, cabTop], [x1, cabTop], [x1, cabBase]];
    P.add(body, G.extrude(prof, zc * 2, 0.05));
    const xa = x0 + (cabover ? 0.5 : 0);
    // windshield panes (split for the long hood), side glass
    const wsMid = (xa + xa - ws) / 2 + 0.075, wsY = (2.2 + cabTop - 0.14) / 2, wsH = Math.hypot(ws, cabTop - 0.14 - 2.2), tilt = Math.atan2(ws, cabTop - 0.14 - 2.2);
    if (cab === 'longhood') { for (const s of [-1, 1]) P.add('glass', G.box(0.02, wsH - 0.06, zc - 0.14, 0, 0, 0).rotateZ(tilt).translate(wsMid, wsY, s * (zc / 2 - 0.02))); P.add(body, G.box(0.05, wsH, 0.06, 0, 0, 0).rotateZ(tilt).translate(wsMid + 0.01, wsY, 0)); }
    else P.add('glass', G.box(0.02, wsH - 0.08, zc * 2 - 0.2, 0, 0, 0).rotateZ(tilt).translate(wsMid, wsY, 0));
    for (const s of [-1, 1]) {
      const dz = s * (zc + 0.075);
      P.add('glass', G.extrude([[xa - ws * 0.25 - 0.08, 2.25], [xa - ws - 0.12, cabTop - 0.2], [x0 - cabLen * 0.62, cabTop - 0.2], [x0 - cabLen * 0.62, 2.25]], 0.01).translate(0, 0, dz));
      // door seams and the handle
      P.add('black', G.box(0.012, cabTop - cabBase - 0.3, 0.012, x0 - cabLen * 0.66, (cabTop + cabBase) / 2 - 0.1, dz), G.box(0.012, cabTop - cabBase - 0.3, 0.012, xa - 0.08, (cabTop + cabBase) / 2 - 0.1, dz));
      P.add('chrome', G.box(0.18, 0.03, 0.03, x0 - cabLen * 0.58, 2.0, dz + s * 0.02), G.cyl(0.018, 0.018, 0.9, xa - 0.12, 2.05, s * (zc + 0.08), 8));
      // steps under the door
      P.add('alu', G.box(0.5, 0.03, 0.26, x0 - cabLen * 0.35, 0.95, s * (zc - 0.02)), G.box(0.5, 0.03, 0.2, x0 - cabLen * 0.35, 0.58, s * (zc - 0.02)));
      // west-coast mirror on its arms, a convex spot mirror under it
      const mx = xa - (cabover ? 0.2 : 0.05), mz = s * (zc + 0.42);
      P.add('chrome', G.rod(V3(mx, 2.55, s * zc), V3(mx + 0.05, 2.62, mz), 0.012), G.rod(V3(mx, 1.95, s * zc), V3(mx + 0.05, 1.9, mz), 0.012), G.rod(V3(mx + 0.05, 1.88, mz), V3(mx + 0.05, 2.64, mz), 0.012));
      P.add('chrome', G.rbox(0.07, 0.45, 0.2, 0.02, mx + 0.05, 2.3, mz)); P.add('glass', G.box(0.01, 0.4, 0.17, mx + 0.01, 2.3, mz));
      P.add('chrome', new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI).rotateY(Math.PI / 2).translate(mx + 0.05, 2.02, mz));
      anchors[s < 0 ? 'mirrorL' : 'mirrorR'] = V3(mx + 0.05, 2.3, mz);
    }
    // sun visor and the roof clearance lamps (five amber)
    if (!aero) P.add(body, G.box(0.35, 0.05, zc * 2 + 0.05, xa - ws + 0.02, cabTop - 0.08, 0).rotateZ(0));
    for (let i = -2; i <= 2; i++) { P.add('lampAmber', G.rbox(0.07, 0.05, 0.1, 0.02, xa - ws - 0.05, cabTop + 0.02, i * 0.28)); lights.push({ kind: 'marker', pos: V3(xa - ws - 0.05, cabTop + 0.02, i * 0.28), color: 0xffa040 }); }
    anchors.cabDoor = V3(x0 - cabLen * 0.3, 1.6, -zc);
    anchors.windshield = V3(wsMid, wsY, 0);
    // horn(s) on the roof (air horns: two chrome trumpets)
    if (cab === 'longhood') for (const s of [-1, 1]) P.add('chrome', G.lathe([[0.012, 0], [0.02, 0.2], [0.04, 0.34], [0.07, 0.4]], 14).rotateZ(Math.PI / 2).translate(x1 + 0.6 + s * 0.2, cabTop + 0.06, s * 0.35));
  }
  // sleeper: a flat-top or raised box, the upper vent, a small side window, a fairing on the aero
  if (sleeper > 0) {
    const x0 = fw - cabLen, x1 = x0 - sleeper, top = cabover ? cabTop : aero ? cabTop + 0.45 : cabTop + range(r, 0.05, 0.35);
    P.add(body, G.rbox(sleeper + 0.02, top - cabBase, 2.06, 0.08, (x0 + x1) / 2, (top + cabBase) / 2, 0));
    for (const s of [-1, 1]) { P.add('glass', G.rbox(0.36, 0.22, 0.02, 0.05, x0 - sleeper * 0.55, top - 0.55, s * 1.035)); P.add('black', G.box(0.5, 0.2, 0.01, x0 - sleeper * 0.35, 1.72, s * 1.035)); }
    if (aero) P.add(body, G.extrude([[fw - 0.4, cabTop], [x1 + 0.1, top + 0.55], [x1, top + 0.55], [x1, top]], 2.05, 0.08));
  } else if (aero) P.add(body, G.extrude([[fw - 0.3, cabTop], [fw - cabLen, cabTop + 0.5], [fw - cabLen - 0.05, cabTop + 0.5], [fw - cabLen - 0.05, cabTop]], 2.0, 0.05));
  const backX = fw - cabLen - sleeper;
  // fuel tanks (polished aluminium, two straps), the battery / tool box, DEF tank, air tanks, the deck plate
  for (const s of [-1, 1]) {
    const tl = Math.min(1.6, Math.max(0.9, cabLen + sleeper - 0.9)), tx = fw - 0.45 - tl / 2 - (cabover ? 1.3 : 0);
    if (aero) P.add(body, G.box(Math.abs(tx - rearX) * 0.5 + tl, 0.62, 0.03, tx - 0.4, 0.78, s * 1.25));
    P.add('alu', G.cylX(0.33, tl, tx, 0.78, s * 0.86, 36));
    P.add('black', G.cylX(0.336, 0.06, tx - tl * 0.3, 0.78, s * 0.86, 36), G.cylX(0.336, 0.06, tx + tl * 0.3, 0.78, s * 0.86, 36));
    P.add('chrome', G.cyl(0.07, 0.07, 0.04, tx + tl * 0.2, 1.11, s * 0.95, 14));
    P.add('alu', G.box(0.55, 0.55, 0.62, backX - 0.1, 0.78, s * 0.8));
    P.add('black', G.cylX(0.14, 0.9, tandem + 0.95, 0.75, s * 0.62, 16));
  }
  P.add('alu', G.box(0.7, 0.03, 1.0, backX - 0.25, 1.2, 0));
  // exhaust: twin chrome stacks with heat shields and mitered tips (long hood), one on the aero, cab-over behind the cab
  const stacks = cab === 'longhood' ? [-1, 1] : aero ? [1] : [-1];
  const sx = backX - 0.12, stTop = cab === 'longhood' ? 4.15 : aero ? 4.0 : 4.25;
  for (const s of stacks) {
    const z = s * 1.02;
    P.add('chrome', G.cyl(0.09, 0.09, stTop - 1.3, sx, (stTop + 1.3) / 2, z, 20), G.cyl(0.115, 0.115, 1.0, sx, 2.1, z, 20));
    P.add('black', G.cyl(0.075, 0.075, 0.02, sx, stTop + 0.01, z, 20));
    P.add('chrome', G.cyl(0.092, 0.092, 0.22, 0, 0, 0, 20).rotateZ(-0.35).translate(sx - 0.03, stTop + 0.06, z));
    P.add('black', G.box(0.06, 0.04, 0.12, sx + 0.08, 2.9, z - s * 0.08), G.box(0.06, 0.04, 0.12, sx + 0.08, 1.7, z - s * 0.08));
    anchors[s < 0 ? 'stackL' : 'stackR'] = V3(sx - 0.05, stTop + 0.15, z);
  }
  // glad hands and the air / electrical lines hanging from the back of the cab to the trailer (catenary)
  const hasTrailer = trailer !== 'none';
  const trailerFront = fifthX + 0.91;
  if (hasTrailer) {
    const x0 = backX - 0.3, x1 = trailerFront;
    P.add('red', G.tube([V3(x0, 2.1, -0.15), V3((x0 + x1) / 2, 1.5, -0.12), V3(x1 - 0.02, 1.9, -0.1)], 0.018, 16, 6));
    P.add('blue', G.tube([V3(x0, 2.05, 0.0), V3((x0 + x1) / 2, 1.45, 0.02), V3(x1 - 0.02, 1.85, 0.05)], 0.018, 16, 6));
    P.add('black', G.tube([V3(x0, 2.0, 0.15), V3((x0 + x1) / 2, 1.4, 0.16), V3(x1 - 0.02, 1.8, 0.2)], 0.022, 16, 6));
  }
  // the cab's own lettering / DOT number plate (a dark placard on the door) is left to the shot: no brand

  // ---------------- the trailer
  const T = new Parts(); let trailerRear = rearX;
  if (hasTrailer) {
    const len = trailer === 'container' ? 12.3 : trailer === 'flatbed' ? 14.63 : trailer === 'tanker' ? 12.8 : 16.15;
    const xf = trailerFront, xr = xf - len, W = 2.59, floor = 1.22;
    trailerRear = xr;
    const tax = [xr + 2.1, xr + 0.85];   // sliding tandem pulled back
    for (const s of [-1, 1]) for (const x of tax) wheelEnd(T, x, s * 1.12, s, true);
    for (const x of tax) T.add('black', G.cylZ(0.07, 1.8, x, 0.525, 0, 10));
    T.add('black', G.box(3.2, 0.25, 1.1, xr + 1.5, 0.95, 0));                                      // slider box
    // landing gear (two legs, crank, sand shoes)
    const lg = xf - 3.8;
    for (const s of [-1, 1]) T.add('galv', G.box(0.14, 0.9, 0.14, lg, floor - 0.45, s * 0.9), G.box(0.3, 0.05, 0.3, lg, 0.2, s * 0.9), G.rod(V3(lg, floor - 0.15, s * 0.9), V3(lg + 0.5, floor, s * 0.3), 0.02));
    T.add('galv', G.cylZ(0.02, 2.0, lg, 0.85, 0, 8));
    T.add('black', G.cylZ(0.015, 0.25, lg, 0.85, -1.1, 6));
    // rear: ICC under-ride bumper, mud flaps, tail lamps
    T.add('galv', G.box(0.12, 0.12, 2.4, xr + 0.25, 0.55, 0));
    for (const s of [-1, 1]) T.add('galv', G.box(0.08, 0.6, 0.08, xr + 0.3, 0.8, s * 0.8));
    for (const s of [-1, 1]) T.add('rubber', G.box(0.012, 0.6, 0.6, xr + 0.2, 0.7, s * 1.12));
    if (trailer === 'van53' || trailer === 'reefer') {
      const top = 4.11, h = top - floor;
      const sideTex = trailer === 'reefer' ? null : corrugation({ period: 32, size: 256, shape: 'box', strength: 1.6, repeat: [26, 1] });
      T.add('van', G.box(len, h, W, (xf + xr) / 2, floor + h / 2, 0));
      // logistic posts (sheet-and-post), top rail, bottom rail, front corner caps, rear frame
      const posts = trailer === 'reefer' ? 0 : Math.round(len / 0.6);
      for (let i = 1; i < posts; i++) for (const s of [-1, 1]) T.add('alu', G.box(0.07, h - 0.3, 0.012, xf - i * len / posts, floor + h / 2, s * (W / 2 + 0.006)));
      for (const s of [-1, 1]) {
        T.add('alu', G.box(len, 0.14, 0.03, (xf + xr) / 2, top - 0.07, s * (W / 2 + 0.012)), G.box(len, 0.3, 0.03, (xf + xr) / 2, floor + 0.15, s * (W / 2 + 0.012)));
        // DOT conspicuity tape, red / white, 12" + 18" alternating on the lower rail
        for (let x = xf - 0.2, k = 0; x > xr + 0.2; x -= 0.3, k++) T.add(k % 2 ? 'tapeW' : 'tapeR', G.box(k % 2 ? 0.45 : 0.3, 0.05, 0.005, x - (k % 2 ? 0.225 : 0.15), floor + 0.2, s * (W / 2 + 0.03)));
        for (let i = 0; i < 5; i++) { T.add('lampAmber', G.box(0.08, 0.05, 0.02, xf - 1 - i * (len - 2) / 4, floor + 0.08, s * (W / 2 + 0.03))); lights.push({ kind: 'marker', pos: V3(xf - 1 - i * (len - 2) / 4, floor + 0.08, s * (W / 2 + 0.03)), color: 0xffa040 }); }
      }
      T.add('alu', G.box(0.03, h, W + 0.04, xf + 0.01, floor + h / 2, 0), G.rbox(0.08, 0.12, W + 0.02, 0.04, xf, top - 0.06, 0));
      // rear swing doors: frame, the centre seam, four lock rods with handles, hinges, tail / marker lamps
      T.add('galv', G.box(0.1, h, 0.12, xr, floor + h / 2, W / 2 - 0.06), G.box(0.1, h, 0.12, xr, floor + h / 2, -W / 2 + 0.06), G.box(0.12, 0.2, W, xr, top - 0.1, 0), G.box(0.14, 0.2, W, xr, floor + 0.1, 0));
      T.add('black', G.box(0.02, h - 0.4, 0.015, xr - 0.02, floor + h / 2, 0));
      for (const zz of [-0.95, -0.35, 0.35, 0.95]) { T.add('galv', G.cyl(0.016, 0.016, h - 0.3, xr - 0.06, floor + h / 2, zz, 8)); T.add('galv', G.box(0.04, 0.03, 0.3, xr - 0.08, floor + 1.1, zz + 0.14 * Math.sign(-zz))); }
      for (const s of [-1, 1]) for (const yy of [floor + 0.5, floor + 1.45, floor + 2.4]) T.add('galv', G.box(0.06, 0.12, 0.2, xr - 0.04, yy, s * 1.22));
      for (const s of [-1, 1]) { T.add('lampRed', G.cylX(0.06, 0.03, xr - 0.02, floor - 0.15, s * 0.95, 14), G.cylX(0.06, 0.03, xr - 0.02, floor - 0.15, s * 0.75, 14)); lights.push({ kind: 'tail', pos: V3(xr - 0.03, floor - 0.15, s * 0.85), color: 0xff2010 }); }
      for (let i = -1; i <= 1; i++) T.add('lampRed', G.box(0.02, 0.05, 0.08, xr - 0.06, top - 0.1, i * 0.2));
      if (sideTex) T.normalVan = sideTex;
      if (trailer === 'reefer') {
        T.add('reefer', G.rbox(0.55, 1.95, 2.15, 0.08, xf + 0.28, top - 1.05, 0));
        T.add('black', G.box(0.02, 0.8, 1.6, xf + 0.56, top - 0.8, 0));
        for (let i = 0; i < 10; i++) T.add('reefer', G.box(0.02, 0.03, 1.6, xf + 0.575, top - 0.45 - i * 0.075, 0));
        T.add('black', G.box(0.04, 0.3, 0.5, xf + 0.57, top - 1.75, 0.4));
        T.add('galv', G.box(1.3, 0.5, 0.6, xf - 4.5, floor - 0.3, 0.7));   // the reefer fuel tank
      }
    } else if (trailer === 'flatbed') {
      T.add('trailerSteel', G.box(len, 0.12, W, (xf + xr) / 2, 1.5, 0));
      for (const s of [-1, 1]) T.add('trailerSteel', G.box(len, 0.32, 0.12, (xf + xr) / 2, 1.3, s * 0.45));
      for (let x = xf - 0.4; x > xr + 0.3; x -= 0.6) for (const s of [-1, 1]) T.add('galv', G.box(0.08, 0.05, 0.03, x, 1.46, s * (W / 2)));
      // steel coils in cradles, chained (four heavy coils, eye to the side)
      const nC = 3 + Math.floor(r() * 2);
      for (let i = 0; i < nC; i++) {
        const cx = xf - 2.2 - i * (len - 4) / Math.max(1, nC - 1) * 0.9, R = range(r, 0.72, 0.88), Wd = range(r, 1.1, 1.5);
        const coil = G.lathe([[0.3, -Wd / 2], [R, -Wd / 2], [R, Wd / 2], [0.3, Wd / 2], [0.3, -Wd / 2]], 40).rotateX(Math.PI / 2).rotateY(Math.PI / 2).translate(cx, 1.56 + R, 0);
        T.add('coil', coil); T.add('black', G.box(0.2, 0.2, 1.8, cx - R * 0.7, 1.66, 0), G.box(0.2, 0.2, 1.8, cx + R * 0.7, 1.66, 0));
        for (const d of [-0.25, 0.25]) { const pts = []; for (let k = 0; k <= 12; k++) { const a = Math.PI * k / 12; pts.push(V3(cx + d, 1.56 + R + Math.cos(a) * (R + 0.03), (k < 6 ? 1 : 1) * Math.sin(a - Math.PI / 2) * (R + 0.03))); } pts.unshift(V3(cx + d * 2, 1.5, -W / 2)); pts.push(V3(cx + d * 2, 1.5, W / 2)); T.add('chain', G.tube(pts, 0.012, 40, 5)); }
      }
      for (const s of [-1, 1]) T.add('lampRed', G.cylX(0.06, 0.03, xr - 0.02, 1.35, s * 0.95, 14));
    } else if (trailer === 'tanker') {
      const R = 1.0, cx = (xf + xr) / 2, cy = 1.25 + R;
      const barrel = G.lathe([[0, -len / 2 + 0.02], [R * 0.7, -len / 2 + 0.05], [R, -len / 2 + 0.3], [R, len / 2 - 0.3], [R * 0.7, len / 2 - 0.05], [0, len / 2 - 0.02]], 44).rotateZ(Math.PI / 2).translate(cx, cy, 0);
      T.add('tank', barrel);
      for (let i = 0; i < 9; i++) T.add('tank', G.cylX(R + 0.03, 0.08, xf - 0.8 - i * (len - 1.6) / 8, cy, 0, 44));
      T.add('galv', G.box(len - 1.6, 0.04, 0.5, cx, cy + R + 0.05, 0));
      for (let i = 0; i < 4; i++) T.add('tank', G.cyl(0.3, 0.3, 0.12, xf - 2 - i * 2.8, cy + R + 0.08, 0, 20));
      T.add('galv', handrailPts(xf - 1, xr + 1, cy + R + 0.07));
      for (const s of [-1, 1]) T.add('galv', G.cylX(0.1, len - 3, cx, 1.3, s * 0.95, 14));
      T.add('trailerSteel', G.box(len * 0.8, 0.2, 0.9, cx, 1.18, 0));
      for (const s of [-1, 1]) T.add('lampRed', G.cylX(0.06, 0.03, xr + 0.25, 1.1, s * 0.95, 14));
    } else if (trailer === 'container') {
      const cl = 12.19, ch = 2.59, cw = 2.44, cy = 1.28;
      const ctex = corrugation({ period: 22, size: 256, shape: 'box', strength: 2.2, repeat: [30, 1] });
      T.add('container', G.box(cl, ch, cw, xf - cl / 2, cy + ch / 2, 0));
      T.normalCont = ctex;
      for (const cxx of [xf - 0.1, xf - cl + 0.1]) for (const s of [-1, 1]) for (const yy of [cy + 0.06, cy + ch - 0.06]) T.add('black', G.box(0.18, 0.12, 0.16, cxx, yy, s * (cw / 2 - 0.08)));
      for (const zz of [-0.9, -0.3, 0.3, 0.9]) T.add('galv', G.cyl(0.018, 0.018, ch - 0.2, xr - 0.02, cy + ch / 2, zz, 8));
      T.add('trailerSteel', G.box(len, 0.3, 0.9, (xf + xr) / 2, 1.08, 0));
      for (const x of [xf - 0.1, xr + 0.1]) T.add('trailerSteel', G.box(0.2, 0.2, 2.44, x, 1.18, 0));
      for (const s of [-1, 1]) T.add('lampRed', G.cylX(0.06, 0.03, xr - 0.02, 1.05, s * 0.95, 14));
    }
  }
  function handrailPts(a, b, y) { const out = []; for (const s of [-1, 1]) { out.push(G.rod(V3(a, y + 0.9, s * 0.3), V3(b, y + 0.9, s * 0.3), 0.02)); for (let x = a; x >= b; x -= 1.5) out.push(G.rod(V3(x, y, s * 0.3), V3(x, y + 0.9, s * 0.3), 0.02)); } return out; }

  // ---------------- materials: the paint, how hard the rig has worked, the trailer finishes
  const tCol = pick(r, [0xecebe6, 0xe4e2dc, 0xd9d6cc, 0xf0efe9]);
  const mats = {
    body: paint(col, { grime: wearK * 0.7, grimeH: 1.1, edge: 0.25 * wearK, speck: 0.03, gloss: true, metal: 0.35 }),
    chrome: fin('chrome'), alu: fin('alu', { wear: { grime: wearK * 0.35, grimeH: 0.8 } }), black: fin('black', { wear: { grime: wearK * 0.5, grimeH: 1.0 } }),
    rubber: fin('rubber'), tire: mat('tire', { color: 0x161616, rough: 0.92, wear: { grime: 0.5, grimeH: 0.4, grimeColor: [0.32, 0.29, 0.25] } }),
    glass: fin('glass'), lampWhite: fin('lampWhite'), lampAmber: fin('lampAmber'), lampRed: fin('lampRed'),
    red: mat('hoseRed', { color: 0x9a1a14, rough: 0.6 }), blue: mat('hoseBlue', { color: 0x1a3a8a, rough: 0.6 }),
    galv: fin('galv', { wear: { grime: wearK * 0.6, grimeH: 1.4 } }),
    van: mat('van' + tCol, { color: tCol, rough: 0.45, metal: 0.25, normalMap: T.normalVan || null, normalScale: 0.6, wear: { grime: wearK * 0.8, grimeH: 1.8, streak: 1.2, grimeColor: [0.3, 0.26, 0.2] } }),
    reefer: mat('reeferU', { color: 0xd8d8d2, rough: 0.5, metal: 0.1, wear: { grime: 0.3, grimeH: 3.8 } }),
    tapeR: mat('tapeR', { color: 0xc01810, rough: 0.3, emissive: 0x400000, emissiveIntensity: 0.4 }), tapeW: mat('tapeW', { color: 0xf2f2ea, rough: 0.3, emissive: 0x303030, emissiveIntensity: 0.4 }),
    trailerSteel: paint(0x1b1b1d, { grime: 0.6, grimeH: 1.5, speck: 0.25 }),
    coil: mat('coil', { color: 0x8a8e92, rough: 0.35, metal: 0.95, wear: { speck: 0.2, speckScale: 3 } }), chain: fin('steel'),
    tank: mat('tank', { color: 0xd0d3d6, rough: 0.2, metal: 1.0, env: 1.2, wear: { grime: wearK * 0.6, grimeH: 2.8, streak: 1.2 } }),
    container: mat('cont' + (o.seed ?? 1), { color: pick(r, [0x8a2a1c, 0x1d4a7a, 0x2d5a3a, 0x9a6a1c, 0x5a5f66]), rough: 0.6, metal: 0.3, normalMap: T.normalCont || null, normalScale: 1, wear: { speck: 0.35, speckScale: 5, grime: 0.4, grimeH: 4, streak: 1.5 } }),
  };
  grp.add(P.build(mats));
  if (hasTrailer) { const tg = T.build(mats); tg.name = 'trailer'; grp.add(tg); }
  anchors.trailerRear = V3(trailerRear, 1.5, 0);
  return finish(grp, {
    type: 'truck', variant: { cab, trailer, day, paint: col, wear: wearK },
    ref: { longhood: 'Peterbilt 389 / Kenworth W900L class long-hood', aero: 'Freightliner Cascadia / Volvo VNL class', cabover: 'Freightliner FLA / Peterbilt 362 class cab-over' }[cab] + ' + ' + trailer,
    anchors, lights,
  });
}
