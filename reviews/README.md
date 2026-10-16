# reviews — external and adversarial reviews of the baton design

| Review | What it is |
|---|---|
| [codex-external-review.md](codex-external-review.md) | **Cross-vendor external red-team**: OpenAI Codex/GPT-5.x run read-only over docs 00–07 as an adversarial reviewer — the harness being orchestrated critiques the design to orchestrate it. Caught the `fleet_wait`-isn't-an-event-loop, no-concurrency-model, nested-approval-loop, and several Codex-surface factual errors. |
| [steering-interruption-redteam.md](steering-interruption-redteam.md) | **Focused red-team** of steered + interruptible subordination (6 attack classes, each scenario verified against real API semantics). The one-sentence answer: subordination is a property the non-LLM supervisor enforces, and only for baton-mediated effects. |

| [red-blue-explore/](red-blue-explore/) | **Round-2 red-team / blue-team / open-minded-critical** pass over the expanded design (docs 10–12 + capability modules + specs): 6 targets × attack→defend→explore-replacements. All six returned **REVISE**. They converge on one reframe: baton's defensible product is the **Referee** (cross-vendor independent verification + routing + cross-review), not the **Conductor** (driving a live fleet). |

Round-1 dispositions feed [../docs/09-revision-log.md](../docs/09-revision-log.md); round-2 verdicts feed [../docs/13-revision-log-r2.md](../docs/13-revision-log-r2.md), which centers the Referee-not-Conductor reframe and traces each verdict to its change. Both trace every finding to the doc change it forced.
