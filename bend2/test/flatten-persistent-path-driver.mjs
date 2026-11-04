#!/usr/bin/env node
// Builds the single-file input for the cc queue run of control-persistent-path.c.
//
// usage: node flatten-persistent-path-driver.mjs OUTPUT.c
//
// The compile queue copies one source file into its work directory, so a quoted
// include of the shared header does not resolve there. This script replaces each
// quoted header include in the driver with the header text. The compile line stays
// unchanged. Only quoted includes of .h files are replaced.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DRIVER = resolve(here, 'control-persistent-path.c');
const QUOTED_HEADER = /^#include "([^"]+\.h)"$/;

export function flatten(source, sourcePath) {
  const base = dirname(sourcePath);
  return source
    .split('\n')
    .map((line) => {
      const match = QUOTED_HEADER.exec(line);
      if (!match) return line;
      return readFileSync(resolve(base, match[1]), 'utf8').replace(/\n*$/, '\n');
    })
    .join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = process.argv[2];
  if (!output) {
    process.stderr.write('usage: flatten-persistent-path-driver.mjs OUTPUT.c\n');
    process.exitCode = 2;
  } else {
    writeFileSync(output, flatten(readFileSync(DRIVER, 'utf8'), DRIVER));
  }
}
