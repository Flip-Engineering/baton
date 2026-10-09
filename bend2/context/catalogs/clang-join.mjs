// Handler-statement to catalog-object joint for the Clang context provider.
//
// Input: the statement records the clang extractor emits for one handler - for
// each helper candidate literal, the decoded statement text the extractor carries
// as `valueText`, its `rawSource` span, and the relation ids that tie it to the
// extracted call and helper: `callId`, `helperName`, `helperUsr`,
// `argumentIndex` - plus the consumed input digests and one open catalog session.
//
// Output: relation records in the vocabulary sql-join.mjs already uses, the refs
// they cite, the findings the joint could not resolve, and the session limits.
//
// The statement text is framed by the same scan the SQLite statement path uses:
// one statement is captured, and its relation identity comes from the engine parse
// and the rootpage join against the captured catalog. A text carrying more than
// one statement, an unterminated literal, a statement the engine refused, a
// statement whose literal the extractor did not emit (SQL built at runtime) and
// every access the join cannot bind to exactly one captured catalog object are
// findings, not refusals: each keeps the facts it observed and no relation is
// invented for it.
//
// This reads supplied values. It does not decode source bytes, does not compare
// the literal digest, and does not run clang: the text it frames is the value the
// extractor emitted, and the span it cites is the span the extractor recorded.

import { statementFraming } from './sqlite-statement.mjs';
import { entityRef, refId } from './sql-join.mjs';

// The engine token a Clang-provided source position carries.
export const CLANG_ENGINE = 'clang';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

// One statement record per literal of a helper candidate, carrying the literal
// text and span the extractor emitted and the candidate's call identity.
export function statementsFromOutput(output) {
  const statements = [];
  for (const candidate of output?.helperCandidates ?? []) {
    for (const literal of candidate?.sqlLiterals ?? []) {
      statements.push({
        callId: candidate?.callId ?? null,
        helperName: candidate?.helperName ?? null,
        helperUsr: candidate?.helperUsr ?? null,
        boundLocalUsr: candidate?.boundLocalUsr ?? null,
        boundLocalName: candidate?.boundLocalName ?? null,
        lineageStatus: candidate?.lineageStatus ?? null,
        argumentIndex: literal?.argumentIndex ?? null,
        valueText: literal?.valueText ?? null,
        valueSha256: literal?.valueSha256 ?? null,
        valueLength: literal?.valueLength ?? null,
        rawSource: literal?.rawSource ?? null,
      });
    }
  }
  return statements;
}

function inputDigest(consumedInputs, path) {
  if (!isNonEmptyString(path)) return null;
  return consumedInputs.find(input => input?.path === path)?.sha256 ?? null;
}

function statementWhere(record) {
  return {
    callId: record?.callId ?? null,
    helperName: record?.helperName ?? null,
    helperUsr: record?.helperUsr ?? null,
    argumentIndex: record?.argumentIndex ?? null,
    rawSource: record?.rawSource ?? null,
  };
}

function sourceRef({ record, digest, snapshotId }) {
  const span = record?.rawSource ?? {};
  return {
    id: refId(['source', CLANG_ENGINE, span.file ?? null, digest, String(span.byteStart ?? null), String(span.byteEnd ?? null), 'databaseAccesses']),
    engine: CLANG_ENGINE,
    subject: {
      kind: 'position',
      path: span.file ?? null,
      byteStart: span.byteStart ?? null,
      byteEnd: span.byteEnd ?? null,
      expanded: span.expanded === true,
    },
    snapshotId,
    projections: ['databaseAccesses'],
  };
}

export function joinClangStatements({ statements, session, consumedInputs = [], extractorProvider = null }) {
  const relations = [];
  const refs = [];
  const unresolved = [];
  const snapshotId = session?.identity?.snapshotId ?? null;
  let ordinal = 0;

  for (const record of statements ?? []) {
    const where = statementWhere(record);
    if (!isNonEmptyString(record?.valueText)) {
      unresolved.push({ code: 'dynamicStatement', detail: 'the extractor emitted no literal text for this statement; SQL built at runtime is not joined', statement: where });
      continue;
    }
    const framing = statementFraming(record.valueText);
    if (framing.status !== 'admitted') {
      unresolved.push({ code: framing.reason, detail: framing.detail, statement: where });
      continue;
    }
    const plan = session.analyze({ id: isNonEmptyString(record.callId) ? record.callId : null, sql: record.valueText });
    if (plan?.status !== 'analyzed') {
      unresolved.push({
        code: plan?.reason ?? 'statementRefused',
        detail: plan?.detail ?? 'the engine did not analyze the statement',
        statement: where,
      });
      continue;
    }

    const digest = inputDigest(consumedInputs, record.rawSource?.file);
    const source = sourceRef({ record, digest, snapshotId });
    if (!refs.some(ref => ref.id === source.id)) refs.push(source);

    for (const access of plan.unknownAccess ?? []) {
      unresolved.push({
        code: 'modeledAccessUnavailable',
        reason: access?.reason ?? null,
        detail: access?.detail ?? null,
        rootpage: access?.rootpage ?? null,
        opcode: access?.opcode ?? null,
        statement: where,
      });
    }
    for (const access of plan.relations ?? []) {
      if (access?.status !== 'joined') {
        unresolved.push({
          code: 'modeledAccessUnavailable',
          reason: access?.reason ?? 'unjoinedAccess',
          detail: access?.detail ?? null,
          rootpage: access?.rootpage ?? null,
          opcode: access?.opcode ?? null,
          statement: where,
        });
        continue;
      }
      ordinal += 1;
      const objectRef = entityRef({ object: access.object, session });
      if (!refs.some(ref => ref.id === objectRef.id)) refs.push(objectRef);
      relations.push({
        id: refId(['relation', 'databaseAccess', CLANG_ENGINE, source.id, String(ordinal)]),
        kind: 'databaseAccess',
        classification: 'static-possible',
        value: {
          catalogSnapshotId: snapshotId,
          statementKind: plan.kind,
          statementText: record.valueText,
          statementFrame: source.subject,
          literal: {
            sha256: record.valueSha256 ?? null,
            length: record.valueLength ?? null,
            argumentIndex: where.argumentIndex,
            lineageStatus: record.lineageStatus ?? null,
          },
          handler: { callId: where.callId, helperName: where.helperName, helperUsr: where.helperUsr },
          parameterCount: plan.parameters?.count ?? null,
          extractorProvider,
          object: access.object,
          rootpage: access.rootpage,
          opcode: access.opcode,
          column: null,
        },
        from: source.id,
        to: objectRef.id,
        evidence: [
          { kind: 'source', path: source.subject.path, sha256: digest, range: { byteStart: source.subject.byteStart, byteEnd: source.subject.byteEnd }, role: 'sqlLiteral' },
          { kind: 'schema', databaseIdentity: snapshotId, schemaDigest: session?.identity?.catalogDigest ?? null, object: `${access.object.schema}.${access.object.name}`, column: null },
        ],
        limits: (plan.limits ?? []).filter(limit => limit?.projection === 'databaseAccesses'),
      });
    }
  }

  return { relations, refs, unresolved, limits: [...(session?.limits ?? [])] };
}
