# SHARED PUBLISH — row-lc-fs / contract-filesystem.md

[attempt: 9a07d8eb-e52d-475f-ac64-65ffbb707813 row-lc-fs]

Deliverable: `docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive3/contract-filesystem.md`
(CONTRACT-FILESYSTEM v1) — published complete; no refusal to record.

Issue coverage: #168 (base commits on master, four captures verified: 055c6cc/cd555ca/a176f39/04bd28f)
· #172 (shared-index lock abandonment + untyped stale-lock failure) · #185 (member raw-fs escapes,
blueteam-161.md + suite-notes-163.md, both captured only by base commits).

Decisions: D1 off-branch sideband base (deployment-snapshot discipline; operator branch never
moves, dirty state stays dirty) · D2 sideband ref `refs/baton/base/<taskId>` · D3 own-index
discipline + coached stale-lock refusal, no auto-reap in the operator's repo · D4 admission→settle
status sweep, `member_fs_escape` + verdict downgrade, no auto-revert · D5 harvest materialization
is the sole sanctioned interpreter write to the operator tree · D6 DECISION_REQUEST (escalated):
escape-detail home = store event vs eighth receipt key — recommendation (b) store event only;
launch row (#202) owns receipt shape.

Fold-record-ready pin list (each RED at HEAD, stage named):
- FS-P1 base (`workflow-interpreter.mjs:537–542`): dirty+untracked files survive; branch HEAD
  unchanged; no `baton workflow base` commit; base step SUCCEEDS with a snapshot sha carrying the
  dirty content (anti-refuse-dirty clause).
- FS-P2 base: broken snapshot → typed `workflow_base_unavailable` (not the silent catch at :541).
- FS-P3 snapshot/base: planted holderless fixed-mtime `index.lock` → typed
  `worker_index_lock_stale` `{holder, lockMtime, next, path}`; control: no lock → success, no
  residue.
- FS-P4 settle: injected main-checkout write during the wave → `member_fs_escape` record +
  verdict ≠ WAVE-OK.
- FS-P5 settle (anti-shallow control for FS-P4): clean wave → WAVE-OK, empty escape set.
- FS-P6 snapshot: `refs/baton/base/<taskId>` == `meta.baseSha`; forged JSON base → typed
  `worker_base_ref_invalid`.

New refusal codes (closed set): `workflow_base_unavailable` · `worker_index_lock_stale` ·
`member_fs_escape` · `worker_base_ref_invalid`. Frozen existing surfaces: `DirtyRepoError`,
`worker_path_scope_violation` (+`pathScopeEvidence`), `harvest_ok`/`harvest_miss`, the seven
receipt keys.

Cross-row notes for the QA pass: open question 2 is the live DECISION_REQUEST (touches
row-lc-launch's receipt authority); open question 5 proposes an owned-vs-borrowed-ground lock
split that may need to agree with the capacity row's lock-tombstone vocabulary.
