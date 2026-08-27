export const DEMO_MUSEUM = 'museum_demo_01';
export type Role = 'community' | 'curator';
export type Session = { role: Role; museumId: string };

const COOKIE_MAX_AGE = 24 * 60 * 60;
const DEVELOPMENT_SECRET = 'return-local-development-session-key-2026-rotate-before-deploy';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(value: string) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function secureEqual(left: string, right: string) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index++) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

function runtimeSecret() {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured) {
    if (configured.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
    return configured;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET is required in production.');
  return DEVELOPMENT_SECRET;
}

function validMuseumId(value: string) {
  return /^museum_[A-Za-z0-9_-]{1,80}$/.test(value);
}

async function signature(session: Session, secret: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(`return-session:v1:${session.role}:${session.museumId}`));
  return base64Url(new Uint8Array(signed));
}

/** Sign both fields as one session so a role cookie cannot be replayed with another workspace. */
export async function signSession(session: Session, secret = runtimeSecret()) {
  if (!validMuseumId(session.museumId)) throw new Error('Invalid museum id.');
  const seal = await signature(session, secret);
  return {
    role: `${base64Url(encoder.encode(session.role))}.${seal}`,
    museumId: `${base64Url(encoder.encode(session.museumId))}.${seal}`,
  };
}

function tokenParts(token: string | null) {
  if (!token) return null;
  const [payload, seal, extra] = token.split('.');
  if (!payload || !seal || extra) return null;
  try {
    return { value: decoder.decode(fromBase64Url(payload)), seal };
  } catch {
    return null;
  }
}

/** Invalid, partial, expired, or edited cookie pairs fail closed to the public demo session. */
export async function verifySession(roleToken: string | null, museumToken: string | null, secret = runtimeSecret()): Promise<Session | null> {
  const rolePart = tokenParts(roleToken);
  const museumPart = tokenParts(museumToken);
  if (!rolePart || !museumPart || !secureEqual(rolePart.seal, museumPart.seal)) return null;
  if (rolePart.value !== 'community' && rolePart.value !== 'curator') return null;
  if (!validMuseumId(museumPart.value)) return null;
  const session: Session = { role: rolePart.value, museumId: museumPart.value };
  return secureEqual(rolePart.seal, await signature(session, secret)) ? session : null;
}

export async function sessionCookieHeaders(session: Session, requestUrl: string, secret = runtimeSecret()) {
  const signed = await signSession(session, secret);
  const secure = new URL(requestUrl).protocol === 'https:' ? '; Secure' : '';
  const attributes = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${secure}`;
  return [
    `role=${encodeURIComponent(signed.role)}; ${attributes}`,
    `museum_id=${encodeURIComponent(signed.museumId)}; ${attributes}`,
  ];
}

export function appendSessionCookies(headers: Headers, values: string[]) {
  for (const value of values) headers.append('set-cookie', value);
  return headers;
}
