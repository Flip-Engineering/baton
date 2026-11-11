// AMERICANA c2 (WORLDS studio c2): subjects near the lens and in the lit slot, built for the relight plate (relight.js).
//
//   Elevator      a Great Plains slipform concrete elevator (35-45 m): two rows of silos, the headhouse with its top
//                 story, the gallery over the bins, a steel-bin annex, the driveway shed, spouts; weathered concrete
//                 (vertical rain streaks, slip lines, a dark cap) drawn on canvas. lampAt: the headhouse beacon (GOES RED).
//   NearWheat     the near field as a subject: awned ears only inside `awnR` (20 m), three value tiers (ear / stem /
//                 shadow), low saturation, in cloud shadow (the strip mask), rim-lit from the slot, keyed by the strike.
//   Pickup        a farm pickup (cab, bed, lights) with its lit dust plume (a camera-facing card).
//   Yard          a night elevator yard: floods on masts (light layers, switched in sequence), trucks queued at the
//                 scale with head and tail lights, a grain dryer venting steam, one worker in the pool.
// Everything is opt-in and new; nothing in americana.js / weather.js changes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ATMOS_GLSL, patchMaterial } from './atmos3d.js';

const rng = (seed) => { let s = seed | 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };

// ------------------------------------------------------------------ weathered concrete, drawn (not a noise filter): what reads at 150-200 px
function concreteTex({ w = 512, h = 1024, seed = 3, base = '#b9b2a6', cap = 0.06, slip = 0.9, streak = 1, letters = null } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), r = rng(seed);
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  // slipform lifts: faint horizontal lines every ~1.2 m (at 36 m over 1024 px: every ~34 px)
  g.globalAlpha = 0.06 * slip; g.fillStyle = '#000'; for (let y = 0; y < h; y += 34) g.fillRect(0, y + (r() - 0.5) * 2, w, 1.5);
  // rain streaks: dark runs from the top edge and from every opening, thinning downward
  for (let k = 0; k < 220 * streak; k++) { const x = r() * w, L = h * (0.1 + 0.8 * r() ** 2), y0 = r() < 0.7 ? 0 : r() * h * 0.6, a = 0.03 + 0.08 * r();
    const gr = g.createLinearGradient(0, y0, 0, y0 + L); gr.addColorStop(0, `rgba(40,34,28,${a})`); gr.addColorStop(1, 'rgba(40,34,28,0)');
    g.globalAlpha = 1; g.fillStyle = gr; g.fillRect(x, y0, 1 + r() * 5, L); }
  // pale lime bloom low down, soil splash at the foot
  let gr = g.createLinearGradient(0, h * 0.8, 0, h); gr.addColorStop(0, 'rgba(90,70,50,0)'); gr.addColorStop(1, 'rgba(90,70,50,0.35)'); g.fillStyle = gr; g.fillRect(0, h * 0.8, w, h * 0.2);
  gr = g.createLinearGradient(0, 0, 0, h * cap); gr.addColorStop(0, 'rgba(30,26,22,0.5)'); gr.addColorStop(1, 'rgba(30,26,22,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h * cap);
  if (letters) { g.globalAlpha = 0.85; g.fillStyle = letters.color || '#2a2622'; g.font = `900 ${letters.size || 70}px Overpass, sans-serif`; g.textAlign = 'center';
    (letters.lines || []).forEach((t, i) => g.fillText(t, w / 2, (letters.y || 0.18) * h + i * (letters.size || 70) * 1.15)); g.globalAlpha = 1; }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function corrTex({ seed = 5 } = {}) {       // corrugated steel bins: vertical ribs, a sheen band, rust at the seams
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d'), r = rng(seed);
  g.fillStyle = '#9aa0a4'; g.fillRect(0, 0, 512, 256);
  for (let x = 0; x < 512; x += 6) { g.fillStyle = `rgba(0,0,0,${0.12 + 0.05 * Math.sin(x)})`; g.fillRect(x, 0, 2, 256); }
  for (let y = 0; y < 256; y += 42) { g.fillStyle = 'rgba(80,50,30,0.25)'; g.fillRect(0, y, 512, 2); }
  for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(90,60,40,${0.05 + 0.1 * r()})`; g.fillRect(r() * 512, r() * 256, 2 + r() * 10, 20 + r() * 80); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1); return t;
}

// ------------------------------------------------------------------ the elevator
export class Elevator {
  // at: [x, y, z] of the headhouse foot; yaw: the long axis direction (rad, 0 = +x); rows x per: the silo grid
  constructor(world, lf, { at = [0, 0, 0], yaw = 0, silo = { d: 9.4, h: 36, rows: 2, per: 5 }, head = { w: 13, d: 13, h: 50 }, annex = 3, letters = ['FARMERS', 'CO-OP'], seed = 4, patch = true } = {}) {
    const S = world.scene, r = rng(seed), grp = new THREE.Group(); grp.position.set(...at); grp.rotation.y = yaw; S.add(grp); this.group = grp;
    const mat = (tex, rough = 0.92, color = '#ffffff', metal = 0) => { const m = new THREE.MeshStandardMaterial({ map: tex, color, roughness: rough, metalness: metal }); if (patch && lf) patchMaterial(m, lf, { wallFall: 30 }); return m; };
    const conc = mat(concreteTex({ seed })), conc2 = mat(concreteTex({ seed: seed + 1, base: '#b3aca0', letters: letters ? { lines: letters, size: 64, y: 0.12 } : null }));
    const capM = mat(null, 0.8, '#6a645c'), dark = new THREE.MeshStandardMaterial({ color: '#141210', roughness: 1 }), steel = mat(corrTex({ seed }), 0.4, '#ffffff', 0.55);
    const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); grp.add(o); return o; };
    // silos: a 2 x N grid, touching (the interstice bins are the dark wedges between)
    const { d, h, rows, per } = silo, R = d / 2;
    for (let j = 0; j < rows; j++) for (let i = 0; i < per; i++) { const x = -head.w / 2 - R - 0.3 - i * d, z = (j - (rows - 1) / 2) * d;
      const g = new THREE.CylinderGeometry(R, R, h, 28, 1, true); g.translate(0, h / 2, 0); add(g, conc, x, 0, z).rotation.y = r() * 6.28;
      const top = new THREE.CircleGeometry(R, 28); top.rotateX(-Math.PI / 2); add(top, capM, x, h, z); }
    const L = per * d + 0.3;
    // the gallery (conveyor house) along the silo tops, with a strip of dark windows
    add(new THREE.BoxGeometry(L, 4.2, 5.2).translate(0, 2.1, 0), conc, -head.w / 2 - L / 2, h, 0);
    add(new THREE.BoxGeometry(L - 2, 0.9, 5.25).translate(0, 2.6, 0), dark, -head.w / 2 - L / 2, h, 0);
    // the headhouse: the tall box, a narrower top story, window bands, the letters on the camera face
    const hh = new THREE.Mesh(new THREE.BoxGeometry(head.w, head.h, head.d).translate(0, head.h / 2, 0), [conc2, conc2, capM, capM, conc2, conc2]); grp.add(hh);
    add(new THREE.BoxGeometry(head.w * 0.62, 7, head.d * 0.7).translate(0, 3.5, 0), conc, -head.w * 0.1, head.h, 0);
    for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(head.w * 0.5, 1.1, head.d + 0.1).translate(0, 0, 0), dark, 0, head.h - 6 - k * 9, 0);
    // annex: corrugated steel bins with conical roofs, a leg and spouts from the headhouse
    this.bins = [];
    for (let k = 0; k < annex; k++) { const br = 7 + r() * 2.5, bh = 17 + r() * 5, x = head.w / 2 + 12 + k * (2 * br + 3), z = (r() - 0.5) * 6;
      add(new THREE.CylinderGeometry(br, br, bh, 36, 1, true).translate(0, bh / 2, 0), steel, x, 0, z);
      add(new THREE.ConeGeometry(br * 1.02, br * 0.55, 36).translate(0, bh + br * 0.275, 0), mat(null, 0.35, '#8a9096', 0.6), x, 0, z);
      const sp = new THREE.CylinderGeometry(0.35, 0.35, 1, 6); const a = new THREE.Vector3(head.w / 2, head.h - 4, 0), b = new THREE.Vector3(x, bh + br * 0.55, z);
      sp.translate(0, 0.5, 0); sp.rotateX(Math.PI / 2); const m = add(sp, capM, 0, 0, 0); m.position.copy(a); m.lookAt(grp.localToWorld(b.clone())); m.scale.set(1, 1, a.distanceTo(b)); this.bins.push({ x, r: br, h: bh }); }
    // the driveway shed at the foot of the headhouse (the dump pit), a lean-to office
    add(new THREE.BoxGeometry(10, 6.5, 22).translate(0, 3.25, 0), mat(corrTex({ seed: seed + 3 }), 0.5, '#c8c0b4', 0.3), 0, 0, head.d / 2 + 11);
    add(new THREE.BoxGeometry(8, 3.4, 6).translate(0, 1.7, 0), conc, -head.w / 2 - 6, 0, head.d / 2 + 5);
    grp.traverse(o => { if (o.isMesh) { o.userData.temp = 8; o.userData.cls = 'subject'; } });
    this.head = head; this.silo = silo;
    grp.updateMatrixWorld(true);
    this.lampAt = grp.localToWorld(new THREE.Vector3(-head.w * 0.1, head.h + 7.8, 0));
    this.top = grp.localToWorld(new THREE.Vector3(0, head.h + 7, 0));
    this.foot = grp.localToWorld(new THREE.Vector3(0, 0, 0));
    // occluder boxes for shaders that shadow the near layer (NearWheat): [centre (world), yaw] + half extents
    const box = (x0, x1, y1, hz) => { const c = grp.localToWorld(new THREE.Vector3((x0 + x1) / 2, y1 / 2, 0)); return { c: [c.x, c.y, c.z, yaw], h: [(x1 - x0) / 2, y1 / 2, hz] }; };
    this.occluders = [box(-head.w / 2 - L, head.w / 2, h + 4.2, d * rows / 2), box(-head.w / 2, head.w / 2, head.h + 7, head.d / 2)];
  }
}

// ------------------------------------------------------------------ a live beacon sprite (color and intensity per frame: the lamp that GOES RED)
export class Beacon {
  constructor(atmos, pos, { size = 3.2, color = [1, 0.85, 0.6], i = 0 } = {}) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...pos], 3));
    this.U = { ...atmos.U, tDepth: atmos.frameU.tDepth, uRes: atmos.frameU.uRes, uI: { value: i }, uC: { value: new THREE.Vector3(...color) }, uSize: { value: size }, uFovY: { value: 1 } };
    this.pts = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.U, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uSize, uFovY; uniform vec2 uRes; varying float vD; void main(){ vec4 mv = viewMatrix * vec4(position, 1.); vD = -mv.z; gl_Position = projectionMatrix * mv;
        gl_PointSize = max(uSize * uRes.y / (2. * tan(uFovY * .5) * vD) * 8., 10.); }`,
      fragmentShader: `uniform sampler2D tDepth; uniform vec2 uRes; uniform float uI; uniform vec3 uC; varying float vD;
        void main(){ float r = length(gl_PointCoord - .5) * 2.; float core = smoothstep(.16, .06, r), halo = exp(-r * r * 9.) * .35 + exp(-r * 3.) * .08;
          gl_FragColor = vec4(uC * uI * (core * 6. + halo), 1.); }` }));
    this.pts.frustumCulled = false; this.pts.userData.noReflect = true; atmos.overlay.add(this.pts);
    atmos.pre.push((a, cam) => { this.U.uFovY.value = cam.fov * Math.PI / 180; });
  }
  set(i, color) { this.U.uI.value = i; if (color) this.U.uC.value.set(...color); }
}

// ------------------------------------------------------------------ the near wheat, as a subject
export class NearWheat {
  // n tufts from `near` to `far` m in a wedge ahead of the camera; awned heads only inside awnR. The key (atmos.key) is
  // masked by the plains strip (cloud shadow); rim: the slot's light from rimDir; flash: set uFlash / uFlashDir per frame.
  constructor(atmos, world, { n = 14000, near = 1.2, far = 90, awnR = 20, spread = 0.75, yaw = 0, seed = 5, strip = null, groundH = null, gust = 1,
    alb = '#9c8a62', sat = 0.42, rim = { dir: [0, 0.05, -1], color: '#ffcf8a', k: 1.4 }, flash = '#cfdcff' } = {}) {
    const r = rng(seed);
    const tuft = (awns) => { const P = [], N = [], H = [];
      for (let k = 0; k < 7; k++) {
        const ox = (r() - 0.5) * 0.28, oz = (r() - 0.5) * 0.28, h = 0.78 + r() * 0.24, lean = (r() - 0.5) * 0.14, a = r() * Math.PI, sx = Math.cos(a), sz = Math.sin(a);
        for (let sgi = 0; sgi < 4; sgi++) { const y0 = h * sgi / 4, y1 = h * (sgi + 1) / 4, w0 = 0.0042, w1 = 0.003, l0 = lean * (sgi / 4) ** 2, l1 = lean * ((sgi + 1) / 4) ** 2;
          const q = [[ox - sx * w0 + l0, y0, oz - sz * w0], [ox + sx * w0 + l0, y0, oz + sz * w0], [ox + sx * w1 + l1, y1, oz + sz * w1], [ox - sx * w1 + l1, y1, oz - sz * w1]];
          P.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]); for (let j = 0; j < 6; j++) { N.push(-sz, 0.2, sx); H.push(y0 / h + (j >= 2 && j !== 3 ? 0.25 : 0)); } }
        const hw = 0.0085, nod = 0.035, ex = ox + lean, ey = h, e = [[ex, ey, oz], [ex + sx * hw + nod * 0.3, ey + 0.045, oz + sz * hw], [ex + nod, ey + 0.1, oz], [ex - sx * hw + nod * 0.3, ey + 0.045, oz - sz * hw]];
        P.push(...e[0], ...e[1], ...e[2], ...e[0], ...e[2], ...e[3]); for (let j = 0; j < 6; j++) { N.push(-sz, 0.4, sx); H.push(1.2); }
        // a leaf: a longer blade low on the stalk, curling out (the stem tier's shape)
        { const ly = h * (0.3 + 0.2 * r()), la = r() * 6.28, lx = Math.cos(la), lz = Math.sin(la), L = 0.18 + 0.1 * r();
          const q = [[ox, ly, oz], [ox + lx * L * 0.5 + 0.004, ly + 0.07, oz + lz * L * 0.5], [ox + lx * L, ly + 0.01, oz + lz * L]];
          P.push(...q[0], ...q[1], ...q[2]); for (let j = 0; j < 3; j++) { N.push(-lz, 0.5, lx); H.push(0.5); } }
        if (awns) for (let aw = 0; aw < 6; aw++) { const ay = ey + 0.025 + aw * 0.017, ax = ex + nod * (aw / 6), L = 0.07 + 0.03 * r(), dx = (r() - 0.5) * 0.04;
          const q = [[ax - sx * 0.0014, ay, oz - sz * 0.0014], [ax + sx * 0.0014, ay, oz + sz * 0.0014], [ax + dx + nod * 0.6 + sx * 0.0008, ay + L, oz + sz * 0.0008], [ax + dx + nod * 0.6 - sx * 0.0008, ay + L, oz - sz * 0.0008]];
          P.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]); for (let j = 0; j < 6; j++) { N.push(-sz, 0.6, sx); H.push(1.35); } } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('hh', new THREE.Float32BufferAttribute(H, 1)); return g; };
    const place = (count, d0, d1) => { const I = new Float32Array(count * 4), cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (let i = 0; i < count; i++) { const dz = d0 + (d1 - d0) * Math.pow(r(), 1.6), dx = (r() - 0.5) * 2 * (dz * spread + 1.2);
        const x = dx * cy + dz * sy, z = -dz * cy + dx * sy; I.set([x, groundH ? groundH(x, z) : 0, z, r() * 6.28], i * 4); } return I; };
    const A = atmos, K = A.key;
    this.U = { ...A.U, uKeyDir: { value: new THREE.Vector3() }, uKeyCol: { value: new THREE.Color() }, uHemiS: { value: new THREE.Color() }, uHemiG: { value: new THREE.Color() },
      uStrip: strip ? strip : { value: new THREE.Vector4(0, 1e9, 1, 0) }, uAlb: { value: new THREE.Color(alb) }, uSat: { value: sat }, uGust: { value: gust },
      uRimDir: { value: new THREE.Vector3(...rim.dir).normalize() }, uRimCol: { value: new THREE.Color(rim.color).multiplyScalar(rim.k) },
      uFlash: { value: 0 }, uFlashDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
      uOccN: { value: 0 }, uOccC: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uOccH: { value: [new THREE.Vector3(), new THREE.Vector3()] }, uFlashCol: { value: new THREE.Color(flash) }, uRed: { value: 0 }, uRedDir: { value: new THREE.Vector3(0, 0.1, -1) } };
    const mat = new THREE.ShaderMaterial({ uniforms: this.U, side: THREE.DoubleSide,
      vertexShader: `attribute vec4 ip; attribute float hh; uniform float uTime, uGust; varying vec3 vN; varying float vH; varying vec3 vWP;
        void main(){ vec3 p = position; float sw = (sin(uTime*1.9 + ip.w + ip.x*.35 + ip.z*.2) * .5 + sin(uTime*3.7 + ip.w*2.) * .2) * .08;
          if (uGust > 0.) { float g = ip.x*.8 - ip.z*.35 - uTime*6.5; float front = pow(max(sin(g*.18), 0.), 6.) + .5*pow(max(sin(g*.071 + 1.7), 0.), 8.);
            sw = sw * .6 + front * uGust * .32 + uGust * .07; }
          p.x += sw * p.y * p.y; p.z += sw * .4 * p.y * p.y;
          float c = cos(ip.w), s = sin(ip.w); p.xz = mat2(c, -s, s, c) * p.xz;
          vec3 w = p + ip.xyz; vWP = w; vN = normalize(vec3(mat2(c, -s, s, c) * normal.xz, normal.y).xzy); vH = hh;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.); }`,
      fragmentShader: ATMOS_GLSL + `uniform vec3 uKeyDir, uKeyCol, uHemiS, uHemiG, uAlb, uRimDir, uRimCol, uFlashDir, uFlashCol, uRedDir; uniform vec4 uStrip; uniform float uSat, uFlash, uRed; varying vec3 vN; varying float vH; varying vec3 vWP;
        uniform int uOccN; uniform vec4 uOccC[2]; uniform vec3 uOccH[2];
        // the subject's shadow on the wheat: the ray toward the strike through the elevator's boxes (oriented: centre xyz, yaw w)
        float occluded(vec3 p, vec3 d){ for (int i = 0; i < 2; i++) { if (i >= uOccN) break; vec4 C = uOccC[i]; float c = cos(C.w), s = sin(C.w);
            vec3 q = p - C.xyz; q = vec3(c*q.x - s*q.z, q.y, s*q.x + c*q.z); vec3 e = vec3(c*d.x - s*d.z, d.y, s*d.x + c*d.z);
            vec3 inv = 1. / e, t0 = (-uOccH[i] - q) * inv, t1 = (uOccH[i] - q) * inv; vec3 tn = min(t0, t1), tf = max(t0, t1);
            float a = max(max(tn.x, tn.y), tn.z), b = min(min(tf.x, tf.y), tf.z); if (b > max(a, 0.)) return 1.; } return 0.; }
        void main(){ vec3 n = normalize(vN); vec3 v = normalize(uCamPos - vWP); if (dot(n, v) < 0.) n = -n;
          float lit = 1. - smoothstep(uStrip.y - uStrip.z, uStrip.y, abs(vWP.z - uStrip.x + uStrip.w*sin(vWP.x*.0007)));
          // three value tiers: shadow (root, deep in the stand) - stem - ear
          float tier = vH > 1.1 ? 1. : vH > .45 ? .55 : .22; float ao = mix(.18, 1., smoothstep(0., 1., vH)); ao *= ao;
          float hsh = fract(sin(dot(floor(vWP.xz*2.3), vec2(12.9, 78.2)))*43758.5);
          vec3 alb = uAlb * mix(.75, 1.15, tier) * (.82 + .3*hsh);
          vec3 albF = alb;                                                                         // the strike shows the wheat's true gold for a frame
          float la = dot(alb, vec3(.2126,.7152,.0722)); alb = mix(vec3(la), alb, uSat);               // held down: S <= .45
          vec3 L = normalize(uKeyDir); float diff = max(dot(n, L), 0.) + .4*max(-dot(n, L), 0.);
          vec3 c = alb * (uKeyCol * diff * lit + mix(uHemiG, uHemiS, n.y*.5 + .5)) * ao;
          // the rim: the slot's light caught on the edges of the ears and awns (grazing, against the light)
          float edge = pow(1. - abs(dot(n, v)), 2.5), back = pow(max(dot(-v, uRimDir), 0.), 3.);
          float ear = smoothstep(1.05, 1.25, vH);                                                   // ears + awns catch light; stems stay in the stand's shadow
          c += uRimCol * edge * (.25 + .75*back) * ear;
          // the strike: a hard cool key from the channel + a hot rim on every ear against it
          vec3 F = normalize(uFlashDir); float sh = uFlash > 0. ? 1. - occluded(vWP, F) : 1.; float fd = max(dot(n, F), 0.) + mix(.12, .5, ear)*max(-dot(n, F), 0.), fb = pow(max(dot(-v, F), 0.), 2.);
          c += uFlashCol * uFlash * sh * (albF * fd * mix(.35, 1.1, ear) * ao + edge * (.3 + 1.7*fb) * ear * .8);
          // the red lamp's reach (faint: the heads nearest the slot catch it)
          c += vec3(1., .12, .06) * uRed * edge * smoothstep(.8, 1.3, vH) * .08;
          gl_FragColor = vec4(c, 1.); }` });
    const nNear = Math.round(n * 0.4), nFar = n - nNear;
    const mk = (geo, count, d0, d1) => { const g = new THREE.InstancedBufferGeometry(); g.index = null; for (const k of ['position', 'normal', 'hh']) g.setAttribute(k, geo.getAttribute(k));
      g.setAttribute('ip', new THREE.InstancedBufferAttribute(place(count, d0, d1), 4)); g.instanceCount = count;
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.userData.noReflect = true; return m; };
    this.mesh = new THREE.Group();
    this.mesh.add(mk(tuft(true), nNear, near, awnR), mk(tuft(false), nFar, awnR * 0.9, far));
    world.scene.add(this.mesh);
    A.pre.push(() => { const u = this.U; u.uKeyDir.value.copy(K.position).normalize(); u.uKeyCol.value.copy(K.color).multiplyScalar(K.intensity);
      const hm = A.world._hemi; if (hm) { u.uHemiS.value.copy(hm.color).multiplyScalar(hm.intensity); u.uHemiG.value.copy(hm.groundColor).multiplyScalar(hm.intensity); } });
  }
}

// ------------------------------------------------------------------ a farm pickup on a gravel road, its lights and the dust it raises (lit by the low sun)
export class Pickup {
  // road: { a: [x, z], b: [x, z] } the path; speed m/s; t0: where on the road at t = 0 (m from a); groundH(x, z)
  constructor(world, atmos, { road, speed = 12, s0 = 0, groundH = () => 0, color = '#6a1a14', sun = [-1, 0.1, -0.2], dust = { len: 90, w: 9, h: 7, col: '#ffb070', k: 1.2 } } = {}) {
    this.road = road; this.speed = speed; this.s0 = s0; this.H = groundH;
    const g = new THREE.Group(), m = (c, r = 0.6, mt = 0.2) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: mt });
    const box = (w, h, d, x, y, z, mat) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); o.position.set(x, y, z); g.add(o); return o; };
    const body = m(color, 0.45, 0.3), dark = m('#101010', 0.9, 0), glass = m('#202830', 0.1, 0.6);
    box(1.95, 0.75, 5.6, 0, 0.95, 0, body); box(1.85, 0.8, 2.1, 0, 1.7, 0.9, body); box(1.8, 0.55, 0.05, 0, 1.75, 1.97, glass);
    box(1.9, 0.35, 5.7, 0, 0.55, 0, dark);
    for (const [x, z] of [[-0.9, 1.7], [0.9, 1.7], [-0.9, -1.7], [0.9, -1.7]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 12), dark); w.rotation.z = Math.PI / 2; w.position.set(x, 0.4, z); g.add(w); }
    world.scene.add(g); this.group = g;
    // headlights + tail lights: live sprites
    const mkS = (col, size) => { const bc = new Beacon(atmos, [0, 0, 0], { size, color: col, i: 0 }); return bc; };
    this.heads = [mkS([1, 0.92, 0.75], 0.9), mkS([1, 0.92, 0.75], 0.9)]; this.tails = [mkS([1, 0.1, 0.05], 0.5), mkS([1, 0.1, 0.05], 0.5)];
    // the dust: a long soft billboard trailing the truck, sun-lit (forward scatter toward a camera facing the sun)
    const dg = new THREE.PlaneGeometry(1, 1, 24, 4); dg.translate(0.5, 0.5, 0);
    this.dustU = { ...atmos.U, uCol: { value: new THREE.Color(dust.col).multiplyScalar(dust.k) }, uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uW: { value: dust.w }, uH: { value: dust.h }, uI: { value: 1 } };
    this.dust = new THREE.Mesh(dg, new THREE.ShaderMaterial({ uniforms: this.dustU, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `uniform vec3 uA, uB; uniform float uW, uH; varying vec2 vU; varying vec3 vW;
        void main(){ vU = position.xy; vec3 ax = uB - uA; vec3 up = vec3(0., 1., 0.); vec3 w = uA + ax * position.x + up * position.y * uH * (.5 + position.x * 1.2);
          vec3 side = normalize(cross(ax, up)); w += side * (position.y - .5) * uW * position.x * .6; vW = w; gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.); }`,
      fragmentShader: ATMOS_GLSL + `uniform vec3 uCol; uniform float uI; varying vec2 vU; varying vec3 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){ float x = vU.x, y = vU.y; float body = smoothstep(0., .08, x) * (1. - smoothstep(.55, 1., x)) * smoothstep(1., .2, y) * smoothstep(0., .15, y);
          float n = n2(vec2(x * 9. - uTime * .8, y * 3.)) * .6 + n2(vec2(x * 23. - uTime * 1.6, y * 7.)) * .4;
          float a = body * (.4 + .9 * n) * uI; float tr = exp(-hazeTau(normalize(vW - uCamPos), length(vW - uCamPos)));
          gl_FragColor = vec4(uCol * a * tr * .6, 1.); }` }));
    this.dust.frustumCulled = false; this.dust.userData.noReflect = true; atmos.overlay.add(this.dust);
    this.lights = 0;
  }
  at(t) { const [ax, az] = this.road.a, [bx, bz] = this.road.b, L = Math.hypot(bx - ax, bz - az), s = (this.s0 + this.speed * t) / L;
    const x = ax + (bx - ax) * s, z = az + (bz - az) * s; return { x, z, y: this.H(x, z), dx: (bx - ax) / L, dz: (bz - az) / L }; }
  update(t) {
    const p = this.at(t), g = this.group; g.position.set(p.x, p.y, p.z); g.rotation.y = Math.atan2(p.dx, p.dz);
    const fw = new THREE.Vector3(p.dx, 0, p.dz), rt = new THREE.Vector3(p.dz, 0, -p.dx);
    const hp = (side, fwd, y) => new THREE.Vector3(p.x, p.y + y, p.z).addScaledVector(fw, fwd).addScaledVector(rt, side);
    const setPos = (b, v) => { const a = b.pts.geometry.getAttribute('position'); a.setXYZ(0, v.x, v.y, v.z); a.needsUpdate = true; };
    setPos(this.heads[0], hp(-0.7, 2.85, 0.95)); setPos(this.heads[1], hp(0.7, 2.85, 0.95)); setPos(this.tails[0], hp(-0.8, -2.85, 1.0)); setPos(this.tails[1], hp(0.8, -2.85, 1.0));
    for (const b of this.heads) b.set(this.lights * 2.2); for (const b of this.tails) b.set(0.4 + this.lights * 0.8);
    const back = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(fw, -2.5); this.dustU.uA.value.copy(back); this.dustU.uB.value.copy(back.clone().addScaledVector(fw, -90));
  }
}

// ------------------------------------------------------------------ switch LightField lights (sprites and pools) after build(): the floods come on
// lfSwitch(lf, indices, k): scales those lights' sprite colour and pool to k x their built value; marks the lightmap dirty.
export function lfSwitch(lf, idx, k) {
  const lc = lf.points.geometry.getAttribute('lcol'), pc = lf.pools.geometry.getAttribute('pc');
  lf._lc0 ||= lc.array.slice(); lf._pc0 ||= pc.array.slice();
  for (const i of idx) { for (let c = 0; c < 3; c++) lc.array[i * 3 + c] = lf._lc0[i * 3 + c] * k;
    const q = lf.poolMap.get(i); if (q !== undefined) for (let c = 0; c < 3; c++) pc.array[q * 3 + c] = lf._pc0[q * 3 + c] * k; }
  lc.needsUpdate = true; pc.needsUpdate = true; lf.dirty = true;
}

// ------------------------------------------------------------------ a grain truck (tractor + hopper trailer), for the yard queue
export function grainTruck(world, lf, { x, z, yaw = 0, y = 0, color = '#8a1c14', trailer = '#9aa0a4' } = {}) {
  const g = new THREE.Group(), m = (c, r = 0.6, mt = 0.2) => { const q = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: mt }); if (lf) patchMaterial(q, lf, { wallFall: 4 }); return q; };
  const box = (w, h, d, px, py, pz, mat) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); o.position.set(px, py, pz); g.add(o); };
  box(2.5, 2.2, 3.2, 0, 2.0, 8.2, m(color, 0.4, 0.4)); box(2.5, 1.2, 2.2, 0, 1.4, 10.3, m(color, 0.4, 0.4)); box(2.5, 0.4, 20, 0, 0.9, 0, m('#141414', 0.9, 0));
  box(2.6, 2.0, 13, 0, 2.3, -2.5, m(trailer, 0.45, 0.6)); box(2.2, 0.8, 11, 0, 1.2, -2.5, m('#3a3c3e', 0.6, 0.5));
  g.position.set(x, y, z); g.rotation.y = yaw; world.scene.add(g); g.updateMatrixWorld(true);
  const w = v => g.localToWorld(new THREE.Vector3(...v)).toArray();
  return { group: g, tails: [w([-1.1, 1.2, -9.1]), w([1.1, 1.2, -9.1])], heads: [w([-1.0, 1.3, 11.45]), w([1.0, 1.3, 11.45])], front: w([0, 0.1, 30]) };
}
// a worker, standing: legs, coat, head, hard hat (reads as a silhouette with a lit hat in a flood pool at 300-500 m)
export function worker(world, lf, { x, z, y = 0, yaw = 0, hat = '#e8c020' } = {}) {
  const g = new THREE.Group(), m = (c) => { const q = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }); if (lf) patchMaterial(q, lf, { wallFall: 2 }); return q; };
  const cyl = (r0, r1, h, py, mat, px = 0) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, 10), mat); o.position.set(px, py, 0); g.add(o); };
  cyl(0.09, 0.08, 0.85, 0.43, m('#22262c'), -0.11); cyl(0.09, 0.08, 0.85, 0.43, m('#22262c'), 0.11); cyl(0.24, 0.2, 0.7, 1.2, m('#3a3024'));
  const hd = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), m('#8a5a40')); hd.position.y = 1.68; g.add(hd);
  const ht = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), m(hat)); ht.position.y = 1.74; g.add(ht);
  g.position.set(x, y, z); g.rotation.y = yaw; world.scene.add(g); return g;
}
