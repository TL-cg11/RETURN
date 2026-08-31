import {
  attachAssetsToSubmission, countByStatus, countSubmissionsByObject, createEscalation, getApproval, getAsset, getEscalation, getEvidenceByIds, getSubmission,
  objectWithAccession,
  appendClarification, parseClarifications,
  listActivity, listApprovals, listEscalations, listObjectAssets, listObjects, listSubmissionAssets, listSubmissions, listUnattachedAssets, recordActivity,
  setSubmissionStatus, SUBMISSION_STATUSES, workspaceSummary, type AssetRow, type SubmissionRow,
} from '@/db/queries';
import { APPROVAL_TTL_MS, ensureDatabase, sha256 } from '@/db/setup';
import { buildLabelApprovalSnapshot, canonicalJson } from '@/lib/approval-snapshot';
import { CONSENT_LEVELS, MAX_EVIDENCE_IDS, MAX_TEXT, isAttributable, isConsent, isQuotable, isSettledSubmission, type Authority, type Consent, type EvidenceRecord, type LabelAssertion, type Visibility } from '@/lib/domain/types';
import { refused, takeStringList, takeText } from '@/lib/http/input';
import { curatorTools, communityTools } from '@/lib/webmcp/tools';
import { assetAccess, MAX_ASSETS_PER_CONTRIBUTION } from '@/lib/assets/access';
import { slugFor } from '@/lib/community/object-input';
import { evaluatePolicy } from '@/lib/policy/evaluate';
import type { PolicyResult } from '@/lib/policy/types';
import { evidenceFor, objectRecord, searchCollection } from '@/lib/records';
import { sessionForWrite, sessionFromRequest, withSessionCookies, type Session } from '@/lib/session';
import { overWriteLimit } from '@/lib/http/rate-limit';

/**
 * The tools whose catalogue entry declares `object_id`.
 *
 * V7-7 moved the `object_id` read to the top of the handler so that no argument was
 * left unchecked, and in doing so made the surface stricter than its own contract: a
 * tool that declares no parameters at all refused a call because of an `object_id` it
 * had never asked for, while the same call carrying a malformed `title` was ignored
 * (V7-10). The read still happens once, but it only judges the tools that asked for it.
 */
const DECLARES_OBJECT_ID = new Set(
  [...curatorTools, ...communityTools]
    .filter((tool) => 'object_id' in (tool.properties ?? {}))
    .map((tool) => tool.name),
);

/**
 * A field the catalogue declares required, arriving absent or blank.
 *
 * `takeText` judges type and length and then hands back a fallback, which is the right
 * answer for a field the catalogue marks optional and the wrong one for a field it marks
 * required: the caller learns nothing, and the record keeps a value nobody supplied.
 * Presence is asked separately, on the raw argument, so a ceiling still refuses first.
 */
const absent = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/** Every catalogue entry, once, so the tables below cannot drift from what is registered. */
const CATALOGUE = [...curatorTools, ...communityTools];

/** The argument names each tool declares. Anything else is refused at the door. */
const DECLARED_FIELDS = new Map(
  CATALOGUE.map((tool) => [tool.name, new Set(Object.keys(tool.properties ?? {}))]),
);

/** The arguments each tool declares required, read from the catalogue rather than listed by hand. */
const REQUIRED_FIELDS = new Map(CATALOGUE.map((tool) => [tool.name, tool.required ?? []]));

/** The catalogue's own description of a field, which is the best recovery line there is. */
const FIELD_DESCRIPTION = new Map(
  CATALOGUE.flatMap((tool) => Object.entries(tool.properties ?? {}).map(([field, schema]) =>
    [`${tool.name}.${field}`, (schema as { description?: string }).description ?? ''] as const,
  )).filter(([, description]) => description !== ''),
);

/**
 * The absences that deserve better than the generic line.
 *
 * Consent is the field that decides what may be published and nobody but the contributor
 * can choose it, so it says so; the other two name what a curator will be reading.
 */
const REQUIRED_REFUSAL: Record<string, { reason: string; recovery: string }> = {
  'submit_evidence.description': {
    reason: 'A contribution needs a description of the material.',
    recovery: 'Say what the material shows, and anything known about when and where it was made.',
  },
  'submit_context_claim.source': {
    reason: 'A context claim needs the source it is offered on the authority of.',
    recovery: 'Name the person, archive, or record this claim comes from.',
  },
  'submit_evidence.consent': {
    reason: 'A contribution needs the consent level its contributor chose.',
    recovery: `Ask which of ${CONSENT_LEVELS.join(', ')} applies and send it. It is not defaulted, because nobody but the contributor can choose it.`,
  },
  'submit_context_claim.consent': {
    reason: 'A contribution needs the consent level its contributor chose.',
    recovery: `Ask which of ${CONSENT_LEVELS.join(', ')} applies and send it. It is not defaulted, because nobody but the contributor can choose it.`,
  },
};

/**
 * The tools that write. Read from the catalogue's own `readOnly` flag rather than
 * listed again here, so a new writing tool cannot be left off by hand (V9-4).
 */
const WRITING_TOOLS = new Set(
  [...curatorTools, ...communityTools].filter((tool) => tool.readOnly === false).map((tool) => tool.name),
);

const CURATOR_ONLY = new Set([
  'get_collection_summary', 'list_objects', 'list_submissions', 'get_review_case',
  'build_provenance_timeline', 'compare_evidence', 'draft_label', 'request_clarification',
  'propose_label_update', 'open_return_review', 'check_approval', 'list_pending_approvals', 'register_object',
]);

/** FR-W1 - reachable from both surfaces; `assetAccess` decides what each role sees. */
const SHARED_TOOLS = new Set(['list_object_assets', 'get_asset_detail']);

const COMMUNITY_TOOLS = new Set([
  'search_collection', 'get_object_detail', 'get_provenance_timeline',
  'submit_evidence', 'submit_context_claim', 'check_submission', 'attach_assets', 'list_my_uploads',
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
/**
 * Refer a refusal to a human, and log it either way.
 *
 * `objectId` is the record the activity log points at. `escalationObjectId` is what the
 * escalation row stores, and defaults to it — they differ for a proposed record, which
 * has a useful name in the log and no record behind it (EA-4).
 */
async function escalate(museumId: string, policy: PolicyResult, entry: {
  tool: string; objectId: string; escalationObjectId?: string | null; args: unknown; sourceRefs: string[]; action: string; next: string;
}) {
  if (!policy.escalate) {
    await recordActivity(museumId, 'Policy Gateway', entry.action, policy.reason, {
      tool: entry.tool, target: entry.objectId, risk: policy.risk, policyDecision: 'denied', result: policy.policy ?? 'denied',
    });
    return { next: entry.next };
  }
  const escalationId = await createEscalation(museumId, {
    objectId: entry.escalationObjectId === undefined ? entry.objectId : entry.escalationObjectId,
    tool: entry.tool, args: entry.args,
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

/**
 * Public shape of a submission. Bodies of restricted material are withheld, and so is
 * the contributor's name unless consent permits attribution (V9-2).
 *
 * Quotable and nameable are separate questions. `public_anonymous` says the material
 * may be shown and the person may not be named; this returned `contributor` whatever
 * the level said, so the name reached the surface an agent drafts labels from. The
 * object page had the rule inline and the tools did not — one rule, two answers.
 */
function publicSubmission(row: SubmissionRow) {
  // Withheld unless consent names a level that permits publication (MCP-E2).
  const withheld = !isQuotable(row.consent);
  const nameable = isAttributable(row.consent);
  return {
    id: row.id, object_id: row.object_id, kind: row.kind, title: row.title,
    contributor: nameable ? row.source : null, attributable: nameable,
    consent: row.consent, status: row.status,
    requested_outcome: row.requested_outcome, authority: 'submitted' as Authority,
    description: withheld ? null : row.description,
    quotable: !withheld,
    created_at: row.created_at,
  };
}

/** A stored JSON id list, read back defensively: a malformed column is an empty list. */
function parseIdList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : [];
  } catch {
    return [];
  }
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
/**
 * The cited ids, checked once for every tool that takes them.
 *
 * Each id becomes a bound SQL variable, and D1 stops at a hundred per statement, so an
 * unbounded list reached the database and failed there — six tools answering `error` for
 * an input the door could have refused (F6-2).
 */
function citedIds(args: Record<string, unknown>) {
  return takeStringList(args.evidence_ids, 'evidence_ids', { max: MAX_EVIDENCE_IDS, label: 'evidence_ids' });
}

async function refsFrom(museumId: string, args: Record<string, unknown>, objectId: string, ids: string[]) {
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
async function refsForNewRecord(museumId: string, ids: string[]) {
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

/**
 * Every tool answer, including the ones nobody planned.
 *
 * An unhandled throw used to leave the platform's own empty 500 (EA-1). Every other
 * answer on this surface carries `outcome` and a recovery line, so an agent that hits
 * one bare 500 has nothing to read and nothing to try. `error` is a fifth outcome
 * precisely because it is not one of the four: the call was not applied, not queued,
 * not refused by policy, and not the caller's mistake.
 */
export async function POST(request: Request, context: { params: Promise<{ name: string }> }) {
  try {
    const { name } = await context.params;
    // Reading is shared — everyone browses the same seeded collection. Writing is not:
    // a call that writes gets the caller a workspace of their own before it runs, and
    // the cookies that put them there ride back on the answer (V9-4).
    const resolved = WRITING_TOOLS.has(name)
      ? await sessionForWrite(request)
      : { session: await sessionFromRequest(request), cookies: [] as string[] };
    if ('refusal' in resolved) return resolved.refusal;
    if (WRITING_TOOLS.has(name)) {
      const throttled = await overWriteLimit(request, resolved.session.museumId);
      if (throttled) return withSessionCookies(throttled, resolved.cookies);
    }
    return withSessionCookies(await handleTool(request, name, resolved.session), resolved.cookies);
  } catch (error) {
    console.error('[RE:TURN] tool call failed', error);
    return Response.json({
      outcome: 'error',
      reason: 'The tool failed before it could answer. Nothing was written.',
      recovery: 'Retry once; if it fails again, call a narrower tool or report the tool name.',
    }, { status: 500 });
  }
}

async function handleTool(request: Request, name: string, session: Session) {
  const { role, museumId } = session;

  // The last answer on this surface that was not in the four-field contract (F4-4).
  if (!KNOWN.has(name)) {
    return Response.json({
      outcome: 'invalid', field: 'name',
      reason: `There is no tool called ${name} on this surface.`,
      recovery: 'Read the registered tool list from document.modelContext.getTools(), or call a tool this role can reach.',
    }, { status: 404 });
  }
  if (CURATOR_ONLY.has(name) && role !== 'curator') {
    return Response.json({ outcome: 'denied', risk: 'LOW', reason: 'Curator role required.', recovery: 'Switch to the curator workspace.' }, { status: 403 });
  }
  if (COMMUNITY_TOOLS.has(name) && role !== 'community') {
    return Response.json({ outcome: 'denied', risk: 'LOW', reason: 'Community role required.', recovery: 'Switch to the community collection.' }, { status: 403 });
  }

  // A body that will not parse is the caller's mistake, and reading it as `{}` turned that
  // mistake into a plausible-looking success — a search with no query, a list with no
  // filter (OB-3). An absent body still means no arguments.
  const raw = (await request.text()).trim();
  let args: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return invalid('body', 'Tool arguments must be a JSON object.', 'Send {} for a call that takes no arguments.');
      }
      args = parsed as Record<string, unknown>;
    } catch {
      return invalid('body', 'The request body is not valid JSON.', 'Send the arguments as a JSON object, or {} for a call that takes none.');
    }
  }
  /**
   * An argument this tool never declared, refused rather than ignored (V10-1).
   *
   * `submit_evidence` accepted an `object_hint` nobody had ever defined and answered
   * `applied`, which reads as "that field was recorded" — the same silent success a
   * truncated value used to give. The catalogue now says `additionalProperties:false`,
   * and this is what makes the schema true. Read before the required check so a call
   * that misspelt a required field is told the name it actually sent.
   */
  const declared = DECLARED_FIELDS.get(name) ?? new Set<string>();
  const undeclared = Object.keys(args).filter((key) => !declared.has(key));
  if (undeclared.length > 0) {
    const one = undeclared.length === 1;
    return invalid(undeclared[0],
      `${name} does not take ${undeclared.join(', ')}.`,
      declared.size > 0
        ? `It takes ${[...declared].join(', ')}. Remove the ${one ? 'extra field' : 'extra fields'} and send the call again.`
        : 'It takes no arguments. Send {}.');
  }

  /**
   * A field the catalogue declares required, judged for every tool from the catalogue
   * itself (V10-2).
   *
   * The check existed for three fields on the two contribution tools and nowhere else,
   * so every declared-required id fell through to its own lookup and came back as "No
   * object with that id is in this collection." — the same answer a wrong id gets. An
   * agent that had simply left the argument out was told its id was bad.
   */
  for (const field of REQUIRED_FIELDS.get(name) ?? []) {
    if (!absent(args[field])) continue;
    const stated = REQUIRED_REFUSAL[`${name}.${field}`];
    if (stated) return invalid(field, stated.reason, stated.recovery);
    const described = FIELD_DESCRIPTION.get(`${name}.${field}`);
    return invalid(field, `${name} declares ${field} required, and this call did not carry it.`,
      described ? `Send ${field}: ${described}` : `Send ${field} and call it again.`);
  }

  /**
   * Every argument this route reads goes through `takeText`, ids included (V7-7).
   *
   * The stored fields were converted last round and the lookup keys were not, which is
   * how `request_clarification` kept writing a question of any length: it was read with
   * a bare type check like an id, and it is not an id — a contributor reads it back.
   * `grep "typeof args\."` returning nothing is the invariant that keeps this closed.
   */
  const objectId$ = DECLARES_OBJECT_ID.has(name)
    ? takeText(args.object_id, 'object_id', { max: MAX_TEXT.id, label: 'An object id' })
    : '';
  if (refused(objectId$)) return objectId$.refusal;
  const objectId = objectId$;

  switch (name) {
    /* ------------- Community: discovery ------------- */
    case 'search_collection': {
      const query = takeText(args.query, 'query', { max: MAX_TEXT.query, label: 'A search phrase' });
      if (refused(query)) return query.refusal;
      const matches = await searchCollection(museumId, query, 'public');
      return Response.json({
        query: query || null,
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

    /**
     * Both are reads, and both now answer like one (V10-3).
     *
     * `build_provenance_timeline` spread a policy verdict into its answer, so a tool the
     * catalogue registers `readOnlyHint: true` came back `{"outcome":"applied","risk":"LOW"}`
     * — the envelope a write uses, over a call that wrote nothing. Nothing here is being
     * decided, so nothing here reports a decision; it carries `untrusted_content` instead,
     * which is what its `untrustedContentHint` promises and what it was missing.
     */
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
      const timelineCited = citedIds(args);
      if (refused(timelineCited)) return timelineCited.refusal;
      if (timelineCited.length === 0) {
        return Response.json({
          ...body,
          note: 'Working timeline only. The official record is unchanged. No evidence was cited, so this is the whole recorded timeline.',
          untrusted_content: true,
        });
      }
      const citation = citationProblem(await refsFrom(museumId, args, record.id, timelineCited), record.id);
      if (citation) return citation;
      const resting = record.timeline.filter((event) => event.evidenceRefs.some((ref) => timelineCited.includes(ref)));
      return Response.json({
        object_id: record.id,
        cited_evidence_ids: timelineCited,
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
        untrusted_content: true,
      });
    }

    /* ------------- Community: contribution ------------- */
    case 'submit_evidence':
    case 'submit_context_claim': {
      const record = await objectRecord(museumId, objectId, 'public');
      if (!record) return invalid(...NO_OBJECT);
      // Every stored field is read the same way: refused if it is not text, refused if it
      // is longer than what this system will hold, never coerced (F6-3, F6-4). `String({})`
      // put "[object Object]" on the public record, and an uncapped title put two hundred
      // thousand characters there.
      const claim = takeText(args.claim, 'claim', { max: MAX_TEXT.body, label: 'A claim' });
      if (refused(claim)) return claim.refusal;
      const givenTitle = takeText(args.title, 'title', { max: MAX_TEXT.title, label: 'A title' });
      if (refused(givenTitle)) return givenTitle.refusal;
      const description = takeText(args.description, 'description', { max: MAX_TEXT.body, fallback: claim, label: 'A description' });
      if (refused(description)) return description.refusal;
      const source = takeText(args.source, 'source', { max: MAX_TEXT.source, fallback: 'Community agent', label: 'A source' });
      if (refused(source)) return source.refusal;
      const requestedOutcome = takeText(args.requested_outcome, 'requested_outcome', { max: MAX_TEXT.requestedOutcome, fallback: 'Add context', label: 'A requested outcome' });
      if (refused(requestedOutcome)) return requestedOutcome.refusal;
      const evidenceRefs = takeStringList(args.evidence_refs, 'evidence_refs', { max: MAX_EVIDENCE_IDS, label: 'evidence_refs' });
      if (refused(evidenceRefs)) return evidenceRefs.refusal;
      // `title` is declared required of evidence and derived from the claim for a context
      // claim, which declares `claim` required instead. Both are refused when absent by the
      // catalogue-driven check at the top of this handler, so what is left here is only the
      // derivation.
      const title = givenTitle || (claim.length > 80 ? `${claim.slice(0, 79)}…` : claim);

      // MCP-E1 — an unrecognised consent level used to be stored verbatim and then read
      // back as quotable by every consumer downstream. Consent is the one field on a
      // contribution that decides what may be published, so it is refused at the door
      // rather than coerced: silently rewriting someone's answer is its own failure.
      // An absent one is refused by the required check, for the same reason.
      if (!isConsent(args.consent)) {
        return invalid('consent', `Consent must be one of ${CONSENT_LEVELS.join(', ')}.`, 'Ask the contributor which of the three levels applies, then resubmit.');
      }
      const consent: Consent = args.consent;

      /**
       * An `evidence_refs` id that resolves to nothing is named, not dropped in silence.
       *
       * The catalogue says these are "existing evidence ids this material speaks to", and
       * a typo in one used to be stored and answered `applied` with nothing said — the
       * same failure as a silently truncated value, and the opposite of what
       * `compare_evidence` does with `omitted_evidence_ids` for the identical mistake.
       * The contribution is still filed: the refs are context for a curator, not the
       * authority for anything, so a bad one is worth reporting and not worth refusing.
       */
      const knownRefs = await getEvidenceByIds(museumId, evidenceRefs, 'agent');
      const omittedRefs = evidenceRefs.filter((ref) => !knownRefs.some((item) => item.id === ref));

      const policy = evaluatePolicy({ actor: role, action: 'submit_evidence', museumMatch: record.id === objectId });
      const id = `SUB-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      const db = await ensureDatabase(museumId);
      const createdAt = Date.now();
      await db.prepare('INSERT INTO submissions (id,museum_id,object_id,kind,title,description,source,consent,requested_outcome,contributor_name,contributor_role,evidence_refs,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id, museumId, record.id, name === 'submit_evidence' ? 'Evidence' : 'Context claim', title,
          description, source,
          consent,
          requestedOutcome, source, role,
          JSON.stringify(evidenceRefs), 'received', createdAt, createdAt).run();
      await recordActivity(museumId, 'Community Agent', 'submitted new evidence', title, {
        tool: name, target: id, risk: 'MEDIUM', policyDecision: 'applied', result: id,
      });
      return Response.json({
        ...policy, submission_id: id, object_id: record.id, authority: 'submitted', status: 'received',
        ...(evidenceRefs.length ? { evidence_refs: evidenceRefs } : {}),
        ...(omittedRefs.length ? {
          omitted_evidence_refs: omittedRefs,
          note: 'The contribution was filed. The listed evidence_refs match no evidence record in this workspace and carry no weight in review.',
        } : {}),
      });
    }

    case 'check_submission': {
      const id$ = takeText(args.submission_id, 'submission_id', { max: MAX_TEXT.id, label: 'A contribution id' });
      if (refused(id$)) return id$.refusal;
      const id = id$;
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
          curator_question: latest.question,
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
      const status$ = takeText(args.status, 'status', { max: MAX_TEXT.term, label: 'A record status' });
      if (refused(status$)) return status$.refusal;
      const status = status$.toLowerCase();
      const collection = await listObjects(museumId, 'agent');
      // A status this collection does not use is the caller's mistake, and answering it
      // with `{count:0}` made it indistinguishable from a filter that simply matched
      // nothing (V10-5). The vocabulary is read off the collection rather than listed
      // here, so a new record status cannot make this refuse a status that works.
      const vocabulary = [...new Set(collection.map((item) => item.status))];
      if (status && !vocabulary.some((known) => known.toLowerCase().includes(status))) {
        return invalid('status', `No record status in this collection matches "${status$}".`,
          `Filter by one of ${vocabulary.join(', ')}, or omit status to list every record.`);
      }
      const objects = collection.filter((item) => !status || item.status.toLowerCase().includes(status));
      // One grouped count rather than one list per object (V9-6).
      const perObject = await countSubmissionsByObject(museumId);
      return Response.json({
        count: objects.length,
        objects: objects.map((item) => ({
          id: item.id, title: item.title, accession: item.accession, status: item.status, gap: item.gap,
          new_submissions: perObject.get(item.id)?.received ?? 0,
        })),
      });
    }

    case 'list_submissions': {
      const listStatus = takeText(args.status, 'status', { max: MAX_TEXT.term, label: 'A contribution status' });
      if (refused(listStatus)) return listStatus.refusal;
      // The catalogue names five statuses. A sixth used to come back as an empty page,
      // which reads as "no contributions are in that state" rather than "that state does
      // not exist" (V10-5).
      const canonicalStatus = SUBMISSION_STATUSES.find((known) => known === listStatus.toLowerCase());
      if (listStatus && !canonicalStatus) {
        return invalid('status', `No contribution status is called "${listStatus}".`,
          `Filter by one of ${SUBMISSION_STATUSES.join(', ')}, or omit status to list every contribution.`);
      }
      const rows = await listSubmissions(museumId, {
        status: canonicalStatus || undefined,
        objectId: objectId || undefined,
      });
      // A triage list has to stay readable as a workspace fills up. Bodies are
      // excerpted here and read in full through get_review_case, which is the
      // output budget the tool catalogue asks for.
      // A limit this system cannot honour is refused rather than bent into one it can
      // (F4-5). Clamping turned -5 into 1 and 0 into 20, so a caller counting on its own
      // number read a page size it never asked for. An absent limit still means 20.
      //
      // `Number()` was doing the reading, so "5" passed as 5 while the catalogue declares
      // an integer and every other type mismatch on this surface is refused rather than
      // coerced. A string that happens to parse is still not the type that was asked for.
      const whole = (value: unknown) => typeof value === 'number' && Number.isInteger(value);
      if (args.limit !== undefined && (!whole(args.limit) || (args.limit as number) < 1 || (args.limit as number) > 100)) {
        return invalid('limit', 'A limit must be a whole number between 1 and 100, sent as a number rather than a string.',
          'Ask for a page size in that range, or omit limit for the default of 20.');
      }
      if (args.offset !== undefined && (!whole(args.offset) || (args.offset as number) < 0)) {
        return invalid('offset', 'An offset must be a whole number of 0 or more, sent as a number rather than a string.',
          'Pass the offset a previous page returned in next.offset, or omit it to start at the first contribution.');
      }
      const limit = args.limit === undefined ? 20 : args.limit as number;
      const offset = args.offset === undefined ? 0 : args.offset as number;
      const page = rows.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      return Response.json({
        count: rows.length,
        offset,
        returned: page.length,
        submissions: page.map(listedSubmission),
        untrusted_content: true,
        /**
         * A cursor an agent can act on, not a sentence describing the problem.
         *
         * `next` used to be prose — "Showing 3 of 10. Narrow with status or object_id, or
         * raise limit." — which told a reader a page was partial and gave a caller no way
         * to read the rest. With limit capped at 100, a workspace past a hundred
         * contributions had rows that no sequence of tool calls could reach.
         */
        ...(rows.length > nextOffset
          ? {
            next: { offset: nextOffset, limit, remaining: rows.length - nextOffset },
            note: 'Call list_submissions again with next.offset and the same filters to read the following page.',
          }
          : {}),
      });
    }

    case 'get_review_case':
    case 'compare_evidence': {
      const requested = citedIds(args);
      if (refused(requested)) return requested.refusal;
      const requestedEvidenceIds = requested;
      // "Two or more" is what the catalogue says, and one id used to be answered with a
      // comparison of a record against itself: no conflicts, no counterpart, and nothing
      // in the response saying the comparison never happened (V10-6).
      if (name === 'compare_evidence' && requestedEvidenceIds.length === 1) {
        return invalid('evidence_ids', 'Comparing sources takes two or more evidence records, and this call sent one.',
          'Add the record to compare it against — get_review_case lists the evidence ids on an object.');
      }
      const selectedEvidence = name === 'compare_evidence'
        ? await getEvidenceByIds(museumId, requestedEvidenceIds, 'agent')
        : [];
      // EA-2 — one tool, one contract. This case is shared with `get_review_case`, and
      // `compare_evidence` used to fall through to the review-case answer whenever none of
      // its ids resolved to evidence. A caller that passed a contribution id got a review
      // case back under a different set of keys, with nothing saying which contract had
      // answered; a caller that passed nothing resolvable was told "No review case with
      // that id exists" about a parameter named `evidence_ids`. Comparison answers as a
      // comparison or refuses as one.
      if (name === 'compare_evidence' && !selectedEvidence.length) {
        const stated = requestedEvidenceIds.length > 0
          ? `No evidence record in this workspace matches ${requestedEvidenceIds.join(', ')}.`
          : 'Comparing sources needs the evidence records to compare.';
        return invalid('evidence_ids', stated,
          'Call get_review_case for a contribution id, or compare_evidence with the evidence ids a case lists.');
      }
      if (name === 'compare_evidence') {
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
      const caseId$ = takeText(args.case_id, 'case_id', { max: MAX_TEXT.id, label: 'A case id' });
      if (refused(caseId$)) return caseId$.refusal;
      const caseId = caseId$ || (requestedEvidenceIds.length ? requestedEvidenceIds[0] : '');
      const row = caseId ? await getSubmission(museumId, caseId) : null;
      if (!row) return invalid(name === 'get_review_case' ? 'case_id' : 'evidence_ids', 'No review case with that id exists in this workspace.', 'Call list_submissions to list open cases.');
      const [record, evidence] = await Promise.all([
        objectRecord(museumId, row.object_id, 'agent'),
        evidenceFor(museumId, row.object_id, 'agent'),
      ]);
      const verified = evidence.filter((item) => item.authority === 'verified');
      /**
       * Which of the contributor's citations resolve to a record here (V10-4).
       *
       * `submit_evidence` already answers this on the way in, as `omitted_evidence_refs`.
       * The read answer listed the same ids flat and said nothing, and the two arrays it
       * did carry could not be differenced into it: `verified_evidence` means verified
       * *authority*, not existence, so a real-but-submitted reference sat outside it
       * beside one that resolves to nothing at all. A curator reading the case saw two
       * identical lines that meant different things.
       */
      const citedRefs = parseIdList(row.evidence_refs);
      const resolvedRefs = await getEvidenceByIds(museumId, citedRefs, 'curator');
      const omittedRefs = citedRefs.filter((ref) => !resolvedRefs.some((item) => item.id === ref));
      return Response.json({
        case_id: row.id,
        object: record && { id: record.id, title: record.title, label: record.label, gap: record.gap },
        // What the contributor said this material speaks to. Stored since the first
        // contribution and readable nowhere on the tool surface until now, so a curator
        // agent could not see the connection the contributor drew (F4-3).
        submitted: { ...publicSubmission(row), evidence_refs: citedRefs },
        // Named in the same words the write answer uses, so one vocabulary covers both.
        omitted_evidence_refs: omittedRefs,
        verified_evidence: verified,
        conflicts: verified.length
          ? ['The current label implies clear prior custody, but the 1968 invoice names no prior owner.']
          : ['No verified counterpart is on file for this object yet.'],
        open_questions: record?.questions ?? [],
        consent_restrictions: [
          ...(!isQuotable(row.consent) ? ['This material may inform review but cannot be quoted in public output.'] : []),
          ...(!isAttributable(row.consent) ? ['The contributor chose not to be named. Do not attribute this material to a person.'] : []),
        ],
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
      const draftCited = citedIds(args);
      if (refused(draftCited)) return draftCited.refusal;
      if (draftCited.length > 0) {
        const citation = citationProblem(await refsFrom(museumId, args, record.id, draftCited), record.id);
        if (citation) return citation;
      }
      const evidence = draftCited.length > 0 ? all.filter((item) => draftCited.includes(item.id)) : all;
      return Response.json({
        object_id: record.id,
        ...(draftCited.length > 0 ? { rests_on: draftCited } : {}),
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
      const askId = takeText(args.submission_id, 'submission_id', { max: MAX_TEXT.id, label: 'A contribution id' });
      if (refused(askId)) return askId.refusal;
      const id = askId;
      const question$ = takeText(args.question, 'question', { max: MAX_TEXT.question, label: 'A clarification' });
      if (refused(question$)) return question$.refusal;
      const question = question$;
      if (!question) return invalid('question', 'A clarification needs a question.', 'Ask about date, place, source, or consent scope.');
      // The same ceiling as the console route, for the same reason (OB-1).
      if (question.length > MAX_TEXT.question) {
        return invalid('question', `A clarification is at most ${MAX_TEXT.question} characters, and this one is ${question.length}.`, 'Ask one focused question; open a second one for the rest.');
      }
      const row = id ? await getSubmission(museumId, id) : null;
      if (!row) return invalid('submission_id', 'No contribution with that id exists in this workspace.', 'Call list_submissions to list open contributions.');
      // The same guard the approval path carries, and the console route now carries too:
      // a contribution whose material is published, or whose review has closed, does not go
      // back to `needs information` (F6-5).
      if (isSettledSubmission(row.status)) {
        return Response.json({
          outcome: 'denied', risk: 'MEDIUM', policy: 'submission_settled',
          reason: `This contribution is ${row.status} and its review has ended.`,
          recovery: 'Open a new contribution on the same record to carry the question forward.',
        }, { status: 409 });
      }
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
      // The ceiling WEBMCP_TOOLS §3.8 already declared. An approval snapshot is immutable
      // and hashed, so an unbounded draft is stored and re-read forever (OB-1).
      const draft$ = takeText(args.draft, 'draft', { max: MAX_TEXT.draft, label: 'A label' });
      if (refused(draft$)) return draft$.refusal;
      const draft = draft$;
      if (!draft) return invalid('draft', 'A proposal needs the label text it would publish.', 'Call draft_label first, then propose the text it returns.');
      const justification = takeText(args.justification, 'justification', { max: MAX_TEXT.justification, label: 'The justification' });
      if (refused(justification)) return justification.refusal;

      const proposeCited = citedIds(args);
      if (refused(proposeCited)) return proposeCited.refusal;
      const resolvedRefs = await refsFrom(museumId, args, record.id, proposeCited);
      const citation = citationProblem(resolvedRefs, record.id);
      if (citation) return citation;
      const policy = evaluatePolicy({ actor: role, action: 'publish_label', museumMatch: true, refs: resolvedRefs.refs, publicOutput: true });
      if (policy.outcome !== 'pending_approval') {
        return Response.json({
          ...policy, object_id: record.id, published: false,
          ...await escalate(museumId, policy, {
            tool: 'propose_label_update', objectId: record.id,
            args: { object_id: record.id, draft, evidence_ids: proposeCited },
            sourceRefs: proposeCited,
            action: 'denied unsupported official change',
            next: 'Compare a verified source, request clarification from the contributor, or continue with other objects.',
          }),
        });
      }

      const approvalId = `APR-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      const db = await ensureDatabase(museumId);
      const createdAt = Date.now();
      const evidenceIds = [...new Set(proposeCited)].sort();
      // Cited evidence only: the published revision must carry the assertions the
      // proposal was judged on, not everything the object happens to hold.
      const cited = (await getEvidenceByIds(museumId, evidenceIds, 'curator')).filter((item) => item.objectId === record.id);
      const assertions = labelAssertions(record, cited);
      const snapshot = buildLabelApprovalSnapshot({
        objectId: record.id,
        objectVersion: record.version,
        draft,
        justification,
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
      const reviewCited = citedIds(args);
      if (refused(reviewCited)) return reviewCited.refusal;
      const resolvedRefs = await refsFrom(museumId, args, record.id, reviewCited);
      const citation = citationProblem(resolvedRefs, record.id);
      if (citation) return citation;
      // The catalogue declares `basis` required and the handler used to substitute
      // "no basis given" for a missing one and keep whitespace for a blank one, then queue
      // the review anyway (F4-1). A stewardship review is a HIGH action that asks a human
      // to weigh a claim; arriving with the reason invented by the server is not a claim.
      // `register_object` has always refused the same field, and this now matches it.
      const basis$ = takeText(args.basis, 'basis', { max: MAX_TEXT.basis, label: 'A basis' });
      if (refused(basis$)) return basis$.refusal;
      const basis = basis$;
      if (!basis) return invalid('basis', 'A stewardship review needs the reason it is being asked for.', 'Say what makes this object a candidate for review, and cite the evidence for it.');
      const policy = evaluatePolicy({ actor: role, action: 'open_return_review', museumMatch: true, refs: resolvedRefs.refs });
      if (policy.outcome === 'pending_approval') {
        /**
         * A review that reaches a human is queued where a human can act on it.
         *
         * This branch answered `pending_approval` and wrote one activity line, and that
         * was all: no row was created anywhere. So the highest-risk tool on the surface
         * was the one whose hand-off did not exist — `check_approval` had no id to be
         * given, `list_pending_approvals` never showed it, the console's pending count
         * never moved, and the human the agent had been told to wait for was handed
         * nothing. An agent polling as instructed would have waited forever.
         *
         * Queued as an escalation rather than an approval row, for the reason
         * `register_object` gives: the approval contract is an immutable label snapshot
         * (A4), and a stewardship review publishes no label. Routing it through the
         * approvals table would have put `basis` in front of the resolve route, which
         * publishes what it is given as public label text.
         */
        const reviewId = await createEscalation(museumId, {
          objectId: record.id, tool: 'open_return_review',
          args: { object_id: record.id, basis, evidence_ids: reviewCited },
          policy: 'pending_stewardship_review', sourceRefs: reviewCited,
        });
        await recordActivity(museumId, 'Curator Agent', 'requested a stewardship review', `${record.title} · ${basis}`, {
          tool: 'open_return_review', target: record.id, risk: 'HIGH', policyDecision: 'pending_approval', result: reviewId,
        });
        return Response.json({
          ...policy, review_id: reviewId, object_id: record.id, transfers_custody: false,
          note: 'This opens a human review process only. It does not transfer ownership or move the object.',
          // Names the parameter `check_approval` declares, not the key this response
          // carries it under (V11-2). An agent following the old sentence verbatim sent
          // `review_id` and was refused: "check_approval does not take review_id."
          next: 'The referral is in the curator console. Poll check_approval with approval_id set to this review_id, or continue other research.',
        });
      }
      return Response.json({
        ...policy, object_id: record.id, transfers_custody: false,
        note: 'This opens a human review process only. It does not transfer ownership or move the object.',
        ...await escalate(museumId, policy, {
          tool: 'open_return_review', objectId: record.id,
          args: { object_id: record.id, basis, evidence_ids: reviewCited },
          sourceRefs: reviewCited,
          action: 'was denied a stewardship review',
          next: 'Attach a verified institutional record, or ask a curator to review the community material first.',
        }),
      });
    }

    /* ------------- Curator: governance ------------- */
    case 'check_approval': {
      const approvalId$ = takeText(args.approval_id, 'approval_id', { max: MAX_TEXT.id, label: 'An approval id' });
      if (refused(approvalId$)) return approvalId$.refusal;
      const id = approvalId$;
      const row = id ? await getApproval(museumId, id) : null;
      if (row) {
        return Response.json({
          id: row.id, kind: 'approval' as const, status: row.status, resolution: row.resolution, risk: row.risk,
          object_id: row.object_id, snapshot_hash: row.snapshot_hash, blocking: false,
        });
      }
      /**
       * A referral is the other thing a HIGH call can become, and it was not pollable.
       *
       * `open_return_review` and `register_object` answer `pending_approval` and hand back
       * an `ESC-` id, because neither publishes a label and the approval contract is an
       * immutable label snapshot (A4). But this tool only ever looked in `approvals`, so
       * the two highest-risk tools on the surface returned an id that the tool named in
       * their own `next` line refused as nonexistent. An agent told to wait had no way to
       * see the wait end. Both queues answer here now, told apart by `kind`.
       */
      const referral = id ? await getEscalation(museumId, id) : null;
      if (!referral) {
        return invalid('approval_id', 'No approval or referral with that id exists in this workspace.',
          'Call list_pending_approvals to list open requests; it lists label approvals and referrals alike.');
      }
      return Response.json({
        id: referral.id, kind: 'referral' as const,
        // `open` is what an approval calls `pending`; a curator closes it as reviewed or
        // dismissed. Reported in both vocabularies so one poll reads the same either way.
        status: referral.status === 'open' ? 'pending' : 'resolved',
        resolution: referral.status === 'open' ? null : referral.status,
        risk: 'HIGH', tool: referral.tool, policy: referral.policy,
        object_id: referral.object_id, blocking: false,
        note: 'A referral is resolved in the curator console. It publishes nothing on its own.',
      });
    }

    case 'list_pending_approvals': {
      const [rows, referrals, counts] = await Promise.all([
        listApprovals(museumId, 'pending'),
        // The same queue `check_approval` now answers from, so what an agent can poll is
        // also what it can discover. Referrals carry no label snapshot and no object
        // version: a proposed record has no object behind it yet.
        listEscalations(museumId, 'open', 50),
        countByStatus(museumId),
      ]);
      /**
       * Every open referral, not the ones whose policy code happens to start with
       * `pending_` (V11-1).
       *
       * A referral exists only because `evaluatePolicy` returned `escalate: true` — the
       * gateway has already decided this one goes to a person, and `escalate()` writes no
       * row for a refusal it did not escalate. Filtering by policy name here was the tool
       * overruling that decision after the fact, and it dropped exactly the two codes an
       * agent runs into most: `no_supporting_evidence` and `submitted_sole_authority`.
       *
       * The cost was a surface that disagreed with itself. The curator console listed the
       * referral and said an action was waiting; `check_approval` answered `pending` for
       * the same id; this tool said there was nothing, and the summary counted zero. An
       * agent polling for its own escalated work was told it did not exist.
       */
      const pendingReferrals = referrals;
      return Response.json({
        count: rows.length + pendingReferrals.length,
        approvals: rows.map((row) => ({ id: row.id, kind: 'approval' as const, risk: row.risk, status: row.status, object_id: row.object_id, object_version: row.object_version })),
        referrals: pendingReferrals.map((row) => ({ id: row.id, kind: 'referral' as const, risk: 'HIGH', status: 'pending', tool: row.tool, policy: row.policy, object_id: row.object_id })),
        open_submissions: counts.all,
        note: 'Polling does not block. Continue other research while a human reviews.',
      });
    }

    /* ------------- Assets (FR-W1) ------------- */
    // None of these carries file contents. Uploads go through `/api/assets`, which
    // creates the record first; tools only ever move ids (RETURN_PLAN 15.1).
    /**
     * What this session has uploaded and not yet attached (V11-3).
     *
     * `attach_assets` takes ids the upload route returned, and the form kept those ids in
     * its own state — so an agent held a tool whose required argument it had no way to
     * obtain, and a contribution carrying a photograph could not be completed through the
     * tool surface at all. This closes that gap without moving bytes: ids and metadata
     * only, and only for rows no contribution has claimed, which is exactly the set
     * `attachAssetsToSubmission` can still bind.
     *
     * Scoped to the caller's own workspace like every other read. `assetAccess` is not
     * consulted: an upload arrives `restricted`/`private` by design, so judging it here
     * would hide every row from the session that just created it.
     */
    case 'list_my_uploads': {
      const whole = (value: unknown) => typeof value === 'number' && Number.isInteger(value);
      if (args.limit !== undefined && (!whole(args.limit) || (args.limit as number) < 1 || (args.limit as number) > 50)) {
        return invalid('limit', 'A limit must be a whole number between 1 and 50, sent as a number rather than a string.',
          'Ask for a page size in that range, or omit limit for the default of 20.');
      }
      const limit = args.limit === undefined ? 20 : args.limit as number;
      const rows = await listUnattachedAssets(museumId, limit);
      return Response.json({
        count: rows.length,
        uploads: rows.map(publicAsset),
        note: rows.length > 0
          ? 'Pass these ids to attach_assets with the contribution they belong to.'
          : 'Nothing is waiting. Files are uploaded through the contribution form, not through a tool.',
        untrusted_content: true,
      });
    }

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
      const assetId$ = takeText(args.asset_id, 'asset_id', { max: MAX_TEXT.id, label: 'An asset id' });
      if (refused(assetId$)) return assetId$.refusal;
      const assetId = assetId$;
      const row = assetId ? await getAsset(museumId, assetId) : null;
      const access = row ? assetAccess(assetRefOf(row), { role, museumId }) : 'absent';
      // A missing row and an `absent` verdict answer identically, so a sealed asset
      // cannot be told apart from one that never existed.
      if (!row || access === 'absent') return invalid('asset_id', 'No asset with that id is available in this workspace.', 'Call list_object_assets to see what is available.');
      if (access === 'deny') {
        /**
         * The refusal names what actually blocked it (V10-4).
         *
         * Every denial here reported `consent_not_public`, including the common one:
         * an asset a contributor had marked `public_attributed` that is still
         * `restricted` because no curator has published it. An agent read the policy
         * code, went to collect a consent it already had, and came back to the same
         * refusal. Visibility and consent are separate gates in `assetAccess`, so they
         * are separate answers here.
         */
        const consentBlocks = !isQuotable(row.consent as Consent);
        return Response.json({
          outcome: 'denied',
          policy: consentBlocks ? 'consent_not_public' : 'visibility_restricted',
          asset_id: row.id, risk: 'LOW',
          reason: consentBlocks
            ? `This material carries ${row.consent} consent, which does not permit release at this access level.`
            : 'This material is held for curatorial review. Its consent permits publication, but no curator has published it yet.',
          recovery: consentBlocks
            ? 'Ask the contributor which consent level applies, or use publicly consented material.'
            : 'Ask a curator to publish it, or use material that is already public on the record.',
        }, { status: 403 });
      }
      return Response.json({ ...publicAsset(row), object_id: row.object_id, submission_id: row.submission_id, untrusted_content: true });
    }

    case 'attach_assets': {
      const submissionId$ = takeText(args.submission_id, 'submission_id', { max: MAX_TEXT.id, label: 'A contribution id' });
      if (refused(submissionId$)) return submissionId$.refusal;
      const submissionId = submissionId$;
      const submission = submissionId ? await getSubmission(museumId, submissionId) : null;
      if (!submission) return invalid('submission_id', 'No contribution with that id exists in this workspace.', 'Submit the contribution first, then attach files to it.');
      const ids = Array.isArray(args.asset_ids) ? args.asset_ids.filter((value) => typeof value === 'string').map(String) : [];
      if (ids.length === 0) return invalid('asset_ids', 'No asset ids were supplied.', 'Upload the files first; the upload route returns an id for each.');
      if (ids.length > MAX_ASSETS_PER_CONTRIBUTION) return invalid('asset_ids', 'A contribution may carry at most ' + MAX_ASSETS_PER_CONTRIBUTION + ' files.', 'Attach fewer files.');

      const policy = evaluatePolicy({ actor: role, action: 'submit_evidence', museumMatch: submission.museum_id === museumId });
      // Only unattached assets in this workspace move, and they inherit the
      // contribution's consent. An id belonging to another contribution simply does
      // not match, so the returned count comes back lower than the ids supplied.
      //
      // Read first so the answer can separate what this call moved from what was already
      // there. `attached` deliberately counts both (F4-3), which left a replay of the same
      // call answering `attached: 1` twice with nothing saying the second moved nothing.
      const heldBefore = await listSubmissionAssets(museumId, submission.id);
      await attachAssetsToSubmission(museumId, submission.id, ids, submission.consent, submission.object_id);
      const held = await listSubmissionAssets(museumId, submission.id);
      // Both numbers are read back from the contribution, so they answer the same question:
      // which of the ids you named are on it now. MCP-E3 moved `omitted` to this reading and
      // left `attached` as the row count the UPDATE happened to change, so the two disagreed
      // whenever a file was already attached — `attached: 0` with nothing omitted, or
      // `requested - omitted` coming out one higher than `attached` (F4-3). A file that is
      // on the contribution is attached, whether this call is what put it there or not.
      const omitted = ids.filter((id) => !held.some((asset) => asset.id === id));
      const attached = ids.length - omitted.length;
      const alreadyAttached = ids.filter((id) => heldBefore.some((asset) => asset.id === id));

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
        newly_attached: attached - alreadyAttached.length,
        // Named, not silently dropped — the pattern compare_evidence already uses.
        ...(omitted.length > 0 ? { omitted_asset_ids: omitted } : {}),
        // A second `note` here would be overwritten by the restriction line below, so the
        // reading is carried by its own key rather than a field that already has an owner.
        ...(alreadyAttached.length > 0 ? {
          already_attached_asset_ids: alreadyAttached,
          already_attached_note: 'Counted in attached because they are on the contribution; this call did not move them.',
        } : {}),
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
      const title$ = takeText(args.title, 'title', { max: MAX_TEXT.title, label: 'A title' });
      if (refused(title$)) return title$.refusal;
      const accession$ = takeText(args.accession, 'accession', { max: MAX_TEXT.accession, label: 'An accession number' });
      if (refused(accession$)) return accession$.refusal;
      const basis$ = takeText(args.basis, 'basis', { max: MAX_TEXT.basis, label: 'A basis' });
      if (refused(basis$)) return basis$.refusal;
      const period = takeText(args.period, 'period', { max: MAX_TEXT.period, label: 'A period' });
      if (refused(period)) return period.refusal;
      const material = takeText(args.material, 'material', { max: MAX_TEXT.material, label: 'A material' });
      if (refused(material)) return material.refusal;
      const origin = takeText(args.origin, 'origin', { max: MAX_TEXT.origin, label: 'An origin' });
      if (refused(origin)) return origin.refusal;
      const title = title$, accession = accession$, basis = basis$;
      if (!title) return invalid('title', 'A proposed record needs a title.', 'Name the object as the record would.');
      if (!accession) return invalid('accession', 'A proposed record needs an accession number.', 'Supply the accession number the museum would assign.');
      if (!basis) return invalid('basis', 'Say why this object belongs in the record.', 'Explain the basis for adding it.');

      const proposedId = slugFor(title);
      const existing = proposedId ? await objectRecord(museumId, proposedId, 'curator') : null;
      if (existing) return invalid('title', `A record already exists at ${existing.id}.`, 'Propose a different title, or add evidence to the existing record.');
      // The accession number is unique per workspace and the registration route refuses a
      // clash with 409. Checking only the title-derived id let a proposal with a taken
      // accession sit in the queue until a curator tried to act on it and hit that 409
      // (EA-3). A refusal an agent can act on now, rather than a dead end for a human later.
      const accessionClash = await objectWithAccession(museumId, accession);
      if (accessionClash) {
        return invalid('accession', `${accession} is already the accession number of ${accessionClash.title} (${accessionClash.id}).`,
          'Propose the next unused accession number, or add evidence to the existing record.');
      }

      const registerCited = citedIds(args);
      if (refused(registerCited)) return registerCited.refusal;
      const refs = await refsForNewRecord(museumId, registerCited);
      const policy = evaluatePolicy({ actor: role, action: 'register_object', museumMatch: true, refs });
      const proposal = { title, accession, period: period || null, material: material || null, origin: origin || null, basis };

      if (policy.outcome === 'pending_approval') {
        // Queued as an escalation rather than an approval row: the approval contract is
        // an immutable label snapshot (A4) and a proposed record is not one. The
        // escalation queue already carries a tool, its arguments, and a curator action.
        const proposalId = await createEscalation(museumId, {
          objectId: null, tool: 'register_object', args: proposal,
          policy: 'pending_human_registration',
          sourceRefs: registerCited,
        });
        await recordActivity(museumId, 'Curator Agent', 'proposed a new collection record', `${title} · ${accession}`, {
          tool: 'register_object', target: proposedId, risk: 'HIGH', policyDecision: 'pending_approval', result: proposalId,
        });
        return Response.json({
          ...policy, proposal_id: proposalId, proposed_object_id: proposedId, created: false,
          note: 'Nothing was added to the collection. A curator creates the record.',
          next: 'A curator registers it from the console. Poll check_approval with approval_id set to this proposal_id to see the referral close.',
        });
      }

      return Response.json({
        ...policy, proposed_object_id: proposedId, created: false,
        ...await escalate(museumId, policy, {
          tool: 'register_object', objectId: proposedId,
          // No record exists at this id and this refusal is why. Storing the proposed slug
          // put an "Open record" link on the curator's overview that led to a 404 (EA-4).
          escalationObjectId: null,
          args: proposal,
          sourceRefs: registerCited,
          action: 'was denied a new collection record',
          // A refusal the gateway escalated is still work a person now holds, so the
          // agent is told it can follow it rather than only how to avoid it (V11-2).
          next: 'Cite a verified institutional record, or follow the referral: poll check_approval with approval_id set to this escalation_id.',
        }),
      });
    }
  }

  // Unreachable while every catalogue name has a case above, and answered in the same
  // shape as the rest so a future name added to the catalogue and not to the switch does
  // not reintroduce a second contract (F5-2).
  return Response.json({
    outcome: 'invalid', field: 'name',
    reason: `The tool ${name} is registered but this server has no handler for it.`,
    recovery: 'Report the tool name; the catalogue and the server are out of step.',
  }, { status: 500 });
}
