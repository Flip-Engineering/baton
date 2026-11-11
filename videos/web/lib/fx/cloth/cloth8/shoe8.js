// CLOTH8 c9 it3 (16 Oct): THE SHOES AND THE GROUND as colliders for the cloth that rests on them (a trouser hem on the shoe; a hem that
// reaches the floor). Shared by lay8 (at rest) and pose8 (the shoes posed with the feet at every key).
//   shoeGap(g, h)  the contact distance of a garment `g` (fabric half thickness h / 2) on a RIGID body with sharp corners (a shoe's collar,
//                  its heel counter, the laces): a particle contact keeps the cloth's particles off it, not its edges and faces. A corner C
//                  reaches an edge AB of length e only if |AC| + |CB| = e, so only if it comes within e / 2 of one end: at half the cloth's
//                  own mean edge (its pattern lengths: the cloth's resolution) no corner of the shoe passes between two neighbouring
//                  particles. (At 2.5 mm, lay8 rev 2's contact distance, the heel counter's top edge cut through L03's settled hems: 32 + 39
//                  triangles through the uppers at rest; and a hem carried through the shoe at the stance is Self6's tangle.)
//   ground(y, cx, cz) the floor the person stands on (the soles' lowest point), a plane tessellated every 4 cm round the feet (the contact
//                  finds a face through its vertices), normals up
// Pure JS. The same rule for every garment and person.
import { SurfaceMesh } from '../collide.js';
export const SHOE8 = { min: 0.0025, edge: 0.5, groundHalf: 0.7, groundStep: 0.04 };
export function meanEdge(g) { let s = 0, c = 0; for (let t = 0; t < g.T.length; t += 3) for (let k = 0; k < 3; k++) { const i = g.T[t + k], j = g.T[t + (k + 1) % 3], d = Math.hypot(g.uv[i * 2] - g.uv[j * 2], g.uv[i * 2 + 1] - g.uv[j * 2 + 1]); if (d > 0) { s += d; c++; } } return c ? s / c : 0; }
export function shoeGap(g, h, { min = SHOE8.min, edge = SHOE8.edge } = {}) { return Math.max(min, edge * (g.uv ? meanEdge(g) : 0)) + h / 2; }
export function ground(y, cx, cz, { half = SHOE8.groundHalf, step = SHOE8.groundStep } = {}) {
  const n = Math.round(2 * half / step) + 1, X = new Float64Array(n * n * 3), T = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const k = (i * n + j) * 3; X[k] = cx - half + i * step; X[k + 1] = y; X[k + 2] = cz - half + j * step; }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++) { const a = i * n + j, b = (i + 1) * n + j, c = (i + 1) * n + j + 1, d = i * n + j + 1; T.push(a, d, c, a, c, b); }
  return new SurfaceMesh(X, Int32Array.from(T), { cell: 0.05 }); }
