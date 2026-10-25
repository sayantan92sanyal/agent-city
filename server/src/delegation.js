import { endLink, startLink } from './links.js';

const DELEGATION_TOOLS = new Set(['Agent', 'Task']);

// Watches a running agent's stream-json events for native delegation to a
// sibling agent (Agent/Task tool) and mirrors it into the links registry.
export function createDelegationTracker({ fromAgent }) {
  const open = new Map(); // tool_use id -> link id

  function onEvent(event) {
    const content = event?.message?.content;
    if (!Array.isArray(content)) return;
    if (event.type === 'assistant') {
      for (const block of content) {
        if (block?.type !== 'tool_use' || !DELEGATION_TOOLS.has(block.name)) continue;
        const sub = block.input?.subagent_type;
        if (typeof sub !== 'string' || !sub || open.has(block.id)) continue;
        open.set(
          block.id,
          startLink({
            from: fromAgent.id,
            to: `${fromAgent.projectPath}::${sub}`,
            label: (block.input.description ?? '').slice(0, 60),
          }),
        );
      }
    } else if (event.type === 'user') {
      for (const block of content) {
        if (block?.type !== 'tool_result' || !open.has(block.tool_use_id)) continue;
        endLink(open.get(block.tool_use_id));
        open.delete(block.tool_use_id);
      }
    }
  }

  function close() {
    for (const linkId of open.values()) endLink(linkId);
    open.clear();
  }

  return { onEvent, close };
}
