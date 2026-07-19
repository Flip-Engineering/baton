# Phase 85 cross-harness dispatch-design dogfood

This Run tested two exact xhigh routes in parallel while asking only for a bounded design note:

- Codex `gpt-5.6-sol` through `codex@codex-cli`;
- GLM `glm-5.2` through `glm@claude-code+zai-anthropic` using the project key.

GLM launched and reached worker-policy observation but produced no provider/tool event. Codex
performed 82 tool events, identified that the failed implementation shapes duplicated map
Plan/reconciliation code or hid generic behavior inside map-named functions, and passed the two
focused tests. It then failed to return the post-tool provider response and never wrote the scoped
note. The wrapper was interrupted only after that final-response stall was confirmed.

Baton recovery reopened the exact deployment and Run, truthfully terminalized both Attempts,
observed and closed both process records, stopped two targets with zero remaining ownership, and
closed with zero workers. There are no Candidates.

`status-after-ax-fix.json` is a reflexive proof against this exact stopped Run. After the local AX
repair, status rebuilds the durable journals and reports one turn for each member, Codex usage of
3,326,408 tokens, both activity states as exited, and typed `recovery_terminalized` provider causes.
The architectural constraint retained from the Run is independently verifiable in current code:
keep historical map replay as a compatibility adapter and generalize only the shared Plan,
reconciliation, and provider-input seams.
