'use client';

import { FormEvent, useMemo, useState } from 'react';
import type { CollectionObject } from '@/lib/domain/types';
import {
  CONTRIBUTION_KINDS, buildSteps, describeKinds, fieldsFor, missingFields, summariseDetail,
  type ContributionKind, type KindDetail,
} from '@/lib/community/contribution';
import { MAX_ASSETS_PER_CONTRIBUTION } from '@/lib/assets/access';

const CONSENT_OPTIONS = [
  ['public_attributed', 'Public, with my name', 'The museum may quote and display this with attribution.'],
  ['public_anonymous', 'Public, without my name', 'The museum may quote and display it without identifying me.'],
  ['private', 'Private', 'Authorised curators may study it, but it cannot be quoted or displayed publicly.'],
] as const;

const KIND_MARK: Record<ContributionKind, string> = {
  Photograph: '▧', Document: '≡', 'Oral history': '◉', 'Object information': '◇',
};

type PickerObject = Pick<CollectionObject, 'id' | 'title' | 'accession' | 'date' | 'status' | 'tone'>;
type Attachment = { id: string; fileName: string; kind: string; forKind: ContributionKind; alt: string };

export function ContributionForm({ objectId, objects, fromObject }: { objectId: string; objects: PickerObject[]; fromObject: boolean }) {
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState('');
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState(objectId);
  const [kinds, setKinds] = useState<ContributionKind[]>(['Photograph']);
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [consent, setConsent] = useState('public_attributed');
  const [requestedOutcome, setRequestedOutcome] = useState('Add context to this record');

  // FR-C2: the object step exists only when the contributor did not arrive from a record.
  const steps = useMemo(() => buildSteps(kinds, { needsObjectStep: !fromObject }), [kinds, fromObject]);
  const current = steps[Math.min(step, steps.length - 1)];
  const selected = objects.find((item) => item.id === selectedId) ?? objects[0];
  const details: KindDetail[] = kinds.map((kind) => ({ kind, values: values[kind] ?? {} }));

  if (!selected) return null;

  const setValue = (kind: ContributionKind, name: string, value: string) =>
    setValues((now) => ({ ...now, [kind]: { ...(now[kind] ?? {}), [name]: value } }));

  const toggleKind = (kind: ContributionKind) => {
    setError('');
    setKinds((now) => (now.includes(kind) ? now.filter((item) => item !== kind) : [...now, kind]));
  };

  async function upload(kind: ContributionKind, files: FileList | null) {
    if (!files?.length) return;
    if (attachments.length + files.length > MAX_ASSETS_PER_CONTRIBUTION) {
      setError(`A contribution may carry at most ${MAX_ASSETS_PER_CONTRIBUTION} files.`);
      return;
    }
    setError('');
    setUploading(kind);
    for (const file of Array.from(files)) {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/assets', { method: 'POST', body });
      const data = await response.json() as { id?: string; kind?: string; reason?: string };
      if (!response.ok || !data.id) { setError(data.reason ?? 'That file could not be uploaded.'); break; }
      setAttachments((now) => [...now, { id: data.id!, fileName: file.name, kind: data.kind ?? 'file', forKind: kind, alt: '' }]);
    }
    setUploading('');
  }

  function advance() {
    if (current.id === 'kinds') {
      if (kinds.length === 0) { setError('Choose at least one kind of material.'); return false; }
      if (!title.trim()) { setError('A contribution needs a short title.'); return false; }
    }
    if (current.id.startsWith('detail:')) {
      const kind = (current as { kind: ContributionKind }).kind;
      const missing = missingFields([{ kind, values: values[kind] ?? {} }]);
      if (missing.length > 0) { setError(`${missing[0].label} is required.`); return false; }
    }
    setError('');
    return true;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (current.id !== 'review') { if (advance()) setStep(step + 1); return; }

    setPending(true);
    setError('');
    const response = await fetch('/api/community/evidence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        objectId: selected.id, kinds, details, title, source, consent, requestedOutcome,
        assetIds: attachments.map((item) => item.id),
        // Alt text is collected here rather than on the upload route, because the
        // contributor writes it after seeing what uploaded (RETURN_PLAN §20.4).
        assetAlts: Object.fromEntries(attachments.filter((item) => item.alt.trim()).map((item) => [item.id, item.alt.trim()])),
      }),
    });
    const data = await response.json() as { id?: string; reason?: string };
    if (!response.ok || !data.id) {
      setPending(false);
      setError(data.reason ?? 'Could not submit this contribution.');
      return;
    }
    // Stay disabled through the navigation. Re-enabling here let a second click
    // file the same contribution twice while the browser was still moving.
    //
    // A full page load rather than router.push, for the reason recorded in
    // components/shared/nav-link.tsx: vinext's client navigation does not run in
    // the production build, so router.push left the contributor on the form with
    // no sign anything had happened. `assign` rather than setting `href` because
    // the compiler's immutability rule reads the assignment as mutating an outer
    // binding; the two are equivalent navigations.
    window.location.assign(`/submissions/${data.id}`);
  }

  const visible = objects.filter((item) =>
    !filter.trim() || `${item.title} ${item.accession}`.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <form className="contribution-form" onSubmit={submit}>
      <aside>
        <p className="eyebrow">Contribution</p>
        <ol>
          {steps.map((entry, index) => (
            <li className={index === step ? 'active' : index < step ? 'done' : ''} key={entry.id}>
              <span>{index < step ? '✓' : index + 1}</span>{entry.label}
            </li>
          ))}
        </ol>
        <p className="privacy-note">Your draft stays in this browser until you submit it. You control how the museum may use your contribution.</p>
      </aside>

      <section className="form-stage">
        <p className="form-count">Step {step + 1} of {steps.length}</p>

        {current.id === 'object' && (
          <>
            <h1>Which object is this about?</h1>
            <div className="selected-object">
              <span className={`object-thumbnail ${selected.tone}`} aria-hidden="true"><i /></span>
              <div><small>Selected object</small><strong>{selected.title}</strong><span>{selected.accession} · {selected.status}</span></div>
              <button type="button" onClick={() => setPicking(!picking)}>{picking ? 'Close' : 'Change'}</button>
            </div>
            {picking && (
              <>
                <label className="picker-filter">Find an object
                  <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Title or accession number" />
                </label>
                <ul className="object-picker">
                  {visible.map((item) => (
                    <li key={item.id}>
                      <button type="button" className={item.id === selectedId ? 'selected' : ''} onClick={() => { setSelectedId(item.id); setPicking(false); }}>
                        <strong>{item.title}</strong><small>{item.accession} · {item.date}</small>
                      </button>
                    </li>
                  ))}
                  {visible.length === 0 && <li><p className="form-help">No object matches that.</p></li>}
                </ul>
              </>
            )}
            <p className="form-help">We’ll connect your contribution to this object’s record and open questions.</p>
          </>
        )}

        {current.id === 'kinds' && (
          <>
            <h1>What are you sharing?</h1>
            <p className="form-help">Choose everything that applies. We’ll ask about each one in turn.</p>
            <div className="choice-grid">
              {CONTRIBUTION_KINDS.map((kind) => (
                <button type="button" aria-pressed={kinds.includes(kind)} className={kinds.includes(kind) ? 'selected' : ''} onClick={() => toggleKind(kind)} key={kind}>
                  <span aria-hidden="true">{KIND_MARK[kind]}</span>{kind}
                  {kinds.includes(kind) && <b className="choice-check" aria-hidden="true">✓</b>}
                </button>
              ))}
            </div>
            <label>Short title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="1959 Aru village photograph" required /></label>
            <label>Where did this come from?<input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Family archive of Ena Varo" /></label>
          </>
        )}

        {current.id.startsWith('detail:') && (() => {
          const kind = (current as { kind: ContributionKind }).kind;
          const mine = attachments.filter((item) => item.forKind === kind);
          return (
            <>
              <h1>{kind}</h1>
              {fieldsFor(kind).map((field) => field.type === 'files' ? (
                <div className="attachment-field" key={field.name}>
                  <p className="attachment-label">{field.label}</p>
                  {field.help && <p className="form-help">{field.help}</p>}
                  <input
                    type="file" multiple aria-label={field.label}
                    accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,audio/mpeg,audio/wav,audio/mp4"
                    onChange={(event) => { void upload(kind, event.target.files); event.target.value = ''; }}
                  />
                  {uploading === kind && <p className="form-help">Uploading…</p>}
                  {mine.length > 0 && (
                    <ul className="attachment-list">
                      {mine.map((item) => (
                        <li key={item.id}>
                          <div className="attachment-row">
                            <span>{item.fileName}</span>
                            <button type="button" onClick={() => setAttachments((now) => now.filter((entry) => entry.id !== item.id))}>Remove</button>
                          </div>
                          {item.kind === 'image' && (
                            <label className="attachment-alt">
                              Describe this image for someone who cannot see it
                              <input
                                value={item.alt}
                                placeholder="A carved mask held by two people outside a meeting house"
                                onChange={(event) => setAttachments((now) => now.map((entry) => entry.id === item.id ? { ...entry, alt: event.target.value } : entry))}
                              />
                            </label>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="form-help">Uploads stay private to the curatorial team until a curator publishes them.</p>
                </div>
              ) : field.type === 'textarea' ? (
                <label key={field.name}><span className="field-name">{field.label}{field.required && <b aria-hidden="true"> *</b>}</span>
                  <textarea rows={4} placeholder={field.placeholder} value={values[kind]?.[field.name] ?? ''} onChange={(event) => setValue(kind, field.name, event.target.value)} />
                  {field.help && <small className="field-help">{field.help}</small>}
                </label>
              ) : (
                <label key={field.name}><span className="field-name">{field.label}{field.required && <b aria-hidden="true"> *</b>}</span>
                  <input placeholder={field.placeholder} value={values[kind]?.[field.name] ?? ''} onChange={(event) => setValue(kind, field.name, event.target.value)} />
                  {field.help && <small className="field-help">{field.help}</small>}
                </label>
              ))}
            </>
          );
        })()}

        {current.id === 'consent' && (
          <>
            <h1>How may the museum use it?</h1>
            <fieldset className="consent-options">
              <legend>Choose one permission</legend>
              {CONSENT_OPTIONS.map(([value, label, detail]) => (
                <label key={value}>
                  <input type="radio" name="consent" checked={consent === value} onChange={() => setConsent(value)} />
                  <span><strong>{label}</strong><small>{detail}</small></span>
                </label>
              ))}
            </fieldset>
            <label>What would you like to happen?<input value={requestedOutcome} onChange={(event) => setRequestedOutcome(event.target.value)} /></label>
          </>
        )}

        {current.id === 'review' && (
          <>
            <h1>Review your contribution.</h1>
            <dl className="review-list">
              <div><dt>Object</dt><dd>{selected.title}<small>{selected.accession}</small></dd></div>
              <div><dt>Title</dt><dd className="prose">{title || <em>Not given</em>}</dd></div>
              <div><dt>Material</dt><dd className="prose">{describeKinds(kinds)}</dd></div>
              {details.map((detail) => {
                const lines = summariseDetail(detail);
                const files = attachments.filter((item) => item.forKind === detail.kind);
                return (
                  <div key={detail.kind}>
                    <dt>{detail.kind}</dt>
                    <dd>
                      {files.length > 0 && <strong>{files.length} file{files.length === 1 ? '' : 's'} attached</strong>}
                      {files.map((file) => <small key={file.id}>{file.fileName}{file.alt ? ` — ${file.alt}` : file.kind === 'image' ? ' — no description given' : ''}</small>)}
                      {lines.map((line) => <small key={line}>{line}</small>)}
                      {lines.length === 0 && files.length === 0 && <em>Nothing added</em>}
                    </dd>
                  </div>
                );
              })}
              <div><dt>Source</dt><dd>{source || <em>Not given</em>}</dd></div>
              <div><dt>Permission</dt><dd>{consent.replaceAll('_', ' ')}</dd></div>
              <div><dt>Requested</dt><dd>{requestedOutcome}</dd></div>
            </dl>
            <div className="submission-notice">
              <b>What happens next</b>
              <p>Your contribution will enter the curator inbox as <strong>submitted</strong>. It can inform research, but it cannot change the official record by itself. Any files you attached stay private to the curatorial team until a curator publishes them.</p>
            </div>
          </>
        )}

        {error && <p className="clarify-result" role="alert">{error}</p>}

        <div className="form-actions">
          {step > 0 && <button type="button" className="secondary-action" onClick={() => { setError(''); setStep(step - 1); }}>Back</button>}
          <button className="primary-action" disabled={pending || !!uploading}>
            {current.id === 'review' ? (pending ? 'Submitting…' : 'Submit contribution') : 'Continue'} <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>
    </form>
  );
}
