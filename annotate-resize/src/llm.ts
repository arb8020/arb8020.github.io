import { getModel, getModels, complete } from '@mariozechner/pi-ai';
import { loadKey, loadActiveProvider, loadActiveModel, addSpend } from './storage';
import type { Model } from '@mariozechner/pi-ai';

export { getModels };

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
