// SEWMAP / TEE (CLOTHING K4, the wardrobe): FreeSewing Teagan (a T-shirt on the Brian block, MIT) as a sewn knit tee, women's and men's
// (Teagan is unisex: the bust is the chest's ease; a fitted waist is Teagan's `fitWaist` option, women only by our easeFor4).
// Panels (seen from outside; FreeSewing's frame: y = 0 at the HPS line): front (cut on fold, mirrored: the drafted half at +u, which seen
// from the front is the wearer's LEFT; its mirror '~m' the right), back (cut on fold: the drafted half at +u is the wearer's RIGHT seen from
// behind, '~m' the left), sleeveR (as drafted: the front notch at +u) and sleeveL (mirrored). The neckline is a free edge: the 1x1 rib
// neckband is construction (wardrobe4/trim4.js: a rib binding swept round the neck opening), as are the coverstitched hems.
export const design = ['teagan'];
export const options = {};
export const panels = [
  { name: 'front', part: 'teagan.front', mirror: 'fold', place: { wrap: 'torso', face: 'front' } },
  { name: 'back', part: 'teagan.back', mirror: 'fold', place: { wrap: 'torso', face: 'back' } },
  { name: 'sleeveR', part: 'teagan.sleeve', mark: [{ name: 'capTop', at: 'maxV' }], place: { wrap: 'arm', side: 'R', top: 'capTop', front: 'frontNotch' } },
  { name: 'sleeveL', of: 'sleeveR', mirror: true, place: { wrap: 'arm', side: 'L', top: 'capTop', front: 'frontNotch' } },
];
// the front's drafted half (no suffix) is the wearer's left, the back's drafted half the wearer's right (as K2's shirt back)
export function seams(P) {
  const S = [];
  for (const [sd, fm, bm] of [['L', '', '~m'], ['R', '~m', '']]) {
    const sl = 'sleeve' + sd;
    S.push({ name: 'side' + sd, kind: 'seam', a: [['front', 'hem' + fm, 'armhole' + fm]], b: [['back', 'hem' + bm, 'armhole' + bm]] });
    S.push({ name: 'shoulder' + sd, kind: 'seam', a: [['front', 'neck' + fm, 'shoulder' + fm]], b: [['back', 'neck' + bm, 'shoulder' + bm]] });
    // the cap notch to notch: front armhole (armhole -> front notch), over the top (front notch -> shoulder -> back notch), back armhole
    S.push({ name: 'capFront' + sd, kind: 'seam', a: [[sl, 'bicepsRight', 'frontNotch']], b: [['front', 'armhole' + fm, 'armholeNotchFront' + fm]] });
    S.push({ name: 'capTop' + sd, kind: 'seam', a: [[sl, 'frontNotch', 'backNotch']], b: [['front', 'armholeNotchFront' + fm, 'shoulder' + fm], ['back', 'shoulder' + bm, 'armholeNotchBack' + bm]] });
    S.push({ name: 'capBack' + sd, kind: 'seam', a: [[sl, 'backNotch', 'bicepsLeft']], b: [['back', 'armholeNotchBack' + bm, 'armhole' + bm]] });
    S.push({ name: 'underarm' + sd, kind: 'seam', a: [[sl, 'bicepsRight', 'hemRight']], b: [[sl, 'bicepsLeft', 'hemLeft']] });
  }
  return S;
}
export const edges = [
  { panel: 'front', from: 'hem~m', to: 'hem', treatment: 'hem' }, { panel: 'back', from: 'hem~m', to: 'hem', treatment: 'hem' },
  { panel: 'sleeveR', from: 'hemLeft', to: 'hemRight', treatment: 'hem' }, { panel: 'sleeveL', from: 'hemLeft', to: 'hemRight', treatment: 'hem' },
];
export const crowd = { part: 'top', length: 'hip', silhouette: 'tee' };
