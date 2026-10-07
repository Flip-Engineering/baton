# Phase 85 generic reduce live dogfood

This evidence set used Baton's concise application API to review Baton with two concurrent exact
Codex routes (`gpt-5.6-sol` high and xhigh). Both Attempts produced independently verified
Candidates and found no concrete defect in the bounded generic reduce dispatch slice.

`evidence-codex.json` records exact requested/resolved route identity, two accepted Candidates, and
the terminal cleanup receipt: two processes observed, two closed, zero remaining workers, and a
closed deployment. `review.md` is the selected xhigh Candidate note.

The preceding `evidence.json` is also intentionally retained: an exact Kimi Code `k3` high route
was refused before Run creation with `authentication_refresh_required`, after which the deployment
closed with zero workers. Baton did not silently substitute a harness or model.

