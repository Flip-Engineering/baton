# ROW BRIEF — row-drain-restart: deployment.restart { drain: true } (#204 option a)

Deliverable: implementation + red-first pin suite.

## Anchors (re-verify at YOUR head)

- impl/src/application-deployment.mjs:1239 BatonDeployment — close() (the current hard
  path), host() (the resident publish), the #residentOptions seam.
- impl/scripts/baton.mjs serve branch (:99+) — the CLI surface where a restart verb would
  ride (or the resident's own command loop — follow the existing command admission shape).
- The quiescence machinery (#163 law): in-flight waves settle on member terminality —
  the drain WAITS on that, never on a clock.

## Contract (closed)

1. deployment.restart { drain: true }: (i) the deployment stops ADMITTING new waves
   (refusals name 'draining' with a typed code); (ii) in-flight waves settle via their own
   quiescence — the drain observes, never forces; (iii) on quiesce, the process re-execs
   itself on the same argv (the connection profile re-publishes; the incarnation advances);
   (iv) a second restart request during drain refuses typed (single drain).
2. The drain state is observable: doctor readiness carries draining:true with the in-flight
   count; an orchestrator holding the connection sees the transition (feeds #208's lane).
3. Operator safety: the verb requires the same authority class as emergency_stop.
4. Red-first pin impl/test/deployment-drain-restart-red.test.mjs: a deployment with one
   in-flight (fixture) wave + restart{drain} → admissions refuse draining, the wave settles
   on its fixture cadence, the re-exec occurs (spawn mock), the profile re-publishes with a
   new incarnation (RED at pre-change head: no such verb).

## Hard bounds

Additive; no clock-based drain timeout (quiescence only); no module hot-reload; batteries green.
