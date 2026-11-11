// MECHA PROLETARIAT (8 Oct, the asset remake): the light. The piece goes through light/ (LitRenderer + LightRig: physical units,
// one display transform, its own lens grain) instead of a bare WebGLRenderer with a white point "flash" and a canvas grain on top.
// One light record per look, every source a practical that is in the world:
//   night     sodium night: the flood towers on the giant, HPS cut-offs that make pools on the haul road, work lamps hung in the
//             scaffold (the warm night-build glow), arcs on the decks, one movable work light the shot puts where a gaffer would,
//             the hot bar on Ray's anvil (the blow's light). The brownout is this rig with every lamp out.
//   blue      blue hour for the first UP!s: the sky the only source, the yard's lamps still on
//   dawn      dawn against the light (contre-jour) for the reveal: a bright hazy sky, a true black on her shadow side
//   morning   a low sun raking across her from the side for the AI lines and the hammer
//   bridgeN   the crew's bridge at night: fluorescent battens over the console, the yard's floods beyond the glass
//   bridgeD   the bridge by day: the low sun in through the glass on the crew's faces
//   factory   someone else's plant: rows of mercury high-bays, cold, going back into the hall
// White balance per look (4100 K at night keeps sodium orange; 5200-5600 K by day); no material is recoloured per look.
import * as THREE from 'three';
import { LitRenderer } from '../lib/fx/light/pipeline.js';
import { LightRig } from '../lib/fx/light/rig.js';
import { PRESETS } from '../lib/fx/light/presets.js';
import { Practical } from '../lib/fx/light/practicals.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
// a practical moved to a new place (pos, aim): the light, its target and its fixture together
export function movePractical(P, pos, aim) {
  P.pos.copy(pos); P.aim.copy(aim); P.light.position.copy(pos); if (P.light.target) { P.light.target.position.copy(aim); P.light.target.updateMatrixWorld(); }
  if (P.head) { P.head.position.copy(pos); P.head.quaternion.setFromUnitVectors(V3(0, -1, 0), aim.clone().sub(pos).normalize()); }
}

export class Stage {
  constructor({ W, H, scale = 1, quality = 'clip' }) {
    this.glc = document.createElement('canvas'); this.glc.width = Math.round(W * scale); this.glc.height = Math.round(H * scale);
    // (a dry run in node, globalThis.MECHA_DRY: the scene's logic without GL; nothing is drawn)
    this.dry = !!globalThis.MECHA_DRY;
    this.lr = this.dry ? { renderer: null, W, H, q: { K: 1 }, render: () => ({ ms: 0 }), sync() {} } : new LitRenderer({ canvas: this.glc, width: W, height: H, quality, scale });
    this.recs = {}; this.rigs = {}; this.active = null; this.W = W; this.H = H;
  }
  define(name, fn) { this.recs[name] = fn; }
  // the rig's sun, disc and practicals go into the scene only while the rig is in use (built in a scratch scene first)
  use(name, scene) {
    if (this.active && this.active.name === name) return this.active.rig;
    if (this.active) for (const o of this.objs(this.active.rig)) scene.remove(o);
    if (!this.rigs[name]) { const tmp = new THREE.Scene(), rec = this.recs[name](); this.rigs[name] = this.dry ? dryRig(rec) : new LightRig(this.lr.renderer, tmp, rec); this.rigs[name].name = name; }
    const r = this.rigs[name]; for (const o of this.objs(r)) scene.add(o);
    scene.background = r.skyTex; scene.environment = r.env; scene.backgroundIntensity = r.rec.sky?.backgroundGain ?? 1; scene.environmentIntensity = r.rec.sky?.envGain ?? 1;
    this.active = { name, rig: r }; return r;
  }
  objs(r) { return [r.sun, r.sun?.target, r.disc, ...r.practicals.map(p => p.group), ...(r.bounces || []).flatMap(b => [b.light, b.light.target])].filter(Boolean); }
  practical(name, rig = this.active?.rig) { return rig?.practicals.find(p => p.spec.name === name) || null; }
}

// the dry run's rig: the record's practicals (their lights and fixtures), no sky bake
function dryRig(rec) { const practicals = (rec.practicals || []).map(p => new Practical(p, 1)); return { rec, practicals, bounces: [], sun: null, disc: null, sunOn: false, sunDir: V3(0, 1, 0), center: V3(), _placeSun() {}, exposure: 1, skyTex: null, env: null, update() {} }; }

// ------------------------------------------------------------------ the records (where the lamps are is the world's business)
export function defineLooks(stage, W, SET) {
  const towers = W.towers, hps = W.hps;
  const yardLamps = ({ shadows = true, keyOn = true } = {}) => [
    // the flood towers: banks of metal-halide floods on the giant (two of them throw shadows and beams)
    ...towers.map((t, i) => ({ kind: 'metalHalide', name: 'tower' + i, pos: [t.head.x, t.head.y, t.head.z], aim: [0, 16, 4], gain: 5.5, half: .42, head: 'none', shadow: shadows && i < 2, shadowSize: 2048, near: 6, far: 160, volume: i < 2, volGain: .6, bounce: false })),
    // the haul road's HPS cut-offs: pools with an edge
    ...hps.map((h, i) => ({ kind: 'hpsCutoff', name: 'hps' + i, pos: h.pos.toArray(), aim: h.aim.toArray(), shadow: false, volume: i === 1, volGain: .8, bounce: false })),
    // work lamps hung in the scaffold: the warm glow of the night build (halogen, 3000 K)
    { kind: 'work', name: 'workL', color: 3000, lumens: 26000, pos: [19.6, 12, 4], aim: [5, 10, 6], shadow: false, volume: true, volGain: .5, bounce: false },
    { kind: 'work', name: 'workR', color: 3000, lumens: 26000, pos: [-19.6, 21, 0], aim: [-4, 20, 6], shadow: false, volume: false, bounce: false },
    { kind: 'work', name: 'workB', color: 3000, lumens: 30000, pos: [0, 34, -16.5], aim: [0, 30, 6], shadow: false, volume: false, bounce: false },
    // arcs on the decks (welding on her chest and her knee), and the movable key the shot places
    { kind: 'arc', name: 'arc0', pos: [4.5, 30.5, 8.5], aim: [4.5, 29, 6], shadow: false, volume: false, gain: .6, bounce: false },
    { kind: 'arc', name: 'arc1', pos: [-6.5, 9.5, 7], aim: [-6.5, 8, 4], shadow: false, volume: false, gain: .6, bounce: false },
    { kind: 'work', name: 'key', color: 3200, lumens: 14000, pos: [0, 6, 30], aim: [0, 1, 0], shadow: true, contact: true, shadowSize: 2048, near: .3, far: 60, volume: true, volGain: .35, on: keyOn ? 1 : 0, bounce: false },
    // c20: a soft fill the shot places opposite the key (faces read as skin, not wax, in the night's single-source light)
    { kind: 'work', name: 'fill', color: 3600, lumens: 3200, pos: [0, 3, 30], aim: [0, 1.5, 0], shadow: false, volume: false, on: 0, bounce: false },
    // the hot bar on Ray's anvil: a Planck source the size of the bar (it lights his face and hands from below)
    { kind: 'point', name: 'hotbar', color: 1700, cd: 32, size: .1, pos: [W.SHOP.x, .9, W.SHOP.z], shadow: false, volume: false, head: 'none', bounce: false },
  ];
  const sunBox = (c, ext, size = 4096) => ({ center: c, extent: ext, shadowSize: size, softness: 2 });
  stage.define('night', () => PRESETS.sodiumNight({ camera: { ev100: 5.2, wb: 4100 }, atmosphere: { density: .0022, height: 18, maxDist: 260, albedo: .95, g: .76 }, practicals: yardLamps(), bounce: { albedo: .25, n5: false } }));
  stage.define('blue', () => PRESETS.blueHour({ sky: { elevation: -4, azimuth: 8, turbidity: 3 }, camera: { ev100: 6.6, wb: 4700 }, atmosphere: { density: .0028, height: 24, maxDist: 400 }, practicals: yardLamps({ keyOn: false }) }));
  stage.define('dawn', () => PRESETS.dawnContre({ sky: { elevation: 3.6, azimuth: 14, turbidity: 6 }, sun: sunBox([0, 22, 24], 110), camera: { ev100: 12.4, wb: 5200 }, atmosphere: { density: .00055, height: 34, maxDist: 900 } }));
  stage.define('morning', () => PRESETS.goldenHour({ sky: { elevation: 10.5, azimuth: 102, turbidity: 3.6 }, sun: sunBox([0, 20, 40], 130), camera: { ev100: 13.0, wb: 5500 }, atmosphere: { density: .0009, height: 40, maxDist: 1200, g: .7 } }));
  // the crew's bridge (SET: the console's origin; the crew face +z, the glass at z + 3.3)
  const S = SET, battens = [-3.2, 0, 3.2].map((x, i) => ({ kind: 'fluorescent', name: 'batten' + i, color: 3500, pos: [S.x + x, S.y + 3.05, S.z + .5], aim: [S.x + x, S.y, S.z + .5], shadow: i === 1, shadowSize: 1024, near: .1, far: 12, contact: i === 1, gain: 1.0 }));
  stage.define('bridgeN', () => PRESETS.sodiumNight({ camera: { ev100: 7.2, wb: 4100 }, atmosphere: { density: .0018, height: 18, maxDist: 260 }, practicals: [...battens,
    { kind: 'work', name: 'fill', color: 3400, lumens: 2400, pos: [S.x + .5, S.y + 2.0, S.z + 3.0], aim: [S.x, S.y + 1.5, S.z + .4], shadow: false, volume: false, bounce: false },
    { kind: 'point', name: 'console', color: 2800, lumens: 400, pos: [S.x, S.y + .7, S.z + 1.2], shadow: false, volume: false, bounce: false },
    ...towers.slice(0, 2).map((t, i) => ({ kind: 'metalHalide', name: 'tower' + i, pos: [t.head.x, t.head.y, t.head.z], aim: [0, 6, 50], gain: 5.5, half: .5, head: 'none', shadow: false, volume: false, bounce: false })),
    ...hps.slice(0, 4).map((h, i) => ({ kind: 'hpsCutoff', name: 'hps' + i, pos: h.pos.toArray(), aim: h.aim.toArray(), shadow: false, volume: false, bounce: false }))], bounce: { albedo: .3, n5: false } }));
  stage.define('bridgeD', () => PRESETS.goldenHour({ sky: { elevation: 9, azimuth: 158, turbidity: 3.4 }, sun: sunBox([S.x, S.y + 1, S.z + 1], 9, 2048), camera: { ev100: 11.6, wb: 5400 }, atmosphere: { density: .0009, height: 60, maxDist: 900 },
    practicals: battens.map(b => ({ ...b, gain: .35, shadow: false, contact: false })) }));
  // the factory hall (FACT: its floor origin at the near station; the line runs to -x)
  stage.define('factory', () => PRESETS.mercuryYard({ camera: { ev100: 6.2, wb: 5200 }, atmosphere: { density: .012, height: 9, base: S.y, maxDist: 160, g: .55 },
    practicals: [...Array.from({ length: 8 }, (_, i) => ({ kind: 'mercury', name: 'bay' + i, pos: [S.x + 1.2 - i * 9.5, S.y + 9.2, S.z + .2], aim: [S.x + 1.2 - i * 9.5, S.y, S.z + .2], half: .95, shadow: i < 2, shadowSize: 1024, near: .5, far: 30, contact: i === 0, volume: i < 4, volGain: .7, bounce: i < 2 })),
      { kind: 'work', name: 'fill', color: 4600, lumens: 2600, pos: [S.x + .5, S.y + 2.3, S.z + 3.6], aim: [S.x - 1, S.y + 1.5, S.z + .4], shadow: false, volume: false, bounce: false },   // c20: their faces need a key even in the cold hall
      { kind: 'mercury', name: 'bayB', pos: [S.x - 4, S.y + 9.2, S.z - 9], aim: [S.x - 4, S.y, S.z - 9], half: .95, shadow: false, volume: false, bounce: false }], bounce: { albedo: .25, n5: false } }));
}
