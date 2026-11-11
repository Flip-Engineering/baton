// TYPE LIGHT (TYPE studio, cycle 2): light makes the letter. Type that is light is SCENE light: emitters or reflectors
// placed in the three.js world, their luminance computed from the world's own lights. No screen-space glow, no sprite
// halo: at most the 1-2 px core a lens gives a point source (the look's own lens bloom is the only spread, and a
// lab turns it down).
//
//   buttonCopy()      the legend of a US guide sign in BUTTON COPY: white-painted letters studded with rows of round
//                     retroreflective buttons that follow the strokes. Dark until the headlights reach it; each button
//                     throws the beam back to the driver, so the legend ignites as you approach, twinkles as the angle
//                     sweeps, and blazes when the driver flashes the high beams (uHigh). The low beam's overhead-sign
//                     zone edge (uCut, degrees above the lamp axis) climbs the rows as the rig crests.
//   buttonMaterial()  the ShaderMaterial for a buttonCopy panel (americana_road.js Headlights + atmos3d uniforms)
//   SkySwarm          a drone-show formation as a VOLUMETRIC ANAMORPHOSIS: glyph samples pushed along the rays from a
//                     design camera to random depths, so the word reads only from that one viewpoint and is a scattered
//                     constellation everywhere else. Drones lift off from given sources (the scaffold's work lights),
//                     fly to their formation slot, lock, hover, then re-form into a disc (the sun made of the lights).
//                     Points with a 1-2 px core, per-drone colour temperature, size and extinction by depth.
import * as THREE from 'three';
import { setBlock } from './type_world.js';
import { ATMOS_GLSL, LF_GLSL } from './atmos3d.js';

// ================================================================ button copy
// buttonCopy(font, lines, o) -> { canvas, w, h, pxPerM, wM, hM, block, buttons, capsM }
//   lines  [{ text, cap (m) | fill, sx }] legend lines (sign grammar: no punctuation)
//   o      wM, hM panel size (m), pxPerM texture density, button (m, diameter), pitch (m), border (m), green
// Texture channels: R = button disc coverage, G = per-button random (twinkle), B = white paint, A = 1.
export function buttonCopy(font, lines, { wM = 8.4, hM = 4.6, pxPerM = 300, button = 0.032, pitch = 0.046, border = 0.1, gap = 0.26, sx = 0.8, seed = 7, borderButtons = true } = {}) {
  const w = Math.round(wM * pxPerM), h = Math.round(hM * pxPerM), P = pxPerM;
  const strip = t => t.replace(/[.!,]/g, '');
  const block = setBlock(font, lines.map(l => ({ ...l, text: strip(l.text), cap: l.cap != null ? l.cap * P : undefined, max: l.max != null ? l.max * P : undefined })),
    { role: 'plant', cap: 1.2 * P, x: w / 2, y: h / 2 + 0.05 * P, maxW: w - 2 * (border + 0.35) * P, gap, sx, justify: false });
  // paint mask (letters + border)
  const paint = document.createElement('canvas'); paint.width = w; paint.height = h; const pg = paint.getContext('2d', { willReadFrequently: true });
  pg.fillStyle = '#fff'; for (const G of block.glyphs) { pg.save(); pg.translate(G.ox, G.oy); pg.fill(G.path); pg.restore(); }
  const bi = 0.12 * P, bw = border * P, r = 0.22 * P;
  pg.strokeStyle = '#fff'; pg.lineWidth = bw; pg.beginPath(); pg.roundRect(bi, bi, w - 2 * bi, h - 2 * bi, r * 0.7); pg.stroke();
  const pm = pg.getImageData(0, 0, w, h).data;
  const inside = (x, y) => { x = Math.round(x); y = Math.round(y); return x >= 0 && y >= 0 && x < w && y < h && pm[(y * w + x) * 4 + 3] > 127; };
  // buttons: a hex lattice inside the paint, kept a button-radius clear of the edge (they sit ON the stroke)
  const R = button * P / 2, pp = pitch * P, rr = (() => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const buttons = [];
  for (let j = 0, y = pp / 2; y < h; y += pp * 0.866, j++) for (let x = pp / 2 + (j % 2) * pp / 2; x < w; x += pp) {
    let ok = inside(x, y); if (!ok) continue;
    for (let k = 0; k < 8 && ok; k++) { const a = k * Math.PI / 4; ok = inside(x + Math.cos(a) * R * 1.25, y + Math.sin(a) * R * 1.25); }
    if (ok) buttons.push([x, y, rr()]);
  }
  // compose RGBA
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d', { willReadFrequently: true });
  const id = g.createImageData(w, h), d = id.data;
  for (let i = 0; i < w * h; i++) { d[i * 4 + 2] = pm[i * 4 + 3]; d[i * 4 + 3] = 255; }
  for (const [bx, by, rnd] of buttons) {                   // anti-aliased disc, radius R, the random in G
    const x0 = Math.floor(bx - R - 1), x1 = Math.ceil(bx + R + 1), y0 = Math.floor(by - R - 1), y1 = Math.ceil(by + R + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const c = Math.min(1, Math.max(0, R + 0.5 - Math.hypot(x + 0.5 - bx, y + 0.5 - by))); if (c <= 0) continue;
      const i = (y * w + x) * 4; d[i] = Math.max(d[i], c * 255); d[i + 1] = rnd * 255; }
  }
  g.putImageData(id, 0, 0);
  return { canvas: cv, w, h, pxPerM: P, wM, hM, block, buttons: buttons.length, capsM: block.caps.map(c => c / P), lineWidthsM: block.lines.map(l => (l.bbox.x2 - l.bbox.x1) / P) };
}

const V_GLSL = `varying vec2 vUv; varying vec3 vWP; varying vec3 vN; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vWP = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
// buttonMaterial(atmos, lf, hl, panel, o): uniforms uCut (deg: the low beam's overhead-sign zone edge above the lamp
// axis), uHigh (0..1 high-beam envelope), uPitch (deg: the rig's pitch, lifts both patterns), gains.
export function buttonMaterial(atmos, lf, hl, panel, { ambient = 0.0015, gainB = 6, gainF = 0.5, gainP = 0.6, world = 0.035, green = [0.004, 0.06, 0.028] } = {}) {
  const tex = new THREE.CanvasTexture(panel.canvas); tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return new THREE.ShaderMaterial({
    uniforms: { ...atmos.U, ...lf.U, ...hl.U, tBtn: { value: tex }, uAmb: { value: ambient }, uCut: { value: 2.0 }, uHigh: { value: 0 }, uPitch: { value: 0 },
      uGainB: { value: gainB }, uWorld: { value: world }, uGainF: { value: gainF }, uGainP: { value: gainP }, uGreen: { value: new THREE.Vector3(...green) } },
    vertexShader: V_GLSL,
    fragmentShader: ATMOS_GLSL + LF_GLSL + /* glsl */`
      uniform vec3 uHL0, uHL1, uHLF; uniform float uHLI;
      uniform sampler2D tBtn; uniform float uAmb, uCut, uHigh, uPitch, uGainB, uGainF, uGainP, uWorld; uniform vec3 uGreen;
      varying vec2 vUv; varying vec3 vWP; varying vec3 vN;
      // headlight illuminance: the low beam (bright below the cut-off, plus the SAE overhead-sign zone up to uCut) and the
      // high beam (a narrower, taller, ~3x brighter lobe) when uHigh > 0. Angles are above the lamp axis, which the
      // rig's pitch lifts.
      float lampE(vec3 p, vec3 h, vec3 n){ vec3 d = p - h; float r = length(d); vec3 u = d / r;
        float up = degrees(asin(clamp(u.y, -1., 1.))) - uPitch;
        float side = degrees(acos(clamp(dot(normalize(u.xz), normalize(uHLF.xz)), -1., 1.)));
        float low = (up < .5 ? 1. : .004 + .45 * smoothstep(uCut + .4, uCut - .4, up)) * exp(-pow(side / 20., 2.));
        float high = uHigh * 3. * smoothstep(16., 12., up) * exp(-pow(side / 14., 2.));
        return uHLI * (low + high) * max(dot(n, -u), 0.) / (r*r) * step(0., dot(u.xz, uHLF.xz)); }
      // retroreflection toward the eye riding with the lamps: glass buttons return a wider cone than sheeting
      float retroB(vec3 p, vec3 h){ vec3 a = normalize(h - p), b = normalize(uCamPos - p); float ang = acos(clamp(dot(a, b), -1., 1.)); return exp(-pow(ang / .035, 2.)) + .12*exp(-ang / .08); }
      float retroS(vec3 p, vec3 h){ vec3 a = normalize(h - p), b = normalize(uCamPos - p); float ang = acos(clamp(dot(a, b), -1., 1.)); return exp(-pow(ang / .012, 2.)) + .08*exp(-ang / .05); }
      void main(){
        vec4 T = texture2D(tBtn, vUv); float btn = T.r, rnd = T.g, paint = T.b;
        vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
        float e0 = lampE(vWP, uHL0, n), e1 = lampE(vWP, uHL1, n);
        vec3 alb = mix(uGreen, vec3(.78), paint);
        vec3 c = alb * (uAmb + lightAt(vWP) * uWorld * .25 / 3.14159) + alb * (e0 + e1) * .002;       // diffuse: the world's lamps + a little headlight
        c += uGreen * (1. - paint) * (e0*retroS(vWP, uHL0) + e1*retroS(vWP, uHL1)) * uGainF;  // the green field's sheeting (weak)
        c += vec3(.78) * paint * (1. - btn) * (e0 + e1) * uGainP * .01;                      // the painted letter: not retroreflective
        // each button: its facet catches the beam at its own angle, so it twinkles as the rig moves (seeded per button)
        float sp = .45 + 1.1 * pow(.5 + .5 * sin(rnd * 97. + uCamPos.z * 1.9 + uCamPos.y * 7.), 3.);
        c += vec3(1., .97, .9) * btn * sp * (e0*retroB(vWP, uHL0) + e1*retroB(vWP, uHL1)) * uGainB;
        gl_FragColor = vec4(c, 1.);
      }` });
}

// ================================================================ sky swarm: an anamorphic drone formation
// SkySwarm(scene, o): scene: where the points live. Under atmos3d pass world.atmos.overlay (the emitter layer rendered
// after the fog/sky pass; the main scene's sky pass would paint over depth-less points). o.block a type_world Block set in a virtual 2D frame (1080 x 1920 px); o.design the design camera
// { pos, target, fov } whose view the formation must match; o.depth [near, far] m along the rays; o.sources(i) ->
// [x, y, z] launch point per drone (work lights); o.disc { centre, radius } the sun the formation becomes.
// update(t, { launch, lock, disc, hover }): song-time keys. Drones fly source -> slot between launch and lock
// (staggered starts, all arrive by lock), hover in place, and from disc -> disc + 0.35 s re-form into the disc.
export class SkySwarm {
  constructor(scene, { block, design, depth = [180, 420], sources, disc = null, spacing = 12, seed = 5, red = 0.25, size = 2.2, extinction = 1 / 3000 } = {}) {
    const rnd = (() => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
    // 1. sample the glyphs on a jittered grid in the 1080 x 1920 design frame
    const b = block.bbox, x0 = Math.floor(b.x1 - 4), y0 = Math.floor(b.y1 - 4), w = Math.ceil(b.x2 - b.x1 + 8), h = Math.ceil(b.y2 - b.y1 + 8);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d', { willReadFrequently: true });
    g.translate(-x0, -y0); g.fillStyle = '#fff'; for (const G of block.glyphs) { g.save(); g.translate(G.ox, G.oy); g.fill(G.path); g.restore(); }
    const d = g.getImageData(0, 0, w, h).data, px = [];
    for (let y = spacing / 2, j = 0; y < h; y += spacing * 0.9, j++) for (let x = spacing / 2 + (j % 2) * spacing / 2; x < w; x += spacing) {
      const X = Math.round(x + (rnd() - 0.5) * spacing * 0.3), Y = Math.round(y + (rnd() - 0.5) * spacing * 0.3);
      if (X >= 0 && Y >= 0 && X < w && Y < h && d[(Y * w + X) * 4 + 3] > 127) px.push([X + x0, Y + y0]);
    }
    // 2. unproject each sample through the design camera and push it to a random depth along its ray
    const cam = new THREE.PerspectiveCamera(design.fov, 1080 / 1920, 0.5, 10000); cam.position.set(...design.pos); cam.lookAt(new THREE.Vector3(...design.target)); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const N = px.length, slot = new Float32Array(N * 3), src = new Float32Array(N * 3), dsc = new Float32Array(N * 3), meta = new Float32Array(N * 4);
    const o = cam.position.clone();
    for (let i = 0; i < N; i++) {
      const ndc = new THREE.Vector3(px[i][0] / 1080 * 2 - 1, 1 - px[i][1] / 1920 * 2, 0.5).unproject(cam), dir = ndc.sub(o).normalize();
      const t = depth[0] + (depth[1] - depth[0]) * rnd(), p = o.clone().addScaledVector(dir, t);
      slot.set([p.x, p.y, p.z], i * 3);
      const s = sources(i, rnd); src.set(s, i * 3);
      meta.set([rnd(), rnd() < red ? 1 : 0, rnd(), t], i * 4);       // launch stagger, red, twinkle phase, design depth
      if (disc) { const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * disc.radius, [cx, cy, cz] = disc.centre, [ux, uy, uz] = disc.u || [1, 0, 0], [vx, vy, vz] = disc.v || [0, 1, 0];
        const jz = (rnd() - 0.5) * (disc.thick || 20); dsc.set([cx + ux * Math.cos(a) * rr + vx * Math.sin(a) * rr, cy + uy * Math.cos(a) * rr + vy * Math.sin(a) * rr + jz * 0.1, cz + uz * Math.cos(a) * rr + vz * Math.sin(a) * rr + jz], i * 3); }
    }
    Object.assign(this, { N, slot, src, dsc, meta, design: cam, samples: px, disc });
    const geo = new THREE.BufferGeometry(); this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: size }, uExt: { value: extinction }, uH: { value: 1920 }, uGrow: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
      vertexShader: `uniform float uSize, uExt, uH, uGrow; varying vec3 vC; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); float z = -mv.z; gl_Position = projectionMatrix * mv;
          // a drone light is a point source: its core stays ~1-2 px (a lens, not a sprite); far ones fade by extinction
          gl_PointSize = uSize * (1. + uGrow) + 1.5 * clamp(60. / z, 0., 1.); vA = exp(-z * uExt); vC = color; }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 q = gl_PointCoord * 2. - 1.; float r = dot(q, q); if (r > 1.) discard; float core = smoothstep(1., .15, r); gl_FragColor = vec4(vC * core * vA, 1.); }` });
    this.points = new THREE.Points(geo, this.mat); this.points.frustumCulled = false; scene.add(this.points);
  }
  // keys (song seconds): launch (first take-off), lock (every drone in its slot), disc (re-form start), discDur
  update(t, { launch, lock, disc = null, discDur = 0.4, gain = 1, redAtDisc = true } = {}) {
    const { N, slot, src, dsc, meta, pos, col } = this; let home = 0;
    for (let i = 0; i < N; i++) {
      const st = launch + meta[i * 4] * (lock - launch) * 0.45, u = Math.min(1, Math.max(0, (t - st) / (lock - st)));
      const e = u < 1 ? u * u * (3 - 2 * u) : 1;
      let x, y, z;
      // take-off: straight up first, then curve to the slot (a real show climbs, then translates)
      const up = Math.min(1, e * 2.2), sx = src[i * 3], sy = src[i * 3 + 1], sz = src[i * 3 + 2];
      const lx = slot[i * 3], ly = slot[i * 3 + 1], lz = slot[i * 3 + 2], m = e * e;
      x = sx + (lx - sx) * m; z = sz + (lz - sz) * m; y = sy + (ly - sy) * (0.55 * up + 0.45 * m);
      if (u >= 1) { home++; const hv = 0.3, ph = meta[i * 4 + 2] * 30; x += Math.sin(t * 1.3 + ph) * hv; y += Math.sin(t * 1.7 + ph * 1.3) * hv; }
      let r = 1, g = 0.93, b = 0.82;                    // warm white (about 3500 K)
      if (meta[i * 4 + 1]) { r = 1; g = 0.18; b = 0.1; }
      if (disc != null && t >= disc && this.disc) { const k = Math.min(1, (t - disc) / discDur), kk = k * k * (3 - 2 * k);
        x += (dsc[i * 3] - x) * kk; y += (dsc[i * 3 + 1] - y) * kk; z += (dsc[i * 3 + 2] - z) * kk;
        if (redAtDisc) { r = r + (1 - r) * kk; g = g + (0.1 - g) * kk; b = b + (0.05 - b) * kk; } const dim = 1 - 0.4 * kk; r *= dim; g *= dim; b *= dim; }
      const on = t >= st ? 1 : 0.55;                    // parked on the scaffold: the work light it was
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; col[i * 3] = r * gain * on; col[i * 3 + 1] = g * gain * on; col[i * 3 + 2] = b * gain * on;
    }
    this.mat.uniforms.uGrow.value = disc != null && t >= disc ? 0.6 * Math.min(1, (t - disc) / discDur) : 0;   // a packed disc: the drones close up
    this.points.geometry.attributes.position.needsUpdate = true; this.points.geometry.attributes.color.needsUpdate = true;
    return home / N;
  }
}
