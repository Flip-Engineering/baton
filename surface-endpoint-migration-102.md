# audit-surface: explicit endpoint migration — source-backed matrix and qualification sequences (Receive102)

Bounded source/design review of Interfaces91's proposed `receiver SESSION HARNESS_CMD OUTPUT_LOG --output-mode native-view-v1`, traced through committed registration/dispatch source (fca7af87 and cf654367 — `Control.receiver_args`/`receiver_endpoint`/`identity_endpoint`/`identity_args`, `Delivery` endpoint append, `Receive.run/acquired_pending`, recovery argv) and reconciled with Interfaces91 (synthesis127-interfaces91.json), Receive100/101 and the Controls contract at 68d255cb. Scratch only; no execution; no source edits.

## 1. Exact legacy receiver argv (source-derived)

`receiver_args(executable,db,session,cmd,log)` = `[executable, db, "receive", session, cmd, "", "", "", log]` (control.bend:26-27); `identity_endpoint` optionally prepends the Git identity wrapper (control.bend:32-38). Delivery appends MESSAGE_ID last (delivery.bend: "The committed message ID is its last argument"). Empty MODEL/EFFORT/CWD placeholders mean "use recorded values" at dispatch. Any migration MUST preserve this exact 9-element argv + appended id for legacy registrations.

## 2. Proposed new-mode argv (derived from Interfaces91 + receiver_args shape)

Opted-in registration stores: `[executable, db, "receive", session, cmd, "", "", "", log, "--output-mode", "native-view-v1"]` (11 elements; option pair between OUTPUT_LOG and the appended MESSAGE_ID). `Delivery`/`endpoint_sql` need NO change — the netstring launch and trailing-id append are generic over the stored array. Interfaces91's prose inserts MODEL/EFFORT/CWD as non-empty; the legacy registration records them EMPTY — the new-mode grammar must state explicitly that empty placeholders and recorded-value semantics are preserved, or define otherwise. That is ambiguity (a).

## 3. Concrete shared edits and owner dependencies

1. Commands/Control.receiver parsing (coordinator source — audit-native): accept/require `--output-mode native-view-v1` exactly; unknown/duplicate/missing-value refusal; legacy registrations without the option keep the exact 9-element argv.
2. Control.receiver_args/identity_endpoint: render the extended array; identity wrapper composes identically over the extended tail.
3. Receive.run/acquired grammar: accept the option pair before MESSAGE_ID in the receive argv and select the native-view path; legacy 8-field exact shape unchanged.
4. Attempt manifest identity extension (Controls, per 68d255cb): record the attempt's presentation mode at preparation so recovery/replay uses the ATTEMPT's recorded mode; a version/executable change must not reinterpret a recorded legacy argv. Interfaces91 conflates endpoint-argv mode with attempt-manifest mode — ambiguity (b): registration stores the mode in the session endpoint argv, recovery must read it from the attempt manifest; both must be specified.
5. Controls historical exact-source resolution (manifest-based, independent of turns-only/current-execution-only discovery) must EXIST before `output ACTOR ATTEMPT` can be admitted — Interfaces91 acknowledges this; the owner-order dependency is: Controls resolver → Receive pure selection → Interfaces parser/MCP/async child path.
6. MCP `baton2_output` requires the async native child path and Controls Result-valued read/export operations — stated in Interfaces91 ✓; no second source reader.

## 4. Live-old-attempt governance

A live legacy retained attempt keeps ITS recorded argv/mode: the running keeper/observer and the continuation closure bind the original cmd/log; a new-endpoint registration during the attempt only affects FUTURE dispatches. The conversion risk is the wake handoff: a message queued while the legacy attempt is live is delivered to the CURRENTLY REGISTERED endpoint after the legacy attempt finishes — so queued input can complete under the new mode. That is acceptable (input is durable; mode is presentation), but the qualification must cover exactly this legacy-finishes/new-mode-wakes handoff, and the legacy attempt's own recovery argv/mode must remain legacy. Pre-attempt registration failure carries wake/request failure evidence without inventing an attempt or output source.

## 5. Qualification sequences (literal)

1. Old shape: `receiver w <cmd> <log>` → endpoint `[exe,db,"receive","w","<cmd>","","","", "<log>"]`; a queued message delivers as `receive w <cmd> "" "" "" <log> <MESSAGE_ID>`.
2. Opted-in new shape: `receiver w <cmd> <log> --output-mode native-view-v1` → endpoint `[exe,db,"receive","w","<cmd>","","","", "<log>","--output-mode","native-view-v1"]`; delivery appends `<MESSAGE_ID>` last.
3. Literal arguments: MESSAGE_ID is the final argv element in both shapes; ids containing spaces/λ pass as one argv element (netstring launch); option pair order fixed.
4. Saved old recovery under upgraded executable: legacy attempt replays its recorded argv/mode under the new binary unchanged; new-mode attempt manifest carries the mode (Controls manifest extension).
5. Old pending input/parent duties: legacy live attempt + queued message + upgraded binary → pending input delivered, parent duties unchanged, completion in legacy mode; then the queued message runs under the currently registered mode.
6. Pre-attempt failure vs source-backed failed attempt: dispatch failure before attempt start → wake/request failure evidence, no attempt/source invented; a source-backed failed attempt → classified failure and the attempt's own output source remains addressable (failed starts are admitted to lookup per Controls).
7. Post-ACK: raw view unavailable (spool unlink attempted at ACK; a failed unlink is recorded as cleanup-error, so absence must be verified, not inferred); selected view availability per source lifetime; DB body/receipt/root-identity comparisons (report-equality pattern) are independent of any log file.

## 6. Interfaces91 source-mismatch/ambiguity findings

(a) Empty-placeholder semantics unstated for the new-mode receive argv (above). (b) Endpoint-argv mode vs attempt-manifest mode conflated (above). (c) `output ACTOR ATTEMPT` admissibility depends on the Controls manifest resolver that does not exist in reviewed source — stated as dependency, but the qualification order must make it a gate. Otherwise Interfaces91's contract matches the traced registration/delivery mechanics.

## Limits

Source/design only; committed reads at fca7af87/cf654367/00694608/68d255cb plus Interfaces91/Receive100/101 documents; no execution, no probes, no source edits. My prior verdicts (2f846fb7 qualified runtime-only ACCEPT; 5254/1e7de621 REQUEST CHANGES) stay preserved; nothing here transfers acceptance.
