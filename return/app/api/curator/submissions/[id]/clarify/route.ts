import { appendClarification, getSubmission, recordActivity, setSubmissionStatus } from '@/db/queries';
import { evaluatePolicy } from '@/lib/policy/evaluate';
import { sessionFromRequest } from '@/lib/session';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { role, museumId } = await sessionFromRequest(request);
  if (role !== 'curator') return Response.json({ error: 'Curator role required' }, { status: 403 });

  const { id } = await params;
  const body = await request.json() as { question?: string };
  const question = (body.question ?? '').trim();
  if (!question) return Response.json({ outcome: 'invalid', field: 'question', reason: 'A clarification needs a question.', recovery: 'Ask about date, place, source, or consent scope.' }, { status: 400 });

  const submission = await getSubmission(museumId, id).catch(() => null);
  if (!submission) return Response.json({ error: 'Submission not found' }, { status: 404 });

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
