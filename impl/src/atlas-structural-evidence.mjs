import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, normalize, sep } from 'node:path';

const EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const slash = (value) => value.split(sep).join('/');
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const confined = (value) => {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value)) throw Object.assign(new Error('structural evidence path is invalid'), { code: 'path_escape' });
  const path = normalize(value);
  if (path === '..' || path.startsWith(`..${sep}`)) throw Object.assign(new Error('structural evidence path escapes its tree'), { code: 'path_escape' });
  return slash(path);
};
const source = (root, path, ceiling) => {
  const full = join(root, path); const stat = lstatSync(full);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > ceiling) throw Object.assign(new Error('structural evidence source exceeds its ceiling'), { code: 'invalid_source' });
  return readFileSync(full, 'utf8');
};
const signatures = (text) => [...text.matchAll(/(?:^|\n)\s*(?:export\s+(?:default\s+)?)?(?:(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)|class\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[^\s{]+)?|interface\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[^\n{]+)?|type\s+[A-Za-z_$][\w$]*\s*=|(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=)/g)]
  .map((match) => match[0].trim().replace(/\s+/g, ' ').replace(/\s*([(),=:])\s*/g, '$1')).sort();

export class AtlasStructuralEvidence {
  constructor({ structural, artifactRoot, maxArtifactBytes, maxSourceBytes }) {
    if (!structural || typeof structural.invoke !== 'function') throw new TypeError('structural evidence requires atlas-structural');
    if (typeof artifactRoot !== 'string' || artifactRoot.length === 0) throw new TypeError('structural evidence artifactRoot required');
    if (!Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes <= 0 || !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes <= 0) throw new TypeError('structural evidence ceilings required');
    this.structural = structural; this.artifactRoot = artifactRoot; this.maxArtifactBytes = maxArtifactBytes; this.maxSourceBytes = maxSourceBytes;
    mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  }

  async classify({ beforeRoot, afterRoot, changedPaths, budgetTokens = 20_000 }) {
    if (typeof beforeRoot !== 'string' || typeof afterRoot !== 'string' || !Array.isArray(changedPaths)) throw new TypeError('structural evidence trees and paths required');
    const files = []; const refs = []; let signatureChanged = false; let logicChanged = false; let supported = 0;
    for (const rawPath of [...new Set(changedPaths)].sort()) {
      const path = confined(rawPath); const before = join(beforeRoot, path); const after = join(afterRoot, path);
      const beforeExists = existsSync(before); const afterExists = existsSync(after); const supportedLanguage = EXTENSIONS.has(extname(path).toLowerCase());
      const counts = { added: 0, removed: 0, modified: 0 };
      let fileClass = 'honest_empty';
      if (supportedLanguage) {
        supported += 1;
        if (beforeExists && afterExists) {
          const result = await this.structural.invoke('diff.structural', { beforePath: path, afterPath: path }, { beforeRoot, afterRoot, budgetTokens, actor: 'policy' });
          for (const item of result.payload) counts[item.change] += 1;
          const beforeSignatures = signatures(source(beforeRoot, path, this.maxSourceBytes));
          const afterSignatures = signatures(source(afterRoot, path, this.maxSourceBytes));
          const changedSignature = stable(beforeSignatures) !== stable(afterSignatures);
          fileClass = changedSignature ? 'signature_changed' : result.payload.length > 0 ? 'logic_changed' : 'pure_reformat';
          signatureChanged ||= changedSignature; logicChanged ||= result.payload.length > 0;
          refs.push(...result.refs.map((ref) => ({ handle: ref.handle, kind: ref.kind, digest: ref.digest, bytes: ref.bytes, mediaType: ref.mediaType })));
        } else {
          counts[beforeExists ? 'removed' : 'added'] = 1;
          const text = source(beforeExists ? beforeRoot : afterRoot, path, this.maxSourceBytes);
          fileClass = signatures(text).length > 0 ? 'signature_changed' : 'logic_changed';
          signatureChanged ||= fileClass === 'signature_changed'; logicChanged ||= fileClass === 'logic_changed';
        }
      }
      files.push({ path, changeClass: fileClass, counts });
    }
    const changeClass = signatureChanged ? 'signature_changed' : logicChanged ? 'logic_changed' : 'pure_reformat';
    const document = {
      schemaVersion: 1, kind: 'structural-class', operation: 'diff.structural', rung: 'R1', changeClass, files, sourceRefs: refs,
      languageCeiling: { family: 'javascript-typescript', status: supported === 0 ? 'honest_empty' : 'applied', extensions: [...EXTENSIONS].sort() },
      ceiling: { maxArtifactBytes: this.maxArtifactBytes, maxSourceBytes: this.maxSourceBytes, enforcingGate: 'atlas-representation-ceiling' },
    };
    const serialized = `${stable(document)}\n`; const bytes = Buffer.byteLength(serialized);
    if (bytes > this.maxArtifactBytes) throw Object.assign(new Error('structural-class artifact exceeds deployment ceiling'), { code: 'artifact_too_large' });
    const digest = sha(serialized); const path = join(this.artifactRoot, `${digest}.json`);
    if (!existsSync(path)) writeFileSync(path, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const observed = readFileSync(path);
    if (observed.length !== bytes || sha(observed) !== digest) throw Object.assign(new Error('structural-class artifact integrity failure'), { code: 'artifact_integrity' });
    return Object.freeze({ changeClass, files, digest, bytes, path, handle: `art:sha256:${digest}`, mediaType: 'application/vnd.baton.atlas-structural-class+json', languageCeiling: document.languageCeiling, ceiling: document.ceiling });
  }
}
