/**
 * End-to-end smoke test. Runs a full interview against a running server.
 *
 * Usage:
 *   1. npm run dev          (in one terminal)
 *   2. node scripts/test-interview.mjs            -> uses CAND-001
 *      node scripts/test-interview.mjs CAND-014   -> pick a specific candidate
 *      BASE=https://your.vercel.app node scripts/test-interview.mjs
 */
import { readFileSync } from 'fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const wantedId = process.argv[2] || 'CAND-001';

const { candidates } = JSON.parse(readFileSync(new URL('../lib/candidates.json', import.meta.url), 'utf8'));
const candidate = candidates.find((c) => c.member.id === wantedId);
if (!candidate) {
  console.error(`No candidate ${wantedId}. Available: ${candidates.map(c=>c.member.id).join(', ')}`);
  process.exit(1);
}

// Deliberately varied answers: strong, vague, and an outright "I don't know",
// so we can see whether follow-ups actually adapt to answer quality.
const ANSWERS = [
  "Embeddings map text into a vector space where semantic similarity becomes geometric distance, so we can retrieve by meaning rather than keyword overlap.",
  "Honestly I'm not sure about that one.",
  "You'd chunk the documents, embed each chunk, store them in a vector DB, then at query time embed the question and pull the top-k nearest chunks into the prompt.",
  "I think it just makes the answers better?",
  "Chunk size is the main trade-off — too small and you lose context, too large and you dilute the embedding and waste tokens.",
  "We used a system prompt with few-shot examples, and kept temperature low for consistency.",
  "Not something I've done in production, but I understand the concept.",
  "You'd want retries with backoff, structured output validation, and logging on every call so failures are visible.",
  "Probably monitoring and evals — that's where I'd invest first.",
  "I'd add tracing per request so you can replay a bad answer and see exactly which chunks were retrieved.",
];

const sessionId = `smoke-${Date.now()}`;
let turn = 0;

async function post(payload) {
  const res = await fetch(`${BASE}/api/interview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`\nHTTP ${res.status}:`, data);
    process.exit(1);
  }
  return data;
}

console.log(`\n=== Interview: ${candidate.member.name} (${candidate.member.jobRole}) ===\n`);

let data = await post({ sessionId, candidate });
console.log(`INTERVIEWER: ${data.reply}\n`);

let questionCount = 1;
while (!data.done && turn < ANSWERS.length) {
  const answer = ANSWERS[turn++];
  console.log(`CANDIDATE:   ${answer}\n`);
  data = await post({ sessionId, message: answer });
  if (!data.done) {
    questionCount++;
    console.log(`INTERVIEWER: ${data.reply}\n`);
  }
}

if (!data.done) {
  console.error('Interview did not complete within the scripted answers.');
  process.exit(1);
}

console.log('=== FEEDBACK ===');
console.log(JSON.stringify(data.feedback, null, 2));

const f = data.feedback;
const checks = [
  ['completed with done:true', data.done === true],
  ['asked >= 8 questions', questionCount >= 8],
  ['summary is non-empty', typeof f.summary === 'string' && f.summary.length > 20],
  ['strengths is a non-empty array', Array.isArray(f.strengths) && f.strengths.length > 0],
  ['gaps is a non-empty array', Array.isArray(f.gaps) && f.gaps.length > 0],
  ['next is a non-empty array', Array.isArray(f.next) && f.next.length > 0],
];
console.log('\n=== SPEC CHECKS ===');
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
}
console.log(`\nQuestions asked: ${questionCount}`);
process.exit(failed ? 1 : 0);
