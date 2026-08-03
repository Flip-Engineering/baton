// Flip — the baton mascot (docs/assets/brand/mascot-smile.svg, mascot-thinking.svg) —
// as terminal faces for the CLI and MCP surfaces. The character's signature: big round
// eyes, the wide smile, gold cheek sparkles; the thinking pose adds the raised brow and
// a teal thought bubble. Faces go to stderr (the human channel) — stdout stays
// machine-clean JSON. ANSI color only when the stream is a TTY; plain unicode otherwise.

const ANSI = Object.freeze({
  pink: '[38;5;211m',
  gold: '[38;5;220m',
  teal: '[38;5;80m',
  reset: '[0m',
});

export const FLIP_POSES = Object.freeze(['smile', 'thinking']);

const FACES = Object.freeze({
  smile: Object.freeze({
    plain: '✦(◕‿◕)✦',
    ansi: `${ANSI.gold}✦${ANSI.pink}(◕‿◕)${ANSI.gold}✦${ANSI.reset}`,
  }),
  thinking: Object.freeze({
    plain: '✦(◕﹏◕)◦',
    ansi: `${ANSI.gold}✦${ANSI.pink}(◕﹏◕)${ANSI.teal}◦${ANSI.reset}`,
  }),
});

/** The mascot's face for a moment: 'smile' (ready/success) or 'thinking' (working/waiting).
 * @param {'smile'|'thinking'} pose
 * @param {{color?: boolean}} [opts] — color defaults off; callers pass stream.isTTY === true. */
export function flipFace(pose = 'smile', { color = false } = {}) {
  const face = FACES[pose];
  if (!face) throw Object.assign(new Error(`unknown Flip pose: ${pose}`), { code: 'brand_pose_invalid' });
  return color ? face.ansi : face.plain;
}

/** One-line brand mark for interactive moments (help, serve lifecycle, doctor). */
export function flipLine(text, { pose = 'smile', color = false } = {}) {
  return `${flipFace(pose, { color })} ${text}`;
}
