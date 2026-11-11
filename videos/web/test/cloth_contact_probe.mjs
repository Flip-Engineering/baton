// Issue #87 S2: reproducible, CPU-only comparison for the cloth-motion seam contact fix.
//
// Run from videos/web (three resolves from its package; no render, no GPU, no person assets):
//   node test/cloth_contact_probe.mjs > ../../homelab/issue87/cloth-contact-comparison.json
//
// The fixture is deterministic; the measured criteria are the same ones the focused test asserts. `relax` sweeps 4 and 8 are the issue's
// steps comparison; 0 is the contact-only A/B where the pre-fix final weld left the seam inside the trunk.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ClothMotion } from '../lib/fx/motion/cloth_motion.js';
import { makeClothFixture, seamMetrics, garmentMetrics } from './cloth_contact_fixture.mjs';

const SEED = 'ea34d497789638f0cc1103c2e97094bfff8b0e6e9ec4a6918282be760f42ecb4f4bab6f9367971b808847a8bf5cd37e51f6a5bfed19fbbcf1120aee5eb63c8fb';
const ROOT = new URL('../../../', import.meta.url);   // repo root from videos/web/test/
const SOURCES = ['videos/web/lib/fx/motion/cloth_motion.js', 'videos/web/test/cloth_contact_fixture.mjs',
  'videos/web/test/cloth_contact.test.mjs', 'videos/web/test/cloth_contact_probe.mjs'];
const sha256 = p => createHash('sha256').update(readFileSync(new URL(p, ROOT))).digest('hex');
const derivedSeed = subsystem => createHash('sha256').update(Buffer.from(SEED, 'hex')).update(':' + subsystem).digest('hex').slice(0, 16);
const git = (...args) => execFileSync('git', args, { cwd: fileURLToPath(ROOT) }).toString().trim();

function scenario({ fabric = 'chambray', relax, seamContact = true }) {
  const f = makeClothFixture({ fabric }), C = new ClothMotion(f.P, { relax, seamContact });
  C.rest(); f.pose(0.012);
  const rep = C.step(1 / 15, { first: true, measure: false });
  const seam = seamMetrics(C), cloth = garmentMetrics(C);
  return {
    relax, fabric, seam_contact: seamContact,
    seam_penetration_mm: +seam.penetrationMm.toFixed(4),
    seam_clearance_mm: +seam.minClearanceMm.toFixed(4),
    seam_deficit_before_mm: rep.seamDeficitMm ?? null,
    seam_move_mm: rep.seamMoveMm ?? null,
    seam_pushed: rep.seamPushed ?? null,
    seam_coincidence_mm: +seam.coincidenceMm.toFixed(6),
    cloth_penetration_mm: +cloth.penetrationMm.toFixed(4),
    cloth_stretch: +cloth.stretch.toFixed(6),
  };
}

function run(opts) {
  const a = scenario(opts), b = scenario(opts);
  const deterministic = JSON.stringify(a) === JSON.stringify(b);
  return { ...a, deterministic };
}


function sequence({ fabric = 'chambray', relax, frames = 9 }) {
  const f = makeClothFixture({ fabric }), C = new ClothMotion(f.P, { relax }); C.rest();
  let pen = 0, deficit = 0, coin = 0, stretch = 0;
  for (let i = 0; i < frames; i++) { f.pose(0.012 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (frames - 1))));
    C.step(1 / 15, { first: i === 0, measure: false });
    const s = seamMetrics(C), g = garmentMetrics(C);
    pen = Math.max(pen, s.penetrationMm); deficit = Math.max(deficit, s.deficitMm); coin = Math.max(coin, s.coincidenceMm); stretch = Math.max(stretch, g.stretch); }
  return { relax, fabric, frames, max_seam_penetration_mm: +pen.toFixed(4), max_seam_deficit_mm: +deficit.toFixed(4),
    max_seam_coincidence_mm: +coin.toFixed(6), max_cloth_stretch: +stretch.toFixed(6) };
}
function runSequence(opts) { const a = sequence(opts), b = sequence(opts); return { ...a, deterministic: JSON.stringify(a) === JSON.stringify(b) }; }

const scenarios = [0, 4, 8].flatMap(relax => [run({ relax, seamContact: false }), run({ relax, seamContact: true })])
  .concat([run({ relax: 8, fabric: 'leather', seamContact: false }), run({ relax: 8, fabric: 'leather', seamContact: true })]);
const sequences = [4, 8].map(relax => runSequence({ relax })).concat([runSequence({ relax: 8, fabric: 'leather' })]);
const criteria = {
  seam_penetration_mm: { max: 0.001, definition: 'max depth of a welded seam vertex below its own family wall after step' },
  cloth_penetration_mm: { max: 0.001, definition: 'max depth of any garment vertex below its family wall after step' },
  cloth_stretch: { max: 1.04, definition: 'max posed/stance edge ratio; chambray is a plain weave (ClothMotion woven limit)' },
  seam_clearance_mm: { min: 2.6, definition: 'seam stand-off from its family wall; chambray target is 2.65 mm (2.6 is float guard)' },
  seam_coincidence_mm: { max: 0.001, definition: 'max distance between the welded members of a seam group' },
};
const misses = s => Object.entries(criteria).filter(([k, c]) => c.max != null ? !(s[k] <= c.max) : !(s[k] >= c.min)).map(([k, c]) => `${s.relax}:${s.fabric}:${k}=${s[k]} ${c.max != null ? '>' : '<'} ${c.max ?? c.min}`);
const seqMisses = s => { const out = [];
  if (!(s.max_seam_penetration_mm <= 0.001)) out.push(`seq${s.relax}:${s.fabric}:seam_penetration=${s.max_seam_penetration_mm}`);
  if (!(s.max_seam_deficit_mm <= 0.001)) out.push(`seq${s.relax}:${s.fabric}:seam_deficit=${s.max_seam_deficit_mm}`);
  if (!(s.max_seam_coincidence_mm <= 0.001)) out.push(`seq${s.relax}:${s.fabric}:seam_coincidence=${s.max_seam_coincidence_mm}`);
  return out; };
const failures = scenarios.filter(s => s.seam_contact).flatMap(misses), baselineFailures = scenarios.filter(s => !s.seam_contact).flatMap(misses);
const sequenceFailures = sequences.flatMap(seqMisses);

process.stdout.write(JSON.stringify({
  issue: 87, workstream: 'S2 cloth motion & contact',
  seed: SEED, derived_seed: derivedSeed('cloth'),
  base_head: git('rev-parse', 'HEAD'),
  runtime: { node: process.version, three: '0.170.0 (videos/web package pin)' },
  source_sha256: Object.fromEntries(SOURCES.map(p => [p, sha256(p)])),
  fixture: 'deterministic two-panel/two-family planar seam; trunk body moves +12 mm after rest; CPU only',
  ownership: {
    s2_files: ['videos/web/lib/fx/motion/cloth_motion.js'],
    read_only: ['videos/web/lib/fx/cloth/wardrobe4/fabrics4.js'],
    not_touched: ['anatomy', 'skin/hair', 'stylized', 'motion-collision', 'integration'],
  },
  limits: ['synthetic fixture, not a person bake', 'no render or GPU admission', 'armhole edge stretch remains the garment solve (CLOTH9/CLOTHINT)'],
  criteria,
  scenarios,
  sequences,
  passed: failures.length === 0 && sequenceFailures.length === 0,
  failures,
  baseline_failures: baselineFailures,
  sequence_failures: sequenceFailures,
}, null, 2) + '\n');
