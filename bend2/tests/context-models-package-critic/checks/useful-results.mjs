// Cold-package useful results for the JSON Schema provider surface.
//
// Runs under the exact Node 22.15.0 toolchain in a constructed cold
// environment (private HOME/TMPDIR with explicit private modes, C locale, no
// npm or harness variables) and drives the actual staged models module
// exports (createJsonSchemaProvider -> admit/validate/validateSchema) with
// Ajv injected from the staged dependency closure, anchored at the staged
// module file.
//
// Required actual engine behavior, asserted structurally on the provider's
// own result fields (not on output text):
//   valid sample    -> validate -> {status:'validated', verdict:true, errors:[]}
//   invalid sample  -> validate -> {status:'validated', verdict:false} with an
//                      error naming keyword 'type' at instancePath '/a'
//   unknown format  -> admit    -> {status:'refused', reason:'unknownFormat'}
//   remote $ref     -> admit    -> {status:'refused', reason:'referenceOutsideResources'}
//   metaschema      -> validateSchema -> {status:'checked', verdict, errors}
// An unexpected throw (including TypeError) fails the harness; only the
// provider's own refusal results count as intended refusals.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const stagedDir = process.env.PCM_STAGED_DIR;
const work = process.env.PCM_WORK;
const nodePath = process.env.PCM_NODE22;

const contextRoot = stagedDir && join(stagedDir, 'libexec/baton2/context');
const modelsEntry = contextRoot && join(contextRoot, 'models', 'index.mjs');
const stagedAjv = contextRoot && join(contextRoot, 'node_modules', 'ajv');
if (!stagedDir || !existsSync(modelsEntry)) {
  process.stdout.write(JSON.stringify({ check: 'useful-results', status: 'gate-open', details: { reason: 'no staged models payload yet', searched: modelsEntry ?? null } }) + '\n');
  process.exit(6);
}
if (!existsSync(join(stagedAjv, 'package.json'))) {
  process.stdout.write(JSON.stringify({ check: 'useful-results', status: 'gate-open', details: { reason: 'staged closure has no bundled ajv; staging is incomplete', stagedAjv } }) + '\n');
  process.exit(6);
}

const { capture, coldEnv, uniqueWorkDir, writePrivate } = await import('../lib/check-util.mjs');

const workRoot = uniqueWorkDir(work);

const harness = `
import { createRequire } from 'node:module';
const require2 = createRequire(${JSON.stringify(modelsEntry)});
const ajvEntry = require2.resolve('ajv/dist/2020.js');
const AjvModule = require2(ajvEntry);
const Ajv2020 = AjvModule.default ?? AjvModule;
const models = await import(${JSON.stringify(pathToFileURL(modelsEntry).href)});
const provider = models.createJsonSchemaProvider({
  Ajv2020,
  version: require2('ajv/package.json').version,
  path: ajvEntry,
});
const out = { ajvEntry, arms: {} };

const integerSchema = { type: 'object', required: ['a'], properties: { a: { type: 'integer' } } };

try {
  out.arms.validSample = provider.validate({ schema: integerSchema, resources: [], instance: { a: 3 } });
} catch (error) {
  out.arms.validSample = { unexpectedThrow: String(error.name) + ': ' + String(error.message) };
}
try {
  out.arms.invalidSample = provider.validate({ schema: integerSchema, resources: [], instance: { a: 'x' } });
} catch (error) {
  out.arms.invalidSample = { unexpectedThrow: String(error.name) + ': ' + String(error.message) };
}
try {
  out.arms.unknownFormat = provider.admit({ schema: { type: 'string', format: 'email' }, resources: [] });
} catch (error) {
  out.arms.unknownFormat = { unexpectedThrow: String(error.name) + ': ' + String(error.message) };
}
try {
  out.arms.remoteRef = provider.admit({ schema: { type: 'object', properties: { b: { $ref: 'https://example.com/other.schema.json' } } }, resources: [] });
} catch (error) {
  out.arms.remoteRef = { unexpectedThrow: String(error.name) + ': ' + String(error.message) };
}
try {
  out.arms.metaschemaValid = provider.validateSchema({ schema: integerSchema });
  out.arms.metaschemaInvalid = provider.validateSchema({ schema: { type: 'strng' } });
} catch (error) {
  out.arms.metaschemaInvalid = { unexpectedThrow: String(error.name) + ': ' + String(error.message) };
}
process.stdout.write(JSON.stringify(out));
`;

const harnessPath = writePrivate(join(workRoot, 'useful-harness.mjs'), harness);

const env = coldEnv(workRoot, nodePath);
const result = await capture([nodePath, harnessPath], { cwd: workRoot, env });

const details = { argv: result.argv, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
let parsed = null;
try { parsed = JSON.parse(result.stdout.utf8.trim().split('\n').pop() ?? ''); } catch { /* retained above */ }
details.arms = parsed?.arms ?? null;

const refusals = [];
if (result.status !== 0 || !parsed) {
  refusals.push('cold harness did not complete; complete stdout/stderr retained');
} else {
  const arms = parsed.arms ?? {};
  if (!arms.validSample || arms.validSample.unexpectedThrow) refusals.push('valid sample: harness threw instead of returning a verdict: ' + String(arms.validSample?.unexpectedThrow));
  else if (arms.validSample.status !== 'validated' || arms.validSample.verdict !== true || JSON.stringify(arms.validSample.errors) !== '[]') refusals.push('valid sample did not return {validated, verdict true, errors []}: ' + JSON.stringify(arms.validSample).slice(0, 400));

  if (!arms.invalidSample || arms.invalidSample.unexpectedThrow) refusals.push('invalid sample: harness threw instead of returning a verdict: ' + String(arms.invalidSample?.unexpectedThrow));
  else {
    const first = (arms.invalidSample.errors ?? [])[0];
    if (arms.invalidSample.status !== 'validated' || arms.invalidSample.verdict !== false) refusals.push('invalid sample did not return {validated, verdict false}');
    else if (!first || first.keyword !== 'type' || first.instancePath !== '/a') refusals.push('invalid sample first error must name keyword type at instancePath /a: ' + JSON.stringify(first));
  }

  if (!arms.unknownFormat || arms.unknownFormat.unexpectedThrow) refusals.push('unknown format: harness threw instead of a provider refusal: ' + String(arms.unknownFormat?.unexpectedThrow));
  else if (arms.unknownFormat.status !== 'refused' || arms.unknownFormat.reason !== 'unknownFormat') refusals.push('unknown format must refuse with reason unknownFormat: ' + JSON.stringify(arms.unknownFormat).slice(0, 300));

  if (!arms.remoteRef || arms.remoteRef.unexpectedThrow) refusals.push('remote ref: harness threw instead of a provider refusal: ' + String(arms.remoteRef?.unexpectedThrow));
  else if (arms.remoteRef.status !== 'refused' || arms.remoteRef.reason !== 'referenceOutsideResources') refusals.push('remote $ref must refuse with reason referenceOutsideResources: ' + JSON.stringify(arms.remoteRef).slice(0, 300));

  if (arms.metaschemaValid?.unexpectedThrow || arms.metaschemaInvalid?.unexpectedThrow) refusals.push('metaschema check threw: ' + String(arms.metaschemaInvalid?.unexpectedThrow ?? arms.metaschemaValid?.unexpectedThrow));
  else {
    if (arms.metaschemaValid?.status !== 'checked' || arms.metaschemaValid?.verdict !== true) refusals.push('metaschema check of a valid schema must return {checked, verdict true}');
    if (arms.metaschemaInvalid?.status !== 'checked' || arms.metaschemaInvalid?.verdict !== false || !(arms.metaschemaInvalid?.errors ?? []).length) refusals.push('metaschema check of an invalid schema must return {checked, verdict false, errors nonempty}');
  }
  if (!String(parsed.ajvEntry ?? '').includes('/node_modules/ajv/')) refusals.push(`injected Ajv resolved from ${parsed.ajvEntry}, outside the staged closure naming`);
}

details.refusals = refusals;
if (refusals.length > 0) {
  process.stdout.write(JSON.stringify({ check: 'useful-results', status: 'fail', details }) + '\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify({ check: 'useful-results', status: 'pass', details }) + '\n');
process.exit(0);
