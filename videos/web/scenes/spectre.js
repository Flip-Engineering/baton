// A SPECTRE IS HAUNTING (8 Oct 2026; the lead of ACP OCTOBER, research/acp_october_halloween.md). The reference (a carousel captioned "A Spectre
// is Haunting": a black mass of men in caps packed to the frame's edges, every pair of eyes burning white, one bearded man in the centre looking
// down the lens) is translated: the horror is not a monster but the working class waking, all eyes on you. The words are the Manifesto's
// opening, verbatim (research/sources/texts/marx-manifesto-ch1.txt l.5 and l.13): the spectre, the holy alliance of old Europe's powers to
// exorcise it, and the answer: meet this nursery tale with a manifesto of the party itself.
//   0-3.6    black; one pair of eyes opens in the middle of the frame (a bearded worker in a cap, hero.js) and looks down the lens; the lens
//            rises and draws back, and the eyes behind him open in a ripple round his head     A SPECTRE IS HAUNTING EUROPE / THE SPECTRE OF COMMUNISM.
//   3.6-17   the camera draws back: the crowd (people.js, caps, a few thousand) to the frame's edges in the dark; the powers are their light only,
//            searchlights that sweep the crowd (the crowd looks away into the dark), and every sweep opens more eyes
//                                                                                        ALL THE POWERS OF OLD EUROPE ... POPE AND TSAR ... POLICE-SPIES.
//   17-27.5  the answer: back to him (the powers' light is out); every face turns to the lens; his fist lands on the manifesto, the crowd's after
//   27.5-31  the turn: from straight above, rising: the eyes outside the emblem close; the men who stand in it hold up candles, lit from the
//            one nearest him outward, so the emblem is what the crowd leaves burning, drawn in their light; and it burns red
// New shared assets: lib/fx/eyes.js (eye lights for any crowd or hero). Engines: people.js, hero.js, bands.js. 60 BPM: beats = seconds.
import * as THREE from 'three';
import { W, H, loadFonts, outCanvas, Finish, closer, clamp, lerp, ease, rng, BRAND } from '../lib/kit.js';
import { People } from '../lib/fx/people.js';
import { workerDesc } from '../lib/fx/workforce.js';
import { loadAnsur } from '../lib/fx/rig/body.js';
import { loadHeroData, Hero } from '../lib/fx/hero.js';
import { Eyes } from '../lib/fx/eyes.js';
import { loadBands, cueType } from '../lib/fx/bands.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = outCanvas();
await loadFonts(); await loadBands();
const finish = new Finish(1848);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const E = ease.inOutCubic, EO = ease.outCubic;
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };

export const TL = { open: 0.35, s1: 1.0, ripple: 2.4, s2: 3.6, alliance: 6.4, exorcise: 10.0, pope: 12.0, mett: 13.4, french: 14.8, high: 17.0, tale: 20.5,
  manifesto: 24.0, rise: 27.5, red: 29.2, mark: 31.0, end: 34.0 };

// ------------------------------------------------------------------ the world: a black field, a low moon behind them, the powers' searchlights
const glc = document.createElement('canvas'); glc.width = W; glc.height = H;
const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#000000'); scene.fog = new THREE.Fog('#000000', 7, 34);
const camera = new THREE.PerspectiveCamera(40, W / H, 0.05, 400);
const hemi = new THREE.HemisphereLight('#8090a0', '#000000', 0.03); scene.add(hemi);
const moon = new THREE.DirectionalLight('#9fb0c8', 0.22); moon.position.set(-6, 9, -14); scene.add(moon);           // behind them: a rim on every cap and shoulder
// v2 (the review: he read as a floating face, the crowd's heads black through the turn). The moon is the rim: MOON gives its strength per
// shot, so his outline and the near rows' caps and shoulders read at about 10-30/255 after the grade (the p90 of their outlines, measured in
// node), and it rises on the manifesto so the rows behind him show their raised fists. His own coat and cap are near black (0.011 linear), so
// the same moonlight is gathered on him by a narrow back light from the moon's side (himRim, 0.12 rad: at 0.21 it lit the caps of the men
// behind him to 120-200/255). The opening shot to 6.4 s keeps the old moon and no himRim: pure black with eyes, as approved.
const MOON = { open: 0.5, wide: 2.0, close: 1.4, payoff: 5.5 }, HIM_RIM = { open: 0, wide: 80, close: 30 }, FIST_I = 28;      // the opening (to 6.4 s), the wide shot (to 17 s), the close shots after it
const himRim = new THREE.SpotLight('#9fb0c8', 0, 9, 0.12, 0.6, 2); himRim.position.set(-1.6, 3.85, -3.45); himRim.target.position.set(0, 1.45, 0); scene.add(himRim, himRim.target);
// the fist on the manifesto: a narrow warm key from in front of it and above, carried with his grip, so his raised fist is lit where it lands.
// Its reach ends 0.35 m past the fist (1.85 m), so the man behind him, on the line of the beam, stays dark (at 4 m he was lit to 144/255)
const fistKey = new THREE.SpotLight('#ffe2c0', 0, 1.85, 0.1, 0.7, 2); scene.add(fistKey, fistKey.target);
const FIST_KEY = V3(-0.2, 0.5, 1.4);
{ const g = new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2); const m = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.95 });
  const gr = new THREE.Mesh(g, m); gr.receiveShadow = true; scene.add(gr); }
// the searchlights: a spot each, and the beam you see in the night air. The beam is haze lit by the lamp, not a solid cone: each pixel sums a
// gaussian beam (sigma = 3.5 % of the distance from the lamp, so the light per unit of haze falls as the beam spreads) along its own view ray,
// worked out exactly from the ray's closest approach to the axis, so the edges are soft, a beam end-on to the lens still shows, and the
// camera can stand inside one. It is written above the grade's black point (contrast 1.3 crushes anything under 0.115) so it survives.
// The cone is closed at both ends (v2, the review's black dome in beam 4 at 16.0-16.97 s): a beam coming at the lens shows the lens its foot,
// and through an open foot those rays met no front face at all, so the ellipse of the foot above the crowd drew no haze, a hard black dome
// in the beam (49/255 steps at its edge, measured in node; 2/255 closed). The haze also stops where the ray meets the ground (the share of
// the gaussian along the ray that lies before it, faded over the last metre above it), and the mesh reaches 3.4 sigma with the gaussian taken
// less its value there, so the haze meets the wall at zero and no edge of the mesh shows where two beams overlap (beam 3 over beam 2 at 13.5 s:
// 36/255 steps) or by a lamp, where the haze is dense (beam 4's at the frame's left edge, 15-17 s).
const BEAM_VS = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const BEAM_FS = `uniform float uI, uLen, uIn; uniform vec3 uSrc, uDir; varying vec3 vW;
float erfA(float x){ float t = 1.0 / (1.0 + 0.3275911 * abs(x));                // Abramowitz and Stegun 7.1.26
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x); return sign(x) * y; }
void main(){
  if ((uIn > 0.5) == gl_FrontFacing) discard;                                   // one fragment per pixel: the near face, or the far one from inside
  vec3 rd = normalize(vW - cameraPosition), w0 = cameraPosition - uSrc;
  float b = dot(rd, uDir), d = dot(rd, w0), e = dot(uDir, w0), den = max(1e-4, 1.0 - b * b);
  float tr = max(0.0, (b * e - d) / den), s = clamp(dot(cameraPosition + rd * tr - uSrc, uDir), 0.0, uLen);
  float sig = 0.035 * (0.15 * uLen + 0.85 * s), r = length(cameraPosition + rd * tr - (uSrc + uDir * s)), sd = max(sqrt(den), 0.15);
  float tau = 1.35 * max(0.0, exp(-0.5 * r * r / (sig * sig)) - 0.0030887) / (sig * sd);    // optical depth across the gaussian, less its value at the mesh's wall (3.4 sigma)
  if (rd.y < 0.0) { float tg = cameraPosition.y / -rd.y, fl = 1.0 / max(-rd.y, 0.02), sa = sig / sd;     // only the haze above the ground, faded over its last metre
    tau *= 0.5 + 0.5 * erfA((tg - 0.5 * fl - tr) / (1.41421356 * sqrt(sa * sa + 0.09 * fl * fl))); }
  float a = uI * (1.0 - exp(-tau)) * (0.82 - 0.22 * s / uLen) * (1.0 - smoothstep(uLen * 0.9, uLen, s));
  gl_FragColor = vec4(vec3(0.92, 0.95, 1.0) * a * 0.48, 1.0);
}`;
function searchlight() {
  const s = new THREE.SpotLight('#eef3ff', 0, 90, 0.085, 0.45, 1.2); s.castShadow = true; s.shadow.mapSize.set(1024, 1024); s.shadow.bias = -0.0005; scene.add(s, s.target);
  const U = { uI: { value: 0 }, uLen: { value: 1 }, uIn: { value: 0 }, uSrc: { value: V3() }, uDir: { value: V3(0, -1, 0) } };
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 1, 1, 48, 16, false).translate(0, -0.5, 0), new THREE.ShaderMaterial({ vertexShader: BEAM_VS, fragmentShader: BEAM_FS,
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  cone.frustumCulled = false; scene.add(cone);
  return { s, cone, aim(from, to, I, eye) {
    s.position.copy(from); s.target.position.copy(to); s.intensity = I * 2600; s.target.updateMatrixWorld();
    const d = to.clone().sub(from), L = d.length(), Rm = 3.4 * 0.035 * L; cone.position.copy(from); cone.scale.set(Rm, L, Rm);      // the mesh reaches 3.4 sigma (v2: at 2.6 the dense haze by the lamp was cut at the wall)
    d.normalize(); cone.quaternion.setFromUnitVectors(V3(0, -1, 0), d); U.uI.value = I; U.uLen.value = L; U.uSrc.value.copy(from); U.uDir.value.copy(d); cone.visible = I > 0.001;
    if (eye) { const s0 = clamp(eye.clone().sub(from).dot(d), 0, L), r = eye.clone().sub(from.clone().addScaledVector(d, s0)).length(); U.uIn.value = r < Rm * (0.15 + 0.85 * s0 / L) * 0.98 ? 1 : 0; } } };
}
const LIGHTS = [searchlight(), searchlight()];
// each power's sweep: [t0, t1, the lamp, the path its pool travels (from -> to)]. Each pool crosses its own part of the crowd (the left lane,
// the right lane, the near band, the far rows down the middle) inside the narrow frame (half-width about 0.22 x the distance) and within the
// fog's reach, at an even pace, from its power's stab; the lamps stand high, off frame, behind and to the sides, so each beam comes in from a
// frame edge beside or under the type (0-9 % of a beam's pixels under a band, measured).
const SWEEPS = [
  [TL.alliance + 0.4, TL.exorcise + 1.4, V3(-8, 24, -24), V3(-4.6, 0, -24), V3(-2.2, 0, -12.5)],
  [TL.pope, TL.mett + 0.1, V3(8, 20, -28), V3(4.6, 0, -22), V3(2.2, 0, -12.5)],
  [TL.mett, TL.french + 0.1, V3(10, 13, -28), V3(-2.8, 0, -9.6), V3(2.8, 0, -9.0)],
  [TL.french, TL.high + 0.2, V3(-9, 16, -44), V3(-4.0, 0, -28), V3(0.5, 0, -13)],
];
const EASE_SW = x => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x));                 // gentle at the ends, even through the frame
function beamFoot(sw, t) { const u = clamp((t - sw[0]) / (sw[1] - sw[0])); return sw[3].clone().lerp(sw[4], EASE_SW(u)); }

// ------------------------------------------------------------------ the crowd: a few thousand in caps, packed to the edges, facing him and the lens
const ANSUR = await loadAnsur();
const R = rng(1848);
const TRADES = ['rail', 'farm', 'overalls', 'weld'];
const AREA = { x: 13, z0: -30, z1: 16, dx: 0.66, dz: 0.7 };
// the emblem, laid on the ground behind him, and the men who stand to form it. Seen from above at the end it must read as the gear, the hammer
// and the sickle, so it is drawn by the lights its people hold up, not by the crowd's spacing: at the old 21 m on the 0.66 x 0.7 m crowd it
// was 181 eye pairs, a 25 x 13 dot matrix. EMB.size is the logo's long side on the ground (27 m: the mark is 21.6 x 11.7 m, its finest parts,
// the gear's teeth and the cuts between hammer, sickle and gear, 0.7 m and 0.36 m), and its near edge stays just behind him (he stands outside it).
// Measured in node at 30.99 s (the light buffers splatted per pixel through the eyes and flame shaders, graded, against the logo's alpha laid
// on the ground and projected): IoU 0.13 -> 0.91, edges agreeing within 3 px F 0.12 -> 0.69.
const EMB = { cx: 0, size: 27, near: -0.44 };
const embMask = (() => { const c = document.createElement('canvas'), S = 512; c.width = c.height = S; const g = c.getContext('2d'); const E0 = BRAND.acp_emblem;
  const k = S / Math.max(E0.width, E0.height); g.drawImage(E0, (S - E0.width * k) / 2, (S - E0.height * k) / 2, E0.width * k, E0.height * k);
  const d = g.getImageData(0, 0, S, S).data;
  // the mark's own extent: the emblem canvas is letterboxed (and has empty rows above the gear), so its near edge sets cz and the overhead
  // lens aims at its centre (ox, oz) and rises until its width (w) fills 86 % of the frame
  let r0 = S, r1 = -1, c0 = S, c1 = -1;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (d[(y * S + x) * 4 + 3] > 127) { r0 = Math.min(r0, y); r1 = Math.max(r1, y); c0 = Math.min(c0, x); c1 = Math.max(c1, x); }
  if (r1 < 0) { r0 = c0 = 0; r1 = c1 = S - 1; }
  EMB.cz = EMB.near - ((r1 + 1) / S - 0.5) * EMB.size;
  EMB.ox = EMB.cx + ((c0 + c1 + 1) / 2 / S - 0.5) * EMB.size; EMB.oz = EMB.cz + ((r0 + r1 + 1) / 2 / S - 0.5) * EMB.size;
  EMB.x0 = EMB.cx + (c0 / S - 0.5) * EMB.size; EMB.x1 = EMB.cx + ((c1 + 1) / S - 0.5) * EMB.size; EMB.z0 = EMB.cz + (r0 / S - 0.5) * EMB.size; EMB.w = EMB.x1 - EMB.x0;
  EMB.top = 2 + EMB.w / (2 * 0.86 * (W / H) * Math.tan(THREE.MathUtils.degToRad(22)));   // the final height (fov 44)
  return (x, z) => { const u = (x - EMB.cx) / EMB.size + 0.5, v = (z - EMB.cz) / EMB.size + 0.5;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0; return d[(Math.floor(v * S) * S + Math.floor(u * S)) * 4 + 3] / 255; }; })();
// Each man in the mark holds a candle up in his right fist (people.js PUMP held at p = 1: the flame stands FLAME from his feet, measured over
// the mark's men: x -0.205 +- 0.025, z 0.006 +- 0.007, the fist 1.96 m up and the candle 0.1 m above it). They stand closer than the crowd round
// them, at least MARK_GAP apart (3.9 a square metre against the crowd's 2.2, shoulder to shoulder: a crowd gathered to make a sign; the crowd's
// own jittered lattice already puts some neighbours 0.37 m apart), and they line its edges first: every flame place MARK_IN inside an edge (or
// as deep as a thin stroke allows, down to MARK_MIN) is taken before the strokes are filled, so each tooth, the sickle's blade and the cuts
// between the parts are drawn by a row of flames along them. The crowd keeps its own places outside, at least MARK_CLEAR from any of them, and
// no one stands in the cuts. 535 men in the mark (359 of the crowd's places give way to them): 2814 people in all, against 2638.
const FLAME = V3(-0.205, 2.06, 0.006), MARK_GAP = 0.45, MARK_CLEAR = 0.45, MARK_IN = 0.25, MARK_MIN = 0.15;
const MARK = (() => { const gs = 0.05, X0 = EMB.x0 - 0.1, Z0 = EMB.z0 - 0.1, NX = Math.ceil((EMB.w + 0.2) / gs), NZ = Math.ceil((EMB.near - EMB.z0 + 0.2) / gs), N = NX * NZ;
  const IN = new Uint8Array(N); for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) IN[j * NX + i] = embMask(X0 + (i + 0.5) * gs, Z0 + (j + 0.5) * gs) > 0.5 ? 1 : 0;
  // how deep each place is inside the mark: the exact distance transform (Felzenszwalb and Huttenlocher), columns then rows
  const D2 = new Float64Array(N), f = new Float64Array(Math.max(NX, NZ)), o = new Float64Array(Math.max(NX, NZ)), v = new Int32Array(Math.max(NX, NZ)), zz = new Float64Array(Math.max(NX, NZ) + 1);
  const edt = n => { let k = 0; v[0] = 0; zz[0] = -Infinity; zz[1] = Infinity;
    for (let q = 1; q < n; q++) { let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); while (s <= zz[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); } k++; v[k] = q; zz[k] = s; zz[k + 1] = Infinity; }
    k = 0; for (let q = 0; q < n; q++) { while (zz[k + 1] < q) k++; o[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; } };
  for (let i = 0; i < NX; i++) { for (let j = 0; j < NZ; j++) f[j] = IN[j * NX + i] ? 1e8 : 0; edt(NZ); for (let j = 0; j < NZ; j++) D2[j * NX + i] = o[j]; }
  for (let j = 0; j < NZ; j++) { for (let i = 0; i < NX; i++) f[i] = D2[j * NX + i]; edt(NX); for (let i = 0; i < NX; i++) D2[j * NX + i] = o[i]; }
  const RM = rng(1871), cand = [];
  for (let n = 0; n < N; n++) { if (!IN[n]) continue; const dIn = Math.sqrt(D2[n]) * gs; if (dIn >= MARK_MIN) cand.push([X0 + (n % NX + 0.5) * gs, Z0 + (Math.floor(n / NX) + 0.5) * gs, Math.abs(dIn - MARK_IN) + RM() * 0.02]); }
  cand.sort((a, b) => a[2] - b[2]);
  const out = [], cell = new Map(), key = (i, j) => i * 4096 + j;
  for (const [x, z] of cand) { const ci = Math.floor(x / MARK_GAP), cj = Math.floor(z / MARK_GAP); let ok = true;
    for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1 && ok; b++) for (const q of cell.get(key(ci + a, cj + b)) || []) if (Math.hypot(q[0] - x, q[1] - z) < MARK_GAP) { ok = false; break; }
    if (!ok) continue; const c = cell.get(key(ci, cj)) || []; c.push([x, z]); cell.set(key(ci, cj), c); out.push([x - FLAME.x, z - FLAME.z]); }      // where he stands so his flame is there
  return out; })();
const markNear = (() => { const cell = new Map(), key = (x, z) => Math.floor(x) * 4096 + Math.floor(z);
  for (const m of MARK) { const k = key(m[0], m[1]); cell.set(k, [...(cell.get(k) || []), m]); }
  return (x, z) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const m of cell.get(key(x + a, z + b)) || []) if (Math.hypot(m[0] - x, m[1] - z) < MARK_CLEAR) return true; return false; }; })();
const pos = [];
for (let z = AREA.z0; z <= AREA.z1; z += AREA.dz) for (let x = -AREA.x; x <= AREA.x; x += AREA.dx) {
  const px = x + (R() - 0.5) * 0.3, pz = z + (R() - 0.5) * 0.3;
  if (Math.hypot(px, pz) < 0.55) continue;                                                  // his place
  const wedge = pz > 0.3 && Math.abs(px) < 0.75 + (pz - 0.3) * 0.62;                         // the lens's way in: empty until the camera is overhead
  pos.push({ x: px, z: pz, wedge, gone: embMask(px, pz) > 0.5 || markNear(px, pz) });         // the mark's men stand in these places
}
const folk = new People(scene, { max: pos.filter(p => !p.gone).length + MARK.length + 8, viewH: H, budget: [36, 260], lodPx: [240, 80] });
const CROWD = [];
pos.forEach((p, k) => { const desc = workerDesc(ANSUR, R, { c7: true, trade: TRADES[k % 4] }), ph = R() * 10, fistDelay = R() * 0.5;   // drawn for every place, so the men round the mark are the men they were
  if (!p.gone) CROWD.push({ x: p.x, z: p.z, wedge: p.wedge, id: folk.add({ ...desc, hat: true }), ph, d: Math.hypot(p.x, p.z), fistDelay }); });
{ const RM = rng(1872); MARK.forEach(([x, z], j) => { const desc = workerDesc(ANSUR, RM, { c7: true, trade: TRADES[j % 4] });
  CROWD.push({ x, z, wedge: false, inMark: true, id: folk.add({ ...desc, hat: true }), ph: RM() * 10, d: Math.hypot(x, z), fistDelay: RM() * 0.5 }); }); }
// when the powers' light falls on a man: the first moment his head is inside the bright part of a sweep's cone (0.062 of its 0.085 rad)
function sweepTime(sw, p, hy = 1.75) {
  const src = sw[2], c = Math.cos(0.062), hx = p.x - src.x, hh = hy - src.y, hz = p.z - src.z, hl = Math.hypot(hx, hh, hz);
  for (let t = sw[0]; t <= sw[1]; t += 1 / 60) { const f = beamFoot(sw, t), ax = f.x - src.x, ay = f.y - src.y, az = f.z - src.z;
    if ((hx * ax + hh * ay + hz * az) / (hl * Math.hypot(ax, ay, az)) > c) return t + 0.05; }
  return Infinity;
}
// where each man looks while the powers' light is on the crowd: away into the dark, to one side (his own rng, so R's draws are unchanged); on the
// answer every face turns to the lens and the idle glances settle (a st.pose hook scales people.js's wandering head yaw by st.idleK)
{ const RA = rng(1917); for (const p of CROWD) p.avert = (RA() < 0.5 ? -1 : 1) * (RA() < 0.8 ? 0.4 + 0.35 * RA() : 0.12 + 0.1 * RA()); }
const settle = (out, st, api) => { const k = api.B.head * 3 + 1; out[k] = (out[k] - st.look) * st.idleK + st.look; };
// the flames the mark's men hold up from the turn: kindled from the man nearest him outward through the mark as the eyes outside it close
{ const RK = rng(1873), M = CROWD.filter(p => p.inMark), d0 = Math.min(...M.map(p => p.d)), d1 = Math.max(...M.map(p => p.d));
  for (const p of CROWD) p.kindle = p.inMark ? TL.rise + 0.4 + 1.1 * (p.d - d0) / Math.max(1e-6, d1 - d0) + RK() * 0.15 : Infinity; }

// ------------------------------------------------------------------ him: hero.js, bearded, a cap, a dark coat; his eyes light his face
const heroData = await loadHeroData();
const him = new Hero(heroData, { variant: 'forge', height: 1.8, kind: 'coat', shirt: '#1b1c1f', shirt2: '#111214', trousers: '#16171a', hat: 'cap', hatColor: '#1c1c1e',
  beard: 0.95, stubble: 1, hairLen: 1, age: 0.45, skin: '#a77b62', seed: 1848, softBrows: true });      // softBrows: hero.js's opt-in brows for the close-up (no card edges, no seam)
scene.add(him.group); for (const m of him.meshes || []) m.castShadow = m.receiveShadow = true;
// v2: his cap less glossy (this hero's own cap material, not hero.js's default): the moon off the brim's top at a grazing angle drew a grey
// band (p50 53-78/255) over a black forehead, the band the review flagged
him.hatGroup.traverse(o => { if (o.isMesh) { o.material.specularIntensity = 0.3; o.material.sheen = 0.2; } });
const ARM_R = [], HAND_R = []; him.bone('upperarm01.R').traverse(b => { if (b.isBone) ARM_R.push(b); }); him.bone('wrist.R').traverse(b => { if (b.isBone) HAND_R.push(b); });
const HANG_U = V3(-0.12, -1, 0.04).normalize(), HANG_F = V3(-0.05, -1, 0.12).normalize(), CURL_F = V3(0.3, 1, 0.3).normalize();      // the curl brings the fist up across his chest
function poseHim(t) {
  him.resetPose();
  const w = clamp((t - TL.manifesto + 0.8) / 0.8), fist = sstep(0, 1, w);      // his fist lands on the hit (0.8 s), the crowd's answer after it
  him._aimWorld('upperarm01.R', him.joint('lowerarm01.R').sub(him.joint('upperarm01.R')), HANG_U);
  him._aimWorld('lowerarm01.R', him.joint('wrist.R').sub(him.joint('lowerarm01.R')), HANG_F);
  him._aimWorld('upperarm01.L', him.joint('lowerarm01.L').sub(him.joint('upperarm01.L')), V3(0.12, -1, 0.04).normalize());
  him._aimWorld('lowerarm01.L', him.joint('wrist.L').sub(him.joint('lowerarm01.L')), V3(0.05, -1, 0.12).normalize());
  him.update();
  if (fist > 0) {           // the raise follows the eased weight: the forearm curls up in front of him, then the arm presses up into the PUMP
    const base = ARM_R.map(b => b.quaternion.clone());
    him.relaxHand('R', 0.8, { cascade: true }); const open = HAND_R.map(b => b.quaternion.clone());
    ARM_R.forEach((b, i) => b.quaternion.copy(base[i])); him.update();
    const g = him.gesture('R', 'PUMP', { p: 0.6 });
    // the bones' own rotations are blended (hanging -> curled by a, -> the PUMP by c), so at the hit the arm is exactly the gesture's pose:
    // aiming the bones by shortest arc instead left the arm's roll 95-100 deg off it, and the fist spun on the hit frame
    if (fist < 1 && g) { const shut = HAND_R.map(b => b.quaternion.clone()), pumpQ = ARM_R.map(b => b.quaternion.clone()), a = sstep(0, 0.55, w), c = sstep(0.3, 1, w);
      ARM_R.forEach((b, i) => b.quaternion.copy(base[i])); him.update();
      him._aimWorld('upperarm01.R', him.joint('lowerarm01.R').sub(him.joint('upperarm01.R')), HANG_U);
      him._aimWorld('lowerarm01.R', him.joint('wrist.R').sub(him.joint('lowerarm01.R')), CURL_F);
      const curlQ = ARM_R.map(b => b.quaternion.clone());
      ARM_R.forEach((b, i) => b.quaternion.copy(base[i]).slerp(curlQ[i], a).slerp(pumpQ[i], c));
      HAND_R.forEach((b, i) => b.quaternion.copy(open[i]).slerp(shut[i], sstep(0.2, 0.9, w))); }
  } else him.relaxHand('R', 0.8, { cascade: true });
  him.relaxHand('L', 0.8, { cascade: true });
  him.update();
}
// the eyes light his own face. v2: only the brow ridge, the nose and the sockets catch it (the close-up read as a CG mask lit from cap to
// beard): the lamp stands in front of his brows and its reach ends at 8.5 cm, so the cheeks, lips, beard and the cap's bill stay in the dark
// (after the grade, measured in node at 0.8 s: brow p50 66, nose 78; cheeks, lips, jaw, bill p50 0; against cheeks 116, lips 87, forehead 54)
const eyeLamp = new THREE.PointLight('#f4f8ff', 0, 0.085, 2); scene.add(eyeLamp);
const eyes = new Eyes(scene, { max: CROWD.length + 4, size: 0.016, minPx: 2.6, halo: 9 });
// the candles the mark's men hold up: a hot point and its glow, both sized in metres, so from above the glow (0.2 m) of one man's flame
// meets the next one's (MARK_GAP) and the strokes join, while the cuts between the parts (no one stands in them) stay dark. Additive, over
// everything, like the eyes from overhead.
// v2: the glow's gain while the first candles light, dense round him: at full gain they merged into a blown star over the hammer (28.4-28.6 s:
// a merged glow >= 100/255 between the flames on 25-37 % of the lit pixels, measured in node against the share; 4-5 % at half gain). Full
// again from 29.2 s, where the strokes must join and where the emblem's measure was taken.
const FLAME_G0 = 0.5, FLAME_G1 = [28.7, 29.2];
const FLAME_VS = `attribute float aK; uniform float uScale, uCore, uGlow; varying float vK, vC, vG;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float k = uScale / max(0.05, -mv.z);
  vK = aK; vC = max(0.8, uCore * k); vG = max(1.5, uGlow * k); gl_PointSize = 6.0 * vG; gl_Position = projectionMatrix * mv; }`;
const FLAME_FS = `uniform vec3 uCol; uniform float uGain; varying float vK, vC, vG;
void main(){ float r = length(gl_PointCoord * 2.0 - 1.0) * 3.0 * vG;                       // px from the flame
  float c = vK * (1.6 * exp(-0.5 * r * r / (vC * vC)) + 0.9 * uGain * exp(-0.5 * r * r / (vG * vG)));
  if (c < 0.003) discard; gl_FragColor = vec4(uCol * c, 1.0); }`;
const flames = (() => { const max = CROWD.filter(p => p.inMark).length + 1, g = new THREE.BufferGeometry(), P = new Float32Array(max * 3), K = new Float32Array(max);
  g.setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aK', new THREE.BufferAttribute(K, 1).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.ShaderMaterial({ vertexShader: FLAME_VS, fragmentShader: FLAME_FS, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uScale: { value: 1000 }, uCore: { value: 0.04 }, uGlow: { value: 0.2 }, uGain: { value: 1 }, uCol: { value: new THREE.Color('#ffe0b0') } } });
  const points = new THREE.Points(g, material); points.frustumCulled = false; points.renderOrder = 11; points.visible = false; scene.add(points);
  return { P, K, n: 0, max, g, material, points, warm: new THREE.Color('#ffe0b0'), at: V3() }; })();
// the people audit (render.mjs -> gate.py's CROTCH check) for this crowd only. folk.hazards flags a hand that lands on screen in front of another
// man's crotch; in this dense crowd that is nearly every front-row hand (300-900 pairs a frame). Nothing here lights a man's front below the
// waist: the moon is behind the crowd, the powers' lamps stand behind and above their pools, the fill is 0.03, the fog closes at 34 m and the
// grade crushes all under 0.115, so it renders black on black. Measured in node (CPU mirror, 0-30 s, 21 frames): 7254 pairs, none with a
// crotch above 3/255 after light, fog and grade, and 7251 of them hidden behind a nearer body anyway. So a pair counts here only where the
// frame's own lights, fog and grade would show the victim's crotch (>= 2/255): a front light added later brings the check straight back.
// v2: the stronger moon and his back light are behind them, and the fist key's reach ends 0.35 m past his fist; shown pairs stay 0 (4-27 s).
const _hz = { p: V3(), n: V3(), l: V3(), c: new THREE.Color() }, lumOf = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
function crotchShows(id, cam) {                // the crotch's grey after three's light (r170 units), ACES at the exposure, sRGB, fog, the grade
  const at = folk.att[id]; if (!at || !at.hips) return 1;
  const P = _hz.p.set(0, -0.1, 0.07).applyMatrix4(at.hips), N = _hz.n.copy(cam.position).sub(P).normalize();
  let E = lumOf(_hz.c.copy(hemi.groundColor).lerp(hemi.color, 0.5 * N.y + 0.5)) * hemi.intensity;
  E += lumOf(moon.color) * moon.intensity * Math.max(0, N.dot(_hz.l.copy(moon.position).sub(moon.target.position).normalize()));
  for (const L of [...LIGHTS.map(q => q.s), eyeLamp, himRim, fistKey]) { if (!(L.intensity > 0)) continue;
    const l = _hz.l.copy(L.position).sub(P), d = l.length(); l.divideScalar(d); const nl = Math.max(0, N.dot(l)); if (!nl) continue;
    let k = 1; if (L.isSpotLight) { const a = L.target.position.clone().sub(L.position).normalize(), cc = Math.cos(L.angle), pc = Math.cos(L.angle * (1 - L.penumbra)); k = sstep(cc, pc, -l.dot(a)); }
    E += lumOf(L.color) * L.intensity * k * nl / Math.max(Math.pow(d, L.decay), 0.01) * (L.distance > 0 ? Math.pow(clamp(1 - Math.pow(d / L.distance, 4)), 2) : 1); }
  const x = E * lumOf(_hz.c.set(folk.get(id).d.bottom)) / Math.PI * renderer.toneMappingExposure / 0.6;
  const tm = clamp((x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.4329510) + 0.238081)), enc = tm <= 0.0031308 ? 12.92 * tm : 1.055 * Math.pow(tm, 1 / 2.4) - 0.055;
  const depth = -_hz.l.copy(P).applyMatrix4(cam.matrixWorldInverse).z, fogK = sstep(scene.fog.near, scene.fog.far, depth);
  return clamp(((enc * (1 - fogK) - 0.5) * 1.3 + 0.5) * 1.04);
}
folk.hazards = (cam, w, h, frac, minPx) => People.prototype.hazards.call(folk, cam, w, h, frac, minPx).filter(z => crotchShows(z.b, cam) >= 2 / 255);

// ------------------------------------------------------------------ the shots
const PAY = { dur: 2.2, p: V3(0.5, 2.9, 4.4), l: V3(-0.1, 1.55, -6), fov: 44, drift: 0.25 };      // the pull-back on the manifesto (24.0-27.5 s)
function camAt(t) {
  if (t < TL.alliance) {            // his eyes, close; by the ripple the lens has risen and drawn back so the crowd shows round his head; then out
    // v2: the close-up holds about 0.6 s at that size (it read as a mask over 1.1 s): the lens starts back at 0.6 s and is there by 2.3 s, as before by the ripple
    const a = E(clamp((t - 0.6) / 1.7)), b = E(clamp((t - 3.0) / (TL.alliance - 3.0)));
    return { p: V3(0, 1.69 + 0.31 * a - 0.05 * b, 0.62 + 0.68 * a + 1.9 * b), l: V3(0, 1.67 + 0.14 * a - 0.21 * b, 0.15 * a - 4.15 * b), fov: 34 + 6 * a }; }
  if (t < TL.high) { const u = E(clamp((t - TL.alliance) / (TL.high - TL.alliance))); return { p: V3(lerp(0.3, -0.6, u), lerp(3.4, 3.1, u), lerp(5.2, 4.6, u)), l: V3(0, 2.5, -6), fov: 42 }; }   // high enough that the rows behind show their eyes; level enough to leave sky under the type for the beams; aimed low enough to keep his head and shoulders in frame
  if (t < TL.manifesto) { const u = E(clamp((t - TL.high) / (TL.manifesto - TL.high))); return { p: V3(lerp(0.0, 0.25, u), lerp(1.85, 1.75, u), lerp(1.9, 1.35, u)), l: V3(lerp(0, -0.38, u), lerp(1.66, 1.86, u), -1), fov: 40 }; }   // the dolly keeps him and, on the hit, his raised fist in frame under the type
  // v2: from the fist on the hit the lens rises and draws back over him (2.5 m and up, not down to 1.05 m, where the near heads hid all the
  // rest): his lit fist and his outline below, the rows behind him to the band, their eyes and their raised fists in the moonlight
  if (t < TL.rise) { const u = E(clamp((t - TL.manifesto) / PAY.dur)), v = clamp((t - TL.manifesto - PAY.dur) / (TL.rise - TL.manifesto - PAY.dur));
    return { p: V3(lerp(0.25, PAY.p.x, u), lerp(1.75, PAY.p.y, u), lerp(1.35, PAY.p.z, u) + PAY.drift * v), l: V3(lerp(-0.38, PAY.l.x, u), lerp(1.86, PAY.l.y, u), lerp(-1, PAY.l.z, u)), fov: lerp(40, PAY.fov, u) }; }
  const u = EO(clamp((t - TL.rise) / (TL.mark - TL.rise))); return { p: V3(EMB.ox, lerp(16, EMB.top, u), EMB.oz + 0.01), l: V3(EMB.ox, 0, EMB.oz), fov: 44, top: true };
}

// when each man's eyes open. The ripple: the men you can see round him in the close shot (eyes in frame, below the type, not behind a nearer
// head or his own; spheres for heads and shoulders) and the ring round his feet (d < 7) open outward on screen from round his head, a ring
// growing from 400 px (his head and shoulders hide all nearer) at 320 px/s from TL.ripple, so the visible ones open from about 2.6 s to 3.9 s. Then wherever the powers' light has passed; the rest on the answer.
{ const cam = new THREE.PerspectiveCamera(40, W / H, 0.05, 400), v = new THREE.Vector3(), q = new THREE.Vector3(), EYE = V3(0, 1.694, 0.149);   // EYE: his eyes (Eyes.ofHero at rest)
  const setCam = t => { const C = camAt(t); cam.position.copy(C.p); cam.fov = C.fov; cam.updateProjectionMatrix(); cam.lookAt(C.l); cam.updateMatrixWorld(); return cam; };
  const eyeOf = p => (p._eyeY ??= folk.get(p.id).d.h * 0.93);
  const HIS = [[0, 1.72, 0.04, 0.125], [0, 1.45, 0, 0.24], [0, 1.15, 0, 0.25]];
  for (let t = 2.5; t < 4.3; t += 0.25) { setCam(t); const c = cam.position, cand = [];
    for (const p of CROWD) { if (p.wedge) continue; v.set(p.x, eyeOf(p), p.z).project(cam); if (v.z > 1 || Math.abs(v.x) > 1.25 || Math.abs(v.y) > 1.25) continue;
      cand.push({ p, sx: v.x, sy: v.y, dist: Math.hypot(p.x - c.x, eyeOf(p) - c.y, p.z - c.z) }); }
    for (const a of cand) { if (a.p.seenClose || Math.abs(a.sx) > 1 || Math.abs(a.sy) > 1 || (-a.sy * 0.5 + 0.5) * H < 512) continue;
      const dir = v.set(a.p.x - c.x, eyeOf(a.p) - c.y, a.p.z - c.z).normalize(), L = a.dist - 0.12;
      const hit = (x, y, z, r) => { q.set(x - c.x, y - c.y, z - c.z); const s = q.dot(dir); return s > 0 && s < L && q.lengthSq() - s * s < r * r; };
      let hidden = HIS.some(([x, y, z, r]) => hit(x, y, z, r));
      for (const b of cand) { if (hidden) break; if (b === a || b.dist >= a.dist || Math.abs(b.sx - a.sx) > 0.25) continue; const e = eyeOf(b.p);
        hidden = hit(b.p.x, e + 0.03, b.p.z, 0.11) || hit(b.p.x, e * 0.86, b.p.z, 0.18); }
      if (!hidden) a.p.seenClose = true; } }
  const ring = [];
  for (let t = TL.ripple; t <= TL.s2 + 1.0; t += 1 / 30) { setCam(t); v.copy(EYE).project(cam); ring.push([t, (v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H, 400 + (t - TL.ripple) * 320, cam.matrixWorldInverse.clone(), cam.projectionMatrix.clone()]); }
  for (const p of CROWD) {
    p.open = Infinity;
    if (p.d < 7 || p.seenClose) {
      for (const [t, ex, ey, Rr, Vm, Pm] of ring) { v.set(p.x, eyeOf(p), p.z).applyMatrix4(Vm).applyMatrix4(Pm); if (v.z > 1) continue;
        if (Math.hypot((v.x * 0.5 + 0.5) * W - ex, (-v.y * 0.5 + 0.5) * H - ey) <= Rr) { p.open = t + R() * 0.12; break; } }
      if (!isFinite(p.open)) p.open = TL.s2 + 1.0 + R() * 0.25; }
    for (const sw of SWEEPS) p.open = Math.min(p.open, sweepTime(sw, p, eyeOf(p) + 0.08));
    if (!isFinite(p.open)) p.open = TL.high + R();
  } }

// ------------------------------------------------------------------ the words: the Manifesto, verbatim, in the house type (bands.js)
const CUES = [
  [TL.s1, TL.s2, ['A SPECTRE IS', 'HAUNTING EUROPE —'], 300, 132, 'main'],
  [TL.s2, TL.alliance, ['THE SPECTRE', 'OF COMMUNISM.'], 300, 150, 'red'],
  [TL.alliance, TL.exorcise, ['ALL THE POWERS', 'OF OLD EUROPE HAVE', 'ENTERED INTO A', 'HOLY ALLIANCE'], 290, 104, 'main'],
  [TL.exorcise, TL.pope, ['TO EXORCISE', 'THIS SPECTRE:'], 300, 136, 'main'],
  [TL.pope, TL.mett, ['POPE AND TSAR,'], 300, 130, 'hot'],
  [TL.mett, TL.french, ['METTERNICH', 'AND GUIZOT,'], 300, 130, 'hot'],
  [TL.french, TL.high, ['FRENCH RADICALS', 'AND GERMAN', 'POLICE-SPIES.'], 300, 120, 'hot'],
  [TL.high, TL.tale, ['IT IS HIGH TIME', 'THAT COMMUNISTS', 'SHOULD OPENLY …'], 290, 112, 'main'],
  [TL.tale, TL.manifesto, ['MEET THIS', 'NURSERY TALE OF', 'THE SPECTRE', 'OF COMMUNISM'], 290, 108, 'main'],
  [TL.manifesto, TL.rise, ['WITH A MANIFESTO', 'OF THE PARTY ITSELF.'], 300, 116, 'red'],
  [TL.rise + 0.6, TL.mark - 0.1, ['MARX AND ENGELS · MANIFESTO OF THE COMMUNIST PARTY · 1848'], 1720, 32, 'sub'],
];

// ------------------------------------------------------------------ the frame
const FR = new THREE.Frustum(), _PV = new THREE.Matrix4(), _SPH = new THREE.Sphere(new THREE.Vector3(), 3);   // a 3 m margin: shadows thrown into the frame
// the body itself, in frame or only a shadow: three narrow spheres up his axis (feet to the raised fist at 2.06 m), not one wide one, so a
// man a metre outside the frame does not count as in it and take a LOD0 slot from a face that is
const _BOD = new THREE.Sphere(new THREE.Vector3(), 0.45), _BODY = [0.45, 1.15, 1.75];
const RED = new THREE.Color('#ff2a2a'), WHITE = new THREE.Color('#ffffff'), _c = new THREE.Color();
const closerCv = document.createElement('canvas'); closerCv.width = W; closerCv.height = H; const closerG = closerCv.getContext('2d');
window.renderFrame = async (t) => {
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  const ts = Math.min(t, TL.mark - 1e-3), C = camAt(ts), top = !!C.top;
  camera.position.copy(C.p); camera.up.set(0, top ? 0 : 1, top ? -1 : 0); camera.fov = C.fov; camera.updateProjectionMatrix(); camera.lookAt(C.l);
  camera.updateMatrixWorld(); FR.setFromProjectionMatrix(_PV.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  // the crowd
  for (const p of CROWD) {
    _SPH.center.set(p.x, 1, p.z); p.cull = !FR.intersectsSphere(_SPH);
    const vis = (!p.wedge || top) && !p.cull;
    if (!vis) { folk.set(p.id, { visible: false }); continue; }
    const turn = sstep(TL.high, TL.high + 2.5, ts - p.d * 0.05), lens = clamp(Math.atan2(C.p.x - p.x, C.p.z - p.z), -0.7, 0.7), look = lerp(p.avert * sstep(TL.alliance, TL.alliance + 2, ts), lens, turn);
    p.gaze = clamp(1 - Math.abs(look - lens) / 0.8);
    const fist = sstep(TL.manifesto + p.fistDelay + p.d * 0.03, TL.manifesto + p.fistDelay + p.d * 0.03 + 0.35, ts);
    const inFrame = _BODY.some(y => FR.intersectsSphere(_BOD.set(_BOD.center.set(p.x, y, p.z), 0.45)));
    // the settle hook stays on through the fists (dropping it let the full idle head yaw back in one frame: a 9-18 deg jerk as each fist
    // started), so the PUMP arm is passed explicitly: people.js poses it by itself only for a man without a hook. Its pump is people.js's own.
    const pump = top && p.inMark ? 1 : Math.pow(Math.max(0, Math.sin((ts + p.ph) * 5 + ((folk.people[p.id].d.seed * 0.618) % 1) * 6)), 2);
    folk.set(p.id, { visible: true, shadowOnly: !inFrame, x: p.x, y: 0, z: p.z, heading: 0, look, idleK: 1 - 0.85 * turn, pose: settle, act: fist > 0 ? 'fist' : 'stand', t: ts + p.ph, mix: fist > 0 && fist < 1 ? { stand: 1 - fist, fist } : null,
      pump: top && p.inMark ? 1 : null, gesture: fist > 0 ? { name: 'PUMP', side: -1, w: fist, p: pump } : null });   // from above the mark's men hold theirs up still (their candles)
  }
  folk.update(camera);
  poseHim(ts);
  // the powers' light
  LIGHTS.forEach(L => L.aim(V3(0, 20, -40), V3(0, 0, -30), 0));
  let li = 0;
  for (const sw of SWEEPS) { if (ts < sw[0] - 0.3 || ts > sw[1] + 0.4 || ts >= TL.high || li >= LIGHTS.length) continue;     // the powers' light goes out on the cut to him
    const I = sstep(sw[0] - 0.3, sw[0] + 0.1, ts) * (1 - sstep(sw[1], sw[1] + 0.4, ts)); LIGHTS[li++].aim(sw[2], beamFoot(sw, ts), I, C.p); }
  // the eyes
  eyes.begin();
  const redK = sstep(TL.red, TL.red + 0.8, ts);
  for (const p of CROWD) {
    if ((p.wedge && !top) || p.cull) continue;
    let o = sstep(p.open, p.open + 0.22, ts);
    if (top) o *= p.inMark ? 1.25 * (1 - sstep(p.kindle, p.kindle + 0.5, ts)) : 1 - sstep(TL.rise + 0.5, TL.red, ts);   // from above a man's candle, once lit, outshines his eyes
    else if (ts >= TL.high) o *= 0.45 + 0.55 * p.gaze;                       // on the answer an averted face shows less of its eyes: they burn as he turns to you
    if (o <= 0.001) continue;
    const ep = Eyes.ofPeople(folk, p.id); if (!ep) continue;
    _c.copy(WHITE).lerp(RED, p.inMark ? redK : 0); eyes.pair(ep[0], ep[1], o * (0.85 + 0.15 * Math.sin(ts * 7 + p.ph * 3)), _c);
  }
  const he = Eyes.ofHero(him), ho = sstep(TL.open, TL.open + 0.35, ts) * (top ? 1 - sstep(TL.rise + 0.5, TL.red, ts) : 1);   // overhead he is outside the emblem: his eyes close with the rest
  eyes.pair(he[0], he[1], ho * 1.2, WHITE);
  eyeLamp.position.copy(he[0]).lerp(he[1], 0.5).add(V3(0, 0.015, 0.055)); eyeLamp.intensity = ho * (top ? 0 : 0.03);
  eyes.material.uniforms.uHalo.value = lerp(6, 9, sstep(1.8, TL.ripple, ts));             // v2: in the close-up his eyes' halo is held in (it washed his cheeks): the whole glow, before the crowd's open
  // v2: his fist on the manifesto, lit where it lands: the key rides his grip from just before the hit
  { const fk = top ? 0 : sstep(TL.manifesto - 0.3, TL.manifesto + 0.05, ts);
    if (fk > 0) { const g = him.joint('wrist.R').lerp(him.joint('finger3-1.R'), 0.6); fistKey.position.copy(g).add(FIST_KEY); fistKey.target.position.copy(g); fistKey.target.updateMatrixWorld(); }
    fistKey.intensity = FIST_I * fk; }
  himRim.intensity = top ? 0 : (ts < TL.alliance ? HIM_RIM.open : ts >= TL.high ? HIM_RIM.close : HIM_RIM.wide) * sstep(TL.ripple, TL.s2 + 1, ts);
  eyes.material.depthTest = !top;                                                            // from overhead the caps would hide them
  // the candles, in the raised fists (people.js grip, after folk.update), a candle's length above the fist
  flames.n = 0;
  if (top) for (const p of CROWD) { if (!p.inMark || p.cull) continue; const k = sstep(p.kindle, p.kindle + 0.3, ts); if (k <= 0.001) continue;
    const f = folk.gripPos(p.id, -1, flames.at), i = flames.n++; flames.P[i * 3] = f.x; flames.P[i * 3 + 1] = f.y + 0.1; flames.P[i * 3 + 2] = f.z;
    flames.K[i] = k * (0.94 + 0.06 * Math.sin(ts * 9 + p.ph * 4)); }
  flames.g.setDrawRange(0, flames.n); flames.g.attributes.position.needsUpdate = flames.g.attributes.aK.needsUpdate = true; flames.points.visible = flames.n > 0;
  flames.material.uniforms.uScale.value = H / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)); flames.material.uniforms.uCol.value.copy(flames.warm).lerp(RED, redK);
  flames.material.uniforms.uGain.value = lerp(FLAME_G0, 1, sstep(FLAME_G1[0], FLAME_G1[1], ts));     // v2: the first candles, dense round him, without the blown blob
  eyes.end(camera, H);
  eyes.gain = top ? 1.15 : 1;
  // the moon: as before from above (the emblem's look is measured on it); v2: a rim on the crowd through the piece, rising on the manifesto
  moon.intensity = (top ? 0.5 : ts < TL.alliance ? MOON.open : ts < TL.high ? MOON.wide : MOON.close + (MOON.payoff - MOON.close) * sstep(TL.manifesto, TL.manifesto + 0.9, ts)) * sstep(TL.ripple, TL.s2 + 1, ts) + 0.06;
  renderer.render(scene, camera); { const gl = renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  // the grade: black and white, hard, until the emblem burns red
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.filter = `grayscale(${(1 - redK).toFixed(3)}) contrast(1.3) brightness(1.04)`; ctx.drawImage(glc, 0, 0, W, H); ctx.filter = 'none';
  if (t >= TL.mark) {
    const age = t - TL.mark; ctx.fillStyle = `rgba(2,1,1,${clamp(0.85 + age * 3, 0, 0.97)})`; ctx.fillRect(0, 0, W, H);
    closerG.clearRect(0, 0, W, H); closer(closerG, age); ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.drawImage(closerCv, 0, 0); ctx.restore();
    return {};
  }
  cueType(ctx, t, CUES);
  finish.apply(ctx, Math.round(t * 30), { grain: 0.07, vignette: 0.42 });
  return {};
};
ready = true;
