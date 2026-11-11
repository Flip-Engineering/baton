// OUTFITS4 (CLOTHING K4, the wardrobe): the everyday working wardrobe of a modern American workforce, dressed on CAST's twelve v3 / v4
// people (women half), every person in something different. Neutral demo outfits (no logos, no video's wardrobe): warehouse, construction,
// service and retail, office casual, nursing scrubs, the weekend. Colours are plain trade colours (heather grey, indigo, khaki, duck brown,
// navy, olive, ceil blue). The arm pose is POSE's (motion/stance.js): 'hang' for most, a hand on the hip for two.
export const OUTFITS4_VERSION = 1;
export const OUTFITS4 = {
  // ---- women
  L08_f24_hispanic: { id: 'weekend', job: 'weekend', top: { kind: 'tee', fabric: 'heatherJersey', color: '#9b9a98' }, bottom: { kind: 'jeans', color: '#5d7899' }, shoes: { kind: 'sneaker', color: '#ece9e2', upper: 'canvas' }, arms: 'hang' },
  L22_f27_black: { id: 'scrubs', job: 'nursing', top: { kind: 'scrubTop', color: '#2b4a74' }, bottom: { kind: 'scrubPants', color: '#2b4a74' }, shoes: { kind: 'sneaker', color: '#f0eee8', upper: 'leather', sole: '#f2f0ea' }, arms: 'hang' },
  L20_f29_asian: { id: 'office', job: 'office casual', top: { kind: 'shirt', fabric: 'oxford', color: '#f1f0ec', tuck: 'in' }, bottom: { kind: 'skirt', fabric: 'woolFlannel', color: '#4a4a4f' }, shoes: { kind: 'sneaker', color: '#2a2726', upper: 'leather', sole: '#e9e5dc', lace: '#2a2726' }, arms: 'hang' },
  L12_f39_white: { id: 'construction', job: 'construction', top: { kind: 'tee', color: '#ecebe6' }, outer: { kind: 'jacket', fabric: 'canvas', color: '#8a6a43' }, bottom: { kind: 'jeans', color: '#263a5a' }, shoes: { kind: 'boot' }, arms: 'hang' },
  L14_f42_black: { id: 'warehouse', job: 'warehouse', top: { kind: 'sweat', color: '#5a2a33' }, bottom: { kind: 'work', color: '#2d3442' }, shoes: { kind: 'boot' }, arms: 'hang' },
  L06_f53_white: { id: 'retail', job: 'service and retail', top: { kind: 'tee', color: '#27324a', tuck: 'in' }, bottom: { kind: 'chinos', color: '#b49d78' }, shoes: { kind: 'sneaker', color: '#3a3a3c', upper: 'leather', sole: '#ebe7de' }, arms: 'hip' },
  // ---- men
  L21_m32_black: { id: 'warehouse', job: 'warehouse', top: { kind: 'sweat', fabric: 'fleece', color: '#8c8b88' }, bottom: { kind: 'jeans', color: '#25344d' }, shoes: { kind: 'boot' }, arms: 'hang' },
  L11_m23_white: { id: 'weekend', job: 'weekend', top: { kind: 'tee', color: '#eeede8' }, bottom: { kind: 'chinos', color: '#5c6145' }, shoes: { kind: 'sneaker', color: '#2c3644', upper: 'canvas' }, arms: 'hip' },
  L17_m28_hispanic: { id: 'delivery', job: 'delivery and service', top: { kind: 'tee', color: '#232325' }, bottom: { kind: 'work', color: '#45474b' }, shoes: { kind: 'boot' }, arms: 'hang' },
  L03_m38_asian: { id: 'office', job: 'office casual', top: { kind: 'shirt', fabric: 'oxford', color: '#9fb6d4', tuck: 'in' }, bottom: { kind: 'chinos', color: '#bfa982' }, shoes: { kind: 'sneaker', color: '#5a3d2a', upper: 'leather', sole: '#e6e0d4', lace: '#4a3324' }, arms: 'hang' },
  L23_m45_white: { id: 'trades', job: 'construction trades', top: { kind: 'tee', fabric: 'heatherJersey', color: '#6f7377' }, outer: { kind: 'jacket', fabric: 'canvas', color: '#a37f4f' }, bottom: { kind: 'jeans', color: '#30466a' }, shoes: { kind: 'boot' }, arms: 'hang' },
  L05_m59_black: { id: 'maintenance', job: 'maintenance', top: { kind: 'shirt', fabric: 'chambray', color: '#6c86a8', tuck: 'in' }, bottom: { kind: 'work', color: '#283245' }, shoes: { kind: 'boot' }, arms: 'hang' },
};
