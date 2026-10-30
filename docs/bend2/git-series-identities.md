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

For a credential request to `github.com/OWNER/NAME`, the default `git` profile
looks up the App installation of the account
`OWNER` with `GET /repos/OWNER/NAME/installation`, using the App JWT. It then
mints an installation access token for that installation. The token request
specifies `contents:write`, `pull_requests:write` and `metadata:read` permissions and no
repository restriction, so it carries the repositories that the account granted
the App. Each account owner has its own installation. Adding the App to another
owner requires no change to the registry or the helper.

For this profile, the public identity, installation and issued token must include those three
minimum permissions. Additional grants, including `workflows:write` and
`actions:read`, are accepted. The token request keeps the three Git permissions.
A missing or weaker required permission produces a refusal naming its level.

An unresolved installation produces a refusal naming the App slug and the
requested owner.

Renamed owners and repositories resolve through GitHub's canonical numeric
repository identity. A 301 installation response can select
`https://api.github.com/repositories/ID/installation`. When the old installation
URL returns 404, the helper reads the App's installations and tries their tokens
one at a time to resolve the old repository's metadata. The first successful
lookup supplies the canonical repository ID and owner. A metadata redirect
must be a 301 to `https://api.github.com/repositories/ID`, with numeric `ID`.
These metadata tokens remain in memory and serve only that lookup.

The helper fetches the canonical installation with its App JWT and verifies
the App, permissions, suspension state and canonical owner before issuing the
command's token. Other redirect hosts and paths are refused. App identity and
token-issuance requests refuse redirects. If every installation reports the
repository missing, the refusal names the requested App and owner.

## GitHub CLI access

The launcher adds `git-series-bin/gh` to the child `PATH` and supplies the
selected registry and series to the wrapper. The wrapper resolves the target
repository from `-R` or `--repo`, then `GH_REPO`, then the GitHub `origin`
remote. It looks up that repository owner's App installation for every command
and gives the real `gh` process a fresh `GH_TOKEN`. It removes an inherited
`GITHUB_TOKEN` from that process environment.

The CLI token requires `contents:write`, `pull_requests:write`, `metadata:read`,
`issues:write`, `actions:read`, `checks:read` and `statuses:read`. The token
request omits the `permissions` field, so GitHub returns the installation's full
permission grant. The token can access every repository selected for that App
installation. Git credential requests continue to use the three-permission
subset described above. [GitHub's installation-token API](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app)
documents these token permissions.

## GitHub App permissions

Set the CLI permissions on each series App in **Settings > Developer settings >
GitHub Apps > Permissions & events**:

| Series | App |
| --- | --- |
| GPT | [Flip Baton - GPT](https://github.com/apps/flip-baton-gpt) |
| Muse | [Flip Baton - Muse](https://github.com/apps/flip-baton-muse) |
| DeepSeek | [Flip Baton - DeepSeek](https://github.com/apps/flip-baton-deepseek) |
| Claude | [Flip Baton - Claude](https://github.com/apps/flip-baton-claude) |
| GLM | [Flip Baton - GLM](https://github.com/apps/flip-baton-glm) |
| Kimi | [Flip Baton - Kimi](https://github.com/apps/flip-baton-kimi) |

| Repository permission | Level | Seat operation |
| --- | --- | --- |
| Contents | Read and write | Git pushes and repository contents |
| Pull requests | Read and write | Read and create pull requests |
| Metadata | Read-only | Repository metadata |
| Issues | Read and write | Read issues and post comments |
| Actions | Read-only | Read workflow runs and logs |
| Checks | Read-only | Read check runs and annotations |
| Commit statuses | Read-only | Read commit status contexts |
| Workflows | Read and write | Push changes under `.github/workflows` with the `workflow-write` profile |

When permissions are added to an App, each installation owner must approve the
updated grant before the installation receives it. Approve changes for each
account where the App is installed. [GitHub documents App permission
updates](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration#about-changes-to-permissions).

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
origin is not a GitHub URL passes no repository selection. In the default `git`
profile the selection is the repository for a credential request that carries no
path. Every request that names a repository uses that repository's owner
installation, so a launch selected for one repository can push to another
repository the App is installed on. The `workflow-write` profile restricts
credentials to its selected repository.

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

The check resolves the model and, when a repository is supplied, verifies the
selected App installation for that repository. It exits 0 when both checks
succeed and refuses otherwise. An unavailable repository refusal names the
repository, App and account checked, with GitHub's HTTP response cause.
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

## Workflow maintenance

`--profile workflow-write` requests `contents:write`, `pull_requests:write`,
`metadata:read` and `workflows:write` for one repository. The `launch`, `check`
and `helper` commands require `--repository OWNER/REPO` with this profile.
The selected exact model, App and commit attribution follow the configured
registry. The launcher carries the profile and repository into its Git
credential command.

The selected public identity's `github.permissions` must include
`workflows:write`. The credential helper also checks the App registration,
the repository owner's installation and the issued token for all four grants.
Permission refusals name the required level and its source. With a repository,
`check` and credential issuance both verify the repository owner's App
installation and required permissions.

The token request includes `repositories: ["REPO"]` and the four permissions.
The helper verifies that GitHub returns a selected token covering exactly
`OWNER/REPO` and accepts credential requests only for that repository.
[GitHub's installation-token API](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app)
supports repository and permission selection. The default `git` profile keeps
its three-permission request.

If the App registration needs the Workflows permission, its owner sets
**Repository permissions > Workflows > Read and write**. The installation's
account owner approves that change. GitHub retains the prior installation
grant until the owner accepts the update. Record the approved permission in
the selected public identity before using this profile.
[GitHub's Git access requirements](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app#choosing-permissions-for-git-access)
describe the Workflows grant for `.github/workflows` files.

For an approved workflow publication, select the profile explicitly:

```sh
node "$GIT_SERIES" launch --registry "$REGISTRY" --model-key MODEL \
  --repository OWNER/REPO --profile workflow-write -- \
  git push https://github.com/OWNER/REPO.git HEAD:refs/heads/BRANCH
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
global Git configuration. An absent registry or an actor with no recorded model
keeps the inherited environment. Verify source commit, landed commit and
authenticated push actor separately. Conductor review, selected landing checks and
repository protection provide review authority.

## Publication routes

`baton push --repo PATH --branch BRANCH --remote REMOTE` is the maintained
publication command. A seat and an operator shell run the same command.

| Route | Series identity and credential helper |
| --- | --- |
| `start`, `receiver`, `configure` | Endpoint embeds `git-series.mjs launch` with the recipient's model and the assignment's repository. |
| `dispatch-turn` and detached turns | Launch embeds the same prefix. |
| Retained launch for a resumed or continued native session | Prefix carries the recorded model and no `--repository`. |
| Native tool calls inside a launched seat | Inherit the helper through `GIT_CONFIG_*`, `GIT_ASKPASS` and the author variables. |
| `baton push`, `land`, `land-checked` with `BATON_SESSION` | Re-enter through the launcher with the actor's model and its workspace's repository. |
| `baton push` without `BATON_SESSION` | Uses the session recorded with `PATH` as its workspace, preferring the one on `BRANCH`, and continues as above. |
| Direct `git push` in a shell outside every route above | The shell has no credential helper. Git asks for a username on a terminal and fails with `could not read Username` when none exists. |

An operator wrap-up shell records no `BATON_SESSION`. For a recorded session
checkout, `baton push` recovers the model and repository from the session
database and the registry from `BATON2_GIT_REGISTRY` or the default registry
path. The operator supplies the checkout path, branch and remote. A checkout with no
recorded session needs `BATON_SESSION` set to a session whose model the registry
maps, or an explicit launch:

```sh
node "$GIT_SERIES" launch --registry "$REGISTRY" --model-key MODEL \
  --repository OWNER/REPO -- git -C PATH push REMOTE BRANCH
```

A rejected `baton push` answers `{"status":"rejected","reason":...,"identity":...}`.
The `identity` field states one of three conditions:

- `series identity applied`: the helper ran. A `Series Git operation refused`
  line on standard error then names the registry, installation or permission
  cause. A refusal that names a missing `issues:write` or other permission
  concerns the App installation and its owner's approval. The operator approves
  that change on GitHub.
- `no series identity: BATON_SESSION is unset and no recorded session has this
  checkout as its workspace`: the process had no launch context and none could
  be recovered. Set `BATON_SESSION` or use the explicit launch above.
- `no series identity for session ID`: the session has no recorded model, the
  registry does not map it, or no registry exists at the configured path.
  Correct the model mapping or create the registry.

The helper process runs for each Git credential request and mints a new
installation token, so no stored token expires between pushes.

## Validation

Run the controlled fixtures with `node --test bend2/test/git-series.mjs`. They
use invented public metadata, a generated signing key, API response doubles and
a controlled Node child. Fixtures remain under `.scratch/git-series-node-fixtures/`.
The checks cover identity selection, repository-bound workflow credentials,
per-owner installations for two accounts, the
missing-installation refusal, credential restrictions, askpass execution, signature verification and PID, stream and
exit preservation. Real App authentication, native tool inheritance, commit
attribution and remote actor verification require separate qualification.
