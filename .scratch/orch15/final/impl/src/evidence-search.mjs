// evidence-search.mjs — deployment-wide evidence and contribution search (issue #312).
//
// #318 landed `evidence.search` over ONE swarm: the seeded knowledge facts, found by free
// text, participant or knowledge kind, with a cursor derived from the ledger seq. #312
// retrieves across the deployment: knowledge AND contributions, filtered by swarm,
// participant, kind, path and free text, with a cursor that pages by the ledger's own seq.
//
// This module is the ONE canonical operation every surface derives from: the
// `baton evidence search` CLI command (application-cli.mjs), the `baton_evidence_search` MCP
// tool (mcp-northbound.mjs) and the participant bridge verb (swarm-native-bridge.mjs) all
// shape, schema and document from HERE — never a second implementation per surface.
//
// The search is backed by a per-deployment index REBUILT from the coordination ledger on
// every call (`rebuildEvidenceIndex` reads only `store.swarms()` and `store.eventsView()`),
// never a second store of truth: there is nothing persisted, nothing cached, nothing to go
// stale — a row exists in the index exactly when its ledger event exists. The page boundary
// derives from the same `wire.frame` row the bridge answers under, and the cursor IS the
// ledger head seq — never a page count, never a page cap (the #318 cursor law, kept across
// the deployment).
//
// Row sources:
//   knowledge    — `knowledge.node_added` / `knowledge.promoted` rows, attributed to their
//                  swarm through the participants' run identities (a row whose run names no
//                  seated participant is skipped, exactly like the single-swarm read).
//   contribution — `swarm.contribution_recorded` rows, which carry their swarm and author on
//                  the row itself.
// Filters (all optional; absent names everything):
//   swarmId       — the swarm the row belongs to. Absent searches the whole deployment.
//   participantId — the author seat.
//   kind          — the knowledge node type (Finding, Question, …); a contribution matches
//                   when its object body names `type` or `kind`, else a kind filter excludes it.
//   path          — case-sensitive substring over the row's path-bearing strings: its refs,
//                   its work identity, and path-like body text (strings containing `/` or
//                   `\`). Free mentions without a slash are free text — use `query` for those.
//   query         — case-insensitive substring over the body text plus the row's identities
//                   (node/contribution id, refs, work).
//   afterSeq      — the ledger seq to resume after; every returned row sorts after it.
import { FRAME_LIMITS } from './limits.mjs';

const ID_PATTERN = '^[A-Za-z0-9._:-]{1,256}$';

// The free-text shape bound the search text fields share (mirrors the #318 registry query
// cap; a schema shape bound on an uncataloged lane, not a cataloged byte lane — hence the
// single F1 exemption row instead of a registry import).
const MAX_SEARCH_TEXT_BYTES = 4096;

/** The filter names the canonical operation accepts — the closed vocabulary. */
export const EVIDENCE_SEARCH_FILTERS = Object.freeze(
  ['swarmId', 'participantId', 'kind', 'path', 'query', 'afterSeq']);

/** The canonical input shape: every surface's schema derives from THIS row, so the CLI
 * flags, the MCP tool properties and the bridge help can never disagree about what the
 * operation takes. Descriptions are the teaching the bridge help renders. */
export const EVIDENCE_SEARCH_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    swarmId: Object.freeze({ type: 'string', minLength: 1, maxLength: 256, pattern: ID_PATTERN,
      description: 'the swarm to search; omit to search the whole deployment (a participant bridge call fills in your own swarm)' }),
    participantId: Object.freeze({ type: 'string', minLength: 1, maxLength: 256, pattern: ID_PATTERN,
      description: 'the author seat; omit for every participant' }),
    kind: Object.freeze({ type: 'string', minLength: 1, maxLength: 256,
      description: 'the knowledge node type (Finding, Question, …); a contribution matches when its body names type or kind' }),
    path: Object.freeze({ type: 'string', minLength: 1, maxLength: MAX_SEARCH_TEXT_BYTES,
      description: 'a path substring, matched case-sensitively over refs, work and path-like body text' }),
    query: Object.freeze({ type: 'string', minLength: 1, maxLength: MAX_SEARCH_TEXT_BYTES,
      description: 'free text, matched case-insensitively over body text and row identities' }),
    afterSeq: Object.freeze({ type: 'integer', minimum: 0,
      description: 'resume after this ledger seq; the answer cursors at the ledger head' }),
  }),
  required: Object.freeze([]),
});

const searchError = (message, field, rule, expectation) => Object.assign(new Error(message),
  { code: 'evidence_search_invalid', detail: { field, rule, expectation } });

const isId = (value) => typeof value === 'string' && new RegExp(ID_PATTERN, 'u').test(value);

/** Validate one search request against the canonical shape. Answers the normalized filters
 * (absent filters read null, afterSeq defaults to 0); anything else refuses typed with the
 * field, the rule and the expectation — the same closed-vocabulary posture the swarm
 * validators keep. A blank query is no text filter, like the single-swarm read. */
export function validateEvidenceSearchArgs(args) {
  if (args === undefined || args === null) return validateEvidenceSearchArgs({});
  if (typeof args !== 'object' || Array.isArray(args)) {
    throw searchError('Evidence search arguments must be one JSON object', null, 'arguments-shape', 'one JSON object');
  }
  const known = new Set(EVIDENCE_SEARCH_FILTERS);
  for (const key of Object.keys(args)) {
    if (!known.has(key)) {
      throw searchError(`Evidence search takes no field ${key}`, key, 'unknown-field',
        `one of ${EVIDENCE_SEARCH_FILTERS.join(', ')}`);
    }
  }
  const { swarmId = null, participantId = null, kind = null, path = null, query = null, afterSeq = 0 } = args;
  if (swarmId !== null && !isId(swarmId)) {
    throw searchError('Evidence search swarmId must name a swarm', 'swarmId', 'field-predicate', `matching ${ID_PATTERN}`);
  }
  if (participantId !== null && !isId(participantId)) {
    throw searchError('Evidence search participantId must name a participant', 'participantId', 'field-predicate', `matching ${ID_PATTERN}`);
  }
  if (kind !== null && (typeof kind !== 'string' || kind.length === 0 || kind.length > 256)) {
    throw searchError('Evidence search kind must be non-empty text', 'kind', 'field-predicate', 'at most 256 characters');
  }
  if (path !== null && (typeof path !== 'string' || path.length === 0 || path.length > MAX_SEARCH_TEXT_BYTES)) {
    throw searchError('Evidence search path must be non-empty text', 'path', 'field-predicate', `at most ${MAX_SEARCH_TEXT_BYTES} characters`);
  }
  let text = null;
  if (query !== null && query !== undefined) {
    if (typeof query !== 'string' || query.length > MAX_SEARCH_TEXT_BYTES) {
      throw searchError('Evidence search query must be text', 'query', 'field-predicate', `at most ${MAX_SEARCH_TEXT_BYTES} characters`);
    }
    if (query.trim().length > 0) text = query.trim();
  }
  if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
    throw searchError('Evidence search afterSeq must be a non-negative integer', 'afterSeq', 'field-predicate', 'at least 0');
  }
  return { swarmId, participantId, kind, path, query: text, afterSeq };
}

const contributionKindOf = (body) => {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const field of ['type', 'kind']) {
    if (typeof body[field] === 'string' && body[field].length > 0) return body[field];
  }
  return null;
};

/** Rebuild the deployment's evidence index from the coordination ledger: the participants'
 * run identities from the live swarm projection, then one row per knowledge and contribution
 * event in ledger order. Pure derivation — the caller passes any store with `swarms()`,
 * `eventsView()` and `ledgerHeadSeq()` (the real CoordinationStore); nothing is written. */
export function rebuildEvidenceIndex(store) {
  const ownerByRun = new Map();
  for (const swarm of store.swarms()) {
    for (const participant of Object.values(swarm.participants ?? {})) {
      if (typeof participant?.runId === 'string' && typeof participant?.participantId === 'string') {
        ownerByRun.set(participant.runId, { swarmId: swarm.swarmId, participantId: participant.participantId });
      }
    }
  }
  const rows = [];
  for (const event of store.eventsView()) {
    if (event.kind === 'knowledge.node_added' || event.kind === 'knowledge.promoted') {
      const payload = event.payload ?? {};
      const owner = ownerByRun.get(payload.runId);
      if (!owner) continue;
      rows.push({ source: 'knowledge', seq: event.seq, ts: event.ts,
        swarmId: owner.swarmId, participantId: owner.participantId, runId: payload.runId,
        nodeId: payload.id ?? null, kind: payload.type ?? null, grounding: payload.grounding ?? null,
        body: payload.body ?? null });
    } else if (event.kind === 'swarm.contribution_recorded') {
      const payload = event.payload ?? {};
      if (typeof payload.swarmId !== 'string' || typeof payload.participantId !== 'string') continue;
      const body = payload.body ?? null;
      rows.push({ source: 'contribution', seq: event.seq, ts: event.ts,
        swarmId: payload.swarmId, participantId: payload.participantId,
        contributionId: payload.contributionId ?? null, workId: payload.workId ?? null,
        refs: Array.isArray(payload.refs) ? [...payload.refs] : null,
        kind: contributionKindOf(body), body });
    }
  }
  return Object.freeze({ headSeq: store.ledgerHeadSeq(), rows: Object.freeze(rows) });
}

const stringLeaves = (value) => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringLeaves);
  return [];
};

const bodyTextOf = (body) => (typeof body === 'string' ? body : JSON.stringify(body ?? ''));

// The path-bearing strings of one row: its refs and work identity whole, plus the body
// strings that look like paths (they contain a slash) — a bare mention is free text, not a path.
const pathHaystackOf = (row) => [
  ...((row.refs ?? []).filter((ref) => typeof ref === 'string')),
  ...(typeof row.workId === 'string' ? [row.workId] : []),
  ...stringLeaves(row.body).filter((leaf) => leaf.includes('/') || leaf.includes('\\')),
];

const textHaystackOf = (row) => [
  bodyTextOf(row.body),
  row.contributionId ?? row.nodeId ?? '',
  ...((row.refs ?? []).filter((ref) => typeof ref === 'string')),
  typeof row.workId === 'string' ? row.workId : '',
].join('\n');

/** Search a rebuilt index under the canonical filters. Rows read in ledger order past
 * `afterSeq`; the page is framed under the `wire.frame` row (the first row is always kept,
 * never dropped for size) and the cursor is the index head — a truncated page still names
 * where the ledger stands, so the next call resumes past what it saw. */
export function searchEvidenceIndex(index, rawArgs) {
  const filters = validateEvidenceSearchArgs(rawArgs);
  const budget = FRAME_LIMITS['wire.frame'].value;
  const rows = [];
  let bytes = 0;
  let truncated = false;
  for (const row of index.rows) {
    if (row.seq <= filters.afterSeq) continue;
    if (filters.swarmId !== null && row.swarmId !== filters.swarmId) continue;
    if (filters.participantId !== null && row.participantId !== filters.participantId) continue;
    if (filters.kind !== null && row.kind !== filters.kind) continue;
    if (filters.path !== null && !pathHaystackOf(row).some((candidate) => candidate.includes(filters.path))) continue;
    if (filters.query !== null && !textHaystackOf(row).toLowerCase().includes(filters.query.toLowerCase())) continue;
    const size = Buffer.byteLength(JSON.stringify(row), 'utf8');
    if (rows.length > 0 && bytes + size > budget) { truncated = true; break; }
    rows.push(row);
    bytes += size;
  }
  return {
    swarmId: filters.swarmId,
    query: { ...filters },
    rows, cursor: index.headSeq, truncated,
  };
}

/** The canonical operation: validate, rebuild the index from the deployment's coordination
 * ledger, and search it — one call every surface serves. */
export function searchDeploymentEvidence(store, rawArgs) {
  return searchEvidenceIndex(rebuildEvidenceIndex(store), rawArgs);
}
