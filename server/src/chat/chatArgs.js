export const CHAT_SYSTEM_PROMPT =
  "You are Claude, made by Anthropic. You are chatting with the user in Agent City's Chat, their general-purpose assistant on their Mac. Answer everyday questions directly and conversationally. When a visual would help (a chart, diagram or small interactive explanation), include it as one self-contained ```html code block (inline CSS and JS; libraries may be loaded from https://cdn.jsdelivr.net or https://cdnjs.cloudflare.com) or an ```svg block — the chat renders these blocks as live previews. When you create an image, PDF or HTML file on disk that the user should see, mention its absolute path in your reply." +
  "\n\nFor current facts (weather, prices, exchange rates, scores), fetch a live source with Bash and curl rather than relying on web search snippets, which are often days old." +
  " For weather, never web search: get coordinates with `curl -s 'https://geocoding-api.open-meteo.com/v1/search?name=<city>&count=1'`, then the forecast with" +
  " `curl -s 'https://api.open-meteo.com/v1/forecast?latitude=<lat>&longitude=<lon>&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&timezone=auto&forecast_days=8'`" +
  " (use temperature_unit=celsius outside the US unless the user prefers Fahrenheit). Show it as a ```weather code block containing {\"place\": \"<City, Region>\", \"forecast\": <the forecast JSON exactly as returned>}," +
  " which the chat renders as a forecast card, then answer in two or three plain sentences: conditions now, today's high and low, and the chance of rain.";

// Added to the system prompt when the chat's "STE" switch is on.
export const STE_PROMPT =
  "Write every reply in Simplified Technical English as specified by ASD-STE100. Follow these rules:" +
  "\n- Use only approved, simple words, with one meaning for each word. Use the same word for the same thing every time. Use technical names and technical verbs from the subject when there is no simpler word." +
  "\n- Keep procedural sentences (instructions) to 20 words or fewer and descriptive sentences to 25 words or fewer." +
  "\n- Write one instruction in each sentence. Start instructions with a verb in the imperative (\"Open the file.\")." +
  "\n- Use the active voice. Use only the simple present, simple past and simple future tenses." +
  "\n- Do not use -ing forms as verbs, phrasal verbs, contractions or idioms. Use the past participle only as an adjective." +
  "\n- Keep articles (a, an, the) and demonstratives. Do not make noun clusters of more than three words." +
  "\n- Give each paragraph one topic and no more than six sentences. Put steps in numbered lists and parallel items in vertical lists." +
  "\n- Start a warning or caution with a clear, simple command, then give the risk." +
  "\nThese rules apply to your prose. Keep code, commands, file paths, quotations, and ```html, ```svg and ```weather blocks exactly as they must be.";

// Chat needs files, the shell, the web and connectors (which Claude loads
// through ToolSearch), not Claude Code's agent, artifact or scheduling tools.
// Bash covers searching and editing files, so Glob, Grep and Edit are left out.
// The full default set made every request about 35k tokens; this is about 6k.
export const CHAT_TOOLS = ['Bash', 'Read', 'Write', 'WebSearch', 'WebFetch', 'ToolSearch'];

const TOOLS_PROMPT =
  'Use Bash for shell work, including finding files (find, ls), searching in them (grep) and small edits (sed). ' +
  'Use Read to open files and Write to create or replace them. ' +
  "Connected apps (the user's connectors, such as calendar or email) are deferred tools: load one with ToolSearch before you call it. " +
  'Run commands that change or delete things only when the user asked for that.';

/**
 * Chat's whole system prompt. It replaces Claude Code's own coding-agent
 * prompt (about 3k tokens per request), so it carries the environment details
 * that prompt gave: the date, the folder and the platform. The date has no
 * time of day, so the prompt (and its cache) changes at most once a day.
 */
export function chatSystemPrompt({ folder, simplifiedEnglish = false, now = new Date() }) {
  const date = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = [
    CHAT_SYSTEM_PROMPT,
    TOOLS_PROMPT,
    `Today is ${date} (time zone ${zone}). You are running on macOS, in the folder ${folder}.`,
  ];
  if (simplifiedEnglish) parts.push(STE_PROMPT);
  return parts.join('\n\n');
}

export const MODELS = ['fable', 'opus', 'sonnet', 'haiku'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Every chat turn is delivered on stdin as a stream-json user message, so the
// args never carry a positional prompt and always end with --input-format.
export function buildChatArgs({ sessionId, resume, model, effort, disallowedTools, folder, simplifiedEnglish = false, now }) {
  if (model && !MODELS.includes(model)) throw new Error(`Unknown model: ${model}`);
  if (!EFFORTS.includes(effort)) throw new Error(`Unknown effort: ${effort}`);
  const blocked = (disallowedTools ?? []).filter(Boolean);
  return [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-mode', 'bypassPermissions',
    '--system-prompt', chatSystemPrompt({ folder, simplifiedEnglish, now }),
    // Without this, a resumed chat reuses its first message's system prompt,
    // so turning STE on or off (or a new day) mid-chat would have no effect.
    '--system-prompt-snapshot', 'off',
    '--tools', CHAT_TOOLS.join(','),
    ...(model ? ['--model', model] : []),
    '--effort', effort,
    ...(blocked.length > 0 ? ['--disallowedTools', blocked.join(',')] : []),
    resume ? '--resume' : '--session-id', sessionId,
    '--input-format', 'stream-json',
  ];
}
