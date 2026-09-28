# CLAIM: the operative laws whose real functions live in bend2/src/replay, each stated over the
# function that implements it and proved beside its claim. The coordinator laws module imports
# this module, and the coordinator entry imports that, so every compile of the entry verifies
# every law here.
#
# Policies: docs/bend2/laws-proposed.md. Reference: docs/bend2/reference/README.md, bend 2.0.25.
import Base
import ./basis.bend as Basis
import ./cursor.bend as Cursor

# ---------------------------------------------------------------------------
# M-7: no unvalidated assertion acquires authority or established attribution.
# The authorization basis is checked against the one the record admits; a
# changed basis is refused and classified, whatever the row claims.

law m7_changed_basis_is_refused:
  for +rowSeq: U32
  {Basis.judge_basis(True{}, rowSeq) == Basis.Refused{"authorization_basis_changed", False{}, U32.sub(rowSeq, 1)} : Basis.Verdict}

def m7_changed_basis_is_refused(rowSeq):
  {==}

# ---------------------------------------------------------------------------
# M-8: no effect beyond valid authority. The decision consults the basis the
# record admits rather than the basis the row carries: an admitted basis must
# equal the recorded one, and the effect rechecks it.

law m8_basis_check_is_reached:
  for +basis: String
  for +rowSeq: U32
  {Basis.judge_integrity(False{}, basis, rowSeq) == Basis.judge_basis(String.eq(basis, "changed"), rowSeq) : Basis.Verdict}

def m8_basis_check_is_reached(basis, rowSeq):
  {==}

law m8_invalid_payload_is_refused_with_its_own_class:
  for +basis: String
  for +rowSeq: U32
  {Basis.judge_integrity(True{}, basis, rowSeq) == Basis.Refused{"invalid_payload", False{}, U32.sub(rowSeq, 1)} : Basis.Verdict}

def m8_invalid_payload_is_refused_with_its_own_class(basis, rowSeq):
  {==}

# An admitted basis leaves the row sequence as it stands: the effect carries no
# number of its own.
law m8_admitted_carries_the_observed_sequence:
  for +rowSeq: U32
  {Basis.judge_basis(False{}, rowSeq) == Basis.Admitted{rowSeq} : Basis.Verdict}

def m8_admitted_carries_the_observed_sequence(rowSeq):
  {==}

# ---------------------------------------------------------------------------
# M-5: accepted facts, identities, ordering and owed events survive recovery,
# compaction, replay and delivery. A restart under a basis the record no
# longer admits rebuilds the projection from the ledger, and the cursor the
# consumer resumes from and the delivery it is still owed are unchanged.

law m5_stale_basis_rebuilds_from_ledger:
  for +name: String
  for +rows: U32
  for +readerCursor: U32
  {Cursor.source_of(False{}) == "ledger_fallback" : String}

def m5_stale_basis_rebuilds_from_ledger(name, rows, readerCursor):
  {==}

law m5_stale_basis_is_classified:
  for +name: String
  for +rows: U32
  for +readerCursor: U32
  {Cursor.checkpoint_of(False{}) == "stale_authority" : String}

def m5_stale_basis_is_classified(name, rows, readerCursor):
  {==}

law m5_admitted_basis_uses_checkpoint:
  for +name: String
  for +rows: U32
  for +readerCursor: U32
  {Cursor.source_of(True{}) == "checkpoint" : String}

def m5_admitted_basis_uses_checkpoint(name, rows, readerCursor):
  {==}

law m5_owed_is_named_at_restart:
  for +same: Bool
  for +name: String
  for +rows: U32
  for +readerCursor: U32
  {Cursor.render_restart(same, name, rows, readerCursor) == "RESULT|" ++ name ++ "|source=" ++ Cursor.source_of(same) ++ "|checkpoint=" ++ Cursor.checkpoint_of(same) ++ "|cursor=" ++ U32.show(rows) ++ "|owed=" ++ U32.show(U32.sub(rows, readerCursor)) ++ "" : String}

def m5_owed_is_named_at_restart(same, name, rows, readerCursor):
  {==}
