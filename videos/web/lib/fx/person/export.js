// PERSON / EXPORT (CYCLES, 3 Oct 2026): one person, built by makePerson, written out as files Blender reads (videos/blender/), so the
// same person record renders path-traced in Cycles and in our engine from ONE camera and ONE light description. It only reads a built
// person (no lane's file or hero.js is changed).
//
//   import { buildPerson, shotCamera, exportPerson, LIGHTS } from '../lib/fx/person/export.js';
//   const P = await buildPerson(st, 'L14_f42_black', { wear: 'work' | 'bare', seed: 1 });   // makePerson, the export's way
//   const cam = shotCamera(P, 'face' | 'bust' | 'full', { view: 0 });          // lab_person's framing, the same numbers (W, H, fov, lens)
//   const { manifest, buffers } = exportPerson(P, { cams: { face: cam, ... } });  // node: web/labs/human8/export_person.mjs writes them
//
// What is written (all in BLENDER's frame: x right, y = -three z, z up; metres; little-endian):
//   body       the posed, subdivided body: positions and shading normals (linear-blend skinned exactly as three.js does it on the GPU),
//              triangles, and per vertex the BIND position (three's frame: the coordinate lane B's skin, lane D's paint and lane E's
//              underwear are functions of; the Cycles bake samples them there), hero.js's aHero (region, limb coordinate, side, dorsal),
//              lane B's fields aLikeA (curvature, cavity AO, thin, sun) and aLikeB (melanin x, blood x, oil, volar)
//   garments   each visible garment mesh posed (after the drape), its bind/rest position, uv, its hero.js part key, its fabric (CLOTHING
//              c1 FABRICS name) and its dye
//   eyes       lane B's fitted globes (centre, radius, cornea radius and centre, the inset, the iris plane, the fissure per 10 degrees),
//              the iris colours (lane B's IRIS, linear), the pupil, and the head bone's bind -> posed matrix that carries them
//   hair       lane D's CARDS as centrelines (each ribbon's vertex pairs -> midpoint, half-width, side vector, card normal) per part
//              (scalp, brows, lashes, lashesLow, beard) with lane D's pigment (Chiang et al. 2016 eumelanin / pheomelanin) and grey;
//              Blender grows strands across each card (videos/blender/person_hair.py)
//   cameras    per shot: the camera's world matrix, vertical fov, W x H, the lens (fstop, focus) - lab_person's place() for front views
//   skin       lane B's person (Cm, beta, Ch, gamma, Cc), its LUT base albedo, the params it used; the skin itself is BAKED from lane B's
//              own shader into a UV atlas (labs/human8/bake_skin.mjs), so Cycles sees exactly the albedo the engine paints
import * as THREE from 'three';
import { makePerson } from './index.js';
import { whiteBalance } from '../light/color.js';

export const EXPORT_VERSION = 1;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const ANG = v => [0, -0.75, -Math.PI / 2, Math.PI][v] ?? 0;
// three (y up, z toward the viewer) -> Blender (z up, -y toward the viewer)
export const toBlender = (x, y, z) => [x, -z, y];
export const C2B = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);

// the shots of the bake-off: lab_person's framings (face, bust, solo = full) at its sizes; W x H can be overridden
export const SHOTS = { face: { W: 1080, H: 1350, label: 'face 1:1' }, bust: { W: 1080, H: 1350, label: 'bust' }, full: { W: 880, H: 1350, label: 'full figure' } };
// the lights both renderers are given. 'over': the engine's CIE overcast noon | in Cycles a CC0 overcast sky HDRI (Poly Haven). 'sun':
// a hard sun key from camera left and in front (37 degrees up), clear sky: the engine's clear-sky preset | Cycles' physical sky + a sun
// lamp of the sun's 0.53 degree disc. 'room': lab_person's life room (a clear sky, the sun softened to a large window).
export const LIGHTS = {
  over: { label: 'overcast', elevation: 50, azimuth: 160, wbK: 6500, engine: { preset: 'overcastNoon', opts: {} }, cycles: { kind: 'hdri', hdri: 'overcast', strength: 1 } },
  sun: { label: 'hard sun key', elevation: 37, azimuth: 228, wbK: 5600, engine: { preset: 'noonClear', opts: { sky: { kind: 'clear', elevation: 37, azimuth: 228, turbidity: 2.5 } } },
    cycles: { kind: 'sun', angle: 0.53, turbidity: 2.5 } },
  room: { label: 'life room', elevation: 48, azimuth: 225, wbK: 5600, engine: { preset: 'overcastNoon', opts: { sky: { kind: 'clear', elevation: 48, azimuth: 225, turbidity: 3 }, sun: { softness: 10, gain: 0.35 }, camera: { ev100: 12.4, wb: 5600 } } },
    cycles: { kind: 'sun', angle: 10, turbidity: 3, sunGain: 0.35 } },
};

// ---------------------------------------------------------------- the person: makePerson (the one current person), as the export takes it
// `export: true` tells the person the export takes the Cycles-side elements itself: cover8 below (after CORRECT5's corrected bind, as
// CLOTH8's export did) and the fine tier through the manifest's popts (person_scene fine7_apply); the manifest's popts carry the person's
// effective options (P.report.person.popts) under the caller's. CORRECT5's correctives live in the vertex shader, which the export's CPU
// skinning does not run: the body's bind positions take this pose's correctives (correctedBind) before anything reads them (the export and
// lab_bake's skin / garment bakes both come through here, so their meshes agree). wear 'bare' = the figure study (K3's real underwear).
// (integrator c6, 16 Oct) wear 'nude' = the figure study without the upper foundation (no cup, no painted band; the briefs kept): ANAT8-BODY's
// register for Cycles bust shots, an adult figure study (build.js WEAR.nude). Its body, face and anatomy keys are the bare register's.
export async function buildPerson(st, who, { wear = 'work', seed = 1, bakeUrl = null, personOpts = {} } = {}) {   // bakeUrl (opt-in): a bake folder
  const bareLike = wear === 'bare' || wear === 'nude';
  const P = await makePerson(who, { studio: st, stages: ['form', 'prior', 'face', 'detail', 'kin', 'hair', 'skin', 'eyes', 'found', ...(bareLike ? [] : ['stack'])], seed, ...(bakeUrl ? { bakeUrl } : {}), export: true, ...(wear === 'nude' ? { nude: true } : {}), ...personOpts });
  if (P.report.person?.popts) personOpts = { ...P.report.person.popts, ...personOpts };
  if (P.correct && personOpts.correctBind !== false) { const pa = P.h.body.geometry.attributes.position, cb = P.correct.correctedBind(); pa.array.set(cb); pa.needsUpdate = true; P.h.body.geometry.computeBoundingSphere(); P.correct.set({ on: false }); P.report.correctBind = true; }
  // (CLOTH8 c2) SHRINK, DON'T DROP: the culled skin under the clothes back in the index, pushed in (lib/fx/cloth/cloth8/cover8.js); here so
  // the export and lab_bake's bakes agree
  if (personOpts.cover8 && !bareLike) { const { applyCover8 } = await import('../cloth/cloth8/cover8.js'); P.report.cover8 = applyCover8(P, personOpts.cover8); }
  P.subdiv = P.h.body.geometry.userData.subdiv?.levels || 0; P.spec = { who: String(who), wear: bareLike ? wear : 'work', seed, subdiv: P.subdiv, stages: 'all', detail: P.subdiv, ...(bakeUrl ? { bake: String(bakeUrl).split('/').filter(Boolean).pop() } : {}), ...(Object.keys(personOpts).length ? { popts: personOpts } : {}) };
  return P;
}
// the person stands at the origin facing +z (three) turned by the view (lab_person's ANG: 0 front, 1 three-quarter, 2 profile, 3 back)
export function place(P, view = 0) { const h = P.h; h.group.position.set(0, 0, 0); h.group.rotation.y = ANG(view); h.update(); h.group.updateMatrixWorld(true); }

// ---------------------------------------------------------------- the camera: lab_person's place() with back = +z, side = +x
export function shotCamera(P, mode = 'full', { view = 0, W = null, H = null } = {}) {
  const S = SHOTS[mode] || SHOTS.full; W = W || S.W; H = H || S.H;
  place(P, view);
  const h = P.h, back = V3(0, 0, 1), side = V3(1, 0, 0), cam = new THREE.PerspectiveCamera(20, W / H, 0.02, 2000);
  const lens = { focal: 50, fstop: mode === 'face' ? 4 : 8, focus: 5 };
  if (mode === 'face') { const head = h.joint('head').add(V3(0, 0.05, 0)); cam.fov = 24; cam.position.copy(head).addScaledVector(back, 0.95).addScaledVector(side, -0.28); cam.lookAt(head.clone().add(V3(0, -0.07, 0))); }
  else if (mode === 'bust') { cam.fov = 26; const c = V3(0, h.o.height * 0.75, 0); cam.position.copy(c).addScaledVector(back, 1.6).addScaledVector(side, -0.35); cam.lookAt(c); }
  else { cam.fov = 20; const top = 1.12 * h.o.height, D = (top / 2) / Math.tan(THREE.MathUtils.degToRad(10)) * Math.max(1, (H / W) * 0.45); const c = V3(0, top / 2 - 0.03, 0); cam.position.copy(c).addScaledVector(back, D); cam.lookAt(c); }
  cam.aspect = W / H; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  lens.focus = cam.position.distanceTo(mode === 'face' ? h.joint('head') : h.joint('spine03'));
  cam.userData = { mode, view, W, H, lens };
  return cam;
}
// a camera as Blender takes it: the world matrix in Blender's frame (camera looks down its local -z, up local +y in both programs)
export function cameraRecord(cam) {
  const M = C2B.clone().multiply(cam.matrixWorld), u = cam.userData || {};
  return { matrix: M.toArray(), matrixOrder: 'column-major (three Matrix4.toArray)', fovY: cam.fov, W: u.W, H: u.H, lens: u.lens, mode: u.mode, view: u.view,
    position: toBlender(...cam.position.toArray()) };
}

// ---------------------------------------------------------------- posed geometry (three's linear-blend skinning, on the CPU)
const _v = V3(), _n = V3(), _m = new THREE.Matrix4(), _acc = new THREE.Matrix4();
export function posedMesh(m) {
  const g = m.geometry, n = g.attributes.position.count, P = new Float32Array(n * 3), N = new Float32Array(n * 3), nrm = g.attributes.normal;
  m.updateMatrixWorld(true); if (m.isSkinnedMesh) m.skeleton.update();
  const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, BM = m.isSkinnedMesh ? m.skeleton.boneMatrices : null;
  const nm = new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
  for (let i = 0; i < n; i++) {
    m.getVertexPosition(i, _v); _v.applyMatrix4(m.matrixWorld); const b = toBlender(_v.x, _v.y, _v.z); P[i * 3] = b[0]; P[i * 3 + 1] = b[1]; P[i * 3 + 2] = b[2];
    if (!nrm) continue; _n.fromBufferAttribute(nrm, i);
    if (BM && SI && SW) { const e = _acc.elements; e.fill(0);
      for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (!w) continue; const j = SI.getComponent(i, k), o = j * 16; for (let q = 0; q < 16; q++) e[q] += w * BM[o + q]; }
      _n.transformDirection(_acc); }
    else _n.applyMatrix3(nm).normalize();
    const c = toBlender(_n.x, _n.y, _n.z); N[i * 3] = c[0]; N[i * 3 + 1] = c[1]; N[i * 3 + 2] = c[2];
  }
  return { P, N };
}
// every visible mesh that is not the body, lane D's hair or lane B's eyes (garments, boots, a hat ...), in one fixed order: the export
// and the bake (labs/human8/lab_bake.js) both walk it, so the garment atlas lines up
export function otherMeshes(h) { const out = []; h.group.traverse(m => { if (m.isMesh && m !== h.body && visibleIn(m) && m.userData.part !== 'hair8' && !/^eye/.test(m.userData.part || '')) out.push(m); }); return out; }   // (integration v3: FACE3's eye-meniscus / eye-caruncle are lane B eye parts: Blender builds its own)
const visibleIn = m => { for (let p = m; p; p = p.parent) if (p.visible === false) return false; return true; };
const tris = g => g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: g.attributes.position.count }, (_, i) => i);
const f32 = a => a instanceof Float32Array ? a : Float32Array.from(a);

// ---------------------------------------------------------------- hair cards -> centrelines
// A CardBuilder ribbon is 2 vertices per centreline point (centre -/+ half-width along the card's side), t = arc length / L from 0 at the
// root; a tube is S + 1 vertices per ring (t shared by the ring). Runs of equal t of length 2 are ribbon points; a ribbon starts at t = 0.
// (integration v4) tubes = true: each braid / loc TUBE (HAIR4's settled ropes) also becomes a card: its ring centres as the centreline, the
// ring's mean radius as the half-width, its first vertex's direction as the side, flagged in the manifest's per-card `tube` array so
// person_hair.py fills it as a ROPE (three twisted lobes of strands: a plait / twist), not a flat band. Without it: as before (skipped, counted).
export function cardsOf(m, { tubes: withTubes = false } = {}) {
  const g = m.geometry, A = g.attributes.aHair, n = g.attributes.position.count, { P, N } = posedMesh(m);
  const cards = [], tubes = []; let cur = null, i = 0, tcur = null, tubeCards = 0;
  while (i < n) {
    let j = i + 1; while (j < n && A.getX(j) === A.getX(i) && j - i < 64) j++;
    const run = j - i, t = A.getX(i);
    if (run === 2) {
      if (t === 0 || !cur || t <= cur.t) { cur = { pts: [], half: [], side: [], nrm: [], t: 0, depth: A.getY(i), rand: A.getZ(i), grey: A.getW(i) }; cards.push(cur); }
      const a = i * 3, b = (i + 1) * 3, mid = [0, 1, 2].map(c => (P[a + c] + P[b + c]) / 2), d = [0, 1, 2].map(c => P[b + c] - P[a + c]), w = Math.hypot(...d) || 1e-6;
      cur.pts.push(...mid); cur.half.push(w / 2); cur.side.push(...d.map(x => x / w)); cur.nrm.push(N[a], N[a + 1], N[a + 2]); cur.t = t;
    } else { cur = null; tubes.push(run);
      if (withTubes && run > 3) { const c = [0, 0, 0]; for (let q = i; q < j; q++) for (let k = 0; k < 3; k++) c[k] += P[q * 3 + k] / run;
        let r = 0; for (let q = i; q < j; q++) r += Math.hypot(P[q * 3] - c[0], P[q * 3 + 1] - c[1], P[q * 3 + 2] - c[2]) / run;
        if (!tcur || t <= tcur.t) { tcur = { pts: [], half: [], side: [], nrm: [], t: 0, depth: A.getY(i), rand: A.getZ(i), grey: A.getW(i), tube: 1 }; cards.push(tcur); tubeCards++; }
        const sd = [0, 1, 2].map(k => P[i * 3 + k] - c[k]), sl = Math.hypot(...sd) || 1e-6;
        tcur.pts.push(...c); tcur.half.push(r); tcur.side.push(...sd.map(x => x / sl)); tcur.nrm.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]); tcur.t = t; } }
    if (run === 2) tcur = null;
    i = j;
  }
  return { cards: cards.filter(c => c.half.length >= 2), tubeRings: tubes.length, tubeCards };
}

// ---------------------------------------------------------------- the export
export function exportPerson(P, { cams = {}, lights = LIGHTS, name = null } = {}) {
  const h = P.h; h.update(); h.group.updateMatrixWorld(true);
  const buffers = {}; let off = 0; const blob = (key, arr) => { buffers[key] = arr; return { key, type: arr.constructor.name, length: arr.length }; };
  const M = { version: EXPORT_VERSION, frame: 'blender (z up), metres', made: new Date().toISOString(), spec: P.spec, info: P.info, wear: P.wear, hair: P.hair, pose: P.pose,
    report: { ms: P.report.ms, tris: P.report.tris, seams: P.report.seams, notes: P.report.notes, kin: P.report.kin }, scale: h.scale, height: h.o.height, sex: h.sex,
    meshes: [], hair: [], eyes: null, cameras: {}, lights: Object.fromEntries(Object.entries(lights).map(([k, L]) => [k, { ...L, wb: whiteBalance(L.wbK || 6504) }])) };
  // ---- body
  const body = h.body, bg = body.geometry, bp = posedMesh(body), nb = bg.attributes.position.count;
  const bodyRec = { name: 'body', kind: 'body', verts: nb, tris: bg.index.count / 3, subdiv: P.subdiv || 0,
    position: blob('body.position', bp.P), normal: blob('body.normal', bp.N), index: blob('body.index', tris(bg)), bind: blob('body.bind', f32(bg.attributes.position.array)) };
  for (const k of ['aHero', 'aLikeA', 'aLikeB']) if (bg.attributes[k]) bodyRec[k] = blob('body.' + k, f32(bg.attributes[k].array));
  M.meshes.push(bodyRec);
  // lane B's person and the params it used (the bake carries the albedo; these are for the record and the SSS colour)
  const S = P.skin; if (S) M.skin = { person: S.person, base: S.lut?.base, params: S.params, nail: S.nail };
  // (integration v4, SKIN4's hand-off) skin rev 4: Cycles' subsurface scale 0.6 by default (person_scene reads skin.sss when --sss is not given)
  if (S && ((S.params?.rev ?? S.rev ?? 0) >= 4 || (P.report?.person?.build?.skin?.rev ?? 0) >= 4)) M.skin.sss = 0.6;
  // (integration v6, SKIN6's hand-off) skin rev 6: person_scene's coat roughness from the oil map and a faint vellus sheen
  if (S && ((S.params?.rev ?? S.rev ?? 0) >= 6 || (P.report?.person?.build?.skin?.rev ?? 0) >= 6)) M.skin.rev = 6;
  // ---- garments (visible only: a bare person has none) and anything else visible that is not body, hair or eyes
  const clothKey = new Map(); for (const [k, v] of Object.entries(h.cloth || {})) [].concat(v).forEach((m, i) => m && clothKey.set(m, [k, i]));
  const fab = h.fabrics || null, o = h.o;
  const dye = k => ({ top: o.shirt, skirt: o.shirt, pockets: o.shirt, collar: o.kind === 'tee' ? o.shirt : o.shirt, bottom: o.trousers, vest: o.vest === 'orange' ? '#e8501a' : '#c8e01a', boots: o.boots, gloves: '#8a6a44', rims: o.shirt })[k] || o.shirt;
  let gi = 0;
  for (const m of otherMeshes(h)) {
    const ck = clothKey.get(m), g = m.geometry, pm = posedMesh(m), nm = 'mesh' + (gi++), k3 = m.userData.k3 || null;
    const rec = { name: ck ? ck[0] + (ck[1] ? '_' + ck[1] : '') : k3 ? 'k3_' + (k3.name || gi) : (m.userData.part || 'other') + '_' + gi, kind: ck || k3 ? 'garment' : (m.userData.part || 'other'), verts: g.attributes.position.count,
      position: blob(nm + '.position', pm.P), normal: blob(nm + '.normal', pm.N), index: blob(nm + '.index', tris(g)) };
    if (ck) { const f = fab ? [].concat(fab[ck[0]])[ck[1]] ?? [].concat(fab[ck[0]])[0] : null; rec.part = ck[0]; rec.fabric = f || null;
      const col = m.material?.color ? '#' + m.material.color.getHexString(THREE.SRGBColorSpace) : null; rec.dye = dye(ck[0]); rec.materialColor = col; }
    // integration v2: K3's parts (underwear, sewn panels, construction) carry their fabric and dye; their aRest is the flat panel uv
    // (the weave's coordinate), not a bind position, so their bind is the geometry's own (bind) position
    if (k3) { rec.part = k3.group === 'found' ? 'underwear' : k3.group; rec.k3 = k3; rec.fabric = k3.fabric || (k3.group === 'found' ? 'jersey' : null);
      rec.dye = k3.color || null; rec.materialColor = rec.dye; }
    const rest = !k3 && g.attributes.aRest || g.attributes.position; rec.bind = blob(nm + '.bind', f32(rest.array));
    if (g.attributes.uv) rec.uv = blob(nm + '.uv', f32(g.attributes.uv.array));
    if (g.attributes.aHero) rec.aHero = blob(nm + '.aHero', f32(g.attributes.aHero.array));
    M.meshes.push(rec);
  }
  // ---- eyes (lane B): the globes in bind space and the head bone that carries them
  const E = P.eyes;
  if (E && E.eyes) { const hb = h.idx.head, B = h.skeleton.bones[hb]; h.skeleton.update();
    const Mh = new THREE.Matrix4().multiplyMatrices(B.matrixWorld, h.skeleton.boneInverses[hb]), Mb = C2B.clone().multiply(Mh);
    const ic = typeof E.opt.iris === 'string' ? null : E.opt.iris;
    M.eyes = { headMatrix: Mb.toArray(), note: 'bind (three frame) -> posed world (Blender frame); eye-local = bind - c, +z forward, +y up', iris: E.opt.iris, irisColours: ic || null, pupil: E.opt.pupil / 1000, age: E.opt.age,
      // (integrator c6) the person's own iris pigment (person/iris7.js) and the engine eye's seed (EYES' ask): eye7_maps.mjs grows the Cycles iris from both
      ...(E.opt.pig ? { pig: E.opt.pig } : {}), ...(Number.isFinite(E.opt.seed) ? { seed: E.opt.seed } : {}),
      ...((E.opt.rev ?? 0) >= 4 ? { sclera: [0.45, 0.40, 0.335], scleraNote: 'eyes rev 4 (SKIN4): linear albedo before ageing; person_scene ages it' } : {}),
      globes: E.eyes.map(e => ({ side: e.side, c: e.c.toArray(), r: e.r, rc: e.rc, rl: e.rl, zcc: e.zcc, inset: e.inset, apex: e.apex, irisR: 0.00585, irisZ: e.zcc + e.rc - e.inset - 0.003, fissure: Array.from(e.fissure) })) };
    const IR = E.U ? { base: E.U.eBase.value.toArray(), fibre: E.U.eFibre.value.toArray(), center: E.U.eCenter.value.toArray(), limbus: E.U.eLimbus.value.toArray() } : null; M.eyes.irisColours = IR; }
  // ---- hair (lane D): cards -> centrelines, per part
  const G = P.groom;
  if (G) for (const m of G.meshes) { if (!visibleIn(m) || !m.geometry.attributes.aHair) continue;
    const part = m.userData.hairPart || 'scalp', u0 = m.material.userData || {}, { cards, tubeRings, tubeCards } = cardsOf(m, { tubes: (u0.shade?.rev ?? 0) >= 4 }), mat = m.material, u = mat.userData || {};
    const counts = Uint32Array.from(cards.map(c => c.half.length));
    const cat = k => { const n = cards.reduce((a, c) => a + c[k].length, 0), out = new Float32Array(n); let q = 0; for (const c of cards) { out.set(c[k], q); q += c[k].length; } return out; };
    const per = k => Float32Array.from(cards.map(c => c[k]));
    const pm = part === 'scalp' ? G.mel : part === 'brows' ? { eu: G.mel.eu * 0.95 + 0.02, ph: G.mel.ph } : part === 'lashes' ? { eu: Math.max(G.mel.eu * 1.5, 0.35), ph: G.mel.ph * 0.5 } : part === 'lashesLow' ? { eu: Math.max(G.mel.eu * 1.5, 0.35) * 0.55, ph: G.mel.ph * 0.5 } : { eu: G.mel.eu, ph: G.mel.ph * 1.25 + 0.02 };
    const pg = part === 'scalp' ? G.grey : part === 'brows' ? G.grey * 0.55 : part === 'lashes' ? G.grey * 0.12 : part === 'lashesLow' ? G.grey * 0.2 : Math.min(0.95, G.grey * 1.15);
    const k = 'hair.' + part;
    M.hair.push({ part, cards: cards.length, tubeRings, tubeCards, form: G.form, style: G.style?.name || null, melanin: pm, grey: pg, shade: u.shade || null,
      counts: blob(k + '.counts', counts), points: blob(k + '.points', cat('pts')), half: blob(k + '.half', cat('half')), side: blob(k + '.side', cat('side')), normal: blob(k + '.normal', cat('nrm')),
      depth: blob(k + '.depth', per('depth')), rand: blob(k + '.rand', per('rand')), greyK: blob(k + '.grey', per('grey')), ...(tubeCards ? { tube: blob(k + '.tube', Float32Array.from(cards.map(c => c.tube ? 1 : 0))) } : {}) }); }
  // ---- cameras
  for (const [k, c] of Object.entries(cams)) M.cameras[k] = cameraRecord(c);
  // ---- the head and the face's landmarks in Blender's frame (exposure metering, framing checks)
  const jt = n => toBlender(...h.joint(n).toArray());
  M.landmarks = { head: jt('head'), neck: jt('neck01'), spine03: jt('spine03'), footL: jt('foot.L'), footR: jt('foot.R') };
  M.files = {}; for (const [k, a] of Object.entries(buffers)) { M.files[k] = { offset: off, bytes: a.byteLength, type: a.constructor.name, count: a.length }; off += a.byteLength; off = Math.ceil(off / 16) * 16; }
  M.binBytes = off; M.name = name || P.info.name;
  return { manifest: M, buffers };
}
// one .bin holding every buffer at its manifest offset
export function packBuffers(manifest, buffers) {
  const out = new Uint8Array(manifest.binBytes);
  for (const [k, a] of Object.entries(buffers)) out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), manifest.files[k].offset);
  return out;
}
