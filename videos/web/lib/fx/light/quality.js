// LIGHT / quality (RENDER6, 4 Oct): image-quality tiers for LitRenderer, every one opt-in by name.
//
//   new LitRenderer({ canvas, width, height, quality: 'film' })     // stills (the farm): supersampled, filtered, specular AA
//   new LitRenderer({ canvas, width, height, quality: 'motion' })   // clips: the same at half the sub-frames, a softer filter
//   new LitRenderer({ canvas, width, height, quality: 'preview' })  // the cheap tier: one sub-frame, MSAA 4, specular AA
// 'draft', 'clip' and 'final' are untouched: every scene that names them renders exactly as before.
//
// What a tier adds over the old accumulation (K jittered sub-frames on a 1-px BOX, Halton 2,3 shared with the sun's jitter):
//   ss       internal supersampling: every buffer at ss x the canvas, resolved once per frame by the pixel filter below (so
//            textures are sampled at ss x the rate (a -log2(ss) mip bias in effect), thin geometry (lashes, laces, seams) is
//            covered by ss^2 x more samples, and HAIR's stochastic alpha (a threshold per pixel per sub-frame) gets ss^2 x K
//            coverage levels instead of K). Dropped to 1 (and K doubled) when the internal frame would pass ssBudget pixels.
//   filter   the pixel filter, Blackman-Harris of this width in canvas pixels (Cycles' own filter; Cycles' default width is
//            1.5, film's; motion's 2.5 is softer and steadier): with ss 1 it is importance-sampled into the sub-frame jitter (equal weights), with ss > 1 it is the resolve
//            kernel and the jitter is uniform inside an internal pixel. Smooth, no box side lobes: edges do not step or crawl.
//   Kfloor   the tier's K is a floor: a stage's renderOpts.K (studio@5 16, yard@5 4) cannot lower it (it can raise it).
//   jitter   R2 (Roberts 2018) for the pixel, decorrelated from the Halton 2,3 that the rig uses for the sun disc and lamps.
//   specAA   specular anti-aliasing in every lit material (light/patch.js, uniform-gated): GGX alpha^2 widened by the screen-space
//            variance of the final shading normal (Tokuyoshi and Kaplanyan 2019; pores, weave, silhouettes; the kernel is one
//            SAMPLE's footprint: the pixel's / K, as the K jittered sub-frames already integrate the rest) and by the
//            Toksvig / vMF variance of a mipmapped normal map (Han et al. 2007; Neubelt and Pettineo 2013). Hair is excluded
//            (its own lobes; HAIR's lane).
//   aniso    (option, OFF in every tier since 05:30) anisotropic filtering raised on every mipmapped texture the scene samples
//            (standard slots and the textures in patched shader uniforms). Measured on the chart's pan: it keeps texture at grazing
//            angles but leaves a beat on near-Nyquist stripes and weaves that crawls on a camera move (card 0.86 -> 1.12, far twill
//            1.06 -> 2.38; off: 0.86 / 1.45, thin lines unchanged); textures keep what their owners set (the stage's ground has 8).
//   msaa     samples on the main pass (only when K is 1, as 'draft' already did).
//   canvasAA a multisampled canvas (WebGL antialias): STYLE's designed looks (notan, poster, flat) draw their figures straight to
//            the canvas and had stair-stepped silhouettes (JUDGE c11); the lit path's own last pass is a full-screen triangle.
//   shadowSize  (option, off in every tier) the sun's shadow map size for this renderer's renders (e.g. 8192: half the texel).
import * as THREE from 'three';

export const QUALITY6 = {
  preview: { K: 1, msaa: 4, vol: 0.25, sso: 0.5, volSteps: 28, specAA: true, aniso: 0, canvasAA: true, tier: 'preview' },
  motion: { K: 8, Kfloor: true, ss: 2, filter: 2.5, vol: 0.25, sso: 0.5, volSteps: 28, msaa: 0, specAA: true, aniso: 0, canvasAA: true, tier: 'motion' },
  film: { K: 16, Kfloor: true, ss: 2, filter: 1.5, vol: 0.25, sso: 0.5, volSteps: 36, msaa: 0, specAA: true, aniso: 0, canvasAA: true, tier: 'film' },
};
export const SS_BUDGET = 16.8e6;   // internal pixels (4096 x 4096): ~1 GB of buffers at ~57 B a pixel

// Blackman-Harris (4-term), Cycles' filter_func_blackman_harris: x in [-w/2, w/2]
export const bh = (w, x) => { if (Math.abs(x) >= w / 2) return 0; const t = 2 * Math.PI * (x / w + 0.5); return 0.35875 - 0.48829 * Math.cos(t) + 0.14128 * Math.cos(2 * t) - 0.01168 * Math.cos(3 * t); };
// inverse CDF of the 1-D filter (Cycles samples its filter table the same way, one axis at a time)
const TABLES = new Map();
export function filterTable(w, n = 512) {
  const key = w + ':' + n; if (TABLES.has(key)) return TABLES.get(key);
  const m = 4096, cdf = new Float64Array(m + 1); for (let i = 0; i < m; i++) cdf[i + 1] = cdf[i] + bh(w, -w / 2 + (i + 0.5) * w / m);
  const tot = cdf[m], inv = new Float32Array(n); let j = 0;
  for (let i = 0; i < n; i++) { const u = (i + 0.5) / n * tot; while (j < m && cdf[j + 1] < u) j++; const f = (u - cdf[j]) / Math.max(cdf[j + 1] - cdf[j], 1e-12); inv[i] = -w / 2 + (j + f) * w / m; }
  TABLES.set(key, inv); return inv;
}
const sampleTable = (tab, u) => { const x = u * (tab.length - 1), i = Math.floor(x), f = x - i; return tab[i] * (1 - f) + tab[Math.min(i + 1, tab.length - 1)] * f; };
// R2: the plastic-number sequence (low discrepancy in 2-D for any K; not correlated with Halton 2,3 or 5,7)
const G = 1.32471795724474602596;
export const r2 = i => [(0.5 + i / G) % 1, (0.5 + i / (G * G)) % 1];
// the sub-frame's pixel offset in INTERNAL pixels
export function subPixel(k, q, ss) {
  const [u, v] = r2(k);
  if (ss > 1 || !q.filter) return [u - 0.5, v - 0.5];
  const t = filterTable(q.filter); return [sampleTable(t, u), sampleTable(t, v)];
}
// the resolve kernel (ss > 1): separable taps at internal pixel centres round the canvas pixel's centre, BH(width) weights
export function resolveTaps(ss, w) {
  const R = 3, x = [], wt = [];   // 6 taps an axis (enough for ss 2 and widths up to 3 px)
  for (let i = -R; i < R; i++) { const p = (i + 0.5) / ss; x.push(p); wt.push(bh(w, p)); }
  const s = wt.reduce((a, b) => a + b, 0); return { x, w: wt.map(v => v / s) };
}
export const RESOLVE_GLSL = /* glsl */`
uniform vec2 uAccRes; uniform float uRW[6], uRX[6];
vec4 acpResolve(){
  // the canvas pixel's centre in internal pixels; the taps sit on internal texel centres (uRX in internal pixels from it)
  vec2 c = vUv * uAccRes; vec4 s = vec4(0.0);
  for (int j = 0; j < 6; j++) { if (uRW[j] <= 0.0) continue;
    for (int i = 0; i < 6; i++) { if (uRW[i] <= 0.0) continue;
      vec2 p = (c + vec2(uRX[i], uRX[j])) / uAccRes; s += texture2D(tAcc, p) * (uRW[i] * uRW[j]); } }
  return s;
}`;

// anisotropic filtering on every mipmapped texture a lit scene samples (once per texture; textures are shared, so a page that
// opts in sees them filtered everywhere afterwards: documented in render6/NOTES.md)
const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'alphaMap', 'emissiveMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
  'sheenColorMap', 'sheenRoughnessMap', 'specularIntensityMap', 'specularColorMap', 'transmissionMap', 'thicknessMap', 'displacementMap', 'lightMap', 'anisotropyMap', 'iridescenceMap', 'iridescenceThicknessMap'];
const MIPF = new Set([THREE.LinearMipmapLinearFilter, THREE.LinearMipmapNearestFilter, THREE.NearestMipmapLinearFilter, THREE.NearestMipmapNearestFilter]);
export function applyAniso(renderer, scene, level) {
  const a = Math.min(level, renderer.capabilities.getMaxAnisotropy()); if (a <= 1) return 0;
  let n = 0;
  const tex = t => {
    if (!t || !t.isTexture || t.isRenderTargetTexture || t.isCubeTexture || t.isData3DTexture || t.isDataArrayTexture) return;
    if (!MIPF.has(t.minFilter) || !(t.generateMipmaps || (t.mipmaps && t.mipmaps.length))) return;
    if ((t.anisotropy || 1) >= a || !t.image || t.image.data === null) return;
    t.anisotropy = a; t.needsUpdate = true; n++;
  };
  scene.traverse(o => { if (!o.material) return;
    for (const m of [].concat(o.material)) { if (!m) continue; for (const s of SLOTS) tex(m[s]);
      const u = renderer.properties.get(m)?.uniforms; if (u) for (const k in u) { const v = u[k]?.value; if (v?.isTexture) tex(v); else if (Array.isArray(v)) for (const x of v) tex(x); } } });
  return n;
}
