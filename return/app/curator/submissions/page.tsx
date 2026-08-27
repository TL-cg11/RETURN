import { NavLink as Link } from '@/components/shared/nav-link';
import { countByStatus, listSubmissions, SUBMISSION_STATUSES } from '@/db/queries';
import { collectionFor } from '@/lib/records';
import { relativeTime, sessionFromCookies } from '@/lib/session';

export const dynamic = 'force-dynamic';

type Search = Promise<{ status?: string; object?: string }>;

function queryFor(status?: string, object?: string) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (object) params.set('object', object);
  const query = params.toString();
  return query ? `/curator/submissions?${query}` : '/curator/submissions';
}

export default async function SubmissionsPage({ searchParams }: { searchParams: Search }) {
  const { status, object } = await searchParams;
  const { museumId } = await sessionFromCookies();
  const collection = await collectionFor(museumId, 'curator');
  const active = SUBMISSION_STATUSES.includes(status as typeof SUBMISSION_STATUSES[number]) ? status : undefined;
  const activeObject = collection.some((item) => item.id === object) ? object : undefined;

  const [rows, counts] = await Promise.all([
    listSubmissions(museumId, { status: active, objectId: activeObject }),
    countByStatus(museumId),
  ]);

  return (
    <main className="console-page">
      <div className="page-head">
        <div>
          <p className="console-eyebrow">Community contributions</p>
          <h1>Submission inbox</h1>
          <p>Review source, consent, and requested outcomes before using material in the record.</p>
        </div>
      </div>

      <div className="filter-bar">
        <Link className={active ? '' : 'active'} href={queryFor(undefined, activeObject)}>All <b>{counts.all}</b></Link>
        {SUBMISSION_STATUSES.filter((name) => counts[name] > 0 || name === active).map((name) => (
          <Link className={active === name ? 'active' : ''} href={queryFor(name, activeObject)} key={name}>
            {name.charAt(0).toUpperCase() + name.slice(1)} <b>{counts[name]}</b>
          </Link>
        ))}
      </div>

      <div className="object-filter-bar">
        <span className="object-filter-label">Object</span>
        <nav className="object-filter" aria-label="Filter by object">
          <Link className={activeObject ? '' : 'active'} href={queryFor(active, undefined)}>All</Link>
          {collection.map((item) => (
            <Link className={activeObject === item.id ? 'active' : ''} href={queryFor(active, item.id)} key={item.id}>{item.title}</Link>
          ))}
        </nav>
      </div>

      <div className="submission-table">
        <div className="table-head"><span>Submission</span><span>Object</span><span>Permission</span><span>Status</span><span>Received</span><span /></div>
        {rows.length === 0 && <p className="form-help">No contributions match this filter.</p>}
        {rows.map((row) => (
          <Link className="submission-row" href={`/curator/cases/${row.id}`} key={row.id}>
            <div>
              <span className="submitted-badge">Submitted content</span>
              <strong>{row.title}</strong>
              <small>{row.id} · {row.kind} · by {row.source}</small>
            </div>
            <span>{collection.find((item) => item.id === row.object_id)?.title ?? row.object_id}</span>
            <span className={`consent-chip ${row.consent}`}>{row.consent.replaceAll('_', ' ')}</span>
            <span className="status-text">{row.status}</span>
            <time>{relativeTime(row.created_at)}</time>
            <b>→</b>
          </Link>
        ))}
      </div>

      <aside className="content-guidance">
        <b>Why “submitted”?</b>
        <p>It means the museum has received the material, not that it has judged the account true or false. Verification checks source, consent, and record context.</p>
      </aside>
    </main>
  );
}
