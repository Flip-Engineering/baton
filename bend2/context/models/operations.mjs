// Selected operation, required target-effect set and admitted subject mapping
// for each exported callable.
//
// Operation names and the canonical required-effect construction belong to the
// native core, the codec and the managed lifecycle. The names here are the
// core's closed set: schemaValidation, modelLoad, sourceAnalysis. This table
// reports only what each callable does and which admitted subject and target
// input selects it.

export const MODEL_OPERATIONS = Object.freeze([
  {
    callable: 'createJsonSchemaProvider',
    operation: 'schemaValidation',
    requiredEffects: [],
    subject: { kind: 'schema', path: '<schema path>', sample: '<sample path>', optional: ['resources'] },
    targetInputs: ['schema', 'resources', 'sample'],
    detail: 'bundled Ajv computation over the admitted documents; no target module is imported and no target statement runs',
  },
  {
    callable: 'runZodModelChild',
    operation: 'modelLoad',
    requiredEffects: ['executeTarget'],
    subject: { kind: 'model', module: '<module path>', export: '<export name>', sample: '<sample path>', optional: ['code'] },
    targetInputs: ['module', 'export', 'sample', 'outputDirectory'],
    detail: 'starts the controlled child that imports the selected module export, evaluates it against the sample and converts its schemas',
  },
  {
    callable: 'zodChildMain',
    operation: 'modelLoad',
    requiredEffects: ['executeTarget'],
    subject: { kind: 'model', module: '<module path>', export: '<export name>', sample: '<sample path>' },
    targetInputs: ['module', 'export', 'sample'],
    detail: 'the child side of the same operation; the parent checks the grant before it starts this process',
  },
  {
    callable: 'joinModelUses',
    operation: 'sourceAnalysis',
    requiredEffects: [],
    subject: { kind: 'model', module: '<module path>', export: '<export name>', optional: ['code'] },
    targetInputs: ['resolverModuleUseRecords', 'observedModelIdentity'],
    detail: 'compares resolver records with an already observed model identity; importing or evaluating the target model is a separate modelLoad operation',
  },
]);

// A sample path is an input of the selected schemaValidation, modelLoad or
// datasetRead operation. Reading it is not an operation of its own, and
// `readJsonSample` carries no entry here.
export const MODEL_UNSUPPORTED_OPERATIONS = Object.freeze(['sqlPlan', 'catalogCapture', 'migrationReplay']);
