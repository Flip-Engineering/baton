// SCANSION c2 demo (not a piece): MELTDOWN v13's sentence cards, set two ways on the same ground. window.renderFrame(t, mode, beat)
//   mode 'before'  v13: meltdown8_cards.js cardBoard (width-wrapped rows, one 0.3 s cascade)
//   mode 'after'   engine/score/place.py's ladder on lib/fx/stress_board.js (stress groups, half-height function flaps)
// The ground is a plain blue-black wash with a grid, not the piece's freeze world: it shows the TYPE, not the piece.
import { W, H, loadFonts } from '../lib/kit.js';
import { cardBoard } from './meltdown8_cards.js';
import { stressBoard } from '../lib/fx/stress_board.js';

await loadFonts();
const D = await (await fetch('../../review/studio_scansion_c2/after/demo/ladders.json')).json();
const SPB = 60 / D.bpm;
const cv = document.getElementById('out'), g = cv.getContext('2d');
const REGION = { freeze: [980, 1870], ledger: [1170, 1880], machines: [1230, 1880], plan: [1300, 1880], loss: [96, 800], fin: [96, 800], marx: [1170, 1880], zero: [1170, 1880], story: [330, 1330], lenin: [310, 1490], turn: [96, 660], post: [1170, 1880], program: [96, 920], search: [96, 800] };
const FREEZE = { housing: '#0c1620', housing2: '#050a10', edge: 'rgba(180,225,255,0.3)', citeCol: '#dcefff' };
function ground(t) {
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#07131f'); gr.addColorStop(1, '#0a1c2e');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(120,190,240,0.07)'; g.lineWidth = 2;
  for (let x = 0; x < W; x += 90) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y < H; y += 90) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
}
window.cards = D.cards.map(c => c.beat);
window.renderFrame = async (t, mode, beat) => {
  const c = D.cards.find(x => x.beat === beat) || D.cards[0];
  ground(t);
  const face = c.before.face, region = REGION[face] || [980, 1870];
  const o = Object.assign({ spb: SPB }, face === 'freeze' || face === 'turn' ? FREEZE : {});
  if (mode === 'before') {
    cardBoard(g, t, { b0: c.beat, rows: c.before.rows, hold: c.before.hold, face, cite: c.before.cite }, region, o);
  } else {
    stressBoard(g, t, c.after, region, Object.assign({ cite: c.before.cite }, o));
  }
  g.font = '28px "Plex Mono"'; g.fillStyle = 'rgba(255,255,255,0.55)'; g.textAlign = 'left';
  g.fillText(`${mode === 'before' ? 'v13 rows' : 'stress ladder'}   b${c.beat}   t=${(t - c.beat * SPB).toFixed(2)} s from the card   [unheard]`, 40, 60);
};
window.sceneReady = true;
