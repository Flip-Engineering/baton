# Retained constructed-probe observation (not filed, not actioned)

`probe.py` + `probe-output.json`: an isolated provider-free fixture that lowers
only its own child's `RLIMIT_NOFILE` and floods the retained keeper's control
accept path at `0dcea66e`. Three runs reproduced identically.

Scope of this evidence, per the root's ruling at 2026-09-29T01:04:26Z:

- It is a retained constructed-probe observation. Do not file it, prioritize it,
  route it, hold a contribution for it, or add a mechanism for it, under the
  standing project rule that a constructed probe does not justify a mechanism.
- No cap, timeout or resource guard is authorized for this path.
- Only the fixture child's own descriptor limit is touched; no host, resident or
  global limit is changed, and the fixture makes no model calls.

Observed once per run, with `PROBE_NOFILE=64` and `PROBE_FLOOD=120`:

| Field | Value |
|---|---|
| `lock_before_flood` | `busy` (keeper holds the session lock) |
| `opened` | 120 held control connections |
| `keeper_after_flood.alive` | `false` (keeper process gone) |
| `observer_after_flood.returncode` | 32 (EPIPE on this host), `Broken pipe` on stderr |
| `native_after_flood.alive` | `true` (orphaned) |
| attempt files | no `status`, no `keeper-error`, no `observer-error`; `keeper.log` empty |
| `lock_after_flood` | `acquired` (lock released while the native survives) |
| `late_control.rc` | 61 (ECONNREFUSED) |

Reproduce from this directory:

```sh
python3 probe.py            # writes its JSON report to stdout
PROBE_NOFILE=64 PROBE_FLOOD=120 python3 probe.py > probe-output.json
```

`EXE` in `probe.py` points at the `process-test` binary built from `0dcea66e`
in `/Users/wahargis/Development/Experiments/baton-bend2-native-replies-641`.
