# Isolated development entry for the runtime-values law modules. It compiles
# the two delivered production modules standalone while the interfaces owner
# has not yet composed the shared coordinator/laws.bend import; the exact
# import fragment rides the lane handoff. This entry is not part of the
# coordinator's import graph and carries no production obligation.
import Base
import ../../src/context/runtime/observations-capture.bend as ObsCapture
import ../../src/context/runtime/observations-classification.bend as ObsClassify

def observations_entry_observed_class_is_admitted() -> Bool:
  ObsClassify.fact_class_admitted(ObsClassify.Observed{})

def observations_entry_preview_blocks_completeness() -> Bool:
  Bool.not(ObsClassify.observed_value_complete(True{}, False{}))

def observations_entry_expansion_preserves_declared() -> Bool:
  ObsClassify.expansion_admitted(ObsClassify.Declared{}, ObsClassify.Declared{})

def observations_entry_finished_capture_record() -> ObsCapture.Capture:
  ObsCapture.capture_identity("Debugger.paused", "Runtime.getProperties", True{}, "7")

def observations_entry_open_capture() -> ObsCapture.Capture:
  ObsCapture.capture_identity("Debugger.paused", "Runtime.getProperties", False{}, "7")

def observations_entry_runtime_evidence() -> ObsCapture.Evidence:
  ObsCapture.runtime_evidence("rt:q7", "12", "main:0", "42", "gen.js:10:4", "src/main.ts:13:2")
