# Attempt 6 — exact model, unsuitable reasoning policy

The post-fix run acknowledged both native steers and preserved the bounded terminal grace, but
`gpt-5.4` at `high` reasoning emitted another large hidden-reasoning tail after the verified file.
It reached 557,475 cumulative tokens against 500,000 and produced no terminal frame within the
2-second grace, so Baton correctly killed and reaped it.

The next attempt keeps exact model `gpt-5.4` but selects `medium` reasoning and a 300,000 ceiling.
Harness and model remain independent orchestrator choices; reasoning tier is a separate native
policy axis rather than an excuse for silent model fallback.
