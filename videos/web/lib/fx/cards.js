// CARDS (WORLDS studio c1, pass 2): the Hades method (Blade Runner, EEG 1982) and baked plumes, on atmos3d.js.
//
//   SilhouetteRows   rows of procedurally DRAFTED silhouettes on vertical cards at true depth: an endless refinery or a far
//                    skyline as 6-14 rows, big in front and small behind, drawn at 2-4 px per metre from a shape grammar with
//                    fibre-optic point windows. The cards write depth, so the haze pass (and the painted ramp) fogs each row
//                    at its own distance: depth by value planes, detail at 4K for the cost of a textured quad.
//     kinds  'plant'  distillation and cracking columns with platforms, pipe racks, Horton spheres, tank farms, stacks,
//                     flare derricks, stair towers, conveyors, cooling towers, sheds; sodium platform lights, red obstruction
//            'city'   setback towers (1916 zoning envelopes), crowns (pyramid, stepped, arched, mast, spire, flat + tanks),
//                     office floors lit in bands, dark mechanical floors, floodlit crowns, rooftop water tanks
//            'trees'  a tree line / shelterbelt: lobed crowns, trunks, gaps
//   PlumeCards       steam plumes baked per source on the CPU (a bent, widening column of billows with self-shadow from
//                    below and from above), drawn as yaw-billboard cards in the overlay: white, lit from below by the plant
//                    (the LightField at the stack foot + Link keys), from above by the moon, at a true size.
import * as THREE from 'three';
import { ATMOS_GLSL, LF_GLSL } from './atmos3d.js';
import { rng } from './americana.js';

// ------------------------------------------------------------------ small 2D value noise for the bakes (JS)
function vnoise(seed = 1) {
  const P = new Uint8Array(512), r = rng(seed); const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
  const G = new Float32Array(256); for (let i = 0; i < 256; i++) G[i] = r();
  const n2 = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = G[P[(P[xi & 255] + yi) & 511]], b = G[P[(P[(xi + 1) & 255] + yi) & 511]], c = G[P[(P[xi & 255] + yi + 1) & 511]], d = G[P[(P[(xi + 1) & 255] + yi + 1) & 511]];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  const fbm = (x, y, o = 5) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * n2(x * f, y * f); f *= 2.03; a *= 0.5; } return s / (1 - Math.pow(0.5, o)); };
  return { n2, fbm };
}

// ------------------------------------------------------------------ the grammar: draw one row (metres -> px), three layers
// mask (body), edge (drafted rails, platforms, ribs that catch light), light (point windows / lamps)
function drawRow(kind, R, ppm, seed) {
  const r = rng(seed), W = Math.min(4096, Math.ceil((R.x1 - R.x0) * ppm)), Hm = R.hMax * 1.4, k = W / (R.x1 - R.x0), H = Math.min(2048, Math.ceil(Hm * k));
  const sx = x => x * k, sy = y => H - y * k;                                              // x metres from row start, y metres up
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return [c, c.getContext('2d')]; };
  const [, M] = mk(), [, E] = mk(), [, L] = mk();
  M.fillStyle = '#fff'; E.strokeStyle = '#fff'; E.fillStyle = '#fff';
  const lights = [];                                                                        // big ones for the LightField (row-local metres)
  const rect = (x, y, w, h) => M.fillRect(sx(x), sy(y + h), Math.max(1, w * k), Math.max(1, h * k));
  const line = (x0, y0, x1, y1, w = 0.4) => { E.lineWidth = Math.max(0.8, w * k); E.beginPath(); E.moveTo(sx(x0), sy(y0)); E.lineTo(sx(x1), sy(y1)); E.stroke(); };
  const mline = (x0, y0, x1, y1, w = 0.5) => { M.lineWidth = Math.max(0.8, w * k); M.strokeStyle = '#fff'; M.beginPath(); M.moveTo(sx(x0), sy(y0)); M.lineTo(sx(x1), sy(y1)); M.stroke(); };
  const dot = (x, y, col, s = 1, big = 0) => { L.fillStyle = col; const d = Math.max(1, s * k * 0.5); L.fillRect(sx(x) - d / 2, sy(y) - d / 2, d, d); if (big) lights.push({ x, y, col, i: big }); };
  const SOD = '#ffae5a', LED = '#fff0d8', RED = '#ff2010', COOL = '#cfe4ff';
  const span = R.x1 - R.x0;
  if (kind === 'trees') {
    let x = 0; while (x < span) { if (r() < 0.06) { x += 20 + r() * 80; continue; }
      const cw = 6 + r() * 10, ch = R.hMax * (0.55 + 0.45 * r()); M.beginPath();
      for (let a = 0; a <= Math.PI; a += Math.PI / 10) { const rr = 1 + 0.18 * Math.sin(a * 7 + x); M.lineTo(sx(x + cw / 2 - Math.cos(a) * cw / 2 * rr), sy(ch * 0.35 + Math.sin(a) * ch * 0.65 * rr)); }
      M.lineTo(sx(x + cw * 0.55), sy(0)); M.lineTo(sx(x + cw * 0.45), sy(0)); M.closePath(); M.fill(); x += cw * (0.45 + 0.4 * r()); }
    M.fillRect(0, sy(R.hMax * 0.3), W, H);
  }
  if (kind === 'plant') {
    let x = 4;
    rect(0, 0, span, 3 + r() * 3);                                                          // the ground mass of fences, sheds, rail cars
    while (x < span - 10) {
      const t = r(), hs = R.hMax;
      if (t < 0.2) {                                                                         // a column cluster: 2-5 columns, platforms, piping
        const n = 2 + Math.floor(r() * 4); for (let i = 0; i < n; i++) { const w = 3 + r() * 5, h = hs * (0.35 + 0.6 * r()), cx = x + i * (w + 2 + r() * 4);
          rect(cx, 0, w, h); rect(cx + w * 0.3, h, w * 0.4, 2 + r() * 3);
          for (let y = 8 + r() * 4; y < h - 2; y += 7 + r() * 5) { rect(cx - 1.2, y, w + 2.4, 0.5); line(cx - 1.2, y + 0.5, cx + w + 1.2, y + 0.5, 0.25); line(cx - 1.2, y + 1.5, cx + w + 1.2, y + 1.5, 0.12);
            if (r() < 0.55) dot(cx + (r() < 0.5 ? -1 : w + 1), y + 1.2, r() < 0.8 ? SOD : LED, 0.9); }
          line(cx + w + 0.6, 0, cx + w + 0.6, h, 0.15);                                      // ladder cage
          if (h > hs * 0.7) dot(cx + w / 2, h + 3, RED, 1.2, 3); }
        for (let y = 10; y < hs * 0.5; y += 9 + r() * 8) mline(x - 2, y, x + n * 9, y + (r() - 0.5) * 3, 0.6);
        x += n * 9 + 6;
      } else if (t < 0.36) {                                                                 // pipe rack run
        const Lr = 30 + r() * 70, h = 7 + r() * 5; for (let i = 0; i < 4; i++) rect(x, h - i * 1.2, Lr, 0.5);
        for (let xx = x; xx < x + Lr; xx += 6) rect(xx, 0, 0.4, h);
        line(x, h + 0.6, x + Lr, h + 0.6, 0.2); for (let xx = x + 3; xx < x + Lr; xx += 18 + r() * 10) dot(xx, h + 1.5, SOD, 0.9);
        x += Lr + 2;
      } else if (t < 0.46) {                                                                 // Horton spheres on legs
        const rr = 6 + r() * 4, n = 1 + Math.floor(r() * 3); for (let i = 0; i < n; i++) { const cx = x + rr + i * (2 * rr + 3);
          M.beginPath(); M.arc(sx(cx), sy(rr + 4), rr * k, 0, Math.PI * 2); M.fill(); for (let q = -2; q <= 2; q++) rect(cx + q * rr * 0.4, 0, 0.5, rr + 4);
          E.lineWidth = Math.max(0.8, 0.25 * k); E.beginPath(); E.arc(sx(cx), sy(rr + 4), rr * k, Math.PI * 1.1, Math.PI * 1.9); E.stroke(); }
        x += n * (2 * rr + 3) + 3;
      } else if (t < 0.58) {                                                                 // tank farm
        const n = 2 + Math.floor(r() * 4); for (let i = 0; i < n; i++) { const w = 18 + r() * 22, h = 10 + r() * 8; rect(x, 0, w, h);
          M.beginPath(); M.ellipse(sx(x + w / 2), sy(h), w * k / 2, 1.2 * k, 0, Math.PI, 0); M.fill(); line(x + 2, 2, x + w - 3, h - 1, 0.18); line(x, h, x + w, h, 0.2); if (r() < 0.4) dot(x + w - 1, h + 1, SOD, 0.8); x += w + 3 + r() * 5; }
      } else if (t < 0.66) {                                                                 // a stack
        const w = 3 + r() * 3, h = hs * (0.75 + 0.35 * r()); M.beginPath(); M.moveTo(sx(x), sy(0)); M.lineTo(sx(x + w * 0.2), sy(h)); M.lineTo(sx(x + w * 0.8), sy(h)); M.lineTo(sx(x + w), sy(0)); M.fill();
        line(x + w * 0.21, h - 6, x + w * 0.79, h - 6, 0.8); dot(x + w / 2, h + 0.5, RED, 1.4, 4); dot(x + w / 2, h * 0.5, RED, 1.1, 2);
        R.stacks.push({ x: x + w / 2, h }); x += w + 6;
      } else if (t < 0.72) {                                                                 // flare derrick with its flame
        const h = hs * (0.5 + 0.3 * r()), w = 6; for (const sd of [0, w]) mline(x + sd, 0, x + w / 2 + (sd ? 0.6 : -0.6), h, 0.35);
        for (let y = 0; y < h - 4; y += 6) mline(x + (y / h) * w * 0.4, y, x + w - ((y + 6) / h) * w * 0.4, y + 6, 0.15);
        dot(x + w / 2, h + 3, '#ff8a2a', 4, 30); R.flares.push({ x: x + w / 2, h: h + 3 }); x += w + 8;
      } else if (t < 0.8) {                                                                 // stair tower + conveyor
        const w = 7, h = 22 + r() * 30; rect(x, 0, 0.5, h); rect(x + w, 0, 0.5, h); for (let y = 0; y < h; y += 3.6) { line(x, y, x + w, y + 1.8, 0.14); rect(x, y, w, 0.3); }
        rect(x - 0.5, h, w + 1.5, 3); mline(x + w, h - 2, x + w + 50 + r() * 40, 4, 3.2); line(x + w, h - 3.6, x + w + 50, 2.4, 0.2); dot(x + w / 2, h + 1.5, LED, 1);
        x += w + 60;
      } else if (t < 0.84 && R.cooling !== false) {                                          // natural-draught cooling tower
        const w = 55 + r() * 25, h = hs * (0.55 + 0.2 * r()), ins = u => w * 0.22 * Math.pow(Math.sin(Math.min(1, u / 0.78) * Math.PI / 2), 1.2) * (u < 0.78 ? 1 : 1 - (u - 0.78) * 1.6);
        M.beginPath(); M.moveTo(sx(x), sy(0));
        for (let i = 0; i <= 20; i++) M.lineTo(sx(x + ins(i / 20)), sy(i / 20 * h));
        for (let i = 20; i >= 0; i--) M.lineTo(sx(x + w - ins(i / 20)), sy(i / 20 * h));
        M.fill(); for (let y = 6; y < h; y += 9) line(x + w * 0.2, y, x + w * 0.8, y, 0.1); R.coolers.push({ x: x + w / 2, h, w }); x += w + 8;
      } else {                                                                               // sheds with sawtooth / monitor roofs, lit clerestory
        const w = 40 + r() * 80, h = 12 + r() * 16; rect(x, 0, w, h);
        if (r() < 0.5) for (let xx = x; xx < x + w - 6; xx += 8) { M.beginPath(); M.moveTo(sx(xx), sy(h)); M.lineTo(sx(xx), sy(h + 4)); M.lineTo(sx(xx + 8), sy(h)); M.fill(); }
        else { rect(x + w * 0.1, h, w * 0.8, 4); for (let xx = x + w * 0.12; xx < x + w * 0.88; xx += 2.2) dot(xx, h + 2, '#ffb868', 0.9); }
        line(x, h, x + w, h, 0.25); for (let xx = x + 6; xx < x + w; xx += 14) if (r() < 0.5) dot(xx, 5, SOD, 1.1);
        x += w + 4;
      }
      x += r() * 6;
    }
  }
  if (kind === 'city') {
    let x = 2;
    while (x < span - 8) {
      const pk = R.peakAt != null ? 0.45 + 0.9 * Math.exp(-((((x / span) - R.peakAt) / 0.18) ** 2)) : 1;
      const H0 = Math.min(R.hMax, R.hMin + (R.hMax - R.hMin) * Math.pow(r(), 1.6) * pk);
      let w = 22 + r() * 34, y = 0; const cx = x + w / 2, tiers = H0 > 140 ? 2 + Math.floor(r() * 3) : 1 + Math.floor(r() * 2);
      const occ = 0.25 + 0.55 * r(), warm = r() < 0.75, floorH = 3.9, w0 = w;
      for (let t = 0; t < tiers; t++) { const th = t === tiers - 1 ? H0 - y : (H0 - y) * (0.45 + 0.2 * r());
        rect(cx - w / 2, y, w, th); line(cx - w / 2, y + th, cx + w / 2, y + th, 0.3);                // setback ledge catches light
        for (let fy = y + 4; fy < y + th - 1; fy += floorH) { const band = r() < occ, mech = (Math.floor(fy / floorH) % 22) === 0;
          if (mech) { line(cx - w / 2, fy, cx + w / 2, fy, 0.9); continue; }
          const wc = warm ? (r() < 0.85 ? '#ffc98a' : COOL) : (r() < 0.8 ? COOL : '#ffc98a');
          if (k < 3.2) { if (band) { let bx = cx - w / 2 + 1; while (bx < cx + w / 2 - 1) { const run = 3 + r() * w * 0.6, gap = r() * 6;           // far rows: lit runs along a floor, not dots
                L.fillStyle = wc; L.fillRect(sx(bx), sy(fy + 2.2), Math.max(1, Math.min(run, cx + w / 2 - 1 - bx) * k), Math.max(1, 1.1 * k)); bx += run + gap; } } else if (r() < 0.1) dot(cx + (r() - 0.5) * w * 0.8, fy + 1.4, wc, 0.9); }
          else for (let bx = cx - w / 2 + 1; bx < cx + w / 2 - 1; bx += 1.6) if ((band && r() < 0.8) || r() < 0.03) dot(bx, fy + 1.4, wc, 0.7); }
        y += th; w *= 0.66 + 0.14 * r(); if (y >= H0 - 1) break; }
      const ct = r();
      if (H0 > 200 && ct < 0.1) { M.beginPath(); M.moveTo(sx(cx - w / 2), sy(y)); M.lineTo(sx(cx), sy(y + w * 1.1)); M.lineTo(sx(cx + w / 2), sy(y)); M.fill();       // pyramid crown, floodlit
        for (let q = 0; q < 6; q++) line(cx - w / 2 + q * w / 12, y + q * w * 0.18, cx + w / 2 - q * w / 12, y + q * w * 0.18, 0.5); y += w * 1.1; }
      else if (H0 > 120 && ct < 0.4) { for (let q = 0; q < 4; q++) { const ww = w * (1 - q * 0.22); rect(cx - ww / 2, y, ww, 5); line(cx - ww / 2, y + 5, cx + ww / 2, y + 5, 0.6); y += 5; } }   // stepped ziggurat
      else if (H0 > 200 && ct < 0.6) { for (let q = 0; q < 4; q++) { const rr = w * 0.5 * (1 - q * 0.2); M.beginPath(); M.arc(sx(cx), sy(y + q * 5), rr * k, Math.PI, 0); M.fill();      // arched crown, lit sunbursts
          E.lineWidth = Math.max(0.8, 0.35 * k); E.beginPath(); E.arc(sx(cx), sy(y + q * 5), rr * k, Math.PI, 0); E.stroke(); for (let a = 0.2; a < Math.PI; a += 0.5) dot(cx - Math.cos(a) * rr * 0.9, y + q * 5 + Math.sin(a) * rr * 0.9, '#fff6e0', 0.8); } y += w * 0.9; }
      if (H0 > 150 && ct > 0.8) { const mh = 25 + r() * 60; rect(cx - 0.6, y, 1.2, mh); dot(cx, y + mh, RED, 1.3, 3); y += mh; }                           // mast / spire
      else if (H0 < 170 && r() < 0.6) { rect(cx - w * 0.3, y, w * 0.6, 5 + r() * 4); y += 5; const tx = cx + (r() - 0.5) * w * 0.5; rect(tx - 2, y + 3, 4, 4); M.beginPath(); M.moveTo(sx(tx - 2.2), sy(y + 7)); M.lineTo(sx(tx), sy(y + 9)); M.lineTo(sx(tx + 2.2), sy(y + 7)); M.fill(); for (const q of [-1.6, 1.6]) rect(tx + q, y, 0.3, 3); }  // rooftop water tank on stilts
      if (H0 > 110 && r() < 0.5) dot(cx, y + 1, RED, 1.2, 2);
      x += w0 + 1 + r() * 10;
    }
  }
  // the landmark (city): a 1930s setback tower with a floodlit crown and a mast, so the skyline is a PLACE (Ferriss)
  if (kind === 'city' && R.landmark) { const { x: lx, h: lh } = R.landmark; let w = 58, y = 0;
    for (const [f, sh] of [[0.2, 1], [0.62, 0.78], [0.8, 0.6], [0.88, 0.45], [0.93, 0.32]]) { const yy = lh * f; rect(lx - w * sh / 2, y, w * sh, yy - y); line(lx - w * sh / 2, yy, lx + w * sh / 2, yy, 0.5);
      for (let fy = y + 4; fy < yy - 1; fy += 3.9) { const band = r() < 0.5; for (let bx = lx - w * sh / 2 + 1; bx < lx + w * sh / 2 - 1; bx += 1.6) if (band && r() < 0.8) dot(bx, fy + 1.4, '#ffd8a0', 0.7); } y = yy; }
    for (let q = 0; q < 8; q++) { const ww = w * 0.32 * (1 - q * 0.09); rect(lx - ww / 2, y, ww, 3.2); for (let bx = lx - ww / 2; bx < lx + ww / 2; bx += 1.2) dot(bx, y + 1.6, '#fff4dc', 0.9); y += 3.2; }   // floodlit crown
    rect(lx - 1.5, y, 3, 18); rect(lx - 0.5, y + 18, 1, 40); dot(lx, y + 58, RED, 1.6, 4); }
  // pack: R = body mask, G = edge, B = light luminance, A = warmth (sodium > 128 > LED)
  const m = M.getImageData(0, 0, W, H).data, e = E.getImageData(0, 0, W, H).data, l = L.getImageData(0, 0, W, H).data, D = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, o = ((H - 1 - y) * W + x) * 4;
    const lum = Math.max(l[i], l[i + 1], l[i + 2]);
    D[o] = m[i + 3]; D[o + 1] = e[i + 3]; D[o + 2] = lum * (l[i + 3] / 255);
    D[o + 3] = lum ? Math.max(0, Math.min(255, Math.round((l[i] - l[i + 2]) * 0.5 + 128))) : 128; }
  const tex = new THREE.DataTexture(D, W, H, THREE.RGBAFormat); tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4; tex.needsUpdate = true;
  return { tex, W, H, Hm, lights };
}

const CARD_V = `varying vec2 vUv; varying vec3 vWP; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
export class SilhouetteRows {
  // rows: [{ z, x0, x1, hMax, hMin, y (base), kind?, ppm?, lit? (window gain), edge?, seed?, peakAt?, temp: [base, top] deg C }]
  // cards face +z (the camera is south of the rows); rotate the group for other headings
  constructor(world, atmos, lf, rows, { kind = 'plant', ppm = 2.5, body = '#15171a', edge = '#7a6a58', warm = '#ffb060', cool = '#d8e8ff', lightGain = 1, edgeGain = 1 } = {}) {
    this.rows = []; this.stacks = []; this.flares = []; this.coolers = []; this.meshes = [];
    const lin = (h, k = 1) => new THREE.Color(h).multiplyScalar(k);
    rows.forEach((R, i) => {
      const RR = { ...R, stacks: [], flares: [], coolers: [] };
      const d = drawRow(R.kind || kind, RR, R.ppm ?? ppm, R.seed ?? 100 + i * 17);
      const w = R.x1 - R.x0, h = d.Hm, y0 = R.y ?? 0;
      const g = new THREE.PlaneGeometry(w, h); g.translate(R.x0 + w / 2, y0 + h / 2, R.z);
      const U = { ...(lf ? lf.U : { tLight: { value: null }, uLightBox: { value: new THREE.Vector4(0, 0, 1, 1) }, uLightGain: { value: 0 } }), tC: { value: d.tex },
        uBody: { value: lin(R.body || body) }, uEdge: { value: lin(R.edgeCol || edge, (R.edge ?? 1) * edgeGain) }, uWarm: { value: lin(warm, (R.lit ?? 1) * lightGain) }, uCool: { value: lin(cool, (R.lit ?? 1) * lightGain) },
        uAmb: { value: lin(R.amb || '#1a1e2a', R.ambK ?? 0.02) }, uBase: { value: new THREE.Vector2(y0, h) } };
      const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: CARD_V, side: THREE.DoubleSide,
        fragmentShader: LF_GLSL + /* glsl */`
          uniform sampler2D tC; uniform vec3 uBody, uEdge, uWarm, uCool, uAmb; uniform vec2 uBase; varying vec2 vUv; varying vec3 vWP;
          void main(){ vec4 t = texture2D(tC, vUv); if (t.r < .45) discard;
            float hy = clamp((vWP.y - uBase.x) / uBase.y, 0., 1.);
            vec3 pool = lightAt(vec3(vWP.x, 0., vWP.z + 25.)) * exp(-(vWP.y - uBase.x) / 22.);       // the yard lights wash the base
            vec3 c = uBody * (uAmb * (.6 + .8*hy) + pool * .25) + uEdge * t.g * (.25 + dot(pool, vec3(.3)) * .05 + .15*hy);
            vec3 lc = mix(uCool, uWarm, clamp((t.a - .38) * 3., 0., 1.));
            c += lc * t.b * 1.6;
            gl_FragColor = vec4(c, 1.); }` });
      const mesh = new THREE.Mesh(g, mat); mesh.userData.temp = R.temp ? R.temp[1] : 30; mesh.userData.tempGrad = R.temp ? { y0, y1: y0 + R.hMax, t0: R.temp[0], t1: R.temp[1] } : null;
      mesh.userData.card = true; mesh.userData.cardTex = d.tex; world.scene.add(mesh);
      this.meshes.push(mesh); this.rows.push({ ...R, tex: d.tex, px: [d.W, d.H] });
      // the big practicals become LightField sprites (halos in the haze), at their world positions
      if (lf) for (const Lt of d.lights) lf.add({ pos: [R.x0 + Lt.x, y0 + Lt.y, R.z + 0.5], color: Lt.col, i: Lt.i * (R.lit ?? 1) * lightGain * (R.spriteK ?? 1), core: Lt.i > 10 ? 3 : 0.5, halo: Lt.i > 10 ? 1.2 : 0.4, minPx: Lt.i > 10 ? 2.5 : 1.3,
        blink: Lt.col === '#ff2010' && Lt.i >= 3 ? { period: 1.5, duty: 0.35, phase: 0 } : null });
      for (const s of RR.stacks) this.stacks.push({ x: R.x0 + s.x, y: y0 + s.h, z: R.z, row: i });
      for (const s of RR.flares) this.flares.push({ x: R.x0 + s.x, y: y0 + s.h, z: R.z, row: i });
      for (const s of RR.coolers) this.coolers.push({ x: R.x0 + s.x, y: y0 + s.h, z: R.z, w: s.w, row: i });
    });
  }
}

// ------------------------------------------------------------------ plumes: baked on the CPU, drawn as lit cards
export function bakePlume({ w = 96, h = 320, seed = 3, bend = 0.9, spread = 0.55, billow = 1, fade = 1.2, base = 0.05 } = {}) {
  const { fbm } = vnoise(seed), D = new Float32Array(w * h), out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) { const v = y / (h - 1), cxp = 0.5 + bend * 0.38 * Math.pow(v, 1.6) * (1 + 0.15 * Math.sin(v * 9 + seed)), wd = base + spread * 0.4 * Math.pow(v, 0.7);
    for (let x = 0; x < w; x++) { const u = x / (w - 1), rel = (u - cxp) / wd;
      const n = fbm(u * 5 / (0.3 + v), v * 9 - seed, 5), n2 = fbm(u * 13 + 3, v * 24 + seed, 3);
      let d = Math.exp(-rel * rel * (1.6 + 1.5 * n)) * (0.45 + 0.9 * n * billow + 0.25 * n2);
      d = Math.max(0, d - 0.18) * 1.9 * Math.pow(1 - v, fade) * Math.min(1, v * 40 + 0.15);
      D[y * w + x] = Math.min(1, d); } }
  // self-shadow: transmittance from below (the plant's light) and from above (the moon), along the column
  for (let x = 0; x < w; x++) { let acc = 0; for (let y = 0; y < h; y++) { const i = y * w + x; out[i * 4 + 1] = Math.exp(-acc * 0.06) * 255; acc += D[i]; }
    acc = 0; for (let y = h - 1; y >= 0; y--) { const i = y * w + x; out[i * 4 + 2] = Math.exp(-acc * 0.05) * 255; acc += D[i]; } }
  for (let i = 0; i < w * h; i++) { out[i * 4] = D[i] * 255; out[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
}
export class PlumeCards {
  // sources: [{ x, y (stack top), z, w (m, card width), h (m, card height), bend (0..1, downwind = +x on screen), seed, heat (deg C) }]
  constructor(atmos, lf, sources, { gain = 1, below = 1, keys = null, albedo = 0.92, moon = 1 } = {}) {
    const F = atmos.frameU; this.cards = [];
    for (const [k, S] of sources.entries()) {
      const tex = bakePlume({ seed: S.seed ?? 3 + k * 7, bend: S.bend ?? 0.8, spread: S.spread ?? 0.55, fade: S.fade ?? 1.2, base: S.base ?? 0.05 });
      const U = { ...atmos.U, ...(lf ? lf.U : {}), tP: { value: tex }, tDepth: F.tDepth, uRes: F.uRes, uOcc: F.uOcc, uFoot: { value: new THREE.Vector3(S.x, 0, S.z) },
        uGain: { value: gain * (S.gain ?? 1) }, uBelowK: { value: below }, uKey: { value: keys ? new THREE.Color(keys[0]).multiplyScalar(keys[1] ?? 1) : new THREE.Color(0, 0, 0) }, uAlb: { value: albedo }, uMoonK: { value: moon } };
      const g = new THREE.PlaneGeometry(1, 1); g.translate(0, 0.5, 0);
      const mat = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        vertexShader: `varying vec2 vUv; varying vec3 vWP; varying vec4 vCP; void main(){ vUv = uv;
            vec3 c = modelMatrix[3].xyz; vec3 right = normalize(vec3(viewMatrix[0][0], 0., viewMatrix[2][0]));        // yaw billboard
            vec3 sc = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), 1.);
            vec3 w = c + right * position.x * sc.x + vec3(0., position.y * sc.y, 0.); vWP = w;
            gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.); vCP = gl_Position; }`,
        fragmentShader: ATMOS_GLSL + (lf ? LF_GLSL : 'vec3 lightAt(vec3 p){ return vec3(0.); }\n') + /* glsl */`
          uniform sampler2D tP, tDepth; uniform float uOcc, uGain, uBelowK, uAlb, uMoonK; uniform vec3 uFoot, uKey; varying vec2 vUv; varying vec3 vWP; varying vec4 vCP;
          void main(){ vec3 ndc = vCP.xyz / vCP.w; if (uOcc > .5 && texture2D(tDepth, ndc.xy*.5+.5).r < ndc.z*.5+.5) discard;
            vec4 t = texture2D(tP, vUv); float a = t.r; if (a < .004) discard;
            float up = vUv.y;
            // below: the plant's light around the stack foot, falling off with height; Link keys rake the lower third
            vec3 foot = (lightAt(uFoot) + lightAt(uFoot + vec3(40., 0., 20.)) + lightAt(uFoot + vec3(-40., 0., -20.)) + lightAt(uFoot + vec3(0., 0., 45.))) * .25;
            vec3 below = (foot * .35 + uKey * exp(-up * 2.5)) * t.g * uBelowK * exp(-up * 1.4);
            vec3 top = vec3(dot(uSMoonCol, vec3(.33))) * 4. * uMoonK * t.b;
            vec3 amb = hazeCol(vec3(0., .2, -1.)) * .5 + vec3(.004);
            vec3 c = (below + top + amb) * uAlb * uGain;
            vec3 vd = normalize(vWP - uCamPos); float s = length(vWP - uCamPos); float tr = fogTr(vd, s);
            c = c * tr + fogCol(vd, s) * (1. - tr);
            a *= mix(1., tr, .5);
            gl_FragColor = vec4(c * a, a); }` });
      const m = new THREE.Mesh(g, mat); m.position.set(S.x, S.y - (S.h ?? 260) * 0.02, S.z); m.scale.set(S.w ?? 90, S.h ?? 260, 1); m.frustumCulled = false;
      m.userData.temp = S.heat ?? 45; m.userData.plume = true; m.userData.plumeTex = tex;
      atmos.overlay.add(m); this.cards.push(m);
    }
  }
}
