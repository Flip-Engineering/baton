// WEATHER (WORLDS studio c1): the plains storm.
//   stormHook()  an Atmos hook: a 2.5D shelf cloud marched per sky pixel. The underside is a height field (lowest at the
//                leading edge, stepping up in laminar tiers, rising to the storm base); rays that cross the leading edge
//                above the underside hit the storm's front wall (cauliflower face lit by the low sun). Rain shafts are
//                columns of density under the base, applied to sky and land by true distance. Lightning lights the base
//                from inside (uFlash) and the ground (uFlashG, read by the ground and the wheat).
//   Wheat        instanced tufts (7 stalks each, 0.8-1 m) near the camera, swaying, lit by the sun where the light gets
//                through (a lit strip), translucent against the light, flashed by lightning.
//   Bolt         a jagged, branching discharge as HDR overlay points (thick enough to read at 1080x1920 through bloom).
import * as THREE from 'three';
import { ATMOS_GLSL } from './atmos3d.js';
import { rng } from './americana.js';

export function stormHook({ edgeZ0 = -1300, curve = 0.00003, edgeH = 560, base = 1150, deckX1 = 7000, sun = [-0.45, 0.16, 0.88],
  shaft = { z0: -4000, th: 0.42 }, flash = { x: 2600, z: -8800, i: 0, r: 2200 } } = {}) {
  const uniforms = {
    uEdgeZ0: { value: edgeZ0 }, uCurve: { value: curve }, uEdgeH: { value: edgeH }, uBaseH: { value: base }, uDeckX1: { value: deckX1 },
    uStSun: { value: new THREE.Vector3(...sun).normalize() }, uShaftZ0: { value: shaft.z0 }, uShaftTh: { value: shaft.th },
    uBolt: { value: new THREE.Vector4(flash.x, flash.z, flash.r, flash.i) },
    uShelfAmb: { value: new THREE.Color('#2c3644').multiplyScalar(0.55) }, uShelfSun: { value: new THREE.Color('#ffb070').multiplyScalar(2.2) },
    uWallAlb: { value: new THREE.Color('#d8cfc4') }, uRainCol: { value: new THREE.Color('#44505c').multiplyScalar(0.22) },
  };
  const glsl = /* glsl */`
    uniform float uEdgeZ0, uCurve, uEdgeH, uBaseH, uDeckX1, uShaftZ0, uShaftTh; uniform vec3 uStSun, uShelfAmb, uShelfSun, uWallAlb, uRainCol; uniform vec4 uBolt;
    float edgeZ(float x){ return uEdgeZ0 - uCurve*x*x + 180.*sin(x*.0011); }
    float deckIn(vec2 p){ return (1. - smoothstep(uDeckX1 - 1500., uDeckX1, p.x + 500.*sin(p.y*.0004 + 1.3))); }
    float fbm3(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 3; i++){ s += a*a_n2(p); p = mat2(1.6,1.2,-1.2,1.6)*p + 3.1; a *= .5; } return s / .875 * .9375; }
    float topH(vec2 p, float b){ return uEdgeH + b * .85 + (fbm3(p*.003) - .5) * 260. ; }   // the shelf's front face slopes back ~40 deg
    float behind(vec2 p){ return edgeZ(p.x) - p.y; }                                   // > 0 under the deck
    float baseC(vec2 p){ float b = behind(p); float k = b / 170., st = floor(k) + smoothstep(.72, 1., fract(k));
      return min(uEdgeH + min(st, 3.) * 75. + max(b - 560., 0.) * .06 + (fbm3(p*vec2(.0009, .0045)) - .5) * 70., uBaseH); }
    float baseH(vec2 p){
      float b = behind(p);
      float k = b / 170., st = floor(k) + smoothstep(.72, 1., fract(k));
      float h = uEdgeH + min(st, 3.) * 75. + max(b - 560., 0.) * .06;
      h += (a_fbm(p*vec2(.0009, .0045)) - .5) * 70.;                                 // laminar striations along the edge
      h -= smoothstep(.62, .8, a_fbm(p*.0021 + 7.)) * 160. * smoothstep(0., 2000., b);   // scud and lowerings
      return min(h, uBaseH + (a_fbm(p*.0008) - .5)*140.);
    }
    float shaftD(vec2 p){ float b = behind(p); if (b < 0. || p.y > uShaftZ0) return 0.;
      float n = a_fbm(vec2(p.x*.00055, p.y*.00018) + 3.3);
      return smoothstep(uShaftTh, uShaftTh + .12, n) * smoothstep(uShaftZ0, uShaftZ0 - 2500., p.y); }
    vec3 boltLight(vec2 p){ vec2 q = p - uBolt.xy; return vec3(.75, .8, 1.) * uBolt.w / (1. + dot(q, q) / (uBolt.z*uBolt.z)); }
    vec3 atmosHook(vec3 d, float dist, vec3 c, float isSky){
      if (uCamPos.y > uEdgeH) return c;
      // rain shafts between the camera and whatever is behind (land or cloud): 12 samples to 30 km, under 900 m
      float tMax = min(dist, 30000.);
      float cloudT = 1e7; vec3 cc = vec3(0.); float hit = 0.;
      if (isSky < .5 && dist < 2500.) return c;                                  // the near field: no weather between us and it
      if (d.y > .0005) {
        float t0 = max((uEdgeH - 250. - uCamPos.y) / d.y, 0.), t1 = min((4200. - uCamPos.y) / d.y, 45000.);
        float tp = t0; float below = 1.;
        float jit = fract(sin(dot(d.xy*917.3 + d.z*33.1, vec2(12.9898, 78.233))) * 43758.5453);   // dither the march: noise, not stairs
        for (int i = 0; i < 36; i++) {
          float t = mix(t0, t1, pow((float(i) + jit) / 36., 2.)); vec3 p = uCamPos + d*t; float b = behind(p.xz);
          bool inC = b >= 0. && deckIn(p.xz) > .5 && p.y >= baseC(p.xz) && p.y <= topH(p.xz, b);
          if (inC) {
            float lo = tp, hi = t; for (int j = 0; j < 6; j++) { float m = .5*(lo + hi); vec3 q = uCamPos + d*m; float bq = behind(q.xz);
              if (bq >= 0. && q.y >= baseC(q.xz) && q.y <= topH(q.xz, bq)) hi = m; else lo = m; }
            vec3 q = uCamPos + d*lo; cloudT = hi; hit = q.y < baseC(q.xz) + 5. ? 1. : 2.; break; }
          tp = t;
        }
      }
      if (hit > .5 && cloudT < dist) {
        vec3 p = uCamPos + d*cloudT;
        if (hit < 1.5) {                                                           // underside
          float e = 6.; vec3 n = normalize(vec3(baseH(p.xz - vec2(e, 0.)) - baseH(p.xz + vec2(e, 0.)), -2.*e, baseH(p.xz - vec2(0., e)) - baseH(p.xz + vec2(0., e))));
          n = -n;                                                                  // pointing down/out of the cloud
          float sunL = max(dot(n, uStSun), 0.);
          float b = behind(p.xz), near = exp(-b / 900.);
          float tex = .7 + .6*a_fbm(p.xz*vec2(.004, .012));
          cc = uShelfAmb * tex * (.5 + .5*near) + uShelfSun * sunL * near * near * tex * .5 + boltLight(p.xz) * (.6 + .4*tex);
        } else {                                                                   // front wall, facing the camera and the sun
          vec2 q = vec2(p.x, p.y) * .0022; float f = a_fbm(q) * .7 + a_fbm(q*3.1 + 5.) * .3, fx = a_fbm(q + vec2(.02, 0.)) - a_fbm(q), fy = a_fbm(q + vec2(0., .02)) - a_fbm(q);
          vec3 n = normalize(vec3(-fx*8., .75 - fy*8., .66));                     // the face leans back; soft billows
          float sunL = max(dot(n, uStSun), 0.), ao = .35 + .65*smoothstep(.3, .75, f);
          float rim = smoothstep(uEdgeH + 900., uEdgeH, p.y);                     // gold only low on the face, near the rim
          cc = uWallAlb * (uShelfSun * sunL * ao * (.12 + .5*rim) + uShelfAmb * (1. + .6*f));
          cc += boltLight(p.xz) * .5;
        }
        float tr = exp(-hazeTau(d, cloudT));
        cc = cc*tr + hazeAt(d, cloudT)*(1. - tr);
        float edge = 1.;
        if (hit > 1.5) { vec3 p2 = uCamPos + d*(cloudT + 60.); float b2 = behind(p2.xz); edge = smoothstep(0., 140., topH(p2.xz, b2) - p2.y + 40.*a_n2(p.xz*.02)); }  // soft top
        c = mix(c, cc, edge); tMax = min(tMax, cloudT);
      }
      // rain
      float acc = 0.; vec3 rc = vec3(0.);
      for (int i = 0; i < 9; i++) { float t = tMax * (float(i) + .5) / 9.; vec3 p = uCamPos + d*t; if (p.y > baseC(p.xz)) continue;
        float s = shaftD(p.xz) * (tMax / 9.) / 3500.; float a = (1. - acc) * (1. - exp(-s));
        rc += a * (uRainCol * (.8 + .4*a_n2(p.xz*.01)) + boltLight(p.xz) * .25); acc += a; }
      return c * (1. - acc) + rc;
    }`;
  return { glsl, uniforms };
}

// ------------------------------------------------------------------ wheat tufts
export class Wheat {
  // pass 2 (opt-in): heads: 2 = bigger awned ears (8-10 cm, awns catching the light), gust: travelling gust fronts across the
  // field (the wave you see run through wheat), sunNear: the near field in the sun (no strip mask under 'near' m)
  constructor(atmos, world, { n = 16000, near = 3, far = 70, spread = 0.62, seed = 5, strip = null, flashU = null, groundH = null, yawSlope = 0, heads = 1, gust = 0, sunNear = 0 } = {}) {
    const r = rng(seed);
    // one tuft: 7 stalks (4-segment strips) with an ear on each
    const P = [], N = [], H = [];
    for (let k = 0; k < 7; k++) {
      const ox = (r() - 0.5) * 0.28, oz = (r() - 0.5) * 0.28, h = 0.8 + r() * 0.22, lean = (r() - 0.5) * 0.12, a = r() * Math.PI;
      const sx = Math.cos(a), sz = Math.sin(a);
      for (let sgi = 0; sgi < 4; sgi++) { const y0 = h * sgi / 4, y1 = h * (sgi + 1) / 4, w0 = 0.006, w1 = 0.005;
        const l0 = lean * (sgi / 4) ** 2, l1 = lean * ((sgi + 1) / 4) ** 2;
        const q = [[ox - sx * w0 + l0, y0, oz - sz * w0], [ox + sx * w0 + l0, y0, oz + sz * w0], [ox + sx * w1 + l1, y1, oz + sz * w1], [ox - sx * w1 + l1, y1, oz - sz * w1]];
        P.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]); for (let j = 0; j < 6; j++) { N.push(-sz, 0.2, sx); H.push(y0 / h + (j >= 2 && j !== 3 ? 0.25 : 0)); } }
      // ear: an elongated double diamond 0.09 m, 0.024 m wide (heads: 2 -> 0.1 m, 0.035 m wide, nodding, with awns)
      const hs = heads >= 2 ? 1.25 : 1, hw = heads >= 2 ? 0.018 : 0.013, nod = heads >= 2 ? 0.03 : 0;
      const ex = ox + lean, ey = h, e = [[ex, ey, oz], [ex + sx * hw + nod * 0.3, ey + 0.045 * hs, oz + sz * hw], [ex + nod, ey + 0.1 * hs, oz], [ex - sx * hw + nod * 0.3, ey + 0.045 * hs, oz - sz * hw]];
      P.push(...e[0], ...e[1], ...e[2], ...e[0], ...e[2], ...e[3]); for (let j = 0; j < 6; j++) { N.push(-sz, 0.4, sx); H.push(1.2); }
      if (heads >= 2) for (let a = 0; a < 5; a++) { const ay = ey + 0.03 + a * 0.018, ax = ex + nod * (a / 5), L = 0.07 + 0.02 * r(), dx = (r() - 0.5) * 0.03;    // awns: thin strips up past the ear
        const q = [[ax - sx * 0.0015, ay, oz - sz * 0.0015], [ax + sx * 0.0015, ay, oz + sz * 0.0015], [ax + dx + nod * 0.5 + sx * 0.001, ay + L, oz + sz * 0.001], [ax + dx + nod * 0.5 - sx * 0.001, ay + L, oz - sz * 0.001]];
        P.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]); for (let j = 0; j < 6; j++) { N.push(-sz, 0.6, sx); H.push(1.35); } }
    }
    const base = new THREE.BufferGeometry(); base.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); base.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); base.setAttribute('hh', new THREE.Float32BufferAttribute(H, 1));
    const g = new THREE.InstancedBufferGeometry(); g.index = null; for (const k of ['position', 'normal', 'hh']) g.setAttribute(k, base.getAttribute(k));
    const I = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { const z = -(near + (far - near) * Math.pow(r(), 1.7)), x = Math.abs(z) * yawSlope + (r() - 0.5) * 2 * (Math.abs(z) * spread + 1.5);
      I.set([x, groundH ? groundH(x, z) : 0, z, r() * 6.28], i * 4); }
    g.setAttribute('ip', new THREE.InstancedBufferAttribute(I, 4)); g.instanceCount = n;
    const A = atmos, K = A.key;
    this.U = { ...A.U, uKeyDir: { value: new THREE.Vector3() }, uKeyCol: { value: new THREE.Color() }, uHemiS: { value: new THREE.Color() }, uHemiG: { value: new THREE.Color() },
      uStrip: { value: new THREE.Vector4(...(strip || [-5500, 900, 300, 0])) }, uFlashG: flashU || { value: 0 }, uAlb: { value: new THREE.Color(heads >= 2 ? '#a88a52' : '#c9a45c') },
      uGust: { value: gust }, uSunNear: { value: sunNear } };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: this.U, side: THREE.DoubleSide,
      vertexShader: `attribute vec4 ip; attribute float hh; uniform float uTime, uGust; varying vec3 vN; varying float vH; varying vec3 vWP;
        void main(){ vec3 p = position; float sw = (sin(uTime*1.9 + ip.w + ip.x*.35 + ip.z*.2) * .5 + sin(uTime*3.7 + ip.w*2.) * .2) * .09;
          if (uGust > 0.) { float g = ip.x*.8 - ip.z*.35 - uTime*6.5; float front = pow(max(sin(g*.18), 0.), 6.) + .5*pow(max(sin(g*.071 + 1.7), 0.), 8.);   // gust fronts running across
            sw = sw * .6 + front * uGust * .35 + uGust * .08; }
          p.x += sw * p.y * p.y; p.z += sw * .4 * p.y * p.y;
          float c = cos(ip.w), s = sin(ip.w); p.xz = mat2(c, -s, s, c) * p.xz;
          vec3 w = p + ip.xyz; vWP = w; vN = normalize(vec3(mat2(c, -s, s, c) * normal.xz, normal.y).xzy); vH = hh;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.); }`,
      fragmentShader: ATMOS_GLSL + `uniform vec3 uKeyDir, uKeyCol, uHemiS, uHemiG, uAlb; uniform vec4 uStrip; uniform float uFlashG, uSunNear; varying vec3 vN; varying float vH; varying vec3 vWP;
        void main(){ vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
          float lit = 1. - smoothstep(uStrip.y - uStrip.z, uStrip.y, abs(vWP.z - uStrip.x + uStrip.w*sin(vWP.x*.0007)));
          if (uSunNear > 0.) lit = max(lit, 1. - smoothstep(uSunNear * .7, uSunNear, length(vWP.xz - uCamPos.xz)));
          vec3 L = normalize(uKeyDir);
          float diff = max(dot(n, L), 0.) + .45*max(-dot(n, L), 0.);                  // stalks transmit the light behind them
          float ao = mix(.35, 1., clamp(vH, 0., 1.)); ao *= ao;                       // dark at the root, light at the ears
          vec3 alb = uAlb * mix(.7, 1.1, clamp(vH - .8, 0., 1.)) * (.85 + .3*fract(sin(dot(floor(vWP.xz*3.), vec2(12.9, 78.2)))*43758.5));
          vec3 c = alb * (uKeyCol * diff * lit + mix(uHemiG, uHemiS, n.y*.5 + .5) + vec3(.75, .8, 1.) * uFlashG) * ao;
          gl_FragColor = vec4(c, 1.); }` }));
    this.mesh.frustumCulled = false; this.mesh.userData.noReflect = true; world.scene.add(this.mesh);
    A.pre.push(() => { const u = this.U; u.uKeyDir.value.copy(K.position).normalize(); u.uKeyCol.value.copy(K.color).multiplyScalar(K.intensity);
      const hm = A.world._hemi; if (hm) { u.uHemiS.value.copy(hm.color).multiplyScalar(hm.intensity); u.uHemiG.value.copy(hm.groundColor).multiplyScalar(hm.intensity); } });
  }
}

// ------------------------------------------------------------------ lightning bolt (HDR points along a branching path)
export class Bolt {
  constructor(atmos, { top = [2600, 900, -8800], ground = [2350, 0, -8700], seed = 3, width = 1.6, i = 120 } = {}) {
    const r = rng(seed), pts = [];
    const seg = (a, b, depth, w) => { if (depth === 0) { const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(2, Math.ceil(L / 3)); for (let k = 0; k < n; k++) { const u = k / n; pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, w]); } return; }
      const m = [(a[0] + b[0]) / 2 + (r() - 0.5) * Math.abs(a[1] - b[1]) * 0.35, (a[1] + b[1]) / 2 + (r() - 0.5) * 20, (a[2] + b[2]) / 2 + (r() - 0.5) * Math.abs(a[1] - b[1]) * 0.2];
      seg(a, m, depth - 1, w); seg(m, b, depth - 1, w);
      if (depth > 2 && r() < 0.45) { const L = Math.abs(a[1] - b[1]) * 0.6; seg(m, [m[0] + (r() - 0.5) * L, m[1] - L * (0.4 + 0.4 * r()), m[2] + (r() - 0.5) * L * 0.4], depth - 2, w * 0.45); } };
    seg(top, ground, 7, 1);
    const P = new Float32Array(pts.length * 3), Wd = new Float32Array(pts.length);
    pts.forEach((p, k) => { P.set(p.slice(0, 3), k * 3); Wd[k] = p[3]; });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('bw', new THREE.BufferAttribute(Wd, 1));
    this.U = { ...atmos.U, uI: { value: 0 }, uW: { value: width }, uRes: atmos.frameU.uRes, uFovY: { value: 1 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.U, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: ATMOS_GLSL + `attribute float bw; uniform float uI, uW, uFovY; uniform vec2 uRes; varying float vB;
        void main(){ vec4 mv = viewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; float d = -mv.z;
          gl_PointSize = max(uW * bw * uRes.y / (2. * tan(uFovY*.5) * d) * 3., 1.6 * bw + .8);
          vB = uI * bw * exp(-hazeTau(normalize(position - uCamPos), d) * .6); }`,
      fragmentShader: `varying float vB; void main(){ float r = length(gl_PointCoord - .5); gl_FragColor = vec4(vec3(.85, .88, 1.) * vB * smoothstep(.5, .15, r), 1.); }` }));
    this.points.frustumCulled = false; this.points.userData.noReflect = true; atmos.overlay.add(this.points);
    this.top = top; this.ground = ground;
  }
  set(i, fovDeg) { this.U.uI.value = i; this.U.uFovY.value = fovDeg * Math.PI / 180; }
}
