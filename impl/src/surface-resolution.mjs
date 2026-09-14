// Canonical surface resolution (2026-09-14 audit, U-N1/U-N2/U-N5; issue #289).
//
// The canonical operation registry (application-semantics.mjs) marks each operation with the
// surfaces that serve it. Before this module, nothing checked those claims: a row could claim
// `cli` with no parser verb (run.attention.list, run.scratchpad.append), claim `mcp` with no
// advertised tool (run.attention.list), or claim `web` with no admitted transport
// (context.eval), and every gate stayed green because each hand-kept list was compared against
// itself. This module resolves each claimed surface to the concrete NAME that surface serves —
// the shipped MCP tool table, the CLI parser, the web command map — and reports every claim that
// resolves to nothing.
//
// The three witnesses are the shipped surfaces themselves, never a second registry projection:
//   cli — parseBatonCli(operation.example) compiles, and (when it compiles to a command) the
//         name it compiles to is a name the CLI actually dispatches (web-client whitelist or a
//         host-local verb). A row whose taught example does not parse is a surface lie.
//   web — the operation's web transport (or canonical dot name) is admitted by the web command
//         map, or the operation is an authorized action the advertised run.do lane reaches.
//   mcp — an advertised tool dispatches the operation's bus command (every shipped table), or the
//         operation is an authorized action the advertised run.do tool reaches.
// `embedded` is the registry's own in-process identity (the row's liveMethod) and needs no
// further witness.
import { APPLICATION_SEMANTIC_REGISTRY, applicationOperationAliasMap } from './application-semantics.mjs';
import { commandForTool, mcpCombinedToolNames, mcpToolCommandPairs } from './mcp-northbound.mjs';
import { HOST_LOCAL_CLI_COMMANDS, cliBusCommand, cliDispatches, parseBatonCli } from './application-cli.mjs';
import { webAdmittedCommandNames } from './web-northbound.mjs';

const SURFACES = Object.freeze(['cli', 'mcp', 'web']);
const combinedToolNames = () => mcpCombinedToolNames();

/** The bus command (application command name) a canonical key dispatches as: its legacy transport
 * when the alias map carries one, else the key itself. `run.view` → `run.inspect`. */
export function busCommandFor(operation) {
  const aliases = applicationOperationAliasMap();
  return Object.hasOwn(aliases, operation.key) ? aliases[operation.key] : operation.key;
}

/** True when the operation is a semantic action dispatched through the advertised run.do lane. */
function runsThroughAct(operation) {
  const actions = APPLICATION_SEMANTIC_REGISTRY.actions;
  return typeof operation.liveMethod === 'string' && Object.hasOwn(actions, operation.liveMethod);
}

/** The witness for the web surface: the admitted transport for the operation, or the generic
 * run.act lane for an authorized action. */
export function webWitness(operation) {
  const admitted = new Set(webAdmittedCommandNames());
  for (const name of [operation.names?.web, operation.names?.canonical, operation.key]) {
    if (typeof name === 'string' && admitted.has(name)) return name;
  }
  if (runsThroughAct(operation) && admitted.has('run_act')) return 'run.act';
  return null;
}

/** The witness for the mcp surface: an advertised tool dispatching the bus command, or the
 * generic run.act tool for an authorized action. */
export function mcpWitness(operation) {
  const bus = busCommandFor(operation);
  for (const { tool, command } of mcpToolCommandPairs()) {
    if (command === bus) return tool;
  }
  if (typeof operation.names?.mcp === 'string') {
    for (const tool of combinedToolNames()) {
      if (tool === operation.names.mcp) return tool;
    }
  }
  if (runsThroughAct(operation) && commandForTool('baton_run_act') === 'run.act') return 'baton_run_act';
  return null;
}

// Placeholder → sample substitutions for the taught examples' ALL_CAPS tokens. The table is a
// doc-string concern only: it lets a pedagogical example ("--plan DIGEST", "WAVE_ID") parse under
// the very validators a caller's real value must pass, so the witness proves the VERB is served
// rather than proving the placeholder is a valid identifier.
const EXAMPLE_SAMPLES = Object.freeze({
  WAVE_ID: `wave:${'a'.repeat(32)}`,
  MESSAGE_ID: `message:${'a'.repeat(64)}`,
  JSON: '[]',
  FILE: 'probe.json',
});
function exampleSample(token) {
  if (Object.hasOwn(EXAMPLE_SAMPLES, token)) return EXAMPLE_SAMPLES[token];
  if (/DIGEST|SHA/u.test(token)) return 'a'.repeat(64);
  return token;
}

/** Tokenize a taught example into argv. The program name is implicit, quoted values are one
 * token, ALL_CAPS placeholders receive their sample value, and a trailing `[--flag VALUE]` marks
 * an optional tail (the registry's own notation) — the witness parses the required form. */
function exampleArgv(example) {
  const text = example.replace(/^baton\s+/u, '').replace(/\s*\[[^\]]*\]\s*$/u, '').trim();
  const argv = [];
  for (const match of text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/gu)) {
    const token = match[1] ?? match[2] ?? match[3];
    argv.push(/^[A-Z][A-Z0-9_]*$/u.test(token) ? exampleSample(token) : token);
  }
  return argv;
}
/** The witness for the cli surface: the parsed taught example, plus the CLI dispatch identity it
 * must reach. Returns `{ example, kind, name }` when the row is served, `{ reason }` otherwise. */
export function cliWitness(operation) {
  const example = operation.example;
  if (typeof example !== 'string' || example.length === 0) {
    return { reason: 'the operation teaches no CLI example' };
  }
  let parsed;
  try {
    parsed = parseBatonCli(exampleArgv(example));
  } catch (error) {
    return { reason: `its taught example "${example}" does not parse (${error?.code ?? error?.message ?? 'error'})` };
  }
  if (parsed?.kind === 'command') {
    // The dispatch identity the CLI reaches: the parsed name itself, its legacy transport
    // (`run watch` → run.follow), or a host-local port (run.debug).
    const name = parsed.name;
    const bus = cliBusCommand(name);
    if (cliDispatches(bus) || HOST_LOCAL_CLI_COMMANDS.has(name)) {
      return { example, kind: 'command', name: bus };
    }
    return { reason: `its taught example dispatches ${String(name)}, which the CLI does not serve` };
  }
  // Non-command parse results (doctor, route, serve, credential-install, semantic-action, follow,
  // adopt, integrate, …) are in-process CLI verbs: the compile itself is the witness.
  return { example, kind: parsed?.kind ?? 'unknown', name: null };
}

/** Resolve one operation's claimed surfaces. `findings` are claims that resolve to nothing. */
export function resolveOperationSurfaces(operation) {
  const witnesses = {};
  const findings = [];
  for (const surface of SURFACES) {
    if (!operation.surfaces.includes(surface)) continue;
    const witness = surface === 'cli' ? cliWitness(operation)
      : surface === 'web' ? webWitness(operation)
        : mcpWitness(operation);
    if (witness === null || witness?.reason !== undefined) {
      findings.push(Object.freeze({
        key: operation.key,
        surface,
        reason: witness?.reason ?? `no ${surface} name resolves to it`,
      }));
      continue;
    }
    witnesses[surface] = witness;
  }
  return Object.freeze({
    key: operation.key,
    witnesses: Object.freeze(witnesses),
    findings: Object.freeze(findings),
  });
}

/** Every canonical operation claiming a surface it cannot resolve, in registry order. An empty
 * list is the surface-resolution invariant: every declared surface has a served name. */
export function canonicalSurfaceResolutionFindings() {
  const findings = [];
  for (const operation of APPLICATION_SEMANTIC_REGISTRY.canonicalOperations) {
    findings.push(...resolveOperationSurfaces(operation).findings);
  }
  return Object.freeze(findings);
}

/** One finding, formatted for a gate line or a thrown doc-generator refusal. */
export function formatSurfaceResolutionFinding(finding) {
  return `canonical operation ${finding.key} claims the ${finding.surface} surface but ${finding.reason}`;
}
