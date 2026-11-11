// MECHA PROLETARIAT (8 Oct, the asset remake): two rooms round one console, which v9 played with a single beige box.
//   Bridge   the crew's own: the glazed cab high in the giant (the yard far below through the glass), angle-iron framing, grating
//            underfoot, fluorescent battens (the rig's practicals), hard hats on hooks, a thermos, their names on tape on the console.
//            Small, warm, lived in.
//   Factory  someone else's plant: a long hall of latticed roof trusses on rows of I-beam columns, a concrete floor with saw joints
//            and oil, identical consoles in a ranked line going back under rows of mercury high-bays, a worker at every lever, and
//            the controller (an enclosure with its door open on relays, its pilot lamps lighting on the beat) at the near end.
// Both are built round the same console (mecha.props.js valveBank) at SET, so the crew's planned grips hold in either; the scene shows
// one shell or the other. SET: the console's origin (the floor under its centre line); the crew stand at z +0.42 facing +z.
import * as THREE from 'three';
import { G, Parts, V3, mat, fin, paint, canvasTex, ladder, handrail } from '../lib/fx/objects/kit.js';
import { glassMaterial, concreteMaterial } from '../lib/fx/light/surface.js';
import { People } from '../lib/fx/people.js';
import { controlCab, LEVER_X } from './mecha.props.js';
import { rng } from '../lib/kit.js';

const steelP = () => paint(0x4a4f52, { grime: 0.45, grimeH: 0.5, edge: 0.45, speck: 0.12, rough: 0.55, metal: 0.4 });

export class Bridge {
  constructor(parent, SET) {
    const g = this.g = new THREE.Group(); g.position.copy(SET); parent.add(g); const P = new Parts();
    const X0 = -4.9, X1 = 4.9, Z0 = -2.9, Z1 = 3.35, H = 3.2;
    // floor: open grating on stringers; a kick strip at the glass
    P.add('grate', G.box(X1 - X0, 0.04, Z1 - Z0, 0, -0.02, (Z0 + Z1) / 2));
    for (let x = X0 + 0.6; x < X1; x += 1.2) P.add('frame', G.box(0.08, 0.16, Z1 - Z0, x, -0.12, (Z0 + Z1) / 2));
    // the glass front, leaning out at the top, with mullions, a sill and the wiper bar; corner glazing down the sides
    const lean = 0.2, sill = 0.92, gh = H - 0.2 - sill;
    P.add('frame', G.box(X1 - X0, sill, 0.12, 0, sill / 2, Z1 - 0.06), G.box(X1 - X0, 0.14, 0.3, 0, sill + 0.02, Z1 - 0.15));
    for (let k = 0; k <= 6; k++) { const x = X0 + k * (X1 - X0) / 6; P.add('frame', G.box(0.1, gh, 0.12, 0, 0, 0).rotateX(-lean).translate(x, sill + gh / 2, Z1 + Math.sin(lean) * gh / 2)); }
    P.add('frame', G.box(X1 - X0, 0.14, 0.14, 0, H - 0.18, Z1 + Math.sin(lean) * gh));
    for (const s of [-1, 1]) { const x = s > 0 ? X1 : X0;
      P.add('frame', G.box(0.12, sill, Z1 - Z0, x, sill / 2, (Z0 + Z1) / 2), G.box(0.12, 0.12, Z1 - Z0, x, H - 0.1, (Z0 + Z1) / 2));
      for (const z of [Z0, Z0 + 2.2, Z1 - 0.06]) P.add('frame', G.box(0.12, H - sill, 0.12, x, sill + (H - sill) / 2, z));
      P.add('wall', G.box(0.06, H - sill, Z0 + 2.2 - Z0, x, sill + (H - sill) / 2, Z0 + 1.1)); }
    // the back wall: plate with angle-iron stiffeners, a door, hooks with hard hats, a jacket, a fire extinguisher
    P.add('wall', G.box(X1 - X0, H, 0.08, 0, H / 2, Z0));
    for (let x = X0 + 1.1; x < X1; x += 1.4) P.add('frame', G.box(0.07, H, 0.07, x, H / 2, Z0 + 0.08));
    P.add('door', G.box(0.95, 2.05, 0.05, X1 - 1.4, 1.03, Z0 + 0.06)); P.add('chrome', G.box(0.04, 0.14, 0.05, X1 - 1.8, 1.05, Z0 + 0.12));
    for (let k = 0; k < 4; k++) { const x = X0 + 0.9 + k * 0.6; P.add('chrome', G.cylZ(0.012, 0.1, x, 1.78, Z0 + 0.12, 8));
      P.add(k % 2 ? 'hatY' : 'hatW', new THREE.SphereGeometry(0.15, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.85, 1.15).rotateX(-1.2).translate(x, 1.72, Z0 + 0.2)); }
    P.add('jacket', G.rbox(0.5, 0.75, 0.12, 0.05, X0 + 3.5, 1.45, Z0 + 0.16));
    P.add('red', G.cyl(0.08, 0.08, 0.5, X0 + 0.35, 0.3, Z0 + 0.2, 16)); P.add('black', G.cyl(0.02, 0.02, 0.1, X0 + 0.35, 0.6, Z0 + 0.2, 8));
    // the ceiling: plate on I-beam joists; the battens' mounts are the practicals' own fixtures
    P.add('wall', G.box(X1 - X0, 0.06, Z1 - Z0 + 0.4, 0, H + 0.03, (Z0 + Z1) / 2 + 0.2));
    for (let x = X0 + 1.6; x < X1; x += 1.6) P.add('frame', G.box(0.12, 0.22, Z1 - Z0, x, H - 0.11, (Z0 + Z1) / 2));
    // a thermos and a lunch tin on the console's end, a clipboard
    P.add('thermos', G.cyl(0.045, 0.045, 0.3, 3.35, 0.48, 1.1, 18)); P.add('black', G.cyl(0.04, 0.045, 0.06, 3.35, 0.66, 1.1, 18));
    P.add('tin', G.rbox(0.28, 0.12, 0.18, 0.02, 3.2, 0.39, 0.85));
    const mats = { grate: mat('grate', { color: 0x6d706c, rough: 0.6, metal: 0.6, wear: { grime: 0.6, grimeH: 0.1, edge: 0.6, speck: 0.15 } }), frame: steelP(), wall: paint(0x5d6461, { grime: 0.35, grimeH: 0.4, edge: 0.3, speck: 0.08, rough: 0.6 }),
      door: paint(0x50585a, { grime: 0.5, grimeH: 1.4, edge: 0.6, speck: 0.08 }), chrome: fin('chrome'), hatY: mat('hatY', { color: 0xd8a614, rough: 0.35, wear: { edge: 0.4, grime: 0.3, grimeH: 2 } }), hatW: mat('hatW', { color: 0xe6e2d6, rough: 0.35, wear: { edge: 0.3, grime: 0.4, grimeH: 2 } }),
      jacket: mat('jacket', { color: 0x5a4632, rough: 0.9, wear: { grime: 0.3, grimeH: 2 } }), red: mat('extRed', { color: 0xa81c14, rough: 0.35 }), black: fin('black'), thermos: mat('thermos', { color: 0x2f5a3a, rough: 0.4, metal: 0.3, wear: { edge: 0.7 } }),
      tin: mat('tin', { color: 0x8a8c8a, rough: 0.35, metal: 0.8, wear: { edge: 0.5 } }) };
    g.add(P.build(mats));
    // the glazing: a dielectric that reflects the sky, dirt toward the sills
    const gm = glassMaterial({ tint: 0x10161a, dirt: 0.35 }); gm.transparent = true; gm.opacity = 0.32; gm.depthWrite = false;
    for (let k = 0; k < 6; k++) { const x0 = X0 + k * (X1 - X0) / 6, x1 = x0 + (X1 - X0) / 6, p = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 0.1, gh), gm); p.position.set((x0 + x1) / 2, sill + gh / 2, Z1 + Math.sin(lean) * gh / 2); p.rotation.x = -lean; p.renderOrder = 2; g.add(p); }
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(Z1 - 0.1 - (Z0 + 2.2), H - sill - 0.2), gm); p.position.set(s > 0 ? X1 : X0, sill + (H - sill) / 2, (Z0 + 2.2 + Z1) / 2); p.rotation.y = Math.PI / 2; p.renderOrder = 2; g.add(p); }
    g.traverse(o => { if (o.isMesh) { o.castShadow = o.material !== gm; o.receiveShadow = true; } });
    this.glass = gm;
  }
}

// people.js workers posed at their levers: both arms forward and down to the grips, the stroke k (0 drawn back .. 1 thrown) dragging them
function leverPose(k) { return (out, st, API) => { const { ARM, B } = API; const kk = st._k ?? 0;
  for (const s of [1, -1]) { const [ua, fa] = ARM(s); out[ua * 3] = -0.62 - 0.42 * kk; out[ua * 3 + 2] = s * 0.12; out[fa * 3] = -0.55 + 0.38 * kk; }
  out[B.chest * 3] = 0.06 + 0.06 * kk; out[B.head * 3] = 0.12; void k; }; }

export class Factory {
  constructor(parent, SET, bank, { n = 7, viewH = 1920 } = {}) {
    const g = this.g = new THREE.Group(); g.position.copy(SET); parent.add(g);
    const P = new Parts(), L = -n * 9.5 - 14, X1 = 12, Z0 = -16, Z1 = 9, H = 10.5;
    // floor: concrete with saw joints and oil (light/'s concrete)
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(X1 - L, Z1 - Z0), concreteMaterial({ base: 0x7d7a72, joint: 4, cracks: 0.25, oil: 0.45, dirt: 0.5, rough: 0.85 }));
    fl.rotation.x = -Math.PI / 2; fl.position.set((L + X1) / 2, 0.002, (Z0 + Z1) / 2); fl.receiveShadow = true; g.add(fl); this.floor = fl;
    // rows of I-beam columns, latticed roof trusses between them, purlins, a corrugated roof and walls
    const colX = []; for (let x = X1 - 2; x > L; x -= 9.5) colX.push(x);
    for (const x of colX) for (const z of [Z0 + 1, Z1 - 1]) { P.add('steel', G.box(0.36, H, 0.06, x, H / 2, z), G.box(0.06, H, 0.4, x - 0.15, H / 2, z), G.box(0.06, H, 0.4, x + 0.15, H / 2, z)); P.add('conc', G.box(0.9, 0.3, 0.9, x, 0.15, z)); }
    for (const x of colX) { const y0 = H - 0.2, y1 = H + 2.2;
      P.add('steel', G.box(0.12, 0.16, Z1 - Z0, x, y0, (Z0 + Z1) / 2));
      for (let k = 0; k <= 10; k++) { const z = Z0 + 1 + k * (Z1 - Z0 - 2) / 10, rise = 1 - Math.abs((z - (Z0 + Z1) / 2) / ((Z1 - Z0) / 2)); const top = y0 + 0.2 + (y1 - y0) * rise;
        P.add('steel', G.box(0.08, top - y0, 0.08, x, (y0 + top) / 2, z)); if (k < 10) { const z2 = Z0 + 1 + (k + 1) * (Z1 - Z0 - 2) / 10, r2 = 1 - Math.abs((z2 - (Z0 + Z1) / 2) / ((Z1 - Z0) / 2)), t2 = y0 + 0.2 + (y1 - y0) * r2;
          P.add('steel', G.rod(V3(x, top, z), V3(x, t2, z2), 0.05, 4), G.rod(V3(x, k % 2 ? top : y0, z), V3(x, k % 2 ? y0 : t2, z2), 0.035, 4)); } } }
    for (let z = Z0 + 1; z <= Z1 - 1; z += 2.5) P.add('steel', G.box(X1 - L, 0.1, 0.1, (L + X1) / 2, H + 1.9 - Math.abs(z - (Z0 + Z1) / 2) * 0.3, z));
    P.add('roof', G.box(X1 - L, 0.05, Z1 - Z0, (L + X1) / 2, H + 2.6, (Z0 + Z1) / 2));
    P.add('wall', G.box(X1 - L, H + 2.6, 0.08, (L + X1) / 2, (H + 2.6) / 2, Z0), G.box(X1 - L, H + 2.6, 0.08, (L + X1) / 2, (H + 2.6) / 2, Z1));
    P.add('wall', G.box(0.08, H + 2.6, Z1 - Z0, X1, (H + 2.6) / 2, (Z0 + Z1) / 2), G.box(0.08, H + 2.6, Z1 - Z0, L, (H + 2.6) / 2, (Z0 + Z1) / 2));
    // a yellow walkway line down the hall, a guard rail along the line of stations
    P.add('yellow', G.box(X1 - L, 0.005, 0.12, (L + X1) / 2, 0.006, -1.4), G.box(X1 - L, 0.005, 0.12, (L + X1) / 2, 0.006, 2.4));
    const mats = { steel: paint(0x59605e, { grime: 0.35, grimeH: 1.5, edge: 0.3, speck: 0.1, rough: 0.55, metal: 0.35 }), conc: fin('concrete'),
      roof: mat('roofIn', { color: 0x3c4040, rough: 0.8 }), wall: mat('cladding', { color: 0x6e7470, rough: 0.7, metal: 0.3, wear: { grime: 0.4, grimeH: 3, streak: 2 } }), yellow: mat('walkLine', { color: 0xc89a18, rough: 0.6, wear: { grime: 0.5, grimeH: 0.3 } }) };
    g.add(P.build(mats));
    // the line: identical consoles going back (the near one is the crew's, shared), each a clone of the same bank
    this.stations = [];
    const ud = bank.userData; bank.userData = {};
    for (let i = 1; i <= n; i++) { const c = bank.clone(true); c.position.set(-i * 9.5, 0, 0); g.add(c); const lev = []; for (let k = 0; k < LEVER_X.length; k++) { const p = c.getObjectByName('lever' + k); if (p) lev.push(p); } this.stations.push({ g: c, lev }); }
    bank.userData = ud;
    // the workers at the line (people.js; v7 people only at the near console): five at each station, facing the console
    this.folkG = new THREE.Group(); parent.add(this.folkG);   // people.js places in world space: its meshes live at the origin
    this.folk = new People(this.folkG, { max: n * 5 + 4, viewH, budget: [20, 60] }); this.workers = [];
    const R = rng(91); const TR = ['overalls', 'steel', 'rail'];
    for (let i = 1; i <= n; i++) for (let k = 0; k < 5; k++) { const id = this.folk.add(People.varied(TR[(R() * 3) | 0], 900 + i * 7 + k)); this.workers.push({ id, x: -i * 9.5 + [-2.2, -1.25, -0.3, 0.65, 1.6][k], z: 0.42, ph: R() }); }
    // the controller, at the near end against the hall's wall (its door open on relays; pilot lamps light on the beat)
    this.ctl = controlCab(); this.ctl.position.set(5.6, 0, -1.2); this.ctl.rotation.y = -Math.PI / 2; g.add(this.ctl);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }
  // per frame: every station's levers at the machine's stroke; the workers' arms dragged with them
  update(k, t, camera, visible = true) {
    this.g.visible = visible; this.folkG.visible = visible; if (!visible) return;
    for (const s of this.stations) s.lev.forEach((p, i) => { p.rotation.x = (-0.26 + 0.42 * k) * (0.86 + 0.14 * Math.sin(i * 2.1 + 1)); });
    for (const w of this.workers) this.folk.set(w.id, { x: this.g.position.x + w.x, y: this.g.position.y, z: this.g.position.z + w.z, heading: 0, act: 'stand', t: t + w.ph * 5, visible: true, pose: leverPose(), _k: k });
    this.folk.update(camera);
  }
}
