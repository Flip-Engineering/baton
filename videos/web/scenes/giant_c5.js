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
import { makeFist } from './giant_c5.fist.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ctx = document.getElementById('out').getContext('2d');
await loadFonts();
const B = await loadBeats(globalThis.ACP_VOX ? 'giant_c5_vox' : 'giant_c5');   // VOICE c5: giant_c5_vox.js sets ACP_VOX (the voiced review build's cards come from its own hits)
const finish = new Finish(1928);
const QS = new URLSearchParams(location.search); window.DEBUG = QS.has('debug');
const ATO = QS.get('atm') ? JSON.parse(QS.get('atm')) : {};   // debug: atmos overrides, e.g. ?atm={"edge":{"amount":0}}

// ---------------------------------------------------------------- words (scripts_final/giant.json; the card times come from the song's hit map)
// The cards are read from out/.giant_c5.hits.json ('text': the score's cards, at the beat the score puts them), so the type cannot drift off the
// music. Here is how each is broken into lines; a card not listed is one line. HEAVE! only where the score puts a pull under it (b41, b68, b70).
const BREAK = { 'MERE INDIVIDUALS.': ['MERE', 'INDIVIDUALS.'], 'OF HUMAN BEINGS': ['OF HUMAN', 'BEINGS'], 'THEIR ABILITY': ['THEIR', 'ABILITY'], 'TO PULL TOGETHER': ['TO PULL', 'TOGETHER'],
  'AND THEIR ABILITIES.': ['AND THEIR', 'ABILITIES.'], 'IS THE WORKING CLASS.': ['IS THE', 'WORKING', 'CLASS.'], 'THE WORKING CLASS': ['THE WORKING', 'CLASS'], 'IS A COLOSSUS': ['IS A', 'COLOSSUS'], 'THEY ARE ORGANS': ['THEY ARE', 'ORGANS'], 'OF THE HUMAN BRAIN,': ['OF THE', 'HUMAN BRAIN,'],
  'CREATED BY': ['CREATED', 'BY'], 'THE HUMAN HAND.': ['THE HUMAN', 'HAND.'], 'SIGNED BY EVERY CREW.': ['SIGNED BY', 'EVERY CREW.'], 'WHOSE DAWN': ['WHOSE', 'DAWN'], 'ESTABLISHES ITS PRIOR OCCLUSION': ['ESTABLISHES', 'ITS PRIOR', 'OCCLUSION'],
  'INTO THE NIGHT SKY.': ['INTO THE', 'NIGHT SKY.'], 'THEIR STRENGTHS,': ['THEIR', 'STRENGTHS,'], 'THEIR POWERS': ['THEIR', 'POWERS'], 'NATURE BUILDS': ['NATURE', 'BUILDS'], 'NO MACHINES.': ['NO', 'MACHINES.'] };
const PULLS = [20, 22, 24, 29, 33, 37, 40, 41, 47, 49, 51];        // the crew's pulls (the score's heave cues; the song's b68 / b70 are the payoff)
const CLIMB_H = PULLS.filter(h => h >= 24 && h <= 41);            // the titan's pulls up the face
const CLOSE = 76;                                                   // the lockup (logo_at.json giant_c5)
// v4 (5 Oct, client): no HUMAN POWER. opener, no HEAVE!, no SIGNED BY EVERY CREW.; THE GIANT / IS THE WORKING CLASS. -> THE WORKING CLASS / IS A COLOSSUS
// v5 (5 Oct, client): THE WORKING CLASS / IS A COLOSSUS removed too
// v6 (8 Oct, archive audit gate): THE LAST BEAM, lost the rest of its sentence with SIGNED BY EVERY CREW. (v4), so it ends on a full stop.
// The Grundrisse is cut after MACHINES (Marx: "Nature builds no machines, no locomotives, railways, electric telegraphs, self-acting mules
// etc. [...] They are organs of the human brain, created by the human hand"), so that card carries the elision mark, and the six Marx cards
// carry a small source line (MARX, in drawType).  The six RISE cards (A NEW SUN, ... INTO THE NIGHT SKY.: Haz, "The Rise of MAGA Communism",
// 18 Sep 2022, word for word on showinfrared.substack.com; LINE_SOURCES 10.1.2) carry the house's title-only credit (machines_c11 CHAIR: the
// client's default, 1 Oct), which keeps the essay's title off screen.  The WX cards carry none yet (an ASR transcript, to be checked against
// the clip first).
// c20 (15 Oct): TOPPING OUT. / THE LAST BEAM. cut: with SIGNED BY EVERY CREW. gone they only captioned the picture; the beam plays under the score
const DROP = new Set(['HUMAN POWER', 'HUMAN POWER.', 'HEAVE!', 'SIGNED BY EVERY CREW.', 'THE GIANT', 'IS THE WORKING CLASS.', 'TOPPING OUT.', 'THE LAST BEAM,', 'THE LAST BEAM.']), RENAME = { 'THE GIANT': 'THE WORKING CLASS', 'IS THE WORKING CLASS.': 'IS A COLOSSUS',
  'NO MACHINES.': 'NO MACHINES …', 'THE LAST BEAM,': 'THE LAST BEAM.' };
BREAK['NO MACHINES …'] = ['NO', 'MACHINES …'];
const MARX = 'MARX · GRUNDRISSE · 1858', MARX_CARDS = new Set(['NATURE BUILDS', 'NO MACHINES …', 'THEY ARE ORGANS', 'OF THE HUMAN BRAIN,', 'CREATED BY', 'THE HUMAN HAND.']);
const RISE = 'EXECUTIVE CHAIRMAN, AMERICAN COMMUNIST PARTY', RISE_CARDS = new Set(['A NEW SUN,', 'A RED SUN,', 'WHOSE DAWN', 'RETROCHRONICALLY', 'ESTABLISHES ITS PRIOR OCCLUSION', 'INTO THE NIGHT SKY.']);
const CARDS = B.text.filter(c => c.text && !DROP.has(c.text)).map(c => ({ b: c.t / B.spb, text: RENAME[c.text] || c.text }));

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
  // the core (around the tower): full grammar massing, the tower's block cut out. Asset round (4 Oct, the client: 'all it needs is asset
  // refinement'): deco piers and cornices (plain read as voxels; the fins' vertices are affordable on the farm's GPUs)
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
// ---------------------------------------------------------------- the gloved fists (RIG c1 hand on hero.js): a worker on deck 12 hauling a hoist line
const FS = await makeFist({ THREE, scene, atm, x: -8, y: 12 * DECK, z: HALF - 3.4, yaw: 0, seed: 5 });
FS.show(false);
function hideAll() { for (let i = 0; i < folk.n; i++) folk.set(i, { visible: false }); }

// ---------------------------------------------------------------- the sculpted fist (people.js hands are mittens)
// Built in the hand frame at the knuckles (bind axes: -y along the straight fingers, +z toward the thumb, the palm
// toward -s x). Four knuckles, four proximal phalanges folded to the palm, the middle phalanges tucked back up, and a
// thumb wrapped across them. The people.js fingers are curled inside it; the frame is the grip frame with the curl undone.
function fistGeo(s) {
  // v9 (15 Oct, the client: "the hand does not look correct and has a gap between the hand and arm"): rebuilt as one gloved
  // working hand. A broad, flat-backed palm lofted from the knuckle line down through the wrist into a short gauntlet cuff that
  // runs up inside the sleeve (the bridge below closes whatever the sleeve leaves); four knuckles stepping back from index to
  // little; folded proximal phalanges that make the flat punching face; middle phalanges tucked to the palm; the thumb laid
  // across the index and middle fingers' middle phalanges, its tip against the middle finger, never sticking out.
  const parts = [], X = x => x * s;
  const cap = (a, b, r, r2 = r) => { const A = V(...a), Bp = V(...b), L = A.distanceTo(Bp), g = new THREE.CylinderGeometry(r2, r, L, 14, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), Bp.clone().sub(A).normalize()));
    const m = A.clone().add(Bp).multiplyScalar(0.5); g.translate(m.x, m.y, m.z); parts.push(g);
    const b0 = new THREE.SphereGeometry(r, 14, 10); b0.translate(...a); parts.push(b0); const b1 = new THREE.SphereGeometry(r2, 14, 10); b1.translate(...b); parts.push(b1); };
  const ball = (p, r, k = [1, 1, 1]) => { const g = new THREE.SphereGeometry(r, 16, 12); g.scale(...k); g.translate(...p); parts.push(g); };
  // superellipse rings along +y (toward the wrist): x across back (+s) to palm (-s), z across the hand (+z the thumb side)
  const loft = (R, seg = 28) => { const pos = [], idx = [];
    R.forEach(({ y, cx, hx, hz, n, cz = 0 }) => { for (let k = 0; k < seg; k++) { const a = k / seg * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      pos.push(X(cx) + s * hx * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), y, cz + hz * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n)); } });
    for (let r = 0; r < R.length - 1; r++) for (let k = 0; k < seg; k++) { const a = r * seg + k, b = r * seg + (k + 1) % seg, c = a + seg, d = b + seg;
      if (s > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c); }
    for (const [r, flip] of [[0, true], [R.length - 1, false]]) { const ci = pos.length / 3, q = R[r]; pos.push(X(q.cx), q.y, q.cz || 0);
      for (let k = 0; k < seg; k++) { const a = r * seg + k, b = r * seg + (k + 1) % seg; (flip !== (s < 0)) ? idx.push(ci, b, a) : idx.push(ci, a, b); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); parts.push(g.toNonIndexed()); };
  // the hand's body: knuckle line (y 0) to the wrist (y ~0.085) and the cuff (to y 0.15), back of the hand flat, palm fuller
  loft([
    { y: -0.006, cx: -0.010, hx: 0.017, hz: 0.040, n: 3.0, cz: 0.001 },
    { y: 0.012, cx: -0.012, hx: 0.022, hz: 0.044, n: 3.4, cz: 0.001 },
    { y: 0.040, cx: -0.012, hx: 0.024, hz: 0.044, n: 3.2, cz: 0.002 },
    { y: 0.066, cx: -0.010, hx: 0.024, hz: 0.039, n: 2.8, cz: 0.002 },
    { y: 0.088, cx: -0.008, hx: 0.023, hz: 0.033, n: 2.4 },
    { y: 0.105, cx: -0.007, hx: 0.027, hz: 0.036, n: 2.3 },      // the glove's cuff opens over the wrist
    { y: 0.150, cx: -0.006, hx: 0.031, hz: 0.039, n: 2.2 },
  ]);
  ball([X(-0.030), 0.050, 0.026], 0.019, [0.8, 1.25, 1.0]);       // the thenar pad under the thumb
  ball([X(-0.028), 0.045, -0.028], 0.016, [0.75, 1.35, 0.9]);     // the hypothenar pad (the heel of the hand, little-finger side)
  // fingers: z across the hand, knuckle step back (y) and down (x), radius, length scale
  const F = [[0.0300, 0.000, 0.000, 0.0112, 1.0], [0.0100, -0.002, 0.002, 0.0118, 1.05], [-0.0100, 0.002, -0.001, 0.0112, 1.0], [-0.0290, 0.010, -0.005, 0.0100, 0.86]];
  for (const [z, dy, dx, r, L] of F) {
    const k = [X(0.004 + dx), -0.004 + dy, z];
    ball(k, r * 1.22, [1.0, 0.95, 0.92]);                                                   // the knuckle (metacarpal head)
    const p1 = [X(0.004 + dx - 0.040 * L), -0.012 + dy * 0.6, z * 0.97];
    cap([X(0.002 + dx), -0.010 + dy, z], p1, r * 1.04, r);                                  // proximal phalanx, folded square to the palm
    const p2 = [p1[0], p1[1] + 0.026 * L, z * 0.95];
    cap([p1[0] + X(0.002), p1[1], p1[2]], p2, r * 0.98, r * 0.9);                           // middle phalanx, back up against the palm
  }
  // the thumb: metacarpal from the wrist's thumb side, then laid across the index and middle fingers' middle phalanges
  cap([X(-0.016), 0.080, 0.030], [X(-0.034), 0.040, 0.044], 0.0150, 0.0138);
  cap([X(-0.034), 0.040, 0.044], [X(-0.056), 0.020, 0.024], 0.0136, 0.0128);
  cap([X(-0.056), 0.020, 0.024], [X(-0.058), 0.012, 0.000], 0.0126, 0.0112);
  const g = mergeGeometries(parts.map(p => { const q = p.index ? p.toNonIndexed() : p; for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal') q.deleteAttribute(k); return q; }));
  g.scale(1.06, 1.06, 1.06); return g;
}
const fistMat = new THREE.MeshStandardMaterial({ color: '#1a1612', roughness: 0.75, metalness: 0.0 });
const FISTS = { 1: new THREE.Mesh(fistGeo(1), fistMat), [-1]: new THREE.Mesh(fistGeo(-1), fistMat) };
for (const k in FISTS) { const m = FISTS[k]; m.matrixAutoUpdate = false; m.frustumCulled = false; m.layers.enable(atm.maskLayer); scene.add(m); }
const _rz = new THREE.Matrix4();
// v9: the wrist bridge. The fist hangs on the knuckle frame, the sleeve on the forearm bone, and the hand bone's fist scale
// pulls them apart; a tapered gauntlet from inside the fist's cuff up the forearm makes hand and arm one form at any pose.
const BRIDGE = { 1: new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 18, 1, false), fistMat), [-1]: new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 18, 1, false), fistMat) };
for (const k in BRIDGE) { const m = BRIDGE[k]; m.frustumCulled = false; m.layers.enable(atm.maskLayer); m.geometry.translate(0, 0.5, 0); scene.add(m); }
const _bp = new THREE.Vector3(), _bq = new THREE.Vector3(), _bs = new THREE.Vector3();
function placeFist(id, s, curl, show) {
  const m = FISTS[s], br = BRIDGE[s]; m.visible = br.visible = show; if (!show) return;
  _rz.makeRotationZ(s * (FISTON[s] ? 1.75 : curl)); m.matrix.copy(folk.grip(id, s)).multiply(_rz); m.matrixWorldNeedsUpdate = true;
  const ar = folk.att[id] && folk.att[id].arm && folk.att[id].arm[s > 0 ? 0 : 1]; if (!ar) { br.visible = false; return; }
  // v9: the person's own hand (bare, its thumb out) is drawn shrunk into the wrist under the fist, so no thumb or finger of
  // it pokes out of the glove (the r1 render showed its thumb standing off the fist at 32-34 s)
  { const hb = s > 0 ? [7, 8, 19] : [11, 12, 20], D = folk.data, o = id * 63 * 4, k = 0.3, w = ar.W;
    for (const b of hb) { const q = o + b * 12; for (let r = 0; r < 3; r++) { const i = q + r * 4; D[i] *= k; D[i + 1] *= k; D[i + 2] *= k; D[i + 3] = k * D[i + 3] + (1 - k) * w.getComponent(r); } }
    folk.tex.needsUpdate = true; }
  _bs.setFromMatrixScale(m.matrix); const sc = _bs.x * 1.06;
  _bp.set(X0(s, -0.007), 0.115, 0).applyMatrix4(m.matrix);                       // inside the fist's cuff
  _bq.copy(ar.E).sub(ar.W); const fl = _bq.length(); _bq.normalize();
  const end = ar.W.clone().addScaledVector(_bq, Math.min(fl * 0.45, 0.13 * sc / 1.06 * 1.6));   // up the forearm, inside the sleeve
  const d = end.clone().sub(_bp), L = d.length();
  br.position.copy(_bp); br.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); br.scale.set(0.029 * sc, L, 0.035 * sc);
  // the bridge's cross-section turned to the hand's: its wide axis (z) along the fist's thumb axis
  const zf = V(0, 0, 1).transformDirection(m.matrix), yb = V(0, 1, 0).applyQuaternion(br.quaternion), zb = zf.sub(yb.clone().multiplyScalar(zf.dot(yb))).normalize(), xb = yb.clone().cross(zb);
  br.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xb, yb, zb));
}
const X0 = (s, x) => x * s;
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
const ALLH = [...PULLS, 68, 70];
function heaveEnv(beat) { let e = 0; for (const h of ALLH) { const u = beat - h; if (u > -0.3 && u < 1.5) e = Math.max(e, u < 0 ? (1 + u / 0.3) * 0.4 : Math.exp(-u * 3)); } return e; }
const CLIMB_DY = [27, 30, 34, 30, 20];                  // metres gained on each pull after the reveal (b29 .. b41)
function feetY(beat) {
  if (beat < 24) return 55;
  if (beat >= 47) return TOP;
  let y = 55; CLIMB_H.slice(1).forEach((h, i) => { y += CLIMB_DY[i] * ease.outCubic(clamp((beat - h) / 0.6)); });
  return y + 6 * clamp((beat - 24) / 17) + (beat > 41 ? 20 * ease.inOutCubic(clamp((beat - 41) / 5)) : 0);
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
  look(P, st, A) {     // one man on the ground, arms hanging, looking up the tower
    const { B: Bn, ARM } = A, u = st.u;
    for (const s of [1, -1]) { const [ua, fa] = ARM(s); P[ua * 3] = -0.06; P[ua * 3 + 2] = s * 0.1; P[fa * 3] = -0.18; }
    P[Bn.head * 3] = lerp(-0.1, -0.62, u); P[Bn.chest * 3] = -0.04 * u;
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

// the white topping-out beam: signed, an evergreen, the ACP emblem (four stripes) stencilled red on the web
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
  // c20 (15 Oct): no flag on the beam (it pulled the eye to the state's flag at the moment the beam carries the Party's mark); the evergreen and the mark carry it
  void pole; void flag;
  topBeam.add(web, f1, f2, tree); scene.add(topBeam);
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
  red: { zen: '#0d0a2a', mid: '#4a1238', hor: '#c02c14', glow: '#ff3a12', sun: '#ff3a12', haze: '#260a10' },
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
  // the floods come on with the pulls: b20 one crew's deck, b22 more, b24 the whole face (then they follow the titan up)
  S.litY = beat < 20 ? 0 : beat < 22 ? 45 * ease.outCubic(clamp((beat - 20) / 0.5)) : beat < 24 ? 45 + 45 * ease.outCubic(clamp((beat - 22) / 0.5)) : beat >= 47 ? TOP + 10 : S.feet + 90 + 6 * S.hv;
  if (beat >= 24 && beat < 26) S.litY = lerp(90, S.litY, ease.outCubic(clamp((beat - 24) / 0.6)));
  S.wave = beat < 24 ? 0 : beat < 40 ? lerp(60, 800, (beat - 24) / 16) : beat < 47 ? lerp(800, 4200, ease.inCubic((beat - 40) / 7)) : 6000;   // the city's rings: they run out from HAND (b40)
  S.pal = beat < 24 ? lerp(0, 0.2, beat / 24) : beat < 40 ? lerp(0.2, 0.7, (beat - 24) / 16) : beat < 47 ? lerp(0.7, 1.3, (beat - 40) / 7) : beat < 52 ? lerp(1.3, 1.6, (beat - 47) / 5) : lerp(1.6, 2, smooth(52, 55, beat));
  S.sunI = smooth(51.5, 53, beat);
  S.sunEl = beat < 52 ? -0.02 : beat < 68 ? lerp(-0.006, 0.014, (beat - 52) / 16) : 0.014;
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
// the last image: over the titan's shoulder from behind and above, the fist up, the sun rising ahead over the lit city
function payOver(u) {
  return A => { const f = A.hand[-1], hip = A.hip;
    const p0 = hip.clone().add(V(-1.3 * GS, 0.5 * GS, 0.55 * GS)), p1 = hip.clone().add(V(-2.4 * GS, 1.5 * GS, 0.8 * GS));
    const t0 = f.clone().add(V(1.2 * GS, 0.0, 0)), t1 = f.clone().add(V(3.0 * GS, -0.7 * GS, 0));
    return { pos: p0.lerp(p1, ease.inOutCubic(u)), tgt: t0.lerp(t1, ease.inOutCubic(u)), fov: 52, roll: -0.05 }; };
}
const FCAMS = [[0.7, 0.7, 0.05], [-0.7, 0.7, 0.05], [1.0, 0.1, 0.0], [0.25, 1.0, -0.05], [0.5, 0.8, -0.3]];   // (left, forward, up) offsets from the hands' midpoint, in the worker's frame
function fistShot(u, haul, cam = FCAMS[0], fov = 30) {
  return { fist: { u, haul }, fn: () => { const a = FS.anchors(), m = a.R.clone().addScaledVector(a.up, -0.05);
    return { pos: m.clone().addScaledVector(a.left, cam[0]).addScaledVector(a.fwd, cam[1]).addScaledVector(a.up, cam[2]), tgt: m.clone().addScaledVector(a.up, 0.02), fov, roll: -0.05 }; } };
}
const FTEST = QS.get('fistTest');
// v9 hand check (debug only, never set in the piece): ?orbit=az,el,dist[,fov[,side]] frames the titan's fist from any angle (deg, deg, m); &lit=1 adds a flat fill
const ORB = QS.get('orbit') ? (([az, el, d, fov, sd]) => ({ az: az * Math.PI / 180, el: el * Math.PI / 180, d, fov: fov || 30, s: sd || -1, lit: QS.has('lit') }))(QS.get('orbit').split(',').map(Number)) : null;
// the gloved fists: closing on each pull (u 0 -> 1 across the hit), hauling the line down, re-gripping between
const FPULL = PULLS.filter(h => h <= 41);
function fistState(beat) {
  let h = -99; for (const p of FPULL) if (p - 0.15 <= beat) h = p;
  const dt = beat - h;
  if (h < 0) return { u: 0, haul: 0 };
  const u = dt < 1.0 ? smooth(-0.15, 0.12, dt) : 1 - smooth(1.0, 1.4, dt), haul = dt < 1.0 ? 0.3 * ease.outCubic(clamp(dt / 0.85)) : 0.3 * (1 - smooth(1.0, 1.9, dt));
  return { u, haul };
}
// what the piece frames when the dawn comes: the same shots as the night, the world already lit (dawn = the tower lit, the city ringed, the red sun up)
const DAWN = { dawn: 1 };
function shotAt(beat, S) {
  if (FTEST) return fistShot(clamp(beat - 0.5), 0.3 * clamp(beat - 1.5), FCAMS[Math.floor(beat) % FCAMS.length], Number(QS.get('fov') || 30));
  const F = S.feet, top = F + 2.3 * GS, mid = F + 1.3 * GS, fs = fistState(beat);
  // ---- HUMAN POWER.: frame 0 is the payoff image (the fist on the red sun), then the plunge to street level at blue hour
  if (beat < 0.5) return { pay: 1, fn: payCam(1), sun: 'fist', aim: 1, grip: 1 };
  if (beat < 2) { const u = sh(beat, 0.5, 2); return { pos: V(-20, 2, 112 - 6 * u), tgt: V(0, 95 + 20 * u, 0), fov: 70, roll: -0.05, noGiant: 1 }; }
  // ---- WHAT ARE WE? / WE'RE JUST / MERE INDIVIDUALS.: one man at the foot of a dark frame, one rigger alone on an open deck
  if (beat < 5.25) { const u = sh(beat, 2, 5.25); return { pos: V(3.5, 16 * DECK + 1.2, HALF - 10 + 3 * u), tgt: V(16.5, 16 * DECK + 2.0, HALF + 1.5), fov: 56 - 10 * u, roll: -0.04, hero: 1, tieBeat: 0, noGiant: 1 }; }
  if (beat < 8.25) { const u = sh(beat, 5.25, 8.25); return { pos: V(8.5, 16 * DECK + 0.9, HALF - 7), tgt: V(16.5, 16 * DECK + 2.4 + 0.3 * u, HALF + 1.5), fov: 44 - 4 * u, roll: -0.04, hero: 1, noGiant: 1 }; }
  // ---- THE POWER OF HUMAN BEINGS COMES FROM THEIR ABILITY TO PULL TOGETHER: the men become crews
  if (beat < 10.25) return { ...crewShot(24, 0.06), noGiant: 1 };
  if (beat < 12.75) return { ...crewShot(12, -0.05, 1.5), noGiant: 1 };
  if (beat < 14.25) { const u = sh(beat, 12.75, 14.25); return { pos: V(-230 + 15 * u, 62, 300), tgt: V(0, 92, 0), fov: 34, roll: 0, crewsAll: 1, noGiant: 1 }; }
  if (beat < 16.25) return { ...crewShot(7, 0.06), noGiant: 1 };
  if (beat < 19.25) return { ...crewShot(28, 0.05, sh(beat, 16.25, 19.25) * 2), noGiant: 1 };
  // ---- THEIR STRENGTHS, THEIR POWERS AND THEIR ABILITIES.: the glove closes on the line on the pull; then the whole face
  if (beat < 21.25) return { ...fistShot(fs.u, fs.haul, FCAMS[1], 28), noGiant: 1 };
  if (beat < 22.75) return { ...fistShot(fs.u, fs.haul, FCAMS[0], 26), noGiant: 1 };
  if (beat < 24) { const u = sh(beat, 22.75, 24); return { pos: V(-45 + 10 * u, 8, GZ + 75), tgt: V(0, 60, GZ), fov: 60, roll: -0.1, crewsAll: 1, noGiant: 1 }; }
  // ---- b24: the pull under ABILITIES and the section braam: the giant, on the face, among the decks
  if (beat < 25.25) { const u = sh(beat, 24, 25.25); return { pos: V(-260 + 25 * u, F + 10, 320), tgt: V(0, F + 20, 0), fov: 34, roll: 0, crewsAll: 1 }; }
  // ---- THE GIANT IS THE WORKING CLASS.
  if (beat < 27.25) { const u = sh(beat, 25.25, 27.25); return { pos: V(34, F - 18, GZ + 30), tgt: V(0, F + 60, GZ), fov: 64, roll: 0.25 - 0.05 * u }; }
  if (beat < 29.75) { const u = sh(beat, 27.25, 29.75); return { pos: V(95 - 25 * u, F + 20, GZ + 70), tgt: V(0, F + 50, GZ), fov: 44 + 8 * u, roll: 0.08 - 0.16 * u }; }
  // ---- NATURE BUILDS NO MACHINES. THEY ARE ORGANS OF THE HUMAN BRAIN, CREATED BY THE HUMAN HAND.
  if (beat < 31.75) { const u = sh(beat, 29.75, 31.75); return { pos: V(20, top + 40 + 10 * u, GZ + 10), tgt: V(0, 0, 0), fov: 70 - 10 * u, roll: 0.1 + 0.3 * u, down: 1 }; }
  if (beat < 34.25) { const u = sh(beat, 31.75, 34.25); return { fn: () => { const bp = topBeam.position; return { pos: bp.clone().add(V(-14 + 3 * u, -11, 17)), tgt: bp.clone().add(V(0, 6 + 4 * u, 0)), fov: 46, roll: 0.08 }; } }; }
  if (beat < 35.75) { const u = sh(beat, 34.25, 35.75); return { pos: V(-900 + 60 * u, 120, 900), tgt: V(0, TOP - 30, 0), fov: 16 - 2 * u, roll: 0 }; }
  if (beat < 37.5) return crewShot(28, 0.05);
  if (beat < 39) return { ...fistShot(fs.u, fs.haul, FCAMS[0], 28), noGiant: 1 };
  if (beat < 41) return { ...fistShot(fs.u, fs.haul, FCAMS[3], 24), noGiant: 1 };
  // ---- b40: HAND. the city's rings run out; HEAVE! (b41)
  if (beat < 42.5) { const u = sh(beat, 41, 42.5); return { pos: V(-520 + 40 * u, 60, 560), tgt: V(0, mid - 20, 0), fov: 32, roll: 0, roofs: 1 }; }
  if (beat < 44) { const u = sh(beat, 42.5, 44); return { pos: V(30, top + 220 + 80 * u, GZ + 60), tgt: V(-60, 0, -40), fov: 62, roll: 0.2, down: 1 }; }
  if (beat < 46) { const u = sh(beat, 44, 46); return { pos: V(-160, TOP + 30, 210), tgt: V(-10, TOP + 30 + 6 * u, 10), fov: 38, roll: 0.03 }; }
  // ---- TOPPING OUT. THE LAST BEAM, SIGNED BY EVERY CREW.
  if (beat < 47.75) return { fn: () => { const bp = topBeam.position; return { pos: bp.clone().add(V(-9, -5, 16)), tgt: bp.clone().add(V(0, -0.5, 0)), fov: 44, roll: 0.05 }; } };
  if (beat < 49.5) return { pos: V(-46, TOP + 4, 70), tgt: V(0, TOP + 34, 0), fov: 60, roll: 0.06 };
  if (beat < 51.75) { const u = sh(beat, 49.5, 51.75); return { fn: () => { const bp = topBeam.position; return { pos: bp.clone().add(V(-7 + 2 * u, -2.5, 11)), tgt: bp.clone().add(V(0, 0.4, 0)), fov: 38, roll: 0.04 }; } }; }
  // ---- THE SUN: the dawn over this tower and this city
  if (beat < 53.75) { const u = sh(beat, 51.75, 53.75); return { pay: 1, pos: V(-1500, 30 + 20 * u, 1900), tgt: V(0, TOP - 40, 0), fov: 10, roll: 0, sun: 'behind', aim: 0.3, grip: 1, roofs: 1 }; }
  if (beat < 55.75) { const u = sh(beat, 53.75, 55.75); return { pay: 1, tele: { D: 5200 - 400 * u, fov: 2.8 }, sun: 'tele', aim: 0.1 + 0.2 * u, grip: 1 }; }
  if (beat < 57.25) { const u = sh(beat, 55.75, 57.25); const rc = ROOFCREWS[0]; return { pos: V(rc.x - 9 - 2 * u, rc.y + 0.7, rc.z + 2.5), tgt: V(0, TOP + 20, 0), fov: 40, roll: -0.04, pay: 1, sun: 'tower', aim: 0.75, grip: 1, roofs: 1 }; }
  // ---- RETROCHRONICALLY ESTABLISHES ITS PRIOR OCCLUSION INTO THE NIGHT SKY.: the dawn rewrites the night before it (the same shots, now lit)
  if (beat < 59.5) return { ...DAWN, ...shotAt(6.9, state(6.9)), noGiant: 1, hero: 1, tieBeat: 7.6 };
  if (beat < 61.75) return { ...DAWN, ...shotAt(9.2, state(9.2)), noGiant: 1 };
  if (beat < 64.25) { const u = sh(beat, 61.75, 64.25); return { ...DAWN, pos: V(70 - 30 * u, 72, HALF + 140 - 60 * u), tgt: V(14.5, 66, HALF - 1), fov: 30 - 10 * u, roll: -0.03, hero: 1, tieBeat: 0, noGiant: 1 }; }
  if (beat < 68) { const u = sh(beat, 64.25, 68); return { ...DAWN, pos: V(-6, 0.6, HALF + 30), tgt: V(0, 200 + 260 * u, 0), fov: 66, roll: -0.03, noGiant: 1, plaza: 1 }; }
  // ---- b68: the fist closes on the sun and hauls it up (HEAVE!, HEAVE!), then the camera rises over the city
  if (beat < 70) { const u = sh(beat, 68, 70); return { pay: 1, fn: payCam(0.3 * (1 - u)), sun: 'fist', aim: 1, grip: smooth(68, 68.25, beat), haul: ease.outCubic(u) }; }
  if (beat < 72) { const u = sh(beat, 70, 72); return { pay: 1, fn: payCam(0.3 + 0.7 * ease.inOutCubic(u)), sun: 'fist', aim: 1, grip: 1, haul: 1 }; }
  { const u = sh(beat, 72, 76); return { pay: 1, fn: payOver(u), sun: 'over', aim: 1, grip: 1, haul: 1 }; }
}

// ---------------------------------------------------------------- the world at a beat
function world(t, beat) {
  const S = state(beat), shot = shotAt(beat, S), isPay = !!shot.pay;
  if (isPay || shot.dawn) { S.litY = TOP + 10; S.wave = 6000; S.pal = 2; S.sunI = 1; S.sunEl = 0.02; }
  if (shot.plaza && !shot.dawn) S.wave = 26;
  // ---- the titan
  hideAll(); lineK = 0; FS.show(!!shot.fist); if (shot.fist) FS.pose(shot.fist.u, shot.fist.haul);
  if (shot.noGiant) {}
  else if (isPay || beat >= 46) {
    if (beat >= 46 && beat < 51.75 && !isPay) folk.set(GIANT, { visible: true, x: 0, y: TOP, z: 0, heading: Math.PI / 2, act: 'stand', t: 0, pose: POSE.crouch, rise: beat < 51 ? 0 : ease.inOutCubic((beat - 51) / 0.75), beat });
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
    if (shot.fist || (shot.crew && shot.crew !== cr.deck)) continue;   // a crew close-up shows only that crew: nobody's hands land on the titan behind them (gate CROTCH)
    const lock = clamp(beat / 68), lag = (1 - lock) * 0.35 * ((ci * 0.37) % 1), hv = heaveEnv(beat - lag);
    cr.ids.forEach((id, k) => folk.set(id, { visible: true, x: cr.x0 + cr.dir * k * 1.2, y, z: HALF - 2.2 - (k % 2) * 0.5, heading: cr.dir > 0 ? Math.PI / 2 : -Math.PI / 2, act: 'stand', t: t + k, pose: POSE.haul, hv, k: k === 0 ? 1 : 0 }));
  }
  if (shot.hero) { const u = smooth(6.0, 7.5, shot.tieBeat ?? beat); armG('HERO_L', G_PULL, G_OVER, 1, false);
    folk.set(HERO, { visible: true, x: 14.5, y: 16 * DECK, z: HALF - 1.2, heading: 1.9, act: 'stand', t, pose: POSE.tie, u, gesture: u > 0.5 ? [{ name: 'HERO_L', side: 1 }] : null }); }
  if (shot.lone) folk.set(HERO, { visible: true, x: -1.2, y: 0, z: HALF + 6, heading: Math.PI, act: 'stand', t, pose: POSE.look, u: smooth(2, 5, beat) });   // snapped, never half-raised (a half blend reads forward)
  if (shot.roofs || shot.crewsAll) for (const rc of ROOFCREWS) rc.ids.forEach((id, k) => folk.set(id, { visible: true, x: rc.x + k * 1.3, y: rc.y, z: rc.z, heading: Math.PI / 2, act: 'stand', t: t + k, pose: POSE.haul, hv: heaveEnv(beat) }));

  // ---- the white beam: swinging on the crown crane's hook, seated at b46
  topBeam.visible = beat >= 30 && !(isPay && beat < 1) && !shot.lone && !shot.hero;
  const cu = CR_TOP.userData, hookTip = V(cu.jib * 0.5, cu.mastH - 1, 0).applyEuler(new THREE.Euler(0, CR_TOP.rotation.y, 0)).add(CR_TOP.position);
  if (beat < 51.3 && !isPay) {
    const sw = Math.sin(t * 1.3) * 0.25, drop = lerp(60, 14, smooth(30, 47, beat));
    const hung = hookTip.clone().add(V(0, -drop - 6, 0)), seat = V(0, TOP + 0.6, HALF);
    topBeam.position.copy(hung.lerp(seat, ease.inOutCubic(smooth(47.5, 51, beat)))); topBeam.rotation.set(0, 0.4 * (1 - smooth(47.5, 51, beat)) + sw * 0.5 * (1 - smooth(49, 51, beat)), sw * 0.08);
  } else { topBeam.position.set(0, TOP + 0.6, HALF); topBeam.rotation.set(0, 0, 0); }
  { const a = hookTip, b = topBeam.position.clone().add(V(0, 0.5, 0)), d = b.clone().sub(a); hookLine.visible = topBeam.visible && beat < 51.6 && !isPay;
    hookLine.position.copy(a.clone().add(b).multiplyScalar(0.5)); hookLine.quaternion.setFromUnitVectors(V(0, 1, 0), d.clone().normalize()); hookLine.scale.set(1, d.length(), 1); }

  // ---- camera: hand/head-framed shots need the titan posed first
  camera.up.set(0, 1, 0); camera.position.set(0, 100, 300); camera.lookAt(0, 100, 0); camera.fov = 50; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  folk.update(camera);
  const gs = folk.get(GIANT);
  const A = { hand: { 1: folk.gripPos(GIANT, 1, V()), [-1]: folk.gripPos(GIANT, -1, V()) }, head: V().setFromMatrixPosition(folk.head(GIANT) || new THREE.Matrix4()), hip: V(gs.x, gs.y + 1.0 * GS, gs.z) };
  let c = shot;
  if (shot.fn) c = { ...shot, ...shot.fn(A) };
  if (ORB) { const f = A.hand[ORB.s]; c = { ...c, pos: f.clone().add(V(Math.cos(ORB.el) * Math.sin(ORB.az), Math.sin(ORB.el), Math.cos(ORB.el) * Math.cos(ORB.az)).multiplyScalar(ORB.d)), tgt: f.clone(), fov: ORB.fov, roll: 0 }; }
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
  else if (shot.sun === 'behind') { sunR = 0.03; sunDir = c.tgt.clone().sub(camera.position).normalize(); sunDir.y += S.sunEl * 2.5 + 0.004; sunDir.normalize(); }
  else if (shot.sun === 'over') { sunR = 0.11; }
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
  const seat = 51;
  if (beat >= seat && beat < seat + 3 && !isPay) { sparkMat.uniforms.uO.value.set(0, TOP + 0.2, HALF); sparkMat.uniforms.uAge.value = (beat - seat) * B.spb; sparkMat.uniforms.uScale.value = 1.3; sparks.visible = true; }
  else if (!isPay && !shot.noGiant && CLIMB_H.some(h => beat >= h && beat < h + 1.3)) { const h = CLIMB_H.filter(h => beat >= h).pop(), s = CLIMB_H.indexOf(h) % 2 ? 1 : -1;
    sparkMat.uniforms.uO.value.copy(A.hand[s]); sparkMat.uniforms.uAge.value = (beat - h) * B.spb; sparkMat.uniforms.uScale.value = 1.6; sparks.visible = true; }
  else sparks.visible = false;
  headlamps(S, beat);
  // ---- lights on the people: floods from below/behind, the sun from behind
  const P = palette(S.pal);
  backL.position.copy(camera.position).addScaledVector(camera.getWorldDirection(V()), 400).add(V(0, 60, 0)); backL.target.position.copy(camera.position);
  backL.color.copy(isPay ? P.sun : new THREE.Color(1, 0.62, 0.34)); backL.intensity = isPay ? 0 : 1.4 * clamp(S.litY / 30);
  hemi.color.copy(P.mid); hemi.intensity = 0.3;
  if (shot.fist) { const a = FS.anchors(); fillL.position.copy(a.R).addScaledVector(a.up, 0.3).addScaledVector(a.left, -0.35).addScaledVector(a.fwd, 0.5); fillL.intensity = Number(QS.get('fl') || 2.4); fillL.distance = 4; hemi.intensity = 0.1; fillL.decay = 2; fillL.color.set('#ffc890'); backL.intensity = 1.6; backL.color.set('#9aa4ff'); }
  else if (shot.lone) { fillL.position.set(4, 2.6, HALF + 11); fillL.intensity = 9; fillL.distance = 24; fillL.decay = 1.5; fillL.color.set('#ffb070'); }
  else if (shot.hero || shot.crew) { fillL.position.copy(c.tgt).add(V(0, 3, -6)); fillL.intensity = 3; fillL.distance = 18; fillL.decay = 1.5; } else fillL.intensity = 0;
  if (ORB && ORB.lit) { hemi.intensity = 3; hemi.color.set('#ffffff'); fillL.position.copy(camera.position); fillL.intensity = 6; fillL.distance = 0; fillL.decay = 0; fillL.color.set('#ffffff'); }
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

// ---------------------------------------------------------------- type: one card at a time, on the hit; long thoughts run on as follow-on frames
// Inside the studio's safe band (x 60-960 about a centre of 510, last baseline <= 1250: under the top UI, clear of the caption and the buttons),
// never two cards at once (v1 double-exposed HEAVE! over the call before it), never wider than the frame (v1 clipped HUMAN POWER. on both edges).
function drawType(t) {
  const beat = B.beat(t), ci = CARDS.findLastIndex(c => c.b <= beat + 1e-6);
  if (ci < 0) return;
  const c = CARDS[ci], nxt = CARDS[ci + 1], age = (beat - c.b) * B.spb;
  { const g = ctx.createLinearGradient(0, 880, 0, 1330); g.addColorStop(0, 'rgba(4,1,2,0)'); g.addColorStop(0.5, 'rgba(4,1,2,0.42)'); g.addColorStop(1, 'rgba(4,1,2,0.12)'); ctx.fillStyle = g; ctx.fillRect(0, 880, W, 450); }   // a soft floor under the words (a flare or a lit deck behind a card stopped OCR and a phone glance); not a plate
  if (nxt ? beat > c.b + 3.2 : beat > c.b + 2.2) return;                    // a card is cleared after three beats and a bit if nothing follows it
  if (c.text[0] === '~') {                                                   // VOICE c5: a speaker credit ('~' card from the voiced build), small, one or two lines
    const ls = c.text.slice(1).split('/');
    ls.forEach((ln, i) => line(ctx, ln, 510, 1190 + (i - (ls.length - 1) * 0.5) * 70, { family: 'Anton', size: 64, color: C.cream, shadow: 18, maxW: 880, tracking: 0.03 }));
    return;
  }
  const lines = BREAK[c.text] || [c.text], heave = c.text === 'HEAVE!', hook = c.b < 1;
  const big = heave ? (c.b >= 60 ? 330 : 280) : lines.length === 1 ? 168 : lines.length === 2 ? 150 : 128;
  const lh = big * 0.98, k = 1 + (heave ? 0.22 : 0.14) * Math.exp(-age * 30), shake = heave ? Math.exp(-age * 20) * 12 : 0;
  const cx = 510 + (heave ? 0 : 0), base = 1230 - (heave && c.b >= 60 ? 60 : 0);
  ctx.save(); ctx.translate(cx + Math.sin(t * 97) * shake, base - (lines.length - 1) * lh * 0.5 + Math.cos(t * 83) * shake); ctx.scale(k, k);
  lines.forEach((ln, i) => line(ctx, ln, 0, (i - (lines.length - 1) * 0.5) * lh, { family: 'Anton', size: big, color: C.cream, shadow: 22, maxW: 880, tracking: heave ? 0.02 : 0.01 }));
  ctx.restore();
  // v6: the source line (Marx, RISE), small and still, 28 px over the card's cap top at the onset pop (k 1.14; Anton's caps are 0.859 em):
  // y 898 over a two-line card (caps from y 926 on frame 0, 954 once the pop settles), 808 over the three-line one, 1037 over a one-line card
  const src = MARX_CARDS.has(c.text) ? MARX : RISE_CARDS.has(c.text) ? RISE : null;
  if (src) line(ctx, src, 510, Math.round(base - (lines.length - 1) * lh * 0.5 * 2.14 - 1.14 * 0.859 * big - 28),
    { family: 'Plex Mono', size: 30, color: C.cream, alpha: 0.85, shadow: 10, maxW: 880, tracking: 0.06 });
}

// ---------------------------------------------------------------- frame
window.renderFrame = async (t) => {
  const frame = Math.round(t * 30), beat = B.beat(t);
  if (beat >= CLOSE) {
    // the lockup on the piece's own last image (the dawn over the tower and the city, darkened), not a stock card: the loop back to frame 0 is picture into picture
    world(75.6 * B.spb, 75.6); RQ.present(ctx, renderer.domElement, renderer.getContext(), { w: W, h: H });
    ctx.fillStyle = 'rgba(6,1,1,0.66)'; ctx.fillRect(0, 0, W, H);
    const off = lockCanvas || (lockCanvas = document.createElement('canvas')); off.width = W; off.height = H;
    closer(off.getContext('2d'), t - CLOSE * B.spb);
    ctx.save(); ctx.globalCompositeOperation = 'lighten'; ctx.drawImage(off, 0, 0); ctx.restore();
    finish.apply(ctx, frame, { grain: 0.06, vignette: 0.35 }); return; }
  const freeze = beat >= 67 && beat < 68;
  const { imp } = world(freeze ? 67 * B.spb : t, freeze ? 67 : beat);
  RQ.present(ctx, renderer.domElement, renderer.getContext(), { w: W, h: H });
  drawType(t);
  const pay = beat >= 68 && beat < 69 ? Math.exp(-(beat - 68) * 4) : 0;
  finish.apply(ctx, frame, { grain: 0.05, vignette: 0.3, flash: 0.14 * pay + 0.06 * imp });
};
let lockCanvas = null;
window.__lab = { renderer, scene, camera, atm, folk, sky, ground, cityGroup, U, B, world };   // read-only handle for the looks bake (LOOKS c2); renders nothing
window.sceneReady = true;
