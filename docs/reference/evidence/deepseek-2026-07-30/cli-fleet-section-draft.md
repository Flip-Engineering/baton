# DeepSeek fleet route section (draft)

The deepseek harness routes through the Anthropic-compatible endpoint
`https://api.deepseek.com/anthropic`, the same GLM shape: a claude-family session
class pointed at a DeepSeek endpoint with a token read from a repo-local key file.

## Routes

- **`deepseek-v4-flash`** — the primary model, registered as the default across the
  full effort ladder `['low','medium','high','xhigh','max']`. Per the operator
  (2026-07-30/31) the 0731 flash variant is currently the most performant model in
  the series.
- **`deepseek-v4-pro[1m]`** — an explicit pre-update opt-in at **low/medium only**.
  The label is misleading because its corresponding update has not been made public
  yet, so it stays visibly flagged `pre-update` and is never a default.

## Credential projection

When `deepseek_key.json` exists at the repo root, the deployment projects, for
deepseek routes only:

```
{ authTokenFile: <abs path>, authTokenJsonPointer: '/deepseek_key',
  baseUrl: 'https://api.deepseek.com/anthropic', harness: 'deepseek' }
```

The token file is read by the deployment, never by workers, and never enters
worker-visible config. The file is **mode 600** and **gitignored** (added to
`.gitignore` beside `glm_key.json`). Model mapping is honest: DeepSeek remaps
claude-opus→v4-pro and claude-haiku/sonnet→v4-flash server-side; baton route names
use the DeepSeek model ids directly.

## Readiness

No live key is required for the family to be valid. With `deepseek_key.json`
absent, doctor keeps all 7 configured deepseek routes but reports each as
**`blocked`** with a summary naming the missing credential file — an honest
`blocked`/`authentication_required` state, never an auth-shaped construction error.

## Pinning suite

`impl/test/deepseek-routes-red.test.mjs`, rows **DS-1..DS-4**:

- **DS-1** flash default on the full ladder + pro[1m] low/medium pre-update opt-in
- **DS-2** projection carries abs key path, `/deepseek_key` pointer, and the
  api.deepseek.com/anthropic base URL; GLM untouched
- **DS-3** missing key → honest blocked doctor result naming the file, no throw
- **DS-4** `deepseek_key.json` is gitignored beside `glm_key.json`

Verify with `node --test impl/test/deepseek-routes-red.test.mjs`. The live probe
(W1.4) is a separate operator-gated step requiring the real API key.
