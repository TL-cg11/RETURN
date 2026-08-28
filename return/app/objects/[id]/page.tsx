import { NavLink as Link } from '@/components/shared/nav-link';
import { notFound } from 'next/navigation';
import { LabelFlip } from '@/components/community/label-flip';
import { LabelRevisionDiff } from '@/components/community/label-revision-diff';
import { ObjectGallery, type GalleryImage } from '@/components/community/object-gallery';
import { CommunityHeader } from '@/components/shared/community-header';
import { listLabelPublications, listObjectAssets, listPublicContributions } from '@/db/queries';
import { assetAccess } from '@/lib/assets/access';
import { CONTRIBUTION_KINDS, fieldsFor, summariseDetail, type ContributionKind, type KindDetail } from '@/lib/community/contribution';
import type { Consent, Visibility } from '@/lib/domain/types';
import { objectRecord } from '@/lib/records';
import { sessionFromCookies } from '@/lib/session';

/** Reads stored contribution detail, keeping only declared kinds and fields. */
function parseDetails(raw: string): KindDetail[] {
  try {
    const parsed: unknown = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const item = entry as { kind?: string; values?: Record<string, string> };
      const kind = CONTRIBUTION_KINDS.find((name) => name === item.kind);
      if (!kind) return [];
      const values: Record<string, string> = {};
      for (const field of fieldsFor(kind)) {
        const value = item.values?.[field.name];
        if (typeof value === 'string' && value.trim()) values[field.name] = value;
      }
      return [{ kind: kind as ContributionKind, values }];
    });
  } catch {
    return [];
  }
}

const MAX_SHOWN_CONTRIBUTIONS = 8;

export const dynamic = 'force-dynamic';

/** Fixed locale and zone so the server and the client render the same string. */
const reviewDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
function formatReviewDate(publishedAt: number | null) {
  return publishedAt ? reviewDate.format(new Date(publishedAt)) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { museumId } = await sessionFromCookies();
  const item = await objectRecord(museumId, id);
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
  const { museumId } = await sessionFromCookies();
  const record = await objectRecord(museumId, id);
  if (!record) notFound();
  const featured = record.id === 'moonbird-mask';

  const [assetRows, allContributions, publications] = await Promise.all([
    listObjectAssets(museumId, record.id),
    listPublicContributions(museumId, record.id),
    listLabelPublications(museumId, record.id),
  ]);
  // Bounded like every other list on the site. A public record page that grows without
  // limit as contributions arrive is the same defect FR-B2 and FR-M4 fixed elsewhere.
  const contributions = allContributions.slice(0, MAX_SHOWN_CONTRIBUTIONS);
  // This page is public, so it is judged as a community session regardless of who is
  // looking. A curator viewing the public record must see the public record.
  const publicImageRows = assetRows
    .filter((row) => row.kind === 'image')
    .filter((row) => assetAccess({ museumId: row.museum_id, visibility: row.visibility as Visibility, consent: row.consent as Consent }, { role: 'community', museumId }) === 'serve');
  const images: GalleryImage[] = publicImageRows
    // A filename is not a description, and an uploaded one can carry a person's name.
    .map((row, index) => ({
      id: row.id,
      alt: row.alt_text || `${record.title}, contributed photograph ${index + 1}`,
      caption: row.caption, url: `/api/assets/${row.id}`,
      sourceLabel: row.submission_id ? 'Community contribution' : 'Museum collection image',
      addedLabel: formatReviewDate(row.created_at) ?? 'Date not recorded',
      width: row.width,
      height: row.height,
    }));
  // FR2-D1 — documents and recordings were filtered out one line above and never
  // reached the public record at all, however far a curator had published them.
  const publicFileRows = assetRows
    .filter((row) => row.kind !== 'image')
    .filter((row) => assetAccess({ museumId: row.museum_id, visibility: row.visibility as Visibility, consent: row.consent as Consent }, { role: 'community', museumId }) === 'serve');
  const currentPublication = publications[0];
  const previousPublication = publications[1];

  return (
    <main>
      <CommunityHeader />
      <div className="object-breadcrumb"><Link href="/">Collection</Link><span>/</span><span>{record.accession}</span></div>

      <section className="object-hero">
        <div className="object-art-panel">
          <div className="object-art-meta"><span>{record.accession}</span><span>Fictional record</span></div>
          {/* Photographs when the record has any, and the drawn stand-in when it does not. */}
          <ObjectGallery images={images}>
            <div className="artifact-stage detail">
              {featured
                ? <div className="mask-silhouette"><span className="mask-eye left" /><span className="mask-eye right" /><span className="mask-mouth" /></div>
                : <span className={`object-thumbnail ${record.tone}`} aria-hidden="true"><i /></span>}
            </div>
          </ObjectGallery>
          <p className="image-disclaimer">{images.length > 0
            ? `${images.length} public image${images.length === 1 ? '' : 's'} on this record · source and date shown with each image`
            : 'Fictional collection image · created for this demonstration'}</p>
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

      <LabelFlip label={record.label} questions={record.questions} revision={record.labelRevision}
        assertions={record.labelAssertions} lastReviewed={formatReviewDate(record.labelPublishedAt)} />

      {currentPublication && previousPublication && (
        <LabelRevisionDiff before={previousPublication.body} after={currentPublication.body} revision={currentPublication.revision_number} />
      )}

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

      {/* FR2-D1 — files that are not photographs. They are published material like any
          other, so they belong on the record rather than only in the curator's case. */}
      {publicFileRows.length > 0 && (
        <section className="record-files">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Documents and recordings</p>
              <h2>{publicFileRows.length} file{publicFileRows.length === 1 ? '' : 's'} on this record.</h2>
            </div>
            <p className="context-note">Files a curator has published. Material still under review is not listed here.</p>
          </div>
          <ul className="file-list">
            {publicFileRows.map((row) => (
              <li key={row.id}>
                <span className="file-mark" aria-hidden="true">{row.kind === 'audio' ? '◉' : '≡'}</span>
                <div>
                  <a href={`/api/assets/${row.id}?download=1`} download>{row.caption || row.file_name}</a>
                  <small>{row.kind} · {Math.max(1, Math.round(row.byte_size / 1024))} KB · {row.submission_id ? 'Community contribution' : 'Museum collection file'}</small>
                </div>
                <span className="file-get" aria-hidden="true">↓</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* FR-O2 — what the community added, marked as such and never merged into the
          institutional record above. Only consent-permitting material reaches this list,
          and only `public_attributed` carries a name. */}
      <section className="contributed-context">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Community contributions</p>
            <h2>{contributions.length > 0
              ? 'What people have added to this record.'
              : 'No community material is on this record yet.'}</h2>
          </div>
          <p className="context-note">These accounts are <strong>submitted</strong>, not verified. The museum has received them; it has not judged them true or false. They sit beside the official record above, never inside it.</p>
        </div>
        {allContributions.length > contributions.length && (
          <p className="context-note bounded">Showing the {contributions.length} most recent of {allContributions.length} contributions on this record.</p>
        )}
        {contributions.length > 0 && (
          <ul className="contributed-list">
            {contributions.map((row) => {
              const details = parseDetails(row.details);
              const attachedImages = publicImageRows.filter((image) => image.submission_id === row.id);
              return (
                <li key={row.id}>
                  <div className="contributed-head">
                    <span className="submitted-badge">Submitted content</span>
                    <strong>{row.title}</strong>
                    <small>{row.kind} · {row.consent === 'public_attributed' && row.source ? row.source : 'Contributor chose not to be named'}</small>
                  </div>
                  {attachedImages.length > 0 && (
                    <div className="contributed-media">
                      {attachedImages.map((image, index) => (
                        <figure key={image.id}>
                          <div className="contributed-image-frame">
                            {/* eslint-disable-next-line @next/next/no-img-element -- protected asset route, not a static import */}
                            <img src={`/api/assets/${image.id}`} alt={image.alt_text || `${row.title}, photograph ${index + 1}`}
                              width={image.width ?? undefined} height={image.height ?? undefined}
                              className={image.width && image.height ? 'natural-size' : undefined} />
                          </div>
                          <figcaption>
                            <span>Community contribution · {formatReviewDate(image.created_at) ?? 'Date not recorded'}</span>
                            {image.caption || image.alt_text || 'Contributed photograph'}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
                  {details.length > 0 ? (
                    <div className="contributed-detail">
                      {details.map((detail) => (
                        <section key={detail.kind}>
                          <h4>{detail.kind}</h4>
                          <ul>{summariseDetail(detail).map((line) => <li key={line}>{line}</li>)}</ul>
                        </section>
                      ))}
                    </div>
                  ) : row.description && <p className="contributed-body">{row.description}</p>}
                  <p className="contributed-status">Status · {row.status}</p>
                </li>
              );
            })}
          </ul>
        )}
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
