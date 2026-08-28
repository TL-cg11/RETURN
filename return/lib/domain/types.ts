export type Authority = 'submitted' | 'verified';
export type Consent = 'private' | 'public_anonymous' | 'public_attributed';
/**
 * The consent levels, as data. Both contribution routes validate against this rather
 * than each keeping its own list: an unrecognised level used to be stored verbatim on
 * one path and silently rewritten to `private` on the other (MCP-E1).
 */
export const CONSENT_LEVELS: readonly Consent[] = ['private', 'public_anonymous', 'public_attributed'];
/** Whether a stored value is a consent level this system defined. */
export const isConsent = (value: unknown): value is Consent => typeof value === 'string' && (CONSENT_LEVELS as readonly string[]).includes(value);
/**
 * Whether consent permits quoting the material in public output.
 *
 * Named on the two levels that allow it, never as `!== 'private'`. A value that is
 * neither is not a permission this system granted, and the safe reading of an
 * unrecognised consent level is that it withholds (MCP-E2).
 */
export const isQuotable = (value: unknown): boolean => value === 'public_anonymous' || value === 'public_attributed';

/**
 * Input ceilings for the two free-text fields that reach a person (OB-1).
 *
 * `check_submission` returns a curator's question to the contributing agent and used to
 * cut it at 400 characters, so a longer question was stored in full and read back
 * truncated: two versions of the same sentence, and nothing said which one the
 * contributor was answering. The store now refuses what the read cannot carry.
 *
 * The label ceiling is the one WEBMCP_TOOLS §3.8 already declared for a label body.
 */
export const MAX_CLARIFICATION_CHARS = 400;
export const MAX_LABEL_DRAFT_CHARS = 6000;
export type Visibility = 'public' | 'restricted' | 'sealed';
export type AssertionMode = 'verified_fact' | 'attributed_claim' | 'open_question';

/** One claim inside a published label, with the evidence it rests on. */
export type LabelAssertion = { mode: AssertionMode; text: string; refs: string[] };

export type TimelineEvent = {
  id: string;
  year: string;
  title: string;
  detail: string;
  status: 'claimed' | 'verified' | 'disputed' | 'gap';
  authority: Authority;
  evidenceRefs: string[];
  gap?: boolean;
};

export type CollectionObject = {
  id: string;
  accession: string;
  title: string;
  description: string;
  date: string;
  material: string;
  region: string;
  acquisitionDate: string | null;
  gap: string | null;
  status: string;
  tone: string;
  visibility: Visibility;
  provenanceCompleteness: number;
  version: number;
  questions: string[];
  label: string;
  /** Revision number of the label currently on public display. */
  labelRevision: number;
  labelAssertions: LabelAssertion[];
  labelPublishedAt: number | null;
};

export type ObjectRecord = CollectionObject & { timeline: TimelineEvent[] };

export type EvidenceRecord = {
  id: string;
  objectId: string;
  type: string;
  title: string;
  body: string | null;
  sourceName: string;
  sourceRelationship: string;
  date: string;
  place: string;
  detail: string;
  authority: Authority;
  consent: Consent;
  visibility: Visibility;
  submittedBy: string;
  verifiedBy: string | null;
  verifiedAt: number | null;
};
