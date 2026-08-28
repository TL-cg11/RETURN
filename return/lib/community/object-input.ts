import type { NewObjectInput } from '@/db/queries';
import { MAX_TEXT } from '@/lib/domain/types';

/**
 * Validation for a new collection record (FR-K5).
 *
 * Shared by the curator form and the route, so the two cannot disagree about what
 * a valid record is. The id is derived from the title rather than typed, because it
 * appears in every public URL and a curator should not have to invent one.
 *
 * Every field is read as text and checked against its own ceiling (V7-3). This used to
 * be `String(value ?? '').trim().slice(0, 600)`, which had both failings at once: an
 * object arrived on the public object page as the words `[object Object]`, and a title
 * three hundred characters long was accepted, cut to a hundred and sixty, and stored
 * without anyone being told. The same ceilings are what `register_object` enforces on
 * the tool surface, so the console and the agent now answer the same field the same way.
 */
export const OBJECT_TONES = ['clay', 'stone', 'indigo', 'charcoal', 'reed', 'brass', 'oxide', 'linen'] as const;
export const RECORD_STATUSES = ['Record open', 'Under review', 'Record stable'] as const;

/** The most open questions one new record may carry. */
export const MAX_OBJECT_QUESTIONS = 6;

export function slugFor(title: string) {
  return title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

export type ObjectDraft = {
  title?: string; accession?: string; description?: string; period?: string;
  objectType?: string; material?: string; origin?: string; acquisitionDate?: string;
  recordStatus?: string; tone?: string; label?: string; questions?: string[];
};

/**
 * What each field of a record holds, in one table the form and the route both read.
 *
 * `fallback` is what an absent optional field means. A required field has none: it is
 * refused rather than filled in, because inventing a value for something a curator did
 * not write puts words in the record under their name.
 */
export const OBJECT_FIELDS: {
  key: Exclude<keyof ObjectDraft, 'questions' | 'recordStatus' | 'tone'>;
  label: string;
  max: number;
  required?: boolean;
  fallback?: string;
}[] = [
  { key: 'title', label: 'Title', max: MAX_TEXT.title, required: true },
  { key: 'accession', label: 'Accession number', max: MAX_TEXT.accession, required: true },
  { key: 'period', label: 'Date or period', max: MAX_TEXT.period, required: true },
  { key: 'objectType', label: 'Object type', max: MAX_TEXT.term, fallback: 'Object' },
  { key: 'material', label: 'Material', max: MAX_TEXT.material, required: true },
  { key: 'origin', label: 'Place of origin', max: MAX_TEXT.origin, required: true },
  { key: 'acquisitionDate', label: 'Acquisition date', max: MAX_TEXT.period },
  { key: 'description', label: 'Description', max: MAX_TEXT.body, fallback: 'A newly registered record. Description pending.' },
  { key: 'label', label: 'Public label', max: MAX_TEXT.draft, required: true },
];

/** The ceiling for one record field, for the form to render as `maxLength`. */
export function objectFieldMax(key: ObjectFieldKey) {
  return OBJECT_FIELDS.find((field) => field.key === key)?.max ?? MAX_TEXT.title;
}

export type ObjectFieldKey = typeof OBJECT_FIELDS[number]['key'];

/** Required fields left blank, by label, in the order the form asks for them. */
export function missingObjectFields(draft: ObjectDraft) {
  return OBJECT_FIELDS
    .filter((field) => field.required)
    .filter((field) => {
      const value = draft[field.key];
      return typeof value !== 'string' || !value.trim();
    })
    .map((field) => field.label);
}

export type DraftProblem = { field: string; reason: string; recovery: string };
export type DraftResult = { ok: true; input: NewObjectInput } | { ok: false } & DraftProblem;

/**
 * Normalises a draft into the row shape, or names the first field that stops it.
 *
 * The problem it returns carries the same three words every refusal on this system
 * carries — which field, what is wrong, what to do — so the route can answer with it
 * directly and the form can print it without translating.
 */
export function validateObjectDraft(draft: ObjectDraft): DraftResult {
  const values: Partial<Record<ObjectFieldKey, string>> = {};

  for (const field of OBJECT_FIELDS) {
    const raw = draft[field.key];
    if (raw === undefined || raw === null || raw === '') {
      if (field.required) {
        return { ok: false, field: field.key, reason: `${field.label} is required.`, recovery: 'Complete the record before registering it.' };
      }
      values[field.key] = field.fallback ?? '';
      continue;
    }
    if (typeof raw !== 'string') {
      return {
        ok: false, field: field.key,
        reason: `${field.label} must be text, and this one is ${Array.isArray(raw) ? 'a list' : typeof raw}.`,
        recovery: 'Send it as a string.',
      };
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      if (field.required) {
        return { ok: false, field: field.key, reason: `${field.label} is required.`, recovery: 'Complete the record before registering it.' };
      }
      values[field.key] = field.fallback ?? '';
      continue;
    }
    if (trimmed.length > field.max) {
      return {
        ok: false, field: field.key,
        reason: `${field.label} is at most ${field.max} characters, and this one is ${trimmed.length}.`,
        recovery: `Shorten it to ${field.max} characters or fewer.`,
      };
    }
    values[field.key] = trimmed;
  }

  const title = values.title ?? '';
  const id = slugFor(title);
  if (!id) {
    return { ok: false, field: 'title', reason: 'The title cannot be turned into a record id.', recovery: 'Use a title with letters or numbers in it.' };
  }

  const rawQuestions = draft.questions;
  if (rawQuestions !== undefined && !Array.isArray(rawQuestions)) {
    return { ok: false, field: 'questions', reason: 'The open questions must be a list.', recovery: 'Send them as an array of strings.' };
  }
  const questions: string[] = [];
  for (const question of rawQuestions ?? []) {
    if (typeof question !== 'string') {
      return { ok: false, field: 'questions', reason: `Every open question must be text, and one is ${typeof question}.`, recovery: 'Send them as an array of strings.' };
    }
    const trimmed = question.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_TEXT.question) {
      return {
        ok: false, field: 'questions',
        reason: `An open question is at most ${MAX_TEXT.question} characters, and one is ${trimmed.length}.`,
        recovery: `Shorten it to ${MAX_TEXT.question} characters or fewer.`,
      };
    }
    questions.push(trimmed);
  }
  if (questions.length > MAX_OBJECT_QUESTIONS) {
    return {
      ok: false, field: 'questions',
      reason: `A new record carries at most ${MAX_OBJECT_QUESTIONS} open questions, and this one has ${questions.length}.`,
      recovery: 'Register the record and add the rest as revisions.',
    };
  }

  return {
    ok: true,
    input: {
      id,
      accession: values.accession ?? '',
      title,
      description: values.description ?? '',
      period: values.period ?? '',
      objectType: values.objectType ?? 'Object',
      material: values.material ?? '',
      origin: values.origin ?? '',
      acquisitionDate: values.acquisitionDate || null,
      recordStatus: RECORD_STATUSES.includes(draft.recordStatus as typeof RECORD_STATUSES[number]) ? draft.recordStatus! : 'Record open',
      tone: OBJECT_TONES.includes(draft.tone as typeof OBJECT_TONES[number]) ? draft.tone! : 'linen',
      questions,
      label: values.label ?? '',
    },
  };
}
