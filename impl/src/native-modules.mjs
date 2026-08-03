// Lazy-native indirection (codex #6, mcp-packaging-decisions v1.0 PKG-2): index.mjs never eagerly
// imports the Atlas stack by name, so the stdio/bin paths don't either. This module is the ONE
// indirection that binds the Atlas classes into index.mjs. `@ast-grep/napi` is an
// optionalDependency: a clean host without the native toolchain installs honestly and degrades to
// `atlas: unavailable` through the registry's existing availability posture, never a failed install.
export { AtlasRepresentationProducer } from './atlas-representation-producer.mjs';
export { AtlasCodeIndex } from './atlas-index.mjs';
export { AtlasStructuralDelta } from './atlas-structural.mjs';
export { AtlasStructuralEvidence } from './atlas-structural-evidence.mjs';
export { CartographerQuartermaster } from './cartographer-quartermaster.mjs';
