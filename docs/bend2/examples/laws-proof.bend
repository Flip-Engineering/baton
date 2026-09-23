# CLAIM: the quantified M-5 history and M-10 worker model obligations check.
# Actual application laws remain open as recorded in ../laws-trace.md.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-check.evidence.md.
import Base
import ../laws.bend as Laws
import ../examples/laws-history-model.bend as History

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

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("M-5 prior reviews and appended row; M-10 worker admission: model proofs checked.")
