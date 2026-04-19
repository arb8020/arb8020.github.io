export interface Provider {
  id: string;
  label: string;
  envVar: string;
}

export const PROVIDERS: Provider[] = [
  { id: 'openrouter', label: 'OpenRouter', envVar: 'OPENROUTER_API_KEY' },
  { id: 'anthropic', label: 'Anthropic', envVar: 'ANTHROPIC_API_KEY' },
  { id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY' },
  { id: 'google', label: 'Google (Gemini)', envVar: 'GEMINI_API_KEY' },
  { id: 'xai', label: 'xAI', envVar: 'XAI_API_KEY' },
  { id: 'groq', label: 'Groq', envVar: 'GROQ_API_KEY' },
  { id: 'cerebras', label: 'Cerebras', envVar: 'CEREBRAS_API_KEY' },
  { id: 'mistral', label: 'Mistral', envVar: 'MISTRAL_API_KEY' },
  { id: 'openrouter', label: 'OpenRouter', envVar: 'OPENROUTER_API_KEY' },
  { id: 'vercel-ai-gateway', label: 'Vercel AI Gateway', envVar: 'VERCEL_AI_GATEWAY_API_KEY' },
  { id: 'minimax', label: 'MiniMax', envVar: 'MINIMAX_API_KEY' },
  { id: 'huggingface', label: 'HuggingFace', envVar: 'HF_TOKEN' },
  { id: 'kimi-coding', label: 'Kimi For Coding', envVar: 'KIMI_API_KEY' },
];

// dedupe
const seen = new Set<string>();
export const UNIQUE_PROVIDERS = PROVIDERS.filter(p => {
  if (seen.has(p.id)) return false;
  seen.add(p.id);
  return true;
});
