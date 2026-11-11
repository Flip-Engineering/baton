// STAGE / frusta (CAMERA7 c4 iteration 2): WHAT THE PORTRAIT CAMERAS SEE OF THE WALL. Pure JS (no three): runs in the page, in node and in the room's test.
//
// A room has a place to sit (room.js `seat`): the stretch of wall behind the sitter that no furniture may stand across, so that a portrait's background is plaster, light and a soft
// gradient (a photograph's wall: e8bafa, a52998, 06ac7a) and not the same bookcase behind every head. Until this iteration the seat was a hand-set 2.0 m half-width and the first measurer
// found it too narrow for the studio's own yawed camera (lab_front yaw=30 sees the wall x -2.87..-1.01: a fifth of the picture was bookcase). The seat is a property of the CAMERAS the studio
// points at a sitter, so it is derived from them: the studio's portrait shots (the face, bust and full-figure cameras of lib/fx/person/export.js shotCamera = labs/human8/lab_person.js place(),
// and a long-lens face), swung round the sitter by every head-to-camera angle the studio's plates use (REFMEASURE's lab_front yaw=20 / 30 / 35, so +-35 degrees: a three-quarter portrait is
// 30-45), their frusta intersected with the wall plane z = -back, widened by the blur disc a wall 3-8 m behind the focal plane makes at the lens' aperture (the defocused edge of a piece of
// furniture reaches that far into the frame). Nothing here is fitted to a plate: change a camera, a yaw envelope or a lens and the seat follows.
//
//   Frame (three's, as stages.js): the sitter stands at the origin facing +z; a camera at azimuth a (degrees, negative = camera left) stands at (d sin a, y, d cos a) and looks at the sitter's axis at
//   height aimY; the wall is the plane z = -back.
//   portraitSeat({ back, shots, yaw, step, lens }) -> { x, half, reach: { <shot>: [x lo, x hi] }, margin, yaw, back }   (metres; x is the seat's axis, 0: the reach is symmetric by construction)
//   wallFootprint(cam, back) -> { x: [lo, hi], y: [lo, hi] } the wall seen by one camera (unbounded sides are +-Infinity)
//   shotCamera7(name, azimuthDeg) -> { pos, at, vfov, aspect } one portrait camera
//   ndc(cam, p) -> { x, y, depth } where a world point lands in the camera's frame (|x|, |y| <= 1 is inside), or null behind the lens
//   parseView('bust-35') -> { shot: 'bust', azimuth: -35 }: the name the room lab and the Cycles job give a portrait view
const D = Math.PI / 180;

// the studio's portrait cameras. d: metres from the sitter's axis to the camera (the face camera of lab_person stands 0.95 m back and 0.28 m to the side: 0.99 m); y: its height; aimY: the height it
// looks at; vfov (degrees) and the plate's aspect (W / H) as export.js SHOTS and lab_person set them; lens: the camera7 lens table's entry whose aperture blurs the wall (camera7.js CAMERA7_LENS)
export const PORTRAIT_SHOTS = {
  face: { d: Math.hypot(0.95, 0.28), y: 1.6, aimY: 1.53, vfov: 24, aspect: 1080 / 1350, lens: 'portrait56', note: 'lab_person face: 0.95 m back, 0.28 m to the side, 24 degrees; lab_front yaw=N turns it round the head' },
  bust: { d: Math.hypot(1.6, 0.35), y: 1.28, aimY: 1.28, vfov: 26, aspect: 1080 / 1350, lens: 'portrait56', note: 'lab_person bust: 1.6 m back, 0.35 m to the side, 26 degrees, centred at 0.75 of the height' },
  full: { d: 5.4, y: 0.88, aimY: 0.88, vfov: 20, aspect: 880 / 1350, lens: 'environmental', note: 'export.js shotCamera full / lab_person solo: the figure framed head to foot, 20 degrees, 5.4 m for a 1.7 m person' },
  tele: { d: 2.5, y: 1.6, aimY: 1.53, vfov: 9.6, aspect: 1080 / 1350, lens: 'portrait56', note: 'REFMEASURE lab_front tele=1: the face framed from 2.5 m on a long lens' },
};
// the head-to-camera angle the studio's plates use (lab_front yaw=20 / 30 / 35): the seat covers the cameras this far round the sitter on either side
export const PORTRAIT_YAW = 35;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a); return a.map(v => v / l); };

export function shotCamera7(name, azimuthDeg = 0, shots = PORTRAIT_SHOTS) {
  const s = shots[name]; if (!s) throw new Error('frusta: no shot ' + name);
  const a = azimuthDeg * D;
  return { name, azimuth: azimuthDeg, pos: [s.d * Math.sin(a), s.y, s.d * Math.cos(a)], at: [0, s.aimY, 0], vfov: s.vfov, aspect: s.aspect, lens: s.lens };
}

// the camera's four corner rays meet the wall plane z = -back: the wall it sees (x and y ranges). A ray that does not travel toward the wall reaches +-Infinity along its horizontal heading.
export function wallFootprint(cam, back) {
  const f = norm(sub(cam.at, cam.pos)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f), th = Math.tan(cam.vfov * D / 2), tw = th * cam.aspect;
  const x = [Infinity, -Infinity], y = [Infinity, -Infinity];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const dir = [f[0] + r[0] * sx * tw + u[0] * sy * th, f[1] + r[1] * sx * tw + u[1] * sy * th, f[2] + r[2] * sx * tw + u[2] * sy * th];
    if (dir[2] < -1e-6) { const t = (-back - cam.pos[2]) / dir[2]; if (t > 0) { const px = cam.pos[0] + dir[0] * t, py = cam.pos[1] + dir[1] * t; x[0] = Math.min(x[0], px); x[1] = Math.max(x[1], px); y[0] = Math.min(y[0], py); y[1] = Math.max(y[1], py); continue; } }
    const sgn = dir[0] >= 0 ? 1 : -1; if (sgn > 0) x[1] = Infinity; else x[0] = -Infinity;
  }
  return { x, y };
}

// where a world point lands in the camera's frame (normalised device coordinates); null when it is behind the lens
export function ndc(cam, p) {
  const f = norm(sub(cam.at, cam.pos)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f), v = sub(p, cam.pos), z = dot(v, f); if (z <= 1e-6) return null;
  const th = Math.tan(cam.vfov * D / 2); return { x: dot(v, r) / z / (th * cam.aspect), y: dot(v, u) / z / th, depth: z };
}
// 'face30' / 'bust-35' / 'full35' / 'tele0' -> { shot, azimuth } (null for any other name)
export function parseView(name, shots = PORTRAIT_SHOTS) { const m = /^([a-z]+)(-?\d+)$/.exec(name || ''); return m && shots[m[1]] ? { shot: m[1], azimuth: +m[2] } : null; }

// the diameter (m) of the blur disc a point on the wall makes: aperture A = focal / fstop, focus s (the camera to the sitter), the wall z behind the lens (thin lens: A (z - f) |z - s| / ((s - f) z))
export function blurOnWall({ focal, fstop }, focus, wallDistance) {
  const f = focal / 1000, A = f / fstop, s = focus, z = wallDistance;
  return A * (z - f) * Math.abs(z - s) / ((s - f) * z);
}

export function portraitSeat({ back = 3.2, shots = PORTRAIT_SHOTS, yaw = PORTRAIT_YAW, step = 1, lenses = null } = {}) {
  const reach = {}; let lo = Infinity, hi = -Infinity, margin = 0;
  for (const name of Object.keys(shots)) {
    let a = Infinity, b = -Infinity;
    for (let az = -yaw; az <= yaw + 1e-9; az += step) {
      const cam = shotCamera7(name, az, shots), F = wallFootprint(cam, back);
      a = Math.min(a, F.x[0]); b = Math.max(b, F.x[1]);
      if (lenses) { const L = lenses[shots[name].lens]; if (L) margin = Math.max(margin, blurOnWall(L, Math.hypot(...sub(cam.at, cam.pos)), cam.pos[2] + back)); }
    }
    reach[name] = [+a.toFixed(3), +b.toFixed(3)]; lo = Math.min(lo, a); hi = Math.max(hi, b);
  }
  const half = Math.max(Math.abs(lo), Math.abs(hi)) + margin;
  // the record carries the cameras it was derived from (plain data), so that the Cycles job builds the very same views from stages.json
  return { x: 0, half: +half.toFixed(2), reach, margin: +margin.toFixed(3), yaw, back, cameras: Object.fromEntries(Object.entries(shots).map(([k, s]) => [k, { d: +s.d.toFixed(4), y: s.y, aimY: s.aimY, vfov: s.vfov, aspect: +s.aspect.toFixed(5), lens: s.lens }])) };
}
