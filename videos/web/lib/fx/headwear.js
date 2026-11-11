// HEADWEAR: designed hat and hood silhouettes for people.js bodies (HUMAN studio, cycle 3).
//
// Why: at feed size a crowd's heads are the only detail that reads, and people.js's five trade hats all read as the
// same dome ("bowl heads"). These are cut to be told apart as SILHOUETTES from behind and three-quarter (Arntz: the
// silhouette is a footprint of the thing): the height of the crown, whether a brim breaks the outline, and whether
// the shape drapes down onto the shoulders.
//
//   import { HEADWEAR, headwearMesh, attachHeadwear } from './headwear.js';
//   const id = folk.add({ ...People.varied('rail', 5), hat: false });      // switch the body's own hat off
//   const hw = attachHeadwear(scene, folk, id, 'flatcap', '#2a2622');       // after every folk.update(camera): hw.update()
//
// Kinds (bind space of people.js: metres, the head centre near (0, 1.665, 0.01), facing +z):
//   hard     V-Gard hard hat: an egg crown with a centre ridge, a short front peak angled down, a drip rim at the sides
//   flatcap  a newsboy / flat cap: a flat crown wider than the head, pulled forward over a short stiff peak
//   cap      a ball cap: a round six-panel crown and a curved bill
//   knit     a watch cap with a turned cuff, sitting high (a small peak of cloth at the crown)
//   fedora   a pinched crown with a band and a brim all round, snapped down in front
//   hood     a work-jacket hood up: it frames the head and drapes onto the shoulders (breaks the neck line)
//   scarf    a headscarf tied at the nape, the knot's two tails hanging
//   ushanka  a fur cap with its flaps tied up (a wide, square, soft silhouette)
// Every mesh has userData.subject = 1 and userData.part = 'hat' (the SIL bake reads it as a head accent).
import * as THREE from 'three';

export const HEADWEAR = ['hard', 'flatcap', 'cap', 'knit', 'fedora', 'hood', 'scarf', 'ushanka'];
const HC = [0, 1.665, 0.01], HEADJ = [0, 1.6, -0.008];           // people.js HEADC and the head joint (bind)
const sst = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

function lathe(profile, seg, fn) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg), P = g.attributes.position;
  for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), r = Math.hypot(x, z) || 1e-6; const q = fn(x / r, z / r, r, y); P.setXYZ(i, q[0], q[1], q[2]); }
  g.computeVertexNormals(); return g;
}
// a closed crown profile (radius, height) from the band (y = 0) up to the top
const crown = (rb, h, bulge = 0.06, top = 0.8, n = 14) => { const pts = []; for (let k = 0; k <= n; k++) { const a = k / n; const r = rb * (1 + bulge * Math.sin(a * Math.PI * 0.9)) * Math.cos(Math.pow(a, 1.6) * Math.PI / 2 * top + 0) ; pts.push([Math.max(0.0005, a >= 1 ? 0.0005 : r * (1 - Math.pow(a, 3) * (1 - 0.0))), h * Math.sin(a * Math.PI / 2)]); } return pts; };

// The geometry of each kind, bind space. The skull at the band (y ~1.705) is about 0.095 m (x) by 0.112 m (z).
export function headwearMesh(kind, color = '#2a2622', { seg = 40 } = {}) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: kind === 'hard' ? 0.35 : 0.9, metalness: 0, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.45), roughness: 0.95, side: THREE.DoubleSide });
  const add = (geo, m = mat) => { const me = new THREE.Mesh(geo, m); g.add(me); return me; };
  const RX = 0.101, RZ = 0.118, BAND = 1.702;
  if (kind === 'hard') {
    // crown: an egg, taller than a bowler (the band sits low, the top 0.15 m above it); a raised centre ridge front to back
    const pr = []; for (let k = 0; k <= 18; k++) { const a = k / 18, th = a * Math.PI / 2; pr.push([Math.max(0.0005, Math.cos(th) * (1 + 0.05 * Math.sin(th * 1.6))), Math.sin(th) * 1.3]); }
    add(lathe(pr, seg, (cx, cz, r, y) => {
      const ridge = 1 + 0.07 * Math.exp(-Math.pow(cx / 0.13, 2)) * sst(0.35, 1.1, y);
      const fwd = cz > 0 ? 1.04 : 1;                                                   // a little longer in front
      return [cx * r * RX * 1.09 * ridge, BAND - 0.012 + y * 0.118, cz * r * RZ * 1.07 * ridge * fwd]; }));
    // the brim: a narrow drip rim round the sides and back that turns DOWN, stretched into a peak in front, angled down
    const br = [[1.0, 0], [1.1, -0.004], [1.2, -0.012], [1.24, -0.03], [1.21, -0.034]];
    add(lathe(br, seg, (cx, cz, r, y) => {
      const front = Math.pow(Math.max(0, cz), 2.2), ext = 1 + (r - 1) * (1 + 2.6 * front);  // the peak: 2.6x the rim's reach at the front
      const drop = -0.035 * front * (r - 1) / 0.24;                                      // the peak slopes down ~15 degrees
      return [cx * ext * RX * 1.09, BAND - 0.012 + y + drop, cz * ext * RZ * 1.07]; }));
    // the suspension band inside the shell: closes the gap between hat and head (no sky under the brim)
    add(new THREE.CylinderGeometry(RX * 1.02, RX * 1.02, 0.03, seg, 1, true), dark).position.set(0, BAND - 0.01, 0.005);
    g.children[2].scale.set(1, 1, RZ / RX);
  } else if (kind === 'flatcap') {
    // eight-panel flat cap: the crown flat and wider than the head, pulled down and forward, a short stiff peak
    const pr = [[1.0, 0], [1.08, 0.02], [1.18, 0.045], [1.2, 0.058], [1.1, 0.068], [0.6, 0.074], [0.0005, 0.075]];
    add(lathe(pr, seg, (cx, cz, r, y) => { const f = Math.max(0, cz); return [cx * r * RX * (1 + 0.04 * f), BAND - 0.02 + y + 0.016 * cz * sst(0.02, 0.06, y) - 0.004 * f, cz * r * RZ * (1 + 0.14 * f * sst(0.03, 0.07, y)) + 0.012 * f * sst(0.03, 0.07, y)]; }));
    const peak = new THREE.CylinderGeometry(0.1, 0.1, 0.006, 24, 1, false, -0.95, 1.9); peak.scale(1.0, 1, 0.55);
    add(peak).position.set(0, BAND - 0.02, 0.085); g.children[1].rotation.x = 0.22;
  } else if (kind === 'cap') {
    const pr = []; for (let k = 0; k <= 12; k++) { const th = k / 12 * Math.PI / 2; pr.push([Math.max(0.0005, Math.cos(th)), Math.sin(th) * 1.0]); }
    add(lathe(pr, seg, (cx, cz, r, y) => [cx * r * RX * 1.03, BAND - 0.01 + y * 0.1, cz * r * RZ * 1.02]));
    add(new THREE.SphereGeometry(0.009, 8, 6)).position.set(0, BAND + 0.092, 0.0);                   // the button
    const bill = new THREE.CylinderGeometry(0.095, 0.095, 0.005, 24, 3, false, -0.85, 1.7); const B = bill.attributes.position;
    for (let i = 0; i < B.count; i++) { const x = B.getX(i), z = B.getZ(i); B.setY(i, B.getY(i) - 1.4 * x * x); B.setZ(i, z * 0.8); } bill.computeVertexNormals();
    add(bill).position.set(0, BAND - 0.006, 0.075); g.children[2].rotation.x = 0.12;
  } else if (kind === 'knit') {
    // watch cap: rolled cuff (a torus band) and a crown that rides above the skull with a soft point
    const pr = []; for (let k = 0; k <= 14; k++) { const th = k / 14 * Math.PI / 2; pr.push([Math.max(0.0005, Math.cos(th) * (1 - 0.1 * Math.sin(th * 2))), Math.sin(th)]); }
    add(lathe(pr, seg, (cx, cz, r, y) => [cx * r * RX * 1.04, BAND - 0.015 + y * (0.12 + 0.02 * Math.pow(y, 4)), cz * r * RZ * 1.02]));
    const cuff = new THREE.TorusGeometry(1, 0.2, 8, seg); cuff.rotateX(Math.PI / 2); cuff.scale(RX * 1.07, 0.1, RZ * 1.05);
    add(cuff, dark).position.set(0, BAND - 0.003, 0);
  } else if (kind === 'fedora') {
    const pr = [[1.0, 0], [1.03, 0.05], [1.0, 0.1], [0.8, 0.125], [0.35, 0.13], [0.0005, 0.118]];   // the teardrop crease sinks the top
    add(lathe(pr, seg, (cx, cz, r, y) => { const pinch = 1 - 0.1 * Math.max(0, cz) * sst(0.05, 0.11, y); return [cx * r * RX * 1.08 * pinch, BAND - 0.012 + y, cz * r * RZ * 1.06]; }));
    const br = [[1.0, 0], [1.25, 0.0], [1.52, 0.006], [1.6, 0.012]];
    add(lathe(br, seg, (cx, cz, r, y) => { const snap = -0.03 * Math.max(0, cz) ** 2 * (r - 1) / 0.6 + 0.018 * Math.max(0, -cz) * (r - 1) / 0.6; return [cx * r * RX * 1.08, BAND - 0.012 + y + snap + 0.012 * Math.abs(cx) * (r - 1) / 0.6, cz * r * RZ * 1.06]; }));
    const band = new THREE.CylinderGeometry(RX * 1.1, RX * 1.1, 0.02, seg, 1, true); band.scale(1, 1, RZ / RX);
    add(band, dark).position.set(0, BAND - 0.002, 0);
  } else if (kind === 'hood') {
    // a hood up: a shell round the skull open at the face, falling to a cowl on the shoulders at the back
    const pr = []; for (let k = 0; k <= 16; k++) { const th = -0.9 + k / 16 * (Math.PI / 2 + 0.9); pr.push([Math.max(0.0005, Math.cos(th)), Math.sin(th)]); }
    add(lathe(pr, seg, (cx, cz, r, y) => {
      const back = Math.max(0, -cz), low = Math.max(0, -y);                                   // y < 0: below the band
      const sx = RX * 1.3 * (1 + 0.55 * low * (0.4 + back)), sz = RZ * 1.22 * (1 + 0.4 * low * back);
      const yy = BAND - 0.02 + (y > 0 ? y * 0.125 : y * (0.14 + 0.08 * back));
      return [cx * r * sx, yy, cz * r * sz - 0.01 - 0.03 * low * back]; }));
    // cut the face opening: drop the front verts inward (the hood's edge frames the face)
    { const m = g.children[0].geometry, P = m.attributes.position; for (let i = 0; i < P.count; i++) { const z = P.getZ(i), y = P.getY(i); if (z > 0.06 && y < BAND + 0.07) { const k = sst(0.06, 0.13, z); P.setZ(i, z - k * 0.07); } } m.computeVertexNormals(); }
  } else if (kind === 'scarf') {
    // a headscarf: tight over the crown, down behind the ears, gathered to a knot at the nape with two tails
    const pr = []; for (let k = 0; k <= 14; k++) { const th = -0.35 + k / 14 * (Math.PI / 2 + 0.35); pr.push([Math.max(0.0005, Math.cos(th)), Math.sin(th)]); }
    add(lathe(pr, seg, (cx, cz, r, y) => { const low = Math.max(0, -y), back = Math.max(0, -cz); return [cx * r * RX * 1.06 * (1 - 0.25 * low * back), BAND - 0.02 + y * 0.12, cz * r * RZ * 1.05 - 0.006]; }));
    const knot = new THREE.SphereGeometry(0.03, 12, 10); knot.scale(1.3, 0.9, 0.8); add(knot).position.set(0, 1.625, -0.1);
    for (const s of [-1, 1]) { const t = new THREE.BoxGeometry(0.035, 0.1, 0.006); t.translate(0, -0.05, 0); const m = add(t); m.position.set(0.012 * s, 1.62, -0.11); m.rotation.set(0.2, 0, 0.35 * s); }
  } else if (kind === 'ushanka') {
    // fur cap, flaps tied up: a boxy soft crown and a thick turned-up band all round
    const pr = [[1.0, 0], [1.05, 0.06], [1.02, 0.11], [0.85, 0.135], [0.0005, 0.14]];
    add(lathe(pr, seg, (cx, cz, r, y) => [cx * r * RX * 1.2 * (1 + 0.1 * Math.abs(cx) ** 4), BAND - 0.03 + y, cz * r * RZ * 1.14]), dark);
    const band = new THREE.TorusGeometry(1, 0.3, 10, seg); band.rotateX(Math.PI / 2); band.scale(RX * 1.28, 0.12, RZ * 1.2);
    add(band).position.set(0, BAND - 0.02, 0);
    for (const s of [-1, 1]) { const f = new THREE.SphereGeometry(0.05, 10, 8); f.scale(0.35, 1, 0.9); add(f).position.set(s * RX * 1.3, BAND + 0.02, -0.01); }   // the flaps tied up at the sides
  } else throw new Error('headwear kind ' + kind);
  g.traverse(m => { if (m.isMesh) { m.userData.subject = 1; m.userData.part = 'hat'; m.castShadow = true; } });
  return g;
}

// attach a designed hat to person `id` of a People instance. Returns { group, update() }: call update() after every
// folk.update(camera) (the hat rides the head bone: world = head matrix * T(-bind head joint)).
export function attachHeadwear(scene, folk, id, kind, color) {
  const inner = headwearMesh(kind, color), group = new THREE.Group(); group.add(inner); group.matrixAutoUpdate = false;
  const st = folk.get(id); const sc = (st.d.h || 1.78) / 1.78;
  inner.position.set(-HEADJ[0], -HEADJ[1], -HEADJ[2]);
  scene.add(group);
  const T = new THREE.Matrix4();
  return { group, kind, update() { const at = folk.att[id]; if (!at) return; T.copy(at.head); group.matrix.copy(T); group.matrixWorldNeedsUpdate = true; group.visible = folk.get(id).visible !== false; void sc; } };
}
