# Publication destination law probe

This is an isolated, finite controller model for the review of issue #556. It is not Baton2 implementation or proof of real Git delivery.

`LAWS.bend` imports the modeled implementation and quantifies over both expected and resolved destinations. It inspects the destinations of the dispatched effects, rather than a success flag or a claimed destination. The expected destination represents an independently admitted contract; the mutable remote alias supplies the resolved destination.

The same law and proof are used in both cases:

- `good`: a mismatching destination produces no publication effect. The proof checks.
- `wrong-destination`: the only implementation change dispatches to `Intermediate` when `Shared` was expected. The proof is rejected at that case.

Compiler: Bend 2.0.25, pinned release used by the earlier review. Command in each directory:

```sh
BEND_NO_TELEMETRY=1 /tmp/codex-baton2-context-afnsav7o/toolchain/bend/bin/bend --check-only PROOF.bend
```

Exact exits and diagnostics are in `results.json`. Both copies of `LAWS.bend` have SHA256 `40a3c4e4ee5ddacac282f63797977306673480cca3cf864b876defa94fab99cd`.

This establishes a checked proof shape for the finite model. The model abstracts repository/ref identities into two values and does not implement Git, authentication, configuration resolution, host dispatch, network effects, or completion receipts. Production proof work must connect the law to those actual paths and state the external assumptions explicitly. A model field labeled `destination` cannot establish which repository an external process contacted.

An implementation that never publishes satisfies this safety law. Ordinary behavioral acceptance must also exercise a valid publication; full progress is a separate obligation and is not smuggled into this minimal destination prohibition.
