# 23 — Phase-8 critical re-evaluation (live-verified), 2026-07-10

## Why this document exists

Phases 7–8 and the completeness audit (docs/22) were produced while the orchestrating session
was routed to a weaker model, and the user directed a skeptical, exhaustive re-evaluation of
every recent decision. Method: **re-derive, never re-read** — every protocol claim was checked
against independent ground truth (the `codex app-server generate-json-schema` bundle, the Agent
SDK 0.3.205 source, a strings dump of the claude 2.1.206 binary, and live wire probes of both
real CLIs), and every "green" claim was re-run. Raw evidence lives in the session scratchpad
(`codex-probe-raw.jsonl`, three claude smoke ledgers) and the errata sections it produced are
committed in `spec/phase8/*` and `docs/reference/*`.

## Verdicts on the phase-7/8 decisions

| Decision / claim | Verdict | Evidence |
|---|---|---|
| 336/336 green (commit 8ccad50) | **GENUINE** | re-run: 336/336, 7.2s, clean exit |
| Codex app-server protocol model (methods, params, status enums, decision vocab, token shapes) | **FAITHFUL — near-exact** | every checked shape matches the real 0.144.0 schema bundle; live turn/steer/interrupt/thread-survival all reproduced |
| Claude session interrupt design (`control_request {subtype:'interrupt'}`, session survives, trailing result discarded) | **CORRECT, proven live** | confirmed <100ms mid-tool-call; CS11 discard demonstrably prevented a wrong terminal |
| C1 accept-as-sole-gate, C3 fence-before-delivery, C4 real stop timer, C5 vendor attribution, C6 .baton exclusion, C7 KIND map | **SOUND** | code review + tests; `referee.accept` gate ≥ old inline gate |
| Router EPSILON well-evidenced fix | **ACCEPTABLE** | reasoning in-code is sound; cleaner alternative (undecayed count for the gate) noted, not required |
| docs/22 audit self-corrections | **HONEST** | its six downgrades were real; two of its "fixed in phase 8" items re-verified here |
| CS7 "no way to splice content into an in-flight completion" | **FALSE** | live: mid-turn user frame absorbed by the RUNNING turn at the next tool boundary |
| CS8 steer = interrupt→reprompt emulation | **WRONG CHOICE** (built on CS7's false premise) | native steer exists; emulation also polluted the log with phantom interrupt events |
| CS1 argv (no permission mode) | **LIVE-BREAKING GAP** | live: Write auto-denied; worker could not do any work with `approvals:false` |
| CS12 allow = `{behavior:'allow', updatedInput?}` | **LIVE-BREAKING BUG** | live: CLI silently re-asks a bare allow forever (turn wedge); SDK reference client always sends `updatedInput` + `toolUseID` |
| Fake `-32010` stale-steer code; "id-less -32600 verified live" | **FICTION / STALE** | live 0.144.0: both errors are id-matched `-32600`; raw frames preserved |
| Silently ignoring unmapped server→client requests (codex) | **WEDGE CLASS** | real schema serves `item/permissions/requestApproval`, `item/tool/call`; a dangling JSON-RPC request wedges its turn |
| Single `session.wait` slot (codex approvals) | **WEDGE CLASS** | concurrent server requests would clobber; now a keyed map |
| Coordinator `log.append` catch-all swallow | **SYMPTOM PATCH** | masked a test race by making real log loss silent; now counted + warned (log-is-truth stays observable) |
| `route()` last-wins modelVersion collision | **LATENT BUG** | one-shot + session adapter share `harness@version`; first-listed now wins deterministically |
| `impl/src/coordinator.mjs.tmp` committed | **HYGIENE** (phase-5 era, pre-dates Opus) | removed |

## The meta-finding

Every live-breaking defect sat exactly where the fake binary mirrored the adapter's own
assumptions instead of the vendor's behavior — **circular validation**. The one place the
prior session live-probed deeply (codex app-server) came out near-perfect; the places it
reasoned from documentation alone (claude permission modes, mid-turn semantics, PermissionResult
completeness) are where it broke. Fake-binary green is a necessary gate, not a sufficient one.

**Standing rule adopted:** an adapter is not "done" until a live smoke of each verb it declares
`native` has run against the real binary, and the fake is corrected to whatever the live run
shows. The errata sections in `spec/phase8/*` are the template.

## What was fixed in this pass (all test-locked, all live-re-proven where live-provable)

- **E1** an explicit permission mode was made load-bearing; this pass used `acceptEdits` and live-created `probe.txt`. The Phase 74 unattended/full-access default is `bypassPermissions` with the private Claude command sandbox disabled; approval-enabled sessions resolve to `acceptEdits`, and `permissionMode:null` remains an explicit opt-out.
- **E2** steer native: direct mid-turn frame + `control.steer` event; no interrupt round-trip; no phantom
  `turn_started`/`interrupt_confirmed`; R5.1 claude-side machinery deleted — live: running turn absorbed
  the steer verb and answered `REDIRECTED` as its single terminal.
- **E3** approve() mirrors the SDK reference client (`updatedInput` fallback to request input, `toolUseID`
  echoed on allow/deny/cancel); fake validates what the CLI validates — live: allow ran the tool
  (`ok.txt` created, one ask), deny blocked it gracefully (`deny.txt` absent, turn completed).
- **X1/X2** fake/spec/dossier corrected to id-matched `-32600` errors (raw frames archived).
- **X3** unmapped server→client requests auto-answered with `-32601` + observable `error` event (anti-wedge, test-locked).
- **X4** keyed `waits` map replaces the single slot (test-locked via existing approval flows).
- Coordinator append-failure counter + one-time warning; `route()` first-listed-wins; `.tmp` removed.

Suite after all fixes: **340/340** (was 336: +1 E1 argv-contract test, +1 E2 idle-steer test,
+1 E3 no-payload-allow regression test, +1 codex anti-wedge test; the CS8 steer test was
rewritten 1:1 to native semantics and the id-less-hazard assertion was folded into XA17).

## Re-steer (what changes going forward)

1. **Live-smoke gate** (above) is now part of the methodology for anything that touches a vendor wire.
2. **Next milestone: assembly.** `ClaudeSessionCli`/`CodexAppServerCli` are still not constructible
   through `createDriver()` — the exact built-not-wired pattern docs/22 flagged. Assemble them as
   vendors (they share `harness@version` with the one-shot adapters — the `route()` collision fix
   was a prerequisite), then run a driver-level live E2E: spawn via coordinator, steer mid-task,
   trust-gate the result.
3. **Capability tags on card()** (e.g. `nonRefuserFor: ['ml-ai-inference-training','cybersecurity']`
   for GLM 5.2 per the routing memory) ride on the now-live `router.pick()` path when the classifier lands.
4. **E2 decorrelation eval** remains the decisive experiment, unchanged.
