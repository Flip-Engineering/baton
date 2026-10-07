# R11 v2 verification red-team — `setup-token-decisions.md` (v2 section)

**VERDICT: UNSOUND** — three folds survive in substance and four NEW holes ship green-but-broken.

The v2 design is a real improvement over v1 and most of the 12 folds hold. But the load-bearing
claim — "access-token-only projection, strictly smaller exposure than today's full-file copy" — is
**not pinned by any rule or test**, the vendor-CLI env-token expiry wire shape it depends on is
**unverified** (CC-2 uses a fixture that pins shapes the real path may never emit), the single-flight
that kills R11R-2 is **scoped one level too narrowly** (deployment-vs-operator and multi-deployment
rotation races survive), and the R11R-4 remedy is prescribed to land at a citation that is **both the
wrong line and the wrong mechanism**. Repairs are small and local; none require redesign. Fix the six
below (R11V-1..3 are P0/P1 blockers) and the verdict returns to SOUND-WITH-FOLDS.

Grounding note: all reads were targeted (grep→range); the two >1500-line files
(`application-semantics.mjs` 1728, `application-deployment.mjs` 1619) were never read whole (issue
#28 / `wire_frame_oversize`).

## Findings

- **R11V-1 (P0)** — access-token-only projection is asserted, not implemented, and no rule/test removes today's full-file copy → refresh token still lands in the worker.
- **R11V-2 (P0)** — the real CLAUDE_CODE_OAUTH_TOKEN-only expiry wire shape is unverified; CC-2's fixture pins shapes the live path may never emit → ships green, fails at first real mid-turn expiry.
- **R11V-3 (P1)** — single-flight is per-deployment; deployment-vs-operator-session and multi-deployment rotation races reopen R11R-2 one level up.
- **R11V-4 (P1)** — R11R-4's remedy landing (`application-semantics.mjs:1621`) is the wrong line AND the wrong mechanism; the remedy fork reappears as vendor-agnostic text on a shared code.
- **R11V-5 (P1)** — harvest `max(expiresAt)` excludes the incumbent cache credential and applies no schema gate → a shorter-TTL or malformed write-back can regress or poison the cache.
- **R11V-6 (P1)** — no revocation latch: a revoked refreshToken (`invalid_grant`) re-spawns a doomed refresh flight for every subsequent worker failure across the wave (up to 64), and retry-once has no way to tell revocation from expiry.
- **R11V-7 (P2)** — `providerSecrets` canary miscited as the ingress guard; it guards output echo, not input projection.
- **R11V-8 (P2)** — cache has no spawn-time TTL gate; after access-token expiry every new spawn projects a known-dead token and burns a retry.
- **R11V-9 (P2)** — citation drift: `application-deployment.mjs:1457-1462` (workspaceProbe) and `:352` (seconds precedent) point at the wrong ranges.

---

### R11V-1 (P0) — access-token-only projection is unimplemented and unpinned; the full-file copy survives

**Grounding.** `application-deployment.mjs:598` — `if (existingRegular(claude)) credentials.claude = [claude];` — the whole `~/.claude/.credentials.json` (accessToken **and** refreshToken **and** refreshTokenExpiresAt) is registered as `credentialFiles.claude` and projected verbatim into every worker runtime at `runtime-isolation.mjs:115-122`. `credentialEnv` is wired generically (`runtime-isolation.mjs:51,104-111`) but **`CLAUDE_CODE_OAUTH_TOKEN` appears nowhere in `impl/` — 0 hits** across `src/**` and `test/**`. There is no `credentialEnv.claude` producer anywhere.

**The failure.** Rule 2 says projection "rides the **existing** credentialEnv path (`CLAUDE_CODE_OAUTH_TOKEN`, `runtime-isolation.mjs:104-111`)… a strictly smaller exposure than today's full-file copy." The env *mechanism* exists; the claude *use of it* does not, and — critically — achieving "strictly smaller" requires **deleting `credentials.claude = [claude]` at `application-deployment.mjs:598`** so the file stops being projected. No rule states that deletion and **no test asserts it**. CC-4 only scans for "no baton projection path carries the raw Keychain entry **under its own name**" — a full-file copy of the operator's `.credentials.json` is not "the raw Keychain entry under its own name," so CC-4 stays green while the refresh token still ships into all N workers. The headline exposure-reduction claim is therefore asserted, not enforced: an implementer who adds the env projection without removing line 598 satisfies every rule and every test and still leaks the refresh token — the exact opposite of R11R-9's accepted alternative.

**Minimal repair.** (1) Add an explicit rule clause: "the claude `credentialFiles` full-file registration at `application-deployment.mjs:598` is removed; claude projects via `credentialEnv.claude = { CLAUDE_CODE_OAUTH_TOKEN: <cache.accessToken> }` only." (2) Strengthen CC-4 to assert **positively** that `credentialFiles.claude` is undefined/empty after the change and that the projected worker config tree contains **no file** whose bytes include the cache's `refreshToken` — not just "no entry under its own name."

---

### R11V-2 (P0) — the real env-token expiry wire shape is unverified; CC-2 fixtures pin shapes the live path may never emit

**Grounding.** `claude-session.mjs:332-338` — `claudeResultFailureCode` maps to `authentication_refresh_required` **only** when the trimmed `result` is exactly `authentication_error` **or** matches `^Not logged in\s*[·:.-]?\s*Please run (?:/login|claude auth login)\.?$`. CC-2 (doc lines 102-106) is a **fixture** `claude` executable that emits those pinned strings.

**The failure.** Today's worker holds the full credentials file, so the CLI refreshes in-process and a mid-turn 401 rarely surfaces as a terminal result. Under Rule 2 the worker holds **only** `CLAUDE_CODE_OAUTH_TOKEN` and **no `refreshToken`/no file** — so at access-token expiry mid-turn the CLI cannot refresh and must surface a terminal auth failure. **Whether the real binary, running from an env token with no credentials file, emits `authentication_error` / `Not logged in · Please run /login` (vs. an API-shaped `401`/`OAuth token expired`/JSON error frame) is unverified in-repo.** If it emits any other string, `claudeResultFailureCode` returns `null` → the turn is **not** classified as `authentication_refresh_required` → no single-flight refresh, no retry-once → the run fails as an unclassified provider error. CC-2 cannot catch this because its fixture emits the pinned shapes by construction: the whole retry-once/refresh machine ships **green against a fixture that encodes the assumption under test.** This is the single most likely "green but broken at first real expiry."

**Minimal repair.** Demote the wire-shape assumption to an explicit **verification step** (same status the doc already gives the write-back target): the first live env-token mid-turn expiry records the CLI's actual terminal `result` string into this evidence dir, and `claudeResultFailureCode`'s matcher is confirmed/extended against it **before** the retry-once path is trusted. Until then, mark Rule 4 "expiry-classification unverified for the env-token projection."

---

### R11V-3 (P1) — single-flight is per-deployment; the rotation race reopens one level up

**Grounding.** Rule 3: "**One serialized refresh flight per deployment** (concurrent triggers coalesce)." Rule 4: "workers never refresh, so N workers never race the rotation; the single flight is the only refresher." Vendor refresh does `grant_type=refresh_token` with **rotation write-back** and `security add-generic-password -U` (doc lines 5-6, 23-27).

**The failure.** R11R-2's fold serializes refresh **within one deployment**. It does not serialize across **(a)** two concurrent baton deployments on the same operator machine (each has its own cache and its own single-flight, both reading the same operator Keychain/credentials file), or **(b)** a baton deployment vs. the operator's own interactive `claude` session refreshing in parallel. Because refresh **rotates** the refreshToken and the old one is consumed server-side, two concurrent vendor refreshes off the same starting refreshToken → the second gets `invalid_grant`, and whichever wrote back last defines the live token — the other deployment's cache now holds a **rotated-away, dead** refreshToken it believes is fresh. The rotation race R11R-2 claimed to kill is merely relocated from worker-granularity to deployment/session-granularity, where baton's single-flight has no reach.

**Minimal repair.** Scope the mutual exclusion to the **credential**, not the deployment: an OS-level lock (advisory lockfile next to the operator credentials store, or a Keychain-mtime CAS check — re-read Keychain immediately before adopting the harvest and abort if it changed under you) so any refresher — other deployment or the operator's own CLI — is detected. At minimum, add a rule clause acknowledging the single-flight guarantee is intra-deployment and that cross-deployment/operator-session concurrency is an unaddressed live constraint (not a folded one).

---

### R11V-4 (P1) — R11R-4's remedy landing is the wrong line and the wrong mechanism

**Grounding.** `application-semantics.mjs:1621` is `digest: authorityDigest,` inside a `freeze({...})` — **not a remediation string.** The real guidance table is `PROVIDER_TERMINAL_GUIDANCE` at `1625-1650`; `authentication_refresh_required`'s remediation is at **1634**: *"Refresh the harness-native login outside Baton, rerun baton doctor, then retry the Run."* That string is **shared** with `authentication_required` (1629) and is deliberately **vendor-agnostic**. Per-vendor remedy text lives in **per-vendor summary functions** — `kimiAuthenticationSummary` (`application-deployment.mjs:316`), `grokAuthenticationSummary` (`:390`). The code `authentication_refresh_required` is **shared across kimi, grok, and claude** (`application-deployment.mjs:317,359,376,460`; `claude-session.mjs:322,337`). **There is no `claudeAuthenticationSummary`** — claude's summary is the generic `'Provider authentication requires refresh.'` at `claude-session.mjs:322`.

**The failure.** Rule 4 / R11R-4 fold: "the claude-specific relogin remedy text lands at the single remediation string, `application-semantics.mjs:1621`." (1) Line 1621 is wrong — it's a digest field. (2) The mechanism is wrong: putting claude-specific "run `/login`" text into the **shared** `PROVIDER_TERMINAL_GUIDANCE.authentication_refresh_required` string would **misroute** remediation for grok and kimi, which hit the same code. R11R-4 folded a forked *code*; this prescription reintroduces the same cross-vendor collision as forked *text on a shared code*. The established pattern is the exact opposite — a per-vendor summary function.

**Minimal repair.** Land claude's remedy in a new `claudeAuthenticationSummary(code)` mirroring `grokAuthenticationSummary`/`kimiAuthenticationSummary`, wired at the claude terminal-result site (`claude-session.mjs:322`). Leave `application-semantics.mjs:1634` vendor-agnostic. Fix the citation to `:1634` (or `:1632-1637`).

---

### R11V-5 (P1) — harvest `max(expiresAt)` omits the incumbent and applies no schema gate

**Grounding.** Rule 3: "HARVEST the freshest credential (**max `expiresAt`**) from every write-back target — the runtime's projected file AND a Keychain re-extract." R11R-8 fold: "the refresh runtime IS the probe; its write-back harvested like any refresh."

**The failure — two ways.** (a) **Regression below incumbent.** The `max()` set is `{runtime file, Keychain}` — it does **not** include the cache's current credential. If the vendor writes back a token with a *shorter* TTL than what's cached (partial write, clock skew, or a vendor that reissues a nearer expiry), harvest adopts a credential **staler than the one the cache already held** — a monotonicity regression that Rule 3 explicitly can't prevent. (b) **Malformed write-back wins.** A truncated/partial file caught mid-write (or a corrupt Keychain re-extract) can carry a garbage `expiresAt` (e.g. a huge or NaN→coerced value) that **beats** the real one under `max()`; with no schema validation before adoption, the cache is poisoned with a credential whose `accessToken` is truncated/absent → every subsequent projection is dead. R11R-8 assumed the probe's write-back is always a well-formed credential; nothing enforces that.

**Minimal repair.** (1) Include the incumbent cache credential in the freshness comparison and adopt only if the harvest is **strictly fresher** (`harvest.expiresAt > cache.expiresAt`). (2) Schema-gate every harvested candidate before it enters the `max()` — require `accessToken` non-empty, `expiresAt` a safe positive ms-epoch integer within a sane bound (reuse the kimi schema-refusal discipline at `application-deployment.mjs:363-372`) — and discard candidates that fail. Add a CC-2 case: a partial/short-TTL write-back must NOT be adopted.

---

### R11V-6 (P1) — no revocation latch; retry-once can't distinguish revocation from expiry, and each failure respawns a doomed flight

**Grounding.** Rule 4: single-flight refresh "concurrent triggers coalesce"; "A refresh that itself fails (revoked/absent refreshToken) maps to the existing blocked taxonomy." Coalescing joins **concurrent** triggers only.

**The failure.** A 401 from a **revoked** refresh token (`invalid_grant`) is, at the worker, indistinguishable from ordinary expiry — both surface as `authentication_refresh_required`. Retry-once doesn't loop a single worker (it's once), but there is **no negative cache / circuit-breaker at the deployment**: the first flight fails with `invalid_grant`, and every *subsequent* worker failure across the wave — these are sequential, not concurrent, so they do **not** coalesce with the finished flight — triggers a **fresh** throwaway-runtime spawn that does another doomed network refresh. Under a mid-wave revocation (a real receipt: "a 401 revocation mid-wave", doc line 19) that is **up to 64 doomed refresh-runtime spawns** — R11R-7's "up to 64 `security` execs" concern reincarnated as up to 64 doomed refresh flights. The design has no way to latch "this credential is revoked, stop refreshing until explicit re-login."

**Minimal repair.** On a refresh flight that fails with `invalid_grant`/revocation, set the cache state to `expired_needs_login` (the state Rule 5 already defines) and **short-circuit** all further auto-refresh triggers to the blocked taxonomy without spawning — until the explicit `baton credentials refresh claude` command clears the latch. Add CC-5 coverage: after one revoked-refresh failure, a second worker failure must NOT spawn a second refresh runtime.

---

### R11V-7 (P2) — the providerSecrets canary is miscited as the ingress guard

**Grounding.** `claude-session.mjs:854-884` — `_containsProviderSecret` / `_onStderr` scan **provider output** (stderr tail + wire frames) for `providerSecrets` substrings and SIGKILL on a hit. It is an **egress** guard (stops the CLI echoing a secret back through baton).

**The failure.** Rule 2: access-token-only projection "**guarded by** the providerSecrets canary (`claude-session.mjs:371,854-884`)." The canary does nothing about what gets **projected into** the runtime — it cannot keep the refresh token *out* of a worker. The actual ingress guard is "don't register the file for projection" (see R11V-1). Conflating the two lets an implementer believe the canary discharges the exposure obligation when it doesn't. (Citations `:371` and `:854-884` themselves are accurate; the *role* attributed to them is wrong.)

**Minimal repair.** Reword Rule 2: the canary is a defense-in-depth **egress** check on the *access* token; the ingress guarantee (no refreshToken in the worker) is carried solely by projecting env-only and not registering the file (R11V-1). Keep both; don't let one stand in for the other.

---

### R11V-8 (P2) — no spawn-time TTL gate; the cache can project a known-dead token

**Grounding.** Rule 1: cache re-read happens only at "open, the explicit refresh command, and the single-flight worker-auth-failure path — **never per doctor read**"; "spawn never execs `security`." Rule 5 computes `state: fresh|stale|expired` for doctor but spawn does not consult it.

**The failure.** For a long-lived deployment, once the cached access token passes `expiresAt` (observed TTL ~4.4h) and before any worker has failed, **every new spawn projects an already-expired token**. Each such worker burns its first turn on a guaranteed auth failure → single-flight → retry-once. It self-heals after the first failure repopulates the cache, but every spawn in the gap between expiry and first-failure pays a wasted turn. This is benign-but-wasteful, not a correctness break — hence P2.

**Minimal repair.** At spawn, if `cache.expiresAt <= now` (a free comparison, no `security` exec), trigger the single-flight refresh **before** projecting rather than after the first doomed turn. Preserves "spawn never execs security" (the refresh flight does), removes the wasted-turn tax.

---

### R11V-9 (P2) — citation drift on two supporting references

**Grounding & failure.**
- `application-deployment.mjs:1457-1462` is cited (Rule 5) as "the `workspaceProbe` pattern" for a cheap per-read stat. That range is `openBatonDeployment` option normalization (`closed(advanced, [...])`). The real `workspaceProbe` is **defined at `:1538`** and **invoked per-read at `:1204`** (`#workspaceProbe = deployment.workspaceProbe`). The *pattern* is real and apt; the *line* is wrong by ~80–330 lines.
- `application-deployment.mjs:352` is cited (Rule 5) as "the kimi seconds-precedent." Line 352 is the empty-token check (`value.access_token === '' && value.refresh_token === ''`). The seconds semantics is at `:353` (`expires_at === 0 && expires_in === 0`) and the `*1000` conversion at `:377`. Substance correct, line slightly off.

**Minimal repair.** Repoint to `:1204`/`:1538` and `:353`/`:377` respectively. No design impact.

---

## Fold-verdict table (R11R-1..12)

| # | Sev | v2 landing | Verdict |
|---|-----|-----------|---------|
| R11R-1 | P0 | Rule 3 harvest-from-any-target + Rule 6 reword | **FOLDED** — write-back fork dissolved; but harvest freshness rule has a new hole (see R11V-5) |
| R11R-2 | P0 | Rules 3-4 single-flight, workers never refresh | **SURVIVES** — killed at worker granularity, reopens at deployment/operator-session granularity (R11V-3) |
| R11R-3 | P1 | CC-2 fixture claude executable | **FOLDED (verification gap)** — fixture pins shapes the real env-token path may not emit (R11V-2) |
| R11R-4 | P1 | Rule 4 reuse `authentication_refresh_required` + remedy at semantics:1621 | **SURVIVES** — code fork deleted (verified: 0 hits `claude_credential_relogin_required`), but remedy prescribed at wrong line + wrong mechanism → text fork reappears (R11V-4) |
| R11R-5 | P1 | Rule 5 three states + refreshTokenExpiresAt + ms + label | **FOLDED** — design-consistent with existing metadata discipline |
| R11R-6 | P1 | Rule 3 explicit-command ceremony + Rule 5 typed Keychain code | **FOLDED** — consent ceremony restored; CC-5 source-scan covers persist-back reachability |
| R11R-7 | P1 | Rule 1 named cache, spawn reads cache | **FOLDED** — cache named, cadence resolved; minor: no spawn-time TTL gate (R11V-8) |
| R11R-8 | P1 | Rule 3 refresh runtime IS the probe | **FOLDED** — probe-burns-credential dissolved; assumes valid write-back (schema gate missing, R11V-5) |
| R11R-9 | P2 | Rule 2 access-token-only + CC-4 projection-path scan | **SURVIVES** — exposure reduction asserted but neither rule nor test removes the full-file copy (R11V-1) |
| R11R-10 | P2 | Rule 5 per-read cheap probe, Keychain not per-read | **FOLDED** — workspaceProbe precedent real (citation drift only, R11V-9) |
| R11R-11 | P2 | Rule 2 named-fallback setup-token paragraph | **FOLDED** — adjudicated as named fallback with its own ceremony; sound |
| R11R-12 | P2 | Rule 7 "as the adapter surfaces it" | **FOLDED** — codex clause degrounded to the adapter surface; kimi citation (`kimi-acp.mjs:238-243`) verified exact |

**Tally:** 9 folded (3 with caveats), 3 survive in substance (R11R-2, R11R-4, R11R-9). The three survivors plus the two unverified-assumption gaps (R11V-1, R11V-2) are why the top-line verdict is **UNSOUND** rather than the doc's self-assessed SOUND-WITH-FOLDS: each would ship green under the current CC-1..CC-5 and break on first real use.

## Citation audit (all six task-named + adjacent)

| Citation | Status |
|----------|--------|
| `application-semantics.mjs:1621` | **WRONG** — `digest: authorityDigest`, not a remediation string; real guidance at :1634 (R11V-4) |
| `runtime-isolation.mjs:104-111` | ✓ exact — env projection loop over `credentialEnv[family]` |
| `claude-session.mjs:371` | ✓ exact — `providerSecrets` freeze |
| `claude-session.mjs:854-884` | ✓ exact — canary; but role miscited (egress not ingress, R11V-7) |
| `claude-session.mjs:332-338` | ✓ exact — `claudeResultFailureCode` wire matcher |
| `claude-session.mjs:370` | ✓ exact — `authenticationProbe` injection seam |
| `application-deployment.mjs:352` | ~ near — empty-token check; seconds semantics at :353/:377 (R11V-9) |
| `application-deployment.mjs:1457-1462` | **WRONG range** — option normalization; workspaceProbe at :1204/:1538 (R11V-9) |
| `grammar-m2-red.test.mjs:36` | ✓ exact — `readFileSync(...,'latin1')` source-scan helper (CC-4 precedent) |
| `issue53-run-debug-red.test.mjs:203` | ✓ exact — `cliSource.includes(...)` source-scan assertion (CC-4 precedent) |
| `kimi-acp.mjs:238-243` | ✓ exact — thinking-option absence → `effort_unavailable` |
