// data-model provider surface: JSON Schema validation, Zod model execution,
// JSON samples and the model-use join.
//
// Engines arrive by injection so the staged adapter owns the package imports
// and the domain tests exercise the real packages from their resolved paths.

export { DRAFT_2020_12, createJsonSchemaProvider } from './json-schema.mjs';

export {
  childPointer,
  jsonTypeOf,
  readJsonSample,
  resolveJsonPointer,
  sha256Hex,
} from './sample.mjs';

export {
  ADMITTED_ZOD_VERSION,
  EXECUTE_TARGET_GRANT,
  zodChildMain,
} from './zod-child.mjs';

export {
  runZodModelChild,
  zodChildEnvironment,
  zodProviderIdentity,
} from './zod-model.mjs';

export { joinModelUses } from './model-use-join.mjs';

export { MODEL_OPERATIONS } from './operations.mjs';
