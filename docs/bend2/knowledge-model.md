# Scientific knowledge model

Baton Knowledge v1 records scientific questions, observations, explanations,
arguments and proposed actions. Its relations carry the reasoning and evidence
that connect those records. Issue #710 covers implementation; issue #682 covers
the graph reading and navigation interface.

## Schema

[knowledge-v1.schema.json](knowledge-v1.schema.json) defines the admission
payload with JSON Schema 2020-12. Its identity is
`urn:baton:knowledge:schema:1`. The root carries `schemaVersion: 1`, `nodes` and
`edges`. Each node and edge has a declared type with a closed field set.
[knowledge-v1-semantics.json](knowledge-v1-semantics.json) defines the allowed
endpoint types, reference resolution and inference rules.

[knowledge-v1-scientific-example.json](knowledge-v1-scientific-example.json)
illustrates a study of riparian shade and water temperature. Its records are
fictional. It exercises the schema without asserting an empirical result.

## Standards alignment

The admission format uses [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/json-schema-validation).
Observation fields follow the concepts in
[W3C SOSA](https://www.w3.org/TR/vocab-ssn/#SOSAObservation): subject, observed
property, procedure, result, phenomenon time and result time. Provenance follows
[W3C PROV-O](https://www.w3.org/TR/prov-o/): records have authors, research
activities generate outputs, and derived records retain their sources.

These mappings guide interpretation of the JSON contract. An RDF export would
represent the authored observation record as a provenance entity and the
observation activity separately as `sosa:Observation`. A study's execution maps
to `prov:Activity`; its description and planned design remain entities.
`derived-from` maps to `prov:wasDerivedFrom` for entity endpoints. A study's
`produces` relation maps from output to execution through `prov:wasGeneratedBy`.
The current interface reads the versioned JSON graph.

The [SEPIO information model](https://github.com/sepio-framework/sepio-linkml)
also informs the distinction between information, scientific assertions and
evidence interpretation. Its
[Statement and EvidenceLine classes](https://github.com/sepio-framework/sepio-linkml/blob/main/src/sepio_linkml/schema/sepio_classes.yaml)
separate an assertion from an argument that assesses a proposition using one or
more information items. Baton observations and findings retain their content
and method. An argument groups premises; a support or challenge relation records
the author's interpretation, target, basis and rationale. These are conceptual
mappings. A conforming SEPIO profile or export requires explicit field and
identity mappings.

Evidence direction, strength and source quality are separate judgments. Baton
records the relation's direction and the author's uncertainty and limits. A
reader assesses shared sources and dependencies between premises when weighing
several arguments. Repeated citations of the same information do not establish
independent evidence.

## Node types

| Type | Content |
| --- | --- |
| `question` | A research question, topic and remaining questions. |
| `claim` | A proposition with its quantification. |
| `hypothesis` | An explanatory proposition, predictions and conditions that would overturn it. |
| `observation` | A measured or observed result, subject, property, procedure and time. |
| `research-finding` | An inference drawn from named inputs through a stated method. |
| `study` | A named investigation, its questions, method, design, state and outputs. |
| `evidence` | A source record, its description and selection. |
| `argument` | Premises, an inference method, a derivation and an applicable witness. |
| `proposal` | A proposed action, purpose, rationale and alternatives. |
| `decision` | A selected proposal or other typed record, rationale and alternatives. |

Every node retains the author's identity, statement, evidence references, limits
and uncertainty. Scientific context records applicability, subjects, conditions
and assumptions. A finding's method and inference remain available when another
record cites it.

## Relations

Each relation is an authored assertion with typed source and target references,
context, basis, rationale, limits, uncertainty and type-specific details.

| Relation | Meaning |
| --- | --- |
| `supports` | Evidence or an argument bears on a proposition or another relation. |
| `challenges` | A source contests a proposition, method, inference or relation. |
| `contradicts` | Two propositions conflict within their stated overlap. |
| `negates` | One proposition is the logical complement of another under the recorded quantifier scope. |
| `implies` | A proposition entails another through a cited deductive argument and inference rule. |
| `proves` | A deductive argument establishes its stated conclusion. |
| `disproves` | An argument refutes a proposition within its scope, with a witness for a counterexample. |
| `causes` | A represented exposure affects a represented outcome through a stated causal identification. |
| `correlates-with` | Two represented observations or propositions have a stated association and confounders. |
| `competes-with` | Two hypotheses offer alternatives for the same research question. |
| `replicates` | A study or observation repeats an earlier procedure and records agreement and differences. |
| `derived-from` | A record derives from another through a stated method. |
| `investigates` | A study or hypothesis addresses a research question. |
| `produces` | A study generates an observation, finding, evidence, question, hypothesis, argument or proposal. |
| `informs` | A source contributes to a proposal or decision's rationale. |
| `supersedes` | A new record or relation explicitly revises an earlier identity. |

Schema validation checks structure and endpoint types. Admission resolves the
declared references and enforces the inference-method requirements. Readers
review the recorded argument, premises, context and limits when assessing an
authored proof or causal assertion.

`supports` records evidentiary bearing and its limits. A supporting source may
also support a competing hypothesis. `negates` records a logical complement
under explicit quantifier scope; `contradicts` records the stated incompatibility
of two propositions. `implies` needs the cited argument and inference rule.

`proves` and `disproves` retain authored deductions and counterexamples. Reviewing
a counterexample requires checking that its witness falls within the target
proposition's quantifier and applicability. Empirical findings usually carry
support or challenge relations. Proof and causal assertions retain their
reasoning for review; their presence does not establish verified truth.

The `causes` details name exposure and outcome variables, their subjects,
properties and values. They retain the mechanism, identification method and
alternative explanations. `produces` describes research outputs. `derived-from`
describes the derivation of a record.

## Entity and source references

A closed `entity` reference carries its URI and an optional readable label. It
identifies a physical, digital or conceptual thing. In an observation or causal
variable subject slot it names the thing whose property is recorded. This role
follows SOSA's feature of interest. An `artifact` reference identifies an
information carrier, such as a dataset or document, and may record its content
hash. A document can itself be the subject of an observation.

Entity URIs may be opaque URNs. Labels describe their referents; they do not
establish equivalence between different URIs. Source reads retain actual
availability and failure causes. The example identifies stream reaches as
entities and its field dataset as an artifact. Authored assertions retain the
record identity and revision rules below.

## Identity and reads

V1 nodes and edges share one identity namespace. An identical repeat write is
idempotent. Conflicting content retains its existing identity and requires a new
ID. Each explicit `supersedes` relation records a revision and its rationale.
A revision can name multiple predecessors; the authored relations retain its
complete history. Study revisions retain the same `studyIdentity` and state their
revised method or outputs.

Identity comparison ignores object member order and decodes JSON string escapes.
Array order, container types and complete values remain significant. Numeric
tokens retain their original spelling and precision: `1` and `1.0` are distinct
for record identity. Repeated object labels retain their occurrence order within
that label. Admission stores the first complete payload for an identical ID,
including repeated records in one batch.

References carry the declared node type or the edge type through `edgeKind`.
Admission resolves every nested reference to a stored v1 record or a record in
the same transaction. Resource references retain their complete identifiers and
provenance. External resource reads report their actual result and cause.

Read envelopes add schema identity, provenance, promotions and recorded
relations to the complete authored payload. Legacy records retain their original
content and labels with their own schema provenance. Promotion and holding
queries use the record's version namespace. Session and Ensemble holdings govern
visibility; the scientific context describes applicability.

Scientific MCP authoring, HTTP reads and the Knowledge inspector retain the
original JSON text of numeric fields. Numbers remain JSON numbers on the wire.
The JavaScript adapters associate each numeric token with its containing object
or array, and use that token when serializing, displaying or searching the
record. Contributors preserve those object identities when projecting complete
records. Scientific uncertainty, units and measurement scale retain their own
schema fields.

The Knowledge inspector places each type's scientific details first: measured
results for observations, inference and inputs for findings, predictions for
hypotheses, and premises and derivation for arguments. Connection cards show the
relation author, basis, scope, limits and uncertainty. Logical and causal labels
identify authored assertions whose reasoning remains available in the complete
relation record.

The inspector counts authored relations and explicit reference uses separately.
`References made` and `Referenced by` expose the stored reference paths in
evidence, context, details and relation basis within the returned reading. These
paths retain their recorded roles, including premises, inputs and study outputs.
Each reference opens its complete record. The local evidence array appears as
`Cited records`.

Search and traversal project each node's explicit evidence reference as a
`Cited` link from the citing record to its source. These links carry
`recorded-evidence` provenance and complete typed endpoints. Their `projectionKey`
contains the provenance, scientific record reference and evidence array index.
Consumers use that key for projected links and the stored identity for authored
edges. Citation links retain their own identity when an authored edge uses the
same display ID.

Scientific record keys use `v1:` followed by the stored ID. Message keys use
`message:` followed by the message ID. External source keys use `resource:`
followed by a JSON array containing the reference kind, URI and optional artifact
hash. Complete references retain their original URI, content hash and entity
label. Sources outside the selected holdings carry their declared kind.
Scientific records carry a literal detail command that explicitly reads all
holdings; message sources carry a delivery command. Other external sources
retain their complete typed URI and metadata.
