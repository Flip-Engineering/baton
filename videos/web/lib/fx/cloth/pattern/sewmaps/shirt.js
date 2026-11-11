// SEWMAP / SHIRT (CLOTHING c2, lane K2): FreeSewing Simon (men's) and Simone (Simon with a full-bust adjustment: a side bust dart)
// as a sewn work shirt. Which FreeSewing part becomes which panel, and which panel edges sew to which, by named points.
//
// Panels (all seen from outside; u = 0 is the centre front / back): frontL, frontR (the fronts clipped at the centre front: the
// buttoned placket is a closed CF seam this round, its overlap and interfacing are a later trim), back (cut on fold, mirrored),
// yoke (FreeSewing drafts it whole), sleeveR (as drafted: its front notch is at +u, which for a sleeve seen from outside is the
// wearer's right) and sleeveL (mirrored), collar stand (a band collar this round: the turned-down collar is a later fold), cuffL/R.
// The back's +u side and the yoke's +u side are the wearer's RIGHT (seen from behind). Simone's fronts carry the dart (dartBottom ->
// bustDartTip -> dartTop) only when FreeSewing drafts one (bust - highBust > 0); without it the side seam is one run.
export const design = ['simon', 'simone'];
export const options = { backDarts: 'never' };
// Simone's full-bust adjustment can fail to draft at some sizes (fba-front.mjs: an intersection comes back empty for 'fbaBelowDart');
// a few degrees on the bust dart's angle (FreeSewing's default 10) clears it
export const retry = [{ bustDartAngle: 12 }, { bustDartAngle: 8 }, { bustDartAngle: 15 }, { bustDartAngle: 5 }];
const dart = { from: 'dartBottom', to: 'dartTop', path: 'dart', optional: true };
export const panels = [
  { name: 'frontL', part: 'simon.frontLeft', insert: [dart], clip: { u: '>=', at: 0 }, place: { wrap: 'torso', face: 'front', anchor: 'hps', to: 'hpsL' } },
  { name: 'frontR', part: 'simon.frontRight', insert: [dart], clip: { u: '<=', at: 0 }, place: { wrap: 'torso', face: 'front', anchor: 'hps', to: 'hpsR' } },
  { name: 'back', part: 'simon.back', mirror: 'fold', place: { wrap: 'torso', face: 'back', anchor: 'cbYoke', to: 'yokeBack' } },
  { name: 'yoke', part: 'simon.yoke', symTags: true, place: { wrap: 'torso', face: 'back', anchor: 'hps', to: 'hpsR', curl: true } },
  { name: 'sleeveR', part: 'simon.sleeve', mark: [{ name: 'capTop', at: 'maxV' }], place: { wrap: 'arm', side: 'R', top: 'capTop', front: 'frontNotch' } },
  { name: 'sleeveL', of: 'sleeveR', mirror: true, place: { wrap: 'arm', side: 'L', top: 'capTop', front: 'frontNotch' } },
  { name: 'stand', part: 'simon.collarStand', place: { wrap: 'neck', anchor: 'bottomMid' } },
  { name: 'cuffR', part: 'simon.cuff', optional: true, place: { wrap: 'wrist', side: 'R', edge: ['bottomLeft', 'bottomRight'] } },
  { name: 'cuffL', of: 'cuffR', mirror: true, optional: true, place: { wrap: 'wrist', side: 'L', edge: ['bottomLeft', 'bottomRight'] } },
];
// seams: { name, a: [[panel, fromTag, toTag], ...], b: [...], kind: 'seam' | 'dart' | 'closure' | 'point' }. A run goes the shorter
// way round its panel's outline from fromTag to toTag; a[k] and b[k] are walked together, so the first tags of a and b meet.
export function seams(P) {
  const has = (p, t) => P[p] && P[p].tags[t] != null, S = [];
  for (const [side, fr, m] of [['L', 'frontL', '~m'], ['R', 'frontR', '']]) {
    const dartOn = has(fr, 'bustDartTip');
    S.push({ name: 'side' + side, kind: 'seam', a: dartOn ? [[fr, 'hem', 'dartBottom'], [fr, 'dartTop', 'armhole']] : [[fr, 'hem', 'armhole']], b: [['back', 'hem' + m, 'armhole' + m]] });
    if (dartOn) S.push({ name: 'dart' + side, kind: 'dart', a: [[fr, 'dartBottom', 'bustDartTip']], b: [[fr, 'dartTop', 'bustDartTip']] });
    S.push({ name: 'shoulder' + side, kind: 'seam', a: [[fr, 'hps', 'shoulder']], b: [['yoke', 'hps' + m, 'shoulder' + m]] });
    const sl = 'sleeve' + side;
    // the cap, notch to notch: front armhole (armhole -> armholePitch -> shoulder), yoke (shoulder -> yoke split), back (split -> pitch -> armhole)
    S.push({ name: 'capFront' + side, kind: 'seam', a: [[sl, 'bicepsRight', 'frontNotch']], b: [[fr, 'armhole', 'armholePitch']] });
    // notch to notch over the top: one seam, so the cap's ease spreads evenly and the shoulder seam lands on the cap where the
    // lengths put it (the cap's highest point is not FreeSewing's shoulder match for every draft). Simon's back notch is placed at the
    // back armhole's length from the armhole up to the YOKE seam (simon/src/back.mjs resets library.sleeve.backArmholeToArmholePitch
    // to that), so it meets the yoke seam, not the back pitch point
    S.push({ name: 'capTop' + side, kind: 'seam', a: [[sl, 'frontNotch', 'backNotch']], b: [[fr, 'armholePitch', 'shoulder'], ['yoke', 'shoulder' + m, 'armholeYokeSplit' + m]] });
    S.push({ name: 'capBack' + side, kind: 'seam', a: [[sl, 'backNotch', 'bicepsLeft']], b: [['back', 'armholeYokeSplit' + m, 'armhole' + m]] });
    S.push({ name: 'underarm' + side, kind: 'seam', a: [[sl, 'bicepsRight', 'wristRight']], b: [[sl, 'bicepsLeft', 'wristLeft']] });
    const cf = 'cuff' + side;
    if (P[cf]) { S.push({ name: 'cuffJoin' + side, kind: 'seam', a: [[sl, 'wristLeft', 'wristRight']], b: [[cf, 'bottomLeft', 'bottomRight']] });
      S.push({ name: 'cuffClose' + side, kind: 'closure', a: [[cf, 'bottomLeft', 'leftAngleTop']], b: [[cf, 'bottomRight', 'rightAngleTop']] }); }
  }
  S.push({ name: 'yokeBack', kind: 'seam', a: [['yoke', 'armholeYokeSplit', 'armholeYokeSplit~m']], b: [['back', 'armholeYokeSplit', 'armholeYokeSplit~m']] });
  // the front buttoned from the hem up to the second button; the top button and the band open (a work shirt as it is worn; it also
  // keeps a neck measure that runs a little small from choking the collar shut)
  S.push({ name: 'cf', kind: 'closure', a: [['frontL', 'cfHem', 'topButton']], b: [['frontR', 'cfHem', 'topButton']] });
  S.push({ name: 'neckline', kind: 'seam', a: [['stand', 'rightBottomCf', 'leftBottomCf']], b: [['frontR', 'cfNeck', 'hps'], ['yoke', 'hps', 'hps~m'], ['frontL', 'hps', 'cfNeck']] });
  return S;
}
// the top of the buttoned front: 9 cm below the neck point on the centre front
export const at = [{ panel: 'frontL', name: 'topButton', from: 'cfNeck', toward: 'cfHem', length: 0.09 }, { panel: 'frontR', name: 'topButton', from: 'cfNeck', toward: 'cfHem', length: 0.09 }];
// free edges and how they are finished (K1 / the shader read these; the drape treats a hem as a stiffer band)
export const edges = [
  { panel: 'frontL', from: 'cfHem', to: 'hem', treatment: 'hem' }, { panel: 'frontR', from: 'hem', to: 'cfHem', treatment: 'hem' },
  { panel: 'back', from: 'hem~m', to: 'hem', treatment: 'hem' },
  { panel: 'stand', from: 'leftBottomCf', to: 'rightBottomCf', treatment: 'fold', note: 'top edge of the band (two layers, interfaced)' },
];
// crowd signature (lane K7 / people.js later)
export const crowd = { part: 'top', length: 'hip', silhouette: 'shirt' };
