# Series Git identities

`bend2/harness/git-series.mjs` is an optional process launcher, HTTPS
credential helper and GitHub CLI wrapper. It selects a GitHub App for GPT, Muse,
DeepSeek, Claude, GLM or Kimi. Commit author and committer names use the exact format
`Flip Baton - GPT`, `Flip Baton - Muse`, `Flip Baton - DeepSeek`,
`Flip Baton - Claude`, `Flip Baton - GLM` or `Flip Baton - Kimi`. Native
execution keeps its exact model identifier.

Current development archives install the helper at `PREFIX/libexec/baton2/git-series.mjs`
beside the Conductor adapters. Run that file with Node 22.15 or later on a POSIX
host. A source checkout uses `bend2/harness/git-series.mjs`. The Python source
remains a legacy reference. The immutable 1.0 archive carries the earlier Python
helper; its version-specific payload is described in [installation](installation.md).

For a Git credential request to `github.com/OWNER/NAME`, the helper looks up
the App installation of account `OWNER` with
`GET /repos/OWNER/NAME/installation`, using the App JWT. It mints a token for
that installation. Each account owner has its own installation. Git credential
requests keep the permissions body `contents:write`, `pull_requests:write`
and `metadata:read`. The identity metadata, installation and issued token
must each include those minimum grants. Additional grants are accepted.
A missing or weaker permission produces a refusal naming the required grant.

The GitHub CLI wrapper uses the same per-owner lookup and requires the Git
grants plus `issues:write`, `actions:read`, `checks:read` and `statuses:read` on
the installation and issued token. It sends an empty token request body.
GitHub documents that [omitting `permissions` gives the token the installation's
full grant](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app).
The token covers the repositories granted to that installation. Existing
identity files can keep the three Git grants in their public metadata.

## GitHub App permissions

The following Apps belong to `Flip-Engineering`. For each App, open the
organization's **Settings > Developer settings > GitHub Apps**, select the App,
and open **Permissions & events**.

| Series | App |
| --- | --- |
| GPT | [Flip Baton - GPT](https://github.com/apps/flip-baton-gpt) |
| Muse | [Flip Baton - Muse](https://github.com/apps/flip-baton-muse) |
| DeepSeek | [Flip Baton - DeepSeek](https://github.com/apps/flip-baton-deepseek) |
| Claude | [Flip Baton - Claude](https://github.com/apps/flip-baton-claude) |
| GLM | [Flip Baton - GLM](https://github.com/apps/flip-baton-glm) |
| Kimi | [Flip Baton - Kimi](https://github.com/apps/flip-baton-kimi) |

Set these repository permissions on every App:

| GitHub setting | Level | API key | Seat operation |
| --- | --- | --- | --- |
| Contents | Read and write | `contents:write` | Git and pull request branches |
| Pull requests | Read and write | `pull_requests:write` | Read and open pull requests |
| Metadata | Read-only | `metadata:read` | Repository metadata |
| Issues | Read and write | `issues:write` | Read issues and post comments |
| Actions | Read-only | `actions:read` | Read workflow runs and logs |
| Checks | Read-only | `checks:read` | Read check runs and annotations |
| Commit statuses | Read-only | `statuses:read` | Read commit status contexts |

The required additions are Issues, Actions, Checks and Commit statuses.
Preserve the existing Contents, Pull requests, Metadata and Workflows grants.
The Git credential token request keeps its three existing grants.

[Actions reads](https://docs.github.com/en/rest/actions/workflow-runs),
[Checks reads](https://docs.github.com/en/rest/checks/runs) and
[Commit statuses reads](https://docs.github.com/en/rest/commits/statuses)
use the permissions listed above. Deploy the helper and wrapper together,
then update the App registrations and have the installation owners approve the
new permissions on both `Flip-Engineering` and `flip-engineer`. The
`flip-engineer` installation supplies access to
`flip-engineer/automated-content-pipeline`.
[GitHub retains an installation's old permissions until its owner accepts the
update](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app#about-changes-to-permissions).
A seat's next `gh` command resolves that installation's current grant and
requests a fresh token. A missing installation produces a refusal naming its
App slug and requested owner.

## Configuration

Create an owned registry file and an App directory for each configured series.
Each directory contains `identity-series.json` and `private-key.pem`. The
private key must have mode `0600`; public files must be owned by the launching
user and disallow group and world writes. Keep these files outside the checkout.

The registry has explicit exact-model mappings and series directories:

```json
{
  "models": {
    "gpt-6-astra": "gpt",
    "kimi-code/k3": "kimi",
    "kimi-code/kimi-for-coding": "kimi",
    "deepseek/deepseek-flash": "deepseek",
    "muse-spark-1.3-contributor": "muse"
  },
  "series": {
    "gpt": "/ABSOLUTE/CONFIG/DIRECTORY/gpt",
    "muse": "/ABSOLUTE/CONFIG/DIRECTORY/muse",
    "deepseek": "/ABSOLUTE/CONFIG/DIRECTORY/deepseek",
    "claude": "/ABSOLUTE/CONFIG/DIRECTORY/claude",
    "glm": "/ABSOLUTE/CONFIG/DIRECTORY/glm",
    "kimi": "/ABSOLUTE/CONFIG/DIRECTORY/kimi"
  }
}
```

The registry has no per-repository routes. Each series directory serves every
repository that its App is installed on. A `repositories` key in a registry file
is not read.

Both Kimi keys route to the same Kimi series.
`kimi-code/kimi-for-coding` is the provider-qualified OMP selector for Kimi
K2.8 Preview: `kimi-code` names the OMP provider and `kimi-for-coding` is
Kimi's API model ID. The display name `K2.8 Preview` identifies the model in
the OMP catalog; Kimi's [model documentation](https://www.kimi.com/code/docs/en/kimi-code/models)
gives the API model ID and the accepted effort levels `low`, `high` and `max`.
Registry keys and `--model-key` values use the selector verbatim.

The registry may set one shared author and committer with a top-level
`attribution` object:

```json
{
  "attribution": {
    "name": "Flip - Baton",
    "email": "baton@flip.engineering"
  }
}
```

The helper applies these fields to Git author and committer headers for every
selected series. Registry attribution takes precedence over a selected
`identity-series.json` `authorEmail`. The helper uses that per-series email
when no shared attribution is configured, and the verified App bot email when
the identity has no `authorEmail`. Its default name is `Flip Baton - SERIES`.
The `github` identity selects the App and its signing key. Its `permissions`
metadata must include the minimum grants. The helper finds the installation
and its current grants for each repository owner.

Each public identity has this shape. Replace the unset GitHub values with
verified App and bot metadata before launch:

```json
{
  "seriesKey": "gpt",
  "displaySeries": "GPT",
  "github": {
    "appId": null,
    "clientId": null,
    "slug": null,
    "botLogin": null,
    "botId": null,
    "commitEmail": null,
    "permissions": {
      "contents": "write",
      "pull_requests": "write",
      "metadata": "read"
    }
  }
}
```

The bot login is `SLUG[bot]`; the commit email is
`BOT_ID+SLUG[bot]@users.noreply.github.com`. Verify the bot ID through GitHub's
public user metadata. GitHub's own action documents this
[email format](https://github.com/actions/create-github-app-token#configure-git-cli-for-an-apps-bot-user).
`displaySeries` must match the selected label: `GPT`, `Muse`, `DeepSeek`,
`Claude`, `GLM` or `Kimi`. The default commit name is `Flip Baton - ` followed
by that verified label. GitHub controls the App account login's `[bot]` suffix;
the bot login, numeric ID, noreply email and authenticated actor stay unchanged.
Each App registration's `name` also uses `Flip Baton - SERIES`. GitHub's action
interface derives a normalized lowercase, hyphenated label from that name.
Its managed Bot object exposes the actor login and avatar. Linked contributor
views can therefore display the bot login while the commit retains its author
name. See [App naming](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
and [Bot fields](https://docs.github.com/en/graphql/reference/apps#bot).
The helper reads the fixed public filename and uses the adjacent key to sign
an RS256 App JWT with Node's built-in cryptography library. A file may still
carry `installationId`, `repositoryFullName` or `repositoryId`. The helper
ignores those fields, because the installation is looked up for each request.

## Native launch selection

Current native controls select the registry at
`~/.config/baton/github-apps/series.json`. `BATON2_GIT_REGISTRY` selects an
explicit registry path. When a registry exists, `start` and `receiver` generate
an endpoint using the installed Node helper and the recipient's recorded model.
`dispatch-turn` applies the same selection to its direct native turn.

`receiver`, `configure`, `start` and `dispatch-turn` read the assignment's
origin remote and pass its GitHub repository to the helper as `--repository`.
A nested worker registered from another worker's environment uses its own
assignment workspace, so it receives that assignment's repository. A workspace whose
origin is not a GitHub URL passes no repository selection. With a selection,
the helper accepts credential requests only for that repository. With no
selection, each request names its own repository and the helper uses that
repository's owner installation.

```sh
baton2 /absolute/path/state.db receiver lead /absolute/path/omp \
  /absolute/path/lead-native.jsonl
baton2 /absolute/path/state.db dispatch-file lead-task root lead task \
  /absolute/path/lead-task.md
```

Before it stores an endpoint or launches a turn, the coordinator asks the helper
to resolve the recorded model key without launching a command:

```sh
node "$GIT_SERIES" check --registry "$REGISTRY" --model-key MODEL [--repository OWNER/REPO]
```

The check exits 0 when the registry resolves the key and refuses otherwise.
`start`, `receiver` and `dispatch-turn` report that refusal with exit status 2,
keep the session's stored endpoint unchanged, and leave any pending input
unaccepted, so an unmapped model refuses where it is configured.

The helper replaces inherited Git identity in the launched session with the
selected recipient series. Native tool calls inherit that identity. Registry
configuration and keys remain outside the installed prefix and task files.
Follow [harness setup](harness-setup.md#native-controls) for native startup.

## Direct command selection

Set `GIT_SERIES` to the helper's absolute installed or source path and `REGISTRY`
to the registry's absolute path. For an extracted native prefix, use
`GIT_SERIES="$PREFIX/libexec/baton2/git-series.mjs"`. For a direct harness launch,
the helper can bind the exact execution model:

```sh
exec node "$GIT_SERIES" launch --registry "$REGISTRY" \
  --model-key kimi-code/k3 --native-model -- /ABSOLUTE/PATH/omp "$@"
```

`--native-model` requires native `--model VALUE`, `-m VALUE` or `--model=VALUE`
arguments to agree with `--model-key`. Configure each known model's series
explicitly. An unmapped model requires `--series-key` as well. A mapped model
and an explicit different series refuse. Multiple exact versions can share
one series App.

A Git command, coordinator or MCP server can select its series directly:

```sh
node "$GIT_SERIES" launch --registry "$REGISTRY" --series-key gpt -- \
  git commit -m 'Describe the change'
```

Omit `--native-model` for these commands. Git's `-m` supplies a commit message.
The compiled Codex `turn` and `receive` paths enforce the ChatGPT subscription
login. A direct Codex command needs `-c 'forced_login_method="chatgpt"'` before
its native subcommand. The selected GPT series clears
`OPENAI_API_KEY` and `CODEX_API_KEY` across exact versions. A Codex login-status
command uses the ordinary command launch because it has no model argument.

## GitHub CLI

The launcher prepends `git-series-bin` beside `git-series.mjs` to the seat's
`PATH`. Development archives install its executable wrapper at
`PREFIX/libexec/baton2/git-series-bin/gh`. The wrapper imports the adjacent
helper and uses `BATON2_GH_REGISTRY` and `BATON2_GH_SERIES`, set by the launcher,
to select the seat's App. Keep the wrapper directory beside the helper when
copying an installation.

Each `gh` invocation selects its repository in this order:

1. The `-R OWNER/NAME` or `--repo OWNER/NAME` argument. Attached `-ROWNER/NAME`
   and `--repo=OWNER/NAME` forms are also accepted.
2. `GH_REPO`, in `OWNER/NAME` form.
3. The cwd's Git remote `origin`, using a GitHub HTTPS or SSH URL.

An unresolved owner produces a refusal naming these inputs. Commands such as
`gh auth status` and `gh api /user` need one of these inputs too. The Git
credential helper's optional `--repository` restriction applies to Git
credential requests; `gh` uses the repository selected by its invocation.

The wrapper finds the executable `gh` on `PATH`, skipping entries that resolve
to `git-series-bin/gh` in any source or installed prefix. It requests a fresh
installation token through the same App and installation verification used by
Git credentials. It validates the CLI permission set listed above and sets
`GH_TOKEN` in the environment passed to that executable. The seat environment
remains free of the issued token. The wrapper preserves the command arguments,
cwd, PID, standard streams and exit status. Tokens remain in process memory.

For example, from a launched seat:

```sh
gh pr checks -R flip-engineer/flip
gh issue comment 1019 -R Flip-Engineering/baton --body 'Review complete.'
```

## Process and publication boundaries

The native controls select the recipient's series for receiver and detached
turn launches. Direct commands and external MCP servers need their own explicit
helper selection. The helper retains the
current PID, workspace and standard streams and replaces inherited author, committer, credential helper,
askpass and HTTP authorization headers within the child environment. It
preserves noncredential runtime Git settings. An MCP Conductor must launch its
server through the helper so its coordinator tools inherit the selected
identity. Standalone coordinator calls need the same explicit binding.

The helper sets `GIT_ASKPASS` to `false`, a program that refuses the prompt. An
inherited askpass command line is replaced.

Inherited `GH_TOKEN` and `GITHUB_TOKEN` are cleared. The `gh` wrapper supplies
the selected App token for each command. SSH push authentication uses its own
actor. Repository, worktree and global Git configuration files remain unchanged.

Controlled coordinator publication supplies the explicit HTTPS remote:

```sh
baton2 DATABASE push REPOSITORY BRANCH https://github.com/Flip-Engineering/baton.git
```

The helper accepts unique HTTPS protocol, host, repository path and optional
`x-access-token` username fields. It validates and ignores repeated `[]`
credential extension fields, including `capability[]`. It verifies the App,
the owner's installation and the permissions before returning a credential
through Git's private helper pipe. JWTs and tokens remain in
process memory and are excluded from arguments, URLs, files and diagnostics.

Commit author and committer are editable commit metadata. The installation
token authenticates the HTTPS push as the selected App. Current checked
landing creates a squash commit under the reviewing Conductor's environment;
the retained Player commits keep their own attribution. `baton land` and
`baton push` read the current actor from `BATON_SESSION`, resolve its recorded
model through the configured registry, and re-enter the command through the
helper with `BATON2_GIT_IDENTITY_APPLIED` set. The helper's author and
committer variables therefore take precedence over inherited repository or
global Git configuration. An absent actor session or registry keeps the
inherited environment. Verify source commit, landed commit and authenticated
push actor separately. Conductor review, selected landing checks and
repository protection provide review authority.

## Validation

Run the controlled fixtures with `node --test bend2/test/git-series.mjs`. They
use invented public metadata, a generated signing key, API response doubles and
a controlled Node child. Fixtures remain under `.scratch/git-series-node-fixtures/`.
The checks cover identity selection, Git and CLI permission sets, minimum and
expanded permissions, per-owner installations for two accounts, repository selection for `gh`,
per-command token issuance, the missing-installation refusal, credential
restrictions, askpass execution, signature verification and PID, stream and
exit preservation for Git and `gh` launches. Real App authentication, native
tool inheritance, commit attribution and remote actor verification require
separate qualification.
