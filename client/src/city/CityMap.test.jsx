import { test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CityMap } from './CityMap.jsx';

afterEach(cleanup);

const agent = (projectPath, name, extra = {}) => ({
  id: `${projectPath}::${name}`,
  name,
  description: `${name} agent`,
  tools: [],
  model: 'sonnet',
  projectPath,
  filePath: `${projectPath}/.claude/agents/${name}.md`,
  ...extra,
});

const projects = [
  {
    projectPath: '/p/shop',
    projectName: 'shop',
    agents: [agent('/p/shop', 'reviewer'), agent('/p/shop', 'writer')],
  },
  { projectPath: '/p/empty', projectName: 'empty-yard', agents: [] },
];

const idleStatus = { agents: {}, mayor: 'idle', links: [] };

function renderMap(props = {}) {
  const handlers = {
    onAgentClick: vi.fn(),
    onMayorClick: vi.fn(),
    onHire: vi.fn(),
    onNewPlayground: vi.fn(),
    onDeletePlayground: vi.fn(),
  };
  const utils = render(
    <CityMap projects={projects} status={idleStatus} {...handlers} {...props} />
  );
  return { ...utils, ...handlers };
}

test('renders a sign per project and a labelled button per agent', () => {
  renderMap({
    status: { agents: { '/p/shop::writer': 'working' }, mayor: 'idle', links: [] },
  });
  expect(screen.getByTitle('shop')).toHaveTextContent('shop');
  expect(screen.getByTitle('empty-yard')).toHaveTextContent('empty-yard');
  expect(screen.getByRole('button', { name: 'reviewer, idle' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'writer, working' })).toBeInTheDocument();
});

test('a working agent sits at a desk with a working bubble; an idle one shows zZ', () => {
  renderMap({
    status: { agents: { '/p/shop::writer': 'working' }, mayor: 'idle', links: [] },
  });
  const working = screen.getByRole('button', { name: 'writer, working' });
  expect(within(working).getByTestId('agent-sprite')).toHaveAttribute('data-pose', 'working');
  expect(within(working).getByTestId('desk')).toBeInTheDocument();
  expect(working).toHaveTextContent('working…');

  const idle = screen.getByRole('button', { name: 'reviewer, idle' });
  expect(within(idle).getByTestId('agent-sprite')).toHaveAttribute('data-pose', 'idle');
  expect(within(idle).queryByTestId('desk')).not.toBeInTheDocument();
  expect(idle).toHaveTextContent('zZ');
});

test('a project with no agents still gets its sign and a hire post', () => {
  renderMap();
  expect(screen.getByTitle('empty-yard')).toBeInTheDocument();
  const hire = screen.getByRole('button', { name: 'Hire an agent in empty-yard' });
  expect(hire).toHaveTextContent('+ HIRE');
  expect(screen.getAllByRole('button', { name: /^Hire an agent in / })).toHaveLength(2);
});

test('a very long agent name keeps its button and exposes the full name as a title', () => {
  const longName = 'n'.repeat(120);
  renderMap({
    projects: [{ projectPath: '/p/x', projectName: 'x', agents: [agent('/p/x', longName)] }],
  });
  const button = screen.getByRole('button', { name: `${longName}, idle` });
  expect(within(button).getByTitle(longName)).toHaveTextContent(longName);
});

test('a malformed agent renders as a broken-file button', () => {
  const broken = {
    id: '/p/x::bad.md',
    projectPath: '/p/x',
    filePath: '/p/x/.claude/agents/bad.md',
    error: 'missing frontmatter',
  };
  const { onAgentClick } = renderMap({
    projects: [{ projectPath: '/p/x', projectName: 'x', agents: [broken] }],
  });
  const button = screen.getByRole('button', { name: 'bad.md, broken agent file' });
  expect(within(button).queryByTestId('agent-sprite')).not.toBeInTheDocument();
  expect(button).toHaveTextContent('?');
  fireEvent.click(button);
  expect(onAgentClick).toHaveBeenCalledWith(broken);
});

test('clicking an agent, the Mayor, a hire post and the lot calls the matching handler', () => {
  const { onAgentClick, onMayorClick, onHire, onNewPlayground } = renderMap();

  fireEvent.click(screen.getByRole('button', { name: 'reviewer, idle' }));
  expect(onAgentClick).toHaveBeenCalledWith(projects[0].agents[0]);

  fireEvent.click(screen.getByRole('button', { name: 'Mayor, idle' }));
  expect(onMayorClick).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: 'Hire an agent in shop' }));
  expect(onHire).toHaveBeenCalledWith('/p/shop');

  const lot = screen.getByRole('button', { name: /LOT FOR SALE/ });
  expect(lot).toHaveTextContent('LOT FOR SALE');
  expect(lot).toHaveTextContent('+ NEW PLAYGROUND');
  fireEvent.click(lot);
  expect(onNewPlayground).toHaveBeenCalledTimes(1);
});

test('the Mayor button reflects the Mayor status and shows the town hall', () => {
  renderMap({ status: { agents: {}, mayor: 'working', links: [] } });
  const mayor = screen.getByRole('button', { name: 'Mayor, working' });
  expect(within(mayor).getByTestId('mayor-sprite')).toBeInTheDocument();
  expect(screen.getByText('TOWN HALL')).toBeInTheDocument();
});

test('draws one dashed line per link whose endpoints are on the map', () => {
  const { container } = renderMap({
    status: {
      agents: {},
      mayor: 'working',
      links: [
        { id: 'l1', from: 'mayor', to: '/p/shop::reviewer', label: 'review' },
        { id: 'l2', from: '/p/shop::reviewer', to: '/p/shop::writer', label: 'draft' },
        { id: 'l3', from: 'mayor', to: '/p/gone::ghost', label: 'nobody' },
      ],
    },
  });
  const lines = screen.getAllByTestId('link-line');
  expect(lines).toHaveLength(2);
  for (const line of lines) {
    expect(line.getAttribute('stroke-dasharray')).toBeTruthy();
  }
  // The map is sized by the layout so it can scroll.
  const map = container.querySelector('.city-map');
  expect(parseFloat(map.style.width)).toBeGreaterThan(0);
  expect(parseFloat(map.style.height)).toBeGreaterThan(0);
});

test('items further down the screen stack above items further up', () => {
  renderMap();
  const z = (el) => Number(el.style.zIndex);
  const reviewer = screen.getByRole('button', { name: 'reviewer, idle' });
  const writer = screen.getByRole('button', { name: 'writer, idle' });
  // writer is the second slot in the same row: further right and further down.
  expect(z(writer)).toBeGreaterThan(z(reviewer));
});

test('an idle agent with an unread task result shows a DONE bubble; working wins', () => {
  const projects = [
    {
      projectPath: '/p',
      projectName: 'p',
      agents: [
        { id: '/p::a', name: 'a' },
        { id: '/p::b', name: 'b' },
      ],
    },
  ];
  const status = { agents: { '/p::a': 'idle', '/p::b': 'working' }, mayor: 'idle', links: [], unseenTasks: { '/p::a': 1, '/p::b': 1 } };
  render(<CityMap projects={projects} status={status} />);
  expect(screen.getByRole('button', { name: 'a, idle, new task result' })).toHaveTextContent('✓ DONE');
  expect(screen.getByRole('button', { name: 'b, working, new task result' })).not.toHaveTextContent('DONE');
});

test('each playground sign has a delete button for that playground', () => {
  const { onDeletePlayground } = renderMap();
  fireEvent.click(screen.getByRole('button', { name: 'Delete playground empty-yard' }));
  expect(onDeletePlayground).toHaveBeenCalledWith(projects[1]);
});
