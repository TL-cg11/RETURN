import { workspaceRevision } from '@/db/queries';
import { sessionFromRequest } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * The polling fallback behind `/api/events`.
 *
 * The plan asks for realtime but puts demo stability first, so every surface
 * that opens a stream can also ask this route directly. Same token, same
 * absence of record content.
 */
export async function GET(request: Request) {
  const { museumId } = sessionFromRequest(request);
  return Response.json(await workspaceRevision(museumId), {
    headers: { 'cache-control': 'no-store' },
  });
}
