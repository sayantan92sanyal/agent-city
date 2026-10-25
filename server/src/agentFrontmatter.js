import matter from 'gray-matter';

function splitTools(value) {
  return String(value ?? '')
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean);
}

// Allowlist: only YAML front matter (or a block with no language, which is YAML by
// default) is accepted. gray-matter's built-in engines include JavaScript, which
// would execute code from the file, and JSON, which is out of scope here. Any
// other language is rejected before gray-matter picks an engine.
const ALLOWED_FRONT_MATTER_LANGUAGES = new Set(['', 'yaml']);

const matterOptions = { language: 'yaml' };

function assertYamlFrontMatter(raw) {
  if (!matter.test(raw, matterOptions)) return;
  const { name } = matter.language(raw, matterOptions);
  if (!ALLOWED_FRONT_MATTER_LANGUAGES.has(name)) {
    throw new Error(`unsupported front matter language: ${name}`);
  }
}

export function parseAgentFile(raw) {
  assertYamlFrontMatter(raw);
  const { data, content } = matter(raw, matterOptions);
  return {
    name: String(data.name ?? ''),
    description: String(data.description ?? ''),
    tools: splitTools(data.tools),
    model: String(data.model ?? ''),
    systemPrompt: content.trim(),
  };
}

// `tools` and `model` are omitted entirely when empty: an absent key means
// "inherit the default tool set / model", whereas an empty string could be
// read as "no tools" / an invalid model name.
export function serializeAgentFile(agent) {
  const data = {
    name: agent.name,
    description: agent.description,
  };
  const tools = (agent.tools ?? []).filter(Boolean);
  if (tools.length > 0) data.tools = tools.join(', ');
  if (agent.model) data.model = agent.model;
  const body = `${agent.systemPrompt}\n`;
  assertYamlFrontMatter(body);
  return matter.stringify(body, data, matterOptions);
}

// Rewrites an agent file's description, tools and body while keeping every
// other front matter key (model, color, ...) exactly as the user set it.
export function updateAgentFile(raw, { description, systemPrompt, tools }) {
  assertYamlFrontMatter(raw);
  const data = { ...matter(raw, matterOptions).data, description };
  const list = (tools ?? []).filter(Boolean);
  if (list.length > 0) data.tools = list.join(', ');
  else delete data.tools;
  const body = `${systemPrompt}\n`;
  assertYamlFrontMatter(body);
  return matter.stringify(body, data, matterOptions);
}
