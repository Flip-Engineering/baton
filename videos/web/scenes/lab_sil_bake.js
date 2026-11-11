// SIL BAKE (HUMAN studio, cycle 3): the silhouette library. people.js bodies (mocap-proportioned rig, trade clothes,
// builds) wearing DESIGNED headwear (headwear.js), in 20 poses each (stands, the fist glyphs of gesture.js, tools on
// the shoulder, the flag-pole grip, an 8-phase walk), rendered orthographic from behind and packed into one atlas:
//   R  rim: the crescent where the form turns toward a backlight (FigurePass.rim; the sun ahead of the crowd)
//   G  key: N.L of a key from the camera's upper left (the lit / print tone of a cut-out; Klaus: light painted on 2D)
//   B  accent: the head, the hat and a raised fist (what prints as the black accent over a rank's tint)
//   A  coverage
// + a JSON of every cell: type, pose, yaw, foot, head, hands, raised fist, pole grips. web/sil_bake.mjs saves both
// to web/assets/sil/. lib/fx/sil.js reads them; lib/fx/ranks.js builds crowds from them.
import * as THREE from 'three';
import { People } from '../lib/fx/people.js';
import { fpPatchScene, FigurePass } from '../lib/fx/figure_pass.js';
import { attachHeadwear } from '../lib/fx/headwear.js';

const Q = new URLSearchParams(location.search);
export const CW = 144, CH = 320, PPM = 130, FOOT = CH - 16;        // cell px, px per metre, the foot line in the cell
const COLS = 24;
const TAU = Math.PI * 2;
const rng = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// ---------------------------------------------------------------- the 36 designed types
// [headwear | 'bare:<hairStyle>', trade, fem, heavy, height, hat colour]
const T = [
  ['hard', 'steel', 0, 0.35, 1.80, '#d8d2c4'], ['hard', 'steel', 0, 0.75, 1.76, '#e0b820'], ['hard', 'weld', 0, 0.2, 1.86, '#c85a14'], ['hard', 'steel', 1, 0.2, 1.66, '#e8e4dc'],
  ['hard', 'overalls', 0, 0.5, 1.74, '#2a4a9a'], ['hard', 'steel', 0, 0.9, 1.82, '#d8d2c4'],
  ['flatcap', 'rail', 0, 0.4, 1.78, '#2a2622'], ['flatcap', 'overalls', 0, 0.6, 1.72, '#3a3228'], ['flatcap', 'farm', 0, 0.15, 1.84, '#2c2c30'], ['flatcap', 'rail', 0, 0.8, 1.75, '#4a3a2a'],
  ['flatcap', 'weld', 0, 0.3, 1.70, '#1e1e1e'],
  ['cap', 'farm', 0, 0.45, 1.79, '#6a1414'], ['cap', 'overalls', 0, 0.7, 1.74, '#1c2a4a'], ['cap', 'farm', 1, 0.3, 1.63, '#2a3a2a'], ['cap', 'steel', 0, 0.25, 1.88, '#c8c0b0'],
  ['knit', 'weld', 0, 0.55, 1.77, '#6a1414'], ['knit', 'steel', 0, 0.3, 1.83, '#1c1c1c'], ['knit', 'farm', 1, 0.25, 1.65, '#3a3a44'], ['knit', 'rail', 0, 0.85, 1.73, '#5a4a30'],
  ['knit', 'overalls', 0, 0.1, 1.81, '#8a1c1c'],
  ['fedora', 'rail', 0, 0.35, 1.80, '#2a2420'], ['fedora', 'rail', 0, 0.65, 1.74, '#3a3a3c'], ['fedora', 'farm', 0, 0.2, 1.86, '#4a3a2a'],
  ['hood', 'farm', 0, 0.5, 1.78, '#3a3a40'], ['hood', 'weld', 0, 0.3, 1.82, '#2a2a2a'], ['hood', 'overalls', 1, 0.35, 1.66, '#6a4a2a'],
  ['scarf', 'overalls', 1, 0.3, 1.64, '#8a1c1c'], ['scarf', 'farm', 1, 0.55, 1.62, '#2a3a5a'], ['scarf', 'rail', 1, 0.2, 1.68, '#c8b89a'],
  ['ushanka', 'rail', 0, 0.6, 1.80, '#2a2018'], ['ushanka', 'weld', 0, 0.35, 1.84, '#3a3026'],
  ['bare:1', 'weld', 0, 0.5, 1.79, null], ['bare:0', 'overalls', 0, 0.85, 1.76, null], ['bare:1', 'farm', 0, 0.2, 1.90, null], ['bare:3', 'overalls', 1, 0.3, 1.63, null],
  ['bare:2', 'farm', 1, 0.45, 1.67, null],
];
export const SIL_TYPES = T.map(([hw, trade, fem, heavy, h, hc], i) => ({ i, hw, trade, fem, heavy, h, hc }));
// poses: fist glyphs are gesture.js glyphs (bent elbow, vertical forearm, fist beside or above the head: safe by rule)
const POSES = [
  { name: 'standA', act: 'stand', t: 0.5 }, { name: 'standB', act: 'stand', t: 6.3 },
  { name: 'rise', g: 'PUMP', p: 0, w: 0.45 }, { name: 'pumpLo', g: 'PUMP', p: 0 }, { name: 'pumpHi', g: 'PUMP', p: 1 },
  { name: 'rotfront', g: 'ROTFRONT' }, { name: 'overhead', g: 'OVERHEAD' },
  { name: 'sledge', g: 'SHOULDER_TOOL', tool: 'sledge' }, { name: 'shovel', g: 'SHOULDER_TOOL', tool: 'shovel' }, { name: 'pole', pole: true },
  ...Array.from({ length: 8 }, (_, k) => ({ name: 'walk' + k, act: 'walk', ph: k / 8 * TAU })),
  { name: 'heave', act: 'stand', t: 2, lean: 0.35 }, { name: 'standC', act: 'stand', t: 11.7, look: 0.5 },
];
// HUMAN c4: ?view=side bakes the PROFILE atlas (web/assets/sil/sil_side_atlas.*) for Deineka registers that march across
// the frame (The Defence of Petrograd): a 16-phase walk, marching fists (PUMP / OVERHEAD on the walk), flag carriers on
// the walk and a forward lunge. Figures face +x; flip for the other direction. The back atlas is unchanged.
const SIDE = Q.get('view') === 'side';
// The walk is REAL motion: CMU walkers (08_01, 35_01, 16_15, 07_01, 05_01, 02_01) retargeted
// through bvh.js, sampled at 16 phases of each take's most loopable stride (people.js's procedural walk kicks the
// swing shin flat along the ground when seen in profile). Raised fists turn the chest 35 degrees to the lens so the
// arm reads beside the head (in pure profile a PUMP forearm reads as a candle on the head). No forward arm is baked.
const POSES_SIDE = [
  ...Array.from({ length: 16 }, (_, k) => ({ name: 'walk' + k, act: 'clip', u: k / 16 })),
  ...[0, 4, 8, 12].map((k, j) => ({ name: 'fist' + j, act: 'clip', u: k / 16, g: 'PUMP', p: 1, turn: 0.6 })),
  ...[2, 10].map((k, j) => ({ name: 'over' + j, act: 'clip', u: k / 16, g: 'OVERHEAD', turn: 0.6 })),
  ...[0, 4, 8, 12].map((k, j) => ({ name: 'pole' + j, act: 'clip', u: k / 16, pole: true })),
  ...[0, 4, 8, 12].map((k, j) => ({ name: 'tool' + j, act: 'clip', u: k / 16, g: 'SHOULDER_TOOL', tool: j % 2 ? 'shovel' : 'sledge' })),
];
const SIDE_TAKES = ['08_01', '35_01', '16_15', '07_01', '05_01', '02_01'];   // not 20_06 (the march swings the arm straight forward to shoulder height: a salute in profile) nor 17_01 (crouched)
let SIDE_CLIPS = null;
async function sideClips() {
  const { loadTake, PEOPLE_MAP } = await import('../lib/fx/bvh.js'), base = new URL('../../../sources/mocap/cmu/', import.meta.url).href;
  SIDE_CLIPS = await Promise.all(SIDE_TAKES.map(async n => { const tk = await loadTake(base + n + '.bvh'), cyc = tk.cycle(); return { name: n, clip: tk.retarget(PEOPLE_MAP, People.RIG), L: cyc.t1 - cyc.t0 }; }));
}
if (SIDE) POSES.splice(0, POSES.length, ...POSES_SIDE);
export const SIL_POSES = POSES.map(p => p.name);

const W = 16 * CW, H = 3 * CH;                  // one pass: 8 figures x 2 rows, every other column and row empty
const glc = document.createElement('canvas'); glc.width = W; glc.height = H;
const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(0, W / PPM, H / PPM, 0, 0.1, 100); cam.position.set(0, 0, 30); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
scene.add(new THREE.HemisphereLight('#ffffff', '#444444', 1));
const fp = new FigurePass(renderer, W, H);
const atlas = document.createElement('canvas');
const cells = [];
for (const ty of SIL_TYPES) POSES.forEach((po, pi) => cells.push({ ty, po, pi }));
atlas.width = COLS * CW; atlas.height = Math.ceil(cells.length / COLS) * CH;
const ag = atlas.getContext('2d');
const AD = ag.createImageData(atlas.width, atlas.height);

const folk = new People(scene, { max: 16, viewH: 960, lodPx: [-1, -1], budget: [100, 100], shadows: 'none' });
for (const m of folk.meshes) m.userData.subject = 1;
const poleMat = new THREE.MeshStandardMaterial({ color: '#3a2a1a' }), steel = new THREE.MeshStandardMaterial({ color: '#3a3c40' });
const slot = [];
for (let k = 0; k < 16; k++) slot.push(folk.add({}));

async function bake() {
  const meta = [], t0 = performance.now();
  for (let b = 0; b < cells.length; b += 16) {
    const batch = cells.slice(b, b + 16), extras = [];
    batch.forEach((c, k) => {
      const col = k % 8, row = Math.floor(k / 8) * 2, id = slot[k], r = rng(c.ty.i * 97 + c.pi * 13 + 5);
      const [hw, hs] = c.ty.hw.split(':');
      const d = People.varied(c.ty.trade, 300 + c.ty.i * 7, { fem: c.ty.fem, heavy: c.ty.heavy, h: c.ty.h, hat: false, hairStyle: hw === 'bare' ? +hs : (c.ty.fem ? 3 : 1), beard: hw === 'bare' && c.ty.i % 2 === 0 && !c.ty.fem });
      folk.people[id].d = d; folk.palette(id);
      const side = (c.ty.i % 3 === 1) ? 1 : -1;
      const yaw = c.po.act === 'walk' ? 0 : [-0.38, 0.0, 0.38, -0.2, 0.2][(c.ty.i + c.pi) % 5];
      const cx = (2 * col + 0.5) * CW / PPM, footY = (H - row * CH - FOOT) / PPM;
      const st = { x: cx, y: footY, z: 0, heading: SIDE ? Math.PI / 2 - (c.po.turn || 0) : Math.PI + yaw, act: c.po.act || 'stand', t: c.po.t ?? 1, ph: c.po.ph ?? 0, amt: 1, speed: 1, look: c.po.look || 0, gesture: null, fistScale: 1.3, visible: true, pose: null, mix: null };
      if (c.po.act === 'clip') { const K = SIDE_CLIPS[c.ty.i % SIDE_CLIPS.length]; Object.assign(st, { clip: K.clip, ct: c.po.u * K.L, loop: true, rootMotion: false }); }
      if (c.po.g) st.gesture = { name: c.po.g, side: SIDE ? (c.po.tool ? side : -1) : side, p: c.po.p ?? 0.8, w: c.po.w ?? 1 };
      if (c.po.pole) st.gesture = [{ name: 'BANNER_TOP', side: -1 }, { name: 'BANNER_LOW', side: 1 }];
      if (c.po.lean) st.pose = (Pz) => { Pz[1 * 3] += c.po.lean; Pz[2 * 3] += c.po.lean * 0.6; Pz[4 * 3] -= c.po.lean * 0.5; };   // hauling: lean into it
      Object.assign(folk.people[id], st);
      c.id = id; c.side = side; c.yaw = yaw; c.col = col; c.row = row;
      if (hw !== 'bare') { const a = attachHeadwear(scene, folk, id, hw, c.ty.hc); a.group.traverse(o => { if (o.isMesh) o.userData.subject = 0.7; }); extras.push(a); c.hw = a; }
      if (c.po.tool) { const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 8), poleMat), head = new THREE.Mesh(c.po.tool === 'sledge' ? new THREE.BoxGeometry(0.075, 0.075, 0.2) : new THREE.BoxGeometry(0.24, 0.3, 0.02), steel);
        for (const m of [handle, head]) { m.userData.subject = 0.5; scene.add(m); } c.tool = { handle, head }; extras.push({ group: handle }, { group: head }); }
    });
    for (let k = batch.length; k < 16; k++) folk.people[slot[k]].visible = false;
    folk.update(cam);
    for (const c of batch) {
      if (c.hw) c.hw.update();
      if (c.tool) { const s = c.side, g = folk.gripPos(c.id, s), at = folk.att[c.id], sh = at.arm[s > 0 ? 0 : 1].S.clone().add(new THREE.Vector3(0, 0.06, 0));
        const d = sh.clone().sub(g).normalize(), back = g.clone().addScaledVector(d, 0.95), front = g.clone().addScaledVector(d, -0.12), L = back.distanceTo(front);
        const { handle, head } = c.tool; handle.position.copy(back).add(front).multiplyScalar(0.5); handle.scale.set(1, L, 1); handle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
        head.position.copy(back); head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d); if (c.po.tool === 'shovel') head.position.addScaledVector(d, 0.12); }
    }
    scene.updateMatrixWorld(true);
    fpPatchScene(scene);
    const rd = fp.read(scene, cam), nd = rd.nd, uvm = rd.uvm;
    fp.rim(scene, cam, { light: new THREE.Vector3(W / PPM / 2, 520, -600), rim: '#ffffff', rim2: '#000000', body: '#000000', rimW: 0.5, bump: 0.3, wrapK: 0.0, bounce: 0.0 });
    const tc = document.createElement('canvas'); tc.width = W; tc.height = H; const tg = tc.getContext('2d', { willReadFrequently: true }); tg.drawImage(glc, 0, 0); const RIM = tg.getImageData(0, 0, W, H).data;
    const Lk = new THREE.Vector3(-0.45, 0.6, 0.66).normalize();
    const toPx = v => [v.x * PPM, H - v.y * PPM];
    for (const c of batch) {
      const x0 = 2 * c.col * CW, y0 = c.row * CH, ac = (b + batch.indexOf(c)), ax = (ac % COLS) * CW, ay = Math.floor(ac / COLS) * CH;
      const at = folk.att[c.id], sc = c.ty.h / 1.78;
      const hp = toPx(at.headP), headR = 0.125 * sc * PPM;
      const hands = at.arm.map(a => toPx(a.W));
      const g = c.po.g && c.po.g !== 'SHOULDER_TOOL' ? c.po.g : null, raisedK = g ? (c.side > 0 ? 0 : 1) : -1;
      let top = CH, minX = CW, maxX = 0;
      for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
        const gx = x0 + x, gy = y0 + y, i = (H - 1 - gy) * W + gx, o = ((ay + y) * atlas.width + ax + x) * 4;
        const on = nd[i * 4 + 3] > 0; if (!on) { AD.data[o + 3] = 0; continue; }
        const nx = nd[i * 4], ny = nd[i * 4 + 1], nz = nd[i * 4 + 2], subj = uvm[i * 4 + 2];
        const key = Math.max(0, nx * Lk.x + ny * Lk.y + nz * Lk.z);
        const ri = (gy * W + gx) * 4, rim = Math.max(RIM[ri], RIM[ri + 1], RIM[ri + 2]);
        const inHead = (gx - hp[0]) ** 2 + (gy - hp[1]) ** 2 < headR * headR;
        let inFist = false; if (raisedK >= 0 && c.po.w !== 0.45) { const hh = hands[raisedK]; inFist = (gx - hh[0]) ** 2 + (gy - hh[1] + 0.03 * PPM) ** 2 < (0.085 * sc * PPM) ** 2; }
        const acc = (subj > 0.6 && subj < 0.8) || inHead || inFist;
        AD.data[o] = rim; AD.data[o + 1] = Math.round(255 * key); AD.data[o + 2] = acc ? 255 : 0; AD.data[o + 3] = 255;
        if (y < top) top = y; if (x < minX) minX = x; if (x > maxX) maxX = x;
      }
      const rel = p => [+(p[0] - x0).toFixed(1), +(p[1] - y0).toFixed(1)];
      const m = { k: ac, x: ax, y: ay, type: c.ty.i, hw: c.ty.hw, trade: c.ty.trade, fem: c.ty.fem, h: c.ty.h, pose: c.po.name, yaw: c.yaw, side: c.side,
        foot: rel(toPx(new THREE.Vector3((2 * c.col + 0.5) * CW / PPM, (H - c.row * CH - FOOT) / PPM, 0))), head: [...rel(hp), +headR.toFixed(1)], top, bx: [minX, maxX],
        hands: { L: rel(hands[0]), R: rel(hands[1]) } };
      if (raisedK >= 0) m.fist = rel(hands[raisedK]);
      if (c.po.pole) { const lo = folk.gripPos(c.id, 1), hi = folk.gripPos(c.id, -1); m.pole = [rel(toPx(lo)), rel(toPx(hi))]; }
      if (c.tool) m.tool = c.po.tool;
      meta.push(m);
    }
    for (const e of extras) { scene.remove(e.group); e.group.traverse?.(o => { if (o.isMesh) o.geometry.dispose(); }); }
    console.log(`batch ${b / 16 + 1}/${Math.ceil(cells.length / 16)} ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
  ag.putImageData(AD, 0, 0);
  return { meta: { CW, CH, PPM, FOOT, COLS, types: SIL_TYPES, poses: SIL_POSES, cells: meta }, atlas };
}
window.silBake = async () => { if (SIDE) await sideClips(); const r = await bake(); window.silAtlas = r.atlas; document.body.appendChild(r.atlas); return r.meta; };
window.sceneReady = true;
