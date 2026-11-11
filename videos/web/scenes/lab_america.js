// LAB AMERICA (P1, 8 Oct 2026): a stills sheet for lib/fx/geo/america.js, the America map layer (the USA and Canada together, the
// party's territory: research/sources/texts/acp-constitution.txt L1). Not a piece. Posted to the GPU farm by the director; never run here.
// One still per second: still i is drawn for t in [i, i + 1); check the frames at t = i + 0.5 (window.STILLS lists them, DURATION = 41 s).
//    0- 6  the 7 styles at the 'continent' cam, international line on (countyLines 0: Canada has no county mesh)
//    7-13  the same, line off (border: 0)
//   14-27  seam close-ups at zoom 4, each site in poster (line off: the raw ID / mask seam) then engraving (line on, borderLakes):
//          Sweetgrass on the 49th, Detroit / Windsor, Lake Superior, Maine / NB, Point Roberts, 141W, Juan de Fuca. countyLines 0 on
//          both sides (Canada has no county mesh): a change of line density at the border would hide or fake a sliver
//   28-31  ember ignition from HOME (Kansas City) at r 0, 500, 1000 and us.reach(HOME) (everything lit, both countries)
//   32     night, ring from HOME with the kmAt() label at the 'mainland' cam (Albers is equal-area: never print map px as km)
//   33-36  Detroit -> Windsor / London / Toronto ignition across the border in poster, night, engraving, ember; countyLines 0 and the
//          towns of both countries lit. The frame (map x 722..938) also holds the St Lawrence channel (x 906..923) and the 14 places the
//          bake snapped off the 1:50M lake shores and the channel (Kingston, Niagara Falls, Brockville, Cornwall...): check them here
//   37     the DEFAULT USMap (unchanged code path), lab_maps' IGNITE cam, Detroit r 500, for comparison
//   38     the America map, same cam and ignition. CONUS GEOMETRY is identical (paths, centroids, HOME); the PIXELS are not: the
//          US-Canada line is a 2D overlay in the LC1 colour (the default strokes it in LINES.b, LC2), the graticule runs [-180,15]..
//          [-50,84] (default [-150,12]..[-40,72]: 12-15N stubs and 75N / 80N show here), relief differs near the border (Canadian cells and
//          town mounds blur across it), and the bake is S 2 (default 3). So a 37 / 38 A/B shows differences that are not regressions
//   39     night, no ignition, the 'south' cam (MAJORITY eastShot read: Canada's lights on with the US's)
//   40     LANDSCAPE: 'mainland' and 'south' framed for 1920x1080, each drawn at 1920x1080 and shown 1080 wide. In portrait every preset
//          is width-limited ('south' = 'mainland' zoom .632); only a landscape frame zooms in when 'south' trims Alaska's north-west
//          and northern Ellesmere (it does not crop the Arctic islands)
// Setup logs: load / constructor / bake / plate (scale 1.4) timings. Per still: lit (US counties), litCA (procedural cells, never captioned).
// Separately (farm): lab_maps rendered before and after this change must be pixel-equal (usmap.js only gained an export line).
// Also window.tests + window.view(name) (lab_maps_bench pattern).
import { W, H, C, loadFonts, outCanvas, line } from '../lib/kit.js';
import { Print } from '../lib/fx/print.js';
import { loadGeo } from '../lib/fx/geo/data.js';
import { USMap, US_STYLES } from '../lib/fx/geo/usmap.js';
import { loadAmerica, AmericaMap, kmAt, AM_BOX } from '../lib/fx/geo/america.js';

const ctx = outCanvas();
await loadFonts();
const T0 = performance.now(), lap = () => (performance.now() - T0).toFixed(0);
const geo = await loadGeo({ world: false, rivers: true }); const tGeo = lap();
const AM = await loadAmerica({ rivers: true }); const tAM = lap();
const am = new AmericaMap(geo, AM, { bake: 2 }); const tCtor = lap();
am._bake(); const tBake = lap();
am.plate({ Print, scale: 1.4, pitchPx: 5 }); const tPlate = lap();
const us0 = new USMap(geo); us0._bake(); const tDef = lap();
console.log(`setup ms: loadGeo ${tGeo}  loadAmerica ${tAM}  AmericaMap ${tCtor}  bake ${am.bakeMs.toFixed(0)} (S ${am.S})  plate(scale 1.4) ${am.plateMs.toFixed(0)}  default USMap+bake ${us0.bakeMs.toFixed(0)}  total ${tDef}`);
console.log(`america: counties ${am.c.length}  cells ${am.cells.length} (procedural)  towns US ${am.cities.length} CA ${am.caCities.length}  border px ${am.split.borderPx.toFixed(0)} runs ${am.split.border.length}  box ${JSON.stringify(AM_BOX.continent)}`);

const HOME = [-94.6, 39.1], DET = [-83.05, 42.33];
const CONT = am.frame('continent'), SOUTH = am.frame('south');
const STYLES = ['ember', 'thermal', 'steel', 'mono', 'poster', 'night', 'engraving'];
const LIGHT = { poster: 1, engraving: 1 };
const SEAMS = [['SWEETGRASS 49N', [-111.96, 49.0]], ['DETROIT / WINDSOR', [-83.04, 42.32]], ['LAKE SUPERIOR', [-88.5, 48.0]], ['MAINE / NB', [-67.8, 46.5]],
  ['POINT ROBERTS', [-123.06, 48.98]], ['141W', [-141, 64.5]], ['JUAN DE FUCA', [-123.6, 48.3]]];
const camAt = (ll, zoom) => { const p = am.project(ll); return { x: p[0], y: p[1], zoom }; };
const bg = s => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = US_STYLES[s].bg; ctx.fillRect(0, 0, W, H); };
function label(style, a, b = '') {
  const light = LIGHT[style]; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = light ? 'rgba(244,230,208,0.85)' : 'rgba(5,3,4,0.7)'; ctx.fillRect(0, 0, W, b ? 160 : 104);
  const color = light ? C.black : C.cream;
  line(ctx, a, 40, 70, { family: 'Plex Mono', size: 38, align: 'left', color, maxW: W - 80 });
  if (b) line(ctx, b, 40, 128, { family: 'Plex Mono', size: 34, align: 'left', color, maxW: W - 80 });
  ctx.restore();
}

const SHOTS = [];
const shot = (name, fn) => SHOTS.push({ name, fn });
for (const s of STYLES) shot(`continent_${s}_line`, t => { bg(s); const r = am.draw(ctx, { cam: CONT, t, style: s, countyLines: 0, res: 1 }); label(s, `AMERICA · ${s.toUpperCase()}`, 'CONTINENT CAM · INTERNATIONAL LINE ON'); return r; });
for (const s of STYLES) shot(`continent_${s}_noline`, t => { bg(s); const r = am.draw(ctx, { cam: CONT, t, style: s, countyLines: 0, border: 0, res: 1 }); label(s, `AMERICA · ${s.toUpperCase()}`, 'CONTINENT CAM · LINE OFF (border: 0)'); return r; });
for (const [n, ll] of SEAMS) {
  shot(`seam_${n}_poster`, t => { bg('poster'); const r = am.draw(ctx, { cam: camAt(ll, 4), t, style: 'poster', countyLines: 0, border: 0, res: 1, grid: 0.2 }); label('poster', `SEAM · ${n}`, 'POSTER · ZOOM 4 · LINE OFF (raw seam)'); return r; });
  shot(`seam_${n}_engraving`, t => { bg('engraving'); const r = am.draw(ctx, { cam: camAt(ll, 4), t, style: 'engraving', countyLines: 0, borderLakes: true, res: 1, grid: 0.2 }); label('engraving', `SEAM · ${n}`, 'ENGRAVING · ZOOM 4 · LINE ON + LAKES'); return r; });
}
const REACH = am.reach(HOME);
for (const [tag, r] of [['0', 0], ['500', 500], ['1000', 1000], ['reach', REACH]])
  shot(`ember_home_r${tag}`, t => { bg('ember'); const ig = { origin: HOME, r, width: 40 }; const o = am.draw(ctx, { cam: CONT, t, style: 'ember', countyLines: 0, ignite: ig, res: 1 });
    label('ember', `EMBER · FROM HOME · R ${Math.round(r)} PX`, `${Math.round(kmAt(HOME, r)).toLocaleString('en-US')} KM ALONG THE LABEL ANGLE`); return o; });
shot('night_ring_home', t => {
  bg('night'); const cam = am.frame('mainland'), ig = { origin: HOME, r: 600, width: 40 };   // all of mainland Alaska and Newfoundland
  const o = am.draw(ctx, { cam, t, style: 'night', countyLines: 0, border: 0, ignite: ig, res: 1, grid: 0 });
  am.towns(ctx, { cam, ignite: ig, minPop: 50000, size: 0.8 });
  am.ring(ctx, { cam, ignite: ig, km: kmAt(HOME, ig.r) });
  label('night', 'NIGHT · RING FROM HOME', `R 600 PX = ${Math.round(kmAt(HOME, 600)).toLocaleString('en-US')} KM (kmAt)`); return o;
});
for (const s of ['poster', 'night', 'engraving', 'ember'])
  shot(`detroit_toronto_${s}`, t => {
    bg(s); const cam = { x: 830, y: 245, zoom: 5 }, ig = { origin: DET, r: 45, width: 30 };
    const o = am.draw(ctx, { cam, t, style: s, countyLines: 0, ignite: ig, res: 1, grid: 0.2, border: s === 'night' ? 0 : null });
    am.towns(ctx, { cam, ignite: ig, minPop: 20000, which: 'all', size: 0.7 });
    const nLit = list => list.filter(c => c.pop >= 20000 && am._ign(c, ig)[0] > 0.5).length;
    label(s, `DETROIT TO TORONTO · ${s.toUpperCase()}`, `R 45 PX · TOWNS LIT US ${nLit(am.cities)} · CA ${nLit(am.caCities)}`); return o;
  });
const IGN = { x: 560, y: 390, zoom: 1.02, sy: 1000 };
shot('default_usmap_ember', t => { bg('ember'); const o = us0.draw(ctx, { cam: IGN, t, style: 'ember', ignite: { origin: DET, r: 500, width: 46 }, res: 1 }); label('ember', 'DEFAULT USMap (UNCHANGED PATH)', "LAB_MAPS IGNITE CAM · DETROIT R 500"); return o; });
shot('america_ember_same_cam', t => { bg('ember'); const o = am.draw(ctx, { cam: IGN, t, style: 'ember', ignite: { origin: DET, r: 500, width: 46 }, res: 1 }); label('ember', 'AMERICA MAP · SAME CAM · DETROIT R 500', 'CONUS GEOMETRY SAME · LINE, GRID, RELIEF DIFFER'); return o; });
shot('south_night_all_lit', t => { bg('night'); const o = am.draw(ctx, { cam: SOUTH, t, style: 'night', countyLines: 0, border: 0, res: 1, grid: 0 }); label('night', "NIGHT · 'SOUTH' CAM · NO IGNITE", 'EVERY LIGHT ON, BOTH COUNTRIES'); return o; });
// landscape A/B: each preset framed for 1920x1080, drawn into a 1920x1080 canvas, shown 1080 x 607.5
const LAND = document.createElement('canvas'); LAND.width = 1920; LAND.height = 1080; const lctx = LAND.getContext('2d');
shot('landscape_mainland_south', t => {
  bg('night'); let o = {};
  [['mainland', 250], ['south', 1010]].forEach(([n, y]) => {
    const cam = am.frame(n, { w: 1920, h: 1080 });
    lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.globalAlpha = 1; lctx.globalCompositeOperation = 'source-over'; lctx.fillStyle = US_STYLES.night.bg; lctx.fillRect(0, 0, 1920, 1080);
    o = am.draw(lctx, { cam, t, style: 'night', countyLines: 0, border: 0, res: 1, grid: 0.35 });
    ctx.drawImage(LAND, 0, y, 1080, 607.5);
    ctx.strokeStyle = 'rgba(244,230,208,0.6)'; ctx.lineWidth = 2; ctx.strokeRect(1, y, 1078, 607.5);
    line(ctx, `'${n.toUpperCase()}' 1920x1080 · ZOOM ${cam.zoom.toFixed(3)} · Y ${(cam.y - 540 / cam.zoom).toFixed(0)}..${(cam.y + 540 / cam.zoom).toFixed(0)}`, 40, y - 22, { family: 'Plex Mono', size: 30, align: 'left', color: C.cream, maxW: W - 80 });
  });
  label('night', 'LANDSCAPE · MAINLAND VS SOUTH', "PORTRAIT: BOTH ZOOM .632 (WIDTH-LIMITED)"); return o;
});

export const DURATION = SHOTS.length;
window.DURATION = DURATION;
window.STILLS = SHOTS.map((s, i) => ({ t: i + 0.5, name: s.name }));
function frame(t) {
  const i = Math.max(0, Math.min(SHOTS.length - 1, Math.floor(t))), s = SHOTS[i], a = performance.now();
  const r = s.fn(t) || {};
  ctx.getImageData(0, 0, 1, 1);
  console.log(`still ${i} t=${t.toFixed(2)} ${s.name} ${(performance.now() - a).toFixed(0)}ms lit=${r.lit ?? '-'} litCA=${r.litCA ?? '-'}`);
}
window.renderFrame = frame;
window.tests = SHOTS.map(s => s.name);
window.view = name => { const i = SHOTS.findIndex(s => s.name === name); if (i < 0) return false; frame(i + 0.5); return true; };
console.log(`lab_america ready: ${SHOTS.length} stills, DURATION ${DURATION} s; check t = i + 0.5`);
window.sceneReady = true;
