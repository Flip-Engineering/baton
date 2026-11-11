// AMERICANA (WORLDS studio c1): a real-scale American kit on world3d.js + atmos3d.js. Metres, y up, x east, z south.
//   Plains      survey-true ground in one shader: PLSS section roads every 1609.34 m (gravel, some paved), quarter sections
//               of 804.7 m as center pivots (800 m, wheel-track rings, a harvested sector), dryland strips, row crops with
//               tramlines, pasture with stock ponds; shelterbelts, a creek with riparian trees that follows the terrain,
//               the rail line, the interstate. Rows and tracks fade by their screen footprint (no shimmer).
//   layoutTowns towns on the rail line every 11-19 km, one county seat.
//   Towns       houses, main street blocks, trees, concrete elevators with headhouses and steel bins, water towers, and
//               their light: sodium street lights at intersections, 4000 K LED on main street, porch lights, elevator
//               floods, steady red obstruction lights. Every light pools on the ground (LightField) and lights the clouds.
//   Farmsteads  a yard light (the plains-at-night dot), a house, a barn, bins and a windbreak at section corners.
//   WindFarm    3-blade turbines, 90 m hub, 120 m rotor, rows on the ridges, red L-864 beacons flashing in sync (40/min).
//   Traffic     headlight/taillight pairs moving at real speed along a line (interstate 29 m/s, section roads 20 m/s).
//   Flare       a gas-well flare: flickering orange sprite, a ground pool.
// The kit supplies geometry, scale and light; a piece supplies the grade (LOOKS3 look, or its own post).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ATMOS_GLSL, LF_GLSL, patchMaterial } from './atmos3d.js';

export const SECTION = 1609.34, QUARTER = SECTION / 2;
export const MPH = 0.44704;
const TAU = Math.PI * 2;
export function rng(seed) { let s = seed | 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function h2(x, y) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const lin = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);

// ------------------------------------------------------------------ terrain (JS twin of the GLSL, identical)
export const PLAINS_H_GLSL = /* glsl */`
uniform vec4 uCreek;     // x0, amp1, amp2, depth
float creekX(float z){ return uCreek.x + uCreek.y*sin(z*.00035) + uCreek.z*sin(z*.0011 + 2.); }
float creekD(vec2 p){ float d = p.x - creekX(p.y); float dx = uCreek.y*.00035*cos(p.y*.00035) + uCreek.z*.0011*cos(p.y*.0011 + 2.); return abs(d) / sqrt(1. + dx*dx); }
float plainsH(vec2 p){
  float h = 9.*sin(p.x*.00031 + 1.3)*sin(p.y*.00027 + .4) + 4.*sin(p.x*.00093 - p.y*.00061) + 1.5*sin(p.x*.0021 + p.y*.0017);
  return h - uCreek.w*exp(-pow(creekD(p)/260., 2.));
}`;
export function makeCreek({ x0 = 2200, a1 = 900, a2 = 300, depth = 5 } = {}) { return { x0, a1, a2, depth }; }
export function creekX(C, z) { return C.x0 + C.a1 * Math.sin(z * 0.00035) + C.a2 * Math.sin(z * 0.0011 + 2); }
export function plainsH(C, x, z) {
  const d = x - creekX(C, z), dx = C.a1 * 0.00035 * Math.cos(z * 0.00035) + C.a2 * 0.0011 * Math.cos(z * 0.0011 + 2), cd = Math.abs(d) / Math.sqrt(1 + dx * dx);
  const h = 9 * Math.sin(x * 0.00031 + 1.3) * Math.sin(z * 0.00027 + 0.4) + 4 * Math.sin(x * 0.00093 - z * 0.00061) + 1.5 * Math.sin(x * 0.0021 + z * 0.0017);
  return h - C.depth * Math.exp(-((cd / 260) ** 2));
}

// ------------------------------------------------------------------ Plains ground
// palette: 'dusk' | 'night' | 'summer' (albedos, linear). towns: [{x, z, r}] (town ground inside r), rail/hwy: z of the lines.
const PAL = {
  summer: { stub: '#b89a5c', wheat: '#c8a860', corn: '#4c6a2a', soy: '#3e6a26', fallow: '#6a5040', pasture: '#6e6e40', grav: '#9a8e7a', asph: '#3a3836', tree: '#1e2e14', lawn: '#4a6030', ball: '#5a5048' },
  dusk: { stub: '#a08450', wheat: '#a8904e', corn: '#445c28', soy: '#3c5c2c', fallow: '#6e5640', pasture: '#5e5c38', grav: '#6e665a', asph: '#2c2a28', tree: '#16220e', lawn: '#3a4c26', ball: '#3a3430' },
};
export class Plains {
  // detail: 2 (pass 2, opt-in) = surface grain at the camera's scale: canopy combed along the rows, combine swaths in the
  // stubble, the wet arc behind each pivot arm (it mirrors the sky), per-field hue, clods near the camera
  constructor(world, atmos, lf, { center = [0, 0], size = 90000, seg = 420, creek = makeCreek(), towns = [], railZ = 3000, hwyZ = -9000, palette = 'dusk', rowsFade = 1, seed = 1, detail = 1 } = {}) {
    this.creek = creek; this.railZ = railZ; this.hwyZ = hwyZ; this.towns = towns;
    const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2); g.translate(center[0], 0, center[1]);
    const P = g.getAttribute('position');
    for (let i = 0; i < P.count; i++) P.setY(i, plainsH(creek, P.getX(i), P.getZ(i)));
    g.computeVertexNormals();
    const pal = PAL[palette] || PAL.dusk, U = atmos.U, key = atmos.key;
    const T = Array.from({ length: 16 }, (_, i) => towns[i] ? new THREE.Vector4(towns[i].x, towns[i].z, towns[i].r, towns[i].seed ?? i) : new THREE.Vector4(1e9, 1e9, 0, 0));
    this.u = { ...U, ...lf.U, uCreek: { value: new THREE.Vector4(creek.x0, creek.a1, creek.a2, creek.depth) },
      uTownsG: { value: T }, uRail: { value: railZ }, uHwy: { value: hwyZ }, uSeed: { value: seed }, uRowsFade: { value: rowsFade },
      uKeyDir: { value: new THREE.Vector3() }, uKeyCol: { value: new THREE.Color() }, uHemiS: { value: new THREE.Color() }, uHemiG: { value: new THREE.Color() },
      uStrip: { value: new THREE.Vector4(0, 1e9, 1, 0) }, uFlashG: { value: 0 },
      uForce: { value: Array.from({ length: 4 }, () => new THREE.Vector4(1e9, 1e9, -1, 0)) } };
    for (const k of Object.keys(pal)) this.u['c_' + k] = { value: lin(pal[k]) };
    const pals = Object.keys(pal).map(k => `uniform vec3 c_${k};`).join('\n');
    this.mat = new THREE.ShaderMaterial({ uniforms: this.u, extensions: { derivatives: true }, defines: detail >= 2 ? { D2: 1 } : {},
      vertexShader: `varying vec3 vP; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: ATMOS_GLSL + LF_GLSL + PLAINS_H_GLSL + pals + /* glsl */`
        uniform vec4 uForce[4];
        uniform vec4 uTownsG[16]; uniform float uRail, uHwy, uSeed, uRowsFade; uniform vec3 uKeyDir, uKeyCol, uHemiS, uHemiG; uniform vec4 uStrip; uniform float uFlashG;
        varying vec3 vP;
        const float S = 1609.34, Q = 804.67;
        float h1(vec2 p){ return a_h21(p + uSeed*17.31); }
        // AA'd stripe: 1 on a line of half-width w (metres) at coordinate u, fading when sub-pixel
        float aaLine(float d, float w){ float fw = fwidth(d) + 1e-4; return smoothstep(w + fw, w - fw, d); }
        float rows(float u, float per, float amt){ float fw = fwidth(u) / per; float f = clamp(1. - fw*1.6, 0., 1.) * uRowsFade;
          return 1. + amt * f * sin(u / per * 6.2832); }
        vec3 fieldTex(vec3 c, vec2 ql, float soil){
          float e = Q*.5 - max(abs(ql.x), abs(ql.y));                // headlands: the turn rows at every field edge
          c *= mix(1., .86 + .1*soil, smoothstep(14., 6., e));
          return c * (.78 + .44*soil);                                // soil moisture / yield patches, 50-200 m
        }
        vec3 ground(vec2 p, out float wet, out float spec){
          wet = 0.; spec = 0.;
          vec2 si = floor(p / S), l = p - si*S;
          vec2 qi = floor(l / Q), ql = l - qi*Q - Q*.5;            // quarter-local, centred
          float hq = h1(si*2. + qi), hq2 = h1(si*2. + qi + 91.7);
          #ifdef D2
          for (int i = 0; i < 4; i++) if (uForce[i].z >= 0. && all(equal(si*2. + qi, uForce[i].xy))) { hq = uForce[i].z; hq2 = uForce[i].w; }   // art-directed quarters
          #endif
          float mott = a_fbm(p*.0045 + hq*10.), fine = a_n2(p*.08), soil = a_n2(p*.021 + 3.) * .6 + a_n2(p*.06) * .4;
          // 80-acre splits: some quarters carry two crops (north/south halves)
          if (fract(hq2*5.3) < .35 && ql.y > 0.) { hq = fract(hq + .37); hq2 = fract(hq2 + .61); }
          vec3 c; float rq = length(ql);
          // ----- field types
          if (hq < .42) {                                         // center pivot, 800 m, in the quarter
            float pr = 392.;
            if (rq < pr) {
              float ang = atan(ql.y, ql.x); float sect = fract((ang / 6.2832) + hq2);
              bool harv = sect < .18 + .2*hq2;
              vec3 crop = hq2 < .45 ? c_corn : (hq2 < .75 ? c_soy : c_wheat);
              c = harv ? c_stub : crop;
              c *= rows(rq, 0.76, .18) * (.86 + .28*mott);
              float ring = mod(rq, 54.);                            // wheel ruts every tower span
              #ifdef D2
              c *= 1. - .16*aaLine(abs(min(ring, 54.-ring) - 1.1), .35) * (.6 + .8*a_n2(vec2(ang*rq*.02, rq)));   // paired wheel ruts, broken by the crop
              #else
              c *= 1. - .35*aaLine(min(ring, 54.-ring), 1.4);
              c *= 1. - .25*aaLine(abs(sin(ang - hq*6.)) * rq, 1.8) * step(rq, pr);   // the pivot arm's track
              #endif
              wet = harv ? 0. : .15;
              #ifdef D2
              { float fwq = fwidth(rq);
                c *= .84 + .32*mix(.5, a_n2(vec2(ang*rq*.045, rq*.9)), clamp(1. - fwq*.8, 0., 1.));      // canopy combed along the circular rows
                if (harv) { float sw = mod(ang*rq, 9.1); c *= mix(1., .95 + .08*step(4.55, sw), clamp(1. - fwq*.3, 0., 1.)); }   // combine swaths
                float ra = mod(ang - (hq*15. + 1.5708), 6.2832);    // the sector the arm just watered: dark soil, a sheen of sky
                if (!harv) { float w = smoothstep(5.6, 6.2, ra) * smoothstep(6.283, 6.26, ra) * smoothstep(pr, pr - 30., rq); wet = max(wet, .5 + .45*w); c *= 1. - .35*w; } }
              #endif
            } else { c = mix(c_pasture, c_fallow, .35 + .3*mott) * (.9 + .2*fine); }   // dry corners
          } else if (hq < .66) {                                  // dryland strips (wheat / fallow), E-W, 100-160 m
            float w = 100. + 60.*hq2; float sidx = floor((ql.y + Q*.5) / w);
            bool fal = mod(sidx + floor(hq*7.), 2.) > .5;
            c = fal ? c_fallow : (hq2 > .5 ? c_stub : c_wheat);
            c *= rows(ql.y, fal ? 3. : .3, fal ? .08 : .12) * (.88 + .24*mott);
            #ifdef D2
            c *= .92 + .16*mix(.5, a_n2(vec2(ql.x*.03, ql.y*(fal ? .4 : 1.6))), clamp(1. - fwidth(ql.y)*.6, 0., 1.));
            #endif
            float tram = mod(ql.y + Q*.5, 27.); c *= 1. - .18*aaLine(min(tram, 27.-tram), .9) * (fal ? 0. : 1.);
          } else if (hq < .86) {                                  // row crop, rows along x or z, tramlines
            bool ax = hq2 > .5; float u = ax ? ql.x : ql.y;
            c = hq2 > .3 ? c_corn : c_soy; if (fract(hq2*13.) < .3) c = c_stub;
            c *= rows(u, .76, .2) * (.85 + .3*mott);
            #ifdef D2
            { float v = ax ? ql.y : ql.x; c *= .85 + .3*mix(.5, a_n2(vec2(v*.025, u*1.2)), clamp(1. - fwidth(u)*.6, 0., 1.)); }
            #endif
            float tram = mod(u + 400., 36.); c *= 1. - .22*aaLine(min(tram, 36.-tram), .8);
          } else {                                                // pasture, stock pond
            c = c_pasture * (.75 + .5*mott) * (.9 + .2*fine);
            vec2 pc = vec2(hq2 - .5, fract(hq2*7.) - .5) * 500.;
            vec2 dq = ql - pc; float pd = length(dq) * (1. + .35*sin(atan(dq.y, dq.x)*3. + hq*20.)) - (22. + 30.*fract(hq2*3.));
            if (pd < 0.) { wet = 1.; c = vec3(.02); }
            c *= 1. - .3*aaLine(abs(pd - 6.), 5.);                // trampled margin
          }
          if (wet < .9) c = fieldTex(c, ql, soil);
          #ifdef D2
          c *= mix(vec3(1.), vec3(1.07, 1., .88), h1(si*2. + qi + 3.7)) * mix(vec3(1.), vec3(.9, 1., 1.06), h1(si*2. + qi + 8.1));   // per-field hue
          c *= .9 + .2*mix(.5, a_n2(p*1.9), clamp(1. - fwidth(p.x)*2., 0., 1.));                  // clods, near the camera only
          #endif
          // ----- shelterbelt on the north edge of some quarters
          if (hq2 > .72 && qi.y < .5) { float d = l.y - (qi.y*Q) - 12.; if (abs(d) < 11.) { c = c_tree * (.5 + .9*a_n2(p*.25)); } }
          // ----- farmstead windbreak at some section corners
          vec2 fc = p - (si*S + vec2(60.)); if (h1(si + 5.3) < .38 && max(abs(fc.x - 40.), abs(fc.y - 40.)) < 70.) {
            float t = a_n2(p*.12); c = mix(c_lawn*.8, c_tree*(.6+.8*t), step(.45, t)); }
          // ----- section roads (gravel; some paved), ditches
          float dr = min(min(l.x, S - l.x), min(l.y, S - l.y));
          bool pavX = h1(vec2(si.x, 3.)) < .15, pavZ = h1(vec2(7., si.y)) < .15;
          float dx = min(l.x, S - l.x), dz = min(l.y, S - l.y);
          vec3 rc = (dx < dz ? pavX : pavZ) ? c_asph : c_grav * (.9 + .15*fine);
          c = mix(c, c * .75 + c_lawn*.1, aaLine(dr, 9.));        // ditch grass
          c = mix(c, rc, aaLine(dr, 4.));
          // ----- creek: water and riparian trees
          float cd = creekD(p);
          if (cd < 70.) { float t = a_n2(p*.1); c = mix(c, c_tree*(.5 + t), smoothstep(70., 40., cd) * step(.35, t + smoothstep(50., 10., cd))); }
          if (cd < 6.) { wet = 1.; c = vec3(.02); }
          // ----- rail line (ballast, ROW grass)
          float rd = abs(p.y - uRail);
          c = mix(c, c_lawn*.7, aaLine(rd, 22.)); c = mix(c, c_ball, aaLine(rd, 3.5)); c *= 1. - .5*aaLine(abs(rd - .75), .12);
          // ----- interstate: two 12 m carriageways, 24 m median
          float hd = abs(p.y - uHwy);
          c = mix(c, c_lawn*.8, aaLine(hd, 45.)); c = mix(c, c_asph*1.2, aaLine(abs(hd - 18.), 6.5));
          c = mix(c, vec3(.5), .6*aaLine(abs(hd - 11.8), .1)); c = mix(c, vec3(.5), .6*aaLine(abs(hd - 24.2), .1));
          // ----- towns: streets, lawns, trees
          for (int i = 0; i < 16; i++) { vec4 T = uTownsG[i]; if (T.z <= 0.) continue; vec2 d = p - T.xy; float td = length(d);
            if (td < T.z) {
              vec2 b = mod(d + 1000., 106.); float sd = min(min(b.x, 106.-b.x), min(b.y, 106.-b.y));
              float t = a_n2(p*.09 + T.w);
              vec3 tc = mix(c_lawn*(.8+.4*fine), c_tree*(.6+.7*t), step(.5, t));
              tc = mix(tc, c_asph*1.1, aaLine(sd, 8.));
              c = mix(c, tc, smoothstep(T.z, T.z*.8, td));
            } }
          return c;
        }
        void main(){
          vec2 p = vP.xz; float e = 3.;
          vec3 n = normalize(vec3(plainsH(p - vec2(e, 0.)) - plainsH(p + vec2(e, 0.)), 2.*e, plainsH(p - vec2(0., e)) - plainsH(p + vec2(0., e))));
          float wet, spec; vec3 alb = ground(p, wet, spec);
          float strip = 1. - smoothstep(uStrip.y - uStrip.z, uStrip.y, abs(vP.z - uStrip.x + uStrip.w*sin(vP.x*.0007)));   // where the sun gets through
          vec3 lit = uKeyCol * max(dot(n, normalize(uKeyDir)), 0.) * strip + mix(uHemiG, uHemiS, n.y*.5 + .5) + lightAt(vP) / 3.14159 + vec3(.75, .8, 1.) * uFlashG;
          vec3 c = alb * lit;
          #ifdef D2
          if (wet < .9) {                                                  // vegetation against the light: leaf transmission + a waxy sheen of the sky
            vec3 v = normalize(vP - uCamPos), L = normalize(uKeyDir); float veg = clamp(dot(alb, vec3(-1., 2., -1.)) * 8. + .3, 0., 1.);
            float back = pow(max(dot(v, L) * .5 + .5, 0.), 6.);
            c += alb * uKeyCol * back * (.6 + .9*veg) * strip * .8;
            float fr = pow(1. - max(-v.y, 0.), 6.);                        // grazing: the far fields take the sky's colour
            c += skyCol(reflect(v, n)) * fr * (.03 + .05*veg);
          }
          #endif
          if (wet > .9) { vec3 v = normalize(vP - uCamPos); vec3 r = reflect(v, vec3(0., 1., 0.)); float f = .02 + .98*pow(1. - max(dot(-v, vec3(0,1,0)), 0.), 5.);
            c = c + skyCol(r) * max(f, .06) * .9 + lightAt(vP) * .02; }
          #ifdef D2
          else if (wet > .45) { float w = (wet - .45) / .45; vec3 v = normalize(vP - uCamPos); vec3 r = reflect(v, n); float f = .02 + .98*pow(1. - max(dot(-v, n), 0.), 5.);
            c += skyCol(r) * f * w * .22; }
          #endif
          gl_FragColor = vec4(c, 1.);
        }` });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.userData.noReflect = true;
    world.scene.add(this.mesh);
    this.atmos = atmos;
    atmos.pre.push(() => this.sync());
  }
  sync() { const A = this.atmos, K = A.key, u = this.u; u.uKeyDir.value.copy(K.position).normalize(); u.uKeyCol.value.copy(K.color).multiplyScalar(K.intensity);
    const hm = A.world._hemi; if (hm) { u.uHemiS.value.copy(hm.color).multiplyScalar(hm.intensity); u.uHemiG.value.copy(hm.groundColor).multiplyScalar(hm.intensity); } }
  h(x, z) { return plainsH(this.creek, x, z); }
  // pass 2 (detail: 2): force the quarter containing (x, z) to a field type; returns its centre and the pivot arm's angle
  // hq < .42 pivot (hq2: < .45 corn, < .75 soy, else wheat; keep fract(hq2*5.3) >= .35 to avoid the 80-acre split)
  force(k, x, z, hq = 0.1, hq2 = 0.3) { const gx = Math.floor(x / QUARTER), gz = Math.floor(z / QUARTER); this.u.uForce.value[k].set(gx, gz, hq, hq2);
    return { cx: (gx + 0.5) * QUARTER, cz: (gz + 0.5) * QUARTER, arm: hq * 15 + Math.PI / 2 }; }
}

// ------------------------------------------------------------------ towns on the rail
export function layoutTowns({ railZ = 3000, x0 = -60000, x1 = 30000, seed = 3, seatAt = null, first = null } = {}) {
  const r = rng(seed), out = []; let x = first ?? (x0 + r() * 6000);
  while (x < x1) { const seat = seatAt != null && Math.abs(x - seatAt) < 7000 && !out.some(t => t.seat);
    out.push({ x, z: railZ + (r() - 0.5) * 120, pop: seat ? 9000 + r() * 6000 : 300 + r() * 1800, seat, seed: out.length + seed * 10 });
    x += 11000 + r() * 8000; }
  for (const t of out) t.r = 260 + Math.sqrt(t.pop) * 9;
  return out;
}

// geometry kit (unit parts scaled per instance)
const G = (() => {
  const house = (() => { const b = new THREE.BoxGeometry(1, 0.62, 1); b.translate(0, 0.31, 0);
    const roof = new THREE.CylinderGeometry(0.72, 0.72, 1.02, 3, 1); roof.rotateZ(Math.PI / 2); roof.rotateX(Math.PI / 2); roof.scale(1, 0.55, 1); roof.rotateY(Math.PI / 2); roof.translate(0, 0.62 + 0.2, 0);
    return mergeGeometries([b.toNonIndexed(), roof.toNonIndexed()]); })();
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 1).translate(0, 0.5, 0);
  const bin = (() => { const c = new THREE.CylinderGeometry(0.5, 0.5, 0.78, 22, 1).translate(0, 0.39, 0); const k = new THREE.ConeGeometry(0.52, 0.22, 22).translate(0, 0.89, 0); return mergeGeometries([c.toNonIndexed(), k.toNonIndexed()]); })();
  const tree = new THREE.IcosahedronGeometry(0.5, 1).translate(0, 0.62, 0);
  const tower = (() => { const legs = []; for (let i = 0; i < 4; i++) { const l = new THREE.CylinderGeometry(0.012, 0.018, 0.78, 5).translate(0, 0.39, 0); const a = i * Math.PI / 2 + Math.PI / 4;
      l.rotateZ(Math.cos(a) * 0.06); l.rotateX(-Math.sin(a) * 0.06); l.translate(Math.cos(a) * 0.14, 0, Math.sin(a) * 0.14); legs.push(l.toNonIndexed()); }
    const riser = new THREE.CylinderGeometry(0.03, 0.03, 0.8, 8).translate(0, 0.4, 0);
    const tank = new THREE.SphereGeometry(0.2, 24, 14); tank.scale(1, 0.72, 1); tank.translate(0, 0.86, 0);
    return mergeGeometries([...legs, riser.toNonIndexed(), tank.toNonIndexed()]); })();
  return { house, box, cyl, bin, tree, tower };
})();
export { G as GEO };

// instanced group helper: list of { p:[x,y,z], s:[sx,sy,sz], ry, c:'#hex' | THREE.Color }
export function instanced(world, lf, geo, list, { color = '#ffffff', rough = 0.85, metal = 0, emissive = null, wallFall = 14, castShadow = false, name = '' } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  if (emissive) { mat.emissive = new THREE.Color(emissive); }
  if (lf) patchMaterial(mat, lf, { wallFall });
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); m.count = list.length;
  const o = new THREE.Object3D(), cc = new THREE.Color();
  list.forEach((it, i) => { o.position.set(...it.p); o.scale.set(...it.s); o.rotation.set(0, it.ry || 0, 0); o.updateMatrix(); m.setMatrixAt(i, o.matrix);
    if (it.c) m.setColorAt(i, it.c instanceof THREE.Color ? it.c : cc.set(it.c)); });
  m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.castShadow = castShadow; m.name = name; m.frustumCulled = false;
  world.scene.add(m); return m;
}

// ------------------------------------------------------------------ Towns: buildings and light
export const SODIUM = '#ff9a3c', LED = '#ffe6cc', MERCURY = '#d8ecff', PORCH = '#ffc27a', OBST = '#ff1a0a';
export class Towns {
  // structured (pass 2, opt-in): light by use, not a sequin ellipse: main street bright (LED + sodium, pools), the elevator
  // floodlit, residential sodium only at some intersections with dark blocks between, few porch lights, a highway strip
  constructor(world, lf, towns, plains, { seed = 4, lightGain = 1, sat = 1, structured = false } = {}) {
    const r = rng(seed), H = (x, z) => plainsH(plains.creek, x, z), SL = structured;
    const houses = [], trees = [], blocks = [], silos = [], bins = [], heads = [], wtowers = [];
    this.towns = towns; this.elevators = [];
    for (const T of towns) {
      const R = T.r, n = Math.round(T.pop / 2.4);
      // houses on the block grid (106 m blocks, 18 m streets), denser toward the centre
      for (let i = 0; i < n; i++) {
        const a = r() * TAU, d = R * Math.sqrt(r()) * 0.92; let x = T.x + Math.cos(a) * d, z = T.z + Math.sin(a) * d * 0.9;
        const bx = ((x - T.x) % 106 + 106 + 1000) % 106, bz = ((z - T.z) % 106 + 106 + 1000) % 106;
        if (bx < 14 || bx > 92 || bz < 14 || bz > 92) continue;                     // keep the streets clear
        if (Math.abs(z - plains.railZ) < 40) continue;
        const w = 8 + r() * 6, dp = 10 + r() * 8, hh = 5 + r() * 3.5, y = H(x, z);
        const cc = new THREE.Color().setHSL(0.08 + r() * 0.06, 0.12 + r() * 0.15, 0.55 + r() * 0.3);
        houses.push({ p: [x, y, z], s: [w, hh, dp], ry: r() < 0.5 ? 0 : Math.PI / 2, c: cc });
        if (r() < 0.9) trees.push({ p: [x + (r() - 0.5) * 30, y, z + (r() - 0.5) * 30], s: [8 + r() * 8, 10 + r() * 10, 8 + r() * 8], c: new THREE.Color().setHSL(0.24 + r() * 0.06, 0.35, 0.12 + r() * 0.08) });
        if (r() < (SL ? 0.1 : 0.35)) lf.add({ pos: [x + w * 0.6, y + 2.5, z], color: PORCH, i: (SL ? 0.3 : 0.5) * lightGain, core: 0.3, halo: 0.25, minPx: 1.0, pool: { r: 3, i: 3 * lightGain } });
      }
      // main street: two rows of 2-storey commercial blocks perpendicular to the rail
      const ms = Math.round(4 + T.pop / 900);
      for (let k = 0; k < ms; k++) for (const side of [-1, 1]) {
        const x = T.x + side * 16, z = T.z + 60 + k * 26, y = H(x, z);
        blocks.push({ p: [x, y, z], s: [18, 7 + r() * 5, 24], c: new THREE.Color().setHSL(0.03, 0.35, 0.28 + r() * 0.12) });
      }
      if (!SL) for (let k = 0; k <= ms; k += 2) { const z = T.z + 50 + k * 26 + (r() - 0.5) * 8, side = k % 4 ? 1 : -1;
        lf.add({ pos: [T.x + side * 8, H(T.x, z) + 7, z], color: r() < 0.6 ? LED : SODIUM, i: 4 * lightGain, core: 0.4, halo: 0.5, pool: { r: 7, i: 40 * lightGain } }); }
      else { const L = Math.max(260, ms * 26 + 120);                    // main street: lamps both sides every 30 m, lit shopfronts, running past the town edge
        for (let z = T.z + 30; z < T.z + 30 + L; z += 30) for (const side of [-1, 1]) {
          lf.add({ pos: [T.x + side * 9, H(T.x, z) + 8, z + (side > 0 ? 15 : 0)], color: z < T.z + 30 + ms * 26 ? LED : SODIUM, i: 5 * lightGain, core: 0.4, halo: 0.6, pool: { r: 10, i: 70 * lightGain } });
          if (r() < 0.5 && z < T.z + 30 + ms * 26) lf.add({ pos: [T.x + side * 14, H(T.x, z) + 3, z + 8], color: r() < 0.5 ? '#ffd2a0' : '#d8e8ff', i: 1.6 * lightGain, core: 0.8, halo: 0.3, minPx: 1.0, pool: { r: 5, i: 20 * lightGain } }); }
        // the highway strip / the county road out of town: a gas-station canopy (the brightest thing for miles) and a line of sodium
        const gx = T.x + (r() < 0.5 ? -1 : 1) * (T.r * 0.9), gz = T.z + 40;
        lf.add({ pos: [gx, H(gx, gz) + 5, gz], color: '#f4f8ff', i: 12 * lightGain, core: 3, halo: 0.8, pool: { r: 22, i: 110 * lightGain } });
        for (let k = 1; k < 7; k++) { const x = T.x + Math.sign(gx - T.x) * (T.r * 0.9 + k * 55); lf.add({ pos: [x, H(x, gz) + 9, gz - 14], color: SODIUM, i: 4 * lightGain, core: 0.4, halo: 0.55, pool: { r: 9, i: 45 * lightGain } }); } }
      // sodium street lights at intersections
      for (let gx = -R; gx <= R; gx += 106) for (let gz = -R; gz <= R; gz += 106) {
        const d = Math.hypot(gx, gz); if (d > R * (0.75 + 0.3 * r()) || r() < 0.22) continue;
        if (SL && (h2(Math.round(gx / 106) + T.seed * 31, Math.round(gz / 106) + 7) < 0.45 || d > R * 0.8)) continue;     // dark blocks between the lit ones
        const x = T.x + gx + (r() - 0.5) * 30, z = T.z + gz + (r() < 0.5 ? 0 : 53); lf.add({ pos: [x, H(x, z) + 9, z], color: SODIUM, i: (d < R * 0.4 ? 5 : 3.5) * lightGain, core: 0.4, halo: 0.55, pool: { r: 9, i: 40 * lightGain } });
      }
      // the town's collective spill: the ground inside the town glows (one wide pool, no sprite)
      lf.add({ pos: [T.x, H(T.x, T.z) + R * 0.35, T.z + 40], color: SODIUM, i: 0, core: 0, halo: 0, pool: { r: R * 0.35, i: (4 + T.pop / 1000) * lightGain * (SL ? 0.04 : 1) } });
      // the elevator: concrete silos + headhouse beside the rail, steel bins; 30-45 m; floods and a steady red top light
      const ex = T.x + (r() < 0.5 ? -1 : 1) * (80 + r() * 120), ez = plains.railZ - 26, ey = H(ex, ez), sh = T.seat ? 44 : 30 + r() * 10;
      const nsil = T.seat ? 12 : 4 + Math.floor(r() * 5);
      for (let k = 0; k < nsil; k++) silos.push({ p: [ex + (k % 6) * 9.2 - 23, ey, ez - Math.floor(k / 6) * 9.2], s: [9, sh, 9], c: new THREE.Color(0.62, 0.6, 0.56) });
      heads.push({ p: [ex + 34, ey, ez - 4], s: [11, sh + 16, 12], c: new THREE.Color(0.6, 0.58, 0.54) });
      for (let k = 0; k < 3 + Math.floor(r() * 4); k++) bins.push({ p: [ex - 45 - k * 22, ey, ez - 12], s: [18, 22, 18], c: new THREE.Color(0.55, 0.57, 0.6) });
      lf.add({ pos: [ex + 34, ey + sh + 17, ez - 4], color: OBST, i: 6 * lightGain, core: 0.4, halo: 0.6, minPx: 1.6 });
      for (let k = 0; k < 3; k++) lf.add({ pos: [ex - 20 + k * 30, ey + 12, ez + 14], color: k === 1 ? LED : SODIUM, i: 7 * lightGain, core: 0.6, halo: 0.7, pool: { r: 12, i: 60 * lightGain } });
      if (SL) { lf.add({ pos: [ex, ey + 4, ez + 40], color: '#ffc890', i: 0, core: 0, halo: 0, pool: { r: 55, i: 45 * lightGain } });      // the floods wash the silo faces
        lf.add({ pos: [ex + 34, ey + sh + 8, ez + 6], color: LED, i: 9 * lightGain, core: 0.6, halo: 0.8, pool: { r: 20, i: 30 * lightGain } }); }
      this.elevators.push({ x: ex, z: ez, y: ey, h: sh + 16, town: T });
      // water tower(s)
      for (let k = 0; k < (T.seat ? 2 : 1); k++) { const x = T.x + (r() - 0.5) * R, z = T.z + (r() - 0.5) * R * 0.8, y = H(x, z), s = 44 + r() * 8;
        wtowers.push({ p: [x, y, z], s: [s, s, s], c: new THREE.Color(0.75, 0.77, 0.8) }); lf.add({ pos: [x, y + s * 1.02, z], color: OBST, i: 4 * lightGain, core: 0.3, halo: 0.5, minPx: 1.4 }); }
    }
    this.houses = instanced(world, lf, G.house, houses, { wallFall: 6, name: 'houses' });
    this.trees = instanced(world, lf, G.tree, trees, { wallFall: 8, name: 'trees' });
    this.blocks = instanced(world, lf, G.box, blocks, { wallFall: 8, name: 'mainstreet' });
    this.silos = instanced(world, lf, G.cyl, silos, { wallFall: 16, name: 'silos' });
    this.heads = instanced(world, lf, G.box, heads, { wallFall: 16, name: 'headhouse' });
    this.bins = instanced(world, lf, G.bin, bins, { rough: 0.45, metal: 0.6, wallFall: 12, name: 'bins' });
    this.wt = instanced(world, lf, G.tower, wtowers, { rough: 0.5, metal: 0.2, wallFall: 30, name: 'watertowers' });
  }
  // skyglow records for Atmos.setTowns
  glow(k = 1) { return this.towns.map(T => ({ x: T.x, z: T.z, r: T.r * 2.5 + 1200, i: k * (0.08 + T.pop / 5e4) })); }
}

// ------------------------------------------------------------------ farmsteads: the lone yard light
export class Farmsteads {
  constructor(world, lf, plains, { rect = [-40000, -30000, 30000, 12000], share = 0.3, seed = 6, lightGain = 1, avoid = [] } = {}) {
    const r = rng(seed), hs = [], barns = [], bins = [], trees = [];
    for (let sx = Math.floor(rect[0] / SECTION); sx < rect[2] / SECTION; sx++) for (let sz = Math.floor(rect[1] / SECTION); sz < rect[3] / SECTION; sz++) {
      if (h2(sx * 7 + 1, sz * 13 + 5) > share) continue;
      const x = sx * SECTION + 80, z = sz * SECTION + 80;
      if (avoid.some(t => Math.hypot(x - t.x, z - t.z) < t.r + 600) || Math.abs(z - plains.railZ) < 100 || Math.abs(z - plains.hwyZ) < 100) continue;
      const y = plainsH(plains.creek, x, z);
      hs.push({ p: [x, y, z], s: [11, 7, 14], c: new THREE.Color(0.8, 0.78, 0.72) });
      barns.push({ p: [x + 45, y, z + 30], s: [22, 11, 36], c: r() < 0.6 ? new THREE.Color(0.4, 0.08, 0.05) : new THREE.Color(0.55, 0.56, 0.58) });
      for (let k = 0; k < 2 + Math.floor(r() * 3); k++) bins.push({ p: [x + 20 + k * 11, y, z + 70], s: [10, 12, 10], c: new THREE.Color(0.6, 0.62, 0.64) });
      for (let k = 0; k < 14; k++) trees.push({ p: [x - 30 + r() * 110, y, z - 30 + r() * 10], s: [10, 12 + r() * 6, 10], c: new THREE.Color(0.05, 0.09, 0.03) });
      if (r() < 0.85) lf.add({ pos: [x + 25, y + 8, z + 25], color: r() < 0.5 ? MERCURY : SODIUM, i: 1.5 * lightGain, core: 0.3, halo: 0.4, minPx: 1.2, pool: { r: 8, i: 14 * lightGain } });
    }
    instanced(world, lf, G.house, hs, { wallFall: 6 }); instanced(world, lf, G.house, barns, { wallFall: 6 });
    instanced(world, lf, G.bin, bins, { rough: 0.4, metal: 0.6 }); instanced(world, lf, G.tree, trees, {});
    this.count = hs.length;
  }
}

// ------------------------------------------------------------------ wind farm
function rotorGeo(R = 60) {
  const blades = [];
  for (let k = 0; k < 3; k++) {
    const s = new THREE.Shape(); s.moveTo(0, -1.2); s.lineTo(R * 0.25, -1.9); s.lineTo(R, -0.35); s.lineTo(R, 0.1); s.lineTo(R * 0.2, 1.0); s.lineTo(0, 1.2);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: false }); g.translate(1.6, 0, -0.25); g.rotateZ(k * TAU / 3); blades.push(g.toNonIndexed());
  }
  const hub = new THREE.SphereGeometry(2.0, 12, 8); hub.scale(1, 1, 1.6); blades.push(hub.toNonIndexed());
  const m = mergeGeometries(blades.map(b => { b.deleteAttribute('uv'); return b; })); m.computeVertexNormals(); return m;
}
export class WindFarm {
  // rows: list of { x0, z0, x1, z1 } lines; spacing along the row (~5 rotor diameters cross-wind ~ 500 m)
  // points (pass 2): explicit sites, e.g. ridgeSites() on the high ground at an irregular stagger instead of ruled rows
  constructor(world, lf, plains, { rows = [], points = [], spacing = 480, hub = 90, rotor = 120, seed = 9, beacon = { period: 1.5, duty: 0.3 }, lit = 0.45, windDir = 0.35, rpm = 14, lightGain = 1 } = {}) {
    const r = rng(seed); this.list = [];
    for (const [x, z] of points) this.list.push({ x, z, y: plainsH(plains.creek, x, z), ph: r() * TAU });
    for (const R of rows) { const L = Math.hypot(R.x1 - R.x0, R.z1 - R.z0), n = Math.floor(L / spacing);
      for (let i = 0; i <= n; i++) { const u = i / Math.max(1, n); const x = R.x0 + (R.x1 - R.x0) * u + (r() - 0.5) * 40, z = R.z0 + (R.z1 - R.z0) * u + (r() - 0.5) * 60; this.list.push({ x, z, y: plainsH(plains.creek, x, z), ph: r() * TAU }); } }
    const n = this.list.length;
    const towerG = new THREE.CylinderGeometry(1.5, 2.3, hub, 14, 1).translate(0, hub / 2, 0);
    const nac = new THREE.BoxGeometry(4, 4, 12).translate(0, hub + 1.5, -2);
    const mat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#e8eaea', roughness: 0.55 }), lf, { wallFall: 40 });
    this.towers = new THREE.InstancedMesh(mergeGeometries([towerG.toNonIndexed(), nac.toNonIndexed()]), mat, n);
    this.rotors = new THREE.InstancedMesh(rotorGeo(rotor / 2), mat, n);
    const o = new THREE.Object3D();
    this.list.forEach((T, i) => { o.position.set(T.x, T.y, T.z); o.rotation.set(0, windDir, 0); o.scale.set(1, 1, 1); o.updateMatrix(); this.towers.setMatrixAt(i, o.matrix); });
    this.towers.frustumCulled = this.rotors.frustumCulled = false;
    world.scene.add(this.towers, this.rotors);
    this.hub = hub; this.windDir = windDir; this.omega = rpm / 60 * TAU;
    // synchronized L-864 red beacons on the nacelles (most turbines lit, as the FAA perimeter/spacing rule does)
    this.beacons = [];
    this.list.forEach((T, i) => { if (r() < lit) this.beacons.push(lf.add({ pos: [T.x, T.y + hub + 4.2, T.z], color: OBST, i: 4 * lightGain, core: 0.5, halo: 0.25, minPx: 1.4, blink: { period: beacon.period, duty: beacon.duty, phase: 0 } })); });
    this.update(0);
  }
  update(t) {
    const o = new THREE.Object3D(), fwd = new THREE.Vector3(Math.sin(this.windDir), 0, Math.cos(this.windDir));
    this.list.forEach((T, i) => { o.position.set(T.x + fwd.x * 4.5, T.y + this.hub + 1.5, T.z + fwd.z * 4.5); o.rotation.set(0, this.windDir, 0); o.rotateZ(T.ph + t * this.omega); o.updateMatrix(); this.rotors.setMatrixAt(i, o.matrix); });
    this.rotors.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ traffic: light pairs moving along straight lanes
// lanes: [{ a:[x,y,z], b:[x,y,z], n, speed, dir: +1/-1, gap }] -> headlights (white, facing travel) and taillights (red)
export class Traffic {
  constructor(lf, lanes, { seed = 12, headI = 3, tailI = 1.2, heightFn = null, truckShare = 0.6, pool = true } = {}) {
    const r = rng(seed); this.lf = lf; this.cars = []; this.heightFn = heightFn;
    for (const L of lanes) {
      const len = Math.hypot(L.b[0] - L.a[0], L.b[2] - L.a[2]);
      for (let k = 0; k < L.n; k++) {
        const car = { L, len, s0: r() * len, v: L.speed * (0.92 + r() * 0.16), truck: r() < truckShare, ids: [] };
        const hw = car.truck ? 1.0 : 0.8, hh = car.truck ? 1.1 : 0.7;
        for (const side of [-1, 1]) {
          car.ids.push({ off: [side * hw, hh, 0], id: lf.lights.length }); lf.add({ pos: [0, 0, 0], color: '#fff4e6', i: headI, core: 0.12, halo: 0.55, minPx: 1.2 });
          if (pool && side === 1) { car.ids.push({ off: [0, 1, 0], ahead: 16, id: lf.lights.length }); lf.add({ pos: [0, 0, 0], color: '#fff4e6', i: 0, core: 0, halo: 0, pool: { r: 6, i: headI * 0.15 } }); }
          car.ids.push({ off: [side * hw, hh, -1], id: lf.lights.length, tail: true }); lf.add({ pos: [0, 0, 0], color: '#ff1808', i: tailI, core: 0.1, halo: 0.3, minPx: 1.0 });
        }
        this.cars.push(car);
      }
    }
  }
  update(t) {
    for (const c of this.cars) {
      const L = c.L, s = ((c.s0 + c.v * t) % c.len + c.len) % c.len, u = L.dir > 0 ? s / c.len : 1 - s / c.len;
      const x = L.a[0] + (L.b[0] - L.a[0]) * u, z = L.a[2] + (L.b[2] - L.a[2]) * u, y = this.heightFn ? this.heightFn(x, z) : L.a[1];
      const dx = (L.b[0] - L.a[0]) / c.len * L.dir, dz = (L.b[2] - L.a[2]) / c.len * L.dir, px = -dz, pz = dx;   // travel dir, and its left
      for (const o of c.ids) { const back = o.tail ? -(c.truck ? 18 : 4.5) : (o.ahead || 0);
        this.lf.setPos(o.id, x + px * o.off[0] + dx * back, y + o.off[1], z + pz * o.off[0] + dz * back); }
    }
  }
}

// ------------------------------------------------------------------ gas flare
export function flare(lf, x, y, z, { i = 60, color = '#ff7a1e' } = {}) {
  return lf.add({ pos: [x, y + 12, z], color, i, core: 2.5, halo: 1.4, minPx: 2.2, pool: { r: 40, i: i * 0.35 } });
}

// ------------------------------------------------------------------ pass 2: turbines follow the high ground, not rows
// candidates scored by ridge-ness (height above the mean of a 600 m ring), leases as noise patches, a Poisson minimum spacing
export function ridgeSites(plains, rect, { n = 60, minDist = 430, seed = 17, lease = 0.45, keep = 0.35 } = {}) {
  const r = rng(seed), H = (x, z) => plainsH(plains.creek, x, z), cand = [];
  for (let i = 0; i < n * 60; i++) { const x = rect[0] + (rect[2] - rect[0]) * r(), z = rect[1] + (rect[3] - rect[1]) * r();
    if (h2(Math.floor(x / 5200) + 91, Math.floor(z / 5200) + 13) > lease + 0.35 * Math.sin(x * 0.00021 + z * 0.00013)) continue;       // leases
    let m = 0; for (let k = 0; k < 8; k++) { const a = k * TAU / 8; m += H(x + Math.cos(a) * 600, z + Math.sin(a) * 600); }
    cand.push({ x, z, s: H(x, z) - m / 8 + H(x, z) * 0.15 }); }
  cand.sort((a, b) => b.s - a.s);
  const top = cand.slice(0, Math.max(n, Math.floor(cand.length * keep))), out = [];
  for (const c of top) { if (out.length >= n) break; if (out.every(o => Math.hypot(o[0] - c.x, o[1] - c.z) > minDist * (0.85 + 0.4 * h2(o[0] | 0, c.z | 0)))) out.push([c.x, c.z]); }
  return out;
}

// ------------------------------------------------------------------ pass 2: a center pivot machine (the Dirt Meridian foreground)
// 6-5/8 in pipeline on A-frame towers every 54 m, bowstring truss rods under each span, wheels, the end overhang and gun
export class PivotRig {
  constructor(world, lf, plains, { x, z, angle = 0, len = 392, span = 54, h = 3.9, patch = patchMaterial, color = '#b8bcbe' } = {}) {
    const H = (px, pz) => plainsH(plains.creek, px, pz), parts = [], ca = Math.cos(angle), sa = Math.sin(angle);
    const P = (d, y) => { const px = x + ca * d, pz = z + sa * d; return [px, H(px, pz) + y, pz]; };
    const rod = (a, b, t) => { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B); const g = new THREE.CylinderGeometry(t, t, L, 5, 1); g.rotateX(Math.PI / 2);
      g.applyMatrix4(new THREE.Matrix4().lookAt(A, B, new THREE.Vector3(0, 1, 0))); g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2); return g.toNonIndexed(); };
    const nS = Math.floor(len / span);
    for (let k = 0; k < nS; k++) { const d0 = k * span, d1 = (k + 1) * span, dm = (d0 + d1) / 2;
      parts.push(rod(P(d0, h), P(d1, h), 0.085));                                                  // the pipeline
      const sag = P(dm, h - 1.5);
      for (const sd of [-0.35, 0.35]) { const off = (q) => [q[0] - sa * sd, q[1], q[2] + ca * sd]; parts.push(rod(off(P(d0 + 0.5, h)), off(sag), 0.03), rod(off(sag), off(P(d1 - 0.5, h)), 0.03)); }
      for (let q = 1; q < 6; q++) { const dq = d0 + q * span / 6, sy = h - 1.5 * Math.sin(Math.PI * q / 6); parts.push(rod(P(dq, h), P(dq, sy), 0.022)); }
      for (let q = 0; q < 9; q++) parts.push(rod(P(d0 + (q + 0.5) * span / 9, h), P(d0 + (q + 0.5) * span / 9, 1.6), 0.012));   // drops
      // the tower at the span's outer end: A-frame, base beam, two wheels
      const tp = P(d1, h), tx = -sa, tz = ca;
      for (const sd of [-1, 1]) { const f = [tp[0] + tx * sd * 2.1, H(tp[0], tp[2]) + 0.7, tp[2] + tz * sd * 2.1];
        parts.push(rod(tp, f, 0.07));
        const w = new THREE.CylinderGeometry(0.62, 0.62, 0.38, 14); w.rotateZ(Math.PI / 2); w.rotateY(-angle); w.translate(f[0], f[1] - 0.05, f[2]); parts.push(w.toNonIndexed()); }
      parts.push(rod([tp[0] - tx * 2.1, H(tp[0], tp[2]) + 0.7, tp[2] - tz * 2.1], [tp[0] + tx * 2.1, H(tp[0], tp[2]) + 0.7, tp[2] + tz * 2.1], 0.06));
      const gb = new THREE.BoxGeometry(0.5, 0.5, 0.5); gb.translate(tp[0], H(tp[0], tp[2]) + 0.8, tp[2]); parts.push(gb.toNonIndexed()); }
    parts.push(rod(P(nS * span, h), P(len + 20, h - 0.3), 0.06));                                    // overhang + end gun
    const piv = new THREE.CylinderGeometry(0.6, 1.8, 5.2, 4); piv.translate(...P(0, 2.6)); parts.push(piv.toNonIndexed());
    const g = mergeGeometries(parts.map(q => { for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal') q.deleteAttribute(k); return q; }));
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.75 }); if (patch && lf) patch(m, lf, { wallFall: 8 });
    this.mesh = new THREE.Mesh(g, m); world.scene.add(this.mesh);
  }
}
