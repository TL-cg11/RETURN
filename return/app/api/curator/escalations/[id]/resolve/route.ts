import { getEscalation, recordActivity, resolveEscalation } from '@/db/queries';
import { sessionFromRequest } from '@/lib/session';
import { MAX_TEXT } from '@/lib/domain/types';
import { guarded, readJsonBody, refused, takeText } from '@/lib/http/input';

const ACTIONS = { reviewed: 'resolved a policy referral', dismissed: 'dismissed a policy referral' } as const;
type Action = keyof typeof ACTIONS;

/**
 * Closes the loop the policy gateway opened. The gateway refuses an action and
 * hands it to a human; this is where the human hands it back, on the record.
 *
 * Resolving changes no object, label, or evidence — it only records that a
 * curator saw the refusal and what they decided about it.
 */
export const POST = guarded(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { role, museumId } = await sessionFromRequest(request);
  if (role !== 'curator') return Response.json({ outcome: 'denied', risk: 'LOW', reason: 'Curator role required.', recovery: 'Switch to the curator workspace.' }, { status: 403 });

  const { id } = await params;
  const parsed = await readJsonBody(request);
  if (refused(parsed)) return parsed.refusal;
  const body = parsed;
  const action = body.action as Action;
  if (!(action in ACTIONS)) {
    return Response.json({ outcome: 'invalid', field: 'action', reason: `A resolution must be one of ${Object.keys(ACTIONS).join(', ')}.`, recovery: 'Send one of those actions.' }, { status: 400 });
  }
  /**
   * The curator's note, read rather than coerced (V7-2).
   *
   * This was `String(body.note ?? '')`, which turns an object into the six words
   * `[object Object]` and files them in the activity record as though a curator had
   * written them. The record then holds nothing while looking like it holds something,
   * which is worse than holding nothing visibly.
   */
  const note = takeText(body.note, 'note', { max: MAX_TEXT.note, label: 'A note' });
  if (refused(note)) return note.refusal;

  const escalation = await getEscalation(museumId, id).catch(() => null);
  if (!escalation) return Response.json({ outcome: 'invalid', field: 'escalation_id', reason: 'No referral with that id exists in this workspace.', recovery: 'Open the curator overview to see the open referrals.' }, { status: 404 });
  if (escalation.status !== 'open') {
    return Response.json({
      outcome: 'denied', policy: 'escalation_already_resolved',
      reason: `This referral was already ${escalation.status}.`,
      recovery: 'Open the object record to see the current state.',
    }, { status: 409 });
  }

  await resolveEscalation(museumId, id, action);
  await recordActivity(museumId, 'Mina, Curator', ACTIONS[action],
    note || `${escalation.tool.replaceAll('_', ' ')} · ${escalation.policy.replaceAll('_', ' ')}`, {
      actorRole: 'curator_ui', actorType: 'human', tool: escalation.tool,
      target: escalation.object_id ?? '', risk: 'MEDIUM', policyDecision: 'applied', result: id,
    });

  return Response.json({ id, status: action, resolved: true });
});
