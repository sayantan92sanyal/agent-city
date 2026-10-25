/**
 * API client for the Chat view (Claude chats created in Agent City).
 * Every call throws the server's `{ error }` text (or a generic
 * "<label> failed: <status>") with the HTTP status on `.status`.
 */

async function responseError(res, label) {
  let detail = null;
  try {
    const body = await res.json();
    if (body && typeof body.error === 'string' && body.error) {
      detail = body.error;
    }
  } catch {
    // Non-JSON (or empty) error body: fall back to the generic message.
  }
  const error = new Error(detail ?? `${label} failed: ${res.status}`);
  error.status = res.status;
  return error;
}

async function request(label, url, { method = 'GET', body } = {}) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    throw await responseError(res, label);
  }
  return res.status === 204 ? undefined : res.json();
}

const chatPath = (id) => `/api/chats/${encodeURIComponent(id)}`;

/** @returns {Promise<Array<{id: string, title: string, updatedAt: string, running: boolean}>>} newest first */
export async function listChats() {
  const data = await request('listChats', '/api/chats');
  return data.chats;
}

/** Creates a chat (with the remembered settings unless `settings` is given). */
export async function createChat(settings) {
  const data = await request('createChat', '/api/chats', {
    method: 'POST',
    body: settings === undefined ? {} : { settings },
  });
  return data.chat;
}

/** @returns {Promise<{chat: Object, live: null | {userEntry: Object, events: Array, partialText: string}}>} */
export async function getChat(id) {
  const data = await request('getChat', chatPath(id));
  return { chat: data.chat, live: data.live ?? null };
}

/** @param {{settings?: Object, title?: string}} patch */
export async function updateChat(id, patch) {
  const data = await request('updateChat', chatPath(id), { method: 'PATCH', body: patch });
  return data.chat;
}

export async function deleteChat(id) {
  await request('deleteChat', chatPath(id), { method: 'DELETE' });
}

/** Starts a turn (202). Only the upload fields of each attachment are sent. */
export async function sendChatMessage(id, message, attachments = []) {
  const data = await request('sendChatMessage', `${chatPath(id)}/messages`, {
    method: 'POST',
    body: {
      message,
      attachments: (attachments ?? []).map(({ name, mediaType, data: base64 }) => ({ name, mediaType, data: base64 })),
    },
  });
  return data.chat;
}

/** @returns {Promise<boolean>} whether a live turn was stopped */
export async function stopChat(id) {
  const data = await request('stopChat', `${chatPath(id)}/stop`, { method: 'POST' });
  return data.stopped;
}

/** @returns {Promise<{settings: Object, models: Array<{value: string, label: string}>, efforts: Array}>} */
export async function fetchChatSettings() {
  return request('fetchChatSettings', '/api/chat/settings');
}

/** @returns {Promise<{connectors: Array, error: string|null}>} */
export async function fetchConnectors(fresh = false) {
  return request('fetchConnectors', fresh ? '/api/chat/connectors?fresh=1' : '/api/chat/connectors');
}

/** @returns {Promise<{path: string, parent: string|null, folders: Array, quickPicks: Array}>} */
export async function fetchFolders(path) {
  const url = path ? `/api/chat/folders?path=${encodeURIComponent(path)}` : '/api/chat/folders';
  return request('fetchFolders', url);
}

/** URL of a file Claude wrote or referenced in this chat. */
export function chatFileUrl(id, path) {
  return `${chatPath(id)}/file?path=${encodeURIComponent(path)}`;
}
