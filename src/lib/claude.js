// Zugriff auf die Claude-API (Messages) mit fetch.

const apiBase = () => process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
const API_VERSION = '2026-10-21';

export const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: 'Ausgewogen – empfohlen' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', hint: 'Am günstigsten, schnell' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'Am gründlichsten, teurer' },
];
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export class ClaudeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function friendlyError(status, message = '') {
  if (status === 401) return 'Der Claude-API-Schlüssel ist ungültig.';
  if (status === 403) return 'Der Claude-API-Schlüssel hat dafür keine Berechtigung.';
  if (status === 404) return 'Das gewählte Claude-Modell gibt es nicht (mehr). Wähle in den Einstellungen ein anderes.';
  if (status === 429) return 'Zu viele Anfragen an Claude – bitte kurz warten.';
  if (status === 529 || status === 503) return 'Claude ist gerade überlastet. Versuch es gleich noch einmal.';
  if (/credit balance/i.test(message)) return 'Dein Guthaben für die Claude-API ist aufgebraucht. Lade es in der Claude Console auf.';
  return `Claude-API-Fehler (${status}): ${message || 'unbekannt'}`;
}

async function call(path, apiKey, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(180000),
    });
  } catch (err) {
    throw new ClaudeError(`Die Claude-API ist nicht erreichbar (${err.cause?.code || err.name}).`, 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ClaudeError(friendlyError(res.status, data?.error?.message), res.status);
  return data;
}

// Prüft den Schlüssel, ohne Kosten zu verursachen.
export async function checkApiKey(apiKey) {
  await call('/v1/models?limit=1', apiKey);
  return true;
}

/**
 * Wie createMessage, aber die Antwort kommt Stück für Stück (Server-Sent Events).
 * onText(delta) bekommt jeden Textschnipsel. Liefert am Ende dieselbe Nachricht wie createMessage.
 */
export async function streamMessage({ apiKey, model, system, tools, messages, maxTokens = 4096, onText }) {
  let res;
  try {
    res = await fetch(`${apiBase()}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        tools: tools?.length ? tools : undefined,
        messages,
        cache_control: { type: 'ephemeral' },
        stream: true,
      }),
      signal: AbortSignal.timeout(300000),
    });
  } catch (err) {
    throw new ClaudeError(`Die Claude-API ist nicht erreichbar (${err.cause?.code || err.name}).`, 0);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ClaudeError(friendlyError(res.status, data?.error?.message), res.status);
  }
  const msg = { id: null, role: 'assistant', content: [], stop_reason: null, usage: {} };
  const handle = (data) => {
    switch (data.type) {
      case 'message_start':
        msg.id = data.message?.id ?? null;
        msg.usage = { ...(data.message?.usage || {}) };
        break;
      case 'content_block_start': {
        const block = { ...data.content_block };
        if (block.type === 'tool_use') {
          block._json = '';
          block.input = {};
        }
        msg.content[data.index] = block;
        break;
      }
      case 'content_block_delta': {
        const block = msg.content[data.index];
        const d = data.delta || {};
        if (!block) break;
        if (d.type === 'text_delta') {
          block.text = (block.text || '') + d.text;
          onText?.(d.text);
        } else if (d.type === 'input_json_delta') block._json += d.partial_json || '';
        else if (d.type === 'thinking_delta') block.thinking = (block.thinking || '') + d.thinking;
        else if (d.type === 'signature_delta') block.signature = (block.signature || '') + d.signature;
        break;
      }
      case 'content_block_stop': {
        const block = msg.content[data.index];
        if (block?.type === 'tool_use') {
          try {
            block.input = block._json ? JSON.parse(block._json) : {};
          } catch {
            block.input = {};
          }
          delete block._json;
        }
        break;
      }
      case 'message_delta':
        if (data.delta?.stop_reason) msg.stop_reason = data.delta.stop_reason;
        if (data.usage) Object.assign(msg.usage, data.usage);
        break;
      case 'error':
        throw new ClaudeError(friendlyError(529, data.error?.message), 529);
      default:
        break;
    }
  };
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
      const data = raw.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      handle(parsed);
    }
  }
  msg.content = msg.content.filter(Boolean);
  if (!msg.stop_reason) throw new ClaudeError('Die Antwort von Claude ist abgebrochen. Versuch es nochmal.', 502);
  return msg;
}

export async function createMessage({ apiKey, model, system, tools, messages, maxTokens = 4096 }) {
  return call('/v1/messages', apiKey, {
    method: 'POST',
    body: {
      model,
      max_tokens: maxTokens,
      system,
      tools: tools?.length ? tools : undefined,
      messages,
      cache_control: { type: 'ephemeral' },
    },
  });
}
