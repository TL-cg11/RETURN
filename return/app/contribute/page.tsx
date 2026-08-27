import Link from 'next/link';
import { ContributionForm } from '@/components/community/contribution-form';
import { CommunityHeader } from '@/components/shared/community-header';
import { collection, moonbird } from '@/lib/demo-data';

export default async function ContributePage({ searchParams }: { searchParams: Promise<{ object?: string }> }) {
  const { object } = await searchParams;
  const selected = collection.find((item) => item.id === object) ?? moonbird;

  return (
    <main className="contribute-page">
      <CommunityHeader />
      <div className="object-breadcrumb">
        <Link href={`/objects/${selected.id}`}>← {selected.title}</Link>
        <span>/</span>
        <span>Add to the record</span>
      </div>
      <ContributionForm objectId={selected.id} />
    </main>
  );
}
