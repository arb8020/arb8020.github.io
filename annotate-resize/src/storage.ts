import type { FitMode, DensityVisual } from './types';

const K = {
  tmpl: 'ar.tmpl',
  userKeys: 'ar.userKeys',
  activeProvider: 'ar.activeProvider',
  activeModel: 'ar.activeModel',
  fitMode: 'ar.fitMode',
  densityTmpl: 'ar.densityTmpl',
  densityConcept: 'ar.densityConcept',
  densityVisual: 'ar.densityVisual',
  resizeTolerance: 'ar.resizeTolerance',
  providerKey: (p: string) => `ar.key.${p}`,
  spend: (p: string) => `ar.spend.${p}`,
};

export const DEFAULT_TMPL = `You are a text rewriter. Rewrite the original_text so it is approximately {{target_count}} characters long (currently {{current_count}} characters).
Preserve meaning and key facts. Use the additional instructions on tone, emphasis, or audience.

additional instructions:
{{annotation}}

original_text:
{{v0_text}}

prior versions (for context, may be empty):
{{included_versions}}

Reply with the rewritten text only. No preamble, no quotes, no markdown.`;

export const REQUIRED_KEYS = ['v0_text', 'target_count'];
export const RECOMMENDED_KEYS = ['annotation', 'included_versions', 'current_count'];

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

export const loadFitMode = (): FitMode => (localStorage.getItem(K.fitMode) as FitMode) || 'widen';
export const saveFitMode = (v: FitMode) => localStorage.setItem(K.fitMode, v);

export const DEFAULT_DENSITY_CONCEPT = 'importance';
export const DEFAULT_DENSITY_TMPL = `Score each span of the following text by {{concept}} on a scale of 0.0 to 1.0.
Return a JSON array of objects with keys "start" (char offset), "end" (char offset), and "score" (0.0–1.0).
Spans should cover the parts of the text you find most interesting — you don't need to cover every character.
Reply with the JSON array only. No explanation, no markdown fences.

text:
{{text}}`;

export const loadDensityTmpl = () => localStorage.getItem(K.densityTmpl) || DEFAULT_DENSITY_TMPL;
export const saveDensityTmpl = (v: string) => localStorage.setItem(K.densityTmpl, v);
export const loadDensityConcept = () => localStorage.getItem(K.densityConcept) || DEFAULT_DENSITY_CONCEPT;
export const saveDensityConcept = (v: string) => localStorage.setItem(K.densityConcept, v);
export const loadDensityVisual = (): DensityVisual => (localStorage.getItem(K.densityVisual) as DensityVisual) || 'heatmap';
export const saveDensityVisual = (v: DensityVisual) => localStorage.setItem(K.densityVisual, v);
export const loadResizeTolerance = () => parseFloat(localStorage.getItem(K.resizeTolerance) || '0.1');
export const saveResizeTolerance = (v: number) => localStorage.setItem(K.resizeTolerance, String(v));
export const loadConfirmRewrite = (): boolean => localStorage.getItem('ar.confirmRewrite') !== 'false'; // default on
export const saveConfirmRewrite = (v: boolean) => localStorage.setItem('ar.confirmRewrite', String(v));

// TODO(streaming): add stream mode key and load/save here.
// export const loadStreamMode = (): boolean => localStorage.getItem(K.streamMode) === 'true';
// export const saveStreamMode = (v: boolean) => localStorage.setItem(K.streamMode, String(v));
// Also add a toggle in Sidebar under "Box sizing" section: "stream LLM output word-by-word".

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
