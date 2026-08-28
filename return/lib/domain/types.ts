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

/**
 * What every stored field will hold, in one place.
 *
 * Two fields had ceilings and the rest had none, so a contribution could carry two
 * hundred thousand characters of title onto the public record, into the curator's inbox,
 * and into a tool response the catalogue describes as a summary. The numbers here are the
 * ones `WEBMCP_TOOLS.md` already specified for the same fields; they were declared in the
 * design and never reached the schema or the server.
 *
 * A ceiling refuses; it does not truncate. Storing a cut version of what someone wrote and
 * reading it back whole makes two versions of one sentence (OB-1).
 */
export const MAX_TEXT = {
  /** An identifier this system issued. Long enough for `SUB-…-museum_<uuid>`. */
  id: 120,
  /** One line naming the material. */
  title: 140,
  /** The body of a contribution, and any single prose answer inside it. */
  body: 4000,
  /** A person, archive, or agent named as the source. */
  source: 120,
  /** What the contributor is asking the museum to do. */
  requestedOutcome: 140,
  /** Why a record or a review is being asked for. */
  basis: 2000,
  /** Why an official change is justified, stored in the immutable approval snapshot. */
  justification: 2000,
  /** An accession number as the museum would write it. */
  accession: 60,
  /** Date, material, and origin as they appear on a record. */
  period: 60,
  material: 200,
  origin: 200,
  /** A curator's question, matching what `check_submission` reads back. */
  question: MAX_CLARIFICATION_CHARS,
  /** A published label. */
  draft: MAX_LABEL_DRAFT_CHARS,
  /** A search phrase. Longer than any real one and short enough to cost nothing. */
  query: 200,
  /** A note a curator attaches when closing a referral. */
  note: 2000,
  /** An edit reason recorded with an approval. */
  editReason: 500,
  /** Alternative text describing one image. */
  altText: 300,
} as const;

/**
 * How many ids one call may cite.
 *
 * Each id becomes one bound SQL variable, and D1 stops at a hundred per statement, so an
 * unbounded list reached the database and failed there rather than at the door. Twelve is
 * the number `WEBMCP_TOOLS.md` §3.6 already specified for a citation.
 */
export const MAX_EVIDENCE_IDS = 12;

/**
 * The statuses a contribution can no longer be moved out of.
 *
 * `reflected in label` means its material is in the published record and `closed` means the
 * review ended. The approval path has always refused to re-touch either, and the
 * clarification path did not — so a question could drag a published contribution back to
 * `needs information`, and the contributor's page went from its final stage to the middle
 * of review while the record still carried their material (F6-5).
 */
export const SETTLED_SUBMISSION_STATUSES = ['reflected in label', 'closed'] as const;
export const isSettledSubmission = (status: string) =>
  (SETTLED_SUBMISSION_STATUSES as readonly string[]).includes(status);

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
