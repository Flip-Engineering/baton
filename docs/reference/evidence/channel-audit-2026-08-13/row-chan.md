# ROW BRIEF — row-chan: the cross-agent channel audit (scratchpad + up-channel + signals)

Read `foundry-brief.md` first — it binds you (verdict scale, evidence law, publish rule,
attempt-echo law). Your target: **every channel a member uses to reach another member or the
orchestrator**, audited against this campaign's real waves.

Channels to audit, each PROVEN/GAPPED/UNEXERCISED with citations:
1. **Scratchpad `shared` partition writes** — did any member's publish actually land in
   `shared`? The contract-foundry rows said the write path is gapped (#158); review-qa §6 says
   its publish was unreachable; redteam-155 says its note landed in `worker:<row>` and
   "elevates at settlement". Trace the actual path in the store (find the resident's
   coordination store FIRST — see the foundry brief's anchor list; record its path).
2. **Task→workflow→project elevation** — did any entry elevate? Cite the elevation events or
   their absence. Who CAN elevate today (surface + capability), and did any wave exercise it?
3. **The up-channel / DECISION_REQUEST lane** — did any member escalate? (The QA escalated via
   its FILE, §5, because the runtime lane was unreachable from its snapshot — that bypass is a
   finding.) Is DECISION_REQUEST wired through the wave driver (`answerDecisions` policy) or
   does it park? Cite the interpreter's handling (`impl/src/workflow-interpreter.mjs`,
   `answerDecision` around :721) against what members actually experienced.
4. **`signalOnMembersDone`** — did it fire for review wave-a? The coordinator's initial draft
   predated two rows' reports (01:45 vs 01:48/01:51): did the signal fire early, or did the
   coordinator proceed un-signalled? Event-log evidence or honest "store unreachable, inference
   from timestamps" — say which.
5. **`messageOnSpawn` / nudge delivery** — did members receive the spawn brief? Any cited
   instance of a nudge landing mid-flight?

Deliverable: `docs/reference/evidence/channel-audit-2026-08-13/channels.md` ONLY, plus the
`shared` publish (title "row-chan") — or the exact refusal if the publish fails.
