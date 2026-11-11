// Particles({ scale < 1 }) check: the same swarm frame rendered at scale 1 and 0.5 must have the same mean luma
// (point sizes follow the target through P.pxs). node tools/particles_scale.mjs  -> exits 1 when they differ by > 3%.
import { openScene } from './_page.mjs';
const S = await openScene('lab_particles_bench');
const r = await S.page.evaluate(() => window.scaleCheck());
const a = Number(r[1]), b = Number(r[0.5] ?? r['0.5']), rel = Math.abs(a - b) / Math.max(a, 1e-6);
console.log(`scale 1: mean luma ${a}  scale 0.5: ${b}  (diff ${(rel * 100).toFixed(1)}%) ${rel <= 0.03 ? 'PASS' : 'FAIL'}`);
await S.close();
process.exit(rel <= 0.03 ? 0 : 1);
