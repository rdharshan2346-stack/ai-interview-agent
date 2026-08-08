# CLAUDE.md — Project context

Read this first. It contains everything needed to continue this project.

## What this is

Submission for the **ABTalks Vibe Code Hackathon, Problem Statement 2: AI Interview Agent**.
Built solo by Dharshan (3rd-year CSE student). 48-hour hackathon.

An AI agent that conducts an adaptive, multi-turn technical interview with a
graduate of a 31-day AI engineering cohort, then produces structured feedback.

## Hard requirements from the spec (do not break these)

- Single endpoint: `POST /api/interview`, no auth.
- Start:  `{ sessionId, candidate }` → `{ reply, done: false }`
- Turn:   `{ sessionId, message }`   → `{ reply, done: false }`
- End:    `{ reply, done: true, feedback: { summary, strengths[], gaps[], next[] } }`
- Minimum **8 questions** across at least **4 different curriculum days**.
- Must generate follow-ups based on previous answers.
- Must maintain conversation context across requests.

Also required for eligibility (Stage 1 verification):
- Public GitHub repo, working live demo URL, and a `PROMPTS.md` AI usage log.
- Stage 2 checks commit history looks like genuine incremental development —
  **commit as you go, don't squash everything into one final commit.**

## Architecture

```
app/api/interview/route.js   HTTP layer + state machine only
lib/interview-engine.js      Day selection, prompt construction  (the "brains")
lib/gemini.js                Gemini client, retry/backoff, JSON parsing
lib/session-store.js         Vercel KV with in-memory fallback
lib/curriculum.json          31-day curriculum (provided by organizers)
lib/candidates.json          20 candidate profiles (provided by organizers)
app/test/page.js             Browser test console (not part of the spec)
scripts/test-interview.mjs   End-to-end smoke test with spec assertions
```

### State machine
```
question  --answer--> [evaluate] --> followup
followup  --answer--> [evaluate] --> next day (question)  OR  feedback (done)
```
4 days x 2 questions = 8 questions minimum, guaranteed structurally rather than
by hoping the model follows an instruction.

### The core idea (this is the differentiator — protect it)

`attempts` is the most honest signal in `candidates.json`. A candidate who
passed on attempt 5 does not understand a topic the way one who passed on
attempt 1 does — but both show `passed: true`. Most submissions will ignore
this. We don't:

| Signal | Meaning | Interview angle |
|---|---|---|
| `failed` | didn't pass | foundational, fair not punitive |
| `skipped` | never attempted | did they learn it elsewhere? |
| `struggled_hard` | 4+ attempts | probe the concept, not the API |
| `struggled_mild` | 2-3 attempts | understanding vs pattern-matching |
| `confident` | first try | probe depth: trade-offs, failure modes |

Weak topics are prioritised, spread across different curriculum modules, and at
least one confident topic is always included so feedback has real strengths to
cite. Verified: all 20 candidates produce 4 unique days, with genuinely
different topic sets.

There is also a **separate evaluation call** before each follow-up. Asking the
model to "evaluate and then follow up" in one call produces follow-ups that
ignore the evaluation. Splitting them means follow-ups are actually conditioned
on answer quality, and the final feedback is grounded in per-answer evidence
rather than invented from the transcript.

## Setup

```bash
npm install
cp .env.example .env.local     # then paste your Gemini key into it
npm run dev
```

Free Gemini key (no credit card): https://aistudio.google.com/apikey

Verify without burning an API call: open http://localhost:3000/api/interview
(GET returns a health check showing whether the key and KV are configured).

Manual testing: http://localhost:3000/test — pick a candidate, run an interview
in the browser.

End-to-end: `node scripts/test-interview.mjs CAND-014`

## Deployment

Vercel, importing the GitHub repo. Two things must be set in the Vercel project:
1. Env var `GEMINI_API_KEY`
2. A **KV database** attached (Storage → Create Database → KV). Without it the
   app silently falls back to in-memory sessions, which **breaks multi-turn
   interviews in production** because serverless invocations don't share memory.
   The GET health check reports which mode is active — check it after deploying.

## Known gaps / good next steps

- No rate limiting on the endpoint (fine for a hackathon, not for production).
- Test console at `/test` is unstyled beyond basics; could be polished.
- Feedback quality depends on Gemini's JSON compliance; parsing is defensive
  but a schema-validated retry would be stronger.
- Consider persisting completed transcripts for a "review past interviews" view.
- Interview length is fixed at 4 days; could adapt dynamically to answer quality.

## Voice/style note for the interviewer prompts

Cohort signals (attempts, skips) shape **what** is asked, never **what is said**.
The agent must never tell the candidate "you skipped this" or reference attempt
counts — that would be both creepy and unrealistic in a real interview.
