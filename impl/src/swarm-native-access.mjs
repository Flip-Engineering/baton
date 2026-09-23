import { fileURLToPath } from 'node:url';
import { createSwarmNativeBridge, SWARM_BRIDGE_GUIDANCE } from './swarm-native-bridge.mjs';
import { SWARM_KNOWLEDGE_COMMANDS, SWARM_KNOWLEDGE_COMMAND_NAMES, SWARM_VIEW_PROJECTION_NAMES } from './swarm-contract.mjs';
import { SWARM_SEAT_READ_COMMANDS, SWARM_SEAT_READ_COMMAND_NAMES } from './swarm-runtime.mjs';
import { EVIDENCE_SEARCH_FILTERS } from './evidence-search.mjs';
import { WORKTREE_STASH_BRIEF_SENTENCE, WORKTREE_WRITER_BRIEF_SENTENCE } from './runtime-isolation.mjs';

/** Connect native participant tools to the live deployment without copying owner authority.
 * Credentials belong to a participant, independently of its current transport incarnation. */
export class SwarmNativeAccess {
  constructor({ coordinator, dispatch, onTurnCompleted = null, onProviderFault = null, isDone = null }) {
    this.coordinator = coordinator;
    this.onTurnCompleted = onTurnCompleted;
    this.onProviderFault = onProviderFault;
    this.isDone = isDone;
    this.bridge = createSwarmNativeBridge({ dispatch });
    this.participants = new Map();
    this.clientPath = fileURLToPath(new URL('./swarm-native-bridge.mjs', import.meta.url));
  }

  /** Issue #529 (docs/54 §4.1): `autoWake` is the seat's declared wake narrowing (the recruit
   * recorded it on the join), published into the environment the participant's runtime rides so
   * the session's entry opens the subscription the seat was recruited with. */
  async prepare({ swarmId, participantId, runId, autoWake = null }) {
    if (!this.participants.has(runId)) {
      const entry = { revoked: false, promise: null };
      entry.promise = this.bridge.issue({ swarmId, participantId, runId, autoWake }).then((issued) => {
        if (entry.revoked) {
          this.bridge.revoke(issued.token);
          throw Object.assign(new Error('Participant access was revoked during preparation'), { code: 'swarm_native_access_revoked' });
        }
        // Issue #309: the participant's Baton surface rides the registered runtime extension —
        // the coordinator merges it onto the provider-facing brief at the serving seam, so the
        // recruit's rendered brief carries the Swarm section and the bridge tool from its very
        // first turn. Derived once above; never re-spelled here.
        const extension = Object.freeze({
          isDone: () => this.isDone?.({ swarmId, participantId }) === true,
          onTurnCompleted: (report) => this.onTurnCompleted?.({ ...report, swarmId, participantId }),
          onProviderFault: (fault) => this.onProviderFault?.({ ...fault, swarmId, participantId }),
          env: Object.freeze({ ...issued.env, BATON_SWARM_CLIENT: this.clientPath }),
          redactProviderFrame: (frame) => JSON.parse(JSON.stringify(frame,
            (_key, value) => typeof value === 'string' ? value.replaceAll(issued.token, '[REDACTED]') : value)),
          briefSurface: Object.freeze({ swarm: SWARM_BRIEF_SECTION, tools: Object.freeze([SWARM_BRIDGE_TOOL]) }),
        });
        this.coordinator.registerParticipantRuntime(runId, extension);
        return issued;
      });
      this.participants.set(runId, entry);
      entry.promise.catch(() => { if (this.participants.get(runId) === entry) this.participants.delete(runId); });
    }
    await this.participants.get(runId).promise;
  }

  revoke(runId) {
    const entry = this.participants.get(runId);
    if (entry) entry.revoked = true;
    this.bridge.revoke({ runId });
    this.coordinator.unregisterParticipantRuntime(runId);
    this.participants.delete(runId);
  }

  async close() {
    for (const entry of this.participants.values()) entry.revoked = true;
    await this.bridge.close();
    await Promise.allSettled([...this.participants.values()].map((entry) => entry.promise));
    for (const runId of this.participants.keys()) this.coordinator.unregisterParticipantRuntime(runId);
    this.participants.clear();
  }
}
// The knowledge verbs' brief block (#318): derived from the ONE table the view's `updates` rows,
// the bridge's help and the contract share — every surviving verb with the ONE situation it is
// for and the permission that admits it. A verb retired from the participant surface has no row
// here; the reason lives in docs/39 (§The knowledge verbs reach the loop).
const SWARM_KNOWLEDGE_GUIDANCE = [
  'The knowledge layer is part of this loop. Every verb below is callable on this bridge; the permission that admits each is named on swarm.view `updates`, and the swarm section of your brief names the ONE situation each is for:',
  ...SWARM_KNOWLEDGE_COMMAND_NAMES.map((name) => `- ${name} [${SWARM_KNOWLEDGE_COMMANDS[name].permission}] — ${SWARM_KNOWLEDGE_COMMANDS[name].situation}.`),
  'A fact you seed is durable and attributed to your seat: every peer finds it with evidence search, it shows on swarm.view `knowledge` rows, and it lands on the wake stream as a `knowledge` row — nobody\u2019s root has to copy it.',
].join('\n');

// The seat read verbs' brief block (#441 lane B): derived from the ONE table the runtime's
// dispatch, the bridge's help and the guidance all read, so the taught set, the admitted set and
// the served set cannot drift. These are the reads a seat makes of the world it works in — the
// context package its brief names, what its peers have landed, and what its peers are doing now —
// beyond whatever the brief itself carries.
//
// They ride their OWN block beside the knowledge verbs rather than a line in another sentence:
// every verb a seat may call is one row here, with the ONE situation it is for, and a verb retired
// from the participant surface loses its row (there is no other place it could survive).
const SWARM_SEAT_READ_GUIDANCE = [
  'The reading half is part of this loop: three read-only verbs read MORE than your brief carries — a context package\u2019s branches, what your peers have landed, and what they are doing now. Read-only means nothing is recorded either way: a refusal is the only thing that can come back, and it is typed.',
  ...SWARM_SEAT_READ_COMMAND_NAMES.map((name) => `- ${name} [${SWARM_SEAT_READ_COMMANDS[name].permission}] — ${SWARM_SEAT_READ_COMMANDS[name].situation}.`),
  'Name the digest or the seq you read from your brief; the answer is bounded, and a bounded answer says so (`truncated` with the `cursor` to continue from) rather than dropping rows.',
].join('\n');

/** The closed set of verbs this file advertises to a seat (issue #372): the #318 knowledge verbs
 * plus the #441 seat read verbs, in the order the brief teaches them. `swarm.guide` and the
 * brief's Swarm section render THIS set — a verb outside it is not callable by a seat. */
export const SWARM_SEAT_VERB_NAMES = Object.freeze([
  ...SWARM_KNOWLEDGE_COMMAND_NAMES, ...SWARM_SEAT_READ_COMMAND_NAMES,
]);

export const SWARM_NATIVE_GUIDANCE = [
  'Your native tools, skills, and delegation remain available. You can coordinate directly with this swarm using your own granted authority.',
  'Run node "$BATON_SWARM_CLIENT" swarm.view to see participants, shared context, knowledge, available actions, and your current permissions. Add "projection":"outline" to read one slice instead of the whole record — the bridge answers a view too large for its frame with the projection that fits.',
  `swarm.view projection — one of: ${[...SWARM_VIEW_PROJECTION_NAMES].join(', ')}`,
  `evidence.search fields — one of: ${[...EVIDENCE_SEARCH_FILTERS].join(', ')}`,
  'A closed-set refusal carries the admitted values in detail.admitted and reads "<field> must be one of: ..."; an unknown-field refusal carries the admitted fields the same way. Absent swarm.view projection means full.',
  'Run node "$BATON_SWARM_CLIENT" swarm.update to publish a finding: {"event":"swarm.contribution_recorded","payload":{"body":"your whole report"}} — put the whole report inside the payload\'s `body` field, the payload shape is closed, and an unknown field refuses. A contributionId you omit is minted per call from your identity and that call\'s key, so every such update records a NEW contribution; an id the swarm already holds REFUSES (`contribution_duplicate`), never extends — a correction is its own contribution, and `swarm.contribution_reviewed` is how recorders settle what they already hold. Group, work, context, and review updates use the permitted event kinds shown by swarm.view — the `updates` field lists, beside availableActions, exactly the kinds you may send now and the permission that admits each.',
  'Use swarm.guide to speak to a participant, swarm.recruit to bring in help when granted, and swarm.watch to await relevant updates. These commands use participant names; no worker, fence, pause, or approval choreography is required. Participants with review authority can capture and check contributions. Participants with organize authority can integrate accepted contributions. Record a contribution before requesting review or landing.',
  'Declare your assignment done with swarm.update {"event":"swarm.participant_left","payload":{"reason":"completed"}}, then end your turn. Baton delivers the final report to your orchestrator and completes the worker. Ordinary turn completion keeps the assignment available for guidance.',
  SWARM_KNOWLEDGE_GUIDANCE,
  SWARM_SEAT_READ_GUIDANCE,
  // Issue #357: the worktrees of one repository share a single stash stack, so the seat's git
  // wrapper refuses stash and the brief names the safe baseline comparison in ONE sentence,
  // derived from the runtime that enforces it.
  `Your checkout is a private git worktree. ${WORKTREE_STASH_BRIEF_SENTENCE} ${WORKTREE_WRITER_BRIEF_SENTENCE}`,
  'The client fills your swarm identity and a per-call idempotency key. Naming that key again replays an operation that already completed; a NEW attempt needs a NEW key (only swarm.recruit and swarm.holder_released may be re-attempted under theirs). Keep the bridge credential private; never print environment variables containing tokens.',
  'A refusal is never silent: an answer that begins "Nothing was recorded:" says what to change, and every refusal is recorded in the swarm, so your orchestrator sees it and your own participant row shows it as lastRefusal until a later operation of the same command succeeds.',
].join('\n\n');

/** Issue #309: the ONE derivation of the Swarm section a swarm recruit's brief renders —
 * SWARM_NATIVE_GUIDANCE plus the bridge's own guidance, joined here so the brief text and the
 * guidance cannot drift. renderBrief (adapter.mjs) owns only the heading; the section arrives
 * on the participant runtime extension this access registers at credential issue. */
export const SWARM_BRIEF_SECTION = `${SWARM_NATIVE_GUIDANCE}\n\n${SWARM_BRIDGE_GUIDANCE}`;

/** The bridge as a brief.tools entry (issue #309): the one Baton tool a swarm recruit may
 * call, named with its verbs, so the brief's Tools section is never empty for a recruit. */
export const SWARM_BRIDGE_TOOL = 'BATON swarm bridge (node "$BATON_SWARM_CLIENT"): swarm.view, swarm.watch, swarm.update, swarm.guide, and swarm.recruit when granted';
