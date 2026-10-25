import { test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Transcript } from './Transcript.jsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('replies render as Markdown: bold, lists and tables', () => {
  const text = '**Verdict:** wait\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |';
  render(<Transcript rows={[{ kind: 'assistant', text }]} />);
  expect(screen.getByText('Verdict:').tagName).toBe('STRONG');
  expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(expect.arrayContaining(['one', 'two']));
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'A' })).toBeInTheDocument();
  expect(screen.queryByText(/\*\*/)).toBeNull();
});

test('raw HTML in a reply is shown as text, not injected', () => {
  const { container } = render(<Transcript rows={[{ kind: 'assistant', text: '<img src=x onerror=alert(1)>' }]} />);
  expect(container.querySelector('img')).toBeNull();
});

test('user text stays literal, and attached images show as thumbnails', () => {
  render(
    <Transcript
      rows={[{ kind: 'user', text: '**not bold**', attachments: [{ id: 'abc', name: 'shot.png', mediaType: 'image/png' }] }]}
    />
  );
  expect(screen.getByText('**not bold**')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'shot.png' })).toHaveAttribute('src', '/api/attachments/abc');
});

test('non-image attachments show as a named file chip', () => {
  render(<Transcript rows={[{ kind: 'user', text: '', attachments: [{ id: 'p', name: 'plan.pdf', mediaType: 'application/pdf' }] }]} />);
  expect(screen.getByText('plan.pdf')).toBeInTheDocument();
});

test('the assistant label is configurable (MAYOR) and the status line shows', () => {
  render(<Transcript rows={[{ kind: 'assistant', text: 'hi' }]} assistantLabel="MAYOR" statusText="Working…" />);
  expect(screen.getByText('MAYOR')).toBeInTheDocument();
  expect(screen.getByText('Working…')).toBeInTheDocument();
});

test('tool use is a single quiet line without a speaker label', () => {
  const { container } = render(<Transcript rows={[{ kind: 'tool', text: '[used Bash, Read]' }]} />);
  expect(screen.getByText('Used Bash, Read')).toBeInTheDocument();
  expect(container.querySelector('.transcript-speaker')).toBeNull();
});

test('streamingText renders as an extra Markdown reply before the status line', () => {
  render(
    <Transcript rows={[{ kind: 'user', text: 'hi' }]} assistantLabel="Claude" streamingText="**Hel**" statusText="Working…" />
  );
  const entries = screen.getAllByRole('listitem');
  const streaming = entries.find((li) => li.classList.contains('transcript-streaming'));
  expect(streaming).toHaveClass('transcript-assistant');
  expect(streaming).toHaveTextContent('Claude');
  expect(screen.getByText('Hel').tagName).toBe('STRONG');
  expect(entries.indexOf(streaming)).toBeLessThan(entries.findIndex((li) => li.textContent === 'Working…'));
});

test('without streamingText no extra row is rendered', () => {
  const { container } = render(<Transcript rows={[]} />);
  expect(container.querySelector('.transcript-streaming')).toBeNull();
});

test('the streaming row never renders visuals', () => {
  const text = '```html\n<p>half';
  const { container } = render(<Transcript rows={[]} renderVisuals streamingText={text} />);
  expect(container.querySelector('iframe')).toBeNull();
});

const imageRow = { kind: 'files', files: [{ path: '/x/a.png', name: 'a.png', mediaType: 'image/png' }] };

function mockScroll() {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  return scroll;
}

test('followMedia re-scrolls when an image loads while at the bottom', () => {
  const scroll = mockScroll();
  render(<Transcript rows={[imageRow]} fileUrl={(p) => p} followMedia testId="t" />);
  scroll.mockClear();
  fireEvent.load(screen.getByRole('img', { name: 'a.png' }));
  expect(scroll).toHaveBeenCalledTimes(1);
});

test('followMedia leaves the scroll alone when the reader scrolled up', () => {
  const scroll = mockScroll();
  render(<Transcript rows={[imageRow]} fileUrl={(p) => p} followMedia testId="t" />);
  const list = screen.getByTestId('t');
  Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 });
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: 300 });
  list.scrollTop = 100;
  fireEvent.scroll(list);
  scroll.mockClear();
  fireEvent.load(screen.getByRole('img', { name: 'a.png' }));
  expect(scroll).not.toHaveBeenCalled();
});

test('without followMedia an image load does not scroll', () => {
  const scroll = mockScroll();
  render(<Transcript rows={[imageRow]} fileUrl={(p) => p} />);
  scroll.mockClear();
  fireEvent.load(screen.getByRole('img', { name: 'a.png' }));
  expect(scroll).not.toHaveBeenCalled();
});
