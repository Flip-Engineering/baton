# 20 — Adaptive Routing (continual, recency-biased)

*A supporting element of the fleet driver: how the driver decides which worker (vendor + model) to send a task to. Your requirement: it must learn **continually** and lean hard on **recent** performance, because a new model release makes yesterday's "vendor X is bad at Y" stale overnight. Plain language, no jargon.*

## What routing is, and why the obvious version rots

Routing = the driver's answer to "who should do this task?" The obvious version is a win/loss tally per vendor: "Codex passed 8 of 10 auth-refactor tasks, Claude 9 of 10 → send auth refactors to Claude." That version **rots** for a specific reason you named: the day Codex ships a new model, those 10 results describe a model that no longer exists, and the tally keeps voting with dead evidence forever. A router that can't forget is worse than no router, because it confidently sends work to the wrong place based on history that expired.

## The five rules that fix it

**1. Track by *model version*, not by vendor.** The unit is `(model-version, task-type)` — e.g. `(codex-2025-11, "auth-refactor")` — not `(codex, "auth-refactor")`. When a new Codex ships, it's a **new bucket**; the old model's record doesn't contaminate it. Vendors are just families of model versions.

**2. Let recent results outweigh old ones — always.** Every past result is weighted by how recent it is, and old results fade automatically (an exponential decay — a result from last week counts, one from three months ago barely registers). So the router keeps a *rolling, decaying* success rate, never a lifetime total. Even within one model version, recent behavior dominates. This is the core of "continual + recency-biased": the table is always current because it is always forgetting.

**3. Be optimistic about new models (the recency bias, made concrete).** When a new model version appears with no track record, don't treat it as unknown-and-risky (that would starve it and keep routing to the old winner). Instead: (a) give it a **soft prior** from its predecessor — a new Codex is probably at least as good as the old Codex, so it starts with a discounted version of that record rather than blank; and (b) give it an **exploration bonus** — the driver deliberately sends it some tasks to gather fresh evidence quickly. The working assumption in a fast-moving field is *newer is likely better*, so the router leans toward trying the latest, not toward the incumbent.

**4. Balance "use what works" against "try the promising new one" automatically.** This is a well-understood problem (a "multi-armed bandit"). Keep it simple: for each candidate, combine its recent success rate with an uncertainty bonus that's larger for models with less recent data (i.e. new ones). Pick the highest combined score. This naturally exploits proven models for routine work while continually probing new ones — and because of rules 2 and 3, it tilts toward recency without you hand-tuning it.

**5. Count only *verified* wins.** A task counts as a success for a model only if the driver re-ran the check itself and it passed — never the worker's self-report. This ties routing's honesty to the verification support element: the router learns from ground truth, not from workers grading themselves.

## What it looks like in practice

- Each `(model-version, task-type)` keeps: a decayed success rate, a decayed count (how much recent evidence), and the timestamp of last use.
- On a new task: score every eligible model = `recent-success-rate + exploration-bonus`, where the bonus grows with staleness/newness; route to the top score (respecting concurrency limits — a busy model is skipped).
- When a result comes back (verified): update that bucket with recency weighting.
- When a new model version is first seen: seed it from its predecessor's bucket (discounted) + a fresh exploration bonus.
- Operator overrides sit on top: "always try the newest model first for X," or "exclude this model," or "pin Y for now."

## Honest limits (don't over-build this)

- **At low volume it's weak.** With a handful of tasks the signal is noisy; early on the router's real job is just "try the new models and don't lock onto a stale winner," which rules 2–4 already deliver. Value grows with volume.
- **Task-type is a judgment call.** "auth-refactor" vs "add-tests" vs "bug-fix" is a coarse bucketing; too fine and every bucket is empty, too coarse and it's useless. Start coarse (a handful of types), let it split only if the data supports it. Don't build a taxonomy up front.
- **This is a support feature, not the product.** It makes the driver *smarter about dispatch*; it doesn't drive anything by itself. Ship the driver first with round-robin or a hand-set default, and turn on adaptive routing once there's enough verified history for it to matter.

## Where it lives

Part of the driver's coordination layer (the reliable program underneath). It reads verified outcomes from the event log and writes the decaying stats back there, so the whole thing is replayable and you can see *why* the driver routed the way it did. If the core is built in Elixir/OTP (doc 17), this is a small stateful process that any part of the driver can query.
