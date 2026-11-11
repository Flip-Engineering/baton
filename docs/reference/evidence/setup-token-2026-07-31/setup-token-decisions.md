# Issue #11 contract — durable headless credential projection (v3)

(v3 folds the opus verification red-team (`redteam-v2.md`, verdict **UNSOUND**, R11V-1..9).
The two P0s: v2 asserted access-token-only projection but NO rule or test removed the
full-file registration at `application-deployment.mjs:598` — the refresh token still shipped
into every worker (R11V-1); and CC-2's fixture encoded the env-token expiry wire shape it
was meant to verify — green-but-broken at first real mid-turn expiry (R11V-2). Also folded:
single-flight scoped to the credential, not the deployment (R11V-3); the remedy lands in a
per-vendor summary function, not a shared string at a wrong line (R11V-4); harvest
monotonicity + schema gate (R11V-5); the revocation latch (R11V-6); canary role corrected to
egress (R11V-7); spawn-time TTL gate (R11V-8); citation repoints (R11V-9). Fold-verdict:
R11R-1..12 stand folded except as amended here. v2/v1 retained below as the fold trail.)

## Rules (v3 — amended; unamended v2 rules stand)

1. **(v2 rule 1 stands — the deployment credential cache is the single read source.)**
2. **Workers project access-token-only — ENFORCED, not asserted.** The claude `credentialFiles`
   full-file registration (`application-deployment.mjs:598`) is REMOVED; claude projects via
   `credentialEnv.claude = { CLAUDE_CODE_OAUTH_TOKEN: <cache.accessToken> }` and nothing else.
   The ingress guarantee (no refreshToken in any worker runtime) is carried SOLELY by this
   env-only projection + the deletion; the providerSecrets canary is a defense-in-depth
   EGRESS check on the access token (`claude-session.mjs:371,854-884` — it scans provider
   OUTPUT, it cannot keep anything out of a runtime, R11V-7). Setup-token stays the named
   fallback (v2's adjudication stands).
3. **Refresh is single-flight PER CREDENTIAL, vendor-executed, harvested with monotonicity
   and a schema gate.** The single flight serializes refresh triggers within one deployment
   AND detects cross-deployment/operator-session interference: an advisory lockfile next to
   the operator credentials store serializes refreshers process-wide, and a Keychain-mtime
   CAS check (re-read immediately before adopting a harvest; abort + re-read the freshest if
   it changed under the flight) covers the operator's own interactive CLI refreshing in
   parallel (R11V-3). Harvest candidates = {runtime projected file, Keychain re-extract,
   INCUMBENT cache credential}; each candidate is schema-gated (accessToken non-empty;
   expiresAt a safe positive ms-epoch integer within a sane bound — the kimi refusal
   discipline, `application-deployment.mjs:363-372`); the harvest is adopted ONLY if strictly
   fresher than the incumbent (`harvest.expiresAt > cache.expiresAt`, R11V-5). Persist-back
   to the operator store stays explicit-command-only (the consent ceremony stands). The
   first live refresh still records the observed write-back target (verification receipt).
4. **Retry-once with the established taxonomy + the revocation latch + a spawn-time TTL
   gate.** A worker turn failing `authentication_refresh_required` triggers single-flight
   refresh → re-projection → ONE retried turn. A refresh flight failing with
   `invalid_grant`/revocation LATCHES the cache to `expired_needs_login`: every further
   automatic trigger short-circuits to the blocked taxonomy WITHOUT spawning a runtime, until
   the explicit `baton credentials refresh claude` command clears the latch (R11V-6 — no 64
   doomed flights). At spawn, `cache.expiresAt <= now` (a free comparison, no `security`
   exec) triggers the flight BEFORE projecting — no spawn ever receives a known-dead token
   (R11V-8). The claude-specific relogin remedy lands in a NEW
   `claudeAuthenticationSummary(code)` mirroring `kimiAuthenticationSummary`/
   `grokAuthenticationSummary` (`application-deployment.mjs:316/:390`), wired at the claude
   terminal-result site (`claude-session.mjs:322`); `PROVIDER_TERMINAL_GUIDANCE`
   (`application-semantics.mjs:1634`) stays vendor-agnostic — the code is shared with
   kimi/grok, so the text must not be (R11V-4). **Marked unverified:** the env-token-only
   expiry wire shape (does the real CLI, holding only `CLAUDE_CODE_OAUTH_TOKEN` and no
   credentials file, terminate with `authentication_error` / `Not logged in · Please run
   /login` — the shapes `claudeResultFailureCode` matches, `claude-session.mjs:332-338`?).
   The first live env-token mid-turn expiry records the actual terminal `result` string in
   this evidence dir and the matcher is confirmed/extended against it BEFORE the retry-once
   path is trusted (R11V-2 — CC-2's fixture pins the assumed shapes and names this
   assumption in its header).
5. **(v2 rule 5 stands — three-state credential metadata, ms units, typed
   Keychain-only-vs-absent code, per-read cheap probe per the `workspaceProbe` pattern at
   `application-deployment.mjs:1204/:1538`; kimi seconds-precedent at `:353/:377`.)**
6. **(v2 rule 6 stands — Keychain deployment-side only.)**
7. **(v2 rule 7 stands — no cross-vendor overreach.)**

## Red-first tests (v3 amendments to CC-1..CC-5)

- **CC-2+:** the fixture claude executable suite gains: (a) a partial/short-TTL write-back
  is NOT adopted (monotonicity + schema gate, R11V-5); (b) a malformed write-back (truncated
  accessToken, garbage expiresAt) is discarded, never poisons the cache; (c) the fixture
  header NAMES the env-token wire-shape assumption pending the live receipt (R11V-2).
- **CC-4+ (the P0 pin):** `credentialFiles.claude` is undefined/empty after the change
  (positive assertion, not just a name scan), AND a projection-tree scan proves NO projected
  worker file contains the cache's refreshToken bytes; the env projection carries exactly
  `CLAUDE_CODE_OAUTH_TOKEN` (R11V-1). The canary's egress role is pinned by citation, never
  cited as ingress (R11V-7).
- **CC-5+:** after one revoked-refresh (`invalid_grant`) flight, a second worker failure
  spawns NO second refresh runtime (the latch) and surfaces the blocked taxonomy with the
  claude remedy from `claudeAuthenticationSummary`; the explicit command clears the latch;
  a spawn past `cache.expiresAt` triggers the flight BEFORE projection (R11V-6/R11V-8);
  `PROVIDER_TERMINAL_GUIDANCE` stays vendor-agnostic (source-scan, R11V-4); cross-deployment
  exclusion: a second deployment's flight blocks on the advisory lockfile, and a Keychain
  mtime change mid-flight aborts the adoption (R11V-3).

## Verification

```text
node --test impl/test/claude-credential-projection-red.test.mjs
```

then the canonical suite fully green. Post-landing dogfood receipts (this evidence dir):
the first live single-flight refresh (write-back target) AND the first live env-token
mid-turn expiry (the actual terminal result string vs the matcher).

---

# Issue #11 contract — durable headless credential projection (v2)

(v2 folds the R11 red-team, verdict SOUND-WITH-FOLDS, R11R-1..12 — report at the tail of this
file. The decisive corrections: v1 described a refresh path as if baton owned it — the VENDOR
CLI owns refresh mechanics (binary-verified: `grant_type=refresh_token`, rotation write-back,
`security add-generic-password -U`); v1's Rules 1×4 collided on who invokes Keychain; the
rotation race across N concurrent workers was unaddressed; CC-2 pinned a non-existent
"fixture refresh endpoint"; the new error code forked the established taxonomy; the
credential cache both rules implied was never named; the setup-token alternative was never
adjudicated. v2's center: a **deployment credential cache**, **access-token-only worker
projection**, **single-flight vendor-executed refresh with harvest-from-any-write-back-target**,
and **retry-once on the worker path** — a design sound under BOTH unpinned vendor write-back
behaviors, with the one live dogfood receipt demoted from design fork to verification step.)

## Ground truth

Issue #11 plus the campaign's credential-fragility receipts (all filed on #11 and #47):
claude OAuth TTL rotation ×3 and a 401 revocation mid-wave; grok's token dying 28 minutes
after an interactive login; kimi's thinking option absent from its ACP surface; codex's
monthly usage cap discovered at turn time; GLM's 529 era. Every failure was discovered AT
TURN TIME because projection is static and doctor is static-only. Vendor facts the red-team
established (binary + live credential metadata, no secret bytes read): the claude CLI itself
refreshes (`/v1/oauth/token`, `invalid_grant` ×33 in the binary); refresh responses carry a
NEW refreshToken (rotation); the real file shape is `claudeAiOauth.{accessToken,
refreshToken, expiresAt (ms epoch), refreshTokenExpiresAt, scopes, …}`; observed TTLs at
red-team time: access 4.4h, refresh 21.4d; the refresh-Keychain-then-re-extract workflow is
what actually happens today (Keychain item mdat matches the operator file mtime within ~2min).

## The question

Claude workers need credentials inside the private worker runtime, and today the path is a
static copy of `~/.claude/.credentials.json` whose OAuth access token has an hours-long TTL.
The durable projection must survive TTL expiry and vendor rotation without an operator
re-extract per cycle, WITHOUT baton reimplementing vendor OAuth internals, and without
widening the refresh token's exposure into N worker runtimes.

## Rules (v2)

1. **The deployment credential cache is the single read source.** The deployment reads the
   source credential ONCE at open — Keychain preferred (`security find-generic-password -s
   "Claude Code-credentials" -w`), operator file fallback — into a deployment-side cache.
   Every worker spawn projects FROM THE CACHE; spawn never execs `security` (up to 64 spawns
   per wave, R11R-7). Cache re-read happens at: open, the explicit refresh command (rule 3),
   and the single-flight worker-auth-failure path (rule 4) — never per doctor read (rule 5).
2. **Workers project access-token-only.** The refresh token NEVER enters a worker runtime.
   Projection rides the existing credentialEnv path (`CLAUDE_CODE_OAUTH_TOKEN`,
   `runtime-isolation.mjs:104-111`) guarded by the providerSecrets canary
   (`claude-session.mjs:371,854-884`) — a strictly smaller exposure than today's full-file
   copy (R11R-9's exposure-reducing alternative: accepted). The setup-token alternative
   (long-lived token via the same env path, `CLAUDE_CODE_OAUTH_TOKEN` ×61 in the binary) is
   adjudicated: NAMED FALLBACK, not v1 — it changes the credential kind (subscription vs
   setup-token policy and revocation surface) and needs its own operator ceremony; the
   access-token path needs none (R11R-11).
3. **Refresh is deployment-side, single-flight, vendor-executed, harvested.** The vendor CLI
   owns refresh mechanics; baton owns refresh ORCHESTRATION. One serialized refresh flight
   per deployment (concurrent triggers coalesce): spawn the vendor CLI in a throwaway runtime
   with the cache credential projected, let IT refresh, then HARVEST the freshest credential
   (max `expiresAt`) from every write-back target — the runtime's projected file AND a
   Keychain re-extract — sound whether the vendor writes back to the file under
   `CLAUDE_CONFIG_DIR` or to the Keychain (the R11R-1/R11R-8 fork, dissolved). The first live
   refresh records the observed write-back target as the dogfood receipt (a verification
   step, not a design fork). Persisting the harvested credential back to the operator's real
   store happens ONLY through an explicit `baton credentials refresh claude` command — the
   owner-consent ceremony (R11R-6); automatic paths update the deployment cache only.
4. **Retry-once on the worker path, with the established taxonomy.** A worker turn failing
   `authentication_refresh_required` (the EXISTING code — the v1 `claude_credential_relogin_required`
   fork is deleted, R11R-4; the claude-specific relogin remedy text lands at the single
   remediation string, `application-semantics.mjs:1621`) triggers: deployment single-flight
   refresh (rule 3) → fresh access token re-projected to that worker → the turn retried ONCE
   before the run fails. A refresh that itself fails (revoked/absent refreshToken) maps to the
   existing blocked taxonomy with the relogin remedy named. The rotation race (R11R-2) dies
   here: workers never refresh, so N workers never race the rotation; the single flight is the
   only refresher.
5. **Honest credential metadata in doctor.** Route reports carry `credential: {expiresAt,
   refreshTokenExpiresAt, state: fresh|stale|expired_needs_login}` with units stated as ms
   epoch (R11R-5; the kimi seconds-precedent at `application-deployment.mjs:352` is the
   counterexample). `stale` is explicitly labeled "refresh unverified until attempted (#47
   tier)" — a revoked-refreshToken credential is statically indistinguishable from a
   refreshable one and doctor says so. `expired_needs_login` (no/expired refreshToken) maps
   to the existing blocked code. The Keychain-only-vs-absent distinction is a TYPED code in
   doctor (R11R-6's restored acceptance criterion). Per-read cost: cache metadata plus a
   cheap operator-file stat (the `workspaceProbe` pattern,
   `application-deployment.mjs:1457-1462`); Keychain re-read NEVER per doctor read (R11R-10).
6. **Keychain access is deployment-side only.** No baton component invokes Keychain from the
   worker path; `security` execs happen at open, explicit refresh, and single-flight harvest —
   all in the operator's context (R11R-1's Rule-4 reword; the vendor CLI's own write-back is
   the vendor's business, never a baton worker's).
7. **No cross-vendor overreach.** Grok's 28-min token, kimi's missing thinking option, and
   codex's monthly cap are VENDOR-LIVED constraints: the projection surfaces their states
   honestly (kimi: the thinking-option absence as a named adapter-config finding,
   `kimi-acp.mjs:238-243` — citation verified exact; codex: the cap window AS THE ADAPTER
   SURFACES IT — no pinned wire shape exists, R11R-12 trim) but does not fabricate refreshes
   the vendors don't offer.

## Red-first tests — `impl/test/claude-credential-projection-red.test.mjs`

1. **CC-1 (cache seam):** projection prefers the Keychain read over the file copy when both
   exist (a fixture Keychain shim wins), falls back to the file copy cleanly, and N spawns
   exec the shim exactly ONCE (at open) — spawn-time projection reads the cache (injection
   precedent: `authenticationProbe`, `claude-session.mjs:370`).
2. **CC-2 (fixture claude executable, R11R-3):** a fixture `claude` executable that (a)
   rewrites the projected credentials file with a fresher `expiresAt` (refresh success → the
   harvest adopts it) or (b) emits the `authentication_error` / `Not logged in` is_error
   result (refresh failure → the existing blocked taxonomy + relogin remedy) — pinning the
   established wire shapes (`claude-session.mjs:332-338`). Single-flight: N concurrent
   auth-failure triggers coalesce to exactly ONE refresh-runtime spawn.
3. **CC-3 (doctor metadata):** the credential block carries `expiresAt`,
   `refreshTokenExpiresAt`, and the three states with ms-epoch units; the Keychain-only-vs-
   absent typed code; `stale` carries the refresh-unverified label and never reads route-dead.
4. **CC-4 (access-token-only boundary):** the refresh token never enters a worker runtime —
   the providerSecrets canary pins the env path carrying the access token only, and a source
   scan pins "no baton projection path carries the raw Keychain entry under its own name"
   (precedent: `grammar-m2-red.test.mjs:36`, `issue53-run-debug-red.test.mjs:203`).
5. **CC-5 (retry-once + consent):** a worker `authentication_refresh_required` triggers
   refresh + re-projection + exactly ONE retried turn; a failed refresh fails the run with
   the existing blocked code and the relogin remedy; and no automatic path persists back to
   the operator store (source-scan: persist-back is reachable only from the explicit
   credentials-refresh command).

Deterministic; fixture shims/executables, no real Keychain, no live providers; fixed clocks.

## Verification

```text
node --test impl/test/claude-credential-projection-red.test.mjs
```

then the canonical suite fully green. Post-landing dogfood receipt: the first live
single-flight refresh records the vendor's actual write-back target in this evidence dir.

---

# R11 red-team report (agent-26, verbatim verdict: SOUND-WITH-FOLDS) — fold ledger

- **R11R-1 (P0)** Rules 1×4 jointly inconsistent pending the vendor write-back pin → rule 3
  (harvest-from-any-target, sound under both; write-back pin demoted to verification receipt)
  + rule 6 reword.
- **R11R-2 (P0)** rotation × N concurrent workers race → rules 3-4 (workers never refresh;
  single-flight deployment refresh + retry-once).
- **R11R-3 (P1)** CC-2 "fixture refresh endpoint" pinned non-existent architecture → CC-2
  fixture claude executable pinning the established wire shapes.
- **R11R-4 (P1)** `claude_credential_relogin_required` forked the taxonomy → rule 4 reuses
  `authentication_refresh_required`; claude remedy at the one remediation string.
- **R11R-5 (P1)** two-state {fresh,stale} dishonest; metadata wrong → rule 5 (three states,
  refreshTokenExpiresAt, ms units, refresh-unverified label).
- **R11R-6 (P1)** acceptance criteria dropped; owner-explicit stance reversed → rule 3's
  explicit-command consent ceremony + rule 5's typed Keychain-only-vs-absent code.
- **R11R-7 (P1)** projection cadence contradiction; cache unnamed → rule 1 (named cache;
  open + auth-failure re-read; spawn reads cache).
- **R11R-8 (P1)** open-time probe may burn the credential → rule 3 (the refresh runtime IS
  the probe; its write-back harvested like any refresh).
- **R11R-9 (P2)** boundary overclaim; exposure analysis → rule 2 (access-token-only
  projection accepted) + CC-4 reworded to the projection-path scan.
- **R11R-10 (P2)** doctor frozen at open → rule 5 (per-read cheap probe; Keychain not
  per-read).
- **R11R-11 (P2)** setup-token never adjudicated → rule 2 (named fallback paragraph).
- **R11R-12 (P2)** codex clause ungrounded → rule 7 ("as the adapter surfaces it").
