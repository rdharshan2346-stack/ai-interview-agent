import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Gemini client with retry + backoff.
 *
 * WHY RETRIES MATTER HERE:
 * The Gemini free tier allows ~15 requests/minute. An evaluator clicking
 * through an interview quickly, or two people testing at once, can trip a 429.
 * Without retry logic those requests fail silently and the interview breaks
 * mid-conversation — the single worst failure mode for this submission.
 */

const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const MAX_RETRIES = 3;

let client = null;
function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey ' +
        'and add it to .env.local (locally) or Vercel project env vars (production).'
    );
  }
  if (!client) client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return client;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRetryable(err) {
  const msg = String(err?.message || '');
  return (
    msg.includes('429') ||        // rate limited
    msg.includes('503') ||        // model overloaded
    msg.includes('500') ||        // transient server error
    msg.toLowerCase().includes('fetch failed')
  );
}

// A 429's RetryInfo tells us how long the free-tier per-minute quota needs to
// reset — that's usually ~30s, far longer than fixed exponential backoff
// would wait, so honor it directly when present instead of guessing.
function retryDelayMs(err) {
  const info = err?.errorDetails?.find((d) =>
    d['@type']?.includes('RetryInfo')
  );
  const seconds = parseFloat(info?.retryDelay);
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : null;
}

/**
 * Ask Gemini a single question with a system instruction.
 * Retries with exponential backoff on transient/rate-limit errors.
 */
export async function askGemini(systemInstruction, userPrompt, { maxTokens = 600 } = {}) {
  const model = getClient().getGenerativeModel({
    model: MODEL,
    systemInstruction,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.8, // some variety so repeat runs don't feel canned
    },
  });

  let lastErr;
  let elapsedMs = 0;
  const budgetMs = 45000; // stay under maxDuration=60s with room to spare
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent(userPrompt);
      const text = result.response.text().trim();
      if (!text) throw new Error('Empty response from model');
      return text;
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES || !isRetryable(err)) break;
      const suggested = retryDelayMs(err);
      // Google's suggested delay can round down to 0s while still inside the
      // exceeded window — floor it so we don't instantly retry into the same 429.
      const waitMs = suggested != null ? Math.max(suggested, 3000) : 1000 * Math.pow(2, attempt);
      if (elapsedMs + waitMs > budgetMs) break; // would blow the request timeout — fail fast instead
      console.warn(
        `[gemini] attempt ${attempt + 1} failed (${err.message}). Retrying in ${waitMs}ms`
      );
      await sleep(waitMs);
      elapsedMs += waitMs;
    }
  }
  throw lastErr;
}

/**
 * Ask Gemini for JSON and parse it defensively.
 * Models sometimes wrap JSON in markdown fences despite instructions, so we
 * strip fences and, as a last resort, extract the outermost {...} block.
 */
export async function askGeminiJSON(systemInstruction, userPrompt, options) {
  const raw = await askGemini(systemInstruction, userPrompt, options);
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* fall through */
      }
    }
    return null; // caller decides the fallback
  }
}
