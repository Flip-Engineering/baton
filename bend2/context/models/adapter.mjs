// Adapter entry for the data-model provider: JSON Schema validation, explicit
// target model loading and the model-use source join.
//
// Launch: <absolute node> <absolute libexec/baton2/context/models/adapter.mjs>
//
// stdin: exactly one frame, then EOF:
//   {"version":1,"provider":"data-model","query":"<query id>",
//    "request":<canonical request text>,
//    "inputs":{"records":[<moduleUse facts>],"model":<observed model identity>}}
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
// Operation selection follows the core's closed set: a schema subject is
// schemaValidation, a model subject whose request carries executeTarget is
// modelLoad, and a model subject joined against resolver records without that
// grant is sourceAnalysis. The adapter never imports a project module for
// sourceAnalysis.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { createJsonSchemaProvider } from './json-schema.mjs';
import { readJsonSample, resolveJsonPointer } from './sample.mjs';
import { runZodModelChild } from './zod-model.mjs';
import { joinModelUses } from './model-use-join.mjs';
import { MODEL_OPERATIONS } from './operations.mjs';

const ADAPTER_DIRECTORY = dirname(new URL(import.meta.url).pathname);

// The staged package owns the Ajv dependency. Resolution is package-relative
// first, then the explicit development override. Ancestor packages are never
// consulted.
export async function loadAjv2020() {
  const candidates = [
    process.env.BATON2_CONTEXT_AJV,
    join(ADAPTER_DIRECTORY, '..', 'node_modules', 'ajv', 'dist', '2020.js'),
    join(ADAPTER_DIRECTORY, '..', '..', 'node_modules', 'ajv', 'dist', '2020.js'),
  ].filter(entry => typeof entry === 'string' && entry.length > 0);
  const attempted = [];
  for (const candidate of candidates) {
    try {
      const module = await import(new URL(`file://${candidate}`).href);
      return { Ajv2020: module.default ?? module, path: candidate, attempted };
    } catch (error) {
      attempted.push(`${candidate}: ${error.code ?? error.message}`);
    }
  }
  return { Ajv2020: null, path: null, attempted };
}

function operationFor({ subject, select, effects }) {
  if (subject.kind === 'schema') return 'schemaValidation';
  if (subject.kind === 'model') return effects.includes('executeTarget') ? 'modelLoad' : 'sourceAnalysis';
  return null;
}

function requiredEffectsFor(operation) {
  return MODEL_OPERATIONS.find(row => row.operation === operation)?.requiredEffects ?? [];
}

function refusal(query, condition, kind = 'validationRefusal') {
  return { version: 1, provider: 'data-model', query, error: { kind, condition, limits: [] } };
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
  const effects = Array.isArray(request.effects) ? request.effects : [];
  const operation = operationFor({ subject, select, effects });
  const requiredEffects = operation === null ? [] : requiredEffectsFor(operation);
  if (operation === null) {
    writeStdout(`${JSON.stringify(refusal(query, 'this adapter serves the schema and model subjects'))}\n`);
    return 2;
  }
  if (requiredEffects.some(effect => !effects.includes(effect))) {
    writeStdout(`${JSON.stringify(refusal(query, `the ${operation} operation requires ${requiredEffects.join(', ')}`, 'operationRefused'))}\n`);
    return 2;
  }

  try {
    if (operation === 'schemaValidation') {
      if (typeof subject.path !== 'string' || typeof subject.sample !== 'string') {
        writeStdout(`${JSON.stringify(refusal(query, 'the schema subject needs a schema path and a sample path'))}\n`);
        return 2;
      }
      const { Ajv2020, path, attempted } = await loadAjv2020();
      if (Ajv2020 === null) {
        writeStdout(`${JSON.stringify(refusal(query, `the packaged Ajv draft 2020-12 entry point did not resolve: ${attempted.join('; ')}`, 'operationRefused'))}\n`);
        return 2;
      }
      const schema = JSON.parse(readFileSync(subject.path, 'utf8'));
      const resources = Array.isArray(subject.resources) ? subject.resources.map(path => JSON.parse(readFileSync(path, 'utf8'))) : [];
      const provider = createJsonSchemaProvider({ Ajv2020, version: '8.17.1', path });
      const sample = readJsonSample({ path: subject.sample });
      if (sample.status !== 'ok') {
        writeStdout(`${JSON.stringify(refusal(query, `the sample is not JSON: ${sample.reason}`))}\n`);
        return 2;
      }
      const verdict = provider.validate({ schema, resources, instance: sample.value });
      const facts = [{
        id: `validation:${sample.sha256}`,
        kind: 'validation',
        classification: 'checked',
        value: {
          verdict: verdict.status === 'validated' ? verdict.verdict : null,
          errors: verdict.errors ?? [],
          sample,
          schemaPath: subject.path,
          provider: verdict.provider ?? provider.provider,
        },
        evidence: [{ kind: 'document', path: subject.sample, sha256: sample.sha256, pointer: '' }],
        limits: verdict.status === 'validated' ? [] : [{ projection: 'validation', code: verdict.reason, detail: verdict.detail }],
      }];
      writeStdout(`${JSON.stringify({
        version: 1,
        provider: 'data-model',
        query,
        operation,
        requiredEffects,
        subject: { kind: 'schema', path: subject.path },
        snapshot: { snapshotId: sample.sha256, engine: 'data-model', provider: { name: 'ajv', version: '8.17.1', path } },
        facts,
        relations: [],
        refs: [],
        limits: verdict.status === 'validated' ? [] : [{ projection: 'validation', code: verdict.reason, detail: verdict.detail }],
        coverage: { examined: [subject.path, subject.sample], excluded: [], providerCompletion: true, unsupported: [] },
        applicability: 'current',
        changedInputs: [],
      })}\n`);
      return 0;
    }

    if (operation === 'modelLoad') {
      if (typeof subject.module !== 'string' || typeof subject.sample !== 'string') {
        writeStdout(`${JSON.stringify(refusal(query, 'the model subject needs module and sample paths'))}\n`);
        return 2;
      }
      const outputDirectory = frame.inputs?.outputDirectory ?? join(dirname(subject.module), '.baton-context-artifacts');
      const result = await runZodModelChild({
        node,
        childPath,
        target: { module: subject.module, export: subject.export ?? null, sample: subject.sample },
        effects,
        home: frame.inputs?.home,
        tempDirectory: frame.inputs?.tempDirectory,
        outputDirectory,
      });
      if (result.status !== 'ok') {
        const condition = result.refusal?.detail ?? result.detail ?? result.reason;
        writeStdout(`${JSON.stringify({ ...refusal(query, condition, 'operationRefused'), child: result.child ?? null })}\n`);
        writeStderr(`${JSON.stringify(result.private ?? {})}\n`);
        return 2;
      }
      const document = result.document;
      const facts = [
        {
          id: `model:${document.target.module.sha256}:${document.target.export.name ?? 'default'}`,
          kind: 'model',
          classification: 'observed',
          value: { provider: document.provider, module: document.target.module, export: document.target.export, sample: document.sample },
          evidence: [{ kind: 'document', path: document.target.module.path, sha256: document.target.module.sha256, pointer: '' }],
          limits: document.limits,
        },
        {
          id: `validation:${document.sample.sha256}`,
          kind: 'validation',
          classification: 'observed',
          value: { verdict: document.validation.verdict, issues: document.validation.issues, schemas: document.schemas },
          evidence: [{ kind: 'document', path: document.sample.path, sha256: document.sample.sha256, pointer: '' }],
          limits: document.limits,
        },
        {
          id: `serialization:${document.sample.sha256}`,
          kind: 'serialization',
          classification: 'observed',
          value: document.serialization,
          evidence: [{ kind: 'document', path: document.sample.path, sha256: document.sample.sha256, pointer: '' }],
          limits: [],
        },
      ];
      writeStdout(`${JSON.stringify({
        version: 1,
        provider: 'data-model',
        query,
        operation,
        requiredEffects,
        subject: { kind: 'model', module: document.target.module.path, export: document.target.export.name },
        snapshot: { snapshotId: document.target.module.sha256, engine: 'data-model', provider: document.provider, module: document.target.module, sample: document.sample, artifacts: { stdout: document.targetOutput.stdout, stderr: document.targetOutput.stderr }, child: result.child },
        facts,
        relations: [],
        refs: [],
        limits: document.limits,
        coverage: { examined: [document.target.module.path, document.sample.path], excluded: [], providerCompletion: true, unsupported: [], boundary: document.targetOutput.boundary },
        applicability: document.applicability,
        changedInputs: [],
      })}\n`);
      return 0;
    }

    // sourceAnalysis: join resolver records against an already observed model.
    const records = Array.isArray(frame.inputs?.records) ? frame.inputs.records : [];
    const observed = frame.inputs?.model ?? null;
    if (observed === null) {
      writeStdout(`${JSON.stringify(refusal(query, 'the model-use join needs the observed model identity from a modelLoad result', 'operationRefused'))}\n`);
      return 2;
    }
    const joined = joinModelUses({ model: observed, uses: records });
    writeStdout(`${JSON.stringify({
      version: 1,
      provider: 'data-model',
      query,
      operation,
      requiredEffects,
      subject: { kind: 'model', module: observed.module?.path ?? observed.module?.realPath ?? null, export: observed.export?.name ?? null },
      snapshot: { snapshotId: observed.snapshotId ?? null, engine: 'data-model', model: observed },
      facts: [],
      relations: joined.relations,
      refs: joined.refs,
      limits: joined.limits,
      coverage: { examined: records.map(record => record.value?.record?.useSite?.path).filter(Boolean), excluded: [], providerCompletion: true, unsupported: [] },
      applicability: 'current',
      changedInputs: [],
    })}\n`);
    return 0;
  } catch (error) {
    writeStderr(`${String(error?.stack ?? error)}\n`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
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

export { resolveJsonPointer };
