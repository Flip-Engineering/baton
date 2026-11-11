// STAMPING PRESS (OBJECTS c1): a named type, not "a press".
//
// Reference: straight-side mechanical stamping presses of the Detroit body-panel lines (Verson, Danly, Clearing, Minster
// class, 400-1,000 ton; HAER MI-series records of the Rouge and Fisher Body plants; Rivera's Detroit Industry studies;
// Master Hands 1936 sheet-feed and flywheel shots): a bed and bolster with T-slots, two uprights (columns) with side
// windows, a crown carrying the drive, four tie rods with their nuts showing at the crown and under the bed, the slide
// (ram) on its gibs driven down by two connections, a die set (lower and upper shoes, guide posts), the flywheel under
// a guard, air counterbalance cylinders, a crown catwalk and a ladder, lube lines down the columns, a two-hand control
// station with palm buttons and an E-stop, light-curtain posts either side of the die window, a capacity plate.
//   kind 'straight'  straight-side (the default)       kind 'gap'  gap-frame OBI press (C-frame), the smaller shop press
//
// The press faces +z (the operator side); x is left-right; y up; the floor is y = 0.
//   const p = press({ seed, kind, tons, paint, stroke })  -> Group; p.userData.setStroke(u) moves the slide (0 top, 1 bottom)
//   pressLine({ n: 3, spacing: 8 })  -> a transfer line receding along -x with conveyors and blanks between presses
import * as THREE from 'three';
import { G, Parts, V3, TAU, rng, pick, range, mat, fin, paint, canvasTex, hazardTex, boltCircle, ladder, handrail, rivetRow, finish } from './kit.js';

export const PRESS_PAINTS = { machineGreen: 0x4d6356, pressBlue: 0x2c4a66, grey: 0x74776f, cream: 0xbdb59c, orange: 0xb0561e };

function plateTex(text, sub) {
  return canvasTex(512, 160, (g, w, h) => {
    g.fillStyle = '#b8b09a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#3a3428'; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#2a261e'; g.font = '900 72px Anton, Impact, sans-serif'; g.textAlign = 'center'; g.fillText(text, w / 2, 96);
    g.font = '700 26px sans-serif'; g.fillText(sub, w / 2, 136);
    for (const [x, y] of [[26, 26], [w - 26, 26], [26, h - 26], [w - 26, h - 26]]) { g.beginPath(); g.arc(x, y, 7, 0, TAU); g.fill(); }
  });
}
function stencilTex(text) {
  return canvasTex(256, 256, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(235,228,205,0.92)'; g.font = '900 150px Anton, Impact, sans-serif'; g.textAlign = 'center'; g.fillText(text, w / 2, 190); });
}

export function press(o = {}) {
  const r = rng(o.seed ?? 1);
  const kind = o.kind ?? 'straight';
  const tons = o.tons ?? pick(r, kind === 'gap' ? [60, 110, 150, 200] : [400, 600, 800, 1000]);
  const col = o.paint ?? PRESS_PAINTS[pick(r, Object.keys(PRESS_PAINTS))];
  const wearK = o.wear ?? range(r, 0.3, 0.8);
  const P = new Parts(), anchors = {}, lights = [];
  const grp = new THREE.Group();
  const slide = new THREE.Group(); slide.name = 'slide';
  const S = new Parts();
  let stroke = 0.7, openY, closedY;

  if (kind === 'straight') {
    const sc = Math.cbrt(tons / 600);                     // size scales with capacity
    const W = 4.4 * sc, D = 2.7 * sc, bedH = 1.05, win = 3.3 * sc, crownH = 1.9 * sc, colW = 0.85 * sc;
    const topY = bedH + win + crownH;
    // bed with a cast base line, the bolster with T-slots
    P.add('frame', G.box(W, bedH - 0.12, D, 0, (bedH - 0.12) / 2 + 0.12, 0), G.box(W + 0.2, 0.12, D + 0.2, 0, 0.06, 0));
    P.add('steel', G.box(W - 2 * colW - 0.1, 0.18, D * 0.82, 0, bedH + 0.09, 0));
    for (let i = -2; i <= 2; i++) P.add('dark', G.box(W - 2 * colW - 0.12, 0.05, 0.05, 0, bedH + 0.16, i * D * 0.16));
    // uprights: box columns with a front rib, side window (the feed opening), cast lettering-free
    for (const s of [-1, 1]) {
      const cx = s * (W / 2 - colW / 2);
      P.add('frame', G.box(colW, win, D, cx, bedH + win / 2, 0));
      P.add('frame', G.box(colW * 0.3, win, 0.12, cx + s * colW * 0.2, bedH + win / 2, D / 2 + 0.06));   // front rib
      P.add('frame', G.box(colW * 0.3, win, 0.12, cx + s * colW * 0.2, bedH + win / 2, -D / 2 - 0.06));
      P.add('dark', G.box(0.02, win * 0.5, D * 0.5, cx + s * (colW / 2 + 0.01), bedH + win * 0.45, 0));   // side window
      P.add('frame', G.box(0.08, 0.08, D * 0.54, cx + s * (colW / 2 + 0.03), bedH + win * 0.7, 0), G.box(0.08, 0.08, D * 0.54, cx + s * (colW / 2 + 0.03), bedH + win * 0.2, 0));
      // gibs on the inner face of each column (the slide runs on them)
      P.add('steel', G.box(0.1, win * 0.9, 0.3, cx - s * (colW / 2 + 0.05), bedH + win * 0.52, D * 0.3), G.box(0.1, win * 0.9, 0.3, cx - s * (colW / 2 + 0.05), bedH + win * 0.52, -D * 0.3));
      // lube lines: three copper tubes down the front of the column to the gibs
      for (let k = 0; k < 3; k++) P.add('copper', G.cyl(0.012, 0.012, win + crownH * 0.4, cx - s * colW * 0.15 + k * 0.05 * s, bedH + (win + crownH * 0.4) / 2, D / 2 + 0.02, 6));
      // tie rods: the nuts (big hex) on the crown top and under the bed, and a length of rod showing at each corner
      for (const zz of [-1, 1]) {
        const tx = cx, tz = zz * (D / 2 - 0.25);
        P.add('steel', G.cyl(0.16, 0.16, 0.28, tx, topY + 0.14, tz, 6), G.cyl(0.1, 0.1, 0.35, tx, topY + 0.35, tz, 12));
        P.add('steel', G.cyl(0.16, 0.16, 0.2, tx, 0.1 + 0.12, tz, 6));
      }
    }
    // crown: the main casting, a sheet-metal drive cover, the capacity plate
    P.add('frame', G.box(W + 0.1, crownH, D + 0.1, 0, bedH + win + crownH / 2, 0));
    P.add('frame', G.box(W + 0.3, 0.18, D + 0.3, 0, bedH + win + 0.09, 0), G.box(W + 0.3, 0.14, D + 0.3, 0, topY - 0.07, 0));
    P.add('cover', G.rbox(W * 0.7, 0.9 * sc, D * 0.7, 0.2, 0, topY + 0.45 * sc, 0));
    P.add('plate', new THREE.PlaneGeometry(1.6 * sc, 0.5 * sc).translate(0, bedH + win + crownH * 0.55, D / 2 + 0.06));
    anchors.plate = V3(0, bedH + win + crownH * 0.55, D / 2 + 0.06);
    // air counterbalance cylinders on the crown top
    for (const s of [-1, 1]) { P.add('frame', G.cyl(0.32 * sc, 0.32 * sc, 1.3 * sc, s * W * 0.2, topY + 0.65 * sc, -D * 0.3, 24)); P.add('steel', G.cyl(0.34 * sc, 0.34 * sc, 0.08, s * W * 0.2, topY + 1.3 * sc, -D * 0.3, 24), ...boltCircle(12, 0.29 * sc, 0.025, 0.05, { x: s * W * 0.2, y: topY + 1.35 * sc, z: -D * 0.3 })); }
    // flywheel on the right end of the crown, under a guard, a motor and belt guard above it
    const fr = 1.05 * sc, fx = W / 2 + 0.45, fy = topY - crownH * 0.35, fz = -D * 0.1;
    // the flywheel: a heavy rim, six spokes, the hub on its shaft (Master Hands 05:50); a sheet guard over the top 40 %
    P.add('steel', G.lathe([[fr - 0.16, -0.22], [fr, -0.22], [fr, 0.22], [fr - 0.16, 0.22], [fr - 0.2, 0.12], [fr - 0.2, -0.12], [fr - 0.16, -0.22]], 56).rotateZ(Math.PI / 2).translate(fx, fy, fz));
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + 0.2; P.add('steel', G.rod(V3(fx, fy + Math.sin(a) * 0.22, fz + Math.cos(a) * 0.22), V3(fx, fy + Math.sin(a) * (fr - 0.17), fz + Math.cos(a) * (fr - 0.17)), 0.07 * sc, 8)); }
    P.add('steel', G.cylX(0.26, 0.5, fx, fy, fz, 20), G.cylX(0.14, 1.0, fx - 0.3, fy, fz, 16));
    P.add('guard', new THREE.CylinderGeometry(fr + 0.1, fr + 0.1, 0.6, 40, 1, true, -Math.PI * 0.35, Math.PI * 0.8).rotateZ(Math.PI / 2).translate(fx, fy, fz));
    P.add('guard', G.box(0.04, 0.9, fr * 1.2, fx + 0.3, fy + fr * 0.62, fz));
    // the bull gear on the crown end (double-crank drive), half under its cover
    P.add('steel', G.cylX(fr * 0.9, 0.18, -W / 2 - 0.12, fy + 0.1, fz, 60));
    for (let i = 0; i < 60; i++) { const a = i / 60 * TAU; P.add('steel', G.box(0.18, 0.08, 0.06, -W / 2 - 0.12, fy + 0.1 + Math.sin(a) * fr * 0.92, fz + Math.cos(a) * fr * 0.92).rotateX(0)); }
    P.add('guard', new THREE.CylinderGeometry(fr * 0.95, fr * 0.95, 0.3, 40, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(-W / 2 - 0.14, fy + 0.1, fz));
    P.add('frame', G.cylX(0.38 * sc, 1.1 * sc, W * 0.18, topY + 0.9 * sc + 0.3, D * 0.1, 24), G.box(1.1 * sc, 0.2, 0.6, W * 0.18, topY + 0.9 * sc - 0.05, D * 0.1));
    P.add('guard', G.box(0.18, 1.6 * sc, 0.8, W / 2 + 0.2, topY + 0.4, fz + 0.1));
    anchors.flywheel = V3(fx, fy, fz);
    // catwalk on the crown with a handrail, a caged ladder up the back of the right column
    const cw = [V3(-W / 2 - 0.1, topY, D / 2 + 0.1), V3(W / 2 + 0.1, topY, D / 2 + 0.1), V3(W / 2 + 0.1, topY, -D / 2 - 0.1), V3(-W / 2 - 0.1, topY, -D / 2 - 0.1), V3(-W / 2 - 0.1, topY, D / 2 + 0.1)];
    P.add('rail', handrail(cw, 1.07, { toe: true }));
    P.add('rail', ladder(W / 2 - colW / 2, -D / 2 - 0.35, 0, topY + 1.0, { cage: true }));
    // the slide: a box casting with the upper die shoe, two connection housings into the crown, hazard stripe on its face
    const sw = W - 2 * colW - 0.25, sd = D * 0.75, sh = 1.1 * sc;
    openY = bedH + win - sh / 2 - 0.1; closedY = bedH + 0.18 + 0.5 * sc + 0.55 * sc + sh / 2;
    S.add('frame', G.box(sw, sh, sd, 0, 0, 0));
    S.add('haz', new THREE.PlaneGeometry(sw, 0.16).translate(0, -sh / 2 + 0.1, sd / 2 + 0.005));
    S.add('steel', G.box(sw * 0.92, 0.28 * sc, sd * 0.8, 0, -sh / 2 - 0.14 * sc, 0));     // upper shoe
    S.add('die', G.box(sw * 0.6, 0.28 * sc, sd * 0.5, 0, -sh / 2 - 0.42 * sc, 0));       // punch
    for (const s of [-1, 1]) S.add('steel', G.cyl(0.18 * sc, 0.18 * sc, win, s * sw * 0.25, sh / 2 + win / 2, 0, 16));   // connections (they slide into the crown)
    // lower shoe + die, guide posts
    P.add('steel', G.box(sw * 0.92, 0.3 * sc, sd * 0.8, 0, bedH + 0.18 + 0.15 * sc, 0));
    P.add('die', G.box(sw * 0.7, 0.35 * sc, sd * 0.55, 0, bedH + 0.18 + 0.3 * sc + 0.17 * sc, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add('chrome', G.cyl(0.06 * sc, 0.06 * sc, 0.9 * sc, sx * sw * 0.4, bedH + 0.18 + 0.3 * sc + 0.45 * sc, sz * sd * 0.3, 12));
    anchors.die = V3(0, bedH + 0.9 * sc, sd / 2);
    // the two-hand control station, light curtains, an E-stop
    const ox = -W / 2 - 0.6, oz = D / 2 + 1.1;
    P.add('frame', G.cyl(0.07, 0.09, 1.0, ox, 0.5, oz, 12), G.box(0.3, 0.02, 0.3, ox, 0.01, oz));
    P.add('frame', G.rbox(0.8, 0.22, 0.3, 0.04, ox, 1.1, oz).rotateX(0));
    for (const s of [-1, 1]) { P.add('black', G.cyl(0.07, 0.07, 0.05, ox + s * 0.28, 1.235, oz, 20)); P.add('guardY', G.cyl(0.1, 0.1, 0.06, ox + s * 0.28, 1.22, oz, 20, true)); }
    P.add('estop', new THREE.SphereGeometry(0.06, 16, 8, 0, TAU, 0, Math.PI / 2).translate(ox, 1.23, oz), G.cyl(0.05, 0.05, 0.03, ox, 1.23, oz, 16));
    anchors.operator = V3(ox, 0, oz + 0.45);
    for (const s of [-1, 1]) { P.add('guardY', G.box(0.1, 1.6, 0.1, s * (sw / 2 + 0.1), bedH + 0.8, D / 2 + 0.25)); P.add('black', G.box(0.03, 1.4, 0.03, s * (sw / 2 + 0.1) - s * 0.05, bedH + 0.8, D / 2 + 0.25)); }
    // expanded-metal guards on the sides of the die window (yellow)
    for (const s of [-1, 1]) P.add('guardY', G.box(0.03, 1.2, D * 0.5, s * (W / 2 + 0.03), bedH + 0.7, D * 0.2));
    // junction boxes and conduit on the left column
    P.add('frame', G.box(0.5, 0.7, 0.25, -W / 2 - 0.15, 2.6, D / 2 - 0.3));
    P.add('conduit', G.cyl(0.025, 0.025, topY - 2.9, -W / 2 - 0.1, (topY + 2.9) / 2, D / 2 - 0.3, 8));
    // the press number stencilled on the column face
    P.add('stencil', new THREE.PlaneGeometry(0.7, 0.7).translate(W / 2 - colW / 2, bedH + win * 0.65, D / 2 + 0.125));
    lights.push({ kind: 'ram', pos: V3(0, bedH + 0.6, D / 2 + 0.3), color: 0xfff0d8 });
    anchors.top = V3(0, topY + 1.5 * sc, 0);
  } else {
    // gap-frame (OBI): two C-shaped side plates, the ram in the throat, flywheel at the top rear, an inclinable base
    const sc = Math.cbrt(tons / 110), H = 3.0 * sc, D = 1.6 * sc, t = 0.12 * sc, gapZ = 0.55 * sc;
    const Cpts = [[-D / 2, 0], [D / 2, 0], [D / 2, 1.0 * sc], [D / 2 - gapZ * 1.2, 1.0 * sc], [D / 2 - gapZ * 1.2, 1.9 * sc], [D / 2, 1.9 * sc], [D / 2, H], [-D / 2 + 0.2, H], [-D / 2, H - 0.3]];
    for (const s of [-1, 1]) P.add('frame', G.extrude(Cpts, t, 0.02).rotateY(-Math.PI / 2).translate(s * 0.45 * sc, 0.4, 0));
    P.add('frame', G.box(0.9 * sc + t, 0.4, D + 0.2, 0, 0.2, 0), G.box(0.9 * sc - t, 0.12, gapZ * 1.4, 0, 1.0 * sc + 0.46, D / 2 - gapZ * 0.6));
    P.add('frame', G.box(0.9 * sc - t, 1.0 * sc, D * 0.5, 0, H - 0.5 * sc + 0.4, -D * 0.1));
    const fr = 0.55 * sc; P.add('steel', G.cylX(fr, 0.25, 0.45 * sc + 0.3, H + 0.1, -D * 0.25, 40)); P.add('guard', new THREE.CylinderGeometry(fr + 0.08, fr + 0.08, 0.35, 32, 1, false, 0, Math.PI * 1.3).rotateZ(Math.PI / 2).translate(0.45 * sc + 0.3, H + 0.1, -D * 0.25));
    P.add('frame', G.cylX(0.22 * sc, 0.6 * sc, -0.2, H + 0.4 + 0.25 * sc, -D * 0.35, 20));
    openY = 1.9 * sc + 0.4 - 0.35 * sc; closedY = 1.0 * sc + 0.4 + 0.35 * sc + 0.2;
    S.add('frame', G.box(0.5 * sc, 0.6 * sc, 0.45 * sc, 0, 0, 0)); S.add('die', G.box(0.35 * sc, 0.15 * sc, 0.3 * sc, 0, -0.35 * sc, 0)); S.add('haz', new THREE.PlaneGeometry(0.5 * sc, 0.1).translate(0, -0.25 * sc, 0.23 * sc));
    slide.position.z = D / 2 - gapZ * 0.6;
    P.add('die', G.box(0.4 * sc, 0.15 * sc, 0.32 * sc, 0, 1.0 * sc + 0.6, D / 2 - gapZ * 0.6));
    const ox = 0.9 * sc, oz = D / 2 + 0.6;
    P.add('frame', G.cyl(0.05, 0.07, 1.0, ox, 0.5, oz, 12), G.rbox(0.6, 0.18, 0.24, 0.03, ox, 1.08, oz));
    for (const s of [-1, 1]) P.add('black', G.cyl(0.055, 0.055, 0.04, ox + s * 0.2, 1.19, oz, 16));
    P.add('estop', new THREE.SphereGeometry(0.045, 12, 6, 0, TAU, 0, Math.PI / 2).translate(ox, 1.18, oz));
    P.add('plate', new THREE.PlaneGeometry(0.8 * sc, 0.25 * sc).translate(0, H - 0.2, 0).rotateY(0).translate(0, 0, -D * 0.1 + D * 0.25 + 0.01));
    P.add('stencil', new THREE.PlaneGeometry(0.4, 0.4).rotateY(Math.PI / 2).translate(0.45 * sc + t / 2 + 0.01, 1.5 * sc + 0.4, -D * 0.2));
    anchors.operator = V3(0, 0, D / 2 + 0.7); anchors.die = V3(0, 1.0 * sc + 0.7, D / 2 - gapZ * 0.6);
    lights.push({ kind: 'ram', pos: V3(0, 1.3 * sc, D / 2 + 0.2), color: 0xfff0d8 });
    anchors.top = V3(0, H + 0.8, 0);
  }
  const num = o.number ?? ('P-' + (1 + Math.floor(r() * 24)));
  const mats = {
    frame: paint(col, { grime: wearK * 0.6, grimeH: 1.6, edge: 0.45 * wearK, speck: 0.12 * wearK, rough: 0.55, metal: 0.25 }),
    cover: paint(col, { grime: wearK * 0.3, grimeH: 0.5, edge: 0.3, speck: 0.05, rough: 0.5, metal: 0.25 }),
    steel: fin('steel', { wear: { grime: 0.3, grimeH: 1.2 } }), dark: fin('black'), black: fin('black'), chrome: fin('chrome'),
    copper: mat('copper', { color: 0xb87333, rough: 0.35, metal: 1 }), conduit: fin('galv'),
    die: mat('die', { color: 0x3a3c3e, rough: 0.35, metal: 0.9, wear: { speck: 0.15, edge: 0.6, edgeColor: [0.8, 0.8, 0.78] } }),
    guard: paint(0xd9a21c, { grime: wearK * 0.4, grimeH: 1.0, edge: 0.4, rough: 0.5 }), guardY: paint(0xe0a81a, { grime: 0.3, edge: 0.5, rough: 0.5 }),
    rail: paint(0xd9a21c, { grime: 0.2, edge: 0.5, rough: 0.5, metal: 0.3 }),
    estop: mat('estop', { color: 0xc01010, rough: 0.3, emissive: 0x400000, emissiveIntensity: 0.3 }),
    haz: new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: 0.6 }),
    plate: new THREE.MeshStandardMaterial({ map: plateTex(`${tons} TON`, 'STRAIGHT SIDE  DOUBLE CRANK'), roughness: 0.5, metalness: 0.4 }),
    stencil: new THREE.MeshStandardMaterial({ map: stencilTex(num), transparent: true, roughness: 0.8, depthWrite: false }),
  };
  grp.add(P.build(mats));
  slide.add(S.build(mats)); grp.add(slide);
  const setStroke = u => { stroke = u; slide.position.y = openY + (closedY - openY) * u; };
  setStroke(o.stroke ?? 0.15);
  grp.userData.setStroke = setStroke;
  return finish(grp, { type: 'press', variant: { kind, tons, paint: col, wear: wearK, number: num }, ref: kind === 'gap' ? 'OBI gap-frame press, ' + tons + ' ton' : 'straight-side double-crank press, ' + tons + ' ton (Detroit body-panel line class)', anchors, lights });
}

// a transfer line: n presses in a row receding along -x, conveyors between them carrying blanks, the coil at the head
export function pressLine(o = {}) {
  const r = rng(o.seed ?? 7), n = o.n ?? 3, sp = o.spacing ?? 8.5, col = o.paint ?? PRESS_PAINTS[pick(r, Object.keys(PRESS_PAINTS))];
  const grp = new THREE.Group(), presses = [];
  for (let i = 0; i < n; i++) {
    const p = press({ seed: (o.seed ?? 7) * 10 + i, kind: 'straight', tons: o.tons ?? [1000, 800, 600, 600][i % 4], paint: col, wear: o.wear, number: 'P-' + (11 + i) });
    p.rotation.y = Math.PI / 2; p.position.x = -i * sp; grp.add(p); presses.push(p);
  }
  // conveyors between presses (belt, frame, legs) carrying pressed blanks (a door-panel shape)
  const C = new Parts();
  const blank = G.extrude([[-0.7, -0.45], [0.7, -0.45], [0.75, 0.2], [0.55, 0.45], [-0.6, 0.45], [-0.72, 0.1]], 0.03, 0.01).rotateX(Math.PI / 2);
  for (let i = 0; i < n - 1; i++) {
    const x0 = -i * sp - 2.3, x1 = -(i + 1) * sp + 2.3, L = x0 - x1, cx = (x0 + x1) / 2;
    C.add('frame', G.box(L, 0.15, 1.4, cx, 1.05, 0)); C.add('belt', G.box(L, 0.04, 1.2, cx, 1.14, 0));
    for (let k = 0; k <= 2; k++) for (const s of [-1, 1]) C.add('frame', G.box(0.08, 1.0, 0.08, x1 + L * k / 2, 0.5, s * 0.65));
    for (let k = 0; k < 2; k++) C.add('blank', blank.clone().translate(x1 + L * (0.3 + 0.4 * k), 1.2, 0));
  }
  // the coil and straightener at the head
  C.add('coilM', G.lathe([[0.35, -0.8], [1.0, -0.8], [1.0, 0.8], [0.35, 0.8], [0.35, -0.8]], 40).rotateX(Math.PI / 2).translate(sp * 0.75, 1.1, 0));
  C.add('frame', G.box(1.2, 1.3, 1.9, sp * 0.45, 0.65, 0));
  const mats = { frame: paint(col, { grime: 0.5, grimeH: 1.2, edge: 0.4, speck: 0.1 }), belt: fin('rubber'), blank: mat('blank', { color: 0xa9adb0, rough: 0.25, metal: 1 }), coilM: mat('coilM', { color: 0x8a8e92, rough: 0.3, metal: 1, wear: { speck: 0.2 } }) };
  grp.add(C.build(mats));
  grp.userData.presses = presses;
  grp.userData.setStroke = (u, phase = 0.33) => presses.forEach((p, i) => p.userData.setStroke(Math.max(0, Math.sin((u - i * phase) * Math.PI * 2)) ** 3));
  return finish(grp, { type: 'pressLine', variant: { n, paint: col }, ref: 'tandem press line, Detroit body-panel class', anchors: { head: V3(sp * 0.75, 1.1, 0) } });
}
