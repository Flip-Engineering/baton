/**
 * Dynamic-import fixture: await import() edges are not covered by findReferences
 * and must be named as an explicit gap, not silently omitted.
 * Rule exception: this fixture intentionally exercises the module-loading boundary;
 * a static import here would remove the semantics under test (bindings-critic A3).
 */

export async function loadGreeterDynamically(): Promise<string> {
  const mod = await import("./alias-chain");
  return mod.makeMessage(new mod.FormalGreeter());
}
