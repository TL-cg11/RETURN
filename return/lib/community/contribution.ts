/**
 * The shape of a contribution, in one place.
 *
 * The form renders from these declarations, the review step summarises from them,
 * and validation checks against them, so a field cannot exist in one and be missing
 * from another. Before FR-C1 the kind picker only highlighted a button: every kind
 * led to the same four fields.
 */

export const CONTRIBUTION_KINDS = ['Photograph', 'Document', 'Oral history', 'Object information'] as const;
export type ContributionKind = typeof CONTRIBUTION_KINDS[number];

export type FieldType = 'text' | 'textarea' | 'files';
export type FieldSpec = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  placeholder?: string;
};

const FIELDS: Record<ContributionKind, FieldSpec[]> = {
  Photograph: [
    { name: 'files', label: 'Photographs', type: 'files', help: 'You may attach several images of the same material.' },
    { name: 'caption', label: 'What does it show?', type: 'textarea', required: true, placeholder: 'Describe what is visible in the photograph.' },
    { name: 'taken_when', label: 'When was it taken?', type: 'text', placeholder: 'August 1959, or “sometime in the 1960s”' },
    { name: 'taken_where', label: 'Where was it taken?', type: 'text', placeholder: 'Aru village' },
    { name: 'photographer', label: 'Who took it?', type: 'text', help: 'Say if this is known rather than confirmed. The museum records the difference.' },
    { name: 'reverse', label: 'Anything written on the back?', type: 'textarea', placeholder: 'Transcribe any inscription, stamp, or label.' },
  ],
  Document: [
    { name: 'files', label: 'Document files', type: 'files', help: 'Scans or photographs of the pages, as PDF or image.' },
    { name: 'document_type', label: 'What kind of document is it?', type: 'text', required: true, placeholder: 'Invoice, registry entry, catalog page, letter' },
    { name: 'issuer', label: 'Who issued or wrote it?', type: 'text' },
    { name: 'issued_when', label: 'When was it issued?', type: 'text', placeholder: '18 June 1968' },
    { name: 'summary', label: 'What does it say?', type: 'textarea', placeholder: 'Summarise the parts that relate to this object.' },
  ],
  'Oral history': [
    { name: 'files', label: 'Recording', type: 'files', help: 'Audio is optional. A transcript alone is a complete contribution.' },
    { name: 'transcript', label: 'Transcript or summary', type: 'textarea', required: true, placeholder: 'What was said, in the speaker’s own words where possible.' },
    { name: 'speaker', label: 'Who is speaking?', type: 'text', help: 'A name, or a description if the speaker prefers not to be named.' },
    { name: 'relationship', label: 'Their relationship to the object', type: 'text', placeholder: 'Family member, community elder, former custodian' },
    { name: 'recorded_when', label: 'When was it recorded?', type: 'text' },
    { name: 'recorded_where', label: 'Where was it recorded?', type: 'text' },
    { name: 'language', label: 'Language spoken', type: 'text' },
  ],
  'Object information': [
    { name: 'claim', label: 'What would you like the record to say?', type: 'textarea', required: true, placeholder: 'State it as a claim rather than as established fact.' },
    { name: 'basis', label: 'What is this based on?', type: 'text', help: 'Personal knowledge, community practice, published work, another record.' },
  ],
};

export function fieldsFor(kind: ContributionKind): FieldSpec[] {
  return FIELDS[kind];
}

export type KindDetail = { kind: ContributionKind; values: Record<string, string> };

export type Step =
  | { id: 'object'; label: string }
  | { id: 'kinds'; label: string }
  | { id: `detail:${ContributionKind}`; label: string; kind: ContributionKind }
  | { id: 'consent'; label: string }
  | { id: 'review'; label: string };

/**
 * FR-C3 — one step per chosen kind, so the total count follows the selection.
 * FR-C2 — the object step appears only when the contributor did not arrive from a
 * record, because being asked twice which object this is about reads as a bug.
 */
export function buildSteps(kinds: readonly ContributionKind[], options: { needsObjectStep: boolean }): Step[] {
  const chosen = CONTRIBUTION_KINDS.filter((kind) => kinds.includes(kind));
  return [
    ...(options.needsObjectStep ? [{ id: 'object' as const, label: 'Object' }] : []),
    { id: 'kinds' as const, label: 'Material' },
    ...chosen.map((kind) => ({ id: `detail:${kind}` as const, label: kind, kind })),
    { id: 'consent' as const, label: 'Consent' },
    { id: 'review' as const, label: 'Review' },
  ];
}

export function missingFields(details: readonly KindDetail[]) {
  const missing: { kind: ContributionKind; label: string }[] = [];
  for (const detail of details) {
    for (const field of fieldsFor(detail.kind)) {
      if (!field.required || field.type === 'files') continue;
      if (!(detail.values[field.name] ?? '').trim()) missing.push({ kind: detail.kind, label: field.label });
    }
  }
  return missing;
}

export function describeKinds(kinds: readonly ContributionKind[]) {
  if (kinds.length === 0) return 'nothing yet';
  if (kinds.length === 1) return kinds[0];
  if (kinds.length === 2) return `${kinds[0]} and ${kinds[1]}`;
  return `${kinds.slice(0, -1).join(', ')}, and ${kinds[kinds.length - 1]}`;
}

/** Review lines for one kind. Reads only declared fields, so a stray key cannot surface. */
export function summariseDetail(detail: KindDetail) {
  return fieldsFor(detail.kind)
    .filter((field) => field.type !== 'files' && (detail.values[field.name] ?? '').trim())
    .map((field) => `${field.label} — ${detail.values[field.name].trim()}`);
}
