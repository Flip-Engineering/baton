// COMMON WEALTH — the heartland goes red, town by town, hall by hall, until the whole plain is lit as one.
// Communism means common wealth. See you at the hall.
import * as THREE from 'three';
import { W, H, C, loadFonts, loadBeats, loadImage, clamp, lerp, ease, rng,
  Finish, sigil, signoff, closer, outCanvas, seq, cue } from '../lib/kit.js';

const ctx = outCanvas();
await loadFonts();
const B = await loadBeats('commonwealth2');
const logo = await loadImage('../assets/acp_logo_dark.png');
const GOOD = await (await fetch('../assets/riders_good.json')).json();
const riders = new Map();
async function rider(k) { const i = GOOD[((k % GOOD.length) + GOOD.length) % GOOD.length]; if (!riders.has(i)) riders.set(i, await loadImage(`../assets/riders/${String(i + 1).padStart(4, '0')}.jpg`)); return riders.get(i); }
const finish = new Finish(1862);
const RED = C.red2, CREAM = C.cream;

const CUES = [
  ...seq(0, [[2, 'THE HEARTLAND'], [2, 'GOES RED.', 1], [2, 'TOWN BY TOWN.'], [2, 'HALL BY HALL.', 1],
    [2, 'SMALL FARMERS.'], [2, 'IOWA.'], [2, 'RAIL STRIKERS.'], [2, 'OMAHA.'], [2, 'STEELWORKERS.'], [2, 'OHIO.'],
    [2, 'WE ALL UNITE.', 1], [2, 'SOMETHING NEW'], [2, 'HAPPENS.', 1], [2, 'A HALL'], [2, 'LIGHTS UP.', 1], [2, 'IT CALLS']]),
  ...seq(32, [[2, 'THE NEXT TOWN.', 1], [1, 'THE NEXT.'], [1, 'THE NEXT.'], [1, 'ROBOTICS.'], [1, 'SOFTWARE.', 1],
    [2, 'THE WHOLE PLAIN'], [2, 'LIT AS ONE.', 1], [1, 'COMMON'], [1, 'WEALTH.', 1], [1, 'COMMON'], [1, 'WEALTH.', 1]]),
  ...seq(48, [[2, 'COMMUNISM', 1], [2, 'MEANS'], [1, 'COMMON'], [3, 'WEALTH.', 1], [1, 'COMMON'], [1, 'PROSPERITY.', 1],
    [1, 'THE HEARTLAND'], [1, 'GOES RED.', 1], [2, 'SEE YOU'], [2, 'AT THE HALL.', 1]]),
];

// ---------------------------------------------------------------- the plain
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, W / H, 0.1, 3000);
const R = rng(1862);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ color: '#3a220e' }));
ground.rotation.x = -Math.PI / 2; scene.add(ground);
const NW = 9000, SPAN = 160;
const wheat = new THREE.InstancedMesh(new THREE.ConeGeometry(0.04, 0.9, 4), new THREE.MeshBasicMaterial({ color: '#c8923e' }), NW);
const wx = [], wz = [], ws = [];
for (let i = 0; i < NW; i++) { wx.push((R() - 0.5) * 90); wz.push(R() * SPAN); ws.push(0.6 + R() * 0.5); }
scene.add(wheat);
const sil = new THREE.MeshBasicMaterial({ color: '#0a0303' });
const elevators = new THREE.Group();
for (let i = 0; i < 6; i++) { const e = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 34 + R() * 12, 16), sil); e.position.set(-60 + i * 9, 17, -420); elevators.add(e); }
const head = new THREE.Mesh(new THREE.BoxGeometry(14, 58, 10), sil); head.position.set(-5, 29, -418); elevators.add(head);
for (let i = 0; i < 5; i++) { const st = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2, 50, 10), sil); st.position.set(90 + i * 14, 25, -520); elevators.add(st); }
for (let i = 0; i < 5; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(10, 8, 1), new THREE.MeshBasicMaterial({ color: '#ff8a2a', fog: false })); f.position.set(90 + i * 14, 4, -512); elevators.add(f); }
const glowC = document.createElement('canvas'); glowC.width = glowC.height = 128; { const gg = glowC.getContext('2d'), gr = gg.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,160,60,0.9)'); gr.addColorStop(1, 'rgba(255,100,20,0)'); gg.fillStyle = gr; gg.fillRect(0, 0, 128, 128); }
const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowC), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
glow.scale.set(90, 60, 1); glow.position.set(118, 20, -500); elevators.add(glow);
scene.add(elevators);
for (const x of [-6.8, -5.8]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 3000), new THREE.MeshBasicMaterial({ color: '#8a6a4a' })); r.position.set(x, 0.1, -1500); scene.add(r); }
const poles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 9, 0.3), sil, 60); scene.add(poles);
const sun = new THREE.Mesh(new THREE.CircleGeometry(80, 96), new THREE.MeshBasicMaterial({ color: RED, fog: false }));
scene.add(sun);
// storm clouds: dark billboards with a canvas noise texture
const cc = document.createElement('canvas'); cc.width = cc.height = 256; const cg = cc.getContext('2d');
for (let i = 0; i < 260; i++) { const x = R() * 256, y = R() * 256, r = 10 + R() * 40; const g = cg.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(110,78,84,0.9)'); g.addColorStop(0.6, 'rgba(60,34,40,0.6)'); g.addColorStop(1, 'rgba(40,20,24,0)'); cg.fillStyle = g; cg.fillRect(x - r, y - r, r * 2, r * 2); }
const cloudTex = new THREE.CanvasTexture(cc);
const clouds = [];
for (let i = 0; i < 44; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(520, 220), new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false }));
  m.position.set((R() - 0.5) * 900, 40 + R() * 160, -260 - R() * 600); scene.add(m); clouds.push(m); }
const NL = 2600, lgeo = new THREE.BufferGeometry(), lpos = new Float32Array(NL * 3), lord = [];
for (let i = 0; i < NL; i++) { const gx = i % 52, gz = Math.floor(i / 52); const x = (gx - 26) * 34 + (R() - 0.5) * 10, z = -40 - gz * 34 + (R() - 0.5) * 10; lpos.set([x, 0.6, z], i * 3); lord.push(Math.hypot(gx - 26, gz) / 60 + R() * 0.15); }   // county seats on the survey grid, lit outward
lgeo.setAttribute('position', new THREE.BufferAttribute(lpos, 3));
const lmat = new THREE.PointsMaterial({ color: '#ffc070', size: 6, sizeAttenuation: false, transparent: true, fog: false, blending: THREE.AdditiveBlending, depthWrite: false });
const lcol = new Float32Array(NL * 3);                         // each hall at its own brightness, by its output (§11.4 G3 guard: never levelled)
for (let i = 0; i < NL; i++) { const b = 0.3 + 0.7 * R() ** 2; lcol.set([b, b, b], i * 3); }
lgeo.setAttribute('color', new THREE.BufferAttribute(lcol, 3)); lmat.vertexColors = true;
const lights = new THREE.Points(lgeo, lmat); scene.add(lights);
// the first hall: a grange silhouette in the storm; its window lights on HAPPENS. / LIGHTS UP., the next town's on IT CALLS
const hallG = new THREE.Group();
const hBody = new THREE.Mesh(new THREE.BoxGeometry(16, 8, 10), sil); hBody.position.set(6, 4, -150); hallG.add(hBody);
const hRoof = new THREE.Mesh(new THREE.ConeGeometry(11.5, 6, 4), sil); hRoof.rotation.y = Math.PI / 4; hRoof.position.set(6, 11, -150); hallG.add(hRoof);
const win1 = new THREE.Sprite(glow.material.clone()); win1.scale.set(14, 10, 1); win1.position.set(6, 4, -144); hallG.add(win1);
const win2 = new THREE.Sprite(glow.material.clone()); win2.scale.set(10, 7, 1); win2.position.set(-40, 3, -300); hallG.add(win2);
scene.add(hallG);
const bolt = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#fff4e8', fog: false }));
scene.add(bolt);
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();

function world(t, beat) {
  const storm = clamp(1 - (beat - 30) / 2);          // the storm breaks at the tempo doubling
  const night = beat >= 32 && beat < 48 ? 1 : 0, dawnU = clamp((beat - 48) / 3);
  const speed = beat < 32 ? 9 : 22;
  const travel = beat < 32 ? t * 9 : 32 * B.spb * 9 + (t - 32 * B.spb) * 22;
  const kick = Math.max(B.env('kick', t, 10), B.env('taiko', t, 7));
  for (let i = 0; i < NW; i++) {
    const z = -(((wz[i] - travel) % SPAN) + SPAN) % SPAN;
    const sway = Math.sin(t * 2.2 + wx[i] * 0.3 + z * 0.1) * 0.25 * (1 + storm);
    e3.set(sway * 0.4, 0, sway); q.setFromEuler(e3); v3.set(wx[i], 0.6 * ws[i], z); s3.set(1, ws[i], 1);
    m4.compose(v3, q, s3); wheat.setMatrixAt(i, m4);
  }
  wheat.instanceMatrix.needsUpdate = true;
  for (let i = 0; i < 60; i++) { const z = -(((i * 18 - travel) % 1080) + 1080) % 1080; m4.makeTranslation(-9, 4.5, z); poles.setMatrixAt(i, m4); }
  poles.instanceMatrix.needsUpdate = true;
  const steelShot = beat >= 16 && beat < 24;
  clouds.forEach((c, i) => { c.visible = storm > 0.01 && !steelShot; c.material.opacity = 0.9 * storm; c.position.x = ((i * 137 + t * 12) % 900) - 450; });
  const stormSky = new THREE.Color('#1c1418'), nightSky = new THREE.Color('#04050b'), dawn = new THREE.Color('#e04a2a');
  const sky = beat < 32 ? stormSky : beat < 48 ? nightSky : nightSky.clone().lerp(dawn, dawnU);
  ground.material.color.set(beat >= 32 && beat < 48 ? '#070503' : '#3a220e'); wheat.material.color.set(beat >= 32 && beat < 48 ? '#3a2a14' : '#c8923e');
  // hall by hall: order-driven ignition across the plain; the furthest hall lights on 40, LIT AS ONE.
  const lit = beat < 32 ? 0 : clamp((beat - 32) / 7.4);
  lights.visible = beat >= 32;
  hallG.visible = beat < 32;                                        // the one hall: a flicker on HAPPENS. (24), full on LIGHTS UP. (28), the next town's window on IT CALLS (30)
  win1.material.opacity = beat < 24 ? 0 : beat < 28 ? 0.35 + 0.2 * kick : 1;
  win2.material.opacity = beat < 30 ? 0 : 0.8;
  lmat.opacity = beat < 48 ? 1 : 1 - dawnU * 0.8; lmat.size = 6 + 4 * kick;
  for (let i = 0; i < NL; i++) lpos[i * 3 + 1] = lord[i] < lit ? 0.6 : -50;
  lgeo.attributes.position.needsUpdate = true;
  scene.background = sky; scene.fog = new THREE.Fog(sky, 120, 1600);
  sun.position.set(0, lerp(-60, 90, ease.outCubic(dawnU)), -1100); sun.visible = beat >= 47;
  // lightning on the war drums while the storm holds, from GOES RED. on 2
  const strike = beat >= 2 && beat < 32 ? Math.max(B.env('taiko', t, 14), B.env('kick', t, 14) * (Math.floor(beat) % 2 ? 0 : 1)) : 0;
  if (strike > 0.3) {
    const pts = []; let x = (Math.floor(B.beat(t)) * 97 % 400) - 200, y = 260;
    const rr = rng(Math.floor(B.beat(t) * 4));
    while (y > 0) { pts.push(new THREE.Vector3(x, y, -500)); x += (rr() - 0.5) * 40; y -= 20 + rr() * 20; }
    bolt.geometry.dispose(); bolt.geometry = new THREE.BufferGeometry().setFromPoints(pts); bolt.visible = true;
    scene.background = sky.clone().lerp(new THREE.Color('#fff0e0'), 0.35 * strike);
  } else bolt.visible = false;
  // shots: a different angle every 4 beats in the half-time, every 2 once the tempo doubles
  const shot = beat < 32 ? Math.floor(beat / 4) : 8 + Math.floor(beat / 2);
  const kind = [0, 1, 2, 3, 0, 2, 1, 3][shot % 8], u = beat < 32 ? (beat % 4) / 4 : (beat % 2) / 2;
  if (kind === 0) { camera.position.set(Math.sin(t * 0.4) * 1.5, 1.1 + kick * 0.2, 0); camera.lookAt(0, 4, -80); }                         // skimming the wheat
  if (kind === 1) { camera.position.set(-20 + u * 10, 16 - u * 4, 10); camera.lookAt(0, 3, -200); }                                        // crane over the fields
  if (kind === 2) { camera.position.set(80 + u * 10, 3, -410); camera.lookAt(118, 30, -520); }                                          // up at the elevators and stacks
  if (kind === 3) { camera.position.set(12, 5, 0); camera.lookAt(-30 + u * 60, 6, -120); }                                                  // panning the horizon
  if (beat >= 16 && beat < 24) { const pin = beat >= 20; camera.position.set(pin ? 104 : 80 + u * 10, 3, pin ? -470 : -410); camera.lookAt(118, pin ? 10 : 30, -520); }   // the steel; punch in on the furnace mouths at 20, WE ALL UNITE.
  if (beat >= 32 && beat < 46) { camera.position.set(Math.sin(t * 0.3) * 20, 120 + (beat - 32) * 6, 60); camera.lookAt(0, 0, -500); }             // above the plain at night: the grid lights up               // the steel
  camera.fov = 58 + kick * 3; camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  return storm;
}

function lockup(beat) {                               // one ≤1.4 s card on cream (CONST Art. III): ☭≡/acc + ACP.US, then the seam back to frame 0
  ctx.fillStyle = CREAM; ctx.fillRect(0, 0, W, H);
  const a = ease.outExpo(clamp((beat - 64) / 0.8));
  sigil(ctx, W / 2, 800, 220 * lerp(1.3, 1, a), { color: RED, alpha: a, tagline: true });
  ctx.globalAlpha = a; ctx.fillStyle = '#0b0303'; ctx.font = '96px Anton'; ctx.textAlign = 'center';
  ctx.fillText('ACP.US', W / 2, 1240); ctx.globalAlpha = 1; ctx.textAlign = 'left';
}

function horseman(x, y, sc, ph, flag) {               // procedural rider: galloping horse, rider, banner
  ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc); ctx.fillStyle = ctx.strokeStyle = '#140204';
  const bob = Math.sin(ph * 2) * 3, B0 = -60 + bob;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const legs = [[-32, 0, 1], [-24, 0.45, 0], [28, 1.6, 1], [36, 2.05, 0]];   // gallop: hind pair, fore pair
  for (const [lx, o, hind] of legs) { const q = Math.sin(ph + o * 1.2), kx = lx + q * 16, ky = B0 + 30, fx = kx + (hind ? -10 : 12) + q * 12, fy = Math.min(0, B0 + 62 - Math.max(0, q) * 10);
    ctx.lineWidth = 11; ctx.beginPath(); ctx.moveTo(lx, B0 + 4); ctx.lineTo(kx, ky); ctx.stroke();
    ctx.lineWidth = 5.5; ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke(); }
  ctx.beginPath();                                                        // barrel, chest, rump
  ctx.moveTo(-46, B0 - 6); ctx.bezierCurveTo(-40, B0 - 22, 20, B0 - 22, 38, B0 - 16);
  ctx.bezierCurveTo(56, B0 - 30, 64, B0 - 50, 70, B0 - 56);              // crest of the neck
  ctx.lineTo(76, B0 - 62); ctx.lineTo(80, B0 - 55);                        // ears, poll
  ctx.bezierCurveTo(88, B0 - 46, 96, B0 - 32, 98, B0 - 26);              // face to muzzle
  ctx.lineTo(90, B0 - 22); ctx.bezierCurveTo(80, B0 - 30, 70, B0 - 30, 58, B0 - 8);   // jaw, throat
  ctx.bezierCurveTo(52, B0 + 10, 30, B0 + 16, 0, B0 + 14);
  ctx.bezierCurveTo(-30, B0 + 16, -50, B0 + 10, -46, B0 - 6); ctx.fill();
  ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-44, B0 - 8);            // tail streaming
  ctx.bezierCurveTo(-64, B0 - 12, -74, B0 + 4, -86, B0 + 2 + Math.sin(ph) * 8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-8, B0 - 14); ctx.lineTo(-18, B0 - 50); ctx.lineTo(0, B0 - 56); ctx.lineTo(14, B0 - 16); ctx.fill();   // rider, leaning in
  ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-4, B0 - 46); ctx.lineTo(30, B0 - 34); ctx.lineTo(56, B0 - 42); ctx.stroke();      // arm to the reins
  ctx.beginPath(); ctx.arc(-4, B0 - 68, 10, 0, 7); ctx.fill();
  ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-2, B0 - 16); ctx.lineTo(8, B0 + 8); ctx.stroke();                                  // leg in the stirrup
  if (flag) { ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(-12, B0 - 30); ctx.lineTo(-30, B0 - 170); ctx.stroke();
    ctx.fillStyle = '#d4101c'; ctx.beginPath(); ctx.moveTo(-30, B0 - 170);
    for (let i = 0; i <= 8; i++) ctx.lineTo(-30 - i * 10, B0 - 170 + Math.sin(ph * 1.5 - i * 0.7) * 7 + i);
    for (let i = 8; i >= 0; i--) ctx.lineTo(-30 - i * 10, B0 - 134 + Math.sin(ph * 1.5 - i * 0.7) * 7 + i);
    ctx.fill(); }
  ctx.restore();
}
function horde(t, beat) {                            // the class crests the ridge at a gallop, synced to the taiko
  const a = clamp((beat - 44) / 3), r = rng(9);
  ctx.save(); ctx.globalAlpha = a;
  for (let i = 0; i < 14; i++) {
    const depth = 0.45 + r() * 0.85, speed = 60 + r() * 40, x0 = -200 - r() * 1100;
    const x = x0 + (beat - 44) * B.spb * speed * 3.2 * depth, ph = t * 15 * (0.9 + r() * 0.2) + i;
    const kick = B.env('kick', t, 12) * 4;
    horseman(x, 1112 - kick * depth, 1.25 * depth, ph, i % 3 === 0);
  }
  ctx.restore();
}

function walker(x, y, sc, ph) {                      // a worker on foot: head, coat, striding legs and arms
  ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc); ctx.fillStyle = ctx.strokeStyle = '#140204'; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, -150, 15, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-22, -132); ctx.lineTo(22, -132); ctx.lineTo(18, -62); ctx.lineTo(-18, -62); ctx.fill();
  ctx.lineWidth = 13; for (const s of [1, -1]) { ctx.beginPath(); ctx.moveTo(0, -64); ctx.lineTo(Math.sin(ph) * s * 20, 0); ctx.stroke(); }
  ctx.lineWidth = 9; for (const s of [1, -1]) { ctx.beginPath(); ctx.moveTo(0, -126); ctx.lineTo(-Math.sin(ph) * s * 16, -72); ctx.stroke(); }
  ctx.restore();
}
function hallAtDawn(t, beat) {                        // Haz's three walk in from three sides to one lit hall door at dawn (the riders belong to HORDE, §6.7 Cut)
  const a = clamp((beat - 48) / 2), u = ease.outCubic(clamp((beat - 48) / 14)), hx = W / 2, hy = 1700, ph = t * 9;
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#140204';
  ctx.beginPath(); ctx.moveTo(hx - 250, hy); ctx.lineTo(hx - 250, hy - 200); ctx.lineTo(hx, hy - 330); ctx.lineTo(hx + 250, hy - 200); ctx.lineTo(hx + 250, hy); ctx.fill();
  ctx.fillStyle = `rgba(255,176,80,${0.7 + 0.3 * B.env('shout', t, 10)})`; ctx.fillRect(hx - 42, hy - 140, 84, 140);
  walker(lerp(-80, hx - 150, u), hy + 40, 1.0, ph);                                   // from the fields
  walker(lerp(W + 80, hx + 150, u), hy + 40, 1.0, ph + 1.3);                          // from the rails
  walker(hx + lerp(40, 0, u), lerp(H + 260, hy + 30, u), lerp(2.2, 0.9, u), ph + 2.1); // from the mills, past the camera
  ctx.restore();
}

window.renderFrame = async (t) => {
  const beat = B.beat(t), frame = Math.round(t * 30);
  ctx.globalAlpha = 1;
  if (beat >= 64) { lockup(beat); finish.apply(ctx, frame, { grain: 0.05, vignette: 0.2 }); return; }   // nothing after the payoff but one card
  const storm = world(t, beat);
  ctx.drawImage(renderer.domElement, 0, 0);
  const strike = beat >= 2 && beat < 32 ? Math.max(B.env('taiko', t, 14), B.env('kick', t, 14) * (Math.floor(beat) % 2 ? 0 : 1)) : 0;
  if (strike > 0.3) {                                        // a forked strike, white-hot, drawn over the plain
    const r = rng(Math.floor(beat * 4) + 3); let x = W * (0.15 + r() * 0.7), y = 0;
    ctx.save(); ctx.globalAlpha = strike; ctx.strokeStyle = '#fffbe8'; ctx.shadowColor = '#ffe8c0'; ctx.shadowBlur = 50; ctx.lineCap = 'round'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(x, y); while (y < H * 0.5) { x += (r() - 0.5) * 160; y += 50 + r() * 80; ctx.lineTo(x, y); } ctx.stroke();
    ctx.fillStyle = beat < 8 ? `rgba(212,16,28,${0.35 * strike})` : `rgba(255,245,230,${0.3 * strike})`; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
  if (beat >= 48) hallAtDawn(t, beat);
  let flash = B.env('impact', t, 6) * 0.25;
  if (storm > 0.2) flash = Math.max(flash, B.env('taiko', t, 14) > 0.5 ? 0.25 : 0);
  cue(ctx, CUES, beat, B.spb, { y: 1150, size: 240 + 25 * B.env('shout', t, 14) });   // inside the y=270-1250 safe band (§10.3)
  if (beat >= 4) { ctx.globalAlpha = 0.9; ctx.drawImage(logo, W - 150, 60, 96, 96); ctx.globalAlpha = 1; }   // no logo in the first 1.5 s (§4.1)
  finish.apply(ctx, frame, { grain: 0.09, vignette: 0.85, flash });
};
window.sceneReady = true;
