import { attachAssetsToSubmission, recordActivity } from '@/db/queries';
import { ensureDatabase } from '@/db/setup';
import { CONTRIBUTION_KINDS, describeKinds, fieldsFor, missingFields, type ContributionKind, type KindDetail } from '@/lib/community/contribution';
import { MAX_ASSETS_PER_CONTRIBUTION } from '@/lib/assets/access';
import { CONSENT_LEVELS, isConsent, type Consent } from '@/lib/domain/types';
import { evaluatePolicy } from '@/lib/policy/evaluate';
import { findObject } from '@/lib/records';
import { sessionFromRequest } from '@/lib/session';

type Body = {
  objectId?: string;
  kinds?: string[];
  details?: { kind?: string; values?: Record<string, string> }[];
  assetIds?: string[];
  assetAlts?: Record<string, string>;
  title?: string;
  source?: string;
  consent?: string;
  requestedOutcome?: string;
};



/** Keeps only declared kinds and declared field names, in the order the form offers them. */
function readDetails(body: Body): KindDetail[] {
  const chosen = CONTRIBUTION_KINDS.filter((kind) => (body.kinds ?? []).includes(kind));
  return chosen.map((kind) => {
    const supplied = (body.details ?? []).find((entry) => entry.kind === kind)?.values ?? {};
    const values: Record<string, string> = {};
    for (const field of fieldsFor(kind)) {
      const value = supplied[field.name];
      if (typeof value === 'string' && value.trim()) values[field.name] = value.trim().slice(0, 4000);
    }
    return { kind, values };
  });
}

/**
 * One contribution, however many kinds of material it carries (FR-C3).
 *
 * The per-kind answers are stored as `details` rather than flattened into the
 * description, so the curator case can show what was actually asked for each kind
 * and the review step can be rebuilt from the same declarations the form renders.
 */
export async function POST(request: Request) {
  const { role, museumId } = await sessionFromRequest(request);
  // Every other refusal here answers in the reason/recovery shape the form renders.
  // This one used to answer `error` alone, so a curator session saw only the generic
  // "Could not submit this contribution."
  if (role === 'curator') {
    return Response.json({
      outcome: 'denied', policy: 'role_not_permitted', error: 'Community role required',
      reason: 'This session is signed in as a curator, and curators do not file community contributions.',
      recovery: 'Switch to the community view and submit again.',
    }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Body;
  const requestedId = body.objectId?.trim();
  const fallbackObject = await findObject(museumId, requestedId || 'moonbird-mask');
  if (!fallbackObject) return Response.json({ error: 'No public object is available' }, { status: 404 });
  const objectId = fallbackObject.id;

  const title = (body.title ?? '').trim();
  if (!title) return Response.json({ outcome: 'invalid', field: 'title', reason: 'A contribution needs a short title.', recovery: 'Add a title describing the material.' }, { status: 400 });

  const details = readDetails(body);
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
  const assetIds = (body.assetIds ?? []).filter((value) => typeof value === 'string').slice(0, MAX_ASSETS_PER_CONTRIBUTION);
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
      .bind(id, museumId, objectId, describeKinds(kinds), title, description, body.source ?? '', consent,
        body.requestedOutcome ?? 'Add context', body.source ?? '', 'community', '[]', 'received',
        JSON.stringify(details), JSON.stringify(assetIds), now, now).run();
    attached = await attachAssetsToSubmission(museumId, id, assetIds, consent, objectId, body.assetAlts);
    await recordActivity(museumId, 'Community Agent', 'submitted new evidence', title, {
      tool: 'submit_evidence', target: id, risk: 'MEDIUM', policyDecision: 'applied', result: id,
    });
  } catch {
    return Response.json({ id, ...policy, object_id: objectId, persisted: false });
  }
  return Response.json({ id, ...policy, object_id: objectId, persisted: true, kinds, attached_assets: attached });
}
