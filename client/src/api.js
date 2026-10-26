/**
 * API client for the Agent Control Panel backend.
 */

/**
 * Builds the Error thrown for a non-OK response. Uses the server's own
 * `{ error: "..." }` body text when there is one (so the UI shows the real
 * reason, e.g. "message must be a non-empty string"), falling back to a
 * generic "<label> failed: <status>". The HTTP status is kept on `.status`.
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

/**
 * JSON body for a message, adding only the upload fields of any attachments
 * (`{ name, mediaType, data }`) — previews stay in the browser.
 */
function messageBody(message, attachments) {
  const body = { message };
  if (attachments?.length) {
    body.attachments = attachments.map(({ name, mediaType, data }) => ({ name, mediaType, data }));
  }
  return JSON.stringify(body);
}

/**
 * Fetch the list of projects and their agents.
 * @returns {Promise<Array<{projectPath: string, projectName: string, agents: Array<Object>}>>}
 */
export async function fetchAgents() {
  const res = await fetch('/api/agents');
  if (!res.ok) {
    throw await responseError(res, 'fetchAgents');
  }
  const data = await res.json();
  return data.projects;
}

/**
 * Create a new agent in a project.
 * @param {string} projectPath
 * @param {{name: string, model: string, description: string, tools?: string[]}} agent
 * @returns {Promise<Object>}
 */
export async function createAgent(projectPath, { name, model, description, tools, instructions }) {
  const res = await fetch('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath, name, model, description, tools, instructions }),
  });
  if (!res.ok) {
    throw await responseError(res, 'createAgent');
  }
  const data = await res.json();
  return data.agent;
}

/**
 * Ask Claude to turn a brief (and, when improving, the agent's current
 * instructions and tools) into a description, instructions and tools.
 * @returns {Promise<{description: string, instructions: string, tools: string[]}>}
 */
export async function draftAgent({ name, brief, current }) {
  const res = await fetch('/api/agents/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, brief, current }),
  });
  if (!res.ok) {
    throw await responseError(res, 'draftAgent');
  }
  return (await res.json()).draft;
}

/** Save a reviewed description, instructions and tools over an agent's file. */
export async function saveAgentDefinition(agentId, { description, instructions, tools }) {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/definition`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, instructions, tools }),
  });
  if (!res.ok) {
    throw await responseError(res, 'saveAgentDefinition');
  }
  return (await res.json()).agent;
}

/** Move an agent's file to the Trash. */
export async function deleteAgent(agentId) {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
  if (!res.ok) {
    throw await responseError(res, 'deleteAgent');
  }
  return res.json();
}

/** Move a playground's whole folder to the Trash. */
export async function deletePlayground(projectPath) {
  const res = await fetch('/api/playgrounds', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath }),
  });
  if (!res.ok) {
    throw await responseError(res, 'deletePlayground');
  }
  return res.json();
}

/**
 * Fetch the standing chat for an agent: its stored transcript, plus the
 * user's message for a turn still running (`pending`, else null).
 * @param {string} agentId
 * @returns {Promise<{transcript: Array<Object>, pending: Object|null}>}
 */
export async function fetchChat(agentId) {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/chat`);
  if (!res.ok) {
    throw await responseError(res, 'fetchChat');
  }
  const data = await res.json();
  return { transcript: data.transcript ?? [], pending: data.pending ?? null };
}

/**
 * Send a message to an agent's standing chat and get back the full,
 * updated transcript. Rejects with an Error whose `status` is 409 when a
 * turn is already running for this agent.
 * @param {string} agentId
 * @param {string} message
 * @param {Array<{name: string, mediaType: string, data: string}>} [attachments]
 * @returns {Promise<Array<Object>>}
 */
export async function sendChat(agentId, message, attachments) {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: messageBody(message, attachments),
  });
  if (!res.ok) {
    throw await responseError(res, 'sendChat');
  }
  const data = await res.json();
  return data.transcript;
}

/**
 * Fetch the configured project root folders.
 * @returns {Promise<string[]>}
 */
export async function fetchRoots() {
  const res = await fetch('/api/config/roots');
  if (!res.ok) {
    throw await responseError(res, 'fetchRoots');
  }
  const data = await res.json();
  return data.roots;
}

/**
 * Save the configured project root folders.
 * @param {string[]} roots
 * @returns {Promise<string[]>}
 */
export async function saveRoots(roots) {
  const res = await fetch('/api/config/roots', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roots }),
  });
  if (!res.ok) {
    throw await responseError(res, 'saveRoots');
  }
  const data = await res.json();
  return data.roots;
}

/**
 * Start a one-off task for an agent. Answers at once with the `running`
 * task; its result is saved on the server, so poll `fetchTask` for it.
 * @param {string} agentId
 * @param {string} message
 * @param {Array<{name: string, mediaType: string, data: string}>} [attachments]
 * @returns {Promise<Object>}
 */
export async function startTask(agentId, message, attachments) {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: messageBody(message, attachments),
  });
  if (!res.ok) {
    throw await responseError(res, 'startTask');
  }
  const data = await res.json();
  return data.task;
}

/**
 * An agent's recent tasks, newest first (without transcripts).
 * @param {string} agentId
 * @returns {Promise<Array<Object>>}
 */
export async function fetchTasks(agentId) {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/tasks`);
  if (!res.ok) {
    throw await responseError(res, 'fetchTasks');
  }
  const data = await res.json();
  return data.tasks;
}

/**
 * One task with its transcript once finished.
 * @param {string} taskId
 * @returns {Promise<Object>}
 */
export async function fetchTask(taskId) {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`);
  if (!res.ok) {
    throw await responseError(res, 'fetchTask');
  }
  const data = await res.json();
  return data.task;
}

/**
 * Send a follow-up to a finished task. Answers at once with the task running
 * again; poll `fetchTask` for the reply.
 * @param {string} taskId
 * @param {string} message
 * @param {Array<{name: string, mediaType: string, data: string}>} [attachments]
 * @returns {Promise<Object>}
 */
export async function sendTaskFollowUp(taskId, message, attachments) {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: messageBody(message, attachments),
  });
  if (!res.ok) {
    throw await responseError(res, 'sendTaskFollowUp');
  }
  const data = await res.json();
  return data.task;
}

/**
 * Mark a finished task's result as read (clears its DONE flag on the map).
 * @param {string} taskId
 */
export async function markTaskSeen(taskId) {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/seen`, { method: 'POST' });
  if (!res.ok) {
    throw await responseError(res, 'markTaskSeen');
  }
}

/**
 * Fetch the city-wide status: per-agent activity, the Mayor's activity and
 * the delegation links between agents.
 * @returns {Promise<{agents: Object<string, 'idle'|'working'>, mayor: 'idle'|'working', links: Array<{id: string, from: string, to: string, label: string}>}>}
 */
export async function fetchCityStatus() {
  const res = await fetch('/api/city/status');
  if (!res.ok) {
    throw await responseError(res, 'fetchCityStatus');
  }
  return res.json();
}

/**
 * Fetch the Mayor's standing-chat transcript.
 * @returns {Promise<Array<Object>>}
 */
export async function fetchMayorChat() {
  const res = await fetch('/api/mayor/chat');
  if (!res.ok) {
    throw await responseError(res, 'fetchMayorChat');
  }
  const data = await res.json();
  return data.transcript;
}

/**
 * Send a message to the Mayor and get back the updated transcript. Rejects
 * with an Error whose `status` is 409 when the Mayor is busy.
 * @param {string} message
 * @param {Array<{name: string, mediaType: string, data: string}>} [attachments]
 * @returns {Promise<Array<Object>>}
 */
export async function sendMayorChat(message, attachments) {
  const res = await fetch('/api/mayor/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: messageBody(message, attachments),
  });
  if (!res.ok) {
    throw await responseError(res, 'sendMayorChat');
  }
  const data = await res.json();
  return data.transcript;
}

/**
 * Create a new playground (project) by name.
 * @param {string} name
 * @returns {Promise<{projectPath: string, projectName: string, agents: Array<Object>}>}
 */
export async function createPlayground(name) {
  const res = await fetch('/api/playgrounds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw await responseError(res, 'createPlayground');
  }
  const data = await res.json();
  return data.playground;
}
