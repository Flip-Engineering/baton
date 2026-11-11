// ANATOMY / SKELETON / CHEST WALL LEVELS (ANAT8-BODY, 8 Oct 2026, c2 iteration 2 = lane iteration 6): where the ribs are on a vertical line seen from the
// front, the way a clinician counts them (the midclavicular line, the nipple's meridian), so the soft tissue hung on the cage (the pectoralis' lower
// border, the inframammary fold, the nipple) can be placed BY RIB LEVEL. The same reading as labs/human8/anat8b/chest_test.mjs's frontBands (the gate
// keeps its own copy, so the gate does not move when this does). Metres, the person's bind space (x lateral, L = +x; y up; z forward).
//   import { ribBands, chestLevels } from '.../lib/fx/anatomy/skeleton/chest.js';
//   ribBands(K, x) -> [{ k, y0, y1 }]   top to bottom: the first rib part a ray from in front meets, per 1 mm of height (y0 the band's top, y1 its bottom)
//   chestLevels(K, S_) -> { xm, hi(k), lo(k), mid(k), ics(k), fold }   on the person's midclavicular line (cached on K)
//     hi / lo: the k-th rib's upper / lower edge (NaN when the rib does not show on the line); ics(k): the k-th intercostal space's centre;
//     fold: the INFRAMAMMARY FOLD's level, both sexes (sourced, imaging): midway between Wang et al. 2023 (Gland Surg 12:1067; 120 women, MRI: the fold
//     0.69 +- 1.40 cm below the 5th rib's lower edge; ICS5 43 %, the 5th rib 29 %, the 6th rib 20 %) and Oh et al. 2020 (Clin Anat 33:165; 80 women, CT:
//     the fold closest to the 6th rib, 5.3 mm from it); Azadgoli et al. 2023 (J Plast Reconstr Aesthet Surg 83:32; 60 chests): the 5th space in both sexes.
import { sdParts } from './sdf.js';
const CM = 0.01;
export function ribBands(K, x, { yTop = K.pts.jugular[1], yBot = K.pts.xiphoidTip[1] - 0.16, zFront = K.pts.xiphisternal[2] + 0.06, zStop = K.pts.xiphisternal[2] - 0.07, minH = 0.003 } = {}) {
  const ribs = K.parts.filter(p => /^rib\d+\./.test(p.name)), bands = []; let cur = null;
  for (let y = yTop; y > yBot; y -= 0.001) { let hit = null;
    for (let z = zFront; z > zStop; z -= 0.0015) { const r = sdParts(ribs, x, y, z, 0.01); if (r.d < 0) { hit = +ribs[r.i].name.match(/^rib(\d+)/)[1]; break; } }
    if (hit !== (cur && cur.k)) { if (cur) bands.push(cur); cur = hit ? { k: hit, y0: y, y1: y } : null; } else if (cur) cur.y1 = y; }
  if (cur) bands.push(cur); return bands.filter(b => b.y0 - b.y1 > minH);
}
// a rib's centreline where its FRONT half crosses |x| = xm (bony rib + cartilage): the fallback when the rib hides behind another on the line
function ribCentreAt(K, k, S_, xm) {
  const R = K.geo.ribs['rib' + k + S_], zMin = K.pts.xiphisternal[2] - 0.07, pts = R.path.concat(R.cart || []).filter(p => p[2] > zMin);
  let best = null; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], xa = Math.abs(a[0]), xb = Math.abs(b[0]);
    if ((xa - xm) * (xb - xm) <= 0 && xa !== xb) { const t = (xm - xa) / (xb - xa), y = a[1] + t * (b[1] - a[1]), z = a[2] + t * (b[2] - a[2]); if (!best || z > best.z) best = { y, z }; } }
  return best ? best.y : NaN;
}
export function chestLevels(K, S_) {
  K._chest ||= {}; if (K._chest[S_]) return K._chest[S_];
  const s = S_ === 'L' ? 1 : -1, xm = Math.abs((K.pts['sc' + S_][0] + K.pts['ac' + S_][0]) / 2), bands = ribBands(K, s * xm), sT = K.info?.sT ?? 1;
  const hi = k => { const b = bands.filter(q => q.k === k); return b.length ? Math.max(...b.map(q => q.y0)) : NaN; }, lo = k => { const b = bands.filter(q => q.k === k); return b.length ? Math.min(...b.map(q => q.y1)) : NaN; };
  const mid = k => { const h = hi(k), l = lo(k); return h === h && l === l ? (h + l) / 2 : ribCentreAt(K, k, S_, xm); };
  const ics = k => (lo(k) + hi(k + 1)) / 2;
  const foldWang = lo(5) - 0.69 * CM * sT, foldOh = hi(6), fold = foldWang === foldWang && foldOh === foldOh ? Math.min(foldWang, foldOh) * 0.5 + Math.max(foldWang, foldOh) * 0.5 : (foldWang === foldWang ? foldWang : ics(5));
  return (K._chest[S_] = { xm, bands, hi, lo, mid, ics, fold });
}
