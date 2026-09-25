# CLAIM: two M-5 obligations, one M-10 obligation, four M-14 obligations and three
# M-18 decision obligations are stated over pure example functions;
# examples/laws-proof.bend supplies their proofs. The revision 11 and 12 statements the
# operator adopted on 2026-09-25 are carried by the example modules imported below; each
# of those modules states and proves its own obligations, so importing it discharges them
# here. Those entries stay proposed and are not part of the operative set.
# Approval: all 16 operative entries at 1fab9a1d, operator authorization
# relayed in the bend2-laws-lead4 brief; final Codex review r9.1 APPROVED.
# Actual application proofs remain open for all 16 entries; see laws-trace.md.
# Reference: reference/README.md, bend 2.0.25, a4952426.
# Evidence: examples/laws-check.evidence.md.
import Base
import ./examples/laws-history-model.bend as History
import ./examples/laws-worker-model.bend as Worker
import ./examples/laws-refusal-model.bend as Refusal
import ./examples/laws-decision-model.bend as Decision
import ./examples/laws-no-ledger.bend as NoLedger
import ./examples/laws-no-ceiling.bend as NoCeiling
import ./examples/laws-derived-catalog.bend as DerivedCatalog
import ./examples/laws-orchestrator-authority.bend as OrchestratorAuthority
import ./examples/laws-annotation-independence.bend as AnnotationIndependence
import ./examples/laws-prerequisite-enabling.bend as PrerequisiteEnabling

# M-5: every prior review row, including identity, author, artifact, basis
# and decision, is preserved in order by this model transition.
law m5_prior_reviews:
  for +history: +List<History.Review>
  for row: History.Review
  {History.prefix(History.length(history), History.append_review(history, row)) == history : +List<History.Review>}

# M-5: the model appends exactly the new accepted row. This obligation
# rejects an implementation that preserves history by dropping the new row.
law m5_appended_review:
  for +history: +List<History.Review>
  for +row: History.Review
  {History.suffix(History.length(history), History.append_review(history, row)) == [row] : +List<History.Review>}

# M-10: the recovered worker-admission lemma, restricted to this pure model.
# The two booleans model verify memory pressure and available verify bytes.
law m10_worker_admitted:
  for mt: Bool
  for bf: Bool
  {Worker.room_for(Worker.Worker{}, mt, bf) == True{} : Bool}

# M-14: a refusal's field is the failed check's own vocabulary row's field.
law m14_field_matches_row:
  for +k: Refusal.Check
  for c: Refusal.Context
  {Refusal.field_of(Refusal.explain(k, c)) == Refusal.table_field(k) : Refusal.Field}

# M-14: a refusal's rule is the failed check's own vocabulary row's rule. One
# table serves the validator and the explanation, so the two cannot disagree.
law m14_rule_matches_row:
  for +k: Refusal.Check
  for c: Refusal.Context
  {Refusal.rule_of(Refusal.explain(k, c)) == Refusal.table_rule(k) : Refusal.Rule}

# M-14: the remedy is composed from the same row, which is what holds a remedy
# to the values the row admits.
law m14_remedy_from_row:
  for +k: Refusal.Check
  {Refusal.remedy_of(Refusal.explain(k, Refusal.Safe{0n})) == Refusal.table_rem(k) : Refusal.Remedy}

# M-14: the rendered context carries no secret material.
law m14_context_redacted:
  for +k: Refusal.Check
  for s: Nat
  {Refusal.context_of(Refusal.explain(k, Refusal.WithSecret{s})) == 0n : Nat}

# M-18: a declared deployment dispatches to exactly the remote it declares, so no
# inferred or substituted destination can appear.
law m18_dispatch_targets_declared_remote:
  for r: Nat
  {Decision.target_of(Decision.decide(Decision.Declared{r})) == r : Nat}

# M-18: an undeclared deployment refuses with the undeclared code, which is the
# behavior a real landing has (#558).
law m18_undeclared_refuses:
  {Decision.code_of(Decision.decide(Decision.Undeclared{})) == Decision.undeclared_code() : Nat}

# M-18: a declared deployment's outcome carries no refusal code, so the decision
# cannot refuse a landing that has a destination.
law m18_declared_does_not_refuse:
  for r: Nat
  {Decision.code_of(Decision.decide(Decision.Declared{r})) == 0n : Nat}
