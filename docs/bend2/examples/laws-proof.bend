# CLAIM: the quantified M-5 history, M-10 worker and M-14 refusal model
# obligations check. Actual application laws remain open as recorded in
# ../laws-trace.md.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-check.evidence.md.
import Base
import ../laws.bend as Laws
import ../examples/laws-history-model.bend as History
import ../examples/laws-refusal-model.bend as Refusal

def Laws.m5_prior_reviews(history, row):
  match history:
    case Nil{}: {==}
    case h <> t:
      %Laws.m5_prior_reviews(t, row) : {h <> History.prefix(History.length(t), History.append_review(t, row)) == h <> _ : +List<History.Review>}
      {==}

def Laws.m5_appended_review(history, row):
  match history:
    case Nil{}: {==}
    case h <> t:
      Laws.m5_appended_review(t, row)

def Laws.m10_worker_admitted(mt, bf):
  {==}

def Laws.m14_field_matches_row(k, c):
  match k:
    case Refusal.UnknownField{}: {==}
    case Refusal.ClosedSet{}: {==}
    case Refusal.RequiredField{}: {==}
    case Refusal.IdentityKeyed{}: {==}
    case Refusal.ShaUnresolved{}: {==}
    case Refusal.PublishUndeclared{}: {==}

def Laws.m14_rule_matches_row(k, c):
  match k:
    case Refusal.UnknownField{}: {==}
    case Refusal.ClosedSet{}: {==}
    case Refusal.RequiredField{}: {==}
    case Refusal.IdentityKeyed{}: {==}
    case Refusal.ShaUnresolved{}: {==}
    case Refusal.PublishUndeclared{}: {==}

def Laws.m14_remedy_from_row(k):
  match k:
    case Refusal.UnknownField{}: {==}
    case Refusal.ClosedSet{}: {==}
    case Refusal.RequiredField{}: {==}
    case Refusal.IdentityKeyed{}: {==}
    case Refusal.ShaUnresolved{}: {==}
    case Refusal.PublishUndeclared{}: {==}

def Laws.m14_context_redacted(k, s):
  match k:
    case Refusal.UnknownField{}: {==}
    case Refusal.ClosedSet{}: {==}
    case Refusal.RequiredField{}: {==}
    case Refusal.IdentityKeyed{}: {==}
    case Refusal.ShaUnresolved{}: {==}
    case Refusal.PublishUndeclared{}: {==}

def Laws.m18_dispatch_targets_declared_remote(r):
  {==}

def Laws.m18_undeclared_refuses():
  {==}

def Laws.m18_declared_does_not_refuse(r):
  {==}

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("M-5 reviews, M-10 worker admission, M-14 refusal rows and M-18 landing decision: model proofs checked.")
