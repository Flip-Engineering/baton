/** Read-only observations of harness-managed collaboration. Invocation completion and
 * child-agent completion are distinct; neither grants Baton process or session custody. */
export function nativeSubagentView(events) {
  const invocations = new Map();
  const agents = new Map();
  const unidentified = [];
  for (const event of events) {
    if (event.kind !== 'native.subagent_observed') continue;
    const observation = event.payload;
    if (!observation || typeof observation !== 'object') continue;
    const identity = observation.toolCallId ?? observation.collabToolCallId ?? observation.toolUseId;
    const attributed = { ...structuredClone(observation), seq: event.seq, ts: event.ts };
    if (!identity) unidentified.push(attributed);
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
    } else if (observation.harness === 'omp' && observation.childSessionFile) {
      observeAgent(observation.childSessionFile, 'unknown', {
        sessionFile: observation.childSessionFile, lastInvocationId: observation.toolCallId,
        // Completion here describes delegated work, not the lifetime of its native session.
        workPhase: observation.phase,
      });
    } else if (observation.harness === 'claude-code' && observation.subagentRetry?.agent_id) {
      observeAgent(observation.subagentRetry.agent_id, 'unknown', {
        agentType: observation.subagentType, lastInvocationId: observation.toolUseId,
      });
    }
  }
  return {
    coverage: 'observed_only', agents: [...agents.values()],
    invocations: [...invocations.values()], unidentified,
  };
}
