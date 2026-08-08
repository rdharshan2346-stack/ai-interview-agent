import curriculum from './curriculum.json';

/**
 * INTERVIEW ENGINE
 *
 * Design goal: the interview must feel *earned* — shaped by what this specific
 * candidate actually did in the cohort — not a generic question list with a
 * name swapped in.
 */

export const QUESTIONS_PER_DAY = 2; // opening + follow-up
export const TARGET_DAYS = 4;       // spec requires >= 4 distinct curriculum days
export const MIN_QUESTIONS = 8;     // spec requires >= 8 questions

export function getDay(dayNum) {
  return curriculum.days.find((d) => d.day === dayNum) || null;
}

export function getModuleForDay(dayNum) {
  return (
    curriculum.modules.find((m) => dayNum >= m.days[0] && dayNum <= m.days[1]) || null
  );
}

/**
 * Classify a mission into a signal bucket.
 *
 * WHY: attempts count is the most honest signal in the dataset. Someone who
 * passed on attempt 5 does not understand the topic the way someone who passed
 * on attempt 1 does — but both show up as "passed: true". A naive agent treats
 * them identically. Ours doesn't.
 */
export function classifyMission(mission) {
  if (mission.skipped) return 'skipped';
  if (mission.passed === false) return 'failed';
  const attempts = mission.attempts || 1;
  if (attempts >= 4) return 'struggled_hard';
  if (attempts >= 2) return 'struggled_mild';
  return 'confident';
}

const PRIORITY = {
  failed: 0,          // highest priority — they didn't pass it
  skipped: 1,         // never attempted; did they learn it anyway?
  struggled_hard: 2,  // passed, but barely
  struggled_mild: 3,
  confident: 4,       // verify depth, not existence, of knowledge
};

/**
 * Select which curriculum days to interview on.
 *
 * Strategy: lead with weak areas (that's where a real interviewer probes), but
 * always include at least one confident topic so the candidate gets a fair
 * chance to demonstrate strength — and so feedback has something to praise
 * that isn't hollow.
 */
export function selectInterviewDays(candidate) {
  const missions = (candidate.missions || [])
    .map((m) => ({ ...m, signal: classifyMission(m), curriculum: getDay(m.day) }))
    .filter((m) => m.curriculum); // drop anything not in the curriculum

  if (missions.length === 0) return [];

  const sorted = [...missions].sort((a, b) => {
    const p = PRIORITY[a.signal] - PRIORITY[b.signal];
    if (p !== 0) return p;
    return (b.attempts || 0) - (a.attempts || 0);
  });

  const picked = [];
  const usedDays = new Set();
  const usedModules = new Set();

  // Pass 1: prioritise weak signals, but spread across modules so we don't
  // ask four questions about the same corner of the syllabus.
  for (const m of sorted) {
    if (picked.length >= TARGET_DAYS - 1) break;
    const mod = getModuleForDay(m.day);
    const modKey = mod ? mod.n : `day-${m.day}`;
    if (usedModules.has(modKey)) continue;
    picked.push(m);
    usedDays.add(m.day);
    usedModules.add(modKey);
  }

  // Pass 2: guarantee at least one topic they were confident on.
  const confident = sorted.find((m) => m.signal === 'confident' && !usedDays.has(m.day));
  if (confident && picked.length < TARGET_DAYS) {
    picked.push(confident);
    usedDays.add(confident.day);
  }

  // Pass 3: backfill to TARGET_DAYS if module-spreading left us short.
  for (const m of sorted) {
    if (picked.length >= TARGET_DAYS) break;
    if (usedDays.has(m.day)) continue;
    picked.push(m);
    usedDays.add(m.day);
  }

  return picked.slice(0, TARGET_DAYS);
}

/**
 * Build the interviewer persona. Kept in one place so voice stays consistent
 * across opening questions, follow-ups, transitions, and final feedback.
 */
export function buildSystemPrompt(candidate, days) {
  const m = candidate.member || {};
  const experienceNote =
    (m.yearsExperience ?? 0) >= 8
      ? 'This is a senior candidate — do not ask beginner definitional questions; probe architecture, trade-offs, and failure modes.'
      : (m.yearsExperience ?? 0) <= 1
        ? 'This is a junior candidate — probe fundamentals and reasoning rather than production-scale architecture.'
        : 'This is a mid-level candidate — balance fundamentals with practical application.';

  return `You are a senior AI engineer conducting a technical interview for a graduate of a 31-day enterprise AI engineering cohort.

CANDIDATE
Name: ${m.name || 'Unknown'}
Role: ${m.jobRole || 'Unknown'}
Experience: ${m.yearsExperience ?? '?'} years
Education: ${m.education || 'Unknown'}
${experienceNote}

INTERVIEW SCOPE (${days.length} topics)
${days
  .map((d, i) => {
    const mod = getModuleForDay(d.day);
    return `${i + 1}. Day ${d.day} — ${d.curriculum.title}${mod ? ` (Module ${mod.n}: ${mod.title})` : ''} [cohort signal: ${d.signal}]`;
  })
  .join('\n')}

INTERVIEWER STYLE
- Direct, curious, professional. A real engineer talking shop, not a quiz bot.
- ONE question per turn. 1-3 sentences. No preamble, no meta-commentary.
- Never say "Great question" or restate their answer back to them.
- Never reveal the cohort signals above, their attempt counts, or that some
  topics were skipped. That data shapes what you ask — never what you say.
- Ask about reasoning and trade-offs, not memorised definitions.
- Your entire output is spoken aloud to the candidate as-is. Never include
  self-checks, checklists, word/sentence counts, or notes about whether you
  followed these instructions — only the question itself.`;
}

/**
 * Prompt for the opening question on a topic.
 * The cohort signal changes the ANGLE of the question, not its difficulty
 * alone — that's what makes this adaptive rather than just "easier/harder".
 */
export function openingQuestionPrompt(day, isFirst) {
  const angle = {
    failed: `The candidate did not pass this mission. Ask a foundational question that lets them show whether they've since understood the core idea. Be fair, not punitive.`,
    skipped: `The candidate skipped this topic entirely in the cohort. Ask a question that reveals whether they picked it up through work experience or self-study.`,
    struggled_hard: `The candidate needed ${day.attempts} attempts to pass this. Probe the underlying concept, not the surface API.`,
    struggled_mild: `The candidate needed ${day.attempts} attempts. Ask something that separates real understanding from pattern-matching.`,
    confident: `The candidate passed this on the first attempt. Don't ask an easy question — probe depth: a trade-off, an edge case, or a failure mode.`,
  }[day.signal];

  return `Ask the ${isFirst ? 'opening' : 'next'} question of the interview, on Day ${day.day}: "${day.curriculum.title}".

Learning objectives for this day:
${day.curriculum.objectives.map((o) => `- ${o}`).join('\n')}
Tools covered: ${(day.curriculum.tools || []).join(', ') || 'n/a'}

Guidance: ${angle}

${isFirst ? 'Do not greet them or explain the interview format — the system already did that.' : 'Briefly acknowledge their previous answer in at most one short clause, then ask the new question.'}
Output ONLY the question itself — no analysis, checklist, or commentary.`;
}

/**
 * Evaluate an answer BEFORE writing the follow-up.
 *
 * WHY A SEPARATE STEP: asking the model to "evaluate and then ask a follow-up"
 * in one call produces follow-ups that ignore the evaluation. Splitting them
 * means the follow-up is genuinely conditioned on a judgement, and it gives us
 * structured per-answer evidence to ground the final feedback in — instead of
 * the model inventing a summary from vibes at the end.
 */
export function evaluationPrompt(day, question, answer) {
  return `The candidate was asked, about Day ${day.day} ("${day.curriculum.title}"):
"${question}"

They answered:
"${answer}"

Evaluate strictly but fairly. Respond with ONLY raw JSON, no markdown fences:
{
  "depth": "none" | "surface" | "solid" | "expert",
  "correct": true | false,
  "observation": "one sentence on what this answer reveals about their understanding",
  "followUpAngle": "the single most revealing thing to probe next, given this answer"
}

Note: "none" means they deflected, said they don't know, or answered something unrelated.`;
}

export function followUpPrompt(day, answer, evaluation) {
  const angle =
    evaluation?.followUpAngle ||
    'probe the reasoning behind their answer, or an edge case they did not consider';

  const depthNote = {
    none: 'They did not really answer. Do NOT repeat the question. Ask a simpler, more concrete question on the same topic to find the edge of what they do know.',
    surface: 'The answer was shallow. Push one level deeper into the mechanism or the why.',
    solid: 'A good answer. Push into a trade-off, edge case, or failure mode to find their ceiling.',
    expert: 'A strong answer. Ask something genuinely hard — a design decision under constraints.',
  }[evaluation?.depth || 'surface'];

  return `The candidate just answered your question about Day ${day.day} ("${day.curriculum.title}") with:
"${answer}"

${depthNote}
Specifically probe: ${angle}

Ask ONE follow-up question, directly, with no preamble. Output ONLY the question text itself — no analysis, checklist, or commentary about the question.`;
}

export function feedbackPrompt(candidate, days, transcript, evaluations) {
  const evidence = evaluations
    .map(
      (e, i) =>
        `${i + 1}. Day ${e.day} (${e.dayTitle}) — depth: ${e.depth}, correct: ${e.correct}. ${e.observation}`
    )
    .join('\n');

  return `Interview complete for ${candidate.member?.name || 'the candidate'} (${candidate.member?.jobRole || 'unknown role'}).

PER-ANSWER EVIDENCE COLLECTED DURING THE INTERVIEW:
${evidence}

FULL TRANSCRIPT:
${transcript}

Write final feedback grounded in the evidence above — cite specific topics, never generic filler like "keep practising".

Respond with ONLY raw JSON, no markdown fences:
{
  "summary": "2-3 sentences: overall assessment and readiness level",
  "strengths": ["2-4 short, specific strings — name the actual topic"],
  "gaps": ["2-4 short, specific strings — name the actual topic"],
  "next": ["2-4 short, concrete, actionable recommendations"]
}`;
}
