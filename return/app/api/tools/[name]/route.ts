import {
  attachAssetsToSubmission, countByStatus, createEscalation, getApproval, getAsset, getEvidenceByIds, getSubmission,
  appendClarification, parseClarifications,
  listActivity, listApprovals, listObjectAssets, listObjects, listSubmissionAssets, listSubmissions, recordActivity,
  setSubmissionStatus, workspaceSummary, type AssetRow, type SubmissionRow,
} from '@/db/queries';
import { APPROVAL_TTL_MS, ensureDatabase, sha256 } from '@/db/setup';
import { buildLabelApprovalSnapshot, canonicalJson } from '@/lib/approval-snapshot';
import { CONSENT_LEVELS, isConsent, isQuotable, type Authority, type Consent, type EvidenceRecord, type LabelAssertion, type Visibility } from '@/lib/domain/types';
import { assetAccess, MAX_ASSETS_PER_CONTRIBUTION } from '@/lib/assets/access';
import { slugFor } from '@/lib/community/object-input';
import { evaluatePolicy } from '@/lib/policy/evaluate';
import type { PolicyResult } from '@/lib/policy/types';
import { evidenceFor, objectRecord, searchCollection } from '@/lib/records';
import { sessionFromRequest } from '@/lib/session';

const CURATOR_ONLY = new Set([
  'get_collection_summary', 'list_objects', 'list_submissions', 'get_review_case',
  'build_provenance_timeline', 'compare_evidence', 'draft_label', 'request_clarification',
  'propose_label_update', 'open_return_review', 'check_approval', 'list_pending_approvals', 'register_object',
]);

/** FR-W1 - reachable from both surfaces; `assetAccess` decides what each role sees. */
const SHARED_TOOLS = new Set(['list_object_assets', 'get_asset_detail']);

const COMMUNITY_TOOLS = new Set([
  'search_collection', 'get_object_detail', 'get_provenance_timeline',
  'submit_evidence', 'submit_context_claim', 'check_submission', 'attach_assets',
]);

const KNOWN = new Set([...CURATOR_ONLY, ...COMMUNITY_TOOLS, ...SHARED_TOOLS]);

function invalid(field: string, reason: string, recovery: string) {
  return Response.json({ outcome: 'invalid', field, reason, recovery }, { status: 400 });
}

const NO_OBJECT = ['object_id', 'No object with that id is in this collection.', 'Call search_collection to list valid object ids.'] as const;

/**
 * Turns a refusal into a curator's queue item and gives the agent somewhere to go.
 * Returns the fields to merge into the denial response; `{}` when the verdict is
 * not the kind a human should review, so the caller can spread it unconditionally.
 */
async function escalate(museumId: string, policy: PolicyResult, entry: {
  tool: string; objectId: string; args: unknown; sourceRefs: string[]; action: string; next: string;
}) {
  if (!policy.escalate) {
    await recordActivity(museumId, 'Policy Gateway', entry.action, policy.reason, {
      tool: entry.tool, target: entry.objectId, risk: policy.risk, policyDecision: 'denied', result: policy.policy ?? 'denied',
    });
    return { next: entry.next };
  }
  const escalationId = await createEscalation(museumId, {
    objectId: entry.objectId, tool: entry.tool, args: entry.args,
    policy: policy.policy ?? 'denied', sourceRefs: entry.sourceRefs,
  });
  await recordActivity(museumId, 'Policy Gateway', entry.action, policy.reason, {
    tool: entry.tool, target: entry.objectId, risk: policy.risk, policyDecision: 'denied', result: escalationId,
  });
  return { escalation_id: escalationId, escalated_to_curator: true, next: entry.next };
}

/** The three fields `assetAccess` judges on, pulled off a database row. */
const assetRefOf = (row: AssetRow) => ({
  museumId: row.museum_id,
  visibility: row.visibility as Visibility,
  consent: row.consent as Consent,
});

/** Asset metadata for tool output. Never carries file contents or the storage key. */
function publicAsset(row: AssetRow) {
  return {
    id: row.id, kind: row.kind, file_name: row.file_name, media_type: row.content_type,
    alt_text: row.alt_text, caption: row.caption, byte_size: row.byte_size, width: row.width, height: row.height,
    consent: row.consent, visibility: row.visibility, quotable: isQuotable(row.consent),
    url: `/api/assets/${row.id}`, created_at: row.created_at,
  };
}

/** Public shape of a submission. Bodies of restricted material are withheld. */
function publicSubmission(row: SubmissionRow) {
  // Withheld unless consent names a level that permits publication (MCP-E2).
  const withheld = !isQuotable(row.consent);
  return {
    id: row.id, object_id: row.object_id, kind: row.kind, title: row.title,
    contributor: row.source, consent: row.consent, status: row.status,
    requested_outcome: row.requested_outcome, authority: 'submitted' as Authority,
    description: withheld ? null : row.description,
    quotable: !withheld,
    created_at: row.created_at,
  };
}

/**
 * The triage shape: what a curator needs to decide which contribution to open,
 * and nothing else. Bodies are read in full through `get_review_case`, which is
 * what the catalogue means by returning ids and summaries rather than text.
 */
function listedSubmission(row: SubmissionRow) {
  // Withheld unless consent names a level that permits publication (MCP-E2).
  const withheld = !isQuotable(row.consent);
  return {
    id: row.id, object_id: row.object_id, kind: row.kind, title: row.title,
    consent: row.consent, status: row.status, quotable: !withheld,
    authority: 'submitted' as Authority, created_at: row.created_at,
  };
}

/**
 * Resolve the evidence ids a call cites, and say which ones did not resolve.
 *
 * Policy enforcement may inspect sealed metadata, but sealed records are never returned
 * to the agent, so an id that resolves to nothing fails closed as sealed and private.
 *
 * This used to report an unresolved id as `museumMatch: false`, and the gateway answered
 * "The requested record belongs to another workspace" (MCP-E5). The workspace was never
 * in question: the object had already been resolved from it. What had gone wrong was the
 * citation — an id that does not exist here, or one that belongs to a different object.
 * Those are input problems and are reported as input problems, by id.
 */
async function refsFrom(museumId: string, args: Record<string, unknown>, objectId: string) {
  const ids = Array.isArray(args.evidence_ids) ? args.evidence_ids.map(String) : [];
  const known = await getEvidenceByIds(museumId, ids, 'curator');
  const refs = ids.map((id) => {
    const found = known.find((item) => item.id === id && item.objectId === objectId);
    return {
      authority: (found?.authority ?? 'submitted') as Authority,
      consent: (found?.consent ?? 'private') as Consent,
      visibility: (found?.visibility ?? 'sealed') as Visibility,
    };
  });
  return {
    refs,
    /** Cited ids that name no evidence record in this workspace. */
    unknown: ids.filter((id) => !known.some((item) => item.id === id)),
    /** Cited ids that exist here but document a different object. */
    otherObject: ids.filter((id) => known.some((item) => item.id === id && item.objectId !== objectId)),
  };
}

/**
 * The refusal for a citation that did not resolve, or null when every id landed.
 *
 * An official change may only rest on evidence recorded against the object it changes,
 * which is the rule that was already in force. It is stated here instead of being
 * delivered as a workspace error.
 */
function citationProblem(resolved: { unknown: string[]; otherObject: string[] }, objectId: string) {
  if (resolved.unknown.length > 0) {
    return invalid('evidence_ids', `No evidence record exists in this workspace for ${resolved.unknown.join(', ')}.`,
      'Call compare_evidence or get_review_case to see the evidence ids on this object, then cite those.');
  }
  if (resolved.otherObject.length > 0) {
    const one = resolved.otherObject.length === 1;
    return invalid('evidence_ids', `${resolved.otherObject.join(', ')} ${one ? 'documents' : 'document'} a different object, so ${one ? 'it cannot' : 'they cannot'} authorise a change to ${objectId}.`,
      'Cite evidence recorded against this object, or open a separate proposal for the object the evidence documents.');
  }
  return null;
}

/**
 * Refs for a proposal that has no object yet (FR-K5).
 *
 * `refsFrom` binds each id to one object, which is right for every other action and
 * wrong here: a record being proposed cannot already own its supporting evidence. The
 * workspace is still the boundary — ids outside it resolve to sealed and private, so
 * they carry no authority.
 */
async function refsForNewRecord(museumId: string, args: Record<string, unknown>) {
  const ids = Array.isArray(args.evidence_ids) ? args.evidence_ids.map(String) : [];
  const known = await getEvidenceByIds(museumId, ids, 'curator');
  return ids.map((id) => {
    const found = known.find((item) => item.id === id);
    return {
      authority: (found?.authority ?? 'submitted') as Authority,
      consent: (found?.consent ?? 'private') as Consent,
      visibility: (found?.visibility ?? 'sealed') as Visibility,
    };
  });
}

/**
 * The assertion set a label rests on, in the three documented modes.
 * Shared so an approved revision publishes the same structure `draft_label` showed.
 */
function labelAssertions(record: { gap: string | null }, evidence: EvidenceRecord[]): LabelAssertion[] {
  const verified = evidence.filter((item) => item.authority === 'verified');
  const submitted = evidence.filter((item) => item.authority === 'submitted');
  return [
    ...(verified.length ? [{ mode: 'verified_fact' as const, text: 'Acquisition is documented in the museum record.', refs: verified.map((item) => item.id) }] : []),
    ...(submitted.length ? [{ mode: 'attributed_claim' as const, text: 'Community material places the object earlier than the museum record.', refs: submitted.map((item) => item.id) }] : []),
    ...(record.gap ? [{ mode: 'open_question' as const, text: `Custody between ${record.gap} is unresolved.`, refs: evidence.map((item) => item.id) }] : []),
  ];
}

export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { role, museumId } = await sessionFromRequest(request);

  if (!KNOWN.has(name)) return Response.json({ error: 'Unknown tool' }, { status: 404 });
  if (CURATOR_ONLY.has(name) && role !== 'curator') {
    return Response.json({ outcome: 'denied', risk: 'LOW', reason: 'Curator role required.', recovery: 'Switch to the curator workspace.' }, { status: 403 });
  }
  if (COMMUNITY_TOOLS.has(name) && role !== 'community') {
    return Response.json({ outcome: 'denied', risk: 'LOW', reason: 'Community role required.', recovery: 'Switch to the community collection.' }, { status: 403 });
  }

  const args = await request.json().catch(() => ({})) as Record<string, unknown>;
  const objectId = typeof args.object_id === 'string' ? args.object_id : '';

  switch (name) {
    /* ------------- Community: discovery ------------- */
    case 'search_collection': {
      const matches = await searchCollection(museumId, typeof args.query === 'string' ? args.query : '', 'public');
      return Response.json({
        query: args.query ?? null,
        count: matches.length,
        objects: matches.map(({ id, title, date, region, gap, status }) => ({ id, title, date, region, gap, status })),
      });
    }

    case 'get_object_detail': {
      const record = await objectRecord(museumId, objectId, 'public');
      if (!record) return invalid(...NO_OBJECT);
      const submissions = await listSubmissions(museumId, { objectId });
      return Response.json({
        object: {
          id: record.id, title: record.title, accession: record.accession, date: record.date,
          material: record.material, region: record.region, status: record.status,
          gap: record.gap, label: record.label, questions: record.questions, version: record.version,
          label_revision: record.labelRevision,
        },
        contribution_count: submissions.length,
      });
    }

    case 'get_provenance_timeline':
    case 'build_provenance_timeline': {
      const access = name === 'get_provenance_timeline' ? 'public' : 'agent';
      const record = await objectRecord(museumId, objectId, access);
      if (!record) return invalid(...NO_OBJECT);
      const body = {
        object_id: record.id,
        events: record.timeline,
        gaps: record.timeline.filter((event) => event.gap).map((event) => ({ period: event.year, detail: event.detail })),
        unanswered_questions: record.questions,
      };
      if (name === 'get_provenance_timeline') return Response.json(body);

      // The catalogue promises a timeline built *from cited evidence* (MCP-E7). The
      // parameter was declared, described, and then ignored — every call returned the
      // stored timeline whole, so an agent narrowing to two sources got the same answer
      // as one that cited nothing and had no way to tell.
      const cited = await refsFrom(museumId, args, record.id);
      const citedIds = Array.isArray(args.evidence_ids) ? args.evidence_ids.map(String) : [];
      if (citedIds.length === 0) {
        return Response.json({
          ...body,
          note: 'Working timeline only. The official record is unchanged. No evidence was cited, so this is the whole recorded timeline.',
          ...evaluatePolicy({ actor: role, action: 'draft_label', museumMatch: true }),
        });
      }
      const citation = citationProblem(cited, record.id);
      if (citation) return citation;
      const resting = record.timeline.filter((event) => event.evidenceRefs.some((ref) => citedIds.includes(ref)));
      return Response.json({
        object_id: record.id,
        cited_evidence_ids: citedIds,
        events: resting,
        // Gaps survive the filter. A working timeline that drops the unresolved years
        // because no one cited them reads as a complete history, which is the one
        // reading this record must never invite.
        gaps: body.gaps,
        unanswered_questions: record.questions,
        events_not_resting_on_cited_evidence: record.timeline.length - resting.length,
        note: resting.length > 0
          ? 'Working timeline from the cited evidence only. Gaps are listed in full regardless of what was cited. The official record is unchanged.'
          : 'No recorded event rests on the cited evidence. Gaps are listed in full. The official record is unchanged.',
        ...evaluatePolicy({ actor: role, action: 'draft_label', museumMatch: true }),
      });
    }

    /* ------------- Community: contribution ------------- */
    case 'submit_evidence':
    case 'submit_context_claim': {
      const record = await objectRecord(museumId, objectId, 'public');
      if (!record) return invalid(...NO_OBJECT);
      const claim = typeof args.claim === 'string' ? args.claim.trim() : '';
      const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : claim.slice(0, 80);
      if (!title) return invalid(name === 'submit_evidence' ? 'title' : 'claim', 'A contribution needs a short title or claim.', 'Describe the material in one line.');

      // MCP-E1 — an unrecognised consent level used to be stored verbatim and then read
      // back as quotable by every consumer downstream. Consent is the one field on a
      // contribution that decides what may be published, so it is refused at the door
      // rather than coerced: silently rewriting someone's answer is its own failure.
      if (args.consent !== undefined && args.consent !== null && args.consent !== '' && !isConsent(args.consent)) {
        return invalid('consent', `Consent must be one of ${CONSENT_LEVELS.join(', ')}.`, 'Ask the contributor which of the three levels applies, then resubmit.');
      }
      const consent: Consent = isConsent(args.consent) ? args.consent : 'private';

      const policy = evaluatePolicy({ actor: role, action: 'submit_evidence', museumMatch: record.id === objectId });
      const id = `SUB-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      const db = await ensureDatabase(museumId);
      const createdAt = Date.now();
      await db.prepare('INSERT INTO submissions (id,museum_id,object_id,kind,title,description,source,consent,requested_outcome,contributor_name,contributor_role,evidence_refs,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id, museumId, record.id, name === 'submit_evidence' ? 'Evidence' : 'Context claim', title,
          String(args.description ?? args.claim ?? ''), String(args.source ?? 'Community agent'),
          consent,
          String(args.requested_outcome ?? 'Add context'), String(args.source ?? 'Community agent'), role,
          JSON.stringify(Array.isArray(args.evidence_refs) ? args.evidence_refs.map(String) : []), 'received', createdAt, createdAt).run();
      await recordActivity(museumId, 'Community Agent', 'submitted new evidence', title, {
        tool: name, target: id, risk: 'MEDIUM', policyDecision: 'applied', result: id,
      });
      return Response.json({ ...policy, submission_id: id, object_id: record.id, authority: 'submitted', status: 'received' });
    }

    case 'check_submission': {
      const id = typeof args.submission_id === 'string' ? args.submission_id : '';
      const row = id ? await getSubmission(museumId, id) : null;
      if (!row) return invalid('submission_id', 'No contribution with that id exists in this workspace.', 'Use the id returned by submit_evidence.');
      // FR2-K1 — the latest question verbatim, not a sentence saying one exists. Only the
      // latest, with a count beside it, so a long review cannot push this read past the
      // single-record output budget (WEBMCP_TOOLS §1.4).
      const asked = parseClarifications(row.clarifications);
      const latest = asked[asked.length - 1];
      return Response.json({
        id: row.id, status: row.status, object_id: row.object_id, consent: row.consent,
        requested_outcome: row.requested_outcome,
        message: latest
          ? 'A curator asked a follow-up question. It is quoted in curator_question.'
          : row.status === 'needs information'
            ? 'A curator asked a follow-up question about this contribution.'
            : 'Source and consent review is next. The public record has not changed.',
        ...(latest ? {
          curator_question: latest.question.slice(0, 400),
          questions_asked: asked.length,
          next: 'Answer by submitting the missing detail as a new contribution to the same object.',
        } : {}),
      });
    }

    /* ------------- Curator: insight ------------- */
    case 'get_collection_summary': {
      const [summary, recent] = await Promise.all([workspaceSummary(museumId), listActivity(museumId, 5)]);
      return Response.json({ ...summary, recent_activity: recent.map((a) => ({ actor: a.actor, action: a.action, detail: a.detail })) });
    }

    case 'list_objects': {
      const status = typeof args.status === 'string' ? args.status.toLowerCase() : '';
      const collection = await listObjects(museumId, 'agent');
      const objects = collection.filter((item) => !status || item.status.toLowerCase().includes(status));
      const perObject = await Promise.all(objects.map((item) => listSubmissions(museumId, { objectId: item.id })));
      return Response.json({
        count: objects.length,
        objects: objects.map((item, i) => ({
          id: item.id, title: item.title, accession: item.accession, status: item.status, gap: item.gap,
          new_submissions: perObject[i].filter((s) => s.status === 'received').length,
        })),
      });
    }

    case 'list_submissions': {
      const rows = await listSubmissions(museumId, {
        status: typeof args.status === 'string' ? args.status : undefined,
        objectId: typeof args.object_id === 'string' ? args.object_id : undefined,
      });
      // A triage list has to stay readable as a workspace fills up. Bodies are
      // excerpted here and read in full through get_review_case, which is the
      // output budget the tool catalogue asks for.
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
      const page = rows.slice(0, limit);
      return Response.json({
        count: rows.length,
        returned: page.length,
        submissions: page.map(listedSubmission),
        untrusted_content: true,
        ...(rows.length > page.length
          ? { next: `Showing ${page.length} of ${rows.length}. Narrow with status or object_id, or raise limit.` }
          : {}),
      });
    }

    case 'get_review_case':
    case 'compare_evidence': {
      const requestedEvidenceIds = Array.isArray(args.evidence_ids) ? args.evidence_ids.map(String) : [];
      const selectedEvidence = name === 'compare_evidence'
        ? await getEvidenceByIds(museumId, requestedEvidenceIds, 'agent')
        : [];
      if (name === 'compare_evidence' && selectedEvidence.length) {
        const objectIds = [...new Set(selectedEvidence.map((item) => item.objectId))];
        const records = await Promise.all(objectIds.map((id) => objectRecord(museumId, id, 'agent')));
        return Response.json({
          evidence: selectedEvidence,
          objects: records.filter(Boolean).map((record) => ({ id: record!.id, title: record!.title, gap: record!.gap })),
          conflicts: selectedEvidence.some((item) => item.authority === 'submitted')
            ? ['Submitted material requires source and consent review before it can change the official record.'] : [],
          open_questions: records.flatMap((record) => record?.questions ?? []),
          omitted_evidence_ids: requestedEvidenceIds.filter((id) => !selectedEvidence.some((item) => item.id === id)),
          untrusted_content: true,
        });
      }
      const caseId = typeof args.case_id === 'string' ? args.case_id
        : requestedEvidenceIds.length ? requestedEvidenceIds[0] : '';
      const row = caseId ? await getSubmission(museumId, caseId) : null;
      if (!row) return invalid(name === 'get_review_case' ? 'case_id' : 'evidence_ids', 'No review case with that id exists in this workspace.', 'Call list_submissions to list open cases.');
      const [record, evidence] = await Promise.all([
        objectRecord(museumId, row.object_id, 'agent'),
        evidenceFor(museumId, row.object_id, 'agent'),
      ]);
      const verified = evidence.filter((item) => item.authority === 'verified');
      return Response.json({
        case_id: row.id,
        object: record && { id: record.id, title: record.title, label: record.label, gap: record.gap },
        submitted: publicSubmission(row),
        verified_evidence: verified,
        conflicts: verified.length
          ? ['The current label implies clear prior custody, but the 1968 invoice names no prior owner.']
          : ['No verified counterpart is on file for this object yet.'],
        open_questions: record?.questions ?? [],
        consent_restrictions: !isQuotable(row.consent)
          ? ['This material may inform review but cannot be quoted in public output.'] : [],
        untrusted_content: true,
      });
    }

    case 'draft_label': {
      const record = await objectRecord(museumId, objectId, 'agent');
      if (!record) return invalid(...NO_OBJECT);
      const all = await evidenceFor(museumId, record.id, 'agent');
      // `evidence_ids` was declared as "evidence each drafted assertion should rest on"
      // and then ignored: the draft always rested on everything on the object (MCP-E7).
      // An agent narrowing to the sources it trusts now gets a draft that reflects that,
      // and the same citation rules as a proposal, so a draft cannot pass through ids
      // that propose_label_update would refuse.
      const citedIds = Array.isArray(args.evidence_ids) ? args.evidence_ids.map(String) : [];
      if (citedIds.length > 0) {
        const citation = citationProblem(await refsFrom(museumId, args, record.id), record.id);
        if (citation) return citation;
      }
      const evidence = citedIds.length > 0 ? all.filter((item) => citedIds.includes(item.id)) : all;
      return Response.json({
        object_id: record.id,
        ...(citedIds.length > 0 ? { rests_on: citedIds } : {}),
        draft: record.gap
          ? `${record.title} is documented from ${record.date}. Its movement between ${record.gap} remains under joint research.`
          : `${record.title}, ${record.date}. ${record.material}.`,
        assertions: labelAssertions(record, evidence),
        published: false,
        note: 'Draft only. Publishing requires propose_label_update and a human curator.',
      });
    }

    /* ------------- Curator: consequential ------------- */
    case 'request_clarification': {
      const id = typeof args.submission_id === 'string' ? args.submission_id : '';
      const question = typeof args.question === 'string' ? args.question.trim() : '';
      if (!question) return invalid('question', 'A clarification needs a question.', 'Ask about date, place, source, or consent scope.');
      const row = id ? await getSubmission(museumId, id) : null;
      if (!row) return invalid('submission_id', 'No contribution with that id exists in this workspace.', 'Call list_submissions to list open contributions.');
      // The agent surface stores the question the same way the console does. A question
      // asked through a tool is no less a question the contributor has to be able to read.
      const asked = await appendClarification(museumId, id, question, 'Curator Agent');
      await setSubmissionStatus(museumId, id, 'needs information');
      const clarifyPolicy = evaluatePolicy({ actor: role, action: 'request_clarification', museumMatch: row.museum_id === museumId });
      await recordActivity(museumId, 'Curator Agent', 'requested clarification', `${row.title} · ${question}`, {
        tool: 'request_clarification', target: id, risk: clarifyPolicy.risk,
        policyDecision: clarifyPolicy.outcome, result: 'needs information',
      });
      return Response.json({
        ...clarifyPolicy,
        submission_id: id, status: 'needs information', questions_asked: asked.length,
        note: 'The contributor can read this question on their submission page.',
      });
    }

    case 'propose_label_update': {
      const record = await objectRecord(museumId, objectId, 'agent');
      if (!record) return invalid(...NO_OBJECT);
      const draft = typeof args.draft === 'string' ? args.draft.trim() : '';
      if (!draft) return invalid('draft', 'A proposal needs the label text it would publish.', 'Call draft_label first, then propose the text it returns.');

      const resolvedRefs = await refsFrom(museumId, args, record.id);
      const citation = citationProblem(resolvedRefs, record.id);
      if (citation) return citation;
      const policy = evaluatePolicy({ actor: role, action: 'publish_label', museumMatch: true, refs: resolvedRefs.refs, publicOutput: true });
      if (policy.outcome !== 'pending_approval') {
        return Response.json({
          ...policy, object_id: record.id, published: false,
          ...await escalate(museumId, policy, {
            tool: 'propose_label_update', objectId: record.id,
            args: { object_id: record.id, draft, evidence_ids: args.evidence_ids ?? [] },
            sourceRefs: Array.isArray(args.evidence_ids) ? args.evidence_ids.map(String) : [],
            action: 'denied unsupported official change',
            next: 'Compare a verified source, request clarification from the contributor, or continue with other objects.',
          }),
        });
      }

      const approvalId = `APR-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      const db = await ensureDatabase(museumId);
      const createdAt = Date.now();
      const evidenceIds = Array.isArray(args.evidence_ids) ? [...new Set(args.evidence_ids.map(String))].sort() : [];
      // Cited evidence only: the published revision must carry the assertions the
      // proposal was judged on, not everything the object happens to hold.
      const cited = (await getEvidenceByIds(museumId, evidenceIds, 'curator')).filter((item) => item.objectId === record.id);
      const assertions = labelAssertions(record, cited);
      const snapshot = buildLabelApprovalSnapshot({
        objectId: record.id,
        objectVersion: record.version,
        draft,
        justification: String(args.justification ?? ''),
        evidenceIds,
        assertions,
        evidence: cited,
      });
      const argsSnapshot = canonicalJson(snapshot);
      await db.prepare('INSERT INTO approvals (id,museum_id,object_id,risk,snapshot,tool,args_snapshot,snapshot_hash,object_version,justification,refs_authority,refs_consent,status,resolution,verdict,edited_body,edit_reason,created_at,expires_at,resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(approvalId, museumId, record.id, 'HIGH', draft, 'propose_label_update', argsSnapshot, await sha256(argsSnapshot), record.version,
          snapshot.args.justification, JSON.stringify(snapshot.evidence_refs.map((ref) => ref.authority)), JSON.stringify(snapshot.evidence_refs.map((ref) => ref.consent)),
          'pending', null, null, null, null, createdAt, createdAt + APPROVAL_TTL_MS, null).run();
      await recordActivity(museumId, 'Curator Agent', 'proposed a label revision', `${record.title} · awaiting human approval`, {
        tool: 'propose_label_update', target: record.id, risk: 'HIGH', policyDecision: 'pending_approval', result: approvalId,
      });
      return Response.json({ ...policy, approval_id: approvalId, object_id: record.id, published: false, next: 'Continue other research; poll check_approval.' });
    }

    case 'open_return_review': {
      const record = await objectRecord(museumId, objectId, 'agent');
      if (!record) return invalid(...NO_OBJECT);
      const resolvedRefs = await refsFrom(museumId, args, record.id);
      const citation = citationProblem(resolvedRefs, record.id);
      if (citation) return citation;
      const policy = evaluatePolicy({ actor: role, action: 'open_return_review', museumMatch: true, refs: resolvedRefs.refs });
      const basis = String(args.basis ?? 'no basis given');
      if (policy.outcome === 'pending_approval') {
        await recordActivity(museumId, 'Curator Agent', 'requested a stewardship review', `${record.title} · ${basis}`, {
          tool: 'open_return_review', target: record.id, risk: 'HIGH', policyDecision: 'pending_approval', result: 'queued',
        });
      }
      return Response.json({
        ...policy, object_id: record.id, transfers_custody: false,
        note: 'This opens a human review process only. It does not transfer ownership or move the object.',
        ...(policy.outcome === 'pending_approval' ? {} : await escalate(museumId, policy, {
          tool: 'open_return_review', objectId: record.id,
          args: { object_id: record.id, basis, evidence_ids: args.evidence_ids ?? [] },
          sourceRefs: Array.isArray(args.evidence_ids) ? args.evidence_ids.map(String) : [],
          action: 'was denied a stewardship review',
          next: 'Attach a verified institutional record, or ask a curator to review the community material first.',
        })),
      });
    }

    /* ------------- Curator: governance ------------- */
    case 'check_approval': {
      const id = typeof args.approval_id === 'string' ? args.approval_id : '';
      const row = id ? await getApproval(museumId, id) : null;
      if (!row) return invalid('approval_id', 'No approval with that id exists in this workspace.', 'Call list_pending_approvals to list open requests.');
      return Response.json({
        id: row.id, status: row.status, resolution: row.resolution, risk: row.risk,
        object_id: row.object_id, snapshot_hash: row.snapshot_hash, blocking: false,
      });
    }

    case 'list_pending_approvals': {
      const [rows, counts] = await Promise.all([listApprovals(museumId, 'pending'), countByStatus(museumId)]);
      return Response.json({
        count: rows.length,
        approvals: rows.map((row) => ({ id: row.id, risk: row.risk, status: row.status, object_id: row.object_id, object_version: row.object_version })),
        open_submissions: counts.all,
        note: 'Polling does not block. Continue other research while a human reviews.',
      });
    }

    /* ------------- Assets (FR-W1) ------------- */
    // None of these carries file contents. Uploads go through `/api/assets`, which
    // creates the record first; tools only ever move ids (RETURN_PLAN 15.1).
    case 'list_object_assets': {
      const record = await objectRecord(museumId, objectId, role === 'curator' ? 'curator' : 'public');
      if (!record) return invalid(...NO_OBJECT);
      const rows = await listObjectAssets(museumId, record.id);
      const decided = rows.map((row) => ({ row, access: assetAccess(assetRefOf(row), { role, museumId }) }));
      const visible = decided.filter((entry) => entry.access === 'serve');
      // Sealed material is not counted at all: `assetAccess` answers `absent` for it,
      // and any count would disclose that it exists.
      const withheld = decided.filter((entry) => entry.access === 'deny').length;
      return Response.json({
        object_id: record.id,
        count: visible.length,
        assets: visible.map((entry) => publicAsset(entry.row)),
        withheld_count: withheld,
        ...(withheld > 0 ? { note: 'Some material on this record is held for curatorial review and is not listed in full.' } : {}),
        untrusted_content: true,
      });
    }

    case 'get_asset_detail': {
      const assetId = typeof args.asset_id === 'string' ? args.asset_id : '';
      const row = assetId ? await getAsset(museumId, assetId) : null;
      const access = row ? assetAccess(assetRefOf(row), { role, museumId }) : 'absent';
      // A missing row and an `absent` verdict answer identically, so a sealed asset
      // cannot be told apart from one that never existed.
      if (!row || access === 'absent') return invalid('asset_id', 'No asset with that id is available in this workspace.', 'Call list_object_assets to see what is available.');
      if (access === 'deny') {
        return Response.json({
          outcome: 'denied', policy: 'consent_not_public', asset_id: row.id, risk: 'LOW',
          reason: 'This material is held for curatorial review and cannot be released at this access level.',
          recovery: 'Ask a curator to review the access question, or use publicly consented material.',
        }, { status: 403 });
      }
      return Response.json({ ...publicAsset(row), object_id: row.object_id, submission_id: row.submission_id, untrusted_content: true });
    }

    case 'attach_assets': {
      const submissionId = typeof args.submission_id === 'string' ? args.submission_id : '';
      const submission = submissionId ? await getSubmission(museumId, submissionId) : null;
      if (!submission) return invalid('submission_id', 'No contribution with that id exists in this workspace.', 'Submit the contribution first, then attach files to it.');
      const ids = Array.isArray(args.asset_ids) ? args.asset_ids.filter((value) => typeof value === 'string').map(String) : [];
      if (ids.length === 0) return invalid('asset_ids', 'No asset ids were supplied.', 'Upload the files first; the upload route returns an id for each.');
      if (ids.length > MAX_ASSETS_PER_CONTRIBUTION) return invalid('asset_ids', 'A contribution may carry at most ' + MAX_ASSETS_PER_CONTRIBUTION + ' files.', 'Attach fewer files.');

      const policy = evaluatePolicy({ actor: role, action: 'submit_evidence', museumMatch: submission.museum_id === museumId });
      // Only unattached assets in this workspace move, and they inherit the
      // contribution's consent. An id belonging to another contribution simply does
      // not match, so the returned count comes back lower than the ids supplied.
      const attached = await attachAssetsToSubmission(museumId, submission.id, ids, submission.consent, submission.object_id);
      const held = await listSubmissionAssets(museumId, submission.id);
      // Which of the supplied ids are actually on the contribution now. Read back from
      // the contribution rather than trusted from the update count, so an id that was
      // already attached here reads as attached and an id that never resolved reads as
      // omitted (MCP-E3).
      const omitted = ids.filter((id) => !held.some((asset) => asset.id === id));

      // Nothing moved. `applied` here told an agent its files were on the contribution
      // when no file was: the ids were unknown, already spoken for, or in another
      // workspace. A refusal it can act on is worth more than a success it cannot.
      if (omitted.length === ids.length) {
        await recordActivity(museumId, 'Community Agent', 'tried to attach files to a contribution', 'none of ' + ids.length + ' resolved', {
          tool: 'attach_assets', target: submission.id, risk: policy.risk, policyDecision: 'invalid', result: '0',
        });
        return Response.json({
          outcome: 'invalid', field: 'asset_ids',
          reason: ids.length === 1
            ? 'That asset id is not available to attach: it does not exist in this workspace, or it is already attached to another contribution.'
            : 'None of those asset ids are available to attach: they do not exist in this workspace, or they are already attached to other contributions.',
          recovery: 'Upload the files first and use the ids the upload route returns, or call check_submission to see what this contribution already holds.',
          submission_id: submission.id, attached: 0, requested: ids.length,
          omitted_asset_ids: omitted, total_on_contribution: held.length,
        }, { status: 400 });
      }

      await recordActivity(museumId, 'Community Agent', 'attached files to a contribution', attached + ' of ' + ids.length, {
        tool: 'attach_assets', target: submission.id, risk: policy.risk, policyDecision: 'applied', result: String(attached),
      });
      return Response.json({
        ...policy, submission_id: submission.id, attached, requested: ids.length,
        // Named, not silently dropped — the pattern compare_evidence already uses.
        ...(omitted.length > 0 ? { omitted_asset_ids: omitted } : {}),
        total_on_contribution: held.length, visibility: 'restricted',
        note: 'Attached files stay restricted to curatorial review until a curator publishes them.',
      });
    }

    /* ------------- Curator: registering a record (FR-K5, FR-X3) ------------- */
    // Registering creates official museum material, so it sits on the HIGH rung with
    // label publication: an agent may propose it, a human creates it. This case never
    // writes to `objects`. The curator console's own route does that, and only after an
    // explicit human confirmation.
    case 'register_object': {
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      const accession = typeof args.accession === 'string' ? args.accession.trim() : '';
      const basis = typeof args.basis === 'string' ? args.basis.trim() : '';
      if (!title) return invalid('title', 'A proposed record needs a title.', 'Name the object as the record would.');
      if (!accession) return invalid('accession', 'A proposed record needs an accession number.', 'Supply the accession number the museum would assign.');
      if (!basis) return invalid('basis', 'Say why this object belongs in the record.', 'Explain the basis for adding it.');

      const proposedId = slugFor(title);
      const existing = proposedId ? await objectRecord(museumId, proposedId, 'curator') : null;
      if (existing) return invalid('title', `A record already exists at ${existing.id}.`, 'Propose a different title, or add evidence to the existing record.');

      const refs = await refsForNewRecord(museumId, args);
      const policy = evaluatePolicy({ actor: role, action: 'register_object', museumMatch: true, refs });
      const proposal = { title, accession, period: args.period ?? null, material: args.material ?? null, origin: args.origin ?? null, basis };

      if (policy.outcome === 'pending_approval') {
        // Queued as an escalation rather than an approval row: the approval contract is
        // an immutable label snapshot (A4) and a proposed record is not one. The
        // escalation queue already carries a tool, its arguments, and a curator action.
        const proposalId = await createEscalation(museumId, {
          objectId: null, tool: 'register_object', args: proposal,
          policy: 'pending_human_registration',
          sourceRefs: Array.isArray(args.evidence_ids) ? args.evidence_ids.map(String) : [],
        });
        await recordActivity(museumId, 'Curator Agent', 'proposed a new collection record', `${title} · ${accession}`, {
          tool: 'register_object', target: proposedId, risk: 'HIGH', policyDecision: 'pending_approval', result: proposalId,
        });
        return Response.json({
          ...policy, proposal_id: proposalId, proposed_object_id: proposedId, created: false,
          note: 'Nothing was added to the collection. A curator creates the record.',
          next: 'Open the curator console and register the record, or add evidence to the proposal.',
        });
      }

      return Response.json({
        ...policy, proposed_object_id: proposedId, created: false,
        ...await escalate(museumId, policy, {
          tool: 'register_object', objectId: proposedId, args: proposal,
          sourceRefs: Array.isArray(args.evidence_ids) ? args.evidence_ids.map(String) : [],
          action: 'was denied a new collection record',
          next: 'Cite a verified institutional record, or ask a curator to register it directly.',
        }),
      });
    }
  }

  return Response.json({ error: 'Unknown tool' }, { status: 404 });
}
