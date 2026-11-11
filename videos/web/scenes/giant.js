// THE GIANT (giant) v2: the lab look (lab_shaders2 ?shot=giant) carried through the whole piece. A 70 m ironworker,
// always a silhouette against the sky, climbs a bare steel tower at blue hour while the night crews haul on every deck.
// Each HEAVE! is one pull: the hand closes on steel, the decks it passes light, the city lights after it in rings.
// It tops the tower out, stands, and its fist closes on a new red sun and hauls it up the sky.
// Rendered through lib/fx/atmos.js (silhouette, separation line, haze, shafts, warm-floor grade). Rules held here:
// no front-lit face at mid distance or closer (the titan is only ever seen from behind, below or far off, lit from
// behind); no window-grid city (the grammar city is dark mass lit from the streets in rings); the fist is a sculpted
// closed fist (fistGeo) on the grip frame, not the people.js mitten; the hard hat is dark so the sun-lit brim can't
// draw a halo ring. Chant text: HEAVE! only on the heave hits (5 frames, cleared between); calls are short slams.
// Words: research/scripts_final/giant.json. Song: web/audio/songs2/giant.py (128 BPM, logo at b60).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { W, H, C, loadFonts, loadBeats, clamp, lerp, ease, smooth, rng, Finish, closer, line, acpEmblem } from '../lib/kit.js';
import { RQ } from '../lib/rq.js';
import { People } from '../lib/fx/people.js';
import { Atmos } from '../lib/fx/atmos.js';
import { GESTURES } from '../lib/fx/gesture.js';
import { city as grammarCity } from '../lib/fx/sim2/grammar.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ctx = document.getElementById('out').getContext('2d');
await loadFonts();
const B = await loadBeats('giant');
const finish = new Finish(1928);
const QS = new URLSearchParams(location.search); window.DEBUG = QS.has('debug');
const ATO = QS.get('atm') ? JSON.parse(QS.get('atm')) : {};   // debug: atmos overrides, e.g. ?atm={"edge":{"amount":0}}

// ---------------------------------------------------------------- words (scripts_final/giant.json, exactly)
// [beat, text, frames on screen, red]. HEAVE! is slammed on its hit only; the calls are complete shouts, short.
const HEAVES = [2, 4, 7, 12, 13, 17, 18, 19, 22, 26, 27, 31, 33, 34, 35, 36, 39, 40, 41, 46, 56, 58];
// all cream: red type on the red and violet skies failed OCR and a phone glance (gate pass 1)
const CALLS = [[0, 'HUMAN POWER.', 14], [1, 'ALL TOGETHER!', 14], [6, 'ALL TOGETHER!', 15], [10, 'LOCK IN!', 15], [16, 'GRAB A LINE!', 15],
  [24, 'UP SHE GOES!', 15], [30, 'ALL TOGETHER!', 15], [32, 'EVERYBODY!', 15], [38, 'TOP IT OUT!', 15], [44, 'ONE MORE!', 15],
  [47, 'ON YOUR FEET!', 14], [48, 'A NEW SUN.', 24], [50, 'A RED SUN.', 24], [52, 'ALL TOGETHER!', 15]];
const CUES = [...CALLS.map(([b, text, f, red]) => ({ b, text, f, red: !!red })),
  ...HEAVES.map((b, i) => ({ b, text: 'HEAVE!', f: b >= 56 ? 16 : 6, heave: i, red: false }))].sort((a, b) => a.b - b.b);
const CLOSE = 60;

// ---------------------------------------------------------------- renderer + atmos
const ADOPT = false;   // GRAPHICS 4.A (lib/rq.js): true = native resolution on the GPU and a fenced copy, once this piece's farm A/B says so
const SC = RQ.scale(0.7, ADOPT), RW = Math.round(W * SC), RH = Math.round(H * SC);
const PK = RQ.k(), PXM = RQ.glslMul(PK);   // the sparks' fixed-pixel clamp keeps its displayed size at another scale (PK = SC / 0.7; '' at 0.7)
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(RW, RH, false);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, RW / RH, 0.5, 30000);
const atm = new Atmos(renderer, { w: RW, h: RH, samples: 2 });

// ---------------------------------------------------------------- shared uniforms: the sky moves blue hour -> red sun
const U = {
  uZen: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
  uSunDir: { value: V(1, 0, 0) }, uSunR: { value: 0.02 }, uSunI: { value: 0 }, uSunC: { value: new THREE.Color() }, uStars: { value: 1 },
  uLitY: { value: 0 }, uWave: { value: 0 }, uDawn: { value: 0 }, uKick: { value: 0 }, uT: { value: 0 },
};
const COMMON = /* glsl */`
uniform vec3 uZen, uMid, uHor, uGlow, uSunDir, uSunC; uniform float uSunR, uSunI, uStars, uLitY, uWave, uDawn, uKick, uT;
float h11(float n){ return fract(sin(n*127.1)*43758.5453); }
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
`;
const skyMat = new THREE.ShaderMaterial({
  uniforms: U, side: THREE.BackSide, depthWrite: false,
  vertexShader: `varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
  fragmentShader: COMMON + `varying vec3 vD;
  void main(){
    vec3 d = normalize(vD); float y = d.y;
    vec3 c = mix(uHor, uMid, smoothstep(-0.03, 0.2, y)); c = mix(c, uZen, smoothstep(0.2, 0.85, y));
    // the dawn band: low, strongest toward the sun's azimuth
    vec2 sa = normalize(uSunDir.xz + 1e-5); float az = dot(normalize(d.xz + 1e-5), sa) * 0.5 + 0.5;
    c += uGlow * exp(-max(y, 0.0) * 9.0) * pow(az, 3.0);
    c += uGlow * 0.25 * exp(-max(y, 0.0) * 3.0) * pow(az, 6.0);
    // high thin cloud streaks catching the light (so the big skies are never a flat gradient)
    float cl = vn(vec2(atan(d.z, d.x) * 5.0, y * 38.0)) * vn(vec2(atan(d.z, d.x) * 11.0 + 3.0, y * 90.0));
    c += (uGlow * 0.5 + uMid * 0.6) * smoothstep(0.25, 0.6, cl) * smoothstep(0.02, 0.1, y) * (1.0 - smoothstep(0.25, 0.5, y)) * 0.35;
    // stars (blue hour only)
    vec2 sp = floor(vec2(atan(d.z, d.x), asin(clamp(y,-1.0,1.0))) * 380.0);
    c += vec3(0.7, 0.8, 1.0) * step(0.9975, h21(sp)) * smoothstep(0.25, 0.5, y) * uStars * 0.35;
    // the sun: halo, limb-darkened disc, refraction striations low in the disc
    float s = dot(d, uSunDir), a = acos(clamp(s, -1.0, 1.0)), R = uSunR;
    c += uSunC * uSunI * (0.18 * exp(-a * 3.0) + 0.55 * exp(-a / R * 0.9) * 0.6);
    float disc = smoothstep(R * 1.006, R * 0.994, a), limb = sqrt(max(0.0, 1.0 - pow(a / R, 2.0)));
    vec3 dc = uSunC * (2.2 + 1.3 * limb);
    dc *= 1.0 - 0.14 * smoothstep(0.35, 0.85, sin(d.y / R * 9.0) * 0.5 + 0.5) * smoothstep(0.0, -R, d.y - uSunDir.y);
    c = mix(c, dc, disc * uSunI);
    gl_FragColor = vec4(c, 1.0);
  }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 64, 32), skyMat); sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);

// ---------------------------------------------------------------- ground: dark land, sodium streets lit in rings
const PITCH = 76, STREET = 16;
const groundMat = new THREE.ShaderMaterial({
  uniforms: U,
  vertexShader: `varying vec3 vW; void main(){ vec4 p = modelMatrix*vec4(position,1.0); vW = p.xyz; gl_Position = projectionMatrix*viewMatrix*p; }`,
  fragmentShader: COMMON + `varying vec3 vW;
  void main(){
    vec2 p = vW.xz; float P = ${PITCH.toFixed(1)}, S = ${STREET.toFixed(1)};
    vec2 g = mod(p + P*0.5 - S*0.5, P); vec2 de = min(g, P - g);
    float street = step(min(de.x, de.y), S*0.5);
    float r = length(p);
    vec3 c = vec3(0.006, 0.006, 0.008) + vec3(0.004) * street;
    vec2 q = mod(p, 19.0) - 9.5;
    float lampd = min(length(vec2(q.x, de.y - S*0.42)), length(vec2(de.x - S*0.42, q.y)));
    float lit = mix(0.06, 1.0, smoothstep(uWave + 90.0, uWave - 60.0, r * (0.85 + 0.3*h21(floor(p/P)))));
    lit *= smoothstep(9000.0, 2500.0, r);
    vec3 sod = vec3(1.0, 0.45, 0.12);
    c += sod * exp(-lampd*lampd/40.0) * 0.35 * street * lit;
    c += sod * exp(-lampd*lampd/3.0) * 2.2 * lit;
    c += vec3(1.0, 0.7, 0.4) * 0.25 * exp(-r*r/3000.0) * step(1.0, uLitY);
    gl_FragColor = vec4(c, 1.0);
  }`,
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), groundMat); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.2; scene.add(ground);

// ---------------------------------------------------------------- the city: grammar massing, dark, lit from the streets
const cityMat = new THREE.ShaderMaterial({
  uniforms: U,
  vertexShader: `attribute vec4 aExt; varying vec3 vW; varying vec3 vN; varying vec4 vX;
    void main(){ vec4 p = modelMatrix*vec4(position,1.0); vW = p.xyz; vN = normalize(mat3(modelMatrix)*normal); vX = aExt; gl_Position = projectionMatrix*viewMatrix*p; }`,
  fragmentShader: COMMON + `varying vec3 vW; varying vec3 vN; varying vec4 vX;
  void main(){
    vec3 n = normalize(vN); float r = length(vW.xz);
    vec3 c = vec3(0.012, 0.012, 0.016) * (0.8 + 0.4 * h11(floor(vX.z * 50.0)));
    c += mix(uZen, uMid, 0.5) * 0.35 * max(n.y, 0.0);                                   // roofs take the sky
    c += uGlow * 0.08 * max(dot(n, normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);   // the dawn side
    c += uSunC * uSunI * 0.25 * max(dot(n, uSunDir), 0.0);
    float lit = smoothstep(uWave + 60.0, uWave - 80.0, r * (0.9 + 0.2 * h11(floor(vX.z * 77.0))));
    c += vec3(1.0, 0.45, 0.12) * exp(-vW.y / 9.0) * (0.25 + 0.5 * (1.0 - abs(n.y))) * mix(0.08, 1.0, lit);   // sodium uplight from the street
    // a few work lights on the roofs, switched on by the wave
    gl_FragColor = vec4(c, 1.0);
  }`,
});
const cityGroup = new THREE.Group(); scene.add(cityGroup);
{
  // the core (around the tower): full grammar massing, deco style (asset round, 4 Oct: was plain; the far city below is varied per tile), the tower's block cut out
  const Bc = grammarCity({ seed: 11, blocks: [7, 7], block: 60, street: STREET, style: 'deco', centre: [0, 0], hMax: 150 });
  const gs = [];
  for (const name in Bc.parts) { if (name === 'street' || name === 'pavement') continue;
    const P = Bc.parts[name], n = P.pos.length / 9, pos = new Float32Array(P.pos.length), nrm = new Float32Array(P.pos.length), ext = new Float32Array(n * 12); let k = 0;
    for (let i = 0; i < P.pos.length; i += 9) {
      const cx = (P.pos[i] + P.pos[i + 3] + P.pos[i + 6]) / 3, cz = (P.pos[i + 2] + P.pos[i + 5] + P.pos[i + 8]) / 3;
      if (Math.abs(cx) < 118 && Math.abs(cz) < 118) continue;   // the site: a cleared plaza round the tower
      for (let j = 0; j < 9; j++) { pos[k * 9 + j] = P.pos[i + j]; nrm[k * 9 + j] = P.nrm[i + j]; }
      for (let j = 0; j < 12; j++) ext[k * 12 + j] = P.ext[i / 3 * 4 + j];
      k++;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k * 9), 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm.subarray(0, k * 9), 3));
    g.setAttribute('aExt', new THREE.BufferAttribute(ext.subarray(0, k * 12), 4)); gs.push(g); }
  const core = new THREE.Mesh(mergeGeometries(gs), cityMat); core.frustumCulled = false; cityGroup.add(core);
  // the rest of the city to the haze: the same grammar's massing boxes, instanced (far and hazed only)
  const Bo = grammarCity({ seed: 23, blocks: [9, 9], block: 60, street: STREET, style: 'plain', centre: [0, 0], hMax: 80 });
  const boxes = Bo.boxes.filter(b => b[4] - b[1] > 2), T = 9 * PITCH, tiles = [];
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) tiles.push([i, j]);
  const bg = new THREE.BoxGeometry(1, 1, 1); bg.translate(0, 0.5, 0);
  // asset round (4 Oct): one layout tiled 49 times read as voxels on a grid. Each tile is now flipped / turned a quarter, heights jitter per
  // building, and the taller ones carry a setback upper tier
  const n = boxes.length * tiles.length * 2, inst = new THREE.InstancedMesh(bg, null, n), ex = new Float32Array(n * 4), m = new THREE.Matrix4(), r = rng(3); let q = 0;
  for (const [i, j] of tiles) { const d = Math.hypot(i, j), hk = Math.max(0.35, 1.1 - 0.18 * d), fx = r() < 0.5 ? -1 : 1, fz = r() < 0.5 ? -1 : 1, rot = r() < 0.5;
    for (const b of boxes) { if (r() < 0.08 * d) continue; if (!i && !j && Math.max(Math.abs(b[0] + b[3]), Math.abs(b[2] + b[5])) / 2 < 285) continue;
      const h = (b[4] - b[1]) * hk * (0.7 + 0.6 * r());
      let cx = fx * (b[0] + b[3]) / 2, cz = fz * (b[2] + b[5]) / 2, sx = b[3] - b[0], sz = b[5] - b[2];
      if (rot) { [cx, cz] = [cz, cx]; [sx, sz] = [sz, sx]; }
      if (!i && !j && Math.max(Math.abs(cx), Math.abs(cz)) < 285) continue;
      m.makeScale(sx, h, sz).setPosition(i * T + cx, b[1] * hk, j * T + cz); inst.setMatrixAt(q, m); ex.set([3.6, 2, r(), 0], q * 4); q++;
      if (h > 18 && r() < 0.7) { const k = 0.55 + 0.25 * r(), h2 = h * (0.25 + 0.45 * r());       // the setback tier
        m.makeScale(sx * k, h2, sz * k).setPosition(i * T + cx + (r() - 0.5) * sx * (1 - k), b[1] * hk + h, j * T + cz + (r() - 0.5) * sz * (1 - k)); inst.setMatrixAt(q, m); ex.set([3.6, 2, r(), 0], q * 4); q++; } } }
  inst.count = q; bg.setAttribute('aExt', new THREE.InstancedBufferAttribute(ex, 4));
  inst.material = cityMat.clone(); inst.material.vertexShader = inst.material.vertexShader.replace('vec4 p = modelMatrix*vec4(position,1.0);', 'vec4 p = modelMatrix*instanceMatrix*vec4(position,1.0);').replace('normalize(mat3(modelMatrix)*normal)', 'normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal)');
  inst.material.uniforms = U; inst.frustumCulled = false; cityGroup.add(inst);
}

// ---------------------------------------------------------------- the tower: bare steel frame, floods per deck
const DECK = 4, NDECK = 72, TOP = DECK * NDECK, HALF = 18;
const COLS = [-18, -6, 6, 18];
const tower = (() => {
  const items = [];
  for (const x of COLS) for (const z of COLS) items.push([V(x, TOP / 2, z), V(0.9, TOP, 0.9), 0, 0]);
  for (let d = 1; d <= NDECK; d++) {
    const y = d * DECK;
    for (const z of COLS) for (let k = 0; k < 3; k++) items.push([V((COLS[k] + COLS[k + 1]) / 2, y - 0.35, z), V(12, 0.7, 0.4), 0, 1]);
    for (const x of COLS) for (let k = 0; k < 3; k++) items.push([V(x, y - 0.35, (COLS[k] + COLS[k + 1]) / 2), V(0.4, 0.7, 12), 0, 1]);
    if (d < NDECK - 3 && d % 3 !== 1) items.push([V(0, y - 0.05, 0), V(35.2, 0.15, 35.2), 0, 2]);
    if (d % 2 === 0) for (const face of [0, 1, 2, 3]) {
      const bay = (d / 2 + face) % 3, a = (COLS[bay] + COLS[bay + 1]) / 2, len = Math.hypot(12, DECK), ang = Math.atan2(DECK, 12);
      for (const sgn of [1, -1]) {
        const p = face < 2 ? V(a, y - DECK / 2, face ? HALF : -HALF) : V(face === 2 ? HALF : -HALF, y - DECK / 2, a);
        items.push([p, V(len, 0.3, 0.3), [face < 2 ? 0 : 1, sgn * ang], 3]);
      }
    }
  }
  const g = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(g, null, items.length);
  const kind = new Float32Array(items.length), q = new THREE.Quaternion(), e = new THREE.Euler();
  items.forEach(([p, s, rot, k], i) => {
    if (rot) { e.set(0, rot[0] ? Math.PI / 2 : 0, rot[1], 'YXZ'); q.setFromEuler(e); } else q.identity();
    mesh.setMatrixAt(i, new THREE.Matrix4().compose(p, q, s)); kind[i] = k;
  });
  g.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 1));
  mesh.material = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: `attribute float aKind; varying vec3 vW; varying vec3 vN; varying float vK; varying vec3 vC; varying vec3 vL;
      void main(){ vec4 p = modelMatrix*instanceMatrix*vec4(position,1.0); vW = p.xyz; vK = aKind; vC = instanceMatrix[3].xyz; vL = position;
        vN = normalize(mat3(instanceMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*p; }`,
    fragmentShader: COMMON + `varying vec3 vW; varying vec3 vN; varying float vK; varying vec3 vC; varying vec3 vL;
      void main(){
        vec3 n = normalize(vN), v = normalize(cameraPosition - vW);
        float deck = floor((vW.y + 0.4) / ${DECK.toFixed(1)});
        float on = smoothstep(0.0, 3.0, uLitY - deck*${DECK.toFixed(1)} - h11(deck)*5.0);
        float pid = h21(vC.xz*0.37 + vC.y*1.91);
        vec3 alb = mix(vec3(0.05,0.05,0.055), vec3(0.16,0.045,0.03), step(0.5, pid));
        if (vK > 1.5 && vK < 2.5) alb = vec3(0.018, 0.017, 0.02) * (0.7 + 0.6*vn(vW.xz*0.35));
        if (vK > 2.5) alb = vec3(0.13,0.04,0.03);
        alb *= 0.7 + 0.45*vn(vec2(dot(vW.xz, vec2(0.7,0.7))*0.6, vW.y*3.0));
        float fy = fract((vW.y + 0.4) / ${DECK.toFixed(1)});
        float up = max(n.y, 0.0), dn = max(-n.y, 0.0), side = 1.0 - abs(n.y);
        vec2 cp = abs(mod(vW.xz + 6.0, 12.0) - 6.0);
        float pool = 0.45 + 0.75*exp(-dot(cp, cp)/30.0);
        vec3 flood = vec3(1.0,0.66,0.36) * on * (up*1.3 + side*(0.25 + 0.75*fy*fy) + dn*0.15) * pool * (1.0 + uKick*0.4);
        vec3 c = alb * (flood * 4.0 + mix(uZen, uMid, 0.5) * 0.9 * (0.4 + 0.6*up) + vec3(0.004));
        c += alb * uSunC * uSunI * 3.0 * max(dot(n, uSunDir), 0.0);
        c += uGlow * 0.12 * pow(1.0 - max(dot(n, v), 0.0), 4.0) * (vK < 1.5 ? 1.0 : 0.4);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  mesh.frustumCulled = false; scene.add(mesh);
  const lamps = [];
  for (let d = 1; d <= NDECK; d++) for (const x of COLS) for (const z of COLS) if (Math.abs(x) === 18 || Math.abs(z) === 18) lamps.push(V(x + Math.sign(x) * -0.8, d * DECK - 0.9, z + Math.sign(z) * -0.8));
  const lamp = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.45, 0.9), new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: `varying vec3 vW; void main(){ vec4 p = modelMatrix*instanceMatrix*vec4(position,1.0); vW = p.xyz; gl_Position = projectionMatrix*viewMatrix*p; }`,
    fragmentShader: COMMON + `varying vec3 vW; void main(){ float deck = floor((vW.y + 1.2)/${DECK.toFixed(1)});
      float on = smoothstep(0.0, 1.0, uLitY - deck*${DECK.toFixed(1)} - h11(deck)*5.0);
      gl_FragColor = vec4(mix(vec3(0.02), vec3(6.0,4.2,2.6)*(1.0+uKick*0.5), on), 1.0); }`,
  }), lamps.length);
  lamps.forEach((p, i) => lamp.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
  lamp.frustumCulled = false; scene.add(lamp);
  return { mesh, lamp };
})();

// ---------------------------------------------------------------- cranes: lattice against the sky (the lab still's shafts)
function trussGeo(len, w, { bay = w, chord = 0.12, lace = 0.06 } = {}) {
  const parts = [], n = Math.max(1, Math.round(len / bay)), b = len / n, h = w / 2;
  const bar = (a, c, t) => { const A = V(...a), Cc = V(...c), L = A.distanceTo(Cc), g = new THREE.BoxGeometry(t, L, t);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), Cc.clone().sub(A).normalize()));
    const m = A.clone().add(Cc).multiplyScalar(0.5); g.translate(m.x, m.y, m.z); parts.push(g); };
  const corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
  for (const [x, z] of corners) bar([x, 0, z], [x, len, z], chord);
  for (let i = 0; i <= n; i++) for (let k = 0; k < 4; k++) { const [x0, z0] = corners[k], [x1, z1] = corners[(k + 1) % 4]; bar([x0, i * b, z0], [x1, i * b, z1], lace); }
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { const [x0, z0] = corners[k], [x1, z1] = corners[(k + 1) % 4], up = (i + k) % 2;
    bar([x0, (i + up) * b, z0], [x1, (i + 1 - up) * b, z1], lace); }
  return mergeGeometries(parts);
}
const steelDark = new THREE.MeshStandardMaterial({ color: '#0b0808', roughness: 0.7, metalness: 0.2 });
function crane({ x, y = 0, z, mastH, jib, cjib, rotY, s = 1 }) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(trussGeo(mastH, 2.2 * s, { chord: 0.22 * s, lace: 0.1 * s }), steelDark));
  const j = new THREE.Mesh(trussGeo(jib, 1.6 * s, { chord: 0.16 * s, lace: 0.08 * s, bay: 2.2 * s }), steelDark); j.rotation.z = -Math.PI / 2; j.position.set(0, mastH + 1, 0); g.add(j);
  const cj = new THREE.Mesh(trussGeo(cjib, 1.6 * s, { chord: 0.16 * s, lace: 0.08 * s, bay: 2.2 * s }), steelDark); cj.rotation.z = Math.PI / 2; cj.position.set(0, mastH + 1, 0); g.add(cj);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(3 * s, 2.4 * s, 2.6 * s), steelDark); cab.position.set(1.8 * s, mastH - 0.6 * s, 0); g.add(cab);
  const cw = new THREE.Mesh(new THREE.BoxGeometry(4 * s, 3 * s, 2.2 * s), steelDark); cw.position.set(-cjib + 2 * s, mastH - 1 * s, 0); g.add(cw);
  const apex = new THREE.Mesh(trussGeo(9 * s, 1.2 * s, { chord: 0.14 * s, lace: 0.07 * s, bay: 1.5 * s }), steelDark); apex.position.set(0, mastH + 1, 0); g.add(apex);
  for (const [x1, y1] of [[jib * 0.62, mastH + 1.8 * s], [-cjib, mastH + 1.8 * s]]) {
    const A = V(0, mastH + 10 * s, 0), Bp = V(x1, y1, 0), L = A.distanceTo(Bp), c = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * s, 0.06 * s, L, 4), steelDark);
    c.position.copy(A.clone().add(Bp).multiplyScalar(0.5)); c.quaternion.setFromUnitVectors(V(0, 1, 0), Bp.clone().sub(A).normalize()); g.add(c); }
  g.position.set(x, y, z); g.rotation.y = rotY; scene.add(g);
  g.userData = { mastH, jib, s }; return g;
}
const CR_TOP = crane({ x: -12, y: TOP - 40, z: -12, mastH: 40 + 52, jib: 78, cjib: 24, rotY: 2.35, s: 1.2 });   // climbing crane in the tower's core
crane({ x: -190, y: 0, z: -150, mastH: 200, jib: 85, cjib: 26, rotY: 0.6, s: 1.4 });
crane({ x: 170, y: 0, z: 120, mastH: 170, jib: 80, cjib: 26, rotY: 3.6, s: 1.3 });
const hookLine = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 5), steelDark); hookLine.frustumCulled = false; scene.add(hookLine);

// ---------------------------------------------------------------- people: the titan, the crews, the rigger
const folk = new People(scene, { max: 110, viewH: RH, lodPx: [240, 70], budget: [12, 50], shadows: 'none' });
const GS = 70 / 1.78;
// dark hat and dark vest accent: in back light a pale brim reads as a halo ring (lab still, AUDIT)
const GIANT = folk.add(People.random('steel', 5, { fem: 0, age: 0.35, h: 70, heavy: 0.65, skin: '#4a3428', hair: '#120c08', top: '#23262a', bottom: '#2a241c',
  hat: true, hatColor: '#1e1b18', accent: '#262818', gloves: true, beard: false, stubble: true, dirt: 0.7 }));
const HERO = folk.add(People.random('steel', 17, { fem: 0, age: 0.6, h: 1.8, heavy: 0.55, skin: '#6a4a38', hair: '#4a4440', top: '#1e242c', bottom: '#2a2218',
  hat: true, hatColor: '#2a2622', accent: '#2a3010', gloves: true, stubble: true, beard: false, dirt: 0.6 }));
const CREWS = [];
const CREW_DECKS = [7, 12, 16, 20, 24, 28, 31, 36, 40, 44, 48, 52, 56, 60, 64, 68, 71];
for (const [ci, d] of CREW_DECKS.entries()) {
  const ids = [], trades = ['steel', 'steel', 'weld', 'rail', 'overalls', 'farm'];
  for (let k = 0; k < 5; k++) ids.push(folk.add(People.random(trades[(ci + k) % trades.length], 100 + ci * 7 + k, { gloves: true })));
  CREWS.push({ deck: d, ids, x0: ci % 2 ? -15 : 3, dir: ci % 2 ? 1 : -1 });
}
const ROOFCREWS = [];
{ const r = rng(9);
  for (let k = 0; k < 3; k++) { const ids = []; for (let i = 0; i < 5; i++) ids.push(folk.add(People.random(['rail', 'overalls', 'steel'][k], 300 + k * 5 + i, { gloves: true })));
    ROOFCREWS.push({ ids, x: -150 - 55 * k, z: 40 + r() * 30 - 25 * k, y: 34 + k * 16 }); } }
for (const rc of ROOFCREWS) { const b = new THREE.Mesh(new THREE.BoxGeometry(22, rc.y, 16), cityMat); b.geometry.setAttribute('aExt', new THREE.Float32BufferAttribute(new Float32Array(b.geometry.attributes.position.count * 4), 4)); b.position.set(rc.x + 3, rc.y / 2, rc.z); scene.add(b); }
folk.meshes.forEach(m => m.layers.enable(atm.maskLayer));
function hideAll() { for (let i = 0; i < folk.n; i++) folk.set(i, { visible: false }); }

// ---------------------------------------------------------------- the sculpted fist (people.js hands are mittens)
// Built in the hand frame at the knuckles (bind axes: -y along the straight fingers, +z toward the thumb, the palm
// toward -s x). Four knuckles, four proximal phalanges folded to the palm, the middle phalanges tucked back up, and a
// thumb wrapped across them. The people.js fingers are curled inside it; the frame is the grip frame with the curl undone.
function fistGeo(s) {
  const parts = [], X = x => x * s;
  const cap = (a, b, r) => { const A = V(...a), Bp = V(...b), L = A.distanceTo(Bp), g = new THREE.CapsuleGeometry(r, L, 4, 10);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), Bp.clone().sub(A).normalize()));
    const m = A.clone().add(Bp).multiplyScalar(0.5); g.translate(m.x, m.y, m.z); parts.push(g); };
  const ball = (p, r) => { const g = new THREE.SphereGeometry(r, 12, 9); g.translate(...p); parts.push(g); };
  const F = [[0.031, 0.0145, 0.004], [0.0105, 0.0152, 0.006], [-0.0105, 0.0145, 0.003], [-0.03, 0.0125, -0.004]];   // z, radius, knuckle lift (index .. little)
  for (const [z, r, lift] of F) {
    ball([X(0.006), -0.004 + lift, z], r * 1.05);                                        // knuckle
    cap([X(0.004), -0.014 + lift * 0.5, z], [X(-0.036), -0.02 + lift * 0.3, z], r * 0.86);  // proximal phalanx, folded to the palm
    cap([X(-0.044), -0.016, z], [X(-0.046), 0.018, z * 0.95], r * 0.8);                   // middle phalanx, tucked back up
  }
  cap([X(0.0), 0.045, -0.002], [X(0.01), 0.006, -0.002], 0.034);                          // back of the hand, fills the knuckle line
  cap([X(-0.012), 0.062, 0.036], [X(-0.03), 0.028, 0.044], 0.0145);                       // thumb, metacarpal
  cap([X(-0.03), 0.028, 0.044], [X(-0.052), 0.006, 0.012], 0.0128);                        // thumb, across the index and middle
  const g = mergeGeometries(parts.map(p => { p.deleteAttribute('uv'); return p; }));
  g.scale(1.14, 1.14, 1.14); return g;
}
const fistMat = new THREE.MeshStandardMaterial({ color: '#1a1612', roughness: 0.75, metalness: 0.0 });
const FISTS = { 1: new THREE.Mesh(fistGeo(1), fistMat), [-1]: new THREE.Mesh(fistGeo(-1), fistMat) };
for (const k in FISTS) { const m = FISTS[k]; m.matrixAutoUpdate = false; m.frustumCulled = false; m.layers.enable(atm.maskLayer); scene.add(m); }
const _rz = new THREE.Matrix4();
function placeFist(id, s, curl, show) {
  const m = FISTS[s]; m.visible = show; if (!show) return;
  _rz.makeRotationZ(s * (FISTON[s] ? 1.75 : curl)); m.matrix.copy(folk.grip(id, s)).multiply(_rz); m.matrixWorldNeedsUpdate = true;
}
// the hard hat's brim sits tipped back on the skull with daylight between them; from below that gap against the sun
// reads as a halo ring (the lab still). A dark ellipsoid on the head frame fills the hat so the silhouette is one shape.
const hatFill = new THREE.Mesh((() => { const g = new THREE.SphereGeometry(1, 20, 12); g.scale(0.125, 0.06, 0.15); g.rotateX(-0.25); g.translate(0, 0.085, 0.0); return g; })(), fistMat);
hatFill.matrixAutoUpdate = false; hatFill.frustumCulled = false; hatFill.layers.enable(atm.maskLayer); scene.add(hatFill);
// every titan hand pose writes its curl here so the fist mesh can undo it (fingers bone z = -s * curl)
const CURL = { 1: 0, [-1]: 0 };
function setCurl(P, A, s, c) { const fg = A.ARM(s)[3]; P[fg * 3 + 2] = -s * c; P[fg * 3] = 0; CURL[s] = c; }
// Raised arms go through gesture.js IK so the gate's gesture audit can hold them (no straight forward arm, forearms
// vertical on screen): the titan climbs pull-up style. Each arm blends between two body-frame glyphs, re-set every frame:
//   PULL   elbow out at shoulder height, forearm vertical, hand at the brow on the steel (the bottom of a pull-up)
//   REACH  the arm straight up to the next beam (vertical, so not a salute)
//   OVER   the payoff fist above the crown, elbow bent ~30 degrees (gesture.js OVERHEAD)
const nz = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const mixD = (a, b, k) => nz(a.map((x, i) => x + (b[i] - x) * k));
// z (forward) kept at or behind the head: the audit reads a hand ahead of the head on a tilted forearm as a salute
const G_PULL = { ua: [0.9, 0.2, -0.04], fa: [-0.08, 1, -0.04] }, G_REACH = { ua: [0.06, 1, -0.04], fa: [0.03, 1, -0.02] }, G_OVER = { ua: [0.22, 0.97, -0.2], fa: [-0.15, 0.98, -0.12] };
for (const k of ['GIANT_L', 'GIANT_R', 'HERO_L']) GESTURES[k] = { ua: [0, 1, 0], fa: [0, 1, 0], fist: false };
function armG(key, a, b, k, fist) { const G = GESTURES[key]; G.ua = mixD(a.ua, b.ua, clamp(k)); G.fa = mixD(a.fa, b.fa, clamp(k)); G.fist = fist; }
const FISTON = { 1: false, [-1]: false };

// ---------------------------------------------------------------- the heave clock and the climb
function heaveEnv(beat) { let e = 0; for (const h of HEAVES) { const u = beat - h; if (u > -0.3 && u < 1.5) e = Math.max(e, u < 0 ? (1 + u / 0.3) * 0.4 : Math.exp(-u * 3)); } return e; }
const CLIMB_H = HEAVES.filter(h => h <= 41);
function feetY(beat) {
  if (beat < 2) return 0;
  if (beat >= 46) return TOP;
  const b = Math.min(beat, 44);
  let pulses = 0; for (const h of CLIMB_H) pulses += ease.outCubic(clamp((b - h) / 0.55));
  let y = 212 * (0.3 * (b - 2) / 42 + 0.7 * pulses / CLIMB_H.length);
  if (beat > 44) y = lerp(y, 216, ease.inOutCubic((beat - 44) / 2));
  return y;
}
// per arm: beats since it last closed on steel (g) and how far it is reaching for its next grip (r)
function armClock(beat, s) {
  let last = -9, next = 99;
  CLIMB_H.forEach((h, i) => { const side = i % 2 ? 1 : -1; if (side !== s) return; if (h <= beat) last = h; else if (next === 99) next = h; });
  return { g: beat - last, r: smooth(next - Math.min(1.6, (next - last) * 0.5), next - 0.08, beat) };
}
const POSE = {
  climb(P, st, A) {
    const { B: Bn, ARM, LEG } = A, beat = st.beat;
    for (const s of [1, -1]) {
      const [ua, fa, hn] = ARM(s), [th, sh, ft] = LEG(s), { g, r } = armClock(beat, s);
      // grip age: high and straight -> pulled (elbow bent, body rises past it) -> low at the chest, pushing
      const k1 = ease.outCubic(clamp(g / 0.55)), k2 = smooth(0.6, 2.2, g);
      let uax = lerp(lerp(-2.95, -2.2, k1), -1.85, k2), fax = lerp(lerp(-0.15, -1.45, k1), -1.15, k2);
      uax = lerp(uax, -3.05, r); fax = lerp(fax, -0.08, r);
      P[ua * 3] = uax; P[ua * 3 + 2] = s * lerp(0.32, 0.16, r); P[ua * 3 + 1] = -s * 0.1;
      P[fa * 3] = fax; P[hn * 3] = lerp(0.25, -0.15, r);
      setCurl(P, A, s, lerp(1.75, 0.25, r));
      // legs: the leg on the reaching side steps high; the other drives
      const step = clamp(r * 1.2 + (1 - k2) * 0.5 * (1 - k1));
      P[th * 3] = -lerp(0.25, 1.35, step); P[th * 3 + 2] = s * 0.14; P[sh * 3] = lerp(0.35, 1.9, step); P[ft * 3] = -P[th * 3] - P[sh * 3] + 0.25;
    }
    const lead = armClock(beat, 1).r > armClock(beat, -1).r ? 1 : -1, hv = st.hv;
    P[Bn.spine * 3] = 0.18 + 0.08 * hv; P[Bn.chest * 3] = 0.1 + 0.12 * hv; P[Bn.head * 3] = -0.55; P[Bn.head * 3 + 1] = 0.2 * lead;
    P[Bn.hips * 3 + 2] = 0.07 * lead; P[Bn.chest * 3 + 2] = -0.09 * lead; P[Bn.chest * 3 + 1] = 0.08 * lead;
  },
  crouch(P, st, A) {   // hauled onto the crown: one knee down, one hand planted; rises with st.rise
    const { B: Bn, ARM, LEG } = A, r = st.rise;
    for (const s of [1, -1]) { const [th, sh, ft] = LEG(s), [ua, fa] = ARM(s);
      P[th * 3] = -lerp(s > 0 ? 1.7 : 0.6, 0.05, r); P[sh * 3] = lerp(s > 0 ? 2.3 : 1.9, 0.08, r); P[ft * 3] = -P[th * 3] - P[sh * 3]; P[th * 3 + 2] = s * 0.12;
      P[ua * 3] = lerp(s > 0 ? -0.9 : 0.2, 0.05, r); P[fa * 3] = lerp(-0.4, -0.3, r); P[ua * 3 + 2] = s * 0.15; setCurl(P, A, s, 1.75); }
    P[Bn.spine * 3] = lerp(0.5, 0.02, r); P[Bn.chest * 3] = lerp(0.4, -0.05, r); P[Bn.head * 3] = lerp(-0.5, -0.1, r);
  },
  raise(P, st, A) {    // on the crown: the right arm goes up (st.aim 0 hanging .. 1 straight overhead); st.grip opens/closes the hand
    const { B: Bn, ARM, LEG } = A, a = st.aim;
    const [ua, fa, hn] = ARM(-1);
    P[ua * 3] = lerp(-0.2, -2.95, a); P[ua * 3 + 1] = 0.12 * a; P[ua * 3 + 2] = lerp(-0.12, 0.22, a); P[fa * 3] = lerp(-0.4, -0.12, a); P[hn * 3] = lerp(0.1, 0.12, a);
    setCurl(P, A, -1, lerp(0.15, 1.75, st.grip));
    const [ua2, fa2] = ARM(1);
    P[ua2 * 3] = 0.12 - 0.15 * a; P[ua2 * 3 + 2] = 0.2; P[fa2 * 3] = -0.35 - 0.3 * st.strain; setCurl(P, A, 1, 1.75);
    for (const s of [1, -1]) { const [th, sh, ft] = LEG(s); P[th * 3] = s > 0 ? -0.32 : 0.22; P[sh * 3] = s > 0 ? 0.4 : 0.14; P[ft * 3] = -P[th * 3] - P[sh * 3]; P[th * 3 + 2] = s * 0.12; }
    P[Bn.spine * 3] = 0.04 - 0.12 * a - 0.08 * st.strain; P[Bn.chest * 3] = 0.06 - 0.2 * a; P[Bn.head * 3] = -0.15 - 0.4 * a; P[Bn.chest * 3 + 1] = -0.18 * a;
    P[Bn.chest * 3 + 2] = 0.1 * a; P[Bn.hips * 3 + 2] = -0.05 * a;
  },
  haul(P, st, A) {     // a crew member on a hoist line: braced, leaning back, hands forward on the line
    const { B: Bn, ARM, LEG } = A, hv = st.hv, k = st.k || 0;
    for (const s of [1, -1]) { const [ua, fa, , fg] = ARM(s), [th, sh, ft] = LEG(s);
      P[ua * 3] = -0.5 - 0.1 * hv + (s > 0 ? 0.1 : 0) * (1 - hv); P[ua * 3 + 2] = s * 0.1; P[fa * 3] = -0.35; P[fg * 3 + 2] = -s * 1.6;   // hands at the chest on the line: wrists stay under the shoulders
      P[th * 3] = s > 0 ? -0.55 - 0.15 * hv : 0.25 + 0.1 * hv; P[sh * 3] = s > 0 ? 0.6 : 0.25 + 0.15 * hv; P[ft * 3] = -P[th * 3] - P[sh * 3]; }
    P[Bn.spine * 3] = -0.15 - 0.12 * hv; P[Bn.chest * 3] = -0.08 - 0.08 * hv; P[Bn.head * 3] = 0.1 + 0.15 * hv - 0.3 * k; P[Bn.head * 3 + 1] = 0.15 * Math.sin(st.t * 0.8);
  },
  tie(P, st, A) {      // the rigger clips his lanyard to the beam overhead (left arm up), looks up
    const { B: Bn, ARM } = A, u = st.u;
    const [ua, fa, , fg] = ARM(1); P[ua * 3] = -0.1; P[ua * 3 + 2] = 0.25; P[fa * 3] = -1.5; P[fg * 3 + 2] = -1.2;   // the raise itself is the HERO_L gesture
    const [ua2, fa2] = ARM(-1); P[ua2 * 3] = -0.4; P[fa2 * 3] = -1.0;
    P[Bn.head * 3] = lerp(-0.1, -0.55, u); P[Bn.chest * 3] = -0.05;
  },
};

// hoist lines from each crew's hands to the snatch block at the column, then up
const LINE_N = 60;
const lineMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 5), new THREE.MeshBasicMaterial({ color: 0x080606 }), LINE_N);
lineMesh.frustumCulled = false; scene.add(lineMesh);
let lineK = 0;
function cable(a, b, r = 0.03) {
  if (lineK >= LINE_N) return;
  const d = b.clone().sub(a), L = d.length(), m = new THREE.Matrix4();
  m.compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().normalize()), V(r, L, r));
  lineMesh.setMatrixAt(lineK++, m);
}
function cablesEnd() { for (let k = lineK; k < LINE_N; k++) lineMesh.setMatrixAt(k, new THREE.Matrix4().makeScale(0, 0, 0)); lineMesh.instanceMatrix.needsUpdate = true; }

// the white topping-out beam: signed, a flag and an evergreen, the ACP emblem (four stripes) stencilled red on the web
const beamTex = (() => {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#e9e4da'; g.fillRect(0, 0, 1024, 128);
  const r = rng(4); g.strokeStyle = '#2a2a2a'; g.lineWidth = 3; g.lineCap = 'round';
  for (let k = 0; k < 26; k++) { const x = 40 + r() * 900, y = 20 + r() * 90; if (Math.abs(x - 512) < 90) continue; g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 6; s++) g.lineTo(x + s * 8 + r() * 6, y + (r() - 0.5) * 14); g.stroke(); }
  acpEmblem(g, 512, 64, 104, { color: '#b81414' });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.NoColorSpace; return tex;
})();
const topBeam = new THREE.Group();
{
  const web = new THREE.Mesh(new THREE.BoxGeometry(12, 0.8, 0.25), new THREE.MeshStandardMaterial({ map: beamTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: beamTex, emissiveIntensity: 0.25 }));
  const fl = new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.5, emissive: 0x302c28 });
  const f1 = new THREE.Mesh(new THREE.BoxGeometry(12, 0.08, 0.6), fl); f1.position.y = 0.4; const f2 = f1.clone(); f2.position.y = -0.4;
  const tree = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 7), new THREE.MeshStandardMaterial({ color: 0x0c1a0c, roughness: 0.9 })); tree.position.set(1.5, 1.3, 0);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2), fl); pole.position.set(-1.5, 1.5, 0);
  const fc = document.createElement('canvas'); fc.width = 96; fc.height = 64; const fg = fc.getContext('2d');
  for (let i = 0; i < 13; i++) { fg.fillStyle = i % 2 ? '#e8e4da' : '#b01818'; fg.fillRect(0, i * 64 / 13, 96, 64 / 13 + 1); } fg.fillStyle = '#1c2a5a'; fg.fillRect(0, 0, 40, 34);
  const ftex = new THREE.CanvasTexture(fc); ftex.colorSpace = THREE.NoColorSpace;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), new THREE.MeshStandardMaterial({ map: ftex, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: ftex, emissiveIntensity: 0.2 })); flag.position.set(-0.9, 2.2, 0);
  topBeam.add(web, f1, f2, tree, pole, flag); scene.add(topBeam);
}

// sparks (the beam seats, the grips): simple ballistic points, additive, HDR so the atmos glow catches them
const SPK = 420;
const sparkGeo = new THREE.BufferGeometry();
{ const a = new Float32Array(SPK * 3), s = new Float32Array(SPK); const r = rng(5); for (let i = 0; i < SPK; i++) { a.set([r() - 0.5, r(), r() - 0.5], i * 3); s[i] = r(); }
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(a, 3)); sparkGeo.setAttribute('aS', new THREE.BufferAttribute(s, 1)); }
const sparkMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uO: { value: V() }, uAge: { value: 9 }, uScale: { value: 1 }, uPx: { value: RH / PK } },
  vertexShader: `attribute float aS; uniform vec3 uO; uniform float uAge, uScale, uPx; varying float vA;
    void main(){ vec3 v = (position - vec3(0.0,0.35,0.0)) * vec3(12.0, 8.0, 12.0) * (0.4 + aS);
      vec3 p = uO + (v * uAge - vec3(0.0, 9.8, 0.0) * uAge * uAge) * uScale;
      vA = clamp(1.0 - uAge / (0.5 + aS*1.1), 0.0, 1.0);
      vec4 mv = viewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(uPx * 0.05 * uScale / -mv.z, 1.0, 5.0)${PXM}; }`,
  fragmentShader: `varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)) * vA; gl_FragColor = vec4(vec3(9.0,4.0,1.2)*a, a); }` });
const sparks = new THREE.Points(sparkGeo, sparkMat); sparks.frustumCulled = false; scene.add(sparks);

// headlamps: the night crews on every lit deck, points of light along the deck edges in the wides
const HL = [];
{ const r = rng(33);
  for (let d = 2; d <= NDECK; d++) for (let f = 0; f < 4; f++) { const n = 1 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) { const a = -15 + r() * 30, e = HALF - 1.2 - r() * 2.5;
      const p = f === 0 ? [a, e] : f === 1 ? [a, -e] : f === 2 ? [e, a] : [-e, a]; HL.push({ d, x: p[0], z: p[1], ph: r() }); } } }
const hlMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 7, 5.5) }), HL.length);
hlMesh.frustumCulled = false; scene.add(hlMesh);
function headlamps(S, beat) {
  const m = new THREE.Matrix4(), z = new THREE.Matrix4().makeScale(0, 0, 0);
  HL.forEach((h, i) => { const y = h.d * DECK; if (y > S.litY - 4 || Math.hypot(h.x - camera.position.x, y + 1.7 - camera.position.y, h.z - camera.position.z) < 12) { hlMesh.setMatrixAt(i, z); return; }
    m.makeTranslation(h.x, y + 1.72 - heaveEnv(beat - h.ph * 0.3) * 0.1, h.z); hlMesh.setMatrixAt(i, m); });
  hlMesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- lights for the people (never a front key on the titan)
const hemi = new THREE.HemisphereLight(0x2a3a70, 0x2a1206, 0.35); scene.add(hemi);
const backL = new THREE.DirectionalLight(0xffc890, 0); scene.add(backL); scene.add(backL.target);   // deck floods / the sun, from behind
const fillL = new THREE.PointLight(0xffa060, 0, 30, 1.5); scene.add(fillL);

// ---------------------------------------------------------------- palette by time of the piece
const PAL = {   // sky colours (sRGB hex -> linear; atmos applies ACES + the grade)
  blue: { zen: '#15285e', mid: '#2e4a96', hor: '#5a6cb0', glow: '#c05a30', sun: '#ff4a1a', haze: '#1e2a58' },
  late: { zen: '#141640', mid: '#553070', hor: '#a84a44', glow: '#ff5a24', sun: '#ff4a1a', haze: '#34183a' },
  red: { zen: '#0a0204', mid: '#2a0608', hor: '#7a1610', glow: '#ff3a12', sun: '#ff3a12', haze: '#160304' },
};
function palette(u) {   // 0 blue hour .. 1 late .. 2 red sun
  const a = u < 1 ? PAL.blue : PAL.late, b = u < 1 ? PAL.late : PAL.red, k = u < 1 ? u : u - 1, o = {};
  for (const key in a) o[key] = new THREE.Color(a[key]).lerp(new THREE.Color(b[key]), clamp(k));
  return o;
}

// ---------------------------------------------------------------- per-beat state
const GZ = HALF + 5.5;   // the titan's root off the south face
function state(beat) {
  const S = { beat };
  S.feet = feetY(beat); S.hv = heaveEnv(beat);
  S.litY = beat < 2 ? 0 : beat >= 46 ? TOP + 10 : S.feet + 90 + 6 * S.hv;
  S.wave = beat < 2 ? 0 : beat < 16 ? 40 + 12 * (beat - 2) : beat < 32 ? lerp(210, 800, (beat - 16) / 16) : beat < 46 ? lerp(800, 4200, ease.inCubic((beat - 32) / 14)) : 6000;
  S.pal = beat < 16 ? lerp(0, 0.25, beat / 16) : beat < 32 ? lerp(0.25, 0.7, (beat - 16) / 16) : beat < 46 ? lerp(0.7, 1.35, (beat - 32) / 14) : beat < 48 ? lerp(1.35, 1.8, (beat - 46) / 2) : 2;
  S.sunI = beat < 47 ? 0 : smooth(47, 48.5, beat);
  S.sunEl = beat < 48 ? -0.02 : beat < 56 ? lerp(-0.004, 0.012, (beat - 48) / 8) : 0.012;
  return S;
}

// ---------------------------------------------------------------- shots
// { pos, tgt, fov, roll } or { fn: A => ({...}) } for shots framed on the titan's hands/head (A = anchors), and
// sun: 'fist' (the disc sits behind the right fist), 'high', 'tele' (the disc behind the titan, level), 'low'.
const sh = (beat, a, b) => clamp((beat - a) / (b - a));
function handShot(s, side, roll, u = 0) {   // the fist closing on the face beam, from inside the tower below it, sky beyond
  return { fn: A => { const h = A.hand[s]; return { pos: h.clone().add(V(side * 13, 6 + 2 * u, 40)), tgt: h.clone().add(V(0, -2.5, 0)), fov: 28, roll }; }, hands: 1 };
}
function crewShot(deck, roll, back = 0) {  // a crew hauling, camera low on the deck behind them, the sky and the lit decks beyond
  const cr = CREWS.find(c => c.deck === deck), cx = cr.x0 + cr.dir * 2.5, y = deck * DECK;
  return { pos: V(cx - cr.dir * (6.5 + back), y + 0.5, HALF - 5.5), tgt: V(cx + cr.dir * 6, y + 2.2, HALF + 3), fov: 58, roll, crew: deck };
}
// the lab still's Rodchenko camera on the crown: under the titan's hip, pitched up, rolled, the fist into the disc
function payCam(k) {   // k = 1: the lab still, full figure, fist in the disc (frame 0 and the loop); k = 0: under the fist
  return A => { const f = A.hand[-1], hip = A.hip;
    const wide = hip.clone().add(V(-1.15 * GS, -0.92 * GS, 0.95 * GS)), close = f.clone().add(V(-0.38 * GS, -0.95 * GS, 0.55 * GS));
    const tw = f.clone().lerp(A.head, 0.55).add(V(0, 0.1 * GS, 0)), tc = f.clone().add(V(0, 0.08 * GS, 0));
    return { pos: close.lerp(wide, k), tgt: tc.lerp(tw, k), fov: lerp(46, 58, k), roll: lerp(-0.18, -0.26, k) }; };
}
function rodchenko(u) {
  return A => ({ pos: A.hip.clone().add(V(-0.9 * GS, -1.0 * GS, 0.35 * GS)), tgt: A.head.clone().add(V(0.1 * GS, 0.35 * GS, 0)), fov: 66, roll: 0.24 - 0.08 * u });
}
function shotAt(beat, S) {
  const F = S.feet, top = F + 2.3 * GS, mid = F + 1.3 * GS;
  // ---- b0-0.5: frame 0 is the payoff image (the fist on the red sun)
  if (beat < 0.5) return { pay: 1, fn: payCam(1), sun: 'fist', aim: 1, grip: 1 };
  // ---- b0.5-2: the plunge, the tower from the street at blue hour
  if (beat < 2) { const u = sh(beat, 0.5, 2); return { pos: V(-20, 2, 112 - 6 * u), tgt: V(0, 95 + 20 * u, 0), fov: 70, roll: -0.05 }; }
  // ---- HAUL
  if (beat < 4) { const u = sh(beat, 2, 4); return { pos: V(-95 + 8 * u, 4, 108), tgt: V(0, F + 50, GZ), fov: 58 - 3 * u, roll: -0.06 }; }
  if (beat < 6) { const u = sh(beat, 4, 6); return { pos: V(34, F - 18, GZ + 30), tgt: V(0, F + 60, GZ), fov: 64, roll: 0.25 - 0.05 * u }; }
  if (beat < 7) return crewShot(24, 0.06);
  if (beat < 10) return handShot(-1, -1, -0.12, sh(beat, 7, 10));
  if (beat < 12) { const u = sh(beat, 10, 12); return { pos: V(8.5, 16 * DECK + 0.9, HALF - 7), tgt: V(16.5, 16 * DECK + 2.4 + 0.3 * u, HALF + 1.5), fov: 44 - 3 * u, roll: -0.04, hero: 1 }; }
  if (beat < 13) return { pos: V(95, F + 20, GZ + 70), tgt: V(0, F + 50, GZ), fov: 44, roll: 0.08 };
  if (beat < 16) { const u = ease.inOutCubic(sh(beat, 13, 16)); const a = lerp(0.9, -0.3, u); return { pos: V(Math.sin(a) * 150, F + 5 + 20 * u, GZ + Math.cos(a) * 150), tgt: V(0, F + 45 + 10 * u, GZ - 4), fov: 46, roll: 0.06 - 0.12 * u }; }
  // ---- EVERY DECK
  if (beat < 17) { const u = sh(beat, 16, 17); return { pos: V(-230 + 20 * u, mid - 20, 300), tgt: V(0, mid, 0), fov: 34, roll: 0 }; }
  if (beat < 18) return crewShot(12, 0.05);
  if (beat < 19) return crewShot(7, 0.06);
  if (beat < 20) return { pos: V(-45, F + 5, GZ + 75), tgt: V(0, F + 45, GZ), fov: 58, roll: -0.12 };
  if (beat < 22) { const u = sh(beat, 20, 22); return { pos: V(-420 + 30 * u, F + 30, GZ + 60), tgt: V(0, F + 40 + 6 * u, GZ), fov: 22, roll: 0 }; }
  if (beat < 24) { const u = sh(beat, 22, 24); return { pos: V(55, F + 8, GZ + 70), tgt: V(0, F + 50, GZ), fov: 56, roll: 0.14 - 0.05 * u }; }
  if (beat < 26) { const u = sh(beat, 24, 26); return { fn: () => { const bp = topBeam.position; return { pos: bp.clone().add(V(-14 + 3 * u, -11, 17)), tgt: bp.clone().add(V(0, 6 + 4 * u, 0)), fov: 46, roll: 0.08 }; } }; }
  if (beat < 27) return crewShot(12, -0.05, 1.5);
  if (beat < 28) return handShot(-1, 1, -0.08, sh(beat, 27, 28));
  if (beat < 30) { const u = sh(beat, 28, 30); return { pos: V(20, top + 40 + 10 * u, GZ + 10), tgt: V(0, 0, 0), fov: 70 - 10 * u, roll: 0.1 + 0.3 * u, down: 1 }; }
  if (beat < 32) { const u = ease.inOutCubic(sh(beat, 30, 32)); const a = lerp(-0.9, 0.7, u); return { pos: V(Math.sin(a) * 110, F - 25 + 10 * u, GZ + Math.cos(a) * 110), tgt: V(0, mid + 20 * u, GZ - 6), fov: 50, roll: 0.1 - 0.2 * u }; }
  // ---- THE CITY
  if (beat < 33) { const u = sh(beat, 32, 33); return { pos: V(-520 + 40 * u, 60, 560), tgt: V(0, mid - 20, 0), fov: 32, roll: 0, roofs: 1 }; }
  if (beat < 34) return { pos: V(70, F + 12, GZ + 90), tgt: V(0, F + 46, GZ), fov: 50, roll: 0.14 };
  if (beat < 35) return crewShot(28, 0.05);
  if (beat < 36) return { pos: V(-50, F + 10, GZ + 80), tgt: V(0, F + 48, GZ), fov: 54, roll: -0.1 };
  if (beat < 38) { const u = sh(beat, 36, 38); return { pos: V(30, top + 220 + 80 * u, GZ + 60), tgt: V(-60, 0, -40), fov: 62, roll: 0.2, down: 1 }; }
  if (beat < 39) { const u = sh(beat, 38, 39); return { pos: V(-160, TOP + 30, 210), tgt: V(-10, TOP + 30 + 6 * u, 10), fov: 38, roll: 0.03 }; }
  if (beat < 40) return crewShot(68, -0.04);
  if (beat < 41) return { pos: V(-65, F + 15, GZ + 95), tgt: V(0, F + 48, GZ), fov: 48, roll: -0.12 };
  if (beat < 42) return { pos: V(40, F + 12, GZ + 85), tgt: V(0, F + 50, GZ), fov: 52, roll: 0.12 };
  if (beat < 44) { const u = sh(beat, 42, 44); return { pos: V(-900 + 60 * u, 120, 900), tgt: V(0, TOP - 30, 0), fov: 16 - 2 * u, roll: 0 }; }
  // ---- TOPPING OUT
  if (beat < 46) return { fn: () => { const bp = topBeam.position; return { pos: bp.clone().add(V(-9, -5, 16)), tgt: bp.clone().add(V(0, -0.5, 0)), fov: 44, roll: 0.05 }; } };
  if (beat < 47) return { pos: V(-46, TOP + 4, 70), tgt: V(0, TOP + 34, 0), fov: 60, roll: 0.06 };
  if (beat < 48) { const u = sh(beat, 47, 48); return { pos: V(-150, TOP - 10, 60), tgt: V(0, TOP + 38 + 8 * u, 0), fov: 40, roll: 0 }; }
  // ---- THE SUN
  if (beat < 50) { const u = sh(beat, 48, 50); return { pay: 1, fn: rodchenko(u), sun: 'high', aim: lerp(0.35, 0.85, ease.inOutCubic(u)), grip: 0 }; }
  if (beat < 52) { const u = sh(beat, 50, 52); return { pay: 1, tele: { D: 5200 - 400 * u, fov: 2.8 }, sun: 'tele', aim: 0.1 + 0.2 * u, grip: 1 }; }
  if (beat < 54) { const u = sh(beat, 52, 54); const rc = ROOFCREWS[0]; return { pos: V(rc.x - 9 - 2 * u, rc.y + 0.7, rc.z + 2.5), tgt: V(0, TOP + 20, 0), fov: 40, roll: -0.04, pay: 1, sun: 'tower', aim: 0.75, grip: 1, roofs: 1 }; }
  if (beat < 56) { const u = sh(beat, 54, 56); return { pay: 1, fn: payCam(0.6 + 0.4 * u), sun: 'fist', aim: lerp(0.8, 0.95, u), grip: 0, open: 1 }; }
  // ---- PAYOFF: the fist closes on the sun and hauls it up
  if (beat < 58) { const u = sh(beat, 56, 58); return { pay: 1, fn: payCam(1 - 0.7 * ease.outCubic(u)), sun: 'fist', aim: 1, grip: smooth(56, 56.25, beat), haul: ease.outCubic(u) }; }
  { const u = sh(beat, 58, 60); return { pay: 1, fn: payCam(0.3 + 0.7 * ease.inOutCubic(u)), sun: 'fist', aim: 1, grip: 1, haul: 1 }; }
}

// ---------------------------------------------------------------- the world at a beat
function world(t, beat) {
  const S = state(beat), shot = shotAt(beat, S), isPay = !!shot.pay;
  if (isPay) { S.litY = TOP + 10; S.wave = 6000; S.pal = 2; S.sunI = 1; }
  // ---- the titan
  hideAll(); lineK = 0;
  if (shot.noGiant) {}
  else if (isPay || beat >= 46) {
    if (beat >= 46 && beat < 48 && !isPay) folk.set(GIANT, { visible: true, x: 0, y: TOP, z: 0, heading: Math.PI / 2, act: 'stand', t: 0, pose: POSE.crouch, rise: beat < 47 ? 0 : ease.inOutCubic(beat - 47), beat });
    else folk.set(GIANT, { visible: true, x: -0.1 * GS, y: TOP, z: 0.1 * GS, heading: Math.PI / 2, act: 'stand', t: 0, pose: POSE.raise, aim: shot.aim ?? 0.3, grip: shot.grip ?? 1, strain: shot.haul ?? 0, beat });
  } else if (beat >= 0.5) {
    folk.set(GIANT, { visible: true, x: 0, y: S.feet, z: GZ, heading: Math.PI, act: 'stand', t: 0, pose: POSE.climb, hv: S.hv, beat });
  }
  // ---- the titan's arms (gesture IK, see armG)
  FISTON[1] = FISTON[-1] = false;
  const gsT = folk.get(GIANT);
  if (gsT.visible && gsT.pose === POSE.climb) {
    for (const sd of [1, -1]) { const { g, r } = armClock(beat, sd), k1 = ease.outCubic(clamp(g / 0.55)), up = Math.max(r, 1 - k1), fist = r < 0.2;
      armG(sd > 0 ? 'GIANT_L' : 'GIANT_R', G_PULL, G_REACH, up, fist); FISTON[sd] = fist; }
    gsT.gesture = [{ name: 'GIANT_L', side: 1 }, { name: 'GIANT_R', side: -1 }];
  } else if (gsT.visible && gsT.pose === POSE.raise) {
    const a = gsT.aim, grip = gsT.grip ?? 1, open = shot.open || grip < 0.5;
    if (open) armG('GIANT_R', G_PULL, G_REACH, 1, false);
    else if (a < 0.35) armG('GIANT_R', G_PULL, G_PULL, 0, true); else armG('GIANT_R', G_PULL, G_OVER, (a - 0.35) / 0.65, true);
    FISTON[-1] = !open; gsT.gesture = [{ name: 'GIANT_R', side: -1, w: open ? 1 : clamp(a / 0.35) }];
  } else gsT.gesture = null;
  // ---- crews: every lit deck on the south face hauls on the heave
  for (const [ci, cr] of CREWS.entries()) {
    const y = cr.deck * DECK;
    if (!shot.crewsAll && (y > S.litY + 2 || isPay) && shot.crew !== cr.deck) continue;
    if (shot.crew && shot.crew !== cr.deck) continue;   // a crew close-up shows only that crew: nobody's hands land on the titan behind them (gate CROTCH)
    const lock = clamp(beat / 56), lag = (1 - lock) * 0.35 * ((ci * 0.37) % 1), hv = heaveEnv(beat - lag);
    cr.ids.forEach((id, k) => folk.set(id, { visible: true, x: cr.x0 + cr.dir * k * 1.2, y, z: HALF - 2.2 - (k % 2) * 0.5, heading: cr.dir > 0 ? Math.PI / 2 : -Math.PI / 2, act: 'stand', t: t + k, pose: POSE.haul, hv, k: k === 0 ? 1 : 0 }));
  }
  if (shot.hero || (beat >= 8 && beat < 14)) { const u = shot.hero ? smooth(10.2, 11.3, beat) : 0; armG('HERO_L', G_PULL, G_OVER, 1, false);
    folk.set(HERO, { visible: true, x: 14.5, y: 16 * DECK, z: HALF - 1.2, heading: 1.9, act: 'stand', t, pose: POSE.tie, u, gesture: u > 0.5 ? [{ name: 'HERO_L', side: 1 }] : null }); }   // snapped, never half-raised (a half blend reads forward)
  if (shot.roofs || shot.crewsAll) for (const rc of ROOFCREWS) rc.ids.forEach((id, k) => folk.set(id, { visible: true, x: rc.x + k * 1.3, y: rc.y, z: rc.z, heading: Math.PI / 2, act: 'stand', t: t + k, pose: POSE.haul, hv: heaveEnv(beat) }));

  // ---- the white beam: swinging on the crown crane's hook, seated at b46
  topBeam.visible = beat >= 24 && !(isPay && beat < 1);
  const cu = CR_TOP.userData, hookTip = V(cu.jib * 0.5, cu.mastH - 1, 0).applyEuler(new THREE.Euler(0, CR_TOP.rotation.y, 0)).add(CR_TOP.position);
  if (beat < 46.3 && !isPay) {
    const sw = Math.sin(t * 1.3) * 0.25, drop = lerp(60, 14, smooth(24, 44, beat));
    const hung = hookTip.clone().add(V(0, -drop - 6, 0)), seat = V(0, TOP + 0.6, HALF);
    topBeam.position.copy(hung.lerp(seat, ease.inOutCubic(smooth(44, 46.2, beat)))); topBeam.rotation.set(0, 0.4 * (1 - smooth(44, 46.2, beat)) + sw * 0.5 * (1 - smooth(45, 46.2, beat)), sw * 0.08);
  } else { topBeam.position.set(0, TOP + 0.6, HALF); topBeam.rotation.set(0, 0, 0); }
  { const a = hookTip, b = topBeam.position.clone().add(V(0, 0.5, 0)), d = b.clone().sub(a); hookLine.visible = topBeam.visible && beat < 46.6 && !isPay;
    hookLine.position.copy(a.clone().add(b).multiplyScalar(0.5)); hookLine.quaternion.setFromUnitVectors(V(0, 1, 0), d.clone().normalize()); hookLine.scale.set(1, d.length(), 1); }

  // ---- camera: hand/head-framed shots need the titan posed first
  camera.up.set(0, 1, 0); camera.position.set(0, 100, 300); camera.lookAt(0, 100, 0); camera.fov = 50; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  folk.update(camera);
  const gs = folk.get(GIANT);
  const A = { hand: { 1: folk.gripPos(GIANT, 1, V()), [-1]: folk.gripPos(GIANT, -1, V()) }, head: V().setFromMatrixPosition(folk.head(GIANT) || new THREE.Matrix4()), hip: V(gs.x, gs.y + 1.0 * GS, gs.z) };
  let c = shot;
  if (shot.fn) c = { ...shot, ...shot.fn(A) };
  let sunDir = V(1, S.sunEl, 0.08).normalize();
  if (shot.tele) {   // the long lens: the titan tiny on the crown, the disc behind him, level
    const tgt = A.head.clone().lerp(A.hip, 0.3), dir = V(-1, 0.0, -0.18).normalize();
    c = { ...shot, pos: tgt.clone().addScaledVector(dir, shot.tele.D).setY(tgt.y - 30), tgt, fov: shot.tele.fov, roll: 0 };
  }
  camera.position.copy(c.pos); camera.up.set(0, 1, 0); if (c.down) camera.up.set(0, 0, -1);
  camera.lookAt(c.tgt); camera.rotateZ(c.roll || 0);
  camera.fov = c.fov; camera.near = c.fov < 10 ? 50 : 0.5; camera.far = 30000; camera.updateProjectionMatrix();
  const kick = B.env('kick', t, 9), imp = B.env('impact', t, 5);
  if (!shot.tele) { const k = 0.004 * (kick + 2 * imp) * (c.fov / 50); camera.rotateX(Math.sin(t * 91) * k); camera.rotateY(Math.cos(t * 77) * k); }
  camera.updateMatrixWorld();
  sky.position.copy(camera.position);   // the dome rides with the camera: no parallax on the disc in the long-lens shots
  folk.update(camera);
  A.hand[1] = folk.gripPos(GIANT, 1, V()); A.hand[-1] = folk.gripPos(GIANT, -1, V());
  // ---- the sun follows the composition in the sun shots
  let sunR = 0.03;
  const upS = V(0, 1, 0).applyQuaternion(camera.quaternion);
  if (shot.sun === 'fist') {
    const v = A.hand[-1].clone().sub(camera.position).normalize(); sunR = 0.2;
    sunDir = v.clone().addScaledVector(upS, sunR * (shot.open ? 1.2 : 0.3)).normalize();
  } else if (shot.sun === 'high') { sunR = 0.16; sunDir = A.head.clone().sub(camera.position).normalize().addScaledVector(upS, 0.05).addScaledVector(V(1, 0, 0), 0.12).normalize(); }
  else if (shot.sun === 'tele') { sunR = 0.0085; sunDir = A.head.clone().lerp(A.hip, 0.55).sub(camera.position).normalize(); }
  else if (shot.sun === 'tower') { sunR = 0.05; sunDir = V(0, TOP + 45, 0).sub(camera.position).normalize().addScaledVector(upS, 0.02).normalize(); }
  else if (shot.sun === 'frame') { sunR = 0.09; sunDir = c.tgt.clone().sub(camera.position).normalize().addScaledVector(upS, 0.12).normalize(); }
  // ---- fists: closed fists replace the mitten when the curl is high
  for (const s of [1, -1]) placeFist(GIANT, s, CURL[s], gs.visible && (FISTON[s] || CURL[s] > 1.2) && !(gs.gesture && gs.gesture.some(x => x.side === s) && !FISTON[s]));
  hatFill.visible = gs.visible; if (gs.visible) { hatFill.matrix.copy(folk.head(GIANT)); hatFill.matrixWorldNeedsUpdate = true; }
  // ---- lines: each visible crew's line from the lead hand to the snatch block, then up
  for (const cr of CREWS) {
    if (!folk.get(cr.ids[0]).visible) continue;
    const gp = folk.gripPos(cr.ids[cr.ids.length - 1], 1, V()), g0 = folk.gripPos(cr.ids[0], 1, V());
    const block = V(cr.dir > 0 ? 17.2 : -17.2, cr.deck * DECK + 1.1, HALF - 2.4);
    cable(gp, block, 0.035); cable(g0, gp, 0.035); cable(block, V(block.x, cr.deck * DECK + 60, block.z + 1.5), 0.03);
  }
  cablesEnd();
  // ---- sparks
  const seat = 46.2;
  if (beat >= seat && beat < seat + 3 && !isPay) { sparkMat.uniforms.uO.value.set(0, TOP + 0.2, HALF); sparkMat.uniforms.uAge.value = (beat - seat) * B.spb; sparkMat.uniforms.uScale.value = 1.3; sparks.visible = true; }
  else if (!isPay && beat > 2 && HEAVES.some(h => beat >= h && beat < h + 1.3)) { const h = HEAVES.filter(h => beat >= h).pop(), s = HEAVES.indexOf(h) % 2 ? 1 : -1;
    sparkMat.uniforms.uO.value.copy(A.hand[s]); sparkMat.uniforms.uAge.value = (beat - h) * B.spb; sparkMat.uniforms.uScale.value = 1.6; sparks.visible = true; }
  else sparks.visible = false;
  headlamps(S, beat);
  // ---- lights on the people: floods from below/behind, the sun from behind
  const P = palette(S.pal);
  backL.position.copy(camera.position).addScaledVector(camera.getWorldDirection(V()), 400).add(V(0, 60, 0)); backL.target.position.copy(camera.position);
  backL.color.copy(isPay ? P.sun : new THREE.Color(1, 0.62, 0.34)); backL.intensity = isPay ? 0 : 1.4 * clamp(S.litY / 30);
  hemi.color.copy(P.mid); hemi.intensity = 0.3;
  if (shot.hero || shot.crew) { fillL.position.copy(c.tgt).add(V(0, 3, -6)); fillL.intensity = 3; fillL.distance = 18; } else fillL.intensity = 0;
  // ---- uniforms
  U.uZen.value.copy(P.zen); U.uMid.value.copy(P.mid); U.uHor.value.copy(P.hor); U.uGlow.value.copy(P.glow).multiplyScalar((0.6 + 0.8 * clamp(S.pal - 0.5)) * (shot.tele ? 0.25 : 1));
  U.uSunC.value.copy(P.sun); U.uSunI.value = S.sunI; U.uSunR.value = sunR; U.uSunDir.value.copy(sunDir); U.uStars.value = clamp(1 - S.pal);
  U.uLitY.value = S.litY; U.uWave.value = S.wave; U.uKick.value = kick * 0.6; U.uT.value = t;
  const red = clamp(S.pal - 1), far = c.fov < 10;
  const AO = {
    sun: { dir: sunDir.toArray(), color: '#ff5a24', intensity: 0.4 + 1.2 * red },
    haze: { color: '#' + P.haze.getHexString(), density: far ? 0.00002 : 0.0011, falloff: far ? 0.0015 : 0.004, g: 0.8, sun: far ? 0.0 : 0.05 + 0.15 * red, start: isPay ? 150 : 20, max: 0.94 },
    rays: { amount: S.sunI * (shot.sun === 'fist' ? 0.7 : 1.5), threshold: 1.0, length: 0.75, decay: 0.97, radius: 0.4, falloff: 3.5, tint: '#ffa070' },
    wrap: { amount: isPay ? 0.12 : 0.3, radius: 0.8 }, edge: { amount: 1.4, width: 2.0, tint: red > 0.5 ? '#ffd0a0' : '#c8d4ff' },
    glow: { amount: 0.45 + 0.3 * imp, threshold: 1.6 },
    grade: { exposure: 1.2 + 0.25 * imp, warm: red > 0.5 ? '#220404' : '#0a0a1a', floor: red > 0.5 ? '#0a0204' : '#04050c', contrast: 0.18, saturation: 1.0, bleach: 0.45, vignette: 0.45, grain: 0.035, t },
  };
  for (const k in ATO) AO[k] = { ...(AO[k] || {}), ...ATO[k] };
  atm.render(scene, camera, AO, null);
  if (window.DEBUG) { const pf = A.hand[-1].clone().project(camera), ps = camera.position.clone().addScaledVector(sunDir, 1000).project(camera); console.log('proj fist', pf.x.toFixed(3), pf.y.toFixed(3), 'sun', ps.x.toFixed(3), ps.y.toFixed(3)); }
  if (window.DEBUG) console.log('b', beat.toFixed(2), 'feet', S.feet.toFixed(1), 'fist', A.hand[-1].toArray().map(v => v.toFixed(1)).join(','));
  return { S, shot: c, kick, imp };
}

// ---------------------------------------------------------------- type: slams on the hits, cleared between
const HPOS = [[0, 1560, 250], [-60, 1450, 230], [50, 1600, 270], [0, 380, 240], [-40, 1500, 290], [40, 330, 250]];
function drawType(t) {
  const f = Math.round(t * 30);
  for (const c of CUES) {
    const f0 = Math.round(c.b * B.spb * 30); if (f < f0 || f >= f0 + c.f) continue;
    const age = (f - f0) / 30;
    let x = W / 2, y = 1500, size = c.text.length > 11 ? 132 : 158, shake = 0;
    if (c.heave != null) {
      const [dx, yy, s0] = HPOS[c.heave % HPOS.length]; x += dx; y = yy; size = c.b >= 56 ? 330 : c.b === 46 ? 300 : s0 + 8 * (c.heave % 3);
      shake = Math.exp(-age * 20) * 14;
    }
    if (c.b === 48 || c.b === 50) { y = 1560; size = 190; }
    if (c.b === 0) { y = 1520; size = 170; }
    const k = 1 + 0.18 * Math.exp(-age * 30);
    ctx.save(); ctx.translate(x + Math.sin(t * 97) * shake, y + Math.cos(t * 83) * shake); ctx.scale(k, k);
    line(ctx, c.text, 0, 0, { family: 'Anton', size, color: c.red ? C.red2 : C.cream, shadow: 40, maxW: W - 120, tracking: c.heave != null ? 0.02 : 0.01 });
    ctx.restore();
  }
}

// ---------------------------------------------------------------- frame
window.renderFrame = async (t) => {
  const frame = Math.round(t * 30), beat = B.beat(t);
  if (beat >= CLOSE) { closer(ctx, t - CLOSE * B.spb);
    ctx.save(); ctx.globalCompositeOperation = 'lighten'; ctx.fillStyle = '#4a0a08'; ctx.fillRect(0, 0, W, H); ctx.restore();   // the piece's own ground (dark sun red), not black
    finish.apply(ctx, frame, { grain: 0.06, vignette: 0.35 }); return; }
  const freeze = beat >= 55 && beat < 56;
  const { imp } = world(freeze ? 55 * B.spb : t, freeze ? 55 : beat);
  RQ.present(ctx, renderer.domElement, renderer.getContext(), { w: W, h: H });
  // v4 (5 Oct, client): no text overlays on the main segment; the picture and the closer are unchanged (drawType kept for reference)
  const pay = beat >= 56 && beat < 57 ? Math.exp(-(beat - 56) * 4) : 0;
  finish.apply(ctx, frame, { grain: 0.05, vignette: 0.3, flash: 0.14 * pay + 0.06 * imp });
};
window.__lab = { renderer, scene, camera, atm, folk, sky, ground, cityGroup, U, B, world };   // read-only handle for the looks bake (LOOKS c2); renders nothing
window.sceneReady = true;
