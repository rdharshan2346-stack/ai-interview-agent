# AI Interview Agent

**ABTalks Vibe Code Hackathon — Problem Statement 2**
Built solo by Dharshan, entirely AI-assisted. See [PROMPTS.md](./PROMPTS.md).

**Live demo:** https://ai-interview-agent-orpin.vercel.app/test

An AI agent that conducts an adaptive, multi-turn technical interview with a
graduate of a 31-day AI engineering cohort — then returns structured feedback.

---

## What makes this adaptive (not a question list)

`candidates.json` contains a signal most submissions will overlook: **attempts**.

A candidate who passed a mission on attempt 5 does not understand that topic the
way someone who passed on attempt 1 does — yet both appear as `passed: true`.
This agent reads that difference and interviews accordingly.

| Cohort signal | Interview angle |
|---|---|
| Failed the mission | Foundational question — fair, not punitive |
| Skipped the topic | Did they pick it up through work or self-study? |
| Passed on 4+ attempts | Probe the underlying concept, not the surface API |
| Passed on 2-3 attempts | Separate real understanding from pattern-matching |
| Passed first try | Don't go easy — probe trade-offs and failure modes |

Weak areas are prioritised, spread across different curriculum modules, and one
confident topic is always included so the final feedback can cite real strengths.

**Result: all 20 provided candidates generate a different interview.**
Emily Chen (perfect record) is probed for depth on topics she aced.
Gerald Combs is questioned on the three missions he failed.
Bethany Cole is asked about four topics she skipped entirely.

## Answers are evaluated before each follow-up

Rather than asking the model to "evaluate and follow up" in one call — which
produces follow-ups that ignore the evaluation — each answer gets a dedicated
scoring pass (`depth`, `correct`, `observation`, `followUpAngle`). The follow-up
is then conditioned on that judgement, and the final feedback is grounded in
accumulated per-answer evidence instead of being improvised from the transcript.

---

## API

### `POST /api/interview`

**Start a session**
```json
{ "sessionId": "abc-123", "candidate": { /* candidate.json shape */ } }
```
```json
{ "reply": "Welcome Sarah. ...", "done": false }
```

**Each turn**
```json
{ "sessionId": "abc-123", "message": "Embeddings map text into..." }
```
```json
{ "reply": "How would you choose chunk size...", "done": false }
```

**Final turn**
```json
{
  "reply": "Interview completed.",
  "done": true,
  "feedback": {
    "summary": "...",
    "strengths": ["..."],
    "gaps": ["..."],
    "next": ["..."]
  }
}
```

### `GET /api/interview`
Health check — reports whether the Gemini key and KV store are configured,
without starting a session or spending an API call.

**Guaranteed:** 4 curriculum days x 2 questions = **8 questions minimum**,
enforced structurally rather than by prompt instruction.

---

## Run locally

```bash
npm install
cp .env.example .env.local     # paste your Gemini key
npm run dev
```

Get a free Gemini key (no credit card): https://aistudio.google.com/apikey

- Browser test console: http://localhost:3000/test
- Health check: http://localhost:3000/api/interview
- End-to-end test: `node scripts/test-interview.mjs CAND-014`

## Deploy

Import the repo into Vercel, then:
1. Set env var `GEMINI_API_KEY`.
2. Attach a Redis database (Storage tab → Marketplace Database Providers →
   Redis → Create). This injects `REDIS_URL`.

A database is required in production: serverless invocations don't share
memory, so without it multi-turn sessions break. The app falls back to
in-memory storage locally so `npm run dev` works with zero setup — the
health check tells you which mode is live.

## Stack

Next.js 14 (App Router) · Gemini (`gemini-flash-lite-latest`) · Redis (Vercel Marketplace) · Tailwind

```
app/api/interview/route.js   HTTP layer + state machine
lib/interview-engine.js      Day selection + prompt construction
lib/gemini.js                Model client, retry/backoff, JSON parsing
lib/session-store.js         Redis with in-memory fallback
app/test/page.js             Browser test console
scripts/test-interview.mjs   End-to-end smoke test
```
