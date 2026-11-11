// STYLE c2 / S2 PAINT: the 2D side of the painted media. Each reads the person's own passes (the lit render through light/, and the
// paint AOVs from patch.js, all attached to the body) and lays paint, washes, paper or ink over them. Nothing here invents a stroke in
// screen space on the person: the strokes, washes, holes and hatches are the body's own (bind space); only the SUPPORT (canvas weave,
// paper tooth, the backlit screen) is fixed to the frame, as a real support is.
//
//   mural(ctx, P)        oil / WPA mural: one colour per stroke (the mean of the lit render over the stroke's pixels), a limited palette
//                        (value steps, warm lights, cool shadows relative to the person's own local value), bristle streaks and impasto
//                        from the stroke's own coordinates, a warm imprimatura where no stroke lands, the ground in screen dabs
//   watercolour(ctx, P)  a local-colour wash (deep skin lifted, never a blot), shadow glazes cut by a surface-attached wobble, edge
//                        darkening (pigment at the rim of a wash: Curtis et al. 1997), wet-in-wet bleeding inside a mass that stops at
//                        mass and garment edges, granulation attached to the body, paper in the lights (Bousseau et al. 2006)
//   shadowPlay(ctx, P)   cut paper (Lotte Reiniger): black card on a backlit screen, lace cut in the clothes and the hair (holes ride
//                        the cloth), a hairline at each joint where one piece overlaps the next, an eye cut in the profile
//   plate(ctx, P)        the anatomy plate: the designed pass (patch.js mode 4), muscle outlines, garments as ghosts, labels
// P: { W, H, lit: canvas | null, aov: { w, h, m1, m2, m3, m4 } (rows bottom-up), opts, heroes: [{ cx, cy, px, joints, eyes }] }
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const S2L = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; S2L[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const l2s = x => { x = clamp(x); return 255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055); };
// Oklab (Ottosson 2020)
function oklab(r, g, b, o) { const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  o[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s; o[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s; o[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s; return o; }
function unlab(L, a, b, o) { const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  o[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s; o[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s; o[2] = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s; return o; }
const hash1 = n => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return (n >>> 0) / 4294967296; };
const rng = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
// a screen-fixed value noise for the support (canvas weave, paper tooth)
function support(W, H, kind, seed = 7) {
  const T = new Float32Array(W * H), r = rng(seed), G = 64, grid = new Float32Array((G + 1) * (G + 1)); for (let i = 0; i < grid.length; i++) grid[i] = r();
  const vn = (x, y, f) => { const X = x * f, Y = y * f, xi = Math.floor(X) & (G - 1), yi = Math.floor(Y) & (G - 1), fx = X - Math.floor(X), fy = Y - Math.floor(Y), sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = grid[yi * (G + 1) + xi], b = grid[yi * (G + 1) + xi + 1], c = grid[(yi + 1) * (G + 1) + xi], d = grid[(yi + 1) * (G + 1) + xi + 1]; return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy; };
  const k = Math.max(1, H / 1080);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v;
    if (kind === 'canvas') { const wx = Math.sin(x / k * 2.2), wy = Math.sin(y / k * 2.2), q = ((Math.floor(x / k / 1.43) + Math.floor(y / k / 1.43)) & 1) ? wx : wy; v = 0.5 + 0.25 * q + 0.25 * (vn(x, y, 0.05 / k) - 0.5) * 2; }
    else v = 0.55 * vn(x, y, 0.35 / k) + 0.3 * vn(x, y, 0.09 / k) + 0.15 * vn(x, y, 0.017 / k);
    T[y * W + x] = v; }
  return T;
}
const _sup = {}; const supportOf = (W, H, kind) => _sup[kind + W + 'x' + H] ||= support(W, H, kind);
// separable box blur (radius r) of a Float32 field, optionally masked (weights)
function boxBlur(F, W, H, r, M = null) {
  r = Math.max(1, Math.round(r)); const T = new Float32Array(W * H), TW = M ? new Float32Array(W * H) : null, O = new Float32Array(W * H);
  for (let y = 0; y < H; y++) { let s = 0, sw = 0; const row = y * W;
    for (let x = -r; x <= r; x++) { const xx = clamp(x, 0, W - 1), w = M ? M[row + xx] : 1; s += F[row + xx] * w; sw += w; }
    for (let x = 0; x < W; x++) { T[row + x] = s; if (TW) TW[row + x] = sw; const xa = Math.min(W - 1, x + r + 1), xr = Math.max(0, x - r), wa = M ? M[row + xa] : 1, wr = M ? M[row + xr] : 1; s += F[row + xa] * wa - F[row + xr] * wr; sw += wa - wr; } }
  for (let x = 0; x < W; x++) { let s = 0, sw = 0;
    for (let y = -r; y <= r; y++) { const yy = clamp(y, 0, H - 1); s += T[yy * W + x]; sw += TW ? TW[yy * W + x] : 1; }
    for (let y = 0; y < H; y++) { O[y * W + x] = sw > 1e-6 ? s / sw : 0; const ya = Math.min(H - 1, y + r + 1), yr = Math.max(0, y - r); s += T[ya * W + x] - T[yr * W + x]; sw += TW ? TW[ya * W + x] - TW[yr * W + x] : 0; } }
  return O;
}
// AOV accessor (AOV at canvas size, rows bottom-up)
const flipIdx = (W, H) => { const J = new Int32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) J[y * W + x] = (H - 1 - y) * W + x; return J; };
const _flip = {}; const flipOf = (W, H) => _flip[W + 'x' + H] ||= flipIdx(W, H);

// ------------------------------------------------------------------------------------------------ the limited palette of a mural
// a stroke's local colour (albedo, linear) and its light v (lightOf: ~0 in the core shadow, 1 at the lit side's 90th percentile) -> the
// painter's colour: the value in a few soft steps (shadow, half-tone, light, highlight: Loomis), the local colour lifted from the floor
// (deep skin keeps its form, never a blot), warm in the lights and cool in the shadows, chroma lower in the shadow
export function muralColour(r, g, b, v, o, P = {}) {
  const V = P.values || [0.42, 0.72, 0.95, 1.08], T = P.thresholds || [0.32, 0.62, 1.0], sf = P.soft ?? 0.06, warm = P.warm ?? 0.035, lift = P.lift ?? 0.3;
  let f = V[0]; for (let i = 0; i < T.length; i++) f += (V[i + 1] - V[i]) * clamp((v - T[i] + sf) / (2 * sf));
  const lab = oklab(r, g, b, [0, 0, 0]); let [L, A, B] = lab; L = (lift + (1 - lift) * L) * f;
  const t = clamp((f - 0.78) * 2.4, -1, 1), ck = 0.82 + 0.28 * clamp((f - 0.4) / 0.6);
  A = A * ck + warm * 0.35 * t; B = B * ck + warm * t;
  unlab(Math.min(0.97, L), A, B, o); o[0] = l2s(o[0]); o[1] = l2s(o[1]); o[2] = l2s(o[2]); return o;
}

// ------------------------------------------------------------------------------------------------ shared: light, normalised
// s = lit luminance / (albedo luminance + 0.03) per pixel, normalised by the 90th percentile of its own GROUP (one person's skin, cloth,
// hair): the light a painter reads off a form, the same for a deep-skinned and a light-skinned face (a raw ratio inflates where the
// albedo is small: speculars on deep skin). cls: 0 skin (and eyes), 1 cloth, 2 hair. Hair takes the lit luminance (lane D's colour lives
// in its BSDF; its albedo is white).
function lightOf(P, LD, J, M2, M3) {
  const { W, H } = P, n = W * H, HS = P.heroes || [], grp = new Int16Array(n).fill(-1), S = new Float32Array(n), fig = new Uint8Array(n), cls = new Uint8Array(n);
  const R = Array.from({ length: Math.max(1, HS.length) * 3 }, () => []);
  for (let i = 0; i < n; i++) { const j = J[i] * 4, z = M2[j + 3], rg = M3[j + 3]; if (!(z > 0 && rg < 50)) continue; fig[i] = 1;
    const c = rg < 20 || Math.round(rg) === 24 ? 0 : Math.round(rg) === 23 ? 2 : 1, x = i % W; let hb = 0, bd = 1e9; HS.forEach((h, q) => { const d = Math.abs(x - h.cx); if (d < bd) { bd = d; hb = q; } });
    cls[i] = c; grp[i] = hb * 3 + c; const Yl = 0.2126 * S2L[LD[i * 4]] + 0.7152 * S2L[LD[i * 4 + 1]] + 0.0722 * S2L[LD[i * 4 + 2]], Ya = 0.2126 * M2[j] + 0.7152 * M2[j + 1] + 0.0722 * M2[j + 2];
    S[i] = c === 2 ? Yl : Yl / (Ya + 0.03); if ((i & 3) === 0) R[grp[i]].push(S[i]); }
  // P.hold (an object kept by the caller through a shot): the normalisation is taken on the first frame and held, as an exposure is
  // metered once per shot (re-normalising every frame pumps every stroke of a person together as the walk changes the distribution)
  let Eg = P.hold && P.hold.Eg && P.hold.Eg.length === R.length ? P.hold.Eg : R.map(a => { if (a.length < 20) return 0; a.sort((p, q) => p - q); return a[Math.floor(a.length * 0.9)]; });
  if (P.hold && !P.hold.Eg) P.hold.Eg = Eg;
  const all = Eg.filter(Boolean), E0 = all.length ? all.reduce((p, q) => p + q, 0) / all.length : 1;
  for (let i = 0; i < n; i++) if (fig[i]) S[i] /= (Eg[grp[i]] || E0);
  return { S, fig, grp, cls, E0 };
}
// small enclosed background holes inside a figure (the gap where the thighs meet, a sliver between wrist and hip) read as dark dots once
// the contour rings them: filled with the figure colour around them, the ring of ink with them
export function fillHoles(ctx, fig, W, H, { maxArea = 300, ring = 3 } = {}) {
  const n = W * H, seen = new Uint8Array(n), st = []; let filled = 0;
  for (let x = 0; x < W; x++) { for (const y of [0, H - 1]) { const i = y * W + x; if (!fig[i] && !seen[i]) { seen[i] = 1; st.push(i); } } }
  for (let y = 0; y < H; y++) { for (const x of [0, W - 1]) { const i = y * W + x; if (!fig[i] && !seen[i]) { seen[i] = 1; st.push(i); } } }
  while (st.length) { const i = st.pop(), x = i % W; for (const q of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (q >= 0 && q < n && !fig[q] && !seen[q]) { seen[q] = 1; st.push(q); } }
  const img = ctx.getImageData(0, 0, W, H), D = img.data;
  for (let i0 = 0; i0 < n; i0++) { if (fig[i0] || seen[i0]) continue;
    const comp = [i0]; seen[i0] = 2; for (let k = 0; k < comp.length; k++) { const i = comp[k], x = i % W; for (const q of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (q >= 0 && q < n && !fig[q] && !seen[q]) { seen[q] = 2; comp.push(q); } }
    if (comp.length > maxArea) continue;
    // the region: the hole and a ring of r px around it (the contour's ink); filled from the outside in, each pixel the mean of its
    // already-known neighbours (an onion peel: the surrounding paint grows over the hole, no flat patch)
    const reg = new Set(); for (const i of comp) { const x = i % W, y = (i / W) | 0; for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && dx * dx + dy * dy <= ring * ring + 1) reg.add(yy * W + xx); } }
    let todo = [...reg], guard = 0; const known = q => !reg.has(q) || done.has(q), done = new Set();
    while (todo.length && guard++ < 4 * ring + 64) { const next = [], upd = [];
      for (const i of todo) { const x = i % W; let r = 0, g = 0, b = 0, c = 0; for (const q of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (q >= 0 && q < n && known(q) && (fig[q] || done.has(q))) { r += D[q * 4]; g += D[q * 4 + 1]; b += D[q * 4 + 2]; c++; }
        if (c) upd.push([i, r / c, g / c, b / c]); else next.push(i); }
      if (!upd.length) break; for (const [i, r, g, b] of upd) { D[i * 4] = r; D[i * 4 + 1] = g; D[i * 4 + 2] = b; done.add(i); } todo = next; }
    filled++; }
  ctx.putImageData(img, 0, 0); return filled;
}

// ------------------------------------------------------------------------------------------------ MURAL
export function mural(ctx, P) {
  const { W, H, lit, aov } = P, O = P.opts || {}, g = ctx, J = flipOf(W, H), M1 = aov.m1, M2 = aov.m2, M3 = aov.m3, k = Math.max(1, H / 1080);
  const LD = lit.getContext('2d').getImageData(0, 0, W, H).data;
  // the figure mask and the light a painter reads (normalised per person and class)
  const Lt = lightOf(P, LD, J, M2, M3), fig = Lt.fig, Sv = Lt.S;
  // 1. strokes: accumulate the local colour (albedo; hair and eyes: the lit colour) and the light per stroke id (open addressing)
  const CAP = 1 << 19, scl = new Uint8Array(CAP), keys = new Uint32Array(CAP), sr = new Float32Array(CAP), sg = new Float32Array(CAP), sb = new Float32Array(CAP), sl = new Float32Array(CAP), cn = new Uint32Array(CAP);
  const slot = new Int32Array(W * H).fill(-1); let used = 0;
  for (let i = 0; i < W * H; i++) { if (!fig[i]) continue; const j = J[i] * 4, id = M1[j]; if (id < 0.5) continue;
    const key = ((id | 0) * 8 + (M1[j + 3] | 0)) >>> 0 || 1; let h = Math.imul(key, 2654435761) >>> 13 & (CAP - 1);
    while (keys[h] && keys[h] !== key) h = (h + 1) & (CAP - 1);
    if (!keys[h]) { if (used > CAP * 0.7) continue; keys[h] = key; used++; }
    const lc = Lt.cls[i] === 2 || Math.round(M3[j + 3]) === 24, q = J[i] * 4; scl[h] = Lt.cls[i];
    if (lc) { sr[h] += S2L[LD[i * 4]]; sg[h] += S2L[LD[i * 4 + 1]]; sb[h] += S2L[LD[i * 4 + 2]]; sl[h] = -1e9; }
    else { sr[h] += M2[q]; sg[h] += M2[q + 1]; sb[h] += M2[q + 2]; sl[h] += Sv[i]; }
    cn[h]++; slot[i] = h; }
  const col = new Uint8ClampedArray(CAP * 3), o3 = [0, 0, 0], clothPal = { ...(O.palette || {}), values: [0.52, 0.72, 0.88, 0.92] };
  for (let h = 0; h < CAP; h++) if (cn[h]) { const n = cn[h];
    if (sl[h] < -1e8) { const lab = oklab(sr[h] / n, sg[h] / n, sb[h] / n, [0, 0, 0]); unlab(0.12 + 0.88 * lab[0], lab[1], lab[2], o3); o3[0] = l2s(o3[0]); o3[1] = l2s(o3[1]); o3[2] = l2s(o3[2]); }
    else muralColour(sr[h] / n, sg[h] / n, sb[h] / n, sl[h] / n, o3, scl[h] === 1 ? clothPal : O.palette);
    col[h * 3] = o3[0]; col[h * 3 + 1] = o3[1]; col[h * 3 + 2] = o3[2]; }
  // 2. the ground and the wall: a painted ground under everything (blurred lit, mapped), then screen dabs (static camera: stable)
  const sm = document.createElement('canvas'); sm.width = Math.max(8, Math.round(W / 10)); sm.height = Math.max(8, Math.round(H / 10)); const sg2 = sm.getContext('2d'); sg2.drawImage(lit, 0, 0, sm.width, sm.height);
  const SD = sg2.getImageData(0, 0, sm.width, sm.height).data, r = rng(O.seed ?? 11), step = Math.max(5, Math.round((O.groundPx ?? 16) * k));
  // the designed ground: an earth duotone (the wall in ochre plaster, the floor in umber to sienna), the floor's own light and cast
  // shadows kept as its value between its darkest and lightest tenth (a mural's ground is designed, not the sky the rig lit)
  const [wA, wB, gA, gB] = (O.ground || ['#a8844f', '#e6cf9c', '#4a3021', '#a77c52']).map(hex), gl = [];
  for (let i = 0; i < W * H; i += 11) if (M1[J[i] * 4 + 3] > 50) gl.push((0.2126 * LD[i * 4] + 0.7152 * LD[i * 4 + 1] + 0.0722 * LD[i * 4 + 2]) / 255);
  gl.sort((a, b) => a - b); const gmin = gl.length ? gl[Math.floor(gl.length * 0.05)] : 0, gmax = gl.length ? gl[Math.floor(gl.length * 0.9)] : 1, gmed = gl.length ? gl[gl.length >> 1] : 0.5;
  // the horizon (the median over columns of the first ground pixel): what lies behind a figure is wall above it, floor below
  const hz = []; for (let x = 0; x < W; x += 7) for (let y = 0; y < H; y++) if (M1[J[y * W + x] * 4 + 3] > 50) { hz.push(y); break; } hz.sort((a, b) => a - b); const horizon = hz.length ? hz[hz.length >> 1] : H * 0.6;
  g.fillStyle = `rgb(${wA.join(',')})`; g.fillRect(0, 0, W, H);
  g.save();
  for (let y = -step; y < H + step; y += step * 0.55) for (let x = -step; x < W + step; x += step * 0.7) {
    const px = x + (r() - 0.5) * step, py = y + (r() - 0.5) * step, ix = clamp(Math.round(px), 0, W - 1), iy = clamp(Math.round(py), 0, H - 1);
    const onFig = fig[iy * W + ix], sx = clamp(Math.floor(ix / W * sm.width), 0, sm.width - 1), sy = clamp(Math.floor(iy / H * sm.height), 0, sm.height - 1), q = (sy * sm.width + sx) * 4;
    const gr = onFig ? iy > horizon : M1[J[iy * W + ix] * 4 + 3] > 50, yl = onFig ? (gr ? gmed : 0.75) : (0.2126 * SD[q] + 0.7152 * SD[q + 1] + 0.0722 * SD[q + 2]) / 255, [c0, c1] = gr ? [gA, gB] : [wA, wB], u = clamp(gr ? (yl - gmin) / Math.max(0.05, gmax - gmin) : 0.35 + 0.65 * yl);
    const j = 0.94 + 0.12 * r(); g.fillStyle = `rgb(${(c0[0] + (c1[0] - c0[0]) * u) * j | 0},${(c0[1] + (c1[1] - c0[1]) * u) * j | 0},${(c0[2] + (c1[2] - c0[2]) * u) * j | 0})`;
    g.beginPath(); g.ellipse(px, py, step * (0.9 + 0.7 * r()), step * (0.22 + 0.12 * r()), (r() - 0.5) * 0.5, 0, Math.PI * 2); g.fill(); }
  g.restore();
  // 3. the figure: per pixel, its stroke's colour x bristles x impasto; the imprimatura (warm) where no stroke landed
  const img = g.getImageData(0, 0, W, H), D = img.data, sup = supportOf(W, H, 'canvas'), imp = hex(O.imprimatura || '#9a5a34');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let R, G, B;
    if (fig[i]) { const h = slot[i], j = J[i] * 4;
      if (h >= 0) { const a = M1[j + 1], w = M1[j + 2], id = M1[j] | 0;
        const br = 1 + (O.bristle ?? 0.03) * 2 * (hash1((id * 31 + Math.floor((w + 1) * 7)) | 0) - 0.5), drag = clamp((a - 0.7) / 0.3) * (0.4 + 0.6 * hash1(id * 7 + Math.floor((w + 1) * 5))) * (O.drag ?? 0.15);
        // impasto: the ridge of a loaded brush, shaded in the STROKE's own frame (one flank lighter, the other darker, the loaded start
        // fuller), so it rides the body; a screen-lit ridge turned light and dark as a limb swung (the first motion check)
        const im = O.impasto ?? 0.04, sh = 1 + im * clamp(-w * 0.9 + 0.35 * (1 - clamp((a + 1) / 2)) - 0.15, -1, 1);
        const f = br * sh; R = col[h * 3] * f; G = col[h * 3 + 1] * f; B = col[h * 3 + 2] * f;
        R += (imp[0] * 0.8 + LD[i * 4] * 0.2 - R) * drag; G += (imp[1] * 0.8 + LD[i * 4 + 1] * 0.2 - G) * drag; B += (imp[2] * 0.8 + LD[i * 4 + 2] * 0.2 - B) * drag; }
      else { const q = J[i] * 4, lc = Lt.cls[i] === 2 || Math.round(M3[q + 3]) === 24;
        if (lc) { o3[0] = LD[i * 4]; o3[1] = LD[i * 4 + 1]; o3[2] = LD[i * 4 + 2]; } else muralColour(M2[q], M2[q + 1], M2[q + 2], Sv[i], o3, O.palette);
        const t = 0.25; R = o3[0] * (1 - t) + imp[0] * t; G = o3[1] * (1 - t) + imp[1] * t; B = o3[2] * (1 - t) + imp[2] * t; }
    } else { R = D[i * 4]; G = D[i * 4 + 1]; B = D[i * 4 + 2]; }
    const s = 0.955 + 0.09 * sup[i]; D[i * 4] = R * s; D[i * 4 + 1] = G * s; D[i * 4 + 2] = B * s; D[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  return { strokes: used, fig };
}

// LOST AND FOUND (after the lines): where the figure and the ground behind meet in value, the edge is lost (a soft band, ink line
// included); where they differ, or near the person's landmarks, it stays found. Value contrast read across the edge from a masked
// blur on each side.
export function lostEdges(ctx, fig, W, H, { r = 4, contrast = 38, k = 1 } = {}) {
  const n = W * H, img = ctx.getImageData(0, 0, W, H), D = img.data, Y = new Float32Array(n), F = new Float32Array(n), G = new Float32Array(n);
  for (let i = 0; i < n; i++) { Y[i] = 0.2126 * D[i * 4] + 0.7152 * D[i * 4 + 1] + 0.0722 * D[i * 4 + 2]; F[i] = fig[i] ? 1 : 0; G[i] = 1 - F[i]; }
  const R = Math.max(2, Math.round(r * k)), band = boxBlur(F, W, H, R), yf = boxBlur(Y, W, H, R * 2, F), yg = boxBlur(Y, W, H, R * 2, G);
  const ch = [0, 1, 2].map(c => { const A = new Float32Array(n); for (let i = 0; i < n; i++) A[i] = D[i * 4 + c]; return boxBlur(A, W, H, R); });
  let lost = 0;
  for (let i = 0; i < n; i++) { const b = band[i]; if (b < 0.04 || b > 0.96) continue; const w = clamp(1 - Math.abs(yf[i] - yg[i]) / contrast) * clamp(Math.min(b, 1 - b) * 6);
    if (w <= 0.02) continue; lost++; for (let c = 0; c < 3; c++) D[i * 4 + c] += (ch[c][i] - D[i * 4 + c]) * w; }
  ctx.putImageData(img, 0, 0); return lost;
}

// ------------------------------------------------------------------------------------------------ WATERCOLOUR
export function watercolour(ctx, P) {
  const { W, H, lit, aov } = P, O = P.opts || {}, J = flipOf(W, H), M2 = aov.m2, M3 = aov.m3, k = Math.max(1, H / 1080), n = W * H;
  const LD = lit.getContext('2d').getImageData(0, 0, W, H).data;
  const paper = hex(O.paper || '#f3ede0'), G1 = (O.glaze1 || [0.8, 0.79, 0.9]), G2 = (O.glaze2 || [0.68, 0.63, 0.78]);
  const fig = new Uint8Array(n), reg = new Float32Array(n), dep = new Float32Array(n), lab = [0, 0, 0], o3 = [0, 0, 0];
  // the wash colour per pixel (albedo, display, lifted), the shading s = lit / albedo (normalised by the figures' own p90)
  const Lt = lightOf(P, LD, J, M2, M3), S = Lt.S, grp = Lt.grp, E = Lt.E0, Eof = () => 1;
  const wr = new Float32Array(n), wg = new Float32Array(n), wb = new Float32Array(n);
  for (let i = 0; i < n; i++) { const j = J[i] * 4; dep[i] = M2[j + 3]; reg[i] = M3[j + 3]; fig[i] = Lt.fig[i]; if (!fig[i]) continue;
    if (Lt.cls[i] === 2) { wr[i] = clamp(S2L[LD[i * 4]] * 2.2); wg[i] = clamp(S2L[LD[i * 4 + 1]] * 2.2); wb[i] = clamp(S2L[LD[i * 4 + 2]] * 2.2); continue; }   // hair: its colour lives in lane D's BSDF
    oklab(M2[j], M2[j + 1], M2[j + 2], lab); const L = (O.liftWash ?? 0.34) + (1 - (O.liftWash ?? 0.34)) * lab[0]; unlab(L, lab[1] * 1.08, lab[2] * 1.08, o3);
    wr[i] = clamp(o3[0]); wg[i] = clamp(o3[1]); wb[i] = clamp(o3[2]); }
  // wet-in-wet: the wash bleeds inside its own mass (masked blur per region: a pixel takes only same-region neighbours, row then column)
  const rB = Math.max(2, Math.round((O.bleed ?? 5) * k));
  const bleed = F => { const T = new Float32Array(n), O2 = new Float32Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!fig[i]) continue; let s = 0, c = 0; for (let d = -rB; d <= rB; d++) { const xx = x + d; if (xx < 0 || xx >= W) continue; const q = y * W + xx; if (fig[q] && reg[q] === reg[i] && Math.abs(dep[q] - dep[i]) < 0.08 * dep[i]) { s += F[q]; c++; } } T[i] = s / c; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!fig[i]) continue; let s = 0, c = 0; for (let d = -rB; d <= rB; d++) { const yy = y + d; if (yy < 0 || yy >= H) continue; const q = yy * W + x; if (fig[q] && reg[q] === reg[i] && Math.abs(dep[q] - dep[i]) < 0.08 * dep[i]) { s += T[q]; c++; } } O2[i] = s / c; }
    return O2; };
  const br = bleed(wr), bg = bleed(wg), bb = bleed(wb), Sb = bleed(S);
  // the glazes: thresholds on the (bled) shading, wobbled by the body's own low noise; dry edges hard, wet zones soft
  const g1 = new Float32Array(n), g2 = new Float32Array(n), gl = new Float32Array(n), fm = new Float32Array(n);
  const t1 = O.t1 ?? 0.6, t2 = O.t2 ?? 0.3, t3 = O.t3 ?? 1.2;
  for (let i = 0; i < n; i++) { if (!fig[i]) continue; fm[i] = 1; const j = J[i] * 4, n1 = M3[j], wet = clamp((n1 - 0.5) / 0.15), s = Sb[i] / Eof(i) + (O.wobble ?? 0.2) * (n1 - 0.5), e = 0.025 + 0.12 * wet;
    g1[i] = 1 - clamp((s - t1 + e) / (2 * e)); g2[i] = 1 - clamp((s - t2 + e) / (2 * e)); gl[i] = grp[i] % 3 === 2 ? 0 : 0.6 * clamp((s - t3) / 0.15); }
  // edge darkening: pigment pools at the rim of each wash (the wash minus its blur, positive part)
  const rE = 2.5 * k, e1 = boxBlur(g1, W, H, rE), e2 = boxBlur(g2, W, H, rE), ef = boxBlur(fm, W, H, rE);
  const img = ctx.getImageData(0, 0, W, H), D = img.data, sup = supportOf(W, H, 'paper'), gran = O.granulation ?? 0.35;
  const sky = hex(O.sky || '#c9d6dc'), gnd = hex(O.ground || '#b9ab92');
  // the ground: its own value relative to its median (cast shadows), on paper
  const gv = []; for (let i = 0; i < n; i += 13) { const j = J[i] * 4; if (M2[j + 3] > 0 && reg[i] >= 100) gv.push(LD[i * 4 + 1]); } gv.sort((a, b) => a - b); const gmed = gv.length ? gv[gv.length >> 1] : 128;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, j = J[i] * 4; let R = paper[0], G = paper[1], B = paper[2];
    const tooth = sup[i];
    if (fig[i]) { const n2 = M3[j + 1], ed1 = Math.max(0, g1[i] - e1[i]) * 2.2, ed2 = Math.max(0, g2[i] - e2[i]) * 2.2, edf = Math.max(0, fm[i] - ef[i]) * 1.6, gr = 1 + gran * (n2 - 0.5) * 2 + 0.25 * (tooth - 0.5);
      const la = 0.2126 * br[i] + 0.7152 * bg[i] + 0.0722 * bb[i], pk = clamp((la - 0.18) / 0.25), glp = gl[i] * pk;   // paper only in light local colour
      const dw = clamp((O.density ?? 0.88) * (1 + edf) * (1 - 0.8 * glp) * (1 + 0.15 * (n2 - 0.5)), 0, 1.15);
      let r = 1 + (br[i] - 1) * dw, gg = 1 + (bg[i] - 1) * dw, b = 1 + (bb[i] - 1) * dw;
      const d1 = clamp(g1[i] * (1 + ed1) * gr, 0, 1.4), d2 = clamp(g2[i] * (1 + ed2) * gr, 0, 1.4);
      r *= 1 + (G1[0] - 1) * d1; gg *= 1 + (G1[1] - 1) * d1; b *= 1 + (G1[2] - 1) * d1; r *= 1 + (G2[0] - 1) * d2; gg *= 1 + (G2[1] - 1) * d2; b *= 1 + (G2[2] - 1) * d2;
      const hc = gl[i] * (1 - pk) * 0.45; r += (0.62 - r) * hc; gg += (0.66 - gg) * hc; b += (0.74 - b) * hc;   // deep skin's sheen: a cool light glaze
      R = l2s(S2L[paper[0]] * r); G = l2s(S2L[paper[1]] * gg); B = l2s(S2L[paper[2]] * b); }
    else if (dep[i] > 0 && reg[i] >= 100) { const v = LD[i * 4 + 1] / Math.max(1, gmed), sh = clamp((0.82 - v) / 0.2), wob = 0.25 * (M3[j] - 0.5);
      const a = clamp(0.32 + wob), t = (c, p) => p + (c - p) * a; R = t(gnd[0], R); G = t(gnd[1], G); B = t(gnd[2], B);
      const d = clamp(sh + wob) * 0.7; R *= 1 + (G1[0] - 1) * d * 1.3; G *= 1 + (G1[1] - 1) * d * 1.3; B *= 1 + (G1[2] - 1) * d * 1.3; }
    else { const a = 0.22 * clamp(1 - y / (H * 0.7)); R += (sky[0] - R) * a; G += (sky[1] - G) * a; B += (sky[2] - B) * a; }
    const s = 0.965 + 0.07 * tooth; D[i * 4] = R * s; D[i * 4 + 1] = G * s; D[i * 4 + 2] = B * s; D[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return { E: +E.toFixed(3), fig };
}

// chamfer distance to the outside of a mask (px)
function inside(mask, W, H) { const Dm = new Float32Array(W * H), INF = 1e9;
  for (let i = 0; i < W * H; i++) Dm[i] = mask[i] ? INF : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!Dm[i]) continue; let d = Dm[i]; if (x > 0) d = Math.min(d, Dm[i - 1] + 1); if (y > 0) d = Math.min(d, Dm[i - W] + 1); if (x > 0 && y > 0) d = Math.min(d, Dm[i - W - 1] + 1.414); if (x < W - 1 && y > 0) d = Math.min(d, Dm[i - W + 1] + 1.414); Dm[i] = d; }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; if (!Dm[i]) continue; let d = Dm[i]; if (x < W - 1) d = Math.min(d, Dm[i + 1] + 1); if (y < H - 1) d = Math.min(d, Dm[i + W] + 1); if (x < W - 1 && y < H - 1) d = Math.min(d, Dm[i + W + 1] + 1.414); if (x > 0 && y < H - 1) d = Math.min(d, Dm[i + W - 1] + 1.414); Dm[i] = d; }
  return Dm; }

// ------------------------------------------------------------------------------------------------ SHADOW PLAY (cut paper)
export function shadowPlay(ctx, P) {
  const { W, H, aov } = P, O = P.opts || {}, J = flipOf(W, H), M1 = aov.m1, n = W * H, k = Math.max(1, H / 1080);
  const mask = new Uint8Array(n); for (let i = 0; i < n; i++) { const c = M1[J[i] * 4 + 3]; mask[i] = c > 0.5 && c < 50 ? 1 : 0; }
  const Dm = inside(mask, W, H), sup = supportOf(W, H, 'paper');
  const c0 = hex(O.glow || '#f7e6b8'), c1 = hex(O.edge || '#b0602a'), ink = hex(O.ink || '#0f0b09');
  const cx = W * 0.5, cy = H * (O.glowY ?? 0.42), rr = Math.hypot(W, H) * 0.55, lace = O.lace !== false && (P.strokePx ?? 6) >= 9, edgeMin = Math.max(2.5, (P.strokePx ?? 6) * 0.25);
  const img = ctx.getImageData(0, 0, W, H), D = img.data; let holes = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x;
    const t = clamp(Math.hypot(x - cx, (y - cy) * 1.15) / rr) ** 1.6, s = 0.94 + 0.12 * sup[i];
    let R = (c0[0] + (c1[0] - c0[0]) * t) * s, G = (c0[1] + (c1[1] - c0[1]) * t) * s, B = (c0[2] + (c1[2] - c0[2]) * t) * s;
    if (mask[i]) { let hole = false; const j = J[i] * 4, cls = Math.round(M1[j + 3]), id = M1[j] | 0;
      if (lace && id > 0 && Dm[i] > edgeMin) { const a = M1[j + 1], w = M1[j + 2], hh = hash1(id);
        const r2 = a * a + (0.36 * w) ** 2;                                                            // in lattice units: round
        if (cls === 2 && hh < 0.2) hole = hh < 0.06 ? Math.abs(w) < 0.2 && Math.abs(a) < 0.6 : r2 < (hh < 0.12 ? 0.04 : 0.018);   // sparse eyelets (two sizes) and slits in the cloth
        else if (cls === 3 && hh < 0.6) hole = Math.abs(w) < 0.16 && Math.abs(a) < 0.7;                                                // the hair's filigree
      }
      if (hole) holes++;
      else { const e = clamp((1.2 - Dm[i]) / 1.2) * 0.35; R = ink[0] + (R - ink[0]) * e; G = ink[1] + (G - ink[1]) * e; B = ink[2] + (B - ink[2]) * e; } }
    D[i * 4] = R; D[i * 4 + 1] = G; D[i * 4 + 2] = B; D[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0); fillHoles(ctx, mask, W, H, { maxArea: Math.round(0.00012 * W * H), ring: 1 });
  // the joints: a hairline where one card piece overlaps the next (an arc about the joint centre, inside the card), and the eye
  ctx.save(); ctx.lineCap = 'round';
  for (const hh of P.heroes || []) {
    for (const jn of hh.joints || []) { const r0 = jn.r; if (r0 < 4) continue; ctx.strokeStyle = `rgba(${c0[0]},${c0[1]},${c0[2]},0.5)`; ctx.lineWidth = Math.max(0.6, 0.7 * k);
      ctx.beginPath(); ctx.arc(jn.x, jn.y, r0, jn.ang - 1.25, jn.ang + 1.25); ctx.stroke(); }
    if (hh.eye && hh.eye.px > 2.5) { const e = hh.eye; ctx.fillStyle = `rgb(${c0[0]},${c0[1]},${c0[2]})`; ctx.beginPath(); ctx.ellipse(e.x, e.y, e.px * 0.55, e.px * 0.22, e.ang || 0, 0, Math.PI * 2); ctx.fill(); }
  }
  // the ground: a black hill under the feet, a cut edge of grass
  const gy = Math.max(...(P.heroes || []).map(h => h.footY || H * 0.95), H * 0.6), r = rng(5);
  ctx.fillStyle = `rgb(${ink.join(',')})`; ctx.beginPath(); ctx.moveTo(0, H); let y0 = gy + 2 * k;
  for (let x = 0; x <= W; x += 3 * k) { const yy = y0 + Math.sin(x / (W * 0.21)) * 6 * k - (r() < 0.18 ? (3 + 9 * r()) * k : 0); ctx.lineTo(x, yy); } ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  ctx.restore();
  return { holes };
}

// ------------------------------------------------------------------------------------------------ THE ANATOMY PLATE
export function plate(ctx, P) {
  const { W, H, aov } = P, O = P.opts || {}, J = flipOf(W, H), M4 = aov.m4, M3 = aov.m3, Mg = aov.mg, n = W * H, k = Math.max(1, H / 1080);
  const paper = hex('#efe6d2'), sepia = [62, 38, 26], sup = supportOf(W, H, 'paper');
  const img = ctx.getImageData(0, 0, W, H), D = img.data, mid = new Int16Array(n).fill(-1), on = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const j = J[i] * 4, m = M3[j + 2]; on[i] = M4[j + 3] > 0 ? 1 : 0; if (on[i] && m >= 1 && (m % 1) * 2 > 0.28) mid[i] = Math.floor(m); }
  // the dominant belly is a flat per-triangle id (it steps along triangle edges): two passes of a 5 x 5 majority smooth the outlines
  const rM = Math.max(2, Math.round(2 * k));
  for (let pass = 0; pass < 2; pass++) { const T = mid.slice(), cnt = new Map();
    for (let y = rM; y < H - rM; y++) for (let x = rM; x < W - rM; x++) { const i = y * W + x; if (mid[i] < 0) continue; cnt.clear(); let best = mid[i], bc = 0;
      for (let dy = -rM; dy <= rM; dy += 1) for (let dx = -rM; dx <= rM; dx += 1) { const q = mid[i + dy * W + dx]; if (q < 0) continue; const c = (cnt.get(q) || 0) + 1; cnt.set(q, c); if (c > bc) { bc = c; best = q; } }
      T[i] = best; } mid.set(T); }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, j = J[i] * 4, s = 0.96 + 0.06 * sup[i]; let R = paper[0], G = paper[1], B = paper[2];
    if (on[i]) { R = M4[j] * 255; G = M4[j + 1] * 255; B = M4[j + 2] * 255;
      // muscle outlines (the dominant belly changes) and the contour
      const e = x > 0 && x < W - 1 && y > 0 && y < H - 1 ? (mid[i] !== mid[i + 1] && mid[i] >= 0 && mid[i + 1] >= 0) || (mid[i] !== mid[i + W] && mid[i] >= 0 && mid[i + W] >= 0) : false;
      const c = x > 0 && x < W - 1 && y > 0 && y < H - 1 && (!on[i - 1] || !on[i + 1] || !on[i - W] || !on[i + W]);
      if (e || c) { const a = c ? 0.95 : 0.7; R += (sepia[0] - R) * a; G += (sepia[1] - G) * a; B += (sepia[2] - B) * a; } }
    if (Mg) { const gj = J[i] * 4, gc = Math.round(Mg[gj + 3]); if (gc === 2 || gc === 3) { const ge = x > 0 && y > 0 && x < W - 1 && y < H - 1 && [i - 1, i + 1, i - W, i + W].some(q => Math.round(Mg[J[q] * 4 + 3]) !== gc);
        const a = ge ? 0.75 : 0.1; R += (70 - R) * a; G += (92 - G) * a; B += (120 - B) * a; } }
    D[i * 4] = R * s; D[i * 4 + 1] = G * s; D[i * 4 + 2] = B * s; D[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0); fillHoles(ctx, on, W, H, { maxArea: Math.round(0.00012 * W * H), ring: Math.max(2, Math.round(2 * k)) });
  // labels: muscle centroids per figure, leader lines to the nearer margin of that figure's cell
  const rep = { labels: 0 };
  if (O.labels !== false && P.heroes && P.heroes.length) {
    const want = O.labels === 'first' ? [P.heroes[0]] : P.heroes, acc = new Map();
    for (let i = 0; i < n; i += 2) { const m = mid[i]; if (m < 1) continue; const x = i % W, y = (i / W) | 0; let hb = -1, bd = 1e9; want.forEach((h, q) => { const d = Math.abs(x - h.cx); if (d < bd && d < h.half) { bd = d; hb = q; } }); if (hb < 0) continue;
      const key = (hb * 64 + m) * 2 + (x < want[hb].cx ? 0 : 1), a = acc.get(key) || [0, 0, 0]; a[0] += x; a[1] += y; a[2]++; acc.set(key, a); }
    const fs = Math.max(10, Math.round((O.labelPx ?? 13) * k)), names = O.names || {};
    ctx.save(); ctx.font = `italic ${fs}px Georgia, 'Times New Roman', serif`; ctx.fillStyle = `rgb(${sepia.join(',')})`; ctx.strokeStyle = `rgba(${sepia.join(',')},0.8)`; ctx.lineWidth = Math.max(0.6, 0.7 * k);
    want.forEach((h, q) => { const L = [], Rr = [], outer = want.length > 1 ? (q < want.length / 2 ? 0 : 1) : -1;
      for (let m = 1; m < 64; m++) { const nm = names[m]; if (!nm) continue; const a0 = acc.get((q * 64 + m) * 2), a1 = acc.get((q * 64 + m) * 2 + 1);
        let sd = outer >= 0 ? outer : (a0 && a1 ? (a0[2] >= a1[2] ? 0 : 1) : a0 ? 0 : 1); const a = sd ? a1 : a0;
        if (!a || a[2] < (O.minPx ?? 60) * k * k / 4) continue; (sd ? Rr : L).push({ x: a[0] / a[2], y: a[1] / a[2], nm }); }
      for (const [side, list] of [[-1, L], [1, Rr]]) { list.sort((a, b) => a.y - b.y); let last = -1e9; const xm = h.cx + side * h.half * 0.96;
        for (const it of list) { const ly = Math.max(it.y, last + fs * 1.15); last = ly; ctx.beginPath(); ctx.moveTo(it.x, it.y); ctx.lineTo(xm - side * fs * 0.3, ly); ctx.stroke();
          ctx.beginPath(); ctx.arc(it.x, it.y, 1.4 * k, 0, Math.PI * 2); ctx.fill(); ctx.textAlign = side < 0 ? 'right' : 'left';
          const tw = ctx.measureText(it.nm).width, xt = side < 0 ? Math.max(xm, tw + 6) : Math.min(xm, W - tw - 6); ctx.fillText(it.nm, xt, ly + fs * 0.35); rep.labels++; } } });
    ctx.restore(); }
  return rep;
}
