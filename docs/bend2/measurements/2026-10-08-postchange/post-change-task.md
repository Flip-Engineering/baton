Review docs/bend2/logging.md against bend2/src/coordinator/logs.bend in this
checkout and report every discrepancy with a file:line citation.

Method:
1. Read docs/bend2/logging.md in full.
2. Read bend2/src/coordinator/logs.bend in full.
3. For each claim in the document about the level behaviour, the held-frame
   path, the checkpoint, the registry or cleanup, find the function in
   logs.bend that implements it and cite the function name and line.
4. Run `grep -n` for the document's named function names in logs.bend and
   report any name the document uses that the source does not define.
5. Write the findings to
   /Users/wahargis/Development/Experiments/baton/.scratch/session-takeover-20261006/orchestra-expansion/worktrees/logging-measure-ds-20261007/docs/bend2/measurements/2026-10-08-postchange/post-change-findings.md
   as rows of: document line, quoted claim under 120 characters, source
   file:line, and whether it matches, differs or is absent from the source.
6. Report the count of rows in each of the three categories.

Constraints: read the files in several passes so that the progress output grows
across many tool calls; do not edit logs.bend or logging.md; do not run builds
or tests.
