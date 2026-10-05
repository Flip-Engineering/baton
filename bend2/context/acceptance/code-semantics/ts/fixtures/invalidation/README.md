/**
 * Cross-file invalidation fixture inputs. The program imports "./lib"; the
 * invalidation oracle supplies lib-a/lib.ts (snapshot A) or lib-b/lib.ts
 * (snapshot B) as the module body for ./lib and asserts the reported type and
 * snapshot identity change together.
 */
