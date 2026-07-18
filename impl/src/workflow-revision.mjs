import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function workflowRevisionDigest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function fail(message) {
  throw Object.assign(new TypeError(message), { code: 'workflow_revision_invalid' });
}

function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    fail(`${label} has unknown or missing fields`);
  }
}

const SECRET_SHAPED_TEXT = Object.freeze([
  /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/u,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|credential|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/iu,
  /\b(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
]);

function text(value, maxBytes, label) {
  if (typeof value !== 'string' || value.includes('\0')) fail(`${label} is invalid`);
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0 || Buffer.byteLength(normalized) > maxBytes
    || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(normalized))) fail(`${label} is invalid`);
  return normalized;
}

function digest(value, label) {
  if (!/^[a-f0-9]{64}$/u.test(value ?? '')) fail(`${label} is invalid`);
  return value;
}

function safePath(value) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > 4_096
    || value.includes('\0') || value.includes('\\') || value.startsWith('/')
    || value.split('/').some((part) => part.length === 0 || part === '.' || part === '..')) {
    fail('revision changed path is invalid');
  }
  return value;
}

function artifact(value, label) {
  exact(value, ['id', 'digest'], label);
  if (!/^artifact:[a-f0-9]{64}$/u.test(value.id ?? '')) fail(`${label} id is invalid`);
  return { id: value.id, digest: digest(value.digest, `${label} digest`) };
}

function feedbackBody(value) {
  exact(value, ['summary', 'findings'], 'revision feedback body');
  if (!Array.isArray(value.findings) || value.findings.length === 0 || value.findings.length > 32) {
    fail('revision feedback findings are invalid');
  }
  const findings = value.findings.map((finding) => {
    exact(finding, ['kind', 'severity', 'message', 'path', 'line'], 'revision feedback finding');
    if (!['contradiction', 'defect', 'risk', 'suggestion', 'question', 'observation'].includes(finding.kind)
      || !['info', 'low', 'medium', 'high', 'critical'].includes(finding.severity)
      || (finding.path !== null && typeof finding.path !== 'string')
      || (finding.line !== null && (!Number.isSafeInteger(finding.line) || finding.line <= 0))
      || (finding.line !== null && finding.path === null)) fail('revision feedback finding is invalid');
    return {
      kind: finding.kind, severity: finding.severity,
      message: text(finding.message, 4_096, 'revision feedback message'),
      path: finding.path === null ? null : safePath(finding.path), line: finding.line,
    };
  });
  return { summary: text(value.summary, 4_096, 'revision feedback summary'), findings };
}

function normalizeCore(value) {
  exact(value, [
    'schemaVersion', 'kind', 'round', 'workflow', 'predecessorPlan', 'parent', 'feedback',
    'decision',
  ], 'workflow revision');
  if (value.schemaVersion !== 1 || value.kind !== 'candidate_feedback_revision'
    || !Number.isSafeInteger(value.round) || value.round <= 0 || value.round > 1_000_000) {
    fail('workflow revision header is invalid');
  }
  exact(value.workflow, ['definitionDigest'], 'workflow revision authority');
  exact(value.predecessorPlan, ['planId', 'version', 'digest'], 'workflow revision predecessor');
  if (!/^plan:[a-f0-9]{64}$/u.test(value.predecessorPlan.planId ?? '')
    || !Number.isSafeInteger(value.predecessorPlan.version) || value.predecessorPlan.version <= 0) {
    fail('workflow revision predecessor is invalid');
  }
  exact(value.parent, [
    'role', 'nodeKey', 'taskId', 'candidateId', 'candidateDigest', 'resultSha',
    'retainedResultRef', 'treeIdentityDigest', 'changedPaths', 'changedPathsDigest',
    'evidenceDigest', 'commitArtifact', 'verificationArtifact',
  ], 'workflow revision parent');
  const role = text(value.parent.role, 256, 'workflow revision role');
  const nodeKey = text(value.parent.nodeKey, 256, 'workflow revision node');
  const taskId = text(value.parent.taskId, 4_096, 'workflow revision task');
  if (!/^[A-Za-z0-9._:-]+$/u.test(role) || !/^[A-Za-z0-9._:-]+$/u.test(nodeKey)
    || !/^candidate:[a-f0-9]{64}$/u.test(value.parent.candidateId ?? '')
    || !/^[a-f0-9]{40}$/u.test(value.parent.resultSha ?? '')
    || value.parent.retainedResultRef !== `refs/baton/results/${value.parent.resultSha}`) {
    fail('workflow revision parent identity is invalid');
  }
  if (!Array.isArray(value.parent.changedPaths) || value.parent.changedPaths.length > 1_024) {
    fail('workflow revision changed paths are invalid');
  }
  const changedPaths = value.parent.changedPaths.map(safePath).sort();
  if (new Set(changedPaths).size !== changedPaths.length
    || digest(value.parent.changedPathsDigest, 'workflow revision paths digest')
      !== workflowRevisionDigest(changedPaths)) fail('workflow revision changed paths changed');
  if (!Array.isArray(value.feedback) || value.feedback.length === 0 || value.feedback.length > 64) {
    fail('workflow revision feedback set is invalid');
  }
  const feedback = value.feedback.map((packet) => {
    exact(packet, ['feedbackId', 'feedbackDigest', 'eventSeq', 'feedback'], 'workflow revision feedback');
    if (!/^feedback:[a-f0-9]{64}$/u.test(packet.feedbackId ?? '')
      || !Number.isSafeInteger(packet.eventSeq) || packet.eventSeq <= 0) {
      fail('workflow revision feedback identity is invalid');
    }
    return {
      feedbackId: packet.feedbackId,
      feedbackDigest: digest(packet.feedbackDigest, 'workflow revision feedback digest'),
      eventSeq: packet.eventSeq,
      feedback: feedbackBody(packet.feedback),
    };
  }).sort((left, right) => (left.feedbackId < right.feedbackId ? -1 : 1));
  if (new Set(feedback.map(({ feedbackId }) => feedbackId)).size !== feedback.length) {
    fail('workflow revision feedback contains duplicates');
  }
  exact(value.decision, ['actionId', 'principalScopeDigest', 'reasonDigest'], 'workflow revision decision');
  const core = {
    schemaVersion: 1, kind: 'candidate_feedback_revision', round: value.round,
    workflow: { definitionDigest: digest(value.workflow.definitionDigest, 'workflow definition digest') },
    predecessorPlan: {
      planId: value.predecessorPlan.planId, version: value.predecessorPlan.version,
      digest: digest(value.predecessorPlan.digest, 'workflow revision predecessor digest'),
    },
    parent: {
      role, nodeKey, taskId,
      candidateId: value.parent.candidateId,
      candidateDigest: digest(value.parent.candidateDigest, 'workflow Candidate digest'),
      resultSha: value.parent.resultSha, retainedResultRef: value.parent.retainedResultRef,
      treeIdentityDigest: digest(value.parent.treeIdentityDigest, 'workflow Candidate tree digest'),
      changedPaths, changedPathsDigest: value.parent.changedPathsDigest,
      evidenceDigest: digest(value.parent.evidenceDigest, 'workflow Candidate evidence digest'),
      commitArtifact: artifact(value.parent.commitArtifact, 'workflow Candidate commit artifact'),
      verificationArtifact: artifact(value.parent.verificationArtifact,
        'workflow Candidate verification artifact'),
    },
    feedback,
    decision: {
      actionId: text(value.decision.actionId, 4_096, 'workflow revision action'),
      principalScopeDigest: digest(value.decision.principalScopeDigest,
        'workflow revision principal scope digest'),
      reasonDigest: digest(value.decision.reasonDigest, 'workflow revision reason digest'),
    },
  };
  if (Buffer.byteLength(JSON.stringify(canonical(core))) > 256 * 1024) {
    fail('workflow revision exceeds its byte ceiling');
  }
  return core;
}

export function normalizeWorkflowRevision(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('workflow revision is invalid');
  const raw = JSON.parse(JSON.stringify(value));
  const suppliedId = raw.revisionId;
  const suppliedDigest = raw.revisionDigest;
  delete raw.revisionId;
  delete raw.revisionDigest;
  const core = normalizeCore(raw);
  const revisionDigest = workflowRevisionDigest(core);
  const revisionId = `revision:${revisionDigest}`;
  if ((suppliedId !== undefined && suppliedId !== revisionId)
    || (suppliedDigest !== undefined && suppliedDigest !== revisionDigest)) {
    fail('workflow revision computed identity is invalid');
  }
  return Object.freeze({ ...core, revisionId, revisionDigest });
}
