import { listActivity } from '@/db/queries';
import { relativeTime, sessionFromCookies } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Policy denials and human decisions read differently in an audit trail. */
function outcomeOf(action: string) {
  if (action.startsWith('denied') || action.startsWith('was denied') || action.startsWith('rejected')) return 'Denied';
  if (action.includes('proposed') || action.includes('requested')) return 'Pending';
  return 'Applied';
}

export default async function ActivityPage() {
  const { museumId } = await sessionFromCookies();
  const entries = await listActivity(museumId, 50);

  return (
    <main className="console-page">
      <div className="page-head">
        <div>
          <p className="console-eyebrow">Audit trail</p>
          <h1>Activity</h1>
          <p>Agent research, policy decisions, and human edits remain visible as one record.</p>
        </div>
      </div>

      <div className="audit-log">
        {entries.length === 0 && <p className="form-help">No activity has been recorded in this workspace.</p>}
        {entries.map((entry, index) => (
          <article key={entry.id}>
            <time>{new Date(entry.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase()}<br /><strong>{new Date(entry.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</strong></time>
            <span className={`actor-mark actor-${index % 5}`}>{entry.actor.split(' ').map((word) => word[0]).join('').slice(0, 2)}</span>
            <div><strong>{entry.actor}</strong><p>{entry.action}</p><small>{entry.detail} · {relativeTime(entry.created_at)}</small></div>
            <i>{outcomeOf(entry.action)}</i>
          </article>
        ))}
      </div>
    </main>
  );
}
