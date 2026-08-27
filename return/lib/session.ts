import { cookies } from 'next/headers';
import { DEMO_MUSEUM, verifySession, type Session } from './session-cookie';

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
