/**
 * Session storage with graceful fallback.
 *
 * WHY THIS EXISTS:
 * Vercel serverless functions do not share memory between invocations, so a
 * multi-turn interview needs external state. We use Vercel KV in production.
 *
 * But requiring KV to be configured would mean the app is un-runnable locally
 * (`npm run dev`) until someone provisions a database. That's a bad developer
 * experience and a bad demo risk. So this module falls back to an in-process
 * Map when KV env vars are absent.
 *
 * The fallback is NOT safe for production (each serverless instance would have
 * its own Map, so turns would randomly lose state) — hence the loud warning.
 */

let kvClient = null;
let kvAvailable = false;

// KV sets these automatically when you attach a database to the project.
if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
  try {
    // Imported lazily so local dev doesn't crash when the package can't init.
    const { kv } = require('@vercel/kv');
    kvClient = kv;
    kvAvailable = true;
  } catch (err) {
    console.warn('[session-store] @vercel/kv failed to load:', err.message);
  }
}

// In-memory fallback for local development only.
const memoryStore = new Map();

if (!kvAvailable) {
  console.warn(
    '[session-store] KV not configured — using in-memory sessions. ' +
      'Fine for local dev; NOT safe for production serverless.'
  );
}

const TTL_SECONDS = 60 * 60 * 6; // 6 hours — an interview should never outlive this

export function isKvAvailable() {
  return kvAvailable;
}

export async function getSession(sessionId) {
  const key = `interview:${sessionId}`;
  if (kvAvailable) {
    try {
      return await kvClient.get(key);
    } catch (err) {
      console.error('[session-store] KV read failed:', err.message);
      return memoryStore.get(key) || null;
    }
  }
  return memoryStore.get(key) || null;
}

export async function setSession(sessionId, session) {
  const key = `interview:${sessionId}`;
  if (kvAvailable) {
    try {
      await kvClient.set(key, session, { ex: TTL_SECONDS });
      return;
    } catch (err) {
      console.error('[session-store] KV write failed, falling back:', err.message);
    }
  }
  memoryStore.set(key, session);
}
