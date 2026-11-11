// Map shots for the ACP pieces, each a ~10-line spec on lib/fx/geo/shot.js (times in beats from the shot's start).
// Use inside a scene:  const M = await MapKit.load(B, { THREE });  const s = empire(M, B);  ... s(ctx, t)
// Offset `at` to place the shot in the piece: empire(M, B, 44) runs from beat 44.
import { C } from '../../kit.js';

// EMPIRE: bases ping across the photographic globe, count settles on the 4th beat, 50 arcs travel home
export const empire = (M, B, at = 0) => M.shot({
  layer: 'globe', style: 'photo', beats: [at, at + 16], bg: '#050102',
  cam: [[at, { lon: 12, lat: -30, scale: 0.9 }], [at + 8, { lon: -10, lat: -34, scale: 1.16 }], [at + 15, { lon: 170, lat: -50, scale: 1.16 }]],
  bases: { beats: [at], stagger: 4 * B.spb / 50 }, arcs: { beats: [at + 4, at + 16] },
  hud: [{ hero: M.globe.bases.length, start: at, settle: at + 4, caption: 'US BASES ABROAD', src: M.globe.bases, digits: 2, commas: false, y: 380 }],
});

// MELTDOWN: counties overheat outward from a failure point on the ironbow relief; one reticle names the origin
export const meltdown = (M, B, at = 0) => M.shot({
  layer: 'us', style: 'thermal', beats: [at, at + 12], bg: '#05020f', sy: 1000,
  cam: [[at, { at: 'Pittsburgh', zoom: 3 }], [at + 11, { x: 560, y: 390, zoom: 1.05 }]],
  ignite: { origin: 'Pittsburgh', beats: [at, at + 11], r: [0, 860], width: 70, heat: 0.6 },
  hud: [{ hero: 'lit', caption: 'COUNTIES OVERHEATING', settle: at + 11, suffix: `/ ${M.us.c.length.toLocaleString('en-US')}`, y: 420 },
    { reticle: 'Pittsburgh', at: at + 0.5, label: 'FAILURE POINT' }],
});

// FRONTIER: the Class I lines light west from Chicago on a flat poster map; TRACK LIT lands on the 10th beat
export const frontier = (M, B, at = 0) => M.shot({
  layer: 'us', style: 'poster', beats: [at, at + 12], bg: '#F4E6D0', sy: 1000,
  cam: [[at, { at: 'Chicago', zoom: 2.4 }], [at + 11, { x: 470, y: 380, zoom: 1.35 }]],
  ignite: { origin: 'Chicago', beats: [at, at + 11], r: [0, 760], width: 30 },
  network: { net: 'rail', beats: [at, at + 10], draw: { color: '#0B0B0B', glow: C.red2, width: 3.4, glowW: 8, pulses: 2, blend: 'source-over' } },
  hud: [{ hero: 'km', caption: 'TRACK LIT', settle: at + 10, suffix: 'KM', src: M.rail, y: 420, color: '#0B0B0B', suffixColor: '#0B0B0B', shade: false }],
});
