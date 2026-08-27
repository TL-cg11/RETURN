import type { ReactNode } from 'react';
import { listApprovals, listSubmissions } from '@/db/queries';
import { CuratorShell, type PendingApproval } from '@/components/curator/curator-shell';
import { objectRecord } from '@/lib/records';
import { sessionFromCookies } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function CuratorLayout({ children }: { children: ReactNode }) {
  const { museumId } = await sessionFromCookies();
  const [pending, submissions] = await Promise.all([
    listApprovals(museumId, 'pending'),
    listSubmissions(museumId),
  ]);

  const first = pending[0];
  const record = first ? await objectRecord(museumId, first.object_id, 'curator') : null;
  const approval: PendingApproval | null = first ? {
    id: first.id,
    objectId: first.object_id,
    objectTitle: record?.title ?? first.object_id,
    currentLabel: record?.label ?? '',
    snapshot: first.snapshot,
    objectVersion: first.object_version,
  } : null;

  return (
    <CuratorShell approval={approval} pendingCount={pending.length} submissionCount={submissions.length}>
      {children}
    </CuratorShell>
  );
}
