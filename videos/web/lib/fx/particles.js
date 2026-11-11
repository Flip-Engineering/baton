// GPU PARTICLES: WebGL2 point clouds, flow sims and crowds for the ACP shorts. Everything is deterministic in t.
// This file only re-exports the modules in ./particles/ (import from here, as before):
//   core.js      Particles: GL context, HDR main buffer, per-layer looks (glow / ink / poster, metaball fill),
//                bloom + tone; shared GLSL; hashing; the out/.pcache disk cache (pcache, disk)
//   samplers.js  point sets: sampleText / sampleImage / samplePath / sampleCanvas / samplePixels / sampleVolume,
//                matchTo, recolor, resize, coverage (content-hash cached)
//   swarm.js     Swarm (closed-form morphs), PRESETS, FLIGHTS, sw.chain() (declarative beat-keyed morph chain)
//   flow.js      Flow (GPGPU, checkpointed replay: a jump and a sequential render are bit-identical)
//   dust.js      Dust (depth-sorted DOF motes)
//   crowd.js     Crowd + walkerAtlas (walkers without instancing)
// See research/capabilities/particles.md.
export { Particles, pcache, disk, hashBytes, hashStr, stableKey, COMMON, PROJ, SPRITE_FS } from './particles/core.js';
export { sampleCanvas, samplePixels, sampleText, sampleImage, samplePath, sampleVolume, reorder, matchTo, recolor, resize, coverage } from './particles/samplers.js';
export { Swarm, PRESETS, FLIGHTS } from './particles/swarm.js';
export { Flow } from './particles/flow.js';
export { Dust } from './particles/dust.js';
export { Crowd, walkerAtlas } from './particles/crowd.js';
