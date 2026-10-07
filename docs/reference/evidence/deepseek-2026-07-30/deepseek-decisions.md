# W1 contract — DeepSeek fleet route family (v1)

Ground truth: operator directive (2026-07-30) + the DeepSeek Claude Code integration doc
(fetched 2026-07-30): the DeepSeek API is Anthropic-compatible at
`https://api.deepseek.com/anthropic`, driven by `ANTHROPIC_AUTH_TOKEN`, with models
`deepseek-v4-pro[1m]` (their claude-opus/sonnet mapping) and `deepseek-v4-flash` (haiku).
This is exactly the GLM shape: the claude-family session class pointed at another
Anthropic-compatible endpoint with a token from a repo-local key file.

## Rules

1. **Route family, mirroring glmRoutes.** `deepseekRoutes()` beside `glmRoutes()`
   (application-deployment.mjs:72-75): harness `'deepseek'`, with `deepseek-v4-flash` as the
   DEFAULT model on the full effort ladder `['low','medium','high','xhigh','max']` — per the
   operator (2026-07-30/31): the 0731 flash variant is currently the most performant model in
   the series and the `deepseek-v4-pro[1m]` label is misleading because its corresponding
   update has not been made public yet. `deepseek-v4-pro[1m]` is registered as an explicit
   opt-in route only (low/medium efforts, flagged pre-update). Both appear in DEFAULT_ROUTES.
2. **Credential projection, mirroring GLM (:703-706) — model-independent.** When `deepseek_key.json` exists at
   the repo root, the deployment projects `{ authTokenFile: <abs path>, authTokenJsonPointer:
   '/deepseek_key', baseUrl: 'https://api.deepseek.com/anthropic', harness: 'deepseek' }`
   into the worker runtime for deepseek routes only — the token file is read by the
   deployment, never by workers, and never enters worker-visible config. The file is
   gitignored (add to .gitignore beside glm_key.json if absent) and mode 600.
3. **Model mapping honesty.** DeepSeek maps claude-opus→deepseek-v4-pro and
   claude-haiku/sonnet→deepseek-v4-flash server-side; baton route names use the deepseek
   model ids directly (no remapping inside baton). The session class carries the model id
   through exactly as the GLM family does (GlmSessionCli extends ClaudeSessionCli and the
   DeepSeek family takes the same subclass shape — DeepseekSessionCli if a distinct name is
   warranted, else the shared path).
4. **No live key required for the tests.** The route family and projection are validated
   without a credential: a missing deepseek_key.json yields an honest not-ready state in
   doctor (route present, summary names the missing file), never an auth-shaped crash.

## Red-first tests — `impl/test/deepseek-routes-red.test.mjs`

1. **DS-1:** DEFAULT_ROUTES contains the deepseek family with deepseek-v4-flash as the
   default on the full effort ladder, and deepseek-v4-pro[1m] at low/medium only (explicit
   opt-in, flagged pre-update).
2. **DS-2:** with a fixture deepseek_key.json (`{"deepseek_key":"fixture"}`), the projection
   for a deepseek route carries the abs authTokenFile, the `/deepseek_key` pointer, and the
   api.deepseek.com/anthropic base URL; a glm route's projection is untouched.
3. **DS-3:** without the key file, doctor reports the deepseek route not-ready with the
   missing-file reason named; no throw.
4. **DS-4:** the key file is in .gitignore (source scan).

## Verification

```text
node --test impl/test/deepseek-routes-red.test.mjs
```

then the canonical suite fully green. The live probe (W1.4) is a separate operator-gated
step requiring the real API key.
