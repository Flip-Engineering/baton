# Remote qualification: models-domain package discriminators

Owner: `semantic-impl-models-package-critic`. All execution runs on admitted
remote runners. The Linux result never substitutes for the distinct Darwin
qualification. This file pins the source identities and the exact commands;
the runtime evidence contract is complete argv, exit status, signal, and full
stdout/stderr bytes for every process.

## Immutable inputs

- Critic source pin: the `bend2/tests/context-models-package-critic/` commit
  of this worktree (reported in the parent message; verify with
  `git rev-parse HEAD` and `git status --porcelain` before running).
- Models provider source under test: commit `e53cbce6c5e46f0c5e914ed32bf41a9db628238f`
  (tree `0d6067802d0bc36e4e2cff700927a153950cb821`) or the explicitly named
  successor whose adapters and staged payload the run composes.
- Package owner staging: commit `de52b61024098c8784df1378d0d7cdb0e79d2dfd`
  lineage (`stage_context_sources` plus the context gate), or its named
  successor. The staged payload root must contain
  `libexec/baton2/context/{catalogs,models}/*` and
  `libexec/baton2/context/node_modules/<pkg>` extracted from the
  lockfile-verified tarballs.
- Exact Node 22.15.0 runtime.
  - Darwin arm64 tarball `node-v22.15.0-darwin-arm64.tar.gz`
    SHA256 `92eb58f54d172ed9dee320b8450f1390db629d4262c936d5c074b25a110fed02`
    (verified against the official SHASUMS256.txt with its release-key
    signature; provenance in the critic probes directory
    `node22/PROVENANCE-2.json`).
  - Linux arm64 tarball `node-v22.15.0-linux-arm64.tar.gz`
    SHA256 `c3582722db988ed1eaefd590b877b86aaace65f68746726c1f8c79d26e5cc7de`,
    from the same verified SHASUMS256.txt. The runner verifies the downloaded
    tarball against this pinned hash before extraction; no runtime download
    happens on the operator laptop.
- Real Zod 4.3.6 for target-project fixtures: the npm tarball named by the
  pinned lockfile entry (`zod@4.3.6`, integrity verified on the runner), or
  the conductor-designated extracted copy with its SHA256 recorded in the
  run evidence.

## Remote Linux runner (baton2-native-homelab, group 4)

```sh
# 1. Exact runtime
curl -fsSLO https://nodejs.org/dist/v22.15.0/node-v22.15.0-linux-arm64.tar.gz
echo 'c3582722db988ed1eaefd590b877b86aaace65f68746726c1f8c79d26e5cc7de  node-v22.15.0-linux-arm64.tar.gz' | sha256sum -c -
tar -xzf node-v22.15.0-linux-arm64.tar.gz
NODE22=$PWD/node-v22.15.0-linux-arm64/bin/node
"$NODE22" --version   # expect v22.15.0

# 2. Source pins
git -C <critic-worktree> rev-parse HEAD          # critic pin above
git -C <models-worktree> rev-parse HEAD          # provider pin above
git -C <package-worktree> rev-parse HEAD         # package pin above

# 3. Source-level discriminators (no staged payload yet)
node <critic-worktree>/bend2/tests/context-models-package-critic/run.mjs \
  --node22 "$NODE22" \
  --node22-sha256 <sha256 of the runner node binary> \
  --context-dir <models-worktree>/bend2/context \
  --work <scratch>/critic-work --out <scratch>/critic-work/report-source.json
# expected: node-floor pass; dependency-pins pass when the owner manifest and
# lockfile are committed in that tree; psql-prereq pass with 14.18;
# payload checks gate-open (exit 3 overall until a payload is supplied).

# 4. Staged payload discriminators (after the package owner's staged build)
node <critic-worktree>/bend2/tests/context-models-package-critic/run.mjs \
  --node22 "$NODE22" \
  --context-dir <models-worktree>/bend2/context \
  --staged-dir <payload-root> \
  --real-zod <dir-with-zod-4.3.6> \
  --work <scratch>/critic-work --out <scratch>/critic-work/report-payload.json
# expected: ancestor-isolation pass (bundled 8.17.1 only, poison never loads,
# missing-bundle control refuses); useful-results pass (actual validate/admit/
# validateSchema verdicts); target-zod pass (4.3.7 refuses before import with
# marker empty; 4.3.6 returns real issues, output value, serialization text).
# exit 0 only when every gate is closed and passing.
```

Host-Node differential (records facts, no floor assertions):

```sh
node <critic-worktree>/bend2/tests/context-models-package-critic/run.mjs \
  --floor-host-only --work <scratch>/critic-work \
  --out <scratch>/critic-work/report-host.json
```

## Remote Darwin qualification (distinct)

Same commands with the Darwin arm64 tarball and its pinned SHA256
`92eb58f54d172ed9dee320b8450f1390db629d4262c936d5c074b25a110fed02`, the
conductor-designated executable
(`.../worktrees/semantic-impl-models/.scratch/toolchains/node22.15.0/bin/node`,
SHA256 `6a1137a572bc6648411bfe51032173a535e010576cad6da87547f414daa11fdb`)
being the already-extracted Darwin runtime. Darwin-specific facts recorded by
these checks (bundled SQLite engine identity, readOnly semantics, capability
absences) are Darwin acceptance evidence; a Linux run supplies none of them.

## Gate semantics

- exit 0: every gate closed and passing.
- exit 1: a discriminator failed (evidence in the report file).
- exit 3: a gate is open (artifact absent). An open gate is an honest pending
  state, never acceptance.
- A staged payload produced by an unverified staging path is itself a failed
  gate: run the package owner's context gate first and record its receipts.

## Evidence retention

Keep the report JSON files, every check's one-line JSON status, and for each
spawned process: argv, exit status, signal, stdin byte length, and complete
stdout/stderr. The runner writes this into `--out`; the checks embed their
child output in the status lines. Do not summarize away raw bytes.
