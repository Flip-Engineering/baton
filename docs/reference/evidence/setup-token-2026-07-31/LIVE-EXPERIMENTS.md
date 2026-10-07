# #11 live experiment receipts (2026-08-01) — the contract's two open verification steps

## Receipt 1 — the production Keychain gap (found and fixed same-day)

The v3 machinery's `ClaudeCredentialCache` defaults `keychainRead`/`keychainMtime` to `() => null`
(`application-deployment.mjs:1607-1612`, the CC-1 shim seam) — and NO host ever injected the macOS
reader the comment names. The production cache therefore ALWAYS fell back to the stale operator
file; the Keychain's fresh tokens (12:24Z, then 16:24Z as the user's interactive session
auto-refreshed) were invisible to doctor. The live receipt caught it: doctor showed the file's
expired 00:35Z expiry while the Keychain sat fresh. Fixed: `defaultMacosKeychainRead/Mtime`
(bounded `/usr/bin/security` exec with honest nulls), CC-1's source-scan amended to confine every
`security` exec to the two named seams. Doctor now reports `state:"fresh"` from the Keychain live.

## Receipt 2 — the vendor's actual refresh behavior and wire shape (R11R-1 + R11V-2)

Controlled experiment (throwaway runtime with the stale operator file — expired access token +
rotated-dead refreshToken, so the experiment was safe):

```json
$ claude --print 'Return OK.' --output-format json
{"is_error":true, "result":"Failed to authenticate. API Error: 401 OAuth access token has been revoked.",
 "api_error_status":401, "terminal_reason":"api_error", "duration_api_ms":0}
```

Findings, verbatim from the vendor:
1. **The vendor CLI does NOT refresh in `--print` mode** — it fails the call with the 401 directly;
   the credentials file is untouched (no write-back). The single-flight's spawn cannot produce a
   fresher credential through this path alone; a refresh-capable runtime shape is the follow-on.
2. **The real terminal wire shape is `Failed to authenticate. API Error: 401 <detail>`** — NOT
   `authentication_error` and NOT `Not logged in · Please run /login` (the two shapes
   `claudeResultFailureCode` matched). R11V-2 fully confirmed: the CC-2 fixture pinned shapes the
   live path never emits. Fixed: the matcher extended to the real shape (with this receipt cited).
3. **Write-back target when refresh DOES occur: the Keychain** (observed across the day:
   04:35Z → 12:24Z → 16:24Z as the user's interactive session refreshed, `refreshTokenExpiresAt`
   rotating forward) — consistent with `security add-generic-password -U` in the vendor binary.
4. **Single-flight monotonicity held twice** ("no strictly fresher schema-valid credential" — the
   R11V-5 harvest gate working, not a failure).

## Remaining open item (named)

A refresh-capable runtime shape: the vendor refreshes at API-call time with a VALID refreshToken
present (its interactive path does), not in the bare `--print` spawn. The single-flight needs its
spawn to reproduce the interactive path's refresh trigger (a live call with a valid refreshToken),
or the retry-once's refresh semantics stay limited to detecting expiry honestly. That's the v3.1
follow-up — machinery, not contract.
