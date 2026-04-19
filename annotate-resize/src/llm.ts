// TODO(pretext): replace @mariozechner/pi-ai with cheng lou's pretext library once available.
// pretext is expected to provide a cleaner provider-agnostic streaming API.
// When swapping: update getModel/getModels/complete/stream imports, update callLLM and streamLLM below,
// and check that cost tracking (res.usage.cost.total) still works.
import { getModel, getModels, complete } from '@mariozechner/pi-ai';
import { loadKey, loadActiveProvider, loadActiveModel, addSpend } from './storage';
import type { Model } from '@mariozechner/pi-ai';

export { getModels };

// TODO(streaming): add streamLLM(prompt, onWord, onDone, onError) using pi-ai's stream() function.
// Pattern:
//   1. Call stream() instead of complete() to get an AssistantMessageEventStream.
//   2. Subscribe to text_delta events — push each delta into a word-boundary buffer.
//   3. A setInterval at ~10ms dequeues one word at a time and calls onWord(word).
//      This smooths out bursty model output into a steady per-word cadence (see nightly.ink/projects/smooth-stream).
//   4. On the 'done' event, flush remaining buffer, call onDone(fullText), clear the interval.
//   5. On 'error', call onError(message).
// Callers (runResize, stitchBox, etc.) should:
//   - Write words directly to the textarea DOM node (bypass React state for the hot path).
//   - Disable the textarea during streaming to prevent mid-stream edits.
//   - On onDone, commit the final text to React state and re-enable the textarea.
// Add a 'streamMode' boolean to storage (loadStreamMode/saveStreamMode) and a toggle in Sidebar.
// runResize and the merge/stitch LLM calls should all branch on streamMode.
export async function callLLM(prompt: string): Promise<string> {
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
  }, { apiKey });

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
