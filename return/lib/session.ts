import { cookies } from 'next/headers';
import { DEMO_MUSEUM, sessionCookieHeaders, verifySession, type Session } from './session-cookie';

export * from './session-cookie';

const ROLE_COOKIE = 'role';
const MUSEUM_COOKIE = 'museum_id';

function read(header: string | null, name: string) {
  const match = (header ?? '').match(new RegExp(`(?:^|; *)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Session for route handlers, which receive the request directly. */
export async function sessionFromRequest(request: Request): Promise<Session> {
  const header = request.headers.get('cookie');
  return await verifySession(read(header, ROLE_COOKIE), read(header, MUSEUM_COOKIE))
    ?? { role: 'community', museumId: DEMO_MUSEUM };
}

/** Session for server components, which read the request cookie jar. */
export async function sessionFromCookies(): Promise<Session> {
  const jar = await cookies();
  return await verifySession(jar.get(ROLE_COOKIE)?.value ?? null, jar.get(MUSEUM_COOKIE)?.value ?? null)
    ?? { role: 'community', museumId: DEMO_MUSEUM };
}

/**
 * The workspace a write belongs in, and the cookies that put the caller there (V9-4).
 *
 * Every visitor without a signed session lands in the shared demo workspace, because that
 * is what the collection is shown from. That was fine while it was only read. It was not
 * fine for writes: two strangers browsing the deployed site shared one workspace, so a
 * contribution filed as `private` — the level whose copy promises only curators will study
 * it — could be read in full by the next visitor, who becomes a curator by clicking a
 * button. Nothing was stolen; the two people were simply never separated. And anyone could
 * fill the workspace every first-time visitor sees, from anywhere, with no session at all.
 *
 * So reading stays shared and free, and the first write gives that session a workspace of
 * its own. The record they file is theirs, seeded with the same collection, and nobody
 * else is in it. Real authentication is out of scope by `RETURN_PLAN.md` §4.2; keeping
 * strangers out of each other's contributions is not the same problem and does not need it.
 */
export async function sessionForWrite(request: Request): Promise<{ session: Session; cookies: string[] } | { refusal: Response }> {
  const header = request.headers.get('cookie');
  const verified = await verifySession(read(header, ROLE_COOKIE), read(header, MUSEUM_COOKIE));

  // A write needs a session, and a browser already has one — every page asks for it on
  // load. Refusing here is what keeps minting cheap: a caller that ignores cookies would
  // otherwise be handed a freshly seeded workspace on every single request, so the fix
  // that separated strangers would have become a way to make a hundred rows per POST.
  if (!verified) {
    return {
      refusal: Response.json({
        outcome: 'invalid', field: 'session',
        reason: 'A write needs a session, and this request carried none.',
        recovery: 'Call GET /api/session first and send the cookies it returns.',
      }, { status: 401 }),
    };
  }

  if (verified.museumId !== DEMO_MUSEUM) return { session: verified, cookies: [] };
  const session: Session = { ...verified, museumId: `museum_${crypto.randomUUID()}` };
  return { session, cookies: await sessionCookieHeaders(session, request.url) };
}

/** Attaches the cookies a write session minted, if it minted any. */
export function withSessionCookies(response: Response, values: string[]) {
  if (values.length === 0) return response;
  const headers = new Headers(response.headers);
  for (const value of values) headers.append('set-cookie', value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Compact relative time for record timestamps. */
export function relativeTime(createdAt: number, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - createdAt) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}
