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
  const selected = collection.find((item) => item.id === object)
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
      <ContributionForm objectId={selected.id} objects={collection} />
    </main>
  );
}
