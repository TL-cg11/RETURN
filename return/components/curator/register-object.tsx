'use client';

import { useState } from 'react';
import { OBJECT_TONES, RECORD_STATUSES, missingObjectFields, slugFor, type ObjectDraft } from '@/lib/community/object-input';

const FIELDS: { key: keyof ObjectDraft; label: string; placeholder?: string; required?: boolean }[] = [
  { key: 'title', label: 'Title', placeholder: 'Harbour Signal Lamp', required: true },
  { key: 'accession', label: 'Accession number', placeholder: 'RT.1972.031', required: true },
  { key: 'period', label: 'Date or period', placeholder: 'c. 1910', required: true },
  { key: 'objectType', label: 'Object type', placeholder: 'Lamp' },
  { key: 'material', label: 'Material', placeholder: 'Brass, glass', required: true },
  { key: 'origin', label: 'Place of origin', placeholder: 'North Channel · attribution under review', required: true },
  { key: 'acquisitionDate', label: 'Acquisition date', placeholder: '1972' },
];

/**
 * FR-K5 / FR-X3 — registering a record is curator work, and the community surface
 * never sees it.
 *
 * The gateway grades registration HIGH, so the form does not submit straight into the
 * collection: it shows the record back and asks for an explicit decision, which is
 * what a HIGH verdict means for a human actor. The server refuses an unconfirmed
 * request regardless of what this component does.
 */
export function RegisterObject() {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<ObjectDraft>({ recordStatus: 'Record open', tone: 'linen' });

  const set = (key: keyof ObjectDraft, value: string) => setDraft((now) => ({ ...now, [key]: value }));
  const missing = missingObjectFields(draft);
  const slug = slugFor(String(draft.title ?? ''));

  async function submit(confirmed: boolean) {
    setError('');
    if (missing.length > 0) { setError(`${missing[0]} is required.`); return; }
    if (!confirmed) { setConfirming(true); return; }
    setPending(true);
    const response = await fetch('/api/curator/objects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...draft, confirmed: true }),
    });
    const data = await response.json() as { object_id?: string; reason?: string; recovery?: string };
    setPending(false);
    if (!response.ok || !data.object_id) {
      setError([data.reason, data.recovery].filter(Boolean).join(' ') || 'The record could not be registered.');
      setConfirming(false);
      return;
    }
    window.location.assign(`/objects/${data.object_id}`);
  }

  if (!open) {
    return (
      <button type="button" className="register-open" onClick={() => setOpen(true)}>
        Register a new record <span aria-hidden="true">+</span>
      </button>
    );
  }

  return (
    <section className="register-object" aria-labelledby="register-title">
      <header>
        <div>
          <p className="console-eyebrow">New collection record</p>
          <h2 id="register-title">Register an object</h2>
        </div>
        <button type="button" onClick={() => { setOpen(false); setConfirming(false); setError(''); }} aria-label="Close">×</button>
      </header>

      {confirming ? (
        <>
          <p className="register-warning">
            This creates official museum material. It will appear in the public collection immediately,
            at revision 1, under the label below.
          </p>
          <dl className="review-list">
            <div><dt>Title</dt><dd className="prose">{draft.title}</dd></div>
            <div><dt>Record id</dt><dd className="prose">{slug}</dd></div>
            <div><dt>Accession</dt><dd className="prose">{draft.accession}</dd></div>
            <div><dt>Date</dt><dd className="prose">{draft.period}</dd></div>
            <div><dt>Material</dt><dd className="prose">{draft.material}</dd></div>
            <div><dt>Origin</dt><dd className="prose">{draft.origin}</dd></div>
            <div><dt>Public label</dt><dd className="prose">{draft.label}</dd></div>
          </dl>
          {error && <p className="clarify-result" role="alert">{error}</p>}
          <div className="register-actions">
            <button type="button" onClick={() => setConfirming(false)}>Back to the form</button>
            <button type="button" className="primary" disabled={pending} onClick={() => submit(true)}>
              {pending ? 'Registering…' : 'Confirm registration'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="register-grid">
            {FIELDS.map((field) => (
              <label key={field.key}>
                <span className="field-name">{field.label}{field.required && <b aria-hidden="true"> *</b>}</span>
                <input value={String(draft[field.key] ?? '')} placeholder={field.placeholder} onChange={(event) => set(field.key, event.target.value)} />
              </label>
            ))}
            <label>
              Record state
              <select value={draft.recordStatus} onChange={(event) => set('recordStatus', event.target.value)}>
                {RECORD_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </label>
            <label>
              Display tone
              <select value={draft.tone} onChange={(event) => set('tone', event.target.value)}>
                {OBJECT_TONES.map((tone) => <option key={tone} value={tone}>{tone}</option>)}
              </select>
            </label>
          </div>
          <label className="register-wide">
            Description
            <textarea rows={2} value={String(draft.description ?? '')} placeholder="What the record holds, and what is not yet known about it." onChange={(event) => set('description', event.target.value)} />
          </label>
          <label className="register-wide">
            <span className="field-name">Public label<b aria-hidden="true"> *</b></span>
            <textarea rows={3} value={String(draft.label ?? '')} placeholder="The sentence the public will read first. It can be revised afterwards." onChange={(event) => set('label', event.target.value)} />
          </label>
          {slug && <p className="form-help">Public address · /objects/{slug}</p>}
          {error && <p className="clarify-result" role="alert">{error}</p>}
          <div className="register-actions">
            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="primary" onClick={() => submit(false)}>Review the record →</button>
          </div>
        </>
      )}
    </section>
  );
}
