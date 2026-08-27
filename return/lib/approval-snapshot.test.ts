import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLabelApprovalSnapshot, canonicalJson, isLabelApprovalSnapshot,
  isDraftHashLegacyApprovalSnapshot, isLegacyLabelApprovalSnapshot, validateLabelApprovalIntegrity,
} from './approval-snapshot.ts';

const evidence = [{ id: 'EV-1', authority: 'verified', consent: 'public_attributed', visibility: 'public' }] as const;
const snapshot = buildLabelApprovalSnapshot({
  objectId: 'object-1', objectVersion: 3, draft: 'Proposed label.', justification: 'Verified accession record.',
  evidenceIds: ['EV-1'], assertions: [{ mode: 'verified_fact', text: 'Documented.', refs: ['EV-1'] }],
  evidence: [...evidence],
});

test('canonical JSON is independent of object key insertion order', () => {
  assert.equal(canonicalJson({ z: 1, nested: { b: 2, a: 1 } }), canonicalJson({ nested: { a: 1, b: 2 }, z: 1 }));
});

test('A4 snapshot contains canonical args, assertions, evidence metadata, and target version', () => {
  assert.equal(isLabelApprovalSnapshot(snapshot), true);
  assert.deepEqual(snapshot.args, {
    object_id: 'object-1', draft: 'Proposed label.', evidence_ids: ['EV-1'], justification: 'Verified accession record.',
  });
  assert.deepEqual(snapshot.evidence_refs, evidence);
  assert.deepEqual(snapshot.target, { object_id: 'object-1', version: 3 });
});

test('live authority or consent changes invalidate an approval', () => {
  const stored = {
    tool: 'propose_label_update', objectId: 'object-1', objectVersion: 3, draft: 'Proposed label.',
    justification: 'Verified accession record.', refsAuthority: ['verified'], refsConsent: ['public_attributed'],
  };
  assert.equal(validateLabelApprovalIntegrity({ snapshot, stored, currentEvidence: [...evidence] }), null);
  assert.equal(validateLabelApprovalIntegrity({
    snapshot, stored, currentEvidence: [{ ...evidence[0], authority: 'submitted' }],
  }), 'evidence_snapshot_mismatch');
});

test('column tampering invalidates an approval snapshot', () => {
  assert.equal(validateLabelApprovalIntegrity({
    snapshot,
    stored: {
      tool: 'propose_label_update', objectId: 'object-1', objectVersion: 3, draft: 'Changed after queueing.',
      justification: 'Verified accession record.', refsAuthority: ['verified'], refsConsent: ['public_attributed'],
    },
    currentEvidence: [...evidence],
  }), 'snapshot_contract_mismatch');
});

test('legacy recognition rejects unexpected fields instead of bypassing the new hash contract', () => {
  const migrated = { draft: 'Old', object_id: 'object-1', object_version: 3 };
  assert.equal(isLegacyLabelApprovalSnapshot(migrated), true);
  assert.equal(isDraftHashLegacyApprovalSnapshot(migrated), true);
  assert.equal(isDraftHashLegacyApprovalSnapshot({ ...migrated, assertions: [] }), false);
  assert.equal(isLegacyLabelApprovalSnapshot({ draft: 'Old', object_id: 'object-1', object_version: 3, injected: true }), false);
});
