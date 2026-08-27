export type Authority = 'submitted' | 'verified';
export type Consent = 'private' | 'public_anonymous' | 'public_attributed';
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
