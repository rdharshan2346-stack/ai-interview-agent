import { askGemini, askGeminiJSON } from '../../../lib/gemini';
import { getSession, setSession, isKvAvailable } from '../../../lib/session-store';
import {
  selectInterviewDays,
  buildSystemPrompt,
  openingQuestionPrompt,
  evaluationPrompt,
  followUpPrompt,
  feedbackPrompt,
  MIN_QUESTIONS,
} from '../../../lib/interview-engine';

export const runtime = 'nodejs';
export const maxDuration = 60; // generous ceiling; Gemini retries can take time

/**
 * POST /api/interview
 *
 * Two shapes, per the technical spec:
 *   Start:  { sessionId, candidate }  -> { reply, done: false }
 *   Turn:   { sessionId, message }    -> { reply, done: false }
 *   Final turn returns:                  { reply, done: true, feedback }
 *
 * STATE MACHINE
 *   question -> candidate answers -> evaluate -> followup
 *   followup -> candidate answers -> next day (question) OR feedback (done)
 */

function err(message, status = 400, extra = {}) {
  return Response.json({ error: message, ...extra }, { status });
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return err('Request body must be valid JSON.');
  }

  const { sessionId } = body || {};
  if (!sessionId || typeof sessionId !== 'string') {
    return err('sessionId is required and must be a string.');
  }

  let session;
  try {
    session = await getSession(sessionId);
  } catch (e) {
    console.error('[interview] session read failed:', e);
    return err('Could not read session state.', 500);
  }

  try {
    // ─────────────── START INTERVIEW ───────────────
    if (!session) {
      const candidate = body.candidate;
      if (!candidate || !candidate.member) {
        return err(
          'A candidate object (matching candidate.json) is required to start a session.'
        );
      }

      const days = selectInterviewDays(candidate);
      if (days.length === 0) {
        return err('This candidate has no missions matching the curriculum.');
      }

      const system = buildSystemPrompt(candidate, days);
      const question = await askGemini(system, openingQuestionPrompt(days[0], true));

      session = {
        candidate,
        days,
        dayIndex: 0,
        phase: 'question',
        questionCount: 1,
        history: [{ role: 'interviewer', content: question, day: days[0].day }],
        evaluations: [],
        startedAt: new Date().toISOString(),
      };
      await setSession(sessionId, session);

      const name = candidate.member.name || 'candidate';
      return Response.json({
        reply: `Welcome ${name}. Thanks for making time — this will be a short technical conversation about the work you did in the cohort. There are no trick questions; think out loud where it helps.\n\n${question}`,
        done: false,
      });
    }

    // ─────────────── ALREADY FINISHED ───────────────
    if (session.phase === 'done') {
      return Response.json({
        reply: 'Interview completed.',
        done: true,
        feedback: session.feedback || {},
      });
    }

    // ─────────────── ONGOING TURN ───────────────
    const { message } = body;
    if (typeof message !== 'string' || !message.trim()) {
      return err('message is required (non-empty string) for an ongoing interview turn.');
    }

    const day = session.days[session.dayIndex];
    const system = buildSystemPrompt(session.candidate, session.days);
    const lastQuestion =
      [...session.history].reverse().find((h) => h.role === 'interviewer')?.content || '';

    session.history.push({ role: 'candidate', content: message, day: day.day });

    // ── PHASE: question answered -> evaluate, then follow up ──
    if (session.phase === 'question') {
      const evaluation = await askGeminiJSON(
        system,
        evaluationPrompt(day, lastQuestion, message),
        { maxTokens: 300 }
      );

      // Evaluation is an internal aid — if it fails to parse we degrade
      // gracefully rather than breaking the candidate's interview.
      const safeEval = evaluation || {
        depth: 'surface',
        correct: null,
        observation: 'Evaluation unavailable for this answer.',
        followUpAngle: null,
      };

      session.evaluations.push({
        day: day.day,
        dayTitle: day.curriculum.title,
        depth: safeEval.depth,
        correct: safeEval.correct,
        observation: safeEval.observation,
      });

      const followup = await askGemini(system, followUpPrompt(day, message, safeEval));

      session.history.push({ role: 'interviewer', content: followup, day: day.day });
      session.phase = 'followup';
      session.questionCount += 1;
      await setSession(sessionId, session);

      return Response.json({ reply: followup, done: false });
    }

    // ── PHASE: follow-up answered -> next topic, or finish ──
    const evaluation = await askGeminiJSON(
      system,
      evaluationPrompt(day, lastQuestion, message),
      { maxTokens: 300 }
    );
    if (evaluation) {
      session.evaluations.push({
        day: day.day,
        dayTitle: day.curriculum.title,
        depth: evaluation.depth,
        correct: evaluation.correct,
        observation: evaluation.observation,
      });
    }

    session.dayIndex += 1;

    const moreDays = session.dayIndex < session.days.length;
    const hitMinimum = session.questionCount >= MIN_QUESTIONS;

    if (moreDays || !hitMinimum) {
      // Safety net: if we somehow ran out of days before hitting the required
      // question count, loop back rather than shipping a short interview.
      if (!moreDays) session.dayIndex = session.dayIndex % session.days.length;

      const nextDay = session.days[session.dayIndex];
      const question = await askGemini(system, openingQuestionPrompt(nextDay, false));

      session.history.push({ role: 'interviewer', content: question, day: nextDay.day });
      session.phase = 'question';
      session.questionCount += 1;
      await setSession(sessionId, session);

      return Response.json({ reply: question, done: false });
    }

    // ── FINAL: generate structured feedback ──
    const transcript = session.history
      .map((h) => `${h.role === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${h.content}`)
      .join('\n\n');

    const parsed = await askGeminiJSON(
      system,
      feedbackPrompt(session.candidate, session.days, transcript, session.evaluations),
      { maxTokens: 900 }
    );

    const feedback = {
      summary: parsed?.summary || 'Feedback could not be generated for this session.',
      strengths: Array.isArray(parsed?.strengths) ? parsed.strengths : [],
      gaps: Array.isArray(parsed?.gaps) ? parsed.gaps : [],
      next: Array.isArray(parsed?.next) ? parsed.next : [],
    };

    session.phase = 'done';
    session.feedback = feedback;
    session.completedAt = new Date().toISOString();
    await setSession(sessionId, session);

    return Response.json({ reply: 'Interview completed.', done: true, feedback });
  } catch (e) {
    console.error('[interview] unhandled error:', e);
    const isKeyError = String(e.message || '').includes('GEMINI_API_KEY');
    return err(
      isKeyError ? e.message : 'The interview agent hit an unexpected error.',
      isKeyError ? 500 : 502,
      { detail: String(e.message || e).slice(0, 200) }
    );
  }
}

// Lightweight health check — verify a deployment without burning an API call
// or starting a session. Visit /api/interview in a browser.
export async function GET() {
  return Response.json({
    status: 'ok',
    endpoint: 'POST /api/interview',
    kv: isKvAvailable() ? 'connected' : 'in-memory fallback',
    geminiKey: process.env.GEMINI_API_KEY ? 'set' : 'MISSING',
  });
}
