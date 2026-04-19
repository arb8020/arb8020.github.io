export interface Provider {
  id: string;
  label: string;
}

export const PROVIDERS: Provider[] = [
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'google', label: 'Google (Gemini)' },
  { id: 'xai', label: 'xAI' },
  { id: 'groq', label: 'Groq' },
  { id: 'cerebras', label: 'Cerebras' },
  { id: 'mistral', label: 'Mistral' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'vercel-ai-gateway', label: 'Vercel AI Gateway' },
  { id: 'minimax', label: 'MiniMax' },
  { id: 'huggingface', label: 'HuggingFace' },
  { id: 'kimi-coding', label: 'Kimi For Coding' },
];

// dedupe
const seen = new Set<string>();
export const UNIQUE_PROVIDERS = PROVIDERS.filter(p => {
  if (seen.has(p.id)) return false;
  seen.add(p.id);
  return true;
});
