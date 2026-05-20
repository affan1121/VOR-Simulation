import { useState } from 'react';

/**
 * Shown by default — many “sim won’t run” reports are from opening index.html
 * or expecting motion without the dev server.
 */
export function StartHere() {
  if (import.meta.env.PROD) return null;

  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn sm start-reopen" onClick={() => setOpen(true)}>
        How to run
      </button>
    );
  }
  return (
    <div className="card start-here">
      <div className="start-here-head">
        <h2>How to run the simulator</h2>
        <button type="button" className="btn sm" onClick={() => setOpen(false)} aria-label="Dismiss">
          Hide
        </button>
      </div>
      <ol className="start-steps">
        <li>
          Install{' '}
          <a href="https://nodejs.org" target="_blank" rel="noreferrer">
            Node.js
          </a>{' '}
          (includes <code>npm</code>).
        </li>
        <li>
          In a terminal, open this folder and run:
          <pre className="cmd">
            npm install{'\n'}
            npm run dev
          </pre>
        </li>
        <li>
          Open the URL Vite prints (usually <strong>http://localhost:5173</strong>). Use that link — do{' '}
          <strong>not</strong> double‑click <code>index.html</code> in Finder; the app will not load without the dev
          server.
        </li>
      </ol>
      <p className="start-tip">
        <strong>In the sim:</strong> the aircraft moves continuously. Adjust <strong>Heading</strong> and{' '}
        <strong>Speed</strong>. If nothing moves, click <strong>Play</strong> (you may have paused). You should see DME
        counting down when flying toward the VOR.
      </p>
    </div>
  );
}
