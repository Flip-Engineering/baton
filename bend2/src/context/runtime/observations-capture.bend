# Operative capture composition for native runtime observation results. These
# functions are the runtime result path's constructors for capture records and
# runtime evidence items (docs/bend2/semantic-context-spec.md, Runtime
# contract and Results). Each law sits beside the function it binds; the
# coordinator entry imports this module through the shared laws handoff, and
# the isolated development entry is bend2/tests/runtime/observations-laws.bend.
#
# Epoch and mutation generation are canonical unsigned decimal counter strings
# owned by the CDP counter modules. This composition carries them unchanged.
# Event identities are protocol event identities; inspector endpoint URLs and
# UUIDs never enter capture records.

import Base

# One runtime evidence item. Every field is present; an observation without a
# member carries it as the field the codec renders as an explicit null.
type Evidence is Data:
  RuntimeEvidence{runtime: String, epoch: String, thread: String, script: String, generated: String, original: String}

# The capture record of one multirequest observation: its start and end
# protocol event identities, per-response consistency, unverified control
# exclusivity, and the epoch string the capture was taken at. CaptureOpen
# marks a capture whose end event identity has not been observed.
type Capture is Data:
  CaptureRecord{startEvent: String, endEvent: String, consistency: String, controlExclusivity: String, epoch: String}
  CaptureOpen{detail: String}

def runtime_evidence(runtime: String, epoch: String, thread: String, script: String, generated: String, original: String) -> Evidence:
  RuntimeEvidence{runtime: runtime, epoch: epoch, thread: thread, script: script, generated: generated, original: original}

def capture_identity(startEvent: String, endEvent: String, ended: Bool, epoch: String) -> Capture:
  match ended:
    case True{}: CaptureRecord{startEvent: startEvent, endEvent: endEvent, consistency: "per-response", controlExclusivity: "unverified", epoch: epoch}
    case False{}: CaptureOpen{detail: "multirequest capture has no end event identity"}

# The evidence constructor preserves every identity member in its own
# position; the codec renders absent members as explicit nulls from this
# shape, never by omission.
law runtime_evidence_preserves_every_identity_member:
  for +runtime: String
  for +epoch: String
  for +thread: String
  for +script: String
  for +generated: String
  for +original: String
  {runtime_evidence(runtime, epoch, thread, script, generated, original) == RuntimeEvidence{runtime: runtime, epoch: epoch, thread: thread, script: script, generated: generated, original: original} : Evidence}

def runtime_evidence_preserves_every_identity_member(runtime, epoch, thread, script, generated, original):
  {==}

# A finished capture record names both event identities and carries exactly
# the fixed consistency and exclusivity pair.
law capture_record_carries_both_event_identities_and_the_fixed_consistency_pair:
  for +start: String
  for +end: String
  for +epoch: String
  {capture_identity(start, end, True{}, epoch) == CaptureRecord{startEvent: start, endEvent: end, consistency: "per-response", controlExclusivity: "unverified", epoch: epoch} : Capture}

def capture_record_carries_both_event_identities_and_the_fixed_consistency_pair(start, end, epoch):
  {==}

# A capture without its end event identity stays open; no record is
# manufactured for it.
law capture_without_an_end_event_stays_open:
  for +start: String
  for +epoch: String
  {capture_identity(start, "unobserved", False{}, epoch) == CaptureOpen{detail: "multirequest capture has no end event identity"} : Capture}

def capture_without_an_end_event_stays_open(start, epoch):
  {==}
