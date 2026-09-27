// issue398-decision-text-refusal.test.mjs — issue #398 (audit C19) recorded that a refusal text
// must name the OBSERVED byte count of the caller's text and the registry row it was judged
// against. #530 removed the class that refusal belonged to: the decision answer text carries no
// ceiling, so the lane admits the caller's text whole at any length (the request's own prose always
// did). This file keeps the issue's surviving half — the answer text travels at its own length.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDecisionAnswer,
  createDecisionRequest,
} from '../src/messages.mjs';

test('issue398 guard: an answer text past the old 4,096-byte ceiling is admitted whole', () => {
  const answerText = `ANSWER-${'w'.repeat(4096 + 50)}`;
  const answer = createDecisionAnswer({ text: answerText });
  assert.equal(answer.text, answerText, 'the answer text travels at its own length');
});

test('issue398 (question): a question past the old 2,048-byte ceiling is admitted whole', () => {
  const question = `QUESTION-${'q'.repeat(4096)}`;
  const request = createDecisionRequest({
    question, options: [{ id: 'a', label: 'A' }], deadlineMs: 60_000,
  });
  assert.equal(request.question, question, 'the question travels at its own length');
});
