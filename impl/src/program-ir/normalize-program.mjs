// Phase 93a.2/93a.3a Program source grammar and canonical normalizer (§93.3, §93.4, §93.9, §93.10,
// §93.10A, §93.20). normalizeProgramSource accepts raw JSON text/bytes or an already-parsed value
// and performs: envelope validation; ProgramPolicy/ManifestRef/registry/verificationContracts/
// role-catalog normalization; the closed source grammar for the ten node kinds value/context/
// sequence/branch/parallel/await/collect/select/repeat/child, including the context grammar's
// §93.10 purity gate and its §93.10A closed result-schema derivation (context-derivation.mjs);
// serial/parallel policy consistency; approval-template projection validation; control/data/union
// cycle refusal; control dominance; Kahn canonical ordering with byte-identical coalescing; and
// Program identity. The returned static effect ownership is exact with empty entries: this
// grammar admits no effect nodes. This module is pure — no I/O, no Date, no randomness; every
// rejection is a ProgramIrError raised before any effect.

import {
  canonicalProgramBytes, canonicalProgramDigest, canonicalValueText, compareProgramIdentityKeys,
  deepFreezeProgramValue, isProgramValueAuthority, normalizeCanonicalProgramValue,
  parseRawProgramJson,
} from './canonical-value.mjs';
import {
  createSchemaRegistry, resolveSchemaRef, validateTypedValue, valueSchemaRef,
} from './schema-values.mjs';
import { normalizeProgramPolicy } from './program-policy.mjs';
import { normalizeRoleCatalog } from './role-catalog.mjs';
import { normalizeApprovalTemplate } from './approval-template.mjs';
import {
  CONTROL_NODE_KINDS, exactFields, fail, nodeControlRefs, nodeDataRefs, nodePortNames,
  normalizeManifestRef, normalizeVerificationContractRef, predicatePortRefs, sourceControlRef,
  validateJoin, validatePredicate, validateSelector, validateSourceNode,
} from './control-nodes.mjs';
import {
  deriveContextResultSchema, normalizeContextNodeProgram, resolveCollectResultSchema,
} from './context-derivation.mjs';

const PROGRAM_SOURCE_FIELDS = Object.freeze([
  'schemaVersion', 'kind', 'language', 'manifest', 'schemas', 'roleCatalog',
  'approvalTemplate', 'policy', 'verificationContracts', 'nodes', 'root', 'resultSchema',
]);

function authority(value) {
  if (!isProgramValueAuthority(value)) {
    fail('Program normalization requires deployment-injected authority', 'program_policy_invalid');
  }
  return value;
}

function detectCycle(edges, label) {
  const state = new Map();
  const visit = (key) => {
    const current = state.get(key);
    if (current === 'done') return;
    if (current === 'visiting') fail(`Program ${label} graph contains a cycle`);
    state.set(key, 'visiting');
    for (const target of edges.get(key) ?? []) visit(target);
    state.set(key, 'done');
  };
  for (const key of edges.keys()) visit(key);
}

export function normalizeProgramSource(source, { authority: valueAuthority } = {}) {
  const deployed = authority(valueAuthority);
  const parsed = (typeof source === 'string' || Buffer.isBuffer(source) || source instanceof Uint8Array)
    ? parseRawProgramJson(source, deployed)
    : normalizeCanonicalProgramValue(source, deployed);

  exactFields(parsed, PROGRAM_SOURCE_FIELDS, 'Program source');
  if (parsed.schemaVersion !== 1) fail('Program source schemaVersion must be 1');
  if (parsed.kind !== 'baton.program_source') fail('Program source kind is invalid');
  if (parsed.language !== 'baton-program-ir-v1') fail('Program source language is invalid');

  const policy = normalizeProgramPolicy(parsed.policy, deployed);
  const manifest = normalizeManifestRef(parsed.manifest, 'Program manifest');
  if (!Array.isArray(parsed.schemas) || parsed.schemas.length > policy.maxSchemaDefinitions) {
    fail('Program source schemas must contain at most maxSchemaDefinitions entries');
  }
  const registry = createSchemaRegistry(parsed.schemas, deployed);
  const resultSchema = valueSchemaRef(resolveSchemaRef(parsed.resultSchema, registry, deployed));
  if (!Array.isArray(parsed.verificationContracts)
    || parsed.verificationContracts.length > policy.maxSchemaDefinitions) {
    fail('Program source verificationContracts must contain 0..maxSchemaDefinitions entries');
  }
  const verificationContracts = parsed.verificationContracts.map((contract, index) => (
    normalizeVerificationContractRef(contract, `Program verificationContracts[${index}]`)
  ));
  if (new Set(verificationContracts.map((contract) => contract.contractDigest)).size
    !== verificationContracts.length) {
    fail('Program verificationContracts contains a duplicate contractDigest');
  }
  verificationContracts.sort((left, right) => (
    compareProgramIdentityKeys(left.contractDigest, right.contractDigest)));
  const roleCatalog = normalizeRoleCatalog(parsed.roleCatalog, { authority: deployed, policy });

  if (!Array.isArray(parsed.nodes) || parsed.nodes.length < 1
    || parsed.nodes.length > policy.maxProgramNodes) {
    fail('Program source nodes must contain 1..maxProgramNodes entries');
  }
  const records = new Map();
  for (const node of parsed.nodes) {
    validateSourceNode(node, { policy });
    if (records.has(node.nodeKey)) fail(`Program nodes contain a duplicate nodeKey ${node.nodeKey}`);
    const normalizedContextProgram = node.kind === 'context'
      ? normalizeContextNodeProgram(node.program, { policy })
      : null;
    records.set(node.nodeKey, { source: node, kind: node.kind, normalizedContextProgram });
  }
  // 93a.2 statically present effect kinds are always empty: the source grammar admits only the
  // ten control/data node kinds above, and repeat/child bodies are digest refs to separately
  // normalized Programs rather than inline nodes, so no effect node is statically present.
  const usedEffectKinds = [];
  const approvalTemplate = normalizeApprovalTemplate(parsed.approvalTemplate, {
    authority: deployed, policy, catalog: roleCatalog, usedEffectKinds,
  });

  // Reference resolution and graph construction (§93.4 step 1-2).
  for (const [key, record] of records) {
    record.dataRefs = nodeDataRefs(record.source);
    record.controlRefs = nodeControlRefs(record.source);
    for (const ref of record.dataRefs) {
      if (!records.has(ref.nodeKey)) {
        fail(`Program node ${key} references an unknown nodeKey ${ref.nodeKey}`);
      }
      if (ref.nodeKey === key) fail(`Program node ${key} has a self-edge`);
      if (!nodePortNames(records.get(ref.nodeKey).kind).includes(ref.port)) {
        fail(`Program node ${key} references an unknown port ${ref.port} on ${ref.nodeKey}`);
      }
    }
    for (const ref of record.controlRefs) {
      if (!records.has(ref.nodeKey)) {
        fail(`Program node ${key} references an unknown nodeKey ${ref.nodeKey}`);
      }
      if (ref.nodeKey === key) fail(`Program node ${key} has a self-edge`);
      if (!CONTROL_NODE_KINDS.includes(records.get(ref.nodeKey).kind)) {
        fail(`Program control edge from ${key} must target a control node, not ${ref.nodeKey}`);
      }
    }
  }
  sourceControlRef(parsed.root, 'Program root');
  if (!records.has(parsed.root.nodeKey)) fail('Program root references an unknown nodeKey');
  if (!CONTROL_NODE_KINDS.includes(records.get(parsed.root.nodeKey).kind)) {
    fail('Program root must name a control node');
  }
  const rootKey = parsed.root.nodeKey;

  // §93.20 amended: serial classification keys on parallel nodes reachable from root through
  // control edges. An unreachable parallel node is inert and never forces maxParallelBranches
  // to be non-null.
  const controlReachable = new Set();
  const reachStack = [rootKey];
  while (reachStack.length > 0) {
    const key = reachStack.pop();
    if (controlReachable.has(key)) continue;
    controlReachable.add(key);
    for (const ref of records.get(key).controlRefs) reachStack.push(ref.nodeKey);
  }
  const hasReachableParallel = [...controlReachable]
    .some((key) => records.get(key).kind === 'parallel');
  if (!hasReachableParallel && policy.maxParallelBranches !== null) {
    fail('ProgramPolicy maxParallelBranches must be null for a Program without a reachable parallel node');
  }
  if (hasReachableParallel && policy.maxParallelBranches === null) {
    fail('ProgramPolicy maxParallelBranches must be a positive integer for a Program with a reachable parallel node');
  }
  // §93.20 amended: a reachable parallel's branch count is additionally bounded by the
  // concurrency authority maxParallelBranches now that reachability is known; an unreachable
  // (inert) parallel keeps only the pure-shape maxProgramNodes ceiling already enforced in
  // control-nodes.mjs, since it grants no execution authority.
  for (const key of controlReachable) {
    const record = records.get(key);
    if (record.kind === 'parallel' && record.source.branches.length > policy.maxParallelBranches) {
      fail(`Program parallel node ${key} branches must contain 1..maxParallelBranches entries`);
    }
  }
  const dataEdges = new Map();
  const controlEdges = new Map();
  const unionEdges = new Map();
  for (const [key, record] of records) {
    const data = record.dataRefs.map((ref) => ref.nodeKey);
    const control = record.controlRefs.map((ref) => ref.nodeKey);
    dataEdges.set(key, data);
    controlEdges.set(key, control);
    unionEdges.set(key, [...data, ...control]);
  }
  detectCycle(dataEdges, 'data dependency');
  detectCycle(controlEdges, 'control');
  detectCycle(unionEdges, 'combined control/data');

  // Control dominance (§93.9). The dominance control-flow graph runs from root; a sequence
  // enters its steps in array order, so each step is control-reached only through the previous
  // step's settlement (chain edges), while branch arms and parallel branches fork from their
  // owner. A demanded port produced by a control node must be dominated by that producer.
  const domPredecessors = new Map([...records.keys()].map((key) => [key, []]));
  const addDomEdge = (from, to) => domPredecessors.get(to).push(from);
  for (const [key, record] of records) {
    if (record.kind === 'sequence') {
      let previous = key;
      for (const step of record.source.steps) {
        addDomEdge(previous, step.nodeKey);
        previous = step.nodeKey;
      }
    } else if (record.kind === 'branch') {
      addDomEdge(key, record.source.then.control.nodeKey);
      addDomEdge(key, record.source.otherwise.control.nodeKey);
    } else if (record.kind === 'parallel') {
      for (const branch of record.source.branches) addDomEdge(key, branch.control.nodeKey);
    }
  }
  const allKeys = [...records.keys()];
  const dominators = new Map();
  for (const key of allKeys) {
    dominators.set(key, key === rootKey ? new Set([key]) : new Set(allKeys));
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of allKeys) {
      if (key === rootKey) continue;
      const predecessors = domPredecessors.get(key);
      let next = new Set(allKeys);
      for (const predecessor of predecessors) {
        next = new Set([...next].filter((entry) => dominators.get(predecessor).has(entry)));
      }
      next.add(key);
      const previous = dominators.get(key);
      if (next.size !== previous.size || [...next].some((entry) => !previous.has(entry))) {
        dominators.set(key, next);
        changed = true;
      }
    }
  }
  const demandRoots = (record) => {
    const node = record.source;
    switch (record.kind) {
      case 'branch':
        return predicatePortRefs(node.predicate);
      case 'await':
        return [node.target];
      case 'select':
        return node.candidates.map((candidate) => candidate.value);
      case 'repeat':
        return [node.initial, ...predicatePortRefs(node.continueWhen)];
      case 'child':
        return [node.input];
      default:
        return [];
    }
  };
  for (const [key, record] of records) {
    if (!CONTROL_NODE_KINDS.includes(record.kind)) continue;
    const dominated = dominators.get(key);
    const stack = [...demandRoots(record)];
    const walked = new Set();
    while (stack.length > 0) {
      const ref = stack.pop();
      const producer = records.get(ref.nodeKey);
      if (CONTROL_NODE_KINDS.includes(producer.kind)) {
        if (!dominated.has(ref.nodeKey)) {
          fail(`Program node ${key} demands a port produced by ${ref.nodeKey}, `
            + 'which does not dominate it');
        }
      } else if (producer.kind === 'collect' && !walked.has(ref.nodeKey)) {
        walked.add(ref.nodeKey);
        stack.push(...producer.source.items.map((item) => item.value));
      }
    }
  }

  // Settle-then-read settlement domains (§93.9 amended). sequence.result,
  // parallel.branches[].result, and branch.{then,otherwise}.result read only after their
  // governing control chain settles, and are never dominator-checked. Each such PortRef is walked
  // through the transitive pure-data closure (collect items recursively; value/context add no
  // further refs — the same walk the demand-edge relation performs above) and every control
  // producer so reached must lie inside the settlement domain of the chain that governs the
  // position: for a sequence, every step and each step's own domain; for a parallel branch, its
  // own control chain's domain; for a branch arm, that arm's own control chain's domain. A pure
  // data leaf reached by the walk is unrestricted; only a control producer is domain-checked. A
  // branch/await/select/repeat/child node's own domain is only itself: arm internals and
  // non-all_terminal parallel branches never leak into an outer domain.
  const settlementDomainCache = new Map();
  const settlementDomain = (key) => {
    if (settlementDomainCache.has(key)) return settlementDomainCache.get(key);
    const record = records.get(key);
    const domain = new Set([key]);
    if (record.kind === 'sequence') {
      for (const step of record.source.steps) {
        for (const entry of settlementDomain(step.nodeKey)) domain.add(entry);
      }
    } else if (record.kind === 'parallel' && record.source.join.kind === 'all_terminal') {
      for (const branch of record.source.branches) {
        for (const entry of settlementDomain(branch.control.nodeKey)) domain.add(entry);
      }
    }
    settlementDomainCache.set(key, domain);
    return domain;
  };
  const checkSettleThenRead = (key, ref, domainKey) => {
    const domain = settlementDomain(domainKey);
    const stack = [ref];
    const walked = new Set();
    while (stack.length > 0) {
      const current = stack.pop();
      const producer = records.get(current.nodeKey);
      if (CONTROL_NODE_KINDS.includes(producer.kind)) {
        if (!domain.has(current.nodeKey)) {
          fail(`Program node ${key} settle-then-read ref to ${current.nodeKey} is outside its settlement domain`);
        }
      } else if (producer.kind === 'collect' && !walked.has(current.nodeKey)) {
        walked.add(current.nodeKey);
        stack.push(...producer.source.items.map((item) => item.value));
      }
    }
  };
  for (const [key, record] of records) {
    if (record.kind === 'sequence') {
      checkSettleThenRead(key, record.source.result, key);
    } else if (record.kind === 'parallel') {
      for (const branch of record.source.branches) {
        checkSettleThenRead(key, branch.result, branch.control.nodeKey);
      }
    } else if (record.kind === 'branch') {
      checkSettleThenRead(key, record.source.then.result, record.source.then.control.nodeKey);
      checkSettleThenRead(key, record.source.otherwise.result, record.source.otherwise.control.nodeKey);
    }
  }

  // Kahn canonical construction (§93.4 steps 3-6): a node is ready when every node it references
  // is canonical; ready nodes are constructed and the smallest nodeId by unsigned UTF-16 emits.
  const resolveSchema = (refValue) => {
    const definition = resolveSchemaRef(refValue, registry, deployed);
    return { schema: valueSchemaRef(definition), definition };
  };
  const sameSchema = (left, right) => (
    canonicalValueText(left, deployed) === canonicalValueText(right, deployed));
  const uniqueSchemaByName = (name, label) => {
    const matches = registry.schemas.filter((definition) => definition.name === name);
    if (matches.length !== 1) {
      fail(`${label} requires exactly one registered schema named ${name}`);
    }
    return { schema: valueSchemaRef(matches[0]), definition: matches[0] };
  };
  const constructed = new Map();
  const keyByNodeId = new Map();
  const resolvePort = (nodeKey, port) => {
    const producer = constructed.get(nodeKey);
    const entry = producer.ports.get(port);
    return {
      portRef: { nodeId: producer.nodeId, port, schema: entry.schema },
      definition: entry.definition,
    };
  };
  const portRefFor = (ref) => resolvePort(ref.nodeKey, ref.port).portRef;
  const controlRefFor = (ref) => ({ nodeId: constructed.get(ref.nodeKey).nodeId });
  const canonicalProgramRef = (value) => ({
    kind: 'program_ref',
    programId: value.programId,
    programDigest: value.programDigest,
    resultSchema: resolveSchema(value.resultSchema).schema,
  });
  const canonicalBound = (value, name) => {
    if (value.policyDigest !== policy.policyDigest) {
      fail(`Program ${name} bound must pin the Program policy digest`);
    }
    return { kind: 'policy_bound', name, policyDigest: value.policyDigest };
  };
  const portEntry = (schema, definition) => ({ schema, definition });

  function constructNode(record) {
    const node = record.source;
    const label = `Program ${record.kind} node`;
    if (record.kind === 'value') {
      const typed = validateTypedValue(node.value, registry, deployed);
      const declared = resolveSchema(node.schema);
      if (!sameSchema(declared.schema, typed.schema)) {
        fail(`${label}.schema must equal its TypedValue schema`);
      }
      return {
        body: { kind: 'value', value: typed, schema: typed.schema },
        ports: new Map([['value', portEntry(typed.schema, declared.definition)]]),
      };
    }
    if (record.kind === 'context') {
      const { schema: outputSchema, definition } = deriveContextResultSchema(
        record.normalizedContextProgram, { authority: deployed, policy, registry });
      return {
        body: { kind: 'context', program: record.normalizedContextProgram, outputSchema },
        ports: new Map([['value', portEntry(outputSchema, definition)]]),
      };
    }
    if (record.kind === 'collect') {
      const items = node.items
        .map((item) => ({ name: item.name, value: portRefFor(item.value) }))
        .sort((left, right) => compareProgramIdentityKeys(left.name, right.name));
      const { schema: outputSchema, definition } = resolveCollectResultSchema(
        items.map((item) => ({ name: item.name, schema: item.value.schema })),
        { authority: deployed, registry });
      return {
        body: { kind: 'collect', items, outputSchema },
        ports: new Map([['value', portEntry(outputSchema, definition)]]),
      };
    }
    if (record.kind === 'sequence') {
      const steps = node.steps.map(controlRefFor);
      const result = portRefFor(node.result);
      const { schema: outputSchema, definition } = resolveSchema(node.outputSchema);
      if (!sameSchema(outputSchema, result.schema)) {
        fail(`${label}.outputSchema must equal its result schema`);
      }
      return {
        body: { kind: 'sequence', steps, result, outputSchema },
        ports: new Map([['value', portEntry(outputSchema, definition)]]),
      };
    }
    if (record.kind === 'branch') {
      const predicate = validatePredicate(node.predicate,
        { policy, authority: deployed, resolvePort, label: `${label}.predicate` });
      const then = {
        control: controlRefFor(node.then.control), result: portRefFor(node.then.result),
      };
      const otherwise = {
        control: controlRefFor(node.otherwise.control), result: portRefFor(node.otherwise.result),
      };
      const { schema: outputSchema, definition } = resolveSchema(node.outputSchema);
      if (!sameSchema(then.result.schema, outputSchema)
        || !sameSchema(otherwise.result.schema, outputSchema)) {
        fail(`${label} arm result schemas must equal outputSchema`);
      }
      return {
        body: { kind: 'branch', predicate, then, otherwise, outputSchema },
        ports: new Map([['value', portEntry(outputSchema, definition)]]),
      };
    }
    if (record.kind === 'parallel') {
      const branches = node.branches.map((branch) => {
        const resultSchema = resolveSchema(branch.resultSchema);
        const result = portRefFor(branch.result);
        if (!sameSchema(result.schema, resultSchema.schema)) {
          fail(`${label} branch result schema must equal its declared resultSchema`);
        }
        return {
          name: branch.name, control: controlRefFor(branch.control), result,
          resultSchema: resultSchema.schema,
        };
      }).sort((left, right) => compareProgramIdentityKeys(left.name, right.name));
      const join = validateJoin(node.join,
        { policy, memberNames: branches.map((branch) => branch.name), label: `${label}.join` });
      const { schema: outputSchema, definition } = resolveSchema(node.outputSchema);
      if (definition.name !== 'baton.parallel_handle') {
        fail(`${label}.outputSchema must be registered as "baton.parallel_handle"`);
      }
      return {
        body: { kind: 'parallel', branches, join, outputSchema },
        ports: new Map([['handle', portEntry(outputSchema, definition)]]),
      };
    }
    if (record.kind === 'await') {
      const producerRecord = records.get(node.target.nodeKey);
      if (!['parallel', 'child'].includes(producerRecord.kind)) {
        fail(`${label}.target must be a handle port of a parallel or child node`);
      }
      const memberNames = producerRecord.kind === 'parallel'
        ? producerRecord.source.branches.map((branch) => branch.name) : null;
      const join = validateJoin(node.join, { policy, memberNames, label: `${label}.join` });
      if (producerRecord.kind === 'child') {
        if (join.kind !== 'all_terminal') {
          fail(`${label} on a child handle must use the all_terminal join`);
        }
      } else {
        const embedded = constructed.get(node.target.nodeKey).node.join;
        if (canonicalValueText(join, deployed) !== canonicalValueText(embedded, deployed)) {
          fail(`${label} on a parallel handle must repeat the byte-identical join embedded in that handle`);
        }
      }
      const { schema: outputSchema, definition } = resolveSchema(node.outputSchema);
      if (definition.name !== 'baton.settlement_envelope') {
        fail(`${label}.outputSchema must be registered as "baton.settlement_envelope"`);
      }
      return {
        body: { kind: 'await', target: portRefFor(node.target), join, outputSchema },
        ports: new Map([['settlement', portEntry(outputSchema, definition)]]),
      };
    }
    if (record.kind === 'select') {
      const candidates = node.candidates
        .map((candidate) => ({ name: candidate.name, value: portRefFor(candidate.value) }))
        .sort((left, right) => compareProgramIdentityKeys(left.name, right.name));
      const selector = validateSelector(node.selector,
        { policy, candidateNames: candidates.map((candidate) => candidate.name), label: `${label}.selector` });
      const { schema: outputSchema, definition } = resolveSchema(node.outputSchema);
      if (selector.kind === 'settlement_value') {
        const envelopeCandidates = candidates.filter((candidate) => (
          resolveSchemaRef(candidate.value.schema, registry, deployed).name
            === 'baton.settlement_envelope'));
        if (envelopeCandidates.length !== 1) {
          fail(`${label} settlement_value requires exactly one candidate whose schema is `
            + 'baton.settlement_envelope');
        }
        if (selector.member.kind === 'map') {
          fail(`${label} settlement_value map member selectors resolve against map effect `
            + 'envelopes, which are 93C scope');
        }
        if (selector.member.kind === 'branch') {
          const producerRecord = records.get(keyByNodeId.get(envelopeCandidates[0].value.nodeId));
          const targetRecord = producerRecord?.kind === 'await'
            ? records.get(producerRecord.source.target.nodeKey) : null;
          const admitted = targetRecord?.kind === 'parallel'
            && targetRecord.source.branches.some((branch) => branch.name === selector.member.name);
          if (!admitted) {
            fail(`${label} settlement_value branch member must name an admitted parallel branch `
              + 'of the envelope producer');
          }
        }
      }
      return {
        body: { kind: 'select', candidates, selector, outputSchema },
        ports: new Map([['value', portEntry(outputSchema, definition)]]),
      };
    }
    if (record.kind === 'repeat') {
      const { schema: settlementSchema, definition: settlementDefinition } = (
        uniqueSchemaByName('baton.settlement_envelope', label));
      return {
        body: {
          kind: 'repeat',
          initial: portRefFor(node.initial),
          body: {
            kind: 'child_program_ref',
            program: canonicalProgramRef(node.body.program),
            inputSchema: resolveSchema(node.body.inputSchema).schema,
            resultSchema: resolveSchema(node.body.resultSchema).schema,
          },
          continueWhen: validatePredicate(node.continueWhen,
            { policy, authority: deployed, resolvePort, label: `${label}.continueWhen` }),
          bound: canonicalBound(node.bound, 'repeat'),
          resultSchema: resolveSchema(node.resultSchema).schema,
        },
        ports: new Map([['settlement', portEntry(settlementSchema, settlementDefinition)]]),
      };
    }
    if (record.kind === 'child') {
      const { schema: handleSchema, definition: handleDefinition } = (
        uniqueSchemaByName('baton.child_handle', label));
      return {
        body: {
          kind: 'child',
          program: canonicalProgramRef(node.program),
          input: portRefFor(node.input),
          bound: canonicalBound(node.bound, 'child'),
          resultSchema: resolveSchema(node.resultSchema).schema,
        },
        ports: new Map([['handle', portEntry(handleSchema, handleDefinition)]]),
      };
    }
    fail(`${label} kind is not constructible in 93a.2`);
  }

  const emitted = [];
  const emittedIds = new Set();
  const bodiesByDigest = new Map();
  const pending = new Set(records.keys());
  while (pending.size > 0) {
    const ready = [...pending].filter((key) => {
      const record = records.get(key);
      return [...record.dataRefs, ...record.controlRefs]
        .every((ref) => constructed.has(ref.nodeKey));
    });
    if (ready.length === 0) fail('Program graph contains a cycle');
    const candidates = ready.map((key) => {
      const { body, ports } = constructNode(records.get(key));
      const bytes = canonicalProgramBytes(body, deployed);
      const digest = canonicalProgramDigest(body, deployed);
      return { key, body, ports, bytes, digest, nodeId: `pnode:${digest}` };
    });
    candidates.sort((left, right) => compareProgramIdentityKeys(left.nodeId, right.nodeId));
    const chosen = candidates[0];
    const seen = bodiesByDigest.get(chosen.digest);
    if (seen) {
      if (!seen.equals(chosen.bytes)) {
        fail('Program node hash collision with unequal canonical bytes', 'program_identity_collision');
      }
    } else {
      bodiesByDigest.set(chosen.digest, chosen.bytes);
    }
    if (!emittedIds.has(chosen.nodeId)) {
      emittedIds.add(chosen.nodeId);
      emitted.push({ nodeId: chosen.nodeId, ...chosen.body });
    }
    for (const candidate of candidates) {
      if (candidate.nodeId !== chosen.nodeId) continue;
      if (!bodiesByDigest.get(candidate.digest).equals(candidate.bytes)) {
        fail('Program node hash collision with unequal canonical bytes', 'program_identity_collision');
      }
      const node = { nodeId: candidate.nodeId, ...candidate.body };
      constructed.set(candidate.key, {
        nodeId: candidate.nodeId, ports: candidate.ports, node,
      });
      keyByNodeId.set(candidate.nodeId, candidate.key);
      pending.delete(candidate.key);
    }
  }

  const programSansDigest = {
    schemaVersion: 1, kind: 'baton.program', language: 'baton-program-ir-v1',
    manifest, schemas: registry.schemas, schemaRegistryDigest: registry.schemaRegistryDigest,
    roleCatalog, approvalTemplate, policy, verificationContracts,
    nodes: emitted, root: { nodeId: constructed.get(rootKey).nodeId }, resultSchema,
  };
  const programDigest = canonicalProgramDigest(programSansDigest, deployed);
  const program = { ...programSansDigest, programDigest, programId: `program:${programDigest}` };
  if (canonicalProgramBytes(program, deployed).byteLength > policy.maxProgramBytes) {
    fail('Program exceeds the ProgramPolicy maxProgramBytes bound');
  }
  const ownershipSansDigest = {
    schemaVersion: 1, kind: 'baton.static_effect_ownership', programDigest, entries: [],
  };
  const staticEffectOwnership = {
    ...ownershipSansDigest,
    ownershipDigest: canonicalProgramDigest(ownershipSansDigest, deployed),
  };
  return deepFreezeProgramValue({ program, staticEffectOwnership });
}
