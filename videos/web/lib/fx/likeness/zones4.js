// LIKENESS / zones4 (SKIN4, round 4, 3 Oct 2026): the skin's colour ZONES, measured, as per-vertex melanin and blood multipliers, plus
// the regional roughness, oil and pore maps. Used by skin.js when `applySkin(h, { rev: 4 })`; nothing else imports it.
//
// FACE: the zones and their numbers were MEASURED on the ten HSRD-100 scans (Digital Reality Lab, CC BY 4.0) in our head chart
// (review/studio_human_c8/after/skin4/tools/measure_zones.py; the table in that folder's NOTES.md): each zone's median colour against
// the neutral face skin (the lateral cheeks, temples' edges, the sides of the forehead), in log RGB with the grey shading direction
// split off (Tsumura et al. 2003), solved through lane B's model at each person's own skin for a melanin and a blood multiplier.
// What ships here is OUR parametric model (blobs placed from hm08 landmarks, the same rule the measurement used) with the measured
// medians, per sex, shrunk a little toward 1 where makeup or hair contaminated the women's numbers (lids, ears); no scan data ships.
// BODY: from anatomy and the reference look (the judge's c9 list): red knees and hands, darker and redder elbows and knuckles, lighter
// palms and soles, warm fingertips and toes, areolae (in the shader, crisp; see skin.js), drier shins and forearms.
// Person: every multiplier's log is scaled by a seeded draw (exp(0.25 N)), so no two people have the same face map; the cheek flush has
// its own draw (the scans range x0.5 - x1.5 blood).
import { HERO_REGIONS as R } from '../hero.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// hm08 landmark ids (the library's and FACE P2's; every lane A person and CREW8 hero shares the topology); body landmarks: lane A's basis
export const FACE_IDS = { prn: 297, g: 237, n: 132, sn: 5072, ls: 466, sto: 493, li: 495, pg: 5162, me: 747, en_L: 7821, ex_L: 7782, ps_L: 7817, pi_L: 7761,
  ch_L: 7129, sa_L: 11977, sba_L: 12329, pra_L: 12048, pa_L: 7698, al_L: 11750, mal_L: 11787, buc_L: 11906, en_R: 1129, ex_R: 1090, ps_R: 1125, pi_R: 1069,
  ch_R: 369, sa_R: 5376, sba_R: 5732, pra_R: 5449, pa_R: 1004, al_R: 5136, mal_R: 5175, buc_R: 5301 };
export const BODY_IDS = { nippleL: 8471, nippleR: 1799, patellaL: 11223, patellaR: 4605, olecranonL: 10025, olecranonR: 3357 };
const SCAN_EYE_W = 0.0893;   // the ten scans' mean outer-canthus breadth (m; 0.082-0.099): sizes the blobs on any head (the measurement's units)

// measured medians (zones_measured.json, women / men), and what ships [mel x, blood x] (women, men); oxy = the deoxygenated share
// (periorbital: bluish), the shading column was split off in the measurement
export const ZONES4 = {
  noseTip:      { f: [1.0, 1.45], m: [1.0, 1.6] },      // measured f 0.93 / 1.49, m 0.97 / 1.65
  alae:         { f: [1.25, 1.35], m: [1.1, 1.35] },    // f 1.32 / 1.37, m 1.08 / 1.36
  noseBridge:   { f: [1.0, 1.2], m: [1.05, 1.35] },     // f 0.86 / 1.20, m 1.13 / 1.44
  cheek:        { f: [0.9, 0.9], m: [0.92, 0.98], flush: true },   // f 0.84 / 0.72, m 0.90 / 0.98; range 0.52-1.47 blood: a per-person flush
  upperLid:     { f: [1.45, 1.4], m: [1.28, 1.27] },    // f 2.02 / 1.78 (eye make-up on several), m 1.28 / 1.27
  underEye:     { f: [1.4, 1.8], m: [1.23, 1.48], oxy: 0.6 },    // f 1.47 / 2.50, m 1.23 / 1.48; bluer (db* -2)
  innerCanthus: { f: [1.55, 1.75], m: [1.6, 1.8], oxy: 0.5 },     // f 1.64 / 1.84, m 1.82 / 1.91 (part is the corner's occlusion)
  ear:          { f: [1.4, 1.5], m: [1.2, 1.3] },       // f 1.90 / 1.82, m 1.07 / 0.91 (hair over most women's ears; noisy)
  forehead:     { f: [1.12, 1.1], m: [1.0, 1.0] },      // f 1.29 / 1.24, m 0.99 / 0.96
  temple:       { f: [0.88, 0.8], m: [0.92, 0.85] },    // f 0.82 / 0.76, m 0.95 / 0.83
  upperLip:     { f: [1.05, 1.3], m: [1.03, 1.35] },    // f 1.06 / 1.33, m 1.03 / 1.36 (+ the beard shadow on men, in the shader)
  mouthCorner:  { f: [1.38, 1.12], m: [1.38, 1.2] },    // f 1.41 / 1.11, m 1.40 / 1.22: the darker perioral corners
  nasolabial:   { f: [0.96, 1.18], m: [0.9, 1.18] },    // f 0.96 / 1.20, m 0.88 / 1.19
  chin:         { f: [1.05, 1.3], m: [0.95, 1.0] },     // f 1.07 / 1.39, m 0.92 / 0.94
  jaw:          { f: [0.88, 0.8], m: [0.95, 0.82] },    // f 0.85 / 0.77, m 0.95 / 0.81
  neck:         { f: [1.1, 0.85], m: [1.1, 0.85] },     // 2 people seen (collars, hair): f 1.15 / 0.82
};
// vermilion (measured blood x 3.6 - 6 against the neutral, men / women) is lane B's analytic lip (FACE c2 fits its shape); rev 4 sets its
// blood to 3.8 (lane B 3.2): in skin.js.

function zoneBlobs(L, u) {   // u: metres -> this head's bind units; the SAME blobs as measure_zones.py zone_defs
  const S = (x, y, z) => [x * u, y * u, z * u], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const sg = (a, b) => Math.sign(a[0] - b[0]) || 1, mw = Math.abs(L('ch_L')[0] - L('ch_R')[0]) / u, both = f => ['L', 'R'].map(f);
  return {
    noseTip: [[add(L('prn'), S(0, 0, -0.003)), S(0.008, 0.008, 0.008)]],
    alae: both(s => [L('al_' + s), S(0.005, 0.005, 0.006)]),
    noseBridge: [[mid(L('n'), L('prn')), S(0.006, 0.010, 0.008)]],
    cheek: both(s => [L('mal_' + s), S(0.013, 0.011, 0.012)]),
    upperLid: both(s => [add(L('ps_' + s), S(0, 0.004, 0)), S(0.009, 0.0035, 0.006)]),
    underEye: both(s => [add(L('pi_' + s), S(0, -0.006, 0)), S(0.010, 0.0045, 0.006)]),
    innerCanthus: both(s => [add(L('en_' + s), S(-0.004 * sg(L('en_' + s), L('n')), -0.002, -0.002)), S(0.004, 0.005, 0.005)]),
    ear: both(s => { const a = L('sa_' + s), b = L('sba_' + s), c = L('pra_' + s), d = L('pa_' + s); return [[(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4, (a[2] + b[2] + c[2] + d[2]) / 4], S(0.010, 0.022, 0.014)]; }),
    forehead: [[add(L('g'), S(0, 0.030, 0)), S(0.022, 0.016, 0.02)]],
    temple: both(s => [add(L('ex_' + s), S(0.016 * sg(L('ex_' + s), L('n')), 0.012, -0.012)), S(0.010, 0.010, 0.010)]),
    upperLip: [[mid(L('sn'), L('ls')), S(0.012, 0.004, 0.008)]],
    mouthCorner: both(s => [add(L('ch_' + s), S(0.005 * sg(L('ch_' + s), L('sto')), -0.003, 0)), S(0.005, 0.005, 0.005)]),
    nasolabial: both(s => [mid(L('al_' + s), L('ch_' + s)), S(0.005, 0.006, 0.006)]),
    chin: [[L('pg'), S(0.012, 0.009, 0.010)]],
    jaw: both(s => [add(L('buc_' + s), S(0, -0.010, 0)), S(0.014, 0.014, 0.014)]),
    neck: [[add(L('me'), S(0, -0.030, -0.025)), S(0.030, 0.020, 0.020)]],
    _mw: mw,
  };
}

// a seeded normal draw
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const gauss = r => { const u = Math.max(1e-9, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// fields4(h, P, N, AH, n, { sex, seed, age }) -> { mel, blood, oxy, rough, oil, pore } Float32Arrays (n): multipliers / offsets per vertex
// (the face zones measured; the body zones from anatomy). rough: an offset to the base lobe's roughness; oil: the sharp lobe's weight;
// pore: the pore size scale (0 = none).
// SKIN7 (rev 7, opt-in; z7 = null leaves everything below as it was): z7 = { zones: { name: { f: [mel, blood], m: [mel, blood], flush: false, ... } }, fixed: [names], blob: { cheek: [kx, ky, kz] } (x the blob's sigmas) }
// replaces those zones' numbers (the cheek's blood solved by applySkin for the photographed flush; see skin.js), takes them out of the person's random
// amplitude draw (so the flush the caller solved is the flush that ships) and may resize their blobs. The face is normalised afterwards as before.
// SKIN OPTICS iteration 7 (rev 7): z7.tiles = { ref, thin } (the table's tissue coordinates of the arm's column and of the thin column) and z7.tissue = { field (n x 4:
// tdI, s, cartilage share, read), sites? } (tissue.js, from the person's head anatomy). Where the anatomy was read, the vertex's own column replaces the zones' 'oxy' share
// (the thin slice the under-eye and inner-canthus blobs pointed at). Returned as tc (n x 2).
// SKIN OPTICS iteration 8: z7.tissue.sites = { w (n x ns: the cutaneous SITE's blended one-hot weights, tissue.js siteWeights), names }: where the anatomy was
// read, the DERMAL BLOOD is its SITE's in place of every zone's blood blob (cheek, forehead, temple, nose, alae, ears, lids, under-eye, inner canthus, upper
// lip, mouth corners, nasolabial, chin, jaw, neck). A site's blood is the scans' MEASURED median of the zone(s) that sample it (SITE_ZONES: each zone's number
// is its region's median colour against the scans' neutral, inverted through the model: the blood VOLUME the colour needs), so the model explains the scans
// by construction of its parameters, not by a gain; the zone blobs' peak factor PK goes (a site is its own region: its median is its value everywhere,
// blended at its edges), the person's draw is the zones' own (amp of the same zones; the cheek's flush). The eyelid site (the skin over the orbital aperture,
// upper and lower lid to the rim) is sampled by the upper-lid and under-eye zones; the nasal lobule by the tip and alae zones; the perioral skin by the upper-lip
// and mouth-corner zones (the under-eye's colour is part thin skin, which the column now carries: the blood there is still the scans' inversion on the arm's column). CHECK, not construction: the ratios against basal
// perfusion by site (Stücker et al. 2001, Skin Pharmacol Appl Skin Physiol 14:44, 2-D laser Doppler, 60 adults: forehead 0.73, cheek 0.72, nose 0.95, chin
// 0.99, lips 1.47 AU; trunk and limbs 0.40-0.49): nose / forehead 1.30 (the sites: women 1.27, men 1.47), cheek / forehead 0.99 (0.82, 0.98), chin /
// forehead 1.36 (1.18, 1.00): the order agrees (the nose and chin above the forehead and cheek, the face above the body: optics.js FACE_BLOOD 2), the chin
// is lower in the scans' colour than in Stücker's flux. The zones' MELANIN is unchanged (the melanin is iteration 9's).
export const SITE_ZONES = { forehead: ['forehead'], temple: ['temple'], eyelid: ['upperLid', 'underEye'], nose: ['noseBridge'], lobule: ['noseTip', 'alae'], cheek: ['cheek'],
  perioral: ['upperLip', 'mouthCorner'], chin: ['chin'], jaw: ['jaw'], neck: ['neck'], auricle: ['ear'], scalp: ['temple'] };
export function fields4(h, P, N, AH, n, { sex = 'f', seed = 1, age = 0.3, scale = 1, z7 = null } = {}) {
  const mel = new Float32Array(n).fill(1), blood = new Float32Array(n).fill(1), oxy = new Float32Array(n), rough = new Float32Array(n), oil = new Float32Array(n).fill(0.12), pore = new Float32Array(n).fill(0.8);
  const TT = z7?.tiles || null, TF = z7?.tissue?.field && z7.tissue.field.length >= n * 4 ? z7.tissue.field : null, tc = TT ? new Float32Array(n * 2) : null;
  const ST = TF && z7.tissue.sites?.w && z7.tissue.sites.w.length >= n * z7.tissue.sites.names.length ? z7.tissue.sites : null, NS = ST ? ST.names.length : 0;
  if (tc) for (let v = 0; v < n; v++) { tc[v * 2] = TT.ref[0]; tc[v * 2 + 1] = TT.ref[1]; }
  const ok = id => id < n && Number.isFinite(P[id * 3]);
  const L = k => { const id = FACE_IDS[k]; return [P[id * 3], P[id * 3 + 1], P[id * 3 + 2]]; };
  const haveFace = Object.values(FACE_IDS).every(ok);
  const report = { face: haveFace, zones: {}, person: {} };
  const r = rng(seed * 7919 + (sex === 'm' ? 13 : 7)), sx = sex === 'm' ? 'm' : 'f';
  if (haveFace) {
    const exW = Math.hypot(L('ex_L')[0] - L('ex_R')[0], L('ex_L')[1] - L('ex_R')[1], L('ex_L')[2] - L('ex_R')[2]), u = exW / SCAN_EYE_W;
    const Z = zoneBlobs(L, u), names = Object.keys(ZONES4), ZT = z7 ? Object.fromEntries(names.map(k => [k, z7.zones?.[k] ? { ...ZONES4[k], ...z7.zones[k] } : ZONES4[k]])) : ZONES4;
    if (z7?.blob) for (const k in z7.blob) if (Z[k]) Z[k] = Z[k].map(([c, sd]) => [c, sd.map((x, i) => x * z7.blob[k][i])]);   // blob: per-axis scale of the blob's sigmas
    const amp = Object.fromEntries(names.map(k => [k, Math.exp(0.25 * clamp(gauss(r), -2, 2))]));
    const flush = Math.exp(0.25 * clamp(gauss(r), -1.8, 1.8));   // x0.64-1.57 (the scans' cheeks: x0.52-1.47 against the neutral)
    if (z7?.fixed) for (const k of z7.fixed) amp[k] = 1;
    // iteration 8: the person's dermal blood by SITE: the mean log blood of the site's zones (the scans' medians for this sex) x the person's draw of those zones, the cheek's flush
    const lnS = ST ? ST.names.map(k => { const zs = SITE_ZONES[k]; if (!zs) return 0; return zs.reduce((t, z) => t + Math.log(ZT[z][sx][1]) * amp[z], 0) / zs.length + (k === 'cheek' ? Math.log(flush) : 0); }) : null;
    report.person = { amp: Object.fromEntries(Object.entries(amp).map(([k, v]) => [k, +v.toFixed(2)])), flush: +flush.toFixed(2), unit: +u.toFixed(4), ...(ST ? { siteBlood: Object.fromEntries(ST.names.map((k, i) => [k, +Math.exp(lnS[i]).toFixed(2)]).filter(([k]) => k !== 'none')) } : {}) };
    const PK = 1.35;   // a zone's number is its region's median (where its blob weighs > 0.5, mean weight ~0.72): the blob's peak is x1.35 in log
    const fx = names.map(k => { const z = ZT[k][sx], a = amp[k] * PK; return [Math.log(z[0]) * a, Math.log(z[1]) * a + (ZT[k].flush ? Math.log(flush) : 0), ZT[k].oxy || 0]; });
    const blobs = names.map(k => Z[k]);
    // roughness / oil / pores on the face (sebaceous T-zone, drier cheeks; Pierard-Franchimont's sebum maps; Mizukoshi's gloss by zone):
    const FACE_SURF = { noseTip: [-0.16, 0.95, 1.35], alae: [-0.12, 0.85, 1.3], noseBridge: [-0.12, 0.75, 1.1], cheek: [0.1, 0.18, 1.15], upperLid: [-0.04, 0.3, 0.35],
      underEye: [-0.05, 0.2, 0.5], innerCanthus: [-0.05, 0.3, 0.3], ear: [0.0, 0.3, 0.6], forehead: [-0.11, 0.8, 1.1], temple: [0.03, 0.35, 0.9], upperLip: [-0.03, 0.5, 0.9],
      mouthCorner: [0.0, 0.35, 0.7], nasolabial: [-0.02, 0.55, 1.1], chin: [-0.04, 0.55, 1.05], jaw: [0.04, 0.25, 0.9], neck: [0.05, 0.2, 0.6] };
    const fs = names.map(k => FACE_SURF[k]);
    const eyeZ = (L('ex_L')[2] + L('ex_R')[2]) / 2;
    for (let v = 0; v < n; v++) { const reg = AH[v * 4]; if (reg !== R.head && reg !== R.jaw && reg !== R.neck) continue;
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      let lm = 0, lb = 0, ox = 0, wsum = 0, ro = 0, oi = 0, po = 0;
      for (let k = 0; k < blobs.length; k++) { let w = 0;
        for (const [c, s] of blobs[k]) { const dx = (x - c[0]) / s[0], dy = (y - c[1]) / s[1], dz = (z - c[2]) / s[2], e = dx * dx + dy * dy + dz * dz; if (e < 18) w += Math.exp(-0.5 * e); }
        if (w < 1e-4) continue; w = Math.min(1, w); lm += w * fx[k][0]; lb += w * fx[k][1]; ox = Math.max(ox, w * fx[k][2]);
        ro += w * fs[k][0]; oi += w * fs[k][1]; po += w * fs[k][2]; wsum += w; }
      if (ST) { let ls = 0, ws = 0; for (let k = 1; k < NS; k++) { const w = ST.w[v * NS + k]; if (w > 1e-4) { ls += w * lnS[k]; ws += w; } }   // the site's blood where the anatomy was read (blended at the read's edge with the zones')
        if (ws > 1e-3) { ws = Math.min(1, ws); lb = lb * (1 - ws) + ls; } }
      mel[v] = Math.exp(lm); blood[v] = Math.exp(lb); oxy[v] = ox;
      if (TF) { const rd = TF[v * 4 + 3]; if (rd > 0.01) oxy[v] = ox * (1 - Math.min(1, rd)); }   // the anatomy's column replaces the zones' thin share
      // surface: the zones' values where they weigh, the face's neutral (0.02, 0.3, 1.0) elsewhere; the scalp (above the forehead, behind
      // the ears) gets the neutral too (hair covers it)
      const wn = Math.max(0, 1 - wsum), front = sst(eyeZ - 0.09 * u, eyeZ - 0.03 * u, z);
      rough[v] = ro + wn * 0.02; oil[v] = oi + wn * 0.3 * front + wn * 0.15 * (1 - front); pore[v] = po + wn * (0.75 + 0.25 * front);
      if (reg === R.neck) { oil[v] = Math.min(oil[v], 0.25); pore[v] = Math.min(pore[v], 0.65); rough[v] = Math.max(rough[v], 0.04); }
    }
    if (tc) for (let v = 0; v < n; v++) { const reg = AH[v * 4]; if (reg !== R.head && reg !== R.jaw && reg !== R.neck) continue;
      const rd = TF ? Math.min(1, TF[v * 4 + 3]) : 0, x0 = TF ? TF[v * 4] * rd + TT.ref[0] * (1 - rd) : TT.ref[0], y0 = TF ? TF[v * 4 + 1] * rd + TT.ref[1] * (1 - rd) : TT.ref[1];
      tc[v * 2] = x0 + (TT.thin[0] - x0) * oxy[v]; tc[v * 2 + 1] = y0 + (TT.thin[1] - y0) * oxy[v]; }
    if (TF) { let nr = 0, nc = 0; const sc = {}; for (let v = 0; v < n; v++) { if (TF[v * 4 + 3] > 0.5) nr++; if (TF[v * 4 + 2] > 0.5) nc++;
        if (ST) { let bk = 0, bw = 0; for (let k = 1; k < NS; k++) if (ST.w[v * NS + k] > bw) { bw = ST.w[v * NS + k]; bk = k; } if (bw > 0.5) sc[ST.names[bk]] = (sc[ST.names[bk]] || 0) + 1; } }
      report.tissue = { read: nr, cartilage: nc, ...(ST ? { sites: sc } : {}) }; }
    // the person's skin (its preset or hex) is the FACE's average colour, not the measurement's neutral: divide the zones' mean over the
    // front of the face out (without it most of the face sat under x0.8-0.9 blood and the whole face went grey)
    { let sm = 0, sb = 0, c = 0; const yLo = L('me')[1], yHi = L('g')[1] + 0.05 * u;
      for (let v = 0; v < n; v++) { const reg = AH[v * 4]; if (reg !== R.head && reg !== R.jaw) continue; const y = P[v * 3 + 1], z = P[v * 3 + 2];
        if (y < yLo || y > yHi || z < eyeZ - 0.06 * u) continue; sm += Math.log(mel[v]); sb += Math.log(blood[v]); c++; }
      const km = c ? Math.exp(-sm / c) : 1, kb = c ? Math.exp(-sb / c) : 1; report.person.norm = [+km.toFixed(3), +kb.toFixed(3)];
      for (let v = 0; v < n; v++) { const reg = AH[v * 4]; if (reg !== R.head && reg !== R.jaw && reg !== R.neck) continue; mel[v] *= km; blood[v] *= kb; } }
    // SKIN7 iteration 6 (z7.bloodCap = [knee, cap]): a soft limit on the face's blood (identity up to the knee, then tanh to the cap): the zones that overlap at the lid margin (upper lid, under-eye, inner canthus) summed to
    // blood x3.4, where rev 7's chroma lock (blood 0.6..2.6) hands over to the physical table (hue 48 at x3.2, 32 at x4.0: the violet crescent under L20's eye); the lips, veins and nails are shader overlays, not zones
    if (z7?.bloodCap) { const a = Math.log(z7.bloodCap[0]), c = Math.log(z7.bloodCap[1]) - a; let cnt = 0, mx = 0;
      for (let v = 0; v < n; v++) { const reg = AH[v * 4]; if (reg !== R.head && reg !== R.jaw && reg !== R.neck) continue; const l = Math.log(blood[v]); mx = Math.max(mx, blood[v]); if (l <= a) continue; blood[v] = Math.exp(a + c * Math.tanh((l - a) / c)); cnt++; }
      report.person.bloodCap = { knee: z7.bloodCap[0], cap: z7.bloodCap[1], vertices: cnt, maxBefore: +mx.toFixed(2) }; }
    report.zones = Object.fromEntries(names.map((k, i) => [k, [+Math.exp(fx[i][0]).toFixed(2), +Math.exp(fx[i][1]).toFixed(2)]]));
  }
  // ---- the body (anatomy and the reference look): multipliers on top of lane B's own (skinFields keeps its knee / elbow / knuckle /
  // volar terms; these are the rev-4 extras)
  const lmk = k => { const id = BODY_IDS[k]; return ok(id) ? [P[id * 3], P[id * 3 + 1], P[id * 3 + 2]] : null; };
  const pat = [lmk('patellaL'), lmk('patellaR')], ole = [lmk('olecranonL'), lmk('olecranonR')], nip = lmk('nippleL'), s = scale;   // scale: metres -> bind units
  const zb = z7?.body || null, REGN = Object.fromEntries(Object.entries(R).map(([k, v]) => [v, k]));
  const BODY_SURF = { [R.torso]: [0.0, 0.3, 1.0], [R.pelvis]: [0.04, 0.12, 0.8], [R.uarm]: [0.05, 0.12, 0.75], [R.farm]: [0.08, 0.1, 0.7], [R.hand]: [0.07, 0.1, 0.6],
    [R.finger]: [0.06, 0.12, 0.45], [R.thigh]: [0.05, 0.1, 0.8], [R.shin]: [0.1, 0.06, 0.7], [R.foot]: [0.1, 0.08, 0.5] };
  for (let v = 0; v < n; v++) { const reg = AH[v * 4]; const bs = BODY_SURF[reg]; if (!bs) continue;
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], nz = N[v * 3 + 2], dors = AH[v * 4 + 3], lc = AH[v * 4 + 1];
    rough[v] = bs[0]; oil[v] = bs[1]; pore[v] = bs[2];
    if (zb) { const kb = zb[REGN[reg]]; if (kb != null) blood[v] *= kb; }   // SKIN7 c2: the covered skin carries less blood than the face (z7.body: multipliers by region name; absent = as before)
    if (reg === R.torso && nip) oil[v] = 0.18 + 0.22 * sst(nip[1] - 0.12 * s, nip[1] + 0.04 * s, y);   // the chest and upper back: more sebaceous
    // knees: red and a little darker over the patella (front), dry and rough
    for (const p of pat) if (p && (reg === R.thigh || reg === R.shin)) { const d = Math.hypot(x - p[0], (y - p[1]) * 0.8, z - p[2]) / (0.045 * s), k = Math.exp(-d * d) * sst(-0.1, 0.4, nz);
      blood[v] *= Math.exp(Math.log(1.5) * k); mel[v] *= Math.exp(Math.log(1.12) * k); rough[v] += 0.1 * k; pore[v] *= 1 - 0.3 * k; }
    // elbows: darker, a little redder, rough (the olecranon's folded skin)
    for (const p of ole) if (p && (reg === R.uarm || reg === R.farm)) { const d = Math.hypot(x - p[0], y - p[1], z - p[2]) / (0.035 * s), k = Math.exp(-d * d);
      blood[v] *= Math.exp(Math.log(1.2) * k); mel[v] *= Math.exp(Math.log(1.12) * k); rough[v] += 0.12 * k; }
    // hands and feet warmer (acral skin: dense arteriovenous anastomoses); fingertips and toes most; the backs of the hands dry
    if (reg === R.hand) { blood[v] *= 1.15; rough[v] += 0.03 * dors; }
    if (reg === R.finger) { const f = lc - 3, tip = sst(1.4, 2.0, f); blood[v] *= 1.15 + 0.25 * tip; }
    if (reg === R.foot) blood[v] *= 1.25 * (1 + 0.15 * sst(-0.2, 0.6, nz));   // the toes' tops and the forefoot a little more
    if (reg === R.farm) blood[v] *= 1.04 + 0.1 * sst(1.5, 1.95, lc);   // toward the wrist
    if (reg === R.shin) blood[v] *= 0.95;
  }
  return { mel, blood, oxy, rough, oil, pore, report, ...(tc ? { tc } : {}) };
}

// the areolae, in the shader (crisp edges at 1:1): bind centres and radii from lane A's nipple landmarks; null when the body has none
// SKIN7 (8 Oct, rev 7): `nipples` = { L: [x, y, z], R: [x, y, z], r?: radius (bind units), source? } places the nipple-areola complex BY ANATOMY on the person's own reshaped surface (BODY7's lib/fx/body nippleAt),
// not at the two fixed hm08 vertices BODY_IDS names (our layers reshape the chest, the vertices stay put). Without `nipples` this is exactly the function it was.
export function areolae(h, P, N, n, { sex = 'f', seed = 1, scale = 1, nipples = null } = {}) {
  if (nipples && nipples.L && nipples.R && nipples.L.every(Number.isFinite) && nipples.R.every(Number.isFinite)) {
    const r = rng(seed * 104729 + 3), rr = nipples.r || (sex === 'f' ? 0.019 : 0.0135) * scale * Math.exp(0.15 * clamp(gauss(r), -2, 2));
    return { L: [...nipples.L, rr], R: [...nipples.R, rr], mel: sex === 'f' ? 2.3 : 2.0, blood: 1.5, source: nipples.source || 'anatomy' };
  }
  const ok = id => id < n && Number.isFinite(P[id * 3]);
  if (!ok(BODY_IDS.nippleL) || !ok(BODY_IDS.nippleR)) return null;
  const r = rng(seed * 104729 + 3), rr = (sex === 'f' ? 0.019 : 0.0135) * scale * Math.exp(0.15 * clamp(gauss(r), -2, 2));
  const at = id => [P[id * 3], P[id * 3 + 1], P[id * 3 + 2], rr];
  const A = at(BODY_IDS.nippleL), B = at(BODY_IDS.nippleR);
  if (Math.abs(A[1] - B[1]) > 0.08 || N[BODY_IDS.nippleL * 3 + 2] < 0.2) return null;   // not a front-facing chest landmark: skip
  return { L: A, R: B, mel: sex === 'f' ? 2.3 : 2.0, blood: 1.5 };
}

// FACE5 (round 5, appended; nothing above changed): the per-vertex weight of named face zones (the same blobs and the same weight rule
// as fields4, min(1, sum of the blob Gaussians)), the head / jaw / neck vertices and the front-of-face set fields4 normalises over.
// face5.js scales the periorbital and perioral zones by age with these (face rev 6, opt-in).
export function zoneWeights(P, n, AH, names) {
  const L = k => { const id = FACE_IDS[k]; return [P[id * 3], P[id * 3 + 1], P[id * 3 + 2]]; };
  if (!Object.values(FACE_IDS).every(id => id < n && Number.isFinite(P[id * 3]))) return null;
  const exW = Math.hypot(L('ex_L')[0] - L('ex_R')[0], L('ex_L')[1] - L('ex_R')[1], L('ex_L')[2] - L('ex_R')[2]), u = exW / SCAN_EYE_W, Z = zoneBlobs(L, u), eyeZ = (L('ex_L')[2] + L('ex_R')[2]) / 2;
  const w = Object.fromEntries(names.filter(k => Z[k]).map(k => [k, new Float32Array(n)])), region = new Uint8Array(n), front = [], yLo = L('me')[1], yHi = L('g')[1] + 0.05 * u;
  for (let v = 0; v < n; v++) { const reg = AH[v * 4]; if (reg !== R.head && reg !== R.jaw && reg !== R.neck) continue; region[v] = 1;
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    if (reg !== R.neck && y >= yLo && y <= yHi && z >= eyeZ - 0.06 * u) front.push(v);
    for (const k in w) { let s = 0; for (const [c, sd] of Z[k]) { const dx = (x - c[0]) / sd[0], dy = (y - c[1]) / sd[1], dz = (z - c[2]) / sd[2], e = dx * dx + dy * dy + dz * dz; if (e < 18) s += Math.exp(-0.5 * e); } w[k][v] = Math.min(1, s); } }
  return { w, region, front };
}
