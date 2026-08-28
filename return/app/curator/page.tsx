import { NavLink as Link } from '@/components/shared/nav-link';
import { countEscalations, listActivity, listEscalations, listSubmissions, workspaceSummary } from '@/db/queries';
import { ApprovalTrigger } from '@/components/curator/approval-trigger';
import { EscalationActions } from '@/components/curator/escalation-actions';
import { collectionFor } from '@/lib/records';
import { relativeTime, sessionFromCookies } from '@/lib/session';

export const dynamic = 'force-dynamic';

const pad = (value: number) => String(value).padStart(2, '0');

/** Plain-language rendering of a policy code. The card must explain, not just label. */
const POLICY_REASON: Record<string, string> = {
  submitted_sole_authority: 'Submitted evidence cannot be the sole authority for an official change.',
  visibility_restricted: 'Restricted or sealed material cannot appear in public output.',
  consent_not_public: 'The evidence consent does not permit public quotation.',
};

function sourceRefs(raw: string) {
  try { const parsed: unknown = JSON.parse(raw); return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return []; }
}

export default async function CuratorDashboard() {
  const { museumId } = await sessionFromCookies();
  const [summary, submissions, activity, collection, escalations, escalationTotal] = await Promise.all([
    workspaceSummary(museumId),
    listSubmissions(museumId),
    listActivity(museumId, 5),
    collectionFor(museumId, 'curator'),
    listEscalations(museumId, 'open', 5),
    countEscalations(museumId, 'open'),
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

      {escalations.length > 0 && (
        <section className="escalation-panel">
          <header>
            <div><p className="console-eyebrow">Referred to you</p><h2>The gateway refused {escalationTotal === 1 ? 'an action' : `${escalationTotal} actions`}</h2></div>
            <p>An agent stopped short of the official record and handed the question over. Nothing was published.</p>
          </header>
          {escalations.map((item) => (
            <article className="escalation-card" key={item.id}>
              <div className="escalation-mark">{item.id}</div>
              <div>
                <strong>{POLICY_REASON[item.policy] ?? 'The action was refused by policy.'}</strong>
                <small>
                  {collection.find((object) => object.id === item.object_id)?.title ?? item.object_id ?? 'This workspace'}
                  {' · '}{item.tool.replaceAll('_', ' ')}
                  {sourceRefs(item.source_refs).length > 0 && ` · cites ${sourceRefs(item.source_refs).join(', ')}`}
                </small>
              </div>
              <span className="policy-code">{item.policy.replaceAll('_', ' ')}</span>
              <time>{relativeTime(item.created_at)}</time>
              <div className="escalation-close">
                {/* Only a record that exists. An escalation may name an object that was
                    proposed and never created, and a link to it is a link to a 404 (EA-4). */}
                {item.object_id && collection.some((object) => object.id === item.object_id) && (
                  <Link className="escalation-open" href={`/objects/${item.object_id}`}>Open record →</Link>
                )}
                <EscalationActions escalationId={item.id} />
              </div>
            </article>
          ))}
          {escalationTotal > escalations.length && (
            <p className="escalation-more">Showing the {escalations.length} most recent of {escalationTotal} open referrals.</p>
          )}
        </section>
      )}

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
