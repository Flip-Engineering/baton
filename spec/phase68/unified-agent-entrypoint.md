# Phase 68 — unified agent entrypoint and policy-derived defaults

Status: connection discovery, the single-source local help projection, deterministic non-adaptive
route resolution, bound change observation, and signal-owned recursive launcher shutdown are
implemented; adaptive policy derivation remains open below.

## UE1 — one ordinary invocation

The ordinary CLI entrypoint is objective-first:

```text
baton run "Improve Baton's export lifecycle" [--model MODEL --effort EFFORT]
```

The equivalent bound application surface is:

```text
baton.runs.start("Improve Baton's export lifecycle", { model: MODEL, effort: EFFORT })
```

`profile`, `harness`, repository scope, budgets, provider-turn limits, evidence and state
directories, export file/byte ceilings, verification output ceilings, and lifecycle ownership are
not required ordinary inputs. Exact harness/model/effort and narrower scope remain available as
advanced overrides. A caller that manually selects a model also selects its effort; Baton never
silently turns a model selection into the deployment's default effort. Existing exact invocations
remain compatible.

## UE2 — outer-to-inner default cascade

Defaults resolve from deployment authority toward the Run:

1. deployment selects its default profile and may separately declare an explicit adaptive route
   policy once that policy contract exists;
2. a manual request selects model and effort together, with harness as the required discriminator
   when that pair is ambiguous;
3. Baton never fills a missing effort from a global low/default route, and never guesses after an
   ambiguous match;
4. the selected profile supplies scope, verification, budgets, response bounds, export bounds, and
   cleanup policy; and
5. the Run outline reports the resolved profile/route and links to deeper policy detail without
   forcing it into the invocation.

A selected profile with one route gets an automatic safe default. An objective-only invocation of
a multi-route profile returns typed `application_route_ambiguous` until a separately declared
adaptive policy contract exists. A configured fixed route is descriptive deployment metadata, not
an adaptive policy, and cannot silently select an effort or harness. A manual selector always
contains model and effort together; if that pair matches more than one harness, the caller must also
provide the harness. Manual selection never uses a configured fixed route as a tie-breaker. Route
resolution may not select by map order, digest order, PATH order, or adapter accident.

## UE3 — limits stay authoritative but leave the ordinary surface

Finite limits remain mandatory protection against runaway provider spend, disk exhaustion,
unbounded event responses, hostile repositories, and archive expansion. They are deployment policy,
not routine agent decisions. Ordinary help does not teach callers to tune them. Advanced policy
inspection explains the current limits, their derivation, and the authorized override boundary.

Evidence roots, owner roots, credential paths, runtime scopes, temporary names, and export roots are
never Run arguments and never appear in ordinary help or output. Repository and connection discovery
belong to the client/deployment boundary.

## UE4 — cascading help and compatibility

Root help shows the objective-first invocation, `show`, `do`, and emergency `stop`. Deeper help
explains paired model and effort selection. Advanced routing help exposes profile, exact harness/model/effort,
scope, and policy administration. Compatibility commands lower to the same semantic registry and do
not duplicate lifecycle choreography. Root and contextual `--help` are parsed before connection
discovery, so neither form requires or reads a bearer credential. The packaged renderer preserves
the `application.help` semantic command while projecting local application, Run, action, and routing
outlines; authenticated `application.help` remains the shared authority for runtime policy detail.

The frozen application semantic registry owns CLI command IDs, usage, help-topic aliases, action
projections, and routing-selector rules. Credential-free local help is a pure projection of that
registry and therefore changes its shared digest. The parser consumes the same command topics and
paired model/effort selector rules; it does not maintain a second help or routing vocabulary.

## UE5 — first acceptance slice

1. CLI parsing accepts objective-only invocation and paired model/effort manual routing.
2. One-profile/one-route deployments resolve both omitted profile and omitted route; objective-only
   multi-route profiles return typed route ambiguity even when a fixed route is configured.
3. Manual model/effort resolution is exact; incomplete, unknown, or ambiguous routes are rejected,
   and an ambiguous pair requires harness rather than default-route tie breaking.
4. Explicit exact routing remains byte-for-byte compatible at the semantic intent boundary.
5. Application cards identify the deployment profile metadata and singleton-route availability
   without exposing budgets or filesystem paths or treating a fixed route as adaptive authority.
6. Root help contains no required profile, budget, evidence, owner-root, export-byte, or provider-turn
   argument.
7. The focused Phase 64 and Phase 67 suites remain green.
8. Every default operation and semantic action has a registry-backed local help projection, and
   drift tests reject unknown commands, topics, action mappings, or selector axes.

## UE6 — private repository and user connection discovery

Ordinary `run`, `show`, `do`, and `stop` discover one connection authority without connection
arguments or per-invocation environment setup. From the current directory Baton walks to the Git
repository, resolves a `.git` directory or linked-worktree `gitdir:` file, follows `commondir` when
present, and reads `baton/connection.json` from the Git common metadata directory. The selector is
therefore private Git metadata rather than a tracked or ignore-dependent working-tree file, and its
closed v1 schema contains only the repository ID and a user profile name. The selected user profile
is a closed v1 file below `$XDG_CONFIG_HOME/baton/connections` (falling back to
`~/.config/baton/connections`) and contains the URL, origin, and a token-file reference. An explicit
`XDG_CONFIG_HOME` must be absolute.

The user profile and bearer-token file are bounded regular non-symlink files, owned by the current
UID on platforms that expose owner UIDs, and have no group or other permission bits. Pre-open and
post-open file identities must agree. The bearer token exists only in the referenced token file;
Baton does not store it in repository configuration or the profile. Relative token references
resolve against the profile directory. Unknown fields, unsupported versions, unsafe files, missing
repository context, and incomplete authorities fail closed before transport without exposing bearer
content.

The four legacy environment variables remain one explicit compatibility authority only when all
are present. Baton never fills a partial environment authority from discovered files. Help remains
credential-free at the static root and for local Run/action topics; authenticated runtime policy
detail cascades through `application.help` only after an explicit non-help command needs connection
authority.

## UE7 — bound change observation and signal-owned shutdown

`BatonRun.changes({ signal })` is the ordinary change-aware observation surface. It is an async
iterable that emits the handle's current outline once, invokes only continuation descriptors
returned by the application, suppresses unchanged/replayed outlines using the bounded
server-provided `viewDigest` and `changed` fields, and ends when the application omits continuation.
Missing or invalid observation identity fails closed. Its closed option surface contains only an
optional `AbortSignal`. Aborting the signal ends observation; it does not issue `run.stop`, cancel
the Run, or synthesize continuation coordinates.

The recursive evidence runner uses this iterable instead of caller-owned continuation loops and
writes only concise semantic phase/progress transitions to its terminal. If `work_completed`
precedes the `adopt_result` action, it consumes the provided continuation until adoption is offered;
other terminal failure or stop phases end that wait immediately. `SignalLifecycleOwner` owns
`SIGHUP` alongside `SIGINT` and `SIGTERM` until the operation and authoritative application shutdown
both settle. Repeated signals remain admitted without replacing the first trigger or preempting
exact process, worktree, and branch reaping. The recursive runner maps the first owned `SIGHUP` to
conventional exit status 129.

Run progress is server-authoritative and receives the selected profile's review policy mode. When
that mode is `none`, `semantic_review` is complete with the truthful detail `Review not required by
selected profile`; `work_completed` alone never makes it active. A mechanically verified accepted
result is therefore `result:active`, making adoption the current next step. Required review retains
its active, blocked, failed, and completed semantics. Concise runners only project these stages and
do not recreate review lifecycle rules.

Later slices add adaptive policy derivation. The bound `baton.runs` resource handle and recursive
launcher migration are implemented.
