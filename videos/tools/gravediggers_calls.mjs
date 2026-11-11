#!/usr/bin/env node
// THE GRAVEDIGGERS: write web/assets/gravediggers/calls.json from the scene itself (scenes/gravediggers.crew.js builds the crew and the
// ground without a renderer; Dig and Earthwork are pure, so the browser computes the same numbers): the call times, the free bites
// on arrival by quarter of the 48 (the isolation voices), ew.depth of the two trenches from the join to the break (Stone's brightness),
// and the bearded man's land on the sign. The score (web/audio/songs2/gravediggers_e.py, load_grid) reads it when it is there.
//   node videos/tools/gravediggers_calls.mjs [--check]      (--check: print, do not write)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
// the libraries load their data with fetch (file: URLs here): serve those from disk
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => { const url = new URL(String(u)); if (url.protocol !== 'file:') return realFetch(u, o); const b = fs.readFileSync(fileURLToPath(url));
  return { ok: true, status: 200, json: async () => JSON.parse(b.toString()), text: async () => b.toString(), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
const { loadAnsur } = await import(path.join(WEB, 'lib/fx/rig/body.js'));
const { loadHeroData } = await import(path.join(WEB, 'lib/fx/hero.js'));
const { buildCrew } = await import(path.join(WEB, 'scenes/gravediggers.crew.js'));
const crew = await buildCrew({ ansur: await loadAnsur(), heroData: await loadHeroData(), field: 0 });
const J = crew.callsJSON(), out = path.join(WEB, 'assets/gravediggers/calls.json');
console.log(`calls ${J.calls.length}, free bites ${J.groups.map(g => g.length).join('/')} (${J.groups.flat().length}), depth ${J.depth.length} samples (${J.depth[0][1]} -> ${J.depth.at(-1)[1]} m), land ${J.land}`);
if (!process.argv.includes('--check')) { fs.writeFileSync(out, JSON.stringify(J, null, 1) + '\n'); console.log('wrote', path.relative(process.cwd(), out)); }
