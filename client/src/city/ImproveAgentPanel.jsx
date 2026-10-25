import { useState } from 'react';
import { draftAgent, saveAgentDefinition } from '../api.js';
import { useElapsed } from '../components/useElapsed.js';

function parseTools(text) {
  return text
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean);
}

/**
 * Agent dialog step: Claude redrafts an existing agent's description,
 * instructions and tools from what the file holds now (plus any changes the
 * user asks for). The user edits the draft and SAVE writes it to the file.
 */
export function ImproveAgentPanel({ agent, onSaved, onBack }) {
  const [changes, setChanges] = useState('');
  const [draft, setDraft] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const elapsed = useElapsed(drafting);

  async function handleDraft() {
    setDrafting(true);
    setError(null);
    const brief = changes.trim()
      ? `${agent.description}\n\nChanges the user wants: ${changes.trim()}`
      : agent.description;
    try {
      const result = await draftAgent({
        name: agent.name,
        brief,
        current: { instructions: agent.instructions ?? '', tools: agent.tools ?? [] },
      });
      setDraft({ ...result, toolsText: result.tools.join(', ') });
    } catch (err) {
      setError(err.message || 'Claude could not draft the agent.');
    } finally {
      setDrafting(false);
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { description, instructions, toolsText } = draft;
      onSaved(await saveAgentDefinition(agent.id, { description, instructions, tools: parseTools(toolsText) }));
    } catch (err) {
      setError(err.message || 'Failed to save the agent.');
      setSaving(false);
    }
  }

  const update = (field) => (event) => setDraft((current) => ({ ...current, [field]: event.target.value }));
  const errorLine = error && (
    <p role="alert" className="form-error">
      {error}
    </p>
  );

  if (!draft) {
    return (
      <div className="improve-agent">
        <label htmlFor={`improve-changes-${agent.id}`}>What should change? (optional)</label>
        <textarea
          id={`improve-changes-${agent.id}`}
          value={changes}
          disabled={drafting}
          placeholder="e.g. be stricter on grammar, keep feedback under 300 words"
          onChange={(event) => setChanges(event.target.value)}
        />
        {errorLine}
        <div className="modal-actions">
          <button type="button" onClick={onBack} disabled={drafting}>
            BACK
          </button>
          <button type="button" onClick={handleDraft} disabled={drafting}>
            {drafting ? `DRAFTING… ${elapsed}` : '✨ IMPROVE WITH CLAUDE'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="improve-agent" onSubmit={handleSave}>
      <label htmlFor={`improve-description-${agent.id}`}>Description</label>
      <textarea id={`improve-description-${agent.id}`} value={draft.description} onChange={update('description')} />
      <label htmlFor={`improve-instructions-${agent.id}`}>Instructions</label>
      <textarea
        id={`improve-instructions-${agent.id}`}
        className="agent-instructions"
        value={draft.instructions}
        onChange={update('instructions')}
      />
      <label htmlFor={`improve-tools-${agent.id}`}>Tools (comma-separated, empty for all)</label>
      <input id={`improve-tools-${agent.id}`} type="text" value={draft.toolsText} onChange={update('toolsText')} />
      {errorLine}
      <div className="modal-actions">
        <button type="button" onClick={onBack} disabled={saving}>
          CANCEL
        </button>
        <button type="submit" disabled={saving || !draft.description.trim()}>
          SAVE
        </button>
      </div>
    </form>
  );
}
