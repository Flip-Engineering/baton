# CLAIM: a stated law separates history preservation from list shape. The same
# add_review obligation is stated as a concrete equality over [1, 2] plus 3,
# and the implementation here appends, so the law checks. The discarding
# implementation from lang-cap-history.bend fails the same law with expected
# [1, 2, 3], observed [3] (recorded in the evidence file as a scratch
# variant). The concrete form is a checkable mechanism; the law that binds
# Baton2 must take the quantified form over every history.
#
# Evidence: lang-cap-history-law.evidence.md.

import Base

def add_review(history: List<U32>, r: U32) -> List<U32>:
  match history:
    case Nil{}:
      [r]
    case h <> t:
      h <> add_review(t, r)

law add_review_keeps_history:
  {add_review([1, 2], 3) == [1, 2, 3] : List<U32>}

def add_review_keeps_history():
  {==}
