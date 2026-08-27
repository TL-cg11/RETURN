import { cookies } from 'next/headers';

export const DEMO_MUSEUM = 'museum_demo_01';
export type Role = 'community' | 'curator';

function read(header: string | null, name: string) {
  const match = (header ?? '').match(new RegExp(`(?:^|; *)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Session for route handlers, which receive the request directly. */
export function sessionFromRequest(request: Request) {
  const header = request.headers.get('cookie');
  return {
    role: (read(header, 'role') === 'curator' ? 'curator' : 'community') as Role,
    museumId: read(header, 'museum_id') ?? DEMO_MUSEUM,
  };
}

/** Session for server components, which read the request cookie jar. */
export async function sessionFromCookies() {
  const jar = await cookies();
  return {
    role: (jar.get('role')?.value === 'curator' ? 'curator' : 'community') as Role,
    museumId: jar.get('museum_id')?.value ?? DEMO_MUSEUM,
  };
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
