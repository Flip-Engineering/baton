// ESM loader hook recording every module resolved after registration.
export async function resolve(specifier, context, nextResolve) {
  const resolution = await nextResolve(specifier, context);
  const { recordModule } = await import('./closure-store.mjs');
  recordModule(resolution.url);
  return resolution;
}
