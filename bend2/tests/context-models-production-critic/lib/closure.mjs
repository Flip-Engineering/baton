// Module-closure tracker.
//
// run.mjs registers the loader hook before importing any producer module;
// the hook then records every module URL actually resolved afterwards,
// including transitive adapter imports. The retained invocation directory
// receives the real closure with per-file SHA256, so a report never relies
// on a stale static source list alone.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadedUrls } from './closure-store.mjs';

export function registerTracker() {
  register(new URL('./closure-hook.mjs', import.meta.url));
}

export function loadedModulesWithHashes() {
  return loadedUrls().map(url => {
    const entry = { url };
    if (url.startsWith('file:')) {
      try {
        entry.sha256 = createHash('sha256').update(readFileSync(fileURLToPath(url))).digest('hex');
      } catch {
        entry.sha256 = null;
      }
    }
    return entry;
  });
}

