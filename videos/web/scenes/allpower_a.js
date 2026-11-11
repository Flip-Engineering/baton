// ALL POWER c20 (allpower_a / _b / _c: one picture, three takes; the take is the page's name). c20 over v6-v10:
//   the middle is an argument, not a list: THIS WHOLE TOWN RUNS ALL NIGHT ON ONE WIRE, AND SO DOES ITS COURT. THE COURT DID NOT
//   MAKE THAT POWER, AND IT CANNOT KEEP IT. (the courthouse's lights dip as the current passes it, then the current leaves it behind)
//   IT IS RAISED BY HAND, POLE BY POLE, AND KEPT LIVE BY PEOPLE WHO WILL NEVER SIT ON ITS BENCH, OUT IN THE STORM WHILE THE NATION
//   SLEEPS.; the Party's sentence is BUILT on screen at size (each clause steps up as the next lands; the whole sentence stands
//   together on THE WORKING CLASS.) over the 1942 crew and then present-day line workers from the person pipeline at night
//   (assets/allpower/ap_*.png, Cycles cut-outs: blender/allpower_people_job.py); the payoff is WE POWER IT. over the reverse trace in
//   clean sky, a lit lineman whose face takes the town's light, the streets coming on as lines of light; the mark holds on a ring.
//   The Declaration is smaller and briefer (take c drops it: the court is met only on the wire). The bucket box with the printed
//   mark is gone; the ALL POWER. slams are full-bleed plates in the arc's flash.
// Take a: score songs2/allpower_c20.py (v6 developed). Take b: songs2/allpower_c20b.py (v1's G-funk developed). Take c: take a's score.
// v6 text follows. The loop is the argument: a diner's neon OPEN strikes at frame 0 under the question WHERE DOES POWER
// COME FROM?; the Declaration's own words over the county courthouse lit at 2:00; then ONE sentence that builds on screen (clauses
// stack up in the sky as the picture changes under them): THE SAME CURRENT LIGHTS THE SIGN, THE MOTEL, THE PUMPS, THE CLOCK ON THE
// COURTHOUSE, BUT THE COURTHOUSE DOESN'T MAKE THE CURRENT. IT COMES DOWN A WIRE STRUNG BY HAND, POLE BY POLE, AND KEPT LIVE BY A MAN IN THE
// RAIN WHILE THE TOWN SLEEPS. The spark runs the wire (each place held, the current crosses it in a few frames and strikes the sign),
// to the work pole; the gauntlet closes on the hot stick; the real 1942 crew (Palmer, FSA/OWI, LoC) carries the people. Half a beat
// of silence; the drop is one NOTAN impact frame (the cutout and the arc as shapes, LINE'S HOT. knocked out); ALL POWER. slams twice
// on real silhouettes in the arc's flash; THE GOVERNED ARE THE ONES WHO CARRY IT.; the Party's sentence ALL LEGITIMATE POWER /
// DERIVES FROM / THE WORKING CLASS. at 4 beats a frame, each frame bigger than the last (the booms of a staging yard rise under the
// first). WE POWER IT. over the trace in reverse: the courthouse clock, the canopy, the MOTEL sign and the OPEN sign come back on in
// that order, then the whole town with a real man's silhouette in the foreground; the four conductors grow into the four stripes of
// the mark, and the OPEN sign's strike is frame 0 again.
// Rules held: no front key on any CG face; red only in the neon, the gloves and the one flag; frame type is plain printed white or
// ink; no capitol dome, no dams, data centers or utility logos. The convoy world below survives only as the staging yard.
// Words: research/scripts_final/allpower.json. Song: web/audio/songs2/allpower_v6.py (92 BPM, standalone; logo at b52).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { W, H, C, loadFonts, loadBeats, clamp, lerp, ease, smooth, rng, sigil, line, acpEmblem, BRAND } from '../lib/kit.js';
import { RQ } from '../lib/rq.js';
import { Post } from '../lib/fx/post.js';
import { loadHeroData, Hero } from '../lib/fx/hero.js';
import { GESTURES } from '../lib/fx/gesture.js';
import { Ranks, RANK_STYLES } from '../lib/fx/ranks.js';
import { loadFace } from '../lib/fx/type.js';
import { SAFE, setBlock, chantAt, typeAudit } from '../lib/fx/type_world.js';
import { strikeEnvelope } from '../lib/fx/relight.js';
import { Looks } from '../lib/fx/looks.js';
import { drawMark, markBox } from '../lib/closer.js';

const QS = new URLSearchParams(location.search);
await loadFonts();
{ const f = new FontFace('Overpass', 'url(../node_modules/@fontsource/overpass/files/overpass-latin-900-normal.woff2)', { weight: '900' });
  document.fonts.add(await f.load()); }
const TAKE = ((location.pathname.match(/allpower_([abc])\.html/) || [])[1]) || 'a';
const B = await loadBeats('allpower_' + TAKE);
const SPB = B.spb, CLOSE = 52, END_B = 60;          // the lock at b52, the ring to b60 (the score's own ending)
const T0 = TAKE === 'c' ? 3 : 6;                     // the beat the current leaves the OPEN sign (take c: no Declaration, straight onto the wire)
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const FR = 1 / 30;                                   // one frame, s
const bt = b => b * SPB;                             // beat -> s

// ================================================================ words (scripts_final/allpower.json, exactly)
// Plant lines hit at full value on their cue frame and cut off (hit, don't hold); the chant slams are ALL / POWER. on
// two lines at slam size, each in its own place, 6 frames on their hit (chantAt); the payoff is a hierarchy.
const OVER = await loadFace('overpass/files/overpass-latin-900-normal.woff');
const SHOUL = await loadFace('shoulders');
// c20: the middle is claim, reason, consequence, in sentences that build (clauses stack in the sky and stay, dimmed, until the group
// ends); nothing names what the picture already shows. The Declaration is set smaller than the question and is gone by b6.
const CUES_AB = [
  { b: 0, lines: [{ text: 'WHERE DOES', cap: 120 }, { text: 'POWER', cap: 200 }, { text: 'COME FROM?', cap: 120 }], hold: 1.95, y: 1040, role: 'shout', scrim: 0.4 },
  { b: 2, lines: [{ text: '\u201C\u2026DERIVING THEIR', cap: 78 }, { text: 'JUST POWERS FROM THE', cap: 78 }, { text: 'CONSENT OF THE GOVERNED.\u201D', cap: 78 }], hold: 3.6, y: 430, quote: 1, scrim: 0.3 },
  { b: 6, until: 10, g: 'A', lines: [{ text: 'THIS WHOLE TOWN', cap: 104 }, { text: 'RUNS ALL NIGHT', cap: 104 }, { text: 'ON ONE WIRE,', cap: 104 }], y: 470, scrim: 0.34 },
  { b: 8, until: 10, g: 'A', lines: [{ text: 'AND SO DOES ITS COURT.', cap: 104 }], y: 800, scrim: 0.34 },
  { b: 10, until: 14, g: 'B', lines: [{ text: 'THE COURT DID NOT', cap: 112 }, { text: 'MAKE THAT POWER,', cap: 112 }], y: 380, scrim: 0.34 },
  { b: 12, until: 14, g: 'B', lines: [{ text: 'AND IT CANNOT', cap: 140 }, { text: 'KEEP IT.', cap: 170 }], y: 690, scrim: 0.34 },
  { b: 14, until: 16, g: 'C', lines: [{ text: 'IT IS RAISED BY HAND,', cap: 104 }, { text: 'POLE BY POLE,', cap: 118 }], y: 1080, scrim: 0.34 },
  { b: 16, until: 19, g: 'D', lines: [{ text: 'AND KEPT LIVE BY PEOPLE', cap: 92 }, { text: 'WHO WILL NEVER SIT', cap: 92 }, { text: 'ON ITS BENCH,', cap: 92 }], y: 1050, scrim: 0.34 },
  { b: 19, until: 22, lines: [{ text: 'OUT IN', cap: 150 }, { text: 'THE STORM', cap: 170 }], y: 470, scrim: 0.3 },
  { b: 22, lines: [{ text: 'WHILE THE NATION', cap: 120 }, { text: 'SLEEPS.', cap: 165 }], hold: 1.45, y: 1085, scrim: 0.3 },
  { b: 24, lines: [{ text: 'THE LINE', cap: 200 }, { text: 'IS LIVE.', cap: 236 }], hold: 1.5, role: 'shout', y: 1180, x: 400 },
  { b: 26, text: 'ALL POWER.', slam: 1, y: 700, x: 480, scrim: 1 },
  { b: 27, text: 'ALL POWER.', slam: 2, y: 1000, x: 540, scrim: 1 },
  { b: 28, lines: [{ text: 'THE CONSENT', cap: 150 }, { text: 'OF THE GOVERNED', cap: 150 }], hold: 2.0, y: 1070, scrim: 0.2 },
  { b: 30, lines: [{ text: 'IS THEIR LABOR.', cap: 190 }], hold: 2.0, y: 1130, scrim: 0.2 },
  // the Party's sentence (b32-44) is drawn by drawSentence(): built on screen at size, each clause stepping up as the next lands
  { b: 44, text: 'WE POWER IT.', hold: 6.3, pay: true, y: 470 },
];
// take c: no Declaration; the question is held longer and the sentence starts as the current leaves the sign (b3)
const CUES_C = CUES_AB.filter(c => c.b !== 2 && c.b !== 6 && c.b !== 0).concat([
  { b: 0, lines: [{ text: 'WHERE DOES', cap: 120 }, { text: 'POWER', cap: 200 }, { text: 'COME FROM?', cap: 120 }], hold: 2.95, y: 1040, role: 'shout', scrim: 0.4 },
  { b: 3, until: 10, g: 'A', lines: [{ text: 'THIS WHOLE TOWN', cap: 104 }, { text: 'RUNS ALL NIGHT', cap: 104 }, { text: 'ON ONE WIRE,', cap: 104 }], y: 470, scrim: 0.34 },
]).sort((p, q) => p.b - q.b);
const CUES = TAKE === 'c' ? CUES_C : CUES_AB;
const SLAM_T = CUES.filter(c => c.slam).map(c => bt(c.b));

// ================================================================ renderer, cameras, post
const ADOPT = false;   // GRAPHICS 4.A (lib/rq.js): true = native resolution on the GPU and a fenced copy, once this piece's farm A/B says so
const SC = RQ.scale(0.75, ADOPT), RW = Math.round(W * SC), RH = Math.round(H * SC);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(RW, RH, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
const camera = new THREE.PerspectiveCamera(50, RW / RH, 0.05, 9000);
const post = new Post(W, H, { direct: true, glowScale: 0.25 });
const comp = document.createElement('canvas'); comp.width = W; comp.height = H; const cg = comp.getContext('2d', { willReadFrequently: true });
const typeC = document.createElement('canvas'); typeC.width = W; typeC.height = H; const tg = typeC.getContext('2d', { willReadFrequently: true });   // CPU-backed: a GPU canvas uploaded stale type in sequence
const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H; const tpg = tmp.getContext('2d');

// ================================================================ small utils
const R = rng(1917);
function hash(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
const Y = V3(0, 1, 0);
// a geometry laid between two points along its local Y
function between(geo, a, b) {
  const d = b.clone().sub(a), L = d.length();
  const g = geo.clone(); g.scale(1, L, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(Y, d.clone().normalize());
  g.applyQuaternion(q); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
const CYL = (r0, r1, seg = 10) => new THREE.CylinderGeometry(r1, r0, 1, seg, 1);
function rod(a, b, r, seg = 8, r1 = r) { return between(CYL(r, r1, seg), a, b); }
function box(w, h, d, x, y, z, ry = 0) { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); return g; }
function merged(list) { return mergeGeometries(list.map(g => g.index ? g.toNonIndexed() : g).map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; })); }
function catenary(a, b, sag, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const u = i / n; const p = a.clone().lerp(b, u); p.y -= sag * 4 * u * (1 - u); pts.push(p); }
  return pts;
}
function tube(pts, r, rad = 5, tens = 'centripetal') {
  const c = new THREE.CatmullRomCurve3(pts, false, tens);
  return new THREE.TubeGeometry(c, Math.max(8, pts.length * 3), r, rad, false);
}
function canvasTex(w, h, draw, { srgb = true, repeat = null, mip = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4; if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  if (!mip) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  return t;
}
function noiseFill(g, w, h, base, amp, seed, cell = 2) {
  const r = rng(seed); const id = g.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y += cell) for (let x = 0; x < w; x += cell) {
    const v = (r() - 0.5) * amp;
    for (let yy = 0; yy < cell; yy++) for (let xx = 0; xx < cell; xx++) {
      const i = ((y + yy) * w + x + xx) * 4; id.data[i] = clamp(base[0] + v, 0, 255); id.data[i + 1] = clamp(base[1] + v, 0, 255); id.data[i + 2] = clamp(base[2] + v, 0, 255); id.data[i + 3] = 255;
    }
  }
  g.putImageData(id, 0, 0);
}

// ================================================================ rim-light injection (a rim from a real light, never an edge detector)
// uRimDir / uRim2Dir are view-space directions toward the two back lights of the current shot (arc / flood, strobe);
// the rim appears only on the silhouette edges that face that light.
const RIM = { d1: { value: V3(0, 0, -1) }, c1: { value: new THREE.Color(0, 0, 0) }, d2: { value: V3(0, -1, 0) }, c2: { value: new THREE.Color(0, 0, 0) } };
function rimify(m, k = 1) {
  m.onBeforeCompile = sh => {
    sh.uniforms.uRD1 = RIM.d1; sh.uniforms.uRC1 = RIM.c1; sh.uniforms.uRD2 = RIM.d2; sh.uniforms.uRC2 = RIM.c2;
    sh.fragmentShader = 'uniform vec3 uRD1, uRC1, uRD2, uRC2;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      { vec3 Vv = normalize(vViewPosition); float fr = pow(1.0 - clamp(dot(normal, Vv), 0.0, 1.0), 3.4);
        gl_FragColor.rgb += ${k.toFixed(2)} * fr * (uRC1 * smoothstep(0.15, 0.9, dot(normal, uRD1)) + uRC2 * smoothstep(0.15, 0.9, dot(normal, uRD2))); }`);
  };
  return m;
}

// ================================================================ glow sprites (instanced billboards: lamps, signs, strobes, the spark)
class Glows {
  constructor(scene, n, { refl = false, order = 5 } = {}) {
    const g = new THREE.InstancedBufferGeometry(); const q = new THREE.PlaneGeometry(1, 1);
    g.index = q.index; g.setAttribute('position', q.attributes.position); g.setAttribute('uv', q.attributes.uv);
    this.pos = new Float32Array(n * 3); this.size = new Float32Array(n * 2); this.col = new Float32Array(n * 3); this.ph = new Float32Array(n * 2);
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.pos, 3)); g.setAttribute('iSize', new THREE.InstancedBufferAttribute(this.size, 2));
    g.setAttribute('iCol', new THREE.InstancedBufferAttribute(this.col, 3)); g.setAttribute('iPh', new THREE.InstancedBufferAttribute(this.ph, 2));
    g.instanceCount = 0; this.n = 0; this.geo = g;
    this.U = { uT: { value: 0 }, uBeat: { value: 0 }, uGain: { value: 1 }, uStrobe: { value: 0 }, uFlick: { value: 0 }, uAll: { value: 0 }, uWaveX: { value: -1e9 } };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.U, transparent: true, depthWrite: false, depthTest: !refl, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: `attribute vec3 iPos; attribute vec2 iSize; attribute vec3 iCol; attribute vec2 iPh;
        uniform float uT, uBeat, uGain, uStrobe, uFlick, uAll, uWaveX; varying vec2 vUv; varying vec3 vC; varying float vK;
        float h1(float n){ return fract(sin(n*91.7)*43758.5); }
        void main(){
          vUv = uv; float k = 1.0; float kind = iPh.y;
          if (kind > 0.5 && kind < 1.5) { // amber strobe: a double flash per beat, phase-offset per unit
            float p = fract(uBeat * 1.0 + iPh.x); k = 0.08 + smoothstep(0.0, 0.02, p) * (1.0 - smoothstep(0.05, 0.1, p)) + smoothstep(0.16, 0.18, p) * (1.0 - smoothstep(0.21, 0.26, p));
            k = max(k, 0.3 + 1.3 * pow(max(0.0, cos(6.2832 * (uBeat * 0.75 + iPh.x * 1.7))), 10.0));   // a rotating beacon under the flash
            k = max(k, uAll); k *= 1.0 + uStrobe;
          } else if (kind > 1.5 && kind < 2.5) { // flicker (signs)
            k = 1.0 - uFlick * step(0.5, h1(floor(uT * 30.0) + iPh.x * 17.0));
          } else if (kind > 2.5) { // the relight wave: lamps and town glows come on as the wave front passes their x (payoff)
            float d = uWaveX - iPos.x; k = smoothstep(0.0, 14.0, -d) * (0.75 + 0.25 * h1(floor(uT * 30.0) * 0.37 + iPos.x));
            k *= 1.0 + 1.4 * exp(-abs(d) / 20.0) * step(d, 0.0);
          }
          vK = k; vC = iCol;
          ${refl ? `vec3 P = vec3(iPos.x, -iPos.y, iPos.z); vec4 mv = modelViewMatrix * vec4(P, 1.0); vec4 m0 = modelViewMatrix * vec4(iPos.x, 0.0, iPos.z, 1.0);
          // a streak from the ground contact down past the mirrored point (wet asphalt)
          float len = max(0.4, abs(mv.y - m0.y)) * 1.6; mv.y = (m0.y + mv.y) * 0.5 - len * 0.25; mv.x += position.x * iSize.x; mv.y += position.y * len;` :
          `vec4 mv = modelViewMatrix * vec4(iPos, 1.0); mv.xy += position.xy * iSize;`}
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec2 vUv; varying vec3 vC; varying float vK; uniform float uGain;
        void main(){ vec2 d = vUv - 0.5; ${refl ? 'd.y *= 0.35; d.x *= 1.3;' : ''} float r = length(d) * 2.0;
          float a = exp(-r * r * 5.0) * 0.55 + exp(-r * r * 60.0) * 1.4 + exp(-r * 2.5) * 0.12 * (1.0 - r);
          a *= 1.0 - smoothstep(0.85, 1.0, r);
          gl_FragColor = vec4(vC * a * vK * uGain, 1.0); }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = order; scene.add(this.mesh);
  }
  add(p, w, h, c, kind = 0, ph = 0) {
    const i = this.n++; this.pos.set([p.x, p.y, p.z], i * 3); this.size.set([w, h], i * 2); this.col.set(c, i * 3); this.ph.set([ph, kind], i * 2);
    this.geo.instanceCount = this.n; return i;
  }
  set(i, p, w, h, c) {
    if (p) this.pos.set([p.x, p.y, p.z], i * 3); if (w != null) this.size.set([w, h], i * 2); if (c) this.col.set(c, i * 3);
    this.geo.attributes.iPos.needsUpdate = this.geo.attributes.iSize.needsUpdate = this.geo.attributes.iCol.needsUpdate = true;
  }
  done() { for (const k of ['iPos', 'iSize', 'iCol', 'iPh']) this.geo.attributes[k].needsUpdate = true; }
}
const SODIUM = [1.0, 0.52, 0.18], AMBER = [1.0, 0.55, 0.08], ARC = [0.72, 0.84, 1.0], WHITE = [1, 0.96, 0.9], NEON = [1.0, 0.1, 0.04];

// radial light pools on the ground (additive decals)
const poolTex = canvasTex(128, 128, (g, w) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); }, { srgb: false });
class Pools {
  constructor(scene, n) {
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    this.m = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 }), n);
    this.m.count = 0; this.m.renderOrder = 2; this.m.frustumCulled = false; scene.add(this.m); this.d = new THREE.Object3D();
  }
  add(x, z, r, c, y = 0.02) { const i = this.m.count++; this.d.position.set(x, y, z); this.d.scale.set(r * 2, 1, r * 2); this.d.updateMatrix(); this.m.setMatrixAt(i, this.d.matrix); this.m.setColorAt(i, new THREE.Color(...c)); this.m.instanceMatrix.needsUpdate = true; if (this.m.instanceColor) this.m.instanceColor.needsUpdate = true; return i; }
}

// ================================================================ the sky (night, low stratus lit from below by the town)
function makeSky(scene, { glowDir = V3(-1, 0, 0), glow = [0.5, 0.26, 0.1], zen = [0.012, 0.016, 0.03], hor = [0.07, 0.055, 0.05] } = {}) {
  const U = { uGlowDir: { value: glowDir.clone().normalize() }, uGlow: { value: new THREE.Vector3(...glow) }, uZen: { value: new THREE.Vector3(...zen) }, uHor: { value: new THREE.Vector3(...hor) }, uFlash: { value: new THREE.Vector3(0, 0, 0) }, uT: { value: 0 } };
  const m = new THREE.ShaderMaterial({ uniforms: U, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `varying vec3 vD; uniform vec3 uGlowDir, uGlow, uZen, uHor, uFlash; uniform float uT;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*n2(p); p*=2.03; a*=0.5; } return s; }
      void main(){ vec3 d = normalize(vD); float y = d.y;
        vec3 c = mix(uHor, uZen, smoothstep(-0.02, 0.45, y));
        float az = max(dot(normalize(d.xz + 1e-4), normalize(uGlowDir.xz + 1e-4)), 0.0);
        // the stratus deck: a continuous ceiling, lit from below by the towns on the horizon
        vec2 q = d.xz / max(y + 0.08, 0.02) * 1.3; float cl = fbm(q * 0.9 + vec2(uT * 0.01, 0.0)); cl = smoothstep(0.35, 0.8, cl);
        float low = exp(-max(y, 0.0) * 5.0);
        c += uGlow * (0.35 + 0.65 * pow(az, 3.0)) * low * (0.35 + 0.9 * cl);
        c += uGlow * (0.18 + 0.3 * pow(az, 2.0)) * cl * smoothstep(0.0, 0.3, y) * (1.0 - smoothstep(0.35, 0.95, y));
        c += uGlow * 0.05 * smoothstep(0.2, 0.9, y) * cl;
        c += uFlash * (0.4 + cl) * smoothstep(-0.05, 0.3, y);
        gl_FragColor = vec4(c, 1.0); }` });
  const s = new THREE.Mesh(new THREE.SphereGeometry(6000, 48, 24), m); s.renderOrder = -1; s.frustumCulled = false; scene.add(s);
  return U;
}

// ================================================================ materials (shared)
const asphaltTex = canvasTex(1024, 1024, (g, w, h) => {
  noiseFill(g, w, h, [36, 35, 34], 26, 3, 2);
  const r = rng(5);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${r() < 0.5 ? 70 : 12},${r() < 0.5 ? 68 : 12},${r() < 0.5 ? 64 : 12},${0.25 + r() * 0.3})`; g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3); }
  g.strokeStyle = 'rgba(8,8,8,0.8)'; g.lineWidth = 3; for (let i = 0; i < 14; i++) { g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let k = 0; k < 10; k++) { x += (r() - 0.5) * 60; y += (r() - 0.3) * 40; g.lineTo(x, y); } g.stroke(); }
}, { repeat: [60, 3] });
const puddleTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#6a6a6a'; g.fillRect(0, 0, w, h); const r = rng(9);
  for (let i = 0; i < 26; i++) { const x = r() * w, y = r() * h, rr = 20 + r() * 90; const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, '#0a0a0a'); gr.addColorStop(0.7, '#141414'); gr.addColorStop(1, 'rgba(106,106,106,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rr * 1.6, rr, r() * 3, 0, TAU); g.fill(); }
}, { srgb: false, repeat: [30, 2] });
const M = {
  road: new THREE.MeshStandardMaterial({ color: 0x3a3a3c, map: asphaltTex, roughness: 0.55, roughnessMap: puddleTex, metalness: 0.0 }),
  ground: new THREE.MeshStandardMaterial({ color: 0x14130f, roughness: 0.95 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x3b2c20, roughness: 0.8 }),
  woodRim: rimify(new THREE.MeshStandardMaterial({ color: 0x2c2118, roughness: 0.75 }), 0.3),
  porcelain: new THREE.MeshStandardMaterial({ color: 0x6f5e52, roughness: 0.25 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x70757a, roughness: 0.45, metalness: 0.6 }),
  can: new THREE.MeshStandardMaterial({ color: 0x3a3e42, roughness: 0.55, metalness: 0.4 }),
  wire: rimify(new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.35, metalness: 0.7 }), 0.7),
  dark: new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.85 }),
  brick: null, glass: new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.16, depthWrite: false }),
  frame: new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.35, metalness: 0.8 }),
  line: new THREE.MeshBasicMaterial({ color: 0xd8c9a0, toneMapped: true }),
  fleet: new THREE.MeshStandardMaterial({ color: 0x4a4944, roughness: 0.5, metalness: 0.1 }),
  fiber: new THREE.MeshStandardMaterial({ color: 0x4a463a, roughness: 0.55 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.9 }),
  lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 1.6, 0.6) }),
};
M.brick = new THREE.MeshStandardMaterial({ roughness: 0.85, map: canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#3a1f18'; g.fillRect(0, 0, w, h); const r = rng(12);
  for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? -16 : 0; x < w; x += 32) { const v = 40 + r() * 40; g.fillStyle = `rgb(${v + 50},${v * 0.55 + 10},${v * 0.4})`; g.fillRect(x + 1, y + 1, 30, 14); }
}, { repeat: [3, 2] }) });
// the hot conductors (the mark): an emissive overlay on the same geometry, faded in per shot
const HOT = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

// ================================================================ the town world (road along +x; poles on the north curb)
const town = new THREE.Scene();
town.fog = new THREE.FogExp2(0x0c1214, 0.0034);
// SODIUM: one flat slate-teal sky, the low deck warmed only near the horizon by the towns' sodium
const skyT = makeSky(town, { glowDir: V3(-1, 0, 0.2), glow: [0.34, 0.2, 0.09], zen: [0.012, 0.03, 0.036], hor: [0.05, 0.08, 0.085] });
const hemi = new THREE.HemisphereLight(0x39445c, 0x1a120c, 0.9); town.add(hemi);
const glowT = new Glows(town, 3600), reflT = new Glows(town, 400, { refl: true, order: 3 }), poolsT = new Pools(town, 300);
// pooled real lights, re-aimed per shot
const PL = [0, 1, 2, 3, 4].map(() => { const l = new THREE.PointLight(0xffffff, 0, 0, 2); town.add(l); return l; });
const SL = [0, 1, 2].map(() => { const l = new THREE.SpotLight(0xffffff, 0, 0, 0.5, 0.6, 2); town.add(l); town.add(l.target); return l; });

// ground + road + sidewalks
{
  const g = new THREE.PlaneGeometry(4000, 4000); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, M.ground); m.position.set(600, -0.02, 0); town.add(m);
  const rg = new THREE.PlaneGeometry(1400, 12); rg.rotateX(-Math.PI / 2); const road = new THREE.Mesh(rg, M.road); road.position.set(500, 0, 0); town.add(road);
  const sw = new THREE.MeshStandardMaterial({ color: 0x2c2b29, roughness: 0.4, roughnessMap: puddleTex });
  for (const z of [-10.5, 10.5]) { const s = new THREE.Mesh(box(470, 0.15, 9, 170, 0.07, z), sw); town.add(s); }
  // lane paint: the double yellow (dim, wet) and white edge lines, dashed near town
  const lines = []; for (let x = -100; x < 1200; x += 1) { if (x % 12 < 6) continue; }
  const paint = new THREE.MeshStandardMaterial({ color: 0x8a7a3a, roughness: 0.3 });
  town.add(new THREE.Mesh(merged([box(1300, 0.012, 0.1, 500, 0.012, -0.12), box(1300, 0.012, 0.1, 500, 0.012, 0.12)]), paint));
  town.add(new THREE.Mesh(merged([box(1300, 0.012, 0.12, 500, 0.012, -5.6), box(1300, 0.012, 0.12, 500, 0.012, 5.6)]), new THREE.MeshStandardMaterial({ color: 0x9a9a92, roughness: 0.3 })));
}

// ---------------------------------------------------------------- poles, crossarms, insulators, the four conductors
const POLE_Z = -7, POLE_X0 = 8, POLE_DX = 40, NPOLE = 21, WORK = 15;           // the work pole: x = 8 + 15*40 = 608
const PX = k => POLE_X0 + k * POLE_DX;
const ARM_Y = 11.2;
// phase conductor offsets (z) and heights: A, B (pole-top pin), C, and the neutral lower on the pole
const PH = [{ dz: -1.15, y: ARM_Y + 0.14 }, { dz: 0, y: ARM_Y + 0.75 }, { dz: 1.15, y: ARM_Y + 0.14 }, { dz: 0.28, y: 9.6 }];
const poleG = [], armG = [], insG = [], canG = [], lampG = [], wireG = [];
for (let k = 0; k < NPOLE; k++) {
  const x = PX(k), z = POLE_Z + (k === WORK ? 0 : (hash(k) - 0.5) * 0.3), lean = (hash(k + 9) - 0.5) * 0.04;
  poleG.push(rod(V3(x, -0.5, z), V3(x + lean, 12.2, z), 0.16, 10, 0.12));
  armG.push(box(0.1, 0.12, 2.6, x, ARM_Y, z));
  armG.push(rod(V3(x, ARM_Y - 0.7, z), V3(x, ARM_Y, z - 0.9), 0.02, 4), rod(V3(x, ARM_Y - 0.7, z), V3(x, ARM_Y, z + 0.9), 0.02, 4));
  for (const p of PH) {
    const base = V3(x, p.y - 0.14, z + p.dz);
    if (p.y < 10) { insG.push(rod(V3(x, p.y, z + 0.14), V3(x, p.y, z + p.dz), 0.05, 6)); continue; }
    for (let s = 0; s < 3; s++) insG.push(rod(V3(x, base.y + s * 0.05, base.z), V3(x, base.y + s * 0.05 + 0.03, base.z), 0.07 - s * 0.012, 10));
    insG.push(rod(V3(x, base.y - 0.05, base.z), V3(x, base.y + 0.16, base.z), 0.035, 8));
  }
  if (k % 3 === 1 && k !== WORK) canG.push(rod(V3(x, 8.0, z + 0.45), V3(x, 8.9, z + 0.45), 0.28, 14));
  // cobra-head street lamps in town (k <= 10) on the road side, every pole
  if (k <= 14 && k !== WORK) {
    lampG.push(rod(V3(x, 8.2, z + 0.15), V3(x + 0.1, 8.5, z + 2.6), 0.04, 6));
    lampG.push(box(0.35, 0.16, 0.7, x + 0.12, 8.45, z + 2.9));
    glowT.add(V3(x + 0.12, 8.33, z + 2.95), 1.1, 1.1, SODIUM.map(v => v * 1.2), 3);
    reflT.add(V3(x + 0.12, 8.33, z + 3.4), 0.9, 1, SODIUM.map(v => v * 0.35), 3);
    poolsT.add(x + 0.1, z + 4.5, 11, SODIUM.map(v => v * 0.34));
  }
}
// conductors span pole to pole; the service drop from the diner joins at pole 0
const spanPts = [];                  // per phase: the polyline over the whole line (for the spark)
for (let pi = 0; pi < 4; pi++) {
  const P = PH[pi], all = [];
  for (let k = 0; k < NPOLE - 1; k++) {
    const a = V3(PX(k), P.y, POLE_Z + P.dz), b = V3(PX(k + 1), P.y, POLE_Z + P.dz);
    const pts = catenary(a, b, 0.55 + 0.1 * hash(k * 7 + pi), 20);
    wireG.push(tube(pts, pi === 3 ? 0.012 : 0.011, 4));
    all.push(...(k ? pts.slice(1) : pts));
  }
  spanPts.push(all);
}
const wireGeo = merged(wireG);
const wires = new THREE.Mesh(wireGeo, M.wire); town.add(wires);
// the hot overlay: fatter tubes, additive, on the same catenaries
const hotG = []; for (let pi = 0; pi < 4; pi++) for (let k = 0; k < NPOLE - 1; k++) hotG.push(tube(catenary(V3(PX(k), PH[pi].y, POLE_Z + PH[pi].dz), V3(PX(k + 1), PH[pi].y, POLE_Z + PH[pi].dz), 0.55 + 0.1 * hash(k * 7 + pi), 20), 0.02, 5));
const hotWires = new THREE.Mesh(merged(hotG), HOT); hotWires.renderOrder = 6; town.add(hotWires);
// c20: the town's streets as lines of light (the payoff: seen from the top of the pole they come on outward from it, behind the
// lamps' points). Flat strips on the ground, additive sodium, revealed by their own wave front uWaveX (x > front = lit).
const STREET = { uWaveX: { value: -1e9 }, uGain: { value: 1 } };
const streets = (() => {
  const seg = [];
  const S2 = (x0, z0, x1, z1, w) => { const a = V3(x0, 0.06, z0), b = V3(x1, 0.06, z1), d = b.clone().sub(a), L = d.length(), g = new THREE.PlaneGeometry(L, w); g.rotateX(-Math.PI / 2); g.rotateY(-Math.atan2(d.z, d.x)); g.translate((x0 + x1) / 2, 0.06, (z0 + z1) / 2); seg.push(g); };
  S2(-90, -5.9, 700, -5.9, 0.9); S2(-90, 5.9, 700, 5.9, 0.9);                                          // the main road's two edges
  for (const x of [-60, -20, 20, 60, 100, 140, 180, 220, 280, 320]) S2(x, -170, x, 170, 1.1);           // the grid of the town
  for (const z of [-120, -70, 45, 95, 150]) S2(-130, z, 330, z, 1.1);
  S2(330, 8, 760, 240, 1.0); S2(330, -60, 820, -330, 1.0); S2(-130, 30, -520, 260, 1.0); S2(-130, -40, -560, -300, 1.0);   // county roads out of town
  const g = merged(seg);
  const m = new THREE.ShaderMaterial({ uniforms: STREET, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -6,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying vec3 vW; uniform float uWaveX, uGain;
      void main(){ float k = smoothstep(0.0, 24.0, vW.x - uWaveX); float lamp = 0.55 + 0.45 * pow(abs(sin((vW.x + vW.z) * 0.105)), 6.0);
        float edge = 1.0 + 2.2 * exp(-abs(vW.x - uWaveX - 6.0) / 12.0) * step(uWaveX, vW.x);
        gl_FragColor = vec4(vec3(1.0, 0.56, 0.2) * 1.5 * k * lamp * edge * uGain, 1.0); }` });
  const mesh = new THREE.Mesh(g, m); mesh.renderOrder = 3; mesh.visible = false; town.add(mesh); return mesh;
})();
town.add(new THREE.Mesh(merged(poleG), M.woodRim));
town.add(new THREE.Mesh(merged(armG), M.woodRim));
town.add(new THREE.Mesh(merged(insG), M.porcelain));
town.add(new THREE.Mesh(merged(canG), M.can));
town.add(new THREE.Mesh(merged(lampG), M.steel));

// ---------------------------------------------------------------- the diner (x = 0, facade at z = -14 facing the road)
const DZ = -14;
const neon = { letters: [], border: null, halo: null };
{
  const fac = [];
  // the facade around the plate-glass window (x -2.4..2.4, y 0.75..2.85): a Hopper window, most of the front
  fac.push(box(8, 0.75, 0.4, 0, 0.375, DZ - 0.2), box(8, 2.05, 0.4, 0, 3.875, DZ - 0.2), box(1.6, 2.1, 0.4, -3.2, 1.8, DZ - 0.2), box(1.6, 2.1, 0.4, 3.2, 1.8, DZ - 0.2));
  town.add(new THREE.Mesh(merged(fac), M.brick));
  town.add(new THREE.Mesh(merged([box(8.4, 0.3, 0.6, 0, 4.95, DZ - 0.1), box(12, 5, 10, 0, 2.5, DZ - 8.8)]), M.dark));
  // aluminium storefront frame + sill + mullions
  const fr = [box(4.9, 0.08, 0.12, 0, 0.77, DZ + 0.02), box(4.9, 0.08, 0.12, 0, 2.83, DZ + 0.02), box(0.08, 2.15, 0.12, -2.41, 1.8, DZ + 0.02), box(0.08, 2.15, 0.12, 2.41, 1.8, DZ + 0.02), box(0.06, 2.1, 0.1, -0.9, 1.8, DZ + 0.02), box(5.1, 0.06, 0.3, 0, 0.73, DZ + 0.12)];
  town.add(new THREE.Mesh(merged(fr), M.frame));
  const gl = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 2.06), M.glass); gl.position.set(0, 1.8, DZ + 0.03); gl.renderOrder = 4; town.add(gl);
  // the interior (dim, out of focus): counter, stools, pie case, a pendant or two; warm and mostly dark
  const inT = canvasTex(1024, 640, (g, w, h) => {
    g.fillStyle = '#1c130d'; g.fillRect(0, 0, w, h);
    g.filter = 'blur(7px)'; { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,170,90,0.25)'); gr.addColorStop(0.7, 'rgba(90,50,25,0.2)'); gr.addColorStop(1, 'rgba(0,0,0,0.4)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
    const pend = (x, y) => { const gr = g.createRadialGradient(x, y, 0, x, y, 180); gr.addColorStop(0, 'rgba(255,190,110,0.9)'); gr.addColorStop(0.15, 'rgba(160,90,40,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#ffd9a0'; g.fillRect(x - 14, y - 6, 28, 10); };
    pend(260, 170); pend(760, 190); pend(520, 150);
    g.fillStyle = '#2a1a12'; g.fillRect(0, 420, w, 60); g.fillStyle = '#5a3a26'; g.fillRect(0, 410, w, 12);
    g.fillStyle = '#1a1210'; for (let x = 60; x < w; x += 150) { g.fillRect(x, 470, 16, 170); g.beginPath(); g.ellipse(x + 8, 470, 42, 12, 0, 0, TAU); g.fill(); }
    g.fillStyle = 'rgba(200,200,190,0.25)'; g.fillRect(600, 300, 180, 110); g.fillStyle = 'rgba(255,220,170,0.4)'; g.fillRect(610, 320, 160, 8);
    g.fillStyle = 'rgba(120,120,120,0.35)'; g.fillRect(150, 260, 60, 150);
  });
  const inside = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 3.4), new THREE.MeshBasicMaterial({ map: inT, color: new THREE.Color(1.5, 1.35, 1.2) })); inside.position.set(0, 1.85, DZ - 3.6); town.add(inside); neon.insideTex = inT;
  poolsT.add(0, DZ + 3.2, 4.2, [0.9, 0.62, 0.32]); poolsT.add(0, DZ + 7.5, 5.5, [0.35, 0.22, 0.12]);
  // the neon sign: O P E N in red tube, a blue border, black blockouts, electrodes, a steel frame and chains
  const S = { cx: 0, cy: 1.72, z: DZ - 0.28 }, sp = (x, y) => V3(S.cx + x, S.cy + y, S.z);
  const fil = (pts, d = 0.012) => { const out = [pts[0]]; for (let i = 1; i < pts.length - 1; i++) { const a = pts[i - 1], b = pts[i], c = pts[i + 1]; out.push(b.clone().lerp(a, d / a.distanceTo(b)), b, b.clone().lerp(c, d / c.distanceTo(b))); } out.push(pts[pts.length - 1]); return out; };
  const P2 = (arr, ox) => arr.map(([x, y]) => sp(ox + x, y));
  const TR = 0.0065, hh = 0.125, ww = 0.06;
  const strokes = [
    [(() => { const a = []; for (let i = 0; i <= 40; i++) { const u = i / 40 * TAU + Math.PI / 2; a.push(sp(-0.32 + Math.cos(u) * 0.075, Math.sin(u) * hh)); } return a; })()],
    [(() => { const a = [sp(-0.17, -hh), sp(-0.17, hh), sp(-0.12, hh)]; for (let i = 0; i <= 16; i++) { const u = Math.PI / 2 - i / 16 * Math.PI; a.push(sp(-0.12 + Math.cos(u) * 0.06, 0.063 + Math.sin(u) * 0.062)); } a.push(sp(-0.17, 0.0)); return a; })()],
    [fil(P2([[ww, hh], [-ww, hh], [-ww, -hh], [ww, -hh]], 0.06)), fil(P2([[-ww, 0.004], [ww * 0.7, 0.004]], 0.06))],
    [fil(P2([[-ww, -hh], [-ww, hh], [ww, -hh], [ww, hh]], 0.25))],
  ];
  const blk = [], ele = [];
  strokes.forEach((ss, li) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.02, 0.02) });
    const gs = ss.map(p => tube(p, TR, 8, 'catmullrom'));
    const m = new THREE.Mesh(merged(gs), mat); town.add(m);
    neon.letters.push({ mat, mesh: m });
    for (const p of ss) for (const e of [p[0], p[p.length - 1]]) { ele.push(rod(e, e.clone().add(V3(0, 0, -0.07)), 0.009, 8)); blk.push(new THREE.SphereGeometry(0.0072, 8, 6).translate(e.x, e.y, e.z)); }
  });
  const bpts = []; for (let i = 0; i <= 64; i++) { const u = i / 64 * TAU; const cx = Math.cos(u), cy = Math.sin(u); const k = 0.05; bpts.push(sp(Math.sign(cx) * (0.42 - k) + Math.cos(u) * k * (Math.abs(cx) > 0 ? 1 : 0) * 0 + cx * 0.001, 0)); bpts.pop(); }
  // rounded-rect border
  const rr = []; const bx = 0.43, by = 0.19, br = 0.04;
  const corner = (cx, cy, a0) => { for (let i = 0; i <= 6; i++) { const u = a0 + i / 6 * Math.PI / 2; rr.push(sp(cx + Math.cos(u) * br, cy + Math.sin(u) * br)); } };
  corner(bx - br, by - br, 0); corner(-bx + br, by - br, Math.PI / 2); corner(-bx + br, -by + br, Math.PI); corner(bx - br, -by + br, Math.PI * 1.5); rr.push(rr[0].clone());
  neon.border = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.03, 0.06) });
  town.add(new THREE.Mesh(tube(rr, TR, 8, 'catmullrom'), neon.border));
  town.add(new THREE.Mesh(merged(blk), new THREE.MeshBasicMaterial({ color: 0x050505 })));
  town.add(new THREE.Mesh(merged(ele), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 })));
  // frame, chains, the transformer (bottom right) and its cord running up the window frame
  const fg = [box(0.9, 0.012, 0.012, S.cx, S.cy - 0.2, S.z - 0.08), box(0.9, 0.012, 0.012, S.cx, S.cy + 0.2, S.z - 0.08), box(0.012, 0.4, 0.012, S.cx - 0.44, S.cy, S.z - 0.08), box(0.012, 0.4, 0.012, S.cx + 0.44, S.cy, S.z - 0.08)];
  for (const x of [-0.38, 0.38]) fg.push(rod(V3(x, S.cy + 0.2, S.z - 0.08), V3(x, 2.72, S.z - 0.08), 0.003, 4));
  fg.push(box(0.16, 0.11, 0.09, 0.52, 1.06, S.z - 0.02));
  town.add(new THREE.Mesh(merged(fg), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.4, metalness: 0.5 })));
  neon.xf = V3(0.52, 1.06, S.z + 0.03);
  neon.halos = strokes.map(ss => { const gl = new Glows(town, 400, { order: 8 }); for (const p of ss) { const c = new THREE.CatmullRomCurve3(p); const L = c.getLength(); for (let k = 0; k <= L / 0.012; k++) gl.add(c.getPointAt(Math.min(1, k * 0.012 / L)).add(V3(0, 0, 0.004)), 0.05, 0.05, [0.9, 0.05, 0.02]); } gl.done(); return gl; });
  { const gl = new Glows(town, 400, { order: 8 }); const c = new THREE.CatmullRomCurve3(rr); const L = c.getLength(); for (let k = 0; k <= L / 0.012; k++) gl.add(c.getPointAt(Math.min(1, k * 0.012 / L)).add(V3(0, 0, 0.004)), 0.045, 0.045, [0.1, 0.35, 1.0]); gl.done(); neon.bhalo = gl; }
}
// the feed: transformer -> cord up the frame -> through the wall -> conduit up the facade -> weatherhead -> service drop -> pole 0
const SP0 = PX(0);
const feed = [neon.xf, V3(0.6, 1.06, DZ - 0.25), V3(2.6, 1.1, DZ - 0.25), V3(2.6, 2.9, DZ - 0.25), V3(2.9, 3.05, DZ + 0.06), V3(2.9, 4.6, DZ + 0.06), V3(2.9, 5.9, DZ + 0.06)];
const drop = catenary(V3(2.9, 5.9, DZ + 0.2), V3(SP0, 8.4, POLE_Z - 0.1), 0.45, 16);
{
  town.add(new THREE.Mesh(merged([rod(V3(2.9, 3.05, DZ + 0.06), V3(2.9, 5.95, DZ + 0.06), 0.03, 8), box(0.3, 0.4, 0.14, 2.9, 3.05, DZ + 0.07), tube(drop, 0.014, 4), rod(V3(2.6, 1.1, DZ - 0.25), V3(2.6, 2.9, DZ - 0.25), 0.004, 4), rod(V3(2.9, 5.95, DZ + 0.06), V3(2.9, 6.1, DZ + 0.2), 0.05, 8)]), M.steel));
  // the pole-0 secondary rack and riser to the transformer can
  town.add(new THREE.Mesh(merged([rod(V3(SP0, 8.0, POLE_Z + 0.45), V3(SP0, 8.9, POLE_Z + 0.45), 0.28, 14), box(0.08, 0.5, 0.08, SP0, 8.4, POLE_Z - 0.2)]), M.can));
}
const SPARK_PATH = [...feed, ...drop.slice(1), V3(SP0, 8.9, POLE_Z + 0.2), V3(SP0, PH[2].y - 0.1, POLE_Z + PH[2].dz), ...spanPts[2].slice(1)];
const pathLen = [0]; for (let i = 1; i < SPARK_PATH.length; i++) pathLen.push(pathLen[i - 1] + SPARK_PATH[i].distanceTo(SPARK_PATH[i - 1]));
function pathAt(s) {
  s = clamp(s, 0, pathLen[pathLen.length - 1]);
  let lo = 0, hi = pathLen.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pathLen[m] <= s) lo = m; else hi = m; }
  const u = (s - pathLen[lo]) / Math.max(1e-6, pathLen[hi] - pathLen[lo]); return SPARK_PATH[lo].clone().lerp(SPARK_PATH[hi], u);
}
// the trace: the wire behind the spark stays faintly lit, so the path reads as one line back to the sign
const TRACE = { uS: { value: 0 }, uTot: { value: pathLen[pathLen.length - 1] }, uOn: { value: 1 }, uHead: { value: 1 } };
{
  const pts = SPARK_PATH.filter((p, i) => i === 0 || p.distanceTo(SPARK_PATH[i - 1]) > 0.02);
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  TRACE.uTot.value = curve.getLength();
  const g = new THREE.TubeGeometry(curve, pts.length * 3, 0.03, 5, false);
  const m = new THREE.ShaderMaterial({ uniforms: TRACE, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: 'varying float vS; uniform float uTot; void main(){ vS = uv.x * uTot; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying float vS; uniform float uS, uOn, uHead; void main(){ float d = uS - vS; if (d < 0.0) discard;
      float k = uOn * (0.35 + uHead * 3.0 * exp(-d / 6.0) + uHead * 0.9 * exp(-d / 50.0)); gl_FragColor = vec4(vec3(0.62, 0.78, 1.0) * k, 1.0); }` });
  const tr = new THREE.Mesh(g, m); tr.renderOrder = 7; tr.frustumCulled = false; town.add(tr);
}
// arc length at a given x on the street primary (phase C)
const S_FEED_END = pathLen[feed.length + drop.length + 1];
function sAtX(x) {                      // arc length at x, INTERPOLATED between catenary vertices (v4 snapped to the next vertex: ~2 m steps, the "dropped frames")
  for (let i = feed.length + drop.length; i < SPARK_PATH.length; i++) if (SPARK_PATH[i].x >= x) {
    const a = SPARK_PATH[i - 1], b = SPARK_PATH[i], u = clamp((x - a.x) / Math.max(1e-6, b.x - a.x));
    return lerp(pathLen[i - 1], pathLen[i], u);
  }
  return pathLen[pathLen.length - 1];
}

// ---------------------------------------------------------------- main street: low brick fronts, a few lit shopfronts
{
  const r = rng(77), g1 = [], lit = [];
  const facadeTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#2a1c16'; g.fillRect(0, 0, w, h); g.fillStyle = '#0b0908'; for (let y = 30; y < 110; y += 60) for (let x = 20; x < w; x += 60) g.fillRect(x, y, 30, 40); g.fillStyle = '#1a1210'; g.fillRect(0, 150, w, 8); }, {});
  const fm = new THREE.MeshStandardMaterial({ map: facadeTex, roughness: 0.9 });
  for (const side of [-1, 1]) for (let x = side < 0 ? 9 : -30; x < 420; ) {
    const w = 8 + r() * 14, h = 4 + r() * 6, d = 12 + r() * 10, z = side < 0 ? -15 - d / 2 : 15 + d / 2;
    if (side < 0 && x < 8) { x += w; continue; }
    if (!(side < 0 && x > 76 && x < 124) && !(side < 0 && x > 150 && x < 200) && !(side < 0 && x > 214 && x < 290)) {
      g1.push(box(w - 0.3, h, d, x + w / 2, h / 2, z));
      if (r() < 0.35) { lit.push([x + w / 2, side]); glowT.add(V3(x + w / 2, 1.6, side * 14.9), w * 0.5, 1.6, [0.9, 0.55, 0.25].map(v => v * 0.25), 3); poolsT.add(x + w / 2, side * 12.5, 4, [0.5, 0.3, 0.12]); }
    }
    x += w;
  }
  town.add(new THREE.Mesh(merged(g1), fm));
}

// ---------------------------------------------------------------- the motel sign, the gas canopy, the water tower
const signs = { motel: null, gas: null, tower: null };
const gasX = () => 170;
{
  // the motel sign stands on its own pole just behind the north curb, under the line (the spark passes over it)
  const mx = 92, mz = -12.5;
  town.add(new THREE.Mesh(merged([rod(V3(mx, 0, mz), V3(mx, 7.0, mz), 0.16, 8), box(30, 3.4, 10, mx + 14, 1.7, mz - 14)]), M.dark));
  const mt = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#0a0505'; g.fillRect(0, 0, w, h); g.lineCap = 'round'; g.lineJoin = 'round';
    const glowLine = (col, wid, f) => { g.save(); g.strokeStyle = col; g.shadowColor = col; g.shadowBlur = 18; g.lineWidth = wid; f(); g.restore(); g.save(); g.strokeStyle = '#fff6ee'; g.lineWidth = wid * 0.35; f(); g.restore(); };
    glowLine('#ff3a1a', 10, () => { g.font = '900 128px Overpass'; g.textAlign = 'center'; g.strokeText('MOTEL', w / 2, 150); });
    glowLine('#ff3a1a', 6, () => { g.strokeRect(14, 14, w - 28, h - 28); });
    glowLine('#ff3a1a', 7, () => { g.beginPath(); g.moveTo(40, 210); g.lineTo(430, 210); g.lineTo(400, 185); g.moveTo(430, 210); g.lineTo(400, 235); g.stroke(); });
  });
  const mm = new THREE.MeshBasicMaterial({ map: mt, color: new THREE.Color(1.6, 1.6, 1.6) });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.6), mm); panel.position.set(mx, 8.4, mz + 0.2); panel.rotation.y = -0.18; town.add(panel);   // faces the road (south)
  town.add(new THREE.Mesh(box(5.3, 2.7, 0.3, mx, 8.4, mz, -0.18), M.dark));
  signs.motel = mm; glowT.add(V3(mx, 8.4, mz + 0.5), 7, 4, [0.8, 0.1, 0.04], 2, 0.3); reflT.add(V3(mx, 8.4, mz + 4), 3, 1, [0.5, 0.06, 0.03], 2, 0.3);
  poolsT.add(mx, mz + 5, 6, [0.5, 0.06, 0.03]);
  // gas canopy, north side under the line: white-lit underside, a plain lit fascia to the road (no brand), pumps
  const gx = 170, gz = -21;
  const cm = new THREE.Mesh(merged([box(20, 0.9, 11, gx, 5.6, gz), rod(V3(gx - 6, 0, gz), V3(gx - 6, 5.2, gz), 0.25, 8), rod(V3(gx + 6, 0, gz), V3(gx + 6, 5.2, gz), 0.25, 8), box(1.2, 1.6, 0.6, gx - 4, 0.8, gz), box(1.2, 1.6, 0.6, gx + 4, 0.8, gz), box(14, 3.6, 9, gx + 14, 1.8, gz - 12)]), M.dark);
  town.add(cm);
  const under = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.1) });
  const ug = []; for (let i = -3; i <= 3; i++) for (const j of [-1, 1]) ug.push(box(1.2, 0.02, 1.2, gx + i * 2.8, 5.14, gz + j * 2.5));
  town.add(new THREE.Mesh(merged(ug), under));
  const fas = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.9, 0.95) });
  town.add(new THREE.Mesh(merged([box(20.1, 0.18, 0.05, gx, 5.85, gz + 5.52), box(20.1, 0.18, 0.05, gx, 5.4, gz + 5.52), box(0.05, 0.18, 11, gx - 10.02, 5.85, gz), box(0.05, 0.18, 11, gx + 10.02, 5.85, gz)]), fas));
  signs.gas = [under, fas];
  poolsT.add(gx, gz, 16, [0.9, 0.9, 0.85].map(v => v * 0.9)); poolsT.add(gx, gz + 10, 10, [0.5, 0.5, 0.48]);
  for (let i = -3; i <= 3; i += 2) reflT.add(V3(gx + i * 2.8, 5.1, gz + 8), 2.2, 1, [0.6, 0.6, 0.58], 2, 0.7);
  const pt = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#0a0a0c'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffb347'; g.font = '900 80px Overpass'; g.textAlign = 'center'; g.shadowColor = '#ff9a20'; g.shadowBlur = 10; g.fillText('3.59', w / 2, 110); g.fillText('3.89', w / 2, 210); });
  const pm = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: pt, color: new THREE.Color(1.4, 1.4, 1.4) })); pm.position.set(gx - 14, 6.5, gz + 5.1); town.add(pm);
  town.add(new THREE.Mesh(rod(V3(gx - 14, 0, gz + 4.9), V3(gx - 14, 5.5, gz + 4.9), 0.12, 8), M.dark));
  // water tower (north, far back): legs, a tank uplit from the floods below
  const tx = 206, tz = -32, tg = [];
  for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + 0.4; tg.push(rod(V3(tx + Math.cos(a) * 7, 0, tz + Math.sin(a) * 7), V3(tx + Math.cos(a) * 4.5, 30, tz + Math.sin(a) * 4.5), 0.35, 8)); }
  tg.push(rod(V3(tx, 0, tz), V3(tx, 30, tz), 0.6, 10));
  town.add(new THREE.Mesh(merged(tg), M.dark));
  const tankTex = canvasTex(64, 256, (g, w, h) => { const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, '#d9d0bd'); gr.addColorStop(0.5, '#6a6458'); gr.addColorStop(1, '#141312'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const tankM = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.6, emissive: 0xffffff, emissiveMap: tankTex, emissiveIntensity: 0.55 });
  const tank = new THREE.Mesh(merged([new THREE.CylinderGeometry(7, 7, 7, 32, 1, true).translate(tx, 34, tz), new THREE.SphereGeometry(7, 32, 10, 0, TAU, Math.PI / 2, Math.PI / 2).translate(tx, 30.5, tz)]), tankM); town.add(tank);
  town.add(new THREE.Mesh(new THREE.ConeGeometry(7.3, 3, 32).translate(tx, 39, tz), M.dark));
  signs.tower = tankM;
  // the tower's red aircraft beacon (it blinks) and its catwalk ring; a floodlit tank, so the shape reads against the glow
  glowT.add(V3(tx, 41.2, tz), 3.2, 3.2, [2.4, 0.12, 0.06], 1, 0.0);
  town.add(new THREE.Mesh(merged([new THREE.TorusGeometry(7.15, 0.09, 5, 40).rotateX(Math.PI / 2).translate(tx, 30.4, tz), new THREE.TorusGeometry(7.15, 0.07, 5, 40).rotateX(Math.PI / 2).translate(tx, 31.5, tz), rod(V3(tx, 40.3, tz), V3(tx, 41.4, tz), 0.06, 5)]), M.dark));
}

// ---------------------------------------------------------------- places a stranger can name: the motel's row of doors, the pumps, the main street at night
{
  const mx = 92, mz = -12.5, fz = -20.96;
  const doorLit = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.8, 0.3) }), doorDark = new THREE.MeshBasicMaterial({ color: 0x1c1512 }), winLit = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 0.7, 0.4) });
  const dl = [], dd = [], wl = [], wd = [], trim = [];
  for (let i = 0; i < 9; i++) {
    const x = mx + 3.0 + i * 3.3, lit = i % 3 !== 1;
    (lit ? dl : dd).push(box(1.0, 2.1, 0.06, x, 1.05, fz));
    (i % 2 ? wl : wd).push(box(1.3, 1.1, 0.06, x + 1.3, 1.55, fz));
    trim.push(box(0.5, 0.05, 0.05, x, 2.35, fz + 0.04));
    if (lit) { glowT.add(V3(x - 0.9, 2.4, fz + 0.4), 1.2, 1.2, [1.0, 0.62, 0.25].map(v => v * 0.9)); poolsT.add(x, fz + 4, 3.4, [0.9, 0.5, 0.2]); }
  }
  town.add(new THREE.Mesh(merged(dl), doorLit)); town.add(new THREE.Mesh(merged(dd), doorDark)); town.add(new THREE.Mesh(merged(wl), winLit)); town.add(new THREE.Mesh(merged(wd), doorDark));
  town.add(new THREE.Mesh(merged([box(31, 0.25, 1.8, mx + 15.5, 3.0, fz + 0.9), ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(k => rod(V3(mx + 1.5 + k * 3, 0, fz + 1.6), V3(mx + 1.5 + k * 3, 3.0, fz + 1.6), 0.05, 6))]), M.dark));
  town.add(new THREE.Mesh(merged([box(0.6, 3.4, 0.5, mx + 1.5, 1.7, fz - 0.25)]), M.dark));
  // parked cars (low dark boxes with a cabin), red tail lamps toward the camera side
  const cars = [];
  for (const [cx, cz, ry] of [[mx + 6.5, -17.2, 0.1], [mx + 17.5, -16.5, -0.08]]) {
    cars.push(box(4.4, 0.62, 1.8, cx, 0.62, cz, ry), box(2.3, 0.55, 1.6, cx - 0.2, 1.15, cz, ry));
    glowT.add(V3(cx + 2.1, 0.7, cz + 0.6), 0.35, 0.3, [1.6, 0.05, 0.03]); glowT.add(V3(cx + 2.1, 0.7, cz - 0.6), 0.35, 0.3, [1.6, 0.05, 0.03]);
  }
  town.add(new THREE.Mesh(merged(cars), new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.25, metalness: 0.5 })));
  // a second neon under the sign: VACANCY
  const vt = canvasTex(512, 128, (g, w, h) => { g.fillStyle = '#04080a'; g.fillRect(0, 0, w, h); g.textAlign = 'center'; g.font = '900 86px Overpass'; g.save(); g.shadowColor = '#40ffb0'; g.shadowBlur = 16; g.strokeStyle = '#30e8a0'; g.lineWidth = 9; g.strokeText('VACANCY', w / 2, 98); g.restore(); g.strokeStyle = '#f0fff8'; g.lineWidth = 3; g.strokeText('VACANCY', w / 2, 98); });
  const vm = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.05), new THREE.MeshBasicMaterial({ map: vt, color: new THREE.Color(1.5, 1.5, 1.5) })); vm.position.set(mx, 6.55, mz + 0.2); vm.rotation.y = -0.18; town.add(vm);
  town.add(new THREE.Mesh(box(4.3, 1.1, 0.3, mx, 6.55, mz, -0.18), M.dark)); glowT.add(V3(mx, 6.55, mz + 0.5), 5, 2, [0.1, 0.9, 0.55].map(v => v * 0.6));
  // the pumps and the price pylon
  const gx = 170, gz = -21, pm = [], pl = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.3, 1.25) });
  for (const px of [-5.6, -2.8, 0, 2.8, 5.6]) for (const pz of [-2.2, 2.2]) { pm.push(box(0.5, 1.6, 0.4, gx + px, 0.8, gz + pz)); }
  town.add(new THREE.Mesh(merged(pm), new THREE.MeshStandardMaterial({ color: 0x8a1e1a, roughness: 0.4, metalness: 0.2 })));
  const pf = []; for (const px of [-5.6, -2.8, 0, 2.8, 5.6]) for (const pz of [-2.2, 2.2]) pf.push(box(0.3, 0.3, 0.02, gx + px, 1.25, gz + pz + 0.21), box(0.3, 0.3, 0.02, gx + px, 1.25, gz + pz - 0.21));
  town.add(new THREE.Mesh(merged(pf), pl));
  town.add(new THREE.Mesh(merged([box(11.8, 0.16, 5.4, gx, 0.08, gz), box(0.5, 0.5, 4.4, gx, 0.25, gz)]), new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.5 })));
  // a car at the pump, lit by the canopy
  town.add(new THREE.Mesh(merged([box(4.2, 0.7, 1.8, gx - 1.4, 0.7, gz + 5.2, 0.05), box(2.2, 0.55, 1.6, gx - 1.6, 1.28, gz + 5.2, 0.05)]), new THREE.MeshStandardMaterial({ color: 0x6d1a18, roughness: 0.3, metalness: 0.4 })));
}

// ---------------------------------------------------------------- the county courthouse (x = 330, north side, facing the road)
// Civic grammar a stranger reads at a glance: a temple front (steps, six columns, entablature, pediment) on a two-storey
// block with sash windows (dark glass, white 6-over-6 muntins, stone lintels and sills), two lower wings, a clock stage
// with four lit faces at 2:00, a dark verdigris cupola, and the flag on the lawn pole. Lit ONCE: uplights at the base
// strike on as the spark reaches the building (strikeEnvelope), then hold; before that it is a dark mass with a clock.
const CH = { x: 250, z: -52 };
const clock = { mats: [] };
const court = { up: [], stone: null, flag: null, flagGeo: null, flagP0: null, winMat: null };
{
  const stoneTex = canvasTex(1024, 1024, (g, w, h) => {
    noiseFill(g, w, h, [178, 168, 148], 18, 21, 2);
    g.strokeStyle = 'rgba(70,62,50,0.45)'; g.lineWidth = 2;
    for (let y = 0; y < h; y += 42) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); for (let x = ((y / 42) % 2) * 60; x < w; x += 120) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 42); g.stroke(); } }
    const r = rng(8); for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(${r() < 0.5 ? 90 : 210},${r() < 0.5 ? 84 : 200},${r() < 0.5 ? 70 : 180},0.18)`; g.fillRect(r() * w, r() * h, 2 + r() * 5, 1 + r() * 3); }
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(40,30,20,0.25)'); gr.addColorStop(1, 'rgba(40,30,20,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, { repeat: [4, 3] });
  const stone = new THREE.MeshStandardMaterial({ color: 0xb8ad98, map: stoneTex, roughness: 0.82 });
  court.stone = stone;
  const cop = new THREE.MeshStandardMaterial({ color: 0x1c2a26, roughness: 0.45, metalness: 0.35 });   // verdigris, read dark
  const { x, z } = CH, g = [], zf = z + 12;
  // plinth + steps (seven risers to the portico)
  g.push(box(52, 1.4, 26, x, 0.7, z));
  for (let s = 0; s < 7; s++) g.push(box(30 - s * 0.4, 0.2, 7.5 - s * 0.62, x, 0.1 + s * 0.2, zf + 4.4 - s * 0.31));
  g.push(box(30, 0.3, 4.2, x, 1.25, zf + 2.2));                                        // the portico floor
  // the main block (two storeys) and the wings
  g.push(box(32, 14, 22, x, 1.4 + 7, z));
  for (const s of [-1, 1]) { g.push(box(12, 9, 18, x + s * 22, 1.4 + 4.5, z - 1)); g.push(box(12.6, 0.7, 18.6, x + s * 22, 1.4 + 9.2, z - 1)); g.push(box(12.4, 0.35, 18.4, x + s * 22, 1.4 + 4.3, z - 1)); }
  // string course, cornice, entablature over the portico, the pediment with its raking cornice
  g.push(box(32.6, 0.4, 22.6, x, 1.4 + 6.6, z));
  g.push(box(33.4, 1.0, 23.4, x, 1.4 + 14.3, z));
  g.push(box(29.2, 1.6, 5.2, x, 12.2 + 1.4, zf + 2.2));
  g.push(box(29.8, 0.35, 5.6, x, 13.15 + 1.4, zf + 2.2));
  const ped = new THREE.Shape(); ped.moveTo(-14.9, 0); ped.lineTo(14.9, 0); ped.lineTo(0, 4.3); ped.closePath();
  const pg = new THREE.ExtrudeGeometry(ped, { depth: 5.4, bevelEnabled: false }); pg.translate(x, 14.7, zf - 0.5); g.push(pg);
  // the tympanum set back, darker (a shadow plane that reads the triangle)
  const tym = new THREE.Shape(); tym.moveTo(-13.2, 0.45); tym.lineTo(13.2, 0.45); tym.lineTo(0, 3.7); tym.closePath();
  g.push(box(33, 1.0, 23, x, 16.2 - 0.9, z));
  // drum (the clock stage), belfry, cupola
  g.push(box(8.4, 1.2, 8.4, x, 17.4, z + 2));
  g.push(box(7.0, 5.8, 7.0, x, 20.9, z + 2));
  g.push(box(7.8, 0.5, 7.8, x, 24.0, z + 2));
  town.add(new THREE.Mesh(merged(g), stone));
  { const tg = new THREE.ExtrudeGeometry(tym, { depth: 0.2, bevelEnabled: false }); tg.translate(x, 14.7, zf + 4.95); town.add(new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: 0x6a6252, roughness: 0.9 }))); }
  const cg2 = [new THREE.CylinderGeometry(2.7, 3.3, 3.0, 8).translate(x, 25.8, z + 2), new THREE.SphereGeometry(2.9, 20, 10, 0, TAU, 0, Math.PI / 2).scale(1, 1.25, 1).translate(x, 27.2, z + 2), rod(V3(x, 30.6, z + 2), V3(x, 33.2, z + 2), 0.08, 6)];
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + TAU / 16; cg2.push(box(0.35, 2.2, 0.35, x + Math.cos(a) * 2.95, 25.7, z + 2 + Math.sin(a) * 2.95)); }
  town.add(new THREE.Mesh(merged(cg2), cop));
  // the portico columns: fluted (24 facets with alternating radius), base and capital
  const cols = [];
  for (let i = 0; i < 6; i++) {
    const cx = x - 12.5 + i * 5, cz = zf + 2.2;
    const c = new THREE.CylinderGeometry(0.62, 0.72, 10.0, 24, 1); const P = c.attributes.position;
    for (let k = 0; k < P.count; k++) { const a = Math.atan2(P.getZ(k), P.getX(k)), f = 1 - 0.035 * (0.5 + 0.5 * Math.cos(a * 12)); P.setX(k, P.getX(k) * f); P.setZ(k, P.getZ(k) * f); }
    c.computeVertexNormals(); c.translate(cx, 1.4 + 0.3 + 5.0, cz); cols.push(c);
    cols.push(box(1.7, 0.35, 1.7, cx, 1.4 + 0.3 + 0.17, cz), new THREE.CylinderGeometry(0.82, 0.82, 0.28, 20).translate(cx, 1.4 + 0.3 + 0.45, cz));
    cols.push(box(1.75, 0.3, 1.75, cx, 1.4 + 10.45 + 0.15, cz), new THREE.CylinderGeometry(0.85, 0.66, 0.4, 20).translate(cx, 1.4 + 10.2, cz));
  }
  town.add(new THREE.Mesh(merged(cols), stone));
  { // the name cut in the frieze: COUNTY COURTHOUSE, incised capitals on the entablature (a stranger reads the seat of government)
    const ft = canvasTex(2048, 112, (g2, w, h) => { g2.fillStyle = '#b9ae98'; g2.fillRect(0, 0, w, h); const r = rng(14); for (let i = 0; i < 700; i++) { g2.fillStyle = `rgba(${r() < 0.5 ? 90 : 220},${r() < 0.5 ? 84 : 210},${r() < 0.5 ? 70 : 190},0.16)`; g2.fillRect(r() * w, r() * h, 2 + r() * 5, 1 + r() * 3); }
      g2.font = '700 78px "DejaVu Serif", "Liberation Serif", serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle'; const T = 'COUNTY COURTHOUSE', ls = 14; let tw = 0; for (const ch of T) tw += g2.measureText(ch).width + ls; let cx = w / 2 - tw / 2;
      g2.textAlign = 'left'; for (const ch of T) { g2.fillStyle = 'rgba(255,248,230,0.55)'; g2.fillText(ch, cx + 2, h / 2 + 4); g2.fillStyle = '#2a2218'; g2.fillText(ch, cx, h / 2 + 2); cx += g2.measureText(ch).width + ls; } });
    const fr = new THREE.Mesh(new THREE.PlaneGeometry(26, 1.42), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.85, emissive: 0xffffff, emissiveMap: ft, emissiveIntensity: 0.5 })); fr.position.set(x, 13.6 + 0.0, zf + 4.83); town.add(fr); }
  // sash windows: a texture per facade bay, dark glass, white muntins 6-over-6, stone lintel and sill, a lit office or two
  const winTex = (lit) => canvasTex(128, 256, (g2, w, h) => {
    g2.fillStyle = '#b3a890'; g2.fillRect(0, 0, w, h);
    g2.fillStyle = '#d6ccb4'; g2.fillRect(8, 6, w - 16, 26); g2.fillRect(4, h - 22, w - 8, 14);                  // lintel, sill
    g2.fillStyle = '#e8e2d2'; g2.fillRect(14, 34, w - 28, h - 58);                                             // frame
    const gl = g2.createLinearGradient(0, 40, 0, h - 30); gl.addColorStop(0, lit ? '#5a3a1a' : '#0b0f14'); gl.addColorStop(1, lit ? '#9a6a2a' : '#141a20');
    g2.fillStyle = gl; g2.fillRect(20, 40, w - 40, h - 70);
    g2.fillStyle = '#ece6d6';
    const mx = [20 + (w - 40) / 3, 20 + 2 * (w - 40) / 3], my = [40 + (h - 70) / 6, 40 + 2 * (h - 70) / 6, 40 + 4 * (h - 70) / 6, 40 + 5 * (h - 70) / 6];
    for (const xx of mx) g2.fillRect(xx - 2, 40, 4, h - 70);
    for (const yy of my) g2.fillRect(20, yy - 2, w - 40, 4);
    g2.fillRect(18, 40 + (h - 70) / 2 - 5, w - 36, 10);                                                        // the meeting rail
  }, { mip: true });
  const wD = new THREE.MeshStandardMaterial({ map: winTex(false), roughness: 0.5, emissive: 0xffffff, emissiveMap: winTex(false), emissiveIntensity: 0.0 });
  const wL = new THREE.MeshStandardMaterial({ map: winTex(true), roughness: 0.5, emissive: 0xffb060, emissiveMap: winTex(true), emissiveIntensity: 0.35 });
  court.winMat = wD;
  const winsD = [], winsL = [];
  const addWin = (cx, cy, cz, ry = 0, lit = false) => { const p = new THREE.PlaneGeometry(1.8, 3.6); if (ry) p.rotateY(ry); p.translate(cx, cy, cz); (lit ? winsL : winsD).push(p); };
  const fz = z + 11 + 0.03;
  for (const yy of [1.4 + 3.6, 1.4 + 10.2]) for (let i = 0; i < 6; i++) { const cx = x - 12.5 + 2.5 + i * 5 - (i >= 3 ? 0 : 0); if (Math.abs(cx - x) < 2 && yy < 6) continue; addWin(x - 13 + i * 5.2, yy, fz, 0, i === 4 && yy > 8); }
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) addWin(x + s * 22 - 4 + i * 4, 1.4 + 4.6 - 0.2, z - 1 + 9 + 0.03, 0, s > 0 && i === 0);
  town.add(new THREE.Mesh(merged(winsD), wD)); town.add(new THREE.Mesh(merged(winsL), wL));
  // the doors: tall, dark, a transom lit warm
  town.add(new THREE.Mesh(merged([box(3.0, 5.4, 0.2, x, 1.7 + 2.7, fz - 0.05)]), new THREE.MeshStandardMaterial({ color: 0x0c0a08, roughness: 0.5 })));
  town.add(new THREE.Mesh(box(3.0, 0.9, 0.05, x, 1.7 + 5.95, fz), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.55, 0.22) })));
  // four clock faces at 2:00, lit from within, 5 m across (reads at feed size from the lawn)
  const ct = canvasTex(512, 512, (g2, w) => {
    const c = w / 2; const gr = g2.createRadialGradient(c, c, 0, c, c, c); gr.addColorStop(0, '#fff6de'); gr.addColorStop(0.88, '#f2dcae'); gr.addColorStop(0.9, '#2a2016'); gr.addColorStop(1, '#2a2016'); g2.fillStyle = gr; g2.beginPath(); g2.arc(c, c, c - 2, 0, TAU); g2.fill();
    g2.strokeStyle = '#1b1510'; g2.lineCap = 'butt';
    for (let i = 0; i < 60; i++) { const a = i / 60 * TAU, big = i % 5 === 0; g2.lineWidth = big ? 16 : 4; g2.beginPath(); g2.moveTo(c + Math.cos(a) * (big ? 176 : 200), c + Math.sin(a) * (big ? 176 : 200)); g2.lineTo(c + Math.cos(a) * 218, c + Math.sin(a) * 218); g2.stroke(); }
    g2.lineCap = 'round'; g2.strokeStyle = '#120e0a';
    const hand = (a, L, wd) => { g2.lineWidth = wd; g2.beginPath(); g2.moveTo(c - Math.sin(a) * L * 0.18, c + Math.cos(a) * L * 0.18); g2.lineTo(c + Math.sin(a) * L, c - Math.cos(a) * L); g2.stroke(); };
    hand(2 / 12 * TAU, 120, 26); hand(0, 188, 14);
    g2.fillStyle = '#120e0a'; g2.beginPath(); g2.arc(c, c, 16, 0, TAU); g2.fill();
  });
  const cm = new THREE.MeshBasicMaterial({ map: ct, color: new THREE.Color(1.25, 1.18, 1.0) }); clock.mats.push(cm);
  for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.CircleGeometry(2.5, 48), cm); const a = i * Math.PI / 2; f.position.set(x + Math.sin(a) * 3.53, 21.2, z + 2 + Math.cos(a) * 3.53); f.rotation.y = a; town.add(f);
    const bez = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.12, 6, 40), M.dark); bez.position.copy(f.position); bez.rotation.y = a; town.add(bez); }
  glowT.add(V3(x, 21.2, z + 6.2), 7, 7, [0.9, 0.7, 0.4].map(v => v * 0.3));
  // the lamps on the steps + the flag on the lawn pole (the one flag in town), lit by a small spot at its foot
  for (const dx of [-17, 17]) { town.add(new THREE.Mesh(merged([rod(V3(x + dx, 1.4, zf + 7.8), V3(x + dx, 5.2, zf + 7.8), 0.09, 8), new THREE.SphereGeometry(0.34, 12, 8).translate(x + dx, 5.5, zf + 7.8)]), M.dark)); glowT.add(V3(x + dx, 5.5, zf + 7.8), 1.4, 1.4, [1.2, 1.0, 0.7]); poolsT.add(x + dx, zf + 8, 7, [0.6, 0.5, 0.35]); }
  const fpx = x - 24, fpz = zf + 16;
  town.add(new THREE.Mesh(merged([rod(V3(fpx, 0, fpz), V3(fpx, 16.5, fpz), 0.1, 8, 0.06), new THREE.SphereGeometry(0.16, 10, 8).translate(fpx, 16.6, fpz)]), M.steel));
  const flT = canvasTex(380, 200, (g2, w, h) => {
    for (let s = 0; s < 13; s++) { g2.fillStyle = s % 2 ? '#e8e2d4' : '#9a1620'; g2.fillRect(0, s * h / 13, w, h / 13 + 1); }
    g2.fillStyle = '#1c2446'; g2.fillRect(0, 0, w * 0.4, h * 7 / 13);
    g2.fillStyle = '#e8e2d4'; for (let r0 = 0; r0 < 9; r0++) for (let c0 = 0; c0 < (r0 % 2 ? 5 : 6); c0++) { g2.beginPath(); g2.arc(8 + c0 * 24 + (r0 % 2 ? 12 : 0), 7 + r0 * 11.5, 3, 0, TAU); g2.fill(); }
  });
  const fg = new THREE.PlaneGeometry(4.2, 2.2, 24, 8); fg.translate(2.1, 0, 0);
  court.flagGeo = fg; court.flagP0 = fg.attributes.position.array.slice();
  const fm = new THREE.MeshStandardMaterial({ map: flT, roughness: 0.8, side: THREE.DoubleSide });
  const flag = new THREE.Mesh(fg, fm); flag.position.set(fpx + 0.05, 15.3, fpz); flag.rotation.y = -0.5; town.add(flag); court.flag = flag;
  // uplights: flush ground washers along the portico base and the wings (the ONE strike drives them)
  for (let i = 0; i < 6; i++) { const cx = x - 12.5 + i * 5; court.up.push({ p: V3(cx, 1.75, zf + 3.6), t: V3(cx, 12, zf + 1.6) }); }
  court.flagSpot = { p: V3(fpx + 3, 0.3, fpz + 4), t: V3(fpx + 1.6, 15, fpz) };
}

// ---------------------------------------------------------------- the county: black fields, tree lines, a few yard lights, far towns
{
  const treeTex = canvasTex(2048, 128, (g, w, h) => { g.clearRect(0, 0, w, h); const r = rng(31); g.fillStyle = '#000'; let x = 0; while (x < w) { const rr = 10 + r() * 30, hh = h * (0.35 + r() * 0.55); g.beginPath(); g.ellipse(x, h - hh * 0.5, rr, hh * 0.5, 0, 0, TAU); g.fill(); x += rr * (0.8 + r()); } g.fillRect(0, h - 10, w, 10); }, { srgb: false });
  const tm = new THREE.MeshBasicMaterial({ color: 0x050506, alphaMap: treeTex, transparent: true, alphaTest: 0.4, fog: true });
  for (const [z, x0, x1, hh] of [[-140, 380, 1300, 14], [120, 400, 1300, 12], [-420, -200, 1400, 20], [360, -200, 1400, 18]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, hh), tm); m.position.set((x0 + x1) / 2, hh / 2, z); town.add(m); }
  const r = rng(41);
  for (let i = 0; i < 26; i++) { const x = 380 + r() * 900, z = (r() < 0.5 ? -1 : 1) * (60 + r() * 500); glowT.add(V3(x, 6, z), 2.5, 2.5, [0.9, 0.6, 0.35].map(v => v * (0.5 + r())), 3); }
  // the neighbourhood between the courthouse and the work pole (the payoff's town): a grid of streets with house lamps and lit windows,
  // each glow a kind-3 sprite that comes on as the relight wave passes its x. A phone has to see a town, so it is a grid, not a dust of dots.
  { const r3 = rng(2026), houses = [];
    for (let zr = -190; zr <= 190; zr += 38) { if (Math.abs(zr) < 14) continue;
      for (let x = 318; x < 548; x += 21) {
        const jx = x + (r3() - 0.5) * 6, jz = zr + (r3() - 0.5) * 8;
        glowT.add(V3(jx, 6.8, jz + (zr > 0 ? -8 : 8)), 5.5, 5.5, SODIUM.map(v => v * (1.6 + 0.7 * r3())), 3);
        if (r3() < 0.9) glowT.add(V3(jx + 4, 2.3, jz), 4.2, 3.2, [1.0, 0.66, 0.3].map(v => v * (0.7 + 0.8 * r3())), 3);
        if (r3() < 0.55) glowT.add(V3(jx - 5, 2.4, jz + 3), 3.6, 2.8, [0.95, 0.8, 0.5].map(v => v * (0.6 + 0.7 * r3())), 3);
        houses.push(box(7 + r3() * 4, 3.5 + r3() * 2.5, 8 + r3() * 3, jx, 2.2, jz + (zr > 0 ? 7 : -7)));
      }
      glowT.add(V3(450, 0.5, zr), 120, 6, [0.5, 0.3, 0.12], 3);       // the street itself, lit along its length
    }
    for (let k = 0; k < 40; k++) poolsT.add(330 + r3() * 260, (r3() - 0.5) * 360, 12 + r3() * 8, SODIUM.map(v => v * 0.3));
    town.add(new THREE.Mesh(merged(houses), new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.9 })));
  }
  // the town behind on the horizon (for the payoff looking west): a band of sodium points
  for (let i = 0; i < 160; i++) { const x = -300 + r() * 700, z = -300 + r() * 600; glowT.add(V3(x, 3 + r() * 8, z), 3 + r() * 3, 3 + r() * 3, SODIUM.map(v => v * (0.6 + r() * 0.9)), 3); }
}

// ---------------------------------------------------------------- the utility truck (one design: the work truck, the convoy, the yard)
// Truck-local: +z forward (cab), +y up. The articulated boom: a pedestal at the rear, the lower boom pivots up from it, the
// upper boom from the knuckle, the fiberglass bucket hanging level at the tip. pose(a1, a2abs): lower boom pitch, upper
// boom absolute pitch (radians up from +z); stowed = (0, PI): the lower boom forward over the cab, the upper folded back.
const TRK = { pivot: V3(0, 3.35, -2.3), L1: 5.4, L2: 5.6 };
function truckBodyGeo() {
  const g = [];
  g.push(box(0.9, 0.28, 8.6, -0.55, 0.95, -0.3), box(0.9, 0.28, 8.6, 0.55, 0.95, -0.3));                 // frame rails
  g.push(box(2.3, 1.55, 2.0, 0, 2.05, 3.55));                                                             // cab
  g.push(box(2.2, 0.55, 1.9, 0, 2.95, 3.45));                                                             // cab roof (sloped by the windshield plane)
  g.push(box(2.2, 1.05, 1.5, 0, 1.75, 5.25));                                                             // hood
  g.push(box(2.45, 0.35, 0.25, 0, 1.05, 6.05));                                                           // bumper
  g.push(box(2.45, 1.55, 5.7, 0, 1.95, -0.55));                                                           // service body
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) g.push(box(0.03, 1.2, 1.25, s * 1.24, 2.0, 1.55 - k * 1.42));   // compartment doors (proud)
  g.push(box(2.5, 0.12, 5.8, 0, 2.78, -0.55));                                                            // deck edge
  g.push(new THREE.CylinderGeometry(0.55, 0.65, 0.7, 16).translate(TRK.pivot.x, 3.0, TRK.pivot.z));      // pedestal
  g.push(box(0.8, 0.12, 0.9, 0, 3.05, 3.1), rod(V3(0, 2.8, 3.1), V3(0, 3.05, 3.1), 0.08, 6));            // boom rest over the cab
  for (const s of [-1, 1]) g.push(rod(V3(s * 1.1, 1.0, -2.9), V3(s * 1.9, 0.08, -2.9), 0.09, 6), box(0.45, 0.06, 0.45, s * 1.9, 0.04, -2.9));   // outriggers
  return merged(g);
}
function truckTireGeo() { const w = []; for (const zz of [4.6, -1.7, -3.0]) for (const s of [-1, 1]) w.push(new THREE.CylinderGeometry(0.53, 0.53, zz > 0 ? 0.32 : 0.58, 18).rotateZ(Math.PI / 2).translate(s * 1.02, 0.53, zz)); return merged(w); }
function truckGlassGeo() { return merged([box(2.1, 0.8, 0.05, 0, 2.55, 4.52).rotateX(0), box(0.05, 0.7, 1.4, 1.16, 2.55, 3.6), box(0.05, 0.7, 1.4, -1.16, 2.55, 3.6)]); }
function boomGeo(L, r0, r1) { const g = new THREE.BoxGeometry(r0 * 2, r0 * 1.6, L); g.translate(0, 0, L / 2); const P = g.attributes.position; for (let i = 0; i < P.count; i++) { const k = 1 - (P.getZ(i) / L) * (1 - r1 / r0); P.setX(i, P.getX(i) * k); P.setY(i, P.getY(i) * k); } g.computeVertexNormals(); return g; }
// the fiberglass bucket: a rounded-square open shell with a rolled lip, a dark liner edge and a jib stub
function bucketGeos({ w = 0.78, h = 0.98, r = 0.14, t = 0.035 } = {}) {
  const rr = (s, hw, rad) => { const x0 = -hw, x1 = hw; s.moveTo(x0 + rad, x0); s.lineTo(x1 - rad, x0); s.quadraticCurveTo(x1, x0, x1, x0 + rad); s.lineTo(x1, x1 - rad); s.quadraticCurveTo(x1, x1, x1 - rad, x1); s.lineTo(x0 + rad, x1); s.quadraticCurveTo(x0, x1, x0, x1 - rad); s.lineTo(x0, x0 + rad); s.quadraticCurveTo(x0, x0, x0 + rad, x0); return s; };
  const outer = rr(new THREE.Shape(), w / 2, r); outer.holes.push(rr(new THREE.Path(), w / 2 - t, r - t * 0.7));
  const shell = new THREE.ExtrudeGeometry(outer, { depth: h, bevelEnabled: false, curveSegments: 6 }); shell.rotateX(-Math.PI / 2);
  const lipS = rr(new THREE.Shape(), w / 2 + 0.03, r + 0.02); lipS.holes.push(rr(new THREE.Path(), w / 2 - t, r - t * 0.7));
  const lip = new THREE.ExtrudeGeometry(lipS, { depth: 0.06, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 6 }); lip.rotateX(-Math.PI / 2); lip.translate(0, h - 0.05, 0);
  const floor = new THREE.ExtrudeGeometry(rr(new THREE.Shape(), w / 2, r), { depth: 0.04, bevelEnabled: false, curveSegments: 6 }); floor.rotateX(-Math.PI / 2);
  const liner = new THREE.ExtrudeGeometry((() => { const s = rr(new THREE.Shape(), w / 2 - t, r - t * 0.7); s.holes.push(rr(new THREE.Path(), w / 2 - t - 0.012, r - t)); return s; })(), { depth: 0.18, bevelEnabled: false, curveSegments: 6 }); liner.rotateX(-Math.PI / 2); liner.translate(0, h - 0.2, 0);
  return { shell: merged([shell, lip, floor]), liner };
}
const fleetM = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.5, metalness: 0.1 });
const fiberM = new THREE.MeshStandardMaterial({ color: 0x8e8670, roughness: 0.55, metalness: 0.0 });
const glassM = new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.05, metalness: 0.3 });
// the stencilled mark: the ACP emblem (gear, hammer and sickle, the four stripes) in dark paint, slightly worn
const emblemTex = canvasTex(512, 512, (g2, w) => { g2.clearRect(0, 0, w, w); acpEmblem(g2, w / 2, w / 2, 330, { color: '#15110e' });
  g2.globalCompositeOperation = 'destination-out'; const r = rng(3); for (let i = 0; i < 900; i++) { g2.globalAlpha = 0.25 + r() * 0.5; g2.fillRect(r() * w, r() * w, 1 + r() * 4, 1 + r() * 2); } g2.globalCompositeOperation = 'source-over'; g2.globalAlpha = 1; });
const emblemM = new THREE.MeshStandardMaterial({ map: emblemTex, transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });

// ---------------------------------------------------------------- the work site: pole 15 (x = 608), cutout, bucket truck, the lineman
const WX = PX(WORK), WZ = POLE_Z;
const site = {};
{
  // the transformer can on the pole (east side) and the fused cutout on a bracket above it (east side, facing east)
  const g = [];
  g.push(rod(V3(WX + 0.42, 8.3, WZ), V3(WX + 0.42, 9.3, WZ), 0.3, 16));
  g.push(box(0.5, 0.06, 0.06, WX + 0.2, 9.35, WZ));
  town.add(new THREE.Mesh(merged(g), M.can));
  town.add(new THREE.Mesh(merged([box(0.9, 0.08, 0.08, WX + 0.45, 10.35, WZ), rod(V3(WX + 0.1, 10.0, WZ), V3(WX + 0.8, 10.35, WZ), 0.025, 4)]), M.steel));
  // cutout porcelain body: a skirted lathe, tilted 20 deg off vertical, at the bracket's east end
  const prof = []; prof.push(new THREE.Vector2(0.001, -0.3)); for (let i = 0; i <= 7; i++) { const y = -0.28 + i * 0.08; prof.push(new THREE.Vector2(0.045, y - 0.02), new THREE.Vector2(0.085, y), new THREE.Vector2(0.045, y + 0.03)); } prof.push(new THREE.Vector2(0.001, 0.36));
  const body = new THREE.LatheGeometry(prof, 16);
  const cut = new THREE.Group(); cut.position.set(WX + 0.85, 10.05, WZ); cut.rotation.z = -0.35; town.add(cut);
  cut.add(new THREE.Mesh(body, rimify(new THREE.MeshStandardMaterial({ color: 0x6a5a4c, roughness: 0.2 }), 1.2)));
  cut.add(new THREE.Mesh(merged([box(0.12, 0.05, 0.16, 0.1, 0.33, 0), box(0.1, 0.06, 0.14, 0.1, -0.28, 0)]), M.steel));
  const door = new THREE.Group(); door.position.set(0.14, -0.28, 0); cut.add(door);
  door.add(new THREE.Mesh(merged([rod(V3(0, 0, 0), V3(0, 0.6, 0), 0.03, 10), box(0.08, 0.05, 0.09, 0, 0.6, 0)]), rimify(new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.5 }), 1.0)));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 16).translate(0.05, 0.64, 0), M.steel); door.add(ring);
  site.cut = cut; site.door = door; site.ring = ring;
  town.add(new THREE.Mesh(merged([tube([V3(WX, PH[2].y, WZ + PH[2].dz), V3(WX + 0.5, 10.9, WZ + 0.6), V3(WX + 0.95, 10.4, WZ)], 0.008, 4), tube([V3(WX + 0.95, 9.75, WZ), V3(WX + 0.7, 9.4, WZ + 0.1), V3(WX + 0.42, 9.34, WZ + 0.05)], 0.008, 4)]), M.wire));

  // the bucket truck (on the road east of the pole, cab west), the boom solved to the bucket
  site.bucket = V3(WX + 2.2, 7.25, WZ + 0.9);                         // bucket floor centre, 1.45 m off the cutout
  const T = new THREE.Group(); T.position.set(WX + 9.5, 0, -2.4); T.rotation.y = -Math.PI / 2; town.add(T);   // local +z -> world -x
  T.add(new THREE.Mesh(truckBodyGeo(), fleetM), new THREE.Mesh(truckTireGeo(), M.tire), new THREE.Mesh(truckGlassGeo(), glassM));
  T.updateMatrixWorld(true);
  const tw = p => p.clone().applyMatrix4(T.matrixWorld);
  // boom: world two-bone IK from the pedestal pivot to the bucket's attach point (the turret yaws toward it)
  const P0 = tw(TRK.pivot), attach = site.bucket.clone().add(V3(0.52, 0.55, 0.12));
  const hz = V3(attach.x - P0.x, 0, attach.z - P0.z), dh = hz.length(), dv = attach.y - P0.y, D = Math.hypot(dh, dv); hz.normalize();
  const a = Math.acos(clamp((TRK.L1 ** 2 + D * D - TRK.L2 ** 2) / (2 * TRK.L1 * D), -1, 1)), base = Math.atan2(dv, dh);
  const knee = P0.clone().addScaledVector(hz, TRK.L1 * Math.cos(base + a)).add(V3(0, TRK.L1 * Math.sin(base + a), 0));
  town.add(new THREE.Mesh(merged([between(new THREE.CylinderGeometry(0.2, 0.26, 1, 6), P0, knee)]), fleetM));
  town.add(new THREE.Mesh(merged([between(new THREE.CylinderGeometry(0.13, 0.17, 1, 6), knee, attach), new THREE.SphereGeometry(0.3, 10, 8).translate(knee.x, knee.y, knee.z)]), fiberM));
  town.add(new THREE.Mesh(merged([rod(attach, site.bucket.clone().add(V3(0.42, 0.55, 0.1)), 0.09, 6), box(0.12, 0.9, 0.12, site.bucket.x + 0.45, site.bucket.y + 0.5, site.bucket.z + 0.1)]), M.steel));
  // the bucket itself, the stencil on its two outer faces (east, toward the truck; south, toward the road)
  const BG = bucketGeos(), bk = new THREE.Group(); bk.position.copy(site.bucket); town.add(bk); site.bk = bk;
  bk.add(new THREE.Mesh(BG.shell, fiberM), new THREE.Mesh(BG.liner, new THREE.MeshStandardMaterial({ color: 0x141312, roughness: 0.8 })));
  for (const [ry, off] of [[Math.PI / 2, V3(0.395, 0.52, 0)], [0, V3(0, 0.52, 0.395)]]) { const e = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.52), emblemM); e.position.copy(off); e.rotation.y = ry; bk.add(e); }
  // amber strobes: the cab light bar, the rear corners, and the one on the boom tip at the bucket (2 Hz: the rim)
  site.strobes = [V3(-0.6, 3.05, 3.4), V3(0.6, 3.05, 3.4), V3(1.15, 2.85, -3.3), V3(-1.15, 2.85, -3.3)].map((p, i) => glowT.add(tw(p), 1.2, 1.2, AMBER.map(v => v * 1.5), 1, i * 0.23));
  site.tipStrobe = attach.clone().add(V3(0.1, 0.25, 0.0));
  site.tipGlow = glowT.add(site.tipStrobe, 0.5, 0.5, [0, 0, 0]);
  reflT.add(tw(V3(0, 3.05, 3.4)), 1.2, 1, AMBER.map(v => v * 0.6), 1, 0.0);
  glowT.add(tw(V3(0.8, 1.35, 6.1)), 0.7, 0.7, WHITE.map(v => v * 0.9)); glowT.add(tw(V3(-0.8, 1.35, 6.1)), 0.7, 0.7, WHITE.map(v => v * 0.9));
  // the pickup behind the pole (west): its LED flood is the cold back light before the arc
  site.flood = V3(WX - 16, 3.2, WZ + 2.5);
  town.add(new THREE.Mesh(merged([box(5.4, 1.2, 2.1, WX - 18, 1.0, WZ + 2.5), box(2.4, 1.0, 2.0, WX - 19, 2.0, WZ + 2.5)]), M.dark));
  site.floodG = glowT.add(site.flood, 1.8, 1.8, [0.85, 0.92, 1.0].map(v => v * 2.0));
  site.arcAt = () => { cut.updateMatrixWorld(); return V3(0.1, 0.33, 0).applyMatrix4(cut.matrixWorld); };
  site.arcGlow = glowT.add(V3(0, -100, 0), 3, 3, ARC);
  site.arcGlow2 = glowT.add(V3(0, -100, 0), 0.6, 0.6, [2, 2, 2]);
  site.strobeL = new THREE.PointLight(0xffa020, 0, 0, 2); site.strobeL.position.copy(site.tipStrobe); town.add(site.strobeL);
  // the bucket's work light on the jib: warm, from behind and below his right shoulder, aimed at the cutout (lights the gloves, the stick, the work)
  site.workLamp = new THREE.SpotLight(0xffd6a0, 0, 0, 0.5, 0.7, 2); site.workLamp.position.copy(site.bucket).add(V3(0.36, 0.95, -0.36)); site.workLamp.target.position.copy(site.cut.position); town.add(site.workLamp, site.workLamp.target);
  glowT.add(site.workLamp.position.clone().add(V3(0.04, 0, 0.03)), 0.35, 0.35, [1.6, 1.3, 0.9]);
}

// ---------------------------------------------------------------- the lineman: hero.js, lit by the arc, the strobe and the flood
// A real body (CC0 MakeHuman, 163 bones), never a front key: every shot is from behind, below, or a lost profile under
// the hard-hat brim with the face at silhouette size. Black leather protectors over dark oxblood rubber gauntlets (the
// red only shows where the arc rakes the flared cuff); a rain coat with two retro-reflective bands that return the
// strobe; the hot stick held in two hands, its hook driven up into the cutout's pull ring.
const heroData = await loadHeroData();
const lm = new Hero(heroData, { variant: 'plains', height: 1.8, kind: 'coat', shirt: '#20252c', shirt2: '#15181c', trousers: '#1a1a1c', hat: 'hard', hatColor: '#b8b2a2',
  beard: 0.35, stubble: 0.6, skin: '#8a5a40', hair: '#20160e', seed: 61, dirt: 0.35, gloves: 'gauntlet', gloveColor: '#141110' });
town.add(lm.group);
lm.watch(camera);
const heroRim = new THREE.SpotLight(0xffffff, 0, 0, 0.3, 0.6, 2); town.add(heroRim, heroRim.target);   // the motivated back light (flood / arc) placed behind him from the lens
const LM = { tape: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.12, 0.12, 0.11) }), cuff: new THREE.MeshStandardMaterial({ color: 0x4a0c0c, roughness: 0.38, metalness: 0.0 }) };
{
  // bind-space cross-section of the torso at a height (group units): centre and half extents, from the body's own vertices
  const PA = lm.body.geometry.attributes.position.array, AH = lm.aHero || lm.body.geometry.attributes.aHero.array, n = PA.length / 3, s = lm.scale;
  const section = (y, reg = 2) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let v = 0; v < n; v++) { if (AH[v * 4] !== reg || Math.abs(PA[v * 3 + 1] - y) > 0.012 / s) continue; x0 = Math.min(x0, PA[v * 3]); x1 = Math.max(x1, PA[v * 3]); z0 = Math.min(z0, PA[v * 3 + 2]); z1 = Math.max(z1, PA[v * 3 + 2]); } return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, rx: (x1 - x0) / 2, rz: (z1 - z0) / 2 }; };
  const band = (boneName, yFrac) => {
    const i = lm.idx[boneName], h0 = lm.head0[i], t0 = lm.tail0[i], y = h0.y + (t0.y - h0.y) * yFrac, sec = section(y);
    const g = new THREE.TorusGeometry(1, 0.02 / s, 4, 40); g.rotateX(Math.PI / 2); g.scale(sec.rx + 0.05 / s, 1.2, sec.rz + 0.05 / s);
    g.translate(sec.cx - h0.x, y - h0.y, sec.cz - h0.z); const m = new THREE.Mesh(g, LM.tape); lm.bone(boneName).add(m); };
  band('spine03', 0.1); band('spine02', 0.5);
  // the flared rubber cuff of each gauntlet, from 6 cm above the wrist to 19 cm, with a rolled bead; the leather
  // protector (the glove itself, near-black) covers the hand
  for (const sd of ['L', 'R']) {
    const i = lm.idx[`lowerarm01.${sd}`], w = lm.head0[lm.idx[`wrist.${sd}`]], e = lm.head0[i], d = e.clone().sub(w).normalize();
    const L0 = 0.06 / s, L1 = 0.2 / s;
    const cone = new THREE.CylinderGeometry(0.052 / s, 0.037 / s, L1 - L0, 20, 1, true); cone.translate(0, (L0 + L1) / 2, 0);
    const bead = new THREE.TorusGeometry(0.052 / s, 0.008 / s, 6, 20).rotateX(Math.PI / 2).translate(0, L1, 0);
    const g = merged([cone, bead]); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d)); g.translate(w.x - e.x, w.y - e.y, w.z - e.z);
    const m = new THREE.Mesh(g, LM.cuff); m.material.side = THREE.DoubleSide; lm.bone(`lowerarm01.${sd}`).add(m);
    const bandF = new THREE.TorusGeometry(0.06 / s, 0.012 / s, 4, 20).rotateX(Math.PI / 2).translate(0, 0.33 / s, 0); bandF.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d)); bandF.translate(w.x - e.x, w.y - e.y, w.z - e.z);
    lm.bone(`lowerarm01.${sd}`).add(new THREE.Mesh(bandF, LM.tape));
  }
}
// the hot stick: fiberglass, a steel hook at its head, a butt cap
// c4b: fiberglass, not a neon rod: dull ochre with fibre streaks, grime and black ferrule joints (it takes a specular streak, never glows)
const stickTex = canvasTex(64, 1024, (g, w, h) => {
  g.fillStyle = '#7a6424'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) { const x = hash(i) * w, y = hash(i + 7.3) * h, l = 20 + 90 * hash(i + 3.1); g.fillStyle = `rgba(${hash(i + 1) > 0.5 ? '40,30,10' : '170,140,70'},${0.08 + 0.12 * hash(i + 2)})`; g.fillRect(x, y, 1, l); }
  for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(20,16,10,${0.1 + 0.2 * hash(i + 11)})`; g.fillRect(0, hash(i + 5) * h, w, 2 + 10 * hash(i + 9)); }
  for (const y of [0.0, 0.33, 0.66]) { g.fillStyle = '#121212'; g.fillRect(0, y * h, w, 26); g.fillStyle = '#5a5a5a'; g.fillRect(0, y * h + 26, w, 3); }
  g.fillStyle = '#131313'; g.fillRect(0, h - 70, w, 70);
});
const stickM = new THREE.MeshStandardMaterial({ color: 0x9a8a70, map: stickTex, roughness: 0.38, metalness: 0.0 });
const stick = new THREE.Group(); town.add(stick);
stick.add(new THREE.Mesh(merged([new THREE.CylinderGeometry(0.018, 0.02, 1, 12).translate(0, 0.5, 0)]), stickM));
const stickHead = new THREE.Mesh(merged([new THREE.CylinderGeometry(0.024, 0.024, 0.12, 10).translate(0, 0.06, 0), new THREE.TorusGeometry(0.05, 0.009, 6, 16, Math.PI * 1.3).rotateZ(-0.3).translate(0.045, 0.16, 0), rod(V3(0, 0.1, 0), V3(0, 0.2, 0), 0.01, 6)]), M.steel);
stick.add(stickHead);
// arm glyphs whose targets are set per frame (body frame, hands on the stick: never a raised straight arm)
GESTURES.AP_L = { target: [0.2, 1.3, 0.3], pole: [1, -0.7, -0.35], prop: true };
GESTURES.AP_R = { target: [0.1, 1.05, 0.3], pole: [1, -0.8, -0.2], prop: true };
const FINGER_BONES = { L: [], R: [] };
for (const nm of lm.names) { const m = nm.match(/^(finger\d-\d|metacarpal\d)\.(L|R)$/); if (m) FINGER_BONES[m[2]].push(lm.bone(nm)); }
const bodyTgt = (side, P) => { const F = lm._body(), k = lm.o.height / 1.78, rel = P.clone().sub(F.o), s = side === 'L' ? 1 : -1; return [s * rel.dot(F.xL) / k, rel.dot(F.up) / k, rel.dot(F.fwd) / k]; };
// pose: stand in the bucket facing `face`, lean, look toward `look`; both hands on a stick whose hook is at `hook`.
// grip: 0 open .. 1 closed (the ALL NIGHT. macro closes the left hand on the stick)
function poseLineman({ hook, look = null, lean = 0.1, gripL = 1, gripR = 1, nod = null, headYaw = 0 }) {
  const floor = site.bucket.clone().add(V3(0, 0.04, 0));
  const face = V3(site.cut.position.x - floor.x, 0, site.cut.position.z - floor.z).normalize();
  let target = hook.clone();
  for (let it = 0; it < 3; it++) {
    lm.resetPose(); lm.group.position.copy(floor); lm.group.rotation.y = Math.atan2(face.x, face.z); lm.update();
    const lat = V3(1, 0, 0).applyAxisAngle(V3(0, 1, 0), lm.group.rotation.y);
    lm.rotateWorld('spine04', lat, lean * 0.5); lm.rotateWorld('spine02', lat, lean * 0.5);
    lm.update();
    const F = lm._body();
    const belly = F.o.clone().addScaledVector(F.up, 1.0).addScaledVector(F.fwd, 0.18).addScaledVector(F.xL, -0.06);
    const sd = target.clone().sub(belly).normalize();
    const pR = belly.clone().addScaledVector(sd, 0.12), pL = belly.clone().addScaledVector(sd, 0.52);
    GESTURES.AP_L.target = bodyTgt('L', pL); GESTURES.AP_R.target = bodyTgt('R', pR);
    lm.gesture('L', 'AP_L', { fist: false }); lm.gesture('R', 'AP_R', { fist: false });
    // turn each hand so its power-grip axis lies along the stick, then close it onto the stick
    for (const s2 of ['L', 'R']) { const hd = lm.handle(s2, 0.018).d, want = hd.dot(sd) >= 0 ? sd : sd.clone().negate(); const ax = hd.clone().cross(want); const ang = Math.asin(clamp(ax.length())); if (ax.length() > 1e-4) lm.rotateWorld(`wrist.${s2}`, ax.normalize(), ang); }
    lm.update();
    const hL = lm.handle('L', 0.019), hR = lm.handle('R', 0.019);
    const dir = hL.p.clone().sub(hR.p).normalize(), Ls = hook.distanceTo(hR.p);
    const tip = hR.p.clone().addScaledVector(dir, Ls);
    stick.userData = { butt: hR.p.clone().addScaledVector(dir, -0.35), dir, len: Ls + 0.35 - 0.17 };
    const err = hook.clone().sub(tip); if (err.length() < 0.01 || it === 2) {
      for (const [s2, h2, gk] of [['L', hL, gripL], ['R', hR, gripR]]) {
        const B = FINGER_BONES[s2], q0 = B.map(b => b.quaternion.clone());
        lm.relaxHand(s2, 0.35); const qa = B.map(b => b.quaternion.clone());
        B.forEach((b, i) => b.quaternion.copy(q0[i]));
        lm.grip(s2, { p: h2.p, d: dir, r: 0.019 }, { steps: 60 }); const qb = B.map(b => b.quaternion.clone());
        B.forEach((b, i) => b.quaternion.copy(qa[i]).slerp(qb[i], gk));
      }
      break;
    }
    target.add(err);
  }
  // the head looks toward the work (a lost profile from behind); the hat brim throws the face into shadow
  if (look) { lm.update(); const hp = lm.joint('head'), d = look.clone().sub(hp); const F = lm._body();
    const yaw = Math.atan2(d.dot(F.xL), d.dot(F.fwd)), pitch = Math.atan2(d.y, Math.hypot(d.dot(F.xL), d.dot(F.fwd)));
    lm.rotateWorld('neck01', V3(0, 1, 0), yaw * 0.7 + headYaw);
    lm.update(); const lat = F.xL.clone(); lm.rotateWorld('head', lat, -(nod ?? pitch) * 0.8); }
  lm.update();
  const U = stick.userData; stick.position.copy(U.butt); stick.quaternion.setFromUnitVectors(V3(0, 1, 0), U.dir);
  stick.children[0].scale.set(1, U.len, 1); stickHead.position.set(0, U.len, 0);
  stick.updateMatrixWorld(true);
  return U.butt.clone().addScaledVector(U.dir, U.len + 0.17);
}

// the spark: a white-blue point + a short trail along the path, and its travelling light
const sparkG = glowT.add(V3(0, -100, 0), 0.9, 0.9, [2.2, 2.4, 2.8]);
const sparkTrail = []; for (let i = 0; i < 14; i++) sparkTrail.push(glowT.add(V3(0, -100, 0), 0.5, 0.5, [0, 0, 0]));
glowT.done(); reflT.done();

// ================================================================ the convoy world (storm restoration convoy: the overpass, the staging yard)
// A straight four-lane divided highway along -z; the county-road overpass crosses it at z = 0 (deck 7 m), the next one
// at z = -330. The convoy comes TOWARD the overpass in the two near lanes (x 3.8, 7.4): white utility trucks, booms
// stowed, amber light bars, headlights on the wet road. The staging yard (x 220) holds a row of trucks side-on whose
// booms rise together on the hit against the flash-lit storm deck.
const conv = new THREE.Scene();
conv.fog = new THREE.FogExp2(0x0b1113, 0.0019);
const skyC = makeSky(conv, { glowDir: V3(0, 0, -1), glow: [0.42, 0.24, 0.1], zen: [0.012, 0.028, 0.034], hor: [0.05, 0.075, 0.08] });
const hemiC = new THREE.HemisphereLight(0x2a3a44, 0x0c0907, 0.35); conv.add(hemiC);
const keyC = new THREE.DirectionalLight(0xbcd0ff, 0); keyC.position.set(-30, 40, 50); conv.add(keyC, keyC.target); const warmC = new THREE.DirectionalLight(0xff9a50, 0); warmC.position.set(40, 6, -20); conv.add(warmC, warmC.target);
const glowC = new Glows(conv, 3000), reflC = new Glows(conv, 1600, { refl: true, order: 3 });
const PLc = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xffffff, 0, 0, 2); conv.add(l); return l; });
const convoy = { OZ: 0, OY: 7.0, FZ: -330 };
// the fleet: instanced parts, a matrix per truck per frame
class Fleet {
  constructor(scene, n) {
    this.n = n; const mk = (g, m) => { const im = new THREE.InstancedMesh(g, m, n); im.frustumCulled = false; scene.add(im); return im; };
    this.body = mk(truckBodyGeo(), fleetM); this.tire = mk(truckTireGeo(), M.tire); this.glass = mk(truckGlassGeo(), glassM);
    this.b1 = mk(boomGeo(TRK.L1, 0.24, 0.18), fleetM); this.b2 = mk(boomGeo(TRK.L2, 0.16, 0.12), fiberM);
    const BG = bucketGeos(); this.bk = mk(BG.shell, fiberM);
    this.T = new THREE.Matrix4(); this.M = new THREE.Matrix4(); this.R = new THREE.Matrix4(); this.q = new THREE.Quaternion();
  }
  set(i, p, yaw, a1 = 0, a2 = Math.PI) {
    const T = this.T.compose(p, this.q.setFromAxisAngle(V3(0, 1, 0), yaw), V3(1, 1, 1));
    this.body.setMatrixAt(i, T); this.tire.setMatrixAt(i, T); this.glass.setMatrixAt(i, T);
    const P = TRK.pivot, knee = V3(P.x, P.y + TRK.L1 * Math.sin(a1), P.z + TRK.L1 * Math.cos(a1)), tip = V3(knee.x, knee.y + TRK.L2 * Math.sin(a2), knee.z + TRK.L2 * Math.cos(a2));
    this.M.makeRotationX(-a1).setPosition(P); this.b1.setMatrixAt(i, this.R.multiplyMatrices(T, this.M));
    this.M.makeRotationX(-a2).setPosition(knee); this.b2.setMatrixAt(i, this.R.multiplyMatrices(T, this.M));
    const bp = tip.clone().add(V3(0, a2 > 2 ? -0.62 : -0.95, a2 > 2 ? -0.1 : 0.35));
    this.M.makeTranslation(bp.x, bp.y, bp.z); this.bk.setMatrixAt(i, this.R.multiplyMatrices(T, this.M));
    return { T: T.clone(), tip: tip.applyMatrix4(T) };
  }
  done(n = this.n) { for (const k of ['body', 'tire', 'glass', 'b1', 'b2', 'bk']) { this[k].count = n; this[k].instanceMatrix.needsUpdate = true; } }
}
{
  const g = new THREE.PlaneGeometry(9000, 9000); g.rotateX(-Math.PI / 2); conv.add(new THREE.Mesh(g, M.ground));
  // two carriageways (x -12..-1 and 1..12), shoulders, the grass median, lane paint, the jersey barrier
  const cw = [box(11, 0.02, 3200, 6.5, 0.01, -1400), box(11, 0.02, 3200, -6.5, 0.01, -1400)];
  conv.add(new THREE.Mesh(merged(cw), M.road));
  const paint = [];
  for (let z = 200; z > -3000; z -= 12.2) for (const x of [5.6, -5.6]) paint.push(box(0.14, 0.03, 3.05, x, 0.02, z));
  for (const x of [1.3, 11.8, -1.3, -11.8]) paint.push(box(0.15, 0.03, 3200, x, 0.02, -1400));
  conv.add(new THREE.Mesh(merged(paint), new THREE.MeshStandardMaterial({ color: 0x8a8a80, roughness: 0.3 })));
  conv.add(new THREE.Mesh(box(0.6, 0.85, 3200, 0, 0.42, -1400), new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.8 })));
  // the overpass (deck, parapets, piers, abutment slopes) at z = 0, and the far one
  const op = (z, len = 90) => [box(len, 1.2, 10, 0, convoy.OY - 0.6, z), box(len, 1.07, 0.3, 0, convoy.OY + 0.53, z - 4.85), box(len, 1.07, 0.3, 0, convoy.OY + 0.53, z + 4.85),
    box(1.2, convoy.OY - 1.2, 8, -14, (convoy.OY - 1.2) / 2, z), box(1.2, convoy.OY - 1.2, 8, 14, (convoy.OY - 1.2) / 2, z), box(1.0, convoy.OY - 1.2, 6, 0, (convoy.OY - 1.2) / 2, z)];
  conv.add(new THREE.Mesh(merged([...op(convoy.OZ), ...op(convoy.FZ, 120)]), new THREE.MeshStandardMaterial({ color: 0x4a4844, roughness: 0.9 })));
  for (const z of [convoy.OZ, convoy.FZ]) for (let k = -3; k <= 3; k++) { if (!k) continue; const x = k * 12; glowC.add(V3(x, convoy.OY + 6.5, z), 2.2, 2.2, SODIUM.map(v => v * 0.9)); }
  // median lamps along the road (sodium), tree lines, far town glows
  for (let z = -40; z > -2600; z -= 70) { glowC.add(V3(0, 12, z), 2.6, 2.6, SODIUM.map(v => v * 1.0)); reflC.add(V3(3, 12, z + 2), 1.8, 1, SODIUM.map(v => v * 0.3)); }
  const r = rng(88);
  for (let k = 0; k < 500; k++) { const z = -600 - r() * 3500, x = (r() - 0.5) * 5000; glowC.add(V3(x, 3 + r() * 16, z), 6 + r() * 8, 6 + r() * 8, SODIUM.map(v => v * (0.15 + r() * 0.35))); }
  const treeTex = canvasTex(2048, 128, (g2, w, h) => { g2.clearRect(0, 0, w, h); const r2 = rng(33); g2.fillStyle = '#000'; let x = 0; while (x < w) { const rr = 10 + r2() * 30, hh = h * (0.35 + r2() * 0.55); g2.beginPath(); g2.ellipse(x, h - hh * 0.5, rr, hh * 0.5, 0, 0, TAU); g2.fill(); x += rr * (0.8 + r2()); } g2.fillRect(0, h - 10, w, 10); }, { srgb: false });
  const tm = new THREE.MeshBasicMaterial({ color: 0x040506, alphaMap: treeTex, transparent: true, alphaTest: 0.4 });
  for (const [x, z0, z1, hh] of [[-60, 100, -2500, 16], [60, 100, -2500, 14]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(z0 - z1, hh), tm); m.rotation.y = Math.PI / 2; m.position.set(x, hh / 2, (z0 + z1) / 2); conv.add(m); }
}
// the convoy (two lanes toward camera) and the staging yard (one row side-on)
const NCV = 64, NYD = 12;
const fleet = new Fleet(conv, NCV + NYD);
convoy.lanes = [3.8, 7.4];
convoy.speed = 17;                           // m/s
convoy.glows = []; convoy.refl = [];
for (let i = 0; i < NCV; i++) { const ph = hash(i * 3.1);
  convoy.glows.push([0, 1, 2, 3, 4].map(k => k < 3 ? glowC.add(V3(0, -100, 0), 1.6, 1.6, AMBER.map(v => v * 2.2), 1, ph + k * 0.33) : glowC.add(V3(0, -100, 0), 1.0, 1.0, WHITE.map(v => v * 0.8))));
  convoy.refl.push([reflC.add(V3(0, -100, 0), 1.3, 1, AMBER.map(v => v * 0.8), 1, ph), reflC.add(V3(0, -100, 0), 1.1, 1, WHITE.map(v => v * 0.35))]); }
convoy.yard = { x: 230, z0: -30, dz: -9 };
convoy.yardTips = []; for (let i = 0; i < NYD; i++) convoy.yardTips.push([glowC.add(V3(0, -100, 0), 1.5, 1.5, AMBER.map(v => v * 1.8), 1, hash(i + 40)), glowC.add(V3(0, -100, 0), 4, 4, [0, 0, 0])]);
{ const r = rng(5); for (let i = 0; i < 40; i++) glowC.add(V3(convoy.yard.x - 40 + r() * 120, 9 + r() * 3, convoy.yard.z0 - 160 - r() * 300), 3, 3, SODIUM.map(v => v * 0.5)); }
glowC.done(); reflC.done();
// convoy positions at time t: trucks advance toward +z, wrapping on a 1.6 km loop so the stream never ends
function convoyAt(t) {
  const G = convoy.glows, Rf = convoy.refl;
  for (let i = 0; i < NCV; i++) {
    const lane = i % 2, k = Math.floor(i / 2), sp = 24 + 3 * hash(i), z = ((-60 - k * sp * 1.0 + convoy.speed * (t - 14)) % 1600 + 1600) % 1600 - 1520;
    const x = convoy.lanes[lane] + (hash(i + 7) - 0.5) * 0.3;
    const P = V3(x, 0, z), f = fleet.set(i, P, 0), at = (lx, ly, lz) => V3(lx, ly, lz).applyMatrix4(f.T);
    glowC.set(G[i][0], at(-0.6, 3.05, 3.4)); glowC.set(G[i][1], at(0.6, 3.05, 3.4)); glowC.set(G[i][2], at(0, 3.3, -3.4));
    glowC.set(G[i][3], at(0.8, 1.35, 6.1)); glowC.set(G[i][4], at(-0.8, 1.35, 6.1));
    reflC.set(Rf[i][0], at(0, 3.05, 3.4)); reflC.set(Rf[i][1], at(0, 1.35, 6.1));
  }
  fleet.done();
}
function yardAt(beat) {
  // v6: the booms rise in unison across the first frame of the Party's sentence (b32-35.5), so the sentence is being raised as it is read
  const u = ease.inOutCubic(clamp((beat - 32.2) / 3.3)), v = 0;
  for (let i = 0; i < NYD; i++) {
    const p = V3(convoy.yard.x, 0, convoy.yard.z0 + i * convoy.yard.dz), d = hash(i + 11) * 0.12;
    const uu = clamp(u * (1 + d) - d * 0.3), a1 = lerp(0, 1.12, uu) + v, a2 = lerp(Math.PI, 0.72, ease.inOutCubic(clamp(uu * 1.1)));
    const f = fleet.set(NCV + i, p, Math.PI / 2 + (hash(i) - 0.5) * 0.06, a1, a2);
    glowC.set(convoy.yardTips[i][0], f.tip.clone().add(V3(0, 0.3, 0))); glowC.set(convoy.yardTips[i][1], f.tip.clone().add(V3(0, 0.3, 0)));
  }
  fleet.done();
}

// ================================================================ the crowd (ranks.js: SIL backs, designed ranks, one flag)
const RK = await Ranks.create({ W, H });
{ const e = document.createElement('canvas'); e.width = e.height = 256; acpEmblem(e.getContext('2d'), 128, 128, 200, { color: '#ffffff' }); RK.emblem = e; }
// two backs at the diner counter (Nighthawks: small, dark, lit only by the window), printed into the interior plate
{ const g = neon.insideTex.image.getContext('2d'), S = RK.sil, r = rng(12);
  g.save(); g.filter = 'blur(1.6px)';
  S.blit(g, S.cell(S.pick(r, { kinds: ['cap', 'hard'] }), 'standA'), 330, 575, 330, { color: '#140c07' });
  S.blit(g, S.cell(S.pick(r, { kinds: ['fedora', 'flatcap'] }), 'standB'), 720, 575, 315, { color: '#140c07', flip: true });
  g.restore(); neon.insideTex.needsUpdate = true; }
// the overpass crowd, designed for the overpass camera (foot lines from the 3D parapet and the far bridge)
const OVC = { overpass: { pos: V3(5.2, 8.75, 4.6), look: V3(4.6, 3.0, -140), fov: 46 }, overpass2: { pos: V3(6.0, 8.5, 1.4), look: V3(4.4, 4.2, -140), fov: 40 } };
const crowds = {};
const CROWD_STYLE = { ...RANK_STYLES.night, ink: ['#030304', '#07080b', '#0e0f13', '#1a1816', '#2a221a'], rim: '#ffb050', rimAmt: [1.0, 0.9, 0.7, 0.5, 0.3], key: '#ff9a3a', keyAmt: [0.05, 0.05, 0.04, 0.02, 0], flag: '#a8120c', flagDark: '#5a0806' };
function designCrowd(name) {
  const C0 = OVC[name];
  camera.position.copy(C0.pos); camera.fov = C0.fov; camera.up.set(0, 1, 0); camera.lookAt(C0.look); camera.clearViewOffset(); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const pj = v => { const p = v.clone().project(camera); return [(p.x * 0.5 + 0.5) * W, (-p.y * 0.5 + 0.5) * H]; };
  const foot1 = pj(V3(0, convoy.OY, -4.2))[1], h1 = foot1 - pj(V3(0, convoy.OY + 1.78, -4.2))[1];
  const foot2 = pj(V3(0, convoy.OY, convoy.FZ + 4))[1], h2 = foot2 - pj(V3(0, convoy.OY + 1.78, convoy.FZ + 4))[1];
  const x2a = pj(V3(-40, convoy.OY, convoy.FZ))[0], x2b = pj(V3(40, convoy.OY, convoy.FZ))[0];
  const near = name === 'overpass2';
  const cr = RK.design({ seed: near ? 27 : 26, ranks: [
    { foot: 2150, h: near ? 1400 : 1150, x0: near ? 760 : -200, x1: near ? 1260 : 300, pack: 0.8, rows: 1, raise: near ? 1 : 0, gaps: 0 },          // hero: backs at the lens
    { foot: foot1, h: h1, x0: -40, x1: 390, pack: 1.15, rows: 2, raise: 0.35, flags: near ? 0 : 1, gaps: 0.05, thick: 0.06 },                          // the parapet, left of the gap
    { foot: foot1, h: h1 * 0.98, x0: 740, x1: 1140, pack: 1.15, rows: 2, raise: 0.35, flags: near ? 1 : 0, gaps: 0.05, thick: 0.06 },               // right of the gap of light
    { foot: foot2, h: Math.max(8, h2), x0: x2a, x1: x2b, pack: 1.3, rows: 2, raise: 0.2, gaps: 0.1 },                                              // the far bridge (texture)
  ] });
  if (near) RK.hit(cr, bt(26), { from: [900, 1500], speed: 120, jitter: 3 });
  return (crowds[name] = cr);
}

// ================================================================ timing: the spark, the neon, the arc
// the spark's arc length by beat: transformer (b2) -> weatherhead (b4) -> the drop and pole 0 -> motel (b6-8) -> gas
// (b8-10) -> courthouse (b10: centre of frame on the cue) -> past it (b14)
const S_WH = pathLen[feed.length - 1];
// THE TRACE (b6-14): each place is HELD, the camera locked, and the current streaks across it in a few frames (electricity is the
// fastest thing in the piece). keys: [beat, x on the street primary] (x < 0: along the feed/drop), linear in x between keys with an ease.
const SPARK_KEYS = [
  [T0, -1], [T0 + 0.25, -1],           // at the sign's transformer (take c: b3, straight from the question)
  [T0 + 0.95, 0],                      // up the conduit and out the weatherhead (feed: s by fraction)
  [T0 + 1.35, 8], [7.9, 60],           // the drop, pole 0, the first span
  [8.2, 84], [8.5, 130],               // MOTEL: crosses in ~9 frames
  [9.15, 150], [9.45, 192],            // the pumps
  [10.2, 296], [10.9, 322], [11.3, 338],  // the courthouse clock: the current arrives in the clock's own stage (v6: the clock shot is two beats)
  [12.0, 350], [13.85, 608],           // the ride: the wire into the dark, to the work pole
];
const S_FEED = S_WH;
function sparkS(beat) {
  if (beat < T0) return 0;
  if (beat >= 14) return sAtX(608);
  let k = 0; while (k < SPARK_KEYS.length - 1 && beat >= SPARK_KEYS[k + 1][0]) k++;
  const [b0, x0] = SPARK_KEYS[k], [b1, x1] = SPARK_KEYS[Math.min(k + 1, SPARK_KEYS.length - 1)];
  if (b1 === b0) return sAtX(x0);
  const u = clamp((beat - b0) / (b1 - b0)), eu = k === SPARK_KEYS.length - 2 ? ease.inOutCubic(u) : u;
  const sOf = x => x < 0 ? 0 : x === 0 ? S_FEED : sAtX(x);   // x = 0: the weatherhead
  return lerp(sOf(x0), sOf(x1), eu);
}
// neon: per-letter state 0 (dead) .. 1 (red lit); strike order O, P, E; the N stutters dead-alive on 16ths
function neonState(t, beat) {
  const L = [0, 0, 0, 0];
  // frame 0 strikes the sign; the last shot before the mark (b47.5, v6) strikes it again: the loop's seam is the payoff's last light
  const rel = beat >= 46 ? t - bt(47.25) : t, br = beat >= 46 ? beat - 47.25 : beat;
  const strike = (t0) => rel < t0 ? 0 : rel < t0 + 0.07 ? 0.55 : 1;
  L[0] = strike(-0.01); L[1] = strike(0.06); L[2] = strike(0.13);
  const n16 = Math.floor(br * 4); L[3] = br < 3 ? ((hash(n16 * 3.1) > 0.45 && br > 0.2) ? 1 : 0.05) : 1;
  return L;
}
const strobe2 = t => { const p = (t * 2) % 1; return p < 0.05 ? 1 : (p > 0.1 && p < 0.14 ? 0.8 : 0); };   // the boom-tip strobe, 2 Hz double flash

// ================================================================ shots (hard cuts; the spark holds the centre through the trace)
// c20: the work pole and its bucket box are gone; the crew plates carry RAISED BY HAND and KEPT LIVE BY PEOPLE; the Party's sentence
// is over the 1942 man (face2) and then present-day line workers at night (pNow, pNow2, pClass); the payoff ends on a lit lineman.
const SHOTS = [
  ...(TAKE === 'c' ? [{ b0: 0, b1: 3, name: 'neon' }, { b0: 3, b1: 8, name: 'diner' }]
    : [{ b0: 0, b1: 2, name: 'neon' }, { b0: 2, b1: 4, name: 'courtA' }, { b0: 4, b1: 6, name: 'courtB' }, { b0: 6, b1: 8, name: 'diner' }]),
  { b0: 8, b1: 9, name: 'motel' }, { b0: 9, b1: 10, name: 'gas' }, { b0: 10, b1: 12, name: 'clock' },
  { b0: 12, b1: 14, name: 'ride' }, { b0: 14, b1: 16, name: 'pTractor' }, { b0: 16, b1: 19, name: 'pCrew' },
  { b0: 19, b1: 21, name: 'glove' }, { b0: 21, b1: 22, name: 'close' }, { b0: 22, b1: 24, name: 'face' },
  { b0: 24, b1: 26, name: 'hot' }, { b0: 26, b1: 27, name: 'sil' }, { b0: 27, b1: 28, name: 'sil2' },
  { b0: 28, b1: 30, name: 'pReel' }, { b0: 30, b1: 32, name: 'pClose' },
  { b0: 32, b1: 36, name: 'then' }, { b0: 36, b1: 38, name: 'pNow' }, { b0: 38, b1: 40, name: 'pNow2' }, { b0: 40, b1: 44, name: 'pClass' },
  // the trace in reverse (WE POWER IT.): the same places the current passed come back on, from the courthouse clock to the OPEN sign
  { b0: 44, b1: 45.25, name: 'rclock' }, { b0: 45.25, b1: 46.25, name: 'rgas' }, { b0: 46.25, b1: 47.25, name: 'rmotel' }, { b0: 47.25, b1: 48.5, name: 'rdiner' },
  { b0: 48.5, b1: 50.3, name: 'town' }, { b0: 50.3, b1: 99, name: 'mark' },
];
const shotAt = beat => { const b = beat + 0.5 * FR / SPB; return SHOTS.find(s => b >= s.b0 && b < s.b1) || SHOTS[SHOTS.length - 1]; };   // cuts land on the frame nearest the beat
// the arc: a flash on each arc event
const ARCS = [24, 26, 27];
function arcEnv(beat) { let e = 0; for (const a of ARCS) if (beat >= a) e = Math.max(e, 1 * Math.exp(-Math.max(0, beat - a - 0.5 * FR / SPB) * SPB * 7)); if (beat >= 24 && beat < 44) e = Math.max(e, 0.05 + 0.03 * Math.sin(beat * 23.1) * Math.sin(beat * 7.7)); return e; }
// v7: LINE'S HOT. is held two-valued for the whole card (b24-25.5, 29 frames, 0.95 s), then settles to colour over three frames
const DROP_HOLD = Math.round(1.5 * SPB * 30);
const onFrame = (beat, b, n = 1) => beat >= b - 0.5 * FR / SPB && beat < b + (n - 0.5) * FR / SPB;

// ================================================================ rain + drops (2D)
function rain(g, t, n, col, alpha, slant = 0.18, len = 60, lights = []) {
  const r = rng(Math.floor(t * 30) * 7 + 3);
  g.save(); g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = r() * (W + 200) - 100, y = r() * (H + 200) - 100, l = len * (0.5 + r()), z = r();
    let a = alpha * (0.3 + 0.7 * z);
    for (const L of lights) { const d = Math.hypot(x - L.x, y - L.y); a += L.k * Math.exp(-d / L.r) * z; }
    g.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${clamp(a)})`; g.lineWidth = 1 + z * 2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x - slant * l, y + l); g.stroke();
  }
  g.restore();
}
function drops(g, t, src) {
  const r = rng(404);
  for (let i = 0; i < 150; i++) {
    const x0 = r() * W, y0 = r() * H, rad = 5 + r() * r() * 26, sp = r() < 0.12 ? 60 + r() * 120 : 0;
    const x = x0, y = (y0 + sp * t) % (H + 60);
    g.save(); g.beginPath(); g.ellipse(x, y, rad, rad * 1.12, 0, 0, TAU); g.clip();
    g.translate(x, y); g.scale(-1, -1);
    const k = 4; g.drawImage(src, x - rad * k, y - rad * k, rad * 2 * k, rad * 2 * k, -rad, -rad * 1.12, rad * 2, rad * 2.24);
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(x, y + 1, rad, rad * 1.12, 0, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,240,230,0.35)'; g.beginPath(); g.arc(x - rad * 0.35, y - rad * 0.4, rad * 0.18, 0, TAU); g.fill();
  }
}

// ================================================================ type (type_world: the role ladder, SAFE band, printed ink)
const ANTON = await loadFace('anton');
const SLAMS = {
  1: { lines: [{ text: 'ALL', cap: 440 }, { text: 'POWER.', cap: 300, sx: 0.93 }], align: 'center' },
  2: { lines: [{ text: 'ALL', cap: 380 }, { text: 'POWER.', cap: 290, sx: 0.95 }], align: 'center' },
  3: { lines: [{ text: 'ALL', cap: 400 }, { text: 'POWER.', cap: 296, sx: 0.93 }], align: 'center' },
  4: { lines: [{ text: 'ALL', cap: 520 }, { text: 'POWER.', cap: 310, sx: 0.9 }], align: 'center' },
};
// the sentence (ACP Dispatches, Jan 2026): three plain frames, no outline; the picture is dimmed under the block instead
const SENT = {
  1: { lines: [{ text: 'ALL', cap: 170 }, { text: 'LEGITIMATE', fill: 1, max: 250 }, { text: 'POWER', cap: 330 }] },
  2: { lines: [{ text: 'DERIVES', fill: 1, max: 330 }, { text: 'FROM', cap: 330 }] },
  3: { lines: [{ text: 'THE', cap: 120 }, { text: 'WORKING', fill: 1, max: 250 }, { text: 'CLASS.', cap: 300 }] },
};
const BLK = new Map();
function blockOf(c) {
  if (BLK.has(c)) return BLK.get(c);
  let b;
  if (c.slam) { const S = SLAMS[c.slam]; b = setBlock(ANTON, S.lines, { role: 'slam', x: c.x, y: c.y, align: S.align, gap: 0.07, maxW: 900 }); }
  else if (c.sent) { const S = SENT[c.sent]; b = setBlock(ANTON, S.lines, { role: 'shout', x: c.x, y: c.y, align: 'center', gap: 0.1, maxW: 920 }); }
  else if (c.lines) b = setBlock(ANTON, c.lines, { role: c.role || 'plant', x: c.x, y: c.y, align: 'center', gap: 0.14, maxW: 900 });
  else if (c.pay) b = setBlock(ANTON, [{ text: 'WE', cap: 190 }, { text: 'POWER IT.', fill: true, max: 330 }], { role: 'payoff', y: c.y, gap: 0.1, maxW: 900 });   // c20: WE POWER IT. answers the OPEN sign
  else b = setBlock(ANTON, c.text, { role: c.role, x: c.x, y: c.y, cap: c.cap || (c.role === 'shout' ? 250 : 172), gap: 0.12 });
  // keep every block inside the safe band
  if (b.bbox.y1 < SAFE.y1 + 3 || b.bbox.y2 > SAFE.y2 - 3) { const dy = b.bbox.y1 < SAFE.y1 + 3 ? SAFE.y1 + 4 - b.bbox.y1 : SAFE.y2 - 4 - b.bbox.y2; c.y += dy; BLK.delete(c); c._n = (c._n || 0) + 1; if (c._n > 4) { console.log('CLAMP FAIL', c.text || (c.lines && c.lines[0].text), c.y, JSON.stringify(b.bbox)); BLK.set(c, b); return b; } return blockOf(c); }
  BLK.set(c, b); return b;
}
typeAudit.plantCap = 172;
window.typeInfo = () => typeAudit.items;
// the ink is chosen from the picture under the block: paper on a dark ground, ink on a light one (printed, never glow)
function inkUnder(b) {
  const x = Math.max(0, Math.round(b.bbox.x1)), y = Math.max(0, Math.round(b.bbox.y1)), w = Math.max(4, Math.min(W - x, Math.round(b.bbox.x2 - b.bbox.x1))), h = Math.max(4, Math.min(H - y, Math.round(b.bbox.y2 - b.bbox.y1)));
  const d = cg.getImageData(x, y, w, h).data; let s = 0, n = 0; for (let i = 0; i < d.length; i += 64) { s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
  return s / n / 255;
}
const PAPER = '#f3eee2', INK = '#0e0c0b';
function fillBlock(g, b, color, { dx = 0, dy = 0, s = 1, trap = 0 } = {}) {
  const cx = (b.bbox.x1 + b.bbox.x2) / 2, cy = (b.bbox.y1 + b.bbox.y2) / 2;
  g.save(); g.translate(cx + dx, cy + dy); g.scale(s, s); g.translate(-cx, -cy);
  if (trap) {   // c4b: a printed ink trap under paper type, so a slam reads over a lit pole, an arc or a white plate alike
    g.strokeStyle = color === INK ? PAPER : INK; g.lineWidth = trap; g.lineJoin = 'round';
    for (const gl of b.glyphs) { g.save(); g.translate(gl.ox, gl.oy); g.stroke(gl.path); g.restore(); }
  }
  g.fillStyle = color;
  for (const gl of b.glyphs) { g.save(); g.translate(gl.ox, gl.oy); g.fill(gl.path); g.restore(); }
  g.restore();
}
// a soft dark plate under a block, drawn into the world before the grade: the type stays plain printed paper, no outline
function scrimUnder(b, k) {
  const x1 = b.bbox.x1 - 60, x2 = b.bbox.x2 + 60, y1 = b.bbox.y1 - 70, y2 = b.bbox.y2 + 70, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  cg.save(); cg.globalCompositeOperation = 'source-over'; cg.translate(cx, cy); cg.scale((x2 - x1) / 2, (y2 - y1) / 2);
  const gr = cg.createRadialGradient(0, 0, 0.35, 0, 0, 1.08); gr.addColorStop(0, `rgba(3,3,5,${k})`); gr.addColorStop(0.62, `rgba(3,3,5,${k * 0.82})`); gr.addColorStop(1, 'rgba(3,3,5,0)');
  cg.fillStyle = gr; cg.fillRect(-2, -2, 4, 4); cg.restore();
}
// c20 THE PARTY'S SENTENCE, BUILT ON SCREEN AT SIZE (b32-44; ACP, Jan 2026, verbatim): ALL LEGITIMATE POWER lands alone at size; on
// DERIVES FROM it steps up and the new clause lands under it; on THE WORKING CLASS. both step up again and the last clause lands
// largest at the foot, so the whole sentence stands together for its last frame. Each step is eased over seven frames.
const SB = [
  setBlock(ANTON, [{ text: 'ALL LEGITIMATE', fill: 1, max: 170 }, { text: 'POWER', cap: 230 }], { role: 'shout', y: 700, align: 'center', gap: 0.12, maxW: 900 }),
  setBlock(ANTON, [{ text: 'DERIVES FROM', fill: 1, max: 190 }], { role: 'shout', y: 700, align: 'center', gap: 0.12, maxW: 900 }),
  setBlock(ANTON, [{ text: 'THE WORKING', fill: 1, max: 230 }, { text: 'CLASS.', cap: 300 }], { role: 'shout', y: 700, align: 'center', gap: 0.1, maxW: 900 }),
];
const SB_AT = [32, 36, 40], SB_END = 44;
const sbH = b => b.bbox.y2 - b.bbox.y1, sbC = b => (b.bbox.y1 + b.bbox.y2) / 2;
function sentenceLayout(stage) {          // -> [{cy, s}] per clause shown at this stage
  const sc = [[1], [0.74, 1], [0.6, 0.72, 1]][stage - 1], gap = 46;
  let tot = sc.reduce((a, k, i) => a + sbH(SB[i]) * k, 0) + gap * (sc.length - 1);
  const room = SAFE.y2 - SAFE.y1 - 24, fit = Math.min(1, room / tot);
  tot *= fit;
  let y = stage === 1 ? 640 - tot / 2 : Math.max(SAFE.y1 + 12, Math.min(SAFE.y2 - 12 - tot, 700 - tot / 2));
  return sc.map((k, i) => { const h = sbH(SB[i]) * k * fit, o = { cy: y + h / 2, s: k * fit }; y += h + gap * fit; return o; });
}
function drawSentence(beat, t) {
  if (beat < SB_AT[0] - 0.5 * FR / SPB || beat >= SB_END - 0.5 * FR / SPB) return;
  const st = beat >= SB_AT[2] - 0.5 * FR / SPB ? 3 : beat >= SB_AT[1] - 0.5 * FR / SPB ? 2 : 1;
  const now = sentenceLayout(st), prev = st > 1 ? sentenceLayout(st - 1) : null;
  const f = (t - bt(SB_AT[st - 1])) * 30, e = ease.outCubic(clamp(f / 7));
  // the picture under the sentence is dimmed from the top (the type stays plain printed paper, no outline)
  cg.save(); const gr = cg.createLinearGradient(0, 0, 0, 1420); gr.addColorStop(0, 'rgba(2,3,6,0.74)'); gr.addColorStop(0.72, 'rgba(2,3,6,0.5)'); gr.addColorStop(1, 'rgba(2,3,6,0)');
  cg.fillStyle = gr; cg.fillRect(0, 0, W, 1420); cg.restore();
  now.forEach((L, i) => {
    const P = prev && prev[i] ? prev[i] : null;
    const cy = P ? lerp(P.cy, L.cy, e) : L.cy, sc = (P ? lerp(P.s, L.s, e) : L.s) * (P ? 1 : 1 + 0.05 * (1 - clamp(f / 6)));
    fillBlock(tg, SB[i], PAPER, { dy: cy - sbC(SB[i]), s: sc });
    typeAudit.add(SB[i], { role: 'shout', read: 1, s: sc, world: 'printed' });
  });
}
function drawType(beat, t, { force = null } = {}) {
  tg.clearRect(0, 0, W, H); typeAudit.reset();
  drawSentence(beat, t);
  const slam = chantAt(SLAM_T, t, { frames: 7, lead: 0.5 * FR });
  for (const c of CUES) {
    let on, s = 1;
    if (c.slam) { const k = CUES.filter(q => q.slam).indexOf(c); on = slam && slam.on && slam.i === k; if (on) { const f = Math.round(slam.age * 30); s = f === 0 ? 1.06 : f === 1 ? 1.02 : 1; } }
    else on = beat >= c.b - 0.5 * FR / SPB && beat < (c.until ?? c.b + c.hold) - 0.5 * FR / SPB;   // a card ends on the frame its successor starts: no frame carries both
    if (!on) continue;
    let al = 1;
    if (c.g) { const later = CUES.some(q => q.g === c.g && q !== c && q.b > c.b && beat >= q.b - 0.5 * FR / SPB); if (later) al = 0.5; }
    if (c.sent) { const f = (t - bt(c.b)) * 30; if (f < 6) s = 1 + 0.05 * (1 - f / 6); }
    tg.save(); tg.globalAlpha = al;
    const fImp = Math.round(t * 30) - Math.round(bt(24) * 30);
    const b = blockOf(c), col = force === 'auto' ? (inkUnder(b) < 0.5 ? PAPER : INK) : force || (c.ink || (c.b === 24 && fImp >= 0 && fImp < DROP_HOLD) ? INK : PAPER);
    const trap = (c.b === 24 && fImp >= 0 && fImp < DROP_HOLD + 4) ? 22 : 0;
    if (c.scrim) scrimUnder(b, c.sent ? 0.66 : c.scrim === 1 ? 0.5 : c.scrim);
    fillBlock(tg, b, col, { s, trap, ink: false });
    if (c.quote) { tg.save(); tg.font = '400 34px Anton, "Archivo Black", sans-serif'; tg.textAlign = 'center'; tg.fillStyle = 'rgba(243,238,226,0.82)'; if (tg.letterSpacing !== undefined) tg.letterSpacing = '5px'; tg.fillText('THE DECLARATION OF INDEPENDENCE, 1776', W / 2, b.bbox.y2 + 70); tg.restore(); }
    if (c.carry) { tg.font = '400 62px Anton, "Archivo Black", sans-serif'; tg.textAlign = 'center'; tg.fillStyle = 'rgba(243,238,226,0.78)'; if (tg.letterSpacing !== undefined) tg.letterSpacing = '3px'; const cw = tg.measureText(c.carry).width; if (cw > 900) tg.font = `400 ${Math.floor(62 * 900 / cw)}px Anton, "Archivo Black", sans-serif`; tg.fillText(c.carry, W / 2, b.bbox.y1 - 54); }
    tg.restore();
    typeAudit.add(b, { role: c.slam ? 'slam' : c.pay ? 'payoff' : b.role, read: 1, s, world: 'printed' });
  }
}

// ================================================================ the mark grown from the four conductors (b42-44): three phases + the neutral are the flag's four stripes
// The wires of the last 3D frame (projected) straighten, thicken and settle into the emblem's four stripe boxes; the badge comes in at their left.
function drawGrowMark(g, beat) {
  const e = ease.inOutCubic(clamp((beat - 50.3) / 1.15)), dim = ease.inOutCubic(clamp((beat - 50.3) / 0.55));
  const MB = markBox(W / 2, 800, 560);
  g.save(); g.fillStyle = `rgba(3,4,7,${0.74 * dim})`; g.fillRect(0, 0, W, H);   // c20: the lit town stays faintly behind the mark
  const pj = (x, i) => { const p = V3(x, PH[i].y, POLE_Z + PH[i].dz).project(camera); return [(p.x * 0.5 + 0.5) * W, (-p.y * 0.5 + 0.5) * H]; };
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    const a = pj(WX - 30, i), b = pj(WX - 260, i), sl = (b[1] - a[1]) / (b[0] - a[0] || 1e-3), yAt = x => a[1] + sl * (x - a[0]);
    const st = MB.stripes[i], xl = lerp(-60, st.x0, e), xr = lerp(W + 60, st.x1, e), ty = (st.y0 + st.y1) / 2, th = lerp(5, st.y1 - st.y0, e);
    const yl = lerp(yAt(xl), ty, e), yr = lerp(yAt(xr), ty, e);
    for (const [wd, al, col] of [[th * 3.2, 0.10, '110,150,255'], [th * 1.6, 0.22, '190,215,255'], [th, 0.95, '255,248,235']]) {
      g.strokeStyle = `rgba(${col},${al * (1 - 0.0 * e)})`; g.lineWidth = wd; g.lineCap = 'butt'; g.beginPath(); g.moveTo(xl, yl); g.lineTo(xr, yr); g.stroke();
    }
  }
  g.globalCompositeOperation = 'source-over';
  const bd = ease.inOutCubic(clamp((beat - 51.0) / 0.7));
  if (bd > 0) drawMark(g, W / 2, 800, 560, { color: C.cream, badge: bd, stripes: [0, 0, 0, 0] });
  if (e >= 1) drawMark(g, W / 2, 800, 560, { color: C.cream, badge: 0, stripes: [1, 1, 1, 1] });
  g.restore();
}

// ================================================================ the real face: a baked night grade of Alfred T. Palmer's 1942 Kodachrome (LoC FSA/OWI, no known restrictions)
const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = new URL(src, import.meta.url).href; });
const FACEIMG = await loadImg('../assets/allpower/face_night.jpg'), FACE2IMG = await loadImg('../assets/allpower/face2_night.jpg');
function drawFace(g, u, t, beat, img = FACEIMG, o = {}) {
  const z0 = o.z ?? 1.0, push = o.push ?? 0.06, ax = o.ax ?? 0.42, ay = o.ay ?? 0.4, ty = o.ty ?? 0.4;
  g.save(); g.globalCompositeOperation = 'source-over'; g.fillStyle = '#020203'; g.fillRect(0, 0, W, H);
  if (img) {
    const z = z0 * (1 + push * u); g.translate(W * ax, H * ty); g.scale(z, z); g.translate(-W * ax, -H * ay);
    if (o.lift) g.filter = `brightness(${o.lift})`;
    g.drawImage(img, 0, o.dy || 0, W, H); g.filter = 'none';
    if (o.strobe !== false && beat < 23.5) { const k = strobe2(t); g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(255,150,50,${0.07 * k})`; g.fillRect(-60, -60, W + 120, H + 120); }
  }
  g.restore();
  // v6: the plate is full bleed and fades into the night instead of ending on an edge: corners crushed (the plate's sky blocks), the foot faded to black
  g.save(); g.globalCompositeOperation = 'source-over';
  { const gr = g.createRadialGradient(W * 0.5, H * (o.vy ?? 0.36), H * 0.2, W * 0.5, H * (o.vy ?? 0.36), H * 0.78); gr.addColorStop(0, 'rgba(2,2,3,0)'); gr.addColorStop(0.62, 'rgba(2,2,3,0.1)'); gr.addColorStop(1, 'rgba(2,2,3,0.92)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
  if (o.dy < 0) { const gr = g.createLinearGradient(0, H + o.dy - 420, 0, H + o.dy + 2); gr.addColorStop(0, 'rgba(2,2,3,0)'); gr.addColorStop(1, 'rgba(2,2,3,1)'); g.fillStyle = gr; g.fillRect(0, H + o.dy - 420, W, 430); }
  if (o.dy > 0) { const gr = g.createLinearGradient(0, o.dy - 4, 0, o.dy + 360); gr.addColorStop(0, 'rgba(2,2,3,1)'); gr.addColorStop(1, 'rgba(2,2,3,0)'); g.fillStyle = gr; g.fillRect(0, o.dy - 6, W, 370); }
  g.restore();
}
// v6: a real man (Palmer 1942, cut from the night plate: assets/allpower/face2_cut.png) as the foreground silhouette of the payoff; the town's light finds only his rim
const MANCUT = await loadImg('../assets/allpower/face2_cut.png');
const manC = document.createElement('canvas'); manC.width = W; manC.height = H; const mcg = manC.getContext('2d');
const rimC = document.createElement('canvas'); rimC.width = W; rimC.height = H; const rcg = rimC.getContext('2d');
function drawMan(g, k, t) {
  if (!MANCUT) return;
  const w = 800, h = 1422, x0 = -70 + 4 * Math.sin(t * 0.7), y0 = 1010;
  rcg.clearRect(0, 0, W, H); rcg.globalCompositeOperation = 'source-over'; rcg.drawImage(MANCUT, x0 + 5, y0 - 9, w, h); rcg.globalCompositeOperation = 'source-atop'; rcg.fillStyle = 'rgb(255,168,72)'; rcg.fillRect(0, 0, W, H);
  mcg.clearRect(0, 0, W, H); mcg.globalCompositeOperation = 'source-over'; mcg.filter = `brightness(${(0.35 + 0.75 * k).toFixed(3)}) sepia(0.35)`; mcg.drawImage(MANCUT, x0, y0, w, h); mcg.filter = 'none';   // c20: his face takes the town's light (was a black fill)
  g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.95 * k; g.drawImage(rimC, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.drawImage(manC, 0, 0); g.restore();
}
// v6: the slams on a real silhouette: the plate multiplied into the arc's flash (the men dark, the sky the arc)
const silC = document.createElement('canvas'); silC.width = W; silC.height = H; const scg = silC.getContext('2d');
function drawSilPlate(g, key, arc, onHit) {
  const img = PLI[key]; g.save(); g.fillStyle = '#04050a'; g.fillRect(0, 0, W, H);
  const k = 0.55 + 0.7 * arc + (onHit ? 0.5 : 0);
  const gr = g.createRadialGradient(W * 0.52, H * 0.27, 40, W * 0.52, H * 0.3, 900); gr.addColorStop(0, `rgba(235,244,255,${Math.min(1, k)})`); gr.addColorStop(0.5, `rgba(120,160,255,${0.7 * k})`); gr.addColorStop(1, 'rgba(10,14,40,0.4)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  if (img) {   // c20: full bleed (the plate's photograph sits in its upper two thirds: scaled 1.62x round the subject, its black surround off-frame)
    const [fx, fy] = PLATE_AT[key], z = 1.75 + (onHit ? 0.03 : 0);
    scg.save(); scg.fillStyle = '#fff'; scg.fillRect(0, 0, W, H); scg.translate(W * 0.5, H * 0.44); scg.scale(z, z); scg.translate(-W * fx, -H * fy);
    scg.filter = 'grayscale(1) contrast(1.9) brightness(1.15)'; scg.drawImage(img, 0, 0, W, H); scg.filter = 'none'; scg.restore();
    g.globalCompositeOperation = 'multiply'; g.drawImage(silC, 0, 0);
  }
  g.restore();
}

const PLI = {}; for (const k of ['tractor', 'crew', 'reel', 'close']) PLI[k] = await loadImg(`../assets/allpower/pl_${k}.jpg`);
// the 1942 crew, night-graded plates (assets/allpower/pl_*.jpg, review/ALL_POWER_c13/tools/plates.py): a slow push toward the face, the amber work lamp breathing, a double strobe
const PLATE_AT = { tractor: [0.52, 0.27], crew: [0.5, 0.36], reel: [0.5, 0.3], close: [0.46, 0.26] };
function drawPlate(g, key, u, t, beat) {
  const img = PLI[key]; g.save(); g.globalCompositeOperation = 'source-over'; g.fillStyle = '#020203'; g.fillRect(0, 0, W, H);
  if (img) {
    const [fx, fy] = PLATE_AT[key], z = 1.0 + 0.08 * u; g.translate(W * fx, H * fy); g.scale(z, z); g.translate(-W * fx, -H * fy);
    g.drawImage(img, 0, 0, W, H);
    const k = strobe2(t), br = 0.5 + 0.5 * Math.sin(t * 3.1 + key.length);
    g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(255,150,50,${0.035 * k + 0.012 * br})`; g.fillRect(-60, -60, W + 120, H + 120);
  }
  g.restore();
}

// ================================================================ c20: present-day line workers from the person pipeline (blender/allpower_people_job.py)
// assets/allpower/people.json lists the cut-outs that exist: { "<tag>": { "head": [x, y] (px in the plate), "w": .., "h": .. } }. A shot
// whose cut-out is missing falls back to the 1942 plates, so the scene renders before and after the people job lands.
const PEOPLE = await (async () => { try { const r = await fetch(new URL('../assets/allpower/people.json', import.meta.url)); return r.ok ? await r.json() : {}; } catch (e) { return {}; } })();
const PIMG = {}; for (const k of Object.keys(PEOPLE)) PIMG[k] = await loadImg(`../assets/allpower/${k}.png`);
const NOW = { pNow: 'ap_L05_m59_black_strobe', pNow2: 'ap_L06_f53_white_strobe', pClass: 'ap_L08_f24_hispanic_face', town: 'ap_L21_m32_black_town' };
const NOW_AT = { pNow: [600, 1480, 1.7], pNow2: [470, 1490, 1.7], pClass: [540, 1560, 1.25], town: [330, 1380, 1.9] };   // (cut-outs trimmed to the figure: assets/allpower/people.json)   // where the head lands, and the scale
// the night behind a worker at the truck: the cold flood haze from the left, the boom-tip strobe's amber from above right, rain
function drawNight(g, t, beat, strobe = 1) {
  g.save(); g.globalCompositeOperation = 'source-over';
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#05070d'); bg.addColorStop(0.6, '#0a0c12'); bg.addColorStop(1, '#040405'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const k = strobe2(t) * strobe;
  let gr = g.createRadialGradient(-120, 900, 40, -120, 900, 1100); gr.addColorStop(0, 'rgba(150,170,210,0.22)'); gr.addColorStop(1, 'rgba(150,170,210,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  gr = g.createRadialGradient(W + 60, 380, 20, W + 60, 380, 900); gr.addColorStop(0, `rgba(255,140,40,${0.1 + 0.45 * k})`); gr.addColorStop(1, 'rgba(255,140,40,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.restore();
}
function drawPerson(g, key, u, t, { lit = 1, push = 0.04 } = {}) {
  const tag = NOW[key], img = PIMG[tag], meta = PEOPLE[tag]; if (!img || !meta) return false;
  const [hx, hy, sc0] = NOW_AT[key], sc = sc0 * (1 + push * u), [px, py] = meta.head;
  g.save(); g.translate(hx, hy); g.scale(sc, sc); g.translate(-px, -py);
  if (lit < 0.999) g.filter = `brightness(${lit.toFixed(3)})`;
  g.drawImage(img, 0, 0); g.filter = 'none'; g.restore();
  // the foot of the plate fades into the night (a bust ends at its own frame edge)
  const footY = hy + (img.height - py) * sc; const gr = g.createLinearGradient(0, footY - 260, 0, footY); gr.addColorStop(0, 'rgba(4,4,5,0)'); gr.addColorStop(1, 'rgba(4,4,5,1)');
  g.fillStyle = gr; g.fillRect(0, footY - 262, W, Math.max(0, H - footY + 264));
  return true;
}

// ================================================================ the frame
let frameN = 0;
const setPLc = (i, p, c, I) => { PLc[i].position.copy(p); PLc[i].color.setRGB(...c); PLc[i].intensity = I; };
window.renderFrame = async (t) => {
  frameN = Math.round(t * 30);
  const beat = t / SPB, S = shotAt(beat), u = (beat - S.b0) / (S.b1 - S.b0);
  const beatQ = beat + 0.5 * FR / SPB;   // events land on the frame nearest their beat
  const fDrop = Math.round(t * 30) - Math.round(bt(24) * 30), dropHold = fDrop >= 0 && fDrop < DROP_HOLD;   // v7: the two-valued frame is held, the arc frozen at its strike
  const kick = B.env('kick', t, 10), arc = arcEnv(dropHold ? 24 + 0.5 * FR / SPB : beatQ), sk = strobe2(t);
  glowT.set(site.floodG, null, 1.8, 1.8); lightsOff(); hemi.intensity = 0.9; hemiC.intensity = 0.35; keyC.intensity = 0; warmC.intensity = 0; glowC.U.uGain.value = 1; poolsT.m.material.opacity = 1; RIM.c1.value.setRGB(0, 0, 0); RIM.c2.value.setRGB(0, 0, 0);
  site.strobeL.intensity = 0; heroRim.intensity = 0; for (const l of PLc) l.intensity = 0;
  skyT.uGlow.value.set(0.34, 0.2, 0.09);
  HOT.color.setRGB(0, 0, 0); for (const U of [glowT.U, glowC.U, reflT.U, reflC.U]) { U.uBeat.value = beat; U.uT.value = t; U.uStrobe.value = 0; U.uFlick.value = 0; U.uAll.value = 0; U.uWaveX.value = -1e9; }
  skyT.uT.value = t; skyC.uT.value = t; skyC.uGlow.value.set(0.42, 0.24, 0.1); skyT.uFlash.value.set(0, 0, 0); skyC.uFlash.value.set(0, 0, 0);
  let world = town, pos, look, fov = 50, roll = 0, rainN = 240, rainCol = [170, 180, 200], rainA = 0.06, rainLights = [], exposure = 1.0, drop = false, crowd = null;
  lm.group.visible = stick.visible = false;
  site.bk.visible = false; streets.visible = false;   // c20: the glowing bucket box with the printed mark is cut; the mark appears only when the wires become it

  // ---- the neon (always live)
  const L = neonState(t, beat);
  neon.letters.forEach((l, i) => { const k = L[i]; if (k <= 0.1) l.mat.color.setRGB(0.09, 0.03, 0.03); else if (k < 0.9) l.mat.color.setRGB(1.5, 1.0, 2.6); else l.mat.color.setRGB(1.6, 0.05, 0.02); });
  neon.border.color.setRGB(0.12, 0.42, 2.2);
  neon.halos.forEach((g, i) => { g.U.uGain.value = L[i] <= 0.1 ? 0.0 : L[i] < 0.9 ? 0.6 : 1.0; }); neon.bhalo.U.uGain.value = 0.8;
  const neonOn = (L[0] + L[1] + L[2] + L[3]) / 4;
  setPL(4, V3(0, 1.3, DZ + 0.7), [1.0, 0.12, 0.05], 1.8 * neonOn, 0); setPL(3, V3(0, 1.7, DZ - 1.2), [1.0, 0.12, 0.05], 8 * neonOn, 0);

  // ---- the spark (b2-14)
  const s = sparkS(beat), sp = pathAt(s), sparkOn = beat >= T0 && beat < 14.4, vSp = Math.max(0, s - sparkS(beat - FR / SPB));
  TRACE.uS.value = beat >= T0 ? s * TRACE.uTot.value / pathLen[pathLen.length - 1] : -1; TRACE.uOn.value = beat >= T0 && beat < 16 ? 1 : 0; TRACE.uHead.value = 1;
  glowT.set(sparkG, sparkOn ? sp : V3(0, -100, 0), 0.8 + 0.4 * kick + 0.1 * Math.min(vSp, 7), 0.8 + 0.4 * kick + 0.1 * Math.min(vSp, 7), [2.4, 2.6, 3.0]);
  const sdir = pathAt(s + 0.5).sub(pathAt(s - 0.5)).normalize();
  for (let i = 0; i < sparkTrail.length; i++) { const p = pathAt(s - (i + 1) * (0.5 + 0.38 * vSp)); const k = (1 - i / sparkTrail.length) * 0.7; glowT.set(sparkTrail[i], sparkOn && s > 0.2 ? p : V3(0, -100, 0), 0.4 + 0.03 * Math.min(vSp, 7), 0.4 + 0.03 * Math.min(vSp, 7), [1.2 * k, 1.4 * k, 2.2 * k]); }
  if (sparkOn) setPL(0, sp.clone().add(V3(0, -0.25, 0.3)), [0.7, 0.8, 1.0], 40 * (1 + kick), 0);
  const follow = (off, ahead = 0.0) => { pos = sp.clone().add(off); look = sp.clone().addScaledVector(sdir, ahead); };

  // ---- the courthouse: dark until the spark reaches it, then ONE strike (b10) and it holds lit
  const courtK = beat < 2 ? 0 : Math.max(strikeEnvelope(t, bt(2)), beat > 2 + 8 * FR / SPB ? 1 : 0.9 * clamp((t - bt(2)) * 30 / 8));
  // ---- the work: the fuse door (open -> driven up -> slammed shut at b20), the arc, the four hot conductors
  const doorOpen = -2.5; let door = doorOpen;
  if (beat >= 22 && beat < 24) door = lerp(doorOpen, -0.5, ease.inOutCubic(clamp((beat - 22.2) / 1.25)));
  if (beatQ >= 24) door = 0;
  site.door.rotation.z = door;
  const arcP = site.arcAt();
  site.door.updateMatrixWorld(true); const ringP = V3(0.05, 0.64, 0).applyMatrix4(site.door.matrixWorld);
  const arcLit = beatQ >= 24 && beatQ < 44 ? arc : 0;
  const markFrame = dropHold || [24, 26, 27].some(a => onFrame(beat, a, 2));
  const hotK = beatQ >= 44 ? 0.75 + 0.8 * Math.exp(-Math.max(0, beat - 44) * SPB * 5) : beatQ >= 24 ? 0.05 + 0.5 * arcLit : 0;
  const lineman = ['pole', 'glove', 'close', 'hot', 'sil', 'sil2'].includes(S.name);
  const showBody = ['pole', 'glove'].includes(S.name);   // v6: the CG man stays only where he is a gauntlet or a small figure in the bucket; the real crew carries the rest
  const PHOTO = { pTractor: 'tractor', pCrew: 'crew', pReel: 'reel', pClose: 'close' }[S.name];
  if (lineman) {
    lm.group.visible = stick.visible = true;
    let hook = ringP.clone(), gripL = 1;
    if (beat < 22) hook = ringP.clone().add(V3(0.28, -0.42, 0.3).multiplyScalar(beat < 20 ? 1 : 1 - smooth(20, 22, beat) * 0.6));
    if (beatQ >= 24) hook = arcP.clone().add(V3(0.1, -0.08, 0.02));
    if (S.name === 'glove') gripL = ease.outCubic(clamp((beat - 19.0) / 0.3));
    poseLineman({ hook, look: arcP, lean: beat >= 22 && beat < 24.5 ? 0.45 : 0.15, gripL });
    lm.group.visible = showBody;
    const k = sk; LM.tape.color.setRGB(0.03 + 0.8 * k, 0.03 + 0.62 * k, 0.028 + 0.35 * k);
    site.strobeL.intensity = 1.5 * (0.05 + k);
    glowT.set(site.tipGlow, site.tipStrobe, 0.5 + 0.8 * k, 0.5 + 0.8 * k, AMBER.map(v => v * (0.2 + 2.5 * k)));
  }
  if (!lineman) glowT.set(site.tipGlow, V3(0, -100, 0), 0.1, 0.1, [0, 0, 0]);   // no stale boom-tip strobe in the shots without the bucket
  const ag = 0.6; glowT.set(site.arcGlow, arcLit > 0.01 ? arcP : V3(0, -100, 0), ag * (1 + arcLit), ag * (1 + arcLit), ARC.map(v => v * (0.4 + 1.4 * arcLit)));
  glowT.set(site.arcGlow2, arcLit > 0.01 ? arcP : V3(0, -100, 0), 0.4 + 1.6 * arcLit, 0.4 + 1.6 * arcLit, [3, 3, 3]);
  site.workLamp.intensity = 0;
  const workLights = (flood = 1, lamp = 1) => { site.workLamp.intensity = 22 * lamp * (beat >= 21.5 && beat < 22 ? 0.3 : 1); setSL(0, site.flood, V3(WX, 11.2, WZ), [0.8, 0.9, 1.0], 14000 * flood, 0.22); setPL(2, arcP, [0.75, 0.85, 1.0], 420 * arcLit + (beat >= 20 ? 3 : 0), 0); };

  // the relight (b36): dark, then one white flash and the wave runs from the pole to the town and the courthouse; lamps follow the front
  const rl = { p: clamp((beat - 44.0) / 3.2), flash: 0 }; rl.flash = beat >= 44 ? Math.exp(-Math.max(0, beat - 44 - 0.5 * FR / SPB) * SPB * 6) : 0;
  if (beat >= 14.4 && beat < 44 - 0.5 * FR / SPB) { glowT.U.uWaveX.value = 1e4; reflT.U.uWaveX.value = 1e4; }       // the line is dead from the work pole on: the town stays dark until he closes it
  if (beat >= 44 - 0.5 * FR / SPB) { glowT.U.uWaveX.value = lerp(640, -60, ease.inOutCubic(rl.p)); glowT.U.uAll.value = 0; reflT.U.uWaveX.value = glowT.U.uWaveX.value; }
  let vOff = 0;           // trace shots: the frame is shifted so the spark holds y ~730 (the type sits under it)
  const rimHero = (col, I, at = null) => { const hp = at || lm.joint('head'); heroRim.position.copy(hp).addScaledVector(hp.clone().sub(pos).setY(0).normalize(), 7).add(V3(0, 2.5, 0)); heroRim.target.position.copy(hp).add(V3(0, -0.5, 0)); heroRim.color.setRGB(...col); heroRim.intensity = I; };
  switch (S.name) {
    case 'neon': {        // macro through the wet glass: the sign in the upper half, the counter's warmth under it
      pos = V3(0.0, 1.46, DZ + 2.3 - 0.18 * u); look = V3(0, 1.17, DZ - 0.28); fov = 45; drop = true; rainN = 0;
      setPL(1, V3(0, 3.5, DZ + 4), [0.5, 0.55, 0.7], 20, 0);
      break;
    }
    case 'diner': {       // Hopper: the lit window, an island in the density-black street; the spark climbs the conduit
      vOff = -300;
      pos = V3(-3.6 + 0.5 * u, 1.6, DZ + 13.5); look = V3(0.4, 0.9, DZ); fov = 44;
      setPL(1, V3(0, 1.4, DZ + 1.0), [1.0, 0.72, 0.42], 14, 0);
      rainN = 200; rainA = 0.05; hemi.intensity = 1.5;
      break;
    }
    case 'wire': {        // FOLLOW THE WIRE.: the line runs away down the street, lamp after lamp, the spark ahead on it
      pos = sp.clone().add(V3(-18, -5.8, 7.5)); look = sp.clone().add(V3(14, -3.0, -4)); fov = 58; hemi.intensity = 1.6;
      setPL(1, sp.clone().add(V3(-3, -3.5, 3)), [1.0, 0.6, 0.28], 90, 0);
      rainN = 220;
      break;
    }
    case 'motel': {       // the pole sign over the row of doors: held; the current crosses it in nine frames and it strikes on contact
      vOff = -390;
      { const cx = 85 + 0.8 * u; pos = V3(cx, 1.7, 7); look = V3(cx + 9, 6.2, -14); fov = 58; } hemi.intensity = 1.5;
      const a = beat - 8.25; if (a >= 0 && a < 0.6) { const on = hash(Math.floor(a * 24) + 6) > 0.4 ? 1 : 0.08; signs.motel.color.setScalar(1.8 * on); glowT.U.uFlick.value = 1; } else signs.motel.color.setScalar(beat < 8.25 ? 0.22 : 1.8);
      setPL(1, V3(104, 3.5, -14), [1.0, 0.55, 0.25], 120, 0);
      break;
    }
    case 'gas': {         // the canopy lit like an operating table: held; the current crosses over it
      vOff = -340;
      { const cx = 160 + 0.8 * u; pos = V3(cx, 1.7, 7); look = V3(cx + 12, 6.0, -21); fov = 58; } hemi.intensity = 1.5;
      const a = beat - 9.3; const on = a < 0 ? 0.35 : a < 0.5 ? (hash(Math.floor(a * 24) + 8) > 0.45 ? 1 : 0.1) : 1; signs.gas[0].color.setScalar(2.2 * on); signs.gas[1].color.setScalar(0.9 * on); if (a >= 0 && a < 0.5) glowT.U.uFlick.value = 1;
      signs.motel.color.setScalar(1.8);
      setPL(1, V3(gasX() - 1, 4.4, -16), [1, 0.96, 0.9], 140, 0);
      break;
    }
    case 'tower': {       // the water tower at the edge of the town, a red beacon on it, the wire crossing its tank
      pos = V3(208 + 0.8 * u, 1.7, 5); look = V3(206, 22, -32); fov = 56; hemi.intensity = 1.9;
      signs.motel.color.setScalar(1.8); signs.gas[0].color.setScalar(2.2); signs.gas[1].color.setScalar(0.9);
      skyT.uGlow.value.set(0.7, 0.4, 0.18);
      setPL(1, V3(200, 6, -6), [0.9, 0.9, 1.0], 160, 0);
      break;
    }
    case 'courtA': {      // THE QUESTION'S IMAGE: the county courthouse lit at 2:00, its name whole in the frieze, steps, a flag, lit offices; the type rides the sky above
      pos = V3(CH.x + 3 - 1.0 * u, 1.5, 12); look = V3(CH.x + 2, 27, CH.z); fov = 62; hemi.intensity = 1.6;
      skyT.uGlowDir.value.set(0, 0, -1).normalize(); skyT.uGlow.value.set(0.7, 0.4, 0.16);
      rainN = 160; rainA = 0.05;
      break;
    }
    case 'courtB': {      // the steps and the columns from the curb, the flag on its pole; the clock stage over them
      pos = V3(CH.x - 15 + 1.5 * u, 1.3, 8); look = V3(CH.x - 6, 27, CH.z + 2); fov = 64; hemi.intensity = 1.6;
      skyT.uGlowDir.value.set(0, 0, -1).normalize(); skyT.uGlow.value.set(0.7, 0.4, 0.16);
      rainN = 160; rainA = 0.05;
      break;
    }
    case 'clock': {       // 2:00: the clock stage over the portico, the four wires and the current crossing in front
      vOff = -430;
      pos = V3(CH.x + 7 - 1.0 * u, 8.5, 13); look = V3(CH.x - 0.5, 17.5, CH.z + 2); fov = 42; hemi.intensity = 1.7;
      skyT.uGlowDir.value.set(-0.3, 0, -1).normalize();
      rainN = 180; rainA = 0.05;
      break;
    }
    case 'ride': {        // the search: the current runs the wire into the dark, faster than anything in the piece; the camera chases it, poles flicking past
      const sb = pathAt(s - 11); pos = sb.clone().add(V3(0, -3.0, 3.4)); look = sp.clone().add(V3(9, 0.2, -0.5)); fov = 72; hemi.intensity = 2.2;
      skyT.uGlowDir.value.set(-1, 0, 0).normalize(); skyT.uGlow.value.set(0.5, 0.3, 0.14);
      rainN = 360; rainA = 0.07; rainCol = [200, 210, 235];
      break;
    }
    case 'pole': {        // the end of the wire: a pole in the rain, the crew's truck, a man in the bucket against the pickup's flood; the current arrives and the cutout flares
      vOff = -230;
      pos = V3(WX + 3.6 + 0.6 * u, 1.4, 3.0); look = V3(WX + 1.7, 7.6, WZ + 0.4); fov = 60; setPL(1, V3(WX + 3.0, 7.0, WZ + 2.2), [1.0, 0.66, 0.34], 55, 0); hemi.intensity = 1.5;
      workLights(0.8, 0.8); rimHero([0.8, 0.9, 1.0], 420);
      skyT.uGlowDir.value.set(-1, 0, 0).normalize();
      rainN = 380; rainCol = [190, 200, 220]; rainA = 0.07;
      break;
    }
    case 'pTractor': case 'pCrew': case 'pReel': case 'pClose': case 'then': case 'pNow': case 'pNow2': case 'pClass': { pos = V3(0, 60, 0); look = V3(0, 90, -100); fov = 40; rainN = 0; break; }
    case 'face': {        // CLOSE IT IN., the breath before the line goes hot: a real face (Palmer, FSA/OWI, 1942, public domain) graded into the night
      pos = V3(0, 60, 0); look = V3(0, 90, -100); fov = 40; rainN = 0;
      break;
    }
    case 'face2': {   // a second real face (Palmer, 1942) under THE WORKING CLASS.; the mark's plate is drawn in 2D
      pos = V3(0, 60, 0); look = V3(0, 90, -100); fov = 40; rainN = 0;
      break;
    }
    case 'glove': {       // ALL NIGHT.: the gauntlet closes on the stick in the strobe (macro, below and outside the hand)
      const P = lm.palm('L'), F = lm._body(), hp = P.palm, sd = stick.userData.dir;
      pos = hp.clone().addScaledVector(F.xL, 0.7).addScaledVector(F.fwd, -0.2).add(V3(0, -0.25, 0)); look = hp.clone().addScaledVector(sd, 0.05);
      fov = 28; roll = -0.04;
      workLights(0.5); rimHero([1.0, 0.6, 0.22], 120 + 500 * sk, P.palm);
      rainN = 420; rainA = 0.09; rainCol = [200, 190, 170]; drop = true;   // c20: OUT IN THE STORM: rain on the lens and in the air
      break;
    }
    case 'close': {       // the hook in the pull ring, the barrel driven up into the cutout: v6 no body, the tool and the cutout alone, from below
      pos = ringP.clone().add(V3(1.5 - 0.25 * u, -1.5, 2.3)); look = ringP.clone().add(V3(-0.1, 0.15, 0)); fov = 38;
      workLights(1); rimHero([0.75, 0.85, 1.0], 380);
      rainN = 380; drop = true;
      if (beat >= 23.5) { glowT.U.uStrobe.value = -0.95; SL[0].intensity *= 0.3; site.strobeL.intensity = 0; heroRim.intensity *= 0.3; rainN = 0; }
      break;
    }
    case 'hot': {         // LINE'S HOT.: from below the cutout, the arc the only source, the four conductors white; no body (v6)
      pos = V3(WX + 0.6, 5.2, WZ + 4.6).add(shake(beat, 0.03 * arc)); look = V3(WX + 1.4, 8.8, WZ - 0.4); fov = 54;
      workLights(0.3); rimHero([0.8, 0.9, 1.0], 300 + 1500 * arcLit);
      skyT.uFlash.value.set(0.05 * arc, 0.06 * arc, 0.08 * arc);   // the impact frame is two-valued: no flash-lit cloud deck to blot it
      rainN = 340; rainCol = [200, 215, 255];
      break;
    }
    case 'sil': case 'sil2': { pos = V3(WX + 1.0, 5.6, WZ + 4.4); look = V3(WX + 1.8, 8.4, WZ - 0.4); fov = 56; workLights(0.3); rainN = 0; break; }   // v6: the plates carry the slams (drawSilPlate)
    case 'yard': case 'yard2': {   // every boom rises at once against the flash-lit storm deck; every tip strobe fires
      world = conv; convoyAt(t); yardAt(beat);
      const e = Math.max(0.7 * strikeEnvelope(t, bt(32)), 0.5 * strikeEnvelope(t, bt(36)));
      if (S.name === 'yard') { pos = V3(convoy.yard.x - 16 + 1.5 * u, 1.0, convoy.yard.z0 + 14); look = V3(convoy.yard.x + 4, 9.5, convoy.yard.z0 - 40); fov = 50; }
      else { pos = V3(convoy.yard.x - 7, 0.9, convoy.yard.z0 - 22); look = V3(convoy.yard.x + 1, 11, convoy.yard.z0 - 44); fov = 58; }
      skyC.uGlowDir.value.set(0.4, 0, -1).normalize(); skyC.uFlash.value.set(0.22 * e + 0.05, 0.26 * e + 0.06, 0.32 * e + 0.08); skyC.uGlow.value.set(0.8, 0.46, 0.2);
      glowC.U.uAll.value = 1.6 * e; glowC.U.uStrobe.value = e;
      for (const [a, b2] of convoy.yardTips) glowC.set(b2, null, 3 + 5 * e, 3 + 5 * e, ARC.map(v => v * 0.8 * e));
      rainN = 280; rainA = 0.05; rainCol = [200, 210, 230];
      break;
    }
    // ---- the trace in reverse (WE POWER IT., b44-52): the places the current passed come back on, courthouse clock first, the OPEN sign last
    case 'rclock': {      // the clock stage at 2:00: the floods strike on, the content low in the frame so the words have clean sky
      pos = V3(CH.x + 7 - 1.4 * u, 6.5, 15); look = V3(CH.x - 0.5, 29, CH.z + 2); fov = 50; hemi.intensity = 1.2;
      skyT.uGlowDir.value.set(-0.3, 0, -1).normalize(); skyT.uGlow.value.set(0.7, 0.4, 0.16);
      rainN = 140; rainA = 0.05;
      break;
    }
    case 'rgas': {        // the canopy comes back on (the same camera as the trace, the same flicker-on)
      { const cx = 160 + 0.8 * u; pos = V3(cx, 1.7, 7); look = V3(cx + 12, 12.5, -21); fov = 58; } hemi.intensity = 1.3;
      const a = beat - 45.25; const on = a < 0 ? 0.12 : a < 0.5 ? (hash(Math.floor(a * 24) + 8) > 0.45 ? 1 : 0.1) : 1; signs.gas[0].color.setScalar(2.2 * on); signs.gas[1].color.setScalar(0.9 * on); if (a >= 0 && a < 0.5) glowT.U.uFlick.value = 1;
      signs.motel.color.setScalar(0.22);
      setPL(1, V3(gasX() - 1, 4.4, -16), [1, 0.96, 0.9], 140 * clamp(0.25 + on, 0, 1), 0);
      rainN = 140;
      break;
    }
    case 'rmotel': {      // the MOTEL sign
      { const cx = 85 + 0.8 * u; pos = V3(cx, 1.7, 7); look = V3(cx + 9, 11.5, -14); fov = 58; } hemi.intensity = 1.3;
      const a = beat - 46.25; if (a >= 0 && a < 0.6) { const on = hash(Math.floor(a * 24) + 6) > 0.4 ? 1 : 0.08; signs.motel.color.setScalar(1.8 * on); glowT.U.uFlick.value = 1; } else signs.motel.color.setScalar(a < 0 ? 0.22 : 1.8);
      setPL(1, V3(104, 3.5, -14), [1.0, 0.55, 0.25], 120, 0);
      rainN = 140;
      break;
    }
    case 'rdiner': {      // the OPEN sign strikes: frame 0's picture, the last light causes the first
      vOff = -260;
      pos = V3(0.0, 1.46, DZ + 2.3 - 0.18 * u); look = V3(0, 1.75, DZ - 0.28); fov = 45; drop = true; rainN = 0;
      setPL(1, V3(0, 3.5, DZ + 4), [0.5, 0.55, 0.7], 20, 0);
      break;
    }
    case 'town': case 'mark': default: {   // the whole town lit from the bucket's height, a real man in the foreground (drawMan)
      const hp = V3(WX + 2.1, 8.9, WZ + 0.9);
      const uu = S.name === 'town' ? u : 1, lift = 3.4 + 1.2 * ease.inOutCubic(clamp((beat - 48.5) / 3.0));   // c20: above the wires from the first frame
      streets.visible = true; STREET.uWaveX.value = lerp(640, -620, ease.inOutCubic(clamp((beat - 48.5) / 1.4)));
      pos = V3(hp.x + 2.6 + 0.4 * uu, hp.y + 0.35 + lift, hp.z + 1.5);
      look = V3(WX - 200, 3 + 4 * (1 - ease.inOutCubic(clamp(uu * 1.2))), WZ - 105 + 25 * uu); fov = 64 - 2 * uu;
      glowT.set(site.floodG, null, 0.0, 0.0);   // the pickup's flood is behind us here: no floating orb on the street
      workLights(0.25, 0.2); hemi.intensity = 1.7; poolsT.m.material.opacity = 1;
      skyT.uGlow.value.set(0.5, 0.29, 0.13).multiplyScalar(1.9);
      rainN = 200; rainCol = [200, 215, 255];
      break;
    }
  }
  // courthouse lights (live whenever the town is in the picture after b10)
  { const ck2 = beat < 44.2 ? 0 : Math.max(strikeEnvelope(t, bt(44.2)), beat > 44.2 + 8 * FR / SPB ? 1 : 0.9 * clamp((t - bt(44.2)) * 30 / 8));
    const k = ['courtA', 'courtB', 'clock'].includes(S.name) ? (S.name === 'clock' ? 1 : courtK) : S.name === 'rclock' ? ck2 : S.name === 'town' ? 1 : 1;
    const up = 1;
    // c20 THE TURN: as the current passes the courthouse (b11.2-11.9) its lights dip and stutter, then come back on the wire's terms
    const dd = beat - 11.2, courtDip = S.name === 'clock' && dd >= 0 && dd < 0.75 ? (hash(Math.floor(dd * 24) + 31) > 0.55 ? 0.4 : 0.0) * (dd < 0.08 ? 0.3 : 1) : 1;
    clock.mats[0].color.setRGB(1.25 * courtDip, 1.18 * courtDip, 1.0 * courtDip);
    if (['courtA', 'courtB', 'clock', 'rclock', 'town'].includes(S.name)) court.up.forEach((q, i) => { if (i < 3) setSL(i, q.p.clone().add(V3(i === 1 ? 5 : i === 2 ? 10 : 0, 0, 0)), q.t.clone().add(V3(i === 1 ? 5 : i === 2 ? 10 : 0, 0, 0)), [1.0, 0.8, 0.52], (S.name === 'clock' ? 420 : S.name === 'rclock' ? 520 : S.name === 'courtA' || S.name === 'courtB' ? 480 : 900) * k * up * courtDip, 0.7); });
    if (['courtA', 'courtB', 'clock', 'rclock', 'town'].includes(S.name)) { SL[0].position.set(CH.x - 9, 1.8, CH.z + 16); SL[0].target.position.set(CH.x - 7, 10, CH.z + 11); SL[1].position.set(CH.x, 1.8, CH.z + 18.5); SL[1].target.position.set(CH.x, 13, CH.z + 11); SL[2].position.set(CH.x + 9, 1.8, CH.z + 16); SL[2].target.position.set(CH.x + 7, 10, CH.z + 11); for (const l of SL) l.penumbra = 0.8; }
    court.winMat.emissiveIntensity = 0.0;
    // the lawn flag: a slow ripple
    const P0 = court.flagP0, Pa = court.flagGeo.attributes.position; for (let i = 0; i < Pa.count; i++) { const x = P0[i * 3], y = P0[i * 3 + 1]; Pa.setXYZ(i, x, y + Math.sin(x * 2.2 - t * 5) * 0.05 * x, Math.sin(x * 1.8 - t * 4.2) * 0.22 * (x / 4.2)); } Pa.needsUpdate = true; court.flagGeo.computeVertexNormals();
  }
  // the four conductors: the line is hot after the slam; full white for two frames on each arc (the mark)
  if (world === town) { const k = markFrame ? 2.2 : hotK; HOT.color.setRGB(0.8 * k, 0.9 * k, 1.1 * k); }

  if (QS.has('dbg')) { const f = v => v.toArray().map(x => x.toFixed(2)).join(','); console.log(`DBG b${beat.toFixed(2)} shot=${S.name} cam=${f(pos)} look=${f(look)} arc=${f(arcP)} ring=${f(ringP)} head=${lineman ? f(lm.joint('head')) : '-'} palmL=${lineman ? f(lm.palm('L').palm) : '-'} sd=${lineman ? f(stick.userData.dir) : '-'} fwd=${lineman ? f(lm._body().fwd) : '-'} face=${lineman ? JSON.stringify(lm.faceTier(camera)) : '-'}`); }
  if (QS.get('cam_' + S.name)) { const c = QS.get('cam_' + S.name).split(',').map(Number); pos = V3(c[0], c[1], c[2]); look = V3(c[3], c[4], c[5]); fov = c[6] || fov; vOff = 0; }
  if (QS.get('cam') || window.__cam) { const c = (window.__cam || QS.get('cam')).split(',').map(Number); pos = V3(c[0], c[1], c[2]); look = V3(c[3], c[4], c[5]); fov = c[6] || fov; }
  // ---- camera + render
  camera.position.copy(pos); camera.fov = fov; camera.up.set(Math.sin(roll), Math.cos(roll), 0); camera.lookAt(look);
  if (vOff) camera.setViewOffset(RW, RH, 0, vOff * SC, RW, RH); else camera.clearViewOffset();
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  if (lineman && S.name !== 'sil2') skyT.uGlow.value.set(0.42, 0.26, 0.12);
  { const d = look.clone().sub(pos); if (world === town && lineman) skyT.uGlowDir.value.set(d.x, 0, d.z).normalize(); if (['neon', 'diner', 'wire', 'motel', 'gas'].includes(S.name)) skyT.uGlowDir.value.set(d.x, 0, d.z).normalize(); }
  rimFrom(arcP, V3(WX, 10, WZ), [0.12 + 0.8 * arcLit, 0.14 + 0.8 * arcLit, 0.18 + 0.8 * arcLit]);
  rimFrom(site.tipStrobe, V3(WX, 10, WZ), [0.9 * sk, 0.5 * sk, 0.1 * sk], 2);
  renderer.toneMappingExposure = exposure;
  renderer.setClearColor(0x000000, 1);
  renderer.render(world, camera);

  // ---- 2D composite: the world, the crowd, rain, drops
  cg.globalCompositeOperation = 'source-over'; cg.globalAlpha = 1; cg.filter = 'none';
  { const gl = renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }   // v8: sync before the copy (on the farm's V100s an unsynced copy took a stale frame from another shot: the courthouse floods 'flickered' off)
  RQ.present(cg, renderer.domElement, renderer.getContext(), { w: W, h: H });
  if (S.name === 'town' || S.name === 'mark') {   // c20: the lineman's face takes the town's light as the shot opens (the light they kept comes back to them)
    const k = S.name === 'mark' ? 1 : ease.inOutCubic(clamp((beat - 48.5) / 0.9));
    if (!drawPerson(cg, 'town', S.name === 'mark' ? 1 : u, t, { lit: 0.3 + 0.75 * k, push: 0.03 })) drawMan(cg, 0.3 + 0.7 * k, t);
  }
  if (S.name === 'mark') drawGrowMark(cg, beat);
  if (S.name === 'face') drawFace(cg, u, t, beat, FACEIMG, { vy: 0.3, dy: -200 });
  if (PHOTO) drawPlate(cg, PHOTO, u, t, beat);
  if (S.name === 'sil') drawSilPlate(cg, 'tractor', arc, onFrame(beat, 26, 2));
  if (S.name === 'sil2') drawSilPlate(cg, 'crew', arc, onFrame(beat, 27, 2));
  if (S.name === 'then') drawFace(cg, u, t, beat, FACE2IMG, { z: 1.0, ax: 0.5, ay: 0.5, ty: 0.5, dy: 380, push: 0.05, strobe: false, vy: 0.66, lift: 1.35 });   // 1942: ALL LEGITIMATE POWER
  if (S.name === 'pNow' || S.name === 'pNow2' || S.name === 'pClass') {   // the present: line workers at the truck tonight; CLASS. lands on a face
    drawNight(cg, t, beat, S.name === 'pClass' ? 0.6 : 1);
    if (!drawPerson(cg, S.name, u, t, { push: S.name === 'pClass' ? 0.05 : 0.035 })) {
      if (S.name === 'pClass') drawFace(cg, u, t, beat, FACEIMG, { z: 1.0, ax: 0.5, ay: 0.5, ty: 0.5, dy: 420, push: 0.05, strobe: false, vy: 0.7, lift: 1.5 });
      else drawPlate(cg, S.name === 'pNow' ? 'crew' : 'tractor', u, t, beat);
    }
    rain(cg, t, 140, [190, 200, 220], 0.05, 0.16, 70, []);
  }
  if (crowd) { const vp = look.clone().project(camera); RK.compose(cg, crowd, t, { style: CROWD_STYLE, sun: [(vp.x * 0.5 + 0.5) * W, (-vp.y * 0.5 + 0.5) * H - 60], ground: false, dust: false, gapAmt: 0.12, shadowAmt: 0 }); }
  if (drop) { tpg.drawImage(comp, 0, 0); drops(cg, t, tmp); }
  if (rainN) {
    if (lineman) { const pa = arcP.clone().project(camera); rainLights = [{ x: (pa.x * 0.5 + 0.5) * W, y: (-pa.y * 0.5 + 0.5) * H, r: 600, k: 0.9 * arcLit }]; }
    rain(cg, t, rainN, rainCol, rainA, 0.16, 70, rainLights);
  }
  // ---- the drop's impact frame (NOTAN): the arc inverted to ink, LINE'S HOT. knocked out of it as paper
  const impact = dropHold, fImp = fDrop - DROP_HOLD + 1;
  if (impact) notanImpact(cg);
  else if (fImp >= 1 && fImp <= 3) notanImpact(cg, [0, 0.72, 0.42, 0.16][fImp]);   // after the hold the impact settles over three frames (LOOKS c1 rule)
  // ---- type, closer, post
  if (QS.has('notype')) tg.clearRect(0, 0, W, H); else drawType(beat, t);
  if (beat >= CLOSE) lockup(tg, (beat - CLOSE) * SPB, cg, beat);
  const FIG = lineman && showBody;
  post.apply({ world: comp, type: typeC }, t, {
    bloom: { amount: impact ? 0 : S.name === 'mark' ? 0.28 : (FIG ? 0.32 : 0.7) + 0.22 * arcLit, threshold: FIG ? 0.72 : 0.62, radius: FIG ? 0.9 : 1.1 }, halation: { amount: impact ? 0 : 0.3, tint: [1, 0.45, 0.15] },
    streaks: { amount: impact ? 0 : 0.25 + 0.6 * arcLit, threshold: 0.75, tint: [0.75, 0.85, 1.0], stretch: 0.93 },
    lens: { distort: impact ? 0 : 0.015, ca: impact ? 0 : 0.002 },
    film: { tonemap: 0, exposure: 0, contrast: impact ? 0 : 0.42, sat: impact ? 0 : 1.0, shoulder: 0.35, split: { shadows: [0.16, 0.33, 0.36], highlights: [0.8, 0.56, 0.32], amount: impact ? 0 : 0.42 }, fade: 0.0 },
    vignette: { amount: impact ? 0 : 0.45 }, grain: { amount: impact ? 0 : 0.45, size: 1.3 },
    type: { glow: 0, shadow: 0, grain: 0.15 },
  });
  post.sync();                                    // v8: settle the post chain before the frame is captured
};
// NOTAN impact: 1-bit, blue-noise dithered at 2 px, inverted (light becomes ink), on ivory; one frame, then the arc
const NT = document.createElement('canvas'); NT.width = W / 2; NT.height = H / 2; const ntg = NT.getContext('2d', { willReadFrequently: true });
function notanImpact(g, k = 1) {
  ntg.drawImage(comp, 0, 0, NT.width, NT.height); const im = ntg.getImageData(0, 0, NT.width, NT.height), d = im.data;
  for (let y = 0; y < NT.height; y++) for (let x = 0; x < NT.width; x++) { const i = (y * NT.width + x) * 4, l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    const ign = (52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1, ink = l > 0.3 + 0.05 * ign;
    const c = ink ? [14, 12, 11] : [239, 232, 214]; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; }
  ntg.putImageData(im, 0, 0); g.save(); g.globalAlpha = k; g.imageSmoothingEnabled = false; g.drawImage(NT, 0, 0, W, H); g.restore();
}
function shake(beat, amp, freq = 13) { return V3(Math.sin(beat * freq) * amp, Math.sin(beat * freq * 1.3 + 1) * amp, 0); }
const tmpV = new THREE.Vector3();
function setPL(i, p, c, I, dist = 0) { PL[i].position.copy(p); PL[i].color.setRGB(...c); PL[i].intensity = I; PL[i].distance = dist; }
function setSL(i, p, tgt, c, I, ang = 0.5) { SL[i].penumbra = 0.6; SL[i].position.copy(p); SL[i].target.position.copy(tgt); SL[i].color.setRGB(...c); SL[i].intensity = I; SL[i].angle = ang; }
function lightsOff() { for (const l of PL) l.intensity = 0; for (const l of SL) l.intensity = 0; }
function rimFrom(worldLight, center, col, which = 1) {
  const d = worldLight.clone().sub(center).normalize().transformDirection(camera.matrixWorldInverse);
  (which === 1 ? RIM.d1 : RIM.d2).value.copy(d); (which === 1 ? RIM.c1 : RIM.c2).value.setRGB(...col.map(v => v * 0.5));
}

// the lockup over the last world frame (darkened under it), then the loop fold: the arc's afterimage shrinks to the
// neon's argon-blue border colour and stutters on 16ths with the reversed ballast buzz into frame 0's strike
function lockup(g, age, world, beat) {
  // v5: no stock sigil and no second dim: the mark that grew from the four conductors (drawGrowMark, shot 'mark') IS the end card; the address lands under it.
  // c20: the mark and the address hold over the ringing chord (b52-58.4, about 4 s), then the loop fold (b58.4-60)
  const a = ease.outExpo(clamp(age / 0.3)) * (1 - smooth(END_B - 1.7, END_B - 1.0, beat));
  if (a > 0.01) line(g, 'ACP.US', W / 2, 1190, { family: 'Archivo Black', size: 76, color: C.cream, alpha: clamp((age - 0.1) * 5) * a });
  if (beat >= END_B - 1.4) {   // the afterimage -> argon
    const u = clamp((beat - END_B + 1.4) / 1.3), st = Math.floor(beat * 4) % 2 ? 0.55 : 1, r = lerp(160, 34, u);
    const gr = world.createRadialGradient(W / 2, 760, 0, W / 2, 760, r * 3); gr.addColorStop(0, `rgba(${Math.round(lerp(255, 120, u))},${Math.round(lerp(250, 170, u))},255,${0.9 * st})`); gr.addColorStop(0.3, `rgba(40,90,255,${0.45 * st})`); gr.addColorStop(1, 'rgba(0,0,40,0)');
    world.fillStyle = gr; world.fillRect(0, 0, W, H);
  }
}

// warm up both worlds once so the first frame is not a compile stall
renderer.compile(town, camera); renderer.compile(conv, camera);
window.sceneReady = true;
