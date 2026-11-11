// LIGHT: the shared lighting, shader and effects pipeline for the 3D work (LIGHTING c1). See research/capabilities/lighting.md.
//   import { LitRenderer, LightRig, PRESETS, steelMaterial, concreteMaterial, Medium, plume, dustBurst, Debris, shake } from '../lib/fx/light/index.js';
export * from './color.js';
export * from './sky.js';
export * from './display.js';
export * from './patch.js';
export * from './practicals.js';
export * from './rig.js';
export * from './medium.js';
export * from './surface.js';
export * from './effects.js';
export * from './presets.js';
export { LitRenderer, QUALITY } from './pipeline.js';
export * from './adapters.js';
