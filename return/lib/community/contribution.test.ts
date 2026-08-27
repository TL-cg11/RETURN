import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTRIBUTION_KINDS, buildSteps, describeKinds, fieldsFor, missingFields, summariseDetail,
} from './contribution.ts';
import type { ContributionKind, KindDetail } from './contribution.ts';

const detail = (kind: ContributionKind, values: Record<string, string> = {}): KindDetail => ({ kind, values });

/* FR-C3 — the step list is built from what the contributor chose, so the total
   changes with the selection. FR-C2 — the object step exists only when the
   contributor did not arrive from an object. */
test('choosing one kind gives object, kind, that kind, consent, review', () => {
  const steps = buildSteps(['Photograph'], { needsObjectStep: true });
  assert.deepEqual(steps.map((step) => step.id), ['object', 'kinds', 'detail:Photograph', 'consent', 'review']);
});
test('arriving from an object detail drops the object step', () => {
  const steps = buildSteps(['Photograph'], { needsObjectStep: false });
  assert.deepEqual(steps.map((step) => step.id), ['kinds', 'detail:Photograph', 'consent', 'review']);
});
test('choosing two kinds inserts a step for each, in the order offered', () => {
  const steps = buildSteps(['Oral history', 'Photograph'], { needsObjectStep: false });
  assert.deepEqual(steps.map((step) => step.id), ['kinds', 'detail:Photograph', 'detail:Oral history', 'consent', 'review']);
});
test('choosing every kind produces one detail step per kind', () => {
  const steps = buildSteps([...CONTRIBUTION_KINDS], { needsObjectStep: false });
  assert.equal(steps.filter((step) => step.id.startsWith('detail:')).length, CONTRIBUTION_KINDS.length);
});
test('choosing nothing still lets the contributor reach the kind step and no further', () => {
  const steps = buildSteps([], { needsObjectStep: false });
  assert.deepEqual(steps.map((step) => step.id), ['kinds', 'consent', 'review']);
});

/* FR-C1 — the fields differ per kind, which is the whole complaint. */
test('each kind asks for something the others do not', () => {
  const names = (kind: ContributionKind) => fieldsFor(kind).map((f) => f.name);
  assert.ok(names('Photograph').includes('photographer'));
  assert.ok(names('Document').includes('issuer'));
  assert.ok(names('Oral history').includes('speaker'));
  assert.ok(!names('Object information').includes('photographer'));
});
test('only the kinds that carry material accept uploads', () => {
  assert.ok(fieldsFor('Photograph').some((f) => f.type === 'files'));
  assert.ok(fieldsFor('Document').some((f) => f.type === 'files'));
  assert.ok(fieldsFor('Oral history').some((f) => f.type === 'files'));
  assert.ok(!fieldsFor('Object information').some((f) => f.type === 'files'));
});
test('every field declares a label, so no input is unlabelled', () => {
  for (const kind of CONTRIBUTION_KINDS) {
    for (const field of fieldsFor(kind)) assert.ok(field.label.length > 0, `${kind}.${field.name}`);
  }
});

/* Validation runs on the same declarations the form renders from. */
test('a required field left blank is reported by name', () => {
  const missing = missingFields([detail('Photograph', {})]);
  assert.deepEqual(missing, [{ kind: 'Photograph', label: fieldsFor('Photograph').find((f) => f.required)!.label }]);
});
test('a filled required field passes', () => {
  const required = fieldsFor('Photograph').filter((f) => f.required).map((f) => f.name);
  const values = Object.fromEntries(required.map((name) => [name, 'something']));
  assert.deepEqual(missingFields([detail('Photograph', values)]), []);
});
test('whitespace is not a value', () => {
  const required = fieldsFor('Document').filter((f) => f.required).map((f) => f.name);
  const values = Object.fromEntries(required.map((name) => [name, '   ']));
  assert.equal(missingFields([detail('Document', values)]).length, required.length);
});
test('validation covers every selected kind, not just the first', () => {
  const photo = fieldsFor('Photograph').filter((f) => f.required).map((f) => f.name);
  const filled = detail('Photograph', Object.fromEntries(photo.map((name) => [name, 'x'])));
  const missing = missingFields([filled, detail('Document', {})]);
  assert.ok(missing.every((entry) => entry.kind === 'Document'));
  assert.ok(missing.length > 0);
});

/* Review rendering (FR-C5). */
test('a kind list reads as prose', () => {
  assert.equal(describeKinds(['Photograph']), 'Photograph');
  assert.equal(describeKinds(['Photograph', 'Oral history']), 'Photograph and Oral history');
  assert.equal(describeKinds(['Photograph', 'Document', 'Oral history']), 'Photograph, Document, and Oral history');
  assert.equal(describeKinds([]), 'nothing yet');
});
test('a detail summary lists only the fields that were filled in', () => {
  const lines = summariseDetail(detail('Photograph', { taken_when: 'August 1959', photographer: '' }));
  assert.ok(lines.some((line) => line.includes('August 1959')));
  assert.ok(!lines.some((line) => line.toLowerCase().includes('photographer')));
});
test('a summary never leaks a field the kind does not declare', () => {
  const lines = summariseDetail(detail('Object information', { photographer: 'Someone' }));
  assert.ok(!lines.some((line) => line.includes('Someone')));
});
