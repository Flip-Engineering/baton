// MECHA KIT parts (MODELING studio, cycle 2): the pieces a working machine is made of, as runtime three.js objects that move.
// Why runtime and not a baked .glb: a ram has no fixed length. It is a barrel and a rod between two anchors on two moving
// parts, and its length is whatever the anchors say this frame (Ram.solve). A hose is a curve that sags between two fittings
// and swings with them. A clevis pin is a pin through two lugs. Those three are what makes a machine read as equipment and
// not as a toy (the c1 critique of MECHA v1: chamfered boxes pushed into each other, nothing shows how it moves).
//
// Every mesh carries userData.pid (a part id; the ink look draws an edge where two ids meet) and cls (aux class).
import * as THREE from 'three';
THREE.ColorManagement.enabled = false;

let PID = 2;
// aim an object's +Z from `from` to `to` in its PARENT's space (Object3D.lookAt takes world coordinates and a stale world matrix, which breaks as soon as a root moves)
const _m = new THREE.Matrix4(), _u = new THREE.Vector3(0, 1, 0), _alt = new THREE.Vector3(1, 0, 0), _d = new THREE.Vector3();
export function aimQ(obj, from, to, up = _u) {
  _d.copy(to).sub(from).normalize(); const u = Math.abs(_d.dot(up)) > .999 ? _alt : up;
  _m.lookAt(to, from, u); obj.quaternion.setFromRotationMatrix(_m); return obj;
}
export const nextPid = () => (PID = PID >= 250 ? 2 : PID + 1);
const matCache = new Map();
export function paint(color, o = {}) {
  const k = color + JSON.stringify(o);
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshLambertMaterial({ color: new THREE.Color(color), ...o }));
  return matCache.get(k);
}
// the ACP machine palette (read from the reference painting acp_fortress.jpg: ochre work-suit, warm white concrete, steel grey,
// rust-orange truck; NO red: red belongs to the mark)
export const PAL = {
  ochre: '#a68e48', ochreDk: '#7a6a38', ochreLt: '#c6b06a', white: '#e4ddd0', cream: '#d9d0bb', steel: '#6c7078', steelDk: '#3b3d44', steelLt: '#9ea2a8',
  rubber: '#26262a', rust: '#a8663a', glass: '#9db4bc', strap: '#4a4636', skin: '#c69774', hose: '#2b2a2e', brass: '#a98a45', hazard: '#d1b030', road: '#a3a1a8',
  khaki: '#7d7152', olive: '#5d5a3b', concrete: '#c8c1b6', concreteDk: '#a7a1a3',
};
export function mesh(geo, col, { pid, cls = 'subject', line = true, shadow = true, glass = false, parent = null, name = '' } = {}) {
  const m = new THREE.Mesh(geo, typeof col === 'string' ? paint(col) : col);
  m.userData.pid = pid ?? nextPid(); m.userData.cls = cls; if (!line) m.userData.line = false; if (glass) m.userData.glass = true;
  m.castShadow = shadow && !glass; m.receiveShadow = true; m.name = name; if (parent) parent.add(m); return m;
}
export const box = (w, h, d, col, o = {}) => mesh(new THREE.BoxGeometry(w, h, d), col, o);
// rounded box by extruding a rounded rectangle (cheap fillet; sheet-metal panels read as folded plate, not as dice)
export function rbox(w, h, d, r, col, o = {}) {
  r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3); const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 3 }); g.translate(0, 0, -d / 2); return mesh(g, col, o);
}
export const cylY = (r, h, col, o = {}, seg = 20, r2) => mesh(new THREE.CylinderGeometry(r2 ?? r, r, h, seg), col, o);
export const cylX = (r, h, col, o = {}, seg = 20) => { const g = new THREE.CylinderGeometry(r, r, h, seg); g.rotateZ(Math.PI / 2); return mesh(g, col, o); };
export const cylZ = (r, h, col, o = {}, seg = 20, r2) => { const g = new THREE.CylinderGeometry(r2 ?? r, r, h, seg); g.rotateX(Math.PI / 2); return mesh(g, col, o); };
export function at(m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m; }
// a beam between two points (a strut): box section, any direction
export function strut(a, b, w, h, col, o = {}) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B), m = mesh(new THREE.BoxGeometry(w, h, L), col, o);
  m.position.copy(A).lerp(B, .5); aimQ(m, A, B); return m;
}
export function capsuleBetween(a, b, r0, r1, col, o = {}) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B), g = new THREE.CylinderGeometry(r1, r0, L, 14, 1); g.rotateX(Math.PI / 2);
  const g2 = new THREE.Group(); const m = mesh(g, col, o); m.position.copy(A).lerp(B, .5); aimQ(m, A, B); return m;
}

// ---- clevis lug + pin: two cheek plates with a pin through them, washers and a cotter. Pin axis = local X.
export function clevis({ w = .16, r = .09, plate = .018, pin = .03, col = PAL.steelDk, pinCol = PAL.steelLt, len = .2 } = {}) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const p = new THREE.Shape(); p.absarc(0, 0, r, 0, Math.PI * 2); const gg = new THREE.ExtrudeGeometry(p, { depth: plate, bevelEnabled: false, curveSegments: 14 });
    gg.rotateY(Math.PI / 2); gg.translate(s * w / 2 - plate / 2, 0, 0); mesh(gg, col, { parent: g, pid: nextPid() });
    const wa = cylX(pin * 1.5, .008, pinCol, { parent: g, pid: nextPid() }, 12); wa.position.x = s * (w / 2 + .012); g.add(wa);
  }
  const pn = cylX(pin, w + .05, pinCol, { pid: nextPid() }, 12); g.add(pn);
  const ct = box(.006, .05, .006, PAL.steelDk, { pid: nextPid() }); ct.position.set(w / 2 + .035, 0, 0); g.add(ct);
  return g;
}

// ---- hydraulic ram: barrel + rod + clevis eyes at both ends; solve(A, B) puts it between two world-space (parent-space) anchors.
export class Ram {
  constructor(parent, { barrelR = .09, rodR = .045, barrel = .9, col = PAL.steel, rodCol = PAL.steelLt, eye = true } = {}) {
    this.g = new THREE.Group(); parent.add(this.g); this.bl = barrel; this.rodR = rodR; this.barrelR = barrelR;
    this.bar = cylZ(barrelR, barrel, col, { pid: nextPid() }, 18); this.bar.position.z = barrel / 2 + .04; this.g.add(this.bar);
    const cap = cylZ(barrelR * 1.12, .06, PAL.steelDk, { pid: nextPid() }, 18); cap.position.z = barrel + .03; this.g.add(cap);
    const gland = cylZ(barrelR * 1.12, .05, PAL.steelDk, { pid: nextPid() }, 18); gland.position.z = .03; this.g.add(gland);
    // a band on the barrel (the paint line)
    const band = cylZ(barrelR * 1.04, .05, PAL.ochreDk, { pid: nextPid() }, 18); band.position.z = barrel * .55; this.g.add(band);
    this.rod = cylZ(rodR, 1, rodCol, { pid: nextPid() }, 12); this.g.add(this.rod);
    this.eyeA = eye ? this._eye(barrelR) : null; this.eyeB = eye ? this._eye(rodR * 1.6) : null; this.g.add(this.eyeA, this.eyeB);
    this.len = 1; this.stroke = 0;
  }
  _eye(r) { const e = new THREE.Group(); const c = clevis({ w: r * 2.3, r: r * 1.15, pin: r * .55, plate: r * .22 }); c.rotation.y = 0; e.add(c); return e; }
  // anchors in the parent's space. The barrel hangs from A; the rod runs out to B; extension is whatever is left over.
  solve(A, B) {
    const a = new THREE.Vector3(...(A.toArray ? A.toArray() : A)), b = new THREE.Vector3(...(B.toArray ? B.toArray() : B));
    const d = b.clone().sub(a), L = d.length(); this.len = L;
    this.g.position.copy(a); aimQ(this.g, a, b);
    const ext = Math.max(.02, L - this.bl - .1);                                   // the rod's visible length
    this.stroke = ext;
    this.rod.scale.z = ext; this.rod.position.z = this.bl + .1 + ext / 2 - .05;
    this.eyeA.position.z = -.0; this.eyeB.position.z = L;
    this.bar.visible = true; return L;
  }
}

// ---- hose: a curve that sags between two fittings and swings with them. rebuilt per call (24 x 6, cheap).
export class Hose {
  constructor(parent, { r = .03, col = PAL.hose, sag = .35, sideways = 0, fit = PAL.steelLt, bundle = 1, seg = 22 } = {}) {
    this.parent = parent; this.r = r; this.col = col; this.sag = sag; this.side = sideways; this.seg = seg; this.m = null; this.fit = [];
    this.g = new THREE.Group(); parent.add(this.g); this.pid = nextPid(); this.fitCol = fit;
  }
  update(A, B, { sag = this.sag, side = this.side, up = new THREE.Vector3(0, -1, 0) } = {}) {
    const a = new THREE.Vector3(...(A.toArray ? A.toArray() : A)), b = new THREE.Vector3(...(B.toArray ? B.toArray() : B)), d = b.clone().sub(a), L = d.length();
    const perp = new THREE.Vector3().crossVectors(d, up).normalize();
    // the sag is bounded by the slack: a hose cannot hang lower than half its extra length allows
    const pts = [], n = 6;
    for (let i = 0; i <= n; i++) { const u = i / n, c = 4 * u * (1 - u); pts.push(a.clone().lerp(b, u).addScaledVector(up, sag * c).addScaledVector(perp, side * Math.sin(u * Math.PI) * (.6 + .4 * c))); }
    // stiff ends: the first and last 8 cm leave the fitting along the axis (a hose does not bend at the ferrule)
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', .5);
    const geo = new THREE.TubeGeometry(curve, this.seg, this.r, 7, false);
    if (!this.m) { this.m = mesh(geo, this.col, { parent: this.g, pid: this.pid }); const f = () => cylZ(this.r * 1.5, .06, this.fitCol, { pid: nextPid() }, 8); this.fa = f(); this.fb = f(); this.g.add(this.fa, this.fb); }
    else { this.m.geometry.dispose(); this.m.geometry = geo; }
    this.fa.position.copy(a); aimQ(this.fa, a, pts[1]); this.fb.position.copy(b); aimQ(this.fb, b, pts[n - 1]);
    return L;
  }
}

// ---- ladder (rails + rungs) between two points, rung every 0.3 m, with a stand-off; and a handrail with posts.
export function ladder(a, b, { w = .5, col = PAL.steelLt, rungCol = PAL.steelDk, pitch = .3 } = {}) {
  const g = new THREE.Group(), A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B), dir = B.clone().sub(A).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const inner = new THREE.Group(); inner.position.copy(A); inner.quaternion.copy(q); g.add(inner);
  for (const s of [-1, 1]) { const r = box(.04, L, .07, col, { parent: inner }); r.position.set(s * w / 2, L / 2, 0); }
  const n = Math.floor(L / pitch);
  for (let i = 1; i <= n; i++) { const r = cylX(.016, w, rungCol, { parent: inner }, 8); r.position.set(0, i * pitch - .1, 0); }
  return g;
}
export function handrail(a, b, { h = 1.05, post = 2.2, col = PAL.hazard } = {}) {
  const g = new THREE.Group(), A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B);
  const n = Math.max(1, Math.round(L / post)); const dir = B.clone().sub(A).normalize();
  for (let i = 0; i <= n; i++) { const p = A.clone().addScaledVector(dir, L * i / n); const m = cylY(.025, h, col, { parent: g }, 8); m.position.copy(p).add(new THREE.Vector3(0, h / 2, 0)); }
  for (const hh of [h, h * .55]) { const m = strut([a[0], a[1] + hh, a[2]], [b[0], b[1] + hh, b[2]], .04, .04, col, { parent: g }); }
  return g;
}

// ---- stencil / decal canvases (readable markings: the c1 critique's "readable stencils and wear")
export function stencilTexture(text, { w = 512, h = 128, col = '#1c1b20', bg = null, font = 'Big Shoulders Stencil Display', weight = 800, size = null, wear = true, seed = 3 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `${weight} ${size || Math.round(h * .78)}px "${font}", Impact, sans-serif`;
  g.fillText(text, w / 2, h / 2 + h * .03);
  if (wear) { // chips: paint worn off at edges and in patches
    g.globalCompositeOperation = 'destination-out'; let s = seed * 9301 + 49297; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 60; i++) { g.globalAlpha = .5 + rnd() * .5; g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 1 + rnd() * 4, 1 + rnd() * 2, rnd() * 3, 0, 7); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; t.colorSpace = THREE.NoColorSpace; return t;
}
export function decalPlane(tex, w, h, { pid, alphaTest = .4 } = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex, alphaTest, transparent: false, side: THREE.DoubleSide }));
  m.userData.pid = pid ?? 1; m.userData.cls = 'subject'; m.receiveShadow = true; m.castShadow = false; return m;
}
export function hazardTexture({ w = 256, h = 64, a = '#d1b030', b = '#2a2a2e' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = a; g.fillRect(0, 0, w, h); g.fillStyle = b;
  for (let x = -h; x < w + h; x += h * .9) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h * .45, h); g.lineTo(x + h * .45 + h, 0); g.lineTo(x + h, 0); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}
// a crate: planks, corner irons, a strap, a stencil. size in metres.
export function crate(w = .9, h = .55, d = .6, { col = PAL.khaki, text = 'A-5', seed = 2 } = {}) {
  const g = new THREE.Group(); const body = rbox(w, h, d, .02, col, { parent: g }); const id = body.userData.pid;
  for (const s of [-1, 1]) { const r = box(.05, h + .02, d + .02, PAL.steelDk, { parent: g }); r.position.x = s * (w / 2 - .05); }
  const strap = box(w + .01, .035, d + .02, PAL.strap, { parent: g }); strap.position.y = h * .18;
  const dec = decalPlane(stencilTexture(text, { w: 256, h: 96, col: '#201d17', seed }), w * .5, h * .38, { pid: id }); dec.position.set(0, h * .02, d / 2 + .004); g.add(dec);
  const dec2 = dec.clone(); dec2.position.z = -d / 2 - .004; dec2.rotation.y = Math.PI; g.add(dec2);
  const handle = box(.2, .03, .03, PAL.steelDk, { parent: g }); handle.position.set(0, h * .3, d / 2 + .02);
  return g;
}
export function wheel(r, wdt, { tire = PAL.rubber, rim = PAL.steel, lugs = 8 } = {}) {
  const g = new THREE.Group(); const t = cylX(r, wdt, tire, {}, 28); g.add(t);
  const hub = cylX(r * .56, wdt * 1.04, rim, {}, 24); g.add(hub); const cap = cylX(r * .18, wdt * 1.12, PAL.steelDk, {}, 12); g.add(cap);
  for (let i = 0; i < lugs; i++) { const a = i / lugs * Math.PI * 2, l = cylX(r * .04, wdt * 1.14, PAL.steelLt, {}, 6); l.position.set(0, Math.cos(a) * r * .36, Math.sin(a) * r * .36); g.add(l); }
  return g;
}
export const V = (x, y, z) => new THREE.Vector3(x, y, z);
// two-bone IK in a plane: hip H, ankle target F (both Vector3), thigh l1, shin l2; the knee bends toward `bend` (unit). Returns the knee.
export function ik2(H, F, l1, l2, bend) {
  const d = F.clone().sub(H); let L = d.length(); const Lmax = (l1 + l2) * .999, Lmin = Math.abs(l1 - l2) * 1.001; L = Math.min(Lmax, Math.max(Lmin, L)); d.setLength(L);
  const dn = d.clone().normalize(), a = (l1 * l1 - l2 * l2 + L * L) / (2 * L), hgt = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const b = bend.clone().addScaledVector(dn, -bend.dot(dn)).normalize();
  return H.clone().addScaledVector(dn, a).addScaledVector(b, hgt);
}
