// PERSON / CASTING (HUMAN c8 CAST): who APPEARS. A sibling of PERSON_PIPELINE stage 1: the population (lane A's sampler.js) says
// who EXISTS, at its real frequencies; casting says who is SHOWN, the way a film or a documentary photographer casts working people:
// mostly healthy-weight, active, common-to-attractive adults of every background, women exactly half, ages mostly 20-55. A lineup,
// a board row, a demo is cast; a census is drawn only when range is the subject. Heavy, very old and pregnant bodies stay one explicit
// spec away (castBody's own keys, or castPerson's `over`), never the default of a lineup. Opt-in: nothing in the studio imports this
// file except makePerson's 'lineup:' who and the labs' defaults; people.js, workforce.js and every scene render exactly as before.
//
//   import { castLineup, castPerson, resolveSpec, castFrom, loadLineup } from '../lib/fx/person/casting.js';
//   const specs = castLineup(24, { seed: 7, role: 'lineup', pop: S.pop });   // castBody specs (bmiPct, waistPct, strong resolved)
//   const p = castFrom(S, castPerson('hero', 5));                            // = castBody(S, resolveSpec(S.pop, spec))
//   const L = await loadLineup(S); L.find(3) | L.find('L03_m41_black') | L.women | L.men   // the baked 24 (assets/body/lineup.json)
//   makePerson('lineup:3') | makePerson('lineup:L03_m41_black')                            // the integrator reads the same bake
//
// How a cast person is made (all of it data for castBody; nothing here touches a mesh):
//   1. sex (women exactly half of a lineup, alternating f, m), age (a casting mix, stratified over the lineup), background (the four
//      NHANES groups rotated so each sex meets each group equally; a mix object works too), stature percentile (stratified in 0.1-0.9).
//   2. BMI from the role's band (a truncated normal, stratified over the lineup so a row spans its band), a little higher with age.
//   3. body fat (DXA %) from the role's band, correlated with the BMI drawn (rho 0.5), a little higher with age; the lean mass then
//      FOLLOWS: FFMI = BMI x (1 - fat), kept inside the role's FFMI band (fat recomputed when it clips).
//   4. resolveSpec (needs the population tables): bmiPct = the BMI's percentile in the person's own NHANES cell (so the copula conditions
//      waist, hip, arm and legs on it, as for any castBody person); waistPct = the waist's conditional percentile given age, stature and
//      BMI, moved `waistShift` conditional SDs (active people carry a smaller waist at the same BMI); strong = the lean-mass z that lands
//      lane A's DXA draw on the cast FFMI exactly (strong consumes no random numbers, so the person is otherwise the same draw).
// The bands, their sources and which numbers are OUR casting choice: review/studio_human_c8/after/casting/NOTES.md (and ROLES below).
import { mulberry32, gauss, ncdf, ndtri, bandOf, GROUPS, sampleTargets } from '../body/sampler.js';
import { person, castBody } from '../body/person.js';
import { KIN_VERSION } from '../body/kin.js';
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// ---------------------------------------------------------------- the roles (numbers in NHANES-DXA units: lane A's composition is DXA)
// bmi / pf: [median, sd, lo, hi] per sex, a truncated normal; ffmi: [lo, hi]; ages: [[from, to, share], ...]; ageBmi: BMI per year past
// 30; agePf: fat points per year past 30 (Gallagher et al. 2000: the healthy fat band rises ~2-3 points per 20 years); z: the range of
// lane A's lean-mass z ('strong', at the same BMI) a cast person may take (our choice: active, not athletes; when the fat band would
// ask more, the fat follows the capped lean mass); waistShift: the waist's conditional SD shift (our choice); spread: lane A's
// residual spread (its demo cast used 0.6).
export const ROLES = {
  lineup: { label: 'cast lineup: healthy, active working adults',
    bmi: { f: [21.7, 1.6, 19.4, 26.0], m: [23.8, 1.5, 20.8, 27.0] }, pf: { f: [27.0, 2.6, 21.0, 32.5], m: [17.0, 2.3, 12.0, 22.5] },
    ffmi: { f: [14.8, 17.5], m: [18.0, 21.2] }, z: [-0.5, 2.0], ages: [[21, 30, 0.3], [30, 42, 0.32], [42, 55, 0.28], [55, 65, 0.1]],
    occupations: { general: 0.45, manual: 0.35, carry: 0.2 }, ageBmi: 0.035, agePf: 0.1, waistShift: -0.5, stature: [0.1, 0.9], spread: 0.6 },
  hero: { label: 'cast hero: one healthy, active working adult',
    bmi: { f: [22.0, 1.3, 19.6, 25.0], m: [24.0, 1.2, 21.5, 26.5] }, pf: { f: [26.5, 2.2, 21.5, 31.0], m: [16.5, 2.0, 12.0, 21.0] },
    ffmi: { f: [15.0, 17.8], m: [18.2, 21.2] }, z: [-0.3, 2.0], ages: [[24, 35, 0.45], [35, 50, 0.55]],
    occupations: { general: 0.4, manual: 0.4, carry: 0.2 }, ageBmi: 0.03, agePf: 0.1, waistShift: -0.6, stature: [0.2, 0.85], spread: 0.5 },
  crowd: { label: 'cast crowd: wider, still ordinary and realistic',
    bmi: { f: [23.6, 2.6, 18.8, 31.0], m: [25.2, 2.4, 20.3, 31.0] }, pf: { f: [30.0, 3.4, 22.0, 38.0], m: [21.0, 3.2, 13.0, 28.0] },
    ffmi: { f: [14.0, 19.0], m: [17.0, 22.5] }, z: [-1.0, 2.0], ages: [[20, 35, 0.3], [35, 50, 0.3], [50, 65, 0.27], [65, 75, 0.13]],
    occupations: { general: 0.45, manual: 0.25, carry: 0.15, desk: 0.15 }, ageBmi: 0.03, agePf: 0.1, waistShift: -0.2, stature: [0.04, 0.96], spread: 0.8 },
  census: { label: 'census: lane A\'s NHANES draw (who exists, at its frequencies)', ages: [[20, 80, 1]], spread: 1 },
};

// ---------------------------------------------------------------- small helpers
const tnorm = ([mu, sd, lo, hi], u) => { const a = ncdf((lo - mu) / sd), b = ncdf((hi - mu) / sd); return mu + sd * ndtri(a + clamp(u, 1e-6, 1 - 1e-6) * (b - a)); };
const shuffle = (a, r) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const strat = (n, r) => shuffle(Array.from({ length: n }, (_, k) => (k + r()) / n), r);           // a Latin-hypercube column in (0, 1)
const ageAt = (ages, u) => { const tot = ages.reduce((s, a) => s + a[2], 0); let acc = 0; for (const [a, b, w] of ages) { const p = w / tot; if (u <= acc + p) return a + (b - a) * clamp((u - acc) / p); acc += p; } return ages[ages.length - 1][1]; };
const catAt = (cats, u) => { const e = Object.entries(cats), tot = e.reduce((s, [, w]) => s + w, 0); let acc = 0; for (const [k, w] of e) { acc += w / tot; if (u <= acc) return k; } return e[e.length - 1][0]; };
const gname = g => typeof g === 'string' ? g : 'mix';
const r1 = x => Math.round(x * 10) / 10, r3 = x => Math.round(x * 1000) / 1000;

// one cast person's numbers from uniforms (u: { age, bmi, pf, stature, occ }) -> a castBody spec, unresolved (resolveSpec adds the
// percentiles and the lean-mass z)
function castNumbers(R, role, sex, group, u, seed, idx = null) {
  const age = Math.round(ageAt(R.ages, u.age));
  if (role === 'census') return { sex, age, group, seed, spread: R.spread, cast: { role } };
  const zb = ndtri(clamp(u.bmi, 1e-4, 1 - 1e-4));
  const bmi = tnorm(R.bmi[sex], u.bmi) + R.ageBmi * Math.max(0, age - 30);
  const zp = 0.5 * zb + Math.sqrt(1 - 0.25) * ndtri(clamp(u.pf, 1e-4, 1 - 1e-4));
  let pf = tnorm(R.pf[sex], ncdf(zp)) + R.agePf * Math.max(0, age - 30);
  let ffmi = bmi * (1 - pf / 100); const [f0, f1] = R.ffmi[sex];
  if (ffmi < f0 || ffmi > f1) { ffmi = clamp(ffmi, f0, f1); pf = 100 * (1 - ffmi / bmi); }
  const staturePct = R.stature[0] + (R.stature[1] - R.stature[0]) * u.stature;
  const occupation = catAt(R.occupations, u.occ);
  const tag = idx != null ? 'L' + String(idx).padStart(2, '0') + '_' : '';
  const name = `${tag}${sex}${age}_${gname(group)}`;
  return { sex, age, group, bmi: r1(bmi), staturePct: r3(staturePct), occupation, seed, spread: R.spread, name, label: `${sex === 'f' ? 'F' : 'M'}${age} ${gname(group)}`,
    cast: { role, bmi: r1(bmi), pf: r1(pf), ffmi: r1(ffmi), waistShift: R.waistShift } };
}

// ---------------------------------------------------------------- the API
// castPerson(role, seed, over): one cast person (a castBody spec). over: any castBody key or { sex, age, group, bmi } fixed; e.g.
// castPerson('lineup', 4, { sex: 'f', age: 38 }), or a test about a heavy body: castPerson('lineup', 4, { bmi: 33, pf: 38 }) (explicit).
export function castPerson(role = 'hero', seed = 1, over = {}, { pop = null, women = 0.5 } = {}) {
  const R = ROLES[role]; if (!R) throw new Error('casting: no role ' + role);
  const r = mulberry32(seed * 2654435 + 97), u = { age: r(), bmi: r(), pf: r(), stature: r(), occ: r() };
  const sex = over.sex || (r() < women ? 'f' : 'm'), group = over.group || GROUPS[Math.floor(r() * GROUPS.length) % GROUPS.length];
  let s = castNumbers(R, role, sex, group, u, seed);
  if (over.age != null) s = castNumbers({ ...R, ages: [[over.age, over.age, 1]] }, role, sex, group, u, seed);
  const { pf, ffmi, ...rest } = over; s = { ...s, ...rest };
  if (s.cast && (over.bmi != null || pf != null || ffmi != null)) {          // an explicit body: keep the composition consistent
    const bmi = s.bmi ?? s.cast.bmi, f = ffmi ?? (pf != null ? bmi * (1 - pf / 100) : s.cast.ffmi);
    s.cast = { ...s.cast, bmi, ffmi: r1(f), pf: r1(100 * (1 - f / bmi)), explicit: true }; }
  return pop ? resolveSpec(pop, s) : s;
}
// castLineup(n, opts): n cast people, women exactly round(n * women), alternating f, m from index 0 (any prefix is half women);
// opts: { seed, role ('lineup' | 'hero' | 'crowd' | 'census'), women (0.5), groups (array of group names or mix objects, rotated per
// sex), ages ([[from, to, share], ...] over the role's), pop (S.pop: resolve the specs now; else call resolveSpec later), names (true) }
export function castLineup(n = 12, { seed = 1, role = 'lineup', women = 0.5, groups = GROUPS, ages = null, pop = null, names = true } = {}) {
  const R0 = ROLES[role]; if (!R0) throw new Error('casting: no role ' + role); const R = ages ? { ...R0, ages } : R0;
  const nf = Math.round(n * women), nm = n - nf, r = mulberry32(seed * 7907 + 11), out = [];
  const sexes = []; for (let i = 0, f = 0, m = 0; i < n; i++) { const takeF = f < nf && (m >= nm || f <= m); sexes.push(takeF ? 'f' : 'm'); takeF ? f++ : m++; }
  for (const sex of ['f', 'm']) {
    const k = sexes.filter(s => s === sex).length; if (!k) continue;
    const U = { age: strat(k, r), bmi: strat(k, r), pf: Array.from({ length: k }, () => r()), stature: strat(k, r), occ: strat(k, r) };
    const off = Math.floor(r() * groups.length), G = shuffle(Array.from({ length: k }, (_, i) => groups[(i + off) % groups.length]), r);
    let j = 0;
    sexes.forEach((s, i) => { if (s !== sex) return;
      const u = { age: U.age[j], bmi: U.bmi[j], pf: U.pf[j], stature: U.stature[j], occ: U.occ[j] };
      out[i] = castNumbers(R, role, sex, G[j], u, seed * 1000 + i + 1, names ? i : null); j++; });
  }
  return pop ? out.map(s => resolveSpec(pop, s)) : out;
}

// the NHANES cell's quantile table for a group (or a mix), as drawNhanes reads it
function cellQ(pop, sex, age, group) {
  const cell = pop.nhanes.cells[`${sex}|${bandOf(age)}`], V = pop.vars, gm = typeof group === 'object' && group ? group : GROUPS.includes(group) ? { [group]: 1 } : { all: 1 }, q = {};
  for (const v of V) { let acc = null, ws = 0; for (const [g, w] of Object.entries(gm)) { const qq = cell.q[g] || cell.q.all; acc = acc ? acc.map((x, i) => x + w * qq[v][i]) : qq[v].map(x => w * x); ws += w; } q[v] = acc.map(x => x / ws); }
  return { cell, q, V, n: V.length };
}
const interp = (xs, ys, x) => { const n = xs.length; if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1]; let i = 1; while (xs[i] < x) i++; return ys[i - 1] + (x - xs[i - 1]) / (xs[i] - xs[i - 1]) * (ys[i] - ys[i - 1]); };
export function pctIn(pop, sex, age, group, v, x) { const { q } = cellQ(pop, sex, age, group); return clamp(interp(q[v], pop.P, x), 0.003, 0.997); }
function solve(A, b) { const n = b.length, M = A.map((r, i) => [...r, b[i]]); for (let i = 0; i < n; i++) { let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k; [M[i], M[p]] = [M[p], M[i]];
  for (let k = i + 1; k < n; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; } }
  const x = new Array(n).fill(0); for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; } return x; }
// resolveSpec(pop, spec): the cast numbers -> castBody's own keys (bmiPct, waistPct, strong). A spec without `cast` (a plain castBody
// spec) is returned as it is.
export function resolveSpec(pop, spec) {
  const c = spec.cast; if (!c || c.role === 'census' || spec.bmi == null) return spec;
  const s = { ...spec }, sex = s.sex, { cell, V, n } = cellQ(pop, sex, s.age, s.group), R = Array.from({ length: n }, (_, i) => cell.rho.slice(i * n, i * n + n));
  s.bmiPct = r3(pctIn(pop, sex, s.age, s.group, 'bmi', s.bmi));
  // the waist's conditional given age, stature and BMI (the copula's own correlation), moved waistShift conditional SDs
  if (c.waistShift && s.waistPct == null) {
    const { q } = cellQ(pop, sex, s.age, s.group), F = ['age', 'stature', 'bmi'].map(v => V.indexOf(v)), w = V.indexOf('waist');
    const zf = [ndtri(clamp(interp(q.age, pop.P, s.age), 0.003, 0.997)), ndtri(s.staturePct ?? 0.5), ndtri(s.bmiPct)];
    const Rff = F.map(i => F.map(j => R[i][j])), Rwf = F.map(j => R[w][j]), a = solve(Rff, Rwf), mu = a.reduce((t, x, k) => t + x * zf[k], 0), sd = Math.sqrt(Math.max(0.02, 1 - a.reduce((t, x, k) => t + x * Rwf[k], 0)));
    s.waistPct = r3(clamp(ncdf(mu + c.waistShift * sd), 0.01, 0.99)); }
  // the lean-mass z that lands lane A's DXA draw on the cast FFMI (strong adds strong x sd to its FFMI and consumes no random numbers)
  if (c.ffmi != null && s.strong == null) { const t = sampleTargets(pop, { ...s, strong: 0 }), sd = pop.dxa[sex].models.ffmi.sd, Z = (ROLES[c.role] && ROLES[c.role].z) || [-3, 3];
    const z = (c.ffmi - t.ffmi) / sd, zc = c.explicit ? z : clamp(z, Z[0], Z[1]); s.strong = r3(zc);
    if (zc !== z) { const f = t.ffmi + zc * sd; s.cast = { ...c, ffmi: r1(f), pf: r1(100 * (1 - f / s.bmi)), zCapped: r1(z) }; } }
  return s;
}
// castFrom(S, spec): castBody on a cast spec (resolved here when it is not yet)
export function castFrom(S, spec) { return castBody(S, resolveSpec(S.pop, spec)); }

// ---------------------------------------------------------------- the baked lineup (assets/body/lineup.json; casting_test.mjs --bake)
export const LINEUP = { n: 24, seed: 2610, role: 'lineup' };
export async function loadLineup(S, { url = new URL('../../../assets/body/lineup.json', import.meta.url).href, force = false } = {}) {
  if (S._lineup && !force) return S._lineup;
  const J = await fetch(url).then(r => r.json()), people = J.people.map(rec => person(S, rec));
  const find = k => { if (k == null) return null; const s = String(k); if (/^\d+$/.test(s)) return people[+s] || null; return people.find(q => q.name === s || q.label === s || q.name.startsWith(s + '_')) || null; };
  return (S._lineup = { version: J.version, built: J.built, role: J.role, kinVersion: KIN_VERSION, stale: J.kinVersion !== KIN_VERSION, people, find,
    women: people.filter(p => p.sex === 'f'), men: people.filter(p => p.sex === 'm') });
}
// 'lineup:<sel>' selections the labs share: an index, a name, 'women' | 'men' | 'all', a range 'a-b', or a list 'a,b,c'
export function lineupSelect(L, sel = 'all') {
  const s = String(sel);
  if (s === 'all' || s === '') return L.people; if (s === 'women' || s === 'f') return L.women; if (s === 'men' || s === 'm') return L.men;
  if (/^\d+-\d+$/.test(s)) { const [a, b] = s.split('-').map(Number); return L.people.slice(a, b + 1); }
  if (s.includes(',')) return s.split(',').map(k => L.find(k)).filter(Boolean);
  const p = L.find(s); return p ? [p] : [];
}
// a short read of a cast person (labels, reports)
export const castLabel = p => { const m = p.measures || {}, c = p.spec?.cast; return `${p.sex === 'f' ? 'F' : 'M'}${Math.round(p.age)} ${typeof p.group === 'string' ? p.group : 'mix'} BMI ${(m.bmi ?? c?.bmi ?? 0).toFixed(1)}${c?.pf != null ? ` fat ${c.pf.toFixed(0)}%` : ''}`; };
