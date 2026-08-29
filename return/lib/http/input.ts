import { MAX_TEXT } from '@/lib/domain/types';
import { sessionForWrite, withSessionCookies, type Session } from '@/lib/session';
import { overWriteLimit } from '@/lib/http/rate-limit';

/**
 * Reading what a caller sent, once, for every route.
 *
 * Six rounds of verification kept finding the same three shapes of defect at the door:
 * a field read with a string method before anyone checked it was a string, a field
 * coerced with `String()` so an object arrived in the record as `[object Object]`, and a
 * field with no ceiling so a contribution could carry two hundred thousand characters onto
 * a public page. Each was fixed where it was found and stayed open everywhere else.
 *
 * These helpers exist so the check is not something a route has to remember. A route asks
 * for a string and gets either a string within its ceiling or a refusal it can return.
 */

export type Refusal = { refusal: Response };
const isRefusal = <T>(value: T | Refusal): value is Refusal =>
  !!value && typeof value === 'object' && 'refusal' in (value as object);
export const refused = isRefusal;

/** The four fields every refusal on this system carries. */
export function refuse(field: string, reason: string, recovery: string, status = 400): Refusal {
  return { refusal: Response.json({ outcome: 'invalid', field, reason, recovery }, { status }) };
}

/**
 * The request body as an object.
 *
 * An unparseable body is the caller's mistake, and reading it as `{}` turned that mistake
 * into a plausible-looking success. An absent body still means no arguments.
 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | Refusal> {
  const raw = (await request.text()).trim();
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refuse('body', 'The request body is not valid JSON.', 'Send the fields as a JSON object, or send no body at all.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return refuse('body', 'The request body must be a JSON object.', 'Send {} for a request that carries no fields.');
  }
  return parsed as Record<string, unknown>;
}

type TextOptions = {
  /** The ceiling for this field. Every stored free-text field has one. */
  max: number;
  /** Refuse an absent or blank value instead of returning the fallback. */
  required?: boolean;
  /** What an absent value means. Only read when the field is not required. */
  fallback?: string;
  /** Shown in the refusal, so the caller reads the field name it sent. */
  label?: string;
};

/**
 * A trimmed string within its ceiling, or a refusal.
 *
 * A non-string is refused rather than coerced. `String({})` is `"[object Object]"`, and a
 * record that stores that has recorded nothing while looking like it recorded something.
 *
 * Over-long text is refused rather than truncated, for the reason OB-1 gave: a value cut
 * on the way in and read back whole makes two versions of one sentence, and nothing on
 * screen says which one the reader is looking at.
 */
export function takeText(value: unknown, field: string, options: TextOptions): string | Refusal {
  const { max, required = false, fallback = '', label = field } = options;
  if (value === undefined || value === null) {
    if (required) return refuse(field, `${label} is required.`, 'Send it as text.');
    return fallback;
  }
  if (typeof value !== 'string') {
    return refuse(field, `${label} must be text, and this one is ${Array.isArray(value) ? 'a list' : typeof value}.`,
      'Send it as a string.');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) return refuse(field, `${label} is required.`, 'Send it as text.');
    return fallback;
  }
  if (trimmed.length > max) {
    return refuse(field, `${label} is at most ${max} characters, and this one is ${trimmed.length}.`,
      `Shorten it to ${max} characters or fewer.`);
  }
  return trimmed;
}

/**
 * A list of trimmed strings within its length ceiling, or a refusal.
 *
 * The ceiling is not decoration: ids are bound one per SQL variable, and D1 stops at a
 * hundred of them. An unbounded list reached the database and came back as a failure the
 * caller could do nothing with.
 */
export function takeStringList(value: unknown, field: string, options: { max: number; label?: string }): string[] | Refusal {
  const { max, label = field } = options;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    return refuse(field, `${label} must be a list.`, 'Send it as an array of ids.');
  }
  if (value.length > max) {
    return refuse(field, `${label} takes at most ${max} entries, and this one has ${value.length}.`,
      `Send ${max} or fewer at a time.`);
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return refuse(field, `Every entry in ${label} must be an id, and one is ${typeof entry}.`, 'Send them as an array of strings.');
    }
    const trimmed = entry.trim();
    if (trimmed) {
      if (trimmed.length > MAX_TEXT.id) {
        return refuse(field, `An id in ${label} is at most ${MAX_TEXT.id} characters.`, 'Send the ids the tools returned.');
      }
      ids.push(trimmed);
    }
  }
  return ids;
}

/**
 * A write route: same safety net, plus the workspace the write belongs in (V9-4) and the
 * ceiling on how fast one caller may use it (V9-5).
 *
 * Reads are shared — everyone browses the same seeded collection, which costs nothing and
 * is the point of a public demo. Writes are not: a session still on the shared workspace
 * gets one of its own here, before the handler sees it, so two strangers never file into
 * the same record. The session arrives as an argument rather than being read again inside
 * the handler, because reading it again would find the old one.
 */
export function guardedWrite<A extends unknown[]>(
  handler: (request: Request, session: Session, ...rest: A) => Promise<Response>,
  kind: 'write' | 'upload' = 'write',
) {
  return guarded(async (request: Request, ...rest: A) => {
    const resolved = await sessionForWrite(request);
    if ('refusal' in resolved) return resolved.refusal;
    const { session, cookies } = resolved;
    const throttled = await overWriteLimit(request, session.museumId, kind);
    if (throttled) return withSessionCookies(throttled, cookies);
    return withSessionCookies(await handler(request, session, ...rest), cookies);
  });
}

/**
 * Wraps a route so an unhandled throw answers in the same shape as everything else.
 *
 * Two routes were leaving the platform's own empty 500 — no body, no content type, nothing
 * for a caller to read or retry. `error` is a fifth outcome because it is none of the four:
 * the call was not applied, not queued, not refused by policy, and not the caller's
 * mistake. The original exception goes to the server log, not to the caller.
 */
export function guarded<A extends unknown[]>(handler: (request: Request, ...rest: A) => Promise<Response>) {
  return async (request: Request, ...rest: A): Promise<Response> => {
    try {
      return await handler(request, ...rest);
    } catch (error) {
      console.error('[RE:TURN] route failed', request.method, new URL(request.url).pathname, error);
      return Response.json({
        outcome: 'error',
        reason: 'The request failed before it could be answered. Nothing was written.',
        recovery: 'Retry once; if it fails again, report the path you called.',
      }, { status: 500 });
    }
  };
}
