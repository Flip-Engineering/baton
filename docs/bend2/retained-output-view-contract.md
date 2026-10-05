# Original-attempt output access

## Status and ownership

Root79 selects read, follow and explicit export over original attempt streams for the new shared instance. This document proposes the callable host contract before shared caller changes. These signatures describe logical values; they are not compiled Bend exports. Existing installed OUTPUT_LOG behavior and artifacts remain supported. No persistent filtered copy or projection reservation table is required for the new mode.

Controls owns source association, source identity, reader state, writer finality and disposal. Instance owns the retained task/destination table and keyed reference transfers. Interfaces owns one ordinary CLI operation, its matching MCP method and transport representation. Receive owns pure frame selection and derived filter metadata. Lifecycle owns qualified store authority. None of these responsibilities supplies another owner's implementation.

The current internal source/offer helpers implement some local buffer and descriptor operations. They do not implement the registry, historical resolver, public operation, writer seal or recovery protocol below.

## Selector and original association

An output selector contains the qualified selected store, actor, original attempt and one stream: stdout or native stderr. No session default may replace an explicit attempt. The resolver returns either an exact source association or a refusal with its stage and original error. Failed starts, incomplete attempts and stopped actors are admitted to lookup. Availability depends on the source, not on terminal status.

Proposed Controls boundary:

    resolve_output(bound_store, actor, attempt, stream)
      -> Result<SourceFault, SourceLease>

SourceLease contains the original store binding, actor/attempt association, stream, recorded attempt directory identity, stream identity, source incarnation, output contract version and a retained lease owner. A pathname or process-local descriptor number is not the identity. Resolving a lease does not begin, recover, acknowledge or change a semantic attempt.

Current retained Receive derives its directory from the attempt ID and stores the original recovery argv in the six-field manifest. Its manifest has no standalone store/actor/attempt identity record. The current executions row is a current pointer. Consequently an arbitrary directory plus a current row is insufficient for this export.

The new-mode prepare/begin authority must bind output association to the existing original attempt preparation before publishing it. Extend that original manifest's versioned identity section; retain actor, attempt, original store binding and stream/source incarnations there. This is an extension to existing attempt authority, not a second attempt registry. The immutable decision/preparation must select that same manifest. Controls and Lifecycle must supply the exact encoding and same-binding admission/readback before this becomes operative.

Legacy lookup can use a source-qualified original manifest and its decoded original recovery arguments only when the complete association can be established. It may not rebind the expectation using a fresh Sql.binding call. Missing or ambiguous association returns an explicit unavailable/refused result. A legacy filtered artifact can be listed as a separate artifact with its own representation; it cannot satisfy a raw-source request.

Optional history enumeration inspects the existing owned attempt namespace and validates each candidate against original authority. It returns attempt boundaries and per-entry unavailable/corrupt association outcomes, including incomplete directories. It does not infer emission order from directory names, skip failed starts, or use turns rows as a complete census. The first implementation can provide exact-attempt lookup before optional history enumeration.

## Passive read and readiness operations

Proposed logical operations:

    open_output(source_lease, raw_position, retained_destination)
      -> Result<SourceFault, ReaderLease>
    read_output(reader_lease, accepted_observation)
      -> Result<SourceFault, BytesOffer | Waiting | End>
    register_output_ready(reader_lease, observed_revision, retained_destination)
      -> Result<SourceFault, RegistrationLease | ReadyNow>
    cancel_output_ready(registration_lease)
      -> Result<CleanupFault, Cancelled | InFlight>
    take_output(reader_lease, exact_offer_serial, empty_output_slot)
      -> Result<SourceFault, OwnedBytes>
    close_output(reader_lease)
      -> Result<CleanupFault, Closed | Busy>

Each handle is qualified by its original object incarnation and exact holder. Instance retains the destination before registration or read can outlive its caller. Register/recheck and cancel/in-flight adoption use its keyed event operations. A ready event transfers wake-and-retry responsibility; it does not transfer bytes. A BytesOffer is adopted separately with original correlation, reader incarnation, serial and any latched fault. Failure to adopt preserves a named responsible owner and allocation.

Read acceptance and revision qualification are serialized for that reader. Slow reads/conversion retain their objects while running outside the shared Instance table mutex. A borrowed pointer grants no reference. Take requires an empty/unowned result slot and does not advance any durable semantic checkpoint. Erroneous offered bytes remain with a failure task. Release of an allocation, a borrower, a registration, a reader and a source lease are separate exact-holder operations.

The existing frame-oriented offer helper can serve Receive's selected-frame derivation. Raw byte access must not pass through LF splitting or string conversion. Both modes use the same qualified source and extent observations. No read operation invokes consume, Observe, semantic input ACK, native request settlement or parent delivery.

## Readable extent and finality

An accepted observation contains source incarnation, monotone revision, available byte end and one of Open, Sealed(final_end), or Fault(original_error, last_qualified_end). End and revision use exact wide integers across FFI/transport. Available bytes can be read while Open. End is returned only after consuming Sealed(final_end). A temporary regular-file EOF returns Waiting while Open; an unterminated tail cannot be certified final then.

For version1 byte positions and extents are canonical unsigned decimal strings in the range0 through9223372036854775807. This matches the current source helper's INT64_MAX checks before off_t conversion. Arithmetic and transport decoding must check this bound and interval order. Revisions and capability incarnations are separate identities; they are not byte offsets or truncated JSON numbers.

Current br_keeper and br_grant pass the regular spool to native fd1; fd2 is also a regular log descriptor. Descendants can retain these descriptors. br_native_exited waits for one PID. Release/ACK and a stable size do not establish closure of every writer. There is currently no callable all-writer seal export.

The smallest proposed writer change uses the existing keeper as the sole spool appender. Each captured native stream is passed through an owned pipe; the keeper retains its read side and closes every local write-side duplicate after spawn. Descendants inherit the pipe writer rather than the spool descriptor. The keeper drains accepted bytes to that stream's existing spool, retains partial append/error outcomes and publishes available end only for bytes actually appended. It seals only after pipe EOF, drained buffers and the final append outcome, with no remaining owned path that can append. Stdout and stderr have separate extents and faults. Unexpected source mutation is a source fault. This proposal requires review of keeper failure, descendant inheritance and existing host ownership before implementation; no writer plumbing has been changed.

The pipe proposal has a material custody dependency: losing its only read endpoint can interrupt surviving native writers and lose buffered bytes. It cannot replace the current direct-file path until an existing retained owner holds the endpoint and pending drain duty through keeper replacement, with actual descriptor transfer and failure evidence. The drain owner must also prevent pipe backpressure from leaving child or parent duties waiting without an owned recovery wake. A pure registration record does not supply that custody. Correlated loss of every holder must retain an explicit source failure and available prefix, never claim complete raw output. This remains an unresolved implementation boundary for the writer proposal.

A recovered spool with no qualified seal remains uncertain even if native status is terminal. A snapshot can expose its qualified available prefix as incomplete. Follow returns a source-uncertain fault when no responsible producer or recovery event can wake it; Waiting always has retained wake responsibility. Recovery may restore Sealed only from original source-bound seal evidence published by the qualified writer protocol. The seal includes source incarnation, final extent and append outcome; file/directory durability and cleanup are separate outcomes. A crash between append and seal cannot manufacture a seal. Source/read faults retain duties and cannot rewrite an already finished semantic result.

## Reconnect and derivation

A continuation contains format version, original store/actor/attempt/stream/source identity, raw byte position and view version. It is navigation data; ordinary caller authority and exact source comparison are checked again on reconnect. Reader-local offer serial and readiness revision are not durable cursors. A new reader receives a new incarnation; source identity persists only through the qualified source lifecycle.

Raw snapshot chooses a qualified available end and returns exactly that byte interval, labelling an open/incomplete source accurately. The first public follow contract is one finite readiness-driven step, shared by CLI --follow and MCP follow:true. When a qualified unread suffix exists, the step captures its available end and returns through that end. At the inspected extent it registers/rechecks readiness and waits for new bytes, qualified finality or a fault, then returns the captured interval/status and next cursor. An open-source completion means caught up through that extent. Qualified final end returns immediately. Each subsequent step uses the returned source-bound cursor. The operation has no fixed count or time cutoff.

The step releases its exact passive holders after completion or cancellation, including any in-flight registration/frame duties through the retained owner. An unresolved source without a responsible producer or recovery wake returns output-source-uncertain. The ordinary output operation and asynchronous MCP child invocation must implement these same step semantics. Continuous terminal streaming is outside this first surface contract. Cancellation does not promise a final response or a new cursor; a caller reconnects from its last validated cursor and may receive replayed records.

Selected-frame continuation positions occur only at complete raw frame boundaries. Receive's pure derivation must reconstruct filter state from the original prefix or provide source-bound sufficient derivation state. Re-reading a prefix is passive. A derived final filter note has a separate representation/phase so reconnect neither repeats it as a native frame nor omits it. Existing selected-log file offsets remain selected-log offsets until explicitly migrated; they cannot be relabelled as raw positions.

A selected continuation needs both resumeAt, the last completely folded frame boundary, and scannedThrough, the captured extent already inspected. An open partial frame lies between them and is reconstructed from the original source on reconnect. If no new bytes/finality/fault exist beyond scannedThrough, a follow step arms/rechecks readiness rather than immediately returning that same partial suffix. Suppressed complete frames advance resumeAt even when no selected record is emitted. Receive must validate the prefix/frame boundary and derivation phase; a caller-supplied field cannot skip unprocessed bytes. Current reader-generation revisions are used for registration, while these source positions survive a new reader incarnation.

A derived note is emitted once along a continuation that advances through its final-note phase. At final raw end E, FinalNotePending(E) emits the deterministic note and returns FinalNoteConsumed(E); FinalNoteConsumed(E) emits no note. Both phases retain raw position E. Retrying an older token after lost transport completion may replay that interval and note with the same derived identity. This passive protocol does not establish exactly-once delivery to an external caller. Records carry source/view/position or derived-note identity so a caller can recognize replay without content-based deduplication. A missing completion record is not evidence that the operation delivered no bytes.

Receive100 supplies the proposed pure derivation boundary:

    decode_frame(complete_original_range, decoder_version)
      -> correlated Facts{is_update, transition} | Opaque | DecodeFailure
    step(original_context, filter_state, correlated_range_facts)
      -> selection, next_filter_state
    finish(original_context, filter_state, folded_through, qualified_final_extent)
      -> DerivedNote | NoNote | Incomplete | Failure

The original qualified attempt supplies harness and output-contract version. Complete LF ranges retain their LF; an unterminated tail becomes a complete range only after qualified sealing. OMP stdout updates are suppressed independently of filter acknowledgement. Every later matching filter response replaces the filter state. Other ranges are retained exactly; other harnesses and streams produce no OMP filter note. The final note uses the final filter state after folding the qualified tail. Prefix replay reconstructs that state without emitting records or semantic effects.

Opaque malformed material retains its original bytes and leaves filter state unchanged. Operational decoding errors and unsupported valid input produce DecodeFailure and preserve the last fully derived cursor; they cannot certify a complete view or final note. A complete qualified frame decoder remains missing. The existing U32 token decoder and JSON encoder do not supply it. Current filter SQL compares the extracted success value to numeric 1. Numeric, type and duplicate-member behavior must be qualified against the exact linked SQLite oracle or selected as an explicit versioned policy change. The signatures above remain design notation.

Interfaces selects a transport that preserves opaque raw bytes for CLI export and MCP results. Structured selected frames carry byte positions and representation tags; derived metadata is labelled. The public caller never needs a private decoder or a filesystem naming rule.

## Explicit raw export

Proposed additional host boundary:

    export_output(source_lease, raw_start, captured_end, destination, retained_task)
      -> Result<ExportFault, ExportReceipt>

It uses a captured qualified source interval and never follows beyond captured_end. Interfaces91's raw-only, new-file export fits this boundary. Resolve and pin the existing destination parent directory under the original invocation cwd; do not create parent directories. Create the requested final basename exclusively with restrictive permissions and no symlink following. An existing file, directory, symlink or hardlink is a refusal; never truncate or replace it. Preserve the actual destination identity and original requested path in the receipt.

This smallest contract writes directly to the exclusively created final path. The path can be visible while incomplete. It has no atomic-publication promise. On write, source, cancellation, sync or close failure, retain the created artifact and its identity, intended interval, known written prefix and exact uncertain operation. Do not silently unlink it or retry export over it. The retained export task owns cleanup/error reporting after client disconnect; it does not own semantic attempt completion. A caller can explicitly choose another new path for a retry.

Success requires complete interval write, file sync, one close attempt and parent-directory sync; the receipt reports each outcome independently. Failure still performs possible cleanup once, retaining the primary error and later close/sync outcomes. A write that returns a count advances the known prefix by that count; an interrupted operation with unknown effect remains uncertain. Never retry a failed close by numeric descriptor after its ownership is consumed. If completion transport is lost after success, the next exclusive create refuses the existing path; no idempotent retry success is invented.

The MCP adapter must preserve partial native records and final status on operation failure. A transport limit or decoder failure cannot be reported as complete success or advance beyond the last validated safe continuation. An asynchronous child path must keep unrelated calls runnable and tie cancellation to the exact retained reader/export task. Whole-result text buffering is not itself a proof of complete unbounded export support.

## Lifetime and disposal

For new-mode attempts, semantic ACK settles semantic ownership while the original streams remain retained. Active reader/source leases prevent physical disposal, but cannot delay ACK, parent notice, pending-input work or native request settlement. A client disconnect cancels its subscription and releases only its own exact holders.

No automatic retention cutoff is introduced. Disposal is a separate explicitly authorized operation after original writer finality, all semantic/recovery consumers and active source/reader holders permit it. Controls closes and unlinks each actually owned resource with independent outcomes. A failed cleanup retains original source identity and unresolved outcomes until a responsible task accepts them. A void free, absence of current readers or a manufactured zero-ref record is not a disposal receipt. Until that operation and recovery behavior are qualified, new-mode originals remain retained.

Legacy ACK and old live-attempt recovery retain their recorded contract version. They must not silently change lifetime or output mode during a version upgrade. Missing historical raw remains unavailable even if a public filtered file or provider conversation still exists.

## Caller migration and remote qualification

Interfaces91/92 proposes the ordinary command after the database argument:

    output ACTOR ATTEMPT --stream stdout|native-stderr --view raw|selected
      [--cursor TOKEN] [--follow | --export PATH]

The matching baton2_output arguments are actor, attempt, stream, view and optional cursor, follow and exportPath. Identifiers and paths are literal. Required selectors, strict option/type validation and source-bound cursors apply to both surfaces. The first version supports selected stdout and raw export to a new file. Versioned native JSON records carry the source header, exact base64 byte ranges or labelled selected/derived records, and completion/error. MCP preserves the same records and decimal offsets. Native raw export writes only original bytes. Interfaces owns the exact parser/schema and asynchronous cancellation path; these remain proposed interfaces.

The proposed additive registration is receiver SESSION HARNESS_CMD OUTPUT_LOG --output-mode native-view-v1. Its proposed Receive argv retains MESSAGE_ID last, after --output-mode native-view-v1. Admission must bind the advertised executable/owner capability, endpoint mode, original recovery argv and immutable preparation/lifetime together. Receive's caller matrix remains under owner review, so these shapes are not enabled grammar. Existing OUTPUT_LOG call shapes retain their file behavior. A live old attempt keeps its recorded mode through recovery and version changes.

For the selected new endpoint, live-tail callers use repeated readiness steps; file-size/seek consumers obtain raw cursors for the exact source; post-ACK comparisons use independent selected-frame expectations. Selected-log file offsets cannot be reused as raw positions. Registration and new failure/stop reports expose literal outputRead argv and availability; old path references stay valid. OUTPUT_LOG identifies the recorded legacy artifact in the proposed new mode, and registration must state its mode explicitly. Nonretained pipe turns keep their current artifact until separately composed. observed-usage continues its provider-conversation contract.

Operative composition still requires original manifest association and same-binding admission/readback, an actual historical resolver, passive byte/readiness exports, retained keyed destination/reference/frame storage, all-writer seal and drain recovery, ACK-aware source lifetime/disposal, the complete decoder, and the agreed caller migration. Internal reader helpers, pure registry transitions and the signatures in this document do not supply that closure. Existing owners retain these source regions.

Actual CLI/MCP and existing recovery/report fixtures must qualify raw byte equality, independent selected-frame expectations, old-attempt selection after a newer one, missing source, live/partial follow, reconnect, normal/orphan ACK, restart and cleanup faults. A descendant that writes after its native parent exits must prevent premature End while preserving parent semantic notice. Live output observation precedes actual guidance; binding, input receipt, full report and late terminals are checked independently. Viewer/export failure does not change those duties.

Named successful-build negative controls must detect latest-pointer substitution, line-based raw export, content deduplication, unqualified EOF, ACK deletion in new mode, wrong continuation incarnation and a passive reader calling semantic consume. Existing file-mode append failures remain separately qualified. Full source composition, exact-tree law/native gates and separate remote platform results precede installation or primary landing.
