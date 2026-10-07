# Phase 43 provider receipt and pending-fence foundation — 2026-07-12

## Outcome

Commits `764ef07` and `af536e0` ship the first AF1–AF3/AF6/AF9 foundation without claiming the
rest of Phase 43. A deployment-owned `AdvisoryFeedRegistry` pins closed secret-free source cards,
checks bounded authenticated-hint receipts against preserved wire bytes, and is deliberately
separate from ACI and user web/MCP authority. `createDriver` wires it to one deployment repository;
the Coordinator alone converts a fixed provider route into the machine actor and durable store
append.

`provider.delivery_received` atomically creates one sanitized receipt, one observed local `Source`
node, one semantic processing root, and every repo-scoped coordinate pending fence. Exact delivery
retry is zero-append; same ID with other authenticated bytes conflicts; another delivery ID with
the same semantic content aliases the existing processing root. Replay requires the identical
source card epoch. The public snapshot exposes counts rather than raw receipt rows, and neither raw
bytes, source handles, signatures, paths, nor credential values enter its projection.

Both borrow and build fail with `reuse_provider_pending` inside store validation. The Coordinator
also performs a cheap pre-network check, but store serialization is the authority that closes the
decision/delivery race. Existing exact decision retries become historical while a matching pending
fence exists.

## Validation

- 11 focused Phase 43 tests cover card closure/deep immutability, envelope ceilings, adapter
  forgery and wire-byte mutation, atomic receipt/pending/Source creation, repo separation,
  duplicate/conflict/semantic alias behavior, restart/card replay, borrow/build fencing,
  Coordinator machine-ingress separation, and append-failure non-observability.
- The canonical zero-quota suite passes 919/919 after the new tests. The legacy snapshot shape is
  preserved when no advisory source is configured.
- Evidence is under
  `docs/reference/evidence/phase43-provider-foundation-dogfood-2026-07-12/`.

## Recursive Baton evidence and friction

An initial recursive run correctly refused the dirty primary checkout as `worktree_unavailable`
and reaped all allocations without spawning providers. The rerun used a detached clean checkout at
`af536e0` while leaving the user's `.gitignore` edit untouched. One Baton driver concurrently
requested exact low-effort Claude `claude-opus-4-6`, Codex `gpt-5.6-sol`, and GLM `glm-4.7`:

- all three routes were requested, resolved, and provider-observed on distinct PIDs;
- GLM used the ignored project-local key only through `GlmSessionCli`, wrote a scoped report, and
  passed fresh verification;
- Claude remained provider-failed and Codex reported 78,418 tokens against the 50,000-token brief
  ceiling, so Baton cancelled it;
- GLM again reported usage only at terminal—55,808 tokens and $0.661629 beyond the nominal
  50,000-token/$0.50 ceiling—so the already-recorded terminal-lump governance debt remains;
- every PID, worktree, runtime, branch, and writer lease/claim was killed or reaped.

The combined review gate therefore remains honestly red. The accepted GLM report correctly calls
out the still-unimplemented seedless provider guard and explicit receipt-to-official-Finding causal
edge. Its broad claim that the implementation already fulfills all Phase 43 invariants is rejected:
only the receipt/pending foundation exists.

## Explicitly unshipped

This checkpoint does not yet implement registry-owned native HMAC/Ed25519 HTTP domains, strict HTTP
header/JSON parsing, private CAS replay, sequence/cursor health, official Quartermaster refresh,
green pending resolution, seedless multi-source adverse contributions/aggregate guards, adverse
fan-out and causal edges, provider web routes or authenticated bounded reads, poll scheduling and
drain, or the full AF10/AF11 max+1/crash/live matrix. It adds no positive clearance and no homelab
or project-manager runtime integration.
