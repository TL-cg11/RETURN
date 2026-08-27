import { NavLink as Link } from '@/components/shared/nav-link';
import { listActivity, listSubmissions, workspaceSummary } from '@/db/queries';
import { ApprovalTrigger } from '@/components/curator/approval-trigger';
import { collection } from '@/lib/demo-data';
import { relativeTime, sessionFromCookies } from '@/lib/session';

export const dynamic = 'force-dynamic';

const pad = (value: number) => String(value).padStart(2, '0');

export default async function CuratorDashboard() {
  const { museumId } = await sessionFromCookies();
  const [summary, submissions, activity] = await Promise.all([
    workspaceSummary(museumId),
    listSubmissions(museumId),
    listActivity(museumId, 5),
  ]);
  const queue = submissions.slice(0, 5);

  return (
    <main className="dashboard">
      <div className="dashboard-head">
        <div>
          <p className="console-eyebrow">Curatorial workspace</p>
          <h1>Good evening, Mina.</h1>
          <p>Here’s what needs curatorial attention across the living record.</p>
        </div>
      </div>

      <section className="metric-grid">
        <Link href="/curator/submissions?status=received"><span>New submissions</span><strong>{pad(summary.new_submissions)}</strong><small>{summary.total_submissions} in the inbox</small><i>→</i></Link>
        <Link href="/curator/objects"><span>Objects with gaps</span><strong>{pad(summary.open_gaps)}</strong><small>Of {summary.objects} records</small><i>→</i></Link>
        <ApprovalTrigger><span>Pending approvals</span><strong>{pad(summary.pending_approvals)}</strong><small>Official label revision</small><i>→</i></ApprovalTrigger>
        <Link href="/curator/submissions"><span>Access &amp; consent</span><strong>{pad(summary.consent_alerts)}</strong><small>Not quotable in public output</small><i>!</i></Link>
      </section>

      <div className="dashboard-columns">
        <section className="work-queue">
          <header>
            <div><p className="console-eyebrow">Priority queue</p><h2>Needs your attention</h2></div>
            <Link href="/curator/submissions">View all →</Link>
          </header>
          {queue.length === 0 && <p className="form-help">The inbox is empty in this workspace.</p>}
          {queue.map((submission, index) => (
            <Link className="queue-row" href={`/curator/cases/${submission.id}`} key={submission.id}>
              <span className="queue-index">{pad(index + 1)}</span>
              <div>
                <strong>{submission.title}</strong>
                <small>{collection.find((object) => object.id === submission.object_id)?.title} · {submission.kind}</small>
              </div>
              <span className={`consent-chip ${submission.consent}`}>{submission.consent.replaceAll('_', ' ')}</span>
              <time>{relativeTime(submission.created_at)}</time>
              <b>→</b>
            </Link>
          ))}
        </section>

        <section className="activity-panel">
          <header><p className="console-eyebrow">Live record</p><h2>Recent activity</h2></header>
          <div>
            {activity.map((entry, index) => (
              <article key={entry.id}>
                <span className={`actor-mark actor-${index}`}>{entry.actor.split(' ').map((word) => word[0]).join('').slice(0, 2)}</span>
                <p><strong>{entry.actor}</strong> {entry.action}<small>{entry.detail}</small></p>
                <time>{relativeTime(entry.created_at)}</time>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="gap-overview">
        <header>
          <div><p className="console-eyebrow">Collection health</p><h2>Provenance gaps</h2></div>
          <p>A gap marks missing documentation—not a conclusion. Prioritise records where new material can narrow the question.</p>
        </header>
        <div className="gap-bars">
          {collection.filter((object) => object.gap).map((object, index) => (
            <Link href={`/objects/${object.id}`} key={object.id}>
              <div><strong>{object.title}</strong><span>{object.gap}</span></div>
              <i style={{ width: `${62 - index * 12}%` }} />
              <b>{submissions.filter((s) => s.object_id === object.id).length} sources</b>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
