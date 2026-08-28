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

/**
 * Demo role switch. The server signs the requested role and preserves the verified workspace.
 *
 * A role this system never defined is refused rather than quietly turned into `community`
 * (OB-2). The old behaviour was fail-closed and therefore safe, but it answered `200` with
 * a role the caller had not asked for — the same silent rewrite MCP-E1 removed from
 * consent. An absent role still means `community`: that is a default, not a correction.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { role?: string };
  if (body.role !== undefined && body.role !== 'curator' && body.role !== 'community') {
    return Response.json({
      outcome: 'invalid', field: 'role',
      reason: 'Role must be community or curator.',
      recovery: 'Use one of the two demo roles, or omit the field to stay in the community collection.',
    }, { status: 400 });
  }
  const role: Role = body.role === 'curator' ? 'curator' : 'community';
  return responseFor(request, role);
}
