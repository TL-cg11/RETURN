'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const POLL_MS = 2000;

export type LiveTransport = 'connecting' | 'stream' | 'polling';

/**
 * Keeps a surface in step with the shared record.
 *
 * The plan wants the left and right halves of the demo to move together, and it
 * prefers a boring mechanism that always works over an elegant one that
 * sometimes does. So this opens a stream first and drops to polling the moment
 * the stream errors or the browser has no EventSource at all.
 *
 * Both paths carry only a change token; the refresh itself re-renders the
 * server components, so consent and visibility rules still decide what is
 * actually shown.
 */
export function useLiveRecord(): LiveTransport {
  const router = useRouter();
  const [transport, setTransport] = useState<LiveTransport>('connecting');
  const revision = useRef<string>('');

  useEffect(() => {
    let stopped = false;
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;

    /** A token we have never seen means the record moved under us. */
    function apply(next: string) {
      if (!next || next === revision.current) return;
      const first = revision.current === '';
      revision.current = next;
      if (!first) router.refresh();
    }

    async function pollOnce() {
      try {
        const response = await fetch('/api/events/poll', { cache: 'no-store' });
        if (!response.ok) return;
        const body = await response.json() as { revision?: string };
        if (!stopped && body.revision) apply(body.revision);
      } catch {
        // Offline or mid-reload; the next tick tries again.
      }
    }

    function startPolling() {
      if (stopped || timer) return;
      setTransport('polling');
      void pollOnce();
      timer = setInterval(() => { void pollOnce(); }, POLL_MS);
    }

    if (typeof EventSource === 'undefined') {
      startPolling();
    } else {
      source = new EventSource('/api/events');
      const read = (event: MessageEvent<string>) => {
        try {
          const body = JSON.parse(event.data) as { revision?: string };
          if (body.revision) apply(body.revision);
        } catch { /* a malformed frame is not worth tearing the stream down */ }
      };
      source.addEventListener('sync', read as EventListener);
      source.addEventListener('record', read as EventListener);
      source.onopen = () => { if (!stopped) setTransport('stream'); };
      source.onerror = () => {
        // EventSource retries by itself, but a stream that cannot be
        // established at all would leave the surface frozen. Polling from here
        // on costs one small request every two seconds and always works.
        source?.close();
        source = undefined;
        startPolling();
      };
    }

    return () => {
      stopped = true;
      source?.close();
      if (timer) clearInterval(timer);
    };
  }, [router]);

  return transport;
}
