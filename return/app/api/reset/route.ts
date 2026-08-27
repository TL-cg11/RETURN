import { ensureDatabase } from '@/db/setup';

export async function POST() {
  const museumId = `museum_${crypto.randomUUID()}`;
  const cookie = `museum_id=${museumId}; Path=/; SameSite=Lax; Max-Age=86400`;
  try {
    await ensureDatabase(museumId);
  } catch {
    return Response.json({ museumId, reset: true, persisted: false }, { headers: { 'set-cookie': cookie } });
  }
  return Response.json({ museumId, reset: true, persisted: true }, { headers: { 'set-cookie': cookie } });
}
