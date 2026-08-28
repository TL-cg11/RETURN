import { appendClarification, getSubmission, recordActivity, setSubmissionStatus } from '@/db/queries';
import { MAX_CLARIFICATION_CHARS } from '@/lib/domain/types';
import { evaluatePolicy } from '@/lib/policy/evaluate';
import { sessionFromRequest } from '@/lib/session';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { role, museumId } = await sessionFromRequest(request);
  // This route answered its role check and its not-found path with `{ error }` while its
  // own validation answered in the four fields — two shapes inside one file (F5-2). The
  // conversions in OB-4 and F4-4 both missed it.
  if (role !== 'curator') {
    return Response.json({ outcome: 'denied', risk: 'LOW', reason: 'Curator role required.', recovery: 'Switch to the curator workspace.' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json() as { question?: string };
  const question = (body.question ?? '').trim();
  if (!question) return Response.json({ outcome: 'invalid', field: 'question', reason: 'A clarification needs a question.', recovery: 'Ask about date, place, source, or consent scope.' }, { status: 400 });
  // Refused rather than trimmed, so the contributor reads the question the curator wrote
  // and the agent reads the same one (OB-1).
  if (question.length > MAX_CLARIFICATION_CHARS) {
    return Response.json({ outcome: 'invalid', field: 'question', reason: `A clarification is at most ${MAX_CLARIFICATION_CHARS} characters, and this one is ${question.length}.`, recovery: 'Ask one focused question; open a second one for the rest.' }, { status: 400 });
  }

  const submission = await getSubmission(museumId, id).catch(() => null);
  if (!submission) {
    return Response.json({ outcome: 'invalid', field: 'submission_id', reason: 'No contribution with that id exists in this workspace.', recovery: 'Open the contribution from the submission inbox.' }, { status: 404 });
  }

  const policy = evaluatePolicy({ actor: role, action: 'request_clarification', museumMatch: submission.museum_id === museumId });
  // The question used to exist only inside an activity log detail string, which the
  // contributor never sees. A curator asking a question nobody can read is not a
  // question (FR2-K1). It is stored on the contribution and read back by both surfaces.
  const asked = await appendClarification(museumId, id, question);
  await setSubmissionStatus(museumId, id, 'needs information');
  await recordActivity(museumId, 'Mina, Curator', 'requested clarification', `${submission.title} · ${question}`, {
    actorRole: 'curator_ui', actorType: 'human', tool: 'request_clarification', target: id,
    risk: policy.risk, policyDecision: policy.outcome, result: 'needs information',
  });
  return Response.json({ id, ...policy, status: 'needs information', question, asked });
}
