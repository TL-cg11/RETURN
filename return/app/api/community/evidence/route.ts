import { attachAssetsToSubmission, recordActivity } from '@/db/queries';
import { ensureDatabase } from '@/db/setup';
import { CONTRIBUTION_KINDS, describeKinds, fieldsFor, missingFields, type ContributionKind, type KindDetail } from '@/lib/community/contribution';
import { MAX_ASSETS_PER_CONTRIBUTION } from '@/lib/assets/access';
import { CONSENT_LEVELS, MAX_TEXT, isConsent, type Consent } from '@/lib/domain/types';
import { guardedWrite, readJsonBody, refused, takeStringList, takeText, type Refusal } from '@/lib/http/input';
import { evaluatePolicy } from '@/lib/policy/evaluate';
import { findObject } from '@/lib/records';

/**
 * What arrives, before anything has been checked.
 *
 * These were typed as the strings and arrays the form sends, and the route then called
 * string and array methods on them. A number in `title`, or a string in `assetIds`, threw
 * before any handler saw it and the platform answered with an empty 500 (F6-1). The type
 * now says what is true — that this is whatever the caller sent — and the reads below
 * establish the rest.
 */
type Body = Record<string, unknown>;



/**
 * Keeps only declared kinds and declared field names, in the order the form offers them.
 *
 * Everything read here is checked before it is used, because `kinds` and `details` are
 * whatever the caller sent — a number has no `.includes`, and a string has no `.find`.
 *
 * Each answer is checked against the ceiling its own question declares, not against the
 * four thousand characters of a prose body (V7-4). A date field used to accept a
 * four-thousand-character answer and store the first four thousand of whatever arrived,
 * cut mid-word, while the response said `applied`. The form renders `maxLength` from the
 * same declaration, so a contributor cannot type past what this will accept.
 */
function readDetails(kinds: string[], rawDetails: unknown): KindDetail[] | Refusal {
  const entries = Array.isArray(rawDetails) ? rawDetails : [];
  const chosen = CONTRIBUTION_KINDS.filter((kind) => kinds.includes(kind));
  const details: KindDetail[] = [];
  for (const kind of chosen) {
    const match = entries.find((entry) => !!entry && typeof entry === 'object' && (entry as { kind?: unknown }).kind === kind);
    const rawValues = (match as { values?: unknown } | undefined)?.values;
    const supplied = (rawValues && typeof rawValues === 'object' && !Array.isArray(rawValues) ? rawValues : {}) as Record<string, unknown>;
    const values: Record<string, string> = {};
    for (const field of fieldsFor(kind)) {
      if (field.type === 'files') continue;
      const value = takeText(supplied[field.name], `details.${kind}.${field.name}`, { max: field.max, label: `${kind}: ${field.label}` });
      if (refused(value)) return value;
      if (value) values[field.name] = value;
    }
    details.push({ kind, values });
  }
  return details;
}

/**
 * One contribution, however many kinds of material it carries (FR-C3).
 *
 * The per-kind answers are stored as `details` rather than flattened into the
 * description, so the curator case can show what was actually asked for each kind
 * and the review step can be rebuilt from the same declarations the form renders.
 */
export const POST = guardedWrite(async (request: Request, session) => {
  const { role, museumId } = session;
  // Every other refusal here answers in the reason/recovery shape the form renders.
  // This one used to answer `error` alone, so a curator session saw only the generic
  // "Could not submit this contribution."
  if (role === 'curator') {
    return Response.json({
      outcome: 'denied', policy: 'role_not_permitted',
      reason: 'This session is signed in as a curator, and curators do not file community contributions.',
      recovery: 'Switch to the community view and submit again.',
    }, { status: 403 });
  }

  const parsed = await readJsonBody(request);
  if (refused(parsed)) return parsed.refusal;
  const body = parsed as Body;

  const requestedId = takeText(body.objectId, 'objectId', { max: MAX_TEXT.id, label: 'The object id' });
  if (refused(requestedId)) return requestedId.refusal;
  const fallbackObject = await findObject(museumId, requestedId || 'moonbird-mask');
  if (!fallbackObject) {
    return Response.json({ outcome: 'invalid', field: 'objectId', reason: 'No public object is available to contribute to.', recovery: 'Open a record from the collection and contribute from there.' }, { status: 404 });
  }
  const objectId = fallbackObject.id;

  const title = takeText(body.title, 'title', { max: MAX_TEXT.title, required: true, label: 'A title' });
  if (refused(title)) return title.refusal;
  const source = takeText(body.source, 'source', { max: MAX_TEXT.source, label: 'The source' });
  if (refused(source)) return source.refusal;
  const requestedOutcome = takeText(body.requestedOutcome, 'requestedOutcome', { max: MAX_TEXT.requestedOutcome, fallback: 'Add context', label: 'The requested outcome' });
  if (refused(requestedOutcome)) return requestedOutcome.refusal;
  const kinds$ = takeStringList(body.kinds, 'kinds', { max: CONTRIBUTION_KINDS.length, label: 'The kinds of material' });
  if (refused(kinds$)) return kinds$.refusal;

  const details$ = readDetails(kinds$, body.details);
  if (refused(details$)) return details$.refusal;
  const details = details$;
  if (details.length === 0) {
    return Response.json({ outcome: 'invalid', field: 'kinds', reason: 'Choose at least one kind of material.', recovery: 'Select what you are sharing.' }, { status: 400 });
  }
  const missing = missingFields(details);
  if (missing.length > 0) {
    return Response.json({ outcome: 'invalid', field: 'details', reason: `${missing[0].kind}: ${missing[0].label} is required.`, recovery: 'Complete the highlighted step.' }, { status: 400 });
  }

  // Same rule as the agent tool (MCP-E1). An absent value is the private default; a
  // value this system never defined is refused rather than quietly turned into one.
  if (body.consent !== undefined && body.consent !== '' && !isConsent(body.consent)) {
    return Response.json({ outcome: 'invalid', field: 'consent', reason: `Consent must be one of ${CONSENT_LEVELS.join(', ')}.`, recovery: 'Choose a consent level on the consent step.' }, { status: 400 });
  }
  const consent: Consent = isConsent(body.consent) ? body.consent : 'private';
  const assetIds$ = takeStringList(body.assetIds, 'assetIds', { max: MAX_ASSETS_PER_CONTRIBUTION, label: 'The attached files' });
  if (refused(assetIds$)) return assetIds$.refusal;
  const assetIds = assetIds$;
  // Alt text is per file and describes an image for someone who cannot see it. Only
  // strings are kept, so a malformed map cannot reach the update that writes them.
  // A map that is not a map is refused rather than read as an empty one, so alternative
  // text sent in the wrong shape does not vanish while the contribution reports `applied`.
  if (body.assetAlts !== undefined && (!body.assetAlts || typeof body.assetAlts !== 'object' || Array.isArray(body.assetAlts))) {
    return Response.json({ outcome: 'invalid', field: 'assetAlts', reason: 'The alternative text must be an object keyed by file id.', recovery: 'Send { "AST-…": "what the image shows" }.' }, { status: 400 });
  }
  const rawAlts = (body.assetAlts ?? {}) as Record<string, unknown>;
  const assetAlts: Record<string, string> = {};
  for (const [assetId, text] of Object.entries(rawAlts)) {
    const alt = takeText(text, 'assetAlts', { max: MAX_TEXT.altText, label: 'Alternative text' });
    if (refused(alt)) return alt.refusal;
    if (alt) assetAlts[assetId] = alt;
  }
  const kinds = details.map((detail) => detail.kind) as ContributionKind[];

  // The stored description stays human-readable for every existing curator surface
  // that renders it; `details` carries the structure alongside it.
  const description = details
    .map((detail) => `${detail.kind}\n${fieldsFor(detail.kind)
      .filter((field) => detail.values[field.name])
      .map((field) => `${field.label}: ${detail.values[field.name]}`).join('\n')}`)
    .join('\n\n');

  const policy = evaluatePolicy({ actor: role, action: 'submit_evidence', museumMatch: fallbackObject.id === (requestedId || 'moonbird-mask') });
  const id = `SUB-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  let attached = 0;
  try {
    const db = await ensureDatabase(museumId);
    const now = Date.now();
    await db.prepare('INSERT INTO submissions (id,museum_id,object_id,kind,title,description,source,consent,requested_outcome,contributor_name,contributor_role,evidence_refs,status,details,asset_ids,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, museumId, objectId, describeKinds(kinds), title, description, source, consent,
        requestedOutcome, source, 'community', '[]', 'received',
        JSON.stringify(details), JSON.stringify(assetIds), now, now).run();
    attached = await attachAssetsToSubmission(museumId, id, assetIds, consent, objectId, assetAlts);
    await recordActivity(museumId, 'Community Agent', 'submitted new evidence', title, {
      tool: 'submit_evidence', target: id, risk: 'MEDIUM', policyDecision: 'applied', result: id,
    });
  } catch {
    return Response.json({ id, ...policy, object_id: objectId, persisted: false });
  }
  return Response.json({ id, ...policy, object_id: objectId, persisted: true, kinds, attached_assets: attached });
});
