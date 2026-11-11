// cobot_wrist: the last links of a collaborative arm, the part a hand actually touches (hand-guided teaching).
//
// Reference (why it is specific): real cobots are taught by hand. FANUC CRX: buttons on the wrist, the operator holds the
// tool and pushes it, the arm follows ("CRX wrist button function", techtransfer.fanucamerica.com); Universal Robots
// Freedrive on the tool flange. Proportions after the UR3e/CRX-5iA class: 45-50 mm link tube, 90-110 mm joint drums, a
// 63 mm ISO 9409-1-50-4-M6 tool flange (four M6 on a 50 mm circle, 31.5 mm pilot), a status light ring on each joint.
// Built for the SAME HANDS. shot: the hand lies on this, so it is modelled at hand scale (1 unit = 1 m).
// Axis: the forearm runs along +Y ending at the wrist joint; the flange faces +Z.
export const meta = {
  type: 'cobot', title: 'Collaborative arm wrist (hand-guiding)',
  refs: [
    { what: 'wrist button / hand-guiding function', url: 'https://techtransfer.fanucamerica.com/tech-transfer/crx-wrist-button-function', use: 'the two teach buttons on the wrist housing and the light ring' },
    { what: 'tool flange pattern', std: 'ISO 9409-1-50-4-M6', use: 'four M6 bolts on a 50 mm circle, pilot bore' },
  ],
  licence: { geometry: 'original, built for this project (CC0)', references: 'measurements and functions only, no third-party geometry' },
  changes: ['modelled from the reference proportions with manifold-3d (bores, grooves, bolt circle)', 'vertex AO, convex-edge and part-id bake'],
  bake: { maxEdge: 0.02, rays: 32, maxDist: 0.12 },
  used_by: ['modeling c1 SAME HANDS. demo'],
};

export async function build(k) {
  const parts = [];
  const groove = (m, r, y, w = 0.0025, d = 0.0015) => k.sub(m, k.sub(k.cyl(r + 0.01, w, 0, y, 0, 40), k.cyl(r - d, w + 0.001, 0, y, 0, 40)));
  // forearm tube, chamfered, with two panel seams and a cable boss at the base
  let fore = k.rcyl(0.046, 0.42, 0.006, 0, -0.21, 0, 40);
  fore = groove(fore, 0.046, -0.06); fore = groove(fore, 0.046, -0.3);
  const boss = k.rcyl(0.016, 0.03, 0.004, 0, 0, 0, 20);
  parts.push({ name: 'forearm', mat: 'paint.cobot', geo: k.geo(k.add(fore)), maxEdge: 0.02 });
  parts.push({ name: 'cable_gland', mat: 'alu.black', geo: k.geo(k.move(k.rot(boss, 90, 0, 0), 0.0, -0.4, 0.05)), maxEdge: 0.012 });
  // wrist joint 1: a drum coaxial with the forearm, black cap, light ring
  const drumA = k.rcyl(0.05, 0.085, 0.008, 0, 0.05, 0, 40);
  parts.push({ name: 'joint_a', mat: 'paint.cobot', geo: k.geo(drumA), maxEdge: 0.02 });
  parts.push({ name: 'ring_a', mat: 'emit.ring', geo: k.geo(k.cyl(0.0512, 0.009, 0, 0.0, 0, 40)), maxEdge: 0.02 });
  // elbow-ish drum across (axis X): a casting with a boss both sides, black end caps, light rings
  const drumB = k.rot(k.rcyl(0.05, 0.13, 0.008, 0, 0, 0, 40), 0, 0, 90);
  parts.push({ name: 'joint_b', mat: 'paint.cobot', geo: k.geo(k.move(drumB, 0, 0.145, 0)), maxEdge: 0.02 });
  for (const s of [-1, 1]) {
    parts.push({ name: 'cap_b' + (s < 0 ? 'L' : 'R'), mat: 'alu.black', geo: k.geo(k.move(k.rot(k.rcyl(0.034, 0.012, 0.004, 0, 0, 0, 32), 0, 0, 90), s * 0.069, 0.145, 0)), maxEdge: 0.012 });
    parts.push({ name: 'ring_b' + (s < 0 ? 'L' : 'R'), mat: 'emit.ring', geo: k.geo(k.move(k.rot(k.cyl(0.0512, 0.008, 0, 0, 0, 40), 0, 0, 90), s * 0.045, 0.145, 0)), maxEdge: 0.02 });
  }
  // wrist 3 housing (axis Z): a shorter drum whose face is the tool flange; teach buttons on its top
  let wr = k.rot(k.rcyl(0.043, 0.095, 0.007, 0, 0, 0, 40), 90, 0, 0);
  parts.push({ name: 'joint_c', mat: 'paint.cobot', geo: k.geo(k.move(wr, 0, 0.145, 0.105)), maxEdge: 0.02 });
  parts.push({ name: 'ring_c', mat: 'emit.ring', geo: k.geo(k.move(k.rot(k.cyl(0.0442, 0.008, 0, 0, 0, 40), 90, 0, 0), 0, 0.145, 0.083)), maxEdge: 0.02 });
  // the flange: steel plate, four M6 heads on a 50 mm circle, pilot bore, a keyed collar
  let fl = k.cylZ(0.0315, 0.012, 0, 0.145, 0.1575, 48);
  fl = k.sub(fl, k.cylZ(0.0085, 0.02, 0, 0.145, 0.1575, 24));
  const bolts = []; for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2; bolts.push(k.cylZ(0.0042, 0.006, Math.cos(a) * 0.025, 0.145 + Math.sin(a) * 0.025, 0.163, 6)); }
  parts.push({ name: 'flange', mat: 'steel.flange', geo: k.geo(fl), maxEdge: 0.008 });
  parts.push({ name: 'flange_bolts', mat: 'steel.flange', geo: k.geo(k.add(...bolts)), maxEdge: 0.006 });
  // two teach buttons on the wrist drum (rubber, one with a green edge), set in a recessed pad, as on a CRX / UR wrist; they face +Z, where the hand lies
  const pad = k.sub(k.rbox(0.052, 0.046, 0.014, 0.004, 0, 0.05, 0.047), k.rbox(0.045, 0.038, 0.02, 0.003, 0, 0.05, 0.058));
  parts.push({ name: 'button_pad', mat: 'alu.black', geo: k.geo(pad), maxEdge: 0.01 });
  parts.push({ name: 'button_a', mat: 'rubber.btn', geo: k.geo(k.rcyl(0.0085, 0.008, 0.002, 0, 0, 0, 24) && k.move(k.rot(k.rcyl(0.0085, 0.010, 0.002, 0, 0, 0, 24), 90, 0, 0), -0.0115, 0.05, 0.0525)), maxEdge: 0.006 });
  parts.push({ name: 'button_b', mat: 'rubber.btn_green', geo: k.geo(k.move(k.rot(k.rcyl(0.0085, 0.010, 0.002, 0, 0, 0, 24), 90, 0, 0), 0.0115, 0.05, 0.0525)), maxEdge: 0.006 });
  return { parts, anchors: { ringA: [0, 0.0, 0], ringB: [0, 0.145, 0], ringC: [0, 0.145, 0.083], flange: [0, 0.145, 0.165], buttons: [0, 0.05, 0.055], forearmBase: [0, -0.42, 0] } };
}
