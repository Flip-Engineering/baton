// MECHA KIT fortress (MODELING c2): the ACP installation of the reference painting (acp_fortress.jpg) as a model: a battered white concrete
// mass with a stepped gate, tank cluster, mast and a flank of annexes. It is the SET for the match test (the machines are judged in
// the reference's own camera and light) and a worked backdrop. The mark and the black ACP lettering are decals on the facade
// (the only red in the picture is the mark). Forward (toward the camera) is +Z; the facade sits at z = -45.
import * as THREE from 'three';
import { mesh, rbox, box, cylY, cylZ, strut, PAL, V, nextPid, decalPlane, paint } from './parts.js';
import { drawMark, RED } from '../../../closer.js';

function panelTexture(w = 1024, h = 1024, { seam = 5, seed = 4, stain = true, base = '#ffffff' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, w, h);
  let s = seed * 7919; const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  g.strokeStyle = 'rgba(70,66,80,.55)'; g.lineWidth = 2;
  for (let i = 1; i < seam; i++) { g.beginPath(); g.moveTo(i * w / seam, 0); g.lineTo(i * w / seam, h); g.stroke(); }
  for (let j = 1; j < seam * 2; j++) { g.beginPath(); g.moveTo(0, j * h / (seam * 2)); g.lineTo(w, j * h / (seam * 2)); g.stroke(); }
  g.fillStyle = 'rgba(60,56,70,.5)'; for (let i = 0; i < seam; i++) for (let j = 0; j < seam * 2; j++) for (const [dx, dy] of [[.06, .08], [.94, .08], [.06, .92], [.94, .92]]) { g.beginPath(); g.arc((i + dx) * w / seam, (j + dy) * h / (seam * 2), 2.2, 0, 7); g.fill(); }
  if (stain) for (let i = 0; i < 26; i++) { const x = r() * w, y = r() * h * .6, L = 80 + r() * 260; const gr = g.createLinearGradient(0, y, 0, y + L); gr.addColorStop(0, 'rgba(90,84,76,.22)'); gr.addColorStop(1, 'rgba(90,84,76,0)'); g.fillStyle = gr; g.fillRect(x, y, 6 + r() * 14, L); }
  const t = new THREE.CanvasTexture(g.canvas); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; return t;
}
function wallMat(tex, color = PAL.white) { return new THREE.MeshLambertMaterial({ color, map: tex }); }
function groundTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 1024; const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1024, 1024);
  g.strokeStyle = 'rgba(60,58,70,.6)'; g.lineWidth = 3; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 256, 0); g.lineTo(i * 256, 1024); g.stroke(); g.beginPath(); g.moveTo(0, i * 256); g.lineTo(1024, i * 256); g.stroke(); }
  
  const t = new THREE.CanvasTexture(g.canvas); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; return t;
}
// battered wall: a trapezoid prism (wider at the foot), width w, height h, depth d, batter b (m inward at the top)
function batter(w, h, d, b, mat, o = {}) {
  const s = new THREE.Shape(); s.moveTo(-d / 2, 0); s.lineTo(d / 2, 0); s.lineTo(d / 2 - b, h); s.lineTo(-d / 2 + b, h); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false }); g.translate(0, 0, -w / 2); g.rotateY(Math.PI / 2);
  // uv: world-ish for the panel texture
  const p = g.attributes.position, uv = new Float32Array(p.count * 2), n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) { const nx = Math.abs(n.getX(i)), nz = Math.abs(n.getZ(i)); uv[i * 2] = (nx > nz ? p.getZ(i) : p.getX(i)) / 8; uv[i * 2 + 1] = p.getY(i) / 8; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return mesh(g, mat, o);
}
export function buildFortress(parent, { z0 = -45, x0 = 0, scale = 1, yaw = 0 } = {}) {
  const G = new THREE.Group(); parent.add(G); G.position.set(x0, 0, z0); G.scale.setScalar(scale); G.rotation.y = yaw;
  const tex = panelTexture(), tex2 = panelTexture(1024, 1024, { seam: 3, seed: 9 });
  const M = wallMat(tex), M2 = wallMat(tex2, PAL.cream), cls = { cls: 'far' };
  const uvBox = (w, h, d, mat, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) { const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)); uv.setXY(i, (nx > .5 ? p.getZ(i) : p.getX(i)) / 8 + x / 8, (ny > .5 ? p.getZ(i) : p.getY(i)) / 8 + y / 8); } const m = mesh(g, mat, cls); m.position.set(x, y, z); G.add(m); return m; };
  // main mass: battered lower, straight upper, a stepped crown
  const lower = batter(34, 13, 24, 3.2, M, cls); lower.position.set(0, 0, -4); G.add(lower);
  uvBox(26, 14, 18, M, 0, 13 + 7, -3);
  uvBox(18, 6, 12, M2, 0, 27 + 3 - 6, -1);
  uvBox(7, 5, 6, M, 0, 28.5 + 3, -2); uvBox(3, 8, 3, M2, 0, 38, -2);
  const mastA = cylY(.25, 12, PAL.steelLt, { ...cls }, 6); mastA.position.set(0, 46, -2); G.add(mastA);
  // wings
  uvBox(16, 12, 14, M2, -26, 6, 0); uvBox(12, 7, 9, M, -41, 3.5, 3); const wl = batter(16, 6, 14, 2.5, M, cls); wl.position.set(-26, 12, 0); G.add(wl);
  uvBox(16, 10, 12, M2, 26, 5, 1); const wr = batter(14, 4, 12, 2, M, cls); wr.position.set(26, 10, 1); G.add(wr);
  uvBox(50, 7, 12, M2, -64, 3.5, 4); uvBox(46, 7, 12, M2, 62, 3.5, 4);
  // tank cluster at the right: three tall cylinders with bands, a pipe run and a lamp mast
  for (const [tx, tz, r, h] of [[19, 8, 3.2, 26], [26.5, 3, 2.6, 20], [14.5, 4, 2, 17]]) { const tk = cylY(r, h, PAL.cream, { ...cls }, 28); tk.position.set(tx, h / 2, tz); G.add(tk); for (const yy of [.3, .55, .8]) { const b = cylY(r * 1.02, .35, PAL.concreteDk, { ...cls }, 28); b.position.set(tx, h * yy, tz); G.add(b); } const dm = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), paint(PAL.cream)); dm.userData.pid = nextPid(); dm.userData.cls = 'far'; dm.position.set(tx, h, tz); dm.castShadow = true; G.add(dm); }
  for (let i = 0; i < 5; i++) { const pp = cylY(.45, 18 - i * 2, PAL.concreteDk, { ...cls }, 10); pp.position.set(12 + i * 2.2, (18 - i * 2) / 2, 6.5); G.add(pp); }
  const mast2 = cylY(.3, 22, PAL.steelLt, { ...cls }, 6); mast2.position.set(36, 11, 4); G.add(mast2); const dish = cylZ(1.8, .4, PAL.cream, { ...cls }, 20, .3); dish.position.set(36, 20, 4.2); G.add(dish);
  const mast3 = cylY(.3, 20, PAL.steelLt, { ...cls }, 6); mast3.position.set(-48, 10, 4); G.add(mast3); const dish3 = cylZ(1.4, .3, PAL.cream, { ...cls }, 20, .25); dish3.position.set(-48, 17, 4.2); G.add(dish3);
  // gate: a dark recess in the battered wall, a frame, a lintel, ramp-stairs up to it
  const gate = box(8.6, 12, 4, '#2a2e3a', { ...cls, line: true }); gate.position.set(0, 6.2, 8.2); G.add(gate);
  const fr = box(10.6, 1.0, 4.4, PAL.cream, { ...cls }); fr.position.set(0, 12.6, 8.3); G.add(fr);
  for (const sx of [-1, 1]) { const jm = box(1.0, 12.2, 4.4, PAL.cream, { ...cls }); jm.position.set(sx * 4.8, 6.1, 8.3); G.add(jm); }
  for (let i = 0; i < 14; i++) { const st = box(16 + i * .6, .45, 1.1, PAL.concrete, { ...cls }); st.position.set(0, .22 + i * .45, 12.8 - i * 1.1 + 4); G.add(st); }
  const slab = box(70, .6, 20, PAL.concrete, { ...cls }); slab.position.set(0, .3, 22); G.add(slab);
  // the mark and the lettering on the facade: ACP mark in red, ACP in black (the reference: the one red thing in the picture)
  const cvs = document.createElement('canvas'); cvs.width = 1024; cvs.height = 760; const g = cvs.getContext('2d');
  drawMark(g, 512, 270, 520, { color: RED });
  g.fillStyle = '#1e1b22'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.font = '900 360px "Archivo Black", "Anton", Impact, sans-serif'; g.fillText('ACP', 512, 720);
  const mt = new THREE.CanvasTexture(cvs); mt.colorSpace = THREE.NoColorSpace; mt.anisotropy = 4;
  const mk = decalPlane(mt, 15, 11.1, { pid: nextPid(), alphaTest: .4 }); mk.userData.cls = 'far'; mk.position.set(0, 21.5, 6.03); G.add(mk);
  // small details: a hazard triangle, door numbers, windows (dark slots), vents
  for (let i = 0; i < 4; i++) { const wd = box(1.2, 2.2, .3, '#3a3e4e', { ...cls }); wd.position.set(-9 + i * 1.8, 10, 6.4); G.add(wd); }
  for (let i = 0; i < 3; i++) { const wd = box(1.2, 2.4, .3, '#3a3e4e', { ...cls }); wd.position.set(-33 + i * 3, 6, 7.2); G.add(wd); }
  return G;
}
export function buildGround(parent, { size = 400, joint = 8, line = '#8b8896' } = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ color: PAL.road })); m.rotation.x = -Math.PI / 2; m.receiveShadow = true;
  m.userData.pid = 2; m.userData.cls = 'ground'; parent.add(m);
  // expansion joints as thin quads (a texture's lines turn to blurred bands at a grazing angle)
  const pos = [], n = Math.floor(Math.min(size, 90) / joint), w = .05, h = Math.min(size, 90) / 2;
  for (let i = -n / 2; i <= n / 2; i++) { const c = i * joint; pos.push(c - w, .004, -h, c + w, .004, -h, c + w, .004, h, c - w, .004, -h, c + w, .004, h, c - w, .004, h); pos.push(-h, .004, c - w, -h, .004, c + w, h, .004, c + w, -h, .004, c - w, h, .004, c + w, h, .004, c - w); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((v, i) => i % 3 === 1 ? 1 : 0), 3));
  const j = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: line, side: THREE.DoubleSide })); j.userData.pid = 2; j.userData.cls = 'ground'; j.receiveShadow = true; parent.add(j);
  return m;
}
