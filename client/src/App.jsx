import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAgents } from './api.js';
import { AgentDialog } from './city/AgentDialog.jsx';
import { NewPlaygroundDialog } from './city/NewPlaygroundDialog.jsx';
import { DeletePlaygroundDialog } from './city/DeletePlaygroundDialog.jsx';
import { MayorPanel } from './city/MayorPanel.jsx';
import { CityMap } from './city/CityMap.jsx';
import { useCityStatus } from './city/useCityStatus.js';
import { ChatScreen } from './chat/ChatScreen.jsx';
import { CreateAgentModal } from './components/CreateAgentModal.jsx';
import { SettingsPanel } from './components/SettingsPanel.jsx';
import { UpdateBar } from './components/UpdateBar.jsx';

const viewFromHash = () => (window.location.hash === '#chat' ? 'chat' : 'city');

export function App() {
  const [view, setView] = useState(viewFromHash);
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [hireProjectPath, setHireProjectPath] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [mayorOpen, setMayorOpen] = useState(false);
  const [newPlaygroundOpen, setNewPlaygroundOpen] = useState(false);
  const [playgroundToDelete, setPlaygroundToDelete] = useState(null);
  const status = useCityStatus();
  // Only the most recent fetch may update state, so an older, slower scan
  // can never overwrite a newer one (or update after unmount).
  const latestRequest = useRef(0);

  // `quiet` refreshes (the timer and window focus) skip the SCANNING… state.
  const loadAgents = useCallback(({ quiet = false } = {}) => {
    const requestId = ++latestRequest.current;
    if (!quiet) setScanning(true);
    return fetchAgents()
      .then((fetchedProjects) => {
        if (latestRequest.current === requestId) {
          setProjects(fetchedProjects);
          setError(null);
        }
      })
      .catch((err) => {
        if (latestRequest.current === requestId) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (latestRequest.current === requestId) {
          setScanning(false);
        }
      });
  }, []);

  useEffect(() => {
    loadAgents();
    return () => {
      // Invalidate any in-flight request.
      latestRequest.current += 1;
    };
  }, [loadAgents]);

  // Re-check the folders now and then, so a playground or agent removed in
  // Finder (or added elsewhere) shows up without pressing RESCAN.
  useEffect(() => {
    const refresh = () => loadAgents({ quiet: true });
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [loadAgents]);

  // The view lives in the URL hash (#chat, else the city) so reloads and the
  // back button keep it.
  useEffect(() => {
    const sync = () => setView(viewFromHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  function showView(next) {
    setView(next);
    window.location.hash = next === 'chat' ? '#chat' : '';
  }

  function handleSettingsSaved() {
    setShowSettings(false);
    loadAgents();
  }

  const allAgents = projects.flatMap((project) => project.agents);
  const agentsById = Object.fromEntries(allAgents.map((agent) => [agent.id, agent]));
  const workingCount = allAgents.filter((agent) => status.agents[agent.id] === 'working').length;

  return (
    <div className="app app-city">
      <nav className="app-rail" aria-label="Views">
        <button
          type="button"
          className="app-rail-btn"
          aria-label="City"
          aria-pressed={view === 'city'}
          data-tip="CITY"
          title="City"
          onClick={() => showView('city')}
        >
          <span aria-hidden="true">🏙</span>
        </button>
        <button
          type="button"
          className="app-rail-btn"
          aria-label="Chat"
          aria-pressed={view === 'chat'}
          data-tip="CHAT"
          title="Chat"
          onClick={() => showView('chat')}
        >
          <span aria-hidden="true">💬</span>
        </button>
      </nav>
      <div className="app-view">
        {view === 'chat' ? (
          <ChatScreen />
        ) : (
          <>
            <header className="city-hud">
              <h1 className="city-hud-title">AGENT CITY</h1>
              <span className="city-hud-stat">PLAYGROUNDS {projects.length}</span>
              <span className="city-hud-stat">AGENTS {allAgents.length}</span>
              <span className="city-hud-stat city-hud-stat-working">WORKING {workingCount}</span>
              <div className="city-hud-actions">
                <button
                  type="button"
                  className="city-hud-btn city-hud-btn-primary"
                  onClick={() => setNewPlaygroundOpen(true)}
                >
                  + PLAYGROUND
                </button>
                <button type="button" className="city-hud-btn" onClick={() => loadAgents()} disabled={scanning}>
                  {scanning ? 'SCANNING…' : 'RESCAN'}
                </button>
                <button
                  type="button"
                  className="city-hud-btn"
                  onClick={() => setShowSettings((shown) => !shown)}
                >
                  SETTINGS
                </button>
              </div>
            </header>
            {error && (
              <p className="app-error city-banner" role="alert">
                {error}
              </p>
            )}
            {!error && !scanning && projects.length === 0 && (
              <p className="app-empty city-banner">
                No agents found. Add a root folder in Settings, then Rescan.
              </p>
            )}
            <CityMap
              projects={projects}
              status={status}
              onAgentClick={setSelectedAgent}
              onMayorClick={() => setMayorOpen(true)}
              onHire={setHireProjectPath}
              onNewPlayground={() => setNewPlaygroundOpen(true)}
              onDeletePlayground={setPlaygroundToDelete}
            />
          </>
        )}
      </div>
      {showSettings && (
        <SettingsPanel onSaved={handleSettingsSaved} onClose={() => setShowSettings(false)} />
      )}
      {selectedAgent && (
        <AgentDialog
          agent={selectedAgent}
          status={status.agents[selectedAgent.id]}
          onClose={() => setSelectedAgent(null)}
          onDeleted={() => {
            setSelectedAgent(null);
            loadAgents();
          }}
          onUpdated={(updated) => {
            setSelectedAgent((current) => (current ? { ...current, ...updated } : current));
            loadAgents();
          }}
        />
      )}
      {mayorOpen && (
        <MayorPanel
          links={status.links ?? []}
          agentsById={agentsById}
          mayorStatus={status.mayor}
          onClose={() => setMayorOpen(false)}
        />
      )}
      {playgroundToDelete && (
        <DeletePlaygroundDialog
          project={playgroundToDelete}
          onCancel={() => setPlaygroundToDelete(null)}
          onDeleted={() => {
            setPlaygroundToDelete(null);
            loadAgents();
          }}
        />
      )}
      {newPlaygroundOpen && (
        <NewPlaygroundDialog
          onCreated={() => {
            setNewPlaygroundOpen(false);
            loadAgents();
          }}
          onCancel={() => setNewPlaygroundOpen(false)}
        />
      )}
      <UpdateBar />
      {hireProjectPath && (
        <CreateAgentModal
          projectPath={hireProjectPath}
          onCreated={() => {
            setHireProjectPath(null);
            loadAgents();
          }}
          onCancel={() => setHireProjectPath(null)}
        />
      )}
    </div>
  );
}
