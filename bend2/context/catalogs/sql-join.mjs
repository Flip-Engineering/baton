// Constant-SQL call-site to catalog-object join.
//
// Input: `sqlCall` facts whose `value.record` is the ConstantSqlRecord the
// TypeScript resolver owns, plus a catalog session this process opened and
// still holds open. Output: relations bound to the resolver snapshot, the
// admitted client binding and the catalog snapshot.
//
// The join never parses TypeScript, never matches a callee or client by name,
// and never recovers relations from SQL text. It requires the record's own
// resolved declarations, its own site bytes and range, and a constant literal;
// a missing or conflicting member refuses with a named limit instead of
// producing a relation.
//
// Plan reuse is keyed by the record snapshot, the admitted client binding and
// the exact SQL text. A second record that reuses a source binding with
// different text or a different snapshot is reanalyzed under its own key and
// reported as a conflicting binding; a plan is never relabeled for new text.

import { digestJson } from './canonical.mjs';

const ABANDONED = 'unsupportedRecordKind';

function refId(parts) {
  return JSON.stringify(parts);
}

function declarationIdentity(declaration) {
  if (declaration === null || typeof declaration !== 'object') return null;
  const { path, sha256, range } = declaration;
  if (typeof path !== 'string' || path.length === 0) return null;
  if (typeof sha256 !== 'string' || sha256.length === 0) return null;
  if (typeof range?.start?.line !== 'number' || typeof range?.start?.column !== 'number') return null;
  if (typeof range?.end?.line !== 'number' || typeof range?.end?.column !== 'number') return null;
  return digestJson({ path, sha256, start: range.start, end: range.end });
}

function siteIdentity(site) {
  if (site === null || typeof site !== 'object') return null;
  if (typeof site.path !== 'string' || site.path.length === 0) return null;
  if (typeof site.sha256 !== 'string' || site.sha256.length === 0) return null;
  if (typeof site.range?.start?.line !== 'number' || typeof site.range?.start?.column !== 'number') return null;
  return { path: site.path, sha256: site.sha256, range: site.range };
}

function recordLimit(value, code, detail) {
  return { projection: 'databaseAccesses', code, detail, sourceBindingId: value?.sourceBinding ?? null };
}

function sourceRefFromSite(site, snapshotId, projection) {
  return {
    id: refId(['source', site.path, site.sha256, site.range.start.line, site.range.start.column, projection]),
    engine: 'typescript',
    subject: { kind: 'position', path: site.path, line: site.range.start.line, column: site.range.start.column },
    snapshotId,
    projections: [projection],
  };
}

function entityRef({ object, session }) {
  const database = session.identity.engine === 'sqlite-schema'
    ? { engine: 'sqlite-schema', path: session.identity.realPath }
    : { engine: 'postgres-schema', database: session.identity.database };
  return {
    id: refId(['entity', session.identity.snapshotId, object.schema, object.name]),
    engine: session.identity.engine,
    subject: { kind: 'entity', database, schema: object.schema, name: object.name },
    snapshotId: session.identity.snapshotId,
    projections: ['entities', 'columns', 'relationships', 'constraints', 'codeAccesses'],
  };
}

export function joinConstantSql({ session, catalog, plans, records, engineProbe = null }) {
  const relations = [];
  const refs = [];
  const limits = [];
  const bindingKeys = new Map();
  let ordinal = 0;

  for (const fact of records) {
    if (fact.kind !== 'sqlCall') {
      limits.push(recordLimit(fact.value, ABANDONED, `fact kind ${JSON.stringify(fact.kind)} is outside the constant-SQL join`));
      continue;
    }
    const value = fact.value ?? {};
    const record = value.record;
    if (record === null || typeof record !== 'object') {
      limits.push(recordLimit(value, 'recordAbsent', 'the fact carries no project record; the flat proposal shape is not consumed'));
      continue;
    }
    if (record.kind !== 'constantSql') {
      limits.push(recordLimit(value, 'recordKindMismatch', `the record kind is ${JSON.stringify(record.kind)}`));
      continue;
    }
    if (typeof record.snapshotId !== 'string' || record.snapshotId.length === 0) {
      limits.push(recordLimit(value, 'resolverSnapshotAbsent', 'the record carries no resolver snapshot identity'));
      continue;
    }
    const callSite = siteIdentity(record.callSite);
    if (callSite === null) {
      limits.push(recordLimit(value, 'callSiteAbsent', 'the record carries no captured call-site bytes and range'));
      continue;
    }
    if (record.callee?.status !== 'resolved') {
      limits.push(recordLimit(value, 'calleeUnresolved', `the callee resolution is ${JSON.stringify(record.callee?.status ?? 'absent')}${record.callee?.reason ? `: ${record.callee.reason}` : ''}`));
      continue;
    }
    if (declarationIdentity(record.callee.declaration) === null) {
      limits.push(recordLimit(value, 'calleeDeclarationIncomplete', 'the resolved callee carries no complete declaration path, digest and range'));
      continue;
    }
    if (record.receiver?.status !== 'resolved') {
      limits.push(recordLimit(value, 'databaseReceiverUnresolved', `the database receiver resolution is ${JSON.stringify(record.receiver?.status ?? 'absent')}${record.receiver?.reason ? `: ${record.receiver.reason}` : ''}`));
      continue;
    }
    if (declarationIdentity(record.receiver.declaration) === null) {
      limits.push(recordLimit(value, 'receiverDeclarationIncomplete', 'the resolved receiver carries no complete declaration path, digest and range'));
      continue;
    }
    if (value.clientMatch === undefined) {
      limits.push(recordLimit(value, 'clientMatchAbsent', 'the fact carries no result of the options.client comparison'));
      continue;
    }
    if (value.clientMatch !== 'matched') {
      limits.push(recordLimit(value, 'clientDeclarationNotMatched', `the resolver reported clientMatch=${JSON.stringify(value.clientMatch)} against the admitted client declaration`));
      continue;
    }
    if (typeof value.sourceBinding !== 'string' || value.sourceBinding.length === 0) {
      limits.push(recordLimit(value, 'admittedClientBindingAbsent', 'the fact carries no admitted client binding identity to bind the plan and the relation to'));
      continue;
    }
    if (record.sql?.status !== 'constant') {
      limits.push(recordLimit(value, record.sql?.status === 'dynamic' ? 'dynamicSql' : 'statementTextAbsent',
        `the statement is not one constant literal: status=${JSON.stringify(record.sql?.status ?? 'absent')}${record.sql?.reason ? `: ${record.sql.reason}` : ''}`));
      continue;
    }
    if (typeof record.sql.text !== 'string' || record.sql.text.length === 0) {
      limits.push(recordLimit(value, 'statementTextAbsent', 'the constant literal carries no text'));
      continue;
    }

    const key = [record.snapshotId, value.sourceBinding, record.sql.text].join('\u0000');
    const seen = bindingKeys.get(value.sourceBinding);
    if (seen !== undefined && seen !== key) {
      limits.push(recordLimit(value, 'conflictingSourceBinding',
        'this source binding was already used with a different resolver snapshot or statement text; the plan is reanalyzed under its own identity'));
    }
    bindingKeys.set(value.sourceBinding, key);

    let plan = plans.get(key);
    if (plan === undefined) {
      plan = session.analyze({ id: key, sql: record.sql.text });
      plans.set(key, plan);
    }
    if (plan.status !== 'analyzed') {
      limits.push(recordLimit(value, plan.refusal?.reason ?? 'statementRefused', plan.refusal?.detail ?? 'the engine refused the statement'));
      continue;
    }
    if (record.statementKind !== 'unknown' && plan.kind !== null && record.statementKind !== plan.kind) {
      limits.push(recordLimit(value, 'statementKindDisagreement',
        `the record reports ${record.statementKind} and the engine program is ${plan.kind}; the engine program decides the published kind`));
    }

    const callSiteRef = sourceRefFromSite(callSite, record.snapshotId, 'databaseAccesses');
    refs.push(callSiteRef);
    if (plan.relations.length === 0) {
      limits.push(recordLimit(value, 'noCatalogObjectRead', 'the engine program opens no catalog object; the statement reads no stored relation'));
    }
    for (const access of plan.relations) {
      if (access.status !== 'joined') {
        limits.push(recordLimit(value, 'modeledAccessUnavailable', `program access at rootpage ${access.rootpage} names no captured catalog object`));
        continue;
      }
      ordinal += 1;
      const objectRef = entityRef({ object: access.object, session });
      refs.push(objectRef);
      const evidence = [
        { kind: 'source', path: callSite.path, sha256: callSite.sha256, range: callSite.range, role: 'callSite' },
        { kind: 'source', path: record.callee.declaration.path, sha256: record.callee.declaration.sha256, range: record.callee.declaration.range, role: 'clientDeclaration' },
        { kind: 'schema', databaseIdentity: session.identity.snapshotId, schemaDigest: session.identity.catalogDigest, object: `${access.object.schema}.${access.object.name}`, column: null },
      ];
      if (engineProbe !== null) {
        evidence.push({ kind: 'probe', executable: engineProbe.executable, sha256: engineProbe.sha256, version: engineProbe.version, operation: 'explain' });
      }
      relations.push({
        id: refId(['relation', 'databaseAccess', value.sourceBinding, String(ordinal)]),
        kind: 'databaseAccess',
        classification: 'static-possible',
        value: {
          sourceBindingId: value.sourceBinding,
          resolverSnapshotId: record.snapshotId,
          catalogSnapshotId: session.identity.snapshotId,
          statementText: record.sql.text,
          literalKind: record.sql.literalKind ?? null,
          statementKind: plan.kind,
          object: access.object,
          rootpage: access.rootpage,
          opcode: access.opcode,
          column: null,
        },
        from: callSiteRef.id,
        to: objectRef.id,
        evidence,
        limits: plan.limits.filter(limit => limit.projection === 'databaseAccesses'),
      });
    }
  }
  return { relations, refs, limits };
}

// PostgreSQL supplies relation names as plan text. The join folds each name
// with the dialect rule, matches stored catalog names, and keeps a name that
// matches no catalog object or matches several as unavailable.
export function joinPostgresRelations({ plan, catalog, session }) {
  if (plan.status !== 'analyzed') return plan;
  const entitiesByKey = new Map();
  for (const entity of catalog.entities) {
    const key = `${foldKey(entity.schema)}\u0000${foldKey(entity.name)}`;
    if (!entitiesByKey.has(key)) entitiesByKey.set(key, []);
    entitiesByKey.get(key).push(entity);
  }
  const relations = [];
  const unknownAccess = [];
  for (const relation of plan.relations) {
    if (relation.schema === null || relation.name === null) {
      unknownAccess.push({ ...relation, status: 'modeledAccessUnavailable', reason: 'planNamesNoSchema' });
      continue;
    }
    const matches = entitiesByKey.get(`${foldKey(relation.schema)}\u0000${foldKey(relation.name)}`) ?? [];
    if (matches.length === 0) {
      unknownAccess.push({ ...relation, status: 'modeledAccessUnavailable', reason: 'relationNotInCatalog' });
      continue;
    }
    if (matches.length > 1) {
      unknownAccess.push({ ...relation, status: 'modeledAccessUnavailable', reason: 'ambiguousRelation', detail: `${matches.length} catalog entities carry this folded name` });
      continue;
    }
    const [entity] = matches;
    const snapshotId = session?.identity?.snapshotId ?? null;
    relations.push({
      id: refId(['relation', 'databaseAccess', 'postgres', `${entity.schema}.${entity.name}`, relation.nodeType]),
      kind: 'databaseAccess',
      classification: 'static-possible',
      value: {
        catalogSnapshotId: snapshotId,
        statementKind: plan.kind,
        statementText: plan.sql,
        object: { schema: entity.schema, name: entity.name, type: entity.kind, oid: entity.oid },
        nodeType: relation.nodeType,
        alias: relation.alias,
        column: null,
      },
      from: null,
      to: refId(['entity', snapshotId, entity.schema, entity.name]),
      evidence: [{
        kind: 'schema',
        databaseIdentity: snapshotId,
        schemaDigest: session?.identity?.catalogDigest ?? null,
        object: `${entity.schema}.${entity.name}`,
        column: null,
      }],
      limits: plan.limits.filter(limit => limit.projection === 'databaseAccesses'),
    });
  }
  return { ...plan, relations, unknownAccess };
}

function foldKey(name) {
  return name.replace(/[A-Z]/g, character => String.fromCharCode(character.charCodeAt(0) + 32));
}
