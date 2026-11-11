# Phase 43 production HTTPS poll transport and live proof — 2026-07-12

## Shipped checkpoint

PF8 now ships `HttpsHmacAdvisoryFeedSource`, a production socket transport composed with the existing
exact-wire HMAC webhook verifier. Deployment pins one HTTPS origin/operation, private bearer, HMAC
key, optional CA/servername trust, initial cursor, and all card ceilings. The default path uses
`https.request` and never follows redirects.

Each canonical response page is authenticated over the operation, poll/page identity, observation
time, final sequence, request/current/next cursor digests, and exact page bytes. Page/item totals,
sequence continuity, pagination, headers, and wall time are bounded. Raw cursors, bearer, CA,
signatures, and endpoint inventory remain inside the source. Registry-created per-call object
authority prevents poll item bytes from being replayed through ordinary machine ingress.

Poll items preserve exactly the same canonical hint bytes as webhook delivery. They enter the
existing private CAS and receipt/dedupe path only after the complete source poll validates. Secret-
derived item and poll authentication receipts reverify synchronously without network after restart.
Redirects, page HMAC substitution, malformed pages/items, oversize, cancellation, or incomplete
windows expose no poll proof or receipt prefix.

## Verification

- Phase 42 plus all Phase 43 tests pass **70/70**.
- The canonical suite passes **965/965**.
- `docs/reference/evidence/phase43-https-poll-live-2026-07-12/summary.json` has every check true for
  a real localhost TLS socket using a generated private CA, fixed authorization, and two paged
  requests. It creates a gap, recovers exactly once, retains pending official work, restarts and
  replays with zero new requests, degrades on a later gap, exposes sanitized status, releases the
  writer lease, and leaves zero worktree/runtime entries or Baton branches.
- An abort during page two now returns typed `cancelled`, exposes no prefix, and a complete retry
  succeeds from the initial cursor.

## Recursive Baton/GLM review

The first review allocation failed before native launch because 43,749 Baton-named temp roots from
direct bare `node --test` runs had exhausted the host disk. Baton returned `already_dead`; the
disposable clone was removed, then the confirmed stale roots (about 1.2 GB, with no live owner
process) were reaped. This reinforces the rule to run suites through `npm test` / `run-suite.mjs`,
whose owned TMPDIR and process group are cleaned on every terminal path.

The rerun in `docs/reference/evidence/phase43-https-poll-review-2026-07-12/summary.json` requested and
observed exact `glm` / `glm-4.7` / `low` on native PID `83152`. It consumed 45,467 tokens and
$0.406402, fresh-verified its scoped report, received a confirmed kill, and left no process,
worktree, runtime, branch, or writer authority.

The report's P1 streaming claim was rejected: the data handler returns immediately once `failed` is
set, so its byte counter does not continue growing, and Node's `https.request` signal contract
destroys an aborted request. Its useful page-boundary coverage suggestion became the explicit
abort-on-page-two/retry regression above. The suggested shared-token concurrency is outside the
public registry contract: every registry poll creates a distinct unexported object identity.

## Honest remaining Phase 43 scope

The PF1–PF8 full-poll/recovery/read contract is complete. Durable deferred official-processing
attempts still remain for the broader adverse-provider ingestion contract, along with any additional
provider/ecosystem adapters and a currently authentication-red Grok rerun. No homelab or
project-manager runtime integration is involved or desired.
