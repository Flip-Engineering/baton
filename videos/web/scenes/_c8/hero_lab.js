import { createHero } from '../meltdown8_hero.js';
const cv = document.getElementById('out'), g = cv.getContext('2d');
const hero = createHero(1080, 1920, { scale: 1 });
window.labDraw = (c) => { g.fillStyle = c.bg || '#3a0406'; g.fillRect(0, 0, 1080, 1920); const kn = hero.draw(g, c);
  if (c.dots) { g.fillStyle = '#0f0'; for (const k of kn) { g.beginPath(); g.arc(k.x, k.y, 14, 0, 6.3); g.fill(); g.save(); g.translate(k.x, k.y); g.rotate(k.ang); g.fillStyle = '#ffee'; g.fillRect(-k.len / 2, -8, k.len, 16); g.restore(); g.fillStyle = '#0f0'; } }
  return kn; };
window.labReady = true;
