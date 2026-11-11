// LAB / LOOKS (LOOKS studio c1): three fixed sources finished in the eight looks of lib/fx/looks.js, plus three
// 2-second clips where a transition and an impact frame land on a song hit.
//   sources (web/assets/looks_src, baked by web/looks_bake.mjs from the WORLDS and HUMAN labs, masks included):
//     plant   WORLDS c1 shot 4, the plant at night (depth, class, plume masks)
//     crowd   HUMAN c2 crowd wall, rim (per-rank depth, flags as the spot class), 31 frames on twos
//     payoff  ALL OF IT. rebuilt: the HUMAN c1 hammer hand + a disc + the crowd's front rank + the words as a type layer
//   window.still(source, look, t) -> ms          window.renderFrame(t) with ?clip=1|2|3
import { W, H, C, loadFonts, loadImage, BRAND, tinted, line, clamp, ease } from '../lib/kit.js';
import { Looks, LOOKS } from '../lib/fx/looks.js';

const Q = new URLSearchParams(location.search);
const out = document.getElementById('out'), ctx = out.getContext('2d');
await loadFonts();
const lk = new Looks(); window.lk = lk;
const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const SRC = '../assets/looks_src/';

// ---------------------------------------------------------------- sources
const plant = { color: await loadImage(SRC + 'plant/0_color.jpg'), aux: await loadImage(SRC + 'plant/0_aux.png'), glow: await loadImage(SRC + 'plant/0_glow.png'), depth: [20, 12000], cutKT: 0.08, tonal: ['ground', 'mid'], anchor: [700, 1010, 300] };
{ // plant's spot shape: a low red sun set into the skyline behind the cooling tower (the red plate is a shape)
  const s = cv(W, H), g = s.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff';
  g.beginPath(); g.arc(700, 1010, 300, 0, Math.PI * 2); g.fill(); plant.shape = s; }
const crowdMeta = await (await fetch(SRC + 'crowd/meta.json')).json();
const crowdF = [];
for (const f of crowdMeta.frames) crowdF.push({ color: await loadImage(SRC + `crowd/${f.k}_color.jpg`), aux: await loadImage(SRC + `crowd/${f.k}_aux.png`) });
const crowdShape = (() => { const s = cv(W, H), g = s.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff';
  g.beginPath(); g.arc(745, 650, 150, 0, Math.PI * 2); g.fill(); return s; })();
// the crowd stands on ground: sky texels below the horizon become the ground class (far), so the legs get keylines
function grounded(img) { const c = cv(540, 960), g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, 540, 960);
  for (let y = 560; y < 960; y++) for (let x = 0; x < 540; x++) { const j = (y * 540 + x) * 4; if (d.data[j] === 255 && d.data[j + 1] === 255) { const l = 52000 - (y - 560) * 40; d.data[j] = l >> 8; d.data[j + 1] = l & 255; d.data[j + 2] = 0; } }
  g.putImageData(d, 0, 0); return c; }
for (const f of crowdF) f.auxG = grounded(f.aux);
const crowd = k => ({ color: crowdF[k].color, aux: crowdF[k].auxG, glow: null, shape: crowdShape, depth: crowdMeta.depth, cutKT: 0.03, tonal: ['ground'], anchor: [745, 650, 150] });

// payoff: rebuilt as separations, not a styled thumbnail
const handC = await loadImage(SRC + 'hand/0_color.jpg'), handA = await loadImage(SRC + 'hand/0_aux.png');
const payoff = (() => {
  const color = cv(W, H), g = color.getContext('2d');
  g.drawImage(handC, 0, 0, W, H);
  { const st = cv(W, 480), sg = st.getContext('2d'); sg.drawImage(crowdF[0].color, 0, 660, W, 1260, 0, 0, W, 480);   // the crowd, heads first, along the foot
    sg.globalCompositeOperation = 'destination-in'; const fg = sg.createLinearGradient(0, 0, 0, 160); fg.addColorStop(0, 'rgba(0,0,0,0)'); fg.addColorStop(1, '#000');
    sg.fillStyle = fg; sg.fillRect(0, 0, W, 480); g.drawImage(st, 0, 1440); }                      // feathered: no seam in the sky tone
  const aux = cv(540, 960), a = aux.getContext('2d');
  a.fillStyle = 'rgb(255,255,0)'; a.fillRect(0, 0, 540, 960);                          // sky
  // the crowd's heads along the foot: far class at mid depth
  const ca = cv(540, 960), cg = ca.getContext('2d'); cg.drawImage(crowdF[0].aux, 0, 0);
  const cd = cg.getImageData(0, 0, 540, 960).data, ad = a.getImageData(0, 0, 540, 960);
  for (let y = 720; y < 960; y++) for (let x = 0; x < 540; x++) {
    const sy = Math.round(330 + (y - 720) * (630 / 240)), i = (sy * 540 + x) * 4, j = (y * 540 + x) * 4;
    if (sy < 960 && cd[i + 2] > 0) { const l = 30000 + ((cd[i] << 8 | cd[i + 1]) >> 3); ad.data[j] = l >> 8; ad.data[j + 1] = l & 255; ad.data[j + 2] = 64; }
  }
  // the hand and hammer: the subject, near
  const hc = cv(540, 960), hg = hc.getContext('2d'); hg.drawImage(handA, 0, 0); const hd = hg.getImageData(0, 0, 540, 960).data;
  for (let j = 0; j < 540 * 960 * 4; j += 4) if (hd[j + 2] > 200) { const l = 9000 + ((hd[j] << 8 | hd[j + 1]) >> 4); ad.data[j] = l >> 8; ad.data[j + 1] = l & 255; ad.data[j + 2] = 255; }
  a.putImageData(ad, 0, 0);
  const shape = cv(W, H), s = shape.getContext('2d'); s.fillStyle = '#000'; s.fillRect(0, 0, W, H); s.fillStyle = '#fff';
  s.beginPath(); s.arc(740, 760, 330, 0, Math.PI * 2); s.fill();
  // type: ALL / OF / IT. flat, one ink, stepped down the right side on the hammer's diagonal; black on clear
  const type = cv(W, H), t = type.getContext('2d');
  t.save(); t.translate(W - 70, 0); t.rotate(-0.105);
  line(t, 'ALL', -40, 700, { size: 360, color: '#000', align: 'right', maxW: 900 });
  line(t, 'OF', -40, 1040, { size: 360, color: '#000', align: 'right', maxW: 900 });
  line(t, 'IT.', -40, 1380, { size: 360, color: '#000', align: 'right', maxW: 900 });
  t.restore();
  // stamp: the ACP seal for INTAGLIO's impact (black art, printed in the look's red)
  const stamp = cv(W, H), st = stamp.getContext('2d'); const cx = 300, cy = 1480, r = 235;
  st.strokeStyle = '#000'; st.lineWidth = 14; st.beginPath(); st.arc(cx, cy, r, 0, Math.PI * 2); st.stroke();
  st.lineWidth = 5; st.beginPath(); st.arc(cx, cy, r - 26, 0, Math.PI * 2); st.stroke();
  const E = BRAND.acp_emblem, eh = 230, ew = E.width * eh / E.height; st.drawImage(tinted(E, '#000'), cx - ew / 2, cy - eh / 2 - 10, ew, eh);
  st.font = '40px "Archivo Black"'; st.fillStyle = '#000'; st.textAlign = 'center';
  const txt = 'AMERICAN COMMUNIST PARTY  *  ACP.US  *  '; for (let i = 0; i < txt.length; i++) { const an = -Math.PI / 2 + (i / txt.length) * Math.PI * 2;
    st.save(); st.translate(cx + Math.cos(an) * (r - 50), cy + Math.sin(an) * (r - 50)); st.rotate(an + Math.PI / 2); st.fillText(txt[i], 0, 12); st.restore(); }
  return { color, aux, glow: null, shape, type, stamp, depth: [2, 160], cutKT: 0.03, tonal: [], anchor: [740, 760, 330], stampAt: [300, 1480] };
})();
const SOURCES = { plant: () => plant, crowd: () => crowd(0), payoff: () => payoff };
window.sourceCanvases = { payoffColor: payoff.color, payoffAux: payoff.aux };

// ---------------------------------------------------------------- stills
window.still = (name, look, t = 0.5, o = {}) => {
  const s = SOURCES[name]();
  lk.source({ type: null, stamp: null, glow: null, ...s }, { color: name + (o.frame || 0), aux: name + (o.frame || 0), glow: name, shape: name, type: name, stamp: name });
  const t0 = performance.now();
  lk.apply(ctx, look, t, { stamp: look === 'INTAGLIO' && name === 'payoff' ? 1 : 0, ...o });
  { const px = new Uint8Array(4), gl = lk.pr.gl; gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  return performance.now() - t0;
};
window.raw = (name) => { const s = SOURCES[name](); ctx.drawImage(s.color, 0, 0, W, H); };

// ---------------------------------------------------------------- clips (song time; hits from out/.<song>.hits.json)
// 1 plant: SODIUM PRINT -> KLUTSIS, a plate slide on the 30-degree axis that lands on PRODUCTIVE's 10.29 s impact,
//   then KLUTSIS's impact (red plate alone, black plate off register, settle)
// 2 crowd: RISO misregister jumps on RED WEDGE's kicks, then a squeegee pull (cream + 4 plates, one per quarter beat)
//   that finishes on the 6.4 s crash; SERIGRAPH's impact (one plate alone) on that frame
// 3 payoff: INTAGLIO, the seal stamped on BANK's 7.06 s impact (jolt, slam, kiss), then a splice to NEWSREEL on the
//   7.94 s clang with its flash frame
const CLIPS = {
  1: { song: 'productive', t0: 15.9, hit: 17.1429, src: 'plant' },
  2: { song: 'red_wedge', t0: 5.4, hit: 6.4, src: 'crowd', kicks: [5.6, 6.0, 6.4, 6.8, 7.2] },
  3: { song: 'bank', t0: 6.5, hit: 7.0588, hit2: 7.9412, src: 'payoff' },
};
const CL = CLIPS[Q.get('clip')] || null;
window.clipInfo = CL;
window.renderFrame = (t) => {           // t = clip time from 0; song time = CL.t0 + t
  const T = CL.t0 + t, fps = 30;
  if (CL.src === 'plant') {
    const zoom = [1 + 0.05 * t, 0, 0.02 * t];
    lk.source(plant, { color: 'p', aux: 'p', glow: 'p', shape: 'p', type: 'none', stamp: 'none' });
    if (!lk.tex.type) {}
    const u = Looks.landing(T, CL.hit, 6), imp = Looks.impactFrame(T, CL.hit, 4);
    if (u < 1) lk.transition(ctx, 'SODIUM', 'KLUTSIS', T, u, { zoom });
    else lk.apply(ctx, 'KLUTSIS', T, { zoom, imp });
  } else if (CL.src === 'crowd') {
    const Tq = Looks.twos(t), k = Math.min(crowdF.length - 1, Math.round(Tq * 15));
    lk.source(crowd(k), { color: 'c' + k, aux: 'c' + k, glow: 'c', shape: 'c', type: 'none', stamp: 'none' });
    const kickT = CL.kicks.filter(x => x <= T + 1e-4).pop() ?? -9;
    const kImp = kickT > 0 && T < CL.hit - 0.5 * 0.4 * 1.2 ? Looks.impactFrame(T, kickT, 5) : 0;
    const pullStart = CL.hit - 0.5, u = clamp((T - pullStart) / 0.5);    // 5 pulls over 1.25 beats, landing on the hit
    const rimp = Looks.impactFrame(T, CL.hit, 4);
    if (T < pullStart) lk.apply(ctx, 'RISO', T, { imp: kImp, kick: Math.exp(-(T - kickT) * 8) });
    else if (u < 1 && !rimp) lk.transition(ctx, 'RISO', 'SERIGRAPH', T, u, {});
    else lk.apply(ctx, 'SERIGRAPH', T, { imp: rimp });
  } else {
    lk.source(payoff, { color: 'y', aux: 'y', glow: 'y', shape: 'y', type: 'y', stamp: 'y' });
    const imp = Looks.impactFrame(T, CL.hit, 3), stamped = T >= CL.hit - 1e-4 ? 1 : 0;
    const zoom = [1.0 + 0.03 * t, 0, 0];
    const us = clamp((Math.round(T * fps) - Math.round(CL.hit2 * fps) + 1) / 3);   // splice: 3 frames, the join on the hit frame
    const nimp = Looks.impactFrame(T, CL.hit2, 3);
    if (T < CL.hit2 - 1 / fps - 1e-4) lk.apply(ctx, 'INTAGLIO', T, { zoom, imp, stamp: stamped });
    else if (us < 1) lk.transition(ctx, 'INTAGLIO', 'NEWSREEL', T, us, { zoom, a: { zoom, stamp: 1 }, b: { zoom, imp: nimp } });   // the flash frame rides the splice
    else lk.apply(ctx, 'NEWSREEL', T, { zoom, imp: nimp });
  }
  { const px = new Uint8Array(4), gl = lk.pr.gl; gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  // flash marker (review only, ?marker=0 hides it): a square in the top-right corner on each hit's own frame
  if (Q.get('marker') !== '0') for (const h of [CL.hit, CL.hit2].filter(Boolean)) if (Math.round(T * fps) === Math.round(h * fps)) {
    ctx.fillStyle = '#fff'; ctx.fillRect(W - 76, 12, 64, 64); ctx.fillStyle = '#f0f'; ctx.fillRect(W - 68, 20, 48, 48); }
};
window.LOOKS = LOOKS;
window.sceneReady = true;
