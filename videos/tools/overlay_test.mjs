// overlay.js test: raw GL and three.js layers composited into a 2D canvas, and context loss / restore.
//   node videos/tools/overlay_test.mjs        (no song needed; exits 1 on a failed check)
import { openScene } from './_page.mjs';
const S = await openScene('lab_overlay', '', { noHits: true, log: false });
const T = await S.page.evaluate(() => window.overlayTest);
for (const l of T.lines) console.log(l);
await S.close();
console.log(T.pass ? 'overlay_test PASS' : 'overlay_test FAIL');
process.exit(T.pass ? 0 : 1);
