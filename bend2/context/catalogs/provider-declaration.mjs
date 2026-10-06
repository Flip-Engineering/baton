// Provider-owned declaration for the catalog modules.
//
// Core assigns schema names to provider declarations and the Codec owns the
// shared vocabulary. This file supplies the catalog provider's own values: the
// module, the contract and protocol versions it implements, the packaged entry
// and its closure, one result schema per operation, the execution token and
// declared effects of each operation, the lifetime profile it holds, and for
// every operation the dependency producer records it consumes as input.
//
// Each operation output schema is distinct from every dependency output schema
// the same operation consumes: an operation's own result is not its input.
// Schema ids follow the convention already in the tree (`baton2.context.<thing>.v1`).
//
// The artifact entries name a path and a role. The `sha256` an artifact identity
// carries is computed when the module is packaged, so it is not a value this
// declaration can hold.
//
// Nothing here authenticates provenance, opens a connection, or reads a capture
// payload. `checkProviderDeclaration` checks only what the provider itself must
// know for its own mapping to be total; core and codec own the declaration
// admission of the frozen contract.

export const PROVIDER_DECLARATION_SCHEMA = 'baton2.context.provider-declaration.v1';
export const CONTRACT_VERSION = '1';
export const PROTOCOL_VERSION = '1';

// The common operation names this provider implements, in the closed set the
// core uses for catalog work.
export const CATALOG_COMMON_OPERATIONS = Object.freeze(['catalogCapture', 'sqlPlan', 'codeAccessJoin']);

// Every catalog operation opens the target catalog through a managed child
// process, so the execution token is the same for all three.
export const CATALOG_EXECUTION = 'managed';

// The producer whose records the code-access join consumes as input. The record
// contract is the TypeScript provider's: one constant-SQL call per record under
// `baton2.context.resolver-record.v1`, with kind `constantSql`. Raw TypeScript
// source text delivered as a plan capture is not a record of this kind.
export const TYPESCRIPT_PRODUCER_MODULE = 'typescript';
export const TYPESCRIPT_RECORD_SCHEMA = 'baton2.context.resolver-record.v1';
export const TYPESCRIPT_RECORD_KIND = 'constantSql';
// The producer operation id and the module id above are required values this
// declaration cites, and neither is published by the TypeScript lane: that lane
// publishes one resolver record schema, launches its provider under a
// caller-stamped query id, and names no module id and no operation id. The
// assignment belongs to synthesis module-registry agreement, so the marker
// records the status of the value rather than a provenance claim about it.
export const TYPESCRIPT_PRODUCER_ID_STATUS = 'required-pending';
export const TYPESCRIPT_PRODUCER_OPERATION = 'sourceAnalysis';

const ADAPTER_PATH = 'libexec/baton2/context/catalogs/adapter.mjs';

const CATALOG_LIFETIME = Object.freeze({
  profile: 'held-read-transaction',
  detail: 'one read-only connection and one read transaction hold the catalog and every statement analysis of the operation; released before the result is returned',
});

const SQLITE_CLOSURE = [
  ADAPTER_PATH,
  'libexec/baton2/context/catalogs/sqlite-catalog.mjs',
  'libexec/baton2/context/catalogs/sqlite-statement.mjs',
  'libexec/baton2/context/catalogs/sql-scan.mjs',
  'libexec/baton2/context/catalogs/sql-join.mjs',
  'libexec/baton2/context/catalogs/canonical.mjs',
  'libexec/baton2/context/catalogs/failure.mjs',
  'libexec/baton2/context/catalogs/operations.mjs',
];

const POSTGRES_CLOSURE = [
  ADAPTER_PATH,
  'libexec/baton2/context/catalogs/postgres-catalog.mjs',
  'libexec/baton2/context/catalogs/sql-scan.mjs',
  'libexec/baton2/context/catalogs/sql-join.mjs',
  'libexec/baton2/context/catalogs/canonical.mjs',
  'libexec/baton2/context/catalogs/failure.mjs',
  'libexec/baton2/context/catalogs/operations.mjs',
];

const CODE_ACCESS_EDGE = Object.freeze({
  moduleId: TYPESCRIPT_PRODUCER_MODULE,
  operation: TYPESCRIPT_PRODUCER_OPERATION,
  idStatus: TYPESCRIPT_PRODUCER_ID_STATUS,
  schema: TYPESCRIPT_RECORD_SCHEMA,
  kind: TYPESCRIPT_RECORD_KIND,
  // How the producer's record reaches this consumer: a `sqlCall` fact whose
  // `value.record` is the constant-SQL record. This is the shape
  // `admitSqlCallRecord` in sql-join.mjs reads before it admits the record.
  envelope: Object.freeze({ factKind: 'sqlCall', recordMember: 'value.record' }),
});

function resultSchema(engine, operation) {
  return `baton2.context.${engine}.${operation}.result.v1`;
}

function declaration({ moduleId, closure }) {
  return {
    schema: PROVIDER_DECLARATION_SCHEMA,
    contractVersion: CONTRACT_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    moduleId,
    entry: { path: ADAPTER_PATH, role: 'adapter' },
    artifacts: closure.map(path => ({ path, role: 'adapter' })),
    schemas: CATALOG_COMMON_OPERATIONS.map(operation => resultSchema(moduleId, operation)),
    lifetime: CATALOG_LIFETIME,
    operations: [
      { operation: 'catalogCapture', execution: CATALOG_EXECUTION, effects: [], resultSchema: resultSchema(moduleId, 'catalogCapture'), consumes: [] },
      { operation: 'sqlPlan', execution: CATALOG_EXECUTION, effects: ['planTargetSql'], resultSchema: resultSchema(moduleId, 'sqlPlan'), consumes: [] },
      { operation: 'codeAccessJoin', execution: CATALOG_EXECUTION, effects: ['planTargetSql'], resultSchema: resultSchema(moduleId, 'codeAccessJoin'), consumes: [CODE_ACCESS_EDGE] },
    ],
  };
}

export const PROVIDER_DECLARATIONS = Object.freeze([
  declaration({ moduleId: 'sqlite-schema', closure: SQLITE_CLOSURE }),
  declaration({ moduleId: 'postgres-schema', closure: POSTGRES_CLOSURE }),
]);

// The provider's own completeness check, made once at startup. The codes are
// provider-local because the conditions are the provider's: a declared operation
// must name a result schema the mapping can compare a step against, every
// operation must carry the execution token the mapping compares, and every
// consumed edge must be complete and must not be the operation's own result.
export function checkProviderDeclaration(d) {
  const reasons = [];
  const declaredSchemas = new Set(Array.isArray(d?.schemas) ? d.schemas : []);
  const operations = Array.isArray(d?.operations) ? d.operations : [];
  if (operations.length === 0) reasons.push({ code: 'operationsEmpty', detail: `${d?.moduleId} declares no operation` });
  for (const operation of operations) {
    if (typeof operation?.resultSchema !== 'string' || !declaredSchemas.has(operation.resultSchema)) {
      reasons.push({ code: 'resultSchemaUnlisted', detail: `operation ${operation?.operation} declares ${JSON.stringify(operation?.resultSchema)} outside its schema set` });
    }
    if (typeof operation?.execution !== 'string' || operation.execution.length === 0) {
      reasons.push({ code: 'executionMissing', detail: `operation ${operation?.operation} declares no execution token` });
    }
    for (const edge of Array.isArray(operation?.consumes) ? operation.consumes : []) {
      if (typeof edge?.moduleId !== 'string' || typeof edge?.operation !== 'string' || typeof edge?.schema !== 'string' || typeof edge?.kind !== 'string') {
        reasons.push({ code: 'edgeIncomplete', detail: `operation ${operation?.operation} consumes an edge without module, operation, schema and kind` });
        continue;
      }
      if (typeof edge.envelope?.factKind !== 'string' || typeof edge.envelope?.recordMember !== 'string') {
        reasons.push({ code: 'edgeEnvelopeAbsent', detail: `operation ${operation.operation} consumes an edge without the fact kind and record member it arrives under` });
      }
      if (typeof edge.idStatus !== 'string') {
        reasons.push({ code: 'edgeIdStatusAbsent', detail: `operation ${operation.operation} consumes an edge whose producer id status is unrecorded` });
      }
      if (edge.schema === operation.resultSchema) {
        reasons.push({ code: 'edgeSchemaNotDistinct', detail: `operation ${operation.operation} consumes its own result schema ${edge.schema}` });
      }
    }
  }
  return reasons.length === 0 ? { status: 'admitted', declaration: d } : { status: 'refused', reasons };
}

export function declarationForModule(moduleId, declarations = PROVIDER_DECLARATIONS) {
  return declarations.find(entry => entry.moduleId === moduleId) ?? null;
}
