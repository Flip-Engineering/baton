# Series Git identities

`bend2/harness/git-series.mjs` is an optional process launcher and HTTPS
credential helper. It selects a GitHub App for GPT, Muse, DeepSeek, Claude,
GLM or Kimi. Commit author and committer names use the exact format
`Flip Baton - GPT`, `Flip Baton - Muse`, `Flip Baton - DeepSeek`,
`Flip Baton - Claude`, `Flip Baton - GLM` or `Flip Baton - Kimi`. Native
execution keeps its exact model identifier.

Current development archives install the helper at `PREFIX/libexec/baton2/git-series.mjs`
beside the Conductor adapters. Run that file with Node 22.15 or later on a POSIX
host. A source checkout uses `bend2/harness/git-series.mjs`. The Python source
remains a legacy reference. The immutable 1.0 archive carries the earlier Python
helper; its version-specific payload is described in [installation](installation.md).

The helper has no repository allowlist. For a credential request to
`github.com/OWNER/NAME`, the helper looks up the App installation of the account
`OWNER` with `GET /repos/OWNER/NAME/installation`, using the App JWT. It then
mints an installation access token for that installation. The token has
`contents:write`, `pull_requests:write` and `metadata:read` permissions and no
repository restriction, so it carries the repositories that the account granted
the App. Each account owner has its own installation. Adding the App to another
owner requires no change to the registry or the helper.

If the App is not installed for `OWNER`, the helper refuses with a message that
names the App slug and the owner. The helper does not fall back to another
installation.

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
The `github` identity selects the App, its signing key and the token
permissions. The helper finds the installation for each repository owner.

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

Inherited `GH_TOKEN` and `GITHUB_TOKEN` are cleared. GitHub CLI's stored login
and SSH push authentication have their own actors. Repository, worktree and
global Git configuration files remain unchanged.

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
The checks cover identity selection, per-owner installations for two accounts, the
missing-installation refusal, credential restrictions, askpass execution, signature verification and PID, stream and
exit preservation. Real App authentication, native tool inheritance, commit
attribution and remote actor verification require separate qualification.
