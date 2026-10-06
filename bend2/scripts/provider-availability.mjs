#!/usr/bin/env node
// Live provider and model availability discovery for Baton2 (#683).
//
// Queries each configured harness for its current model catalog and
// reconciles a caller-supplied configured selector list against live
// metadata. Supports quota-failover selection (#681): a refused selector
// is excluded from the candidate list while its failure stays recorded
// as history.
//
// Single-shot query. No daemon, no polling loop, no hard-coded model
// allowlist. Every reported fact carries its observation time. A past
// quota failure never marks a model unavailable; only the live catalog
// and the caller's current refusal decide the candidate list. Harnesses
// without a metadata query report unknown, never unavailable.
//
// Usage:
//   node bend2/scripts/provider-availability.mjs --omp PATH
//     --configured FILE [--refused SELECTOR --refused-reason TEXT]
//     [--history FILE] [--now ISO] [--out FILE]
//
// --configured FILE: JSON array of selectors, or {"selectors": [...]}
// --history FILE:    JSON array of {selector, outcome, detail, observedAt}
// --now ISO:         observation timestamp (default: current UTC time)
// --out FILE:        write the JSON report to FILE instead of stdout
//
// Exit 0 with a report on stdout even when a harness answer is unknown.
// Exit 2 for caller errors (bad options, unreadable input files,
// unwritable output file).
//
// No npm dependencies; node stdlib only.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

export function modelIdOf(selector) {
  const text = String(selector);
  const slash = text.indexOf('/');
  return slash < 0 ? text : text.slice(slash + 1);
}

// Parse one harness catalog document into a normalized model list.
// Throws on malformed JSON; the caller records the harness as unknown.
export function parseCatalog(jsonText) {
  const document = JSON.parse(String(jsonText));
  const entries = Array.isArray(document) ? document : document.models;
  if (!Array.isArray(entries)) throw new Error('catalog has no models array');
  return entries.map((entry) => ({
    selector: String(entry.selector || entry.id || ''),
    provider: String(entry.provider || ''),
    id: String(entry.id || modelIdOf(entry.selector || '')),
    name: String(entry.name || ''),
    kind: String(entry.kind || ''),
    thinking: Array.isArray(entry.thinking) ? entry.thinking.map(String) : null,
    contextWindow: typeof entry.contextWindow === 'number' ? entry.contextWindow : null,
  })).filter((model) => model.selector !== '');
}

// Reconcile configured selectors against the live catalog. A configured
// selector is catalogued when it matches a catalog entry exactly or
// shares a model id with one (provider alias). Absence from the catalog
// reports not-in-catalog, which is distinct from unavailable.
export function reconcile(configuredSelectors, catalogModels) {
  const selectors = [...new Set(configuredSelectors.map(String))];
  return selectors.map((selector) => {
    const exact = catalogModels.filter((model) => model.selector === selector);
    const aliases = catalogModels.filter((model) => model.id === modelIdOf(selector));
    const matches = [...new Set([...exact, ...aliases].map((model) => model.selector))].sort();
    return { selector, state: matches.length > 0 ? 'catalogued' : 'not-in-catalog', matches };
  });
}

// Rank failover candidates from the live catalog, excluding the refused
// selector. Catalog order is preserved; selection policy stays with the
// Conductor. History failures are returned untouched and decide nothing.
export function rankCandidates(catalogModels, refused) {
  const usable = catalogModels.filter((model) => model.kind === '' || model.kind === 'chat');
  const candidates = refused
    ? usable.filter((model) => model.selector !== refused.selector)
    : usable.slice();
  return {
    candidates: candidates.map((model) => model.selector),
    refused: refused
      ? { selector: refused.selector, reason: refused.reason, refusedAt: refused.refusedAt }
      : null,
  };
}

export function buildReport({ observedAt, omp, configured, history }) {
  const ranking = rankCandidates(omp.state === 'queried' ? omp.models : [], configured.refused || null);
  return {
    observedAt,
    harnesses: {
      omp,
      codex: { state: 'unknown', reason: 'no live metadata query for the codex harness in this tool' },
      muse: { state: 'unknown', reason: 'no live metadata query for the muse harness in this tool' },
      claude: { state: 'unknown', reason: 'no live metadata query for the claude harness in this tool' },
    },
    configured: configured.reconciliation,
    candidates: ranking.candidates,
    refused: ranking.refused,
    currentQuota: {
      state: 'unknown',
      reason: 'the omp catalog carries no quota windows; history entries below are past events, not current state',
    },
    history: history || [],
  };
}

function readJsonFile(path, name) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${name} file ${path}: ${error.message}`);
  }
}

function loadConfigured(path) {
  if (!path) return [];
  const document = readJsonFile(path, 'configured');
  const selectors = Array.isArray(document) ? document : document.selectors;
  if (!Array.isArray(selectors) || !selectors.every((item) => typeof item === 'string')) {
    throw new Error(`configured file ${path} must be a string array or {"selectors": [...]}`);
  }
  return selectors;
}

function loadHistory(path) {
  if (!path) return [];
  const document = readJsonFile(path, 'history');
  if (!Array.isArray(document)) throw new Error(`history file ${path} must be an array`);
  return document;
}

function parseArgs(argv) {
  const options = { omp: null, configured: null, refused: null, refusedReason: '', history: null, now: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    const need = (name) => {
      if (value === undefined) throw new Error(`${name} requires a value`);
      i++;
      return value;
    };
    if (arg === '--omp') options.omp = need('--omp');
    else if (arg === '--configured') options.configured = need('--configured');
    else if (arg === '--refused') options.refused = need('--refused');
    else if (arg === '--refused-reason') options.refusedReason = need('--refused-reason');
    else if (arg === '--history') options.history = need('--history');
    else if (arg === '--now') options.now = need('--now');
    else if (arg === '--out') options.out = need('--out');
    else throw new Error(`unknown option: ${arg}`);
  }
  if (!options.omp) throw new Error('missing required --omp PATH');
  return options;
}

function queryOmp(ompPath, observedAt) {
  try {
    const output = execFileSync(ompPath, ['models', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const models = parseCatalog(output);
    return { state: 'queried', observedAt, count: models.length, models };
  } catch (error) {
    return { state: 'unknown', observedAt, reason: `omp models query failed: ${error.message}` };
  }
}

export function writeReport(text, outPath) {
  if (!outPath) {
    process.stdout.write(text);
    return;
  }
  writeFileSync(outPath, text);
}

function usage() {
  return (
    'usage: provider-availability.mjs --omp PATH --configured FILE [--refused SELECTOR ' +
    '--refused-reason TEXT] [--history FILE] [--now ISO] [--out FILE]\n'
  );
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}`);
    process.exitCode = 2;
    return;
  }
  let configuredSelectors;
  let history;
  try {
    configuredSelectors = loadConfigured(options.configured);
    history = loadHistory(options.history);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  const observedAt = options.now || new Date().toISOString();
  const omp = queryOmp(options.omp, observedAt);
  const catalogModels = omp.state === 'queried' ? omp.models : [];
  const refused = options.refused
    ? { selector: options.refused, reason: options.refusedReason, refusedAt: observedAt }
    : null;
  const report = buildReport({
    observedAt,
    omp,
    configured: { reconciliation: reconcile(configuredSelectors, catalogModels), refused },
    history,
  });
  const text = JSON.stringify(report, null, 2) + '\n';
  try {
    writeReport(text, options.out);
  } catch (error) {
    process.stderr.write(`cannot write report to ${options.out}: ${error.message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main(process.argv.slice(2));
}
