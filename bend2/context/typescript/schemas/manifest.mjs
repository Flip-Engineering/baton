// The schema documents this provider's declaration names, one for every operation and role.
//
// Each document is the admitted mirror of the provider's own closed-schema validation. The
// validator in lib/protocol.mjs is the authority, every document carries a `sourceContract` block
// citing the lines it mirrors, and a change to a cited line requires the document to change with it.
// The admitted identities stay holes: package admission fills them from the inventory it admits, so
// no row here carries an identity string.
//
// The request and result contracts are engine-level, so most role shapes are one document named by
// both operations; `sharedAs` records that and the suite fails when a shared document and its
// original stop being byte-identical. `options` is the role whose shape genuinely differs per
// operation, because a databaseAccesses selection performs sqlPlan and then requires the database
// and client members that sourceAnalysis leaves optional (protocol.mjs:200-210).

export const SCHEMA_DOCUMENT_ROOT = 'libexec/baton2/context/typescript/schemas';
export const SCHEMA_SOURCE_ROOT = 'bend2/context/typescript/schemas';
export const SCHEMA_SOURCE_AUTHORITY = 'bend2/context/typescript/lib/protocol.mjs';
export const SCHEMA_DRIFT_NOTE = 'the validator in lib/protocol.mjs is the authority and every document under schemas/ is its admitted mirror: a change to a cited line requires the document to change with it, and the suite fails when a document stops citing the line it mirrors';

export const ROLE_NAMES = Object.freeze({
  subject: 'the subject member of the admitted canonical request',
  options: 'the options member of the admitted canonical request',
  result: 'the result frame the provider writes for one query',
  reference: 'a source reference carried by the result',
  event: "the refusal frame, the module's other emitted frame",
});

function row({ operation, role, file, lines, sharedAs = null }) {
  return Object.freeze({
    operation,
    role,
    path: `${SCHEMA_DOCUMENT_ROOT}/${operation}/${file}`,
    sourcePath: `${SCHEMA_SOURCE_ROOT}/${operation}/${file}`,
    sourceLines: Object.freeze([...lines]),
    sharedAs,
    names: ROLE_NAMES[role],
    identity: null,
    status: 'unadmitted',
  });
}

const SUBJECT_LINES = ['49', '57-61', '70-73', '89-97', '106-131'];
const OPTIONS_LINES = ['54-56', '74', '89-97', '158-200', '200-210'];
const RESULT_LINES = ['33', '251-290', '118-155'];
const REFERENCE_LINES = ['265-277', '16-23', '99-105'];
const EVENT_LINES = ['294-300', '6-15'];

export const SCHEMA_DOCUMENTS = Object.freeze([
  row({ operation: 'sourceAnalysis', role: 'subject', file: 'subject.request.json', lines: SUBJECT_LINES }),
  row({ operation: 'sourceAnalysis', role: 'options', file: 'options.request.json', lines: OPTIONS_LINES }),
  row({ operation: 'sourceAnalysis', role: 'result', file: 'result.frame.json', lines: RESULT_LINES }),
  row({ operation: 'sourceAnalysis', role: 'reference', file: 'reference.json', lines: REFERENCE_LINES }),
  row({ operation: 'sourceAnalysis', role: 'event', file: 'event.refusal-frame.json', lines: EVENT_LINES }),
  row({
    operation: 'sqlPlan',
    role: 'subject',
    file: 'subject.request.json',
    lines: SUBJECT_LINES,
    sharedAs: 'sourceAnalysis/subject.request.json',
  }),
  row({ operation: 'sqlPlan', role: 'options', file: 'options.request.json', lines: OPTIONS_LINES }),
  row({
    operation: 'sqlPlan',
    role: 'result',
    file: 'result.frame.json',
    lines: RESULT_LINES,
    sharedAs: 'sourceAnalysis/result.frame.json',
  }),
  row({
    operation: 'sqlPlan',
    role: 'reference',
    file: 'reference.json',
    lines: REFERENCE_LINES,
    sharedAs: 'sourceAnalysis/reference.json',
  }),
  row({
    operation: 'sqlPlan',
    role: 'event',
    file: 'event.refusal-frame.json',
    lines: EVENT_LINES,
    sharedAs: 'sourceAnalysis/event.refusal-frame.json',
  }),
]);

export function schemaDocumentsFor(operation) {
  return SCHEMA_DOCUMENTS.filter((document) => document.operation === operation);
}

export function schemaShapeFor(operation, role) {
  const document = SCHEMA_DOCUMENTS.find((entry) => entry.operation === operation && entry.role === role);
  return document === undefined ? null : document.path;
}

// The documents that must stay byte-identical to the document they mirror, as source paths.
export function sharedDocumentPairs() {
  return SCHEMA_DOCUMENTS
    .filter((document) => document.sharedAs !== null)
    .map((document) => ({
      path: document.sourcePath,
      original: `${SCHEMA_SOURCE_ROOT}/${document.sharedAs}`,
    }));
}

// The installed documents the inventory must carry, item by item, each with no identity.
export function schemaDocumentInventory() {
  return SCHEMA_DOCUMENTS.map((document) => ({
    operation: document.operation,
    role: document.role,
    path: document.path,
    sourceLines: [...document.sourceLines],
    identity: null,
    status: 'unadmitted',
  }));
}
