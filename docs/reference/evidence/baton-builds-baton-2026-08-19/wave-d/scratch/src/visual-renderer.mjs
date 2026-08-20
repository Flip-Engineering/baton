// Verification-only stub mirroring the sibling visual-renderer contract: renderBatonVisual
// (model, { width, color, motion, view }) -> a static Unicode frame (ANSI only when color).
export function renderBatonVisual(model, { width, color = false, motion = false, view = 'overview' } = {}) {
  const lines = [
    `baton top — ${view}`,
    `run: ${model?.run?.runId ?? 'no run selected'}`,
    `attention: ${Array.isArray(model?.attention) ? model.attention.length : 0} item(s)`,
  ];
  if (color) return lines.map((line) => `\u001b[36m${line}\u001b[0m`).join('\n');
  return lines.join('\n');
}
