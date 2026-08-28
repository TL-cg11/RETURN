import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { listApprovals, listSubmissions } from '@/db/queries';
import { CuratorShell, type PendingApproval } from '@/components/curator/curator-shell';
import { objectRecord } from '@/lib/records';
import { sessionFromCookies } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function CuratorLayout({ children }: { children: ReactNode }) {
  const { role, museumId } = await sessionFromCookies();
  // The workspace is curator-only. A community session is told nothing about it,
  // the same answer an unknown record gets.
  if (role !== 'curator') notFound();
  const [pending, submissions] = await Promise.all([
    listApprovals(museumId, 'pending'),
    listSubmissions(museumId),
  ]);

  // The whole queue, not just its head. A badge that says two and a drawer that can
  // only ever open one is a drawer that lies about the queue (FR2-K3).
  const records = await Promise.all(pending.map((row) => objectRecord(museumId, row.object_id, 'curator')));
  const approvals: PendingApproval[] = pending.map((row, index) => ({
    id: row.id,
    objectId: row.object_id,
    objectTitle: records[index]?.title ?? row.object_id,
    currentLabel: records[index]?.label ?? '',
    snapshot: row.snapshot,
    objectVersion: row.object_version,
  }));

  return (
    <CuratorShell approvals={approvals} submissionCount={submissions.length}>
      {children}
    </CuratorShell>
  );
}
