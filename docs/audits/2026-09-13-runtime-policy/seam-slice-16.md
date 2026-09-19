# Seam slice 16 — the application's admission bucket moves out

Issue #259, slice 16 — the second application.mjs act under `seam-application-program.md`. The
admission bucket — 36 members: the authority-op guards, the route and policy admission, the
wave/message/scratchpad/board/knowledge argument normalizers — leaves `BatonApplication` behind
same-name, same-parameter-list, same-arity delegates and moves into
`impl/src/application-admission.mjs`, the slice-10/11 verbatim-bucket discipline over the bare
`application` receiver.

Revision under audit: `8ff5bf09` (slice 15 as landed) plus this slice's working tree. Write
scope: the new module, `impl/src/application.mjs`, `impl/src/application-observation.mjs`
(unchanged this slice — its exports are the closure's imports), `impl/scripts/seam-inventory.mjs`
(one new TARGET + the port rule) and its regenerated artifact, `impl/scripts/surface-gate.mjs`
(the custody pin drops application.mjs), `impl/test/application-admission.test.mjs` (new),
`impl/test/seam-inventory.test.mjs` (the SI6 row), `impl/test/issue286-custody-predicate.test.mjs`
(the swept-entry law re-anchored), `impl/test/frame-economics-red.test.mjs` (the moved byte-prose
lines keep their exemptions under the module's own rows, the slice-15 rule), and this file.

The invariant is the standing one: **no behavior change** — with one named exception in §3, where
the move brought an inline custody-shape copy inside this slice's write authority and the
custody law (#286 G-36) applies.

## 1. What moved and what the analysis established

All 36 of the bucket's members as the committed inventory classifies them at `8ff5bf09`. Shape
census: 7 async members, 0 generators, no computed `this`, no `this` writes, no `.call(this`, no
`super`. The census is pinned, not assumed:

| census | pre-move | module-side |
| --- | ---: | ---: |
| `driver?.coordination` durable reads | 15 | 15 |
| store `recordDriver(` writes | 0 | 0 |
| append calls | 0 | 0 |
| `this` tokens renamed to the receiver | 72 | — |

## 2. The closure reads its slice-15 homes

The admission bodies compose the slice-15 exports: the closure resolves to **16 local
declarations (12 functions, 4 consts) that slice 15 left in application.mjs** (`normalizeIntent`,
`routeEqual`, `contentDigest`, `semanticSourceSlice`, the route-teaching family, …) plus **20
imports from application-observation.mjs** (`applicationError`, `clone`, `validText`,
`normalizePrincipal`, `scopeEntryWithin`, …) plus 4 re-sourced original-module bindings. The
import direction is one law: admission reads the observation helpers, never the reverse — the
observation module neither imports admission nor the host, so the file graph stays a DAG
(host → admission → observation). The 16 relocated declarations emit in source order; the host
imports back exactly the 8 its staying code reads (`MAX_REVIEW_SOURCE_BYTES`, `normalizeIntent`,
`routeEqual`, …); none is consumer-exported, so no re-export row arises. The load-order hazard
check is empty.

## 3. The one verbatim delta: the custody predicate comes home

`_admitWorkspaceAttachment` carried the deployment's last inline copy of the physical-workspace-id
shape (`/^ws-[a-f0-9]{32}$/u`) — exempted at #286 G-36 as outside the writing lane's authority.
The move brings it inside, so the body now calls the shared
`isPhysicalWorkspaceId` from `shared-workspace-custody.mjs` — behavior-identical (the predicate
is the same regex plus a string type check; the call site's `?? ''` is preserved and both
spellings refuse the same inputs, G36-R6's table included). The inverse-transform audit carries
this one documented delta and proves the other 35 bodies token-identical. The custody pin drops
application.mjs entirely (no inline copy remains anywhere in the application seam), and G36-R4's
swept-entry simulation re-anchors on index.mjs, which is still pinned — the law (a swept entry
must leave the list) is unchanged.

## 4. The map

One target, one rule: `{ file: 'impl/src/application-admission.mjs', className: null, receiver:
'application' }`, and `admission:application_admission_port` (weight 3) matching
`applicationAdmission.<member>(`. The corpus reads 2 708 members: application.mjs stays 237, the
module target carries 48 (the 36 bodies + the 12 relocated function declarations; consts are not
members). Zero moved bodies reclassify module-side; no staying member changes seam. The 12
relocated helpers classify on their own evidence: 4 admission, 4 observation, 4
`surface:no_authority_touched`.

## 5. Evidence

- Red-before: `application-admission.test.mjs` was written and failed (module absent) before the
  move; AN1–AN5 are green after it (one-way import with zero `this`; the 36-delegate census with
  verbatim parameter lists and both-side arities; the append-free bucket with the durable-read
  census; the relocation/import-back/observation-import sets; the map target and the port rule).
- The inverse-transform audit: **36/36** (35 token-identical + the §3 delta proven to carry the
  shared predicate and no inline shape); 72 `this` tokens renamed; ~50k body characters compared.
- `node impl/scripts/seam-inventory.mjs` check mode: ok (2 708 members), regenerated after the
  last source edit. `node impl/scripts/surface-gate.mjs`: ok (the custody finding that fired
  mid-slice is the §3 fix, not an exemption).
- Targeted batch (17 files: the two application modules, the seam map, the custody rule, and the
  admission families' behavior suites — CLI, route teaching, grammar, feedback forging, refusal
  naming, launch validation, authorization concurrency, dispatch seam, recursive application,
  boards, REPL bindings, write failures):

```
node impl/scripts/run-suite.mjs test/application-admission.test.mjs test/application-observation.test.mjs \
  test/seam-inventory.test.mjs test/issue286-custody-predicate.test.mjs test/phase64-application-cli.test.mjs \
  test/issue335-application-route-teaching.test.mjs test/grammar-m2-red.test.mjs \
  test/feedback-forge-hardening-red.test.mjs test/issue404-scratchpad-refusal-verbatim.test.mjs \
  test/mcp-refusals-named.test.mjs test/launch-validation-red.test.mjs test/authorization-concurrency.test.mjs \
  test/dispatch-seam-omp-red.test.mjs test/phase77-recursive-application-red.test.mjs \
  test/reflex2-boards-red.test.mjs test/repl23-bindings-red.test.mjs test/issue62-write-failure-red.test.mjs \
  test/frame-economics-red.test.mjs
#   GREEN except environment — 145 passed, 20 expected red, 0 unexpected
npm test --prefix impl   # the canonical suite; verdict recorded with the contribution
```

## 6. What this slice does not claim

- The members are delegates, not gone: inlining is a later slice's move, found through
  `admission:application_admission_port`.
- Slice 17 (recovery, 15 members, `_buildView` inside) gets its own short design act next; then
  effects (10) and surface (95, the transport, last) per the program.
- The coordinator's remaining 96 unmoved effect bodies stay independent mechanical filler.
- The slice-8/9/10 async-delegate hop retrofit and delegate inlining remain follow-ups.
