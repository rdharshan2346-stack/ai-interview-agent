export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 text-white px-6">
      <div className="max-w-xl text-center">
        <p className="text-sm uppercase tracking-widest text-slate-400 mb-3">
          ABTalks Vibe Code Hackathon
        </p>
        <h1 className="text-3xl md:text-5xl font-bold mb-4">AI Interview Agent</h1>
        <p className="text-slate-400 text-lg mb-6">
          Adaptive technical interviews for AI Cohort graduates — built on Claude.
        </p>
        <code className="block bg-slate-900 rounded-lg p-4 text-left text-sm text-emerald-400 overflow-x-auto">
          POST /api/interview
        </code>
      </div>
    </main>
  );
}
