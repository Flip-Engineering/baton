// Issue #508's exemplar: a file under test/ that registers no tests. The suite runner classifies
// every file it is about to schedule by that file's own source, so a `--changed` selection that
// lands here is reported as `skipped: no test-framework import` instead of an unexpected failure.
// It is deliberately unimported: the selection reaches it through the changed path itself.
export const NON_TEST_DRIVER = 'a module under test/ that never imports node:test';
