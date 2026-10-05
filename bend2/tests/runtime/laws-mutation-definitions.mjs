// Pure definition data for the runtime-values law mutation controls. This
// module is side-effect-free: importing it acquires nothing and runs
// nothing. The runnable acquisition lives in laws-mutations.mjs and imports
// these definitions.
//
// Each definition names its source file, the scoped law entry, the intended
// qualified law, the exact find/replace delta, and the expected and observed
// constructors the law comparison should produce. The authoritative digest
// is the SHA-256 over the canonical JSON of
// {name,file,entry,law,expected,observed,find,replace}; the historic
// digests below were published with handoff values-handoff-2 over exactly
// that canonicalization and are preserved unchanged.
//
// These definitions are this lane's own declaration. They are not claimed
// byte-compatible with the CDP lane's repo-relative five-member declaration
// or with the Interfaces prepared fragment; canonical alignment of the
// declaration shapes is routed through Synthesis and the sole Interfaces
// owner, and until then every consumer links cases by the definition digest
// recorded here and in each retained evidence row.

export const LAW_ENTRY = 'bend2/tests/runtime/observations-laws.bend';

export const MUTATION_DEFINITIONS = [
  {
    name: 'capture-record-changes-consistency',
    file: 'bend2/src/context/runtime/observations-capture.bend',
    entry: LAW_ENTRY,
    law: 'capture_record_carries_both_event_identities_and_the_fixed_consistency_pair',
    expected: 'CaptureRecord{consistency: "per-response", controlExclusivity: "unverified", ...}',
    observed: 'CaptureRecord{consistency: "per-response-wrong", controlExclusivity: "unverified", ...}',
    find: 'consistency: "per-response"',
    replace: 'consistency: "per-response-wrong"',
    historicDigest: '38ca74b589333e8533d9878bcf9f53959b4f8c1cb975e9f1d90db8546471797a',
  },
  {
    name: 'capture-record-claims-verified-exclusivity',
    file: 'bend2/src/context/runtime/observations-capture.bend',
    entry: LAW_ENTRY,
    law: 'capture_record_carries_both_event_identities_and_the_fixed_consistency_pair',
    expected: 'CaptureRecord{controlExclusivity: "unverified", ...}',
    observed: 'CaptureRecord{controlExclusivity: "verified", ...}',
    find: 'controlExclusivity: "unverified"',
    replace: 'controlExclusivity: "verified"',
    historicDigest: 'ff6bf44827a6985aa31c89539cd66c4d4964b2ba082ff8398ebad71621628145',
  },
  {
    name: 'unfinished-capture-manufactures-a-record',
    file: 'bend2/src/context/runtime/observations-capture.bend',
    entry: LAW_ENTRY,
    law: 'capture_without_an_end_event_stays_open',
    expected: 'CaptureOpen{detail: "multirequest capture has no end event identity"}',
    observed: 'CaptureRecord{startEvent, endEvent, consistency: "per-response", controlExclusivity: "unverified", epoch}',
    find: 'case False{}: CaptureOpen{detail: "multirequest capture has no end event identity"}',
    replace: 'case False{}: CaptureRecord{startEvent: startEvent, endEvent: endEvent, consistency: "per-response", controlExclusivity: "unverified", epoch: epoch}',
    historicDigest: 'bbc822d0c067ccfaf1a04f64f4506dbdc56ce0520244c1a77f5bc1c26478b1c4',
  },
  {
    name: 'runtime-evidence-drops-the-original-member',
    file: 'bend2/src/context/runtime/observations-capture.bend',
    entry: LAW_ENTRY,
    law: 'runtime_evidence_preserves_every_identity_member',
    expected: 'RuntimeEvidence{..., original: original}',
    observed: 'RuntimeEvidence{..., original: ""}',
    find: 'RuntimeEvidence{runtime: runtime, epoch: epoch, thread: thread, script: script, generated: generated, original: original}',
    replace: 'RuntimeEvidence{runtime: runtime, epoch: epoch, thread: thread, script: script, generated: generated, original: ""}',
    historicDigest: 'af990cd3c2b13b18e3470fe7530e61225ac9059965cd97416d210d7f74d85c40',
  },
  {
    name: 'runtime-facts-admit-checked',
    file: 'bend2/src/context/runtime/observations-classification.bend',
    entry: LAW_ENTRY,
    law: 'runtime_fact_admits_only_the_observed_classification',
    expected: 'fact_class_admitted(Checked{}) == False{}',
    observed: 'fact_class_admitted(Checked{}) == True{}',
    find: 'match cls:\n    case Observed{}: True{}\n    case StaticPossible{}: False{}\n    case Checked{}: False{}',
    replace: 'match cls:\n    case Observed{}: True{}\n    case StaticPossible{}: False{}\n    case Checked{}: True{}',
    historicDigest: '269109b2e6dace894697c673629dfa23e9be8245e880a1fdc046f49ed90736ca',
  },
  {
    name: 'expansion-upgrades-every-fact-to-observed',
    file: 'bend2/src/context/runtime/observations-classification.bend',
    entry: LAW_ENTRY,
    law: 'observed_expansion_refuses_every_other_classification',
    expected: 'expansion_admitted(Observed{}, StaticPossible{}) == False{}',
    observed: 'expansion_admitted(Observed{}, StaticPossible{}) == True{}',
    find: 'String.eq(class_tag(original), class_tag(proposed))',
    replace: 'True{}',
    historicDigest: '2684f70ca159e676bde5f37ae8305291ad365157fc65b2622358c2dfefc52dde',
  },
  {
    name: 'static-possible-tag-renamed',
    file: 'bend2/src/context/runtime/observations-classification.bend',
    entry: LAW_ENTRY,
    law: 'class_tags_are_the_four_fixed_names',
    expected: 'class_tag(StaticPossible{}) in {"observed", "static-possible", "checked", "declared"}',
    observed: 'class_tag(StaticPossible{}) == "static"',
    find: '"static-possible"',
    replace: '"static"',
    historicDigest: 'fd6955704ce7bc067c6ee809194dba6592eda3b5d9a6789f74da056e6de0b83f',
  },
  {
    name: 'completeness-ignores-the-preview',
    file: 'bend2/src/context/runtime/observations-classification.bend',
    entry: LAW_ENTRY,
    law: 'observed_value_completeness_follows_the_conservative_rule',
    expected: 'observed_value_complete(hasPreview, overflow) == Bool.and(Bool.not(hasPreview), Bool.not(overflow))',
    observed: 'observed_value_complete(hasPreview, overflow) == Bool.not(overflow)',
    find: 'Bool.and(Bool.not(hasPreview), Bool.not(expansionOverflow))',
    replace: 'Bool.not(expansionOverflow)',
    historicDigest: '2bbdb30007dea6630cc451f201ddf5a3ae6f9d4dd71546d27b3d925b85cdb1bf',
  },
];
