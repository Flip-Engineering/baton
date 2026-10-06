# Contributor attribution qualification

## Required display

The operator requires the exact contribution names `Flip Baton - GPT`,
`Flip Baton - Muse`, `Flip Baton - DeepSeek`, `Flip Baton - Claude`,
`Flip Baton - GLM` and `Flip Baton - Kimi`, with their approved series
avatars. The operator selected `flip.engineering` for the six public email
identities.

## Observed association

Published Baton2 commit
`fca7af876c8260c32d17f95f3e19bc68ee1bf561` has raw author and committer name
`Flip Baton - GPT`. Its canonical App bot email links both to
`flip-baton-gpt[bot]`, which the actual GitHub page displays.

Earlier Claude commit
`61025b33e4fcb7fbd4547d8abdd482017e161c52` uses raw name
`Claude Fable 5.1` and `noreply@anthropic.com`. GitHub links it to User
81847, login `claude`, whose current profile identifies `@anthropics` and
the Claude Code website. The Claude App's separate bot is User 209825114,
login `claude[bot]`. These are different author associations.

A friendly Git name alone does not qualify the visible byline. Raw commit
headers, linked account, rendered name, selected avatar and authenticated
publication require separate evidence.

## Adapter source and remote fixtures

Branch `codex/baton2-contributor-byline-20261005` is published at
`177fbf73c8380280f7b9127ae7b228d1e75214dc`. Its optional top-level
`authorEmail` supplies the Git author and committer email. Names remain
derived from the verified series. The canonical `github` metadata supplies
App authentication and repository scope. Omission preserves the existing
canonical bot-email behavior.

Independent source review required control-character and quoted-address
refusals, accurate fixture boundaries and conditional rendered acceptance.
Those corrections are included.

On atari-homelab, Node 22.23.3 ran
`node --test bend2/test/git-series.mjs` with 15 passed, zero failed.
The fixtures create real controlled Git commit objects for all six series,
read both header identities back, and verify credential issuance receives the
canonical App metadata. No credentials, models or network calls are used by
the fixture.

| Input | SHA-256 |
|---|---|
| Helper | `51d26c357e5e7eaa21b96329d47758d2b7905e0200ccca1a865f6c80d52f50bf` |
| Test | `c510a494252053c375765bd4c2554f332830585bf1d3c61f1dd3abdccc53cb87` |

Complete evidence is under
`/mnt/nvme4tb/ci-runners/baton2-native-homelab/manual/contributor-byline-177fbf73/`.
The root copy is `.scratch/contributor-byline-evidence-20261005/`.
This scoped adapter validation does not establish composed coordinator laws,
installed native operation or visible GitHub acceptance. Controls received
Root86 and Root87 through native Baton2 dispatch.

## Avatar counterexample

On 2026-10-05, these exact valid author emails have live HTTP 200 Gravatar PNGs,
a null GitHub author association, and a static gray avatar on their actual
GitHub commit pages:

- [git/git 1a927775](https://github.com/git/git/commit/1a92777504afc09e071d7d828e084e6a4dadfce2):
  `u.kleine-koenig@pengutronix.de`.
- [WordPress-iOS b6e62e96](https://github.com/wordpress-mobile/WordPress-iOS/commit/b6e62e96e2b059bd59086b6aa953536a068e4a87):
  `paul.von.schrottky@automattic.com`.

For the first example, SHA-256 and legacy MD5 Gravatar requests return the same
image. GitHub renders `gravatar-user-420.png`. A successful Gravatar response
alone does not qualify the approved avatar on GitHub.

Gravatar supports multiple confirmed email aliases and individual images.
A fresh owned-address commit must demonstrate the actual GitHub result before
global activation. GitHub's contributor graph also requires account
association; record the actual association and graph consequences.
Current App avatars and published history remain preserved.

## Domain and browser setup

Before activation, public DNS for `flip.engineering` used Cloudflare and had
no MX records. The current Flip configuration includes a SendGrid key for
outbound delivery. The existing tunnel belongs to an account with prefix
`b63d9e71`. Initial Google SSO selected an account with prefix `17a47a00`.
The operator identified the owning Google login.
Existing Google SSO authenticated that account, whose actual domain list
contains `flip.engineering` and whose identity matches the tunnel account.

Cloudflare Email Routing is enabled for `flip.engineering`. Its destination
address is operator-owned and verified. The following six saved rules
are active and forward to that address:

| Series | Receiving address |
|---|---|
| GPT | `gpt@flip.engineering` |
| Muse | `muse@flip.engineering` |
| DeepSeek | `deepseek@flip.engineering` |
| Claude | `claude@flip.engineering` |
| GLM | `glm@flip.engineering` |
| Kimi | `kimi@flip.engineering` |

Authenticated browser navigation reloaded the saved rules and verified all
six addresses, destinations and enabled states. The catch-all rule is
disabled. Authoritative DNS confirms the three Cloudflare MX records, its SPF
record and its separate DKIM selector. Readback also confirms the Microsoft
verification TXT, DMARC policy, SendGrid return-path CNAME and both SendGrid
DKIM CNAMEs retain their earlier values. A genuine Gravatar verification email
addressed to `gpt@flip.engineering` reached the destination Gmail account.
The receiving receipt is `gpt-receiving.json`; it contains sender and recipient
evidence and excludes the verification code. The other five addresses have
configuration evidence; their end-to-end delivery remains due.
The generated configuration receipt and screenshot are
`.scratch/contributor-byline-evidence-20261005/contributor-routes.json` and
`contributor-routes.png`.

Browser Use's Browser Harness 0.1.13 and its MCP executable are installed
outside the repository, using prebuilt packages and the existing Python 3.13.
The installed environment uses 44 MiB. Its agent skill is registered at
`~/.codex/skills/browser-harness/SKILL.md`. Local recordings and telemetry
are disabled. The operator enabled Chrome's remote-debugging checkbox.

At 23:25 UTC, the default daemon's JSON health report returned `alive: true`,
`browser_ready: true` and `healthy: true`. `Browser.getVersion` returned
Chrome 154.0.8037.93. Native browser operations selected the existing
Cloudflare task tab, read its accessibility tree, clicked its account selector
and read the resulting account choices. The existing Chrome process remains
the browser host.

Default connection discovery failed because macOS refused the read of Chrome's
`DevToolsActivePort` file. Chrome was listening on loopback port 9222.
[Chromium's approval-only connection handler](https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/devtools_http_handler.cc)
accepts the `/devtools/browser` path and asks for user approval. The explicit
`BU_CDP_WS=ws://127.0.0.1:9222/devtools/browser/` setting connected through that
path. The unchanged Browser Harness approval AppleScript accepted Chrome's
exact `Allow remote debugging?` sheet. The normal `mac-approve` wrapper also
depends on protected profile-file discovery and could not complete here.
Timed-out attempts and their remaining sheets were resolved before the
successful connection.

Subsequent operations use `BH_REQUIRE_EXISTING_DAEMON=1` and the same default
daemon. Explicit WebSocket configuration uses a finite handshake wait in this
release; its local pending-connection lock does not apply to that mode.
Preserve one original connection attempt during cold setup. The MCP executable
is installed; this session uses the supported CLI browser helpers and has not
registered a global per-agent MCP process.

Live Git author-email settings, App slugs, avatars and the installed Baton2
helper remain unchanged. Controls125 reports that clean source
`e536f03383a4cb8a40860bbf383e79a158add31f` contains the three reviewed
`177fbf73` source blobs. That is an owner-attributed composition report;
composed runtime gates and installed acceptance remain due.

The GPT Gravatar registration verified `gpt@flip.engineering`. Its profile
name is `Flip Baton - GPT`, and the approved `flip-gpt.png` was uploaded.
The public email-derived avatar endpoint returned HTTP 200 and a 200px PNG;
visual inspection confirmed the approved character, pose and GPT beret logo.
The served image SHA-256 is
`7ee36dd77b73c6fb793ed07a09a5f739aec5c1bb9f5c4fa6805a34e172a9f72c`.
The local copy is `gpt-gravatar-live.png` in the evidence directory.
Earlier verification attempts selected stale mail; the fresh message in the
receiving inbox completed verification. The remaining contributor work is
the other five receiving checks and a fresh GitHub name-and-image receipt for
each series before live identity activation.

GitHub documents [verified-email author association](https://docs.github.com/en/pull-requests/how-tos/commit-changes/troubleshooting-commits)
and [profile avatars](https://docs.github.com/en/account-and-profile/reference/profile-reference)
for ordinary accounts. Its [account terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)
require human-created machine accounts
and permit one free machine account per operator. A six-account route requires
an appropriate licensed arrangement and actual UI qualification. The current
organization reports the Team plan. [Enterprise profile-name visibility](https://docs.github.com/en/enterprise-cloud@latest/admin/managing-your-enterprise-account/configuring-user-display-names-for-your-enterprise)
adds names alongside usernames; an exact public byline is still a separate
acceptance obligation. These findings do not establish a selected account or
subscription change.
