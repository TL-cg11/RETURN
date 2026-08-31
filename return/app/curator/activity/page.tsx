import { NavLink as Link } from '@/components/shared/nav-link';
import { countActivity, listActivity } from '@/db/queries';
import { relativeTime, sessionFromCookies } from '@/lib/session';

export const dynamic = 'force-dynamic';

const PER_PAGE = 25;

/** Policy denials and human decisions read differently in an audit trail. */
function outcomeOf(action: string) {
  if (action.startsWith('denied') || action.startsWith('was denied') || action.startsWith('rejected')) return 'Denied';
  if (action.includes('proposed') || action.includes('requested')) return 'Pending';
  return 'Applied';
}

type Search = Promise<{ page?: string }>;

export default async function ActivityPage({ searchParams }: { searchParams: Search }) {
  const { page } = await searchParams;
  const { museumId } = await sessionFromCookies();
  const total = await countActivity(museumId);
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const current = Math.min(Math.max(1, Number(page) || 1), pageCount);
  const entries = await listActivity(museumId, PER_PAGE, (current - 1) * PER_PAGE);
  const first = total === 0 ? 0 : (current - 1) * PER_PAGE + 1;

  return (
    <main id="main" tabIndex={-1} className="console-page">
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

      {pageCount > 1 && (
        <nav className="pager" aria-label="Activity pages">
          <Link className={current === 1 ? 'disabled' : ''} aria-disabled={current === 1} href={`/curator/activity?page=${current - 1}`}>← Newer</Link>
          <span className="pager-pages">
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
              <Link aria-current={number === current ? 'page' : undefined} className={number === current ? 'active' : ''} href={`/curator/activity?page=${number}`} key={number}>{number}</Link>
            ))}
          </span>
          <Link className={current === pageCount ? 'disabled' : ''} aria-disabled={current === pageCount} href={`/curator/activity?page=${current + 1}`}>Older →</Link>
        </nav>
      )}

      <p className="pager-count">{total === 0 ? 'No entries' : `Showing ${first}–${first + entries.length - 1} of ${total} entries`}</p>
    </main>
  );
}
