import { useState } from 'react';

// Scripts may run inside the frame, but never with same-origin access to the app.
const SANDBOX = 'allow-scripts';

function svgPage(code) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}svg{max-width:100%;height:auto}</style></head><body>${code}</body></html>`;
}

/** A fenced html/svg block from a reply, rendered in a sandboxed frame. */
export function VisualBlock({ language, code }) {
  const [tall, setTall] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const srcDoc = language === 'svg' ? svgPage(code) : code;
  return (
    <div className="visual-block">
      <iframe
        title="Visual preview"
        sandbox={SANDBOX}
        srcDoc={srcDoc}
        className="visual-frame"
        style={{ height: tall ? 720 : 360 }}
      />
      <div className="visual-actions">
        <button type="button" className="visual-toggle" onClick={() => setTall((v) => !v)}>
          {tall ? 'Shorter' : 'Taller'}
        </button>
        <button type="button" className="visual-toggle" onClick={() => setShowCode((v) => !v)}>
          {showCode ? 'Hide code' : 'Show code'}
        </button>
      </div>
      {showCode && (
        <pre>
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

/** Frame for a created .html file served by the chat file route. */
export function FileFrame({ src, name }) {
  return <iframe title={`Preview of ${name}`} sandbox={SANDBOX} src={src} className="visual-frame" style={{ height: 360 }} />;
}
