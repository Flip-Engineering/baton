// PERSON (8 Oct): THE STUDIO'S PERSON. There is ONE current person; makePerson('<name>') builds it (person/build.js: every lane's current
// result on, the lanes landing passed changes through assets/person/v7lanes/<LANE>.json). There is no version to ask for: a 'latest:',
// 'vN:' or 'lineup:' prefix in an old command is accepted, stripped and logged once; nothing builds an older person (git history keeps
// the old chain). The people are the twelve of the lineup that are baked (core.js V2_PLAN: six women, six men, every background).
//
//   import { loadPersonStudio, makePerson } from '../lib/fx/person/index.js';
//   const st = await loadPersonStudio();                                     // shared loads (ANSUR, hero bundle, body studio, skin model, hair styles)
//   const P = await makePerson('L08_f24_hispanic', { studio: st, wear: 'work' | 'bare', stage: 'studio@5' });
//   scene.add(P.h.group);                                                      // a Hero like any other (P.h); place / turn it after
//   const hp = await poserOf(P); hp.arm('R', target, ...); afterPose7(P);      // pose with IK (lane F), then the correctives and the girdle
//   const Q = await makePerson(name, { studio: st, motion: { clip: 'wave7' } }); Q.motion.apply(t);   // play a clip (MOTION c3)
//   P.report  -> { ms, seams, notes, tris, kin, person: { lanes, popts, bake, from (which lane file set a slot), waiting } }
// The documented API, the slots and the lane files: research/capabilities/human.md.
import * as THREE from 'three';
import { loadHeroData } from '../hero.js';
import { loadAnsur } from '../rig/body.js';
import { STAGES2 } from './core.js';
export { poserOf, afterPose, ensureSkinSSS, V2_PEOPLE as PEOPLE, V2_PLAN as PLAN } from './core.js';
export { afterPose7, attachMotion7, DEFAULTS, LANE_SLOTS, STAGE, LOOKS, QUALITY, WEAR, personDefaults, laneFiles, fineGain } from './build.js';

// the stages of the person (in this order): form prior | face | detail | kin | hair | skin eyes | found (K3's underwear) | stack (the sewn
// garments) | style
export const STAGES = STAGES2;
const now = () => (globalThis.performance ? performance.now() : Date.now());
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mulberry = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
async function tryImport(path) { try { return await import(path); } catch (e) { return { _error: String(e && e.message || e) }; } }
// ---------------------------------------------------------------- style recipes the integration names (lane E's STYLES plus an L1 read)
// 'l1': lane E's L1 masses in clay (the form at the masses, the sculptor's read); every other key is lane E's recipes.js STYLES
export const EXTRA_STYLES = {
  l1: { label: 'L1 masses (clay)', shape: { level: 1 }, surface: { surface: 'clay', clay: '#a39a8c' }, medium: { kind: 'lit' } },
  l1skin: { label: 'L1 masses (skin)', shape: { level: 1 }, surface: { surface: 'skin', fade: 1 }, medium: { kind: 'lit', meter: 'face' } },
};

// ---------------------------------------------------------------- shared loads
let _studio = null;
export async function loadPersonStudio({ body = true, hair = true, skin = true, style = true } = {}) {
  if (_studio) return _studio;
  const t0 = now(), st = { ms: {} };
  const tm = async (k, f) => { const t = now(); try { return await f(); } finally { st.ms[k] = Math.round(now() - t); } };
  [st.ansur, st.heroData] = await Promise.all([tm('ansur', () => loadAnsur()), tm('heroData', () => loadHeroData())]);
  if (body) { st.B = await tm('bodyModule', () => tryImport('../body/index.js'));
    if (!st.B._error) { st.S = await tm('bodyStudio', () => st.B.loadBodyStudio()); st.cast = await tm('cast', () => st.B.loadCast(st.S)); } }
  if (skin) { st.L = await tryImport('../likeness/skin.js'); st.E = await tryImport('../likeness/eyes.js'); st.X = await tryImport('../likeness/expose.js');
    const LU = await tryImport('../likeness/skin_lut.js'); st.lut = LU; if (!LU._error) st.skinModel = await tm('skinModel', () => LU.loadSkinModel()); }
  if (hair) { st.Hm = await tryImport('../hair/index.js'); if (!st.Hm._error) { st.hairStyles = await tm('hairStyles', () => st.Hm.loadHairStyles()); greyByAgeOf = st.Hm.greyByAge || null; } }
  st.D = await tryImport('../cloth/drape.js');
  if (style) { st.R = await tryImport('../style/recipes.js'); st.SP = await tryImport('../style/person.js'); st.SF = await tryImport('../style/surface.js'); }
  st.ms.total = Math.round(now() - t0);
  return (_studio = st);
}
export function recipeOf(st, name) {
  if (!name) return null; if (typeof name === 'object') return name;
  const r = EXTRA_STYLES[name] || (st.R && st.R.STYLES && st.R.STYLES[name]); if (!r) throw new Error('person: no style ' + name);
  return { ...r, key: name };
}


// styles lane D has shown on its boards (forms, styles); w_natural / w_puff / w_locs read as ribbons at close range on the first
// integration renders (seam 4 in the notes), so they are left to an explicit opts.hair.style for now
const HAIR_W = { black: ['w_bun_low', 'w_crop', 'w_tail_low', 'w_bob'], hispanic: ['w_tail_low', 'w_bun_low', 'w_long', 'w_bob'], asian: ['w_bob', 'w_tail_low', 'w_bun_low', 'w_crop'], white: ['w_bob', 'w_tail_low', 'w_crop', 'w_bun_low'], all: ['w_bun_low', 'w_bob', 'w_tail_low'] };
const HAIR_M = { black: ['m_crop', 'm_buzz', 'm_crop'], hispanic: ['m_crop', 'm_sidepart', 'm_wavy_mid'], asian: ['m_crop', 'm_sidepart'], white: ['m_sidepart', 'm_crop', 'm_wavy_mid'], all: ['m_crop', 'm_sidepart'] };
const FORM = { black: 'coily', hispanic: 'wavy', asian: 'straight', white: 'straight', all: 'straight' };
const HAIR_HEX = { black: '#120c0a', hispanic: '#1e1410', asian: '#0e0a08', white: '#4a3424', all: '#2a1c12' };
// the person's hair pigment, given to lane D explicitly (its option `melanin`): lane D fits a hex to its diffuse albedo, which puts
// near-black hair at eumelanin ~1.3 where the TRT tint is still bright orange under a sun (seam 3); Chiang et al. 2016's scale puts
// black hair far higher. These are the integration's choices of who the person is, not a retuning of lane D's shading.
const MEL = { black: [{ eu: 3.2, ph: 0.02 }], asian: [{ eu: 3.0, ph: 0.02 }], hispanic: [{ eu: 2.2, ph: 0.04 }, { eu: 3.0, ph: 0.02 }], white: [{ eu: 0.35, ph: 0.06 }, { eu: 0.6, ph: 0.05 }, { eu: 1.1, ph: 0.04 }, { eu: 0.12, ph: 0.06 }], all: [{ eu: 1.6, ph: 0.02 }] };
// lane D's styles by sex, group and age (seeded); men past 55 sometimes recede or thin; beards on some men
let greyByAgeOf = null;   // set by loadPersonStudio from lane D's module
export function hairFor(info, seed = 1, over = {}) {
  const r = mulberry(seed * 613 + 17), g = info.group && HAIR_W[info.group] ? info.group : 'all', f = info.sex === 'f';
  let style = pick(r, (f ? HAIR_W : HAIR_M)[g]);
  if (!f && info.age >= 55 && r() < 0.5) style = pick(r, ['m_receding', 'm_thinning']);
  const beard = f ? 'none' : pick(r, ['none', 'stubble', 'stubble', 'short', 'moustache', 'full']);
  // greying: lane D's greyByAge (Panhard et al. 2012) with the onset that paper reports later in African and Asian samples
  // (shifted 6 years) and a little in Hispanic ones (3): the person's choice handed to lane D's `grey` option
  const shift = { black: 6, asian: 6, hispanic: 3 }[g] || 0, gr = greyByAgeOf ? clamp(greyByAgeOf(Math.max(18, info.age - shift)) * (0.75 + 0.5 * r())) : undefined;
  return { style, form: FORM[g], age: info.age, beard, hex: HAIR_HEX[g], melanin: pick(r, MEL[g]), ...(gr != null ? { grey: +gr.toFixed(2) } : {}), ...over };
}


// ---------------------------------------------------------------- small helpers on a built hero
// the bust band of the figure-study register, measured per person: from 1.5 cm under the inframammary fold to 45 % of the fold-to-
// apex height above the apex (lane C's figure_lab rule), the fold found on the mesh under lane A's nipple landmark (the first minimum
// of the front profile going down). Lane E's bandeau is a fixed 11 cm about a scanned apex and leaves a large or ptotic bust's lower
// pole bare (seam 11). Painted after every other surface patch (applied first).
export function bustBand(h, p) {
  const n = p && p.landmarks && p.landmarks.nippleL; if (!n || h.sex !== 'f') return null;
  const P = h.body.geometry.attributes.position.array, AH = h.aHero, z = new Map(), d = 0.005;
  for (let v = 0; v < P.length / 3; v++) { if (AH && AH[v * 4] !== 2) continue; const x = Math.abs(P[v * 3]), y = P[v * 3 + 1]; if (Math.abs(x - Math.abs(n[0])) > 0.04 || y > n[1] || y < n[1] - 0.22) continue;
    const k = Math.round((n[1] - y) / d); z.set(k, Math.max(z.get(k) ?? -9, P[v * 3 + 2])); }
  let kmin = 0, zmin = Infinity; for (let k = 0; k <= 44; k++) { const zz = z.get(k); if (zz == null) continue; if (zz < zmin) { zmin = zz; kmin = k; } else if (zz > zmin + 0.008 && zmin < (z.get(0) ?? 0) - 0.01) break; }
  const fold = n[1] - Math.max(kmin, 4) * d; return [fold - 0.015, n[1] + Math.max(0.04, 0.45 * (n[1] - fold))];
}
export function paintBand(h, band, color = '#d8d2c6') {
  const mat = h.body.material, prev = mat.onBeforeCompile, key0 = mat.customProgramCacheKey;
  const U = { uPBand: { value: new THREE.Vector2(...band) }, uPBandC: { value: new THREE.Color(color).convertSRGBToLinear() } };
  mat.onBeforeCompile = (sh, r) => { prev.call(mat, sh, r); Object.assign(sh.uniforms, U);
    const fs = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec2 uPBand; uniform vec3 uPBandC;'), mask = fs.includes('float hNotSkin') ? ' hNotSkin = max(hNotSkin, bd);' : '';
    const BAND = '{ vec3 bq = vBind; float bd = step(uPBand.x, bq.y) * step(bq.y, uPBand.y) * step(1.5, vHero.x) * step(vHero.x, 2.5);\n  diffuseColor.rgb = mix(diffuseColor.rgb, uPBandC, bd); roughnessFactor = mix(roughnessFactor, 0.8, bd);' + mask + ' }';
    // HUMAN c8 HOOKS: the skin's last section (hero.js's //@skin-end marker: after every lane's paint), the paint mask set where declared
    sh.fragmentShader = fs.includes('//@skin-end') ? fs.replace('//@skin-end', BAND + '\n//@skin-end') : fs.replace('roughnessFactor = pRough;\n}', 'roughnessFactor = pRough;\n}\n' + BAND); };
  mat.customProgramCacheKey = () => key0.call(mat) + '|person-band'; mat.needsUpdate = true; return U;
}
export function trianglesOf(h) {
  const out = { body: 0, garments: 0, hair: 0, eyes: 0, hat: 0, other: 0, total: 0 }, cloth = new Set(); for (const k of Object.keys(h.cloth || {})) [].concat(h.cloth[k]).forEach(m => m && cloth.add(m));
  const hat = new Set(); if (h.hatGroup) h.hatGroup.traverse(m => hat.add(m));
  h.group.traverse(m => { if (!m.isMesh || !m.visible) return; let vis = true; for (let p = m.parent; p; p = p.parent) if (p.visible === false) vis = false; if (!vis) return;
    const g = m.geometry, n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    const k = m === h.body ? 'body' : cloth.has(m) ? 'garments' : hat.has(m) ? 'hat' : m.userData.part === 'hair8' ? 'hair' : (m.userData.part === 'eye' || m === h.eyes) ? 'eyes' : 'other';
    out[k] += n; out.total += n; });
  return out;
}
// the kinematic read of a posed hero (a measurement, not a solver): ankle spacing, the elbow's frontal angle, COM over the feet.
// With p.kin the COM uses the person's own segments (lane A's balanceSegments over its joint centres, carried by their bones)
export function kinRead(h, kin = null) {
  h.update(); const g = h.group, inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), loc = v => v.clone().applyMatrix4(inv).divideScalar(h.scale);
  const H = h.o.height, aL = loc(h.joint('foot.L')), aR = loc(h.joint('foot.R'));
  const out = { stature: +H.toFixed(3), ankleSep: +(Math.abs(aL.x - aR.x) * h.scale).toFixed(3), ankleSepFrac: +(Math.abs(aL.x - aR.x) * h.scale / H).toFixed(3) };
  for (const s of ['L', 'R']) { const S = loc(h.joint(`upperarm01.${s}`)), E = loc(h.joint(`lowerarm01.${s}`)), W = loc(h.joint(`wrist.${s}`)), u = E.clone().sub(S), f = W.clone().sub(E);
    u.z = 0; f.z = 0; const sg = s === 'L' ? 1 : -1, ang = Math.atan2(u.x * f.y - u.y * f.x, u.x * f.x + u.y * f.y) * 180 / Math.PI * -sg;   // + = forearm out from the body (valgus)
    out['elbowFrontal' + s] = +ang.toFixed(1); }
  if (kin && kin.balanceJoints && kin.balanceSegments) {
    const bone = { neck: 'neck01', headTop: 'head', hips: 'root', shoulderMid: 'spine01', shL: 'upperarm01.L', elL: 'lowerarm01.L', wrL: 'wrist.L', fiL: 'wrist.L', shR: 'upperarm01.R', elR: 'lowerarm01.R', wrR: 'wrist.R', fiR: 'wrist.R',
      hipL: 'upperleg01.L', knL: 'lowerleg01.L', anL: 'foot.L', toL: 'foot.L', hipR: 'upperleg01.R', knR: 'lowerleg01.R', anR: 'foot.R', toR: 'foot.R' };
    const P = {}, M = new THREE.Matrix4(), Sk = h.skeleton; g.updateMatrixWorld(true);
    for (const [k, b] of Object.entries(bone)) { const i = h.idx[b], q = kin.balanceJoints[k]; if (i == null || !q) continue; M.multiplyMatrices(Sk.bones[i].matrixWorld, Sk.boneInverses[i]); P[k] = new THREE.Vector3(...q).applyMatrix4(M); }
    const c = new THREE.Vector3(); let m = 0; for (const [, a, b, w, f] of kin.balanceSegments) { if (!P[a] || !P[b]) continue; c.addScaledVector(P[a].clone().lerp(P[b], f), w); m += w; } c.multiplyScalar(1 / (m || 1));
    const feet = ['anL', 'toL', 'anR', 'toR'].map(k => loc(P[k])), cl = loc(c);
    const xs = feet.map(v => v.x), zs = feet.map(v => v.z), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs) - 0.03, z1 = Math.max(...zs);
    out.com = { height: +(cl.y * h.scale / H).toFixed(3), overFeet: cl.x > x0 && cl.x < x1 && cl.z > z0 && cl.z < z1, x: +(cl.x * h.scale).toFixed(3), z: +(cl.z * h.scale).toFixed(3) };
    out.kinStance = kin.stance ? { ankleSep: kin.stance.ankleSep, heelSep: kin.stance.heelSep, hipBreadth: kin.stance.hipBreadth, footAngle: kin.stance.footAngle } : null;
    out.kinCarrying = kin.carryingAngle ? kin.carryingAngle.deg : null;
    // did the rig use the person's stance? (lane F's idleStance adoption: the ankles stand kin.stance.ankleSep apart)
    if (kin.stance && kin.stance.ankleSep) out.stanceFromKin = Math.abs(out.ankleSep - kin.stance.ankleSep) < 0.015; }
  return out;
}


// ---------------------------------------------------------------- the one entry point
// who: one of the twelve ('L08_f24_hispanic'); an old prefix ('latest:', 'v7:', 'v6:', 'lineup:' ...) is stripped (logged once).
// opts: build.js buildPerson's (wear, stage, seed, stages, motion, export, the lanes' slots and the build's switches)
const _warned = new Set();
export async function makePerson(who, opts = {}) {
  if (typeof who !== 'string') throw new Error('person: makePerson takes a name (one of the twelve: ' + (await import('./core.js')).V2_PEOPLE.join(', ') + ')');
  const m = /^((?:v\d+|latest|lineup|current):)+/.exec(who), old = ['rev', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'].filter(k => opts[k] != null);
  if ((m || old.length) && !_warned.has((m?.[0] || '') + old.join())) { _warned.add((m?.[0] || '') + old.join()); console.warn(`person: ${[m?.[0], ...old.map(k => k + ':')].filter(Boolean).join(' ')} is deprecated and ignored: there is one current person (makePerson('<name>'))`); }
  const name = m ? who.slice(m[0].length) : who;
  if (!/^L\d\d_[fm]\d\d_[a-z]+$/.test(name)) throw new Error(`person: '${who}' is not one of the twelve (${(await import('./core.js')).V2_PEOPLE.join(', ')}); a CAST spec, a crew worker or a fresh cast person has no current build`);
  const B = await import('./build.js');
  return B.buildPerson(name, { ...opts, studio: opts.studio || await loadPersonStudio() });
}

// ---------------------------------------------------------------- exposure for people (one rule for every mode and stage)
// The light rig's exposure placed so the lit side of each face lands at its OWN reflectance (lane B's meterFace), a group at the mean
// of its stops. skinY is the skin as lane B's model made it (its fitted base albedo + surface reflectance) when applySkin ran, else
// the hero's hex (StyleStage.meterFaces reads only the hex: on a lane-B skin that differs; this is the one place both agree).
export function skinYOf(st, P) {
  // the baked person (integration seam 13): the skin as lane B FITTED it, surface included (skinFromHex matches the hint's L* with exactly
  // this quantity), not lane B's base albedo + a constant 3 % surface (which read deep skin ~0.5 stop darker than lane B made it)
  if (P.baked && P.skin && P.skin.person && st.lut && st.lut.skinRGB && st.skinModel) return st.lut.lum(st.lut.skinRGB(st.skinModel, P.skin.person, true));
  if (P.skin && P.skin.lut && st.lut && st.lut.lum) return st.lut.lum(P.skin.lut.base) + (st.skinModel?.global?.Rs ?? 0.03);
  // a hex is sRGB: THREE.Color(hex) already decodes it to the linear working space when ColorManagement is on (the studio's labs turn
  // it on); decoding again (StyleStage.meterFaces does: seam 12) reads deep skin ~1.3 stops darker than it is
  const c = new THREE.Color(P.h.o.skin || '#b08a70'); if (!THREE.ColorManagement.enabled) c.convertSRGBToLinear(); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b + 0.03;
}
export function meterPeople(st, { lr, scene, camera, rig, people, bias = 0, lens = null }) {
  if (!st.X || st.X._error) return { stops: 0, n: 0, undo: () => {} };
  const each = [];
  people.forEach((P, k) => { const m = st.X.meterFace({ lr, scene, camera, rig, hero: P.h, render: k === 0, lens }); if (!m) return; each.push(Math.log2(skinYOf(st, P) * 2 ** bias / Math.max(m.p75, 1e-8))); });
  if (!each.length) return { stops: 0, n: 0, undo: () => {} };
  const stops = clamp(each.reduce((a, b) => a + b, 0) / each.length, -6, 6); st.X.setRigStops(rig, scene, stops);
  return { stops, n: each.length, each: each.map(x => +x.toFixed(2)), undo: () => st.X.setRigStops(rig, scene, -stops) };
}
