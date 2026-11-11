// LAB / FOLK (HUMAN studio, cycle 3): the people reel. Crowds as designed ranks (ranks.js + the SIL atlas), people
// placed IN the worlds under the worlds' own lights (folk_worlds.js), the profile with the new hard hat and the
// plane-head print face, and the fist on the hit.
//   ?subject=crowd_close|crowd_mid|crowd_far|profile|lineman|plant|farmer|driver|surge|fisthit
//   &mode=raw|SERIGRAPH|NOTAN|THERMAL|... (any look of looks.js; THERMAL only for plant)
// window.renderFrame(t) draws into #out and returns the shot's measurements (window.labInfo).
import { Ranks, feedCheck } from '../lib/fx/ranks.js';
import { Looks } from '../lib/fx/looks.js';
import { Stage, KITS, planeHead } from '../lib/fx/folk_worlds.js';
import { Print } from '../lib/fx/print.js';
import * as THREE from 'three';

const Q = new URLSearchParams(location.search);
const SUBJ = Q.get('subject') || 'crowd_mid', MODE = Q.get('mode') || 'raw';
const W = 1080, H = 1920;
const out = document.getElementById('out'), ctx = out.getContext('2d');
const col = Object.assign(document.createElement('canvas'), { width: W, height: H }), cg = col.getContext('2d');
const shape = Object.assign(document.createElement('canvas'), { width: W, height: H }), sg = shape.getContext('2d');
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const rng = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
window.labInfo = {};

// ---------------------------------------------------------------- sky (flat bands, a hard sun disc: no glow halo on figures)
function dusk(g, sun, { top = '#1a0c12', mid = '#6a2012', hor = '#e0703a', horY = 1000, r = 170 } = {}) {
  const gr = g.createLinearGradient(0, 0, 0, horY); gr.addColorStop(0, top); gr.addColorStop(0.55, mid); gr.addColorStop(1, hor);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const rg = g.createRadialGradient(sun[0], sun[1], r, sun[0], sun[1], r * 4); rg.addColorStop(0, 'rgba(255,190,110,0.55)'); rg.addColorStop(1, 'rgba(255,120,60,0)');
  g.fillStyle = rg; g.fillRect(0, 0, W, horY);
  g.fillStyle = '#ffd89a'; g.beginPath(); g.arc(sun[0], sun[1], r, 0, Math.PI * 2); g.fill();
  sg.clearRect(0, 0, W, H); sg.fillStyle = '#fff'; sg.beginPath(); sg.arc(sun[0], sun[1], r, 0, Math.PI * 2); sg.fill();
}

const S = {};
let R = null, lk = null;
// the crowd at three scales (the brief's demo cells 1-3). The scale ladder: hero / near / mass / texture; never a
// continuous field, never a middle scale.
S.crowd_mid = async () => {
  const sun = [610, 820];
  const crowd = R.design({ seed: +(Q.get('seed') || 4), ranks: [
    { foot: 1700, h: 250, raise: 0.28, tools: 0.15, pack: 1.7, flags: 1, gaps: 0.04 },     // near: 13% of frame height
    { foot: 1290, h: 112, raise: 0.3, flags: 2, tools: 0.08, pack: 1.5 },     // 6%
    { foot: 1130, h: 58, raise: 0.25, flags: 2, pack: 1.4 },                   // 3%
    { foot: 1060, h: 28, raise: 0.18, flags: 3, pack: 1.6 },                   // texture: 1.5%
  ] });
  return t => ({ crowd, sun, back: g => dusk(g, sun, { horY: 1060, r: 150 }) });
};
S.crowd_close = async () => {
  const sun = [450, 760];
  const st = new Stage({ W, H }); await st.init();
  const backs = await KITS.backs(st, { sun2d: sun, strike: SUBJ === 'fisthit' ? { onset: +(Q.get('hit') || 1.0) } : null });
  const crowd = R.design({ seed: +(Q.get('seed') || 11), ranks: [
    { foot: 2300, h: 1300, draw: t => backs.draw(t) },                                          // hero backs in 3D, cropped by the frame
    { foot: 1330, h: 240, raise: 0.3, flags: 1, tools: 0.12, pack: 1.1 },
    { foot: 1150, h: 105, raise: 0.28, flags: 2, pack: 1.3 },
    { foot: 1075, h: 44, raise: 0.2, flags: 2, pack: 1.5 },
  ] });
  window.__backs = backs;
  return t => ({ crowd, sun, back: g => dusk(g, sun, { horY: 1075, r: 170 }), gestures: () => backs.gestures() });
};
S.fisthit = S.crowd_close;
S.crowd_far = async () => {
  // the Klutsis collision: one fist at monument scale over a mass of 200+ as texture under the sky
  const sun = [330, 900];
  const st = new Stage({ W, H }); await st.init();
  const fist = await KITS.backs(st, { sun2d: sun, cam: 'fist', cast: [{ variant: 'forge', height: 1.84, kind: 'work', shirt: '#28323e', trousers: '#2c3e5e', hat: 'none', beard: 0, stubble: 0.7, seed: 95, x: 0, z: 0, turn: Math.PI - 0.25, arm: 'R' }] });
  const crowd = R.design({ seed: +(Q.get('seed') || 7), ranks: [
    { foot: 2400, h: 1500, draw: t => fist.draw(t) },
    { foot: 1560, h: 62, raise: 0.3, flags: 3, pack: 1.3 },
    { foot: 1440, h: 40, raise: 0.25, flags: 3, pack: 1.5 },
    { foot: 1360, h: 27, raise: 0.18, flags: 2, pack: 1.7 },
    { foot: 1305, h: 17, raise: 0.12, pack: 1.9 },
  ] });
  return t => ({ crowd, sun, back: g => dusk(g, sun, { horY: 1305, r: 120, top: '#12080e' }), gestures: () => fist.gestures() });
};

// the SURGE clip: the ranks advance (walking away toward the sun, on twos), the camera pushes 8%, and on the hit a
// fist wave ripples out from the hero (0-4 frame jitter per figure: the crowd answers him, not in unison)
S.surge = async () => {
  const sun = [560, 800], hitT = +(Q.get('hit') || 1.0);
  const crowd = R.design({ seed: +(Q.get('seed') || 5), ranks: [
    { foot: 1760, h: 300, raise: 0.55, tools: 0.1, pack: 1.6, walk: true, gaps: 0.03 },
    { foot: 1330, h: 120, raise: 0.55, flags: 2, pack: 1.5, walk: true },
    { foot: 1150, h: 60, raise: 0.3, flags: 2, pack: 1.5, walk: true },
    { foot: 1070, h: 28, raise: 0.2, flags: 3, pack: 1.7, walk: true },
  ] });
  for (const Rk of crowd.ranks) for (const f of Rk.figs) f.stride = 1.1;
  R.hit(crowd, hitT, { from: [540, 1900], speed: 260, jitter: 4, lead: -1 });
  crowd.surge = (f, t) => { const k = 1 + 0.08 * Math.min(1, t / 2), adv = -f.h * 0.09 * t; return { k, dx: (f.x - 540) * (k - 1), dy: (f.y - 1100) * (k - 1) + adv }; };
  return t => ({ crowd, sun, back: g => dusk(g, sun, { horY: 1070, r: 150 }) });
};

// ---------------------------------------------------------------- people in the worlds (folk_worlds.js)
const WORLD = { posetest: ['posetest', {}], plant: ['plant', {}], profile: ['plant', { close: true }], lineman: ['lineman', {}], farmer: ['farmer', {}], driver: ['driver', {}] };
let W3 = null;
async function world(name) { const [kit, o] = WORLD[name]; const st = new Stage({ W, H }); await st.init(); W3 = await KITS[kit](st, { ...o, thermal: MODE === 'THERMAL' }); W3.st = st;
  if (MODE === 'ENGRAVE') { if (Q.get('planes') !== '0') planeHead(W3.heroes[0], +(Q.get('k') || 41)); pr = new Print(); pr.preload(['cream']); }
  return W3; }
let pr = null;
// the face's ink strokes over the print (Spider-Verse: authored, bone-attached): a swelling, tapering ribbon per stroke
function inkFace(g, strokes) {
  g.save();
  for (const S0 of strokes) { const P = S0.pts; if (P.length < 2) continue;
    if (S0.ink === 'paper') { g.fillStyle = '#f4ecd8'; const r = Math.max(1.2, S0.w * 0.9); g.beginPath(); g.arc(P[0][0], P[0][1], r, 0, Math.PI * 2); g.fill(); continue; }
    g.fillStyle = S0.kind === 'socket' ? 'rgba(26,20,16,0.35)' : '#1a1410';
    const L = [], R2 = [];
    for (let i = 0; i < P.length; i++) { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      const u = i / (P.length - 1), w = S0.w * (0.25 + 0.75 * Math.sin(Math.PI * u)) * 0.5; L.push([P[i][0] - dy / l * w, P[i][1] + dx / l * w]); R2.push([P[i][0] + dy / l * w, P[i][1] - dx / l * w]); }
    g.beginPath(); g.moveTo(...L[0]); for (const q of L.slice(1)) g.lineTo(...q); for (const q of R2.reverse()) g.lineTo(...q); g.closePath(); g.fill(); }
  g.restore();
}

// ---------------------------------------------------------------- run
let sub = null;
async function setup() {
  R = await Ranks.create({ W, H });
  R.emblem = await loadImg('../assets/acp_mark.png');
  if (WORLD[SUBJ]) await world(SUBJ); else sub = await S[SUBJ]();
  if (MODE !== 'raw' && MODE !== 'THERMAL' && MODE !== 'ENGRAVE') lk = new Looks();
  window.sceneReady = true;
}
function renderWorld(t) {
  // ENGRAVE: an engraver works from a modelled light: a raking key from the front-left above (Rembrandt), the world's own lights kept as the rim
  let tmp = [];
  if (MODE === 'ENGRAVE') { const st = W3.st, cam = st.camera, fw = new THREE.Vector3(); cam.getWorldDirection(fw); const left = new THREE.Vector3().crossVectors(cam.up, fw).normalize();
    const key = new THREE.DirectionalLight('#fff4e8', +(Q.get('key') || 3.2)); key.position.copy(cam.position).addScaledVector(left, 2.2).add(new THREE.Vector3(0, 2.4, 0)); key.target.position.copy(cam.position).addScaledVector(fw, 3);
    const hemi = new THREE.HemisphereLight('#e8e0d8', '#3a3028', 0.5); st.scene.add(key, key.target, hemi); tmp = [key, key.target, hemi]; }
  const t0 = performance.now(), fr = W3.frame(t), info = { subject: SUBJ, mode: MODE, ...fr.info };
  for (const o of tmp) o.parent.remove(o);
  if (MODE === 'ENGRAVE') { const st = W3.st, aux = st.gbuf();
    pr.render(ctx, fr.color, [['engrave', { pitch: 6.5, contour: 0.9, crosshatch: 1, stipple: 1 }]], { t, paper: 'cream', aux, prep: { subject: 'aux', clear: 0.5, contrast: 0.75 }, out: null });
    const h0 = W3.heroes[0], ft = h0.faceTier(st.camera, H); if (ft.px > 160) inkFace(ctx, h0.inkStrokes(st.camera, W, H, { shout: 0 }));
    info.frame_ms = Math.round(performance.now() - t0); return info; }
  if (!lk) ctx.drawImage(fr.color, 0, 0, W, H);
  else { lk.source({ color: fr.color, aux: fr.aux, shape: null, depth: [1, Math.E ** 4], tonal: ['subject', 'mid'], rankCut: false }, {}); lk.apply(ctx, MODE, t, {}); }
  info.frame_ms = Math.round(performance.now() - t0);
  return info;
}
function renderFrame(t) {
  if (W3) return renderWorld(t);
  const sh = sub(t), t0 = performance.now();
  cg.clearRect(0, 0, W, H);
  const res = R.compose(cg, sh.crowd, t, { back: sh.back, sun: sh.sun, style: sh.style || 'dusk' });
  const info = { subject: SUBJ, mode: MODE, figures: res.stats.figures, compose_ms: Math.round(res.stats.ms) };
  if (MODE === 'raw') ctx.drawImage(col, 0, 0);
  else { lk.source({ color: col, aux: res.aux, shape, depth: [1, Math.E ** 4], tonal: ['subject', 'ground'], rankCut: true, anchor: [sh.sun[0], sh.sun[1], 160] }, {});
    lk.apply(ctx, MODE, t, {}); }
  if (sh.gestures) { const gs = sh.gestures(); info.hero_gestures = gs.map(q => ({ side: q.side, name: q.name, interior: q.interior, elev: q.elev, fistPx: q.fistPx, flags: q.flags })); info.salute_flags = gs.filter(q => q.flags.length).length; }
  Object.assign(info, feedCheck(out, res.layers), { frame_ms: Math.round(performance.now() - t0) });
  return info;
}
window.renderFrame = t => { const info = renderFrame(t); window.labInfo = info; return info; };
setup().catch(e => { console.error(e.stack || e.message); window.sceneError = String(e.message); });
