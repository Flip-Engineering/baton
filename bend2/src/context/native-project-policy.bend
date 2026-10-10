# Decode the owner-worktree module policy after its bytes and path were read by
# the authenticated project reader. The adapter validates policy shape and
# derives a stable identity from the observed read or observed absence.
import Base
import ../json/canonical.bend as J
import ./request.bend as Req
import ./engines.bend as Eng
import ./engines-select.bend as Sel
import ./snapshot.bend as Snap

type ProjectPolicy is Data:
  ProjectPolicy{disabled: Eng.SS, preferred: Eng.SS}

def project_policy_disabled(+policy: ProjectPolicy) -> Eng.SS:
  match policy:
    case ProjectPolicy{disabled, preferred}: disabled

def project_policy_preferred(+policy: ProjectPolicy) -> Eng.SS:
  match policy:
    case ProjectPolicy{disabled, preferred}: preferred

type PolicyDecode is Data:
  PolicyDecoded{policy: ProjectPolicy}
  PolicyRefused{condition: String}

type PolicyObservation is Data:
  PolicyPresent{owner: String, worktree: String, path: String,
                sha256: String, bytes: String}
  PolicyAbsent{owner: String, worktree: String, path: String}

type PolicyObservationDecode is Data:
  PolicyObservationDecoded{observation: PolicyObservation}
  PolicyObservationRefused{condition: String}

type PolicyObservationIdentity is Data:
  PolicyReadIdentity{value: String}
  PolicyMissingIdentity{value: String}
  PolicyIdentityRefused{condition: String}

type PolicySelectionIdentity is Data:
  PolicySelectionRead{value: Sel.ProjectPolicyIdentity}
  PolicySelectionMissing{value: Sel.ProjectPolicyIdentity}
  PolicySelectionRefused{condition: String}

def member_result(found: Maybe<&2, J.Json>) -> J.Json:
  match found:
    case None{}: J.Jnil{}
    case Some{+value}: value

def member_exists(found: Maybe<&2, J.Json>) -> Bool:
  match found:
    case None{}: False{}
    case Some{value}: True{}

def member(+object: J.Json, +key: String) -> J.Json:
  match object:
    case J.Jobj{+members}:
      member_result(Req.member_lookup(key, members))
    case other: J.Jnil{}

def members(+object: J.Json) -> J.Json:
  match object:
    case J.Jobj{+members}: members
    case other: J.Jnil{}

def required_member(value: J.Json, +key: String) -> Bool:
  match value:
    case J.Jobj{+members}:
      member_exists(Req.member_lookup(key, members))
    case other: False{}

def text_array_tail(+items: J.Json) -> List<String>:
  match items:
    case J.Jarr{J.Jnil{}, J.Jnil{}}: Nil{}
    case J.Jarr{+head, +tail}: Req.text_of(head) <> text_array_tail(tail)
    case other: Nil{}

def text_array(+items: J.Json) -> Eng.SS:
  Eng.ss_of_list(text_array_tail(items))

def text_array_values(+items: J.Json) -> Bool:
  match items:
    case J.Jnil{}: True{}
    case J.Jarr{J.Jnil{}, J.Jnil{}}: True{}
    case J.Jarr{+head, +tail}:
      Bool.and(Req.is_jstr(head), Bool.and(Bool.not(String.is_empty(Req.text_of(head))), text_array_values(tail)))
    case other: False{}

def text_list_unique(xs: List<String>, +seen: Eng.SS) -> Bool:
  match xs:
    case Nil{}: True{}
    case +head <> tail:
      Bool.pick(Bool, Eng.ss_member(seen, head), False{},
        text_list_unique(tail, Eng.SSCons{head, seen}))

def text_array_shape(items: J.Json) -> Bool:
  match items:
    case J.Jarr{head, tail}: True{}
    case other: False{}

def text_array_valid(+items: J.Json) -> Bool:
  Bool.and(text_array_shape(items),
    Bool.and(text_array_values(items), text_list_unique(text_array_tail(items), Eng.ss_empty())))

def policy_fields_valid(+value: J.Json) -> Bool:
  Bool.and(Req.is_jobj(value),
  Bool.and(Req.keys_allowed(Req.words_from(["schema", "disabled", "preferred"]), members(value)),
  Bool.and(required_member(value, "schema"),
  Bool.and(required_member(value, "disabled"),
  Bool.and(required_member(value, "preferred"),
  Bool.and(String.eq(Req.text_of(member(value, "schema")), "baton2-context-project-v1"),
  Bool.and(text_array_valid(member(value, "disabled")),
           text_array_valid(member(value, "preferred")))))))))

def decode(+value: J.Json) -> PolicyDecode:
  Bool.pick(PolicyDecode, policy_fields_valid(value),
    PolicyDecoded{ProjectPolicy{text_array(member(value, "disabled")),
                                 text_array(member(value, "preferred"))}},
    PolicyRefused{"projectPolicyMalformed"})

def text_field(+value: J.Json, +key: String) -> String:
  Req.text_of(member(value, key))

def observation_bytes_valid(+value: J.Json) -> Bool:
  Bool.and(Req.is_jstr(member(value, "bytes")),
    Bool.and(Req.is_jstr(member(value, "sha256")),
      Bool.not(String.is_empty(text_field(value, "sha256")))))

def observation_authority_valid(+value: J.Json, +owner: String, +worktree: String) -> Bool:
  Bool.and(Req.is_jobj(value),
    Bool.and(String.eq(text_field(value, "owner"), owner),
      Bool.and(String.eq(text_field(value, "worktree"), worktree),
        Bool.and(Bool.not(String.is_empty(owner)),
          Bool.and(Bool.not(String.is_empty(worktree)),
            String.eq(text_field(value, "path"), worktree ++ "/.baton/context.json"))))))

def observation_present(+value: J.Json, +owner: String, +worktree: String) -> PolicyObservationDecode:
  Bool.pick(PolicyObservationDecode,
    Bool.and(observation_authority_valid(value, owner, worktree), observation_bytes_valid(value)),
    PolicyObservationDecoded{PolicyPresent{owner, worktree, text_field(value, "path"),
      text_field(value, "sha256"), text_field(value, "bytes")}},
    PolicyObservationRefused{"projectPolicyObservationMalformed"})

def observation_absent(+value: J.Json, +owner: String, +worktree: String) -> PolicyObservationDecode:
  Bool.pick(PolicyObservationDecode,
    observation_authority_valid(value, owner, worktree),
    PolicyObservationDecoded{PolicyAbsent{owner, worktree, text_field(value, "path")}},
    PolicyObservationRefused{"projectPolicyObservationMalformed"})

def decode_observation(+value: J.Json, +owner: String, +worktree: String) -> PolicyObservationDecode:
  Bool.pick(PolicyObservationDecode, String.eq(text_field(value, "status"), "present"),
    observation_present(value, owner, worktree),
    Bool.pick(PolicyObservationDecode, String.eq(text_field(value, "status"), "absent"),
      observation_absent(value, owner, worktree),
      PolicyObservationRefused{"projectPolicyUnavailable"}))

def observation_identity(+observation: PolicyObservation) -> PolicyObservationIdentity:
  match observation:
    case PolicyPresent{owner, worktree, path, sha256, bytes}:
      Bool.pick(PolicyObservationIdentity,
        Bool.and(Bool.and(Bool.not(String.is_empty(owner)), Bool.not(String.is_empty(worktree))),
        Bool.and(Bool.not(String.is_empty(path)), Bool.not(String.is_empty(sha256)))),
        PolicyReadIdentity{J.json_text(J.Jarr{J.Jstr{"baton2.context.project-policy.read.v1"},
          J.Jarr{J.Jstr{owner}, J.Jarr{J.Jstr{worktree}, J.Jarr{J.Jstr{path},
          J.Jarr{J.Jstr{sha256}, J.Jnil{}}}}}})},
        PolicyIdentityRefused{"projectPolicyObservationMalformed"})
    case PolicyAbsent{owner, worktree, path}:
      Bool.pick(PolicyObservationIdentity,
        Bool.and(Bool.and(Bool.not(String.is_empty(owner)), Bool.not(String.is_empty(worktree))),
                 Bool.not(String.is_empty(path))),
        PolicyMissingIdentity{J.json_text(J.Jarr{J.Jstr{"baton2.context.project-policy.absent.v1"},
          J.Jarr{J.Jstr{owner}, J.Jarr{J.Jstr{worktree}, J.Jarr{J.Jstr{path}, J.Jnil{}}}}})},
        PolicyIdentityRefused{"projectPolicyObservationMalformed"})

def observation_identity_text(identity: PolicyObservationIdentity) -> String:
  match identity:
    case PolicyReadIdentity{value}: value
    case PolicyMissingIdentity{value}: value
    case PolicyIdentityRefused{condition}: "refused:" ++ condition

def selection_identity(+observation: PolicyObservation) -> PolicySelectionIdentity:
  match observation:
    case PolicyPresent{owner, worktree, path, sha256, bytes}:
      Bool.pick(PolicySelectionIdentity,
        Bool.and(Bool.and(Bool.not(String.is_empty(owner)), Bool.not(String.is_empty(worktree))),
        Bool.and(Bool.not(String.is_empty(path)), Bool.not(String.is_empty(sha256)))),
        PolicySelectionRead{Sel.ProjectPolicyRead{owner, worktree, path, sha256}},
        PolicySelectionRefused{"projectPolicyObservationMalformed"})
    case PolicyAbsent{owner, worktree, path}:
      Bool.pick(PolicySelectionIdentity,
        Bool.and(Bool.and(Bool.not(String.is_empty(owner)), Bool.not(String.is_empty(worktree))),
                 Bool.not(String.is_empty(path))),
        PolicySelectionMissing{Sel.ProjectPolicyMissing{owner, worktree, path}},
        PolicySelectionRefused{"projectPolicyObservationMalformed"})

def snapshot_identity(+identity: Sel.ProjectPolicyIdentity) -> Snap.Fp:
  match identity:
    case Sel.ProjectPolicyRead{owner, worktree, path, sha256}:
      Snap.FpProjectPolicy{owner, worktree, path, sha256}
    case Sel.ProjectPolicyMissing{owner, worktree, path}:
      Snap.FpProjectPolicyAbsent{owner, worktree, path}
