'use client';

import { useState } from 'react';
import candidatesData from '../../lib/candidates.json';

function newSessionId() {
  return 'test-' + Math.random().toString(36).slice(2, 10);
}

export default function TestPage() {
  const candidates = candidatesData.candidates;
  const [candidateId, setCandidateId] = useState(candidates[0].member.id);
  const [sessionId, setSessionId] = useState(null);
  const [log, setLog] = useState([]);
  const [input, setInput] = useState('');
  const [done, setDone] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(false);

  async function call(body) {
    setLoading(true);
    try {
      const res = await fetch('/api/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return data;
    } finally {
      setLoading(false);
    }
  }

  async function start() {
    const candidate = candidates.find((c) => c.member.id === candidateId);
    const sid = newSessionId();
    setSessionId(sid);
    setLog([]);
    setDone(false);
    setFeedback(null);
    const data = await call({ sessionId: sid, candidate });
    setLog([{ role: 'interviewer', text: data.reply }]);
  }

  async function send() {
    if (!input.trim() || !sessionId) return;
    const myMsg = input;
    setInput('');
    setLog((l) => [...l, { role: 'candidate', text: myMsg }]);
    const data = await call({ sessionId, message: myMsg });
    setLog((l) => [...l, { role: 'interviewer', text: data.reply }]);
    if (data.done) {
      setDone(true);
      setFeedback(data.feedback);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-1">Interview Agent — Test Console</h1>
        <p className="text-slate-400 text-sm mb-6">
          Manual test UI, calls /api/interview directly. Not part of the submission spec.
        </p>

        <div className="flex gap-2 mb-6">
          <select
            className="bg-slate-900 border border-slate-700 rounded px-3 py-2 flex-1"
            value={candidateId}
            onChange={(e) => setCandidateId(e.target.value)}
          >
            {candidates.map((c) => (
              <option key={c.member.id} value={c.member.id}>
                {c.member.name} — {c.member.jobRole}
              </option>
            ))}
          </select>
          <button
            onClick={start}
            disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded px-4 py-2 font-medium"
          >
            Start Interview
          </button>
        </div>

        <div className="space-y-3 mb-4">
          {log.map((entry, i) => (
            <div
              key={i}
              className={`p-3 rounded-lg whitespace-pre-wrap text-sm ${
                entry.role === 'interviewer'
                  ? 'bg-slate-900 border border-slate-700'
                  : 'bg-emerald-950 border border-emerald-800 ml-8'
              }`}
            >
              <span className="text-xs uppercase tracking-wide text-slate-500 block mb-1">
                {entry.role}
              </span>
              {entry.text}
            </div>
          ))}
          {loading && <div className="text-slate-500 text-sm">thinking…</div>}
        </div>

        {feedback && (
          <div className="bg-slate-900 border border-emerald-700 rounded-lg p-4 mb-4">
            <h2 className="font-bold mb-2 text-emerald-400">Final Feedback</h2>
            <p className="text-sm mb-3">{feedback.summary}</p>
            <div className="grid grid-cols-1 gap-3 text-sm">
              <div>
                <p className="text-slate-400 mb-1">Strengths</p>
                <ul className="list-disc list-inside">
                  {(feedback.strengths || []).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
              <div>
                <p className="text-slate-400 mb-1">Gaps</p>
                <ul className="list-disc list-inside">
                  {(feedback.gaps || []).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
              <div>
                <p className="text-slate-400 mb-1">Next steps</p>
                <ul className="list-disc list-inside">
                  {(feedback.next || []).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}

        {sessionId && !done && (
          <div className="flex gap-2">
            <input
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 flex-1"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Type your answer…"
            />
            <button
              onClick={send}
              disabled={loading}
              className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded px-4 py-2"
            >
              Send
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
