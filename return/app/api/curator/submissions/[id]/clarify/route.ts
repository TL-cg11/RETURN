import { appendClarification, getSubmission, recordActivity, setSubmissionStatus } from '@/db/queries';
import { MAX_TEXT, isSettledSubmission } from '@/lib/domain/types';
import { guardedWrite, readJsonBody, refused, takeText } from '@/lib/http/input';
import { evaluatePolicy } from '@/lib/policy/evaluate';

export const POST = guardedWrite(async (request: Request, session, { params }: { params: Promise<{ id: string }> }) => {
  const { role, museumId } = session;
  // This route answered its role check and its not-found path with `{ error }` while its
  // own validation answered in the four fields — two shapes inside one file (F5-2). The
  // conversions in OB-4 and F4-4 both missed it.
  if (role !== 'curator') {
    return Response.json({ outcome: 'denied', risk: 'LOW', reason: 'Curator role required.', recovery: 'Switch to the curator workspace.' }, { status: 403 });
  }

  const { id } = await params;
  const parsed = await readJsonBody(request);
  if (refused(parsed)) return parsed.refusal;
  // `(body.question ?? '').trim()` threw for anything that was not a string, and the
  // platform answered with an empty 500 (F6-1). Refused rather than trimmed, so the
  // contributor reads the question the curator wrote and the agent reads the same one.
  const asking = takeText(parsed.question, 'question', { max: MAX_TEXT.question, required: true, label: 'A clarification' });
  if (refused(asking)) return asking.refusal;
  const question = asking;

  const submission = await getSubmission(museumId, id).catch(() => null);
  if (!submission) {
    return Response.json({ outcome: 'invalid', field: 'submission_id', reason: 'No contribution with that id exists in this workspace.', recovery: 'Open the contribution from the submission inbox.' }, { status: 404 });
  }

  // The same guard the approval path has carried all along (F6-5).
  if (isSettledSubmission(submission.status)) {
    return Response.json({
      outcome: 'denied', policy: 'submission_settled',
      reason: `This contribution is ${submission.status} and its review has ended.`,
      recovery: 'Open a new contribution on the same record to carry the question forward.',
    }, { status: 409 });
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
});
