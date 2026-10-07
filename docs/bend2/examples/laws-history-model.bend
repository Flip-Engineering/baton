# CLAIM: this pure review append model preserves each prior row and appends
# exactly the supplied row. The quantified obligations are in ../laws.bend.
# Scope: model only. Application imports and host storage conformance remain open.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-check.evidence.md.
import Base

type Decision is Data:
  Accept{}
  Reject{}
  Comment{}

type Review is Data:
  Row{id: Nat, author: Nat, artifact: Nat, basis: Nat, decision: Decision}

def append_review(history: +List<Review>, row: Review) -> +List<Review>:
  match history:
    case Nil{}: [row]
    case h <> t: h <> append_review(t, row)

def length(history: +List<Review>) -> Nat:
  match history:
    case Nil{}: 0n
    case h <> t: 1n+length(t)

def prefix(n: Nat, history: +List<Review>) -> +List<Review>:
  match n:
    case 0n: []
    case 1n+p:
      match history:
        case Nil{}: []
        case h <> t: h <> prefix(p, t)

def suffix(n: Nat, history: +List<Review>) -> +List<Review>:
  match n:
    case 0n: history
    case 1n+p:
      match history:
        case Nil{}: []
        case h <> t: suffix(p, t)
