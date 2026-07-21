# Chain A claims — Phase 93a.2 Program-IR corrected slice

Reviewer: chain member A. Scope: spec/phase93-closed-program-ir.md §§93.5, 93.8, 93.9, 93.20 against
impl/src/program-ir/normalize-program.mjs and impl/src/program-ir/approval-template.mjs.

## Claims

1. `controlReachable` (normalize-program.mjs:155-164) is computed by a DFS from `rootKey` that
   pushes only `record.controlRefs` (never `record.dataRefs`) onto the stack, and normalization
   then fails at normalize-program.mjs:165-170 if `hasReachableParallel` is true while
   `policy.maxParallelBranches` is null, or false while it is non-null — implementing §93.20's
   "reachable ... through control edges" serial/parallel consistency rule.

2. The `branches.length > policy.maxParallelBranches` bound (normalize-program.mjs:175-180) is
   applied only while iterating `controlReachable`, so a `parallel` node absent from that set (an
   inert, control-unreachable parallel) is never checked against `maxParallelBranches` and remains
   bounded only by the pure-shape `maxProgramNodes` ceiling enforced earlier in
   control-nodes.mjs:482-484, matching §93.20's "an unreachable parallel node is inert."

3. `demandRoots` (normalize-program.mjs:238-254) returns exactly `predicatePortRefs(node.predicate)`
   for `branch`, `[node.target]` for `await`, `node.candidates.map(c => c.value)` for `select`,
   `[node.initial, ...predicatePortRefs(node.continueWhen)]` for `repeat`, and `[node.input]` for
   `child` — a one-to-one code enumeration of the five demand-edge root positions listed in §93.9
   clause 1.

4. In the demand-edge walk (normalize-program.mjs:255-273), the "does not dominate it" failure
   fires only when the walked `PortRef`'s producer kind is in `CONTROL_NODE_KINDS`, and the walk is
   extended transitively only through `collect` producers via `producer.source.items.map(i =>
   i.value)`, so a `value` (or would-be `context`) producer terminates the walk unchecked — matching
   §93.9's "transitive pure-data walk (value/collect/context chains)" and "pure-data leaves ...
   unrestricted" language.

5. `settlementDomain(key)` (normalize-program.mjs:287-302) extends the domain set beyond `{key}`
   only when `record.kind === 'sequence'` (unions in each step's own recursive domain) or when
   `record.kind === 'parallel' && record.source.join.kind === 'all_terminal'` (unions in each
   branch's own recursive domain); for a `branch` node, or a `parallel` whose join is not
   `all_terminal`, the function returns exactly `{key}`, matching §93.9's "a branch node contributes
   only itself to any domain" and "a non-all_terminal parallel node likewise contributes only
   itself."

6. The three settle-then-read call sites (normalize-program.mjs:320-330) key the domain check on
   `key` for `sequence.result`, on `branch.control.nodeKey` (the branch's own control node, not the
   enclosing `parallel`'s key) for each `parallel` branch's `result`, and on
   `then.control.nodeKey`/`otherwise.control.nodeKey` (not the enclosing `branch` node's key) for
   arm results — implementing §93.9's "keyed per position, not per enclosing node."

7. `normalizeProgramSource` always passes a literal `[]` as `usedEffectKinds`
   (normalize-program.mjs:114-120), and `approvalTemplateProjections` sets `effectKinds` to
   `[...new Set(usedEffectKinds)].sort(...)` (approval-template.mjs:46-51), so for every 93a.2
   Program the validated `approvalTemplate.effectKinds` projection is unconditionally `[]`,
   regardless of node content, since the source grammar admits no effect node.

8. `approvalTemplateProjections`' `repositoryScopes` accumulation (approval-template.mjs:52-58)
   skips any catalog role whose `templateBinding.kind !== 'inline'` before reading `pathScope`/
   `contextScope`, so a role bound via `content_ref` contributes nothing to the projected
   `repositoryScopes` set — matching §93.8's rule that a content_ref template's scopes are "never
   restated in the template."

## Uncertain

9. UNCERTAIN — In `constructNode` for `select` with `selector.kind === 'settlement_value'` and
   `selector.member.kind === 'branch'` (normalize-program.mjs:510-519), the admitted-branch check
   resolves the envelope producer via `records.get(keyByNodeId.get(envelopeCandidates[0].value.nodeId))`,
   where `keyByNodeId` (normalize-program.mjs:592-607) maps a coalesced `nodeId` to whichever source
   `key` happened to be the first one dequeued from `candidates` sharing that byte-identical body; I
   believe this is safe because coalesced nodes are canonical-byte-identical and therefore have
   identical `branches` name sets, but I have not fully traced every path (e.g. schema-ref digest
   aliasing) that could make two source records share a coalesced `await`/`parallel` `nodeId` while
   disagreeing on which branch names are "admitted."

10. UNCERTAIN — The three constraint digests (approval-template.mjs:59-69) build `entries` directly
    from `catalog.roles` in the catalog's own array order without an explicit re-sort in
    approval-template.mjs, relying on role-catalog.mjs:221's
    `roles.sort((left, right) => compareProgramIdentityKeys(left.role, right.role))` to already
    satisfy §93.8's "entries sort by unsigned UTF-16 role name" contract; I have not read
    `compareProgramIdentityKeys`'s implementation in canonical-value.mjs to confirm it performs
    unsigned UTF-16 code-unit comparison rather than default/locale-aware JS string comparison, so I
    cannot rule out a divergence for role names containing supplementary-plane characters.
