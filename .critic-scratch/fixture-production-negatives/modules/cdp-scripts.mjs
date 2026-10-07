// CDP runtime lane: captured script metadata and loaded-source identity.
//
// Contract: docs/bend2/semantic-context-spec.md, "Runtime contract" (runtime
// identity) and "Results" (evidence). This module keeps what the protocol
// reported: Debugger.scriptParsed metadata, the loaded source text of a script
// and its digest, and the source-map reference the map owner resolves. Disk
// bytes, loaded bytes and source-map bytes are separate identities; this module
// never reads disk bytes and never decodes a map. Source-map resolution and
// value projection belong to the observations owner.
//
// Debugger.scriptParsed carries generated positions only: V8 applies no source
// map to protocol frames, so the recorded positions here stay generated.

import { createHash } from 'node:crypto';

export class ScriptRefusal extends Error {
  constructor(condition, detail) {
    super(detail === undefined || detail === null ? condition : `${condition}: ${detail}`);
    this.name = 'ScriptRefusal';
    this.condition = condition;
    this.detail = detail === undefined ? null : detail;
  }
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const text = (value) => typeof value === 'string' && value.length > 0;

// The normalized fields this lane relies on. The complete protocol parameters
// are retained beside them, so a projection that needs another field reads it
// from `protocol` rather than from a lossy copy.
function normalize(params) {
  return {
    scriptId: String(params.scriptId),
    url: typeof params.url === 'string' ? params.url : '',
    sourceMapURL: typeof params.sourceMapURL === 'string' ? params.sourceMapURL : null,
    hash: typeof params.hash === 'string' ? params.hash : null,
    executionContextId: Number.isSafeInteger(params.executionContextId) ? params.executionContextId : null,
    workerId: typeof params.workerId === 'string' ? params.workerId : null,
    startLine: Number.isSafeInteger(params.startLine) ? params.startLine : null,
    startColumn: Number.isSafeInteger(params.startColumn) ? params.startColumn : null,
    endLine: Number.isSafeInteger(params.endLine) ? params.endLine : null,
    endColumn: Number.isSafeInteger(params.endColumn) ? params.endColumn : null,
    isModule: params.isModule === true,
  };
}

export function createScriptTable() {
  const byId = new Map();
  const byUrl = new Map();

  return {
    // Debugger.scriptParsed. A repeated scriptId with a different url is a
    // protocol defect rather than a silent overwrite.
    record(params) {
      if (typeof params !== 'object' || params === null || params.scriptId === undefined) {
        throw new ScriptRefusal('scriptParsedMalformed', null);
      }
      const entry = { ...normalize(params), protocol: params, loaded: null, mapIdentity: null };
      const existing = byId.get(entry.scriptId);
      if (existing !== undefined && existing.url !== entry.url) {
        throw new ScriptRefusal('scriptIdentityConflict',
          `${entry.scriptId} was ${existing.url} and is now ${entry.url}`);
      }
      byId.set(entry.scriptId, entry);
      if (text(entry.url)) {
        const urls = byUrl.get(entry.url) ?? [];
        byUrl.set(entry.url, [...urls, entry.scriptId]);
      }
      return entry;
    },

    // Debugger.getScriptSource: the loaded bytes of one script, kept as the
    // exact text with its length and digest. A source map is recorded as the
    // reference the map owner resolves, not as decoded mappings.
    attachLoaded({ scriptId, source }) {
      const entry = byId.get(String(scriptId));
      if (entry === undefined) throw new ScriptRefusal('scriptUnknown', String(scriptId));
      if (typeof source !== 'string') throw new ScriptRefusal('scriptSourceMalformed', String(scriptId));
      entry.loaded = { length: source.length, sha256: sha256(source), source };
      entry.mapIdentity = entry.sourceMapURL === null
        ? null
        : { url: entry.sourceMapURL, sha256: sha256(entry.sourceMapURL), embedded: entry.sourceMapURL.startsWith('data:') };
      return {
        scriptId: entry.scriptId,
        url: entry.url,
        loaded: { length: entry.loaded.length, sha256: entry.loaded.sha256 },
        map: entry.mapIdentity,
      };
    },

    get(scriptId) {
      return byId.get(String(scriptId)) ?? null;
    },

    byUrl(url) {
      return (byUrl.get(url) ?? []).map((scriptId) => byId.get(scriptId));
    },

    list() {
      return [...byId.values()];
    },

    count() {
      return byId.size;
    },
  };
}
