// SEWMAP / SWEAT (CLOTHING K4, the wardrobe): FreeSewing Sven (a crew sweater on the Brian block, MIT) as a crew sweatshirt in a
// fleece-backed knit, women's and men's. Sven drafts the body and sleeves short by the ribbing's height (option `ribbing`); the 1x1 rib
// cuffs, hem band and neckband are construction (wardrobe4/trim4.js: rib bands swept from each opening, the cloth above them gathered in).
// Panels as tee.js: front and back cut on fold (the front's drafted half the wearer's LEFT, the back's the wearer's RIGHT), sleeves set in.
export const design = ['sven'];
export const options = { ribbing: true };
export const panels = [
  { name: 'front', part: 'sven.front', mirror: 'fold', place: { wrap: 'torso', face: 'front' } },
  { name: 'back', part: 'sven.back', mirror: 'fold', place: { wrap: 'torso', face: 'back' } },
  { name: 'sleeveR', part: 'sven.sleeve', mark: [{ name: 'capTop', at: 'maxV' }], place: { wrap: 'arm', side: 'R', top: 'capTop', front: 'frontNotch' } },
  { name: 'sleeveL', of: 'sleeveR', mirror: true, place: { wrap: 'arm', side: 'L', top: 'capTop', front: 'frontNotch' } },
];
export function seams(P) {
  const S = [];
  for (const [sd, fm, bm] of [['L', '', '~m'], ['R', '~m', '']]) {
    const sl = 'sleeve' + sd;
    S.push({ name: 'side' + sd, kind: 'seam', a: [['front', 'hem' + fm, 'armhole' + fm]], b: [['back', 'hem' + bm, 'armhole' + bm]] });
    S.push({ name: 'shoulder' + sd, kind: 'seam', a: [['front', 'hps' + fm, 'shoulder' + fm]], b: [['back', 'hps' + bm, 'shoulder' + bm]] });
    S.push({ name: 'capFront' + sd, kind: 'seam', a: [[sl, 'bicepsRight', 'frontNotch']], b: [['front', 'armhole' + fm, 'armholePitch' + fm]] });
    S.push({ name: 'capTop' + sd, kind: 'seam', a: [[sl, 'frontNotch', 'backNotch']], b: [['front', 'armholePitch' + fm, 'shoulder' + fm], ['back', 'shoulder' + bm, 'armholePitch' + bm]] });
    S.push({ name: 'capBack' + sd, kind: 'seam', a: [[sl, 'backNotch', 'bicepsLeft']], b: [['back', 'armholePitch' + bm, 'armhole' + bm]] });
    S.push({ name: 'underarm' + sd, kind: 'seam', a: [[sl, 'bicepsRight', 'wristRight']], b: [[sl, 'bicepsLeft', 'wristLeft']] });
  }
  return S;
}
export const edges = [
  { panel: 'front', from: 'hem~m', to: 'hem', treatment: 'rib' }, { panel: 'back', from: 'hem~m', to: 'hem', treatment: 'rib' },
  { panel: 'sleeveR', from: 'wristLeft', to: 'wristRight', treatment: 'rib' }, { panel: 'sleeveL', from: 'wristLeft', to: 'wristRight', treatment: 'rib' },
];
export const crowd = { part: 'top', length: 'hip', silhouette: 'sweatshirt' };
