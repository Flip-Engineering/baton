// LAB / IMAGE2: image-based and compositing tools (lib/fx/imagelib.js, montage.js, repro.js, project.js; offline
// tools in videos/tools/imagelib/) shown in the slate's own worlds and palette. Each shot is a composed frame for the
// piece that would use it, not a test pattern.
//   ?shot=<name>   window.renderFrame(t) -> { ms, stats }
import { W, H, loadFonts, acpEmblem, C } from '../lib/kit.js';
import { lib } from '../lib/fx/imagelib.js';
import { Montage, twos, boil } from '../lib/fx/montage.js';
import { Repro } from '../lib/fx/repro.js';
import { Project } from '../lib/fx/project.js';

const Q = new URLSearchParams(location.search);
const SHOT = Q.get('shot') || 'klutsis', PROF = Q.has('prof');
const T0 = performance.now();
await loadFonts();
const out = document.getElementById('out'), ctx = out.getContext('2d');
const L = await lib();
const cv = (w = W, h = H) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const E = { out: (u) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3), back: u => { u = Math.min(1, Math.max(0, u)); const s = 1.9; return 1 + (s + 1) * Math.pow(u - 1, 3) + s * Math.pow(u - 1, 2); } };

// words set as a canvas (alpha = ink) so montage/repro print them
function words(str, { x = W / 2, y = 900, size = 200, face = 'Anton', rot = 0, track = 0, align = 'center', color = '#000' } = {}) {
  const c = cv(), g = c.getContext('2d');
  g.translate(x, y); g.rotate(rot); g.font = `${size}px "${face}"`; g.textAlign = align; g.textBaseline = 'alphabetic'; g.fillStyle = color;
  if (track) { g.letterSpacing = `${track}px`; }
  g.fillText(str, 0, 0);
  return c;
}
function mark(size, { x = W / 2, y = H / 2, color = '#000' } = {}) { const c = cv(), g = c.getContext('2d'); acpEmblem(g, x, y, size, { color }); return c; }

const SHOTS = {};

// ---------------------------------------------------------------- KLUTSIS: scale collision on a 32° band
// The giant: the client's trucker, looking up, cut out and screened in black. The small: the hardhat worker,
// repeated three times up the band toward the red sun (Klutsis repeated one photograph as a rhythm). The words ride
// the band. Paper pieces boil on twos; everything slides in on the hits.
SHOTS.klutsis = async () => {
  const m = new Montage(W, H); m.profile = PROF;
  const hard = await L.plate('client_join_banner'), truck = await L.plate('client_own_future');
  const A = -32 * Math.PI / 180, bx = 540, by = 470;
  const along = (s, off = 0) => [bx + Math.cos(A) * s - Math.sin(A) * off, by + Math.sin(A) * s + Math.cos(A) * off];
  const tw = fitWords('OWN THE FUTURE', 1120, { face: 'Anton' });
  const type = words('OWN THE FUTURE', { x: along(0, 12)[0], y: along(0, 12)[1] + tw.size * 0.36, size: tw.size, face: 'Anton', rot: A });
  return (t, dst = ctx) => {
    const ts = twos(t, 12);
    const u = E.back((ts - 0.1) / 0.45), v = k => E.back((ts - 0.45 - k * 0.12) / 0.4);
    m.begin(ts, { paper: 'cream', seed: 3 });
    // the small ones, walking up the band into the sun: they rise from behind it
    [[-300, 330], [-40, 250], [180, 185]].forEach(([s, h], k) => {
      const [x, y] = along(s + (1 - v(k)) * -700, -30);
      m.cutout(hard.cut, boil({ x, y, h, anchor: [0.5, 1], rot: 0.02 * (k - 1), treat: 'duotone', cell: 5, angle: 45, angle2: 75, levels: 'auto', mid: 0.4,
        ink: 'black', ink2: 'acp', misreg: [2.5, -1.5], border: 7, edge: 'scissor', shadow: [5, 7, 6, 0.35],
        rim: { dir: [0.9, -0.6], amt: 0.8, w: 8 } }, ts, 7 + k, 1.2));
    });
    m.shape('band', { x: bx, y: by, angle: -32, w: 250, ink: 'acp', rough: 2, len: 1900 });
    m.shape('disc', { x: 880, y: 215, r: 205, ink: 'acp', rough: 3, blend: 'multiply', density: 0.9 });
    // the giant head: face on the right third, gaze up the band; bleeds off the bottom
    m.cutout(truck.cut, boil({ x: 830, y: 1440 + (1 - u) * 300, anchor: [0.93, 0.5], h: 1100, treat: 'halftone', cell: 8, angle: 45,
      levels: 'auto', mid: 0.22, contrast: 0.6, border: 18, edge: 'scissor', shadow: [16, 20, 14, 0.35], ink: 'black',
      rim: { dir: [0.8, -1], amt: 1, w: 16, ink: 'acp' } }, ts, 2));
    m.ink(type, { ink: 'cream', dynamic: false });
    m.end(dst, { age: 0.5, creases: [[0, 960, 1080, 952], [540, 0, 546, 1920]] });
    return m.stats;
  };
};
function fitWords(str, width, { face = 'Anton' } = {}) {
  const g = cv(4, 4).getContext('2d'); g.font = `100px "${face}"`; const w = g.measureText(str).width; return { size: 100 * width / w };
}

// label-maker tape (POLITICAL ECONOMY's type: IBM Plex Mono embossed into black tape), as a canvas with alpha
function tape(str, { x, y, size = 64, rot = 0, color = '#161616' } = {}) {
  const c = cv(), g = c.getContext('2d'); g.font = `700 ${size}px "Plex Mono"`; const w = g.measureText(str).width + size * 0.9, h = size * 1.35;
  g.translate(x, y); g.rotate(rot);
  g.fillStyle = color; g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, size * 0.12); g.fill();
  g.globalCompositeOperation = 'destination-out'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(str, 0, size * 0.04);
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.28; g.fillStyle = '#fff'; g.fillText(str, 1.5, size * 0.04 - 2);   // embossed plastic whitens
  return c;
}

// ---------------------------------------------------------------- TONER: scraps on the copier glass, copied three times
// POLITICAL ECONOMY's medium (VISUAL_BIBLE §1.2): scissor-cut photo scraps + label tape, laid on the glass, and the
// scan bar prints a third-generation copy: hollow solids, speckled midtones, drum streaks, the open-lid border.
SHOTS.toner = async () => {
  const m = new Montage(W, H), rp = new Repro(W, H);
  const hard = await L.plate('client_join_banner'), coins = await L.image('coins_pompeii'), truck = await L.plate('client_own_future');
  const t1 = tape('AN ACCELERATED', { x: 470, y: 250, size: 70, rot: -0.03 }), t2 = tape('INTRODUCTION.', { x: 560, y: 355, size: 70, rot: 0.02 });
  const gen = +(Q.get('gen') || 3);
  return (t, dst = ctx) => {
    const ts = twos(t, 8);
    m.begin(ts, { paper: 'white', seed: 5 });
    m.cutout(coins, { x: 800, y: 640, h: 340, rot: 0.11, treat: 'photo', levels: 'auto', mid: 0.38, contrast: 0.8, border: 0, edge: 'torn', shadow: [2, 3, 1.5, 0.7], alpha: false });
    m.cutout(hard.cut, { x: 560, y: 1290, h: 1050, rot: -0.04, treat: 'halftone', cell: 6, angle: 45, levels: 'auto', mid: 0.45, border: 14, edge: 'scissor', shadow: [2, 3, 1.5, 0.75] });
    m.cutout(truck.img, { x: 820, y: 1640, h: 420, rot: -0.12, crop: [0.0, 0.35, 0.62, 0.92], treat: 'photo', levels: 'auto', mid: 0.4, edge: 'torn', border: 0, shadow: [2, 3, 1.5, 0.7], alpha: false });
    m.ink(t1, { ink: '#141414', dynamic: false }); m.ink(t2, { ink: '#141414', dynamic: false });
    m.end(null, { age: 0, tooth: 0.5 });
    rp.toner(m.canvas, t, { gen, boil: 8, lid: [18, 30, 24, 44] });
    rp.draw(dst);
    return { montage: m.stats, repro: rp.stats };
  };
};

// ---------------------------------------------------------------- GRAVURE: the photo-magazine plate
// Rotogravure (USSR in Construction, AIZ): the trucker full-bleed in green-black gravure, deep and velvety, with the
// cells visible in the sky; a red overprint wedge and the words set in the plate itself (sawtooth edges).
SHOTS.gravure = async () => {
  const rp = new Repro(W, H), m = new Montage(W, H);
  const truck = await L.plate('client_own_future');
  const src = cv(), g = src.getContext('2d');
  const word = fitWords('WHO OWNS', 900, { face: 'Anton' });
  return t => {
    // the plate: the photo, cover-fitted with a slow push, the words knocked out white in the plate
    const z = 1.08 + 0.04 * t;
    const iw = truck.img.naturalWidth, ih = truck.img.naturalHeight, s = Math.max(W / iw, H / ih) * z;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.drawImage(truck.img, W / 2 - iw * s * 0.42, H / 2 - ih * s * 0.5, iw * s, ih * s);
    g.font = `${word.size}px Anton`; g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText('WHO OWNS', W / 2, 520);
    rp.gravure(src, t, { ink: '#161c15', paper: '#efe8d8', cell: 7, levels: [0.07, 0.55, 1.0], sharp: 0.25 });
    ctx.drawImage(rp.canvas, 0, 0);
    // a spot-red overprint on the sun, off register like a second cylinder
    const sx = W / 2 - iw * s * 0.42 + iw * s * 0.49 + 4, sy = H / 2 - ih * s * 0.5 + ih * s * 0.1285 - 3;
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#c3161c'; ctx.beginPath(); ctx.arc(sx, sy, 34 * z, 0, 7); ctx.fill(); ctx.restore();
    return rp.stats;
  };
};

// ---------------------------------------------------------------- SILKSCREEN: a WPA three-ink poster from a photograph
SHOTS.silkscreen = async () => {
  const rp = new Repro(W, H);
  const hard = await L.plate('client_join_banner');
  const src = cv(), g = src.getContext('2d');
  return t => {
    const img = hard.img, iw = img.naturalWidth, ih = img.naturalHeight, s = H / ih * 1.02;
    g.drawImage(img, W / 2 - iw * s * 0.43, 0, iw * s, ih * s);
    rp.silkscreen(src, t, { inks: ['#eadcc0', '#e0a23a', '#b8141b', '#1a1512'], cuts: [0.8, 0.52, 0.2], levels: [0.01, 0.8, 0.8], soft: 6, misreg: 3, boil: 12 });
    ctx.drawImage(rp.canvas, 0, 0);
    return rp.stats;
  };
};

// ---------------------------------------------------------------- PROJECT: the photo becomes a set (2.5D projection)
// The client's trucker: clean plate on a ramp, the cut-out man as a relief card 5 m out. The camera drops, pushes
// and rolls into a Rodchenko low angle while the red sun stays put: real parallax from one still photograph.
SHOTS.project = async () => {
  const pj = new Project(W, H), m = new Montage(W, H);
  const P = await L.plate('client_own_future');
  const out2 = cv();
  return t => {
    const u = Math.min(1, t / 2.5), e = u * u * (3 - 2 * u);
    pj.begin({ fov: 38 - 3 * e, pos: [-0.1 * e, -0.45 * e, -0.9 * e], yaw: -0.03 * e, pitch: 0.05 * e, roll: 0.1 * e }, { haze: ['#1d2426', 0.25], hazeD: 60 });
    pj.plate(P.clean, { horizon: 0.9, near: 9, far: 80, sky: 400, x: -0.82 });
    pj.card(P.cut, { depth: P.depth, box: P.box, size: P.size, z: 6, relief: 0.35 });
    pj.end();
    // a plain colour grade (the photo keeps its red sun): contrast up, dusk lifted, then fine grain
    ctx.filter = 'contrast(1.45) brightness(1.3) saturate(1.35)'; ctx.drawImage(pj.canvas, 0, 0); ctx.filter = 'none';
    return { project: pj.stats };
  };
};

// ---------------------------------------------------------------- WHEATPASTE: the poster on the street
// The KLUTSIS poster and a third-generation TONER flyer, pasted on an exposed-aggregate concrete wall (a 512 px CC0
// gravel swatch quilted to a seamless 1024 tile by tools/imagelib/quilt.py) under a low raking sun. The paper takes
// the wall's relief, wrinkles, glue-wet edges and torn-off patches.
SHOTS.wheatpaste = async () => {
  const wallTex = await L.texture('tex_gravel', 'quilt1024t');
  const klutsis = await SHOTS.klutsis(), toner = await SHOTS.toner();
  const pk = cv(), pt = cv(), m = new Montage(W, H);
  klutsis(1.2, pk.getContext('2d')); toner(1.0, pt.getContext('2d'));     // posters are static: print them once
  pk.getContext('2d').getImageData(0, 0, 1, 1);
  return t => {
    m.begin(t, { paper: 'black' });
    m.wall(wallTex, { tile: 760, tint: '#bdb3a5', light: [-0.9, -0.35], bump: 7, grime: 0.7, posters: [
      { poster: pt, x: 250, y: 720, h: 1150, rot: 0.035, conform: 0.9, tear: 0.2, wet: 0.5, dynamic: false },
      { poster: pk, x: 610, y: 1030, h: 1500, rot: -0.02, conform: 0.8, tear: 0.02, wet: 0.7, dynamic: false },
    ] });
    m.end(ctx, { age: 0, tooth: 0 });
    return m.stats;
  };
};

// ---------------------------------------------------------------- CONSTRUCTOR: superimposition (Lissitzky, 1924)
// One plate, several exposures: a real face (NASA portrait of Eileen Collins, public domain) screened in black through
// a round vignette, graph paper, a compass arc in red, the DSCOVR launch (public domain) overprinted in red, one line
// of type. Overprints are multiply: where two inks meet, they darken, as on press.
SHOTS.constructor = async () => {
  const m = new Montage(W, H);
  const face = await L.image('astronaut_collins'), rocket = await L.image('rocket_dscovr');
  const grid = cv(), g = grid.getContext('2d');
  g.strokeStyle = '#000'; for (let x = 0; x <= W; x += 36) { g.lineWidth = x % 180 === 0 ? 2.2 : 0.9; g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); }
  for (let y = 0; y <= H; y += 36) { g.lineWidth = y % 180 === 0 ? 2.2 : 0.9; g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); }
  const word = fitWords('HUMANS AND AGIs', 980, { face: 'Archivo Black' });
  const type = words('HUMANS AND AGIs', { x: W / 2, y: 1640, size: word.size, face: 'Archivo Black' });
  return t => {
    const ts = twos(t, 12), u = E.out(ts / 0.8);
    m.begin(ts, { paper: 'white', seed: 9 });
    m.ink(grid, { ink: '#6f8fa8', opacity: 0.45, blend: 'multiply', dynamic: false });
    m.shape('ring', { x: 610, y: 720, r: 390, w: 22, ink: 'acp', rough: 1.5, blend: 'multiply' });
    m.shape('disc', { x: 880, y: 1060, r: 120, ink: 'acp', rough: 2, blend: 'multiply' });
    m.cutout(face, { x: 590, y: 700, h: 900, crop: [0.27, 0.0, 0.63, 0.37], treat: 'halftone', cell: 10, angle: 45, levels: 'auto', mid: 0.5, contrast: 0.6,
      edge: 'none', border: 0, shadow: false, alpha: false, blend: 'multiply', vignette: [0.98, 0.35] });
    m.cutout(rocket, { x: 290 - (1 - u) * 60, y: 1150 + (1 - u) * 160, h: 1050, rot: -0.14, crop: [0.36, 0.0, 0.66, 1.0], treat: 'halftone', ink: 'acp',
      cell: 6, angle: 15, levels: [0.1, 0.55, 1.0], contrast: 0.7, edge: 'none', border: 0, shadow: false, alpha: false, blend: 'multiply' });   // the rocket knocked out white from a red slab
    m.ink(type, { ink: '#141414', dynamic: false });
    m.end(ctx, { age: 0.25 });
    return m.stats;
  };
};

SHOTS.debug_rim = async () => {
  const m = new Montage(W, H); const truck = await L.plate('client_own_future');
  return t => { m.begin(t, { paper: 'white' });
    m.cutout(truck.cut, { x: 540, y: 600, h: 700, treat: 'photo', levels: 'auto', rim: { dir: [1, -1], amt: 1, w: 60 }, border: 0, edge: 'none' });
    m.cutout(truck.cut, { x: 540, y: 1400, h: 700, treat: 'photo', levels: 'auto', border: 0, edge: 'none' });
    m.end(ctx); return m.stats; };
};
SHOTS.bench = async () => {
  const m = new Montage(W, H); m.profile = true; const truck = await L.plate('client_own_future');
  const tr = Q.get('treat') || 'halftone', rim = Q.has('rim'), edge = Q.get('edge') || 'scissor';
  return t => { m.begin(t, { paper: 'cream' });
    m.cutout(truck.cut, { alpha: Q.has('noalpha') ? false : undefined, x: 540, y: 960, h: 1300, anchor: [0.5, 0.5], treat: tr, levels: 'auto', border: edge === 'none' ? 0 : 16, edge, shadow: Q.has('noshadow') ? false : undefined, rim: rim ? { dir: [1, -1], ink: 'acp' } : null });
    m.end(ctx); return m.stats; };
};
// ---------------------------------------------------------------- harness
const make = SHOTS[SHOT]; if (!make) throw new Error('no shot ' + SHOT);
const frame = await make();
window.labInfo = { setupMs: Math.round(performance.now() - T0) };
window.renderFrame = t => { const t0 = performance.now(); const stats = frame(t) || {}; const g = out.getContext('2d'); g.getImageData(0, 0, 1, 1); return { ms: Math.round(performance.now() - t0), stats }; };
window.sceneReady = true;
