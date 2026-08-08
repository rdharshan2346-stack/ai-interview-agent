# AI Usage Log

**Hackathon:** ABTalks Vibe Code Hackathon
**Track:** Problem Statement 2 — AI Interview Agent
**Built by:** Dharshan (solo)
**Primary AI tool:** Claude (claude.ai), then Claude Code for local testing and deployment

This log records how the project was actually built, including the wrong turns.

---

## 1. Pre-kickoff — pipeline rehearsal (throwaway repo)

Before the problem statement dropped, I used Claude to build and deploy a
minimal Next.js + Tailwind app to Vercel — purely to prove the GitHub → Vercel
pipeline worked end-to-end.

This surfaced three real failures that would have cost hours during the actual
build:
- Uploading a *folder* through GitHub's web UI nests everything one level deep,
  so `package.json` ends up where Vercel can't find it.
- Vercel had cached an "Output Directory: public" override from that broken
  first import, which then failed *after* a successful Next.js build.
- Redeploying from the Vercel UI silently rebuilt an old commit; the commit hash
  in the build log was the only way to catch it.

None of that code is in this repo. This project started from scratch after
kickoff. The rehearsal was about removing deployment risk, not writing code.

## 2. Track selection

I gave Claude all three problem statements and asked for a risk assessment
against my actual constraints (solo, limited hours, first hackathon of this
kind).

Claude recommended Problem Statement 2 over the other two:
- PS1 (autonomous creator) needs a scheduler, DB, and LLM key running unattended
  for the entire 48-hour judging window. A silent failure at 3am is unrecoverable
  and invisible until scoring.
- PS3 (redesign) is open-ended; polish ceiling is high but so is the time cost.
- PS2 is request/response — nothing to keep alive between evaluator calls.

I chose PS2.

## 3. Reading the data before designing

I had Claude inspect `curriculum.json` and `candidates.json` before writing any
code. That's where the core design idea came from: `attempts` distinguishes
candidates that `passed: true` alone flattens together. A candidate who needed 5
attempts and one who needed 1 are not the same interview.

This became the day-selection strategy — prioritise failed → skipped →
high-attempt → confident, spread across curriculum modules, always include one
confident topic so feedback has genuine strengths to cite.

## 4. Implementation

Claude wrote the initial `/api/interview` route: session state machine
(question → evaluate → followup → next day → feedback), prompt construction per
phase, and KV persistence.

## 5. Correction — switched LLM provider

The first implementation used the Claude API. I flagged that it requires paid
credits. Claude checked current pricing and confirmed Gemini's free tier needs
no credit card, never expires, and allows ~1,500 requests/day — far more than
this project needs. Claude migrated the SDK and call sites; the interview logic
was unchanged. Model choice was an implementation detail, not the design.

## 6. Correction — refactor for testability and robustness

The first version was a single route file that could only be tested by
deploying. Claude restructured it:

- `lib/interview-engine.js` — selection + prompts, pure functions, testable
  without an API key.
- `lib/gemini.js` — retry with exponential backoff on 429/503. The Gemini free
  tier is ~15 req/min; without retries a rate limit breaks an interview
  mid-conversation, which is the worst possible failure for this submission.
- `lib/session-store.js` — in-memory fallback when KV isn't configured, so
  `npm run dev` works with zero setup. Logs a loud warning because the fallback
  is unsafe in production serverless.
- Split the per-answer evaluation into its own model call. Asking for
  "evaluate and follow up" in one call produced follow-ups that ignored the
  evaluation entirely.
- `GET /api/interview` health check, so a deployment can be verified without
  spending an API call.

## 7. Verification

Claude wrote a script to run the day-selection logic against all 20 provided
candidate profiles. Result: 20/20 produce exactly 4 unique curriculum days, with
visibly different topic sets per candidate (verified by inspecting the output —
e.g. CAND-010 draws failed topics, CAND-014 draws skipped ones, CAND-003 draws
confident ones).

`scripts/test-interview.mjs` runs a full interview end-to-end against a live
server using deliberately varied answers — strong, vague, and an explicit
"I don't know" — to confirm follow-ups actually adapt to answer quality, and
asserts the spec requirements (done flag, ≥8 questions, all four feedback
fields populated).

## 8. Local testing and deployment

Moved to Claude Code (in Claude Desktop) to run the app locally against a real
Gemini key, iterate on interview quality with fast feedback instead of a
deploy-and-check loop, and handle git and Vercel deployment.

## 9. Local testing surfaced four real bugs

Running `scripts/test-interview.mjs` against a real Gemini key immediately
caught problems that never showed up reviewing the prompt logic in isolation,
because they only exist once real model calls are in the loop.

**Bug 1 — the hardcoded model was deprecated.** The default model
(`gemini-2.5-flash`, chosen when the project was first built) started
returning `404 "no longer available to new users"` against a freshly created
API key. Not a fluke: `gemini-2.5-flash-lite` was rejected the same way, and
`gemini-2.0-flash` had zero free-tier quota left for new keys. Diagnosed by
testing candidate model names directly against the API with a throwaway
script before touching app code, rather than guessing.

**Bug 2 — the "safe" replacement model had a 20-request/day cap.** Switched to
`gemini-flash-latest` (Google's self-updating alias) as the fix for Bug 1. It
resolved server-side to `gemini-3.6-flash`. The first full interview run
502'd partway through with a 429 whose `quotaId` was
`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, `limit: 20`. Twenty
requests a day isn't enough for even one interview (~17 Gemini calls per
session), let alone judges testing multiple candidates.

**Bug 3 — that same model leaked its own reasoning into candidate-facing
text.** Before the quota cap was diagnosed, a follow-up question came back as
`"sentence count: 2 sentences. * No preamble? Yes. * Pushes deeper on"` —
literally the model's self-check against the system prompt's style rules,
output instead of the question itself. A separate turn cut off mid-sentence
(`"...the 'lost in the middle' effect, where"`). Both are consistent with
`gemini-3.6-flash` spending part of its output-token budget on internal
"thinking" tokens not shown in the response text — a known behavior of
newer reasoning-enabled Gemini models, not a parsing bug in `askGemini`.
Fixed by switching to `gemini-flash-lite-latest` (resolves to
`gemini-3.5-flash-lite`), confirmed via the raw API response that
`usageMetadata` contains no `thoughtsTokenCount` and `finishReason` is
`STOP`, not `MAX_TOKENS`. Also hardened the system prompt and both
question-generation prompts to explicitly forbid self-checks, checklists, or
commentary in the output, as defense in depth in case a future model swap
reintroduces the behavior.

**Bug 4 — retry logic gave up faster than the quota needed to reset.** The
original retry loop used fixed exponential backoff (1s, 2s, 4s — ~7s total)
for every retryable error, including 429s. Google's error response includes
a `RetryInfo.retryDelay` (observed values across different failures: 30s,
6s, 0s) that has nothing to do with exponential-backoff timing. Rewrote
`askGemini` to parse `retryDelay` out of the error and wait that long
instead of guessing, capped so total retry time stays under ~45s (the route
sets `maxDuration = 60`). Also found that Google sometimes reports
`retryDelay: "0s"` while still inside the exceeded window — retrying
instantly on that hit the same 429 again — so the wait is floored at 3s
minimum.

Verified all four fixes by running full interviews for two candidates with
deliberately different cohort signals: CAND-001 (mixed attempts, senior data
engineer) and CAND-014 (mostly skipped missions, HR manager). Both completed
every spec check. The actual questions asked were visibly different per
candidate and contextualized to job role — e.g. CAND-014's questions
referenced HR-specific scenarios like payroll-vendor sync and executive
compensation data rather than generic ones — and follow-ups escalated into
harder territory after strong answers versus redirecting after weak ones,
confirming the evaluate-then-follow-up split described in CLAUDE.md is doing
real work, not just adding latency.
