// Offline bakes for lib/fx/sim2 (heads). node web/bake_sim2.mjs [ironworker farmer ...]  -> web/assets/bake/sim2/head_<name>.bin
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bakeHead, packHead, HEADS } from './lib/fx/sim2/sculpt.js';
const HERE = path.dirname(fileURLToPath(import.meta.url)), OUT = path.join(HERE, 'assets', 'bake', 'sim2');
fs.mkdirSync(OUT, { recursive: true });
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(HEADS);
for (const n of names) {
  const t = Date.now(), b = bakeHead(HEADS[n]);
  fs.writeFileSync(path.join(OUT, `head_${n}.bin`), packHead(b));
  console.log(`head_${n}: ${b.pos.length / 3} verts, ${b.idx.length / 3} tris, ${Date.now() - t} ms`);
}
