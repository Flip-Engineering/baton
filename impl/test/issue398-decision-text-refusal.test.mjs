// issue398-decision-text-refusal.test.mjs — issue #398 (audit C19): the
// decision.question hard-class refusal text must name the OBSERVED byte count of
// the caller's text and the registry row it was judged against — never cap+1.
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
  frameLimitRefusalPath,
} from '../src/limits.mjs';

const QUESTION_ROW = FRAME_LIMITS['decision.question'];
const TEXT_ROW = FRAME_LIMITS['decision.text'];

function captureRequestError(question) {
  try {
    createDecisionRequest({
      question,
      options: [{ id: 'a', label: 'A' }],
      deadlineMs: 60000,
    });
  } catch (error) {
    return error;
  }
  return null;
}

// (a) a text of N bytes over the row refuses naming actual N and the row value.
// N is deliberately far from cap+1 so the old cap+1 golden cannot pass.
test('issue398 (a): oversize decision question refusal names the observed N and the row cap', () => {
  const overBy = 100;
  const question = 'x'.repeat(QUESTION_ROW.value + overBy);
  const actual = Buffer.byteLength(question);
  assert.equal(actual, QUESTION_ROW.value + overBy);
  const error = captureRequestError(question);
  assert.ok(error instanceof ValidationError, 'oversize question must refuse');
  const text = (error.errors ?? []).join('\n');
  assert.ok(
    text.includes(`${actual} ${QUESTION_ROW.unit}`),
    `refusal must name the observed ${actual} bytes, got: ${text}`,
  );
  assert.ok(
    text.includes(`cap ${QUESTION_ROW.value}`),
    `refusal must name the row cap ${QUESTION_ROW.value}, got: ${text}`,
  );
  assert.equal(
    text,
    composeFrameLimitRefusal(QUESTION_ROW, actual, QUESTION_ROW.value),
    'refusal text is exactly the registry composer output for the observed bytes',
  );
});

// (b) the refusal reads the registry row: payload equals FRAME_LIMITS, unchanged.
test('issue398 (b): question refusal payload reads the FRAME_LIMITS decision.question row', () => {
  const question = 'y'.repeat(QUESTION_ROW.value + 7);
  const actual = Buffer.byteLength(question);
  const error = captureRequestError(question);
  assert.ok(error instanceof ValidationError, 'oversize question must refuse');
  assert.equal(error.cap, QUESTION_ROW.value, 'cap is the registry row value');
  assert.equal(error.cap, FRAME_LIMITS['decision.question'].value);
  assert.equal(error.actual, actual, 'actual is the caller byte count');
  assert.equal(error.unit, QUESTION_ROW.unit);
  assert.equal(error.code, QUESTION_ROW.refusalCode);
});

// (c) the message names the graceful path when the row carries one.
test('issue398 (c): question refusal message names the row graceful path', () => {
  const question = 'z'.repeat(QUESTION_ROW.value + 33);
  const error = captureRequestError(question);
  assert.ok(error instanceof ValidationError, 'oversize question must refuse');
  const expectedPath = frameLimitRefusalPath(QUESTION_ROW, QUESTION_ROW.value);
  assert.equal(error.gracefulPath, expectedPath);
  const text = (error.errors ?? []).join('\n');
  assert.ok(
    text.endsWith(expectedPath),
    `refusal text must end with the graceful path, got: ${text}`,
  );
  if (QUESTION_ROW.graceful) {
    assert.match(text, /spill|digest/i, 'a graceful row coaches the spill path');
  } else {
    assert.ok(
      text.includes(`resend within the ${QUESTION_ROW.value}-byte cap`),
      'a hard row coaches the retry bound',
    );
  }
});

// Guard: the decision.text (answer) lane already coaches the observed bytes;
// it must keep doing so after the question-lane fix.
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
