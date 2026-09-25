// swarm-family.mjs — the bounded swarm-family read behind the visual surfaces (docs/38:
// the `baton top` overview rows and the `baton_surface_visualize` model carry residents,
// swarms and participants with state and last wake).
//
// This is a READ SEAM, not an authority: it composes the existing swarm commands
// (`swarm.list`, `swarm.view` with the declared projection slices) into one bounded family
// projection. It never invents rows, never writes, and degrades honestly — a family the
// caller cannot read comes back as `unavailable` naming the typed refusal, and a swarm
// whose slice refuses keeps its row with that refusal beside it.

export const MAX_FAMILY_SWARMS = 16;
export const MAX_FAMILY_PARTICIPANTS = 64;
export const MAX_FAMILY_ATTENTION = 16;

const SETTLED = (promise) => Promise.resolve().then(promise).then(
  (value) => ({ ok: true, value }),
  (error) => ({ ok: false, error }),
);

/**
 * Read one bounded swarm family through the caller's authenticated client.
 *
 * @param {object} client an authenticated resident client exposing `command(name, args)`.
 * @param {{swarmLimit?: number, participantLimit?: number, attentionLimit?: number}} [limits]
 * @returns {Promise<object>} `{ swarms, attention, unavailable }` — `swarms` rows carry
 *   `{swarmId, purpose, status, lastSeq, lastTs, cursor, participants}` (participant rows:
 *   `{participantId, role, status, state, turn, runId, lastSeq, lastTs}`), `attention` rows
 *   carry the swarm's own attention rows with their swarm coordinate, and `unavailable` is
 *   the typed refusal when the family as a whole is not readable (a resident without a
 *   swarm runtime, a permission refusal). Empty and unavailable are different truths.
 */
export async function readSwarmFamily(client, {
  swarmLimit = MAX_FAMILY_SWARMS,
  participantLimit = MAX_FAMILY_PARTICIPANTS,
  attentionLimit = MAX_FAMILY_ATTENTION,
} = {}) {
  if (!client || typeof client.command !== 'function') {
    return { swarms: [], attention: [], unavailable: { code: 'cli_config_invalid', message: 'swarm family requires an authenticated resident client' } };
  }
  const listed = await SETTLED(() => client.command('swarm.list', {}));
  if (!listed.ok) {
    return {
      swarms: [],
      attention: [],
      unavailable: { code: listed.error?.code ?? 'swarm_family_unavailable', message: listed.error?.message ?? 'swarm.list is unavailable on this resident' },
    };
  }
  const rows = Array.isArray(listed.value) ? listed.value : [];
  const swarms = [];
  const attention = [];
  for (const row of rows.slice(0, swarmLimit)) {
    const swarmId = row?.swarmId;
    if (typeof swarmId !== 'string' || swarmId.length === 0) continue;
    // One bounded slice per family axis: the roster with runtime state, and the swarm's
    // own attention rows. The frame (always carried) supplies status and the swarm's last
    // ledger row — the last wake the swarm produced.
    const [roster, notices] = await Promise.all([
      SETTLED(() => client.command('swarm.view', { swarmId, projection: 'participants' })),
      SETTLED(() => client.command('swarm.view', { swarmId, projection: 'attention' })),
    ]);
    const frame = (roster.ok ? roster.value : notices.ok ? notices.value : null) ?? {};
    const participants = (roster.ok && Array.isArray(roster.value?.participants)
      ? roster.value.participants : []).slice(0, participantLimit).map((participant) => ({
      participantId: participant?.participantId ?? null,
      role: participant?.role ?? null,
      status: participant?.status ?? null,
      // The runtime state the coordinator reports (pending/working/blocked/idle/stopping/
      // dead/exited/unbound) — the projection class the status channel derives from.
      state: participant?.runtime?.state ?? null,
      turn: participant?.runtime?.turn ?? null,
      runId: participant?.runId ?? null,
      lastSeq: participant?.seq ?? null,
      lastTs: participant?.ts ?? null,
    }));
    swarms.push({
      swarmId,
      purpose: row?.purpose ?? frame?.purpose ?? null,
      status: row?.status ?? frame?.status ?? null,
      lastSeq: frame?.seq ?? null,
      lastTs: frame?.ts ?? null,
      cursor: Number.isSafeInteger(frame?.cursor) ? frame.cursor : null,
      // A slice that refused keeps its refusal beside the row: the family never hides a
      // read it could not make.
      ...(roster.ok ? {} : { rosterRefusal: { code: roster.error?.code ?? 'swarm_family_refused', message: roster.error?.message ?? 'swarm.view(participants) refused' } }),
      participants,
    });
    if (notices.ok && Array.isArray(notices.value?.attention)) {
      for (const item of notices.value.attention.slice(0, attentionLimit)) {
        attention.push({ swarmId, ...(item ?? {}) });
      }
    }
  }
  return { swarms, attention, unavailable: null };
}
