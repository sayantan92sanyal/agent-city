import { test, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Transcript } from './Transcript.jsx';

afterEach(cleanup);

const block = (lang, body) => [{ kind: 'assistant', text: '```' + lang + '\n' + body + '\n```' }];

test('html block renders a sandboxed iframe with code hidden until Show code', () => {
  render(<Transcript rows={block('html', '<b>hi</b>')} renderVisuals />);
  const frame = screen.getByTitle('Visual preview');
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
  expect(frame.getAttribute('srcdoc')).toBe('<b>hi</b>');
  expect(screen.queryByText('<b>hi</b>')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show code' }));
  expect(screen.getByText('<b>hi</b>')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Taller' }));
  expect(frame.style.height).toBe('720px');
});

test('svg is wrapped into a page', () => {
  render(<Transcript rows={block('svg', '<svg></svg>')} renderVisuals />);
  const doc = screen.getByTitle('Visual preview').getAttribute('srcdoc');
  expect(doc).toContain('<!doctype html>');
  expect(doc).toContain('<svg></svg>');
});

test('without renderVisuals the block stays code', () => {
  render(<Transcript rows={block('html', '<b>hi</b>')} />);
  expect(screen.queryByTitle('Visual preview')).toBeNull();
  expect(screen.getByText('<b>hi</b>')).toBeInTheDocument();
});

test('inline code stays inline with renderVisuals', () => {
  render(<Transcript rows={[{ kind: 'assistant', text: 'use `<b>` here' }]} renderVisuals />);
  expect(screen.queryByTitle('Visual preview')).toBeNull();
});

test('files rows render images and links', () => {
  const rows = [
    {
      kind: 'files',
      files: [
        { path: '/x/chart.png', name: 'chart.png', mediaType: 'image/png' },
        { path: '/x/plan.pdf', name: 'plan.pdf', mediaType: 'application/pdf' },
      ],
    },
  ];
  render(<Transcript rows={rows} fileUrl={(p) => `/f?p=${p}`} />);
  expect(screen.getByAltText('chart.png')).toHaveAttribute('src', '/f?p=/x/chart.png');
  expect(screen.getByRole('link', { name: 'plan.pdf' })).toHaveAttribute('href', '/f?p=/x/plan.pdf');
});

test('tool rows use friendly names for claude.ai connectors only', () => {
  const rows = [
    { kind: 'tool', text: '[used Google Calendar · list calendars]' },
    { kind: 'tool', text: '[used Bash]' },
  ];
  render(<Transcript rows={rows} />);
  expect(screen.getByText('Used Google Calendar · list calendars')).toBeInTheDocument();
  expect(screen.getByText('Used Bash')).toBeInTheDocument();
});
