import {
  appendSessionCookies, sessionCookieHeaders, sessionFromRequest, type Role,
} from '@/lib/session';

async function responseFor(request: Request, role?: Role) {
  const current = await sessionFromRequest(request);
  const session = { ...current, ...(role ? { role } : {}) };
  const headers = appendSessionCookies(new Headers({ 'cache-control': 'no-store' }), await sessionCookieHeaders(session, request.url));
  return Response.json(session, { headers });
}

/** First-visit bootstrap: replace absent or invalid plaintext cookies with a signed pair. */
export async function GET(request: Request) {
  return responseFor(request);
}

/** Demo role switch. The server signs the requested role and preserves the verified workspace. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { role?: string };
  const role: Role = body.role === 'curator' ? 'curator' : 'community';
  return responseFor(request, role);
}
