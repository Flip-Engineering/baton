// OBJECTIVE / bench (Oct 2026; the series engine, research/series/instrument/BIBLE.md section 8): the instrument bench in SI units. A thin-lens
// camera with the numbers a macro photographer works with (focal length, f-number, magnification, focus distance) and what they give:
// depth of field, the blur circle of anything off the focal plane, the Airy disc, pixels per millimetre at the subject. Every shot of the
// series is one of these; switch.js reads its real defocus for an element crossing the path. Pure JS (node checks it).
//
//   const b = new Bench({ focal: 0.100, fstop: 16, field: 26e-3 });   // a 100 mm macro at f/16, a 26 mm field: 0.9x, focused at 211 mm
//   b.cocPx(z)   blur circle (px) of a point z metres from the lens        b.dof()   { near, far, total } (m)
//   b.airyPx()   diffraction blur (px)                                      b.distanceForBlur(px, 'near' | 'far')
//   b.setField(15e-3)  a macro push: the camera moves in and refocuses (m 0.9 -> 1.56)
export const SODIUM_D = 589.3e-9;

export class Bench {
  constructor({ focal = 0.100, fstop = 16, field = 26e-3, sensorW = 23.4e-3, W = 1080, H = 1920, coc = 0.03e-3, lambda = SODIUM_D } = {}) {
    Object.assign(this, { focal, fstop, sensorW, W, H, coc, lambda });
    this.setField(field);
  }
  // the field (object-side width at the focal plane) sets the magnification; the focus distance follows from the thin lens
  setField(field) { this.field = field; this.mag = this.sensorW / field; this.u = this.focal * (1 + 1 / this.mag); this.v = this.focal * (1 + this.mag); return this; }
  focusTo(u) { this.u = u; this.v = 1 / (1 / this.focal - 1 / u); this.mag = this.v / u; this.field = this.sensorW / this.mag; return this; }
  get aperture() { return this.focal / this.fstop; }                                   // entrance pupil diameter (m)
  get fieldH() { return this.field * this.H / this.W; }
  pxPerMm() { return this.W / (this.field * 1e3); }                                    // at the subject
  pxPerSensorM() { return this.W / this.sensorW; }
  // blur circle diameter on the sensor (m) for a point at distance z (m) from the lens
  cocSensor(z) { const vz = 1 / (1 / this.focal - 1 / z); return this.aperture * Math.abs(vz - this.v) / vz; }
  cocPx(z) { return this.cocSensor(z) * this.pxPerSensorM(); }
  // the blur circle as seen at the subject's scale (m): a point dz in front (+) or behind (-) the focal plane
  cocAt(dz) { return this.cocSensor(this.u - dz); }
  dof(c = this.coc) {
    const solve = (lo, hi, nearSide) => { for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2, cc = this.cocSensor(m); if ((cc > c) === nearSide) lo = m; else hi = m; } return (lo + hi) / 2; };
    const near = solve(this.focal * 1.0001, this.u, true), far = solve(this.u, this.u * 50, false);
    return { near, far, total: far - near };
  }
  airySensor() { return 2.44 * this.lambda * this.fstop * (1 + this.mag); }           // Airy disc diameter at the working f-number
  airyPx() { return this.airySensor() * this.pxPerSensorM(); }
  // where (m from the lens) a point blurs to px: on the near side (between the lens and the subject) or the far side
  distanceForBlur(px, side = 'near') {
    let lo = side === 'near' ? this.focal * 1.0001 : this.u, hi = side === 'near' ? this.u : this.u * 1e4;
    for (let i = 0; i < 200; i++) { const m = side === 'near' ? (lo + hi) / 2 : Math.sqrt(lo * hi), b = this.cocPx(m);
      if (side === 'near') { if (b > px) lo = m; else hi = m; } else { if (b < px) lo = m; else hi = m; } }
    return side === 'near' ? (lo + hi) / 2 : Math.sqrt(lo * hi);
  }
  // what a shader needs: the half-extent of the focal plane (m), the aperture radius, the focus distance
  lens() { return { u: this.u, halfW: this.field / 2, halfH: this.fieldH / 2, apR: this.aperture / 2, mag: this.mag, fstop: this.fstop, focal: this.focal }; }
  // a three.js-style vertical field of view (deg) for a pinhole at the lens with the same framing at the focal plane
  fovY() { return 2 * Math.atan(this.fieldH / 2 / this.u) * 180 / Math.PI; }
  // exposure: EV100 from f-number, shutter, ISO; the 180-degree shutter at 30 fps is 1/60 s
  static ev100(N, t, iso = 100) { return Math.log2(N * N / t * 100 / iso); }
  describe() { const d = this.dof(); return `${(this.focal * 1e3).toFixed(0)} mm f/${this.fstop} at ${this.mag.toFixed(2)}x, field ${(this.field * 1e3).toFixed(1)} mm, ` +
    `focus ${(this.u * 1e3).toFixed(1)} mm, DOF ${(d.total * 1e3).toFixed(2)} mm, Airy ${this.airyPx().toFixed(1)} px`; }
}
