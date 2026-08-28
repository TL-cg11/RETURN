import { NavLink as Link } from '@/components/shared/nav-link';
import { RegisterObject } from '@/components/curator/register-object';
import { countSubmissionsByObject } from '@/db/queries';
import { collectionFor } from '@/lib/records';
import { relativeTime, sessionFromCookies } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ObjectsPage() {
  const { museumId } = await sessionFromCookies();
  const [submissionCounts, collection] = await Promise.all([
    countSubmissionsByObject(museumId),
    collectionFor(museumId, 'curator'),
  ]);

  return (
    <main id="main" tabIndex={-1} className="console-page">
      <div className="page-head">
        <div>
          <p className="console-eyebrow">Collection records</p>
          <h1>Objects</h1>
          <p>Prioritise records with gaps, new context, and unresolved access questions.</p>
        </div>
        <RegisterObject />
      </div>

      <div className="object-admin-list">
        <div className="table-head"><span /><span>Object</span><span>Record state</span><span>Provenance</span><span>Contributions</span><span /></div>
        {collection.map((object) => {
          const attached = submissionCounts.get(object.id) ?? { total: 0, received: 0, latest: null };
          return (
            <Link className="object-admin-row" href={`/objects/${object.id}`} key={object.id}>
              <span className={`admin-thumb ${object.tone}`}><i /></span>
              <div><strong>{object.title}</strong><small>{object.accession} · {object.date}</small></div>
              <span>{object.status}</span>
              <span className={object.gap ? 'has-gap' : ''}>{object.gap ? `Gap ${object.gap}` : 'No open gap'}</span>
              <time>{attached.latest ? relativeTime(attached.latest) : `${attached.total} on file`}</time>
              <b>→</b>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
