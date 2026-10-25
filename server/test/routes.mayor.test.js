import { beforeEach, expect, test, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/mayor/mayorSession.js', () => ({
  sendToMayor: vi.fn(),
  loadMayorTranscript: vi.fn(),
}));

const { sendToMayor, loadMayorTranscript } = await import('../src/mayor/mayorSession.js');
const { AlreadyRunningError } = await import('../src/sessionManager.js');
const { createApp } = await import('../src/app.js');
const app = createApp({ hostCheck: false });

beforeEach(() => vi.clearAllMocks());

test('GET returns transcript', async () => {
  loadMayorTranscript.mockReturnValue([{ type: 'x' }]);
  const res = await request(app).get('/api/mayor/chat');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ transcript: [{ type: 'x' }] });
});

test('POST 400 on blank message', async () => {
  const res = await request(app).post('/api/mayor/chat').send({ message: '  ' });
  expect(res.status).toBe(400);
  expect(sendToMayor).not.toHaveBeenCalled();
});

test('POST 409 when already running', async () => {
  sendToMayor.mockRejectedValue(new AlreadyRunningError('mayor'));
  const res = await request(app).post('/api/mayor/chat').send({ message: 'hi' });
  expect(res.status).toBe(409);
});

test('POST 200 returns transcript', async () => {
  sendToMayor.mockResolvedValue([{ type: 'y' }]);
  const res = await request(app).post('/api/mayor/chat').send({ message: 'hi' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ transcript: [{ type: 'y' }] });
  expect(sendToMayor).toHaveBeenCalledWith('hi', []);
});
