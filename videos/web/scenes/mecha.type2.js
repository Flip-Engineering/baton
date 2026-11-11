// MECHA PROLETARIAT type layer (from v1's slam/slamBlock; Chakra Petch 700, cream with an ink keyline, a 2-frame smear on the slam).
export function makeType(ctx, W, H) {
  const CAPR = (() => { ctx.font = '700 100px "Chakra Petch"'; return ctx.measureText('H').actualBoundingBoxAscent / 100; })();
  function slam(text, age, frame, { emph = 0, y = 520, cap = 150, maxW = W * 0.88, italic = false, title = false } = {}) {
    let size = cap / CAPR;
    const font = s => `${italic ? 'italic ' : ''}700 ${s}px "Chakra Petch"`;
    ctx.font = font(size); let w = ctx.measureText(text).width;
    if (w > maxW) { size *= maxW / w; ctx.font = font(size); w = ctx.measureText(text).width; }
    const capH = size * CAPR, x = W / 2 - w / 2, yb = y + capH / 2;
    const f = Math.round(age * 30);
    ctx.save(); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
    if (f < 2 && frame > 0) {                                            // the 2-frame smear on the slam
      const dir = f === 0 ? 1 : 0.45;
      for (let k = 6; k >= 1; k--) { ctx.globalAlpha = 0.14 * (7 - k) / 6; ctx.fillStyle = '#F4E6D0'; ctx.setTransform(1 + 0.25 * dir, 0, -0.18 * dir, 1, -W / 2 * 0.25 * dir + k * 26 * dir, 0); ctx.fillText(text, x - k * 40 * dir, yb); }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    const pop = 1 + (emph ? 0.12 : 0.07) * Math.max(0, 1 - age / 0.1);
    ctx.translate(W / 2, y); ctx.scale(pop, pop); ctx.translate(-W / 2, -y);
    if (title) {                                                           // the title card: armor-red offset + speed-slash
      ctx.globalAlpha = 1; ctx.fillStyle = '#C91F37'; ctx.fillText(text, x + 14, yb + 12);
    }
    ctx.globalAlpha = 1; ctx.strokeStyle = '#120a0a'; ctx.lineWidth = Math.max(8, capH * 0.09); ctx.strokeText(text, x, yb);
    ctx.fillStyle = '#F4E6D0'; ctx.fillText(text, x, yb);
    ctx.restore();
    return { x, y: yb - capH, w, h: capH };
  }
  // multi-line cards: 'LINE|LINE', a leading '*' sets that line in italic (RISE italicises "working class"). One size for the
  // block, fitted to its widest line; the slam smear and pop as slam(). print: ink on paper with a red offset (the Marx run).
  function slamBlock(text, age, frame, { emph = 0, y = 560, cap = 140, maxW = W * 0.88, print = false, title = false } = {}) {
    const lines = text.split('|').map(l => l.startsWith('*') ? { t: l.slice(1), it: true } : { t: l, it: false });
    const nL = lines.length;
    let size = cap / CAPR * (nL === 1 ? 1 : nL === 2 ? 0.9 : 0.78);
    const font = (sz, it) => `${it ? 'italic ' : ''}700 ${sz}px "Chakra Petch"`;
    const widest = sz => Math.max(...lines.map(l => { ctx.font = font(sz, l.it); return ctx.measureText(l.t).width; }));
    const w0 = widest(size); if (w0 > maxW) size *= maxW / w0;
    const capH = size * CAPR, lead = capH * 1.36, blockH = capH + (nL - 1) * lead, top = y - blockH / 2;
    const f = Math.round(age * 30);
    ctx.save(); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
    const pop = 1 + (emph ? 0.10 : 0.06) * Math.max(0, 1 - age / 0.1);
    ctx.translate(W / 2, y); ctx.scale(pop, pop); ctx.translate(-W / 2, -y);
    lines.forEach((l, i) => {
      ctx.font = font(size, l.it); const w = ctx.measureText(l.t).width, x = W / 2 - w / 2, yb = top + capH + i * lead;
      if (f < 2 && frame > 0 && !print) {
        const dir = f === 0 ? 1 : 0.45; ctx.save();
        for (let k = 5; k >= 1; k--) { ctx.globalAlpha = 0.12 * (6 - k) / 5; ctx.fillStyle = '#F4E6D0'; ctx.setTransform(1 + 0.2 * dir, 0, -0.14 * dir, 1, -W / 2 * 0.2 * dir + k * 22 * dir, 0); ctx.fillText(l.t, x - k * 34 * dir, yb); }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (print) { ctx.fillStyle = '#C91F37'; ctx.fillText(l.t, x + 7, yb + 7); ctx.fillStyle = '#120a0a'; ctx.fillText(l.t, x, yb); }
      else {
        if (title) { ctx.fillStyle = '#C91F37'; ctx.fillText(l.t, x + 14, yb + 12); }
        ctx.strokeStyle = '#120a0a'; ctx.lineWidth = Math.max(8, capH * 0.09); ctx.strokeText(l.t, x, yb);
        ctx.fillStyle = '#F4E6D0'; ctx.fillText(l.t, x, yb);
      }
    });
    ctx.restore();
  }

  return { slam, slamBlock };
}
