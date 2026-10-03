# Series Git identities

`bend2/harness/git-series.mjs` is an optional process launcher and HTTPS
credential helper. It selects a GitHub App for GPT, Muse, DeepSeek, Claude,
GLM or Kimi. Commit author and committer names use the exact format
`Flip Baton - GPT`, `Flip Baton - Muse`, `Flip Baton - DeepSeek`,
`Flip Baton - Claude`, `Flip Baton - GLM` or `Flip Baton - Kimi`. Native
execution keeps its exact model identifier.

Native archives install the same helper at `PREFIX/libexec/baton2/git-series.mjs`
beside the Conductor adapters. Run that file with Node 22.15 or later on a POSIX
host. A source checkout uses `bend2/harness/git-series.mjs`. The Python source
remains a legacy reference.

The helper currently supports only `Flip-Engineering/baton`. Its App
installation and issued token must match that repository ID and the
`contents:write`, `pull_requests:write`, `metadata:read` permissions below.
This scope is specific to the current Baton setup.

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

Each public identity has this shape. Replace the unset GitHub values with
verified App, bot, installation and repository metadata before launch:

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
    "installationId": null,
    "repositoryFullName": "Flip-Engineering/baton",
    "repositoryId": null,
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
`Claude`, `GLM` or `Kimi`. The helper adds `Flip Baton - ` to that verified
label for commit names. GitHub controls the App account login's `[bot]` suffix;
the bot login, numeric ID, noreply email and authenticated actor stay unchanged.
The helper reads the fixed public filename and uses the adjacent key to sign
an RS256 App JWT with Node's built-in cryptography library.

## Model and series selection

Set `GIT_SERIES` to the helper's absolute installed or source path and `REGISTRY`
to the registry's absolute path. For an extracted native prefix, use
`GIT_SERIES="$PREFIX/libexec/baton2/git-series.mjs"`. A native wrapper binds the
exact execution model:

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

Each Player or Conductor's native launcher must select its own series, since
report delivery inherits the sender's environment. The launcher retains the
current PID, workspace and standard streams and replaces inherited author, committer, credential helper,
askpass and HTTP authorization headers within the child environment. It
preserves noncredential runtime Git settings. An MCP Conductor must launch its
server through the helper so its coordinator tools inherit the selected
identity. Standalone coordinator calls need the same explicit binding.

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
installation, permissions and token repository access before returning a
credential through Git's private helper pipe. JWTs and tokens remain in
process memory and are excluded from arguments, URLs, files and diagnostics.

Commit author and committer are editable commit metadata. The installation
token authenticates the HTTPS push as the selected App. Current checked
landing creates a squash commit under the reviewing Conductor's environment;
the retained Player commits keep their own attribution. Verify source commit,
landed commit and authenticated push actor separately. Conductor review,
selected landing checks and repository protection provide review authority.

## Validation

Run the controlled fixtures with `node --test bend2/test/git-series.mjs`. They
use invented public metadata, a generated signing key, API response doubles and
a controlled Node child. Fixtures remain under `.scratch/git-series-node-fixtures/`.
The checks cover identity selection, credential restrictions, signature
verification and PID, stream and exit preservation. Real App authentication,
native tool inheritance, commit attribution and remote actor verification
require separate qualification.
