import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileTextInput } from '../src/widgets/packs/text-selection';
function input(value: string, start: number, end = start) {
  return { value, selectionStart: start, selectionEnd: end, selectionDirection: 'forward' as const,
    setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; } };
}
test('focused shared text updates while selection follows insertions and deletions', () => {
  const field = input('Hello world', 6, 11);
  reconcileTextInput(field, 'Hello lovely world');
  assert.equal(field.value, 'Hello lovely world'); assert.equal(field.selectionStart, 13); assert.equal(field.selectionEnd, 18);
  reconcileTextInput(field, 'Hello world'); assert.equal(field.selectionStart, 6); assert.equal(field.selectionEnd, 11);
});
test('unaffected caret stays put and replaced selections remain valid', () => {
  const field = input('The old text', 2);
  reconcileTextInput(field, 'The new text'); assert.equal(field.selectionStart, 2);
  field.selectionStart = 5; field.selectionEnd = 7;
  reconcileTextInput(field, 'The x text'); assert.equal(field.selectionStart, 5); assert.equal(field.selectionEnd, 5);
  reconcileTextInput(field, ''); assert.equal(field.selectionStart, 0); assert.equal(field.selectionEnd, 0);
});
