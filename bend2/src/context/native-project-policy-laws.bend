# Operative policy decoder and policy identity laws.
import Base
import ../json/canonical.bend as J
import ./engines.bend as Eng
import ./native-project-policy.bend as Policy

def empty_array() -> J.Json:
  J.Jarr{J.Jnil{}, J.Jnil{}}

def strings(+head: String, +tail: J.Json) -> J.Json:
  J.Jarr{J.Jstr{head}, tail}

def pair(+key: String, +value: J.Json, +tail: J.Json) -> J.Json:
  J.Jpair{key, value, tail}

def project_value(+disabled: J.Json, +preferred: J.Json) -> J.Json:
  J.Jobj{pair("schema", J.Jstr{"baton2-context-project-v1"},
    pair("disabled", disabled, pair("preferred", preferred, J.Jnil{})))}

law project_policy_decodes_unique_disabled_and_preferred_module_ids:
  {Policy.decode(project_value(strings("example.disabled", empty_array()),
    strings("example.preferred", empty_array()))) == Policy.PolicyDecoded{
      Policy.ProjectPolicy{Eng.ss_one("example.disabled"), Eng.ss_one("example.preferred")}} : Policy.PolicyDecode}

def project_policy_decodes_unique_disabled_and_preferred_module_ids():
  {==}

law project_policy_refuses_duplicate_disabled_ids:
  {Policy.decode(project_value(strings("example.mod", strings("example.mod", empty_array())), empty_array())) ==
    Policy.PolicyRefused{"projectPolicyMalformed"} : Policy.PolicyDecode}

def project_policy_refuses_duplicate_disabled_ids():
  {==}

law project_policy_refuses_unknown_fields:
  {Policy.decode(J.Jobj{pair("schema", J.Jstr{"baton2-context-project-v1"},
    pair("disabled", empty_array(), pair("preferred", empty_array(),
      pair("installed", strings("example.mod", empty_array()), J.Jnil{}))))} ==
      Policy.PolicyRefused{"projectPolicyMalformed"} : Policy.PolicyDecode}

def project_policy_refuses_unknown_fields():
  {==}

law project_policy_refuses_wrong_schema:
  {Policy.decode(J.Jobj{pair("schema", J.Jstr{"other"},
    pair("disabled", empty_array(), pair("preferred", empty_array(), J.Jnil{}))}) ==
      Policy.PolicyRefused{"projectPolicyMalformed"} : Policy.PolicyDecode}

def project_policy_refuses_wrong_schema():
  {==}

law project_policy_identity_distinguishes_read_and_absence:
  {Bool.not(Policy.observation_identity(Policy.PolicyPresent{"owner", "/work", "/work/.baton/context.json", "abc", "{}"}) ==
   Policy.observation_identity(Policy.PolicyAbsent{"owner", "/work", "/work/.baton/context.json"})) == True{} : Bool}

def project_policy_identity_distinguishes_read_and_absence():
  {==}

law project_policy_identity_binds_owner_and_worktree:
  {Bool.not(Policy.observation_identity(Policy.PolicyAbsent{"owner-a", "/work", "/work/.baton/context.json"}) ==
   Policy.observation_identity(Policy.PolicyAbsent{"owner-b", "/work", "/work/.baton/context.json"})) == True{} : Bool}

def project_policy_identity_binds_owner_and_worktree():
  {==}
