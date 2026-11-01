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
and sets no CPU, memory or task limits. `--drain-sweep` uses `Wake.drive_session`
and `Receive.wake_due`. For detached receiver endpoints, that path returns after
launching the delivery process. Managed Codex inbox delivery runs its admission
RPC synchronously through `Delivery.inbox_endpoint_launch` and returns after the
Codex inbox records acceptance, while the native turn continues under its own
custody. An unresponsive inbox host can still keep that admission and the sweep
active. The
timer waits for the service's inactive transition before starting another run,
so later sessions in the same database wait for the blocked admission to return.
A per-session sweep entry is required if one unresponsive endpoint must not delay
other deferred sessions.

`KillMode=process` keeps systemd stop signaling scoped to the sweep process;
detached delivery children remain outside that signal action. A host shutdown
still ends its processes, after which the next user-manager startup runs the
durable deferred claims again.
