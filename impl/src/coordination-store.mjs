import { join } from 'node:path';
import { assertGoalSuccessor, normalizeGoalPlanPolicy } from './goal-plan.mjs';
import { SwarmIntegrityError } from './swarm-state.mjs';
import { usdToNanos } from './usd.mjs';
import {
  CANONICAL_ORDER_MIGRATION, canonicalJson, compareCanonicalStrings, normalizeCanonicalOrderMigration, normalizeCanonicalOrderPolicy
} from './canonical-order.mjs';
import { normalizeTaskTopologyPolicy } from './task-topology.mjs';
import { normalizeRunLineagePolicy, RUN_ORCHESTRATOR_REVOCATION_REASONS } from './run-lineage.mjs';
import { normalizeWorkflowPolicy } from './workflow-policy.mjs';
import { normalizeContextProgramPolicy } from './context-program-policy.mjs';
import { contextSessionIdentity } from './context-authority.mjs';
import { contextValueDigest, normalizeContextManifest } from './context-program.mjs';
import { normalizeContextEffectSource } from './context-call.mjs';
import { validateContextProviderResultReference } from './context-result.mjs';

import * as coordinationInternals from './coordination-internals.mjs';
import * as coordinationReplay from './coordination-replay.mjs';
import * as coordinationLedgerWrites from './coordination-ledger-writes.mjs';
import {
  BRIEFING_SCHEMA_FIELD_SOURCES, CoordinationIntegrityError, CoordinationRefusal, MAX_CONTEXT_PACK_BODY_BYTES, MAX_SCRATCHPAD_SHARED_ENTRIES, MAX_SCRATCHPAD_WORKER_ENTRIES, PROJECTION_CHECKPOINT_FIELDS, SEGMENT_INDEX_FILE, boundedText, canonical, canonicalDigest, clone, digest, freeze, madConfidenceOf, promotionActor, sha256Bytes, validRunId, validUnicodeScalarString
} from './coordination-internals.mjs';

import * as coordinationLedger from './coordination-ledger.mjs';
import {
  BRIEFING_FAMILY, KNOWLEDGE_GROUNDINGS, KNOWLEDGE_NODE_TYPES, MAX_SCRATCHPAD_BATCH_BYTES, MAX_SCRATCHPAD_ENTRY_BYTES, MAX_SCRATCHPAD_SNAPSHOT_REAPS, MAX_SCRATCHPAD_SNAPSHOT_REAP_BYTES, MAX_SCRATCHPAD_WRITE_REQUEST_BYTES, PROJECTION_REFERENCES, SwarmReplayRefusal, normalizedRecallText, recallTerms, validKnowledgePreviewPolicy, validKnowledgeRecallPolicy, writeQuarantineEntry
} from './coordination-ledger.mjs';

import * as coordinationAdmission from './coordination-admission.mjs';
import {
  retainedResultRef,
} from './coordination-admission.mjs';

export { BRIEFING_FAMILY, MAX_SCRATCHPAD_BATCH_BYTES, MAX_SCRATCHPAD_ENTRY_BYTES, MAX_SCRATCHPAD_SNAPSHOT_REAPS, MAX_SCRATCHPAD_SNAPSHOT_REAP_BYTES, MAX_SCRATCHPAD_WRITE_REQUEST_BYTES, SwarmReplayRefusal };

export {
  BRIEFING_SCHEMA_FIELD_SOURCES,
  CoordinationIntegrityError,
  CoordinationRefusal,
  MAX_CONTEXT_PACK_BODY_BYTES,
  MAX_SCRATCHPAD_SHARED_ENTRIES,
  MAX_SCRATCHPAD_WORKER_ENTRIES,
};











/** Issue #449: the opens that owe the NEXT open a checkpoint, by the restore state that made them
 * replay, with the reason token each refresh reports. `valid` needs nothing, `corrupt` keeps its
 * landed remedy (#397: a repair, never a rewrite over the refused bytes), and an empty ledger has
 * nothing to cache — `_openCheckpointRefresh` names all three refusals. */

/** Issue #465(3): the projection's REFERENCE grammar — the ledger kinds a projection row may point
 * at, and where inside that row's payload the referenced value lives. ONE table, so every writer of
 * a `{kind, seq}` reference and the ONE reader (`_projectionReferenceValue`) cannot disagree about
 * what a pair means; a kind that is not in here is not a reference and resolves to null, never to a
 * guessed value. The pairing is the #464/#469 derivation (a `roleRef`/`briefRef`/`objectiveRef`
 * names the `swarm.participant_joined` row that holds the text), applied to the families the
 * checkpoint measured as second copies of their own ledger rows. */

/** Issue #465(4): the swarm family's null-prototype dictionaries, read off the body the write is
 * about to persist. A row's dictionary is built with an EMPTY prototype (swarm-state.mjs `nullDict`)
 * so a key named `__proto__` is data and not a prototype write, and `v8`'s round trip flattens every
 * container to a plain object — so the names are recorded on the envelope and the open restores
 * them. Derived from the rows themselves (never a second declaration of the fold's shape), in a
 * stable order, and empty for a body with no such family. */


/** Issue #465(3): what a reference stands for, in bytes — the text a reader carries if it resolves
 * the pair: the exact UTF-8 length of a string, or of the JSON text an object-valued field
 * serializes to. ONE derivation, so every family's `<field>Bytes` is the same measurement (and the
 * spill row's existing `bytes` — minted as `Buffer.byteLength(body)` — is the same number). */
function referencedBytes(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

/** Issue #290: the wave.started roster well-formedness rule, shared by the replay fold and the
 * prospective write gate so the two can never drift — the fold refuses a genuinely malformed
 * roster (neither a well-formed object-array nor a well-formed string-array) as an integrity
 * failure; the write gate refuses the same payloads typed BEFORE the durable append. */

/** Epic #81 (O-2, issue #367): the per-attempt receipt identity — the ONE key derivation the
 * context.read fold and the O-2 ceiling admission share, so the fold's `{count, bytes}` row
 * and the admission's lookup can never drift apart. */

/** Issue #290: the default ledger group-commit — one fsync per drain tick regardless of how
 * many events landed inside it, so the authoritative ledger is at least as durable as the
 * fsynced housekeeping (checkpoint, segments, receipts) that accelerates its replay. */


/** Issue #290: durably record one quarantine entry beside the ledger (atomic temp + fsync +
 * rename, matching the receipt and checkpoint discipline). A repeat naming an already-quarantined
 * seq with the same entry is idempotent; a different entry for the same seq is a conflict. */

// Issue #223 ledger compaction: terminal-wave event prefixes are archived into
// content-addressed segment files under <root>/segments/ (segment = the event range
// [fromSeq, throughSeq] + sha256 of the exact JSONL bytes). The segment INDEX is a compact
// ordered roster of the archived prefix; it is a cache — the segment files are immutable
// and the index is rebuilt by scanning them if it is absent or behind the ledger's
// truncation. `compact({ beforeSeq })` is the operator verb that lands this seam; a later
// row wires the cadence policy that decides which waves are terminal and picks the cut.
/** Issue #304: the typed startup refusal for a RECORDED swarm row the fold rejects. The bare
 * SwarmIntegrityError a resident died with named a code but not the row, and left the operator
 * no repairable coordinate. This refusal carries the offending row's seq and kind, the fold's
 * own code (kept as `code`, so a quarantine entry records the true cause), the original
 * message, and the remedy — quarantine the seq per #290's verb, or land the rule with the
 * replay corpus so no fold refuses recorded history again. Raised only at the fold site during
 * replay (`_loading`); a live append failure still poisons the projection the #290 way. */

/** Issue #304: the read-only probe behind `baton doctor`'s coordination row. It runs the REAL
 * startup — one store construction, no writer lease, no writes (the #290 quarantine probe's
 * idiom) — and reports the typed refusal a restart would die with, or null when the ledger
 * replays clean. */
export function coordinationReplayFailure(root) {
  try {
    new CoordinationStore(root);
    return null;
  } catch (error) {
    return freeze({
      state: 'replay_refused',
      name: error?.name ?? null,
      seq: error?.coordinationSeq ?? null,
      kind: error?.coordinationKind ?? null,
      code: error?.code ?? 'coordination_startup_failed',
      message: error?.message ?? String(error),
      remedy: error?.remedy ?? 'restart after repairing the coordination ledger',
    });
  }
}





// The non-knowledge half of the projection-input fence (see _apply's closing note): board
// claim/report traffic (deliberately non-board-fence-bumping) and package admission/attach —
// the only non-knowledge inputs the horizons read, closed by design.

// KG-2 Part D (rule 14): knowledge.workflow_admitted, structurally modeled on
// knowledge.scratch_corrected but with a single-candidate admission surface, not a scan policy.
// #286 G-41: the acceptance-revocation scan is bounded by the STATE ITSELF, and that state is a
// projection of the ledger (`_artifacts`, `_knowledgeNodes` and `_knowledgeReads` each grow only by
// an appended event, so none can exceed the ledger's event count) — the ledger is the physical
// resource, and a second literal ceiling on top of it refused operations the ledger had already
// accepted, including on replay, where it made a self-written ledger unloadable.
const REPRESENTATION_POLICY_FIELDS = [
  'maxArgumentBytes', 'maxEvidenceRefs', 'maxGraphBatchBytes', 'maxReceiptBytes',
  'maxResultBytes', 'maxResultItems', 'maxResultRefs', 'maxSourceRefBytes', 'maxSourceRefs', 'repoId', 'schemaVersion',
];


// KG-3/KG-4 (v2-P1-3, P2-7). The preview policy is a two-level split so `policy.recall` stays
// byte-exactly the 11 recall fields (accepted verbatim by validKnowledgeRecallPolicy) while
// `policy.preview` carries the composite weights, byte caps, per-type auto-link thresholds, K,
// the LRU cache bound, and the staleness age. Unlike the recall numeric guard (≤0 ⇒ invalid) the
// composite weights admit 0 — a disabled term is legal (v2-P2-12).





// BU-2-3: the scratch-read web frame. A fact whose body references a web_fetch artifact
// handle (art:sha256:<digest>) is framed UNTRUSTED_WEB_CONTENT at read time — a read-side
// projection (the family's existing posture); the durable fact is never rewritten. Facts
// without the handle pass through byte-identical so the projection is scoped to web-sourced
// bodies only.
// REFLEX-2 board bounds. A board item's identity (itemId/itemVersion/itemDigest/ordinal)
// is hub-minted; the content core that the itemDigest content-addresses is exactly these
// nine fields, in the delete-and-recompute discipline (never accepted from a submitter).
// Live board bounds imported from the registry (Decision 8 / v1.2 blue-team blocker 1) — the
// store is a first-class registry consumer, never a second door for a cataloged lane.
// Epic #78 Decision 5: the L1 worker read page is at most 16 items and 28 KiB serialized (the
// receipt wrapper carries the ok/kind/renderedText/idempotencyKey overhead, so the page budget
// is deliberately below the 32 KiB wire ceiling to leave room for it).
/** Epic #78 Decision 6 rule 3: the kernel-level request digest for worker board mutations. It
 * covers ONLY the content the caller submitted (the derived owner/claim/grant coordinates are
 * authority, not content — a replay after a close must not re-judge the original request). The
 * seam additionally namespaces the effective replay key with the grant digest so cross-worker
 * key-string collisions cannot occur. */
/** itemDigest = H(the nine content-core fields), recomputed by the hub, never trusted from input. */

// REPL-2/REPL-3 (docs/reference/evidence/repl-kg-wave-2026-07-22/repl23-decisions.md, issues
// #22/#23). Binding identity/fences/history/citations are (runId, scope, name)-tupled via
// JSON-encoded map keys — never string concatenation (Part A rule 2).
/** bindingDigest = H(scope, name, bindingVersion, state, cellId), hub-recomputed (Part A rule 1). */

// Issue #33 — typed task-horizon scratchpad bounds. These are deployment constants, not
// caller policy, so live admission and replay use the same ceilings.
// The closed top-level field set (D1); the same sorted set the schema table keys.
const BRIEFING_TOP_LEVEL_FIELDS = Object.freeze([
  'blockedOn', 'composedAtEventSeq', 'family', 'landings', 'lanes',
  'parked', 'rings', 'schemaVersion', 'sources', 'standingLaws',
]);
// The orchestrator-briefing family constant (D3's family-scoped authority rule). Exported so the
// application and northbound surfaces share ONE family name with the store that mints it (D7).
/** The DOCUMENTED DEFAULT partition admission bounds (#286 G-41): a worker's own partition and the
 * run's shared partition. They are the defaults of `scratchpadPartitionPolicy`, which the deployment
 * may raise — they are not ceilings of the store, and they are never applied on replay. */





// Short-circuiting JSON-compatible own-data-property walker. It deliberately never reads a
// property before checking its descriptor and never invokes JSON.stringify on untrusted input.



/** Decision 3: a size refusal on a cataloged admission lane carries {cap, actual, unit,
 * gracefulPath} on the thrown error AND a human message composed by the ONE helper — numbers
 * only, never body content (AS-4). */

/** Issue #366 — the ONE bound a run-stop ADMISSION is judged against, read from the ONE registry
 * row (`target_set.per_ledger_event`). The bound is DERIVED, never invented: the run-stop target
 * set is a projection of the ledger — every target is a task/worker the ledger already holds, and
 * each such row costs the ledger at least one event — so the physical bound is the ledger's own
 * event count, exactly the #286 G-41 law stated for `_artifacts`. A second literal ceiling on top
 * of the ledger refused operations the ledger had already accepted, including on replay, where it
 * re-judged a recorded row and made a self-written ledger unloadable; this helper is therefore
 * called at ADMISSION only — the fold (`integrity`) judges no target-set size at all. The refusal
 * names the field, the observed count and the bound. A fleet drain's target set is not a projection
 * of this ledger (see `_validateFleetDrainAdmission`), so that admission derives no bound here. */

export class CoordinationStore {
    constructor(root, opts = {}) {
    coordinationLedgerWrites.constructor(this, root, opts);
  }

  _canonicalOrderFail(message, code = 'canonical_order_integrity') { return coordinationLedger._canonicalOrderFail(message, code); }

  _readCanonicalLedger() { return coordinationLedger._readCanonicalLedger(this); }

  _canonicalPrefixEventDigest(events) { return coordinationLedger._canonicalPrefixEventDigest(this, events); }

  _canonicalReceiptCore(mode, ledger, createdAt, cutPolicy = this._canonicalOrderPolicy) { return coordinationLedger._canonicalReceiptCore(this, mode, ledger, createdAt, cutPolicy); }

  _receiptBytes(receipt) { return coordinationLedger._receiptBytes(receipt); }

  _validateCanonicalReceipt(receipt, bytes, ledger) { return coordinationAdmission._validateCanonicalReceipt(this, receipt, bytes, ledger); }
  _readCanonicalReceipt(ledger = this._readCanonicalLedger()) {
    return coordinationReplay._readCanonicalReceipt(this, ledger);
  }
  _openCanonicalOrderLedger() {
    return coordinationReplay._openCanonicalOrderLedger(this);
  }

    _cleanupCanonicalOrderTemps() { return coordinationLedgerWrites._cleanupCanonicalOrderTemps(this); }

    _writeCanonicalReceipt(mode, ledger, cutPolicy = this._canonicalOrderPolicy) { return coordinationLedgerWrites._writeCanonicalReceipt(this, mode, ledger, cutPolicy); }
  _ensureCanonicalOrderReceipt() {
    return coordinationReplay._ensureCanonicalOrderReceipt(this);
  }

  canonicalOrderReceipt() { return coordinationLedger.canonicalOrderReceipt(this._canonicalOrderReceipt); }
  _reportStartup(value) {
    return coordinationReplay._reportStartup(this, value);
  }
  startupStatus() {
    return coordinationReplay.startupStatus(this);
  }

  _projectionCheckpointPayload() { return coordinationLedger._projectionCheckpointPayload(this); }

  /** Issue #465(2): the swarm family AS THE PROJECTION CARRIES IT — a participant row's composed
   * brief is referenced instead of copied. The reference is the fold's OWN (`briefBytes` +
   * `briefRef {kind, seq}`, the `participantBriefReach` derivation minted at the join (#464 third half) and carried
   * through every later re-mint): the body renders `brief: null` where the row names the row that
   * holds the text, and derives nothing of its own — ONE derivation, so the checkpoint and the
   * view cannot disagree about where a brief lives.
   *
   * The store's own fold rows are untouched — the live view still renders the whole text — and this
   * is the body's rendering of the same row. Issue #465(4) makes the body the STATE the next open
   * installs, so the rendering is reversible: `_materializedProjectionCheckpoint` puts the whole
   * `brief` back from the row `briefRef` names (the `briefBytes`/`briefRef` pair is the fold's own
   * and stays on the row). A swarm whose rows carry no brief is passed through untouched (the
   * identity the write's own measurement then reports). */
  _boundedSwarmProjection(swarms) { return coordinationLedger._boundedSwarmProjection(swarms); }

  /** Issue #465(1)(3): the checkpoint body's SECOND-COPY families — a row whose text is
   * byte-identical to a ledger row's own field hands the text back to the row that holds it. Measured
   * on the clone's checkpoint, these are what the non-window families keep: `_webCommands`
   * 39 206 146 B, `_tasks` 12 141 185 B, `_plans` 12 071 920 B, `_goals` 11 971 429 B and `_spills`
   * 5 845 234 B of the 288 871 406-byte body — every byte of it text the `web.command_completed` /
   * `task.created` / `plan.version_proposed` / `goal.version_defined` / `spill.minted` row already
   * carries. The row keeps its identity (id, version, digest, the event seqs it was folded from, the
   * derived state) and the body carries `<field>: null`, `<field>Bytes` and `<field>Ref {kind, seq}`
   * — the pair the ONE reader resolves through.
   *
   * A `_spills` row carries its pair from the FOLD (every reader of a spill row is this store's own
   * accessor, so the fold hands the bytes back and `materializeSpill` composes them again). The
   * `_webCommands`, goal, plan and task rows are rendered HERE: the two web-command readers are
   * delegates into the extracted internals port whose bijection pin requires them to stay bare calls,
   * and consumers outside this store read the goal/plan/task rows whole (`coordination-replay.mjs`'s
   * `plan.nodes`, the application's goal/plan readers) — so the fold keeps those rows and the body
   * points at the ledger row.
   *
   * Rendering is memoized BY ROW IDENTITY for the duration of one payload: a family and its head map
   * are set from the SAME frozen row (the fold does `this._plans.set(key, frozen);
   * this._planHeads.set(headKey, frozen)`), so both families render to the one rendered row and the
   * body never pays for the text a second time — nor does it lose the alias. A row whose field is
   * absent, or whose seq is not the row's own event, is passed through untouched: the reference is
   * only minted where the pair it names is provable from the row itself. */
  _referencedSecondCopies(payload) {
    const memo = new Map();
    const rendered = (row, render) => {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) return row;
      const prior = memo.get(row);
      if (prior !== undefined) return prior;
      const next = render(row) ?? row;
      memo.set(row, next);
      return next;
    };
    const family = (rows, render) => {
      if (!(rows instanceof Map) || rows.size === 0) return rows;
      let changed = false;
      const out = new Map();
      for (const [key, row] of rows) {
        const next = rendered(row, render);
        if (next !== row) changed = true;
        out.set(key, next);
      }
      return changed ? out : rows;
    };
    /** A row whose OWN `<name>` field is byte-identical to a field of the ledger row `seqField`
     * names — the goal objective, the plan nodes, the task brief. */
    const own = (name, kind, seqField) => (row) => {
      const text = row[name];
      const seq = row[seqField];
      if (text === null || text === undefined || !Number.isSafeInteger(seq)) return row;
      return freeze({
        ...row,
        [name]: null,
        [`${name}Bytes`]: referencedBytes(text),
        [`${name}Ref`]: freeze({ kind, seq }),
      });
    };
    payload._goals = family(payload._goals, own('objective', 'goal.version_defined', 'definedEvent'));
    payload._goalHeads = family(payload._goalHeads, own('objective', 'goal.version_defined', 'definedEvent'));
    payload._plans = family(payload._plans, own('nodes', 'plan.version_proposed', 'proposedEvent'));
    payload._planHeads = family(payload._planHeads, own('nodes', 'plan.version_proposed', 'proposedEvent'));
    payload._tasks = family(payload._tasks, own('brief', 'task.created', 'createdEvent'));
    // #465(1): a completed web command's ANSWER body, inside the outcome the row keeps. Measured on
    // the clone, `_webCommands` was 39 206 146 B of the 288 871 406-byte body and the whole of it
    // was `outcome.body`; the request content is not a copy at all (the row carries `requestDigest`
    // and a `requestAxes` digest map — the ledger deliberately carries no request content), so the
    // answer body is the one thing to point at. The row keeps the OUTCOME a reader decides on
    // (`httpStatus`) and the pair names the terminal ledger row — the kind its own `status` was
    // minted from in the fold. An outcome with no body has nothing to reference and is passed on.
    payload._webCommands = family(payload._webCommands, (row) => {
      const outcome = row.outcome;
      const seq = row.completedEvent;
      if (outcome === null || typeof outcome !== 'object' || Array.isArray(outcome)
        || outcome.body === null || outcome.body === undefined || !Number.isSafeInteger(seq)) return row;
      const { body, ...head } = outcome;
      return freeze({
        ...row,
        outcome: freeze({
          ...head,
          body: null,
          bodyBytes: referencedBytes(body),
          bodyRef: freeze({
            kind: row.status === 'failed' ? 'web.command_failed' : 'web.command_completed', seq,
          }),
        }),
      });
    });
  }

  /** Issue #465: the ONE reader of a projection REFERENCE (`{kind, seq}`). It answers the value the
   * ledger row the pair names holds — a composed brief, a web command's response body, a spill's
   * bytes, a task brief, a goal's objective, a plan's nodes — read from `_events`, which carries the
   * FULL history (archived rows included; compaction only decides what the checkpoint caches), so a
   * reference resolves in O(1) and never needs a disk read. A pair that names an absent row, or a
   * row of another kind, resolves to null: a reference that cannot be read is absence, never a
   * guessed value. The kind's reader is the PROJECTION_REFERENCES row — never a second grammar. */
  _projectionReferenceValue(reference) { return coordinationLedger._projectionReferenceValue(this._events, reference); }

  /** Issue #465(4): the body's rendering, INVERTED — the family-by-family half of the open
   * (`coordination-replay.mjs` `_adoptProjectionCheckpoint` drives it). The checkpoint carries the
   * projection, so every reference the body minted (`_boundedSwarmProjection`,
   * `_referencedSecondCopies`) is resolved back through `_projectionReferenceValue` before the
   * families are installed as state: the store a checkpoint serves must answer exactly what a cold
   * replay answers, and a reader that read `task.brief`, a goal's `objective`, a plan's `nodes` or a
   * web command's `outcome.body` must find the text, not the pair.
   *
   * The marker is the pair the WRITE minted, not the pair the FOLD mints: a `_spills` row carries
   * `bodyRef` from the fold (its reader composes the bytes), so a row whose field is `null` and
   * whose pair has no `<field>Bytes` beside it is passed through untouched, and a participant row's
   * `briefBytes`/`briefRef` (the fold's own reach) stays on the row while only `brief` is put back.
   * Rendering is memoized BY ROW IDENTITY, exactly as the write's rendering is, so the alias a
   * family and its head map share survives: `_goalHeads` keeps naming the same row as `_goals`.
   *
   * A pair that does not resolve names text the ledger does not carry — the body and the ledger
   * disagree — so the caller abandons the adoption and folds the ledger instead (never a silent
   * absence, never a guessed value). */
  _materializedProjectionCheckpoint(payload, dictionaryFields) { return coordinationLedger._materializedProjectionCheckpoint(this, payload, dictionaryFields); }

  /** Issue #465(4): the swarm family's half of the inversion. Two facts the body cannot carry by
   * itself are put back:
   *   • a participant row's `brief` — rendered back from `briefRef`, whose `briefBytes`/`briefRef`
   *     pair is the FOLD's own reach and stays on the row (`keepPair`);
   *   • the swarm row's null-prototype DICTIONARIES — the fold builds them with an empty prototype so
   *     a key named `__proto__` is data rather than a prototype write, and `v8`'s round trip flattens
   *     every container to a plain object. The names are the writer's own reading of the body it
   *     persisted (`nullPrototypeFields` below, recorded on the envelope), so the restore re-creates
   *     exactly the dictionaries the fold had — never a hand-typed list of them. */
  _materializedSwarmProjection(swarms, render, dictionaryFields) { return coordinationLedger._materializedSwarmProjection(swarms, render, dictionaryFields); }


  /** Issue #449: the ONE writer of the projection checkpoint. It returns the bytes it MEASURED
   * (`bytes`), whether the checkpoint was written (`written`), and whether those bytes ARE a
   * measurement (`measured` — false only for a poisoned projection, which is refused before
   * anything is serialized) — the serialize is paid once and the exact bytes are reused for the
   * envelope, so no caller measures the same projection twice. `costBound` (bytes) is the declared
   * ceiling a housewriting caller judges the checkpoint's own cost against: the measurement is the
   * cost, so the ceiling is applied HERE, on the bytes the write would actually persist, and a
   * checkpoint past it is reported (never written) with its measured size. The operator's
   * `compact()` calls this with no ceiling — it is not housewriting. */
  _writeProjectionCheckpoint({ costBound = null } = {}) { return coordinationLedger._writeProjectionCheckpoint(this, { costBound }); }

  /** Issue #449: the checkpoint write as STEPS that yield between their bounded stretches — the same
   * seam the replay already hands the loop back on (`coordination-replay.mjs` `_loadRun` drives this
   * generator with `yield*`, so the async open yields a macrotask between the encode, the persist and
   * the fsync while the synchronous constructor drains it back-to-back). Without the seam an open on
   * a real ledger writes its cache as ONE synchronous stretch — measured at 665ms for a 58MB cache
   * over a 150 000-row ledger — which is the open-liveness law #351 lane 4 pinned (the loop must beat
   * through the open at any ledger size), and the reason a stop could never pay this write either.
   *
   * It returns the bytes it MEASURED (`bytes`), whether the checkpoint was written (`written`), and
   * whether those bytes ARE a measurement (`measured` — false only for a poisoned projection, which
   * is refused before anything is serialized) — the serialize is paid once and the exact bytes are
   * reused for the envelope, so no caller measures the same projection twice. `costBound` (bytes) is
   * the declared ceiling a housewriting caller judges the checkpoint's own cost against: the
   * measurement is the cost, so the ceiling is applied HERE, on the bytes the write would actually
   * persist, and a checkpoint past it is reported (never written) with its measured size. The
   * operator's `compact()` calls this with no ceiling — it is not housewriting. */
    _projectionCheckpointWriteSteps({ costBound = null } = {}) { return coordinationLedgerWrites._projectionCheckpointWriteSteps(this, { costBound }); }

  /** Issue #465(1): WHICH family the measured projection's bytes belong to. The write above judges
   * the checkpoint on ONE number — the serialized projection — and a reader of that number could
   * not see where it came from (the issue's own guess-list ran from briefs to tool rows while the
   * measured answer was the parsed window). This reads the SAME payload through the SAME
   * serializer, once per family, in the payload's own key order (never a hand-typed list of
   * families: it iterates the object it was handed), and reports three measured numbers:
   *
   *   `bytesByFamily[f]`       f's OWN serialization — what the family costs when it is the thing
   *                            being encoded (measured on the clone: `_events` 180.16 MB of the
   *                            288.87 MB projection, `_webCommands` 39.21 MB, `_swarms`
   *                            18.04 MB, `_byKey` 181.83 MB — the last one a TRAP the breakdown
   *                            exists to expose, see below);
   *   `projectionBaselineBytes` the framing the whole body pays for its own key set (the payload
   *                            with every family emptied — hundreds of bytes, not a share);
   *   `sharedBytes`            what the families' own serializations count MORE THAN ONCE. `v8`
   *                            encodes a repeated OBJECT as a back-reference, so a family that
   *                            re-references an earlier family's objects is nearly free in the
   *                            stream while its own serialization is not: `_planHeads`/`_goalHeads`
   *                            alias the plans and goals. The breakdown reports it rather than
   *                            hiding it, and the identity it closes on is exact:
   *
   *       Σ bytesByFamily + projectionBaselineBytes − sharedBytes === bytes
   *
   * Issue #465(4): the two families the body does NOT carry (`_events`, `_byKey`) are reported
   * beside that sum, never inside it — the identity above is the BODY's own accounting, and the
   * ledger it points at is not. `rebuiltFamilies` names what the successor rebuilds them from: the
   * rows and the durable bytes of the file that holds them (`_events`, read in O(1) — the write
   * already holds the ledger bytes, so no history is serialized to measure it) and the index's key
   * count with ZERO bytes of its own (`_byKey` indexes the very rows `_events` owns, so counting it
   * as bytes is the double count this row exists to refuse). Every row object is therefore
   * attributed exactly once. */
  _projectionByteBreakdown(payload, projectionBytes, rebuilt) { return coordinationLedger._projectionByteBreakdown(this, payload, projectionBytes, rebuilt); }

  /** Issue #465(1): the payload's own shape with every family EMPTIED — the key set and its
   * container headers, nothing else. Derived from the object it is handed (each family keeps its
   * own container kind), so the baseline moves with the projection's shape instead of a literal. */
  _emptyProjectionShape(payload) { return coordinationLedger._emptyProjectionShape(payload); }

  /** Issue #351/#449: a clean release writes the projection checkpoint while the checkpoint is
   * still a BOUNDED record. The checkpoint is housekeeping (#229: crash-recovery acceleration; the
   * ledger stays authoritative), but `_writeProjectionCheckpoint` pays `readFileSync` of the whole
   * ledger, two digests over it, and one `v8.serialize` of the ENTIRE projection — including the
   * parsed `_events` cache, a second copy of the same ledger — synchronously on the main thread. On
   * the stop path that cost is proportional to the projection (and to a live campaign's projection,
   * which is larger than the ledger it folds): a SIGTERM drain that must serve an operator's
   * deadline may not spend it re-encoding history nobody asked it to cache.
   *
   * The bound is DERIVED from the checkpoint's OWN cost (#449): the ceiling is the registry's row
   * `checkpoint.projection_bytes`, and the quantity judged against it is the serialized projection
   * measured at write time — never the ledger's row count, which is not the cache's cost. The
   * deferred append-path checkpoint and the operator's `compact()` write are untouched: neither is
   * a lifecycle path (`compact()` is not housewriting and keeps its unconditional write). */
  _releaseProjectionCheckpoint() { return coordinationLedger._releaseProjectionCheckpoint(this); }

  /** Issue #449: the one bound every HOUSEWRITING checkpoint obeys (#229's deferred append-path
   * write and #351's release write): housekeeping may only ever re-encode a checkpoint whose OWN
   * cost is bounded — the bytes of its serialized projection, against the registry's declared
   * ceiling for that quantity (`checkpoint.projection_bytes`; both ceilings that apply are named on
   * the outcome, and the row count is reported beside them).
   *
   * The ledger's bytes are EVIDENCE on the outcome (`ledgerBytes`), never the gate. The pre-#449
   * bound applied the wake-replay FRAME's row ceiling to the ledger's row count, and lane 1 replaced
   * that row count with the cost ceiling while keeping the window's ledger bytes as an O(1)
   * early-out — but the projection is not the ledger's size on either side of the ratio, so the
   * bigger the history the LESS likely the checkpoint: the live residents skipped every release on
   * the ledger's bytes alone, no stop could write a cache, and every restart replayed the whole
   * ledger (#449: 65 s of republish on the primary). A projection past the ceiling is skipped WITH
   * its measured size, and the open that follows writes the cache the next open needs
   * (`_openCheckpointRefresh`).
   *
   * The deferred path is the one caller on the resident's own loop, so it reuses the last
   * measurement while the window has only grown since it: a body already measured past the ceiling
   * is not serialized a second time to re-derive the same verdict (issue #465(4) removed the rows
   * from the body, so what grows it is the families a fold writes, not the ledger's row count — the
   * reuse is safe either way because it only ever DECLINES to measure: nothing is written on a
   * reused verdict, and the next release, which measures unconditionally, re-derives it). The
   * verdict is dropped with the projection it judged (`_resetProjection`) and is ignored whenever
   * the window has fallen under the row count it was taken at (#223's `compact()` trims the window). */
  _boundedCheckpointWrite(phase) { return coordinationLedger._boundedCheckpointWrite(this, phase); }

  /** Issue #449: the fields every checkpoint outcome names — the seq the carried projections cover
   * (`coversSeq`, issue #465(4): the absolute ledger seq rows 1..coversSeq the successor does NOT
   * fold), the WINDOW's row count, the ledger's own bytes (evidence on the row, never the gate), the
   * replay frame's row ceiling and the checkpoint's own cost ceiling in bytes. */
  _checkpointOutcomeFields() { return coordinationLedger._checkpointOutcomeFields(this); }

  /** Issue #465(1): the measured breakdown a checkpoint row carries — the three numbers
   * `_projectionByteBreakdown` read from the SAME serialize the cost ceiling judged, and the two
   * ledger families' rebuild facts. Reported on every outcome that reached a measurement (a write,
   * a skip past the ceiling, or the deferred path's reused verdict, whose row already names the row
   * count it was taken at). Empty before the first measurement of a projection, and empty on a
   * poisoned projection's row: nothing was encoded, so there is nothing to break down. */
  _checkpointByteFields() { return coordinationLedger._checkpointByteFields(this._checkpointByteBreakdown); }

  /** Issue #449: WHICH opens write the cache the next open needs — the store's own rule, and the
   * ONE checkpoint write that is NOT judged against the housewriting ceiling. An open reaches here
   * when it could not serve itself from the checkpoint on disk and has just folded the projection by
   * replaying: `absent` (there is no cache at all), `stale_shape` (the envelope was written by
   * another projection shape or commit), `stale_authority` (another authority digest — its carried
   * projection was folded under other cards and policies) and `stale_ledger` (issue #465(4): the
   * checkpoint claims rows the ledger does not hold) all replay the ledger and land here, so the NEXT
   * open is served by a cache that is this build's own. `valid` needs nothing, `corrupt` keeps its
   * landed remedy (#397: a repair, never a rewrite over the refused bytes), and an empty ledger has
   * nothing to cache.
   *
   * Its bound is the load that just completed: the open has already parsed and folded exactly these
   * rows, so the write is the same order of work behind a load that holds no stop's deadline — and it
   * is the only write that makes the NEXT open bounded, which is what #449's live proof asks for (a
   * restart after a landing replays once, not on every restart). The write's own stretches yield
   * through the SAME seam the replay does, so the open keeps beating (see
   * `_projectionCheckpointWriteSteps`); the row reports the measured bytes and `refreshed: true`, and
   * a failure costs the open nothing. Returns null when this open owes nothing. */
  *_openCheckpointRefresh(state) { return yield* coordinationLedger._openCheckpointRefresh(this, state); }

  /** Issue #449: give back the lease an open minted for its own housekeeping write. The file is
   * removed only while it still names THIS store's token, pid and process start — a lease another
   * writer claimed inside the window is never deleted — and `_writerLeaseRequired` returns to false,
   * so a later write claims rather than refuses: exactly the posture the open had before it wrote. */
    _dropBorrowedWriterLease() { return coordinationLedgerWrites._dropBorrowedWriterLease(this); }

  /** Issue #449(3): a checkpoint write that dies mid-flight leaves its temp file behind — the
   * atomic rename never ran, and nothing ever removed it (the observed resident carried a 135 MB
   * `.projection.checkpoint.<uuid>` beside its live checkpoint from a crash a month earlier). The
   * open sweeps them and names what it swept: the writer lease makes the store the only author of
   * these names, so a temp file an open can see is one whose writer is gone. */
    _sweepProjectionCheckpointTemps() { return coordinationLedgerWrites._sweepProjectionCheckpointTemps(this); }

  /** Issue #351: what the last clean release did with the projection checkpoint, and why. `null`
   * until a release has decided; the stop path records this row so a skipped cache is never a
   * silent one. */
  checkpointReleaseState() { return coordinationLedger.checkpointReleaseState(this._checkpointRelease); }

  /** Issue #351(2): arm the resident's stop outcome, which the RELEASE then mints.
   *
   * The release is a drain's last act and the writer authority it needs exists only until it
   * returns — so the outcome of a stop that CONVERGED cannot be written after the fact by the host
   * that observed it (`_assertWriterLease` refuses an append once the lease is dropped). The
   * release mints it instead, carrying the checkpoint decision it has just made, because a release
   * that returns IS the converged stop. Armed by the deployment that owns the stop; a store whose
   * release is not a resident's stop is never armed and writes only the checkpoint it always did.
   *
   * Issue #351's stage clock rides the same arming, but as a READER rather than a snapshot: the
   * stages that follow the arming — the fleet drain the release runs inside, the publication
   * withdrawal after it — are exactly the ones a slow stop has to name, so only the mint knows
   * when the timeline ended. Optional; a stop that marks no stage still writes its outcome. */
  armHostStopOutcome(fields) {
    const keys = ['actor', 'key', 'state'];
    const stages = fields?.stages ?? null;
    // Issue #450: the resources the stop released ({workerId, resource, how}) are read at the
    // mint the same way the stage timeline is — a reader the drain keeps current until the release.
    const released = fields?.released ?? null;
    // Issue #472: the workers the stop STOPPED WAITING ON ({workerId, attempt, alive}) are read at
    // the mint too, and minted BESIDE `released` — an abandoned worker is not a release and never
    // rides a release row.
    const abandoned = fields?.abandoned ?? null;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)
      || Object.keys(fields).sort().join('\0')
        !== [...keys, ...(stages === null ? [] : ['stages']), ...(released === null ? [] : ['released']),
          ...(abandoned === null ? [] : ['abandoned'])].sort().join('\0')
      || keys.some((name) => typeof fields[name] !== 'string' || fields[name].length === 0)
      || (stages !== null && typeof stages !== 'function')
      || (released !== null && typeof released !== 'function')
      || (abandoned !== null && typeof abandoned !== 'function')) {
      throw new TypeError('host stop outcome arming is invalid');
    }
    this._hostStopOutcome = freeze({ ...fields });
    return true;
  }

  _mintHostStopOutcome() { return coordinationLedger._mintHostStopOutcome(this); }

  _restoreProjectionCheckpoint(raw, base = 0) {
    return coordinationReplay._restoreProjectionCheckpoint(this, raw, base);
  }

  _resetProjection() { return coordinationLedger._resetProjection(this); }

  _configureAdvisoryFeedCards(cards) { return coordinationAdmission._configureAdvisoryFeedCards(cards); }
  _reloadProjection() {
    return coordinationReplay._reloadProjection(this);
  }

  _ledgerMatchesLoadedProjection() { return coordinationLedger._ledgerMatchesLoadedProjection(this); }

    claimWriterLease() { return coordinationLedgerWrites.claimWriterLease(this); }

  _assertWriterLease() { return coordinationAdmission._assertWriterLease(this); }

  /** Lease ownership only — deliberately WITHOUT the poison and sync-failure gates: the
   * quarantine verb (#290) is those gates' own repair and must stay reachable while they hold. */
  _assertLeaseOwnership() { return coordinationAdmission._assertLeaseOwnership(this); }

  /** Issue #290: schedule the ledger's group-commit — one fsync per drain tick coalesces any
   * number of appends, keeping the authoritative ledger at least as durable as the fsynced
   * housekeeping artifacts. The accepted residual window (appends since the last drain) is
   * documented beside replay's truncated_tail refusal. */
  _scheduleLedgerSync() { return coordinationLedger._scheduleLedgerSync(this); }

  _flushLedgerSync() { return coordinationLedger._flushLedgerSync(this); }

  /** Issue #290: the poison is startup truth — readable beside the projection it contradicts. */
  projectionPoison() { return coordinationLedger.projectionPoison(this._projectionPoison); }

  /** Issue #290: the durable repair ledger, readable through the store like every other
   * housekeeping artifact. */
  quarantineEntries() {
    return coordinationReplay.quarantineEntries(this.root);
  }

  /** Issue #290: the supported repair verb for a poisoned store. Names the offending seq (the
   * poison itself names it — a mismatch refuses typed), records the quarantine durably beside
   * the ledger (never a hand edit of events.jsonl), clears the poison, and resumes authority.
   * Replay skips exactly this seq's fold after any restart, so the repair survives. */
  quarantineProjectionEvent(seq, { reason, actor } = {}) { return coordinationLedger.quarantineProjectionEvent(this, seq, { reason, actor }); }

  _poisonProjection(event, error) { return coordinationLedger._poisonProjection(this, event, error); }

    releaseWriterLease(options = undefined) { return coordinationLedgerWrites.releaseWriterLease(this, options); }

  _segmentDirectory() { return coordinationLedger._segmentDirectory(this); }

  _segmentFilePath(digest) { return coordinationLedger._segmentFilePath(this, digest); }

    _cleanupSegmentTemps() { return coordinationLedgerWrites._cleanupSegmentTemps(this); }

    _writeSegment(digest, bytes) { return coordinationLedgerWrites._writeSegment(this, digest, bytes); }

    _writeSegmentIndex(index) { return coordinationLedgerWrites._writeSegmentIndex(this, index); }

  // #223 replay path — load segments (index) + window. The index is a cache: the immutable
  // content-addressed segment files are the durable archive, so an absent or stale index is
  // rebuilt by scanning them. Returns { archivedThroughSeq, segments: [{fromSeq, throughSeq,
  // digest, bytes}] } — the archived prefix coverage the LEDGER's own coverage requires.
  _loadSegmentState(raw) {
    return coordinationReplay._loadSegmentState(this, raw);
  }

  // Issue #223 — the operator verb that lands the compaction seam. `beforeSeq` is the first
  // seq that stays LIVE; the terminal prefix [1, beforeSeq) is archived into a
  // content-addressed segment, the live events.jsonl is rewritten to the window, the
  // checkpoint is rebuilt for the window, and the segment index records the archive. The
  // in-memory projection is UNTOUCHED (it already spans the full history), so no waiter or
  // reader observes a discontinuity. Deciding which waves are terminal and picking the cut
  // is the cadence row's policy; this verb takes the operator's cut as given.
  //
  // Crash ordering (single writer, verb serialized by the writer lease): segment file →
  // segment index → ledger rewrite → checkpoint. The segment file lands before the ledger
  // truncates, so the archived events always exist on disk before the live window loses
  // them; an index write that committed without the ledger rewrite (or vice versa) is
  // reconciled by _loadSegmentState on the next open.
    compact({ beforeSeq }) { return coordinationLedgerWrites.compact(this, { beforeSeq }); }
  _load() {
    return coordinationReplay._load(this);
  }
  /** Issue #290: the prospective fold gate for the pass-through recording kinds. A payload the
   * replay fold would refuse is refused typed here — BEFORE _appendFile — so a malformed event
   * can never reach disk and poison replay. mcp.audit/web.audit own no fold state but still
   * require a plain-object payload (the audit GAP: these lanes accepted any shape); the
   * driver.recorded kinds the fold actively validates are checked with the fold's own rule. */
  _validateRecordedPayload(kind, payload) { return coordinationAdmission._validateRecordedPayload(kind, payload); }

  _append(kind, payload, { actor, key }, fixedTs = null, beforeWrite = null) { return coordinationLedger._append(this, kind, payload, { actor, key }, fixedTs, beforeWrite); }

  _appendBatch(entries, batchKind = null, beforeWrite = null) { return coordinationLedger._appendBatch(this, entries, batchKind, beforeWrite); }

  _notifyAppend() { return coordinationLedger._notifyAppend(this); }
  _taskTopologyHint(event) {
    return coordinationInternals._taskTopologyHint(this, event);
  }

  _taskTopologyFailure(message, code, integrity) { return coordinationAdmission._taskTopologyFailure(message, code, integrity); }

  _validateTaskTopology(fields, hint = null, integrity = false) { return coordinationAdmission._validateTaskTopology(this, fields, hint, integrity); }

  previewTaskTopology(fields, hint = null) { return coordinationAdmission.previewTaskTopology(this, fields, hint); }

  taskTopologyPolicy() { return coordinationLedger.taskTopologyPolicy(this._taskTopologyPolicy); }
  repositoryId() {
    return coordinationInternals.repositoryId(this._repoId);
  }

  runLineagePolicy() { return coordinationLedger.runLineagePolicy(this._runLineagePolicy); }

  runLineagePolicyDigest() { return coordinationLedger.runLineagePolicyDigest(this._runLineagePolicy); }

  _runLineageFailure(message, code, integrity = false) { return coordinationAdmission._runLineageFailure(message, code, integrity); }

  _normalizeRunOrchestratorLeaseRequest(fields, integrity = false) { return coordinationAdmission._normalizeRunOrchestratorLeaseRequest(this, fields, integrity); }

  _deriveRunOrchestratorLeasePayload(request, event, integrity = false) { return coordinationAdmission._deriveRunOrchestratorLeasePayload(this, request, event, integrity); }

  _validateRunOrchestratorLeaseIssued(payload, event, integrity = false) { return coordinationAdmission._validateRunOrchestratorLeaseIssued(this, payload, event, integrity); }

  // The lease revocation idempotency key accepts either the recursive-lineage form
  // (`run.orchestrator_lease.revoke:<id>`) or the settlement-ritual form
  // (`run.orchestrator_lease_revoked:<id>`, rule 16b's revoke step) — the same leaseId is bound
  // either way, so the settlement promote command's revoke replays exactly like a manual revoke.
  _isRunOrchestratorLeaseRevokeKey(key, leaseId) { return coordinationAdmission._isRunOrchestratorLeaseRevokeKey(key, leaseId); }

  _validateRunOrchestratorLeaseRevoked(payload, event, integrity = false) { return coordinationAdmission._validateRunOrchestratorLeaseRevoked(this, payload, event, integrity); }

  _activeRunOrchestratorLease(auth, now = this._clock()) { return coordinationLedger._activeRunOrchestratorLease(this, auth, now); }
  _runIdentityHasEffects(runId, ignoredSeq = null) {
    return coordinationInternals._runIdentityHasEffects(this, runId, ignoredSeq);
  }

  _deriveRunLineagePayload(request, lease, ignoredSeq = null, integrity = false) { return coordinationAdmission._deriveRunLineagePayload(this, request, lease, ignoredSeq, integrity); }

  _validateRunLineageAdmission(payload, event, integrity = false) { return coordinationAdmission._validateRunLineageAdmission(this, payload, event, integrity); }

  issueRunOrchestratorLease(fields, auth) { return coordinationLedger.issueRunOrchestratorLease(this, fields, auth); }

    revokeRunOrchestratorLease(fields, auth) { return coordinationLedgerWrites.revokeRunOrchestratorLease(this, fields, auth); }
  runOrchestratorLease(leaseId) {
    return coordinationInternals.runOrchestratorLease(this._runOrchestratorLeases, leaseId);
  }

  activeRunOrchestratorLeaseForSession(fields) { return coordinationLedger.activeRunOrchestratorLeaseForSession(this, fields); }

  admitRunLineage(fields, auth) { return coordinationAdmission.admitRunLineage(this, fields, auth); }
  runLineage(runId) {
    return coordinationInternals.runLineage(this._runLineages, runId);
  }
  runChildren(runId) {
    return coordinationInternals.runChildren(this, runId);
  }
  runDescendants(runId) {
    return coordinationInternals.runDescendants(this._runLineages, runId);
  }

  authorizeRunOrchestratorCommand(fields, auth) { return coordinationAdmission.authorizeRunOrchestratorCommand(this, fields, auth); }
  taskTopologyNode(taskId) {
    return coordinationInternals.taskTopologyNode(this._taskTopologies, taskId);
  }
  taskTopology(runId = null) {
    return coordinationInternals.taskTopology(this, runId);
  }
  _recoveryBatchIdentity(kind, events) {
    return coordinationReplay._recoveryBatchIdentity(kind, events);
  }
  _validateRecoveryReplayTransactions() {
    return coordinationReplay._validateRecoveryReplayTransactions(this);
  }

  _goalPlanFailure(message, code, integrity = false) { return coordinationAdmission._goalPlanFailure(message, code, integrity); }

  _goalScopeKey(repoId, runId) { return coordinationLedger._goalScopeKey(repoId, runId); }
  _goalVersionKey(goalId, version) { return coordinationLedger._goalVersionKey(goalId, version); }
  _planVersionKey(planId, version) { return coordinationLedger._planVersionKey(planId, version); }
  _planHeadKey(goal) { return coordinationLedger._planHeadKey(goal); }
  _planNodeKey(planId, version, nodeKey) { return coordinationLedger._planNodeKey(planId, version, nodeKey); }
  _validateGoalPlanReplayTransactions() {
    return coordinationReplay._validateGoalPlanReplayTransactions(this);
  }

  _historicalTaskState(taskId, throughSeq) { return coordinationLedger._historicalTaskState(this._events, taskId, throughSeq); }

  _validPreservedResumeAttestation(value) {
    return coordinationReplay._validPreservedResumeAttestation(value);
  }

  _workflowRevisionAuthority(plan, node, throughSeq = this._events.length, integrity = false) { return coordinationLedger._workflowRevisionAuthority(this, plan, node, throughSeq, integrity); }

  _validateGoalPlanDispatchPair(dispatchEvent, taskEvent, integrity = false, recoveryClaimEvent = null) {
    return coordinationReplay._validateGoalPlanDispatchPair(this, dispatchEvent, taskEvent, integrity, recoveryClaimEvent);
  }
  _planRecoveryRequestFields(createdPayload) {
    return coordinationReplay._planRecoveryRequestFields(createdPayload);
  }
  _recoveryAttributionFromClaim(claimedPayload) {
    return coordinationReplay._recoveryAttributionFromClaim(claimedPayload);
  }
  _normalizedPlanRecoveryCreatedPayload(fields, priorTask) {
    return coordinationReplay._normalizedPlanRecoveryCreatedPayload(this, fields, priorTask);
  }

  _validateGoalPlanRecoveryTriple(dispatchEvent, createdEvent, claimedEvent, integrity = false) {
    return coordinationReplay._validateGoalPlanRecoveryTriple(this, dispatchEvent, createdEvent, claimedEvent, integrity);
  }
  _recoveryFailure(message, code, integrity) {
    return coordinationReplay._recoveryFailure(message, code, integrity);
  }
  _verifiedRecoveryPrior(task, integrity = false) {
    return coordinationReplay._verifiedRecoveryPrior(this, task, integrity);
  }
  _recoveryAttemptFailure(message, code, integrity = false) {
    return coordinationReplay._recoveryAttemptFailure(message, code, integrity);
  }
  _normalizeRecoveryAttemptAdmission(payload, integrity = false) {
    return coordinationReplay._normalizeRecoveryAttemptAdmission(this, payload, integrity);
  }
  _normalizeRecoveryAttemptCompletion(payload, integrity = false) {
    return coordinationReplay._normalizeRecoveryAttemptCompletion(this, payload, integrity);
  }

  _validateRecoveryAttemptAdmissionPayload(payload, event, integrity = false) {
    return coordinationReplay._validateRecoveryAttemptAdmissionPayload(this, payload, event, integrity);
  }
  _validateRecoveryAttemptCompletionPayload(payload, event, integrity = false) {
    return coordinationReplay._validateRecoveryAttemptCompletionPayload(this, payload, event, integrity);
  }
  _normalizedRecoveryCreatedPayload(fields, priorTask) {
    return coordinationReplay._normalizedRecoveryCreatedPayload(fields, priorTask);
  }
  _normalizedRecoveryClaimedPayload(createdPayload, attribution) {
    return coordinationReplay._normalizedRecoveryClaimedPayload(createdPayload, attribution);
  }

  _validateRecoverySessionRequest(sessionRequest, priorTask, fail) {
    return coordinationReplay._validateRecoverySessionRequest(sessionRequest, priorTask, fail);
  }

  _validateRecoveryRefinementRequest(fields, attribution, priorTask, integrity = false) {
    return coordinationReplay._validateRecoveryRefinementRequest(this, fields, attribution, priorTask, integrity);
  }
  _validateRecoveryRefinementPair(createdEvent, claimedEvent, integrity = false) {
    return coordinationReplay._validateRecoveryRefinementPair(this, createdEvent, claimedEvent, integrity);
  }

  _validateRecoveryContinuationPayload(p, event, integrity = false) {
    return coordinationReplay._validateRecoveryContinuationPayload(this, p, event, integrity);
  }
  _validateRecoveryDispositionPayload(p, event, integrity = false) {
    return coordinationReplay._validateRecoveryDispositionPayload(this, p, event, integrity);
  }

  _representationFailure(message, code = 'representation_integrity', integrity = false) { return coordinationAdmission._representationFailure(message, code, integrity); }

  _representationRequest(request, auth, integrity = false, requireLive = true) { return coordinationAdmission._representationRequest(this, request, auth, integrity, requireLive); }

  _representationEvidence(evidence, requestState, source, event, integrity = false) { return coordinationLedger._representationEvidence(this, evidence, requestState, source, event, integrity); }

  _representationSource(source, requestState, evidence, event, integrity = false) { return coordinationAdmission._representationSource(this, source, requestState, evidence, event, integrity); }

  _representationArtifactManifest(id, expected, event, integrity = false) { return coordinationLedger._representationArtifactManifest(this, id, expected, event, integrity); }

  _representationGraphTemplate(fields, auth, integrity = false, requireLive = true) { return coordinationAdmission._representationGraphTemplate(this, fields, auth, integrity, requireLive); }

  _validateRepresentationNamespaces(derived, integrity = false) { return coordinationAdmission._validateRepresentationNamespaces(this, derived, integrity); }

  _validateRepresentationPayload(payload, event, integrity = false) { return coordinationAdmission._validateRepresentationPayload(this, payload, event, integrity); }

  _validateRunSealPayload(p, eventSeq, integrity = false) { return coordinationAdmission._validateRunSealPayload(this, p, eventSeq, integrity); }

  _validateRouteObservationPayload(p, event, integrity = false) { return coordinationAdmission._validateRouteObservationPayload(this, p, event, integrity); }

  _validateReuseDecisionPayload(p, event, integrity = false) { return coordinationAdmission._validateReuseDecisionPayload(this, p, event, integrity); }

  _reusePolicyTargets(repoId, policyHash, ceilings = {}) { return coordinationLedger._reusePolicyTargets(this, repoId, policyHash, ceilings); }

  _validateReusePolicyPayload(p, event, integrity = false) { return coordinationAdmission._validateReusePolicyPayload(this, p, event, integrity); }

  _guardFromRiskPayload(p, event) { return coordinationAdmission._guardFromRiskPayload(this, p, event); }

  _reuseRiskTargets(coordinate, snapshot) { return coordinationLedger._reuseRiskTargets(this, coordinate, snapshot); }

  _validateReuseRiskPayload(p, event, integrity = false) { return coordinationAdmission._validateReuseRiskPayload(this, p, event, integrity); }
  _ttlTarget(decision) {
    return coordinationInternals._ttlTarget(this, decision);
  }

  _validateReuseTtlPayload(p, event, integrity = false) { return coordinationAdmission._validateReuseTtlPayload(this, p, event, integrity); }

  _providerCoordinateKey(repoId, coordinate) { return coordinationLedger._providerCoordinateKey(repoId, coordinate); }
  _providerSourceKey(repoId, providerId, sourceEpoch) { return coordinationLedger._providerSourceKey(repoId, providerId, sourceEpoch); }

  _providerPendingFor(repoId, coordinate) { return coordinationLedger._providerPendingFor(this, repoId, coordinate); }
  _providerAdverseCeilings(repoId) {
    return coordinationInternals._providerAdverseCeilings(this._reusePolicyTransitions, repoId);
  }

  _providerAdverseTargets(repoId, coordinate, ceilings = this._providerAdverseCeilings(repoId)) { return coordinationLedger._providerAdverseTargets(this, repoId, coordinate, ceilings); }
  _providerContribution(row, processing, policy) {
    return coordinationInternals._providerContribution(row, processing, policy);
  }

  _providerAggregate(repoId, coordinate, contribution, policy) { return coordinationLedger._providerAggregate(this, repoId, coordinate, contribution, policy); }

  _providerAggregateTarget(repoId, coordinate) { return coordinationLedger._providerAggregateTarget(this, repoId, coordinate); }

  _validateProviderDeliveryPayload(p, event, integrity = false) { return coordinationAdmission._validateProviderDeliveryPayload(this, p, event, integrity); }

  _validateProviderReconciliationPayload(p, event, integrity = false) { return coordinationAdmission._validateProviderReconciliationPayload(this, p, event, integrity); }

  _validateProviderDeferralPayload(p, event, integrity = false) { return coordinationAdmission._validateProviderDeferralPayload(this, p, event, integrity); }

  _validateProviderGreenPayload(p, event, integrity = false) { return coordinationAdmission._validateProviderGreenPayload(this, p, event, integrity); }

  _validateProviderAdversePayload(p, event, integrity = false) { return coordinationAdmission._validateProviderAdversePayload(this, p, event, integrity); }
  _setKnowledgeNode(event, id, value) {
    return coordinationInternals._setKnowledgeNode(this, event, id, value);
  }
  _setKnowledgeEdge(event, id, value) {
    return coordinationInternals._setKnowledgeEdge(this, event, id, value);
  }

  _knowledgeVersionsAt(history, observedSeq, observedAt) { return coordinationLedger._knowledgeVersionsAt(history, observedSeq, observedAt); }

  _validateFleetDrainAdmission(p, event, integrity = false) { return coordinationAdmission._validateFleetDrainAdmission(p, event, integrity); }

  _validateFleetDrainCompletion(p, event, integrity = false) { return coordinationAdmission._validateFleetDrainCompletion(this, p, event, integrity); }

  _validateFleetDrainDisposition(p, event, integrity = false) { return coordinationAdmission._validateFleetDrainDisposition(this, p, event, integrity); }

  _runStopContextTargets(targetRunIds) { return coordinationLedger._runStopContextTargets(this, targetRunIds); }

  _runStopTargets(runId, throughSeq = this._events.length, contextVersion = 3, scoped = this._runLineagePolicy !== null) { return coordinationLedger._runStopTargets(this, runId, throughSeq, contextVersion, scoped); }

  _validSessionPreservationReceipt(receipt, allowHistorical = false) { return coordinationLedger._validSessionPreservationReceipt(receipt, allowHistorical); }
  _validPreservedContinuationReceipt(receipt) {
    return coordinationReplay._validPreservedContinuationReceipt(receipt);
  }

  _validateRunControlAdmission(p, event, integrity = false) { return coordinationAdmission._validateRunControlAdmission(this, p, event, integrity); }

  _validateRunControlEffect(p, event, integrity = false) { return coordinationAdmission._validateRunControlEffect(this, p, event, integrity); }

  _validateRunControlProviderAck(p, event, integrity = false) { return coordinationAdmission._validateRunControlProviderAck(this, p, event, integrity); }

  _validateRunControlSettlement(p, event, integrity = false) { return coordinationAdmission._validateRunControlSettlement(this, p, event, integrity); }

  _validateRunStopAdmission(p, event, integrity = false) { return coordinationAdmission._validateRunStopAdmission(this, p, event, integrity); }

  _validateRunStopCompletion(p, event, integrity = false) { return coordinationAdmission._validateRunStopCompletion(this, p, event, integrity); }

  _runResultAdoptionKey(runId, nodeKey) { return coordinationLedger._runResultAdoptionKey(runId, nodeKey); }

  _runResultAdoptionFailure(message, code = 'run_result_adoption_integrity', integrity = false) { return coordinationAdmission._runResultAdoptionFailure(message, code, integrity); }

  _normalizeRunResultAdoptionRequest(fields, event, integrity = false) { return coordinationAdmission._normalizeRunResultAdoptionRequest(this, fields, event, integrity); }

  _deriveRunResultAdoptionBinding(request, integrity = false) { return coordinationAdmission._deriveRunResultAdoptionBinding(this, request, integrity); }

  _validateRunResultAdoptionAdmission(p, event, integrity = false) { return coordinationAdmission._validateRunResultAdoptionAdmission(this, p, event, integrity); }

  _validateRunResultAdoptionCompletion(p, event, integrity = false) { return coordinationAdmission._validateRunResultAdoptionCompletion(this, p, event, integrity); }

  _runResultExportFailure(message, code = 'run_result_export_integrity', integrity = false) { return coordinationAdmission._runResultExportFailure(message, code, integrity); }

  _normalizeRunResultExportRequest(fields, event, integrity = false) { return coordinationAdmission._normalizeRunResultExportRequest(this, fields, event, integrity); }

  _deriveRunResultExportBinding(request, integrity = false) { return coordinationAdmission._deriveRunResultExportBinding(this, request, integrity); }

  _validateRunResultExportAdmission(p, event, integrity = false) { return coordinationAdmission._validateRunResultExportAdmission(this, p, event, integrity); }

  _validateRunResultExportCompletion(p, event, integrity = false) { return coordinationAdmission._validateRunResultExportCompletion(this, p, event, integrity); }

  _contextFailure(message, code, integrity = false) { return coordinationAdmission._contextFailure(message, code, integrity); }

  _contextDefinition(manifest, integrity = false) { return coordinationAdmission._contextDefinition(this, manifest, integrity); }

  _currentContextDeployment() { return coordinationLedger._currentContextDeployment(this); }

  _normalizeContextDeployment(value, integrity = false) { return coordinationAdmission._normalizeContextDeployment(this, value, integrity); }

  _normalizeContextSourceAttestation(value, { deployment, manifest, node, branch, source = null },
    integrity = false) { return coordinationAdmission._normalizeContextSourceAttestation(this, value, { deployment, manifest, node, branch, source }, integrity); }

  _assertContextSessionCurrent(session, integrity = false) { return coordinationAdmission._assertContextSessionCurrent(this, session, integrity); }

  _validateContextSessionPayload(payload, event, integrity = false) { return coordinationAdmission._validateContextSessionPayload(this, payload, event, integrity); }

  _validateContextCellAdmissionPayload(payload, event, integrity = false) { return coordinationAdmission._validateContextCellAdmissionPayload(this, payload, event, integrity); }

  _validateContextCellSettlementPayload(payload, event, integrity = false) { return coordinationAdmission._validateContextCellSettlementPayload(this, payload, event, integrity); }
  _contextCallRunId(call) {
    return coordinationInternals._contextCallRunId(call);
  }

  _validateContextMapCallAdmissionPayload(payload, event, integrity = false) { return coordinationAdmission._validateContextMapCallAdmissionPayload(this, payload, event, integrity); }

  _validateContextEffectCallAdmissionPayload(payload, event, integrity = false) { return coordinationAdmission._validateContextEffectCallAdmissionPayload(this, payload, event, integrity); }

  _contextSettlementChildren(call, kind, integrity = false, cleanup = null) { return coordinationLedger._contextSettlementChildren(this, call, kind, integrity, cleanup); }

  _contextMapSettlementChildren(call, integrity = false, cleanup = null) { return coordinationLedger._contextMapSettlementChildren(this, call, integrity, cleanup); }

  _contextEffectSettlementChildren(call, integrity = false, cleanup = null) { return coordinationLedger._contextEffectSettlementChildren(this, call, integrity, cleanup); }

  _validateTaskResourceReleasePayload(payload, event, integrity = false) { return coordinationAdmission._validateTaskResourceReleasePayload(this, payload, event, integrity); }

  _normalizeContextCleanupReceipt(call, kind, children, value, integrity = false) { return coordinationAdmission._normalizeContextCleanupReceipt(this, call, kind, children, value, integrity); }

  _normalizeContextMapCleanupReceipt(call, children, value, integrity = false) { return coordinationAdmission._normalizeContextMapCleanupReceipt(this, call, children, value, integrity); }

  _normalizeContextEffectCleanupReceipt(call, children, value, integrity = false) { return coordinationAdmission._normalizeContextEffectCleanupReceipt(this, call, children, value, integrity); }
  _contextArtifactVerification() {
    return coordinationInternals._contextArtifactVerification(this._contextArtifactVerificationStorage);
  }
  withContextArtifactVerification(operation) {
    return coordinationInternals.withContextArtifactVerification(this._contextArtifactVerificationStorage, operation);
  }
  _contextArtifactRead(reference, verification) {
    return coordinationInternals._contextArtifactRead(this, reference, verification);
  }

  _validateContextProviderResults(call, kind, children, cleanup, values, integrity = false,
    verification = this._contextArtifactVerification()) { return coordinationAdmission._validateContextProviderResults(this, call, kind, children, cleanup, values, integrity, verification); }

  _validateContextMapProviderResults(call, children, cleanup, values, integrity = false,
    verification = this._contextArtifactVerification()) { return coordinationAdmission._validateContextMapProviderResults(this, call, children, cleanup, values, integrity, verification); }

  _validateContextEffectProviderResults(call, children, cleanup, values, integrity = false,
    verification = this._contextArtifactVerification()) { return coordinationAdmission._validateContextEffectProviderResults(this, call, children, cleanup, values, integrity, verification); }

  _validateContextMapPlanProposal(plan, integrity = false) { return coordinationAdmission._validateContextMapPlanProposal(this, plan, integrity); }

  _validateContextCallPlanProposal(plan, integrity = false) { return coordinationAdmission._validateContextCallPlanProposal(this, plan, integrity); }

  _validateContextMapResultLineageEvidence(call, evidence, children, providerResults, cleanup, integrity = false,
    verification = this._contextArtifactVerification(),) { return coordinationAdmission._validateContextMapResultLineageEvidence(this, call, evidence, children, providerResults, cleanup, integrity, verification); }
  _contextEffectCallCore(call) {
    return coordinationInternals._contextEffectCallCore(call);
  }

  _validateContextEffectResultLineageEvidence(call, evidence, children, providerResults, cleanup, integrity = false,
    verification = this._contextArtifactVerification(),) { return coordinationAdmission._validateContextEffectResultLineageEvidence(this, call, evidence, children, providerResults, cleanup, integrity, verification); }

  _validateContextMapCallSettlementPayload(payload, event, integrity = false) { return coordinationAdmission._validateContextMapCallSettlementPayload(this, payload, event, integrity); }

  _validateContextEffectCallSettlementPayload(payload, event, integrity = false) { return coordinationAdmission._validateContextEffectCallSettlementPayload(this, payload, event, integrity); }

  _assertRunAdmissionOpen(runId, integrity = false) { return coordinationAdmission._assertRunAdmissionOpen(this, runId, integrity); }

  _acceptanceRevocationFailure(message, code, integrity = false) { return coordinationAdmission._acceptanceRevocationFailure(message, code, integrity); }

  _acceptanceRevocationRequest(fields, auth) {
    return coordinationInternals._acceptanceRevocationRequest(fields, auth);
  }

  _acceptanceRevocationEvidence(task, coordinationSeq, integrity = false) { return coordinationLedger._acceptanceRevocationEvidence(this, task, coordinationSeq, integrity); }

  _acceptanceRevocationTargets(task, evidenceSeq, integrity = false) { return coordinationLedger._acceptanceRevocationTargets(this, task, evidenceSeq, integrity); }

  _validateAcceptanceRevocationPayload(p, event, integrity = false) { return coordinationAdmission._validateAcceptanceRevocationPayload(this, p, event, integrity); }

  _planBudgetFailure(message, code, integrity = false) { return coordinationAdmission._planBudgetFailure(this, message, code, integrity); }

  _derivePlanBudgetSettlement(taskId, integrity = false) { return coordinationAdmission._derivePlanBudgetSettlement(this, taskId, integrity); }

  _validatePlanBudgetSettlement(p, event, integrity = false) { return coordinationAdmission._validatePlanBudgetSettlement(this, p, event, integrity); }

  // Issue #325: the replay half of assertGoalSuccessor, decided from RECORDED content
  // only. The definitionOfDone/constraint supersets and the budget containment re-derive
  // from the replayed rows, so a weakened successor still refuses; the risk-tier ordering
  // is the live policy's taxonomy (assertGoalSuccessor's riskIndex), which a policy edit
  // may reorder or prune — replaying it would re-judge recorded history, so replay does
  // not order risks. Live defineGoal still enforces the full relation at admission.
  _goalSuccessorWeakeningReplay(prior, next) {
    const malformed = (message = 'goal/plan event is malformed') => this._goalPlanFailure(message, 'goal_plan_integrity', true);
    const includes = (values, required) => Array.isArray(values) && Array.isArray(required)
      && required.every((item) => values.includes(item));
    const within = (a, b) => {
      if (!a || !b) return false;
      const aUsd = usdToNanos(a.usd); const bUsd = usdToNanos(b.usd);
      return aUsd !== null && bUsd !== null && a.tokens <= b.tokens && aUsd <= bUsd
        && a.wallMin <= b.wallMin && a.providerTurns <= b.providerTurns;
    };
    if (!prior || !includes(next.definitionOfDone, prior.definitionOfDone)
      || !includes(next.constraints, prior.constraints) || !within(next.budget, prior.budget)) {
      malformed('goal amendment weakens an established constraint');
    }
  }

  _applyGoalPlanEvent(event) { return coordinationLedger._applyGoalPlanEvent(this, event); }

  _apply(event) { return coordinationLedger._apply(this, event); }
  /** Issue #483: the deployment's own incarnation lifecycle, folded one row at a time — the six
   * `host.*` kinds an incarnation writes about itself, read by `incarnationDeparture()` when a
   * bounded wait is torn down. Last write wins per kind, exactly as the log reads:
   *
   *   host.reincarnation_requested — a handoff began (new-turn admission closes; RECOVERABLE: a
   *                                  handoff that fails re-publishes and this incarnation serves on)
   *   host.successor_started       — the successor incarnation the handoff minted
   *   host.successor_published     — …and its publication
   *   host.reincarnated            — the handoff settled IN FAVOUR OF THE SUCCESSOR: this process
   *                                  is not (or is no longer) the departure's incarnation
   *   host.reincarnation_failed    — the handoff settled against the successor; this incarnation
   *                                  went on serving
   *   host.stop_requested          — an ordinary stop's first durable act
   *   host.stop_waiting            — the stop's own named wait
   *   host.stopped                 — the release that ENDED this incarnation's authority
   *
   * A handoff's own stop rows are not a departure on their own — the window can still fail — so
   * the handoff decides at the release, where the successor is already named. */
  _foldIncarnationLifecycle(row) {
    const kind = row.kind;
    if (kind === 'host.reincarnation_requested') {
      this._incarnationHandoff = freeze({ successor: null });
      return;
    }
    if (kind === 'host.successor_started' || kind === 'host.successor_published') {
      if (this._incarnationHandoff === null) return; // a publication with no request belongs to another incarnation
      if (typeof row.incarnation === 'string' && row.incarnation.length > 0) {
        this._incarnationHandoff = freeze({ successor: row.incarnation });
      }
      return;
    }
    if (kind === 'host.reincarnated' || kind === 'host.reincarnation_failed') {
      this._incarnationHandoff = null;
      this._incarnationDeparture = null;
      return;
    }
    if (kind === 'host.stop_requested' || kind === 'host.stop_waiting') {
      if (this._incarnationHandoff !== null) return; // the handoff's own stop: the window still decides
      this._incarnationDeparture = freeze({ reason: 'resident_stopping', successor: null });
      return;
    }
    if (kind === 'host.stopped') {
      // The release: this incarnation's authority ended — the ONE row a handoff's stop and an
      // ordinary stop both mint, which is why the handoff decides HERE (the successor is named by
      // then) and an ordinary stop re-states the reason its own request already set.
      if (this._incarnationHandoff === null) {
        this._incarnationDeparture = freeze({ reason: 'resident_stopping', successor: null });
        return;
      }
      const successor = this._incarnationHandoff.successor;
      this._incarnationDeparture = freeze({
        reason: 'incarnation_withdrawn',
        successor: successor === null ? null : freeze({ incarnation: successor }),
      });
    }
  }
  events(fromSeq = 1, limit = null) {
    return coordinationInternals.events(this._events, fromSeq, limit);
  }

  // #227 (2026-08-15): the O(1) ledger cursor. Delta consumers (waves.progress sinceSeq)
  // need the current tail position WITHOUT materializing the ledger — eventsView() with no
  // arguments copies the world (the #210 class). Length only, never a copy.
  eventCursor() { return coordinationLedger.eventCursor(this._events); }

  // Clone-free read view: every event in _events is frozen at append (load path and both
  // runtime append paths), so read-only consumers share the store's frozen references
  // instead of paying a full-log deep clone per call (the loop-starvation furnace).
  eventsView(fromSeq = 1, limit = null) { return coordinationLedger.eventsView(this._events, fromSeq, limit); }
  /** Issue #483: is the incarnation that holds this store LEAVING, and — when the departure is a
   * reincarnation handoff — which incarnation takes the deployment over? Null while none is.
   *
   * The state is folded from the deployment's own `host.*` rows APPENDED LIVE to this store (see
   * `_foldIncarnationLifecycle`); a row this store replayed at open belongs to an incarnation that
   * is already gone and never reads as this one's departure. The reasons are the closed set a
   * torn-down wait crosses with: `incarnation_withdrawn` (a handoff whose release ended this
   * incarnation's authority — `successor` names the incarnation it minted), `resident_stopping`
   * (an ordinary stop, `successor: null`). The third crossing reason, `store_closed`, is minted by
   * the caller of a wait whose store closed with NO live departure on its ledger. */
  incarnationDeparture() { return this._incarnationDeparture; }
    waitAfter(afterSeq, timeoutMs, options = {}) { return coordinationLedgerWrites.waitAfter(this, afterSeq, timeoutMs, options); }
  observationTime(observedSeq = this._events.length) {
    return coordinationInternals.observationTime(this, observedSeq);
  }
  task(id) {
    return coordinationInternals.task(this._tasks, id);
  }
  run(id) {
    return coordinationInternals.run(this._runs, id);
  }
  routePolicy() { return coordinationLedger.routePolicy(this._routePolicy); }
  representationPolicy() { return coordinationLedger.representationPolicy(this._representationPolicy); }
  goalPlanPolicy() { return coordinationLedger.goalPlanPolicy(this._goalPlanPolicy); }
  workflowPolicy() { return coordinationLedger.workflowPolicy(this._workflowPolicy); }
  contextProgramPolicy() { return coordinationLedger.contextProgramPolicy(this._contextProgramPolicy); }
  contextProgramAuthority() {
    return coordinationInternals.contextProgramAuthority(this);
  }
  contextSession(sessionId) {
    return coordinationInternals.contextSession(this._contextSessions, sessionId);
  }
  contextCell(cellId) {
    return coordinationInternals.contextCell(this._contextCells, cellId);
  }
  contextCall(callId) { return coordinationLedger.contextCall(this, callId); }
  contextCalls({ runId = null } = {}) {
    if (runId !== null && (typeof runId !== 'string' || runId.length === 0)) {
      throw new TypeError('Context call Run filter is invalid');
    }
    return [...this._contextCalls.keys()].map((callId) => this.contextCall(callId))
      .filter((call) => runId === null || this._contextCallRunId(call) === runId)
      .sort((left, right) => left.admittedEvent - right.admittedEvent);
  }
  _contextRetrySelection(callId, integrity = false) { return coordinationAdmission._contextRetrySelection(this, callId, integrity); }
  contextRetryEligibility(callId) { return coordinationAdmission.contextRetryEligibility(this, callId); }
  contextCallSettlementChildren(callId, cleanupReceipt = null) { return coordinationAdmission.contextCallSettlementChildren(this, callId, cleanupReceipt); }
  contextCallArtifacts(callId) {
    return clone(this._contextCallArtifacts(callId, this._contextArtifactVerification()));
  }
  contextCallContents(callId) {
    const verification = this._contextArtifactVerification();
    const artifacts = this._contextCallArtifacts(callId, verification);
    if (!artifacts.output || !Array.isArray(artifacts.output.items)) {
      throw new CoordinationRefusal('Context call has no completed result content',
        'context_call_content_unavailable');
    }
    const results = artifacts.output.items.map((candidate, index) => {
      let capsule; let resultRef; let source;
      try {
        capsule = this._contextArtifactRead(candidate?.capsuleRef, verification);
        resultRef = validateContextProviderResultReference(candidate, capsule);
        source = this._contextArtifactRead(capsule.sourceRef, verification);
      } catch (error) {
        throw new CoordinationIntegrityError(
          error?.message ?? 'Context provider result content is unavailable',
          'context_call_settlement_integrity',
        );
      }
      if (!Array.isArray(source) || source.length !== capsule.sourceRef.itemCount
        || contextValueDigest(source) !== capsule.sourceRef.digest) {
        throw new CoordinationIntegrityError('Context provider result content changed',
          'context_call_settlement_integrity');
      }
      return freeze({
        index, unitId: resultRef.unitId, capsuleId: resultRef.capsuleId,
        route: clone(capsule.route),
        result: {
          resultSha: capsule.result.resultSha,
          retainedResultRef: capsule.result.retainedResultRef,
          changedPaths: clone(capsule.result.changedPaths),
          pathScope: clone(capsule.result.pathScope),
        },
        source: clone(source),
      });
    });
    return clone(freeze({
      schemaVersion: 1, kind: 'baton.context_call_content', callId,
      resultCount: results.length, results: freeze(results),
    }));
  }
  _contextCallArtifacts(callId, verification) { return coordinationAdmission._contextCallArtifacts(this, callId, verification); }
  contextCompletedCallSource(callId) {
    return this.contextCompletedCallSourceAndArtifacts(callId).source;
  }
  contextCompletedCallSourceAndArtifacts(callId) {
    const call = this._contextCalls.get(callId);
    if (!call) throw new CoordinationRefusal('Context call is unavailable',
      'context_map_call_not_found');
    if (call.state !== 'completed' || !call.result) {
      throw new CoordinationRefusal('Context call is not a completed source',
        'context_map_call_not_completed');
    }
    const verification = this._contextArtifactVerification();
    const artifacts = this._contextCallArtifacts(callId, verification);
    const expectedEvidenceVersion = call.kind === 'baton.context_effect_call' ? 4 : 3;
    if (artifacts.evidence.schemaVersion !== expectedEvidenceVersion) {
      throw new CoordinationRefusal(
        'Historical Context call output has no exact per-item lineage',
        'context_output_lineage_required',
      );
    }
    try {
      const source = clone(normalizeContextEffectSource({
        kind: 'call', id: call.callId, callDigest: call.callDigest,
        generation: call.generation, settlementDigest: call.settlementDigest,
        outputRef: call.result.outputRef, evidenceRef: call.result.evidenceRef,
        itemCount: artifacts.output.items.length,
        coordinateDigest: artifacts.evidence.coordinateDigest,
        outputLineageDigest: artifacts.evidence.outputLineageDigest,
      }));
      return freeze({ source, artifacts: clone(artifacts) });
    } catch (error) {
      throw new CoordinationIntegrityError(
        error?.message ?? 'Completed Context call source changed',
        'context_map_call_settlement_integrity',
      );
    }
  }
  pendingContextCells(limit = 1_000) { return coordinationLedger.pendingContextCells(this._contextCells, limit); }
  _validateContextCompletionArtifacts(cell, result, output, evidence, integrity = false) { return coordinationAdmission._validateContextCompletionArtifacts(this, cell, result, output, evidence, integrity); }
  contextCellArtifacts(cellId) { return coordinationAdmission.contextCellArtifacts(this, cellId); }
  canonicalOrderPolicy() { return coordinationLedger.canonicalOrderPolicy(this._canonicalOrderPolicy); }
  goalVersion(goalId, version) { return coordinationLedger.goalVersion(this, goalId, version); }
  planVersion(planId, version) { return coordinationLedger.planVersion(this, planId, version); }

  // REFLEX-3 (docs/32 §3.3, issue #18; contract: docs/reference/evidence/
  // reflex-wave-live-2026-07-21/reflex3-packages-decisions.md, red-team F11/F14 lines 205-231,
  // 282-294): a typed, immutable, replay-safe knowledge/context hand-off package.
  //
  // Provenance (Part A): `provenance.packageEvent` is never submitted (refused
  // `reserved_package_field` — the `_knowledgePayload` reserved-field stance, :11648-11651) and is
  // hub-derived from the admission ledger event itself, exactly the `scratchFactOracleTarget`
  // ledger-binding pattern (:11566-11585): `_contextPackageProvenance` dereferences
  // `this._events[admittedEvent - 1]`, cross-checks it still matches the durable projection, and
  // raises the loud `package_provenance_integrity` (never a silent accept) on any divergence — a
  // fresh derivation every read, so replay reproduces the identical binding.
  //
  // Shape (Part B): `_normalizeContextPackage` runs the `normalizeContextManifest` mold
  // (context-program.mjs:183-192) — delete-and-recompute `packageDigest` without `packageEvent`,
  // exact()-check every field, reject unknown fields, unique branch names
  // (`package_branch_name_conflict`), and every branch requires >=1 of source/artifact/valueRef
  // (`package_branch_empty` — a `schema` alone is not content).
  //
  // Attach vs resolve (Part C): admission resolves every branch ref exactly once
  // (`_resolveContextPackageBranchContent`, called from `admitContextPackage`).
  // `attachContextPackage` is a fenced O(1) pointer binding — it never re-reads branch bytes.
  // `resolveContextPackageBranch` is the lazy, resolve-time revalidation point per §93.5, settling
  // `context_artifact_unavailable` on missing/changed bytes; callers wrap it in
  // `withContextArtifactVerification` exactly like the existing Context Program read paths.
  //
  // Sanitization (Part D, F14): branch content is untrusted input to every reader — the
  // application layer projects it through `boundedAttentionText`/`SECRET_SHAPED_TEXT` with
  // untrusted-prose provenance marking before it reaches a Brief/RunView/MCP surface.
  contextPackage(packageDigest) {
    return coordinationInternals.contextPackage(this, packageDigest);
  }
  contextPackageAttachments(runId) {
    return coordinationInternals.contextPackageAttachments(this._contextPackageAttachments, runId);
  }
  _contextPackageProvenance(record) {
    return coordinationInternals._contextPackageProvenance(this, record);
  }

  _normalizeContextPackageSourceRef(value, integrity) { return coordinationAdmission._normalizeContextPackageSourceRef(this, value, integrity); }

  _normalizeContextPackageArtifactRef(value, integrity) { return coordinationAdmission._normalizeContextPackageArtifactRef(this, value, integrity); }

  _normalizeContextPackageValueRef(value, integrity) { return coordinationAdmission._normalizeContextPackageValueRef(this, value, integrity); }

  _normalizeContextPackageSchemaRef(value, integrity) { return coordinationAdmission._normalizeContextPackageSchemaRef(this, value, integrity); }

  _normalizeContextPackageBranch(value, integrity) { return coordinationAdmission._normalizeContextPackageBranch(this, value, integrity); }

  _normalizeContextPackage(fields, integrity = false) { return coordinationAdmission._normalizeContextPackage(this, fields, integrity); }

  _resolveContextPackageBranchContent(branch, integrity) { return coordinationAdmission._resolveContextPackageBranchContent(this, branch, integrity); }

  resolveContextPackageBranch(packageDigest, branchName) { return coordinationAdmission.resolveContextPackageBranch(this, packageDigest, branchName); }

  /** S-2 v2 package side of the shared session-authority posture. Package provenance/attachment
   * Run coordinates are required to agree with both the envelope and the proof's lease. */
  admitPackageCommand(envelope) { return coordinationAdmission.admitPackageCommand(this, envelope); }

  admitContextPackage(fields, auth) { return coordinationAdmission.admitContextPackage(this, fields, auth); }

  _contextPackageAttachmentView(event) { return coordinationLedger._contextPackageAttachmentView(event); }

    attachContextPackage(fields, auth) { return coordinationLedgerWrites.attachContextPackage(this, fields, auth); }

  admitContextSession(fields, auth) { return coordinationAdmission.admitContextSession(this, fields, auth); }

  replManifestAdmission(manifestDigest) { return coordinationAdmission.replManifestAdmission(this._replManifestAdmissions, manifestDigest); }

  _replManifestFailure(message, code, integrity = false) { return coordinationAdmission._replManifestFailure(message, code, integrity); }

  // REPL-1 rule 5–9: admit a ReplManifest as a single evented authority record. The principal is
  // lease-authenticated for `shared` (run-pinned) and wrapper-forced for `worker:<id>` (store
  // equality) — no caller-supplied `principal`/`replRole` string is ever trusted as authority.
  _validateReplManifestAdmissionPayload(payload, event, integrity = false) { return coordinationAdmission._validateReplManifestAdmissionPayload(this, payload, event, integrity); }

  admitReplManifest(fields, auth) { return coordinationAdmission.admitReplManifest(this, fields, auth); }

  // REPL-1 rule 10: a session admission for a ReplManifest WITHOUT the Plan-node requirement. It
  // reuses contextSessionIdentity (kind-dispatching) and the per-branch byte-proof loop, but does
  // NOT call the Plan-node-coupled attestation, so it mints at schemaVersion 1.
  admitReplSession(fields, auth) { return coordinationAdmission.admitReplSession(this, fields, auth); }

  admitContextCell(fields, auth) { return coordinationAdmission.admitContextCell(this, fields, auth); }

  settleContextCell(fields, auth) { return coordinationLedger.settleContextCell(this, fields, auth); }

  admitContextMapCall(fields, auth) { return coordinationAdmission.admitContextMapCall(this, fields, auth); }

  admitContextEffectCall(fields, auth) { return coordinationAdmission.admitContextEffectCall(this, fields, auth); }
  taskResourceRelease(taskId) {
    return coordinationInternals.taskResourceRelease(this._taskResourceReleases, taskId);
  }

  recordTaskResourceRelease(fields, auth) { return coordinationLedger.recordTaskResourceRelease(this, fields, auth); }

  _settleContextCall(fields, auth, expectedKind = null) { return coordinationLedger._settleContextCall(this, fields, auth, expectedKind); }

  settleContextCall(fields, auth) { return coordinationLedger.settleContextCall(this, fields, auth); }

  settleContextMapCall(fields, auth) { return coordinationLedger.settleContextMapCall(this, fields, auth); }

  settleContextEffectCall(fields, auth) { return coordinationLedger.settleContextEffectCall(this, fields, auth); }

  defineGoal(fields, auth) { return coordinationLedger.defineGoal(this, fields, auth); }

  proposePlan(fields, auth) { return coordinationLedger.proposePlan(this, fields, auth); }

  approvePlan(fields, auth) { return coordinationLedger.approvePlan(this, fields, auth); }

  _planDispatchState(gate, route, preservedResumeClaim = null, options = {}) { return coordinationLedger._planDispatchState(this, gate, route, preservedResumeClaim, options); }

  previewPlanDispatch(gate, route, preservedResumeClaim = null) { return coordinationAdmission.previewPlanDispatch(this, gate, route, preservedResumeClaim); }

  previewPlanRevision(gate, route) { return coordinationAdmission.previewPlanRevision(this, gate, route); }
  reconcilePlanGatedTask(taskId, gate, route, auth) {
    return coordinationReplay.reconcilePlanGatedTask(this, taskId, gate, route, auth);
  }
  reconcilePlanRevisionTask(taskId, gate, route, auth) {
    return coordinationReplay.reconcilePlanRevisionTask(this, taskId, gate, route, auth);
  }

  createPlanRevisionTask(fields, gate, route, auth) { return coordinationLedger.createPlanRevisionTask(this, fields, gate, route, auth); }

  createPlanGatedTask(fields, gate, route, auth) { return coordinationLedger.createPlanGatedTask(this, fields, gate, route, auth); }

  createPlanGatedWave(rawEntries, auth) { return coordinationLedger.createPlanGatedWave(this, rawEntries, auth); }

  // PS5: re-dispatch one approved Plan node from a preserved progress checkpoint. The caller
  // (Coordinator) has already postchecked the immutable checkpoint ref; this admission only
  // records the attestation and validates that the prior dispatch's task is durably terminal-
  // cancelled, so a fresh owned task may continue the same Plan node at the preserved commit.
  // Reuses the ordinary two-event goal_plan_node_dispatch batch so the integrity walker and the
  // last-wins plan projection pick up the resumed task as the node's current dispatch.
  createAndClaimPreservedResumeRefinement(fields, gate, route, preservedResume, auth) {
    return coordinationReplay.createAndClaimPreservedResumeRefinement(this, fields, gate, route, preservedResume, auth);
  }

  createAndClaimPlanRecoveryRefinement(fields, gate, route, attribution, auth) {
    return coordinationReplay.createAndClaimPlanRecoveryRefinement(this, fields, gate, route, attribution, auth);
  }
  unsettledPlanNodeTasks() {
    return coordinationInternals.unsettledPlanNodeTasks(this);
  }

  settlePlanNodeBudget(taskId, auth) { return coordinationLedger.settlePlanNodeBudget(this, taskId, auth); }

  goalPlanStatus(fields, auth) { return coordinationLedger.goalPlanStatus(this, fields, auth); }
  routeObservations() { return coordinationLedger.routeObservations(this._routeObservations); }
  recoveryDispatchState(workerId) {
    return coordinationReplay.recoveryDispatchState(this, workerId);
  }
  representationProduction(identityDigest) {
    return coordinationInternals.representationProduction(this._representations, identityDigest);
  }
  representationProductionByRequest(requestDigest) {
    return coordinationInternals.representationProductionByRequest(this, requestDigest);
  }
  representationProductionAdmission(request, auth) { return coordinationAdmission.representationProductionAdmission(this, request, auth); }
  prepareRepresentationProduction(fields, auth) { return coordinationAdmission.prepareRepresentationProduction(this, fields, auth); }
  recordRepresentationProduction(fields, receiptRef, auth) { return coordinationLedger.recordRepresentationProduction(this, fields, receiptRef, auth); }
  reverifyRepresentationProduction(identityDigest, expectedSource = null) {
    return coordinationInternals.reverifyRepresentationProduction(this, identityDigest, expectedSource);
  }

  _effectiveRunOrchestratorLeaseState(lease, now = this._clock()) { return coordinationAdmission._effectiveRunOrchestratorLeaseState(this, lease, now); }

  runAuthoritySnapshot() { return coordinationLedger.runAuthoritySnapshot(this); }

  runOrchestrationView(runId) { return coordinationLedger.runOrchestrationView(this, runId); }

  _scratchpadSnapshot() { return coordinationLedger._scratchpadSnapshot(this); }

  snapshot() { return coordinationLedger.snapshot(this); }

  /** Narrow current Goal/Plan index used by resident startup reconciliation. This avoids cloning
   * unrelated tasks, evidence, knowledge, Web/MCP receipts, or historical Goal/Plan versions. */
  goalPlanRun(repoId, runId) { return coordinationLedger.goalPlanRun(this, repoId, runId); }

  /** Issue #391 (C12): the Plan history of one Run's current durable Goal, as a PAGE — the first
   * `limit` generations past `cursor` plus {truncated, nextCursor}. `limit` is a page size: a Run
   * holding more generations than the caller asked for is a truncated page, never the
   * `goal_plan_status_oversize` refusal this accessor used to raise for the row count, so the
   * caller walks the cursor to the whole bounded set instead of being told it asked for too much. */
  goalPlanRunPlans(repoId, runId, limit = 100_000, cursor = 0) { return coordinationLedger.goalPlanRunPlans(this, repoId, runId, limit, cursor); }
  goalPlanRunIds(repoId, limit = 100_000, cursor = 0) {
    return coordinationInternals.goalPlanRunIds(this._goalHeads, repoId, limit, cursor);
  }

  /** Issue #391 (C12): the dispatches across every Plan generation of one Run's current Goal, as
   * a PAGE (`limit` is a page size, `cursor` resumes past the last row served) — the narrow read
   * behind semantic control-target resolution (workflow interrupt recipients), which previously
   * cloned the entire store through snapshot().goalPlan.dispatches and refused a bounded request
   * for the row count. */
  goalPlanDispatches(repoId, runId, limit = 100_000, cursor = 0) { return coordinationLedger.goalPlanDispatches(this, repoId, runId, limit, cursor); }

  /** Approval + dispatches for ONE Plan generation of one Run's current Goal — the narrow read
   * behind workflow Plan-history projections (_runAtPlan), which previously cloned the entire
   * store through snapshot().goalPlan (approvals + dispatches). */
  goalPlanPlanState(repoId, runId, planId, version, digest) { return coordinationLedger.goalPlanPlanState(this, repoId, runId, planId, version, digest); }

  /** Issue #391 (C12): the current Goal/Plan heads for one repo, as a PAGE of head rows — the
   * first `limit` heads past `cursor`, each carrying the plan head it owns, plus
   * {truncated, nextCursor}. The projection behind runs.list, which previously cloned the entire
   * store through snapshot().goalPlan and refused a bounded request for the row count; runs.list
   * walks these pages to the whole bounded head set, so a deployment that outgrew one page is
   * paged rather than told to ask for fewer rows. Heads only: no historical versions, no
   * dispatch bodies. */
  goalPlanSummary(repoId, limit = 100_000, cursor = 0) { return coordinationLedger.goalPlanSummary(this, repoId, limit, cursor); }
  healthCheck() {
    return coordinationInternals.healthCheck(this);
  }
  readyTasks() {
    return coordinationInternals.readyTasks(this._tasks);
  }
  fleetDrain(id) {
    return coordinationInternals.fleetDrain(this._fleetDrains, id);
  }
  runStop(runId) {
    return coordinationInternals.runStop(this, runId);
  }

  runResultAdoption(runId, nodeKey) { return coordinationLedger.runResultAdoption(this, runId, nodeKey); }

  pendingRunResultAdoptions(limit = 1_000) { return coordinationLedger.pendingRunResultAdoptions(this._runResultAdoptions, limit); }

  admitRunResultAdoption(fields, auth) { return coordinationAdmission.admitRunResultAdoption(this, fields, auth); }

  completeRunResultAdoption(fields, auth) { return coordinationLedger.completeRunResultAdoption(this, fields, auth); }

  // ==========================================================================
  // Phase 69 VR6 — durable verifier retry cascade (two-phase, response-loss safe)
  // ==========================================================================

  _runVerificationRetryKey(runId, nodeKey) { return coordinationLedger._runVerificationRetryKey(runId, nodeKey); }

  _runVerificationRetryFailure(message, code = 'run_verification_retry_integrity', integrity = false) { return coordinationAdmission._runVerificationRetryFailure(message, code, integrity); }

  runVerificationRetry(runId, nodeKey) { return coordinationLedger.runVerificationRetry(this, runId, nodeKey); }

  pendingRunVerificationRetries(limit = 1_000) { return coordinationLedger.pendingRunVerificationRetries(this._runVerificationRetries, limit); }

  _readRetryVerificationEvidence(reference, integrity) { return coordinationLedger._readRetryVerificationEvidence(this, reference, integrity); }

  _normalizeRunVerificationRetryRequest(fields, event, integrity = false) { return coordinationAdmission._normalizeRunVerificationRetryRequest(this, fields, event, integrity); }

  _validateRunVerificationRetryAdmission(p, event, integrity = false) { return coordinationAdmission._validateRunVerificationRetryAdmission(this, p, event, integrity); }

  _validateRunVerificationRetryCompletion(p, event, integrity = false) { return coordinationAdmission._validateRunVerificationRetryCompletion(this, p, event, integrity); }

  admitRunVerificationRetry(fields, auth) { return coordinationAdmission.admitRunVerificationRetry(this, fields, auth); }

  completeRunVerificationRetry(fields, auth) { return coordinationLedger.completeRunVerificationRetry(this, fields, auth); }
  runResultExport(runId, nodeKey) {
    return coordinationInternals.runResultExport(this._runResultExports, runId, nodeKey);
  }

  pendingRunResultExports(limit = 1_000) { return coordinationLedger.pendingRunResultExports(this._runResultExports, limit); }

  admitRunResultExport(fields, auth) { return coordinationAdmission.admitRunResultExport(this, fields, auth); }

  completeRunResultExport(fields, auth) { return coordinationLedger.completeRunResultExport(this, fields, auth); }
  runControl(controlId) {
    return coordinationInternals.runControl(this._runControls, controlId);
  }
  runControls(runId, limit = 100_000) {
    return coordinationInternals.runControls(this._runControls, runId, limit);
  }

  pendingRunControls(limit = 1_000) { return coordinationLedger.pendingRunControls(this._runControls, limit); }

  admitRunControl(fields, auth) { return coordinationAdmission.admitRunControl(this, fields, auth); }

  beginRunControlEffect(fields, auth) { return coordinationLedger.beginRunControlEffect(this, fields, auth); }

  acknowledgeRunControl(fields, auth) { return coordinationLedger.acknowledgeRunControl(this, fields, auth); }

  settleRunControl(fields, auth) { return coordinationLedger.settleRunControl(this, fields, auth); }

  pendingRunStops(limit = 1_000) { return coordinationLedger.pendingRunStops(this._runStops, limit); }

  admitRunStop(fields, auth) { return coordinationAdmission.admitRunStop(this, fields, auth); }

  completeRunStop(runId, receipt, auth) { return coordinationLedger.completeRunStop(this, runId, receipt, auth); }

  admitFleetDrain(fields, auth) { return coordinationAdmission.admitFleetDrain(this, fields, auth); }

  recordFleetDrainDisposition(drainId, workerId, disposition, auth) { return coordinationLedger.recordFleetDrainDisposition(this, drainId, workerId, disposition, auth); }

  completeFleetDrain(drainId, receipt, auth) { return coordinationLedger.completeFleetDrain(this, drainId, receipt, auth); }
  webCommand(id) {
    return coordinationInternals.webCommand(this._webCommands, id);
  }
  webCommandByScope(scopeKey) {
    return coordinationInternals.webCommandByScope(this, scopeKey);
  }

  admitWebCommand(fields, auth) { return coordinationAdmission.admitWebCommand(this, fields, auth); }

  completeWebCommand(commandId, outcome, auth) { return coordinationLedger.completeWebCommand(this, commandId, outcome, auth); }

  failWebCommand(commandId, outcome, auth) { return coordinationLedger.failWebCommand(this, commandId, outcome, auth); }
  mcpCall(id) {
    return coordinationInternals.mcpCall(this._mcpCalls, id);
  }
  mcpCallByScope(scopeKey) {
    return coordinationInternals.mcpCallByScope(this, scopeKey);
  }

  admitMcpCall(fields, auth) { return coordinationAdmission.admitMcpCall(this, fields, auth); }

  completeMcpCall(callId, outcome, auth) { return coordinationLedger.completeMcpCall(this, callId, outcome, auth); }

  failMcpCall(callId, outcome, auth) { return coordinationLedger.failMcpCall(this, callId, outcome, auth); }

  recordMcpAudit(fields, auth) { return coordinationLedger.recordMcpAudit(this, fields, auth); }

  recordWebAudit(fields, auth) { return coordinationLedger.recordWebAudit(this, fields, auth); }

  _isDerivedPlanSemanticReview(fields) { return coordinationAdmission._isDerivedPlanSemanticReview(this, fields); }

  createTask(fields, auth) { return coordinationLedger.createTask(this, fields, auth); }
  createAndClaimRecoveryRefinement(fields, attribution, auth) {
    return coordinationReplay.createAndClaimRecoveryRefinement(this, fields, attribution, auth);
  }

  // D1 (KG settlement contract): the dedicated atomic settlement-task API — one hub-internal
  // lease anchor per wave. Mirrors createAndClaimRecoveryRefinement's create+claim batch shape
  // (relation 'settlement', capabilities exactly ['baton_orchestrator'], orchestrator actor
  // only), bypassing plan-mandatory the same way. The objective is a hub-fixed constant carrying
  // only the waveId; the caller supplies NO prose. Closed fields {id, runId, reservedWorkerId}
  // are pinned to settlement-task:<waveId> / run-settlement:<waveId> so the lease identity is
  // stable across re-drive. Idempotency by caller key, replay-exact.
  createAndClaimSettlementTask(fields, auth) { return coordinationLedger.createAndClaimSettlementTask(this, fields, auth); }

  // Sweep (KG settlement D3 step 0, DRIVER-TRIGGERED, NO TIMERS): at wave close, retire every
  // PRIOR settlement lease (a wave other than the one now closing) that carries no admission — its
  // review window is over precisely because a later wave has closed, so the window is bounded by
  // driver cadence, not a wall clock. Revokes with reason `review_window_expired`, cancels the
  // settlement task, and retires un-admitted candidate board items. Bounded ≤ maxLeases per pass;
  // each step is idempotent (a revoked lease is skipped next pass, a terminal task is left alone),
  // so repeated driver passes finish the residue. The currently-closing wave is excluded so its own
  // freshly-materialized lease is never swept (re-drive stays exactly-once).
  sweepSettlementLeases(repoId, options = {}) { return coordinationLedger.sweepSettlementLeases(this, repoId, options); }

  sealRunScorecard(fields, auth) { return coordinationLedger.sealRunScorecard(this, fields, auth); }

  claimTask(id, worker, expectedVersion, auth, attribution = {}) { return coordinationLedger.claimTask(this, id, worker, expectedVersion, auth, attribution); }

  transitionTask(id, to, expectedVersion, auth, evidence = null) { return coordinationLedger.transitionTask(this, id, to, expectedVersion, auth, evidence); }

    revokeTaskAcceptance(fields, auth) { return coordinationLedgerWrites.revokeTaskAcceptance(this, fields, auth); }

  mapOperationalEvent(operationalEvent, auth) { return coordinationLedger.mapOperationalEvent(this, operationalEvent, auth); }

  registerArtifact(fields, auth) { return coordinationLedger.registerArtifact(this, fields, auth); }

  _validateProvisionalResultRef(manifest, integrity = false) { return coordinationAdmission._validateProvisionalResultRef(manifest, integrity); }

  _prepareArtifact(fields, terminalStatus) { return coordinationAdmission._prepareArtifact(this, fields, terminalStatus); }

  transitionTaskWithArtifacts(id, to, expectedVersion, fields, auth, evidence = null) { return coordinationLedger.transitionTaskWithArtifacts(this, id, to, expectedVersion, fields, auth, evidence); }
  artifact(id) {
    return coordinationInternals.artifact(this._artifacts, id);
  }

  reusePolicyState(repoId) { return coordinationLedger.reusePolicyState(this._reusePolicyHeads, repoId); }
  activateReusePolicy(fields, auth) { return coordinationLedger.activateReusePolicy(this, fields, auth); }

  providerReceipt(id) { return coordinationLedger.providerReceipt(this._providerReceipts, id); }
  providerProcessing(id) {
    return coordinationInternals.providerProcessing(this._providerProcessing, id);
  }
  providerSourceHealth(repoId, providerId, sourceEpoch) { return coordinationLedger.providerSourceHealth(this, repoId, providerId, sourceEpoch); }
  providerAttemptPolicy() { return coordinationLedger.providerAttemptPolicy(this._providerAttemptPolicy); }
  advisoryFeedCards() {
    return coordinationInternals.advisoryFeedCards(this._advisoryFeedCards);
  }
  pendingProviderReconciliation(repoId, coordinate) { return coordinationLedger.pendingProviderReconciliation(this, repoId, coordinate); }
  dueProviderProcessing(repoId, at) {
    return coordinationInternals.dueProviderProcessing(this, repoId, at);
  }

  recordProviderProcessingDeferral(fields, auth) { return coordinationLedger.recordProviderProcessingDeferral(this, fields, auth); }

  readProviderStatus(repoId, request, ceilings) { return coordinationLedger.readProviderStatus(this, repoId, request, ceilings); }

  recordProviderSourceReconciliation(fields, auth) { return coordinationLedger.recordProviderSourceReconciliation(this, fields, auth); }

  providerProcessingAdmission(key, requestDigest) { return coordinationAdmission.providerProcessingAdmission(this, key, requestDigest); }

  recordProviderGreenCompletion(fields, auth) { return coordinationLedger.recordProviderGreenCompletion(this, fields, auth); }

  recordProviderAdverseCompletion(fields, auth) { return coordinationLedger.recordProviderAdverseCompletion(this, fields, auth); }

  recordProviderDelivery(fields, auth) { return coordinationLedger.recordProviderDelivery(this, fields, auth); }
  reuseDecision(id) {
    return coordinationInternals.reuseDecision(this._reuseDecisions, id);
  }
  reuseSubjectHead(subjectDigest) {
    return coordinationInternals.reuseSubjectHead(this, subjectDigest);
  }
  currentReuseDecision(subjectDigest) { return coordinationLedger.currentReuseDecision(this, subjectDigest); }
  reuseRiskGuard(coordinate) {
    return coordinationInternals.reuseRiskGuard(this._reuseRiskGuards, coordinate);
  }
  reuseProviderGuard(repoId, coordinate) { return coordinationLedger.reuseProviderGuard(this, repoId, coordinate); }
  reuseAdverseState(repoId, coordinate) { return coordinationLedger.reuseAdverseState(this, repoId, coordinate); }
  reuseDecisionAdmission(key, requestDigest) { return coordinationAdmission.reuseDecisionAdmission(this, key, requestDigest); }

  reuseRiskAdmission(key, requestDigest) { return coordinationAdmission.reuseRiskAdmission(this, key, requestDigest); }

  recordReuseRiskGuard(fields, auth) { return coordinationLedger.recordReuseRiskGuard(this, fields, auth); }

  reuseTtlAdmission(key, requestDigest) { return coordinationAdmission.reuseTtlAdmission(this, key, requestDigest); }

  recordReuseTtlInvalidation(fields, auth) { return coordinationLedger.recordReuseTtlInvalidation(this, fields, auth); }

  recordReuseDecision(fields, auth) { return coordinationLedger.recordReuseDecision(this, fields, auth); }

  supersedeArtifact(oldId, newId, expectedVersion, auth) { return coordinationLedger.supersedeArtifact(this, oldId, newId, expectedVersion, auth); }
  admitRecoveryAttempt(fields, auth) {
    return coordinationReplay.admitRecoveryAttempt(this, fields, auth);
  }
  completeRecoveryAttempt(fields, auth) {
    return coordinationReplay.completeRecoveryAttempt(this, fields, auth);
  }
  recoveryAttempt(attemptId) {
    return coordinationReplay.recoveryAttempt(this, attemptId);
  }
  recoveryAttemptHead(seriesId) {
    return coordinationReplay.recoveryAttemptHead(this, seriesId);
  }
  pendingRecoveryAttempts(limit = 1_000) {
    return coordinationReplay.pendingRecoveryAttempts(this, limit);
  }

  recordDriver(kind, payload, auth) { return coordinationLedger.recordDriver(this, kind, payload, auth); }

  /** Issue #10 D5 Arm 1: the durable ceiling-deferral receipt. Minted at the coordinator's
   * `_dispatchPass` concurrencyCeiling skip, once per task dispatch — idempotency-keyed
   * (`task.dispatch_deferred:<taskId>:<taskCreatedSeq>`), so re-skips never re-mint. The payload
   * is MINT-TIME data (inFlight is frozen, never live queue depth). */
  deferTaskDispatch(fields, auth) { return coordinationLedger.deferTaskDispatch(this, fields, auth); }

  /** Authority refusals are their own durable event kind (never a driver.recorded wrapper), so
   * the coordinator's typed refusal surfaces on the store ledger as `authority.rejected` — the
   * seam's coaching payload rides the event payload directly (Decision 5). */
  recordAuthorityRejected(payload, auth) { return coordinationLedger.recordAuthorityRejected(this, payload, auth); }

  // -------------------------------------------------------------------------
  // BD3-B context packs — a server-owned supersession chain per family. A pack is minted with
  // a family (= type), a bounded body, a validity deadline, and an optional predecessor that
  // MUST be the current live head (a stale predecessor refuses context_pack_stale). The store
  // maintains the head per family; superseded versions stay resolvable as content history.
  // Expiry is distinct from supersession: an expired pack refuses materialization with
  // context_pack_expired without ever being superseded.
  // -------------------------------------------------------------------------
  _prepareContextPackPayload(fields) {
    return coordinationInternals._prepareContextPackPayload(this, fields);
  }

  mintContextPack(fields, auth) { return coordinationLedger.mintContextPack(this, fields, auth); }
  contextPack(packId) {
    return coordinationInternals.contextPack(this._contextPacks, packId);
  }
  contextPackHead(family) {
    return coordinationInternals.contextPackHead(this, family);
  }

    materializeContextPack(packId) { return coordinationLedgerWrites.materializeContextPack(this, packId); }

  // -------------------------------------------------------------------------
  // D9 (epic #103) — the wave.closed campaign-state record. A wave driver appends exactly one
  // closed-shape record per wave in the guaranteed post-close window; the replay fold derives a
  // _waveClosures map by waveId. The record is advisory (non-gating) and clock-free: its own event
  // seq is the epoch anchor for closedAtEventSeq (G10).
  // -------------------------------------------------------------------------

  _validateWaveClosedPayload(fields) { return coordinationAdmission._validateWaveClosedPayload(fields); }

  appendWaveClosed(fields, auth) { return coordinationLedger.appendWaveClosed(this, fields, auth); }

  /** #161 (D2/P6): the at-wave-close plan elevation, folded from the closure itself. Completed
   * tasks keep done and gain DURABLE elevation evidence links (plan.task_evidence_linked on this
   * ledger, never a hand-edited projection field); a doing task reverts to todo for the next wave
   * (the honest remainder) through the registered plan_auto_demote batch. No silent
   * auto-promotion: an unreviewed or incomplete task never reads done. The reviewed-reject
   * re-open (done -> todo, H4.2) stays the surfaced review-authority write — the hook never
   * re-opens. Replay re-folds the appended events; this hook runs at admission only. */
  _planElevationAtWaveClose(waveId, auth, closedEventSeq) { return coordinationLedger._planElevationAtWaveClose(this, waveId, auth, closedEventSeq); }
  waveClosure(waveId) {
    return coordinationInternals.waveClosure(this._waveClosures, waveId);
  }
  /** #286 G-31: the CURRENT run -> wave binding (last write wins), the one reading of "which wave
   * does this run sit in now" that the coordinator's `_waveIdOf`/`_waveRoleOf` share. */
  waveBinding(runId) {
    return coordinationInternals.waveBinding(this._waveBindings, runId);
  }
  waveClosures() {
    return coordinationInternals.waveClosures(this._waveClosures);
  }

  // D2.3 (epic #132): the wave registry projection read — the open+closed rows of the
  // replay-derived _waveRegistry map, cloned so a reader never mutates the projection.
  waveRegistry() {
    return coordinationInternals.waveRegistry(this._waveRegistry);
  }

  /** Issue #465(2): the ONE reader of a spill row — the digest-addressed identity the fold kept
   * (spillId, digest, `bytes` — the body's exact length — lane, the observed seqs) with the body
   * resolved from the `spill.minted` ledger row the row references. Every caller that used to
   * receive the row with the body inline (`mintSpill`, `materializeSpill`) receives exactly that,
   * composed in one place; a reference that cannot be read answers null, never the text of another
   * spill. */
  _resolvedSpill(spillId) { return coordinationAdmission._resolvedSpill(this, spillId); }

  // #161: the plan-object projection reads — cloned snapshots so a reader never mutates the
  // replay-derived _campaignPlans map (folds apply events; they never authorize, H2.3).
  /** Validate against current state before appending: rejected edits must never poison replay. */
  recordSwarm(kind, payload, auth) { return coordinationLedger.recordSwarm(this, kind, payload, auth); }
  swarm(swarmId) {
    return coordinationInternals.swarm(this._swarms, swarmId);
  }
  swarms() {
    return coordinationInternals.swarms(this._swarms);
  }

  // Membership changes do not change the native session's turn protocol. Once recruited as
  // a continuing participant, a Run remains pausable even after leaving or closing its group.
  hasSwarmParticipantRun(runId) { return coordinationAdmission.hasSwarmParticipantRun(this._swarms, runId); }
  campaignPlans() {
    return coordinationInternals.campaignPlans(this._campaignPlans);
  }
  campaignPlan(planId) {
    return coordinationInternals.campaignPlan(this._campaignPlans, planId);
  }

  // #161 (G4/H1.1): the idempotency-keyed prior event for a plan mutation key — the write lane's
  // replay adjudication (exactly-once retries) without exposing the raw _byKey index.
  priorCoordinationEvent(key) {
    return coordinationInternals.priorCoordinationEvent(this._byKey, key);
  }

  // #161 (H2.2): the wave-role roster run resolution — ownedBy.run (null, pre-decomposed) resolves
  // from the steering.registered fold at claim time.
  waveRoleRun(waveId, waveRole) {
    return coordinationInternals.waveRoleRun(this._waveRoleRuns, waveId, waveRole);
  }

  ledgerHeadSeq() { return coordinationLedger.ledgerHeadSeq(this._events); }

  // -------------------------------------------------------------------------
  // Epic #103 — the orchestrator-briefing composition (D1/D8). Composition reads ONLY store
  // projections the orchestrator lane owns: the wave.closed campaign-state records (D9) and the
  // live snapshot(); the standing-law list is the ONE named non-ledger input (D8/OQ2, pinned
  // deployment config). Unknown fields refuse by name (F15); degradation runs the pinned order
  // until the body fits or briefing_pack_overflow with the drop ledger.
  // -------------------------------------------------------------------------
  composeBriefingPack(rawInput) {
    return coordinationInternals.composeBriefingPack(rawInput);
  }

  composeCampaignBriefing(standingLaws = []) {
    const closures = this.waveClosures();
    const latest = closures.length > 0 ? closures[closures.length - 1] : null;
    const lawListDigest = canonicalDigest(standingLaws);
    return this.composeBriefingPack({
      schemaVersion: 1, family: BRIEFING_FAMILY,
      composedAtEventSeq: this._events.length + 1,
      rings: latest?.rings ?? [], lanes: latest?.lanes ?? [],
      landings: closures.map((record) => ({
        waveId: record.waveId, closedAtEventSeq: record.closedAtEventSeq,
        gates: {
          admitted: record.knowledge?.admittedThisRun ?? 0,
          refused: record.settlementErrors?.length ?? 0,
          candidatesAwaitingAdmission: record.knowledge?.candidatesAwaitingAdmission ?? 0,
        },
        receiptDigest: record.receiptDigest,
      })),
      parked: latest?.parked ?? [], blockedOn: latest?.blockedOn ?? [],
      standingLaws, sources: { snapshotDigest: canonicalDigest(this.snapshot()), lawListDigest },
    });
  }

  backfillBriefingPack({ family }, auth) { return coordinationLedger.backfillBriefingPack(this, { family }, auth); }

  // -------------------------------------------------------------------------
  // Decision 4 — the spill lane. Digest-addressed durable artifacts (spill:sha256:<digest>),
  // content-addressed and idempotent by auth key, with a 1 MiB ceiling (spill.body, blocker 3).
  // Spill lives exactly as long as its referencing receipt; reaping is Open question 1 (deferred,
  // safe under the ceiling).
  // -------------------------------------------------------------------------

  mintSpill(fields, auth) { return coordinationLedger.mintSpill(this, fields, auth); }

    materializeSpill(spillId) { return coordinationLedgerWrites.materializeSpill(this, spillId); }

  /** Epic #81 (O-6): append an attempt-scoped context.pack_granted receipt, atomically with the
   * spawn binding and BEFORE provider dispatch. Idempotent by the caller key (the coordinator
   * derives task+pack-scoped keys so a retried spawn of the same attempt never mints a second
   * grant, while two attempts citing the same head hold two grants — authority never collapses). */
    grantContextPack(fields, auth) { return coordinationLedgerWrites.grantContextPack(this, fields, auth); }
  reapExpiredContextPacks(repoId) {
    return coordinationReplay.reapExpiredContextPacks(this, repoId);
  }

  /** BD3-A: the read-lane audit class — bounded, content-digested, and deliberately NOT the
   * scratch.read family (zero promotion weight; minScratchReaders never counts these). */
  recordContextRead(fields, auth) { return coordinationLedger.recordContextRead(this, fields, auth); }

  /** Epic #81 (O-2): per-attempt constructive receipt ceilings — count AND byte bounds checked
   * BEFORE append. No clock (campaign law); the bound is the constructive flood control. */
  _assertOrientationReceiptCeiling(payload) { return coordinationAdmission._assertOrientationReceiptCeiling(this, payload); }

  /** Epic #81 (O-4): a hub-derived KG Source node per orientation module coordinate — the anchor
   * curated-overlay leaves Cite. Source is a closed KG node type; the coordinate is the overlay's
   * citation identity (match/omit decisions ride moduleDigest + freshnessDigest). */
  mintOrientationSource(fields, auth) { return coordinationLedger.mintOrientationSource(this, fields, auth); }

  /** Epic #81 (O-2/O-4): orientation.candidate.propose. The candidate is hub-minted observed
   * (callers supply only {packDigest, leafDigest}); it verifies the proposing attempt previously
   * received the orientation surface (a context.read receipt or an operator Source), coalesces
   * duplicates by {leafDigest, freshnessDigest}, and is bounded by the per-attempt proposal
   * ceiling. Never caller-authored body/grounding/scope. */
    proposeOrientationCandidate({ leafDigest, packDigest }, auth) { return coordinationLedgerWrites.proposeOrientationCandidate(this, { leafDigest, packDigest }, auth); }

  /** Epic #81 (O-4): merge generated module structure with the curated overlay. A curated leaf
   * applies only on EXACT moduleDigest + freshnessDigest match; a stale leaf is omitted WITH
   * structured trace (overlay_dangling) and the generated map serves partial; conflicting live
   * leaves without a Supersedes winner all omit with overlay_conflict (never event-time/insertion
   * order). Generated structure always answers for the requested coordinate. */
  mergeOrientationMap({ moduleDigest, moduleKey, freshnessDigest, repoId: repoIdArg } = {}) { return coordinationLedger.mergeOrientationMap(this, { moduleDigest, moduleKey, freshnessDigest, repoId: repoIdArg }); }

  /** Epic #81 (O-7): the closed rating event. The hub mints orientation.rating_recorded with the
   * attempt identity (hub-derived — the worker is verified against the task record, never trusted
   * from transport) and a prior grant/read proof. One rating per task attempt: exact replay
   * returns the prior event, an opposite same-pack rating refuses orientation_rating_conflict,
   * and a second pack under the same attempt refuses the constant orientation_rating_refused. */
  recordOrientationRating({ packDigest, rating }, auth) { return coordinationLedger.recordOrientationRating(this, { packDigest, rating }, auth); }

    _orientationLatestSource() { return coordinationLedgerWrites._orientationLatestSource(this); }

  /** #286 G-45: the LATEST `context.read` receipt for one worker — the freshness digest and
   * citation seq the orientation lane reads — as a fold lookup, never a ledger scan. */
    orientationReadLatest(workerId) { return coordinationLedgerWrites.orientationReadLatest(this, workerId); }

    _orientationWorkerFreshness(workerId) { return coordinationLedgerWrites._orientationWorkerFreshness(this, workerId); }

  /** #286 G-45: the FIRST `context.read` receipt for one (worker, pack) — the receipt an
   * orientation rating cites — as a fold lookup, never a ledger scan. */
    orientationReadHead(workerId, packDigest) { return coordinationLedgerWrites.orientationReadHead(this, workerId, packDigest); }

    _orientationCandidate(leafDigest, freshnessDigest) { return coordinationLedgerWrites._orientationCandidate(this, leafDigest, freshnessDigest); }

  _assertOrientationProposalCeiling(workerId) { return coordinationAdmission._assertOrientationProposalCeiling(this, workerId); }

  /** BD3-C: append-only lane audit receipts (message.sent / message.delivered). The delivery
   * state machine (delivered/read/actedOn/reply) is process-scoped coordinator state. */
  recordMessage(kind, fields, auth) { return coordinationLedger.recordMessage(this, kind, fields, auth); }
  recordRecoveryContinuationIntent(fields, auth) {
    return coordinationReplay.recordRecoveryContinuationIntent(this, fields, auth);
  }
  completeRecoveryDispatch(fields, auth) {
    return coordinationReplay.completeRecoveryDispatch(this, fields, auth);
  }
  integrationAuthority(taskId, operationalEvent) {
    return coordinationInternals.integrationAuthority(this, taskId, operationalEvent);
  }

  completeIntegration(fields, auth) { return coordinationLedger.completeIntegration(this, fields, auth); }

  /** Verify the complete post-effect publication authority tuple during replay. Merely finding a
   * promoted decision is insufficient: the mapped operational digest, paired driver record,
   * adjacency, batch-key lineage, task, evidence, and publication payload must all agree. */
  publicationAuthority(taskId, operationalEvent) {
    return coordinationInternals.publicationAuthority(this, taskId, operationalEvent);
  }

  /** Atomically make a post-effect publication authoritative. The operational completion may
   * already exist because the publisher is an outside effect; neither the graph decision nor the
   * driver completion is visible unless both append in one fs write. */
  completePublication(fields, auth) { return coordinationLedger.completePublication(this, fields, auth); }

  postScratchFact(fields, auth) { return coordinationLedger.postScratchFact(this, fields, auth); }

  /** Bind an oracle Brief to the exact durable Scratch assertion without asking a caller to
   * echo or nominate any source fields. The private snapshot is returned only to Coordinator. */
  scratchFactOracleTarget(id, repoId, maxTargetBytes) {
    return coordinationInternals.scratchFactOracleTarget(this, id, repoId, maxTargetBytes);
  }

  expireScratchFact(id, auth) { return coordinationLedger.expireScratchFact(this, id, auth); }

  claimScratch(fields, auth) { return coordinationLedger.claimScratch(this, fields, auth); }

  expireScratchClaim(id, expectedVersion, auth) { return coordinationLedger.expireScratchClaim(this, id, expectedVersion, auth); }

  activeScratchClaims({ workerId = null, taskId = null } = {}) { return coordinationLedger.activeScratchClaims(this._scratchClaims, { workerId, taskId }); }

  checkScratch(resource, envRef) { return coordinationAdmission.checkScratch(this, resource, envRef); }

  readScratch(resource, envRef, reader, auth) { return coordinationLedger.readScratch(this, resource, envRef, reader, auth); }

  // -------------------------------------------------------------------------
  // Issue #33 scratchpad — typed worker writes, pure scoped reads, and the two
  // settlement boundaries. All projection mutation remains in _apply above.
  // -------------------------------------------------------------------------
  scratchpadFence(runId, scope) {
    return coordinationInternals.scratchpadFence(this._scratchpadFences, runId, scope);
  }
  scratchpadSnapshotBatch(runId, scopes, options = {}) {
    return coordinationInternals.scratchpadSnapshotBatch(this, runId, scopes, options);
  }

  scratchpadSnapshot(runId, scope, options = {}) { return coordinationLedger.scratchpadSnapshot(this, runId, scope, options); }
  _scratchpadResolveForWorker(runId, workerId, entryId, entryDigest, requirement = {}) {
    return coordinationInternals._scratchpadResolveForWorker(this._scratchpadEntries, runId, workerId, entryId, entryDigest, requirement);
  }

  writeScratchpad(fields, auth) { return coordinationLedger.writeScratchpad(this, fields, auth); }

  // Issue #158 — the surface append verb's write (the unlanded tight-cell D-depth-2 direct
  // shared-tier write, G8). The entry's scope is EXPLICIT — `shared` or a member partition —
  // while the author identity is server-bound to auth.principalId (H1.3), never a caller field
  // (D2.1 excludes workerId). The D1 scope law is enforced at the surface authorize seam; this
  // fold only enforces the closed envelope, the declared partition caps (D3: 128 worker / 512
  // shared), and the _byKey replay binding {kind, actor, runId, taskId, workerId, contentDigest}
  // with NO scope term (P-A4 — the surface disambiguates the two-scope verb's keys by namespacing
  // every key by scope, H3.1). Absent caller keys derive run.scratchpad.append:<runId>:<scope>:
  // <contentDigest> (OQ2) so the surface need not compute the kernel's content digest. A written
  // append is workflow-ephemeral (law 4): it never mints a scratch-fact / KG candidacy.
  appendScratchpad(fields, auth) { return coordinationLedger.appendScratchpad(this, fields, auth); }
  _scratchpadReapReceipt(prior, result = 'idempotent') {
    return coordinationReplay._scratchpadReapReceipt(this, prior, result);
  }

  elevateTaskScratchpad(fields, auth) { return coordinationLedger.elevateTaskScratchpad(this, fields, auth); }

  settleWorkflowScratchpad(fields, auth) { return coordinationLedger.settleWorkflowScratchpad(this, fields, auth); }
  /** #286 G-41: `deadlineAt` is the caller's own recorded stop deadline; without one the pass reaps
   * every partition of the stopping run (there is no partition-count ceiling any more). */
  reapRunScratchpads(runId, opts = {}) {
    return coordinationReplay.reapRunScratchpads(this, runId, opts);
  }

  // -------------------------------------------------------------------------
  // REFLEX-2 boards (issue #17, docs/32 §3.2). Immutable versioned items with
  // successor versions and claim migration keyed to itemId (F8); a board-scoped,
  // replay-derivable fence — NEVER the worker FenceTable (F9); non-evented reads
  // (no board.read event kind; a poll never appends to the ledger — F10).
  // -------------------------------------------------------------------------

  /** The board fence: the count of admitted orchestrator-authority events for the board,
   * derived purely by re-counting in _apply. Replay reconstructs it exactly. */
  boardFence(board) {
    return coordinationInternals.boardFence(this._boardFences, board);
  }

  /** KG-1 Part A rule 5 (P1-1 fix): store-level, global, replay-derived counter incremented once
   * per applied event of a kind that can change a task/workflow projection's output without
   * already being counted by boardFence's five orchestrator-authority transitions. */
  projectionInputFence() { return coordinationLedger.projectionInputFence(this._projectionInputFence); }

  /** KG-1 Part A rule 4: the project horizon fence — the store's own applied-event position,
   * already a strict superset of every other fence component. */
  eventFence() {
    return coordinationInternals.eventFence(this._events);
  }

  _boardAdmissionFailure(message, code) { return coordinationAdmission._boardAdmissionFailure(message, code); }

  /** S-2 v2's single serialized authority entry for transported/facade board commands.
   * Shape is closed before any state lookup. The caller supplies the session proof; identity is
   * recovered only from the matching lease. The final fence/parent compare is repeated by the
   * append's before-write gate, so no adapter-side check-then-write window exists. */
  admitBoardCommand(envelope) { return coordinationAdmission.admitBoardCommand(this, envelope); }

  postBoardItem(fields, auth, appendGate = null, boardAdmission = null) { return coordinationLedger.postBoardItem(this, fields, auth, appendGate, boardAdmission); }

  /** A successor version under the SAME itemId (immutable prior version retained). If a granted
   * claim exists, a benign edit (retitle/reorder) carries it forward via board.claim_migrated —
   * the worker is never forced to re-claim (F8, rule 3). */
  _boardSuccessor(itemId, kind, changes, auth, appendGate = null, boardAdmission = null) { return coordinationLedger._boardSuccessor(this, itemId, kind, changes, auth, appendGate, boardAdmission); }

  retitleBoardItem(itemId, fields, auth, appendGate = null, boardAdmission = null) { return coordinationLedger.retitleBoardItem(this, itemId, fields, auth, appendGate, boardAdmission); }

  reorderBoardItem(itemId, ordinal, auth, appendGate = null, boardAdmission = null) { return coordinationLedger.reorderBoardItem(this, itemId, ordinal, auth, appendGate, boardAdmission); }

  closeBoardItem(itemId, auth, appendGate = null, boardAdmission = null) { return coordinationLedger.closeBoardItem(this, itemId, auth, appendGate, boardAdmission); }

  dropBoardItem(itemId, auth, appendGate = null, boardAdmission = null) { return coordinationLedger.dropBoardItem(this, itemId, auth, appendGate, boardAdmission); }

  /** First claim wins, exactly-once, only if expectedBoardFence === boardFence(board) at apply
   * time (F9, rule 8); else stale_board_fence (rejected, cheap re-read). Never the worker fence.
   * Epic #78 Decision 6 rule 3: prior-key lookups digest-adjudicate — changed content under one
   * key refuses board_replay_conflict, never a blind return of the old success. `beforeWrite`
   * (the seam's in-append gate, Decision 3 step 7) re-checks the fence/item/open/claim state
   * inside the append window. */
  requestBoardClaim(fields, auth, beforeWrite = null) { return coordinationLedger.requestBoardClaim(this, fields, auth, beforeWrite); }

  /** A report binds the EXACT (itemVersion, itemDigest) the worker observed; a later retitle can
   * never silently re-point its evidence (F8, rule 3). Epic #78 Decision 6 rule 3: prior-key
   * lookups digest-adjudicate (changed content/op under one key refuses board_replay_conflict).
   * The envelope coordinates (claimVersion, ownerTask, grantDigest) are derived from the active
   * claim — authority, not content, so they are excluded from the request digest. `beforeWrite`
   * (the seam's in-append gate, Decision 3 step 7) re-checks the item-open/claim-owner/version
   * state inside the append window. */
  submitBoardReport(fields, auth, beforeWrite = null) { return coordinationLedger.submitBoardReport(this, fields, auth, beforeWrite); }

  /** Version-CAS expiry mirroring expireScratchClaim; returns the item to claimable (never a
   * phantom done). Does not bump the board fence (F9, rule 7). Epic #78 Decision 6 rule 3:
   * prior-key lookups digest-adjudicate — changed expiry content under one key refuses
   * board_replay_conflict, never a stale success. */
  expireBoardClaim(itemId, expectedVersion, auth) { return coordinationLedger.expireBoardClaim(this, itemId, expectedVersion, auth); }

  activeBoardClaims({ workerId = null, taskId = null } = {}) { return coordinationLedger.activeBoardClaims(this._boardClaims, { workerId, taskId }); }
  boardItem(itemId) {
    return coordinationInternals.boardItem(this._boardItems, itemId);
  }
  boardItemVersions(itemId) {
    return coordinationInternals.boardItemVersions(this._boardItemHistory, itemId);
  }

  /** Non-evented board read (F10, rule 9): a poll appends nothing to the ledger and drives the
   * per-board indexed item map, never a full claim/fact scan. */
  boardSnapshot(board) { return coordinationLedger.boardSnapshot(this, board); }

  // -------------------------------------------------------------------------
  // Epic #78 (board worker-half) — worker grants, the worker admission seam, and
  // the grant-scoped L1 read lane (Decisions 2/3/5). All state derives from
  // board.grant_minted / board.grant_revoked / worker.generation_bound events.
  // -------------------------------------------------------------------------
  boardGrant(grantId) {
    return coordinationInternals.boardGrant(this._boardGrants, grantId);
  }

  activeBoardGrants({ workerId = null, taskId = null } = {}) { return coordinationLedger.activeBoardGrants(this._boardGrants, { workerId, taskId }); }
  workerGeneration(workerId) {
    return coordinationInternals.workerGeneration(this._workerGenerations, workerId);
  }

  /** A2-3: the durable per-worker generation record. processGeneration is currently only an
   * in-memory worker-handle property; without this event replay cannot derive which grants a
   * replacement generation invalidates. Appended at worker (re)attachment/spawn. */
  recordWorkerGeneration(fields, auth) { return coordinationLedger.recordWorkerGeneration(this, fields, auth); }

  /** #201 A3: the successor-incarnation orphan scan — tasks claimed by workers whose durable
   * generation is absent from the caller's live-worker set (or parked retry_pending) surface
   * as reclaimable. Pure read over the replayed ledger: a task with an assignee whose LAST
   * worker.generation_bound names a generation the caller did not present is an orphan; a task
   * claimed by a live worker, unclaimed, or terminal never surfaces. */
  orphans({ liveWorkers = [] } = {}) {
    return coordinationReplay.orphans(this, { liveWorkers });
  }

  /** Decision 2: the durable grant revoke. Every terminator (member task terminalization,
   * reassignment, process generation replacement, member Run/wave stop) appends one
   * board.grant_revoked event naming the cause; replay derives active/revoked solely from the
   * mint and revoke events. */
    revokeBoardGrants({ workerId = null, taskId = null, cause = null, reason = null }, auth) { return coordinationLedgerWrites.revokeBoardGrants(this, { workerId, taskId, cause, reason }, auth); }

  /** The S-2-shaped worker admission seam for claim/report (Decision 3). One entry point from
   * every adapter. Steps in order: (1) close the wire shape; (2) resolve+prove the grant against
   * the authenticated worker/task/generation; (3) derive scope from the grant; (4) verify board
   * binding, grant permission, and Run/wave state before item existence; (5) normalize the
   * request digest; (6) authority-before-replay — the effective key is namespaced
   * <opKind>:<grantDigest>:<callerKey> so cross-worker/cross-op collisions cannot occur; (7) the
   * kernel's in-append CAS re-check (final fence/item/open/claim gate). An absent, revoked,
   * foreign, or generation-stale grant receives the SAME constant board_worker_scope_refused
   * before any board/item lookup. */
  admitWorkerBoardCommand({ kind, grantId, payload, workerId, taskId, taskVersion, processGeneration, idempotencyKey }) { return coordinationAdmission.admitWorkerBoardCommand(this, { kind, grantId, payload, workerId, taskId, taskVersion, processGeneration, idempotencyKey }); }

  /** Decision 2/3: the S-2-shaped grant mint behind waves.send claimGrant. The caller names no
   * grantee and no permissions; the hub proves the orchestrator's session authority, resolves
   * the member coordinates server-side, derives the wave, verifies board binding and wave
   * membership, records the orchestrator-selected permission subset, and durably mints one
   * closed grant BEFORE the steer is deliverable. The effective replay key
   * <grant.mint>:<grantDigest>:<callerKey> plus the caller-key digest index make an exact retry
   * exactly-once and a changed-content retry a typed board_replay_conflict. */
  mintBoardGrant(entry, auth) { return coordinationLedger.mintBoardGrant(this, entry, auth); }
  _taskByRun(runId) {
    return coordinationInternals._taskByRun(this._tasks, runId);
  }
  _waveMembershipOf(runId) {
    return coordinationInternals._waveMembershipOf(this._events, runId);
  }

  // -------------------------------------------------------------------------
  // Decision 5 — the grant-scoped L1 board read. One board, every item (unowned open work
  // included), stable pages of at most 16 items and 28 KiB, stable (ordinal,itemId) ordering,
  // in-item report continuation by (itemId, lastReportSeq), and typed board_oversize_item
  // truncation. The cursor digest binds grant digest, board, board Run, member Run, page
  // position, and both fence components.
  // -------------------------------------------------------------------------

  boardGrantPage({ grantId, cursor, workerId, taskId, taskVersion, processGeneration }) { return coordinationLedger.boardGrantPage(this, { grantId, cursor, workerId, taskId, taskVersion, processGeneration }); }

  _mintBoardCursor(grant, { page, itemId = null, lastReportSeq = null }) { return coordinationLedger._mintBoardCursor(this, grant, { page, itemId, lastReportSeq }); }

  _verifyBoardCursor(cursor, grant) { return coordinationLedger._verifyBoardCursor(this, cursor, grant); }
  _sortedBoardItems(board) {
    return coordinationInternals._sortedBoardItems(this, board);
  }

  _reportsForItem(itemId) { return coordinationLedger._reportsForItem(this._boardReports, itemId); }
  _boardGrantItemRow(item, frame) {
    return coordinationInternals._boardGrantItemRow(this._boardClaims, item, frame);
  }
  _boardGrantReportRow(report, frame) {
    return coordinationInternals._boardGrantReportRow(report, frame);
  }

  _renderBoardGrantPage(grant, state) { return coordinationLedger._renderBoardGrantPage(this, grant, state); }

  // -------------------------------------------------------------------------
  // REPL-3 branch resolution (repl23-decisions.md Part F rules 17-19). Wired into the real
  // REPL-1 admission path (admitReplManifest pre-normalization splice): ordinary branches are
  // caller-submitted and hub-validated; `cell:`-typed branches are resolved here at admission —
  // settled-only (rule 18) — and their five coordinate fields are entirely hub-computed, never
  // accepted from the caller for that branch kind.
  // -------------------------------------------------------------------------

  /** Normalizes one caller-submitted ReplManifest branch. An ordinary
   * branch is caller-submitted and hub-validated; a `cell:`-typed branch (REPL-3, Part F rule
   * 17-19) is resolved here at admission — settled-only (rule 18) — and its five coordinate
   * fields (digest/ref/itemCount/mediaType/summary) are entirely hub-computed, never accepted
   * from the caller for that branch kind. */
  _resolveReplManifestBranch(branch) { return coordinationAdmission._resolveReplManifestBranch(this, branch); }

  // -------------------------------------------------------------------------
  // REPL-2 (issue #22, repl23-decisions.md): named bindings, immutable versions under
  // (runId, scope, name); no `repl.read` event kind (F10); cached, non-evented reads own the
  // per-(runId, scope) fence (Part C/D). Never the board fence or FenceTable (Part I).
  // -------------------------------------------------------------------------

  /** The binding fence: EVERY write to (runId, scope) — worker writes included, unlike
   * boardFence's orchestrator-authority-only carve-out (Part C rule 7). Replay-derivable,
   * never a separately durable counter (rule 8). */
  bindingFence(runId, scope) {
    return coordinationInternals.bindingFence(this._replBindingFences, runId, scope);
  }

  admitReplBinding(fields, auth) { return coordinationAdmission.admitReplBinding(this, fields, auth); }

  dropReplBinding(fields, auth) { return coordinationLedger.dropReplBinding(this, fields, auth); }

  /** Non-evented read (F10, rule 10): a poll appends nothing to the ledger. Active bindings
   * only (state: 'bound'), one row per name keyed to its latest version (Part D rule 11). */
  replBindingSnapshot(runId, scope) { return coordinationLedger.replBindingSnapshot(this, runId, scope); }

  /** `repl:<scope>:<name>@<version>` resolves the EXACT (runId, scope, name, bindingVersion)
   * row from history — never "latest" — even if the binding has since been dropped or
   * superseded (Part A rule 2; Part E rule 15). */
  resolveReplCitation(runId, citation) { return coordinationAdmission.resolveReplCitation(this._replBindingHistory, runId, citation); }

  _knowledgeFailure(message, code, integrity = false) { return coordinationAdmission._knowledgeFailure(message, code, integrity); }
  _knowledgePayload(fields, extras = {}) {
    return coordinationInternals._knowledgePayload(fields, extras);
  }

  _validateKnowledgeContent(fields, integrity = false) { return coordinationAdmission._validateKnowledgeContent(this, fields, integrity); }

  _knowledgeLiveAt(row, at) { return coordinationLedger._knowledgeLiveAt(row, at); }

  _validateKnowledgeEvidence(evidence = [], eventSeq = this._events.length + 1, integrity = false) { return coordinationAdmission._validateKnowledgeEvidence(this, evidence, eventSeq, integrity); }

  _validateKnowledgeTimes(fields, integrity = false) { return coordinationAdmission._validateKnowledgeTimes(this, fields, integrity); }

  _validateKnowledgeNodePayload(fields, event, integrity = false) { return coordinationAdmission._validateKnowledgeNodePayload(this, fields, event, integrity); }
  _supersessionWouldCycle(from, to) {
    return coordinationInternals._supersessionWouldCycle(this._knowledgeEdges, from, to);
  }

  _validateKnowledgeEdgePayload(fields, event, integrity = false) { return coordinationAdmission._validateKnowledgeEdgePayload(this, fields, event, integrity); }

  _deriveKnowledgePromotion(repoId, observedSeq, policy, beforeEventSeq = this._events.length + 1) { return coordinationAdmission._deriveKnowledgePromotion(this, repoId, observedSeq, policy, beforeEventSeq); }

  _promotionProjection(payload, event = null) { return coordinationLedger._promotionProjection(payload, event); }

  _validateKnowledgePromotionPayload(payload, event, integrity = false) { return coordinationAdmission._validateKnowledgePromotionPayload(this, payload, event, integrity); }

  promoteKnowledgeBatch(repoId, observedSeq, policy, auth, beforeAppend = null) { return coordinationLedger.promoteKnowledgeBatch(this, repoId, observedSeq, policy, auth, beforeAppend); }

  reverifyKnowledgePromotion(repoId, observedSeq, policy, actor, eventSeq) { return coordinationAdmission.reverifyKnowledgePromotion(this, repoId, observedSeq, policy, actor, eventSeq); }

  reverifyKnowledgePromotionNoOp(repoId, observedSeq, policy) { return coordinationAdmission.reverifyKnowledgePromotionNoOp(this, repoId, observedSeq, policy); }

  _scratchCorrectionRequest(request) {
    return coordinationInternals._scratchCorrectionRequest(request);
  }
  _scratchCorrectionPrefix(observedSeq) {
    return coordinationInternals._scratchCorrectionPrefix(this._events, observedSeq);
  }

  _eligibleScratchOracle(repoId, factRow, oracleTaskId, state, nodeMap) { return coordinationAdmission._eligibleScratchOracle(this, repoId, factRow, oracleTaskId, state, nodeMap); }

  _deriveScratchCorrection(repoId, observedSeq, policy, rawRequest, beforeEventSeq = this._events.length + 1) { return coordinationAdmission._deriveScratchCorrection(this, repoId, observedSeq, policy, rawRequest, beforeEventSeq); }

  _scratchCorrectionProjection(payload, event = null) { return coordinationLedger._scratchCorrectionProjection(payload, event); }

  _validateScratchCorrectionPayload(payload, event, integrity = false) { return coordinationAdmission._validateScratchCorrectionPayload(this, payload, event, integrity); }

  correctScratchKnowledge(repoId, observedSeq, policy, request, auth, beforeAppend = null) { return coordinationLedger.correctScratchKnowledge(this, repoId, observedSeq, policy, request, auth, beforeAppend); }

  reverifyScratchCorrection(repoId, observedSeq, policy, actor, eventSeq, request) { return coordinationAdmission.reverifyScratchCorrection(this, repoId, observedSeq, policy, actor, eventSeq, request); }

  // -------------------------------------------------------------------------
  // KG-2 Part D (rule 14): the settle-time orchestrator-admit gate. A new event kind,
  // structurally modeled on knowledge.scratch_corrected (not a reuse of
  // knowledge.promotion_batch — that event's validator re-derives its candidate set from the
  // scratch/verified-outcome scan policy and would reject a board/package Finding candidate).
  // -------------------------------------------------------------------------

  /** Rule 15 eligibility, checked against the state strictly before beforeEventSeq (so a replay
   * of this exact event reproduces the identical derivation regardless of what happened after
   * it was first applied — the same discipline _deriveScratchCorrection uses). Rule 17: the
   * admitted Finding's evidence carries the candidate's own evidence plus
   * { coordinationSeq: candidate.observedSeq } — the candidate's own, necessarily-prior minting
   * seq — never this event's own prospective seq (P1-2 fix). */
  _deriveWorkflowAdmission(repoId, runId, candidateFindingId, policy, beforeEventSeq = this._events.length + 1) { return coordinationAdmission._deriveWorkflowAdmission(this, repoId, runId, candidateFindingId, policy, beforeEventSeq); }

  _validateWorkflowAdmissionPayload(payload, event, integrity = false) { return coordinationAdmission._validateWorkflowAdmissionPayload(this, payload, event, integrity); }

  /** Rule 16: two store-enforced checks, neither a free-string actor. (a) promotionActor — only
   * 'orchestrator'/'operator:<id>', the same guard promoteKnowledgeBatch already enforces. (b) an
   * active run-orchestrator lease bound into the request, validated exactly as
   * _validateRunLineageAdmission already does for child-run admission — a consistency/ordering
   * device layered on the single-writer trust model, not an independent authority proof. */
  admitWorkflowFinding(repoId, runId, candidateFindingId, policy, auth, lease) { return coordinationAdmission.admitWorkflowFinding(this, repoId, runId, candidateFindingId, policy, auth, lease); }

  addKnowledgeNode(fields, auth) { return coordinationLedger.addKnowledgeNode(this, fields, auth); }

  _prepareKnowledgeNode(fields, promotion = null, validate = true) { return coordinationAdmission._prepareKnowledgeNode(this, fields, promotion, validate); }

  promoteKnowledgeNode(fields, promotion, auth) { return coordinationLedger.promoteKnowledgeNode(this, fields, promotion, auth); }

  addKnowledgeEdge(fields, auth) { return coordinationLedger.addKnowledgeEdge(this, fields, auth); }

  _contradictionListRequest(request, policy) {
    return coordinationInternals._contradictionListRequest(this, request, policy);
  }

  listKnowledgeContradictions(repoId, rawRequest, policy) { return coordinationLedger.listKnowledgeContradictions(this, repoId, rawRequest, policy); }

  _contradictionResolutionRequest(request, policy) {
    return coordinationInternals._contradictionResolutionRequest(request, policy);
  }

  _deriveBoundedContradictionResolution(repoId, observedSeq, policy, rawRequest, beforeEventSeq = this._events.length + 1) { return coordinationAdmission._deriveBoundedContradictionResolution(this, repoId, observedSeq, policy, rawRequest, beforeEventSeq); }

  _boundedContradictionResolutionProjection(payload, event = null) { return coordinationLedger._boundedContradictionResolutionProjection(payload, event); }

  _validateBoundedContradictionResolutionPayload(payload, event, integrity = false) { return coordinationAdmission._validateBoundedContradictionResolutionPayload(this, payload, event, integrity); }

  resolveKnowledgeContradictionBounded(repoId, observedSeq, policy, rawRequest, auth, beforeAppend = null) { return coordinationLedger.resolveKnowledgeContradictionBounded(this, repoId, observedSeq, policy, rawRequest, auth, beforeAppend); }

  reverifyKnowledgeContradictionResolution(repoId, observedSeq, policy, actor, eventSeq, rawRequest) { return coordinationAdmission.reverifyKnowledgeContradictionResolution(this, repoId, observedSeq, policy, actor, eventSeq, rawRequest); }

  _validateContradictionResolution(fields, integrity = false, actor = null) { return coordinationAdmission._validateContradictionResolution(this, fields, integrity, actor); }

  _validateKnowledgeInvalidation(fields, event, integrity = false) { return coordinationAdmission._validateKnowledgeInvalidation(this, fields, event, integrity); }

  _validateContaminationRecord(fields, event, integrity = false) { return coordinationAdmission._validateContaminationRecord(this, fields, event, integrity); }

  resolveKnowledgeContradiction(fields, auth) { return coordinationLedger.resolveKnowledgeContradiction(this, fields, auth); }

  /** KG-3 rule 3: the KG's last-applied graph event seq — the `max` observedSeq over the folded
   * knowledge node + edge history, or 0 when empty. NOT `this._events.length`: a non-KG event
   * (task claim, lifecycle) does not advance it, so previews are served from cache through
   * dispatch bursts and recompute only when a node/edge actually folds. Derived from folded
   * state, so replay reconstructs the identical fence. */
  _knowledgeProjectFence() {
    return coordinationInternals._knowledgeProjectFence(this);
  }

  /** KG-4 rule 15/15a: read-time MAD confidence over a Finding body. Exposed for direct
   * verification; the preview overlays it via madConfidenceOf. Never stored node state. */
  _madConfidence(body, maxMetrics = 100_000) {
    return coordinationInternals._madConfidence(body, maxMetrics);
  }

  /** KG-4 rule 16: read-time staleness overlay. `unreferenced` is scoped to *evented* reads
   * (`_knowledgeReads`); preview traffic is non-evented (Part A) so it never counts as a
   * reference. Read-time only — never a stored flag, never a mutation. */
  _knowledgeStaleness(node, fence, liveContradictNodeIds, liveSupersedeTargetIds, staleAfterSeq) {
    return coordinationInternals._knowledgeStaleness(this._knowledgeReads, node, fence, liveContradictNodeIds, liveSupersedeTargetIds, staleAfterSeq);
  }
  _cachePreview(key, value, previewPolicy) {
    return coordinationInternals._cachePreview(this, key, value, previewPolicy);
  }

  /** KG-3 Parts A/C/D/F/G: a pure, non-evented, LRU-cached, fail-open read projection that
   * reuses the recall candidate/graph/ranking body (`_buildKnowledgeRecall`) with every append
   * path severed. Overlays the KG-4 read-time `confidence` (MAD) and `staleness`, ranks
   * contradiction parties first with `warning:true`, and peels the ranked tail before ever
   * degrading. Returns a RecallPreview or, on a ceiling breach, a `briefingUnavailable:true`
   * marker — never throws except on a caller-shape fault (`causal_recall_invalid`). */
  recallPreview(repoId, request, policy) {
    if (typeof repoId !== 'string' || !policy || typeof policy !== 'object' || Array.isArray(policy)
      || Object.keys(policy).sort().join(',') !== 'preview,recall'
      || !validKnowledgeRecallPolicy(policy.recall) || policy.recall.repoId !== repoId
      || !validKnowledgePreviewPolicy(policy.preview)) {
      throw new CoordinationRefusal('knowledge preview policy is invalid', 'causal_recall_invalid');
    }
    const recallPolicy = policy.recall; const previewPolicy = policy.preview;
    const allowed = new Set(['text', 'types', 'grounding', 'seedNodeIds', 'limit']);
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some((key) => !allowed.has(key))
      || typeof request.text !== 'string' || request.text.trim().length === 0 || request.text.includes('\0') || !validUnicodeScalarString(request.text)
      || !Number.isSafeInteger(request.limit) || request.limit <= 0 || request.limit > recallPolicy.maxResults) {
      throw new CoordinationRefusal('knowledge preview request is invalid', 'causal_recall_invalid');
    }
    const terms = recallTerms(request.text);
    if (terms.length === 0) throw new CoordinationRefusal('knowledge preview query has no searchable terms', 'causal_recall_invalid');
    const types = request.types ?? []; const grounding = request.grounding ?? []; const seedNodeIds = request.seedNodeIds ?? [];
    if (!Array.isArray(types) || new Set(types).size !== types.length || types.some((type) => !KNOWLEDGE_NODE_TYPES.has(type))
      || !Array.isArray(grounding) || new Set(grounding).size !== grounding.length || grounding.some((value) => !KNOWLEDGE_GROUNDINGS.has(value))
      || !Array.isArray(seedNodeIds) || new Set(seedNodeIds).size !== seedNodeIds.length || seedNodeIds.length > request.limit || seedNodeIds.some((id) => !boundedText(id, 4_096))) {
      throw new CoordinationRefusal('knowledge preview filters or seeds are invalid', 'causal_recall_invalid');
    }
    const projectFence = this._knowledgeProjectFence();
    const observedAt = this.observationTime(projectFence);
    const degrade = (reason, extra = {}) => freeze({ schemaVersion: 1, repoId, projectFence, briefingUnavailable: true, reason, ...extra, nodes: [], contradictions: [] });
    if (Buffer.byteLength(request.text) > recallPolicy.maxQueryBytes || terms.length > recallPolicy.maxQueryTerms) {
      return degrade('causal_recall_oversize');
    }
    // Rule 10a: pre-filter seeds against current eligibility so the body's :12876 seed gate can
    // never fire on ordinary KG churn; dropped seeds are counted, never silently discarded.
    const eligibleNodes = this.queryKnowledge({ observedSeq: projectFence, asOf: observedAt })
      .filter((node) => (types.length === 0 || types.includes(node.type)) && (grounding.length === 0 || grounding.includes(node.grounding)));
    const eligibleMap = new Map(eligibleNodes.map((node) => [node.id, node]));
    const seedsDropped = seedNodeIds.filter((id) => !eligibleMap.has(id)).sort();
    const eligibleSeeds = seedNodeIds.filter((id) => eligibleMap.has(id)).sort();
    const query = freeze({
      schemaVersion: 1,
      normalizedTextDigest: canonicalDigest(normalizedRecallText(request.text)),
      termDigests: terms.map((term) => canonicalDigest(term)).sort(),
      types: [...types].sort(), grounding: [...grounding].sort(), seedNodeIds: [...eligibleSeeds].sort(),
      limit: request.limit, observedSeq: projectFence, asOf: observedAt,
    });
    const cacheKey = `${repoId}\0${projectFence}\0${canonicalDigest(query)}\0${canonicalDigest(previewPolicy)}`;
    const hit = this._previewCache.get(cacheKey);
    if (hit !== undefined) { this._previewCache.delete(cacheKey); this._previewCache.set(cacheKey, hit); return hit; }

    let projection; let contradictionPeeled = 0;
    try {
      projection = this._buildKnowledgeRecall(query, recallPolicy);
    } catch (error) {
      if (!(error instanceof CoordinationRefusal) || error.code !== 'causal_recall_oversize') throw error;
      if (!/contradiction bundle/.test(error.message)) {
        return this._cachePreview(cacheKey, degrade('causal_recall_oversize'), previewPolicy);
      }
      // Rule 11a: contradiction-peel. Re-run against the maxResults ceiling with a shrinking
      // SELECTION cap, preserving the top node + its live-Contradicts peers, until the bundle
      // fits. Only a single-node bundle that still overflows degrades — with contradictionFlood.
      const peelQuery = freeze({ ...query, limit: recallPolicy.maxResults });
      let peeled = null;
      for (let selectionLimit = request.limit - 1; selectionLimit >= 1; selectionLimit -= 1) {
        try { peeled = this._buildKnowledgeRecall(peelQuery, recallPolicy, { selectionLimit }); contradictionPeeled = request.limit - selectionLimit; break; }
        catch (peelError) { if (!(peelError instanceof CoordinationRefusal) || peelError.code !== 'causal_recall_oversize' || !/contradiction bundle/.test(peelError.message)) throw peelError; }
      }
      if (peeled === null) {
        return this._cachePreview(cacheKey, degrade('causal_recall_oversize', { contradictionFlood: true }), previewPolicy);
      }
      projection = peeled;
    }

    const fenceEdges = this.queryKnowledgeEdges({ observedSeq: projectFence, asOf: observedAt });
    const incident = new Map();
    const liveContradictNodeIds = new Set(); const liveSupersedeTargetIds = new Set();
    for (const edge of fenceEdges) {
      if (edge.type === 'Contradicts') { liveContradictNodeIds.add(edge.from); liveContradictNodeIds.add(edge.to); }
      if (edge.type === 'Supersedes') liveSupersedeTargetIds.add(edge.to);
      if (edge.type === 'ReadBy') continue;
      for (const id of [edge.from, edge.to]) incident.set(id, (incident.get(id) ?? 0) + 1);
    }
    const warningIds = new Set(); for (const edge of projection.contradictions) { warningIds.add(edge.from); warningIds.add(edge.to); }
    const rows = projection.nodes.map((pn) => {
      const full = eligibleMap.get(pn.id);
      const termScore = pn.score - (pn.reason?.graphScore ?? 0);
      const edgeDegree = incident.get(pn.id) ?? 0;
      const evidenceCount = full?.evidence?.length ?? 0;
      const eventSeq = full?.eventTimeSeq ?? full?.observedSeq ?? pn.eventTimeSeq ?? pn.observedSeq ?? 0;
      const recency = projectFence > 0 ? Math.max(0, Math.min(1, eventSeq / projectFence)) : 0;
      const composite = previewPolicy.weightTerm * termScore + previewPolicy.weightEdgeDegree * edgeDegree
        + previewPolicy.weightEvidence * evidenceCount + previewPolicy.weightRecency * recency;
      const confidence = full?.type === 'Finding' ? madConfidenceOf(full.body, recallPolicy.maxCandidates) : null;
      const staleness = full ? this._knowledgeStaleness(full, projectFence, liveContradictNodeIds, liveSupersedeTargetIds, previewPolicy.staleAfterSeq) : null;
      return { ...clone(pn), composite, confidence, staleness, warning: warningIds.has(pn.id) };
    });
    rows.sort((a, b) => (Number(b.warning) - Number(a.warning)) || (b.composite - a.composite) || compareCanonicalStrings(a.id, b.id));
    const publicQuery = { normalizedTextDigest: query.normalizedTextDigest, termDigests: [...query.termDigests], types: [...query.types], grounding: [...query.grounding], seedNodeIds: [...query.seedNodeIds], limit: query.limit };
    const core = { schemaVersion: 1, repoId, projectFence, asOf: observedAt, query: publicQuery, nodes: rows, contradictions: clone(projection.contradictions), seedsDropped, contradictionPeeled, briefingUnavailable: false };
    return this._cachePreview(cacheKey, freeze({ ...core, projectionDigest: canonicalDigest(core) }), previewPolicy);
  }

  /** KG-4 rules 12–14: auto-link on admission, restricted to Supports/Refines/Cites (edges carry
   * NO grounding — v2-P2-9). The wave proposes scored candidates; this admits only allowed types
   * clearing their per-type threshold, each under a DETERMINISTIC `auth.key` so a re-proposal is a
   * clean idempotent no-op (v2-P2-10). Contradicts/Supersedes are never auto-minted — the store
   * refuses them (rule 13 red test drives that path directly). Every drop is counted, never
   * silently discarded (No-Arbitrary-Limits honesty). */
  autoLinkKnowledgeNode(nodeId, candidates, policy, auth) { return coordinationLedger.autoLinkKnowledgeNode(this, nodeId, candidates, policy, auth); }

  queryKnowledge(query = {}) { return coordinationLedger.queryKnowledge(this, query); }

  queryKnowledgeEdges(query = {}) { return coordinationLedger.queryKnowledgeEdges(this, query); }

  _prepareKnowledgeRecall(request, policy, actor) { return coordinationLedger._prepareKnowledgeRecall(this, request, policy, actor); }

  _buildKnowledgeRecall(query, policy, opts = {}) { return coordinationLedger._buildKnowledgeRecall(this, query, policy, opts); }

  _validateKnowledgeRecallPayload(payload, event, integrity = false) { return coordinationAdmission._validateKnowledgeRecallPayload(this, payload, event, integrity); }

  _newKnowledgeRecallReceipt(prepared) { return coordinationLedger._newKnowledgeRecallReceipt(this, prepared); }

  #knowledgeRecallPreview(request, policy, auth) { return coordinationLedger.knowledgeRecallPreview(this, request, policy, auth); }

  recallKnowledgeBounded(request, policy, auth, beforeAppend = null) { return coordinationLedger.recallKnowledgeBounded(this, request, policy, auth, beforeAppend); }

  reverifyKnowledgeRecall(request, policy, actor, eventSeq) { return coordinationLedger.reverifyKnowledgeRecall(this, request, policy, actor, eventSeq); }
  _recallAssessmentCandidate(receipt, observedSeq) {
    return coordinationInternals._recallAssessmentCandidate(this, receipt, observedSeq);
  }

  _buildKnowledgeRecallAssessment(repoId, observedSeq, policy, actor, assessmentEventSeq = this._events.length + 1) { return coordinationLedger._buildKnowledgeRecallAssessment(this, repoId, observedSeq, policy, actor, assessmentEventSeq); }

  _validateKnowledgeRecallAssessmentPayload(payload, event, integrity = false) { return coordinationAdmission._validateKnowledgeRecallAssessmentPayload(this, payload, event, integrity); }

  _newKnowledgeRecallAssessment(repoId, observedSeq, policy, auth) { return coordinationLedger._newKnowledgeRecallAssessment(this, repoId, observedSeq, policy, auth); }

  assessKnowledgeRecallBatch(repoId, observedSeq, policy, auth, beforeAppend = null) { return coordinationLedger.assessKnowledgeRecallBatch(this, repoId, observedSeq, policy, auth, beforeAppend); }

  reverifyKnowledgeRecallAssessment(repoId, observedSeq, policy, actor, eventSeq) { return coordinationLedger.reverifyKnowledgeRecallAssessment(this, repoId, observedSeq, policy, actor, eventSeq); }
  recallAssessments({ nodeId = null, taskId = null, observedSeq = this._events.length } = {}) {
    return coordinationInternals.recallAssessments(this, { nodeId, taskId, observedSeq });
  }

  readKnowledge(query, reader, auth) { return coordinationLedger.readKnowledge(this, query, reader, auth); }

  // KG activation rules 2/3/4/5 — additive projections over the existing knowledge records. They
  // read nodes/edges/events and never mutate; the admit gate (admitWorkflowFinding) stays the only
  // promotion path. The candidacy queue is derived from the store's candidate Findings (never stored
  // twice); the ritual counts feed the wave receipt / terminal outline; the content digest feeds the
  // workflow horizon's knowledgeDigest (cache-correct — content-addressed, recomputed only on a fence
  // miss, byte-identical when the knowledge content is unchanged).
  static get KNOWLEDGE_CANDIDATE_TRIGGERS() {
    return coordinationInternals.KNOWLEDGE_CANDIDATE_TRIGGERS();
  }

  /** A content-addressed digest of the live knowledge graph (nodes + edges). Stable across non-
   * knowledge state moves; moves whenever a node/edge is added, invalidated, or superseded. */
  knowledgeContentDigest() { return coordinationLedger.knowledgeContentDigest(this); }

  /** Rule 2: the candidacy queue — a first-class projection over the store's candidate Findings.
   * A candidate is a live Finding minted by one of the four source kinds, not yet admitted (no
   * DerivedFrom edge from a `workflow.admitted` finding to it). Bounded ≤ 16, stable minting order,
   * derived live (never stored twice). Admitting removes exactly that candidate. */
  knowledgeCandidateQueue({ now } = {}) { return coordinationLedger.knowledgeCandidateQueue(this, { now }); }

  /** Rule 3: the ritual counts — `candidates` (pending queue size, repo-scoped) and
   * `admittedThisRun` (workflow admits bound to this run). Zero is surfaced as 0, never a missing
   * field. Ergonomics only — the admit decision stays manual and gated. */
  knowledgeRitual(runId, { now } = {}) { return coordinationLedger.knowledgeRitual(this, runId, { now }); }

  invalidateKnowledge(nodeId, expectedValidityVersion, reason, auth) { return coordinationLedger.invalidateKnowledge(this, nodeId, expectedValidityVersion, reason, auth); }
  affectedReaders(nodeId) {
    return coordinationInternals.affectedReaders(this, nodeId);
  }
  traceKnowledge(nodeId) {
    return coordinationInternals.traceKnowledge(this, nodeId);
  }

  traceKnowledgeBounded(nodeId, options = {}) {
    const observedSeq = options.observedSeq ?? this._events.length; const maxDepth = options.maxDepth; const maxRows = options.maxRows; const maxEvidenceRefs = options.maxEvidenceRefs; const maxStateRows = options.maxStateRows; const maxNodes = options.maxNodes; const maxEdges = options.maxEdges;
    if (typeof nodeId !== 'string' || !Number.isSafeInteger(observedSeq) || observedSeq < 0 || observedSeq > this._events.length || !Number.isSafeInteger(maxDepth) || maxDepth < 0 || !Number.isSafeInteger(maxRows) || maxRows <= 0 || !Number.isSafeInteger(maxEvidenceRefs) || maxEvidenceRefs <= 0
      || !Number.isSafeInteger(maxStateRows) || maxStateRows <= 0 || !Number.isSafeInteger(maxNodes) || maxNodes <= 0 || !Number.isSafeInteger(maxEdges) || maxEdges <= 0) throw new CoordinationRefusal('causal trace request is invalid', 'causal_trace_invalid');
    if (this._knowledgeNodeHistory.size > maxNodes || this._knowledgeEdgeHistory.size > maxEdges || this._knowledgeNodeHistory.size + this._knowledgeEdgeHistory.size > maxStateRows) throw new CoordinationRefusal('causal trace exceeded deployment state ceiling', 'causal_trace_oversize');
    const allNodes = this.queryKnowledge({ observedSeq }); const allEdges = this.queryKnowledgeEdges({ observedSeq });
    const nodeMap = new Map(allNodes.map((node) => [node.id, node])); if (!nodeMap.has(nodeId)) throw new CoordinationRefusal(`unknown or non-current knowledge node ${nodeId}`, 'not_found');
    const causalTypes = new Set(['Supports', 'Contradicts', 'Supersedes', 'Informed', 'ProducedBy', 'Contains', 'DependsOn', 'Refines', 'VerifiedBy', 'DerivedFrom', 'Affects', 'Cites', 'ObservedIn']);
    const incident = new Map(); for (const edge of allEdges.filter((row) => causalTypes.has(row.type) && nodeMap.has(row.from) && nodeMap.has(row.to)).sort((a, b) => compareCanonicalStrings(a.id, b.id))) for (const id of [edge.from, edge.to]) { const rows = incident.get(id) ?? []; rows.push(edge); incident.set(id, rows); }
    const queue = [{ id: nodeId, depth: 0 }]; const seenNodes = new Set(); const seenEdges = new Set(); const selectedNodes = []; const selectedEdges = []; const frontier = new Set(); let evidenceRefs = 0;
    const assertRows = () => { if (selectedNodes.length + selectedEdges.length + evidenceRefs + frontier.size > maxRows || evidenceRefs > maxEvidenceRefs) throw new CoordinationRefusal('causal trace exceeded deployment ceiling', 'causal_trace_oversize'); };
    while (queue.length > 0) {
      const current = queue.shift(); if (seenNodes.has(current.id)) continue; const node = nodeMap.get(current.id); if (!node) continue;
      seenNodes.add(current.id); frontier.delete(current.id); selectedNodes.push(node); evidenceRefs += (node.evidence?.length ?? 0); assertRows();
      const edges = incident.get(current.id) ?? [];
      if (current.depth >= maxDepth) { for (const edge of edges) { const next = edge.from === current.id ? edge.to : edge.from; if (!seenNodes.has(next)) frontier.add(next); } continue; }
      for (const edge of edges) {
        if (!seenEdges.has(edge.id)) { seenEdges.add(edge.id); selectedEdges.push(edge); evidenceRefs += (edge.evidence?.length ?? 0); assertRows(); }
        const next = edge.from === current.id ? edge.to : edge.from; if (!seenNodes.has(next)) queue.push({ id: next, depth: current.depth + 1 });
      }
    }
    for (const id of seenNodes) frontier.delete(id); assertRows();
    const safeNode = (node) => Object.fromEntries(['id', 'type', 'grounding', 'observedSeq', 'eventTimeSeq', 'validFrom', 'validTo', 'validityVersion'].filter((key) => Object.hasOwn(node, key)).map((key) => [key, clone(node[key])]));
    const safeEdge = (edge) => Object.fromEntries(['id', 'type', 'from', 'to', 'observedSeq', 'eventTimeSeq', 'validFrom', 'validTo', 'validityVersion', 'resolvedBy', 'winnerId', 'loserId'].filter((key) => Object.hasOwn(edge, key)).map((key) => [key, clone(edge[key])]));
    const evidence = [...selectedNodes, ...selectedEdges].flatMap((row) => (row.evidence ?? []).map((ref) => ({ ownerId: row.id, ...clone(ref) })));
    return freeze({ nodeId, observedSeq, observedAt: this.observationTime(observedSeq), complete: frontier.size === 0, frontier: [...frontier].sort(), nodes: selectedNodes.sort((a, b) => compareCanonicalStrings(a.id, b.id)).map(safeNode), edges: selectedEdges.sort((a, b) => compareCanonicalStrings(a.id, b.id)).map(safeEdge), evidence });
  }

  auditKnowledge(options = {}) { return coordinationLedger.auditKnowledge(this, options); }
}

/** Issue #290: the standalone repair verb for a store whose replay already refuses — the state a
 * poisoned older ledger leaves after a restart. It probes with the REAL startup path first: the
 * ledger that replays clean is refused by name. The entry is recorded durably beside the ledger
 * (never a hand edit of events.jsonl) and the deployment then restarts with the event's fold
 * skipped. seq must name exactly the seq the startup failure reported. */
export async function quarantineCoordinationLedgerEvent(root, { seq, reason, actor } = {}) {
  if (typeof root !== 'string' || root.length === 0 || root.includes('\0')) throw new TypeError('coordination quarantine root is invalid');
  if (!Number.isSafeInteger(seq) || seq <= 0) throw new TypeError('coordination quarantine requires a positive safe integer seq');
  if (typeof reason !== 'string' || reason.length === 0) throw new TypeError('coordination quarantine requires a non-empty reason');
  if (typeof actor !== 'string' || actor.length === 0) throw new TypeError('coordination quarantine requires a non-empty actor');
  const existing = coordinationReplay.quarantineEntries(root).find((entry) => entry.seq === seq);
  let failure = null;
  try {
    // The probe holds no writer lease (leases are claimed lazily on write) and performs no
    // writes; it exists to reproduce exactly the startup the deployment will attempt.
    new CoordinationStore(root);
  } catch (error) {
    failure = {
      code: error?.code ?? 'coordination_startup_failed',
      seq: error?.coordinationSeq ?? null,
      kind: error?.coordinationKind ?? null,
      message: error?.message ?? String(error),
    };
  }
  if (!failure) {
    throw Object.assign(new CoordinationRefusal(
      'coordination ledger replays clean — quarantine is not warranted; this verb only records a fold refusal an operator has already observed',
      'coordination_quarantine_replays_clean',
    ), { detail: { requestedSeq: seq } });
  }
  if (failure.seq !== seq) {
    throw Object.assign(new CoordinationRefusal(
      `coordination replay refuses at ${failure.seq === null ? 'an unsequenced failure' : `seq ${failure.seq}`} (${failure.code}), not seq ${seq}`,
      'coordination_quarantine_refused',
    ), { detail: { requestedSeq: seq, failureSeq: failure.seq, failureCode: failure.code } });
  }
  const probed = writeQuarantineEntry(root, freeze({
    schemaVersion: 1, seq, kind: failure.kind ?? 'unknown',
    causeCode: failure.code, reason, actor, ts: new Date().toISOString(),
  }));
  return { ok: true, result: probed.duplicate ? 'already-quarantined' : 'quarantined', entry: probed.entry };
}

/** Offline-only canonical-order compatibility cut. This acquires the same exclusive writer lease
 * as the live store, validates/replays the exact raw prefix, commits only the private receipt, and
 * never rewrites a coordination byte. It is intentionally absent from Coordinator/web/MCP. */
export function migrateCanonicalOrderLedger(root, options) {
  if (typeof root !== 'string' || root.length === 0 || root.includes('\0')) throw new TypeError('canonical-order migration root is invalid');
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some((key) => !['clock', 'migration', 'policy'].includes(key))
    || !options.policy || !options.migration || (options.clock !== undefined && typeof options.clock !== 'function')) {
    throw new TypeError('canonical-order offline migration options are invalid');
  }
  const policy = normalizeCanonicalOrderPolicy(options.policy);
  const migration = normalizeCanonicalOrderMigration(options.migration, policy);
  const store = new CoordinationStore(root, {
    canonicalOrderPolicy: policy,
    [CANONICAL_ORDER_MIGRATION]: migration,
    ...(options.clock ? { clock: options.clock } : {}),
  });
  store.claimWriterLease();
  try {
    const receipt = store.canonicalOrderReceipt();
    if (!receipt) throw new CoordinationRefusal('canonical-order migration did not commit a receipt', 'canonical_order_migration_invalid');
    return receipt;
  } finally { store.releaseWriterLease({ requireOwned: true }); }
}

/** Convenience for explicit hand-wired assemblies and tests. Production `createDriver()` still
 * chooses and owns the path itself; Coordinator never synthesizes an optional sidecar. */
export function coordinationForLog(log, root = join(log.dir, 'coordination')) {
  if (!log || typeof log.read !== 'function' || typeof log.dir !== 'string') throw new TypeError('coordinationForLog requires a durable Log');
  return new CoordinationStore(root, {
    operationalRead: (worker, seq) => log.read(worker, seq).find((event) => event.seq === seq) ?? null,
  });
}

/** Issue #351 lane 2: the loop-friendly open — a module-level factory beside the other
 * hand-wired assemblies, deliberately NOT an open-time member of the class census: the
 * constructor's synchronous load stays the store's one authoritative open. The replay runs
 * chunked at the registry's own `view.wake_replay.items` bound with a yield to the event loop
 * between chunks, so a startup heartbeat (and a signal handler) keeps beating however long the
 * history is. The returned store is fully loaded; every fold error rejects the promise. */
export async function openCoordinationStoreAsync(root, opts = {}) {
  const store = new CoordinationStore(root, { ...opts, deferLoad: true });
  await coordinationReplay._load(store, { async: true });
  return store;
}

/** Issue #351 lane 3: the same loop-friendly replay, driven on a store the caller constructed
 * (the production `createDriver` assembles the store with its own policy wiring, defers the
 * load, claims the writer lease, and awaits THIS). Every fold error rejects the promise — the
 * #304 replay-refusal contract, typed as ever, now from the async open. */
export async function loadCoordinationStoreAsync(store) {
  if (!(store instanceof CoordinationStore)) throw new TypeError('loadCoordinationStoreAsync requires a CoordinationStore');
  if (store._deferredLoad !== true) throw new TypeError('loadCoordinationStoreAsync requires a deferLoad-constructed store');
  await coordinationReplay._load(store, { async: true });
  // Issue #434: the projection now exists — appends are admitted and the ledger/projection
  // equality check (#331's reload) is live again.
  store._deferredLoad = false;
  return store;
}
