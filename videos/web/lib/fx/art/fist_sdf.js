// ART kit / FIST_SDF (cycle 2): the monument fist sculpted as a signed distance field and raymarched in one fragment
// shader. The c1 fist was HUMAN's skinned hand at fistScale 1.35: sausage fingers, an open thumb, no knuckles, no
// tendons (judge: "a toy"). This one is built the way a sculptor blocks a hand, by PLANES and MASSES:
//  - Bridgman, Constructive Anatomy (1920): the hand is two masses, the hand "bevelled from knuckles to wrist on the
//    edge" and the thumb wedged against it; in a fist the proximal phalanges make one flat front plane.
//  - Robert Graham, Monument to Joe Louis (Detroit, 1986): the read comes from the knuckle mass and the forearm's weight,
//    not from finger detail; cast bronze with a dark patina in the recesses and rubbed warm high points.
// Anatomy in the field (cm): a tapered, bevelled metacarpal block; four MCP heads in an ARCH (middle highest, little
// lowest and set back); curled fingers (proximal forward, middle down, distal tucked) with creases kept by a small
// smooth-union radius; a CLOSED thumb lying across the middle phalanges of index and middle with its tip tucked;
// thenar and hypothenar masses; extensor tendons fanning wrist -> knuckles as ridges; two dorsal veins; the ulnar
// styloid bump; a forearm wedge with brachioradialis mass toward the elbow; a rolled sleeve with folds.
// Pose: gesture.js ROTFRONT (bent elbow, forearm vertical, fist at the brow beside the head), checked by measureArm.
//
//   import { fistShot, fistPoseCheck } from '../lib/fx/art/fist_sdf.js';
//   const s = fistShot(st.r, { W, H, yaw: 0.6, pitch: 0.1, key: 'rake' }); s.frame(t) -> canvas (exposed)
import * as THREE from 'three';
import { FilmExposure } from './exposure.js';
import { GESTURES, gestureDirs, measureArm } from '../gesture.js';

const FS = /* glsl */`
precision highp float;
uniform vec2 uRes; uniform mat3 uRot; uniform vec3 uCam; uniform float uFov, uT, uKeyA, uKeyE, uKey, uFill, uRim, uPatina, uBg; uniform vec3 uBgC;
varying vec2 vUv;
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float smax(float a, float b, float k){ return -smin(-a, -b, k); }
float cap(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
float cap2(vec3 p, vec3 a, vec3 b, float ra, float rb){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - mix(ra, rb, h); }
// c2b: a phalanx is not a tube: an L4 cross-section gives the squared sides a sculptor cuts (Bridgman's planes)
float cap2s(vec3 p, vec3 a, vec3 b, float ra, float rb){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); vec3 q = pa - ba * h; q *= q; return pow(dot(q, q), 0.25) - mix(ra, rb, h); }
float rbox(vec3 p, vec3 b, float r){ vec3 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
float ell(vec3 p, vec3 r){ float k0 = length(p / r), k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / k1; }
float hsh(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hsh(i), hsh(i + vec3(1,0,0)), f.x), mix(hsh(i + vec3(0,1,0)), hsh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hsh(i + vec3(0,0,1)), hsh(i + vec3(1,0,1)), f.x), mix(hsh(i + vec3(0,1,1)), hsh(i + vec3(1,1,1)), f.x), f.y), f.z); }
// ---- the fist, in cm; y up the forearm axis, +z the palm side (the curled fingers face +z), +x the thumb side
const vec4 K[4] = vec4[4](vec4(2.85, 9.35, -0.35, 1.25), vec4(0.95, 9.75, -0.3, 1.32), vec4(-0.95, 9.45, -0.4, 1.22), vec4(-2.75, 8.8, -0.75, 1.1));  // MCP heads: index, middle, ring, little (arch)
const vec4 FL[4] = vec4[4](vec4(3.8, 2.4, 1.1, 0.0), vec4(4.2, 2.6, 1.14, 0.0), vec4(3.9, 2.4, 1.08, 0.0), vec4(3.2, 2.0, 0.96, 0.0));             // proximal, middle length, radius
float fingers(vec3 p, out float crease){
  float d = 1e9; crease = 1e9;
  for (int i = 0; i < 4; i++) {
    vec3 k = K[i].xyz; float r = FL[i].z;
    vec3 a = k + vec3(0.0, 0.25, 0.1), b = a + vec3(0.0, 0.15, FL[i].x);                 // proximal: forward (the flat top plane)
    vec3 c = b + vec3(0.0, -FL[i].y, 0.25);                                                // middle: down the front
    vec3 e = c + vec3(0.0, -0.4, -1.9);                                                    // distal: tucked into the palm
    float f = cap2s(p, a, b, r * 0.98, r * 0.93); f = smin(f, cap2s(p, b, c, r * 0.93, r * 0.86), 0.3); f = smin(f, cap2(p, c, e, r * 0.86, r * 0.8), 0.3);
    // the knuckle of the PIP joint: a hard corner with a little bump
    f = smin(f, length(p - b - vec3(0.0, 0.2, 0.2)) - r * 1.02, 0.25);
    crease = min(crease, abs(f));
    d = smin(d, f, 0.18);                           // fingers pressed together: a shallow crease, not a gap
  }
  return d;
}
float thumb(vec3 p){
  vec3 m0 = vec3(3.2, 1.2, 0.6), m1 = vec3(4.4, 4.6, 2.2), p1 = vec3(4.0, 5.4, 3.9), p2 = vec3(1.9, 5.7, 5.05), p3 = vec3(0.1, 5.3, 4.85);
  float d = cap2(p, m0, m1, 1.45, 1.25);
  d = smin(d, cap2(p, m1, p1, 1.25, 1.12), 0.6);
  d = smin(d, cap2(p, p1, p2, 1.12, 1.02), 0.4);                                            // across the middle phalanges
  d = smin(d, cap2(p, p2, p3, 1.02, 0.85), 0.3);                                            // tip tucked
  d = smin(d, length(p - p2 - vec3(0.0, 0.25, 0.15)) - 1.05, 0.3);                         // the IP knuckle
  return d;
}
float veinN(vec3 p){ return vn(p * 0.8) ; }
float fist(vec3 p, out float mat){
  mat = 0.0;
  // metacarpal block: tapered toward the wrist, bevelled on the edges (Bridgman), arched across the back
  float taper = mix(0.78, 1.0, clamp(p.y / 9.0, 0.0, 1.0));
  vec3 q = p - vec3(0.2, 4.6, -0.35); q.x /= taper; q.z += 0.06 * q.x * q.x;
  float d = rbox(q, vec3(3.55, 4.4, 1.35), 1.05);
  d = smax(d, dot(p - vec3(-3.9, 4.0, 0.0), normalize(vec3(-1.0, 0.0, -0.55))), 0.6);  // the bevelled little-finger edge
  // knuckle heads
  for (int i = 0; i < 4; i++) d = smin(d, length(p - K[i].xyz) - K[i].w, 0.55);
  // thenar and hypothenar masses (the palm's two pads)
  d = smin(d, ell(p - vec3(2.9, 2.8, 1.8), vec3(2.2, 3.1, 2.3)), 0.8);
  d = smin(d, ell(p - vec3(-3.1, 3.0, 0.9), vec3(1.3, 3.2, 1.4)), 0.7);
  float cr; float fg = fingers(p, cr);
  d = smin(d, fg, 0.28);
  d = smin(d, thumb(p), 0.35);
  // extensor tendons: ridges from the wrist to each knuckle on the back (-z)
  vec3 w0 = vec3(0.3, -0.5, -1.55);
  for (int i = 0; i < 4; i++) { vec3 kk = K[i].xyz + vec3(0.0, -0.8, -0.95); d = smin(d, cap(p, w0 + vec3(float(i) * 0.3 - 0.45, 0.0, 0.0), kk, 0.3), 0.55); }
  // dorsal veins (wavy, slightly raised)
  vec3 pv = p; pv.x += 0.35 * sin(p.y * 0.9);
  d = smin(d, cap(pv, vec3(-1.6, -6.0, -1.9), vec3(-2.2, 5.0, -1.75), 0.2), 0.4);
  d = smin(d, cap(pv, vec3(1.6, -5.0, -1.9), vec3(0.4, 6.0, -1.72), 0.18), 0.4);
  // wrist and forearm: an elliptical wedge, wider and rounder toward the elbow; brachioradialis mass on the thumb side
  float y = p.y; float u = clamp(-y / 26.0, 0.0, 1.0);
  float su = u * (2.0 - u); vec2 rr = vec2(mix(3.3, 5.6, su), mix(2.4, 4.8, su));   // c2b: smooth from the wrist (sqrt had an infinite slope there: a ledge)        // monumental: the forearm carries the weight
  vec3 pa = p - vec3(0.25 + 0.8 * u, 0.0, -0.35 + 0.3 * u);
  float fa = length(pa.xz / rr) - 1.0; fa *= min(rr.x, rr.y);
  fa = smax(fa, y - 0.6, 1.2);   // c2b: soft, so the wrist does not read as a cuff seam
  d = smin(d, fa, 1.4);
  d = smin(d, ell(p - vec3(3.3, -18.5, 0.3), vec3(2.2, 7.5, 2.4)), 2.2);                  // brachioradialis
  d = smin(d, ell(p - vec3(-2.3, -16.0, -1.3), vec3(2.3, 7.0, 2.3)), 2.0);                // flexor/extensor mass
  d = smin(d, length(p - vec3(-2.9, -0.9, -1.0)) - 0.5, 0.9);                            // ulnar styloid (a bump, not a ball)
  // the rolled sleeve: a folded cloth roll and the sleeve below it
  float sy = y + 21.5; float roll = length(vec2(length(p.xz * vec2(0.86, 1.0)) - 5.3, sy)) - 1.55 - 0.35 * vn(p * 0.9);
  float sleeve = max(length(p.xz * vec2(0.86, 1.0)) - 5.6 - 0.4 * vn(p * vec3(0.7, 0.2, 0.7)), sy);
  float cloth = smin(roll, sleeve, 0.8);
  if (cloth < d) mat = 1.0;
  d = min(d, cloth);
  d = max(d, -y - 34.0);
  return d;
}
float map(vec3 p){ float m; return fist(p, m); }
vec3 nrm(vec3 p){ vec2 e = vec2(0.02, 0.0); return normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx))); }
float ao(vec3 p, vec3 n){ float o = 0.0, s = 1.0; for (int i = 1; i <= 5; i++) { float h = 0.25 * float(i); o += (h - map(p + n * h)) * s; s *= 0.6; } return clamp(1.0 - 0.9 * o, 0.0, 1.0); }
float cavity(vec3 p, vec3 n){ float c = map(p + n * 0.12) - 0.12 + (map(p - n * 0.12) + 0.12); return c; }
float shadow(vec3 p, vec3 l){ float r = 1.0, t = 0.08; for (int i = 0; i < 40; i++) { float h = map(p + l * t); r = min(r, 10.0 * h / t); t += clamp(h, 0.05, 1.5); if (r < 0.01 || t > 40.0) break; } return clamp(r, 0.0, 1.0); }
float ggx(vec3 n, vec3 v, vec3 l, float rough){ vec3 h = normalize(v + l); float a = rough * rough, nh = max(dot(n, h), 0.0), d = nh * nh * (a * a - 1.0) + 1.0; return a * a / (3.14159 * d * d); }
void main(){
  vec2 uv = (vUv * 2.0 - 1.0) * vec2(uRes.x / uRes.y, 1.0);
  vec3 ro = uCam, rd = normalize(uRot * vec3(uv * tan(uFov * 0.5), -1.0));
  // bounds: a capsule round the fist and forearm
  vec3 col = uBgC * uBg;
  float t = 0.0; bool hit = false;
  { vec3 oc = ro - vec3(0.0, -10.0, 0.0); float b = dot(oc, rd), c = dot(oc, oc) - 30.0 * 30.0, h = b * b - c; if (h > 0.0) { t = max(0.0, -b - sqrt(h)); float tEnd = -b + sqrt(h);
    for (int i = 0; i < 110; i++) { float d = map(ro + rd * t); if (d < 0.004 * t * 0.02 + 0.006) { hit = true; break; } t += d * 0.9; if (t > tEnd) break; } } }
  if (hit) {
    vec3 p = ro + rd * t; float m; fist(p, m); vec3 n = nrm(p), v = -rd;
    n = normalize(n + 0.07 * (vec3(vn(p * 2.3), vn(p * 2.3 + 17.0), vn(p * 2.3 + 41.0)) - 0.5));   // c2b: the cast surface is not polished: a faint hammered/chased relief
    float a = ao(p, n), cv = clamp(0.5 + 3.5 * cavity(p, n), 0.0, 1.0);          // cv < 0.5 in recesses, > 0.5 on ridges
    vec3 L = normalize(vec3(sin(uKeyA) * cos(uKeyE), sin(uKeyE), cos(uKeyA) * cos(uKeyE)));
    L = uRot * L;                                                                // the key is set relative to the camera
    vec3 L2 = uRot * normalize(vec3(-0.7, -0.2, -0.6));                          // the bounce / rim from behind
    float sh = shadow(p + n * 0.05, L);
    // bronze: patina (brown-green) in the recesses, rubbed warm on the high points, chase marks in the metal
    float pat = clamp((1.0 - a) * 1.3 + (0.5 - cv) * 2.0 + 0.6 * vn(p * 0.9) + 0.25 * vn(p * 4.1) - 0.2, 0.0, 1.0) * uPatina;   // c2b: less AO in the patina (its iso-bands read as wood grain)
    float rub = clamp((cv - 0.55) * 3.0 + 0.3 * (vn(p * 0.6) - 0.5), 0.0, 1.0);
    vec3 bronze = mix(vec3(0.42, 0.24, 0.11), vec3(0.78, 0.5, 0.26), rub);
    vec3 patC = mix(vec3(0.09, 0.1, 0.06), vec3(0.16, 0.2, 0.14), vn(p * 3.0));
    vec3 base = mix(bronze, patC, pat);
    float rough = mix(0.5, 0.85, pat) + 0.1 * vn(p * 8.0);   // c2b: satin, not plastic
    float chase = smoothstep(0.62, 0.64, vn(vec3(p.x * 2.0, p.y * 9.0, p.z * 2.0))) * 0.05;
    float metal = 1.0 - pat * 0.8;
    if (m > 0.5) { base = mix(vec3(0.3, 0.19, 0.1), vec3(0.2, 0.12, 0.07), vn(p * 2.0)); rough = 0.8; metal = 0.6; }   // the cast sleeve: same bronze, duller
    float nl = max(dot(n, L), 0.0), nl2 = max(dot(n, L2), 0.0);
    vec3 F0 = mix(vec3(0.04), base, metal);
    vec3 spec = F0 * ggx(n, v, L, rough) * nl * 0.75;
    vec3 diff = base * (1.0 - metal * 0.85) / 3.14159 * nl;
    col = (diff + spec) * uKey * sh;
    col += (base * 0.25 + F0 * ggx(n, v, L2, rough) * 0.6) * nl2 * uRim;
    col += base * uFill * a * (0.5 + 0.5 * n.y);                                  // sky fill
    col *= 1.0 - chase;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// the pose: ROTFRONT from gesture.js, measured against SAFETY (bent elbow; forearm vertical; fist at the brow)
export function fistPoseCheck() {
  const d = gestureDirs('ROTFRONT', -1), S = [-0.185, 1.46, -0.02], E = S.map((v, i) => v + d.u[i] * 0.287), Wr = E.map((v, i) => v + d.f[i] * 0.257);
  const proj = p => [540 + (Array.isArray(p) ? p[0] : p.x) * 900, 1920 - (Array.isArray(p) ? p[1] : p.y) * 900];
  const m = measureArm({ S, E, Wr, head: [0, 1.66, 0], fwd: [0, 0, 1] }, proj, () => 900, 0.1);
  return { gesture: 'ROTFRONT', forearm: d.f.map(v => +v.toFixed(3)), ...m };
}

export function fistShot(renderer, { W = 1080, H = 1920, yaw = 0.5, pitch = 0.1, dist = 66, fov = 34, keyA = 1.15, keyE = 0.45, key = 7, fill = 0.5, rim = 2.2, patina = 1,
  bg = '#15110F', bgK = 1, curve = 'technicolor38', exposure = 1, target = [0.5, -2.0, 0], roll = 0 } = {}) {
  const fd = fistPoseCheck().forearm;   // the forearm axis in the body frame: the sculpture stands on it
  const uni = { uRes: { value: new THREE.Vector2(W, H) }, uRot: { value: new THREE.Matrix3() }, uCam: { value: new THREE.Vector3() }, uFov: { value: fov * Math.PI / 180 }, uT: { value: 0 },
    uKeyA: { value: keyA }, uKeyE: { value: keyE }, uKey: { value: key }, uFill: { value: fill }, uRim: { value: rim }, uPatina: { value: patina }, uBg: { value: bgK }, uBgC: { value: new THREE.Color(bg) } };
  const mat = new THREE.ShaderMaterial({ uniforms: uni, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: FS, depthTest: false, depthWrite: false });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const q = new THREE.Mesh(g, mat); q.frustumCulled = false; const scene = new THREE.Scene(); scene.add(q); const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fx = new FilmExposure(renderer, { W, H, curve, exposure, halation: 0.25, veil: 0.03, grain: 0.3, samples: 0 });
  const setView = (yw, pt) => {
    const tg = new THREE.Vector3(...target), c = new THREE.Vector3(Math.sin(yw) * Math.cos(pt), Math.sin(pt), Math.cos(yw) * Math.cos(pt)).multiplyScalar(dist).add(tg);
    const m = new THREE.Matrix4().lookAt(c, tg, new THREE.Vector3(Math.sin(roll), Math.cos(roll), 0)); uni.uRot.value.setFromMatrix4(m); uni.uCam.value.copy(c);
  };
  setView(yaw, pitch);
  const out = document.createElement('canvas'); out.width = W; out.height = H; const o = out.getContext('2d');
  return { fx, uni, pose: fistPoseCheck(), forearm: fd, setView, frame(t) { uni.uT.value = t; const c = fx.render(scene, cam, t); o.drawImage(c, 0, 0); return out; } };
}
