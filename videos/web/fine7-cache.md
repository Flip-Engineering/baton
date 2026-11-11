# Fine7 numeric cache

The browser renderer can optionally share complete Fine7 bake results between workers that render the same source and inputs. The cache intercepts `bakeFine()` only through the asynchronous `applyFine7()` entry point. `applyFine7Sync()` continues to call the original bake. A cache hit still creates each worker's own textures, hooks, uniforms, and disposal state.

The record key covers the captured positions or complete body source, chart and mapped chart, landmarks, person information, mouth lines, normalized options, prepared navel result, source manifest, dependencies, runtime identity, and cache namespace. Typed arrays contribute their class and raw bytes. Inputs are recaptured after network waits and immediately before synchronous construction. A mismatch, timeout, invalid record, store failure, or unqualified policy uses the original computation.

The complete bake record preserves typed-array classes and bytes, optional-array null values, report fields, and object property order. A cache hit retains the producer's `report.ms` timing values. Consumers must read those values as producer timings, not current-worker elapsed time.

The renderer reads a policy from `ACP_FINE_CACHE_POLICY`; no policy file is included, so this change leaves caching disabled by default. The policy must be externally qualified and bind the source closure, runtime, dependency set, namespace, and explicit input/result/wait/request/lease budgets. `fine-cache-source-manifest.json` marks the production dependency closure incomplete. Do not set `qualified: true` from this partial manifest alone.

The shared cache server is opt-in with `ACP_MOT4_SINGLEFLIGHT=1`. It requires positive `ACP_MOT4_SINGLEFLIGHT_MAX_BYTES`, `ACP_MOT4_SINGLEFLIGHT_MAX_STORE_BYTES`, and `ACP_MOT4_SINGLEFLIGHT_MAX_LEASE_MS` limits. The lease must exceed a measured cold bake duration because `bakeFine()` is synchronous and does not renew its lease. The server rejects a stale owner's publication.

Source call-site counts give a possible upper bound, not a speedup measurement. If six workers in One Shot B produce the same six exact Fine7 inputs, their 36 bake calls could fall to 6. If six workers in One Shot C produce the same eight inputs, 48 calls could fall to 8. That would remove up to 70 of 84 calls. Actual input equality, bake cost, record sizes, memory, storage use, and whole-job time still require normal-worker qualification.

Run the CPU-only checks with:

```sh
node --test test/fine-cache-client.test.mjs test/fine-cache-http.test.mjs test/cache-server-singleflight.test.mjs
```

The cache server route tests require Linux `flock`; they are skipped on platforms without it. All Fine7 test producers use synthetic arrays. The tests do not run `bakeFine()`, geometry solves, person construction, browser code, or rendering.
