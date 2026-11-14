# Process memory history

The Linux validation host records process memory every minute with Ubuntu's
`atop` package. This supplies process evidence for incidents such as the memory
exhaustion in #1503. Each sample includes process identity, resident and virtual
memory, CPU usage and system memory counters. `-a` includes idle processes.

Run `sudo bash deploy/memory-history/install.sh` on the homelab host. The script
installs the package, saves the previous defaults once, and enables the recorder
and its daily rotation timer. It restarts the recorder to apply the configuration.
The service requires the NVMe mount before starting. Daily binary logs live in
`/mnt/nvme4tb/host-history/atop`, with 28-day retention applied by the packaged
service at each start. The directory and new logs are readable by root. Logs
survive recorder restarts and host reboots.

Read a day's process memory with:

```sh
sudo atop -r /mnt/nvme4tb/host-history/atop/atop_20261114 -m
sudo atop -r /mnt/nvme4tb/host-history/atop/atop_20261114 -P MEM,PRG,PRM
```

`-b hhmm` and `-e hhmm` select a time interval in the host's local timezone.
`PRG` identifies processes and their command lines; `PRM` reports memory. These
records can contain command arguments, so share selected process names and
memory values when reporting an incident. The one-minute samples can miss the
peak of a shorter process. The recorder starts with the current host state;
the 03:21 PST incident has no per-process history from this recorder.

Check `systemctl is-enabled atop.service atop-rotate.timer`,
`systemctl status atop.service`, and `systemctl list-timers atop-rotate.timer`.
Read a completed sample from the daily file after installation. A service
restart should append samples to that day's file. The package's
`atop-rotate.service` restarts the recorder daily and removes expired logs.
