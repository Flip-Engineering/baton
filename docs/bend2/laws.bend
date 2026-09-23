# CLAIM: two M-5 obligations and one M-10 obligation are stated over pure
# example functions. examples/laws-proof.bend supplies their proofs.
# Approval: all 16 operative entries at 1fab9a1d, operator authorization
# relayed in the bend2-laws-lead4 brief; final Codex review r9.1 APPROVED.
# Actual application proofs remain open for all 16 entries; see laws-trace.md.
# Reference: reference/README.md, bend 2.0.25, a4952426.
# Evidence: examples/laws-check.evidence.md.
import Base
import ./examples/laws-history-model.bend as History
import ./examples/laws-worker-model.bend as Worker

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
