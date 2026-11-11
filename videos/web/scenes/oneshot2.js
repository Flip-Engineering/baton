// ONE SHOT CURE v2 (17 Oct 2026): the cure as a revenue problem, in capital's own sentence, carried past 2018 to what is on the books in 2026.
// research/pieces/ONE_SHOT_CURE.md (the record), research/scripts_final/one_shot_cure.json (the words and their sources),
// web/audio/songs2/oneshot_f.py (the score; 96 BPM; every time below is a beat of its map).
//
//   b0-5    the terminal: the analysts' question whole on a cold research page, the attribution typed at once under it
//   b5-24   the pool (stylised: a cold duotone, scan lines): six people stand in a floor of light; the analysts' sentence types over
//           them; from b12.5 they walk out well, each taking a share of the light, until the pool is dark (the only 3D shot but the last)
//   b24-32  the books: Gilead's hepatitis C franchise as three dated bars on one scale (2015 $12.5B, 2018 estimate under $4B, 2025
//           the Epclusa line $1.27B), each bar and its source lettered
//   b32-39.5 what pays: Lilly's weekly injections (Mounjaro + Zepbound, 2025) as 52 doses a year, then Gilead's HIV products (treated, not cured)
//   b39.5-46 the one-time therapy that was tried: Pfizer ends Beqvez, in Pfizer's own words
//   b46-48  black, and the pressure
//   b48-70  the Program (warm duotone, the same six standing past the dark pool, small and low so the type is clear of them)
//   b70-74  the mark is built in the pool's cold light going red; b74 the kit closer.
// Heavy work (the people, their walks) is built in the background after sceneReady; the terminal frames need none of it.
import * as THREE from 'three';
import { W, H, C, loadFonts, loadBeats, outCanvas, Finish, closer, clamp, lerp, ease, line, setFont, SAFE_BAND } from '../lib/kit.js';
import { drawMark } from '../lib/closer.js';

const CFG = Object.assign({ who: ['L22_f27_black', 'L05_m59_black', 'L17_m28_hispanic', 'L06_f53_white', 'L21_m32_black', 'L20_f29_asian'],
  K: 5, seed: 2026, song: 'oneshot2', look: 'cold' }, window.ONESHOT || {});
const SCENE = CFG.song;

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = outCanvas();
await loadFonts();
const B = await loadBeats(SCENE);
const finish = new Finish(CFG.seed);
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };

// ------------------------------------------------------------------ the beats (the score's)
const T = { POOL: 5, CURE: 12, CHART: 24, WEEK: 32, HIV: 36, GENE: 39.5, DARK: 46, MANDATE: 48, PCURE: 62, RATHER: 65, MARK: 70, CLOSE: 74 };
const Q = '“', QE = '”';
const TERM_Q = ['Is curing patients', 'a sustainable', 'business model?'];
// the analysts (CNBC, 11 Apr 2018; Ars Technica, 12 Apr 2018): their own case, a terminal's mono, typed on
const ANALYST = [
  { b: 5, rows: ['…it could represent a', 'challenge for genome', 'medicine developers'] },
  { b: 8.5, rows: ['looking for sustained', 'cash flow.'] },
  { b: 12, rows: ['…an effective drug', 'that permanently cures', 'a disease,'] },
  { b: 17, rows: ['resulting in a gradual', 'exhaustion'] },
  { b: 20.5, rows: ['of the prevalent pool', 'of patients'] },
];
const ANALYST_END = 23.6;
// the Program (acp.us/program, Healthcare and Education Reform): the Party's type
const PROGRAM = [
  { b: 48, rows: ['THE COMMUNIST PARTY', 'STANDS FOR'], size: 118 },
  { b: 51, rows: ['THE NATIONALIZATION,', 'RESTRUCTURING,', 'AND CONVERSION'], size: 104 },
  { b: 55, rows: ['OF PHARMACEUTICAL', 'COMPANIES INTO', 'STATE-OWNED ENTERPRISES'], size: 96 },
  { b: 62, rows: ['WITH THE MANDATE', 'TO CURE DISEASES'], size: 138, red: [1] },
  { b: 65, rows: ['RATHER THAN', 'PROFIT FROM THEM.'], size: 138 },
];
const PROGRAM_END = T.MARK;

// ------------------------------------------------------------------ the 2D layers
const INK = '#d6e6ec', DIM = '#8fa5ad', PAGE = '#06090b', COLD = '#bfe6f5', RED = '#e0453b';
function mono(str, x, y, size, color, alpha = 1, align = 'left') {
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  setFont(ctx, 'Plex Mono', size); ctx.fillText(str, x, y); ctx.restore();
  setFont(ctx, 'Plex Mono', size); return ctx.measureText(str).width;
}
// a block typed on: chars revealed at `cps` from beat b0; a block cursor after the last char while typing (and blinking after)
function typed(rows, b0, beat, { x = 84, y = 420, size = 56, lead = 1.32, cps = 34, color = INK, alpha = 1, cursor = true, hi = null } = {}) {
  const t = (beat - b0) * B.spb; let n = Math.max(0, Math.floor(t * cps)), total = rows.reduce((s, r) => s + r.length, 0);
  let cx = x, cy = y;
  rows.forEach((r, i) => {
    const k = Math.min(r.length, n); n -= k; const s = r.slice(0, k), yy = y + i * size * lead;
    const col = hi && hi.test(r) ? '#ffffff' : color;
    const w = mono(s, x, yy, size, col, alpha); if (k > 0 || i === 0) { cx = x + w; cy = yy; }
  });
  if (cursor) { const done = Math.floor(t * cps) >= total, on = !done || Math.floor(t * 2.2) % 2 === 0;
    if (on) { ctx.save(); ctx.globalAlpha = alpha * 0.85; ctx.fillStyle = color; ctx.fillRect(cx + 4, cy - size * 0.78, size * 0.55, size * 0.92); ctx.restore(); } }
}
const scan = (a = 0.05) => { ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#9fd0e0'; for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1); ctx.restore(); };
function page() { ctx.fillStyle = PAGE; ctx.fillRect(0, 0, W, H); scan(0.05); }
function terminal(beat) {
  page();
  ctx.fillStyle = '#16232a'; ctx.fillRect(84, 430, 840, 2);
  mono('>', 84, 400, 44, DIM);
  // frame 0: the question is already there, whole (the scroll-stop), larger and nearer the middle of the frame; the cursor blinks after it
  const size = 82, y0 = 600, lead = 1.3;
  TERM_Q.forEach((r, i) => mono((i === 0 ? Q : ' ') + r + (i === TERM_Q.length - 1 ? QE : ''), 84, y0 + i * size * lead, size, '#f1f8fb'));
  const blink = Math.floor(beat * B.spb * 2.2) % 2 === 0 || beat < 2;
  if (blink) { setFont(ctx, 'Plex Mono', size); const w = ctx.measureText(' ' + TERM_Q[2] + QE).width; ctx.fillStyle = INK; ctx.globalAlpha = 0.85; ctx.fillRect(84 + w + 6, y0 + 2 * size * lead - size * 0.78, size * 0.55, size * 0.92); ctx.globalAlpha = 1; }
  // the attribution, typed fast under it (done by b2)
  typed(['GOLDMAN SACHS ANALYSTS', `${Q}THE GENOME REVOLUTION,${QE}`, '10 APRIL 2018'], 0.4, beat, { x: 84, y: 1000, size: 46, lead: 1.45, cps: 70, color: DIM, cursor: beat < 2.6 });
}
function analystLayer(beat, a = 1) {
  let cur = null; for (const c of ANALYST) if (beat >= c.b) cur = c;
  if (!cur || beat >= ANALYST_END) return;
  const nx = ANALYST.find(c => c.b > cur.b), endB = nx ? nx.b : ANALYST_END;
  const out = 1 - sstep(endB - 0.3, endB, beat);
  typed(cur.rows, cur.b, beat, { x: 84, y: 400, size: 62, lead: 1.28, cps: 40, color: '#f1f8fb', alpha: a * out, hi: /^exhaustion$/ });
  mono('GOLDMAN SACHS ANALYSTS, APRIL 2018', 84, 310, 36, DIM, a * clamp((beat - T.POOL - 0.3) * 2) * (1 - sstep(ANALYST_END - 0.5, ANALYST_END, beat)));
}
// ---- the books (b24-46): 2D pages on the terminal's ground, each its own picture
const count = (v, b0, beat, dur = 0.9) => v * ease.outExpo(clamp((beat - b0) / dur));
const fmt = (v, d = 1) => v.toFixed(d);
function chartLayer(beat) {      // Gilead hepatitis C on one scale: 2015 (CNBC), Goldman's 2018 estimate (CNBC), 2025 the Epclusa line (Gilead)
  const x0 = 130, pitch = 320, bw = 210, base = 1060, k = 40;      // px per $ billion
  const hd = clamp((beat - T.CHART) * 3);
  mono('GILEAD, HEPATITIS C', 84, 330, 50, '#f1f8fb', hd);
  mono('SALES, $ BILLIONS', 84, 378, 36, DIM, hd);
  mono('2015, 2018: CNBC, 11 APR 2018', 84, 425, 32, DIM, hd);
  mono('2025: GILEAD RESULTS, 10 FEB 2026', 84, 462, 32, DIM, hd);
  for (const v of [0, 5, 10]) { ctx.fillStyle = v === 0 ? '#5d747d' : '#1c2a31'; ctx.fillRect(70, base - v * k, 940, v === 0 ? 3 : 2); if (v) mono('$' + v + 'B', 1000, base - v * k - 10, 32, '#5d747d', 1, 'right'); }
  const bars = [
    { b: 24.5, yr: '2015', v: 12.5, big: '$12.5B', note: 'U.S.', col: COLD },
    { b: 27, yr: '2018', v: 4, big: '<$4B', note: 'ESTIMATE', col: '#ffffff', est: true },
    { b: 29.5, yr: '2025', v: 1.272, big: '$1.27B', note: 'EPCLUSA', col: '#ffffff' }];
  bars.forEach((r, i) => {
    const u = ease.outExpo(clamp((beat - r.b) / 0.7)); if (u <= 0) return;
    const h = r.v * k * u, x = x0 + i * pitch, y = base - h;
    ctx.save();
    if (r.est) { ctx.strokeStyle = r.col; ctx.lineWidth = 5; ctx.setLineDash([22, 14]); ctx.strokeRect(x + 2.5, y + 2.5, bw - 5, h - 5); ctx.globalAlpha = 0.14; ctx.fillStyle = r.col; ctx.fillRect(x, y, bw, h); }
    else { ctx.fillStyle = r.col; ctx.shadowColor = 'rgba(191,230,245,0.55)'; ctx.shadowBlur = i === 0 ? 34 : 14; ctx.fillRect(x, y, bw, h); }
    ctx.restore();
    mono(r.yr, x + bw / 2, base + 62, 54, INK, u, 'center');
    mono(r.note, x + bw / 2, base + 106, 34, DIM, u, 'center');
    mono(r.big, x + bw / 2, y - 24, 62, '#ffffff', u, 'center');
  });
  const a = clamp((beat - 30) * 2);
  mono('EPCLUSA LINE, ALL REGIONS. 2024: $1.60B', 84, 1215, 34, INK, a);
}
// Lilly's weekly injections (Q4 2025 results, 4 Feb 2026) as 52 doses a year; Gilead's HIV products (Q4 2025 results, 10 Feb 2026)
function weekLayer(beat) {
  const a1 = 1 - sstep(T.HIV - 0.3, T.HIV, beat);
  if (a1 > 0) {
    const hd = clamp((beat - T.WEEK) * 3) * a1;
    mono('ELI LILLY, 2025', 84, 330, 40, DIM, hd);
    mono('MOUNJARO + ZEPBOUND', 84, 396, 54, '#f1f8fb', hd);
    mono('$' + fmt(count(36.507, T.WEEK + 0.2, beat, 1.1)) + 'B', 84, 560, 150, '#ffffff', hd);
    mono('$23.0B + $13.5B', 84, 622, 44, DIM, hd);
    // 52 doses: one a week, filling a row at a time
    const cols = 13, sz = 52, pitch = 70, gx = (W - (cols * pitch - 18)) / 2, gy = 700;
    const n = Math.floor(clamp((beat - T.WEEK - 0.3) / 3) * 52 + 0.0001);
    for (let i = 0; i < 52; i++) { const x = gx + (i % cols) * pitch, y = gy + Math.floor(i / cols) * pitch;
      ctx.save(); ctx.globalAlpha = hd; if (i < n) { ctx.fillStyle = COLD; ctx.shadowColor = 'rgba(191,230,245,0.6)'; ctx.shadowBlur = i === n - 1 ? 24 : 8; ctx.fillRect(x, y, sz, sz); }
      else { ctx.strokeStyle = '#2a3b43'; ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, y + 1.5, sz - 3, sz - 3); } ctx.restore(); }
    mono('ONE INJECTION A WEEK.', 84, 1050, 48, '#ffffff', hd);
    mono('52 DOSES A YEAR.', 84, 1106, 48, INK, hd * clamp((beat - T.WEEK - 3) * 3));
    mono('LILLY Q4 2025 RESULTS, 4 FEB 2026', 84, 1215, 32, DIM, hd);
  }
  const hd2 = clamp((beat - T.HIV) * 3);
  if (hd2 > 0) {
    mono('GILEAD, 2025', 84, 330, 40, DIM, hd2);
    mono('HIV PRODUCTS', 84, 396, 54, '#f1f8fb', hd2);
    mono('$' + fmt(count(20.752, T.HIV + 0.2, beat, 1.1)) + 'B', 84, 560, 150, '#ffffff', hd2);
    mono('TREATED, NOT CURED.', 84, 622, 44, DIM, hd2);
    const L = 912 * ease.outExpo(clamp((beat - T.HIV - 0.2) / 1.2));
    ctx.save(); ctx.globalAlpha = hd2; ctx.fillStyle = COLD; ctx.shadowColor = 'rgba(191,230,245,0.55)'; ctx.shadowBlur = 24; ctx.fillRect(84, 700, L, 120); ctx.restore();
    mono('GILEAD Q4 2025 RESULTS, 10 FEB 2026', 84, 1215, 32, DIM, hd2);
  }
}
// the one-time therapy that was tried: Pfizer's own words on ending Beqvez (to Fierce Pharma and Hemophilia News Today, Feb 2025)
const GENE_Q = ['…cease further development', 'and commercialization', 'activities with respect to', 'Beqvez for several reasons,', 'including the limited', 'interest patients and their', 'doctors have demonstrated in', 'hemophilia gene therapies', 'to date,”'];
function geneLayer(beat) {
  const hd = clamp((beat - T.GENE) * 3);
  mono('BEQVEZ', 84, 340, 96, '#f1f8fb', hd);
  mono('ONE-TIME HEMOPHILIA B GENE THERAPY', 84, 396, 34, DIM, hd);
  mono('FDA-APPROVED 2024', 84, 442, 34, DIM, hd);
  mono('PFIZER, FEB 2025, TO HEMOPHILIA NEWS TODAY:', 84, 520, 34, INK, hd);
  typed(GENE_Q, T.GENE + 0.6, beat, { x: 84, y: 600, size: 50, lead: 1.25, cps: 50, color: '#f1f8fb', alpha: hd, cursor: beat < T.GENE + 3.4 });
  const r = sstep(T.GENE + 4.8, T.GENE + 5.6, beat);
  if (r > 0) { ctx.save(); ctx.globalAlpha = r; ctx.fillStyle = RED; ctx.fillRect(84, 1140, 912 * r, 6); ctx.restore(); mono('ENDED.', 84, 1205, 48, '#ff6a5c', r); }
}
function programLayer(beat) {
  let cur = null; for (const c of PROGRAM) if (beat >= c.b) cur = c;
  if (!cur || beat >= PROGRAM_END + 0.5) return;
  const nx = PROGRAM.find(c => c.b > cur.b), endB = nx ? nx.b : PROGRAM_END;
  const age = (beat - cur.b) * B.spb, out = 1 - sstep(endB - 0.2, endB, beat);
  const size = cur.size, lead = 0.98, y0 = 440 + size * 0.85;
  cur.rows.forEach((r, i) => {
    const a = ease.outExpo(clamp((age - i * 0.09) / 0.3)); if (a <= 0) return;
    ctx.save(); ctx.beginPath(); ctx.rect(0, y0 + i * size * lead - size * 0.98, W, size * 1.08); ctx.clip();
    const dy = (1 - a) * size * 1.05;
    line(ctx, r, SAFE_BAND.cx, y0 + i * size * lead + dy, { family: 'Anton', size, color: cur.red && cur.red.includes(i) ? C.red2 : C.cream, maxW: 900, alpha: out });
    ctx.restore();
  });
  const ca = clamp((beat - T.MANDATE - 1) * 2) * (1 - sstep(PROGRAM_END - 0.5, PROGRAM_END, beat));
  if (ca > 0) line(ctx, 'THE PROGRAM, AMERICAN COMMUNIST PARTY', SAFE_BAND.cx, 345, { family: 'Archivo Black', size: 38, color: C.cream, alpha: ca * 0.9, maxW: 920 });
}

// ------------------------------------------------------------------ the 3D world (built in the background)
const P0 = { x: 4.4, z: 3.0 };                       // the pool, flush in the floor, centred on the origin
// where each person stands in the pool, where they walk to (out of it, toward us), and when they set off (beats). The front row
// goes first; each one behind waits until the lane ahead is clear. They stop just past the rim and stand facing us.
const PLANS = {
  six: [
    { at: [1.0, 0.8], to: [1.0, 2.7], go: 12.5 }, { at: [-1.0, 0.75], to: [-1.0, 2.75], go: 14.5 }, { at: [0, 0.7], to: [0, 2.8], go: 16.5 },
    { at: [-0.5, -0.75], to: [-0.5, 1.95], go: 18.0 }, { at: [0.5, -0.8], to: [0.5, 2.0], go: 19.5 }, { at: [1.5, -0.3], to: [1.6, 2.05], go: 21.0 }],
};
const PLAN = PLANS.six;
let W3 = null, building = null;
const T0 = () => B.time(T.POOL);                     // the bakes' time 0 (the first frame that shows the pool)
async function build3D() {
  THREE.ColorManagement.enabled = true;
  const [{ StyleStage }, { litPatchAll }, PI, { makeStage }, { bakeTrack7 }, CM, A7, F4] = await Promise.all([
    import('../lib/fx/style/recipes.js'), import('../lib/fx/light/patch.js'), import('../lib/fx/person/index.js'), import('../lib/fx/stage/index.js'),
    import('../lib/fx/motion/bake7.js'), import('../lib/fx/motion/cloth_motion.js'), import('../lib/fx/motion/act7.js'), import('../lib/fx/cloth/wardrobe4/fabrics4.js')]);
  F4.registerFabrics4();
  const stage = new StyleStage({ width: W, height: H, quality: 'clip' }), lr = stage.lr, scene = new THREE.Scene();
  const st = await PI.loadPersonStudio();
  const STAGE = 'studio@5';
  // ---- the people: each built, its walk out of the pool baked in place (standing until its time, then the walk, the stop, the turn to us)
  const nfEnd = B.time(T.CLOSE + 1) - T0(), FPS = CFG.fps || 15, people = [];
  const who = CFG.who.slice(0, CFG.n || CFG.who.length);
  for (let i = 0; i < who.length; i++) {
    const name = who[i], pl = PLAN[i % PLAN.length], t0 = performance.now();
    let P = null;
    try { P = await PI.makePerson(name, { studio: st, stage: STAGE, wear: 'work', seed: CFG.seed + i, ...A7.personOpts7('walk7', name, {}) }); }
    catch (e) { console.error(`oneshot2: ${name} not built: ${String(e && e.stack || e).slice(0, 300)}`); continue; }
    const vx = pl.to[0] - pl.at[0], vz = pl.to[1] - pl.at[1], dist = Math.hypot(vx, vz), dx = vx / dist, dz = vz / dist, phi = Math.atan2(-dz, dx);
    let face = -phi; while (face > Math.PI) face -= 2 * Math.PI; while (face < -Math.PI) face += 2 * Math.PI;
    const start = Math.max(0.3, B.time(pl.go) - T0());
    const extra = { from: [0, 0], dir: 1, dist, face, start, speedK: 0.92 + 0.05 * (i % 3), seed: CFG.seed + 31 * i };
    const nf = Math.round(nfEnd * FPS) + 2, t1 = performance.now();
    let Bk = null;
    try { Bk = await bakeTrack7(P, () => A7.actFor7('walk7', P, name, extra), { clip: 'walk7', name, fps: FPS, nf, key: 3, every: 2, cloth: false, hair: !!P.groom, rulers: false }); }
    catch (e) { console.error(`oneshot2: ${name}'s walk not baked (they stand, and are gone when their time comes): ${String(e && e.stack || e).slice(0, 300)}`); }
    const h = P.h; h.group.position.set(pl.at[0], 0, pl.at[1]); h.group.rotation.y = Bk ? phi : 0; h.group.updateMatrixWorld(true);
    const tp = Bk ? new CM.TrackPlayer(P, Bk.T) : null, hp = tp ? new CM.HairPlayer(P, tp) : null, ep = tp ? new CM.EyePlayer(P) : null;
    h.group.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    scene.add(h.group);
    people.push({ P, tp, hp, ep, name, go: pl.go, dir: [dx, dz] });
    console.log(`oneshot2: ${name} built in ${((t1 - t0) / 1000).toFixed(1)} s, walk baked in ${((performance.now() - t1) / 1000).toFixed(1)} s (${nf} frames)`);
  }
  if (!people.length) throw new Error('oneshot2: no person could be built');
  // ---- the room: a stage's light (its key, its room as fill), its set hidden; our own dark floor and the pool of light
  const S = await makeStage(STAGE, { scene, renderer: lr.renderer, extent: 7, center: [0, 0.9, 0], contact: false });
  for (const o of S.objects) o.visible = false;
  const rig = S.rig, keyLux = (S.record && S.record.key && S.record.key.lux) || 1200;
  rig.sun.intensity *= 0.42; scene.environmentIntensity = 0.3; scene.background = new THREE.Color(0x000000);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x17191b, roughness: 0.38, metalness: 0.0 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  // the pool's surface: a canvas texture redrawn each frame (the light, its slow ripple, the draining edge)
  const pc = document.createElement('canvas'); pc.width = 704; pc.height = 480; const pg = pc.getContext('2d');
  const ptex = new THREE.CanvasTexture(pc); ptex.colorSpace = THREE.SRGBColorSpace;
  const poolM = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: ptex, roughness: 1, metalness: 0 });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(P0.x, P0.z), poolM); pool.rotation.x = -Math.PI / 2; pool.position.y = 0.004; pool.receiveShadow = true; scene.add(pool);
  // a thin steel coping round it
  const copM = new THREE.MeshStandardMaterial({ color: 0x8a9196, roughness: 0.32, metalness: 0.85 });
  for (const [w, d, x, z] of [[P0.x + 0.12, 0.06, 0, P0.z / 2 + 0.03], [P0.x + 0.12, 0.06, 0, -P0.z / 2 - 0.03], [0.06, P0.z, P0.x / 2 + 0.03, 0], [0.06, P0.z, -P0.x / 2 - 0.03, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), copM); m.position.set(x, 0.006, z); m.receiveShadow = true; scene.add(m); }
  // the pool as a light: a grid of lamps at its surface (pre-exposed candela, set each frame), cool white
  const lamps = [];
  for (let ix = 0; ix < 3; ix++) for (let iz = 0; iz < 2; iz++) {
    const l = new THREE.PointLight(0xd8f1ff, 0, 0, 2); l.position.set((ix - 1) * 1.45, -0.5, (iz - 0.5) * 1.5); l.castShadow = false; scene.add(l); lamps.push(l); }
  // the warm light of the mandate: a high soft spot from the front left
  const warm = new THREE.SpotLight(0xffbf86, 0, 0, 0.75, 0.85, 2); warm.position.set(-3.2, 5.0, 5.2); warm.target.position.set(0, 0.9, -0.2);
  warm.castShadow = true; warm.shadow.mapSize.set(2048, 2048); warm.shadow.bias = -0.0002; scene.add(warm, warm.target);
  litPatchAll(scene);
  const SSS = await PI.ensureSkinSSS(lr, scene);
  const cam = new THREE.PerspectiveCamera(40, W / H, 0.05, 200);
  W3 = { A7, stage, lr, scene, rig, S, people, pool, poolM, ptex, pg, pc, lamps, warm, keyLux, cam, sun0: rig.sun.intensity, meter: null, SSS };
  // meter the faces once, in the full pool (lane B's rule: a group exposed for the group), a little under for a dark room
  poseAt(B.time(18)); aimCam(18); setLights(18);
  W3.meter = PI.meterPeople(st, { lr, scene, camera: cam, rig, people: people.map(p => p.P), bias: -0.35 });
  W3.sun0 = rig.sun.intensity;
  return W3;
}
function poseAt(t) {
  const tau = Math.max(0, t - T0());
  for (const p of W3.people) { const h = p.P.h;
    if (!p.tp) { h.group.visible = B.beat(t) < p.go + 1; continue; }
    const fr = p.tp.apply(tau, { cloth: false });
    try { p.hp.apply(p.tp, fr); } catch (e) { /* no groom */ }
    try { p.ep.apply(p.tp.chan('eyeYaw', fr), p.tp.chan('eyePitch', fr)); } catch (e) { /* eyes */ }
    try { W3.A7.applyFace7(h, nm => p.tp.chan(nm, fr)); } catch (e) { /* no face channels */ }
    p.P.detail?.update?.(); h.update(); p.P.correct?.update?.(); }
}
// the level of the pool: each person who leaves takes a share of it (eased over their first two steps), down to a last glow
function level(beat) {
  const n = W3.people.length; let gone = 0;
  for (const p of W3.people) gone += sstep(p.go + 0.4, p.go + 3.2, beat);
  return Math.max(0, 1 - 0.93 * gone / n) * (1 - 0.85 * sstep(T.CHART - 2, T.CHART, beat));
}
function setLights(beat) {
  const ex = W3.rig.exposure, lv = level(beat), K = W3.keyLux;
  for (const l of W3.lamps) l.intensity = 0.42 * K * lv * ex;
  W3.poolM.emissiveIntensity = 2.4 * K * ex * Math.max(0.02, lv);
  const wk = sstep(T.MANDATE - 0.5, T.MANDATE + 3, beat);
  W3.warm.intensity = 30 * K * ex * wk;
  W3.rig.sun.intensity = (W3.sun0 || W3.rig.sun.intensity) * (1 - 0.55 * sstep(T.CURE + 6, T.CHART, beat) + 0.5 * wk);
  drawPool(beat, lv);
}
function drawPool(beat, lv) {
  const g = W3.pg, w = W3.pc.width, h = W3.pc.height, t = B.time(beat);
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  // the draining edge: the light withdraws from the rim toward the middle as the level falls
  const m = (1 - lv) * 0.42, x0 = w * m * 0.5, y0 = h * m * 0.5;
  const gr = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, Math.max(w, h) * (0.75 - m * 0.6));
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.7, '#e9f8ff'); gr.addColorStop(1, '#b8dcea');
  g.fillStyle = gr; g.fillRect(x0, y0, w - 2 * x0, h - 2 * y0);
  // a slow ripple: soft caustic bands moving across (the surface is liquid light)
  g.save(); g.globalCompositeOperation = 'multiply';
  for (let k = 0; k < 9; k++) { const ph = t * 0.35 + k * 0.7; const y = (k / 9) * h + Math.sin(ph) * 18;
    const lg = g.createLinearGradient(0, y - 30, 0, y + 30); lg.addColorStop(0, 'rgba(255,255,255,1)'); lg.addColorStop(0.5, `rgba(200,225,235,1)`); lg.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = lg; g.fillRect(0, y - 30, w, 60); }
  g.restore();
  W3.ptex.needsUpdate = true;
}
// the camera, by beat: high over the full pool, pushing in; rising a little as they leave; holding on the dark pool; down to them
// high over the full pool, pushing in as they leave; then, for the Program, a wide, level camera past the dark pool: the six small and low in the frame,
// the type clear above them (a head there is under 100 px: a silhouette, drawn as one)
const CAMS = [[5, [0, 6.6, 9.6], [0, 1.6, -1.0], 38], [24, [0, 5.6, 8.0], [0, 1.5, -0.8], 38], [47.9, [0, 2.6, 12.0], [0, 2.6, 1.5], 40],
  [48, [0, 2.6, 12.0], [0, 2.6, 1.5], 40], [70, [0, 2.4, 11.0], [0, 2.5, 1.5], 40]];
function aimCam(beat) {
  let a = CAMS[0], b = CAMS[0]; for (let i = 0; i < CAMS.length; i++) { if (beat >= CAMS[i][0]) { a = CAMS[i]; b = CAMS[Math.min(i + 1, CAMS.length - 1)]; } }
  const u = b === a || b[0] - a[0] < 0.5 ? 0 : sstep(a[0], b[0], beat), cam = W3.cam;
  cam.position.set(lerp(a[1][0], b[1][0], u), lerp(a[1][1], b[1][1], u), lerp(a[1][2], b[1][2], u));
  cam.lookAt(lerp(a[2][0], b[2][0], u), lerp(a[2][1], b[2][1], u), lerp(a[2][2], b[2][2], u));
  cam.fov = lerp(a[3], b[3], u); cam.updateProjectionMatrix();
}
// the stylisation (the person pipeline's faces do not read as photographs yet, and under ~200 px a face is a silhouette anyway): the render is taken to a
// one-ink duotone, a cold one for the pool and a warm one for the Program, under the page's own scan lines. look 'ink' pushes it to near-notan.
async function draw3D(beat, t) {
  if (!W3) W3 = await building;
  poseAt(t); aimCam(beat); setLights(beat);
  W3.lr.render({ scene: W3.scene, camera: W3.cam, rig: W3.rig, t: 0, ...W3.S.renderOpts, K: CFG.K }); W3.lr.sync?.();
  const warm = sstep(T.MANDATE - 0.5, T.MANDATE + 0.5, beat), ink = CFG.look === 'ink';
  ctx.save(); ctx.filter = ink ? 'grayscale(1) contrast(2.2) brightness(1.05)' : 'grayscale(1) contrast(1.4) brightness(1.05)';
  ctx.drawImage(W3.stage.glc, 0, 0, W, H); ctx.restore(); ctx.filter = 'none';
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = warm > 0.5 ? '#ffb98a' : '#a8d8ee'; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighten'; ctx.fillStyle = warm > 0.5 ? '#1a0c08' : '#06121a'; ctx.fillRect(0, 0, W, H); ctx.restore();
  scan(0.07);
}

// ------------------------------------------------------------------ the mark: four stripes grown in the pool's light, going red
function markLayer(beat) {
  const u = clamp((beat - T.MARK) / (T.CLOSE - T.MARK));
  ctx.fillStyle = `rgba(3,2,2,${0.55 + 0.4 * sstep(0, 0.5, u)})`; ctx.fillRect(0, 0, W, H);
  const col = u < 0.5 ? '#d8f1ff' : C.red;
  const s = [0, 1, 2, 3].map(k => sstep(0.05 + k * 0.12, 0.3 + k * 0.12, u));
  ctx.save(); if (u < 0.5) { ctx.shadowColor = 'rgba(216,241,255,0.6)'; ctx.shadowBlur = 30; }
  drawMark(ctx, SAFE_BAND.cx, 760, 300, { color: col, badge: sstep(0, 0.2, u), stripes: s }); ctx.restore();
  if (u >= 0.5) { ctx.save(); ctx.globalAlpha = 1 - sstep(0.5, 0.75, u); drawMark(ctx, SAFE_BAND.cx, 760, 300, { color: '#d8f1ff', badge: 1, stripes: s }); ctx.restore(); }
}

// ------------------------------------------------------------------ one frame
const dip = (beat, b0, d = 0.3) => { const a = 1 - sstep(b0, b0 + d, beat); if (a > 0) { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(0, 0, W, H); } };
window.renderFrame = async (t) => {
  const beat = B.beat(t), frame = Math.round(t * 30);
  if (beat >= T.CLOSE) { closer(ctx, (beat - T.CLOSE) * B.spb); finish.apply(ctx, frame, { grain: 0.05, vignette: 0.4 }); return {}; }
  if (beat < T.POOL) {
    terminal(beat); ctx.fillStyle = `rgba(0,0,0,${sstep(T.POOL - 0.35, T.POOL, beat)})`; ctx.fillRect(0, 0, W, H);
    finish.apply(ctx, frame, { grain: 0.035, vignette: 0.25 }); return { shot: 'terminal' };
  }
  if (beat < T.CHART) {
    await draw3D(beat, t);
    const tg = ctx.createLinearGradient(0, 200, 0, 1000); tg.addColorStop(0, 'rgba(0,0,0,0.6)'); tg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = tg; ctx.fillRect(0, 200, W, 800);
    analystLayer(beat);
    dip(beat, T.POOL, 0.5); const out = sstep(T.CHART - 0.3, T.CHART, beat); if (out > 0) { ctx.fillStyle = `rgba(0,0,0,${out})`; ctx.fillRect(0, 0, W, H); }
    finish.apply(ctx, frame, { grain: 0.045, vignette: 0.35 }); return { shot: 'pool' };
  }
  if (beat < T.MANDATE) {
    if (beat < T.DARK) {
      page();
      if (beat < T.WEEK) chartLayer(beat); else if (beat < T.GENE) weekLayer(beat); else geneLayer(beat);
      for (const b0 of [T.CHART, T.WEEK, T.GENE]) if (beat >= b0 && beat < b0 + 0.3) dip(beat, b0, 0.3);
      const o = sstep(T.DARK - 0.3, T.DARK, beat); if (o > 0) { ctx.fillStyle = `rgba(0,0,0,${o})`; ctx.fillRect(0, 0, W, H); }
    } else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
    finish.apply(ctx, frame, { grain: 0.04, vignette: 0.3 }); return { shot: 'books' };
  }
  await draw3D(beat, t);
  dip(beat, T.MANDATE, 0.25);
  const tg = ctx.createLinearGradient(0, 220, 0, 1000); tg.addColorStop(0, 'rgba(0,0,0,0.6)'); tg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = tg; ctx.fillRect(0, 220, W, 780);
  programLayer(beat);
  if (beat >= T.MARK) markLayer(beat);
  finish.apply(ctx, frame, { grain: 0.045, vignette: 0.35 });
  return { shot: 'mandate' };
};
ready = true;
building = build3D().catch(e => { console.error('oneshot2 build failed: ' + (e && e.stack || e)); window.sceneError = String(e && e.stack || e); throw e; });
