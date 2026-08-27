import { NavLink as Link } from '@/components/shared/nav-link';
import { notFound } from 'next/navigation';
import { getSubmission } from '@/db/queries';
import { CommunityHeader } from '@/components/shared/community-header';
import { findObject } from '@/lib/records';
import { relativeTime, sessionFromCookies } from '@/lib/session';

export const dynamic = 'force-dynamic';

const STAGES = ['Received by museum', 'Source and consent review', 'Compared with official record', 'Outcome shared with you'] as const;

/** How far a submission has moved through review. */
function stageIndex(status: string) {
  if (status === 'closed' || status === 'reflected in label') return 3;
  if (status === 'under review') return 2;
  if (status === 'needs information') return 1;
  return 0;
}

export default async function SubmissionStatus({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { museumId } = await sessionFromCookies();
  const submission = await getSubmission(museumId, id);
  if (!submission) notFound();

  const object = await findObject(museumId, submission.object_id);
  const current = stageIndex(submission.status);

  return (
    <main>
      <CommunityHeader />
      <section className="status-page">
        <p className="eyebrow">Contribution received</p>
        <div className="status-check">✓</div>
        <h1>Thank you for adding to the record.</h1>
        <p>Your {submission.kind.toLowerCase()} is now visible to the curatorial team. The public label has not changed.</p>

        <div className="tracking-card">
          <div><small>Submission</small><strong>{submission.id}</strong></div>
          <span className="submitted-badge">Submitted</span>
          <ol>
            {STAGES.map((label, index) => (
              <li className={index === current ? 'current' : index < current ? 'done' : ''} key={label}>
                <span />{label}
                {index === current && <time>{relativeTime(submission.created_at)}</time>}
              </li>
            ))}
          </ol>
          {submission.status === 'needs information' && (
            <p className="form-help">A curator has asked a follow-up question about this contribution.</p>
          )}
        </div>

        <dl className="review-list">
          <div><dt>Object</dt><dd>{object?.title ?? submission.object_id}</dd></div>
          <div><dt>Permission</dt><dd>{submission.consent.replaceAll('_', ' ')}</dd></div>
          <div><dt>Requested</dt><dd>{submission.requested_outcome}</dd></div>
        </dl>

        <div className="status-actions">
          <Link className="primary-action" href={`/objects/${submission.object_id}`}>Return to object <span aria-hidden="true">→</span></Link>
          <Link className="text-action" href="/">Browse the collection</Link>
        </div>
      </section>
    </main>
  );
}
