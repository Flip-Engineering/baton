// swarm-event-schemas.mjs — discoverable payload shapes for the PUBLIC swarm.update event kinds.
//
// One declarative source for every surface that describes swarm.update payloads: the contract's
// argument admission (swarm-contract.mjs), the MCP tool schema, CLI help, and root's swarm.view
// projection. Deliberately NOT a second domain validator: `validateSwarmEvent` (swarm-state.mjs,
// root-owned) remains the enforcement authority on the durable fold. This module DESCRIBES the
// shapes that validator enforces so agents never need to read code, and lets the contract refuse
// the cheapest wrong-shape mistake early — a missing caller-supplied field — with the same
// expectation text every other surface prints.
//
// Two rules keep the description honest without tightening the body into a rigid I/O language:
//   • `body` values stay arbitrary JSON (or plain text findings) — no field enumeration inside a
//     body, ever.
//   • Fields the runtime derives from the request identity are marked `autoFilled`, not demanded
//     of the caller: swarmId comes from the token scope, and author/reviewer/leave identities
//     derive from the caller (some stores demand them, some override them — either way the caller
//     omits them).
//
// No size or count limits are declared here — the runtime's frame-limit catalog owns size policy.

const SWARM_ID_FIELD = Object.freeze({
  description: 'the swarm the event applies to',
  required: true,
  autoFilled: 'from your token scope (args.swarmId); never write it inside the payload',
  type: 'string',
  expectation: 'a swarm identity',
  example: 'swarm-40e643e96fd1edcd',
});

const KIND = (summary, fields, example) => Object.freeze({
  summary: Object.freeze(summary),
  ...(example !== undefined ? { example: Object.freeze(example) } : {}),
  fields: Object.freeze(Object.fromEntries(Object.entries({ swarmId: SWARM_ID_FIELD, ...fields })
    .map(([name, field]) => [name, Object.freeze(field)]))),
});

const STRING = (description, extra = {}) => Object.freeze({
  type: 'string', description: Object.freeze(description), expectation: 'non-empty text', ...extra });
const JSON_VALUE = (description, extra = {}) => Object.freeze({
  type: 'json', description: Object.freeze(description),
  expectation: 'any JSON value — arbitrary, not a fixed record shape', ...extra });
const STRING_ARRAY = (description, extra = {}) => Object.freeze({
  type: 'array', items: 'non-empty text', description: Object.freeze(description),
  expectation: 'an array of non-empty strings', ...extra });
const VERSION = Object.freeze({
  type: 'integer', minimum: 0, description: 'optimistic-concurrency guard: the version the caller believes the row has',
  expectation: 'a non-negative integer', example: 0,
});
const AUTO = (autoFilled) => Object.freeze({ autoFilled: Object.freeze(autoFilled) });

/**
 * Per-kind payload schema for every kind the public `swarm.update` surface admits (the contract's
 * SWARM_EVENT_KINDS). `required` names what the durable store demands; `autoFilled` names the
 * required fields a caller may omit because the runtime derives them from the request identity.
 */
export const SWARM_EVENT_PAYLOAD_SCHEMAS = Object.freeze({
  'swarm.group_updated': KIND('create or replace one named group of participants', {
    groupId: STRING('the group identity to create or replace', { required: true, example: 'group-reviewers' }),
    members: STRING_ARRAY('the participant identities in the group; distinct', { required: true, example: ['ada', 'grace'] }),
    purpose: STRING('what this group is for', { example: 'independent review of the discovery lane' }),
    expectedVersion: VERSION,
  }),
  'swarm.work_updated': KIND('open or evolve one unit of work', {
    workId: STRING('the work identity', { required: true, example: 'work-discovery' }),
    objective: STRING('what the work is trying to achieve (required when the work is new; a status-only update keeps the recorded objective)', { required: true, optionalWhenExisting: 'the recorded objective of existing work is kept', example: 'map the native discovery lane' }),
    status: { type: 'string', enum: ['open', 'completed', 'cancelled'], required: false,
      description: 'the work lifecycle state', expectation: 'one of open, completed, cancelled', example: 'open' },
    expectedVersion: VERSION,
    basis: {
      type: 'json', required: false,
      description: 'completion evidence you cite when setting status completed without a derived accept: { contributionIds: [...] } naming accepted contributions that reference this work (by workId or refs)',
      expectation: 'an object with a contributionIds array of contribution identities',
      example: { contributionIds: ['contribution-ada-1'] },
    },
    dependsOn: {
      type: 'json', required: false,
      description: 'dependencies you DECLARE for this work: [{ workId: "W1" }] waits for W1 to hold an accepted contribution, [{ artifact: "name" }] waits for an accepted contribution that references that artifact. The declared set is replaced whole; omitting the field keeps it. A declaration is a record the swarm keeps honest — waiting never stops a worker, and the view shows each wait as settled or not with its evidence.',
      expectation: 'an array of objects each naming exactly one of workId or artifact',
      example: [{ workId: 'work-discovery' }],
    },
  }),
  'swarm.assignment_updated': KIND('bind one participant to one unit of work (or release them)', {
    assignmentId: STRING('the assignment identity', { required: true, example: 'assignment-ada-discovery' }),
    participantId: STRING('the assigned participant', { required: true, example: 'ada' }),
    workId: STRING('the work being assigned', { required: true, example: 'work-discovery' }),
    status: { type: 'string', enum: ['active', 'released'], required: true,
      description: 'the assignment lifecycle state', expectation: 'one of active, released', example: 'active' },
    expectedVersion: VERSION,
  }),
  'swarm.coupling_updated': KIND('declare, propose, take, yield, arrive at, or release one declared coupling: a synchronization point a group arrives at and is released from (optionally at a quorum), a rotating writer lease over a group\'s shared checkouts, an exclusive writer over one checkout, or a group failure policy', {
    couplingId: STRING('the coupling record identity', { required: true, example: 'sync-interface-freeze' }),
    coupling: { type: 'string', enum: ['synchronization', 'writer', 'failure'], required: true,
      description: 'which coupling this record carries: a synchronization point on a group (declare with groupId and name, optionally with quorum), a rotating writer lease over a group\'s checkouts (declare with groupId) or an exclusive writer over one seat\'s checkout (declare with participantId), or a group failure policy (declare with groupId and policy)',
      expectation: 'one of synchronization, writer, failure', example: 'synchronization' },
    action: { type: 'string', enum: ['declare', 'propose', 'arrive', 'take', 'yield', 'release'], required: true,
      description: 'declare creates or replaces the record; propose puts it to a consent set whose arrivals declare it; arrive records an arrival at a synchronization point (or, on a proposed record, a seat\'s consent); take and yield move a writer lease\'s write turn between its members; release ends the coupling (who released and why are recorded)',
      expectation: 'one of declare, propose, arrive, take, yield, release', example: 'declare' },
    groupId: STRING('the group the synchronization point, writer lease or failure policy belongs to', { example: 'group-reviewers' }),
    name: STRING('the synchronization point name', { example: 'interface-freeze' }),
    policy: { type: 'string', enum: ['independent'], required: false,
      description: 'the declared group failure policy: independent peers continue when a member dies or leaves, and dependents are told',
      expectation: 'independent', example: 'independent' },
    quorum: { type: 'integer', minimum: 1, required: false,
      description: 'a synchronization point\'s release threshold: the arrival that reaches it releases the point in the same fold, attributed to that seat. Absent means the point releases explicitly, exactly as before. A roster shrunk below the quorum by departures is released by its last arrival.',
      expectation: 'a positive integer', example: 2 },
    members: STRING_ARRAY('the consent set a coupling PROPOSE puts its parameters to (required when proposing): distinct active seats; the proposer consents by proposing and the last arrival declares the record', { example: ['ada', 'grace'] }),
    participantId: STRING('the participant the record names: the seat arriving or consenting, the writer (an exclusive declare), the seat taking or yielding a lease\'s write turn, or (on a release) the seat being released — who RELEASED is always releasedBy, which the runtime writes from the actor', { required: false, ...AUTO('defaults to your own participant identity') }),
    releasedBy: STRING('the acting identity that released the record — the releasing member\'s participant name, or the acting orchestrator\'s principal label; the runtime derives it, and a caller-named value that is not the actor is refused', { ...AUTO('derived from the actor when you release') }),
    reason: STRING('why the coupling is released, or why a hold is yielded', { example: 'every active member arrived' }),
    expectedVersion: VERSION,
  }, { couplingId: 'sync-interface-freeze', coupling: 'synchronization', action: 'declare', groupId: 'group-reviewers', name: 'interface-freeze' }),
  'swarm.claim_updated': KIND('claim a work item or a path set as your own hold — a durable, conflict-checked record of what you are working on (a claim is visibility for your peers, never a fence)', {
    claimId: STRING('the claim identity', { required: true, example: 'claim-ada-discovery' }),
    participantId: STRING('the seat holding the claim; a handoff moves the hold to the seat it names', { required: true, ...AUTO('your own participant identity; naming another seat is an organizing act') }),
    workId: STRING('the work item the claim holds — exactly one of workId or paths', { example: 'work-discovery' }),
    paths: STRING_ARRAY('the paths the claim holds on your recorded checkout — exactly one of workId or paths; entries are repo-relative and name no .. or leading ./', { example: ['impl/src/swarm-state.mjs'] }),
    status: { type: 'string', enum: ['active', 'released'], required: false,
      description: 'the hold lifecycle: active while held, released when given up', expectation: 'one of active, released', example: 'active' },
    handoffTo: STRING('the active seat that takes this hold in one row — the holder hands off, and the hold never falls free; a non-holder cannot move another seat\'s claim', { example: 'grace' }),
    reason: STRING('why the claim is released', { example: 'handing the search lane to grace' }),
    expectedVersion: VERSION,
  }, { claimId: 'claim-ada-discovery', workId: 'work-discovery' }),
  'swarm.proposal_updated': KIND('propose a work split your peers accept by arriving at it — the arrival that completes the consent set expands the plan into the work items and claims it names', {
    proposalId: STRING('the proposal identity', { required: true, example: 'split-discovery' }),
    action: { type: 'string', enum: ['propose', 'arrive', 'release'], required: true,
      description: 'propose writes or amends the split and its consent set; arrive is a named member\'s consent; release withdraws the proposal (which then never expands)',
      expectation: 'one of propose, arrive, release', example: 'propose' },
    participantId: STRING('the seat proposing, consenting or withdrawing; the proposer consents by proposing', { required: true, ...AUTO('your own participant identity; naming another seat is an organizing act') }),
    members: STRING_ARRAY('the consent set the plan is put to (required when proposing): distinct active seats, the proposer among them', { example: ['ada', 'grace'] }),
    plan: JSON_VALUE('the split itself (required when proposing): { work: [{ workId, objective }], claims: [{ participantId, workId | paths }] } — the exact rows an accepted proposal writes, one claim id per entry', { expectation: 'an object with work and claims arrays', example: { work: [{ workId: 'work-discovery-search', objective: 'map the search lane' }], claims: [{ participantId: 'grace', workId: 'work-discovery-search' }] } }),
    reason: STRING('why the proposal is withdrawn', { example: 'the split is no longer needed' }),
    expectedVersion: VERSION,
  }, { proposalId: 'split-discovery', action: 'propose', members: ['ada', 'grace'], plan: { work: [{ workId: 'work-discovery-search', objective: 'map the search lane' }], claims: [{ participantId: 'grace', workId: 'work-discovery-search' }] } }),
  'swarm.holder_released': KIND('release a gone holder\'s seats in one batch (refuses while the participant is live active)', {
    participantId: STRING('the participant whose active assignments and group seats are released', { required: true, example: 'builder-a' }),
    reason: STRING('why the seats are released', { example: 'the runtime is gone; seats released so the delegation can complete' }),
  }),
  'swarm.context_updated': KIND('write one shared-context entry the whole swarm can read', {
    key: STRING('the shared-context key', { required: true, example: 'notes:discovery' }),
    body: JSON_VALUE('the entry — arbitrary JSON', { required: true, example: { finding: 'the discovery lane is cheapest at the contract' } }),
    groupId: STRING('scope the entry to one group instead of the whole swarm', { example: 'group-reviewers' }),
    expectedVersion: VERSION,
  }),
  'swarm.contribution_recorded': KIND('publish a finding or work product attributed to its author', {
    contributionId: STRING('the contribution identity', { required: true, ...AUTO('minted for you when omitted') }),
    participantId: STRING('the author', { required: true, ...AUTO('your own participant identity; contributions must name their actual author') }),
    // Issue #485 (#481's contract half): the report OBJECT, or plain text. A string that is its
    // own JSON document is the report serialized once too often and refuses — the runtime would
    // otherwise fold a reader that can only enumerate character by character.
    body: JSON_VALUE('the finding itself: the report object, or plain text',
      { expectation: 'the report object, or plain text — a string holding a JSON document is refused as the report encoded twice',
        example: 'the discovery lane needs per-event payload schemas' }),
    workId: STRING('the work this contribution advances', { example: 'work-discovery' }),
    refs: STRING_ARRAY('related identities (work, contributions, artifacts)', { example: ['work-discovery'] }),
  }),
  'swarm.contribution_reviewed': KIND('record one review decision about a contribution', {
    contributionId: STRING('the contribution under review', { required: true, example: 'contribution-ada-1' }),
    decision: { type: 'string', enum: ['accept', 'reject', 'comment'], required: true,
      description: 'the review decision', expectation: 'one of accept, reject, comment', example: 'accept' },
    reviewerId: STRING('the acting identity that reviewed: your own participant name when a member reviews, or the acting orchestrator\'s principal label; the runtime derives it, and a caller-named identity that is not the actor is refused', { required: false, ...AUTO('derived from the actor; you cannot review under another name') }),
    reason: STRING('why this decision', { example: 'verified against the running deployment' }),
  }),
  // Issue #443: the swarm-level policy. A row changes the fields it names, so a view reads what an
  // orchestrator declared and the runtime resolves the defaults (manual, no billing preference).
  'swarm.policy_updated': KIND('declare the swarm-level policy a re-route follows when a seat\'s provider kills it', {
    rerouteOnProviderFault: { type: 'string', enum: ['manual', 'auto'], required: false,
      description: 'what happens when a seat dies under a provider fault: manual (the default) records the decision and pages an orchestrator, auto performs the resume itself onto the first candidate',
      expectation: 'one of manual, auto', example: 'manual' },
    reroutePreferApi: { type: 'boolean', required: false,
      description: 'rank a per-token API route above a subscription route that has headroom (the default ranks a subscription route with headroom first, so an idle plan is spent before API money)',
      example: false },
    resumeContinuation: { type: 'string', enum: ['manual', 'auto'], required: false,
      description: 'resume-from recruits start immediately; the legacy manual value is read as auto',
      expectation: 'one of manual, auto', example: 'manual' },
  }, {
    // A policy names at least ONE field (the fold refuses a row that changes nothing), so the
    // shipped example names one — a derived example can only name `required` fields, and neither
    // field is required: an orchestrator sets the mode, the billing preference, or both.
    rerouteOnProviderFault: 'manual',
  }),
  'swarm.participant_left': KIND('remove one participant from the swarm', {
    participantId: STRING('the participant who leaves', { required: true, ...AUTO('defaults to your own leave when you call as a member') }),
    reason: STRING('why they are leaving', { example: 'turn complete' }),
  }),
  'swarm.closed': KIND('close the swarm organizationally (stopping participants stays explicit)', {
    reason: STRING('why the swarm closes', { example: 'objective met' }),
  }),
});

/** The minimal payload a CALLER supplies for each kind — auto-filled fields omitted, exactly the
 * object (or, for contributions, the plain-text body) passed as swarm.update `args.payload`. */
export const SWARM_EVENT_EXAMPLES = Object.freeze(Object.fromEntries(
  Object.entries(SWARM_EVENT_PAYLOAD_SCHEMAS).map(([kind, schema]) => [kind, schema.example ?? Object.freeze(Object.fromEntries(
    Object.entries(schema.fields)
      .filter(([name, field]) => name !== 'swarmId' && !field.autoFilled && field.example !== undefined
        && (field.required || name === 'body'))
      .map(([name, field]) => [name, field.example]),
  ))]),
));

// ── runtime-owned driver rows (never caller-submittable) ─────────────────────────────────────────
//
// The runtime records its own operation lifecycle and refusals as `driver.recorded` rows whose
// payload carries `kind`. They are NOT swarm.update events: the durable fold never sees them, and
// no caller may submit one — a refusal the runtime did not itself refuse would be a lie. The
// shape lives here so every surface that describes swarm.update can also describe what a refusal
// looks like when a watch wakes on one.

export const SWARM_DRIVER_EVENT_PAYLOAD_SCHEMAS = Object.freeze({
  // Issue #469: the operation lane's own terminal row — one per successful operation (`_once`),
  // carrying the answer that operation returned. When the answer named a seat's objective (a
  // `swarm.stop`'s wrapped run view does) the row carries the REFERENCE that reaches it, never a
  // copy of the text: the measured `swarm.stop` row was 998 271 B because the same 320 602 B
  // objective was spelled three times inside it, and 473 such rows held 56 MB of the ledger's
  // 180 MB parsed window — paid again on every cold open. The pair is the one the participant row
  // mints (#464): `objectiveRef {kind: 'swarm.participant_joined', seq}` names the join row that
  // holds the whole text, `objectiveBytes` is the length a reader did not get, and the objective's
  // first line rides the wrapped answer bounded by the ONE `view.role.head` registry row.
  'swarm.operation_completed': Object.freeze({
    summary: Object.freeze('the terminal row of one successful swarm operation, carrying the answer it returned — with the seat\'s objective named by REFERENCE whenever that answer named one'),
    fields: Object.freeze({
      swarmId: STRING('the swarm the operation ran in — null when the command named none', { type: 'string|null' }),
      command: STRING('the swarm command that completed'),
      operationKey: STRING('the identity the operation replays under — a hash of the command, the swarm, the caller and the caller\'s idempotency key'),
      participantId: STRING('the seat the operation is attributed to — null when the caller was not a seat of the swarm', { type: 'string|null' }),
      objectiveRef: { type: 'json', description: 'the seat\'s objective by REFERENCE — {kind: \'swarm.participant_joined\', seq}, the ledger row that holds the whole text (the same pair the participant row carries, #464) — absent for an operation whose answer named no objective; the objective itself is never a field of this row', expectation: 'the reference object the seat\'s join row minted, or absent', example: { kind: 'swarm.participant_joined', seq: 42 } },
      objectiveBytes: { type: 'json', description: 'the byte length of the objective text this row did NOT carry, beside objectiveRef — absent with it', expectation: 'a byte count, absent with objectiveRef', example: 320602 },
      result: JSON_VALUE('the answer the operation returned, with every objective it wrapped replaced by the same reference (and the objective\'s first line bounded by the `view.role.head` registry row) — null for a terminal row whose success the lane settled without an answer'),
    }),
    example: Object.freeze({
      swarmId: 'swarm-40e643e96fd1edcd', command: 'swarm.stop', operationKey: 'swarm-operation:9f2c1d…',
      participantId: 'ada', objectiveRef: Object.freeze({ kind: 'swarm.participant_joined', seq: 42 }),
      objectiveBytes: 320602, result: null,
    }),
  }),
  'swarm.operation_refused': Object.freeze({
    summary: Object.freeze('a swarm mutation the runtime refused, recorded by the runtime itself'),
    fields: Object.freeze({
      swarmId: STRING('the swarm the refused mutation named — null when it named none', { type: 'string|null' }),
      command: STRING('the refused swarm command'),
      event: STRING('the refused swarm.update event kind — null when the command was not swarm.update', { type: 'string|null' }),
      code: STRING('the typed refusal code the caller received'),
      field: STRING('the offending request field the refusal named — null when it named none', { type: 'string|null' }),
      rule: STRING('the admission rule that refused the request (unknown-field, required-field, field-predicate, closed-set, payload-required, identity-keyed, arguments-shape, unknown-command, bridge-frame, bridge-scope, …) — null for a refusal the domain fold raised', { type: 'string|null' }),
      participantId: STRING('the participant the refusal concerns — the caller whose mutation was refused when the refusal names nobody', { type: 'string|null' }),
    }),
    example: Object.freeze({
      swarmId: 'swarm-40e643e96fd1edcd', command: 'swarm.update', event: 'swarm.work_updated',
      code: 'work_not_found', field: null, rule: null, participantId: 'builder-a',
    }),
  }),
  // Issue #459: the landing's own two lifecycle rows. A landing is ASYNCHRONOUS — `swarm.integrate`
  // answers its receipt and settles later — so what a landing is doing (the scratch checkout it
  // opened) and how it stopped (the code it failed under) are recorded by the runtime as it runs,
  // not by the caller that asked. They are driver rows, never caller-submittable and never folded
  // into the swarm state; `swarm.view` annotates the contribution row it belongs to with both.
  'swarm.integration_started': Object.freeze({
    summary: Object.freeze('a landing opened its scratch checkout — recorded by the runtime before the squash or any gate runs'),
    fields: Object.freeze({
      swarmId: STRING('the swarm the landed contribution belongs to'),
      contributionId: STRING('the contribution being landed'),
      participantId: STRING('the seat whose work is landing — the contribution\'s own author'),
      target: STRING('the branch the landing will land onto'),
      scratch: STRING('the scratch checkout the landing opened (its directory under the worktree authority root)'),
      swept: STRING_ARRAY('the integration checkouts a previous incarnation left behind that this resident\'s open swept before this landing opened — absent when nothing was swept'),
    }),
    example: Object.freeze({
      swarmId: 'swarm-40e643e96fd1edcd', contributionId: 'contribution-ada-1', participantId: 'ada',
      target: 'master', scratch: '/repo/.baton/wt/integrate-contribution-ada-1',
      swept: ['integrate-contribution-grace-2'],
    }),
  }),
  'swarm.integration_failed': Object.freeze({
    summary: Object.freeze('a landing that opened STOPPED — recorded by the runtime with the typed code it failed under, so a caller that is gone still reads the outcome'),
    fields: Object.freeze({
      swarmId: STRING('the swarm the contribution belongs to'),
      contributionId: STRING('the contribution whose landing stopped'),
      participantId: STRING('the seat whose work was landing — the contribution\'s own author'),
      target: STRING('the branch the landing did not reach'),
      code: STRING('the typed refusal code the landing failed with (the same code its caller was refused with)'),
      detail: { type: 'json', description: 'the refusal\'s own detail: the conflicting paths, the gate verdict\'s unexpected rows, the step that died with its exit status and bounded redacted stderr tail (#451), or the host-lease admission a gate run could not take (#459)', expectation: 'an object of refusal detail fields', example: { code: 'integrate_gates_red' } },
    }),
    example: Object.freeze({
      swarmId: 'swarm-40e643e96fd1edcd', contributionId: 'contribution-ada-1', participantId: 'ada',
      target: 'master', code: 'integrate_gates_red', detail: { verdictLine: 'red — passed 3, unexpected 1, expected-red 0' },
    }),
  }),
  'swarm.integration_swept': Object.freeze({
    summary: Object.freeze('a resident\'s open swept integration scratch checkouts a previous incarnation left behind'),
    fields: Object.freeze({
      repoRoot: STRING('the repository whose worktree authority root was swept'),
      swept: STRING_ARRAY('the integration checkout directory names the open removed, sorted'),
    }),
    example: Object.freeze({
      repoRoot: '/repo', swept: ['integrate-contribution-ada-1'],
    }),
  }),
  // ── issue #273: guidance's own durable rows ───────────────────────────────────────────────────
  // The three rows one guide leaves behind, all carrying the same provenance — who sent it, when,
  // the priority it asked for, and the row it answers — so a receipt, the participant row's
  // `guidance` field and the successor brief read ONE set of facts. `swarm.guidance_sent` is the
  // delivered half and names the lane row it rode (delivery.lane); `swarm.guidance_parked` is the
  // durable park a harness that takes no mid-turn delivery waits on (#337), the only guidance row
  // that carries the message text (the lane row holds it for a delivered guide); and
  // `swarm.guidance_delivered` is the composition that clears a park, once.
  'swarm.guidance_sent': Object.freeze({
    summary: Object.freeze('one guidance message the runtime delivered to a seat — the row its receipt names'),
    fields: Object.freeze({
      swarmId: STRING('the swarm the guidance was sent in'),
      participantId: STRING('the seat the guidance is addressed to'),
      messageId: STRING('the guidance identity, shared with the lane row it rode'),
      actor: STRING('the raw actor of the sender — the namespace the relationship was read from'),
      from: JSON_VALUE('the sender\'s relationship to the swarm: {kind: root|lead|peer, participantId}'),
      sentAt: STRING('the instant the guidance was sent, ISO 8601'),
      priority: STRING('the delivery the sender asked for: next_boundary (the default) or now'),
      inReplyTo: JSON_VALUE('the ledger seq this guidance answers, or null when it answers nothing'),
      delivery: JSON_VALUE('how the guidance landed: {state: delivered|parked|refused, lane: {seq, kind, ts, messageId}|null, reason?}'),
    }),
    example: Object.freeze({
      swarmId: 'swarm-40e643e96fd1edcd', participantId: 'builder', messageId: `message:${'a'.repeat(64)}`,
      actor: 'web:local-owner:31a271a5', from: Object.freeze({ kind: 'root', participantId: null }),
      sentAt: '2026-09-18T10:00:00.000Z', priority: 'next_boundary', inReplyTo: null,
      delivery: Object.freeze({ state: 'delivered', lane: Object.freeze({ seq: 42, kind: 'nudge', ts: '2026-09-18T10:00:00.000Z', messageId: `message:${'a'.repeat(64)}` }) }),
    }),
  }),
  'swarm.guidance_parked': Object.freeze({
    summary: Object.freeze('one guidance message parked durably because the seat\'s harness takes no mid-turn delivery'),
    fields: Object.freeze({
      swarmId: STRING('the swarm the guidance was sent in'),
      participantId: STRING('the seat the parked guidance is addressed to'),
      messageId: STRING('the guidance identity the successor brief composes and marks delivered'),
      actor: STRING('the raw actor of the sender — the namespace the relationship was read from'),
      from: JSON_VALUE('the sender\'s relationship to the swarm: {kind: root|lead|peer, participantId}'),
      sentAt: STRING('the instant the guidance was sent, ISO 8601'),
      priority: STRING('the delivery the sender asked for: next_boundary (the default) or now'),
      inReplyTo: JSON_VALUE('the ledger seq this guidance answers, or null when it answers nothing'),
      message: STRING('the guidance text, composed into the seat\'s next exec / successor brief'),
      reason: STRING('why the guidance could not be delivered mid-turn (harness_one_shot)'),
    }),
    example: Object.freeze({
      swarmId: 'swarm-40e643e96fd1edcd', participantId: 'builder', messageId: `message:${'b'.repeat(64)}`,
      actor: 'orchestrator', from: Object.freeze({ kind: 'root', participantId: null }),
      sentAt: '2026-09-18T10:00:00.000Z', priority: 'next_boundary', inReplyTo: null,
      message: 'Hold the API shape.', reason: 'harness_one_shot',
    }),
  }),
  'swarm.guidance_delivered': Object.freeze({
    summary: Object.freeze('a parked guidance message composed into a seat\'s brief — the park is cleared exactly once'),
    fields: Object.freeze({
      swarmId: STRING('the swarm the guidance was sent in'),
      participantId: STRING('the seat the parked guidance was addressed to'),
      messageId: STRING('the parked guidance identity this composition delivers'),
      deliveredTo: STRING('the seat whose brief carried the message (the successor of a resume-from recruit)'),
      actor: STRING('the raw actor of the sender the park recorded'),
      from: JSON_VALUE('the sender\'s relationship to the swarm: {kind: root|lead|peer, participantId}'),
      sentAt: STRING('the instant the composition delivered the parked message, ISO 8601'),
    }),
    example: Object.freeze({
      swarmId: 'swarm-40e643e96fd1edcd', participantId: 'builder', messageId: `message:${'b'.repeat(64)}`,
      deliveredTo: 'successor', actor: 'orchestrator',
      from: Object.freeze({ kind: 'root', participantId: null }), sentAt: '2026-09-18T10:05:00.000Z',
    }),
  }),
  // ── issue #311 (item 2): the peer message's own durable row ───────────────────────────────────
  // One row per `swarm.notify`, and the row IS the receipt the sender reads back by
  // `swarm.notifications --receipt`. It carries the whole provenance (who sent it, from which
  // swarm, to which seat of which swarm, and the instant), the body (head-cited when it spilled),
  // and how the delivery landed — the same delivery triples a guide's row carries, so a park and
  // a live delivery cannot be spelled two ways. The row is recorded in the SENDING swarm: that is
  // the record the sender is entitled to read, and the recipient's own record of the message is
  // the delivery itself (or the park this runtime lands in the recipient's swarm).
  'swarm.notification_sent': Object.freeze({
    summary: Object.freeze('one participant-to-participant message a seat sent — the row its receipt names'),
    fields: Object.freeze({
      swarmId: STRING('the sending swarm'),
      participantId: STRING('the recipient seat the message is addressed to'),
      toSwarmId: STRING('the swarm the recipient seat belongs to — the sending swarm unless the message crossed swarms'),
      receiptId: STRING('the receipt identity the sender reads the row back by'),
      messageId: STRING('the delivery-lane identity, shared with the lane row the message rode, or null when it parked'),
      actor: STRING('the raw actor of the sender — the namespace the relationship was read from'),
      from: JSON_VALUE('the sender\'s relationship to its swarm: {kind: root|lead|peer, participantId, swarmId}'),
      to: JSON_VALUE('the recipient\'s coordinates: {participantId, swarmId}'),
      sentAt: STRING('the instant the message was sent, ISO 8601 — the instant the delivered frame names too'),
      priority: STRING('the delivery the sender asked for: next_boundary (the default) or now'),
      inReplyTo: JSON_VALUE('the ledger seq this message answers, or null when it answers nothing'),
      delivery: JSON_VALUE('how the message landed: {state: delivered|parked|refused, lane: {seq, kind, ts, messageId}|null, reason?}'),
      message: STRING('the message text, or its byte-capped head when it spilled'),
      spilled: Object.freeze({ type: 'boolean', description: 'true when the body rode as a durable spill' }),
      bytes: Object.freeze({ type: 'integer', description: 'the whole body length in bytes, present only when it spilled' }),
      digest: STRING('the spilled body\'s sha256, present only when it spilled'),
      spill: STRING('the durable spill artifact the whole body lives in, present only when it spilled'),
    }),
    example: Object.freeze({
      swarmId: 'swarm-40e643e96fd1edcd', participantId: 'sibling', toSwarmId: 'swarm-9c31ab77',
      receiptId: `notify:${'c'.repeat(64)}`, messageId: `message:${'d'.repeat(64)}`,
      actor: 'swarm-native:impl-a:lane', from: Object.freeze({ kind: 'peer', participantId: 'impl-a', swarmId: 'swarm-40e643e96fd1edcd' }),
      to: Object.freeze({ participantId: 'sibling', swarmId: 'swarm-9c31ab77' }),
      sentAt: '2026-09-19T09:00:00.000Z', priority: 'next_boundary', inReplyTo: null,
      delivery: Object.freeze({ state: 'delivered', lane: Object.freeze({ seq: 77, kind: 'nudge', ts: '2026-09-19T09:00:00.000Z', messageId: `message:${'d'.repeat(64)}` }) }),
      message: 'My published contract is contribution-abc; the items list the files it touches.',
      spilled: false, bytes: 0, digest: '', spill: '',
    }),
  }),
});

/** One-paragraph description of a refusal row for agent-facing surfaces: what the runtime records
 * when it refuses a mutation, what a watcher sees when it wakes on one, and how the row clears —
 * the participant it names carries it as `lastRefusal` until a later operation of the same
 * command succeeds. */
export function swarmOperationRefusedDetails() {
  const schema = SWARM_DRIVER_EVENT_PAYLOAD_SCHEMAS['swarm.operation_refused'];
  return ['A refused mutation is recorded by the runtime itself as a swarm.operation_refused row',
    `naming ${Object.keys(schema.fields).join(', ')}; example: ${JSON.stringify(schema.example)}.`,
    'The row is the same one for a refusal the runtime raised and for one the native bridge raised',
    'before dispatch, so a participant learns its own refusals through the ordinary view:',
    'its participant row carries lastRefusal {seq, command, code, field} until a later operation of',
    'the same command succeeds.',
    'It lands as a driver record — the swarm state never folds it — and it wakes swarm.watch,',
    "whose watch.event carries kind 'driver.recorded' and payloadKind 'swarm.operation_refused'.",
    'Callers cannot submit this row: it is the runtime\'s own record of a refusal.'].join(' ');
}

function fieldsOf(kind, predicate) {
  const schema = SWARM_EVENT_PAYLOAD_SCHEMAS[kind];
  return schema ? Object.keys(schema.fields).filter((name) => predicate(schema.fields[name])) : [];
}

/** Every field the durable store demands for `kind`, including the ones the runtime fills in. */
/** Every payload field the schema knows for `kind`, in schema order. */
export function swarmEventFields(kind) {
  return Object.keys(SWARM_EVENT_PAYLOAD_SCHEMAS[kind]?.fields ?? {});
}

export function swarmEventRequiredFields(kind) {
  return fieldsOf(kind, (field) => field.required);
}

/** Fields the runtime derives from the request identity — a caller omits them whether the store
 * demands them (swarmId, contributionId, leave participantId) or overrides them (reviewerId). */
export function swarmEventAutoFilledFields(kind) {
  return fieldsOf(kind, (field) => field.autoFilled !== undefined);
}

/** Required fields the CALLER must supply for `kind` — the set the contract's argument admission
 * checks for presence. Empty for kinds the runtime can assemble entirely from request identity
 * (contributions, self-leaves, closes); `swarmId` is always auto-filled and never listed. */
export function swarmEventAgentRequiredFields(kind) {
  return fieldsOf(kind, (field) => field.required && field.autoFilled === undefined && field.optionalWhenExisting === undefined);
}

/** The expectation text for one payload field — the same wording every surface prints. */
export function swarmEventFieldExpectation(kind, field) {
  return SWARM_EVENT_PAYLOAD_SCHEMAS[kind]?.fields[field]?.expectation ?? null;
}

function shapeLine(kind) {
  const schema = SWARM_EVENT_PAYLOAD_SCHEMAS[kind];
  const agent = swarmEventAgentRequiredFields(kind)
    .map((name) => `${name} (${schema.fields[name].expectation})`);
  const auto = swarmEventAutoFilledFields(kind);
  const optional = Object.keys(schema.fields).filter((name) => !schema.fields[name].required && schema.fields[name].autoFilled === undefined);
  const parts = [
    agent.length > 0 ? `you supply: ${agent.join(', ')}` : 'you supply nothing extra — identity fields are filled in',
    auto.length > 0 ? `filled in for you: ${auto.join(', ')}` : null,
    optional.length > 0 ? `optional: ${optional.join(', ')}` : null,
  ].filter(Boolean);
  return `${kind} — ${schema.summary}. ${parts.join('; ')}.`;
}

/** One-paragraph payload-shape description for schema surfaces (the MCP tool table). Names every
 * public kind so an agent composing swarm.update never needs to read code. */
export function swarmUpdatePayloadSummary() {
  return ['Payload shape depends on event; bodies stay arbitrary JSON or plain text (never a fixed',
    'record). Per kind:', ...Object.keys(SWARM_EVENT_PAYLOAD_SCHEMAS).map((kind) => shapeLine(kind)),
    'The runtime fills swarmId (and author/leave identities) from the request identity.'].join(' ');
}

/** Multi-line payload-shape description for CLI help rendering. */
export function swarmUpdatePayloadDetails() {
  return ['Payload shape depends on event; bodies stay arbitrary JSON or plain text findings, never a',
    'fixed record. Per kind:', ...Object.keys(SWARM_EVENT_PAYLOAD_SCHEMAS).flatMap((kind) => [
      `  ${shapeLine(kind)}`, `    Example payload (replace named targets): ${JSON.stringify(SWARM_EVENT_EXAMPLES[kind])}`,
    ]),
    'The runtime fills swarmId from your token scope and derives author/leave identities from the',
    'caller; you never write them inside the payload.'].join('\n');
}

// Load-time well-formedness: every required field is described, examples carry every field the
// caller must supply, and no size/count cap sneaks in (the frame-limit catalog owns size policy).
for (const [kind, schema] of Object.entries(SWARM_EVENT_PAYLOAD_SCHEMAS)) {
  const example = SWARM_EVENT_EXAMPLES[kind];
  for (const [name, field] of Object.entries(schema.fields)) {
    if (field.required && field.expectation === undefined) throw new Error(`swarm event ${kind} field ${name} lacks an expectation`);
    if (field.autoFilled !== undefined && Object.hasOwn(example, name)) throw new Error(`swarm event ${kind} example sets auto-filled field ${name}`);
  }
  for (const name of swarmEventAgentRequiredFields(kind)) {
    if (!Object.hasOwn(example, name)) throw new Error(`swarm event ${kind} example omits caller-required field ${name}`);
  }
  if (JSON.stringify(schema).includes('"max')) throw new Error(`swarm event ${kind} schema declares a size or count cap`);
}

// Driver-row well-formedness: every field carries its description and the shipped example names
// them all, so a surface rendering the shape can never point at a field the row does not carry.
for (const [kind, schema] of Object.entries(SWARM_DRIVER_EVENT_PAYLOAD_SCHEMAS)) {
  for (const [name, field] of Object.entries(schema.fields)) {
    if (field.description === undefined) throw new Error(`swarm driver row ${kind} field ${name} lacks a description`);
    if (!Object.hasOwn(schema.example, name)) throw new Error(`swarm driver row ${kind} example omits field ${name}`);
  }
}
