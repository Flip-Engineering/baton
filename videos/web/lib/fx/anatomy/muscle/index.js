// ANATOMY / MUSCLE (ANAT8-BODY, 8 Oct 2026; NOTES: review/studio_human_c8/after/anat8_body/NOTES.md, D3 and M1-M6): the muscles as VOLUMES with
// origins and insertions on the person's own skeleton (lib/fx/anatomy/skeleton), sized by the person's muscularity. Opt-in: nothing imports this
// unless it asks (the ANAT8-BODY lab and tests); MUSCLE_VERSION 1 = the trunk and the shoulder girdle and the hip (iteration 3); the limbs next.
//   import { buildMuscles, muscleReport, muscleLayer } from '.../lib/fx/anatomy/muscle/index.js';
//   const M = buildMuscles(B, K, { rec })      B = bodyOf(S, built, rec), K = buildSkeleton(B); rec: the person record (its targets.muscle pattern)
//   M = { parts: [part (kind 'muscle') ...], groups: { trunkDeep, back, cuff, hipDeep, trunk, hip, chest, shoulder, neck }, info, version }
//   const R = muscleReport(B, K, M)            the M5 gates: skin vertices inside a muscle, the share of each muscle inside bone, the residual layer
//                                              (skin -> muscle or bone) at the skinfold sites against the person's expected fat, volumes
//   muscleLayer(K, M)                          the ANAT8 Layer contract: { d (metres, bind; negative inside), aabb, labelAt } over bone + muscle
import { buildTrunk, REF } from './trunk.js';
import { volumeOf, layerOf, mad, nrm, sub, lerp, clamp, add, mul } from './core.js';
import { sdParts } from '../skeleton/sdf.js';
import { midline, rayToSkin, profile, skinNormals, oralLining } from '../skeleton/body.js';
import { MUSCLE_BASE, musclePattern } from '../../body/sampler.js';
export { REF } from './trunk.js';
export const MUSCLE_VERSION = 2;   // 2 (lane iteration 6): the pectoralis major's lower fibres cross the midclavicular line at the 5th rib's lower edge (v1 deleted in lane iteration 10)
const UPPER = new Set(['deltoid', 'pectoral', 'trapUpper', 'trapMid', 'trapLower', 'latissimus', 'biceps', 'triceps', 'forearmExt', 'forearmFlex', 'serratus', 'scm']);
const LOWER = new Set(['gluteMax', 'gluteMed', 'rectusFem', 'vastusLat', 'vastusMed', 'adductors', 'hamstrings', 'gastroc', 'soleus', 'tibialisAnt']);
// the person's muscularity per group, relative to the average of their sex at their age-free baseline: sampler.js's amplitudes over its base, square-
// rooted (a belly's thickness grows with the square root of its cross-section), clamped 0.75-1.35
export function muscleScale(B, rec = {}, pattern = null) {
  const sex = B.sex === 'f' ? 'f' : 'm', t = rec.targets || rec.prior?.targets || {};
  const pat = pattern || t.muscle || musclePattern(sex, B.age ?? 35, t.zAlmi ?? 0, rec.spec?.occupation || rec.prior?.spec?.occupation || 'general');
  return k => { const base = MUSCLE_BASE[k] * (sex === 'm' && UPPER.has(k) ? 1.25 : 1) * (sex === 'm' && LOWER.has(k) ? 1.08 : 1); return clamp(Math.sqrt((pat[k] ?? base) / base), 0.75, 1.35); };
}
export function buildMuscles(B, K, opts = {}) {
  const sexF = B.sex === 'f', st = B.stature * 100, sT = st / (sexF ? 162.5 : 175.5), fatK = clamp(((B.pf ?? 0.25) - (sexF ? 0.25 : 0.15)) / 0.1, -1, 2);
  const mscale = muscleScale(B, opts.rec || {}, opts.pattern || null), t0 = Date.now();
  const pf = B.pf ?? (sexF ? 0.28 : 0.18), fk = Math.pow(pf / (sexF ? 0.28 : 0.18), 1.2);
  const ctx = { sexF, sT, fatK, mscale, version: MUSCLE_VERSION, skull: opts.skull || null, midFront: y => midline(B, y).front, fatExp: key => FATREF[key][sexF ? 'f' : 'm'] * fk / 1000 };
  const T = buildTrunk(B, K, ctx), parts = T.parts, groups = {};
  for (const p of parts) (groups[p.group] ||= []).push(p);
  const info = { ...T.info, ms: Date.now() - t0, scale: Object.fromEntries(Object.keys(MUSCLE_BASE).map(k => [k, +mscale(k).toFixed(2)])), drapeMiss: Object.fromEntries(parts.filter(p => p.meta?.drape?.miss).map(p => [p.name, p.meta.drape.miss + '/' + p.meta.drape.n])) };
  return { version: ctx.version, parts, groups, info };
}
export function muscleLayer(K, M, { maxD = 0.25 } = {}) {
  const all = K.parts.concat(M.parts), bb = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]; for (const p of all) for (let a = 0; a < 3; a++) { bb[a] = Math.min(bb[a], p.bb[a]); bb[a + 3] = Math.max(bb[a + 3], p.bb[a + 3]); }
  return { name: 'bone+muscle', aabb: bb, d: (x, y, z) => sdParts(all, x, y, z, maxD).d,
    labelAt: (x, y, z) => { const r = sdParts(all, x, y, z, maxD); const p = r.i >= 0 ? all[r.i] : null; return p ? { part: p.name, kind: p.kind, group: p.group, d: r.d } : null; } };
}
// ---------------------------------------------------------------- the M5 gates
// the expected subcutaneous fat (mm, the layer under the skin, ultrasound-like) at the skinfold sites at a reference body fat (men 18 %, women 28 %),
// scaled by (pf / ref)^1.2; typed from memory of the skinfold and ultrasound literature (Jackson-Pollock site means; Wagner 2013 for ultrasound) as
// ranges to CHECK, not truths: a residual 0.5-1.8x the expectation (+1.5 mm of skin) reads 'ok'
export const FATREF = { chest: { m: 6, f: 8 }, subscap: { m: 9, f: 11 }, midax: { m: 8, f: 10 }, suprailiac: { m: 10, f: 13 }, abdominal: { m: 14, f: 17 }, lumbar: { m: 9, f: 12 }, deltoid: { m: 5, f: 8 }, buttock: { m: 10, f: 20 } };
// one side's muscle volumes (cm3) as I recall the MRI literature (Holzbaur 2007 for the shoulder's; others approximate): ranges to CHECK
export const VOLREF = { pectoralis: { m: [250, 480], f: [110, 250] }, deltoid: { m: [280, 520], f: [150, 300] }, trapezius: { m: [200, 420], f: [120, 260] }, latissimus: { m: [200, 380], f: [100, 220] },
  rectusAbdominis: { m: [100, 220], f: [60, 140] }, externalOblique: { m: [150, 320], f: [80, 200] }, gluteusMaximus: { m: [650, 1100], f: [450, 800] }, gluteusMedius: { m: [250, 450], f: [180, 330] },
  serratusAnterior: { m: [150, 300], f: [80, 180] }, scm: { m: [40, 90], f: [25, 60] } };   // the erectors: no reference I trust (S2-T1 with the transversospinalis)
const FAMILY = n => n.startsWith('pectoralis') ? 'pectoralis' : n.startsWith('deltoid') ? 'deltoid' : n.startsWith('trapezius') ? 'trapezius' : n.startsWith('scm') ? 'scm' : n.split('.')[0];
export function muscleReport(B, K, M, { volumes = true, h = 0.004 } = {}) {
  const sexF = B.sex === 'f', sx = sexF ? 'f' : 'm', pf = B.pf ?? (sexF ? 0.28 : 0.18), fk = Math.pow(pf / (sexF ? 0.28 : 0.18), 1.2), G = K.geo, P = K.pts;
  const bones = layerOf(K.parts, 0.05), musc = layerOf(M.parts, 0.05), tissue = (x, y, z) => Math.min(bones.d(x, y, z), musc.d(x, y, z));
  // (1) skin vertices inside a muscle (the muscle through v6's skin) and within 1.5 mm of one; by muscle (hm08's oral lining is not skin)
  const Psk = B.pos, oral = oralLining(B, K.faceIds), by = {}; let inside = 0, near = 0;
  for (let v = 0; v < B.nb; v++) { if (oral.has(v)) continue; const x = Psk[v * 3], y = Psk[v * 3 + 1], z = Psk[v * 3 + 2], r = sdParts(M.parts, x, y, z, 0.01);
    if (r.d < 0.0015 && r.i >= 0) { const n = M.parts[r.i].name; const q = (by[n] ||= { through: 0, near: 0, dmin: 0, y: [999, -999], x: [999, -999] }); if (r.d < 0) { inside++; q.through++; q.dmin = Math.min(q.dmin, +(r.d * 1000).toFixed(1)); q.y = [Math.min(q.y[0], Math.round(y * 100)), Math.max(q.y[1], Math.round(y * 100))]; q.x = [Math.min(q.x[0], Math.round(Math.abs(x) * 100)), Math.max(q.x[1], Math.round(Math.abs(x) * 100))]; } else { near++; q.near++; } } }
  // (2) the residual layer at the skinfold sites: the distance from the skin point to the nearest muscle or bone (the subcutaneous fat + the skin)
  const sites = [], site = (name, key, o, d) => { const t = rayToSkin(B, o, d); if (!(t < 0.3)) { sites.push({ name, key, mm: null, verdict: 'NO SKIN' }); return; } const s = mad(o, d, t), mm = tissue(s[0], s[1], s[2]) * 1000;
    const exp = FATREF[key][sx] * fk + 1.5, room = bones.d(s[0], s[1], s[2]) * 1000; sites.push({ name, key, mm: +mm.toFixed(1), expect: +exp.toFixed(1), room: +room.toFixed(1), verdict: mm < 0 ? 'THROUGH' : mm < 0.5 * exp ? 'thin' : mm > 1.8 * exp ? 'thick' : 'ok' }); };
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const Sc = G['scap' + S_], H = G['hum' + S_], F = G['fem' + S_];
    site('subscapular' + S_, 'subscap', mad(Sc.inf, [0, 1, 0], -0.02, Sc.post, 0.01), Sc.post);
    const yX = P.xiphoidTip[1]; site('midaxillary' + S_, 'midax', [s * 0.04, yX, G.lev.T9[2] + 0.06], [s, 0, 0]);
    site('suprailiac' + S_, 'suprailiac', mad(P['crestTub' + S_], [0, 1, 0], 0.025, [s, 0, 0], -0.02), [s, 0, 0]);
    const umb = B.lm.omphalion || P.xiphoidTip; site('abdominal' + S_, 'abdominal', [s * 0.03, umb[1] - 0.005, G.lev.L3[2] + 0.04], [0, 0, 1]);
    site('lumbar' + S_, 'lumbar', [s * 0.03, G.lev.L3[1], G.lev.L3[2]], [0, 0, -1]);
    site('deltoid' + S_, 'deltoid', H.at(0, 0.22 * H.Lh, 0), H.F.l);
    site('buttock' + S_, 'buttock', [F.H[0] * 0.8, F.H[1] - 0.03, F.H[2]], [0, 0, -1]);
    if (!sexF) site('chest' + S_, 'chest', [s * 0.07, P.sternalAngle[1] - 0.03, G.lev.T5[2] + 0.06], [0, 0, 1]);
  }
  // (3) volumes (cm3) and the share of each muscle inside bone
  const vol = {}; if (volumes) { for (const p of M.parts) { const r = volumeOf(p, h, bones); vol[p.name] = r; } }
  const fam = {}; for (const [n, r] of Object.entries(vol)) { const f = FAMILY(n), sd = n.split('.')[1] || ''; const k = f + '.' + sd; (fam[k] ||= { cm3: 0 }).cm3 += r.cm3; }
  const famRows = Object.entries(fam).map(([k, r]) => { const f = k.split('.')[0], ref = VOLREF[f]?.[sx]; return { family: k, cm3: +r.cm3.toFixed(0), ref: ref || null, verdict: ref ? (r.cm3 < ref[0] ? 'small' : r.cm3 > ref[1] ? 'large' : 'ok') : '-' }; });
  return { inside, near, by, sites, vol, families: famRows };
}
