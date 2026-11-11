// STAGE / env: the fill of an indoor stage as an environment (equirect, cd/m2, before exposure). A room is a surround of three
// luminances (ceiling, walls, floor) with soft rectangular patches on it: the window, a fill card, the softbox face. The engine
// takes it as scene.environment (PMREM) and the background; stage_export.mjs writes the SAME array as Radiance .hdr for Cycles'
// world, so both renderers fill a figure from the same surround. Pure JS (no three): runs in the page and in node.
import { kelvin } from '../light/color.js';
import { sunDirection, equirectDir } from '../light/sky.js';

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// spec: { kelvin, up, side, down, patches: [{ elevation, azimuth, w, h, L, kelvin, soft }] } with every L a fraction of keyLux
// (cd/m2 per lux of key). Returns { data (Float32 RGBA, row 0 = nadir, three's equirectUv), W, H, irradiance (rgb lux on a surface
// facing each patch, for the notes) }
export function roomEnv(spec, keyLux, { W = 256, H = 128 } = {}) {
  const base = kelvin(spec.kelvin ?? 5600), data = new Float32Array(W * H * 4);
  const P = (spec.patches || []).map(p => { const d = sunDirection(p.elevation, p.azimuth), c = kelvin(p.kelvin ?? spec.kelvin ?? 5600);
    // the patch's own frame: centre d, right r (horizontal), up u
    const r = [Math.cos(p.azimuth * Math.PI / 180), 0, Math.sin(p.azimuth * Math.PI / 180)], u = [d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]];
    return { ...p, d, r, u, c, hw: Math.tan(p.w / 2 * Math.PI / 180), hh: Math.tan(p.h / 2 * Math.PI / 180), sf: Math.tan((p.soft ?? 2) * Math.PI / 180) }; });
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const v = equirectDir((i + 0.5) / W, (j + 0.5) / H), y = v[1];
    // the surround: floor below, walls round the horizon, ceiling above, blended over +-20 degrees
    const kUp = sm(0.15, 0.5, y), kDn = sm(0.0, -0.3, y), L0 = (spec.up * kUp + spec.down * kDn + spec.side * (1 - kUp - kDn)) * keyLux;
    const o = [base[0] * L0, base[1] * L0, base[2] * L0];
    for (const p of P) { const cz = v[0] * p.d[0] + v[1] * p.d[1] + v[2] * p.d[2]; if (cz <= 0.05) continue;
      const x = (v[0] * p.r[0] + v[1] * p.r[1] + v[2] * p.r[2]) / cz, yy = (v[0] * p.u[0] + v[1] * p.u[1] + v[2] * p.u[2]) / cz;
      const m = sm(p.hw + p.sf, p.hw - p.sf, Math.abs(x)) * sm(p.hh + p.sf, p.hh - p.sf, Math.abs(yy)), L = p.L * keyLux * m;
      if (m > 0) for (let c = 0; c < 3; c++) o[c] += p.c[c] * L; }
    const k = (j * W + i) * 4; data[k] = o[0]; data[k + 1] = o[1]; data[k + 2] = o[2]; data[k + 3] = 1;
  }
  return { data, W, H };
}
// the illuminance an env gives a small surface with normal n (rgb lux): for the notes and the key:fill checks
export function envIrradiance(env, n) {
  const { data, W, H } = env, e = [0, 0, 0];
  for (let j = 0; j < H; j++) { const el = ((j + 0.5) / H - 0.5) * Math.PI, dOm = (2 * Math.PI / W) * (Math.PI / H) * Math.cos(el);
    for (let i = 0; i < W; i++) { const v = equirectDir((i + 0.5) / W, (j + 0.5) / H), c = v[0] * n[0] + v[1] * n[1] + v[2] * n[2]; if (c <= 0) continue;
      const k = (j * W + i) * 4; for (let q = 0; q < 3; q++) e[q] += data[k + q] * c * dOm; } }
  return e;
}
// Radiance RGBE (.hdr), top row = zenith (Blender's and every reader's convention; our arrays run nadir first)
export function encodeHDR({ data, W, H }, scale = 1) {
  const head = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\nEXPOSURE=1\n\n-Y ${H} +X ${W}\n`, hb = new TextEncoder().encode(head);
  const out = new Uint8Array(hb.length + W * H * 4); out.set(hb);
  let o = hb.length;
  for (let j = H - 1; j >= 0; j--) for (let i = 0; i < W; i++) { const k = (j * W + i) * 4, r = data[k] * scale, g = data[k + 1] * scale, b = data[k + 2] * scale, m = Math.max(r, g, b);
    if (m < 1e-32) { out[o++] = 0; out[o++] = 0; out[o++] = 0; out[o++] = 0; continue; }
    const e = Math.ceil(Math.log2(m) + 1e-9), f = 256 / 2 ** e;
    out[o++] = Math.min(255, Math.floor(r * f)); out[o++] = Math.min(255, Math.floor(g * f)); out[o++] = Math.min(255, Math.floor(b * f)); out[o++] = e + 128; }
  return out;
}

// ---------------------------------------------------------------- CAMERA7 (round 7): an environment with STRUCTURE
// roomEnv's surround is three flat luminances plus soft rectangles. A photograph's light has a shape: a softbox is hot in the middle and falls off
// toward its edge, a window has panes and a sky behind them (bright at the horizon, deeper overhead), a studio's walls are flagged black on the
// shadow side, a white card under the chin lifts the sockets, and the room behind the camera is DARK. The cornea and the skin's sheen mirror
// exactly this, so a flat grey surround lays a grey veil over a dark iris (AUDIT7) and gives the skin nothing to reflect but itself.
//   spec: { kelvin, up, side, down (fractions of keyLux, as roomEnv), walls: [{ azimuth, w, k }] (the horizon band times k over w degrees of azimuth: a dark
//   studio behind the camera, a lit wall), flags: [{ elevation, azimuth, w, h, k, soft }] (black cards: the SURROUND times k inside the rectangle; the
//   patches are drawn after, so a flag never dims a source), patches: [{ elevation, azimuth, w, h, L, kelvin, soft, shape: 'rect' | 'ellipse',
//   falloff (0..1: the patch's edge reads 1 - falloff of its centre), vgrad: [bottom, top] (luminance multipliers over the patch's height: a sky),
//   tintTop / tintBot (rgb multipliers at the top and bottom: blue overhead), bars: { nx, ny, w (half width in patch units, 0..1), dark (0..1) } (window panes) }] }
// Same layout as roomEnv (Float32 RGBA, row 0 = nadir, three's equirectUv; cd/m2 before exposure). Pure JS.
export function roomEnv7(spec, keyLux, { W = 256, H = 128 } = {}) {
  const base = kelvin(spec.kelvin ?? 5600), data = new Float32Array(W * H * 4), D = Math.PI / 180;
  const frame = p => { const d = sunDirection(p.elevation, p.azimuth), r = [Math.cos(p.azimuth * D), 0, Math.sin(p.azimuth * D)], u = [d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]];
    return { ...p, d, r, u, hw: Math.tan(p.w / 2 * D), hh: Math.tan(p.h / 2 * D), sf: Math.tan((p.soft ?? 2) * D) }; };
  const P = (spec.patches || []).map(p => ({ ...frame(p), c: kelvin(p.kelvin ?? spec.kelvin ?? 5600) })), F = (spec.flags || []).map(frame), Wl = spec.walls || [];
  const local = (p, v) => { const cz = v[0] * p.d[0] + v[1] * p.d[1] + v[2] * p.d[2]; if (cz <= 0.05) return null;
    return [(v[0] * p.r[0] + v[1] * p.r[1] + v[2] * p.r[2]) / cz, (v[0] * p.u[0] + v[1] * p.u[1] + v[2] * p.u[2]) / cz]; };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const v = equirectDir((i + 0.5) / W, (j + 0.5) / H), y = v[1], kUp = sm(0.15, 0.5, y), kDn = sm(0.0, -0.3, y);
    let L0 = (spec.up * kUp + spec.down * kDn + spec.side * (1 - kUp - kDn)) * keyLux;
    // walls: the horizon band times k around an azimuth (the azimuth the patches use: sunDirection: atan2(x, -z) in degrees, 180 = toward the camera)
    if (Wl.length) { const az = ((Math.atan2(v[0], -v[2]) / D) + 360) % 360, band = 1 - kUp - kDn;
      for (const w of Wl) { let da = Math.abs(((az - w.azimuth + 540) % 360) - 180); L0 *= 1 + (w.k - 1) * band * sm(w.w / 2 + 10, w.w / 2 - 10, da); } }
    for (const f of F) { const q = local(f, v); if (!q) continue; const m = sm(f.hw + f.sf, f.hw - f.sf, Math.abs(q[0])) * sm(f.hh + f.sf, f.hh - f.sf, Math.abs(q[1])); L0 *= 1 - (1 - f.k) * m; }
    const o = [base[0] * L0, base[1] * L0, base[2] * L0];
    for (const p of P) { const q = local(p, v); if (!q) continue;
      const ux = q[0] / p.hw, uy = q[1] / p.hh;     // patch units: the box edge at +-1
      let m = p.shape === 'ellipse' ? sm(1 + p.sf / p.hw, 1 - p.sf / p.hw, Math.hypot(ux, uy)) : sm(p.hw + p.sf, p.hw - p.sf, Math.abs(q[0])) * sm(p.hh + p.sf, p.hh - p.sf, Math.abs(q[1]));
      if (m <= 0) continue;
      let k = 1 - (p.falloff || 0) * Math.min(1, (ux * ux + uy * uy) / 2);          // a softbox: hot in the middle
      const vt = (Math.min(1, Math.max(-1, uy)) + 1) / 2; if (p.vgrad) k *= p.vgrad[0] + (p.vgrad[1] - p.vgrad[0]) * vt;
      let col = p.c; if (p.tintTop || p.tintBot) { const a = p.tintBot || [1, 1, 1], b = p.tintTop || [1, 1, 1]; col = col.map((c, q2) => c * (a[q2] + (b[q2] - a[q2]) * vt)); }
      if (p.bars) { const B = p.bars, bw = B.w ?? 0.05, nx = B.nx ?? 0, ny = B.ny ?? 0; let dist = 9;
        for (let a = 1; a < nx; a++) dist = Math.min(dist, Math.abs(ux - (-1 + 2 * a / nx)));
        for (let a = 1; a < ny; a++) dist = Math.min(dist, Math.abs(uy - (-1 + 2 * a / ny)));
        k *= 1 - (B.dark ?? 0.9) * sm(bw * 1.4, bw * 0.6, dist); }
      const L = p.L * keyLux * m * k;
      for (let c = 0; c < 3; c++) o[c] += col[c] * L; }
    const q = (j * W + i) * 4; data[q] = o[0]; data[q + 1] = o[1]; data[q + 2] = o[2]; data[q + 3] = 1;
  }
  return { data, W, H };
}
// the environment of a stage record's env spec: roomEnv, or roomEnv7 when the spec says kind 'room7' (the '@7' stages)
export function envFor(spec, keyLux, opts) { return spec.kind === 'room7' ? roomEnv7(spec, keyLux, opts) : roomEnv(spec, keyLux, opts); }
