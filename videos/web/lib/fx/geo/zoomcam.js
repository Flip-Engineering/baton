// ZOOMCAM (CIVILIZATION c17, 2 Oct): one orthographic sphere seen from anywhere, so a shot can go from the whole world to a street without
// a cut or a map-projection morph. The camera is a centre (lon, lat), a roll, a radius R in px per radian and a screen anchor (ax, ay).
// Zoom R from about 700 (the whole globe) to 3e6 (a few kilometres across the frame) on the same projection; d3 keeps the precision.
//
//   const V = view({ lon, lat, roll, R, ax, ay });   // V.pt([lon, lat], alt = 1) -> [x, y, visible, z]; V.path(geo) -> Path2D; V.arc(a, b, o); V.mpp
//   const cam = makeCam([{ b: 0, lon, lat, R, ax, ay, roll, stop?, mode? }, ...]);  cam(beat) -> a camera (Hermite path, zero velocity at `stop` keys;
//        a key with mode: 'dive' arrives at its centre early while R eases in log space, mode: 'lag' leaves the old centre late: a zoom in / out)
//   camOnArc(a, b, { span, ay })                     // a camera that stands the arc a -> b upright on screen (a on top), centred between them
// Swap the land data by radius yourself (50 m land to R 7000, 10 m land to R 5e4, then a local shoreline): see scenes/civ.geo.js and civ.draw.js drawGround.
import { geoOrthographic, geoPath, geoRotation, geoInterpolate, geoDistance } from 'd3-geo';
import { W as FW, H as FH, clamp, lerp } from '../../kit.js';
const D2R = Math.PI / 180;
export const v3 = ([lo, la]) => { const l = lo * D2R, p = la * D2R; return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)]; };

// ---------------------------------------------------------------- the camera
export function view(cam) {
  const rot = [-cam.lon, -cam.lat, cam.roll || 0], f = geoRotation(rot);
  const ex = v3(f([90, 0])), ey = v3(f([0, 90])), ez = v3(f([0, 0]));
  const M = [ex[0], ey[0], ez[0], ex[1], ey[1], ez[1], ex[2], ey[2], ez[2]];
  const proj = geoOrthographic().rotate(rot).scale(cam.R).translate([cam.ax, cam.ay]).clipAngle(90).precision(0.7)
    .clipExtent([[-80, -80], [FW + 80, FH + 80]]);
  const gp = geoPath(proj);
  const V = {
    cam, proj,
    // [x, y, visible, z] of a lon/lat lifted to altitude alt (1 = on the surface)
    pt(ll, alt = 1) {
      const v = v3(ll), x = M[0] * v[0] + M[1] * v[1] + M[2] * v[2], y = M[3] * v[0] + M[4] * v[1] + M[5] * v[2], z = M[6] * v[0] + M[7] * v[1] + M[8] * v[2];
      const r = cam.R * alt;
      return [cam.ax + x * r, cam.ay - y * r, z > 0 || (x * x + y * y) * alt * alt > 1, z];
    },
    path(geo) { return new Path2D(gp(geo) || ''); },
    // metres per pixel at the centre
    mpp: 6371000 / cam.R,
    // the screen points of a great-circle arc from a to b lifted at its middle, between u0 and u1 (0..1)
    arc(a, b, { h = null, n = 56, u0 = 0, u1 = 1 } = {}) {
      const ip = geoInterpolate(a, b), d = geoDistance(a, b), hh = h ?? (0.03 + 0.09 * d), out = [];
      for (let k = 0; k <= n; k++) { const s = lerp(u0, u1, k / n), p = V.pt(ip(s), 1 + hh * Math.sin(Math.PI * s)); out.push([p[0], p[1], p[2], s]); }
      return out;
    },
    arcPoint(a, b, s, h = null) { const ip = geoInterpolate(a, b), d = geoDistance(a, b), hh = h ?? (0.03 + 0.09 * d); return V.pt(ip(s), 1 + hh * Math.sin(Math.PI * s)); },
  };
  return V;
}

// the roll that stands the arc a -> b upright on screen (a on top), with the camera centred between them; returns a camera
export function camOnArc(a, b, { R = null, ay = 1120, ax = 540, span = 1000, shift = 0.0 } = {}) {
  const ip = geoInterpolate(a, b), c = ip(0.5 + shift), d = geoDistance(a, b);
  const R0 = R ?? span / (2 * Math.sin(d / 2));
  const mk = roll => ({ lon: c[0], lat: c[1], roll, R: R0, ax, ay });
  const ang = roll => { const V = view(mk(roll)), pa = V.pt(a), pb = V.pt(b); return Math.atan2(pb[1] - pa[1], pb[0] - pa[0]); };
  let best = 0, bd = 9;                                               // a is above b: the vector a -> b points down (+y): angle = +90 deg
  for (let r = -180; r < 180; r += 2) { const dd = Math.abs(((ang(r) - Math.PI / 2 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI); if (dd < bd) { bd = dd; best = r; } }
  for (let r = best - 2; r <= best + 2; r += 0.1) { const dd = Math.abs(((ang(r) - Math.PI / 2 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI); if (dd < bd) { bd = dd; best = r; } }
  return mk(best);
}

// ---------------------------------------------------------------- keyframes: a smooth path through [beat, cam] keys
// Centripetal-free cardinal spline on (lon, lat, ln R, roll, ax, ay): continuous velocity, so the camera never stops dead between shots.
// A key with `stop: true` has zero velocity there (a held frame); `ease` on a key shapes the segment that ENDS at it ('in' | 'out' | 'inout').
export function makeCam(keys) {
  const K = keys.map(k => ({ ...k }));
  // unwrap longitudes and rolls so the path is continuous
  for (let i = 1; i < K.length; i++) {
    while (K[i].lon - K[i - 1].lon > 180) K[i].lon -= 360; while (K[i].lon - K[i - 1].lon < -180) K[i].lon += 360;
    const r0 = K[i - 1].roll || 0; let r1 = K[i].roll || 0; while (r1 - r0 > 180) r1 -= 360; while (r1 - r0 < -180) r1 += 360; K[i].roll = r1;
  }
  K[0].roll = K[0].roll || 0;
  const vec = k => [k.lon, k.lat, Math.log(k.R), k.roll || 0, k.ax, k.ay];
  K.forEach(k => { k.v = vec(k); });
  // tangents (per beat): finite differences over the neighbours, zero at stops
  K.forEach((k, i) => {
    if (k.stop || i === 0 || i === K.length - 1) { k.m = k.v.map(() => 0); if (!k.stop && K.length > 1) { const o = i === 0 ? K[1] : K[i - 1], dt = Math.abs(o.b - k.b); k.m = k.v.map((x, j) => (i === 0 ? o.v[j] - x : x - o.v[j]) / dt); } return; }
    const p = K[i - 1], n = K[i + 1], dt = n.b - p.b;
    k.m = k.v.map((x, j) => (n.v[j] - p.v[j]) / dt * (k.tension ?? 1));
  });
  return beat => {
    let i = 0; while (i < K.length - 2 && beat >= K[i + 1].b) i++;
    const a = K[i], b = K[i + 1], dt = b.b - a.b, u = clamp((beat - a.b) / dt), u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    let out = a.v.map((x, j) => h00 * x + h10 * dt * a.m[j] + h01 * b.v[j] + h11 * dt * b.m[j]);
    if (b.mode) {                                    // a zoom: R eases in log space; the centre arrives early ('dive') or leaves late ('lag')
      const e = h01, pu = b.mode === 'dive' ? 1 - Math.pow(1 - u, 9) : Math.pow(u, 8);
      out = a.v.map((x, j) => j === 2 ? x + (b.v[2] - x) * e : x + (b.v[j] - x) * pu);
    }
    return { lon: out[0], lat: clamp(out[1], -89, 89), R: Math.exp(out[2]), roll: out[3], ax: out[4], ay: out[5] };
  };
}
