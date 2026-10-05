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

Public DNS for `flip.engineering` uses Cloudflare and has no MX records.
The current Flip configuration includes a SendGrid key for outbound delivery;
inbound address administration is separate. The existing tunnel belongs to
a Cloudflare account with prefix `b63d9e71`. Google SSO authenticated the
available browser to an account with prefix `17a47a00`; these identities
differ. Verify domain membership and the appropriate account before creating
mail routing.

Browser Use's Browser Harness 0.1.13 and its MCP executable are installed
outside the repository, using prebuilt packages and the existing Python 3.13.
The installed environment uses 44 MiB. Its agent skill is registered at
`~/.codex/skills/browser-harness/SKILL.md`. Local recordings and telemetry
are disabled. Chrome's one-time remote-debugging checkbox remains pending;
the current daemon health is unqualified. The operator has been asked to enable
it on the opened `chrome://inspect/#remote-debugging` page. Subsequent
browser operations should use the installed control tool after connection.

No live series email, App slug, avatar or installed Baton2 helper has changed.
The remaining work is correct domain access, receiving addresses, a fresh
name-and-image receipt for each series, and qualified native composition.

