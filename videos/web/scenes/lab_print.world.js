// LAB / PRINT source world: a procession of sculpted workers marching out of a colossal monument (stepped
// drums, fluted ribs, a 16 m statue with a raised fist, a red banner), low sun behind, long shadows toward
// the camera. Built for the presses: solid volumes, close framing, and metric UVs everywhere so the G-buffer
// isolines (lib/fx/gbuffer.js) run round the limbs, drums and ground like a burin would.
// Everything is a pure function of t.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../lib/kit.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerpV = (a, b, k) => a.clone().lerp(b, k);

// ------------------------------------------------------------------ sweep: tube / lathe with per-point elliptic radii
// pts: Vector3[], rad: r | [rx, rz] per point. uv: u = arc length (m), v = angle * mean radius (m). Vertex colour.
function sweep(pts, rad, { radial = 10, color = '#222', ref = null, closed = false } = {}) {
  const n = pts.length, m = radial, pos = [], uvs = [], col = [], idx = [], c = new THREE.Color(color);
  const T = V(0, 0, 0), N = V(0, 0, 0), B = V(0, 0, 0); let prevN = null, s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) s += pts[i].distanceTo(pts[i - 1]);
    const a = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)], b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    T.subVectors(b, a).normalize();
    if (!prevN) { const r = ref || (Math.abs(T.y) > 0.9 ? V(0, 0, 1) : V(0, 1, 0)); N.crossVectors(r, T); if (N.lengthSq() < 1e-8) N.set(1, 0, 0); N.normalize(); }
    else { N.copy(prevN).addScaledVector(T, -prevN.dot(T)).normalize(); }
    prevN = N.clone(); B.crossVectors(T, N).normalize();
    const r = Array.isArray(rad[i]) ? rad[i] : [rad[i], rad[i]];
    for (let j = 0; j <= m; j++) {
      const an = j / m * Math.PI * 2, ca = Math.cos(an), sa = Math.sin(an);
      pos.push(pts[i].x + N.x * ca * r[0] + B.x * sa * r[1], pts[i].y + N.y * ca * r[0] + B.y * sa * r[1], pts[i].z + N.z * ca * r[0] + B.z * sa * r[1]);
      uvs.push(s, an * (r[0] + r[1]) * 0.5); col.push(c.r, c.g, c.b);
    }
  }
  const rows = closed ? n : n - 1;
  for (let i = 0; i < rows; i++) for (let j = 0; j < m; j++) {
    const a = i * (m + 1) + j, b = ((i + 1) % n) * (m + 1) + j; idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  // winding check: normals must point away from the centreline
  const k = Math.floor(n / 2) * (m + 1) + 1, P = g.attributes.position, Nn = g.attributes.normal;
  const out = V(P.getX(k), P.getY(k), P.getZ(k)).sub(pts[Math.floor(n / 2)]);
  if (out.dot(V(Nn.getX(k), Nn.getY(k), Nn.getZ(k))) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  return g.toNonIndexed();
}

// ------------------------------------------------------------------ a worker, posed
// mode: 'swing' (marching), 'fist' (right fist raised), 'pole' (carrying a banner pole); ph = stride phase;
// costume 0 = flat cap + long coat, 1 = bare head + jacket + red scarf; lod 2 = near, 1 = mid, 0 = far (~150 tris)
const PAL = { coat: '#4a403a', jacket: '#5c4c40', trousers: '#2c2724', boots: '#121010', skin: '#b98a68', cap: '#1c1817', scarf: '#b3141f', pole: '#4a3a2c', hair: '#1a1412' };
export function figure({ mode = 'swing', ph = 0, costume = 0, lod = 1 } = {}) {
  const R = [3, 5, 8][lod], Rs = [4, 7, 12][lod], Rh = [4, 6, 10][lod], Rm = [3, 4, 6][lod], parts = [], far = lod === 0;
  const thin = a => lod === 2 ? a : a.filter((_, i) => i % (far ? 3 : 2) === 0 || i === a.length - 1);
  const add = (pts, rad, color, o = {}) => parts.push(sweep(pts, rad, { radial: o.radial || R, color, ...o }));
  const legs = [];
  for (const side of [-1, 1]) {
    const phs = side < 0 ? ph : ph + Math.PI, a = 0.42 * Math.sin(phs), k = 0.12 + 0.55 * Math.max(0, Math.sin(phs + 1.4));
    const hip = V(side * 0.1, 0.94, 0), knee = hip.clone().add(V(0, -Math.cos(a) * 0.46, Math.sin(a) * 0.46));
    legs.push({ side, hip, knee, ankle: knee.clone().add(V(0, -Math.cos(a - k) * 0.45, Math.sin(a - k) * 0.45)) });
  }
  const lift = 0.1 - Math.min(...legs.map(l => l.ankle.y)), up = V(0, lift, 0);
  for (const l of legs) {
    const [h, kn, an] = [l.hip.add(up), l.knee.add(up), l.ankle.add(up)];
    if (lod < 2) { add([h, kn, an.clone().add(V(0, -0.08, 0.04))], [0.092, 0.066, 0.05], PAL.trousers); continue; }
    add([h, lerpV(h, kn, 0.5), kn, lerpV(kn, an, 0.5), an], [0.092, 0.082, 0.064, 0.056, 0.05], PAL.trousers);
    add([an.clone().add(V(0, 0.01, -0.05)), an.clone().add(V(0, -0.04, 0.04)), an.clone().add(V(0, -0.055, 0.13)), an.clone().add(V(0, -0.06, 0.17))],
      [[0.05, 0.055], [0.056, 0.05], [0.045, 0.035], [0.02, 0.015]], PAL.boots, { ref: V(0, 1, 0), radial: Rm });
  }
  const lean = y => (y - 0.94) * 0.1;
  const tp = (y, rx, rz) => [V(0, y + lift, lean(y)), [rx, rz]];
  const torso = costume === 0
    ? [tp(0.64, 0.215, 0.175), tp(0.8, 0.195, 0.155), tp(0.95, 0.178, 0.132), tp(1.08, 0.168, 0.122), tp(1.22, 0.19, 0.13), tp(1.34, 0.214, 0.134), tp(1.42, 0.22, 0.122), tp(1.47, 0.15, 0.09), tp(1.52, 0.066, 0.06), tp(1.58, 0.056, 0.055)]
    : [tp(0.86, 0.182, 0.138), tp(0.97, 0.172, 0.128), tp(1.1, 0.168, 0.122), tp(1.23, 0.19, 0.13), tp(1.34, 0.212, 0.132), tp(1.42, 0.218, 0.12), tp(1.47, 0.15, 0.09), tp(1.52, 0.066, 0.06), tp(1.58, 0.056, 0.055)];
  add(thin(torso).map(x => x[0]), thin(torso).map(x => x[1]), costume === 0 ? PAL.coat : PAL.jacket, { radial: Rs });
  // head (+ cap or hair)
  const hz = lean(1.65) + 0.02, hp = (y, rx, rz, dz = 0) => [V(0, y + lift, hz + dz), [rx, rz]];
  const head = [hp(1.53, 0.05, 0.05), hp(1.57, 0.058, 0.06), hp(1.6, 0.082, 0.09, 0.01), hp(1.65, 0.096, 0.104, 0.008), hp(1.7, 0.1, 0.106), hp(1.75, 0.092, 0.098), hp(1.79, 0.064, 0.07), hp(1.815, 0.012, 0.012)];
  add(thin(head).map(x => x[0]), thin(head).map(x => x[1]), PAL.skin, { radial: Rh });
  if (costume === 0 && !far) {
    const cp = (y, rx, rz) => [V(0, y + lift, hz + 0.012), [rx, rz]];
    const cap = [cp(1.725, 0.106, 0.114), cp(1.76, 0.116, 0.126), cp(1.8, 0.108, 0.12), cp(1.825, 0.066, 0.078), cp(1.835, 0.006, 0.006)];
    add(cap.map(x => x[0]), cap.map(x => x[1]), PAL.cap, { radial: Rh });
    add([V(0, 1.742 + lift, hz + 0.07), V(0, 1.736 + lift, hz + 0.14), V(0, 1.73 + lift, hz + 0.19)], [[0.095, 0.012], [0.085, 0.01], [0.035, 0.006]], PAL.cap, { ref: V(0, 1, 0), radial: Rm });
  } else if (!far) {
    const hr = (y, rx, rz) => [V(0, y + lift, hz - 0.01), [rx, rz]];
    const hair = [hr(1.68, 0.104, 0.108), hr(1.74, 0.1, 0.106), hr(1.79, 0.074, 0.08), hr(1.822, 0.014, 0.014)];
    add(hair.map(x => x[0]), hair.map(x => x[1]), PAL.hair, { radial: Rh });
    const ring = []; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; ring.push(V(Math.cos(a) * 0.12, 1.48 + lift + Math.sin(a) * 0.01, lean(1.48) + Math.sin(a) * 0.1)); }
    add(ring, ring.map(() => 0.042), PAL.scarf, { closed: true, radial: Rm });
  }
  // arms
  const arm = (side, pts) => {
    add(thin(pts).map(p => p.clone().add(up)), thin([0.072, 0.064, 0.056, 0.05, 0.044]), costume === 0 ? PAL.coat : PAL.jacket);
    if (far) return;
    const w = pts[4].clone().add(up), d = pts[4].clone().sub(pts[3]).normalize();
    add([w.clone().addScaledVector(d, -0.01), w.clone().addScaledVector(d, 0.04), w.clone().addScaledVector(d, 0.09), w.clone().addScaledVector(d, 0.115)], [0.04, 0.056, 0.05, 0.012], PAL.skin, { radial: Rm });
  };
  for (const side of [-1, 1]) {
    const sh = V(side * 0.225, 1.41, lean(1.41));
    if (mode === 'fist' && side === 1) {
      const el = sh.clone().add(V(0.07, 0.27, 0.05)), wr = el.clone().add(V(-0.02, 0.27, 0.02));
      arm(side, [sh, lerpV(sh, el, 0.5), el, lerpV(el, wr, 0.5), wr]);
    } else if (mode === 'pole') {
      const hand = side === 1 ? V(0.1, 1.3, 0.3) : V(0.08, 1.02, 0.28), el = side === 1 ? V(0.3, 1.14, 0.1) : V(-0.2, 1.1, 0.12);
      arm(side, [sh, lerpV(sh, el, 0.5), el, lerpV(el, hand, 0.5), hand]);
    } else {
      const phs = side < 0 ? ph + Math.PI : ph, b = 0.45 * Math.sin(phs);
      const el = sh.clone().add(V(side * 0.035, -Math.cos(b) * 0.3, Math.sin(b) * 0.3)), wr = el.clone().add(V(side * 0.01, -Math.cos(b + 0.5) * 0.27, Math.sin(b + 0.5) * 0.27));
      arm(side, [sh, lerpV(sh, el, 0.5), el, lerpV(el, wr, 0.5), wr]);
    }
  }
  if (mode === 'pole') add([V(0.09, 0.45 + lift, 0.29), V(0.09, 2.0 + lift, 0.29), V(0.09, 3.5 + lift, 0.29)], [0.024, 0.024, 0.02], PAL.pole, { radial: Rm });
  const g = mergeGeometries(parts); g.userData.poleTop = V(0.09, 3.45 + lift, 0.29);
  return g;
}

// ------------------------------------------------------------------ the world
export class World {
  constructor(renderer, { w = 540, h = 960, bannerArt = null } = {}) {
    this.r = renderer; this.w = w; this.h = h;
    const scene = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.3, 3000);
    const R = rng(1917);
    this.sunDir = V(0.2, 0.12, -1).normalize();              // toward the sun: behind the monument, low
    scene.fog = new THREE.Fog(new THREE.Color('#d08868'), 140, 1100);
    // sky (not in the G-buffer: presses rule it in screen space)
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(2500, 40, 20), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { SUN: { value: this.sunDir }, T: { value: 0 } },
      vertexShader: `varying vec3 vd; void main(){ vd=normalize((modelMatrix*vec4(position,1.)).xyz-cameraPosition); gl_Position=projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform vec3 SUN; uniform float T; varying vec3 vd;
        float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
        float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*n(p); p*=2.07; a*=.5; } return v; }
        void main(){ vec3 d=normalize(vd); float y=max(d.y,0.);
          vec3 zen=vec3(.13,.03,.045), mid=vec3(.55,.16,.12), hor=vec3(.95,.62,.4);
          vec3 c=mix(hor, mid, smoothstep(0.,.2,y)); c=mix(c, zen, smoothstep(.16,.62,y));
          float sd=acos(clamp(dot(d,SUN),-1.,1.));
          c+=vec3(1.,.55,.3)*exp(-sd*4.)*.5 + vec3(1.,.8,.55)*exp(-sd*16.)*.45;
          vec2 cp=d.xz/(d.y+.1)*1.1; cp.x+=T*.015;
          float cl=fbm(cp*vec2(.7,2.2)); float band=smoothstep(.48,.7,cl)*smoothstep(.03,.12,y)*(1.-smoothstep(.4,.75,y));
          c=mix(c, c*vec3(.3,.17,.2), band*.9);
          c+=vec3(1.,.55,.3)*band*exp(-sd*3.5)*.9;
          float disc=1.-smoothstep(.1,.105,sd); c=mix(c, vec3(1.,.93,.78), disc);
          gl_FragColor=vec4(c,1.); }` }));
    this.sky.userData.gbuffer = false; scene.add(this.sky);
    // ground: big flagstones, low contrast (the long shadows carry the structure)
    const gc = document.createElement('canvas'); gc.width = gc.height = 256; {
      const g = gc.getContext('2d'); g.fillStyle = '#8c7a68'; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 600; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '50,40,34' : '190,170,150'},${R() * 0.06})`; g.fillRect(R() * 256, R() * 256, 4 + R() * 30, 4 + R() * 30); }
      g.strokeStyle = 'rgba(40,30,26,0.55)'; g.lineWidth = 2;
      for (let k = 0; k <= 2; k++) { g.beginPath(); g.moveTo(k * 128, 0); g.lineTo(k * 128, 256); g.moveTo(0, k * 128); g.lineTo(256, k * 128); g.stroke(); }
    }
    const gtex = new THREE.CanvasTexture(gc); gtex.wrapS = gtex.wrapT = THREE.RepeatWrapping; gtex.repeat.set(500, 500); gtex.colorSpace = THREE.SRGBColorSpace; gtex.anisotropy = 4;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshLambertMaterial({ map: gtex }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.userData.uvScale = [3000, 3000]; ground.userData.subject = 0.15; scene.add(ground);
    // monument: plinth steps, four stepped drums with fluted ribs and cornices, the statue, a red banner
    const MZ = this.MZ = -120, STONE = new THREE.MeshLambertMaterial({ color: '#8a7466' }), DARK = new THREE.MeshLambertMaterial({ color: '#5a4a42' });
    const mon = this.mon = new THREE.Group(); mon.position.set(0, 0, MZ); scene.add(mon);
    const addM = (geo, mat, x, y, z, uvs) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; m.userData.subject = 1; m.userData.uvScale = uvs; mon.add(m); return m; };
    [[70, 2.2, 56], [58, 2.2, 46], [46, 2.2, 38]].forEach(([w, h, d], i) => addM(new THREE.BoxGeometry(w, h, d), STONE, 0, h / 2 + i * h, 0, [w, h]));
    let y = 6.6; const drums = [[17, 13], [13.5, 12], [10.5, 11], [7.8, 9]];
    const ribs = [];
    drums.forEach(([r, h], i) => {
      addM(new THREE.CylinderGeometry(r * 0.97, r, h, 48, 1, false), i % 2 ? STONE : DARK, 0, y + h / 2, 0, [2 * Math.PI * r, h]);
      const nr = Math.round(r * 2.4); for (let k = 0; k < nr; k++) { const a = k / nr * Math.PI * 2; ribs.push([Math.cos(a) * (r + 0.25), y + h / 2, Math.sin(a) * (r + 0.25), a, h, r]); }
      addM(new THREE.CylinderGeometry(r + 1.1, r + 0.8, 1.2, 48), STONE, 0, y + h + 0.6, 0, [2 * Math.PI * r, 1.2]);
      y += h + 1.2;
    });
    const rg = new THREE.BoxGeometry(0.9, 1, 0.8), RI = new THREE.InstancedMesh(rg, STONE, ribs.length); RI.castShadow = RI.receiveShadow = true; RI.userData.subject = 1; RI.userData.uvScale = [1, 6];
    { const m = new THREE.Matrix4(), q = new THREE.Quaternion(); ribs.forEach(([x, yy, z, a, h], i) => { q.setFromAxisAngle(V(0, 1, 0), -a); m.compose(V(x, yy, z), q, V(1, h * 0.94, 1)); RI.setMatrixAt(i, m); }); }
    mon.add(RI);
    this.topY = y;
    const BRONZE = new THREE.MeshStandardMaterial({ vertexColors: true, color: '#8a6a52', roughness: 0.5, metalness: 0.35 });
    const statue = new THREE.Mesh(figure({ mode: 'fist', ph: 0.6, costume: 0, lod: 2 }), BRONZE);
    statue.scale.setScalar(9.5); statue.position.set(0, y - 0.8, 0); statue.castShadow = true; statue.userData.subject = 1; mon.add(statue);
    // red banner down the front of the drums (CPU cloth)
    this.banner = new THREE.Mesh(new THREE.PlaneGeometry(9, 34, 6, 20), new THREE.MeshLambertMaterial(bannerArt ? { map: Object.assign(new THREE.CanvasTexture(bannerArt), { colorSpace: THREE.SRGBColorSpace }), side: THREE.DoubleSide } : { color: '#b3121c', side: THREE.DoubleSide, emissive: '#1c0000' }));
    this.banner.position.set(0, 26, 17.6); this.banner.castShadow = true; this.banner.userData.subject = 1; this.banner.userData.uvScale = [9, 34]; mon.add(this.banner);
    this.bannerRest = this.banner.geometry.attributes.position.array.slice();
    // crowd: a procession column; near / far LODs x modes x stride phases, costumes near only
    this.NPH = 8; this.modes = ['swing', 'fist', 'pole'];
    const MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
    const CAP = [700, 300, 120];
    this.lods = [0, 1, 2].map(lod => {
      const meshes = [];
      for (const [mi, mode] of this.modes.entries()) for (let c = 0; c < (lod ? 2 : 1); c++) for (let p = 0; p < this.NPH; p++) {
        const g = figure({ mode, ph: p / this.NPH * Math.PI * 2, costume: c, lod });
        const im = new THREE.InstancedMesh(g, MAT, CAP[lod]); im.castShadow = lod > 0; im.receiveShadow = lod === 2; im.frustumCulled = false; im.count = 0;
        im.userData.subject = 1; if (lod === 0) im.userData.gbuffer = false;       // far figures: screen-space fallback, no G-buffer cost
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP[lod] * 3), 3);
        scene.add(im); meshes.push({ im, mi, c, p, top: g.userData.poleTop });
      }
      return meshes;
    });
    const people = this.people = []; const cols = 15;
    for (let row = 0; row < 54; row++) for (let c = 0; c < cols; c++) {
      if (R() < 0.08) continue;
      const mode = row >= 7 && row % 3 === 1 && R() < 0.3 ? 2 : R() < 0.16 ? 1 : 0;
      people.push({ x: (c - (cols - 1) / 2) * 1.12 + (R() - 0.5) * 0.4, z: 6 - row * 1.3 + (R() - 0.5) * 0.5, ph: R() * 6.283, mode, costume: R() < 0.45 ? 1 : 0,
        s: 0.93 + R() * 0.12, head: (R() - 0.5) * 0.12, tint: 0.75 + R() * 0.5 });
    }
    this.flags = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ color: '#bd1622', side: THREE.DoubleSide, emissive: '#1a0000' }));
    this.flags.castShadow = true; this.flags.userData.subject = 1; this.flags.frustumCulled = false; scene.add(this.flags);
    this.MAXF = 60; const fp = new Float32Array(this.MAXF * 9 * 5 * 3), fu = new Float32Array(this.MAXF * 9 * 5 * 2), fi = [];
    for (let f = 0; f < this.MAXF; f++) for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) { const a = f * 45 + j * 9 + i; fi.push(a, a + 1, a + 9, a + 1, a + 10, a + 9); }
    for (let f = 0; f < this.MAXF; f++) for (let j = 0; j < 5; j++) for (let i = 0; i < 9; i++) { const k = (f * 45 + j * 9 + i) * 2; fu[k] = i / 8 * 1.9; fu[k + 1] = j / 4 * 1.2; }
    this.flags.geometry.setAttribute('position', new THREE.BufferAttribute(fp, 3)); this.flags.geometry.setAttribute('uv', new THREE.BufferAttribute(fu, 2)); this.flags.geometry.setIndex(fi);
    // lights: low sun behind (rim + long shadows toward camera), warm-cool key from front-left to model the figures
    const sun = this.sun = new THREE.DirectionalLight('#ffc596', 3.4); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 90, bottom: -90, near: 10, far: 1200 }); sun.shadow.bias = -0.0006;
    scene.add(sun); scene.add(sun.target);
    this.key = new THREE.DirectionalLight('#e4e8ff', 1.9); scene.add(this.key); scene.add(this.key.target);
    scene.add(new THREE.HemisphereLight('#ffb890', '#2a1a18', 0.75));
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._fr = new THREE.Frustum(); this._pm = new THREE.Matrix4();
    this.speed = 1.25;
  }
  // camera: in front of the marching column, looking back up at the monument. dist = metres ahead of the front rank,
  // lift = camera height, orbit = sideways swing (rad), look = aim height at the monument, fov
  shot(t, { dist = 7, lift = 1.5, orbit = 0, fov = 50, look = 0.35, side = 0 } = {}) {
    const front = 6 + this.speed * t, cam = this.camera;
    const cz = front + dist, cx = side + Math.sin(orbit) * dist * 1.4;
    cam.fov = fov; cam.aspect = this.w / this.h; cam.updateProjectionMatrix();
    cam.position.set(cx, lift, cz);
    cam.lookAt(V(cx * 0.2, 8 + look * 80, this.MZ));
    return cam;
  }
  update(t, shotOpts = {}) {
    const cam = this.shot(t, shotOpts);
    this.sky.material.uniforms.T.value = t;
    cam.updateMatrixWorld(); this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); this._fr.setFromProjectionMatrix(this._pm);
    const cnt = this.lods.map(ms => ms.map(() => 0)), fr = this._fr, sph = new THREE.Sphere(V(0, 0, 0), 2.2);
    const F = this.flags.geometry.attributes.position.array; let nf = 0;
    const walk = this.speed * t, stepHz = 0.95;
    for (const p of this.people) {
      const z = p.z + walk, x = p.x;
      sph.center.set(x, 1, z); if (!fr.intersectsSphere(sph)) continue;
      const d = Math.hypot(x - cam.position.x, z - cam.position.z), lod = d < 12 ? 2 : d < 30 ? 1 : 0;
      const phase = ((t * stepHz * Math.PI * 2 + p.ph) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2), pi = Math.floor(phase / (Math.PI * 2) * this.NPH) % this.NPH;
      const ms = this.lods[lod], k = ms.findIndex(m => m.mi === p.mode && m.p === pi && m.c === (lod ? p.costume : 0));
      const e = ms[k], i = cnt[lod][k]++;
      if (i >= e.im.instanceMatrix.count) continue;
      this._q.setFromAxisAngle(V(0, 1, 0), p.head);
      this._m.compose(V(x, 0, z), this._q, V(p.s, p.s, p.s)); e.im.setMatrixAt(i, this._m);
      e.im.instanceColor.setXYZ(i, p.tint, p.tint * 0.97, p.tint * 0.95);
      if (p.mode === 2 && nf < this.MAXF) {          // the flag on this pole: 9x5 grid trailing back in the wind
        const top = e.top.clone().multiplyScalar(p.s).applyQuaternion(this._q).add(V(x, 0, z));
        for (let jj = 0; jj < 5; jj++) for (let ii = 0; ii < 9; ii++) {
          const u = ii / 8, vv = jj / 4, wav = Math.sin(u * 5 - t * 7 + p.ph) * 0.18 * u;
          const o = (nf * 45 + jj * 9 + ii) * 3; F[o] = top.x + u * 1.2 + wav * 0.2; F[o + 1] = top.y - vv * 0.8 - u * 0.12; F[o + 2] = top.z - u * 0.35 + wav;
        }
        nf++;
      }
    }
    this.lods.forEach((ms, l) => ms.forEach((m, k) => { m.im.count = Math.min(cnt[l][k], m.im.instanceMatrix.count); m.im.instanceMatrix.needsUpdate = true; m.im.instanceColor.needsUpdate = true; }));
    for (let f = nf; f < this.MAXF; f++) for (let o = f * 135; o < f * 135 + 135; o++) F[o] = 0;
    this.flags.geometry.attributes.position.needsUpdate = true; this.flags.geometry.computeVertexNormals(); this.flags.geometry.setDrawRange(0, nf * 192);
    // banner ripple
    const bp = this.banner.geometry.attributes.position, br = this.bannerRest;
    for (let i = 0; i < bp.count; i++) { const x = br[i * 3], yy = br[i * 3 + 1]; bp.setZ(i, Math.sin(x * 0.5 + yy * 0.18 - t * 1.6) * 0.5 + Math.sin(yy * 0.4 - t * 2.3) * 0.25); }
    bp.needsUpdate = true; this.banner.geometry.computeVertexNormals();
    // lights follow the procession
    const cz = 6 + walk - 30;
    this.sun.target.position.set(0, 0, cz); this.sun.position.copy(this.sunDir).multiplyScalar(500).add(this.sun.target.position);
    this.key.target.position.set(0, 0, cz); this.key.position.set(-120, 90, cz + 160);
    this.r.render(this.scene, cam);
    return this.r.domElement;
  }
}
