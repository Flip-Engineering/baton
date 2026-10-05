// JSON Schema provider discriminators over the real Ajv 8.17.1 2020 entry.
//
// Pins: fixed strict/allErrors/validateFormats, local resource closure,
// unknown-format refusal before validation, no mutation/coercion/defaults,
// actual verdict/pointers/params in errors.

import { createRequire } from 'node:module';

import { check } from '../lib/harness.mjs';

const require = createRequire(import.meta.url);
const AJV_PATH = '/Users/wahargis/.claude/plugins/marketplaces/thedotmack/node_modules/ajv';
const { version: AJV_VERSION } = require(join(AJV_PATH, 'package.json'));

function join(a, b) {
  return `${a}/${b}`;
}

function provider(producer) {
  const Ajv2020 = require(join(AJV_PATH, 'dist/2020.js'));
  return producer.modules.models.jsonSchema.createJsonSchemaProvider({ Ajv2020, version: AJV_VERSION, path: AJV_PATH });
}

const SCHEMA = {
  $id: 'https://critic.local/user.json',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    age: { type: 'integer', minimum: 0 },
  },
};

check({
  id: 'ajv/useful-validation-errors',
  requirement: 'useful supported result: actual verdict with real instancePath/schemaPath/keyword/rule params; allErrors collects every violation',
  async run({ producer }) {
    const api = provider(producer).validate({ schema: SCHEMA, instance: { name: '', age: -2, extra: true } });
    if (api.status !== 'validated') throw new Error(JSON.stringify(api));
    if (api.verdict !== false) throw new Error('invalid instance validated');
    const paths = api.errors.map(entry => entry.instancePath);
    if (!paths.includes('/name') || !paths.includes('/age') || !paths.includes('/extra')) throw new Error(`error paths observed ${JSON.stringify(paths)}`);
    const minLength = api.errors.find(entry => entry.keyword === 'minLength');
    if (minLength?.params?.limit !== 1) throw new Error(`minLength params observed ${JSON.stringify(minLength?.params)}`);
    return { errorCount: api.errors.length, keywords: api.errors.map(entry => entry.keyword) };
  },
});

check({
  id: 'ajv/unknown-format-refuses-admission',
  requirement: 'no custom formats are registered and an unknown format rejects schema admission: the common "email" format refuses because the deployment registers no format package (spec: strict fixed options; unknown format rejects schema admission)',
  async run({ producer }) {
    const api = provider(producer);
    const withFormat = { ...SCHEMA, properties: { ...SCHEMA.properties, email: { type: 'string', format: 'email' } } };
    const refused = api.admit({ schema: withFormat });
    if (refused.status !== 'refused') throw new Error(`unknown format admitted: ${JSON.stringify(refused)}`);
    if (refused.reason !== 'unknownFormat') throw new Error(`refusal reason observed ${refused.reason}`);
    if (!String(refused.detail).includes('email')) throw new Error('refusal does not name the refused format');
    return { reason: refused.reason, format: 'email' };
  },
});

check({
  id: 'ajv/strict-mode-refuses-unknown-keyword',
  requirement: 'strict:true refuses an unknown keyword instead of silently ignoring it',
  async run({ producer }) {
    const strictSchema = { ...SCHEMA, proprieties: { type: 'string' } };
    const refused = provider(producer).admit({ schema: strictSchema });
    if (refused.status !== 'refused') throw new Error(`unknown keyword admitted: ${JSON.stringify(refused)}`);
    return { reason: refused.reason ?? 'schemaRefused', detail: String(refused.detail ?? '').slice(0, 160) };
  },
});

check({
  id: 'ajv/remote-ref-refused-local-closure-works',
  requirement: 'references resolve only inside the explicit local resources set; a remote $ref refuses before any loader runs',
  async run({ producer }) {
    const api = provider(producer);
    const remote = { ...SCHEMA, $ref: 'https://example.com/remote.json' };
    const refused = api.admit({ schema: remote });
    if (refused.status !== 'refused' || refused.reason !== 'referenceOutsideResources') throw new Error(`remote ref observed ${JSON.stringify(refused)}`);
    const address = {
      $id: 'https://critic.local/address.json',
      type: 'object',
      required: ['city'],
      properties: { city: { type: 'string' } },
    };
    const withLocal = {
      $id: 'https://critic.local/person.json',
      type: 'object',
      required: ['address'],
      properties: { address: { $ref: 'https://critic.local/address.json' } },
    };
    const admitted = api.validate({ schema: withLocal, resources: [address], instance: { address: { city: 3 } } });
    if (admitted.status !== 'validated' || admitted.verdict !== false) throw new Error(`local closure validation observed ${JSON.stringify(admitted)}`);
    const cityError = admitted.errors.find(entry => entry.instancePath === '/address/city');
    if (cityError === undefined) throw new Error(`cross-resource error paths observed ${JSON.stringify(admitted.errors)}`);
    return { remoteReason: refused.reason, crossResourceError: cityError.instancePath };
  },
});

check({
  id: 'ajv/no-mutation-coercion-defaults',
  requirement: 'validation performs no coercion, default insertion or additional-property removal: the instance is byte-identical after the verdict (spec: mutation, coercion and default insertion disabled)',
  async run({ producer }) {
    const withDefaults = {
      ...SCHEMA,
      properties: { ...SCHEMA.properties, name: { type: 'string', default: 'anonymous' }, age: { type: 'integer', default: 0 } },
    };
    const instance = { name: 42, age: '5' };
    const frozen = structuredClone(instance);
    const api = provider(producer).validate({ schema: withDefaults, instance });
    if (api.verdict !== false) throw new Error(`coercible instance validated: ${JSON.stringify(api)}`);
    if (JSON.stringify(instance) !== JSON.stringify(frozen)) throw new Error(`instance mutated: ${JSON.stringify(instance)}`);
    if (instance.name !== 42 || instance.age !== '5') throw new Error('coercion applied');
    return { verdict: api.verdict, instanceUnchanged: true };
  },
});

check({
  id: 'ajv/metaschema-check',
  requirement: 'validateSchema checks the document against the 2020-12 metaschema and returns real errors for a malformed schema',
  async run({ producer }) {
    const checked = provider(producer).validateSchema({ schema: { type: 123 } });
    if (checked.status !== 'checked' || checked.verdict !== false) throw new Error(`metaschema check observed ${JSON.stringify(checked)}`);
    if (checked.errors.length === 0) throw new Error('no metaschema errors for type:123');
    return { errors: checked.errors.map(entry => entry.instancePath ?? entry.schemaPath) };
  },
});
