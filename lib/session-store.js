/**
 * Session storage with graceful fallback.
 *
 * WHY THIS EXISTS:
 * Vercel serverless functions do not share memory between invocations, so a
 * multi-turn interview needs external state. We use Redis (attached via
 * Vercel's Marketplace Storage integration) in production.
 *
 * But requiring Redis to be configured would mean the app is un-runnable
 * locally (`npm run dev`) until someone provisions a database. That's a bad
 * developer experience and a bad demo risk. So this module falls back to an
 * in-process Map when REDIS_URL is absent.
 *
 * The fallback is NOT safe for production (each serverless instance would have
 * its own Map, so turns would randomly lose state) — hence the loud warning.
 */

const { createClient } = require('redis');

let redisClient = null;
let connecting = null;
const kvAvailable = Boolean(process.env.REDIS_URL);

if (!kvAvailable) {
  console.warn(
    '[session-store] REDIS_URL not configured — using in-memory sessions. ' +
      'Fine for local dev; NOT safe for production serverless.'
  );
}

// Lazily connect once per warm serverless instance, reusing the connection
// across invocations rather than opening a new one per request.
async function getRedis() {
  if (redisClient) return redisClient;
  if (!connecting) {
    const client = createClient({ url: process.env.REDIS_URL });
    client.on('error', (err) => console.error('[session-store] Redis client error:', err.message));
    connecting = client.connect().then(() => {
      redisClient = client;
      return client;
    });
  }
  return connecting;
}

// In-memory fallback for local development only.
const memoryStore = new Map();

const TTL_SECONDS = 60 * 60 * 6; // 6 hours — an interview should never outlive this

export function isKvAvailable() {
  return kvAvailable;
}

export async function getSession(sessionId) {
  const key = `interview:${sessionId}`;
  if (kvAvailable) {
    try {
      const client = await getRedis();
      const raw = await client.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.error('[session-store] Redis read failed:', err.message);
      return memoryStore.get(key) || null;
    }
  }
  return memoryStore.get(key) || null;
}

export async function setSession(sessionId, session) {
  const key = `interview:${sessionId}`;
  if (kvAvailable) {
    try {
      const client = await getRedis();
      await client.set(key, JSON.stringify(session), { EX: TTL_SECONDS });
      return;
    } catch (err) {
      console.error('[session-store] Redis write failed, falling back:', err.message);
    }
  }
  memoryStore.set(key, session);
}
