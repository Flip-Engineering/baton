# Phase 88 live assessment

## Outcome

Plan route authority is now an exact allowlist of `(harness, model, effort)` tuples. Fresh
ambiguous legacy axes are refused, historical ambiguous authority is observable but quarantined
from new effects, and exact already-admitted legacy transactions remain replayable. Application,
Workflow, Context, recovery, resume, Web, MCP, and progressive Plan views use the shared route
authority helpers; no consumer constructs a tuple by indexing independent axes.

The first Baton review identified no authority bypass. It did expose one useful design restriction:
Workflow validation required singleton Plan authority even though each Attempt already carries an
explicit selected route. Baton now permits that selected route only when the complete tuple is in
the node allowlist. Web duplicate-tuple validation was also aligned with MCP and core.

## Live Baton evidence

- Review Run: `run-1fc2eeac6db5ea2dd7b64e8e5e9a8215`
- Review result: `6d22dc8b5e6b6bcc9a111d3b77a10f4a535af21a`
- Closure Run: `run-c39cd57fcfffc8c330c1af29a724adab`
- Closure result: `f14fdf14ebc7032a159e07ac1592928ee16fae30`
- Exact requested route for both: `glm / glm-5.2 / xhigh`
- Resolved harness: `glm@claude-code-2.1.211+zai-anthropic`
- Provider-observed model: `glm-5.2`
- Independent verification: complete for both Runs
- Cleanup: each Run was stopped through the Run surface; deployment close returned `workers: 0`

The compact stop result still projected `stop: null` and `ownership: null`. That is a result-view
defect, not a leak: deployment close, the worktree list, and capacity ledger provide the ownership
truth. Long quiet provider intervals also confirm the need for stage, elapsed-time, and
last-progress summaries in the forthcoming authenticated attach surface.

## Validation

- Phase 88 adversarial suite: 7/7
- Cross-surface route/workflow/context suite: 123/123
- Post-review Workflow selection and Web parity tests: green
- Final full implementation suite: 2,156/2,156
- `git diff --check`: clean
