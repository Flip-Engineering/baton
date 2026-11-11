// MAPS (barrel): the geo renderers and the HUD, split into modules. Import from here or from the parts:
//   lib/fx/geo/data.js     loadGeo, provenance FLAGS, ramps, camera maths (camAt keyframes)
//   lib/fx/geo/usmap.js    USMap: GPU county relief, styles ember | poster | night | engraving | thermal | steel | mono
//   lib/fx/geo/globe.js    Globe: shader styles photo | night | poster, cached 2D styles solid | wire | dots, bases, arcs
//   lib/fx/geo/network.js  Network: rail (approx) / grid (procedural) / any graph, lit by graph distance
//   lib/fx/geo/spikes.js   SpikeMap: three.js population skyline, LOD, hero spike, sky, fog, DOF composite
//   lib/fx/geo/thermal.js  Thermal: LWIR remap as a GL pass over the canvas texture (no CPU readback)
//   lib/fx/geo/shot.js     MapKit + shot(): declarative map shots keyed to Beats
//   lib/fx/hud.js          odometer / splitflap / terminal (settle-by), reticle, callout, readout, ticker, tape, viewfinder
// Scenes load the import map with <script src="../lib/importmap.js"></script> before their module script.
export * from './geo/data.js';
export { USMap, US_STYLES } from './geo/usmap.js';
export { Globe, GLOBE_STYLES } from './geo/globe.js';
export { Network } from './geo/network.js';
export { SpikeMap, SKY } from './geo/spikes.js';
export { Thermal } from './geo/thermal.js';
export { MapKit } from './geo/shot.js';
export * from './hud.js';
