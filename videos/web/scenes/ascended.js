// ASCENDED v7 (cycle c13): the meme as an argument, physical. One paper world: a printed political compass on a workbench in
// one hard rake light, folded by a worker's gloved hands, and the Chairman saying why the corners are friends.
//   b0   frame 0 is the flat compass, the top-left corner already lifting; TOP LEFT. / BOTTOM RIGHT. print in their quadrants,
//        FRIENDS. (the tweet's own word) lands on the two hands flexing the corners together
//   b4   the push: the quadrants' picture text, down to the halftone rosettes; his first sentence starts (b7.75, "Americans
//        are wise, they like to take things to the logical conclusion", wx5a) and NO GRAY ZONE. / THE LOGICAL CONCLUSION. print
//   b12  the pleat on the TR-BL diagonal rises as he says "take things to the", freezes, and slaps shut on "conclusion" (b16):
//        CRISS-CROSS. printed across the join; the centre, TR and BL are gone into the pleat
//   b18  "Americans wisely only see two possibilities. You are a capitalist or you're a communist." (wx5c): CAPITALIST. prints
//        on the yellow corner on his word (b26.5), COMMUNIST. on the red corner on his (b29.4)
//   b36  the sheet is turned over; the back is the Fold-In: SOME / WELFARE. in the middle, FULL / COMMUNISM. in strips
//        either side. wx5b, "If you want some welfare, you may as well have full communism": the middle folds under on
//        "may as well have", the strips close on "full" (b48): FULL / COMMUNISM.
//   b52  the ascension: the camera tilts so the folded compass becomes a floor; the mark (a printed card) lifts off it,
//        turns upright and level, ASCENDED. lands on -CEN- (b62, the landing); b62 the mark hangs in hard light above the chart
//   b64.6 the ANOTHER BANGER BY ACP card on the same bench; a fresh compass slides in over it and meets frame 0.
// Words: research/scripts_final/ascended.json (v7). Song: web/audio/songs2/ascended_c13.py (142 BPM).

import * as THREE from 'three';
import { W, H, loadFonts, loadBeats, clamp, lerp, ease, smooth, rng, BRAND } from '../lib/kit.js';
import { RQ } from '../lib/rq.js';
import { loadHeroData, Hero } from '../lib/fx/hero.js';
import { GESTURES } from '../lib/fx/gesture.js';
import { sheetPoint, planePoint, FoldMesh, PA, PB, PW } from './ascended.paper.js';
import * as ART from './ascended.art.js';

const QS = new URLSearchParams(location.search);
await loadFonts();
{ const f = new FontFace('Big Shoulders Display', 'url(../node_modules/@fontsource/big-shoulders-display/files/big-shoulders-display-latin-900-normal.woff2)', { weight: '900' });
  document.fonts.add(await f.load()); }
const B = await loadBeats('ascended');
const SPB = B.spb, FR = 1 / 30, TAU = Math.PI * 2;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const TABLE = 1.0, K = 0.14;                                // bench height (m); 1 sheet unit = 14 cm
const END_B = 69.4;                                         // the loop point: the compass has slid back under frame 0
const CARD_B = 64.6, LOOP_B = 68.0;                         // the card, then the fresh compass slides over it

// ================================================================ words (scripts_final/ascended.json v7)
// where: 'paper' = printed on the sheet through the fold (mask channel), 'slip' = a torn printed slip on the hit
// (the picture text FULL / COMMUNISM. and the Fold-In's SOME / WELFARE. are printed on the back of the sheet)
const WORDS = [
  { b: 0, text: 'TOP LEFT.', where: 'paper' }, { b: 1, text: 'BOTTOM RIGHT.', where: 'paper' },
  { b: 2, text: 'FRIENDS.', where: 'slip', e: 4.4, ink: 'red', x: 540, y: 1180, cap: 210, rot: -0.05 },
  { b: 7.75, text: 'EXECUTIVE CHAIRMAN,/AMERICAN COMMUNIST PARTY', where: 'slip', e: 12, x: 540, y: 1700, cap: 40, rot: 0.01, small: 1 },
  { b: 11.7, text: 'NO GRAY ZONE.', where: 'slip', e: 14.3, ink: 'red', x: 540, y: 420, cap: 190, rot: -0.04 },
  { b: 14.3, text: 'THE LOGICAL/CONCLUSION.', where: 'slip', e: 17.2, x: 540, y: 400, cap: 150, rot: 0.03 },
  { b: 16, text: 'CRISS-CROSS.', where: 'paper', e: 18 },
  { b: 26.4, text: 'CAPITALIST.', where: 'paper' }, { b: 29.4, text: 'COMMUNIST.', where: 'paper' },
  { b: 48, text: 'FULL COMMUNISM.', where: 'paper', e: 52 },
  { b: 61.5, text: 'ASCENDED.', where: 'sky', e: 64.5 },
];
const SHOTS = [[0, 'bench'], [16, 'join'], [32, 'turn'], [48, 'reveal'], [52, 'ascent'], [CARD_B, 'card']];

// ================================================================ renderer, cameras
const ADOPT = false;   // GRAPHICS 4.A (lib/rq.js): true = native resolution on the GPU and a fenced copy, once this piece's farm A/B says so
const SC = RQ.scale(0.8, ADOPT), RW = Math.round(W * SC), RH = Math.round(H * SC);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(RW, RH, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 0);
const camera = new THREE.PerspectiveCamera(28, RW / RH, 0.01, 30);
const scene = new THREE.Scene();
const out = document.getElementById('out'), ctx = out.getContext('2d');

// ================================================================ surfaces
const t0 = performance.now();
const tex = (c, { srgb = true, rep = null, aniso = 8 } = {}) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); } return t; };
const MAPS = ART.foldMaps(1536);                       // must match the mask and back canvases (1536)
const { maskA, maskB, panels } = ART.frontMasks(1536, MAPS.stage1);
const frontC = ART.frontArt(2560, panels);
const backC = ART.backArt(1536, frontC, MAPS.pre, MAPS.fin);
// the emblem, traced up from the logo (6x, smoothed, thresholded) so it holds at full frame
const EMB = (() => { const E = BRAND.acp_emblem, k = 6, c = ART.cv(E.width * k, E.height * k), g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high'; g.filter = 'blur(3px)'; g.drawImage(E, 0, 0, c.width, c.height); g.filter = 'none';
  const id = g.getImageData(0, 0, c.width, c.height); for (let i = 3; i < id.data.length; i += 4) id.data[i] = clamp((id.data[i] - 110) * 6, 0, 255); g.putImageData(id, 0, 0); return c; })();
const cardC = ART.cardArt(2048);
const BADGE = ART.badgeArt(EMB);
const tooth = tex(ART.toothNormal(512), { srgb: false, rep: 7 });
console.log(`art baked in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

// paper material: the print + the two mask textures (inks land on their hits) + a quadrant flash
const dtex = m => { const t = new THREE.DataTexture(m.data, m.S, m.S, THREE.RGBAFormat); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; return t; };
const U = { tA: { value: dtex(maskA) }, tB: { value: dtex(maskB) }, uA: { value: new THREE.Vector4() }, uB: { value: new THREE.Vector4() },
  uFlash: { value: new THREE.Vector4() }, uGlow: { value: 0 } };
function paperMat(map, side, { masks = false } = {}) {
  const m = new THREE.MeshStandardMaterial({ map, side, roughness: 0.9, metalness: 0, normalMap: tooth, normalScale: new THREE.Vector2(0.45, 0.45) });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D tA; uniform sampler2D tB; uniform vec4 uA; uniform vec4 uB; uniform vec4 uFlash; uniform float uGlow;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
${masks ? `{ vec2 q = vMapUv * 2.0 - 1.0; float inTL = step(q.x, 0.0) * step(0.0, q.y), inBR = step(0.0, q.x) * step(q.y, 0.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.97, 0.9), clamp(inTL * uFlash.x + inBR * uFlash.y, 0.0, 1.0) * 0.6); }
{ vec4 a = texture2D(tA, vMapUv) * uA; vec4 b = texture2D(tB, vMapUv) * uB;
  // a paper keyline round the printed words (the forme's shoulder), so the ink reads on the screened colour
  vec4 dil = vec4(0.0);
  for (int i = 0; i < 12; i++) { float ang = float(i) * 0.5236; dil = max(dil, texture2D(tA, vMapUv + vec2(cos(ang), sin(ang)) * 0.0042)); }
  float halo = clamp(dot(clamp(dil * uA - a, 0.0, 1.0), vec4(1.0)), 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.9, 0.82), halo * 0.92);
  vec3 K = vec3(0.125, 0.11, 0.11), GOLD = vec3(0.72, 0.56, 0.24);
  diffuseColor.rgb *= mix(vec3(1.0), K, clamp(a.r + a.g + a.b + a.a, 0.0, 1.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.18, 0.2, 0.26), b.r);
  diffuseColor.rgb = mix(diffuseColor.rgb, GOLD, b.g);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.2, 0.18, 0.18), b.b);
  diffuseColor.rgb *= mix(vec3(1.0), K, b.a);
  }` : ''}
diffuseColor.rgb += uGlow * vec3(0.18, 0.12, 0.06);`);
  };
  m.customProgramCacheKey = () => (masks ? 'ascM' : 'ascP');
  return m;
}
const frontMat = paperMat(tex(frontC), THREE.FrontSide, { masks: true }), backMat = paperMat(tex(backC), THREE.BackSide);
const sheet = new FoldMesh(sheetPoint, [-1, 1, -1, 1], 201, 201, frontMat, backMat);
scene.add(sheet.group);
const BW = 0.15, BH = BW * BADGE.aspect;                    // the badge card (m)
const badgeMat = (map, side) => { const tx = tex(map); return new THREE.MeshStandardMaterial({ map: tx, side, roughness: 0.88, metalness: 0, normalMap: tooth, normalScale: new THREE.Vector2(0.4, 0.4), emissive: 0xffffff, emissiveMap: tx, emissiveIntensity: 0 }); };
const badge = new THREE.Group();
const badgeFront = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), badgeMat(BADGE.front, THREE.FrontSide));
const badgeBack = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), badgeMat(BADGE.back, THREE.BackSide));
const badgeEdge = new THREE.Mesh(new THREE.BoxGeometry(BW, BH, 0.0014), new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: 0.9 }));
badgeEdge.position.z = -0.0009;
for (const m of [badgeFront, badgeBack, badgeEdge]) { m.castShadow = true; m.receiveShadow = true; badge.add(m); }
badge.visible = false; scene.add(badge);
const halo = new THREE.PointLight(0xffd9a0, 0, 2.5, 1.6); scene.add(halo);       // the hard light the mark carries up with it
const card = new THREE.Mesh(new THREE.PlaneGeometry(1.62 * K, 1.62 * K).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex(cardC), roughness: 0.9, normalMap: tooth, normalScale: new THREE.Vector2(0.5, 0.5) }));
card.position.set(0, TABLE + 0.0003, 0); card.receiveShadow = true; scene.add(card);
const bench = new THREE.Mesh(new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex(ART.benchTex(1024), { rep: 3 }), roughness: 0.62, metalness: 0 }));
bench.position.y = TABLE; bench.receiveShadow = true; scene.add(bench);

// one hard rake from the upper left (low, warm), a cool skylight fill that keeps the shadow side from going black
const key = new THREE.DirectionalLight(0xfff1dc, 3.4);
key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.00015; key.shadow.normalBias = 0.0006;
Object.assign(key.shadow.camera, { left: -0.32, right: 0.32, top: 0.32, bottom: -0.32, near: 0.05, far: 4 });
scene.add(key, key.target);
const fill = new THREE.HemisphereLight(0x9aa6b8, 0x2a2018, 0.55); scene.add(fill);
const RAKE = V3(0.66, 0.4, -0.62).normalize();           // toward the light: upper right of frame, 24 degrees up (the arms, from the lower left, throw their shadows off the sheet)
const RAKE_L = V3(-0.66, 0.4, -0.62).normalize();
function setKey(target, dir = RAKE, I = 3.4, span = 0.32) {
  key.target.position.copy(target); key.position.copy(target).addScaledVector(dir, 1.6); key.intensity = I;
  Object.assign(key.shadow.camera, { left: -span, right: span, top: span, bottom: -span }); key.shadow.camera.updateProjectionMatrix();
}

// ================================================================ the worker's hands (hero.js; only forearms ever reach the frame)
const heroData = await loadHeroData();
const hero = new Hero(heroData, { variant: 'plains', height: 1.8, kind: 'work', sleeve: 0.88, shirt: '#6b5a3c', shirt2: '#4a3d28', trousers: '#2b3444',
  skin: '#a8714f', hair: '#24180f', beard: 0.2, stubble: 0.5, seed: 29, dirt: 0.3, gloves: true, gloveColor: '#9a7646' });
scene.add(hero.group); hero.watch(camera);
// no face, ever: the head (and its hair) is collapsed into the neck; the camera only ever wants the forearms
for (const nm of ['head', 'neck03', 'neck02']) if (hero.bone(nm)) hero.bone(nm).scale.setScalar(0.02);
hero.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
// the hi-vis cuff: a reflective band round the right sleeve end
{ const sd = 'R', i = hero.idx[`lowerarm01.${sd}`], w = hero.head0[hero.idx[`wrist.${sd}`]], e = hero.head0[i], d = e.clone().sub(w).normalize(), s = hero.scale;
  const place = g => g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d)).translate(w.x - e.x, w.y - e.y, w.z - e.z);
  const m = new THREE.Mesh(place(new THREE.CylinderGeometry(0.047 / s, 0.043 / s, 0.05 / s, 20, 1, true).translate(0, 0.075 / s, 0)),
    new THREE.MeshStandardMaterial({ color: 0xc9e62a, roughness: 0.5, emissive: 0x2a3300, side: THREE.DoubleSide }));
  const band = new THREE.Mesh(place(new THREE.CylinderGeometry(0.0485 / s, 0.0445 / s, 0.012 / s, 20, 1, true).translate(0, 0.075 / s, 0)),
    new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.25, metalness: 0.6, side: THREE.DoubleSide }));
  m.castShadow = band.castShadow = true; hero.bone(`lowerarm01.${sd}`).add(m, band); }
GESTURES.ASC_L = { target: [0.2, 1.1, 0.4], pole: [1, -0.8, -0.3], prop: true };
GESTURES.ASC_R = { target: [0.2, 1.1, 0.4], pole: [1, -0.8, -0.3], prop: true };
const bodyTgt = (side, P) => { const F = hero._body(), k = hero.o.height / 1.78, rel = P.clone().sub(F.o), s = side === 'L' ? 1 : -1; return [s * rel.dot(F.xL) / k, rel.dot(F.up) / k, rel.dot(F.fwd) / k]; };
const qBetween = (a1, b1, a2, b2) => {   // rotation taking the frame (a1, b1) onto (a2, b2)
  const m1 = new THREE.Matrix4().makeBasis(a1, b1, a1.clone().cross(b1).normalize()), m2 = new THREE.Matrix4().makeBasis(a2, b2, a2.clone().cross(b2).normalize());
  return new THREE.Quaternion().setFromRotationMatrix(m2.multiply(m1.transpose()));
};
// pose: { at: V3 body origin (floor), yaw, lean, L/R: { tip: V3 (where the fingertips press), f: finger direction, n: palm normal, curl 0..1 } }
function poseHero(pose) {
  hero.resetPose(); hero.group.position.copy(pose.at); hero.group.rotation.y = pose.yaw ?? Math.PI; hero.update();
  const F0 = hero._body();
  if (pose.lean) { hero.rotateWorld('spine04', F0.xL, pose.lean * 0.5); hero.rotateWorld('spine02', F0.xL, pose.lean * 0.5); hero.update(); }
  for (const side of ['L', 'R']) {
    const S = pose[side];
    if (!S) { GESTURES[`ASC_${side}`].target = [0.2, 0.95, 0.12]; GESTURES[`ASC_${side}`].pole = [1, -0.8, -0.3]; hero.gesture(side, `ASC_${side}`, { fist: false }); hero.relaxHand(side, 0.5); continue; }
    const f = S.f.clone().normalize(), n = S.n.clone().sub(f.clone().multiplyScalar(S.n.dot(f))).normalize();
    const tgt = S.tip.clone().addScaledVector(f, -0.075).addScaledVector(n, 0.02);
    for (let it = 0; it < 3; it++) {
      GESTURES[`ASC_${side}`].target = bodyTgt(side, tgt);
      GESTURES[`ASC_${side}`].pole = S.pole || [1, -0.8, -0.3];
      hero.gesture(side, `ASC_${side}`, { fist: false });
      const P = hero.palm(side);
      const q = qBetween(P.f.clone().normalize(), P.n.clone().normalize(), f, n);
      const ang = 2 * Math.acos(clamp(q.w, -1, 1));
      if (ang > 1e-4) { const ax = V3(q.x, q.y, q.z).normalize(); hero.rotateWorld(`wrist.${side}`, ax, ang > Math.PI ? ang - TAU : ang); }
      hero.update();
      const P2 = hero.palm(side), tipNow = P2.c.clone().addScaledVector(P2.f, 0.075).addScaledVector(P2.n, -0.02);
      const err = S.tip.clone().sub(tipNow); if (err.length() < 0.004) break; tgt.add(err);
    }
    hero.relaxHand(side, S.curl ?? 0.35);
  }
  hero.update();
}
const heroAt = V3(-0.02, 0, 0.5);                         // standing at the bench's south edge, facing north (away from the rake)

// ================================================================ helpers: sheet points in the world
const toW = (P, k = K) => V3(P[0] * k, TABLE + P[2] * k, -P[1] * k);
const sheetW = (u, v, st) => toW(sheetPoint(u, v, st, [0, 0, 0]));
// the sheet's local frame at (u, v): inward (toward (u2, v2)) and the printed side's normal
function sheetFrame(u, v, u2, v2, st) {
  const p = sheetW(u, v, st), q = sheetW(u2, v2, st), r = sheetW(u + (v2 - v) * 0.3, v - (u2 - u) * 0.3, st);
  const f = q.clone().sub(p).normalize(), side = r.clone().sub(p).normalize(); const n = side.clone().cross(f).normalize();
  return { p, f, n };
}
// ================================================================ the words as paper slips (torn newsprint, printed)
const SLIPS = new Map();
function slipCanvas(w) {
  if (SLIPS.has(w)) return SLIPS.get(w);
  const lines = w.text.split('/'), cap = w.cap, fam = 'Big Shoulders Display', size = cap / 0.74, lead = cap * 1.2, g0 = ART.cv(8).getContext('2d'); g0.font = `900 ${size}px "${fam}"`;
  const ws = lines.map(l => g0.measureText(l).width); let tw = Math.max(...ws), sx = 1; const maxW = 1000 - cap * 0.5; if (tw > maxW) { sx = maxW / tw; tw = maxW; }
  const padX = cap * 0.34, padY = cap * 0.3, cw = Math.ceil(tw + 2 * padX), ch = Math.ceil(cap + (lines.length - 1) * lead + 2 * padY);
  const st = ART.stock(cw + 40, ch + 40, ART.PAPER.news, 101 + Math.round(w.b * 7)), c = ART.cv(cw + 40, ch + 40), g = c.getContext('2d');
  const r = rng(300 + Math.round(w.b * 13));
  // torn outline: ragged long edges, cleaner short edges (torn from a sheet along a rule)
  const path = new Path2D(), pts = [];
  const jag = (x0, y0, x1, y1, amp, n) => { for (let i = 0; i <= n; i++) { const u = i / n, x = lerp(x0, x1, u), y = lerp(y0, y1, u); pts.push([x + (x0 === x1 ? (r() - 0.5) * amp : 0), y + (y0 === y1 ? (r() - 0.5) * amp : 0)]); } };
  jag(20, 20, 20 + cw, 20, 7, 60); jag(20 + cw, 20, 20 + cw, 20 + ch, 4, 10); jag(20 + cw, 20 + ch, 20, 20 + ch, 7, 60); jag(20, 20 + ch, 20, 20, 4, 10);
  pts.forEach(([x, y], i) => i ? path.lineTo(x, y) : path.moveTo(x, y)); path.closePath();
  g.save(); g.clip(path); g.drawImage(st, 0, 0);
  g.fillStyle = w.ink === 'red' ? `rgb(${ART.INK.red.join(',')})` : `rgb(${ART.INK.K.join(',')})`;
  g.font = `900 ${size}px "${fam}"`; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  lines.forEach((l, i) => { g.save(); g.translate(20 + padX + (tw - ws[i] * sx) / 2, 20 + padY + cap + i * lead); g.scale(sx, 1); g.globalCompositeOperation = 'multiply'; g.fillText(l, 0, 0); g.restore(); });
  // ink voids (the slip was pulled from a worn forme), then the fibre rim of the tear
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < cw * ch / 300; i++) { g.fillStyle = `rgba(232,225,208,${0.4 + r() * 0.6})`; g.beginPath(); g.ellipse(20 + r() * cw, 20 + r() * ch, 0.5 + r() * 2.2, 0.4 + r() * 1.4, r() * 3, 0, 7); g.fill(); }
  g.restore();
  g.save(); g.strokeStyle = 'rgba(250,247,238,0.9)'; g.lineWidth = 3; g.stroke(path); g.restore();
  const S = { c, w: cw + 40, h: ch + 40 };
  SLIPS.set(w, S); return S;
}
function drawSlip(w, beat) {
  const age = (beat - w.b) * SPB; if (age < 0 || beat >= w.e) return;
  const S = slipCanvas(w), f = Math.floor(age * 30 + 1e-6);
  const k = w.small ? 1 : f === 0 ? 1.07 : f === 1 ? 1.015 : 1, lift = f === 0 ? 18 : f === 1 ? 8 : 4;
  ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(w.rot || 0); ctx.scale(k, k);
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 10 + lift; ctx.shadowOffsetX = 8 + lift * 0.4; ctx.shadowOffsetY = 10 + lift * 0.6;
  ctx.drawImage(S.c, -S.w / 2, -S.h / 2); ctx.restore();
}

// ================================================================ the sky: the room the mark rises into (warm light, no field, no band)
function drawBackdrop(mix, gx, gy) {
  ctx.fillStyle = '#0d0a08'; ctx.fillRect(0, 0, W, H);
  if (mix <= 0) return;
  const g = ctx.createRadialGradient(gx, gy, 30, gx, gy, 1500);
  g.addColorStop(0, `rgba(255,246,222,${mix})`); g.addColorStop(0.3, `rgba(240,228,198,${mix * 0.97})`); g.addColorStop(0.7, `rgba(190,164,126,${mix * 0.92})`); g.addColorStop(1, `rgba(96,76,56,${mix * 0.9})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

// ASCENDED.: extruded caps (ink on the light: red faces, a black side, the lower edge lit). Three chunks, AS | CEN | DED.: the
// accent is on -CEN- (the scansion fit asks for it there), so it lands on the hit and the others arrive around it
const ASC = (() => { const cap = 250, size = cap / 0.72, c = ART.cv(W, 460), g = c.getContext('2d'); g.font = `${size}px Anton`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const tw = g.measureText('ASCENDED.').width, sx = Math.min(1, 900 / tw); g.translate(W / 2, 330); g.scale(sx, 1);
  for (let k = 22; k > 0; k--) { g.fillStyle = k > 3 ? `rgb(${24 + k},${20 + k},${20 + k})` : '#f2e2c2'; g.fillText('ASCENDED.', k * 0.55, k * 0.9); }
  g.fillStyle = `rgb(${ART.INK.red.join(',')})`; g.fillText('ASCENDED.', 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0); g.textAlign = 'left';
  const w1 = g.measureText('AS').width * sx, w2 = g.measureText('ASCEN').width * sx, left = W / 2 - tw * sx / 2;
  return { c, cuts: [left - 10, left + w1, left + w2, W - 10] }; })();
function drawAscended(beat, y0) {
  const chunks = [[ASC.cuts[0], ASC.cuts[1], 61.5], [ASC.cuts[1], ASC.cuts[2], 62.0], [ASC.cuts[2], ASC.cuts[3], 62.5]];
  chunks.forEach(([x0, x1, b], i) => {
    if (beat < b) return;
    const f = Math.floor((beat - b) * SPB * 30 + 1e-6), k = i === 1 ? (f === 0 ? 1.14 : f === 1 ? 1.06 : f === 2 ? 1.02 : 1) : (f === 0 ? 1.04 : 1);
    const cx = (x0 + x1) / 2, cy = y0 + 150;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
    ctx.beginPath(); ctx.rect(x0, y0 - 30, x1 - x0, 520); ctx.clip();
    ctx.shadowColor = 'rgba(40,20,10,0.35)'; ctx.shadowBlur = 14; ctx.drawImage(ASC.c, 0, y0 - 30);
    ctx.restore();
  });
}

// ================================================================ the post: grain + vignette
const grains = [0, 1, 2, 3].map(i => { const c = ART.cv(270, 480), g = c.getContext('2d'), id = g.createImageData(270, 480), r = rng(900 + i);
  for (let k = 0; k < 270 * 480; k++) { const v = 128 + (r() - 0.5) * 120; id.data[k * 4] = id.data[k * 4 + 1] = id.data[k * 4 + 2] = v; id.data[k * 4 + 3] = 255; } g.putImageData(id, 0, 0); return c; });
function finish(t, { vig = 0.5 } = {}) {
  ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.16; ctx.imageSmoothingEnabled = true; ctx.drawImage(grains[Math.floor(t * 12) % 4], 0, 0, W, H); ctx.restore();
  const gr = ctx.createRadialGradient(W / 2, H * 0.47, H * 0.28, W / 2, H * 0.5, H * 0.72); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${vig})`);
  ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
}

// ================================================================ camera
// aim at a sheet point (u, v) from dist (m), tilt from vertical, az (0 = from the south, +: from the east), roll
function aim(u, v, dist, tilt = 0, az = 0, roll = 0, fov = 28, z = 0) {
  const T = V3(u * K, TABLE + z * K, -v * K);
  const hdir = V3(Math.sin(az), 0, Math.cos(az));
  camera.position.copy(T).addScaledVector(hdir, dist * Math.sin(tilt)).add(V3(0, dist * Math.cos(tilt), 0));
  camera.up.set(-hdir.x, 0, -hdir.z); camera.fov = fov; camera.updateProjectionMatrix(); camera.lookAt(T);
  if (roll) camera.rotateZ(roll);
  return T;
}
const mixCam = (a, b, u) => a.map((x, i) => lerp(x, b[i], u));
// a keyframed path: [[beat, u, v, dist, tilt, az, roll], ...] eased between keys
function path(keys, beat) {
  if (beat <= keys[0][0]) return keys[0].slice(1);
  for (let i = 0; i < keys.length - 1; i++) { const a = keys[i], b = keys[i + 1]; if (beat < b[0]) { const e = ease.inOutCubic((beat - a[0]) / (b[0] - a[0])); return mixCam(a.slice(1), b.slice(1), e); } }
  return keys[keys.length - 1].slice(1);
}


// ================================================================ the timeline
function sheetState(beat) {
  const st = { liftTL: 0, liftBR: 0, p1: 0, flip: 0, p2: 0, flipLift: 0 };
  // frame 0: the TL corner is already lifting; b2 both corners flex together; b4 set down
  st.liftTL = beat < 4.4 ? lerp(0.5, 0.72, smooth(0, 2, beat)) * (1 - smooth(3.7, 4.4, beat)) : 0;
  st.liftBR = beat < 4.5 ? 0.62 * smooth(1.2, 2.0, beat) * (1 - smooth(3.8, 4.5, beat)) : 0;
  // pleat 1: rises to 60 % from b11.55 (as he says "take things to"), freezes, closes onto b16 ("conclusion" ends)
  if (beat >= 11.55) st.p1 = beat < 12 ? 0.6 * ease.outCubic((beat - 11.55) / 0.45) : beat < 15.1 ? 0.6 : Math.min(1, lerp(0.6, 1, ease.inCubic((beat - 15.1) / 0.9)));
  if (beat >= 16) st.p1 = 1;
  // the turn: b36 lifts, over by b39.5
  if (beat >= 36) { const u = clamp((beat - 36) / 3.5); st.flip = ease.inOutCubic(u); st.flipLift = 0.35 * Math.sin(Math.PI * u); }
  // the Fold-In: the middle stands up in his pause after "welfare," (b44.5-46.3), holds, and closes on "full" (b48)
  if (beat >= 44.5) st.p2 = beat < 46.3 ? 0.45 * ease.inOutCubic((beat - 44.5) / 1.8) : beat < 46.6 ? 0.45 : Math.min(1, lerp(0.45, 1, ease.inCubic((beat - 46.6) / 1.4)));
  if (beat >= 48) st.p2 = 1;
  return st;
}

// bench oner keys: [beat, u, v, dist, tilt, az, roll]; the paper fills the frame in the middle third (it is a macro piece)
const BENCH = [
  [0, 0.0, 0.02, 0.84, 0.0, 0, 0], [3.6, 0.0, 0.02, 0.8, 0.0, 0, 0.0],
  [4.6, 0.74, -0.42, 0.34, 0.2, 0.15, 0.03], [5.6, 0.72, -0.44, 0.31, 0.22, 0.2, 0.04],
  [6.6, 0.02, 0.0, 0.34, 0.25, -0.2, -0.02], [7.6, 0.0, 0.0, 0.3, 0.3, -0.25, -0.03],
  [8.6, 0.0, 0.0, 0.78, 0.12, 0, 0], [9.6, 0.0, 0.0, 0.7, 0.12, 0, 0],
  [10.6, 0.3, 0.27, 0.16, 0.18, 0.3, 0.05], [11.45, 0.32, 0.28, 0.13, 0.2, 0.35, 0.06],
  [11.95, 0.1, 0.12, 0.68, 0.3, 0.1, 0], [15.9, 0.05, 0.1, 0.56, 0.34, 0.12, 0],
];
const JOIN = [
  [16, -0.5, 0.5, 0.72, 0.05, 0, 0], [17.9, -0.5, 0.5, 0.62, 0.08, 0, 0],
  [18, -0.5, 0.48, 0.62, 0.42, 0.3, 0.0], [26, -0.5, 0.5, 0.55, 0.38, 0.18, 0.0],
  [31.9, -0.5, 0.5, 0.52, 0.3, 0.06, 0],
];
const TURN = [
  [32, -0.5, 0.5, 0.56, 0.3, 0.06, 0], [35.4, -0.5, 0.45, 0.6, 0.2, 0, 0],
  [36.5, 0.0, 0.15, 1.05, 0.0, 0, 0], [39.6, 0.25, -0.25, 0.9, 0.0, 0, 0],
  [40, 0.15, -0.45, 0.72, 0.08, 0, 0], [44, 0.15, -0.5, 0.64, 0.06, 0, 0],
  [47.9, 0.0, -0.5, 0.6, 0.05, 0, 0],
];
const REVEAL = [[48, -0.13, -0.55, 0.6, 0.05, 0, 0], [52, -0.1, -0.55, 0.56, 0.05, 0, 0.0]];
// the ascent: [beat, u, v, dist, tilt, az, roll, fov, z]: the camera tips from over the sheet to level with it, and rises with the mark
const ASCENT = [
  [52, -0.1, -0.55, 0.56, 0.05, 0, 0, 28, 0], [53.6, -0.06, -0.3, 0.7, 0.55, 0, 0, 28, 0.35],
  [56, 0.0, 0.0, 0.85, 1.1, 0, 0, 28, 0.85], [58.2, 0.0, 0.1, 0.95, 1.3, 0, 0, 28, 1.1],
  [62, 0.0, 0.2, 1.05, 1.42, 0, 0, 28, 1.3], [CARD_B, 0.0, 0.2, 1.0, 1.42, 0, 0, 28, 1.32],
];

function shotName(beat) { let s = SHOTS[0][1]; for (const [b, n] of SHOTS) if (beat >= b) s = n; return s; }

// hands per beat (null = the worker is out of frame). Every reach is palm down, the fingers along the reach (from the
// shoulder toward the point), so the wrist stays straight and the forearm comes in from the bottom of the frame.
const SHL = V3(-0.2, 1.42, 0.3), SHR = V3(0.16, 1.42, 0.3);
const reach = (tip, sh, droop = 0.35) => { const d = tip.clone().sub(sh); d.y = 0; d.normalize(); d.y = -droop; return d.normalize(); };
function hand(tip, side, { curl = 0.5, droop = 0.35, n = null, f = null } = {}) {
  const ff = f || reach(tip, side === 'L' ? SHL : SHR, droop), nn = n || V3(0, -1, 0);
  return { tip, f: ff, n: nn, curl };
}
function handsAt(beat, st) {
  if (beat < 4.6) {
    const out = smooth(3.9, 4.6, beat);                  // set down, hands back out of frame (south)
    const pull = V3(0, 0.06 * out, 0.32 * out);
    const pose = { at: heroAt, lean: 0.36, L: hand(sheetW(-0.94, 0.94, st).add(pull), 'L', { curl: 0.55 }) };
    if (beat > 1.1) { const k = smooth(1.1, 1.8, beat); pose.R = hand(sheetW(0.95, -0.95, st).add(V3(0.04 * (1 - k), 0.05 * (1 - k), 0.25 * (1 - k))).add(pull), 'R', { curl: 0.55 }); }
    return pose;
  }
  if (beat >= 11.3 && beat < 16.8) {
    const out = smooth(16.0, 16.8, beat), inn = smooth(11.3, 11.6, beat);
    const away = V3(0, 0.1 * out, 0.3 * (1 - inn) + 0.3 * out);
    return { at: heroAt, lean: 0.36,
      L: hand(sheetW(-0.45, 0.35, st).add(V3(0, 0.004, 0)).add(away), 'L', { curl: 0.1, droop: 0.15 }),
      R: hand(sheetW(0.93, -0.93, st).add(away), 'R', { curl: 0.55 }) };
  }
  if (false && beat >= 23.4 && beat < 28) {
    const u = clamp((beat - 24) / 3.4), inn = smooth(23.4, 24, beat), out = smooth(27.5, 28, beat);
    const p = sheetW(lerp(-0.72, 0.62, u), lerp(-0.76, 0.66, u), st);
    return { at: heroAt, lean: 0.34, R: hand(p.add(V3(0.015, 0.012 + 0.1 * out, 0.3 * (1 - inn) + 0.3 * out)), 'R', { curl: 0.85, f: V3(0.6, -0.3, -0.75) }) };
  }
  if (beat >= 35.4 && beat < 40.4) {
    const inn = smooth(35.4, 36, beat), out = smooth(39.6, 40.4, beat);
    return { at: heroAt, lean: 0.34, L: hand(sheetW(-0.92, 0.92, st).add(V3(0, 0.1 * out, 0.3 * (1 - inn) + 0.3 * out)), 'L', { curl: 0.55 }) };
  }
  if (beat >= 43.4 && beat < 48.8) {
    const inn = smooth(43.4, 44, beat), out = smooth(48.1, 48.8, beat);
    return { at: heroAt, lean: 0.36, R: hand(sheetW(-0.93, 0.97, st).add(V3(0, 0.12 * out, 0.3 * (1 - inn) + 0.3 * out)), 'R', { curl: 0.55 }) };
  }
  return null;
}


// ================================================================ frame
const BADGE_HOME = V3(-0.0182, TABLE + 0.004, 0.084);        // where the mark leaves the sheet: under FULL / COMMUNISM.
window.renderFrame = async (t) => {
  const beat = t / SPB, shot = shotName(beat);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  U.uA.value.set(0, 0, 0, 0); U.uB.value.set(0, 0, 0, 0); U.uFlash.value.set(0, 0, 0, 0); U.uGlow.value = 0;
  sheet.group.visible = card.visible = badge.visible = false; bench.visible = true; hero.group.visible = false; halo.intensity = 0;
  fill.color.set(0x9aa6b8); fill.groundColor.set(0x2a2018); fill.intensity = 0.55;
  let flash = 0, vig = 0.55, bgMix = 0, glow = [W / 2, H * 0.4], ascY = null;
  const onHit = (b, n = 1) => beat >= b && beat < b + n * FR / SPB;

  if (beat < 52 || beat >= LOOP_B) {
    // ---------------- the sheet on the bench
    const loopIn = beat >= LOOP_B;
    const st = loopIn ? { liftTL: 0.5 * smooth(LOOP_B + 0.7, END_B, beat), liftBR: 0, p1: 0, flip: 0, p2: 0 } : sheetState(beat);
    sheet.group.visible = true; sheet.update(st, K);
    sheet.group.position.set(loopIn ? -2.6 * K * (1 - ease.outCubic(clamp((beat - LOOP_B) / (END_B - LOOP_B)))) : 0, TABLE + 0.0004, 0);
    if (loopIn) card.visible = true;
    // inks land on their hits (the print is instant; CAPITALIST. and COMMUNIST. land on his words)
    const ink = b => beat >= b ? 1 : 0;
    U.uA.value.set(ink(0), ink(1), ink(16), ink(26.4));
    U.uB.value.set(ink(4), ink(6), ink(8), ink(29.4));
    if (loopIn) { U.uA.value.set(1, 0, 0, 0); U.uB.value.set(0, 0, 0, 0); }
    U.uFlash.value.set(beat < 1 ? 0.45 * Math.exp(-beat * SPB * 9) : 0, beat >= 1 && beat < 2 ? 0.45 * Math.exp(-(beat - 1) * SPB * 9) : 0, 0, 0);
    let cam;
    if (loopIn) cam = [0.0, 0.02, 0.84, 0.0, 0, 0];
    else if (beat < 16) cam = path(BENCH, beat); else if (beat < 32) cam = path(JOIN, beat); else if (beat < 48) cam = path(TURN, beat); else cam = path(REVEAL, beat);
    if (QS.get('cam')) cam = QS.get('cam').split(',').map(Number);
    const T = aim(cam[0], cam[1], cam[2], cam[3], cam[4], cam[5]);
    // the rake comes from the upper right while the hands work (their shadows fall off the sheet), from the upper left
    // for the reveal (so the pleat's step throws its shadow away from the joined words)
    setKey(V3(T.x, TABLE, T.z), (beat >= 44 && beat < 52 || beat >= 52) && !loopIn ? RAKE_L : RAKE, 3.4, Math.max(0.12, cam[2] * 0.3));
    const pose = loopIn ? null : handsAt(beat, st);
    if (pose) { hero.group.visible = true; poseHero(pose); }
    if (onHit(16)) flash = 0.5;
  } else if (beat < CARD_B) {
    // ---------------- the ascent: the folded compass is a floor, and the mark lifts off it into the light
    const stF = { liftTL: 0, liftBR: 0, p1: 1, flip: 1, p2: 1, flipLift: 0 };
    sheet.group.visible = true; sheet.update(stF, K); sheet.group.position.set(0, TABLE + 0.0004, 0);
    U.uA.value.set(1, 1, 1, 1); U.uB.value.set(1, 1, 1, 1);
    const cam = path(ASCENT, beat);
    const T = aim(cam[0], cam[1], cam[2], cam[3], cam[4], cam[5], cam[6], cam[7]);
    // the mark: grows out of the crease under the words, turns from lying on the sheet to standing, arrives upright and level
    const lift = ease.inOutCubic(clamp((beat - 52.3) / 9.2)), turn = ease.inOutCubic(clamp((beat - 53.0) / 5.6));
    const sc = 0.02 + 0.98 * ease.outCubic(clamp((beat - 51.9) / 4.5));
    badge.visible = true;
    badge.position.set(lerp(BADGE_HOME.x, 0, lift), TABLE + 0.004 + 0.2 * lift + 0.05 * Math.sin(Math.PI * lift) * (1 - lift), lerp(BADGE_HOME.z, 0.02, lift));
    badge.rotation.set(-Math.PI / 2 * (1 - turn), 0, 0.045 * Math.sin(beat * 1.9) * (1 - smooth(57, 61, beat)));
    badge.scale.setScalar(sc);
    badge.position.y += (BH * sc) / 2 * (1 - turn) * 0.0;          // (the card's centre leaves the sheet from its middle)
    const s = smooth(54, 60.5, beat);
    bgMix = s;
    const pr = badge.position.clone().project(camera);
    glow = [(pr.x * 0.5 + 0.5) * W, (1 - (pr.y * 0.5 + 0.5)) * H];
    halo.position.copy(badge.position).add(V3(0.04, 0.09, -0.12)); halo.intensity = 2.4 * smooth(55, 61.5, beat);
    fill.color.set(0xf2e6cc); fill.groundColor.set(0xb8a07c); fill.intensity = lerp(0.55, 1.5, s);
    setKey(V3(T.x, TABLE + 0.05, T.z), RAKE_L, lerp(3.4, 4.6, s), 0.32);
    U.uGlow.value = 0.2 * s; badgeFront.material.emissiveIntensity = 0.5 * smooth(55, 61, beat) + (onHit(62, 3) ? 0.4 : 0);
    vig = lerp(0.55, 0.32, s);
    ascY = 250;
    if (onHit(62)) flash = 0.35;
  } else {
    // ---------------- the card on the bench (same framing and light as frame 0)
    card.visible = true;
    const T = aim(0.0, 0.02, 0.84, 0.0, 0, 0);
    setKey(V3(T.x, TABLE, T.z), RAKE, 3.4, 0.32);
  }

  renderer.render(scene, camera);
  // ---------------- composite
  ctx.clearRect(0, 0, W, H);
  drawBackdrop(bgMix, glow[0], glow[1]);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  RQ.present(ctx, renderer.domElement, renderer.getContext(), { w: W, h: H });
  for (const w of WORDS) if (w.where === 'slip') drawSlip(w, beat);
  if (ascY !== null) drawAscended(beat, ascY);
  finish(t, { vig });
  if (flash > 0) { ctx.fillStyle = `rgba(255,252,244,${0.9 * flash})`; ctx.fillRect(0, 0, W, H); }
};

window.sceneReady = true;
