# The `-red` test-suffix convention

Baton's suite carries the files named `*-red.test.mjs` (impl/test/). The suffix is a naming
convention with one meaning and a defined lifecycle. This document IS the convention; the manifest
contract it rides on is [42-suite-legitimacy.md](42-suite-legitimacy.md).

## What the suffix means

`*-red.test.mjs` = **this file is expected to contain failures at the commit it is written, and
the failure is evidence, not an accident.** A red file pins a contract whose implementation has
not landed yet (a spec clause, an audit finding, a deliberately deferred slice). Red-first files
are how Baton carries unfinished design in the open: the suite stays honest about what is NOT
true, and the expected-red manifest
([impl/scripts/expected-red-tests.json](../impl/scripts/expected-red-tests.json)) carries the
reason each failure is expected.

Files WITHOUT the suffix are written green: a red-first pin belongs in a `*-red` file.
Which rows are still expected red is the manifest's decision, not the filename's
([42-suite-legitimacy.md](42-suite-legitimacy.md)): the manifest also carries rows in
plain-named files whose red needs no red-first lifecycle (transient bridges such as #460).
A failure without a manifest row is an unexpected failure, whatever the filename.

## The rules

1. **The suffix is written once, when the file is born red.** It says "at least one row in this
   file is expected red, and each such row has a manifest entry".
2. **Every expected-red row carries a reason** (`suite-verdict.mjs` refuses the manifest without
   one). The reason vocabulary is closed:
   - `#<issue>` — the GitHub issue that tracks the gap;
   - an audit item id (`S-G5`, `U-E19`, `A-G10`, `G-24`) — the 2026-09-14 deep-codebase-audit
     item that tracks it;
   - `credential` / `environment` — the row's outcome is decided by a machine-local prerequisite;
     the suite judges these against the prerequisites the run actually observed (a credentialed
     host must pass them);
   - `design` — a design contract pinned before its implementation, with the pinned spec named in
     the row's contract read. `design` is a resting class only when no issue or audit item exists;
     it is earned by the read, never a placeholder for "somebody should look at this".
   - `unattributed` — a TODO; never a resting place.
3. **The suffix is sticky by history, not by content.** A `-red` file whose rows eventually all go
   green keeps its name until the manifest entries are retired; the manifest, not the filename,
   decides what is expected. A file that is fully green with zero manifest entries has outlived
   its suffix — renaming it (dropping `-red`) is the retirement ceremony, done in the same change
   that retires the rows.
4. **Renaming is not the fix.** The 2026-09-14 audit (legibility lane, #284) considered renaming
   the then-160 suffixed files and wrote the convention down instead: the name is load-bearing
   history (it names the wave that wrote the pin), and renaming every suffixed file would destroy
   the audit trail while changing nothing about the work.
5. **New red files need a manifest plan in the same change** as the file: either the rows are
   listed with reasons (a full-suite `--write-expected-red --expected-red-reason <reason>` run,
   which refuses rows it has never listed without one), or the pin ships in a plain-named file.

## The lifecycle

```
spec/audit finds unfinished work
        │
        ▼
red-first file written:  <subject>-red.test.mjs        (suffix born)
rows manifest-listed with specific reasons
        │
        ▼
implementation lands → rows turn green
        │
        ▼
manifest rows retired (the runner refuses stale rows)
        │
        ▼
file fully green → rename, drop the suffix             (suffix retired)
```

The runner (`impl/scripts/run-suite.mjs`) enforces both ends: a manifest row whose test passes is
a `stale` row and fails the verdict, so a row may only be removed when the work actually landed;
and a red failure without a manifest row is an unexpected failure.

## Why a suffix at all

Because Baton's suite is the memory of a swarm: hundreds of files pin thousands of decisions, and
a reader must be able to tell "this asserts landed truth" from "this asserts the truth we have not
built yet" without reading a manifest. The suffix is that signal, the manifest is the proof, and
[42-suite-legitimacy.md](42-suite-legitimacy.md) is the contract that binds them.
