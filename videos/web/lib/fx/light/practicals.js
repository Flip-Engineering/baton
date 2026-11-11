// LIGHT / practicals: lights you can see in frame, each bundled with everything that makes it read as a source
// (LIGHTING c1, critique L2). A practical is ONE record that becomes:
//   - a three.js light in physical units (candela, inverse-square with Frostbite's windowed falloff), optionally shadowed
//   - the fixture you see: housing + an emissive face whose luminance is the light's own (I / projected area), so the
//     lamp head clips and blooms exactly as hard as the light it throws
//   - its share of the haze: the volume pass marches every practical with `volume` and cuts beams with its shadow map
//   - its envelope: flicker (arc strobe, furnace breathing, a loose connection), on/off, a flash
//   - its jitter for soft shadows when frames are accumulated (the fixture's size is the penumbra)
// Colours come from light/color.js (lamp chromaticities, Planck); intensities from lumens or a temperature.
import * as THREE from 'three';
import { lampRGB, blackbody, candelaFromLumens, luminance } from './color.js';
import { litPatch } from './patch.js';

// kind -> defaults. lumens: lamp output; half: beam half-angle (rad); pen: penumbra (0..1); size: emitting size (m)
export const PRACTICALS = {
  hps:      { color: 'hps', lumens: 48000, half: 1.05, pen: 0.55, size: 0.45, shadow: true, volume: true, flicker: 'mains', head: 'cobra', note: '400 W high-pressure sodium on a mast: the yard at night' },
  // (c2) the fixtures that make POOLS: a full cut-off shoebox (flat glass, no light above ~65 deg from straight down, so
  // the ground falls off fast between poles) and a low wall pack; mount them 6-9 m apart 15-30 m and the floor goes dark
  hpsCutoff:{ color: 'hps', lumens: 28000, half: 0.95, pen: 0.22, size: 0.5, shadow: true, volume: true, flicker: 'mains', head: 'flood', note: '250 W HPS full cut-off shoebox on a 7-9 m pole: a pool with an edge' },
  wallpack: { color: 'hps', lumens: 9500, half: 1.05, pen: 0.3, size: 0.3, shadow: true, volume: true, flicker: 'mains', head: 'work', note: '100 W HPS wall pack over a door, 4-5 m up' },
  lps:      { color: 'lps', lumens: 25000, half: 1.2, pen: 0.7, size: 0.8, shadow: true, volume: true, flicker: 'mains', head: 'cobra', note: 'low-pressure sodium: monochrome orange, no colour at all in the shadows it lights' },
  mercury:  { color: 'mercury', lumens: 20000, half: 1.0, pen: 0.6, size: 0.4, shadow: true, volume: true, flicker: 'mains', head: 'bell', note: '400 W clear mercury: blue-green, no red' },
  metalHalide: { color: 'metalHalide', lumens: 36000, half: 0.5, pen: 0.4, size: 0.5, shadow: true, volume: true, flicker: 'none', head: 'flood', note: 'a stadium-type flood' },
  flood:    { color: 'led', lumens: 30000, half: 0.6, pen: 0.5, size: 0.5, shadow: true, volume: true, flicker: 'none', head: 'flood', note: 'an LED flood on a pole or a crane' },
  work:     { color: 'led', lumens: 9000, half: 0.75, pen: 0.6, size: 0.25, shadow: true, volume: true, flicker: 'none', head: 'work', note: 'a tripod work light' },
  fluorescent: { color: 'fluorescent', lumens: 5200, half: 1.45, pen: 1.0, size: 1.2, shadow: false, volume: false, flicker: 'mains', head: 'batten', note: 'a twin batten (treated as a soft spot)' },
  arc:      { color: 'arc', lumens: 60000, half: 1.45, pen: 1.0, size: 0.03, shadow: true, volume: true, flicker: 'arc', head: 'none', note: 'a welding arc: tiny, blue-white, strobing; it lights the welder, the work and the fume' },
  furnace:  { temp: 1550, area: [0.9, 0.7], half: 1.35, pen: 1.0, shadow: true, volume: true, flicker: 'furnace', head: 'mouth', note: 'a furnace mouth or tap hole: a Planck area source' },
  molten:   { temp: 1700, area: [0.5, 2.0], half: Math.PI, pen: 1.0, shadow: true, volume: true, flicker: 'furnace', head: 'none', note: 'a molten stream or a full ladle (an omni source: cube shadows)' },
  sparks:   { color: 1900, lumens: 0, half: Math.PI, pen: 1, size: 0.3, shadow: false, volume: true, flicker: 'none', head: 'none', note: 'driven by sim2/sparks.js light(): centroid and power of the live sparks' },
  point:    { color: 3200, lumens: 1000, half: Math.PI, pen: 1, size: 0.05, shadow: false, volume: false, flicker: 'none', head: 'none' },
};

const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; };
export const FLICKER = {
  none: () => 1,
  mains: () => 1,                                  // 100/120 Hz is averaged away at any film shutter
  furnace: (t, s) => 0.9 + 0.12 * vnoise(t * 1.3 + s) + 0.05 * vnoise(t * 5.1 + s * 3),
  arc: (t, s) => { const f = Math.floor(t * 30 * 3); return 0.55 + 0.6 * hash(f + s * 17) + 0.25 * vnoise(t * 9 + s); },   // per sub-frame strobe
  loose: (t, s) => (vnoise(t * 14 + s) > 0.32 ? 1 : 0.15),
};

const v3 = a => Array.isArray(a) ? new THREE.Vector3(...a) : a.clone();

export class Practical {
  // spec: { kind, pos, aim (a point) | dir, lumens, color, temp, area, half, pen, size, shadow, volume, flicker, head, on, gain, seed, contact }
  constructor(spec, exposure = 1) {
    const d = PRACTICALS[spec.kind] || PRACTICALS.point;
    const s = this.spec = { ...d, ...spec };
    this.seed = s.seed ?? hash(s.pos[0] * 3.1 + s.pos[2] * 7.7) * 100;
    this.group = new THREE.Group(); this.group.name = 'practical:' + s.kind;
    this.pos = v3(s.pos); this.aim = s.aim ? v3(s.aim) : this.pos.clone().add(v3(s.dir || [0, -1, 0]));
    // colour and intensity (candela, before exposure)
    if (s.temp) {
      const bb = blackbody(s.temp), A = s.area[0] * s.area[1];
      this.rgb = bb.rgb; this.L = bb.Y * (s.radiance ?? 1);                   // cd/m2 of the glowing face
      this.cd = this.L * A;                                                    // on-axis intensity of a lambertian area
    } else {
      this.rgb = lampRGB(s.color);
      this.cd = s.cd ?? candelaFromLumens(s.lumens, Math.min(s.half, Math.PI / 2) + (s.half >= Math.PI ? Math.PI / 2 : 0));
      const A = Math.PI * (s.size / 2) ** 2; this.L = this.cd / Math.max(A, 1e-4);
    }
    const mx = Math.max(...this.rgb); this.col = new THREE.Color(this.rgb[0] / mx, this.rgb[1] / mx, this.rgb[2] / mx);
    this.peak = mx;                                                            // rgb max relative to luminance 1
    const cone = s.half < Math.PI / 2 + 0.01;
    const L = this.light = cone ? new THREE.SpotLight(this.col, 0, s.range ?? 0, Math.min(s.half, Math.PI / 2 - 0.02), s.pen, 2) : new THREE.PointLight(this.col, 0, s.range ?? 0, 2);
    L.position.copy(this.pos); L.userData.practical = this;
    if (L.target) { L.target.position.copy(this.aim); this.group.add(L.target); }
    if (s.shadow) {
      L.castShadow = true; const sz = s.shadowSize ?? (L.isPointLight ? 512 : 1024); L.shadow.mapSize.set(sz, sz);
      L.shadow.bias = s.bias ?? -0.0006; L.shadow.normalBias = s.normalBias ?? 0.03; L.shadow.radius = 2;
      L.shadow.camera.near = s.near ?? 0.1; L.shadow.camera.far = s.far ?? 120;
    }
    this.group.add(L);
    this.fixture(exposure);
    this.setExposure(exposure);
  }
  // the visible lamp: a housing and an emissive face at the light's own luminance
  fixture() {
    const s = this.spec, g = this.group;
    const dark = litPatch(new THREE.MeshStandardMaterial({ color: 0x1b1c1d, roughness: 0.55, metalness: 0.6 }));
    this.faceMat = litPatch(new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.2, metalness: 0, emissive: this.col, emissiveIntensity: 0 }));
    const axis = this.aim.clone().sub(this.pos).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), axis);
    const head = new THREE.Group(); head.position.copy(this.pos); head.quaternion.copy(q);
    const r = (s.size ?? 0.4) / 2;
    if (s.head === 'cobra' || s.head === 'bell' || s.head === 'flood' || s.head === 'work' || s.head === 'batten') {
      const hw = s.head === 'batten' ? [s.size, 0.08, 0.16] : s.head === 'bell' ? null : [r * 2.6, r * 0.7, r * 2.6];
      const housing = hw ? new THREE.Mesh(new THREE.BoxGeometry(...hw), dark) : new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 1.4, r * 1.6, 20, 1, true), dark);
      housing.position.y = hw ? hw[1] / 2 + 0.005 : r * 0.8; housing.castShadow = true; head.add(housing);
      const face = s.head === 'batten' ? new THREE.Mesh(new THREE.BoxGeometry(s.size * 0.95, 0.02, 0.1), this.faceMat) : new THREE.Mesh(new THREE.CircleGeometry(r * (s.head === 'bell' ? 1.3 : 1.0), 24).rotateX(Math.PI / 2), this.faceMat);
      face.position.y = 0.002; head.add(face);
      this.faceArea = s.head === 'batten' ? s.size * 0.1 : Math.PI * (r * (s.head === 'bell' ? 1.3 : 1)) ** 2;
    } else if (s.head === 'mouth') {
      const [w, h] = s.area, face = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(Math.PI / 2), this.faceMat);
      head.add(face); this.faceArea = w * h;
    } else this.faceArea = 0;
    g.add(head); this.head = head;
  }
  setExposure(e) { this.exposure = e; }
  // per sub-frame: envelope (0..1 on/off * flicker) and intensity
  update(t, { on = 1 } = {}) {
    const s = this.spec, f = FLICKER[s.flicker || 'none'](t, this.seed) * on * (s.gain ?? 1);
    this.level = f;
    this.light.intensity = this.cd * this.peak * this.exposure * f;
    if (this.faceArea) this.faceMat.emissiveIntensity = (s.temp ? this.L : this.cd / this.faceArea) * this.peak * this.exposure * f * (s.faceGain ?? 1);
    return f;
  }
  // soft shadows by accumulation: move the light within its emitting size
  jitter(u, v) {
    const s = this.spec, r = (s.temp ? Math.max(...s.area) * 0.5 : (s.size ?? 0.1) / 2) * (s.softness ?? 1);
    const a = 2 * Math.PI * u, rr = Math.sqrt(v) * r;
    const ax = this.aim.clone().sub(this.pos).normalize(), t1 = new THREE.Vector3().crossVectors(ax, Math.abs(ax.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize(), t2 = new THREE.Vector3().crossVectors(ax, t1);
    this.light.position.copy(this.pos).addScaledVector(t1, Math.cos(a) * rr).addScaledVector(t2, Math.sin(a) * rr);
  }
  // the record the volume pass needs (pre-exposed candela as rgb, the cone, the shadow)
  volumeRecord() {
    const L = this.light, c = this.col, I = L.intensity;
    const dir = L.isSpotLight ? L.target.position.clone().sub(L.position).normalize() : new THREE.Vector3(0, -1, 0);
    const cosO = L.isSpotLight ? Math.cos(L.angle) : -2, cosI = L.isSpotLight ? Math.cos(L.angle * (1 - L.penumbra)) : -1;
    return { pos: L.position, col: new THREE.Vector3(c.r * I, c.g * I, c.b * I), dir, cosO, cosI, light: L, shadow: L.castShadow && L.isSpotLight, gain: this.spec.volGain ?? 1 };
  }
}
