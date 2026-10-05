# CLAIM: reference identity, expansion admission and classification
# preservation for the native semantic context feature
# (docs/bend2/semantic-context-spec.md, "Results, classifications and
# references").
#
# A reference id is a canonical JSON array serialized as a string, for example
# ["source","/work/a.ts","<sha256>",40,17,"definition"]. It is built and
# compared as one string; no caller splits a reference on punctuation. The
# leading tag names the selector family, not a new public subject kind: a
# reference is expandable only when its stored selector kind is one of the
# supported subject kinds and its stored projections admit the requested ones.
#
# Expansion admission is a pure decision over the recorded reference, its
# snapshot applicability, its required effects and the requested projections.
# It refuses an unknown id, a stale or historical snapshot (returning the fresh
# selector), a reference whose revalidation failed, a missing effect grant and
# a projection outside the stored selector, and it does so before any caller
# effect. Expansion preserves the original classification: the weaker of the
# inherited and produced classifications is the answer, so a fact cannot gain
# a stronger classification through expansion.

import Base
import ../json/canonical.bend as J
import ./engines.bend as Eng
import ./snapshot.bend as Snap

# --- reference id construction ----------------------------------------------
type RefPart is Data:
  Rt{value: String}
  Rn{value: U32}
  Rz{}

def part_text(p: RefPart) -> String:
  match p:
    case Rt{value}: J.string_literal(value)
    case Rn{value}: U32.show(value)
    case Rz{}: "null"

def part_texts(xs: List<RefPart>) -> List<String>:
  match xs:
    case Nil{}: Nil{}
    case h <> t: part_text(h) <> part_texts(t)

# Comma-joined text with no trailing separator.
def join_go(xs: List<String>, +sep: String, first: Bool) -> String:
  match xs:
    case Nil{}: ""
    case +h <> t: Bool.pick(String, first, h, sep ++ h) ++ join_go(t, sep, False{})

def encode(parts: List<RefPart>) -> String:
  "[" ++ join_go(part_texts(parts), ",", True{}) ++ "]"

# A source selection: the family tag, the file, its digest and the
# zero-based line, the UTF-16 column and the projection.
def source_ref(+path: String, +sha256: String, line: U32, column: U32, +projection: String) -> String:
  encode([Rt{"source"}, Rt{path}, Rt{sha256}, Rn{line}, Rn{column}, Rt{projection}])

# A runtime selection: the family tag, the owned runtime, the adapter, the
# thread, the integration epoch, the mutation generation, the value kind and
# the handle. PID alone is not identity.
#
# The epoch and mutation generation are the exact decimal text of monotone
# lifetime counters, never a value truncated or wrapped to U32: two different
# lifetimes must not produce equal text, and a wrapped counter would re-admit a
# stale reference. The caller supplies the canonical decimal token (no sign, no
# leading zero, no fraction) under closed validation.
def runtime_ref(+runtime: String, +adapter: String, +thread: String, +epoch: String, +mutation: String, +kind: String, +handle: String) -> String:
  encode([Rt{"runtime"}, Rt{runtime}, Rt{adapter}, Rt{thread}, Rt{epoch}, Rt{mutation}, Rt{kind}, Rt{handle}])

# --- the stored reference ----------------------------------------------------
# The producer emits a full subject selector object (for an entity subject:
# {kind:entity, database, schema, name}). The retained record preserves that
# selector as its exact canonical text, and carries the kind the owned subject
# validation derived from it, so core admits on the kind without parsing or
# matching selector text and without losing the selector's own evidence. The
# policy is the identity of the policy the reference was created under; the
# current request alone cannot establish it.
type RefRecord is Data:
  Ref{id: String, engine: String, subject_kind: String, selector: String, snapshot_id: String, policy: String, projections: Eng.SS}

def ref_id(r: RefRecord) -> String:
  match r:
    case Ref{id, engine, subject_kind, selector, snapshot_id, policy, projections}: id

def ref_engine(r: RefRecord) -> String:
  match r:
    case Ref{id, engine, subject_kind, selector, snapshot_id, policy, projections}: engine

def ref_subject_kind(r: RefRecord) -> String:
  match r:
    case Ref{id, engine, subject_kind, selector, snapshot_id, policy, projections}: subject_kind

def ref_selector(r: RefRecord) -> String:
  match r:
    case Ref{id, engine, subject_kind, selector, snapshot_id, policy, projections}: selector

def ref_snapshot(r: RefRecord) -> String:
  match r:
    case Ref{id, engine, subject_kind, selector, snapshot_id, policy, projections}: snapshot_id

def ref_policy(r: RefRecord) -> String:
  match r:
    case Ref{id, engine, subject_kind, selector, snapshot_id, policy, projections}: policy

def ref_projections(r: RefRecord) -> Eng.SS:
  match r:
    case Ref{id, engine, subject_kind, selector, snapshot_id, policy, projections}: projections

# --- expansion admission -----------------------------------------------------
type RefQuery is Data:
  RQ{known: Bool, stored_kind: String, stored_policy: String, policy: String,
     stored: Eng.SS, requested: Eng.SS, applicability: Snap.Applies,
     required: Eng.SS, granted: Eng.SS, fresh: String}

def rq_known(q: RefQuery) -> Bool:
  match q:
    case RQ{known, stored_kind, stored_policy, policy, stored, requested, applicability, required, granted, fresh}: known

def rq_stored_kind(q: RefQuery) -> String:
  match q:
    case RQ{known, stored_kind, stored_policy, policy, stored, requested, applicability, required, granted, fresh}: stored_kind

def rq_stored_policy(q: RefQuery) -> String:
  match q:
    case RQ{known, stored_kind, stored_policy, policy, stored, requested, applicability, required, granted, fresh}: stored_policy

def rq_policy(q: RefQuery) -> String:
  match q:
    case RQ{known, stored_kind, stored_policy, policy, stored, requested, applicability, required, granted, fresh}: policy

def rq_stored(q: RefQuery) -> Eng.SS:
  match q:
    case RQ{known, stored_kind, stored_policy, policy, stored, requested, applicability, required, granted, fresh}: stored

def rq_requested(q: RefQuery) -> Eng.SS:
  match q:
    case RQ{known, stored_kind, stored_policy, policy, stored, requested, applicability, required, granted, fresh}: requested

def rq_applicability(q: RefQuery) -> Snap.Applies:
  match q:
    case RQ{known, stored_kind, stored_policy, policy, stored, requested, applicability, required, granted, fresh}: applicability

def rq_required(q: RefQuery) -> Eng.SS:
  match q:
    case RQ{known, stored_kind, stored_policy, policy, stored, requested, applicability, required, granted, fresh}: required

def rq_granted(q: RefQuery) -> Eng.SS:
  match q:
    case RQ{known, stored_kind, stored_policy, policy, stored, requested, applicability, required, granted, fresh}: granted

def rq_fresh(q: RefQuery) -> String:
  match q:
    case RQ{known, stored_kind, stored_policy, policy, stored, requested, applicability, required, granted, fresh}: fresh

type RefDecision is Data:
  RAllow{projections: Eng.SS}
  RUnknownId{}
  RUnverified{reason: String}
  RStaleRef{fresh: String}
  REffectMissing{effect: String}
  RProjectionRefused{projection: String}
  RSubjectRefused{kind: String}
  RPolicyRefused{stored: String, current: String}

# The fixed refusal condition each decision carries; "ok" admits expansion.
def condition(d: RefDecision) -> String:
  match d:
    case RAllow{projections}: "ok"
    case RUnknownId{}: "unknownReference"
    case RUnverified{reason}: "unverifiedReference"
    case RStaleRef{fresh}: "staleReference"
    case REffectMissing{effect}: "effectNotGranted"
    case RProjectionRefused{projection}: "projectionRefused"
    case RSubjectRefused{kind}: "subjectRefused"
    case RPolicyRefused{stored, current}: "refPolicyMismatch"

# The supported subject kinds a stored referenced selector can name.
def supported_subject(+kind: String) -> Bool:
  Bool.or(String.eq(kind, "position"),
  Bool.or(String.eq(kind, "symbol"),
  Bool.or(String.eq(kind, "diagnostic"),
  Bool.or(String.eq(kind, "entity"),
  Bool.or(String.eq(kind, "model"),
  Bool.or(String.eq(kind, "schema"),
  Bool.or(String.eq(kind, "security"),
  Bool.or(String.eq(kind, "migration"),
  Bool.or(String.eq(kind, "program"),
  Bool.or(String.eq(kind, "dataset"),
         String.eq(kind, "runtime")))))))))))

# The first requested projection the stored selector does not admit.
def first_outside(+stored: Eng.SS, requested: Eng.SS) -> Eng.SS:
  match requested:
    case Eng.SSNil{}: Eng.SSNil{}
    case Eng.SSCons{+h, r}:
      Bool.pick(Eng.SS, Eng.ss_member(stored, h), first_outside(stored, r), Eng.ss_one(h))

def projection_decision(outside: Eng.SS, requested: Eng.SS) -> RefDecision:
  match outside:
    case Eng.SSNil{}: RAllow{requested}
    case Eng.SSCons{h, r}: RProjectionRefused{h}

def admit_projections(+q: RefQuery) -> RefDecision:
  projection_decision(first_outside(rq_stored(q), rq_requested(q)), rq_requested(q))

def approve(+q: RefQuery) -> Eng.Effects:
  Eng.missing_effects(rq_required(q), rq_granted(q))

def admit_effect(m: Eng.Effects, q: RefQuery) -> RefDecision:
  match m:
    case Eng.FxGranted{}: admit_projections(q)
    case Eng.FxMissing{effect}: REffectMissing{effect}

def admit_applicability(a: Snap.Applies, +q: RefQuery) -> RefDecision:
  match a:
    case Snap.ACurrent{}: admit_effect(approve(q), q)
    case Snap.AStale{changed}: RStaleRef{rq_fresh(q)}
    case Snap.AHistorical{reason}: RStaleRef{rq_fresh(q)}
    case Snap.AUnknown{reason}: RUnverified{reason}

def admit_policy(+q: RefQuery) -> RefDecision:
  Bool.pick(RefDecision, String.eq(rq_stored_policy(q), rq_policy(q)), admit_applicability(rq_applicability(q), q),
    RPolicyRefused{rq_stored_policy(q), rq_policy(q)})

def admit_known(+q: RefQuery) -> RefDecision:
  Bool.pick(RefDecision, supported_subject(rq_stored_kind(q)), admit_policy(q),
    RSubjectRefused{rq_stored_kind(q)})

def admit(+q: RefQuery) -> RefDecision:
  Bool.pick(RefDecision, rq_known(q), admit_known(q), RUnknownId{})

# --- classification preservation ---------------------------------------------
type Classification is Data:
  CObserved{}
  CChecked{}
  CStaticPossible{}
  CDeclared{}

# Evidential strength: an observation is strongest, a compiler oracle verdict
# next, a resolved static relationship next, an authored declaration weakest.
def strength(c: Classification) -> U32:
  match c:
    case CObserved{}: 3
    case CChecked{}: 2
    case CStaticPossible{}: 1
    case CDeclared{}: 0

def weaker(+a: Classification, +b: Classification) -> Classification:
  Bool.pick(Classification, U32.is_le(strength(a), strength(b)), a, b)
