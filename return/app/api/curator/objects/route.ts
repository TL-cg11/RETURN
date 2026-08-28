import { createObject, recordActivity } from '@/db/queries';
import { missingObjectFields, objectFromDraft, type ObjectDraft } from '@/lib/community/object-input';
import { evaluatePolicy } from '@/lib/policy/evaluate';
import { sessionFromRequest } from '@/lib/session';
import { guarded } from '@/lib/http/input';

/**
 * Registers a new collection record (FR-K5).
 *
 * The gateway grades this HIGH, which for a human curator means the decision must be
 * an explicit one rather than a side effect of filling in a form. `confirmed` is that
 * decision: the form shows the record back and the curator commits to it, the same
 * shape as approving a label in the drawer.
 *
 * An agent never reaches this route. `register_object` on the tool surface produces a
 * proposal for a curator and creates nothing (FR-X3).
 */
export const POST = guarded(async (request: Request) => {
  const { role, museumId } = await sessionFromRequest(request);
  if (role !== 'curator') {
    return Response.json({
      outcome: 'denied', policy: 'role_not_permitted',
      reason: 'Only a curator may add a record to the collection.',
      recovery: 'Submit the object as a contribution for curatorial review.',
    }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as ObjectDraft & { confirmed?: boolean };
  const missing = missingObjectFields(body);
  if (missing.length > 0) {
    return Response.json({ outcome: 'invalid', field: 'record', reason: `${missing[0]} is required.`, recovery: 'Complete the record before registering it.' }, { status: 400 });
  }

  const policy = evaluatePolicy({ actor: 'curator_ui', action: 'register_object', museumMatch: true });
  if (policy.outcome !== 'pending_approval') {
    return Response.json({ ...policy }, { status: 403 });
  }
  if (body.confirmed !== true) {
    return Response.json({
      ...policy, awaiting: 'confirmation',
      reason: 'Registering a record creates official museum material, so it needs an explicit decision.',
      recovery: 'Review the record and confirm the registration.',
    }, { status: 409 });
  }

  const input = objectFromDraft(body);
  if (!input) return Response.json({ outcome: 'invalid', field: 'title', reason: 'The title cannot be turned into a record id.', recovery: 'Use a title with letters or numbers in it.' }, { status: 400 });

  const result = await createObject(museumId, input, 'Mina, Curator');
  if (!result.created) {
    return Response.json({ outcome: 'invalid', field: 'accession', reason: `A record already exists as ${result.clash}.`, recovery: 'Use a different title and accession number.' }, { status: 409 });
  }

  await recordActivity(museumId, 'Mina, Curator', 'registered a new collection record', `${input.title} · ${input.accession}`, {
    actorRole: 'curator_ui', actorType: 'human', tool: 'register_object', target: input.id,
    risk: policy.risk, policyDecision: 'applied', result: input.id,
  });
  return Response.json({ outcome: 'applied', risk: policy.risk, object_id: input.id, accession: input.accession, title: input.title });
});
