# Face9 shared solve cache

This opt-in candidate shares encoded output from the Node `solveFace9` miss path. It leaves the browser fallback, public `face9Key`, local bake files, solver arguments, metadata, and encoded payload unchanged. The `spec.t9` path continues to call `solveFaceT9` directly.

Set `ACP_FACE9_SHARED_CACHE=1`, `ACP_SOFT_CACHE_DIR` to an absolute private cache directory, and `ACP_FACE9_QUALIFICATION_FILE` to a qualification record before the adapter can read or write shared entries. The adapter bypasses shared storage unless the record matches its adapter hash, the complete `videos/web/lib` source digest, all four `videos/web/assets/face` readset files, and Node/V8/platform/architecture identity. Missing adapter imports and unsupported inputs fall back to the original solver. The cache key includes every value and byte in `V`, `deps`, and solve options. It accepts only the source-bound `F.has`, `F.target`, and `globes` functions, records their source-text hashes, and rejects other functions and unsupported object shapes.

The shared entry stores the solver's encoded bytes and metadata. The normal callsite still writes the result to its existing face bake path and decodes it through `parseFace9` before applying it.

## Evidence and limits

`videos/web/lib/fx/face/face9.js` builds the classic Face9 bake through `buildFace9`, which calls `bake9.solveFace9` on a Node miss. The current main source also has an opt-in T9 solve path; this candidate does not change or cache that path.

The source comment describes a first solve as taking 6–15 minutes. That is an estimate, not a measured duration. Existing source evidence does not establish repeated full solver inputs across production jobs or a cache hit. Do not enable a qualification record until an exact pinned-source CPU qualification verifies the complete solver input identity and encoded bytes.

## CPU tests

From `videos/web`, run:

```sh
node --test test/face9_shared_cache.test.mjs
```

The test uses small synthetic inputs and two Node processes. It imports the candidate's production `face9.js` and calls its actual `parseFace9` decoder. It does not build a person, call either face solver, or run browser, canvas, WebGL, or GPU work.

## Qualification plan

Use an approved CPU-only fixture built from the exact installed source closure. Record the current main commit, complete `videos/web/lib` digest, the four face asset hashes, adapter digest, runtime identity, and full `V`, `deps`, and option digest for the normal classic Face9 callsite. Confirm a repeated exact input exists before expecting reuse. Compare the original solver result and shared-cache hit as encoded `.bin` bytes, metadata, and `parseFace9` displacement and optional eye arrays. Generate the qualification record only after those exact checks pass. Keep the environment variables unset and the qualification file absent by default. Record actual solver time separately; the source comment is not timing evidence.
