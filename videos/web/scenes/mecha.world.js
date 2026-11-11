// MECHA PROLETARIAT (mecha): the world. Cel materials (a three-step toon ramp + object-space panel lines), baked
// canvas textures, the machine (a ~95 m hard-surface humanoid with a posable rig: helmet with the three-bar ≡ visor,
// the ☭ gear reactor window, hatches, tread-plate soles), and its worlds: the night assembly hangar, the apron in
// morning light (rail spur, flatcars, the colossal sledge), and the sets inside the machine (the engine-room tiers,
// the cockpit, the shin truck column, the knuckle tool racks).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../lib/kit.js';

export const COL = { red: '#C91F37', redDk: '#8E1426', cream: '#F4E6D0', gun: '#3A3434', gunDk: '#1E1B1C', teal: '#0F2A2C',
  amber: '#FFB54A', gold: '#FFE9CF', green: '#22D35E', hazard: '#E8B21A', steel: '#6E7072', concrete: '#8C8984' };

// ---------------------------------------------------------------- canvas helpers
export function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function texOf(c, { srgb = true, repeat = true, nearest = false } = {}) {
  const t = new THREE.CanvasTexture(c); if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (nearest) t.magFilter = THREE.NearestFilter; return t;
}
function grime(g, w, h, r, n, a = 0.12) {
  for (let i = 0; i < n; i++) { const x = r() * w, y = r() * h, rr = 6 + r() * 60, gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, `rgba(30,20,15,${a * r()})`); gr.addColorStop(1, 'rgba(30,20,15,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
}

// The panel sheet: seams, bolt rows, access panels, a few stencils. White ground (it multiplies the albedo).
// One tile = 8 m of armor.
function panelSheet() {
  const S = 1024, [c, g] = cv(S, S), r = rng(19);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  // a recursive split into panels
  const rects = [];
  const split = (x, y, w, h, d) => {
    if (d > 3 || (w < 300 && h < 300) || (d > 1 && r() < 0.3)) { rects.push([x, y, w, h]); return; }
    if (w > h) { const k = Math.round(w * (0.3 + r() * 0.4)); split(x, y, k, h, d + 1); split(x + k, y, w - k, h, d + 1); }
    else { const k = Math.round(h * (0.3 + r() * 0.4)); split(x, y, w, k, d + 1); split(x, y + k, w, h - k, d + 1); }
  };
  split(0, 0, S, S, 0);
  for (const [x, y, w, h] of rects) {
    g.fillStyle = `rgba(0,0,0,${0.02 + r() * 0.05})`; g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(20,14,14,0.85)'; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.5; g.strokeRect(x + 5, y + 5, w - 10, h - 10);
    if (r() < 0.5) {                                   // bolt rows
      g.fillStyle = 'rgba(25,18,18,0.7)'; const nb = Math.floor(w / 42);
      for (let i = 1; i < nb; i++) { g.beginPath(); g.arc(x + i * w / nb, y + 12, 3.5, 0, 7); g.arc(x + i * w / nb, y + h - 12, 3.5, 0, 7); g.fill(); }
    }
    if (r() < 0.16 && w > 150 && h > 110) {            // an access hatch
      const hw = w * 0.45, hh = h * 0.35, hx = x + (w - hw) / 2, hy = y + (h - hh) / 2;
      g.strokeStyle = 'rgba(20,14,14,0.9)'; g.lineWidth = 2.5; g.beginPath(); g.roundRect(hx, hy, hw, hh, 10); g.stroke();
      g.fillStyle = 'rgba(20,14,14,0.6)'; g.fillRect(hx + hw - 26, hy + hh / 2 - 6, 16, 12);
    }
    if (r() < 0.08 && w > 200) {                        // a stencil
      g.fillStyle = 'rgba(20,14,14,0.55)'; g.font = `700 ${22 + Math.floor(r() * 12)}px "Chakra Petch"`;
      g.fillText(['NO STEP', 'MP-01', 'HYD 3000', 'LIFT PT', 'ACP-01', 'DANGER HV'][Math.floor(r() * 6)], x + 18, y + 40);
    }
  }
  grime(g, S, S, r, 90, 0.10);
  return texOf(c, { srgb: false });
}

// diamond tread plate (soles, deck plates)
function treadSheet() {
  const S = 256, [c, g] = cv(S, S);
  g.fillStyle = '#b8b8b8'; g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 32) for (let x = 0; x < S; x += 32) {
    const o = (y / 32) % 2 ? 16 : 0; g.save(); g.translate(x + o + 8, y + 16); g.rotate((y / 32) % 2 ? 0.8 : -0.8);
    g.fillStyle = '#e8e8e8'; g.fillRect(-11, -3, 22, 6); g.fillStyle = '#707070'; g.fillRect(-11, 2, 22, 2); g.restore();
  }
  return texOf(c, { srgb: false });
}

// concrete floor: slabs, expansion joints, stains, painted lanes (tile = 16 m)
function concreteSheet(paint = true) {
  const S = 1024, [c, g] = cv(S, S), r = rng(5);
  g.fillStyle = '#d8d4cc'; g.fillRect(0, 0, S, S);
  const id = g.getImageData(0, 0, S, S), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 22; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(id, 0, 0);
  grime(g, S, S, r, 70, 0.12);
  g.strokeStyle = 'rgba(40,36,32,0.8)'; g.lineWidth = 3;
  for (let k = 0; k <= S; k += 256) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, S); g.moveTo(0, k); g.lineTo(S, k); g.stroke(); }
  if (paint) { g.fillStyle = 'rgba(232,178,26,0.9)'; g.fillRect(120, 0, 14, S); g.fillRect(890, 0, 14, S); }
  return texOf(c, { srgb: true });
}

// corrugated wall
function wallSheet() {
  const S = 512, [c, g] = cv(S, S), r = rng(8);
  for (let x = 0; x < S; x += 16) { const v = 150 + 30 * Math.sin(x / 16 * Math.PI); g.fillStyle = `rgb(${v},${v + 4},${v + 6})`; g.fillRect(x, 0, 16, S); }
  grime(g, S, S, r, 40, 0.2);
  g.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < S; y += 128) g.fillRect(0, y, S, 4);
  return texOf(c, { srgb: true });
}

// analog gauges and lamp panel for the cockpit (no screens)
export function gaugeSheet() {
  const [c, g] = cv(1024, 512), r = rng(3);
  g.fillStyle = '#26221f'; g.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 12; i++) {
    const x = 90 + (i % 6) * 170, y = 120 + Math.floor(i / 6) * 260, R = 66;
    g.fillStyle = '#0d0b0a'; g.beginPath(); g.arc(x, y, R + 12, 0, 7); g.fill();
    g.fillStyle = '#efe4c8'; g.beginPath(); g.arc(x, y, R, 0, 7); g.fill();
    g.strokeStyle = '#1a1512'; g.lineWidth = 3;
    for (let k = 0; k <= 10; k++) { const a = Math.PI * (0.75 + 1.5 * k / 10); g.beginPath(); g.moveTo(x + Math.cos(a) * R * 0.78, y + Math.sin(a) * R * 0.78); g.lineTo(x + Math.cos(a) * R * 0.95, y + Math.sin(a) * R * 0.95); g.stroke(); }
    g.strokeStyle = '#c91f37'; g.lineWidth = 7; g.beginPath(); g.arc(x, y, R * 0.86, Math.PI * 2.0, Math.PI * 2.25); g.stroke();
    const a = Math.PI * (0.75 + 1.5 * (0.3 + r() * 0.6)); g.strokeStyle = '#111'; g.lineWidth = 4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * R * 0.8, y + Math.sin(a) * R * 0.8); g.stroke();
    g.fillStyle = '#1a1512'; g.font = '700 18px "Chakra Petch"'; g.textAlign = 'center'; g.fillText(['PSI', 'RPM', 'AMP', 'TEMP', 'HYD', 'OIL'][i % 6], x, y + 34);
  }
  for (let i = 0; i < 14; i++) { g.fillStyle = '#3a3230'; g.fillRect(40 + i * 70, 470, 40, 26); }
  return texOf(c, { repeat: false });
}

// a license plate: state name, number, a plate-maker's frame
export function plateTex(state, num, bg = '#f4f1ea', fg = '#1a2a6a') {
  const [c, g] = cv(256, 128);
  g.fillStyle = bg; g.fillRect(0, 0, 256, 128); g.strokeStyle = '#333'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 122);
  g.fillStyle = fg; g.textAlign = 'center'; g.font = '700 24px "Chakra Petch"'; g.fillText(state, 128, 32);
  g.font = '700 58px "Chakra Petch"'; g.fillText(num, 128, 98);
  return texOf(c, { repeat: false });
}
// a strip of tape with an owner's name in paint marker
export function nameTex(name, tape = '#e9e3cf') {
  const [c, g] = cv(512, 128), r = rng(name.length * 7);
  g.fillStyle = tape; g.beginPath(); g.moveTo(6, 10); g.lineTo(506, 4); g.lineTo(500, 122); g.lineTo(2, 118); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.08)'; for (let i = 0; i < 30; i++) g.fillRect(r() * 512, r() * 128, 30, 2);
  g.fillStyle = '#141010'; g.textAlign = 'center'; g.font = `700 ${name.length > 10 ? 62 : 84}px "Chakra Petch"`;
  g.save(); g.translate(256, 92); g.rotate(-0.02); g.fillText(name, 0, 0); g.restore();
  return texOf(c, { repeat: false });
}
// truck grille (chrome bars)
function grilleTex() {
  const [c, g] = cv(256, 256);
  g.fillStyle = '#1a1a1c'; g.fillRect(0, 0, 256, 256);
  for (let x = 12; x < 256; x += 22) { const gr = g.createLinearGradient(x, 0, x + 12, 0); gr.addColorStop(0, '#6a6c70'); gr.addColorStop(0.5, '#e8eaec'); gr.addColorStop(1, '#5a5c60'); g.fillStyle = gr; g.fillRect(x, 8, 12, 240); }
  g.strokeStyle = '#d0d2d4'; g.lineWidth = 10; g.strokeRect(5, 5, 246, 246);
  return texOf(c, { repeat: false });
}

// ---------------------------------------------------------------- the cel materials
// Toon ramp: three steps (shadow / mid / light) with a narrow soft edge, shared by everything we build.
function rampTex() {
  const d = new Uint8Array([70, 70, 70, 255, 165, 165, 165, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
}
export const TX = {};
export function makeTextures() {
  TX.panel = panelSheet(); TX.tread = treadSheet(); TX.concrete = concreteSheet(true); TX.apron = concreteSheet(false);
  TX.wall = wallSheet(); TX.gauge = gaugeSheet(); TX.grille = grilleTex(); TX.ramp = rampTex();
  return TX;
}
// toon(color, { panel: tile metres (object-space triplanar seams), tex, emissive, ... })
export function toon(color, o = {}) {
  const m = new THREE.MeshToonMaterial({ color: new THREE.Color(color), gradientMap: TX.ramp, emissive: new THREE.Color(o.emissive || '#000000'),
    emissiveIntensity: o.ei ?? 1, map: o.map || null, transparent: !!o.transparent, opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide });
  if (o.panel) {
    const tile = o.panel, amt = o.panelAmt ?? 1, tex = o.panelTex || TX.panel;
    m.onBeforeCompile = sh => {
      sh.uniforms.tPanel = { value: tex };
      sh.vertexShader = 'varying vec3 vOP; varying vec3 vON;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vOP = position; vON = normal;');
      sh.fragmentShader = `uniform sampler2D tPanel; varying vec3 vOP; varying vec3 vON;\n` + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        { vec3 w = pow(abs(normalize(vON)), vec3(4.0)); w /= (w.x + w.y + w.z);
          vec3 q = vOP / ${tile.toFixed(2)};
          float p = texture2D(tPanel, q.zy).r * w.x + texture2D(tPanel, q.xz).r * w.y + texture2D(tPanel, q.xy).r * w.z;
          diffuseColor.rgb *= mix(1.0, p, ${amt.toFixed(2)}); }`);
    };
    m.customProgramCacheKey = () => `mecha-panel-${tile}-${amt}-${tex.uuid}`;
  }
  return m;
}
export const glowMat = (color, i = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(i), toneMapped: false });

// ---------------------------------------------------------------- geometry helpers
// chamfered plate: an XY outline (w x h, chamfer c, top narrowed by taper) extruded d along Z, faceted bevel
export function plate(w, h, d, { c = 0.18, taper = 0, bottomTaper = 0, bevel = 0.35 } = {}) {
  const cw = Math.min(w, h) * c, hw = w / 2, hh = h / 2, tw = hw * (1 - taper), bw = hw * (1 - bottomTaper);
  const s = new THREE.Shape();
  s.moveTo(-bw + cw, -hh); s.lineTo(bw - cw, -hh); s.lineTo(bw, -hh + cw); s.lineTo(tw, hh - cw); s.lineTo(tw - cw, hh); s.lineTo(-tw + cw, hh); s.lineTo(-tw, hh - cw); s.lineTo(-bw, -hh + cw); s.closePath();
  const bs = Math.min(d * 0.3, Math.min(w, h) * 0.08) * bevel / 0.35;
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.01, d - 2 * bs), bevelEnabled: true, bevelSize: bs, bevelThickness: bs, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -(d - 2 * bs) / 2); g.computeVertexNormals();
  return g;
}
export const rbox = (w, h, d, r = 0.12, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(w, h, d) * r);
export const cyl = (r0, r1, h, n = 16) => new THREE.CylinderGeometry(r0, r1, h, n, 1);
function mesh(g, m, parent, p = [0, 0, 0], r = [0, 0, 0], s = null) {
  const o = new THREE.Mesh(g, m); o.position.set(...p); o.rotation.set(...r); if (s) o.scale.set(...(Array.isArray(s) ? s : [s, s, s]));
  parent.add(o); return o;
}
function node(parent, p = [0, 0, 0], name = '') { const o = new THREE.Group(); o.position.set(...p); o.name = name; parent.add(o); return o; }

// ---------------------------------------------------------------- the machine
// Standing reference (metres, facing +Z): root (hips) at y 46; hip joints at x ±7.5, y 44; knee y 23; ankle y 4;
// waist 50; chest 58-76; neck 77; head 78-92; shoulders x ±16.5, y 72; elbow 54; wrist 38.
export class Mecha {
  constructor(scene, { markTex = null } = {}) {
    this.root = node(scene, [0, 46, 0], 'root');
    const M = this.M = {
      red: toon(COL.red, { panel: 16, panelAmt: 0.8 }), redB: toon('#B01A30', { panel: 11, panelAmt: 0.75 }),
      cream: toon(COL.cream, { panel: 6, panelAmt: 0.6 }), gun: toon(COL.gun, { panel: 4, panelAmt: 0.5 }), gunDk: toon(COL.gunDk, { panel: 3, panelAmt: 0.4 }),
      steel: toon('#8a8c90', { panel: 3, panelAmt: 0.5 }), hazard: toon(COL.hazard), black: new THREE.MeshBasicMaterial({ color: 0x0a0808 }),
      tread: toon('#4a4646', { panel: 3, panelTex: TX.tread, panelAmt: 0.9 }),
      visor: glowMat('#1a0f0c'), visorOn: glowMat('#FFE2B0', 3.2), lamp: glowMat(COL.amber, 2.2), seam: glowMat('#ff7a1a', 3),
    };
    this.visorBars = []; this.J = {};
    const J = this.J;
    // ---- pelvis & waist
    J.hips = this.root;
    mesh(plate(17, 8, 12, { c: 0.25, bottomTaper: 0.25 }), M.gun, J.hips, [0, -1, 0]);
    mesh(plate(10, 9, 3, { c: 0.25, bottomTaper: 0.35 }), M.red, J.hips, [0, -3.5, 6.4], [0.12, 0, 0]);       // front skirt
    mesh(plate(8, 2, 3.2), M.cream, J.hips, [0, 1.2, 6.6]);
    for (const s of [1, -1]) {
      mesh(plate(3.5, 11, 9, { c: 0.25, bottomTaper: 0.2 }), M.red, J.hips, [s * 9.6, -3, 0], [0, 0, s * 0.12]);    // side skirts
      mesh(plate(3.6, 2, 9.2), M.cream, J.hips, [s * 9.7, 2.1, 0], [0, 0, s * 0.12]);
      mesh(plate(8, 8, 3, { c: 0.25, bottomTaper: 0.3 }), M.redB, J.hips, [s * 4.5, -3, -6.3], [-0.12, 0, 0]);       // rear
    }
    J.waist = node(J.hips, [0, 4, 0], 'waist');
    for (let i = 0; i < 3; i++) mesh(cyl(5.8 - i * 0.2, 6.2 - i * 0.2, 2.2, 20), i % 2 ? M.gun : M.gunDk, J.waist, [0, 1.2 + i * 2.3, 0]);
    mesh(plate(9, 7, 3, { c: 0.25 }), M.red, J.waist, [0, 3.8, 5.2], [-0.08, 0, 0]);                              // abdomen plate
    mesh(plate(9.4, 1.2, 3.2), M.gunDk, J.waist, [0, 4.0, 5.3], [-0.08, 0, 0]);
    // ---- chest
    J.chest = node(J.waist, [0, 8, 0], 'chest');
    mesh(plate(24, 17, 14, { c: 0.2, bottomTaper: 0.3 }), M.red, J.chest, [0, 9, 0]);
    // the pecs: two raked plates, cream collar, the reactor window between them
    for (const s of [1, -1]) {
      mesh(plate(10.5, 10, 4.5, { c: 0.28, taper: -0.05, bottomTaper: 0.25 }), M.red, J.chest, [s * 6.2, 11.5, 7.4], [-0.22, s * 0.18, 0]);
      mesh(plate(10, 1.3, 4.6), M.cream, J.chest, [s * 6.4, 16.2, 6.6], [-0.22, s * 0.18, 0]);
      mesh(plate(2.2, 7, 1.5), M.gunDk, J.chest, [s * 11.2, 4.5, 7.2], [0, s * 0.3, 0]);                          // vents
      for (let k = 0; k < 5; k++) mesh(rbox(2.4, 0.4, 1.4, 0.2, 1), M.gun, J.chest, [s * 11.4, 2.2 + k * 1.2, 7.8], [0, s * 0.3, 0]);
      mesh(plate(4, 2.5, 8), M.cream, J.chest, [s * 10.5, 17.8, 0]);                                              // collar
    }
    // the reactor window: a gunmetal bezel, the ☭ gear decal (emissive, dark until it ignites), a glass disc
    const R = this.reactor = node(J.chest, [0, 8.8, 8.4], 'reactor');
    mesh(new THREE.TorusGeometry(4.1, 0.8, 8, 40), M.gunDk, R, [0, 0, 0]);
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; mesh(rbox(1.3, 1.3, 1.1, 0.2, 1), M.gun, R, [Math.cos(a) * 5, Math.sin(a) * 5, -0.2], [0, 0, a]); }
    this.reactorMat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: markTex, transparent: true, toneMapped: false });
    this.reactorGlass = mesh(new THREE.CircleGeometry(3.7, 40), new THREE.MeshBasicMaterial({ color: 0x120604, toneMapped: false }), R, [0, 0, -0.1]);
    this.reactorMark = mesh(new THREE.PlaneGeometry(6.4, 6.4), this.reactorMat, R, [0, 0, 0.05]);
    this.reactorMat.color.setRGB(0.05, 0.02, 0.02);
    // back: the boarding hatches (the backpack), thruster-less (it walks)
    mesh(plate(18, 13, 6, { c: 0.25 }), M.redB, J.chest, [0, 9, -8.5]);
    mesh(plate(8, 6, 1), M.gunDk, J.chest, [0, 9.5, -11.6]);                                                        // back hatch (the head's hatch is above)
    // ---- neck & head
    J.neck = node(J.chest, [0, 19, 0.5], 'neck');
    mesh(cyl(2.8, 3.4, 3.5, 16), M.gunDk, J.neck, [0, 1.5, 0]);
    for (let k = 0; k < 4; k++) mesh(cyl(0.5, 0.5, 4, 8), M.steel, J.neck, [Math.cos(k * 1.57 + 0.78) * 3.2, 1.5, Math.sin(k * 1.57 + 0.78) * 3.2], [0.2 * Math.sin(k), 0, 0.2 * Math.cos(k)]);
    J.head = node(J.neck, [0, 3, 0], 'head');
    this.buildHead(J.head, M);
    // ---- arms
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R';
      const sh = J['sh' + L] = node(J.chest, [s * 16.5, 14, 0], 'sh' + L);
      mesh(new THREE.SphereGeometry(4.2, 16, 12), M.gunDk, sh, [0, 0, 0]);
      // the pauldron: a big raked plate, cream stripe, with a hatch
      const pd = node(sh, [s * 1.2, 1.5, 0]);
      mesh(plate(11, 9, 13, { c: 0.3, taper: 0.1 }), M.red, pd, [0, 1.2, 0], [0, Math.PI / 2, -s * 0.2]);
      mesh(plate(11.4, 1.4, 13.2), M.cream, pd, [s * 0.4, -2.2, 0], [0, Math.PI / 2, -s * 0.2]);
      mesh(plate(2, 7, 13.4), M.redB, pd, [s * 5.5, 0, 0], [0, 0, -s * 0.2]);
      const ua = J['ua' + L] = node(sh, [0, 0, 0], 'ua' + L);
      mesh(cyl(2.6, 2.4, 13, 14), M.gun, ua, [0, -8, 0]);
      mesh(plate(6.4, 10, 6.4, { c: 0.25 }), M.red, ua, [0, -10, 0.4]);
      mesh(plate(6.6, 1.1, 6.6), M.cream, ua, [0, -5.5, 0.4]);
      const el = J['el' + L] = node(ua, [0, -18, 0], 'el' + L);
      mesh(cyl(2.8, 2.8, 5.5, 16), M.gunDk, el, [0, 0, 0], [0, 0, Math.PI / 2]);
      mesh(plate(5, 4, 5), M.cream, el, [0, 0.5, -2.6], [0.4, 0, 0]);                                             // elbow cap
      mesh(plate(7.4, 14, 7.8, { c: 0.22, bottomTaper: -0.12 }), M.red, el, [0, -8.5, 0.3]);
      mesh(plate(7.8, 1.2, 8.2), M.cream, el, [0, -12.8, 0.3]);
      for (let k = 0; k < 3; k++) mesh(rbox(0.5, 5, 1.2, 0.2, 1), M.gunDk, el, [s * 3.9, -6 - k * 0.1, -1.5 + k * 1.5]);
      const wr = J['wr' + L] = node(el, [0, -16, 0.3], 'wr' + L);
      mesh(cyl(2.2, 2.2, 3, 12), M.gunDk, wr, [0, -0.5, 0]);
      this.buildHand(wr, M, s);
    }
    // ---- legs
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R';
      const hp = J['hip' + L] = node(J.hips, [s * 7.5, -2, 0], 'hip' + L);
      mesh(new THREE.SphereGeometry(4, 14, 10), M.gunDk, hp);
      mesh(cyl(3.4, 3.0, 18, 14), M.gun, hp, [0, -10, 0]);
      mesh(plate(8.5, 16, 8, { c: 0.25, bottomTaper: 0.2 }), M.red, hp, [0, -10, 1.6], [0.04, 0, 0]);            // thigh armor
      mesh(plate(8.7, 1.3, 8.2), M.cream, hp, [0, -3.6, 1.8], [0.04, 0, 0]);
      mesh(plate(4, 12, 1.2), M.gunDk, hp, [s * 4.4, -10, 0], [0, Math.PI / 2, 0]);
      const kn = J['kn' + L] = node(hp, [0, -21, 0], 'kn' + L);
      mesh(cyl(3.2, 3.2, 7, 16), M.gunDk, kn, [0, 0, 0], [0, 0, Math.PI / 2]);
      mesh(plate(7.5, 7.5, 4, { c: 0.3, taper: 0.25 }), M.cream, kn, [0, 0.8, 3.4], [-0.25, 0, 0]);               // knee cap
      mesh(plate(3.5, 1.5, 4.2), M.red, kn, [0, 0.8, 5.0], [-0.25, 0, 0]);
      // the shin: wide, red, with the truck-column hatch and vents; hydraulic rams at the back
      mesh(plate(10, 17, 10, { c: 0.22, bottomTaper: -0.18 }), M.red, kn, [0, -10, 0.4]);
      mesh(plate(10.4, 1.3, 10.4), M.cream, kn, [0, -3.5, 0.4]);
      this.hatchM = this.hatchM || new THREE.MeshBasicMaterial({ color: 0x141212, toneMapped: false }); mesh(plate(5, 8, 0.8), this.hatchM, kn, [0, -10, 5.6]);                                                          // shin hatch
      mesh(rbox(1, 1.6, 0.6, 0.2, 1), M.hazard, kn, [1.8, -10, 6.0]);
      for (const k of [-1, 1]) {
        mesh(cyl(0.9, 0.9, 12, 10), M.steel, kn, [k * 2.8, -9, -5.2]);                                             // rams
        mesh(cyl(1.4, 1.4, 6, 10), M.gunDk, kn, [k * 2.8, -14, -5.2]);
      }
      const an = J['an' + L] = node(kn, [0, -19, 0], 'an' + L);
      mesh(new THREE.SphereGeometry(2.8, 12, 8), M.gunDk, an);
      // the foot: a blocky boot, a toe plate, a heel, tread-plate sole
      mesh(plate(10, 4, 15, { c: 0.2 }), M.gun, an, [0, -2.2, 2.5]);
      mesh(plate(10.4, 3.4, 7, { c: 0.35, taper: 0.2 }), M.red, an, [0, -1.4, 7.8], [-0.12, 0, 0]);
      mesh(plate(9, 3, 5), M.red, an, [0, -1.2, -3.6]);
      mesh(plate(10.4, 1.2, 15.4), M.cream, an, [0, -0.2, 2.5]);
      mesh(new THREE.BoxGeometry(10.2, 0.4, 15.2), M.tread, an, [0, -4.25, 2.5]);
    }
    this.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.pose(POSES.kneel);
  }
  buildHead(H, M) {
    // a helmet: never a face. Dome, brow ridge, cheek plates, chin guard, the three-slit visor (the ≡), a crest.
    mesh(plate(11, 10, 11.5, { c: 0.3, taper: 0.12 }), M.red, H, [0, 5.5, 0]);                                   // dome
    mesh(plate(11.8, 2.2, 5, { c: 0.35 }), M.red, H, [0, 8.6, 4.2], [0.35, 0, 0]);                                 // brow ridge
    mesh(plate(12, 0.8, 5.2), M.cream, H, [0, 7.8, 4.6], [0.35, 0, 0]);
    for (const s of [1, -1]) {
      mesh(plate(2.6, 7.5, 7, { c: 0.3, bottomTaper: 0.3 }), M.redB, H, [s * 5.6, 3.6, 2.8], [0, s * 0.35, 0]);     // cheek plates
      mesh(plate(1.2, 5, 5), M.cream, H, [s * 6.4, 3.8, 1.4], [0, s * 0.35, 0]);
      mesh(cyl(1.6, 1.6, 1.2, 12), M.gunDk, H, [s * 6.2, 5.5, -1.5], [0, 0, Math.PI / 2]);                        // ear caps
      mesh(rbox(0.6, 6, 0.6, 0.3, 1), M.steel, H, [s * 6.1, 9.5, -2.5], [0.3, 0, s * 0.35]);                      // antennae
    }
    mesh(plate(8.2, 2.6, 5, { c: 0.35, bottomTaper: 0.35 }), M.red, H, [0, 0.3, 4.4], [-0.1, 0, 0]);               // chin guard
    mesh(plate(3, 1.2, 5.4), M.cream, H, [0, 0.3, 4.6], [-0.1, 0, 0]);
    this.chinSeam = mesh(new THREE.BoxGeometry(6.4, 0.2, 0.4), M.seam, H, [0, 1.3, 6.62]);                        // the last weld, still glowing
    // the faceplate: gunmetal, slatted below; the visor is three slits (the ≡), each its own light
    mesh(plate(9.4, 6.4, 2.2, { c: 0.22, bottomTaper: 0.25 }), M.gun, H, [0, 4.6, 5.3]);
    // c7: no truck-grille slats. A split mandible with a centre vent, and a V of tall cream fins on the brow (the head reads as a helmet)
    for (const s of [1, -1]) {
      mesh(plate(3.2, 2.4, 1.4, { c: 0.3, taper: 0.3 }), M.gunDk, H, [s * 1.9, 2.3, 6.3], [0, s * 0.25, s * -0.35]);
      mesh(plate(1.1, 9, 0.9, { c: 0.2, taper: 0.7 }), M.cream, H, [s * 3.4, 13.2, 3.4], [0.15, 0, -s * 0.42]);            // V fins
      mesh(plate(0.9, 5, 0.8, { c: 0.2, taper: 0.7 }), M.red, H, [s * 5.4, 11.2, 2.6], [0.1, 0, -s * 0.7]);
    }
    mesh(plate(1.0, 2.0, 1.0), M.black, H, [0, 2.3, 6.5]);
    for (let k = 0; k < 3; k++) {
      mesh(new THREE.BoxGeometry(7.6 - k * 0.9, 0.95, 0.5), M.black, H, [0, 6.55 - k * 1.3, 6.3]);
      const m = new THREE.MeshBasicMaterial({ color: 0x1a0f0c, toneMapped: false });
      const bar = mesh(new THREE.BoxGeometry(7.2 - k * 0.9, 0.62, 0.3), m, H, [0, 6.55 - k * 1.3, 6.5]);
      this.visorBars.push(bar);
    }
    mesh(plate(1.4, 6, 8, { c: 0.3, taper: 0.4 }), M.cream, H, [0, 11.3, 0.8], [0, Math.PI / 2, 0]);               // crest
    mesh(plate(10, 2, 8), M.gunDk, H, [0, 1.2, -2.5]);                                                             // head hatch ring (the cockpit)
    mesh(plate(5.5, 4, 1), M.gun, H, [0, 5, -6.2]);                                                                // back hatch
  }
  buildHand(wr, M, s) {
    const hand = this.J['hand' + (s > 0 ? 'L' : 'R')] = node(wr, [0, -2.5, 0], 'hand');
    mesh(plate(7.2, 7.5, 3.4, { c: 0.2 }), M.gun, hand, [0, -3.5, 0]);                                              // palm
    mesh(plate(7.4, 4.5, 1.6, { c: 0.25 }), M.red, hand, [0, -2.8, 2.1]);                                           // back of hand
    this.knuckle = this.knuckle || {};
    const fingers = [];
    for (let f = 0; f < 4; f++) {
      const x = (-2.7 + f * 1.8) * s;
      let par = node(hand, [x, -7.2, 0.6]); const segs = [];
      for (let k = 0; k < 3; k++) {
        const L = [3.2, 2.5, 2.0][k];
        mesh(cyl(0.72, 0.72, 1.7, 10), M.gunDk, par, [0, 0, 0], [0, 0, Math.PI / 2]);
        mesh(plate(1.55, L, 1.8, { c: 0.25 }), k === 0 ? M.red : M.gun, par, [0, -L / 2, 0.1]);
        segs.push(par); par = node(par, [0, -L, 0]);
      }
      fingers.push(segs);
    }
    // thumb
    const th = node(hand, [s * 3.6, -2.5, 1.2]); mesh(cyl(0.8, 0.8, 1.8, 10), M.gunDk, th, [0, 0, 0], [0, 0, Math.PI / 2]);
    mesh(plate(1.7, 3.2, 1.9), M.red, th, [0, -1.6, 0]); const th2 = node(th, [0, -3.2, 0]); mesh(plate(1.6, 2.4, 1.8), M.gun, th2, [0, -1.2, 0]);
    this.J['fingers' + (s > 0 ? 'L' : 'R')] = fingers; this.J['thumb' + (s > 0 ? 'L' : 'R')] = [th, th2];
  }
  // pose: { hips: {p:[x,y,z], r:[x,y,z]}, waist:[..], chest:[..], neck, head, shL, elL, wrL, shR, ..., hipL, knL, anL, ..., curlL, curlR }
  pose(P) {
    const J = this.J, set = (o, r) => { if (r) o.rotation.set(r[0], r[1], r[2]); };
    if (P.hips) { this.root.position.set(...P.hips.p); this.root.rotation.set(...P.hips.r); }
    for (const k of ['waist', 'chest', 'neck', 'head', 'shL', 'shR', 'elL', 'elR', 'wrL', 'wrR', 'hipL', 'hipR', 'knL', 'knR', 'anL', 'anR']) set(J[k === 'shL' ? 'uaL' : k === 'shR' ? 'uaR' : k], P[k]);
    for (const s of ['L', 'R']) {
      const c = P['curl' + s] ?? 0.2;
      J['fingers' + s].forEach((segs, f) => segs.forEach((o, k) => { o.rotation.x = c * [1.1, 1.35, 1.0][k] * (1 + 0.06 * (f - 1.5)); }));
      const [t1, t2] = J['thumb' + s]; t1.rotation.set(c * 0.6, 0, (s === 'L' ? -1 : 1) * (0.3 + c * 0.5)); t2.rotation.x = c * 0.9;
    }
  }
  setVisor(levels, color = new THREE.Color('#FFE2B0'), dim = new THREE.Color('#1a0f0c')) {
    this.visorBars.forEach((b, k) => { const v = levels[k] ?? 0; b.material.color.copy(dim).lerp(color, Math.min(1, v)).multiplyScalar(1 + 2.5 * v); });
  }
  setHatch(v) { this.hatchM.color.setRGB(0.08 + 1.0 * v, 0.07 + 0.42 * v, 0.07 + 0.08 * v); }
  setReactor(v, tint = [1, 0.85, 0.6]) {               // 0 dark .. 1 blazing white-gold
    const k = 0.05 + v * 3.2; this.reactorMat.color.setRGB(k * tint[0] * 1.1, k * tint[1], k * tint[2] * 0.85);
    this.reactorGlass.material.color.setRGB(0.07 + v * 1.6, 0.03 + v * 0.95, 0.02 + v * 0.35);
  }
  // world position of a joint-local point
  wp(joint, p = [0, 0, 0], out = new THREE.Vector3()) { this.root.updateMatrixWorld(true); return out.set(...p).applyMatrix4(this.J[joint].matrixWorld); }
}

// ---------------------------------------------------------------- poses
const d2r = Math.PI / 180;
const R3 = (x, y = 0, z = 0) => [x * d2r, y * d2r, z * d2r];
export const POSES = {
  // on the right knee in the cradle, left foot planted, the head bowed, the left forearm on the left knee
  kneel: { hips: { p: [0, 24.5, 0], r: R3(6, 0, 0) }, waist: R3(8), chest: R3(6), neck: R3(-4), head: R3(-8),
    shL: R3(-58, 0, -8), elL: R3(-62), wrL: R3(10), shR: R3(-12, 0, 12), elR: R3(-30), wrR: R3(8),
    hipL: R3(-98, 0, -4), knL: R3(96), anL: R3(4), hipR: R3(-8, 0, 3), knR: R3(98), anR: R3(-45), curlL: 0.5, curlR: 0.9 },
  // head lifted 2 degrees (b5)
  stand: { hips: { p: [0, 46, 0], r: R3(0) }, waist: R3(0), chest: R3(-2), neck: R3(-2), head: R3(0),
    shL: R3(4, 0, -9), elL: R3(-16), wrL: R3(0), shR: R3(4, 0, 9), elR: R3(-16), wrR: R3(0),
    hipL: R3(-2, 0, -3), knL: R3(4), anL: R3(-2), hipR: R3(-2, 0, 3), knR: R3(4), anR: R3(-2), curlL: 1.0, curlR: 1.0 },
};
// the stand-up in stages: kneel -> knee drives up (half) -> torso rising -> standing
POSES.rise1 = { hips: { p: [0, 33, 0], r: R3(14) }, waist: R3(14), chest: R3(8), neck: R3(0), head: R3(4),
  shL: R3(-40, 0, -14), elL: R3(-40), wrL: R3(0), shR: R3(-20, 0, 18), elR: R3(-30), wrR: R3(0),
  hipL: R3(-86, 0, -4), knL: R3(70), anL: R3(14), hipR: R3(-32, 0, 3), knR: R3(88), anR: R3(-20), curlL: 0.9, curlR: 1.0 };
POSES.rise2 = { hips: { p: [0, 41, 0], r: R3(8) }, waist: R3(6), chest: R3(2), neck: R3(-2), head: R3(-2),
  shL: R3(-14, 0, -14), elL: R3(-24), wrL: R3(0), shR: R3(-8, 0, 16), elR: R3(-24), wrR: R3(0),
  hipL: R3(-44, 0, -4), knL: R3(40), anL: R3(4), hipR: R3(-22, 0, 3), knR: R3(34), anR: R3(-8), curlL: 1.0, curlR: 1.0 };
// walking: left foot lifted (b45), left foot planted forward (b46), right step over (b49)
POSES.liftL = { ...POSES.stand, hips: { p: [0, 45, 0], r: R3(3) }, hipL: R3(-38, 0, -3), knL: R3(52), anL: R3(-10), hipR: R3(4, 0, 3), knR: R3(6), anR: R3(-6),
  shL: R3(12, 0, -9), shR: R3(-14, 0, 9), chest: R3(0, 6, 0) };
POSES.stepL = { ...POSES.stand, hips: { p: [0, 44.2, 8], r: R3(2) }, hipL: R3(-26, 0, -3), knL: R3(10), anL: R3(14), hipR: R3(16, 0, 3), knR: R3(18), anR: R3(-12),
  shL: R3(14, 0, -9), shR: R3(-16, 0, 9), chest: R3(0, 4, 0) };
POSES.stepR = { ...POSES.stand, hips: { p: [0, 45, 16], r: R3(2) }, hipL: R3(14, 0, -3), knL: R3(16), anL: R3(-10), hipR: R3(-34, 0, 3), knR: R3(48), anR: R3(-12),
  shL: R3(-16, 0, -9), shR: R3(14, 0, 9), chest: R3(0, -5, 0) };
// the sledge: the right hand reaches for the haft on the flatcars (b50), heaves it (b51-52), rests it on the shoulder (b54+)
POSES.reach = { ...POSES.stand, hips: { p: [0, 40, 20], r: R3(10) }, waist: R3(14, -20, 0), chest: R3(10, -10, 0), head: R3(14, -10, 0),
  hipL: R3(-30, 0, -3), knL: R3(34), anL: R3(0), hipR: R3(-6, 0, 8), knR: R3(30), anR: R3(-18),
  shR: R3(-38, 0, 32), elR: R3(-22), wrR: R3(0), curlR: 1.25, shL: R3(20, 0, -14), elL: R3(-30), curlL: 1.1 };
POSES.shoulder = { ...POSES.stand, hips: { p: [0, 46, 20], r: R3(0) }, waist: R3(0, 6, 0), chest: R3(-3, 4, 0), neck: R3(-4), head: R3(-6, -4, 0),
  shR: R3(-38, 0, 24), elR: R3(-104), wrR: R3(-10, 0, 10), curlR: 1.25, shL: R3(4, 0, -12), elL: R3(-22), wrL: R3(0), curlL: 1.25,
  hipL: R3(-4, 0, -6), knL: R3(6), anL: R3(-2), hipR: R3(2, 0, 7), knR: R3(4), anR: R3(-4) };
POSES.swing = { ...POSES.shoulder, shR: R3(-150, 0, 40), elR: R3(-70), chest: R3(-8, -8, 0), waist: R3(-4, -6, 0) };

export function lerpPose(A, B, u) {
  const L = (a, b) => a.map((v, i) => v + (b[i] - v) * u), out = {};
  for (const k in A) {
    if (k === 'hips') out.hips = { p: L(A.hips.p, B.hips.p), r: L(A.hips.r, B.hips.r) };
    else if (Array.isArray(A[k])) out[k] = L(A[k], B[k] || A[k]);
    else out[k] = A[k] + ((B[k] ?? A[k]) - A[k]) * u;
  }
  return out;
}

// ---------------------------------------------------------------- instancing helper
export function instanced(geo, mat, list, parent, { color = null } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, list.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
  list.forEach((it, i) => { v.set(...it.p); e.set(...(it.r || [0, 0, 0])); q.setFromEuler(e); s.set(...(it.s || [1, 1, 1])); m.compose(v, q, s); im.setMatrixAt(i, m);
    if (color) im.setColorAt(i, new THREE.Color(it.c || color)); });
  im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
  parent.add(im); return im;
}
// a lattice beam (scaffold / truss) from a to b as a list of box instances (chords + zigzag)
function lattice(list, a, b, w = 1.2, bars = 0.18, step = 3) {
  const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), d = Bv.clone().sub(A), L = d.length(), n = Math.max(1, Math.round(L / step));
  const dir = d.clone().normalize(), up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const s1 = new THREE.Vector3().crossVectors(dir, up).normalize().multiplyScalar(w / 2), s2 = new THREE.Vector3().crossVectors(dir, s1).normalize().multiplyScalar(w / 2);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), e = new THREE.Euler().setFromQuaternion(q);
  const mid = A.clone().add(Bv).multiplyScalar(0.5);
  for (const [i, j] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const p = mid.clone().addScaledVector(s1, i).addScaledVector(s2, j); list.push({ p: p.toArray(), r: [e.x, e.y, e.z], s: [bars, L, bars] }); }
  for (let k = 0; k < n; k++) {             // zigzag braces on two faces
    const p0 = A.clone().addScaledVector(d, k / n), p1 = A.clone().addScaledVector(d, (k + 1) / n);
    for (const [sa, sb] of [[s1, s2], [s2, s1]]) {
      const x0 = p0.clone().add(sa).add(sb), x1 = p1.clone().sub(sa).add(sb), dd = x1.clone().sub(x0), ll = dd.length();
      const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dd.clone().normalize()), ee = new THREE.Euler().setFromQuaternion(qq);
      list.push({ p: x0.clone().add(x1).multiplyScalar(0.5).toArray(), r: [ee.x, ee.y, ee.z], s: [bars * 0.7, ll, bars * 0.7] });
    }
  }
}

// ---------------------------------------------------------------- the hangar (night) and the apron (morning)
// The hangar runs along Z: x in [-90, 90], z in [-320, 120], the 100 m doors at z = 120; the machine kneels at the
// origin facing the doors. The apron lies outside, z > 120.
export const HG = { x0: -90, x1: 90, z0: -320, z1: 120, h: 118, doorW: 124, doorH: 104 };
export class Hangar {
  constructor(scene) {
    const g = this.g = node(scene, [0, 0, 0], 'hangar');
    const Mc = toon('#9a968e', { map: null }), Mw = toon('#7d8486'), Ms = toon('#4a4d52', { panel: 4, panelAmt: 0.4 }), My = toon(COL.hazard, { panel: 3, panelAmt: 0.5 });
    this.M = { Mc, Mw, Ms, My };
    // floor
    const fm = toon('#b8b3aa', { map: TX.concrete }); TX.concrete.repeat.set(12, 28);
    const floor = mesh(new THREE.PlaneGeometry(HG.x1 - HG.x0, HG.z1 - HG.z0 + 400), fm, g, [0, 0, (HG.z0 + HG.z1 + 400) / 2], [-Math.PI / 2, 0, 0]);
    floor.receiveShadow = true;
    // walls (corrugated), columns and girts
    const wm = toon('#8e969a', { map: TX.wall, side: THREE.DoubleSide }); TX.wall.repeat.set(24, 10);
    const L = HG.z1 - HG.z0;
    for (const s of [1, -1]) mesh(new THREE.PlaneGeometry(L, HG.h), wm, g, [s * HG.x1, HG.h / 2, (HG.z0 + HG.z1) / 2], [0, -s * Math.PI / 2, 0]);
    mesh(new THREE.PlaneGeometry(HG.x1 - HG.x0, HG.h), wm, g, [0, HG.h / 2, HG.z0], [0, 0, 0]);
    // the front wall around the door opening (inside face and outside face share the plane: DoubleSide)
    const side = (HG.x1 - HG.x0 - HG.doorW) / 2;
    for (const s of [1, -1]) mesh(new THREE.PlaneGeometry(side, HG.h), wm, g, [s * (HG.doorW / 2 + side / 2), HG.h / 2, HG.z1]);
    mesh(new THREE.PlaneGeometry(HG.doorW, HG.h - HG.doorH), wm, g, [0, HG.doorH + (HG.h - HG.doorH) / 2, HG.z1]);
    const cols = [];
    for (let z = HG.z0; z <= HG.z1; z += 20) for (const s of [1, -1]) { cols.push({ p: [s * (HG.x1 - 1.2), HG.h / 2, z], s: [2.4, HG.h, 1.6] }); }
    for (let y = 20; y < HG.h; y += 24) for (const s of [1, -1]) cols.push({ p: [s * (HG.x1 - 1.8), y, (HG.z0 + HG.z1) / 2], s: [1, 1.2, L] });
    instanced(new THREE.BoxGeometry(1, 1, 1), Ms, cols, g);
    // the sawtooth roof: trusses across X every 16 m, glazed north lights between them
    const tr = [];
    for (let z = HG.z0 + 8; z < HG.z1; z += 16) {
      lattice(tr, [HG.x0, HG.h - 6, z], [HG.x1, HG.h - 6, z], 5, 0.35, 5);
    }
    for (let x = HG.x0 + 10; x < HG.x1; x += 30) lattice(tr, [x, HG.h - 4, HG.z0], [x, HG.h - 4, HG.z1], 3, 0.3, 6);
    instanced(new THREE.BoxGeometry(1, 1, 1), Ms, tr, g);
    const roofM = toon('#232a33', { side: THREE.DoubleSide }), glass = new THREE.MeshBasicMaterial({ color: 0x0c1a2a, side: THREE.DoubleSide });
    for (let z = HG.z0; z < HG.z1; z += 16) {
      mesh(new THREE.PlaneGeometry(HG.x1 - HG.x0, 17.9), roofM, g, [0, HG.h + 4, z + 8], [Math.PI / 2 - 0.5, 0, 0]);
      mesh(new THREE.PlaneGeometry(HG.x1 - HG.x0, 8.5), glass, g, [0, HG.h + 4, z + 15.8], [0.05, 0, 0]);
    }
    // the crane rails and the bridge crane (its girder bends round the helmet at b35)
    for (const s of [1, -1]) mesh(new THREE.BoxGeometry(3, 4, L), My, g, [s * 70, 100, (HG.z0 + HG.z1) / 2]);
    this.bridge = []; const bz = 6;
    for (let i = 0; i < 10; i++) { const seg = node(g, [-70 + i * 14 + 7, 98, bz]); mesh(new THREE.BoxGeometry(14.2, 5, 4), My, seg); mesh(new THREE.BoxGeometry(14.2, 0.8, 5), Ms, seg, [0, 2.8, 0]); this.bridge.push(seg); }
    // the light banks: 8 rows of lamp heads up both walls and along the trusses; each row is its own material
    this.rows = [];
    for (let r = 0; r < 8; r++) {
      const m = new THREE.MeshBasicMaterial({ color: 0x151412, toneMapped: false }), list = [];
      const y = 10 + r * 13.5;
      for (let z = HG.z0 + 10; z < HG.z1 - 5; z += 10) for (const s of [1, -1]) list.push({ p: [s * (HG.x1 - 3), y, z], r: [0, 0, s * 0.5], s: [1.6, 1.2, 3.6] });
      if (r === 7) for (let z = HG.z0 + 8; z < HG.z1; z += 16) for (let x = -80; x <= 80; x += 12) list.push({ p: [x, HG.h - 9, z], s: [2.6, 0.8, 2.6] });
      this.rows.push({ m, im: instanced(new THREE.BoxGeometry(1, 1, 1), m, list, g) });
    }
    // light pools on the floor (amber, additive): the work lights' footprint
    const [pc, pg] = cv(256, 256); const gr = pg.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, 'rgba(255,190,110,0.65)'); gr.addColorStop(0.5, 'rgba(255,160,70,0.18)'); gr.addColorStop(1, 'rgba(255,150,60,0)'); pg.fillStyle = gr; pg.fillRect(0, 0, 256, 256);
    this.poolMat = new THREE.MeshBasicMaterial({ map: texOf(pc, { repeat: false }), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0 });
    const pools = []; for (let z = HG.z0 + 20; z < HG.z1; z += 30) for (const s of [1, -1, 0.35, -0.35]) pools.push({ p: [s * 62, 0.05, z + (s > 0 ? 8 : 0)], r: [-Math.PI / 2, 0, 0], s: [34, 34, 1] });
    this.pools = instanced(new THREE.PlaneGeometry(1, 1), this.poolMat, pools, g);
    // the doors: two leaves that slide apart (b42)
    const dm = toon('#6c7276', { map: TX.wall }), dmo = toon('#b0a79a');
    this.doors = [];
    for (const s of [1, -1]) {
      const d = node(g, [s * HG.doorW / 4, HG.doorH / 2, HG.z1 + 0.6]);
      mesh(new THREE.BoxGeometry(HG.doorW / 2, HG.doorH, 1.2), dm, d);
      for (let y = -HG.doorH / 2 + 8; y < HG.doorH / 2; y += 16) mesh(new THREE.BoxGeometry(HG.doorW / 2, 1.2, 1.8), Ms, d, [0, y, 0]);
      mesh(new THREE.BoxGeometry(3, HG.doorH, 2.2), My, d, [-s * (HG.doorW / 4 - 1.5), 0, 0]);
      this.doors.push({ d, s });
    }
    this.buildCradle(Ms, My);
    // the rail spur along the right wall, out through the doors
    const rails = []; for (const x of [52.7, 54.3]) rails.push({ p: [x, 0.25, 100], s: [0.3, 0.5, 900] });
    for (let z = -200; z < 560; z += 1.6) rails.push({ p: [53.5, 0.12, z], s: [3.2, 0.24, 0.5] });
    this.rail = instanced(new THREE.BoxGeometry(1, 1, 1), toon('#3a3634'), rails, scene);
  }
  // scaffold towers, walkways and zigzag gantry stairs round the kneeling machine; the cradle clamps; beacons
  buildCradle(Ms, My) {
    const g = this.cradle = node(this.g, [0, 0, 0], 'cradle');
    const sc = [];
    const towers = [[-24, -16], [24, -16], [-24, 18], [24, 18], [-34, 2], [34, 2], [0, -30]];
    for (const [x, z] of towers) lattice(sc, [x, 0, z], [x, 78, z], 4, 0.3, 4);
    for (const y of [16, 32, 46, 76]) {                      // walkway rings
      lattice(sc, [-24, y, -16], [24, y, -16], 1.6, 0.25, 4); lattice(sc, [-24, y, 18], [24, y, 18], 1.6, 0.25, 4);
      lattice(sc, [-24, y, -16], [-24, y, 18], 1.6, 0.25, 4); lattice(sc, [24, y, -16], [24, y, 18], 1.6, 0.25, 4);
    }
    this.scaffold = instanced(new THREE.BoxGeometry(1, 1, 1), Ms, sc, g);
    const deck = []; for (const y of [16, 32, 46, 76]) for (const [a, b, c, d] of [[-24, -16, 24, -16], [-24, 18, 24, 18], [-24, -16, -24, 18], [24, -16, 24, 18]])
      deck.push({ p: [(a + c) / 2, y + 0.9, (b + d) / 2], s: [Math.abs(c - a) + 2, 0.3, Math.abs(d - b) + 2] });
    this.decks = instanced(new THREE.BoxGeometry(1, 1, 1), toon('#5a5e62', { map: null, panel: 2, panelTex: TX.tread, panelAmt: 0.6 }), deck, g);
    // zigzag stairs: flights between the walkway levels on the two front towers (the boarding gantries)
    const st = [], rails = [];
    for (const [x, z, dir] of [[-30, 26, 1], [30, 26, -1], [-30, -24, 1], [30, -24, -1]]) {
      for (let lv = 0; lv < 4; lv++) {
        const y0 = lv * 16, flip = lv % 2 ? -1 : 1;
        for (let k = 0; k < 20; k++) st.push({ p: [x + dir * flip * (k * 0.9 - 9), y0 + k * 0.8 + 0.4, z], s: [0.9, 0.18, 3.2] });
        rails.push({ p: [x, y0 + 8.6, z + 1.8], r: [0, 0, dir * flip * Math.atan2(16, 18)], s: [0.15, 24.5, 0.15] });
        st.push({ p: [x + dir * flip * 10, y0 + 16, z], s: [3.2, 0.3, 3.4] });
      }
      lattice(this._sc2 || (this._sc2 = []), [x - 11, 0, z], [x - 11, 66, z], 1.4, 0.2, 4); lattice(this._sc2, [x + 11, 0, z], [x + 11, 66, z], 1.4, 0.2, 4);
    }
    this.stairs = instanced(new THREE.BoxGeometry(1, 1, 1), toon('#6a6d70', { panel: 2, panelTex: TX.tread, panelAmt: 0.6 }), st, g);
    instanced(new THREE.BoxGeometry(1, 1, 1), My, rails, g); instanced(new THREE.BoxGeometry(1, 1, 1), Ms, this._sc2, g);
    // the cradle clamps: yellow arms from the front towers to the shoulders and chest (they blast away at b32)
    this.clamps = [];
    for (const [x, y, z, rx, rz, len] of [[-18, 52, 6, 0, -0.5, 18], [18, 52, 6, 0, 0.5, 18], [-16, 36, -8, 0.4, -0.4, 16], [16, 36, -8, 0.4, 0.4, 16]]) {
      const c = node(g, [x, y, z]); c.rotation.set(rx, 0, rz);
      mesh(rbox(3.4, len, 3.4, 0.2, 1), My, c); mesh(rbox(5, 3, 5, 0.2, 1), toon('#2a2a2a'), c, [0, -len / 2, 0]);
      this.clamps.push({ c, p0: c.position.clone(), r0: c.rotation.clone(), dir: new THREE.Vector3(Math.sign(x), 0.3, 0.2).normalize() });
    }
    // red rotating beacons on the tower tops and on posts along the floor
    this.beacons = [];
    const bm = glowMat('#ff2a1a', 2.5);
    const [bc, bg] = cv(64, 256); const gg = bg.createLinearGradient(0, 0, 0, 256); gg.addColorStop(0, 'rgba(255,60,40,0.9)'); gg.addColorStop(1, 'rgba(255,40,20,0)'); bg.fillStyle = gg; bg.fillRect(0, 0, 64, 256);
    const beamMat = new THREE.MeshBasicMaterial({ map: texOf(bc, { repeat: false }), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, opacity: 0.5 });
    for (const [x, y, z] of [[-24, 80, -16], [24, 80, -16], [-24, 80, 18], [24, 80, 18], [-60, 6, 60], [60, 6, 60], [-60, 6, -60], [60, 6, -60], [-34, 80, 2], [34, 80, 2]]) {
      const b = node(this.g, [x, y, z]); mesh(new THREE.SphereGeometry(1.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), bm, b);
      const beam = node(b, [0, 0.6, 0]); const cone = mesh(new THREE.ConeGeometry(9, 60, 16, 1, true), beamMat, beam, [0, 0, 30], [-Math.PI / 2, 0, 0]);
      this.beacons.push({ b, beam, ph: (x * 0.13 + z * 0.07) });
    }
    this.beamMat = beamMat;
  }
  // lights: rows 0..8 on (fractional for the slam), beacon spin, doors 0..1 open, clamps 0..1 blown
  update(t, { rows = 8, rowColor = '#FFD9A0', beacon = 1, doors = 0, clamps = 0, bend = 0, brown = 0 } = {}) {
    const on = new THREE.Color(rowColor);
    this.rows.forEach((R, i) => { const v = Math.max(0, Math.min(1, rows - i)) * (1 - brown); R.m.color.setRGB(0.06, 0.055, 0.05).lerp(on.clone().multiplyScalar(3.2), v); });
    this.poolMat.opacity = Math.min(1, rows / 8) * (1 - brown) * 0.9;
    for (const B of this.beacons) { B.beam.rotation.y = t * 4.2 + B.ph; B.b.visible = beacon > 0 && brown < 0.5; }
    this.beamMat.opacity = 0.45 * beacon;
    for (const D of this.doors) D.d.position.x = D.s * (HG.doorW / 4 + doors * HG.doorW / 2 * 0.98);
    for (const C of this.clamps) { C.c.position.copy(C.p0).addScaledVector(C.dir, clamps * 60); C.c.rotation.set(C.r0.x + clamps * 2.5, clamps * 1.3, C.r0.z + clamps * 1.8 * Math.sign(C.dir.x)); C.c.visible = clamps < 0.98; }
    this.bridge.forEach((s, i) => { const k = (i - 4.5) / 4.5; s.position.y = 98 + bend * 16 * Math.exp(-k * k * 3); s.rotation.z = -bend * 0.5 * k * Math.exp(-k * k * 2); });
  }
}

// the colossal sledge and its two flatcars (sledge head 16 m, haft 46 m, hickory)
export class Sledge {
  constructor(scene) {
    this.g = node(scene, [0, 0, 0], 'sledge');
    this.head = node(this.g, [0, 0, 0]);
    const steel = toon('#5a5c60', { panel: 3, panelAmt: 0.35 }), face = toon('#9a9c9e'), hick = toon('#b98a52', { panel: 6, panelAmt: 0.25 });
    mesh(plate(7, 7, 16, { c: 0.15 }), steel, this.head, [0, 0, 0]);
    for (const s of [1, -1]) mesh(cyl(3.9, 3.9, 1.2, 8), face, this.head, [0, 0, s * 8.1], [Math.PI / 2, 0, Math.PI / 8]);
    mesh(new THREE.BoxGeometry(7.3, 1.2, 1.2), toon('#3a2a1a'), this.head, [0, 3.2, 0]);
    this.haft = mesh(cyl(1.1, 1.4, 46, 12), hick, this.head, [0, -23, 0]);
    for (let k = 0; k < 3; k++) mesh(cyl(1.18, 1.18, 1.6, 12), toon('#2a2020'), this.head, [0, -40 + k * 2.2, 0]);   // grip tape
    this.cars = [];
    for (const z of [-14, 14]) {
      const c = node(scene, [0, 0, z]); const deck = toon('#4a3a30', { panel: 2, panelAmt: 0.5 }), frame = toon('#2c2a2a');
      mesh(new THREE.BoxGeometry(4.2, 0.8, 22), deck, c, [0, 2.6, 0]); mesh(new THREE.BoxGeometry(3.6, 1.2, 22.4), frame, c, [0, 1.8, 0]);
      for (const zz of [-8, 8]) for (const x of [-0.8, 0.8]) mesh(cyl(0.6, 0.6, 0.4, 12), frame, c, [x, 0.7, zz], [0, 0, Math.PI / 2]);
      for (const zz of [-8, 8]) mesh(new THREE.BoxGeometry(3, 0.8, 3.2), frame, c, [0, 1.1, zz]);
      this.cars.push(c);
    }
    this.g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }
  // lying on the cars at (x, z) along Z (haft along +Z): the resting pose
  rest(x, z, rock = 0) {
    for (let i = 0; i < 2; i++) { this.cars[i].position.set(x, 0, z + (i ? 14 : -14)); this.cars[i].rotation.set(rock * (i ? 1 : -1) * 0.02, 0, rock * 0.03); }
    this.g.position.set(x, 3.4 + 3.5, z - 16); this.g.rotation.set(0, 0, 0);
    this.head.rotation.set(-Math.PI / 2, 0, 0); this.head.position.set(0, 0, 0);
  }
}

// ---------------------------------------------------------------- the apron: morning, the plant beyond, the sky dome
export class Apron {
  constructor(scene) {
    const g = this.g = node(scene, [0, 0, 0], 'apron');
    const am = toon('#c9c3b8', { map: TX.apron }); TX.apron.repeat.set(60, 60);
    mesh(new THREE.PlaneGeometry(1600, 1600), am, g, [0, -0.02, 700], [-Math.PI / 2, 0, 0]).receiveShadow = true;
    // the hangar's exterior shell (seen from the apron): a long box with a sawtooth crown
    const shell = toon('#8d9498', { map: TX.wall }), crown = toon('#5b6268');
    mesh(new THREE.BoxGeometry(186, 124, 1), shell, g, [0, 62, 121.2]).visible = false;
    // the plant beyond: sheds, stacks, a water tower, cranes: flat cel shapes in the haze
    const r = rng(41), far = toon('#7f8c96'), far2 = toon('#6a7680'), sheds = [];
    for (let i = 0; i < 40; i++) { const x = (r() - 0.5) * 1400, z = 500 + r() * 700; if (Math.abs(x) < 120 && z < 700) continue; sheds.push({ p: [x, 0, z], s: [40 + r() * 90, 20 + r() * 50, 40 + r() * 80] }); }
    instanced(new THREE.BoxGeometry(1, 2, 1).translate(0, 0.5, 0), far, sheds, g);
    const stacks = []; for (let i = 0; i < 9; i++) stacks.push({ p: [(r() - 0.5) * 1200, 0, 700 + r() * 500], s: [8, 90 + r() * 70, 8] });
    instanced(new THREE.CylinderGeometry(0.5, 0.6, 1, 12).translate(0, 0.5, 0), far2, stacks, g);
    for (let i = 0; i < 4; i++) { const c = node(g, [(i - 1.5) * 260 + 60, 0, 780 + i * 60]); lattice(this._cr || (this._cr = []), [c.position.x, 0, c.position.z], [c.position.x, 110, c.position.z], 5, 0.5, 6); lattice(this._cr, [c.position.x - 20, 110, c.position.z], [c.position.x + 70, 110, c.position.z], 4, 0.5, 6); }
    instanced(new THREE.BoxGeometry(1, 1, 1), toon(COL.red), this._cr, g);
    // sky dome: cold clear morning (the sun low behind the camera, no disc)
    const sky = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { uTop: { value: new THREE.Color('#5d8fc4') }, uHor: { value: new THREE.Color('#e9d9c2') }, uNight: { value: 0 } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uTop, uHor; uniform float uNight; varying vec3 vD; void main(){ float h = clamp(vD.y, 0.0, 1.0); vec3 c = mix(uHor, uTop, pow(h, 0.55)); gl_FragColor = vec4(c, 1.0); }' });
    this.sky = mesh(new THREE.SphereGeometry(4000, 24, 12), sky, scene, [0, 0, 0]); this.skyMat = sky;
  }
}

// ---------------------------------------------------------------- inside the machine (sets, placed away from the hangar)
// ENGINE ROOM (chest): a drum 26 m in radius, five stadium tiers of stations round the reactor core, the reactor
// window (the ☭ gear) in the front wall; the COCKPIT hangs above the drum, its canopy looking down on the tiers.
export const ER = { x: 3000, y: 0, z: 0, R: 26, tiers: 5 };
export class EngineRoom {
  constructor(scene, markTex) {
    const g = this.g = node(scene, [ER.x, ER.y, ER.z], 'engine');
    const wall = toon('#3b3434', { panel: 4, panelAmt: 0.7, side: THREE.BackSide }), deckM = toon('#56585c', { panel: 2.5, panelTex: TX.tread, panelAmt: 0.7 }), rim = toon(COL.hazard), gun = toon(COL.gun, { panel: 3, panelAmt: 0.5 }), red = toon(COL.red, { panel: 4, panelAmt: 0.6 });
    mesh(new THREE.CylinderGeometry(ER.R + 4, ER.R + 4, 60, 48, 1, true), wall, g, [0, 24, 0]);
    mesh(new THREE.CircleGeometry(ER.R + 4, 48), deckM, g, [0, 0, 0], [-Math.PI / 2, 0, 0]);
    // ribs
    const ribs = []; for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; ribs.push({ p: [Math.sin(a) * (ER.R + 3.4), 24, Math.cos(a) * (ER.R + 3.4)], r: [0, a, 0], s: [1.4, 60, 1.2] }); }
    instanced(new THREE.BoxGeometry(1, 1, 1), gun, ribs, g);
    // the tiers: open arcs (leaving the window side, +Z, clear), each a deck ring + a riser + a yellow nosing
    this.stations = []; const lampList = [], consoles = [];
    const a0 = 0.55, a1 = Math.PI * 2 - 0.55;           // the arc (radians from +Z)
    for (let i = 0; i < ER.tiers; i++) {
      const r0 = 9 + i * 3.4, r1 = r0 + 3.4, y = 1.2 + i * 2.9;
      const ring = new THREE.RingGeometry(r0, r1, 48, 1, a0 + Math.PI / 2, a1 - a0); ring.rotateX(-Math.PI / 2);
      const deck = mesh(ring, deckM, g, [0, y, 0]); deck.rotation.y = 0;
      mesh(new THREE.CylinderGeometry(r0, r0, y, 48, 1, true, a0, a1 - a0), gun, g, [0, y / 2, 0]);
      mesh(new THREE.TorusGeometry(r0, 0.12, 4, 64, a1 - a0), rim, g, [0, y + 0.05, 0], [Math.PI / 2, 0, -Math.PI / 2 - a0]);
      // stations every ~3 m of arc: a console with a lamp and a handle, a worker standing at it facing the core
      const n = Math.floor((a1 - a0) * (r0 + 1.7) / 3.1);
      for (let k = 0; k < n; k++) {
        const a = a0 + (k + 0.5) / n * (a1 - a0), rr = r0 + 0.9;
        const x = Math.sin(a) * rr, z = Math.cos(a) * rr;
        consoles.push({ p: [x, y + 0.55, z], r: [0, a, 0], s: [1.2, 1.1, 0.6] });
        lampList.push({ p: [Math.sin(a) * (rr - 0.32), y + 1.2, Math.cos(a) * (rr - 0.32)], r: [0, a, 0], s: [0.26, 0.26, 0.12] });
        this.stations.push({ x: ER.x + Math.sin(a) * (r0 + 2.1), y: ER.y + y, z: ER.z + Math.cos(a) * (r0 + 2.1), heading: a + Math.PI, tier: i, a });
      }
    }
    instanced(new THREE.BoxGeometry(1, 1, 1), toon('#2a2626'), consoles, g);
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.lamps = instanced(new THREE.BoxGeometry(1, 1, 1), this.lampMat, lampList, g, { color: '#201810' });
    this.lampN = lampList.length; this.lampTier = this.stations.map(s => s.tier); this.lampA = this.stations.map(s => s.a);
    // the reactor core: a column of rings with glowing bands
    const core = this.core = node(g, [0, 0, 0]);
    mesh(cyl(3.2, 3.6, 16, 24), gun, core, [0, 8, 0]);
    this.bandMat = new THREE.MeshBasicMaterial({ color: 0x100804, toneMapped: false });
    for (let k = 0; k < 3; k++) { mesh(cyl(4.0, 4.0, 1.2, 24), red, core, [0, 2.5 + k * 4.6, 0]); mesh(cyl(3.7, 3.7, 1.0, 24), this.bandMat, core, [0, 4.8 + k * 4.6, 0]); }
    // the reactor window in the front wall (+Z): bezel, mark, glass; light floods in when it ignites
    const W = this.win = node(g, [0, 16, ER.R + 3.2]); W.rotation.y = Math.PI;
    mesh(new THREE.TorusGeometry(9, 1.3, 8, 48), toon(COL.gunDk), W);
    this.markMat = new THREE.MeshBasicMaterial({ map: markTex, transparent: true, toneMapped: false, color: new THREE.Color(0.08, 0.03, 0.02) });
    this.glassMat = new THREE.MeshBasicMaterial({ color: 0x100604, toneMapped: false });
    mesh(new THREE.CircleGeometry(8.2, 48), this.glassMat, W, [0, 0, -0.2]);
    mesh(new THREE.PlaneGeometry(14, 14), this.markMat, W, [0, 0, 0.1]);
    // the spine: a light line that races up from the cockpit through every tier (b26)
    this.spineMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.spine = mesh(new THREE.CylinderGeometry(0.35, 0.35, 1, 8), this.spineMat, g, [0, 20, 0]);
    // hard-hat racks, cable trays and harness lines overhead
    const cables = []; for (let k = 0; k < 40; k++) { const a = a0 + (k / 40) * (a1 - a0), r = 12 + (k % 5) * 3.4; cables.push({ p: [Math.sin(a) * r, 34, Math.cos(a) * r], r: [0, 0, 0], s: [0.05, 22, 0.05] }); }
    instanced(new THREE.BoxGeometry(1, 1, 1), toon('#1a1818'), cables, g);
    this.light = new THREE.PointLight(0xffb060, 0, 140, 1.2); this.light.position.set(0, 18, 20); g.add(this.light);
  }
  // lamps: per-station colour by rule; core bands 0..1; window 0..1; spine 0..1 (height fraction)
  update(t, { lampFn = () => '#201810', core = 0, win = 0, spine = -1 } = {}) {
    const c = new THREE.Color();
    for (let i = 0; i < this.lampN; i++) { c.set(lampFn(i, this.lampTier[i], this.lampA[i])); this.lamps.setColorAt(i, c); }
    this.lamps.instanceColor.needsUpdate = true;
    this.bandMat.color.setRGB(0.06 + core * 2.8, 0.03 + core * 2.0, 0.01 + core * 0.9);
    this.markMat.color.setRGB(0.08 + win * 3.4, 0.03 + win * 2.9, 0.02 + win * 2.1);
    this.glassMat.color.setRGB(0.06 + win * 2.2, 0.03 + win * 1.6, 0.01 + win * 0.7);
    this.light.intensity = win * 700 + core * 150;
    if (spine >= 0) { this.spineMat.opacity = 0.9; this.spine.scale.set(1, 40 * spine, 1); this.spine.position.y = 40 - 20 * spine; } else this.spineMat.opacity = 0;
  }
}

// COCKPIT: crane-cab plainness: steel floor, two seats side by side, analog gauges, amber lamps, twin sticks, a canopy
export const CK = { x: 3000, y: 46, z: -6 };
export class Cockpit {
  constructor(scene) {
    const g = this.g = node(scene, [CK.x, CK.y, CK.z], 'cockpit');
    const steel = toon('#4c4e52', { panel: 2, panelAmt: 0.6 }), dark = toon('#262424', { panel: 1.5, panelAmt: 0.4 }), red = toon(COL.red, { panel: 3, panelAmt: 0.6 }), vinyl = toon('#3a2c26');
    mesh(new THREE.BoxGeometry(8, 0.3, 7), toon('#3c3e40', { panel: 2, panelTex: TX.tread, panelAmt: 0.7 }), g, [0, 0, 0]);
    // walls & roof (a helmet shell from inside: red plates, ribs)
    mesh(new THREE.CylinderGeometry(4.6, 4.6, 8, 20, 1, true, Math.PI * 0.6, Math.PI * 0.8), toon('#5a1a22', { panel: 2, panelAmt: 0.7, side: THREE.BackSide }), g, [0, 2.5, 0], [0, 0, Math.PI / 2]);
    // the console: a sloped desk of gauges in front, lamps above it
    const desk = node(g, [0, 1.1, 2.3]); desk.rotation.x = -0.5;
    mesh(new THREE.BoxGeometry(7.4, 1.4, 0.2), dark, desk);
    const gm = new THREE.MeshBasicMaterial({ map: TX.gauge, toneMapped: false, color: new THREE.Color(1.0, 0.92, 0.8) });
    mesh(new THREE.PlaneGeometry(7.0, 1.3), gm, desk, [0, 0, 0.11]);
    this.gaugeMat = gm;
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0xffa040, toneMapped: false });
    const lamps = []; for (let k = 0; k < 16; k++) lamps.push({ p: [-3.4 + k * 0.45, 1.95, 2.55], s: [0.16, 0.16, 0.1] });
    this.lamps = instanced(new THREE.BoxGeometry(1, 1, 1), this.lampMat, lamps, g, { color: '#ffa040' });
    // the canopy: a frame of struts; its glass is the view down to the tiers
    for (const x of [-3.6, -1.2, 1.2, 3.6]) mesh(new THREE.BoxGeometry(0.18, 0.18, 4.4), steel, g, [x, 3.0, 3.6], [0.95, 0, 0]);
    mesh(new THREE.BoxGeometry(7.6, 0.2, 0.2), steel, g, [0, 1.9, 2.8]);
    // two seats: the pilot's (left, -X) and the one beside him (the AI rides shotgun: its cushion takes a weight)
    this.seats = [];
    for (const x of [0, 0.8]) {
      const s = node(g, [x, 0.15, -0.6]); s.scale.setScalar(0.72);
      mesh(rbox(1.0, 0.24, 0.95, 0.3, 2), vinyl, s, [0, 0.62, 0.05]);
      mesh(rbox(1.0, 1.35, 0.22, 0.3, 2), vinyl, s, [0, 1.35, -0.42], [-0.12, 0, 0]);
      mesh(rbox(0.7, 0.35, 0.18, 0.3, 2), vinyl, s, [0, 2.15, -0.5], [-0.12, 0, 0]);
      mesh(cyl(0.12, 0.16, 0.5, 8), steel, s, [0, 0.25, 0]);
      mesh(new THREE.BoxGeometry(1.2, 0.08, 1.1), dark, s, [0, 0.03, 0]);
      // harness straps (two shoulder straps, a lap belt)
      for (const k of [-1, 1]) mesh(new THREE.BoxGeometry(0.1, 1.2, 0.03), toon('#b01a2a'), s, [k * 0.22, 1.25, -0.28], [-0.12 + 0.05, 0, k * 0.12]);
      mesh(new THREE.BoxGeometry(0.95, 0.1, 0.03), toon('#b01a2a'), s, [0, 0.82, 0.45]);
      this.seats.push(s);
    }
    // c7: ONE seat. The second seat is gone (AI is not a co-pilot; Haz: it cannot align itself autonomously). AI is the
    // machine's instrument: a dark three-bar read-out on the console that lights only as the pilot's hands close.
    this.seats[1].visible = false;
    this.cushion = this.seats[1].children[0];
    // twin crane-cab sticks (worn rubber grips) in front of each seat
    this.sticks = [];
    for (const x of [-0.3, 0.3, 5, 5]) {
      const st = node(g, [x, 0.4, -0.02]); mesh(cyl(0.035, 0.035, 0.6, 8), steel, st, [0, 0.3, 0]); mesh(cyl(0.055, 0.055, 0.2, 10), toon('#141212'), st, [0, 0.62, 0]);
      mesh(cyl(0.12, 0.14, 0.12, 12), dark, st, [0, 0, 0]); this.sticks.push(st); if (x > 4) st.visible = false;
    }
    // the AI: a field of white-gold light settling into the seat (never a robot, never a figure): stacked additive
    // soft sprites + a warm lamp; `ai.intensity` 0..1, `ai.face` brightens the side facing the pilot
    const [c, cg] = cv(128, 128); const gr = cg.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,245,225,1)'); gr.addColorStop(0.35, 'rgba(255,225,160,0.55)'); gr.addColorStop(1, 'rgba(255,200,120,0)'); cg.fillStyle = gr; cg.fillRect(0, 0, 128, 128);
    const tex = texOf(c, { repeat: false });
    this.aiG = node(this.seats[1], [0, 1.2, -0.05]); this.ai = [];
    for (let k = 0; k < 9; k++) {
      const m = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(2.2, 1.9, 1.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0 });
      const sp = new THREE.Sprite(m); this.aiG.add(sp); this.ai.push({ sp, ph: k * 1.7, y: -0.55 + (k % 3) * 0.5, x: ((k * 7) % 5 - 2) * 0.13, s: 0.8 + (k % 4) * 0.3 });
    }
    this.aiLight = new THREE.PointLight(0xffd9a0, 0, 6, 1.5); this.aiG.add(this.aiLight);
    this.aiG.visible = false;
    // the ≡ read-out: three bars on the console, dark until the grip closes, then lit one after another (command down the spine)
    this.bars = [];
    for (let k = 0; k < 3; k++) {
      const m = new THREE.MeshBasicMaterial({ color: 0x1a0f0c, toneMapped: false });
      mesh(new THREE.BoxGeometry(2.0 - k * 0.3, 0.13, 0.05), m, desk, [0, 0.36 - k * 0.24, 0.16]); this.bars.push(m);
    }
    this.roLight = new THREE.PointLight(0xffd9a0, 0, 5, 1.5); this.roLight.position.set(0, 2.3, 2.9); g.add(this.roLight);
  }
  update(t, { ai = 0, face = 0, lamps = '#ffa040', press = 0, stick = 0 } = {}) {
    this.ai.forEach((A, k) => { const w = 0.08 * Math.sin(t * 1.3 + A.ph); A.sp.position.set(A.x + w - face * 0.15, A.y + 0.05 * Math.sin(t * 0.9 + A.ph), 0.05 * Math.cos(t + A.ph));
      A.sp.scale.setScalar(A.s * (0.9 + 0.1 * Math.sin(t * 2 + A.ph)) * (0.6 + 0.4 * ai)); A.sp.material.opacity = ai * (0.8 + 0.15 * Math.sin(t * 1.7 + A.ph)) * (1 + face * (A.x < 0 ? 0.8 : 0)); });
    this.aiLight.intensity = 0;
    this.bars.forEach((m, k) => { const v = Math.max(0, Math.min(1, ai * 3 - k)); m.color.setRGB(0.1 + v * 2.6, 0.06 + v * 1.9, 0.05 + v * 0.9); });
    this.roLight.intensity = ai * 22;
    this.cushion.scale.y = 1 - 0.35 * press; this.cushion.position.y = 0.62 - 0.04 * press;
    this.lampMat.color.set(lamps).multiplyScalar(2.2);
    for (let k = 0; k < 2; k++) this.sticks[k].rotation.x = stick * 0.45;
  }
}

// a truck cab (real scale): cab, hood, chrome grille, headlights, bumper, a plate, mud flaps, a CB mic on its cord
export function truckCab(parent, { color = '#b8221e', plate = null, seed = 1 } = {}) {
  const g = node(parent, [0, 0, 0]), r = rng(seed);
  const paint = toon(color, { panel: 2.4, panelAmt: 0.25 }), chrome = toon('#c8ccd0'), dark = toon('#141416'), glass = new THREE.MeshBasicMaterial({ color: 0x0b1318 });
  mesh(rbox(2.5, 2.8, 2.3, 0.08, 2), paint, g, [0, 2.6, -1.2]);                            // the cab
  mesh(rbox(2.3, 1.6, 2.6, 0.12, 2), paint, g, [0, 1.8, 1.2]);                              // the hood
  mesh(new THREE.BoxGeometry(2.2, 1.0, 0.1), glass, g, [0, 3.35, -0.02], [-0.12, 0, 0]);   // windshield
  const gr = mesh(new THREE.PlaneGeometry(1.5, 1.35), toon('#ffffff', { map: TX.grille }), g, [0, 1.8, 2.52]);
  const hl = new THREE.MeshBasicMaterial({ color: 0x222018, toneMapped: false });
  for (const s of [1, -1]) { mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 14), hl, g, [s * 0.95, 1.95, 2.52], [Math.PI / 2, 0, 0]); mesh(rbox(0.5, 0.9, 0.9, 0.3, 2), paint, g, [s * 1.25, 1.2, 1.6]); }
  mesh(rbox(2.6, 0.35, 0.4, 0.3, 1), chrome, g, [0, 0.95, 2.62]);                          // bumper
  if (plate) mesh(new THREE.PlaneGeometry(0.62, 0.31), new THREE.MeshBasicMaterial({ map: plate, toneMapped: false, color: new THREE.Color(0.85, 0.85, 0.82) }), g, [0.6, 0.95, 2.83]);
  for (const s of [1, -1]) mesh(new THREE.BoxGeometry(0.55, 0.7, 0.04), dark, g, [s * 1.0, 0.55, -2.2]);    // mud flaps
  mesh(new THREE.BoxGeometry(0.1, 1.8, 0.1), chrome, g, [1.28, 3.9, -1.9]);                // stack
  mesh(cyl(0.05, 0.05, 0.4, 6), dark, g, [-0.8, 3.2, -0.4]);                                // the CB mic, swinging on its cord
  return { g, hl };
}

// a power tool (driver / grinder / drill), human scale, the owner's name on tape
export function powerTool(parent, kind, color, name) {
  const g = node(parent, [0, 0, 0]);
  const body = toon(color, { panel: 0.3, panelAmt: 0.25 }), black = toon('#1a1a1a'), metal = toon('#9a9c9e');
  if (kind === 'grinder') {
    mesh(cyl(0.05, 0.055, 0.34, 12), body, g, [0, 0, 0], [0, 0, Math.PI / 2]);
    const disc = mesh(cyl(0.11, 0.11, 0.012, 20), metal, g, [0.2, -0.04, 0]); mesh(cyl(0.12, 0.12, 0.05, 20, 1, false, 0, Math.PI), black, g, [0.2, -0.01, 0]);
    g.userData.spin = disc;
  } else {
    mesh(rbox(0.22, 0.09, 0.07, 0.3, 2), body, g, [0, 0.11, 0]);                            // motor housing
    mesh(rbox(0.06, 0.16, 0.06, 0.3, 2), black, g, [-0.04, 0.0, 0], [0, 0, -0.2]);           // grip
    mesh(rbox(0.12, 0.07, 0.1, 0.2, 2), body, g, [-0.06, -0.1, 0]);                           // battery
    const chuck = mesh(cyl(0.022, 0.028, 0.07, 12), metal, g, [0.14, 0.11, 0], [0, 0, Math.PI / 2]);
    g.userData.spin = chuck;
  }
  if (name) mesh(new THREE.PlaneGeometry(0.24, 0.06), new THREE.MeshBasicMaterial({ map: nameTex(name), transparent: true, toneMapped: false, color: new THREE.Color(0.95, 0.93, 0.88) }), g, [kind === 'grinder' ? -0.02 : 0.0, kind === 'grinder' ? 0.058 : 0.11, 0.041], kind === 'grinder' ? [-Math.PI / 2 + 0.5, 0, 0] : [0, 0, 0]);
  return g;
}
