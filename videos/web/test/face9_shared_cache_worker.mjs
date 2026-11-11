import fs from 'node:fs';
import { solveFace9Cached } from '../lib/fx/face/face9_shared_cache.mjs';

const [root, cacheRoot, qualificationFile, countFile] = process.argv.slice(2);
const V = { P: new Float32Array([0.1, 0.2, 0.3]), E: new Float32Array([1, 2, 3]),
  info: { sex: 'F', age: 24, group: 'hispanic', bmi: 21.5 }, tri: new Uint32Array([0, 1, 2]),
  side: new Uint8Array([0, 1]), seedKey: 'seed-1' };
const deps = { F: { ids: new Uint16Array([1, 2]), pop: { r: [1.25, 2.5] }, lid: [[4, 5]],
  has(name) { return name === 'fixture'; }, target(name) { return { name }; } },
  globes(E, side) { return { L: { ix: Array.from(E), side: Array.from(side), c: [0.1, 0.2, 0.3], R: 0.01 } }; } };
const options = { nb: 3, meta: { by: 'fixture' } };
const result = await solveFace9Cached({ root, cacheRoot, qualificationFile, V, deps, options }, async () => {
  fs.appendFileSync(countFile, 'solve\n');
  await new Promise(resolve => setTimeout(resolve, 80));
  const buf = Buffer.alloc(14), dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  dv.setUint32(0, 1, true); dv.setUint16(4, 2, true); dv.setInt16(8, 11, true); dv.setInt16(10, -12, true); dv.setInt16(12, 13, true);
  return { buf, n: 1, meta: { fixture: true } };
});
process.stdout.write(JSON.stringify({ buf: result.buf.toString('base64'), n: result.n, meta: result.meta }));
