// BY AUTHORITY: the words (research/series/authority/ep1_brief.md, Words). Every quotation is verbatim, its cuts marked with ellipses, each
// line a caption frame timed on the music's beats (84 BPM: a beat is 0.714 s); studio captions in tracked caps with no credit; credits in
// caps under the quotation. The words lie on a clear acetate strip over the lit box, in the reading band (y 300-610, inside kit.SAFE_BAND):
// each develops onto it through RULE (a front shaped like the card's edge, 1.475:1, from the frame's centre) over 3 frames as its cue
// starts and clears through the same front run backward in 2 frames as it ends. Never slammed, typed or struck.
// Face: Archivo 600 (Archivo Narrow 600 for lines over 18 characters), Archivo 500 for captions and credits (Omnibus-Type, OFL-1.1;
// @fontsource 5.3.0, vendored in assets/byauthority/fonts/ with their licences). Laid out from the fonts' own metrics (opentype.js), so
// node can check every frame: byauthority_dry.mjs.
import { parse as otParse } from '../node_modules/opentype.js/dist/opentype.mjs';
import { Rule } from '../lib/fx/rule.js';
import { readBytes } from '../lib/fx/devplate.js';

export const BPM = 84, SPB = 60 / BPM;
export const INK = '#0e1113';
const FONTS = { quote: 'archivo-latin-600-normal.woff', narrow: 'archivo-narrow-latin-600-normal.woff', caption: 'archivo-latin-500-normal.woff' };
const SAFE = { x1: 60, x2: 960, cx: 510 };
const BAND = { top: 336, studioTop: 330, maxW: 900, capMax: 96, capMin: 72 };

// the cue table, in beats. kind: quote | studio | credit. Sources: the brief's Words table (each re-read there at its file:line or URL), and
// (c20) the strikers' book re-read on 15 Oct at savingworldfromd00winn_0_djvu.txt l.3074-3078 for the sanction sentence. Take 'b'
// (globalThis.BYA_TAKE) opens on the employers' trip as the hook and gives the turn the rest of that sentence.
export const TAKE = (typeof globalThis !== 'undefined' && globalThis.BYA_TAKE) || 'a';
const DC = 'DEFENSE COMMITTEE · WINNIPEG LABOR ORGANIZATIONS · 1920';
const OPEN_A = [
  { b: [0, 4], kind: 'studio', text: 'WINNIPEG · 15 MAY 1919' },
  // #2 Defense Committee, "Saving the World from Democracy" (1920), djvu l.2999-3000
  { b: [4, 6], text: 'IN LESS THAN TWO HOURS' }, { b: [6, 8], text: 'THE WHOLE PRODUCTIVE INDUSTRY' }, { b: [8, 9.5], text: 'OF A WHOLE CITY' }, { b: [9.5, 11], text: 'WAS TIED UP …' },
  { b: [4, 11], kind: 'credit', text: DC },
  // #3 l.3001-3003
  { b: [11, 13], text: '… NOT A WHEEL WAS TURNING' }, { b: [13, 14.5], text: 'IN THE BIG PLANTS,' }, { b: [14.5, 16.5], text: 'NOT A STREET CAR' }, { b: [16.5, 18], text: 'WAS VISIBLE …' },
  // #4 l.2808-2809
  { b: [18, 20], text: '… APPROXIMATELY 24,000' }, { b: [20, 22], text: 'MEN AND WOMEN' }, { b: [22, 24], text: 'WERE ON STRIKE.' },
];
const OPEN_B = [
  // #9's first half as the hook, over the card itself (l.3107-3109, one marked cut: "from the firms involved,")
  { b: [0, 2], text: 'EMPLOYERS OF LABOR …' }, { b: [2, 4], text: 'VOLUNTARILY WENT' }, { b: [4, 6], text: 'TO THE LABOR TEMPLE' }, { b: [6, 8], text: 'TO SECURE THESE CARDS …' },
  { b: [0, 8], kind: 'credit', text: DC },
  // #2, #3 (l.2999-3003)
  { b: [8, 10], text: 'IN LESS THAN TWO HOURS' }, { b: [10, 12], text: 'THE WHOLE PRODUCTIVE INDUSTRY' }, { b: [12, 13.5], text: 'OF A WHOLE CITY' }, { b: [13.5, 15], text: 'WAS TIED UP …' },
  { b: [15, 17], text: '… NOT A WHEEL WAS TURNING' }, { b: [17, 18.5], text: 'IN THE BIG PLANTS,' }, { b: [18.5, 20], text: 'NOT A STREET CAR' }, { b: [20, 21.5], text: 'WAS VISIBLE …' },
];
// the hinge (24-28) has no words: the card comes back and the motif sounds; the first develop says what the committee did
const PERMITS = [
  // #6 l.3030-3032 (one marked cut: "at 30 lbs. pressure")
  { b: [28, 29.5], text: '… MAINTAIN A SUPPLY' }, { b: [29.5, 31], text: 'OF WATER' }, { b: [31, 33], text: '… FOR DOMESTIC USE.' },
  // #8, whole (l.3076-3078): why the card was printed; SANCTION develops the faces
  { b: [33, 34.5], text: '… THESE EMPLOYEES' }, { b: [34.5, 36], text: 'WERE NOT SCABBING,' }, { b: [36, 37.5], text: 'BUT DISCHARGING' }, { b: [37.5, 39], text: 'A VERY NECESSARY DUTY' },
  { b: [39, 40.5], text: 'AT THE REQUEST' }, { b: [40.5, 42], text: 'AND WITH THE SANCTION' }, { b: [42, 44], text: 'OF THEIR FELLOW-WORKERS.' },
];
// the turn, 20 beats (l.3107-3111): a gives the whole sentence room; b, having opened on its first half, lands its second
const TURN_A = [
  { b: [44, 46.5], text: 'EMPLOYERS OF LABOR …' }, { b: [46.5, 48.5], text: 'VOLUNTARILY WENT' }, { b: [48.5, 51], text: 'TO THE LABOR TEMPLE' }, { b: [51, 53.5], text: 'TO SECURE THESE CARDS,' },
  { b: [53.5, 55.5], text: 'KNOWING WHAT' }, { b: [55.5, 57.5], text: 'WAS PRINTED THEREON,' }, { b: [57.5, 59.5], text: 'AND THEMSELVES PLACED' }, { b: [59.5, 61], text: 'THESE CARDS' },
  { b: [61, 64], text: 'UPON THEIR OWN PROPERTY.' },
  { b: [44, 51], kind: 'credit', text: 'DEFENSE COMMITTEE · 1920' },
];
const TURN_B = [
  { b: [46, 48.5], text: '… KNOWING WHAT' }, { b: [48.5, 51.5], text: 'WAS PRINTED THEREON,' }, { b: [52, 55], text: 'AND THEMSELVES PLACED' }, { b: [55, 57.5], text: 'THESE CARDS' },
  { b: [57.5, 62], text: 'UPON THEIR OWN PROPERTY.' },
];
const CLOSE = [
  // #10 Lenin, Can the Bolsheviks Retain State Power? (1917), research/sources/texts/lenin-retain-power.txt:233
  { b: [64, 65], text: 'THE RICH' }, { b: [65, 66.5], text: 'WILL BE OBLIGED …' }, { b: [66.5, 68.5], text: '… THEY WILL HAVE TO GET' }, { b: [68.5, 70], text: 'FROM THAT UNION' },
  { b: [70, 71.5], text: 'A CERTIFICATE …' },
  { b: [66.5, 71.5], kind: 'credit', text: 'LENIN · 1917' },
  // #13 the Chairman, Communism in the post-MAGA Age, ch. 05 (May 2026), research/sources/texts/haz-postmaga-05.txt:129
  { b: [73, 74.5], text: 'THOUGH THE PROLETARIAT' }, { b: [74.5, 76], text: 'HAS NOT ACQUIRED' }, { b: [76, 77.5], text: 'POLITICAL POWER,' }, { b: [77.5, 79], text: '… ACCORDING TO' },
  { b: [79, 81], text: 'THE LOGIC OF PRODUCTION' }, { b: [81, 82.5], text: 'IT, IN A SENSE,' }, { b: [82.5, 85], text: 'ACQUIRES SUPREMACY …' },
  { b: [77.5, 85], kind: 'credit', text: 'EXECUTIVE CHAIRMAN, AMERICAN COMMUNIST PARTY' },
  // #14 studio, answering frame 0, in the air after the last word (lies on the box between the card and the crew: plates.js LABEL26)
  { b: [86, 91.5], kind: 'studio', text: 'WINNIPEG · 2026', onBox: true },
];
export const CUES = [...(TAKE === 'b' ? OPEN_B : OPEN_A), ...PERMITS, ...(TAKE === 'b' ? TURN_B : TURN_A), ...CLOSE
].map((c, i) => ({ id: 'w' + i, kind: c.kind || 'quote', ...c, t0: c.b[0] * SPB, t1: c.b[1] * SPB }));

export async function loadFaces(base = new URL('../assets/byauthority/fonts/', import.meta.url)) {
  const out = {};
  for (const [k, f] of Object.entries(FONTS)) { const b = await readBytes(new URL(f, base)); out[k] = otParse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
  return out;
}
const capOf = f => (f.tables.os2?.sCapHeight || f.unitsPerEm * 0.7) / f.unitsPerEm;
// a line's advance width at a cap height, with tracking (em)
export function measure(font, text, cap, tracking = 0) {
  const size = cap / capOf(font), gl = [...text].map(c => font.charToGlyph(c)); let w = 0;
  gl.forEach((g, i) => { w += g.advanceWidth || 0; if (i < gl.length - 1) w += font.getKerningValue(g, gl[i + 1]) + tracking * font.unitsPerEm; });
  return w * size / font.unitsPerEm;
}
// glyph outlines as one SVG path string (centred on cx, baseline y)
// a glyph path's commands as SVG data, two decimals. Not opentype's toPathData(2): opentype.js 2.0.0's roundDecimal builds
// (decimalPart + 'e+2'), which is NaN whenever the fractional part prints in exponent form (e.g. 5.7e-14 at x = 412.0000000000001),
// and a NaN ends the browser's parse of the whole Path2D: c20 farm render 1015-090003 lost the rest of the line after one such glyph
// ('WAS T…', 'POLITICA▲', 'EXECUTIVE CHA'). toFixed has no such case.
const f2 = v => (Math.abs(v) < 5e-3 ? 0 : v).toFixed(2);
function svgOf(path) {
  let d = '';
  for (const c of path.commands) {
    if (c.type === 'M' || c.type === 'L') d += c.type + f2(c.x) + ' ' + f2(c.y);
    else if (c.type === 'Q') d += 'Q' + f2(c.x1) + ' ' + f2(c.y1) + ' ' + f2(c.x) + ' ' + f2(c.y);
    else if (c.type === 'C') d += 'C' + f2(c.x1) + ' ' + f2(c.y1) + ' ' + f2(c.x2) + ' ' + f2(c.y2) + ' ' + f2(c.x) + ' ' + f2(c.y);
    else if (c.type === 'Z') d += 'Z';
  }
  return d;
}
export function pathOf(font, text, cap, cx, y, tracking = 0) {
  const size = cap / capOf(font), w = measure(font, text, cap, tracking); let x = cx - w / 2, d = '';
  const gl = [...text].map(c => font.charToGlyph(c));
  gl.forEach((g, i) => { d += svgOf(g.getPath(x, y, size)) + ' '; x += (g.advanceWidth || 0) * size / font.unitsPerEm + (i < gl.length - 1 ? (font.getKerningValue(g, gl[i + 1]) + tracking * font.unitsPerEm) * size / font.unitsPerEm : 0); });
  return { d, w };
}

// lay out every cue: rows (text, face, cap, tracking, baseline y, width) and the element's box. Quotation blocks keep one top (BAND.top)
// whatever their row count; a credit sits under the tallest quotation it spans; #14 under the credit it shares the screen with.
export function layout(faces) {
  const els = CUES.map(c => ({ ...c }));
  for (const e of els) {
    if (e.kind === 'quote') {
      // the face by the frame's length (Archivo 600 up to 18 characters, Archivo Narrow 600 over); one row if it fits at cap >= 72 (up to
      // 96), else two rows at the break that keeps the wider row narrowest, at cap 72-76 (a compact block)
      const face = e.text.length <= 18 ? 'quote' : 'narrow', F = faces[face], fit = t => BAND.maxW / measure(F, t, 1);
      let rows = [e.text], cap = Math.min(BAND.capMax, fit(e.text));
      if (cap < BAND.capMin) {
        const sp = [...e.text.matchAll(/ /g)].map(m => m.index);
        const best = sp.map(k => [e.text.slice(0, k), e.text.slice(k + 1)]).sort((x, y) => Math.min(...y.map(fit)) - Math.min(...x.map(fit)))[0];
        rows = best; cap = Math.min(76, ...rows.map(fit));
      }
      e.shrunk = cap < BAND.capMin - 1e-6;
      e.rows = rows.map((t, i) => ({ text: t, face, cap, tracking: 0, y: BAND.top + cap + i * cap * 1.34 }));
    } else if (e.kind === 'studio') {
      // tracked caps 44 (Archivo 500, +60); one row if it fits, else two rows at the space nearest the middle
      const F = faces.caption, cap = 44, tr = 0.06;
      let rows = [e.text];
      if (measure(F, e.text, cap, tr) > BAND.maxW) { const sp = [...e.text.matchAll(/ /g)].map(m => m.index), mid = e.text.length / 2, k = sp.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0]; rows = [e.text.slice(0, k), e.text.slice(k + 1)]; }
      e.rows = rows.map((t, i) => ({ text: t, face: 'caption', cap, tracking: tr, y: BAND.studioTop + cap + i * cap * 1.5 }));
    }
  }
  for (const e of els.filter(x => x.kind === 'credit')) {                  // under the tallest quotation it spans
    const span = els.filter(q => q.kind === 'quote' && q.t0 < e.t1 - 1e-6 && q.t1 > e.t0 + 1e-6);
    const bottom = Math.max(...span.map(q => q.rows[q.rows.length - 1].y));
    // caps 36 (the brief), tracked +60; one row in Archivo, one in Narrow, then two rows (at a ' · ' or ', '); then less tracking, then
    // cap 34 (the bible's floor); the last resort scales the cap until the wider row fits: never wider than the band
    const opts = [];
    const splits = []; e.text.split(' · ').forEach((_, k, P) => { if (k) splits.push([P.slice(0, k).join(' · '), P.slice(k).join(' · ')]); });
    if (e.text.includes(', ')) { const k = e.text.indexOf(', '); splits.push([e.text.slice(0, k + 1), e.text.slice(k + 2)]); }
    for (const cap of [36, 34]) for (const tr of [0.06, 0.03]) {
      for (const f of ['caption', 'narrow']) opts.push({ face: f, tr, cap, rows: [e.text] });
      for (const f of ['caption', 'narrow']) for (const sp of splits) opts.push({ face: f, tr, cap, rows: sp });
    }
    let ok = opts.find(o => o.rows.every(r => measure(faces[o.face], r, o.cap, o.tr) <= BAND.maxW));
    if (!ok) { const o = { face: 'narrow', tr: 0.03, rows: splits[0] || [e.text] }; o.cap = Math.min(34, ...o.rows.map(r => 34 * BAND.maxW / measure(faces.narrow, r, 34, 0.03))); ok = o; }
    const cap = ok.cap;
    const face = ok.face, rows = ok.rows, tr = ok.tr;
    e.rows = rows.map((t, i) => ({ text: t, face, cap, tracking: tr, y: bottom + 34 + cap + i * cap * 1.45 }));
  }
  for (const e of els) {
    for (const r of e.rows) { const F = faces[r.face]; r.w = measure(F, r.text, r.cap, r.tracking); r.x = SAFE.cx; r.size = r.cap / capOf(F); }
    const x0 = Math.min(...e.rows.map(r => r.x - r.w / 2)), x1 = Math.max(...e.rows.map(r => r.x + r.w / 2));
    const y0 = Math.min(...e.rows.map(r => r.y - r.cap)), y1 = Math.max(...e.rows.map(r => r.y + 0.08 * r.cap));   // caps; the comma's tail
    e.box = [x0, y0, x1, y1];
  }
  return els;
}

// the words as drawn: each element develops on the acetate through RULE (screen units), clears through it run backward
export class Words {
  constructor(faces, { fps = 30 } = {}) {
    this.faces = faces; this.els = layout(faces);
    const regions = this.els.map(e => ({ id: e.id, box: [e.box[0] - 16, e.box[1] - 16, e.box[2] + 16, e.box[3] + 16], shape: { rect: { aspect: 1.475 } }, from: 'centre',
      t0: e.t0, dur: 3 / fps, ease: 'linear', soft: 0.002 }));
    const reverse = this.els.map(e => ({ ids: [e.id], t0: e.t1 - 2 / fps, dur: 2 / fps, ease: 'linear' }));
    this.R = new Rule({ regions, reverse });
    this.paths = new Map();
  }
  _path(e) {
    if (!this.paths.has(e.id)) this.paths.set(e.id, e.rows.map(r => new Path2D(pathOf(this.faces[r.face], r.text, r.cap, r.x, r.y, r.tracking).d)));
    return this.paths.get(e.id);
  }
  active(t) { return this.els.filter(e => t >= e.t0 && t < e.t1 && !e.onBox); }
  onBox(t) { return this.els.filter(e => t >= e.t0 && t < e.t1 && e.onBox); }
  // boxes of what is on the acetate at t (for the reading band's check: open lightbox under every word)
  boxes(t) { return this.active(t).filter(e => this.R.radius(e.id, t) > 0).map(e => ({ id: e.id, text: e.rows.map(r => r.text).join(' / '), box: e.box })); }
  draw(ctx, t, { ink = INK, alpha = 0.95, box = null } = {}) {
    let n = 0;
    if (box) for (const e of this.onBox(t)) {                              // box(e) -> { x, y, s, rot }: where the caption's centre lies on screen
      const f = this.R.frontRect(e.id, t); if (f.hh <= 0) continue; const P = box(e); if (!P) continue;
      const [cx, cy] = [(e.box[0] + e.box[2]) / 2, (e.box[1] + e.box[3]) / 2];
      ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(P.rot || 0); ctx.scale(P.s, P.s); ctx.translate(-cx, -cy);
      ctx.beginPath(); ctx.rect(f.cx - f.hw, f.cy - f.hh, 2 * f.hw, 2 * f.hh); ctx.clip();
      ctx.globalAlpha = alpha; ctx.fillStyle = ink; for (const p of this._path(e)) ctx.fill(p); ctx.restore(); n++;
    }
    for (const e of this.active(t)) {
      const f = this.R.frontRect(e.id, t); if (f.hh <= 0) continue;
      ctx.save(); ctx.beginPath(); ctx.rect(f.cx - f.hw, f.cy - f.hh, 2 * f.hw, 2 * f.hh); ctx.clip();
      ctx.globalAlpha = alpha; ctx.fillStyle = ink;
      for (const p of this._path(e)) ctx.fill(p);
      ctx.restore(); n++;
    }
    return n;
  }
}
