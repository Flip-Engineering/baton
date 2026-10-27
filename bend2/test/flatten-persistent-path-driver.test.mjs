import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRIVER, flatten } from './flatten-persistent-path-driver.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const HEADER = join(here, '..', 'src', 'host', 'persistent-path.h');

test('the flattened driver carries the header text and no quoted header include', () => {
  const source = readFileSync(DRIVER, 'utf8');
  const flat = flatten(source, DRIVER);

  assert.doesNotMatch(flat, /^#include ".+\.h"$/m, 'no quoted header include remains');
  assert.ok(flat.includes(readFileSync(HEADER, 'utf8').replace(/\n*$/, '\n')), 'the header text is inlined');
  assert.ok(flat.includes('static int baton_remap_resolved('), 'the shared helper is present');
  assert.ok(flat.includes('int main(int argc,char **argv)'), 'the driver body is kept');
  assert.ok(flat.includes('#include <ftw.h>'), 'system includes are kept');
});

test('a source without a quoted header include is returned unchanged', () => {
  const source = '#include <stdio.h>\nint main(void) { return 0; }\n';
  assert.equal(flatten(source, DRIVER), source);
});
