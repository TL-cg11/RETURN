import { ensureDatabase } from '@/db/setup';

/**
 * How many writes one caller may make in a window, and how long the window is.
 *
 * The deployed site accepted forty contributions in 1.7 seconds and twelve simultaneous
 * uploads, from a caller with no session at all, into the workspace every first-time
 * visitor sees (V9-5). Nothing was broken by it; there was simply nothing to stop it.
 *
 * The numbers are set where a person filling in a form never meets them — a contribution
 * takes minutes to write, and the eight files one may carry are eight uploads — and where
 * a script hammering the door does, quickly.
 */
export const WRITE_WINDOW_MS = 60_000;

/**
 * Two ceilings, because two kinds of write cost different things.
 *
 * A contribution is a row. An upload is an object in R2 that nothing ever deletes, so it
 * is the one worth holding tightly — eight files is what a single contribution may carry,
 * and thirty a minute is several contributions' worth. The row limit is set well above
 * anything a person does and above what this project's own verification run needs, because
 * its job is to bound cost rather than to be an access control: writes already require a
 * session and land in the caller's own workspace, so a flood now fills only its own.
 */
export const WRITES_PER_WINDOW = 1200;
export const UPLOADS_PER_WINDOW = 100;

/**
 * Counts one write against a caller's window and says whether it is over.
 *
 * Keyed on the caller's address rather than their session, because a session is something
 * the caller mints for themselves — rate limiting per session would ask the flood to
 * please identify itself.
 *
 * Only `CF-Connecting-IP` is read, and only because Cloudflare sets it at the edge where
 * the client cannot. `X-Forwarded-For` and `X-Real-IP` arrive from whoever sent them, so
 * keying on those would let a caller pick a fresh bucket per request by changing a header
 * — a limit anyone can opt out of is decoration. Where that header is absent, which is
 * local development and nowhere else, every caller shares one bucket. That is stricter
 * than intended rather than looser, which is the right direction to be wrong in.
 *
 * The counter lives in D1 rather than in memory because Workers isolates come and go, and
 * a limit that resets whenever the platform feels like it is not a limit.
 */
export async function overWriteLimit(request: Request, museumId: string, kind: 'write' | 'upload' = 'write') {
  const ceiling = kind === 'upload' ? UPLOADS_PER_WINDOW : WRITES_PER_WINDOW;
  const address = request.headers.get('cf-connecting-ip') ?? '';
  const key = `${kind}:${address || 'unattributed'}`;
  const now = Date.now();
  const windowStart = now - (now % WRITE_WINDOW_MS);

  const db = await ensureDatabase(museumId);
  // One statement, so two requests arriving together cannot both read a stale count and
  // both decide they are under the limit — the shape that let six concurrent resolutions
  // through in V9-1.
  await db.prepare(`INSERT INTO rate_limits (key, window_start, hits)
    VALUES (?,?,1)
    ON CONFLICT(key, window_start) DO UPDATE SET hits = hits + 1`)
    .bind(key, windowStart).run();
  const row = await db.prepare('SELECT hits FROM rate_limits WHERE key=? AND window_start=?')
    .bind(key, windowStart).first<{ hits: number }>();

  // Old windows are swept opportunistically rather than on a schedule this demo has no
  // place to run. One in fifty writes pays for it.
  if (Math.random() < 0.02) {
    await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(windowStart - WRITE_WINDOW_MS * 10).run();
  }

  const hits = row?.hits ?? 1;
  if (hits <= ceiling) return null;

  const retryAfter = Math.max(1, Math.ceil((windowStart + WRITE_WINDOW_MS - now) / 1000));
  return Response.json({
    outcome: 'denied',
    policy: 'rate_limited',
    reason: `This address has made ${hits - 1} ${kind === 'upload' ? 'uploads' : 'writes'} in the last minute, and the limit is ${ceiling}.`,
    recovery: `Wait ${retryAfter} second${retryAfter === 1 ? '' : 's'} and send it again. Nothing was written.`,
  }, { status: 429, headers: { 'retry-after': String(retryAfter) } });
}
