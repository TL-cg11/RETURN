import { NavLink as Link } from '@/components/shared/nav-link';
import { notFound } from 'next/navigation';
import { getSubmission, getSubmissionPublicationOutcome, listSubmissionAssets, parseClarifications } from '@/db/queries';
import { CommunityHeader } from '@/components/shared/community-header';
import { LabelRevisionDiff } from '@/components/community/label-revision-diff';
import { CONTRIBUTION_KINDS, fieldsFor, summariseDetail, type ContributionKind, type KindDetail } from '@/lib/community/contribution';
import { findObject } from '@/lib/records';
import { relativeTime, sessionFromCookies } from '@/lib/session';

export const dynamic = 'force-dynamic';

const STAGES = ['Received by museum', 'Source and consent review', 'Compared with official record', 'Outcome shared with you'] as const;

const MODE_LABEL = {
  verified_fact: 'Verified fact',
  attributed_claim: 'Attributed claim',
  open_question: 'Open question',
} as const;

/** How far a submission has moved through review. */
function stageIndex(status: string) {
  if (status === 'closed' || status === 'reflected in label') return 3;
  if (status === 'under review') return 2;
  if (status === 'needs information') return 1;
  return 0;
}

/** Reads back what the contributor filled in, keeping only declared kinds and fields. */
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

export default async function SubmissionStatus({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { museumId } = await sessionFromCookies();
  const submission = await getSubmission(museumId, id);
  if (!submission) notFound();

  const [object, assets, publicationOutcome] = await Promise.all([
    findObject(museumId, submission.object_id),
    listSubmissionAssets(museumId, submission.id),
    getSubmissionPublicationOutcome(museumId, submission.id),
  ]);
  const current = stageIndex(submission.status);
  const details = parseDetails(submission.details);
  const clarifications = parseClarifications(submission.clarifications);

  // FR-C6 — what the contributor can honestly be told about their effect on the
  // record. The label carries a publication timestamp and a revision number, so
  // "was the public record revised after you contributed" is a fact, not a guess.
  // The link from one contribution to one sentence is not modelled, so this shows
  // the current sentences and their standing rather than claiming authorship.
  const revisedSince = !!object?.labelPublishedAt && object.labelPublishedAt > submission.created_at;
  const reflected = submission.status === 'reflected in label';
  const closed = submission.status === 'closed';
  const reflectedPublication = reflected ? publicationOutcome?.publication : null;

  return (
    <main>
      <CommunityHeader />
      <section className="status-page">
        <p className="eyebrow">{reflected || closed ? 'Review outcome' : 'Contribution received'}</p>
        <div className="status-check">✓</div>
        <h1>{reflected ? 'Your contribution informed the public record.' : closed ? 'The review is closed.' : 'Thank you for adding to the record.'}</h1>
        <p>{reflected
          ? `A curator linked this contribution to official label revision ${reflectedPublication?.revision_number ?? object?.labelRevision ?? '—'}.`
          : closed
            ? 'This review ended without a published label revision linked to this contribution.'
            : `Your ${submission.kind.toLowerCase()} ${details.length > 1 ? 'are' : 'is'} now visible to the curatorial team. The public label has not changed by itself.`}</p>

        <div className="tracking-card">
          <div><small>Submission</small><strong>{submission.id}</strong></div>
          <span className="submitted-badge">Submitted</span>
          <ol>
            {STAGES.map((label, index) => (
              <li className={index === current ? 'current' : index < current ? 'done' : ''} key={label}>
                <span />{label}
                {index === current && <time>{relativeTime(submission.created_at)}</time>}
              </li>
            ))}
          </ol>
          {submission.status === 'needs information' && clarifications.length === 0 && (
            <p className="form-help">A curator needs more information before review can continue. No outcome has been recorded yet.</p>
          )}
          {/* FR2-K1 — the question itself, not the fact that one exists. */}
          {clarifications.length > 0 && (
            <div className="clarification-thread">
              <p className="eyebrow">{clarifications.length === 1 ? 'A curator asked' : `A curator asked ${clarifications.length} questions`}</p>
              <ol>
                {clarifications.map((item) => (
                  <li key={`${item.askedAt}-${item.question}`}>
                    <blockquote>{item.question}</blockquote>
                    <small>{item.askedBy} · {relativeTime(item.askedAt)}</small>
                  </li>
                ))}
              </ol>
              <p className="form-help">Reply by submitting the missing detail as a new contribution to the same record.</p>
            </div>
          )}
          {closed && (
            <p className="form-help">The recorded status is closed. It does not claim that the submitted account was verified, and no label change is attributed to it.</p>
          )}
        </div>

        <dl className="review-list">
          <div><dt>Object</dt><dd>{object?.title ?? submission.object_id}</dd></div>
          <div><dt>Material</dt><dd className="prose">{submission.kind}</dd></div>
          {details.map((detail) => (
            <div key={detail.kind}>
              <dt>{detail.kind}</dt>
              <dd>{summariseDetail(detail).map((line) => <small key={line}>{line}</small>)}</dd>
            </div>
          ))}
          {assets.length > 0 && (
            <div>
              <dt>Files</dt>
              <dd>
                <strong>{assets.length} attached</strong>
                {assets.map((asset) => <small key={asset.id}>{asset.file_name}</small>)}
                <small>Held privately for curatorial review. They become publicly visible only if a curator publishes them.</small>
              </dd>
            </div>
          )}
          <div><dt>Permission</dt><dd>{submission.consent.replaceAll('_', ' ')}</dd></div>
          <div><dt>Requested</dt><dd>{submission.requested_outcome}</dd></div>
        </dl>

        {/* FR-C6 — the record as it stands now, next to the contribution. */}
        <section className="record-effect">
          <p className="eyebrow">The record as it stands</p>
          <h2>{object?.title ?? submission.object_id}</h2>
          {object && (
            <>
              <p className="effect-state">
                {reflected
                  ? reflectedPublication
                    ? `A curator reflected this contribution in revision ${reflectedPublication.revision_number} of ${object.title}.`
                    : 'A curator has marked your contribution as reflected in the public label. The legacy record does not identify a specific publication.'
                  : revisedSince
                    ? `The public label was revised to revision ${object.labelRevision} after your contribution arrived. A revision is published by a curator, and may draw on several sources.`
                    : `The public label is still at revision ${object.labelRevision}, unchanged since your contribution arrived.`}
              </p>
              <blockquote className="current-label">{reflectedPublication?.body ?? object.label}</blockquote>
              {reflectedPublication && publicationOutcome?.previous && (
                <LabelRevisionDiff before={publicationOutcome.previous.body} after={reflectedPublication.body}
                  revision={reflectedPublication.revision_number} compact />
              )}
              {object.labelAssertions.length > 0 && (
                <ul className="assertion-standing">
                  {object.labelAssertions.map((assertion) => (
                    <li key={assertion.text}>
                      <span className={`inline-mode ${assertion.mode === 'verified_fact' ? 'fact' : assertion.mode === 'attributed_claim' ? 'claim' : 'question'}`}>
                        {MODE_LABEL[assertion.mode]}
                      </span>
                      {assertion.text}
                    </li>
                  ))}
                </ul>
              )}
              {object.gap && <p className="form-help">Custody between {object.gap} is still an open question on this record.</p>}
              <p className="form-help">Nothing enters the official record without a curator approving it. Your material can inform that decision; it cannot make it.</p>
            </>
          )}
        </section>

        <div className="status-actions">
          <Link className="primary-action" href={`/objects/${submission.object_id}`}>Return to object <span aria-hidden="true">→</span></Link>
          <Link className="text-action" href="/">Browse the collection</Link>
        </div>
      </section>
    </main>
  );
}
