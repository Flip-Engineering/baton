# Issue #74 — worker-orchestrated swarm red-first suite: fold-2 map (blue-team findings → resolutions)

*Fold-2 of the red-first acceptance suite for the folded #74 contract. Source review:
`suite-blueteam.md` (the adversarial acceptance review of the 15-row suite at HEAD `20f68fa`).
This fold edits `impl/test/worker-orchestrated-swarm-red.test.mjs`, bumps
`contract-fold.md` to v1.2 (three contract-side consequences), and records the new split in
`suite-draft-notes.md`. Compiled 2026-08-13 against the current worktree HEAD `e3f52ba`. Every
`file:line` citation was re-derived this session with `grep -an` / `sed -n` on the NUL-bearing
files (`application.mjs`, `coordination-store.mjs`) and plain `grep`/`sed` on the rest.*

- **Suite:** `impl/test/worker-orchestrated-swarm-red.test.mjs` (16 rows: 8 PIN green / 8 RED at
  named stages)
- **Contract:** `contract-fold.md` **v1.2** (this fold) — the D1.3 denied shape + no-re-attempt
  policy + the §D4 file-not-directory mechanism correction
- **Verified split (this fold):** `node --test impl/test/worker-orchestrated-swarm-red.test.mjs`
  from the repo root — **16 rows · 8 pass · 8 fail**, each red row failing at its named stage.
  Recorded after TWO consecutive runs, identical across both (see `suite-draft-notes.md`).

---

## Fold-map (blue-team finding → resolution)

| # | Blue-team finding | Verdict | Resolution — where |
|---|---|---|---|
| 1.1 | A1/A2 fixtures install the permissive `authorize`, so the D1.2 sibling-refusal legs can never go green after a correct deployment-seam impl. | blocker → folded | **The fixture installs the D1.2 restricting authorize** (`restrictingReadAuthorize`) so the law's mechanics are provable hermetically (sibling `worker:<role>` read → `application_unauthorized`); the **RED moves to the deployment-seam closure** — `deploymentSeamRestrictorInstalled()` asserts the permissive `authorize: async () => true,` literal is gone from `application-deployment.mjs` (absent → the restrictor replaced it). A1/A2 now fail at `coordinator-read-law-missing` / `read-law-missing` (the seam), not at an unreachable behavioral leg. |
| 1.2a | A3 asserts `denied.optionId`, but §D1.3's denied shape has no `optionId`/`text`; a faithful impl that drops the attempted option fails A3. | needs-fold → folded | **Contract v1.2**: §D1.3 denied record is `{trigger, role, requestId, outcome:'denied', refusal:<code>, optionId?/text?}`; refusal-vocabulary denied-row updated. Suite keeps `denied.optionId === 'opt-a'` and adds `typeof denied.requestId === 'string'`. |
| 1.2b / 2.1 | The permanence half is unpinned — an impl records `{denied}` while still marking the key handled; both A3/A3b pass. | blocker → folded | **Structural permanence pin** (`permanencePin`): the earliest `s.answeredKeys.add` must NOT precede the earliest `handle.answer(` in `workflow-interpreter.mjs`. At HEAD the pre-answer add `:698` precedes `:795` → RED. A correct impl moves/drops the add → GREEN; a shallow impl keeping the pre-answer add stays RED. |
| 1.2c | The re-attempt policy is undefined — removing the pre-answer add makes the loop re-attempt a denied ask every poll (~200× at hardCap), `.find()` masks the spam. | needs-fold → folded | **Contract v1.2**: §D1.3 states the no-re-attempt policy (a denied decision is recorded once, never re-auto-answered; the ask stays pending for the human). Suite pins the trail shape in A3/A3b: exactly one `answerDecisions` record per requestId, no later `answered`. |
| 2.2 | A2's wave-scoped grant path is unasserted — a refuse-everything restrictor passes A2. | blocker → folded | **A2 gains the grant leg**: `restrictingReadAuthorize({ grants: ['s74-row-1:worker:coordinator'] })` and a granted `s74-row-1` read of `worker:coordinator` must succeed. Over-refusal (never implementing the grant) fails. |
| 1.5 | A8's message DELIVERY is unpinned — an impl widening only the interpreter's kind set silently drops `brief`/`result` at the coordinator boundary (`coordinator.mjs:6864`). | needs-fold → folded | **A8 asserts delivery**: a `messageOnSpawn` steering entry with a delivered `messageId` (`delivered > 0`), the `signalOnMembersDone` recipients, and the adapter's received `[MESSAGE result …]` frame (`CarryAdapter.prompt` now records frames). Forces `brief`/`result` end-to-end. |
| 3.2 | P-A5-static/P-A10 tight absolute line windows are re-base churn; the load-bearing alarms are ORDER/EXISTENCE/byte-string. | needs-fold → folded | **Windows dropped.** P-A5-static keeps `notInDefinitions < start < run < gate`. P-A10 keeps the byte-strings (`'application_unauthorized'`, `refuse('message_depth_exceeded'`, `'body,inReplyTo'`) plus a drift-immune relative bound (the authz throw sits in `_authorize`'s tail, after the def). |
| 4.1 | P-D1.4's counter scan runs on the matched loop line only; a counter inside the loop body escapes. | needs-fold → folded | **P-D1.4 scans the whole `driveLane` body** (its def `:661` to the next top-level function `:741`, anchored by name) with the counter regex, plus the loop-shape assertions on the `while` line. |
| 4.3 | Mechanism error: `git show <sha>:<dir>` does NOT fail — a directory path without `mustContain` harvests `ok:true`; the file-not-directory law is not structurally enforced. | needs-fold → folded | **Contract v1.2** §D4 mechanism corrected + the law stated structurally (a regular-file admission/refusal-time check refuses `harvest_miss` for directories REGARDLESS of `mustContain`). P-A8-dir comment corrected. **NEW A8b RED row**: directory-without-`mustContain` must be `WAVE-INCOMPLETE`; at HEAD it is `WAVE-OK` → RED at `directory-harvest-not-refused`. |
| 1.3 (minor) | A5's owner GREEN leg could be shallow-greened by a hardcoded allowlist of the four fixture principals. | note → folded | **A5 adds a second top-orchestrator principal (`s74-observer`)** asserting it too can start a wave — seat-CLASS, not identity. |
| A4/P-A4, A5 green-side, A6, P-A7, P-A9, P-A3g | SOUND (no fold). | SOUND | carried byte-stable. |

---

## Contract movement (v1.1 → v1.2)

`contract-fold.md` bumps to **v1.2** — three blue-team consequences required contract movement:

1. **§D1.3 denied record carries `optionId?`/`text?`** (blueteam §1.2a) — the audit needs to know
   which option/text was attempted. Refusal-vocabulary denied-row updated to match.
2. **§D1.3 no-re-attempt policy** (blueteam §1.2c) — a denied decision is recorded once and never
   re-auto-answered; the interpreter skips `answerDecisions` for a requestId it has already denied.
3. **§D4 file-not-directory mechanism correction** (blueteam §4.3a) — `git show` on a tree returns
   the listing (does NOT fail); a directory only refuses via a `mustContain` mismatch today, so the
   law is enforced structurally (regular-file check, `harvest_miss` regardless of `mustContain`).

Also folded as citation drift at this HEAD: the D1.2 enforcement seam now cites
`application.mjs:13051/:13052` and the `_authorize` throw `:3222` (was `:13037/:13038/:3215`), and
the permissive literal `application-deployment.mjs:2012` (was `:1998`). The A3 acceptance-pin row
now carries the denied shape + no-re-attempt + permanence language.

The enforcement-seam sentence is amended: v1.2 **removes the permissive literal from the
construction site** (the restricting authorize becomes the default), so the earlier "under the
default there is no scope restriction at all" sentence is replaced by the seam-closure requirement
the suite's `deploymentSeamRestrictorInstalled` pin asserts.

---

## Red-first split at HEAD `e3f52ba` (verified)

- **GREEN 8** — P-A4, P-A5-static, P-A7, P-A8-dir, P-A9, P-A10, P-D1.4, P-A3g (the substrate pins;
  MUST stay green).
- **RED 8** — A1 `coordinator-read-law-missing`, A2 `read-law-missing`, A3/A3b
  `steering-trail-falsified`, A5 `coordinator-authority-forbidden-missing`, A6 `seat-route-hidden`,
  A8 `composition-example-refused`, **A8b `directory-harvest-not-refused`** (new).

Every red row is red at a NAMED stage and goes green on the contract's implementation ONLY: the
six seam closures (D1.2 at the deployment seam, D1.3 in the interpreter, D2 at the waves.*
boundary, D3 in the registry view, D4 in the message-kind closure + the file-not-directory
structural check).
