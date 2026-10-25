import { test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, createEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Composer } from './Composer.jsx';

afterEach(cleanup);

const png = () => new File(['PNG'], 'shot.png', { type: 'image/png' });

test('Enter sends the trimmed text; Shift+Enter does not', async () => {
  const onSubmit = vi.fn().mockResolvedValue(true);
  render(<Composer id="c" label="Message" onSubmit={onSubmit} />);
  const box = screen.getByLabelText('Message');
  fireEvent.change(box, { target: { value: '  hello  ' } });
  fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(onSubmit).toHaveBeenCalledWith('hello', []);
  await waitFor(() => expect(box).toHaveValue(''));
});

test('a failed send (false) gives the draft back', async () => {
  const onSubmit = vi.fn().mockResolvedValue(false);
  render(<Composer id="c" label="Message" onSubmit={onSubmit} />);
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'retry me' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue('retry me'));
});

test('picked files show as removable chips and are sent as base64 attachments', async () => {
  const onSubmit = vi.fn().mockResolvedValue(true);
  render(<Composer id="c" label="Message" onSubmit={onSubmit} />);
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

  fireEvent.change(screen.getByTestId('c-files'), { target: { files: [png()] } });
  await screen.findByText('shot.png');
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  const [text, attachments] = onSubmit.mock.calls[0];
  expect(text).toBe('');
  expect(attachments).toEqual([
    expect.objectContaining({ name: 'shot.png', mediaType: 'image/png', data: btoa('PNG'), previewUrl: expect.stringMatching(/^data:image\/png;base64,/) }),
  ]);
});

test('a chip can be removed before sending', async () => {
  render(<Composer id="c" label="Message" onSubmit={vi.fn()} />);
  fireEvent.change(screen.getByTestId('c-files'), { target: { files: [png()] } });
  fireEvent.click(await screen.findByRole('button', { name: 'Remove shot.png' }));
  expect(screen.queryByText('shot.png')).toBeNull();
});

test('pasting a screenshot attaches it', async () => {
  render(<Composer id="c" label="Message" onSubmit={vi.fn()} />);
  const box = screen.getByLabelText('Message');
  // jsdom does not carry clipboardData through event init, so set it directly.
  const event = createEvent.paste(box);
  Object.defineProperty(event, 'clipboardData', {
    value: { files: [new File(['PNG'], 'image.png', { type: 'image/png' })] },
  });
  fireEvent(box, event);
  expect(await screen.findByText(/^screenshot-\d+\.png$/)).toBeInTheDocument();
});

test('any file type can be attached, including Word documents', async () => {
  render(<Composer id="c" label="Message" onSubmit={vi.fn()} />);
  expect(screen.getByTestId('c-files')).not.toHaveAttribute('accept');
  fireEvent.change(screen.getByTestId('c-files'), {
    target: {
      files: [
        new File(['DOC'], 'plan.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
        new File(['ZIP'], 'data.zip', { type: 'application/zip' }),
      ],
    },
  });
  expect(await screen.findByText('plan.docx')).toBeInTheDocument();
  expect(screen.getByText('data.zip')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('files over the size limit are refused with a reason', async () => {
  render(<Composer id="c" label="Message" onSubmit={vi.fn()} />);
  const big = new File(['x'], 'video.mov', { type: 'video/quicktime' });
  Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
  fireEvent.change(screen.getByTestId('c-files'), { target: { files: [big] } });
  expect(await screen.findByRole('alert')).toHaveTextContent(/"video\.mov" is over 25 MB/);
});

test('with onStop, a Stop button replaces Send', () => {
  const onStop = vi.fn();
  const { rerender } = render(<Composer id="c" label="Message" onSubmit={vi.fn()} onStop={onStop} />);
  expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  const stop = screen.getByRole('button', { name: 'Stop' });
  expect(stop).toHaveAttribute('type', 'button');
  fireEvent.click(stop);
  expect(onStop).toHaveBeenCalled();
  rerender(<Composer id="c" label="Message" onSubmit={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
});
