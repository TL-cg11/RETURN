import { workspaceRevision } from '@/db/queries';
import { sessionFromRequest } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** How often the stream looks for a change, and how long one connection lives. */
const TICK_MS = 1000;
const MAX_LIFETIME_MS = 5 * 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Server-sent events for one museum workspace.
 *
 * The two surfaces read the same record, so a contribution made on the left has
 * to appear on the right without anyone pressing reload. This streams a change
 * token; the client re-renders when it moves. It carries no record content, so
 * it can never leak material a consent or visibility rule would withhold.
 *
 * Connections are capped at five minutes. EventSource reconnects on its own,
 * which keeps a long demo from holding one worker invocation open forever.
 */
export async function GET(request: Request) {
  const { museumId } = sessionFromRequest(request);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      let current = '';
      try {
        const first = await workspaceRevision(museumId);
        current = first.revision;
        send('sync', first);

        const deadline = Date.now() + MAX_LIFETIME_MS;
        while (!request.signal.aborted && Date.now() < deadline) {
          await sleep(TICK_MS);
          if (request.signal.aborted) break;
          const next = await workspaceRevision(museumId);
          if (next.revision !== current) {
            current = next.revision;
            send('record', next);
          } else {
            controller.enqueue(encoder.encode(': keep-alive\n\n'));
          }
        }
      } catch {
        // A failed stream must not look like a quiet one: closing lets the
        // client fall back to polling instead of waiting on a dead connection.
      }
      try { controller.close(); } catch { /* already closed by the client */ }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
