import { getEscalation, recordActivity, resolveEscalation } from '@/db/queries';
import { sessionFromRequest } from '@/lib/session';

const ACTIONS = { reviewed: 'resolved a policy referral', dismissed: 'dismissed a policy referral' } as const;
type Action = keyof typeof ACTIONS;

/**
 * Closes the loop the policy gateway opened. The gateway refuses an action and
 * hands it to a human; this is where the human hands it back, on the record.
 *
 * Resolving changes no object, label, or evidence — it only records that a
 * curator saw the refusal and what they decided about it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { role, museumId } = await sessionFromRequest(request);
  if (role !== 'curator') return Response.json({ error: 'Curator role required' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { action?: string; note?: string };
  const action = body.action as Action;
  if (!(action in ACTIONS)) {
    return Response.json({ error: 'Invalid resolution', expected: Object.keys(ACTIONS) }, { status: 400 });
  }

  const escalation = await getEscalation(museumId, id).catch(() => null);
  if (!escalation) return Response.json({ error: 'Escalation not found' }, { status: 404 });
  if (escalation.status !== 'open') {
    return Response.json({
      outcome: 'denied', policy: 'escalation_already_resolved',
      reason: `This referral was already ${escalation.status}.`,
      recovery: 'Open the object record to see the current state.',
    }, { status: 409 });
  }

  await resolveEscalation(museumId, id, action);
  const note = String(body.note ?? '').trim();
  await recordActivity(museumId, 'Mina, Curator', ACTIONS[action],
    note || `${escalation.tool.replaceAll('_', ' ')} · ${escalation.policy.replaceAll('_', ' ')}`, {
      actorRole: 'curator_ui', actorType: 'human', tool: escalation.tool,
      target: escalation.object_id ?? '', risk: 'MEDIUM', policyDecision: 'applied', result: id,
    });

  return Response.json({ id, status: action, resolved: true });
}
