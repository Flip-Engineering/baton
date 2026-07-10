# reviews — external and adversarial reviews of the baton design

| Review | What it is |
|---|---|
| [codex-external-review.md](codex-external-review.md) | **Cross-vendor external red-team**: OpenAI Codex/GPT-5.x run read-only over docs 00–07 as an adversarial reviewer — the harness being orchestrated critiques the design to orchestrate it. Caught the `fleet_wait`-isn't-an-event-loop, no-concurrency-model, nested-approval-loop, and several Codex-surface factual errors. |
| [steering-interruption-redteam.md](steering-interruption-redteam.md) | **Focused red-team** of steered + interruptible subordination (6 attack classes, each scenario verified against real API semantics). The one-sentence answer: subordination is a property the non-LLM supervisor enforces, and only for baton-mediated effects. |

Dispositions from both feed [../docs/09-revision-log.md](../docs/09-revision-log.md), which traces every confirmed finding to the doc change it forced. The judge-council critiques (7 lenses + triage) are summarized there too.
