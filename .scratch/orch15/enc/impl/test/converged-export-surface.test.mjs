import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WebNorthbound } from '../src/web-northbound.mjs';

test('converged entrypoint is import-inert and preserves an explicit raw-core escape hatch', async () => {
  const rawExecute = WebNorthbound.prototype.execute;
  const core = await import('../src/index.mjs');
  const converged = await import('../src/index-converged.mjs');

  assert.equal(WebNorthbound.prototype.execute, rawExecute);
  assert.equal(converged.openBaton, core.openBaton);
  assert.equal(typeof converged.openConvergedBaton, 'function');
  assert.equal(typeof converged.SurfaceCatalog, 'object');
  assert.equal(typeof converged.SurfaceResolution, 'object');
  assert.equal(typeof converged.SurfaceCli, 'object');

  const names = Object.keys(converged);
  assert.equal(new Set(names).size, names.length);
  for (const name of Object.keys(core)) assert.ok(names.includes(name), `missing core export ${name}`);
});
