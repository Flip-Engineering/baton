# Adversarial finding

## High — recovery accepts a descriptor with no exact run lineage

`persistRecovery(recoveryDescriptor?.runId ?? null)` creates a valid-looking recovery file with `runId: null` before the workflow ID is known, while the `--recover` guard rejects only a missing `deploymentRoot`. An interruption in that state therefore passes validation and reaches `baton.open(recoveryDescriptor.runId)` followed by `workflow.stop(...)` with a null run ID. Recovery cannot bind the stop, replay evidence, or ownership result to the exact interrupted run and may fail before producing recovery truth. Require a non-null run ID before taking the workflow-recovery branch (or explicitly perform and record deployment-only cleanup when no run exists).
