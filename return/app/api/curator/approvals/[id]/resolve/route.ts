import { getApproval, recordActivity } from '@/db/queries';
import { ensureDatabase, sha256 } from '@/db/setup';
import { sessionFromRequest } from '@/lib/session';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { role, museumId } = sessionFromRequest(request);
  if (role !== 'curator') return Response.json({ error: 'Curator role required' }, { status: 403 });

  const { id } = await params;
  const body = await request.json() as { action?: string; draft?: string };
  if (!['approved', 'rejected'].includes(body.action ?? '')) return Response.json({ error: 'Invalid resolution' }, { status: 400 });

  const approval = await getApproval(museumId, id).catch(() => null);
  if (!approval) return Response.json({ error: 'Approval not found' }, { status: 404 });
  if (approval.status !== 'pending') {
    return Response.json({ outcome: 'denied', policy: 'approval_already_resolved', reason: `This approval was already ${approval.status}.`, recovery: 'Create a new approval request for the current draft.' }, { status: 409 });
  }

  const draft = body.draft ?? approval.snapshot;
  const edited = draft !== approval.snapshot;
  const resolution = body.action === 'approved' ? (edited ? 'approved_with_edit' : 'approved') : 'rejected';

  const db = await ensureDatabase(museumId);
  await db.prepare('UPDATE approvals SET status=?, resolution=?, snapshot=?, snapshot_hash=?, resolved_at=? WHERE museum_id=? AND id=?')
    .bind(body.action, resolution, draft, await sha256(draft), Date.now(), museumId, id).run();
  await recordActivity(museumId, 'Mina, Curator',
    body.action === 'approved' ? (edited ? 'edited and approved label revision' : 'approved label revision') : 'rejected label revision',
    `Moonbird Mask · revision ${approval.object_version + 1}`);

  return Response.json({ id, status: body.action, resolution, edited, persisted: true });
}
