// AT REST: the frame (scenes/atrest.js makes the canvas and calls this; web/labs/objective/atrest_dry.mjs runs the plan and the frame logic in
// node against stubs). The plan is atrest.plan.js, the instrument lib/fx/objective/polariscope.js, the bench atrest.drop.js, the world
// atrest.world.js, the people atrest.cast.js, the words atrest.type.js.
// Each bench frame: the bench (bench.js: field, focus, the lens) -> the polariscope's image of the drop in sodium light (16 lens samples,
// the analyser per pixel when it slides, the quench or the crack front when they run) -> the powder spray after the burst -> the bench's
// props through LitRenderer (the jaws, the striker swinging under a 180-degree shutter, the mesh, the hand) with their exact coverage ->
// where the window panel has lifted, the world through the window in its own colour, out of focus by the bench's own blur -> the one
// display transform -> the words. The wide: LitRenderer at sunrise, the nine walking, the words and the mark.
import * as THREE from 'three';
import { W, H } from '../lib/kit.js';
import { LitRenderer } from '../lib/fx/light/pipeline.js';
import { LightRig } from '../lib/fx/light/rig.js';
import { PRESETS } from '../lib/fx/light/presets.js';
import { LIT, litPatchAll } from '../lib/fx/light/patch.js';
import { lottesParams } from '../lib/fx/light/display.js';
import { ensureSkinSSS } from '../lib/fx/person/index.js';
import { Bench } from '../lib/fx/objective/bench.js';
import { Polariscope } from '../lib/fx/objective/polariscope.js';
import { centreline, DROP } from '../lib/fx/objective/polariscope_ref.js';
import { glow as glowOf, K as kelvin, bandColour } from '../lib/fx/objective/spectral.js';
import * as P from './atrest.plan.js';
import { buildWorld, BENCH, dropToWorld } from './atrest.world.js';
import { buildBench, poseCamera, Coverage, Spray } from './atrest.drop.js';
import { Hand, Walkers } from './atrest.cast.js';
import { Ball, Slivers, Dust, roomEnv } from './atrest.ball.js';
import { Shards } from './atrest.fragments.js';
import { PROGRAMS } from './atrest.shaders.js';
import { loadType, drawWords, drawMark } from './atrest.type.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const quad = (frag, uniforms, o = {}) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const m = new THREE.Mesh(g, new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: PROGRAMS[frag].vert, fragmentShader: PROGRAMS[frag].frag, uniforms, depthTest: false, depthWrite: false, ...o }));
  m.frustumCulled = false; const s = new THREE.Scene(); s.add(m); return { mesh: m, scene: s, u: uniforms }; };
const ORTHO = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// LR / Rig: injected by the node dry run (web/labs/objective/atrest_dry.mjs) with stubs; the page uses light/'s own
export async function buildAtRest({ canvas = () => document.createElement('canvas'), log = m => console.log(m), LR = LitRenderer, Rig = LightRig, people = true } = {}) {
  await loadType();
  const glc = canvas(); glc.width = W; glc.height = H;
  const lr = new LR({ canvas: glc, width: W, height: H, quality: 'final' });
  const r = lr.renderer;
  // ---------------------------------------------------------------- the drop and its instrument
  const CL = centreline(); P.setCentreline(CL);
  const entry = (() => { for (const q of CL.pts) if (Math.hypot(...q.p) >= DROP.head) return { p: q.p, s: q.s }; return { p: [-2.9, 5.95, 0], s: 6.4 }; })();
  // globalThis.ATREST_PREVIEW (local stills only) lowers the instrument's cost without changing the farm path
  const PRE = globalThis.ATREST_PREVIEW || {};
  const pol = new Polariscope(r, { w: W, h: H, lensSamples: PRE.lensSamples ?? 16, steps: PRE.steps ?? 384 }).body({ CL }).stress({ sigmaS: -560e6 });
  const bench = new Bench({ focal: 0.100, fstop: 16, field: 26e-3 });
  // ---------------------------------------------------------------- the world: two lights, swapped in and out of one scene
  const world = new THREE.Scene(), Wd = buildWorld(); world.add(Wd.group);
  const rigRecs = {
    predawn: () => PRESETS.blueHour({ sky: { kind: 'clear', elevation: -5, azimuth: 90, turbidity: 3 }, camera: { ev100: 5.0 }, atmosphere: { density: 0.0025, height: 40, maxDist: 1500 }, practicals: Wd.lamps }),
    dawn: () => PRESETS.dawnContre({ sky: { kind: 'clear', elevation: 1.4, azimuth: 90, turbidity: 5.5, hazeH: 450, groundAlbedo: 0.12 }, sun: { center: [-25, 0, 4], extent: 45, shadowSize: 4096, softness: 4 },
      camera: { ev100: 12.0, wb: 5000 }, atmosphere: { density: 0.0011, height: 35, albedo: 0.92, g: 0.76, ambient: 0.6, maxDist: 1500 },
      practicals: Wd.lamps.map(l => ({ ...l, gain: 0.6 })) }),
  };
  const rigs = {}; let activeRig = null;
  const rigObjs = R => [R.sun, R.sun?.target, R.disc, ...R.practicals.map(p => p.group), ...(R.bounces || []).flatMap(b => [b.light, b.light.target])].filter(Boolean);
  function useRig(name) {
    if (activeRig?.name === name) return activeRig;
    if (activeRig) for (const o of rigObjs(activeRig)) world.remove(o);
    if (!rigs[name]) { const tmp = new THREE.Scene(); rigs[name] = new Rig(r, tmp, rigRecs[name]()); rigs[name].name = name; }
    const R = rigs[name]; for (const o of rigObjs(R)) world.add(o);
    world.background = R.skyTex; world.environment = R.env; world.backgroundIntensity = R.rec.sky?.backgroundGain ?? 1; world.environmentIntensity = R.rec.sky?.envGain ?? 1;
    Wd.setExposure(R.exposure); activeRig = R; return R;
  }
  // ---------------------------------------------------------------- the environment the drop sees: the world from the bench, pre-dawn, a cube
  const cubeRT = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  const cubeCam = new THREE.CubeCamera(0.5, 6000, cubeRT); cubeCam.position.set(...BENCH.pos); world.add(cubeCam);
  const pre = useRig('predawn'); pre.update(0);
  LIT.uLitOn.value = 0; cubeCam.update(r, world);
  // exposure: the open view's background (the sky along the bench's axis, filtered to the band) at a dim amber; read off the cube's +x face
  const toWorld = dropToWorld(THREE);
  // the sky's band radiance along the bench's axis (east, 8 degrees up), from the rig's own baked sky (pre-exposed like the cube): JS only
  let envGain = 1;
  { const sk = pre.sky, j0 = Math.round((0.5 + BENCH.pitch / Math.PI) * sk.H - 0.5), i0 = Math.round(sk.W / 2 - 0.5); let acc = 0, n = 0;
    for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 3; i <= i0 + 3; i++) { const k = (j * sk.W + i) * 4; acc += (0.68 * sk.data[k] + 0.32 * sk.data[k + 1]) * pre.exposure; n++; }
    const m = acc / n; envGain = m > 1e-9 ? 0.42 / m : 1; log(`atrest: the sky along the bench's axis ${m.toExponential(2)} (band, pre-exposed); gain ${envGain.toExponential(2)}`); }
  pol.environment(cubeRT.texture, { gain: envGain, lodBg: 6.5, lodDrop: 1.0, band: 1, toWorld, window: { x: 0, y: 0, z: -150, r: 150 } });
  pol.room({ dir: [0.62, 0.28, -0.73], radius: 0.06, L: 30 });
  // ---------------------------------------------------------------- the bench's solid things, their coverage, the spray
  const B = buildBench(lr, { head: DROP.head, Rig }), cov = new Coverage(r, W, H), spray = new Spray(r);
  const shards = new Shards(r, { lineAt: P.lineAt, entry, sEnter: P.S_ENTER, frontV: P.FRONT_V, filmAtTI: P.filmAtInstrument });
  // c20: the ball, the slivers, the dust; the room as the bench's mirrors see it (the striker and the ball were black on black in v1)
  const BL0 = P.BALL, ball = new Ball({ R: BL0.R }), slivers = new Slivers(P.BRK ? { n: 72, chunks: 9, brk: P.breakClock } : {});
  if (P.BRK) ball.mat.envMapIntensity = 1.6;                           // c22: more of the room in the ball (v2's face read dark)
  B.scene.add(ball.group, slivers.group); litPatchAll(B.scene);
  const envs = {};
  try { envs.room = roomEnv(r, {});
    const hc = BL0.contact.map(x => -x), hl = Math.hypot(...hc);
    envs.site = roomEnv(r, { head: { dir: hc.map(x => x / hl), ang: Math.atan(DROP.head / hl) }, tail: { tan: BL0.tan, ang: 0.42 } });
    B.scene.environment = envs.room; B.scene.environmentIntensity = 1; }
  catch (e) { log('atrest: room env not built (' + (e.message || e) + ')'); }
  const motes = new Dust(r, { n: 160, seed: 9, twinkle: 3, born: R => ({ p: [BL0.contact[0] + (R() - 0.5) * 30, BL0.contact[1] + (R() - 0.3) * 36, (R() - 0.5) * 6],
    v: [(R() - 0.5) * 0.3, (R() - 0.6) * 0.25, (R() - 0.5) * 0.2], size: 0.012 + 0.03 * R() ** 2, gain: 0.35 + 0.6 * R() }) });
  const grit = new Dust(r, { n: 700, seed: 13, fall: 0.6, life: 6, twinkle: 9, born: R => { const s = BL0.sA + (BL0.sB - BL0.sA) * R(), L = P.lineAt(s), a = R() * 6.283, rr = 0.2 + 0.5 * R();
    const n1 = [-L.t[1], L.t[0], 0], off = [n1[0] * Math.cos(a) * rr, n1[1] * Math.cos(a) * rr, Math.sin(a) * rr], sp = 0.4 + 3.2 * R() ** 2;
    return { p: [L.p[0] + off[0], L.p[1] + off[1], L.p[2] + off[2]], v: [off[0] / rr * sp + (R() - 0.5), off[1] / rr * sp - 1.4 * R(), off[2] / rr * sp], size: 0.015 + 0.05 * R() ** 3, gain: 0.5 + 1.2 * R() }; } });
  // the failure's own flash: the fresh fracture surfaces at the contact catch the lamp all at once, a spray of glints thrown out
  const flash = new Dust(r, { n: P.BRK ? 1100 : 420, seed: 21, twinkle: 14, born: R => { const a = R() * 6.283, b = Math.acos(2 * R() - 1), sp = P.BRK ? 2 + 13 * R() ** 2 : 2 + 9 * R() ** 2, dir = [Math.sin(b) * Math.cos(a), Math.sin(b) * Math.sin(a), Math.cos(b)];
    return { p: [BL0.contact[0] + dir[0] * 0.2, BL0.contact[1] - 0.3 + dir[1] * 0.2, BL0.contact[2] + dir[2] * 0.2], v: dir.map(x => x * sp), size: 0.02 + 0.06 * R() ** 2, gain: 0.8 + 1.6 * R() }; } });
  // the drop's centreline with knots at the break's two faces (so the gap is one segment); bent under the load; the far piece falls away
  const knots = (() => { const n = CL.pts.length - 1, L = CL.length ?? CL.pts[n].s, ks = Array.from({ length: n + 1 }, (_, i) => L * i / n), i = Math.round(BL0.sA / (L / n));
    ks[i] = BL0.sA; ks[i + 1] = BL0.sB; if (!(ks[i - 1] < BL0.sA && ks[i + 2] > BL0.sB)) log('atrest: the break knots overlap their neighbours'); return ks; })();
  // ---------------------------------------------------------------- the composite and the world layer
  const dp = lottesParams();
  const worldRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false }), lowRT = new THREE.WebGLRenderTarget(W / 4, H / 4, { type: THREE.HalfFloatType, depthBuffer: false }),
    lowRT2 = new THREE.WebGLRenderTarget(W / 4, H / 4, { type: THREE.HalfFloatType, depthBuffer: false }), propsRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false });
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;
  const C = quad('composite', { tDrop: { value: null }, tProps: { value: null }, tCov: { value: null }, tWorld: { value: black }, uRes: { value: new THREE.Vector2(W, H) },
    uDropGain: { value: 1 }, uPropsGain: { value: 1 }, uWorldGain: { value: 1 }, uPropsOn: { value: 1 }, uWorldOn: { value: 0 }, uGrain: { value: 0.012 }, uFrame: { value: 0 },
    uPanel: { value: new THREE.Vector4() }, uPanelR: { value: 50 }, uPanelOn: { value: 0 },
    uFlash: { value: new THREE.Vector4() }, uFlashCol: { value: (() => { const bc = bandColour(), mx = Math.max(...bc); return new THREE.Vector3(bc[0] / mx, bc[1] / mx, bc[2] / mx); })() },
    uWB: { value: new THREE.Matrix3() }, uCurve: { value: new THREE.Vector4(dp.a, dp.d, dp.b, dp.c) }, uPath: { value: new THREE.Vector4(dp.mid, dp.ps, dp.pr, dp.wd) }, uSatLook: { value: dp.sat } });
  const BL = quad('blur', { tIn: { value: null }, uTexel: { value: new THREE.Vector2() }, uR: { value: 0 } }), CP = quad('copy', { tIn: { value: null }, uK: { value: 1 } });
  const pass = (Q, target) => { r.setRenderTarget(target); r.render(Q.scene, ORTHO); };
  // ---------------------------------------------------------------- the people (lazy: only the segments that show them build them)
  let hand = null, handP = null, walkers = null, walkersP = null;
  const ensureHand = () => handP || (handP = (async () => { if (!people) return; try { hand = await new Hand().build({ log }); hand.plan({ log }); const L = P.lineAt(P.SITE_S);
    hand.place({ p: V(...L.p).multiplyScalar(1e-3), t: V(...L.t) }); B.scene.add(hand.P.h.group); await ensureSkinSSS(lr, B.scene).catch(e => log('atrest: skin SSS ' + e.message)); log('atrest: hand ' + JSON.stringify(hand.rep)); }
    catch (e) { log('atrest: THE HAND FAILED ' + (e.stack || e)); hand = null; } })());
  // c20: the walkers' materials patched for light/'s prepass (they were missing from it, so the depth-based passes saw through them: the
  // see-through figures and the rail drawn over the nearest walker in v1)
  const ensureWalkers = () => walkersP || (walkersP = (async () => { if (!people) return; try { walkers = await new Walkers().build(world, { log }); await ensureSkinSSS(lr, world).catch(e => log('atrest: skin SSS ' + e.message)); litPatchAll(world); }
    catch (e) { log('atrest: THE WALKERS FAILED ' + (e.stack || e)); walkers = null; } })());
  // ---------------------------------------------------------------- the camera for the wide and the window's view
  const wideCam = new THREE.PerspectiveCamera(P.WIDE.fovY, W / H, 0.1, 6000), winCam = new THREE.PerspectiveCamera(12, W / H, 0.5, 6000);
  const stats = { bench: 0, wide: 0, props: 0, world: 0 };
  // c20: the tail under the ball. Before the break it bends as a cantilever from the head (bendW); at the break the near side springs back
  // and the far piece, from its bent pose, tips about its broken face and drops away. Unloaded and whole: the original centreline.
  const baseCL = CL; let lastKey = 'base';
  function tailCL(t) {
    const ld = P.loadAt(t), I = t >= P.TL.snap;
    if (!I && ld <= 0) return null;
    const dmax = BL0.dmax, M = P.tipMotion(t);
    const piv = M ? [M.pivot[0], M.pivot[1] - P.bendW(BL0.sB, dmax), M.pivot[2]] : null, ca = M ? Math.cos(M.angle) : 1, sa = M ? Math.sin(M.angle) : 0;
    return { length: baseCL.length, pts: knots.map(s => { const q = P.lineAt(s).p.slice();
      if (!I) { q[1] -= P.bendW(s, dmax * ld); return { s, p: q }; }
      if (s <= BL0.sA + 1e-6) { q[1] -= P.bendW(s, dmax) * Math.exp(-(t - P.TL.snap) / 0.06); return { s, p: q }; }
      q[1] -= P.bendW(s, dmax); const dx = q[0] - piv[0], dy = q[1] - piv[1];
      return { s, p: [piv[0] + dx * ca - dy * sa + M.drift, piv[1] + dx * sa + dy * ca - M.drop, q[2]] }; }) };
  }

  // ================================================================ a bench frame
  async function benchFrame(t, S) {
    const Bp = P.benchAt(t); bench.setField(Bp.field * 1e-3);
    const pose = poseCamera(B.camera, Bp, bench);
    const isClose = S.id === 'close' || S.id === 'closeD';              // c22 d: the cut after the hit is the same moment from another side
    const an = P.analyserAt(t), anLevel = typeof an === 'number' ? an : an.amount(t, W / 2, H / 2);
    // ---- the instrument
    let dropTex = black;
    if (S.mode !== 'empty') {
      pol.camera(bench, { pos: pose.pos, target: Bp.target });
      pol.environment(cubeRT.texture, { gain: envGain * P.skyGain(t), lodBg: 6.5, lodDrop: 1.0, band: 1, toWorld });
      pol.analyser(an, t, 1);
      const I = P.instrumentAt(t);
      pol.fracture(I ? { tI: I.tI, sEnter: I.sEnter, v: P.FRONT_V, entry: entry.p, sHead: entry.s, ghost: I.ghost, width: 0.35, crack: 2.8, glitter: 1.4, depol: 4.2 } : null);
      // the front leaves a dissolving wake: the stress relaxes, then cells of glass let go behind it
      pol.dissolve(I ? (I.close ? { start: 0.6, span: 3.0, cell: 1.2 } : { start: 30.0, span: 8.0, cell: 1.45 }) : null);
      pol.strike(S.id === 'A' ? P.strikeAt(t) : null);
      pol.crackLight(I ? 0.9 : 0); pol.glitterScale(isClose ? 0.22 : 1);
      const tc = tailCL(t), key = tc ? 't' + t.toFixed(4) : 'base';
      if (key !== lastKey) { pol.body({ CL: tc || baseCL }); lastKey = key; }
      pol.gap(t >= P.TL.snap ? { sA: BL0.sA, sB: BL0.sB } : null);
      const ld = P.loadAt(t);
      pol.load(ld > 0 ? { at: [BL0.contact[0], BL0.contact[1] - BL0.dmax * ld, BL0.contact[2]], s: BL0.s, contact: 6000 * ld, bend: 60 * ld, a: 0.35 } : null);
      if (S.mode === 'tank') {
        const M = P.makingAt(t), g = glowOf(kelvin(M.Tc)), k = 0.22 * Math.pow(clamp((kelvin(M.Tc) - 800) / 520, 0, 2), 3);
        pol.formation({ freeze: M.freeze, glow: g.Y > 0 ? g.rgb.map(c => c * k) : null, tailMax: M.tailMax, taper: 4, offset: M.offset, nMed: 1.333, bubbles: P.bubblesAt(t) });
        // the blob falls during the shutter: each lens sample at its own time (motion blur), the offset moved per sample
        dropTex = renderBlurred(t, M);
      } else { pol.formation({ freeze: 1, glow: null, tailMax: 1e3, taper: 1, offset: [0, 0, 0], nMed: 1, bubbles: [] }); dropTex = pol.render(t, { frame: Math.round(t * 30) }); }
      if (I && I.real > 0) spray.render(pol.rt, pose, bench, I.real, { gain: 1.0 * P.skyGain(t), analyser: anLevel });
      // the motes hanging in the lamp's light round the site, and the grit of the break
      if (S.id === 'geo' || isClose) motes.render(pol.rt, pose, bench, t - P.TL.geo, { gain: 0.5 * P.skyGain(t), analyser: anLevel });
      if (isClose && t >= P.TL.snap) { const u = t - P.TL.snap, uc = P.breakClock(u);   // c22: the grit and the glints on the break's clock
        grit.render(pol.rt, pose, bench, uc, { gain: (P.BRK ? 2.2 : 1.4) * P.skyGain(t), analyser: anLevel });
        flash.render(pol.rt, pose, bench, uc, { gain: (P.BRK ? 7.0 : 4.5) * P.skyGain(t) * Math.exp(-u / 0.45), analyser: anLevel }); }   // c21: the flash bigger and longer
      if (S.id === 'hs' || S.mode === 'empty') shards.render(pol.rt, pose, bench, t, { gain: 0.36 * P.skyGain(t), analyser: anLevel, env: cubeRT.texture, toWorld });
      dropTex = pol.rt.texture;
    } else {
      // the empty jaws: the last of the powder settles through them (the burst's fine dust, still in real time)
      const Ie = P.instrumentAt(t);
      const prev = r.getRenderTarget(); r.setRenderTarget(pol.rt); r.setClearColor(0x000000, 0); r.clear(true, false, false); r.setRenderTarget(prev);
      if (Ie && Ie.real > 0) spray.render(pol.rt, pose, bench, Ie.real, { gain: 1.0 * P.skyGain(t), analyser: anLevel });
      // Keep released shards visible through the empty-jaws shot while the remaining spray settles.
      shards.render(pol.rt, pose, bench, t, { gain: 0.36 * P.skyGain(t), analyser: anLevel, env: cubeRT.texture, toWorld });
      dropTex = pol.rt.texture;
    }
    // ---- the props (jaws, striker, mesh, hand)
    B.jaws.visible = S.mode !== 'tank'; B.mesh.visible = S.mode === 'tank';
    const ballOn = S.id === 'geo' || isClose;
    ball.set(ballOn ? P.ballAt(t) : null);
    slivers.set(isClose && t >= P.TL.snap ? t - P.TL.snap : null, P.lineAt, BL0.sA, BL0.sB);
    if (envs.room) B.scene.environment = ballOn ? envs.site : envs.room;
    const Hh = P.handAt(t);
    if (Hh && (S.id === 'site' || S.id === 'snap')) { await ensureHand(); if (hand) hand.pose({ enter: Hh.enter, close: Hh.close, visible: true }); }
    else if (hand) hand.pose({ visible: false });
    const rack = S.mode === 'empty' ? P.rackAt(t) : 0;
    const focus = rack > 0 ? 1 / (1 / bench.u * (1 - rack) + rack / 50) : bench.u;
    const lens = { focus, fstop: bench.fstop, focal: bench.focal * 1e3, bloom: 0, halation: 0, vignette: 0, grain: 0 };
    const upd = tk => { B.setStriker(tk, S.id); };
    const Kp = S.mode === 'empty' ? 16 : 12;
    B.rig.update(t);
    lr.render({ scene: B.scene, camera: B.camera, rig: B.rig, t, K: Kp, lens, update: upd, noSSO: true, shutter: 1 / 60, post: { bloom: 0, halation: 0, vignette: 0, grain: 0 } });
    CP.u.tIn.value = lr.acc.texture; CP.u.uK.value = 1; pass(CP, propsRT);
    const covTex = cov.render(B.scene, B.camera, { K: Kp, lens, shutter: 1 / 60, t, update: upd });
    stats.props++;
    // ---- the world through the window (the panel lifts): LitRenderer at sunrise from the bench, then the lens's blur for infinity
    let worldOn = false;
    if (S.mode === 'empty' && t >= P.TL.panel - 0.05) {
      useRig('dawn');
      winCam.position.set(...BENCH.pos);
      const dir = V(Math.cos(BENCH.pitch), Math.sin(BENCH.pitch), 0); winCam.up.set(0, 1, 0); winCam.lookAt(V(...BENCH.pos).add(dir)); winCam.fov = bench.fovY(); winCam.updateProjectionMatrix();
      lr.render({ scene: world, camera: winCam, rig: activeRig, t, K: 3, lens: {}, ao: { radius: 1.6, intensity: 1.4 }, contactLen: 0.6 });
      CP.u.tIn.value = lr.acc.texture; CP.u.uK.value = 1; pass(CP, worldRT);
      // the blur circle of the world (at infinity) for the current focus, as a disc at quarter resolution
      const cocInf = (() => { const b2 = new Bench({ focal: bench.focal, fstop: bench.fstop, field: bench.field }); b2.focusTo(focus); return b2.cocPx(1e5); })();
      CP.u.tIn.value = worldRT.texture; pass(CP, lowRT);
      BL.u.tIn.value = lowRT.texture; BL.u.uTexel.value.set(4 / W, 4 / H); BL.u.uR.value = cocInf / 2 / 4; pass(BL, lowRT2);
      worldOn = true; stats.world++;
    }
    // ---- composite and display
    const U = C.u; U.tDrop.value = dropTex; U.tProps.value = propsRT.texture; U.tCov.value = covTex; U.tWorld.value = worldOn ? lowRT2.texture : black;
    U.uPropsGain.value = 0.5 * anLevel + (1 - anLevel); U.uPropsOn.value = 1; U.uWorldOn.value = 0; U.uFrame.value = Math.round(t * 30);
    if (worldOn) { const pb = bench.cocPx(bench.u + 0.150), sl = P.panelSlide(pb), u = sl.uniform(t); U.uPanel.value.set(u[0], u[1], u[2], u[3]); U.uPanelR.value = u[4]; U.uPanelOn.value = 1; U.uWorldGain.value = 0.5 * anLevel + (1 - anLevel); }
    else U.uPanelOn.value = 0;
    // c22: the flash off the fresh faces at the contact, on the hit
    // the strike's contact flash (one blow) and the break's flash off the fresh faces: both are the same composite glow
    let fl = isClose ? P.flashAt(t) : 0, fAt = BL0.contact, fR = 260;
    if (S.id === 'A') { const fi = P.impactFlashAt(t); if (fi > fl) { fl = fi; fAt = P.CONTACT_N.map(x => x * DROP.head); fR = 150; } }
    if (fl > 0.002) { const q = V(...fAt).multiplyScalar(1e-3).project(B.camera); U.uFlash.value.set((q.x * 0.5 + 0.5) * W, (q.y * 0.5 + 0.5) * H, fl, fR); }
    else U.uFlash.value.set(0, 0, 0, 1);
    r.setRenderTarget(null); r.setViewport(0, 0, W, H); r.render(C.scene, ORTHO);
    stats.bench++;
  }
  // the falling blob: K lens samples each at its own time inside the shutter (the offset follows the fall)
  function renderBlurred(t, M) {
    const K = pol.K, rr = r, prev = rr.getRenderTarget(), ac = rr.autoClear;
    rr.setRenderTarget(pol.rt); rr.setClearColor(0x000000, 0); rr.clear(true, false, false); rr.autoClear = false; pol.U.uW.value = 1 / K;
    const halton = (i, b) => { let f = 1, q = 0; while (i > 0) { f /= b; q += f * (i % b); i = Math.floor(i / b); } return q; };
    for (let k = 0; k < K; k++) { const tk = t - (1 / 60) * (1 - (k + 0.5) / K), Mk = P.makingAt(tk); pol.U.uOffset.value.set(...Mk.offset);
      const i = k + 1 + (Math.round(t * 30) % 7) * K, a = 2 * Math.PI * halton(i, 2), rad = Math.sqrt(halton(i, 3));
      pol.U.uSample.value.set(halton(i, 5) - 0.5, halton(i, 7) - 0.5, rad * Math.cos(a), rad * Math.sin(a)); rr.render(pol.scene, pol.cam); }
    rr.setRenderTarget(prev); rr.autoClear = ac; void M; return pol.rt.texture;
  }

  // ================================================================ the wide: sunrise, the nine walking in
  async function wideFrame(t) {
    await ensureWalkers();
    const R = useRig('dawn'); const w = P.wideAt(t);
    wideCam.position.set(...P.WIDE.pos); wideCam.up.set(0, 1, 0); wideCam.lookAt(V(...P.WIDE.look));
    wideCam.fov = 2 * Math.atan(Math.tan(P.WIDE.fovY * Math.PI / 360) / w.zoom) * 180 / Math.PI; wideCam.updateProjectionMatrix();
    if (walkers) walkers.pose(t - P.TL.wide);
    lr.render({ scene: world, camera: wideCam, rig: R, t, K: 6, lens: { focal: 35, fstop: 5.6, focus: 14 }, ao: { radius: 1.6, intensity: 1.5 }, contactLen: 0.8, shutter: 1 / 60 });
    stats.wide++;
  }

  // ================================================================ one frame: the picture, then the words over it
  async function frame(t, out) {
    const S = P.shotAt(t);
    if (S.mode === 'wide') await wideFrame(t); else await benchFrame(t, S);
    if (out) {
      out.globalAlpha = 1; out.globalCompositeOperation = 'source-over'; out.fillStyle = '#000'; out.fillRect(0, 0, W, H); out.drawImage(glc, 0, 0, W, H);
      let under = null;
      if (t >= P.MARK.t0) { try { const d = out.getImageData(W / 2 - 80, P.MARK.y - 80, 160, 160).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; under = s / (d.length / 4) / 255; } catch (e) { under = null; } }
      drawWords(out, t); drawMark(out, t, under);
    }
    return { shot: S.id };
  }
  return { frame, pol, bench, B, world, Wd, stats, lr, useRig, ensureHand, ensureWalkers, shards, get hand() { return hand; }, get walkers() { return walkers; } };
}
