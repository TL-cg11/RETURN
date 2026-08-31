import { ensureDatabase } from '@/db/setup';
import { appendSessionCookies, sessionCookieHeaders, sessionFromRequest } from '@/lib/session';
import { guarded } from '@/lib/http/input';

export const POST = guarded(async (request: Request) => {
  const current = await sessionFromRequest(request);
  const museumId = `museum_${crypto.randomUUID()}`;
  const session = { role: current.role, museumId };
  const headers = appendSessionCookies(new Headers({ 'cache-control': 'no-store' }), await sessionCookieHeaders(session, request.url));
  try {
    await ensureDatabase(museumId);
  } catch {
    return Response.json({ museumId, reset: true, persisted: false }, { headers });
  }
  return Response.json({ museumId, reset: true, persisted: true }, { headers });
});
