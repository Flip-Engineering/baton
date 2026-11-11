// WHO OWNS THE MACHINES? (machines): the machines on the horizon (world H, cycle WM1).
// Each named machine is a flat far silhouette on the horizon under the dot, Sheeler-flat (American Landscape,
// Classic Landscape: the plant as calm planes, the human tiny or turned away) and lit only by its own practicals,
// as the threshers stand on the horizon in Days of Heaven. Never the hero image: small, far, flat, one light.
//
//   machine(ctx, kind, { x, y, s, sky, lit, t, seed })
//     x, y  the machine's foot centre on the horizon line (frame px); s  px per metre (far: 1.2-3)
//     sky   [r,g,b] the sky colour just above the horizon (the silhouette is a haze-mix toward it)
//     lit   0..1 its practicals (marker lights, sodium windows, beacons, the plume lit from below)
//     haze  0..1 how far it sits (0 near-black, 1 almost the sky)
//   Returns { top: [x, y] } the machine's emitter point (for the ring waves) and its bounding box.
// Kinds: truck, factory, plant, mine, datacenter (low block + beacons; never racks or halls), crane, loco, hull,
// mill, arm. Everything is 2D paths; lights are small discs with a tight glow (never bloom on the dot).
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, x) => a + (b - a) * x;
function hash(i) { let x = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; }
const mix = (a, b, k) => a.map((v, i) => Math.round(lerp(v, b[i], k)));
const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// light: a hard core and a tight glow ('lighter')
function lamp(ctx, x, y, r, col, a = 1, glow = 5) {
  if (a <= 0.01) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * glow);
  g.addColorStop(0, css(col, 0.55 * a)); g.addColorStop(0.25, css(col, 0.16 * a)); g.addColorStop(1, css(col, 0));
  ctx.fillStyle = g; ctx.fillRect(x - r * glow, y - r * glow, r * glow * 2, r * glow * 2);
  ctx.fillStyle = css(mix(col, [255, 255, 255], 0.5), a); ctx.beginPath(); ctx.arc(x, y, Math.max(0.8, r), 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export const MACHINE_KINDS = ['truck', 'factory', 'plant', 'mine', 'datacenter', 'crane', 'loco', 'hull', 'mill', 'arm'];

export function machine(ctx, kind, { x = 540, y = 1400, s = 2, sky = [230, 95, 30], lit = 1, t = 0, seed = 1, haze = 0.18, flip = false } = {}) {
  const base = mix([16, 8, 7], sky, haze), lip = mix(base, sky, 0.22);     // the dark plane and the sky-facing plane
  const P = (mx, my) => [x + (flip ? -mx : mx) * s, y - my * s];
  const poly = (pts, col = base) => { ctx.fillStyle = css(col); ctx.beginPath(); pts.forEach((p, i) => { const q = P(p[0], p[1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.closePath(); ctx.fill(); };
  const rect = (x0, y0, w, h, col = base) => poly([[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]], col);
  const line = (pts, w, col = base) => { ctx.strokeStyle = css(col); ctx.lineWidth = Math.max(1, w * s); ctx.lineCap = 'butt'; ctx.beginPath();
    pts.forEach((p, i) => { const q = P(p[0], p[1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.stroke(); };
  const L = (mx, my, r, col, a = 1, glow = 5) => { const q = P(mx, my); lamp(ctx, q[0], q[1], r * s, col, a * lit, glow); };
  const AMBER = [255, 170, 60], RED = [255, 40, 30], SODIUM = [255, 150, 60], WHITE = [255, 236, 210];
  const blink = (ph, rate = 0.67) => (Math.sin((t * rate + ph) * Math.PI * 2) > -0.2 ? 1 : 0.15);
  let top = P(0, 10);
  ctx.save();
  if (kind === 'truck') {
    // a 53 ft van trailer and a long-hood conventional with a sleeper, side on, facing right (the rig)
    rect(-10.5, 1.2, 16.2, 2.9);                                   // trailer box (floor 1.2 m, roof 4.1 m)
    poly([[-10.5, 4.1], [5.7, 4.1], [5.7, 4.02], [-10.5, 4.02]], lip); // the roof's sky edge
    rect(-10.2, 0.5, 2.6, 0.9); rect(3.4, 0.9, 1.4, 0.4);          // bogie, landing gear
    poly([[5.9, 0.9], [6.2, 3.95], [8.1, 3.95], [8.2, 3.3], [9.0, 3.25], [9.2, 2.35], [11.4, 2.15], [11.8, 1.9], [11.9, 0.9]]);   // sleeper, cab, hood
    poly([[9.0, 3.25], [9.2, 2.35], [9.4, 2.35], [9.15, 3.2]], lip); // windshield edge
    line([[8.5, 3.9], [8.5, 4.6]], 0.16); line([[8.9, 3.4], [8.9, 4.1]], 0.12);   // stacks
    for (const wx of [-9.4, -8.2, 6.8, 9.9, 11.0]) { ctx.fillStyle = css([10, 5, 5]); const q = P(wx, 0.5); ctx.beginPath(); ctx.arc(q[0], q[1], 0.52 * s, Math.PI, 0); ctx.fill(); }
    for (let k = 0; k < 6; k++) L(-10.2 + k * 3.1, 3.95, 0.09, AMBER, 1, 4);                     // clearance and marker lights
    L(-10.45, 1.5, 0.12, RED, 1, 5); L(-10.45, 3.9, 0.08, RED, 0.8, 4);
    for (const mx of [6.4, 7.0, 7.6]) L(mx, 4.02, 0.07, AMBER, 0.9, 4);                           // cab roof lights
    L(11.85, 1.55, 0.16, WHITE, 1, 7);                                                             // headlamp
    top = P(-2, 4.1);
  } else if (kind === 'factory') {
    // a sawtooth-roof plant: north lights lit sodium from inside, two stacks, a water tower
    const n = 9, bw = 9, H0 = 10;
    rect(-n * bw / 2, 0, n * bw, H0);
    for (let k = 0; k < n; k++) {
      const x0 = -n * bw / 2 + k * bw;
      poly([[x0, H0], [x0, H0 + 4.2], [x0 + bw, H0]]);                         // the tooth
      poly([[x0, H0 + 0.3], [x0, H0 + 3.9], [x0 + 0.9, H0 + 3.5], [x0 + 0.9, H0 + 0.3]], mix(base, SODIUM, 0.1));
      L(x0 + 0.45, H0 + 1.9, 0.5, SODIUM, 0.55 + 0.45 * hash(k + seed), 3);      // the glazing lit from inside
    }
    for (let k = 0; k < 14; k++) { const q = P(-n * bw / 2 + 2 + k * 5.6, 4.5); lamp(ctx, q[0], q[1], 0.35 * s, SODIUM, 0.5 * lit * (hash(k * 3 + seed) > 0.3 ? 1 : 0.2), 3); }
    line([[n * bw / 2 - 8, H0], [n * bw / 2 - 8, 34]], 2.4); line([[n * bw / 2 - 14, H0], [n * bw / 2 - 14, 28]], 1.9);
    L(n * bw / 2 - 8, 34.4, 0.3, RED, blink(0.1 + seed), 6);
    line([[-n * bw / 2 + 8, H0], [-n * bw / 2 + 8, 22]], 0.5); line([[-n * bw / 2 + 12, H0], [-n * bw / 2 + 12, 22]], 0.5);
    poly([[-n * bw / 2 + 6.5, 22], [-n * bw / 2 + 13.5, 22], [-n * bw / 2 + 13.5, 26], [-n * bw / 2 + 10, 28.5], [-n * bw / 2 + 6.5, 26]]);
    top = P(n * bw / 2 - 8, 34);
  } else if (kind === 'plant') {
    // a natural-draft cooling tower (hyperboloid) and its plume lit red from below; a stack and the switchyard
    const hy = (u) => { const r = 0.5 * (1 - u) * 1 + 0; return r; };
    const Ht = 58, rb = 24, rw = 15, rt = 17.5, pts = [];
    for (let i = 0; i <= 20; i++) { const u = i / 20, yy = u * Ht, r = u < 0.72 ? lerp(rb, rw, Math.pow(u / 0.72, 0.7)) : lerp(rw, rt, (u - 0.72) / 0.28); pts.push([r, yy]); }
    poly([...pts.map(p => [-p[0], p[1]]), ...pts.slice().reverse()]);
    poly([...pts.map(p => [p[0] * 0.55, p[1]]), ...pts.slice().reverse()], lip);                         // the lit plane (Sheeler)
    // the plume: soft billows rising, underside lit by the plant (a flat red on its belly)
    const PL = (a) => {
      for (let k = 0; k < 9; k++) {
        const u = k / 8, px = lerp(0, 22, u) + Math.sin(t * 0.6 + k) * 1.2, py = Ht + 6 + u * 44, r = 12 + u * 14;
        const q = P(px, py), R = r * s;
        const g = ctx.createRadialGradient(q[0], q[1] + R * 0.3, R * 0.1, q[0], q[1], R);
        g.addColorStop(0, css(mix(sky, [255, 70, 50], 0.35 * lit), 0.55 * a)); g.addColorStop(0.7, css(mix(sky, [120, 30, 20], 0.3), 0.28 * a)); g.addColorStop(1, css(sky, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q[0], q[1], R, 0, Math.PI * 2); ctx.fill();
      }
    };
    PL(1);
    line([[34, 0], [34, 70]], 3.2); L(34, 70.5, 0.45, RED, blink(0.3 + seed), 6); L(34, 40, 0.35, RED, blink(0.3 + seed), 5);
    for (let k = 0; k < 4; k++) line([[46 + k * 4, 0], [46 + k * 4, 11]], 0.6);                               // switchyard gantries
    line([[44, 11], [60, 11]], 0.6);
    top = P(0, Ht);
  } else if (kind === 'mine') {
    // a steel headframe: two legs and the back-leg brace, the sheave wheels at the top, the hoist house, the conveyor
    const Ht = 38;
    line([[-5, 0], [-2.2, Ht]], 1.2); line([[5, 0], [2.2, Ht]], 1.2); line([[16, 0], [2.4, Ht - 2]], 1.1);
    for (let k = 1; k < 6; k++) { const u = k / 6; line([[lerp(-5, -2.2, u), u * Ht], [lerp(5, 2.2, u), u * Ht]], 0.5); line([[lerp(-5, -2.2, u), u * Ht], [lerp(5, 2.2, u + 1 / 6), (u + 1 / 6) * Ht]], 0.3); }
    rect(-3.4, Ht - 0.5, 6.8, 1.2);
    for (const sx of [-1.5, 1.5]) {                                                                            // sheave wheels (spokes)
      const q = P(sx, Ht + 2.6), R = 2.8 * s; ctx.strokeStyle = css(base); ctx.lineWidth = Math.max(1, 0.4 * s);
      ctx.beginPath(); ctx.arc(q[0], q[1], R, 0, Math.PI * 2); ctx.stroke();
      const a0 = t * 1.6 * (sx < 0 ? 1 : -1); ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = a0 + k * Math.PI / 3; ctx.moveTo(q[0], q[1]); ctx.lineTo(q[0] + Math.cos(a) * R, q[1] + Math.sin(a) * R); } ctx.stroke();
    }
    rect(18, 0, 16, 9); poly([[18, 9], [26, 12.5], [34, 9]]);                                                  // hoist house
    for (let k = 0; k < 3; k++) L(20.5 + k * 5, 5.5, 0.55, SODIUM, 0.9, 3);
    poly([[-34, 0], [-6, 16], [-6, 18], [-34, 1.8]]); rect(-40, 0, 8, 6);                                      // conveyor incline, tipple
    L(0, Ht + 6, 0.4, RED, blink(0.6 + seed), 6); L(-6, 17, 0.35, SODIUM, 1, 4);
    top = P(0, Ht + 2.6);
  } else if (kind === 'datacenter') {
    // a low long block with rooftop plant, aviation beacons at the corners (racks and halls never show)
    rect(-60, 0, 120, 14); for (let k = 0; k < 10; k++) rect(-55 + k * 11.5, 14, 7, 2.4);
    rect(62, 0, 18, 8); line([[66, 8], [66, 24]], 0.7); line([[76, 8], [76, 24]], 0.7); line([[64, 24], [78, 24]], 0.8);
    for (const bx of [-59, 59]) L(bx, 14.6, 0.35, RED, blink(0.2 + bx * 0.01), 6);
    for (let k = 0; k < 8; k++) L(-52 + k * 14.5, 3.5, 0.3, WHITE, 0.45, 3);
    top = P(0, 16);
  } else if (kind === 'crane') {
    // a tower crane: lattice mast, the jib out over the site, the counter-jib and its weights, the hook line
    const Hm = 60;
    line([[-1.6, 0], [-1.6, Hm]], 0.5); line([[1.6, 0], [1.6, Hm]], 0.5);
    for (let k = 0; k < 15; k++) line([[-1.6, k * 4], [1.6, k * 4 + 4]], 0.25);
    poly([[-1.8, Hm], [1.8, Hm], [0.8, Hm + 9], [-0.8, Hm + 9]]);
    line([[0, Hm + 2], [52, Hm + 2]], 1.4); line([[0, Hm + 2], [-18, Hm + 2]], 1.6); rect(-18, Hm - 2.5, 5, 4.5);
    line([[0, Hm + 9], [30, Hm + 2.6]], 0.2); line([[0, Hm + 9], [-16, Hm + 2.6]], 0.2);
    line([[38, Hm + 1.3], [38, 18]], 0.15); rect(36.6, 14, 2.8, 4);                                             // hook + load
    L(0, Hm + 9.3, 0.4, RED, blink(0.2 + seed), 6); L(52, Hm + 2.4, 0.35, RED, blink(0.7 + seed), 5); L(1.9, Hm - 1, 0.35, SODIUM, 1, 4);
    top = P(0, Hm + 9);
  } else if (kind === 'loco') {
    // a road-switcher diesel, the long hood forward, its headlight beam laid along the rail
    rect(-11, 1.2, 22, 3.0); poly([[4, 4.2], [4, 5.2], [8.6, 5.2], [9.4, 4.2]]); rect(-9, 4.2, 12, 0.35, lip);
    rect(-10, 0.3, 6, 1.1); rect(4, 0.3, 6, 1.1); line([[-40, 0.1], [60, 0.1]], 0.25);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const a = P(11, 3.4), b = P(60, 0.3), c = P(60, 7); const g = ctx.createLinearGradient(a[0], a[1], b[0], a[1]);
    g.addColorStop(0, css(WHITE, 0.35 * lit)); g.addColorStop(1, css(WHITE, 0)); ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.closePath(); ctx.fill(); ctx.restore();
    L(11, 3.4, 0.3, WHITE, 1, 8); L(-11, 3.8, 0.18, RED, 1, 4); L(6.8, 5.35, 0.2, AMBER, blink(0.1, 1.2), 5);
    top = P(0, 5.2);
  } else if (kind === 'hull') {
    // a hull on the ways: the bow high and raked, the scaffold, a gantry crane over the yard
    poly([[-70, 0], [-70, 10], [-55, 13], [30, 13], [44, 15], [52, 17.5], [46, 6], [34, 0]]);
    poly([[-60, 13], [30, 13], [30, 13.6], [-60, 13.6]], lip);
    for (let k = 0; k < 7; k++) line([[-50 + k * 12, 13], [-50 + k * 12, 0]], 0.25);
    line([[-80, 0], [-80, 44]], 1.4); line([[60, 0], [60, 44]], 1.4); line([[-84, 44], [64, 44]], 2.0);
    rect(-5, 38.5, 10, 4.5); line([[0, 38.5], [0, 22]], 0.15);
    for (let k = 0; k < 5; k++) L(-40 + k * 18, 14.2, 0.28, SODIUM, 0.9, 4);
    L(-80, 44.8, 0.35, RED, blink(0.5), 5); L(60, 44.8, 0.35, RED, blink(0.9), 5);
    const fl = 0.5 + 0.5 * Math.sin(t * 23 + seed * 3); L(20, 9, 0.35, [210, 230, 255], fl, 7);      // an arc at the seam
    top = P(52, 17.5);
  } else if (kind === 'mill') {
    // an integrated mill: the blast furnace and its stoves, three stacks, the cast house glowing at its base
    for (let k = 0; k < 3; k++) { rect(-30 + k * 7.5, 0, 6, 34, k === 1 ? lip : base); poly([[-30 + k * 7.5, 34], [-24 + k * 7.5, 34], [-27 + k * 7.5, 37]]); }
    poly([[-4, 0], [-6, 18], [-3.5, 36], [3.5, 36], [6, 18], [4, 0]]); line([[0, 36], [0, 52]], 1.8); line([[-4, 44], [10, 44], [10, 30]], 0.8);
    rect(8, 0, 30, 14); for (const sx of [14, 22, 30]) line([[sx, 14], [sx, 64]], 2.2);
    for (const sx of [14, 22, 30]) L(sx, 64.5, 0.4, RED, blink(sx * 0.03), 5);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const q = P(0, 3), R = 16 * s, g = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], R);
    g.addColorStop(0, css([255, 140, 50], 0.55 * lit)); g.addColorStop(1, css([255, 80, 30], 0)); ctx.fillStyle = g; ctx.fillRect(q[0] - R, q[1] - R, R * 2, R);
    ctx.restore();
    L(0, 3, 0.8, [255, 170, 80], 1, 3);
    top = P(22, 64);
  } else if (kind === 'arm') {
    // an industrial robot arm at plant scale (a far silhouette): base, turret, upper arm, forearm, the wrist and tool
    const a1 = -0.25 + 0.08 * Math.sin(t * 0.8), a2 = 0.9 + 0.1 * Math.sin(t * 0.8 + 1);
    rect(-8, 0, 16, 3); poly([[-5.5, 3], [5.5, 3], [4.5, 9], [-4.5, 9]]);
    const sh = [0, 10.5], L1 = 22, L2 = 19;
    const el = [sh[0] + Math.sin(a1) * L1, sh[1] + Math.cos(a1) * L1], wr = [el[0] + Math.sin(a2) * L2, el[1] + Math.cos(a2) * L2 * 0.35];
    line([sh, el], 4.2); line([el, wr], 3.0);
    for (const [c, r] of [[sh, 3.6], [el, 2.8]]) { const q = P(c[0], c[1]); ctx.fillStyle = css(base); ctx.beginPath(); ctx.arc(q[0], q[1], r * s, 0, Math.PI * 2); ctx.fill(); }
    line([wr, [wr[0] + 3.5, wr[1] - 2.5]], 1.6);
    L(wr[0] + 3.8, wr[1] - 2.9, 0.4, [200, 225, 255], 0.9, 6); L(0, 9.4, 0.35, AMBER, blink(0.4, 1.4), 5);
    top = P(el[0], el[1]);
  }
  ctx.restore();
  return { top };
}

// A flat horizon ground plate from the machine outward (the plain), with a faint lit edge where it meets the sky.
export function ground(ctx, y, { sky = [230, 95, 30], col = [18, 9, 8], W = 1080, H = 1920 } = {}) {
  ctx.fillStyle = css(col); ctx.fillRect(-20, y, W + 40, H - y + 20);
  const g = ctx.createLinearGradient(0, y - 1, 0, y + 10);
  g.addColorStop(0, css(mix(sky, col, 0.35), 0.8)); g.addColorStop(1, css(col, 0));
  ctx.fillStyle = g; ctx.fillRect(-20, y - 1, W + 40, 12);
}
