# Agent workload OOM policy

Issue #1503 records memory exhaustion with no logged OOM victim before the host
stalled. Agent tests and private databases use `baton-workloads.slice` and one
child scope per command. The slice registers memory pressure monitoring with
`systemd-oomd`. The daemon applies the host's configured pressure limit and
duration and kills an eligible child scope when that condition persists.

The compile queue's measured peaks and host memory continue to control resource
admission. The OOM daemon observes current pressure in the workload slice. Its
configured pressure duration gives the kernel time to reclaim memory before a
victim is selected. The host's physical memory and swap remain available to work
that grows beyond a previous measurement.

Run `sudo bash deploy/workload-oom/install.sh` after installing the qualified
workload queue and launcher. The script installs the global user slice and enables
it at user-manager startup. It also registers it with currently active user
managers and enables the host OOM daemon. No workload or VM restart is required.

Production Colima stays in `app.slice/flip-colima.service`, outside the agent
workload slice. Its drop-in sets `ManagedOOMPreference=omit` and disables pressure
monitoring on that service. The installer applies those values to a live Colima
unit. Existing kernel OOM scores and memory protection remain configured by
Flip's host installer. Check `user.oomd_omit=1` on Colima's cgroup and its current
kernel OOM score. On the incident host, the observed score was `-900` and the
existing protection floor was 15354507264 bytes.

Verify `oomctl` lists each active user's `baton-workloads.slice`. The system
journal and `org.freedesktop.oom1.Manager.Killed` signal identify OOM daemon
victims. Preserve that evidence and the queue's partial logs when a test is
killed. The default daemon policy is configured by the host's systemd package;
it is not an instantaneous hard memory limit.
