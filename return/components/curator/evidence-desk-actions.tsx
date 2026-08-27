'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function EvidenceDeskActions({ submissionId, status }: { submissionId: string; status: string }) {
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
    setPending(false);
    if (!response.ok) { setResult('Could not send the question.'); return; }
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
        <button type="button" onClick={() => setAsking(true)} disabled={status === 'needs information'}>
          {status === 'needs information' ? 'Clarification requested' : 'Request clarification'}
        </button>
      )}

      <button type="button" className="primary" onClick={() => window.dispatchEvent(new Event('open-approval'))}>
        Review proposed update <span aria-hidden="true">→</span>
      </button>

      {result && <p className="clarify-result" role="status">{result}</p>}
    </div>
  );
}
