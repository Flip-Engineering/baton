# Issue #11 contract — durable headless credential projection (v1)

Ground truth: issue #11 plus the campaign's credential-fragility receipts (all filed on #11
and #47): claude OAuth TTL rotation ×3 and a 401 revocation mid-wave; grok's token dying 28
minutes after an interactive login; kimi's thinking option absent from its ACP surface;
codex's monthly usage cap discovered at turn time; GLM's 529 era. Every failure was discovered
AT TURN TIME because projection is static and doctor is static-only.

## The question

Claude workers need credentials inside the private worker runtime, and today the path is a
static copy of `~/.claude/.credentials.json` whose OAuth access token has an hours-long TTL.
The durable projection must survive TTL expiry and vendor rotation without an operator
re-extract per cycle.

## Rules

1. **Refresh-aware projection for the claude family.** The deployment reads the Keychain
   entry (`security find-generic-password -s "Claude Code-credentials" -w`) at projection
   time (not a stale file copy), projects `refreshToken`-carrying credentials, and the worker
   runtime's token-refresh path runs on 401/soft-expiry before any run fails. A 401 with no
   refresh path fails with `claude_credential_relogin_required` naming the remedy (`claude`
   interactive login) instead of a bare provider error.
2. **Token-age metadata in doctor.** Where the vendor exposes expiry (claude's
   `claudeAiOauth.expiresAt`), doctor's route report carries `credential: {expiresAt,
   state: fresh|stale}`; a stale-but-refreshable credential reads `stale`, never `dead`.
   (The bounded actual-inference tier stays issue #47 — this contract is projection, not
   readiness probing.)
3. **No cross-vendor overreach.** Grok's 28-min token, kimi's missing thinking option, and
   codex's monthly cap are VENDOR-LIVED constraints: the projection surfaces their states
   honestly (kimi: the thinking-option absence as a named adapter-config finding with the
   kimi-acp.mjs:238-243 citation; codex: the cap window when the API reports it) but does not
   fabricate refreshes the vendors don't offer.
4. **Keychain access is deployment-side only.** The `security` invocation happens once per
   deployment open (or per refresh check) in the operator's context; the result is projected
   into the private runtime; no worker ever invokes Keychain or reads the raw entry.

## Red-first tests — `impl/test/claude-credential-projection-red.test.mjs`

1. **CC-1:** projection prefers the Keychain read over the file copy when both exist (a
   fixture Keychain shim wins), and falls back to the file copy cleanly when the shim is absent.
2. **CC-2:** a 401 with a refreshToken present triggers the refresh path (a fixture refresh
   endpoint is consulted) before any failure; a 401 without one fails
   `claude_credential_relogin_required` with the remedy named.
3. **CC-3:** doctor carries `credential.expiresAt` and `state: fresh|stale` from the
   credentials file (fixture with a known expiry), and a stale-but-refreshable state never
   reports as route-dead.
4. **CC-4:** the Keychain entry is never worker-readable (the projected runtime's exclusion
   pattern covers it; a source scan pins the exclusion).

Deterministic; fixture shims, no real Keychain, no live providers; fixed clocks.

## Verification

```text
node --test impl/test/claude-credential-projection-red.test.mjs
```

then the canonical suite fully green.
