'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Closes one policy referral. Two outcomes, deliberately: taking a refusal
 * forward and judging it needs nothing are different decisions, and the audit
 * trail should be able to tell them apart.
 */
export function EscalationActions({ escalationId }: { escalationId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');

  async function resolve(action: 'reviewed' | 'dismissed') {
    setPending(action);
    setError('');
    const response = await fetch(`/api/curator/escalations/${escalationId}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await response.json().catch(() => null) as { reason?: string; recovery?: string } | null;
    setPending('');
    if (!response.ok) {
      // The route says what happened and what to do — including on a race, where it
      // answers "This referral was already reviewed." This used to print a sentence of
      // its own instead, which guessed at a second session and threw the real answer
      // away (F5-1). The fallback is only for a response that carries no words at all.
      setError([data?.reason, data?.recovery].filter(Boolean).join(' ') || 'Could not close this referral.');
      return;
    }
    router.refresh();
  }

  return (
    <div className="escalation-actions">
      <button type="button" disabled={!!pending} onClick={() => resolve('reviewed')}>
        {pending === 'reviewed' ? 'Closing…' : 'Mark reviewed'}
      </button>
      <button type="button" className="quiet" disabled={!!pending} onClick={() => resolve('dismissed')}>
        {pending === 'dismissed' ? 'Closing…' : 'Dismiss'}
      </button>
      {error && <p role="status">{error}</p>}
    </div>
  );
}
