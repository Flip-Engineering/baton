// Adapter entry for the data-model provider: JSON Schema admission and
// validation, explicit target model loading and the model-use source join.
//
// Launch: <absolute node> <absolute libexec/baton2/context/models/adapter.mjs>
//
// stdin: exactly one frame, then EOF:
//   {"version":1,"provider":"data-model","query":"<query id>",
//    "request":<canonical request text>,
//    "inputs":{"records":[<moduleUse facts>],"model":<observed model identity>,
//              "home":"<private HOME>","tempDirectory":"<private TMPDIR>",
//              "outputDirectory":"<private artifact directory>"}}
//
// stdout: exactly one frame, newline terminated, and nothing else:
//   success (exit 0):
//   {"version":1,"provider":"data-model","query":..,"operation":..,"requiredEffects":[..],
//    "subject":..,"snapshot":..,"facts":[..],"relations":[..],"refs":[..],"limits":[..],
//    "coverage":{..},"applicability":..,"changedInputs":[..]}
//   refusal (exit 2): {"version":1,"provider":"data-model","query":..,
//     "error":{"kind":"validationRefusal"|"operationRefused","condition":"<fixed text>","limits":[]}}
//   failure (exit 1): stderr only.
//
// Operation selection follows the requested projections, not the presence of a
// grant: a request whose model subject selects validation or serialization is a
// modelLoad operation and refuses when executeTarget is absent, while a request
// that selects only codeAccesses is a sourceAnalysis operation that imports no
// project module. The joint model-use source selector is `options.code`, the
// admitted position or symbol selector for the importing handler.
//
// The Ajv engine comes from the packaged dependency closure only. Tests inject
// their own engine through the module exports of json-schema.mjs.

import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

import { createJsonSchemaProvider } from './json-schema.mjs';
import { readJsonSample } from './sample.mjs';
import { runZodModelChild } from './zod-model.mjs';
import { joinModelUses } from './model-use-join.mjs';
import { MODEL_OPERATIONS } from './operations.mjs';

const ADAPTER_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MODEL_PROJECTIONS = new Set(['validation', 'serialization', 'structure', 'codeAccesses']);
const SCHEMA_PROJECTIONS = new Set(['validation', 'structure']);

// The packaged dependency closure: <adapter root>/node_modules/ajv. No
// development override, no ancestor lookup and no wildcard resolution.
export async function loadPackagedAjv() {
  const packageRoot = join(ADAPTER_DIRECTORY, '..', 'node_modules', 'ajv');
  const entry = join(packageRoot, 'dist', '2020.js');
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const module = await import(pathToFileURL(entry).href);
  return {
    Ajv2020: module.default ?? module,
    path: entry,
    name: manifest.name,
    version: manifest.version,
  };
}

function operationFor({ subject, select }) {
  if (subject.kind === 'schema') return 'schemaValidation';
  if (subject.kind !== 'model') return null;
  if (select.includes('validation') || select.includes('serialization')) return 'modelLoad';
  return 'sourceAnalysis';
}

function requiredEffectsFor(operation) {
  return MODEL_OPERATIONS.find(row => row.operation === operation)?.requiredEffects ?? [];
}

function refusal(query, condition, kind = 'validationRefusal') {
  return { version: 1, provider: 'data-model', query, error: { kind, condition, limits: [] } };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// Top-level structure of a JSON Schema document, for the `structure` projection.
function schemaStructure(document) {
  const properties = document?.properties ?? {};
  return {
    type: document?.type ?? null,
    required: Array.isArray(document?.required) ? [...document.required] : [],
    properties: Object.entries(properties).map(([name, value]) => ({
      name,
      type: value?.type ?? null,
      format: typeof value?.format === 'string' ? value.format : null,
      pointer: `/properties/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`,
    })),
    definitions: Object.keys(document?.$defs ?? {}),
  };
}

async function schemaValidation({ frame, query, request, select, writeStdout }) {
  const subject = request.subject ?? {};
  if (typeof subject.path !== 'string' || typeof subject.sample !== 'string') {
    writeStdout(`${JSON.stringify(refusal(query, 'the schema subject needs a schema path and a sample path'))}\n`);
    return 2;
  }
  let engine;
  try {
    engine = await loadPackagedAjv();
  } catch (error) {
    writeStdout(`${JSON.stringify(refusal(query, `the packaged Ajv dependency did not resolve: ${String(error?.message ?? error)}`, 'operationRefused'))}\n`);
    return 2;
  }
  const schemaBytes = readFileSync(subject.path);
  const resourcePaths = Array.isArray(subject.resources) ? subject.resources : [];
  const resources = resourcePaths.map(path => ({ path, bytes: readFileSync(path) }));
  const sample = readJsonSample({ path: subject.sample });
  if (sample.status !== 'ok') {
    writeStdout(`${JSON.stringify(refusal(query, `the sample is not JSON: ${sample.reason}`))}\n`);
    return 2;
  }
  let document;
  try {
    document = JSON.parse(schemaBytes.toString('utf8'));
  } catch (error) {
    writeStdout(`${JSON.stringify(refusal(query, `the schema is not JSON: ${error.message}`))}\n`);
    return 2;
  }
  const provider = createJsonSchemaProvider({ Ajv2020: engine.Ajv2020, version: engine.version, path: engine.path });
  // Every captured input enters the snapshot identity: changing the schema or a
  // resource changes it even when the sample does not.
  const snapshotId = sha256(JSON.stringify({
    provider: { name: engine.name, version: engine.version, path: engine.path },
    schema: { path: subject.path, sha256: sha256(schemaBytes) },
    resources: resources.map(resource => ({ path: resource.path, sha256: sha256(resource.bytes) })),
    sample: { path: subject.sample, sha256: sample.sha256 },
  }));
  const facts = [];
  const limits = [];
  if (select.includes('structure')) {
    facts.push({
      id: `structure:${sha256(schemaBytes)}`,
      kind: 'schemaStructure',
      classification: 'declared',
      value: schemaStructure(document),
      evidence: [{ kind: 'document', path: subject.path, sha256: sha256(schemaBytes), pointer: '' }],
      limits: [],
    });
  }
  if (select.includes('validation')) {
    const verdict = provider.validate({ schema: document, resources: resources.map(resource => JSON.parse(resource.bytes.toString('utf8'))), instance: sample.value });
    if (verdict.status === 'validated') {
      facts.push({
        id: `validation:${sample.sha256}`,
        kind: 'validation',
        classification: 'observed',
        value: { verdict: verdict.verdict, errors: verdict.errors, provider: engine },
        evidence: [{ kind: 'document', path: subject.sample, sha256: sample.sha256, pointer: '' }],
        limits: [],
      });
    } else {
      limits.push({ projection: 'validation', code: verdict.reason, detail: verdict.detail });
    }
  }
  writeStdout(`${JSON.stringify({
    version: 1,
    provider: 'data-model',
    query,
    operation: 'schemaValidation',
    requiredEffects: [],
    subject: { kind: 'schema', path: subject.path, sample: subject.sample, resources: resourcePaths },
    snapshot: { snapshotId, engine: 'data-model', provider: { name: engine.name, version: engine.version, path: engine.path }, schema: { path: subject.path, sha256: sha256(schemaBytes) }, sample: { path: subject.sample, sha256: sample.sha256 } },
    facts,
    relations: [],
    refs: [],
    limits,
    coverage: { examined: [subject.path, subject.sample, ...resourcePaths], excluded: [], providerCompletion: true, unsupported: select.filter(projection => !SCHEMA_PROJECTIONS.has(projection)) },
    applicability: 'current',
    changedInputs: [],
  })}\n`);
  return 0;
}

async function modelLoad({ frame, query, request, select, writeStdout, childPath, node }) {
  const subject = request.subject ?? {};
  if (typeof subject.module !== 'string' || typeof subject.sample !== 'string') {
    writeStdout(`${JSON.stringify(refusal(query, 'the model subject needs module and sample paths'))}\n`);
    return 2;
  }
  const inputs = frame.inputs ?? {};
  if (typeof inputs.home !== 'string' || typeof inputs.outputDirectory !== 'string') {
    writeStdout(`${JSON.stringify(refusal(query, 'the modelLoad operation needs inputs.home and inputs.outputDirectory from the managed launch'))}\n`);
    return 2;
  }
  const result = await runZodModelChild({
    node,
    childPath,
    target: { module: subject.module, export: subject.export ?? null, sample: subject.sample },
    effects: Array.isArray(request.effects) ? request.effects : [],
    home: inputs.home,
    tempDirectory: inputs.tempDirectory ?? inputs.home,
    outputDirectory: inputs.outputDirectory,
  });
  if (result.status !== 'ok') {
    writeStdout(`${JSON.stringify({ ...refusal(query, result.refusal?.detail ?? result.detail ?? result.reason, 'operationRefused'), child: result.child ?? null })}\n`);
    writeStderr(`${JSON.stringify(result.private ?? {})}\n`);
    return 2;
  }
  const document = result.document;
  const facts = [];
  if (select.includes('validation')) {
    facts.push({
      id: `validation:${document.sample.sha256}`,
      kind: 'validation',
      classification: 'observed',
      value: { verdict: document.validation.verdict, issues: document.validation.issues, output: document.validation.output ?? null },
      evidence: [{ kind: 'document', path: document.sample.path, sha256: document.sample.sha256, pointer: '' }],
      limits: document.limits,
    });
  }
  if (select.includes('structure') || select.includes('serialization')) {
    facts.push({
      id: `schema:${document.target.module.sha256}:${document.target.export.name ?? 'default'}`,
      kind: 'modelSchema',
      classification: 'declared',
      value: { input: document.schemas.input, output: document.schemas.output, provider: document.provider },
      evidence: [{ kind: 'document', path: document.target.module.path, sha256: document.target.module.sha256, pointer: '' }],
      limits: document.limits,
    });
  }
  if (select.includes('serialization')) {
    facts.push({
      id: `serialization:${document.sample.sha256}`,
      kind: 'serialization',
      classification: 'observed',
      value: document.serialization,
      evidence: [{ kind: 'document', path: document.sample.path, sha256: document.sample.sha256, pointer: '' }],
      limits: [],
    });
  }
  const limits = [
    ...document.limits,
    {
      projection: 'launch',
      code: 'managedLaunchUncomposed',
      detail: 'this component driver starts the child itself; canonical admitted launch and custody remain with the native managed-child operation',
    },
  ];
  writeStdout(`${JSON.stringify({
    version: 1,
    provider: 'data-model',
    query,
    operation: 'modelLoad',
    requiredEffects: ['executeTarget'],
    subject: { kind: 'model', module: document.target.module.path, export: document.target.export.name },
    snapshot: {
      snapshotId: document.target.module.sha256,
      engine: 'data-model',
      provider: document.provider,
      module: document.target.module,
      sample: document.sample,
      artifacts: { stdout: document.targetOutput.stdout, stderr: document.targetOutput.stderr },
      child: result.child,
    },
    facts,
    relations: [],
    refs: [],
    limits,
    coverage: {
      examined: [document.target.module.path, document.sample.path],
      excluded: [],
      providerCompletion: true,
      unsupported: select.filter(projection => !MODEL_PROJECTIONS.has(projection)),
      boundary: document.targetOutput.boundary,
    },
    applicability: document.applicability,
    changedInputs: [],
  })}\n`);
  return 0;
}

async function sourceAnalysis({ frame, query, request, select, writeStdout }) {
  const subject = request.subject ?? {};
  if (typeof subject.module !== 'string' || typeof subject.export !== 'string') {
    writeStdout(`${JSON.stringify(refusal(query, 'the sourceAnalysis operation needs the requested model module and export'))}\n`);
    return 2;
  }
  const code = request.options?.code;
  if (code === null || typeof code !== 'object') {
    writeStdout(`${JSON.stringify(refusal(query, 'the sourceAnalysis operation needs options.code, the admitted selector for the importing handler'))}\n`);
    return 2;
  }
  // The requested model identity comes from the captured module bytes, not from
  // the resolver records under comparison.
  let requested;
  try {
    const realPath = realpathSync(subject.module);
    const bytes = readFileSync(realPath);
    requested = { module: { path: subject.module, realPath, sha256: sha256(bytes) }, export: { name: subject.export }, snapshotId: `requested:${sha256(bytes)}` };
  } catch (error) {
    writeStdout(`${JSON.stringify(refusal(query, `the requested model module is not readable: ${error.message}`))}\n`);
    return 2;
  }
  const observed = frame.inputs?.model ?? null;
  if (observed === null) {
    writeStdout(`${JSON.stringify(refusal(query, 'the sourceAnalysis operation needs inputs.model, the identity observed by a modelLoad run', 'operationRefused'))}\n`);
    return 2;
  }
  const observedPath = observed.module?.realPath ?? observed.module?.path ?? null;
  if (observedPath !== requested.module.realPath || observed.module?.sha256 !== requested.module.sha256 || observed.export?.name !== requested.export.name) {
    writeStdout(`${JSON.stringify(refusal(query, 'the supplied model identity does not match the requested module and export; the join never binds whichever model was supplied', 'operationRefused'))}\n`);
    return 2;
  }
  const records = Array.isArray(frame.inputs?.records) ? frame.inputs.records : [];
  const joined = joinModelUses({ model: observed, uses: records });
  writeStdout(`${JSON.stringify({
    version: 1,
    provider: 'data-model',
    query,
    operation: 'sourceAnalysis',
    requiredEffects: [],
    subject: { kind: 'model', module: requested.module.path, export: requested.export.name },
    snapshot: { snapshotId: observed.snapshotId ?? null, engine: 'data-model', requested, model: observed },
    facts: [],
    relations: joined.relations,
    refs: joined.refs,
    limits: joined.limits,
    coverage: { examined: records.map(record => record.value?.record?.useSite?.path).filter(Boolean), excluded: [], providerCompletion: true, unsupported: select.filter(projection => !MODEL_PROJECTIONS.has(projection)) },
    applicability: 'current',
    changedInputs: [],
  })}\n`);
  return 0;
}

export async function modelAdapterMain({ readStdin, writeStdout, writeStderr, childPath, node = process.execPath }) {
  const raw = await readStdin();
  let frame;
  try {
    frame = JSON.parse(raw);
  } catch {
    writeStdout(`${JSON.stringify(refusal(null, 'the input frame is not JSON'))}\n`);
    return 2;
  }
  const { query } = frame;
  if (frame.version !== 1 || frame.provider !== 'data-model' || typeof frame.request !== 'string' || frame.request.length === 0) {
    writeStdout(`${JSON.stringify(refusal(query ?? null, 'the frame needs version 1, provider data-model and the canonical request text'))}\n`);
    return 2;
  }
  let request;
  try {
    request = JSON.parse(frame.request);
  } catch {
    writeStdout(`${JSON.stringify(refusal(query, 'the canonical request text is not JSON'))}\n`);
    return 2;
  }
  if (request.version !== 1 || request.engine !== 'data-model') {
    writeStdout(`${JSON.stringify(refusal(query, 'the request engine does not match the data-model provider'))}\n`);
    return 2;
  }
  const subject = request.subject ?? {};
  const select = Array.isArray(request.select) ? request.select : [];
  if (select.length === 0) {
    writeStdout(`${JSON.stringify(refusal(query, 'the request selects no projection'))}\n`);
    return 2;
  }
  const operation = operationFor({ subject, select });
  if (operation === null) {
    writeStdout(`${JSON.stringify(refusal(query, 'this adapter serves the schema and model subjects'))}\n`);
    return 2;
  }
  const requiredEffects = requiredEffectsFor(operation);
  const effects = Array.isArray(request.effects) ? request.effects : [];
  if (requiredEffects.some(effect => !effects.includes(effect))) {
    writeStdout(`${JSON.stringify(refusal(query, `the ${operation} operation requires ${requiredEffects.join(', ')}`, 'operationRefused'))}\n`);
    return 2;
  }
  try {
    if (operation === 'schemaValidation') return await schemaValidation({ frame, query, request, select, writeStdout });
    if (operation === 'modelLoad') return await modelLoad({ frame, query, request, select, writeStdout, childPath, node });
    return await sourceAnalysis({ frame, query, request, select, writeStdout });
  } catch (error) {
    writeStderr(`${String(error?.stack ?? error)}\n`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const code = await modelAdapterMain({
    readStdin: async () => Buffer.concat(chunks).toString('utf8'),
    writeStdout: text => process.stdout.write(text),
    writeStderr: text => process.stderr.write(text),
    childPath: join(ADAPTER_DIRECTORY, 'zod-child.mjs'),
  });
  process.exitCode = code;
}
