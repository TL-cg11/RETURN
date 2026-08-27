import {
  countByStatus, createEscalation, getApproval, getEvidenceByIds, getSubmission, listActivity, listApprovals, listObjects,
  listSubmissions, recordActivity, setSubmissionStatus, workspaceSummary, type SubmissionRow,
} from '@/db/queries';
import { APPROVAL_TTL_MS, ensureDatabase, sha256 } from '@/db/setup';
import { buildLabelApprovalSnapshot, canonicalJson } from '@/lib/approval-snapshot';
import type { Authority, Consent, EvidenceRecord, LabelAssertion, Visibility } from '@/lib/domain/types';
import { evaluatePolicy } from '@/lib/policy/evaluate';
import type { PolicyResult } from '@/lib/policy/types';
import { evidenceFor, objectRecord, searchCollection } from '@/lib/records';
import { sessionFromRequest } from '@/lib/session';

const CURATOR_ONLY = new Set([
  'get_collection_summary', 'list_objects', 'list_submissions', 'get_review_case',
  'build_provenance_timeline', 'compare_evidence', 'draft_label', 'request_clarification',
  'propose_label_update', 'open_return_review', 'check_approval', 'list_pending_approvals',
]);

const COMMUNITY_TOOLS = new Set([
  'search_collection', 'get_object_detail', 'get_provenance_timeline',
  'submit_evidence', 'submit_context_claim', 'check_submission',
]);

const KNOWN = new Set([...CURATOR_ONLY, ...COMMUNITY_TOOLS]);

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

/** Public shape of a submission. Bodies of restricted material are withheld. */
function publicSubmission(row: SubmissionRow) {
  const withheld = row.consent === 'private' || row.consent === 'research_only';
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
  const withheld = row.consent === 'private' || row.consent === 'research_only';
  return {
    id: row.id, object_id: row.object_id, kind: row.kind, title: row.title,
    consent: row.consent, status: row.status, quotable: !withheld,
    authority: 'submitted' as Authority, created_at: row.created_at,
  };
}

async function refsFrom(museumId: string, args: Record<string, unknown>, objectId: string) {
  const ids = Array.isArray(args.evidence_ids) ? args.evidence_ids.map(String) : [];
  // Policy enforcement may inspect sealed metadata, but sealed records are never
  // returned to the agent. Unknown/cross-object ids fail closed as sealed/private.
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
    museumMatch: ids.every((id) => known.some((item) => item.id === id && item.objectId === objectId)),
  };
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
      return Response.json({
        ...body,
        note: 'Working timeline only. The official record is unchanged.',
        ...evaluatePolicy({ actor: role, action: 'draft_label', museumMatch: record.id === objectId }),
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

      const policy = evaluatePolicy({ actor: role, action: 'submit_evidence', museumMatch: record.id === objectId });
      const id = `SUB-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      const db = await ensureDatabase(museumId);
      const createdAt = Date.now();
      await db.prepare('INSERT INTO submissions (id,museum_id,object_id,kind,title,description,source,consent,requested_outcome,contributor_name,contributor_role,evidence_refs,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id, museumId, record.id, name === 'submit_evidence' ? 'Evidence' : 'Context claim', title,
          String(args.description ?? args.claim ?? ''), String(args.source ?? 'Community agent'),
          typeof args.consent === 'string' ? args.consent : 'research_only',
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
      return Response.json({
        id: row.id, status: row.status, object_id: row.object_id, consent: row.consent,
        requested_outcome: row.requested_outcome,
        message: row.status === 'needs information'
          ? 'A curator asked a follow-up question about this contribution.'
          : 'Source and consent review is next. The public record has not changed.',
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
        consent_restrictions: row.consent === 'research_only' || row.consent === 'private'
          ? ['This material may inform review but cannot be quoted in public output.'] : [],
        untrusted_content: true,
      });
    }

    case 'draft_label': {
      const record = await objectRecord(museumId, objectId, 'agent');
      if (!record) return invalid(...NO_OBJECT);
      const evidence = await evidenceFor(museumId, record.id, 'agent');
      return Response.json({
        object_id: record.id,
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
      await setSubmissionStatus(museumId, id, 'needs information');
      const clarifyPolicy = evaluatePolicy({ actor: role, action: 'request_clarification', museumMatch: row.museum_id === museumId });
      await recordActivity(museumId, 'Curator Agent', 'requested clarification', `${row.title} · ${question}`, {
        tool: 'request_clarification', target: id, risk: clarifyPolicy.risk,
        policyDecision: clarifyPolicy.outcome, result: 'needs information',
      });
      return Response.json({
        ...clarifyPolicy,
        submission_id: id, status: 'needs information',
      });
    }

    case 'propose_label_update': {
      const record = await objectRecord(museumId, objectId, 'agent');
      if (!record) return invalid(...NO_OBJECT);
      const draft = typeof args.draft === 'string' ? args.draft.trim() : '';
      if (!draft) return invalid('draft', 'A proposal needs the label text it would publish.', 'Call draft_label first, then propose the text it returns.');

      const resolvedRefs = await refsFrom(museumId, args, record.id);
      const policy = evaluatePolicy({ actor: role, action: 'publish_label', museumMatch: resolvedRefs.museumMatch, refs: resolvedRefs.refs, publicOutput: true });
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
      const policy = evaluatePolicy({ actor: role, action: 'open_return_review', museumMatch: resolvedRefs.museumMatch, refs: resolvedRefs.refs });
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
  }

  return Response.json({ error: 'Unknown tool' }, { status: 404 });
}
