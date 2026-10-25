import { isValidElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { VisualBlock } from './VisualBlock.jsx';
import { WeatherCard, parseWeather } from './WeatherCard.jsx';

// Links open in a new tab so the chat panel stays put.
const COMPONENTS = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
  table: ({ node: _node, ...props }) => (
    <div className="md-table-wrap">
      <table {...props} />
    </div>
  ),
};

const VISUAL_COMPONENTS = {
  ...COMPONENTS,
  // Fenced html/svg blocks become sandboxed visuals; inline code never reaches `pre`.
  pre: ({ node: _node, children, ...props }) => {
    const code = isValidElement(children) ? children : null;
    if (/language-weather\b/.test(code?.props?.className ?? '')) {
      const weather = parseWeather(String(code.props.children ?? ''));
      if (weather) return <WeatherCard weather={weather} />;
    }
    const language = /language-(html|svg)\b/.exec(code?.props?.className ?? '')?.[1];
    if (language) {
      return <VisualBlock language={language} code={String(code.props.children ?? '').replace(/\n$/, '')} />;
    }
    return <pre {...props}>{children}</pre>;
  },
};

/**
 * Renders an agent reply as formatted Markdown (GitHub flavour: tables,
 * task lists, strikethrough). Raw HTML in the text is shown as text, never
 * injected. With `renderVisuals`, fenced html/svg blocks render in a
 * sandboxed frame.
 */
export function Markdown({ text, renderVisuals = false }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={renderVisuals ? VISUAL_COMPONENTS : COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
