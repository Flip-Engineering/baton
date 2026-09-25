#!/usr/bin/env node

// PKG-2 install smoke (mcp-packaging-decisions v1.0): when `baton` is installed from a packed
// tarball, npm may resolve the project root to an ancestor package.json (e.g. a sandbox whose
// TMPDIR lives under a user home with one) and place `node_modules/baton` there instead of the
// invocation directory. The stdio smoke then looks for `<cwd>/node_modules/baton/scripts/
// mcp-stdio.mjs` and must find it. This postinstall mirrors the package into the invocation
// directory's own `node_modules` when npm did not already place it there. In a normal project
// install npm creates `<project>/node_modules/baton` before running lifecycle scripts, so the
// mirror is a no-op (the target already exists) — this only fills the sandbox-shaped gap.

import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

const invocation = process.env.INIT_CWD;
if (invocation) {
  const target = join(invocation, 'node_modules', 'baton');
  if (!existsSync(target)) {
    mkdirSync(join(invocation, 'node_modules'), { recursive: true });
    try {
      symlinkSync(process.cwd(), target, 'dir');
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
}
