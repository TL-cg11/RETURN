import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSubmission } from '@/db/queries';
import { EvidenceDeskActions } from '@/components/curator/evidence-desk-actions';
import { evidenceFor, objectRecord } from '@/lib/records';
import { relativeTime, sessionFromCookies } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { museumId } = await sessionFromCookies();
  const submission = await getSubmission(museumId, id);
  if (!submission) notFound();

  const record = objectRecord(submission.object_id);
  const verified = evidenceFor(submission.object_id).filter((item) => item.authority === 'verified');
  const counterpart = verified[0];
  const restricted = submission.consent === 'research_only' || submission.consent === 'private';

  return (
    <main className="case-page">
      <div className="case-top">
        <div>
          <div className="case-breadcrumb"><Link href="/curator/submissions">Submissions</Link><span>/</span><span>{submission.id}</span></div>
          <p className="console-eyebrow">Evidence desk · Review case</p>
          <h1>{record?.title ?? submission.object_id}</h1>
          <p>{record?.gap
            ? `Can this contribution narrow the ${record.gap} gap in the official record?`
            : 'Does this contribution change how the official record should describe the object?'}</p>
        </div>
        <div className="case-meta">
          <span>Case status</span>
          <strong>{submission.status}</strong>
          <small>Opened {relativeTime(submission.created_at)} · {submission.kind}</small>
        </div>
      </div>

      <div className="case-workspace">
        <section className="comparison">
          <header>
            <div><p className="console-eyebrow">Source comparison</p><h2>{counterpart ? 'Two records, one unresolved period.' : 'One submitted source, no verified counterpart.'}</h2></div>
            <span className="comparison-count">{counterpart ? 2 : 1} {counterpart ? 'sources' : 'source'}</span>
          </header>

          <div className="evidence-bridge">
            <article className="evidence-card community">
              <div className="evidence-preview photo"><span>{submission.kind}</span><i /></div>
              <div className="evidence-card-head"><span className="submitted-badge">Submitted</span><small>{submission.id}</small></div>
              <h3>{submission.title}</h3>
              <dl>
                <div><dt>Source</dt><dd>{submission.source || 'Not stated'}</dd></div>
                <div><dt>Requested</dt><dd>{submission.requested_outcome}</dd></div>
                <div><dt>Consent</dt><dd>{submission.consent.replaceAll('_', ' ')}</dd></div>
                <div><dt>Received</dt><dd>{relativeTime(submission.created_at)}</dd></div>
              </dl>
              {submission.description && <blockquote>{submission.description}<cite>As submitted</cite></blockquote>}
              {restricted && <p className="image-disclaimer">Internal review only — this material may not be quoted in public output.</p>}
            </article>

            {counterpart ? (
              <>
                <div className="bridge-gap"><span>{record?.gap ?? 'Unresolved'}</span><i /><p>Movement<br />not documented</p></div>
                <article className="evidence-card official">
                  <div className="evidence-preview invoice"><b>LORNE<br />GALLERY</b><span>INVOICE 068/42</span><i /><i /><i /></div>
                  <div className="evidence-card-head"><span className="verified-badge">Verified</span><small>{counterpart.id}</small></div>
                  <h3>{counterpart.title}</h3>
                  <dl>
                    <div><dt>Date</dt><dd>{counterpart.date}</dd></div>
                    <div><dt>Place</dt><dd>{counterpart.place}</dd></div>
                    <div><dt>Detail</dt><dd>{counterpart.detail}</dd></div>
                    <div><dt>Authority</dt><dd>Source &amp; record verified</dd></div>
                  </dl>
                </article>
              </>
            ) : (
              <div className="bridge-gap"><span>No counterpart</span><i /><p>No verified source<br />is on file yet</p></div>
            )}
          </div>
        </section>

        <aside className="analysis-panel">
          <header><span>Curator Agent</span><i>Analysis complete</i></header>
          <section>
            <p className="analysis-label confirmed">Confirmed facts · {counterpart ? 1 : 0}</p>
            <ul>{counterpart ? <li>{counterpart.detail}</li> : <li>No verified source has been attached to this record.</li>}</ul>
          </section>
          <section>
            <p className="analysis-label claim">Attributed claims · 1</p>
            <ul><li>{submission.description || submission.title}</li></ul>
          </section>
          <section>
            <p className="analysis-label conflict">Record conflicts · {counterpart ? 1 : 0}</p>
            <ul>{counterpart
              ? <li>The current label implies clear prior custody, but the invoice names no prior owner.</li>
              : <li>No conflict can be assessed without a verified counterpart.</li>}</ul>
          </section>
          <section>
            <p className="analysis-label question">Open questions · {record?.questions.length ?? 0}</p>
            <ul>{record?.questions.map((question) => <li key={question}>{question}</li>)}</ul>
          </section>
          {restricted && (
            <section>
              <p className="analysis-label conflict">Access restriction</p>
              <ul><li>Consent is {submission.consent.replaceAll('_', ' ')}. This material may inform review but cannot be quoted publicly.</li></ul>
            </section>
          )}
          <section className="agent-recommendation">
            <p className="console-eyebrow">Recommendation</p>
            <p>{record?.gap
              ? 'Replace the definitive acquisition phrase. Attribute the submitted account and mark movement as an open question.'
              : 'Record the submitted context as an attributed claim without changing the documented chain of custody.'}</p>
          </section>
          <EvidenceDeskActions submissionId={submission.id} status={submission.status} />
        </aside>
      </div>

      <section className="draft-editor">
        <header>
          <div><p className="console-eyebrow">Working label · Not public</p><h2>Agent draft with evidence references</h2></div>
          <span>2 assertions · {counterpart ? 2 : 1} {counterpart ? 'sources' : 'source'}</span>
        </header>
        <div className="draft-columns">
          <article><small>Current public label</small><p>{record?.label}</p></article>
          <article>
            <small>Proposed revision</small>
            <p><span className="inline-mode claim">Attributed claim</span> {submission.description || submission.title} <sup>{submission.id}</sup></p>
            {record?.gap && <p><span className="inline-mode question">Open question</span> Movement and acquisition circumstances between {record.gap} remain under joint research. <sup>{[submission.id, counterpart?.id].filter(Boolean).join(' · ')}</sup></p>}
          </article>
        </div>
      </section>
    </main>
  );
}
