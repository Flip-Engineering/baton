# PROBE-464 — the budgeted roster as observed

Probe seat `probe-464`, swarm `swarm-primary-20260918`, issue #464 live check. Read-only seat:
no source or test file was touched; the only file written is this one. Every read below is one
invocation of the seat's swarm client, `node "$BATON_SWARM_CLIENT" …`; the client prints the
answer pretty-printed (`JSON.stringify(result, null, 2)`), so each size is given twice — the
bytes on stdout (what the client printed) and the compact `{"ok":true,"result":…}` envelope the
client and bridge measure the frame bound against (`successFrameBytes` in
`impl/src/swarm-native-bridge.mjs`).

Observed 2026-09-18 13:29–13:46 UTC at worktree HEAD
`11acf3397eff5d1fe4144e4223a7463eb8bb8819`, branch `baton/ws-83ae312cd58ca186f82082ec0518dbd5`.
Declared frame (`BATON_SWARM_BRIDGE_FRAME_BYTES`): 1048576.

## 1. `swarm.view '{"projection":"participants"}'`

- rc 0, stderr empty.
- Participant rows returned: **41**.
- `page` field: **ABSENT — the answer is not paged and carries no page record.** Evidence: the
  raw answer contains **zero** occurrences of the substring `"page"`, and none of `"next"`,
  `"served"` or `"total"`; the only `cursor` in the document is the top-level view watermark
  `"cursor": 178087`, not a page cursor. The roster is served whole.
- Answer byte length: **907,352 B** on stdout including the trailing newline; **907,025 B** for
  the JSON document; **700,612 B** compact envelope — under the 1,048,576 B frame, which is why
  no page was engaged (paging answers only a `participants`/`contributions` read whose answer is
  over the declared frame; a fitting answer is served whole).
- Row of seat `omp-429`:
  - `role` (first 80 chars): `Your full brief is a FILE in your own worktree root: .baton-brief/BRIEF.md (read`
  - `role` length 160 chars; `roleBytes`: **574**; `roleRef`: `{"kind":"swarm.participant_joined","seq":144283}`
  - `brief` verbatim: `{"bytes":5104,"seq":144283,"exposure":"swarm"}` — an **object, never text**
    (`typeof row.brief === "object"`); `briefBytes`: 5104; `briefRef`: `{"kind":"swarm.participant_joined","seq":144283}`
  - `briefWithheld`: **absent** — the key does not exist on the row
  - `workspace.commitsTotal`: **1241**
  - `workspace.commits` exists on the row: **yes** — an array of 64 entries (the bounded tail),
    newest-first, each `{at, paths, seq, sha, workspaceId}`; newest entry
    `{"sha":"60b3590a9d8f74f8e523dd0017cc8908891d7054","workspaceId":"ws-53bd704afdd64c00a9ba7f576db0e9ea","paths":[],"at":"2026-09-18T07:09:00Z","seq":149972}`,
    the tail's oldest `{"sha":"c1319197d0b46678f94e154e830b4d8a2ec780ee","seq":149879}`.
  - the row measures 20,171 B compact.
- Roster aggregates: the `participants` array is 697,212 B compact of the 700,591 B compact
  document; commit-tail lengths across the 41 rows: 64×18, 54×1, 37×1, 15×1, 12×2, 9×1, 6×1,
  3×1, 1×7, 0×8; `commitsTotal` reaches 1241 (`omp-429`) and 833 (`omp-316`).

## 2. `swarm.view '{"participantId":"probe-464"}'` (scoped read of myself)

- rc 0. Answer: **164,555 B** stdout / **164,007 B** document / **158,034 B** compact envelope.
- `projection`: `"full"` (the scoped read is the full projection scoped to one seat);
  `participants`: 1 row — **my own only**, no other rows in the answer.
- `brief` on my own row **is a string**: **114,192 bytes** (UTF-8) — the composed recruit brief.
- `briefReach` beside it: `{"bytes":114192,"seq":178055,"exposure":"self"}`; `briefBytes`: 114192;
  `briefRef`: `{"kind":"swarm.participant_joined","seq":178055}`; `briefWithheld`: absent.
- (my row otherwise: `mode` `change`, status active, base
  `{"observedHead":"11acf3397eff5d1fe4144e4223a7463eb8bb8819","target":"master","behind":0}`,
  `workspace.source` `live`.)

## 3. `swarm.view` (no arguments)

- rc 0. Answer: **923,885 B** stdout / **923,562 B** document / **717,018 B** compact envelope.
- `projection`: `"participants"`; `narrowed` verbatim:
  `{"from":"full","to":"participants","reason":"bridge-frame"}`.
- 41 participant rows; `page` absent (same raw search as §1).

## 4. Additional observations (same session, read-only)

- The named `participants` answer and the narrowed default answer differ in exactly three rows —
  `omp-429`, `omp-316`, `probe-464` — and only in `base`: the named roster serves the durable
  row's base (`omp-429`/`omp-316`: `{"observedHead":"e7386444737dfa228a5f4b8e99587bdc796f40bf","target":null,"behind":null}`;
  me: `{"observedHead":"11acf339…","target":null,"behind":null}`), the default answer a live base
  with `target`/`behind` (`omp-429`: `{"observedHead":"2cc10002587209e87bc5f764d67b2512aafae32f","target":"master","behind":110}`;
  `omp-316`: `{"observedHead":"d1ce197555e4c580c15427b95e27182789c93358","target":"master","behind":110}`;
  me: `{"observedHead":"11acf339…","target":"master","behind":0}`). The whole size delta is
  +16,335 B of `participants` and +59 B of `narrowed` (compact). [INFERENCE: the named projection
  serves the cached workspace row, the default (full-derived) answer the live read.]
- The record sits at the frame boundary: an explicit `swarm.view '{"projection":"full"}'` answered
  **1,315,647 B** and **1,318,256 B** stdout on two runs, compact envelope **1,043,572 B** ≤
  1,048,576, served whole with no `page` and no `narrowed`. [INFERENCE: with <5 KB of headroom
  the same explicit read flips to the typed over-frame refusal as rows arrive.]
- Commit tails are the roster's dominant per-row cost — 18 of 41 rows carry the full 64-entry
  tail — while every `brief` on the roster is the 29-byte reach object and every `role` is the
  ≤160-char head.
