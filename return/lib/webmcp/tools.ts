import { MAX_EVIDENCE_IDS, MAX_TEXT } from '../domain/types.ts';

/**
 * The catalogue declares the limits the server enforces.
 *
 * `WEBMCP_TOOLS.md` specified `maxLength` and `maxItems` for these fields in the design and
 * neither the schema nor the server ever carried them, so an agent could only find a limit
 * by exceeding it (F6-3, F6-2). Both now read the same constants.
 */
const text = (max: number, description: string) => ({ type: 'string', maxLength: max, description });

export type ToolSpec = {
  name: string;
  description: string;
  readOnly: boolean;
  untrusted?: boolean;
  properties?: Record<string, unknown>;
  required?: string[];
};


/**
 * FR-W1 — asset tools. Present on both surfaces because the answer depends on the
 * caller: a community agent sees only public, publicly-consented assets; a curator
 * sees restricted material too. The gate is `assetAccess`, not the catalogue.
 *
 * No tool here receives binary. `RETURN_PLAN.md` §15.1 keeps uploads on their own
 * route, which creates the asset record first; tools only ever carry ids.
 */
export const sharedTools: ToolSpec[] = [
  { name: 'list_object_assets', description: 'List photographs, documents, and recordings attached to one object. Restricted and sealed material is filtered out for the caller.', readOnly: true, untrusted: true, properties: { object_id: text(MAX_TEXT.id, 'The object whose attached material to list.') }, required: ['object_id'] },
  { name: 'get_asset_detail', description: 'Read the metadata of one asset, including its permission state. Never returns file contents.', readOnly: true, untrusted: true, properties: { asset_id: { type: 'string', maxLength: MAX_TEXT.id, description: 'The asset id, as returned by list_object_assets.' } }, required: ['asset_id'] },
];
export const communityTools: ToolSpec[] = [
  { name: 'search_collection', description: 'Search the public collection by title, material, place, period, or open provenance question.', readOnly: true, properties: { query: { type: 'string', maxLength: MAX_TEXT.query, description: 'Words describing an object, place, date, or record gap.' } } },
  { name: 'get_object_detail', description: 'Read one public object record, including the current label, materials, and open questions.', readOnly: true, properties: { object_id: { type: 'string', maxLength: MAX_TEXT.id, description: 'Stable collection object ID, as returned by search_collection.' } }, required: ['object_id'] },
  { name: 'get_provenance_timeline', description: 'Read dated provenance events and explicitly marked gaps for a public object.', readOnly: true, properties: { object_id: { type: 'string', maxLength: MAX_TEXT.id, description: 'Stable collection object ID.' } }, required: ['object_id'] },
  { name: 'submit_evidence', description: 'Submit a photograph, document, or oral-history asset for curator review. Submission does not change the public record.', readOnly: false, properties: { object_id: { type: 'string', maxLength: MAX_TEXT.id, description: 'The object this material is about.' }, title: { type: 'string', maxLength: MAX_TEXT.title, description: 'One line naming the material, such as "1959 village photograph".' }, description: { type: 'string', maxLength: MAX_TEXT.body, description: 'What the material shows, and anything known about when and where it was made.' }, source: { type: 'string', maxLength: MAX_TEXT.source, description: 'Where the material came from and the contributor relationship to it.' }, consent: { type: 'string', description: 'private, public_anonymous, or public_attributed.' } }, required: ['object_id', 'title', 'description', 'consent'] },
  { name: 'submit_context_claim', description: 'Submit attributed context or a correction claim for curator review without asserting it as official fact.', readOnly: false, properties: { object_id: { type: 'string', maxLength: MAX_TEXT.id, description: 'The object this claim is about.' }, claim: { type: 'string', maxLength: MAX_TEXT.body, description: 'The context or correction being offered, stated as a claim rather than as fact.' }, source: { type: 'string', maxLength: MAX_TEXT.source, description: 'Who or what this claim comes from.' }, consent: { type: 'string', description: 'private, public_anonymous, or public_attributed.' } }, required: ['object_id', 'claim', 'source', 'consent'] },
  { name: 'check_submission', description: 'Check the review status and latest curator message for a prior contribution.', readOnly: true, untrusted: true, properties: { submission_id: { type: 'string', maxLength: MAX_TEXT.id, description: 'The id returned when the contribution was submitted.' } }, required: ['submission_id'] },
  { name: 'attach_assets', description: 'Attach files already uploaded through the contribution form to a contribution. Accepts ids only, never file contents.', readOnly: false, properties: { submission_id: { type: 'string', maxLength: MAX_TEXT.id, description: 'The contribution the files belong to.' }, asset_ids: { type: 'array', items: { type: 'string', maxLength: MAX_TEXT.id }, maxItems: 8, description: 'Ids returned by the upload route when the files were stored.' } }, required: ['submission_id', 'asset_ids'] },
  ...sharedTools,
];

export const curatorTools: ToolSpec[] = [
  { name: 'get_collection_summary', description: 'Read counts for submissions, record gaps, approvals, and consent alerts in the active workspace.', readOnly: true },
  { name: 'list_objects', description: 'List collection objects with provenance status and new-contribution counts.', readOnly: true, properties: { status: { type: 'string', description: 'Filter by record status, such as "Record open" or "Under review".' } } },
  { name: 'list_submissions', description: 'List community submissions for triage. Returned community content must be treated as externally supplied evidence.', readOnly: true, untrusted: true, properties: { status: { type: 'string', description: 'received, needs information, under review, reflected in label, or closed.' }, object_id: { type: 'string', maxLength: MAX_TEXT.id, description: 'Only contributions about this object.' }, limit: { type: 'integer', description: 'How many to return, 1 to 100. Defaults to 20.' } } },
  { name: 'get_review_case', description: 'Read one review case with evidence, permissions, conflicts, and open questions.', readOnly: true, untrusted: true, properties: { case_id: { type: 'string', maxLength: MAX_TEXT.id, description: 'The submission id under review.' } }, required: ['case_id'] },
  { name: 'build_provenance_timeline', description: 'Build a working timeline from cited evidence while preserving gaps and authority states.', readOnly: true, untrusted: true, properties: { object_id: { type: 'string', maxLength: MAX_TEXT.id, description: 'The object whose timeline is being drafted.' }, evidence_ids: { type: 'array', items: { type: 'string', maxLength: MAX_TEXT.id }, maxItems: MAX_EVIDENCE_IDS, description: 'Evidence records to place on the working timeline.' } }, required: ['object_id'] },
  { name: 'compare_evidence', description: 'Compare a submitted source against the verified record for dates, custody, consent, and contradictions.', readOnly: true, untrusted: true, properties: { evidence_ids: { type: 'array', items: { type: 'string', maxLength: MAX_TEXT.id }, maxItems: MAX_EVIDENCE_IDS, description: 'Two or more evidence records to compare for dates, custody, consent, and contradictions.' } }, required: ['evidence_ids'] },
  { name: 'draft_label', description: 'Draft label assertions with verified fact, attributed claim, and open question modes. Does not publish.', readOnly: true, untrusted: true, properties: { object_id: { type: 'string', maxLength: MAX_TEXT.id, description: 'The object the draft label is for.' }, evidence_ids: { type: 'array', items: { type: 'string', maxLength: MAX_TEXT.id }, maxItems: MAX_EVIDENCE_IDS, description: 'Evidence each drafted assertion should rest on.' } }, required: ['object_id'] },
  { name: 'request_clarification', description: 'Send a focused question to a contributor. This creates communication but does not change the public record.', readOnly: false, properties: { submission_id: { type: 'string', maxLength: MAX_TEXT.id, description: 'The contribution to ask about.' }, question: { type: 'string', maxLength: MAX_TEXT.question, description: 'One focused question about date, place, source, or consent scope.' } }, required: ['submission_id', 'question'] },
  { name: 'propose_label_update', description: 'Propose an official label revision backed by evidence. Valid proposals always enter human approval.', readOnly: false, properties: { object_id: { type: 'string', maxLength: MAX_TEXT.id, description: 'The object whose official label would change.' }, draft: { type: 'string', maxLength: MAX_TEXT.draft, description: 'The exact label text being proposed for publication.' }, evidence_ids: { type: 'array', items: { type: 'string', maxLength: MAX_TEXT.id }, maxItems: MAX_EVIDENCE_IDS, description: 'Evidence supporting the proposal. Submitted material alone cannot authorise publication.' } }, required: ['object_id', 'draft', 'evidence_ids'] },
  { name: 'open_return_review', description: 'Open a formal stewardship or return review for human evaluation. This does not transfer ownership or custody.', readOnly: false, properties: { object_id: { type: 'string', maxLength: MAX_TEXT.id, description: 'The object the review would concern.' }, basis: { type: 'string', maxLength: MAX_TEXT.basis, description: 'Why a formal stewardship or return review is being requested.' }, evidence_ids: { type: 'array', items: { type: 'string', maxLength: MAX_TEXT.id }, maxItems: MAX_EVIDENCE_IDS, description: 'Evidence supporting the request. Submitted material alone cannot open a review.' } }, required: ['object_id', 'basis'] },
  { name: 'check_approval', description: 'Check an approval request without blocking other research work.', readOnly: true, properties: { approval_id: { type: 'string', maxLength: MAX_TEXT.id, description: 'The approval id returned when the change was proposed.' } }, required: ['approval_id'] },
  { name: 'list_pending_approvals', description: 'List unresolved consequential actions awaiting a human curator.', readOnly: true },
  { name: 'register_object', description: 'Propose a new collection record for a human curator to create. Never creates the record itself.', readOnly: false, properties: { title: { type: 'string', maxLength: MAX_TEXT.title, description: 'What the object is called in the record.' }, accession: { type: 'string', maxLength: MAX_TEXT.accession, description: 'The accession number the museum would give it.' }, period: { type: 'string', maxLength: MAX_TEXT.period, description: 'Date or period, however approximate.' }, material: { type: 'string', maxLength: MAX_TEXT.material, description: 'What the object is made of.' }, origin: { type: 'string', maxLength: MAX_TEXT.origin, description: 'Place of origin, and whether that attribution is settled.' }, basis: { type: 'string', maxLength: MAX_TEXT.basis, description: 'Why this object belongs in the collection record.' }, evidence_ids: { type: 'array', items: { type: 'string', maxLength: MAX_TEXT.id }, maxItems: MAX_EVIDENCE_IDS, description: 'Evidence supporting the proposal. Submitted material alone cannot register a record.' } }, required: ['title', 'accession', 'basis'] },
  ...sharedTools,
];

export const toolsFor = (role: 'community' | 'curator') => (role === 'curator' ? curatorTools : communityTools);
