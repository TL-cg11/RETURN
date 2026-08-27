import type { Authority, Consent, LabelAssertion, Visibility } from './domain/types.ts';

export type ApprovalEvidenceSnapshot = {
  id: string;
  authority: Authority;
  consent: Consent;
  visibility: Visibility;
};

export type LabelApprovalSnapshot = {
  schema_version: 1;
  tool: 'propose_label_update';
  args: {
    object_id: string;
    draft: string;
    evidence_ids: string[];
    justification: string;
  };
  draft: string;
  assertions: LabelAssertion[];
  evidence_refs: ApprovalEvidenceSnapshot[];
  target: { object_id: string; version: number };
};

export type LegacyLabelApprovalSnapshot = {
  tool?: unknown;
  object_id: string;
  object_version: number;
  draft: string;
  assertions?: unknown[];
  evidence_refs?: string[];
};

type SnapshotEvidenceInput = ApprovalEvidenceSnapshot & { objectId?: string };

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}

/** Stable JSON for hashing: object keys are sorted recursively; arrays retain order. */
export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

export function buildLabelApprovalSnapshot(input: {
  objectId: string;
  objectVersion: number;
  draft: string;
  justification: string;
  evidenceIds: string[];
  assertions: LabelAssertion[];
  evidence: SnapshotEvidenceInput[];
}): LabelApprovalSnapshot {
  const evidenceIds = [...new Set(input.evidenceIds)].sort();
  const byId = new Map(input.evidence.map((item) => [item.id, item]));
  const evidenceRefs = evidenceIds.flatMap((id) => {
    const item = byId.get(id);
    if (!item) return [];
    return [{ id, authority: item.authority, consent: item.consent, visibility: item.visibility }];
  });
  return {
    schema_version: 1,
    tool: 'propose_label_update',
    args: {
      object_id: input.objectId,
      draft: input.draft,
      evidence_ids: evidenceIds,
      justification: input.justification,
    },
    draft: input.draft,
    assertions: input.assertions.map((assertion) => ({ ...assertion, refs: [...assertion.refs].sort() })),
    evidence_refs: evidenceRefs,
    target: { object_id: input.objectId, version: input.objectVersion },
  };
}

const authorities = new Set(['submitted', 'verified']);
const consents = new Set(['private', 'research_only', 'public_anonymous', 'public_attributed']);
const visibilities = new Set(['public', 'restricted', 'sealed']);
const assertionModes = new Set(['verified_fact', 'attributed_claim', 'open_question']);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isLabelApprovalSnapshot(value: unknown): value is LabelApprovalSnapshot {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<LabelApprovalSnapshot>;
  return item.schema_version === 1
    && item.tool === 'propose_label_update'
    && typeof item.draft === 'string'
    && !!item.args && typeof item.args === 'object'
    && typeof item.args.object_id === 'string'
    && typeof item.args.draft === 'string'
    && isStringArray(item.args.evidence_ids)
    && typeof item.args.justification === 'string'
    && !!item.target && typeof item.target === 'object'
    && typeof item.target.object_id === 'string'
    && Number.isInteger(item.target.version)
    && Array.isArray(item.assertions)
    && item.assertions.every((assertion) => !!assertion && typeof assertion === 'object'
      && assertionModes.has(assertion.mode) && typeof assertion.text === 'string' && isStringArray(assertion.refs))
    && Array.isArray(item.evidence_refs)
    && item.evidence_refs.every((ref) => !!ref && typeof ref === 'object' && typeof ref.id === 'string'
      && authorities.has(ref.authority) && consents.has(ref.consent) && visibilities.has(ref.visibility));
}

/** Strictly recognizes only the two pre-A4 snapshot shapes for safe migration. */
export function isLegacyLabelApprovalSnapshot(value: unknown): value is LegacyLabelApprovalSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const allowed = new Set(['tool', 'object_id', 'object_version', 'draft', 'assertions', 'evidence_refs']);
  return Object.keys(item).every((key) => allowed.has(key))
    && (item.tool === undefined || item.tool === 'propose_label_update')
    && typeof item.object_id === 'string'
    && Number.isInteger(item.object_version)
    && typeof item.draft === 'string'
    && (item.assertions === undefined || Array.isArray(item.assertions))
    && (item.evidence_refs === undefined || isStringArray(item.evidence_refs));
}

/** Only the original migration shape may use the old draft-only hash. */
export function isDraftHashLegacyApprovalSnapshot(value: unknown): value is LegacyLabelApprovalSnapshot {
  if (!isLegacyLabelApprovalSnapshot(value)) return false;
  const keys = Object.keys(value).sort();
  return sameStrings(keys, ['draft', 'object_id', 'object_version']);
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Compare the immutable snapshot with both its columns and live evidence metadata. */
export function validateLabelApprovalIntegrity(input: {
  snapshot: LabelApprovalSnapshot;
  stored: {
    tool: string; objectId: string; objectVersion: number; draft: string; justification: string;
    refsAuthority: string[]; refsConsent: string[];
  };
  currentEvidence: ApprovalEvidenceSnapshot[];
}) {
  const { snapshot, stored } = input;
  const snapshotIds = snapshot.evidence_refs.map((ref) => ref.id);
  if (snapshot.tool !== stored.tool
    || snapshot.args.object_id !== stored.objectId
    || snapshot.target.object_id !== stored.objectId
    || snapshot.target.version !== stored.objectVersion
    || snapshot.args.draft !== stored.draft
    || snapshot.draft !== stored.draft
    || snapshot.args.justification !== stored.justification
    || !sameStrings(snapshot.args.evidence_ids, snapshotIds)
    || !sameStrings(snapshot.evidence_refs.map((ref) => ref.authority), stored.refsAuthority)
    || !sameStrings(snapshot.evidence_refs.map((ref) => ref.consent), stored.refsConsent)) {
    return 'snapshot_contract_mismatch' as const;
  }

  if (input.currentEvidence.length !== snapshot.evidence_refs.length) return 'evidence_snapshot_mismatch' as const;
  for (let index = 0; index < snapshot.evidence_refs.length; index++) {
    const expected = snapshot.evidence_refs[index];
    const current = input.currentEvidence[index];
    if (!current || expected.id !== current.id || expected.authority !== current.authority
      || expected.consent !== current.consent || expected.visibility !== current.visibility) {
      return 'evidence_snapshot_mismatch' as const;
    }
  }
  return null;
}
