// POLARISCOPE (Oct 2026; OBJECTIVE ep.1 AT REST): photoelasticity computed, not painted. A transparent body's stress field seen through a
// plane or circular polariscope, along REFRACTED rays, at several wavelengths, through a thin-lens camera. WebGL2 (three.js); the same
// maths as polariscope_ref.js, which node checks against closed-form physics (web/labs/objective/polariscope_test.mjs T1-T8).
//
//   import { Polariscope } from '../lib/fx/objective/polariscope.js';
//   const P = new Polariscope(renderer, { w: 1080, h: 1920, n: 1.52, C: 2.7e-12, kind: 'circular', field: 'dark',
//                                         band: { l0: 589.3e-9, fwhm: 10e-9 }, lambdas: 5, lensSamples: 16 });
//   P.body({ CL: centreline(), head: 6, blend: 1.4 })      // the drop (polariscope_ref.js DROP): a head sphere and a swept, tapered tail
//   P.stress({ sigmaS: -560e6 })                            // the analytic residual field (the quench bake replaces it: bake.js)
//   P.environment(cubeTexture, { gain, toWorld, window })   // what the source side shows: the world plate, filtered to the band here
//   P.analyser(a | slide)                                    // 0..1 in the path, or a switch.js Slide (the defocused edge, per pixel)
//   P.fracture({ tI, sEnter, v, entry, sHead })             // stress relaxed and light depolarised behind the crack front (the glitter)
//   P.formation({ freeze, glow, tailMax, offset, nMed, bubbles })   // the quench, closed form (freeze front from the skin inward)
//   P.camera(bench, { pos, target, up })                    // bench.js thin lens; positions in the drop's millimetres
//   P.render(t) -> THREE.Texture                             // linear RGB: band radiance x the band's colour (+ the blob's own glow)
//
// Per pixel and lens sample: march the SDF, Snell at n with unpolarised Fresnel and total internal reflection; inside, the stress
// tensor at each segment's midpoint projected on the plane normal to the ray gives a linear retarder (2 pi / lambda) C (s1' - s2') ds at
// the in-plane angle phi; the 2x2 complex Jones matrices multiply in the light's order in a parallel-transported frame, at five
// wavelengths across the filter's Gaussian band (Gauss-Hermite nodes), so contrast falls off at high orders as it really does. The
// train: polariser 0, quarter-wave +45, specimen, quarter-wave -45, analyser 90 (dark field). Light from depolarising things (broken
// glass, the room's reflections) passes the crossed analyser at half. Rays that miss the drop see the window out of focus: the thin lens
// is integrated by the lens samples, and for the background at infinity by the cube map's mip at the bench's own blur, so no lens-sample
// ghosts. Cost on a V100: about 0.05-0.2 s a lens sample at 1080x1920 (each sample is its own draw, accumulated).
import * as THREE from 'three';
import { bandSamples, C_SODALIME, N_GLASS, DROP, centreline } from './polariscope_ref.js';
import { bandColour, bandFromRGB } from './spectral.js';
import { SWITCH_GLSL } from './switch.js';

export const NLINE = 48;          // centreline segments (uniform array of NLINE + 1 points)
export const NGROUP = 6;          // bounding groups of 8 segments
export const NBUB = 10;           // steam bubbles in the formation shot

const VERT = /* glsl */`
in vec3 position;
out vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const FRAG = /* glsl */`
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uRes;
uniform vec4 uSample;            // xy: pixel jitter (px), zw: lens sample on the unit disc
uniform float uW;                // this sample's weight (1 / lens samples)
uniform vec3 uCamPos, uCamR, uCamU, uCamF;
uniform vec4 uFocal;             // focus distance (mm), half width and half height at the focal plane (mm), aperture radius (mm)
uniform vec4 uHead;              // centre (mm), radius
uniform vec4 uLine[${NLINE + 1}];         // centreline: xyz, arc length s (mm)
uniform vec4 uGroup[${NGROUP}];          // bounding spheres of 8 segments each
uniform vec4 uTail;              // blend (mm), tail on (0/1), tail max arc (mm), tail taper (mm)
uniform vec4 uStress;            // sigma_s (MPa), freeze 0..1, tail-thin factor on, unused
uniform float uN, uNmed;         // glass index, medium index
uniform float uK[5], uLW[5];     // retardance per MPa per mm at each wavelength; band weights
uniform vec4 uTrain;             // kind (0 circular, 1 plane), field (0 dark, 1 light), theta (plane), analyser global 0..1
uniform vec4 uSlide; uniform float uSlideR; uniform float uSlideOn;   // the analyser's defocused edge (switch.js)
uniform vec3 uBandRGB;
uniform samplerCube uEnv;
uniform mat3 uToWorld;           // drop frame -> world (for the environment)
uniform vec4 uEnvGain;           // x: gain (band), y: background lod, z: drop lod, w: band mix (1: the band; 0: the world's own colour)
uniform vec4 uWindow;            // the window's aperture in the drop frame: centre xy (mm), plane z (mm), radius (mm)
uniform vec4 uRoom;              // the sodium practical as the room sees it: direction xyz (unit, drop frame), angular radius (rad)
uniform float uRoomL;            // its radiance (band)
uniform vec4 uFrac;              // tI (us), sEnter (mm), v (mm/us), on
uniform vec4 uEntry;             // where the centreline meets the head's surface (mm), sHead (mm)
uniform vec4 uFrac2;             // front width (us), crack brightness, glitter gain, depol per mm
uniform float uGhost;            // the fractured drop's presence (1 .. 0 as it bursts)
uniform vec3 uOffset;            // the drop's offset in the shot (mm): the blob falling
uniform vec4 uGlow;              // rgb glow (linear) per mm of path, on
uniform vec4 uBub[${NBUB}];               // steam bubbles: centre (mm), radius (mm)
uniform float uSteps;            // max march steps
uniform vec4 uGap;               // the tail broken through: no glass between arc sA and sB (x, y), on (z)
uniform vec4 uLoad;              // a point load on the tail: contact point (mm), contact stress amplitude (MPa)
uniform vec4 uLoad2;             // the load's arc s (mm), bending amplitude (4F/pi, N), contact radius a (mm), on
uniform float uCrackL;           // the crack surfaces' own scatter of the room's sodium light (band radiance)
uniform float uGlitK;            // the glitter's cell size scale (1: the high-speed shot's; smaller for a close shot)
uniform vec4 uDiss;              // behind the front: start (us), span (us), cell (mm), on
uniform vec4 uStrike;            // the one strike's contact (mm) and amplitude (MPa)
uniform vec4 uStrike2;           // its contact radius (mm), unused, unused, on
uniform vec4 uAbsorb;            // glass absorption per mm (rgb), on (w): the faint green edge of a thick body
uniform vec4 uWave;              // the strike's propagating wave: origin (mm), amplitude (MPa); amplitude 0 = off
uniform vec4 uWave2;             // the wave: seconds since impact, speed (mm/s), width (mm), decay (mm)
${SWITCH_GLSL}

float rTail(float s){ return s >= 8.0 ? 0.3 + 1.0 * exp(-(s - 8.0) / 27.55) : 1.3 + 0.55 * (8.0 - s); }
float tailScale(float r){ return clamp(0.25 + 0.4 * r, 0.3, 1.0); }

// the nearest point on the centreline: returns squared distance, fills arc s, axis point c and tangent t
float nearestLine(vec3 p, out float s, out vec3 c, out vec3 t){
  float best = 1e18; s = 0.0; c = vec3(0.0); t = vec3(0.0, 1.0, 0.0);
  for (int g = 0; g < ${NGROUP}; g++) {
    vec4 G = uGroup[g];
    float lb = max(0.0, length(p - G.xyz) - G.w);
    if (lb * lb > best) continue;
    for (int k = 0; k < 8; k++) {
      int i = g * 8 + k;
      vec4 A = uLine[i], B = uLine[i + 1];
      if (A.w > uTail.z) continue;
      vec3 ab = B.xyz - A.xyz; float L2 = dot(ab, ab);
      float u = clamp(dot(p - A.xyz, ab) / L2, 0.0, 1.0);
      vec3 q = A.xyz + ab * u, d = p - q; float dd = dot(d, d);
      if (dd < best) { best = dd; s = A.w + u * (B.w - A.w); c = q; t = ab * inversesqrt(L2); }
    }
  }
  return best;
}
// the drop's SDF with the smooth-union weight h (1: the head) and the tail's nearest point
float dropSDF(vec3 p, out float h, out float s, out vec3 c, out vec3 t){
  float dh = length(p - uHead.xyz) - uHead.w;
  h = 1.0; s = 0.0; c = vec3(0.0); t = vec3(0.0, 1.0, 0.0);
  if (uTail.y < 0.5) return dh;
  float dd = nearestLine(p, s, c, t);
  float r = rTail(s) * clamp((uTail.z - s) / max(uTail.w, 1e-3), 0.0, 1.0);
  if (uGap.z > 0.5 && s > uGap.x + 1e-4 && s < uGap.y - 1e-4) r = -1.0;
  float dt = sqrt(dd) - r;
  float k = uTail.x;
  h = clamp(0.5 + 0.5 * (dt - dh) / k, 0.0, 1.0);
  return mix(dt, dh, h) - k * h * (1.0 - h);
}
float sdf(vec3 p){ float h, s; vec3 c, t; return dropSDF(p, h, s, c, t); }
vec3 sdfNormal(vec3 p){
  const float e = 1e-3;
  return normalize(vec3(sdf(p + vec3(e, 0, 0)) - sdf(p - vec3(e, 0, 0)), sdf(p + vec3(0, e, 0)) - sdf(p - vec3(0, e, 0)), sdf(p + vec3(0, 0, e)) - sdf(p - vec3(0, 0, e))));
}
float sstep(float a, float b, float x){ float u = clamp((x - a) / (b - a), 0.0, 1.0); return u * u * (3.0 - 2.0 * u); }
float frozen(float rn, float f){ return f >= 1.0 ? 1.0 : sstep(1.0 - f - 0.12, 1.0 - f + 0.12, rn) * sstep(0.0, 0.25, f); }
// the crack front's arrival time (us) at p
float frontTime(vec3 p, float s, bool inTail){
  if (inTail && s > uFrac.y + 0.02 && uGap.z > 0.5) return 1e9;   // past the break: the piece that falls away does not run
  if (inTail && s > uEntry.w) return (uFrac.y - s) / uFrac.z;
  vec3 dv = p - uEntry.xyz; float d = length(dv); vec3 dir = dv / max(d, 1e-6);
  float wob = 0.35 * sin(7.3 * dir.x + 3.1 * dir.y + 5.7 * dir.z + 1.0);
  return (uFrac.y - uEntry.w) / uFrac.z + d / uFrac.z * (1.0 + 0.18 * wob);
}
float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
// the secondary principal stresses of the drop's field at p, projected on (e1, e2): returns (s11, s22, s12) in MPa
vec3 projectedStress(vec3 p, vec3 e1, vec3 e2, float h, float s, vec3 c, vec3 t){
  float sS = uStress.x, f = uStress.y;
  vec3 P = vec3(0.0);
  if (h > 1e-4) {
    vec3 d = p - uHead.xyz; float r = length(d), a = uHead.w, q = r * r / (a * a);
    float sr = sS * (q - 1.0), st = sS * (2.0 * q - 1.0), k = (sr - st) * h * frozen(r / a, f);
    vec3 u = d / max(r, 1e-6); float u1 = dot(u, e1), u2 = dot(u, e2);
    P += vec3(st * h * frozen(r / a, f)) * vec3(1.0, 1.0, 0.0) + k * vec3(u1 * u1, u2 * u2, u1 * u2);
    if (uStrike2.w > 0.5) { vec3 dc = p - uStrike.xyz; float dl = length(dc), r2 = uStrike2.x * uStrike2.x;
      vec3 uc = dc / max(dl, 1e-5); float c1 = dot(uc, e1), c2 = dot(uc, e2);
      float sc = -uStrike.w * exp(-dl * dl / max(r2, 1e-6));
      P += sc * vec3(c1 * c1 - 0.5, c2 * c2 - 0.5, c1 * c2); }
  }
  if (h < 1.0 - 1e-4 && uTail.y > 0.5) {
    vec3 rv = p - c; float rho = length(rv), R = max(rTail(s), 1e-3), q = rho * rho / (R * R), ss = sS * tailScale(R);
    float sz = ss * (2.0 * q - 1.0), sth = 0.5 * ss * (3.0 * q - 1.0), srh = 0.5 * ss * (q - 1.0), w = (1.0 - h) * frozen(min(1.0, rho / R), min(1.0, f * 3.0));
    vec3 rh = rho > 1e-6 ? rv / rho : normalize(cross(t, abs(t.x) < 0.9 ? vec3(1, 0, 0) : vec3(0, 1, 0)));
    vec3 th = cross(t, rh);
    float t1 = dot(t, e1), t2 = dot(t, e2), r1 = dot(rh, e1), r2 = dot(rh, e2), h1 = dot(th, e1), h2 = dot(th, e2);
    P += w * (sz * vec3(t1 * t1, t2 * t2, t1 * t2) + srh * vec3(r1 * r1, r2 * r2, r1 * r2) + sth * vec3(h1 * h1, h2 * h2, h1 * h2));
    // a point load on the tail (the ball): the cantilever's bending stress between the head and the load (sigma = M y / I, y up),
    // and the contact's own concentration round the touching point (a radial field falling off past the contact radius)
    if (uLoad2.w > 0.5) {
      float lever = max(0.0, uLoad2.x - max(s, 6.0));
      float sb = uLoad2.y * lever * rv.y / (R * R * R * R);
      P += (1.0 - h) * sb * vec3(t1 * t1, t2 * t2, t1 * t2);
      vec3 dc = p - uLoad.xyz; float dl = length(dc), a2 = uLoad2.z * uLoad2.z;
      vec3 uc = dc / max(dl, 1e-5); float c1 = dot(uc, e1), c2 = dot(uc, e2);
      float sc = -uLoad.w * a2 / (dl * dl + a2);
      P += (1.0 - h) * sc * vec3(c1 * c1, c2 * c2, c1 * c2);
    }
  }
  // the strike's wave leaves the contact and crosses the body: a radial pulse whose fringes crowd the skin and slow in the core.
  // The film's clock is slowed (the crack front runs on the same instrument clock), so the wave is legible rather than an instant.
  if (abs(uWave.w) > 1e-6) {
    vec3 dv = p - uWave.xyz; float r = length(dv);
    float front = r - uWave2.y * uWave2.x, w = max(uWave2.z, 1e-3);
    float pulse = 1.6487213 * (front / w) * exp(-0.5 * front * front / (w * w));
    float amp = uWave.w * pulse * exp(-max(r, 0.0) / max(uWave2.w, 1e-3));
    vec3 uw = dv / max(r, 1e-6); float q1 = dot(uw, e1), q2 = dot(uw, e2);
    P += amp * vec3(q1 * q1, q2 * q2, q1 * q2);
  }
  return P;
}
// one Jones step: M <- M * R(delta, phi), M as two vec4 (a, b | c, d complex)
void jstep(inout vec4 m0, inout vec4 m1, float c, float s, float c2, float s2){
  vec4 a = m0, b = m1;
  m0 = vec4(a.x * c + a.y * s * c2 + a.w * s * s2, a.y * c - a.x * s * c2 - a.z * s * s2,
            a.y * s * s2 + a.z * c - a.w * s * c2, -a.x * s * s2 + a.w * c + a.z * s * c2);
  m1 = vec4(b.x * c + b.y * s * c2 + b.w * s * s2, b.y * c - b.x * s * c2 - b.z * s * s2,
            b.y * s * s2 + b.z * c - b.w * s * c2, -b.x * s * s2 + b.w * c + b.z * s * c2);
}
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
// detector intensity for a specimen M (rows m0 = (a, b), m1 = (c, d)), analyser amount an, source frame angle beta
float train(vec4 m0, vec4 m1, float an, float beta){
  vec2 E1, E2;
  if (uTrain.x < 0.5) {
    // polariser at beta, quarter-wave at beta + 45 deg: [[c - i s cos2t, -i s sin2t], [-i s sin2t, c + i s cos2t]], c = s = 1/sqrt2
    float th = beta + 0.78539816, c2 = cos(2.0 * th), s2 = sin(2.0 * th), k = 0.70710678, cb = cos(beta), sb = sin(beta);
    E1 = vec2(k * cb, -k * c2 * cb) + vec2(0.0, -k * s2 * sb);
    E2 = vec2(0.0, -k * s2 * cb) + vec2(k * sb, k * c2 * sb);
  } else { E1 = vec2(cos(uTrain.z + beta), 0.0); E2 = vec2(sin(uTrain.z + beta), 0.0); }
  vec2 v1 = cmul(m0.xy, E1) + cmul(m0.zw, E2), v2 = cmul(m1.xy, E1) + cmul(m1.zw, E2);
  float open = dot(v1, v1) + dot(v2, v2), det;
  if (uTrain.x < 0.5) {
    // the camera's quarter-wave at -45 deg: [[k, i k], [i k, k]]; then the analyser along e2 (dark) or e1 (light)
    vec2 w1 = 0.70710678 * (v1 + vec2(-v2.y, v2.x)), w2 = 0.70710678 * (vec2(-v1.y, v1.x) + v2);
    det = uTrain.y < 0.5 ? dot(w2, w2) : dot(w1, w1);
  } else {
    float a = uTrain.z + (uTrain.y < 0.5 ? 1.57079633 : 0.0); vec2 ax = vec2(cos(a), sin(a));
    vec2 w = v1 * ax.x + v2 * ax.y; det = dot(w, w);
  }
  return an * det + (1.0 - an) * open;
}
float fresnelU(float ci, float n1, float n2){
  float sint = n1 / n2 * sqrt(max(0.0, 1.0 - ci * ci)); if (sint >= 1.0) return 1.0;
  float ct = sqrt(1.0 - sint * sint), rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct), rp = (n1 * ct - n2 * ci) / (n1 * ct + n2 * ci);
  return 0.5 * (rs * rs + rp * rp);
}
vec3 transport(vec3 e, vec3 d0, vec3 d1){
  vec3 ax = cross(d0, d1); float s = length(ax), c = dot(d0, d1); if (s < 1e-9) return e;
  vec3 k = ax / s; float th = atan(s, c), ct = cos(th), st = sin(th);
  return e * ct + cross(k, e) * st + k * dot(k, e) * (1.0 - ct);
}
vec3 labE1(vec3 d){ vec3 e = vec3(1, 0, 0) - d * d.x; if (length(e) < 1e-6) e = vec3(0, 1, 0) - d * d.y; return normalize(e); }
// the source side as the ray sees it: the world through the window's aperture, filtered to the band (or in its own colour), at a lod
vec3 world(vec3 o, vec3 d, float lod){
  // the window plane (behind the drop); outside the aperture the blackout board
  if (d.z < -1e-4) { float tt = (uWindow.z - o.z) / d.z; vec2 q = o.xy + d.xy * tt - uWindow.xy; if (dot(q, q) > uWindow.w * uWindow.w) return vec3(0.0); }
  else return vec3(0.0);
  vec3 c = textureLod(uEnv, uToWorld * d, lod).rgb * uEnvGain.x;
  return mix(c, uBandRGB * dot(c, vec3(${bandFromRGB.map(x => x.toFixed(4)).join(', ')})), uEnvGain.w);
}
float roomL(vec3 d){ float a = acos(clamp(dot(d, uRoom.xyz), -1.0, 1.0)); return uRoomL * (1.0 - sstep(uRoom.w * 0.6, uRoom.w, a)) + 0.0015 * uRoomL * max(0.0, d.y); }

void main(){
  vec2 px = vUv * uRes + uSample.xy;
  vec2 ndc = vec2(px.x / uRes.x * 2.0 - 1.0, px.y / uRes.y * 2.0 - 1.0);
  vec3 Pf = uCamPos + uCamF * uFocal.x + uCamR * (ndc.x * uFocal.y) + uCamU * (ndc.y * uFocal.z);
  vec3 Lp = uCamPos + (uCamR * uSample.z + uCamU * uSample.w) * uFocal.w;
  vec3 o = Lp - uOffset, d = normalize(Pf - Lp);
  vec3 dPin = normalize(Pf - uCamPos);
  // the analyser at this pixel: the global state times the slide's defocused edge (pixel y down for the slide)
  float an = uTrain.w; if (uSlideOn > 0.5) an *= slideAmount(uSlide, uSlideR, vec2(px.x, uRes.y - px.y));
  vec4 J0[5], J1[5];
  for (int k = 0; k < 5; k++) { J0[k] = vec4(1, 0, 0, 0); J1[k] = vec4(0, 0, 1, 0); }
  vec3 e1 = labE1(d);
  float T = 1.0, depolL = 0.0, glitter = -1.0, crack = 0.0, hit = 0.0, tirN = 0.0, dissolve = 0.0, dissEdge = 0.0;
  vec3 glow = vec3(0.0), refl = vec3(0.0), colSrc = vec3(0.0), tint = vec3(1.0);
  vec3 srcLast = world(uCamPos - uOffset, dPin, uEnvGain.y);
  bool inside = false; float tt = 0.0;
  int maxIt = int(uSteps);
  for (int it = 0; it < 1024; it++) {
    if (it >= maxIt || tt > 900.0) break;
    if (!inside) {
      float dist = sdf(o);
      if (dist < 2e-4) {
        vec3 n = sdfNormal(o); float ci = -dot(d, n); hit = 1.0;
        float R = fresnelU(abs(ci), uNmed, uN);
        refl += T * R * roomL(reflect(d, n)) * uBandRGB;
        T *= 1.0 - R;
        vec3 dn = refract(d, ci > 0.0 ? n : -n, uNmed / uN);
        if (dot(dn, dn) > 0.5) { e1 = transport(e1, d, dn); d = dn; }
        inside = true; o += d * 1e-3; tt += 1e-3; continue;
      }
      if (dist > 60.0 && dot(o - uHead.xyz, d) > 0.0) break;   // past everything
      o += d * dist; tt += dist; continue;
    }
    float h, s; vec3 c, t;
    float din = -dropSDF(o, h, s, c, t);
    float hs = clamp(din, 0.01, 0.35);
    vec3 q = o + d * hs; bool leaving = sdf(q) > 0.0;
    if (leaving) { float a = 0.0, b = hs; for (int k = 0; k < 12; k++) { float m = 0.5 * (a + b); if (sdf(o + d * m) > 0.0) b = m; else a = m; } hs = 0.5 * (a + b); q = o + d * hs; }
    vec3 mid = o + d * (0.5 * hs);
    float h2, s2; vec3 c2, t2; dropSDF(mid, h2, s2, c2, t2);
    vec3 e2 = cross(e1, d);
    bool broken = false;
    if (uFrac.w > 0.5) {
      float ft = frontTime(mid, s2, h2 < 0.5);
      broken = ft <= uFrac.x;
      float dz = (uFrac.x - ft) / max(uFrac2.x, 1e-3); float near = exp(-dz * dz);
      crack += near * hs * uFrac2.y;
      if (broken) {
        depolL += hs;
        if (glitter < 0.0) { float cell = (0.06 + 0.3 * hash13(floor(mid * 2.0 / uGlitK))) * uGlitK; glitter = 0.15 + 2.6 * pow(hash13(floor(mid / cell) + 17.0), 7.0); }
        // the branches: bright crack lines left behind the front along the tail (every ~6 diameters, alternating sides)
        if (h2 < 0.5) { float R = rTail(s2), period = 12.0 * R; float k = floor((uFrac.y - s2) / period); float side = mod(k, 2.0) < 0.5 ? 1.0 : -1.0;
          vec3 rv = mid - c2; float ang = atan(dot(rv, cross(t2, e1)), dot(rv, e1));
          float line = abs(fract((ang * R * side) / (0.29 * period) + (s2 - uFrac.y) / period) - 0.5);
          crack += exp(-line * line / 0.0016) * hs * 0.6 * uFrac2.y; }
        // the dissolution wave: cells behind the front let go, with a bright edge as each cell's glass leaves
        if (uDiss.w > 0.5) {
          float age = uFrac.x - ft, th = hash13(floor(mid / max(uDiss.z, 0.05)) + 0.37);
          float gate = uDiss.x + uDiss.y * th, dm = sstep(gate - 0.10, gate + 0.10, age);
          dissolve += hs * dm; dissEdge += hs * 4.0 * dm * (1.0 - dm);
          glitter *= 1.0 - 0.75 * dm;
        }
      }
    }
    if (!broken) {
      vec3 S = projectedStress(mid, e1, e2, h2, s2, c2, t2);
      float diff = sqrt((S.x - S.y) * (S.x - S.y) + 4.0 * S.z * S.z);
      if (diff > 1e-6) {
        float phi = 0.5 * atan(2.0 * S.z, S.x - S.y), cc2 = cos(2.0 * phi), ss2 = sin(2.0 * phi);
        for (int k = 0; k < 5; k++) { float dl = uK[k] * diff * hs; jstep(J0[k], J1[k], cos(0.5 * dl), sin(0.5 * dl), cc2, ss2); }
      }
    }
    if (uGlow.w > 0.5) { float rn = length(mid - uHead.xyz) / uHead.w; glow += uGlow.rgb * hs * (0.6 + 0.4 * (1.0 - min(1.0, rn * rn))); }
    tint *= exp(-uAbsorb.rgb * hs * uAbsorb.w);
    o = q; tt += hs;
    if (leaving) {
      vec3 n = sdfNormal(o); float ci = dot(d, n);
      float R = fresnelU(abs(ci), uN, uNmed);
      vec3 dn = refract(d, -n, uN / uNmed);
      if (dot(dn, dn) < 0.5 || R >= 1.0) { vec3 dr = reflect(d, n); e1 = transport(e1, d, dr); d = dr; tirN += 1.0; o += d * 1e-3; continue; }
      float Wt = T * (1.0 - R);
      // The light that leaves here reaches the camera (the backward trace's source end). The window side carries the polarised
      // train; the room side is unpolarised (it enters past the analyser) and carries the sodium practical.
      vec3 e1t = transport(e1, d, dn), e2t = cross(e1t, dn), elt = labE1(dn);
      float betat = atan(dot(elt, e2t), dot(elt, e1t));
      if (Wt > 2e-4 && dn.z < 0.0) {
        float Ie = 0.0; for (int k = 0; k < 5; k++) Ie += uLW[k] * train(J0[k], J1[k], an, betat);
        float De = 1.0 - exp(-uFrac2.w * depolL);
        float depe = De * (an * 0.5 + (1.0 - an)) * max(glitter, 0.0) * uFrac2.z;
        vec3 srce = world(o, dn, uEnvGain.z);
        srcLast = srce;
        colSrc += Wt * tint * srce * ((1.0 - De) * Ie + depe);
      }
      // No camera-side room term here: the room light enters past the analyser and would flood the dark field. The room's
      // practical is already carried by the front-surface reflection and the TIR paths.
      // The transmitted ray continues outside: it may re-enter the glass at another surface (the neck, the tail), which is
      // where the bright rim and the second image of the works come from. The inner surfaces' reflections are carried by the
      // TIR paths above and by the practical's glint at the front surface.
      T *= 1.0 - R; e1 = transport(e1, d, dn); d = dn; inside = false; o += d * 1e-3;
    }
  }
  // A ray trapped by total internal reflection (or cut off by the step budget) never exits here. The reference trace keeps
  // its carried source term, which is what draws the bright guided rings in the neck; keep it too, without double-counting
  if (hit > 0.5 && inside) {
    vec3 e2f = cross(e1, d), elf = labE1(d); float betaf = atan(dot(elf, e2f), dot(elf, e1));
    float If = 0.0; for (int k = 0; k < 5; k++) If += uLW[k] * train(J0[k], J1[k], an, betaf);
    float Df = 1.0 - exp(-uFrac2.w * depolL);
    float depf = Df * (an * 0.5 + (1.0 - an)) * max(glitter, 0.0) * uFrac2.z;
    colSrc += T * tint * world(o, d, uEnvGain.z) * ((1.0 - Df) * If + depf);
  }
  // the source end: the transmitted light was accumulated at each exit (the first image and the internal-reflection ghosts),
  // with its own Jones matrices and path absorption. The background (no hit) is the window's own defocused view.
  vec3 src = hit > 0.5 ? srcLast : world(uCamPos - uOffset, dPin, uEnvGain.y);
  vec3 col = hit > 0.5 ? colSrc : src;
  if (hit < 0.5) {   // the background through the analyser: an identity specimen, so the crossed train blacks it out
    vec3 e2b = cross(e1, dPin), elb = labE1(dPin); float betab = atan(dot(elb, e2b), dot(elb, e1));
    float Ib = 0.0; for (int k = 0; k < 5; k++) Ib += uLW[k] * train(J0[k], J1[k], an, betab);
    col = src * Ib;
  }
  col += refl * (an * 0.5 + (1.0 - an)) + glow * (an * 0.5 + (1.0 - an));
  // the glass leaves cell by cell behind the front; the dissolving edges glint in the band's colour
  if (uDiss.w > 0.5) { col *= max(0.0, 1.0 - dissolve * 8.0); col += uBandRGB * dissEdge * 0.28 * (an * 0.5 + (1.0 - an)); }
  // the burst: the fractured ghost goes, the window's own view (black in dark field) takes its place
  if (hit > 0.5 && uFrac.w > 0.5 && uGhost < 1.0) col = mix(world(uCamPos - uOffset, dPin, uEnvGain.y) * (1.0 - an), col, uGhost);
  // steam bubbles in the water (formation): air in water bends light away, a dark rim round a bright core and a glint
  for (int b = 0; b < ${NBUB}; b++) {
    vec4 B = uBub[b]; if (B.w <= 0.0) continue;
    vec3 oc = (Lp - uOffset) - B.xyz; vec3 dd = normalize(Pf - Lp);
    float bq = dot(oc, dd), cq = dot(oc, oc) - B.w * B.w, disc = bq * bq - cq;
    if (disc <= 0.0) continue;
    float pr = sqrt(max(0.0, dot(oc, oc) - bq * bq)) / B.w;   // impact parameter / radius
    float rim = sstep(0.55, 0.95, pr), core = 1.0 - sstep(0.0, 0.5, pr);
    col *= 1.0 - 0.75 * rim;
    col += uBandRGB * (0.35 * core + 0.6 * pow(max(0.0, 1.0 - abs(pr - 0.8) * 4.0), 8.0)) * dot(world(Lp - uOffset, dd, uEnvGain.y), vec3(0.33)) * (an * 0.5 + (1.0 - an));
  }
  outColor = vec4(col * uW, hit * uW);
}`;

const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

export class Polariscope {
  constructor(renderer, { w = 1080, h = 1920, n = N_GLASS, C = C_SODALIME, kind = 'circular', field = 'dark', band = { l0: 589.3e-9, fwhm: 10e-9 }, lambdas = 5, lensSamples = 16, steps = 384, type = THREE.FloatType } = {}) {
    this.r = renderer; this.w = w; this.h = h; this.K = lensSamples; this.C = C;
    this.rt = new THREE.WebGLRenderTarget(w, h, { type, format: THREE.RGBAFormat, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
    const L = bandSamples(band.l0, band.fwhm, lambdas === 5 ? 5 : 5);
    const U = this.U = {
      uRes: { value: new THREE.Vector2(w, h) }, uSample: { value: new THREE.Vector4() }, uW: { value: 1 / this.K },
      uCamPos: { value: new THREE.Vector3(0, 0, 211) }, uCamR: { value: new THREE.Vector3(1, 0, 0) }, uCamU: { value: new THREE.Vector3(0, 1, 0) }, uCamF: { value: new THREE.Vector3(0, 0, -1) },
      uFocal: { value: new THREE.Vector4(211, 13, 23.1, 3.125) },
      uHead: { value: new THREE.Vector4(0, 0, 0, DROP.head) }, uLine: { value: Array.from({ length: NLINE + 1 }, () => new THREE.Vector4()) },
      uGroup: { value: Array.from({ length: NGROUP }, () => new THREE.Vector4()) }, uTail: { value: new THREE.Vector4(DROP.blend, 1, 1e3, 1) },
      uStress: { value: new THREE.Vector4(-560, 1, 1, 0) }, uN: { value: n }, uNmed: { value: 1 },
      uK: { value: L.map(s => 2 * Math.PI * C * 1e6 * 1e-3 / s.l) }, uLW: { value: L.map(s => s.w) },
      uTrain: { value: new THREE.Vector4(kind === 'plane' ? 1 : 0, field === 'light' ? 1 : 0, 0, 1) },
      uSlide: { value: new THREE.Vector4(1, 0, 1e5, 1) }, uSlideR: { value: 30 }, uSlideOn: { value: 0 },
      uBandRGB: { value: new THREE.Vector3(...bandColour(band.l0, band.fwhm)) },
      uEnv: { value: null }, uToWorld: { value: new THREE.Matrix3() }, uEnvGain: { value: new THREE.Vector4(1, 5, 0.5, 1) },
      uWindow: { value: new THREE.Vector4(0, 0, -150, 150) }, uRoom: { value: new THREE.Vector4(0.6, 0.2, -0.77, 0.05) }, uRoomL: { value: 0 },
      uFrac: { value: new THREE.Vector4(0, 16, 1.8, 0) }, uEntry: { value: new THREE.Vector4(-2.9, 5.95, 0, 6.4) }, uFrac2: { value: new THREE.Vector4(0.25, 1.0, 1.0, 4.0) },
      uGhost: { value: 1 }, uOffset: { value: new THREE.Vector3() }, uGlow: { value: new THREE.Vector4(0, 0, 0, 0) },
      uBub: { value: Array.from({ length: NBUB }, () => new THREE.Vector4(0, 0, 0, 0)) }, uSteps: { value: steps },
      uGap: { value: new THREE.Vector4(0, 0, 0, 0) }, uLoad: { value: new THREE.Vector4(0, 0, 0, 0) }, uLoad2: { value: new THREE.Vector4(0, 0, 0.15, 0) }, uCrackL: { value: 0 }, uGlitK: { value: 1 },
      uDiss: { value: new THREE.Vector4(0, 0, 1.4, 0) }, uStrike: { value: new THREE.Vector4(0, 0, 0, 0) }, uStrike2: { value: new THREE.Vector4(1.9, 0, 0, 0) },
      uAbsorb: { value: new THREE.Vector4(0.0008, 0.00035, 0.0007, 1) },
      uWave: { value: new THREE.Vector4(0, 0, 0, 0) }, uWave2: { value: new THREE.Vector4(0, 30, 1.1, 9) },
    };
    this.mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG, uniforms: U, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh); this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.slide = null; this.body({});
  }
  // the drop: a centreline from polariscope_ref.js (or its default), the head radius, the smooth-union blend
  body({ CL = null, head = DROP.head, blend = DROP.blend, tail = true } = {}) {
    CL = CL || centreline(); this.CL = CL;
    const pts = CL.pts; if (pts.length !== NLINE + 1) throw new Error(`polariscope: the centreline needs ${NLINE + 1} points (got ${pts.length})`);
    pts.forEach((p, i) => this.U.uLine.value[i].set(p.p[0], p.p[1], p.p[2], p.s));
    for (let g = 0; g < NGROUP; g++) { const P = pts.slice(g * 8, g * 8 + 9), c = [0, 1, 2].map(j => P.reduce((a, q) => a + q.p[j], 0) / P.length);
      const R = Math.max(...P.map(q => Math.hypot(q.p[0] - c[0], q.p[1] - c[1], q.p[2] - c[2]) + DROP.rTail(q.s))); this.U.uGroup.value[g].set(c[0], c[1], c[2], R + 0.5); }
    this.U.uHead.value.w = head; this.U.uTail.value.set(blend, tail ? 1 : 0, 1e3, 1);
    return this;
  }
  stress({ sigmaS = -560e6 } = {}) { this.U.uStress.value.x = sigmaS / 1e6; return this; }
  environment(tex, { gain = 1, lodBg = 5, lodDrop = 0.5, band = 1, toWorld = null, window = null } = {}) {
    const U = this.U; U.uEnv.value = tex; U.uEnvGain.value.set(gain, lodBg, lodDrop, band); if (toWorld) U.uToWorld.value.copy(toWorld);
    if (window) U.uWindow.value.set(window.x ?? 0, window.y ?? 0, window.z ?? -150, window.r ?? 150); return this;
  }
  room({ dir = [0.6, 0.2, -0.77], radius = 0.05, L = 0 } = {}) { const l = Math.hypot(...dir); this.U.uRoom.value.set(dir[0] / l, dir[1] / l, dir[2] / l, radius); this.U.uRoomL.value = L; return this; }
  // a: a number 0..1, or a switch.js Slide (its edge per pixel) with a global level
  analyser(a, t = 0, level = 1) { const U = this.U; if (typeof a === 'number') { U.uTrain.value.w = a; U.uSlideOn.value = 0; }
    else { const u = a.uniform(t); U.uSlide.value.set(u[0], u[1], u[2], u[3]); U.uSlideR.value = u[4]; U.uSlideOn.value = 1; U.uTrain.value.w = level; } return this; }
  fracture(F) { const U = this.U; if (!F) { U.uFrac.value.w = 0; U.uGhost.value = 1; return this; }
    U.uFrac.value.set(F.tI, F.sEnter ?? 16, F.v ?? 1.8, 1); const e = F.entry || [-2.9, 5.95, 0]; U.uEntry.value.set(e[0], e[1], e[2], F.sHead ?? 6.4);
    U.uFrac2.value.set(F.width ?? 0.25, F.crack ?? 1.0, F.glitter ?? 1.0, F.depol ?? 4.0); U.uGhost.value = F.ghost ?? 1; return this; }
  formation({ freeze = 1, glow = null, tailMax = 1e3, taper = 1, offset = [0, 0, 0], nMed = 1, bubbles = [] } = {}) {
    const U = this.U; U.uStress.value.y = freeze; U.uTail.value.z = tailMax; U.uTail.value.w = taper; U.uOffset.value.set(...offset); U.uNmed.value = nMed;
    if (glow) U.uGlow.value.set(glow[0], glow[1], glow[2], 1); else U.uGlow.value.w = 0;
    for (let i = 0; i < NBUB; i++) { const b = bubbles[i]; if (b) U.uBub.value[i].set(b[0], b[1], b[2], b[3]); else U.uBub.value[i].set(0, 0, 0, 0); }
    return this;
  }
  // the camera: bench.js lens; pose in the drop's millimetres
  camera(bench, { pos = [0, 0, 211], target = [0, 0, 0], up = [0, 1, 0] } = {}) {
    const U = this.U, P = new THREE.Vector3(...pos), F = new THREE.Vector3(...target).sub(P).normalize(), R = new THREE.Vector3().crossVectors(F, new THREE.Vector3(...up)).normalize(), Up = new THREE.Vector3().crossVectors(R, F);
    const L = bench.lens(); U.uCamPos.value.copy(P); U.uCamF.value.copy(F); U.uCamR.value.copy(R); U.uCamU.value.copy(Up);
    U.uFocal.value.set(L.u * 1e3, L.halfW * 1e3, L.halfH * 1e3, L.apR * 1e3);
    // the background at infinity: blurred by the bench's own blur circle for a point at infinity, as a cube-map mip
    this.bgBlurPx = bench.cocPx(1e6); return this;
  }
  steps(n) { this.U.uSteps.value = n; return this; }
  // the tail broken through between arc sA and sB (null: whole)
  gap(G) { const U = this.U; if (!G) U.uGap.value.set(0, 0, 0, 0); else U.uGap.value.set(G.sA, G.sB, 1, 0); return this; }
  // a point load on the tail: { at: [x, y, z] mm, s: arc mm, contact: MPa, bend: 4F/pi (N), a: contact radius mm } (null: none)
  load(L) { const U = this.U; if (!L) { U.uLoad2.value.w = 0; return this; }
    U.uLoad.value.set(L.at[0], L.at[1], L.at[2], L.contact ?? 0); U.uLoad2.value.set(L.s, L.bend ?? 0, L.a ?? 0.15, 1); return this; }
  // the crack surfaces' own scatter of the room's light (band radiance)
  crackLight(L) { this.U.uCrackL.value = L; return this; }
  glitterScale(k) { this.U.uGlitK.value = k; return this; }
  // Beer-Lambert absorption per mm of path (rgb) and its switch; the faint green edge of a soda-lime body
  absorption(rgb = [0.0008, 0.00035, 0.0007], on = 1) { this.U.uAbsorb.value.set(rgb[0], rgb[1], rgb[2], on); return this; }
  // K lens samples (Halton over the disc, pixel jitter), each its own additive draw into the float target
  render(t = 0, { K = this.K, frame = 0 } = {}) {
    const r = this.r, U = this.U, prevT = r.getRenderTarget(), prevAC = r.autoClear;
    r.setRenderTarget(this.rt); r.setClearColor(0x000000, 0); r.clear(true, false, false); r.autoClear = false;
    U.uW.value = 1 / K;
    for (let k = 0; k < K; k++) {
      const i = k + 1 + (frame % 7) * K, a = 2 * Math.PI * halton(i, 2), rr = Math.sqrt(halton(i, 3));
      U.uSample.value.set(halton(i, 5) - 0.5, halton(i, 7) - 0.5, rr * Math.cos(a), rr * Math.sin(a));
      r.render(this.scene, this.cam);
    }
    r.setRenderTarget(prevT); r.autoClear = prevAC;
    return this.rt.texture;
  }
  // the dissolution wave behind the front: cells let go after start + span * cell-hash (us), at cell mm (null: whole glass)
  dissolve(D) { const U = this.U; if (!D) U.uDiss.value.w = 0; else U.uDiss.value.set(D.start ?? 0.15, D.span ?? 1.4, D.cell ?? 1.4, 1); return this; }
  // the one strike's transient contact field and the wave it launches: { at: [x,y,z] mm, amp: MPa, radius: mm, age: s }
  strike(S) { const U = this.U; if (!S) { U.uStrike2.value.w = 0; U.uWave.value.w = 0; return this; }
    U.uStrike.value.set(S.at[0], S.at[1], S.at[2], S.amp ?? 0); U.uStrike2.value.set(S.radius ?? 1.9, 0, 0, 1);
    // the front's own envelope is slower than the contact's ring: the film's slowed clock lets the fringes cross the body
    const wamp = 420 * Math.min(1, (S.amp ?? 0) / 200) * Math.exp(-(S.age ?? 0) / 0.55);
    U.uWave.value.set(S.at[0], S.at[1], S.at[2], wamp); U.uWave2.value.set(S.age ?? 0, 30, 1.4, 9); return this; }
  dispose() { this.rt.dispose(); this.mat.dispose(); this.mesh.geometry.dispose(); }
}
// the fragment shader as three would assemble it (for a GLSL validator: web/labs/objective/glsl_check.mjs)
export function fragmentSource() { return '#version 300 es\n' + FRAG; }
export function vertexSource() { return '#version 300 es\nprecision highp float;\n' + VERT; }
