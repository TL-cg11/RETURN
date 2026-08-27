import { NavLink as Link } from '@/components/shared/nav-link';
import { ContributionForm } from '@/components/community/contribution-form';
import { CommunityHeader } from '@/components/shared/community-header';
import { collectionFor } from '@/lib/records';
import { sessionFromCookies } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ContributePage({ searchParams }: { searchParams: Promise<{ object?: string }> }) {
  const { object } = await searchParams;
  const { museumId } = await sessionFromCookies();
  const collection = await collectionFor(museumId);
  const arrived = collection.find((item) => item.id === object);
  const selected = arrived
    ?? collection.find((item) => item.id === 'moonbird-mask')
    ?? collection[0];
  if (!selected) return null;

  return (
    <main className="contribute-page">
      <CommunityHeader />
      <div className="object-breadcrumb">
        <Link href={`/objects/${selected.id}`}>← {selected.title}</Link>
        <span>/</span>
        <span>Add to the record</span>
      </div>
      {/* FR-C2: arriving from a record settles which object this is about, so the
          picker step is dropped. A bare /contribute still has to ask. */}
      <ContributionForm objectId={selected.id} objects={collection} fromObject={!!arrived} />
    </main>
  );
}
