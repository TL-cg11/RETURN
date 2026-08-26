import Link from 'next/link';
import { CommunityHeader } from '@/components/shared/community-header';
import { ContributionForm } from '@/components/community/contribution-form';
export default function ContributePage(){return <main className="contribute-page"><CommunityHeader/><div className="object-breadcrumb"><Link href="/objects/moonbird-mask">← Moonbird Mask</Link><span>/</span><span>Add to the record</span></div><ContributionForm/></main>}
