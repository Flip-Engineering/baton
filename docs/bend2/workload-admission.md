# Agent test workload admission

The memory exhaustion in #1503 included agent test suites and private PostgreSQL
instances outside the compiler queue. On the Linux validation host, run each test
and its private services through:

```sh
python3 /path/to/baton/bend2/scripts/run-workload.py -- bin/with-ci-postgres bin/ci-test-shards
```

The launcher creates a dedicated user systemd scope in `baton-workloads.slice`.
It submits a `workload` request to the installed shared compile queue at
`/var/tmp/baton2-compile-queue`. `BATON2_COMPILE_QUEUE_BIN` and
`BATON_COMPILE_QUEUE_ROOT` select a qualified binary and queue for validation.
The queue measures the scope's `memory.current`, including children that create
new sessions. The database must start and stop inside the submitted command.
Existing external database servers and Docker daemon containers have separate
cgroups and require their own admitted lifetime.

Each launch gets a distinct request identity. The invocation value is declared
as per-run data, so equivalent commands share measured memory history. Test
results are executed on each launch. The queue uses the existing retained peak
selection and host admission: exact workload, compatible workload, same kind,
then the host's largest retained positive peak. It considers current available
host memory, remaining measured growth of live claims, and observed outside
growth. A host with no retained measurement establishes its first peak with one
claim. Later runs can exceed prior observations; the agent OOM policy addresses
that condition separately.

The scope covers the queue wait, test, database cleanup and evidence collection.
The launcher retains a receipt and full queue diagnostics under the caller's
`.scratch/workloads/`. It streams the test's complete stdout and stderr as they are
written, and returns its exit status. Native execution logs and measured
peaks remain in the shared queue. A failed submission reports the queue error.
An unavailable systemd manager, queue or cgroup counter is an execution failure.
