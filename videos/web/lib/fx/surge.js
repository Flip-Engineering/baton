// SURGE: a crowd composed as counter-moving diagonal REGISTERS, and the hit as an EVENT (HUMAN studio, cycle 4, change B).
//
// Why: the c3 ranks were a parade ground: three horizontal bands of evenly spaced, same-height men, standing still under
// an empty sky, and the surge changed the picture by 0.004-0.008 on the hit (a ratio of 1: no event). The eye reads
// regularity as machinery, and a band parallel to the frame edge is static by definition. Deineka's The Defence of
// Petrograd (1928) gets "inexhaustible strength" out of a few dozen men by COUNTER-MOTION: two processions cross the
// frame in opposite directions on two registers split by the bridge, flat figures against an undifferentiated ground,
// the rifles' diagonals cutting the horizontals. Klutsis adds the scale collision and the diagonal. So a crowd here is
// 2-4 registers, each with a ground line at 8-25 degrees, its own march direction and speed, clumps and gaps, a +-6 %
// height spread, a forward lean on the near register, and registers that OVERLAP (the near heads cut the mid bodies).
// Figures come from the SIL PROFILE atlas (sil_side_atlas: a 16-phase CMU mocap walk, raised fists with the chest turned
// to the lens, flag carriers, sledges and shovels on the shoulder), so every step is a real stride and every fist is a
// gesture.js glyph (safe by rule; no forward arm is baked).
//
//   import { Surge } from '../lib/fx/surge.js';
//   const S = await Surge.create({ W: 1080, H: 1920 });
//   const crowd = S.design({ seed: 4, style: 'wedge', registers: [
//     { line: [[-120, 2080], [1200, 1700]], h: 820, dir: 1, speed: 190, n: 6, lean: 0.1, fists: 0.3, role: 'near' },
//     { line: [[-80, 1180], [1160, 1460]], h: 330, dir: -1, speed: 150, n: 16, flags: 2, bridge: true },
//     { line: [[-40, 860], [1120, 640]], h: 130, dir: 1, speed: 80, n: 44, flags: 3, fists: 0.4 } ] });
//   crowd.event({ onset: 16.8, fps: 30, beats: [15.6, 16.0, 17.2] });   // anticipation / lunge / fists up in 2 frames / settle
//   S.frame(ctx, crowd, t, { back: g => sky(g) });                       // -> { info }
// The event (on a MEASURED onset, art/framecheck.py onsets): 2-6 frames of anticipation (the near register leans back
// 3-5 degrees, the walk holds, the camera eases out 1-2 %), the onset frame (the near register lunges toward the lens
// 6-10 % of frame height, the counter register keeps walking, 20-40 % of fists go up within 2 frames, all in different
// phases, and the frame prints as a two-plate impact), then a 6-10 frame settle; every beat in `beats` gets a stamp.
import { loadSil, SIDE_WALK } from './sil.js';

const rng = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = x => x * x * (3 - 2 * x);
const hex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mk = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

// register inks, near to far. RIM is the light's colour on the edge that faces it; the impact plate prints ink on paper.
export const SURGE_STYLES = {
  wedge: { ink: ['#0a0605', '#3a0a08', '#7a1410', '#a8231a'], rim: '#f4d9a8', rimAmt: [0.9, 0.55, 0.3, 0.12], acc: '#050303', ground: '#b3150f', sky: ['#e8c9a0', '#c8201a'],
    bridge: '#1a0706', flag: '#d8231a', flagDark: '#7a0c0a', paper: '#efe2c6', impactInk: '#0d0807', impactRed: '#c8201a' },
  dusk: { ink: ['#0b0706', '#44200f', '#86401f', '#bc6636'], rim: '#ffb46a', rimAmt: [1, 0.7, 0.4, 0.2], acc: '#050303', ground: '#6a2c16', sky: ['#f0a060', '#8a3018'],
    bridge: '#140806', flag: '#c8201a', flagDark: '#7a0c0a', paper: '#f2e6cc', impactInk: '#0b0706', impactRed: '#c8201a' },
  paper: { ink: ['#15110e', '#3a302a', '#6a5e52', '#948878'], rim: '#fff6e0', rimAmt: [0.3, 0.2, 0.1, 0], acc: '#0a0806', ground: '#d8ccb0', sky: ['#efe6d2', '#e2d6bc'],
    bridge: '#15110e', flag: '#c8201a', flagDark: '#7a0c0a', paper: '#efe6d2', impactInk: '#15110e', impactRed: '#c8201a' },
};

export class Surge {
  static async create({ W = 1080, H = 1920 } = {}) { const s = new Surge(W, H); s.sil = await loadSil(undefined, 'sil_side_atlas'); return s; }
  constructor(W, H) { this.W = W; this.H = H; this.tint = new Map(); this.work = mk(W, H); }

  // a tinted cell canvas (ink + rim toward the light + accent), cached per register value. ks > 1.3: the cell is
  // resampled up ONCE and its alpha re-cut (blur + smoothstep), so a near figure at 3x the atlas scale keeps a clean
  // cut-paper edge instead of blocky stairs. Returns { cv, s } (s = the canvas's scale over the atlas cell).
  cellCanvas(c, ri, st, ks = 1) {
    ks = ks > 1.3 ? Math.min(3, Math.round(ks * 2) / 2) : 1;
    const key = ri + ':' + c.k + ':' + ks; if (this.tint.has(key)) return this.tint.get(key);
    const S = this.sil, w = Math.round(S.CW * ks), h = Math.round(S.CH * ks), cv = mk(w, h), g = cv.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(S.bitmap, c.x, c.y, S.CW, S.CH, 0, 0, w, h);
    const im = g.getImageData(0, 0, w, h), D = im.data, ink = hex(st.ink[Math.min(ri, st.ink.length - 1)]), rim = hex(st.rim), acc = hex(st.acc);
    const ra = st.rimAmt[Math.min(ri, st.rimAmt.length - 1)], footY = c.foot[1] * ks;
    let A = null;
    if (ks > 1) { const r = Math.max(1, Math.round(ks * 0.6)), a0 = new Float32Array(w * h), tmp = new Float32Array(w * h); for (let i = 0; i < w * h; i++) a0[i] = D[i * 4 + 3] / 255;
      for (let y = 0; y < h; y++) { let sm = 0; const o = y * w; for (let x = -r; x <= r; x++) sm += a0[o + clamp(x, 0, w - 1)]; for (let x = 0; x < w; x++) { tmp[o + x] = sm / (2 * r + 1); sm += a0[o + Math.min(w - 1, x + r + 1)] - a0[o + Math.max(0, x - r)]; } }
      A = new Float32Array(w * h); for (let x = 0; x < w; x++) { let sm = 0; for (let y = -r; y <= r; y++) sm += tmp[clamp(y, 0, h - 1) * w + x]; for (let y = 0; y < h; y++) { A[y * w + x] = sm / (2 * r + 1); sm += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
      for (let i = 0; i < w * h; i++) { const t = clamp((A[i] - 0.38) / 0.24); A[i] = t * t * (3 - 2 * t); } }
    for (let i = 0; i < w * h; i++) {
      const a = A ? A[i] * 255 : D[i * 4 + 3]; if (!a) { D[i * 4 + 3] = 0; continue; } const y = (i / w) | 0;
      const r = D[i * 4] / 255 * ra * clamp((footY - y) / (20 * ks)), ac = D[i * 4 + 2] / 255 * 0.5;
      for (let k = 0; k < 3; k++) { let v = ink[k] + (acc[k] - ink[k]) * ac; v = v + (rim[k] - v) * r; D[i * 4 + k] = v; }
      D[i * 4 + 3] = a;
    }
    g.putImageData(im, 0, 0); const out = { cv, s: ks }; this.tint.set(key, out); return out;
  }

  design({ seed = 1, style = 'wedge', registers = [] } = {}) {
    const r = rng(seed), S = this.sil, st = typeof style === 'string' ? SURGE_STYLES[style] : style;
    const regs = registers.map((R, ri) => {
      const [[x0, y0], [x1, y1]] = R.line, len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len;
      const n = R.n || 10, figs = [], stride = R.h * 0.62;   // one walk cycle (two steps) ~ 0.62 x body height of travel
      // clumps with gaps: positions along the line as Poisson clumps, never an even comb; the loop length is the line
      // plus a margin so figures walk out of frame and back in on the other side (a procession, not a treadmill)
      const L = len + R.h * 1.2; let s = -R.h * 0.6 + r() * R.h * 0.3;
      while (figs.length < n * 1.6 && s < L - R.h * 0.6) {
        const clump = 1 + Math.floor(r() * (R.clump || 4));
        for (let k = 0; k < clump && figs.length < n * 1.6; k++) {
          const type = S.pick(r), hs = 1 + (r() * 2 - 1) * (R.spread ?? 0.06);
          const tool = r() < (R.tools || 0); figs.push({ s, type, h: R.h * hs, ph: r(), flip: R.dir < 0, tool, fist: !tool && r() < (R.fists || 0), fistPh: Math.floor(r() * 4), fistLag: Math.floor(r() * 2), flag: false, dz: r() });
          s += R.h * (0.2 + r() * 0.16);
        }
        s += R.h * (0.35 + r() * (R.gap ?? 0.7));
      }
      // flag carriers: spread along the register
      for (let k = 0; k < (R.flags || 0) && figs.length; k++) { const f = figs[Math.floor((k + 0.5) / (R.flags) * figs.length)]; f.flag = true; f.fist = false; f.tool = false; f.flagPh = k * 3.7; }
      figs.sort((a, b) => a.dz - b.dz);
      return { ...R, ri, x0, y0, ux, uy, len, L, figs, stride, lean: R.lean || 0 };
    });
    const crowd = { seed, st, regs, ev: null };
    crowd.event = e => { crowd.ev = { fps: 30, pre: 5, settle: 8, lunge: 0.08, beats: [], ...e };
      const b = crowd.ev.beats; if (b.length > 1 && crowd.ev.inStep !== false) { crowd.ev.beatLen = crowd.ev.beatLen || Math.min(...b.slice(1).map((x, i) => x - b[i])); crowd.ev.beat0 = b[0]; }
      return crowd; };
    return crowd;
  }

  // the event envelope at time t: { k (frames from onset), ant 0..1, lunge 0..1, hold (walk frozen), stamp 0..1 }
  env(crowd, t) {
    const e = crowd.ev; if (!e) return { k: 99, ant: 0, lunge: 0, hold: false, stamp: 0, impact: false };
    const k = Math.round((t - e.onset) * e.fps);
    const ant = k < 0 && k >= -e.pre ? ease((k + e.pre + 1) / e.pre) : 0;
    const lunge = k < 0 ? 0 : k === 0 ? 1 : k === 1 ? 1.06 : k <= e.settle ? 1 - 0.45 * ease((k - 1) / (e.settle - 1)) : 0.55;
    let stamp = 0; for (const b of e.beats || []) { const kb = Math.round((t - b) * e.fps); if (kb >= 0 && kb < 4) stamp = Math.max(stamp, [1, 0.55, 0.25, 0.1][kb] * (b.w || 1)); }
    return { k, ant, lunge, hold: k < 0 && k >= -e.pre, stamp, impact: k === 0 || k === 1 };
  }

  frame(ctx, crowd, t, { back = null, impactPlate = true } = {}) {
    const t0 = performance.now(), W = this.W, H = this.H, S = this.sil, st = crowd.st, E = this.env(crowd, t);
    const g = this.work.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0);
    // the camera: eases out 1.5 % in the anticipation, pushes in 4 % on the lunge, a jolt on each beat stamp
    // each beat stamp is a snap push (5 %) and a drop of the frame (22 px) that eases back over 4 frames: a picture on every kick
    const camK = (1 - 0.015 * E.ant + 0.04 * E.lunge * (E.k >= 0 ? 1 : 0)) * (1 + 0.05 * E.stamp), jolt = 30 * E.stamp;
    g.fillStyle = st.sky[1]; g.fillRect(0, 0, W, H);
    g.save(); g.translate(W / 2, H * 0.62 + jolt); g.scale(camK, camK); g.translate(-W / 2, -H * 0.62);
    if (back) back(g, t, E); else this.sky(g, st);
    // the walk clock: frozen during the anticipation (the song's freeze), on twos otherwise
    const tw = crowd.ev && E.hold ? crowd.ev.onset - (crowd.ev.pre + 1) / crowd.ev.fps : Math.floor(t * 15) / 15;
    const info = { figs: 0, raised: 0 };
    for (let ri = crowd.regs.length - 1; ri >= 0; ri--) {
      const R = crowd.regs[ri], near = R.role === 'near';
      // the register's own push: the near one lunges toward the lens (down and bigger), leans back in the anticipation
      const push = near ? E.lunge * crowd.ev?.lunge * H || 0 : 0, grow = near ? 1 + 0.12 * E.lunge : 1 + 0.03 * E.lunge * (R.role === 'mid' ? 1 : 0);
      const leanNow = R.lean * (1 + 0.6 * E.lunge) - (near ? 0.07 * E.ant : 0);
      if (R.bridge) this.bridge(g, R, st);
      R._vis = 0;
      for (const f of R.figs) {
        let s = ((f.s + R.speed * tw) % R.L + R.L) % R.L - R.h * 0.6;
        if (R.dir < 0) s = R.len - s;
        const fx = R.x0 + R.ux * s, fy = R.y0 + R.uy * s;
        const h = f.h * grow; if (fx < -h || fx > W + h) continue;
        // in step (Petrograd's columns march in step): with a beat grid the cycle is two beats long and every foot plants ON
        // the kick (the register's phase + a 0-2 frame jitter); without one, each figure keeps its own phase
        // the step is SHAPED to the beat: the foot slams to contact on the kick frame, swings through in ~4 frames, then the
        // leg hangs at the passing pose until the next kick, so each kick is a pose change of every leg at once
        const bp = crowd.ev?.beatLen; let cyc;
        if (bp) { const tb = ((E.hold ? tw : t) - crowd.ev.beat0) / bp + (R.phase || 0) * 2 + f.ph * 0.06, n = Math.floor(tb), u = tb - n;
          cyc = (((n % 2) * 8 + (u < 0.08 ? 0 : u < 0.3 ? 4 * (u - 0.08) / 0.22 : 4)) / 16 + 1) % 1; }
        else cyc = ((R.speed * tw) / R.stride + f.ph) % 1;
        let pose = SIDE_WALK[Math.floor(cyc * 16) % 16];
        if (f.flag) pose = 'pole' + (Math.floor(cyc * 4) % 4);
        else if (f.tool) pose = 'tool' + (Math.floor(cyc * 4) % 4);   // sledges and shovels on the shoulder: Deineka's rifle diagonals across the ranks
        const kk = E.k - f.fistLag;
        // the near register raises on the hit: every third figure IN FRAME (a picked share can all fall off screen)
        let raise = f.fist; if (near && crowd.ev) { R._vis = (R._vis || 0) + 1; raise = !f.flag && (R._vis % 3 === 2); }
        if (raise && crowd.ev) {
          if (kk >= 0) pose = kk <= 1 ? 'over' + (f.fistPh % 2) : 'fist' + ((f.fistPh + Math.floor(kk / 2)) % 4);   // up in 2 frames, then pumping on twos
        }
        const c = S.cell(f.type, pose) || S.cell(f.type, 'walk0'); if (!c) continue;
        const k0 = h / (S.meta.types[f.type].h * S.PPM), T = this.cellCanvas(c, ri, st, k0), cv = T.cv, k = k0 / T.s, sx = f.flip ? -1 : 1, dir = f.flip ? -1 : 1, fu = c.foot[0] * T.s, fv = c.foot[1] * T.s;
        const lx = Math.tan(leanNow) * dir;   // forward lean: the top moves toward the march direction
        const X = fx, Y = fy + push * (0.7 + 0.3 * f.dz);
        g.setTransform(1, 0, 0, 1, 0, 0); g.translate(W / 2, H * 0.62 + jolt); g.scale(camK, camK); g.translate(-W / 2, -H * 0.62);
        g.transform(k * sx, 0, -lx * k, k, X - fu * k * sx + lx * k * fv, Y - fv * k);
        g.drawImage(cv, 0, 0);
        if (f.flag) { g.scale(T.s, T.s); this.flag(g, c, st, t + f.flagPh, sx); }
        info.figs++; if (/^(fist|over)/.test(pose)) info.raised++;
      }
      g.setTransform(1, 0, 0, 1, 0, 0); g.translate(W / 2, H * 0.62 + jolt); g.scale(camK, camK); g.translate(-W / 2, -H * 0.62);
      // contact band: the register stands on its line
      g.strokeStyle = st.ink[Math.min(ri, st.ink.length - 1)]; g.lineWidth = Math.max(2, R.h * 0.025); g.beginPath();
      g.moveTo(R.x0 - 400 * R.ux, R.y0 - 400 * R.uy + (near ? push * 0.85 : 0)); g.lineTo(R.x0 + (R.len + 400) * R.ux, R.y0 + (R.len + 400) * R.uy + (near ? push * 0.85 : 0)); g.stroke();
    }
    g.restore(); g.setTransform(1, 0, 0, 1, 0, 0);
    // the impact plate: on the onset frame (and the overshoot) the frame prints as two plates, ink on paper with the red
    // plate in the ground (Klutsis / NOTAN): the picture changes in value everywhere at once, not in one arm
    if (impactPlate && E.impact) this.plate(g, st, E.k === 0 ? 1 : 0.55);
    ctx.drawImage(this.work, 0, 0);
    return { info: { ...info, k: E.k, ms: Math.round(performance.now() - t0) } };
  }

  sky(g, st) {
    const W = this.W, H = this.H, gr = g.createLinearGradient(0, 0, 0, H * 0.7); gr.addColorStop(0, st.sky[1]); gr.addColorStop(0.55, st.sky[0]); gr.addColorStop(1, st.sky[0]);
    g.fillStyle = gr; g.fillRect(-W, -H, W * 3, H * 3);
    if (st.sun !== false) { g.fillStyle = st.paper; g.beginPath(); g.arc(W * 0.7, H * 0.25, W * 0.3, 0, Math.PI * 2); g.fill(); }   // the disc the jagged top edge cuts
    g.fillStyle = st.ground; g.beginPath(); g.moveTo(-W, H * 0.5); g.lineTo(W * 2, H * 0.36); g.lineTo(W * 2, H * 3); g.lineTo(-W, H * 3); g.fill();
  }
  bridge(g, R, st) {   // Petrograd's bridge: a dark girder band under the register, with its truss
    const d = R.h * 0.16, nx = -R.uy, ny = R.ux, a = [R.x0 - 600 * R.ux, R.y0 - 600 * R.uy], b = [R.x0 + (R.len + 600) * R.ux, R.y0 + (R.len + 600) * R.uy];
    g.fillStyle = st.bridge; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(b[0], b[1] + d); g.lineTo(a[0], a[1] + d); g.fill();
    g.strokeStyle = st.bridge; g.lineWidth = Math.max(2, R.h * 0.02);
    const n = Math.ceil((R.len + 1200) / (R.h * 0.35));
    g.beginPath(); for (let k = 0; k < n; k++) { const s0 = -600 + k * R.h * 0.35, s1 = s0 + R.h * 0.35; g.moveTo(R.x0 + s0 * R.ux, R.y0 + s0 * R.uy + d); g.lineTo(R.x0 + s1 * R.ux, R.y0 + s1 * R.uy + d * 2.4); g.lineTo(R.x0 + (s1 + R.h * 0.35) * R.ux, R.y0 + (s1 + R.h * 0.35) * R.uy + d); }
    g.stroke();
    g.beginPath(); g.moveTo(a[0], a[1] + d * 2.4); g.lineTo(b[0], b[1] + d * 2.4); g.lineWidth = Math.max(3, R.h * 0.04); g.stroke();
  }
  flag(g, c, st, t, sx) {   // cloth on the pole: two-wave strip, the dark fold travelling (cell px, the cell's own transform)
    if (!c.pole) return; const [lo, hi] = c.pole, dx = hi[0] - lo[0], dy = hi[1] - lo[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    const top = [hi[0] + ux * 150, hi[1] + uy * 150], bot = [lo[0] - ux * 30, lo[1] - uy * 30];
    g.strokeStyle = '#1a0a06'; g.lineWidth = 3.5; g.beginPath(); g.moveTo(bot[0], bot[1]); g.lineTo(top[0], top[1]); g.stroke();
    const fw = 120, fh = 72, n = 10;
    g.beginPath(); for (let k = 0; k <= n; k++) { const u = k / n, w = Math.sin(u * 5 - t * 9) * 9 * u; g.lineTo(top[0] - fw * u, top[1] + w); }
    for (let k = n; k >= 0; k--) { const u = k / n, w = Math.sin(u * 5 - t * 9 + 0.6) * 9 * u; g.lineTo(top[0] - fw * u, top[1] + fh + w); } g.closePath();
    g.fillStyle = st.flag; g.fill();
    g.save(); g.clip(); g.fillStyle = st.flagDark; g.globalAlpha = 0.55; const u0 = ((t * 1.4) % 1); g.fillRect(top[0] - fw * (u0 + 0.15), top[1] - 20, fw * 0.14, fh + 40); g.restore(); g.globalAlpha = 1;
  }
  // the two-plate impact: the frame re-printed with its plates SWAPPED (Klutsis / NOTAN): ink stays ink, every red goes to
  // paper and every paper to red, so the whole frame changes value at once on the onset, not one arm
  plate(g, st, amt) {
    const W = this.W, H = this.H, im = g.getImageData(0, 0, W, H), D = im.data, ink = hex(st.impactInk), red = hex(st.impactRed), pap = hex(st.paper);
    for (let i = 0; i < W * H; i++) { const L = (0.3 * D[i * 4] + 0.59 * D[i * 4 + 1] + 0.11 * D[i * 4 + 2]) / 255, R = D[i * 4] / 255, sat = R - L;
      const c = L < 0.16 ? ink : (sat > 0.12 && L < 0.62) ? pap : red;
      for (let k = 0; k < 3; k++) D[i * 4 + k] = D[i * 4 + k] + (c[k] - D[i * 4 + k]) * amt; }
    g.putImageData(im, 0, 0);
  }
}
