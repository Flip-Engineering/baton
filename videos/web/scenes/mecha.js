// MECHA PROLETARIAT (c2, 2 Oct; the asset remake, 8 Oct). The class builds a giant, crews it, stands it up and takes up its hammer.
// Mecha anime's dramaturgy played straight (build, launch, link, stand-up, the hammer) in heavy engineering's skin. The 8 Oct remake
// keeps the timeline, the words and the score and rebuilds every asset from the studio's own systems:
//   the light     light/ (LitRenderer + LightRig: one display transform, practicals that are in the world; mecha.stage.js)
//   the giant     MODELING's ERECTOR, design c5 (riveted angle-iron lattice, plate where a machine needs it, pinned bearings, rams with
//                 hoses, hands that close on what they hold), moved by MODELING's rig and acts (mecha.giant.js)
//   the yard      ERECT's Yard and OBJECTS' named tractors, switchgear, a shadow board, an anvil (mecha.world2.js, mecha.props.js)
//   the people    the client's person pipeline: v7 people for everyone at hero distance (mecha.cast.js), people.js in ranks beyond
//   the rooms     the crew's bridge (warm, theirs) and someone else's factory (cold, ranked, endless) round one console (mecha.cab2.js)
// Words: research/scripts_final/mecha.json. Song: audio/songs2/mecha.py (the c2 score, spliced c3).
import * as THREE from 'three';
import { W, H, loadBeats, clamp, lerp, ease, smooth, rng, loadImage } from '../lib/kit.js';
import { litPatchAll, litPatch } from '../lib/fx/light/patch.js';
import { Medium, dustBurst, bank, column } from '../lib/fx/light/medium.js';
import { setRigStops } from '../lib/fx/likeness/expose.js';
import { meterPeople } from '../lib/fx/person/index.js';
import { ensureSkinSSS } from '../lib/fx/person/index.js';
import { Kit, shakeAt, applyShake } from '../lib/fx/modeling/erect/events.js';
import { plantRing, plantRoll, throwClods } from '../lib/fx/modeling/erect/plantfx.js';
import { Sparks } from '../lib/fx/sim2/sparks.js';
import { World, V3 } from './mecha.world2.js';
import { Stage, defineLooks, movePractical } from './mecha.stage.js';
import { Cast } from './mecha.cast.js';
import { Bridge, Factory } from './mecha.cab2.js';
import { valveBank } from './mecha.props.js';
import { PLANT_BEAT, STEP, SLEDGE as SL } from './mecha.giant.js';
import { makeType } from './mecha.type2.js';
import { hull } from './mecha.hull.js';
import { TRUCK_PAINTS } from '../lib/fx/objects/truck.js';
import { G as OG, Parts, fin } from '../lib/fx/objects/kit.js';
THREE.ColorManagement.enabled = true;

const Q = new URLSearchParams(location.search);
// c20 takes (scenes/mecha__ab_a.html, mecha__ab_b.html set these): 'a' keeps the FIRE HER UP. card at the ignition, 'b' plays the
// ignition with no card at all. The scene's own name is the beat map's (make_audio writes out/.<scene>.hits.json).
const TAKE = window.MECHA_TAKE || Q.get('take') || 'a', SCENE = window.MECHA_SCENE || 'mecha';
// ================================================================ the words (scripts_final/mecha.json), beat for beat
// [beat, 'LINE|LINE' ('*' = italic, as the source sets it), emphasis, hold-to-beat].
const CUES = [
  // c20: WE BUILT HER. is gone (the client, 14 Oct: 'clunky and out of nowhere - it is not clear even what "her" is'). Its beats are the
  // reveal: the welder's face in the arc, then the giant the yard has built, with no card; after it FIRE HER UP. has a 'her' on screen.
  ...(TAKE === 'b' ? [] : [[2, 'FIRE HER UP.', 0, 4]]), [4, 'UP!', 0, 5], [5, 'UP!', 0, 6],
  // RISE (Infrared, 18 Sep 2022): THE AMERICAN WORKING CLASS ('the "mecha proletariat,"' elided) DEFINED BY ITS OWNERSHIP OF THE MEANS OF AUGMENTING ITS LABOR POWER - TRUCKS, TOOLS, ETC.
  [6, 'THE AMERICAN|*WORKING CLASS,', 0, 8], [8, 'DEFINED BY|ITS OWNERSHIP', 0, 10], [10, 'OF THE MEANS', 0, 11.5], [11.5, 'OF AUGMENTING', 1, 13.5],
  [13.5, 'ITS LABOR POWER:', 0, 16], [16, 'TRUCKS,', 1, 20], [20, 'TOOLS,', 1, 22],
  // Marx, Capital I ch. 15 s4 (Moore/Aveling), set whole: "In handicrafts and manufacture, the workman makes use of a tool, in the factory, the machine makes use of him.
  [24, 'IN HANDICRAFTS|AND MANUFACTURE,', 0, 25.5], [25.5, 'THE WORKMAN|MAKES USE OF A TOOL,', 0, 28], [28, 'IN THE FACTORY,', 0, 29.5], [29.5, 'THE MACHINE|MAKES USE OF HIM.', 1, 32],
  // There the movements of the instrument of labour proceed from him, here it is the movements of the machine that he must follow." (8 Oct: v8 set
  // "...PROCEED FROM HIM." without THERE, which says the reverse of the source; archive_audit_20261008 s4.) The whole sentence read at 48 characters a
  // second in these six beats, so the cards set its second clause, the one that follows IN THE FACTORY, after an ellipsis: HERE is the factory. Over
  // the bank the machine runs; the crew's hands close on the levers after it, at b38, with no card and no citation: the answer is the picture's, not Marx's.
  [32, '…HERE IT IS THE MOVEMENTS|OF THE MACHINE', 0, 35], [35, 'THAT HE|MUST FOLLOW.', 1, 38],
  [40, 'UP!', 1, 41], [41, 'UP!', 0, 42], [42, 'UP!', 0, 43], [43, 'UP!', 0, 44], [46, 'UP!', 0, 47], [47, 'UP!', 0, 48],
  // Haz, 8 Sep 2026 ('autonomously' kept): cut between the hands on the levers and the machine that follows them
  [50, 'AI CANNOT|ALIGN ITSELF', 1, 52], [52, 'AUTONOMOUSLY', 1, 54], [54, 'OR GIVE|ITSELF PURPOSE', 0, 56], [56, 'OUTSIDE OF|HUMAN INFLUENCE.', 0, 58],
  // Marx, Capital I ch. 15 s1: the steam-hammer
  [58, 'AN ORDINARY|HAMMER HEAD,', 0, 60.5], [60.5, 'BUT OF SUCH|A WEIGHT', 0, 62.5], [62.5, 'THAT NOT THOR|HIMSELF', 0, 64.5], [64.5, 'COULD|WIELD IT.', 1, 67.5],
];
// c3 (3 Oct): the client's order. Familiar things first (the class defined by its trucks and tools, the tractor), then Marx's tool and machine with
// flashes of the walker being built, then the ignition and the stand-up as the reveal (WE BUILT HER. / FIRE HER UP. / UP!), then alignment and
// the hammer. ORDER lists the key-beat spans in playing order; the song is spliced the same way (songs2/mecha_c3.py).
const ORDER = [[6, 39], [0, 6], [39, 66]];
const PMAP = (() => { let p = 0; return ORDER.map(([k0, k1]) => { const r = [k0, k1, p, p + (k1 - k0)]; p += k1 - k0; return r; }); })();
const toKey = pb => { for (const [k0, k1, p0, p1] of PMAP) if (pb < p1) return k0 + (pb - p0); return 66 + (pb - 66); };
const toPlay = kb => { for (const [k0, k1, p0] of PMAP) if (kb >= k0 && kb < k1) return p0 + (kb - k0); return kb; };
// c20: the ending breathes: after COULD WIELD IT. the giant holds with the hammer over the crowd while the alarm's resolved chord rings
// (key beats 66-72, no words), and the lockup comes at 72
const CLOSE = 72, LOCK_FRAMES = 42;
// UP! (4 Oct, the crew-call cutdown; scenes/mecha_up.html sets window.MECHA_CUT = 'up'): output beats play these playing-beat spans in turn
const CUT = window.MECHA_CUT === 'up' ? [[33, 50], [58, 66]] : null;
const CUT_CLOSE = CUT ? CUT.reduce((a, [p0, p1]) => a + p1 - p0, 0) : CLOSE;
const cutToPlay = ob => { let o = 0; for (const [p0, p1] of CUT) { if (ob < o + (p1 - p0)) return p0 + (ob - o); o += p1 - p0; } return CLOSE + (ob - o); };

// ================================================================ boot
const T0 = performance.now(); const lap = n => console.log('mecha: [boot]', n, Math.round(performance.now() - T0), 'ms');
await (async () => {
  for (const [name, file, style] of [['Chakra Petch', 'chakra-petch-latin-700-normal.woff2', 'normal'], ['Chakra Petch', 'chakra-petch-latin-700-italic.woff2', 'italic']]) {
    const f = new FontFace(name, `url(../assets/fonts/${file})`, { weight: '700', style }); document.fonts.add(await f.load());
  }
  const f2 = new FontFace('Archivo Black', 'url(../node_modules/@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2)'); document.fonts.add(await f2.load());
  const f3 = new FontFace('Big Shoulders Stencil Display', 'url(../node_modules/@fontsource/big-shoulders-stencil-display/files/big-shoulders-stencil-display-latin-800-normal.woff2)', { weight: '800' }); document.fonts.add(await f3.load());
})();
let B;
try { B = await loadBeats(CUT ? 'mecha_up' : SCENE); } catch (e) { console.log('mecha: no beat map'); throw e; }
const SPB = B.spb, bt = b => b * SPB;
const tKey = kb => bt(toPlay(kb));                         // playing seconds of a key beat (absolute events: dust, sparks, clods)
const DUR = CUT_CLOSE * SPB + LOCK_FRAMES / 30;
window.DURATION = DUR;
const [lockImg, eqImg, slashImg, accImg, acpMarkImg] = await Promise.all(['acc_lockup', 'part_eq', 'part_slash', 'part_acc', 'part_mark'].map(k => loadImage(`../assets/${k}.png`)));
void lockImg;
const out = document.getElementById('out'); out.width = W; out.height = H;
const ctx = out.getContext('2d');
// software GL renders the farm's preview tiers; a real GPU renders 1080x1920 at K = 3 (light/'s clip tier)
const SOFT = (() => { try { const g = document.createElement('canvas').getContext('webgl2'), e = g.getExtension('WEBGL_debug_renderer_info'); return !e || /swiftshader|llvmpipe|software/i.test(g.getParameter(e.UNMASKED_RENDERER_WEBGL)); } catch (_) { return true; } })();
const SCALE = +(Q.get('scale') || (SOFT ? 0.5 : 1)), QUAL = Q.get('q') || (SOFT ? 'draft' : 'clip');
const stage = new Stage({ W, H, scale: SCALE, quality: QUAL });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 6000);
const T = makeType(ctx, W, H);
lap('stage');

// ---------------------------------------------------------------- the world, the rooms, the cast
const world = new World(scene, { viewH: Math.round(H * SCALE) });
const E = world.E, acts = world.acts, Y = world.Y;
const HULL = hull(E, { variant: Q.get('hull') || 'A' });               // c20: a head, shoulders and a chest on ERECTOR (mecha.hull.js)
lap('world');
const SET = V3(0, 42, 11);                                  // the console (the crew's bridge is high in her, the yard far below the glass)
const bankC = valveBank({ seed: 2, tape: [['WALT', -2.2], ['JUNE', -1.25], ['DARNELL', -0.3], ['TONO', 0.65], ['LUZ', 1.6]] });
bankC.position.copy(SET); scene.add(bankC);
const bridge = new Bridge(scene, SET), factory = new Factory(scene, SET, bankC, { n: 7, viewH: Math.round(H * SCALE) });
const levers = bankC.userData.levers;
lap('rooms');
const cast = await new Cast().build({ scene });
scene.updateMatrixWorld(true);
cast.planConsole(SET, levers);
cast.setupBreaker(world.sw);
const HS = world.SHOP.clone(), RAY = cast.setupRay(scene, HS, 0, 4 * SPB);
// c20: a crew's own tractor on a crane's hook, going up to her leg (TRUCKS,): a spreader bar over the cab, four slings to its corners
const HUNG = (() => { const T = world.makeTruck({ seed: 205, cab: 'cabover', paint: TRUCK_PAINTS.blue, plate: ['OHIO', 'LEG-L 4'], x: 0, z: 0, yaw: 0, trailer: 'none' });
  const bb = T.meta.bbox, top = bb.max.y, x0 = bb.min.x + .3, x1 = bb.max.x - .3, zz = (bb.max.z - bb.min.z) / 2 - .2, sp = top + 2.4, P0 = new Parts();
  P0.add('bar', OG.box(x1 - x0 + .4, .3, .3, (x0 + x1) / 2, sp, 0));
  for (const x of [x0, x1]) for (const z of [-zz, zz]) P0.add('sling', OG.rod(V3(x, top, z), V3(x, sp, z * .2), .03, 6));
  T.T.add(P0.build({ bar: fin('steel', { color: 0xc9a227 }), sling: fin('steel', { color: 0x2a2a2a }) }));
  T.hookY = sp + .4; T.cx = (x0 + x1) / 2; T.g.visible = false; return T; })();
lap('cast');
// her cab: the glow behind the glass is the crew's bridge seen from outside (the five as figures against it); the plate lit in the brownout
E.M.cab.emissive.set('#ffb070');
if (E.markMesh) { const mm = E.markMesh.material; mm.emissive.set('#ffffff'); mm.emissiveMap = mm.map; mm.emissiveIntensity = 0; mm.needsUpdate = true; }

// ---------------------------------------------------------------- events: dust, clods, sparks, the ground bank at dawn
const K = new Kit(world.out); K.dust.g.visible = false; K.snow.g.visible = false;
const med = new Medium({ box: [[-70, 0, -30], [70, 26, 92]], res: [80, 22, 70], maxDensity: .9, detail: { scale: .5, erode: .65, multi: .8, lightShadow: true } }); med.tint = [.92, .86, .78];
const gate = (src, on) => ({ kind: src.kind, puffs: t => (on() ? src.puffs(t) : []) });
let LOOKNOW = 'night';
med.add(gate(bank({ box: [[-80, 0, -24], [80, 5.5, 96]], d: .22, a: .85, n: 46, seed: 9 }), () => LOOKNOW === 'dawn' || LOOKNOW === 'blue'));
const PLANTS = [];
{ // the knee off the ground (UP! 1), the stand-up's plant (UP! 4), the step's plant (UP! 47), her hammer's head (COULD WIELD IT.)
  const kn = { x: -5.2, z: 2.2 }, p1 = { x: -5.8 - .4, z: 12.8 - 3.2 }, p2 = { x: STEP.to[0] - .4, z: STEP.to[1] - 3.2 }, hh = acts.K.rest, head = V3(0, acts.ham.userData.headC.y, 0).applyQuaternion(hh.q).add(hh.b);
  const ev = [[41.05, kn.x, kn.z, .9, [5, 6]], [PLANT_BEAT, p1.x, p1.z, 1.35, [7.4, 13]], [STEP.plant, p2.x, p2.z, 1.5, [7.4, 13]], [SL.land, head.x, head.z, 1.6, [11, 5.2]]];
  ev.forEach(([b, x, z, e, foot], i) => { const t0 = tKey(b); PLANTS.push({ b, t0, x, z });
    med.add(plantRing({ pos: [x, .02, z], t0, foot, yaw: 0, energy: e, seed: 3 + i })); med.add(plantRoll({ pos: [x, 0, z], t0, foot, yaw: 0, energy: e * .9, seed: 9 + i }));
    med.add(dustBurst({ pos: [x, .05, z], t0: t0 + .04, energy: e, radius: 6, n: 60, seed: 11 + i, albedo: .56, wind: [.6, 0, .2], core: 1 }));
    throwClods(K, t0, [x, z], { foot, yaw: 0, n: 60 + 20 * i, seed: 4 + i }); K.plant(t0, x, z, foot[1], e); });
  // steam from her stacks once she is up (the plant is lit when she stands)
  E.stacks.forEach((p0, i) => med.add(gate(column({ pos: () => { const p = p0.clone().applyMatrix4(E.J.chest.matrixWorld); return [p.x, p.y, p.z]; }, h: 34, w: 4, wind: [1.1, .1, .4], rate: .8, n: 50, d: .55, seed: 3 + i }), () => LOOKNOW === 'dawn' || LOOKNOW === 'morning')));
}
const sparkG = new THREE.Group(); scene.add(sparkG);
const sparks = new Sparks(sparkG, { max: 6000, ground: 0, viewH: Math.round(H * SCALE) });
// Ray's blows land on the hot bar at key beats 14.5 and 26.5 (one blow every four beats); the arcs on her decks spit while the crews weld
const SLEDGE_AT = 2.5;
for (const kb of [10.5, 14.5, 18.5, 22.5, 26.5, 30.5]) if (RAY) sparks.burst({ t0: tKey(kb), pos: RAY.top.clone().add(V3(0, .04, 0)).toArray(), dir: [0, .45, 1], spread: 1.1, n: 220, kind: 'strike', seed: 7 + kb });
const ARCS = [V3(4.5, 30.5, 8.5), V3(-6.5, 9.5, 7)];
ARCS.forEach((p, i) => sparks.stream({ t0: 0, t1: tKey(39), rate: 60, pos: p.toArray(), dir: [i ? .3 : -.2, -.4, 1], spread: .9, kind: 'weld', seed: 30 + i, env: tt => (Math.sin(tt * 3.1 + i * 2) > -.2 ? 1 : 0) }));
lap('events');

// ---------------------------------------------------------------- the light, then every material patched into it
defineLooks(stage, world, SET);
litPatch(world.ground.material, { planar: true });
for (const p of world.puddles) { p.material.roughness = .07; litPatch(p.material, { planar: true }); p.position.y = .02; }
litPatchAll(scene);
scene.traverse(o => { const m = o.material; if (!m || !m.isMeshStandardMaterial) return; if (m.metalness > .6 || (m.roughness < .15 && !m.userData.litPlanar)) litPatch(m, { ssr: true }); });
stage.use('night', scene);
const SSS = stage.dry ? null : await ensureSkinSSS(stage.lr, scene).catch(e => { console.log('mecha: skin SSS pass not installed', e.message); return null; });
lap('patched');

// ================================================================ helpers
const eio = ease.inOutCubic, eo = ease.outCubic, eox = ease.outExpo;
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function setCam(pos, target, fov = 40, roll = 0) {
  camera.position.copy(pos); camera.up.set(Math.sin(roll), Math.cos(roll), 0); camera.lookAt(target); camera.fov = fov; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
}
function shake(t, amp, seed = 1) { return V3(Math.sin(t * 31 + seed) * amp + Math.sin(t * 57 + seed * 2) * amp * 0.5, Math.sin(t * 37 + seed * 3) * amp + Math.sin(t * 61) * amp * 0.4, 0); }
const project = (p) => { const v = p.clone().project(camera); return [(v.x * 0.5 + 0.5) * W, (1 - (v.y * 0.5 + 0.5)) * H, v.z]; };
const jw = (name, off = [0, 0, 0]) => { E.g.updateMatrixWorld(true); return V3(...off).applyMatrix4(E.J[name].matrixWorld); };
const BR = () => acts.cabWorld();                                  // the glass of her cab: her face
const FT = side => { E.g.updateMatrixWorld(true); return E.J['to' + side].getWorldPosition(V3()); };
const S0 = (x, y, z) => SET.clone().add(V3(x, y, z));              // a point in the console's frame
const wrR = () => { E.g.updateMatrixWorld(true); return E.J.wrR.getWorldPosition(V3()); };

// ================================================================ the shots: (b, u, t) -> state; the state names the look, who is where
const shots = [];
const S = (b0, b1, fn) => shots.push([b0, b1, fn]);
// the machine's stroke on the factory's levers: thrown on the beat, held, drawn back (the hands go with it)
const stroke = b => { const cy = (((b % 1) + 1) % 1); return eo(clamp(cy / .22)) * (1 - eio(clamp((cy - .5) / .42))); };
const lampsOnBeat = b => (r, c) => ((Math.floor(b * 2) + c + r * 2) % 5 === 0 ? 1 : .06);

// ---- b0-2 (c20, no card): the reveal. b0-1: the welder's face in the arc light, turned up to what she has been welding; the sparks
// fall between her and the lens. b1-2: from behind her and below, pulling back and up: she is small against the kneeling giant, its
// head lit with the crew in its glass. After this, 'her' is on screen.
const WELD_AT = V3(10.2, 0, 21.0), WELD_YAW = Math.atan2(-6.5, -14);
const WELD_F = V3(Math.sin(WELD_YAW), 0, Math.cos(WELD_YAW));                       // her facing (toward the giant)
const REV_ARC = WELD_AT.clone().addScaledVector(WELD_F, 2.6).add(V3(-.6, 3.1, 0));  // the arc on her knee plating, in her gaze
S(0, 1, (b, u) => {
  const face = WELD_AT.clone().add(V3(0, 1.6, 0)), cam = face.clone().addScaledVector(WELD_F, .95 - .12 * u).add(V3(.18, -.16, 0));
  setCam(cam, face.clone().add(V3(0, .04, 0)), 36, .02);
  return { look: 'night', build: .99, giant: 'kneel', welder: { mode: 'stand', pos: WELD_AT, yaw: WELD_YAW, look: .62 }, arcAt: REV_ARC, arcFlicker: true, flood: .5, work: .4,
    key: { pos: face.clone().addScaledVector(WELD_F, 2).add(V3(-1.4, 1.6, 0)), aim: face }, fill: { pos: face.clone().addScaledVector(WELD_F, 1.5).add(V3(1.6, -.3, 0)), aim: face }, ev: .2, meter: 'welder', cabin: 2.6, cabCrew: true };
});
S(1, 2, (b, u) => {
  const e = eio(u), back = WELD_F.clone().negate(), br = BR();
  const cam = WELD_AT.clone().addScaledVector(back, lerp(3.2, 17, e)).add(V3(lerp(1.0, 4.5, e), lerp(1.1, 3.2, e), 0));
  setCam(cam, WELD_AT.clone().add(V3(0, 1.4, 0)).lerp(br.clone().add(V3(0, -6, 0)), .35 + .55 * e), lerp(46, 52, e), .02);
  return { look: 'night', build: .99, giant: 'kneel', welder: { mode: 'stand', pos: WELD_AT, yaw: WELD_YAW, look: .62 }, arcAt: REV_ARC, arcFlicker: true, flood: 1, cabin: 2.8, cabCrew: true, trucksOn: .5, ev: .1, clear: 0 };
});
// ---- b2-3 FIRE HER UP.: her shoulders, both hands and the main breaker's handle in one frame: she throws it, leaning into it
S(2, 3, (b, u) => {
  const H0 = cast.swHub || V3(13.5, 1.05, 27.3), T = cast.swThrow || { off: .5, on: -.1 }, k = eox(clamp((b - 2.06) / 0.3));
  setCam(V3(H0.x + 2.1, 1.62, H0.z + .78), V3(H0.x + .05, 1.36, H0.z + .3), 40, .03);   // from her right side: shoulders, both hands, the handle
  const ramp = [0, 1, 2, 3].map(i => clamp((b - 2.35) * 3.2 - i * .55));
  return { look: 'night', build: .97, giant: 'kneel', floodEach: ramp, work: 0, welder: { mode: 'breaker', th: T.off + (T.on - T.off) * k, lean: .12 * k, a: 1 - clamp((b - 2) / .08), u: clamp((b - 2) / .08) }, key: { pos: V3(H0.x + 3.5, 3.2, H0.z + 3.5), aim: V3(H0.x, 1.3, H0.z + .5) }, ev: .2, meter: 'welder' };
});
// ---- b3-4: the yard wakes: engines catch, headlights up the row of trucks, the floods full; the sweep along the kneeling giant
S(3, 4, (b, u) => {
  setCam(V3(36 - 10 * u, 2.0, 70), V3(0, 15 + 4 * u, 6), 50, 0.02);
  return { look: 'night', build: .97, giant: 'kneel', flood: 1, trucksOn: clamp((b - 3) * 3), arcs: 1 };
});
// ---- b4-5 UP! (c20): the whole kneeling body from low on the apron, the tilt rising from her planted knee to her head as the crew's
// glass comes up to full
S(4, 5, (b, u) => {
  const br = BR();
  setCam(V3(30 - 4 * u, 2.0, 66), br.clone().add(V3(0, lerp(-24, -9, eo(u)), 0)), 46, 0.02);
  return { look: 'night', build: .99, giant: 'kneel', flood: 1, arcs: 1, trucksOn: 1, cabin: lerp(1.4, 3.2, eo(u)), cabCrew: true };
});
// ---- b5-6 UP!: the No. 1 plate flown in on the hook and set on her chest, under her face; the torso and the head in frame
S(5, 6, (b, u) => {
  const m = E.markAt.p.clone().applyMatrix4(E.J.chest.matrixWorld);
  setCam(V3(-17, 3.2, 46), m.clone().add(V3(1, -2 + 5 * eo(u), 0)), 42, -0.03);
  return { look: 'night', build: .99, giant: 'kneel', flood: 1, markIn: 1 - eo(clamp(u * 1.15)), arcs: 1, trucksOn: 1, cabin: 3.0, cabCrew: true };
});
// ---- b6-8 THE AMERICAN WORKING CLASS, (c20: frame 0): the crew themselves, in the yard at night, not at the factory's lever bank
// (that bank is the factory's, and the turn's). Six of them in a loose knot on the apron, looking up past the lens at something we
// have not seen yet; a warm work light on their faces, a fill from the other side, the haul road's sodium and the trucks behind.
const G0 = V3(2, 0, 44);
const KNOT = [['c0', -1.5, -.2, -.25], ['c1', -.55, .55, .1], ['c2', .45, -.05, .2], ['welder', 1.35, .7, -.1], ['c3', 2.2, .1, .3], ['c4', -2.4, 1.0, -.35]];
const knot = (look = .42) => KNOT.map(([who, x, z, turn], i) => ({ who, pos: G0.clone().add(V3(x, 0, z)), yaw: Math.PI + turn * .5, look: look + .05 * Math.sin(i * 2.3), turn: -turn * .4 }));
S(6, 8, (b, u) => {
  setCam(G0.clone().add(V3(.9 - .5 * u, 1.12 + .05 * u, -4.3 + .8 * u)), G0.clone().add(V3(.1, 1.62, .3)), 38, 0.0);
  return { look: 'night', build: .99, giant: 'hide', stand: knot(), flood: .6, work: 0, trucksOn: 1, heroLamps: 1,
    key: { pos: G0.clone().add(V3(-3.2, 3.6, -4.6)), aim: G0.clone().add(V3(0, 1.6, 0)) }, fill: { pos: G0.clone().add(V3(4.2, 1.8, -3.6)), aim: G0.clone().add(V3(0, 1.5, 0)) }, ev: .3, meter: 'crew', clear: 6 };
});
// ---- b8-10 DEFINED BY ITS OWNERSHIP: the crews' own tools on their shadow board, the names on tape
S(8, 10, (b, u) => {
  const r = world.rack, fw = V3(Math.sin(r.rotation.y), 0, Math.cos(r.rotation.y)), rt = V3(fw.z, 0, -fw.x), p = r.position;
  setCam(p.clone().addScaledVector(fw, 2.7 - .4 * u).addScaledVector(rt, -1.3 + .6 * u).add(V3(0, 1.75, 0)), p.clone().addScaledVector(rt, .3).add(V3(0, 1.8, 0)), 40, 0.02);
  return { look: 'night', build: .74, giant: 'kneel', flood: 1, key: { pos: p.clone().addScaledVector(fw, 3.2).addScaledVector(rt, 2.2).add(V3(0, 3.6, 0)), aim: p.clone().add(V3(0, 1.8, 0)) }, ev: .4 };
});
// ---- b10-11.5 OF THE MEANS: the crews' own tractor, low from the front quarter, its lamps on
S(10, 11.5, (b, u) => {
  const H0 = world.hero;
  setCam(H0.at(8.6 - 1.4 * u, 3.0, 1.15), H0.at(1.2, 0.2, 1.75), 40, 0.02);
  return { look: 'night', build: .76, giant: 'kneel', flood: .6, trucksOn: 1, heroLamps: 1, key: { pos: H0.at(5.5, -5.5, 5.2), aim: H0.at(1, 0, 1.2) }, ev: .3 };
});
// ---- b11.5-13.5 OF AUGMENTING: an engine catches, the row's headlights come up one by one
S(11.5, 13.5, (b, u) => {
  const T0 = world.trucks[6];
  setCam(T0.at(9.6 - 1.8 * u, 3.4, 1.1), T0.at(1.2, 0, 1.7), 46, 0.03);
  return { look: 'night', build: .8, giant: 'kneel', flood: .85, trucksOn: clamp((b - 11.5) * 2.5), key: { pos: T0.at(6, 5, 5.5), aim: T0.at(1, 0, 1.2) }, ev: .2 };
});
// ---- b13.5-16 ITS LABOR POWER: (c20: v11 played this over black: he was lit from behind). A man's own swing, from his lit side: the
// key in front of him, a fill, the hot bar under his hands; the haft taking his weight on the lift, the blow on 14.5.
const ray = (b, cam, tgt, fov, marx, key, fill) => { setCam(cam, tgt, fov, .02);
  return { look: 'night', flood: 0, work: 0, hps: 0, giant: 'hide', ray: true, marx, hotbar: 1, key: key || { pos: V3(HS.x + 2.6, 2.9, HS.z + 2.9), aim: V3(HS.x, 1.1, HS.z + .4) },
    fill: fill || { pos: V3(HS.x - 2.4, 1.7, HS.z + 3.2), aim: V3(HS.x, 1.2, HS.z + .3) }, ev: .4, meter: 'ray', shadowAt: HS, shadowR: 14 }; };
S(13.5, 16, (b, u) => ray(b, V3(HS.x + 1.9 - .25 * u, 1.3, HS.z + 2.5 - .2 * u), V3(HS.x + .1, 1.12, HS.z + .35), 34, { noPrint: true }));
// ---- b16-20 TRUCKS,: the crews' own trucks, their plates, their lamps; diesel at the feet of the machine
const truckShot = (i, d0, side, y0) => (b, u) => { const T0 = world.trucks[i];
  setCam(T0.at(d0 - 2.0 * u, side, 1.0), T0.at(1.2, 0, y0 + .7 * u), 46, 0.03);
  return { look: 'night', build: .9, giant: 'kneel', flood: .85, trucksOn: 1, key: { pos: T0.at(6.5, -side * 1.8, 5), aim: T0.at(1, 0, 1.1) }, ev: .2 }; };
// c20: TRUCKS, holds on a truck with its driver at it (one of the crew by the cab, in its lamps), then one of their tractors going up
// on a crane's hook to her leg: the trucks are what she is made of
S(16, 18, (b, u) => { const T0 = world.trucks[0], st = truckShot(0, 8.6, 2.9, 1.6)(b, u), pp = T0.at(3.0, 2.05, 0), cp = camera.position;
  st.stand = [{ who: 'c3', pos: pp, yaw: Math.atan2(cp.x - pp.x, cp.z - pp.z) + .5, look: .02, turn: -.35 }];
  st.key = { pos: T0.at(6.2, 5.2, 3.4), aim: pp.clone().add(V3(0, 1.5, 0)) }; st.fill = { pos: T0.at(7.5, -.5, 1.8), aim: pp.clone().add(V3(0, 1.4, 0)) }; st.meter = 'c3'; st.ev = .3; return st; });
const HANG = { x: -15.5, z: 22 };
S(18, 20, (b, u) => {
  const kn = jw('knL', [0, 0, 0]), hy = lerp(2.5, 11.5, eio(u)), hp = V3(kn.x - 7.5, hy + HUNG.hookY, kn.z + 6.5);
  setCam(V3(kn.x - 20 + 3 * u, 1.3, kn.z + 26), V3(kn.x - 6, lerp(5, 11, eio(u)), kn.z + 4), 50, -0.04);
  return { look: 'night', build: .93, giant: 'kneel', flood: 1, arcs: 1, trucksOn: 1, hang: { hook: hp, yaw: .5 + .25 * u }, cabin: 1.4, ev: .2 };
});
// ---- b20-22 TOOLS,: the board close, a name, the outline round each tool
S(20, 22, (b, u) => {
  const r = world.rack, fw = V3(Math.sin(r.rotation.y), 0, Math.cos(r.rotation.y)), rt = V3(fw.z, 0, -fw.x), p = r.position;
  setCam(p.clone().addScaledVector(fw, 3.9 - .5 * u).addScaledVector(rt, .1).add(V3(0, 2.0, 0)), p.clone().add(V3(0, 1.95, 0)), 44, 0.02);
  return { look: 'night', build: .94, giant: 'kneel', flood: 1, key: { pos: p.clone().addScaledVector(fw, 3.0).addScaledVector(rt, -2.4).add(V3(0, 3.4, 0)), aim: p.clone().add(V3(0, 1.8, 0)) }, ev: .4 };
});
// ---- b22-24 (c20, no card): the giant being built, each event lit by its own work. b22-23: a weld closing a joint at her knee, the arc
// the only light on the welder and the lattice round him; b23-24: a plate coming up on a hook to its seat on her arm, from below.
const KNEE_W = () => { const k = jw('knR', [0, 0, 0]); return { k, man: V3(k.x + 2.3, 0, k.z + 3.0), arc: V3(k.x + 1.8, 1.25, k.z + 2.45) }; };
S(22, 23, (b, u) => { const W0 = KNEE_W();
  setCam(V3(W0.man.x + 3.4 - .4 * u, 1.05, W0.man.z + 3.6 - .3 * u), W0.arc.clone().add(V3(-.6, .6, -.4)), 38, .03);
  return { look: 'night', build: .9, giant: 'kneel', flood: .25, work: 0, hps: .5, arcs: 0, arcAt: W0.arc, arcFlicker: true, stand: [{ who: 'c2', pos: W0.man, yaw: Math.atan2(W0.arc.x - W0.man.x, W0.arc.z - W0.man.z), look: -.25 }],
    fill: { pos: V3(W0.man.x + 3, 2.4, W0.man.z + 4), aim: W0.man.clone().add(V3(0, 1.4, 0)) }, ev: .1, clear: 5 };
});
S(23, 24, (b, u) => {
  const L = E.liftsAt(.9), l = L.find(q => q.side < 0) || L[0], c = l ? l.c.clone() : jw('elL', [0, 0, 0]);
  setCam(V3(c.x - 14, 1.6, c.z + 24), c.clone().add(V3(1, lerp(-4, 0, eo(u)), 0)), 44, -.03);
  return { look: 'night', build: .9, giant: 'kneel', flood: 1, lifts: true, arcs: 1, trucksOn: 1, cabin: 1.2, ev: .1 };
});
// ---- b24-38 MARX: the workman and his tool; the factory and its machine. A red rule and the citation lie over it.
S(24, 25.5, (b, u) => ray(b, V3(HS.x + 2.3 - .35 * u, .98, HS.z + 3.1 - .3 * u), V3(HS.x + .05, .92, HS.z + .55), 38, { hammer: true }));
S(25.5, 28, (b, u) => ray(b, V3(HS.x + 4.4 - .4 * u, 1.35, HS.z + 1.6 - .2 * u), V3(HS.x + .1, 1.05, HS.z + .3), 40, { hammer: true }));   // c20: the whole blow, side on, from his lit side
// the factory: someone else's plant, cold; the levers thrown by the machine on the beat, the arms dragged with them
S(28, 29.5, (b, u) => {
  setCam(S0(6.2 - .6 * u, 1.75, 3.3), S0(-7, 1.15, 0.0), 42, 0.02);
  return { look: 'factory', room: 'factory', marx: {}, cab: { vis: 5, closeAt: 0, th: -.26 + .42 * stroke(b) }, ctlLamps: lampsOnBeat(b), meter: 'crew' };
});
S(29.5, 32, (b, u) => {
  setCam(S0(-1.6 + .35 * u, 1.55, 3.3 - .25 * u), S0(-1.15, 1.2, .5), 40, 0.0);
  return { look: 'factory', room: 'factory', marx: {}, cab: { vis: 5, closeAt: 0, th: -.26 + .42 * stroke(b) }, ctlLamps: lampsOnBeat(b), meter: 'crew' };
});
S(32, 38, (b, u) => {                                  // one travel along the bank the machine runs: hands on their levers, the line going back behind
  const e = eio(u), x = -4.9 + 1.9 * e;
  setCam(S0(x, 1.5 - .05 * e, 2.1 - .15 * e), S0(x + 3.4, 1.36, .55), 34, 0.02);
  return { look: 'factory', room: 'factory', marx: {}, cab: { vis: 5, closeAt: 0, th: -.26 + .42 * stroke(b) }, ctlLamps: lampsOnBeat(b), meter: 'crew' };
});
// (no card, no citation) the answer, in their own bridge: the grips empty, then ten hands close on ten levers, one after another
S(38, 39, (b, u) => {
  setCam(S0(-1.3 + .7 * u, 1.05, 2.6), S0(-1.0 + .3 * u, 1.18, .7), 40, -0.04);
  return { look: 'bridgeN', room: 'bridge', cab: { vis: 5, closeAt: 38.0, th: 0 }, meter: 'crew' };
});
// ---- b39-40 THE BROWNOUT: every lamp dies as the draw hits the grid; only her lit glass with the crew in it, and the one red plate
S(39, 40, (b, u, t) => {
  const br = BR(), n = V3(0, 0, 1).applyQuaternion(E.J.chest.getWorldQuaternion(new THREE.Quaternion())); n.y = Math.max(n.y, -.9); n.normalize();
  const cp = br.clone().addScaledVector(n, 50).add(V3(7, 0, 0)); cp.y = Math.max(cp.y, 2.0);
  setCam(cp.add(shake(t, .012)), br.clone().add(V3(0, -5.2, 0)), 36, 0);   // c20: the lit glass (her face) over the plate on her chest: one shape
  return { look: 'night', dark: true, build: .99, giant: 'standup', cabin: 4.2, mark: 3.2, cabCrew: true, noType: b > 39.1, ev: -.3 };
});
// ---- b40-44 UP!: the stand-up in four stages, in the blue hour, the cuts on the UP!s
S(40, 41, (b, u, t) => {                                    // UP! 1: the knee pinned, the hip swings over the front foot; from low, a truck in the foreground
  const f = FT('L');
  setCam(V3(f.x + 26, 1.4, f.z + 36).add(shake(t, .4 * Math.exp(-(b - 40) * 5))), V3(f.x - 2, 13 + 5 * u, f.z - 3), 54, 0.07);
  return { look: 'blue', build: .99, giant: 'standup', flood: 1, trucksOn: 1, cabin: 2.6, cabCrew: true };
});
S(41, 42, (b, u, t) => {                                    // UP! 2: she rises on the front leg: the knee's rams from below, the knee leaves the ground
  const kn = jw('knL', [0, 0, 5]);
  setCam(V3(kn.x + 20, 2.0, kn.z + 30).add(shake(t, .3 * Math.exp(-(b - 41.05) * 4) * (b > 41.05 ? 1 : 0))), kn.clone().add(V3(-2, 7 + 4 * u, 0)), 54, -0.06);
  return { look: 'blue', build: .99, giant: 'standup', flood: 1, cabin: 2.6, cabCrew: true };
});
S(42, 43, (b, u, t) => {                                    // UP! 3: the trailing leg steps through, between the scaffolds, hips past the lens
  const h = jw('hpR', [0, 0, 0]);
  setCam(V3(h.x - 26, 3.4, h.z + 36), h.clone().add(V3(4, 4, 0)), 56, 0.04);
  return { look: 'blue', build: .99, giant: 'standup', flood: .6, cabin: 2.6, cabCrew: true };
});
S(43, 44, (b, u, t) => {                                    // UP! 4: the plant (the air and dust squeezed out from under the sole), then she comes up; from the front, low
  const br = BR(), base = V3(17, 1.6, 74);
  setCam(base.add(shake(t, .5 * Math.exp(-(b - 43) * 3) * (b > 43 ? 1 : 0))), br.clone().add(V3(0, -14 + 5 * u, 0)), 58, 0.03);
  return { look: 'dawn', build: .99, giant: 'standup', cabin: 2.2, cabCrew: true, crowdArm: 0 };
});
// ---- b44-46: she stands: the held shot from among the crowd, dawn against the light, the ground bank at her feet; the first fists
S(44, 46, (b, u) => {
  const br = BR();
  setCam(V3(lerp(-6, 4, u), 1.55, 90), br.clone().add(V3(0, -17 + 4 * u, 0)), 60, 0.01);
  return { look: 'dawn', build: .99, giant: 'standup', cabin: 2.0, cabCrew: true, crowdArm: clamp((b - 44.6) * 1.1) };
});
// ---- b46-47 UP!: the right foot lifts out
S(46, 47, (b, u) => {
  const f = FT('R');
  setCam(V3(f.x - 18, 2.2, f.z + 26), f.clone().add(V3(1, 5 + 4 * u, 0)), 52, -0.05);
  return { look: 'dawn', build: .99, giant: 'step', crowdArm: 1, cabCrew: true };
});
// ---- b47-48 UP!: the foot lands: dust from under the sole, clods thrown, the camera on the same ground takes the jolt
S(47, 48, (b, u) => {
  const f = FT('R');
  setCam(V3(STEP.to[0] + 16, 1.3, STEP.to[1] + 34), V3(STEP.to[0] + 1, 9, STEP.to[1] - 2), 50, -0.04);   // c20: from the open side, not through the cribs
  return { look: 'dawn', build: .99, giant: 'step', crowdArm: 1, cabCrew: true, shakeHits: true };
});
// ---- b48-50: dawn on the apron: her whole body over the crowd, the long shadow
S(48, 50, (b, u) => {
  const br = BR();
  setCam(V3(lerp(42, 24, eio(u)), 3.4, 116), br.clone().add(V3(0, -15, 0)), 50, 0.02);
  return { look: 'dawn', build: .99, giant: 'step', crowdArm: .7, cabCrew: true };
});
// ---- b50-56 AI CANNOT ALIGN ITSELF / AUTONOMOUSLY / OR GIVE ITSELF PURPOSE / OUTSIDE OF HUMAN INFLUENCE: the hands on the levers, the machine that
// follows them. The lever leads (the same stroke, a tenth of a beat ahead): the machine never moves first.
const FOLLOW = 0.12;
S(50, 51, (b, u) => {                                       // she bends for the sledge as the crowd takes up theirs
  const g = wrR();
  setCam(V3(g.x + 32, 4.5, g.z + 40 - 4 * u), g.clone().add(V3(-3, 4, 0)), 50, -0.03);
  return { look: 'morning', build: .99, giant: 'sledge', crowdSledge: eox(clamp((b - 50.6) / .4)), cabCrew: true };
});
S(51, 52, (b, u) => {                                       // the hands push the levers forward: the same stroke
  setCam(S0(-1.2 + .8 * u, 1.05, 2.5), S0(-.6, 1.2, .75), 40, -0.03);
  return { look: 'bridgeD', room: 'bridge', cab: { vis: 5, closeAt: 0, th: -.26 + .42 * eio(clamp((b - 50.9) / 0.9)) }, meter: 'crew' };
});
S(52, 53, (b, u) => {                                       // the sledge comes up
  const g = wrR();
  setCam(V3(g.x + 26, 2.2, g.z + 50), g.clone().add(V3(-2, 10 + 6 * u, 0)), 56, -0.04);
  return { look: 'morning', build: .99, giant: 'sledge', crowdSledge: 1, cabCrew: true };
});
S(53, 54, (b, u) => {                                       // the hands pull back: the levers come over the other way
  setCam(S0(-3.6 + .5 * u, .98, 1.5), S0(0.3, 1.15, .75), 34, 0.03);
  return { look: 'bridgeD', room: 'bridge', cab: { vis: 5, closeAt: 0, th: .16 - .16 * eio(clamp((b - 53) / 0.9)) }, meter: 'crew' };
});
S(54, 55, (b, u, t) => {                                    // it lands on the shoulder: the plating takes the weight, the camera takes the jolt
  const sh = jw('shR', [0, 0, 0]);
  setCam(V3(sh.x + 30, 9, sh.z + 38).add(shake(t, .6 * Math.exp(-(b - 54.4) * 4) * (b > 54.4 ? 1 : 0))), sh.clone().add(V3(-3, 3, 0)), 50, 0.03);
  return { look: 'morning', build: .99, giant: 'sledge', crowdSledge: 1, cabCrew: true };
});
S(55, 56, (b, u) => {                                       // the hands hold the levers steady; the glass full of the day (from behind them, between two shoulders)
  setCam(S0(-.85 + .15 * u, 2.0, -1.1), S0(-.4, .3, 4.4), 46, -0.02);
  return { look: 'bridgeD', room: 'bridge', cab: { vis: 5, closeAt: 0, th: 0 }, meter: 'crew' };
});
// ---- b56-58: from behind the crowd: the sledges onto shoulders; she stands beyond with hers on her shoulder
S(56, 58, (b, u) => {
  setCam(V3(-3, 1.65, 124 + 2 * u), V3(0, 27, 20), 50, 0);
  return { look: 'morning', build: .99, giant: 'sledge', crowdSledge: 1, cabCrew: true };
});
// ---- b58-66 Marx's steam-hammer line: four looks at the thing that cannot be wielded by one
S(58, 60.5, (b, u) => {                                     // AN ORDINARY HAMMER HEAD,: the head itself, on her shoulder against the sky
  const hd = acts.headWorld();
  setCam(hd.clone().add(V3(lerp(24, 17, u), -12, 24)), hd.clone(), 34, 0.04);
  return { look: 'morning', build: .99, giant: 'sledge', crowdSledge: 1 };
});
S(60.5, 62.5, (b, u) => {                                   // BUT OF SUCH A WEIGHT: her hand closed on the haft, from below
  const g = wrR();
  setCam(V3(g.x - 9 + 5 * u, 3.2, g.z + 32), g.clone().add(V3(2, -1, 0)), 40, -0.05);
  return { look: 'morning', build: .99, giant: 'sledge', crowdSledge: 1 };
});
S(62.5, 64.5, (b, u) => {                                   // THAT NOT THOR HIMSELF: wide and low behind the front rank: she swings it up and over
  setCam(V3(11, 1.35, 100 - 6 * u), V3(0, 28 + 6 * u, 20), 58, 0.02);
  return { look: 'morning', build: .99, giant: 'sledge', crowdSledge: 1 };
});
// c20: the front row is real people (the cast, from the person pipeline) between the lens and the crowd; nobody instanced stands near the lens
const ROW = (C, look = .45) => [['c0', -2.6, -4.6], ['c1', -1.2, -5.6], ['c4', .1, -4.3], ['c2', 1.4, -5.3], ['welder', 2.5, -4.4], ['c3', -.4, -6.6]]
  .map(([who, x, z], i) => { const p = V3(C.x + x, 0, C.z + z); return { who, pos: p, yaw: Math.atan2(-p.x * .4, -p.z) + .15 * Math.sin(i * 1.9), look: look + .06 * Math.sin(i * 1.3), turn: .1 * Math.sin(i * 2.7) }; });
S(64.5, 66, (b, u, t) => {                                  // COULD WIELD IT.: the head comes down onto the ground ahead of her; both hands on the haft's end
  const hd = acts.K.rest, head = V3(0, acts.ham.userData.headC.y, 0).applyQuaternion(hd.q).add(hd.b), br = BR(), C = V3(17 - 3 * u, 0, 92);
  setCam(C.clone().add(V3(0, 1.7, 0)), br.clone().lerp(head, .55).add(V3(0, 4, 0)), 54, -0.03);
  return { look: 'morning', build: .99, giant: 'sledge', crowdSledge: 1, shakeHits: true, stand: ROW(C), clear: 9 };
});
// ---- b66-72 (c20): no words. She holds, the hammer's head on the ground before her and both hands on the haft, over the crowd; the
// camera drifts in behind the front row while the resolved chord rings; the lockup comes at 72
S(66, 72, (b, u) => {
  const br = BR(), C = V3(lerp(12, 9, eio(u)), 0, lerp(94, 88, eio(u)));
  setCam(C.clone().add(V3(0, 1.65, 0)), br.clone().add(V3(0, lerp(-16, -12, eio(u)), 0)), lerp(52, 46, eio(u)), 0.01);
  return { look: 'morning', build: .99, giant: 'sledge', crowdSledge: 1, stand: ROW(C, .5), clear: 9, cabin: .8, cabCrew: true };
});

// ---- c3: the build shots that sat under the definition become the flashes cut into the Marx run (8 Oct remake: only under the handicraft and
// tool lines, never under the factory's)
const BUILD = {
  8: (b, u, t) => {                                         // the crews on the decks at work, arcs high on her chest: a camera on a deck
    setCam(V3(15, 10.2, 24 - 2 * u), V3(-3, 15 + 1.6 * u, 4), 54, 0.05);
    return { look: 'night', build: .78, giant: 'kneel', flood: 1, arcs: 1, lifts: true, trucksOn: 1 };
  },
  10: (b, u, t) => {                                        // up the left shin's lattice, red lead and black iron
    const f = FT('L');
    setCam(V3(f.x + 14 - 4 * u, 1.3, f.z + 20), V3(f.x - 2, lerp(8, 22, eo(u)), f.z - 4), 50, -0.05);
    return { look: 'night', build: .62, giant: 'kneel', flood: 1, arcs: 1, lifts: true };
  },
};
// c20: the sparks of the two arcs the shots place (the reveal's, the knee weld's)
sparks.stream({ t0: tKey(0), t1: tKey(2), rate: 150, pos: REV_ARC.toArray(), dir: [WELD_F.x * -.3, -.5, WELD_F.z * -.3], spread: 1.0, kind: 'weld', seed: 61, env: tt => (Math.sin(tt * 5.3) > -.5 ? 1 : 0) });
{ const W0 = KNEE_W(); sparks.stream({ t0: tKey(22), t1: tKey(23), rate: 170, pos: W0.arc.toArray(), dir: [.3, -.3, .5], spread: 1.1, kind: 'weld', seed: 62 }); }
const FLASH = [];   // c20: no flashes inside Ray's blow (the build events sit at b18-24 now, before the Marx run)
const shotFor = b => {
  for (const [f0, f1, k] of FLASH) if (b >= f0 && b < f1) return [f0, f1, (b_, u, t) => BUILD[k](b_, (b - f0) / (f1 - f0), t), 'flash' + k];
  for (const s of shots) if (b >= s[0] && b < s[1]) return s; return null; };

// ================================================================ applying a state
const WHO = w => w === 'welder' ? cast.welder : w === 'ray' ? cast.ray : /^c\d$/.test(w) ? cast.crew[+w[1]] : null;
const DRIVE = {};
// a rig's exposure offset (stops): everything the rig drives moves together (sun, disc, practicals); the sky and the environment are set absolutely
function setStops(rig, want) {
  const cur = rig._mStops || 0, d = want - cur;
  if (Math.abs(d) > 1e-4) { const k = 2 ** d; rig.exposure *= k; if (rig.sun) rig.sun.intensity *= k; if (rig.disc) rig.disc.material.color.multiplyScalar(k); for (const P of rig.practicals) P.setExposure(P.exposure * k); rig._mStops = want; }
  const kk = 2 ** want; scene.environmentIntensity = (rig.rec.sky?.envGain ?? 1) * kk; scene.backgroundIntensity = (rig.rec.sky?.backgroundGain ?? 1) * kk;
}
const parkHook = (c, out = 1) => c.setHook(c.g.position.clone().add(V3(out * 10, c.h - 6, 2)));
function applyShot(st, t, b) {
  const look = st.look || 'night', interior = !!st.room;
  LOOKNOW = st.dark ? 'dark' : look;
  // which sets are in the picture
  world.out.visible = st.room !== 'factory';
  E.g.visible = !interior && st.giant !== 'hide'; acts.ham.visible = E.g.visible || (st.room === 'bridge' && b < SL.reach);
  for (const c of world.hamCribs) c.visible = b < SL.grip + .4 || interior;
  bridge.g.visible = st.room === 'bridge'; bankC.visible = interior;
  factory.update(stroke(b), t, camera, st.room === 'factory');
  // the giant: build, pose, her cab and her plate
  const giantPose = st.giant || 'kneel';
  if (E.g.visible) {
    E.setBuild(st.build ?? .99);
    acts.pose(giantPose === 'kneel' ? 39 : b);
    if (st.markIn != null && E.markMesh) { E.markMesh.visible = true; E.markMesh.position.copy(E.markAt.p).add(V3(0, 14 * st.markIn, 3 * st.markIn)); } else if (E.markMesh) E.markMesh.position.copy(E.markAt.p);
    E.M.cab.emissiveIntensity = st.cabin ?? (look === 'night' ? 1.4 : .6);
    if (E.markMesh) E.markMesh.material.emissiveIntensity = st.mark || 0;
    E.update();
  } else if (st.room === 'bridge') { acts.pose(b < 46 ? 39 : b); }   // (her hammer keeps its place outside for the view)
  // the cranes: lifts on the hook at night; in daylight slewed away with their hooks parked up at the trolley
  const [c1, c2] = world.cranes;
  if (st.lifts) { const L = E.liftsAt(st.build ?? .9); const l1 = L.find(l => l.side < 0) || L[0], l2 = L.find(l => l.side > 0);
    if (l1) c1.setHook(l1.c.clone().add(V3(0, 2.5, 0))); else parkHook(c1); if (l2) c2.setHook(l2.c.clone().add(V3(0, 2.5, 0))); else parkHook(c2, -1); }
  else if (st.markIn != null && E.markMesh) { const m = E.markMesh.getWorldPosition(V3()); c1.setHook(m.clone().add(V3(0, 3.6, 0))); parkHook(c2, -1); }
  else { parkHook(c1); parkHook(c2, -1); }
  // trucks' lamps (one after another down the row), the hero tractor's
  const tOn = st.trucksOn ?? (look === 'night' ? 1 : 0);
  world.trucks.forEach((T0, i) => T0.setLamps(clamp(tOn * 12 - i)) );
  world.hero.setLamps(st.heroLamps ?? tOn);
  // the people: the cast (v7) where the shot puts them, the crowd in ranks
  cast.hideAll();
  if (st.cab) { const c = st.cab, th = levers.map((L, i) => (c.th || 0) * (0.86 + 0.14 * Math.sin(i * 2.1 + 1))); bankC.userData.setLevers(th); bankC.userData.setGauges(th.map(x => .35 + x * 1.2));
    cast.posConsole(c.vis ?? 5, th, k => handState(c, b, k)); }
  if (st.ray) { const ph = st.marx?.ph || 0; cast.poseRay(true, ((b + ph - SLEDGE_AT) % 4 + 4) % 4 * SPB); }
  if (st.welder) cast.poseWelder(st.welder.mode, st.welder);
  if (st.stand) for (const q of st.stand) cast.stand(WHO(q.who), q.pos, q.yaw, q);
  // the crews' tractor on the hook (TRUCKS,): the crane's hook at the spreader, the truck hanging under it
  HUNG.g.visible = !!st.hang;
  if (st.hang) { const hk = st.hang.hook; HUNG.g.rotation.y = st.hang.yaw; HUNG.g.position.set(0, 0, 0); HUNG.g.updateMatrixWorld(true);
    const w = V3(HUNG.cx, HUNG.hookY, 0).applyMatrix4(HUNG.T.matrixWorld); HUNG.g.position.copy(hk).sub(w); HUNG.g.updateMatrixWorld(true); HUNG.setLamps(1); }
  if (factory.g.visible) factory.ctl.userData.setLamps(k => (st.ctlLamps ? st.ctlLamps(Math.floor(k / 5), k % 5) : 0));
  if (st.hang) { const [c1] = world.cranes; c1.setHook(st.hang.hook.clone().add(V3(0, .3, 0))); }
  if (!interior) world.crowdUpdate({ ...st, look, decks: look === 'night' && !st.dark, apron: true, cabCrew: !!st.cabCrew && E.g.visible }, t, camera);
  else world.crowdUpdate({ apron: st.room === 'bridge', decks: false, cabCrew: false }, t, camera);
  RAY && (RAY.bar.material.emissiveIntensity = 26 * (st.hotbar ?? 0));
  // the light: the look's rig, its lamps driven for this shot, the movable key where the shot wants it, the exposure
  const rig = stage.use(look, scene);
  for (const k of Object.keys(DRIVE)) delete DRIVE[k];
  if (look === 'night' || look === 'blue') {
    const fm = st.flood ?? 1; world.towers.forEach((tw, i) => { DRIVE['tower' + i] = st.dark ? 0 : st.floodEach ? st.floodEach[i] : fm; });
    world.hps.forEach((h, i) => { DRIVE['hps' + i] = st.dark ? 0 : (st.hps ?? 1); });
    for (const n of ['workL', 'workR', 'workB']) DRIVE[n] = st.dark || look === 'blue' ? 0 : (st.work ?? 1);
    DRIVE.arc0 = DRIVE.arc1 = !st.dark && st.arcs ? 1 : 0;
    DRIVE.hotbar = st.hotbar ?? 0;
    DRIVE.key = !st.dark && st.key ? 1 : 0;
    const P = stage.practical('key', rig); if (P && st.key) movePractical(P, st.key.pos, st.key.aim);
    DRIVE.fill = !st.dark && st.fill ? 1 : 0;
    const F = stage.practical('fill', rig); if (F && st.fill) movePractical(F, st.fill.pos, st.fill.aim);
    // an arc where the shot puts it (the reveal, the weld at her knee): arc1 moved there, flickering as a stick arc does
    if (st.arcAt) { const A = stage.practical('arc1', rig); if (A) A._home ??= [A.pos.clone(), A.aim.clone()]; if (A) movePractical(A, st.arcAt, st.arcAt.clone().add(V3(0, -1, 0)));
      DRIVE.arc1 = st.arcFlicker ? .55 + .45 * Math.abs(Math.sin(t * 37.1) * Math.sin(t * 13.7 + 1.3)) + .25 * (Math.sin(t * 91) > .6 ? 1 : 0) : 1; }
    else { const A = stage.practical('arc1', rig); if (A && A._home) movePractical(A, A._home[0], A._home[1]); }
  }
  if (rig.sunOn) { const c = st.shadowAt || (interior ? SET : V3(0, 18, 24)); rig.center.copy(c); rig._placeSun(rig.sunDir); }
  setStops(rig, (st.ev ?? 0) + (st.meter && !st._noMeter ? (METER.get(st._mkey) ?? 0) : 0));
  // her stacks, the dust, the clods, the sparks
  K.update(t, camera, rig.sunDir || V3(0, 1, 0));
  sparkG.visible = !interior; sparks.update(t, camera, stage.lr.renderer);
  return rig;
}
// a hand on its lever: [approach (1 away .. 0 on), closure 0..1]; closeAt: the hands come in one after another from that beat
function handState(c, b, k) {
  if (c.closeAt) { const tb = c.closeAt + 0.08 * k; return [1 - smooth(tb - 0.35, tb, b), smooth(tb, tb + 0.28, b)]; }
  return [0, 1];
}
// faces exposed for faces (lane B's meter, through person/index.js): each shot meters its people ONCE, on its own first frame, so every
// farm worker that renders part of the shot gets the same exposure; clamped, so a bad read cannot blow a shot out
const METER = new Map();
function measure(st) {
  let stops = 0; if (stage.dry) return 0;
  try {
    const people = (st.meter === 'crew' ? cast.crew.slice(0, 5) : st.meter === 'ray' ? [cast.ray] : st.meter === 'welder' ? [cast.welder] : [WHO(st.meter)]).filter(Boolean);
    const rig = stage.active.rig; setStops(rig, st.ev ?? 0);
    const m = meterPeople(cast.st, { lr: stage.lr, scene, camera, rig, people, lens: {} });
    stops = clamp(m.stops || 0, -2.5, 2.5); m.undo?.();
  } catch (e) { console.log('mecha: meter failed', e.message); stops = 0; }
  return stops;
}

// ================================================================ render
window.renderFrame = async (tIn) => {
  const frame = Math.round(tIn * 30), tOut = tIn % DUR, oBeat = tOut / SPB + 1e-6;
  if (oBeat >= CUT_CLOSE) {
    const age = tOut - bt(CUT_CLOSE), tl = bt(CUT_CLOSE) - 1 / 30;
    const pbl = CUT ? cutToPlay(tl / SPB) : tl / SPB;
    await drawWorld(CUT ? bt(pbl) : tl, toKey(pbl), frame);
    const g = clamp((age - (LOCK_FRAMES - 8) / 30) / (8 / 30));           // the last 8 frames grade toward frame 0's night, so the loop closes on the dark
    if (g > 0) { ctx.fillStyle = `rgba(10,15,20,${0.8 * g})`; ctx.fillRect(0, 0, W, H); }
    return lockup(age);
  }
  const pbeat = CUT ? cutToPlay(oBeat) : oBeat, t = CUT ? bt(pbeat) : tOut, beat = toKey(pbeat);
  const st = await drawWorld(t, beat, frame);
  const c = CUES.find(c => beat >= c[0] && beat < c[3]);
  if (c && !st.noType) {
    const age = t - bt(toPlay(c[0])), up = c[1] === 'UP!';
    if (up) T.slam(c[1], age, frame, { emph: c[2], y: 600, cap: 300 });
    else T.slamBlock(c[1], age, frame, { emph: c[2], y: st.typeY ?? (c[0] === 0 ? 470 : 540), cap: c[1].length > 14 ? 122 : 146, title: false });
  }
};
async function drawWorld(t, beat, frame) {
  const sh = shotFor(beat), S0b = sh ? sh[0] : 0, S1b = sh ? sh[1] : 1;
  const fn = sh ? sh[2] : ((b, u) => { setCam(V3(26, 3, 118), V3(0, 22, 0), 46, 0); return { look: 'morning', giant: 'sledge' }; });
  const uu = clamp((beat - S0b) / (S1b - S0b));
  let st = fn(beat, uu, t) || {};
  const mkey = sh ? String(sh[3] || sh[0]) : 'x';
  if (st.meter && !METER.has(mkey)) { const b0 = S0b + 1e-3, t0 = t - (beat - b0) * SPB, s0 = fn(b0, 0, t0) || {};
    applyShot({ ...s0, _noMeter: true }, t0, b0); fn(b0, 0, t0); const v = measure(s0); METER.set(mkey, v); console.log('mecha: meter', mkey, v.toFixed(2));
    st = fn(beat, uu, t) || {}; }
  st._mkey = mkey;
  const rig = applyShot(st, t, beat);
  fn(beat, uu, t);                                               // again, so cameras that read joints see THIS frame's pose
  if (st.shakeHits) { applyShake(camera, shakeAt(t, K.hits, camera.position)); camera.updateMatrixWorld(); }
  const exterior = !st.room;
  stage.lr.render({ scene, camera, rig, t, medium: exterior ? med : null, drive: () => DRIVE,
    mirror: exterior && camera.position.y < 30 ? { y: .02, res: .5, tolerance: .12, streak: 1.4 } : undefined,
    ssr: { maxDist: exterior ? 50 : 8, thickness: exterior ? 1.2 : .25 },
    ao: exterior ? { radius: 1.8, intensity: 1.5 } : { radius: .5, intensity: 1.4 }, contactLen: exterior ? 1.0 : .25,
    lens: { focal: 28 } });
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(stage.glc, 0, 0, W, H);
  if (st.marx && !st.marx.noPrint) marxPrint();
  return st;
}
// the Marx run's print: red rules and the citation over MECHA's own picture
function marxPrint() {
  ctx.save(); ctx.fillStyle = '#C91F37'; ctx.fillRect(0, 150, W, 10); ctx.fillRect(0, H - 150, W, 10);
  ctx.fillStyle = '#F4E6D0'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = '700 32px "Chakra Petch"'; ctx.fillText('CAPITAL, VOL. I, CH. 15, §4', 60, H - 96);
  ctx.restore();
}
const tintImg = (img, col) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, c.width, c.height); return c; };
const LOCKS = { mark: tintImg(acpMarkImg, '#F4E6D0'), eq: tintImg(eqImg, '#F4E6D0'), slash: tintImg(slashImg, '#F4E6D0'), acc: tintImg(accImg, '#F4E6D0') };
function lockup(age) {
  const fade = 1, hL = 210, sc = hL / 291, wM = 300 * sc, wE = 220 * sc, wS = 119 * sc, wA = 517 * sc, total = wM + wE + wS + wA, x0 = W / 2 - total / 2, cy = 860;
  const k = Math.exp(-age * 10);
  ctx.save();
  const g = ctx.createRadialGradient(W / 2, cy, 50, W / 2, cy, 700); g.addColorStop(0, 'rgba(10,4,4,0.82)'); g.addColorStop(1, 'rgba(10,4,4,0)'); ctx.fillStyle = g; ctx.fillRect(0, cy - 700, W, 1400);
  const parts = [[LOCKS.mark, x0, wM, 0], [LOCKS.eq, x0 + wM, wE, 0.06], [LOCKS.slash, x0 + wM + wE, wS, 0.1], [LOCKS.acc, x0 + wM + wE + wS, wA, 0.14]];
  for (const [img, x, w, s0] of parts) { const p = eox(clamp((age - s0) / 0.2)); if (p <= 0) continue; ctx.globalAlpha = fade * p; const sz = 1 + 0.4 * k; ctx.drawImage(img, x + (1 - p) * 120, cy - hL / 2 * sz, w * sz, hL * sz); }
  const pu = eox(clamp((age - 0.3) / 0.2)); if (pu > 0) { ctx.globalAlpha = fade * pu; ctx.fillStyle = '#F4E6D0'; ctx.font = '76px "Archivo Black"'; ctx.textAlign = 'center'; ctx.lineWidth = 8; ctx.strokeStyle = '#120a0a'; ctx.strokeText('ACP.US', W / 2, 1170); ctx.fillText('ACP.US', W / 2, 1170); }
  ctx.restore();
}
void project; void rng; void lerp; void PLANTS; void SSS;
window.sceneInfo = { DUR, SPB, CLOSE };
window.__mecha = { camera, scene, world, acts, cast, SET, shotFor, toKey, toPlay, stage, factory, bridge, bankC };   // for inspection (the dry run, a lab)
lap('ready');
window.sceneReady = true;
