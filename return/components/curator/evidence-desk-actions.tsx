'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function EvidenceDeskActions({ submissionId, objectId, hasPendingApproval, askedCount }: {
  submissionId: string; objectId: string; hasPendingApproval: boolean; askedCount: number;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState('Can you confirm who made this record, and where it was kept before it reached you?');
  const [result, setResult] = useState('');
  const [pending, setPending] = useState(false);

  async function sendClarification() {
    if (!question.trim()) { setResult('A clarification needs a question.'); return; }
    setPending(true);
    const response = await fetch(`/api/curator/submissions/${submissionId}/clarify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    const data = await response.json().catch(() => null) as { reason?: string; recovery?: string } | null;
    setPending(false);
    if (!response.ok) {
      // The gateway answers a refusal with what went wrong and what to do about it.
      // This used to throw both away and print "Could not send the question.", so a
      // curator whose question ran four characters over the limit was told only that
      // something failed (F5-1). Every other action in this console already reads these.
      setResult([data?.reason, data?.recovery].filter(Boolean).join(' ') || 'Could not send the question.');
      return;
    }
    setResult('Question sent. This contribution now needs information.');
    setAsking(false);
    router.refresh();
  }

  return (
    <div className="case-actions">
      {asking ? (
        <div className="clarify-box">
          <label>
            Question for the contributor
            <textarea rows={3} value={question} onChange={(event) => setQuestion(event.target.value)} />
          </label>
          <div className="clarify-actions">
            <button type="button" onClick={() => setAsking(false)}>Cancel</button>
            <button type="button" className="primary" disabled={pending} onClick={sendClarification}>{pending ? 'Sending…' : 'Send question'}</button>
          </div>
        </div>
      ) : (
        // A review can need more than one question. Disabling this after the first left the
        // curator no way to ask again, and no way to see what had already been asked.
        <button type="button" onClick={() => setAsking(true)}>
          {askedCount > 0 ? `Ask another question (${askedCount} asked)` : 'Request clarification'}
        </button>
      )}

      {/* Names the record it wants, so a queue entry for another object is never opened
          from here, and says plainly when this record has nothing waiting (FR2-K2). */}
      <button
        type="button" className="primary" disabled={!hasPendingApproval}
        title={hasPendingApproval ? undefined : 'No proposed revision is waiting for this record.'}
        onClick={() => window.dispatchEvent(new CustomEvent('open-approval', { detail: { objectId } }))}
      >
        {hasPendingApproval ? 'Review proposed update' : 'No proposed update waiting'}
        {hasPendingApproval && <span aria-hidden="true"> →</span>}
      </button>

      {result && <p className="clarify-result" role="status">{result}</p>}
    </div>
  );
}
