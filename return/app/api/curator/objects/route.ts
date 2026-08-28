import { createObject, recordActivity } from '@/db/queries';
import { validateObjectDraft, type ObjectDraft } from '@/lib/community/object-input';
import { evaluatePolicy } from '@/lib/policy/evaluate';
import { guardedWrite, readJsonBody, refused } from '@/lib/http/input';

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
export const POST = guardedWrite(async (request: Request, session) => {
  const { role, museumId } = session;
  if (role !== 'curator') {
    return Response.json({
      outcome: 'denied', policy: 'role_not_permitted',
      reason: 'Only a curator may add a record to the collection.',
      recovery: 'Submit the object as a contribution for curatorial review.',
    }, { status: 403 });
  }

  const parsed = await readJsonBody(request);
  if (refused(parsed)) return parsed.refusal;
  const body = parsed as ObjectDraft & { confirmed?: boolean };

  /**
   * The whole record, checked before the gateway is asked about it (V7-3).
   *
   * The refusal names the field it is about. This route used to answer `field: "record"`
   * for every problem, which told a caller that something in a nine-field form was wrong
   * and left them to find out which — the one refusal on this system that did not say
   * what to fix.
   */
  const validated = validateObjectDraft(body);
  if (!validated.ok) {
    return Response.json({ outcome: 'invalid', field: validated.field, reason: validated.reason, recovery: validated.recovery }, { status: 400 });
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

  const input = validated.input;
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
