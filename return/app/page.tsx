import { NavLink as Link } from '@/components/shared/nav-link';
import { CommunityHeader } from '@/components/shared/community-header';
import { CollectionBrowser } from '@/components/community/collection-browser';
import { collectionFor } from '@/lib/records';
import { sessionFromCookies } from '@/lib/session';

export const dynamic = 'force-dynamic';

// FR-M4 — the collection was rendered whole. Eight objects fit on one screen; a real
// collection does not, and FR-K5 lets a curator add to it. Server-rendered `?page=`
// links, matching the inbox filter and the activity log, so there is no client state.
const PER_PAGE = 6;

export default async function Home({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page } = await searchParams;
  const { museumId } = await sessionFromCookies();
  const collection = await collectionFor(museumId);
  const moonbird = collection.find((object) => object.id === 'moonbird-mask') ?? collection[0];
  if (!moonbird) return null;
  const gaps = collection.filter((object) => object.gap).length;
  const pageCount = Math.max(1, Math.ceil(collection.length / PER_PAGE));
  const current = Math.min(Math.max(1, Number(page) || 1), pageCount);

  return (
    <main>
      <CommunityHeader />

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">A living collection · Demo museum 01</p>
          <h1 id="hero-title">Every object has more than one history.</h1>
          <p className="hero-lede">Communities and curators reconstruct incomplete object histories together—while provenance, consent, and human judgment shape the public record.</p>
          <div className="hero-actions">
            <Link className="primary-action" href={`/objects/${moonbird.id}`}>Explore the Moonbird Mask <span aria-hidden="true">→</span></Link>
            <a className="text-action" href="#about">How the record changes</a>
          </div>
        </div>

        <div className="featured-object" aria-label="Featured object: Moonbird Mask">
          <div className="catalog-mark">Featured object <span>{moonbird.accession}</span></div>
          <div className="artifact-stage" role="img" aria-label="A dark ceremonial mask with a tall crescent crest and carved geometric eyes">
            <div className="mask-silhouette"><span className="mask-eye left" /><span className="mask-eye right" /><span className="mask-mouth" /></div>
          </div>
          <div className="object-caption">
            <div><p className="caption-kicker">Object 01</p><h2>{moonbird.title}</h2></div>
            <div className="record-status"><span className="status-dot" /><span>Record open<br /><strong>{moonbird.questions.length} questions</strong></span></div>
          </div>
        </div>
      </section>

      <section className="record-strip" aria-label="Collection record summary">
        <div><strong>{String(collection.length).padStart(2, '0')}</strong><span>Objects in this collection</span></div>
        <div><strong>{String(gaps).padStart(2, '0')}</strong><span>Open provenance gaps</span></div>
        <div><strong>{String(moonbird.questions.length).padStart(2, '0')}</strong><span>Open questions on the featured record</span></div>
        <p>Research is free.<br /><em>The record needs a curator.</em></p>
      </section>

      <section className="collection" id="collection" aria-labelledby="collection-title">
        <div className="section-heading">
          <div><p className="eyebrow">The collection</p><h2 id="collection-title">The collection is still being written.</h2></div>
          <p>Each record shows what is known, what is attributed, and what remains an open question.</p>
        </div>
        <CollectionBrowser collection={collection} initialPage={current} perPage={PER_PAGE} />
      </section>

      <section className="principle" id="about">
        <p className="eyebrow">The working principle</p>
        <p>Agents can reconstruct history. <em>They cannot decide whose history becomes official.</em></p>
      </section>
    </main>
  );
}
