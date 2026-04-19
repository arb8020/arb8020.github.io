// TODO(pretext): replace @mariozechner/pi-ai with cheng lou's pretext library once available.
// pretext is expected to provide a cleaner provider-agnostic streaming API.
// When swapping: update getModel/getModels/complete/stream imports, update callLLM and streamLLM below,
// and check that cost tracking (res.usage.cost.total) still works.
import { getModel, getModels, complete } from '@mariozechner/pi-ai';
import { loadKey, loadActiveProvider, loadActiveModel, addSpend } from './storage';
import type { Model } from '@mariozechner/pi-ai';

export { getModels };

// streamLLM: streams tokens word-by-word at a steady 16ms cadence.
// onWord: called with each word token for direct DOM writes (bypass React state).
// onDone: called with full text when stream completes — caller commits to state.
// onError: called on failure.
// Returns a cancel function.
export function streamLLM(
  prompt: string,
  onWord: (word: string) => void,
  onDone: (fullText: string) => void,
  onError: (msg: string) => void,
  maxTokens?: number,
  signal?: AbortSignal,
): () => void {
  const provider = loadActiveProvider();
  const modelId = loadActiveModel();
  const apiKey = loadKey(provider);
  if (!apiKey) { onError(`no api key saved for ${provider} — open settings`); return () => {}; }
  if (!modelId) { onError('no model selected — open settings'); return () => {}; }

  let cancelled = false;
  if (signal) {
    if (signal.aborted) { cancelled = true; }
    signal.addEventListener('abort', () => { cancelled = true; });
  }
  const wordQueue: string[] = [];
  let fullText = '';
  let flushInterval: ReturnType<typeof setInterval> | null = null;
  let streamDone = false;

  const flush = () => {
    if (wordQueue.length > 0) {
      onWord(wordQueue.shift()!);
    } else if (streamDone) {
      if (flushInterval) { clearInterval(flushInterval); flushInterval = null; }
      onDone(fullText);
    }
  };

  flushInterval = setInterval(flush, 16);

  (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = getModel(provider as any, modelId as any) as Model<any>;
      const { stream } = await import('@mariozechner/pi-ai');
      const s = stream(model, {
        systemPrompt: '',
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      }, { apiKey, maxTokens: maxTokens ?? 8192, signal });

      let wordBuf = '';
      const WORD_RE = /(\S+|\s+)/g;

      for await (const event of s) {
        if (cancelled) break;
        if (event.type === 'text_delta') {
          fullText += event.delta;
          wordBuf += event.delta;
          // split on word boundaries, keep last incomplete token in buffer
          const tokens = wordBuf.match(WORD_RE);
          if (tokens) {
            const last = wordBuf[wordBuf.length - 1];
            // if last char is whitespace the last token is complete
            const complete = /\s$/.test(last) ? tokens : tokens.slice(0, -1);
            wordBuf = /\s$/.test(last) ? '' : (tokens[tokens.length - 1] ?? '');
            for (const w of complete) wordQueue.push(w);
          }
        } else if (event.type === 'error') {
          if (flushInterval) { clearInterval(flushInterval); flushInterval = null; }
          onError(event.error.errorMessage || 'stream error');
          return;
        } else if (event.type === 'done') {
          const totalCost = event.message?.usage?.cost?.total;
          if (typeof totalCost === 'number' && isFinite(totalCost)) addSpend(provider, totalCost);
        }
      }
      // flush remaining word buffer
      if (wordBuf.trim()) wordQueue.push(wordBuf);
      streamDone = true;
    } catch (err: any) {
      if (flushInterval) { clearInterval(flushInterval); flushInterval = null; }
      onError(String(err.message || err));
    }
  })();

  return () => {
    cancelled = true;
    if (flushInterval) { clearInterval(flushInterval); flushInterval = null; }
  };
}

export class AbortedError extends Error {
  constructor() { super('aborted'); this.name = 'AbortedError'; }
}

export async function callLLM(prompt: string, maxTokens?: number, signal?: AbortSignal): Promise<string> {
  const provider = loadActiveProvider();
  const modelId = loadActiveModel();
  const apiKey = loadKey(provider);
  if (!apiKey) throw new Error(`no api key saved for ${provider} — open settings`);
  if (!modelId) throw new Error('no model selected — open settings');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = getModel(provider as any, modelId as any) as Model<any>;
  const res = await complete(model, {
    systemPrompt: '',
    messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
  }, { apiKey, maxTokens: maxTokens ?? 8192, signal });

  if (res.stopReason === 'aborted' || signal?.aborted) throw new AbortedError();
  if (res.stopReason === 'error') throw new Error(res.errorMessage || 'unknown provider error');

  const totalCost = res?.usage?.cost?.total;
  if (typeof totalCost === 'number' && isFinite(totalCost)) addSpend(provider, totalCost);

  const content = res.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((c: any) => c.type !== 'thinking').map((c: any) => c.text || '').join('').trim();
  return String(content || '').trim();
}

// Multi-turn: initial prompt + array of follow-up {user, assistant} pairs.
// Used for iterative resize where we pass previous output back as assistant turn.
export async function callLLMMultiTurn(
  initialPrompt: string,
  turns: { user: string; assistant: string }[],
): Promise<string> {
  const provider = loadActiveProvider();
  const modelId = loadActiveModel();
  const apiKey = loadKey(provider);
  if (!apiKey) throw new Error(`no api key saved for ${provider} — open settings`);
  if (!modelId) throw new Error('no model selected — open settings');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = getModel(provider as any, modelId as any) as Model<any>;
  const messages: any[] = [{ role: 'user', content: initialPrompt, timestamp: Date.now() }];
  for (const t of turns) {
    messages.push({ role: 'assistant', content: [{ type: 'text', text: t.assistant }], api: model.api, provider, model: modelId });
    messages.push({ role: 'user', content: t.user, timestamp: Date.now() });
  }

  const res = await complete(model, { systemPrompt: '', messages }, { apiKey });
  if (res.stopReason === 'error') throw new Error(res.errorMessage || 'unknown provider error');
  const totalCost = res?.usage?.cost?.total;
  if (typeof totalCost === 'number' && isFinite(totalCost)) addSpend(provider, totalCost);
  const content = res.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((c: any) => c.type !== 'thinking').map((c: any) => c.text || '').join('').trim();
  return String(content || '').trim();
}

export async function validateKey(provider: string, modelId: string, apiKey: string): Promise<{
  ok: boolean;
  stopReason: string;
  errorMessage: string;
  contentPreview: string;
  cost: unknown;
  api: string;
  baseUrl: string;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = getModel(provider as any, modelId as any) as Model<any>;
  const res = await complete(model, {
    systemPrompt: '',
    messages: [{ role: 'user', content: 'Reply with just the word "ok".', timestamp: Date.now() }],
  }, { apiKey });

  const content = res.content;
  const text = Array.isArray(content) ? content.map((c: any) => c.text || '').join('') : String(content || '');

  return {
    ok: res.stopReason !== 'error',
    stopReason: res.stopReason ?? '',
    errorMessage: res.errorMessage ?? '',
    contentPreview: text.slice(0, 80),
    cost: res.usage?.cost,
    api: model.api,
    baseUrl: (model as any).baseUrl ?? '',
  };
}
