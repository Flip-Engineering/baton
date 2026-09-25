# bend2/src/replay/projection.bend — the ledger-projection fold of the Bend2 source tree.
#
# CLAIM: the fold below reads the decoded ledger stream of Contract A and prints the roster
# projection of Contract B: one line per swarm in ascending byte order of its swarmId, that
# swarm's participant lines behind it in ascending byte order of their participantId, and one
# total line after the last block, with every count derived from the stream rows alone.
# Serves: M-5 (the accepted facts the projection carries — the identities and the event counts —
# are the ones the rows state, in the row order the stream supplies), M-11 (a stream row that does
# not decode refuses by name instead of contributing a fabricated count) and M-14 (the refusal
# names the rule that failed and the seq it was seen at). Contract rows: CS-01 (the emitted kind
# set is closed: a kind outside the eight refuses with unknown_event_kind) and migration rule 3
# (a refusal stops the fold at its own row and retains every row before it). No ARCH-CLOSE row
# names this corpus.
# Fixture: inline, `corpus()` below — twelve cases: complete rows covering all eight kinds, a row
# split across two chunks, a row left unterminated at end of input, and the decoder's four
# refusals (unknown_event_kind for a ninth kind; malformed_row for a blank line, for a sixth
# field, and for a seq that is not decimal). No external file is read in check mode.
# Modes: with no command-line argument the module runs the check mode of the module protocol over
# the inline corpus and prints one RESULT line per case, behind a MODE line naming the mode. With
# a path argument it runs the stream mode of Contract C: it reads that Contract A stream and
# prints the Contract B projection and nothing else, exiting 1 through IO.die when a row refuses.
# Pin: bend 2.0.25, bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868.
# Not promoted from a docs/bend2 example: this module is new for the Phase 1 shadow core
# (work-bend2-phase1-shadow-core, swarm-bend2-20260924). Its two contracts are Contract A (the
# decoded stream) and Contract B (the projection) of that batch's brief. bend2/scripts/
# ledger-stream.mjs writes the stream Contract A describes, and bend2/scripts/
# resident-fold-baseline.mjs is the JS arm this projection is compared against byte for byte.

import Base

# ==============================================================================================
# Types
# ==============================================================================================

# The eight kinds Contract A emits. KOther is the ninth case: Contract A never writes such a kind,
# and the fold refuses a stream that carries one rather than counting a row nothing defines.
type RowKind is Data:
  KJoined{}
  KLeft{}
  KContribution{}
  KReview{}
  KIntegrated{}
  KWork{}
  KAssignment{}
  KClosed{}
  KOther{}

# One row of the classifier's table: a kind's name and the kind itself.
type Named is Data:
  Named{name: String, kind: RowKind}

# A table row's test result: whether the name is that row's, and the kind it names.
type Pick is Data:
  Pick{flag: Bool, kind: RowKind}

# A stream row that decoded. The five fields are Contract A's, in Contract A's order.
type Row is Data:
  Row{seq: U32, kind: RowKind, swarm: String, part: String, decision: String}

# The decoder's verdict on one row's field list: the row, or the rule that failed. `at` is the seq
# the refusal names; it is 0 when the seq field itself could not be read.
type Decoded is Data:
  Good{row: Row}
  Bad{code: String, at: U32}

# The fold state.
#   recs   the rows read and folded, newest first
#   n      how many rows folded; a row that refuses is not folded and does not count
#   head   the largest seq that folded, 0 when none folded
#   code   the refusal code of the first row that failed to decode, "" while the stream is clean
#   at     the seq that refusal names, 0 when it could not be read
#   fields the finished fields of the row being assembled, newest first
#   buf    the field being assembled, reversed
type State is Data:
  State{
    recs: List<&2, Row>, n: U32, head: U32, code: String, at: U32,
    fields: List<&2, String>, buf: String,
  }

# What one read of the stream left behind: the file, the fold state after that read's chunk, and
# whether that read reached end of input (it returned no byte). A read that failed carries the
# failure instead, so the loop never has to unpack the read itself. A Step carries a File, which
# is a Type and not a Data, so the record is a Type too.
type Step is Type:
  Step{file: File, st: State}
  End{file: File, st: State}
  StepErr{file: File, code: U32, msg: String}

# One check case: the name, the stream fragments fed in order (a fragment may end mid-row), the
# projection lines the fold must print, and — for a refusal case — the code it must refuse with.
type Case is Data:
  Case{name: String, chunks: List<&2, String>, expect: List<&2, String>, code: String}

# ==============================================================================================
# Contract A: the kind of a row
# ==============================================================================================

def kind_pick_on(flag: Bool, kind: RowKind, rest: RowKind) -> RowKind:
  match flag:
    case True{}: kind
    case False{}: rest

# The first flag that holds names a kind; no flag holding is KOther.
def kind_pick(picks: List<&2, Pick>) -> RowKind:
  match picks:
    case Nil{}: KOther{}
    case h <> t:
      match h:
        case Pick{f, k}: kind_pick_on(f, k, kind_pick(t))

# One flag per table row: whether the name is that row's.
def kind_flags(+name: String, table: List<&2, Named>) -> List<&2, Pick>:
  match table:
    case Nil{}: []
    case h <> t:
      match h:
        case Named{n, k}: Pick{String.eq(name, n), k} <> kind_flags(name, t)

# The eight kind names Contract A writes, each with the kind it names.
def kind_table() -> List<&2, Named>:
  [
    Named{"swarm.participant_joined", KJoined{}},
    Named{"swarm.participant_left", KLeft{}},
    Named{"swarm.contribution_recorded", KContribution{}},
    Named{"swarm.contribution_reviewed", KReview{}},
    Named{"swarm.contribution_integrated", KIntegrated{}},
    Named{"swarm.work_updated", KWork{}},
    Named{"swarm.assignment_updated", KAssignment{}},
    Named{"swarm.closed", KClosed{}},
  ]

def kind_of(name: String) -> RowKind:
  kind_pick(kind_flags(name, kind_table()))

# A row whose kind is not one of the eight is unknown_event_kind, which is the branch Contract A
# leaves open by never writing such a row.
def row_kind(seq: U32, kind: RowKind, swarm: String, part: String, decision: String) -> Decoded:
  match kind:
    case KOther{}: Bad{"unknown_event_kind", seq}
    case KJoined{}: Good{Row{seq, KJoined{}, swarm, part, decision}}
    case KLeft{}: Good{Row{seq, KLeft{}, swarm, part, decision}}
    case KContribution{}: Good{Row{seq, KContribution{}, swarm, part, decision}}
    case KReview{}: Good{Row{seq, KReview{}, swarm, part, decision}}
    case KIntegrated{}: Good{Row{seq, KIntegrated{}, swarm, part, decision}}
    case KWork{}: Good{Row{seq, KWork{}, swarm, part, decision}}
    case KAssignment{}: Good{Row{seq, KAssignment{}, swarm, part, decision}}
    case KClosed{}: Good{Row{seq, KClosed{}, swarm, part, decision}}

def seq_row(m: Maybe<&2, U32>, k: String, s: String, p: String, d: String) -> Decoded:
  match m:
    case None{}: Bad{"malformed_row", 0}
    case Some{value}: row_kind(value, kind_of(k), s, p, d)

# The assembler prepends finished fields, so the list arrives reversed and the pattern reads it
# back to front: decision, participant, swarm, kind, seq. Exactly five fields fold; any other
# count is malformed_row, which is how a tab or a newline inside a field shows up here.
def decoded_of(fields: List<&2, String>) -> Decoded:
  match fields:
    case d <> p <> s <> k <> q <> Nil{}: seq_row(U32.read(q), k, s, p, d)
    case _: Bad{"malformed_row", 0}

# ==============================================================================================
# The fold: one pass over the stream, one character at a time
# ==============================================================================================

def state_new() -> State:
  State{Nil{}, 0, 0, "", 0, Nil{}, SNil{}}

def char_push(+c: Char, st: State) -> State:
  match st:
    case State{recs, n, head, code, at, fields, buf}:
      State{recs, n, head, code, at, fields, SCon{c, buf}}

# A tab ends the current field: the reversed buffer becomes the next field of the row.
def field_end(st: State) -> State:
  match st:
    case State{recs, n, head, code, at, fields, buf}:
      State{recs, n, head, code, at, String.reverse(buf) <> fields, SNil{}}

def row_fold(row: Row, recs: List<&2, Row>, n: U32, head: U32) -> State:
  match row:
    case Row{seq, kind, swarm, part, decision}:
      +s = seq
      State{Row{s, kind, swarm, part, decision} <> recs, U32.inc(n), U32.max(head, s), "", 0, Nil{}, SNil{}}

def row_decided(dec: Decoded, recs: List<&2, Row>, n: U32, head: U32, at: U32) -> State:
  match dec:
    case Good{row}: row_fold(row, recs, n, head)
    case Bad{c, s}: State{recs, n, head, c, s, Nil{}, SNil{}}

# A refused stream keeps its first refusal: the fold ignores every row after it and the assembler
# stays empty, so the state records the rule and the seq of the row that failed first.
def row_take_on(clean: Bool, dec: Decoded, recs: List<&2, Row>, n: U32, head: U32, code: String, at: U32) -> State:
  match clean:
    case False{}: State{recs, n, head, code, at, Nil{}, SNil{}}
    case True{}: row_decided(dec, recs, n, head, at)

def row_take(dec: Decoded, recs: List<&2, Row>, n: U32, head: U32, code: String, at: U32) -> State:
  +c = code
  row_take_on(String.is_empty(c), dec, recs, n, head, c, at)

# A newline ends the row: its field list is decoded and folded, and the assembler restarts.
def row_end(st: State) -> State:
  match st:
    case State{recs, n, head, code, at, fields, buf}:
      row_take(decoded_of(String.reverse(buf) <> fields), recs, n, head, code, at)

def char_step_nl(is_nl: Bool, +c: Char, st: State) -> State:
  match is_nl:
    case True{}: row_end(st)
    case False{}: char_push(c, st)

def char_step_on(is_tab: Bool, is_nl: Bool, +c: Char, st: State) -> State:
  match is_tab:
    case True{}: field_end(st)
    case False{}: char_step_nl(is_nl, c, st)

def char_step(h: Char, st: State) -> State:
  +c = h
  char_step_on(Char.is_eq(c, '\t'), Char.is_eq(c, '\n'), c, st)

# Fold one text fragment into the state. A fragment may end mid-row: the assembler keeps the
# partial row, so the next fragment continues it, and a boundary inside any field is harmless.
def feed(text: String, st: State) -> State:
  match text:
    case SNil{}: st
    case SCon{h, t}: feed(t, char_step(h, st))

def flush_empty(empty: Bool, pending: List<&2, String>, recs: List<&2, Row>, n: U32, head: U32, code: String, at: U32) -> State:
  match empty:
    case True{}: State{recs, n, head, code, at, Nil{}, SNil{}}
    case False{}: row_take(decoded_of(pending), recs, n, head, code, at)

def flush_any(none: Bool, fields: List<&2, String>, buf: String, recs: List<&2, Row>, n: U32, head: U32, code: String, at: U32) -> State:
  match none:
    case True{}: State{recs, n, head, code, at, Nil{}, SNil{}}
    case False{}: flush_empty(False{}, String.reverse(buf) <> fields, recs, n, head, code, at)

def flush_none(no_fields: Bool, no_buf: Bool, fields: List<&2, String>, buf: String, recs: List<&2, Row>, n: U32, head: U32, code: String, at: U32) -> State:
  flush_any(Bool.and(no_fields, no_buf), fields, buf, recs, n, head, code, at)

# End of input: a row still in the assembler is a row the stream ended without a newline behind,
# and it folds like any other — including a row whose last field is empty. The assembler holds
# nothing when neither a finished field nor a started one is waiting, which is the tail a
# terminating newline leaves.
def flush(st: State) -> State:
  match st:
    case State{recs, n, head, code, at, fields, buf}:
      +fs = fields
      +b = buf
      flush_none(List.is_empty(&2, String, fs), String.is_empty(b), fs, b, recs, n, head, code, at)

# ==============================================================================================
# Contract B: the projection
# ==============================================================================================

# The nine counts of one swarm, in Contract B's field order.
type Counts is Data:
  Counts{
    joined: U32, left: U32, contrib: U32, accept: U32, review: U32,
    integrated: U32, work: U32, assign: U32, closed: U32,
  }

# One participant row of one swarm: the id, and whether a leave row named it.
type Part is Data:
  Part{pid: String, left: Bool}

# What one pass over a swarm's rows collects.
type Totals is Data:
  Totals{counts: Counts, parts: List<&2, Part>}

def id_le(a: String, b: String) -> Bool:
  String.is_le(a, b)

def swarm_added(have: Bool, +i: String, acc: List<&2, String>) -> List<&2, String>:
  match have:
    case True{}: acc
    case False{}: i <> acc

def swarm_add(id: String, acc: List<&2, String>) -> List<&2, String>:
  +i = id
  +a = acc
  swarm_added(List.contains(~String, ~String.eq, a, i), i, a)

def swarm_ids(recs: List<&2, Row>, acc: List<&2, String>) -> List<&2, String>:
  match recs:
    case Nil{}: acc
    case h <> t:
      match h:
        case Row{seq, kind, swarm, part, decision}:
          swarm_ids(t, swarm_add(swarm, acc))

# Every swarmId the stream carries, ascending; "-" is an id like any other, because Contract B's
# swarm line takes the field the stream wrote.
def swarm_ids_sorted(recs: List<&2, Row>) -> List<&2, String>:
  List.sort(~String, ~id_le, swarm_ids(recs, Nil{}))

def counts_empty() -> Counts:
  Counts{0, 0, 0, 0, 0, 0, 0, 0, 0}

# One more row of each kind: the deltas are added to the nine counts.
def counts_added(c: Counts, dj: U32, dl: U32, dc: U32, da: U32, dr: U32, di: U32, dw: U32, ds: U32, dcl: U32) -> Counts:
  match c:
    case Counts{j, l, cb, ac, rv, ig, w, asg, cl}:
      Counts{
        U32.add(j, dj), U32.add(l, dl), U32.add(cb, dc), U32.add(ac, da), U32.add(rv, dr),
        U32.add(ig, di), U32.add(w, dw), U32.add(asg, ds), U32.add(cl, dcl),
      }

def counts_review_on(is_accept: Bool, c: Counts) -> Counts:
  match is_accept:
    case True{}: counts_added(c, 0, 0, 0, 1, 1, 0, 0, 0, 0)
    case False{}: counts_added(c, 0, 0, 0, 0, 1, 0, 0, 0, 0)

# A review counts once whatever its decision, and counts as an accept only when the decision says
# accept; a decision outside the three the decoder writes is not an accept.
def counts_review(decision: String, c: Counts) -> Counts:
  counts_review_on(String.eq(decision, "accept"), c)

# One row's contribution to its swarm's counts.
def counts_row(kind: RowKind, decision: String, c: Counts) -> Counts:
  match kind:
    case KJoined{}: counts_added(c, 1, 0, 0, 0, 0, 0, 0, 0, 0)
    case KLeft{}: counts_added(c, 0, 1, 0, 0, 0, 0, 0, 0, 0)
    case KContribution{}: counts_added(c, 0, 0, 1, 0, 0, 0, 0, 0, 0)
    case KReview{}: counts_review(decision, c)
    case KIntegrated{}: counts_added(c, 0, 0, 0, 0, 0, 1, 0, 0, 0)
    case KWork{}: counts_added(c, 0, 0, 0, 0, 0, 0, 1, 0, 0)
    case KAssignment{}: counts_added(c, 0, 0, 0, 0, 0, 0, 0, 1, 0)
    case KClosed{}: counts_added(c, 0, 0, 0, 0, 0, 0, 0, 0, 1)
    case KOther{}: c

# One row's participant entry: a leave row marks the participant, any other row of the swarm only
# enters the participant. The row's decision is not read here.
def part_kind(kind: RowKind, part: String, parts: List<&2, Part>) -> List<&2, Part>:
  match kind:
    case KLeft{}: Part{part, True{}} <> parts
    case KOther{}: parts
    case _: Part{part, False{}} <> parts

def part_dash(dashed: Bool, part: String, kind: RowKind, parts: List<&2, Part>) -> List<&2, Part>:
  match dashed:
    case True{}: parts
    case False{}: part_kind(kind, part, parts)

# A participantId of "-" is the row's absent field, and Contract B never prints it.
def part_row(part: String, kind: RowKind, parts: List<&2, Part>) -> List<&2, Part>:
  +p = part
  part_dash(String.eq(p, "-"), p, kind, parts)

# One row's counts, when the row belongs to this swarm.
def counts_mine(mine: Bool, kind: RowKind, decision: String, c: Counts) -> Counts:
  match mine:
    case False{}: c
    case True{}: counts_row(kind, decision, c)

# One row's participant entry, when the row belongs to this swarm.
def parts_mine(mine: Bool, part: String, kind: RowKind, parts: List<&2, Part>) -> List<&2, Part>:
  match mine:
    case False{}: parts
    case True{}: part_row(part, kind, parts)

# One pass over the stream for one swarm: its nine counts and its participant rows together, so a
# swarm's whole block costs one sweep of the rows rather than one sweep per count.
def swarm_sweep(+id: String, recs: List<&2, Row>, c: Counts, parts: List<&2, Part>) -> Totals:
  match recs:
    case Nil{}: Totals{c, parts}
    case h <> t:
      match h:
        case Row{seq, kind, swarm, part, dec}:
          +m = String.eq(swarm, id)
          +k = kind
          swarm_sweep(id, t, counts_mine(m, k, dec, c), parts_mine(m, part, k, parts))

def active_pick(enough: Bool, joined: U32, left: U32) -> U32:
  match enough:
    case True{}: U32.sub(joined, left)
    case False{}: 0

# active = joined - left, never below zero.
def active_on(joined: U32, left: U32) -> U32:
  +j = joined
  +l = left
  active_pick(U32.is_ge(j, l), j, l)

# One swarm's line, from the counts one pass collected.
def swarm_line(id: String, counts: Counts) -> String:
  match counts:
    case Counts{j, l, cb, ac, rv, ig, w, asg, cl}:
      +jj = j
      +ll = l
      String.concat([
        "swarm ", id,
        " joined=", U32.show(jj),
        " active=", U32.show(active_on(jj, ll)),
        " left=", U32.show(ll),
        " contrib=", U32.show(cb),
        " accept=", U32.show(ac),
        " review=", U32.show(rv),
        " integrated=", U32.show(ig),
        " work=", U32.show(w),
        " assign=", U32.show(asg),
        " closed=", U32.show(cl),
      ])

def parts_status(yes: Bool) -> String:
  match yes:
    case True{}: "left"
    case False{}: "active"

def part_status_on(hit: Bool, rest: Bool) -> Bool:
  match hit:
    case True{}: True{}
    case False{}: rest

# status=left when the participant has a swarm.participant_left row for this swarm. A left row
# anywhere in the stream settles the status, and nothing takes it back.
# The participant and its pairs are in this order so the self-call passes the participant
# unchanged and the pairs, the argument that shrinks, second.
def part_status(+pid: String, +pairs: List<&2, Part>) -> Bool:
  match pairs:
    case Nil{}: False{}
    case h <> t:
      match h:
        case Part{p, l}: part_status_on(Bool.and(String.eq(p, pid), l), part_status(pid, t))

def part_id_added(have: Bool, +p: String, acc: List<&2, String>) -> List<&2, String>:
  match have:
    case True{}: acc
    case False{}: p <> acc

def part_id_add(pid: String, acc: List<&2, String>) -> List<&2, String>:
  +p = pid
  +a = acc
  part_id_added(List.contains(~String, ~String.eq, a, p), p, a)

# The distinct participant ids of one swarm, newest first (the caller sorts them).
def part_ids(pairs: List<&2, Part>, acc: List<&2, String>) -> List<&2, String>:
  match pairs:
    case Nil{}: acc
    case h <> t:
      match h:
        case Part{p, l}: part_ids(t, part_id_add(p, acc))

# Every participantId of one swarm except "-", ascending.
def part_ids_sorted(pairs: List<&2, Part>) -> List<&2, String>:
  List.sort(~String, ~id_le, part_ids(pairs, Nil{}))

def part_line(id: String, part: String, left: Bool) -> String:
  String.concat(["participant ", id, " ", part, " status=", parts_status(left)])

# A swarm's block reversed: its participant lines behind its swarm line.
def part_block(ids: List<&2, String>, id: String, +pairs: List<&2, Part>, acc: List<&2, String>) -> List<&2, String>:
  match ids:
    case Nil{}: acc
    case p <> t:
      +i = id
      +pp = p
      part_block(t, i, pairs, part_line(i, pp, part_status(pp, pairs)) <> acc)

# One swarm's block reversed, from the totals one sweep collected.
def block_of(+id: String, totals: Totals) -> List<&2, String>:
  match totals:
    case Totals{counts, parts}:
      +ps = parts
      part_block(part_ids_sorted(ps), id, ps, [swarm_line(id, counts)])

def block_lines(+id: String, +recs: List<&2, Row>) -> List<&2, String>:
  +i = id
  block_of(i, swarm_sweep(i, recs, counts_empty(), Nil{}))

# Every swarm's block reversed, newest swarm first, which one reverse puts in stream order.
def body_lines(ids: List<&2, String>, +recs: List<&2, Row>, acc: List<&2, String>) -> List<&2, String>:
  match ids:
    case Nil{}: acc
    case id <> t:
      +i = id
      body_lines(t, recs, List.append(&2, String, block_lines(i, recs), acc))

# How many participant lines one swarm prints.
def parts_of_totals(totals: Totals) -> U32:
  match totals:
    case Totals{counts, parts}: U32.from_nat(List.length(&2, String, part_ids_sorted(parts)))

def parts_count(+id: String, +recs: List<&2, Row>) -> U32:
  +i = id
  parts_of_totals(swarm_sweep(i, recs, counts_empty(), Nil{}))

def parts_total(ids: List<&2, String>, +recs: List<&2, Row>) -> U32:
  match ids:
    case Nil{}: 0
    case id <> t: U32.add(parts_count(id, recs), parts_total(t, recs))

def total_line(ids: List<&2, String>, n: U32, head: U32, total: U32) -> String:
  String.concat([
    "total rows=", U32.show(n),
    " head=", U32.show(head),
    " swarms=", U32.show(U32.from_nat(List.length(&2, String, ids))),
    " participants=", U32.show(total),
  ])

# The projection text: one line per swarm with its participant lines behind it, then the total.
def render(+recs: List<&2, Row>, n: U32, head: U32) -> List<&2, String>:
  +ids = swarm_ids_sorted(recs)
  +blocks = body_lines(ids, recs, Nil{})
  List.append(&2, String,
    List.reverse(&2, String, blocks),
    [total_line(ids, n, head, parts_total(ids, recs))])

def print_lines(lines: List<&2, String>) -> IO(Unit):
  match lines:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        u : Unit <- IO.print(h)
        print_lines(t)

# ==============================================================================================
# Stream mode: read a Contract A stream and print the projection
# ==============================================================================================

def tf(b: Bool) -> String:
  match b:
    case True{}: "true"
    case False{}: "false"

def lines_eq(xs: List<&2, String>, ys: List<&2, String>) -> Bool:
  match xs ys:
    case Nil{} Nil{}: True{}
    case h <> t h2 <> t2: Bool.and(String.eq(h, h2), lines_eq(t, t2))
    case _ _: False{}

def step_ended(f: File, st: State) -> Step:
  End{f, st}

def step_more(empty: Bool, f: File, +c: String, st: State) -> Step:
  match empty:
    case True{}: step_ended(f, st)
    case False{}: Step{f, feed(c, st)}

# A read that returned no byte at all is end of input; any other chunk is folded into the state.
def step_chunk(f: File, chunk: String, st: State) -> Step:
  +c = chunk
  step_more(String.is_empty(c), f, c, st)

def step_failed(f: File, error: U32 & String) -> Step:
  (code, msg) = error
  StepErr{f, code, msg}

# Unpack one read: fold its chunk, or keep the failure for the loop to report. The read's own
# (File & Result) pair is unpacked here, in a def body, because a do block binds names only.
def step_of(m: File & Result<&1, &1, (U32 & String), String>, st: State) -> Step:
  (f, r) = m
  match r:
    case Done{value}: step_chunk(f, value, st)
    case Fail{error}: step_failed(f, error)

def fuel_of(size: U32) -> Nat:
  U32.to_nat(U32.add(U32.div(size, 1048576), 2))

def refuse(f: File, code: String, at: U32) -> IO(Unit):
  do IO<Unit>:
    c : Unit <- File.close(f)
    IO.die(Unit, 1, String.concat(["bend2 projection: ", code, " at seq ", U32.show(at)]))

def fail_read(f: File, code: U32, msg: String) -> IO(Unit):
  do IO<Unit>:
    c : Unit <- File.close(f)
    IO.die(Unit, 1, String.concat([
      "bend2 projection: read_failed(", U32.show(code), "): ", msg,
    ]))

def print_close(f: File, lines: List<&2, String>) -> IO(Unit):
  do IO<Unit>:
    u : Unit <- print_lines(lines)
    File.close(f)

def finish_on(clean: Bool, f: File, recs: List<&2, Row>, n: U32, head: U32, code: String, at: U32) -> IO(Unit):
  match clean:
    case True{}: print_close(f, render(recs, n, head))
    case False{}: refuse(f, code, at)

def finish_flushed(st: State, f: File) -> IO(Unit):
  match st:
    case State{recs, n, head, code, at, fields, buf}:
      +c = code
      finish_on(String.is_empty(c), f, recs, n, head, c, at)

# Nothing left to read: flush a row the stream left unterminated and print the projection.
def finish(f: File, st: State) -> IO(Unit):
  finish_flushed(flush(st), f)

# The fuel ran out: whatever the last read left behind is the end of the stream.
def end_step(step: Step) -> IO(Unit):
  match step:
    case End{f, st}: finish(f, st)
    case Step{f, st}: finish(f, st)
    case StepErr{f, code, msg}: fail_read(f, code, msg)

# One read of at most 1 MiB per step. A read that returns no byte ends the loop; the fuel is the
# size-derived step count plus one step of slack and is the loop's own bound, so a short read
# still reaches end of input. The state carries the partial row, so a boundary inside a row, a
# field or a chunk is harmless. The fuel is the first argument of the self-call, which is how the
# recursion is checked to descend.
def stream_go(fuel: Nat, step: Step) -> IO(Unit):
  match fuel:
    case 0n: end_step(step)
    case 1n+p:
      match step:
        case End{f, st}: finish(f, st)
        case Step{f, st}:
          do IO<Unit>:
            m : File & Result<&1, &1, (U32 & String), String> <- File.read(f, 1048576)
            stream_go(p, step_of(m, st))
        case StepErr{f, code, msg}: fail_read(f, code, msg)

def start_stream(m: File & Result<&1, &1, (U32 & String), U32>) -> IO(Unit):
  (f, r) = m
  do IO<Unit>:
    size : U32 <- IO.pass(U32, r)
    stream_go(fuel_of(size), Step{f, state_new()})

# The stream path is opened by hand so a file that will not open refuses by name like a read that
# will not complete, rather than exiting on the platform's own message.
def open_failed(error: U32 & String) -> IO(Unit):
  (code, msg) = error
  IO.die(Unit, 1, String.concat([
    "bend2 projection: open_failed(", U32.show(code), "): ", msg,
  ]))

def sized(f: File) -> IO(Unit):
  do IO<Unit>:
    m : File & Result<&1, &1, (U32 & String), U32> <- File.size(f)
    start_stream(m)

def opened(m: Result<&1, &1, (U32 & String), File>) -> IO(Unit):
  match m:
    case Done{f}: sized(f)
    case Fail{error}: open_failed(error)

def stream(path: String) -> IO(Unit):
  do IO<Unit>:
    m : Result<&1, &1, (U32 & String), File> <- File.open(path, "r")
    opened(m)

# ==============================================================================================
# Check mode: the inline corpus
# ==============================================================================================

# The expected lines are written out here rather than derived from the renderer above, so a change
# in the renderer has to be matched by hand here before this module is green again.
def corpus() -> List<&2, Case>:
  [
    Case{
      "empty",
      [""],
      ["total rows=0 head=0 swarms=0 participants=0"],
      "",
    },
    Case{
      "swarm-no-participants",
      ["1\tswarm.contribution_recorded\tswarm-solo\t-\t-\n2\tswarm.contribution_integrated\tswarm-solo\t-\t-\n"],
      [
        "swarm swarm-solo joined=0 active=0 left=0 contrib=1 accept=0 review=0 integrated=1 work=0 assign=0 closed=0",
        "total rows=2 head=2 swarms=1 participants=0",
      ],
      "",
    },
    Case{
      "participant-left",
      ["1\tswarm.participant_joined\tswarm-a\tp1\t-\n2\tswarm.participant_joined\tswarm-a\tp2\t-\n3\tswarm.participant_left\tswarm-a\tp1\t-\n"],
      [
        "swarm swarm-a joined=2 active=1 left=1 contrib=0 accept=0 review=0 integrated=0 work=0 assign=0 closed=0",
        "participant swarm-a p1 status=left",
        "participant swarm-a p2 status=active",
        "total rows=3 head=3 swarms=1 participants=2",
      ],
      "",
    },
    Case{
      "reviews",
      ["4\tswarm.contribution_reviewed\tswarm-a\tp1\taccept\n5\tswarm.contribution_reviewed\tswarm-a\tp2\treject\n6\tswarm.contribution_reviewed\tswarm-a\t-\tcomment\n"],
      [
        "swarm swarm-a joined=0 active=0 left=0 contrib=0 accept=1 review=3 integrated=0 work=0 assign=0 closed=0",
        "participant swarm-a p1 status=active",
        "participant swarm-a p2 status=active",
        "total rows=3 head=6 swarms=1 participants=2",
      ],
      "",
    },
    Case{
      "closed-swarm",
      ["7\tswarm.work_updated\tswarm-b\tp9\t-\n8\tswarm.assignment_updated\tswarm-b\tp9\t-\n9\tswarm.closed\tswarm-b\t-\t-\n"],
      [
        "swarm swarm-b joined=0 active=0 left=0 contrib=0 accept=0 review=0 integrated=0 work=1 assign=1 closed=1",
        "participant swarm-b p9 status=active",
        "total rows=3 head=9 swarms=1 participants=1",
      ],
      "",
    },
    Case{
      "order-and-chunks",
      [
        "10\tswarm.participant_joined\tswarm-z\tpz2\t-\n11\tswarm.par",
        "ticipant_joined\tswarm-z\tpz1\t-\n12\tswarm.participant_joined\tswarm-a\tpa1\t-\n",
      ],
      [
        "swarm swarm-a joined=1 active=1 left=0 contrib=0 accept=0 review=0 integrated=0 work=0 assign=0 closed=0",
        "participant swarm-a pa1 status=active",
        "swarm swarm-z joined=2 active=2 left=0 contrib=0 accept=0 review=0 integrated=0 work=0 assign=0 closed=0",
        "participant swarm-z pz1 status=active",
        "participant swarm-z pz2 status=active",
        "total rows=3 head=12 swarms=2 participants=3",
      ],
      "",
    },
    Case{
      "no-trailing-newline",
      ["13\tswarm.participant_joined\tswarm-c\tpc\t-"],
      [
        "swarm swarm-c joined=1 active=1 left=0 contrib=0 accept=0 review=0 integrated=0 work=0 assign=0 closed=0",
        "participant swarm-c pc status=active",
        "total rows=1 head=13 swarms=1 participants=1",
      ],
      "",
    },
    Case{
      "absent-swarm-id",
      ["14\tswarm.participant_joined\t-\tpd\t-\n"],
      [
        "swarm - joined=1 active=1 left=0 contrib=0 accept=0 review=0 integrated=0 work=0 assign=0 closed=0",
        "participant - pd status=active",
        "total rows=1 head=14 swarms=1 participants=1",
      ],
      "",
    },
    Case{
      "unknown-kind",
      ["15\tswarm.contribution_revision_attached\tswarm-a\tpa\t-\n"],
      [],
      "unknown_event_kind",
    },
    Case{
      "blank-line",
      ["16\tswarm.participant_joined\tswarm-d\tpd\t-\n\n17\tswarm.participant_joined\tswarm-d\tpd2\t-\n"],
      [],
      "malformed_row",
    },
    Case{
      "extra-field",
      ["18\tswarm.participant_joined\tswarm-e\textra\tpe\t-\n"],
      [],
      "malformed_row",
    },
    Case{
      "unreadable-seq",
      ["x\tswarm.participant_joined\tswarm-f\tpf\t-\n"],
      [],
      "malformed_row",
    },
  ]

def fold_chunks(chunks: List<&2, String>, st: State) -> State:
  match chunks:
    case Nil{}: flush(st)
    case h <> t: fold_chunks(t, feed(h, st))

def fold_case(chunks: List<&2, String>) -> State:
  fold_chunks(chunks, state_new())

def result_folded(name: String, +recs: List<&2, Row>, n: U32, head: U32, lines: List<&2, String>, expect: List<&2, String>, want: String) -> String:
  +ids = swarm_ids_sorted(recs)
  +ls = lines
  String.concat([
    "RESULT|", name,
    "|rows=", U32.show(n),
    "|head=", U32.show(head),
    "|swarms=", U32.show(U32.from_nat(List.length(&2, String, ids))),
    "|participants=", U32.show(parts_total(ids, recs)),
    "|refusal=none|at=0|proj=", String.join(ls, ";"),
    "|ok=", tf(Bool.and(lines_eq(ls, expect), String.is_empty(want))),
  ])

# A case that refused at its own row: ok compares the rule and the seq with what the case declared.
def result_refused(name: String, +recs: List<&2, Row>, n: U32, head: U32, code: String, at: U32, want: String) -> String:
  +ids = swarm_ids_sorted(recs)
  +c = code
  String.concat([
    "RESULT|", name,
    "|rows=", U32.show(n),
    "|head=", U32.show(head),
    "|swarms=", U32.show(U32.from_nat(List.length(&2, String, ids))),
    "|participants=", U32.show(parts_total(ids, recs)),
    "|refusal=", c,
    "|at=", U32.show(at),
    "|proj=none|ok=", tf(String.eq(c, want)),
  ])

def result_line(folded: Bool, name: String, recs: List<&2, Row>, n: U32, head: U32, code: String, at: U32, expect: List<&2, String>, want: String) -> String:
  match folded:
    case True{}:
      +rs = recs
      +nn = n
      +hd = head
      result_folded(name, rs, nn, hd, render(rs, nn, hd), expect, want)
    case False{}: result_refused(name, recs, n, head, code, at, want)

def result_of(name: String, st: State, expect: List<&2, String>, want: String) -> String:
  match st:
    case State{recs, n, head, code, at, fields, buf}:
      +c = code
      result_line(String.is_empty(c), name, recs, n, head, c, at, expect, want)

def case_result(c: Case) -> String:
  match c:
    case Case{name, chunks, expect, code}:
      result_of(name, fold_case(chunks), expect, code)

def print_cases(cs: List<&2, Case>) -> IO(Unit):
  match cs:
    case Nil{}: IO.pure(Unit, Unit{})
    case c <> t:
      do IO<Unit>:
        u : Unit <- IO.print(case_result(c))
        print_cases(t)

def checks() -> IO(Unit):
  do IO<Unit>:
    m : Unit <- IO.print(String.concat([
      "MODE|check|corpus=inline|cases=", U32.show(U32.from_nat(List.length(&2, Case, corpus()))),
    ]))
    print_cases(corpus())

# ==============================================================================================
# The two modes
# ==============================================================================================

def dispatch(args: List<&1, String>) -> IO(Unit):
  match args:
    case Nil{}: checks()
    case p <> t: stream(p)

def main() -> IO(Unit):
  do IO<Unit>:
    as : List<&1, String> <- IO.args()
    dispatch(as)
