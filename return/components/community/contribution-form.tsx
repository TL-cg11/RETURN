'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import type { CollectionObject } from '@/lib/domain/types';

const steps = ['Object', 'Evidence', 'Context', 'Consent', 'Review'];

const CONSENT_OPTIONS = [
  ['public_attributed', 'Public, with my name', 'The museum may quote and display this with attribution.'],
  ['public_anonymous', 'Public, without my name', 'The museum may quote and display it without identifying me.'],
  ['research_only', 'Research only', 'Curators may study it, but cannot quote or display it publicly.'],
  ['private', 'Private', 'Only authorised curators may view it.'],
] as const;

type PickerObject = Pick<CollectionObject, 'id' | 'title' | 'accession' | 'date' | 'status' | 'tone'>;

export function ContributionForm({ objectId, objects }: { objectId: string; objects: PickerObject[] }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const [form, setForm] = useState({
    objectId,
    kind: 'Photograph',
    title: '1959 Aru village photograph',
    description: 'The reverse of the photograph reads “Moonbird dancers, first rains, 1959.”',
    source: 'Family archive of Ena Varo',
    date: 'August 1959',
    place: 'Aru village',
    consent: 'public_attributed',
    requestedOutcome: 'Correct the public label',
  });

  const selected = objects.find((item) => item.id === form.objectId) ?? objects[0];
  if (!selected) return null;
  const field = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (step < 4) { setStep(step + 1); return; }
    if (!form.title.trim()) { setError('A contribution needs a short title.'); setStep(1); return; }

    setPending(true);
    setError('');
    const response = await fetch('/api/community/evidence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await response.json() as { id?: string; reason?: string };
    setPending(false);
    if (!response.ok || !data.id) { setError(data.reason ?? 'Could not submit this contribution.'); return; }
    router.push(`/submissions/${data.id}`);
  }

  return (
    <form className="contribution-form" onSubmit={submit}>
      <aside>
        <p className="eyebrow">Contribution</p>
        <ol>
          {steps.map((label, index) => (
            <li className={index === step ? 'active' : index < step ? 'done' : ''} key={label}>
              <span>{index < step ? '✓' : index + 1}</span>{label}
            </li>
          ))}
        </ol>
        <p className="privacy-note">Your draft stays in this browser until you submit it. You control how the museum may use your contribution.</p>
      </aside>

      <section className="form-stage">
        {step === 0 && (
          <>
            <p className="form-count">Step 1 of 5</p>
            <h1>Which object is this about?</h1>
            <div className="selected-object">
              <span className={`object-thumbnail ${selected.tone}`} aria-hidden="true"><i /></span>
              <div><small>Selected object</small><strong>{selected.title}</strong><span>{selected.accession} · {selected.status}</span></div>
              <button type="button" onClick={() => setPicking(!picking)}>{picking ? 'Close' : 'Change'}</button>
            </div>
            {picking && (
              <ul className="object-picker">
                {objects.map((item) => (
                  <li key={item.id}>
                    <button type="button" className={item.id === form.objectId ? 'selected' : ''} onClick={() => { field('objectId', item.id); setPicking(false); }}>
                      <strong>{item.title}</strong><small>{item.accession} · {item.date}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="form-help">We’ll connect your contribution to this object’s record and open questions.</p>
          </>
        )}

        {step === 1 && (
          <>
            <p className="form-count">Step 2 of 5</p>
            <h1>What are you sharing?</h1>
            <div className="choice-grid">
              {['Photograph', 'Document', 'Oral history', 'Object information'].map((kind) => (
                <button type="button" className={form.kind === kind ? 'selected' : ''} onClick={() => field('kind', kind)} key={kind}>
                  <span>{kind === 'Photograph' ? '▧' : kind === 'Document' ? '≡' : kind === 'Oral history' ? '◉' : '◇'}</span>{kind}
                </button>
              ))}
            </div>
            <label>Short title<input value={form.title} onChange={(event) => field('title', event.target.value)} required /></label>
          </>
        )}

        {step === 2 && (
          <>
            <p className="form-count">Step 3 of 5</p>
            <h1>Add the context you know.</h1>
            <label>Description<textarea rows={5} value={form.description} onChange={(event) => field('description', event.target.value)} /></label>
            <div className="field-pair">
              <label>Date<input value={form.date} onChange={(event) => field('date', event.target.value)} /></label>
              <label>Place<input value={form.place} onChange={(event) => field('place', event.target.value)} /></label>
            </div>
            <label>Where did this come from?<input value={form.source} onChange={(event) => field('source', event.target.value)} /></label>
          </>
        )}

        {step === 3 && (
          <>
            <p className="form-count">Step 4 of 5</p>
            <h1>How may the museum use it?</h1>
            <fieldset className="consent-options">
              <legend>Choose one permission</legend>
              {CONSENT_OPTIONS.map(([value, title, detail]) => (
                <label key={value}>
                  <input type="radio" name="consent" checked={form.consent === value} onChange={() => field('consent', value)} />
                  <span><strong>{title}</strong><small>{detail}</small></span>
                </label>
              ))}
            </fieldset>
          </>
        )}

        {step === 4 && (
          <>
            <p className="form-count">Step 5 of 5</p>
            <h1>Review your contribution.</h1>
            <dl className="review-list">
              <div><dt>Object</dt><dd>{selected.title}</dd></div>
              <div><dt>Evidence</dt><dd>{form.kind} · {form.title}</dd></div>
              <div><dt>Context</dt><dd>{form.date} · {form.place}<br />{form.source}</dd></div>
              <div><dt>Permission</dt><dd>{form.consent.replaceAll('_', ' ')}</dd></div>
            </dl>
            <div className="submission-notice">
              <b>What happens next</b>
              <p>Your contribution will enter the curator inbox as <strong>submitted</strong>. It can inform research, but it cannot change the official record by itself.</p>
            </div>
          </>
        )}

        {error && <p className="clarify-result" role="alert">{error}</p>}

        <div className="form-actions">
          {step > 0 && <button type="button" className="secondary-action" onClick={() => setStep(step - 1)}>Back</button>}
          <button className="primary-action" disabled={pending}>
            {step === 4 ? (pending ? 'Submitting…' : 'Submit contribution') : 'Continue'} <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>
    </form>
  );
}
