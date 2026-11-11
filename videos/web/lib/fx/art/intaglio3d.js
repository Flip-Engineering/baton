// ART kit / INTAGLIO 3D: one engraver for any three.js scene (the merge the ROADMAP asked for, G4).
//
//   import { engraveScene, paperFinish } from '../lib/fx/art/intaglio3d.js';
//   const eng = engraveScene(scene, { lpm: 48, accent: '#b3161b' });   // every lit material + the hot matter -> engraved
//   eng.set({ exposure: 2 });  eng.restore();                            // live tweak / back to the colour render
//   paperFinish(ctx, { seed })                                           // 2D: ink squeeze at line edges + wove-paper fibre
//
// What it merges:
//  - lib/fx/engrave.js engraveMaterial / engravePeople: the line-family material patch (Ostromoukhov layers: families as
//    object-space plane sections that swell with shade, cross-hatch in half-tones, dot-and-lozenge in the darks, flicks
//    in the lights, flat tone where lines alias, one accent ink). That code is reused as is, not forked.
//  - hero.js figures (SkinnedMesh + its own onBeforeCompile) are chained, so a HUMAN hero engraves with the set.
//  - the kit's HOT matter (molten.js stream, pool, splash: ShaderMaterials flagged userData.hot or recognised by their
//    uniforms) becomes the ACCENT ink: in a banknote the pour is the one red, printed as line, not a glow.
//  - additive light (sparks, fume cards, emissive glazing) has no place in a two-ink plate and is hidden while engraved.
//  - lib/fx/intaglio.js stays the 2D relief printer for flat ink canvases; paperFinish() is the cheap stand-in used here.
// Dialect: ENGRAVING (STYLE_BIBLE). Inks: stock + ink + red.
import * as THREE from 'three';
import { engraveMaterial } from '../engrave.js';
import { INK } from './tokens.js';

export function engraveScene(root, o = {}) {
  const opts = { lpm: 48, paper: INK.stock, ink: INK.ink, accent: INK.red, exposure: 1.8, gamma: 1.0, outline: 0.9, plate: 0.02, ...o };
  const handles = [], seen = new Map(), hidden = [], swapped = [];
  const hotMat = new THREE.MeshBasicMaterial({ color: opts.accent }); hotMat.userData.keep = true;   // the pour prints as the one flat red plate
  root.traverse(obj => {
    if (!(obj.isMesh || obj.isPoints || obj.isLine)) return;
    const m = obj.material; if (!m || Array.isArray(m)) return;
    const hot = obj.userData.hot || (m.isShaderMaterial && m.uniforms && ('uT0' in m.uniforms));
    if (hot) { swapped.push([obj, m]); obj.material = hotMat; return; }
    if (m.userData?.keep) return;
    if (m.isShaderMaterial || m.blending === THREE.AdditiveBlending || m.transparent || m.isMeshBasicMaterial) { if (obj.visible) { hidden.push(obj); obj.visible = false; } return; }
    if ((m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) && !seen.has(m)) { seen.set(m, { obc: m.onBeforeCompile, key: m.customProgramCacheKey, tm: m.toneMapped }); handles.push(engraveMaterial(m, opts)); }
  });
  return {
    set(p) { for (const h of handles) h.set(p); },
    restore() { for (const [m, s] of seen) { m.onBeforeCompile = s.obc; m.customProgramCacheKey = s.key; m.toneMapped = s.tm; m.needsUpdate = true; }
      for (const o of hidden) o.visible = true; for (const [obj, m] of swapped) obj.material = m; },
  };
}

// wove paper and ink: fibre texture multiplied in, a hair of ink squeeze (dot gain) at line edges, a plate-tone film
let FIB = null;
function fibre(w, h, seed = 5) {
  if (FIB && FIB.width === w) return FIB;
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); let x = seed * 99991;
  const r = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
  for (let i = 0; i < 5200; i++) { const px = r() * w, py = r() * h, L = 6 + r() * 26, a = r() * Math.PI; g.strokeStyle = `rgba(${150 + r() * 60},${140 + r() * 60},${120 + r() * 50},${0.08 + r() * 0.14})`;
    g.lineWidth = 0.5 + r() * 0.8; g.beginPath(); g.moveTo(px, py); g.quadraticCurveTo(px + Math.cos(a) * L * 0.5 + (r() - 0.5) * 6, py + Math.sin(a) * L * 0.5 + (r() - 0.5) * 6, px + Math.cos(a) * L, py + Math.sin(a) * L); g.stroke(); }
  for (let i = 0; i < 30000; i++) { g.fillStyle = `rgba(120,110,90,${r() * 0.12})`; g.fillRect(r() * w, r() * h, 1, 1); }
  FIB = c; return c;
}
export function paperFinish(ctx, { gain = 0.5, fibreK = 1, seed = 5, region = null } = {}) {
  const [x0, y0, w, h] = region || [0, 0, ctx.canvas.width, ctx.canvas.height];
  const src = Object.assign(document.createElement('canvas'), { width: w, height: h }), sg = src.getContext('2d'); sg.drawImage(ctx.canvas, x0, y0, w, h, 0, 0, w, h);
  ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
  // ink squeeze: the lines spread a hair (darken with a 0.7 px blur of itself)
  ctx.globalCompositeOperation = 'darken'; ctx.globalAlpha = gain; ctx.filter = 'blur(0.7px)'; ctx.drawImage(src, x0, y0); ctx.filter = 'none';
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.55 * fibreK; ctx.drawImage(fibre(1080, 1920, seed), 0, 0, w, h, x0, y0, w, h);
  ctx.restore();
}
