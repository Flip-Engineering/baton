# CLAIM: the snapshot identity and applicability composition of the native
# semantic context feature (docs/bend2/semantic-context-spec.md, "Input
# identity and capture consistency" and "Results, classifications and
# references").
#
# A source snapshot records a query-local snapshotId, the provider identity,
# the effective options, worktree metadata and the actual read identities. The
# snapshotId is the digest of the canonical identity text this module builds;
# worktree metadata is recorded beside it and is never part of it, so a
# worktree commit or branch change alone cannot make two different input sets
# share an identity.
#
# Applicability is the pure comparison of the recorded identity with a fresh
# revalidation: current when every recorded input still matches, stale with the
# changed input paths named when one does not, unknown when a required safe
# probe failed. A runtime observation is current only in its own live epoch and
# historical otherwise. A catalog snapshot identity carries the schema-level
# fields only; the raw data version is reported separately and never makes a
# schema stale.

import Base
import ../json/canonical.bend as J
import ./engines.bend as Eng

# --- captured input identities ----------------------------------------------
# One captured input, as a provider supplies it. The kinds are the ones the
# specification requires to represent invalidation: file bytes, a lookup that
# resolved to nothing, directory membership, a resolved link and effective
# configuration bytes.
type Fp is Data:
  FpFile{role: String, path: String, sha256: String}
  FpAbsent{role: String, path: String}
  FpDir{role: String, path: String, sha256: String}
  FpLink{role: String, path: String, target: String}
  FpConfig{role: String, path: String, sha256: String}

type Fps is Data:
  FpsNil{}
  FpsCons{head: Fp, rest: Fps}

def fp_role(f: Fp) -> String:
  match f:
    case FpFile{role, path, sha256}: role
    case FpAbsent{role, path}: role
    case FpDir{role, path, sha256}: role
    case FpLink{role, path, target}: role
    case FpConfig{role, path, sha256}: role

def fp_path(f: Fp) -> String:
  match f:
    case FpFile{role, path, sha256}: path
    case FpAbsent{role, path}: path
    case FpDir{role, path, sha256}: path
    case FpLink{role, path, target}: path
    case FpConfig{role, path, sha256}: path

# The digest-bearing component: the file digest, the resolved target, the
# directory digest, the configuration digest, or the absent marker.
def fp_marker(f: Fp) -> String:
  match f:
    case FpFile{role, path, sha256}: sha256
    case FpAbsent{role, path}: "absent"
    case FpDir{role, path, sha256}: sha256
    case FpLink{role, path, target}: target
    case FpConfig{role, path, sha256}: sha256

def fps_of_list(xs: List<Fp>) -> Fps:
  match xs:
    case Nil{}: FpsNil{}
    case h <> t: FpsCons{h, fps_of_list(t)}

def fps_to_list(xs: Fps) -> List<Fp>:
  match xs:
    case FpsNil{}: Nil{}
    case FpsCons{h, r}: h <> fps_to_list(r)

# --- canonical identity text -------------------------------------------------
# Canonical JSON text of a string array; Jnil terminates the array chain, as
# json/canonical.bend's own corpus builds it.
def strs_tail(xs: List<String>) -> J.Json:
  match xs:
    case Nil{}: J.Jnil{}
    case h <> t: J.Jarr{J.Jstr{h}, strs_tail(t)}

def strs_array(xs: List<String>) -> J.Json:
  match xs:
    case Nil{}: J.Jarr{J.Jnil{}, J.Jnil{}}
    case h <> t: J.Jarr{J.Jstr{h}, strs_tail(t)}

def bool_text(b: Bool) -> String:
  match b:
    case True{}: "true"
    case False{}: "false"

def fp_json(+f: Fp) -> J.Json:
  J.Jarr{J.Jstr{fp_role(f)}, J.Jarr{J.Jstr{fp_path(f)}, J.Jarr{J.Jstr{fp_marker(f)}, J.Jnil{}}}}

def fps_tail(xs: Fps) -> J.Json:
  match xs:
    case FpsNil{}: J.Jnil{}
    case FpsCons{h, r}: J.Jarr{fp_json(h), fps_tail(r)}

def fps_array(xs: Fps) -> J.Json:
  match xs:
    case FpsNil{}: J.Jarr{J.Jnil{}, J.Jnil{}}
    case FpsCons{h, r}: J.Jarr{fp_json(h), fps_tail(r)}

# The canonical identity text of one source snapshot. The provider identity,
# the effective options and every captured input appear in order; worktree
# metadata is deliberately absent. The provider supplies the digest of this
# text as the query-local snapshotId.
def identity_text(+provider: String, +version: String, options: List<String>, inputs: Fps) -> String:
  J.json_text(J.Jarr{J.Jstr{"baton2.context.snapshot.v1"}, J.Jarr{J.Jstr{provider}, J.Jarr{J.Jstr{version}, J.Jarr{strs_array(options), J.Jarr{fps_array(inputs), J.Jnil{}}}}}})

# The canonical identity text of one catalog snapshot. It carries the
# schema-level identity only: the real path, the file identity, the schema
# digest, schema_version, journal mode and the connection flags. The raw data
# version is not an input, so a data-only write cannot make a schema stale.
def catalog_identity_text(+engine: String, +version: String, +path: String, +file_identity: String, +schema_digest: String, +schema_version: String, +journal_mode: String, read_only: Bool, foreign_keys: Bool) -> String:
  J.json_text(
    J.Jarr{J.Jstr{"baton2.context.catalog.v1"},
    J.Jarr{J.Jstr{engine},
    J.Jarr{J.Jstr{version},
    J.Jarr{J.Jstr{path},
    J.Jarr{J.Jstr{file_identity},
    J.Jarr{J.Jstr{schema_digest},
    J.Jarr{J.Jstr{schema_version},
    J.Jarr{J.Jstr{journal_mode},
    J.Jarr{J.Jstr{bool_text(read_only)},
    J.Jarr{J.Jstr{bool_text(foreign_keys)}, J.Jnil{}}}}}}}}}}})

# --- applicability -----------------------------------------------------------
type Revalidation is Data:
  RvOk{current: Fps}
  RvFailed{reason: String}

type Applies is Data:
  ACurrent{}
  AStale{changed: Eng.SS}
  AHistorical{reason: String}
  AUnknown{reason: String}

# The same role and path, and the same digest. A recorded input whose path is
# absent from the revalidation is changed, and an added formerly absent module
# changes the recorded absent entry's marker.
def input_unchanged(+h: Fp, current: Fps) -> Bool:
  match current:
    case FpsNil{}: False{}
    case FpsCons{+c, cs}:
      Bool.pick(Bool, Bool.and(String.eq(fp_role(c), fp_role(h)), String.eq(fp_path(c), fp_path(h))), String.eq(fp_marker(c), fp_marker(h)), input_unchanged(h, cs))

# The paths of the recorded inputs whose identity no longer matches, in the
# recorded order. Also the result's changedInputs field and the capture
# consistency check.
def ss_rev_go(xs: Eng.SS, acc: Eng.SS) -> Eng.SS:
  match xs:
    case Eng.SSNil{}: acc
    case Eng.SSCons{h, r}: ss_rev_go(r, Eng.SSCons{h, acc})

def ss_rev(xs: Eng.SS) -> Eng.SS:
  ss_rev_go(xs, Eng.SSNil{})

def changed_go(recorded: Fps, +current: Fps, +acc: Eng.SS) -> Eng.SS:
  match recorded:
    case FpsNil{}: acc
    case FpsCons{+h, t}:
      changed_go(t, current, Bool.pick(Eng.SS, input_unchanged(h, current), acc, Eng.SSCons{fp_path(h), acc}))

def changed_inputs(recorded: Fps, current: Fps) -> Eng.SS:
  ss_rev(changed_go(recorded, current, Eng.SSNil{}))

def applies_decision(changed: Eng.SS) -> Applies:
  match changed:
    case Eng.SSNil{}: ACurrent{}
    case Eng.SSCons{h, r}: AStale{changed}

def applies_ok(recorded: Fps, current: Fps) -> Applies:
  applies_decision(changed_inputs(recorded, current))

def applies(recorded: Fps, revalidation: Revalidation) -> Applies:
  match revalidation:
    case RvFailed{reason}: AUnknown{reason}
    case RvOk{current}: applies_ok(recorded, current)

# The capture consistency check: the manifest verified after provider
# consumption must equal the recorded manifest.
type CaptureCheck is Data:
  CCIntact{}
  CCChanged{paths: Eng.SS}

def capture_decision(changed: Eng.SS) -> CaptureCheck:
  match changed:
    case Eng.SSNil{}: CCIntact{}
    case Eng.SSCons{h, r}: CCChanged{changed}

def capture_check(recorded: Fps, verified: Fps) -> CaptureCheck:
  capture_decision(changed_inputs(recorded, verified))

# A catalog comparison: equal schema identity is current, a different one is
# stale with the database path named. The caller supplies the path; the raw
# data version is not consulted.
def applies_catalog(+path: String, +recorded_digest: String, +current_digest: String) -> Applies:
  Bool.pick(Applies, String.eq(recorded_digest, current_digest), ACurrent{}, AStale{Eng.ss_one(path)})

# --- runtime references ------------------------------------------------------
# The identity a runtime reference carries. The caller obtains the same fields
# from the owned runtime contract and the two are compared here; this module
# reads no runtime state, advances no transition and grants nothing.
type RuntimeIdentity is Data:
  RId{runtime: String, adapter: String, thread: String, epoch: String, mutation: String}

def same_runtime_identity(+a: RuntimeIdentity, +b: RuntimeIdentity) -> Bool:
  match a:
    case RId{runtime, adapter, thread, epoch, mutation}:
      match b:
        case RId{other_runtime, other_adapter, other_thread, other_epoch, other_mutation}:
          Bool.and(String.eq(runtime, other_runtime),
          Bool.and(String.eq(adapter, other_adapter),
          Bool.and(String.eq(thread, other_thread),
          Bool.and(String.eq(epoch, other_epoch), String.eq(mutation, other_mutation)))))

# What the owned runtime contract reports now: the canonical identity, whether
# the thread is live, whether the child has exited, whether the runtime is
# paused, whether a stop is recorded, and whether the reference is scoped to a
# pause. A recorded stop committed together with an admitted record is the
# contract's evidence; a caller-supplied decision or a liveness flag alone is
# not authority, and nothing here grants one.
type RuntimeNow is Data:
  Now{identity: RuntimeIdentity, live_thread: Bool, child_exited: Bool, paused: Bool, stop_recorded: Bool, pause_scoped: Bool}

def now_identity(r: RuntimeNow) -> RuntimeIdentity:
  match r:
    case Now{identity, live_thread, child_exited, paused, stop_recorded, pause_scoped}: identity

def now_live_thread(r: RuntimeNow) -> Bool:
  match r:
    case Now{identity, live_thread, child_exited, paused, stop_recorded, pause_scoped}: live_thread

def now_child_exited(r: RuntimeNow) -> Bool:
  match r:
    case Now{identity, live_thread, child_exited, paused, stop_recorded, pause_scoped}: child_exited

def now_paused(r: RuntimeNow) -> Bool:
  match r:
    case Now{identity, live_thread, child_exited, paused, stop_recorded, pause_scoped}: paused

def now_stop_recorded(r: RuntimeNow) -> Bool:
  match r:
    case Now{identity, live_thread, child_exited, paused, stop_recorded, pause_scoped}: stop_recorded

def now_pause_scoped(r: RuntimeNow) -> Bool:
  match r:
    case Now{identity, live_thread, child_exited, paused, stop_recorded, pause_scoped}: pause_scoped

# Identity is decided first: a reference whose runtime, adapter, thread, epoch
# or mutation generation differs belongs to another lifetime, whatever the
# current liveness. A live thread is required next, then a child that has not
# exited; an exit makes every observation of that child historical. A reference
# scoped to a pause additionally requires the recorded stop in a paused
# runtime, and without that evidence its applicability is unknown with the
# cause rather than current.
def rref_identity(recorded: RuntimeIdentity, +now: RuntimeNow) -> Applies:
  Bool.pick(Applies, same_runtime_identity(recorded, now_identity(now)), rref_live(now), AHistorical{"runtime identity changed"})

def rref_live(+now: RuntimeNow) -> Applies:
  Bool.pick(Applies, now_live_thread(now), rref_exit(now), AHistorical{"runtime thread is not live"})

def rref_exit(+now: RuntimeNow) -> Applies:
  Bool.pick(Applies, now_child_exited(now), AHistorical{"runtime child exited"}, rref_scope(now))

def rref_scope(+now: RuntimeNow) -> Applies:
  Bool.pick(Applies, now_pause_scoped(now), rref_stop(now), ACurrent{})

def rref_stop(+now: RuntimeNow) -> Applies:
  Bool.pick(Applies, Bool.and(now_paused(now), now_stop_recorded(now)), ACurrent{},
    AUnknown{"pause-scoped reference requires a recorded stop in a paused runtime"})

def applies_runtime_ref(recorded: RuntimeIdentity, now: RuntimeNow) -> Applies:
  rref_identity(recorded, now)

# --- connection binding ------------------------------------------------------
# A catalog snapshot and its target plan share one live connection and read
# transaction. A detached snapshot cannot authorize opening another planning
# snapshot.
type Binding is Data:
  BShare{}
  BRefused{reason: String}

def plan_binding(+snapshot: String, +plan_snapshot: String) -> Binding:
  Bool.pick(Binding, String.eq(snapshot, plan_snapshot), BShare{},
    BRefused{"the target plan must use the recorded catalog connection and read transaction"})

# A join that spans engines (the C combined query's analyzer and catalog sides,
# the TypeScript or entity code-access join) requires identical shared source
# identities on both sides and the same named database snapshot identity, so a
# same-name or same-text selection from another snapshot cannot join.
def join_binding(+source: String, +join_source: String, +catalog: String, +join_catalog: String) -> Binding:
  Bool.pick(Binding, Bool.and(String.eq(source, join_source), String.eq(catalog, join_catalog)), BShare{},
    BRefused{"a multi-engine join requires identical shared source identities and the named database snapshot"})
