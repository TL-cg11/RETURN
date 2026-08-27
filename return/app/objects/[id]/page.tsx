import { NavLink as Link } from '@/components/shared/nav-link';
import { notFound } from 'next/navigation';
import { LabelFlip } from '@/components/community/label-flip';
import { CommunityHeader } from '@/components/shared/community-header';
import { collection, moonbird } from '@/lib/demo-data';
import { objectRecord } from '@/lib/records';

export function generateStaticParams() { return collection.map((item) => ({ id: item.id })); }

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = collection.find((entry) => entry.id === id);
  if (!item) return {};
  const description = `Provenance, questions and community context for ${item.title}.`;
  return {
    title: `${item.title} — RE:TURN`,
    description: `The living museum record for ${item.title}.`,
    openGraph: { title: `${item.title} — RE:TURN`, description, images: [] },
    twitter: { card: 'summary' as const, title: `${item.title} — RE:TURN`, description, images: [] },
  };
}

export default async function ObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = objectRecord(id);
  if (!record) notFound();
  const featured = record.id === moonbird.id;

  return (
    <main>
      <CommunityHeader />
      <div className="object-breadcrumb"><Link href="/">Collection</Link><span>/</span><span>{record.accession}</span></div>

      <section className="object-hero">
        <div className="object-art-panel">
          <div className="object-art-meta"><span>{record.accession}</span><span>Fictional record</span></div>
          <div className="artifact-stage detail">
            {featured
              ? <div className="mask-silhouette"><span className="mask-eye left" /><span className="mask-eye right" /><span className="mask-mouth" /></div>
              : <span className={`object-thumbnail ${record.tone}`} aria-hidden="true"><i /></span>}
          </div>
          <p className="image-disclaimer">Fictional collection image · created for this demonstration</p>
        </div>

        <div className="object-intro">
          <p className="eyebrow">{record.status} · {record.date}</p>
          <h1>{record.title}</h1>
          <dl>
            <div><dt>Material</dt><dd>{record.material}</dd></div>
            <div><dt>Place</dt><dd>{record.region}</dd></div>
            <div><dt>Accession</dt><dd>{record.accession}</dd></div>
          </dl>
          {record.gap
            ? <div className="gap-callout"><span>Open provenance gap</span><strong>{record.gap}</strong><p>Movement and custody are not documented in the current official record.</p></div>
            : <div className="gap-callout"><span>Record state</span><strong>No open gap</strong><p>The documented chain of custody is complete. Context and naming may still be revised.</p></div>}
          <Link className="primary-action" href={`/contribute?object=${record.id}`}>Contribute to this record <span aria-hidden="true">→</span></Link>
        </div>
      </section>

      <LabelFlip label={record.label} questions={record.questions} />

      <section className="timeline-section">
        <div className="section-heading compact">
          <div><p className="eyebrow">Provenance timeline</p><h2>{record.gap ? 'A record with a visible gap.' : 'A record with a documented chain.'}</h2></div>
          <div className="legend">
            <span><i className="dot verified" />Verified source</span>
            <span><i className="dot submitted" />Submitted source</span>
            <span><i className="gap-symbol" />Open gap</span>
          </div>
        </div>
        <div className="timeline">
          {record.timeline.map((event) => (
            <article className={event.gap ? 'timeline-event gap' : 'timeline-event'} key={`${event.year}-${event.title}`}>
              <time>{event.year}</time>
              <span className={`timeline-node ${event.authority}`} />
              <div><p className="authority-tag">{event.authority}</p><h3>{event.title}</h3><p>{event.detail}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section className="contribution-cta">
        <div><p className="eyebrow">Recognise this object?</p><h2>Your knowledge can change what the record asks next.</h2></div>
        <div>
          <p>Share a photograph, document, or memory. You choose how it can be used and whether your name appears.</p>
          <Link className="primary-action light" href={`/contribute?object=${record.id}`}>Add to the record <span aria-hidden="true">→</span></Link>
        </div>
      </section>
    </main>
  );
}
