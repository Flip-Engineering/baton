// RIG / DIAG (HUMAN studio, cycle 5): the skeleton overlay, an aid to judgment (never a gate fail).
//   drawDiag(ctx, camera, W, H, rep, { label, px })   rep = st.rig.rep from PeopleRig.solve()
// Draws in screen space over the frame: the skeleton (white), planted feet as green pins on the ground (red once the
// contact drifts off its pin), hand targets as rings with the residual in mm (red over 15 mm), the centre of mass
// projected to the ground against the support polygon (amber when outside), and joints outside their anatomical range.
import * as THREE from 'three';
const BONES = [['hips', 'neck'], ['neck', 'head'], ['shL', 'shR'], ['hipL', 'hipR'], ['shL', 'elL'], ['elL', 'wrL'], ['wrL', 'fiL'], ['shR', 'elR'], ['elR', 'wrR'], ['wrR', 'fiR'],
  ['hipL', 'knL'], ['knL', 'anL'], ['anL', 'toL'], ['hipR', 'knR'], ['knR', 'anR'], ['anR', 'toR'], ['hips', 'hipL'], ['hips', 'hipR'], ['neck', 'shL'], ['neck', 'shR']];
export function drawDiag(ctx, camera, W, H, rep, { label = '', k = 1 } = {}) {
  if (!rep) return; camera.updateMatrixWorld();
  const v = new THREE.Vector3(), P = a => { v.set(a[0], a[1], a[2]).project(camera); return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H, v.z]; };
  const J = rep.joints || {}, lw = Math.max(2, 3 * k);
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // support polygon and COM
  if (rep.support && rep.support.length) { ctx.beginPath(); rep.support.forEach((p, i) => { const q = P(p); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.closePath();
    const out = rep.comOut > 0.003; ctx.fillStyle = out ? 'rgba(255,170,30,0.28)' : 'rgba(60,220,140,0.22)'; ctx.fill(); ctx.strokeStyle = out ? '#ffaa1e' : '#3cdc8c'; ctx.lineWidth = lw; ctx.stroke(); }
  if (rep.comGround) { const q = P(rep.comGround.toArray ? rep.comGround.toArray() : rep.comGround); ctx.fillStyle = rep.comOut > 0.003 ? '#ffaa1e' : '#ffffff'; ctx.beginPath(); ctx.arc(q[0], q[1], 7 * k, 0, 7); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 2 * k; ctx.stroke();
    if (rep.com) { const c = P(rep.com.toArray ? rep.com.toArray() : rep.com); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.setLineDash([6 * k, 6 * k]); ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); ctx.setLineDash([]); } }
  // skeleton
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = lw * 1.3; ctx.shadowColor = '#000'; ctx.shadowBlur = 4 * k;
  for (const [a, b] of BONES) { if (!J[a] || !J[b]) continue; const p = P(J[a]), q = P(J[b]); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); }
  ctx.shadowBlur = 0; ctx.fillStyle = '#ffe066';
  for (const n in J) { const p = P(J[n]); ctx.beginPath(); ctx.arc(p[0], p[1], 3.5 * k, 0, 7); ctx.fill(); }
  // feet: pins
  for (const f of rep.feet || []) {
    if (!f) continue;
    if (f.pin) { const p = P(f.pin), c = f.contact ? P(f.contact) : p, bad = (f.holdMm || 0) > 4; ctx.strokeStyle = bad ? '#ff3030' : '#3cff8c'; ctx.lineWidth = lw * 1.4;
      ctx.beginPath(); ctx.moveTo(p[0] - 12 * k, p[1]); ctx.lineTo(p[0] + 12 * k, p[1]); ctx.moveTo(p[0], p[1] - 12 * k); ctx.lineTo(p[0], p[1] + 12 * k); ctx.stroke();
      ctx.beginPath(); ctx.arc(c[0], c[1], 8 * k, 0, 7); ctx.stroke(); }
    else if (f.contact) { const c = P(f.contact); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(c[0], c[1], 6 * k, 0, 7); ctx.stroke(); }
  }
  // hands: target ring, grip point, miss
  ctx.font = `600 ${Math.round(22 * k)}px monospace`;
  for (const h of rep.hands || []) { if (!h) continue; const t = P(h.target), g = P(h.grip), bad = h.missMm > 15;
    ctx.strokeStyle = bad ? '#ff3030' : '#30d0ff'; ctx.lineWidth = lw * 1.4; ctx.beginPath(); ctx.arc(t[0], t[1], 14 * k, 0, 7); ctx.stroke();
    ctx.fillStyle = bad ? '#ff3030' : '#30d0ff'; ctx.beginPath(); ctx.arc(g[0], g[1], 4 * k, 0, 7); ctx.fill();
    ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.moveTo(t[0], t[1]); ctx.lineTo(g[0], g[1]); ctx.stroke();
    const px = Math.hypot(t[0] - g[0], t[1] - g[1]);
    ctx.fillStyle = '#000'; ctx.fillText(`${h.missMm.toFixed(1)} mm ${px.toFixed(1)} px`, t[0] + 19 * k, t[1] - 9 * k); ctx.fillStyle = bad ? '#ff7070' : '#9fe8ff'; ctx.fillText(`${h.missMm.toFixed(1)} mm ${px.toFixed(1)} px`, t[0] + 18 * k, t[1] - 10 * k); }
  if (rep.limits && rep.limits.length) { ctx.fillStyle = '#ff5050'; ctx.fillText('LIMIT ' + rep.limits.map(l => `${l.name} ${l.flex}`).join(' '), 20 * k, H - 24 * k); }
  if (label) { ctx.fillStyle = '#000'; ctx.fillText(label, 21 * k, H - 50 * k); ctx.fillStyle = '#fff'; ctx.fillText(label, 20 * k, H - 51 * k); }
  ctx.restore();
}
