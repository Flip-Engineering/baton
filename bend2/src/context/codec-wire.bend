# CLAIM: the common module transport envelope is one closed shape per direction, and
# this module renders it. The invocation carries version, query, owner, the module
# binding, the canonical request value, the admitted input identities, the granted
# operation plan, and the role and incarnation; the event and result carry version,
# query, owner, the binding, the runtime, role, incarnation, sequence, type and payload.
#
# The composite members are supplied as canonical JSON values by their owners, so the
# module binding, the operation plan, the input identities and a payload keep one
# source each and this module does not spell them a second time. The scalar members are
# mapped here: the version is the number 2, an empty query, owner, runtime, role or
# incarnation is null, and the sequence keeps its exact decimal text as text, because
# the canonical encoder has no numeric form wider than U32 and the profile requires the
# exact text.
#
# Ownership: the members belong to their producers; this module owns only the envelope
# member set and order. The declaration and schema identity are package-supplied.
# Serves: docs/bend2/semantic-context-spec.md, the closed version-2 transport.
import Base
import ../json/canonical.bend as J

# A member that is absent when its text is empty. A direct invocation carries no role
# and no incarnation, and an unsolicited query-null event carries no query.
def wire_nullable(+text: String) -> J.Json:
  Bool.pick(J.Json, String.is_empty(text), J.Jnull{}, J.Jstr{text})

# The closed invocation envelope. The member order is the order of the shape.
def invocation_frame(+query: String, +owner: String, +binding: J.Json, +request: J.Json, +inputs: J.Json, +plan: J.Json, +role: String, +incarnation: String) -> String:
  J.json_text(wire_invocation_value(query, owner, binding, request, inputs, plan, role, incarnation))

def wire_invocation_value(+query: String, +owner: String, +binding: J.Json, +request: J.Json, +inputs: J.Json, +plan: J.Json, +role: String, +incarnation: String) -> J.Json:
  J.Jobj{
    J.Jpair{"version", J.Jint{2},
      J.Jpair{"query", wire_nullable(query),
        J.Jpair{"owner", wire_nullable(owner),
          J.Jpair{"moduleBinding", binding,
            J.Jpair{"request", request,
              J.Jpair{"inputIdentities", inputs,
                J.Jpair{"operationPlan", plan,
                  J.Jpair{"role", wire_nullable(role),
                    J.Jpair{"incarnation", wire_nullable(incarnation), J.Jnil{}}}}}}}}}}}

# The closed event and result envelope. The sequence is the exact decimal text.
def event_frame(+query: String, +owner: String, +producer: J.Json, +runtime: String, +role: String, +incarnation: String, +sequence: String, +frame_type: String, +payload: J.Json) -> String:
  J.json_text(wire_event_value(query, owner, producer, runtime, role, incarnation, sequence, frame_type, payload))

def wire_event_value(+query: String, +owner: String, +producer: J.Json, +runtime: String, +role: String, +incarnation: String, +sequence: String, +frame_type: String, +payload: J.Json) -> J.Json:
  J.Jobj{
    J.Jpair{"version", J.Jint{2},
      J.Jpair{"query", wire_nullable(query),
        J.Jpair{"owner", wire_nullable(owner),
          J.Jpair{"moduleBinding", producer,
            J.Jpair{"runtime", wire_nullable(runtime),
              J.Jpair{"role", wire_nullable(role),
                J.Jpair{"incarnation", wire_nullable(incarnation),
                  J.Jpair{"sequence", J.Jstr{sequence},
                    J.Jpair{"type", J.Jstr{frame_type},
                      J.Jpair{"payload", payload, J.Jnil{}}}}}}}}}}}}

# --- laws ------------------------------------------------------------------

law wire_law_the_invocation_frame_has_the_closed_shape:
  {invocation_frame("q1", "o1", J.Jobj{J.Jpair{"id", J.Jstr{"m"}, J.Jnil{}}}, J.Jobj{J.Jnil{}}, J.Jarr{J.Jnil{}, J.Jnil{}}, J.Jarr{J.Jnil{}, J.Jnil{}}, "r1", "i1") == "{\"version\":2,\"query\":\"q1\",\"owner\":\"o1\",\"moduleBinding\":{\"id\":\"m\"},\"request\":{},\"inputIdentities\":[],\"operationPlan\":[],\"role\":\"r1\",\"incarnation\":\"i1\"}" : String}

def wire_law_the_invocation_frame_has_the_closed_shape():
  {==}

law wire_law_the_invocation_version_is_the_number_two:
  {invocation_frame("q", "", J.Jnull{}, J.Jnull{}, J.Jnull{}, J.Jnull{}, "", "") == "{\"version\":2,\"query\":\"q\",\"owner\":null,\"moduleBinding\":null,\"request\":null,\"inputIdentities\":null,\"operationPlan\":null,\"role\":null,\"incarnation\":null}" : String}

def wire_law_the_invocation_version_is_the_number_two():
  {==}

law wire_law_an_empty_role_and_incarnation_are_null:
  {wire_nullable("") == J.Jnull{} : J.Json}

def wire_law_an_empty_role_and_incarnation_are_null():
  {==}

law wire_law_a_present_role_is_a_string:
  {wire_nullable("r1") == J.Jstr{"r1"} : J.Json}

def wire_law_a_present_role_is_a_string():
  {==}

law wire_law_the_event_frame_has_the_closed_shape:
  {event_frame("q1", "o1", J.Jobj{J.Jpair{"id", J.Jstr{"m"}, J.Jnil{}}}, "", "", "", "7", "result", J.Jstr{"p"}) == "{\"version\":2,\"query\":\"q1\",\"owner\":\"o1\",\"moduleBinding\":{\"id\":\"m\"},\"runtime\":null,\"role\":null,\"incarnation\":null,\"sequence\":\"7\",\"type\":\"result\",\"payload\":\"p\"}" : String}

def wire_law_the_event_frame_has_the_closed_shape():
  {==}

law wire_law_a_sequence_longer_than_u32_keeps_its_exact_text:
  {event_frame("q", "o", J.Jnull{}, "", "", "", "12345678901234567890", "event", J.Jnull{}) == "{\"version\":2,\"query\":\"q\",\"owner\":\"o\",\"moduleBinding\":null,\"runtime\":null,\"role\":null,\"incarnation\":null,\"sequence\":\"12345678901234567890\",\"type\":\"event\",\"payload\":null}" : String}

def wire_law_a_sequence_longer_than_u32_keeps_its_exact_text():
  {==}

law wire_law_a_retained_role_and_incarnation_travel_as_strings:
  {event_frame("q", "o", J.Jnull{}, "managed", "worker", "inc7", "1", "event", J.Jnull{}) == "{\"version\":2,\"query\":\"q\",\"owner\":\"o\",\"moduleBinding\":null,\"runtime\":\"managed\",\"role\":\"worker\",\"incarnation\":\"inc7\",\"sequence\":\"1\",\"type\":\"event\",\"payload\":null}" : String}

def wire_law_a_retained_role_and_incarnation_travel_as_strings():
  {==}
