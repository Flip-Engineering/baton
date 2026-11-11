// OBJECTIVE / switch (Oct 2026; the series engine): an optical element entering or leaving the light path, seen the way the lens sees it:
// a straight edge blurred by the bench's own defocus for wherever the element sits (bench.js cocPx), never a fixed feather, a beam or a
// wipe pattern. The blurred edge of a uniform disc (the out-of-focus image of an edge through a round aperture) is the exact coverage:
//   discEdge(x, R) = 0.5 + (x sqrt(R^2 - x^2) + R^2 asin(x/R)) / (pi R^2)     (x: px from the edge into the element, R: blur radius)
//
//   const sl = new Slide({ t0: 17.14, t1: 18.0, from: 1120, to: -40, axis: [1, 0], blurPx: 60, element: 'below' });
//   sl.amount(t, x, y)  -> 0..1, how much of the element is in the path at that pixel (1 = fully in)
//   SWITCH_GLSL: float discEdge(float x, float R) for shaders, the same function.
// axis: the screen direction (px, y down) the edge's position is measured along; element: 'below' = the element is where
// dot(p, axis) < edge, 'above' = where it is greater. A motorised slide eases in and out (half a cosine) over t0..t1.
export function discEdge(x, R) {
  if (R <= 1e-6) return x >= 0 ? 1 : 0;
  if (x <= -R) return 0; if (x >= R) return 1;
  return 0.5 + (x * Math.sqrt(R * R - x * x) + R * R * Math.asin(x / R)) / (Math.PI * R * R);
}
export const easeSlide = u => u <= 0 ? 0 : u >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * u);

export class Slide {
  constructor({ t0, t1, from, to, axis = [1, 0], blurPx = 60, element = 'below', ease = easeSlide } = {}) {
    const l = Math.hypot(axis[0], axis[1]) || 1; Object.assign(this, { t0, t1, from, to, axis: [axis[0] / l, axis[1] / l], blurPx, element, ease });
  }
  edge(t) { const u = this.ease((t - this.t0) / Math.max(1e-6, this.t1 - this.t0)); return this.from + (this.to - this.from) * u; }
  // x, y in px; returns the fraction of the element covering that pixel's view (its blur disc)
  amount(t, x, y) { const c = x * this.axis[0] + y * this.axis[1], e = this.edge(t), s = this.element === 'below' ? e - c : c - e; return discEdge(s, this.blurPx / 2); }
  moving(t) { return t > this.t0 && t < this.t1; }
  // what a shader needs: vec4(axis.x, axis.y, edge, sign) and the blur radius
  uniform(t) { return [this.axis[0], this.axis[1], this.edge(t), this.element === 'below' ? 1 : -1, this.blurPx / 2]; }
}
export const SWITCH_GLSL = /* glsl */`
float discEdge(float x, float R){
  if (R <= 1e-6) return x >= 0.0 ? 1.0 : 0.0;
  if (x <= -R) return 0.0; if (x >= R) return 1.0;
  return 0.5 + (x * sqrt(R * R - x * x) + R * R * asin(x / R)) / (3.14159265 * R * R);
}
// sw: axis.xy, edge, sign (+1: element below the edge); R: blur radius; p: pixel (y down)
float slideAmount(vec4 sw, float R, vec2 p){ float c = dot(p, sw.xy); return discEdge(sw.w * (sw.z - c), R); }
`;
