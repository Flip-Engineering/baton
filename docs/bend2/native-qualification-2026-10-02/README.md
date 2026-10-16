# Native qualification, 2 October 2026

The frozen hierarchy helper passed on published runtime `204972f7dba9b0f84e445e5c308b79cd5c8ec7a3`. A subscription Codex root, Kimi lead, DeepSeek worker and Muse worker completed initial concurrent work, native steering, review corrections and both checked-landing levels. All 25 native invocations and their wrappers exited 0. One external operator review task contributed to completion.

The isolated target is `5a9cdfd0d822578902be85b1095746cdc0128702`. Its tree `26f65cfccf5d09f0b51074c926e4c511ac7959b4` equals the reviewed lead tree at `81e5ac3b9b467c6826e9a21e74b688587e57ed67`. This record covers the isolated checked landing. The [earlier matched comparison](../native-workflow-comparison-2026-10-02/README.md) retains both failed complete predicates.

## Work and review

DeepSeek added an ordered recruitment/endpoint retry regression in `bend2/test/recruit.py`. Muse wrote `docs/bend2/examples/worker-assignment-recovery.md`. Both used the selected recruitment and connection suites for checked landing. Native review inspected the documentation's command order, stored assignment and receipt claims.

The initial children overlapped for **182.471 seconds**. Kimi observed active DeepSeek tool work and issued actual guidance; the native steer response records success. Each seat retained its original native identity across later invocations.

Codex independently requested the first documentation correction. The operator later sent `operator-doc-receipt-review` through the registered root endpoint; root acknowledged and forwarded it to the lead. This was one explicit external review-assistance task. Muse completed four correction invocations. Two ordinary squash conflicts retained their receipts; subsequent corrections landed successfully. The [summary](summary.json) lists every original and correction landing with its actual status and commit.

The root reviewed and checked landed the final lead. The helper completed its frozen assertions naturally in **1,691.917 seconds**. Its retained evidence has SHA256 `0cf42f185de26f35f884211d83ca45dd79c26f914d77e85dbcaae3e1a434bc36`.

## Source and gates

The runtime and task base were `204972f7`. The coordinator binary has SHA256 `e9374848831ccdb233839215c84ab6d1f1ee84a39a8fd2a601d2758f55987da8`. The compiler was Bend 2.0.25; executable and installed core-library hashes are retained by the freeze. The helper source, imported helper, native executables, requested routes and task bodies have separate pins.

Before publication and native launch, that exact source passed:

- Native build: exit 0, 18.944 seconds.
- Law gate: 361 laws, 87 implementation mutations, 449 compiles and zero failures, 1,624.104 seconds.
- Native checks: 232 Python tests in 22 suites and two Bend suites, 150.118 seconds.

The gate summary has SHA256 `0d10978773788a537bf70a361e4b285f740b8d59b016f9684d73e7e2b596460b`. Those gates apply to the frozen pre-run source. The delivered test and documentation changes need validation when composed into the publication tree.

## Native identities and usage

| Seat | Requested model | Observed model | Invocations | Summed child duration |
| --- | --- | --- | ---: | ---: |
| Root | `gpt-6-astra`, low | Not exposed by Codex exec events | 10 | 426.166 s |
| Lead | `kimi-code/k3`, high | `kimi-code/k3` | 9 | 1,053.327 s |
| DeepSeek | `deepseek/deepseek-flash`, low | `deepseek/deepseek-flash` | 1 | 197.868 s |
| Muse | `muse-spark-1.3-contributor`, low | `muse-spark-1.3-contributor` | 5 | 475.961 s |

The Codex preflight confirmed ChatGPT subscription login, and the launcher removed `OPENAI_API_KEY` and `CODEX_API_KEY`. OMP `get_state` and Muse native model events exposed their observed models. Effort values in the table are requested values.

Codex's latest cumulative counters contain 1,885,675 input tokens and 6,021 output tokens, including 1,798,400 cached input tokens and 351 reasoning output tokens. The final counter is counted once for its native identity across resumes. A retained native-rollout check found 34 `token_count` events: the latest `total_token_usage` is 1,891,696 tokens and its component fields match the final CLI counter exactly. The latest `last_token_usage` is 81,521 tokens. Only the rollout hash and extracted counters are published. OMP assistant `message_end` counters total 4,176,397 tokens for Kimi and 2,674,597 for DeepSeek; terminal/history copies are excluded. Kimi emitted zero cost; DeepSeek emitted USD 0.069348048. These fields are not billing receipts. Muse usage and cost remain unknown.

Child duration sums include overlapping processes. This run supports no causal speed, cost or maintainability comparison and no broad release-readiness conclusion.

## Closure and retained evidence

After helper completion, the root checked 54 recorded observer, seed, launcher, wrapper and native PIDs; none remained. All 25 wrapper/native exit pairs were 0. The closure receipt has SHA256 `862b7c9cb397648a2c8c49035617841c537f981b2b3384f4744ae64d29113041`. A separate process-table check found no host-visible command path containing the exact run directory; its receipt is included in the manifest.

The operator then acknowledged `hierarchy-complete` with `reviewed-success` through the ordinary coordinator. That receipt has SHA256 `c5542b5b2f9039b64dc761c9fe1231bf25ecedeb2405fe68a10dc60c63190270`. It records database hashes before and after acknowledgment. The completed helper evidence and original process records remain unchanged.

The [artifact manifest](artifact-manifest.json) records local paths, byte sizes and hashes. Raw native frames, task bodies, command streams and authentication context remain in the retained worktree under `.scratch/native-release-qualification-run-204972f7` and its preparation directory. This portable directory contains measured metadata and hashes only. The [summary](summary.json) includes native identities, usage, requested/observed route distinctions, landing results and explicit limits.
