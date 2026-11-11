// OBJECTIVE / bake (Oct 2026; the series engine): loads the farm's GPU bakes for this series' instruments: float16 fields with a time axis
// and a manifest of units, constants, grids and provenance (videos/gpu/<instrument>/<job>.py writes them to $GPU_OUT; the delivery is
// copied under videos/web/assets/<scene>/). ep.1's quench bake (videos/gpu/quench/quench.py) is week 2 of its brief; until it lands the
// drop's field is the closed-form prototype (polariscope_ref.js dropBody), and this loader is ready for it.
//
//   const B = await loadBake('../assets/atrest/quench/');          // manifest.json + the files it lists
//   B.manifest.units, B.times, await B.field('head', k)          // Float32Array of the k-th time's head field (channels interleaved)
export function half2float(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}
let LUT = null;
export function decodeF16(buf) {
  if (!LUT) { LUT = new Float32Array(65536); for (let i = 0; i < 65536; i++) LUT[i] = half2float(i); }
  const u = new Uint16Array(buf), out = new Float32Array(u.length); for (let i = 0; i < u.length; i++) out[i] = LUT[u[i]]; return out;
}
export async function loadBake(base, { fetchFn = globalThis.fetch } = {}) {
  const url = f => base.replace(/\/?$/, '/') + f;
  const manifest = await fetchFn(url('manifest.json')).then(r => { if (!r.ok) throw new Error('bake: no manifest at ' + base); return r.json(); });
  const cache = new Map();
  const field = async (part, k) => { const f = manifest.files?.[part]?.[k]; if (!f) throw new Error(`bake: no ${part} at ${k}`);
    if (!cache.has(f)) cache.set(f, fetchFn(url(f)).then(r => r.arrayBuffer()).then(decodeF16)); return cache.get(f); };
  return { manifest, times: manifest.times || [], field, grid: manifest.grid || null };
}
