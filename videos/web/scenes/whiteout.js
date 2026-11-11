// WHITEOUT (WINTER SHIFT, ep. 1; research/series/snowbelt/ep1_brief.md, the series bible research/series/snowbelt/BIBLE.md).
// A blue H road sign half-buried in a ploughed bank, a pickup's tail lights going away into blowing snow: CLOSED TONIGHT. The emergency
// rooms closing on both sides of the border; Houlton, Maine, where the nurses struck to keep three registered nurses in the ER; the
// Party's chapter, and why. CARE IS A BUILDING, AND THE PEOPLE IN IT: the weather stops cutting, a crew builds in the snow, and the piece
// holds on a new hospital lit at night with three nurses at the station, under the Party's words.
//   the weather    lib/fx/whiteout.js (this series' engine): the snow at every distance, the gusts that white the frame and carry the
//                  cuts before the turn, snow cover and plaster, the heated tarps, the snow-blind grade
//   the light      light/ (LitRenderer, LightRig, practicals); the weather's medium and flakes through light/'s opt-in fog and overlay
//   the sets       whiteout.world.js; the shots, lenses and looks whiteout.plan.js; the people whiteout.cast.js (v7, lazily built)
//   the words      whiteout.weather.js CARDS (verbatim), Schibsted Grotesk 900 in #0B0B0B straight on the white, after the grade
// Score: audio/songs2/whiteout_e.py (64 BPM; the mark arrives in its tail). Closer beat 70 (65.625 s); the video ends at 67.03.
import * as THREE from 'three';
import { W as FW, H as FH } from '../lib/kit.js';
import { LitRenderer } from '../lib/fx/light/pipeline.js';
import { LightRig } from '../lib/fx/light/rig.js';
import { PRESETS } from '../lib/fx/light/presets.js';
import { Practical } from '../lib/fx/light/practicals.js';
import { exposureFromEV100, whiteBalance } from '../lib/fx/light/color.js';
import { Medium, plume } from '../lib/fx/light/medium.js';
import { Whiteout } from '../lib/fx/whiteout.js';
import { drawMark, markBox } from '../lib/closer.js';
import { TL, CUTS, WIND, VIS, BLOW, CARDS, TYPE, NAME, END } from './whiteout.weather.js';
import { World, boomTip } from './whiteout.world.js';
import { Cast } from './whiteout.cast.js';
import { SHOTS, LOOKS, shotAt, fovFromMM, liftAt, flapAt } from './whiteout.plan.js';
THREE.ColorManagement.enabled = true;

const DRY = !!globalThis.WHITEOUT_DRY;                      // node: the scene's own logic against stubs, nothing drawn
const T0 = performance.now(), lap = n => console.log('whiteout: [boot]', n, Math.round(performance.now() - T0), 'ms');
const Q = new URLSearchParams(globalThis.location?.search || '');
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// ================================================================ the face
const FACE = 'Schibsted Grotesk';
if (!DRY) { const f = new FontFace(FACE, 'url(../assets/fonts/schibsted-grotesk-latin-900-normal.woff2)', { weight: '900' }); document.fonts.add(await f.load()); }
window.DURATION = END + 0.1;
const out = document.getElementById('out'); out.width = FW; out.height = FH;
const ctx = out.getContext('2d');

// ================================================================ the stage: one LitRenderer, a light record per look
const SOFT = DRY ? true : (() => { try { const g = document.createElement('canvas').getContext('webgl2'), e = g.getExtension('WEBGL_debug_renderer_info'); return !e || /swiftshader|llvmpipe|software/i.test(g.getParameter(e.UNMASKED_RENDERER_WEBGL)); } catch (_) { return true; } })();
const SCALE = +(Q.get('scale') || (SOFT ? 0.5 : 1)), QUAL = Q.get('q') || (SOFT ? 'draft' : 'clip'), FLAKES = SOFT ? 0.25 : 1;
const glc = document.createElement('canvas'); glc.width = Math.round(FW * SCALE); glc.height = Math.round(FH * SCALE);
const lr = DRY ? { renderer: null, W: glc.width, H: glc.height, render: () => ({ ms: 0 }), sync() {}, pre: { texture: null }, acc: null } : new LitRenderer({ canvas: glc, width: FW, height: FH, quality: QUAL, scale: SCALE });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(24, FW / FH, 0.1, 8000);
camera.rotation.order = 'YXZ';
lap('stage');

// ================================================================ the weather (the series' engine)
const WX = new Whiteout(THREE, scene, { seed: 7, near: 15, count: Math.round(340000 * FLAKES), wind: WIND, vis: VIS, blow: BLOW, cuts: CUTS,
  drift: { count: Math.round(120000 * FLAKES), depth: 0.25, far: 55 }, grade: { W: FW, H: FH } });
lap('weather');

// ================================================================ the sets, the cast
const EXP = Object.fromEntries(Object.entries(LOOKS).map(([k, L]) => [k, exposureFromEV100(L.rec.camera.ev100)]));
const world = new World(scene, WX, { exposure: EXP });
const cast = new Cast(scene, { dry: DRY });
// frame 0's sign: 9 m in front of the lens, 0.65 m left of its axis, its face turned to the road's oncoming traffic
{ const f0 = SHOTS[0].cam(0), e = new THREE.Euler(f0.pitch, f0.yaw, 0, 'YXZ'), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, f0.yaw, 0));
  const p = V(-0.65, 0, -9).applyQuaternion(q).add(f0.pos); world.sign.position.set(p.x, 0.0, p.z); world.sign.rotation.y = 0.0; void e; }
lap('world');

// ================================================================ the light records and their practicals
const tarpsOut = [];   // the outward glow of each heated tarp: one lambertian 'area' per visible face, energy from the engine's tarp
for (const [i, E] of world.site.encs.entries()) for (const [fi, f] of E.g.userData.E.faces.entries()) { if (fi > 3) continue;
  const mx = Math.max(...f.L, 1e-9); tarpsOut.push({ kind: 'point', name: `tarp${i}_${fi}`, pos: f.centre.map((v, k) => v + f.normal[k] * 0.6), aim: f.centre.map((v, k) => v + f.normal[k] * 6),
    half: 1.3, pen: 1, cd: mx * f.area * 0.55, color: 3000, shadow: false, volume: i === 1 && fi === 2, volGain: 0.5, bounce: false, head: 'none', drive: () => ({ rgb: f.L.map(v => v / mx) }) }); }
const ER = world.er.x, NX = world.newh.x;
const RED_LED = [1, 0.035, 0.012];
const pickPos = { cur: null };
const tailSpecs = () => [-0.85, 0.85].map((x, k) => ({ kind: 'point', name: 'tail' + k, pos: [0, -50, 0], cd: 22, size: 0.08, color: 2000, shadow: false, volume: true, volGain: 1.2, bounce: false, head: 'none',
  drive: t => { const s = shotAt(t); if (!s.pickup) return { cd: 0, pos: V(0, -50, 0) }; const p = s.pickup(t), q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), p.yaw);
    return { pos: V(x, 1.0, -3.05).applyQuaternion(q).add(p.pos), rgb: RED_LED, cd: p.tail && p.visible !== false ? 22 : 0 }; } }));
const headSpecs = () => [-0.72, 0.72].map((x, k) => ({ kind: 'flood', name: 'head' + k, pos: [0, -50, 0], aim: [0, -50, 10], lumens: 1800, half: 0.32, pen: 0.4, color: 'led', shadow: k === 0, shadowSize: 1024, near: 0.3, far: 80, volume: true, volGain: 0.8, bounce: false, head: 'none',
  drive: t => { const s = shotAt(t); if (!s.pickup) return { cd: 0 }; const p = s.pickup(t), q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), p.yaw);
    return { pos: V(x, 1.02, 3.05).applyQuaternion(q).add(p.pos), cd: p.head && p.visible !== false ? 1800 / (2 * Math.PI * (1 - Math.cos(0.32))) : 0 }; } }));
const canopyLights = (x0, z0, z1, name) => [[-2.6, z0], [2.6, z0], [-2.6, z1], [2.6, z1]].map(([dx, z], k) => ({ kind: 'work', name: name + k, pos: [x0 + dx, 3.93, z], aim: [x0 + dx, 0, z + 0.4], lumens: 7000, half: 1.0, pen: 0.8, color: 4000, head: 'none',
  shadow: k === 0, shadowSize: 1024, near: 0.2, far: 30, contact: k === 0, volume: k < 2, volGain: 0.7 }));
const poleLights = (pts, name) => pts.map(([x, z, ax, az], k) => ({ kind: 'flood', name: name + k, pos: [x, 8.0, z], aim: [ax, 0, az], lumens: 28000, half: 0.75, pen: 0.6, color: 'led', head: 'none', shadow: k === 0, shadowSize: 2048, near: 1, far: 90, volume: true, volGain: 0.9 }));
const battens = (ent, root, name, n = 4) => ent.userData.battens.slice(0, n).map(([bx, by, bz], k) => { const p = V(bx, by - 0.04, bz).add(root.position); return { kind: 'fluorescent', name: name + k, pos: [p.x, p.y, p.z], aim: [p.x, 0, p.z], lumens: 5600, color: 'fluorescent', shadow: false, volume: false, bounce: false }; });
const LOOK_PRACTICALS = {
  dusk: () => [...tailSpecs(), { kind: 'wallpack', name: 'wallpack', color: 'led', lumens: 7000, pos: [world.darkWallPack.x - 0.35, world.darkWallPack.y, world.darkWallPack.z], aim: [world.darkWallPack.x - 4, 0, world.darkWallPack.z], shadow: false, volume: true, volGain: 0.9, bounce: false }],
  night: () => [...canopyLights(ER, 1.4, 5.6, 'canopy'), ...poleLights([[ER - 14, 18, ER - 6, 10], [ER + 12, 30, ER + 4, 14]], 'pole'), ...battens(world.er.entrance, world.er.entrance, 'batten', 3), ...tailSpecs()],
  site: () => [...tarpsOut],
  tent: () => { const [ix, , iz] = world.site.encs[0].at; return [...[[-3, -2], [3, -2], [-3, 2], [3, 2]].map(([dx, dz], k) => ({ kind: 'work', name: 'work' + k, pos: [ix + dx, 3.4, iz + dz], aim: [ix + dx * 0.4, 0, iz + dz * 0.4], lumens: 20000, half: 0.9, pen: 0.7, color: 3000, head: 'none',
    shadow: k === 1, shadowSize: 1024, near: 0.2, far: 20, contact: k === 1, volume: k < 2, volGain: 0.6, bounce: k < 2 })),
    { kind: 'point', name: 'flapday', pos: [ix + 6.6, 2.0, iz], cd: 0, size: 2.0, color: 9500, shadow: false, volume: true, volGain: 0.5, bounce: false, head: 'none', drive: t => ({ cd: 2200 * clamp(flapAt(t) / 1.2) }) }]; },
  end: () => [...canopyLights(NX + 8, 16.4, 20.6, 'canopy'), ...poleLights([[NX - 6, 34, NX + 2, 24], [NX + 22, 34, NX + 12, 24]], 'pole'), ...battens(world.newh.entrance, world.newh.entrance, 'batten', 3), ...headSpecs(), ...tailSpecs().map(s => ({ ...s, volume: false }))],
};
const rigs = {}; let rigOn = null;
function dryRig(rec) { const practicals = (rec.practicals || []).map(p => new Practical(p, 1)); return { rec, practicals, bounces: [], sun: null, disc: null, sunOn: false, sunDir: V(0, 1, 0), center: V(), _placeSun() {}, exposure: 1,
  skyTex: null, env: null, update(t, d) { for (const P of practicals) { if (P.spec.drive) { const x = P.spec.drive(t); if (x?.pos) { P.pos.copy(x.pos); P.light.position.copy(x.pos); } } P.update(t, { on: d?.[P.spec.name] ?? 1 }); } }, ambientL: () => V(1, 1, 1), atmos: { ...rec.atmosphere } }; }
function useLook(name) {
  if (rigOn?.name === name) return rigOn.rig;
  if (rigOn) for (const o of rigObjs(rigOn.rig)) scene.remove(o);
  if (!rigs[name]) { const L = LOOKS[name], rec = PRESETS[L.base]({ ...L.rec, practicals: LOOK_PRACTICALS[name]() }), tmp = new THREE.Scene();
    rigs[name] = DRY ? dryRig(rec) : new LightRig(lr.renderer, tmp, rec); rigs[name].lookName = name;
    rigs[name].wb = whiteBalance(L.rec.camera.wb); }
  const r = rigs[name]; for (const o of rigObjs(r)) scene.add(o);
  scene.background = r.skyTex; scene.environment = r.env; scene.backgroundIntensity = 1; scene.environmentIntensity = 1;
  rigOn = { name, rig: r }; return r;
}
const rigObjs = r => [r.sun, r.sun?.target, r.disc, ...r.practicals.map(p => p.group), ...(r.bounces || []).flatMap(b => [b.light, b.light.target])].filter(Boolean);

// the air's radiance per look (pre-exposed, scene-linear): its display value through the look's own white balance, its chroma the
// sky's (dusk) or the lamps' and the skyglow's (night); in a cut it goes to the white the cut makes
const airCache = {};
function airL(lookName, rig, cut) {
  const L = LOOKS[lookName]; if (L.air == null) return [0, 0, 0];
  if (!airCache[lookName]) { const wb = rig.wb || null, a = Whiteout.airL(L.air, wb), w = Whiteout.airL(L.white, wb);
    let ch = L.tint; if (!ch) { const amb = rig.ambientL ? rig.ambientL() : V(1, 1, 1), y = 0.2126 * amb.x + 0.7152 * amb.y + 0.0722 * amb.z; ch = y > 0 ? [amb.x / y, amb.y / y, amb.z / y] : [1, 1, 1]; }
    airCache[lookName] = { a, w, ch }; }
  const c = airCache[lookName], m = c.a + (c.w - c.a) * cut;
  return c.ch.map(v => v * m);
}

// ================================================================ the site's moving parts
const site = world.site, cr = site.crane, slingMat = new THREE.MeshStandardMaterial({ color: 0x343a42, roughness: 0.85 });
function poseSite(t) {
  const L = liftAt(t), tip = boomTip(cr), b = site.bundle;
  b.position.y = 0.25 + L.lift; b.updateMatrixWorld(true);
  const hookP = V(tip.x, Math.max(b.position.y + 2.6, L.hookY), tip.z);
  // the hook over the bundle (the boom's tip is set over it)
  const h = cr.userData.hook; h.position.copy(cr.worldToLocal(hookP.clone())); cr.userData.line.position.copy(cr.worldToLocal(hookP.clone()));
  const len = Math.max(0.1, tip.y - hookP.y); cr.userData.line.scale.set(1, len, 1); cr.userData.line.position.y = cr.worldToLocal(hookP.clone()).y;
  // the slings: from the hook's pin to the bundle's two pick points, slack until they go taut
  const S = site.slings; while (S.children.length) { const c = S.children.pop(); c.geometry.dispose(); }
  const pin = b.worldToLocal(hookP.clone().add(V(0, -0.75, 0)));
  for (const px of [-2.6, 2.6]) { const a = V(px, 1.2, 0), sag = (1 - L.taut) * 0.9, mid = a.clone().lerp(pin, 0.5).add(V(0, -sag, 0));
    S.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, pin), 12, 0.02, 5, false), slingMat)); }
  // the tarp flap of the first enclosure (the cut on action at 52.27 is the flap pulled aside)
  site.encs[0].g.userData.flap.rotation.y = -flapAt(t);
}

// ================================================================ the type (after the grade, untouched by it)
const SIZE = cap => cap / TYPE.capRatio;
function setFont(size, track) { ctx.font = `900 ${size.toFixed(2)}px "${FACE}"`; if ('letterSpacing' in ctx) ctx.letterSpacing = `${(track * size).toFixed(2)}px`; }
function lineW(s, size, track) { setFont(size, track); return ctx.measureText(s).width; }
function drawCard(card) {
  const [, , lines, o] = card; let k = 1;
  for (const [l, cap] of lines) { const w = lineW(l, SIZE(cap), TYPE.track); if (w > TYPE.maxW) k = Math.min(k, TYPE.maxW / w); }       // never past 888 px
  ctx.save(); ctx.fillStyle = TYPE.ink; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  let y = o.y, last = 0;
  lines.forEach(([l, cap], i) => { const s = SIZE(cap) * k; if (i) y += TYPE.lead * s; setFont(s, TYPE.track); ctx.fillText(l, TYPE.x, y); last = s; });
  const small = o.source || o.credit;
  if (small) { const sz = SIZE(TYPE.small.cap); let w = lineW(small, sz, TYPE.small.track), ks = Math.min(1, TYPE.maxW / w); setFont(sz * ks, TYPE.small.track); ctx.fillText(small, TYPE.x, y + 0.5 * last + 1.25 * sz * ks); }
  ctx.restore();
  return { y, last, k };
}
function drawType(t) {
  for (const c of CARDS) { if (t < c[0] || t >= c[1]) continue; const r = drawCard(c);
    const two = c[3].two; if (two && t >= two.t) { ctx.save(); ctx.fillStyle = TYPE.ink; setFont(SIZE(two.cap), TYPE.track); ctx.fillText(two.text, TYPE.x, r.y + TYPE.lead * SIZE(two.cap)); ctx.restore(); } }
  // the sign-off on the last white: the four-stripe mark (the only red) and the Party's name in the series face
  if (t >= NAME.t) { const g0 = markBox(0, 0, NAME.mark.size); drawMark(ctx, NAME.mark.x - g0.box.x0, NAME.mark.y, NAME.mark.size);
    ctx.save(); ctx.fillStyle = TYPE.ink; let y = NAME.y; NAME.lines.forEach((l, i) => { const s = SIZE(NAME.cap); if (i) y += TYPE.lead * s; setFont(s, TYPE.track); ctx.fillText(l, TYPE.x, y); }); ctx.restore(); }
}

// ================================================================ the steam inside the heat (light/medium.js: a lit volume, local)
const [ix, iy, iz] = site.encs[0].at;
const med = DRY ? null : new Medium({ box: [[ix - 6, 0, iz - 5], [ix + 6, 4.2, iz + 5]], res: [40, 16, 34], maxDensity: 0.7, detail: { scale: 1.2, erode: 0.6, multi: 0.6, lightShadow: true } });
if (med) { med.tint = [0.95, 0.93, 0.9];
  for (const [dx, dz, r] of [[2.2, -2.5, 0.8], [3.6, 0.5, 1.0], [2.8, 3.0, 0.7], [4.4, -1.0, 0.9]]) med.add(plume({ pos: [ix + dx, 0.3, iz + dz], kind: 'steam', rate: 1.6, r0: r, wind: [0.15, 0, 0.05], seed: 11 + dx * 3 }));
  med.add(plume({ pos: [ix - 5.4, 1.1, iz + 3.0], kind: 'steam', rate: 2.4, r0: 0.35, wind: [0.9, 0.2, -0.2], seed: 4 })); }

// ================================================================ one frame
let lastShot = null;
const DRIVE = {};
const tarpIn = new THREE.Color(0.55, 0.72, 1.0);
async function frameAt(t) {
  const s = shotAt(t);
  // the shot: its set, its lens, its light
  world.show(s.set);
  const c = s.cam(t); camera.position.copy(c.pos); camera.rotation.set(c.pitch, c.yaw, 0, 'YXZ'); camera.fov = fovFromMM(s.mm); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  const rig = useLook(s.look);
  // the pickup
  const pk = world.pick; if (s.pickup) { const p = s.pickup(t); pk.visible = p.visible !== false; pk.position.copy(p.pos); pk.rotation.y = p.yaw; pk.userData.tail.emissiveIntensity = p.tail ? 9000 * (rig.exposure || 1) : 0; pk.userData.head.emissiveIntensity = p.head ? 60000 * (rig.exposure || 1) : 0; } else pk.visible = false;
  // the people this shot shows (built the first time they are needed)
  cast.hideAll();
  for (const [name, clip, place] of s.cast || []) { const r = await cast.get(name, clip); if (r) cast.pose(r, place(t)); }
  if (s.cast && !DRY && !frameAt.sss) { frameAt.sss = true; await cast.sss(lr); }
  // the site's crane, bundle and flap; the tarp seen from inside (the blue dusk through it) or outside (the lamps' glow through it)
  if (s.set === 'site') poseSite(t);
  for (const E of site.encs) { const m = E.g.userData.E.mat; if (s.look === 'tent') { m.emissive.copy(tarpIn); m.emissiveIntensity = 0.38 * 220 / Math.PI * 0.9 * (rig.exposure || 1); } else { const e = E.g.userData.E; m.emissive.setRGB(...e.col); m.emissiveIntensity = e.intensity * EXP.site; } }
  // the lit interiors: screens and battens (their fixtures at their lamps' luminance)
  const Mx = world.er.entrance.children[0]?.children; void Mx;
  // the weather for this shot
  const cut = WX.cutLevel(t), wx = s.weather || {};
  if (lastShot !== s.id) { WX.shot({ enabled: wx.enabled !== false, ground: wx.ground ?? 0, dmin: wx.dmin ?? 6, drift: wx.drift !== false, count: wx.count ? Math.round(wx.count * FLAKES) : null,
    focus: s.focus, fstop: s.fstop, focal: s.mm / 1000, span: [s.t0, Math.min(s.t1, 67.1)], colliders: [], lights: [] }); lastShot = s.id; console.log('whiteout: shot', s.id, 'at', t.toFixed(3)); }
  const L = airL(s.look, rig, s.look === 'night' || s.look === 'end' ? cut : 0);
  WX.shot({ L, lights: (rig.practicals || []).filter(P => P.spec.volume && P.level > 0).slice(0, 4).map(P => ({ pos: P.light.position.toArray(), rgb: [P.col.r, P.col.g, P.col.b], cd: P.light.intensity })) });
  WX.update(t, camera);
  for (const k of Object.keys(DRIVE)) delete DRIVE[k];
  // a lamp's glow in the air goes out with the medium's own transmittance to it in a cut (a whiteout hides every lamp past its first metres)
  if (cut > 0) for (const P of rig.practicals || []) { const d = P.light.position.distanceTo(camera.position); DRIVE[P.spec.name] = Math.exp(-WX.sigmaCut(t) * Math.max(0, d - 2)); }
  const fog = wx.enabled === false ? null : { ...WX.fogParams(t), L };
  const interior = s.look === 'tent';
  lr.render({ scene, camera, rig, t, fog, overlay: fog ? WX.overlay : null, drive: () => DRIVE, medium: interior ? med : null,
    lens: { focus: s.focus, fstop: s.fstop, focal: s.mm }, ssr: { maxDist: interior ? 10 : 40, thickness: 0.5 },
    ao: interior ? { radius: 0.6, intensity: 1.3 } : { radius: 1.2, intensity: 1.1 }, contactLen: interior ? 0.3 : 0.8,
    heat: interior ? [{ c: [ix - 5.4, 1.6, iz + 3.0], h: [0.6, 0.9, 0.6], s: 1 }] : undefined });
  return s;
}

// ================================================================ render (the farm calls this for every frame)
window.renderFrame = async (tIn) => {
  const t = Math.min(tIn, END);
  await frameAt(t);
  if (DRY) return;
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const graded = WX.grade.apply(glc);
  ctx.drawImage(graded, 0, 0, FW, FH);
  drawType(t);
};
window.sceneInfo = { DUR: END, BPM: 64, CLOSE: 70 };
window.__whiteout = { scene, camera, world, cast, WX, SHOTS, shotAt, frameAt, useLook, rigs, poseSite };   // for inspection (the dry run, a lab)
lap('ready');
window.sceneReady = true;
