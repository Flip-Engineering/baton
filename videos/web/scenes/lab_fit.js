// LAB FIT (TOOLING R1): fitXform() test and demo. No song. tools/type_fit_test.mjs runs it:
// window.fitTest holds the assertions; window.renderFrame(k) draws case k (0..5) naive (red, left half of the story)
// and fitted (ink) over each other so the sheet shows what the clamp changed.
import { W, H } from '../lib/kit.js';
import { loadFace } from '../lib/fx/type.js';
import { setBlock, fitXform, xfBBox, blockPath, frameCrop, typeAudit } from '../lib/fx/type_world.js';

const ANTON = await loadFace('anton'), cv = document.getElementById('out'), ctx = cv.getContext('2d');
const B = {
  acc: setBlock(ANTON, 'ACCELERATE.', { role: 'slam', cap: 300, maxW: 1000 }),
  pay: setBlock(ANTON, 'AI SERVES HUMANITY.', { role: 'payoff', justify: true, maxW: 880 }),
  am: setBlock(ANTON, 'AMERICAN.', { role: 'slam', cap: 330, x: 700, y: 600 }),
  pro: setBlock(ANTON, 'PRO-AI.', { role: 'slam', cap: 420 }),
};
// [label, block, xf, fit options]
const CASES = [
  ['entry overshoot 1.22x, pushed left', B.acc, { s: 1.22, dx: -160 }, { pad: 28 }],
  ['slam rotated 12 deg at 1.4x', B.am, { s: 1.4, rot: 0.21 }, { pad: 28 }],
  ['stretched 4x tall, full width', B.acc, { s: 1.1, sy: 4 }, { pad: 28 }],
  ['frame 0 settle (entry scale dropped)', B.pro, { s: 1.3, rot: -0.1 }, { pad: 28, settle: true }],
  ['payoff, inside already: untouched', B.pay, { s: 1 }, { pad: 28 }],
  ['Reels band, keyline 22 + fringe 20', B.am, { s: 1.15, dy: -500 }, { bounds: 'safe', pad: 42 }],
];
const res = [], ok = (c, m) => { if (!c) res.push('FAIL ' + m); };
CASES.forEach(([label, b, xf, o], k) => {
  const f = fitXform(b, xf, o), bb = f.bbox, B0 = o.bounds === 'safe' ? { x1: 60, x2: 960, y1: 270, y2: 1250 } : { x1: 0, x2: W, y1: 0, y2: H }, p = o.pad - 0.5;
  ok(bb.x1 >= B0.x1 + p && bb.x2 <= B0.x2 - p && bb.y1 >= B0.y1 + p && bb.y2 <= B0.y2 - p, `${k} ${label}: bbox ${JSON.stringify(bb)} outside`);
  const real = xfBBox(b, f);                                             // the returned bbox is what the transform draws
  ok(Math.abs(real.x1 - bb.x1) < 0.5 && Math.abs(real.y2 - bb.y2) < 0.5, `${k}: bbox mismatch`);
  if (o.settle) ok(f.s === 1 && f.rot === 0, `${k}: settle kept s ${f.s} rot ${f.rot}`);
  if (k === 4) ok(!f.clamped.scale && !f.clamped.shift && f.s === 1, `${k}: an inside block was changed`);
  if (k === 2) ok((f.sy ?? 1) === 4, `${k}: the stretch ratio changed`);
  if (k === 1) ok(f.rot === xf.rot, `${k}: rotation changed`);
  const naive = frameCrop(xfBBox(b, xf));
  res.push(`case ${k} ${label}: naive crop ${naive.max.toFixed(0)} px -> fitted s ${f.s.toFixed(3)} d ${f.dx.toFixed(0)},${f.dy.toFixed(0)} clamped ${JSON.stringify(f.clamped)}`);
});
// typeAudit reports the crop on the naive transform and not on the fitted one
typeAudit.reset();
typeAudit.add(B.acc, { s: 1.22, dx: -160, world: 'naive' });
typeAudit.add(B.acc, { ...fitXform(B.acc, { s: 1.22, dx: -160 }), world: 'fitted' });
const [na, fi] = typeAudit.items;
ok(na.crop > 1 && na.issues.some(i => i.startsWith('cropped')), 'typeAudit missed the naive crop');
ok(fi.crop === 0 && !fi.issues.some(i => i.startsWith('cropped')), 'typeAudit flagged the fitted block');
window.fitTest = { pass: !res.some(r => r.startsWith('FAIL')), lines: res, audit: typeAudit.items };
window.CASES = CASES.map(c => c[0]);
window.typeInfo = () => typeAudit.items;

window.renderFrame = (k) => {
  const [label, b, xf, o] = CASES[Math.round(k) % CASES.length], f = fitXform(b, xf, o);
  ctx.fillStyle = '#efe6cf'; ctx.fillRect(0, 0, W, H);
  if (o.bounds === 'safe') { ctx.fillStyle = 'rgba(20,20,20,0.08)'; ctx.fillRect(0, 0, W, 270); ctx.fillRect(0, 1250, W, H - 1250); ctx.fillRect(960, 270, 120, 980); }
  ctx.save(); ctx.fillStyle = 'rgba(196,22,28,0.35)'; ctx.fill(blockPath(b, xf)); ctx.restore();        // what the scene asked for
  const p = blockPath(b, f);
  ctx.lineJoin = 'round'; ctx.strokeStyle = '#efe6cf'; ctx.lineWidth = 22; ctx.stroke(p);               // keyline
  ctx.fillStyle = '#0e0b0a'; ctx.fill(p);
  ctx.strokeStyle = '#1f6fd1'; ctx.lineWidth = 3; ctx.setLineDash([14, 10]);
  ctx.strokeRect(f.bbox.x1, f.bbox.y1, f.bbox.x2 - f.bbox.x1, f.bbox.y2 - f.bbox.y1); ctx.setLineDash([]);
  ctx.fillStyle = '#0e0b0a'; ctx.font = '600 40px sans-serif'; ctx.fillText(label, 40, 1860);
  ctx.fillStyle = '#c4161c'; ctx.fillText('red: as asked   ink: fitXform()', 40, 1800);
};
window.renderFrame(0);
window.sceneReady = true;
