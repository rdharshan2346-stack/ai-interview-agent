import './globals.css';

export const metadata = {
  title: 'AI Interview Agent — ABTalks Vibe Code Hackathon',
  description: 'Adaptive technical interview agent built with Claude.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
