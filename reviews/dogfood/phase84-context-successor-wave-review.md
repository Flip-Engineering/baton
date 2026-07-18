# Phase 84 context successor-wave review — partition 3/6

## Scope

This independent review is limited to immutable partition `context-partition:212f091e6b0ed852f2ac3c09d292ba449f29be3b778a00d504018e814549d2d8`, chunk 22 of `impl/src/coordination-store.mjs` (bytes 270336–282624, content digest `95eb86fe25cca7e22ca8e0e9fb468f4fb29adff4328054613c8cc8f52d6ac3ff`). No claim below relies on code outside that partition.

## Major finding: live stop settlement is schema-downgradeable past context cleanup

`_validateRunStopAdmission` accepts schema versions 1, 2, and 3. The submitted version determines the stop universe: version 1 has no context fields, version 2 adds session and cell IDs, and only version 3 adds call IDs. The validator then passes that same caller-selected version to `_runStopTargets(...)` and compares the submitted snapshot only with those version-filtered targets. Consequently, recomputing the snapshot does not detect context entities that the selected historical schema excludes.

The completion validator preserves the downgrade. It requires only that the completion version equal the admitted version; it performs no context-state check for version 1 and no call-state check before version 3. Thus a version-1 admission/completion can produce a receipt whose state is `stopped` without naming or proving cleanup of any context session, cell, or call. A version-2 pair can do the same while omitting calls. The receipt digest does not repair this: it authenticates the incomplete, version-shaped receipt rather than binding it to the full current cleanup universe.

This is a stop/settlement truth defect, not merely a formatting compatibility concern. In the validation shown by this partition, choosing an older accepted schema is sufficient to bypass the newer cleanup obligations while retaining the terminal `stopped` result. That permits a run to settle as stopped while successor context work remains outside the receipt, so route/result/cleanup truth can diverge.

## Required correction

Historical schemas must not define the cleanup universe for a newly admitted stop. New admissions should require the current schema (version 3 in this partition), while any necessary legacy replay path should reconstruct and verify all context sessions, cells, and calls from authoritative state. Completion must be gated on that full admission snapshot and must not emit `stopped` until every targeted context entity is observed stopped. Focused coverage should exercise version-1 and version-2 downgrade attempts against a run with a live call and prove that neither can obtain a stopped receipt.

