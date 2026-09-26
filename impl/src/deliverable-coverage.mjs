// Issue #165 (contract-foundry-2026-08-13/contract-165.md, D2): the ONE strict `## Deliverables`
// front-matter parser and the ONE coverage predicate. The driver's launch check (D2a, against
// `--targets`) and the interpreter's objective-render check (D2b, against `harvest.paths`) read the
// same brief convention through this module, so the grammar and the path normalization have a
// single derivation on both surfaces.
//
// The grammar is closed, never a loose prose parse: a `## Deliverables` section holds bullets
// (`- <path>` / `* <path>`) and bare paths only, every path is positive-shape-valid, and any other
// line is malformed. The caller owns the typed refusal — this module names the offending line and
// lets the driver (`deliverables_malformed`) and the interpreter (`workflow_harvest_invalid`) mint
// their own codes.

const SECTION_HEADING = '## Deliverables';
const HEADING = /^(#{1,6})[ \t]*(.*)$/u;
const FENCE_MARKER = /^(?:```|~~~)$/u;

// A near-miss heading cannot silently disable the coverage guarantee: `## Deliverables` at any
// other depth, or the wrong word after the marker (e.g. `## Deliverable Files`), refuses.
function isNearMissHeading(text) {
  const heading = HEADING.exec(text);
  if (!heading) return false;
  if (heading[2] === 'Deliverables') return heading[1] !== '##';
  return /^Deliverable\b/u.test(heading[2]);
}

// The interpreter's own bare-directory precedent (workflow-interpreter.mjs admitMember): a basename
// without a `.` is a directory shape, not a file path. The same escape class
// `assertHarvestContained` enforces applies here.
function isPositivePathShape(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.includes('\0') || value.startsWith('/') || value.includes('\\')) return false;
  if (value.split('/').includes('..')) return false;
  if (/\s/u.test(value)) return false;
  return value.includes('/') || (value.split('/').pop() ?? '').includes('.');
}

/**
 * Strict-parse a brief's optional `## Deliverables` front-matter.
 * Returns `{ declared, malformed }`; `malformed` is the offending raw line (null when the brief
 * carries no section or a well-formed one). Never guesses which prose tokens are paths.
 */
export function parseDeliverableDeclarations(text) {
  const declared = [];
  let malformed = null;
  let inSection = false;
  let fenced = false;
  for (const raw of String(text).split(/\r?\n/u)) {
    const line = raw.trim();
    // A fenced region is documentation, not a live section (a fenced example or path list is never
    // parsed) — the marker line toggles the region and carries no deliverable.
    if (FENCE_MARKER.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    if (malformed === null && isNearMissHeading(line)) { malformed = line; continue; }
    if (!inSection) {
      if (line === SECTION_HEADING) inSection = true;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      // A `#`/`##` heading ends the section; a deeper subsection does not, so its bullets stay in
      // scope (contract-165 D2-H3).
      if (heading[1].length <= 2) break;
      continue;
    }
    if (line === '') continue;
    const candidate = line.startsWith('- ') || line.startsWith('* ') ? line.slice(2) : line;
    if (!isPositivePathShape(candidate)) { malformed = line; continue; }
    declared.push(candidate);
  }
  return { declared, malformed };
}

/** The one-pass normalization both surfaces apply before the coverage set difference. */
export function normalizeDeliverablePath(value) {
  let out = String(value ?? '').trim();
  while (out.startsWith('./')) out = out.slice(2);
  out = out.replace(/\/{2,}/gu, '/');
  return out.replace(/\/+$/u, '');
}

function normalizedEntry(entry) {
  return normalizeDeliverablePath(typeof entry === 'string' ? entry : entry?.path ?? '');
}

/** `declared − targets` over the normalized sets; targets may be paths or `{path, mustContain}`. */
export function uncoveredDeliverables(declared, targets) {
  const covered = new Set((targets ?? []).map(normalizedEntry));
  const missing = new Set();
  for (const item of declared ?? []) {
    const normalized = normalizeDeliverablePath(item);
    if (normalized.length > 0 && !covered.has(normalized)) missing.add(normalized);
  }
  return [...missing];
}
