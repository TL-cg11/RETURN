import { NavLink as Link } from '@/components/shared/nav-link';
import { listSubmissions } from '@/db/queries';
import { collection } from '@/lib/demo-data';
import { relativeTime, sessionFromCookies } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ObjectsPage() {
  const { museumId } = await sessionFromCookies();
  const submissions = await listSubmissions(museumId);

  return (
    <main className="console-page">
      <div className="page-head">
        <div>
          <p className="console-eyebrow">Collection records</p>
          <h1>Objects</h1>
          <p>Prioritise records with gaps, new context, and unresolved access questions.</p>
        </div>
      </div>

      <div className="object-admin-list">
        <div className="table-head"><span>Object</span><span>Record state</span><span>Provenance</span><span>Contributions</span><span /></div>
        {collection.map((object) => {
          const attached = submissions.filter((row) => row.object_id === object.id);
          const latest = attached[0];
          return (
            <Link className="object-admin-row" href={`/objects/${object.id}`} key={object.id}>
              <span className={`admin-thumb ${object.tone}`}><i /></span>
              <div><strong>{object.title}</strong><small>{object.accession} · {object.date}</small></div>
              <span>{object.status}</span>
              <span className={object.gap ? 'has-gap' : ''}>{object.gap ? `Gap ${object.gap}` : 'No open gap'}</span>
              <time>{latest ? relativeTime(latest.created_at) : `${attached.length} on file`}</time>
              <b>→</b>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
