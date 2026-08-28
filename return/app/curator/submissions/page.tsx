import { NavLink as Link } from '@/components/shared/nav-link';
import { countByStatus, countSubmissions, listSubmissions, SUBMISSIONS_PER_PAGE, SUBMISSION_STATUSES } from '@/db/queries';
import { collectionFor } from '@/lib/records';
import { relativeTime, sessionFromCookies } from '@/lib/session';

export const dynamic = 'force-dynamic';

type Search = Promise<{ status?: string; object?: string; page?: string }>;

function queryFor(status?: string, object?: string, page?: number) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (object) params.set('object', object);
  if (page && page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `/curator/submissions?${query}` : '/curator/submissions';
}

export default async function SubmissionsPage({ searchParams }: { searchParams: Search }) {
  const { status, object, page } = await searchParams;
  const { museumId } = await sessionFromCookies();
  const collection = await collectionFor(museumId, 'curator');
  const active = SUBMISSION_STATUSES.includes(status as typeof SUBMISSION_STATUSES[number]) ? status : undefined;
  const activeObject = collection.some((item) => item.id === object) ? object : undefined;

  // A workspace with five hundred contributions served a 3.7 MB page and every row on it
  // (V9-6). The filter counts stay whole — a page of rows is a window, not the total.
  const matching = await countSubmissions(museumId, { status: active, objectId: activeObject });
  const pageCount = Math.max(1, Math.ceil(matching / SUBMISSIONS_PER_PAGE));
  const requested = Number.parseInt(page ?? '1', 10);
  const current = Number.isFinite(requested) ? Math.min(Math.max(1, requested), pageCount) : 1;

  const [rows, counts] = await Promise.all([
    listSubmissions(museumId, {
      status: active, objectId: activeObject,
      limit: SUBMISSIONS_PER_PAGE, offset: (current - 1) * SUBMISSIONS_PER_PAGE,
    }),
    countByStatus(museumId),
  ]);
  const firstOnPage = matching === 0 ? 0 : (current - 1) * SUBMISSIONS_PER_PAGE + 1;
  const lastOnPage = Math.min(current * SUBMISSIONS_PER_PAGE, matching);

  return (
    <main id="main" tabIndex={-1} className="console-page">
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
          <Link className={active === name ? 'active' : ''} href={queryFor(name, activeObject, 1)} key={name}>
            {name.charAt(0).toUpperCase() + name.slice(1)} <b>{counts[name]}</b>
          </Link>
        ))}
      </div>

      <div className="object-filter-bar">
        <span className="object-filter-label">Object</span>
        <nav className="object-filter" aria-label="Filter by object">
          <Link className={activeObject ? '' : 'active'} href={queryFor(active, undefined, 1)}>All</Link>
          {collection.map((item) => (
            <Link className={activeObject === item.id ? 'active' : ''} href={queryFor(active, item.id, 1)} key={item.id}>{item.title}</Link>
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

      {pageCount > 1 && (
        <nav className="inbox-paging" aria-label="Submission inbox pages">
          <p className="inbox-range" aria-live="polite">
            Showing {firstOnPage}–{lastOnPage} of {matching}
          </p>
          <div>
            {current > 1
              ? <Link href={queryFor(active, activeObject, current - 1)} rel="prev">← Newer</Link>
              : <span aria-hidden="true">← Newer</span>}
            <span className="inbox-page-of">Page {current} of {pageCount}</span>
            {current < pageCount
              ? <Link href={queryFor(active, activeObject, current + 1)} rel="next">Older →</Link>
              : <span aria-hidden="true">Older →</span>}
          </div>
        </nav>
      )}

      <aside className="content-guidance">
        <b>Why “submitted”?</b>
        <p>It means the museum has received the material, not that it has judged the account true or false. Verification checks source, consent, and record context.</p>
      </aside>
    </main>
  );
}
