// Adapter entry for the sqlite-schema and postgres-schema providers.
//
// Launch: <absolute node> <absolute libexec/baton2/context/catalogs/adapter.mjs>
// argv after the entry is empty; the provider is named in the input frame.
//
// stdin: exactly one frame, then EOF:
//   {"version":1,"provider":"sqlite-schema"|"postgres-schema","query":"<query id>",
//    "request":<canonical request text>,
//    "inputs":{"records":[<sqlCall facts>]}}
// `inputs.records` is required for a codeAccessJoin request and is supplied by
// the native core from its own TypeScript provider run; the adapter never runs
// a second resolver.
//
// stdout: exactly one frame, newline terminated, and nothing else:
//   success (exit 0):
//   {"version":1,"provider":..,"query":..,"operation":"catalogCapture"|"codeAccessJoin",
//    "subject":..,"snapshot":..,"facts":[..],"relations":[..],"refs":[..],"limits":[..],
//    "coverage":{..},"applicability":..,"changedInputs":[..]}
//   refusal (exit 2): {"version":1,"provider":..,"query":..,
//     "error":{"kind":"validationRefusal"|"operationRefused","condition":"<fixed text>","limits":[]}}
//   failure (exit 1): stderr only; the core publishes no result.
//
// The adapter validates the request members it consumes. Closed request
// validation, the canonical result composition and managed admission remain
// with the codec, the core and the lifecycle.

import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

import { createSqliteSession } from './sqlite-catalog.mjs';
import { openPostgresSession } from './postgres-catalog.mjs';
import { joinPostgresRelations } from './sql-join.mjs';
import { CATALOG_OPERATIONS } from './operations.mjs';

const PROVIDERS = new Set(['sqlite-schema', 'postgres-schema']);
const CATALOG_PROJECTIONS = new Set(['entities', 'columns', 'relationships', 'constraints', 'keys', 'indexes']);

function operationFor({ provider, select, records }) {
  if (records.length > 0 || select.includes('codeAccesses')) return 'codeAccessJoin';
  return 'catalogCapture';
}

function requiredEffectsFor(operation) {
  const entry = CATALOG_OPERATIONS.find(row => row.operation === operation);
  return entry?.requiredEffects ?? [];
}

function factsFromSnapshot({ provider, snapshot, select }) {
  const facts = [];
  const evidence = object => [{
    kind: 'schema',
    databaseIdentity: snapshot.identity.snapshotId,
    schemaDigest: snapshot.identity.catalogDigest,
    object,
    column: null,
  }];
  if (select.includes('entities')) {
    for (const entity of snapshot.catalog.entities) {
      facts.push({
        id: `entity:${entity.schema}.${entity.name}`,
        kind: 'entity',
        classification: 'observed',
        value: {
          schema: entity.schema,
          name: entity.name,
          type: entity.kind,
          withoutRowid: entity.withoutRowid ?? null,
          strict: entity.strict ?? null,
          rowidAliasColumn: entity.rowidAliasColumn ?? null,
        },
        evidence: evidence(`${entity.schema}.${entity.name}`),
        limits: [],
      });
    }
  }
  if (select.includes('columns')) {
    for (const column of snapshot.catalog.columns) {
      facts.push({
        id: `column:${column.schema}.${column.table}.${column.name}`,
        kind: 'column',
        classification: 'observed',
        value: {
          schema: column.schema,
          table: column.table,
          name: column.name,
          ordinal: column.ordinal,
          declaredType: column.declaredType,
          notNull: column.notNull,
          defaultValue: column.defaultValue,
          primaryKeyOrdinal: column.primaryKeyOrdinal,
          hidden: column.hidden ?? null,
        },
        evidence: evidence(`${column.schema}.${column.table}`),
        limits: [],
      });
    }
  }
  if (select.includes('relationships')) {
    for (const relationship of snapshot.catalog.relationships) {
      facts.push({
        id: `relationship:${relationship.schema}.${relationship.table}.${relationship.name ?? relationship.id}`,
        kind: 'relationship',
        classification: 'observed',
        value: {
          schema: relationship.schema,
          table: relationship.table,
          from: relationship.from,
          to: relationship.to,
          references: relationship.references,
          onUpdate: relationship.onUpdate ?? null,
          onDelete: relationship.onDelete ?? null,
          validated: relationship.validated ?? null,
          deferrable: relationship.deferrable ?? null,
        },
        evidence: evidence(`${relationship.schema}.${relationship.table}`),
        limits: [],
      });
    }
  }
  if (select.includes('constraints')) {
    for (const constraint of snapshot.catalog.constraints) {
      facts.push({
        id: `constraint:${constraint.schema}.${constraint.table}.${constraint.kind}.${constraint.name ?? 'definition'}`,
        kind: 'constraint',
        classification: constraint.definition === 'ddl-text' ? 'declared' : 'observed',
        value: {
          schema: constraint.schema,
          table: constraint.table,
          kind: constraint.kind,
          name: constraint.name ?? null,
          definition: constraint.definition,
          definitionText: constraint.ddlText ?? constraint.definitionText ?? null,
          deferrable: constraint.deferrable ?? null,
          deferred: constraint.deferred ?? null,
          validated: constraint.validated ?? null,
          columns: constraint.columns ?? null,
        },
        evidence: evidence(`${constraint.schema}.${constraint.table}`),
        limits: [],
      });
    }
  }
  if (select.includes('indexes')) {
    for (const index of snapshot.catalog.indexes) {
      facts.push({
        id: `index:${index.schema}.${index.name}`,
        kind: 'index',
        classification: 'observed',
        value: {
          schema: index.schema,
          table: index.table,
          name: index.name,
          unique: index.unique,
          origin: index.origin ?? null,
          partial: index.partial ?? null,
          columns: index.columns ?? null,
          definitionText: index.sql ?? index.definition ?? null,
          predicate: index.predicate ?? null,
        },
        evidence: evidence(`${index.schema}.${index.table}`),
        limits: [],
      });
    }
  }
  return facts;
}

function refsFromSnapshot({ provider, snapshot }) {
  const database = provider === 'sqlite-schema'
    ? { engine: 'sqlite-schema', path: snapshot.identity.realPath }
    : { engine: 'postgres-schema', database: snapshot.identity.database };
  return snapshot.catalog.entities.map(entity => ({
    id: JSON.stringify(['entity', snapshot.identity.snapshotId, entity.schema, entity.name]),
    engine: provider,
    subject: { kind: 'entity', database, schema: entity.schema, name: entity.name },
    snapshotId: snapshot.identity.snapshotId,
    projections: ['entities', 'columns', 'relationships', 'constraints'],
  }));
}

function refusal(query, provider, condition, kind = 'validationRefusal') {
  return { version: 1, provider, query, error: { kind, condition, limits: [] } };
}

export async function catalogAdapterMain({ readStdin, writeStdout, writeStderr }) {
  const raw = await readStdin();
  let frame;
  try {
    frame = JSON.parse(raw);
  } catch (error) {
    writeStdout(`${JSON.stringify(refusal(null, null, 'the input frame is not JSON'))}\n`);
    return 2;
  }
  const { provider, query } = frame;
  if (frame.version !== 1 || !PROVIDERS.has(provider) || typeof frame.request !== 'string' || frame.request.length === 0) {
    writeStdout(`${JSON.stringify(refusal(query ?? null, provider ?? null, 'the frame needs version 1, a known provider and the canonical request text'))}\n`);
    return 2;
  }
  let request;
  try {
    request = JSON.parse(frame.request);
  } catch (error) {
    writeStdout(`${JSON.stringify(refusal(query, provider, 'the canonical request text is not JSON'))}\n`);
    return 2;
  }
  if (request.version !== 1 || request.engine !== provider) {
    writeStdout(`${JSON.stringify(refusal(query, provider, 'the request engine does not match the selected provider'))}\n`);
    return 2;
  }
  const subject = request.subject ?? {};
  const database = subject.database ?? {};
  if (subject.kind !== 'entity' || typeof database !== 'object') {
    writeStdout(`${JSON.stringify(refusal(query, provider, 'this adapter serves the entity subject'))}\n`);
    return 2;
  }
  if (provider === 'sqlite-schema' && (database.engine !== 'sqlite-schema' || typeof database.path !== 'string')) {
    writeStdout(`${JSON.stringify(refusal(query, provider, 'the entity subject needs a sqlite-schema database path'))}\n`);
    return 2;
  }
  if (provider === 'postgres-schema' && (database.engine !== 'postgres-schema' || typeof database.connectionFile !== 'string')) {
    writeStdout(`${JSON.stringify(refusal(query, provider, 'the entity subject needs a postgres-schema connection file'))}\n`);
    return 2;
  }
  const select = Array.isArray(request.select) ? request.select : [];
  if (select.length === 0) {
    writeStdout(`${JSON.stringify(refusal(query, provider, 'the request selects no projection'))}\n`);
    return 2;
  }
  const records = Array.isArray(frame.inputs?.records) ? frame.inputs.records : [];
  const operation = operationFor({ provider, select, records });
  const requiredEffects = requiredEffectsFor(operation);
  const effects = Array.isArray(request.effects) ? request.effects : [];
  // Component defense for a directly invoked provider. Managed admission
  // remains with the native lifecycle and the core's effect construction.
  if (requiredEffects.some(effect => !effects.includes(effect))) {
    writeStdout(`${JSON.stringify(refusal(query, provider, `the ${operation} operation requires ${requiredEffects.join(', ')}`, 'operationRefused'))}\n`);
    return 2;
  }

  try {
    if (provider === 'sqlite-schema') {
      // One session serves both halves: the catalog facts, the engine plans and
      // the join all come from one connection and one read transaction.
      const session = createSqliteSession({ path: database.path, DatabaseSync });
      let joined = { relations: [], refs: [], limits: [] };
      let snapshot;
      try {
        if (operation === 'codeAccessJoin') joined = session.join({ records });
        snapshot = { identity: session.identity, catalog: session.catalog, limits: session.limits, stableWithinTransaction: session.stability().stableWithinTransaction };
      } finally {
        session.close();
      }
      const facts = [
        ...factsFromSnapshot({ provider, snapshot, select }),
        ...(select.includes('columnOrigins') ? [{
          id: 'columnOrigins:provider',
          kind: 'columnOrigins',
          classification: 'observed',
          value: { availability: session.originCapability.available ? 'available' : 'unavailable', reason: session.originCapability.reason, probe: session.originCapability.probe },
          evidence: [{ kind: 'schema', databaseIdentity: snapshot.identity.snapshotId, schemaDigest: snapshot.identity.catalogDigest, object: null, column: null }],
          limits: [],
        }] : []),
      ];
      const limits = [...snapshot.limits, ...joined.limits];
      writeStdout(`${JSON.stringify({
        version: 1,
        provider,
        query,
        operation,
        requiredEffects,
        subject: { kind: 'entity', database: { engine: 'sqlite-schema', path: snapshot.identity.realPath } },
        snapshot: { snapshotId: snapshot.identity.snapshotId, engine: snapshot.identity.engine, version: snapshot.identity.version, sourceId: snapshot.identity.sourceId, fileIdentity: snapshot.identity.fileIdentity, catalogDigest: snapshot.identity.catalogDigest, connection: snapshot.identity.connection, observations: snapshot.identity.observations },
        facts,
        relations: joined.relations,
        refs: [...refsFromSnapshot({ provider, snapshot }), ...joined.refs],
        limits,
        coverage: { examined: [snapshot.identity.realPath], excluded: [], providerCompletion: snapshot.stableWithinTransaction, unsupported: [] },
        applicability: 'current',
        changedInputs: [],
      })}\n`);
      return 0;
    }

    const session = openPostgresSession({ psql: process.env.BATON2_CONTEXT_PSQL ?? 'psql', serviceFile: database.connectionFile, home: process.env.HOME, tempDirectory: process.env.TMPDIR });
    if (session.status !== 'captured') {
      writeStdout(`${JSON.stringify(refusal(query, provider, `catalog capture failed: ${session.refusal?.reason ?? 'unknown'}`))}\n`);
      writeStderr(`${JSON.stringify(session.refusal ?? {})}\n`);
      return 2;
    }
    const snapshot = { identity: session.identity, catalog: session.catalog, limits: session.limits };
    let relations = [];
    let limits = [...session.limits];
    if (operation === 'codeAccessJoin') {
      for (const fact of records) {
        const text = fact?.value?.record?.sql?.text;
        if (typeof text !== 'string' || text.length === 0) continue;
        const plan = session.analyze({ sql: text, effects: ['planTargetSql'] });
        if (plan.status !== 'analyzed') {
          limits.push({ projection: 'databaseAccesses', code: plan.refusal?.reason ?? 'statementRefused', detail: plan.refusal?.detail ?? 'the engine refused the statement' });
          continue;
        }
        const joinedPlan = joinPostgresRelations({ plan, catalog: session.catalog, session });
        relations = relations.concat(joinedPlan.relations);
        limits = limits.concat(joinedPlan.unknownAccess.map(access => ({ projection: 'databaseAccesses', code: 'modeledAccessUnavailable', detail: `${access.schema ?? '?'}.${access.name ?? '?'}: ${access.reason}` })));
      }
    }
    session.close();
    writeStdout(`${JSON.stringify({
      version: 1,
      provider,
      query,
      operation,
      requiredEffects,
      subject: { kind: 'entity', database: { engine: 'postgres-schema', database: snapshot.identity.database } },
      snapshot: { snapshotId: snapshot.identity.snapshotId, engine: snapshot.identity.engine, version: snapshot.identity.version, database: snapshot.identity.database, role: snapshot.identity.role, searchPath: snapshot.identity.searchPath, catalogDigest: snapshot.identity.catalogDigest },
      facts: factsFromSnapshot({ provider, snapshot, select }),
      relations,
      refs: refsFromSnapshot({ provider, snapshot }),
      limits,
      coverage: { examined: [snapshot.identity.database], excluded: [], providerCompletion: true, unsupported: [] },
      applicability: 'current',
      changedInputs: [],
    })}\n`);
    return 0;
  } catch (error) {
    writeStderr(`${String(error?.stack ?? error)}\n`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const code = await catalogAdapterMain({
    readStdin: async () => Buffer.concat(chunks).toString('utf8'),
    writeStdout: text => process.stdout.write(text),
    writeStderr: text => process.stderr.write(text),
  });
  process.exitCode = code;
}
