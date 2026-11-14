# Agent workload OOM policy

Issue #1503 records memory exhaustion with no logged OOM victim before the host
stalled. Agent tests and private databases use `baton-workloads.slice` and one
child scope per command. The slice registers memory pressure monitoring with
`systemd-oomd`. The daemon applies the host's configured pressure limit and
duration and kills an eligible child scope when that condition persists.

The workload launcher applies the queue's admitted memory peak as the child
scope's `MemoryHigh`. The kernel starts reclaim above that measurement. Pressure
from continued growth becomes visible in the monitored slice. A host without
retained memory history uses its current available memory for its first isolated
measurement. Admission continues to consider the shared queue's retained peaks,
available host memory and live claims. No fixed memory allocation is configured.

Run `sudo bash deploy/workload-oom/install.sh` after installing the qualified
workload queue and launcher. The script installs the global user slice and enables
it at user-manager startup. It also registers it with currently active user
managers and enables the host OOM daemon. No workload or VM restart is required.
Install the updated `bend2/scripts/run-workload.py` with
`deploy/workload-admission/install.sh QUALIFIED_QUEUE_BINARY`.

Production Colima stays in `app.slice/flip-colima.service`, outside the agent
workload slice. Its drop-in sets `ManagedOOMPreference=omit` and disables pressure
monitoring on that service. The installer applies those values to a live Colima
unit. Existing kernel OOM scores and memory protection remain configured by
Flip's host installer. Check `user.oomd_omit=1` on Colima's cgroup and its current
kernel OOM score. On the incident host, the observed score was `-900` and the
existing protection floor was 15354507264 bytes.

Verify `oomctl` lists each active user's `baton-workloads.slice`. A running
workload's `systemctl --user show UNIT -p MemoryHigh` must match its admitted
peak, or the available-memory observation for a first measurement. The system
journal and `org.freedesktop.oom1.Manager.Killed` signal identify OOM daemon
victims. Preserve that evidence and the queue's partial logs when a test is
killed. The default daemon policy is configured by the host's systemd package;
it is not an instantaneous hard memory limit.
