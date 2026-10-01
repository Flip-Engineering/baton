# Shared knowledge acceptance

## Runtime and scope

Issue #642 was exercised on 2026-10-01 at source
`46a4bc3f9716117f74fd69ce0e09fc080d8441eb`, with Bend 2.0.25 and coordinator
SHA-256 `8aa2ac152783febdf6d3193b5caa432adc84f66a2f0131ef70dbd69e22e8c83a`.
The consolidated tree retains identical runtime files. The
[machine evidence](measurements/2026-10-01-knowledge-context.json) identifies the
source tree, executable and driver hashes, native identities, message receipts,
promotion provenance, retained artifacts and private landing.

Two logical workers ran through installed OMP 17.4.0 with
`deepseek/deepseek-flash`, effort `low`. Each native state reported that provider,
model and effort. The coordinator recorded the observed model; its observed-effort
field remained empty. Root's registered endpoint collected notifications. Evidence
review and distribution decisions occurred in the current Codex session.

## Investigation and review

The producer read the real native-reply implementation and operator documentation,
then executed the focused receive test against the pinned coordinator. It exited 0:
one test in 0.435 seconds, empty stdout and 98 bytes of stderr ending in `OK`.
The tested question provider was a Python fixture; the investigating worker was
a real DeepSeek conversation through OMP.

The producer retained its command, output, status, commit and source references in
`producer-check-evidence`, then recorded `native-reply-finding` and a second local
control. Root resolved the references and reviewed the raw tool result. Neither
recording nor report acceptance promoted either finding.

Root explicitly promoted the first finding from `producer` to `root`. The committed
promotion delivered `root-review:promotion-notice` to root's registered endpoint.
Its body retained the promotion, finding, original author, source, destination and
promoting actor. Root reviewed and acknowledged it before assigning consumption.
The local control remained unpromoted.

An earlier producer-only run at `e530aaeb` remains retained as reference. Its report
misidentified a merged output stream and overstated a fixture parent's completion
rule. Root shared neither finding from that run. Its native tool also interrupted
an unnecessary interactive read after the tool's own timeout; the producer recovered
in the same conversation. The accepted run used clearer evidence instructions.

## Consumption and correction

Root assigned a sibling consumer with the finding identity and no copied claim.
The consumer retrieved the full finding, cited evidence message and promotion
provenance through `knowledge consumer`. The original author remained `producer`.
The local control was absent. The consumer used the retrieved fact and checked
source to commit [the operator example](examples/native-question-reply.md).

After root accepted that report, the same logical consumer and workspace started
a fresh native conversation. Its native identity changed, its tracked commit stayed
unchanged, and its retrieved finding matched the earlier answer after prior receipts.
The fresh review also observed that the first successful native reply includes both
`request` and `status`, while an already completed write's retry returns the status
object. The native output and source distinguish transport completion from native
consumption and report delivery.

The consumer recorded `native-reply-output-correction`, citing its retained review
report and identifying the earlier finding. Root reviewed and explicitly promoted
that correction from `consumer` to `root`; a second destination-owner notice arrived
and was acknowledged. The original finding and attribution remained unchanged.
The correction states that its retry observation manually reopened a local fixture
row. That observation establishes no retry behavior after actual native exit.

Root clarified the example's first-write output, pending retry and separately
observed native progress. Bend2 landed the reviewed consumer branch onto the private
`knowledge-acceptance` branch. Independent review additionally qualified completed
retries to require an open request. That reviewed branch landed at
`6ed9aa623b8c0c71ee6ed8f0df52692ddce6b45c`.
The root then fast-forwarded those reviewed commits into `bend2-rewrite`.

## Measurements and verification

| Native invocation | Elapsed seconds | Completed assistant responses |
| --- | ---: | ---: |
| Producer investigation | 63.125 | 17 |
| Sibling consumption | 97.037 | 30 |
| Fresh conversation review | 146.760 | 49 |
| Immutable correction | 27.055 | 7 |

All four native invocations exited 0. Fourteen retained messages had receipts;
the root, producer and consumer inboxes were empty. The captured native and wrapper
PIDs were absent, and no command associated with the run remained. Raw native output
is retained in full. Usage counters in the machine evidence sum distinct completed
assistant responses; recurring prompt/cache tokens are counted per request.

Independent review passed the owner-notification change. Its clean implementation
commit passed 16 knowledge tests, 28 receive tests and the full negative-control
gate: 328 laws, 77 implementation mutations, 406 compiler checks and zero failures.
The root's publication gate runs build-native, laws-check and check-native on the
exact final commit, preserving its evidence outside the source tree.

## Boundaries

The parent endpoint in this run collects notices. Native orchestrator conversation
resumption is covered by separate hierarchy runs. Scope selection uses trusted
declared actors and provides no caller authentication or adversarial confidentiality.
The orchestrator chooses which workers receive further messages; promotion sends
the owner notice and makes the finding visible within the destination scope.

The fresh-conversation stage covers retained context after receipts. It injects no
crash, host restart or observer loss. The private landing used ordinary reviewed
Git integration. This run measures neither checked landing nor network publication;
the root's subsequent publication is verified separately.
