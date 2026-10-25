import { useState } from 'react';
import { createAgent, draftAgent } from '../api.js';
import { useElapsed } from './useElapsed.js';

const MODEL_OPTIONS = ['sonnet', 'opus', 'haiku', 'inherit'];

function parseTools(toolsText) {
  return toolsText
    .split(',')
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
}

// No tools typed means the file omits `tools`, so the agent keeps Claude
// Code's full default set, which already includes calling other agents.
// Writing just `tools: Agent` would leave it with nothing else (no web
// search, no file reading).
function buildTools(toolsText, canCallAgents) {
  const tools = parseTools(toolsText);
  if (canCallAgents && tools.length > 0 && !tools.includes('Agent')) {
    tools.push('Agent');
  }
  return tools;
}

/**
 * Modal form for creating a new agent within a project. "Draft with Claude"
 * turns the description typed here (the user's brief) into a sharper
 * description, full instructions and suggested tools, all editable before
 * Create writes the file.
 */
export function CreateAgentModal({ projectPath, onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [model, setModel] = useState('sonnet');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [toolsText, setToolsText] = useState('');
  const [canCallAgents, setCanCallAgents] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  // The user's own words from the first draft, so a redraft starts from them
  // rather than from Claude's rewrite.
  const [brief, setBrief] = useState(null);
  const elapsed = useElapsed(drafting);

  const busy = submitting || drafting;
  const canSubmit = name.trim().length > 0 && description.trim().length > 0 && !busy;

  async function handleDraft() {
    const source = brief ?? description;
    setDrafting(true);
    setError(null);
    try {
      const draft = await draftAgent({ name: name.trim(), brief: source });
      setBrief(source);
      setDescription(draft.description);
      setInstructions(draft.instructions);
      setToolsText(draft.tools.join(', '));
    } catch (err) {
      setError(err.message || 'Claude could not draft the agent.');
    } finally {
      setDrafting(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const agent = await createAgent(projectPath, {
        name,
        model,
        description,
        ...(instructions.trim() ? { instructions } : {}),
        tools: buildTools(toolsText, canCallAgents),
      });
      onCreated(agent);
    } catch (err) {
      setError(err.message || 'Failed to create agent.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay">
      <form
        className="modal create-agent-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Create agent"
        onSubmit={handleSubmit}
      >
        <h2>Create agent</h2>

        {error && <p role="alert" className="form-error">{error}</p>}

        <label htmlFor="create-agent-name">Name</label>
        <input
          id="create-agent-name"
          type="text"
          value={name}
          disabled={drafting}
          onChange={(event) => setName(event.target.value)}
        />

        <label htmlFor="create-agent-model">Model</label>
        <select
          id="create-agent-model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
        >
          {MODEL_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <label htmlFor="create-agent-description">Description</label>
        <textarea
          id="create-agent-description"
          value={description}
          disabled={drafting}
          placeholder="What should this agent do? Write it in your own words."
          onChange={(event) => setDescription(event.target.value)}
        />
        <div className="draft-row">
          <button
            type="button"
            className="draft-button"
            disabled={!name.trim() || !(brief ?? description).trim() || busy}
            onClick={handleDraft}
          >
            {drafting ? `Claude is drafting… ${elapsed}` : brief ? '✨ Redraft with Claude' : '✨ Draft with Claude'}
          </button>
          <small>
            {brief
              ? 'Review and edit the draft below, then Create.'
              : 'Claude writes a sharp description, full instructions and the tools it needs.'}
          </small>
        </div>

        <label htmlFor="create-agent-instructions">Instructions (the agent&apos;s brief, optional)</label>
        <textarea
          id="create-agent-instructions"
          className="agent-instructions"
          value={instructions}
          disabled={drafting}
          placeholder="Draft with Claude fills this in, or write it yourself."
          onChange={(event) => setInstructions(event.target.value)}
        />

        <label htmlFor="create-agent-tools">Tools (comma-separated)</label>
        <input
          id="create-agent-tools"
          type="text"
          value={toolsText}
          disabled={drafting}
          placeholder="Leave empty for all tools"
          onChange={(event) => setToolsText(event.target.value)}
        />

        <label htmlFor="create-agent-can-call" className="checkbox-label">
          <input
            id="create-agent-can-call"
            type="checkbox"
            checked={canCallAgents}
            onChange={(event) => setCanCallAgents(event.target.checked)}
          />
          Can call other agents in this playground
        </label>

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={!canSubmit}>
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
