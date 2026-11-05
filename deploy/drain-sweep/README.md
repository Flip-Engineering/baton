# Deferred instance-drain recovery

Install the user service and timer when a Linux user service manages a Baton
database. The timer runs the existing `--drain-sweep` entry once after the user
manager starts and again five minutes after each completed run. It reads only
sessions already marked `drain-deferred` in that database. Each installation
names one database explicitly.

The service template runs the full Baton CLI at `%h/.local/bin/baton2`. Edit
`ExecStart` to the exact installed `bin/baton2` path when the release uses a
different location. Keep the executable as a single systemd argument. The
database path is encoded in the unit instance and passed as one decoded argument
by `%f`.

Install and enable one timer for each canonical database path:

```sh
install -d "$HOME/.config/systemd/user"
install -m 0644 deploy/drain-sweep/systemd/baton-drain-sweep@.service \
  "$HOME/.config/systemd/user/baton-drain-sweep@.service"
install -m 0644 deploy/drain-sweep/systemd/baton-drain-sweep@.timer \
  "$HOME/.config/systemd/user/baton-drain-sweep@.timer"
systemctl --user daemon-reload

database=/absolute/path/to/orchestra.db
timer_unit=$(systemd-escape --path --template=baton-drain-sweep@.timer "$database")
systemctl --user enable --now "$timer_unit"
```

Use an absolute database path. `systemd-escape --path` encodes path separators,
spaces, percent signs and other unit-name characters; `%f` decodes the instance
back to the original absolute path as the single `--drain-sweep` database
argument. The service invokes Baton directly with that argument. Enable one
instance per configured database path; each instance operates on its configured
database only.

For recovery before a user logs in after boot, enable lingering for the owning
account with the host administrator's normal user-manager setup, such as
`loginctl enable-linger USER`. `OnBootSec` starts relative to the user manager.
The timer uses monotonic `OnBootSec` and `OnUnitInactiveSec` triggers.

The one-shot service sets `TimeoutStartSec` and `TimeoutStopSec` to `infinity`
and sets no CPU, memory or task limits. `--drain-sweep` reads the durable
deferred-session rows and starts one detached `--drain-sweep-session` child for
each row. Each child holds a nonblocking sweep lock for its session while it
calls the existing delivery path. The delivery path takes the ordinary session
lock and preserves the existing wake claim and native custody checks. Managed
Codex inbox delivery runs its admission RPC synchronously through
`Delivery.inbox_endpoint_launch`; an unresponsive inbox host can keep that
session's child active. A later timer round tries the same per-session lock and
returns for that session while its child holds the lock. It still starts
workers for other deferred sessions. If a child or host exits before delivery
completes, the durable deferred row remains available to the next timer round.

`KillMode=process` keeps systemd stop signaling scoped to the sweep process;
detached session workers and delivery children remain outside that signal
action. A host shutdown still ends its processes, after which the next
user-manager startup runs the durable deferred rows again.

## Focused regression

The remote fixture should defer work for two sessions, then make one managed
Codex admission RPC remain blocked. Confirm that the other session reaches its
delivery path while the blocked session keeps its original claim and native
identity. Run overlapping timer and owner sweeps while the first worker is
blocked; confirm that each later worker for that session exits after its
nonblocking lock attempt and that no second delivery starts for it. Release the
admission and confirm the same session completes through the normal receive
path. In a separate case, end the blocked sweep worker before admission
completes, then confirm a later timer round retries the still-durable row. Also
confirm schema preflight migrates a legacy `wake_claims` row in the
`drain-deferred` state into the deferred-session table. Clear and re-defer the
same session while an older worker is pending; confirm its newer generation
exceeds the retained high-water generation and the older worker cannot clear or
deliver the newer obligation. Confirm the host's `.dr-` sweep lock path stays
distinct from the `.lock-` receiver lock for session IDs containing tabs,
newlines, or either path prefix, and that spawned receiver processes do not
retain the sweep lock descriptor after exec.
