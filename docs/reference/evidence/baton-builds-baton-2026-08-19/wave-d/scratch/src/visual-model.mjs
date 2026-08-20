// Verification-only stub mirroring the sibling visual-model contract demonstrated by the pins:
// projectBatonVisualModel({ snapshot, width }) -> bounded model with .run (unwrapped from the
// ok/value envelope) and .attention (projected from the Run's attention).
export function projectBatonVisualModel({ snapshot, width } = {}) {
  const unwrap = (entry) => (entry && entry.ok === true ? entry.value : entry);
  const run = unwrap(snapshot?.run) ?? null;
  const attention = Array.isArray(run?.attention) ? run.attention : [];
  return {
    run,
    attention,
    accessibleSummary: `baton top visual model for ${run?.runId ?? 'no run'} at ${width} columns`,
    width,
  };
}
