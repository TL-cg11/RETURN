import type { NewObjectInput } from '@/db/queries';

/**
 * Validation for a new collection record (FR-K5).
 *
 * Shared by the curator form and the route, so the two cannot disagree about what
 * a valid record is. The id is derived from the title rather than typed, because it
 * appears in every public URL and a curator should not have to invent one.
 */
export const OBJECT_TONES = ['clay', 'stone', 'indigo', 'charcoal', 'reed', 'brass', 'oxide', 'linen'] as const;
export const RECORD_STATUSES = ['Record open', 'Under review', 'Record stable'] as const;

export function slugFor(title: string) {
  return title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

export type ObjectDraft = {
  title?: string; accession?: string; description?: string; period?: string;
  objectType?: string; material?: string; origin?: string; acquisitionDate?: string;
  recordStatus?: string; tone?: string; label?: string; questions?: string[];
};

const REQUIRED: { key: keyof ObjectDraft; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'accession', label: 'Accession number' },
  { key: 'period', label: 'Date or period' },
  { key: 'material', label: 'Material' },
  { key: 'origin', label: 'Place of origin' },
  { key: 'label', label: 'Public label' },
];

export function missingObjectFields(draft: ObjectDraft) {
  return REQUIRED.filter(({ key }) => !String(draft[key] ?? '').trim()).map(({ label }) => label);
}

/** Normalises a draft into the row shape. Call only after `missingObjectFields` is empty. */
export function objectFromDraft(draft: ObjectDraft): NewObjectInput | null {
  const title = String(draft.title ?? '').trim();
  const id = slugFor(title);
  if (!id) return null;
  const text = (value: unknown, fallback = '') => String(value ?? '').trim().slice(0, 600) || fallback;
  return {
    id,
    accession: text(draft.accession),
    title: title.slice(0, 160),
    description: text(draft.description, 'A newly registered record. Description pending.'),
    period: text(draft.period),
    objectType: text(draft.objectType, 'Object'),
    material: text(draft.material),
    origin: text(draft.origin),
    acquisitionDate: text(draft.acquisitionDate) || null,
    recordStatus: RECORD_STATUSES.includes(draft.recordStatus as typeof RECORD_STATUSES[number]) ? draft.recordStatus! : 'Record open',
    tone: OBJECT_TONES.includes(draft.tone as typeof OBJECT_TONES[number]) ? draft.tone! : 'linen',
    questions: (draft.questions ?? []).map((question) => String(question).trim()).filter(Boolean).slice(0, 6),
    label: text(draft.label),
  };
}
