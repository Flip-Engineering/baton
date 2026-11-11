// STAGE / room (CAMERA7 c4 iteration 1): A ROOM OF REAL GEOMETRY. Pure JS (no three): runs in node (labs/human8/camera7_export.mjs packs it for Cycles) and in the page (grounds.js builds the
// engine's meshes from it); the two renderers draw the SAME triangles.
//
// A photograph's room has volumes in it, and what survives the portrait lens (at f/5.6 the blur disc on a wall 3 m behind the head is about 4 cm) is large soft shapes of light and shade
// that are the LIGHT'S: a shelf's interior is dark because it is occluded, a door's panel is lit on one flank and shaded on the other, the wall beside a bookcase is in the case's shadow, a
// curtain's folds shade each other. Until c3 the furniture was painted on the wall (an albedo multiplier, then a baked relief): a picture of a room, not a room. A room is now a list
// of solids (boxes, a pleated cloth, ellipsoids, a turned pot) standing out of the wall in metres, with their own albedos, and nothing in it is shaded by hand: Cycles traces the window's
// light across them (the shelf's interior, the casing's shadow, the books' tops), the engine's key, shadow map and ambient occlusion do what they do to any solid.
//   THE SEAT. A room has a place to sit: the wall within `seat.half` of the seat's axis carries no furniture (a wainscot, being the wall's own, runs through). It is a property of the room,
//   not a composition against one head or one camera: the portrait lenses' frames on the wall (face 1.4 m, bust 1.8 m wide; the camera stands to one side, so a frame is centred 0.7-1 m off
//   the axis) and a square-on camera yawed 20 degrees (the wall behind its head is 1.4 m off-axis) all fall inside half = 2 m; a wider or a more oblique frame sees the furniture at its edge.
//   roomGeometry(seed, { x0, w, h, back, seat: { x, half } }) -> { flat, smooth, items, prims, ... }
//     flat   { p: Float32Array (x y z, three's frame: the wall is the plane z = -back, +z toward the camera, metres), c: Float32Array (linear albedo rgb per vertex), i: Uint32Array (triangles) }:
//            boxes, one vertex per face corner (flat shading)
//     smooth { p, c, i }: the curtain, the leaves, the pot, the vase (shared vertices: smooth shading)
//   Every triangle winds counter-clockwise seen from outside; a box against the wall has no back face.
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function rng(seed) { let a = (seed >>> 0) + 0x6D2B79F5; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// the plaster's mean albedo (linear rgb; assets/stage/plaster_albedo.jpg decoded and averaged; its macro map averages 1 after the x2): the wall's reflectance is wallTint x this
export const PLASTER = [0.520, 0.502, 0.461];

// the things a room is painted with: linear albedos (a paint chart's: nothing saturated, nothing white above 0.6, nothing black below 0.02)
const PAINT = {
  teal: [0.07, 0.19, 0.20], ochre: [0.36, 0.24, 0.06], brick: [0.26, 0.08, 0.055], navy: [0.035, 0.05, 0.15], sage: [0.19, 0.25, 0.14], cream: [0.50, 0.46, 0.37],
  plum: [0.13, 0.05, 0.10], slate: [0.16, 0.20, 0.26], rust: [0.30, 0.11, 0.045], olive: [0.14, 0.15, 0.06], bone: [0.56, 0.54, 0.48], mustard: [0.42, 0.30, 0.05],
};
const WOOD = { dark: [0.075, 0.045, 0.027], mid: [0.17, 0.10, 0.055], pale: [0.34, 0.24, 0.13] };
const NAMES = Object.keys(PAINT);
const Q = Math.sqrt, TAU = Math.PI * 2;

// ---------------------------------------------------------------- the mesh builder
function builder(back) {
  const flat = { p: [], c: [], i: [] }, smooth = { p: [], c: [], i: [] }, prims = [], z0 = -back;
  const vert = (g, x, y, z, rgb) => { g.p.push(x, y, z); g.c.push(rgb[0], rgb[1], rgb[2]); return g.p.length / 3 - 1; };
  const FACES = [[4, 5, 7, 6], [1, 0, 2, 3], [5, 1, 3, 7], [0, 4, 6, 2], [6, 7, 3, 2], [0, 1, 5, 4]];   // +z, -z, +x, -x, +y, -y of a box (corner index = xi + 2 yi + 4 zi), counter-clockwise from outside
  // a box x1..x2, y1..y2 (world metres), d1..d2 out of the wall; `lean`: radians about the bottom-right corner (a book leaning on its neighbour)
  const box = (x1, x2, y1, y2, d1, d2, rgb, { lean = 0 } = {}) => {
    const t0 = flat.i.length / 3, cs = [];
    for (let k = 0; k < 8; k++) { let x = (k & 1) ? x2 : x1, y = (k & 2) ? y2 : y1; const z = z0 + ((k & 4) ? d2 : d1);
      if (lean) { const dx = x - x2, dy = y - y1, cs_ = Math.cos(-lean), sn = Math.sin(-lean); x = x2 + dx * cs_ - dy * sn; y = y1 + dx * sn + dy * cs_; }
      cs.push([x, y, z]); }
    FACES.forEach((f, fi) => { if (fi === 1 && d1 <= 1e-4) return;   // the face against the wall is never seen
      const a = f.map(k => vert(flat, cs[k][0], cs[k][1], cs[k][2], rgb)); flat.i.push(a[0], a[1], a[2], a[0], a[2], a[3]); });
    prims.push({ g: 'flat', t0, t1: flat.i.length / 3, c: [(x1 + x2) / 2, (y1 + y2) / 2, z0 + (d1 + d2) / 2], kind: 'box' });
  };
  // a height field facing +z: depth(x, y) out of the wall over x1..x2, y1..y2 (a curtain's pleats), nx x ny cells
  const grid = (x1, x2, y1, y2, nx, ny, depth, rgb) => {
    const t0 = smooth.i.length / 3, base = smooth.p.length / 3;
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const x = x1 + (x2 - x1) * i / nx, y = y1 + (y2 - y1) * j / ny; vert(smooth, x, y, z0 + depth(x, y), rgb); }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = base + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; smooth.i.push(a, b, d, a, d, c); }
    prims.push({ g: 'smooth', t0, t1: smooth.i.length / 3, c: [(x1 + x2) / 2, (y1 + y2) / 2, z0], kind: 'grid' });
  };
  // an ellipsoid at (cx, cy, depth cd) with radii (rx, ry, rd), turned `pitch` about its x axis (a leaf leaning off the wall) then `rot` about the wall's normal
  const ell = (c, r, rgb, { rot = 0, pitch = 0, nu = 10, nv = 6 } = {}) => {
    const t0 = smooth.i.length / 3, base = smooth.p.length / 3, cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(rot), sr = Math.sin(rot);
    for (let j = 0; j <= nv; j++) { const th = Math.PI * j / nv, st = Math.sin(th), ct = Math.cos(th);
      for (let i = 0; i < nu; i++) { const ph = TAU * i / nu, lx = r[0] * st * Math.cos(ph), ly = r[1] * ct, lz = r[2] * st * Math.sin(ph);
        const y1 = ly * cp - lz * sp, z1 = ly * sp + lz * cp, x2 = lx * cr - y1 * sr, y2 = lx * sr + y1 * cr; vert(smooth, c[0] + x2, c[1] + y2, z0 + c[2] + z1, rgb); } }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const i1 = (i + 1) % nu, a = base + j * nu + i, b = base + j * nu + i1, cc = base + (j + 1) * nu + i1, d = base + (j + 1) * nu + i; smooth.i.push(a, b, cc, a, cc, d); }
    prims.push({ g: 'smooth', t0, t1: smooth.i.length / 3, c: [c[0], c[1], z0 + c[2]], kind: 'ellipsoid' });
  };
  // a turned solid about the vertical axis through (cx, depth cd): profile [[radius, y], ...] from the bottom up (a pot)
  const lathe = (cx, cd, profile, rgb, nu = 28) => {
    const t0 = smooth.i.length / 3, base = smooth.p.length / 3;
    profile.forEach(([r, y]) => { for (let i = 0; i < nu; i++) { const ph = TAU * i / nu; vert(smooth, cx + r * Math.cos(ph), y, z0 + cd + r * Math.sin(ph), rgb); } });
    for (let j = 0; j < profile.length - 1; j++) for (let i = 0; i < nu; i++) { const i1 = (i + 1) % nu, a = base + j * nu + i, b = base + j * nu + i1, c = base + (j + 1) * nu + i1, d = base + (j + 1) * nu + i; smooth.i.push(a, d, c, a, c, b); }
    prims.push({ g: 'smooth', t0, t1: smooth.i.length / 3, c: [cx, 0, z0 + cd], kind: 'lathe', axis: true });
  };
  const done = () => ({ flat: { p: Float32Array.from(flat.p), c: Float32Array.from(flat.c), i: Uint32Array.from(flat.i) }, smooth: { p: Float32Array.from(smooth.p), c: Float32Array.from(smooth.c), i: Uint32Array.from(smooth.i) }, prims });
  return { box, grid, ell, lathe, done };
}

// ---------------------------------------------------------------- the room
export function roomGeometry(seed, { x0 = -6, w = 12, h = 4.2, back = 3.2, seat = { x: 0, half: 2.0 } } = {}) {
  const R = rng(seed), rr = (a, b) => a + (b - a) * R(), pick = arr => arr[Math.floor(R() * arr.length) % arr.length], items = [];
  const { box, grid, ell, lathe, done } = builder(back);
  const scale = (rgb, k) => rgb.map(v => Math.min(0.62, Math.max(0.02, v * k)));
  const mute = (rgb, k = 0.3) => { const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]; return rgb.map(v => v + (y - v) * k); };   // objects in a room are dusty: a third of the way to their own grey
  const BRASS = [0.35, 0.25, 0.07];
  // a dado panel along the whole wall with a cap rail that overhangs it by 2 cm: the wall's own, so it runs through the seat
  const wainscot = () => { const col = pick(['slate', 'sage', 'teal', 'olive']), c = PAINT[col], top = rr(0.85, 1.05);
    box(x0, x0 + w, 0.12, top, 0, 0.012, c); box(x0, x0 + w, top, top + 0.035, 0, 0.034, scale(c, 1.9));
    items.push({ kind: 'wainscot', colour: col, top: +top.toFixed(2) }); return top; };
  // a door in a casing 22 mm proud of the wall; the leaf is set 18 mm behind the casing's face with two raised panels (a step of 8 mm, then 4 more)
  const door = x => { const wd = rr(0.86, 0.98), ht = rr(2.04, 2.14), wood = R() < 0.5, leaf = wood ? pick([WOOD.dark, WOOD.mid]) : PAINT[pick(['bone', 'cream', 'slate', 'sage', 'brick'])], ca = 0.085, cas = scale(wood ? PAINT.bone : leaf, wood ? 0.95 : 1.15);
    box(x - wd / 2 - ca, x - wd / 2, 0, ht + ca, 0, 0.022, cas); box(x + wd / 2, x + wd / 2 + ca, 0, ht + ca, 0, 0.022, cas); box(x - wd / 2, x + wd / 2, ht, ht + ca, 0, 0.022, cas);
    box(x - wd / 2, x + wd / 2, 0, ht, 0, 0.004, leaf);
    for (const [ya, yb] of [[0.12, 0.92], [1.06, 1.92]]) { box(x - wd / 2 + 0.12, x + wd / 2 - 0.12, ya, yb, 0.004, 0.012, leaf); box(x - wd / 2 + 0.14, x + wd / 2 - 0.14, ya + 0.02, yb - 0.02, 0.012, 0.016, leaf); }
    ell([x + wd / 2 - 0.1, 1.0, 0.04], [0.03, 0.03, 0.028], BRASS);
    items.push({ kind: 'door', x: +x.toFixed(2), w: +wd.toFixed(2), wood }); return wd + 0.17; };
  // a framed print: the frame 34 mm out, a mat 18 mm out round a window, the print behind the mat's window with a few blocks of colour on it
  const picture = (x, yc, wd, ht) => { const fr = R() < 0.55 ? scale(WOOD.dark, rr(0.8, 1.4)) : [0.32, 0.23, 0.08], mat = scale(PAINT.bone, rr(0.9, 1.1)), bw = rr(0.025, 0.045), mw = rr(0.04, 0.075);
    const X1 = x - wd / 2, X2 = x + wd / 2, Y1 = yc - ht / 2, Y2 = yc + ht / 2;
    box(X1, X2, Y2 - bw, Y2, 0, 0.034, fr); box(X1, X2, Y1, Y1 + bw, 0, 0.034, fr); box(X1, X1 + bw, Y1 + bw, Y2 - bw, 0, 0.034, fr); box(X2 - bw, X2, Y1 + bw, Y2 - bw, 0, 0.034, fr);
    const ix1 = X1 + bw + mw, ix2 = X2 - bw - mw, iy1 = Y1 + bw + mw, iy2 = Y2 - bw - mw, a = mute(PAINT[pick(NAMES)]), b = mute(PAINT[pick(NAMES)]), c = mute(PAINT[pick(NAMES)]);
    box(X1 + bw, X2 - bw, iy2, Y2 - bw, 0, 0.018, mat); box(X1 + bw, X2 - bw, Y1 + bw, iy1, 0, 0.018, mat); box(X1 + bw, ix1, iy1, iy2, 0, 0.018, mat); box(ix2, X2 - bw, iy1, iy2, 0, 0.018, mat);
    box(ix1, ix2, iy1, iy2, 0, 0.012, a);
    const n = 2 + Math.floor(R() * 3); for (let q = 0; q < n; q++) { const cx = rr(ix1, ix2), cy = rr(iy1, iy2), rx = rr(0.1, 0.45) * (ix2 - ix1), ry = rr(0.1, 0.45) * (iy2 - iy1), col = q & 1 ? b : c;
      box(Math.max(ix1, cx - rx), Math.min(ix2, cx + rx), Math.max(iy1, cy - ry), Math.min(iy2, cy + ry), 0.012, 0.0135, col); }
    items.push({ kind: 'picture', x: +x.toFixed(2), y: +yc.toFixed(2), w: +wd.toFixed(2), h: +ht.toFixed(2) }); };
  const pictures = (x, limit) => { const n = 1 + Math.floor(R() * 3); let cur = x, y = rr(1.35, 1.85);
    for (let q = 0; q < n; q++) { const wd = rr(0.32, 0.85), ht = Math.min(1.1, wd * rr(0.7, 1.45)), dy = rr(-0.12, 0.12), gap = rr(0.12, 0.35); if (cur + wd > limit) break; picture(cur + wd / 2, y + dy, wd, ht); cur += wd + gap; }
    return cur - x; };
  // a bookcase: a carcass D deep (sides, top, plinth and the shelf boards stand D out of the wall), a dark back panel, books standing on the boards against it, each its own depth, now and
  // then one leaning on the gap beside it; a vase on some shelves
  const shelf = x => { const wd = rr(0.95, 1.3), ht = rr(1.9, 2.15), n = 5, D = rr(0.26, 0.34), dark = scale(WOOD.dark, rr(0.8, 1.3)), x1 = x - wd / 2, x2 = x + wd / 2;
    box(x1, x1 + 0.035, 0, ht, 0, D, dark); box(x2 - 0.035, x2, 0, ht, 0, D, dark); box(x1, x2, ht - 0.035, ht, 0, D + 0.012, dark); box(x1 + 0.035, x2 - 0.035, 0, 0.06, 0, D - 0.02, dark);
    box(x1 + 0.035, x2 - 0.035, 0.06, ht - 0.035, 0, 0.012, [0.065, 0.042, 0.027]);
    const pitch = (ht - 0.1) / n;
    for (let s = 0; s < n; s++) { const yb = 0.06 + s * pitch + 0.025, room = pitch - 0.07; let cx = x1 + 0.045;
      box(x1 + 0.035, x2 - 0.035, yb - 0.025, yb, 0, D - 0.008, scale(WOOD.mid, rr(0.8, 1.2)));
      while (cx < x2 - 0.06) { const sw = rr(0.014, 0.05); if (R() < 0.1) { cx += rr(0.04, 0.09); continue; }
        const sh = Math.min(room * 0.96, rr(0.18, 0.32)), col = scale(mute(PAINT[pick(NAMES)], 0.35), rr(0.7, 1.0)), dep = rr(0.15, Math.min(0.25, D - 0.05)), xe = Math.min(cx + sw, x2 - 0.045), gapAfter = R() < 0.08;
        const lean = gapAfter ? rr(0.05, 0.2) : 0; box(cx, xe, yb, yb + sh, 0.012, 0.012 + dep, col, { lean });
        cx = xe + 0.002 + (gapAfter ? Math.max(rr(0.04, 0.09), sh * Math.sin(lean) + 0.012) : 0); }
      if (R() < 0.3) { const ox = x + rr(-0.3, 0.3) * wd, col = scale(PAINT[pick(['bone', 'rust', 'teal', 'cream'])], 1.0); ell([ox, yb + 0.1, 0.1], [0.05, 0.1, 0.05], col, { nu: 14, nv: 8 }); } }
    items.push({ kind: 'bookcase', x: +x.toFixed(2), w: +wd.toFixed(2), h: +ht.toFixed(2), depth: +D.toFixed(2) }); return wd; };
  // a curtain on a rod: a cloth with pleats 3 cm deep (a pitch of 11-17 cm), gathered at the rod, hanging nearly to the floor
  const curtain = x => { const wd = rr(1.0, 1.5), col = PAINT[pick(['sage', 'plum', 'slate', 'rust', 'cream', 'navy', 'ochre'])], pitch = rr(0.11, 0.17), ph = rr(0, 6.28), top = rr(2.7, 3.2);
    const pleat = (xx, yy) => (0.028 + 0.03 * (0.5 + 0.5 * Math.cos((xx - x) / pitch * TAU + ph + 0.6 * Math.sin((xx - x) * 3.1 + ph)))) * (0.35 + 0.65 * sm(top, top - 0.35, yy));
    grid(x - wd / 2, x + wd / 2, 0.12, top, Math.ceil(wd / 0.012), 28, pleat, col);
    box(x - wd / 2 - 0.1, x + wd / 2 + 0.1, top, top + 0.045, 0, 0.07, scale(WOOD.dark, 1.2));
    items.push({ kind: 'curtain', x: +x.toFixed(2), w: +wd.toFixed(2) }); return wd + 0.2; };
  // a plant in a pot: a turned pot, soil, and leaves (thin ellipsoids standing off the wall at their own angles, 3 cm to 30 cm out)
  const plant = x => { const spread = rr(0.28, 0.42), top = rr(1.0, 1.55), pot = R() < 0.6 ? [0.27, 0.105, 0.065] : scale(PAINT.bone, 0.9);
    lathe(x, 0.17, [[0.085, 0], [0.105, 0.02], [0.15, 0.29], [0.165, 0.30], [0.158, 0.31]], pot);
    ell([x, 0.295, 0.17], [0.15, 0.02, 0.15], [0.04, 0.03, 0.022], { nu: 14, nv: 4 });
    const nl = 36; for (let q = 0; q < nl; q++) { const cy = 0.4 + (top - 0.4) * Math.pow(R(), 0.8), cx = x + (R() + R() - 1) * spread * (0.4 + 0.9 * Math.sin(Math.PI * Math.min(1, (cy - 0.3) / (top - 0.3)))), g = rr(0.55, 1.35), rx = rr(0.03, 0.06), ry = rr(0.07, 0.14);
      ell([cx, cy, rr(0.08, 0.30)], [rx, ry, 0.006], [0.045 * g, 0.15 * g, 0.04 * g], { rot: rr(-0.9, 0.9), pitch: rr(-0.7, 0.7), nu: 8, nv: 4 }); }
    items.push({ kind: 'plant', x: +x.toFixed(2), h: +top.toFixed(2) }); return spread * 2 + 0.2; };
  // ---- the layout: a wainscot on some walls, then objects left to right with gaps, none repeated twice in a row, none across the seat
  if (R() < 0.35) wainscot();
  const pool = ['door', 'pictures', 'bookcase', 'curtain', 'plant', 'pictures', 'door', 'bookcase', 'plant'], draw = { door, pictures, bookcase: shelf, curtain, plant };
  const maxW = { door: 1.2, pictures: 1.0, bookcase: 1.4, curtain: 1.8, plant: 1.15 }, zone = seat ? [seat.x - seat.half, seat.x + seat.half] : null;
  let cursor = x0 + 0.6 + rr(0, 0.9), last = '';
  while (cursor < x0 + w - 0.9) {
    let k = pick(pool); for (let t = 0; t < 4 && k === last; t++) k = pick(pool); last = k;
    if (zone && cursor + maxW[k] > zone[0] && cursor < zone[1] && !(k === 'pictures' && cursor < zone[0] - 0.4)) { cursor = zone[1] + rr(0.2, 0.7); last = ''; continue; }   // the seat: nothing stands across it
    const widthGuess = { door: 1.15, pictures: 1.4, bookcase: 1.2, curtain: 1.5, plant: 0.9 }[k], x = k === 'pictures' ? cursor : cursor + widthGuess / 2;
    const used = k === 'pictures' ? pictures(x, zone && cursor < zone[0] ? zone[0] : Infinity) : draw[k](x); cursor += Math.max(used, k === 'pictures' ? 0.5 : widthGuess) + rr(0.5, 1.7);
  }
  const G = done();
  return { ...G, x0, w, h, back, seat: seat ? { ...seat } : null, seed, items };
}

// the bounding box of every triangle in the room's x range (metres), for the notes and the tests
export function roomExtent(room) { const o = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], d: [Infinity, -Infinity] };
  for (const g of [room.flat, room.smooth]) for (let i = 0; i < g.p.length; i += 3) { o.x[0] = Math.min(o.x[0], g.p[i]); o.x[1] = Math.max(o.x[1], g.p[i]); o.y[0] = Math.min(o.y[0], g.p[i + 1]); o.y[1] = Math.max(o.y[1], g.p[i + 1]); o.d[0] = Math.min(o.d[0], g.p[i + 2] + room.back); o.d[1] = Math.max(o.d[1], g.p[i + 2] + room.back); }
  return o; }
