import type { FitMode } from './types';

const K = {
  tmpl: 'ar.tmpl',
  userKeys: 'ar.userKeys',
  activeProvider: 'ar.activeProvider',
  activeModel: 'ar.activeModel',
  fitMode: 'ar.fitMode',
  providerKey: (p: string) => `ar.key.${p}`,
  spend: (p: string) => `ar.spend.${p}`,
};

export const DEFAULT_TMPL = `You are a text rewriter. Rewrite the original_text so it is approximately {{target_count}} characters long.
Preserve meaning and key facts. Use the additional instructions on tone, emphasis, or audience.

additional instructions:
{{annotation}}

original_text:
{{v0_text}}

prior versions (for context, may be empty):
{{included_versions}}

Reply with the rewritten text only. No preamble, no quotes, no markdown.`;

export const REQUIRED_KEYS = ['v0_text', 'target_count'];
export const RECOMMENDED_KEYS = ['annotation', 'included_versions'];

export const loadTmpl = () => localStorage.getItem(K.tmpl) || DEFAULT_TMPL;
export const saveTmpl = (v: string) => localStorage.setItem(K.tmpl, v);

export const loadUserKeys = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(K.userKeys) || '{}'); } catch { return {}; }
};
export const saveUserKeys = (v: Record<string, string>) => localStorage.setItem(K.userKeys, JSON.stringify(v));

export const loadActiveProvider = () => localStorage.getItem(K.activeProvider) || 'openrouter';
export const saveActiveProvider = (v: string) => localStorage.setItem(K.activeProvider, v);

export const loadActiveModel = () => localStorage.getItem(K.activeModel) || '';
export const saveActiveModel = (v: string) => localStorage.setItem(K.activeModel, v);

export const loadFitMode = (): FitMode => (localStorage.getItem(K.fitMode) as FitMode) || 'grow';
export const saveFitMode = (v: FitMode) => localStorage.setItem(K.fitMode, v);

export const loadKey = (p: string) => localStorage.getItem(K.providerKey(p)) || '';
export const saveKey = (p: string, k: string) => {
  const clean = k.replace(/\s/g, '');
  if (clean) localStorage.setItem(K.providerKey(p), clean);
  else localStorage.removeItem(K.providerKey(p));
};

export const tail4 = (s: string) => s ? '…' + s.slice(-4) : '';

export const getSpend = (p: string) => parseFloat(sessionStorage.getItem(K.spend(p)) || '0');
export const addSpend = (p: string, amt: number) => sessionStorage.setItem(K.spend(p), String(getSpend(p) + amt));
export const resetSpend = (p: string) => sessionStorage.removeItem(K.spend(p));
