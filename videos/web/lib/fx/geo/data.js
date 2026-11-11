// geo/data: loading, provenance flags, colour ramps, camera maths. No drawing here.
// d3-geo + topojson-client over us-atlas (counties/states), world-atlas / sane-topojson (land, countries,
// rivers) and a baked GeoNames extract (assets/geo/*.json, made by tools/bake_geo.mjs).
import { feature, mesh } from 'topojson-client';
import { clamp, lerp } from '../../kit.js';

const NM = '../node_modules/';
export const TAU = Math.PI * 2, RAD = Math.PI / 180;
const getJSON = async u => (await fetch(u)).json();
export const hash = (a, b = 0) => { let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1); h = Math.imul(h ^ h >>> 15, 0x85ebca6b); h ^= h >>> 13; return ((h >>> 0) % 100000) / 100000; };

// ---------------------------------------------------------------- data honesty
// Every derived dataset carries a flag; hud.callout / hud.readout print it automatically when given { src }.
//   'real'       straight from the source (county polygons, coastlines, GeoNames town populations)
//   'sample'     a real but partial or relative set (county weight = GeoNames place sum; 50 of ~750 bases)
//   'approx'     real routes simplified (rail runs town to town, not along the track)
//   'procedural' plausible topology on real places (the grid MST): never caption it as the actual network
export const FLAGS = { counties: 'real', towns: 'real', countyWeight: 'sample', rail: 'approx', grid: 'procedural', bases: 'sample', lights: 'real' };
export const FLAG_LABEL = { sample: 'SAMPLE', approx: 'APPROX.', procedural: 'PROCEDURAL', real: null };
export const flagOf = src => src == null ? null : typeof src === 'string' ? src : src.flag || null;

// detail: '50m' | '110m' (world land/countries). Returns plain GeoJSON features + the baked extracts.
export async function loadGeo({ us = true, world = true, detail = '50m', rivers = true } = {}) {
  const G = { flags: FLAGS };
  if (us) {
    const [ct, bake, su] = await Promise.all([getJSON(NM + 'us-atlas/counties-10m.json'), getJSON('../assets/geo/us.json'),
      rivers ? getJSON(NM + 'sane-topojson/dist/usa_50m.json') : null]);
    G.us = {
      counties: feature(ct, ct.objects.counties).features,
      states: feature(ct, ct.objects.states).features,
      nation: feature(ct, ct.objects.nation),
      countyMesh: mesh(ct, ct.objects.counties, (a, b) => a !== b && (a.id / 1000 | 0) === (b.id / 1000 | 0)),
      stateMesh: mesh(ct, ct.objects.states, (a, b) => a !== b),
      rivers: su ? feature(su, su.objects.rivers) : null,
      lakes: su ? feature(su, su.objects.lakes) : null,
      ...bake,
    };
  }
  if (world) {
    const [wt, bake, sw] = await Promise.all([getJSON(NM + `world-atlas/countries-${detail}.json`), getJSON('../assets/geo/world.json'),
      rivers ? getJSON(NM + 'sane-topojson/dist/world_50m.json') : null]);
    G.world = {
      land: feature(wt, wt.objects.land),
      countries: feature(wt, wt.objects.countries).features,
      borders: mesh(wt, wt.objects.countries, (a, b) => a !== b),
      rivers: sw ? feature(sw, sw.objects.rivers) : null,
      ...bake,
    };
  }
  return G;
}

// ---------------------------------------------------------------- colour
export const hexRGB = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const hex01 = h => hexRGB(h).map(v => v / 255);
// stops: [[pos, '#hex'], ...] -> n rgb triples 0..255
export function rampRGB(stops, n = 256) {
  const s = stops.map(([p, c]) => [p, hexRGB(c)]), out = [];
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1); let k = 0; while (k < s.length - 2 && x > s[k + 1][0]) k++;
    const [p0, a] = s[k], [p1, b] = s[k + 1], u = clamp((x - p0) / (p1 - p0 || 1));
    out.push(a.map((v, j) => Math.round(lerp(v, b[j], u))));
  }
  return out;
}
export const ramp = (stops, n = 256) => rampRGB(stops, n).map(c => `rgb(${c.join(',')})`);
export const RAMPS = {
  ember: [[0, '#120304'], [0.18, '#2a0609'], [0.4, '#7a0d16'], [0.58, '#BD1818'], [0.72, '#e2452f'], [0.86, '#f4b98a'], [0.94, '#F4E6D0'], [1, '#fffaf2']],
  ironbow: [[0, '#05020f'], [0.2, '#2c0470'], [0.4, '#8c0a7a'], [0.58, '#d4222e'], [0.75, '#f5780f'], [0.9, '#ffd54a'], [1, '#fffbe8']],
  acp: [[0, '#070102'], [0.3, '#3a0508'], [0.55, '#BD1818'], [0.78, '#e8583a'], [0.92, '#F4E6D0'], [1, '#ffffff']],
  whitehot: [[0, '#050505'], [0.5, '#6a6260'], [0.85, '#e8e2da'], [1, '#ffffff']],
  steel: [[0, '#07080a'], [0.35, '#1b2026'], [0.7, '#5d6770'], [1, '#e6eef2']],
};
const RAMP_CSS = {};
export const rampCSS = name => RAMP_CSS[name] || (RAMP_CSS[name] = ramp(RAMPS[name]));
// a 256x1 canvas of a ramp (for GL palette textures)
export function rampCanvas(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 1; const g = c.getContext('2d');
  rampCSS(name).forEach((s, i) => { g.fillStyle = s; g.fillRect(i, 0, 1, 1); });
  return c;
}

// ---------------------------------------------------------------- camera
// cam = { x, y, zoom, rot, sx, sy } in map-space pixels (the projection's own frame). sx/sy: screen anchor
// (defaults to the canvas centre: sizes always come from ctx.canvas, never from globals).
export function camApply(ctx, cam, base = 1) {
  const z = (cam.zoom || 1) * base;
  ctx.translate(cam.sx ?? ctx.canvas.width / 2, cam.sy ?? ctx.canvas.height / 2);
  if (cam.rot) ctx.rotate(cam.rot);
  ctx.scale(z, z);
  ctx.translate(-cam.x, -cam.y);
  return z;
}
export function camToScreen(p, cam, w, h) {
  const z = cam.zoom || 1, c = Math.cos(cam.rot || 0), s = Math.sin(cam.rot || 0), dx = (p[0] - cam.x) * z, dy = (p[1] - cam.y) * z;
  return [(cam.sx ?? w / 2) + dx * c - dy * s, (cam.sy ?? h / 2) + dx * s + dy * c];
}
// keyframed camera: keys [[beat, {x, y, zoom, ...}], ...] -> cam at beat (inOutCubic between keys)
export function camAt(keys, beat, e = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)) {
  if (!Array.isArray(keys)) return keys;
  if (beat <= keys[0][0]) return { ...keys[0][1] };
  for (let i = 1; i < keys.length; i++) {
    const [b0, c0] = keys[i - 1], [b1, c1] = keys[i];
    if (beat <= b1) {
      const u = e(clamp((beat - b0) / (b1 - b0 || 1))), o = { ...c0 };
      for (const k of Object.keys(c1)) if (typeof c1[k] === 'number' && typeof c0[k] === 'number')
        o[k] = k === 'zoom' ? Math.exp(lerp(Math.log(c0[k]), Math.log(c1[k]), u)) : lerp(c0[k], c1[k], u);
      return o;
    }
  }
  return { ...keys[keys.length - 1][1] };
}
export const v3 = ([lon, lat]) => { const a = lon * RAD, b = lat * RAD, cb = Math.cos(b); return [cb * Math.sin(a), Math.sin(b), cb * Math.cos(a)]; };
