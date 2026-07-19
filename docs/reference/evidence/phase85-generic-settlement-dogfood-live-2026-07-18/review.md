# Adversarial finding: incomplete close can pass verification

The cleanup path validates `workflow.stop()` ownership, but it never applies an equivalent terminal check to `(await baton.close()).ownership`. If `close()` resolves with `closed !== true` or `workers !== 0`, the script merely skips removal of `deploymentRoot`; `failure` remains unset, the recorded run can still look successful, and the process exits zero. This makes incomplete descendant cleanup compatible with a passing deployment verification even though `cleanup.closed` contains contrary evidence.

Require `closed === true` and `workers === 0` before allowing success (while still writing the evidence on failure), so the command exit status and cleanup record preserve the same terminal truth.
