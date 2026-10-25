import { test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DeletePlaygroundDialog } from './DeletePlaygroundDialog.jsx';
import * as api from '../api.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const project = { projectPath: '/Users/me/Documents/article-authoring', projectName: 'article-authoring', agents: [{}, {}] };

test('says the whole folder goes to the Trash, then deletes on confirm', async () => {
  const spy = vi.spyOn(api, 'deletePlayground').mockResolvedValue({ trashedTo: '/Users/me/.Trash/article-authoring' });
  const onDeleted = vi.fn();
  render(<DeletePlaygroundDialog project={project} onDeleted={onDeleted} onCancel={() => {}} />);
  expect(screen.getByRole('dialog')).toHaveTextContent('The whole folder and everything in it, not just its 2 agents');
  fireEvent.click(screen.getByRole('button', { name: 'MOVE FOLDER TO TRASH' }));
  await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledWith(project));
  expect(spy).toHaveBeenCalledWith(project.projectPath);
});

test('shows why a delete was refused', async () => {
  vi.spyOn(api, 'deletePlayground').mockRejectedValue(new Error('This folder holds Agent City itself'));
  render(<DeletePlaygroundDialog project={project} onDeleted={() => {}} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'MOVE FOLDER TO TRASH' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('holds Agent City itself');
});
