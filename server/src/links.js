import { randomUUID } from 'node:crypto';

// In-memory registry of "who is currently asking whom". `from` is 'mayor' or
// an agent id; `to` is an agent id. Never persisted.
const links = new Map(); // id -> { id, from, to, label, startedAt }

export function startLink({ from, to, label }) {
  const id = randomUUID();
  links.set(id, { id, from, to, label, startedAt: Date.now() });
  return id;
}

export function endLink(id) {
  links.delete(id);
}

export function activeLinks() {
  return [...links.values()];
}

export function isLinkTarget(agentId) {
  for (const link of links.values()) {
    if (link.to === agentId) return true;
  }
  return false;
}

export function clearLinks() {
  links.clear();
}
