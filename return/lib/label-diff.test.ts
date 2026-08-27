import assert from 'node:assert/strict';
import test from 'node:test';
import { diffLabelText } from './label-diff.ts';

test('label diff preserves both complete versions', () => {
  const before = 'The mask entered the collection in 1968.';
  const after = 'The mask entered the museum collection in 1968.';
  const diff = diffLabelText(before, after);

  assert.equal(diff.filter((part) => part.type !== 'added').map((part) => part.text).join(''), before);
  assert.equal(diff.filter((part) => part.type !== 'removed').map((part) => part.text).join(''), after);
  assert.equal(diff.filter((part) => part.type === 'added').map((part) => part.text).join(''), 'museum ');
});

test('label diff marks replacements as a removal and an addition', () => {
  const diff = diffLabelText('Custody is documented.', 'Custody is unresolved.');
  assert.equal(diff.filter((part) => part.type === 'removed').map((part) => part.text).join(''), 'documented');
  assert.equal(diff.filter((part) => part.type === 'added').map((part) => part.text).join(''), 'unresolved');
});

test('identical labels produce one unchanged segment', () => {
  assert.deepEqual(diffLabelText('No change.', 'No change.'), [{ type: 'equal', text: 'No change.' }]);
});
