# Phase 84 Context successor-wave review

## High — settlement-ready recovery does not prove exact result, route, or cleanup authority

CM84-W7 interrupts `settleContextMapCall` after descendant cleanup and confirms only that the call is `settlement_ready`, every child is unowned, restart makes no additional provider call, the recovered outline is `completed`, exactly one `context.call_settled` event exists, and that event reports `cleanup.remainingCount === 0`.

Those assertions allow recovery to settle the call with substituted or incomplete truth. The test never compares the recovered partition results, child routes, or partition/task/worker identities with their pre-interruption values. It also does not validate the settlement event's authority, cleanup target set, target digest, receipt counts, or receipt digest. A recovery path could therefore lose or replace a child result or route, or attach an unrelated cleanup receipt whose remaining count happens to be zero, while CM84-W7 still passes.

The adjacent failed-stop case demonstrates the missing standard: CM84-W6 snapshots every descendant identity, checks the durable stop target set, validates the cleanup receipt and digest, and then proves that reap preserved the task/worker/Run bindings. Settlement-ready recovery needs the corresponding success-path assertions: snapshot the call's partition order, exact route, retained results, descendant bindings, and cleanup authority before restart; compare all of them with the recovered outline and `context.call_settled` payload; then restart once more to prove that neither provider effects nor settlement/cleanup events repeat.

Until that is covered, Phase 84 does not establish exact route, result, and cleanup truth across the reap-to-settlement crash window.
