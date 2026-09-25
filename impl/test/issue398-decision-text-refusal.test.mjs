// issue398-decision-text-refusal.test.mjs — issue #398 (audit C19): a refusal text must name the
// OBSERVED byte count of the caller's text and the registry row it was judged against — never
// cap+1. The decision answer text is the decision lane that carries a byte ceiling; a question, an
// option label and an option summary are shown whole.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ValidationError,
  createDecisionAnswer,
  createDecisionRequest,
} from '../src/messages.mjs';
import {
  FRAME_LIMITS,
  composeFrameLimitRefusal,
} from '../src/limits.mjs';

const TEXT_ROW = FRAME_LIMITS['decision.text'];

test('issue398 guard: oversize decision answer text refusal names the observed N and decision.text row', () => {
  const answerText = 'w'.repeat(TEXT_ROW.value + 50);
  const actual = Buffer.byteLength(answerText);
  let error = null;
  try {
    createDecisionAnswer({ text: answerText });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof ValidationError, 'oversize answer text must refuse');
  assert.equal(error.cap, FRAME_LIMITS['decision.text'].value);
  assert.equal(error.actual, actual);
  const text = (error.errors ?? []).join('\n');
  assert.equal(text, composeFrameLimitRefusal(TEXT_ROW, actual, TEXT_ROW.value));
});

test('issue398 (question): a question past the old 2,048-byte ceiling is admitted whole', () => {
  const question = `QUESTION-${'q'.repeat(4096)}`;
  const request = createDecisionRequest({
    question, options: [{ id: 'a', label: 'A' }], deadlineMs: 60_000,
  });
  assert.equal(request.question, question, 'the question travels at its own length');
});
