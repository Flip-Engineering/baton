import { NATIVE_PHASE } from './native-subagent-observations.mjs';

/** Read-only observations of harness-managed collaboration. Invocation completion and
 * child-agent completion are distinct; neither grants Baton process or session custody.
 *
 * `coverage` names the observation itself (2026-09-14 audit, swarm-b/lead.md finding 9): it is
 * `observed_only` when the stream really carried native observations — never a constant label
 * stamped beside empty arrays — and `unobserved` when this view saw none to report. */
export function nativeSubagentView(events) {
  const invocations = new Map();
  const agents = new Map();
  const unidentified = [];
  let observed = 0;
  for (const event of events) {
    if (event.kind !== 'native.subagent_observed') continue;
    const observation = event.payload;
    if (!observation || typeof observation !== 'object') continue;
    observed += 1;
    const identity = observation.toolCallId ?? observation.collabToolCallId ?? observation.toolUseId;
    const attributed = { ...structuredClone(observation), seq: event.seq, ts: event.ts };

    // OMP subscription-gated child frames (subagent_lifecycle/subagent_progress) key by
    // CHILD identity (`subagent:<id>` namespace) and are batch-safe under one
    // parentToolCallId. They never become invocation records in their own right: terminal
    // truth lands on the PARENT invocation (via parentInvocationKey) as jobTerminal —
    // distinct from that invocation's own management completion (invocationOk).
    const isOmpChildFrame = observation.harness === 'omp'
      && (observation.nativeFrameType === 'subagent_lifecycle'
        || observation.nativeFrameType === 'subagent_progress');

    if (isOmpChildFrame) {
      if (observation.parentInvocationKey) {
        const prior = invocations.get(observation.parentInvocationKey);
        if (observation.phase === NATIVE_PHASE.COMPLETED || observation.phase === NATIVE_PHASE.FAILED) {
          if (prior) {
            invocations.set(observation.parentInvocationKey, {
              ...prior,
              jobTerminal: { state: observation.status, seq: event.seq },
            });
          } else {
            // The parent invocation was never observed (no start/end retained) — the
            // terminal child truth still surfaces, minimally, instead of being dropped.
            invocations.set(observation.parentInvocationKey, {
              invocationKey: observation.parentInvocationKey,
              jobTerminal: { state: observation.status, seq: event.seq },
              seq: event.seq, ts: event.ts,
            });
          }
        }
      }
      // No parent linkage observable: the child record still counts as seen, unidentified
      // invocation-wise but identity-bearing as an agent below.
      if (!identity && !observation.subagentId) unidentified.push(attributed);
    } else if (!identity) unidentified.push(attributed);
    else {
      const prior = invocations.get(observation.invocationKey);
      const combined = { ...prior, ...attributed };
      if (prior && observation.nativeFrameType === 'tool_execution_end') {
        combined.gaps = (combined.gaps ?? []).filter((gap) => gap !== 'start_frame_not_retained');
      }
      invocations.set(observation.invocationKey, combined);
    }
    const observeAgent = (nativeId, state, fields = {}) => {
      const key = JSON.stringify([observation.harness, observation.parentWorker, observation.parentSessionId, nativeId]);
      agents.set(key, {
        ...agents.get(key), key, nativeId, harness: observation.harness,
        parentWorker: observation.parentWorker, parentSessionId: observation.parentSessionId,
        ...(state == null && agents.has(key) ? {} : { state: state ?? 'unknown', stateSeq: event.seq }),
        ...fields, seq: event.seq, ts: event.ts,
        controls: [], ownership: 'native_harness',
      });
    };
    if (observation.harness === 'codex') {
      const ids = new Set([...(observation.receiverThreadIds ?? []), ...Object.keys(observation.agentsStates ?? {})]);
      for (const id of ids) {
        const state = observation.agentsStates?.[id];
        // A finished send/wait/spawn invocation never supplies a missing child status.
        observeAgent(id, state?.status, {
          ...(state?.message != null ? { message: state.message } : {}),
          lastInvocationId: observation.collabToolCallId,
        });
      }
    } else if (observation.harness === 'omp') {
      // subagent_lifecycle frames key agents by actual child identity when omp supplies
      // one (sessionFile, else the native subagent id in an explicit namespace).
      const nativeId = observation.childSessionFile
        ?? (observation.subagentId ? `subagent:${observation.subagentId}` : null);
      if (nativeId) {
        // Only subagent_lifecycle carries real native child status; tool frames do not.
        const state = observation.nativeFrameType === 'subagent_lifecycle' && observation.status
          ? observation.status : null;
        observeAgent(nativeId, state, {
          ...(observation.childSessionFile ? { sessionFile: observation.childSessionFile } : {}),
          ...(observation.subagentId ? { subagentId: observation.subagentId } : {}),
          ...(observation.agentType ? { agentType: observation.agentType } : {}),
          lastInvocationId: observation.toolCallId,
          // Completion here describes delegated work, not the lifetime of its native session.
          workPhase: observation.phase,
        });
      }
    } else if (observation.harness === 'claude-code' && observation.subagentRetry?.agent_id) {
      observeAgent(observation.subagentRetry.agent_id, 'unknown', {
        agentType: observation.subagentType, lastInvocationId: observation.toolUseId,
      });
    }
  }
  return {
    // The label is the observation, not a constant: a stream with no native observation in it
    // reports `unobserved` rather than an observed-but-empty claim.
    coverage: observed > 0 ? 'observed_only' : 'unobserved', agents: [...agents.values()],
    invocations: [...invocations.values()], unidentified,
  };
}
