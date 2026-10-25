import { layoutCity, isoToScreen, TILE_H } from './layout.js';
import { AgentSprite, MayorSprite, Desk, colorForName } from './sprites.jsx';

const MAYOR = 'mayor';
// How far above a character's feet a messenger line attaches (its chest).
const BODY_LIFT = 34;
const HALL_LIFT = 70;
// Extra room above the layout's top padding for the tall plot signs.
const SIGN_HEADROOM = 48;

const basename = (path = '') => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

// Upright items stack by how far down the screen their base sits.
const depth = (top) => 10 + Math.round(top);

function placed(point, extraStyle) {
  return { left: point.left, top: point.top, zIndex: depth(point.top), ...extraStyle };
}

/**
 * The isometric city: plaza + town hall + Mayor in the middle, one fenced plot
 * per project with its agents, a "+ HIRE" post per plot and a lot for sale.
 * Ground shapes are one SVG; characters, signs and posts are upright DOM
 * buttons on top, positioned via the layout's tile coordinates.
 */
export function CityMap({ projects, status, onAgentClick, onMayorClick, onHire, onNewPlayground, onDeletePlayground }) {
  const city = layoutCity(projects);
  const origin = { left: city.origin.left, top: city.origin.top + SIGN_HEADROOM };
  const mapHeight = city.height + SIGN_HEADROOM;
  const agentStatus = status?.agents ?? {};
  const unseenTasks = status?.unseenTasks ?? {};

  const pt = (x, y) => {
    const s = isoToScreen({ x, y });
    return { left: s.left + origin.left, top: s.top + origin.top };
  };
  const tileCenter = (x, y) => pt(x + 0.5, y + 0.5);
  const diamond = ({ x, y, w, h }, inset = 0) =>
    [
      pt(x + inset, y + inset),
      pt(x + w - inset, y + inset),
      pt(x + w - inset, y + h - inset),
      pt(x + inset, y + h - inset),
    ]
      .map((p) => `${p.left},${p.top}`)
      .join(' ');

  const { plaza, lot } = city;
  const plazaCenter = pt(plaza.x + plaza.w / 2, plaza.y + plaza.h / 2);
  const hallBase = { left: plazaCenter.left, top: plazaCenter.top + TILE_H / 2 };
  const mayorSpot = tileCenter(plaza.x + plaza.w / 2 + 1, plaza.y + plaza.h / 2 + 1);
  const lotCenter = pt(lot.x + lot.w / 2, lot.y + lot.h / 2);
  const mayorStatus = status?.mayor === 'working' ? 'working' : 'idle';

  // Where messenger lines attach, by agent id ('mayor' = the town hall).
  const anchors = new Map([[MAYOR, { left: hallBase.left, top: hallBase.top - HALL_LIFT }]]);
  const plots = projects.map((project, i) => {
    const plot = city.plots[i];
    const agents = project.agents.map((agent, k) => {
      const slot = plot.slots[k];
      const feet = tileCenter(slot.x, slot.y);
      if (agent.id != null) {
        anchors.set(agent.id, { left: feet.left, top: feet.top - BODY_LIFT });
      }
      return { agent, feet };
    });
    return { project, plot, agents };
  });

  const links = (status?.links ?? []).filter((l) => anchors.has(l.from) && anchors.has(l.to));

  return (
    <div className="city-viewport">
      <div className="city-map" style={{ width: city.width, height: mapHeight }}>
        <svg
          className="city-ground"
          width={city.width}
          height={mapHeight}
          shapeRendering="crispEdges"
          aria-hidden="true"
          focusable="false"
        >
          <polygon className="city-plaza" points={diamond(plaza)} />
          {Array.from({ length: plaza.w - 1 }, (_, i) => (
            <g key={i} className="city-plaza-joint">
              <line {...seg(pt(plaza.x + i + 1, plaza.y), pt(plaza.x + i + 1, plaza.y + plaza.h))} />
              <line {...seg(pt(plaza.x, plaza.y + i + 1), pt(plaza.x + plaza.w, plaza.y + i + 1))} />
            </g>
          ))}
          {plots.map(({ project, plot }) => (
            <g key={project.projectPath}>
              <polygon className="city-plot-dirt" points={diamond(plot.rect)} />
              <polygon className="city-plot-lawn" points={diamond(plot.rect, 0.2)} />
              <Fence rect={plot.rect} pt={pt} />
            </g>
          ))}
          <polygon className="city-lot" points={diamond(lot)} />
          <polygon className="city-lot-edge" points={diamond(lot, 0.15)} />
        </svg>

        <svg
          className="city-links"
          width={city.width}
          height={mapHeight}
          aria-hidden="true"
          focusable="false"
        >
          {links.map((link) => {
            const a = anchors.get(link.from);
            const b = anchors.get(link.to);
            const ends = { x1: a.left, y1: a.top, x2: b.left, y2: b.top };
            return (
              <g key={link.id}>
                <line className="city-link-shadow" {...ends} />
                <line
                  className="city-link"
                  data-testid="link-line"
                  {...ends}
                  stroke="#ffe14d"
                  strokeWidth={4}
                  strokeDasharray="10 8"
                >
                  {link.label && <title>{link.label}</title>}
                </line>
              </g>
            );
          })}
        </svg>

        <div className="city-hall" style={placed(hallBase)} aria-hidden="true">
          <span className="city-hall-sign">TOWN HALL</span>
          <span className="city-hall-flag" />
          <span className="city-hall-roof" />
          <span className="city-hall-body">
            <span className="city-hall-door" />
          </span>
        </div>

        <button
          type="button"
          className="city-item city-agent"
          data-status={mayorStatus}
          style={placed(mayorSpot)}
          aria-label={`Mayor, ${mayorStatus}`}
          onClick={() => onMayorClick?.()}
        >
          <Bubble working={mayorStatus === 'working'} text="coordinating…" />
          <span className="city-figure">
            <MayorSprite />
          </span>
          <span className="city-name city-name-mayor">MAYOR</span>
        </button>

        {plots.map(({ project, plot, agents }) => (
          <PlotItems
            key={project.projectPath}
            project={project}
            plot={plot}
            agents={agents}
            agentStatus={agentStatus}
            unseenTasks={unseenTasks}
            pt={pt}
            tileCenter={tileCenter}
            onAgentClick={onAgentClick}
            onHire={onHire}
            onDelete={onDeletePlayground}
          />
        ))}

        <button
          type="button"
          className="city-item city-lot-sign"
          style={placed(lotCenter)}
          onClick={() => onNewPlayground?.()}
        >
          <span className="city-board city-lot-board">
            <span className="city-lot-title">LOT FOR SALE</span>
            <span className="city-lot-cta">+ NEW PLAYGROUND</span>
          </span>
          <span className="city-posts" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function seg(a, b) {
  return { x1: a.left, y1: a.top, x2: b.left, y2: b.top };
}

function Fence({ rect, pt }) {
  const { x, y, w, h } = rect;
  const corners = [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)];
  const posts = [];
  for (let i = 0; i <= w; i++) posts.push(pt(x + i, y), pt(x + i, y + h));
  for (let j = 1; j < h; j++) posts.push(pt(x, y + j), pt(x + w, y + j));
  const rail = corners.map((c) => `${c.left},${c.top - 6}`).join(' ');
  return (
    <g className="city-fence">
      <polygon className="city-fence-rail" points={rail} />
      {posts.map((p, i) => (
        <rect key={i} x={Math.round(p.left) - 2} y={Math.round(p.top) - 9} width={4} height={10} />
      ))}
    </g>
  );
}

// Working beats DONE: a busy agent shows its desk bubble even if an earlier
// task's result is still unread.
function Bubble({ working, done = false, text = 'working…' }) {
  if (working) return <span className="city-bubble city-bubble-work">{text}</span>;
  if (done) return <span className="city-bubble city-bubble-done">✓ DONE</span>;
  return <span className="city-bubble city-bubble-idle">zZ</span>;
}

function PlotItems({ project, plot, agents, agentStatus, unseenTasks = {}, pt, tileCenter, onAgentClick, onHire, onDelete }) {
  const signSpot = pt(plot.rect.x, plot.rect.y);
  // Planted at the front corner of the hire tile so it never hides the name
  // label of the agent standing diagonally behind it.
  const hireSpot = pt(plot.hirePost.x + 1, plot.hirePost.y + 1);
  return (
    <>
      <div className="city-item city-plot-sign" style={placed(signSpot)}>
        <span className="city-board">
          <span className="city-sign-text" title={project.projectName}>
            {project.projectName}
          </span>
          {onDelete && (
            <button
              type="button"
              className="city-sign-delete"
              aria-label={`Delete playground ${project.projectName}`}
              title="Delete playground"
              onClick={() => onDelete(project)}
            >
              ✕
            </button>
          )}
        </span>
        <span className="city-posts" aria-hidden="true" />
      </div>

      {agents.map(({ agent, feet }, k) => {
        const key = agent.id ?? agent.filePath ?? k;
        if (agent.error) {
          const file = basename(agent.filePath) || String(agent.id ?? 'agent');
          return (
            <button
              key={key}
              type="button"
              className="city-item city-broken"
              style={placed(feet)}
              aria-label={`${file}, broken agent file`}
              title={agent.error}
              onClick={() => onAgentClick?.(agent)}
            >
              <span className="city-board city-broken-board">?</span>
              <span className="city-posts" aria-hidden="true" />
              <span className="city-name" title={file}>
                {file}
              </span>
            </button>
          );
        }
        const working = agentStatus[agent.id] === 'working';
        const state = working ? 'working' : 'idle';
        const unread = unseenTasks[agent.id] ?? 0;
        return (
          <button
            key={key}
            type="button"
            className="city-item city-agent"
            data-status={state}
            style={placed(feet, { '--bob-delay': `${(k % 5) * -0.23}s` })}
            aria-label={`${agent.name}, ${state}${unread > 0 ? ', new task result' : ''}`}
            onClick={() => onAgentClick?.(agent)}
          >
            <Bubble working={working} done={unread > 0} />
            <span className="city-figure">
              <AgentSprite color={colorForName(agent.name)} pose={state} />
              {working && (
                <span className="city-desk">
                  <Desk />
                </span>
              )}
            </span>
            <span className="city-name" title={agent.name}>
              {agent.name}
            </span>
          </button>
        );
      })}

      <button
        type="button"
        className="city-item city-hire"
        style={placed(hireSpot)}
        aria-label={`Hire an agent in ${project.projectName}`}
        onClick={() => onHire?.(project.projectPath)}
      >
        <span className="city-board city-hire-board">+ HIRE</span>
        <span className="city-post" aria-hidden="true" />
      </button>
    </>
  );
}
